/*
 * FreeCam.js
 *
 * Description: The fourth camera of the game (the camera switcher: follow, cockpit, free). The camera is not tied to the car: it is moved with the
 *              keys and the mouse, as the free camera of the replay: W A S D move it (W goes the way it looks, also up and down with the look), Space and Z take it up, Alt and X down, the
 *              mouse looks around (click the scene: the pointer is locked, Escape lets it go), Q and E roll the picture, 3 and 4 make it slower and faster
 *              (a hundredth to three times), [ and ] narrow and widen the field of view. These keys do not drive the car while this camera is on; the arrows
 *              still do (Space takes the camera up, so it is not the handbrake while this camera is on). Two toggles, on the panel at the top right and on keys (actions of the settings menu): P, "freeCamAim", the camera looks at the
 *              car (it keeps its place and turns to the car; the tilt and the turn wait while it does), and O, "freeCamFollow", the camera goes with the
 *              car (it keeps its place against the car, and its own direction), and I, "freeCamFixed", the camera is fixed to the car as a part of it (its
 *              place and its turn go with the car; the keys then move it in the frame of the car). Fixed to the car or moving with it, the camera does not
 *              go through a wall: as the chase camera, rays from the car to it bring it in front of what is in the way.
 *              The camera is remembered per car (localStorage, openracer.freecam.<car>): its place, where it looks, the field of view, the speed and the two
 *              toggles; the next time the free camera is chosen for that car, also after a restart, it is back where it was.
 *              The panel (its title moves it) has buttons for the toggles and a slider for every setting: the speed, the smoothing of the movement, of the mouse look and of the tilt,
 *              the field of view, the tilt and the speed of the tilt, and a record button (Take.js). They are remembered with the camera.
 *              The replay has its own free camera (Replay.js); this one is for the game.
 */

