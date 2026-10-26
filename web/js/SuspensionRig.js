/*
 * SuspensionRig.js
 *
 * Description: The moving parts of the suspension and the steering of a model, when the model has them: wishbones that swing with
 *              the travel of the wheel, uprights that go up and down with the wheel and turn with the steering, springs, dampers and
 *              struts that get shorter and longer, a steering rack that slides and tie rods that follow it, a live axle that goes up
 *              and down and rolls. It is all optional: a part is used when a part of the model has its name, and a model without
 *              them is shown as before. The physics is not changed by it; the parts follow the physics (the travel of every wheel
 *              from the quarter car in Vehicle.js, the steering angle).
 *
 *   The names (case does not matter, other characters are ignored), with the corner FL, FR, RL or RR at the end:
 *     susp_upperarm_FL, susp_lowerarm_FL   a wishbone or a link: the origin (pivot) at the hinge on the chassis, it swings about the
 *                                          axis along the car; the free end reaches the wheel
 *     susp_upright_FL                      the upright (hub carrier, knuckle): the origin at the middle of the wheel; it goes with
 *                                          the wheel and turns with the steering (and does not spin: do not make it a wheel part)
 *     susp_spring_FL, susp_damper_FL,      the origin at the end on the body (the top mount); the part points to its other end and
 *     susp_strut_FL                        gets shorter and longer with the travel
 *     steer_rack                           the rack: it slides across the car with the steering (steering.rack_travel of car.json, m
 *                                          per radian of the front wheels, 0.1 by default; negative slides it the other way)
 *     steer_tierod_FL                      a tie rod: the origin at the end on the rack, the other end on the upright; it follows both
 *     susp_axle_rear (or _front)           a live axle: the origin at its middle; it goes up and down with its two wheels and rolls
 *     propshaft (or susp_propshaft,        the drive shaft of a car with drive to all wheels, from the differential at the front to the one
 *     cardan, susp_driveshaft_center)      at the rear: it stays where it is and turns about its own length with the wheels (the speed of
 *                                          the wheels, not geared up: a faster one only flickers on the screen)
 *
 *   All of them stay parts of the body (children of the model, not of a wheel). The rest pose of the model is the car at rest on
 *   its springs, so a part moves from where it is modelled.
 */

