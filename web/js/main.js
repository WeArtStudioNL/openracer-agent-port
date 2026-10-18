/*
 * main.js
 *
 * Starts the game. Without a choice in the address (?car=<id>&track=<id>) the main menu is shown; with a choice the
 * scene and the materials are set up, the track is loaded and, once that is done, the car is created.
 */

var lastFrameTime = performance.now();
var s;
var telemetry;
var car;
var carConfig;

// the engine sound follows the option of the settings menu
Settings.onOptionChange(function(name, value) {
    if(name === "sound") EngineSound.setMuted(!value);
    else if(name === "volume") EngineSound.setVolume(value);
    else if(name === "toneMapping" && typeof renderer !== "undefined" && renderer) applyToneMapping(value);
});
EngineSound.setMuted(!Settings.option("sound"));
EngineSound.setVolume(Settings.option("volume"));

function startGame(carId, trackId) {
    Promise.all([Catalog.load("cars"), Catalog.load("tracks")]).then(function(result) {
        var carFound = result[0].filter(function(item) { return item.id === carId; })[0];
        var trackFound = result[1].filter(function(item) { return item.id === trackId; })[0];
        if(!carFound || !trackFound) {
            // the choice is not available (any more): back to the menu
            window.location.href = window.location.pathname;
            return;
        }
        carConfig = carFound;
        race.allCars = result[0].filter(function(item) { return item.id !== carId; }).concat([carFound]);
        s = new RACER.Scene();
        s.init();
        initialiseMaterials();
        loadTrack(trackFound, trackLoaded);
    }).catch(function(error) {
        console.error(error);
        window.location.href = window.location.pathname;
    });
}

// The race: the AI cars, the ghost and the records (see Opponent.js, Ghost.js, Records.js). The options come from the main menu, in the address.
var race = { opponents: [], ghost: null, line: null, options: null, allCars: [] };

function raceOptionsFromQuery(query) {
    return {
        ai: Math.max(0, Math.min(7, parseInt(query.get("ai") || "0", 10) || 0)),
        difficulty: query.get("difficulty") || "normal",
        ghost: query.get("ghost") !== "0",
        records: query.get("records") !== "0",
        laps: Math.max(0, Math.min(99, parseInt(query.get("laps") || "0", 10) || 0)), // 0: practice, no end
        wear: Math.max(0, Math.min(5, parseFloat(query.get("wear") === null ? "1" : query.get("wear")) || 0)) // tyre wear and fuel: 0 off, 1 as it is, 3 fast
    };
}

function banner(text) {
    var div = document.createElement("div");
    div.style.cssText = "position: absolute; top: 60px; left: 50%; transform: translateX(-50%); z-index: 1001; padding: 10px 20px; " +
        "background: rgba(20, 24, 31, 0.85); color: #ffffff; font-family: Arial; border-radius: 6px;";
    div.textContent = text;
    document.body.appendChild(div);
    setTimeout(function() { div.remove(); }, 9000);
}

function trackLoaded() {
    car = new OpenRacer.Car(carConfig);
    Tuning.attach(car, carConfig); // the tuning menu, with the tuning that was kept for this car
    telemetry = new OpenRacer.Telemetry({car: car, domElement: document.getElementById("telemetry")});
    setupRace();
}

