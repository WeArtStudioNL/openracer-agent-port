/*
 * zoom-to-mouse.js
 *
 * Description: Zoom to the mouse position, as Blender does: the wheel zooms towards the point under the mouse (a ray from the mouse to the meshes of the scene;
 *              the floor, or the distance of the orbit centre, when it hits nothing), and the orbit centre of the controls moves towards that point in the same
 *              measure, so that the view turns about what was zoomed in on. Works for a perspective camera and for an orthographic one (camera.zoom), where the
 *              point under the mouse stays under the mouse.
 *              With orbitAtPoint (the track editor) the point that was zoomed in on is at once the point that the view turns about, wherever it is
 *              on the screen and without the view jumping to it: the left button turns the camera about that point itself (the orbit controls only
 *              turn about the middle of the screen), and the orbit centre of the controls is kept on the middle of the view at the depth of that point.
 *              installZoomToMouse({ THREE, camera, controls, renderer, targets, isOrtho, floorY, orbitAtPoint })
 *                targets      () => the objects the ray is cast at (recursively)
 *                isOrtho      () => true while the camera is orthographic (camera.zoom scales the picture)
 *                floorY       () => the height of the floor, for a ray that hits nothing (optional)
 *                orbitAtPoint true: turn about the point that was zoomed in on (optional)
 *                canTurn      (event) => false when this pointer may not turn the view: a finger while a tool is in use (optional)
 *              Two fingers (touch) zoom by pinching, towards the middle between them; the controls move the view when the two fingers move together.
 * Author:      Glenn Hofman
 * Date:        2026-10-26
 * License:     MIT
 */

export function installZoomToMouse(api) {
    const { THREE, camera, controls, renderer, targets, isOrtho, floorY, orbitAtPoint, canTurn } = api;
    const touches = new Map();                        // (the fingers that are down: x, y; with two of them the view is pinched, not turned)
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), point = new THREE.Vector3(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    controls.enableZoom = false;                      // (the wheel is ours)
    // ---- turning about the point that was zoomed in on (orbitAtPoint)
    const pivot = new THREE.Vector3(), lastTarget = new THREE.Vector3(), forward = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
    let hasPivot = false;
    // the orbit centre of the controls: on the middle of the view, as deep as the point (the controls look at it: the view does not move)
    function keepTarget() {
        camera.getWorldDirection(forward);
        const depth = Math.max(0.1, pivot.clone().sub(camera.position).dot(forward));
        controls.target.copy(camera.position).addScaledVector(forward, depth);
        lastTarget.copy(controls.target);
    }
    let pinch = null;
    if (orbitAtPoint) {
        controls.enableRotate = false;                // (the left button is ours)
        let down = null, turning = false;
        const qYaw = new THREE.Quaternion(), qPitch = new THREE.Quaternion(), right = new THREE.Vector3(), after = new THREE.Vector3();
        renderer.domElement.addEventListener("pointerdown", (e) => {
            if (e.pointerType === "touch") { touches.set(e.pointerId, { x: e.clientX, y: e.clientY }); pinch = null; }
            if (touches.size > 1) { down = null; turning = false; return; }          // (a second finger: the view is pinched, and the turning stops)
            if (e.button === 0 && (!canTurn || canTurn(e))) { down = { x: e.clientX, y: e.clientY }; turning = false; }
        });
        renderer.domElement.addEventListener("pointermove", (e) => {
            if (touches.has(e.pointerId)) touches.get(e.pointerId).x = e.clientX, touches.get(e.pointerId).y = e.clientY;
            if (touches.size > 1) { down = null; pinchMove(); return; }
            if (!down || !(e.buttons & 1)) { down = null; return; }
            // (a press that the editor took for itself, a gizmo or a node, has switched the controls off)
            if (!controls.enabled) return;
            if (!turning) {
                if (Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) < 4) return;
                turning = true;
                // the orbit centre was moved by something else (panning, From above, a framed track): the view turns about it
                if (!hasPivot || controls.target.distanceTo(lastTarget) > 1e-6) { pivot.copy(controls.target); hasPivot = true; }
            }
            const h = renderer.domElement.clientHeight || 1;
            const yaw = -2 * Math.PI * (e.clientX - down.x) / h, pitch = -2 * Math.PI * (e.clientY - down.y) / h;
            down = { x: e.clientX, y: e.clientY };
            qYaw.setFromAxisAngle(UP, yaw);
            right.set(1, 0, 0).applyQuaternion(camera.quaternion);
            qPitch.setFromAxisAngle(right, pitch);
            camera.getWorldDirection(forward);
            after.copy(forward).applyQuaternion(qPitch);
            if (Math.abs(after.y) > 0.995 && Math.abs(after.y) > Math.abs(forward.y)) qPitch.identity();          // (not over the top: the view would turn upside down; from straight above it can still tilt back)
            const q = qYaw.multiply(qPitch);
            camera.position.sub(pivot).applyQuaternion(q).add(pivot);
            camera.quaternion.premultiply(q);
            keepTarget();
            controls.update();
        });
        const lift = (e) => { touches.delete(e.pointerId); pinch = null; down = null; turning = false; };
        window.addEventListener("pointerup", lift);
        window.addEventListener("pointercancel", lift);
    }
    // zoom by the factor f (below 1: nearer) towards the point of the view at (clientX, clientY)
    function zoomAt(clientX, clientY, f) {
        const rect = renderer.domElement.getBoundingClientRect();
        ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
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
            if (orbitAtPoint) { pivot.copy(point); hasPivot = true; keepTarget(); }
            else controls.target.sub(point).multiplyScalar(f).add(point);
        }
        controls.update();
    }
    // two fingers: the distance between them zooms towards the middle between them (the controls pan the view when the middle moves)
    function pinchMove() {
        if (!controls.enabled) return;
        const [a, b] = [...touches.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (pinch && dist > 8) zoomAt(mx, my, Math.min(2, Math.max(0.5, pinch.dist / dist)));
        pinch = { dist };
    }
    renderer.domElement.addEventListener("wheel", (e) => {
        if (!controls.enabled) return;
        e.preventDefault();
        // a notch of the wheel is about 10 %; a trackpad gives many small steps
        zoomAt(e.clientX, e.clientY, Math.min(2, Math.max(0.5, Math.exp(Math.max(-120, Math.min(120, e.deltaY)) * 0.0012))));
    }, { passive: false });
}
