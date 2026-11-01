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
// ask the browser to keep what the game stores (settings, records, garage, replays): without this it may clear them when the disk is nearly full
try { if(navigator.storage && navigator.storage.persist && navigator.storage.persisted) navigator.storage.persisted().then(function(kept) { if(!kept) navigator.storage.persist(); }); } catch(e) { /* no storage API */ }

// the simulation options (Settings, tab Simulation): read by Opponent.js and Vehicle.js
OpenRacer.sim = { aiDamage: Settings.option("simAiDamage") || "near", range: Settings.option("simAiRange") || 60, aiSteps: Settings.option("simAiSteps") || 3, tyreDetail: Settings.option("simTyreDetail") || "full", focus: null };
Settings.onOptionChange(function(name, value) {
    if(name === "simAiDamage") OpenRacer.sim.aiDamage = value;
    else if(name === "simAiRange") OpenRacer.sim.range = value;
    else if(name === "simAiSteps") OpenRacer.sim.aiSteps = value;
    else if(name === "simTyreDetail") {
        OpenRacer.sim.tyreDetail = value;
        if(typeof car !== "undefined" && car) car.vehicle.tyreDetail = value;
        if(typeof race !== "undefined" && race.opponents) race.opponents.forEach(function(o) { o.vehicle.tyreDetail = value; });
    }
    else if(name === "sound") EngineSound.setMuted(!value);
    else if(name === "volume") EngineSound.setVolume(value);
    else if(name === "tyreVolume") EngineSound.setTyreVolume(value);
    else if(name.indexOf("mirror") === 0 && typeof car !== "undefined" && car && car.mirrors && OpenRacer.Mirrors) OpenRacer.Mirrors.aim(car.mirrors);
    else if(name.indexOf("gfx") === 0 && OpenRacer.Graphics) OpenRacer.Graphics.changed(name);
});
EngineSound.setMuted(!Settings.option("sound"));
EngineSound.setVolume(Settings.option("volume"));
EngineSound.setTyreVolume(Settings.option("tyreVolume") === undefined ? 0.8 : Settings.option("tyreVolume"));

// A bar while the track, the car and the other cars load (the loader of three.js counts the files); it goes when all of them are in
function showLoading() {
    var boot = document.getElementById("bootLoading"); if(boot) boot.remove();
    var box = document.createElement("div");
    box.id = "loadingScreen";
    box.style.cssText = "position: fixed; inset: 0; z-index: 2000; background: var(--bg2); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; color: #dfe6ef; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; transition: opacity 0.4s;";
    box.innerHTML = "<div style=\"font-size: 28px; letter-spacing: 2px;\">OpenRacer</div><div style=\"width: 260px; height: 6px; background: #263040; border-radius: 3px; overflow: hidden;\"><div style=\"height: 100%; width: 3%; background: var(--accent); transition: width 0.2s;\"></div></div>";
    document.body.appendChild(box);
    var bar = box.firstChild.nextSibling.firstChild, best = 0.03, started = Date.now();
    THREE.DefaultLoadingManager.onProgress = function(url, loaded, total) {
        best = Math.max(best, Math.min(0.95, loaded / Math.max(1, total)));
        bar.style.width = (best * 100) + "%";
    };
    var timer = setInterval(function() {
        var ready = typeof car !== "undefined" && car && car.isReady() && race.opponents.every(function(o) { return o.loaded; });
        // (a car that could not be loaded ends the wait at once: its message was under this screen, which waited 90 seconds for nothing)
        var failed = typeof car !== "undefined" && car && car.loadError;
        if(!ready && !failed && Date.now() - started < 90000) return;
        clearInterval(timer);
        bar.style.width = "100%";
        box.style.opacity = "0";
        setTimeout(function() { box.remove(); race.ready = true; }, 450);
    }, 250);
}

function startGame(carId, trackId) {
    var listed = false;          // (an error after the lists had loaded is not "the list could not be loaded")
    Promise.all([Catalog.load("cars"), Catalog.load("tracks")]).then(function(result) {
        listed = true;
        var carFound = result[0].filter(function(item) { return item.id === carId; })[0];
        var trackFound = result[1].filter(function(item) { return item.id === trackId; })[0];
        if(!carFound || !trackFound) {
            // the choice is not available (any more): back to the menu, which says why (a shared link to a car of someone's garage went back without a word)
            window.location.href = window.location.pathname + "?missing=" + encodeURIComponent(!carFound ? "car:" + carId : "track:" + trackId);
            return;
        }
        carConfig = carFound;
        carBaseConfig = carFound;
        // the setup that was chosen for this car (the main menu, the tuning menu, the car editor; OpenRacer.Setups): its configuration laid over car.json, the model and the id of the car kept
        if(OpenRacer.Setups) {
            // (a replay: the setup the car raced with, from the file; "" is the car as made)
            var query = new URLSearchParams(window.location.search), viewing = query.get("replay") === "1" || query.get("editor") === "1";
            var setupName = viewing && query.get("setup") !== null ? query.get("setup") || null : OpenRacer.Setups.active(carId);
            var setup = setupName ? OpenRacer.Setups.configOf(carId, setupName, carFound) : null;
            if(setup) carConfig = withTune(carFound, setupName);
        }
        race.allCars = result[0].filter(function(item) { return item.id !== carId; }).concat([carFound]);
        s = new RACER.Scene();
        s.init();
        initialiseMaterials();
        showLoading();
        loadTrack(trackFound, trackLoaded);
    }).catch(function(error) {
        console.error(error);
        window.location.href = window.location.pathname + "?missing=" + encodeURIComponent((listed ? "error:" : "list:") + ((error && error.message) || error));
    });
}

// The race: the AI cars, the ghost and the records (see Opponent.js, Ghost.js, Records.js). The options come from the main menu, in the address.
// The names of cars come from car.json, which can be imported from someone else: text, never markup
function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function(c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
}

