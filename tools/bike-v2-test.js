#!/usr/bin/env node
/*
 * bike-v2-test.js
 *
 * Description: The separate motorcycle model (motorcycle.model "v2", see MOTORCYCLE.md) against the old one (--v1), on the flat road of the bench: a straight line, a step of
 *              the lean command (does the lean arrive, do the bars go the wrong way first: countersteering is a result of the tyres, not coded) and the flicks of
 *              bike-flick-test.js. --set=name=value changes a "motorcycle" setting (rider_kp, trail, camber_slip, ...).
 *
 *                  node tools/bike-v2-test.js [--v1] [--set=rider_kp=80]
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ROOT = path.join(__dirname, "..", "web");
const G = 9.81, KMH = 1 / 3.6;

// ---- the physics in a sandbox: the scripts are plain scripts that share globals, so they get a context of their own
const sandbox = {
    OpenRacer: {},
    THREE: { Vector3: class { constructor(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } } },
    console: console, Math: Math
};
vm.createContext(sandbox);
for (const file of ["Engine.js", "Wheel.js", "TyreShell.js", "Ground.js", "Vehicle.js", "Motorcycle.js", "Opponent.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, "js", file), "utf8"), sandbox, { filename: file });
}
// the grip of the surfaces (Surfaces.js, where the table went from Helpers.js: only its table is taken)
const helpers = fs.readFileSync(path.join(ROOT, "js", "Surfaces.js"), "utf8");
const table = helpers.match(/var uCoeff = (\{[\s\S]*?\});/);
const uCoeff = vm.runInContext("(" + table[1] + ")", sandbox);
const getSurface = (name) => uCoeff[name] || uCoeff.track01;

// a flat road at y = 0, with the triangles the tyre bodies need (OpenRacer.FlatGround, Ground.js)
const flatRoad = new sandbox.OpenRacer.FlatGround(0, "road");

const MODEL = process.argv.includes("--v1") ? "v1" : "v2";
const config = Object.assign({ id: "supermoto-700" }, JSON.parse(fs.readFileSync(path.join(ROOT, "cars", "supermoto-700", "car.json"), "utf8")));
config.motorcycle = Object.assign({}, config.motorcycle, MODEL === "v2" ? { model: "v2" } : {});
for (const a of process.argv) { const m = a.match(/^--set=(\w+)=(.+)$/); if (m) config.motorcycle[m[1]] = parseFloat(m[2]); }
const DT = 1 / 60, DEG = Math.PI / 180;

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
        pressure_front: tyres.pressure_front || 2.2, pressure_rear: tyres.pressure_rear || 2.2,
        toe_front: config.chassis.toe_front || 0, toe_rear: config.chassis.toe_rear || 0,
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


function run(speedKmh, cmdFn, T, settle) {
    const car = makeCar(config), v = car.v, lock = 0.38, log = [];
    let crash = null, maxBeta = 0;
    for (let t = 0; t < settle + T && !crash; t += DT) {
        const input = car.input, error = speedKmh * KMH - v.u;
        if (error > 0) { input.throttle = Math.min(1, error * 0.5); input.brakePedal = 0; } else { input.throttle = 0; input.brakePedal = Math.min(1, -error * 0.3); }
        const tt = t - settle;
        input.turnAngle = (tt > 0 ? cmdFn(tt) : 0) * lock;
        v.update(DT);
        if (tt > 0) { log.push({ t: tt, lean: (v.lean || 0) / DEG, steer: (v.controller.steer || 0) / DEG, beta: Math.atan2(v.v, Math.max(1, Math.abs(v.u))) / DEG, yaw: v.r, u: v.u }); maxBeta = Math.max(maxBeta, Math.abs(log[log.length - 1].beta)); }
        if (v.controller.crashed) crash = v.controller.crashReason || "crashed";
    }
    return { log, crash, maxBeta };
}
let failed = 0;
const report = (name, ok, text) => { if (!ok) failed++; console.log((ok ? "ok   " : "FAIL ") + name + ": " + text); };

if (process.argv.some(a => a.startsWith("--trace"))) {      // --trace=speed_kmh: lean, bars and torque every 0.25 s of a straight run
    const sp = parseFloat((process.argv.find(a => a.startsWith("--trace=")) || "--trace=40").split("=")[1]);
    const car = makeCar(config), v = car.v;
    for (let t = 0, n = 0; t < 8; t += DT, n++) {
        const err = sp * KMH - v.u; car.input.throttle = err > 0 ? Math.min(1, err * 0.5) : 0; car.input.brakePedal = err < 0 ? Math.min(1, -err * 0.3) : 0;
        v.update(DT);
        if (n % 15 === 0) console.log(t.toFixed(2), "u", v.u.toFixed(1), "lean", ((v.lean || 0) / DEG).toFixed(2), "steer", ((v.controller.steer || 0) / DEG).toFixed(2), "dof", (v.controller.steerDof / DEG).toFixed(2), "T", (v.controller.steerTorque || 0).toFixed(1), "align", (v.controller.steerAlign || 0).toFixed(1), "target", (v.controller.targetLean / DEG).toFixed(2), "crash", v.controller.crashed);
    }
    process.exit(0);
}
const ONLY = ((process.argv.find(a => a.startsWith("--only=")) || "").split("=")[1]) || "";      // --only=flick, --only=straight, --only=command: one kind of test
console.log("model " + MODEL);
for (const speed of [40, 80, 140]) {
    if (ONLY && ONLY !== "straight") continue;
    const s = run(speed, () => 0, 6, 10), last = s.log[s.log.length - 1], maxLean = s.log.length ? Math.max(...s.log.map(l => Math.abs(l.lean))) : 999;
    report(speed + " km/h straight", !s.crash && maxLean < 3, "max lean " + maxLean.toFixed(1) + " deg" + (s.crash ? ", crashed: " + s.crash : ""));
}
for (const speed of [40, 80, 140]) for (const cmd of [0.4, 0.8]) {
    if (ONLY && ONLY !== "command") continue;
    const s = run(speed, t => (t < 0.5 ? 0 : cmd), 8, 10), L = s.log;
    // the first move of the bars while the lean is under a tenth of what came: against the lean?
    if (!L.length) { report(speed + " km/h, command " + cmd + " lock", false, "crashed before the command: " + s.crash); continue; }
    const final = L[L.length - 1], dir = Math.sign(final.lean) || 1;
    let first = 0; for (const l of L) { if (l.t < 0.5) continue; if (Math.abs(l.lean) < 0.1 * Math.abs(final.lean)) { if (Math.abs(l.steer) > Math.abs(first)) first = l.steer; } else break; }
    const t90 = (L.find(l => l.t > 0.5 && Math.abs(l.lean) >= 0.9 * Math.abs(final.lean)) || { t: NaN }).t - 0.5;
    const gTan = Math.atan(final.u * final.yaw / 9.81) / DEG;       // the lean that the yaw rate and the speed ask: tan(lean) = u r / g
    report(speed + " km/h, command " + cmd + " lock", !s.crash && Math.abs(final.lean) > 5, "lean " + final.lean.toFixed(1) + " deg (the bend needs " + gTan.toFixed(1) + "), 90 % in " + t90.toFixed(2) + " s, first bars " + first.toFixed(2) + " deg, bars at the end " + final.steer.toFixed(2) + " deg, slip angle " + s.maxBeta.toFixed(1) + (s.crash ? ", crashed: " + s.crash : ""));
}
for (const speed of [45, 60, 80]) for (const ramp of [0.3, 0.15]) {
    if (ONLY && ONLY !== "flick") continue;
    const s = run(speed, tt => { const k = Math.floor(tt / 2), ph = Math.min(1, (tt - k * 2) / ramp), from = (k % 2 === 1 ? -1 : 1); return k === 0 ? ph : from - 2 * from * ph; }, 8, 10);
    report(speed + " km/h flick in " + ramp + " s", !s.crash && s.maxBeta < 15, "slip angle " + s.maxBeta.toFixed(1) + ", lean " + Math.max(...s.log.map(l => Math.abs(l.lean))).toFixed(0) + (s.crash ? ", crashed: " + s.crash : ""));
}
console.log(failed ? failed + " failed" : "all ok");
process.exit(failed ? 1 : 0);
