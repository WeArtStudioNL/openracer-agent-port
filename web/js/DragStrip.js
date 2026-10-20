/*
 * DragStrip.js
 *
 * Description: The drag strip of a track (track.json "dragstrip": { x, z, heading, width, length }, placed in the track editor: the start line, the way
 *              the strip goes, and how far the finish line is). The front wheels of the car are the reference, as the beams of a real strip are.
 *              - Near the start line (within 45 m, in the lane) a text shows how far the front wheels are from the line.
 *              - With the front wheels at the line (a margin of a few decimetres) and the car standing nearly still, "Get ready" shows for two seconds
 *                (time to switch on the two-step), and then the lights come: stage, three ambers one after the other (half a second apart) and green;
 *                the lights go out again a second and a half after the green. The timing starts when the car leaves the line (30 cm), the reaction
 *                time is that moment minus the green light.
 *              - Leaving before the green light is a false start: a red light, the run is over and the car has to go back behind the line (3 m)
 *                and come up slowly to the line again. A car that passes the line without staging has no run until it has gone back too.
 *              - The times and the speeds are only shown at the end, on the time slip, for the standard distances within the length (60 ft, 330 ft,
 *                1/8 mile, 1000 ft, 1/4 mile, ...) and the finish.
 *              At the finish a time slip slides in from the top at the right of the screen, with the times on it; the cross or Escape closes it.
 *              The lines on the road are drawn: a white start line and a chequered finish line.
 */

