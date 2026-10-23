/*
 * FreeCam.js
 *
 * Description: The fourth camera of the game (the camera switcher: follow, cockpit, free). The camera is not tied to the car: it is moved
 *              with the buttons of a panel at the top right of the HUD (the keys are the ones that drive the car): forward, back, left and right
 *              (level, the way the camera looks), up and down, turn up, down, left and right, and a wider or a narrower field of view. Two toggles, on the
 *              panel and on keys (actions of the settings menu): P, "freeCamAim", the camera looks at the car (it keeps its place and turns to the
 *              car; the turn buttons wait while it does), and O, "freeCamFollow", the camera goes with the car (it keeps its place against the
 *              car, and its own direction).
 *              The replay has its own free camera (Replay.js); this one is for the game.
 */

OpenRacer.FreeCam = (function () {
    var BASE_SPEED = 12, VERTICAL_SPEED = 8, TURN_RATE = 1.2, FOV_RATE = 40;       // m/s, m/s, rad/s, degrees/s
    var active = false;
    var follow = false;                                  // O: the place goes with the car
    var aim = true;                                      // P: it looks at the car
    var pos = new THREE.Vector3(), lastCar = new THREE.Vector3(), vel = new THREE.Vector3(), want = new THREE.Vector3();
    var yaw = 0, pitch = 0, fov = 60;
    var euler = new THREE.Euler(0, 0, 0, "YXZ");
    var held = {};
    var placeBehind = false;
    var panel = null, followButton = null, aimButton = null;

    function buildPanel() {
        var style = document.createElement("style");
        style.textContent =
            "#freeCam { position: fixed; right: 16px; top: 14px; z-index: 900; display: none; font-family: Arial, sans-serif; color: #fff; user-select: none; -webkit-user-select: none;" +
            " background: rgba(14, 18, 24, 0.72); border-radius: 10px; padding: 8px 10px 10px; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8); touch-action: none; }" +
            "#freeCam .title { font-size: 12px; letter-spacing: 1px; text-transform: uppercase; color: #9fb0c4; margin-bottom: 6px; display: flex; justify-content: space-between; gap: 12px; }" +
            "#freeCam .row { display: flex; align-items: center; gap: 5px; margin-top: 5px; }" +
            "#freeCam .label { width: 50px; font-size: 12px; color: #9fb0c4; }" +
            "#freeCam button { min-width: 34px; height: 30px; padding: 0 8px; border-radius: 6px; border: 1px solid #3a4655; background: #232b36; color: #fff; font-size: 15px; cursor: pointer; touch-action: none; }" +
            "#freeCam button:active, #freeCam button.down { background: #3d6fb5; border-color: #6aa0e8; }" +
            "#freeCam button.follow { width: 100%; font-size: 13px; }" +
            "#freeCam.aiming button[data-look] { opacity: 0.35; }" +
            "#freeCam button.follow.on { background: #2a7a46; border-color: #4fc07a; }";
        document.head.appendChild(style);
        panel = document.createElement("div");
        panel.id = "freeCam";
        var title = document.createElement("div");
        title.className = "title";
        title.innerHTML = "<span>Free camera</span><span>P look · O move</span>";
        panel.appendChild(title);
        // a row of buttons that act while they are held: [label, [[name, text, title], ...]]
        [
            ["Move", [["forward", "↑", "Forward"], ["left", "←", "Left"], ["back", "↓", "Back"], ["right", "→", "Right"]]],
            ["Turn", [["lookUp", "⤒", "Look up"], ["lookDown", "⤓", "Look down"], ["lookLeft", "↶", "Turn left"], ["lookRight", "↷", "Turn right"]]],
            ["Height", [["up", "⇧", "Up"], ["down", "⇩", "Down"]]],
            ["FOV", [["fovWide", "＋", "Wider field of view"], ["fovNarrow", "－", "Narrower field of view"]]]
        ].forEach(function (group) {
            var row = document.createElement("div");
            row.className = "row";
            var label = document.createElement("span");
            label.className = "label";
            label.textContent = group[0];
            row.appendChild(label);
            group[1].forEach(function (b) {
                var button = document.createElement("button");
                button.textContent = b[1];
                button.title = b[2];
                button.setAttribute("aria-label", b[2]);
                if (/^look/.test(b[0])) button.setAttribute("data-look", "1");
                var press = function (e) { held[b[0]] = true; button.classList.add("down"); try { button.setPointerCapture(e.pointerId); } catch (x) { /* no capture */ } e.preventDefault(); };
                var release = function () { held[b[0]] = false; button.classList.remove("down"); };
                button.addEventListener("pointerdown", press);
                button.addEventListener("pointerup", release);
                button.addEventListener("pointercancel", release);
                button.addEventListener("lostpointercapture", release);
                row.appendChild(button);
            });
            panel.appendChild(row);
        });
        var rowF = document.createElement("div");
        rowF.className = "row";
        aimButton = document.createElement("button");
        aimButton.className = "follow";
        aimButton.addEventListener("click", function () { toggleAim(); });
        followButton = document.createElement("button");
        followButton.className = "follow";
        followButton.addEventListener("click", function () { toggleFollow(); });
        rowF.appendChild(aimButton);
        var rowG = document.createElement("div");
        rowG.className = "row";
        rowG.appendChild(followButton);
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
        panel.classList.toggle("aiming", aim);
    }

    function toggleFollow() { follow = !follow; refreshUi(); }
    function toggleAim() { aim = !aim; refreshUi(); }

    // the camera goes free from where it is now (no jump)
    function enter(camera, carPosition) {
        if (!panel) buildPanel();
        active = true;
        pos.copy(camera.position);
        pos.y += 10;                                     // it starts 10 m higher than the camera that it came from
        euler.setFromQuaternion(camera.quaternion, "YXZ");
        yaw = euler.y; pitch = euler.x;
        fov = camera.fov;
        // the game starts with this camera (the choice is kept): the camera has not been put near the car yet, so it starts behind it, at the
        // first frame (the car has its direction by then)
        placeBehind = camera.position.distanceTo(carPosition) > 60;
        vel.set(0, 0, 0);
        lastCar.copy(carPosition);
        held = {};
        panel.style.display = Settings.option("hud") ? "block" : "none";
        refreshUi();
    }

    function leave() {
        active = false;
        held = {};
        if (panel) panel.style.display = "none";
    }

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
        panel.style.display = Settings.option("hud") ? "block" : "none";      // the controls go with the HUD
        var mx = (held.right ? 1 : 0) - (held.left ? 1 : 0), mz = (held.forward ? 1 : 0) - (held.back ? 1 : 0), my = (held.up ? 1 : 0) - (held.down ? 1 : 0);
        if (!aim) {
            yaw += ((held.lookLeft ? 1 : 0) - (held.lookRight ? 1 : 0)) * TURN_RATE * delta;
            pitch = Math.max(-1.5, Math.min(1.5, pitch + ((held.lookUp ? 1 : 0) - (held.lookDown ? 1 : 0)) * TURN_RATE * delta));
        }
        fov = Math.max(8, Math.min(110, fov + ((held.fovWide ? 1 : 0) - (held.fovNarrow ? 1 : 0)) * FOV_RATE * delta));
        // forward is level, the way the camera looks; the speed follows what is asked for, it does not jump to it
        var fx = -Math.sin(yaw), fz = -Math.cos(yaw);
        want.set(fx * mz + -fz * mx, my * VERTICAL_SPEED / BASE_SPEED, fz * mz + fx * mx).multiplyScalar(BASE_SPEED);
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
    }

    return { enter: enter, leave: leave, update: update, toggleFollow: toggleFollow, toggleAim: toggleAim, get active() { return active; }, get follows() { return follow; }, get aims() { return aim; } };
})();
