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
 *              - At every distance within the length (60 ft, 330 ft, 1/8 mile, 1000 ft, 1/4 mile, ...) and at the finish, the time and the speed
 *                of the run there come as a notification at the top right: they stack, and each stays five seconds.
 *              At the finish a time slip slides in from the top at the right of the screen, with the times on it; the cross or Escape closes it.
 *              The lines on the road are drawn: a white start line, a white line at every distance, and a chequered finish line. The lights are on a tree: a pole in the middle of the strip, twelve metres past the start line, with
 *              glowing lamps (pre-stage, stage, three ambers, green and red); the HUD only has the text (the distance to the line and what to do).
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

    // The tree: a pole in the middle of the strip, with a dark head that faces the cars at the line. Its lights are materials that glow: an emissive
    // colour that goes up with the light, and a soft additive halo (a sprite) round the lit lamp.
    var treeLamps = null, treeKey = "";
    var LAMP_COLOURS = { white: 0xffffff, amber: 0xffb81c, green: 0x2ee26a, red: 0xff3b30 };
    function haloTexture() {
        var c = document.createElement("canvas"); c.width = c.height = 64;
        var g = c.getContext("2d"), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        grad.addColorStop(0, "rgba(255,255,255,1)"); grad.addColorStop(0.25, "rgba(255,255,255,0.55)"); grad.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
        var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    }
    function buildTree(group, v) {
        // in the middle of the strip, twelve metres past the start line (it is a picture: a car drives through it)
        var along = 12, side = 0, sx = strip.dz, sz = -strip.dx;
        var x = strip.x + strip.dx * along + sx * side, z = strip.z + strip.dz * along + sz * side;
        var hit = v.ground.query(x, z, v.py + 5, 40), y = hit ? hit.y : v.py - v.cgHeight;
        var tree = new THREE.Group();
        tree.position.set(x, y, z);
        tree.rotation.y = Math.atan2(-strip.dx, -strip.dz);                      // the face looks back along the strip, to the cars at the line
        var steel = new THREE.MeshStandardMaterial({ color: 0x59606a, metalness: 0.7, roughness: 0.45 });
        var plastic = new THREE.MeshStandardMaterial({ color: 0x0c0e11, metalness: 0.1, roughness: 0.6 });
        var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.4, 12), steel);
        pole.position.y = 1.7; tree.add(pole);
        var base = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.12, 16), steel);
        base.position.y = 0.06; tree.add(base);
        var head = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.0, 0.26), plastic);
        head.position.set(0, 3.55, 0); tree.add(head);
        var hood = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.06, 0.4), plastic);
        hood.position.set(0, 4.58, 0.07); tree.add(hood);
        var halo = haloTexture();
        treeLamps = []; treeKey = "";              // (a new tree is dark: its lamps are lit again at the next change)
        // two columns (the two lanes of a real tree), each: the pre-stage and the stage lamp, three ambers, the green and the red
        [-0.25, 0.25].forEach(function (cx) {
            [["white", 4.38], ["white", 4.2], ["amber", 3.95], ["amber", 3.7], ["amber", 3.45], ["green", 3.15], ["red", 2.9]].forEach(function (row, n) {
                var kind = row[0], colour = LAMP_COLOURS[kind];
                var material = new THREE.MeshStandardMaterial({ color: 0x15181d, emissive: colour, emissiveIntensity: 0, metalness: 0, roughness: 0.25 });
                var lamp = new THREE.Mesh(new THREE.SphereGeometry(kind === "white" ? 0.065 : 0.1, 20, 14), material);
                lamp.position.set(cx, row[1], 0.15);
                tree.add(lamp);
                var sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo, color: colour, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
                sprite.scale.setScalar(kind === "white" ? 0.5 : 0.75);
                sprite.position.set(cx, row[1], 0.22);
                sprite.userData.noGBuffer = true;
                tree.add(sprite);
                treeLamps.push({ kind: kind, index: n, material: material, sprite: sprite, colour: colour });
            });
        });
        tree.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
        group.add(tree);
        attachRecord();
    }
    // The lamps in a replay (Replay.js): the game does not run in a replay, so the tree kept the lamps it had when the replay began. Every change of the lamps is a row of
    // the recording (the time; 1 or -1 for lit or all dark; white, amber, green, red), and the replay lights them again, also after a jump (the last row before that time).
    // (Replay.js is loaded after this file: the recording is attached when the tree is made)
    var lampRecord = { replayLookback: 0 }, lampsOn = null, recordAttached = false;
    function attachRecord() {
        if (recordAttached || !OpenRacer.Replay || !OpenRacer.Replay.attach) return;
        OpenRacer.Replay.attach("dragTree", lampRecord);
        recordAttached = true;
    }
    function lampsOfRow(row) { return row[1] < 0 ? null : { white: row[2] > 0.5, amber: row[3], green: row[4] > 0.5, red: row[5] > 0.5 }; }
    lampRecord.replayAdd = function (row) { drawLamps(lampsOfRow(row)); };
    lampRecord.replayStep = function () {};
    lampRecord.replayClear = function () { drawLamps(null); };
    lampRecord.replayRebuild = function (rows, end) { drawLamps(end > 0 ? lampsOfRow(rows[end - 1]) : null); };
    lampRecord.replaySnapshot = function () { return { on: lampsOn }; };
    lampRecord.replayRestore = function (snap) { drawLamps(snap.on); };

    // which lamps are lit: { white, amber (0..3), green, red } or null for all dark; a change is recorded for the replay
    function setLamps(on) {
        if (!treeLamps) return;
        if (!drawLamps(on)) return;
        attachRecord();
        if (lampRecord.recorder) lampRecord.recorder(Float32Array.of(0, on ? 1 : -1, on && on.white ? 1 : 0, on ? on.amber : 0, on && on.green ? 1 : 0, on && on.red ? 1 : 0));
    }
    // the lamps lit as they are asked (true when that changed them)
    function drawLamps(on) {
        if (!treeLamps) return false;
        var key = on ? [on.white ? 1 : 0, on.amber, on.green ? 1 : 0, on.red ? 1 : 0].join("") : "";
        if (key === treeKey) return false;
        treeKey = key;
        lampsOn = on ? { white: !!on.white, amber: on.amber, green: !!on.green, red: !!on.red } : null;
        treeLamps.forEach(function (l, n) {
            // (the rows: 0, 1 white; 2, 3, 4 amber; 5 green; 6 red; the same in the second column)
            var row = n % 7, lit = false;
            if (on) lit = row < 2 ? on.white : row < 5 ? (row - 1) <= on.amber : row === 5 ? on.green : on.red;
            l.material.emissiveIntensity = lit ? 2.4 : 0;
            l.material.color.setHex(lit ? l.colour : 0x15181d);
            l.sprite.material.opacity = lit ? 0.6 : 0;
        });
        return true;
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
            var material = new THREE.MeshBasicMaterial({ color: 0xffffff, map: textured ? checker() : null, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1.5, polygonOffsetUnits: -1.5, side: THREE.DoubleSide });       // (not more: a strong offset draws the line over the lower part of a tyre that stands on it, as if the line held the tyre)
            var mesh = new THREE.Mesh(new THREE.PlaneGeometry(strip.width, textured ? 1.2 : 0.35), material);
            mesh.rotation.x = -Math.PI / 2;
            mesh.rotation.z = Math.atan2(-strip.dx, -strip.dz);
            mesh.position.set(x, y + 0.012, z);
            mesh.renderOrder = 3;
            mesh.userData.noGBuffer = true;
            group.add(mesh);
            return true;
        };
        if (!make(0, false) || !make(strip.length, true)) return;
        // a white line for every distance of the run (the finish has its chequered line)
        results.forEach(function (r) { if (!r.finish) make(r.metres, false); });
        buildTree(group, v);
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
    // a name (of a car, of a track: from a car.json or a track.json, which can come from someone else's zip) as text in markup
    function htmlText(text) {
        return String(text).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]; });
    }
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
            "#dragSlip .download { position: absolute; right: 36px; top: 6px; width: 24px; height: 24px; padding: 0; border: 0; background: transparent; color: #444; cursor: pointer; line-height: 0; }" +
            "#dragSlip .download:hover { color: #000; }" +
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
    // the slip as a PNG, drawn from its rows (the same text as on the page), at twice the size for a sharp picture
    function downloadSlip(rows, data) {
        var scale = 2, width = 330 * scale, inset = 18 * scale, lineH = 14 * 1.45 * scale;
        var canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = inset + rows.length * lineH + 30 * scale;
        var g = canvas.getContext("2d");
        g.fillStyle = "#f4f1e8"; g.fillRect(0, 0, canvas.width, canvas.height);
        g.fillStyle = "#1b1b1b"; g.font = (14 * scale) + "px 'Courier New', Courier, monospace"; g.textBaseline = "top";
        rows.forEach(function (r, n) {
            if (!r.text) return;
            g.textAlign = r.centre ? "center" : "left";
            g.fillText(r.text, r.centre ? width / 2 : inset, inset + n * lineH);
        });
        var name = "time-slip-" + String(data.track || "run").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + new Date(data.date).toISOString().slice(0, 16).replace(/[:T]/g, "-") + ".png";
        var a = document.createElement("a");
        a.href = canvas.toDataURL("image/png");
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
    }
    // a ticket of a run: { track, car, date, reaction, marks: [{ label, time, speed, finish }] }
    function ticket(data) {
        build_slip();
        var metric = Settings.option("units") !== "imperial";
        var unit = metric ? "KM/H" : "MPH";
        var speed = function (v) { return (v * (metric ? 3.6 : 2.2369362920544)).toFixed(2); };
        var now = new Date(data.date);
        var two = function (n) { return (n < 10 ? "0" : "") + n; };
        var hours = now.getHours() % 12 || 12;
        // the slip as rows of text ({ text, centre }): the page and the PNG are both drawn from these
        var rows = [];
        var row = function (text, centre) { rows.push({ text: String(text), centre: !!centre }); };
        ["WELCOME TO THE", String(data.track || "").toUpperCase().slice(0, 28), "DRAG STRIP", "HAVE A SAFE AND", "FUN DAY OF RACING!"].forEach(function (t) { row(t, true); });
        row("");
        row(hours + ":" + two(now.getMinutes()) + (now.getHours() < 12 ? " AM" : " PM"));
        row(two(now.getMonth() + 1) + "/" + two(now.getDate()) + "/" + now.getFullYear());
        row("");
        row("TIME SLIP", true);
        row("");
        row(pad("CAR", String(data.car || "").toUpperCase().slice(0, 18)));
        row("");
        row(pad("R/T", plain(data.reaction)));
        data.marks.forEach(function (r) {
            var name = r.label.toUpperCase().replace(" MILE", "").replace(" FT", "");
            row(pad(name, plain(r.time)));
            if (r.finish || r.label === "1/8 mile") row(pad(unit, speed(r.speed)));
        });
        row("");
        row("COMPLETED RUN");
        var download = "<svg viewBox=\"0 0 24 24\" width=\"18\" height=\"18\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 4v11\"/><path d=\"M7 10l5 5 5-5\"/><path d=\"M5 20h14\"/></svg>";
        slip.innerHTML = "<button class=\"close\" title=\"Close (Escape)\">×</button><button class=\"download\" title=\"Download as PNG\">" + download + "</button>" +
            rows.map(function (r) { return "<div" + (r.centre ? " class=\"centre\"" : "") + ">" + (htmlText(r.text) || " ") + "</div>"; }).join("") + "<div class=\"tear\"></div>";
        slip.querySelector(".close").addEventListener("click", closeSlip);
        slip.querySelector(".download").addEventListener("click", function () { downloadSlip(rows, data); });
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
            turbo: e.hasTurbo() ? { share: Math.round(e.turboShare * 100), bar: e.turboBar > 0 ? Math.round(e.turboBar * 100) / 100 : null, boost: x.boost_full || null, spool: e.turboSpool } : null,
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
            kv("Rev limit", (i.limiter || "") + " rpm") + (i.turbo ? kv("Turbo", (i.turbo.bar ? i.turbo.bar + " bar boost" : i.turbo.share + " % boost" + (i.turbo.boost ? ", " + i.turbo.boost + " bar" : "")) + ", spool " + (i.turbo.spool || 0).toFixed(2) + " s") : kv("Turbo", "none"));
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
        head.innerHTML = "<h2>Top 50 · drag strip</h2><div class=\"sub\">" + htmlText(track.name || track.id) + " · the best runs in this browser</div>";
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
            // (the time of the run at this distance, its R/T, and the 1/4 and 1/2 mile only where the strip reaches them: a strip of 1/8 mile or 1000 ft showed "–" in every row)
            var withQuarter = chosen > 402.336 + 0.5, withHalf = chosen > 804.672 + 0.5;
            table.innerHTML = "<tr><th>#</th><th class=\"l\">Car</th><th>R/T</th><th>Time</th>" + (withQuarter ? "<th>1/4 mile</th>" : "") + (withHalf ? "<th>1/2 mile</th>" : "") + "<th>Top speed</th><th></th></tr>";
            runs.forEach(function (run, n) {
                var tr = document.createElement("tr");
                var t = function (v) { return v === null || v === undefined || !isFinite(v) ? "–" : v.toFixed(3) + " s"; };
                tr.innerHTML = "<td>" + (n + 1) + "</td><td class=\"l\"></td><td>" + t(run.reaction) + "</td><td>" + t(run.time) + "</td>" + (withQuarter ? "<td>" + t(run.quarter) + "</td>" : "") + (withHalf ? "<td>" + t(run.half) + "</td>" : "") +
                    "<td>" + Math.round(run.topSpeed * (metric ? 3.6 : 2.2369362920544)) + (metric ? " km/h" : " mph") + "</td><td></td>";
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
            "#dragHud { position: fixed; left: 50%; top: 30%; transform: translateX(-50%); z-index: 960; display: none; font-family: Arial, sans-serif; color: #fff; text-align: center; pointer-events: none; " +
            "min-width: 240px; text-shadow: 0 2px 6px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.9); user-select: none; }" +
            "#dragHud .distance { font-size: 40px; font-weight: bold; font-variant-numeric: tabular-nums; }" +
            "#dragHud .note { font-size: 18px; color: #dbe5f0; margin-top: 4px; }" +
            "#dragHud .note.bad { color: #ff6b62; font-weight: bold; font-size: 22px; }" +
            "#dragHud table { margin: 8px auto 0; border-collapse: collapse; font-size: 14px; font-variant-numeric: tabular-nums; }" +
            "#dragHud td, #dragHud th { padding: 2px 10px; text-align: right; } #dragHud td:first-child, #dragHud th:first-child { text-align: left; }" +
            "#dragHud th { color: #9fb0c4; font-weight: normal; font-size: 12px; } #dragHud tr.done td { color: #fff; } #dragHud tr td { color: #66727f; } #dragHud tr.finish.done td { color: #7ee7a0; font-weight: bold; }";
        document.head.appendChild(style);
        hud = document.createElement("div");
        hud.id = "dragHud";
        document.body.appendChild(hud);
    }

    // the split of a distance at the top right: one notification per distance, stacked under each other; each slides in, stays five seconds, and fades out
    var splits = null;
    function splitNote(r) {
        if (!splits) {
            var style = document.createElement("style");
            style.textContent =
                "#dragSplits { position: fixed; right: calc(14px + env(safe-area-inset-right)); top: calc(10px + env(safe-area-inset-top)); z-index: 960; pointer-events: none; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }" +
                "#dragSplits .split { min-width: 170px; box-sizing: border-box; padding: 7px 14px 8px; border-radius: 10px; text-align: right; background: rgba(14, 18, 23, 0.78); color: #fff; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; " +
                "opacity: 0; transform: translateX(18px); transition: opacity 0.5s ease, transform 0.5s ease; }" +
                "#dragSplits .split.show { opacity: 1; transform: none; }" +
                "#dragSplits .what { font-size: 12px; letter-spacing: 2px; text-transform: uppercase; color: #9fb0c4; }" +
                "#dragSplits .time { font-size: 28px; font-weight: bold; font-variant-numeric: tabular-nums; line-height: 1.15; }" +
                "#dragSplits .speed { font-size: 13px; color: #7ee7a0; font-variant-numeric: tabular-nums; }";
            document.head.appendChild(style);
            splits = document.createElement("div");
            splits.id = "dragSplits";
            document.body.appendChild(splits);
        }
        var metric = Settings.option("units") !== "imperial";
        var note = document.createElement("div");
        note.className = "split";
        note.innerHTML = "<div class=\"what\">" + htmlText(r.label) + "</div><div class=\"time\">" + r.time.toFixed(3) + " s</div><div class=\"speed\">" +
            Math.round(r.speed * (metric ? 3.6 : 2.2369362920544)) + (metric ? " km/h" : " mph") + "</div>";
        splits.appendChild(note);
        void note.offsetWidth;                                     // (the slide starts from where it is, so that the transition runs)
        note.classList.add("show");
        setTimeout(function () {
            note.classList.remove("show");
            setTimeout(function () { note.remove(); }, 600);       // (after the fade out)
        }, 5000);
    }

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
        if (state === "void") html += "<div class=\"note bad\">Drive back behind the line (hold the brake to reverse), then come up slowly</div>";
        if (state === "approach") html += "<div class=\"note\">" + (s > STAGE_MIN && s <= STAGE_MAX ? "Stand still at the line" : "Front wheels to the line, slowly") + "</div>";
        if (state === "ready") html += "<div class=\"distance\">Get ready…</div><div class=\"note\">Hold the car still at the line</div>";
        // the lights are on the tree beside the strip (a pole in the scene), not in the HUD
        var showTree = state === "tree" || state === "false" || (state === "go" && clock - tGreen < greenShown());
        if (showTree) {
            var green = state === "go";
            setLamps({ white: true, amber: state === "tree" ? Math.min(3, Math.floor((clock - tTree) / AMBER)) : (green ? 3 : 0), green: green, red: state === "false" });
        } else setLamps(null);
        if (state === "false") html += "<div class=\"note bad\">FALSE START</div><div class=\"note\">Drive back behind the line (hold the brake to reverse) and come up slowly</div>";
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
                // (no launch after the green: backed off, out of the lane, or still standing after five seconds is no run; a crossing minutes later was timed, with that R/T)
                if (t0 === null && (s < STAGE_MIN - 0.5 || !inLane)) { state = "approach"; break; }
                if (t0 === null && clock - tGreen > 5 && s < stagedS + ROLLOUT) { setState("void"); break; }
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
                        // (from where the car was staged: deep in the 65 cm of the beams it had up to 0.65 m less to go, 0.05 s on the 60 ft)
                        var at = r.metres + stagedS;
                        if (r.time === null && s >= at) {
                            var k = (at - prevS) / Math.max(1e-6, s - prevS);
                            k = Math.max(0, Math.min(1, k));
                            r.time = prevT + (clock - prevT) * k - t0;
                            r.speed = prevV + (forwardSpeed - prevV) * k;
                            splitNote(r);
                        }
                    }
                    if (s >= strip.length + stagedS) { state = "finished"; finishRun(car); }
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
        // (not after a false start, a run that was off, or a car a little past the line: there the brake has to reverse it back, and a gamepad has no other way)
        holding = state === "ready" || state === "tree" || (state === "go" && t0 === null) || (state === "approach" && s > STAGE_MIN - 0.3 && s <= STAGE_MAX);
        render(s, clock);
    }

    return { update: update, reset: reset, showTop: showTop, ticket: ticket, get state() { return state; }, get holding() { return holding; } };
})();