OpenRacer.DragStrip = (function () {
    var MARKS = [["60 ft", 18.288], ["330 ft", 100.584], ["1/8 mile", 201.168], ["1000 ft", 304.8], ["1/4 mile", 402.336], ["1/2 mile", 804.672], ["1 km", 1000], ["1 mile", 1609.344]];
    var STAGE_MIN = -0.4, STAGE_MAX = 0.25;      // m: the front wheels at the line
    var ROLLOUT = 0.3;                           // m: the car has left the line
    var AMBER = 0.5;                             // s between the lights of the tree
    // "Get ready" before the tree (2 s) and how long the tree stays after the green light (1.5 s): the settings menu sets them
    function ready() { var v = Settings.option("dragReady"); return v > 0 ? v : 2; }
    function greenShown() { var v = Settings.option("dragGreen"); return v > 0 ? v : 1.5; }
    var strip = null, state = "idle", lines = null, hud = null, movableDone = false;
    var slip = null, topSpeed = 0, launchAids = [], holding = false;
    var tReady = 0, tTree = 0, stagedS = 0, tGreen = 0, t0 = null, reaction = 0, results = [], prevT = 0, prevS = 0, prevV = 0, finishNote = "", lastHtml = "";

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


    // ---- layers that Escape closes, the last one opened first (the time slip, a list, a window); this script comes before the settings menu, so the key is ours first
    var closers = [];
    function onEscape(fn) { closers.push(fn); return function () { var i = closers.indexOf(fn); if (i >= 0) closers.splice(i, 1); }; }
    window.addEventListener("keydown", function (e) {
        if (e.code === "Escape" && closers.length) { var fn = closers.pop(); fn(); e.stopImmediatePropagation(); e.preventDefault(); }
    }, true);

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
            "#dragSlip { position: fixed; right: 22px; top: 14px; z-index: 3200; width: 330px; box-sizing: border-box; padding: 18px 18px 30px; color: #1b1b1b; background: #f4f1e8; " +
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
    var slipOff = null;
    function closeSlip() {
        if (slip) slip.classList.remove("open");
        if (slipOff) { var f = slipOff; slipOff = null; f(); }
    }
    function plain(t) { return t < 1 ? t.toFixed(3).replace(/^0/, "") : t.toFixed(3); }
    // a ticket of a run: { track, car, date, reaction, marks: [{ label, time, speed, finish }] }
    function ticket(data) {
        build_slip();
        var metric = Settings.option("units") !== "imperial";
        var unit = metric ? "KM/H" : "MPH";
        var speed = function (v) { return (v * (metric ? 3.6 : 2.2369362920544)).toFixed(2); };
        var now = new Date(data.date);
        var two = function (n) { return (n < 10 ? "0" : "") + n; };
        var hours = now.getHours() % 12 || 12;
        var lines = [];
        lines.push("<div class=\"centre\">WELCOME TO THE\n" + String(data.track || "").toUpperCase().slice(0, 28) + "\nDRAG STRIP\nHAVE A SAFE AND\nFUN DAY OF RACING!</div>", "");
        lines.push(hours + ":" + two(now.getMinutes()) + (now.getHours() < 12 ? " AM" : " PM"), two(now.getMonth() + 1) + "/" + two(now.getDate()) + "/" + now.getFullYear(), "");
        lines.push("<div class=\"centre\">TIME SLIP</div>", "");
        lines.push(pad("CAR", String(data.car || "").toUpperCase().slice(0, 18)), "");
        lines.push(pad("R/T", plain(data.reaction)));
        data.marks.forEach(function (r) {
            var name = r.label.toUpperCase().replace(" MILE", "").replace(" FT", "");
            lines.push(pad(name, plain(r.time)));
            if (r.finish || r.label === "1/8 mile") lines.push(pad(unit, speed(r.speed)));
        });
        lines.push("", "COMPLETED RUN");
        slip.innerHTML = "<button class=\"close\" title=\"Close (Escape)\">×</button>" + lines.join("\n").replace(/<\/div>\n/g, "</div>") + "<div class=\"tear\"></div>";
        slip.querySelector(".close").addEventListener("click", closeSlip);
        // from above into the picture (a frame later, so that the transition runs)
        slip.classList.remove("open");
        void slip.offsetWidth;
        slip.classList.add("open");
        if (slipOff) slipOff();
        slipOff = onEscape(closeSlip);
    }

    // ---- what the run is kept with: the car and its tuning
    function summary(car) {
        var v = car.vehicle, e = v.engine, nmMax = 0, nmRpm = 0, kwMax = 0, kwRpm = 0;
        e.torque_curve.forEach(function (p) {
            var nm = p.nm * e.torqueScale, kw = nm * p.rpm * Math.PI / 30 / 1000;
            if (nm > nmMax) { nmMax = nm; nmRpm = p.rpm; }
            if (kw > kwMax) { kwMax = kw; kwRpm = p.rpm; }
        });
        var kind = v.tyreKind ? v.tyreKind() : null, x = e.extras || {};
        return {
            mass: Math.round(v.mass), front: Math.round(v.weight_distribution * 1000) / 10, drive: v.driveType, gearbox: car.gearboxMode,
            kw: Math.round(kwMax), kwRpm: kwRpm, hp: Math.round(kwMax * 1.34102), nm: Math.round(nmMax), nmRpm: nmRpm,
            limiter: Math.round(e.limiterRPM), twoStepRpm: Math.round(e.twoStepRPM), launchRpm: Math.round(e.launchRPM),
            turbo: e.turboShare > 0 ? { share: Math.round(e.turboShare * 100), boost: x.boost_full || null, spool: e.turboSpool } : null,
            gears: (car.gear_ratios || []).map(function (g) { return Math.round(g * 1000) / 1000; }), finalDrive: car.final_drive,
            tyres: kind ? kind.name : "", pressure: [Math.round(v.pressureFront * 10) / 10, Math.round(v.pressureRear * 10) / 10],
            tc: !!v.tcEnabled, abs: !!v.absEnabled, esc: !!v.escEnabled, shiftTime: v.shiftTime,
            pops: !!x.pops_on, antilag: !!x.antilag_on
        };
    }
    function runData(car) {
        var marks = results.filter(function (r) { return r.time !== null; }).map(function (r) { return { label: r.label, metres: r.metres, time: r.time, speed: r.speed, finish: !!r.finish }; });
        var at = function (m) { var r = marks.filter(function (x) { return Math.abs(x.metres - m) < 0.5; })[0]; return r ? r.time : null; };
        var track = (typeof currentTrack !== "undefined" && currentTrack) || {};
        return {
            track: track.name || "", car: (car.config && car.config.name) || "", carId: (car.config && car.config.id) || "", date: new Date().toISOString(),
            reaction: reaction, marks: marks, length: strip.length, time: marks[marks.length - 1].time, quarter: at(402.336), half: at(804.672),
            topSpeed: topSpeed, aids: launchAids.slice(), info: summary(car)
        };
    }
    // at the finish: the run is kept (when the records are on) and the slip comes
    function finishRun(car) {
        var data = runData(car);
        var track = (typeof currentTrack !== "undefined" && currentTrack) || null;
        var saving = !(typeof race !== "undefined" && race && race.options && race.options.records === false);
        if (saving && track && track.id && OpenRacer.Records && OpenRacer.Records.dragRun) OpenRacer.Records.dragRun(track.id, data);
        ticket(data);
    }

    // ---- the top 50 of a track (from the main menu) and the window of a car
    var topStyle = false;
    function modalStyle() {
        if (topStyle) return;
        topStyle = true;
        var style = document.createElement("style");
        style.textContent =
            ".dragModal { position: fixed; left: 0; top: 0; width: 100%; height: 100%; z-index: 3150; background: rgba(0, 0, 0, 0.66); display: flex; align-items: center; justify-content: center; font-family: Arial, sans-serif; color: #fff; }" +
            ".dragModal.over { z-index: 3160; }" +
            ".dragModal .box { position: relative; width: 760px; max-width: calc(100% - 40px); max-height: calc(100% - 50px); overflow-y: auto; background: #1d232c; border: 2px solid #2c3541; border-radius: 10px; padding: 18px 22px 20px; }" +
            ".dragModal .box.narrow { width: 460px; }" +
            ".dragModal h2 { margin: 0 34px 2px 0; font-size: 22px; letter-spacing: 1px; } .dragModal .sub { color: #9aa8ba; font-size: 13px; margin-bottom: 12px; }" +
            ".dragModal .x { position: absolute; right: 10px; top: 8px; width: 30px; height: 30px; border: 0; background: transparent; color: #cfd8e3; font-size: 24px; cursor: pointer; border-radius: 6px; } .dragModal .x:hover { background: #2c3541; }" +
            ".dragModal table { width: 100%; border-collapse: collapse; font-size: 15px; font-variant-numeric: tabular-nums; }" +
            ".dragModal th { text-align: right; color: #9ab; font-weight: normal; font-size: 12px; letter-spacing: 1px; text-transform: uppercase; padding: 4px 8px; border-bottom: 1px solid #2c3541; }" +
            ".dragModal td { text-align: right; padding: 6px 8px; border-bottom: 1px solid #262d37; } .dragModal th:first-child, .dragModal td:first-child { text-align: left; width: 34px; color: #7f90a5; }" +
            ".dragModal th.l, .dragModal td.l { text-align: left; width: auto; color: #fff; }" +
            ".dragModal a.car { color: #6db4ff; cursor: pointer; text-decoration: underline; } .dragModal a.car:hover { color: #a5d0ff; }" +
            ".dragModal button.ticket { background: #3b424c; color: #fff; border: 0; border-radius: 5px; padding: 4px 12px; cursor: pointer; font-size: 13px; } .dragModal button.ticket:hover { background: #566070; }" +
            ".dragModal .group { margin: 14px 0 4px; font-size: 12px; letter-spacing: 2px; color: #9ab; text-transform: uppercase; }" +
            ".dragModal .kv { display: flex; justify-content: space-between; gap: 14px; padding: 4px 0; border-bottom: 1px solid #262d37; font-size: 14px; } .dragModal .kv span:first-child { color: #9aa8ba; } .dragModal .kv span:last-child { text-align: right; }" +
            ".dragModal .empty { color: #9aa8ba; padding: 18px 0; }" +
            ".dragModal .tabs { display: flex; gap: 6px; flex-wrap: wrap; margin: 0 0 10px; } .dragModal .tab { background: #2b323c; color: #cfd8e3; border: 0; border-radius: 6px; padding: 6px 14px; cursor: pointer; font-size: 14px; } .dragModal .tab:hover { background: #38414d; } .dragModal .tab.on { background: #3aa86b; color: #fff; }";
        document.head.appendChild(style);
    }
    function modal(extra) {
        modalStyle();
        var overlay = document.createElement("div");
        overlay.className = "dragModal" + (extra ? " " + extra : "");
        var box = document.createElement("div");
        box.className = "box" + (extra === "over" ? " narrow" : "");
        var x = document.createElement("button");
        x.className = "x"; x.textContent = "×"; x.title = "Close (Escape)";
        box.appendChild(x);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        var off = null;
        var close = function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); if (off) { var f = off; off = null; f(); } };
        x.addEventListener("click", close);
        overlay.addEventListener("pointerdown", function (e) { if (e.target === overlay) close(); });
        off = onEscape(close);
        return { box: box, close: close };
    }
    function kv(label, value) { return "<div class=\"kv\"><span>" + label + "</span><span>" + value + "</span></div>"; }
    function when(iso) { var d = new Date(iso); return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }

    // the most important of the tuning and of the car of a run, in a window that scrolls
    function showCar(run) {
        var m = modal("over"), i = run.info || {}, metric = Settings.option("units") !== "imperial";
        var drive = { rwd: "Rear wheels", fwd: "Front wheels", awd: "All wheels" }[i.drive] || i.drive || "";
        var html = "<h2>" + run.car + "</h2><div class=\"sub\">" + when(run.date) + "</div>";
        html += "<div class=\"group\">Car</div>" + kv("Mass", (i.mass || "?") + " kg") + kv("Weight on the front axle", (i.front || "?") + " %") + kv("Drive", drive) +
            kv("Gearbox", i.gearbox || "") + kv("Tyres", (i.tyres || "") + (i.pressure ? " · " + i.pressure[0] + " / " + i.pressure[1] + " bar" : ""));
        html += "<div class=\"group\">Engine</div>" + kv("Power", i.hp ? i.hp + " hp (" + i.kw + " kW) at " + i.kwRpm + " rpm" : "") + kv("Torque", i.nm ? i.nm + " Nm at " + i.nmRpm + " rpm" : "") +
            kv("Rev limit", (i.limiter || "") + " rpm") + (i.turbo ? kv("Turbo", i.turbo.share + " % boost" + (i.turbo.boost ? ", " + i.turbo.boost + " bar" : "") + ", spool " + (i.turbo.spool || 0).toFixed(2) + " s") : kv("Turbo", "none"));
        html += "<div class=\"group\">Transmission</div>" + kv("Final drive", i.finalDrive || "") + kv("Gears", (i.gears || []).join(" · ")) + kv("Shift time", (i.shiftTime || 0).toFixed(2) + " s");
        html += "<div class=\"group\">Launch and extras</div>" + kv("Used on the start", (run.aids && run.aids.length) ? run.aids.join(", ") : "none") +
            kv("Two-step speed", (i.twoStepRpm || "") + " rpm") + kv("Launch control speed", (i.launchRpm || "") + " rpm") +
            kv("Pops and bangs", i.pops ? "on" : "off") + kv("Anti-lag", i.antilag ? "on" : "off") +
            kv("Traction control / ABS / ESC", [i.tc, i.abs, i.esc].map(function (b) { return b ? "on" : "off"; }).join(" / "));
        html += "<div class=\"group\">Run</div>" + kv("Reaction time", plain(run.reaction) + " s") + kv("Time", run.time.toFixed(3) + " s") + kv("Top speed", (run.topSpeed * (metric ? 3.6 : 2.2369362920544)).toFixed(1) + (metric ? " km/h" : " mph"));
        var holder = document.createElement("div");
        holder.innerHTML = html;
        m.box.appendChild(holder);
    }

    function lengthName(length) {
        var named = MARKS.filter(function (x) { return Math.abs(x[1] - length) < 0.5; })[0];
        return named ? named[0] : Math.round(length) + " m";
    }

    // the top 50 of a track, with a tab for every distance that has runs (and the distance of the strip as it is now)
    function showTop(track) {
        var ds = track && track.dragstrip;
        if (!ds) return;
        var metric = Settings.option("units") !== "imperial";
        var current = ds.length || 402.336;
        var lengths = [current];
        OpenRacer.Records.dragRuns(track.id).forEach(function (run) { if (!lengths.some(function (l) { return Math.abs(l - run.length) < 0.5; })) lengths.push(run.length); });
        lengths.sort(function (a, b) { return a - b; });
        var chosen = current;
        var m = modal();
        var head = document.createElement("div");
        head.innerHTML = "<h2>Top 50 · drag strip</h2><div class=\"sub\">" + (track.name || track.id) + " · the best runs in this browser</div>";
        m.box.appendChild(head);
        var tabs = document.createElement("div");
        tabs.className = "tabs";
        m.box.appendChild(tabs);
        var body = document.createElement("div");
        m.box.appendChild(body);
        function render() {
            tabs.innerHTML = "";
            lengths.forEach(function (length) {
                var tab = document.createElement("button");
                tab.className = "tab" + (Math.abs(length - chosen) < 0.5 ? " on" : "");
                tab.textContent = lengthName(length);
                tab.addEventListener("click", function () { chosen = length; render(); });
                tabs.appendChild(tab);
            });
            body.innerHTML = "";
            var runs = OpenRacer.Records.dragRuns(track.id, chosen).slice(0, 50);
            if (!runs.length) { var empty = document.createElement("div"); empty.className = "empty"; empty.textContent = "No runs over this distance yet. Drive the strip and your runs are kept here (while \"Save lap records\" is on in the main menu)."; body.appendChild(empty); return; }
            var table = document.createElement("table");
            table.innerHTML = "<tr><th>#</th><th class=\"l\">Car</th><th>1/4 mile</th><th>2/4 mile</th><th>Top speed</th><th></th></tr>";
            runs.forEach(function (run, n) {
                var tr = document.createElement("tr");
                var t = function (v) { return v === null || v === undefined ? "–" : v.toFixed(3) + " s"; };
                tr.innerHTML = "<td>" + (n + 1) + "</td><td class=\"l\"></td><td>" + t(run.quarter) + "</td><td>" + t(run.half) + "</td><td>" + Math.round(run.topSpeed * (metric ? 3.6 : 2.2369362920544)) + (metric ? " km/h" : " mph") + "</td><td></td>";
                var link = document.createElement("a");
                link.className = "car"; link.textContent = run.car || run.carId; link.title = "Car and tuning of this run";
                link.addEventListener("click", function () { showCar(run); });
                tr.children[1].appendChild(link);
                var button = document.createElement("button");
                button.className = "ticket"; button.textContent = "Ticket"; button.title = "The ticket of this run";
                button.addEventListener("click", function () { ticket(run); });
                tr.children[5].appendChild(button);
                table.appendChild(tr);
            });
            body.appendChild(table);
        }
        render();
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
        if (state === "approach" || state === "void") {
            html += "<div class=\"distance\">" + (s <= 0 ? "Start line: " + distanceText(s, metric) : "Past the line") + "</div>";
        }
        if (state === "void") html += "<div class=\"note bad\">Drive back behind the line, then come up slowly</div>";
        if (state === "approach") html += "<div class=\"note\">" + (s > STAGE_MIN && s <= STAGE_MAX ? "Stand still at the line" : "Front wheels to the line, slowly") + "</div>";
        if (state === "ready") html += "<div class=\"distance\">Get ready…</div><div class=\"note\">Hold the car still at the line</div>";
        var showTree = state === "tree" || state === "false" || (state === "go" && clock - tGreen < greenShown());
        if (showTree) {
            var t = clock - tTree;
            var green = state === "go";
            var amber = state === "tree" ? Math.min(3, Math.floor(t / AMBER)) : (green ? 3 : 0);
            html += "<div class=\"tree\"><div class=\"row\">" + lamp("white", true) + lamp("white", true) + "</div>" +
                "<div class=\"row\">" + lamp("amber", amber >= 1) + "</div><div class=\"row\">" + lamp("amber", amber >= 2) + "</div><div class=\"row\">" + lamp("amber", amber >= 3) + "</div>" +
                "<div class=\"row\">" + lamp("green", green) + "</div><div class=\"row\">" + lamp("red", state === "false") + "</div></div>";
        }
        if (state === "false") html += "<div class=\"note bad\">FALSE START</div><div class=\"note\">Drive back behind the line and come up slowly</div>";
        if (html !== lastHtml) { lastHtml = html; hud.innerHTML = html; }
        hud.style.display = show && html ? "block" : "none";
    }

    function setState(next) {
        state = next;
        if (next === "approach" || next === "idle" || next === "void") {
            closeSlip(); topSpeed = 0; launchAids = []; t0 = null; results.forEach(function (r) { r.time = null; r.speed = null; }); reaction = 0; }
    }

    function reset() { if (strip) setState("idle"); lastHtml = ""; }

    // what holds the engine at the start (kept with the run)
    function trackAids(v) {
        [[v.twoStepActive, "Two-step"], [v.lcArmed, "Launch control"], [v.transbrakeHeld, "Transbrake"]].forEach(function (p) { if (p[0] && launchAids.indexOf(p[1]) < 0) launchAids.push(p[1]); });
    }

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
                if (s >= STAGE_MIN && s <= STAGE_MAX && speed < 1.5 && aligned) { state = "ready"; tReady = clock; }
                break;
            case "ready":
                trackAids(v);
                // standing still at the line: two seconds to get ready (the two-step on), then the lights; moving away cancels it
                if (s < STAGE_MIN - 0.3 || s > STAGE_MAX + 0.3 || speed > 1.5 || !inLane) { state = "approach"; break; }
                if (clock - tReady >= ready()) { state = "tree"; tTree = clock; stagedS = s; }
                break;
            case "tree":
                trackAids(v);
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
                    topSpeed = Math.max(topSpeed, speed);
                    for (var i = 0; i < results.length; i++) {
                        var r = results[i];
                        if (r.time === null && s >= r.metres) {
                            var k = (r.metres - prevS) / Math.max(1e-6, s - prevS);
                            k = Math.max(0, Math.min(1, k));
                            r.time = prevT + (clock - prevT) * k - t0;
                            r.speed = prevV + (forwardSpeed - prevV) * k;
                        }
                    }
                    if (s >= strip.length) { state = "finished"; finishRun(car); }
                    else if (s < stagedS - 1 || !inLane && Math.abs(side) > strip.width) setState("void");   // back, or off the strip: no run
                }
                break;
            case "false":
            case "finished":
                if (s < -3 && inLane) setState("approach");
                break;
        }
        prevT = clock; prevS = s; prevV = forwardSpeed;
        // at the line the brake key holds the car for the start: the automatic gearbox must not turn it into reverse (Car.js)
        holding = state === "ready" || state === "tree" || state === "go" || state === "false" || (state === "approach" && s > -2 && s < 1);
        render(s, clock);
    }

    return { update: update, reset: reset, showTop: showTop, ticket: ticket, get state() { return state; }, get holding() { return holding; } };
})();
