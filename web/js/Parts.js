/*
 * Parts.js
 *
 * Description: The loose parts of a car: doors, a hood, a boot lid, bumpers, mirrors, a wing. They are objects of the model of the car, listed in
 *              car.json under "parts", and they run in a rigid-body engine (Rapier, js/rapier/, loaded only for a car that has parts). See SOFTBODY.md.
 *
 *              A part has a mode:
 *                "fixed"      part of the shell, deformed with it (the default; nothing is done)
 *                "detachable" sits on the car until the load on it passes break_force (N), then it is a free rigid body that falls, bounces and
 *                             slides on the track (and hits the car)
 *                "hinge"      (with "mounts": [{ node, break_force }]: two nodes of the shell that it hangs on, the hinge is the line between them and a mount
 *                             tears off at its force; with one mount left it swings about that point) a revolute joint with an axis, an origin (both in the frame of the car), limits (degrees), a spring (a target angle
 *                             and a stiffness) and a damper. With latch_force it sits shut until the load passes it, then it swings. With
 *                             break_force it tears off at that load and becomes a free part.
 *
 *              The load on a part is the largest of: its mass times the acceleration of its place on the car (the inertia), and the force that
 *              the shell puts on the nodes it hangs on (the displacement of the nodes times their stiffness). A part also comes loose when the
 *              anchor of one of its nodes tears off.
 *
 *              The car itself stays our own physics (Vehicle.js): in the engine it is a body that we move (kinematic) with a ball for every
 *              sphere of its shell, so the parts hit it. The track near the car is a static triangle mesh in the engine, made again from the
 *              triangles of the 3D ground when the car has moved. The engine only runs while a part is moving.
 *
 *              The model is moved with the part: the object leaves the model, goes into the scene and follows the body in the engine.
 *              No forces go back to the car (a loose door does not push the car).
 */

