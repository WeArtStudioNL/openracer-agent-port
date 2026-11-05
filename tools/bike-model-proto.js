#!/usr/bin/env node
/*
 * bike-model-proto.js
 *
 * Description: Phase 1 of a separate motorcycle model (see MOTORCYCLE.md): a prototype that runs without the browser and without Vehicle.js. Three parts that the
 *              present controller (Motorcycle.js) fakes with forces and moments, here as the physics itself:
 *
 *                1. THE CHASSIS WITH A STEERING ANGLE. The linear Whipple model of Meijaard et al. (2007), the benchmark bicycle: roll and steer are the two degrees of
 *                   freedom, M q'' + v C1 q' + (g K0 + v^2 K2) q = [roll torque, steer torque]. Nobody gives it a lean spring or a computed steering angle: the
 *                   self-stability (4.29 to 6.02 m/s), the capsize and the weave come out of the matrices. Check: the stable range against the published one.
 *                2. THE TYRE (BikeTyre). A tyre with a round crown: the lateral force from the slip angle AND the camber (magic formula in an effective slip), the
 *                   contact point that moves out as the tyre leans, a friction ellipse for combined slip and a relaxation length (a first-order lag of the force).
 *                   Check: the share of the force of a bend that the lean gives by itself, against the 0.85 of the present controller (camber_thrust).
 *                3. THE RIDER AS A CONTROLLER. The rider has one input, a torque on the bars (and, later, his weight). A PID on the lean error. Countersteering is
 *                   not coded: it has to appear by itself. Check: the first movement of the bars is to the wrong side, the lean arrives, and the unstable bike
 *                   (capsize above 6 m/s) is held at 10, 20 and 40 m/s.
 *
 *              Small angles only (the model is linear); the large leans are for phase 2, in the rigid body of the game. Nothing here is used by the game yet.
 *
 *                  node tools/bike-model-proto.js            all the checks
 *                  node tools/bike-model-proto.js --json     the figures as JSON
 *
 * Author:      Glenn Hofman
 * Date:        2026-11-05
 * License:     MIT
 */
"use strict";

const G = 9.81, DEG = Math.PI / 180;

// ---------------------------------------------------------------- 1. the chassis: the benchmark bicycle of Meijaard, Papadopoulos, Ruina, Schwab (2007)
// (rider included; K0 is for g = 1; the lean to the right and the steer to the right are positive)
const BENCH = {
    M: [[80.81722, 2.31941332208709], [2.31941332208709, 0.29784188199686]],
    C1: [[0, 33.86641391492494], [-0.85035641456978, 1.68540397397560]],
    K0: [[-80.95, -2.59951685249872], [-2.59951685249872, -0.80329488458618]],
    K2: [[0, 76.59734589573222], [0, 2.65431523794604]],
    wheelbase: 1.02, trail: 0.08, mass: 87     // (the benchmark is a city bicycle, not a motorcycle: it checks the method, the CBR comes in phase 2)
};

function inv2(m) { const d = m[0][0] * m[1][1] - m[0][1] * m[1][0]; return [[m[1][1] / d, -m[0][1] / d], [-m[1][0] / d, m[0][0] / d]]; }
function mul2(a, b) { return [[a[0][0] * b[0][0] + a[0][1] * b[1][0], a[0][0] * b[0][1] + a[0][1] * b[1][1]], [a[1][0] * b[0][0] + a[1][1] * b[1][0], a[1][0] * b[0][1] + a[1][1] * b[1][1]]]; }

// the state x = [roll, steer, roll rate, steer rate]; returns the 4 x 4 matrix A of x' = A x + B T (T: the torque on the bars)
function stateMatrix(v, b) {
    b = b || BENCH;
    const Mi = inv2(b.M), K = [[G * b.K0[0][0] + v * v * b.K2[0][0], G * b.K0[0][1] + v * v * b.K2[0][1]], [G * b.K0[1][0] + v * v * b.K2[1][0], G * b.K0[1][1] + v * v * b.K2[1][1]]];
    const MK = mul2(Mi, K), MC = mul2(Mi, [[v * b.C1[0][0], v * b.C1[0][1]], [v * b.C1[1][0], v * b.C1[1][1]]]);
    const A = [[0, 0, 1, 0], [0, 0, 0, 1], [-MK[0][0], -MK[0][1], -MC[0][0], -MC[0][1]], [-MK[1][0], -MK[1][1], -MC[1][0], -MC[1][1]]];
    const B = [0, 0, Mi[0][1], Mi[1][1]];
    return { A, B, K };
}

