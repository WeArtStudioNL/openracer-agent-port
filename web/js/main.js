/*
 * main.js
 *
 * Starts the game: sets up the scene and the materials, loads the track and, once that is done, creates the car.
 */

var lastFrameTime = performance.now();
var s = new RACER.Scene();
var telemetry;

s.init();
initialiseMaterials();

var car;
function trackLoaded() {
    car = new OpenRacer.Car({
        wheelbase: 3.3,
        front_track: 1.8,
        rear_track: 1.8,
        tire_diameter: 0.67564,
        mass: 1476,
        weight_distribution: 0.593,
        width: 1.86,
        height: 1.295,
        length: 4.813
    });

    telemetry = new OpenRacer.Telemetry({car: car, domElement: document.getElementById("telemetry")});
}

function onEnterFrame() {
    if(car) {
        var now = performance.now();
        var d = (now - lastFrameTime) / 1000;
        lastFrameTime = now;
        car.update(d, true);
    }
}

// the dashboard elements exist above this script, so they can be looked up immediately
var dash_tc = document.getElementById("dash-tc");
var dash_abs = document.getElementById("dash-abs");

loadTrack(trackLoaded);
