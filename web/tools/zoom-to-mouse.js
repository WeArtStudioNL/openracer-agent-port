/*
 * zoom-to-mouse.js
 *
 * Description: Zoom to the mouse position, as Blender does: the wheel zooms towards the point under the mouse (a ray from the mouse to the meshes of the scene;
 *              the floor, or the distance of the orbit centre, when it hits nothing), and the orbit centre of the controls moves towards that point in the same
 *              measure, so that the view turns about what was zoomed in on. Works for a perspective camera and for an orthographic one (camera.zoom), where the
 *              point under the mouse stays under the mouse.
 *              installZoomToMouse({ THREE, camera, controls, renderer, targets, isOrtho, floorY })
 *                targets   () => the objects the ray is cast at (recursively)
 *                isOrtho   () => true while the camera is orthographic (camera.zoom scales the picture)
 *                floorY    () => the height of the floor, for a ray that hits nothing (optional)
 * Author:      Glenn Hofman
 * Date:        2026-10-26
 * License:     MIT
 */

export function installZoomToMouse(api) {
    const { THREE, camera, controls, renderer, targets, isOrtho, floorY } = api;
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), point = new THREE.Vector3(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    controls.enableZoom = false;                      // (the wheel is ours)
    renderer.domElement.addEventListener("wheel", (e) => {
        if (!controls.enabled) return;
        e.preventDefault();
        const rect = renderer.domElement.getBoundingClientRect();
        ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
        ray.setFromCamera(ndc, camera);
        // the point under the mouse: the nearest mesh, else the floor, else the distance of the orbit centre along the ray
        const list = (targets ? targets() : []).filter(Boolean);
        const hits = list.length ? ray.intersectObjects(list, true).filter((h) => h.object.visible && !(h.object.isLine) && !(h.object.isSprite)) : [];
        let found = false;
        // (the point on the ray nearest to the orbit centre: what the view is about when nothing is hit)
        const along = Math.max(0, controls.target.clone().sub(ray.ray.origin).dot(ray.ray.direction));
        const reach = 4 * Math.max(1, camera.position.distanceTo(controls.target));
        if (hits.length) { point.copy(hits[0].point); found = true; }
        else if (floorY) {
            // the floor, unless it lies far beyond the orbit centre (a view from the side sees it almost edge-on: the hit is hundreds of metres away and the view would fly there)
            plane.constant = -floorY();
            found = !!ray.ray.intersectPlane(plane, point) && point.distanceTo(ray.ray.origin) < along + reach;
        }
        if (!found) point.copy(ray.ray.origin).addScaledVector(ray.ray.direction, along);
        // a notch of the wheel is about 10 %; a trackpad gives many small steps
        const f = Math.min(2, Math.max(0.5, Math.exp(Math.max(-120, Math.min(120, e.deltaY)) * 0.0012)));
        if (isOrtho && isOrtho()) {
            // the picture scales about the point under the mouse: the orbit centre moves so that the point keeps its place on the screen, the camera goes with it
            const shift = controls.target.clone().sub(point).multiplyScalar(f).add(point).sub(controls.target);
            controls.target.add(shift); camera.position.add(shift);
            camera.zoom = Math.max(0.05, Math.min(200, camera.zoom / f));
            camera.updateProjectionMatrix();
        } else {
            const d = camera.position.distanceTo(point);
            if (f < 1 && d < 0.08) return;                                     // (as close as it goes)
            camera.position.sub(point).multiplyScalar(f).add(point);
            controls.target.sub(point).multiplyScalar(f).add(point);
        }
        controls.update();
    }, { passive: false });
}
