/*
 * SoftBodyMesh.js
 *
 * Description: Bends the model of a car with the nodes of its shell (SoftBody.js). Every vertex of the body is tied to its four nearest
 *              nodes, with weights; the vertex shader moves it with them. So it costs the processor nothing: only the displacements of the
 *              nodes (up to 128, three numbers each) go to the graphics card, and only when one has moved.
 *              The materials of the body are copied for this (a copy for every mesh, because the turn of a mesh into the frame of the car is
 *              a uniform of its material).
 */

OpenRacer.SoftBodyMesh = (function () {
    var MAX_NODES = 200;

    // root: the model of the body (THREE.Object3D); toVehicle(p): its points into the frame of the car, in place (as in CollisionProxy.js).
    // Gives { update() } to call every frame, or null when this is not possible
    // groupOf(mesh) (optional): the name of the part that a mesh belongs to, or null for the body. The vertices of a part are tied to the nodes of
    // that part (so a hood dents by itself), the vertices of the body to the nodes that belong to no part.
    function attach(root, softBody, toVehicle, groupOf) {
        if (!softBody || softBody.count < 1 || softBody.count > MAX_NODES) return null;
        root.updateMatrixWorld(true);
        var N = softBody.count;
        var nodes = new Float32Array(3 * N);
        var tmp = { x: 0, y: 0, z: 0 };
        for (var k = 0; k < N; k++) { softBody.restPosition(k, tmp); nodes[3 * k] = tmp.x; nodes[3 * k + 1] = tmp.y; nodes[3 * k + 2] = tmp.z; }
        var uniform = { value: new Float32Array(3 * MAX_NODES) };
        var materials = [];
        var p = new THREE.Vector3();
        var seen = -1;

        restore(root);                                              // a model that was made with other nodes before (the car editor) starts again
        var done = new Set();
        root.traverse(function (mesh) {
            if (!mesh.isMesh || !mesh.geometry || !mesh.geometry.attributes.position) return;
            var geometry = mesh.geometry;
            if (done.has(geometry)) return;                          // a geometry that two meshes share is done once
            done.add(geometry);
            var position = geometry.attributes.position;
            var count = position.count;
            var group = groupOf ? groupOf(mesh) : null;
            var allowed = [];
            for (var gn = 0; gn < N; gn++) if ((softBody.partOf ? softBody.partOf[gn] : null) === group) allowed.push(gn);
            if (!allowed.length) { group = null; allowed = []; for (var g2 = 0; g2 < N; g2++) allowed.push(g2); }
            var aNodes = new Float32Array(4 * count), aWeights = new Float32Array(4 * count);
            var best = [0, 0, 0, 0], bestD = [1e9, 1e9, 1e9, 1e9];
            for (var v = 0; v < count; v++) {
                p.fromBufferAttribute(position, v).applyMatrix4(mesh.matrixWorld);
                toVehicle(p);
                best[0] = best[1] = best[2] = best[3] = 0; bestD[0] = bestD[1] = bestD[2] = bestD[3] = 1e9;
                for (var ai = 0; ai < allowed.length; ai++) {
                    var n = allowed[ai];
                    var dx = p.x - nodes[3 * n], dy = p.y - nodes[3 * n + 1], dz = p.z - nodes[3 * n + 2];
                    var d = dx * dx + dy * dy + dz * dz;
                    if (d >= bestD[3]) continue;
                    // insert in the sorted list of four
                    var slot = 3;
                    while (slot > 0 && d < bestD[slot - 1]) { bestD[slot] = bestD[slot - 1]; best[slot] = best[slot - 1]; slot--; }
                    bestD[slot] = d; best[slot] = n;
                }
                var sum = 0, W = [0, 0, 0, 0];
                for (var i = 0; i < 4; i++) { var dist = Math.sqrt(bestD[i]); W[i] = i === 0 || dist < 0.9 ? Math.pow(Math.max(0.02, 1 - dist / 0.9), 2) : 0; sum += W[i]; }
                for (var j = 0; j < 4; j++) { aNodes[4 * v + j] = best[j]; aWeights[4 * v + j] = W[j] / sum; }
            }
            geometry.setAttribute("aNodes", new THREE.BufferAttribute(aNodes, 4));
            geometry.setAttribute("aWeights", new THREE.BufferAttribute(aWeights, 4));
            var deform = { value: 1 };                              // 0 for a part that has come loose: it keeps its shape
            mesh.userData.sbDeform = deform;
            // a vector of the frame of the car in the space of this mesh
            var toLocal = new THREE.Matrix3().setFromMatrix4(mesh.matrixWorld).invert();
            mesh.userData.sbOriginal = mesh.material;
            var list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            var copies = list.map(function (material) {
                var copy = material.clone();
                copy.onBeforeCompile = function (shader) {
                    shader.uniforms.uNodeD = uniform;
                    shader.uniforms.uToLocal = { value: toLocal };
                    shader.uniforms.uDeform = deform;
                    shader.vertexShader = shader.vertexShader
                        .replace("#include <common>", "#include <common>\nattribute vec4 aNodes;\nattribute vec4 aWeights;\nuniform vec3 uNodeD[" + MAX_NODES + "];\nuniform mat3 uToLocal;\nuniform float uDeform;")
                        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvec3 sbD = uNodeD[int(aNodes.x + 0.5)] * aWeights.x + uNodeD[int(aNodes.y + 0.5)] * aWeights.y + uNodeD[int(aNodes.z + 0.5)] * aWeights.z + uNodeD[int(aNodes.w + 0.5)] * aWeights.w;\ntransformed += uDeform * (uToLocal * sbD);");
                };
                copy.customProgramCacheKey = function () { return "softbody" + MAX_NODES; };
                materials.push(copy);
                return copy;
            });
            mesh.material = Array.isArray(mesh.material) ? copies : copies[0];
        });
        if (!materials.length) return null;

        return {
            materials: materials,
            // a part that comes loose (Parts.js) stops bending with the shell
            release: function (object) {
                object.traverse(function (m) { if (m.userData && m.userData.sbDeform) m.userData.sbDeform.value = 0; });
            },
            // once per frame: the displacements to the graphics card, when something moved
            update: function () {
                if (softBody.version === seen) return;
                seen = softBody.version;
                uniform.value.set(softBody.displacement);
                for (var m = 0; m < materials.length; m++) materials[m].uniformsNeedUpdate = true;
            }
        };
    }

    // The model as it was before attach: its own materials, without the weights
    function restore(root) {
        root.traverse(function (mesh) {
            if (!mesh.isMesh) return;
            if (mesh.userData && mesh.userData.sbOriginal) { mesh.material = mesh.userData.sbOriginal; delete mesh.userData.sbOriginal; }
            if (mesh.geometry && mesh.geometry.attributes.aNodes) { mesh.geometry.deleteAttribute("aNodes"); mesh.geometry.deleteAttribute("aWeights"); }
            if (mesh.userData) delete mesh.userData.sbDeform;
        });
    }

    return { attach: attach, restore: restore };
})();
