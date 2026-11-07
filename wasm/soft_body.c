/*
 * soft_body.c
 *
 * One small step of the shell of a car (web/js/SoftBody.js, the body of the loop of this.step after the contacts: the anchors, the beams, the integration, and
 * rigSolve for the nodes of the suspension) in C, for WebAssembly (MACOS-METAL.md, phase M3). As tyre_shell.c: the same code, line for line and in the same
 * order of the operations, so that it gives the same numbers to the last bit (doubles, no fused multiply-add).
 *
 * The arrays of the nodes are in the memory of the module (SoftBody.js makes its typed arrays on it). The beams are plain arrays in SoftBody.js (the debug view,
 * Parts.js and the editors read them): SoftBody.js copies them here before a step and takes their rest length and whether they are alive back after it.
 */

typedef unsigned char u8;

static inline double dsqrt(double x) { return __builtin_sqrt(x); }
static inline double dabs(double x) { return __builtin_fabs(x); }
static inline double dmax(double a, double b) { return a > b ? a : b; }
static inline double dmin(double a, double b) { return a < b ? a : b; }
static inline double dsign(double x) { return x > 0 ? 1.0 : (x < 0 ? -1.0 : x); }

enum {
    S_N, S_B, S_RIGCOUNT, S_RIGITERS, S_H, S_DT, S_HARD, S_ANCHORK, S_ANCHORDAMP, S_BEAMDAMP, S_MAXBEND, S_BREAKSTRAIN,
    /* in and out */
    S_ABSORBED, S_MOVED, S_MAXMOVE, S_MAXMOVE2,
    S_COUNT_OF_P
};
enum {
    B_REST, B_U, B_W, B_Q, B_F, B_MASS, B_ASCALE, B_AYIELD, B_ABREAK, B_AALIVE, B_GONE, B_ISRIG,
    B_RIGOLD, B_RIGLAMA, B_RIGNODES, B_REACTION,
    B_BA, B_BB, B_BREST, B_BMADE, B_BK, B_BYIELD, B_BBREAK, B_BALIVE, B_BRIG, B_RIGLAMB,
    B_COUNT_OF_A
};

static int N, B;
static double *rest, *u, *w, *q, *f, *mass, *aScale, *anchorYield, *anchorBreak, *rigOld, *rigLamA, *reaction, *beamRest, *beamMade, *beamK, *beamYield, *beamBreak, *rigLamB;
static u8 *anchorAlive, *gone, *isRig, *beamAlive, *beamRig;
static int *rigNodes, *beamA, *beamB;
static double anchorMaxBend, beamBreakStrain, absorbed;

static double room(int ix) { return dmax(0, anchorMaxBend - dsqrt(q[ix] * q[ix] + q[ix + 1] * q[ix + 1] + q[ix + 2] * q[ix + 2])); }
static int torn(int k, double kA, double stretch) { return kA * stretch > anchorBreak[k] && room(3 * k) > 1e-6; }
static int snapped(int i, double force) { return dabs(force) > beamBreak[i] || beamRest[i] - beamMade[i] > beamBreakStrain * beamMade[i]; }
static void loose(int k) {
    if (anchorAlive[k] || gone[k]) return;
    for (int i = 0; i < B; i++) if (beamAlive[i] && (beamA[i] == k ? !gone[beamB[i]] : beamB[i] == k && !gone[beamA[i]])) return;
    gone[k] = 1; w[3 * k] = w[3 * k + 1] = w[3 * k + 2] = 0;
}

