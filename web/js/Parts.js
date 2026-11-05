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
 *                "breakable"  sits on the car until the load passes break_force (N), then it breaks (glass, a lamp): it is gone, and in its place are its
 *                             pieces and particles (Shatter.js). "shatter": { pieces: "faces" (the faces of the part, in clusters of at most max_pieces), "mesh"
 *                             (the pieces of the hidden object <object>_broken of the model) or "none"; max_pieces (40); particles (a number, 120); particle:
 *                             "shards", "splinters" or "grains"; material: glass, tinted, red, orange, white, black, chrome (the colour of the particles; colour,
 *                             "#rrggbb", goes before it); size (m, 0.012) }.
 *
 *              An object of the model whose name ends in "_broken" is the broken form of a part: it is not seen and it is not a part of the physics
 *              (hideBroken, when the model is loaded).
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
    var MAX_PART_FORCE = 300000;                                   // N: the most that a hinged part puts on the car or on an object in one step
    var GROUND = 1, CHASSIS = 2, PART_FREE = 4, PART_HELD = 8, OBJ_COPY = 16;       // the groups of collisions (OBJ_COPY: the copies of the rigid objects of the track that the parts meet)
    var GRACE = 0.35;                                               // s after coming loose in which a part does not hit the car (it is inside it)
    var DEG = Math.PI / 180;

    // "axes" of a pin point: { x, y, z } of booleans, or a list like ["x"]; one axis is a hinge, more is a ball, none is a rigid pin
    function pinAxes(axes) {
        if (Array.isArray(axes)) { var o = { x: false, y: false, z: false }; axes.forEach(function (k) { o[String(k).toLowerCase()] = true; }); return o; }
        if (axes && typeof axes === "object") return { x: !!axes.x, y: !!axes.y, z: !!axes.z };
        return { x: true, y: false, z: false };
    }

    function groups(membership, filter) { return ((membership << 16) | filter) >>> 0; }
    // the angles a pin may turn through about each of its axes (radians): "limits": { x: [min, max], y: [...], z: [...] } in degrees, or min and max for all of them
    function pinLimits(m) {
        var out = {};
        ["x", "y", "z"].forEach(function (k) {
            var l = m.limits && Array.isArray(m.limits[k]) && m.limits[k].length === 2 ? m.limits[k] : [m.min !== undefined ? m.min : -90, m.max !== undefined ? m.max : 90];
            out[k] = [Math.min(l[0], l[1]) * DEG, Math.max(l[0], l[1]) * DEG];
        });
        return out;
    }
    var AXIS_OF = { x: 3, y: 4, z: 5 }, LOCK_OF = { x: 8, y: 16, z: 32 }, LOCK_LINEAR = 7;        // (Rapier: JointAxis.AngX..AngZ, JointAxesMask.LinX|LinY|LinZ and AngX..AngZ)

    // ---- the broken forms of parts: an object named <part>_broken (and what is in it) is hidden, and the physics leaves it out (CollisionProxy.js, the shapes of the parts,
    // the shell on the model); a part that breaks into "mesh" pieces takes them from it
    var BROKEN = /_broken$/i;
    function hideBroken(root) {
        if (!root) return 0;
        var n = 0;
        root.traverse(function (o) {
            if (!o.name || !BROKEN.test(o.name)) return;
            o.visible = false; n++;
            o.traverse(function (m) { m.userData = m.userData || {}; m.userData.brokenPiece = true; m.userData.noCollision = true; });
        });
        return n;
    }
    function isBroken(o) { return !!(o && o.userData && o.userData.brokenPiece); }

    // the colours of the particles of a material (linear)
    function lin(c) { return [Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2)]; }
    var PARTICLE_COLOURS = {
        glass: lin([0.86, 0.93, 1.0]).map(function (x) { return x * 1.5; }), tinted: lin([0.28, 0.32, 0.36]), red: lin([0.85, 0.06, 0.04]), orange: lin([1.0, 0.5, 0.08]),
        white: lin([0.93, 0.93, 0.9]), black: lin([0.05, 0.05, 0.055]), chrome: lin([0.82, 0.83, 0.86]).map(function (x) { return x * 1.3; })
    };
    var PARTICLE_SHAPES = { shards: 0, splinters: 1, grains: 2 };
    function particleColour(sh) {
        var hex = typeof sh.colour === "string" && /^#?[0-9a-f]{6}$/i.test(sh.colour) ? sh.colour.replace("#", "") : null;
        if (hex) return lin([parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255]);
        return PARTICLE_COLOURS[sh.material] || PARTICLE_COLOURS.glass;
    }
    // a number for a breakable part that follows from the model (its name, its size and its place), the same in a replay that builds the car again
    function keyOf(text) { var h = 2166136261; for (var i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) % 16777216; }

    // The pieces of a part that breaks: the faces of the meshes of source (the part, or its _broken object), in the frame of source, in at most max clusters (by
    // material, the nearest faces together); with byMesh every mesh is a piece of its own and a single mesh is cut where it falls apart (its islands). Each piece:
    // { geometry (around its middle), material, centre, flat (the normal of its flat side), half (its half thickness), radius }
    function piecesOf(source, max, byMesh, others) {
        var skip = new Set(others || []);
        function ofOther(m) { for (var o = m; o && o !== source; o = o.parent) if (skip.has(o)) return true; return false; }
        source.updateWorldMatrix(true, true);
        var inv = new THREE.Matrix4().copy(source.matrixWorld).invert(), rel = new THREE.Matrix4(), nm = new THREE.Matrix3();
        var buckets = new Map();             // material -> [units]; a unit: { tris: [[ax, ay, az, bx, ..., nx.. (9), u.. (6)]], centre }
        var meshes = [];
        source.traverse(function (m) { if (m.isMesh && m.geometry && m.geometry.attributes.position && (byMesh || !isBroken(m)) && !ofOther(m)) meshes.push(m); });
        var a = new THREE.Vector3(), n = new THREE.Vector3();
        meshes.forEach(function (mesh) {
            var g = mesh.geometry, P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, I = g.index;
            rel.multiplyMatrices(inv, mesh.matrixWorld); nm.getNormalMatrix(rel);
            var mats = mesh.userData && mesh.userData.sbOriginal ? mesh.userData.sbOriginal : mesh.material;
            var count = I ? I.count : P.count, groupsOf = g.groups && g.groups.length ? g.groups : [{ start: 0, count: count, materialIndex: 0 }];
            groupsOf.forEach(function (gr) {
                var mat = Array.isArray(mats) ? mats[gr.materialIndex || 0] : mats;
                if (!mat) return;
                var tris = [];
                for (var t = gr.start; t + 2 < Math.min(count, gr.start + gr.count); t += 3) {
                    var tri = new Float32Array(24), idx = [I ? I.getX(t) : t, I ? I.getX(t + 1) : t + 1, I ? I.getX(t + 2) : t + 2];
                    for (var k = 0; k < 3; k++) {
                        a.fromBufferAttribute(P, idx[k]).applyMatrix4(rel); tri[k * 3] = a.x; tri[k * 3 + 1] = a.y; tri[k * 3 + 2] = a.z;
                        if (N) { n.fromBufferAttribute(N, idx[k]).applyMatrix3(nm).normalize(); tri[9 + k * 3] = n.x; tri[10 + k * 3] = n.y; tri[11 + k * 3] = n.z; }
                        if (U) { tri[18 + k * 2] = U.getX(idx[k]); tri[19 + k * 2] = U.getY(idx[k]); }
                    }
                    tri.vertex = idx;
                    tris.push(tri);
                }
                if (!tris.length) return;
                var units = [];
                if (!byMesh) tris.forEach(function (tri) { units.push({ tris: [tri] }); });
                else if (meshes.length > 1) units.push({ tris: tris });
                else units = islands(tris);
                if (!buckets.has(mat)) buckets.set(mat, []);
                Array.prototype.push.apply(buckets.get(mat), units);
            });
        });
        var total = 0;
        buckets.forEach(function (units) { units.forEach(function (u) { u.centre = centreOf(u.tris); }); total += units.length; });
        var out = [];
        buckets.forEach(function (units, mat) {
            var budget = Math.max(1, Math.round(max * units.length / Math.max(1, total)));
            clusters(units, budget).forEach(function (tris) { out.push(pieceOf(tris, mat)); });
        });
        return out;
    }
    function centreOf(tris) {
        var c = new THREE.Vector3(), n = 0;
        tris.forEach(function (t) { for (var k = 0; k < 3; k++) { c.x += t[k * 3]; c.y += t[k * 3 + 1]; c.z += t[k * 3 + 2]; n++; } });
        return c.divideScalar(Math.max(1, n));
    }
    // the parts of a mesh that hang together (by the places of their corners: a model that was cut into cells has them apart)
    function islands(tris) {
        var parent = tris.map(function (t, i) { return i; }), owner = {};
        function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
        tris.forEach(function (t, i) {
            for (var k = 0; k < 3; k++) {
                var key = Math.round(t[k * 3] * 2000) + "," + Math.round(t[k * 3 + 1] * 2000) + "," + Math.round(t[k * 3 + 2] * 2000);
                if (owner[key] === undefined) owner[key] = i; else { var r1 = find(i), r2 = find(owner[key]); if (r1 !== r2) parent[r1] = r2; }
            }
        });
        var byRoot = {};
        tris.forEach(function (t, i) { var r = find(i); (byRoot[r] = byRoot[r] || []).push(t); });
        return Object.keys(byRoot).map(function (r) { return { tris: byRoot[r] }; });
    }
    // the units in at most n groups: n of them spread over the list are the seeds, and every unit goes to the nearest seed
    function clusters(units, n) {
        if (units.length <= n) return units.map(function (u) { return u.tris; });
        var seeds = [], step = units.length / n;
        for (var i = 0; i < n; i++) seeds.push(units[Math.floor(i * step)].centre);
        var groupsOut = seeds.map(function () { return []; });
        units.forEach(function (u) {
            var best = 0, bd = Infinity;
            for (var k = 0; k < seeds.length; k++) { var d = u.centre.distanceToSquared(seeds[k]); if (d < bd) { bd = d; best = k; } }
            Array.prototype.push.apply(groupsOut[best], u.tris);
        });
        return groupsOut.filter(function (g) { return g.length; });
    }
    function pieceOf(tris, mat) {
        var centre = centreOf(tris), count = tris.length * 3;
        var P = new Float32Array(count * 3), N = new Float32Array(count * 3), U = new Float32Array(count * 2);
        var flat = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), f = new THREE.Vector3();
        tris.forEach(function (t, i) {
            for (var k = 0; k < 3; k++) {
                P[(i * 3 + k) * 3] = t[k * 3] - centre.x; P[(i * 3 + k) * 3 + 1] = t[k * 3 + 1] - centre.y; P[(i * 3 + k) * 3 + 2] = t[k * 3 + 2] - centre.z;
                N[(i * 3 + k) * 3] = t[9 + k * 3]; N[(i * 3 + k) * 3 + 1] = t[10 + k * 3]; N[(i * 3 + k) * 3 + 2] = t[11 + k * 3];
                U[(i * 3 + k) * 2] = t[18 + k * 2]; U[(i * 3 + k) * 2 + 1] = t[19 + k * 2];
            }
            e1.set(t[3] - t[0], t[4] - t[1], t[5] - t[2]); e2.set(t[6] - t[0], t[7] - t[1], t[8] - t[2]);
            f.crossVectors(e1, e2);
            if (flat.dot(f) < 0) f.negate();                      // (both sides of a thin piece point the same way)
            flat.add(f);
        });
        if (flat.lengthSq() < 1e-12) flat.set(0, 1, 0);
        flat.normalize();
        var half = 0, radius = 0;
        for (var j = 0; j < count; j++) {
            var x = P[j * 3], y = P[j * 3 + 1], z = P[j * 3 + 2];
            half = Math.max(half, Math.abs(x * flat.x + y * flat.y + z * flat.z)); radius = Math.max(radius, Math.hypot(x, y, z));
        }
        var geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(P, 3));
        geometry.setAttribute("normal", new THREE.BufferAttribute(N, 3));
        geometry.setAttribute("uv", new THREE.BufferAttribute(U, 2));
        if (!tris[0] || (tris[0][9] === 0 && tris[0][10] === 0 && tris[0][11] === 0)) geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        return { geometry: geometry, material: mat, centre: centre, flat: flat, half: Math.max(0.002, half), radius: Math.max(0.01, radius) };
    }

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
        if ((!ctx.specs || !ctx.specs.length) && !ctx.wheelObjects) return Promise.resolve(null);
        var shapes = (ctx.specs || []).map(function (spec) { return shapeOf(spec, ctx); });      // now: the model is in the frame of the car only at this moment
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
            if (!mesh.isMesh || !mesh.geometry || !mesh.geometry.attributes.position || isBroken(mesh)) return;
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
        return { object: object, centre: centre, local: local, lo: lo, hi: hi, count: pts.length / 3 };
    }

    // R: the engine. ctx: { vehicle, softBody, softBodyMesh, spheres (of the shell), specs ([the "parts" of car.json]), root (the model),
    //                       toVehicle(p) (as in CollisionProxy.js), onEvent(name, part) }
    function build(R, ctx, shapes) {
        var v = ctx.vehicle, sb = ctx.softBody;
        var world = new R.World({ x: 0, y: -9.81, z: 0 });
        var chassis = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
        ctx.spheres.forEach(function (s) {
            world.createCollider(R.ColliderDesc.ball(s.wheel || s.hub ? s.r / 0.55 : s.r).setTranslation(s.x, s.y, s.z).setCollisionGroups(groups(CHASSIS, PART_FREE)), chassis);
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
        var ROT_WEIGHT = 1.5;           // the turning of the car counts a half more than the sums say: the angular speed of the car is smoothed by the physics, and a hit turns it in a few ms
        var rotArm = new THREE.Vector3(), cgAcc = new THREE.Vector3(), angAcc = new THREE.Vector3(), lastCG = new THREE.Vector3(), lastW = new THREE.Vector3(), haveFrame = false;
        function pointVelocity(p, out) {
            a.copy(p).applyQuaternion(q);
            return out.set(v.vx + v.wy * a.z - v.wz * a.y, v.vy + v.wz * a.x - v.wx * a.z, v.vz + v.wx * a.y - v.wy * a.x);
        }

        // ---- the parts
        (ctx.specs || []).forEach(function (spec, index) {
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
                try { collider = world.createCollider(desc.setMass(mass).setFriction(0.8).setRestitution(0.12).setCollisionGroups(groups(PART_HELD, GROUND)), body); } catch (e) { collider = null; }
            });
            if (!collider) { world.removeRigidBody(body); console.warn("Parts: no collider for '" + spec.object + "'"); return; }

            var hinge = spec.mode === "hinge" ? (spec.hinge || {}) : null;
            // the nodes that the part hangs on: given, or the nearest ones to its middle
            var nodes = spec.nodes ? spec.nodes.slice() : [];
            if (sb && !nodes.length) {
                var order = [];
                for (var k = 0; k < (sb.bodyCount || sb.count); k++) { sb.restPosition(k, a); order.push([a.distanceToSquared(centre), k]); }
                order.sort(function (x, y) { return x[0] - y[0]; });
                for (var n = 0; n < Math.min(3, order.length); n++) nodes.push(order[n][1]);
            }
            // a part with nodes of its own (the nodes of the layout that name it): they dent it, and the hold on the body is a link beam to each mount
            var group = [];
            if (sb && sb.partOf) for (var gk = 0; gk < (sb.bodyCount || sb.count); gk++) if (sb.partOf[gk] === spec.object) group.push(gk);
            if (group.length && !spec.nodes) nodes = group.slice();
            // a mount is a node of the shell or a point (in the frame of the car): a point is held by the nearest node of the body
            // (a car without a shell, Dents off: the points hold the part as they are; there is no node to hold them, they did not count at all)
            var mountList = hinge ? (spec.mounts || []).filter(function (m) { return m && ((sb && m.node >= 0 && m.node < sb.count) || (Array.isArray(m.point) && m.point.length === 3)); }).slice(0, 2).map(function (m) {
                var out = { node: m.node, break_force: m.break_force, activate_force: m.activate_force || 0, point: Array.isArray(m.point) ? new THREE.Vector3().fromArray(m.point) : null,
                    pin: m.axes !== undefined, axes: pinAxes(m.axes), rot: Array.isArray(m.rot) && m.rot.length === 4 ? new THREE.Quaternion(m.rot[0], m.rot[1], m.rot[2], m.rot[3]).normalize() : null, min: (m.min !== undefined ? m.min : -90) * DEG, max: (m.max !== undefined ? m.max : 90) * DEG,
                    limits: pinLimits(m) };
                if (out.point && sb) {
                    var best = 1e9;
                    out.node = 0;
                    for (var bk = 0; bk < (sb.bodyCount || sb.count); bk++) {
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
            // a part that breaks (glass, a lamp): what it breaks into (Shatter.js)
            var shatter = null;
            if (spec.mode === "breakable") {
                var sh = spec.shatter || {};
                var how = sh.pieces === "mesh" || sh.pieces === "none" ? sh.pieces : "faces";
                var brokenObject = how === "mesh" ? ctx.root.getObjectByName(spec.object + "_broken") : null;
                if (how === "mesh" && !brokenObject) { console.warn("Parts: no object '" + spec.object + "_broken' in the model; '" + spec.object + "' breaks into its faces"); how = "faces"; }
                var maxPieces = Math.max(1, Math.min(120, Math.round(sh.max_pieces || 40)));
                shatter = {
                    how: how, source: brokenObject || object, max: maxPieces,
                    key: keyOf(spec.object + "|" + shape.count + "|" + Math.round(centre.x * 100) + "," + Math.round(centre.y * 100) + "," + Math.round(centre.z * 100) + "|" + how + "|" + maxPieces),
                    particles: sh.particles !== undefined ? Math.max(0, sh.particles) : 120, kind: PARTICLE_SHAPES[sh.particle] !== undefined ? PARTICLE_SHAPES[sh.particle] : 0,
                    colour: particleColour(sh), size: sh.size > 0 ? sh.size : 0.012
                };
                if (OpenRacer.Shatter) (function (info, holder) {
                    OpenRacer.Shatter.register(info.key, {
                        build: function () { return info.how === "none" ? [] : piecesOf(info.source, info.max, info.how === "mesh", parts.filter(function (x) { return x.object !== holder; }).map(function (x) { return x.object; })); },
                        top: function () { var t = holder; while (t.parent) t = t.parent; return t.isScene ? t : null; },
                        ground: function () { return v.ground; }
                    });
                })(shatter, object);
            }
            parts.push({
                shatter: shatter,
                name: spec.object, spec: spec, object: object, body: body, collider: collider, centre: centre, mass: mass, nodes: nodes,
                hinge: hinge && {
                    origin: new THREE.Vector3().fromArray(hinge.origin || [centre.x, centre.y, centre.z]),
                    axis: new THREE.Vector3().fromArray(hinge.axis || [0, 1, 0]).normalize(),
                    min: (hinge.min !== undefined ? hinge.min : -90) * DEG, max: (hinge.max !== undefined ? hinge.max : 90) * DEG,
                    rest: (hinge.rest || 0) * DEG, spring: hinge.spring || 0, damper: hinge.damper || 0,
                    latch: hinge.latch_force !== undefined ? hinge.latch_force : (mountList.some(function (m) { return m.activate_force > 0; }) ? Infinity : mass * 9.81 * 3), breakForce: hinge.break_force || 0
                },
                breakForce: spec.break_force !== undefined ? spec.break_force : 0,
                breakDelay: spec.break_delay !== undefined ? spec.break_delay : 0.15, breakTimer: null,
                // the points where the part is hinged to the body: nodes of the shell, each with the force at which it tears off
                mounts: mountList.map(function (m) {
                    return { node: m.node, breakForce: m.break_force || 0, activate: m.activate_force || 0, alive: true, beam: m.beam, point: m.point || sb.restPosition(m.node, new THREE.Vector3()), pin: m.pin, axes: m.axes, rot: m.rot, min: m.min, max: m.max, limits: m.limits };
                }),
                group: group.length ? spec.object : null,
                // held: sits on the car; hinged: swings on the joint; free: loose
                state: "held", joint: null, kept: null, grace: 0, lastVel: new THREE.Vector3(), load: 0, hasVel: false,
                parent: object.userData.partHome.parent, matrix: object.userData.partHome.matrix.clone(), autoUpdate: object.userData.partHome.autoUpdate
            });
        });
        // the wheels: a wheel that a hit has torn off (Vehicle.js, wheelLost) becomes a body that rolls away
        if (ctx.wheelObjects) ctx.wheelObjects.forEach(function (wheelObject, wi) {
            var w = v.wheels[wi];
            if (!wheelObject || !w) return;
            var half = 0.12, box = new THREE.Box3().setFromObject(wheelObject);
            if (!box.isEmpty()) { var sz = box.getSize(new THREE.Vector3()); half = Math.min(0.25, Math.max(0.07, Math.min(sz.x, sz.y, sz.z) / 2)); }
            var wbody = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setCcdEnabled(true));
            var s2 = Math.SQRT1_2;
            var wcollider = world.createCollider(R.ColliderDesc.cylinder(half, w.radius).setRotation({ x: 0, y: 0, z: s2, w: s2 }).setMass(w.mass || 20).setFriction(0.9).setRestitution(0.3).setCollisionGroups(groups(PART_HELD, GROUND)), wbody);
            parts.push({ name: "wheel " + (w.name || wi), wheel: wi, object: wheelObject, body: wbody, collider: wcollider, centre: new THREE.Vector3(), mass: w.mass || 20, nodes: [], mounts: [], hinge: null,
                breakForce: 0, state: "held", joint: null, grace: 0, lastVel: new THREE.Vector3(), load: 0, hasVel: false, spec: {} });
        });
        // parts on parts: a part whose object is in the object of another part (the glass of a door, a holder on a bumper) goes with it; while that one moves its load is
        // measured against it (a holder breaks off when the bumper lands hard), and when it comes off it starts where it is on it
        parts.forEach(function (p) { p.children = []; p.parentPart = null; });
        parts.forEach(function (p) {
            if (p.wheel !== undefined) return;
            for (var o = p.object.parent; o && !p.parentPart; o = o.parent) for (var k = 0; k < parts.length; k++) if (parts[k] !== p && parts[k].wheel === undefined && parts[k].object === o) { p.parentPart = parts[k]; parts[k].children.push(p); break; }
        });
        if (!parts.length) return null;
        function emit(name, part) {
            events.push({ name: name, part: part.name, frame: frame });
            if (ctx.onEvent) ctx.onEvent(name, part);
        }

        // the part in the engine at the place it has on the car now (the nodes that it hangs on have moved it)
        // a part on a part that moves: its place and its speed on the body of that part (from where it was on it when that one came off)
        var onP = new THREE.Vector3(), onQ = new THREE.Quaternion();
        function onMovingParent(part) { var pp = part.parentPart; return !!(pp && part.onParent && (pp.state === "hinged" || pp.state === "free")); }
        function parentPoint(part, outPos, outVel) {
            var body = part.parentPart.body, t = body.translation(), r = body.rotation(), lv = body.linvel(), av = body.angvel();
            onQ.set(r.x, r.y, r.z, r.w);
            outPos.copy(part.onParent).applyQuaternion(onQ).add(onP.set(t.x, t.y, t.z));
            if (outVel) { onP.subVectors(outPos, onP); outVel.set(lv.x + av.y * onP.z - av.z * onP.y, lv.y + av.z * onP.x - av.x * onP.z, lv.z + av.x * onP.y - av.y * onP.x); }
            return onQ;
        }
        // when a part comes off, the parts on it keep their place on its body
        function holdChildren(part) {
            var t = part.body.translation(), r = part.body.rotation();
            onQ.set(r.x, r.y, r.z, r.w).invert();
            part.children.forEach(function (ch) {
                if (ch.state !== "held") return;
                toWorld(ch.centre, c);
                ch.onParent = new THREE.Vector3(c.x - t.x, c.y - t.y, c.z - t.z).applyQuaternion(onQ);
                ch.hasVel = false;
            });
        }
        function placeBody(part) {
            if (onMovingParent(part)) {
                var rq = parentPoint(part, b, null);
                part.body.setTranslation({ x: b.x, y: b.y, z: b.z }, true);
                part.body.setRotation({ x: rq.x, y: rq.y, z: rq.z, w: rq.w }, true);
                return b;
            }
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
            part.collider.setCollisionGroups(free ? groups(PART_FREE, GROUND | CHASSIS | OBJ_COPY) : groups(PART_HELD, GROUND | OBJ_COPY));
        }

        // A part that has come loose hits the car only when it is clear of it: a part that is inside the car (or touching it, like a door that
        // is shut) when the contact starts is pushed out at a great speed (a bumper that flew off through the road)
        var CLEAR_WAIT = 3;                                             // s after the grace in which it can become clear; then it stays a ghost to the car
        function clearOfCar(part) {
            var t = part.body.translation(), r = part.body.rotation();
            return !world.intersectionWithShape(t, r, part.collider.shape, undefined, groups(PART_FREE, CHASSIS));
        }
        function waitForClear(part) {
            part.grace = GRACE;
            part.pending = true;
            setGroups(part, false);
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
                    else if (on.length > 1) {
                        // more than one axis: a joint that holds the place and the axes that are not free, and lets the free ones turn, each between its own limits (it was a
                        // ball without limits). Its frame is the pin's: the axes of the car turned as the pin is (a turn of the pin about its own X is not in it)
                        var fx = new THREE.Vector3(1, 0, 0);
                        if (pin.rot) fx.applyQuaternion(pin.rot);
                        var axisData = { x: fx.x, y: fx.y, z: fx.z };
                        // the engine makes its own Y and Z from the axis it is given (with X along the car: its Y is -Z of the car, its Z is +Y): the frame is read
                        // from a first joint with every turn free, and each of the axes of the pin goes to the axis of the engine that it lies along (with its sign)
                        var probe = world.createImpulseJoint(R.JointData.generic(pa, pl, axisData, LOCK_LINEAR), chassis, part.body, true);
                        var fr = probe.frameX1(), frame = new THREE.Quaternion(fr.x, fr.y, fr.z, fr.w);
                        world.removeImpulseJoint(probe, true);
                        var mask = LOCK_LINEAR, engineLimits = [];
                        ["x", "y", "z"].forEach(function (ek, ei) {
                            var engineAxis = new THREE.Vector3(ei === 0 ? 1 : 0, ei === 1 ? 1 : 0, ei === 2 ? 1 : 0).applyQuaternion(frame);
                            var best = null, bestDot = 0;
                            ["x", "y", "z"].forEach(function (k) {
                                var own = new THREE.Vector3(k === "x" ? 1 : 0, k === "y" ? 1 : 0, k === "z" ? 1 : 0);
                                if (pin.rot) own.applyQuaternion(pin.rot);
                                var d = own.dot(engineAxis);
                                if (Math.abs(d) > Math.abs(bestDot)) { bestDot = d; best = k; }
                            });
                            if (!best || !pin.axes[best]) { mask |= LOCK_OF[ek]; return; }
                            var l = pin.limits[best];
                            engineLimits.push([AXIS_OF[ek], bestDot > 0 ? l[0] : -l[1], bestDot > 0 ? l[1] : -l[0]]);
                        });
                        part.joint = world.createImpulseJoint(R.JointData.generic(pa, pl, axisData, mask), chassis, part.body, true);
                        engineLimits.forEach(function (l) { part.joint.rawSet.jointSetLimits(part.joint.handle, l[0], l[1], l[2]); });
                        var first = new THREE.Vector3(on[0] === "x" ? 1 : 0, on[0] === "y" ? 1 : 0, on[0] === "z" ? 1 : 0);
                        if (pin.rot) first.applyQuaternion(pin.rot);
                        part.jointAxis = first; part.jointLimits = pin.limits[on[0]].slice(); part.jointAt = pin.point;
                    }
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
                        var lim = pin.limits ? pin.limits[on[0]] : [pin.min, pin.max];
                        part.joint.setLimits(lim[0] + tau, lim[1] + tau);
                        part.jointAxis = ax.clone(); part.jointLimits = [lim[0] + tau, lim[1] + tau]; part.jointAt = pin.point;
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
            part.jointAxis = new THREE.Vector3(axis.x, axis.y, axis.z); part.jointLimits = [h.min, h.max]; part.jointAt = origin;
            if (h.spring > 0) part.joint.configureMotorPosition(h.rest, h.spring, h.damper);
            else if (h.damper > 0) part.joint.configureMotorVelocity(0, h.damper);
            return true;
        }

        // grace and clear: a part that has come loose hits the car when it is clear of it
        function settle(part, dt) {
            if (!part.pending) return;
            part.grace -= dt;
            if (part.grace > 0) return;
            if (clearOfCar(part)) { setGroups(part, true); part.pending = false; }
            else if (part.grace < -CLEAR_WAIT) part.pending = false;      // it never got clear: it goes through the car, but not through the road
        }

        // a wheel that was torn off: it keeps the place and the speed it had, and the spin of the wheel
        function startWheel(part) {
            var o = part.object, w = v.wheels[part.wheel];
            o.updateWorldMatrix(true, false);
            o.matrixWorld.decompose(a, qInv, c);
            part.body.setTranslation({ x: a.x, y: a.y, z: a.z }, true);
            part.body.setRotation({ x: qInv.x, y: qInv.y, z: qInv.z, w: qInv.w }, true);
            part.body.setBodyType(R.RigidBodyType.Dynamic, true);
            b.set(a.x - v.px, a.y - v.py, a.z - v.pz);
            part.body.setLinvel({ x: v.vx + v.wy * b.z - v.wz * b.y, y: v.vy + v.wz * b.x - v.wx * b.z, z: v.vz + v.wx * b.y - v.wy * b.x }, true);
            c.set(1, 0, 0).applyQuaternion(qInv);                       // the axle of the wheel in the world
            var spin = v.wheelSpinAtLoss[part.wheel] || 0;
            part.body.setAngvel({ x: v.wx + c.x * spin, y: v.wy + c.y * spin, z: v.wz + c.z * spin }, true);
            leaveModel(part);
            part.state = "free";
            part.body.setAngularDamping(0.1); part.body.setLinearDamping(0.05);
            waitForClear(part);
            emit("wheel torn", part);
        }

        // a part that comes off: a breakable one breaks, the others fall off
        function comeOff(part) { if (part.shatter) shatterPart(part); else startMoving(part, "free"); }
        // A part breaks: it is gone at once (hidden, out of the physics, its own nodes out of the shell), and its pieces fly off with the speed that the car has
        // at their place and a little more outward and up, turning; the particles with them (Shatter.js)
        var shatterQ = new THREE.Quaternion(), shatterP = new THREE.Vector3(), shatterS = new THREE.Vector3(), shatterM = new THREE.Matrix4(), carInv = new THREE.Quaternion();
        function shatterPart(part) {
            if (part.state === "broken") return;
            part.children.forEach(function (ch) { if (ch.state === "held") comeOff(ch); });       // (what is on it falls off: there is nothing to hold it)
            var info = part.shatter, o = part.object;
            o.updateWorldMatrix(true, true);
            info.source.updateWorldMatrix(true, true);
            part.state = "broken"; part.breakTimer = null;
            if (part.joint) { world.removeImpulseJoint(part.joint, true); part.joint = null; }
            part.collider.setCollisionGroups(0);
            o.visible = false;
            if (part.group && sb) sb.detachGroup(part.group);
            emit("broken", part);
            var S = OpenRacer.Shatter;
            if (!S) return;
            q.set(v.qx, v.qy, v.qz, v.qw); carInv.copy(q).invert();
            var shapesList = S.shapes ? S.shapes(info.key) : null;
            (shapesList || []).forEach(function (look, i) {
                shatterM.makeTranslation(look.centre.x, look.centre.y, look.centre.z).premultiply(info.source.matrixWorld);
                shatterM.decompose(shatterP, shatterQ, shatterS);
                // the speed of the car at the piece, and a little away from the middle of the car and up
                a.copy(shatterP).sub(carPos).applyQuaternion(carInv);
                pointVelocity(a, b);
                c.set(shatterP.x - v.px, 0, shatterP.z - v.pz);
                if (c.lengthSq() < 1e-6) c.set(1, 0, 0);
                c.normalize().multiplyScalar(0.6 + Math.random() * 1.6);
                b.x += c.x + (Math.random() - 0.5) * 0.8; b.y += 0.4 + Math.random() * 1.4; b.z += c.z + (Math.random() - 0.5) * 0.8;
                c.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(3 + Math.random() * 9);
                S.piece(info.key, i, shatterP, shatterQ, shatterS.x, b, c);
            });
            if (info.particles > 0) {
                var box = new THREE.Box3().setFromObject(info.source), mid = box.getCenter(new THREE.Vector3()), extent = box.getSize(new THREE.Vector3());
                a.copy(mid).sub(carPos).applyQuaternion(carInv);
                pointVelocity(a, b);
                S.burst(mid.x, mid.y, mid.z, b.x, b.y, b.z, info.particles, info.kind, info.colour, info.size, Math.max(0.05, Math.max(extent.x, extent.y, extent.z) * 0.4), Math.floor(Math.random() * 1e9), info.key);
            }
        }

        function startMoving(part, how) {
            var wasHeld = part.state === "held";
            if (wasHeld) {
                var onParent = onMovingParent(part);
                placeBody(part);
                part.body.setBodyType(R.RigidBodyType.Dynamic, true);
                var spinNow = { x: v.wx, y: v.wy, z: v.wz };
                if (onParent) { parentPoint(part, a, b); spinNow = part.parentPart.body.angvel(); } else pointVelocity(part.centre, b);
                part.body.setLinvel({ x: b.x, y: b.y, z: b.z }, true);
                part.body.setAngvel({ x: spinNow.x, y: spinNow.y, z: spinNow.z }, true);
                holdChildren(part);
                leaveModel(part);
                // the nodes of the part go with it, but not before the hit is over: while it is being hit they go on taking it (and deforming)
                if (part.group && sb) part.detachTimer = 0.3;
            }
            if (how === "hinge") {
                joinHinge(part);
                part.state = "hinged";
                part.body.setAngularDamping(part.spec.damping !== undefined ? part.spec.damping : 2.0); part.body.setLinearDamping(0.2);
                // a hinged part does not hit the car: it is held by the joint on the body, and the contact fights the joint (the hood jittered at the
                // limit of its spin, thrown about at a crash); it hits the car when it tears off and is free
                setGroups(part, false); part.pending = false;
                emit("unlatched", part);
            } else {
                if (part.joint) { world.removeImpulseJoint(part.joint, true); part.joint = null; }
                part.state = "free";
                part.body.setAngularDamping(part.spec.damping !== undefined ? part.spec.damping : 1.2); part.body.setLinearDamping(0.15);          // (a loose part tumbles and settles: it did not stop turning)
                waitForClear(part);                                          // not yet against the car, it is inside it
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
        // What the track puts on a hinged part (a door against a pole or a wall) goes to the car through the hinge: the force of the contacts of the last step is the force on the car,
        // at the place of the contact (v.partForces, Vehicle.js), and it counts as load on the hinge (the pins, the break force): the door is pushed on, the car is pushed, and when the
        // hinge gives way the door is free and has no say any more.
        // The rigid objects of the track (barriers, blocks, RigidObjects.js) are bodies of another engine: the parts meet a copy of each one that is near them, a body that is moved to where
        // the object is before every step. What the copy puts on a part is a force like that of the track; and the object gets the same push the other way, so that a door that is
        // pushed on a block pushes it too.
        var objCopies = new Map();
        function syncObjects() {
            var RO = OpenRacer.RigidObjects;
            if (!RO || !RO.near) return;
            var wanted = new Set();
            for (var i = 0; i < parts.length; i++) {
                var p = parts[i];
                if (p.wheel !== undefined || p.fetching || (p.state !== "hinged" && p.state !== "free")) continue;
                var t = p.body.translation();
                RO.near(t.x, t.y, t.z, 6).forEach(function (e) { wanted.add(e); });
            }
            wanted.forEach(function (e) {
                if (objCopies.has(e)) return;
                var t = e.body.translation(), r = e.body.rotation();
                var body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(t.x, t.y, t.z).setRotation(r));
                var col = world.createCollider(new R.ColliderDesc(e.collider.shape).setFriction(0.7).setCollisionGroups(groups(OBJ_COPY, PART_HELD | PART_FREE)), body);
                objCopies.set(e, { body: body, col: col });
            });
            objCopies.forEach(function (c, e) {
                if (!wanted.has(e)) { world.removeRigidBody(c.body); objCopies.delete(e); return; }
                c.body.setNextKinematicTranslation(e.body.translation());
                c.body.setNextKinematicRotation(e.body.rotation());
            });
        }
        var wallF = [];
        function wallForces(stepDt, frameTime) {
            wallF.length = 0;
            for (var i = 0; i < parts.length; i++) {
                var p = parts[i];
                p.wallForce = 0;
                if (p.state !== "hinged" || (!trackCollider && !objCopies.size) || p.fetching) continue;
                var fx = 0, fy = 0, fz = 0, cx = 0, cy = 0, cz = 0, wsum = 0;
                var gather = function (otherHandle, entry) {
                    var ox = 0, oy = 0, oz = 0, ocx = 0, ocy = 0, ocz = 0, osum = 0;
                    world.narrowPhase.contactPair(p.collider.handle, otherHandle, function (manifold, flipped) {
                        var n = manifold.normal(), sign = flipped ? 1 : -1, count = manifold.numContacts();
                        for (var k = 0; k < count; k++) {
                            var imp = manifold.contactImpulse(k) / stepDt;
                            if (!(imp > 0)) continue;
                            ox += sign * n.x * imp; oy += sign * n.y * imp; oz += sign * n.z * imp;
                            var sp = k < manifold.numSolverContacts() ? manifold.solverContactPoint(k) : null;
                            if (sp) { ocx += sp.x * imp; ocy += sp.y * imp; ocz += sp.z * imp; osum += imp; }
                        }
                    });
                    // (a copy that has just been made inside the part, or a fast hit, gives an impulse far beyond what a door can pass on: it is held to 300 kN)
                    var om = Math.hypot(ox, oy, oz);
                    if (om > MAX_PART_FORCE) { var os = MAX_PART_FORCE / om; ox *= os; oy *= os; oz *= os; ocx *= os; ocy *= os; ocz *= os; osum *= os; }
                    fx += ox; fy += oy; fz += oz; cx += ocx; cy += ocy; cz += ocz; wsum += osum;
                    // the object is pushed the other way, for the time of the frame
                    if (entry && (ox || oy || oz) && OpenRacer.RigidObjects && OpenRacer.RigidObjects.pushAt) {
                        var frameDt = frameTime || 2 * stepDt, at =      /* (the whole frame: on a long frame there are more steps than two) */ osum > 0 ? { x: ocx / osum, y: ocy / osum, z: ocz / osum } : entry.body.translation();
                        var ik = Math.min(1, 5 * (entry.mass || 50) / Math.max(1e-6, Math.hypot(ox, oy, oz) * frameDt));          // (at most 5 m/s of change of speed in a frame)
                        OpenRacer.RigidObjects.pushAt(entry, { x: -ox * frameDt * ik, y: -oy * frameDt * ik, z: -oz * frameDt * ik }, at);
                    }
                };
                if (trackCollider) gather(trackCollider.handle, null);
                objCopies.forEach(function (c, e) { gather(c.col.handle, e); });
                var mag = Math.hypot(fx, fy, fz);
                // (the weight of the part that rests on the track is the car's own load: only what pushes sideways or up beyond it counts as a hit)
                if (!(mag > 1)) continue;
                p.wallForce = mag;
                if (wsum > 0) wallF.push({ x: fx, y: fy, z: fz, px: cx / wsum, py: cy / wsum, pz: cz / wsum, m: p.mass });
                else wallF.push({ x: fx, y: fy, z: fz, px: p.centre.x, py: p.centre.y, pz: p.centre.z, m: p.mass });
            }
            v.partForces = wallF;
        }
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
                if (m.breakForce > 0 && Math.max(shell, (part.inertia || 0) / alive.length, (part.wallForce || 0) / alive.length) > m.breakForce) { m.alive = false; changed = true; emit("mount torn", part); }
            });
            if (!changed) return;
            if (!part.mounts.some(function (m) { return m.alive; })) startMoving(part, "free");
            else joinHinge(part);
        }

        // A part that is loaded past its force goes on bending with the body for a moment (its delay) and only then opens: what a hit makes of
        // it (its dent) is then on it when it comes off
        function openSoon(part) {
            if (part.openTimer > 0) return;
            if (!(part.breakDelay > 0)) { startMoving(part, "hinge"); return; }
            part.openTimer = part.breakDelay;
        }

        // A part that has come loose is damped and has a top speed (its spin, and its speed against the car): a hinge that flies open at the speed
        // of a crash, or a part that a hit has thrown, moved so fast that the joint and the walls could not keep up and it jittered or flew
        var MAX_SPIN_HINGED = 9, MAX_SPIN_FREE = 16, EXTRA_SPEED = 10;       // rad/s, rad/s, m/s on top of the speed of the car
        function limitSpeeds() {
            var carSpeed = Math.hypot(v.vx, v.vy, v.vz);
            for (var i = 0; i < parts.length; i++) {
                var p = parts[i];
                if (p.state === "held" || p.state === "broken") continue;
                var spin = p.body.angvel(), s = Math.hypot(spin.x, spin.y, spin.z), maxSpin = p.spec.max_spin !== undefined ? p.spec.max_spin : (p.state === "hinged" ? MAX_SPIN_HINGED : MAX_SPIN_FREE);
                if (s > maxSpin) p.body.setAngvel({ x: spin.x * maxSpin / s, y: spin.y * maxSpin / s, z: spin.z * maxSpin / s }, true);
                var lin = p.body.linvel(), l = Math.hypot(lin.x, lin.y, lin.z), maxLin = carSpeed + EXTRA_SPEED + (p.state === "hinged" ? 0 : 20);
                if (l > maxLin) p.body.setLinvel({ x: lin.x * maxLin / l, y: lin.y * maxLin / l, z: lin.z * maxLin / l }, true);
            }
        }

        function update(dt) {
            if (replaying) return;                          // the replay (Replay.js) puts the parts where they were; nothing runs
            // (a call without time, the drawing after a reset, gives no load: the step from the old speed to the new one over 0.1 ms read as 20 kN
            // on a two kilo part, and the reset key tore the plates, the lights and the engine off)
            var still = dt < 1e-3;
            // the load is the change of speed over the whole frame: on a slow computer (a frame of 0.1 s) it was divided by 1/20 s, twice the load,
            // and the parts came off at half their force. The world of the parts steps in pieces of at most 1/40 s (see the end).
            var frameDt = Math.min(Math.max(dt, 1e-4), 0.25), slices = Math.ceil(frameDt / (1 / 20));
            dt = frameDt;
            frame++;
            setPose();
            // the acceleration of the centre of the car and the angular acceleration over this frame (the load of the turning, below)
            if (still || !haveFrame) { cgAcc.set(0, 0, 0); angAcc.set(0, 0, 0); }
            else {
                cgAcc.set((v.vx - lastCG.x) / dt, (v.vy - lastCG.y) / dt + 9.81, (v.vz - lastCG.z) / dt);         // (a car that falls with its parts has no load on them)
                // (smoothed over a few frames: the angular speed of the body shakes a little from step to step, and read as it is it tore the battery off a car that only drove)
                var smoothK = Math.min(1, dt / 0.06);
                angAcc.x += ((v.wx - lastW.x) / dt - angAcc.x) * smoothK; angAcc.y += ((v.wy - lastW.y) / dt - angAcc.y) * smoothK; angAcc.z += ((v.wz - lastW.z) / dt - angAcc.z) * smoothK;
            }
            lastCG.set(v.vx, v.vy, v.vz); lastW.set(v.wx, v.wy, v.wz); haveFrame = !still || haveFrame;
            var moving = false;
            for (var i = 0; i < parts.length; i++) {
                var part = parts[i];
                if (part.wheel !== undefined) {
                    if (part.state === "held" && v.wheelLost && v.wheelLost[part.wheel] && !(v.soloWheels && (part.wheel === 1 || part.wheel === 3))) startWheel(part);
                    if (part.state !== "held") { moving = true; settle(part, dt); }
                    continue;
                }
                if (part.state === "broken") continue;                         // (a part that broke: its pieces are in Shatter.js)
                if (part.openTimer > 0) { part.openTimer -= dt; if (part.openTimer <= 0) { part.openTimer = 0; if (part.state === "held") startMoving(part, "hinge"); } }
                if (part.detachTimer > 0) { part.detachTimer -= dt; if (part.detachTimer <= 0 && sb) sb.detachGroup(part.group); }
                // the load: inertia of the part (mass times the acceleration of its place) and the shell on its nodes
                var onMoving = part.state === "held" && onMovingParent(part);
                if (onMoving) parentPoint(part, c, b); else pointVelocity(part.centre, b);
                var inertia = 0;
                if (part.hasVel && !still) inertia = part.mass * b.distanceTo(part.lastVel) / dt;
                part.lastVel.copy(b); part.hasVel = true;
                // the turning of the car loads the part too, not only the change of its speed: the acceleration of its place is that of the centre of the car, plus the angular
                // acceleration of the car times the arm (a car that is spun round by a hit, a roll) and the centripetal acceleration (a car that spins or rolls fast): the part is
                // thrown off by the turning, as by the stopping
                if (!still && !onMoving) {
                    rotArm.copy(part.centre).applyQuaternion(q);
                    var rx = rotArm.x, ry = rotArm.y, rz = rotArm.z, wx = v.wx, wy = v.wy, wz = v.wz;
                    var alx = angAcc.x, aly = angAcc.y, alz = angAcc.z, wr = wx * rx + wy * ry + wz * rz, w2 = wx * wx + wy * wy + wz * wz;
                    // (acceleration of the place) = (acceleration of the centre) + (angular acceleration) x r + w x (w x r)
                    var tx = alx * 0 + (aly * rz - alz * ry) + (wx * wr - rx * w2), ty = (alz * rx - alx * rz) + (wy * wr - ry * w2), tz = (alx * ry - aly * rx) + (wz * wr - rz * w2);
                    var turning = ROT_WEIGHT * part.mass * Math.hypot(tx, ty, tz), full = part.mass * Math.hypot(ROT_WEIGHT * tx + cgAcc.x, ROT_WEIGHT * ty + cgAcc.y, ROT_WEIGHT * tz + cgAcc.z);
                    part.rotLoad = turning;
                    if (full > inertia) inertia = full;
                }
                var shell = 0, torn = false;
                if (sb && !onMoving) {
                    for (var k = 0; k < part.nodes.length; k++) {
                        var node = part.nodes[k];
                        if (!sb.alive(node) && part.state === "held") torn = true;      // (the nodes of a part that has come loose are gone on purpose)
                        sb.position(node, a); sb.restPosition(node, c);
                        shell = Math.max(shell, a.distanceTo(c) * sb.params.anchorK);
                    }
                }
                part.load = frame > 3 ? Math.max(inertia, shell) : 0;
                part.inertia = frame > 3 ? inertia : 0;

                if (onMoving) {
                    // on a part that moves (a door that swings, a bumper that fell off): it breaks off it at its force (a hinge at the force that tears it off)
                    var limit = part.breakForce || (part.hinge && part.hinge.breakForce) || 0;
                    if (limit > 0 && part.load > limit) comeOff(part);
                } else if (part.state === "held" && part.mounts.length) {
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
                    } else if (activated && part.hinge) openSoon(part);
                }
                if (part.state === "held" && !onMoving && sb && part.mounts.length) {
                    // a link beam of a mount tore (the hold of a part with nodes of its own): that mount is gone, the part opens on the others
                    var lost = false;
                    part.mounts.forEach(function (m) { if (m.alive && m.beam !== undefined && !sb.beamAlive[m.beam]) { m.alive = false; lost = true; emit("mount torn", part); } });
                    if (lost) {
                        if (part.mounts.some(function (m) { return m.alive; })) startMoving(part, "hinge"); else startMoving(part, "free");
                    }
                }
                if (part.state === "held" && !onMoving) {
                    if (part.hinge) {
                        if (!part.hinge.latch || part.load > part.hinge.latch || torn) openSoon(part);
                    } else if (part.breakTimer === null || part.breakTimer === undefined) {
                        // a breakable part: when the load passes its force it goes on bending with the body for a moment, and then it comes off
                        if (torn || (part.breakForce > 0 && part.load > part.breakForce)) {
                            if (part.breakDelay > 0 && !part.shatter) part.breakTimer = part.breakDelay; else comeOff(part);
                        }
                    } else {
                        part.breakTimer -= dt;
                        if (part.breakTimer <= 0) { part.breakTimer = null; comeOff(part); }
                    }
                } else if (part.state === "hinged") {
                    if (part.mounts.length) tearMounts(part);
                    if (part.state === "hinged" && (torn || (part.hinge.breakForce > 0 && Math.max(part.load, part.wallForce || 0) > part.hinge.breakForce))) startMoving(part, "free");
                }
                if (part.state !== "held") moving = true;
                settle(part, dt);
            }
            if (!moving) { wallF.length = 0; return; }                         // (nothing hangs on the car: nothing pushes it)
            refreshTrack();
            syncObjects();
            // a hinge opened in the debug view: a small torque about its axis, to the side where it has the most room, enough to lift it a little faster than its weight pulls
            for (var dk = 0; dk < parts.length; dk++) {
                var dp = parts[dk];
                if (!dp.debugOpen) continue;
                if (dp.state !== "hinged" || !dp.jointAxis) { dp.debugOpen = false; dp.body.resetTorques(true); continue; }     // (it tore off: it falls freely)
                carQ.set(v.qx, v.qy, v.qz, v.qw);
                outward.copy(dp.jointAxis).applyQuaternion(carQ);
                var side = dp.debugSide || 1;
                var arm = Math.max(0.2, dp.jointAt ? dp.centre.distanceTo(dp.jointAt) : 0.4), torque = side * 1.5 * dp.mass * 9.81 * arm;
                dp.body.resetTorques(true);
                dp.body.addTorque({ x: outward.x * torque, y: outward.y * torque, z: outward.z * torque }, true);
            }
            // two steps of half the time (more on a long frame): a part that flies at 30 m/s hits the wall in the middle of a frame, not after it
            world.timestep = dt / (2 * slices);
            for (var st = 0; st < 2 * slices; st++) { world.step(); limitSpeeds(); }
            wallForces(world.timestep, dt);
            for (var j = 0; j < parts.length; j++) {
                var p = parts[j];
                if (p.state === "held" || p.state === "broken" || p.fetching) continue;           // (a part that the pit stop carries back is put where it is by fetchTo)
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
            if (v.repairWheels) v.repairWheels();
            for (var i = 0; i < parts.length; i++) {
                var p = parts[i];
                unfade(p);
                if (p.wheel !== undefined) {
                    p.fetching = false;
                    if (p.state !== "held") { p.body.setBodyType(R.RigidBodyType.KinematicPositionBased, true); setGroups(p, false); p.object.matrixAutoUpdate = true; p.state = "held"; p.pending = false; p.region = null; }
                    continue;
                }
                putBack(p);
            }
        }
        // ---- the debug view (DebugView.js, the node grabber): the part that an object of the scene is of; a hinge opened by hand (with a small torque) or closed again
        // where it was made; a part broken loose
        function partOf(object) {
            for (var o = object; o; o = o.parent) for (var i = 0; i < parts.length; i++) if (parts[i].object === o && parts[i].wheel === undefined) return parts[i];
            return null;
        }
        function toggleHinge(p) {
            if (!p || !p.hinge || p.fetching || onMovingParent(p)) return null;
            if (p.state === "hinged") { putBack(p); return "closed"; }
            if (p.state !== "held") return null;
            startMoving(p, "hinge");
            if (p.state !== "hinged") return null;
            p.debugOpen = true;
            // the way it opens: the way its middle goes up (a hood, a boot); a hinge about an upright axis (a door): the way its limits leave the most room
            p.debugSide = 1;
            if (p.jointAxis && p.jointAt) {
                var lim = p.jointLimits, arm = a.copy(p.centre).sub(p.jointAt), up = b.copy(p.jointAxis).cross(arm);
                carQ.set(v.qx, v.qy, v.qz, v.qw); up.applyQuaternion(carQ);
                if (Math.abs(up.y) > 0.2 * arm.length()) p.debugSide = up.y > 0 ? 1 : -1;
                else if (lim && lim[1] < -lim[0]) p.debugSide = -1;
            }
            return "opened";
        }
        function breakLoose(p) {
            if (!p || p.fetching || p.state === "free" || p.state === "broken") return false;
            if (p.shatter) { shatterPart(p); return true; }
            startMoving(p, "free");
            p.mounts.forEach(function (m) { m.alive = false; });
            return true;
        }
        // A hit on a part from outside (the debug view, Apply force of the car editor): at a point (none: its middle), along dir (a unit vector, into the part), with an impulse (N s) and the force that it is over the time of the hit (N).
        // A part that is off the car (hinged or free) gets the impulse on its body; a hinge opens when the force passes its latch, tears at its break force or at the break force of a
        // pin; a part that is on the car (a breakable one, a part on a part) breaks off at its break force. Gives what happened.
        function hit(p, point, dir, impulse, force) {
            if (!p || p.state === "broken" || p.fetching) return "none";
            if (p.state === "held") {
                if (p.hinge) {
                    // it opens past the activation force of a pin (the pins that have one), or else past its latch; a hinge with neither stays shut
                    var open = Infinity;
                    p.mounts.forEach(function (m) { if (m.alive && m.activate > 0) open = Math.min(open, m.activate); });
                    if (!isFinite(open) && isFinite(p.hinge.latch)) open = p.hinge.latch;
                    if (!(force > open)) return "held";
                    startMoving(p, "hinge");
                } else {
                    if (p.breakForce > 0 && force > p.breakForce) { comeOff(p); return p.shatter ? "broke" : "off"; }
                    return "held";
                }
            }
            var result = "pushed";
            if (p.state === "hinged") {
                var alive = p.mounts.filter(function (m) { return m.alive; });
                var torn = alive.filter(function (m) { return m.breakForce > 0 && force / Math.max(1, alive.length) > m.breakForce; });
                torn.forEach(function (m) { m.alive = false; });
                if (p.hinge.breakForce > 0 && force > p.hinge.breakForce) { startMoving(p, "free"); result = "tore off"; }
                else if (torn.length) { emit("mount torn", p); if (p.mounts.some(function (m) { return m.alive; })) joinHinge(p); else { startMoving(p, "free"); result = "tore off"; } }
            }
            if (p.state === "hinged" || p.state === "free") p.body.applyImpulseAtPoint({ x: dir.x * impulse, y: dir.y * impulse, z: dir.z * impulse }, point || p.body.translation(), true);
            return result;
        }
        // one part back on the car, held as it was made (a wheel: a wheel of the car again)
        function putBack(p) {
            unfade(p);
            if (p.debugOpen) { p.debugOpen = false; p.body.resetTorques(true); }
            if (p.wheel !== undefined) {
                if (p.state !== "held") { p.body.setBodyType(R.RigidBodyType.KinematicPositionBased, true); setGroups(p, false); p.object.matrixAutoUpdate = true; p.state = "held"; p.pending = false; p.region = null; }
                p.fetching = false;
                if (v.repairWheel) v.repairWheel(p.wheel);
                return;
            }
            if (p.joint) { world.removeImpulseJoint(p.joint, true); p.joint = null; }
            if (p.state !== "held") {
                p.body.setBodyType(R.RigidBodyType.KinematicPositionBased, true);
                setGroups(p, false);
                p.parent.add(p.object);
                restoreHome(p.object, p.object.userData.partHome);
                p.object.traverse(function (m) { if (m.userData && m.userData.sbDeform) m.userData.sbDeform.value = 1; });
                if (ctx.softBodyMesh && ctx.softBodyMesh.unfreeze) ctx.softBodyMesh.unfreeze(p.object);
            }
            p.object.visible = true; p.onParent = null;
            p.mounts.forEach(function (m) { m.alive = true; });
            p.detachTimer = 0; p.breakTimer = null; p.openTimer = 0;
            p.state = "held"; p.hasVel = false; p.grace = 0; p.pending = false; p.region = null; p.fetching = false;
        }

        // The parts back on the car one by one, as the tyres are (the pit stop, Pit.js). fetchStart takes the parts that came loose and the wheels that came off out of
        // the physics (they no longer move or hit anything) and gives them as a list, each with materials of its own so that it can be faded without the car; fetchFade(part,
        // opacity) fades one where it lies on the track (from 1 to 0, then it is gone); fetchTo(part, share) puts it on the car in its turn: from 60 cm out it goes to its place
        // and comes into sight (0: gone, 1: on), and holds it there. A wheel is a wheel of the car again when it is on (Vehicle.repairWheel); putBack (or repair) ends it.
        var fetchPos = new THREE.Vector3(), fetchQuat = new THREE.Quaternion(), fetchScale = new THREE.Vector3(), homeM = new THREE.Matrix4(), homePos = new THREE.Vector3(), homeQuat = new THREE.Quaternion(), homeScale = new THREE.Vector3(), fetchM = new THREE.Matrix4(), parentInv = new THREE.Matrix4(), outward = new THREE.Vector3(), carQ = new THREE.Quaternion();
        function fadeable(p) {
            if (p.fadeMats) return;
            p.fadeMats = [];
            p.object.traverse(function (m) {
                if (!m.isMesh || !m.material) return;
                var own = Array.isArray(m.material) ? m.material.map(function (x) { return x.clone(); }) : m.material.clone();
                (Array.isArray(own) ? own : [own]).forEach(function (x) { x.userData.fadeOpacity = x.opacity; x.transparent = true; });
                p.fadeMats.push({ mesh: m, was: m.material, own: own });
                m.material = own;
            });
        }
        function setOpacity(p, a) {
            if (!p.fadeMats) return;
            p.fadeMats.forEach(function (f) { (Array.isArray(f.own) ? f.own : [f.own]).forEach(function (x) { x.opacity = x.userData.fadeOpacity * a; x.depthWrite = a > 0.98; }); });
            p.object.visible = a > 0.005;
        }
        function unfade(p) {
            if (!p.fadeMats) return;
            p.fadeMats.forEach(function (f) { f.mesh.material = f.was; (Array.isArray(f.own) ? f.own : [f.own]).forEach(function (x) { x.dispose(); }); });
            p.fadeMats = null;
            p.object.visible = true;
        }
        function fetchStart() {
            var list = [];
            parts.forEach(function (p) {
                if (p.state === "held") return;
                if (p.wheel !== undefined && !(v.wheelLost && v.wheelLost[p.wheel])) return;
                if (p.joint) { world.removeImpulseJoint(p.joint, true); p.joint = null; }
                p.body.setBodyType(R.RigidBodyType.KinematicPositionBased, true);
                setGroups(p, false);
                fadeable(p);
                p.fetching = true; p.fetchOn = false;
                list.push(p);
            });
            return list;
        }
        function fetchFade(p, opacity) { if (p && p.fetching && !p.fetchOn) setOpacity(p, p.state === "broken" ? 0 : Math.max(0, Math.min(1, opacity))); }
        // where a part (or a wheel) belongs, in the world: its home in the model, or the middle of its wheel on the car
        function homeOf(p) {
            if (p.wheel !== undefined) {
                var w = v.wheels[p.wheel];
                carQ.set(v.qx, v.qy, v.qz, v.qw);
                homePos.set(w.mount.x + (w.shiftX || 0), w.mount.y - (w.restLengthWheel || v.restLength || 0.3), w.mount.z + (w.shiftZ || 0)).applyQuaternion(carQ);
                homePos.x += v.px; homePos.y += v.py; homePos.z += v.pz;
                homeQuat.copy(carQ); homeScale.set(1, 1, 1);
                return;
            }
            var h = p.object.userData.partHome;
            p.parent.updateWorldMatrix(true, false);
            homeM.compose(h.position, h.quaternion, h.scale).premultiply(p.parent.matrixWorld);
            homeM.decompose(homePos, homeQuat, homeScale);
        }
        function fetchTo(p, share) {
            if (!p || !p.fetching) return;
            share = Math.max(0, Math.min(1, share));
            if (share <= 0) { setOpacity(p, 0); return; }          // (gone from the track, waiting for its turn)
            p.fetchOn = true;
            homeOf(p);
            // out from the car: away from its middle, level, 60 cm at the start of the turn
            outward.set(homePos.x - v.px, 0, homePos.z - v.pz);
            if (outward.lengthSq() < 1e-6) outward.set(1, 0, 0);
            outward.normalize();
            var e = share * share * (3 - 2 * share);
            fetchPos.copy(homePos).addScaledVector(outward, 0.6 * (1 - e));
            fetchM.compose(fetchPos, homeQuat, homeScale);
            if (p.object.parent) { p.object.parent.updateWorldMatrix(true, false); fetchM.premultiply(parentInv.copy(p.object.parent.matrixWorld).invert()); }
            p.object.matrixAutoUpdate = false;
            p.object.matrix.copy(fetchM);
            p.object.matrixWorldNeedsUpdate = true;
            setOpacity(p, Math.min(1, share / 0.6));
            // a wheel that is on is a wheel of the car again: it hangs on its spring and rolls when the car comes down
            if (share >= 1 && p.wheel !== undefined) putBack(p);
        }

        // ---- the replay (Replay.js): what is recorded of a part is its state (0 held, 1 hinged, 2 free) and, when it is not held, the place of its
        // object in the scene (position, turn, size: 11 numbers). The engine does not run while a replay is shown; the parts are put where they were.
        var replaying = false, PART_FLOATS = 11, tmpP = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3();
        function awayFromModel(part, frozen) {
            var o = part.object;
            part.rAway = true;
            o.updateWorldMatrix(true, false);
            var top = o;
            while (top.parent) top = top.parent;
            top.attach(o);
            o.matrixAutoUpdate = false;
            if (!part.group && ctx.softBodyMesh && ctx.softBodyMesh.release) {
                // it keeps the dent that the car had when it came off (the replay gives those displacements), not the one of the moment that is shown
                var live = null;
                if (frozen && sb) { live = sb.displacement.slice(0, frozen.length); sb.displacement.set(frozen); }
                ctx.softBodyMesh.release(o);
                if (live) sb.displacement.set(live);
            }
        }
        function backOnModel(part) {
            var o = part.object;
            part.rAway = false;
            if (part.wheel !== undefined) o.matrixAutoUpdate = true;
            else {
                part.parent.add(o);
                restoreHome(o, o.userData.partHome);
                o.traverse(function (m) { if (m.userData && m.userData.sbDeform) m.userData.sbDeform.value = 1; });
            }
            if (ctx.softBodyMesh && ctx.softBodyMesh.unfreeze) ctx.softBodyMesh.unfreeze(o);
        }
        var replayApi = {
            partFloats: PART_FLOATS,
            names: function () { return parts.map(function (p) { return p.name; }); },
            // out: Float32Array(parts.length * 11)
            replayRecord: function (out) {
                for (var i = 0; i < parts.length; i++) {
                    // (3: broken, it is not seen; a broken part that the pit stop puts back is on the car)
                    var p = parts[i], o = i * PART_FLOATS, code = p.state === "held" ? 0 : (p.state === "hinged" ? 1 : (p.state === "broken" ? (p.fetching && p.fetchOn ? 0 : 3) : 2));
                    out[o] = code;
                    if (!code || code === 3) { for (var k = 1; k < PART_FLOATS; k++) out[o + k] = 0; continue; }
                    p.object.matrix.decompose(tmpP, tmpQ, tmpS);
                    out[o + 1] = tmpP.x; out[o + 2] = tmpP.y; out[o + 3] = tmpP.z;
                    out[o + 4] = tmpQ.x; out[o + 5] = tmpQ.y; out[o + 6] = tmpQ.z; out[o + 7] = tmpQ.w;
                    out[o + 8] = tmpS.x; out[o + 9] = tmpS.y; out[o + 10] = tmpS.z;
                }
            },
            // in: Float32Array(parts.length * 11); frozen(i): the displacements (Float32Array) of the shell at the moment part i came off, or null
            replayApply: function (arr, frozen) {
                for (var i = 0; i < parts.length; i++) {
                    var p = parts[i], o = i * PART_FLOATS, code = arr[o];
                    // (a part that a pit stop fades away and puts back: its opacity at this time, from the recording of the stop, Pit.js)
                    var fade = OpenRacer.PitStop && OpenRacer.PitStop.replayedPart ? OpenRacer.PitStop.replayedPart(i) : null;
                    if (code === 3) { if (p.rAway) backOnModel(p); p.object.visible = false; p.rHidden = true; continue; }
                    if (p.rHidden) { p.object.visible = true; p.rHidden = false; }
                    if (fade !== null) { fadeable(p); setOpacity(p, fade); } else if (p.fadeMats && !p.fetching) unfade(p);
                    if (!code) { if (p.rAway) backOnModel(p); continue; }
                    if (!p.rAway) awayFromModel(p, frozen ? frozen(i) : null);
                    p.object.matrix.compose(tmpP.set(arr[o + 1], arr[o + 2], arr[o + 3]), tmpQ.set(arr[o + 4], arr[o + 5], arr[o + 6], arr[o + 7]), tmpS.set(arr[o + 8], arr[o + 9], arr[o + 10]));
                    p.object.matrixWorldNeedsUpdate = true;
                }
            },
            replayBegin: function () {
                if (replaying) return;
                replaying = true;
                parts.forEach(function (p) { p.rAway = p.state !== "held" && p.state !== "broken"; p.rHidden = p.state === "broken"; });
            },
            // back to the game: every part where the game has it
            replayEnd: function () {
                replaying = false;
                parts.forEach(function (p) {
                    p.rHidden = false;
                    if (p.state === "broken") { if (p.rAway) backOnModel(p); p.object.visible = false; return; }
                    if (p.state === "held") { p.object.visible = true; if (p.rAway) backOnModel(p); return; }
                    p.object.visible = true;
                    if (!p.rAway) awayFromModel(p, null);
                    var t = p.body.translation(), r = p.body.rotation();
                    bodyM.compose(a.set(t.x, t.y, t.z), qInv.set(r.x, r.y, r.z, r.w), unit);
                    p.object.matrix.multiplyMatrices(bodyM, p.visual);
                    p.object.matrixWorldNeedsUpdate = true;
                });
            }
        };

        return {
            replay: replayApi,
            world: world, parts: parts, events: events, update: update, repair: repair, fetchStart: fetchStart, fetchFade: fetchFade, fetchTo: fetchTo, putBack: putBack, partOf: partOf, hit: hit, toggleHinge: toggleHinge, breakLoose: breakLoose,
            // the car was put somewhere else (a reset, the start): the speed of before is no acceleration of the parts
            moved: function () { parts.forEach(function (p) { p.hasVel = false; }); },
            // the car is taken out of the scene (the car editor makes a new one for every test): the parts that were thrown out of it go with it
            dispose: function () { parts.forEach(function (p) { if (p.state !== "held" && p.object.parent) p.object.parent.remove(p.object); }); },
            copies: function () { return objCopies.size; },
            debugCopies: function () { var out = []; objCopies.forEach(function (c, e) { out.push({ at: c.body.translation(), obj: e.body.translation(), col: c.col, ctype: c.col.shape.type, doorOverlap: parts.filter(function (p) { return p.state === "hinged"; }).map(function (p) { return world.intersectionPair(p.collider, c.col) || world.narrowPhase.contactPair(p.collider.handle, c.col.handle, function () {}); }) }); }); return out; },
            states: function () { return parts.map(function (p) { return p.name + ":" + p.state; }).join(" "); }
        };
    }

    return { create: create, build: build, hideBroken: hideBroken, isBroken: isBroken, particleColours: PARTICLE_COLOURS };
})();
