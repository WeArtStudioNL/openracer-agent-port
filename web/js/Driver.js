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
    function torso() {
        var cfg = self.config;
        ["chest", "head"].forEach(function (name) { self.torsoPose[name] = torsoKeyRot(name, self.turn) || (cfg[name] && cfg[name].rotation) || [0, 0, 0]; });
        self.bones.chest.forEach(function (bone) { turnBone(bone, self.torsoPose.chest); });
        if (self.bones.head) turnBone(self.bones.head, self.torsoPose.head);
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
    var footTmp = new V();
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
    this.isRider = function () { if (!riderTried) { riderTried = true; rider = findRider(); } return !!rider; };
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

    function riderPose(dt, throttle, brake, state) {
        if (!riderRest) recordRest();
        var cfg = self.config;
        // the gear: the shift lever and the left hand
        if (state) shiftEvents(state.gear || 0, !!state.neutral);
        var angle = shiftAngle(dt);
        if (rider.shifter && riderRest.local.shifter) rider.shifter.quaternion.copy(riderRest.local.shifter).multiply(rq2.setFromAxisAngle(rAxisX, angle));
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
            (self.poles[e[0]] || (self.poles[e[0]] = new V())).copy(tmp);
            self.parent.localToWorld(pole.copy(tmp));
            // the hand at the grip in its rest place (for its orientation), and then at the grip where it is now, turned by what the grip has turned since (the steering, the throttle)
            solve(chain, restWorld, pole);
            chain[2].quaternion.copy(rest.get(chain[2]));
            chain[2].updateMatrixWorld(true);
            var hq = chain[2].getWorldQuaternion(new Q());
            solve(chain, world, pole);
            // (the turn since the rest, in the space of the body, then in the world)
            bodyQuat(rider[key], rq3);
            rq3.multiply(rq1.copy(riderRest.quat[key]).invert());
            self.parent.getWorldQuaternion(qbody);
            rq3.premultiply(qbody).multiply(qbody.clone().invert());
            hq.premultiply(rq3);
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
            self.parent.localToWorld(world.copy(local));
            chain[0].getWorldPosition(a);
            var setKnee = cfg.poles && cfg.poles[e[0]];
            if (setKnee) tmp.set(setKnee[0], setKnee[1], setKnee[2]);
            else { self.parent.worldToLocal(tmp.copy(a)); tmp.add(new V(e[1] * 0.3, 0.1, 0.8)); }
            (self.poles[e[0]] || (self.poles[e[0]] = new V())).copy(tmp);
            self.parent.localToWorld(pole.copy(tmp));
            solve(chain, world, pole);
        });
    }

    this.update = function (dt, throttle, brake, state) {
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
        if (!riderTried) { riderTried = true; rider = findRider(); }
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
    this.setCockpit = function (inside) { self.showHead = !inside; };
    this.dispose = function () { self.parent.remove(self.root); };
    // the figure goes to another frame (the car editor puts it in the frame of the car that is tested, which moves with the physics)
    this.setParent = function (next) { self.parent.remove(self.root); self.parent = next; next.add(self.root); };

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
