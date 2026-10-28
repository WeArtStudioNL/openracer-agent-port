/*
 * RigidObjects.js
 *
 * Description: Rigid bodies in a track: barrels, boxes, cones, balls, anything that can be knocked over. They are placed asleep and cost nothing: the
 *              engine (Rapier, js/rapier/, loaded only for a track that has such objects) only steps when an object is awake or a car is close
 *              to one. A car that touches an object wakes it, and the object is pushed (and pushes back: the force of the contact is put on
 *              the car as a change of speed, so a concrete block stops a car and a cone does not). An object that has lain still for a while
 *              goes to sleep again.
 *
 *              Where they come from:
 *                - the model of the track: every part whose name, or the name of one of the nodes above it, starts with "rigid" (rigid_barrel_1,
 *                  Rigid Cone.002). Its shape is the convex hull of the part, its mass the volume of its box times a density of 250 kg/m3
 *                  (track.json "rigid_density"), or 'rigid_<n>kg' in the name for a mass of your own. It leaves the road and the walls of the track.
 *                - track.json "objects": [{ "shape": "box" | "cylinder" | "cone" | "sphere", "x", "z", "y" (the road when left out), "heading" (degrees),
 *                  "size": [w, h, d] (box) or "radius" and "height", "mass" (kg), "color", "grid": [nx, nz] with "spacing": [dx, dz] for a block of
 *                  them, "layers": n for a stack }].
 *
 *              The cars are boxes that the engine moves (kinematic). The track near an object that moves is a static mesh of the 3D ground (or, on a
 *              track with the 2D physics, a grid of heights), made again when the object has moved on.
 */

