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
 *              legR }, wheel: { position [x, y, z], rotation [x, y, z] (degrees), radius } (the ring of the hands, matched to the steering wheel of the model), poles: { armL, armR, legL, legR: [x, y, z] } (where the elbows and the knees point to; without it from elbow_out and knee_out), hands: { left [x, y, z], right }, feet: { left (the brake), right (the throttle), travel (m), direction [x, y, z] }, elbow_out, knee_out }, all in the space of
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
    this.poles = {};                                   // where the elbows and the knees point to, in the space of the body (set in the car editor, or from elbow_out and knee_out)

    var V = THREE.Vector3, Q = THREE.Quaternion;
    var a = new V(), b = new V(), c = new V(), t = new V(), pole = new V(), n = new V(), u = new V(), tmp = new V(), tmp2 = new V();
    var qa = new Q(), qb = new Q(), qp = new Q();

    // the hands: p goes from 0 (on the wheel, where the hand is on it) to 1 (at the top of the wheel) along the curve of handing over (gripPoint)
    var hand = {
        left: { last: new V(), S: new V(), p: 0 },
        right: { last: new V(), S: new V(), p: 0 }
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
        // the model turns and scales about its hips (the pivot of the gizmo is in the body, not at the feet): the model is moved so that its hips are at the origin of the driver; a driver that
        // was saved with the origin at the feet (without "pivot") is converted, so that it stays where it was
        var hips = self.bones.hips;
        if (hips) {
            self.root.updateMatrixWorld(true);
            var h = self.root.worldToLocal(hips.getWorldPosition(new V()));
            if (self.config.pivot !== "hips") {
                var cfgR = self.config.rotation, k = Math.PI / 180;
                var move = h.clone().multiplyScalar(self.config.scale > 0 ? self.config.scale : 1).applyEuler(new THREE.Euler(cfgR[0] * k, cfgR[1] * k, cfgR[2] * k, "XYZ"));
                self.config.position = [self.config.position[0] + move.x, self.config.position[1] + move.y, self.config.position[2] + move.z].map(function (v) { return Math.round(v * 1000) / 1000; });
                self.config.pivot = "hips";
            }
            scene.position.sub(h);
            self.place();
        }
        self.facing = self.measureFacing();
    };
    // which way the model faces, from where its left and right shoulders are: 1 when it faces +z (the front of the car: its left side is on +x), -1 when it faces the other way
    // (a Rigify mannequin from Blender comes in this way round), 0 when the shoulders are not found
    this.facing = 0;
    this.measureFacing = function () {
        var l = self.bones.armL && self.bones.armL[0], r = self.bones.armR && self.bones.armR[0];
        if (!l || !r) return 0;
        self.root.updateMatrixWorld(true);
        // in the space of the body of the car (+x is the left of the car)
        var pl = self.parent.worldToLocal(l.getWorldPosition(new V())), pr = self.parent.worldToLocal(r.getWorldPosition(new V()));
        var dx = pl.x - pr.x;
        return Math.abs(dx) < 1e-4 ? 0 : (dx > 0 ? 1 : -1);
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
        // the chest: the bone that the shoulders hang on and the bones of the mesh that go with it (a Rigify rig has the deform bone DEF-spine.003 and the ORG-spine.003 that the arms hang on)
        var chestBone = pick(cfg.chest, guess.chest);
        self.bones.chest = [];
        if (chestBone) {
            self.bones.chest.push(chestBone);
            var partner = byName[chestBone.name.replace(/^DEF-/, "ORG-")];
            if (partner && partner !== chestBone && /^DEF-/.test(chestBone.name)) self.bones.chest.push(partner);
        }
        rest.clear(); restScale.clear();
        self.bones.chest.forEach(function (bone) { rest.set(bone, bone.quaternion.clone()); });
        if (self.bones.head) rest.set(self.bones.head, self.bones.head.quaternion.clone());
        ["armL", "armR", "legL", "legR"].forEach(function (key) { self.bones[key].forEach(function (bone) { if (bone) rest.set(bone, bone.quaternion.clone()); }); });
        if (self.bones.head) restScale.set(self.bones.head, self.bones.head.scale.clone());
    };
    this.complete = function () { return ["armL", "armR", "legL", "legR"].every(function (k) { return self.bones[k] && self.bones[k].every(Boolean); }); };

    // ---- the chest and the head, turned as the car editor set them (rotation in degrees about the axes of the car, about the bone itself)
    var qd = new Q(), qw = new Q(), qpw = new Q(), qbody = new Q(), eul = new THREE.Euler();
    function turnBone(bone, offset) {
        bone.quaternion.copy(rest.get(bone));
        if (!offset || (Math.abs(offset[0]) + Math.abs(offset[1]) + Math.abs(offset[2]) < 1e-6)) return;
        self.model.updateMatrixWorld(true);
        var k = Math.PI / 180;
        qd.setFromEuler(eul.set(offset[0] * k, offset[1] * k, offset[2] * k, "XYZ"));
        self.parent.getWorldQuaternion(qbody);
        qd.premultiply(qbody).multiply(qbody.clone().invert());                    // the turn in the space of the car, in the world
        bone.getWorldQuaternion(qw);
        qw.premultiply(qd);
        if (bone.parent) { bone.parent.getWorldQuaternion(qpw); qpw.invert(); qw.premultiply(qpw); }
        bone.quaternion.copy(qw);
    }
    function torso() {
        var cfg = self.config;
        self.bones.chest.forEach(function (bone) { turnBone(bone, cfg.chest && cfg.chest.rotation); });
        if (self.bones.head) turnBone(self.bones.head, cfg.head && cfg.head.rotation);
        self.model.updateMatrixWorld(true);
    }

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
        var w = self.config.wheel;
        if (w && w.position) {
            // the ring that was set in the car editor: the place, the turn (the axis is its normal) and the size; it turns the same way as the steering wheel of the car
            centre.set(w.position[0], w.position[1], w.position[2]);
            var r = w.rotation || [0, 0, 0], k = Math.PI / 180;
            axis.set(0, 0, 1).applyEuler(new THREE.Euler(r[0] * k, r[1] * k, r[2] * k, "XYZ")).normalize();
            if (self.steering ? axis.dot(self.steering.axis) < 0 : axis.z > 0) axis.negate();
        } else if (self.steering) {
            axis.copy(self.steering.axis).normalize();
            centre.copy(self.steering.object.position);
        } else return false;
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
        if (!hand.left.init) { hand.left.last.copy(restGrip.left); hand.right.last.copy(restGrip.right); hand.left.init = hand.right.init = true; }
        if (wheelFrame()) {
            gripAngle.left = angleOf(restGrip.left); gripAngle.right = angleOf(restGrip.right);
            gripSide.left = Math.sin(gripAngle.left) >= 0 ? 1 : -1; gripSide.right = Math.sin(gripAngle.right) >= 0 ? 1 : -1;
        }
    }
    // How a driver turns a wheel a long way (here to the right; to the left it is the mirror image): hands at 9 and 3 o'clock turn with the wheel; the left hand rides over the top and the
    // right one down. At 130 degrees the right hand lets go and goes to the chest, out of the way of the left arm, and forward to the top (12 o'clock) where it takes the wheel when the left hand
    // is at about 4 o'clock. Then the left hand lets go and goes in one movement to the chest and to the top, to arrive a little before the end of the lock. The right hand holds on from there.
    // Everything is a function of the turn of the wheel (the hands only follow it at a limited speed), so the way back to the middle is exactly the same movement in the other direction.
    // Angles: from the top of the wheel, in the way that the wheel turns.
    var DEG = Math.PI / 180, FIRST = 130 * DEG, PULL_END = 120 * DEG, BACK = 0.24, CHEST_DOWN = 0.06, PATH_TIME = 0.6, LOCK_MARGIN = 20 * DEG;
    var chestAt = new V(), ctrl = new V(), handE = new V();
    var plan = { sign: 1, lead: "left", trail: "right", rel: { left: 0, right: 0 }, end: { left: 0, right: 0 } };
    function handsStep(dt) {
        var turn = self.turn, sign = turn >= 0 ? 1 : -1, tau = Math.abs(turn);
        // the hand that leads (goes over the top) has its rest grip before the top, in the way that the wheel turns
        var lead = sign * gripAngle.left < 0 ? "left" : "right", trail = lead === "left" ? "right" : "left";
        // the turns at which each hand lets go, and the turns at which it is at the top: the trail hand lets go at 130 degrees and takes the top when the lead hand is at 4 o'clock, the lead hand
        // lets go there and arrives at the top a little before the end of the lock
        var grab1 = Math.max(FIRST + 10 * DEG, PULL_END - sign * gripAngle[lead]);
        var lock = Math.max(150 * DEG, (self.steering && self.steering.degrees > 0 ? self.steering.degrees * DEG : 200 * DEG));
        var grab2 = Math.max(grab1 + 10 * DEG, lock - LOCK_MARGIN);
        plan.sign = sign; plan.lead = lead; plan.trail = trail;
        plan.rel[trail] = FIRST; plan.end[trail] = grab1;
        plan.rel[lead] = grab1; plan.end[lead] = grab2;
        ["left", "right"].forEach(function (name) {
            var h = hand[name];
            var target = Math.max(0, Math.min(1, (tau - plan.rel[name]) / (plan.end[name] - plan.rel[name])));
            var step = dt / PATH_TIME;
            h.p += Math.max(-step, Math.min(step, target - h.p));
        });
    }
    function gripPoint(name, out) {
        var h = hand[name];
        if (!self.steering) return out.copy(restGrip[name]);
        var sign = plan.sign;
        var tau = Math.abs(self.turn), rel = plan.rel[name], end = plan.end[name];
        if (h.p <= 0 && tau <= rel) {
            turned(restGrip[name], self.turn, out);                                        // on the wheel, where the hand is on it
            h.last.copy(out);
            return out;
        }
        // one curve through the place where the hand let go, the chest and the top (12 o'clock; it turns with the wheel after the turn at which the hand takes it), slow at both ends
        turned(restGrip[name], sign * Math.min(tau, rel), h.S);
        turned(restGrip[name], -gripAngle[name], handE);
        qa.setFromAxisAngle(axis, sign * Math.max(0, tau - end));
        handE.sub(centre).applyQuaternion(qa).add(centre);
        chestAt.copy(centre).addScaledVector(axis, BACK).addScaledVector(top, -CHEST_DOWN);
        ctrl.copy(chestAt).multiplyScalar(2).addScaledVector(h.S, -0.5).addScaledVector(handE, -0.5);
        var u = h.p * h.p * (3 - 2 * h.p), v = 1 - u;
        out.set(0, 0, 0).addScaledVector(h.S, v * v).addScaledVector(ctrl, 2 * v * u).addScaledVector(handE, u * u);
        h.last.copy(out);
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
            // (the car gives the angle itself: the quaternion cannot tell a turn of more than 360 degrees)
            var q = self.steering.object.quaternion;
            var s = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z);
            self.turn = 2 * Math.atan2(q.x * self.steering.axis.x + q.y * self.steering.axis.y + q.z * self.steering.axis.z, q.w);
            if (s < 1e-9) self.turn = 0;
            if (typeof self.steering.angle === "number") self.turn = self.steering.angle;
        }
        self.throttle = throttle === undefined ? self.throttle : throttle;
        self.brake = brake === undefined ? self.brake : brake;
        torso();
        readGrips();
        if (self.steering) handsStep(dt || 0.016);
        var cfg = self.config, world = new V();
        // the bones that are on the left of the car (+x in the space of the body) take the left hand and the left foot, whatever the model calls them (a model that faces the other way
        // has its L on the right)
        var xOf = function (chain) { chain[0].getWorldPosition(tmp2); return self.parent.worldToLocal(tmp2).x; };
        var armLeft = xOf(self.bones.armL) >= xOf(self.bones.armR) ? "armL" : "armR", legLeft = xOf(self.bones.legL) >= xOf(self.bones.legR) ? "legL" : "legR";
        // arms
        [[armLeft, "left", 1], [armLeft === "armL" ? "armR" : "armL", "right", -1]].forEach(function (e) {
            var chain = self.bones[e[0]];
            gripPoint(e[1], grip[e[1]]);
            self.parent.localToWorld(world.copy(grip[e[1]]));
            chain[0].getWorldPosition(a);
            // the elbow goes outwards and down, behind the hand (or to the node that was set in the car editor)
            var set = cfg.poles && cfg.poles[e[0]];
            if (set) tmp.set(set[0], set[1], set[2]);
            else { self.parent.worldToLocal(tmp.copy(a)); tmp.add(new V(e[2] * cfg.elbow_out, -0.5, -0.5)); }
            (self.poles[e[0]] || (self.poles[e[0]] = new V())).copy(tmp);
            self.parent.localToWorld(pole.copy(tmp));
            solve(chain, world, pole);
        });
        // legs
        [[legLeft, "left", 1, self.brake], [legLeft === "legL" ? "legR" : "legL", "right", -1, self.throttle]].forEach(function (e) {
            var chain = self.bones[e[0]];
            footTarget(e[1], e[3], footPoint);
            self.parent.localToWorld(world.copy(footPoint));
            chain[0].getWorldPosition(a);
            var setKnee = cfg.poles && cfg.poles[e[0]];
            if (setKnee) tmp.set(setKnee[0], setKnee[1], setKnee[2]);
            else { self.parent.worldToLocal(tmp.copy(a)); tmp.add(new V(e[2] * cfg.knee_out, 0.35, 1)); }
            (self.poles[e[0]] || (self.poles[e[0]] = new V())).copy(tmp);
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
        elbow_out: 0.5, knee_out: 0.15, poles: null, wheel: null, pivot: "", chest: { rotation: [0, 0, 0] }, head: { rotation: [0, 0, 0] }
    };
};
OpenRacer.Driver.withDefaults = function (c) {
    var d = OpenRacer.Driver.defaults(), out = Object.assign({}, d, c || {});
    out.hands = Object.assign({}, d.hands, (c && c.hands) || {});
    out.feet = Object.assign({}, d.feet, (c && c.feet) || {});
    out.bones = Object.assign({}, (c && c.bones) || {});
    out.poles = c && c.poles ? JSON.parse(JSON.stringify(c.poles)) : null;
    out.wheel = c && c.wheel ? JSON.parse(JSON.stringify(c.wheel)) : null;
    out.chest = { rotation: (c && c.chest && c.chest.rotation ? c.chest.rotation : [0, 0, 0]).slice() };
    out.head = { rotation: (c && c.head && c.head.rotation ? c.head.rotation : [0, 0, 0]).slice() };
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
    // the patterns are tried in turn: the first that finds a bone on that side wins. A rig with control bones (Rigify: ORG-, MCH-, _fk, _ik, tweak) has the bones that move the mesh
    // named DEF-: those are taken, not the controls, and not the twist bones (.001) between the bones of a limb
    var control = /(^|[-_.])(ORG|MCH|WGT|VIS)|tweak|_fk|_ik|master|parent|widget|pole|\.?00\d$/i;
    var find = function (side, patterns, exclude) {
        for (var i = 0; i < patterns.length; i++) {
            var candidates = bones.filter(function (b) { return sideOf(b.name) === side && patterns[i].test(b.name) && !(exclude && exclude.test(b.name)) && !finger.test(b.name); });
            if (!candidates.length) continue;
            var rank = function (b) { return /^DEF-/.test(b.name) && !control.test(b.name) ? 0 : (control.test(b.name) ? 2 : 1); };
            candidates.sort(function (x, y) { return rank(x) - rank(y); });
            return candidates[0];
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
    out.chest = bones.find(function (b) { return /^DEF-spine\.?003$/i.test(b.name); }) || bones.find(function (b) { return /(^|[^a-z])(chest|upper.?body|torso)/i.test(b.name) && !control.test(b.name); }) ||
        bones.find(function (b) { return /spine\.?0?(2|1)$/i.test(b.name) && !control.test(b.name); }) || null;
    out.hips = bones.find(function (b) { return /^DEF-spine$/i.test(b.name); }) || bones.find(function (b) { return /hips|pelvis/i.test(b.name) && !control.test(b.name); }) || bones.find(function (b) { return /hips|pelvis/i.test(b.name); }) || null;
    // the head: Rigify has a control "head" and the deform bone DEF-spine.006 that moves the mesh (only that one hides the head in the cockpit view)
    out.head = bones.find(function (b) { return /^DEF-spine\.?006$/i.test(b.name) || /^DEF-head$/i.test(b.name); }) ||
        bones.find(function (b) { return /^head|[^a-z]head$|head$/i.test(b.name) && !/end|top/i.test(b.name) && !control.test(b.name); }) ||
        bones.find(function (b) { return /^head|[^a-z]head$|head$/i.test(b.name) && !/end|top/i.test(b.name); }) || null;
    return out;
};
