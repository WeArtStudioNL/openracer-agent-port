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
    var MAX_NODES = 128;

    // root: the model of the body (THREE.Object3D); toVehicle(p): its points into the frame of the car, in place (as in CollisionProxy.js).
    // Gives { update() } to call every frame, or null when this is not possible
    function attach(root, softBody, toVehicle) {
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

        root.traverse(function (mesh) {
            if (!mesh.isMesh || !mesh.geometry || !mesh.geometry.attributes.position) return;
            var geometry = mesh.geometry;
            if (geometry.attributes.aNodes) return;                 // a geometry that two meshes share is done once
            var position = geometry.attributes.position;
            var count = position.count;
            var aNodes = new Float32Array(4 * count), aWeights = new Float32Array(4 * count);
            var best = [0, 0, 0, 0], bestD = [1e9, 1e9, 1e9, 1e9];
            for (var v = 0; v < count; v++) {
                p.fromBufferAttribute(position, v).applyMatrix4(mesh.matrixWorld);
                toVehicle(p);
                best[0] = best[1] = best[2] = best[3] = 0; bestD[0] = bestD[1] = bestD[2] = bestD[3] = 1e9;
                for (var n = 0; n < N; n++) {
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
            // a vector of the frame of the car in the space of this mesh
            var toLocal = new THREE.Matrix3().setFromMatrix4(mesh.matrixWorld).invert();
            var list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            var copies = list.map(function (material) {
                var copy = material.clone();
                copy.onBeforeCompile = function (shader) {
                    shader.uniforms.uNodeD = uniform;
                    shader.uniforms.uToLocal = { value: toLocal };
                    shader.vertexShader = shader.vertexShader
                        .replace("#include <common>", "#include <common>\nattribute vec4 aNodes;\nattribute vec4 aWeights;\nuniform vec3 uNodeD[" + MAX_NODES + "];\nuniform mat3 uToLocal;")
                        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvec3 sbD = uNodeD[int(aNodes.x + 0.5)] * aWeights.x + uNodeD[int(aNodes.y + 0.5)] * aWeights.y + uNodeD[int(aNodes.z + 0.5)] * aWeights.z + uNodeD[int(aNodes.w + 0.5)] * aWeights.w;\ntransformed += uToLocal * sbD;");
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
            // once per frame: the displacements to the graphics card, when something moved
            update: function () {
                if (softBody.version === seen) return;
                seen = softBody.version;
                uniform.value.set(softBody.displacement);
                for (var m = 0; m < materials.length; m++) materials[m].uniformsNeedUpdate = true;
            }
        };
    }

    return { attach: attach };
})();
