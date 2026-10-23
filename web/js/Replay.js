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
 *              A replay can be saved as a file (Save replay in the bar) and opened by someone else (Replays in the main menu): the
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
 *              Home and End the start and the end, T the camera, H hides the bar, the speed box and the debug text, and shows them again.
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
        object.throttle = array[offset + P.throttle]; object.brakePedal = array[offset + P.brake];      // (the driver model works the pedals)
        for(var k = 0; k < 4; k++) {
            var w = v.wheels[k], o = offset + FIELDS + k * WHEEL_FIELDS;
            w.center.x = array[o]; w.center.y = array[o + 1]; w.center.z = array[o + 2];
            w.spin = array[o + 3];
            w.visualLength = array[o + 4];
        }
    }

    // ---- the soft body: the shell, the loose parts and the wheels that are bent or torn off (SOFTBODY.md, M4)
    //
    // A car with a soft body keeps a list of records next to the samples, and a record is only made when something in it has changed (the shell
    // moves, a part opens or flies, a wheel bends): a car that drives without a hit makes none. A record holds the displacements of the nodes of the
    // shell (whole millimetres, 16 bits), for every part its state and where it is, and for every wheel whether it is off and how it is bent.
    var SOFT_SCALE = 1024, PART_FLOATS = 11, WHEEL_FLOATS = 5 * 4;
    var MAX_SOFT_NODES = 400, MAX_SOFT_PARTS = 64;

    function softOf(entry) {
        var v = entry.object.vehicle, sb = v && v.softBody;
        if(!sb) return null;
        if(!entry.soft) entry.soft = { nodes: sb.bodyCount || sb.count, names: [], records: [], version: -1, disp: null };
        return entry.soft;
    }
    function sameArray(a, b) {
        if(!a || !b || a.length !== b.length) return false;
        for(var i = 0; i < a.length; i++) if(a[i] !== b[i]) return false;
        return true;
    }
    function fine(x) { return Math.round((x || 0) * 2000) / 2000; }        // half a millimetre, or a hundredth of a degree: the bend of a wheel that is at rest moves less than that
    function wheelFloats(v, out) {
        for(var k = 0; k < 4; k++) {
            var w = v.wheels[k];
            out[5 * k] = v.wheelLost && v.wheelLost[k] ? 1 : 0; out[5 * k + 1] = fine(w.toeBend); out[5 * k + 2] = fine(w.camberBend); out[5 * k + 3] = fine(w.shiftX); out[5 * k + 4] = fine(w.shiftZ);
        }
        return out;
    }
    function recordSoft(entry, index) {
        var soft = softOf(entry);
        if(!soft) return;
        var object = entry.object, v = object.vehicle, sb = v.softBody, last = soft.records[soft.records.length - 1];
        var disp = soft.disp;
        if(sb.version !== soft.version || !disp) {
            soft.version = sb.version;
            var fresh = new Int16Array(3 * soft.nodes);
            for(var i = 0; i < fresh.length; i++) fresh[i] = Math.max(-32767, Math.min(32767, Math.round(sb.displacement[i] * SOFT_SCALE)));
            disp = soft.disp = sameArray(fresh, disp) ? disp : fresh;
        }
        var partList = object.parts && object.parts.replay;
        var partData = new Float32Array(partList ? object.parts.parts.length * PART_FLOATS : 0);
        if(partList) { partList.replayRecord(partData); soft.names = partList.names(); }
        var wheels = wheelFloats(v, new Float32Array(WHEEL_FLOATS));
        if(last && last.disp === disp && sameArray(last.parts, partData) && sameArray(last.wheels, wheels)) return;
        soft.records.push({ index: index, disp: disp, parts: partData, wheels: wheels });
    }
    function trimSoft() {
        var from = first();
        cars.forEach(function(entry) {
            var r = entry.soft && entry.soft.records;
            while(r && r.length > 1 && r[1].index <= from) r.shift();
        });
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
            if(chunks.length * CHUNK > MAX_SECONDS * RATE) { chunks.shift(); dropped++; trimSoft(); trimEffects(); }
        }
        var chunk = chunks[chunks.length - 1];
        var base = fill * perSample();
        for(var i = 0; i < cars.length; i++) { write(chunk, base + i * STRIDE, cars[i]); recordSoft(cars[i], total); }
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

    // ---- smoke and marbles
    //
    // They are not drawn from the samples: Smoke.js and Marbles.js tell the replay (a recorder) about every puff and every marble as it is made, with
    // the time, and the marbles also where they come to rest. In the replay the same code moves them again: forward in small steps from what was
    // recorded, and for a jump or a way back they are made as they were at that time (the smoke from the last seconds, the marbles from the whole
    // recording, where what had come to rest by then lies where it came to rest). The ones of the game are kept at the start and put back at the end.
    var effects = {};                  // name -> { object, rows, base, cursor, snapshot }
    var effectTime = null, effectBuilt = 0;
    var EFFECT_STEP = 1 / 30;

    function now() { return Math.max(0, total - 1) * DT + accumulated; }

    api.attach = function(name, object) {
        var e = effects[name] = { object: object, rows: [], base: 0, cursor: 0, snapshot: null };
        object.recorder = function(row) {
            if(api.active || api.viewer || !cars.length) return -1;
            row[0] = now();
            e.rows.push(row);
            return e.base + e.rows.length - 1;
        };
        if(name === "marbles") object.restRecorder = function(id, x, y, z, lost) {
            var row = e.rows[id - e.base];
            if(row) { row[11] = now(); row[12] = x; row[13] = y; row[14] = z; row[15] = lost ? 1 : 0; }
        };
    };

    // what is older than the recording is not needed
    function trimEffects() {
        var from = api.start_time();
        for(var name in effects) {
            var e = effects[name], k = 0;
            while(k < e.rows.length && e.rows[k][0] < from) k++;
            if(k) { e.rows.splice(0, k); e.base += k; }
        }
    }

    // the index of the first row that is later than a time
    function firstAfter(rows, time) {
        var lo = 0, hi = rows.length;
        while(lo < hi) { var mid = (lo + hi) >> 1; if(rows[mid][0] <= time) lo = mid + 1; else hi = mid; }
        return lo;
    }

    // moves the effects of one kind from one time to a later one, in small steps, making what was recorded in between
    function advanceEffect(e, from, to, vehicle) {
        for(var a = from; a < to - 1e-9;) {
            var b = Math.min(to, a + EFFECT_STEP);
            while(e.cursor < e.rows.length && e.rows[e.cursor][0] <= b) e.object.replayAdd(e.rows[e.cursor++]);
            e.object.replayStep(b - a, vehicle);
            a = b;
        }
    }

    function buildEffects(time, vehicle) {
        for(var name in effects) {
            var e = effects[name];
            if(e.object.replayRebuild) {
                var end = firstAfter(e.rows, time);
                e.object.replayRebuild(e.rows, end, time, vehicle);
                e.cursor = end;
            } else {
                e.object.replayClear();
                var start = Math.max(api.start_time(), time - e.object.replayLookback);
                e.cursor = firstAfter(e.rows, start);
                var step = 1 / 20;
                for(var a = start; a < time - 1e-9;) {
                    var b = Math.min(time, a + step);
                    while(e.cursor < e.rows.length && e.rows[e.cursor][0] <= b) e.object.replayAdd(e.rows[e.cursor++]);
                    e.object.replayStep(b - a, vehicle);
                    a = b;
                }
            }
        }
    }

    // once per frame of the replay: the effects go to the time of the replay
    function showEffects(time) {
        if(!cars.length) return;
        var vehicle = cars[0].object.vehicle;
        if(effectTime !== null && time >= effectTime && time - effectTime <= 0.25) {
            if(time > effectTime) for(var name in effects) advanceEffect(effects[name], effectTime, time, vehicle);
            effectTime = time;
            return;
        }
        var real = performance.now();
        if(effectTime !== null && real - effectBuilt < 80) return;       // a way back or a slider that is dragged: not more than ten times a second
        effectBuilt = real;
        buildEffects(time, vehicle);
        effectTime = time;
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

    // The record of the soft body at a time, and the one after it when it is near (a hit is a few samples long: between those the shell is
    // interpolated, but a part that is thrown off stays where it was until the next record is a sample away)
    function softAt(soft, position) {
        var r = soft.records, lo = 0, hi = r.length - 1;
        if(!r.length) return null;
        while(lo < hi) { var mid = (lo + hi + 1) >> 1; if(r[mid].index <= position) lo = mid; else hi = mid - 1; }
        return lo;
    }
    var mixParts = null, mixDisp = null;
    function showSoft(entry, time) {
        var soft = entry.soft, object = entry.object, v = object.vehicle, sb = v.softBody;
        if(!soft || soft.broken || !sb || (sb.bodyCount || sb.count) !== soft.nodes) return;
        var partList = object.parts && object.parts.replay;
        if(partList && partList.names().join("|") !== soft.names.join("|") && soft.names.length) return;      // not the car that it was made with
        var position = Math.max(first(), Math.min(last(), time / DT));
        var i = softAt(soft, position);
        if(i === null) return;
        var rec = soft.records[i], next = soft.records[i + 1];
        var f = next && next.index - rec.index <= 2 ? Math.max(0, Math.min(1, (position - rec.index) / (next.index - rec.index))) : 0;
        if(f === 0) next = null;
        // the shell
        var n = 3 * soft.nodes;
        if(!mixDisp || mixDisp.length < n) mixDisp = new Float32Array(n);
        for(var k = 0; k < n; k++) mixDisp[k] = (next ? rec.disp[k] + (next.disp[k] - rec.disp[k]) * f : rec.disp[k]) / SOFT_SCALE;
        var shown = soft.shown;
        if(!shown || shown.rec !== rec || shown.f !== f) {
            sb.displacement.set(mixDisp.subarray(0, n));
            sb.version++;
            soft.shown = { rec: rec, f: f };
        }
        // the parts
        if(partList && rec.parts.length === partList.names().length * PART_FLOATS) {
            var np = rec.parts.length;
            if(!mixParts || mixParts.length < np) mixParts = new Float32Array(np);
            for(var p = 0; p < np; p += PART_FLOATS) {
                var code = rec.parts[p];
                var both = next && next.parts.length === np && next.parts[p] === code && code;
                for(var q = 0; q < PART_FLOATS; q++) mixParts[p + q] = both ? rec.parts[p + q] + (next.parts[p + q] - rec.parts[p + q]) * f : rec.parts[p + q];
                if(both) {
                    // the turn: along the shortest way, then made one again
                    var dot = rec.parts[p + 4] * next.parts[p + 4] + rec.parts[p + 5] * next.parts[p + 5] + rec.parts[p + 6] * next.parts[p + 6] + rec.parts[p + 7] * next.parts[p + 7];
                    if(dot < 0) for(var d = 4; d < 8; d++) mixParts[p + d] = rec.parts[p + d] + (-next.parts[p + d] - rec.parts[p + d]) * f;
                    var len = Math.hypot(mixParts[p + 4], mixParts[p + 5], mixParts[p + 6], mixParts[p + 7]) || 1;
                    for(var e = 4; e < 8; e++) mixParts[p + e] /= len;
                }
            }
            partList.replayApply(mixParts, function(partIndex) { return frozenShell(soft, i, partIndex); });
        }
        // the wheels
        var w = rec.wheels;
        for(var k2 = 0; k2 < 4; k2++) {
            var wheel = v.wheels[k2];
            if(v.wheelLost) v.wheelLost[k2] = w[5 * k2] > 0.5;
            wheel.toeBend = w[5 * k2 + 1]; wheel.camberBend = w[5 * k2 + 2]; wheel.shiftX = w[5 * k2 + 3]; wheel.shiftZ = w[5 * k2 + 4];
        }
    }
    // the displacements of the shell at the moment that a part came off: the first record of the run in which it is not held
    function frozenShell(soft, index, partIndex) {
        var o = partIndex * PART_FLOATS, j = index;
        while(j > 0 && soft.records[j - 1].parts.length > o && soft.records[j - 1].parts[o] !== 0) j--;
        var disp = soft.records[j].disp, out = new Float32Array(disp.length);
        for(var k = 0; k < disp.length; k++) out[k] = disp[k] / SOFT_SCALE;
        return out;
    }

    function show(time, delta) {
        // the cameras of the game follow the car that was chosen (Tab, or the Car button)
        if(cars.length) cars[0].object.cameraSubject = free.target > 0 && free.target < cars.length ? cars[free.target].object : null;
        for(var i = 0; i < cars.length; i++) {
            var entry = cars[i], object = entry.object;
            interpolate(time, i, scratch);
            var visible = scratch[P.present] > 0.5;
            if(!visible) continue;
            read(scratch, 0, entry);
            if(object.parts && object.parts.replay) object.parts.replay.replayBegin();       // (a car that is built while the replay is open: its parts are made after it)
            if(entry.soft) showSoft(entry, time);
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
            "body.replayClean #replayInfo, body.replayClean #debugOut { display: none !important; }" +
            "body.replayFilming #replayBar { opacity: 0.4; }" +
            "body.replaying #hudBoost, body.replaying #dragHud, body.replaying #hud, body.replaying #hudLaps, body.replaying #hudCar, body.replaying #hudHint, body.replaying #touch, body.replaying #tuning { display: none !important; }" +
            "#replayBar { position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); width: min(960px, calc(100% - 20px)); z-index: 1400; box-sizing: border-box; " +
                "padding: 10px 14px 12px; background: rgba(24, 29, 35, 0.86); color: #fff; border: 1px solid rgba(255,255,255,0.14); border-radius: 12px; " +
                "font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; font-size: 14px; box-shadow: 0 10px 40px rgba(0,0,0,0.5); user-select: none; -webkit-user-select: none; touch-action: manipulation; }" +
            "#replayBar .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }" +
            "#replayBar .head { justify-content: space-between; margin-bottom: 6px; }" +
            "#replayBar .tag { font-weight: bold; letter-spacing: 3px; color: var(--accent); }" +
            "#replayBar .time { font-variant-numeric: tabular-nums; color: var(--head); }" +
            "#replayBar input[type=range] { width: 100%; margin: 4px 0 8px; accent-color: var(--accent); height: 26px; }" +
            "#replayBar button { font: inherit; color: #fff; background: var(--line); border: 1px solid rgba(255,255,255,0.16); border-radius: 8px; padding: 7px 12px; cursor: pointer; min-width: 40px; }" +
            "#replayBar button:hover { background: #343c47; }" +
            "#replayBar button.on { background: var(--accent); border-color: var(--accent); }" +
            "#replayBar .spacer { flex: 1; }" +
            "#replayBar .speeds { margin-left: auto; }" +
            "#replayBar .speeds span { color: var(--muted); margin-right: 2px; }" +
            "#replayBar .exit { background: var(--accent); border-color: var(--accent); }" +
            "#replayBar .cameras, #replayBar .freecam { margin-top: 8px; } #replayBar .label { color: var(--muted); min-width: 56px; } #replayBar .hint { color: var(--muted); font-size: 12px; }" +
            "#replayBar .freecam input[type=range] { width: 160px; margin: 0; height: 20px; }" +
            "#replayInfo { position: fixed; left: 16px; top: 14px; z-index: 1400; padding: 8px 12px; background: rgba(24, 29, 35, 0.78); color: #fff; " +
                "border-radius: 10px; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; font-size: 15px; font-variant-numeric: tabular-nums; pointer-events: none; }" +
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
        var save = button(right, "Save replay", "Keep the replay in Replays in the main menu (from there it can be downloaded as a file to share)", function() {
            save.textContent = "Saving…";
            api.saveToLibrary().then(function() {
                save.textContent = "Saved in Replays";
            }).catch(function(error) { save.textContent = "Could not save"; console.error(error); });
            setTimeout(function() { save.textContent = "Save replay"; }, 4000);
        });
        if(api.viewer) save.style.display = "none";            // (a replay that is already in the list)
        videoButton = button(right, "● Video", "Record the replay from the start to the end as a video (.webm)", function() { toggleVideo(); });
        if(typeof MediaRecorder === "undefined" || !document.createElement("canvas").captureStream) videoButton.style.display = "none";
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
        cameraButtons = [["Fixed", "The fixed camera behind the car"], ["Follow", "The camera that follows the car"], ["Cockpit", "In the car"], ["Free", "A camera that you move yourself"], ["Cinematic", "The cameras of the track: the one nearest to the car, which turns to follow it"]].map(function(c, i) {
            var b = button(cameraRow, c[0], c[1] + (i !== 3 ? "" : " (WASD or arrows, Shift and Control up and down, mouse look, [ and ] zoom)"), function() {
                if(i === 3) { leaveCine(); enterFree(); }
                else if(i === 4) { leaveFree(); enterCine(); }
                else { leaveFree(); leaveCine(); Settings.setOption("camera", i + 1); }
                updateCameraUi();
            });
            if(i === 4 && !cinemaCameras().length) b.style.display = "none";           // (a track without cameras of its own)
            return b;
        });
        // the cinematic camera: a zoom of your own on top of the field of view that it chooses itself
        cineRow = el(bar, "div", "row freecam");
        var cineLabel = el(cineRow, "span", "label", "Field of view ×" + cine.scale.toFixed(2));
        var cineSlider = el(cineRow, "input");
        cineSlider.type = "range"; cineSlider.min = "0.2"; cineSlider.max = "3"; cineSlider.step = "0.01"; cineSlider.value = String(cine.scale);
        cineSlider.title = "Zoom the cinematic camera: below 1 in, above 1 out ([ and ] too)";
        cineSlider.setAttribute("aria-label", "Field of view of the cinematic camera");
        cineSlider.addEventListener("input", function() { cine.scale = parseFloat(cineSlider.value); cineLabel.textContent = "Field of view ×" + cine.scale.toFixed(2); });
        cineSlider.addEventListener("keydown", function(e) { if(/^Arrow/.test(e.code)) e.stopPropagation(); });
        cineInfo = { label: cineLabel, slider: cineSlider };
        carButton = button(cameraRow, "Car", "The car that the camera follows (Tab)", function() { nextTarget(); });
        carButton.style.display = cars.length > 1 ? "" : "none";
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
        OpenRacer.Movable.make(bar, { key: "replaybar" });
        OpenRacer.Movable.make(info, { key: "replayinfo" });
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
        if(event.code === "Tab" && cars.length > 1) { nextTarget(); event.preventDefault(); return; }
        if(free.active) {
            // the keys of the free camera (the arrows move it, so they do not jump in time then)
            if(event.code === "KeyF" && !event.repeat) { toggleAim(); event.preventDefault(); return; }
            if(event.code === "KeyL" && !event.repeat) { toggleParent(); event.preventDefault(); return; }
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
        else if(event.code === "KeyH" && !event.repeat) { ui.bar.style.display = ui.bar.style.display === "none" ? "" : "none"; document.body.classList.toggle("replayClean", ui.bar.style.display === "none"); event.preventDefault(); }
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

    // ---- the cinematic camera: the cameras that the track editor put in the track. The camera whose range (a circle on the floor) the car is in is used, else the nearest one (it only goes to another when that is clearly better), it stays where it
    // is and only turns to follow the car, and its field of view is chosen so that the car is about the same size in the picture
    var cine = { active: false, index: -1, fov: 40, scale: 1, quat: new THREE.Quaternion() };
    var cineRow = null, cineInfo = null;
    function cinemaCameras() { return (typeof currentTrack !== "undefined" && currentTrack && Array.isArray(currentTrack.cameras)) ? currentTrack.cameras.filter(function(c) { return c && isFinite(c.x) && isFinite(c.y) && isFinite(c.z); }) : []; }
    function enterCine() {
        if(cine.active || !cinemaCameras().length) return;
        cine.active = true;
        cine.index = -1;
        updateCameraUi();
    }
    function leaveCine() {
        if(!cine.active) return;
        cine.active = false;
        updateCameraUi();
    }
    function updateCine(delta) {
        var list = cinemaCameras(), body = targetObject();
        if(!list.length || !body) return;
        delta = Math.min(delta, 0.1);
        var distance = function(c) { return Math.hypot(c.x - body.position.x, c.y - body.position.y, c.z - body.position.z); };
        // how well a camera suits: inside its range (a circle on the floor, the one that the track editor shows) from 0 at the middle to 1 at the edge, outside it more than 1 and more the farther
        // away it is from the circle; a camera without a range has a circle of nothing at its own place
        var score = function(c) {
            var r = c.range && c.range.r > 0 ? c.range : { x: c.x, z: c.z, r: 0 };
            var away = Math.hypot(body.position.x - r.x, body.position.z - r.z);
            return away < r.r ? away / r.r : 1 + (away - r.r);
        };
        var nearest = 0;
        list.forEach(function(c, i) { if(score(c) < score(list[nearest])) nearest = i; });
        var cut = false;
        if(cine.index < 0 || cine.index >= list.length) { cine.index = nearest; cut = true; }
        else if(nearest !== cine.index && score(list[nearest]) < score(list[cine.index]) * 0.85) { cine.index = nearest; cut = true; }      // (not at once: no flicker where two suit as well)
        var c = list[cine.index];
        camera.position.set(c.x, c.y, c.z);
        tmpM.lookAt(camera.position, tmpV2.copy(body.position).add(V3(0, 0.7, 0)), V3(0, 1, 0));
        tmpQ.setFromRotationMatrix(tmpM);
        if(cut) cine.quat.copy(tmpQ); else cine.quat.slerp(tmpQ, 1 - Math.exp(-8 * delta));
        camera.quaternion.copy(cine.quat);
        // your own zoom on top of it: [ narrows the field of view, ] widens it (or the slider)
        var zoom = (keys.BracketRight ? 1 : 0) - (keys.BracketLeft ? 1 : 0);
        if(zoom) {
            cine.scale = Math.max(0.2, Math.min(3, cine.scale * Math.exp(zoom * 0.9 * delta)));
            if(cineInfo) { cineInfo.slider.value = String(cine.scale); cineInfo.label.textContent = "Field of view ×" + cine.scale.toFixed(2); }
        }
        var wanted = Math.max(14, Math.min(60, 2 * Math.atan(9 / Math.max(5, distance(c))) * 180 / Math.PI)) * cine.scale;
        wanted = Math.max(3, Math.min(110, wanted));
        cine.fov = cut ? wanted : cine.fov + (wanted - cine.fov) * (1 - Math.exp(-4 * delta));
        if(Math.abs(camera.fov - cine.fov) > 0.01 || camera.near !== 0.3) {
            camera.fov = cine.fov;
            camera.near = 0.3;
            camera.updateProjectionMatrix();
        }
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

    var cameraButtons = null, freeRow = null, freeInfo = null, carButton = null, videoButton = null;

    // ---- a video of the replay: from the start to the end at normal speed, from the canvas of the game (without the bar and without sound), kept as a .webm
    var video = { recorder: null, chunks: [] };
    function toggleVideo() {
        if(video.recorder) { stopVideo(); return; }
        var canvas = typeof renderer !== "undefined" && renderer.domElement;
        if(!canvas || typeof MediaRecorder === "undefined") return;
        var types = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"];
        var type = types.filter(function(t) { return MediaRecorder.isTypeSupported(t); })[0];
        if(!type) { videoButton.textContent = "No video here"; setTimeout(function() { videoButton.textContent = "● Video"; }, 3000); return; }
        var stream = canvas.captureStream(60);
        video.chunks = [];
        video.recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8000000 });
        video.recorder.ondataavailable = function(e) { if(e.data && e.data.size) video.chunks.push(e.data); };
        video.recorder.onstop = function() {
            var blob = new Blob(video.chunks, { type: type.split(";")[0] });
            video.recorder = null; video.chunks = [];
            document.body.classList.remove("replayFilming");
            if(videoButton) videoButton.textContent = "● Video";
            if(!blob.size) return;
            var url = URL.createObjectURL(blob);
            var link = document.createElement("a");
            link.href = url;
            link.download = "openracer-" + String(currentTrack.id).replace(/[^A-Za-z0-9_-]/g, "") + "-" + new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 13) + (/mp4/.test(type) ? ".mp4" : ".webm");
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(function() { URL.revokeObjectURL(url); }, 30000);
        };
        // from the start, at normal speed
        t = api.start_time(); direction = 1; speed = 1; playing = true;
        if(ui) ui.sync();
        document.body.classList.add("replayFilming");
        videoButton.textContent = "■ Stop (recording)";
        video.recorder.start(250);
    }
    function stopVideo() {
        if(video.recorder && video.recorder.state !== "inactive") video.recorder.stop();
    }
    function updateCameraUi() {
        if(!ui || !cameraButtons) return;
        var mode = Settings.option("camera");
        cameraButtons.forEach(function(b, i) { b.className = (i === 3 ? free.active : i === 4 ? cine.active : (!free.active && !cine.active && mode === i + 1)) ? "on" : ""; });
        freeRow.style.display = free.active ? "flex" : "none";
        if(cineRow) cineRow.style.display = cine.active ? "flex" : "none";
        if(carButton) { var chosen = cars[Math.min(free.target, cars.length - 1)]; carButton.textContent = "Car: " + (chosen ? String(chosen.object.name || chosen.object.config.name || chosen.object.config.id).slice(0, 24) : ""); }
        if(free.active) {
            freeInfo.aim.className = free.aim ? "on" : "";
            freeInfo.parent.className = free.parent ? "on" : "";
            var entry = cars[Math.min(free.target, cars.length - 1)];
            freeInfo.target.textContent = "Car: " + (entry ? String(entry.object.name || entry.object.config.name || entry.object.config.id).slice(0, 30) : "");
            freeInfo.target.style.display = cars.length > 1 ? "" : "none";
        }
    }
    Settings.onOptionChange(function(name) { if(name === "camera" && api.active) { if(cine.active) leaveCine(); if(free.active) leaveFree(); else updateCameraUi(); } });

    // ---- start and stop

    // is the camera one of the replay's own (the free or the cinematic one): outside the car
    Object.defineProperty(api, "ownCamera", { get: function() { return free.active || cine.active; } });

    api.start = function() {
        if(api.active || (!api.viewer && !api.available())) return false;
        if(Settings.option("camera") === 4) Settings.setOption("camera", 1);      // the free camera of the game has no place in a replay, which has its own
        snapshot = cars.map(function(entry, i) { var s = new Float32Array(STRIDE); write(s, 0, entry); return s; });
        cars.forEach(function(entry) {
            var v = entry.object.vehicle;
            if(entry.soft && v.softBody) { entry.live = { wheels: wheelFloats(v, new Float32Array(WHEEL_FLOATS)) }; entry.soft.shown = null; }
            if(entry.object.parts && entry.object.parts.replay) entry.object.parts.replay.replayBegin();
        });
        for(var name in effects) {
            var e = effects[name];
            e.snapshot = api.viewer ? null : e.object.replaySnapshot();
            e.cursor = firstAfter(e.rows, api.start_time());
        }
        effectTime = api.viewer ? null : api.start_time();
        api.active = true;
        document.body.classList.add("replaying");
        t = api.start_time();                 // a replay begins at the beginning, wound all the way back
        playing = !!api.viewer;               // (one that was opened from the list plays at once)
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
        if(cars.length) cars[0].object.cameraSubject = null;
        // the cars are put back where the game left them
        for(var i = 0; i < cars.length; i++) {
            var entry = cars[i];
            read(snapshot[i], 0, entry);
            entry.object.vehicle.updateOutputs();
            if(entry.player) entry.object.updateVisuals(0); else entry.object.updateVisuals();
        }
        snapshot = null;
        for(var name in effects) { if(effects[name].snapshot) effects[name].object.replayRestore(effects[name].snapshot); effects[name].snapshot = null; }
        cars.forEach(function(entry) {
            var v = entry.object.vehicle;
            if(entry.object.parts && entry.object.parts.replay) entry.object.parts.replay.replayEnd();
            if(entry.live && v.softBody) {
                v.softBody.syncDisplacement();
                var w = entry.live.wheels;
                for(var k = 0; k < 4; k++) { if(v.wheelLost) v.wheelLost[k] = w[5 * k] > 0.5; v.wheels[k].toeBend = w[5 * k + 1]; v.wheels[k].camberBend = w[5 * k + 2]; v.wheels[k].shiftX = w[5 * k + 3]; v.wheels[k].shiftZ = w[5 * k + 4]; }
                entry.live = null;
            }
        });
        stopVideo();
        leaveFree();
        leaveCine();
        if(ui) { ui.bar.remove(); ui.info.remove(); ui = null; }
        document.body.classList.remove("replaying", "replayClean");
        if(typeof lastFrameTime !== "undefined") lastFrameTime = performance.now();
    };

    // To a time of the recording (seconds), for the tests
    api.seek = function(seconds) { t = Math.max(api.start_time(), Math.min(api.end_time(), seconds)); };

    // Once per frame while the replay is open, with the real time of the frame
    api.frame = function(delta) {
        if(!api.active) return;
        if(playing && !scrubbing) {
            t += direction * speed * delta;
            if(t >= api.end_time()) { t = api.end_time(); if(direction > 0) { playing = false; ui.sync(); } }
            if(t <= api.start_time()) { t = api.start_time(); if(direction < 0) { playing = false; ui.sync(); } }
        }
        show(t, delta);
        showEffects(t);
        if(video.recorder && (!playing || t >= api.end_time() - 0.02)) stopVideo();      // (the end, or a pause: the video is done)
        if(free.active) updateFree(delta);
        else if(cine.active) updateCine(delta);
        if(typeof EngineSound !== "undefined" && player) {
            var live = playing && !scrubbing && direction > 0;
            EngineSound.setPaused(!live);
            if(live) EngineSound.update(player.rpm, player.throttle, false);
        }
        updateUi();
    };

    // ---- a file: save and open

    var MAGIC = [0x4f, 0x52, 0x52, 0x50];          // "ORRP"
    var FORMAT = "openracer-replay", FILE_VERSION = 2;       // 2: the soft body (a block of records after the numbers); 1 files have none and can still be opened
    var MAX_FILE = 300 * 1024 * 1024, MAX_CARS = 12, MAX_SAMPLES = 108000;   // an hour
    var ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;

    // the bytes of a record: the sample (4), the displacements (16 bits each, to a multiple of four bytes), the parts and the wheels (32 bits each)
    function recordSize(info) { return 4 + Math.ceil(info.nodes * 3 * 2 / 4) * 4 + info.parts.length * PART_FLOATS * 4 + WHEEL_FLOATS * 4; }

    function pack() {
        var per = perSample(), n = total - first();
        var data = new Float32Array(n * per);
        var pos = 0;
        for(var c = 0; c < chunks.length; c++) {
            var count = c === chunks.length - 1 ? fill : CHUNK;
            data.set(chunks[c].subarray(0, count * per), pos);
            pos += count * per;
        }
        // the soft body: per car the records that are still inside the recording, as a block of bytes after the numbers
        var base = first();
        var softInfo = cars.map(function(entry) {
            var soft = entry.soft;
            if(!soft || !soft.records.length) return null;
            return { nodes: soft.nodes, parts: soft.names.slice(0, MAX_SOFT_PARTS), count: soft.records.length };
        });
        var softBytes = 0, sizes = softInfo.map(function(info) { if(!info) return 0; var size = recordSize(info); softBytes += size * info.count; return size; });
        var softBlob = new Uint8Array(softBytes), view = new DataView(softBlob.buffer), at = 0;
        cars.forEach(function(entry, c) {
            var info = softInfo[c];
            if(!info) return;
            entry.soft.records.forEach(function(rec) {
                view.setUint32(at, Math.max(0, rec.index - base), true);
                for(var i = 0; i < rec.disp.length; i++) view.setInt16(at + 4 + 2 * i, rec.disp[i], true);
                var o = at + 4 + Math.ceil(rec.disp.length * 2 / 4) * 4;
                for(var j = 0; j < info.parts.length * PART_FLOATS; j++) view.setFloat32(o + 4 * j, j < rec.parts.length ? rec.parts[j] : 0, true);
                o += info.parts.length * PART_FLOATS * 4;
                for(var k = 0; k < WHEEL_FLOATS; k++) view.setFloat32(o + 4 * k, rec.wheels[k], true);
                at += sizes[c];
            });
        });
        var header = {
            format: FORMAT, version: FILE_VERSION, game: (OpenRacer.VERSION || ""), created: new Date().toISOString(),
            soft: softInfo, softBytes: softBytes,
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
        var out = new Uint8Array(8 + padded + data.byteLength + softBytes);
        out.set(MAGIC, 0);
        new DataView(out.buffer).setUint32(4, padded, true);
        out.fill(0x20, 8, 8 + padded);
        out.set(text, 8);
        out.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), 8 + padded);
        out.set(softBlob, 8 + padded + data.byteLength);
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
        if((header.version !== FILE_VERSION && header.version !== 1) || header.stride !== STRIDE || header.rate !== RATE) throw bad("This replay was made with another version of OpenRacer (" + String(header.game || "?").slice(0, 20) + ") and cannot be opened by this one.");
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
        // the soft body (version 2): per car nothing or { nodes, parts: [names], count }, and the records in a block after the numbers
        var soft = header.cars.map(function() { return null; }), softBytes = 0;
        if(header.version === FILE_VERSION && header.soft !== undefined) {
            if(!Array.isArray(header.soft) || header.soft.length !== header.cars.length) throw bad("This replay file is damaged.");
            header.soft = header.soft.map(function(info) {
                if(info === null) return null;
                if(!info || !(info.nodes >= 1 && info.nodes <= MAX_SOFT_NODES && info.nodes === Math.floor(info.nodes)) || !Array.isArray(info.parts) || info.parts.length > MAX_SOFT_PARTS ||
                   !(info.count >= 1 && info.count <= samples * 4 && info.count === Math.floor(info.count))) throw bad("This replay file is damaged.");
                info.parts = info.parts.map(function(name) { return String(name).slice(0, 80); });
                softBytes += recordSize(info) * info.count;
                return info;
            });
            if(header.softBytes !== softBytes) throw bad("This replay file is damaged.");
        } else header.soft = soft;
        if(start % 4 !== 0 || bytes.length - start !== wanted + softBytes) throw bad("This replay file is damaged.");
        var data = new Float32Array(bytes.buffer.slice(bytes.byteOffset + start, bytes.byteOffset + start + wanted));
        for(var k = 0; k < data.length; k++) if(!isFinite(data[k])) throw bad("This replay file is damaged.");
        var view = new DataView(bytes.buffer, bytes.byteOffset + start + wanted, softBytes), at = 0;
        soft = header.soft.map(function(info) {
            if(!info) return null;
            var size = recordSize(info), records = [], previous = -1, disp = null;
            for(var r = 0; r < info.count; r++, at += size) {
                var index = view.getUint32(at, true);
                if(index >= samples || index <= previous) throw bad("This replay file is damaged.");
                previous = index;
                var fresh = new Int16Array(info.nodes * 3);
                for(var i = 0; i < fresh.length; i++) fresh[i] = view.getInt16(at + 4 + 2 * i, true);
                if(!disp || !sameArray(disp, fresh)) disp = fresh;
                var o = at + 4 + Math.ceil(fresh.length * 2 / 4) * 4;
                var parts = new Float32Array(info.parts.length * PART_FLOATS);
                for(var j = 0; j < parts.length; j++) {
                    parts[j] = view.getFloat32(o + 4 * j, true);
                    if(!isFinite(parts[j])) throw bad("This replay file is damaged.");
                    if(j % PART_FLOATS === 0 && parts[j] !== 0 && parts[j] !== 1 && parts[j] !== 2) throw bad("This replay file is damaged.");
                }
                o += parts.length * 4;
                var wheels = new Float32Array(WHEEL_FLOATS);
                for(var w = 0; w < WHEEL_FLOATS; w++) { wheels[w] = view.getFloat32(o + 4 * w, true); if(!isFinite(wheels[w])) throw bad("This replay file is damaged."); }
                records.push({ index: index, disp: disp, parts: parts, wheels: wheels });
            }
            return { nodes: info.nodes, names: info.parts, records: records, version: -1, disp: null };
        });
        header.gears = Array.isArray(header.gears) ? header.gears.map(function(g) { return String(g).slice(0, 8); }) : [""];
        return { header: header, data: data, soft: soft };
    }

    // From the main menu: reads a file, checks that this game has the track and the cars, keeps it for the game that is started to show it.
    // Gives a promise of { car, track } (the ids that the address of the game needs), or fails with a message
    api.openFile = function(file, carList, trackList) {
        if(file.size > MAX_FILE) return Promise.reject(new Error("This file is too large to be a replay."));
        return file.arrayBuffer().then(function(buffer) { return api.openBuffer(buffer, carList, trackList); });
    };
    api.openBuffer = function(buffer, carList, trackList) {
        return parse(buffer).then(function(parsed) {
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
            var request = indexedDB.open("openracer-replay", 2);
            request.onupgradeneeded = function() {
                var db = request.result;
                if(!db.objectStoreNames.contains("files")) db.createObjectStore("files");
                if(!db.objectStoreNames.contains("library")) db.createObjectStore("library", { keyPath: "id", autoIncrement: true });      // what is shown in the list of Replays
                if(!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs");                                                   // the files themselves (the same bytes as a file), by the id of the list
            };
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
    // ---- the Replays of the main menu: the replays that were saved, kept in the database of the browser (the bytes are those of a file, so a replay can be downloaded again)
    function libraryAdd(bytes, meta) {
        return database().then(function(db) {
            return new Promise(function(resolve, reject) {
                var tx = db.transaction(["library", "blobs"], "readwrite"), id = null;
                var put = tx.objectStore("library").put(meta);
                put.onsuccess = function() { id = put.result; tx.objectStore("blobs").put(bytes, id); };
                tx.oncomplete = function() { db.close(); resolve(id); };
                tx.onerror = function() { db.close(); reject(tx.error); };
                tx.onabort = function() { db.close(); reject(tx.error || new Error("The replay could not be kept (is the storage of the browser full?).")); };
            });
        });
    }
    api.library = {
        // the list, the newest first: { id, created, track: { id, name }, cars: [names], seconds, bytes }
        list: function() {
            return database().then(function(db) {
                return new Promise(function(resolve, reject) {
                    var get = db.transaction("library").objectStore("library").getAll();
                    get.onsuccess = function() { db.close(); resolve(get.result.sort(function(a, b) { return String(b.created).localeCompare(String(a.created)); })); };
                    get.onerror = function() { db.close(); reject(get.error); };
                });
            });
        },
        bytes: function(id) {
            return database().then(function(db) {
                return new Promise(function(resolve, reject) {
                    var get = db.transaction("blobs").objectStore("blobs").get(id);
                    get.onsuccess = function() { db.close(); if(get.result) resolve(get.result); else reject(new Error("This replay is no longer there.")); };
                    get.onerror = function() { db.close(); reject(get.error); };
                });
            });
        },
        remove: function(id) {
            return database().then(function(db) {
                return new Promise(function(resolve, reject) {
                    var tx = db.transaction(["library", "blobs"], "readwrite");
                    tx.objectStore("library").delete(id);
                    tx.objectStore("blobs").delete(id);
                    tx.oncomplete = function() { db.close(); resolve(); };
                    tx.onerror = function() { db.close(); reject(tx.error); };
                });
            });
        },
        // a file that someone sent: checked, and put in the list (it need not be playable here: that is looked at when it is watched)
        importFile: function(file) {
            if(file.size > MAX_FILE) return Promise.reject(new Error("This file is too large to be a replay."));
            return file.arrayBuffer().then(function(buffer) {
                return parse(buffer).then(function(parsed) {
                    var h = parsed.header;
                    var bytes = new Uint8Array(buffer);
                    return libraryAdd(bytes, { created: h.created || new Date().toISOString(), track: { id: h.track.id, name: String(h.track.name).slice(0, 80) }, cars: h.cars.map(function(c) { return String(c.name).slice(0, 60); }), seconds: h.samples / (h.rate || RATE), bytes: bytes.length, imported: true });
                });
            });
        },
        // a replay of the list as a file to keep or to send
        download: function(id, track) {
            return api.library.bytes(id).then(function(bytes) {
                var stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 13);
                var url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
                var link = document.createElement("a");
                link.href = url;
                link.download = "replay-" + String(track).replace(/[^A-Za-z0-9_-]/g, "") + "-" + stamp + ".openracer-replay";
                document.body.appendChild(link);
                link.click();
                link.remove();
                setTimeout(function() { URL.revokeObjectURL(url); }, 30000);
            });
        },
        // to watch: like opening a file (the ids of the car and the track for the address of the game)
        open: function(id, carList, trackList) {
            return api.library.bytes(id).then(function(bytes) { return api.openBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), carList, trackList); });
        }
    };

    // Saves the recording in the list of Replays; gives a promise of { bytes }
    var savedTotal = -1;
    api.saveToLibrary = function() {
        if(!cars.length || total < 2) return Promise.reject(new Error("Nothing is recorded yet."));
        var size = total, seconds = (total - first()) / RATE;
        return gzip(pack()).then(function(bytes) {
            return libraryAdd(bytes, { created: new Date().toISOString(), track: { id: currentTrack.id, name: String(currentTrack.name || currentTrack.id) }, cars: cars.map(function(entry) { return String(entry.object.name || entry.object.config.name || entry.object.config.id); }), seconds: seconds, bytes: bytes.length });
        }).then(function() { savedTotal = size; return { bytes: 0 }; });
    };
    // Before the game goes back to the main menu: when there is a recording that was not saved yet, asks whether it should be (then calls leave); otherwise calls leave at once
    api.confirmLeave = function(leave) {
        if(api.viewer || api.active || !api.available() || total === savedTotal || document.getElementById("replayLeave")) { if(!document.getElementById("replayLeave")) leave(); return; }
        css();
        var shade = el(document.body, "div");
        shade.id = "replayLeave";
        shade.style.cssText = "position: fixed; left: 0; top: 0; width: 100%; height: 100%; z-index: 6000; background: rgba(0, 0, 0, 0.7); display: flex; align-items: center; justify-content: center; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;";
        var box = el(shade, "div");
        box.style.cssText = "width: 420px; max-width: calc(100% - 40px); background: var(--panel); border: 2px solid var(--line); border-radius: 10px; padding: 20px 24px; color: #fff;";
        var title = el(box, "div", "", "Save the replay?");
        title.style.cssText = "font-size: 20px; font-weight: bold; margin-bottom: 8px;";
        var minutes = Math.round((total - first()) / RATE);
        var text = el(box, "div", "", "The race on " + String(currentTrack.name || currentTrack.id) + " (" + Math.floor(minutes / 60) + ":" + ("0" + (minutes % 60)).slice(-2) + ") can be kept in Replays in the main menu. If you do not save it, it is gone.");
        text.style.cssText = "color: var(--muted); font-size: 14px; line-height: 1.5; margin-bottom: 16px;";
        var row = el(box, "div");
        row.style.cssText = "display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap;";
        var style = function(b, colour) { b.style.cssText = "padding: 9px 16px; font: bold 14px Arial; background: " + colour + "; color: #fff; border: 0; border-radius: 6px; cursor: pointer;"; };
        var cancel = button(row, "Cancel", "Stay in the game", function() { shade.remove(); });
        var drop = button(row, "Don't save", "Go to the main menu without keeping the replay", function() { shade.remove(); leave(); });
        var keep = button(row, "Save replay", "Keep the replay in Replays and go to the main menu", function() {
            keep.textContent = "Saving…"; keep.disabled = true;
            api.saveToLibrary().then(function() { shade.remove(); leave(); }).catch(function(error) {
                keep.textContent = "Could not save"; text.textContent = (error && error.message) || "The replay could not be saved."; text.style.color = "#ff8a80"; keep.disabled = false;
            });
        });
        style(cancel, "var(--line)"); style(drop, "#5a3a3a"); style(keep, "var(--accent)");
    };

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
        cars = objects.map(function(object, i) { return { object: object, player: i === 0, soft: parsed.soft && parsed.soft[i] ? parsed.soft[i] : null }; });
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

    api.debugEffects = function() { return effects; };
    api.debugSoft = function() { return cars.map(function(e) { return e.soft ? e.soft.records.map(function(r) { var m = 0; for(var i = 0; i < r.disp.length; i++) m = Math.max(m, Math.abs(r.disp[i])); return r.index + ':' + (m / SOFT_SCALE).toFixed(3) + ':' + Array.prototype.join.call(r.parts.filter(function(x, i) { return i % PART_FLOATS === 0; }), ''); }) : null; }); };
    api.info = function() { return { seconds: total * DT, cars: cars.length, blocks: chunks.length, megabytes: chunks.length * CHUNK * perSample() * 4 / 1048576 }; };
    api.speeds = SPEEDS;

    return api;
})();