function setupRace() {
    var options = race.options = raceOptionsFromQuery(new URLSearchParams(window.location.search));
    var track = currentTrack;
    if(new URLSearchParams(window.location.search).get("recordline") === "1") { recordLine(); return; }
    if(new URLSearchParams(window.location.search).get("mode") === "skidpad") { startSkidpad(); return; }
    // the racing line: a line saved with the track (recorded for it), the middle of a designed track, or the best lap that was driven here
    race.line = (track.racing_line && track.racing_line.length > 10 && new OpenRacer.RacingLine(track.racing_line, true)) ||
        (track.design && OpenRacer.RacingLine.fromDesign(track.design)) || null;
    if(!race.line) {
        var lap = OpenRacer.Records.anyGhost(track.id);
        if(lap) race.line = OpenRacer.RacingLine.fromLap(lap.samples);
    }
    if(race.line) {
        race.line.settle(groundWorld);
        // the line runs the way the track is driven: the direction of the start
        var heading = race.line.headingAt(track.start.x, track.start.z);
        if(Math.cos(heading - (track.start.heading || 0)) < 0) race.line.reverse();
    }

    race.ghost = new OpenRacer.Ghost(carConfig, track.id);
    race.ghost.enabled = options.ghost;
    race.ghost.saving = options.records;
    car.ghost = race.ghost;
    // the tyres and the fuel (Vehicle.js, Pit.js): the pit lane of the track is found for the AI
    car.vehicle.wearEnabled = options.wear > 0;
    car.vehicle.wearScale = options.wear || 1;
    if(options.wear > 0) car.vehicle.freshTyres(60);
    race.pitLane = race.line ? OpenRacer.PitLane.build(groundWorld, race.line) : null;
    if(options.wear > 0 && !race.pitLane) banner(race.line ? "This track has no pit lane: no pit stops here, mind the tyres and the fuel." : "No racing line: the AI cannot find the pit lane.");
    if(options.ghost && !race.ghost.best) banner("No best lap yet with this car on this track: the ghost appears from the next start, after a lap.");

    if(options.ai > 0) {
        if(!race.line) {
            banner("The AI needs a racing line: drive a lap first (it is kept as the line), or draw the track in the track editor.");
            return;
        }
        var skill = { easy: 0.7, normal: 0.85, hard: 1.0 }[options.difficulty] || 0.85;
        var colours = [0xd94a3d, 0x3d7bd9, 0xe3b53a, 0x3fae5a, 0xf0f0f0, 0x8a4fd1, 0xf07a2a];
        var start = track.start;
        var startIndex = race.line.nearest(start.x, start.z);
        race.line.origin = startIndex; // the laps of the line are counted from the start
        var cars = race.allCars.length ? race.allCars : [carConfig];
        for(var i = 0; i < options.ai; i++) {
            var config = cars[i % cars.length];
            var opponent = new OpenRacer.Opponent(config, race.line, { skill: skill * (1 - 0.04 * (i % 3)), color: colours[i % colours.length], name: (config.name || config.id) + " " + (i + 1) });
            opponent.vehicle.wearEnabled = options.wear > 0;
            opponent.vehicle.wearScale = options.wear || 1;
            if(options.wear > 0) opponent.vehicle.freshTyres(60);
            opponent.pitLane = race.pitLane;
            opponent.raceLaps = options.laps;
            // on the grid ahead of the player, two by two
            var index = startIndex + Math.round((7 * (i + 1) + 4) / race.line.step);
            var p = race.line.point(index), next = race.line.point(index + 1);
            var heading = Math.atan2(next.z - p.z, next.x - p.x);
            var side = (i % 2 === 0 ? 1 : -1) * 2.2;
            opponent.place(p.x - Math.sin(heading) * side, p.z + Math.cos(heading) * side, heading);
            race.opponents.push(opponent);
        }
        car.raceCount = race.opponents.length + 1;
    }
    if(options.laps > 0) startRace(options.laps);
}

// A race: a standing start with a countdown (everyone is held on the grid), a number of laps, and the results once the cars
// come in. The AI counts its laps along the line, the player's laps are counted by the gates (Car.js).
function startRace(laps) {
    race.laps = laps;
    race.state = "countdown";
    race.countdown = 4;          // 3, 2, 1 and GO (a second each)
    race.results = [];
    race.winnerTime = null;
    car.raceLaps = laps;
    car.held = true;
    race.opponents.forEach(function(o) { o.held = true; });
    var overlay = document.createElement("div");
    overlay.id = "raceOverlay";
    overlay.style.cssText = "position: absolute; top: 18%; left: 50%; transform: translateX(-50%); z-index: 1001; font: bold 96px Arial; " +
        "color: #ffffff; text-shadow: 0 2px 12px rgba(0, 0, 0, 0.7); pointer-events: none;";
    document.body.appendChild(overlay);
    race.overlay = overlay;
}

