/*
 * Mirrors.js
 *
 * Description: The mirrors of a car that can be aimed in the game. The glass of a mirror is a mesh of the model with a material called "mirror" (the i30 has two: a smooth metal that
 *              shows the reflections of Scene.js, the cube map of the surroundings). Each glass is turned about its own middle, so that it shows another part of the surroundings: behind
 *              the car, or beside it. The glass at the left of the car is the left mirror, the one at the right is the right mirror, and one near the middle is the one inside the car.
 *
 *              Options (Settings.js, the Car page of the menu), in degrees: mirrorLeftYaw, mirrorLeftTilt, mirrorRightYaw, mirrorRightTilt, mirrorCentreYaw, mirrorCentreTilt: the turn
 *              (positive: outwards for the left and the right glass, to the left for the one inside) and the tilt (positive: up) of that glass from where the model has it.
 *
 *              var mirrors = OpenRacer.Mirrors.find(model.tilt)   the glass meshes of a model, each as { mesh, pivot, side }; empty for a car without
 *              OpenRacer.Mirrors.aim(mirrors)                      sets them from the options
 * Author:      Glenn Hofman
 * Date:        2026-10-28
 * License:     MIT
 */

OpenRacer.Mirrors = (function () {
    var LIMIT = 25;                                                   // degrees, from where the model has the glass

    function isGlass(mesh) {
        if (!mesh.isMesh || !mesh.material) return false;
        return [].concat(mesh.material).some(function (m) { return m && /mirror|spiegel/i.test(m.name || "") && (m.metalness === undefined || m.metalness > 0.5); });
    }

    // the glass meshes of the model and a pivot at the middle of each, in the space of the parent of the mesh (the mesh goes into the pivot, so that it turns about its own middle)
    function find(root) {
        var list = [];
        if (!root) return list;
        root.updateMatrixWorld(true);
        var glass = [];
        root.traverse(function (o) { if (isGlass(o)) glass.push(o); });
        glass.forEach(function (mesh) {
            if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
            var centre = mesh.geometry.boundingBox.getCenter(new THREE.Vector3());
            var parent = mesh.parent;
            var pivot = new THREE.Group();
            pivot.name = "mirror pivot";
            // (the pivot stands where the middle of the glass is in the space of the parent; the mesh keeps its place in it)
            pivot.position.copy(centre.clone().applyMatrix4(mesh.matrix));
            parent.add(pivot);
            parent.remove(mesh);
            mesh.position.sub(pivot.position);
            pivot.add(mesh);
            // left or right of the car: where the middle of the glass is in the space of the model (+x is the left of the car)
            var world = new THREE.Vector3().copy(centre).applyMatrix4(mesh.matrixWorld);
            var local = root.worldToLocal(world.clone());
            list.push({ mesh: mesh, pivot: pivot, x: local.x, side: "" });
        });
        if (!list.length) return list;
        var widest = Math.max.apply(null, list.map(function (m) { return Math.abs(m.x); }));
        list.forEach(function (m) { m.side = Math.abs(m.x) < widest * 0.35 ? "Centre" : (m.x > 0 ? "Left" : "Right"); });
        return list;
    }

    // ---- real mirrors: the glass shows what is behind it, as a second picture of the scene from where the mirror image of the eye is (the idea of the Reflector of three.js, made
    // for a glass of any shape). The picture is made through the glass only: the frustum of the second camera is the glass seen from the mirror image of the eye, so a small
    // picture (512 pixels wide) is enough. It costs a render of the scene for every real mirror: it is an option for each mirror (mirrorLeftReal, mirrorRightReal,
    // mirrorCentreReal), and a mirror is made every second picture. The glass is left out of the picture of the other mirrors and of the surfaces for the screen space effects.
    var rendering = false;
    var VERTEX = "uniform mat4 textureMatrix; varying vec4 vUvR; void main() { vUvR = textureMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }";
    var FRAGMENT = "uniform sampler2D tDiffuse; uniform vec3 tint; varying vec4 vUvR; void main() { vec4 c = texture2DProj(tDiffuse, vUvR); gl_FragColor = vec4(c.rgb * tint, 1.0);" +
        " #include <tonemapping_fragment>\n #include <colorspace_fragment>\n }";
    function normalOf(geometry) {
        var pos = geometry.attributes.position, index = geometry.index, n = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
        var count = index ? index.count : pos.count;
        for (var t = 0; t + 2 < count; t += 3) {
            a.fromBufferAttribute(pos, index ? index.getX(t) : t); b.fromBufferAttribute(pos, index ? index.getX(t + 1) : t + 1); c.fromBufferAttribute(pos, index ? index.getX(t + 2) : t + 2);
            n.add(e1.subVectors(b, a).cross(e2.subVectors(c, a)));            // (the length of the cross product is the area: bigger faces count more)
        }
        return n.lengthSq() > 1e-12 ? n.normalize() : new THREE.Vector3(0, 0, 1);
    }
    var tmp = { normal: new THREE.Vector3(), centre: new THREE.Vector3(), eye: new THREE.Vector3(), virt: new THREE.Vector3(), up: new THREE.Vector3(), nm: new THREE.Matrix3(), plane: new THREE.Plane(), clip: new THREE.Vector4(), q: new THREE.Vector4(), corner: new THREE.Vector3(), rot: new THREE.Matrix4() };
    function makeReal(m) {
        if (m.real || typeof THREE === "undefined" || !THREE.WebGLRenderTarget) return;
        var mesh = m.mesh, geo = mesh.geometry;
        if (!geo.boundingBox) geo.computeBoundingBox();
        var target = new THREE.WebGLRenderTarget(512, 384, { type: THREE.HalfFloatType });
        var material = new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: target.texture }, textureMatrix: { value: new THREE.Matrix4() }, tint: { value: new THREE.Color(0.9, 0.93, 0.96) } }, vertexShader: VERTEX, fragmentShader: FRAGMENT });
        m.real = { original: mesh.material, material: material, target: target, normal: normalOf(geo), camera: new THREE.PerspectiveCamera(), skip: 0, noGBuffer: mesh.userData.noGBuffer };
        mesh.material = material;
        mesh.userData.noGBuffer = true;
        mesh.onBeforeRender = function (renderer, scene, camera) { reflect(m, renderer, scene, camera); };
    }
    function removeReal(m) {
        if (!m.real) return;
        m.mesh.material = m.real.original;
        m.mesh.userData.noGBuffer = m.real.noGBuffer;
        m.mesh.onBeforeRender = THREE.Object3D.prototype.onBeforeRender;
        m.real.target.dispose(); m.real.material.dispose();
        m.real = null;
    }
    var all = [];                                                    // the mirrors that have been made real (to leave out of each other's picture)
    function reflect(m, renderer, scene, camera) {
        var r = m.real;
        if (!r || rendering || camera === r.camera || camera.isCubeCamera) return;
        if (r.skip-- > 0) return;                                   // (every second picture)
        r.skip = 1;
        var mesh = m.mesh, geo = mesh.geometry, T = tmp;
        mesh.updateWorldMatrix(true, false);
        T.centre.copy(geo.boundingBox.getCenter(T.corner)).applyMatrix4(mesh.matrixWorld);
        T.normal.copy(r.normal).applyMatrix3(T.nm.getNormalMatrix(mesh.matrixWorld)).normalize();
        T.eye.setFromMatrixPosition(camera.matrixWorld);
        T.virt.subVectors(T.centre, T.eye);
        if (T.virt.dot(T.normal) > 0) T.normal.negate();             // (the normal is on the side of the eye)
        // the mirror image of the eye, and a camera there that looks at the middle of the glass
        T.virt.subVectors(T.eye, T.centre); var dist = T.virt.dot(T.normal);
        if (dist < 0.02) return;                                      // (the eye is behind the glass)
        T.virt.copy(T.eye).addScaledVector(T.normal, -2 * dist);
        var cam = r.camera;
        cam.position.copy(T.virt);
        T.rot.extractRotation(camera.matrixWorld);
        T.up.set(0, 1, 0).applyMatrix4(T.rot).reflect(T.normal);
        cam.up.copy(T.up);
        cam.lookAt(T.centre);
        cam.updateMatrixWorld();
        // the frustum is the glass, seen from there: the corners of its box, on the near plane (the distance to the glass)
        var near = Math.max(0.05, dist * 0.98), far = camera.far || 1000, bb = geo.boundingBox, l = 1e9, rr = -1e9, b = 1e9, t = -1e9;
        for (var i = 0; i < 8; i++) {
            T.corner.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z).applyMatrix4(mesh.matrixWorld).applyMatrix4(cam.matrixWorldInverse);
            if (T.corner.z > -near * 0.2) return;                    // (a corner level with or behind the camera: the glass is seen edge on)
            var x = T.corner.x / -T.corner.z * near, y = T.corner.y / -T.corner.z * near;
            l = Math.min(l, x); rr = Math.max(rr, x); b = Math.min(b, y); t = Math.max(t, y);
        }
        if (!(rr - l > 1e-4) || !(t - b > 1e-4)) return;
        cam.projectionMatrix.makePerspective(l, rr, t, b, near, far);
        cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
        // what is between the camera and the glass is not drawn: the near plane is the plane of the glass (as the Reflector does it)
        T.plane.setFromNormalAndCoplanarPoint(T.normal, T.centre).applyMatrix4(cam.matrixWorldInverse);
        T.clip.set(T.plane.normal.x, T.plane.normal.y, T.plane.normal.z, T.plane.constant);
        var pm = cam.projectionMatrix.elements;
        T.q.x = (Math.sign(T.clip.x) + pm[8]) / pm[0]; T.q.y = (Math.sign(T.clip.y) + pm[9]) / pm[5]; T.q.z = -1; T.q.w = (1 + pm[10]) / pm[14];
        T.clip.multiplyScalar(2 / T.clip.dot(T.q));
        pm[2] = T.clip.x; pm[6] = T.clip.y; pm[10] = T.clip.z + 1 - 0.003; pm[14] = T.clip.w;
        var tm = r.material.uniforms.textureMatrix.value;
        tm.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
        tm.multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse).multiply(mesh.matrixWorld);
        var h = Math.max(64, Math.min(1024, Math.round(512 * (t - b) / (rr - l))));
        if (r.target.height !== h) r.target.setSize(512, h);
        // the picture: without this glass and the other real glass
        var hidden = [];
        all.forEach(function (o) { if (o.mesh.visible) { o.mesh.visible = false; hidden.push(o.mesh); } });
        var oldTarget = renderer.getRenderTarget(), oldXr = renderer.xr.enabled, oldShadow = renderer.shadowMap.autoUpdate;
        renderer.xr.enabled = false; renderer.shadowMap.autoUpdate = false;
        rendering = true;
        renderer.setRenderTarget(r.target);
        renderer.clear();
        renderer.render(scene, cam);
        rendering = false;
        renderer.setRenderTarget(oldTarget);
        renderer.xr.enabled = oldXr; renderer.shadowMap.autoUpdate = oldShadow;
        hidden.forEach(function (o) { o.visible = true; });
    }
    function realOf(m) { var v = typeof Settings !== "undefined" ? Settings.option("mirror" + m.side + "Real") : false; return !!v; }

    function aim(mirrors) {
        if (!mirrors || !mirrors.length || typeof Settings === "undefined") return;
        mirrors.forEach(function (m) {
            if (realOf(m)) { makeReal(m); if (all.indexOf(m) < 0) all.push(m); } else { removeReal(m); var at = all.indexOf(m); if (at >= 0) all.splice(at, 1); }
            var yaw = Math.max(-LIMIT, Math.min(LIMIT, Settings.option("mirror" + m.side + "Yaw") || 0)), tilt = Math.max(-LIMIT, Math.min(LIMIT, Settings.option("mirror" + m.side + "Tilt") || 0));
            // the turn is positive towards the outside of the car for the left and the right glass (towards the left of the car for the one inside), the tilt positive up
            var side = m.side === "Right" ? -1 : 1;
            m.pivot.rotation.set(tilt * Math.PI / 180, -yaw * side * Math.PI / 180, 0, "YXZ");
        });
    }

    return { find: find, aim: aim, LIMIT: LIMIT };
})();
