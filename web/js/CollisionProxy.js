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
        if(wheels) wheels.forEach(function (w) { spheres.push({ x: w.x, y: w.y, z: w.z, r: Math.max(0.12, 0.55 * w.radius), wheel: true }); });
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
        var spheres = null;
        var maxNodes = object.config && object.config.softbody && object.config.softbody.max_nodes;    // car.json "softbody": { "max_nodes": 60 }
        try { spheres = fromModel(model.tilt, toVehicle, wheels, maxNodes); } catch (e) { console.warn("CollisionProxy: " + e.message); }
        // car.json "softbody": { "layout": [{ x, y, z, r }] }: the nodes as the maker of the car set them in the editor, instead of the ones made from the model
        var layout = object.config && object.config.softbody && object.config.softbody.layout;
        if(spheres && layout && layout.length) {
            var own = layout.slice(0, 200).filter(function (n) { return isFinite(n.x) && isFinite(n.y) && isFinite(n.z) && n.r > 0; })
                .map(function (n) {
                    // a node must not reach below the underside of the car (the ground clearance): a big node low in the car would stand on the road with
                    // the wheels (the car rode on its nodes, and hovered over bumps with its wheels barely loaded), so its radius is cut to what is above that
                    var r = Math.min(0.6, Math.max(0.05, n.r));
                    var floor = -v.cgHeight + (v.groundClearance || 0);
                    if(n.y - r < floor) r = Math.max(0.05, n.y - floor);
                    return { x: n.x, y: n.y, z: n.z, r: r, part: typeof n.part === "string" ? n.part : null };
                });
            if(own.length >= 3) spheres = own.concat(spheres.filter(function (sp) { return sp.wheel; }));
        }
        if(spheres) {
            v.collisionSpheres = spheres;
            console.log("collision proxy: " + spheres.length + " spheres from the model");
            // the shell of the car that dents (SoftBody.js), and its model (SoftBodyMesh.js); car.json "softbody": { "enabled": false } leaves it out
            var cfg = (object.config && object.config.softbody) || {};
            if(cfg.enabled !== false && OpenRacer.SoftBody) {
                v.softBody = new OpenRacer.SoftBody(v, spheres, cfg);
                try { object.softBodyMesh = OpenRacer.SoftBodyMesh.attach(model.tilt, v.softBody, toVehicle, partGroups(object, model)); } catch(e) { console.warn("SoftBodyMesh: " + e.message); }
                console.log("soft body: " + v.softBody.count + " nodes, " + v.softBody.beamCount + " beams");
            }
            // loose and hinged parts (Parts.js); car.json "parts": [{ object, mode, ... }]
            if(OpenRacer.Parts && object.config && object.config.parts && object.config.parts.length) {
                OpenRacer.Parts.create({
                    vehicle: v, softBody: v.softBody, softBodyMesh: object.softBodyMesh, spheres: spheres, specs: object.config.parts,
                    root: model.tilt, toVehicle: toVehicle
                }).then(function (parts) { if(parts) { object.parts = parts; v.parts = parts; console.log("parts: " + parts.parts.length); } });
            }
        }
        return spheres;
    }

    return { fromModel: fromModel, apply: apply };
})();