var carBaseConfig = null;      // the car as made (car.json), when a setup is laid over it
var race = { opponents: [], ghost: null, line: null, options: null, allCars: [] };
// damage on or off (the main menu, &damage=0|1): off, the cars are plain rigid bodies: no shell that dents (SoftBody.js), no parts or wheels that come off, no punctures.
// Read here, before the cars load, since the shell is built when the model of a car arrives (CollisionProxy.apply)
OpenRacer.damageEnabled = new URLSearchParams(window.location.search).get("damage") !== "0";

// a car with a setup (tune) of it laid over car.json, the model and the id of the car kept; the car as it is when there is no such setup
function withTune(base, setupName) {
    var setup = setupName && OpenRacer.Setups ? OpenRacer.Setups.configOf(base.id, setupName, base) : null;
    if(!setup) return base;
    var config = Object.assign({}, base, setup, { id: base.id, model: base.model, preview: base.preview, folder: base.folder, source: base.source, setupName: setupName });      // (setupName: the key of its records and ghost, Records.js)
    // (a layout of the shell without the centre of gravity it was drawn at: it was drawn for the car as made, car.json; CollisionProxy shifts it to the centre of the setup)
    if(config.softbody && config.softbody.layout && !Number.isFinite(config.softbody.layout_cg) && base.chassis) config.softbody = Object.assign({}, config.softbody, { layout_cg: base.chassis.cg_height, layout_radius: base.chassis.tire_diameter / 2 });
    // (a setup from the car editor has the driver without his file, which is the car's: the file of car.json)
    if(config.driver && !config.driver.file && base.driver && base.driver.file) config.driver = Object.assign({}, config.driver, { file: base.driver.file });
    return config;
}

function raceOptionsFromQuery(query) {
    return {
        ai: Math.max(0, Math.min(7, parseInt(query.get("ai") || "0", 10) || 0)),
        difficulty: query.get("difficulty") || "normal",
        grid: query.get("grid") || "front",                                // where the player starts: front (pole), back (last) or random
        ghost: query.get("ghost") !== "0",
        records: query.get("records") !== "0",
        laps: Math.max(0, Math.min(99, parseInt(query.get("laps") || "0", 10) || 0)), // 0: practice, no end
        // (read from the address as it is: every car and tune in it is encoded, so a comma or a % in the name of a tune is its own; decoded once more by
        // URLSearchParams, a tune with a comma became two opponents, and one with a % threw and stopped the race)
        opp: ((/[?&]opp=([^&]*)/.exec(window.location.search) || [])[1] || "").split(",").filter(Boolean).slice(0, 7).map(function(item) { var at = item.indexOf("~"), dec = function(s) { try { return decodeURIComponent(s); } catch(e) { return s; } }; return at < 0 ? { car: dec(item), tune: "" } : { car: dec(item.slice(0, at)), tune: dec(item.slice(at + 1)) }; }),   // the opponents that were chosen in the main menu: [{ car, tune }] (empty: the cars of aicars, or all)
        aiCars: query.get("aicars") ? query.get("aicars").split(",").filter(Boolean) : null,        // the ids of the cars that may race against you (null: all)
        wear: Math.max(0, Math.min(5, parseFloat(query.get("wear") === null ? "1" : query.get("wear")) || 0)), // tyre wear and fuel: 0 off, 1 as it is, 3 fast
        damage: query.get("damage") !== "0",                                   // off: the cars are rigid bodies (no dents, no parts or wheels off, no punctures)
        aiTyres: query.get("aitires") === "shell" ? "shell" : "simple"      // the tyre of the AI cars: the simple one (rays and a slip curve; Opponent.js), or the shell of the player's tyres, to compare
    };
}

function banner(text) {
    // (a message from while the game loads waits for the loading screen to go: it was shown under it, and gone again before the game could be seen)
    if(!race.ready && document.getElementById("loadingScreen")) { setTimeout(function() { banner(text); }, 300); return; }
    // (several messages at once are stacked, not drawn over each other)
    var stack = document.getElementById("banners");
    if(!stack) {
        stack = document.createElement("div");
        stack.id = "banners";
        stack.style.cssText = "position: absolute; top: " + (window.innerWidth < 640 ? 250 : window.innerWidth < 1100 ? 130 : 60) + "px; left: 50%; transform: translateX(-50%); z-index: 1001; display: flex; flex-direction: column; align-items: center; gap: 8px; " +
            "width: max-content; max-width: calc(100vw - 32px); pointer-events: none;";
        document.body.appendChild(stack);
    }
    var div = document.createElement("div");
    div.style.cssText = "padding: 10px 20px; background: rgba(20, 24, 31, 0.85); color: #ffffff; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; border-radius: 6px; text-align: center;";
    div.textContent = text;
    stack.appendChild(div);
    setTimeout(function() { div.remove(); }, 9000);
}

function trackLoaded() {
    car = new OpenRacer.Car(carConfig);
    OpenRacer.sim.focus = car.vehicle;
    car.vehicle.tyreDetail = OpenRacer.sim.tyreDetail;
    if(OpenRacer.RigidObjects) OpenRacer.RigidObjects.setup(currentTrack, typeof trackRigidPieces !== "undefined" ? trackRigidPieces : []);
    if(OpenRacer.GateMarkers) OpenRacer.GateMarkers.build(currentTrack);
    if(OpenRacer.TrackMarks) OpenRacer.TrackMarks.build(currentTrack);      // the pit area and the grid boxes of the track editor, drawn on the road
    Tuning.attach(car, carConfig, carBaseConfig); // the tuning menu, with the tuning that was kept for this car (and the car as made, for "the car as made" of the setups)
    telemetry = new OpenRacer.Telemetry({car: car, domElement: document.getElementById("telemetry")});
    setupRace();
}

