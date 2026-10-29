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

    // the window: replay, video, or nothing
    function ask(seconds, defaultName) {
        return new Promise(function (resolve) {
            style();
            var back = document.createElement("div");
            back.id = "takeDialog";
            var box = document.createElement("div");
            box.className = "box";
            var close = document.createElement("button");
            close.className = "close"; close.textContent = "×"; close.title = "Throw the take away";
            var h = document.createElement("h2"); h.textContent = "Save the take";
            var nameField = document.createElement("input"); nameField.className = "name"; nameField.type = "text"; nameField.maxLength = 80; nameField.value = defaultName; nameField.setAttribute("aria-label", "Name");
            var p = document.createElement("div"); p.className = "text"; p.textContent = seconds.toFixed(1) + " s. Give it a name and save it as a replay (in the library of the main menu) or as a video (the take is played and filmed with the camera as it was, then the game goes on).";
            var row = document.createElement("div"); row.className = "row";
            var done = function (what) { if (back.parentNode) back.parentNode.removeChild(back); document.removeEventListener("keydown", onKey, true); resolve(what ? { what: what, name: nameField.value.trim() || defaultName } : null); };
            var onKey = function (event) { if (event.code === "Escape") { event.stopPropagation(); event.preventDefault(); done(null); } };
            [["Cancel", null, ""], ["Replay", "replay", ""], ["Video", "video", "primary"]].forEach(function (b) {
                var button = document.createElement("button");
                button.className = "choice " + b[2]; button.textContent = b[0];
                button.onclick = function () { done(b[1]); };
                row.appendChild(button);
            });
            close.onclick = function () { done(null); };
            box.appendChild(close); box.appendChild(h); box.appendChild(p); box.appendChild(nameField); box.appendChild(row);
            back.appendChild(box);
            back.onclick = function (event) { if (event.target === back) done(null); };
            document.addEventListener("keydown", onKey, true);
            document.body.appendChild(back);
            nameField.focus(); nameField.select();
        });
    }

    // the picture of the video: landscape, upright or square (the one of the replay is marked)
    function askAspect(r) {
        return new Promise(function (resolve) {
            style();
            var back = document.createElement("div");
            back.id = "takeDialog";
            var box = document.createElement("div"); box.className = "box";
            var close = document.createElement("button"); close.className = "close"; close.textContent = "×"; close.title = "Do not record";
            var h = document.createElement("h2"); h.textContent = "Record: which picture?";
            var p = document.createElement("div"); p.className = "text"; p.textContent = "The frame shows what a video of the take will have; a replay keeps all of it. The take is filmed with the camera as it was during the take.";
            var row = document.createElement("div"); row.className = "row";
            var done = function (what) { if (back.parentNode) back.parentNode.removeChild(back); document.removeEventListener("keydown", onKey, true); resolve(what); };
            var onKey = function (event) { if (event.code === "Escape") { event.stopPropagation(); event.preventDefault(); done(null); } };
            var current = r.aspect();
            [["Cancel", null], ["16:9 landscape", "16:9"], ["9:16 upright", "9:16"], ["1:1 square", "1:1"]].forEach(function (b) {
                var button = document.createElement("button");
                button.className = "choice" + (b[1] && b[1] === current ? " primary" : ""); button.textContent = b[0];
                button.onclick = function () { done(b[1]); };
                row.appendChild(button);
            });
            close.onclick = function () { done(null); };
            box.appendChild(close); box.appendChild(h); box.appendChild(p); box.appendChild(row);
            back.appendChild(box);
            back.onclick = function (event) { if (event.target === back) done(null); };
            document.addEventListener("keydown", onKey, true);
            document.body.appendChild(back);
        });
    }

    var asking = false;
    function toggle() {
        var r = replay();
        if (!r || r.active || r.viewer || asking) return;
        if (!taking) {
            if (typeof Settings !== "undefined" && Settings.isPaused && Settings.isPaused()) return;
            // the picture first: the take is only started with one
            asking = true;
            askAspect(r).then(function (aspect) {
                asking = false;
                if (!aspect || taking) return;
                r.setAspect(aspect);
                taking = true; from = r.sampleNow();
                camSamples = [];
                if (!camLoop) camLoop = requestAnimationFrame(recordCamera);
                showBadge();
            });
            return;
        }
        taking = false;
        var to = r.sampleNow();
        if (camLoop) { cancelAnimationFrame(camLoop); camLoop = null; }
        hideBadge();
        var seconds = (to - from) / r.rate;
        if (seconds < 0.5) { say("The take is too short"); return; }
        if (typeof Settings !== "undefined" && Settings.isPaused && Settings.isPaused()) return;
        var track = (typeof race !== "undefined" && race && race.track && (race.track.name || race.track.id)) || (typeof currentTrack !== "undefined" && currentTrack && (currentTrack.name || currentTrack.id)) || "";
        var d = new Date(), pad = function (n) { return (n < 10 ? "0" : "") + n; };
        var defaultName = ((track ? track + " " : "") + "take " + d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + "." + pad(d.getMinutes())).slice(0, 80);
        ask(seconds, defaultName).then(function (answer) {
            if (!answer) return;
            var what = answer.what, name = answer.name;
            if (what === "replay") {
                r.saveToLibrary(from, to, name).then(function () { say("Replay saved (" + seconds.toFixed(1) + " s): in the library of the main menu"); })
                    .catch(function (error) { say("Not saved: " + (error && error.message ? error.message : error)); });
            } else if (what === "video") {
                // the camera of the take: the game's car places its camera through this while the replay films
                var theCar = typeof car !== "undefined" ? car : null, samples = camSamples.slice();
                var cameraWas = typeof Settings !== "undefined" ? Settings.option("camera") : null;       // (the replay puts the free camera of the game away: it comes back after)
                if (theCar && samples.length) theCar.cameraOverride = function () { return placeCamera(r.time(), r.rate); };
                var ok = r.filmRange(from / r.rate, to / r.rate, function () {
                    if (theCar && theCar.cameraOverride) theCar.cameraOverride = null;
                    if (cameraWas === 4 && typeof Settings !== "undefined") setTimeout(function () { Settings.setOption("camera", 4); }, 100);
                }, name);
                if (!ok) { if (theCar) theCar.cameraOverride = null; say("No video here"); }
            }
        });
    }

    return { toggle: toggle, get taking() { return taking; } };
})();