__attribute__((export_name("soft_substep")))
void soft_substep(double *P, const int *A) {
    N = (int)P[S_N]; B = (int)P[S_B];
    const int rigCount = (int)P[S_RIGCOUNT], rigIters = (int)P[S_RIGITERS];
    const double h = P[S_H], dt = P[S_DT], hard = P[S_HARD], anchorK = P[S_ANCHORK], anchorDamping = P[S_ANCHORDAMP], beamDamping = P[S_BEAMDAMP];
    anchorMaxBend = P[S_MAXBEND]; beamBreakStrain = P[S_BREAKSTRAIN]; absorbed = P[S_ABSORBED];
    int moved = P[S_MOVED] != 0;
    double maxMove = P[S_MAXMOVE], maxMove2 = P[S_MAXMOVE2];
    rest = (double *)(long)A[B_REST]; u = (double *)(long)A[B_U]; w = (double *)(long)A[B_W]; q = (double *)(long)A[B_Q]; f = (double *)(long)A[B_F];
    mass = (double *)(long)A[B_MASS]; aScale = (double *)(long)A[B_ASCALE]; anchorYield = (double *)(long)A[B_AYIELD]; anchorBreak = (double *)(long)A[B_ABREAK];
    anchorAlive = (u8 *)(long)A[B_AALIVE]; gone = (u8 *)(long)A[B_GONE]; isRig = (u8 *)(long)A[B_ISRIG];
    rigOld = (double *)(long)A[B_RIGOLD]; rigLamA = (double *)(long)A[B_RIGLAMA]; rigNodes = (int *)(long)A[B_RIGNODES]; reaction = (double *)(long)A[B_REACTION];
    beamA = (int *)(long)A[B_BA]; beamB = (int *)(long)A[B_BB]; beamRest = (double *)(long)A[B_BREST]; beamMade = (double *)(long)A[B_BMADE]; beamK = (double *)(long)A[B_BK];
    beamYield = (double *)(long)A[B_BYIELD]; beamBreak = (double *)(long)A[B_BBREAK]; beamAlive = (u8 *)(long)A[B_BALIVE]; beamRig = (u8 *)(long)A[B_BRIG]; rigLamB = (double *)(long)A[B_RIGLAMB];

    /* the anchors */
    for (int k = 0; k < N; k++) {
        if (!anchorAlive[k] || isRig[k]) continue;
        int ix = 3 * k;
        double dx = u[ix], dy = u[ix + 1], dz = u[ix + 2];
        double d = dsqrt(dx * dx + dy * dy + dz * dz);
        double kA = anchorK * aScale[k];
        double yieldD = anchorYield[k] / kA;
        if (d > yieldD) {
            double excess = d - yieldD;
            double shift = dmin(excess * (1 - hard), room(ix));
            double sx = dx / d * shift, sy = dy / d * shift, sz = dz / d * shift;
            q[ix] += sx; q[ix + 1] += sy; q[ix + 2] += sz;
            u[ix] -= sx; u[ix + 1] -= sy; u[ix + 2] -= sz;
            absorbed += anchorYield[k] * shift;
            dx = u[ix]; dy = u[ix + 1]; dz = u[ix + 2];
            d = dsqrt(dx * dx + dy * dy + dz * dz);
            moved = 1;
        }
        if (d > maxMove) maxMove = d;
        double c = 2 * anchorDamping * dsqrt(kA * mass[k]);
        double fx = kA * dx + c * w[ix], fy = kA * dy + c * w[ix + 1], fz = kA * dz + c * w[ix + 2];
        if (torn(k, kA, d)) { anchorAlive[k] = 0; loose(k); moved = 1; continue; }
        f[ix] -= fx; f[ix + 1] -= fy; f[ix + 2] -= fz;
        double px = rest[ix] + u[ix] + q[ix], py = rest[ix + 1] + u[ix + 1] + q[ix + 1], pz = rest[ix + 2] + u[ix + 2] + q[ix + 2];
        reaction[0] += fx * h / dt; reaction[1] += fy * h / dt; reaction[2] += fz * h / dt;
        reaction[3] += (py * fz - pz * fy) * h / dt; reaction[4] += (pz * fx - px * fz) * h / dt; reaction[5] += (px * fy - py * fx) * h / dt;
    }
    /* the beams */
    for (int i = 0; i < B; i++) {
        if (!beamAlive[i] || beamRig[i] || gone[beamA[i]] || gone[beamB[i]]) continue;
        int a = beamA[i] * 3, b = beamB[i] * 3;
        double ex = rest[b] + u[b] + q[b] - rest[a] - u[a] - q[a], ey = rest[b + 1] + u[b + 1] + q[b + 1] - rest[a + 1] - u[a + 1] - q[a + 1], ez = rest[b + 2] + u[b + 2] + q[b + 2] - rest[a + 2] - u[a + 2] - q[a + 2];
        double len = dsqrt(ex * ex + ey * ey + ez * ez);
        if (len < 1e-6) continue;
        double nx = ex / len, ny = ey / len, nz = ez / len;
        double ext = len - beamRest[i];
        double force = beamK[i] * ext;
        if (dabs(force) > beamYield[i]) {
            double beyond = dabs(ext) - beamYield[i] / beamK[i];
            double change = dsign(ext) * beyond * (1 - hard);
            beamRest[i] += change;
            absorbed += beamYield[i] * dabs(change);
            ext = len - beamRest[i];
            force = beamK[i] * ext;
            moved = 1;
        }
        if (snapped(i, force)) { beamAlive[i] = 0; loose(beamA[i]); loose(beamB[i]); moved = 1; continue; }
        double rv = (w[b] - w[a]) * nx + (w[b + 1] - w[a + 1]) * ny + (w[b + 2] - w[a + 2]) * nz;
        double cb = 2 * beamDamping * dsqrt(beamK[i] * dmin(mass[beamA[i]], mass[beamB[i]]));
        double fb = force + cb * rv;
        f[a] += fb * nx; f[a + 1] += fb * ny; f[a + 2] += fb * nz;
        f[b] -= fb * nx; f[b + 1] -= fb * ny; f[b + 2] -= fb * nz;
    }
    /* integrate: semi-implicit Euler */
    for (int j = 0; j < N; j++) {
        if (gone[j]) { f[3 * j] = f[3 * j + 1] = f[3 * j + 2] = 0; continue; }
        int o = 3 * j;
        double im = 1 / mass[j];
        w[o] += f[o] * im * h; w[o + 1] += f[o + 1] * im * h; w[o + 2] += f[o + 2] * im * h;
        double speedSq = w[o] * w[o] + w[o + 1] * w[o + 1] + w[o + 2] * w[o + 2];
        if (speedSq > maxMove2) maxMove2 = speedSq;
        if (isRig[j]) { rigOld[o] = u[o]; rigOld[o + 1] = u[o + 1]; rigOld[o + 2] = u[o + 2]; }
        u[o] += w[o] * h; u[o + 1] += w[o + 1] * h; u[o + 2] += w[o + 2] * h;
        f[o] = 0; f[o + 1] = 0; f[o + 2] = 0;
    }
    /* rigSolve: the suspension, a position solver (XPBD) */
    if (rigCount) {
        double h2 = h * h, rigMaxMove = 0, rigMaxSpeed2 = 0;
        int rmoved = 0, i, k, it;
        for (i = 0; i < B; i++) rigLamB[i] = 0;
        for (i = 0; i < rigCount; i++) rigLamA[rigNodes[i]] = 0;
        for (it = 0; it < rigIters; it++) {
            for (i = 0; i < rigCount; i++) {
                k = rigNodes[i];
                if (!anchorAlive[k] || gone[k]) continue;
                int ix = 3 * k;
                double dx = u[ix], dy = u[ix + 1], dz = u[ix + 2];
                double d = dsqrt(dx * dx + dy * dy + dz * dz);
                if (d < 1e-12) continue;
                double alpha = 1 / (anchorK * aScale[k] * h2), wk = 1 / mass[k];
                double dl = (-d - alpha * rigLamA[k]) / (wk + alpha);
                rigLamA[k] += dl;
                double sc = wk * dl / d;
                u[ix] += dx * sc; u[ix + 1] += dy * sc; u[ix + 2] += dz * sc;
            }
            for (i = 0; i < B; i++) {
                if (!beamRig[i] || !beamAlive[i] || gone[beamA[i]] || gone[beamB[i]]) continue;
                int a = beamA[i] * 3, b = beamB[i] * 3;
                double ex = rest[b] + u[b] + q[b] - rest[a] - u[a] - q[a], ey = rest[b + 1] + u[b + 1] + q[b + 1] - rest[a + 1] - u[a + 1] - q[a + 1], ez = rest[b + 2] + u[b + 2] + q[b + 2] - rest[a + 2] - u[a + 2] - q[a + 2];
                double len = dsqrt(ex * ex + ey * ey + ez * ez);
                if (len < 1e-6) continue;
                double wa = 1 / mass[beamA[i]], wb = 1 / mass[beamB[i]];
                double al = 1 / (beamK[i] * h2);
                double dlb = (beamRest[i] - len - al * rigLamB[i]) / (wa + wb + al);
                rigLamB[i] += dlb;
                double cx = ex / len * dlb, cy = ey / len * dlb, cz = ez / len * dlb;
                u[a] -= wa * cx; u[a + 1] -= wa * cy; u[a + 2] -= wa * cz;
                u[b] += wb * cx; u[b + 1] += wb * cy; u[b + 2] += wb * cz;
            }
        }
        for (i = 0; i < rigCount; i++) {
            k = rigNodes[i];
            if (gone[k]) continue;
            int o = 3 * k;
            w[o] = (u[o] - rigOld[o]) / h; w[o + 1] = (u[o + 1] - rigOld[o + 1]) / h; w[o + 2] = (u[o + 2] - rigOld[o + 2]) / h;
        }
        for (i = 0; i < B; i++) {
            if (!beamRig[i] || !beamAlive[i] || gone[beamA[i]] || gone[beamB[i]]) continue;
            int a2 = beamA[i] * 3, b2 = beamB[i] * 3;
            double fx = rest[b2] + u[b2] + q[b2] - rest[a2] - u[a2] - q[a2], fy = rest[b2 + 1] + u[b2 + 1] + q[b2 + 1] - rest[a2 + 1] - u[a2 + 1] - q[a2 + 1], fz = rest[b2 + 2] + u[b2 + 2] + q[b2 + 2] - rest[a2 + 2] - u[a2 + 2] - q[a2 + 2];
            double l2 = dsqrt(fx * fx + fy * fy + fz * fz);
            if (l2 < 1e-6) continue;
            double nx = fx / l2, ny = fy / l2, nz = fz / l2;
            double ma = mass[beamA[i]], mb = mass[beamB[i]], wsum = 1 / ma + 1 / mb;
            double rv = (w[b2] - w[a2]) * nx + (w[b2 + 1] - w[a2 + 1]) * ny + (w[b2 + 2] - w[a2 + 2]) * nz;
            double cb = 2 * beamDamping * dsqrt(beamK[i] * dmin(ma, mb));
            double imp = rv * cb * h / (1 + cb * h * wsum);
            w[a2] += imp / ma * nx; w[a2 + 1] += imp / ma * ny; w[a2 + 2] += imp / ma * nz;
            w[b2] -= imp / mb * nx; w[b2 + 1] -= imp / mb * ny; w[b2 + 2] -= imp / mb * nz;
            double ext = l2 - beamRest[i], force = beamK[i] * ext;
            if (dabs(force) > beamYield[i]) {
                double beyond = dabs(ext) - beamYield[i] / beamK[i];
                double change = dsign(ext) * beyond * (1 - hard);
                beamRest[i] += change;
                absorbed += beamYield[i] * dabs(change);
                ext = l2 - beamRest[i]; force = beamK[i] * ext;
                rmoved = 1;
            }
            if (snapped(i, force)) { beamAlive[i] = 0; loose(beamA[i]); loose(beamB[i]); rmoved = 1; }
        }
        for (i = 0; i < rigCount; i++) {
            k = rigNodes[i];
            if (!anchorAlive[k] || gone[k]) { if (!gone[k]) { int s0 = 3 * k; double sp = w[s0] * w[s0] + w[s0 + 1] * w[s0 + 1] + w[s0 + 2] * w[s0 + 2]; if (sp > rigMaxSpeed2) rigMaxSpeed2 = sp; } continue; }
            int ix2 = 3 * k;
            double kA = anchorK * aScale[k];
            double c = 2 * anchorDamping * dsqrt(kA * mass[k]);
            double damp = 1 / (1 + c * h / mass[k]);
            w[ix2] *= damp; w[ix2 + 1] *= damp; w[ix2 + 2] *= damp;
            double ddx = u[ix2], ddy = u[ix2 + 1], ddz = u[ix2 + 2];
            double dd = dsqrt(ddx * ddx + ddy * ddy + ddz * ddz);
            double yieldD = anchorYield[k] / kA;
            if (dd > yieldD) {
                double shift = dmin((dd - yieldD) * (1 - hard), room(ix2));
                double sx = ddx / dd * shift, sy = ddy / dd * shift, sz = ddz / dd * shift;
                q[ix2] += sx; q[ix2 + 1] += sy; q[ix2 + 2] += sz;
                u[ix2] -= sx; u[ix2 + 1] -= sy; u[ix2 + 2] -= sz;
                absorbed += anchorYield[k] * shift;
                ddx = u[ix2]; ddy = u[ix2 + 1]; ddz = u[ix2 + 2];
                dd = dsqrt(ddx * ddx + ddy * ddy + ddz * ddz);
                rmoved = 1;
            }
            if (dd > rigMaxMove) rigMaxMove = dd;
            double sp2 = w[ix2] * w[ix2] + w[ix2 + 1] * w[ix2 + 1] + w[ix2 + 2] * w[ix2 + 2];
            if (sp2 > rigMaxSpeed2) rigMaxSpeed2 = sp2;
            if (torn(k, kA, dd)) { anchorAlive[k] = 0; loose(k); rmoved = 1; continue; }
            double gx = kA * ddx + c * w[ix2], gy = kA * ddy + c * w[ix2 + 1], gz = kA * ddz + c * w[ix2 + 2];
            double px = rest[ix2] + u[ix2] + q[ix2], py = rest[ix2 + 1] + u[ix2 + 1] + q[ix2 + 1], pz = rest[ix2 + 2] + u[ix2 + 2] + q[ix2 + 2];
            reaction[0] += gx * h / dt; reaction[1] += gy * h / dt; reaction[2] += gz * h / dt;
            reaction[3] += (py * gz - pz * gy) * h / dt; reaction[4] += (pz * gx - px * gz) * h / dt; reaction[5] += (px * gy - py * gx) * h / dt;
        }
        if (rmoved) moved = 1;
        if (rigMaxMove > maxMove) maxMove = rigMaxMove;
        if (rigMaxSpeed2 > maxMove2) maxMove2 = rigMaxSpeed2;
    }
    P[S_ABSORBED] = absorbed; P[S_MOVED] = moved; P[S_MAXMOVE] = maxMove; P[S_MAXMOVE2] = maxMove2;
}
