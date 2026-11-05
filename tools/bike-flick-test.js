#!/usr/bin/env node
/*
 * bike-flick-test.js
 *
 * Description: A bike that is steered from the left to the right quickly (the keys of a rider who flicks it through a chicane) has to stay under its tyres. Runs the
 *              Supermoto 700 on the flat road of the bench (tools/physics-bench.js) at 45, 60 and 80 km/h, with the steering going from one lock to the other in 0.3 s
 *              and in 0.15 s, and checks that the slip angle of the bike stays small and that it does not go down. Before the rider's lean was limited to 90 degrees a
 *              second (Motorcycle.js, max_roll_rate_deg) the bike rolled over at 130 degrees a second and more, unloaded both wheels and slid sideways (88 degrees of slip
 *              angle at 60 km/h).
 *
 *                  node tools/bike-flick-test.js
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

const config = Object.assign({ id: "supermoto-700" }, JSON.parse(fs.readFileSync(path.join(ROOT, "cars", "supermoto-700", "car.json"), "utf8")));
const DT = 1 / 60;

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

function flick(speedKmh, ramp) {
    const car = makeCar(config), v = car.v, lock = 0.38;
    let maxBeta = 0, maxLean = 0, crash = null;
    for (let t = 0; t < 20 && !crash; t += DT) {
        const input = car.input, error = speedKmh * KMH - v.u;
        if (error > 0) { input.throttle = Math.min(1, error * 0.5); input.brakePedal = 0; } else { input.throttle = 0; input.brakePedal = Math.min(1, -error * 0.3); }
        const tt = t - 10;                                  // 10 s to settle at the speed, then four flicks, one every 2 s
        let cmd = 0;
        if (tt > 0) {
            const k = Math.floor(tt / 2), phase = Math.min(1, (tt - k * 2) / ramp), from = (k % 2 === 1 ? -1 : 1);
            cmd = k === 0 ? phase : from - 2 * from * phase;
        }
        input.turnAngle = cmd * lock;
        v.update(DT);
        if (tt > 0) {
            maxBeta = Math.max(maxBeta, Math.abs(Math.atan2(v.v, Math.max(1, Math.abs(v.u)))));
            maxLean = Math.max(maxLean, Math.abs(v.lean || 0));
        }
        if (v.controller.crashed) crash = v.controller.crashReason || "crashed";
    }
    return { beta: maxBeta * 180 / Math.PI, lean: maxLean * 180 / Math.PI, crash };
}

let failed = 0;
for (const speed of [45, 60, 80]) for (const ramp of [0.3, 0.15]) {
    const r = flick(speed, ramp), ok = r.beta < 15 && !r.crash;
    if (!ok) failed++;
    console.log((ok ? "ok   " : "FAIL ") + speed + " km/h, lock to lock in " + ramp + " s: slip angle " + r.beta.toFixed(1) + " degrees, lean " + r.lean.toFixed(0) + (r.crash ? ", crashed: " + r.crash : ""));
}
console.log(failed ? failed + " failed" : "all ok");
process.exit(failed ? 1 : 0);
