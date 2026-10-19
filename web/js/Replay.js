/*
 * Replay.js
 *
 * Description: The replay. From the first frame of the game everything is recorded: all cars (the player and the opponents), thirty
 *              times a second, as what is needed to draw them again: where the body is and how it is turned, the speed, the steering,
 *              and for every wheel where it is, how far it has turned and how far its spring is out. The recording is kept in blocks of
 *              numbers (Float32Array), and the oldest blocks go when it is longer than half an hour.
 *
 *              Escape, Replay: the game stops where it is and the recording is played back through the same code that draws the cars
 *              of the game (updateVisuals, so the suspension, the steering wheel and the camera work as they do in the game). A bar at the
 *              bottom has a slider over the whole recording, rewind (backwards), pause, play, jumps of ten seconds, and the speed from
 *              0.1x to 5x. Escape (or the button) goes back to the game, which goes on where it was left.
 *
 *              A replay can be saved as a file (Save replay in the bar) and opened by someone else (Open a replay in the main menu): the
 *              file holds the recording and the ids of the track and the cars, not their models, so the other one needs the same cars and
 *              track (the standard ones, or the ones of a zip of the garage). Nothing goes to a server.
 *
 *              Cameras: Fixed, Follow and Cockpit are those of the game; Free is a camera that is moved by hand: WASD or the arrows move it,
 *              Shift and Control up and down, the mouse (click the scene) or the right stick looks around like a first person view, [ and ]
 *              change the field of view. F aims the camera at the car (and the mouse look rests), L fixes the camera to the car, so that it
 *              goes with it, Tab chooses another car. All movements, the look and the zoom are smoothed and damped; a slider (0.1 to 3)
 *              sets how fast they are.
 *
 *              Keys in the replay: Space pause/play, left and right arrow 5 seconds back and forward (in Free they move the camera),
 *              Home and End the start and the end, T the camera, H hides the bar and shows it again.
 */

