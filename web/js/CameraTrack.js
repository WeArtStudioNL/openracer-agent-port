/*
 * CameraTrack.js
 *
 * Description: A camera track for a replay: a list of keys (made in the video editor, VideoEditor.js, and kept in a replay file as "camera" in its header), and what the camera does
 *              between them. A key is { t, pos: [x, y, z], yaw, pitch, fov, parent, aim, target }:
 *                t        the time in the replay (seconds)
 *                pos      the place of the camera, in the world, or, when it is parented, in the frame of the car (x to the left, y up, z forward)
 *                yaw, pitch   where it looks (radians; in the frame of the car when parented), unless aim is on
 *                fov      the vertical field of view (degrees)
 *                parent   the camera goes with the car (pos and the look are in the frame of the car)
 *                aim      the camera points at the car (a little above its middle) wherever it is
 *                target   the car (0 is the player, 1 and up the opponents)
 *              Between two keys the camera moves smoothly (slow at both ends): the place, the look and the field of view. Before the first and after the last it stays at those.
 *              The same code is used by the editor and by the replay that is opened from a file (Replay.afterFrame).
 */

OpenRacer.CameraTrack = (function () {
    var V = THREE.Vector3, Q = THREE.Quaternion;
    var tmpPos = new V(), tmpQuat = new Q(), tmpPos2 = new V(), tmpQuat2 = new Q(), tmpEuler = new THREE.Euler(0, 0, 0, "YXZ"), tmpMatrix = new THREE.Matrix4(), up = new V(0, 1, 0), tmpAim = new V();
    var MAX_KEYS = 500;

    function finite(x, fallback) { return typeof x === "number" && isFinite(x) ? x : fallback; }

    // a list that came from a file: only keys with numbers in them, in the order of time
    function clean(keys) {
        if (!Array.isArray(keys)) return [];
        var out = [];
        for (var i = 0; i < keys.length && out.length < MAX_KEYS; i++) {
            var k = keys[i];
            if (!k || !Array.isArray(k.pos) || k.pos.length !== 3 || !k.pos.every(function (x) { return typeof x === "number" && isFinite(x) && Math.abs(x) < 1e6; })) continue;
            out.push({
                t: Math.max(0, finite(k.t, 0)), pos: k.pos.slice(), yaw: finite(k.yaw, 0), pitch: Math.max(-1.55, Math.min(1.55, finite(k.pitch, 0))),
                fov: Math.max(8, Math.min(110, finite(k.fov, 60))), parent: !!k.parent, aim: !!k.aim, target: Math.max(0, Math.min(11, Math.floor(finite(k.target, 0))))
            });
        }
        out.sort(function (a, b) { return a.t - b.t; });
        return out;
    }

    // the place and the look of a key in the world, now (the car moves, so a key that goes with it is worked out every time)
    function pose(k, body, outPos, outQuat) {
        outPos.set(k.pos[0], k.pos[1], k.pos[2]);
        if (k.parent && body) outPos.applyQuaternion(body.quaternion).add(body.position);
        if (k.aim && body) {
            tmpAim.copy(body.position).y += 0.7;
            tmpMatrix.lookAt(outPos, tmpAim, up);
            outQuat.setFromRotationMatrix(tmpMatrix);
        } else {
            tmpEuler.set(k.pitch, k.yaw, 0, "YXZ");
            outQuat.setFromEuler(tmpEuler);
            if (k.parent && body) outQuat.premultiply(body.quaternion);
        }
    }

    function smooth(f) { f = Math.max(0, Math.min(1, f)); return f * f * (3 - 2 * f); }

    // puts the camera where the track says at a time; bodyOf(i) is the body of a car; false when there are no keys
    function apply(keys, time, camera, bodyOf) {
        if (!keys || !keys.length) return false;
        var n = keys.length, i = 0;
        while (i < n - 1 && keys[i + 1].t <= time) i++;
        var a = keys[i], b = keys[Math.min(n - 1, i + 1)];
        pose(a, bodyOf(a.target), tmpPos, tmpQuat);
        var fov = a.fov;
        if (b !== a && time > a.t) {
            var f = smooth((time - a.t) / Math.max(1e-6, b.t - a.t));
            pose(b, bodyOf(b.target), tmpPos2, tmpQuat2);
            tmpPos.lerp(tmpPos2, f);
            tmpQuat.slerp(tmpQuat2, f);
            fov = a.fov + (b.fov - a.fov) * f;
        }
        camera.position.copy(tmpPos);
        camera.quaternion.copy(tmpQuat);
        if (Math.abs(camera.fov - fov) > 0.01 || camera.near !== 0.3) { camera.fov = fov; camera.near = 0.3; camera.updateProjectionMatrix(); }
        return true;
    }

    // a key from the free camera of the replay (Replay.free): what it has now
    function fromFree(free, time) {
        return { t: time, pos: [free.pos.x, free.pos.y, free.pos.z], yaw: free.yaw, pitch: free.pitch, fov: free.fov, parent: !!free.parent, aim: !!free.aim, target: free.target || 0 };
    }

    // the free camera of the replay put where a key is (the camera of the editor starts from the track)
    function toFree(free, k, camera) {
        free.pos.set(k.pos[0], k.pos[1], k.pos[2]);
        free.vel.set(0, 0, 0);
        free.yaw = free.yawT = k.yaw; free.pitch = free.pitchT = k.pitch;
        free.fov = free.fovT = k.fov;
        free.parent = !!k.parent; free.aim = !!k.aim; free.target = k.target || 0;
        free.quat.copy(camera.quaternion);
    }

    return { clean: clean, apply: apply, fromFree: fromFree, toFree: toFree };
})();