function updateRaceFlow(delta) {
    if(race.state === "countdown") {
        race.countdown -= delta;
        var n = Math.ceil(race.countdown - 1);
        race.overlay.textContent = n > 0 ? String(n) : "GO!";
        race.overlay.style.color = n > 0 ? (n === 1 ? "#ffd04d" : "#ffffff") : "#5be07a";
        if(race.countdown <= 1 && car.held) {
            // GO: the clocks of the race start here
            car.held = false;
            race.opponents.forEach(function(o) { o.held = false; o.goClock = o.clock; });
            race.goClock = car.clock;
        }
        if(race.countdown <= 0) { race.state = "racing"; race.overlay.remove(); }
        return;
    }
    if(race.state !== "racing" && race.state !== "finished") return;
    // the cars that come in
    race.opponents.forEach(function(o) {
        if(!o.finished && o.lapsCompleted >= race.laps) {
            o.finished = true;
            o.finishTime = o.clock - (o.goClock || 0);
            if(race.winnerTime === null) race.winnerTime = o.finishTime;
        }
    });
    if(!race.playerFinished && car.lapsCompleted >= race.laps) {
        race.playerFinished = true;
        race.playerTime = car.clock - (race.goClock || 0);
        if(race.winnerTime === null) race.winnerTime = race.playerTime;
        race.state = "finished";
        car.racePosition = standings().map(function(r) { return r.player; }).indexOf(true) + 1; // the place stays the one of the finish
        showResults();
    }
    if(race.state === "finished") renderResults();
}

// The results: the cars that are in, by their time; the others by how far they are, still running
function standings() {
    var rows = race.opponents.map(function(o) {
        return { name: o.name, time: o.finished ? o.finishTime : null, progress: o.progress, best: o.lapTimes.length ? Math.min.apply(null, o.lapTimes) : null, player: false };
    });
    rows.push({ name: "You (" + (carConfig.name || carConfig.id) + ")", time: race.playerFinished ? race.playerTime : null, progress: playerLineLaps + playerLastFraction,
        best: car.lapTimes.length ? Math.min.apply(null, car.lapTimes) : null, player: true });
    rows.sort(function(a, b) {
        if(a.time !== null && b.time !== null) return a.time - b.time;
        if(a.time !== null) return -1;
        if(b.time !== null) return 1;
        return b.progress - a.progress;
    });
    return rows;
}

var resultsPanel = null, resultsHtml = "";
function showResults() {
    if(resultsPanel) return;
    resultsPanel = document.createElement("div");
    resultsPanel.id = "raceResults";
    resultsPanel.style.cssText = "position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 1002; min-width: 420px; padding: 22px 28px; " +
        "background: rgba(20, 24, 31, 0.92); color: #ffffff; font-family: Arial; border-radius: 10px; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);";
    document.body.appendChild(resultsPanel);
    renderResults();
}

function renderResults() {
    var rows = standings();
    var position = rows.map(function(r) { return r.player; }).indexOf(true) + 1;
    var html = "<div style=\"font-size: 26px; font-weight: bold; margin-bottom: 4px;\">" + (position === 1 ? "You won!" : "Finished P" + position) + "</div>" +
        "<div style=\"color: #9fb0c4; margin-bottom: 14px;\">" + race.laps + " laps · " + (currentTrack.name || currentTrack.id) + "</div>" +
        "<table style=\"border-collapse: collapse; width: 100%; font-size: 15px;\">" +
        "<tr style=\"color: #9fb0c4; text-align: left;\"><th style=\"padding: 4px 10px 4px 0;\">#</th><th>Car</th><th style=\"text-align: right;\">Best lap</th><th style=\"text-align: right;\">Time</th></tr>";
    rows.forEach(function(r, i) {
        var time = r.time === null ? "running" : (i === 0 ? Hud.formatTime(r.time) : "+" + Hud.formatTime(r.time - rows[0].time));
        html += "<tr style=\"" + (r.player ? "color: #ffd04d; font-weight: bold;" : "") + "\"><td style=\"padding: 5px 10px 5px 0;\">" + (i + 1) + "</td><td>" + r.name + "</td>" +
            "<td style=\"text-align: right; padding-left: 16px;\">" + (r.best === null ? "–" : Hud.formatTime(r.best)) + "</td><td style=\"text-align: right; padding-left: 16px;\">" + time + "</td></tr>";
    });
    html += "</table><div style=\"margin-top: 18px; text-align: right;\">" +
        "<button id=\"raceAgain\" style=\"padding: 9px 18px; margin-right: 8px; font: bold 15px Arial; background: #3d7bd9; color: #fff; border: 0; border-radius: 6px; cursor: pointer;\">Race again</button>" +
        "<button id=\"raceMenu\" style=\"padding: 9px 18px; font: bold 15px Arial; background: #3b424c; color: #fff; border: 0; border-radius: 6px; cursor: pointer;\">Main menu</button></div>";
    if(html === resultsHtml) return;
    resultsHtml = html;
    resultsPanel.innerHTML = html;
    document.getElementById("raceAgain").onclick = function() { window.location.reload(); };
    document.getElementById("raceMenu").onclick = function() { window.location.href = window.location.pathname; };
}

