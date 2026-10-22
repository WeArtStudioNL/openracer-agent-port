/*
 * Driver.js
 *
 * Description: The driver of a car: a model (a glb with a simple skeleton, in the T pose, made in Blender) that sits in the car. The car editor places it ("driver" in car.json) and the
 *              game moves it:
 *              - the hands hold the steering wheel and turn with it. The two grips are set in the car editor; in the game a grip is on the wheel at the angle that its hand has, and when a hand
 *                would go over the middle of the wheel (the hands would cross) it lets go and takes the wheel again further back (a hand passes over: only one at a time), as a driver does;
 *              - the feet follow the pedals: the right foot the throttle, the left foot the brake, along the way that the pedal moves;
 *              - the arms and the legs are two bones each with an inverse kinematics (IK): the hand or the foot goes to its place and the elbow or the knee bends to the side of a pole.
 *              car.json "driver": { enabled, file, position [x, y, z], rotation [x, y, z] (degrees), scale, bones: { hips, head, armL: [upper, lower, hand], armR, legL: [upper, lower, foot],
 *              legR }, hands: { left [x, y, z], right }, feet: { left (the brake), right (the throttle), travel (m), direction [x, y, z] }, elbow_out, knee_out }, all in the space of
 *              the body of the car (the space that the cameras and the exhaust points are in).
 */