// the eigenvalues of a 4 x 4 matrix: the characteristic polynomial (Faddeev-LeVerrier), the roots by Durand-Kerner
function eigenvalues(A) {
    const n = 4; let Mk = Array.from({ length: n }, () => new Array(n).fill(0)); const c = [1];
    const I = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
    for (let k = 1; k <= n; k++) {
        // Mk = A * Mk-1 + c(k-1) I
        const AM = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => { let s = 0; for (let l = 0; l < n; l++) s += A[i][l] * Mk[l][j]; return s + c[k - 1] * I[i][j]; }));
        Mk = AM; let tr = 0; for (let i = 0; i < n; i++) { let s = 0; for (let l = 0; l < n; l++) s += A[i][l] * Mk[l][i]; tr += s; }
        c.push(-tr / k);
    }
    // x^4 + c1 x^3 + c2 x^2 + c3 x + c4
    let roots = [[0.4, 0.9], [-0.65, 0.72], [-0.55, -0.8], [0.3, -0.5]].map((r, i) => [r[0] * (1 + i), r[1]]);
    const cm = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]], cd = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
    for (let it = 0; it < 500; it++) {
        roots = roots.map((r, i) => {
            let p = [1, 0]; for (let k = 1; k <= n; k++) { p = cm(p, r); p[0] += c[k]; }
            let den = [1, 0]; for (let j = 0; j < n; j++) if (j !== i) den = cm(den, [r[0] - roots[j][0], r[1] - roots[j][1]]);
            const d = cd(p, den); return [r[0] - d[0], r[1] - d[1]];
        });
    }
    return roots.map(r => ({ re: r[0], im: r[1] })).sort((a, b) => b.re - a.re);
}
const maxRe = v => eigenvalues(stateMatrix(v).A)[0].re;

// ---------------------------------------------------------------- 2. the tyre of a motorcycle
// R: outer radius, rc: radius of the crown (a round tyre: 0.12 m on a 17 inch sports tyre), mu: the friction, relax: the relaxation length (m).
function BikeTyre(o) {
    o = o || {};
    const self = this;
    this.R = o.R || 0.31; this.rc = o.rc || 0.12; this.mu = o.mu || 1.1; this.relax = o.relax || 0.35;
    this.Calpha = o.Calpha || 11;         // the cornering stiffness (per rad, of the load)
    this.camberRatio = o.camberRatio || 0.087;   // an angle of camber is worth this much slip angle (the stiffness ratio; a car tyre 0.1, a round tyre as much)
    this.C = o.C || 1.4; this.E = o.E || -0.3;
    this.alphaLag = 0;                    // the slip angle after the lag
    // the shape: the contact point is out of the plane of the wheel by rc sin(camber), the axle is at (R - rc) cos(camber) + rc above the road
    this.contactOffset = camber => this.rc * Math.sin(camber);
    this.axleHeight = camber => (this.R - this.rc) * Math.cos(camber) + this.rc;
    // the lateral force (N, towards the side the wheel leans to is positive) from the load and the slip angle and the camber, the pure slip
    this.fyPure = function (Fz, alpha, camber) {
        const x = alpha + self.camberRatio * camber * Math.sign(1);
        const D = self.mu * Fz, B = self.Calpha * Fz / (self.C * D);
        const bx = B * x;
        return D * Math.sin(self.C * Math.atan(bx - self.E * (bx - Math.atan(bx))));
    };
    // with a longitudinal force (driving or braking): the ellipse (the force that is left across)
    this.fy = function (Fz, alpha, camber, Fx) {
        const f = self.fyPure(Fz, alpha, camber), lim = self.mu * Fz;
        const share = Math.min(1, Math.abs(Fx || 0) / lim);
        return f * Math.sqrt(1 - share * share);
    };
    // one step of the lag: the force follows the slip angle over the relaxation length (the distance the tyre has rolled, so the lag is longer at a low speed in time)
    this.step = function (Fz, alpha, camber, Fx, speed, dt) {
        const rate = Math.max(Math.abs(speed), 0.5) / self.relax;
        self.alphaLag += (alpha - self.alphaLag) * (1 - Math.exp(-rate * dt));
        return self.fy(Fz, self.alphaLag, camber, Fx);
    };
}

// ---------------------------------------------------------------- 3. the rider: a PID on the lean, with the torque on the bars as the only output
function Rider(o) {
    o = o || {};
    this.kp = o.kp; this.kd = o.kd; this.ki = o.ki; this.kdelta = o.kdelta || 0;   // gains in Nm per rad, Nm s per rad, Nm per rad s, a steering damper
    this.sign = o.sign || 1; this.int = 0;
    this.torque = function (cmd, roll, rollRate, steerRate, dt) {
        const e = cmd - roll; this.int = Math.max(-40, Math.min(40, this.int + e * dt));
        // (the sign of the roll error is not chosen by hand: sign is tried both ways in the tests below, and only the one that holds the bike counts)
        return this.sign * (this.kp * e - this.kd * rollRate + this.ki * this.int) - this.kdelta * steerRate;
    };
}