// Recording the racing line for the track editor ("Record AI racing line"): the player drives calm laps, every lap replaces the
// line; Escape or the Stop button saves the last lap as the line of the track and goes back to the editor.
function recordLine() {
    var track = currentTrack;
    var ghost = race.ghost = new OpenRacer.Ghost(carConfig, track.id);
    ghost.enabled = false;
    ghost.saving = false; // a calm lap is no record
    car.ghost = ghost;
    var lap = null, laps = 0;
    var note = document.createElement("div");
    note.style.cssText = "position: absolute; top: 60px; left: 50%; transform: translateX(-50%); z-index: 1001; padding: 10px 20px; " +
        "background: rgba(20, 24, 31, 0.85); color: #ffffff; font-family: Arial; border-radius: 6px; text-align: center; line-height: 1.4;";
    var stop = document.createElement("button");
    stop.textContent = "Stop";
    stop.style.cssText = "position: absolute; right: 20px; bottom: 60px; z-index: 1001; padding: 10px 26px; font: bold 16px Arial; " +
        "background: #d94a3d; color: #ffffff; border: 0; border-radius: 6px; cursor: pointer;";
    document.body.appendChild(note);
    document.body.appendChild(stop);
    function show() {
        note.innerHTML = "<b>Recording the AI racing line</b><br>Drive a calm lap through all the gates: every lap you finish replaces the line. " +
            (laps ? "Laps driven: " + laps + " (the last one is the line). " : "") + "Esc or Stop saves the last lap as the line and goes back to the editor.";
    }
    show();
    ghost.onLap = function(samples) {
        lap = samples;
        laps++;
        show();
    };
    var done = false;
    race.recording = { stop: function() {
        if(done) return;
        done = true;
        var back = "tools/track-editor.html?track=" + encodeURIComponent(track.id);
        if(!lap) { window.location.href = back + "&line=none"; return; }
        note.textContent = "Saving the line…";
        OpenRacer.RacingLine.save(track, lap).then(function(count) {
            window.location.href = back + "&line=" + count;
        }).catch(function(error) {
            note.textContent = error.message;
            stop.textContent = "Back to the editor";
            stop.onclick = function() { window.location.href = back + "&line=failed"; };
            done = false;
        });
    } };
    stop.onclick = function() { race.recording.stop(); };
}

