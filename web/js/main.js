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
    else if(name === "toneMapping" && typeof renderer !== "undefined" && renderer) applyToneMapping(value);
});
EngineSound.setMuted(!Settings.option("sound"));

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
        s = new RACER.Scene();
        s.init();
        initialiseMaterials();
        loadTrack(trackFound, trackLoaded);
    }).catch(function(error) {
        console.error(error);
        window.location.href = window.location.pathname;
    });
}

function trackLoaded() {
    car = new OpenRacer.Car(carConfig);
    telemetry = new OpenRacer.Telemetry({car: car, domElement: document.getElementById("telemetry")});
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
    }
}

// the dashboard elements exist above this script, so they can be looked up immediately
var dash_tc = document.getElementById("dash-tc");
var dash_abs = document.getElementById("dash-abs");

var query = new URLSearchParams(window.location.search);
if(query.get("car") && query.get("track")) {
    startGame(query.get("car"), query.get("track"));
} else {
    MainMenu.show();
}