function setupRace() {
    var options = race.options = raceOptionsFromQuery(new URLSearchParams(window.location.search));
    var track = currentTrack;
    if(new URLSearchParams(window.location.search).get("replay") === "1" || new URLSearchParams(window.location.search).get("editor") === "1") { setupReplayViewer(); return; }
    if(new URLSearchParams(window.location.search).get("recordline") === "1") { recordLine(); return; }
    if(new URLSearchParams(window.location.search).get("mode") === "skidpad") { startSkidpad(); return; }
    // the racing line: a line saved with the track (recorded for it), the middle of a designed track, or the best lap that was driven here
    // the best lap that was driven here (by anyone, on this computer) is the line of the AI: the way the fastest driver takes the bends; without one the line saved with the track
    // (only a lap driven since the road or the line was last changed in the track editor, line_date: an older lap took the AI into the new walls)
    var bestLap = new URLSearchParams(window.location.search).get("bestline") === "0" ? null : OpenRacer.Records.anyGhost(track.id, track.line_date);
    race.lineFromLap = !!(bestLap && bestLap.samples && bestLap.samples.length >= 10 && OpenRacer.RacingLine.fromLap(bestLap.samples));
    race.line = (race.lineFromLap && OpenRacer.RacingLine.fromLap(bestLap.samples)) ||
        (track.racing_line && track.racing_line.length > 10 && new OpenRacer.RacingLine(track.racing_line, true)) ||
        (track.design && OpenRacer.RacingLine.fromDesign(track.design)) || null;
    if(!race.line) {
        var lap = OpenRacer.Records.anyGhost(track.id, track.line_date);
        if(lap) race.line = OpenRacer.RacingLine.fromLap(lap.samples);
    }
    if(race.line) {
        race.line.settle(groundWorld);
        // the line runs the way the track is driven: the direction of the start
        var heading = race.line.headingAt(track.start.x, track.start.z);
        if(Math.cos(heading - (track.start.heading || 0)) < 0) race.line.reverse();
        if(!race.lineFromLap && new URLSearchParams(window.location.search).get("cut") !== "0") race.line.shorten(groundWorld);        // (the AI cuts the bends within the road)
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
    race.pitBoxes = OpenRacer.PitStop.boxesOf(track);                 // the pit boxes of the track editor: the player has the first, the AI cars the next ones
    car.pit.boxes = race.pitBoxes; car.pit.boxIndex = race.pitBoxes.length ? 0 : -1;
    race.pitPath = race.line ? OpenRacer.PitPath.build(OpenRacer.PitPath.pointsOf(track), race.line) : null;       // the pit line of the track editor, for the AI
    // (one message for what matters: a track without a finish line has no laps, so no ghost and no pit stops to speak of)
    if(!trackCheckPoints.length) {
        if(options.laps > 0) banner("This track has no finish line (no gates): there is no race here, only free driving.");
        return;
    }
    if(options.wear > 0 && race.line && !race.pitLane && !race.pitBoxes.length) banner("This track has no pit lane: no pit stops here, mind the tyres and the fuel.");
    if(options.ghost && !race.ghost.best) banner("No best lap yet with this car on this track: the ghost appears from the next start, after a lap.");

    if(options.ai > 0 && !race.line) {
        // no line for the AI: the race is run without it (the laps and the countdown stay), and the player is told why
        banner("No AI cars: this track has no racing line yet. Drive a lap here (it becomes the line), or draw the track in the track editor.");
        options.ai = 0;
    }
    if(options.ai > 0) {
        var skill = { easy: 0.7, normal: 0.85, hard: 1.0 }[options.difficulty] || 0.85;
        var colours = [0xd94a3d, 0x3d7bd9, 0xe3b53a, 0x3fae5a, 0xf0f0f0, 0x8a4fd1, 0xf07a2a];
        var start = track.start, grid = Array.isArray(track.grid) ? track.grid : [];      // the grid boxes of the track editor: box 1 is the start, the others are for the opponents
        var startIndex = race.line.nearest(start.x, start.z);
        // the laps of the line are counted from the finish line (the first gate), as the player's laps are (Car.js): everyone's first lap starts
        // when they cross it, so the grid behind the line costs the AI the same distance as the player
        var finish = Array.isArray(track.gates) && track.gates.length ? track.gates[0] : null;
        race.line.origin = finish && isFinite(finish.x) && isFinite(finish.z) ? race.line.nearest(finish.x, finish.z) : startIndex;
        var cars = race.allCars.length ? race.allCars : [carConfig];
        // the places of the grid: 0 is the start (box 1), then the grid boxes of the track, else two by two behind it along the racing line (ahead of the start
        // a car would be over the line, a lap down). On pole the player has the start and the AI the others in order, as it always was; from another place
        // the places go front to back along the start (the boxes of a track are not always numbered that way), the player takes its own, the AI the others
        function slotPlace(s) {
            if(s === 0) return { x: start.x, z: start.z, heading: start.heading || 0 };
            var box = grid[s];
            if(box && isFinite(box.x) && isFinite(box.z)) return { x: box.x, z: box.z, heading: box.heading || 0 };      // its own grid box
            var index = startIndex - Math.round((7 * s + 4) / race.line.step);
            var p = race.line.point(index), next = race.line.point(index + 1);
            var heading = Math.atan2(next.z - p.z, next.x - p.x);
            var side = ((s - 1) % 2 === 0 ? 1 : -1) * 2.2;
            return { x: p.x - Math.sin(heading) * side, z: p.z + Math.cos(heading) * side, heading: heading };
        }
        var slots = [];
        for(var si = 0; si <= options.ai; si++) slots.push(slotPlace(si));
        var playerSlot = 0;
        if(options.grid === "back" || options.grid === "random") {
            var hx = Math.cos(start.heading || 0), hz = Math.sin(start.heading || 0);
            var ahead = function(q) { return (q.x - start.x) * hx + (q.z - start.z) * hz; };
            slots.sort(function(a, b) { return ahead(b) - ahead(a); });
            playerSlot = options.grid === "back" ? options.ai : Math.floor(Math.random() * (options.ai + 1));
        }
        if(options.aiCars) { var chosen = cars.filter(function(c) { return options.aiCars.indexOf(c.id) >= 0; }); if(chosen.length) cars = chosen; }
        else {
            // the cars of the player's kind: a car against cars, a kart against karts, a motorcycle against motorcycles (the first cars of the list raced: a muscle car
            // against a kart and a dune buggy, lapped or out of reach); with no other of its kind, the player's own car
            var kind = function(c) { return c.type === "motorcycle" ? "bike" : (c.chassis && c.chassis.mass < 300 ? "kart" : "car"); };
            var own = kind(carBaseConfig || carConfig);
            var alike = cars.filter(function(c) { return kind(c) === own && c.id !== carConfig.id; });
            cars = alike.length ? alike : [carBaseConfig || carConfig];
        }
        for(var i = 0; i < options.ai; i++) {
            var config = cars[i % cars.length];
            var chosen = options.opp && options.opp[i] ? race.allCars.filter(function(c) { return c.id === options.opp[i].car; })[0] : null;
            if(chosen) config = withTune(chosen, options.opp[i].tune);
            var opponent = new OpenRacer.Opponent(config, race.line, { skill: skill * (1 - 0.04 * (i % 3)), color: colours[i % colours.length], name: (config.name || config.id) + " " + (i + 1), shellTyres: options.aiTyres === "shell" });
            opponent.vehicle.wearEnabled = options.wear > 0;
            opponent.vehicle.wearScale = options.wear || 1;
            if(options.wear > 0) opponent.vehicle.freshTyres(60);
            opponent.pitLane = race.pitLane;
            opponent.pit.boxes = race.pitBoxes; opponent.pit.boxIndex = race.pitBoxes.length ? i + 1 : -1;
            opponent.pitBox = race.pitBoxes[i + 1] || null;
            opponent.pitPath = race.pitPath;                      // (its own box: it drives to it; without one it uses the pit lane, if the track has one)
            opponent.raceLaps = options.laps;
            var slot = slots[i < playerSlot ? i : i + 1];
            opponent.place(slot.x, slot.z, slot.heading);
            race.opponents.push(opponent);
        }
        // the player in its place on the grid when that is not pole (the AI that is placed first is the fastest: on pole it was always behind the player)
        if(playerSlot > 0 || slots[0].x !== start.x || slots[0].z !== start.z) car.place(slots[playerSlot].x, slots[playerSlot].z, slots[playerSlot].heading);
        car.raceCount = race.opponents.length + 1;
    }
    if(options.laps > 0) startRace(options.laps);
}

// A replay that was opened from a file (Replay.js, "Open a replay" in the main menu): the cars of the file are made without a driver and the
// recording is shown as soon as their models have loaded. There is no race behind it: Escape goes back to the main menu.
function setupReplayViewer() {
    race.options = { ai: 0, ghost: false, records: false, laps: 0, wear: 0 };
    OpenRacer.Replay.takeStash().then(function(parsed) {
        var back = function(text) { banner(text); setTimeout(function() { window.location.href = window.location.pathname; }, 3500); };
        if(!parsed) { back("The replay is no longer there: open the file again from the main menu."); return; }
        for(var i = 1; i < parsed.header.cars.length; i++) {
            var entry = parsed.header.cars[i];
            var config = race.allCars.filter(function(c) { return c.id === entry.id; })[0];
            if(!config) { back("This replay needs the car " + entry.id + ", which this game does not have."); return; }
            if(entry.setup) config = withTune(config, entry.setup);          // (the setup it raced with; one that is not here leaves the car as made)
            race.opponents.push(new OpenRacer.Opponent(config, null, { skill: 1, color: entry.color, name: entry.name }));
        }
        race.viewer = parsed;
    }).catch(function(error) { console.error(error); banner("The replay could not be opened."); });
}

// A race: a standing start with a countdown (everyone is held on the grid), a number of laps, and the results once the cars
// come in. The AI counts its laps along the line, the player's laps are counted by the gates (Car.js).
function startRace(laps) {
    race.laps = laps;
    race.state = "waiting";      // until everything has loaded and the loading screen is gone; then the fly-by over the grid, then the countdown
    race.countdown = 4;          // 3, 2, 1 and GO (a second each)
    race.results = [];
    race.winnerTime = null;
    car.raceLaps = laps;
    car.held = true;
    race.opponents.forEach(function(o) { o.held = true; });
}

// The camera flies over the grid from the front to the back, at the side of it, and then the view of the player comes back
var FLYBY_SECONDS = 6;
function beginFlyby() {
    var s = currentTrack.start, h = s.heading || 0, dx = Math.cos(h), dz = Math.sin(h);
    var front = 0;
    race.opponents.forEach(function(o) { front = Math.max(front, (o.vehicle.px - s.x) * dx + (o.vehicle.pz - s.z) * dz); });
    front += 14;
    // (to behind the last car, the player too: from the back of the grid the fly-by ended before it)
    var back = 0;
    race.opponents.concat([{ vehicle: car.vehicle }]).forEach(function(o) { back = Math.min(back, (o.vehicle.px - s.x) * dx + (o.vehicle.pz - s.z) * dz); });
    back -= 14;
    var state = race.flyby = { time: 0, skip: false };
    function skip() { state.skip = true; }
    state.keydown = function(e) { if(e.code === "Enter" || e.code === "Space") skip(); };
    window.addEventListener("keydown", state.keydown);
    window.addEventListener("pointerdown", skip);
    state.pointerdown = skip;
    var note = document.createElement("div");
    // (a tap skips it too, and on a phone the line of the engine sound is at the bottom left: this goes above it)
    var touch = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    note.textContent = touch ? "Tap to skip the fly-by" : "Press Enter or click to skip the fly-by";
    note.style.cssText = "position: fixed; " + (window.innerWidth < 640 ? "left: 16px; bottom: 40px;" : "left: 50%; bottom: 22px; transform: translateX(-50%);") + "z-index: 1001; color: var(--muted); font: 14px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; text-shadow: 0 1px 4px #000; pointer-events: none;";
    document.body.appendChild(note);
    state.note = note;
    car.cameraOverride = function(delta) {
        if(Settings.isPaused()) return true;
        state.time += Math.min(delta, 1);   // (a slow computer does not make it longer than it is)
        var t = Math.min(1, state.time / FLYBY_SECONDS), e = t * t * (3 - 2 * t);
        var along = front + (back - front) * e;
        var ground = car.body.position.y - car.wheels[0].radius;
        var px = -dz, pz = dx;           // across the grid
        camera.position.set(s.x + dx * along + px * 8, ground + 2.4, s.z + dz * along + pz * 8);
        camera.lookAt(s.x + dx * (along - 5) - px * 0.5, ground + 0.7, s.z + dz * (along - 5) - pz * 0.5);
        return true;
    };
    race.state = "flyby";
}
function endFlyby() {
    var state = race.flyby;
    car.cameraOverride = null;
    window.removeEventListener("keydown", state.keydown);
    window.removeEventListener("pointerdown", state.pointerdown);
    state.note.remove();
    race.flyby = null;
    race.state = "countdown";
    race.countdown = 4;
    if(Settings.showKeysOnce) Settings.showKeysOnce();       // (the first game on this computer: the keys that matter)
    var overlay = document.createElement("div");
    overlay.id = "raceOverlay";
    overlay.style.cssText = "position: absolute; top: 9%; left: 50%; transform: translateX(-50%); z-index: 1001; font: bold 120px Arial; -webkit-text-stroke: 3px rgba(0, 0, 0, 0.55); paint-order: stroke fill; " +
        "color: #ffffff; text-shadow: 0 2px 12px rgba(0, 0, 0, 0.7); pointer-events: none;";
    document.body.appendChild(overlay);
    race.overlay = overlay;
}

function updateRaceFlow(delta) {
    if(race.state === "waiting") {
        if(race.ready) beginFlyby();
        return;
    }
    if(race.state === "flyby") {
        if(race.flyby.skip || race.flyby.time >= FLYBY_SECONDS) endFlyby();
        return;
    }
    if(race.state === "countdown") {
        race.countdown -= delta;
        var n = Math.ceil(race.countdown - 1);
        race.overlay.textContent = n > 0 ? String(n) : "GO!";
        race.overlay.style.color = n > 0 ? (n === 1 ? "var(--accent2)" : "#ffffff") : "#5be07a";
        race.overlay.style.textShadow = "0 3px 16px rgba(0, 0, 0, 0.85)";
        if(race.countdown <= 1 && car.held) {
            // GO: the clocks of the race start here
            car.held = false;
            car.brakePedal = 0; car.handbrake = false;
            race.opponents.forEach(function(o) { o.held = false; o.goClock = o.clock; });
            race.goClock = car.clock;
            if(!car.lapStarted) car.lapStartTime = car.clock;      // (the first lap is timed from GO until the line is crossed)
        }
        if(race.countdown <= 0) { race.state = "racing"; race.overlay.remove(); }
        return;
    }
    if(race.state !== "racing" && race.state !== "finished") return;
    // the cars that come in
    race.opponents.forEach(function(o) {
        if(!o.finished && o.lapsCompleted >= race.laps) {
            o.finished = true;
            o.paceFactor = 0.6;               // (it drives on after the finish, a little slower, as the player's car does)
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
        startAutopilot();
    }
    if(race.state === "finished") renderResults();
}

// After the finish: the player no longer drives. An AI driver takes the car, at half the speed that the line allows, and the camera is the cinematic one of the track (when it has
// cameras; else the camera of the game stays). Race again and Main menu are in the results.
function startAutopilot() {
    if(car.autopilot) return;
    if(race.line) {
        var pilot = new OpenRacer.Opponent(carConfig, race.line, { vehicle: car.vehicle, noModel: true, skill: 0.85 });
        pilot.paceFactor = 0.5;
        pilot.paceCap = Math.max(3, 0.5 * (race.playerTop || 20));            // half of the line's speed in the bends and half of the top speed that you reached on the straights
        pilot.raceLaps = 0;
        pilot.lineIndex = race.line.nearest(car.vehicle.x, car.vehicle.z);
        car.autopilot = pilot;
        car.autopilotOthers = function() { return race.opponents.map(function(o) { return o.vehicle; }); };
    } else {
        car.autopilot = { throttle: 0, brakePedal: 0.6, turnAngle: 0 };            // (no racing line to drive: it brakes to a stop)
    }
    car.cameraOverride = function(delta) { return OpenRacer.Replay && OpenRacer.Replay.liveCine ? OpenRacer.Replay.liveCine(delta) : false; };
}

// The results: the cars that are in, by their time; the others by how far they are, still running
function standings() {
    var rows = race.opponents.map(function(o) {
        return { name: o.name, time: o.finished ? o.finishTime : null, progress: o.progress, best: o.lapTimes.length ? Math.min.apply(null, o.lapTimes) : null, player: false };
    });
    rows.push({ name: "You (" + (carConfig.name || carConfig.id) + ")", time: race.playerFinished ? race.playerTime : null, progress: playerLineLaps + playerLastFraction - (playerCrossed ? 0 : 1),
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
    resultsPanel.setAttribute("role", "dialog");
    // (as wide as the screen allows: on a phone the panel of 420 px and its Main menu button ran off both sides)
    resultsPanel.style.cssText = "position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 1002; width: min(476px, calc(100vw - 24px)); box-sizing: border-box; padding: 22px 28px; " +
        "max-height: calc(100vh - 24px); overflow-y: auto; background: rgba(24, 29, 35, 0.95); color: #ffffff; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; border-radius: 10px; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);";
    // (the buttons are made once and keep the focus: the whole panel was written again whenever a car moved up a place, and a button that had the focus lost it)
    resultsPanel.innerHTML = "<div class=\"table\"></div><div style=\"margin-top: 18px; display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end;\">" +
        "<button id=\"raceAgain\" style=\"padding: 9px 18px; font: bold 15px Arial; background: var(--accent); color: #fff; border: 0; border-radius: 6px; cursor: pointer;\">Race again</button>" +
        "<button id=\"raceMenu\" style=\"padding: 9px 18px; font: bold 15px Arial; background: var(--line); color: #fff; border: 0; border-radius: 6px; cursor: pointer;\">Main menu</button></div>";
    document.body.appendChild(resultsPanel);
    // (a replay that was not saved is asked about, as Main menu does: Race again threw it away)
    document.getElementById("raceAgain").onclick = function() { var again = function() { window.location.reload(); }; if(OpenRacer.Replay && OpenRacer.Replay.confirmLeave) OpenRacer.Replay.confirmLeave(again); else again(); };
    document.getElementById("raceMenu").onclick = leaveToMenu;
    renderResults();
    try { document.getElementById("raceAgain").focus({ preventScroll: true }); } catch(e) { /* no focus */ }
}

function renderResults() {
    var rows = standings();
    var position = rows.map(function(r) { return r.player; }).indexOf(true) + 1;
    var leader = rows[0], leaderProgress = !leader ? 0 : leader.time !== null ? race.laps : leader.progress;      // (a car that is in drives on: its progress grows)
    var html = "<div style=\"font-size: 26px; font-weight: bold; margin-bottom: 4px;\">" + (rows.length < 2 ? "Finished" : position === 1 ? "You won!" : "Finished P" + position) + "</div>" +
        "<div style=\"color: var(--muted); margin-bottom: 14px;\">" + race.laps + " laps · " + escapeHtml(currentTrack.name || currentTrack.id) + "</div>" +
        "<table style=\"border-collapse: collapse; width: 100%; font-size: 15px;\">" +
        "<tr style=\"color: var(--muted); text-align: left;\"><th style=\"padding: 4px 10px 4px 0;\">#</th><th>Car</th><th style=\"text-align: right;\">Best lap</th><th style=\"text-align: right;\">Time</th></tr>";
    rows.forEach(function(r, i) {
        // (a car that is still running: how many laps it is behind the leader, when it is; it only said "running")
        var down = Math.max(0, Math.floor(leaderProgress - (r.progress || 0) + 1e-6));      // (whole laps behind: a car on its last lap, 0.05 behind, said +1 lap)
        var time = r.time === null ? (down > 0 ? "+" + down + " lap" + (down > 1 ? "s" : "") : "running") : (i === 0 ? Hud.formatTime(r.time) : "+" + Hud.formatTime(r.time - rows[0].time));
        html += "<tr style=\"" + (r.player ? "color: var(--accent2); font-weight: bold;" : "") + "\"><td style=\"padding: 5px 10px 5px 0;\">" + (i + 1) + "</td><td>" + escapeHtml(r.name) + "</td>" +
            "<td style=\"text-align: right; padding-left: 16px;\">" + (r.best === null ? "–" : Hud.formatTime(r.best)) + "</td><td style=\"text-align: right; padding-left: 16px;\">" + time + "</td></tr>";
    });
    html += "</table>";
    if(html === resultsHtml) return;
    resultsHtml = html;
    resultsPanel.querySelector(".table").innerHTML = html;
}

// To the main menu: a recording that was not saved is asked about first (Replay.js)
function leaveToMenu() {
    var leave = function() { window.location.href = window.location.pathname; };
    if(OpenRacer.Replay && OpenRacer.Replay.confirmLeave) OpenRacer.Replay.confirmLeave(leave); else leave();
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
        "background: rgba(20, 24, 31, 0.85); color: #ffffff; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; border-radius: 6px; text-align: center; line-height: 1.4;";
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
        "background: rgba(20, 24, 31, 0.85); color: #ffffff; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; border-radius: 6px; text-align: center; line-height: 1.4; min-width: 320px;";
    document.body.appendChild(overlay);
    sp.overlay = overlay;
    // the car's keys and pads do nothing: the skidpad drives
    var targetSpeed = 3, radiusIndex = 0;
    car.inputLocked = true;
    // (per second, not per frame: on a screen of 144 Hz the speed went up 2.4 times as fast, and the same car gave another g on another computer)
    car.pollInput = function(delta) {
        var v = this.vehicle, dt = delta > 0 ? Math.min(0.1, delta) : 1 / 60;
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
        headingError = isFinite(headingError) ? Math.atan2(Math.sin(headingError), Math.cos(headingError)) : 0;      // (no loop: an infinite angle kept it going for ever)
        // a positive steering angle turns the car towards a bigger heading (the way the circle goes); too wide (r above R) and a
        // nose that points outside the tangent both ask for more of it
        var wanted = base + 0.08 * (r - R) + 0.6 * headingError;
        wanted = Math.max(-this.turnLimit, Math.min(this.turnLimit, wanted));
        this.turnAngle += (wanted - this.turnAngle) * (1 - Math.pow(0.7, dt * 60));
        // the speed: up by a quarter of a metre per second every second
        targetSpeed += 0.25 * dt;
        // the throttle is set, not tapped: a little more than it takes to hold the speed, in the measure that the car is behind
        var error = targetSpeed - speed;
        this.accelerate = this.brake = false;
        this.throttle = Math.max(0, Math.min(0.7, 0.12 + error * 0.25));
        this.brakePedal = error < -1.5 ? Math.min(0.4, (-error - 1.5) * 0.2) : 0;
        // the result: the most lateral acceleration while the car still follows the circle
        // the slip angle of the car means nothing until it moves (at a standstill it is the angle of noise)
        var slip = speed > 2 ? Math.atan2(v.v, v.u) : 0;
        var ay = Math.abs(v.ay);
        var onLine = Math.abs(r - R) < 4 && Math.abs(slip) < 0.14;
        if(onLine && ay > sp.best) { sp.best = ay; sp.bestSpeed = speed; }
        if(speed > 2 && (Math.abs(r - R) > 6 || Math.abs(slip) > 0.25)) skidpadDone();
        // a car that understeers wide does not let go: it just cannot go faster; when the speed stays three metres per second
        // behind what is asked for three seconds, that is the limit too
        sp.stalled = targetSpeed - speed > 3 ? (sp.stalled || 0) + dt : 0;
        if(sp.stalled > 3) skidpadDone();
        overlay.innerHTML = "<b>Skidpad</b> · circle of " + circle() + "<br>" + (ay / 9.81).toFixed(2) + " g at " + speedText(speed) + " · best " + (sp.best / 9.81).toFixed(2) + " g";
    };
    car.vehicle.tcEnabled = Settings.option("tc"); car.vehicle.escEnabled = false;
    // the speed and the circle in the units of the settings (km/h and m, or mph and ft: it was always km/h)
    function imperial() { return Settings.option("units") === "imperial"; }
    function speedText(speed) { return imperial() ? Math.round(speed * 2.23694) + " mph" : Math.round(speed * 3.6) + " km/h"; }
    function circle() { return imperial() ? Math.round(R * 3.28084) + " ft" : R + " m"; }

    function skidpadDone() {
        sp.running = false;
        var g = sp.best / 9.81;
        // (on asphalt, for the AI: it drives this car with this setup in the bends with the grip that it held here)
        // (tuned here: the measurement is kept for the car as it is tuned now, which is the setup a race loads once the tuning is saved as one; it was not kept at all,
        // and a car tuned on the skidpad, the way to tune it, never had its grip measured)
        if(!skidpadSurface && g > 0.3 && OpenRacer.SkidpadGrip) {
            var measured = typeof Tuning !== "undefined" && Tuning.changed && Tuning.changed() && Tuning.tunedConfig ? Tuning.tunedConfig() : (sp.tuned ? null : carConfig);
            if(measured) OpenRacer.SkidpadGrip.set(Object.assign({}, measured, { id: carConfig.id }), g);      // (the tuned config has no id of its own)
        }
        var panel = document.createElement("div");
        panel.style.cssText = "position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 1002; min-width: 380px; padding: 22px 28px; " +
            "background: rgba(24, 29, 35, 0.95); color: #ffffff; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; border-radius: 10px; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6); text-align: center;";
        var verdict = g > 1.1 ? "a racing car on slicks" : g > 0.95 ? "a sports car" : g > 0.85 ? "a good road car" : g > 0.75 ? "an ordinary road car" : "a van";
        panel.innerHTML = "<div style=\"font-size: 15px; color: var(--muted); letter-spacing: 2px;\">SKIDPAD · " + escapeHtml(carConfig.name || carConfig.id) + (skidpadSurface ? " · " + escapeHtml(skidpadSurface.name.toUpperCase()) : "") + "</div>" +
            "<div style=\"font-size: 54px; font-weight: bold; margin: 6px 0 2px;\">" + g.toFixed(2) + " g</div>" +
            "<div style=\"color: var(--head); margin-bottom: 18px;\">held at " + speedText(sp.bestSpeed) + " on the circle of " + circle() + " · like " + verdict + "</div>" +
            "<button id=\"skidReset\" style=\"padding: 9px 18px; margin: 0 4px; font: bold 15px Arial; background: var(--accent); color: #fff; border: 0; border-radius: 6px; cursor: pointer;\">Reset</button>" +
            "<button id=\"skidTune\" style=\"padding: 9px 18px; margin: 0 4px; font: bold 15px Arial; background: var(--line); color: #fff; border: 0; border-radius: 6px; cursor: pointer;\">Tune</button>" +
            "<button id=\"skidMenu\" style=\"padding: 9px 18px; margin: 0 4px; font: bold 15px Arial; background: var(--line); color: #fff; border: 0; border-radius: 6px; cursor: pointer;\">Back to the menu</button>";
        document.body.appendChild(panel);
        sp.panel = panel;
        document.getElementById("skidReset").onclick = skidpadReset;
        document.getElementById("skidTune").onclick = function() { sp.tuned = true; Tuning.toggle(); };
        document.getElementById("skidMenu").onclick = leaveToMenu;
    }

    function skidpadReset() {
        if(sp.panel) { sp.panel.remove(); sp.panel = null; }
        sp.best = 0; sp.bestSpeed = 0; sp.stalled = 0; targetSpeed = 3; sp.running = true;
        car.turnAngle = 0;
        car.place(R, 0, Math.PI / 2);
        car.vehicle.freshTyres(85);
    }
    race.skidpadReset = skidpadReset;
}

var playerLineIndex = null, playerLineLaps = 0, playerLastFraction = 0, playerMaxFraction = 0, playerCrossed = false;
function updateRace(delta) {
    if(!race.ghost) return;
    if(!race.playerFinished) race.playerTop = Math.max(race.playerTop || 0, Math.abs(car.vehicle.u));          // (the top speed of the player in this race: after the finish the car goes at half of it)
    var vehicles = [car.vehicle].concat(race.opponents.map(function(o) { return o.vehicle; }));
    if(OpenRacer.Atmosphere) OpenRacer.Atmosphere.update(delta, vehicles);       // (the ground gets wet in the rain and white in the snow, and dries and melts again)
    race.opponents.forEach(function(o) { o.update(delta, vehicles); });
    if(race.opponents.length) OpenRacer.collideCars(vehicles);
    if(OpenRacer.RigidObjects) OpenRacer.RigidObjects.update(delta, vehicles);
    race.ghost.update(car, delta);
    if(race.opponents.length && race.line && !race.playerFinished) {
        // the place: how far along the line everyone is, counted the same way for the player as for the AI (laps of the line)
        playerLineIndex = race.line.nearest(car.vehicle.x, car.vehicle.z, playerLineIndex);
        var fraction = race.line.fractionOf(playerLineIndex);
        if(fraction < 0.2 && playerLastFraction > 0.8 && !playerCrossed) { playerCrossed = true; playerMaxFraction = 0; }      // (the first time over the line: lap 1 starts, as for the AI)
        else if(fraction < 0.2 && playerLastFraction > 0.8 && playerMaxFraction > 0.5) { playerLineLaps++; playerMaxFraction = 0; }
        else if(fraction > 0.8 && playerLastFraction < 0.2 && playerLineLaps > 0 && playerMaxFraction < 0.2) { playerLineLaps--; playerMaxFraction = 1; }
        if(fraction < 0.8) playerMaxFraction = Math.max(playerMaxFraction, fraction);
        playerLastFraction = fraction;
        var mine = playerLineLaps + fraction - (playerCrossed ? 0 : 1);
        var position = 1, ahead = Infinity, behind = Infinity;
        race.opponents.forEach(function(o) { if(!o.loaded) return; if(o.progress > mine) { position++; ahead = Math.min(ahead, o.progress - mine); } else behind = Math.min(behind, mine - o.progress); });
        car.racePosition = position;
        // the gaps to the car ahead and the one behind, in seconds: the part of a lap between them times a lap (the best of the player, else of the field)
        var lapRef = car.lapTimes.length ? Math.min.apply(null, car.lapTimes) : null;
        if(lapRef === null) race.opponents.forEach(function(o) { if(o.lapTimes.length) lapRef = Math.min(lapRef === null ? Infinity : lapRef, Math.min.apply(null, o.lapTimes)); });
        car.gapAhead = lapRef && isFinite(ahead) ? ahead * lapRef : null;
        car.gapBehind = lapRef && isFinite(behind) ? behind * lapRef : null;
    }
    if(race.state) updateRaceFlow(delta);
}

function onEnterFrame() {
    Settings.update();
    // a replay from a file: once the cars have loaded it is shown, and the game itself never runs
    if(race.viewer && car && car.isReady() && race.opponents.every(function(o) { return o.loaded; })) {
        var inEditor = new URLSearchParams(window.location.search).get("editor") === "1";
        OpenRacer.Replay.editor = inEditor;               // (the video editor has its own keys, see VideoEditor.js)
        OpenRacer.Replay.load(race.viewer, [car].concat(race.opponents));
        race.viewer = null;
        OpenRacer.Replay.start();
        if(inEditor) OpenRacer.VideoEditor.start();
        lastFrameTime = performance.now();
    }
    if(race.viewer) return;
    // the video editor (VideoEditor.js): two pictures of the replay and a timeline
    if(OpenRacer.VideoEditor && OpenRacer.VideoEditor.active) {
        var editNow = performance.now();
        var editDelta = Math.min(0.1, (editNow - lastFrameTime) / 1000);
        lastFrameTime = editNow;
        OpenRacer.VideoEditor.frame(editDelta);
        return;
    }
    // the replay (Replay.js): the game stands still and the recording is shown
    if(OpenRacer.Replay && OpenRacer.Replay.active) {
        if(typeof ForceFeedback !== "undefined") ForceFeedback.idle();       // (the wheel is let go while the replay plays)
        var replayNow = performance.now();
        var replayDelta = Math.min(0.1, (replayNow - lastFrameTime) / 1000);
        lastFrameTime = replayNow;
        OpenRacer.Replay.frame(replayDelta);
        return;
    }
    EngineSound.setPaused(Settings.isPaused());
    if(car && Settings.isPaused()) {
        EngineSound.update(car.engineRPM, 0);
        if(typeof ForceFeedback !== "undefined") ForceFeedback.idle();       // (and the wheel while the menu is open)
    }
    if(car && !Settings.isPaused()) {
        var now = performance.now();
        var d = (now - lastFrameTime) / 1000;
        lastFrameTime = now;
        if(d > 0.1) d = 0.1; // after a pause of the browser (another tab, no focus) the game goes on from here, it does not catch up
        // a machine that cannot simulate in real time: a frame of 0.1 s is 34 steps of the car, which takes longer yet, so the next frame is longer again and the game fell to 6 frames
        // a second at 290 km/h (the shell of the tyre costs more with the speed). The game now takes a step of time that the physics can do in 40 ms: it runs in slow motion, everything
        // (the timers, the replay, the sound) with it, and the frames stay smooth
        if(d > simLimit) d = simLimit;
        var simStart = performance.now();
        car.update(d, true);
        var simMs = performance.now() - simStart;
        if(d > 0.004) {
            var perSecond = simMs / d;                                    // (ms of physics for one second of game)
            simCost += (perSecond > simCost ? 0.25 : 0.05) * (perSecond - simCost);
            simLimit = Math.max(0.016, Math.min(0.1, 40 / simCost));
        }
        if(OpenRacer.GateMarkers) OpenRacer.GateMarkers.update(car);
        updateRace(d);
        if(OpenRacer.Replay) OpenRacer.Replay.record(d);   // everything is recorded from the start, for the replay
    }
}

var simCost = 0, simLimit = 0.1;       // (see the frame: ms of physics for a second of game, and the longest step of game time for a frame)

var query = new URLSearchParams(window.location.search);
if(query.get("car") && query.get("track")) {
    startGame(query.get("car"), query.get("track"));
} else {
    MainMenu.show();
}
