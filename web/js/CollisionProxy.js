/*
 * CollisionProxy.js
 *
 * Description: The collision shape of a car, made from its model when the car is made. The model of the body is turned into a cloud of
 *              spheres that follows its outline: the surface of the model is sampled, the car is cut into columns seen from above, and every
 *              column gets a sphere at its lowest point, one at its highest and, at the edge of the car, one in the middle. The spheres are
 *              what the 3D physics (Vehicle.js, "the body in the 3D physics") tests against the triangles of the track, so a car with a long
 *              nose, a high roof or a spoiler hits things where its model does, and not as a box.
 *
 *              The spheres are in the frame of the car, from its centre of gravity (x to the left, y up, z forward), as { x, y, z, r }.
 *              They are the first step to a car that deforms: the same points can become the nodes of a skeleton of beams, which dents the
 *              model when it is hit (not made yet).
 */

OpenRacer.CollisionProxy = (function () {
    var MAX_SPHERES = 90;

    // root: the model of the body (a THREE.Object3D, without the wheels); toVehicle(p): puts a point of the model (a THREE.Vector3, in the
    // space of the body) in the frame of the car, in place; wheels: [{ x, y, z, radius }], the middles of the wheels in that frame.
    // Gives the spheres, or null when the model has too little in it.
    function fromModel(root, toVehicle, wheels, maxSpheres) {
        var limit = Math.max(8, Math.min(120, maxSpheres || MAX_SPHERES));
        root.updateMatrixWorld(true);
        var points = [];                  // x, y, z of the sampled surface in the frame of the car
        var a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), p = new THREE.Vector3();
        root.traverse(function (mesh) {
            if (!mesh.isMesh || !mesh.geometry || !mesh.geometry.attributes.position) return;
            if (mesh.userData && mesh.userData.noCollision) return;
            var position = mesh.geometry.attributes.position, index = mesh.geometry.index;
            var count = index ? index.count / 3 : position.count / 3;
            for (var t = 0; t < count; t++) {
                var i0 = index ? index.getX(t * 3) : t * 3, i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1, i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
                a.fromBufferAttribute(position, i0).applyMatrix4(mesh.matrixWorld); toVehicle(a);
                b.fromBufferAttribute(position, i1).applyMatrix4(mesh.matrixWorld); toVehicle(b);
                c.fromBufferAttribute(position, i2).applyMatrix4(mesh.matrixWorld); toVehicle(c);
                var longest = Math.max(a.distanceTo(b), a.distanceTo(c), b.distanceTo(c));
                // a big triangle (a roof, a door) is sampled on a grid, or its middle would be missed
                var n = Math.min(10, Math.max(1, Math.ceil(longest / 0.2)));
                for (var i = 0; i <= n; i++) {
                    for (var j = 0; j <= n - i; j++) {
                        p.set(a.x + (b.x - a.x) * i / n + (c.x - a.x) * j / n, a.y + (b.y - a.y) * i / n + (c.y - a.y) * j / n, a.z + (b.z - a.z) * i / n + (c.z - a.z) * j / n);
                        points.push(p.x, p.y, p.z);
                    }
                }
            }
        });
        if (points.length < 30) return null;

        var spheres = null;
        for(var cell = 0.5; cell <= 3; cell += 0.1) {
            spheres = columns(points, cell);
            if(spheres.length + (wheels ? wheels.length : 0) <= limit || (!maxSpheres && cell >= 1.2)) break;
        }
        if(!spheres || spheres.length < 8) return null;
        // the wheels stick out of the body: a sphere on each, smaller than the wheel, so the road is felt by the suspension and not by this
        // (the sphere of a wheel: a little over half its radius, 6 cm at least. It was 12 cm at least: on a kart wheel of 13 cm that sphere nearly filled the tyre, its underside hung
        // 1.5 cm over the road, and the kart rode on its hubs with the tyres barely loaded as soon as it sagged a little)
        if(wheels) wheels.forEach(function (w, wi) { spheres.push({ x: w.x, y: w.y, z: w.z, r: Math.max(0.06, 0.55 * w.radius), wheel: true, wheelIndex: wi }); });
        return spheres;
    }

    // The car cut into columns of a square of 'cell' metres seen from above: the lowest and the highest point of each, as spheres
    function columns(points, cell) {
        var map = new Map();
        for(var k = 0; k < points.length; k += 3) {
            var ix = Math.floor(points[k] / cell), iz = Math.floor(points[k + 2] / cell);
            var key = ix * 100003 + iz;
            var col = map.get(key);
            var y = points[k + 1];
            if(!col) { col = { ix: ix, iz: iz, lo: y, hi: y }; map.set(key, col); }
            else { if(y < col.lo) col.lo = y; if(y > col.hi) col.hi = y; }
        }
        var out = [];
        var r = Math.min(0.28, cell * 0.55);
        map.forEach(function (col) {
            var x = (col.ix + 0.5) * cell, z = (col.iz + 0.5) * cell;
            var h = col.hi - col.lo;
            if(h < 0.04) return;                                   // a thin thing (an aerial, a wing mirror) is not a part of the body
            if(h <= 2 * r + 0.05) {
                out.push({ x: x, y: (col.lo + col.hi) / 2, z: z, r: Math.max(0.1, h / 2 + 0.03) });
                return;
            }
            out.push({ x: x, y: col.lo + r, z: z, r: r });
            out.push({ x: x, y: col.hi - r, z: z, r: r });
            // at the edge of the car the sides need a sphere between the lowest and the highest
            var edge = !map.has((col.ix + 1) * 100003 + col.iz) || !map.has((col.ix - 1) * 100003 + col.iz) ||
                !map.has(col.ix * 100003 + col.iz + 1) || !map.has(col.ix * 100003 + col.iz - 1);
            if(edge && h > 4 * r + 0.1) out.push({ x: x, y: (col.lo + col.hi) / 2, z: z, r: r });
        });
        return out;
    }

    // The part of car.json "parts" that a mesh of the model belongs to (by the object that the part names), or null: for SoftBodyMesh.js
    function partGroups(object, model) {
        var map = new Map();
        ((object.config && object.config.parts) || []).forEach(function (spec) {
            var holder = spec && spec.object ? model.tilt.getObjectByName(spec.object) : null;
            if(holder) holder.traverse(function (m) { map.set(m, spec.object); });
        });
        return function (mesh) { return map.get(mesh) || null; };
    }

    // For a Car or an Opponent that has loaded its model: sets the collision shape of its vehicle
    // (model: what OpenRacer.loadCarModel gave, modelMid: the middle between the wheels of the model, or null)
    function apply(object, model, modelMid) {
        var v = object.vehicle;
        var radius = object.wheels[0].radius;
        var zCentre = (v.af - v.ar) / 2;
        var lift = ((object.bodyLift || model.bodyLift || 1) - 1) * radius;
        var toVehicle = modelMid ?
            function (q) { q.set(q.x - modelMid.x, q.y - modelMid.y + radius - v.cgHeight, q.z - modelMid.z + zCentre); } :
            function (q) { q.set(q.x, q.y + radius - v.cgHeight + lift, q.z + zCentre); };
        // the wheels in the same frame: where they are at rest, from the mounts of the physics
        var wheels = object.wheels.map(function (w) {
            return { x: w.mount.x, y: w.radius - v.cgHeight, z: w.mount.z, radius: w.radius };   // the axle is one radius above the road at rest
        });
        // The ground clearance of the car: the underside of its model above the road (the lowest corner of the boxes of the parts of the body, in the frame of the car), or
        // chassis.ground_clearance when car.json says it. It was 13 cm for every car (Vehicle.js): a kart with its floor at 3 cm had the nodes of its floor cut back to the
        // smallest radius and standing 3 cm into the road, and rode on them with its wheels in the air
        var clearance = object.config && object.config.chassis && isFinite(object.config.chassis.ground_clearance) ? object.config.chassis.ground_clearance : null;
        if(clearance === null && model.tilt) {
            var lowest = Infinity, corner = new THREE.Vector3(), box = new THREE.Box3();
            model.tilt.updateMatrixWorld(true);
            model.tilt.traverse(function (child) {
                if(!child.isMesh || !child.geometry) return;
                if(!child.geometry.boundingBox) child.geometry.computeBoundingBox();
                var b = child.geometry.boundingBox;
                for(var ci = 0; ci < 8; ci++) {
                    corner.set(ci & 1 ? b.max.x : b.min.x, ci & 2 ? b.max.y : b.min.y, ci & 4 ? b.max.z : b.min.z).applyMatrix4(child.matrixWorld);
                    model.tilt.worldToLocal(corner);
                    toVehicle(corner);
                    if(corner.y < lowest) lowest = corner.y;
                }
            });
            if(isFinite(lowest)) clearance = lowest + v.cgHeight;
        }
        if(clearance !== null && isFinite(clearance)) v.groundClearance = Math.max(0.02, Math.min(0.6, clearance));
        var spheres = null;
        var maxNodes = object.config && object.config.softbody && object.config.softbody.max_nodes;    // car.json "softbody": { "max_nodes": 60 }
        try { spheres = fromModel(model.tilt, toVehicle, wheels, maxNodes); } catch (e) { console.warn("CollisionProxy: " + e.message); }
        // car.json "softbody": { "layout": [{ x, y, z, r }] }: the nodes as the maker of the car set them in the editor, instead of the ones made from the model
        var layout = object.config && object.config.softbody && object.config.softbody.layout;
        if(spheres && layout && layout.length) {
            // The layout is in the frame of the body: its up runs from the centre of gravity, and the body sits at the centre of gravity's height above the road. Drawn at one
            // centre of gravity (softbody.layout_cg, the car editor writes it) and used with another (a tune that lowers the car's centre of gravity), the whole shell would
            // move by the difference against the road and the model (a kart whose centre went down 11 cm stood on its floor nodes with its wheels in the air): the nodes are
            // shifted back by it, and by a change of the tyre radius, which moves the axle against the centre the other way
            var cfgSoft = object.config.softbody;
            var shift = (isFinite(cfgSoft.layout_cg) ? cfgSoft.layout_cg - v.cgHeight : 0) + (isFinite(cfgSoft.layout_radius) ? radius - cfgSoft.layout_radius : 0);
            var own = layout.slice(0, 200).filter(function (n) { return isFinite(n.x) && isFinite(n.y) && isFinite(n.z) && n.r > 0; })
                .map(function (n) {
                    // a node must not reach below the underside of the car (the ground clearance): a big node low in the car would stand on the road with
                    // the wheels (the car rode on its nodes, and hovered over bumps with its wheels barely loaded), so its radius is cut to what is above that
                    var r = Math.min(0.6, Math.max(0.05, n.r)), y = n.y + shift;
                    var floor = -v.cgHeight + (v.groundClearance || 0);
                    // (a node at the floor becomes small rather than standing through it: 2 cm at least, and its middle at least that far above the floor)
                    if(y - r < floor) { if(y < floor + 0.02) y = floor + 0.02; r = Math.max(0.02, Math.min(r, y - floor)); }
                    return { x: n.x, y: y, z: n.z, r: r, part: typeof n.part === "string" ? n.part : null };
                });
            if(own.length >= 3) spheres = own.concat(spheres.filter(function (sp) { return sp.wheel; }));
        }
        var cfg = (object.config && object.config.softbody) || {};
        if(spheres && cfg.enabled !== false && OpenRacer.SoftBody && cfg.wheel_hubs !== false) {
            // The suspension is part of the shell: a hub, a knuckle (three more nodes: the ball joints above and below, and the end of the tie rod) and
            // the pivots of the arms on the car, for every wheel, joined by beams (below, after the shell is made). A hit on the wheel bends the arms
            // and the tie rod, and the toe, the camber and the place of the wheel are worked out from where the nodes are (Vehicle.js, updateHubs).
            // The collision sphere of the wheel is the hub. These nodes come last, and are not part of the model.
            var rigSpheres = [];
            spheres.forEach(function (sp) {
                var wheel = sp.wheel && object.wheels[sp.wheelIndex];
                if(!wheel) return;
                var s = sp.x > 0 ? -1 : 1;                    // towards the middle of the car (x is to the left)
                // the places of the joints are those of a car wheel (0.32 m of radius); a smaller wheel (a kart) has them closer to the hub, or the lower ball joint and the arms
                // stand in the road
                var fit = Math.min(1, (wheel.radius || 0.32) / 0.3);
                var add = function (role, dx, dy, dz, r) { rigSpheres.push({ x: sp.x + s * dx * fit, y: sp.y + dy * fit, z: sp.z + dz * fit, r: r, rig: true, role: role, wheelIndex: sp.wheelIndex, hub: role === "H" }); };
                add("H", 0, 0, 0, sp.r);
                add("Ub", 0.12, 0.14, 0, 0.02); add("Lb", 0.10, -0.14, 0, 0.02); add("Te", 0.12, -0.04, -0.12, 0.02);
                add("U1", 0.45, 0.20, 0.15, 0.02); add("U2", 0.45, 0.20, -0.15, 0.02);
                add("L1", 0.50, -0.12, 0.20, 0.02); add("L2", 0.50, -0.12, -0.20, 0.02);
                add("R", 0.50, -0.02, -0.12, 0.02);
            });
            if(rigSpheres.length) spheres = spheres.filter(function (sp) { return !sp.wheel; }).concat(rigSpheres);
        }
        if(spheres) {
            v.collisionSpheres = spheres;
            console.log("collision proxy: " + spheres.length + " spheres from the model");
            // the shell of the car that dents (SoftBody.js), and its model (SoftBodyMesh.js); car.json "softbody": { "enabled": false } leaves it out
            // (damage off, main.js: the car is a rigid body, its spheres still touch the road and the walls; nothing dents, nothing comes off)
            var damage = OpenRacer.damageEnabled !== false;
            if(cfg.enabled !== false && OpenRacer.SoftBody && damage) {
                v.softBody = new OpenRacer.SoftBody(v, spheres, cfg);
                try { object.softBodyMesh = OpenRacer.SoftBodyMesh.attach(model.tilt, v.softBody, toVehicle, partGroups(object, model)); } catch(e) { console.warn("SoftBodyMesh: " + e.message); }
                console.log("soft body: " + v.softBody.count + " nodes, " + v.softBody.beamCount + " beams");
                v.hubLimit = cfg.hub_limit !== undefined ? cfg.hub_limit : 0.3;
                var sbody = v.softBody, nodes = [{}, {}, {}, {}];
                spheres.forEach(function (sp, si) {
                    if(!sp.rig) return;
                    var k = sbody.nodeOfSphere[si];
                    if(k < 0) return;
                    nodes[sp.wheelIndex][sp.role] = k;
                    if(sp.role === "H") { v.hubNode[sp.wheelIndex] = k; v.hubSphere[sp.wheelIndex] = si; }
                });
                // the strength of the parts of the suspension (cfg: arm_yield, arm_break, tie_yield, tie_break in kN)
                var arm = { stiffness: 8e5, yield_force: (cfg.arm_yield !== undefined ? cfg.arm_yield : 14) * 1000, break_force: (cfg.arm_break !== undefined ? cfg.arm_break : 36) * 1000 };
                var tie = { stiffness: 1.2e6, yield_force: (cfg.tie_yield !== undefined ? cfg.tie_yield : 12) * 1000, break_force: (cfg.tie_break !== undefined ? cfg.tie_break : 36) * 1000 };
                var stiff = { stiffness: 1e6, yield_force: 60000, break_force: 200000 };
                var p0 = { x: 0, y: 0, z: 0 }, p1 = { x: 0, y: 0, z: 0 };
                for(var wi = 0; wi < 4; wi++) {
                    var n = nodes[wi];
                    if(n.H === undefined) continue;
                    // held by its beams, not by its anchor; the pivots on the car are stiff
                    sbody.setNode(n.H, { mass: 18, anchorScale: 0.02, yield: 1e9, break: 1e9 });
                    ["Ub", "Lb", "Te"].forEach(function (role) { sbody.setNode(n[role], { mass: 6, anchorScale: 0.02, yield: 1e9, break: 1e9 }); });
                    ["U1", "U2", "L1", "L2", "R"].forEach(function (role) { sbody.setNode(n[role], { mass: 10, anchorScale: 3, yield: 150000, break: 400000 }); });
                    var rig = {
                        nodes: n,
                        upper: [sbody.addBeam(n.U1, n.Ub, arm), sbody.addBeam(n.U2, n.Ub, arm)],
                        lower: [sbody.addBeam(n.L1, n.Lb, arm), sbody.addBeam(n.L2, n.Lb, arm)],
                        tie: sbody.addBeam(n.R, n.Te, tie)
                    };
                    // the knuckle is stiff: it turns, it does not bend
                    [["H", "Ub"], ["H", "Lb"], ["H", "Te"], ["Ub", "Lb"], ["Ub", "Te"], ["Lb", "Te"]].forEach(function (pair) { sbody.addBeam(n[pair[0]], n[pair[1]], stiff); });
                    sbody.restPosition(n.Ub, p0); sbody.restPosition(n.Lb, p1);
                    rig.camber0 = Math.atan2(p0.x - p1.x, p0.y - p1.y);
                    sbody.restPosition(n.Te, p0); sbody.restPosition(n.H, p1);
                    rig.toe0 = Math.atan2(p0.x - p1.x, p0.z - p1.z);
                    rig.home = { x: p1.x, y: p1.y, z: p1.z };
                    v.rig[wi] = rig;
                }
            }
            // the wheels: car.json "softbody": { "wheel_strength": 25 } is the hit (kN s) that tears a wheel off; 0 keeps them on
            v.wheelStrength = v.softBody ? (cfg.wheel_strength !== undefined ? Math.max(0, cfg.wheel_strength) : 25) * 1000 : 0;
            // loose and hinged parts (Parts.js); car.json "parts": [{ object, mode, ... }]
            var partSpecs = (object.config && object.config.parts) || [];
            if(OpenRacer.Parts && damage && (partSpecs.length || v.wheelStrength > 0)) {
                OpenRacer.Parts.create({
                    vehicle: v, softBody: v.softBody, softBodyMesh: object.softBodyMesh, spheres: spheres, specs: partSpecs,
                    root: model.tilt, toVehicle: toVehicle, wheelObjects: v.wheelStrength > 0 ? model.wheels : null
                }).then(function (parts) { if(parts) { object.parts = parts; v.parts = parts; console.log("parts: " + parts.parts.length); } });
            }
        }
        return spheres;
    }

    return { fromModel: fromModel, apply: apply };
})();
