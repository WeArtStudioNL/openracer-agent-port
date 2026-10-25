/*
 * FreeCam.js
 *
 * Description: The fourth camera of the game (the camera switcher: follow, cockpit, free). The camera is not tied to the car: it is moved with the
 *              keys, which do not drive the car while this camera is on: W A S D move it (level, the way it looks), 1 and 2 take it down and up, Q and E
 *              tilt it, the left and right arrows turn it, 3 and 4 make it slower and faster (a tenth to three times), [ and ] narrow and widen the field
 *              of view. Two toggles, on the panel at the top right and on keys (actions of the settings menu): P, "freeCamAim", the camera looks at the
 *              car (it keeps its place and turns to the car; the tilt and the turn wait while it does), and O, "freeCamFollow", the camera goes with the
 *              car (it keeps its place against the car, and its own direction).
 *              The camera is remembered per car (localStorage, openracer.freecam.<car>): its place, where it looks, the field of view, the speed and the two
 *              toggles; the next time the free camera is chosen for that car, also after a restart, it is back where it was.
 *              The replay has its own free camera (Replay.js); this one is for the game.
 */

OpenRacer.FreeCam = (function () {
    var BASE_SPEED = 12, VERTICAL_SPEED = 8, TURN_RATE = 1.2, FOV_RATE = 40, SPEED_RATE = 1.2;       // m/s, m/s, rad/s, degrees/s, factor per second (3 and 4)
    var active = false;
    var follow = false;                                  // O: the place goes with the car
    var aim = true;                                      // P: it looks at the car
    var speed = 1;                                       // 3 and 4: a factor on the speed, 0.1 to 3
    var pos = new THREE.Vector3(), lastCar = new THREE.Vector3(), vel = new THREE.Vector3(), want = new THREE.Vector3();
    var yaw = 0, pitch = 0, fov = 60;
    var euler = new THREE.Euler(0, 0, 0, "YXZ");
    var placeBehind = false;
    var panel = null, followButton = null, aimButton = null, speedLabel = null;
    var carId = null, saveAt = 0;
    var KEYS = { forward: "KeyW", back: "KeyS", left: "KeyA", right: "KeyD", down: "Digit1", up: "Digit2", slower: "Digit3", faster: "Digit4",
        tiltUp: "KeyQ", tiltDown: "KeyE", turnLeft: "ArrowLeft", turnRight: "ArrowRight", fovNarrow: "BracketLeft", fovWide: "BracketRight" };
    // the keys this camera takes (Settings.js leaves them to it while it is on: they do not drive the car, mute the sound or save the reset place)
    var TAKEN = {};
    Object.keys(KEYS).forEach(function (k) { TAKEN[KEYS[k]] = true; });
    TAKEN.ArrowUp = TAKEN.ArrowDown = true;

    function key(name) { return Settings.keyDown(KEYS[name]) ? 1 : 0; }

    function buildPanel() {
        var style = document.createElement("style");
        style.textContent =
            "#freeCam { position: fixed; right: 16px; top: 14px; z-index: 900; display: none; font-family: Arial, sans-serif; color: #fff; user-select: none; -webkit-user-select: none;" +
            " background: rgba(14, 18, 24, 0.72); border-radius: 10px; padding: 8px 10px 10px; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8); touch-action: none; width: 230px; }" +
            "#freeCam .title { font-size: 12px; letter-spacing: 1px; text-transform: uppercase; color: #9fb0c4; margin-bottom: 6px; display: flex; justify-content: space-between; gap: 12px; }" +
            "#freeCam .keys { font-size: 11px; color: #9fb0c4; line-height: 1.5; margin-bottom: 6px; }" +
            "#freeCam .keys b { color: #e6edf5; font-weight: 600; }" +
            "#freeCam .row { display: flex; align-items: center; gap: 5px; margin-top: 5px; }" +
            "#freeCam button { height: 30px; padding: 0 8px; border-radius: 6px; border: 1px solid #3a4655; background: #232b36; color: #fff; font-size: 13px; cursor: pointer; touch-action: none; width: 100%; }" +
            "#freeCam button:active { background: #3d6fb5; border-color: #6aa0e8; }" +
            "#freeCam button.on { background: #2a7a46; border-color: #4fc07a; }";
        document.head.appendChild(style);
        panel = document.createElement("div");
        panel.id = "freeCam";
        var title = document.createElement("div");
        title.className = "title";
        title.innerHTML = "<span>Free camera</span><span id=\"freeCamSpeed\"></span>";
        panel.appendChild(title);
        var keys = document.createElement("div");
        keys.className = "keys";
        keys.innerHTML = "<b>W A S D</b> move · <b>1 2</b> down, up<br><b>Q E</b> tilt · <b>← →</b> turn · <b>[ ]</b> field of view<br><b>3 4</b> slower, faster";
        panel.appendChild(keys);
        speedLabel = title.querySelector("#freeCamSpeed");
        // the two toggles: on pointerup (the panel is dragged by its pointerdown, Movable.js, which took the click away from the buttons)
        function toggleButton(onToggle) {
            var button = document.createElement("button");
            var downAt = null;
            button.addEventListener("pointerdown", function (e) { downAt = { x: e.clientX, y: e.clientY }; e.stopPropagation(); e.preventDefault(); });
            button.addEventListener("pointerup", function (e) { if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 8) onToggle(); downAt = null; e.stopPropagation(); e.preventDefault(); });
            button.addEventListener("click", function (e) { e.preventDefault(); });
            return button;
        }
        aimButton = toggleButton(toggleAim);
        followButton = toggleButton(toggleFollow);
        var rowF = document.createElement("div"); rowF.className = "row"; rowF.appendChild(aimButton);
        var rowG = document.createElement("div"); rowG.className = "row"; rowG.appendChild(followButton);
        panel.appendChild(rowF);
        panel.appendChild(rowG);
        document.body.appendChild(panel);
        OpenRacer.Movable.make(panel, { key: "freecam" });
        refreshUi();
    }

    function refreshUi() {
        if (!panel) return;
        aimButton.textContent = aim ? "Looking at the car (P)" : "Look at the car (P)";
        aimButton.classList.toggle("on", aim);
        followButton.textContent = follow ? "Moving with the car (O)" : "Move with the car (O)";
        followButton.classList.toggle("on", follow);
        speedLabel.textContent = "speed " + speed.toFixed(1) + "×";
    }

    function toggleFollow() { follow = !follow; refreshUi(); save(); }
    function toggleAim() { aim = !aim; refreshUi(); save(); }

    // ---- remembered per car
    function storageKey() { return "openracer.freecam." + (carId || "car"); }
    function save() {
        if (!carId) return;
        try { window.localStorage.setItem(storageKey(), JSON.stringify({ x: pos.x, y: pos.y, z: pos.z, yaw: yaw, pitch: pitch, fov: fov, speed: speed, follow: follow, aim: aim,
            carX: lastCar.x, carY: lastCar.y, carZ: lastCar.z })); } catch (e) { /* no storage */ }
    }
    function restore(carPosition) {
        try {
            var s = JSON.parse(window.localStorage.getItem(storageKey()));
            if (!s || !isFinite(s.x) || !isFinite(s.y) || !isFinite(s.z)) return false;
            pos.set(s.x, s.y, s.z);
            // a camera that went with the car keeps its place against the car: it comes back there, wherever the car is now
            if (s.follow && isFinite(s.carX)) pos.add(carPosition).sub(new THREE.Vector3(s.carX, s.carY, s.carZ));
            yaw = isFinite(s.yaw) ? s.yaw : 0; pitch = isFinite(s.pitch) ? s.pitch : 0; fov = isFinite(s.fov) ? s.fov : 60;
            speed = isFinite(s.speed) ? Math.max(0.1, Math.min(3, s.speed)) : 1;
            follow = !!s.follow; aim = s.aim !== false;
            return true;
        } catch (e) { return false; }
    }

    // the camera goes free: where it was the last time for this car, or from where the camera is now (no jump)
    function enter(camera, carPosition, id) {
        if (!panel) buildPanel();
        active = true;
        carId = id || null;
        vel.set(0, 0, 0);
        lastCar.copy(carPosition);
        placeBehind = false;
        if (!restore(carPosition)) {
            pos.copy(camera.position);
            pos.y += 10;                                 // it starts 10 m higher than the camera that it came from
            euler.setFromQuaternion(camera.quaternion, "YXZ");
            yaw = euler.y; pitch = euler.x;
            fov = camera.fov;
            // the game starts with this camera (the choice is kept): the camera has not been put near the car yet, so it starts behind it, at the
            // first frame (the car has its direction by then)
            placeBehind = camera.position.distanceTo(carPosition) > 60;
        }
        panel.style.display = Settings.option("hud") ? "block" : "none";
        refreshUi();
        saveAt = 0;
    }

    function leave() {
        if (active) save();
        active = false;
        if (panel) panel.style.display = "none";
    }
    window.addEventListener("beforeunload", function () { if (active) save(); });

    // once per frame while the camera is the free one
    function update(delta, carPosition, camera, carYaw) {
        delta = Math.min(delta, 0.1);
        if (placeBehind) {
            placeBehind = false;
            var ahead = new THREE.Vector3(Math.sin(carYaw), 0, Math.cos(carYaw));
            pos.copy(carPosition).addScaledVector(ahead, -8); pos.y += 10;
            yaw = carYaw + Math.PI; pitch = -0.15; fov = 50;
            lastCar.copy(carPosition);
        }
        panel.style.display = Settings.option("hud") ? "block" : "none";      // the panel goes with the HUD
        var mx = key("right") - key("left"), mz = key("forward") - key("back"), my = key("up") - key("down");
        var ds = key("faster") - key("slower");
        if (ds) { speed = Math.max(0.1, Math.min(3, speed * Math.exp(ds * SPEED_RATE * delta))); refreshUi(); }
        if (!aim) {
            yaw += (key("turnLeft") - key("turnRight")) * TURN_RATE * delta;
            pitch = Math.max(-1.5, Math.min(1.5, pitch + (key("tiltUp") - key("tiltDown")) * TURN_RATE * delta));
        }
        fov = Math.max(8, Math.min(110, fov + (key("fovWide") - key("fovNarrow")) * FOV_RATE * delta));
        // forward is level, the way the camera looks; the speed follows what is asked for, it does not jump to it
        var fx = -Math.sin(yaw), fz = -Math.cos(yaw);
        want.set(fx * mz + -fz * mx, my * VERTICAL_SPEED / BASE_SPEED, fz * mz + fx * mx).multiplyScalar(BASE_SPEED * speed);
        vel.lerp(want, 1 - Math.exp(-6 * delta));
        pos.addScaledVector(vel, delta);
        if (follow) pos.add(carPosition).sub(lastCar);
        lastCar.copy(carPosition);
        if (aim) {
            // it turns to the car (a little above its middle) smoothly; the angles go on from where it looks when the look is let go
            var dx = carPosition.x - pos.x, dy = carPosition.y + 0.7 - pos.y, dz = carPosition.z - pos.z;
            var wantYaw = Math.atan2(-dx, -dz), wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
            var k = 1 - Math.exp(-10 * delta);
            var turn = wantYaw - yaw;
            while (turn > Math.PI) turn -= 2 * Math.PI;
            while (turn < -Math.PI) turn += 2 * Math.PI;
            yaw += turn * k;
            pitch += (wantPitch - pitch) * k;
        }
        camera.position.copy(pos);
        euler.set(pitch, yaw, 0, "YXZ");
        camera.quaternion.setFromEuler(euler);
        if (Math.abs(camera.fov - fov) > 0.01 || camera.near !== 0.3) {
            camera.fov = fov;
            camera.near = 0.3;
            camera.updateProjectionMatrix();
        }
        // remembered now and then (and when the camera is left)
        saveAt += delta;
        if (saveAt > 2) { saveAt = 0; save(); }
    }

    return { enter: enter, leave: leave, update: update, toggleFollow: toggleFollow, toggleAim: toggleAim, takes: TAKEN,
        get active() { return active; }, get follows() { return follow; }, get aims() { return aim; } };
})();
