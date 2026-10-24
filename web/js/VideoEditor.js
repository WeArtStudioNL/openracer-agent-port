/*
 * VideoEditor.js
 *
 * Description: The video editor (index.html?car=...&track=...&editor=1, from "Video editor" in the bar of a replay or "Edit" in the list of Replays). One replay is the source; what is made
 *              of it is a list of clips on a timeline, and a camera track:
 *
 *   Left monitor: the source replay, with a scrubber, play, and an In and an Out marker (I and O). "Insert at playhead" puts the part between the markers in the timeline where the playhead
 *                 is (a clip that is there is cut in two), "Add to end" puts it after the last clip.
 *   Right monitor: the result, played from the timeline (the same picture as the game makes, 1280 x 720). Play (Space) and scrub; the timeline has a ruler, the clips and the camera track.
 *   Clips:        a clip has a speed (0.05 to 8), and keys for a ramp (speed changes smoothly between the keys, along the clip). The inspector under the timeline has them.
 *   Camera track: the free camera of the replay (the button Free camera: WASD or the arrows, Shift and Control, the mouse after a click, [ and ] for the zoom), with "Parent to car" (the camera goes
 *                 with the car) and "Point at car" (it keeps looking at it). "Key here" puts a key at the playhead; between keys the camera moves smoothly (CameraTrack.js). Without keys the
 *                 camera of the game follows the car.
 *   Save:         "Save as replay" (a new replay in the list of Replays, with the clips cut and the speeds applied, and the camera track in it; the smoke, the skid marks and the damage are
 *                 not in it) and "Save as mp4" (the right monitor recorded from the start to the end, without sound). Both ask for a name.
 */

