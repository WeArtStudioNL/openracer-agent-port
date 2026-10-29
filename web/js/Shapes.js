/*
 * Shapes.js
 *
 * Description: The body of a car made of simple shapes, with no model file: car.json holds the list and the game builds the parts from it, as it builds the parts of a glTF.
 *              The result is a group of named meshes in the frame of the car (x to the left, y up, z forward, the origin at the height of the wheel axles, between the axles),
 *              so everything that reads a model (the wheels by their names, the steering wheel, the suspension rig, the chain, the soft body) reads this the same way.
 *
 *              car.json:  "model": { "type": "shapes", "shapes": [ { "name": "body", "type": "box", "position": [0, 0.1, 0], "rotation": [0, 0, 0], "size": [0.9, 0.25, 2],
 *                                                                    "color": "#c0392b", "metal": 0.4, "rough": 0.5, "opacity": 1, "mirror": false, "parent": "" }, ... ] }
 *
 *              type      box, cylinder (its axis is Y: turn it 90 degrees about Z for a wheel), sphere (an ellipsoid), cone (the point up), wedge (a ramp: high at the rear,
 *                        the slope falls to the front; a nose, a windscreen)
 *              size      the width (x), the height (y) and the length (z) in metres; of a cylinder or a cone the diameter (x and z) and the height along its axis (y)
 *              rotation  degrees, about x, y and z (applied in the order y, x, z, as the car editor turns a part)
 *              mirror    a second shape at the other side of the car (x negated, the turn mirrored); its name has _FL, _RL or _L at the end replaced by _FR, _RR or _R, else _2 added
 *              parent    the name of another shape: this one is its child (its position and turn are in the frame of the parent), so that it goes along when the parent moves
 *                        (a part of the rig that is turned, a wheel with a rim)
 *
 *              OpenRacer.Shapes.build(list)       the group of meshes; group.userData.byName maps a name to its mesh (a mirrored copy too)
 *              OpenRacer.Shapes.normal(shape)     the shape with every field filled in
 *              OpenRacer.Shapes.mirrorName(name)  the name of the copy at the other side
 *              OpenRacer.Shapes.TYPES             the types
 * Author:      Glenn Hofman
 * Date:        2026-10-29
 * License:     MIT
 */