OpenRacer.RigidObjects = (function () {
    var GROUND = 1, VEHICLE = 2, OBJECT = 4;                 // the groups of collisions
    var DENSITY = 250;                                       // kg/m3 of the box of a part of the model
    var WAKE_DISTANCE = 6;                                   // a car this near (m, from the edge of the object) puts the engine to work
    var QUIET_SECONDS = 1.5;                                 // lying still for so long: asleep again
    var MAX_STEP = 1 / 30;

    var R = null, loading = null;
    var world = null, trackBody = null, trackCollider = null;
    var objects = [];                                        // { object, body, collider, radius, home, quiet, region, mass }
    var cars = new Map();                                    // vehicle -> { body, collider }
    var carByCollider = new Map();                           // handle of a collider -> vehicle
    var objectByCollider = new Map();
    var candidates = [], corner = new Array(9);
    var ready = false;
    var stats = { events: 0, pairs: 0, pushed: 0 };

    function groups(membership, filter) { return ((membership << 16) | filter) >>> 0; }

    function loadEngine() {
        if (!loading) loading = import("./rapier/rapier.es.js").then(function (module) {
            var lib = module.default || module;
            return Promise.resolve(lib.init()).then(function () { return lib; });
        });
        return loading;
    }

    // ---- what is in the track

    // the mass of a part from its name: rigid_50kg, rigid_barrel_12.5kg
    function massFromName(name) {
        var m = /(\d+(?:\.\d+)?)\s*kg/i.exec(name || "");
        return m ? parseFloat(m[1]) : 0;
    }

    var materials = {};
    function materialFor(color) {
        var key = String(color);
        if (!materials[key]) materials[key] = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.7, metalness: 0.05 });
        return materials[key];
    }

    var DEFAULT_COLOR = { box: "#c9a25b", cylinder: "#d9532b", cone: "#ff7a1a", sphere: "#e8e8e8" };

    // a spec of the track.json made into one or more objects (a grid and layers make a block)
    function fromSpec(spec, ground, out) {
        var shape = spec.shape || "box";
        var size = spec.size || [1, 1, 1];
        var radius = spec.radius !== undefined ? spec.radius : 0.3, height = spec.height !== undefined ? spec.height : 0.9;
        var w = size[0], h = size[1] !== undefined ? size[1] : size[0], d = size[2] !== undefined ? size[2] : size[0];
        var halfHeight = shape === "box" ? h / 2 : (shape === "sphere" ? radius : height / 2);
        var grid = spec.grid || [1, 1], spacing = spec.spacing || [shape === "box" ? w * 1.02 : radius * 2.2, shape === "box" ? d * 1.02 : radius * 2.2];
        var layers = Math.max(1, spec.layers || 1);
        var heading = (spec.heading || 0) * Math.PI / 180, cosH = Math.cos(heading), sinH = Math.sin(heading);
        for (var layer = 0; layer < layers; layer++) {
            for (var i = 0; i < grid[0]; i++) {
                for (var j = 0; j < grid[1]; j++) {
                    var lx = (i - (grid[0] - 1) / 2) * spacing[0], lz = (j - (grid[1] - 1) / 2) * spacing[1];
                    // the block turns with the heading as a whole
                    var x = spec.x + lx * cosH - lz * sinH, z = spec.z + lx * sinH + lz * cosH;
                    var y;
                    if (spec.y !== undefined) y = spec.y;
                    else {
                        var hit = ground && ground.query ? ground.query(x, z, 5000, 0) : null;
                        y = hit ? hit.y : 0;
                    }
                    y += halfHeight * (1 + 2 * layer) + 0.01 * layer;
                    var geometry;
                    if (shape === "cylinder") geometry = new THREE.CylinderGeometry(radius, radius, height, 20);
                    else if (shape === "cone") geometry = new THREE.CylinderGeometry(radius * 0.18, radius, height, 20);
                    else if (shape === "sphere") geometry = new THREE.SphereGeometry(radius, 20, 14);
                    else geometry = new THREE.BoxGeometry(w, h, d);
                    var mesh = new THREE.Mesh(geometry, materialFor(spec.color || DEFAULT_COLOR[shape] || "#cccccc"));
                    mesh.castShadow = true; mesh.receiveShadow = true;
                    mesh.position.set(x, y, z);
                    mesh.rotation.y = -heading;
                    var volume = shape === "box" ? w * h * d : (shape === "sphere" ? 4 / 3 * Math.PI * Math.pow(radius, 3) : Math.PI * radius * radius * height * (shape === "cone" ? 0.4 : 1));
                    var shapeInfo = shape === "box" ? { type: "box", hx: w / 2, hy: h / 2, hz: d / 2 }
                        : shape === "sphere" ? { type: "ball", r: radius } : { type: "cylinder", r: radius, hh: height / 2 };
                    out.push({ object: mesh, shape: shapeInfo, mass: spec.mass || Math.max(1, volume * DENSITY), radius: Math.max(w, h, d, radius * 2, height) / 2 });
                    mesh.userData.rigid = true;
                }
            }
        }
    }

    // the points of a hull without the same point twice (a mesh has a corner once for every face that meets there, and a hull of such points can fail)
    function uniquePoints(list) {
        var seen = {}, out = [];
        for (var i = 0; i < list.length; i += 3) {
            var key = Math.round(list[i] * 500) + "," + Math.round(list[i + 1] * 500) + "," + Math.round(list[i + 2] * 500);
            if (seen[key]) continue;
            seen[key] = 1;
            out.push(list[i], list[i + 1], list[i + 2]);
        }
        return new Float32Array(out);
    }

    // a part of the model (already moved to its own middle, see TrackLoader.js): the convex hull of its points
    function fromPiece(mesh, density) {
        var geometry = mesh.geometry, position = geometry.attributes.position;
        geometry.computeBoundingBox();
        var box = geometry.boundingBox, size = box.getSize(new THREE.Vector3());
        var step = Math.max(1, Math.floor(position.count / 160)), points = [];
        for (var i = 0; i < position.count; i += step) points.push(position.getX(i), position.getY(i), position.getZ(i));
        points = uniquePoints(points);
        var mass = massFromName(mesh.name) || Math.max(1, size.x * size.y * size.z * density);
        return { object: mesh, shape: { type: "hull", points: points, hx: size.x / 2, hy: size.y / 2, hz: size.z / 2 }, mass: mass, radius: size.length() / 2 };
    }

    // ---- the engine

    function colliderFor(shape) {
        if (shape.type === "hull") {
            var hull = null;
            try { hull = shape.points.length >= 12 ? R.ColliderDesc.convexHull(shape.points) : null; } catch (e) { hull = null; }
            return hull || R.ColliderDesc.cuboid(Math.max(0.04, shape.hx), Math.max(0.04, shape.hy), Math.max(0.04, shape.hz));
        }
        if (shape.type === "box") return R.ColliderDesc.cuboid(shape.hx, shape.hy, shape.hz);
        if (shape.type === "ball") return R.ColliderDesc.ball(shape.r);
        return R.ColliderDesc.cylinder(shape.hh, shape.r);
    }

    function build(specs) {
        world = new R.World({ x: 0, y: -9.81, z: 0 });
        trackBody = world.createRigidBody(R.RigidBodyDesc.fixed());
        specs.forEach(function (spec) {
            var o = spec.object, q = o.quaternion;
            var body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(o.position.x, o.position.y, o.position.z)
                .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setSleeping(true).setCanSleep(true).setLinearDamping(0.1).setAngularDamping(0.25).setCcdEnabled(true));
            var collider = world.createCollider(colliderFor(spec.shape).setMass(spec.mass).setFriction(0.7).setRestitution(0.25)
                .setCollisionGroups(groups(OBJECT, GROUND | VEHICLE | OBJECT)), body);
            var entry = { object: o, body: body, collider: collider, radius: spec.radius, mass: spec.mass, quiet: 0, region: null, home: { p: o.position.clone(), q: o.quaternion.clone() }, moving: false };
            objects.push(entry);
            objectByCollider.set(collider.handle, entry);
        });
        ready = true;
    }

    // the box of a car for the engine: a little wider than the body, from the underside to the roof
    function carFor(v) {
        var entry = cars.get(v);
        if (entry) return entry;
        var hx = v.halfWidth, hz = v.halfLength, hy = Math.max(0.3, ((v.bodyHeight || 1.3) - 0.2) / 2);
        var body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
        // the box in the frame of the car (x left, y up, z forward, from the centre of gravity): from 0.2 m above the road to the roof
        var offsetY = 0.2 + hy - (v.cgHeight || 0.5), offsetZ = ((v.af || 0) - (v.ar || 0)) / 2;
        var collider = world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(0, offsetY, offsetZ).setCollisionGroups(groups(VEHICLE, OBJECT))
            , body);
        entry = { body: body, collider: collider, v: v };
        cars.set(v, entry);
        carByCollider.set(collider.handle, entry);
        return entry;
    }

    // the static mesh of the track near the objects that are awake or about to be: made again when one has gone on
    function refreshTrack(ground, active) {
        if (!ground) return;
        var stale = !trackCollider;
        for (var i = 0; i < active.length && !stale; i++) {
            var t = active[i].body.translation(), r = active[i].region;
            if (!r || Math.abs(t.x - r.x) > 3 || Math.abs(t.y - r.y) > 3 || Math.abs(t.z - r.z) > 3) stale = true;
        }
        if (!stale) return;
        var verts = [], index = [];
        var wanted = new Set();
        active.forEach(function (e) {
            var u = e.body.translation();
            e.region = { x: u.x, y: u.y, z: u.z };
            var reach = 7 + e.radius;
            if (ground.use3D && ground.nearby) {
                ground.nearby(u.x, u.y, u.z, reach, candidates);
                for (var k = 0; k < candidates.length; k++) wanted.add(candidates[k]);
            } else if (ground.query) {
                // a track of the 2D physics: a grid of heights, a square of 'reach' on every side
                var cell = 0.75, n = Math.ceil(reach * 2 / cell), x0 = u.x - reach, z0 = u.z - reach, base = verts.length / 3, ok = new Array((n + 1) * (n + 1));
                for (var a = 0; a <= n; a++) for (var b = 0; b <= n; b++) {
                    var hit = ground.query(x0 + a * cell, z0 + b * cell, u.y + 3, 1.5);
                    ok[a * (n + 1) + b] = hit !== null;
                    verts.push(x0 + a * cell, hit ? hit.y : u.y - 50, z0 + b * cell);
                }
                for (var c = 0; c < n; c++) for (var d = 0; d < n; d++) {
                    var i00 = base + c * (n + 1) + d, i01 = i00 + 1, i10 = i00 + n + 1, i11 = i10 + 1;
                    if (!(ok[c * (n + 1) + d] && ok[c * (n + 1) + d + 1] && ok[(c + 1) * (n + 1) + d] && ok[(c + 1) * (n + 1) + d + 1])) continue;
                    index.push(i00, i01, i10, i01, i11, i10);
                }
            }
        });
        wanted.forEach(function (tri) {
            ground.vertices(tri, corner);
            var base = verts.length / 3;
            for (var m = 0; m < 9; m++) verts.push(corner[m]);
            index.push(base, base + 1, base + 2);
        });
        if (trackCollider) { world.removeCollider(trackCollider, false); trackCollider = null; }
        if (!index.length) return;
        trackCollider = world.createCollider(R.ColliderDesc.trimesh(new Float32Array(verts), new Uint32Array(index)).setFriction(0.8).setRestitution(0.2)
            .setCollisionGroups(groups(GROUND, OBJECT)), trackBody);
    }

    var q = new THREE.Quaternion();
    var pushed = new THREE.Vector3();

    function update(delta, vehicles) {
        if (!ready || !objects.length) return;
        if (OpenRacer.Replay && OpenRacer.Replay.active) return;
        var dt = Math.min(MAX_STEP, Math.max(1 / 240, delta));
        // who needs the engine: an object that is awake, or one that a car is near
        var active = [], near = false;
        for (var i = 0; i < objects.length; i++) {
            var e = objects[i], awake = !e.body.isSleeping(), close = false;
            if (!awake) {
                var t = e.body.translation();
                for (var k = 0; k < vehicles.length && !close; k++) {
                    var v = vehicles[k], reach = WAKE_DISTANCE + e.radius + v.halfLength;
                    close = Math.abs(v.px - t.x) < reach && Math.abs(v.pz - t.z) < reach && Math.abs(v.py - t.y) < reach + 3;
                }
            }
            if (awake || close) { active.push(e); if (close) near = true; }
        }
        if (!active.length) return;
        refreshTrack(vehicles[0] && vehicles[0].ground, active);
        // the cars where they are now
        vehicles.forEach(function (v) {
            var c = carFor(v);
            c.body.setNextKinematicTranslation({ x: v.px, y: v.py, z: v.pz });
            c.body.setNextKinematicRotation({ x: v.qx, y: v.qy, z: v.qz, w: v.qw });
        });
        active.forEach(function (e) { var l = e.body.linvel(); e.before = { x: l.x, z: l.z }; });
        world.timestep = dt;
        world.step();
        // what a car pushes comes back to it: the change of speed of an object that touches it, times its mass, is the impulse of the car on the
        // object, and the same impulse the other way is the one of the object on the car (only along the road: a push is not a lift)
        cars.forEach(function (c) {
            var v = c.v, ix = 0, iz = 0;
            // the objects close to this car whose speed changed in this step (one that was hit may already be a little away at the end of it)
            for (var n = 0; n < active.length; n++) {
                var e = active[n];
                if (!e.before) continue;
                var p0 = e.body.translation();
                if (Math.abs(p0.x - v.px) > e.radius + v.halfLength + 1.5 || Math.abs(p0.z - v.pz) > e.radius + v.halfLength + 1.5 || Math.abs(p0.y - v.py) > e.radius + 2.5) continue;
                var now = e.body.linvel();
                ix += e.mass * (now.x - e.before.x); iz += e.mass * (now.z - e.before.z);
            }
            stats.maxI = Math.max(stats.maxI || 0, Math.hypot(ix, iz));
            if (!ix && !iz) return;
            var mass = v.mass || 1000, dvx = -ix / mass, dvz = -iz / mass, dv = Math.hypot(dvx, dvz);
            if (dv > 3) { dvx *= 3 / dv; dvz *= 3 / dv; dv = 3; }
            // only what slows the car down: an object does not push it on
            if (dvx * v.vx + dvz * v.vz > 0) return;
            stats.pushed++;
            v.vx += dvx; v.vz += dvz;
            v.lastImpact = Math.max(v.lastImpact || 0, dv * 4); v.impactTime = 0;
        });
        active.forEach(function (e) { e.before = null; });
        for (var j = 0; j < active.length; j++) {
            var o = active[j], body = o.body;
            if (body.isSleeping()) { o.quiet = 0; continue; }
            var p = body.translation(), r = body.rotation();
            o.object.position.set(p.x, p.y, p.z);
            o.object.quaternion.set(r.x, r.y, r.z, r.w);
            var lin = body.linvel(), ang = body.angvel();
            if (Math.hypot(lin.x, lin.y, lin.z) < 0.12 && Math.hypot(ang.x, ang.y, ang.z) < 0.25) {
                o.quiet += dt;
                if (o.quiet > QUIET_SECONDS) { body.sleep(); o.quiet = 0; }          // lying still: asleep again
            } else o.quiet = 0;
            if (p.y < -500) { body.setEnabled(false); o.object.visible = false; }
        }
    }

    // every object back where it was, asleep
    function reset() {
        if (!ready) return;
        objects.forEach(function (e) {
            e.body.setEnabled(true);
            e.body.setTranslation({ x: e.home.p.x, y: e.home.p.y, z: e.home.p.z }, false);
            e.body.setRotation({ x: e.home.q.x, y: e.home.q.y, z: e.home.q.z, w: e.home.q.w }, false);
            e.body.setLinvel({ x: 0, y: 0, z: 0 }, false); e.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
            e.body.sleep();
            e.object.position.copy(e.home.p); e.object.quaternion.copy(e.home.q); e.object.visible = true;
            e.region = null;
        });
    }

    function clear() {
        objects.forEach(function (e) { if (e.object.parent) e.object.parent.remove(e.object); });
        objects = []; cars.clear(); carByCollider.clear(); objectByCollider.clear();
        world = null; trackCollider = null; ready = false;
    }

    // an object of track.json that has a model (a glb of the track folder, made in the track editor): the model is placed with its origin on the road, and
    // turned by the heading. Its kind ("kind"; the older "rigid": false is decor): rigid becomes a body whose shape is the hull of the model and whose pivot is
    // the middle of its box; static stands still and can be hit (its triangles join the walls and the 3D grid, TrackLoader.addStaticObject); decor is only
    // drawn, no physics knows it
    function fromModel(spec, gltfScene, ground, density, out) {
        var heading = (spec.heading || 0) * Math.PI / 180;
        var y = spec.y;
        if (y === undefined) { var hit = ground && ground.query ? ground.query(spec.x, spec.z, 5000, 0) : null; y = hit ? hit.y : 0; }
        var model = gltfScene.clone(true);
        model.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        // the origin of the model: "pivot" (the track editor puts it at the middle of the base of the model, so that the object stands where it was clicked, whatever the origin of the
        // file is), and the scale and the tilt of the object: "scale" (a number, or [x, y, z]), "pitch" and "roll" (degrees; the heading is the turn about the vertical)
        var inner = new THREE.Group();
        if (Array.isArray(spec.pivot) && spec.pivot.length === 3) model.position.set(-spec.pivot[0], -spec.pivot[1], -spec.pivot[2]);
        inner.add(model);
        if (typeof spec.scale === "number" && spec.scale > 0) inner.scale.setScalar(spec.scale);
        else if (Array.isArray(spec.scale) && spec.scale.length === 3) inner.scale.set(spec.scale[0] || 1, spec.scale[1] || 1, spec.scale[2] || 1);
        var turn = new THREE.Quaternion().setFromEuler(new THREE.Euler((spec.pitch || 0) * Math.PI / 180, -heading, (spec.roll || 0) * Math.PI / 180, "YXZ"));
        var kind = spec.kind || (spec.rigid === false ? "decor" : "rigid");
        if (kind !== "rigid") {
            inner.position.set(spec.x, y, spec.z);
            inner.quaternion.copy(turn);
            scene.add(inner);
            if (kind === "static" && OpenRacer.addStaticObject) OpenRacer.addStaticObject(inner);
            return;
        }
        inner.updateMatrixWorld(true);
        var box = new THREE.Box3().setFromObject(inner), size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
        var points = [], a = new THREE.Vector3(), count = 0;
        inner.traverse(function (o) { if (o.isMesh && o.geometry.attributes.position) count += o.geometry.attributes.position.count; });
        var step = Math.max(1, Math.floor(count / 160));
        inner.traverse(function (o) {
            if (!o.isMesh || !o.geometry.attributes.position) return;
            var position = o.geometry.attributes.position;
            for (var i = 0; i < position.count; i += step) {
                a.fromBufferAttribute(position, i).applyMatrix4(o.matrixWorld).sub(centre);
                points.push(a.x, a.y, a.z);
            }
        });
        var holder = new THREE.Group();
        inner.position.set(-centre.x, -centre.y, -centre.z);
        holder.add(inner);
        holder.quaternion.copy(turn);
        var middle = centre.clone().applyQuaternion(holder.quaternion);
        holder.position.set(spec.x + middle.x, y + middle.y, spec.z + middle.z);
        var mass = spec.mass || Math.max(1, size.x * size.y * size.z * density);
        out.push({ object: holder, shape: { type: "hull", points: uniquePoints(points), hx: size.x / 2, hy: size.y / 2, hz: size.z / 2 }, mass: mass, radius: size.length() / 2 });
    }

    // The track is loaded: the parts of the model that are rigid (made by TrackLoader.js, in the scene already) and the "objects" of track.json
    function setup(track, pieces) {
        clear();
        var specs = [];
        var density = track && track.rigid_density ? track.rigid_density : DENSITY;
        var ground = typeof groundWorld !== "undefined" ? groundWorld : null;
        (pieces || []).forEach(function (mesh) { specs.push(fromPiece(mesh, density)); });
        var withModel = [];
        ((track && track.objects) || []).forEach(function (spec) {
            if (spec.model) { withModel.push(spec); return; }
            try { fromSpec(spec, ground, specs); } catch (e) { console.warn("RigidObjects: " + e.message); }
        });
        // the glb of the objects: every file once
        var files = {};
        withModel.forEach(function (spec) {
            if (files[spec.model]) return;
            files[spec.model] = new Promise(function (resolve) {
                var loader = new THREE.GLTFLoader(OpenRacer.Garage ? OpenRacer.Garage.manager(track) : undefined);
                loader.load(trackFile(spec.model), function (gltf) { resolve(gltf.scene); }, undefined, function (e) { console.warn("RigidObjects: " + spec.model + " could not be loaded"); resolve(null); });
            });
        });
        var loaded = Promise.all(withModel.map(function (spec) { return files[spec.model]; })).then(function (scenes) {
            withModel.forEach(function (spec, i) { if (scenes[i]) { try { fromModel(spec, scenes[i], ground, density, specs); } catch (e) { console.warn("RigidObjects: " + e.message); } } });
        });
        loaded.then(function () {
            if (!specs.length) return null;
            specs.forEach(function (s) { if (!s.object.parent) scene.add(s.object); });
            return loadEngine().then(function (lib) { R = lib; build(specs); console.log("rigid objects: " + specs.length); });
        }).catch(function (e) { console.warn("RigidObjects: " + e.message); });
    }

    return { setup: setup, update: update, reset: reset, clear: clear, count: function () { return objects.length; }, awake: function () { return objects.filter(function (e) { return !e.body.isSleeping(); }).length; }, isReady: function () { return ready; }, stats: stats };
})();