OpenRacer.VideoEditor = (function () {
    var api = { active: false };
    var DT = 1 / 30, STEP = 1 / 60;                               // the samples of a replay, and the steps of the table of a clip
    var MIN_SPEED = 0.05, MAX_SPEED = 8;

    var Replay = null;
    var state = { clips: [], camera: [], T: 0, srcT: 0, srcIn: null, srcOut: null, selected: -1, selectedKey: -1, selectedCam: -1, finalPlaying: false, srcPlaying: false, dirty: false, scale: 40 };
    var ui = null, recording = null, scrubbing = null, srcCtx = null;
    var started = false;

    function el(parent, tag, className, text) {
        var e = document.createElement(tag);
        if (className) e.className = className;
        if (text !== undefined) e.textContent = text;
        if (parent) parent.appendChild(e);
        return e;
    }
    function button(parent, label, title, onclick, className) {
        var b = el(parent, "button", className || "", label);
        b.type = "button";
        if (title) b.title = title;
        b.onclick = function (event) { onclick(event); b.blur(); };
        return b;
    }
    function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
    function round(x, n) { var f = Math.pow(10, n === undefined ? 2 : n); return Math.round(x * f) / f; }
    function fmt(seconds) {
        seconds = Math.max(0, seconds);
        var m = Math.floor(seconds / 60), s = seconds - m * 60;
        return m + ":" + (s < 10 ? "0" : "") + s.toFixed(2);
    }

    // ---- the clips: a source part, and a speed that may change along it

    // between two keys the speed goes from the one to the other: straight, or eased (a key with "ease out" leaves its speed slowly, one with "ease in" arrives at it slowly)
    function speedAtOffset(clip, offset) {
        var keys = clip.keys;
        if (!keys.length) return clip.speed;
        if (offset <= keys[0].at) return keys[0].speed;
        for (var i = 1; i < keys.length; i++) {
            if (offset <= keys[i].at) {
                var a = keys[i - 1], b = keys[i], f = (offset - a.at) / Math.max(1e-6, b.at - a.at);
                if (a.easeOut && b.easeIn) f = f * f * (3 - 2 * f);
                else if (a.easeOut) f = f * f;
                else if (b.easeIn) f = 1 - (1 - f) * (1 - f);
                return a.speed + (b.speed - a.speed) * f;
            }
        }
        return keys[keys.length - 1].speed;
    }
    // the ramp of a clip drawn in its block: the speed curve (a log scale from the slowest to the fastest), and the keys as dots that can be clicked (the inspector shows that key) and dragged
    // (along: when it is; up and down: how fast)
    var RAMP_TOP = 3, RAMP_H = 30;
    function rampY(speed) { return RAMP_TOP + (1 - (Math.log(clamp(speed, MIN_SPEED, MAX_SPEED)) - Math.log(MIN_SPEED)) / (Math.log(MAX_SPEED) - Math.log(MIN_SPEED))) * RAMP_H; }
    function rampSpeed(y) { return clamp(Math.exp(Math.log(MIN_SPEED) + (1 - (y - RAMP_TOP) / RAMP_H) * (Math.log(MAX_SPEED) - Math.log(MIN_SPEED))), MIN_SPEED, MAX_SPEED); }
    function drawRamp(block, clip, index) {
        if (!clip.keys.length) return;
        var width = Math.max(6, clip.duration * state.scale - 2), svgNS = "http://www.w3.org/2000/svg";
        var svg = document.createElementNS(svgNS, "svg");
        svg.setAttribute("class", "ramp"); svg.setAttribute("width", width); svg.setAttribute("height", RAMP_TOP * 2 + RAMP_H);
        var points = [], length = clip.out - clip.in;
        for (var x = 0; x <= width; x += 3) {
            var offset = offsetAt(clip, clamp(x / state.scale, 0, clip.duration));
            points.push(x + "," + rampY(speedAtOffset(clip, offset)).toFixed(1));
        }
        var line = document.createElementNS(svgNS, "polyline");
        line.setAttribute("points", points.join(" ")); line.setAttribute("fill", "none"); line.setAttribute("stroke", "#ffd04d"); line.setAttribute("stroke-width", "1.5");
        svg.appendChild(line);
        block.appendChild(svg);
        clip.keys.forEach(function (k, ki) {
            var d = el(block, "div", "rk" + (index === state.selected && ki === state.selectedKey ? " sel" : ""));
            d.style.left = timeAtOffset(clip, k.at) * state.scale + "px";
            d.style.top = rampY(k.speed) + "px";
            d.title = "×" + round(k.speed, 2) + " at " + fmt(clip.in + k.at) + " (click: this key; drag: move it, up and down for the speed)";
            d.addEventListener("pointerdown", function (event) {
                event.stopPropagation(); event.preventDefault();
                var rect = block.getBoundingClientRect(), moved = false, startX = event.clientX, startY = event.clientY;
                try { if (d.setPointerCapture) d.setPointerCapture(event.pointerId); } catch (err) { /* (no pointer to capture) */ }
                var move = function (e) {
                    if (!moved && Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) < 3) return;
                    moved = true;
                    var f = clamp((e.clientX - rect.left) / state.scale, 0, clip.duration);
                    k.at = clamp(offsetAt(clip, f), 0, length);
                    k.speed = round(rampSpeed(e.clientY - rect.top), 2);
                    prepare(clip);
                    state.selected = index; state.selectedKey = clip.keys.indexOf(k);
                    renderTimeline(); renderInspector();
                };
                var up = function () {
                    d.removeEventListener("pointermove", move); d.removeEventListener("pointerup", up); d.removeEventListener("pointercancel", up);
                    state.selected = index; state.selectedKey = clip.keys.indexOf(k);
                    if (moved) touch(); else { renderTimeline(); renderInspector(); }
                };
                d.addEventListener("pointermove", move); d.addEventListener("pointerup", up); d.addEventListener("pointercancel", up);
            });
            d.addEventListener("click", function (event) { event.stopPropagation(); });
        });
    }

    // the table of a clip: the time in the timeline at every step of the source (the integral of 1 / speed)
    function prepare(clip) {
        clip.keys.sort(function (a, b) { return a.at - b.at; });
        var length = clip.out - clip.in, n = Math.max(1, Math.ceil(length / STEP)), acc = new Float64Array(n + 1);
        for (var i = 0; i < n; i++) {
            var a = i * STEP, b = Math.min(length, (i + 1) * STEP);
            var speed = speedAtOffset(clip, (a + b) / 2);
            acc[i + 1] = acc[i] + (b - a) / clamp(speed, MIN_SPEED, MAX_SPEED);
        }
        clip.acc = acc;
        clip.duration = acc[n];
    }
    function newClip(a, b, speed, keys) {
        var clip = { in: a, out: b, speed: speed || 1, keys: keys || [] };
        prepare(clip);
        return clip;
    }
    // the source offset (seconds from the start of the clip) at a time in the clip
    function offsetAt(clip, f) {
        var acc = clip.acc, n = acc.length - 1;
        if (f <= 0) return 0;
        if (f >= acc[n]) return clip.out - clip.in;
        var lo = 0, hi = n;
        while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (acc[mid] <= f) lo = mid; else hi = mid; }
        var part = (f - acc[lo]) / Math.max(1e-9, acc[hi] - acc[lo]);
        return Math.min(clip.out - clip.in, (lo + part) * STEP);
    }
    // the time in the clip at a source offset
    function timeAtOffset(clip, offset) {
        var acc = clip.acc, n = acc.length - 1, position = clamp(offset, 0, clip.out - clip.in) / STEP, i = Math.min(n - 1, Math.floor(position));
        return acc[i] + (acc[i + 1] - acc[i]) * (position - i);
    }
    function starts() {
        var out = [], at = 0;
        state.clips.forEach(function (clip) { out.push(at); at += clip.duration; });
        return out;
    }
    function total() { var at = 0; state.clips.forEach(function (clip) { at += clip.duration; }); return at; }

    // what the timeline shows at a time: the clip, and the time in the source
    function mapFinal(T) {
        var at = 0, clips = state.clips;
        for (var i = 0; i < clips.length; i++) {
            var clip = clips[i];
            if (T < at + clip.duration || i === clips.length - 1) {
                var f = clamp(T - at, 0, clip.duration);
                return { index: i, clip: clip, src: clip.in + offsetAt(clip, f), local: f };
            }
            at += clip.duration;
        }
        return null;
    }

    // ---- the operations

    function touch() {
        state.dirty = true;
        // the timeline fits the window until it is zoomed by hand
        if (ui && !state.zoomed) { var width = Math.max(200, ui.scroller.clientWidth - 24), t = total(); if (t * state.scale > width || t * state.scale < width * 0.4) state.scale = clamp(width / Math.max(1, t + 1), 4, 600); }
        renderTimeline(); renderInspector(); updateButtons();
    }

    // puts the part between the markers in the timeline: at the playhead (a clip that it is in is cut) or at the end
    function insertPart(atEnd) {
        if (state.srcIn === null || state.srcOut === null || state.srcOut - state.srcIn < 0.1) { say("Set an In and an Out marker in the source first (I and O), at least 0.1 s apart."); return; }
        var part = newClip(state.srcIn, state.srcOut, 1, []);
        var clips = state.clips, index = clips.length, T = state.T, at = 0;
        if (!atEnd && clips.length) {
            index = clips.length;
            for (var i = 0; i < clips.length; i++) {
                var d = clips[i].duration;
                if (T <= at + 0.02) { index = i; break; }
                if (T < at + d - 0.02) { splitClip(i, T - at); index = i + 1; break; }
                at += d;
            }
        }
        clips = state.clips;
        clips.splice(index, 0, part);
        state.selected = index; state.selectedKey = -1;
        // the playhead goes to the start of what was put in
        state.T = starts()[index];
        touch();
    }

    // a clip in two at a time in the clip (the keys of the ramp go with their part)
    function splitClip(index, f) {
        var clip = state.clips[index];
        if (f <= 0.02 || f >= clip.duration - 0.02) return false;
        var offset = offsetAt(clip, f), keysA = [], keysB = [];
        var speedHere = speedAtOffset(clip, offset);
        clip.keys.forEach(function (k) {
            if (k.at < offset) keysA.push({ at: k.at, speed: k.speed }); else keysB.push({ at: k.at - offset, speed: k.speed });
        });
        if (clip.keys.length) { keysA.push({ at: offset, speed: speedHere }); keysB.unshift({ at: 0, speed: speedHere }); }
        var a = newClip(clip.in, clip.in + offset, clip.speed, keysA), b = newClip(clip.in + offset, clip.out, clip.speed, keysB);
        state.clips.splice(index, 1, a, b);
        return true;
    }

    function deleteClip(index) {
        if (index < 0 || index >= state.clips.length) return;
        state.clips.splice(index, 1);
        state.selected = Math.min(state.selected, state.clips.length - 1);
        state.selectedKey = -1;
        state.T = Math.min(state.T, total());
        touch();
    }

    function moveClip(index, by) {
        var to = index + by;
        if (to < 0 || to >= state.clips.length) return;
        var c = state.clips.splice(index, 1)[0];
        state.clips.splice(to, 0, c);
        state.selected = to;
        touch();
    }

    // ---- messages and the window for a name

    function say(text) {
        if (!ui) return;
        ui.message.textContent = text;
        ui.message.style.opacity = "1";
        clearTimeout(say.timer);
        say.timer = setTimeout(function () { ui.message.style.opacity = "0"; }, 5000);
    }

    function askName(title, text, value, okLabel) {
        return new Promise(function (resolve) {
            var shade = el(document.body, "div", "veShade");
            var box = el(shade, "div", "veBox");
            el(box, "h2", "", title);
            el(box, "p", "", text);
            var input = el(box, "input");
            input.type = "text"; input.value = value; input.maxLength = 60; input.setAttribute("aria-label", "Name");
            var row = el(box, "div", "veRow");
            var done = function (result) { shade.remove(); resolve(result); };
            button(row, "Cancel", "", function () { done(null); });
            var ok = button(row, okLabel, "", function () { var name = input.value.replace(/\s+/g, " ").trim(); if (!name) { input.focus(); return; } done(name); }, "primary");
            input.addEventListener("keydown", function (event) { event.stopPropagation(); if (event.code === "Enter") ok.click(); else if (event.code === "Escape") done(null); });
            shade.addEventListener("pointerdown", function (event) { if (event.target === shade) done(null); });
            setTimeout(function () { input.focus(); input.select(); }, 30);
        });
    }

    // ---- saving

    function safeName(name) { return name.replace(/[^A-Za-z0-9 _.-]/g, "_").trim().slice(0, 60) || "video"; }

    function saveReplay() {
        if (!state.clips.length) { say("The timeline is empty: put a part of the source in it first."); return; }
        askName("Save as replay", "The name in the list of Replays (main menu).", "My edit", "Save").then(function (name) {
            if (!name) return;
            var N = Math.floor(total() / DT) + 1, times = new Array(N);
            for (var i = 0; i < N; i++) times[i] = mapFinal(Math.min(total(), i * DT)).src;
            ui.save.disabled = true; ui.save.textContent = "Saving…";
            Replay.bake(times, { camera: OpenRacer.CameraTrack.clean(state.camera), name: name }).then(function (baked) {
                return Replay.keepBaked(name, baked);
            }).then(function () {
                state.dirty = false;
                say("Saved as \"" + name + "\" in Replays.");
            }).catch(function (error) { console.error(error); say(error.message || "The replay could not be saved."); }).then(function () { ui.save.disabled = false; ui.save.textContent = "Save as replay"; });
        });
    }

    function download(blob, filename) {
        var url = URL.createObjectURL(blob), link = document.createElement("a");
        link.href = url; link.download = filename;
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
    }

    function saveVideo() {
        if (!state.clips.length) { say("The timeline is empty: put a part of the source in it first."); return; }
        var canvas = renderer.domElement;
        if (typeof MediaRecorder === "undefined" || !canvas.captureStream) { say("This browser cannot make a video."); return; }
        var types = ["video/mp4;codecs=avc1.640028", "video/mp4;codecs=avc1.42E01E", "video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
        var type = types.filter(function (t) { return MediaRecorder.isTypeSupported(t); })[0];
        if (!type) { say("This browser cannot make a video."); return; }
        askName("Save as mp4", "The name of the video. It is recorded in real time from the start to the end, without sound.", "My video", "Record").then(function (name) {
            if (!name) return;
            if (Replay.free.active) Replay.leaveFree();
            var stream = canvas.captureStream(60), chunks = [];
            var recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 12000000 });
            recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
            recorder.onstop = function () {
                recording = null;
                document.body.classList.remove("veRecording");
                var blob = new Blob(chunks, { type: type.split(";")[0] });
                if (!blob.size) { say("The video is empty."); updateButtons(); return; }
                var stem = safeName(name);
                if (/mp4/.test(type)) { download(blob, stem + ".mp4"); say("Saved " + stem + ".mp4"); updateButtons(); return; }
                // a webm: the local server (tools/serve.py) makes the mp4 of it with ffmpeg; without it the webm is kept
                say("Making the mp4…");
                fetch("/api/convert/mp4", { method: "POST", body: blob }).then(function (r) { if (!r.ok) throw new Error("no"); return r.blob(); })
                    .then(function (mp4) { download(mp4, stem + ".mp4"); say("Saved " + stem + ".mp4"); })
                    .catch(function () { download(blob, stem + ".webm"); say("ffmpeg is not here: saved " + stem + ".webm"); })
                    .then(updateButtons);
            };
            recording = { recorder: recorder };
            document.body.classList.add("veRecording");
            state.T = 0; state.finalPlaying = true; state.srcPlaying = false;
            recorder.start(250);
            updateButtons();
        });
    }

    function stopRecording() { if (recording && recording.recorder.state !== "inactive") recording.recorder.stop(); }

    // ---- the page

    function css() {
        var style = el(document.head, "style");
        style.textContent =
            "body.vedit { overflow: hidden; background: #0e1217; }" +
            "body.vedit #replayBar, body.vedit #replayInfo { display: none !important; }" +
            "#vedit { position: fixed; left: 0; top: 0; width: 100%; height: 100%; z-index: 1500; display: flex; flex-direction: column; background: #0e1217; color: var(--text, #d9dee5); " +
                "font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; font-size: 13px; user-select: none; -webkit-user-select: none; }" +
            "#vedit button { font: inherit; color: var(--text, #d9dee5); background: var(--bg2, #1c222a); border: 1px solid var(--line, #2b333d); border-radius: 7px; padding: 5px 10px; cursor: pointer; }" +
            "#vedit button:hover:not(:disabled) { border-color: var(--muted, #8d97a3); color: var(--head, #fff); }" +
            "#vedit button:disabled { opacity: .45; cursor: default; }" +
            "#vedit button.on { background: var(--accent, #ff5a1f); border-color: var(--accent, #ff5a1f); color: #fff; }" +
            "#vedit button.primary { background: var(--accent, #ff5a1f); border-color: var(--accent, #ff5a1f); color: #fff; }" +
            "#vedit input[type=number], #vedit input[type=text] { font: inherit; width: 64px; color: var(--head, #fff); background: #0b0f13; border: 1px solid var(--line, #2b333d); border-radius: 6px; padding: 3px 6px; }" +
            "#vedit .top { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--line, #2b333d); }" +
            "#vedit .top h1 { font-size: 15px; margin: 0 12px 0 0; letter-spacing: 1px; color: var(--head, #fff); }" +
            "#vedit .top .spacer { flex: 1; }" +
            "#vedit .msg { color: var(--accent, #ff5a1f); transition: opacity .4s; opacity: 0; }" +
            "#vedit .monitors { flex: 1; min-height: 0; display: flex; gap: 10px; padding: 10px 12px; }" +
            "#vedit .mon { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 6px; }" +
            "#vedit .mon .title { color: var(--muted, #8d97a3); letter-spacing: 1px; text-transform: uppercase; font-size: 11px; }" +
            "#vedit .screen { position: relative; flex: 1; min-height: 0; background: #000; border: 1px solid var(--line, #2b333d); border-radius: 8px; overflow: hidden; display: flex; align-items: center; justify-content: center; }" +
            "#vedit .screen canvas { width: 100% !important; height: 100% !important; object-fit: contain; display: block; }" +
            "#vedit .screen .over { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #fff; text-shadow: 0 1px 6px #000; pointer-events: none; text-align: center; padding: 20px; }" +
            "#vedit .row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }" +
            "#vedit .time { font-variant-numeric: tabular-nums; color: var(--head, #fff); min-width: 120px; }" +
            "#vedit .hint { color: var(--muted, #8d97a3); }" +
            "#vedit .scrub { position: relative; height: 26px; }" +
            "#vedit .scrub input[type=range] { position: absolute; left: 0; top: 0; width: 100%; height: 26px; margin: 0; background: transparent; accent-color: var(--accent, #ff5a1f); }" +
            "#vedit .scrub .range { position: absolute; top: 9px; height: 8px; background: rgba(255, 90, 31, .45); border-radius: 3px; pointer-events: none; }" +
            "#vedit .scrub .mark { position: absolute; top: 3px; width: 2px; height: 20px; background: #ffd04d; pointer-events: none; }" +
            "#vedit .timeline { height: 270px; border-top: 1px solid var(--line, #2b333d); display: flex; flex-direction: column; background: #12171d; }" +
            "#vedit .tools { display: flex; align-items: center; gap: 8px; padding: 6px 12px; }" +
            "#vedit .tl { position: relative; flex: 1; min-height: 0; overflow-x: auto; overflow-y: hidden; margin: 0 12px; border: 1px solid var(--line, #2b333d); border-radius: 6px; background: #0e1217; }" +
            "#vedit .tl .inner { position: relative; height: 100%; }" +
            "#vedit .tl .ruler { position: absolute; left: 0; top: 0; height: 22px; width: 100%; border-bottom: 1px solid var(--line, #2b333d); cursor: pointer; }" +
            "#vedit .tl .tick { position: absolute; top: 0; height: 22px; border-left: 1px solid #39424e; padding-left: 4px; color: var(--muted, #8d97a3); font-size: 10px; line-height: 22px; pointer-events: none; }" +
            "#vedit .tl .lane { position: absolute; left: 0; width: 100%; height: 56px; border-bottom: 1px solid #1c222a; cursor: pointer; }" +
            "#vedit .tl .lane .name { position: absolute; left: 4px; top: 2px; font-size: 10px; color: var(--muted, #8d97a3); pointer-events: none; z-index: 2; }" +
            "#vedit .clip { position: absolute; top: 14px; height: 38px; box-sizing: border-box; background: #2a4a6b; border: 1px solid #4a7aa6; border-radius: 5px; overflow: hidden; padding: 3px 6px; color: #fff; cursor: pointer; white-space: nowrap; }" +
            "#vedit .clip.sel { background: #35618c; border-color: var(--accent, #ff5a1f); box-shadow: 0 0 0 1px var(--accent, #ff5a1f) inset; }" +
            "#vedit .clip .l1 { font-size: 11px; } #vedit .clip .l2 { font-size: 10px; color: #b9c8d8; }" +
            "#vedit .clip .ramp { position: absolute; left: 0; top: 0; pointer-events: none; }" +
            "#vedit .clip .rk { position: absolute; width: 9px; height: 9px; background: #ffd04d; border: 1px solid #0e1217; border-radius: 50%; transform: translate(-5px, -5px); cursor: grab; touch-action: none; }" +
            "#vedit .clip .rk.sel { background: var(--accent, #ff5a1f); width: 11px; height: 11px; transform: translate(-6px, -6px); }" +
            "#vedit .ck { position: absolute; top: 22px; width: 14px; height: 14px; background: #37d67a; border: 1px solid #0e1217; transform: translateX(-7px) rotate(45deg); cursor: pointer; }" +
            "#vedit .ck.sel { background: var(--accent, #ff5a1f); }" +
            "#vedit .ck.parent { border-radius: 50%; } " +
            "#vedit .head { position: absolute; top: 0; width: 0; height: 100%; border-left: 2px solid #ff4d4d; pointer-events: none; z-index: 5; }" +
            "#vedit .inspector { min-height: 62px; flex-shrink: 0; padding: 6px 12px 8px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; overflow-y: auto; }" +
            "#vedit .inspector .sep { width: 1px; height: 22px; background: var(--line, #2b333d); margin: 0 4px; }" +
            "#vedit .inspector .rkrow { display: inline-flex; gap: 4px; align-items: center; padding: 2px 6px; border: 1px solid var(--line, #2b333d); border-radius: 6px; }" +
            ".veShade { position: fixed; left: 0; top: 0; width: 100%; height: 100%; z-index: 9000; background: rgba(0,0,0,.7); display: flex; align-items: center; justify-content: center; font-family: system-ui, sans-serif; }" +
            ".veBox { width: 420px; max-width: calc(100% - 32px); background: var(--panel, #181d23); color: var(--text, #d9dee5); border: 1px solid var(--line, #272e37); border-radius: 12px; padding: 20px 24px; box-shadow: 0 20px 60px rgba(0,0,0,.6); }" +
            ".veBox h2 { margin: 0 0 6px; font-size: 19px; color: var(--head, #fff); } .veBox p { margin: 0 0 12px; color: var(--muted, #8d97a3); font-size: 14px; line-height: 1.5; }" +
            ".veBox input { width: 100%; box-sizing: border-box; font: inherit; font-size: 15px; padding: 8px 10px; color: var(--head, #fff); background: #0b0f13; border: 1px solid var(--line, #272e37); border-radius: 8px; }" +
            ".veBox .veRow { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }" +
            ".veBox button { font: inherit; padding: 7px 14px; border-radius: 8px; border: 1px solid var(--line, #272e37); background: var(--bg2, #1c222a); color: var(--text, #d9dee5); cursor: pointer; }" +
            ".veBox button.primary { background: var(--accent, #ff5a1f); border-color: var(--accent, #ff5a1f); color: #fff; }" +
            "body.veRecording #vedit .monitors .mon:first-child { opacity: .35; }" +
            "@media (max-width: 800px) { #vedit .monitors { flex-direction: column; } #vedit .timeline { height: 200px; } }";
    }

    function build() {
        css();
        document.body.classList.add("vedit");
        var root = el(document.body, "div"); root.id = "vedit";
        var top = el(root, "div", "top");
        el(top, "h1", "", "VIDEO EDITOR");
        ui = { root: root, message: el(top, "span", "msg", "") };
        el(top, "span", "spacer");
        ui.save = button(top, "Save as replay", "Cut, speeds and camera track as a new replay in the list of Replays (without smoke, skid marks and damage)", saveReplay);
        ui.video = button(top, "Save as mp4", "The result recorded from the start to the end, as a video file", saveVideo);
        ui.close = button(top, "Close", "Back to the main menu", function () { leave(); });

        var monitors = el(root, "div", "monitors");
        // the source
        var left = el(monitors, "div", "mon");
        ui.srcTitle = el(left, "div", "title", "Source");
        var srcScreen = el(left, "div", "screen");
        ui.srcCanvas = el(srcScreen, "canvas");
        ui.srcCanvas.width = 640; ui.srcCanvas.height = 360;
        srcCtx = ui.srcCanvas.getContext("2d");
        var sr = el(left, "div", "row");
        ui.srcPlay = button(sr, "▶", "Play the source (Shift + Enter)", function () { toggleSrc(); });
        button(sr, "⏮", "To the start of the source", function () { state.srcT = Replay.start_time(); updateSrcUi(); });
        ui.srcTime = el(sr, "span", "time", "");
        var scrub = el(left, "div", "scrub");
        ui.srcRange = el(scrub, "div", "range");
        ui.markIn = el(scrub, "div", "mark"); ui.markOut = el(scrub, "div", "mark");
        ui.srcSlider = el(scrub, "input");
        ui.srcSlider.type = "range"; ui.srcSlider.step = "any"; ui.srcSlider.setAttribute("aria-label", "Position in the source");
        ui.srcSlider.addEventListener("input", function () { state.srcT = parseFloat(ui.srcSlider.value); state.srcPlaying = false; updateSrcUi(); });
        var mr = el(left, "div", "row");
        button(mr, "In (I)", "Put the In marker here", function () { setIn(); });
        button(mr, "Out (O)", "Put the Out marker here", function () { setOut(); });
        button(mr, "Clear", "Take the markers away", function () { state.srcIn = state.srcOut = null; updateSrcUi(); });
        ui.markInfo = el(mr, "span", "hint", "");
        ui.insertButton = button(mr, "Insert at playhead", "Put the part between the markers in the timeline where the playhead is (a clip there is cut in two)", function () { insertPart(false); }, "primary");
        ui.appendButton = button(mr, "Add to end", "Put the part between the markers after the last clip", function () { insertPart(true); });

        // the result
        var right = el(monitors, "div", "mon");
        ui.finalTitle = el(right, "div", "title", "Program");
        ui.finalScreen = el(right, "div", "screen");
        ui.empty = el(ui.finalScreen, "div", "over", "Empty. Set In and Out in the source, then Insert.");
        var fr = el(right, "div", "row");
        ui.play = button(fr, "▶", "Play the result (Enter)", function () { toggleFinal(); });
        button(fr, "⏮", "To the start (Home)", function () { state.T = 0; state.finalPlaying = false; });
        ui.time = el(fr, "span", "time", "");
        el(fr, "span", "spacer");
        var cr = el(right, "div", "row");
        el(cr, "span", "hint", "Camera:");
        ui.free = button(cr, "Free camera", "Fly the camera: WASD or the arrows, Space and Alt up and down, Q and E tilt, click the picture and move the mouse to look, [ and ] zoom. Off: the camera track (or the game camera) plays.", function () { toggleFree(); });
        ui.parent = button(cr, "Parent to car", "The camera goes with the car, from where it is now (L)", function () { if (Replay.free.active) Replay.toggleParent(); else say("Turn on the free camera first."); });
        ui.sky = button(cr, "Parent, sky up", "The camera goes with the car's place but not with its turn (K)", function () { if (Replay.free.active) Replay.toggleSky(); else say("Turn on the free camera first."); });
        ui.aim = button(cr, "Point at car", "The camera keeps looking at the car (F)", function () { if (Replay.free.active) Replay.toggleAim(); else say("Turn on the free camera first."); });
        ui.car = button(cr, "Car", "The next car (Tab)", function () { if (Replay.carCount() > 1) Replay.nextTarget(); });
        ui.key = button(cr, "Key here", "Put a camera key at the playhead, with the camera as it is now", function () { keyHere(); }, "primary");
        ui.delKey = button(cr, "Delete key", "Delete the selected camera key", function () { deleteCamKey(); });
        ui.clearCam = button(cr, "Clear track", "Delete all camera keys", function () { state.camera = []; state.selectedCam = -1; touch(); });

        // the timeline
        var tl = el(root, "div", "timeline");
        var tools = el(tl, "div", "tools");
        el(tools, "span", "hint", "TIMELINE");
        button(tools, "−", "Zoom out", function () { state.zoomed = true; state.scale = Math.max(4, state.scale / 1.5); renderTimeline(); });
        button(tools, "+", "Zoom in", function () { state.zoomed = true; state.scale = Math.min(600, state.scale * 1.5); renderTimeline(); });
        button(tools, "Fit", "The whole timeline in view", function () { state.zoomed = false; fit(); });
        ui.total = el(tools, "span", "hint", "");
        ui.scroller = el(tl, "div", "tl");
        ui.inner = el(ui.scroller, "div", "inner");
        ui.ruler = el(ui.inner, "div", "ruler");
        ui.laneClips = el(ui.inner, "div", "lane"); ui.laneClips.style.top = "22px";
        el(ui.laneClips, "div", "name", "CLIPS");
        ui.laneCam = el(ui.inner, "div", "lane"); ui.laneCam.style.top = "78px"; ui.laneCam.style.height = "50px";
        el(ui.laneCam, "div", "name", "CAMERA");
        ui.head = el(ui.inner, "div", "head");
        var down = function (event) {
            if (event.target.closest && (event.target.closest(".clip") || event.target.closest(".ck"))) return;
            scrubbing = true; state.finalPlaying = false; moveHead(event);
            ui.scroller.setPointerCapture && ui.scroller.setPointerCapture(event.pointerId);
        };
        ui.inner.addEventListener("pointerdown", down);
        ui.inner.addEventListener("pointermove", function (event) { if (scrubbing) moveHead(event); });
        window.addEventListener("pointerup", function () { scrubbing = null; });
        ui.inspector = el(tl, "div", "inspector");

        // the render canvas of the game is the right monitor
        ui.finalScreen.insertBefore(renderer.domElement, ui.empty);
        renderer.domElement.style.position = "static";
        renderer.domElement.style.width = ""; renderer.domElement.style.height = "";
    }

    function moveHead(event) {
        var rect = ui.inner.getBoundingClientRect();
        state.T = clamp((event.clientX - rect.left) / state.scale, 0, Math.max(0, total()));
        state.selectedCam = -1;
    }

    function fit() {
        var width = Math.max(200, ui.scroller.clientWidth - 24);
        state.scale = clamp(width / Math.max(1, total() + 1), 4, 600);
        renderTimeline();
    }

    function renderTimeline() {
        if (!ui) return;
        var length = total(), width = Math.max(ui.scroller.clientWidth, (length + 4) * state.scale);
        ui.inner.style.width = width + "px";
        ui.ruler.style.width = width + "px";
        // the ruler
        ui.ruler.innerHTML = "";
        var step = [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120].filter(function (s) { return s * state.scale >= 60; })[0] || 120;
        for (var t = 0; t * state.scale < width; t += step) {
            var tick = el(ui.ruler, "div", "tick", fmt(t).replace(/\.00$/, ""));
            tick.style.left = t * state.scale + "px";
        }
        ui.ruler.onclick = null;
        // the clips
        Array.prototype.slice.call(ui.laneClips.querySelectorAll(".clip")).forEach(function (n) { n.remove(); });
        var at = starts();
        state.clips.forEach(function (clip, i) {
            var block = el(ui.laneClips, "div", "clip" + (i === state.selected ? " sel" : ""));
            block.style.left = at[i] * state.scale + "px";
            block.style.width = Math.max(6, clip.duration * state.scale - 2) + "px";
            el(block, "div", "l1", (i + 1) + " · " + fmt(clip.in) + " – " + fmt(clip.out));
            el(block, "div", "l2", clip.keys.length ? "ramp, " + clip.keys.length + " keys · " + round(clip.duration, 2) + " s" : "×" + round(clip.speed, 2) + " · " + round(clip.duration, 2) + " s");
            drawRamp(block, clip, i);
            block.onclick = function () { state.selected = i; state.selectedKey = -1; renderTimeline(); renderInspector(); };
        });
        // the camera keys
        Array.prototype.slice.call(ui.laneCam.querySelectorAll(".ck")).forEach(function (n) { n.remove(); });
        state.camera.forEach(function (k, i) {
            var d = el(ui.laneCam, "div", "ck" + (i === state.selectedCam ? " sel" : "") + (k.parent ? " parent" : ""));
            d.style.left = k.t * state.scale + "px";
            d.title = "Camera key at " + fmt(k.t) + (k.parent ? ", parented" : "") + (k.aim ? ", pointing at the car" : "") + " (click: go there; double click: edit with the free camera)";
            d.onclick = function (event) { event.stopPropagation(); state.selectedCam = i; state.T = k.t; state.finalPlaying = false; renderTimeline(); updateButtons(); };
            d.ondblclick = function (event) { event.stopPropagation(); state.selectedCam = i; state.T = k.t; state.finalPlaying = false; editKey(i); };
        });
        ui.total.textContent = state.clips.length ? " · " + state.clips.length + (state.clips.length === 1 ? " clip, " : " clips, ") + fmt(length) : " · empty";
        placeHead();
    }

    function placeHead() {
        if (!ui) return;
        ui.head.style.left = state.T * state.scale + "px";
    }

    function renderInspector() {
        if (!ui) return;
        var box = ui.inspector;
        box.innerHTML = "";
        var clip = state.clips[state.selected];
        if (!clip) { el(box, "span", "hint", "Select a clip to change its speed, or to make a ramp with keys. A camera key: click it in the camera lane."); return; }
        var key = clip.keys[state.selectedKey];
        if (key) {
            // one key of the ramp: its speed, and how the speed comes to it and leaves it
            el(box, "span", "hint", "Ramp key at " + fmt(clip.in + key.at) + " · speed");
            var ks = el(box, "input"); ks.type = "number"; ks.step = "0.05"; ks.min = String(MIN_SPEED); ks.max = String(MAX_SPEED); ks.value = String(round(key.speed, 2));
            ks.addEventListener("keydown", function (e) { e.stopPropagation(); });
            ks.onchange = function () { key.speed = clamp(parseFloat(ks.value) || 1, MIN_SPEED, MAX_SPEED); prepare(clip); touch(); };
            var easeIn = el(box, "label", "hint"); var ci = el(easeIn, "input"); ci.type = "checkbox"; ci.checked = !!key.easeIn; easeIn.appendChild(document.createTextNode(" ease in"));
            easeIn.title = "The speed arrives at this key slowly";
            ci.onchange = function () { key.easeIn = ci.checked; prepare(clip); touch(); };
            var easeOut = el(box, "label", "hint"); var co = el(easeOut, "input"); co.type = "checkbox"; co.checked = !!key.easeOut; easeOut.appendChild(document.createTextNode(" ease out"));
            easeOut.title = "The speed leaves this key slowly";
            co.onchange = function () { key.easeOut = co.checked; prepare(clip); touch(); };
            button(box, "Delete key", "Delete this key of the ramp", function () { clip.keys.splice(state.selectedKey, 1); state.selectedKey = -1; if (clip.keys.length < 2) { clip.speed = clip.keys.length ? clip.keys[0].speed : clip.speed; clip.keys = []; } prepare(clip); touch(); });
            el(box, "span", "sep");
            el(box, "span", "hint", "Click the clip for the clip itself. Drag a key along for when, up and down for how fast.");
            return;
        }
        el(box, "span", "hint", "Clip " + (state.selected + 1) + ":");
        el(box, "span", "hint", clip.keys.length ? "speed from the ramp keys" : "speed");
        var speed = el(box, "input"); speed.type = "number"; speed.step = "0.05"; speed.min = String(MIN_SPEED); speed.max = String(MAX_SPEED); speed.value = String(round(clip.speed, 2));
        speed.disabled = clip.keys.length > 0;
        speed.addEventListener("keydown", function (e) { e.stopPropagation(); });
        speed.onchange = function () { clip.speed = clamp(parseFloat(speed.value) || 1, MIN_SPEED, MAX_SPEED); prepare(clip); touch(); };
        el(box, "span", "sep");
        button(box, "Add ramp key at playhead", "A speed key at the playhead (inside this clip): the speed changes smoothly between the keys", function () {
            var at = starts()[state.selected], f = state.T - at;
            if (f < 0 || f > clip.duration) { say("Put the playhead inside this clip first."); return; }
            var offset = offsetAt(clip, f), now = speedAtOffset(clip, offset);
            if (!clip.keys.length) { clip.keys.push({ at: 0, speed: clip.speed }); clip.keys.push({ at: clip.out - clip.in, speed: clip.speed }); }
            clip.keys.push({ at: offset, speed: round(now, 2) });
            prepare(clip); touch();
        });
        if (clip.keys.length) button(box, "Remove ramp", "Back to one speed", function () { clip.speed = round(speedAtOffset(clip, 0), 2); clip.keys = []; prepare(clip); touch(); });
        if (clip.keys.length) el(box, "span", "hint", "The ramp is drawn in the clip: click a key for its speed and its ease, drag it to move it.");
        el(box, "span", "sep");
        button(box, "Split at playhead", "Cut the clip in two at the playhead", function () {
            var at = starts()[state.selected];
            if (splitClip(state.selected, state.T - at)) touch(); else say("Put the playhead inside the clip first.");
        });
        button(box, "◀", "Move the clip to the left", function () { moveClip(state.selected, -1); });
        button(box, "▶", "Move the clip to the right", function () { moveClip(state.selected, 1); });
        button(box, "Delete clip", "Take the clip out of the timeline", function () { deleteClip(state.selected); });
    }

    // ---- the source monitor

    function setIn() { state.srcIn = state.srcT; if (state.srcOut !== null && state.srcOut <= state.srcIn) state.srcOut = null; updateSrcUi(); }
    function setOut() { state.srcOut = state.srcT; if (state.srcIn !== null && state.srcIn >= state.srcOut) state.srcIn = null; updateSrcUi(); }
    function toggleSrc() { state.srcPlaying = !state.srcPlaying; if (state.srcPlaying && state.srcT >= Replay.end_time() - 0.02) state.srcT = state.srcIn !== null ? state.srcIn : Replay.start_time(); updateSrcUi(); }
    function toggleFinal() {
        if (recording) return;
        state.finalPlaying = !state.finalPlaying;
        if (state.finalPlaying && state.T >= total() - 0.02) state.T = 0;
        updateButtons();
    }

    function updateSrcUi() {
        if (!ui) return;
        var a = Replay.start_time(), b = Replay.end_time(), span = Math.max(0.001, b - a);
        ui.srcSlider.min = String(a); ui.srcSlider.max = String(b);
        if (document.activeElement !== ui.srcSlider || !scrubbing) ui.srcSlider.value = String(state.srcT);
        ui.srcTime.textContent = fmt(state.srcT - a) + " / " + fmt(span);
        ui.srcPlay.textContent = state.srcPlaying ? "❚❚" : "▶";
        var pos = function (s) { return (s - a) / span * 100 + "%"; };
        ui.markIn.style.display = state.srcIn === null ? "none" : ""; ui.markOut.style.display = state.srcOut === null ? "none" : "";
        if (state.srcIn !== null) ui.markIn.style.left = pos(state.srcIn);
        if (state.srcOut !== null) ui.markOut.style.left = pos(state.srcOut);
        var from = state.srcIn !== null ? state.srcIn : null, to = state.srcOut !== null ? state.srcOut : null;
        ui.srcRange.style.display = from !== null && to !== null ? "" : "none";
        if (from !== null && to !== null) { ui.srcRange.style.left = pos(from); ui.srcRange.style.width = (to - from) / span * 100 + "%"; }
        ui.markInfo.textContent = from !== null && to !== null ? "In " + fmt(from - a) + " · Out " + fmt(to - a) + " · " + round(to - from, 2) + " s" : (from !== null ? "In " + fmt(from - a) : (to !== null ? "Out " + fmt(to - a) : "Markers: I and O"));
        var ready = from !== null && to !== null && to - from >= 0.1;
        ui.insertButton.disabled = !ready; ui.appendButton.disabled = !ready;
    }

    // ---- the camera track

    function toggleFree() {
        var free = Replay.free;
        if (free.active) { Replay.leaveFree(); return; }
        Replay.enterFree();
        state.finalPlaying = false;
        updateButtons();
    }
    function keyHere() {
        if (!Replay.free.active) { Replay.enterFree(); state.finalPlaying = false; }
        var key = OpenRacer.CameraTrack.fromFree(Replay.free, round(state.T, 3));
        // a key that is at the same time is replaced
        var same = -1;
        state.camera.forEach(function (k, i) { if (Math.abs(k.t - key.t) < 0.05) same = i; });
        if (same >= 0) state.camera[same] = key; else state.camera.push(key);
        state.camera.sort(function (a, b) { return a.t - b.t; });
        state.selectedCam = state.camera.indexOf(key);
        say("Camera key at " + fmt(key.t));
        touch();
    }
    function deleteCamKey() {
        if (state.selectedCam < 0 || state.selectedCam >= state.camera.length) { say("Select a camera key first (click it in the camera lane)."); return; }
        state.camera.splice(state.selectedCam, 1); state.selectedCam = -1; touch();
    }
    // the free camera starts from a key: the camera can be moved and "Key here" replaces it
    function editKey(i) {
        var k = state.camera[i];
        if (!k) return;
        if (!Replay.free.active) Replay.enterFree();
        OpenRacer.CameraTrack.toFree(Replay.free, k, camera);
        renderTimeline(); updateButtons();
    }

    // ---- buttons

    function updateButtons() {
        if (!ui) return;
        var free = Replay.free;
        ui.play.textContent = state.finalPlaying ? "❚❚" : "▶";
        ui.free.className = free.active ? "on" : "";
        ui.parent.className = free.active && free.parent && !free.sky ? "on" : "";
        ui.sky.className = free.active && free.parent && free.sky ? "on" : "";
        ui.aim.className = free.active && free.aim ? "on" : "";
        ui.car.style.display = Replay.carCount() > 1 ? "" : "none";
        ui.car.textContent = "Car " + ((free.target || 0) + 1);
        ui.delKey.disabled = state.selectedCam < 0;
        ui.clearCam.disabled = !state.camera.length;
        ui.empty.style.display = state.clips.length ? "none" : "";
        ui.video.disabled = !!recording || !state.clips.length;
        ui.save.disabled = !!recording || !state.clips.length;
        ui.video.textContent = recording ? "Recording…" : "Save as mp4";
        ui.close.disabled = !!recording;
        ui.insertButton.disabled = ui.insertButton.disabled || !!recording;
        updateSrcUi();
    }

    // ---- the frame

    var chase = new THREE.Vector3(), chaseTo = new THREE.Vector3();
    // the second picture: the source at its time, from behind the car
    function sourcePass(delta) {
        var saved = car.cameraOverride;
        car.cameraOverride = function () { return true; };                 // (the camera of the game belongs to the program: it must not follow the source too)
        Replay.preview(state.srcT, delta);
        car.cameraOverride = saved;
        var body = Replay.carBody(0);
        if (body) {
            chase.set(0, 0, -1).applyQuaternion(body.quaternion); chase.y = 0;
            if (chase.lengthSq() < 1e-6) chase.set(0, 0, -1); chase.normalize();
            camera.position.copy(body.position).addScaledVector(chase, 6.5); camera.position.y += 2.3;
            chaseTo.copy(body.position); chaseTo.y += 0.8;
            // not behind a wall: the camera comes closer when the track is in the way
            var ground = car.vehicle.ground;
            if (ground && ground.firstHit) {
                var dx = camera.position.x - chaseTo.x, dy = camera.position.y - chaseTo.y, dz = camera.position.z - chaseTo.z, len = Math.hypot(dx, dy, dz) || 1;
                var hit = ground.firstHit(chaseTo.x, chaseTo.y, chaseTo.z, dx / len, dy / len, dz / len, len);
                if (hit < len) camera.position.set(chaseTo.x + dx / len * Math.max(0.8, hit - 0.4), chaseTo.y + dy / len * Math.max(0.8, hit - 0.4), chaseTo.z + dz / len * Math.max(0.8, hit - 0.4));
            }
            camera.lookAt(chaseTo);
            if (camera.fov !== 50) { camera.fov = 50; camera.near = 0.3; camera.updateProjectionMatrix(); }
        }
        renderer.render(scene, camera);
        srcCtx.drawImage(renderer.domElement, 0, 0, ui.srcCanvas.width, ui.srcCanvas.height);
    }

    api.frame = function (delta) {
        delta = Math.min(0.1, delta);
        if (!ui) return;
        var length = total(), a = Replay.start_time(), b = Replay.end_time();
        if (state.finalPlaying) {
            state.T += delta;
            if (state.T >= length) { state.T = length; state.finalPlaying = false; if (recording) setTimeout(stopRecording, 300); updateButtons(); }
        }
        if (state.srcPlaying) {
            state.srcT += delta;
            var stop = state.srcOut !== null && state.srcIn !== null ? state.srcOut : b;
            if (state.srcT >= stop) { state.srcT = stop; state.srcPlaying = false; }
            if (state.srcT >= b) { state.srcT = b; state.srcPlaying = false; }
            updateSrcUi();
        }
        if (!recording) { sourcePass(delta); updateSrcUi(); }
        // the program
        var m = mapFinal(state.T);
        Replay.seek(m ? m.src : state.srcT);
        Replay.frame(delta);
        if (!Replay.free.active && state.camera.length) OpenRacer.CameraTrack.apply(state.camera, state.T, camera, Replay.carBody);
        ui.time.textContent = fmt(state.T) + " / " + fmt(length) + (m && m.clip ? "   ×" + round(speedAtOffset(m.clip, m.src - m.clip.in), 2) : "");
        placeHead();
        // the playhead stays in view while it plays
        if (state.finalPlaying) {
            var x = state.T * state.scale, sl = ui.scroller.scrollLeft, w = ui.scroller.clientWidth;
            if (x > sl + w - 30 || x < sl) ui.scroller.scrollLeft = Math.max(0, x - 40);
        }
        if (ui.free.className !== (Replay.free.active ? "on" : "")) updateButtons();
        else if ((ui.parent.className === "on") !== (Replay.free.active && Replay.free.parent && !Replay.free.sky) || (ui.sky.className === "on") !== (Replay.free.active && Replay.free.parent && !!Replay.free.sky) || (ui.aim.className === "on") !== (Replay.free.active && Replay.free.aim)) updateButtons();
    };

    // ---- the keys

    function onKey(event) {
        if (!api.active || !ui) return;
        var target = event.target;
        if (target && (/^(TEXTAREA|SELECT)$/.test(target.tagName) || (target.tagName === "INPUT" && target.type !== "range"))) return;
        if (document.querySelector(".veShade")) return;
        var free = Replay.free.active;
        if (event.code === "Enter") { event.preventDefault(); if (event.shiftKey) toggleSrc(); else toggleFinal(); }
        else if (event.code === "KeyI") { setIn(); event.preventDefault(); }
        else if (event.code === "KeyO") { setOut(); event.preventDefault(); }
        else if (event.code === "Home") { state.T = 0; state.finalPlaying = false; event.preventDefault(); }
        else if (event.code === "End") { state.T = total(); state.finalPlaying = false; event.preventDefault(); }
        else if (!free && event.code === "ArrowLeft") { state.T = Math.max(0, state.T - (event.shiftKey ? 1 : DT)); state.finalPlaying = false; event.preventDefault(); }
        else if (!free && event.code === "ArrowRight") { state.T = Math.min(total(), state.T + (event.shiftKey ? 1 : DT)); state.finalPlaying = false; event.preventDefault(); }
        else if (event.code === "Delete" || event.code === "Backspace") {
            if (state.selectedCam >= 0) deleteCamKey(); else if (state.selected >= 0) deleteClip(state.selected);
            event.preventDefault();
        }
        else if (event.code === "KeyK" && free) { keyHere(); event.preventDefault(); }
    }

    function leave() {
        var go = function () { window.location.href = window.location.pathname; };
        if (!state.dirty || !state.clips.length) { go(); return; }
        if (typeof OpenRacerDialog !== "undefined") OpenRacerDialog.ask({ title: "Leave the video editor?", text: "What you made is not saved (Save as replay or as mp4).", ok: "Leave", cancel: "Stay", danger: true }).then(function (yes) { if (yes) go(); });
        else go();
    }

    // ---- start

    api.start = function () {
        if (started) return;
        started = true;
        Replay = OpenRacer.Replay;
        // the picture is 1280 x 720 whatever the window is: the same for the monitor and for the video
        window.onresize = function () {};
        SCREEN_WIDTH = 1280; SCREEN_HEIGHT = 720;
        renderer.setPixelRatio(1);
        renderer.setSize(1280, 720, false);
        camera.aspect = 16 / 9; camera.updateProjectionMatrix();
        if (useComposer && OpenRacer.Graphics) OpenRacer.Graphics.setSize(1280, 720);
        build();
        var a = Replay.start_time();
        state.srcT = a;
        var h = Replay.header();
        if (h) ui.srcTitle.textContent = "Source · " + String(h.track.name).slice(0, 40) + " · " + (h.cars || []).slice(0, 3).map(function (c) { return String(c.name).slice(0, 24); }).join(", ");
        // an edited replay that is opened to be edited again has its camera track
        if (h && Array.isArray(h.camera) && h.camera.length) state.camera = OpenRacer.CameraTrack.clean(h.camera);
        // the Replay of the game: paused, without its keys (this editor has its own)
        Replay.pause();
        document.addEventListener("keydown", onKey);
        window.addEventListener("beforeunload", function (event) { if (state.dirty && state.clips.length) { event.preventDefault(); event.returnValue = ""; } });
        api.active = true;
        fit();
        renderInspector();
        updateButtons();
    };
    api.state = state;
    api.debug = { mapFinal: mapFinal, total: total, newClip: newClip, insertPart: insertPart, setIn: setIn, setOut: setOut, keyHere: keyHere };
    return api;
})();
