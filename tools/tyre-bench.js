#!/usr/bin/env node
/*
 * tyre-bench.js
 *
 * Description: A test bench for the tyre models alone, without the browser and without the car: it runs the tyre (TyreShell.js) on a flat road with a hub that is held where the bench wants it, and measures what a tyre test rig would, so that a
 *              change to a tyre can be checked for odd numbers before it is felt in the game:
 *
 *                - the static curve: the load against the deflection (the stiffness, the patch), at the nominal pressure and at 0.6 and 1.4 times it;
 *                - rolling: the effective rolling radius, the rolling resistance, and the noise of the load and of the friction on a steady roll;
 *                - the slip ratio sweep (driving and braking): the slip stiffness, the peak, where the peak is, what is left when the wheel spins;
 *                - the slip angle sweep: the cornering stiffness, the peak, where the peak is;
 *                - the camber sweep: the camber stiffness (a wheel that leans pushes to the side it leans to), against the cornering stiffness;
 *                - combined slip: the friction circle;
 *                - the relaxation length: the distance to 63 % of the lateral force after a step of the slip angle;
 *                - the wheel on the tyre: a wheel mass (20, 35 and 90 kg) in balance on the tyre, kicked, at the step of the game: it has to settle;
 *                - the cost: milliseconds per step.
 *
 *              Every figure is held against the range of a real passenger car tyre (the references at the top of the script); what is outside is
 *              marked CHECK. The tyre is set up from a car (its radius, pressure, stiffness, the rings and nodes, the unsprung mass):
 *
 *                  node tools/tyre-bench.js                      the Mustang
 *                  node tools/tyre-bench.js stadium-truck        another car
 *                  node tools/tyre-bench.js --quick              fewer points
 *                  node tools/tyre-bench.js --json               the figures as JSON
 *                  node tools/tyre-bench.js --tests slipx,relax  some of the tests (roll, slipx, slipy, camber, combined, relax, mass, cost; the static curve always)
 *                  node tools/tyre-bench.js --set=beamDamping=0.3  a parameter of the tyre body, to try a value
 *                  node tools/tyre-bench.js --verbose            the series behind some figures
 *
 * Author:      Glenn Hofman
 * Date:        2026-10-25
 * License:     MIT
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "web");
const G = 9.81, DEG = Math.PI / 180, DT = 0.003;        // (the step of the physics of the game)

// ---- what a real passenger car tyre does (Pacejka fits of road tyres, Gillespie, Milliken): the ranges that count as sound
const REF = {
    "deflection at static load (mm)": [8, 35],
    "vertical stiffness (N/mm)": [120, 450],
    "patch length (mm)": [60, 250],
    "deflection: 1.4x pressure / nominal": [0.55, 0.95],         // a harder tyre goes in less
    "rolling radius / radius": [0.93, 1.0],
    "rolling resistance (Crr)": [0.0, 0.03],
    "load noise (% of load)": [0, 3],
    "friction noise (% of load)": [0, 3],
    "slip stiffness / Fz (per unit slip)": [8, 45],
    "peak mu x": [0.85, 1.15],                                   // (the friction of the bench is 1.0: the peak is near it)
    "slip at peak (%)": [4, 30],
    "mu x at 100 % slip / peak": [0.6, 1.0],
    "drive/brake symmetry": [0.9, 1.1],
    "cornering stiffness / Fz (per rad)": [8, 30],
    "peak mu y": [0.85, 1.2],
    "slip angle at peak (deg)": [3, 14],
    "camber stiffness / cornering stiffness": [0.02, 0.5],      // (the brush model gives a quarter; a car tyre a tenth)
    "camber: pushes to the side it leans to": [1, 1],
    "friction circle: combined / mu": [0.85, 1.08],
    "relaxation length (m)": [0.05, 1.2],
    "wheel on tyre: growth of the swing": [0, 1.0],
    "wheel spin at a standstill: swing left (rad/s)": [0, 0.3],
    "substeps wanted / allowed": [0, 1],
    "cost (ms per step)": [0, 2.5]
};

// ---- the tyre models in a sandbox (plain scripts that share the OpenRacer global)
const sandbox = { OpenRacer: {}, console: console, Math: Math };
vm.createContext(sandbox);
for (const file of ["TyreShell.js"]) vm.runInContext(fs.readFileSync(path.join(ROOT, "js", file), "utf8"), sandbox, { filename: file });

// a flat road at y = 0: one triangle, as Ground.js answers for it
const road = {
    boxNear: (t, x, y, z, r) => Math.abs(y) <= r,
    closest: (t, x, y, z, out) => { out.x = x; out.y = 0; out.z = z; out.region = 0; return y * y; },
    normalOf: (t, o) => { o.x = 0; o.y = 1; o.z = 0; },
    surfaceOf: () => "road", meshOf: () => "floor"
};
const LIST = [0];
const MU = 1.0, SLIDING = 0.9;
const frictionOf = () => ({ mu: MU, sliding: SLIDING });

function loadCar(id) {
    const file = path.join(ROOT, "cars", id, "car.json");
    if (!fs.existsSync(file)) throw new Error("no car " + id + " (web/cars/" + id + "/car.json)");
    return Object.assign({ id }, JSON.parse(fs.readFileSync(file, "utf8")));
}

// the tyre of a car, as Vehicle.js sets it up (the front wheel)
function setup(config, model) {
    const ch = config.chassis || {}, ty = config.tyres || {}, sh = ty.shell || {}, dims = config.dimensions || {};
    const R = (dims.tire_diameter || ch.tire_diameter || 0.65) / 2, mass = ch.mass || 1500;
    const light = Math.min(1, mass / 1000), unsprung = ch.unsprung_mass || (light < 1 ? Math.max(2, 0.0285 * mass) : 35);
    const front = ch.weight_distribution !== undefined ? ch.weight_distribution : 0.5;
    const staticLoad = mass * G * front / 2;
    const wheel = { radius: R, mass: unsprung, inertia: ch.wheel_inertia || 1.6, front: true };
    const body = new sandbox.OpenRacer.TyreShell(wheel);
    body.rings = sh.rings || 3;
    body.segments = sh.segments || 36;
    body.width = sh.width || 0;
    body.stiffX = ty.stiff_x || 20; body.stiffY = (ty.stiff_y || 18) * 1.0;
    body.verticalStiffness = ch.tyre_rate || 220000 * Math.sqrt(light);
    body.verticalDamping = ch.tyre_damping || 3000 * Math.sqrt(light);
    body.staticLoad = staticLoad;
    if (model === "shell") {
        body.isShell = true;
        body.tyreMass = Math.max(1.5, 0.3 * unsprung);
        body.pressure = ty.pressure_front || 2.2;
        body.innerRatio = sh.inner_ratio || 0.62;
        body.carcass = sh.carcass || 0;
    }
    return { body, wheel, R, staticLoad, unsprung, pressure: ty.pressure_front || 2.2, model, lateralGrip: 1.05, carMass: mass };
}

// ---- the rig: the hub is held (position, velocity, the axes and the spin), the tyre answers with the force on the hub
const Y = { x: 0, y: 1, z: 0 }, F0 = { x: 0, y: 0, z: 1 }, L0 = { x: 1, y: 0, z: 0 };
function axes(camber) {
    // the wheel leans to the left (+x) by camber: its up and its axle turn about the forward axis
    const c = Math.cos(camber), s = Math.sin(camber);
    return { U: { x: s, y: c, z: 0 }, L: { x: c, y: -s, z: 0 }, F: F0 };
}
function step(t, hub, vel, omega, ax) {
    return t.body.step(DT, hub, vel, ax.L, ax.F, ax.U, omega, road, LIST, frictionOf, t.lateralGrip, t.carMass);
}
function forces(t) {
    const b = t.body;
    return { fz: b.normal.y + b.friction.y, fx: b.friction.z, fy: b.friction.x, torque: b.axleTorque || 0 };
}
function mean(a) { return a.reduce((x, y) => x + y, 0) / Math.max(1, a.length); }
function std(a) { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) * (x - m)))); }

// the hub height that gives the static load, at rest: the deflection is scanned downwards until the load is passed (a tyre pushed in too far gives nothing: the shell starts again), then halved
function loadAt(t, y, camber, steps) {
    const ax = axes(camber || 0);
    t.body.reset();
    const hub = { x: 0, y, z: 0 }, vel = { x: 0, y: 0, z: 0 };
    const n = steps || 400, fz = [];
    for (let i = 0; i < n; i++) { step(t, hub, vel, 0, ax); if (i >= n - 50) fz.push(forces(t).fz); }
    return mean(fz);
}
function heightFor(t, load, camber) {
    let hi = t.R + 0.002, lo = hi;
    for (let k = 1; k <= 24; k++) { lo = t.R - k * 0.0125 * t.R; const f = loadAt(t, lo, camber); if (verbose) console.log("    scan: deflection " + (k * 1.25).toFixed(2) + " % -> " + Math.round(f) + " N (" + t.body.contacts + " contacts, " + (t.body.substepsWanted || 0) + " substeps wanted)"); if (f > load) break; hi = lo; }
    for (let it = 0; it < 14; it++) {
        const y = (lo + hi) / 2;
        if (loadAt(t, y, camber) > load) lo = y; else hi = y;
    }
    return (lo + hi) / 2;
}

// a steady roll: the hub at a height, moving at v forward (and sideways by the slip angle), the wheel at omega; the mean force of the end of the run
function roll(t, y, v, omega, slipAngle, camber, seconds, tail) {
    const ax = axes(camber || 0);
    const hub = { x: 0, y, z: 0 }, vel = { x: v * Math.sin(slipAngle || 0), y: 0, z: v * Math.cos(slipAngle || 0) };
    const n = Math.round(seconds / DT), from = n - Math.round((tail || 0.2) / DT), fz = [], fx = [], fy = [], tq = [];
    for (let i = 0; i < n; i++) {
        step(t, hub, vel, omega, ax);
        hub.x += vel.x * DT; hub.z += vel.z * DT;
        if (i >= from) { const f = forces(t); fz.push(f.fz); fx.push(f.fx); fy.push(f.fy); tq.push(f.torque); }
    }
    return { fz: mean(fz), fx: mean(fx), fy: mean(fy), torque: mean(tq), fzStd: std(fz), fxStd: std(fx), fyStd: std(fy) };
}

// the spin of a free wheel at a speed: the wheel that gives no force along the road. The force is at its limit on both sides of it within a few percent of
// slip (the cylinder tyre), so the sign change is looked for first (from 0.9 to 1.15 of v / R) and then halved
function freeOmega(t, y, v, slipAngle, camber) {
    const fxAt = (w) => roll(t, y, v, w, slipAngle, camber, 0.45).fx;
    const base = v / t.R;
    let lo = 0.9 * base, flo = fxAt(lo), hi = lo;
    for (let k = 0.92; k <= 1.16; k += 0.02) { hi = k * base; const f = fxAt(hi); if (f * flo <= 0) break; lo = hi; flo = f; }
    for (let it = 0; it < 12; it++) {
        const mid = 0.5 * (lo + hi), f = fxAt(mid);
        if (Math.abs(f) < 0.002 * t.staticLoad) return mid;
        if (f * flo <= 0) hi = mid; else { lo = mid; flo = f; }
    }
    return 0.5 * (lo + hi);
}

function bench(t, quick, tests) {
    const out = {}, flags = {}, R = t.R, Fz = t.staticLoad;
    const want = (name) => !tests || tests.indexOf(name) >= 0;
    t.body.lockedSpin = true;                 // (the rig turns the wheel at the spin it is given; the spin test below lets the tread turn it)
    const put = (name, value) => { out[name] = value; const ref = REF[name]; if (ref) flags[name] = value >= ref[0] && value <= ref[1] && value === value; };
    const t0 = Date.now();

    // ---- the static curve
    const y0 = heightFor(t, Fz, 0);
    const defl = R - y0;
    put("deflection at static load (mm)", defl * 1000);
    const yUp = heightFor(t, Fz * 1.2, 0), yDown = heightFor(t, Fz * 0.8, 0);
    put("vertical stiffness (N/mm)", (0.4 * Fz) / Math.max(1e-6, (yDown - yUp)) / 1000);
    t.body.reset(); { const hub = { x: 0, y: y0, z: 0 }, vel = { x: 0, y: 0, z: 0 }; for (let i = 0; i < 200; i++) step(t, hub, vel, 0, axes(0)); }
    put("patch length (mm)", (t.body.patch || 0) * 1000);
    out["contacts at static load"] = t.body.contacts || 0;
    if (t.model === "shell") {
        const p = t.body.pressure;
        t.body.pressure = p * 1.4; const yHard = heightFor(t, Fz, 0);
        t.body.pressure = p * 0.6; const ySoft = heightFor(t, Fz, 0);
        t.body.pressure = p;
        put("deflection: 1.4x pressure / nominal", (R - yHard) / Math.max(1e-6, defl));
        out["deflection at 0.6x pressure (mm)"] = (R - ySoft) * 1000;
    }

    // ---- rolling
    const V = 15;
    t.body.reset();
    const wFree = freeOmega(t, y0, V, 0, 0);
    put("rolling radius / radius", V / wFree / R);
    if (want("roll")) {
    const steady = roll(t, y0, V, wFree, 0, 0, 1.0, 0.4);
    // (the torque that the axle has to give to keep the wheel rolling with no force along the road, over the radius)
    put("rolling resistance (Crr)", Math.abs(steady.torque) / (R * Math.max(1, steady.fz)));
    out["force along the road on the free roll (N)"] = steady.fx;
    put("load noise (% of load)", 100 * steady.fzStd / Math.max(1, steady.fz));
    put("friction noise (% of load)", 100 * Math.max(steady.fxStd, steady.fyStd) / Math.max(1, steady.fz));
    out["load on the roll (N)"] = steady.fz;
    out["sliding share of the load on the free roll"] = t.body.slidingShare || 0;
    if (t.body.centreAlong !== undefined) { out["pressure centre ahead of the hub on the free roll (mm)"] = 1000 * t.body.centreAlong; out["rolling resistance from the pressure centre (Crr)"] = t.body.centreAlong / R; }
    // the rolling resistance at other speeds: a real one hardly changes with the speed below 100 km/h (dampers in the tyre give one that grows with it)
    for (const vv of [5, 30]) { t.body.reset(); const w = freeOmega(t, y0, vv, 0, 0); const r = roll(t, y0, vv, w, 0, 0, 0.8, 0.3); out["rolling resistance at " + vv + " m/s (Crr)"] = Math.abs(r.torque) / (R * Math.max(1, r.fz)); }
    }

    // ---- the slip ratio sweep: kappa = omega R / v - 1 (positive: driving)
    if (want("slipx")) {
    const kappas = quick ? [-1, -0.3, -0.15, -0.08, -0.04, -0.02, 0.02, 0.04, 0.08, 0.15, 0.3, 1] : [-1, -0.5, -0.3, -0.2, -0.15, -0.1, -0.08, -0.06, -0.04, -0.02, -0.01, 0.01, 0.02, 0.04, 0.06, 0.08, 0.1, 0.15, 0.2, 0.3, 0.5, 1];
    const curveX = kappas.map((k) => { t.body.reset(); const r = roll(t, y0, V, wFree * (1 + k), 0, 0, 0.7); return { k, mu: r.fx / Math.max(1, r.fz) }; });
    out["slip ratio curve (kappa: mu x)"] = curveX.map((p) => p.k + ": " + p.mu.toFixed(3)).join(", ");
    const small = curveX.filter((p) => Math.abs(p.k) <= 0.02);
    put("slip stiffness / Fz (per unit slip)", mean(small.map((p) => p.mu / p.k)));
    const drive = curveX.filter((p) => p.k > 0), brake = curveX.filter((p) => p.k < 0);
    const peakD = drive.reduce((a, p) => (p.mu > a.mu ? p : a), drive[0]), peakB = brake.reduce((a, p) => (-p.mu > -a.mu ? p : a), brake[0]);
    put("peak mu x", peakD.mu);
    put("slip at peak (%)", 100 * peakD.k);
    put("mu x at 100 % slip / peak", drive[drive.length - 1].mu / Math.max(1e-6, peakD.mu));
    put("drive/brake symmetry", peakD.mu / Math.max(1e-6, -peakB.mu));
    // the curve has to rise up to the peak
    let rises = true; for (let i = 1; i < drive.length && drive[i - 1].k < peakD.k; i++) if (drive[i].mu < drive[i - 1].mu - 0.01) rises = false;
    out["slip curve rises to the peak"] = rises; flags["slip curve rises to the peak"] = rises;
    }

    // ---- the slip angle sweep (the wheel free, the hub moves sideways)
    let cAlpha = NaN;
    if (want("slipy") || want("camber")) {
    const alphas = (quick ? [-10, -6, -3, -1, 1, 3, 6, 10] : [-14, -10, -8, -6, -5, -4, -3, -2, -1, -0.5, 0.5, 1, 2, 3, 4, 5, 6, 8, 10, 14]).map((d) => d * DEG);
    const curveY = alphas.map((a) => { t.body.reset(); const w = freeOmega(t, y0, V, a, 0); const r = roll(t, y0, V, w, a, 0, 0.7); return { a, mu: r.fy / Math.max(1, r.fz), fz: r.fz }; });
    out["slip angle curve (deg: mu y)"] = curveY.map((p) => (p.a / DEG).toFixed(1) + ": " + p.mu.toFixed(3)).join(", ");
    // (the hub moves to the left (+x) with a positive slip angle: the road pushes the tyre to the right, so mu y is negative there)
    const smallY = curveY.filter((p) => Math.abs(p.a) <= 1.01 * DEG);
    cAlpha = -mean(smallY.map((p) => p.mu / p.a));
    put("cornering stiffness / Fz (per rad)", cAlpha);
    const left = curveY.filter((p) => p.a > 0), peakY = left.reduce((a, p) => (-p.mu > -a.mu ? p : a), left[0]);
    put("peak mu y", -peakY.mu);
    put("slip angle at peak (deg)", peakY.a / DEG);
    }

    // ---- the camber sweep: the wheel leans to the left, no slip angle, free rolling
    if (want("camber")) {
    const cambers = (quick ? [-4, -2, 2, 4] : [-6, -4, -2, -1, 1, 2, 4, 6]).map((d) => d * DEG);
    const curveC = cambers.map((c) => { t.body.reset(); const y = heightFor(t, Fz, c); const w = freeOmega(t, y, V, 0, c); const r = roll(t, y, V, w, 0, c, 0.7); return { c, mu: r.fy / Math.max(1, r.fz), fz: r.fz }; });
    out["camber curve (deg: mu y)"] = curveC.map((p) => (p.c / DEG).toFixed(0) + ": " + p.mu.toFixed(4)).join(", ");
    const cGamma = mean(curveC.filter((p) => Math.abs(p.c) <= 2.01 * DEG).map((p) => p.mu / p.c));
    out["camber stiffness / Fz (per rad)"] = cGamma;
    put("camber stiffness / cornering stiffness", Math.abs(cGamma) / Math.max(1e-6, cAlpha));
    put("camber: pushes to the side it leans to", cGamma > 0 ? 1 : 0);
    }

    // ---- combined slip: a slip angle of 4 degrees and the slip ratio swept
    if (want("combined")) {
    const a4 = 4 * DEG, wA = (() => { t.body.reset(); return freeOmega(t, y0, V, a4, 0); })();
    const combo = (quick ? [-0.3, -0.1, 0.1, 0.3] : [-0.5, -0.3, -0.15, -0.08, 0.08, 0.15, 0.3, 0.5]).map((k) => { t.body.reset(); const r = roll(t, y0, V, wA * (1 + k), a4, 0, 0.7); return Math.hypot(r.fx, r.fy / t.lateralGrip) / Math.max(1, r.fz); });
    out["friction circle: combined / mu"] = Math.max(...combo) / MU;
    put("friction circle: combined / mu", Math.max(...combo) / MU);
    }

    // ---- the relaxation length: a step of the slip angle to 2 degrees at 10 m/s, the distance to 63 % of the final force
    if (want("relax")) {
        t.body.reset();
        const v = 10, a = 2 * DEG, w = freeOmega(t, y0, v, 0, 0), ax = axes(0);
        const hub = { x: 0, y: y0, z: 0 }, vel = { x: 0, y: 0, z: v };
        for (let i = 0; i < 300; i++) { step(t, hub, vel, w, ax); hub.z += v * DT; }
        vel.x = v * Math.sin(a); vel.z = v * Math.cos(a);
        const fy = [];
        for (let i = 0; i < 400; i++) { step(t, hub, vel, w, ax); hub.x += vel.x * DT; hub.z += vel.z * DT; fy.push(forces(t).fy); }
        // (the first two samples are left out: a hub whose speed jumps gives the dampers of the tyre an impulse, which a car cannot give)
        const final = mean(fy.slice(-60)), target = 0.63 * final;
        let at = fy.findIndex((f, i) => i >= 2 && (final < 0 ? f <= target : f >= target));
        if (at < 0) at = fy.length;
        put("relaxation length (m)", at * DT * v);
        if (verbose) { out["relaxation: force after the step (N, every 3 ms)"] = fy.slice(0, 40).map((f) => f.toFixed(0)).join(" "); out["relaxation: force every 30 ms, and the final (N)"] = fy.filter((f, i) => i % 10 === 0).map((f) => f.toFixed(0)).join(" ") + " | " + final.toFixed(0); }
    }

    // ---- a wheel mass on the tyre, kicked: the game's step, the force has to settle (the whole-car step, without the suspension)
    let worst = 0;
    for (const mw of want("mass") ? [20, 35, 90] : []) {
        t.body.reset();
        const ax = axes(0), hub = { x: 0, y: y0, z: 0 }, vel = { x: 0, y: 0, z: 0 };
        for (let i = 0; i < 300; i++) step(t, hub, vel, 0, ax);
        const Fe = forces(t).fz;
        let y = y0, vy = -0.3;
        const tail = [];
        for (let i = 0; i < 400; i++) {
            hub.y = y; vel.y = vy;
            step(t, hub, vel, 0, ax);
            const f = forces(t).fz; vy += (f - Fe) / mw * DT; y += vy * DT;
            if (i >= 230) tail.push(f);
        }
        // the swing of the force in the last quarter second against the quarter before: above 1 it grows (a wheel without a damper on a real tyre swings for a while, it does not grow)
        const half = Math.floor(tail.length / 2), swing = (a) => Math.max(...a.map((f) => Math.abs(f - Fe)));
        const early = swing(tail.slice(0, half)), late = swing(tail.slice(half)), growth = late / Math.max(1, early);
        out["wheel on tyre " + mw + " kg: swing (% of load), growth"] = (100 * late / Math.max(1, Fe)).toFixed(2) + " %, " + growth.toFixed(2);
        if (!(growth === growth)) worst = Infinity; else worst = Math.max(worst, growth);
    }
    put("wheel on tyre: growth of the swing", worst);
    // ---- the wheel spins against the tyre at a standstill: the wheel's inertia on the tread (the step of the game, Vehicle.js: the tyre's slope is taken implicitly), a torque of a
    // tenth of the grip for a quarter second and then nothing; the swing of the spin after it has to die away (the wheels of a car shuffled back and forth at a standstill)
    if (want("mass")) {
        t.body.reset(); t.body.lockedSpin = false;
        const ax = axes(0), hub = { x: 0, y: y0, z: 0 }, vel = { x: 0, y: 0, z: 0 }, I = t.wheel.inertia;
        for (let i = 0; i < 300; i++) step(t, hub, vel, 0, ax);
        let om = 0; const oms = [], trace = [];
        for (let i = 0; i < 500; i++) {
            step(t, hub, vel, om, ax);
            const torque = i < 80 ? 0.1 * MU * Fz * R : 0, slope = (t.body.dampSlope || 0) * R * R, fx = forces(t).fx;
            if (t.body.omegaOut !== undefined) om = t.body.omegaOut + DT * torque / I; else om += DT * (torque - fx * R) / (I + DT * slope);       // (the shell turns the wheel itself, as in Vehicle.js)
            if (i >= 200) oms.push(om);
            if (verbose && i % 5 === 0) trace.push(om.toFixed(2) + "/" + Math.round(fx) + "/" + Math.round(slope) + "/" + (t.body.slidingShare || 0).toFixed(2));
        }
        if (verbose) out["wheel spin: omega / fx / slope / sliding share, every 15 ms"] = trace.join("  ");
        t.body.lockedSpin = true;
        const half = Math.floor(oms.length / 2), sw = (a) => Math.max(...a.map((o) => Math.abs(o)));
        const early = sw(oms.slice(0, half)), late = sw(oms.slice(half));
        out["wheel spin at a standstill: swing (rad/s), growth"] = late.toFixed(3) + ", " + (late / Math.max(1e-3, early)).toFixed(2);
        put("wheel spin at a standstill: swing left (rad/s)", late);
    }
    put("substeps wanted / allowed", t.body.substepsWanted !== undefined ? t.body.substepsWanted / Math.max(1, t.body.maxSubsteps || 1) : 0);

    // ---- the cost
    if (want("cost")) {
        t.body.reset();
        const ax = axes(0), hub = { x: 0, y: y0, z: 0 }, vel = { x: 0, y: 0, z: V };
        for (let i = 0; i < 100; i++) step(t, hub, vel, wFree, ax);
        const n = 600, t1 = process.hrtime.bigint();
        for (let i = 0; i < n; i++) { step(t, hub, vel, wFree, ax); hub.z += V * DT; }
        put("cost (ms per step)", Number(process.hrtime.bigint() - t1) / 1e6 / n);
    }
    out["bench time (s)"] = (Date.now() - t0) / 1000;
    return { out, flags };
}

// ---- the run
const args = process.argv.slice(2);
const json = args.includes("--json"), quick = args.includes("--quick");
const modelArg = "shell";
const verbose = args.includes("--verbose");
const testsArg = args.includes("--tests") ? args[args.indexOf("--tests") + 1].split(",") : null;      // static is always run; roll,slipx,slipy,camber,combined,relax,mass,cost
const sets = args.filter((a) => a.startsWith("--set=")).map((a) => a.slice(6).split("="));             // --set=beamDamping=0.3: a parameter of the tyre body
const taken = [modelArg].concat(testsArg ? [testsArg.join(",")] : []);
const carId = args.filter((a) => !a.startsWith("--") && taken.indexOf(a) < 0)[0] || "openracer-mustang";
const config = loadCar(carId);
const models = ["shell"];
const results = {};
for (const model of models) {
    const t = setup(config, model);
    sets.forEach((kv) => { t.body[kv[0]] = parseFloat(kv[1]); });
    if (verbose) console.log("  tyre body: " + Object.keys(t.body).filter((k) => typeof t.body[k] === "number" || typeof t.body[k] === "boolean").map((k) => k + "=" + t.body[k]).join(" "));
    const r = bench(t, quick, testsArg);
    results[model] = r;
    if (json) continue;
    console.log("\n== " + config.name + " (" + carId + "), tyre model " + model + ": radius " + t.R.toFixed(3) + " m, static load " + Math.round(t.staticLoad) + " N, " + t.pressure + " bar, unsprung " + t.unsprung + " kg" + (sets.length ? " | " + sets.map((kv) => kv.join(" = ")).join(", ") : ""));
    const names = Object.keys(r.out);
    const width = Math.max(...names.map((n) => n.length));
    for (const name of names) {
        const v = r.out[name], flag = r.flags[name];
        const text = typeof v === "number" ? (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(4)) : String(v);
        const mark = flag === undefined ? "" : flag ? "  ok" : "  CHECK (" + (REF[name] ? REF[name].join(" .. ") : "") + ")";
        console.log("  " + name.padEnd(width) + "  " + text + mark);
    }
    const bad = Object.keys(r.flags).filter((n) => !r.flags[n]);
    console.log(bad.length ? "  -> " + bad.length + " to check: " + bad.join("; ") : "  -> all within the ranges");
}
if (json) console.log(JSON.stringify(results, null, 1));