OpenRacer.Driver = function (config, parent, steering) {
    var self = this;
    this.config = OpenRacer.Driver.withDefaults(config);
    this.parent = parent;
    this.steering = steering || null;                  // { object, axis }: the pivot of the steering wheel of the car and its axis (Car.js, CarLoader.js)
    this.root = new THREE.Group();
    this.root.name = "driver";
    parent.add(this.root);
    this.model = null;
    this.bones = {};                                   // the bones of the chains by their role: armL: [upper, lower, hand], ..., hips, head
    var rest = new Map();                              // bone -> its local rotation in the T pose
    var restScale = new Map();
    this.showHead = true;

    var V = THREE.Vector3, Q = THREE.Quaternion;
    var a = new V(), b = new V(), c = new V(), t = new V(), pole = new V(), n = new V(), u = new V(), tmp = new V(), tmp2 = new V();
    var qa = new Q(), qb = new Q(), qp = new Q();

    // a state of the hands: how far a hand has moved its grip over the wheel (rad), and the change of grip that is in progress
    var hand = {
        left: { shift: 0, from: 0, to: 0, t: 1 },
        right: { shift: 0, from: 0, to: 0, t: 1 }
    };
    this.turn = 0;                                     // the turn of the steering wheel (rad), as the model turns it: for the test in the car editor too
    this.throttle = 0;
    this.brake = 0;

    // put the model in the place of the config
    this.place = function () {
        var cfg = self.config, d = Math.PI / 180;
        self.root.position.set(cfg.position[0], cfg.position[1], cfg.position[2]);
        self.root.rotation.set(cfg.rotation[0] * d, cfg.rotation[1] * d, cfg.rotation[2] * d);
        self.root.scale.setScalar(cfg.scale > 0 ? cfg.scale : 1);
        self.root.updateMatrixWorld(true);
    };

    // the model: the scene of a glb; the bones are found by the names of the config, or by a guess for what the config does not say
    this.setModel = function (scene) {
        if (self.model) self.root.remove(self.model);
        self.model = scene;
        scene.traverse(function (o) { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; } });
        self.root.add(scene);
        self.place();
        self.resolveBones();
    };
    this.resolveBones = function () {
        var guess = OpenRacer.Driver.guessBones(self.model);
        var cfg = self.config.bones || {};
        var byName = {};
        self.model.traverse(function (o) { if (o.isBone) byName[o.name] = o; });
        var pick = function (name, fallback) { return (name && byName[name]) || fallback || null; };       // (the guess gives the bones themselves)
        ["armL", "armR", "legL", "legR"].forEach(function (key) {
            self.bones[key] = [0, 1, 2].map(function (i) { return pick(cfg[key] && cfg[key][i], guess[key] && guess[key][i]); });
        });
        self.bones.hips = pick(cfg.hips, guess.hips);
        self.bones.head = pick(cfg.head, guess.head);
        rest.clear(); restScale.clear();
        ["armL", "armR", "legL", "legR"].forEach(function (key) { self.bones[key].forEach(function (bone) { if (bone) rest.set(bone, bone.quaternion.clone()); }); });
        if (self.bones.head) restScale.set(self.bones.head, self.bones.head.scale.clone());
    };
    this.complete = function () { return ["armL", "armR", "legL", "legR"].every(function (k) { return self.bones[k] && self.bones[k].every(Boolean); }); };

    // ---- the inverse kinematics of two bones: upper, lower, end (a hand or a foot); target and pole are in the world
    function solve(chain, target, poleWorld) {
        var A = chain[0], B = chain[1], C = chain[2];
        A.quaternion.copy(rest.get(A)); B.quaternion.copy(rest.get(B));
        A.updateMatrixWorld(true);
        A.getWorldPosition(a); B.getWorldPosition(b); C.getWorldPosition(c);
        var l1 = a.distanceTo(b), l2 = b.distanceTo(c);
        if (l1 < 1e-5 || l2 < 1e-5) return;
        t.copy(target);
        u.subVectors(t, a);
        var d = u.length();
        if (d < 1e-5) return;
        u.divideScalar(d);
        var reach = Math.min(Math.max(d, Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-3);        // out of reach: the arm stretches, the hand stays on the line to the target
        // the elbow is at a distance x along the line to the target, and h to the side of it, where the pole is
        var x = (l1 * l1 - l2 * l2 + reach * reach) / (2 * reach);
        var h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
        tmp.subVectors(poleWorld, a);
        n.copy(tmp).addScaledVector(u, -tmp.dot(u));
        if (n.lengthSq() < 1e-8) n.set(0, 1, 0).addScaledVector(u, -u.y);
        n.normalize();
        var elbow = tmp2.copy(a).addScaledVector(u, x).addScaledVector(n, h);
        // turn the upper bone so that it points at the elbow, then the lower one so that it points at the end
        rotateTo(A, b.clone().sub(a), elbow.clone().sub(a));
        A.updateMatrixWorld(true);
        B.getWorldPosition(b); C.getWorldPosition(c);
        var end = a.clone().addScaledVector(u, reach);
        rotateTo(B, c.clone().sub(b), end.clone().sub(b));
        B.updateMatrixWorld(true);
    }
    // turns a bone (in the world) so that the direction "from" goes to the direction "to"
    function rotateTo(bone, from, to) {
        if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) return;
        qa.setFromUnitVectors(from.normalize(), to.normalize());                 // world
        bone.getWorldQuaternion(qb);
        qb.premultiply(qa);                                                      // the new world rotation of the bone
        if (bone.parent) { bone.parent.getWorldQuaternion(qp); qp.invert(); qb.premultiply(qp); }
        bone.quaternion.copy(qb);
    }

    // ---- the grips of the hands on the steering wheel
    var top = new V(), side = new V(), rel = new V(), axis = new V(), centre = new V();
    function wheelFrame() {
        if (!self.steering) return false;
        axis.copy(self.steering.axis).normalize();
        centre.copy(self.steering.object.position);
        // the way up on the wheel: up of the car, in the plane of the wheel
        top.set(0, 1, 0).addScaledVector(axis, -axis.y);
        if (top.lengthSq() < 1e-6) top.set(0, 0, 1);
        top.normalize();
        side.crossVectors(axis, top);
        return true;
    }
    // the angle of a grip point from the top of the wheel, about the axis (the way the wheel turns)
    function angleOf(p) {
        rel.subVectors(p, centre);
        return Math.atan2(rel.dot(side), rel.dot(top));
    }
    // the point of a grip, turned by an angle about the axis of the wheel
    function turned(p, angle, out) {
        rel.subVectors(p, centre);
        qa.setFromAxisAngle(axis, angle);
        return out.copy(rel).applyQuaternion(qa).add(centre);
    }
    function wrap(x) { while (x > Math.PI) x -= 2 * Math.PI; while (x < -Math.PI) x += 2 * Math.PI; return x; }

    var grip = { left: new V(), right: new V() }, restGrip = { left: new V(), right: new V() }, gripAngle = { left: 0, right: 0 }, gripSide = { left: 1, right: -1 };
    function readGrips() {
        var h = self.config.hands;
        restGrip.left.set(h.left[0], h.left[1], h.left[2]);
        restGrip.right.set(h.right[0], h.right[1], h.right[2]);
        if (wheelFrame()) {
            gripAngle.left = angleOf(restGrip.left); gripAngle.right = angleOf(restGrip.right);
            gripSide.left = Math.sin(gripAngle.left) >= 0 ? 1 : -1; gripSide.right = Math.sin(gripAngle.right) >= 0 ? 1 : -1;
        }
    }
    // a hand would cross the middle of the wheel (the line from the top to the bottom, to the side of the other hand): it lets go and takes the wheel again further back
    var MARGIN = 40 * Math.PI / 180, REGRIP_TIME = 0.2;
    function handsStep(dt) {
        var turn = self.turn;
        ["left", "right"].forEach(function (name) {
            var s = hand[name];
            if (s.t < 1) { s.t = Math.min(1, s.t + dt / REGRIP_TIME); if (s.t >= 1) s.shift = s.to; return; }
            var other = hand[name === "left" ? "right" : "left"];
            if (other.t < 1) return;                                          // one hand at a time
            var alpha = wrap(gripAngle[name] + turn + s.shift), sd = gripSide[name];
            var inside = sd > 0 ? (alpha >= MARGIN && alpha <= Math.PI - MARGIN) : (alpha <= -MARGIN && alpha >= -Math.PI + MARGIN);
            if (inside) return;
            // it left through the top (near 0) or the bottom (near 180 degrees): the new grip is on the other side of the horizontal, 40 degrees from it
            var throughTop = Math.abs(alpha) < Math.PI / 2;
            var target = sd * (Math.PI / 2 + (throughTop ? 1 : -1) * 35 * Math.PI / 180);
            var shift = wrap(target - (gripAngle[name] + turn)) ;
            // the shift is counted so that it goes on from the one that it had (no jump of whole turns)
            var diff = wrap(shift - s.shift);
            s.from = s.shift; s.to = s.shift + diff; s.t = 0;
        });
    }
    function gripPoint(name, out) {
        var s = hand[name];
        if (!self.steering) return out.copy(restGrip[name]);
        // during a change of grip the hand goes along the rim from the old place to the new one (not straight over the middle of the wheel), and comes off the wheel a little
        var shift = s.t < 1 ? s.from + (s.to - s.from) * (s.t * s.t * (3 - 2 * s.t)) : s.shift;
        turned(restGrip[name], self.turn + shift, out);
        if (s.t < 1) out.addScaledVector(axis, 0.06 * Math.sin(Math.PI * s.t));      // towards the driver
        return out;
    }

    // ---- the pedals: the feet go where the pedal goes
    var footPoint = new V(), pedalDir = new V();
    function footTarget(name, amount, out) {
        var f = self.config.feet, p = f[name];
        pedalDir.set(f.direction[0], f.direction[1], f.direction[2]).normalize();
        return out.set(p[0], p[1], p[2]).addScaledVector(pedalDir, f.travel * amount);
    }

    // One step: the steering (the pivot of the wheel as the game turns it, or this.turn set by hand), the pedals (0..1)
    this.update = function (dt, throttle, brake) {
        if (!self.model || !self.complete()) return;
        self.root.updateMatrixWorld(true);
        if (self.steering) {
            // the turn of the wheel: the angle of the pivot about its axis
            var q = self.steering.object.quaternion;
            var s = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z);
            self.turn = 2 * Math.atan2(q.x * self.steering.axis.x + q.y * self.steering.axis.y + q.z * self.steering.axis.z, q.w);
            if (s < 1e-9) self.turn = 0;
        }
        self.throttle = throttle === undefined ? self.throttle : throttle;
        self.brake = brake === undefined ? self.brake : brake;
        readGrips();
        if (self.steering) handsStep(dt || 0.016);
        var cfg = self.config, world = new V();
        // arms
        [["armL", "left", 1], ["armR", "right", -1]].forEach(function (e) {
            var chain = self.bones[e[0]];
            gripPoint(e[1], grip[e[1]]);
            self.parent.localToWorld(world.copy(grip[e[1]]));
            chain[0].getWorldPosition(a);
            // the elbow goes outwards and down, behind the hand
            self.parent.worldToLocal(tmp.copy(a));
            tmp.add(new V(e[2] * cfg.elbow_out, -0.5, -0.5));
            self.parent.localToWorld(pole.copy(tmp));
            solve(chain, world, pole);
        });
        // legs
        [["legL", "left", 1, self.brake], ["legR", "right", -1, self.throttle]].forEach(function (e) {
            var chain = self.bones[e[0]];
            footTarget(e[1], e[3], footPoint);
            self.parent.localToWorld(world.copy(footPoint));
            chain[0].getWorldPosition(a);
            self.parent.worldToLocal(tmp.copy(a));
            tmp.add(new V(e[2] * cfg.knee_out, 0.35, 1));
            self.parent.localToWorld(pole.copy(tmp));
            solve(chain, world, pole);
        });
        // in the cockpit the head is in the way of the camera
        var head = self.bones.head;
        if (head && restScale.has(head)) head.scale.copy(restScale.get(head)).multiplyScalar(self.showHead ? 1 : 0.001);
    };
    this.setCockpit = function (inside) { self.showHead = !inside; };
    this.dispose = function () { parent.remove(self.root); };

    // loads the glb of the driver (url): the model goes into place when it has arrived
    this.load = function (url, manager, done, fail) {
        var loader = new THREE.GLTFLoader(manager);
        loader.load(url, function (gltf) { self.setModel(gltf.scene); if (done) done(self); }, undefined, function (e) { if (fail) fail(e); });
    };
};