// the time domain: RK4 on the linear model
function simulate(v, rider, cmdFn, T, dt) {
    const { A, B } = stateMatrix(v);
    let x = [0, 0, 0, 0]; const out = [];
    const f = (x, u) => A.map((row, i) => row[0] * x[0] + row[1] * x[1] + row[2] * x[2] + row[3] * x[3] + B[i] * u);
    for (let t = 0; t < T; t += dt) {
        const u = rider.torque(cmdFn(t), x[0], x[2], x[3], dt);
        const k1 = f(x, u), k2 = f(x.map((a, i) => a + dt / 2 * k1[i]), u), k3 = f(x.map((a, i) => a + dt / 2 * k2[i]), u), k4 = f(x.map((a, i) => a + dt * k3[i]), u);
        x = x.map((a, i) => a + dt / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
        out.push({ t, roll: x[0], steer: x[1], torque: u });
        if (Math.abs(x[0]) > 1.0) { out.diverged = true; break; }
    }
    return out;
}

// ---------------------------------------------------------------- the checks
const results = {}; let failed = 0;
function check(name, ok, detail) { results[name] = { ok, detail }; if (!ok) failed++; if (!process.argv.includes("--json")) console.log((ok ? "  ok     " : "  CHECK  ") + name + (detail ? "  (" + detail + ")" : "")); }
const log = s => { if (!process.argv.includes("--json")) console.log(s); };

// 1. the chassis
log("\n1. The chassis (Whipple, benchmark of Meijaard et al. 2007)");
{
    let lo = null, hi = null;
    for (let v = 0; v <= 10; v += 0.001) { const s = maxRe(v) < 0; if (s && lo === null) lo = v; if (!s && lo !== null && hi === null) hi = v; }
    check("self-stable from 4.292 m/s", lo !== null && Math.abs(lo - 4.292) < 0.02, "found " + (lo && lo.toFixed(3)));
    check("capsize unstable again from 6.024 m/s", hi !== null && Math.abs(hi - 6.024) < 0.02, "found " + (hi && hi.toFixed(3)));
    const e0 = eigenvalues(stateMatrix(0).A), e5 = eigenvalues(stateMatrix(5).A), e10 = eigenvalues(stateMatrix(10).A);
    check("at a standstill: an inverted pendulum (a real eigenvalue > 0)", e0[0].re > 1 && Math.abs(e0[0].im) < 1e-6, "lambda " + e0[0].re.toFixed(2));
    check("at 5 m/s: all four eigenvalues in the left half", e5[0].re < 0, "max Re " + e5[0].re.toFixed(3));
    const cap = e10.filter(e => Math.abs(e.im) < 1e-6)[0];
    check("at 10 m/s: a slow real capsize mode", !!cap && cap.re > 0 && cap.re < 3, cap ? "lambda " + cap.re.toFixed(2) + " per s (doubling in " + (Math.LN2 / cap.re).toFixed(2) + " s)" : "none");
    results.eigen5 = e5.map(e => e.re.toFixed(3) + (e.im ? (e.im > 0 ? "+" : "") + e.im.toFixed(3) + "i" : ""));
}

// 2. the tyre
log("\n2. The tyre (BikeTyre)");
{
    const t = new BikeTyre(), Fz = 1000;
    const camberOnly = t.fyPure(Fz, 0, 30 * DEG), need = Fz * Math.tan(30 * DEG);
    check("a tyre that leans 30 degrees pushes to that side with no slip", camberOnly > 0, (camberOnly / Fz).toFixed(2) + " of the load");
    const share = camberOnly / need;
    check("camber thrust at 30 degrees: a good share of the force of that bend, not all of it (0.85 in the controller)", share > 0.6 && share < 1.0, "share " + share.toFixed(2));
    const share45 = t.fyPure(Fz, 0, 45 * DEG) / (Fz * Math.tan(45 * DEG));
    check("it falls off with the lean (the friction limit), unlike the fixed 0.85", share45 < share, "45 deg: " + share45.toFixed(2));
    check("a flat tyre gives its force from the slip angle (cornering stiffness 8..20 per rad)", (() => { const k = t.fyPure(Fz, 0.01, 0) / Fz / 0.01; return k > 8 && k < 20; })(), "C_alpha " + (t.fyPure(Fz, 0.01, 0) / Fz / 0.01).toFixed(1));
    check("the peak is near mu x load", Math.abs(Math.max(...Array.from({ length: 200 }, (_, i) => t.fyPure(Fz, i * 0.004, 0))) / Fz - 1.1) < 0.1);
    check("the ellipse: with 80 % of the grip on the brake, 60 % is left across", Math.abs(t.fy(Fz, 0.3, 0, 0.8 * 1.1 * Fz) / t.fy(Fz, 0.3, 0, 0) - 0.6) < 0.02);
    check("the contact point leaves the plane of the wheel as rc sin(lean) (0.06 m at 30 degrees)", Math.abs(t.contactOffset(30 * DEG) - 0.06) < 0.001);
    // the lag: a step of the slip angle at 20 m/s; 63 % after one relaxation length of rolling
    const lag = new BikeTyre({ relax: 0.35 }); let tt = 0, f = 0; const ref = lag.fyPure(Fz, 0.03, 0);
    for (; tt < 1; tt += 0.0005) { f = lag.step(Fz, 0.03, 0, 0, 20, 0.0005); if (f >= 0.63 * ref) break; }
    check("the lag: 63 % of the force after one relaxation length of rolling (0.35 m)", Math.abs(tt * 20 - 0.35) < 0.05, (tt * 20).toFixed(2) + " m");
    // the steady bend: a bike of 200 kg at 20 m/s on a bend of 80 m: the lean and the slip angle that the tyres need
    const v = 20, Rb = 80, a = v * v / Rb, lean = Math.atan(a / G), m = 200, Fzb = m * G / 2, need2 = m * a / 2;
    let alpha = 0; for (let k = 0; k < 40; k++) alpha += (need2 / Math.cos(lean) - t.fyPure(Fzb, alpha, lean)) / (Fzb * t.Calpha);
    log("   bend 20 m/s, 80 m: lean " + (lean / DEG).toFixed(1) + " deg, camber alone gives " + (100 * t.fyPure(Fzb, 0, lean) / (need2 / Math.cos(lean))).toFixed(0) + " %, the slip angle for the rest " + (alpha / DEG).toFixed(2) + " deg");
    results.bend = { lean: lean / DEG, alphaDeg: alpha / DEG };
}

// 3. the rider
log("\n3. The rider (a torque on the bars, a PID on the lean error)");
{
    // the gains: tried by hand at 10, 20 and 40 m/s; the sign is the one that holds the bike
    const gains = v => ({ kp: 60 + 3 * v, kd: 12, ki: 25, kdelta: 0 });
    const cmd = t => (t < 1 ? 0 : Math.min(1, (t - 1) / 0.4)) * 0.2;          // a lean of 11.5 degrees, in 0.4 s, from t = 1 s
    let holdSign = 0;
    for (const sign of [1, -1]) {
        const ok = [10, 20, 40].every(v => { const r = simulate(v, new Rider(Object.assign(gains(v), { sign })), cmd, 6, 0.001); return !r.diverged && Math.abs(r[r.length - 1].roll - 0.2) < 0.02; });
        if (ok) holdSign = sign;
    }
    check("one sign of the torque holds the bike and takes it to the lean at 10, 20 and 40 m/s", holdSign !== 0, "sign " + holdSign);
    results.rider = {};
    for (const v of [5, 10, 20, 40]) {
        const r = simulate(v, new Rider(Object.assign(gains(v), { sign: holdSign || 1 })), cmd, 6, 0.001);
        let first = 0, peakRoll = 0, t90 = null, peak = 0;
        for (const s of r) { if (s.t > 1 && s.t < 1.4 && Math.abs(s.steer) > Math.abs(first)) first = s.steer; if (Math.abs(s.roll) > peakRoll) peakRoll = Math.abs(s.roll); if (t90 === null && s.t > 1 && s.roll > 0.18) t90 = s.t - 1; }
        const final = r[r.length - 1];
        // the first move of the bars while the lean is still under 10 % of the command: to the wrong side?
        let initial = 0; for (const s of r) if (s.t > 1 && s.roll < 0.02) { if (Math.abs(s.steer) > Math.abs(initial)) initial = s.steer; } else if (s.t > 1) break;
        log("   " + String(v).padStart(2) + " m/s: first steer " + (initial / DEG).toFixed(2) + " deg (" + (initial < 0 ? "countersteer" : "WITH the lean") + "), 90 % of the lean in " + (t90 === null ? "never" : t90.toFixed(2) + " s") + ", overshoot " + (100 * (peakRoll - 0.2) / 0.2).toFixed(0) + " %, steady steer " + (final.steer / DEG).toFixed(2) + " deg, end lean " + (final.roll / DEG).toFixed(1) + " deg" + (r.diverged ? "  DIVERGED" : ""));
        results.rider[v] = { initialSteerDeg: initial / DEG, t90, overshootPct: 100 * (peakRoll - 0.2) / 0.2, diverged: !!r.diverged };
        if (v >= 10) check("countersteer appears by itself at " + v + " m/s (the first move of the bars is away from the bend)", initial < 0 && !r.diverged);
    }
}

if (process.argv.includes("--json")) console.log(JSON.stringify(results, null, 1));
else console.log("\n" + (failed ? failed + " check(s) to look at" : "all checks ok") + "\n");
process.exit(failed ? 1 : 0);