OpenRacer.SuspensionRig = (function () {
    var CORNERS = { fl: 1, fr: 0, rl: 2, rr: 3 }; // the index of the wheel in Vehicle.js (FR, FL, RL, RR)
    var UP = new THREE.Vector3(0, 1, 0), FORWARD = new THREE.Vector3(0, 0, 1), LEFT = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);

    function clean(name) { return String(name || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }

    // what a part is, from its name: { kind, wheel } or null
    function classify(name) {
        var n = clean(name);
        if(/^susppropshaft(rear|front|back)/.test(n)) return { kind: "propaxle", rear: n.indexOf("front") === -1 };      // (a propshaft to a live axle: it follows the axle, PartsLibrary.js)
        if(/^(susp)?(propshaft|cardan)/.test(n) || /^(susp)?driveshaft(center|centre|middle|prop)/.test(n)) return { kind: "prop" };
        var corner = n.slice(-2);
        var wheel = CORNERS[corner];
        // (a few parts are known without the susp_ in front: a live axle (solid_axle_rear, rear_solid_differential), a trailing arm (trailing_arm_RL, upper_trailing_arm_RL) and a
        // coilover or a damper with the corner at the end (coilover_cylinder_RL, damper_cylinder_RL: its parts, the coil and the piston, are children of it and go with it))
        if(n.indexOf("solidaxle") !== -1 || n.indexOf("liveaxle") !== -1 || /^(rear|front|back)?solid/.test(n) || /^axle/.test(n)) return { kind: "axle", rear: n.indexOf("front") === -1 };
        if(wheel !== undefined && n.indexOf("trailing") !== -1) return { kind: "trailing", wheel: wheel };
        if(wheel !== undefined && /^(coilover|damper|shock|strut|spring)/.test(n)) return { kind: "spring", wheel: wheel };
        if(n.indexOf("susp") !== 0 && n.indexOf("steer") !== 0) return null;
        if(n === "steerrack" || n === "susprack") return { kind: "rack" };
        if(n.indexOf("axle") !== -1) return { kind: "axle", rear: n.indexOf("rear") !== -1 || n.indexOf("back") !== -1 };
        if(n.indexOf("panhard") !== -1 || n.indexOf("watt") !== -1) return { kind: "panhard", rear: n.indexOf("front") === -1 };
        if(wheel === undefined) return null;
        if(n.indexOf("trailing") !== -1) return { kind: "trailing", wheel: wheel };
        if(n.indexOf("driveshaft") !== -1 || n.indexOf("halfshaft") !== -1 || n.indexOf("shaft") !== -1) return { kind: "shaft", wheel: wheel };
        if(n.indexOf("arm") !== -1 || n.indexOf("wishbone") !== -1 || n.indexOf("link") !== -1) return { kind: "arm", wheel: wheel };
        if(n.indexOf("upright") !== -1 || n.indexOf("hub") !== -1 || n.indexOf("knuckle") !== -1) return { kind: "upright", wheel: wheel };
        if(n.indexOf("spring") !== -1 || n.indexOf("damper") !== -1 || n.indexOf("strut") !== -1 || n.indexOf("shock") !== -1 || n.indexOf("coilover") !== -1) return { kind: "spring", wheel: wheel };
        if(n.indexOf("tierod") !== -1 || n.indexOf("trackrod") !== -1) return { kind: "tierod", wheel: wheel };
        return null;
    }

    // the box of a part in the space of the body
    function boxOf(node) {
        var box = new THREE.Box3();
        node.updateMatrixWorld(true);
        box.expandByObject(node);
        return box;
    }

    // the end of a part that is farthest from its origin, in the space of the body (the free end of an arm, the bottom of a spring)
    function farEnd(node, origin) {
        var box = boxOf(node);
        var corners = [], best = null, bestD = -1;
        for(var i = 0; i < 8; i++) corners.push(new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
        // the middle of the face of the box farthest from the origin, not a corner
        var centre = box.getCenter(new THREE.Vector3());
        var dir = centre.clone().sub(origin);
        if(dir.length() < 1e-4) return centre;
        dir.normalize();
        var size = box.getSize(new THREE.Vector3());
        var half = Math.abs(dir.x) * size.x / 2 + Math.abs(dir.y) * size.y / 2 + Math.abs(dir.z) * size.z / 2;
        return centre.clone().addScaledVector(dir, half);
    }

    // The parts inside a spring or a damper (children of it): a piston (piston, rod, shaft) slides along the part with the travel, a coil (coil, spring) gets shorter and longer
    // about its own origin, and the cylinder itself keeps its length. Without them the whole part is scaled. axis: the direction of the part, from the top mount to the far end
    function innerParts(node, axis, restLength) {
        var inner = [], wq = new THREE.Quaternion();
        node.traverse(function (child) {
            if(child === node) return;
            // (not the cylinder itself: "coilover" is no coil, "strut" no spring; a child that holds a piston or a coil is the cylinder)
            var n = clean(child.name), kind = /piston|rod|shaft/.test(n) ? "piston" : (/coil(?!over)|spring/.test(n) ? "coil" : null);
            if(!kind) return;
            var holdsParts = false; child.traverse(function (g) { if(g !== child && /piston|rod|shaft|coil(?!over)|spring/.test(clean(g.name))) holdsParts = true; });
            if(holdsParts) return;
            // the direction of the part in the frame of the child's parent (the move of the piston) and in the child's own frame (the axis the coil is scaled along)
            child.parent.getWorldQuaternion(wq);
            var inParent = axis.clone().applyQuaternion(wq.clone().invert());
            child.getWorldQuaternion(wq);
            var own = axis.clone().applyQuaternion(wq.invert());
            var scaleAxis = Math.abs(own.x) >= Math.abs(own.y) && Math.abs(own.x) >= Math.abs(own.z) ? "x" : (Math.abs(own.y) >= Math.abs(own.z) ? "y" : "z");
            // a part that is scaled along its length (the parts library stretches a part of 1 m to the length it needs): a move in the frame of the parent is that many times
            // longer in the world, so the piston is moved by the world length divided by it (the piston went past the end of the coilover: the stretch was counted twice)
            child.parent.updateWorldMatrix(true, false);
            var k = inParent.clone().applyMatrix3(new THREE.Matrix3().setFromMatrix4(child.parent.matrixWorld)).length() || 1;
            var along = Math.max(0, Math.min(1, child.position.dot(inParent) * k / Math.max(0.01, restLength)));      // where its origin is along the part: 0 the top mount, 1 the far end
            inner.push({ node: child, kind: kind, rest: child.position.clone(), restScale: child.scale.clone(), inParent: inParent, scaleAxis: scaleAxis, along: along, k: k });
        });
        return inner.length ? inner : null;
    }

    // Finds the parts under root (the model, already placed in the space of the body by CarLoader) and puts each in a holder in
    // tilt (the body) that is moved every frame. space holds tilt at the origin, so world positions are body positions.
    function find(root, space, tilt, config) {
        var parts = [], roots = Array.isArray(root) ? root : [root];        // (the model, and the parts the library built: PartsLibrary.js)
        roots.forEach(function (r) { if(r) r.traverse(function (node) {
            var what = classify(node.name);
            if(what) parts.push({ node: node, what: what });
        }); });
        // (a part inside a part (the coil and the piston of a coilover) goes with its parent: it is not a part of its own)
        parts = parts.filter(function (p) { for(var a = p.node.parent; a; a = a.parent) for(var k = 0; k < parts.length; k++) if(parts[k].node === a) return false; return true; });
        if(!parts.length) return null;
        space.updateMatrixWorld(true);
        var rig = { parts: [], rackTravel: (config.steering && config.steering.rack_travel !== undefined) ? config.steering.rack_travel : 0.1, rack: null, uprights: {} };
        var origin = new THREE.Vector3();
        parts.forEach(function (p) {
            p.node.getWorldPosition(origin);
            var entry = { kind: p.what.kind, wheel: p.what.wheel, rear: p.what.rear, origin: origin.clone(), holder: new THREE.Object3D() };
            entry.holder.name = "rig-" + p.node.name;
            entry.holder.position.copy(origin);
            // (a part the parts library built says where its far end is exactly: the box of a slanted part reaches past it)
            var exactFar = p.node.userData && p.node.userData.rigFar ? p.node.userData.rigFar.clone() : null;
            if(entry.kind === "trailing") {
                // a trailing arm swings about the axis across the car: its length is along the car
                entry.far = exactFar || farEnd(p.node, origin);
                entry.armLength = Math.max(0.05, Math.abs(entry.far.z - origin.z));
                entry.ahead = entry.far.z >= origin.z ? 1 : -1; // the free end ahead of (+z) or behind the hinge
            } else if(entry.kind === "spring" || entry.kind === "tierod" || entry.kind === "panhard" || entry.kind === "shaft" || entry.kind === "propaxle") {
                // the holder's Y axis runs along the part, from its origin to its far end, so that scale.y makes it longer or shorter
                entry.far = exactFar || farEnd(p.node, origin);
                entry.restDir = entry.far.clone().sub(origin);
                entry.restLength = Math.max(0.01, entry.restDir.length());
                entry.restDir.normalize();
                entry.holder.quaternion.setFromUnitVectors(Y, entry.restDir);
                if(entry.kind === "spring") { entry.inner = innerParts(p.node, entry.restDir, entry.restLength); entry.strut = clean(p.node.name).indexOf("strut") !== -1; }
            } else if(entry.kind === "prop") {
                // it turns about its own length: the longest side of its box, about the middle of the box; a shaft the parts library built says where it runs exactly
                // (a slanted shaft turned about the nearest axis of the car wobbled: its ends went round instead of staying at the gearbox and the differential)
                var pbox = boxOf(p.node), pc = pbox.getCenter(new THREE.Vector3()), ps = pbox.getSize(new THREE.Vector3());
                if(exactFar) {
                    entry.axis = exactFar.clone().sub(origin).normalize();
                    pc.copy(origin).add(exactFar).multiplyScalar(0.5);
                } else entry.axis = ps.x >= ps.y && ps.x >= ps.z ? LEFT.clone() : (ps.y >= ps.z ? UP.clone() : FORWARD.clone());
                entry.holder.position.copy(pc);
            } else if(entry.kind === "arm") {
                entry.far = exactFar || farEnd(p.node, origin);
                entry.armLength = Math.max(0.05, Math.abs(entry.far.x - origin.x));
                entry.side = entry.far.x >= origin.x ? 1 : -1; // the free end to the left (+x) or the right
            }
            tilt.add(entry.holder);
            entry.holder.updateMatrixWorld(true);
            entry.holder.attach(p.node); // keeps the place of the part
            entry.restQuaternion = entry.holder.quaternion.clone();
            if(entry.kind === "rack") rig.rack = entry;
            if(entry.kind === "upright") rig.uprights[entry.wheel] = entry;
            rig.parts.push(entry);
        });
        // a spring (or a damper) whose far end sits on an arm of its wheel, between the hinge and the ball joint: it goes with the swing of the arm there, not with the whole
        // travel of the wheel (a coilover seated halfway along the lower wishbone moves half as far as the wheel; it looked as if it came loose from the arm). The lowest such
        // arm is taken (the spring sits on the lower arm).
        // The same for a foot on a trailing arm (it swings about the axis across the car: the foot goes round the hinge by its distance along the car), and a foot on a live
        // axle away from its middle goes up with the axle there (the mean travel of the two wheels, and the roll of the axle at that distance from the middle).
        // A trailing arm whose end sits on a live axle swings so that its end stays on the axle: the axle is at the mean travel of its two wheels plus its roll at that distance
        // from the middle, which is less than the travel of the wheel for an arm that sits inboard (an upper arm near the differential came out of the axle when the car twisted).
        rig.parts.forEach(function (p) {
            if(p.kind !== "trailing") return;
            rig.parts.forEach(function (a) { if(a.kind === "axle" && a.rear === (p.wheel >= 2) && Math.abs(p.far.z - a.origin.z) < 0.15) p.onAxle = a; });
        });
        rig.parts.forEach(function (p) {
            if(p.kind !== "spring" || p.strut) return;
            var best = null, bestTrailing = null, axle = null;
            rig.parts.forEach(function (a) { if(a.kind === "axle" && a.rear === (p.wheel >= 2)) axle = a; });
            // (a foot within 15 cm of the axle along the car sits on the axle, whatever arm reaches there)
            if(axle && Math.abs(p.far.z - axle.origin.z) < 0.15) { p.onAxle = axle; return; }
            rig.parts.forEach(function (a) {
                if(a.wheel !== p.wheel) return;
                if(a.kind === "arm") {
                    var lo = Math.min(a.origin.x, a.far.x), hi = Math.max(a.origin.x, a.far.x);
                    if(p.far.x < lo - 0.02 || p.far.x > hi + 0.02) return;
                    if(Math.abs(p.far.x - a.origin.x) < 0.03) return;                       // (at the hinge: it does not move with the arm)
                    if(!best || a.origin.y < best.origin.y) best = a;
                } else if(a.kind === "trailing") {
                    var zlo = Math.min(a.origin.z, a.far.z), zhi = Math.max(a.origin.z, a.far.z);
                    if(p.far.z < zlo - 0.02 || p.far.z > zhi + 0.02) return;
                    if(Math.abs(p.far.z - a.origin.z) < 0.03) return;
                    // (the foot at the end of the arm on the axle is the axle's: the axle moves it; only a foot along the arm is the arm's)
                    if(Math.abs(p.far.z - a.far.z) < 0.05) return;
                    if(!bestTrailing || a.origin.y < bestTrailing.origin.y) bestTrailing = a;
                }
            });
            if(best) p.onArm = best;
            else if(bestTrailing) p.onTrailing = bestTrailing;
            else if(axle) p.onAxle = axle;
        });
        rig.update = function (vehicle) { update(rig, vehicle); };
        rig.count = rig.parts.length;
        return rig;
    }

    var q = new THREE.Quaternion(), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

    // the travel of a wheel upwards from where the model has it (m), from the quarter car. The model is the car as made, so a ride
    // height that is set in the tuning shows as the wheels sitting further out (longer springs, arms swung down), with the
    // upright still on the wheel, instead of the parts staying where they were modelled while the wheel moves away from them.
    function travelOf(vehicle, wheel) {
        var w = vehicle.wheels[wheel];
        var length = w.visualLength !== undefined ? w.visualLength : (w.susLength !== undefined ? w.susLength : vehicle.restLength);
        return vehicle.restLength - length;
    }

    // how far up a live axle is at a distance x from its middle: the mean travel of its two wheels, and its roll
    function axleTravelAt(vehicle, axle, x) {
        var l = travelOf(vehicle, axle.rear ? 2 : 1), r = travelOf(vehicle, axle.rear ? 3 : 0), track = (axle.rear ? vehicle.rear_track : vehicle.front_track) || 1.5;
        return (l + r) / 2 + (l - r) / track * x;
    }
    function update(rig, vehicle) {
        var steer = vehicle.steerApplied || 0;
        var rackShift = rig.rackTravel * steer; // along +x (to the left) for a steer to the right, with a positive travel
        for(var i = 0; i < rig.parts.length; i++) {
            var p = rig.parts[i], h = p.holder;
            if(p.kind === "arm") {
                var travel = travelOf(vehicle, p.wheel);
                var angle = Math.asin(Math.max(-1, Math.min(1, travel / p.armLength))) * p.side;
                q.setFromAxisAngle(FORWARD, angle);
                h.quaternion.copy(q).multiply(p.restQuaternion);
            } else if(p.kind === "prop") {
                var turn = 0;
                for(var pk = 0; pk < 4; pk++) turn += vehicle.wheels[pk].spin || 0;
                h.quaternion.setFromAxisAngle(p.axis, turn / 4);
            } else if(p.kind === "upright") {
                h.position.set(p.origin.x, p.origin.y + travelOf(vehicle, p.wheel), p.origin.z);
                if(p.wheel < 2) { q.setFromAxisAngle(UP, -steer); h.quaternion.copy(q).multiply(p.restQuaternion); }
            } else if(p.kind === "spring") {
                // the far end goes with the wheel (its travel), the top mount stays on the body; seated on an arm, it goes round the hinge of the arm with it
                if(p.onArm) {
                    var armAngle = Math.asin(Math.max(-1, Math.min(1, travelOf(vehicle, p.wheel) / p.onArm.armLength))) * p.onArm.side;
                    tmp.copy(p.far).sub(p.onArm.origin).applyAxisAngle(FORWARD, armAngle).add(p.onArm.origin);
                } else if(p.onTrailing) {
                    var tt = p.onTrailing.onAxle ? axleTravelAt(vehicle, p.onTrailing.onAxle, p.onTrailing.far.x) : travelOf(vehicle, p.wheel);
                    var tAngle = -p.onTrailing.ahead * Math.asin(Math.max(-1, Math.min(1, tt / p.onTrailing.armLength)));
                    tmp.copy(p.far).sub(p.onTrailing.origin).applyAxisAngle(LEFT, tAngle).add(p.onTrailing.origin);
                } else if(p.onAxle) {
                    tmp.copy(p.far); tmp.y += axleTravelAt(vehicle, p.onAxle, p.far.x);
                } else { tmp.copy(p.far); tmp.y += travelOf(vehicle, p.wheel); }
                tmp.sub(p.origin);
                var length = tmp.length();
                h.quaternion.setFromUnitVectors(Y, tmp2.copy(tmp).normalize());
                // (a strut of a front wheel turns with the steering about its own length: its foot is clamped to the upright)
                if(p.strut && p.wheel < 2) { q.setFromAxisAngle(Y, -steer); h.quaternion.multiply(q); }
                if(p.inner) {
                    // the cylinder stays as it is; the piston slides along the part by the change of length, the coil gets that much shorter or longer about its own origin
                    // (a coil's origin may be at either end of the part, or between: it moves with its share of the way down the part, and is scaled about it)
                    var delta = length - p.restLength;
                    for(var k = 0; k < p.inner.length; k++) {
                        var part = p.inner[k];
                        part.node.position.copy(part.rest).addScaledVector(part.inParent, delta / part.k * (part.kind === "piston" ? 1 : part.along));
                        if(part.kind === "coil") {
                            part.node.scale.copy(part.restScale);
                            part.node.scale[part.scaleAxis] = part.restScale[part.scaleAxis] * Math.max(0.2, (p.restLength + delta) / p.restLength);
                        }
                    }
                } else h.scale.y = Math.max(0.2, length / p.restLength);
            } else if(p.kind === "rack") {
                h.position.set(p.origin.x + rackShift, p.origin.y, p.origin.z);
            } else if(p.kind === "tierod") {
                // the near end slides with the rack; the far end sits on the upright: it goes up with the wheel and turns with the steering
                // about the middle of the wheel
                var upright = rig.uprights[p.wheel];
                tmp.copy(p.far);
                if(upright) {
                    tmp.sub(upright.origin);
                    if(p.wheel < 2) tmp.applyAxisAngle(UP, -steer);
                    tmp.add(upright.origin);
                }
                tmp.y += travelOf(vehicle, p.wheel);
                h.position.set(p.origin.x + (p.wheel < 2 ? rackShift : 0), p.origin.y, p.origin.z);
                tmp.sub(h.position);
                h.quaternion.setFromUnitVectors(Y, tmp2.copy(tmp).normalize());
                h.scale.y = Math.max(0.2, tmp.length() / p.restLength);
            } else if(p.kind === "trailing") {
                // swings about the axis across the car: the free end goes up with the wheel (or with the axle, where it sits on one)
                var tTravel = p.onAxle ? axleTravelAt(vehicle, p.onAxle, p.far.x) : travelOf(vehicle, p.wheel);
                q.setFromAxisAngle(LEFT, -p.ahead * Math.asin(Math.max(-1, Math.min(1, tTravel / p.armLength))));
                h.quaternion.copy(q).multiply(p.restQuaternion);
            } else if(p.kind === "shaft") {
                // from the differential (on the body) to the middle of the wheel: it goes up and down with the wheel and gets longer and shorter
                var hub = rig.uprights[p.wheel];
                tmp.copy(hub ? hub.origin : p.far);
                tmp.y += travelOf(vehicle, p.wheel);
                tmp.sub(p.origin);
                h.quaternion.setFromUnitVectors(Y, tmp2.copy(tmp).normalize());
                h.scale.y = Math.max(0.2, tmp.length() / p.restLength);
            } else if(p.kind === "panhard") {
                // from the body to the axle: the end on the axle goes up with the axle there (its travel, and its roll at that distance from the middle)
                var pl = travelOf(vehicle, p.rear ? 2 : 1), pr = travelOf(vehicle, p.rear ? 3 : 0);
                var pTrack = (p.rear ? vehicle.rear_track : vehicle.front_track) || 1.5;
                tmp.copy(p.far);
                tmp.y += (pl + pr) / 2 + (pl - pr) / pTrack * p.far.x;
                tmp.sub(p.origin);
                h.quaternion.setFromUnitVectors(Y, tmp2.copy(tmp).normalize());
                h.scale.y = Math.max(0.2, tmp.length() / p.restLength);
            } else if(p.kind === "axle") {
                // (a part on the axle away from its middle, a leaf spring: it goes up with the roll of the axle at its distance from the middle)
                var left = travelOf(vehicle, p.rear ? 2 : 1), right = travelOf(vehicle, p.rear ? 3 : 0);
                var track = (p.rear ? vehicle.rear_track : vehicle.front_track) || 1.5;
                h.position.set(p.origin.x, p.origin.y + (left + right) / 2 + (left - right) / track * p.origin.x, p.origin.z);
                q.setFromAxisAngle(FORWARD, Math.atan2(left - right, track));
                h.quaternion.copy(q).multiply(p.restQuaternion);
            } else if(p.kind === "propaxle") {
                // from the gearbox to the middle of a live axle: the far end goes up and down with the axle, and the shaft turns about its length with the wheels
                var al = travelOf(vehicle, p.rear ? 2 : 1), ar = travelOf(vehicle, p.rear ? 3 : 0);
                tmp.copy(p.far); tmp.y += (al + ar) / 2;
                tmp.sub(p.origin);
                h.quaternion.setFromUnitVectors(Y, tmp2.copy(tmp).normalize());
                var spin = ((vehicle.wheels[p.rear ? 2 : 1].spin || 0) + (vehicle.wheels[p.rear ? 3 : 0].spin || 0)) / 2;
                q.setFromAxisAngle(Y, spin); h.quaternion.multiply(q);
                h.scale.y = Math.max(0.2, tmp.length() / p.restLength);
            }
        }
    }

    return { find: find, classify: classify };
})();
