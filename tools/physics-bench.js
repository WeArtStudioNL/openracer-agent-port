#!/usr/bin/env node
/*
 * physics-bench.js
 *
 * Description: A test bench for the physics of the cars, without the browser: it runs Vehicle.js (with Engine.js and Wheel.js) on
 *              a flat road and measures, for every car in web/cars, what a road test would: the time from 0 to 100 km/h (and
 *              0 to 60 mph), the distance to brake from 100 km/h (and from 60 mph), the top speed, the most lateral acceleration
 *              it holds on a skidpad, the understeer gradient and the share of the load transfer at the front. The figures of
 *              the Mustang Mach 1 are compared with those of the real car. Run it after a change to the physics or to a car:
 *
 *                  node tools/physics-bench.js            all cars
 *                  node tools/physics-bench.js mustang    one car
 *                  node tools/physics-bench.js --json     the figures as JSON
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "web");
const G = 9.81;
const KMH = 1 / 3.6, MPH = 0.44704;

// ---- the physics in a sandbox: the scripts are plain scripts that share globals, so they get a context of their own
const sandbox = {
    OpenRacer: {},
    THREE: { Vector3: class { constructor(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } } },
    console: console, Math: Math
};
vm.createContext(sandbox);
for (const file of ["Engine.js", "Wheel.js", "Vehicle.js", "Opponent.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, "js", file), "utf8"), sandbox, { filename: file });
}
// the grip of the surfaces (Helpers.js needs the browser: only its table is taken)
const helpers = fs.readFileSync(path.join(ROOT, "js", "Helpers.js"), "utf8");
const table = helpers.match(/var uCoeff = (\{[\s\S]*?\});/);
const uCoeff = vm.runInContext("(" + table[1] + ")", sandbox);
const getSurface = (name) => uCoeff[name] || uCoeff.track01;

// a flat road at y = 0
const flatRoad = { query: () => ({ y: 0, nx: 0, ny: 1, nz: 0, surface: "road", mesh: "" }) };

const REFERENCE = {
    mustang: { "0-60 mph (s)": 6.5, "60-0 mph (m)": 40, "skidpad (g)": 0.8, "top speed (km/h)": 190 }
};

function loadCars(only) {
    const dir = path.join(ROOT, "cars");
    return fs.readdirSync(dir).filter((id) => fs.existsSync(path.join(dir, id, "car.json")) && (!only || id === only))
        .map((id) => Object.assign({ id }, JSON.parse(fs.readFileSync(path.join(dir, id, "car.json"), "utf8"))));
}

// a car on the flat road, the way the game makes it (Car.js / Opponent.js plus the tuning that is in car.json)
function makeCar(config) {
    const input = { throttle: 0, brakePedal: 0, clutch: 0, clutchPedalPresent: false, handbrake: false, turnAngle: 0, neutral: false, reverse: false,
        manualGearbox: false, current_gear: 0, parkingLock: false };
    const v = new sandbox.OpenRacer.Vehicle(sandbox.OpenRacer.vehicleParams(config, getSurface), input);
    v.ground = flatRoad;
    v.absEnabled = true;
    v.tcEnabled = false;
    v.escEnabled = false;
    const tyres = config.tyres || {}, engine = config.engine || {}, assists = config.assists || {};
    v.retune({
        grip: tyres.grip !== undefined ? tyres.grip : 1,
        grip_balance: tyres.grip_balance !== undefined ? tyres.grip_balance : 1,
        cornering: tyres.cornering !== undefined ? tyres.cornering : 1,
        rolling_resistance: tyres.rolling_resistance !== undefined ? tyres.rolling_resistance : 0.015,
        power: engine.power_scale !== undefined ? engine.power_scale : 1,
        engine_braking: engine.braking_scale !== undefined ? engine.braking_scale : 1,
        clutch: config.drivetrain.clutch !== undefined ? config.drivetrain.clutch : 1.5,
        tc_allowance: assists.tc_allowance !== undefined ? assists.tc_allowance : 1,
        esc_gain: assists.esc_gain !== undefined ? assists.esc_gain : 1
    });
    v.reset(0, 0, 0);
    return { v, input, config };
}

const DT = 1 / 60;
function run(car, seconds, control, stop) {
    const { v, input } = car;
    let t = 0;
    while (t < seconds) {
        control(t, v, input);
        v.update(DT);
        t += DT;
        if (stop && stop(t, v)) return t;
    }
    return null;
}

function distanceFrom(v, x0, z0) { return Math.hypot(v.x - x0, v.z - z0); }

// ---- the tests
function accelerate(config, tc) {
    const car = makeCar(config);
    car.v.tcEnabled = tc;
    let t60 = null, t100 = null;
    run(car, 40, (t, v, input) => { input.throttle = 1; }, (t, v) => {
        if (t60 === null && v.u >= 60 * MPH) t60 = t;
        if (t100 === null && v.u >= 100 * KMH) t100 = t;
        return t100 !== null && t60 !== null;
    });
    return { t60, t100 };
}

function brake(config, fromSpeed) {
    const car = makeCar(config);
    car.v.tcEnabled = true;
    // up to speed, then on the brakes
    const reached = run(car, 60, (t, v, input) => { input.throttle = 1; }, (t, v) => v.u >= fromSpeed);
    if (reached === null) return null;
    const x0 = car.v.x, z0 = car.v.z;
    const stopped = run(car, 20, (t, v, input) => { input.throttle = 0; input.brakePedal = 1; }, (t, v) => v.u < 0.3);
    return stopped === null ? null : distanceFrom(car.v, x0, z0);
}

function topSpeed(config) {
    const car = makeCar(config);
    car.v.tcEnabled = true;
    let top = 0;
    run(car, 90, (t, v, input) => { input.throttle = 1; top = Math.max(top, v.u); });
    return top;
}

// holds a speed with the throttle and the brake (a simple controller)
function speedControl(input, v, target) {
    const error = target - v.u;
    if (error > 0) { input.throttle = Math.min(1, error * 0.5); input.brakePedal = 0; }
    else { input.throttle = 0; input.brakePedal = Math.min(1, -error * 0.3); }
}

// the skidpad: a fixed steering angle (a circle of about 50 m at low speed), the speed goes up slowly until the car does not
// follow any more: the most lateral acceleration it held
function skidpad(config) {
    const car = makeCar(config);
    car.v.tcEnabled = true;
    const L = config.chassis.wheelbase;
    const delta = L / 50;
    // the lateral acceleration is taken from the tyre forces (v.ay, filtered), and only while the car still follows the circle:
    // a car that has let go slides with a big slip angle, and a yaw transient on its way out is not grip
    let best = 0, bestSpeed = 0;
    run(car, 240, (t, v, input) => {
        input.turnAngle = delta;
        speedControl(input, v, 5 + t * 0.25);
        const ay = Math.abs(v.ay);
        if (Math.abs(Math.atan2(v.v, v.u)) < 0.12 && ay > best) { best = ay; bestSpeed = v.u; }
    }, (t, v) => t > 5 && (Math.abs(Math.atan2(v.v, v.u)) > 0.2 || Math.abs(v.ay) < best * 0.7));
    return { g: best / G, speed: bestSpeed };
}

// the steering angle needed for a lateral acceleration at a speed, and what the kinematics alone would need: the difference
// per g is the understeer gradient (positive: understeer). Also the share of the load transfer that the front axle takes.
function understeer(config, speed, ayWanted) {
    const car = makeCar(config);
    car.v.tcEnabled = true;
    const L = config.chassis.wheelbase;
    let delta = 0;
    let fl = 0, fr = 0, rl = 0, rr = 0, samples = 0, ayMean = 0;
    run(car, 60, (t, v, input) => {
        speedControl(input, v, speed);
        if (t > 6) {
            const ay = v.u * v.r;
            delta += (ayWanted - ay) * 0.0004;
            delta = Math.max(0, Math.min(0.4, delta));
            if (t > 40) {
                const w = v.wheels;
                fr += w[0].weight; fl += w[1].weight; rl += w[2].weight; rr += w[3].weight; ayMean += ay; samples++;
            }
        }
        input.turnAngle = delta;
    });
    if (!samples) return null;
    const ay = ayMean / samples;
    const kinematic = L * ay / (speed * speed);
    const gradient = (delta - kinematic) / (ay / G);           // rad per g
    const dFront = Math.abs(fl - fr) / samples, dRear = Math.abs(rl - rr) / samples;
    return { delta, gradient: gradient * 180 / Math.PI, ay: ay / G, frontShare: dFront / (dFront + dRear) };
}

function measure(config) {
    const a = accelerate(config, false), aTC = accelerate(config, true);
    const b100 = brake(config, 100 * KMH), b60 = brake(config, 60 * MPH);
    const top = topSpeed(config);
    const pad = skidpad(config);
    const u60 = understeer(config, 60 * KMH, 0.3 * G), u120 = understeer(config, 120 * KMH, 0.3 * G);
    return {
        "0-100 km/h (s)": a.t100, "0-100 km/h TC (s)": aTC.t100, "0-60 mph (s)": a.t60,
        "100-0 km/h (m)": b100, "60-0 mph (m)": b60,
        "top speed (km/h)": top / KMH,
        "skidpad (g)": pad.g, "skidpad speed (km/h)": pad.speed / KMH,
        "understeer 60 (deg/g)": u60 && u60.gradient, "understeer 120 (deg/g)": u120 && u120.gradient,
        "front load transfer (%)": u60 && u60.frontShare * 100
    };
}

function fmt(value, digits) {
    if (value === null || value === undefined || !isFinite(value)) return "-";
    return value.toFixed(digits === undefined ? 1 : digits);
}

const args = process.argv.slice(2);
const json = args.includes("--json");
const only = args.find((a) => !a.startsWith("--"));
const cars = loadCars(only);
if (!cars.length) { console.error("No car found" + (only ? " with id " + only : "")); process.exit(1); }
const results = {};
for (const config of cars) {
    results[config.id] = measure(config);
}
if (json) { console.log(JSON.stringify(results, null, 2)); process.exit(0); }

const keys = Object.keys(results[cars[0].id]);
const width = Math.max(...keys.map((k) => k.length)) + 2;
const col = 14;
let line = "".padEnd(width);
for (const config of cars) line += config.id.padStart(col);
console.log(line);
for (const key of keys) {
    line = key.padEnd(width);
    for (const config of cars) {
        const value = results[config.id][key];
        const ref = REFERENCE[config.id] && REFERENCE[config.id][key];
        let text = fmt(value, key.includes("(g)") ? 2 : 1);
        if (ref !== undefined && value !== null) text += " (" + (value >= ref ? "+" : "") + Math.round((value / ref - 1) * 100) + "%)";
        line += text.padStart(col);
    }
    console.log(line);
}
for (const id of Object.keys(REFERENCE)) {
    if (!results[id]) continue;
    console.log("\nReference " + id + ": " + Object.entries(REFERENCE[id]).map(([k, v]) => k + " " + v).join(", ") + " (the figures in brackets are the differences)");
}
