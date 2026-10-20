/*
 * DragStrip.js
 *
 * Description: The drag strip of a track (track.json "dragstrip": { x, z, heading, width, length }, placed in the track editor: the start line, the way
 *              the strip goes, and how far the finish line is). The front wheels of the car are the reference, as the beams of a real strip are.
 *              - Near the start line (within 45 m, in the lane) a text shows how far the front wheels are from the line.
 *              - With the front wheels at the line (a margin of a few decimetres) and the car standing nearly still, the lights come: stage, three
 *                ambers one after the other (half a second apart) and green. The timing starts when the car leaves the line (30 cm), the reaction
 *                time is that moment minus the green light.
 *              - Leaving before the green light is a false start: a red light, the run is over and the car has to go back behind the line (3 m)
 *                and come up slowly to the line again. A car that passes the line without staging has no run until it has gone back too.
 *              - The times and the speeds are shown for the standard distances within the length (60 ft, 330 ft, 1/8 mile, 1000 ft, 1/4 mile, ...)
 *                and the finish, as they are passed. The result stays until the car is back behind the line.
 *              At the finish a time slip slides in from the top at the right of the screen, with the times on it; the cross or Escape closes it.
 *              The lines on the road are drawn: a white start line and a chequered finish line.
 */

OpenRacer.DragStrip = (function () {
    var MARKS = [["60 ft", 18.288], ["330 ft", 100.584], ["1/8 mile", 201.168], ["1000 ft", 304.8], ["1/4 mile", 402.336], ["1/2 mile", 804.672], ["1 km", 1000], ["1 mile", 1609.344]];
    var STAGE_MIN = -0.4, STAGE_MAX = 0.25;      // m: the front wheels at the line
    var ROLLOUT = 0.3;                           // m: the car has left the line
    var AMBER = 0.5;                             // s between the lights of the tree
    var strip = null, state = "idle", lines = null, hud = null, movableDone = false;
    var slip = null;
    var tTree = 0, stagedS = 0, tGreen = 0, t0 = null, reaction = 0, results = [], prevT = 0, prevS = 0, prevV = 0, finishNote = "", lastHtml = "";

    function parse(ds) {
        strip = { src: ds, x: ds.x, z: ds.z, heading: ds.heading || 0, width: ds.width || 12, length: ds.length || 402.336 };
        strip.dx = Math.cos(strip.heading); strip.dz = Math.sin(strip.heading);
        results = MARKS.filter(function (m) { return m[1] < strip.length - 0.5; }).map(function (m) { return { label: m[0], metres: m[1], time: null, speed: null }; });
        // the finish line has the name of the distance when it is one of them
        var named = MARKS.filter(function (m) { return Math.abs(m[1] - strip.length) < 0.5; })[0];
        results.push({ label: named ? named[0] : "Finish (" + Math.round(strip.length) + " m)", metres: strip.length, time: null, speed: null, finish: true });
        state = "idle"; lines = null;
    }

    // the white start line and the chequered finish line on the road
    function checker() {
        var c = document.createElement("canvas"); c.width = 128; c.height = 32;
        var g = c.getContext("2d");
        for (var i = 0; i < 16; i++) for (var j = 0; j < 4; j++) { g.fillStyle = (i + j) % 2 ? "#111" : "#fff"; g.fillRect(i * 8, j * 8, 8, 8); }
        var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    }
    function buildLines(v) {
        if (lines || typeof scene === "undefined" || !scene || !v.ground || !v.ground.query) return;
        var group = new THREE.Group(), lastY = null;
        var make = function (distance, textured) {
            var x = strip.x + strip.dx * distance, z = strip.z + strip.dz * distance;
            var hit = v.ground.query(x, z, (lastY === null ? v.py : lastY) + 5, 40);
            if (!hit && lastY === null) return false;          // (the road under the start line is not known yet)
            var y = hit ? hit.y : lastY;
            lastY = y;
            var material = new THREE.MeshBasicMaterial({ color: 0xffffff, map: textured ? checker() : null, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.DoubleSide });
            var mesh = new THREE.Mesh(new THREE.PlaneGeometry(strip.width, textured ? 1.2 : 0.35), material);
            mesh.rotation.x = -Math.PI / 2;
            mesh.rotation.z = Math.atan2(-strip.dx, -strip.dz);
            mesh.position.set(x, y + 0.04, z);
            mesh.renderOrder = 3;
            mesh.userData.noGBuffer = true;
            group.add(mesh);
            return true;
        };
        if (!make(0, false) || !make(strip.length, true)) return;
        scene.add(group);
        lines = group;
    }


    // ---- the time slip
    function pad(label, value) {
        var dots = " ";
        for (var n = label.length + String(value).length; n < 26; n++) dots += ".";
        return label + dots + " " + value;
    }
    function build_slip() {
        if (slip) return;
        var style = document.createElement("style");
        style.textContent =
            "#dragSlip { position: fixed; right: 22px; top: 14px; z-index: 1600; width: 330px; box-sizing: border-box; padding: 18px 18px 30px; color: #1b1b1b; background: #f4f1e8; " +
            "font-family: 'Courier New', Courier, monospace; font-size: 14px; line-height: 1.45; white-space: pre; box-shadow: 0 10px 34px rgba(0, 0, 0, 0.55); " +
            "transform: translateY(-115%); transition: transform 0.9s cubic-bezier(0.2, 0.8, 0.25, 1); pointer-events: none; }" +
            "#dragSlip.open { transform: translateY(0); pointer-events: auto; }" +
            "#dragSlip .close { position: absolute; right: 8px; top: 6px; width: 24px; height: 24px; border: 0; background: transparent; font-size: 20px; line-height: 20px; color: #444; cursor: pointer; }" +
            "#dragSlip .close:hover { color: #000; }" +
            "#dragSlip .centre { text-align: center; }" +
            "#dragSlip .tear { position: absolute; left: 0; right: 0; bottom: -1px; height: 12px; background: linear-gradient(-45deg, transparent 8px, #f4f1e8 0), linear-gradient(45deg, transparent 8px, #f4f1e8 0); background-size: 16px 16px; background-position: left bottom; transform: translateY(12px); }";
        document.head.appendChild(style);
        slip = document.createElement("div");
        slip.id = "dragSlip";
        document.body.appendChild(slip);
    }
    // Escape closes the slip, before the settings menu (that script comes later) sees the key
    window.addEventListener("keydown", function (e) {
        if (e.code === "Escape" && slip && slip.classList.contains("open")) { closeSlip(); e.stopImmediatePropagation(); e.preventDefault(); }
    }, true);
    function closeSlip() { if (slip) slip.classList.remove("open"); }
    function plain(t) { return t < 1 ? t.toFixed(3).replace(/^0/, "") : t.toFixed(3); }
    function showSlip(car) {
        build_slip();
        var metric = Settings.option("units") !== "imperial";
        var unit = metric ? "KM/H" : "MPH";
        var speed = function (v) { return (v * (metric ? 3.6 : 2.2369362920544)).toFixed(2); };
        var now = new Date();
        var two = function (n) { return (n < 10 ? "0" : "") + n; };
        var hours = now.getHours() % 12 || 12;
        var track = (typeof currentTrack !== "undefined" && currentTrack && currentTrack.name) || "";
        var carName = (car.config && car.config.name) || "";
        var lines = [];
        lines.push("<div class=\"centre\">WELCOME TO THE\n" + String(track).toUpperCase().slice(0, 28) + "\nDRAG STRIP\nHAVE A SAFE AND\nFUN DAY OF RACING!</div>", "");
        lines.push(hours + ":" + two(now.getMinutes()) + (now.getHours() < 12 ? " AM" : " PM"), two(now.getMonth() + 1) + "/" + two(now.getDate()) + "/" + now.getFullYear(), "");
        lines.push("<div class=\"centre\">TIME SLIP</div>", "");
        lines.push(pad("CAR", carName.toUpperCase().slice(0, 18)), "");
        lines.push(pad("R/T", plain(reaction)));
        results.forEach(function (r) {
            if (r.time === null) return;
            var name = r.label.toUpperCase().replace(" MILE", "").replace(" FT", "");
            lines.push(pad(name, plain(r.time)));
            if (r.finish || r.label === "1/8 mile") lines.push(pad(unit, speed(r.speed)));
        });
        lines.push("", "COMPLETED RUN");
        slip.innerHTML = "<button class=\"close\" title=\"Close (Escape)\">\u00d7</button>" + lines.join("\n").replace(/<\/div>\n/g, "</div>") + "<div class=\"tear\"></div>";
        slip.querySelector(".close").addEventListener("click", closeSlip);
        // from above into the picture (a frame later, so that the transition runs)
        slip.classList.remove("open");
        void slip.offsetWidth;
        slip.classList.add("open");
    }

    // ---- the display
    function build() {
        if (hud) return;
        var style = document.createElement("style");
        style.textContent =
            "#dragHud { position: fixed; left: 50%; top: 70px; transform: translateX(-50%); z-index: 960; display: none; font-family: Arial, sans-serif; color: #fff; text-align: center; " +
            "background: rgba(14, 18, 24, 0.78); border-radius: 12px; padding: 10px 16px 12px; min-width: 240px; text-shadow: 0 1px 3px rgba(0,0,0,0.8); user-select: none; }" +
            "#dragHud .distance { font-size: 26px; font-weight: bold; font-variant-numeric: tabular-nums; }" +
            "#dragHud .note { font-size: 13px; color: #9fb0c4; margin-top: 2px; }" +
            "#dragHud .note.bad { color: #ff6b62; font-weight: bold; font-size: 16px; }" +
            "#dragHud .tree { display: inline-flex; flex-direction: column; align-items: center; gap: 6px; background: #0b0d10; padding: 8px 14px; border-radius: 10px; margin: 8px 0 4px; }" +
            "#dragHud .row { display: flex; gap: 10px; }" +
            "#dragHud .lamp { width: 22px; height: 22px; border-radius: 50%; background: #222831; border: 2px solid #2d343f; }" +
            "#dragHud .lamp.on.white { background: #f2f2f2; box-shadow: 0 0 10px #fff; }" +
            "#dragHud .lamp.on.amber { background: #ffb81c; box-shadow: 0 0 12px #ffb81c; }" +
            "#dragHud .lamp.on.green { background: #2ee26a; box-shadow: 0 0 14px #2ee26a; }" +
            "#dragHud .lamp.on.red { background: #ff3b30; box-shadow: 0 0 14px #ff3b30; }" +
            "#dragHud table { margin: 8px auto 0; border-collapse: collapse; font-size: 14px; font-variant-numeric: tabular-nums; }" +
            "#dragHud td, #dragHud th { padding: 2px 10px; text-align: right; } #dragHud td:first-child, #dragHud th:first-child { text-align: left; }" +
            "#dragHud th { color: #9fb0c4; font-weight: normal; font-size: 12px; } #dragHud tr.done td { color: #fff; } #dragHud tr td { color: #66727f; } #dragHud tr.finish.done td { color: #7ee7a0; font-weight: bold; }";
        document.head.appendChild(style);
        hud = document.createElement("div");
        hud.id = "dragHud";
        document.body.appendChild(hud);
        if (OpenRacer.Movable && !movableDone) { OpenRacer.Movable.make(hud, { key: "dragstrip" }); movableDone = true; }
    }

    function lamp(kind, on) { return "<div class=\"lamp " + kind + (on ? " on" : "") + "\"></div>"; }
    function distanceText(s, metric) {
        var d = -s;
        if (metric) return (Math.abs(d) < 2 ? d.toFixed(2) : d.toFixed(1)) + " m";
        d *= 3.28084;
        return (Math.abs(d) < 6 ? d.toFixed(1) : d.toFixed(0)) + " ft";
    }

    function render(s, clock) {
        build();
        var metric = Settings.option("units") !== "imperial";
        var html = "";
        var show = state !== "idle" && Settings.option("hud");
        if (state === "approach" || state === "tree" || state === "void") {
            html += "<div class=\"distance\">" + (s <= 0 ? "Start line: " + distanceText(s, metric) : "Past the line") + "</div>";
        }
        if (state === "void") html += "<div class=\"note bad\">Drive back behind the line, then come up slowly</div>";
        if (state === "approach") html += "<div class=\"note\">" + (s > STAGE_MIN && s <= STAGE_MAX ? "Stand still at the line" : "Front wheels to the line, slowly") + "</div>";
        if (state === "tree" || state === "go" || state === "false") {
            var t = clock - tTree;
            var green = state === "go" || state === "finished";
            var amber = state === "tree" ? Math.min(3, Math.floor(t / AMBER)) : (green ? 3 : 0);
            html += "<div class=\"tree\"><div class=\"row\">" + lamp("white", true) + lamp("white", true) + "</div>" +
                "<div class=\"row\">" + lamp("amber", amber >= 1) + "</div><div class=\"row\">" + lamp("amber", amber >= 2) + "</div><div class=\"row\">" + lamp("amber", amber >= 3) + "</div>" +
                "<div class=\"row\">" + lamp("green", green && state === "go") + "</div><div class=\"row\">" + lamp("red", state === "false") + "</div></div>";
        }
        if (state === "false") html += "<div class=\"note bad\">FALSE START</div><div class=\"note\">Drive back behind the line and come up slowly</div>";
        if (state === "go" || state === "finished") {
            var rows = results.map(function (r) {
                var sp = r.speed === null ? "" : (metric ? Math.round(r.speed * 3.6) + " km/h" : Math.round(r.speed * 2.2369362920544) + " mph");
                return "<tr class=\"" + (r.time !== null ? "done " : "") + (r.finish ? "finish" : "") + "\"><td>" + r.label + "</td><td>" + (r.time === null ? "–" : r.time.toFixed(3) + " s") + "</td><td>" + sp + "</td></tr>";
            }).join("");
            html += "<table><tr><th>Distance</th><th>Time</th><th>Speed</th></tr>" + rows + "</table>";
            if (t0 !== null || state === "finished") html += "<div class=\"note\">Reaction time " + reaction.toFixed(3) + " s</div>";
            else html += "<div class=\"note\">GO</div>";
        }
        if (html !== lastHtml) { lastHtml = html; hud.innerHTML = html; }
        hud.style.display = show && html ? "block" : "none";
    }

    function setState(next) {
        state = next;
        if (next === "approach" || next === "idle" || next === "void") {
            closeSlip(); t0 = null; results.forEach(function (r) { r.time = null; r.speed = null; }); reaction = 0; }
    }

    function reset() { if (strip) setState("idle"); lastHtml = ""; }

    function update(car, clock) {
        var track = typeof currentTrack !== "undefined" ? currentTrack : null;
        var ds = track && track.dragstrip;
        if (!ds) { if (hud && hud.style.display !== "none") hud.style.display = "none"; return; }
        if (!strip || strip.src !== ds) parse(ds);
        var v = car.vehicle;
        if (!v.wheels || !v.wheels[0] || !v.wheels[0].center) return;
        buildLines(v);
        // the front wheels: the middle between them
        var a = v.wheels[0].center, b = v.wheels[1].center;
        var rx = (a.x + b.x) / 2, rz = (a.z + b.z) / 2;
        var s = (rx - strip.x) * strip.dx + (rz - strip.z) * strip.dz;
        var side = -(rx - strip.x) * strip.dz + (rz - strip.z) * strip.dx;
        var fx = 2 * (v.qx * v.qz + v.qw * v.qy), fz = 1 - 2 * (v.qx * v.qx + v.qy * v.qy), fl = Math.hypot(fx, fz) || 1;
        var aligned = (fx * strip.dx + fz * strip.dz) / fl > 0.8;
        var speed = Math.abs(v.u), forwardSpeed = v.u;
        var inLane = Math.abs(side) <= strip.width / 2 + 1;

        switch (state) {
            case "idle":
            case "approach":
            case "void":
                if (!inLane || s < -45 || s > strip.length + 60) { if (state !== "idle") setState("idle"); break; }
                if (state === "void") { if (s < -3) setState("approach"); break; }
                if (s > 5 && speed > 1) { setState("void"); break; }
                if (state === "idle") setState("approach");
                if (s >= STAGE_MIN && s <= STAGE_MAX && speed < 1.5 && aligned) { state = "tree"; tTree = clock; stagedS = s; }
                break;
            case "tree":
                if (s > stagedS + ROLLOUT) { state = "false"; break; }                  // away before the green light
                if (s < STAGE_MIN - 0.5 || !inLane) { state = "approach"; break; }       // back off: not staged
                if (clock - tTree >= 3 * AMBER + AMBER) { state = "go"; tGreen = tTree + 4 * AMBER; t0 = null; results.forEach(function (r) { r.time = null; r.speed = null; }); prevT = clock; prevS = s; prevV = forwardSpeed; }
                break;
            case "go":
                if (t0 === null) {
                    if (s >= stagedS + ROLLOUT) {
                        var f = (stagedS + ROLLOUT - prevS) / Math.max(1e-6, s - prevS);
                        t0 = prevT + (clock - prevT) * Math.max(0, Math.min(1, f));
                        reaction = t0 - tGreen;
                    }
                }
                if (t0 !== null) {
                    for (var i = 0; i < results.length; i++) {
                        var r = results[i];
                        if (r.time === null && s >= r.metres) {
                            var k = (r.metres - prevS) / Math.max(1e-6, s - prevS);
                            k = Math.max(0, Math.min(1, k));
                            r.time = prevT + (clock - prevT) * k - t0;
                            r.speed = prevV + (forwardSpeed - prevV) * k;
                        }
                    }
                    if (s >= strip.length) { state = "finished"; showSlip(car); }
                    else if (s < stagedS - 1 || !inLane && Math.abs(side) > strip.width) setState("void");   // back, or off the strip: no run
                }
                break;
            case "false":
            case "finished":
                if (s < -3 && inLane) setState("approach");
                break;
        }
        prevT = clock; prevS = s; prevV = forwardSpeed;
        render(s, clock);
    }

    return { update: update, reset: reset, get state() { return state; } };
})();