OpenRacer.FreeCam = (function () {
    var BASE_SPEED = 12, VERTICAL_SPEED = 8, TURN_RATE = 1.2, FOV_RATE = 40, SPEED_RATE = 1.2;       // m/s, m/s, rad/s, degrees/s, factor per second (3 and 4)
    var active = false;
    var follow = false;                                  // O: the place goes with the car
    var aim = true;                                      // P: it looks at the car
    var fixed = false;                                   // I: fixed to the car: pos, yaw, pitch and roll are in the frame of the car
    var speed = 1;                                       // 3 and 4: a factor on the speed, 0.01 to 3
    var carRef = null;
    var tmpW = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion(), tmpE = new THREE.Euler(0, 0, 0, "YXZ"), tmpM = new THREE.Matrix4();
    var pos = new THREE.Vector3(), lastCar = new THREE.Vector3(), vel = new THREE.Vector3(), want = new THREE.Vector3();
    var yaw = 0, pitch = 0, roll = 0, rollT = 0, fov = 60;
    var pointerLocked = false, mouseHint = null;
    var LOOK_SENSITIVITY = 0.0022;
    // the easing of the camera, all settable on the panel: how fast the movement follows the keys (per second; MOVE_MAX is direct), how fast the tilt turns (rad/s) and how fast the picture follows it
    var MOVE_MIN = 0.5, MOVE_MAX = 30, ROLL_MIN = 0.1, ROLL_MAX = 3, TILT_MIN = 1, TILT_MAX = 40;
    var moveSmooth = 6, rollRate = 0.9, rollSmooth = 8;
    // the smoothing of the mouse look: the turn that the mouse asks for waits and goes into the look at a rate (per second): low is slow and smooth, 60 and more is direct (7 and 8)
    var LOOK_MIN = 1, LOOK_MAX = 60, LOOK_RATE_CHANGE = 1.2;
    var lookRate = 20, lookX = 0, lookY = 0;
    var euler = new THREE.Euler(0, 0, 0, "YXZ");
    var placeBehind = false;
    var panel = null, followButton = null, aimButton = null, fixedButton = null, speedLabel = null;
    var carId = null, saveAt = 0;
    var KEYS = { forward: "KeyW", back: "KeyS", left: "KeyA", right: "KeyD", up: ["KeyZ", "Space"], down: ["KeyX", "AltLeft", "AltRight"], slower: "Digit3", faster: "Digit4", lookSlower: "Digit7", lookFaster: "Digit8",
        rollLeft: "KeyQ", rollRight: "KeyE", fovNarrow: "BracketLeft", fovWide: "BracketRight", fixedToggle: "KeyI" };
    // the keys this camera takes (Settings.js leaves them to it while it is on: they do not drive the car, mute the sound or save the reset place)
    var TAKEN = {};
    Object.keys(KEYS).forEach(function (k) { [].concat(KEYS[k]).forEach(function (code) { TAKEN[code] = true; }); });

    function key(name) { var codes = [].concat(KEYS[name]); for (var i = 0; i < codes.length; i++) if (Settings.keyDown(codes[i])) return 1; return 0; }

    var sliders = [], recordButton = null, dragging = null;
    function buildPanel() {
        var style = document.createElement("style");
        style.textContent =
            "#freeCam { position: fixed; right: 16px; top: 14px; z-index: 900; display: none; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #dfe6ef; user-select: none; -webkit-user-select: none;" +
            " background: rgba(22, 27, 34, 0.92); border: 1px solid #323c4a; border-radius: 10px; padding: 8px 12px 12px; touch-action: pan-y; width: 260px; max-height: calc(100vh - 28px); overflow-y: auto; box-sizing: border-box; }" +
            "#freeCam .title { font-size: 12px; letter-spacing: 1px; text-transform: uppercase; color: #9fb0c4; margin: 0 0 8px; padding: 2px 0; display: flex; justify-content: space-between; gap: 12px; cursor: grab; touch-action: none; }" +
            "#freeCam .keys { font-size: 11px; color: #9fb0c4; line-height: 1.5; margin: 0 0 8px; } #freeCam .keys summary { cursor: pointer; margin-bottom: 4px; }" +
            "#freeCam .keys b { color: #e6edf5; font-weight: 600; }" +
            "#freeCam .row { display: flex; align-items: center; gap: 6px; margin-top: 6px; }" +
            "#freeCam h3 { margin: 12px 0 2px; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: #7f90a5; font-weight: 600; }" +
            "#freeCam button { height: 32px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--line, #272e37); background: var(--panel, #181d23); color: #fff; font: 600 13px system-ui, sans-serif; cursor: pointer; width: 100%; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }" +
            "#freeCam button:hover { border-color: var(--muted, #8d97a3); }" +
            "#freeCam button.on { border-color: var(--accent, #ff5a1f); background: rgba(255, 90, 31, 0.16); }" +
            "#freeCam button.rec { background: #d9372f; border-color: #ff6b62; }" +
            "#freeCam button.small { width: auto; height: 24px; padding: 0 8px; font-size: 11px; }" +
            "#freeCam .slide { margin-top: 8px; } #freeCam .slide .top { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #9fb0c4; }" +
            "#freeCam .slide .top b { color: #fff; font-weight: normal; font-variant-numeric: tabular-nums; } #freeCam .slide input { width: 100%; margin: 4px 0 0; }";
        document.head.appendChild(style);
        panel = document.createElement("div");
        panel.id = "freeCam";
        var title = document.createElement("div");
        title.className = "title";
        title.innerHTML = "<span>Free camera</span><span id=\"freeCamSpeed\"></span>";
        panel.appendChild(title);
        speedLabel = title.querySelector("#freeCamSpeed");
        var keys = document.createElement("details");
        keys.className = "keys";
        keys.innerHTML = "<summary>Keys</summary><b>W A S D</b> move · <b>Space Z</b> up · <b>Alt X</b> down<br><b>mouse</b> look (click the scene) · <b>Q E</b> tilt<br><b>[ ]</b> field of view · <b>3 4</b> slower, faster · <b>7 8</b> mouse look smoother, sharper";
        panel.appendChild(keys);
        function button(onClick, icon) {
            var b = document.createElement("button");
            b.type = "button";
            b.addEventListener("click", function (e) { e.preventDefault(); onClick(); });
            return b;
        }
        function line(b) { var row = document.createElement("div"); row.className = "row"; row.appendChild(b); panel.appendChild(row); return row; }
        aimButton = button(toggleAim); followButton = button(toggleFollow); fixedButton = button(toggleFixed);
        [aimButton, followButton, fixedButton].forEach(line);
        // a slider: a value that maps to the position of the slider (a log scale for what spans a lot) and back
        function slider(label, spec) {
            var wrap = document.createElement("div"); wrap.className = "slide";
            var top = document.createElement("div"); top.className = "top";
            var l = document.createElement("span"); l.textContent = label;
            var value = document.createElement("b");
            top.appendChild(l); top.appendChild(value);
            if (spec.reset) { var r = button(function () { spec.reset(); sync(); save(); }); r.className = "small"; r.textContent = "Level"; top.insertBefore(r, value); }
            var input = document.createElement("input"); input.type = "range"; input.min = 0; input.max = 1000; input.step = 1;
            input.setAttribute("aria-label", label);
            wrap.appendChild(top); wrap.appendChild(input); panel.appendChild(wrap);
            var item = { input: input, value: value, spec: spec };
            function sync() { if (dragging === input) return; input.value = Math.round(spec.toPos(spec.get()) * 1000); value.textContent = spec.text(spec.get()); }
            item.sync = sync;
            input.addEventListener("pointerdown", function () { dragging = input; });
            window.addEventListener("pointerup", function () { if (dragging === input) { dragging = null; sync(); } });
            input.addEventListener("input", function () { spec.set(spec.fromPos(input.value / 1000)); value.textContent = spec.text(spec.get()); refreshLabels(); });
            input.addEventListener("change", save);
            sliders.push(item);
            return item;
        }
        function linear(min, max) { return { toPos: function (v) { return (v - min) / (max - min); }, fromPos: function (p) { return min + p * (max - min); } }; }
        function logarithmic(min, max) { return { toPos: function (v) { return Math.log(v / min) / Math.log(max / min); }, fromPos: function (p) { return min * Math.pow(max / min, p); } }; }
        function merge(a, b) { for (var k in b) a[k] = b[k]; return a; }
        var h = document.createElement("h3"); h.textContent = "Movement"; panel.appendChild(h);
        slider("Speed", merge(logarithmic(0.01, 3), { get: function () { return speed; }, set: function (v) { speed = Math.max(0.01, Math.min(3, v)); }, text: function (v) { return v.toFixed(v < 0.1 ? 2 : 1) + "×"; } }));
        slider("Movement smoothing", merge(logarithmic(MOVE_MIN, MOVE_MAX), { get: function () { return moveSmooth; }, set: function (v) { moveSmooth = Math.max(MOVE_MIN, Math.min(MOVE_MAX, v)); },
            text: function (v) { return v >= MOVE_MAX * 0.97 ? "direct" : v.toFixed(1) + "/s"; } }));
        h = document.createElement("h3"); h.textContent = "Look"; panel.appendChild(h);
        slider("Mouse look smoothing", merge(logarithmic(LOOK_MIN, LOOK_MAX), { get: function () { return lookRate; }, set: function (v) { lookRate = Math.max(LOOK_MIN, Math.min(LOOK_MAX, v)); },
            text: function (v) { return v >= LOOK_MAX * 0.97 ? "direct" : Math.round(v) + "/s"; } }));
        slider("Field of view", merge(linear(8, 110), { get: function () { return fov; }, set: function (v) { fov = Math.max(8, Math.min(110, v)); }, text: function (v) { return Math.round(v) + "°"; } }));
        h = document.createElement("h3"); h.textContent = "Tilt"; panel.appendChild(h);
        slider("Tilt", merge(linear(-180, 180), { get: function () { return rollT * 180 / Math.PI; }, set: function (v) { rollT = v * Math.PI / 180; }, text: function (v) { return Math.round(v) + "°"; },
            reset: function () { rollT = 0; } }));
        slider("Tilt speed", merge(logarithmic(ROLL_MIN, ROLL_MAX), { get: function () { return rollRate; }, set: function (v) { rollRate = Math.max(ROLL_MIN, Math.min(ROLL_MAX, v)); }, text: function (v) { return Math.round(v * 57.3) + "°/s"; } }));
        slider("Tilt smoothing", merge(logarithmic(TILT_MIN, TILT_MAX), { get: function () { return rollSmooth; }, set: function (v) { rollSmooth = Math.max(TILT_MIN, Math.min(TILT_MAX, v)); },
            text: function (v) { return v >= TILT_MAX * 0.97 ? "direct" : v.toFixed(1) + "/s"; } }));
        h = document.createElement("h3"); h.textContent = "Record"; panel.appendChild(h);
        recordButton = button(function () { if (OpenRacer.Take) OpenRacer.Take.toggle(); });
        line(recordButton);
        if (OpenRacer.Take) OpenRacer.Take.onChange(refreshUi);
        document.body.appendChild(panel);
        OpenRacer.Movable.make(panel, { key: "freecam", handle: title });
        refreshUi();
    }

    function refreshLabels() {
        if (!panel) return;
        speedLabel.textContent = "";
    }

    function refreshUi() {
        if (!panel) return;
        var icon = function (name) { return OpenRacer.icon(name, 15); };
        aimButton.innerHTML = icon("camera") + "<span>" + (aim ? "Looking at the car (P)" : "Look at the car (P)") + "</span>";
        aimButton.classList.toggle("on", aim);
        followButton.innerHTML = icon("move") + "<span>" + (follow ? "Moving with the car (O)" : "Move with the car (O)") + "</span>";
        followButton.classList.toggle("on", follow);
        fixedButton.innerHTML = icon("check") + "<span>" + (fixed ? "Fixed to the car (I)" : "Fix to the car (I)") + "</span>";
        fixedButton.classList.toggle("on", fixed);
        sliders.forEach(function (item) { item.sync(); });
        var st = OpenRacer.Take ? OpenRacer.Take.state() : "idle", on = st === "taking" || st === "counting";
        recordButton.innerHTML = icon(on ? "square" : "video") + "<span>" + (st === "counting" ? "Cancel (5 key)" : on ? "Stop recording (5 key)" : "Record (5 key)") + "</span>";
        recordButton.classList.toggle("rec", on);
    }

    function toggleFollow() { follow = !follow; if (follow && fixed) setFixed(false); refreshUi(); save(); }
    // fixed to the car: the place and the look of the camera go into the frame of the car (and back out to the world)
    function setFixed(on) {
        if (on === fixed || !carRef) return;
        var body = carRef.body;
        tmpE.set(pitch, yaw, roll, "YXZ"); tmpQ.setFromEuler(tmpE);
        if (fixed) {
            pos.applyQuaternion(body.quaternion).add(body.position); vel.applyQuaternion(body.quaternion);
            tmpQ.premultiply(body.quaternion);
        } else {
            tmpQ2.copy(body.quaternion).invert();
            pos.sub(body.position).applyQuaternion(tmpQ2); vel.applyQuaternion(tmpQ2);
            tmpQ.premultiply(tmpQ2);
            follow = false;
        }
        tmpE.setFromQuaternion(tmpQ, "YXZ"); pitch = tmpE.x; yaw = tmpE.y; roll = rollT = tmpE.z;
        fixed = on;
    }
    function toggleFixed() { setFixed(!fixed); refreshUi(); save(); }
    function toggleAim() { aim = !aim; refreshUi(); save(); }

    // ---- remembered per car
    function storageKey() { return "openracer.freecam." + (carId || "car"); }
    function save() {
        if (!carId) return;
        try { window.localStorage.setItem(storageKey(), JSON.stringify({ x: pos.x, y: pos.y, z: pos.z, yaw: yaw, pitch: pitch, roll: roll, fov: fov, speed: speed, look: lookRate, move: moveSmooth, rollRate: rollRate, rollSmooth: rollSmooth, follow: follow, aim: aim, fixed: fixed,
            carX: lastCar.x, carY: lastCar.y, carZ: lastCar.z })); } catch (e) { /* no storage */ }
    }
    function restore(carPosition) {
        try {
            var s = JSON.parse(window.localStorage.getItem(storageKey()));
            if (!s || !isFinite(s.x) || !isFinite(s.y) || !isFinite(s.z)) return false;
            pos.set(s.x, s.y, s.z);
            // a camera that went with the car keeps its place against the car: it comes back there, wherever the car is now
            if (s.follow && isFinite(s.carX)) pos.add(carPosition).sub(new THREE.Vector3(s.carX, s.carY, s.carZ));
            yaw = isFinite(s.yaw) ? s.yaw : 0; pitch = isFinite(s.pitch) ? s.pitch : 0; fov = isFinite(s.fov) ? s.fov : 60; roll = rollT = isFinite(s.roll) ? s.roll : 0;
            speed = isFinite(s.speed) ? Math.max(0.01, Math.min(3, s.speed)) : 1;
            lookRate = isFinite(s.look) ? Math.max(LOOK_MIN, Math.min(LOOK_MAX, s.look)) : 20;
            moveSmooth = isFinite(s.move) ? Math.max(MOVE_MIN, Math.min(MOVE_MAX, s.move)) : 6;
            rollRate = isFinite(s.rollRate) ? Math.max(ROLL_MIN, Math.min(ROLL_MAX, s.rollRate)) : 0.9;
            rollSmooth = isFinite(s.rollSmooth) ? Math.max(TILT_MIN, Math.min(TILT_MAX, s.rollSmooth)) : 8;
            follow = !!s.follow; aim = s.aim !== false; fixed = !!s.fixed;
            return true;
        } catch (e) { return false; }
    }

    // the camera goes free: where it was the last time for this car, or from where the camera is now (no jump)
    function enter(camera, carPosition, id, car) {
        if (!panel) buildPanel();
        active = true;
        carId = id || null; carRef = car || null; fixed = false;
        vel.set(0, 0, 0);
        lastCar.copy(carPosition);
        placeBehind = false;
        if (!restore(carPosition)) {
            pos.copy(camera.position);
            pos.y += 10;                                 // it starts 10 m higher than the camera that it came from
            euler.setFromQuaternion(camera.quaternion, "YXZ");
            yaw = euler.y; pitch = euler.x; roll = rollT = 0;
            fov = camera.fov;
            // the game starts with this camera (the choice is kept): the camera has not been put near the car yet, so it starts behind it, at the
            // first frame (the car has its direction by then)
            placeBehind = camera.position.distanceTo(carPosition) > 60;
            // the first time the camera is fixed to the car (I): a camera that stayed where it was while the car drove on was far away by the time it was chosen
            if (placeBehind) fixWhenPlaced = true; else setFixed(true);
        }
        panel.style.display = Settings.option("hud") ? "block" : "none";
        refreshUi();
        saveAt = 0;
    }
    var fixWhenPlaced = false;

    function leave() {
        if (active) save();
        active = false;
        if (pointerLocked && document.exitPointerLock) document.exitPointerLock();
        if (panel) panel.style.display = "none";
    }
    window.addEventListener("beforeunload", function () { if (active) save(); });

    // the camera must not go through a wall (or the road of a crest) while it goes with the car: rays from the car to it and to a place a bit to each side of it,
    // against the triangles of the track (Ground.firstHit); it comes in front of the nearest, at once, and goes out again smoothly when the way is free (as the chase camera)
    var camClear = 1, camTarget = new THREE.Vector3(), camDir = new THREE.Vector3(), camEnd = new THREE.Vector3(), camSide = new THREE.Vector3(), camUp = new THREE.Vector3(0, 1, 0);
    function keepInView(car, world, delta) {
        var ground = car && car.vehicle && car.vehicle.ground;
        if (!ground || !ground.firstHit) return;
        camTarget.copy(car.body.position); camTarget.y += 0.9;
        camDir.copy(world).sub(camTarget);
        var length = camDir.length();
        if (length < 0.5) return;
        camDir.divideScalar(length);
        camSide.crossVectors(camDir, camUp).normalize();
        var allowed = 1;
        for (var r = 0; r < 4; r++) {
            camEnd.copy(world);
            if (r === 1) camEnd.addScaledVector(camSide, 0.45);
            else if (r === 2) camEnd.addScaledVector(camSide, -0.45);
            else if (r === 3) camEnd.y += 0.4;
            var rx = camEnd.x - camTarget.x, ry = camEnd.y - camTarget.y, rz = camEnd.z - camTarget.z, rl = Math.hypot(rx, ry, rz) || 1;
            var hit = ground.firstHit(camTarget.x, camTarget.y, camTarget.z, rx / rl, ry / rl, rz / rl, rl);
            if (hit < rl) allowed = Math.min(allowed, Math.max(0.1, (hit - 0.4) / rl));
        }
        camClear += (allowed - camClear) * (1 - Math.exp(-(allowed < camClear ? 40 : 3) * delta));
        camClear = Math.min(1, Math.max(0.1, camClear));
        if (camClear < 0.999) world.copy(camTarget).addScaledVector(camDir, length * camClear);
    }

    var fixedKeyWas = false, syncAt = 0;
    // once per frame while the camera is the free one
    function update(delta, carPosition, camera, carYaw, car) {
        delta = Math.min(delta, 0.1);
        if (car) carRef = car;
        var body = carRef ? carRef.body : null;
        // I: fixed to the car (the key itself: the actions of the settings menu leave the keys of this camera alone)
        var fixedKey = !!Settings.keyDown(KEYS.fixedToggle);
        if (fixedKey && !fixedKeyWas && body) toggleFixed();
        fixedKeyWas = fixedKey;
        if (fixed && !body) fixed = false;
        if (placeBehind) {
            placeBehind = false;
            var ahead = new THREE.Vector3(Math.sin(carYaw), 0, Math.cos(carYaw));
            pos.copy(carPosition).addScaledVector(ahead, -8); pos.y += 10;
            yaw = carYaw + Math.PI; pitch = -0.15; fov = 50;
            lastCar.copy(carPosition);
            if (fixWhenPlaced) { fixWhenPlaced = false; fixed = false; setFixed(true); refreshUi(); }
        }
        panel.style.display = Settings.option("hud") ? "block" : "none";      // the panel goes with the HUD
        var mx = key("right") - key("left"), mz = key("forward") - key("back"), my = key("up") - key("down");
        var ds = key("faster") - key("slower");
        if (ds) { speed = Math.max(0.01, Math.min(3, speed * Math.exp(ds * SPEED_RATE * delta))); }
        var dl = key("lookFaster") - key("lookSlower");
        if (dl) { lookRate = Math.max(LOOK_MIN, Math.min(LOOK_MAX, lookRate * Math.exp(dl * LOOK_RATE_CHANGE * delta))); }
        // the turn of the mouse goes into the look, a share of what waits every frame (all of it when the look is direct); nothing waits while the camera looks at the car
        if (aim) lookX = lookY = 0;
        if (lookX || lookY) {
            var share = lookRate >= LOOK_MAX ? 1 : 1 - Math.exp(-lookRate * delta), ax = lookX * share, ay = lookY * share;
            lookX -= ax; lookY -= ay;
            if (Math.abs(lookX) < 1e-5) lookX = 0;
            if (Math.abs(lookY) < 1e-5) lookY = 0;
            yaw -= ax; pitch = Math.max(-1.5, Math.min(1.5, pitch - ay));
        }
        // Q and E roll the picture (it eases to where it is going)
        rollT = Math.max(-Math.PI, Math.min(Math.PI, rollT + (key("rollLeft") - key("rollRight")) * rollRate * delta));
        roll = rollSmooth >= TILT_MAX ? rollT : roll + (rollT - roll) * (1 - Math.exp(-rollSmooth * delta));
        fov = Math.max(8, Math.min(110, fov + (key("fovWide") - key("fovNarrow")) * FOV_RATE * delta));
        // forward is the way the camera looks (up and down with the look, W flies where the mouse points), the sides are level; the speed follows what is asked for, it does not jump to it
        var fx = -Math.sin(yaw), fz = -Math.cos(yaw), cp = Math.cos(pitch), fy = Math.sin(pitch);
        want.set(fx * cp * mz + -fz * mx, fy * mz + my * VERTICAL_SPEED / BASE_SPEED, fz * cp * mz + fx * mx).multiplyScalar(BASE_SPEED * speed);
        if (moveSmooth >= MOVE_MAX) vel.copy(want); else vel.lerp(want, 1 - Math.exp(-moveSmooth * delta));
        pos.addScaledVector(vel, delta);
        if (follow && !fixed) pos.add(carPosition).sub(lastCar);
        lastCar.copy(carPosition);
        // where the camera is in the world (fixed to the car: pos is in its frame)
        tmpW.copy(pos);
        if (fixed) tmpW.applyQuaternion(body.quaternion).add(body.position);
        if (aim) {
            // it turns to the car (a little above its middle) smoothly; the angles go on from where it looks when the look is let go
            var dx = carPosition.x - tmpW.x, dy = carPosition.y + 0.7 - tmpW.y, dz = carPosition.z - tmpW.z;
            var wantYaw = Math.atan2(-dx, -dz), wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
            var k = 1 - Math.exp(-10 * delta);
            if (fixed) {
                // the look in the world, eased, then back into the frame of the car
                tmpE.set(pitch, yaw, roll, "YXZ"); tmpQ.setFromEuler(tmpE).premultiply(body.quaternion);
                tmpE.set(wantPitch, wantYaw, roll, "YXZ"); tmpQ2.setFromEuler(tmpE);
                tmpQ.slerp(tmpQ2, k).premultiply(tmpQ2.copy(body.quaternion).invert());
                tmpE.setFromQuaternion(tmpQ, "YXZ"); pitch = tmpE.x; yaw = tmpE.y;
            } else {
                var turn = wantYaw - yaw;
                while (turn > Math.PI) turn -= 2 * Math.PI;
                while (turn < -Math.PI) turn += 2 * Math.PI;
                yaw += turn * k;
                pitch += (wantPitch - pitch) * k;
            }
        }
        if ((fixed || follow) && carRef) keepInView(carRef, tmpW, delta);
        camera.position.copy(tmpW);
        euler.set(pitch, yaw, roll, "YXZ");
        camera.quaternion.setFromEuler(euler);
        if (fixed) camera.quaternion.premultiply(body.quaternion);
        if (Math.abs(camera.fov - fov) > 0.01 || camera.near !== 0.03) {
            camera.fov = fov;
            camera.near = 0.03;
            camera.updateProjectionMatrix();
        }
        // the sliders follow what the keys change
        syncAt += delta;
        if (syncAt > 0.15) { syncAt = 0; sliders.forEach(function (item) { item.sync(); }); }
        // remembered now and then (and when the camera is left)
        saveAt += delta;
        if (saveAt > 2) { saveAt = 0; save(); }
    }

    // the mouse: click the scene and it looks around like a first person view (Escape lets go of the mouse), as the free camera of the replay
    document.addEventListener("mousedown", function (event) {
        if (!active || aim || Settings.isPaused()) return;
        if (typeof renderer === "undefined" || event.target !== renderer.domElement) return;
        if (renderer.domElement.requestPointerLock) renderer.domElement.requestPointerLock();
    });
    document.addEventListener("pointerlockchange", function () {
        pointerLocked = !!document.pointerLockElement && active;
        if (!mouseHint) {
            mouseHint = document.createElement("div");
            mouseHint.textContent = "Mouse look · Escape for the UI";
            mouseHint.style.cssText = "position:fixed;left:50%;top:14px;transform:translateX(-50%);padding:6px 12px;border-radius:8px;background:rgba(14,18,23,0.75);color:#fff;font:13px system-ui,sans-serif;z-index:950;pointer-events:none;display:none";
            document.body.appendChild(mouseHint);
        }
        mouseHint.style.display = pointerLocked ? "" : "none";
    });
    document.addEventListener("mousemove", function (event) {
        if (!active || aim || !pointerLocked) return;
        lookX += event.movementX * LOOK_SENSITIVITY;
        lookY += event.movementY * LOOK_SENSITIVITY;
    });

    // the mouse look lets go while a window is used (the record dialog) and comes back after: gives true when it was on
    var mouseWas = false;
    function releaseMouse() {
        mouseWas = pointerLocked;
        if (pointerLocked && document.exitPointerLock) document.exitPointerLock();
        return mouseWas;
    }
    function restoreMouse() {
        var want = mouseWas;
        mouseWas = false;
        if (want && active && !aim && typeof renderer !== "undefined" && renderer.domElement.requestPointerLock) {
            try { var p = renderer.domElement.requestPointerLock(); if (p && p.catch) p.catch(function () { /* the next click on the scene does it */ }); } catch (e) { /* the next click on the scene does it */ }
        }
    }

    return { releaseMouse: releaseMouse, restoreMouse: restoreMouse, enter: enter, leave: leave, update: update, toggleFollow: toggleFollow, toggleAim: toggleAim, toggleFixed: toggleFixed, takes: TAKEN,
        get active() { return active; }, get follows() { return follow; }, get aims() { return aim; }, get fixedToCar() { return fixed; } };
})();