OpenRacer.Parts = (function () {
    var GROUND = 1, CHASSIS = 2, PART_FREE = 4, PART_HELD = 8;       // the groups of collisions
    var GRACE = 0.35;                                               // s after coming loose in which a part does not hit the car (it is inside it)
    var DEG = Math.PI / 180;

    // "axes" of a pin point: { x, y, z } of booleans, or a list like ["x"]; one axis is a hinge, more is a ball, none is a rigid pin
    function pinAxes(axes) {
        if (Array.isArray(axes)) { var o = { x: false, y: false, z: false }; axes.forEach(function (k) { o[String(k).toLowerCase()] = true; }); return o; }
        if (axes && typeof axes === "object") return { x: !!axes.x, y: !!axes.y, z: !!axes.z };
        return { x: true, y: false, z: false };
    }

    function groups(membership, filter) { return ((membership << 16) | filter) >>> 0; }

    // Loads the engine (once) and makes the parts of a car. ctx: see build(). Gives a promise of the controller, or null
    var enginePromise = null;
    function loadEngine() {
        if (!enginePromise) enginePromise = import("./rapier/rapier.es.js").then(function (module) {
            var R = module.default || module;
            return Promise.resolve(R.init()).then(function () { return R; });
        });
        return enginePromise;
    }

    function create(ctx) {
        if (!ctx.specs || !ctx.specs.length) return Promise.resolve(null);
        var shapes = ctx.specs.map(function (spec) { return shapeOf(spec, ctx); });      // now: the model is in the frame of the car only at this moment
        return loadEngine().then(function (R) { return build(R, ctx, shapes); }).catch(function (e) { console.warn("Parts: " + e.message + (e.stack ? "\n" + e.stack : "")); return null; });
    }

    // An object back at its place in the model: its parent, and its position, turn and size (three.js makes its matrix from these when it updates
    // by itself, so the matrix alone is not enough: attach() has changed them when the object was moved to the scene)
    function restoreHome(object, home) {
        object.position.copy(home.position); object.quaternion.copy(home.quaternion); object.scale.copy(home.scale);
        object.matrixAutoUpdate = home.autoUpdate;
        object.updateMatrix();
        object.matrixWorldNeedsUpdate = true;
    }

    // The shape of the part of a spec in the frame of the car (ctx.root is the model, in the frame that CollisionProxy.js used), or null
    function shapeOf(spec, ctx) {
        if (!spec || !spec.object || spec.mode === "fixed" || !spec.mode) return null;
        var a = new THREE.Vector3();
        var object = ctx.root.getObjectByName(spec.object);
        // the car editor uses the same model again and again: a part that an earlier test has thrown out of it comes back to its place first
        if (object) {
            var home = object.userData.partHome;
            if (!home) home = object.userData.partHome = { parent: object.parent, matrix: object.matrix.clone(), autoUpdate: object.matrixAutoUpdate, position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone() };
            else if (object.parent !== home.parent || !object.matrix.equals(home.matrix)) {
                home.parent.add(object); restoreHome(object, home);
            }
        }
        if (!object) { console.warn("Parts: no object '" + spec.object + "' in the model"); return null; }
        object.updateMatrixWorld(true);                      // as CollisionProxy.js: the frame of the model, not of the world
        // the points of the shape: the vertices of its meshes in the frame of the car
        var pts = [], lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
        var seen = {};
        object.traverse(function (mesh) {
            if (!mesh.isMesh || !mesh.geometry || !mesh.geometry.attributes.position) return;
            var pos = mesh.geometry.attributes.position;
            var step = Math.max(1, Math.floor(pos.count / 400));
            for (var i = 0; i < pos.count; i += step) {
                a.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
                ctx.toVehicle(a);
                var key = Math.round(a.x * 50) + "," + Math.round(a.y * 50) + "," + Math.round(a.z * 50);
                if (seen[key]) continue;
                seen[key] = 1;
                pts.push(a.x, a.y, a.z);
                lo[0] = Math.min(lo[0], a.x); lo[1] = Math.min(lo[1], a.y); lo[2] = Math.min(lo[2], a.z);
                hi[0] = Math.max(hi[0], a.x); hi[1] = Math.max(hi[1], a.y); hi[2] = Math.max(hi[2], a.z);
            }
        });
        if (pts.length < 12) { console.warn("Parts: '" + spec.object + "' has no shape"); return null; }
        var centre = new THREE.Vector3((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2);
        var local = new Float32Array(pts.length);
        for (var i = 0; i < pts.length; i += 3) { local[i] = pts[i] - centre.x; local[i + 1] = pts[i + 1] - centre.y; local[i + 2] = pts[i + 2] - centre.z; }
        return { object: object, centre: centre, local: local, lo: lo, hi: hi };
    }

    // R: the engine. ctx: { vehicle, softBody, softBodyMesh, spheres (of the shell), specs ([the "parts" of car.json]), root (the model),
    //                       toVehicle(p) (as in CollisionProxy.js), onEvent(name, part) }
    function build(R, ctx, shapes) {
        var v = ctx.vehicle, sb = ctx.softBody;
        var world = new R.World({ x: 0, y: -9.81, z: 0 });
        var chassis = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
        ctx.spheres.forEach(function (s) {
            if (s.wheel) return;
            world.createCollider(R.ColliderDesc.ball(s.r).setTranslation(s.x, s.y, s.z).setCollisionGroups(groups(CHASSIS, PART_FREE)), chassis);
        });
        var trackBody = world.createRigidBody(R.RigidBodyDesc.fixed());
        var trackCollider = null;
        var candidates = [], corner = new Array(9);

        var q = new THREE.Quaternion(), qInv = new THREE.Quaternion(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
        var tmpM = new THREE.Matrix4(), bodyM = new THREE.Matrix4(), unit = new THREE.Vector3(1, 1, 1);
        var carPos = new THREE.Vector3();
        var parts = [];
        var events = [];
        var frame = 0;

        function setPose() {
            carPos.set(v.px, v.py, v.pz);
            q.set(v.qx, v.qy, v.qz, v.qw);
            chassis.setNextKinematicTranslation({ x: v.px, y: v.py, z: v.pz });
            chassis.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
        }
        // a point of the frame of the car in the world
        function toWorld(p, out) { return out.copy(p).applyQuaternion(q).add(carPos); }
        // the velocity of a point of the car (a is a point in the frame of the car)
        function pointVelocity(p, out) {
            a.copy(p).applyQuaternion(q);
            return out.set(v.vx + v.wy * a.z - v.wz * a.y, v.vy + v.wz * a.x - v.wx * a.z, v.vz + v.wx * a.y - v.wy * a.x);
        }

        // ---- the parts
        ctx.specs.forEach(function (spec, index) {
            if (!spec || !spec.object || spec.mode === "fixed" || !spec.mode) return;
            var shape = shapes[index];
            if (!shape) return;
            var object = shape.object, centre = shape.centre, local = shape.local, lo = shape.lo, hi = shape.hi;
            var mass = spec.mass !== undefined ? spec.mass : 15;
            // continuous collision detection: a part that leaves the car at its speed would go through a thin wall or the road between two steps
            var body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setCcdEnabled(true));
            var collider = null;
            // a hull of the points; a flat part (a plate) has none, so then a box of its size
            [R.ColliderDesc.convexHull(local), R.ColliderDesc.cuboid(Math.max(0.04, (hi[0] - lo[0]) / 2), Math.max(0.04, (hi[1] - lo[1]) / 2), Math.max(0.04, (hi[2] - lo[2]) / 2))].forEach(function (desc) {
                if (collider || !desc) return;
                try { collider = world.createCollider(desc.setMass(mass).setFriction(0.6).setRestitution(0.25).setCollisionGroups(groups(PART_HELD, GROUND)), body); } catch (e) { collider = null; }
            });
            if (!collider) { world.removeRigidBody(body); console.warn("Parts: no collider for '" + spec.object + "'"); return; }

            var hinge = spec.mode === "hinge" ? (spec.hinge || {}) : null;
            // the nodes that the part hangs on: given, or the nearest ones to its middle
            var nodes = spec.nodes ? spec.nodes.slice() : [];
            if (sb && !nodes.length) {
                var order = [];
                for (var k = 0; k < sb.count; k++) { sb.restPosition(k, a); order.push([a.distanceToSquared(centre), k]); }
                order.sort(function (x, y) { return x[0] - y[0]; });
                for (var n = 0; n < Math.min(3, order.length); n++) nodes.push(order[n][1]);
            }
            // a part with nodes of its own (the nodes of the layout that name it): they dent it, and the hold on the body is a link beam to each mount
            var group = [];
            if (sb && sb.partOf) for (var gk = 0; gk < sb.count; gk++) if (sb.partOf[gk] === spec.object) group.push(gk);
            if (group.length && !spec.nodes) nodes = group.slice();
            // a mount is a node of the shell or a point (in the frame of the car): a point is held by the nearest node of the body
            var mountList = hinge && sb ? (spec.mounts || []).filter(function (m) { return m && ((m.node >= 0 && m.node < sb.count) || (Array.isArray(m.point) && m.point.length === 3)); }).slice(0, 2).map(function (m) {
                var out = { node: m.node, break_force: m.break_force, activate_force: m.activate_force || 0, point: Array.isArray(m.point) ? new THREE.Vector3().fromArray(m.point) : null,
                    pin: m.axes !== undefined, axes: pinAxes(m.axes), rot: Array.isArray(m.rot) && m.rot.length === 4 ? new THREE.Quaternion(m.rot[0], m.rot[1], m.rot[2], m.rot[3]).normalize() : null, min: (m.min !== undefined ? m.min : -90) * DEG, max: (m.max !== undefined ? m.max : 90) * DEG };
                if (out.point) {
                    var best = 1e9;
                    out.node = 0;
                    for (var bk = 0; bk < sb.count; bk++) {
                        if (sb.partOf && sb.partOf[bk] === spec.object) continue;
                        sb.restPosition(bk, c);
                        var dist = out.point.distanceToSquared(c);
                        if (dist < best) { best = dist; out.node = bk; }
                    }
                }
                return out;
            }) : [];
            mountList.forEach(function (m) {
                if (!group.length) return;
                sb.restPosition(m.node, a);
                var nearest = group[0], best = 1e9;
                group.forEach(function (g) { sb.restPosition(g, c); var d = a.distanceToSquared(c); if (d < best) { best = d; nearest = g; } });
                m.beam = sb.addBeam(m.node, nearest, { break_force: m.break_force || 1e9, yield_force: (m.break_force || 1e9) * 0.5 });
            });
            parts.push({
                name: spec.object, spec: spec, object: object, body: body, collider: collider, centre: centre, mass: mass, nodes: nodes,
                hinge: hinge && {
                    origin: new THREE.Vector3().fromArray(hinge.origin || [centre.x, centre.y, centre.z]),
                    axis: new THREE.Vector3().fromArray(hinge.axis || [0, 1, 0]).normalize(),
                    min: (hinge.min !== undefined ? hinge.min : -90) * DEG, max: (hinge.max !== undefined ? hinge.max : 90) * DEG,
                    rest: (hinge.rest || 0) * DEG, spring: hinge.spring || 0, damper: hinge.damper || 0,
                    latch: hinge.latch_force !== undefined ? hinge.latch_force : (mountList.some(function (m) { return m.activate_force > 0; }) ? Infinity : mass * 9.81 * 3), breakForce: hinge.break_force || 0
                },
                breakForce: spec.break_force !== undefined ? spec.break_force : 0,
                // the points where the part is hinged to the body: nodes of the shell, each with the force at which it tears off
                mounts: mountList.map(function (m) {
                    return { node: m.node, breakForce: m.break_force || 0, activate: m.activate_force || 0, alive: true, beam: m.beam, point: m.point || sb.restPosition(m.node, new THREE.Vector3()), pin: m.pin, axes: m.axes, rot: m.rot, min: m.min, max: m.max };
                }),
                group: group.length ? spec.object : null,
                // held: sits on the car; hinged: swings on the joint; free: loose
                state: "held", joint: null, kept: null, grace: 0, lastVel: new THREE.Vector3(), load: 0, hasVel: false,
                parent: object.userData.partHome.parent, matrix: object.userData.partHome.matrix.clone(), autoUpdate: object.userData.partHome.autoUpdate
            });
        });
        if (!parts.length) return null;
        function emit(name, part) {
            events.push({ name: name, part: part.name, frame: frame });
            if (ctx.onEvent) ctx.onEvent(name, part);
        }

        // the part in the engine at the place it has on the car now (the nodes that it hangs on have moved it)
        function placeBody(part) {
            a.set(0, 0, 0);
            if (sb && part.nodes.length) {
                for (var i = 0; i < part.nodes.length; i++) {
                    sb.position(part.nodes[i], b); sb.restPosition(part.nodes[i], c);
                    a.add(b.sub(c));
                }
                a.multiplyScalar(1 / part.nodes.length);
            }
            a.add(part.centre);
            toWorld(a, b);
            part.body.setTranslation({ x: b.x, y: b.y, z: b.z }, true);
            part.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
            return b;
        }

        // the object of the model goes into the scene, and keeps the place it has
        function leaveModel(part) {
            var o = part.object;
            o.updateWorldMatrix(true, false);
            var top = o;
            while (top.parent) top = top.parent;
            tmpM.copy(o.matrixWorld);
            top.attach(o);
            o.matrixAutoUpdate = false;
            // the body in the world now, and the place of the object relative to it
            var p = part.body.translation(), r = part.body.rotation();
            bodyM.compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion(r.x, r.y, r.z, r.w), unit);
            part.visual = bodyM.clone().invert().multiply(tmpM);
            if (!part.group && ctx.softBodyMesh && ctx.softBodyMesh.release) ctx.softBodyMesh.release(o);      // a part with nodes of its own keeps the dents it has
        }

        function setGroups(part, free) {
            part.collider.setCollisionGroups(free ? groups(PART_FREE, GROUND | CHASSIS) : groups(PART_HELD, GROUND));
        }

        // The joint of a hinged part. Two mounts that hold: a hinge about the line between them. One: it swings about that point. None
        // (or a part without mounts): the hinge of the spec, about its origin and axis.
        function joinHinge(part) {
            if (part.joint) { world.removeImpulseJoint(part.joint, true); part.joint = null; }
            var h = part.hinge, alive = part.mounts.filter(function (m) { return m.alive; });
            var origin = h.origin, axis = h.axis;
            if (part.mounts.length) {
                if (alive.length === 0) return false;
                // pin points with axes (the part panel of the car editor): the first pin that holds is the joint; the others add to the hold
                var pin = alive.filter(function (m) { return m.pin; })[0];
                if (pin) {
                    var pa = { x: pin.point.x, y: pin.point.y, z: pin.point.z };
                    var pl = { x: pin.point.x - part.centre.x, y: pin.point.y - part.centre.y, z: pin.point.z - part.centre.z };
                    var on = ["x", "y", "z"].filter(function (k) { return pin.axes[k]; });
                    var ident = { x: 0, y: 0, z: 0, w: 1 };
                    if (on.length === 0) part.joint = world.createImpulseJoint(R.JointData.fixed(pa, ident, pl, ident), chassis, part.body, true);
                    else if (on.length > 1) part.joint = world.createImpulseJoint(R.JointData.spherical(pa, pl), chassis, part.body, true);
                    else {
                        // the axes of a pin can be turned (the editor): the axis is the one of the car, turned by the rotation of the pin
                        var ax = new THREE.Vector3(on[0] === "x" ? 1 : 0, on[0] === "y" ? 1 : 0, on[0] === "z" ? 1 : 0);
                        if (pin.rot) ax.applyQuaternion(pin.rot);
                        part.joint = world.createImpulseJoint(R.JointData.revolute(pa, pl, { x: ax.x, y: ax.y, z: ax.z }), chassis, part.body, true);
                        // the zero of the angles is the pin's own: turning the pin about its axis (its twist) shifts the range against the rest place of the part
                        var tau = 0;
                        if (pin.rot) {
                            tau = 2 * Math.atan2(pin.rot.x * (on[0] === "x" ? 1 : 0) + pin.rot.y * (on[0] === "y" ? 1 : 0) + pin.rot.z * (on[0] === "z" ? 1 : 0), pin.rot.w);
                            if (tau > Math.PI) tau -= 2 * Math.PI; else if (tau < -Math.PI) tau += 2 * Math.PI;
                        }
                        part.joint.setLimits(pin.min + tau, pin.max + tau);
                        if (h.spring > 0) part.joint.configureMotorPosition(h.rest, h.spring, h.damper);
                        else if (h.damper > 0) part.joint.configureMotorVelocity(0, h.damper);
                    }
                    return true;
                }
                origin = alive[0].point;
                if (alive.length >= 2) axis = new THREE.Vector3().subVectors(alive[1].point, alive[0].point).normalize();
            }
            var anchor = { x: origin.x, y: origin.y, z: origin.z };
            var local = { x: origin.x - part.centre.x, y: origin.y - part.centre.y, z: origin.z - part.centre.z };
            if (part.mounts.length && alive.length === 1) {
                part.joint = world.createImpulseJoint(R.JointData.spherical(anchor, local), chassis, part.body, true);
                return true;
            }
            part.joint = world.createImpulseJoint(R.JointData.revolute(anchor, local, { x: axis.x, y: axis.y, z: axis.z }), chassis, part.body, true);
            part.joint.setLimits(h.min, h.max);
            if (h.spring > 0) part.joint.configureMotorPosition(h.rest, h.spring, h.damper);
            else if (h.damper > 0) part.joint.configureMotorVelocity(0, h.damper);
            return true;
        }

        function startMoving(part, how) {
            var wasHeld = part.state === "held";
            if (wasHeld) {
                placeBody(part);
                part.body.setBodyType(R.RigidBodyType.Dynamic, true);
                pointVelocity(part.centre, b);
                part.body.setLinvel({ x: b.x, y: b.y, z: b.z }, true);
                part.body.setAngvel({ x: v.wx, y: v.wy, z: v.wz }, true);
                leaveModel(part);
                if (part.group && sb) sb.detachGroup(part.group);
            }
            if (how === "hinge") {
                joinHinge(part);
                part.state = "hinged";
                setGroups(part, false);
                emit("unlatched", part);
            } else {
                if (part.joint) { world.removeImpulseJoint(part.joint, true); part.joint = null; }
                part.state = "free";
                part.grace = GRACE;
                part.collider.setCollisionGroups(groups(PART_HELD, GROUND));      // not yet against the car, it is inside it
                emit("detached", part);
            }
        }

        // The load on a pin (N): the force in its link beam (a part with nodes of its own), the force of the shell on its node of the body, or the
        // inertia of the part shared over the pins that hold, whichever is more
        function mountLoad(part, m, holding) {
            var load = (part.inertia || 0) / Math.max(1, holding);
            if (sb) {
                sb.position(m.node, a); sb.restPosition(m.node, c);
                load = Math.max(load, a.distanceTo(c) * sb.params.anchorK);
                if (m.beam !== undefined) load = Math.max(load, Math.abs(sb.beamForce(m.beam)));
            }
            return load;
        }

        // A mount tears off when the load on it passes its force: the inertia of the part shared over the mounts that hold, or the force of
        // the shell on its node. With one mount left the part swings about it, with none it is free.
        function tearMounts(part) {
            var alive = part.mounts.filter(function (m) { return m.alive; });
            var changed = false;
            alive.forEach(function (m) {
                var shell = 0;
                if (sb) {
                    if (!sb.alive(m.node)) { m.alive = false; changed = true; return; }
                    sb.position(m.node, a); sb.restPosition(m.node, c);
                    shell = a.distanceTo(c) * sb.params.anchorK;
                }
                if (m.breakForce > 0 && Math.max(shell, (part.inertia || 0) / alive.length) > m.breakForce) { m.alive = false; changed = true; emit("mount torn", part); }
            });
            if (!changed) return;
            if (!part.mounts.some(function (m) { return m.alive; })) startMoving(part, "free");
            else joinHinge(part);
        }

        function update(dt) {
            dt = Math.min(Math.max(dt, 1e-4), 1 / 20);
            frame++;
            setPose();
            var moving = false;
            for (var i = 0; i < parts.length; i++) {
                var part = parts[i];
                // the load: inertia of the part (mass times the acceleration of its place) and the shell on its nodes
                pointVelocity(part.centre, b);
                var inertia = 0;
                if (part.hasVel) inertia = part.mass * b.distanceTo(part.lastVel) / dt;
                part.lastVel.copy(b); part.hasVel = true;
                var shell = 0, torn = false;
                if (sb) {
                    for (var k = 0; k < part.nodes.length; k++) {
                        var node = part.nodes[k];
                        if (!sb.alive(node) && part.state === "held") torn = true;      // (the nodes of a part that has come loose are gone on purpose)
                        sb.position(node, a); sb.restPosition(node, c);
                        shell = Math.max(shell, a.distanceTo(c) * sb.params.anchorK);
                    }
                }
                part.load = frame > 3 ? Math.max(inertia, shell) : 0;
                part.inertia = frame > 3 ? inertia : 0;

                if (part.state === "held" && part.mounts.length) {
                    // the pins: one that is loaded past its breaking force is gone; one that is loaded past its activation force lets the part open
                    var holding = part.mounts.filter(function (m) { return m.alive; });
                    var broke = false, activated = false;
                    holding.forEach(function (m) {
                        var pinLoad = frame > 3 ? mountLoad(part, m, holding.length) : 0;
                        if (m.breakForce > 0 && pinLoad > m.breakForce) { m.alive = false; broke = true; emit("mount torn", part); }
                        else if (m.pin && m.activate > 0 && pinLoad > m.activate) activated = true;
                    });
                    if (broke) {
                        if (part.mounts.some(function (m) { return m.alive; })) startMoving(part, "hinge"); else startMoving(part, "free");
                    } else if (activated && part.hinge) startMoving(part, "hinge");
                }
                if (part.state === "held" && sb && part.mounts.length) {
                    // a link beam of a mount tore (the hold of a part with nodes of its own): that mount is gone, the part opens on the others
                    var lost = false;
                    part.mounts.forEach(function (m) { if (m.alive && m.beam !== undefined && !sb.beamAlive[m.beam]) { m.alive = false; lost = true; emit("mount torn", part); } });
                    if (lost) {
                        if (part.mounts.some(function (m) { return m.alive; })) startMoving(part, "hinge"); else startMoving(part, "free");
                    }
                }
                if (part.state === "held") {
                    if (part.hinge) {
                        if (!part.hinge.latch || part.load > part.hinge.latch || torn) startMoving(part, "hinge");
                    } else if (torn || (part.breakForce > 0 && part.load > part.breakForce)) startMoving(part, "free");
                } else if (part.state === "hinged") {
                    if (part.mounts.length) tearMounts(part);
                    if (part.state === "hinged" && (torn || (part.hinge.breakForce > 0 && part.load > part.hinge.breakForce))) startMoving(part, "free");
                }
                if (part.state !== "held") moving = true;
                if (part.grace > 0) {
                    part.grace -= dt;
                    if (part.grace <= 0) setGroups(part, true);
                }
            }
            if (!moving) return;
            refreshTrack();
            // two steps of half the time: a part that flies at 30 m/s hits the wall in the middle of a frame, not after it
            world.timestep = dt / 2;
            world.step();
            world.step();
            for (var j = 0; j < parts.length; j++) {
                var p = parts[j];
                if (p.state === "held") continue;
                var t = p.body.translation(), r = p.body.rotation();
                bodyM.compose(a.set(t.x, t.y, t.z), qInv.set(r.x, r.y, r.z, r.w), unit);
                p.object.matrix.multiplyMatrices(bodyM, p.visual);
                p.object.matrixWorldNeedsUpdate = true;
            }
        }

        // the static mesh of the track near the parts that move (not near the car: a part flies off), made again when one has gone further
        function refreshTrack() {
            var ground = v.ground;
            if (!ground || !ground.nearby) return;
            var stale = !trackCollider;
            for (var i = 0; i < parts.length && !stale; i++) {
                var p = parts[i];
                if (p.state === "held") continue;
                var t = p.body.translation();
                if (!p.region || Math.abs(t.x - p.region.x) > 4 || Math.abs(t.y - p.region.y) > 4 || Math.abs(t.z - p.region.z) > 4) stale = true;
            }
            if (!stale) return;
            var wanted = new Set();
            for (var j = 0; j < parts.length; j++) {
                var q2 = parts[j];
                if (q2.state === "held") continue;
                var u = q2.body.translation();
                q2.region = { x: u.x, y: u.y, z: u.z };
                ground.nearby(u.x, u.y, u.z, 9, candidates);
                for (var k = 0; k < candidates.length; k++) wanted.add(candidates[k]);
            }
            if (trackCollider) { world.removeCollider(trackCollider, false); trackCollider = null; }
            if (!wanted.size) return;
            var verts = new Float32Array(wanted.size * 9), index = new Uint32Array(wanted.size * 3), n = 0;
            wanted.forEach(function (tri) {
                ground.vertices(tri, corner);
                for (var m = 0; m < 9; m++) verts[n * 9 + m] = corner[m];
                index[n * 3] = n * 3; index[n * 3 + 1] = n * 3 + 1; index[n * 3 + 2] = n * 3 + 2;
                n++;
            });
            trackCollider = world.createCollider(R.ColliderDesc.trimesh(verts, index).setFriction(0.8).setRestitution(0.2).setCollisionGroups(groups(GROUND, PART_FREE | PART_HELD)), trackBody);
        }

        // the car is repaired: every part is back on it
        function repair() {
            for (var i = 0; i < parts.length; i++) {
                var p = parts[i];
                if (p.joint) { world.removeImpulseJoint(p.joint, true); p.joint = null; }
                if (p.state !== "held") {
                    p.body.setBodyType(R.RigidBodyType.KinematicPositionBased, true);
                    setGroups(p, false);
                    p.parent.add(p.object);
                    restoreHome(p.object, p.object.userData.partHome);
                    p.object.traverse(function (m) { if (m.userData && m.userData.sbDeform) m.userData.sbDeform.value = 1; });
                }
                p.mounts.forEach(function (m) { m.alive = true; });
                p.state = "held"; p.hasVel = false; p.grace = 0; p.region = null;
            }
        }

        return {
            world: world, parts: parts, events: events, update: update, repair: repair,
            // the car is taken out of the scene (the car editor makes a new one for every test): the parts that were thrown out of it go with it
            dispose: function () { parts.forEach(function (p) { if (p.state !== "held" && p.object.parent) p.object.parent.remove(p.object); }); },
            states: function () { return parts.map(function (p) { return p.name + ":" + p.state; }).join(" "); }
        };
    }

    return { create: create, build: build };
})();