OpenRacer.Driver.defaults = function () {
    return {
        enabled: false, file: "", position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, bones: {},
        hands: { left: [0.15, 0.2, 0.3], right: [-0.15, 0.2, 0.3] },
        feet: { left: [0.1, -0.1, 0.5], right: [-0.1, -0.1, 0.5], travel: 0.06, direction: [0, -0.5, 0.85] },
        elbow_out: 0.5, knee_out: 0.15
    };
};
OpenRacer.Driver.withDefaults = function (c) {
    var d = OpenRacer.Driver.defaults(), out = Object.assign({}, d, c || {});
    out.hands = Object.assign({}, d.hands, (c && c.hands) || {});
    out.feet = Object.assign({}, d.feet, (c && c.feet) || {});
    out.bones = Object.assign({}, (c && c.bones) || {});
    ["position", "rotation"].forEach(function (k) { if (!Array.isArray(out[k]) || out[k].length !== 3) out[k] = d[k].slice(); });
    return out;
};

// A guess at the bones of a skeleton by their names (Blender, Rigify, Mixamo and the like): the three bones of an arm and of a leg on each side, the hips and the head
OpenRacer.Driver.guessBones = function (model) {
    var bones = [];
    model.traverse(function (o) { if (o.isBone) bones.push(o); });
    var out = { armL: [null, null, null], armR: [null, null, null], legL: [null, null, null], legR: [null, null, null], hips: null, head: null };
    var sideOf = function (name) {
        var n = name.replace(/[^A-Za-z0-9]+/g, "_");
        if (/(^|_)(l|left)(_|$)|left|(?:[a-z])L$/.test(n) || /_L(_|$)/.test(n)) return "L";
        if (/(^|_)(r|right)(_|$)|right|(?:[a-z])R$/.test(n) || /_R(_|$)/.test(n)) return "R";
        return null;
    };
    var finger = /finger|thumb|index|middle|ring|pinky|little|toe|twist|roll/i;
    // the patterns are tried in turn: the first that finds a bone on that side wins
    var find = function (side, patterns, exclude) {
        for (var i = 0; i < patterns.length; i++) {
            var found = bones.find(function (b) { return sideOf(b.name) === side && patterns[i].test(b.name) && !(exclude && exclude.test(b.name)) && !finger.test(b.name); });
            if (found) return found;
        }
        return null;
    };
    ["L", "R"].forEach(function (side) {
        out["arm" + side] = [
            find(side, [/upper.?arm/i, /(^|[^a-z])arm(?!.*(fore|lower))/i, /shoulder/i], /clav|fore|lower|hand/i),
            find(side, [/fore.?arm/i, /lower.?arm/i]),
            find(side, [/hand/i, /wrist/i])
        ];
        out["leg" + side] = [
            find(side, [/thigh/i, /upper.?leg/i, /up.?leg/i]),
            find(side, [/shin/i, /calf/i, /lower.?leg/i, /leg/i], /thigh|upper|up.?leg|foot/i),
            find(side, [/foot/i, /ankle/i])
        ];
    });
    out.hips = bones.find(function (b) { return /hips|pelvis/i.test(b.name); }) || null;
    out.head = bones.find(function (b) { return /^head|[^a-z]head$|head$/i.test(b.name) && !/end|top/i.test(b.name); }) || null;
    return out;
};