OpenRacer.Shapes = (function () {
    var TYPES = ["box", "cylinder", "sphere", "cone", "wedge"], DEG = Math.PI / 180;

    function num(v, d) { v = parseFloat(v); return isFinite(v) ? v : d; }
    function triple(list, d) { return [num(list && list[0], d[0]), num(list && list[1], d[1]), num(list && list[2], d[2])]; }

    function normal(s) {
        s = s || {};
        var type = TYPES.indexOf(s.type) >= 0 ? s.type : "box";
        return {
            name: String(s.name || type), type: type,
            position: triple(s.position, [0, 0, 0]), rotation: triple(s.rotation, [0, 0, 0]),
            size: triple(s.size, [0.5, 0.5, 0.5]).map(function (v) { return Math.max(0.001, v); }),
            color: /^#[0-9a-f]{6}$/i.test(s.color || "") ? s.color : "#9aa4b2",
            metal: Math.max(0, Math.min(1, num(s.metal, 0.2))), rough: Math.max(0, Math.min(1, num(s.rough, 0.6))), opacity: Math.max(0.05, Math.min(1, num(s.opacity, 1))),
            mirror: !!s.mirror, parent: String(s.parent || "")
        };
    }

    function mirrorName(name) {
        if(/_(FL|RL|L)$/.test(name)) return name.replace(/_FL$/, "_FR").replace(/_RL$/, "_RR").replace(/_L$/, "_R");
        return name + "_2";
    }

    // a ramp of unit size, centred: the top is at the rear (-z), the slope falls to the front (+z)
    function wedgeGeometry() {
        var a = [-0.5, -0.5, -0.5], b = [-0.5, -0.5, 0.5], c = [-0.5, 0.5, -0.5];          // the profile at x = -0.5 (y, z swapped in the order x, y, z)
        var p = function (x, v) { return [x, v[1], v[2]]; };
        var L = [p(-0.5, a), p(-0.5, b), p(-0.5, c)], R = [p(0.5, a), p(0.5, b), p(0.5, c)];
        var tris = [
            [L[0], L[2], L[1]], [R[0], R[1], R[2]],                                           // the two sides
            [L[0], L[1], R[1]], [L[0], R[1], R[0]],                                           // the floor
            [L[0], R[2], L[2]], [L[0], R[0], R[2]],                                           // the back
            [L[2], R[2], R[1]], [L[2], R[1], L[1]]                                            // the slope
        ];
        var pos = [];
        tris.forEach(function (t) { t.forEach(function (v) { pos.push(v[0], v[1], v[2]); }); });
        var g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        g.computeVertexNormals();
        return g;
    }

    var geometries = {};
    function geometryOf(type) {
        if(!geometries[type]) {
            geometries[type] = type === "box" ? new THREE.BoxGeometry(1, 1, 1) : type === "cylinder" ? new THREE.CylinderGeometry(0.5, 0.5, 1, 32) :
                type === "sphere" ? new THREE.SphereGeometry(0.5, 32, 20) : type === "cone" ? new THREE.CylinderGeometry(0, 0.5, 1, 32) : wedgeGeometry();
        }
        return geometries[type];
    }

    function makeMesh(s, name, mirrored, material) {
        var mesh = new THREE.Mesh(geometryOf(s.type), material);
        mesh.name = name;
        mesh.scale.set(s.size[0], s.size[1], s.size[2]);
        var x = mirrored ? -1 : 1;
        mesh.position.set(s.position[0] * x, s.position[1], s.position[2]);
        mesh.rotation.set(s.rotation[0] * DEG, s.rotation[1] * DEG * x, s.rotation[2] * DEG * x, "YXZ");
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        return mesh;
    }

    function build(list) {
        var group = new THREE.Group(), byName = {}, shapes = (list || []).map(normal), made = [];
        group.name = "shapes";
        group.userData.byName = byName;
        shapes.forEach(function (s, index) {
            var material = new THREE.MeshStandardMaterial({ color: new THREE.Color(s.color), metalness: s.metal, roughness: s.rough, transparent: s.opacity < 1, opacity: s.opacity });
            material.name = s.name;
            var mesh = makeMesh(s, s.name, false, material);
            mesh.userData.shapeIndex = index;
            byName[s.name] = mesh;
            made.push({ s: s, mesh: mesh, mirrored: false });
            if(s.mirror) {
                var other = makeMesh(s, mirrorName(s.name), true, material);
                other.userData.shapeIndex = index;
                byName[other.name] = other;
                made.push({ s: s, mesh: other, mirrored: true });
            }
        });
        // the parents: a mirrored shape hangs on the mirrored copy of its parent when that has one
        made.forEach(function (m) { m.mesh.userData.mirrored = m.mirrored; });
        made.forEach(function (m) {
            var parentName = m.s.parent, parent = null;
            if(parentName && parentName !== m.s.name) {
                var twin = byName[mirrorName(parentName)];
                parent = m.mirrored && twin && twin.userData.mirrored ? twin : byName[parentName];
            }
            if(parent && parent !== m.mesh) m.mesh.userData.parentMesh = parent;
        });
        made.forEach(function (m) {
            var parent = m.mesh.userData.parentMesh;
            // (no loop: a parent that hangs on this shape again stays on the group)
            for(var up = parent; up; up = up.userData.parentMesh) if(up === m.mesh) { parent = null; break; }
            if(parent) {
                // the scale of the parent is not passed on: the child is placed in a frame of the parent at its own size
                var holder = parent.userData.holder;
                if(!holder) { holder = new THREE.Group(); holder.name = parent.name + " children"; parent.userData.holder = holder; }
                holder.add(m.mesh);
            } else group.add(m.mesh);
        });
        // a shape with children is a group with the shape (at its size) and the children (at theirs) beside it, so that a scaled parent does not scale them
        made.forEach(function (m) {
            var holder = m.mesh.userData.holder;
            if(!holder) return;
            var parentOfMesh = m.mesh.parent, node = new THREE.Group();
            node.name = m.mesh.name;
            node.position.copy(m.mesh.position); node.quaternion.copy(m.mesh.quaternion);
            m.mesh.position.set(0, 0, 0); m.mesh.quaternion.identity(); m.mesh.name = m.mesh.name + " shape";
            node.add(m.mesh);
            holder.children.slice().forEach(function (c) { node.add(c); });
            parentOfMesh.remove(m.mesh); parentOfMesh.add(node);
            byName[node.name] = node;
            node.userData.shapeIndex = m.mesh.userData.shapeIndex;
            node.userData.mirrored = m.mesh.userData.mirrored;
            node.userData.parentMesh = m.mesh.userData.parentMesh;
        });
        return group;
    }

    return { build: build, normal: normal, mirrorName: mirrorName, TYPES: TYPES };
})();
