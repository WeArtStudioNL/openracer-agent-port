/*
 * engine-damage-test.js
 *
 * Runs the engine damage model (web/js/EngineDamage.js) against the engine of the Muscle with a stand-in shell, at a fixed engine speed and car speed,
 * and prints what happens to the heat, the fluids, the power and the misfires. Not part of the game:   node tools/engine-damage-test.js
 *
 * A healthy engine has to stay between 80 and 102 degrees at idle and flat out; a hurt radiator, a hurt oil pan, a hurt ignition and a bent block have to
 * show their own failure at their own pace (EngineDamage.js, ENGINE-DAMAGE.md).
 */

var fs = require("fs"), path = require("path"), vm = require("vm");
var root = path.join(__dirname, "..", "web");
var sandbox = { OpenRacer: {}, console: console, Math: Math };
sandbox.window = sandbox;
vm.createContext(sandbox);
["Engine.js", "EngineDamage.js"].forEach(function (f) { vm.runInContext(fs.readFileSync(path.join(root, "js", f), "utf8"), sandbox, { filename: f }); });
var OpenRacer = sandbox.OpenRacer;

var car = JSON.parse(fs.readFileSync(path.join(root, "cars", "openracer-muscle", "car.json"), "utf8"));

// the engine of the Muscle (the same numbers as the game gives it)
function makeEngine() {
    var e = car.engine;
    var engine = new OpenRacer.Engine({ idle_rpm: e.idle_rpm, limiter_rpm: e.limiter_rpm, inertia: e.inertia, torque_curve: e.torque_curve, power_scale: e.power_scale, braking_scale: e.braking_scale, limiter_hz: e.limiter_hz });
    engine.running = true;
    return engine;
}

// a stand-in shell: nodes on a grid round the engine bay and the radiator; bend(k) and torn(k) are what the scenario says
function makeShell(hurtOf) {
    var nodes = [], bay = [0, -0.3 + 0.55, 1.35 - 0.2];
    for (var x = -0.6; x <= 0.61; x += 0.3) for (var y = -0.2; y <= 1.0; y += 0.3) for (var z = bay[2] - 1.0; z <= bay[2] + 1.4; z += 0.3) nodes.push([x, y, z]);
    return {
        bodyCount: nodes.length,
        restPosition: function (k, out) { out.x = nodes[k][0]; out.y = nodes[k][1]; out.z = nodes[k][2]; return out; },
        bendOf: function (k) { return hurtOf(nodes[k], bay).bend || 0; },
        elasticOf: function (k) { return hurtOf(nodes[k], bay).elastic || 0; },
        torn: function (k) { return !!hurtOf(nodes[k], bay).torn; }
    };
}

function run(name, hurtOf, options) {
    options = options || {};
    var engine = makeEngine();
    var vehicle = { softBody: makeShell(hurtOf), engine: engine, af: 1.35, ar: 1.49, wheelbase: 2.84, cgHeight: 0.3, parameters: { engine_place: "front", engine: {} }, vx: 0, vz: options.speed || 0, ay: 0 };
    if (options.parts) vehicle.parts = { parts: options.parts(vehicle) };
    var damage = new OpenRacer.EngineDamage(vehicle, options.config);
    engine.omega = (options.rpm || 900) * Math.PI / 30;
    var dt = 1 / 120, log = [], misfireTime = 0, steps = 0, stalledAt = null, seizedAt = null, t = 0;
    for (t = 0; t < (options.seconds || 120); t += dt) {
        engine.getNetTorque(options.throttle !== undefined ? options.throttle : 0);
        damage.update(dt);
        if (engine.misfireCut) misfireTime += dt;
        if (!engine.running && stalledAt === null) stalledAt = t;
        if (vehicle.engineHealth.failed && seizedAt === null) seizedAt = t;
        if (!engine.running) engine.running = !engine.disabled && options.restart !== false;       // (the driver starts it again)
        steps++;
        if (steps % (120 * 15) === 0) log.push({ t: Math.round(t), h: JSON.parse(JSON.stringify(vehicle.engineHealth)), power: engine.healthScale });
    }
    var h = vehicle.engineHealth;
    console.log("\n== " + name);
    console.log("nodes in the bay: " + damage.nodes + ", usable: " + damage.usable);
    log.forEach(function (l) {
        console.log("  t=" + String(l.t).padStart(3) + " s  temp " + l.h.temp.toFixed(0).padStart(3) + "  oil " + (l.h.oil * 100).toFixed(0).padStart(3) + "%  coolant " + (l.h.coolant * 100).toFixed(0).padStart(3) + "%  wear " + l.h.wear.toFixed(2) +
            "  power " + l.power.toFixed(2) + "  misfire " + l.h.misfire.toFixed(2) + "  steam " + l.h.steam.toFixed(2) + (l.h.failed ? "  FAILED" : ""));
    });
    console.log("  misfire cut " + (100 * misfireTime / t).toFixed(1) + " % of the time; first stall " + (stalledAt === null ? "never" : stalledAt.toFixed(1) + " s") + "; failed " + (seizedAt === null ? "never" : seizedAt.toFixed(1) + " s"));
    return { h: h, misfire: misfireTime / t, stalledAt: stalledAt, seizedAt: seizedAt, engine: engine };
}

var failures = [];
function expect(label, ok) { console.log("  " + (ok ? "ok   " : "FAIL ") + label); if (!ok) failures.push(label); }

