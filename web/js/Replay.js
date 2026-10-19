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
 *              Keys in the replay: Space pause/play, left and right arrow 5 seconds back and forward, Home and End the start and the end,
 *              T the camera.
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

    var api = { active: false };

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
        if(api.active) return;
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
            "#replayInfo { position: fixed; left: 16px; top: 14px; z-index: 1400; padding: 8px 12px; background: rgba(14, 18, 24, 0.78); color: #fff; " +
                "border-radius: 10px; font-family: Arial, sans-serif; font-size: 15px; font-variant-numeric: tabular-nums; pointer-events: none; }" +
            "#replayInfo b { font-size: 22px; }" +
            "@media (max-width: 600px) { #replayBar { bottom: 6px; padding: 8px 8px 10px; } #replayBar button { padding: 6px 8px; min-width: 34px; } }" +
            // a phone on its side: a lower bar, so that the car stays in view
            "@media (max-height: 480px) { #replayBar { bottom: 4px; padding: 5px 10px 6px; } #replayBar .head { margin-bottom: 0; } #replayBar input[type=range] { height: 18px; margin: 2px 0 4px; } " +
                "#replayBar button { padding: 4px 8px; font-size: 12px; min-width: 30px; } #replayBar .row { gap: 5px; } #replayBar .speeds span { display: none; } #replayInfo { top: 6px; left: 8px; font-size: 13px; padding: 5px 9px; } #replayInfo b { font-size: 17px; } }";
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
        var exit = button(head, "Back to the game", "Escape", function() { api.stop(); });
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

        function sync() {
            rewind.className = playing && direction < 0 ? "on" : "";
            play.className = playing && direction > 0 ? "on" : "";
            pause.className = !playing ? "on" : "";
            speedButtons.forEach(function(b, i) { b.className = SPEEDS[i] === speed ? "on" : ""; });
        }
        var info = el(document.body, "div");
        info.id = "replayInfo";
        ui = { bar: bar, info: info, slider: slider, timeLabel: timeLabel, sync: sync };
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
        if(event.code === "Space") {
            if(target && target.tagName === "BUTTON") return;   // the space bar presses a button that has the focus
            event.preventDefault();
            playing = !playing;
            if(playing && direction > 0 && t >= api.end_time() - 0.01) t = api.start_time();
            ui.sync();
        } else if(event.code === "ArrowLeft" && !(target && target.tagName === "INPUT")) { jump(-5); event.preventDefault(); }
        else if(event.code === "ArrowRight" && !(target && target.tagName === "INPUT")) { jump(5); event.preventDefault(); }
        else if(event.code === "Home") { jump(-1e9); event.preventDefault(); }
        else if(event.code === "End") { jump(1e9); event.preventDefault(); }
    }
    window.addEventListener("keydown", onKey, true);

    // ---- start and stop

    api.start = function() {
        if(api.active || !api.available()) return false;
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
        api.active = false;
        // the cars are put back where the game left them
        for(var i = 0; i < cars.length; i++) {
            var entry = cars[i];
            read(snapshot[i], 0, entry);
            entry.object.vehicle.updateOutputs();
            if(entry.player) entry.object.updateVisuals(0); else entry.object.updateVisuals();
        }
        snapshot = null;
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
        if(typeof EngineSound !== "undefined" && player) {
            var live = playing && !scrubbing && direction > 0;
            EngineSound.setPaused(!live);
            if(live) EngineSound.update(player.rpm, player.throttle, false);
        }
        updateUi();
    };

    api.info = function() { return { seconds: total * DT, cars: cars.length, blocks: chunks.length, megabytes: chunks.length * CHUNK * perSample() * 4 / 1048576 }; };
    api.speeds = SPEEDS;

    return api;
})();
