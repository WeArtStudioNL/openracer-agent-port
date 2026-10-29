/*
 * Take.js
 *
 * Description: A take: the 5 key starts one. It first asks for the picture (16:9, 9:16 or 1:1); then the take runs, with the picture as a frame in the window (a dark
 *              passepartout outside it, and a red blinking dot with the time at the top right of the frame). The 5 key again stops it, and a window asks for a name
 *              and what it should be: a replay (the part of the recording from the start to the stop goes into the replay library of the main menu, from where it is
 *              watched or downloaded) or a video (the replay is opened on that part, it is played and filmed as the Video button of the replay does, the file is saved
 *              with that name and the game goes on). The cross or Cancel throws the take away. The replay recorder (Replay.js) runs all the time: a take only marks where
 *              it starts and where it stops.
 */

OpenRacer.Take = (function () {
    var taking = false, from = 0, badge = null, timer = null, styled = false;
    // the camera of the game while the take runs (the free camera where it was put, or the chase camera): the video is filmed with it, from the replay
    var camSamples = [], camLoop = null;
    function recordCamera() {
        camLoop = null;
        if (!taking) return;
        var r = replay();
        if (typeof camera !== "undefined" && camera && r) {
            var last = camSamples[camSamples.length - 1], s = r.sampleNow();
            if (!last || s !== last.s) camSamples.push({ s: s, x: camera.position.x, y: camera.position.y, z: camera.position.z, qx: camera.quaternion.x, qy: camera.quaternion.y, qz: camera.quaternion.z, qw: camera.quaternion.w, fov: camera.fov });
        }
        camLoop = requestAnimationFrame(recordCamera);
    }
    var qa = null, qb = null;
    // the camera at a time of the replay (seconds), from the samples of the take; false when there are none
    function placeCamera(time, rate) {
        if (!camSamples.length || typeof camera === "undefined") return false;
        var s = time * rate, i = 0;
        while (i < camSamples.length - 1 && camSamples[i + 1].s <= s) i++;
        var a = camSamples[i], b = camSamples[Math.min(i + 1, camSamples.length - 1)];
        var f = b.s > a.s ? Math.max(0, Math.min(1, (s - a.s) / (b.s - a.s))) : 0;
        camera.position.set(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f);
        qa = qa || new THREE.Quaternion(); qb = qb || new THREE.Quaternion();
        qa.set(a.qx, a.qy, a.qz, a.qw); qb.set(b.qx, b.qy, b.qz, b.qw);
        camera.quaternion.copy(qa.slerp(qb, f));
        var fov = a.fov + (b.fov - a.fov) * f;
        if (Math.abs(camera.fov - fov) > 0.01 || camera.near !== 0.03) { camera.fov = fov; camera.near = 0.03; camera.updateProjectionMatrix(); }
        return true;
    }

    function style() {
        if (styled) return;
        styled = true;
        var s = document.createElement("style");
        s.textContent =
            "#takeBadge { position: fixed; left: 50%; top: 14px; transform: translateX(-50%); z-index: 950; display: none; padding: 6px 14px; border-radius: 8px; background: rgba(14, 18, 23, 0.75);" +
            " color: #fff; font: 600 14px system-ui, -apple-system, sans-serif; letter-spacing: 1px; pointer-events: none; }" +
            "#takeBadge .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #ff3b30; margin-right: 8px; animation: takeBlink 1s steps(1) infinite; }" +
            "#takeFrame { position: fixed; z-index: 920; box-sizing: border-box; pointer-events: none; display: none; border: 1px solid rgba(255, 255, 255, 0.55); box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.6); }" +
            "#takeFrame .rec { position: absolute; right: 10px; top: 8px; display: flex; align-items: center; gap: 7px; padding: 4px 9px; border-radius: 6px; background: rgba(14, 18, 23, 0.6); color: #fff; font: 600 13px system-ui, -apple-system, sans-serif; font-variant-numeric: tabular-nums; }" +
            "#takeFrame .rec i { width: 11px; height: 11px; border-radius: 50%; background: #ff3b30; animation: takeBlink 1s steps(1) infinite; }" +
            "#takeDialog input.name { width: 100%; box-sizing: border-box; font: inherit; font-size: 15px; padding: 9px 12px; margin: 0 0 16px; border-radius: 8px; border: 1px solid var(--line, #272e37); background: var(--bg2, #14181d); color: var(--head, #f4f6f8); }" +
            "#takeDialog input.name:focus { outline: 2px solid var(--accent, #e8622a); outline-offset: 1px; border-color: transparent; }" +
            "#takeCount { position: fixed; z-index: 925; display: none; align-items: center; justify-content: center; pointer-events: none; color: #fff; font: 700 140px system-ui, -apple-system, sans-serif; text-shadow: 0 4px 24px rgba(0, 0, 0, 0.7); }" +
            "body.takeClean #hud, body.takeClean #hudLaps, body.takeClean #hudCar, body.takeClean #hudBoost, body.takeClean #hudHint, body.takeClean #debugOut, body.takeClean #raceOverlay { display: none !important; }" +
            "#takeDialog .group { margin: 0 0 14px; } #takeDialog .group > label { display: block; font-size: 12px; letter-spacing: 1px; text-transform: uppercase; color: var(--muted, #8d97a3); margin: 0 0 6px; }" +
            "#takeDialog .row button.choice { display: inline-flex; align-items: center; gap: 6px; }" +
            "#takeDialog .seg { display: flex; gap: 8px; flex-wrap: wrap; } #takeDialog .seg button.choice { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }" +
            "#takeDialog .seg button.choice.on { border-color: var(--accent, #e8622a); background: rgba(232, 98, 42, 0.18); }" +
            "#takeDialog .slide { display: grid; grid-template-columns: 1fr 64px; align-items: center; gap: 10px; margin: 0 0 6px; } #takeDialog .slide input { width: 100%; } #takeDialog .slide b { text-align: right; font-weight: normal; color: var(--head, #f4f6f8); font-variant-numeric: tabular-nums; }" +
            "#takeDialog .check { display: flex; align-items: center; gap: 8px; font-size: 14px; color: var(--text, #d7dde3); cursor: pointer; }" +
            "@keyframes takeBlink { 50% { opacity: 0.25; } }" +
            "#takeDialog { position: fixed; inset: 0; z-index: 9000; background: rgba(0, 0, 0, 0.7); display: flex; align-items: center; justify-content: center; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }" +
            "#takeDialog .box { width: 420px; max-width: calc(100% - 32px); background: var(--panel, #181d23); color: var(--text, #d7dde3); border: 1px solid var(--line, #272e37); border-radius: 12px; padding: 20px 24px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6); position: relative; }" +
            "#takeDialog h2 { margin: 0 0 6px; font-size: 20px; color: var(--head, #f4f6f8); }" +
            "#takeDialog .text { color: var(--muted, #8d97a3); font-size: 14px; margin: 0 0 16px; }" +
            "#takeDialog .close { position: absolute; right: 12px; top: 10px; width: 32px; height: 32px; border: 0; background: none; color: var(--muted, #8d97a3); font-size: 22px; cursor: pointer; }" +
            "#takeDialog .row { display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap; }" +
            "#takeDialog button.choice { font: inherit; font-size: 14px; padding: 9px 16px; border-radius: 8px; border: 1px solid var(--line, #272e37); background: var(--bg2, #14181d); color: var(--head, #f4f6f8); cursor: pointer; }" +
            "#takeDialog button.choice.primary { background: var(--accent, #e8622a); border-color: var(--accent, #e8622a); color: #fff; }";
        document.head.appendChild(s);
        badge = document.createElement("div");
        badge.id = "takeBadge";
        document.body.appendChild(badge);
    }

    function format(seconds) { var m = Math.floor(seconds / 60), sec = Math.floor(seconds - m * 60); return m + ":" + (sec < 10 ? "0" : "") + sec; }
    function replay() { return typeof OpenRacer !== "undefined" ? OpenRacer.Replay : null; }

    // the picture while the take runs: a frame of the aspect with the dark passepartout round it, and at its top right the blinking red dot with the time
    var frame = null, recText = null;
    function placeFrame() {
        var r = replay();
        if (!frame || !r || !r.frameRect) return;
        var f = r.frameRect();
        frame.style.left = f.x + "px"; frame.style.top = f.y + "px"; frame.style.width = f.w + "px"; frame.style.height = f.h + "px";
    }
    window.addEventListener("resize", placeFrame);
    function showBadge() {
        style();
        if (!frame) {
            frame = document.createElement("div");
            frame.id = "takeFrame";
            var rec = document.createElement("div");
            rec.className = "rec";
            rec.innerHTML = "<i></i>";
            recText = document.createElement("span");
            rec.appendChild(recText);
            frame.appendChild(rec);
            document.body.appendChild(frame);
        }
        placeFrame();
        frame.style.display = "block";
        var tick = function () { var r = replay(); recText.textContent = "REC " + format(r ? (r.sampleNow() - from) / r.rate : 0); };
        tick();
        timer = setInterval(tick, 250);
    }
    function hideBadge() { if (badge) badge.style.display = "none"; if (frame) frame.style.display = "none"; if (timer) { clearInterval(timer); timer = null; } }

    // a short line at the top, for what was done
    function say(text) {
        style();
        badge.style.display = "";
        badge.textContent = text;
        setTimeout(function () { if (!taking) hideBadge(); }, 2500);
    }

    // ---- the windows

    function dialog(title, text, build) {
        return new Promise(function (resolve) {
            style();
            var back = document.createElement("div");
            back.id = "takeDialog";
            var box = document.createElement("div");
            box.className = "box";
            var close = document.createElement("button");
            close.className = "close"; close.innerHTML = OpenRacer.icon("x", 18); close.title = "Cancel";
            var h = document.createElement("h2"); h.textContent = title;
            var p = document.createElement("div"); p.className = "text"; p.textContent = text;
            box.appendChild(close); box.appendChild(h); box.appendChild(p);
            var finish = function (value) { if (back.parentNode) back.parentNode.removeChild(back); document.removeEventListener("keydown", onKey, true); resolve(value); };
            var onKey = function (event) { if (event.code === "Escape") { event.stopPropagation(); event.preventDefault(); finish(null); } };
            close.onclick = function () { finish(null); };
            build(box, finish);
            back.appendChild(box);
            back.onclick = function (event) { if (event.target === back) finish(null); };
            document.addEventListener("keydown", onKey, true);
            document.body.appendChild(back);
        });
    }
    function btn(parent, label, icon, cls, onClick) {
        var b = document.createElement("button");
        b.type = "button"; b.className = "choice" + (cls ? " " + cls : "");
        b.innerHTML = (icon ? OpenRacer.icon(icon, 16) : "") + "<span>" + label + "</span>";
        b.onclick = onClick;
        parent.appendChild(b);
        return b;
    }
    function group(box, label) {
        var g = document.createElement("div"); g.className = "group";
        var l = document.createElement("label"); l.textContent = label;
        g.appendChild(l); box.appendChild(g);
        return g;
    }
    function remembered(key, fallback) { try { var v = window.localStorage.getItem("openracer.take." + key); return v === null ? fallback : v; } catch (e) { return fallback; } }
    function remember(key, value) { try { window.localStorage.setItem("openracer.take." + key, String(value)); } catch (e) { /* no storage */ } }

    // before it starts: the picture, replay or video, and whether the HUD goes away while it runs
    function askStart(r) {
        return dialog("Record", "The 5 key, or the record button, starts it after a count of five seconds, and stops it.", function (box, finish) {
            var aspect = r.aspect(), format = remembered("format", "video") === "replay" ? "replay" : "video", hide = remembered("hide", "1") === "1";
            var g1 = group(box, "Picture"), seg1 = document.createElement("div"); seg1.className = "seg"; g1.appendChild(seg1);
            var aspectButtons = [["16:9", "16:9 landscape"], ["9:16", "9:16 upright"], ["1:1", "1:1 square"]].map(function (a) {
                var b = btn(seg1, a[1], "", "", function () { aspect = a[0]; sync(); });
                b.dataset.v = a[0];
                return b;
            });
            var g2 = group(box, "Make"), seg2 = document.createElement("div"); seg2.className = "seg"; g2.appendChild(seg2);
            var formatButtons = [["video", "Video (mp4)", "video"], ["replay", "Replay", "rotate-ccw"]].map(function (f) {
                var b = btn(seg2, f[1], f[2], "", function () { format = f[0]; sync(); });
                b.dataset.v = f[0];
                return b;
            });
            var hint = document.createElement("div"); hint.className = "text"; hint.style.margin = "8px 0 0"; g2.appendChild(hint);
            var label = document.createElement("label"); label.className = "check"; label.style.marginBottom = "16px";
            var check = document.createElement("input"); check.type = "checkbox"; check.checked = hide;
            check.onchange = function () { hide = check.checked; };
            label.appendChild(check); label.appendChild(document.createTextNode("Hide the HUD while it runs"));
            box.appendChild(label);
            function sync() {
                aspectButtons.forEach(function (b) { b.classList.toggle("on", b.dataset.v === aspect); });
                formatButtons.forEach(function (b) { b.classList.toggle("on", b.dataset.v === format); });
                hint.textContent = format === "video" ? "The video is filmed while you drive, the file is made when you stop." : "The take is kept in the replay library of the main menu, where it can be watched, edited and downloaded.";
            }
            sync();
            var row = document.createElement("div"); row.className = "row";
            btn(row, "Cancel", "", "", function () { finish(null); });
            btn(row, "Start", "video", "primary", function () { remember("format", format); remember("hide", hide ? "1" : "0"); finish({ aspect: aspect, format: format, hide: hide }); });
            box.appendChild(row);
        });
    }

    // after it: a name, what to cut from the start and from the end, and save
    function askSave(seconds, defaultName, format) {
        return dialog("Save the take", seconds.toFixed(1) + " s, as a " + (format === "video" ? "video (mp4)" : "replay") + ".", function (box, finish) {
            var nameField = document.createElement("input"); nameField.className = "name"; nameField.type = "text"; nameField.maxLength = 80; nameField.value = defaultName; nameField.setAttribute("aria-label", "Name");
            var gn = group(box, "Name"); gn.appendChild(nameField);
            var limit = Math.max(0, Math.floor((seconds - 0.5) * 2) / 2), cut = { start: 0, end: 0 };
            var gc = group(box, "Cut off");
            function slide(label, key) {
                var row = document.createElement("div"); row.className = "slide";
                var input = document.createElement("input"); input.type = "range"; input.min = 0; input.max = limit; input.step = 0.1; input.value = 0;
                input.setAttribute("aria-label", label);
                var value = document.createElement("b");
                var show = function () { value.textContent = cut[key].toFixed(1) + " s"; };
                input.oninput = function () {
                    cut[key] = parseFloat(input.value);
                    var other = key === "start" ? "end" : "start";
                    if (cut.start + cut.end > seconds - 0.5) { cut[key] = Math.max(0, seconds - 0.5 - cut[other]); input.value = cut[key]; }
                    show(); result.textContent = "Saved: " + (seconds - cut.start - cut.end).toFixed(1) + " s";
                };
                show();
                var wrap = document.createElement("div");
                var l = document.createElement("div"); l.className = "text"; l.style.margin = "0 0 2px"; l.textContent = label;
                wrap.appendChild(l); wrap.appendChild(input);
                row.appendChild(wrap); row.appendChild(value);
                gc.appendChild(row);
            }
            var result = document.createElement("div");
            slide("From the start", "start"); slide("From the end", "end");
            result.className = "text"; result.style.margin = "4px 0 0"; result.textContent = "Saved: " + seconds.toFixed(1) + " s";
            gc.appendChild(result);
            if (format === "video") {
                var note = document.createElement("div"); note.className = "text"; note.style.margin = "6px 0 0";
                note.textContent = "With a cut the part that is kept is filmed again from the recording of the game (it plays once more).";
                gc.appendChild(note);
            }
            var row = document.createElement("div"); row.className = "row";
            btn(row, "Discard", "x", "", function () { finish(null); });
            btn(row, "Save", "check", "primary", function () { finish({ name: nameField.value.trim() || defaultName, cutStart: cut.start, cutEnd: cut.end }); });
            box.appendChild(row);
            nameField.focus(); nameField.select();
            nameField.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); finish({ name: nameField.value.trim() || defaultName, cutStart: cut.start, cutEnd: cut.end }); } };
        });
    }

    // ---- the take

    var asking = false, counting = null, countEl = null, kind = "video", live = null, listeners = [];
    function changed() { listeners.forEach(function (fn) { try { fn(state()); } catch (e) { console.error(e); } }); }
    function state() { return counting ? "counting" : taking ? "taking" : asking ? "asking" : "idle"; }

    function showCount(n) {
        style();
        if (!countEl) { countEl = document.createElement("div"); countEl.id = "takeCount"; document.body.appendChild(countEl); }
        var r = replay();
        if (r && r.frameRect) { var f = r.frameRect(); countEl.style.left = f.x + "px"; countEl.style.top = f.y + "px"; countEl.style.width = f.w + "px"; countEl.style.height = f.h + "px"; }
        countEl.textContent = n;
        countEl.style.display = "flex";
    }
    function endCount() { if (counting) { clearInterval(counting); counting = null; } if (countEl) countEl.style.display = "none"; }

    function begin(r, choice) {
        r.setAspect(choice.aspect);
        kind = choice.format;
        // the frame with the passepartout is there from the count on; the HUD goes away with it
        from = r.sampleNow();
        showBadge();
        if (choice.hide) document.body.classList.add("takeClean");
        var n = 5;
        showCount(n);
        changed();
        counting = setInterval(function () {
            n--;
            if (n > 0) { showCount(n); return; }
            endCount();
            if (kind === "video") {
                live = r.liveCapture();
                if (!live) { say("No video here"); stopTake(false); return; }
            }
            taking = true; from = r.sampleNow();
            camSamples = [];
            if (!camLoop) camLoop = requestAnimationFrame(recordCamera);
            tickFrom = from;
            changed();
        }, 1000);
    }
    var tickFrom = 0;

    function stopTake(save) {
        taking = false;
        endCount();
        document.body.classList.remove("takeClean");
        if (camLoop) { cancelAnimationFrame(camLoop); camLoop = null; }
        hideBadge();
        if (!save && live) { live.cancel(); live = null; }
        changed();
    }

    function toggle() {
        var r = replay();
        if (!r || r.active || r.viewer || asking) return;
        if (counting) { stopTake(false); say("Recording cancelled"); return; }
        if (!taking) {
            if (typeof Settings !== "undefined" && Settings.isPaused && Settings.isPaused()) return;
            asking = true; changed();
            askStart(r).then(function (choice) {
                asking = false;
                if (!choice) { changed(); return; }
                begin(r, choice);
            });
            return;
        }
        var to = r.sampleNow();
        var capture = live; live = null;
        var seconds = (to - from) / r.rate;
        stopTake(true);
        if (seconds < 0.5) { if (capture) capture.cancel(); say("The take is too short"); return; }
        var track = (typeof race !== "undefined" && race && race.track && (race.track.name || race.track.id)) || (typeof currentTrack !== "undefined" && currentTrack && (currentTrack.name || currentTrack.id)) || "";
        var d = new Date(), pad = function (n) { return (n < 10 ? "0" : "") + n; };
        var defaultName = ((track ? track + " " : "") + "take " + d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + "." + pad(d.getMinutes())).slice(0, 80);
        var finished = capture ? capture.stop() : Promise.resolve(null);
        asking = true; changed();
        finished.then(function (clip) {
            return askSave(seconds, defaultName, kind).then(function (answer) {
                asking = false; changed();
                if (!answer) return;
                var name = answer.name, a = from + Math.round(answer.cutStart * r.rate), b = to - Math.round(answer.cutEnd * r.rate);
                var trimmed = answer.cutStart > 0 || answer.cutEnd > 0;
                if (kind === "replay") {
                    r.saveToLibrary(a, b, name).then(function () { say("Replay saved (" + ((b - a) / r.rate).toFixed(1) + " s): in the library of the main menu"); })
                        .catch(function (error) { say("Not saved: " + (error && error.message ? error.message : error)); });
                } else if (clip && !trimmed) {
                    r.saveVideo(clip.blob, clip.type, name).then(function (ext) { say("Video saved (" + seconds.toFixed(1) + " s, " + ext + ")"); });
                } else {
                    // a cut: the part that is kept is filmed from the recording of the game, with the camera of the take
                    var theCar = typeof car !== "undefined" ? car : null, samples = camSamples.slice();
                    var cameraWas = typeof Settings !== "undefined" ? Settings.option("camera") : null;       // (the replay puts the free camera of the game away: it comes back after)
                    if (theCar && samples.length) theCar.cameraOverride = function () { return placeCamera(r.time(), r.rate); };
                    var ok = r.filmRange(a / r.rate, b / r.rate, function () {
                        if (theCar && theCar.cameraOverride) theCar.cameraOverride = null;
                        if (cameraWas === 4 && typeof Settings !== "undefined") setTimeout(function () { Settings.setOption("camera", 4); }, 100);
                    }, name);
                    if (!ok) { if (theCar) theCar.cameraOverride = null; say("No video here"); }
                }
            });
        });
    }

    return { toggle: toggle, state: state, onChange: function (fn) { listeners.push(fn); }, get taking() { return taking; } };
})();