OpenRacer.Replay = (function() {
    var RATE = 30, DT = 1 / RATE;
    var MAX_SECONDS = 1800;            // what is kept: the last half hour
    var CHUNK = 300;                   // samples in a block
    var FIELDS = 16, WHEEL_FIELDS = 5;
    var STRIDE = FIELDS + 4 * WHEEL_FIELDS;   // numbers per car per sample
    var SPEEDS = [0.1, 0.25, 0.5, 1, 2, 3, 5];
    var JUMP_DISTANCE = 15;            // a car that moved further than this between two samples was put back (a reset): no sliding in between
    var P = { px: 0, py: 1, pz: 2, qx: 3, qy: 4, qz: 5, qw: 6, vx: 7, vy: 8, vz: 9, steer: 10, rpm: 11, throttle: 12, brake: 13, gear: 14, present: 15 };

    var cars = [];                     // { object, player }
    var chunks = [];
    var dropped = 0;                   // blocks that were thrown away at the start
    var fill = 0;                      // samples in the last block
    var total = 0;                     // samples ever recorded
    var accumulated = 0;
    var gearLabels = [""];

    var api = { active: false, viewer: false };   // viewer: a replay that was opened from a file, there is no game behind it

    // ---- recording

    function perSample() { return cars.length * STRIDE; }

    function isReady(object) {
        if(typeof object.isReady === "function") return object.isReady();
        return !!object.loaded;
    }

    function gearIndex(object) {
        if(typeof object.gearLabel !== "function") return 0;
        var label = object.gearLabel();
        var i = gearLabels.indexOf(label);
        if(i < 0) { gearLabels.push(label); i = gearLabels.length - 1; }
        return i;
    }

    function write(array, offset, entry) {
        var object = entry.object, v = object.vehicle;
        array[offset + P.px] = v.px; array[offset + P.py] = v.py; array[offset + P.pz] = v.pz;
        array[offset + P.qx] = v.qx; array[offset + P.qy] = v.qy; array[offset + P.qz] = v.qz; array[offset + P.qw] = v.qw;
        array[offset + P.vx] = v.vx; array[offset + P.vy] = v.vy; array[offset + P.vz] = v.vz;
        array[offset + P.steer] = v.steerApplied || 0;
        array[offset + P.rpm] = object.engineRPM || 0;
        array[offset + P.throttle] = object.throttle || 0;
        array[offset + P.brake] = object.brakePedal || 0;
        array[offset + P.gear] = entry.player ? gearIndex(object) : 0;
        array[offset + P.present] = isReady(object) ? 1 : 0;
        for(var k = 0; k < 4; k++) {
            var w = v.wheels[k], o = offset + FIELDS + k * WHEEL_FIELDS;
            array[o] = w.center.x; array[o + 1] = w.center.y; array[o + 2] = w.center.z;
            array[o + 3] = w.spin;
            array[o + 4] = w.visualLength !== undefined ? w.visualLength : (w.susLength !== undefined ? w.susLength : v.restLength);
        }
    }

    // puts a sample into the vehicle of a car, and draws the car
    function read(array, offset, entry) {
        var object = entry.object, v = object.vehicle;
        v.px = array[offset + P.px]; v.py = array[offset + P.py]; v.pz = array[offset + P.pz];
        v.qx = array[offset + P.qx]; v.qy = array[offset + P.qy]; v.qz = array[offset + P.qz]; v.qw = array[offset + P.qw];
        v.vx = array[offset + P.vx]; v.vy = array[offset + P.vy]; v.vz = array[offset + P.vz];
        v.steerApplied = array[offset + P.steer];
        for(var k = 0; k < 4; k++) {
            var w = v.wheels[k], o = offset + FIELDS + k * WHEEL_FIELDS;
            w.center.x = array[o]; w.center.y = array[o + 1]; w.center.z = array[o + 2];
            w.spin = array[o + 3];
            w.visualLength = array[o + 4];
        }
    }

    function init() {
        if(typeof car === "undefined" || !car || !car.isReady() || typeof race === "undefined") return false;
        cars = [{ object: car, player: true }];
        race.opponents.forEach(function(o) { cars.push({ object: o, player: false }); });
        return true;
    }

    function push() {
        if(!chunks.length || fill === CHUNK) {
            chunks.push(new Float32Array(CHUNK * perSample()));
            fill = 0;
            if(chunks.length * CHUNK > MAX_SECONDS * RATE) { chunks.shift(); dropped++; }
        }
        var chunk = chunks[chunks.length - 1];
        var base = fill * perSample();
        for(var i = 0; i < cars.length; i++) write(chunk, base + i * STRIDE, cars[i]);
        fill++;
        total++;
    }

    // Once per frame of the game, with the time of the frame
    api.record = function(delta) {
        if(api.active || api.viewer) return;
        if(!cars.length && !init()) return;
        accumulated += delta;
        var n = 0;
        while(accumulated >= DT && n < 4) { accumulated -= DT; push(); n++; }
        if(accumulated > DT) accumulated = 0;
    };

    function first() { return dropped * CHUNK; }
    function last() { return total - 1; }
    api.start_time = function() { return first() * DT; };
    api.end_time = function() { return Math.max(first(), last()) * DT; };
    api.available = function() { return total > RATE; };    // a second or more

    function locate(index, carIndex) {
        var rel = index - first();
        var chunk = chunks[(rel / CHUNK) | 0];
        return { array: chunk, offset: (rel % CHUNK) * perSample() + carIndex * STRIDE };
    }

    // ---- playback

    var t = 0, playing = false, direction = 1, speed = 1, scrubbing = false;
    var snapshot = null;           // the live state of the cars, to put back at the end
    var scratch = new Float32Array(STRIDE);
    var ui = null;

    function interpolate(time, carIndex, out) {
        var position = Math.max(first(), Math.min(last(), time / DT));
        var a = Math.floor(position), b = Math.min(last(), a + 1);
        var f = position - a;
        var A = locate(a, carIndex), B = locate(b, carIndex);
        var x = A.array, ao = A.offset, y = B.array, bo = B.offset;
        // a car that was put back (a reset) between the two samples does not slide there
        var jump = Math.hypot(y[bo + P.px] - x[ao + P.px], y[bo + P.pz] - x[ao + P.pz]) > JUMP_DISTANCE;
        if(jump) f = 0;
        for(var i = 0; i < STRIDE; i++) out[i] = x[ao + i] + (y[bo + i] - x[ao + i]) * f;
        // the turn of the body: the shortest way between the two orientations
        var dot = x[ao + P.qx] * y[bo + P.qx] + x[ao + P.qy] * y[bo + P.qy] + x[ao + P.qz] * y[bo + P.qz] + x[ao + P.qw] * y[bo + P.qw];
        var sign = dot < 0 ? -1 : 1;
        var qx = x[ao + P.qx] + (sign * y[bo + P.qx] - x[ao + P.qx]) * f, qy = x[ao + P.qy] + (sign * y[bo + P.qy] - x[ao + P.qy]) * f;
        var qz = x[ao + P.qz] + (sign * y[bo + P.qz] - x[ao + P.qz]) * f, qw = x[ao + P.qw] + (sign * y[bo + P.qw] - x[ao + P.qw]) * f;
        var length = Math.hypot(qx, qy, qz, qw) || 1;
        out[P.qx] = qx / length; out[P.qy] = qy / length; out[P.qz] = qz / length; out[P.qw] = qw / length;
        out[P.present] = x[ao + P.present];
        out[P.gear] = x[ao + P.gear];
    }

    function show(time, delta) {
        for(var i = 0; i < cars.length; i++) {
            var entry = cars[i], object = entry.object;
            interpolate(time, i, scratch);
            var visible = scratch[P.present] > 0.5;
            if(!visible) continue;
            read(scratch, 0, entry);
            object.vehicle.updateOutputs();
            if(entry.player) object.updateVisuals(delta);
            else object.updateVisuals();
            if(i === 0) player = { rpm: scratch[P.rpm], throttle: scratch[P.throttle], brake: scratch[P.brake], gear: gearLabels[scratch[P.gear] | 0] || "", speed: Math.hypot(scratch[P.vx], scratch[P.vz]) };
        }
    }
    var player = null;

    function format(seconds) {
        seconds = Math.max(0, seconds);
        var m = Math.floor(seconds / 60), s = seconds - m * 60;
        return m + ":" + (s < 10 ? "0" : "") + s.toFixed(1);
    }

    // ---- the bar

    function css() {
        if(document.getElementById("replayStyle")) return;
        var style = document.createElement("style");
        style.id = "replayStyle";
        style.textContent =
            "body.replaying #hud, body.replaying #hudLaps, body.replaying #hudCar, body.replaying #hudHint, body.replaying #touch, body.replaying #tuning { display: none !important; }" +
            "#replayBar { position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); width: min(960px, calc(100% - 20px)); z-index: 1400; box-sizing: border-box; " +
                "padding: 10px 14px 12px; background: rgba(14, 18, 24, 0.86); color: #fff; border: 1px solid rgba(255,255,255,0.14); border-radius: 12px; " +
                "font-family: Arial, sans-serif; font-size: 14px; box-shadow: 0 10px 40px rgba(0,0,0,0.5); user-select: none; -webkit-user-select: none; touch-action: manipulation; }" +
            "#replayBar .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }" +
            "#replayBar .head { justify-content: space-between; margin-bottom: 6px; }" +
            "#replayBar .tag { font-weight: bold; letter-spacing: 3px; color: #ff6a2b; }" +
            "#replayBar .time { font-variant-numeric: tabular-nums; color: #cfd8e3; }" +
            "#replayBar input[type=range] { width: 100%; margin: 4px 0 8px; accent-color: #ff6a2b; height: 26px; }" +
            "#replayBar button { font: inherit; color: #fff; background: #2b323c; border: 1px solid rgba(255,255,255,0.16); border-radius: 8px; padding: 7px 12px; cursor: pointer; min-width: 40px; }" +
            "#replayBar button:hover { background: #38414d; }" +
            "#replayBar button.on { background: #ff6a2b; border-color: #ff6a2b; }" +
            "#replayBar .spacer { flex: 1; }" +
            "#replayBar .speeds { margin-left: auto; }" +
            "#replayBar .speeds span { color: #9fb0c4; margin-right: 2px; }" +
            "#replayBar .exit { background: #3d7bd9; border-color: #3d7bd9; }" +
            "#replayBar .cameras, #replayBar .freecam { margin-top: 8px; } #replayBar .label { color: #9fb0c4; min-width: 56px; } #replayBar .hint { color: #8795a6; font-size: 12px; }" +
            "#replayBar .freecam input[type=range] { width: 160px; margin: 0; height: 20px; }" +
            "#replayInfo { position: fixed; left: 16px; top: 14px; z-index: 1400; padding: 8px 12px; background: rgba(14, 18, 24, 0.78); color: #fff; " +
                "border-radius: 10px; font-family: Arial, sans-serif; font-size: 15px; font-variant-numeric: tabular-nums; pointer-events: none; }" +
            "#replayInfo b { font-size: 22px; }" +
            "@media (max-width: 600px) { #replayBar { bottom: 6px; padding: 8px 8px 10px; } #replayBar button { padding: 6px 8px; min-width: 34px; } }" +
            // a phone on its side: a lower bar, so that the car stays in view
            "@media (max-height: 480px) { #replayBar { bottom: 4px; padding: 5px 10px 6px; } #replayBar .head { margin-bottom: 0; } #replayBar input[type=range] { height: 18px; margin: 2px 0 4px; } " +
                "#replayBar button { padding: 4px 8px; font-size: 12px; min-width: 30px; } #replayBar .row { gap: 5px; } #replayBar .speeds span { display: none; } #replayBar .hint { display: none; } #replayBar .cameras, #replayBar .freecam { margin-top: 3px; } #replayBar .label { min-width: 0; } #replayInfo { top: 6px; left: 8px; font-size: 13px; padding: 5px 9px; } #replayInfo b { font-size: 17px; } }";
        document.head.appendChild(style);
    }

    function el(parent, tag, className, text) {
        var e = document.createElement(tag);
        if(className) e.className = className;
        if(text !== undefined) e.textContent = text;
        parent.appendChild(e);
        return e;
    }

    function button(parent, label, title, onclick) {
        var b = el(parent, "button", "", label);
        b.title = title;
        b.onclick = onclick;
        return b;
    }

    function build() {
        css();
        var bar = el(document.body, "div");
        bar.id = "replayBar";
        var head = el(bar, "div", "row head");
        var left = el(head, "div", "row");
        el(left, "span", "tag", "REPLAY");
        var timeLabel = el(left, "span", "time", "");
        var right = el(head, "div", "row");
        var save = button(right, "Save replay", "Save the replay as a file to keep or to share", function() {
            save.textContent = "Saving…";
            api.save().then(function(info) {
                save.textContent = "Saved (" + (info.bytes < 1048576 ? Math.max(1, Math.round(info.bytes / 1024)) + " KB" : (info.bytes / 1048576).toFixed(1) + " MB") + ")";
            }).catch(function(error) { save.textContent = "Could not save"; console.error(error); });
            setTimeout(function() { save.textContent = "Save replay"; }, 4000);
        });
        var exit = button(right, api.viewer ? "Main menu" : "Back to the game", "Escape", function() { api.stop(); });
        exit.className = "exit";

        var slider = el(bar, "input");
        slider.type = "range";
        slider.min = "0"; slider.max = "1"; slider.step = "any"; slider.value = "0";
        slider.setAttribute("aria-label", "Position in the replay");
        slider.addEventListener("input", function() { scrubbing = true; t = parseFloat(slider.value); });
        var endScrub = function() { scrubbing = false; };
        slider.addEventListener("change", endScrub);
        slider.addEventListener("pointerup", endScrub);
        slider.addEventListener("keyup", endScrub);

        var transport = el(bar, "div", "row");
        var toStart = button(transport, "⏮", "To the start (Home)", function() { jump(-1e9); });
        var back10 = button(transport, "−10 s", "Ten seconds back", function() { jump(-10); });
        var rewind = button(transport, "◀ Rewind", "Play backwards", function() { direction = -1; playing = true; sync(); });
        var pause = button(transport, "❚❚ Pause", "Pause (Space)", function() { playing = false; sync(); });
        var play = button(transport, "▶ Play", "Play forwards", function() { direction = 1; playing = true; if(t >= api.end_time() - 0.01) t = api.start_time(); sync(); });
        var fwd10 = button(transport, "+10 s", "Ten seconds forward", function() { jump(10); });
        var toEnd = button(transport, "⏭", "To the end (End)", function() { jump(1e9); });

        var speeds = el(transport, "div", "row speeds");
        el(speeds, "span", "", "Speed");
        var speedButtons = SPEEDS.map(function(s) {
            return button(speeds, s + "×", "Playback speed " + s + "×", function() { speed = s; sync(); });
        });

        // the cameras: the three of the game and the free one
        var cameraRow = el(bar, "div", "row cameras");
        el(cameraRow, "span", "label", "Camera");
        cameraButtons = [["Fixed", "The fixed camera behind the car"], ["Follow", "The camera that follows the car"], ["Cockpit", "In the car"], ["Free", "A camera that you move yourself"]].map(function(c, i) {
            return button(cameraRow, c[0], c[1] + (i < 3 ? "" : " (WASD or arrows, Shift and Control up and down, mouse look, [ and ] zoom)"), function() {
                if(i === 3) enterFree();
                else { leaveFree(); Settings.setOption("camera", i + 1); }
                updateCameraUi();
            });
        });
        freeRow = el(bar, "div", "row freecam");
        var speedLabel = el(freeRow, "span", "label", "Speed " + free.speed.toFixed(1) + "×");
        var speedSlider = el(freeRow, "input");
        speedSlider.type = "range"; speedSlider.min = "0.1"; speedSlider.max = "3"; speedSlider.step = "0.1"; speedSlider.value = String(free.speed);
        speedSlider.title = "How fast the free camera moves, looks and zooms";
        speedSlider.setAttribute("aria-label", "Speed of the free camera");
        speedSlider.addEventListener("input", function() {
            free.speed = parseFloat(speedSlider.value);
            speedLabel.textContent = "Speed " + free.speed.toFixed(1) + "×";
            try { localStorage.setItem("openracer.replay.freeSpeed", String(free.speed)); } catch(e) { /* no storage */ }
        });
        speedSlider.addEventListener("keydown", function(e) { if(/^Arrow/.test(e.code)) e.stopPropagation(); });
        var aimButton = button(freeRow, "Aim at the car (F)", "The camera keeps looking at the car", function() { toggleAim(); });
        var parentButton = button(freeRow, "Fixed to the car (L)", "The camera goes with the car, from where it is now", function() { toggleParent(); });
        var targetButton = button(freeRow, "Car", "The next car (Tab)", function() { nextTarget(); });
        var hint = el(freeRow, "span", "hint", "WASD or arrows move · Shift up · Control down · click the scene to look around · [ ] zoom");
        freeInfo = { aim: aimButton, parent: parentButton, target: targetButton };
        freeRow.style.display = "none";

        function sync() {
            rewind.className = playing && direction < 0 ? "on" : "";
            play.className = playing && direction > 0 ? "on" : "";
            pause.className = !playing ? "on" : "";
            speedButtons.forEach(function(b, i) { b.className = SPEEDS[i] === speed ? "on" : ""; });
        }
        var info = el(document.body, "div");
        info.id = "replayInfo";
        ui = { bar: bar, info: info, slider: slider, timeLabel: timeLabel, sync: sync };
        updateCameraUi();
        slider.min = String(api.start_time());
        sync();
    }

    function jump(seconds) {
        t = Math.max(api.start_time(), Math.min(api.end_time(), t + seconds));
    }

    function updateUi() {
        if(!ui) return;
        ui.slider.min = String(api.start_time());
        ui.slider.max = String(api.end_time());
        if(!scrubbing) ui.slider.value = String(t);
        ui.timeLabel.textContent = format(t) + " / " + format(api.end_time()) + (playing ? "   " + (direction < 0 ? "◀ " : "▶ ") + speed + "×" : "   paused");
        if(player) {
            var metric = Settings.option("units") !== "imperial";
            ui.info.innerHTML = "<b>" + Math.round(player.speed * (metric ? 3.6 : 2.2369362920544)) + "</b> " + (metric ? "km/h" : "mph") +
                " &nbsp; " + player.gear + " &nbsp; " + (player.rpm / 1000).toFixed(1) + " ×1000 rpm &nbsp; gas " + Math.round(player.throttle * 100) + "% &nbsp; brake " + Math.round(player.brake * 100) + "%";
        }
    }

    function onKey(event) {
        if(!api.active) return;
        var target = event.target;
        if(target && /^(TEXTAREA|SELECT)$/.test(target.tagName)) return;
        keys[event.code] = true;
        if(free.active) {
            // the keys of the free camera (the arrows move it, so they do not jump in time then)
            if(event.code === "KeyF" && !event.repeat) { toggleAim(); event.preventDefault(); return; }
            if(event.code === "KeyL" && !event.repeat) { toggleParent(); event.preventDefault(); return; }
            if(event.code === "Tab") { nextTarget(); event.preventDefault(); return; }
            if(/^Arrow/.test(event.code) || /^(Bracket|Shift|Control)/.test(event.code)) { event.preventDefault(); return; }
        }
        if(event.code === "Space") {
            if(target && target.tagName === "BUTTON") return;   // the space bar presses a button that has the focus
            event.preventDefault();
            playing = !playing;
            if(playing && direction > 0 && t >= api.end_time() - 0.01) t = api.start_time();
            ui.sync();
        } else if(event.code === "ArrowLeft" && !(target && target.tagName === "INPUT")) { jump(-5); event.preventDefault(); }
        else if(event.code === "ArrowRight" && !(target && target.tagName === "INPUT")) { jump(5); event.preventDefault(); }
        else if(event.code === "KeyH" && !event.repeat) { ui.bar.style.display = ui.bar.style.display === "none" ? "" : "none"; event.preventDefault(); }
        else if(event.code === "Home") { jump(-1e9); event.preventDefault(); }
        else if(event.code === "End") { jump(1e9); event.preventDefault(); }
    }
    window.addEventListener("keydown", onKey, true);

    // ---- the free camera

    var V3 = function(x, y, z) { return new THREE.Vector3(x, y, z); };
    var free = {
        active: false, speed: 1,
        pos: V3(0, 0, 0), vel: V3(0, 0, 0),            // in the frame of the camera: the world, or the car while the camera is fixed to it
        yaw: 0, pitch: 0, yawT: 0, pitchT: 0,          // the way it looks, and where the mouse wants it to look
        fov: 60, fovT: 60,
        quat: new THREE.Quaternion(),                  // how it looks in the world, last frame
        aim: false,                                    // F: aimed at the car
        parent: false,                                 // L: fixed to the car
        target: 0                                      // the car (Tab chooses)
    };
    try { var storedSpeed = parseFloat(localStorage.getItem("openracer.replay.freeSpeed")); if(storedSpeed >= 0.1 && storedSpeed <= 3) free.speed = storedSpeed; } catch(e) { /* no storage */ }
    var keys = {};
    var BASE_SPEED = 12, VERTICAL_SPEED = 8, FOV_RATE = 40, LOOK_SENSITIVITY = 0.0022, STICK_LOOK = 2.4;
    var tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion(), tmpV = V3(0, 0, 0), tmpV2 = V3(0, 0, 0), tmpE = new THREE.Euler(0, 0, 0, "YXZ"), tmpM = new THREE.Matrix4();
    var pointerLocked = false;

    function targetObject() { var entry = cars[Math.min(free.target, cars.length - 1)]; return entry ? entry.object.body : null; }

    // yaw and pitch (in the frame of the camera) from how it looks in the world
    function anglesFromWorld(qWorld) {
        var body = free.parent ? targetObject() : null;
        tmpQ.copy(qWorld);
        if(body) tmpQ.premultiply(tmpQ2.copy(body.quaternion).invert());
        tmpE.setFromQuaternion(tmpQ, "YXZ");
        free.yaw = free.yawT = tmpE.y;
        free.pitch = free.pitchT = tmpE.x;
    }

    function enterFree() {
        if(free.active) return;
        free.active = true;
        free.pos.copy(camera.position);
        free.vel.set(0, 0, 0);
        free.quat.copy(camera.quaternion);
        free.parent = false;
        free.aim = false;
        free.target = 0;
        anglesFromWorld(free.quat);
        free.fov = free.fovT = camera.fov;
        updateCameraUi();
    }

    function leaveFree() {
        if(!free.active) return;
        free.active = false;
        free.parent = false;
        if(document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
        updateCameraUi();
    }

    function toggleAim() {
        free.aim = !free.aim;
        if(!free.aim) anglesFromWorld(free.quat);     // the look goes on from where it points
        updateCameraUi();
    }

    function toggleParent() {
        var body = targetObject();
        if(!body) return;
        if(!free.parent) {
            // the position and the movement of the camera become those in the frame of the car
            tmpQ2.copy(body.quaternion).invert();
            free.pos.sub(body.position).applyQuaternion(tmpQ2);
            free.vel.applyQuaternion(tmpQ2);
            free.parent = true;
        } else {
            free.pos.applyQuaternion(body.quaternion).add(body.position);
            free.vel.applyQuaternion(body.quaternion);
            free.parent = false;
        }
        anglesFromWorld(free.quat);
        updateCameraUi();
    }

    function nextTarget() {
        if(cars.length < 2) return;
        var body = targetObject();
        // the camera keeps its place in the world when it goes to another car
        if(free.parent && body) toggleParent();
        free.target = (free.target + 1) % cars.length;
        updateCameraUi();
    }

    function stick(value) { return Math.abs(value) < 0.15 ? 0 : value; }

    function updateFree(delta) {
        delta = Math.min(delta, 0.1);
        var scale = free.speed;
        var body = targetObject();
        var parented = free.parent && body;
        // what is asked for, with the keys and the controller
        var mx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
        var mz = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
        var my = (keys.ShiftLeft || keys.ShiftRight ? 1 : 0) - (keys.ControlLeft || keys.ControlRight ? 1 : 0);
        var zoom = (keys.BracketRight ? 1 : 0) - (keys.BracketLeft ? 1 : 0);
        var pad = typeof Settings !== "undefined" && Settings.controllerPad ? Settings.controllerPad() : null;
        if(pad) {
            mx += stick(pad.axes[0] || 0);
            mz -= stick(pad.axes[1] || 0);
            if(pad.buttons[7]) my += pad.buttons[7].value;
            if(pad.buttons[6]) my -= pad.buttons[6].value;
            if(pad.buttons[5] && pad.buttons[5].pressed) zoom += 1;
            if(pad.buttons[4] && pad.buttons[4].pressed) zoom -= 1;
            if(!free.aim) {
                free.yawT -= stick(pad.axes[2] || 0) * STICK_LOOK * delta * Math.max(0.5, scale);
                free.pitchT -= stick(pad.axes[3] || 0) * STICK_LOOK * delta * Math.max(0.5, scale);
            }
        }
        free.pitchT = Math.max(-1.5, Math.min(1.5, free.pitchT));

        // the direction: along where the camera looks, level; the steps are in the world, and are put in the frame of the camera
        tmpV.set(0, 0, -1).applyQuaternion(free.quat);
        tmpV.y = 0;
        if(tmpV.lengthSq() < 1e-6) tmpV.set(0, 0, -1); else tmpV.normalize();
        tmpV2.set(-tmpV.z, 0, tmpV.x);                       // to the right
        var wantX = (tmpV.x * mz + tmpV2.x * mx) * BASE_SPEED * scale;
        var wantZ = (tmpV.z * mz + tmpV2.z * mx) * BASE_SPEED * scale;
        var want = V3(wantX, my * VERTICAL_SPEED * scale, wantZ);
        if(parented) want.applyQuaternion(tmpQ2.copy(body.quaternion).invert());
        // smoothed: the speed follows what is asked for, it does not jump to it
        free.vel.lerp(want, 1 - Math.exp(-5 * delta));
        free.pos.addScaledVector(free.vel, delta);

        // the look: the mouse decides where it wants to look, the camera follows smoothly
        free.yaw += (free.yawT - free.yaw) * (1 - Math.exp(-20 * delta));
        free.pitch += (free.pitchT - free.pitch) * (1 - Math.exp(-20 * delta));

        // the field of view, smoothed too
        free.fovT = Math.max(8, Math.min(110, free.fovT + zoom * FOV_RATE * scale * delta));
        free.fov += (free.fovT - free.fov) * (1 - Math.exp(-8 * delta));

        // the place in the world, and the way it looks
        var world = tmpV.copy(free.pos);
        if(parented) world.applyQuaternion(body.quaternion).add(body.position);
        if(free.aim && body) {
            tmpM.lookAt(world, tmpV2.copy(body.position).add(V3(0, 0.7, 0)), V3(0, 1, 0));
            tmpQ.setFromRotationMatrix(tmpM);
            free.quat.slerp(tmpQ, 1 - Math.exp(-10 * delta));
        } else {
            tmpE.set(free.pitch, free.yaw, 0, "YXZ");
            free.quat.setFromEuler(tmpE);
            if(parented) free.quat.premultiply(body.quaternion);
        }
        camera.position.copy(world);
        camera.quaternion.copy(free.quat);
        if(Math.abs(camera.fov - free.fov) > 0.01 || camera.near !== 0.3) {
            camera.fov = free.fov;
            camera.near = 0.3;
            camera.updateProjectionMatrix();
        }
    }

    // the mouse: click the scene and it looks around like a first person view (Escape lets go of the mouse)
    document.addEventListener("mousedown", function(event) {
        if(!api.active || !free.active || free.aim) return;
        if(typeof renderer === "undefined" || event.target !== renderer.domElement) return;
        if(renderer.domElement.requestPointerLock) renderer.domElement.requestPointerLock();
    });
    document.addEventListener("pointerlockchange", function() { pointerLocked = !!document.pointerLockElement; });
    document.addEventListener("mousemove", function(event) {
        if(!api.active || !free.active || free.aim || !pointerLocked) return;
        free.yawT -= event.movementX * LOOK_SENSITIVITY;
        free.pitchT = Math.max(-1.5, Math.min(1.5, free.pitchT - event.movementY * LOOK_SENSITIVITY));
    });
    // a finger on the scene looks around too
    var touchLast = null;
    document.addEventListener("touchstart", function(event) { touchLast = event.touches.length === 1 && typeof renderer !== "undefined" && event.target === renderer.domElement ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null; }, { passive: true });
    document.addEventListener("touchmove", function(event) {
        if(!touchLast || !api.active || !free.active || free.aim || event.touches.length !== 1) return;
        var touch = event.touches[0];
        free.yawT -= (touch.clientX - touchLast.x) * LOOK_SENSITIVITY * 1.6;
        free.pitchT = Math.max(-1.5, Math.min(1.5, free.pitchT - (touch.clientY - touchLast.y) * LOOK_SENSITIVITY * 1.6));
        touchLast = { x: touch.clientX, y: touch.clientY };
    }, { passive: true });
    window.addEventListener("keyup", function(event) { keys[event.code] = false; }, true);
    window.addEventListener("blur", function() { keys = {}; });

    var cameraButtons = null, freeRow = null, freeInfo = null;
    function updateCameraUi() {
        if(!ui || !cameraButtons) return;
        var mode = Settings.option("camera");
        cameraButtons.forEach(function(b, i) { b.className = (i === 3 ? free.active : (!free.active && mode === i + 1)) ? "on" : ""; });
        freeRow.style.display = free.active ? "flex" : "none";
        if(free.active) {
            freeInfo.aim.className = free.aim ? "on" : "";
            freeInfo.parent.className = free.parent ? "on" : "";
            var entry = cars[Math.min(free.target, cars.length - 1)];
            freeInfo.target.textContent = "Car: " + (entry ? String(entry.object.name || entry.object.config.name || entry.object.config.id).slice(0, 30) : "");
            freeInfo.target.style.display = cars.length > 1 ? "" : "none";
        }
    }
    Settings.onOptionChange(function(name) { if(name === "camera" && api.active) { if(free.active) leaveFree(); else updateCameraUi(); } });

    // ---- start and stop

    api.start = function() {
        if(api.active || (!api.viewer && !api.available())) return false;
        snapshot = cars.map(function(entry, i) { var s = new Float32Array(STRIDE); write(s, 0, entry); return s; });
        api.active = true;
        document.body.classList.add("replaying");
        t = api.end_time();
        playing = false;
        direction = 1;
        scrubbing = false;
        player = null;
        build();
        if(typeof EngineSound !== "undefined") EngineSound.setPaused(true);
        return true;
    };

    api.stop = function() {
        if(!api.active) return;
        // a replay from a file has no game behind it: back to the main menu
        if(api.viewer) { window.location.href = window.location.pathname; return; }
        api.active = false;
        // the cars are put back where the game left them
        for(var i = 0; i < cars.length; i++) {
            var entry = cars[i];
            read(snapshot[i], 0, entry);
            entry.object.vehicle.updateOutputs();
            if(entry.player) entry.object.updateVisuals(0); else entry.object.updateVisuals();
        }
        snapshot = null;
        leaveFree();
        if(ui) { ui.bar.remove(); ui.info.remove(); ui = null; }
        document.body.classList.remove("replaying");
        if(typeof lastFrameTime !== "undefined") lastFrameTime = performance.now();
    };

    // Once per frame while the replay is open, with the real time of the frame
    api.frame = function(delta) {
        if(!api.active) return;
        if(playing && !scrubbing) {
            t += direction * speed * delta;
            if(t >= api.end_time()) { t = api.end_time(); if(direction > 0) { playing = false; ui.sync(); } }
            if(t <= api.start_time()) { t = api.start_time(); if(direction < 0) { playing = false; ui.sync(); } }
        }
        show(t, delta);
        if(free.active) updateFree(delta);
        if(typeof EngineSound !== "undefined" && player) {
            var live = playing && !scrubbing && direction > 0;
            EngineSound.setPaused(!live);
            if(live) EngineSound.update(player.rpm, player.throttle, false);
        }
        updateUi();
    };

    // ---- a file: save and open

    var MAGIC = [0x4f, 0x52, 0x52, 0x50];          // "ORRP"
    var FORMAT = "openracer-replay", FILE_VERSION = 1;
    var MAX_FILE = 300 * 1024 * 1024, MAX_CARS = 12, MAX_SAMPLES = 108000;   // an hour
    var ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;

    function pack() {
        var per = perSample(), n = total - first();
        var data = new Float32Array(n * per);
        var pos = 0;
        for(var c = 0; c < chunks.length; c++) {
            var count = c === chunks.length - 1 ? fill : CHUNK;
            data.set(chunks[c].subarray(0, count * per), pos);
            pos += count * per;
        }
        var header = {
            format: FORMAT, version: FILE_VERSION, game: (OpenRacer.VERSION || ""), created: new Date().toISOString(),
            rate: RATE, stride: STRIDE, samples: n,
            track: { id: currentTrack.id, name: currentTrack.name || currentTrack.id },
            cars: cars.map(function(entry) {
                var o = entry.object;
                return { id: o.config.id, name: String(o.name || o.config.name || o.config.id), color: typeof o.color === "number" ? o.color : null, player: entry.player };
            }),
            gears: gearLabels
        };
        var text = new TextEncoder().encode(JSON.stringify(header));
        var padded = Math.ceil((text.length + 8) / 4) * 4 - 8;      // the numbers start on a multiple of four
        var out = new Uint8Array(8 + padded + data.byteLength);
        out.set(MAGIC, 0);
        new DataView(out.buffer).setUint32(4, padded, true);
        out.fill(0x20, 8, 8 + padded);
        out.set(text, 8);
        out.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), 8 + padded);
        return out;
    }

    function gzip(bytes) {
        if(typeof CompressionStream === "undefined") return Promise.resolve(bytes);
        var stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
        return new Response(stream).arrayBuffer().then(function(buffer) { return new Uint8Array(buffer); });
    }

    function gunzip(bytes) {
        if(typeof DecompressionStream === "undefined") return Promise.reject(new Error("This browser cannot open a compressed replay. Use a recent Chrome, Edge, Safari or Firefox."));
        var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
        return new Response(stream).arrayBuffer().then(function(buffer) { return new Uint8Array(buffer); }, function() { throw new Error("This replay file is damaged."); });
    }

    // Saves the recording as a file for the user to keep or to share; gives a promise of { name, bytes }
    api.save = function() {
        if(!cars.length || total < 2) return Promise.reject(new Error("Nothing is recorded yet."));
        var raw = pack();
        return gzip(raw).then(function(bytes) {
            var stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 13);
            var name = "replay-" + String(currentTrack.id).replace(/[^A-Za-z0-9_-]/g, "") + "-" + stamp + ".openracer-replay";
            var url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
            var link = document.createElement("a");
            link.href = url;
            link.download = name;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(function() { URL.revokeObjectURL(url); }, 30000);
            return { name: name, bytes: bytes.length };
        });
    };

    // What is in a file, checked: { header, data } or an error with a message for the person
    function parse(buffer) {
        var bytes = new Uint8Array(buffer);
        if(bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return gunzip(bytes).then(unpack);
        return Promise.resolve(unpack(bytes));
    }

    function unpack(bytes) {
        var bad = function(text) { return new Error(text); };
        if(bytes.length < 16 || MAGIC.some(function(b, i) { return bytes[i] !== b; })) throw bad("This is not an OpenRacer replay.");
        var headerLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
        if(headerLength > 1048576 || 8 + headerLength > bytes.length) throw bad("This replay file is damaged.");
        var header;
        try { header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + headerLength))); } catch(e) { throw bad("This replay file is damaged."); }
        if(!header || header.format !== FORMAT) throw bad("This is not an OpenRacer replay.");
        if(header.version !== FILE_VERSION || header.stride !== STRIDE || header.rate !== RATE) throw bad("This replay was made with another version of OpenRacer (" + String(header.game || "?").slice(0, 20) + ") and cannot be opened by this one.");
        if(!header.track || !ID_PATTERN.test(String(header.track.id)) || !Array.isArray(header.cars) || header.cars.length < 1 || header.cars.length > MAX_CARS) throw bad("This replay file is damaged.");
        for(var i = 0; i < header.cars.length; i++) {
            var c = header.cars[i];
            if(!c || typeof c.id !== "string" || !ID_PATTERN.test(c.id)) throw bad("This replay file is damaged.");
            c.name = String(c.name || c.id).slice(0, 80);
            c.color = typeof c.color === "number" && c.color >= 0 && c.color <= 0xffffff ? c.color : null;
        }
        if(!header.cars[0].player) throw bad("This replay file is damaged.");
        var samples = header.samples;
        if(!(samples >= 2 && samples <= MAX_SAMPLES && samples === Math.floor(samples))) throw bad("This replay file is damaged.");
        var start = 8 + headerLength;
        var wanted = samples * header.cars.length * STRIDE * 4;
        if(start % 4 !== 0 || bytes.length - start !== wanted) throw bad("This replay file is damaged.");
        var data = new Float32Array(bytes.buffer.slice(bytes.byteOffset + start, bytes.byteOffset + start + wanted));
        for(var k = 0; k < data.length; k++) if(!isFinite(data[k])) throw bad("This replay file is damaged.");
        header.gears = Array.isArray(header.gears) ? header.gears.map(function(g) { return String(g).slice(0, 8); }) : [""];
        return { header: header, data: data };
    }

    // From the main menu: reads a file, checks that this game has the track and the cars, keeps it for the game that is started to show it.
    // Gives a promise of { car, track } (the ids that the address of the game needs), or fails with a message
    api.openFile = function(file, carList, trackList) {
        if(file.size > MAX_FILE) return Promise.reject(new Error("This file is too large to be a replay."));
        return file.arrayBuffer().then(parse).then(function(parsed) {
            var h = parsed.header;
            var has = function(list, id) { return list.some(function(item) { return item.id === id; }); };
            var missingCars = h.cars.filter(function(c) { return !has(carList, c.id); });
            var missingTrack = !has(trackList, h.track.id);
            if(missingCars.length || missingTrack) {
                var parts = [];
                if(missingTrack) parts.push("the track " + String(h.track.name).slice(0, 60) + " (" + h.track.id + ")");
                var seen = {};
                missingCars.forEach(function(c) { if(!seen[c.id]) { seen[c.id] = true; parts.push("the car " + c.name + " (" + c.id + ")"); } });
                throw new Error("This replay needs " + parts.join(", ") + ", which this game does not have. Ask the sender for them as a zip and import it in My garage.");
            }
            return stash(parsed).then(function() { return { car: h.cars[0].id, track: h.track.id }; });
        });
    };

    // The file waits in the database of the browser, because the game that shows it is a new page
    function database() {
        return new Promise(function(resolve, reject) {
            var request = indexedDB.open("openracer-replay", 1);
            request.onupgradeneeded = function() { request.result.createObjectStore("files"); };
            request.onsuccess = function() { resolve(request.result); };
            request.onerror = function() { reject(request.error); };
        });
    }
    function stash(parsed) {
        return database().then(function(db) {
            return new Promise(function(resolve, reject) {
                var tx = db.transaction("files", "readwrite");
                tx.objectStore("files").put(parsed, "pending");
                tx.oncomplete = function() { db.close(); resolve(); };
                tx.onerror = function() { reject(tx.error); };
            });
        });
    }
    // The file that was kept for this game (once): { header, data } or null
    api.takeStash = function() {
        return database().then(function(db) {
            return new Promise(function(resolve, reject) {
                var tx = db.transaction("files", "readwrite");
                var get = tx.objectStore("files").get("pending");
                tx.objectStore("files").delete("pending");
                tx.oncomplete = function() { db.close(); resolve(get.result || null); };
                tx.onerror = function() { reject(tx.error); };
            });
        });
    };

    // Puts a file in place of the recording: the cars (the player's first, then the others as the file has them)
    api.load = function(parsed, objects) {
        var per = objects.length * STRIDE, n = parsed.header.samples;
        cars = objects.map(function(object, i) { return { object: object, player: i === 0 }; });
        gearLabels = parsed.header.gears;
        chunks = [];
        for(var s = 0; s < n; s += CHUNK) {
            var count = Math.min(CHUNK, n - s);
            chunks.push(parsed.data.subarray(s * per, (s + count) * per));
            fill = count;
        }
        dropped = 0;
        total = n;
        api.viewer = true;
    };

    api.info = function() { return { seconds: total * DT, cars: cars.length, blocks: chunks.length, megabytes: chunks.length * CHUNK * perSample() * 4 / 1048576 }; };
    api.speeds = SPEEDS;

    return api;
})();