var whole = function () { return {}; };
// the nodes of a radiator that is an object of the model (a part of the car): the ones round its place
var radiatorNodes = function (vehicle) {
    var tmp = { x: 0, y: 0, z: 0 }, nodes = [];
    for (var k = 0; k < vehicle.softBody.bodyCount; k++) { vehicle.softBody.restPosition(k, tmp); if (Math.hypot(tmp.x, tmp.y - 0.3, tmp.z - 1.7) < 0.5) nodes.push(k); }
    return nodes;
};
var radiator = function (n, bay) { return { bend: Math.hypot(n[0], n[1] - (bay[1] + 0.05), n[2] - (bay[2] + 0.55)) < 0.55 ? 0.33 : 0 }; };
var pan = function (n, bay) { return { bend: Math.hypot(n[0], n[1] - bay[1], n[2] - bay[2]) < 0.75 && n[1] < bay[1] + 0.1 * 0.75 ? 0.33 : 0 }; };
var top = function (n, bay) { return { bend: Math.hypot(n[0], n[1] - bay[1], n[2] - bay[2]) < 0.75 && n[1] > bay[1] - 0.075 ? 0.33 : 0 }; };
var block = function (n, bay) { return { bend: Math.hypot(n[0], n[1] - bay[1], n[2] - bay[2]) < 0.75 ? 0.33 : 0 }; };
var dented = function (n, bay) { return { bend: Math.hypot(n[0], n[1] - bay[1], n[2] - bay[2]) < 0.75 ? 0.10 : 0 }; };

var r;
r = run("whole engine, idle, standing, 3 minutes", whole, { rpm: 900, throttle: 0, speed: 0, seconds: 180 });
expect("idle stays 70..95 degrees", r.h.temp > 70 && r.h.temp < 95);
r = run("whole engine, 90 % throttle at 5000 rpm and 40 m/s, 3 minutes", whole, { rpm: 5000, throttle: 0.9, speed: 40, seconds: 180 });
expect("flat out at speed stays under 102 degrees", r.h.temp < 102);
expect("no misfires, no wear, full power", r.misfire === 0 && r.h.wear < 0.001 && r.engine.healthScale > 0.99);
r = run("whole engine, flat out at 5000 rpm standing (fans only), 75 seconds", whole, { rpm: 5000, throttle: 1, speed: 0, seconds: 75 });
expect("standing flat out gets hot (over 105) but does not fail in 75 s", r.h.temp > 105 && r.h.failed === 0);

r = run("destroyed radiator, 60 % throttle at 4000 rpm and 30 m/s", radiator, { rpm: 4000, throttle: 0.6, speed: 30, seconds: 180 });
expect("the coolant runs out", r.h.coolant < 0.05);
expect("it overheats above 118 degrees", r.h.temp > 118);
expect("it loses power", r.engine.healthScale < 0.85);

r = run("destroyed oil pan, 60 % throttle at 4000 rpm and 30 m/s, 4 minutes", pan, { rpm: 4000, throttle: 0.6, speed: 30, seconds: 240 });
expect("the oil runs out", r.h.oil < 0.05);
expect("the bearings wear", r.h.wear > 0.3);

r = run("destroyed ignition (the nodes above the engine), 50 % throttle at 3000 rpm", top, { rpm: 3000, throttle: 0.5, speed: 20, seconds: 60 });
expect("it misfires (a third of the time or more) and stays dead or stumbling", r.misfire > 0.3 || r.h.ignition > 0.95);

r = run("a bent block (33 cm), 60 % throttle at 4000 rpm", block, { rpm: 4000, throttle: 0.6, speed: 30, seconds: 120 });
expect("power is down by a third or more", r.engine.healthScale < 0.7);

r = run("a dent of 10 cm round the engine, 60 % throttle at 4000 rpm", dented, { rpm: 4000, throttle: 0.6, speed: 30, seconds: 180 });
expect("a small dent keeps most of the power and does not overheat", r.engine.healthScale > 0.8 && r.h.temp < 105);

r = run("radiator part torn off, 40 % throttle at 3000 rpm and 20 m/s, 30 s", whole, { rpm: 3000, throttle: 0.4, speed: 20, seconds: 30, parts: function (v) { return [{ name: "radiator", state: "free", nodes: [] }]; } });
expect("the coolant is gone in 10 s (a minute is far too slow for a radiator that is off)", r.h.coolant < 0.01);
r = run("radiator part held, crushed (33 cm), 40 % throttle at 3000 rpm and 20 m/s, 60 s", function (n, bay) { return { bend: Math.hypot(n[0], n[1] - 0.3, n[2] - 1.7) < 0.5 ? 0.33 : 0 }; }, { rpm: 3000, throttle: 0.4, speed: 20, seconds: 60, parts: function (v) { return [{ name: "Radiator", state: "held", nodes: radiatorNodes(v) }]; } });
var crushedPart = r.h.coolant;
r = run("radiator only a place in the shell, crushed (33 cm), the same drive", function (n, bay) { return { bend: Math.hypot(n[0], n[1] - 0.3, n[2] - 1.7) < 0.5 ? 0.33 : 0 }; }, { rpm: 3000, throttle: 0.4, speed: 20, seconds: 60 });
expect("a crushed radiator object drains faster than the same bend in the plain shell", crushedPart < r.h.coolant);
expect("a crushed radiator object is nearly empty after a minute", crushedPart < 0.1);

console.log(failures.length ? "\n" + failures.length + " FAILED" : "\nall ok");
process.exit(failures.length ? 1 : 0);
