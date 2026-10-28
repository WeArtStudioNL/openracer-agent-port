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

    function aim(mirrors) {
        if (!mirrors || !mirrors.length || typeof Settings === "undefined") return;
        mirrors.forEach(function (m) {
            var yaw = Math.max(-LIMIT, Math.min(LIMIT, Settings.option("mirror" + m.side + "Yaw") || 0)), tilt = Math.max(-LIMIT, Math.min(LIMIT, Settings.option("mirror" + m.side + "Tilt") || 0));
            // the turn is positive towards the outside of the car for the left and the right glass (towards the left of the car for the one inside), the tilt positive up
            var side = m.side === "Right" ? -1 : 1;
            m.pivot.rotation.set(tilt * Math.PI / 180, -yaw * side * Math.PI / 180, 0, "YXZ");
        });
    }

    return { find: find, aim: aim, LIMIT: LIMIT };
})();