// The skidpad (?mode=skidpad on the skidpad track): the car drives round the painted circle by itself, a little faster every
// second, until it lets go: the lateral acceleration it held is the result. Reset starts again (with the tuning as it is now),
// Tune opens the tuning menu, and Back to the menu goes there.
function startSkidpad() {
    var pad = currentTrack.skidpad || { radius: 50 };
    var R = pad.radius;
    var sp = race.skidpad = { radius: R, speed: 0, best: 0, bestSpeed: 0, running: true, panel: null, overlay: null, settled: 0 };
    race.ghost = new OpenRacer.Ghost(carConfig, currentTrack.id);
    race.ghost.enabled = false; race.ghost.saving = false;
    car.ghost = race.ghost;
    car.vehicle.wearEnabled = false;
    var overlay = document.createElement("div");
    overlay.style.cssText = "position: absolute; top: 60px; left: 50%; transform: translateX(-50%); z-index: 1001; padding: 10px 20px; " +
        "background: rgba(20, 24, 31, 0.85); color: #ffffff; font-family: Arial; border-radius: 6px; text-align: center; line-height: 1.4; min-width: 320px;";
    document.body.appendChild(overlay);
    sp.overlay = overlay;
    // the car's keys and pads do nothing: the skidpad drives
    var targetSpeed = 3, radiusIndex = 0;
    car.pollInput = function() {
        var v = this.vehicle;
        this.handbrake = false; this.reverse = false; this.neutral = false; this.parkingLock = false;
        this.turnLeft = this.turnRight = false;
        if(!sp.running) { this.accelerate = false; this.brake = true; this.throttle = 0; return; }
        // the circle: the radius from the middle of the pad, and the direction along it (anticlockwise seen from above: the car
        // goes round to the left, so it steers left)
        var r = Math.hypot(v.x, v.z);
        var speed = Math.max(0, v.u);
        // the steering that the circle needs (the wheelbase over the radius), plus a correction to stay on the painted line
        var base = Math.atan(v.wheelbase / R);
        var tangentHeading = Math.atan2(v.x, -v.z); // the direction along the circle, anticlockwise (from +x towards +z)
        var headingError = tangentHeading - v.psi;
        while(headingError > Math.PI) headingError -= 2 * Math.PI;
        while(headingError < -Math.PI) headingError += 2 * Math.PI;
        // a positive steering angle turns the car towards a bigger heading (the way the circle goes); too wide (r above R) and a
        // nose that points outside the tangent both ask for more of it
        var wanted = base + 0.08 * (r - R) + 0.6 * headingError;
        wanted = Math.max(-this.turnLimit, Math.min(this.turnLimit, wanted));
        this.turnAngle += (wanted - this.turnAngle) * 0.3;
        // the speed: up by a quarter of a metre per second every second
        targetSpeed += 0.25 / 60;
        var error = targetSpeed - speed;
        this.accelerate = error > 0.3; this.brake = error < -1.5;
        if(!this.accelerate) this.throttle = 0; if(!this.brake) this.brakePedal = 0;
        // the result: the most lateral acceleration while the car still follows the circle
        var slip = Math.atan2(v.v, v.u);
        var ay = Math.abs(v.ay);
        var onLine = Math.abs(r - R) < 4 && Math.abs(slip) < 0.14;
        if(onLine && ay > sp.best) { sp.best = ay; sp.bestSpeed = speed; }
        if(Math.abs(r - R) > 6 || Math.abs(slip) > 0.25) skidpadDone();
        overlay.innerHTML = "<b>Skidpad</b> · circle of " + R + " m<br>" + (ay / 9.81).toFixed(2) + " g at " + Math.round(speed * 3.6) + " km/h · best " + (sp.best / 9.81).toFixed(2) + " g";
    };
    car.vehicle.tcEnabled = Settings.option("tc"); car.vehicle.escEnabled = false;

    function skidpadDone() {
        sp.running = false;
        var g = sp.best / 9.81;
        var panel = document.createElement("div");
        panel.style.cssText = "position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 1002; min-width: 380px; padding: 22px 28px; " +
            "background: rgba(20, 24, 31, 0.92); color: #ffffff; font-family: Arial; border-radius: 10px; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6); text-align: center;";
        var verdict = g > 1.1 ? "a racing car on slicks" : g > 0.95 ? "a sports car" : g > 0.85 ? "a good road car" : g > 0.75 ? "an ordinary road car" : "a van";
        panel.innerHTML = "<div style=\"font-size: 15px; color: #9fb0c4; letter-spacing: 2px;\">SKIDPAD · " + (carConfig.name || carConfig.id) + "</div>" +
            "<div style=\"font-size: 54px; font-weight: bold; margin: 6px 0 2px;\">" + g.toFixed(2) + " g</div>" +
            "<div style=\"color: #cfd8e3; margin-bottom: 18px;\">held at " + Math.round(sp.bestSpeed * 3.6) + " km/h on the circle of " + R + " m · like " + verdict + "</div>" +
            "<button id=\"skidReset\" style=\"padding: 9px 18px; margin: 0 4px; font: bold 15px Arial; background: #3d7bd9; color: #fff; border: 0; border-radius: 6px; cursor: pointer;\">Reset</button>" +
            "<button id=\"skidTune\" style=\"padding: 9px 18px; margin: 0 4px; font: bold 15px Arial; background: #3b424c; color: #fff; border: 0; border-radius: 6px; cursor: pointer;\">Tune</button>" +
            "<button id=\"skidMenu\" style=\"padding: 9px 18px; margin: 0 4px; font: bold 15px Arial; background: #3b424c; color: #fff; border: 0; border-radius: 6px; cursor: pointer;\">Back to the menu</button>";
        document.body.appendChild(panel);
        sp.panel = panel;
        document.getElementById("skidReset").onclick = skidpadReset;
        document.getElementById("skidTune").onclick = function() { Tuning.toggle(); };
        document.getElementById("skidMenu").onclick = function() { window.location.href = window.location.pathname; };
    }

    function skidpadReset() {
        if(sp.panel) { sp.panel.remove(); sp.panel = null; }
        sp.best = 0; sp.bestSpeed = 0; targetSpeed = 3; sp.running = true;
        car.turnAngle = 0;
        car.place(R, 0, Math.PI / 2);
        car.vehicle.freshTyres(85);
    }
    race.skidpadReset = skidpadReset;
}

