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
// --bumps=0.01: a road that is not smooth (a surface of two waves, 1 cm high at most, 0.9 m and 2.3 m long, across and along), for what a flat road does not shake: wobble
const BUMP = parseFloat((process.argv.find(a => a.startsWith("--bumps=")) || "--bumps=0").split("=")[1]);
if (BUMP > 0) {
    const h = (x, z) => BUMP * (0.6 * Math.sin(2 * Math.PI * x / 0.9 + 1.3) * Math.sin(2 * Math.PI * z / 1.7) + 0.4 * Math.sin(2 * Math.PI * (x + 0.7 * z) / 2.3));
    const dh = (x, z) => ({ x: (h(x + 0.01, z) - h(x - 0.01, z)) / 0.02, z: (h(x, z + 0.01) - h(x, z - 0.01)) / 0.02 });
    flatRoad.ray = function (ox, oy, oz, dx, dy, dz, maxT) {
        if (dy >= -1e-6) return null;
        let t = (oy - 0) / -dy;
        for (let k = 0; k < 4; k++) { const px = ox + dx * t, pz = oz + dz * t; t = (oy - h(px, pz)) / -dy; }
        if (t < 0 || t > maxT) return null;
        const px = ox + dx * t, pz = oz + dz * t, g = dh(px, pz), n = Math.hypot(g.x, 1, g.z);
        return { t: t, y: h(px, pz), nx: -g.x / n, ny: 1 / n, nz: -g.z / n, surface: "road", mesh: "", triangle: 0 };
    };
}

const MODEL = process.argv.includes("--v1") ? "v1" : "v2";
const CAR = ((process.argv.find(a => a.startsWith("--car=")) || "").split("=")[1]) || "supermoto-700";      // --car=sports-motorcycle-600cc
const config = Object.assign({ id: CAR }, JSON.parse(fs.readFileSync(path.join(ROOT, "cars", CAR, "car.json"), "utf8")));
config.motorcycle = Object.assign({}, config.motorcycle, { model: MODEL });      // (whatever car.json says: --v1 is the old model)
config.tyres = Object.assign({}, config.tyres); for (const a of process.argv) { const g = a.match(/^--grip=(.+)$/); if (g) config.tyres.grip = parseFloat(g[1]); }      // --grip=1.3: the grip of the tyres (car.json tyres.grip)
for (const a of process.argv) { const m = a.match(/^--set=(\w+)=(.+)$/); if (m) config.motorcycle[m[1]] = parseFloat(m[2]); }
const DT = 1 / 60, DEG = Math.PI / 180;
if (!process.argv.includes("--no-rider")) { config.chassis = Object.assign({}, config.chassis); config.chassis.mass += sandbox.OpenRacer.Motorcycle.riderMass(config); }      // (the game puts the rider on the bike: 80 kg more; the bench ran without him until now)

