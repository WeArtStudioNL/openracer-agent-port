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
    if (process.argv.includes("--push")) v.controller.options = Object.assign({}, v.controller.options, { bikePush: true });      // --push: the flat-track style
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
    if (process.argv.includes("--gripdbg")) console.log("gripScale", v.wheels.map(w => w.gripScale), "mu", v.wheels.map(w => w.frictionFor(1000, getSurface("road")).mu.toFixed(2)), "surf", JSON.stringify(getSurface("road")));
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
// a slide in a bend (flat track): a key held at a middle speed, the gas wide open in second gear after two seconds (the rear slides out): the slip angle of the body (the worst, and at the end),
// the lean, whether the bike stays up. With --push the bars countersteer the slide by themselves (--set=push_slide=0 for none, a negative number for the other sign)
for (const speed of (SPEEDS.length ? SPEEDS : [40, 55, 70])) for (const cmd of [0.6, 1]) {
    if ((ONLY && ONLY !== "slide") || (!ONLY && !process.argv.includes("--rider"))) continue;
    const car = makeCar(config), v = car.v, lock = 0.38; let crash = null, maxBeta = 0, endBeta = 0, maxLean = 0, maxBars = 0;
    for (let t = 0; t < 16 && !crash; t += DT) {
        const input = car.input, tt = t - 10, err = speed * KMH - v.u;
        if (tt < 0) { input.throttle = err > 0 ? Math.min(1, err * 0.5) : 0; input.brakePedal = err < 0 ? Math.min(1, -err * 0.3) : 0; input.turnAngle = 0; input.manualGearbox = false; }
        else { v.controller.options = Object.assign({}, v.controller.options, { wheelieControl: process.argv.includes("--wc") }); input.manualGearbox = true; input.current_gear = parseInt((process.argv.find(a => a.startsWith("--sgear=")) || "--sgear=1").split("=")[1]); input.throttle = tt > 2 && tt < 4.5 ? 1 : 0; input.brakePedal = 0; input.turnAngle = (tt > 0.3 ? cmd : 0) * lock; }
        v.update(DT);
        if (tt > 2) { const beta = Math.atan2(v.v, Math.max(1, Math.abs(v.u))) / DEG; if (Math.abs(v.u) > 4) { maxBeta = Math.max(maxBeta, Math.abs(beta)); endBeta = beta; } maxLean = Math.max(maxLean, Math.abs((v.lean || 0) / DEG)); maxBars = Math.max(maxBars, Math.abs((v.controller.steer || 0) / DEG)); }
        if (process.argv.includes("--sldump") && tt > 0 && Math.round(tt / DT) % 3 === 0 && tt < 5) console.log(tt.toFixed(1), "kmh", (v.u * 3.6).toFixed(0), "lean", ((v.lean || 0) / DEG).toFixed(1), "beta", (Math.atan2(v.v, Math.max(1, Math.abs(v.u))) / DEG).toFixed(1), "bars", ((v.controller.steer || 0) / DEG).toFixed(1), "slideAsk", (((v.controller.slideAsk) || 0) / DEG).toFixed(1), "drift", (v.controller.drift || 0).toFixed(2), "rearLat", v.wheels[2].lateralGrip.toFixed(2), "thr", v.input.throttle.toFixed(1));
        if (v.controller.crashed) crash = v.controller.crashReason || "crashed";
    }
    report("slide " + CAR.split("-")[0] + " " + speed + " km/h, key " + cmd + ", the gas wide open in 2nd" + (process.argv.includes("--push") ? " (flat track)" : ""), !crash && maxBeta < 35, "worst slip angle " + maxBeta.toFixed(0) + " deg, at the end " + endBeta.toFixed(0) + ", max lean " + maxLean.toFixed(0) + ", most bars " + maxBars.toFixed(1) + (crash ? ", crashed: " + crash : ""));
}
// the skidpad (main.js startSkidpad): the bike goes round a circle of 50 m about the origin, a quarter of a metre per second faster every second, the angle from Motorcycle.circleSteer. The line:
// how far from the circle it is while it is held (the worst, and the mean), the lateral g and the speed that it reached, and why the test ended (the rider lets go of the line at 6 m, or a slip angle of 14 degrees)
const SK = {}; for (const a of process.argv) { const m = a.match(/^--sk=(\w+)=(.+)$/); if (m) SK[m[1]] = parseFloat(m[2]); }      // --sk=w0=1.5 --sk=ki=0.8
for (const R of [50]) {
    if ((ONLY && ONLY !== "skidpad") || (!ONLY && !process.argv.includes("--rider"))) continue;
    const car = makeCar(config), v = car.v, st = {}; let target = 3, why = "time", best = 0, bestU = 0, worst = 0, sum = 0, n = 0, crash = null, worstAtBest = 0, leanAtBest = 0, epsAtBest = 0;
    v.reset(R, 0, Math.PI / 2);
    for (let t = 0; t < 150 && !crash; t += DT) {
        const input = car.input, speed = Math.max(0, v.u);
        input.leanFromBend = true; input.manualGearbox = false;
        const wanted = sandbox.OpenRacer.Motorcycle.circleSteer(st, v, R, speed, DT, SK);
        input.turnAngle += (Math.max(-0.38, Math.min(0.38, wanted)) - input.turnAngle) * (1 - Math.pow(0.5, DT * 60));
        target += 0.25 * DT; const err = target - speed;
        input.throttle = Math.max(0, Math.min(0.7, 0.12 + err * 0.25)); input.brakePedal = err < -1.5 ? Math.min(0.4, (-err - 1.5) * 0.2) : 0;
        v.update(DT);
        const r = Math.hypot(v.x, v.z), slip = speed > 2 ? Math.atan2(v.v, v.u) : 0, ay = st.ayTrue || 0, dev = Math.abs(r - R);
        if (speed > 4) { sum += dev; n++; worst = Math.max(worst, dev); }
        if (dev < 1.5 && Math.abs(slip) < 0.14 && ay > best) { best = ay; bestU = speed; worstAtBest = worst; leanAtBest = Math.abs(v.lean || 0); epsAtBest = Math.atan((v.controller.riderMass / v.mass) * Math.abs(v.controller.posture.lat) / v.cgHeight); }
        if (process.argv.includes("--skdump") && Math.round(t / DT) % 60 === 0) console.log(t.toFixed(0), "kmh", (speed * 3.6).toFixed(0), "r-R", (r - R).toFixed(2), "ay", (ay / 9.81).toFixed(2), "lean", ((v.lean || 0) / DEG).toFixed(1), "slip", (slip / DEG).toFixed(1), "trim", (st.trim || 0).toFixed(2));
        if (v.controller.crashed) { crash = v.controller.crashReason || "crashed"; why = "crash " + crash; }
        else if (speed > 2 && (dev > 6 || Math.abs(slip) > 0.25)) { why = dev > 6 ? "left the line by " + dev.toFixed(1) + " m" : "slip " + (slip / DEG).toFixed(0) + " deg"; break; }
        else if (target - speed > 3) { st.stalled = (st.stalled || 0) + DT; if (st.stalled > 3) { why = "cannot go faster"; break; } } else st.stalled = 0;
    }
    report("skidpad " + R + " m " + CAR.split("-")[0], !crash && best / 9.81 > 0.9 && worstAtBest < 1.5, "best " + (best / 9.81).toFixed(2) + " g at " + (bestU * 3.6).toFixed(0) + " km/h, worst distance to the line " + worst.toFixed(2) + " m (to the best " + worstAtBest.toFixed(2) + "), mean " + (sum / Math.max(1, n)).toFixed(2) + " m, ended: " + why + "\n     grip check (the friction ellipse): " + (best / 9.81).toFixed(2) + " g needs a lean of the whole of " + (Math.atan(best / 9.81) / DEG).toFixed(1) + " deg; the bike leans " + (leanAtBest / DEG).toFixed(1) + " + " + (epsAtBest / DEG).toFixed(1) + " (the rider hangs off) = " + ((leanAtBest + epsAtBest) / DEG).toFixed(1) + " deg, which holds " + Math.tan(leanAtBest + epsAtBest).toFixed(2) + " g; grip_g " + v.controller.gripG + " is the cap on the bike alone");
}
// a power wheelie: from a standstill, the gas wide open in first gear (or the gear in --gear=), wheelie control off, the clutch let go: when does the front wheel come up, how high does it go, does the bike
// loop over (a setup with too much power for its wheelbase and weight does), and can the rider's weight (the keys forward: riderKey) hold it. --only=wheelie, --wdump for every 0.1 s
const WSP = parseFloat((process.argv.find(a => a.startsWith("--wspeed=")) || "--wspeed=0").split("=")[1]);      // --wspeed=20: a rolling start at that speed (km/h) before the gas goes wide open
const WFROM = parseFloat((process.argv.find(a => a.startsWith("--wfrom=")) || "--wfrom=0.4").split("=")[1]);
const pitchOf = v => { const qx = v.qx, qy = v.qy, qz = v.qz, qw = v.qw; return Math.asin(Math.max(-1, Math.min(1, 2 * (qy * qz - qx * qw)))) / DEG; };
for (const hold of [0, 1]) {
    if ((ONLY && ONLY !== "wheelie") || (!ONLY && !process.argv.includes("--rider"))) continue;
    const car = makeCar(config), v = car.v; v.controller.options = { wheelieControl: false }; let crash = null, up = null, maxPitch = 0, maxT = 0, uMax = 0, looped = false, aPeak = 0, armed = true; const uHist = [];
    const gear = parseInt((process.argv.find(a => a.startsWith("--gear=")) || "--gear=0").split("=")[1]);
    for (let t = 0; t < 8 && !crash; t += DT) {
        const input = car.input; input.manualGearbox = true; input.current_gear = gear; input.throttle = t > 0.5 ? 1 : (WSP > 0 ? Math.max(0, Math.min(1, (WSP * KMH - v.u) * 0.5)) : 0); input.brakePedal = 0; input.turnAngle = 0;
        v.controller.riderKey = hold && t > 0.5 && pitchOf(v) > 8 ? 1 : 0;      // (the keys for the rider forward, from 8 degrees of nose up)
        v.update(DT);
        const pit = pitchOf(v); if (t > 0.5) { if (pit > 8 && up === null) up = t - 0.5; if (pit > maxPitch) { maxPitch = pit; maxT = t - 0.5; } uMax = Math.max(uMax, v.u); if (pit > 80) looped = true; uHist.push(v.u); if (pit > 12) armed = false; if (armed && uHist.length > 6) aPeak = Math.max(aPeak, (v.u - uHist[uHist.length - 7]) / (6 * DT)); }
        if (process.argv.includes("--wdump") && Math.round(t / DT) % 3 === 0 && t > WFROM) console.log(t.toFixed(2), "kmh", (v.u * 3.6).toFixed(0), "pitch", pit.toFixed(1), "gear", v.current_gear, "front", ((v.wheels[0].weight || 0) + (v.wheels[1].weight || 0)).toFixed(0));
        if (v.controller.crashed) crash = v.controller.crashReason || "crashed";
    }
    // the acceleration at which the front wheel comes up: g x (the distance of the centre of gravity from the rear contact) / (its height); a setup that pulls more than that on the road (aPeak, the most while the nose was
    // still down) loops over without wheelie control, whatever the rider does: that is the test for a bike with too much power or traction. The result is a warning (the wheelie control is the answer), not a failure.
    const aWheelie = 9.81 * (v.wheelbase * v.weight_distribution) / v.cgHeight;
    console.log((looped ? "WARN " : "ok   ") + "power wheelie " + CAR.split("-")[0] + " gear " + (gear + 1) + (hold ? ", the rider leans forward" : ", the rider does nothing") + ": " + (up === null ? "the front wheel stays down" : "front wheel up after " + up.toFixed(2) + " s") + ", highest " + maxPitch.toFixed(0) + " deg" + (looped ? " (LOOPS OVER: too much power for this wheelbase and weight)" : "") + ", pulls " + (aPeak / 9.81).toFixed(2) + " g with the nose down, the front comes up at " + (aWheelie / 9.81).toFixed(2) + " g" + (crash ? ", crashed: " + crash : ""));
}
// the rider's body (replays of a rider): the front wheel in the air (the gas wide open, the wheelie control off) with a key for a bend: the lean has to follow the key and the bike may not go over,
// and the front wheel coming down in a bend. Then the brake in a bend: the path may not run wider than it did (the radius is the path's, from the heading of the speed)
const AD = process.argv.includes("--adump");
for (const speed of [40, 60, 80]) for (const cmd of [0.5, 1]) {
    if ((ONLY && ONLY !== "assist") || (SPEEDS.length && !SPEEDS.includes(speed)) || (!ONLY && !process.argv.includes("--rider"))) continue;
    const car = makeCar(config), v = car.v, lock = 0.38; let crash = null, maxLean = 0, maxPitch = 0, overshoot = 0, nLift = 0, nT = 0; const L = [];
    for (let t = 0; t < 16 && !crash; t += DT) {
        const input = car.input, tt = t - 10, err = speed * KMH - v.u;
        if (tt < 0) { v.controller.options = null; input.manualGearbox = false; input.throttle = err > 0 ? Math.min(1, err * 0.5) : 0; input.brakePedal = err < 0 ? Math.min(1, -err * 0.3) : 0; input.turnAngle = 0; }
        else { v.controller.options = { wheelieControl: process.argv.includes("--wc") }; input.manualGearbox = true; input.current_gear = 1; input.throttle = tt < 3 ? 1 : 0; input.brakePedal = 0; input.turnAngle = (tt > 0.5 && tt < 3.5 ? cmd : tt >= 3.5 && tt < 5 ? -cmd : 0) * lock; }
        if (tt > 0.55 && tt < 0.6 && !process.argv.includes("--noimpulse")) { const k = parseFloat((process.argv.find(a => a.startsWith("--lift=")) || "--lift=3").split("=")[1]); const qx = v.qx, qy = v.qy, qz = v.qz, qw = v.qw; const ax = 1 - 2 * (qy * qy + qz * qz), ay = 2 * (qx * qy + qz * qw), az = 2 * (qx * qz - qy * qw); v.wx -= k * ax * DT * 60 * 0.1; v.wy -= k * ay * DT * 60 * 0.1; v.wz -= k * az * DT * 60 * 0.1; }      // (--lift=3: a kick that brings the nose up, as a wheelie does; --noimpulse: none)
        v.update(DT);
        if (tt > 0) {
            const lean = (v.lean || 0) / DEG, tgt = (v.controller.targetLean || 0) / DEG, fl = ((v.wheels[0].weight || 0) + (v.wheels[1].weight || 0)) / Math.max(1, v.weight_distribution * v.mass * 9.81);
            maxLean = Math.max(maxLean, Math.abs(lean)); nT++; if (fl < 0.1) nLift++; overshoot = Math.max(overshoot, Math.abs(lean) - Math.abs(tgt) * 1);
            L.push({ lean, tgt });
            if (AD && Math.round(tt / DT) % 6 === 0) console.log(tt.toFixed(1), "kmh", (v.u * 3.6).toFixed(0), "lean", lean.toFixed(1), "tgt", tgt.toFixed(1), "front", fl.toFixed(2), "bars", ((v.controller.steer || 0) / DEG).toFixed(1), "assist", ((v.controller.dbg && v.controller.dbg.assist) || 0).toFixed(2), "T", ((v.controller.dbg && v.controller.dbg.assistT) || 0).toFixed(0));
        }
        if (v.controller.crashed) crash = v.controller.crashReason || "crashed";
    }
    report("assist " + CAR.split("-")[0] + " " + speed + " km/h, key " + cmd + " with the gas wide open", !crash && maxLean < 62, "front light " + (100 * nLift / Math.max(1, nT)).toFixed(0) + " % of the time, max lean " + maxLean.toFixed(0) + ", most past the lean asked " + overshoot.toFixed(0) + (crash ? ", crashed: " + crash : ""));
}
for (const speed of [50, 70, 90]) for (const brake of [0, 0.6, 1]) {
    if ((ONLY && ONLY !== "bendbrake") || (SPEEDS.length && !SPEEDS.includes(speed)) || (!ONLY && !process.argv.includes("--rider"))) continue;
    const car = makeCar(config), v = car.v, lock = 0.38; let crash = null, maxLean = 0, h0 = null, hA = null, hB = null, tA = 0, tB = 0, uA = 0, uB = 0;
    for (let t = 0; t < 16 && !crash; t += DT) {
        const input = car.input, tt = t - 10, err = speed * KMH - v.u;
        if (tt < 0) { input.throttle = err > 0 ? Math.min(1, err * 0.5) : 0; input.brakePedal = err < 0 ? Math.min(1, -err * 0.3) : 0; input.turnAngle = 0; }
        else { input.throttle = 0; input.brakePedal = tt > 2.5 ? brake : 0; input.turnAngle = (tt > 0.3 ? 1 : 0) * lock; }
        v.update(DT);
        if (tt > 0) {
            maxLean = Math.max(maxLean, Math.abs((v.lean || 0) / DEG)); const hd = Math.atan2(v.vx, v.vz);
            if (tt >= 1.5 && hA === null) { hA = hd; tA = tt; uA = v.u; } if (tt >= 2.5 && hB === null) { hB = hd; tB = tt; uB = v.u; }      // a second of the bend before the brake (1.5 to 2.5 s)
            if (tt >= 2.5 && Math.abs(tt - 3.5) < DT / 2) { h0 = [hd, tt, v.u]; }
            if (AD && Math.round(tt / DT) % 6 === 0) console.log(tt.toFixed(1), "kmh", (v.u * 3.6).toFixed(0), "lean", ((v.lean || 0) / DEG).toFixed(1), "tgt", ((v.controller.targetLean || 0) / DEG).toFixed(1), "slip", (Math.atan2(v.v, Math.max(1, Math.abs(v.u))) / DEG).toFixed(1), "yawbias", ((v.controller.dbg && v.controller.dbg.yawBias) || 0).toFixed(2));
        }
        if (v.controller.crashed) crash = v.controller.crashReason || "crashed";
    }
    const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
    // the path's turn rate over the second before the brake and over the second of the brake: how much the bend widens (radius = speed / rate)
    const rate1 = hB !== null ? Math.abs(wrap(hB - hA)) / (tB - tA) : 0, rate2 = h0 ? Math.abs(wrap(h0[0] - hB)) / (h0[1] - tB) : 0;
    const r1 = (uA + uB) / 2 / Math.max(rate1, 1e-3), r2 = (uB + h0[2]) / 2 / Math.max(rate2, 1e-3);
    report("bend + brake " + brake + " " + CAR.split("-")[0] + " " + speed + " km/h", !crash, "radius before the brake " + r1.toFixed(0) + " m, on the brake " + r2.toFixed(0) + " m (x" + (r2 / r1).toFixed(2) + "), max lean " + maxLean.toFixed(0) + (crash ? ", crashed: " + crash : ""));
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
// a jump in a bend (the replay of a rider on Dirt run, 6 November: a small jump taken in a lean with the key held, the bike rolled to 50 to 80 degrees in the air and landed sideways,
// slid on and went down; a hop over a bump in a 50 degree lean kicked it 5 m/s sideways): ridden in a bend with the key held, the bike is thrown up (vy), the key stays held in the air (and
// the gas, or not), and after the landing the gas is shut with the key still held. The lean at the landing, the slip after it and whether it stays up.
// --jdump: every 0.05 s from the take-off
const JV = ((process.argv.find(a => a.startsWith("--jv=")) || "").split("=")[1] || "").split(",").filter(Boolean).map(Number), JC = ((process.argv.find(a => a.startsWith("--jc=")) || "").split("=")[1] || "").split(",").filter(Boolean).map(Number), JG = ((process.argv.find(a => a.startsWith("--jg=")) || "").split("=")[1] || "").split(",").filter(Boolean).map(Number);      // --jv=2.5 --jc=1 --jg=0: one of them
for (const speed of [40, 60, 80]) for (const cmd of (JC.length ? JC : [0.5, 1])) for (const vy of (JV.length ? JV : [0, 1.2, 2.5, 4.5])) for (const airGas of (JG.length ? JG : [0, 1])) {
    if ((ONLY && ONLY !== "jump") || (SPEEDS.length && !SPEEDS.includes(speed)) || (!ONLY && !process.argv.includes("--rider"))) continue;
    const car = makeCar(config), v = car.v, lock = 0.38; let crash = null, t0 = -1, tLand = -1, leanOff = 0, leanLand = 0, slipLand = 0, maxBeta = 0, slideT = 0, flight = 0;
    for (let t = 0; t < 22 && !crash; t += DT) {
        const input = car.input, tt = t - 10, err = speed * KMH - v.u;
        input.turnAngle = tt > 0 ? cmd * lock : 0;
        if (t0 < 0) { input.throttle = err > 0 ? Math.min(1, err * 0.5) : 0; input.brakePedal = err < 0 ? Math.min(1, -err * 0.3) : 0; }
        else if (tLand < 0) { input.throttle = t < t0 + 0.2 ? airGas : 0; input.brakePedal = 0; }      // (the gas in the air: a blip of 0.2 s; held, it is a flip, below)
        else { input.throttle = 0; input.brakePedal = 0; }
        if (tt > 4 && t0 < 0) { t0 = t; leanOff = (v.lean || 0) / DEG; v.vy += vy; v.py += 0.03; }
        v.update(DT);
        const beta = Math.atan2(v.v || 0, Math.max(1, Math.abs(v.u))) / DEG;
        if (t0 >= 0 && tLand < 0 && t > t0 + 0.1 && !v.airborne) { tLand = t; flight = t - t0; leanLand = (v.lean || 0) / DEG; slipLand = beta; }
        if (tLand >= 0 && t < tLand + 2) { maxBeta = Math.max(maxBeta, Math.abs(beta)); if (Math.abs(beta) > 8) slideT += DT; }
        if (process.argv.includes("--jdump") && t0 >= 0 && Math.round((t - t0) / DT) % 3 === 0 && t < t0 + 4) console.log((t - t0).toFixed(2), "kmh", (v.u * 3.6).toFixed(0), "lean", ((v.lean || 0) / DEG).toFixed(1), "beta", beta.toFixed(1), "air", v.airborne ? 1 : 0, "yaw", v.r.toFixed(2), "vy", v.vy.toFixed(2), "fzF", (v.wheels[0].gripLoad || 0).toFixed(0), "fzR", (v.wheels[2].gripLoad || 0).toFixed(0), "thr", input.throttle, "AIR", JSON.stringify(v.controller.airDbg && Object.fromEntries(Object.entries(v.controller.airDbg).map(([k, x]) => [k, +(x / (k === "wy" ? 1 : DEG)).toFixed(1)]))));
        if (v.controller.crashed) crash = v.controller.crashReason || "crashed";
        if (tLand >= 0 && t > tLand + 4) break;
    }
    report("jump " + speed + " km/h, key " + cmd + ", vy " + vy + (airGas ? ", a blip of gas in the air" : ""), !crash && maxBeta < 20 && slideT < 0.6, "flight " + flight.toFixed(2) + " s, lean " + leanOff.toFixed(0) + " at the take-off, " + leanLand.toFixed(0) + " at the landing, slip " + slipLand.toFixed(1) + " at the landing, max " + maxBeta.toFixed(1) + " after it, " + slideT.toFixed(2) + " s over 8" + (crash ? ", crashed: " + crash : ""));
}
// the gas held in the air turns the bike over (a flip), the brake held turns the nose down: the air control has no limit to the angle, only a rate (air_pitch_rate_deg)
for (const pedal of ["gas", "brake"]) {
    if ((ONLY && ONLY !== "flip") || (!ONLY && !process.argv.includes("--rider"))) continue;
    const car = makeCar(config), v = car.v; let t0 = -1, turned = 0, last = null, flight = 0;
    for (let t = 0; t < 16; t += DT) {
        const input = car.input, err = 50 * KMH - v.u; input.turnAngle = 0;
        if (t0 < 0) { input.throttle = err > 0 ? Math.min(1, err * 0.5) : 0; input.brakePedal = 0; }
        else { input.throttle = pedal === "gas" ? 1 : 0; input.brakePedal = pedal === "brake" ? 1 : 0; }
        if (t > 10 && t0 < 0) { t0 = t; v.vy += 7; v.py += 0.03; }
        v.update(DT);
        if (t0 >= 0) {
            if (!v.airborne || v.controller.crashed || t > t0 + 1.2) { if (t > t0 + 0.1) { flight = t - t0; break; } }      // (1.2 s at most: a bike on its back has no wheel to land on, and the bench has no body spheres)
            // the turn about the left axis of the bike, summed
            const sx = 1 - 2 * (v.qy * v.qy + v.qz * v.qz), sy = 2 * (v.qx * v.qy + v.qw * v.qz), sz = 2 * (v.qx * v.qz - v.qw * v.qy);
            turned += -(v.wx * sx + v.wy * sy + v.wz * sz) * DT;
        }
    }
    const deg = turned / DEG;
    report("flip on the " + pedal, pedal === "gas" ? deg > 180 : deg < -120, "the nose turned " + deg.toFixed(0) + " degrees in a flight of " + flight.toFixed(2) + " s");
}
console.log(failed ? failed + " failed" : "all ok");
process.exit(failed ? 1 : 0);
