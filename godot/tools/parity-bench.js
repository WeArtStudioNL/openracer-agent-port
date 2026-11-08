#!/usr/bin/env node
/*
 * parity-bench.js
 *
 * The road test of the physics parity between the browser game and the Godot version: it runs the browser's Vehicle.js (with
 * Engine.js, Wheel.js, TyreShell.js, Motorcycle.js) headless in node on a flat road, set up as the game sets up a car (vehicleParams
 * and the retune of Opponent.js, the rubber and the size of a custom tyre of the wheel library as Car.js gives them), and measures
 * what res://tools/test_parity.tscn measures in Godot, with the same controllers:
 *
 *   (TC on as the AI has it when the car has it, ESC off, ABS on, in every test)
 *   accelerate   full throttle from a standstill: 0-50, 0-100 km/h, the top speed, and every upshift
 *                (the gear, the engine speed just before it, the road speed)
 *   brake        from 100 km/h (50 when the top speed is under 110) to a standstill, ABS on: the distance
 *   skidpad      a circle of 40 m: the steering held on the curvature of the path (a PI controller), the speed raised by
 *                0.25 m/s every second from 5 m/s; the most lateral acceleration (speed x yaw rate) while the car follows the circle
 *                (curvature within 6 %, slip angle of the body under 0.12 rad)
 *
 *     node godot/tools/parity-bench.js [car] [--shell] [--json] [--verbose]
 *
 * (Only reads ../../web; it changes nothing there.)
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..", "web");
const G = 9.81, KMH = 1 / 3.6, RADIUS = 40, DT = 1 / 60;

const sandbox = { OpenRacer: {}, console: console, Math: Math,
    THREE: { Vector3: class { constructor(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } } } };
vm.createContext(sandbox);
for (const file of ["Engine.js", "Wheel.js", "TyreShell.js", "Ground.js", "Vehicle.js", "Motorcycle.js", "Opponent.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, "js", file), "utf8"), sandbox, { filename: file });
}
const uCoeff = vm.runInContext("(" + fs.readFileSync(path.join(ROOT, "js", "Surfaces.js"), "utf8").match(/var uCoeff = (\{[\s\S]*?\});/)[1] + ")", sandbox);
const getSurface = (name) => uCoeff[name] || uCoeff.track01;
const flatRoad = new sandbox.OpenRacer.FlatGround(0, "road");

function loadCars(only) {
    const dir = path.join(ROOT, "cars");
    return fs.readdirSync(dir).filter((id) => fs.existsSync(path.join(dir, id, "car.json")) && (!only || id === only)).sort()
        .map((id) => Object.assign({ id }, JSON.parse(fs.readFileSync(path.join(dir, id, "car.json"), "utf8"))));
}

function custom(config, axle) {
    const a = ((config.wheels || {}).library || {})[axle] || {};
    return a.tyre === "custom" ? (a.custom || {}) : null;
}

function makeCar(config, shell) {
    const input = { throttle: 0, brakePedal: 0, clutch: 0, clutchPedalPresent: false, handbrake: false, turnAngle: 0, neutral: false, reverse: false,
        manualGearbox: false, current_gear: 0, parkingLock: false, leanFromBend: config.type === "motorcycle",
        maxTurn: (config.chassis.max_steer_deg || 30) * Math.PI / 180 };
    const params = sandbox.OpenRacer.vehicleParams(config, getSurface);
    params.simpleTyres = !shell;
    const v = new sandbox.OpenRacer.Vehicle(params, input);
    v.ground = flatRoad;
    v.absEnabled = true; v.tcEnabled = false; v.escEnabled = false;
    v.engineDamageOn = false;
    const tyres = config.tyres || {}, engine = config.engine || {}, assists = config.assists || {};
    v.retune({
        grip: tyres.grip !== undefined ? tyres.grip : 1, grip_balance: tyres.grip_balance !== undefined ? tyres.grip_balance : 1,
        pressure_front: tyres.pressure_front || 2.2, pressure_rear: tyres.pressure_rear || 2.2,
        cornering: tyres.cornering !== undefined ? tyres.cornering : 1,
        rolling_resistance: tyres.rolling_resistance !== undefined ? tyres.rolling_resistance : 0.015,
        power: engine.power_scale !== undefined ? engine.power_scale : 1, engine_braking: engine.braking_scale !== undefined ? engine.braking_scale : 1,
        clutch: config.drivetrain.clutch !== undefined ? config.drivetrain.clutch : 1.5,
        tc_allowance: assists.tc_allowance !== undefined ? assists.tc_allowance : 1, esc_gain: assists.esc_gain !== undefined ? assists.esc_gain : 1
    });
    // the custom tyre of the wheel library (Car.js): its rubber and tread per axle, and its size (the wheels of the model are measured from it)
    const cf = custom(config, "front"), cr = custom(config, "rear");
    const rubberOf = (c) => c ? (c.rubber >= 0 ? c.rubber : 50) : -1, treadOf = (c) => c && c.tread >= 0 ? c.tread : 0;
    if (cf || cr) v.setRubber(rubberOf(cf), rubberOf(cr), treadOf(cf), treadOf(cr));
    if (config.type !== "motorcycle" && (cf && cf.diameter > 0 || cr && cr.diameter > 0)) {
        const df = cf && cf.diameter > 0 ? cf.diameter : config.chassis.tire_diameter, dr = cr && cr.diameter > 0 ? cr.diameter : config.chassis.tire_diameter;
        v.retune({ tire_diameter: (df + dr) / 2, wheel_diameters: [df, df, dr, dr] });
    }
    v.reset(0, 0, 0);
    return { v, input, config };
}

function run(car, seconds, control, stop) {
    let t = 0;
    while (t < seconds) {
        control(t, car.v, car.input);
        car.v.update(DT);
        t += DT;
        if (stop && stop(t, car.v)) return t;
    }
    return null;
}

function accelerate(config, shell) {
    const car = makeCar(config, shell);
    car.v.tcEnabled = car.v.tcFitted;      // (the browser's simple tyre without it: the Muscle's welded rear axle rings at the launch and the car stays at 32 km/h)
    run(car, 2, (t, v, input) => { input.throttle = 0; });        // (settle on the springs)
    let t50 = null, t100 = null, top = 0, topAt = 0, lastGear = car.input.current_gear, lastRpm = 0;
    const shifts = [];
    run(car, 120, (t, v, input) => { input.throttle = 1; }, (t, v) => {
        if (t50 === null && v.u >= 50 * KMH) t50 = t;
        if (t100 === null && v.u >= 100 * KMH) t100 = t;
        if (car.input.current_gear !== lastGear) { shifts.push([lastGear + 1, Math.round(lastRpm), +(v.u / KMH).toFixed(1)]); lastGear = car.input.current_gear; }
        lastRpm = v.engine.getRPM();
        if (v.u > top + 0.03) { top = v.u; topAt = t; }
        return t - topAt > 8 && t > 20;
    });
    return { t50, t100, top: top / KMH, shifts };
}

function brake(config, shell, from) {
    const car = makeCar(config, shell);
    car.v.tcEnabled = car.v.tcFitted;
    if (run(car, 120, (t, v, input) => { input.throttle = 1; }, (t, v) => v.u >= from) === null) return null;
    const x0 = car.v.x, z0 = car.v.z;
    if (run(car, 30, (t, v, input) => { input.throttle = 0; input.brakePedal = 1; }, (t, v) => v.u < 0.3) === null) return null;
    return Math.hypot(car.v.x - x0, car.v.z - z0);
}

// (the browser: + is to the right; the bench turns right)
function skidpad(config, shell, verbose) {
    const car = makeCar(config, shell);
    car.v.tcEnabled = car.v.tcFitted;      // (TC on in every test, as the AI drives and as test_parity runs with tc:true)
    const L = config.chassis.wheelbase, lock = (config.chassis.max_steer_deg || 30) * Math.PI / 180;
    let integ = 0, best = 0, bestSpeed = 0, ayF = 0, bad = 0;
    run(car, 300, (t, v, input) => {
        const target = 5 + t * 0.25, err = target - v.u;
        if (err > 0) { input.throttle = Math.min(1, err * 0.5); input.brakePedal = 0; } else { input.throttle = 0; input.brakePedal = Math.min(1, -err * 0.3); }
        const k = v.u > 1 ? v.r / v.u : 0;                    // the curvature of the path, to the right
        integ += (1 / RADIUS - k) * DT * 2.0;
        integ = Math.max(-lock, Math.min(lock, integ));
        input.turnAngle = Math.max(-lock, Math.min(lock, Math.atan(L / RADIUS) + integ + (1 / RADIUS - k) * 1.0));
        ayF += (v.u * v.r - ayF) * Math.min(1, DT / 0.5);
        const beta = Math.abs(Math.atan2(v.v, Math.max(0.1, v.u)));
        const follows = Math.abs(k * RADIUS - 1) < 0.06 && beta < 0.12;
        if (t > 8 && follows && ayF > best) { best = ayF; bestSpeed = v.u; }
        bad = t > 8 && !follows ? bad + DT : 0;
        if (verbose && Math.abs(t % 5) < DT) console.log("   t " + t.toFixed(0) + " u " + (v.u / KMH).toFixed(1) + " k*R " + (k * RADIUS).toFixed(3) + " ay " + (ayF / G).toFixed(3) + " steer " + (input.turnAngle * 57.3).toFixed(2) + " beta " + (beta * 57.3).toFixed(1) + " lean " + ((v.lean || 0) * 57.3).toFixed(1) + " FL/FR/RL/RR load/fy " + [1, 0, 2, 3].map((i) => v.wheels[i].weight.toFixed(0) + "/" + v.wheels[i].fy.toFixed(0)).join(" "));
    }, (t, v) => bad > 3);
    return { g: best / G, speed: bestSpeed / KMH };
}

function measure(config, shell, verbose) {
    const a = accelerate(config, shell);
    const from = a.top >= 110 ? 100 : 50;
    return { "0-50 (s)": a.t50, "0-100 (s)": a.t100, "top (km/h)": a.top, ["brake " + from + "-0 (m)"]: brake(config, shell, from * KMH),
        "skidpad R40 (g)": null, ...(() => { const s = skidpad(config, shell, verbose); return { "skidpad R40 (g)": s.g, "skidpad at (km/h)": s.speed }; })(),
        shifts: a.shifts.map((s) => s[0] + ">" + (s[0] + 1) + "@" + s[1] + "rpm/" + s[2]).join(" ") };
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const shell = args.includes("--shell"), json = args.includes("--json"), verbose = args.includes("--verbose");
    const only = args.find((a) => !a.startsWith("--"));
    const out = {};
    for (const config of loadCars(only)) {
        out[config.id] = measure(config, shell, verbose);
        if (!json) console.log(config.id.padEnd(26) + Object.entries(out[config.id]).map(([k, v]) => k + " " + (typeof v === "number" ? v.toFixed(k.includes("(g)") ? 3 : 2) : v)).join(", "));
    }
    if (json) console.log(JSON.stringify(out, null, 1));
}
module.exports = { makeCar, measure };