function makeCar(config) {
    const input = { throttle: 0, brakePedal: 0, clutch: 0, clutchPedalPresent: false, handbrake: false, turnAngle: 0, neutral: false, reverse: false,
        manualGearbox: false, current_gear: 0, parkingLock: false };
    const v = new sandbox.OpenRacer.Vehicle(sandbox.OpenRacer.vehicleParams(config, getSurface), input);
    v.ground = flatRoad;
    if (process.argv.includes("--trap")) { let _py = v.py; Object.defineProperty(v, "py", { get() { return _py; }, set(x) { if (Math.abs(x - _py) > 0.06) console.log("PY JUMP", _py.toFixed(2), "->", x.toFixed(2), new Error().stack.split("\n").slice(2, 6).join(" | ")); _py = x; } }); }      // --trap: who moves the body by more than 30 cm in a step
    if (process.argv.includes("--walls")) v.debugWalls = [];      // --walls: the first hits of the body spheres on the road are printed at the end
    // (the flat road of the bench is a "wall" for the spheres of the rig of the phantom wheels, which hang 0.25 m to the side of a bike: past 38 degrees of lean they touched it and pushed the bike into
    // the road. In the game the road is no wall and the spheres of the model come from the car: the bench has none of them)
    if (!process.argv.includes("--spheres-on")) v.collisionSpheres = [];
    if (process.argv.includes("--nosoft")) v.softBody = null;      // (without the soft body of the shell: to see whether a hit comes from it)
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


function run(speedKmh, cmdFn, T, settle, coast, brake) {
    const car = makeCar(config), v = car.v, lock = 0.38, log = [];
    let crash = null, maxBeta = 0;
    for (let t = 0; t < settle + T && !crash; t += DT) {
        const input = car.input, error = speedKmh * KMH - v.u;
        if (error > 0) { input.throttle = Math.min(1, error * 0.5); input.brakePedal = 0; } else { input.throttle = 0; input.brakePedal = Math.min(1, -error * 0.3); }
        const tt = t - settle;
        if (coast && tt > 0) { input.throttle = 0; input.brakePedal = brake || 0; }      // (the gas is shut from the command on)
        input.turnAngle = (tt > 0 ? cmdFn(tt) : 0) * lock;
        v.update(DT);
        if (tt > 0) { log.push({ vx: v.vx, vz: v.vz, w: v.wheels.map(w => ({ c: w.hasContact, fy: w.fyUsed, fx: w.fxUsed, fyr: w.fy, fys: w.fySlip, fz: w.gripLoad, wt: w.weight, s: w.s, st: w.slipTan, lost: false })), cg: v.cgHeight, t: tt, T: (v.controller.dbg && v.controller.dbg.T) || 0, ff: v.wheels[0].fy, fz0: v.wheels[0].gripLoad, fr: v.wheels[2].fy, fz2: v.wheels[2].gripLoad, mass: v.mass, ap: v.wheels[2].anglePeak, target: (v.controller.targetLean || 0) / DEG, lean: (v.lean || 0) / DEG, steer: (v.controller.steer || 0) / DEG, beta: Math.atan2(v.v, Math.max(1, Math.abs(v.u))) / DEG, yaw: v.r, u: v.u }); maxBeta = Math.max(maxBeta, Math.abs(log[log.length - 1].beta)); }
        if (v.controller.crashed) crash = v.controller.crashReason || "crashed";
    }
    return { log, crash, maxBeta };
}
let failed = 0;
const report = (name, ok, text) => { if (!ok) failed++; console.log((ok ? "ok   " : "FAIL ") + name + ": " + text); };

if (process.argv.some(a => a.startsWith("--trace"))) {      // --trace=speed_kmh: lean, bars and torque every 0.25 s of a straight run
    const sp = parseFloat((process.argv.find(a => a.startsWith("--trace=")) || "--trace=40").split("=")[1]);
    const car = makeCar(config), v = car.v, CMD = parseFloat((process.argv.find(a => a.startsWith("--cmd=")) || "--cmd=0").split("=")[1]);
    for (let t = 0, n = 0; t < 12; t += DT, n++) {
        car.input.turnAngle = t > 3 ? CMD * 0.38 : 0;
        const err = sp * KMH - v.u; car.input.throttle = err > 0 ? Math.min(1, err * 0.5) : 0; car.input.brakePedal = err < 0 ? Math.min(1, -err * 0.3) : 0;
        v.update(DT);
        if (n % 15 === 0) console.log(t.toFixed(2), "u", v.u.toFixed(1), "lean", ((v.lean || 0) / DEG).toFixed(2), "steer", ((v.controller.steer || 0) / DEG).toFixed(2), "dof", (v.controller.steerDof / DEG).toFixed(2), "T", (v.controller.steerTorque || 0).toFixed(1), "align", (v.controller.steerAlign || 0).toFixed(1), "target", (v.controller.targetLean / DEG).toFixed(2), "ask", ((v.controller.steerAsk || 0) / DEG).toFixed(2), "yaw", v.r.toFixed(3), "crash", v.controller.crashed);
    }
    process.exit(0);
}
if (process.argv.includes("--spheres")) { const v = makeCar(config).v; console.log("proxy3", (v.proxy3 || []).length, JSON.stringify((v.proxy3 || []).slice(0, 40).map(p => ({ r: p.r && +p.r.toFixed(2), rig: !!p.rig, x: p.x && +p.x.toFixed(2), y: p.y && +p.y.toFixed(2), z: p.z && +p.z.toFixed(2), keys: Object.keys(p).join(",") })))); process.exit(0); }
const SPEEDS = ((process.argv.find(a => a.startsWith("--speeds=")) || "").split("=")[1] || "").split(",").filter(Boolean).map(Number);      // --speeds=40,140: only these speeds
if (process.argv.some(a => a.startsWith("--flick="))) {      // --flick=80: the first two seconds-pairs of a flick run, every 0.1 s
    const sp = parseFloat(process.argv.find(a => a.startsWith("--flick=")).split("=")[1]), ramp = 0.3;
    const r = run(sp, tt => { const k = Math.floor(tt / 2), ph = Math.min(1, (tt - k * 2) / ramp), from = (k % 2 === 1 ? -1 : 1); return k === 0 ? ph : from - 2 * from * ph; }, 9, 10);
    r.log.filter((l, i) => i % 6 === 0 && l.t > 3.8).forEach(l => console.log(l.t.toFixed(1), "lean", l.lean.toFixed(1), "target", l.target.toFixed(1), "bars", l.steer.toFixed(1), "beta", l.beta.toFixed(1), "yaw", l.yaw.toFixed(2)));
    process.exit(0);
}
if (process.argv.some(a => a.startsWith("--bend="))) {      // --bend=40: the lean, the bars and the slip of a bend with the keys held from 0.5 to 5 s, every 0.1 s
    const sp = parseFloat(process.argv.find(a => a.startsWith("--bend=")).split("=")[1]), cmd = parseFloat((process.argv.find(a => a.startsWith("--cmd=")) || "--cmd=1").split("=")[1]);
    const r = run(sp, t => (t < 0.5 ? 0 : t < 5 ? cmd : 0), 8, 10, process.argv.includes("--coast"));
    r.log.filter((l, i) => i % 6 === 0 && l.t > parseFloat((process.argv.find(a => a.startsWith("--from=")) || "--from=4.4").split("=")[1])).forEach(l => console.log(l.t.toFixed(1), "kmh", (l.u * 3.6).toFixed(0), "lean", l.lean.toFixed(1), "target", l.target.toFixed(1), "bars", l.steer.toFixed(1), "beta", l.beta.toFixed(1), "yaw", l.yaw.toFixed(2), "balanceT", l.T.toFixed(0), "Fy/Fz front", (l.ff / l.fz0).toFixed(2), "rear", (l.fr / l.fz2).toFixed(2), "sumFy/mg", ((l.ff + l.fr) / (l.mass * 9.81)).toFixed(2), "anglePeak", l.ap.toFixed(3)));
    { const a = r.log.find(q => q.t > 4.2), b = r.log.find(q => q.t > 4.8); const h = q => Math.atan2(q.vx, q.vz); let d = h(b) - h(a); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; const wp = d / (b.t - a.t), uu = Math.hypot(b.vx, b.vz); console.log("path turn rate", wp.toFixed(3), "yaw rate", b.yaw.toFixed(3), "a_lat/g from the path", (uu * Math.abs(wp) / 9.81).toFixed(2), "tan(lean)", Math.abs(Math.tan(b.lean * Math.PI / 180)).toFixed(2)); }
    if (process.argv.includes("--wheels")) { const l = r.log.find(q => q.t > 4.8); console.log(JSON.stringify(l.w.map(x => ({ c: x.c, fy: x.fy && +x.fy.toFixed(0), fyr: x.fyr && +x.fyr.toFixed(0), fys: x.fys && +x.fys.toFixed(0), fx: x.fx && +x.fx.toFixed(0), fz: x.fz && +x.fz.toFixed(0), wt: x.wt && +x.wt.toFixed(0), s: x.s && +x.s.toFixed(2), st: x.st && +x.st.toFixed(3) }))), "cg", l.cg, "mass", l.mass); }
    console.log("crash", r.crash);
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
    if ((ONLY && ONLY !== "command") || (SPEEDS.length && !SPEEDS.includes(speed))) continue;
    const s = run(speed, t => (t < 0.5 ? 0 : cmd), 8, 10), L = s.log;
    // the first move of the bars while the lean is under a tenth of what came: against the lean?
    if (!L.length) { report(speed + " km/h, command " + cmd + " lock", false, "crashed before the command: " + s.crash); continue; }
    const final = L[L.length - 1], dir = Math.sign(final.lean) || 1;
    let first = 0; for (const l of L) { if (l.t < 0.5) continue; if (Math.abs(l.lean) < 0.1 * Math.abs(final.lean)) { if (Math.abs(l.steer) > Math.abs(first)) first = l.steer; } else break; }
    const t90 = (L.find(l => l.t > 0.5 && Math.abs(l.lean) >= 0.9 * Math.abs(final.lean)) || { t: NaN }).t - 0.5;
    const gTan = Math.atan(final.u * final.yaw / 9.81) / DEG;       // the lean that the yaw rate and the speed ask: tan(lean) = u r / g
    // how far the lean is from the one asked at the end (deg), and how much the bars hunt in the last 3 s (the standard deviation, deg)
    const tail = L.filter(l => l.t > L[L.length - 1].t - 3), mean = tail.reduce((a, l) => a + l.steer, 0) / tail.length, hunt = Math.sqrt(tail.reduce((a, l) => a + (l.steer - mean) * (l.steer - mean), 0) / tail.length), miss = Math.abs(final.lean - final.target);
    if (process.argv.includes("--score")) console.log("SCORE " + speed + " " + cmd + " " + (s.crash ? "crash" : miss.toFixed(2) + " " + hunt.toFixed(2)));
    report(speed + " km/h, command " + cmd + " lock", !s.crash && Math.abs(final.lean) > 5 && miss < 6 && hunt < 1.5, "lean " + final.lean.toFixed(1) + " deg (asked " + final.target.toFixed(1) + ", the bend needs " + gTan.toFixed(1) + ", the bars hunt " + hunt.toFixed(2) + "), 90 % in " + t90.toFixed(2) + " s, first bars " + first.toFixed(2) + " deg, bars at the end " + final.steer.toFixed(2) + " deg, slip angle " + s.maxBeta.toFixed(1) + (s.crash ? ", crashed: " + s.crash : ""));
}
// the rider on the keys, at every speed, on the gas and with the gas shut: does it stay up, how tight is the bend (the radius from the speed and the yaw rate), do the bars hunt
for (const coast of [false, true]) for (const speed of [8, 15, 25, 40, 60, 100, 140]) for (const cmd of [0.3, 1]) {
    if ((ONLY && ONLY !== "rider") || (SPEEDS.length && !SPEEDS.includes(speed)) || (!ONLY && !process.argv.includes("--rider"))) continue;
    const s = run(speed, t => (t < 0.5 ? 0 : t < 5 ? cmd : 0), 8, 10, coast), L = s.log;
    const bend = L.filter(l => l.t > 3 && l.t < 5);
    if (!bend.length) { report((coast ? "coast " : "gas   ") + speed + " km/h, " + cmd + " lock", false, "down before the end of the bend: " + s.crash); continue; }
    const m = k => bend.reduce((a, l) => a + l[k], 0) / bend.length, u = m("u"), yaw = (() => { const x = bend[0], y = bend[bend.length - 1]; let d = Math.atan2(y.vx, y.vz) - Math.atan2(x.vx, x.vz); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return Math.abs(d / (y.t - x.t)); })(), lean = Math.abs(m("lean")), mean = m("steer"), hunt = Math.sqrt(bend.reduce((a, l) => a + (l.steer - mean) * (l.steer - mean), 0) / bend.length);
    report((coast ? "coast " : "gas   ") + speed + " km/h, " + cmd + " lock", !s.crash && hunt < 2.5 && s.maxBeta < 30, "speed " + (u * 3.6).toFixed(0) + ", lean " + lean.toFixed(1) + " deg, radius " + (yaw > 0.01 ? (u / yaw).toFixed(0) : "inf") + " m, bars " + Math.abs(mean).toFixed(1) + " deg, hunt " + hunt.toFixed(2) + ", slip " + s.maxBeta.toFixed(1) + (s.crash ? ", crashed: " + s.crash : ""));
}
// straight with the gas shut, and on the brake: the bike has to stay straight (the gas shut: lean under 3 degrees; on the brake from 140 km/h a weave of 1.7 Hz is excited by the brake itself: under 10 degrees, and it dies out)
for (const brake of [0, 0.5, 1]) for (const speed of [40, 100, 140]) {
    if ((ONLY && ONLY !== "straightcoast") || (SPEEDS.length && !SPEEDS.includes(speed)) || (!ONLY && !process.argv.includes("--rider"))) continue;
    const s = run(speed, () => 0, 6, 10, true, brake), L = s.log;
    if (process.argv.includes("--sdump") && brake === 1) L.filter((l, i) => i % 6 === 0).forEach(l => console.log(l.t.toFixed(1), "kmh", (l.u * 3.6).toFixed(0), "lean", l.lean.toFixed(1), "bars", l.steer.toFixed(2), "pitch/slip", (l.beta || 0).toFixed(1)));
    const maxLean = L.length ? Math.max(...L.map(l => Math.abs(l.lean))) : 999, hunt = L.length ? Math.sqrt(L.reduce((a, l) => a + l.steer * l.steer, 0) / L.length) : 999;
    report("coast straight " + speed + " km/h, brake " + brake, !s.crash && maxLean < (brake ? 10 : 3) && hunt < 1.5, "max lean " + maxLean.toFixed(1) + " deg, bars rms " + hunt.toFixed(2) + " deg, slip " + s.maxBeta.toFixed(1) + (s.crash ? ", crashed: " + s.crash : ""));
}
// a start from a standstill with the gas open, and steering at once (the front comes up: the lean steers it)
for (const cmd of [0.3, 1]) for (const at of [0.5, 2]) {
    if ((ONLY && ONLY !== "launch") || (!ONLY && !process.argv.includes("--rider"))) continue;
    const car = makeCar(config), v = car.v; let crash = null, maxLean = 0, maxUp = 0;
    for (let t = 0; t < 8 && !crash; t += DT) {
        car.input.throttle = 1; car.input.brakePedal = 0; car.input.turnAngle = t > at ? cmd * 0.38 : 0;
        v.update(DT); maxLean = Math.max(maxLean, Math.abs((v.lean || 0) / DEG)); maxUp = Math.max(maxUp, Math.abs(v.pitch || 0) / DEG);
        if (v.controller.crashed) crash = v.controller.crashReason || "crashed";
    }
    report("launch, steer " + cmd + " lock after " + at + " s", !crash, "end speed " + (v.u * 3.6).toFixed(0) + " km/h, max lean " + maxLean.toFixed(0) + " deg" + (crash ? ", crashed: " + crash : ""));
}
// what the replay of a rider showed (a bend with the key held at 50 km/h, the gas tapped or shut, the brake used in the bend, the key let go): the lean may not swing, and the bike stays up
const MODE = ((process.argv.find(a => a.startsWith("--mode=")) || "").split("=")[1]) || "";      // --mode=tap: one of the replay scenarios (tap, off, brake, brake-release, tap-flick), with --dump every 0.1 s
for (const mode of ["tap", "off", "brake", "brake-release", "tap-flick", "bb"]) for (const speed of [30, 35, 40, 50, 70]) {
    if (MODE && MODE !== mode) continue;
    if ((ONLY && ONLY !== "replay") || (SPEEDS.length && !SPEEDS.includes(speed)) || (!ONLY && !process.argv.includes("--rider"))) continue;
    const car = makeCar(config), v = car.v, lock = 0.38; let crash = null, maxBeta = 0; const L = [];
    for (let t = 0; t < 18 && !crash; t += DT) {
        const input = car.input, tt = t - 10;
        const error = speed * KMH - v.u;
        if (tt < 0) { input.throttle = error > 0 ? Math.min(1, error * 0.5) : 0; input.brakePedal = error < 0 ? Math.min(1, -error * 0.3) : 0; }
        else {
            const key = mode === "tap-flick" ? (tt < 0.5 ? 0 : (Math.floor((tt - 0.5) / 1.2) % 2 === 0 ? 1 : -1)) : (tt < 0.5 ? 0 : tt < 6 ? 1 : 0);
            input.turnAngle = key * lock;
            if (mode === "tap" || mode === "tap-flick") { input.throttle = (Math.floor(tt * 3) % 2 === 0) ? 1 : 0; input.brakePedal = 0; }
            else if (mode === "off") { input.throttle = 0; input.brakePedal = 0; }
            else { input.throttle = 0; input.brakePedal = tt > 2 && tt < 3.5 ? 0.9 : 0; }
            if (mode === "bb") { input.turnAngle = (tt > 0.5 && tt < 1.6 ? 1 : 0) * lock; input.throttle = 0; input.brakePedal = tt > 1.1 && tt < 1.6 ? 1 : 0; }      // (the key for 1.1 s, the brake in the second half of it, both let go together: what the browser test did)
            if (mode === "brake-release") { input.turnAngle = (tt < 0.5 ? 0 : tt < 3 ? 1 : 0) * lock; }
        }
        v.update(DT);
        const dumpFrom = parseFloat((process.argv.find(a => a.startsWith("--dumpfrom=")) || "--dumpfrom=-1").split("=")[1]);
        if (process.argv.includes("--dump") && tt > 0 && (dumpFrom >= 0 ? tt >= dumpFrom : Math.round(tt / DT) % 6 === 0)) console.log(tt.toFixed(1), "kmh", (v.u * 3.6).toFixed(0), "lean", ((v.lean || 0) / DEG).toFixed(1), "target", ((v.controller.targetLean || 0) / DEG).toFixed(1), "bars", ((v.controller.steer || 0) / DEG).toFixed(1), "ask", ((v.controller.steerAsk || 0) / DEG).toFixed(1), "rate", ((v.controller.dbg && v.controller.dbg.rate || 0)).toFixed(2), "beta", (Math.atan2(v.v, Math.max(1, Math.abs(v.u))) / DEG).toFixed(1), "thr", input.throttle.toFixed(1), "brk", input.brakePedal.toFixed(1), "slipR", (v.wheels[2].s || 0).toFixed(2), "slipF", (v.wheels[0].s || 0).toFixed(2), "rearFz", (v.wheels[2].gripLoad || 0).toFixed(0), "frontFz", (v.wheels[0].gripLoad || 0).toFixed(0), "vy", v.vy.toFixed(2), "py", v.py.toFixed(2), "pitch", ((v.pitch || 0) / DEG).toFixed(1), "penF", (v.wheels[0].tyreDeflection || 0).toFixed(3), "penR", (v.wheels[2].tyreDeflection || 0).toFixed(3), "pos", v.px.toFixed(1), v.pz.toFixed(1), "RAY", JSON.stringify(v.wheels[2].dbgRay && Object.fromEntries(Object.entries(v.wheels[2].dbgRay).map(([k, x]) => [k, +x.toFixed(3)]))), "crashed", v.controller.crashed, "impact", (v.impactTime || 0).toFixed(2), (v.lastImpact || 0).toFixed(1), "airborne", !!v.airborne, "susF", (v.wheels[0].susLength || 0).toFixed(3), "susR", (v.wheels[2].susLength || 0).toFixed(3));
        if (tt > 0.5) { L.push({ lean: (v.lean || 0) / DEG, u: v.u }); if (Math.abs(v.u) > 4) maxBeta = Math.max(maxBeta, Math.abs(Math.atan2(v.v, Math.abs(v.u)) / DEG)); }
        if (v.controller.crashed) crash = v.controller.crashReason || "crashed";
    }
    if (process.argv.includes("--walls") && v.debugWalls.length) { console.log("WALLS", v.debugWalls.length); v.debugWalls.slice(0, 4).forEach(w => console.log(JSON.stringify(w), JSON.stringify(v.proxy3 && v.proxy3[w.sphere] && Object.fromEntries(Object.entries(v.proxy3[w.sphere]).filter(([k, x]) => typeof x !== "object"))))); }
    // the swing of the lean in the bend: the biggest change in the lean over a second, while the key is held (1 to 3 s into the bend)
    let swing = 0; const N = Math.round(1 / DT);
    for (let i = 0; i + N < L.length && i < Math.round(5 / DT); i++) swing = Math.max(swing, Math.abs(L[i + N].lean - L[i].lean));
    report(mode + " " + speed + " km/h", !crash && maxBeta < 30, "max lean " + (L.length ? Math.max(...L.map(l => Math.abs(l.lean))) : 0).toFixed(0) + " deg, slip " + maxBeta.toFixed(0) + ", end speed " + (v.u * 3.6).toFixed(0) + (crash ? ", crashed: " + crash : ""));
}
// a wobble at speed (replays of a rider at 130 to 145 km/h): a tap on the key (a correction), the gas shut, then the brake, with another correction on the brake. The bars may not go on swinging
// after the tap, and the bike stays up on the brake (the lean of a bike that goes straight stays under 6 degrees)
const WD = process.argv.includes("--wdump"), SHAKE = parseFloat((process.argv.find(a => a.startsWith("--shake=")) || "--shake=0").split("=")[1]);
for (const brake of [0, 1]) for (const speed of [100, 140, 180]) {
    if ((ONLY && ONLY !== "wobble") || (SPEEDS.length && !SPEEDS.includes(speed)) || (!ONLY && !process.argv.includes("--rider"))) continue;
    const car = makeCar(config), v = car.v, lock = 0.38; let crash = null, maxLean = 0, maxBars = 0, ring = 0; const L = [];
    for (let t = 0; t < 16 && !crash; t += DT) {
        const input = car.input, tt = t - 10, err = speed * KMH - v.u;
        if (tt < 0) { input.throttle = err > 0 ? Math.min(1, err * 0.5) : 0; input.brakePedal = err < 0 ? Math.min(1, -err * 0.3) : 0; input.turnAngle = 0; }
        else {
            input.throttle = 0; input.brakePedal = brake && tt > 2 && tt < 4 ? 1 : 0;
            const tap = (tt > 0.5 && tt < 0.6 ? 0.12 : 0) + (brake && tt > 2.5 && tt < 2.6 ? -0.12 : 0)      // (a tenth of a second on the key: 0.12 of the lock)
                + (SHAKE && tt < 2.6 ? SHAKE * Math.sin(2 * Math.PI * 6 * tt) : 0);      // --shake=0.04: the keys are shaken at 6 Hz (a road that is not smooth), the lock share of it
            input.turnAngle = tap * lock;
        }
        v.update(DT);
        if (tt > 0) { const lean = (v.lean || 0) / DEG, bars = (v.controller.steer || 0) / DEG; L.push({ t: tt, lean, bars, u: v.u }); maxLean = Math.max(maxLean, Math.abs(lean)); if (tt > 1.2 && tt < 2) ring = Math.max(ring, Math.abs(bars)); maxBars = Math.max(maxBars, Math.abs(bars)); if (WD && Math.round(tt / DT) % 3 === 0) console.log(tt.toFixed(2), "kmh", (v.u * 3.6).toFixed(0), "lean", lean.toFixed(1), "bars", bars.toFixed(2), "brk", input.brakePedal); }
        if (v.controller.crashed) crash = v.controller.crashReason || "crashed";
    }
    report("wobble " + CAR.split("-")[0] + " " + speed + " km/h" + (brake ? ", brake" : ", coast"), !crash && maxLean < 8 && ring < 1, "bars after the tap (1.2 to 2 s) " + ring.toFixed(2) + " deg, max bars " + maxBars.toFixed(1) + ", max lean " + maxLean.toFixed(1) + (crash ? ", crashed: " + crash : ""));
}
// what the browser test did with the real keyboard (Car.js: the key ramps the command at lock / 0.9 s times key_steer_rate, the command decays by 0.75 per 1/60 s): three taps of 90 ms
// (right, left, right, 250 ms apart) at speed, then the brake for 2.2 s, with the gas shut
for (const speed of [60, 100, 140]) for (const nTaps of [3, 6]) {
    if ((ONLY && ONLY !== "keys") || (SPEEDS.length && !SPEEDS.includes(speed)) || (!ONLY && !process.argv.includes("--rider"))) continue;
    const car = makeCar(config), v = car.v, lock = 0.38, rate = lock / 0.9 * (v.controller.keyRate || 2); let angle = 0, crash = null, maxLean = 0, maxBars = 0, maxBeta = 0, leanTaps = 0, leanBrake = 0;
    for (let t = 0; t < 16 && !crash; t += DT) {
        const input = car.input, tt = t - 10, err = speed * KMH - v.u;
        let dir = 0;
        if (tt < 0) { input.throttle = err > 0 ? Math.min(1, err * 0.5) : 0; input.brakePedal = err < 0 ? Math.min(1, -err * 0.3) : 0; }
        else {
            input.throttle = 0; input.brakePedal = tt > 0.5 + nTaps * 0.25 && tt < 0.5 + nTaps * 0.25 + 2.2 ? 1 : 0;
            const k = Math.floor((tt - 0.5) / 0.25);
            if (tt > 0.5 && k < nTaps && (tt - 0.5) - k * 0.25 < 0.09) dir = k % 2 === 0 ? 1 : -1;
        }
        if (dir === 0) angle *= Math.pow(0.75, DT * 60); else if (dir * angle < 0) angle += dir * rate * 3 * DT; else angle = Math.max(-lock, Math.min(lock, angle + dir * rate * DT));
        input.turnAngle = angle;
        v.update(DT);
        if (tt > 0) { const lean = (v.lean || 0) / DEG; maxLean = Math.max(maxLean, Math.abs(lean)); if (tt < 0.5 + nTaps * 0.25 + 0.3) leanTaps = Math.max(leanTaps, Math.abs(lean)); else leanBrake = Math.max(leanBrake, Math.abs(lean)); maxBars = Math.max(maxBars, Math.abs((v.controller.steer || 0) / DEG)); if (Math.abs(v.u) > 4) maxBeta = Math.max(maxBeta, Math.abs(Math.atan2(v.v, Math.abs(v.u)) / DEG)); }
        if (process.argv.includes("--kdump") && tt > 0 && Math.round(tt / DT) % 6 === 0) console.log(tt.toFixed(1), "kmh", (v.u * 3.6).toFixed(0), "lean", ((v.lean || 0) / DEG).toFixed(1), "tgt", ((v.controller.targetLean || 0) / DEG).toFixed(1), "bars", ((v.controller.steer || 0) / DEG).toFixed(2), "ask", ((v.controller.steerAsk || 0) / DEG).toFixed(2), "cmd", (angle / lock).toFixed(2), "brk", input.brakePedal, "yaw", v.r.toFixed(3), "rate", ((v.wx || 0)).toFixed(2));
        if (v.controller.crashed) crash = v.controller.crashReason || "crashed";
    }
    report("keys " + CAR.split("-")[0] + " " + speed + " km/h, " + nTaps + " taps then the brake", !crash && maxBeta < 30 && leanBrake < Math.max(12, leanTaps + 8), "lean from the taps " + leanTaps.toFixed(0) + ", on the brake " + leanBrake.toFixed(0) + " deg, max bars " + maxBars.toFixed(1) + ", slip " + maxBeta.toFixed(0) + (crash ? ", crashed: " + crash : ""));
}
for (const speed of [45, 60, 80]) for (const ramp of [0.3, 0.15]) {
    if ((ONLY && ONLY !== "flick") || (SPEEDS.length && !SPEEDS.includes(speed))) continue;
    const s = run(speed, tt => { const k = Math.floor(tt / 2), ph = Math.min(1, (tt - k * 2) / ramp), from = (k % 2 === 1 ? -1 : 1); return k === 0 ? ph : from - 2 * from * ph; }, 8, 10);
    report(speed + " km/h flick in " + ramp + " s", !s.crash && s.maxBeta < 15, "slip angle " + s.maxBeta.toFixed(1) + ", lean " + Math.max(...s.log.map(l => Math.abs(l.lean))).toFixed(0) + (s.crash ? ", crashed: " + s.crash : ""));
}
console.log(failed ? failed + " failed" : "all ok");
process.exit(failed ? 1 : 0);