var playerLineIndex = null, playerLineLaps = 0, playerLastFraction = 0, playerMaxFraction = 0;
function updateRace(delta) {
    if(!race.ghost) return;
    var vehicles = [car.vehicle].concat(race.opponents.map(function(o) { return o.vehicle; }));
    race.opponents.forEach(function(o) { o.update(delta, vehicles); });
    if(race.opponents.length) OpenRacer.collideCars(vehicles);
    race.ghost.update(car, delta);
    if(race.opponents.length && race.line && !race.playerFinished) {
        // the place: how far along the line everyone is, counted the same way for the player as for the AI (laps of the line)
        playerLineIndex = race.line.nearest(car.vehicle.x, car.vehicle.z, playerLineIndex);
        var fraction = race.line.fractionOf(playerLineIndex);
        if(fraction < 0.2 && playerLastFraction > 0.8 && playerMaxFraction > 0.5) { playerLineLaps++; playerMaxFraction = 0; }
        else if(fraction > 0.8 && playerLastFraction < 0.2 && playerLineLaps > 0 && playerMaxFraction < 0.2) { playerLineLaps--; playerMaxFraction = 1; }
        if(fraction < 0.8) playerMaxFraction = Math.max(playerMaxFraction, fraction);
        playerLastFraction = fraction;
        var mine = playerLineLaps + fraction;
        var position = 1;
        race.opponents.forEach(function(o) { if(o.loaded && o.progress > mine) position++; });
        car.racePosition = position;
    }
    if(race.state) updateRaceFlow(delta);
}

function onEnterFrame() {
    Settings.update();
    EngineSound.setPaused(Settings.isPaused());
    if(car && Settings.isPaused()) {
        EngineSound.update(car.engineRPM, 0);
    }
    if(car && !Settings.isPaused()) {
        var now = performance.now();
        var d = (now - lastFrameTime) / 1000;
        lastFrameTime = now;
        if(d > 0.1) d = 0.1; // after a pause of the browser (another tab, no focus) the game goes on from here, it does not catch up
        car.update(d, true);
        updateRace(d);
    }
}

var query = new URLSearchParams(window.location.search);
if(query.get("car") && query.get("track")) {
    startGame(query.get("car"), query.get("track"));
} else {
    MainMenu.show();
}
