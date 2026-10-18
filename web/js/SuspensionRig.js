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
 *
 *   All of them stay parts of the body (children of the model, not of a wheel). The rest pose of the model is the car at rest on
 *   its springs, so a part moves from where it is modelled.
 */

OpenRacer.SuspensionRig = (function () {
    var CORNERS = { fl: 1, fr: 0, rl: 2, rr: 3 }; // the index of the wheel in Vehicle.js (FR, FL, RL, RR)
    var UP = new THREE.Vector3(0, 1, 0), FORWARD = new THREE.Vector3(0, 0, 1), Y = new THREE.Vector3(0, 1, 0);

    function clean(name) { return String(name || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }

    // what a part is, from its name: { kind, wheel } or null
    function classify(name) {
        var n = clean(name);
        if(n.indexOf("susp") !== 0 && n.indexOf("steer") !== 0) return null;
        if(n === "steerrack" || n === "susprack") return { kind: "rack" };
        var corner = n.slice(-2);
        var wheel = CORNERS[corner];
        if(n.indexOf("axle") !== -1) return { kind: "axle", rear: n.indexOf("rear") !== -1 || n.indexOf("back") !== -1 };
        if(wheel === undefined) return null;
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

    // Finds the parts under root (the model, already placed in the space of the body by CarLoader) and puts each in a holder in
    // tilt (the body) that is moved every frame. space holds tilt at the origin, so world positions are body positions.
    function find(root, space, tilt, config) {
        var parts = [];
        root.traverse(function (node) {
            var what = classify(node.name);
            if(what) parts.push({ node: node, what: what });
        });
        if(!parts.length) return null;
        space.updateMatrixWorld(true);
        var rig = { parts: [], rackTravel: (config.steering && config.steering.rack_travel !== undefined) ? config.steering.rack_travel : 0.1, rack: null, uprights: {} };
        var origin = new THREE.Vector3();
        parts.forEach(function (p) {
            p.node.getWorldPosition(origin);
            var entry = { kind: p.what.kind, wheel: p.what.wheel, rear: p.what.rear, origin: origin.clone(), holder: new THREE.Object3D() };
            entry.holder.name = "rig-" + p.node.name;
            entry.holder.position.copy(origin);
            if(entry.kind === "spring" || entry.kind === "tierod") {
                // the holder's Y axis runs along the part, from its origin to its far end, so that scale.y makes it longer or shorter
                entry.far = farEnd(p.node, origin);
                entry.restDir = entry.far.clone().sub(origin);
                entry.restLength = Math.max(0.01, entry.restDir.length());
                entry.restDir.normalize();
                entry.holder.quaternion.setFromUnitVectors(Y, entry.restDir);
            } else if(entry.kind === "arm") {
                entry.far = farEnd(p.node, origin);
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
        return vehicle.restLength - (w.susLength !== undefined ? w.susLength : vehicle.restLength);
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
            } else if(p.kind === "upright") {
                h.position.set(p.origin.x, p.origin.y + travelOf(vehicle, p.wheel), p.origin.z);
                if(p.wheel < 2) { q.setFromAxisAngle(UP, -steer); h.quaternion.copy(q).multiply(p.restQuaternion); }
            } else if(p.kind === "spring") {
                // the far end goes with the wheel (its travel), the top mount stays on the body
                tmp.copy(p.far); tmp.y += travelOf(vehicle, p.wheel);
                tmp.sub(p.origin);
                var length = tmp.length();
                h.quaternion.setFromUnitVectors(Y, tmp2.copy(tmp).normalize());
                h.scale.y = Math.max(0.2, length / p.restLength);
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
            } else if(p.kind === "axle") {
                var left = travelOf(vehicle, p.rear ? 2 : 1), right = travelOf(vehicle, p.rear ? 3 : 0);
                var track = p.rear ? vehicle.rear_track : vehicle.front_track;
                h.position.set(p.origin.x, p.origin.y + (left + right) / 2, p.origin.z);
                q.setFromAxisAngle(FORWARD, Math.atan2(left - right, track || 1.5));
                h.quaternion.copy(q).multiply(p.restQuaternion);
            }
        }
    }

    return { find: find, classify: classify };
})();
