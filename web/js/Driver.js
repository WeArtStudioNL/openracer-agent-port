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
        left: { last: new V(), S: new V(), p: 0, delta: 0 },
        right: { last: new V(), S: new V(), p: 0, delta: 0 }
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
        fingerRest.clear();
        self.model = scene;
        scene.traverse(function (o) { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; } });
        self.root.add(scene);
        self.place();
        self.resolveBones();
        installTorsoCull(scene);
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
        findFingers();
    };
    // ---- the fingers: every bone below a hand, except the bones of the palm, turns about its local x axis (the way a Blender rig is made: all the joints of a finger close by turning
    // 65 degrees about their local x; the thumb the same). grip_curl "x" or "-x" is the way round.
    var CURL_DEGREES = 65;
    this.fingers = { armL: [], armR: [] };
    var fingerRest = new Map();                        // finger bone -> its local rotation in the pose of the model (open)
    function findFingers() {
        self.fingers = { armL: [], armR: [] };
        if (!self.model) return;
        fingerRest.forEach(function (q, bone) { bone.quaternion.copy(q); });                  // (open again, whatever the grip was)
        self.root.updateMatrixWorld(true);
        var axisX = new V(self.config.grip_curl === "-x" ? -1 : 1, 0, 0);
        ["armL", "armR"].forEach(function (key) {
            var hand = self.bones[key] && self.bones[key][2];
            if (!hand) return;
            // a rig with control bones (Rigify) has the fingers that move the mesh named DEF-: those curl, the controls are passed over
            var deform = false;
            hand.traverse(function (o) { if (o.isBone && /^DEF-.*(f_|finger|thumb)/i.test(o.name)) deform = true; });
            var walk = function (bone, depth, thumb) {
                var kids = bone.children.filter(function (k) { return k.isBone; });
                var isPalm = /palm|meta/i.test(bone.name) && depth === 0;
                if (!isPalm && bone !== hand && !(deform && !/^DEF-/.test(bone.name))) {
                    self.fingers[key].push({ bone: bone, depth: depth, thumb: thumb, axis: axisX, rest: fingerRest.get(bone) || fingerRest.set(bone, bone.quaternion.clone()).get(bone) });
                    depth++;
                } else if (isPalm) depth = 0;
                kids.forEach(function (k) { walk(k, depth, thumb || /thumb/i.test(k.name)); });
            };
            walk(hand, 0, false);
        });
    }
    this.refreshFingers = findFingers;
    var qf = new Q();
    // closes the fingers of a hand (0 open, 1 closed)
    function curl(key, amount) {
        (self.fingers[key] || []).forEach(function (f) {
            f.bone.quaternion.copy(f.rest).multiply(qf.setFromAxisAngle(f.axis, CURL_DEGREES * DEG_TO_RAD * amount));
        });
    }
    var DEG_TO_RAD = Math.PI / 180;
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
    // the turn of the chest and of the head (degrees): as the car editor set them, or from the keys when there are some (see the keyframes below)
    this.torsoPose = { chest: [0, 0, 0], head: [0, 0, 0] };
    this.posture = null;                                 // the posture of a rider on a motorcycle (Motorcycle.js), set by update()
    var postureOff = new V();
    // the rider is moved on the bike (the hands and the feet stay on the grips and the pegs: the arms and the legs follow)
    function applyPosture() {
        var p = self.posture;
        self.root.position.sub(postureOff);
        if (p) postureOff.set((p.lat + (p.assist || 0)) * 0.7, p.drop * 0.7, p.long * 0.7); else postureOff.set(0, 0, 0);
        self.root.position.add(postureOff);
    }
    this.headSign = 1;      // (the sign of the roll of the bike in the roll of the bones)
    function torso() {
        var cfg = self.config;
        if (!headUp && self.bones.head) {      // (the first time, with the bike upright and the head as the model has it: the up of the head in its own space is the up of the bike)
            self.parent.updateMatrixWorld(true); self.model.updateMatrixWorld(true);
            headUp = new V(0, 1, 0).transformDirection(self.parent.matrixWorld).transformDirection(new THREE.Matrix4().copy(self.bones.head.matrixWorld).invert());
        }
        ["chest", "head"].forEach(function (name) { self.torsoPose[name] = torsoKeyRot(name, self.turn) || (cfg[name] && cfg[name].rotation) || [0, 0, 0]; });
        // a rider of a motorcycle: flat on the tank on the throttle, back on the brake, and over to the inside of a bend (the posture of Motorcycle.js)
        var post = self.posture;
        if (post) {
            var pitch = 28 * post.tuck - 10 * post.sit, roll = -14 * (post.lat / 0.3);
            roll += 0.35 * (post.push || 0) * (post.lean || 0) / DEG;      // (flat track: the body stays more upright than the bike, which leans under it: the trunk leans out of the bike by a share of its lean)
            var c = self.torsoPose.chest, h = self.torsoPose.head;
            self.torsoPose.chest = [c[0] + pitch, c[1], c[2] + roll];
            // (the head turned into the bend, about the vertical)
            self.torsoPose.head = [h[0] - 0.7 * pitch, h[1] + 35 * (post.look || 0), h[2] - 0.6 * roll];
            // flat track: the head stays upright to the road whatever the bike and the trunk do: it only turns about the vertical, to look along the way (a little ahead into the bend). The roll of
            // the head is not worked out from the rotations of the bones (a chest of several bones, a model with its own rest turn): it is measured (headRoll: how far the head leans from the vertical
            // across the bike, in degrees) and taken out step by step, with the sign and the size of the effect of the roll of the bone found once (headSlope).
            var flat = post.flat || 0;
            self.torsoPose.head = [h[0] - 0.7 * pitch - flat * 0.3 * pitch, h[1] + 35 * (post.look || 0), h[2] - 0.6 * roll + flat * headFix];
        }
        self.bones.chest.forEach(function (bone) { turnBone(bone, self.torsoPose.chest); });
        if (self.bones.head) turnBone(self.bones.head, self.torsoPose.head);
        self.model.updateMatrixWorld(true);
        if (post && self.bones.head && (post.flat || 0) > 0.001) {
            if (headSlope === null) probeHead(post);
            if (headSlope) { var err = headRoll(); headFix = Math.max(-90, Math.min(90, headFix - 0.6 * err / headSlope)); }
        } else headFix *= 0.9;
    }
    // the lean of the head across the bike from the vertical of the world (degrees, to the left of the bike positive): where its up is, from where it was at rest
    this.headRollNow = function () { return headRoll(); };      // (for the tests: how far the head leans from the vertical, in degrees)
    var headFix = 0, headSlope = null, headUp = null, hUp = new V(), hLeft = new V();
    function headRoll() {
        var head = self.bones.head;
        if (!headUp) return 0;
        head.updateMatrixWorld(true);
        hUp.copy(headUp).transformDirection(head.matrixWorld); hLeft.set(1, 0, 0).transformDirection(self.parent.matrixWorld); hLeft.y = 0; if (hLeft.lengthSq() < 1e-6) return 0; hLeft.normalize();
        return Math.atan2(hUp.x * hLeft.x + hUp.z * hLeft.z, hUp.y) / DEG;
    }
    // once: which way the roll of the head bone goes in the world (a probe of plus and minus ten degrees), and the up of the head in its own space
    function probeHead(post) {
        var head = self.bones.head, keep = self.torsoPose.head.slice(), world = new V(0, 1, 0);
        self.parent.updateMatrixWorld(true);
        var bikeUp = new V(0, 1, 0).transformDirection(self.parent.matrixWorld);
        var probe = function (z) { turnBone(head, [keep[0], keep[1], keep[2] + z]); self.model.updateMatrixWorld(true); return headRoll(); };
        var r1 = probe(10), r2 = probe(-10);
        turnBone(head, keep); self.model.updateMatrixWorld(true);
        headSlope = (r1 - r2) / 20;
        if (!(Math.abs(headSlope) > 0.2)) headSlope = 0;
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
    function wrap(x) { return isFinite(x) ? Math.atan2(Math.sin(x), Math.cos(x)) : 0; }      // (no loop: an infinite angle kept it going for ever)

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
    function planFor(turn) {
        var sign = turn >= 0 ? 1 : -1;
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
        plan.lock = lock;
    }
    function targetP(name, tau) { return Math.max(0, Math.min(1, (tau - plan.rel[name]) / (plan.end[name] - plan.rel[name]))); }
    function handsStep(dt) {
        planFor(self.turn);
        var tau = Math.abs(self.turn);
        ["left", "right"].forEach(function (name) {
            var h = hand[name];
            var step = dt / PATH_TIME;
            h.p += Math.max(-step, Math.min(step, targetP(name, tau) - h.p));
        });
    }

    // ---- the keyframes: the movement of each hand as the car editor set it. A key is at a turn of the steering wheel (t, degrees, from 0 to the lock) and holds the place of the hand (pos), its
    // turn (rot: degrees, in the space of the car), the grip (0..1) and whether it rides the wheel (wheel: the place and the turn are then those at the middle, and go round with the wheel,
    // the way a hand that holds the rim does; otherwise they are fixed in the car). The hand goes through the places of the keys (a smooth curve), turns from one key to the next and
    // opens or closes its fingers. A key is at a place of the steering slider of the car editor (t: from -lock to +lock; the turn of the wheel is minus that). The way back to the middle is the
    // same movement the other way, because everything is a function of the turn.
    var keyTmp = new V(), keyQ = new Q(), keyQ2 = new Q(), keyEul = new THREE.Euler();
    this.handPose = { left: { pos: new V(), quat: new Q(), grip: 0, keyed: false }, right: { pos: new V(), quat: new Q(), grip: 0, keyed: false } };
    var baking = false;
    this.keysActive = function () { if (baking) return false; var k = self.config.keys; return !!(k && ((k.left && k.left.length) || (k.right && k.right.length))); };
    function keyAnchor(k, angle, outPos, outQuat) {
        outPos.set(k.pos[0], k.pos[1], k.pos[2]);
        if (k.wheel) { turned(keyTmp.copy(outPos), angle, outPos); outQuat.setFromAxisAngle(axis, angle); } else outQuat.identity();
        var r = k.rot || [0, 0, 0];
        outQuat.multiply(keyQ2.setFromEuler(keyEul.set(r[0] * DEG, r[1] * DEG, r[2] * DEG, "XYZ")));
    }
    var anchors = [new V(), new V(), new V(), new V()], anchorQ = [new Q(), new Q()];
    // the pose of a hand with a turn of the wheel; returns false when there are no keys
    function keyPose(name, turn, outPos, outQuat) {
        var keys = self.config.keys, list = keys && keys[name];
        if (!list || !list.length) return false;
        var at = -turn / DEG, n = list.length, i = 0;                                        // (the place of the steering slider)
        while (i < n - 1 && at >= list[i + 1].t) i++;
        var u = 0;
        if (at > list[0].t && i < n - 1) u = (at - list[i].t) / (list[i + 1].t - list[i].t);
        var j = Math.min(i + 1, n - 1), i0 = Math.max(i - 1, 0), i3 = Math.min(i + 2, n - 1);
        keyAnchor(list[i0], turn, anchors[0], keyQ); keyAnchor(list[i], turn, anchors[1], anchorQ[0]); keyAnchor(list[j], turn, anchors[2], anchorQ[1]); keyAnchor(list[i3], turn, anchors[3], keyQ);
        var p0 = anchors[0], p1 = anchors[1], p2 = anchors[2], p3 = anchors[3], u2 = u * u, u3 = u2 * u;
        outPos.set(0, 0, 0);
        outPos.addScaledVector(p0, 0.5 * (-u3 + 2 * u2 - u)).addScaledVector(p1, 0.5 * (3 * u3 - 5 * u2 + 2)).addScaledVector(p2, 0.5 * (-3 * u3 + 4 * u2 + u)).addScaledVector(p3, 0.5 * (u3 - u2));
        var su = u2 * (3 - 2 * u);
        outQuat.copy(anchorQ[0]).slerp(anchorQ[1], su);
        var grip = list[i].grip + (list[j].grip - list[i].grip) * su;
        return grip;
    }
    // the turn of the chest or the head from its keys; null when there are no keys
    function torsoKeyRot(name, turn) {
        var list = self.config.keys && self.config.keys[name];
        if (!list || !list.length) return null;
        var at = -turn / DEG, n = list.length, i = 0;
        while (i < n - 1 && at >= list[i + 1].t) i++;
        var u = 0;
        if (at > list[0].t && i < n - 1) u = (at - list[i].t) / (list[i + 1].t - list[i].t);
        var j = Math.min(i + 1, n - 1), su = u * u * (3 - 2 * u), qa0 = new Q(), qb0 = new Q();
        qa0.setFromEuler(keyEul.set(list[i].rot[0] * DEG, list[i].rot[1] * DEG, list[i].rot[2] * DEG, "XYZ"));
        qb0.setFromEuler(keyEul.set(list[j].rot[0] * DEG, list[j].rot[1] * DEG, list[j].rot[2] * DEG, "XYZ"));
        qa0.slerp(qb0, su);
        keyEul.setFromQuaternion(qa0, "XYZ");
        return [keyEul.x / DEG, keyEul.y / DEG, keyEul.z / DEG];
    }
    // sets the key of the chest or the head at a turn of the wheel (degrees); rot in degrees, in the space of the car
    this.setTorsoKey = function (name, tDeg, rot) {
        var keys = self.config.keys || (self.config.keys = { left: [], right: [] });
        var list = keys[name] || (keys[name] = []);
        var at = -1;
        list.forEach(function (k, i) { if (Math.abs(k.t - tDeg) < 0.75) at = i; });
        var key = { t: at >= 0 ? list[at].t : Math.round(tDeg * 10) / 10, rot: rot.map(function (v) { return Math.round(v * 10) / 10; }) };
        if (at >= 0) list[at] = key; else { list.push(key); list.sort(function (a, b) { return a.t - b.t; }); }
        return key;
    };
    this.keysAny = function () { var k = self.config.keys; return !!(k && ["left", "right", "chest", "head"].some(function (n) { return k[n] && k[n].length; })); };
    // is a place on the rim of the wheel (where a hand rides)
    function onRim(pos, name) {
        rel.subVectors(pos, centre);
        var along = rel.dot(axis);
        rel.addScaledVector(axis, -along);
        rim.subVectors(restGrip[name], centre);
        rim.addScaledVector(axis, -rim.dot(axis));
        return Math.abs(rel.length() - rim.length()) < 0.04 && Math.abs(along) < 0.05;
    }
    var rim = new V();
    var round3 = function (v) { return Math.round(v * 1000) / 1000; };
    // sets (or replaces) the key of a hand at a turn of the wheel (degrees, on the side that the keys are set for): from the place (car space), the turn (a quaternion) and the grip
    this.setKey = function (side, tDeg, pos, quat, gripAmount, wheelFlag) {
        if (!wheelFrame()) return null;
        var keys = self.config.keys || (self.config.keys = { left: [], right: [] });
        var list = keys[side] || (keys[side] = []);
        var at = -1;
        list.forEach(function (k, i) { if (Math.abs(k.t - tDeg) < 0.75) at = i; });
        var wheel = wheelFlag !== undefined ? wheelFlag : (at >= 0 ? list[at].wheel : onRim(pos, side));
        var angle = -tDeg * DEG, p = pos.clone(), q = quat.clone();
        if (wheel) { turned(p, -angle, p); q.premultiply(new Q().setFromAxisAngle(axis, -angle)); }
        var e = new THREE.Euler().setFromQuaternion(q, "XYZ");
        var key = { t: at >= 0 ? list[at].t : Math.round(tDeg * 10) / 10, pos: [round3(p.x), round3(p.y), round3(p.z)], rot: [e.x / DEG, e.y / DEG, e.z / DEG].map(function (v) { return Math.round(v * 10) / 10; }), grip: round3(Math.max(0, Math.min(1, gripAmount || 0))), wheel: wheel };
        if (at >= 0) list[at] = key; else { list.push(key); list.sort(function (a, b) { return a.t - b.t; }); }
        return key;
    };
    this.removeKey = function (side, tDeg) {
        var list = self.config.keys && self.config.keys[side];
        if (!list) return;
        for (var i = list.length - 1; i >= 0; i--) if (Math.abs(list[i].t - tDeg) < 0.75) list.splice(i, 1);
        if (!self.keysAny()) self.config.keys = null;
    };
    this.keyAt = function (side, tDeg) {
        var list = self.config.keys && self.config.keys[side];
        return (list || []).filter(function (k) { return Math.abs(k.t - tDeg) < 0.75; })[0] || null;
    };
    // The keys of the side with the positive turns of the steering slider (t above 0, and the key at 0) are put on the other side as a mirror image: the keys at a negative t are replaced by the
    // ones of the other hand (left becomes right) mirrored about the plane through the middle of the wheel, and the turns of the chest and the head mirrored. Gives the number of keys that were made.
    this.mirrorKeys = function () {
        var keys = self.config.keys;
        if (!keys) return 0;
        readGrips();
        var plane = 2 * centre.x, made = 0;                  // (the plane through the middle of the wheel: the hands that ride the wheel turn about it)
        var reflect = function (rot) {
            var q = new Q().setFromEuler(new THREE.Euler(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG, "XYZ"));
            q.y = -q.y; q.z = -q.z;
            var e = new THREE.Euler().setFromQuaternion(q, "XYZ");
            return [e.x / DEG, e.y / DEG, e.z / DEG].map(function (v) { return Math.round(v * 10) / 10; });
        };
        var source = { left: (keys.left || []).filter(function (k) { return k.t > 0; }), right: (keys.right || []).filter(function (k) { return k.t > 0; }), chest: (keys.chest || []).filter(function (k) { return k.t > 0; }), head: (keys.head || []).filter(function (k) { return k.t > 0; }) };
        ["left", "right", "chest", "head"].forEach(function (name) { keys[name] = (keys[name] || []).filter(function (k) { return k.t >= 0; }); });
        [["left", "right"], ["right", "left"], ["chest", "chest"], ["head", "head"]].forEach(function (pair) {
            source[pair[0]].forEach(function (k) {
                var copy = { t: -k.t, rot: reflect(k.rot || [0, 0, 0]) };
                if (k.pos) { copy.pos = [Math.round((plane - k.pos[0]) * 1000) / 1000, k.pos[1], k.pos[2]]; copy.grip = k.grip; copy.wheel = k.wheel; }
                keys[pair[1]].push(copy);
                made++;
            });
        });
        ["left", "right", "chest", "head"].forEach(function (name) { keys[name].sort(function (a, b) { return a.t - b.t; }); });
        return made;
    };

    // keys from the automatic movement (the hand over): a start for the keys that are then set by hand
    this.bakeKeys = function () {
        readGrips();
        if (!wheelFrame()) return false;
        var savedTurn = self.turn, savedP = { left: hand.left.p, right: hand.right.p };
        self.config.keys = { left: [], right: [] };
        baking = true;
        planFor(-1e-3);
        var lock = plan.lock / DEG;
        var times = [0, 100, 130, 150, 170, 190, 210, 240, 290, 340, 390, Math.round(lock - LOCK_MARGIN / DEG)].filter(function (t, i, a) { return t <= lock && a.indexOf(t) === i; });
        times = times.concat(times.filter(function (t) { return t > 0; }).map(function (t) { return -t; })).sort(function (a, b) { return a - b; });
        var out = new V(), cfg = self.config;
        times.forEach(function (t) {
            self.turn = -t * DEG;
            planFor(self.turn);
            ["left", "right"].forEach(function (name) {
                var h = hand[name], tau = Math.abs(t) * DEG;
                h.p = targetP(name, tau);
                gripPoint(name, out);
                var wheel = (h.p <= 0 && tau <= plan.rel[name]) || (h.p >= 1 && tau > plan.end[name]);
                var rot = (cfg.hands.rotation && cfg.hands.rotation[name]) || [0, 0, 0];
                var q = new Q().setFromAxisAngle(axis, h.delta).multiply(new Q().setFromEuler(new THREE.Euler(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG, "XYZ")));
                self.setKey(name, t, out, q, (cfg.hands.grip && cfg.hands.grip[name]) || 0, wheel);
            });
        });
        baking = false;
        ["chest", "head"].forEach(function (name) { self.setTorsoKey(name, 0, ((cfg[name] && cfg[name].rotation) || [0, 0, 0]).slice()); });
        self.turn = savedTurn;
        hand.left.p = savedP.left; hand.right.p = savedP.right;
        return true;
    };
    function gripPoint(name, out) {
        var h = hand[name];
        if (!self.steering) { h.delta = 0; return out.copy(restGrip[name]); }
        if (self.keysActive()) {
            // the movement that was set by hand
            var pose = self.handPose[name], g = keyPose(name, self.turn, pose.pos, pose.quat);
            if (g !== false) { pose.grip = g; pose.keyed = true; h.last.copy(pose.pos); return out.copy(pose.pos); }
        }
        self.handPose[name].keyed = false;
        var sign = plan.sign;
        var tau = Math.abs(self.turn), rel = plan.rel[name], end = plan.end[name];
        if (h.p <= 0 && tau <= rel) {
            turned(restGrip[name], self.turn, out);                                        // on the wheel, where the hand is on it
            h.delta = self.turn;
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
        // the hand turns about the middle of the wheel as it goes round: from the turn that it had where it let go to the turn that it has at the top (the short way)
        var d0 = sign * Math.min(tau, rel), d1 = -gripAngle[name] + sign * Math.max(0, tau - end);
        h.delta = d0 + wrap(d1 - d0) * u;
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
    // ---- a rider on a motorcycle: when the body of the car has the places that a rider takes (found by name: grip_L, grip_R, footpeg_L, footpeg_R, and frontbrake_R, clutch_L and shifter_L
    // when it has them) the driver does not hold a steering wheel and work two pedals but sits on the bike:
    //   - the hands are on grip_L and grip_R, turn with them (the steering turns the handlebar about the axis of the fork, and the hands go round with it) and the right wrist rolls with the
    //     throttle (grip_R is turned by the gas);
    //   - the fingers, but not the thumb, are not round the grip but at the lever: the right ones at frontbrake_R (they close a little with the brake), the left ones at clutch_L (they pull
    //     the lever with every shift);
    //   - the feet are on the footpegs; the left foot goes with the shift lever (shifter_L), which turns with every shift: the first gear is a tap down, every gear above it a tap up,
    //     and neutral, between the first and the second, a small tap, up from the first gear and down from the second.
    var rider = null, riderTried = false;
    var riderRest = null;
    var shiftState = { gear: null, neutral: null, time: 9, amp: 0, angle: 0 };
    var SHIFT_FULL = 0.34, SHIFT_HALF = 0.13, SHIFT_UP = 0.07, SHIFT_BACK = 0.2, THROTTLE_ROLL = 0.75;
    var rw = new V(), rl = new V(), rq1 = new Q(), rq2 = new Q(), rq3 = new Q(), rAxisX = new V(1, 0, 0);
    function findRider() {
        var get = function (name) { return self.parent.getObjectByName(name) || null; };
        var r = { gripL: get("grip_L"), gripR: get("grip_R"), pegL: get("footpeg_L"), pegR: get("footpeg_R"), brake: get("frontbrake_R"), clutch: get("clutch_L"), shifter: get("shifter_L") };
        return r.gripL && r.gripR && r.pegL && r.pegR ? r : null;
    }
    // the place of an object in the space of the body of the car (the parent of the driver)
    function bodyPos(object, out) { object.getWorldPosition(rw); return self.parent.worldToLocal(out.copy(rw)); }
    function bodyQuat(object, out) {
        object.getWorldQuaternion(out);
        self.parent.getWorldQuaternion(rq1);
        return out.premultiply(rq1.invert());
    }
    function farthestPoint(object) {
        var best = new V(), most = 0;
        object.traverse(function (o) {
            if (!o.isMesh || !o.geometry.attributes.position) return;
            var p = o.geometry.attributes.position, tmpv = new V();
            for (var i = 0; i < p.count; i++) { tmpv.fromBufferAttribute(p, i); if (tmpv.lengthSq() > most) { most = tmpv.lengthSq(); best.copy(tmpv); } }
        });
        return best;
    }
    function recordRest() {
        var r = riderRest = { pos: {}, quat: {}, local: {}, tip: null, tipAt: new V() };
        ["gripL", "gripR"].forEach(function (k) {
            r.pos[k] = bodyPos(rider[k], new V());
            r.quat[k] = bodyQuat(rider[k], new Q());
            r.local[k] = rider[k].quaternion.clone();
        });
        r.pos.brake = rider.brake ? bodyPos(rider.brake, new V()) : null;
        r.pos.clutch = rider.clutch ? bodyPos(rider.clutch, new V()) : null;
        // the levers turn when they are pulled: about an axis up through their hinge, the inboard end of the lever (its vertex nearest the middle of the bike: the perch is there, and the
        // origin of a lever is where the fingers go, not its hinge), by LEVER_PULL at a full pull, the tip towards the rider
        r.lever = {};
        ["brake", "clutch"].forEach(function (k) {
            var lever = rider[k];
            if (!lever) return;
            lever.updateMatrixWorld(true);
            var hinge = null, best = Infinity, tmpv = new V();
            lever.traverse(function (o) {
                if (!o.isMesh || !o.geometry.attributes.position) return;
                var pa = o.geometry.attributes.position;
                for (var i = 0; i < pa.count; i++) {
                    tmpv.fromBufferAttribute(pa, i); o.localToWorld(tmpv); self.parent.worldToLocal(tmpv);
                    if (Math.abs(tmpv.x) < best) { best = Math.abs(tmpv.x); hinge = tmpv.clone(); }
                }
            });
            if (!hinge) return;
            var up = new V(0, 1, 0);
            lever.parent.getWorldQuaternion(rq1); self.parent.getWorldQuaternion(rq2);
            var toLever = rq1.invert().multiply(rq2);                                   // body frame to the frame of the parent of the lever
            self.parent.localToWorld(hinge); lever.worldToLocal(hinge);                 // the hinge in the lever's own frame
            r.lever[k] = { pos: lever.position.clone(), quat: lever.quaternion.clone(), hinge: hinge, axis: up.applyQuaternion(toLever).applyQuaternion(lever.quaternion.clone().invert()).normalize(), side: bodyPos(lever, new V()).x >= 0 ? 1 : -1 };
        });
        if (rider.shifter) {
            rider.shifter.updateMatrixWorld(true);
            r.local.shifter = rider.shifter.quaternion.clone();
            r.tip = farthestPoint(rider.shifter);
            rider.shifter.updateMatrixWorld(true);
            r.tipAt = bodyPos2(rider.shifter, r.tip, new V());
        }
    }
    function bodyPos2(object, local, out) { object.localToWorld(rw.copy(local)); return self.parent.worldToLocal(out.copy(rw)); }
    // a shift of the gear: the shift lever gets a tap (a pulse: it goes quickly to the angle and comes back more slowly)
    function shiftEvents(g, neutral) {
        if (shiftState.gear === null) { shiftState.gear = g; shiftState.neutral = neutral; return; }
        var s = shiftState, amp = 0;
        if (neutral !== s.neutral) amp = neutral ? (s.gear === 0 ? -SHIFT_HALF : SHIFT_HALF) : (g === 0 ? SHIFT_FULL : -SHIFT_FULL);      // (the angle: plus is a tap down, minus a tap up)
        else if (!neutral && g !== s.gear) amp = g > s.gear ? -SHIFT_FULL : SHIFT_FULL;
        if (amp) { s.amp = amp; s.time = 0; }
        s.gear = g; s.neutral = neutral;
    }
    function shiftAngle(dt) {
        var s = shiftState;
        s.time += dt;
        var k = s.time < SHIFT_UP ? (s.time / SHIFT_UP) : Math.max(0, 1 - (s.time - SHIFT_UP) / SHIFT_BACK);
        k = k * k * (3 - 2 * Math.min(1, k));
        s.angle = s.amp * k;
        s.pull = s.time < SHIFT_UP + SHIFT_BACK ? Math.sin(Math.PI * Math.min(1, s.time / (SHIFT_UP + SHIFT_BACK))) : 0;          // the clutch hand pulls while the lever moves
        return s.angle;
    }
    var LEVER_PULL = 0.3;         // rad: a lever at a full pull
    function pullLever(k, amount) {
        var L = riderRest.lever && riderRest.lever[k], lever = rider[k];
        if (!L || !lever) return;
        rq2.setFromAxisAngle(L.axis, L.side * LEVER_PULL * amount);
        lever.quaternion.copy(L.quat).multiply(rq2);
        rw.copy(L.hinge).applyQuaternion(rq2).sub(L.hinge).negate().applyQuaternion(L.quat);     // the hinge stays where it is
        lever.position.copy(L.pos).add(rw);
    }
    var riderTip = new V(), riderHand = new V();
    // the fingers of a hand: the thumb round the grip, the others open (a little closed) and pointing at the lever
    function fingersAtLever(key, chain, leverPos, curlAmount) {
        var list = self.fingers[key] || [];
        list.forEach(function (f) { f.bone.quaternion.copy(f.rest).multiply(qf.setFromAxisAngle(f.axis, CURL_DEGREES * DEG_TO_RAD * (f.thumb ? 0.9 : curlAmount))); });
        chain[2].updateMatrixWorld(true);
        if (!leverPos) return;
        // The middle finger is the base: its root bone is turned about its local x axis (the axis that all the fingers close about, as at a grip) to the angle at which the finger points
        // best at the lever, and that angle is added to the roots of all the other fingers, not the thumb: they do not all point at the one place, they close together
        var roots = list.filter(function (f) { return !f.thumb && f.depth === 0; });
        if (!roots.length) return;
        var base = roots.filter(function (f) { return /middle|mid|f_?2|finger.?2/i.test(f.bone.name); })[0] || roots.slice().sort(function (x, y) { return x.bone.name < y.bone.name ? -1 : 1; })[Math.min(1, roots.length - 1)];
        var child = base.bone.children.filter(function (k) { return k.isBone; })[0];
        if (!child) return;
        var target = self.parent.localToWorld(leverPos.clone()), p0 = new V(), p1 = new V(), want = new V();
        var start = base.bone.quaternion.clone(), best = 0, bestAngle = 1e9;
        for (var step = -14; step <= 14; step++) {
            var theta = step * 0.1;
            base.bone.quaternion.copy(start).multiply(qf.setFromAxisAngle(base.axis, theta));
            base.bone.updateMatrixWorld(true);
            base.bone.getWorldPosition(p0); child.getWorldPosition(p1);
            want.copy(target).sub(p0);
            var angle = p1.clone().sub(p0).angleTo(want);
            if (angle < bestAngle) { bestAngle = angle; best = theta; }
        }
        base.bone.quaternion.copy(start);
        roots.forEach(function (f) {
            f.bone.quaternion.multiply(qf.setFromAxisAngle(f.axis, best));
            f.bone.updateMatrixWorld(true);
        });
    }

    // the offset of a hand from its grip (hands.offset.left / right, metres, in the frame of the grip)
    var offsetTmp = new V();
    function handOffset(side) {
        var o = self.config.hands.offset && self.config.hands.offset[side];
        return offsetTmp.set(o ? o[0] || 0 : 0, o ? o[1] || 0 : 0, o ? o[2] || 0 : 0);
    }
    // the same for a foot: the pivot is the peg and an offset from it (feet.offset.left / right, in the frame of the peg)
    var footTmp = new V(), footW = new V(), footL = new V(), footF = new V(), footA = new V(), footB = new V(), footC = new V(), feetDown = {}, FOOT_ANKLE = 0.09, FOOT_LEN = 0.27, toeFwd = new V(), toeDir = new V();       // (how far down each foot is, the height of the ankle over the road when the foot stands on its toes)
    function footOffset(side) {
        var o = self.config.feet.offset && self.config.feet.offset[side];
        return footTmp.set(o ? o[0] || 0 : 0, o ? o[1] || 0 : 0, o ? o[2] || 0 : 0);
    }
    this.footPivot = function (side, out) {
        if (!self.isRider()) return null;
        self.parent.updateMatrixWorld(true);
        rider[side === "left" ? "pegL" : "pegR"].localToWorld(rw.copy(footOffset(side)));
        return out.copy(self.parent.worldToLocal(rw));
    };
    this.setFootPivot = function (side, point) {
        if (!self.isRider()) return false;
        self.parent.updateMatrixWorld(true);
        var peg = rider[side === "left" ? "pegL" : "pegR"], local = peg.worldToLocal(self.parent.localToWorld(point.clone()));
        var r = function (v) { return Math.round(v * 1000) / 1000; };
        if (!self.config.feet.offset) self.config.feet.offset = { left: [0, 0, 0], right: [0, 0, 0] };
        self.config.feet.offset[side] = [r(local.x), r(local.y), r(local.z)];
        return true;
    };
    // for the car editor: is the driver a rider (the body has the grips and the pegs); the pivot of a hand in the space of the body (the grip and the offset), and a place in that space made
    // the offset of the hand (so that the hand of the editor sits on its grip, and what is moved away from it is the offset)
    // (the body can load after the driver, so a driver that found no grips looks again, every half second)
    var riderTriedAt = -1e9, riderFound = null;
    function under(object, root) { for (var o = object; o; o = o.parent) if (o === root) return true; return false; }
    this.isRider = function () {
        var now = performance.now();
        // (the parts found before may be gone: the car editor loaded another bike, or took the parts into another frame)
        if (rider && now - riderTriedAt > 500) { riderTriedAt = now; if (!under(rider.gripL, self.parent) || !under(rider.pegL, self.parent)) { rider = null; riderRest = null; } }
        if (!rider) {
            if (!riderTried || now - riderTriedAt > 500) { riderTried = true; riderTriedAt = now; rider = findRider(); if (rider) migratePivots(); }
        }
        return !!rider;
    };
    // A driver that was set up before the bike was a rider has the pivots of the hands and the feet as places in the body (hands.left, feet.left, ...) and no offsets: when those are near the
    // grips and the pegs (within 35 cm) they become the offsets, so that the hands and the feet stay where they were
    function migratePivots() {
        var cfg = self.config, zero = function (o) { return !o || (!o.left || !o.left.some(Boolean)) && (!o.right || !o.right.some(Boolean)); };
        if (!zero(cfg.hands.offset) || !zero(cfg.feet.offset)) return;
        self.parent.updateMatrixWorld(true);
        var near = function (obj, p) { return p && p.length === 3 && self.parent.worldToLocal(obj.getWorldPosition(new V())).distanceTo(new V(p[0], p[1], p[2])) < 0.35; };
        var ok = near(rider.gripL, cfg.hands.left) && near(rider.gripR, cfg.hands.right) && near(rider.pegL, cfg.feet.left) && near(rider.pegR, cfg.feet.right);
        if (!ok) return;
        self.setHandPivot("left", new V(cfg.hands.left[0], cfg.hands.left[1], cfg.hands.left[2]));
        self.setHandPivot("right", new V(cfg.hands.right[0], cfg.hands.right[1], cfg.hands.right[2]));
        self.setFootPivot("left", new V(cfg.feet.left[0], cfg.feet.left[1], cfg.feet.left[2]));
        self.setFootPivot("right", new V(cfg.feet.right[0], cfg.feet.right[1], cfg.feet.right[2]));
        console.log("Driver: the pivots of the hands and the feet are now offsets from the grips and the pegs");
    }
    this.handPivot = function (side, out) {
        if (!self.isRider()) return null;
        self.parent.updateMatrixWorld(true);
        rider[side === "left" ? "gripL" : "gripR"].localToWorld(rw.copy(handOffset(side)));
        return out.copy(self.parent.worldToLocal(rw));
    };
    this.setHandPivot = function (side, point) {
        if (!self.isRider()) return false;
        self.parent.updateMatrixWorld(true);
        var grip = rider[side === "left" ? "gripL" : "gripR"], local = grip.worldToLocal(self.parent.localToWorld(point.clone()));
        var r = function (v) { return Math.round(v * 1000) / 1000; };
        if (!self.config.hands.offset) self.config.hands.offset = { left: [0, 0, 0], right: [0, 0, 0] };
        self.config.hands.offset[side] = [r(local.x), r(local.y), r(local.z)];
        return true;
    };

    var walk = 0, walkPhase = 0, groundY = -0.3;      // pushing the bike back: how much the feet walk (0 to 1), where in the step, and the road in the space of the body
    function riderPose(dt, throttle, brake, state) {
        if (!riderRest) recordRest();
        walk += ((state && state.push ? 1 : 0) - walk) * Math.min(1, dt / 0.3);
        if (state && state.groundY !== undefined) groundY = state.groundY;
        if (walk > 0.001) walkPhase += dt * Math.abs((state && state.speed) || 0) / 0.8 * Math.PI;
        var cfg = self.config;
        // the gear: the shift lever and the left hand
        if (state) shiftEvents(state.gear || 0, !!state.neutral);
        var angle = shiftAngle(dt);
        if (rider.shifter && riderRest.local.shifter) rider.shifter.quaternion.copy(riderRest.local.shifter).multiply(rq2.setFromAxisAngle(rAxisX, angle));
        // the levers: the front brake lever with the brake, the clutch lever with the pull of a shift
        pullLever("brake", Math.max(0, Math.min(1, brake || 0)));
        pullLever("clutch", shiftState.pull || 0);
        // the throttle: the right grip rolls towards the rider
        rider.gripR.quaternion.copy(riderRest.local.gripR).multiply(rq2.setFromAxisAngle(rAxisX, -THROTTLE_ROLL * Math.max(0, Math.min(1, throttle || 0))));
        self.parent.updateMatrixWorld(true);
        var xOf = function (chain) { chain[0].getWorldPosition(tmp2); return self.parent.worldToLocal(tmp2).x; };
        var armLeft = xOf(self.bones.armL) >= xOf(self.bones.armR) ? "armL" : "armR", legLeft = xOf(self.bones.legL) >= xOf(self.bones.legR) ? "legL" : "legR";
        var world = new V(), restWorld = new V(), local = new V();
        [[armLeft, "left", 1, "gripL", "clutch", 0.25 + 0.5 * (shiftState.pull || 0)], [armLeft === "armL" ? "armR" : "armL", "right", -1, "gripR", "brake", 0.25 + 0.4 * Math.max(0, Math.min(1, brake || 0))]].forEach(function (e) {
            var chain = self.bones[e[0]], key = e[3];
            // the pivot of the hand is the grip and an offset (hands.offset, in the frame of the grip: it goes round with it)
            var off = handOffset(e[1]);
            self.parent.localToWorld(restWorld.copy(off).applyQuaternion(riderRest.quat[key]).add(riderRest.pos[key]));
            rider[key].localToWorld(world.copy(off));
            chain[0].getWorldPosition(a);
            var set = cfg.poles && cfg.poles[e[0]];
            if (set) tmp.set(set[0], set[1], set[2]);
            else { self.parent.worldToLocal(tmp.copy(a)); tmp.add(new V(e[2] * 0.45, -0.25, -0.35)); }
            // (the flat-track style: the inside elbow goes up and out)
            var postA = self.posture; if (postA && postA.push > 0.01 && (postA.inside || 0) * e[2] > 0) { tmp.y += 0.35 * postA.push; tmp.x += e[2] * 0.2 * postA.push; }
            (self.poles[e[0]] || (self.poles[e[0]] = new V())).copy(tmp);
            self.parent.localToWorld(pole.copy(tmp));
            // The hand on the grip: its turn relative to the grip is found once, with the rider in his neutral posture (the hand at the grip in its rest place, with the arm as the
            // inverse kinematics puts it there), and kept: every frame the hand is the grip where it is now (steered, the throttle rolled) with that turn on it. It was found again
            // every frame, from the arm that the posture of the moment gave, so a rider that hung off a bend turned his hands on the grips (the fingers pointed up).
            self.parent.getWorldQuaternion(qbody);
            if (!riderRest.handRel) riderRest.handRel = {};
            if (!riderRest.handRel[key]) {
                // neutral: the root without the posture offset, the chest and the head at rest, for this one solve
                var keepPos = self.root.position.clone();
                self.root.position.sub(postureOff);
                self.bones.chest.forEach(function (bone) { bone.quaternion.copy(rest.get(bone)); });
                if (self.bones.head) self.bones.head.quaternion.copy(rest.get(self.bones.head));
                self.root.updateMatrixWorld(true);
                solve(chain, restWorld, pole);
                chain[2].quaternion.copy(rest.get(chain[2]));
                chain[2].updateMatrixWorld(true);
                var hq0 = chain[2].getWorldQuaternion(new Q());
                hq0.premultiply(qbody.clone().invert());                            // in the space of the body
                riderRest.handRel[key] = rq1.copy(riderRest.quat[key]).invert().multiply(hq0).clone();      // relative to the grip at rest
                self.root.position.copy(keepPos);
                self.root.updateMatrixWorld(true);
            }
            solve(chain, world, pole);
            bodyQuat(rider[key], rq3);                                             // the grip now, in the space of the body
            var hq = qbody.clone().multiply(rq3).multiply(riderRest.handRel[key]);
            var turnOff = cfg.hands.rotation && cfg.hands.rotation[e[1]];
            if (turnOff) { qd.setFromEuler(eul.set((turnOff[0] || 0) * DEG_TO_RAD, (turnOff[1] || 0) * DEG_TO_RAD, (turnOff[2] || 0) * DEG_TO_RAD, "XYZ")); qd.premultiply(qbody).multiply(qbody.clone().invert()); hq.premultiply(qd); }
            chain[2].parent.getWorldQuaternion(qpw);
            chain[2].quaternion.copy(hq.premultiply(qpw.invert()));
            chain[2].updateMatrixWorld(true);
            var lever = riderRest.pos[e[4]] && rider[e[4]] ? bodyPos(rider[e[4]], new V()) : null;
            fingersAtLever(e[0], chain, lever, e[5]);
        });
        // the feet on the pegs; the left foot is on the toe peg of the shift lever as far as the lever has moved
        [[legLeft, 1, "pegL"], [legLeft === "legL" ? "legR" : "legL", -1, "pegR"]].forEach(function (e) {
            var chain = self.bones[e[0]];
            rider[e[2]].localToWorld(rw.copy(footOffset(e[1] > 0 ? "left" : "right")));
            self.parent.worldToLocal(local.copy(rw));
            if (e[2] === "pegL" && rider.shifter && riderRest.tip) { bodyPos2(rider.shifter, riderRest.tip, tmp); local.add(tmp.sub(riderRest.tipAt)); }
            // pushing the bike back: the feet come off the pegs and shuffle along the ground, one after the other
            // at a standstill the bike is upright and both feet are down on the road, under the pegs, the toes towards the nearest point of the road (they come back to the pegs, the left one first)
            var footDown = state ? (e[1] > 0 ? state.footDownL : state.footDown) || 0 : 0;
            if (footDown > 0.001 && walk < 0.5) {
                tmp.set(local.x + e[1] * 0.04, groundY + FOOT_ANKLE, local.z + 0.06);
                // the road itself, where the bike is pitched (a wheelie braked to a walking pace: the foot reaches down for the road, as far as the leg goes)
                if (state && typeof state.roadY === "number") { self.parent.localToWorld(tmp); tmp.y = state.roadY + FOOT_ANKLE; self.parent.worldToLocal(tmp); }
                local.lerp(tmp, footDown);
                feetDown[e[0]] = footDown;
            } else feetDown[e[0]] = 0;
            // the flat-track style: the inside foot comes off the peg and stands on the road (the global height of the road, state.roadY) beside the peg, forward and out as the lean goes up: with a bent
            // knee at a small lean, stretched out beside the front wheel at the most lean. The target is taken in the world, within the reach of the leg from the hip.
            var postF = self.posture, pushAmt = postF && postF.push > 0.01 && (postF.inside || 0) * e[1] > 0 ? postF.push : 0;
            if (pushAmt > 0 && walk < 0.5 && state && typeof state.roadY === "number") {
                var lv = Math.max(0, Math.min(1, (Math.abs(postF.lean || 0) / DEG - 12) / 36)); lv = lv * lv * (3 - 2 * lv);
                self.parent.localToWorld(footW.copy(local));
                footL.set(e[1], 0, 0).transformDirection(self.parent.matrixWorld); footL.y = 0; footL.normalize();
                footF.set(0, 0, 1).transformDirection(self.parent.matrixWorld); footF.y = 0; footF.normalize();
                footW.addScaledVector(footL, 0.1 + 0.14 * lv).addScaledVector(footF, 0.05 + 0.5 * lv);
                footW.y = state.roadY + FOOT_ANKLE;
                chain[0].getWorldPosition(footA); chain[1].getWorldPosition(footB); chain[2].getWorldPosition(footC);
                var reach = 0.97 * (footA.distanceTo(footB) + footB.distanceTo(footC));
                footC.copy(footW).sub(footA);
                if (footC.length() > reach) { footC.setLength(reach); footW.copy(footA).add(footC); }
                footW.y = Math.max(footW.y, state.roadY + FOOT_ANKLE);      // (never through the road)
                self.parent.worldToLocal(footW);
                local.lerp(footW, Math.min(1, pushAmt * 1.5));
                feetDown[e[0]] = Math.max(feetDown[e[0]] || 0, pushAmt);
            }
            if (walk > 0.001) {
                var pegAt = local.clone();
                var stride = Math.sin(walkPhase + (e[1] > 0 ? 0 : Math.PI)), lift = Math.max(0, Math.cos(walkPhase + (e[1] > 0 ? 0 : Math.PI)));
                tmp.set(pegAt.x + e[1] * 0.12, groundY + 0.03 + 0.1 * lift, pegAt.z + 0.05 + 0.22 * stride);
                local.lerp(tmp, walk);
            }
            self.parent.localToWorld(world.copy(local));
            if (state && typeof state.roadY === "number" && world.y < state.roadY + FOOT_ANKLE) world.y = state.roadY + FOOT_ANKLE;      // (a foot is never below the road: a bike at a deep lean has its peg near it)
            chain[0].getWorldPosition(a);
            var setKnee = cfg.poles && cfg.poles[e[0]];
            if (setKnee) tmp.set(setKnee[0], setKnee[1], setKnee[2]);
            else { self.parent.worldToLocal(tmp.copy(a)); tmp.add(new V(e[1] * 0.3, 0.1, 0.8)); }
            // in a bend the knee of the inside goes out and down to the road, the other one goes out a little
            var post = self.posture;
            if (post && post.knee > 0.01 && (post.inside || post.lat) * e[1] !== 0) {
                var inside = (post.inside || post.lat) * e[1] > 0;
                tmp.x += e[1] * (inside ? 0.6 : 0.25) * post.knee;
                if (inside) tmp.y -= 0.5 * post.knee;
            }
            (self.poles[e[0]] || (self.poles[e[0]] = new V())).copy(tmp);
            self.parent.localToWorld(pole.copy(tmp));
            solve(chain, world, pole);
            // the foot on the road: its toes turn from the front of the bike to the nearest point of the road (a little in front of the ankle, on the road)
            // (the foot starts from its rest turn every frame: the turn of the toes is set on it, not added to the one of the frame before)
            if (rest.get(chain[2])) chain[2].quaternion.copy(rest.get(chain[2]));
            chain[2].updateMatrixWorld(true);
            if (feetDown[e[0]] > 0.001 && walk < 0.5) {
                toeFwd.set(0, 0, 1).transformDirection(self.parent.matrixWorld);
                // (the toes go down so far that their tip is on the road, with the ankle FOOT_ANKLE above it: further and they went through the floor)
                toeDir.copy(toeFwd).multiplyScalar(Math.sqrt(Math.max(0.01, FOOT_LEN * FOOT_LEN - FOOT_ANKLE * FOOT_ANKLE))).y -= FOOT_ANKLE;
                toeDir.normalize().lerp(toeFwd, 1 - feetDown[e[0]]).normalize();
                rotateTo(chain[2], toeFwd.clone(), toeDir.clone());
                chain[2].updateMatrixWorld(true);
            }
        });
    }

    // ---- a crash (a motorcycle): the rider is thrown off as a ragdoll: a set of particles (the hips, the chest, the head, the shoulders, the elbows, the hands, the hip joints,
    // the knees and the feet) that fly, fall and slide over the road, held together by sticks (the bones keep their length, the torso is rigid, a limb cannot fold past a
    // minimum), and the skeleton is posed on them every frame (the root on the hips and the chest, the arms and the legs with the inverse kinematics on the hand or the foot
    // with the elbow or the knee as the pole). He lies there until a reset or a repair puts him back on the bike.
    var ragdoll = null, keptParent = null, keptPos = new V(), keptQuat = new Q();
    var RIGID = ["hips", "chest", "shL", "shR", "hiL", "hiR", "head"], PART_MASS = 80 / 15;      // (the rider of 80 kg over his fifteen particles)
    var ORDER = ["hips", "chest", "head", "shL", "elL", "haL", "shR", "elR", "haR", "hiL", "knL", "ftL", "hiR", "knR", "ftR"];     // the particles in a replay (Replay.js), 3 numbers each
    this.RAGDOLL_FLOATS = ORDER.length * 3;
    function particle(pos, r) { return { p: pos.clone(), q: pos.clone(), v: new V(), r: r, floor: -1e9, inside: null }; }      // inside: the spheres of the bike that it started in (not pushed out of those: he sits in the bike)      // q: the place a step before (Verlet); v: the speed to start with
    // options: { bike: the vehicle (Vehicle.js) that the body collides with (its spheres); onBike: he goes limp where he sits (no throw, no tumble: he slumps on the bike and falls
    // off it by himself); playback: a replay, nothing moves by itself }
    this.crash = function (velocity, ground, options) {
        if (ragdoll || !self.model || !self.complete()) return;
        options = options || {};
        keptParent = self.root.parent; keptPos.copy(self.root.position); keptQuat.copy(self.root.quaternion);
        var top = self.root; while (top.parent) top = top.parent;
        self.root.updateMatrixWorld(true);
        // where the joints are now, in the pose he has (the particles start there, and their speed is measured from where they were a frame ago)
        var B = self.bones, now = {}, wp = function (bone) { return now[bone.uuid] ? now[bone.uuid].clone() : bone.getWorldPosition(new V()); };
        var parentQuat = new Q(), localNow = {}, parentOf = self.root.parent;
        if (parentOf) parentOf.getWorldQuaternion(parentQuat);
        [B.hips, B.armL[0], B.armL[1], B.armL[2], B.armR[0], B.armR[1], B.armR[2], B.legL[0], B.legL[1], B.legL[2], B.legR[0], B.legR[1], B.legR[2], B.head].forEach(function (bone) {
            if (!bone) return;
            now[bone.uuid] = bone.getWorldPosition(new V());
            if (parentOf) localNow[bone.uuid] = parentOf.worldToLocal(now[bone.uuid].clone());
        });
        top.attach(self.root);
        // the limbs loose: every bone in its rest pose (the skeleton is posed on the particles from here on)
        rest.forEach(function (q, bone) { bone.quaternion.copy(q); });
        self.root.updateMatrixWorld(true);
        var y0 = self.root.position.y;
        var groundY = function (x, z) {
            if (ground && ground.firstHit) { var d = ground.firstHit(x, y0 + 20, z, 0, -1, 0, 100); if (d < 100) return y0 + 20 - d; }
            return y0 - 0.6;
        };
        var P = {};
        P.hips = particle(wp(B.hips), 0.13);
        P.shL = particle(wp(B.armL[0]), 0.1); P.elL = particle(wp(B.armL[1]), 0.06); P.haL = particle(wp(B.armL[2]), 0.05);
        P.shR = particle(wp(B.armR[0]), 0.1); P.elR = particle(wp(B.armR[1]), 0.06); P.haR = particle(wp(B.armR[2]), 0.05);
        P.hiL = particle(wp(B.legL[0]), 0.1); P.knL = particle(wp(B.legL[1]), 0.07); P.ftL = particle(wp(B.legL[2]), 0.06);
        P.hiR = particle(wp(B.legR[0]), 0.1); P.knR = particle(wp(B.legR[1]), 0.07); P.ftR = particle(wp(B.legR[2]), 0.06);
        P.chest = particle(P.shL.p.clone().add(P.shR.p).multiplyScalar(0.5), 0.14);
        var upDir = P.chest.p.clone().sub(P.hips.p).normalize();
        P.head = particle(B.head ? wp(B.head).addScaledVector(upDir, 0.1) : P.chest.p.clone().addScaledVector(upDir, 0.3), 0.11);
        var sticks = [], mins = [];
        var stick = function (a, b) { sticks.push({ a: P[a], b: P[b], len: P[a].p.distanceTo(P[b].p) }); };
        for (var i = 0; i < RIGID.length; i++) for (var j = i + 1; j < RIGID.length; j++) stick(RIGID[i], RIGID[j]);
        [["shL", "elL", "haL"], ["shR", "elR", "haR"], ["hiL", "knL", "ftL"], ["hiR", "knR", "ftR"]].forEach(function (c, k) {
            stick(c[0], c[1]); stick(c[1], c[2]);
            var len = P[c[0]].p.distanceTo(P[c[1]].p) + P[c[1]].p.distanceTo(P[c[2]].p);
            mins.push({ a: P[c[0]], b: P[c[2]], len: len * (k < 2 ? 0.3 : 0.45) });            // an arm or a leg folds no further than this
        });
        // the parts of him that keep out of each other: every pair of particles that no stick or fold limit joins (a leg through the other leg, a hand through the chest), each with a
        // radius of at least 7 cm (the particles are the joints; the limbs between them are thicker than that)
        var joined = {}, pairs = [];
        sticks.concat(mins).forEach(function (st) { for (var k in P) for (var k2 in P) if ((P[k] === st.a && P[k2] === st.b) || (P[k] === st.b && P[k2] === st.a)) joined[k + "/" + k2] = true; });
        var keys = Object.keys(P);
        for (i = 0; i < keys.length; i++) for (j = i + 1; j < keys.length; j++) {
            if (joined[keys[i] + "/" + keys[j]]) continue;
            var ra = Math.max(0.07, P[keys[i]].r), rb = Math.max(0.07, P[keys[j]].r);
            if (P[keys[i]].p.distanceTo(P[keys[j]].p) < ra + rb) continue;                      // (already closer than that in the pose on the bike: not these two)
            pairs.push({ a: P[keys[i]], b: P[keys[j]], len: ra + rb });
        }
        // the frame of the torso in the space of the root (the root is put on the particles from it)
        // (from the bones in their rest pose, not from the particles: the posture bent the torso a little, and the skeleton is posed on the particles from the rest pose)
        var toLocal = function (bone) { return self.root.worldToLocal(bone.getWorldPosition(new V())); }, restChest = toLocal(B.armL[0]).add(toLocal(B.armR[0])).multiplyScalar(0.5);
        var frame = { up: restChest.clone().sub(toLocal(B.hips)).normalize(), side: toLocal(B.armL[0]).sub(toLocal(B.armR[0])) };
        frame.side.addScaledVector(frame.up, -frame.side.dot(frame.up)).normalize();
        // the speed: the bike's, a little upwards, and a tumble about the hips
        // the speed of every part: the one it has, so that nothing is thrown harder than it was going: the speed of the bike at that place (its speed and its turn, from the physics:
        // bike), and the rider's own movement on it (measured from where the joint was a frame ago, in the frame of the bike, at most 5 m/s); the speed given where there is no bike
        var vel = velocity.clone(), vi = new V(), arm = new V(), bike = options.bike, jointOf = { hips: B.hips, shL: B.armL[0], elL: B.armL[1], haL: B.armL[2], shR: B.armR[0], elR: B.armR[1], haR: B.armR[2], hiL: B.legL[0], knL: B.legL[1], ftL: B.legL[2], hiR: B.legR[0], knR: B.legR[1], ftR: B.legR[2] };
        for (var key in P) {
            var bone = jointOf[key], was = bone && jointsBefore[bone.uuid], nowL = bone && localNow[bone.uuid];
            P[key].v.copy(vel);
            if (bike && typeof bike.wx === "number") {
                arm.set(P[key].p.x - bike.px, P[key].p.y - bike.py, P[key].p.z - bike.pz);
                P[key].v.set(bike.vx + (bike.wy * arm.z - bike.wz * arm.y), bike.vy + (bike.wz * arm.x - bike.wx * arm.z), bike.vz + (bike.wx * arm.y - bike.wy * arm.x));
            }
            if (was && nowL && jointsDt > 0 && !options.playback) {
                vi.copy(nowL).sub(was).divideScalar(jointsDt);
                var own = vi.length();
                if (own > 5) vi.multiplyScalar(5 / own);
                P[key].v.add(vi.applyQuaternion(parentQuat));
            }
        }
        P.chest.v.copy(P.shL.v).add(P.shR.v).multiplyScalar(0.5);
        P.head.v.copy(P.chest.v);
        ragdoll = { pts: P, sticks: sticks, mins: mins, pairs: pairs, groundY: groundY, frame: frame, asleep: 0, time: 0, started: false, bike: options.bike || null, playback: !!options.playback, spheres: new Float64Array(8 * 256), sphereCount: 0, centre: new V(), fresh: !!options.bike, seated: !!options.onBike };
        ragdoll.centre.copy(P.hips.p);
    };
    // the middle of the body (the world): what its weight does to a bike that he lies on (Motorcycle.js)
    this.ragdollCentre = function () { return ragdoll ? ragdoll.centre : null; };
    this.ragdollBike = function (bike) { if (ragdoll) ragdoll.bike = bike; };
    this.ragdollSeated = function (on) { if (ragdoll) ragdoll.seated = !!on; };       // the seat holds him (the bike is upright) or lets him go
    // the places of the particles, for a replay (RAGDOLL_FLOATS numbers), or null when he sits on the bike
    this.ragdollPoints = function (out) {
        if (!ragdoll) return null;
        for (var i = 0; i < ORDER.length; i++) { var p = ragdoll.pts[ORDER[i]].p; out[3 * i] = p.x; out[3 * i + 1] = p.y; out[3 * i + 2] = p.z; }
        return out;
    };
    // a replay: the body where the recording says (the particles from the numbers of ragdollPoints), nothing moves by itself
    this.showRagdoll = function (arr) {
        if (!ragdoll) { self.crash(new V(), null, { playback: true }); if (!ragdoll) return; }
        for (var i = 0; i < ORDER.length; i++) { var p = ragdoll.pts[ORDER[i]].p; p.set(arr[3 * i], arr[3 * i + 1], arr[3 * i + 2]); ragdoll.pts[ORDER[i]].q.copy(p); }
        ragdoll.playback = true;
        ragdollPose();
    };
    this.hideRagdoll = function () { self.recover(); };
    this.ragdollState = function () { return ragdoll; };
    this.recover = function () {
        if (!ragdoll) return;
        ragdoll = null;
        if (keptParent) { keptParent.add(self.root); self.root.position.copy(keptPos); self.root.quaternion.copy(keptQuat); }
        self.root.scale.setScalar(1);
        rest.forEach(function (q, bone) { bone.quaternion.copy(q); });
    };
    // where the joints were a frame ago (in the frame of the car), for the rider's own movement in the speed that every part of the ragdoll starts with
    var jointsBefore = {}, jointsDt = 0;
    function trackJoints(dt) {
        var B = self.bones;
        if (!B.hips || !self.complete()) return;
        var parent = self.root.parent;
        if (!parent) return;
        [B.hips, B.armL[0], B.armL[1], B.armL[2], B.armR[0], B.armR[1], B.armR[2], B.legL[0], B.legL[1], B.legL[2], B.legR[0], B.legR[1], B.legR[2]].forEach(function (bone) {
            var v = jointsBefore[bone.uuid] || (jointsBefore[bone.uuid] = new V());
            parent.worldToLocal(bone.getWorldPosition(v));                       // (in the frame of the car: the rider's own movement, not the car's)
        });
        jointsDt = dt;
    }
    var rgUp = new V(), rgSide = new V(), rgFwd = new V(), rgM = new THREE.Matrix4(), rgM0 = new THREE.Matrix4(), rgQ = new Q(), rgQ0 = new Q(), rgD = new V();
    // the spheres of the bike that are near the body this frame: [x, y, z, r, vx, vy, vz] each, from Vehicle.sphereWorld
    function bikeSpheres(r) {
        r.sphereCount = 0;
        var bike = r.bike;
        if (!bike || !bike.sphereWorld) return;
        if (bike.boundRadius) bike.boundRadius();                                  // (makes the spheres when they are not there yet)
        if (!bike.proxy3) return;
        var n = bike.proxy3.length, c = r.centre, out = r.spheres, buf = bikeTmp;
        for (var i = 0; i < n && r.sphereCount < 256; i++) {
            if (!bike.sphereWorld(i, buf, 0)) continue;
            var dx = buf[0] - c.x, dy = buf[1] - c.y, dz = buf[2] - c.z, reach = buf[3] + 1.6;
            if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
            // the speed of the sphere: that of the bike as a body (v + w x r); not the speed of a node of the shell that dents (that can be anything for a moment in a crash)
            var rx = buf[0] - bike.px, ry = buf[1] - bike.py, rz = buf[2] - bike.pz;
            buf[4] = bike.vx + (bike.wy * rz - bike.wz * ry); buf[5] = bike.vy + (bike.wz * rx - bike.wx * rz); buf[6] = bike.vz + (bike.wx * ry - bike.wy * rx);
            var sv = Math.sqrt(buf[4] * buf[4] + buf[5] * buf[5] + buf[6] * buf[6]);
            if (sv > 60) { buf[4] *= 60 / sv; buf[5] *= 60 / sv; buf[6] *= 60 / sv; }
            for (var k = 0; k < 7; k++) out[8 * r.sphereCount + k] = buf[k];
            out[8 * r.sphereCount + 7] = i;
            r.sphereCount++;
        }
    }
    var bikeTmp = new Float64Array(7);
    // a particle against the spheres of the bike: pushed out, its speed into the sphere taken away (the sphere's own speed is kept: he goes with the bike that he lies on), and some of
    // the speed along it (he does not slide off at once). Positions only, a step at a time: nothing can blow up at speed
    function bikeContact(g, r, h, first) {
        var S = r.spheres, n = r.sphereCount, hit = false;
        for (var i = 0; i < n; i++) {
            var o = 8 * i, dx = g.p.x - S[o], dy = g.p.y - S[o + 1], dz = g.p.z - S[o + 2], rr = S[o + 3] + g.r, d2 = dx * dx + dy * dy + dz * dz;
            var id = S[o + 7], was = -1;
            if (g.inside) for (var k = 0; k < g.inside.length; k++) if (g.inside[k].id === id) { was = k; break; }
            if (d2 >= rr * rr) { if (was >= 0) g.inside.splice(was, 1); continue; }           // (out of a sphere he started in: from now on it is solid for him)
            if (d2 < 1e-12) continue;
            var d = Math.sqrt(d2), nx = dx / d, ny = dy / d, nz = dz / d;
            // a sphere he started in (the seat, the tank) does not push him out: he sits in it, as far in as he was, and it carries him along; any other is solid
            // (a seat particle is pinned to its sphere, at the distance it had, while the bike is upright: r.seated; a leaning bike lets him go)
            var push = was >= 0 ? (g.inside[was].hold && r.seated ? g.inside[was].d - d : 0) : rr - d;
            if (push < 0 && !(was >= 0 && g.inside[was].hold)) push = 0;
            // the speed relative to the sphere (per step), before the push: the push is a move, not a speed
            var vx = g.p.x - g.q.x - S[o + 4] * h, vy = g.p.y - g.q.y - S[o + 5] * h, vz = g.p.z - g.q.z - S[o + 6] * h;
            if (push !== 0) {
                g.p.x += nx * push; g.p.y += ny * push; g.p.z += nz * push;
                var vn = vx * nx + vy * ny + vz * nz;
                if (push > 0 ? vn < 0 : vn > 0) {
                    vx -= vn * nx; vy -= vn * ny; vz -= vn * nz;
                    // the bike feels it: the speed that the part lost into the sphere, as an impulse of the part's share of the rider (a solid sphere only, not the seat he sits in)
                    // (the first pass of a substep only: the sticks put the part back in the sphere every pass, and the same hit was counted five times; and no more than 2 m/s of the
                    // whole rider on the bike in a frame)
                    if (first && was < 0 && r.bike && r.bike.applyImpulse && r.impulseLeft > 0) {
                        var jn = Math.min(r.impulseLeft, Math.abs(vn) / h * PART_MASS); r.impulseLeft -= jn; r.impulseUsed += jn;
                        r.bike.applyImpulse(S[o], S[o + 1], S[o + 2], -nx * jn, -ny * jn, -nz * jn);
                    }
                }
            }
            var f = Math.exp(-(was >= 0 && g.inside[was].hold ? 40 : 6) * h);        // the grip of the leathers on the bike (the seat holds him until his weight pulls him off it)
            vx *= f; vy *= f; vz *= f;
            var sp = Math.sqrt(vx * vx + vy * vy + vz * vz), cap = 4 * h;                // never faster than 4 m/s relative to the bike out of a contact (a part that is deep in it is pushed out, not shot out)
            if (sp > cap) { vx *= cap / sp; vy *= cap / sp; vz *= cap / sp; }
            g.q.x = g.p.x - vx - S[o + 4] * h; g.q.y = g.p.y - vy - S[o + 5] * h; g.q.z = g.p.z - vz - S[o + 6] * h;
            hit = true;
        }
        return hit;
    }
    // ---- the limits of the joints (what a body can do): the elbows bend only backwards and the knees only forwards (the middle of a limb kept on its side of the line from
    // its root to its end), the upper arm within 120 degrees of hanging down and out, the thigh within 100 degrees of down and a little forward. A limb that is moved into a
    // limit is put at the limit, and most of its speed into it is taken out (no bounce off the limit)
    var jUp = new V(), jSide = new V(), jFwd = new V(), jRest = new V(), jDir = new V(), jTmp = new V(), DEG = Math.PI / 180;
    // (the side of the line that counts is the one in the frame of the limb itself: the forward of the limb is the line from its root to its end crossed with the axis of the joint,
    // the side axis of the body. It was the forward of the torso, which is along the thigh of a rider that sits, and of a rider that lies on the road it is anything: the knees
    // folded forwards there)
    var jLimb = new V(), jLat = new V();
    // a particle moved to a limit: its old place goes with it (the move itself gives it no speed), and what speed it had into the limit is taken out. (The old place went 0.7 of the
    // way, a bounce of 0.3 of the move: a limb held in a limit by another constraint (a stick, the road) was given that speed again every iteration, and the ragdoll pumped itself
    // up to 13 m in the air after a crash)
    // (and by no more than 2 cm an iteration: a limit that is not well defined (a leg along the side axis of the body, where its forward turns round with every little move) threw
    // the knee from one side to the other, and the sticks passed that on to the rest of him as speed)
    // (and never into the road: a particle on the road is moved along it. A knee that the limit pushed down and the road pushed up again every iteration, with the little bounce
    // the road gives, was a motor that threw him 10 m in the air)
    var jMove = new V();
    function toLimit(pt, dir, move) {
        move = Math.max(-0.02, Math.min(0.02, move));
        jMove.copy(dir).multiplyScalar(move);
        if (jMove.y < 0 && pt.p.y <= pt.floor + 0.002) jMove.y = 0;
        pt.p.add(jMove); pt.q.add(jMove);
        var vn = (pt.p.x - pt.q.x) * dir.x + (pt.p.y - pt.q.y) * dir.y + (pt.p.z - pt.q.z) * dir.z;
        if (vn * move < 0) pt.q.addScaledVector(dir, vn);
    }
    function hinge(a, mid, b, side, sign) {
        jLimb.subVectors(b.p, a.p);
        var limbLen = jLimb.length(); if (limbLen < 1e-6) return;
        jDir.crossVectors(jLimb, side);
        // (the forward of the limb is not defined when the limb lies along the side axis of the body: the limit fades out from 25 degrees off it)
        var sinA = jDir.length() / limbLen, w = Math.max(0, Math.min(1, (sinA - 0.25) / 0.25));
        if (w <= 0) return;
        jDir.divideScalar(jDir.length());
        jTmp.copy(a.p).add(b.p).multiplyScalar(0.5);
        var d = (mid.p.x - jTmp.x) * jDir.x + (mid.p.y - jTmp.y) * jDir.y + (mid.p.z - jTmp.z) * jDir.z;
        // (never quite straight: a limb that is clamped on to the line has no side for the skeleton to bend to (ragdollPose), and the knee of the model snapped forwards and back)
        var dMin = sign * 0.03;
        if ((d - dMin) * sign < 0) { toLimit(mid, jDir, (dMin - d) * w); d += (dMin - d) * w; }
        // and the joint bends in its own plane: the middle of the limb may stand out sideways (about the axis of the limb, as a thigh turns at the hip) by no more than 35 degrees of
        // its bend (a knee that bent 128 degrees sideways)
        jLimb.normalize(); jLat.crossVectors(jLimb, jDir);
        var lat = (mid.p.x - jTmp.x) * jLat.x + (mid.p.y - jTmp.y) * jLat.y + (mid.p.z - jTmp.z) * jLat.z, latMax = Math.max(0.05, 0.7 * Math.abs(d));
        if (Math.abs(lat) > latMax) toLimit(mid, jLat, -(lat - Math.sign(lat) * latMax) * w);
    }
    function cone(root, end, rest, maxDeg) {
        jDir.subVectors(end.p, root.p);
        var len = jDir.length(); if (len < 1e-6) return;
        jDir.divideScalar(len);
        var c = jDir.dot(rest), lim = maxDeg * DEG;
        if (c >= Math.cos(lim)) return;
        jTmp.crossVectors(jDir, rest); if (jTmp.lengthSq() < 1e-10) return;
        jTmp.normalize();
        jDir.applyAxisAngle(jTmp, Math.acos(Math.max(-1, c)) - lim);
        jTmp.copy(root.p).addScaledVector(jDir, len).sub(end.p);
        var move = jTmp.length(); if (move < 1e-9) return;
        toLimit(end, jTmp.divideScalar(move), move);
    }
    function jointLimits(P) {
        jUp.subVectors(P.chest.p, P.hips.p).normalize();
        jSide.subVectors(P.shL.p, P.shR.p); jSide.addScaledVector(jUp, -jSide.dot(jUp)).normalize();
        jFwd.crossVectors(jSide, jUp);
        hinge(P.shL, P.elL, P.haL, jSide, -1); hinge(P.shR, P.elR, P.haR, jSide, -1);
        hinge(P.hiL, P.knL, P.ftL, jSide, 1); hinge(P.hiR, P.knR, P.ftR, jSide, 1);
        jRest.copy(jUp).multiplyScalar(-0.8).addScaledVector(jSide, 0.6).normalize(); cone(P.shL, P.elL, jRest, 120);
        jRest.copy(jUp).multiplyScalar(-0.8).addScaledVector(jSide, -0.6).normalize(); cone(P.shR, P.elR, jRest, 120);
        jRest.copy(jUp).multiplyScalar(-1).addScaledVector(jFwd, 0.35).normalize(); cone(P.hiL, P.knL, jRest, 100); cone(P.hiR, P.knR, jRest, 100);
    }
    function ragdollStep(dt) {
        var r = ragdoll, P = r.pts, key;
        r.time += dt;
        if (r.playback) return;
        if (r.asleep > 1) return;                                                  // lying still: nothing moves any more
        // fixed substeps (a Verlet step keeps its speed as a distance per step: the step has to stay the same length)
        var h = 1 / 240; r.acc = (r.acc || 0) + dt; var n = Math.min(12, Math.floor(r.acc / h)); r.acc -= n * h;
        if (!n) return;
        bikeSpheres(r);
        // N s: what the rider may give the bike this frame: in the first moments of the crash the hit itself (2 m/s of the whole rider), after that no more than half his weight
        // over the frame, well under what the road holds the bike with (a rider wedged in the spheres of a bike that lies on the road was pushed back into them by his sticks every
        // substep, and gave the bike 1.4 kN for seconds: the bike was shoved away and the two of them slid off together)
        r.impulseLeft = r.time < 0.3 ? 80 * 2 : 40 * 9.81 * Math.min(dt, 0.1);
        r.impulseUsed = 0;                                                          // (what he gave it this frame, for the debug view)
        if (r.fresh) {
            // the first step: the spheres that a particle is in now are the ones he sits in (the seat, the tank between the knees): they do not push him out
            r.fresh = false;
            // (every particle: the spheres it is in do not push it; the ones that sit, the hips, the hip joints and the knees (against the tank), are held where they are in the one sphere they are deepest in,
            // the seat: that is what holds him on the bike until he slides off it)
            for (key in P) {
                var pf = P[key], S = r.spheres, seat = key === "hips" || key === "hiL" || key === "hiR" || key === "knL" || key === "knR", deepest = -1, deep = 0; pf.inside = [];
                for (var si = 0; si < r.sphereCount; si++) {
                    var ox = pf.p.x - S[8 * si], oy = pf.p.y - S[8 * si + 1], oz = pf.p.z - S[8 * si + 2], rs = S[8 * si + 3] + pf.r;
                    var dd = ox * ox + oy * oy + oz * oz;
                    if (dd >= rs * rs) continue;
                    pf.inside.push({ id: S[8 * si + 7], d: 0, hold: false });
                    if (rs - Math.sqrt(dd) > deep) { deep = rs - Math.sqrt(dd); deepest = pf.inside.length - 1; pf.inside[deepest].d = Math.sqrt(dd); }
                }
                if (seat && deepest >= 0) pf.inside[deepest].hold = true;
            }
        }
        for (key in P) {
            var pt = P[key], fl = r.groundY(pt.p.x, pt.p.z) + pt.r;
            // a floor that is suddenly much higher is a wall or a kerb (a barrier beside the grass, the side of a ramp): he bounces back off it, instead of being lifted onto it in
            // one step (he was frozen where he stood before, for good, and a body half on a ramp hung in the air with its limbs stiff)
            if (pt.floor > -1e8 && fl > pt.floor + 0.3) {
                var bx = pt.p.x - pt.q.x, bz = pt.p.z - pt.q.z;
                pt.p.x = pt.q.x - 0.3 * bx; pt.p.z = pt.q.z - 0.3 * bz;
                pt.q.x = pt.p.x + 0.3 * bx; pt.q.z = pt.p.z + 0.3 * bz;
                fl = r.groundY(pt.p.x, pt.p.z) + pt.r;
                if (fl > pt.floor + 0.3) fl = pt.floor;                                  // (still against it: the old floor stays this frame)
            }
            pt.floor = fl;
        }
        var most = 0;
        if (!r.started) { r.started = true; for (key in P) P[key].q.copy(P[key].p).addScaledVector(P[key].v, -h); }      // (the speed in the length of the first substep)
        for (var s = 0; s < n; s++) {
            for (key in P) {
                var q = P[key], vx = q.p.x - q.q.x, vy = q.p.y - q.q.y, vz = q.p.z - q.q.z;
                q.q.copy(q.p);
                q.p.x += vx * 0.998; q.p.y += vy * 0.998 - 9.81 * h * h; q.p.z += vz * 0.998;
            }
            // the spheres of the bike go on with their speed within the frame (they are found once a frame; a bike at 25 m/s moves 10 cm a substep, and a particle held to a sphere that
            // stood still for the frame was dragged back every substep: that was a ragdoll that shook at speed)
            if (s > 0) for (var si2 = 0; si2 < r.sphereCount; si2++) { var o2 = 8 * si2; r.spheres[o2] += r.spheres[o2 + 4] * h; r.spheres[o2 + 1] += r.spheres[o2 + 5] * h; r.spheres[o2 + 2] += r.spheres[o2 + 6] * h; }
            for (var it = 0; it < 5; it++) {
                if (r.sphereCount) for (key in P) bikeContact(P[key], r, h, it === 0);
                for (var i = 0; i < r.sticks.length; i++) {
                    var st = r.sticks[i]; rgD.subVectors(st.b.p, st.a.p);
                    var len = rgD.length(); if (len < 1e-6) continue;
                    var corr = (len - st.len) / len * 0.5;
                    st.a.p.addScaledVector(rgD, corr); st.b.p.addScaledVector(rgD, -corr);
                }
                for (i = 0; i < r.mins.length; i++) {
                    var mn = r.mins[i]; rgD.subVectors(mn.b.p, mn.a.p);
                    len = rgD.length(); if (len >= mn.len || len < 1e-6) continue;
                    corr = (len - mn.len) / len * 0.5;
                    mn.a.p.addScaledVector(rgD, corr); mn.b.p.addScaledVector(rgD, -corr);
                }
                jointLimits(P);
                // the limbs keep out of each other (as a limit: no speed from the push, and the speed of the two towards each other taken out)
                for (i = 0; i < r.pairs.length; i++) {
                    var pr = r.pairs[i]; rgD.subVectors(pr.b.p, pr.a.p);
                    len = rgD.length(); if (len >= pr.len || len < 1e-6) continue;
                    rgD.divideScalar(len); var half = (pr.len - len) * 0.5;
                    toLimit(pr.a, rgD, -half); toLimit(pr.b, rgD, half);
                }
                var touching = 0;
                for (key in P) {
                    var g = P[key];
                    if (g.p.y < g.floor) {
                        g.p.y = g.floor;
                        if (g.q.y < g.floor) g.q.y = g.floor; else g.q.y = g.floor + (g.q.y - g.floor) * 0.2;      // the fall is taken (a little bounce)
                        if (g.p.y - g.q.y > 3 * h) g.q.y = g.p.y - 3 * h;                                         // (never thrown up faster than 3 m/s by the floor)
                        touching++;
                    }
                }
                // the road takes the speed out of him: the whole body slows when a part of it is on the road (the sticks drag the rest along anyway; a slide of some 15 m from 70 km/h)
                if (touching && it === 0) {
                    var dv = 0.55 * 9.81 * h * h * Math.min(1, touching / 4);                        // (leathers on tarmac: about 0.55 g, less when he only touches with a hand; the bike slides at about the same)
                    for (key in P) {
                        g = P[key];
                        var sx = g.p.x - g.q.x, sz = g.p.z - g.q.z, sp = Math.sqrt(sx * sx + sz * sz);
                        if (sp < 1e-9) continue;
                        var k = Math.max(0, sp - dv) / sp;
                        g.q.x = g.p.x - sx * k; g.q.z = g.p.z - sz * k;
                    }
                }
            }
        }
        r.centre.set(0, 0, 0);
        for (key in P) { most = Math.max(most, P[key].p.distanceToSquared(P[key].q)); r.centre.add(P[key].p); }
        r.centre.divideScalar(ORDER.length);
        if (Math.sqrt(most) / h < 0.08 && !r.sphereCount) r.asleep += dt; else r.asleep = 0;
        ragdollPose();
    }
    var rgPole = new V(), rgLimb = new V();
    function limbPole(a, mid, b, side, sign) {
        rgLimb.subVectors(b.p, a.p); rgPole.crossVectors(rgLimb, side);
        if (rgPole.lengthSq() < 1e-8) return mid.p;
        return rgPole.normalize().multiplyScalar(0.2 * sign).add(mid.p);
    }
    // the skeleton on the particles
    function ragdollPose() {
        var r = ragdoll, P = r.pts, B = self.bones;
        rgUp.subVectors(P.chest.p, P.hips.p).normalize();
        rgSide.subVectors(P.shL.p, P.shR.p); rgSide.addScaledVector(rgUp, -rgSide.dot(rgUp)).normalize();
        rgFwd.crossVectors(rgSide, rgUp);
        rgM.makeBasis(rgSide, rgUp, rgFwd); rgQ.setFromRotationMatrix(rgM);
        rgFwd.crossVectors(r.frame.side, r.frame.up);
        rgM0.makeBasis(r.frame.side, r.frame.up, rgFwd); rgQ0.setFromRotationMatrix(rgM0).invert();
        self.root.quaternion.copy(rgQ.multiply(rgQ0));
        self.root.position.copy(P.hips.p);
        self.root.updateMatrixWorld(true);
        // (the pole of a limb is its middle particle, pushed out a little further to the side the joint bends to: the hip of the skeleton is not quite the hip particle, and a leg that is
        // nearly straight had its pole on the line, so the knee of the model went to either side)
        solve(B.armL, P.haL.p, limbPole(P.shL, P.elL, P.haL, rgSide, -1)); solve(B.armR, P.haR.p, limbPole(P.shR, P.elR, P.haR, rgSide, -1));
        solve(B.legL, P.ftL.p, limbPole(P.hiL, P.knL, P.ftL, rgSide, 1)); solve(B.legR, P.ftR.p, limbPole(P.hiR, P.knR, P.ftR, rgSide, 1));
        // the head follows the neck: the bone turned so that it points from the chest to the head particle (as far as a neck goes: 50 degrees)
        if (B.head) {
            B.head.quaternion.copy(rest.get(B.head));
            B.head.updateMatrixWorld(true);
            B.head.getWorldPosition(rgD);
            rgUp.subVectors(rgD, P.chest.p); rgSide.subVectors(P.head.p, P.chest.p);
            if (rgUp.lengthSq() > 1e-6 && rgSide.lengthSq() > 1e-6) {
                var angle = rgUp.angleTo(rgSide);
                if (angle > 0.87) rgSide.copy(rgUp).lerp(rgSide, 0.87 / angle);
                rotateTo(B.head, rgUp.clone(), rgSide.clone());
            }
        }
        self.root.updateMatrixWorld(true);
    }

    this.update = function (dt, throttle, brake, state) {
        if (!self.model || !self.complete()) return;
        if (ragdoll) { ragdollStep(Math.min(0.05, dt || 0.016)); return; }
        trackJoints(dt || 0.016);                                                   // (the pose of the last frame, before this one moves it)
        self.posture = (state && state.posture) || null;
        applyPosture();
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
        self.isRider();
        if (rider) {
            riderPose(dt || 0.016, throttle, brake, state);
            var h = self.bones.head;
            if (h && restScale.has(h)) h.scale.copy(restScale.get(h)).multiplyScalar(self.showHead ? 1 : 0.001);
            return;
        }
        readGrips();
        if (self.steering) { if (self.keysActive()) planFor(self.turn); else handsStep(dt || 0.016); }
        var cfg = self.config, world = new V(), restWorld = new V(), wheelFrameOk = wheelFrame();
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
            // the hand is turned as the car editor set it (turned about the middle of the wheel as far as the hand has gone round it): the orientation of the hand when it is at its rest grip,
            // with the offset, turned by the angle that the hand has gone round
            var rot = cfg.hands.rotation && cfg.hands.rotation[e[1]], hasRot = self.steering && wheelFrameOk;
            var hq = null;
            if (hasRot) {
                self.parent.localToWorld(restWorld.copy(restGrip[e[1]]));
                solve(chain, restWorld, pole);
                chain[2].quaternion.copy(rest.get(chain[2]));
                chain[2].updateMatrixWorld(true);
                chain[2].getWorldQuaternion(qa);
                self.parent.getWorldQuaternion(qbody);
                hq = qa.clone();
            }
            solve(chain, world, pole);
            if (hq) {
                // (the offset and the turn are in the space of the car)
                if (self.handPose[e[1]].keyed) qw.copy(self.handPose[e[1]].quat);
                else {
                    qd.setFromEuler(eul.set(((rot && rot[0]) || 0) * DEG_TO_RAD, ((rot && rot[1]) || 0) * DEG_TO_RAD, ((rot && rot[2]) || 0) * DEG_TO_RAD, "XYZ"));
                    qw.setFromAxisAngle(axis, hand[e[1]].delta).multiply(qd);
                }
                qw.premultiply(qbody).multiply(qbody.clone().invert());                // the turn, in the world
                hq.premultiply(qw);
                chain[2].parent.getWorldQuaternion(qpw);
                chain[2].quaternion.copy(hq.premultiply(qpw.invert()));
                chain[2].updateMatrixWorld(true);
            }
            curl(e[0], Math.max(0, Math.min(1, self.handPose[e[1]].keyed ? self.handPose[e[1]].grip : ((cfg.hands.grip && cfg.hands.grip[e[1]]) || 0))));
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
    this.setCockpit = function (inside) { self.showHead = !inside; cullUniforms.uHideTorso.value = inside ? 1 : 0; };
    // The cockpit view: the torso of the driver is in the camera (the chest of a rider that lies on the tank). The vertices of the skinned mesh that belong mostly to the bones
    // of the torso (the hips, the spine, the chest, the neck: by the names of the bones) are dropped in the vertex shader while the view is inside, so the arms, the hands and the legs
    // stay, and no mesh is cut. The materials of the model get the test by onBeforeCompile; the indices are those of the skeleton of each mesh.
    var cullUniforms = { uHideTorso: { value: 0 } }, CULL_MAX = 32;
    function installTorsoCull(scene) {
        var torso = /spine|chest|torso|hips|pelvis|neck|breast|belly|stomach|shoulder|clavicle|upper_?arm|bicep/i, limb = /forearm|lower_?arm|hand|leg|foot|thigh|shin|head|finger|thumb|toe/i;      // (the shoulders and the upper arms go with the torso: they are at the camera, and swept through the picture)
        scene.traverse(function (o) {
            if (!o.isSkinnedMesh || !o.skeleton) return;
            var list = [];
            o.skeleton.bones.forEach(function (bone, i) { if (torso.test(bone.name) && !limb.test(bone.name)) list.push(i); });
            // (a Rigify rig: only the DEF- bones move the mesh, the rest are controls)
            var def = list.filter(function (i) { return /^DEF-/.test(o.skeleton.bones[i].name); });
            if (def.length) list = def;
            list = list.slice(0, CULL_MAX);
            if (!list.length) return;
            var arr = new Float32Array(CULL_MAX).fill(-1);
            list.forEach(function (i, k) { arr[k] = i; });
            var mats = Array.isArray(o.material) ? o.material : [o.material];
            mats.forEach(function (m) {
                if (!m || m.userData.torsoCull) return;
                m.userData.torsoCull = true;
                m.onBeforeCompile = function (shader) {
                    shader.uniforms.uHideTorso = cullUniforms.uHideTorso;
                    shader.uniforms.uHideBones = { value: arr };
                    // the weight of the torso bones of the vertex goes to the fragment shader, which drops the fragment past a half: a triangle across the edge is cut there,
                    // not stretched (moving the vertex would stretch it to the corner of the screen)
                    shader.vertexShader = "uniform float uHideBones[" + CULL_MAX + "];\nvarying float vTorsoHide;\n" + shader.vertexShader.replace("#include <project_vertex>",
                        "#include <project_vertex>\nvTorsoHide = 0.0;\n#ifdef USE_SKINNING\nfor (int i = 0; i < " + CULL_MAX + "; i++) { float b = uHideBones[i]; if (b < 0.0) break;" +
                        " vTorsoHide += (abs(skinIndex.x - b) < 0.5 ? skinWeight.x : 0.0) + (abs(skinIndex.y - b) < 0.5 ? skinWeight.y : 0.0) + (abs(skinIndex.z - b) < 0.5 ? skinWeight.z : 0.0) + (abs(skinIndex.w - b) < 0.5 ? skinWeight.w : 0.0); }\n#endif");
                    shader.fragmentShader = "uniform float uHideTorso;\nvarying float vTorsoHide;\n" + shader.fragmentShader.replace("#include <clipping_planes_fragment>",
                        "if (uHideTorso > 0.5 && vTorsoHide > 0.5) discard;\n#include <clipping_planes_fragment>");
                };
                m.customProgramCacheKey = function () { return "torsoCull"; };
                m.needsUpdate = true;
            });
        });
    }
    this.dispose = function () { self.parent.remove(self.root); };
    // the figure goes to another frame (the car editor puts it in the frame of the car that is tested, which moves with the physics)
    this.setParent = function (next) { self.parent.remove(self.root); self.parent = next; next.add(self.root); self.forgetRider(); };
    // the places of a rider (the grips, the pegs, the levers) are looked for again: the frame he is in changed (the car editor puts him on the bench and back), or the model of the bike
    // changed (the grips found before are not in the scene any more). The rest pose is recorded again with them.
    this.forgetRider = function () { rider = null; riderRest = null; riderTried = false; };

    // loads the glb of the driver (url): the model goes into place when it has arrived
    this.load = function (url, manager, done, fail) {
        var loader = new THREE.GLTFLoader(manager);
        loader.load(url, function (gltf) { if (OpenRacer.shrinkTextures && OpenRacer.textureBudget && OpenRacer.textureBudget()) OpenRacer.shrinkTextures(gltf.scene, OpenRacer.textureBudget()); self.setModel(gltf.scene); if (done) done(self); }, undefined, function (e) { if (fail) fail(e); });
    };
};

OpenRacer.Driver.defaults = function () {
    return {
        enabled: false, file: "", position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, bones: {},
        hands: { left: [0.15, 0.2, 0.3], right: [-0.15, 0.2, 0.3] },
        feet: { left: [0.1, -0.1, 0.5], right: [-0.1, -0.1, 0.5], travel: 0.06, direction: [0, -0.5, 0.85] },
        elbow_out: 0.5, knee_out: 0.15, poles: null, wheel: null, pivot: "", grip_curl: "x", chest: { rotation: [0, 0, 0] }, head: { rotation: [0, 0, 0] }
    };
};
OpenRacer.Driver.withDefaults = function (c) {
    var d = OpenRacer.Driver.defaults(), out = Object.assign({}, d, c || {});
    out.hands = Object.assign({}, d.hands, (c && c.hands) || {});
    var hr = (c && c.hands && c.hands.rotation) || {}, hg = (c && c.hands && c.hands.grip) || {};
    out.hands.rotation = { left: (hr.left || [0, 0, 0]).slice(), right: (hr.right || [0, 0, 0]).slice() };            // the turn of a hand (degrees, in the space of the car)
    out.keys = c && c.keys ? JSON.parse(JSON.stringify(c.keys)) : null;
    out.hands.grip = { left: hg.left || 0, right: hg.right || 0 };
    var ho = (c && c.hands && c.hands.offset) || {};
    out.hands.offset = { left: (ho.left || [0, 0, 0]).slice(), right: (ho.right || [0, 0, 0]).slice() };                // (a rider: the pivot of the hand is its grip, and this is the offset from it)                                                        // how far the fingers are closed (0..1)
    out.feet = Object.assign({}, d.feet, (c && c.feet) || {});
    var fo = (c && c.feet && c.feet.offset) || {};
    out.feet.offset = { left: (fo.left || [0, 0, 0]).slice(), right: (fo.right || [0, 0, 0]).slice() };                // (a rider: the pivot of a foot is its peg, and this is the offset from it)
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
