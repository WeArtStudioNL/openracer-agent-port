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
        records: query.get("records") !== "0"
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

var playerLineIndex = null, playerLineLaps = 0, playerLastFraction = 0, playerMaxFraction = 0;
function updateRace(delta) {
    if(!race.ghost) return;
    var vehicles = [car.vehicle].concat(race.opponents.map(function(o) { return o.vehicle; }));
    race.opponents.forEach(function(o) { o.update(delta, vehicles); });
    if(race.opponents.length) OpenRacer.collideCars(vehicles);
    race.ghost.update(car, delta);
    if(race.opponents.length && race.line) {
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
