/*
 * tyre_shell.c
 *
 * The substeps of the shell tyre (web/js/TyreShell.js, the loop "the steps" of this.step) in C, for WebAssembly (MACOS-METAL.md, phase M3).
 * It is the same code as the JavaScript, line for line and in the same order of the operations, so that it gives the same numbers to the last bit:
 *   - every number is a double, as in JavaScript; the arrays of 32 bits (Float32Array in TyreShell.js) are float here, and are read and written the same way;
 *   - no fused multiply-add (-ffp-contract=off) and no -ffast-math;
 *   - sin, cos and exp are those of JavaScript (Math.sin, Math.cos, Math.exp), imported, since a libm of our own rounds differently in the last bit.
 * The arrays of the tyre are in the memory of the module (TyreShell.js makes its typed arrays on it), so nothing is copied for a step. What the loop needs
 * besides the arrays comes in a block of doubles (P_*) and a block of offsets (A_*), both written by TyreShell.js before the call.
 *
 * Build: wasm/build.sh (clang for wasm32 and wasm-ld of LLVM) -> web/js/wasm/tyre_shell.wasm
 */

typedef unsigned char u8;

extern double js_sin(double) __attribute__((import_module("env"), import_name("sin")));
extern double js_cos(double) __attribute__((import_module("env"), import_name("cos")));
extern double js_exp(double) __attribute__((import_module("env"), import_name("exp")));

static inline double dsqrt(double x) { return __builtin_sqrt(x); }
static inline double dabs(double x) { return __builtin_fabs(x); }
/* Math.max and Math.min of JavaScript for numbers that are not NaN (the loop has no NaN in them; a NaN in the shell is caught after the step) */
static inline double dmax(double a, double b) { return a > b ? a : b; }
static inline double dmin(double a, double b) { return a < b ? a : b; }
static inline double dsign(double x) { return x > 0 ? 1.0 : (x < 0 ? -1.0 : x); }
/* x || 1 of JavaScript, for a length: 0 or NaN gives 1 */
static inline double orOne(double x) { return (x != 0 && x == x) ? x : 1.0; }

/* the scalars (doubles) */
enum {
    P_N, P_RINGS, P_SEGS, P_BEAMS, P_STEPS, P_DT, P_H, P_MN, P_PA, P_R, P_SPACING, P_TOL,
    P_KSHEART, P_KSHEARL, P_CSHEART, P_CSHEARL, P_KG, P_KSTOP, P_ZETA,
    P_CLASSK0, P_CLASSK1, P_CLASSK2, P_CLASSK3, P_CLASSK4,
    P_HUBX, P_HUBY, P_HUBZ, P_VELX, P_VELY, P_VELZ, P_LX, P_LY, P_LZ, P_FX, P_FY, P_FZ, P_UX, P_UY, P_UZ,
    P_OMEGA, P_PHASE, P_INERTIA, P_LOADPREV, P_SURFMU, P_SURFSLIDING, P_LATGRIP,
    P_BELT2, P_ROADDAMP, P_ROADSTOP, P_STIFFX, P_STIFFY, P_STRIBECK, P_BRISTLEDAMP, P_IMPLICIT, P_THETA, P_LOCKED,
    P_HALFPATCH, P_SAMPLES,
    /* out */
    P_HUBACC0, P_HUBACC1, P_HUBACC2, P_HUBACC3, P_OMS, P_OMSUM, P_COUNT, P_SUMFN, P_SLIDELOAD, P_MAXDEPTH,
    P_CXS, P_CYS, P_CZS, P_NXS, P_NYS, P_NZS, P_MINF, P_MAXF, P_BESTFN, P_BESTTRI, P_ALONGSUM, P_DAMPED, P_GTESTS,
    P_COUNT_OF_P
};

/* the arrays (byte offsets in the memory) */
enum {
    A_PX, A_PY, A_PZ, A_VX, A_VY, A_VZ, A_FX, A_FY, A_FZ, A_IX, A_IY, A_IZ, A_IVX, A_IVY, A_IVZ,
    A_OX, A_OY, A_OZ, A_OVX, A_OVY, A_OVZ, A_TX, A_TY, A_TZ, A_NX, A_NY, A_NZ,
    A_T1X, A_T1Y, A_T1Z, A_T2X, A_T2Y, A_T2Z, A_BX, A_BY, A_BZ, A_KXX, A_KXY, A_KXZ, A_KYY, A_KYZ, A_KZZ,
    A_EFN, A_ENX, A_ENY, A_ENZ,
    A_NEARNODE, A_HOLD, A_INCONTACT, A_SLIDING,                  /* u8 */
    A_FNNODE, A_CNX, A_CNY, A_CNZ, A_UXB, A_UYB,                  /* float */
    A_CTRI,                                                      /* int */
    A_NODELAT, A_NODERAD, A_INNERLAT, A_INNERRAD,                /* float, per ring */
    A_BA, A_BB, A_BL0, A_BLMIN, A_BCLASS, A_BKIND, A_BSTRAIN, A_BK, A_BDX, A_BDY, A_BDZ,
    A_LISTOFF, A_LISTIDX,                                        /* int: the triangles near each node, nodeList of TyreShell.js flattened */
    A_GBOX, A_GTRI,                                              /* float: the boxes and the data of the triangles of the ground */
    A_COUNT_OF_A
};

#define D(name) double *name = (double *)(long)A[A_##name]
#define F(name) float *name = (float *)(long)A[A_##name]
#define U(name) u8 *name = (u8 *)(long)A[A_##name]
#define I(name) int *name = (int *)(long)A[A_##name]

/* the state of contactAt, as the variables of the closure in TyreShell.js */
static double cDepth, cNx, cNy, cNz;
static int cTri;
static double gTests;

/* Ground.closest of a GroundWorld: the point of triangle t nearest to p, and its region (0 inside, 1 an edge, 2 a corner); gives the squared distance */
static double closest(const float *tri, int t, double px, double py, double pz, double *nx_, double *ny_, double *nz_, int *region_) {
    const float *o = tri + t * 12;
    double ax = o[0], ay = o[1], az = o[2];
    double abx = o[3], aby = o[4], abz = o[5], acx = o[6], acy = o[7], acz = o[8];
    double apx = px - ax, apy = py - ay, apz = pz - az;
    double d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
    double rx, ry, rz; int region = 2;
    if (d1 <= 0 && d2 <= 0) { rx = ax; ry = ay; rz = az; }
    else {
        double bpx = apx - abx, bpy = apy - aby, bpz = apz - abz;
        double d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
        if (d3 >= 0 && d4 <= d3) { rx = ax + abx; ry = ay + aby; rz = az + abz; }
        else {
            double vc = d1 * d4 - d3 * d2;
            if (vc <= 0 && d1 >= 0 && d3 <= 0) { double vv = d1 / (d1 - d3); rx = ax + abx * vv; ry = ay + aby * vv; rz = az + abz * vv; region = 1; }
            else {
                double cpx = apx - acx, cpy = apy - acy, cpz = apz - acz;
                double d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
                if (d6 >= 0 && d5 <= d6) { rx = ax + acx; ry = ay + acy; rz = az + acz; }
                else {
                    double vb = d5 * d2 - d1 * d6;
                    if (vb <= 0 && d2 >= 0 && d6 <= 0) { double ww = d2 / (d2 - d6); rx = ax + acx * ww; ry = ay + acy * ww; rz = az + acz * ww; region = 1; }
                    else {
                        double va = d3 * d6 - d5 * d4;
                        if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
                            double w2 = (d4 - d3) / ((d4 - d3) + (d5 - d6));
                            rx = ax + abx + (acx - abx) * w2; ry = ay + aby + (acy - aby) * w2; rz = az + abz + (acz - abz) * w2; region = 1;
                        } else {
                            double denom = 1 / (va + vb + vc), v2 = vb * denom, w3 = vc * denom;
                            rx = ax + abx * v2 + acx * w3; ry = ay + aby * v2 + acy * w3; rz = az + abz * v2 + acz * w3; region = 0;
                        }
                    }
                }
            }
        }
    }
    *nx_ = rx; *ny_ = ry; *nz_ = rz; *region_ = region;
    double dx = px - rx, dy = py - ry, dz = pz - rz;
    return dx * dx + dy * dy + dz * dz;
}

static int boxNear(const float *box, int t, double cx, double cy, double cz, double r) {
    gTests++;
    int b = t * 6;
    return !(box[b] > cx + r || box[b + 3] < cx - r || box[b + 1] > cy + r || box[b + 4] < cy - r || box[b + 2] > cz + r || box[b + 5] < cz - r);
}

/* contactAt of TyreShell.js: the deepest contact of a place with the triangles of a list */
static int contactAt(const float *box, const float *tri, double x, double y, double z, double hubx, double huby, double hubz,
                     const int *list, int count, double tol, double upx, double upy, double upz) {
    cDepth = 0; cTri = -1;
    for (int q = 0; q < count; q++) {
        int t = list[q];
        if (!boxNear(box, t, x, y, z, tol + 0.06)) continue;
        double nearx, neary, nearz; int region;
        double d2 = closest(tri, t, x, y, z, &nearx, &neary, &nearz, &region), dist = dsqrt(d2), mx, my, mz, dd;
        const float *o = tri + t * 12;
        double tnx = o[9], tny = o[10], tnz = o[11];
        if (region == 0) {
            double upN = upx * tnx + upy * tny + upz * tnz, sgn;
            if (dabs(upN) > 0.3) sgn = upN >= 0 ? 1 : -1;
            else { double sideHub = (hubx - nearx) * tnx + (huby - neary) * tny + (hubz - nearz) * tnz; sgn = sideHub >= 0 ? 1 : -1; }
            mx = tnx * sgn; my = tny * sgn; mz = tnz * sgn;
            dd = tol - ((x - nearx) * mx + (y - neary) * my + (z - nearz) * mz);
        } else {
            if (dist > tol || dist < 1e-6) continue;
            mx = (x - nearx) / dist; my = (y - neary) / dist; mz = (z - nearz) / dist;
            if (dabs(mx * tnx + my * tny + mz * tnz) < 0.85) continue;
            dd = tol - dist;
        }
        if (dd > cDepth) { cDepth = dd; cTri = t; cNx = mx; cNy = my; cNz = mz; }
    }
    return cTri >= 0;
}

/* the memory of the module for TyreShell.js: a simple heap after the data of C (JavaScript keeps the free blocks) */
extern unsigned char __heap_base;
__attribute__((export_name("heap_base"))) long heap_base(void) { return (long)&__heap_base; }

__attribute__((export_name("tyre_substeps")))
void tyre_substeps(double *P, const long *A) {
    const int N = (int)P[P_N], rings = (int)P[P_RINGS], segs = (int)P[P_SEGS], beamCount = (int)P[P_BEAMS], n = (int)P[P_STEPS];
    const double dt = P[P_DT], h = P[P_H], mn = P[P_MN], pA = P[P_PA], R = P[P_R], spacing = P[P_SPACING], tol = P[P_TOL];
    const double kShearT = P[P_KSHEART], kShearL = P[P_KSHEARL], cShearT = P[P_CSHEART], cShearL = P[P_CSHEARL], kg = P[P_KG], kStop = P[P_KSTOP], zeta = P[P_ZETA];
    const double classK[5] = { P[P_CLASSK0], P[P_CLASSK1], P[P_CLASSK2], P[P_CLASSK3], P[P_CLASSK4] };
    const double hubx = P[P_HUBX], huby = P[P_HUBY], hubz = P[P_HUBZ], velx = P[P_VELX], vely = P[P_VELY], velz = P[P_VELZ];
    const double Lx = P[P_LX], Ly = P[P_LY], Lz = P[P_LZ], Fdx = P[P_FX], Fdy = P[P_FY], Fdz = P[P_FZ], Ux = P[P_UX], Uy = P[P_UY], Uz = P[P_UZ];
    const double inertiaW = P[P_INERTIA], loadPrev = P[P_LOADPREV], surfMu = P[P_SURFMU], surfSliding = P[P_SURFSLIDING], lateralGrip = P[P_LATGRIP];
    const int beltTwoSided = P[P_BELT2] != 0, implicit = P[P_IMPLICIT] != 0, lockedSpin = P[P_LOCKED] != 0;
    const double roadDamping = P[P_ROADDAMP], roadStop = P[P_ROADSTOP], stiffX = P[P_STIFFX], stiffY = P[P_STIFFY], stribeck = P[P_STRIBECK], bristleDamping = P[P_BRISTLEDAMP], theta = P[P_THETA];
    double halfPatch = P[P_HALFPATCH];
    const int contactSamples = (int)P[P_SAMPLES];
    D(PX); D(PY); D(PZ); D(VX); D(VY); D(VZ); D(FX); D(FY); D(FZ); D(IX); D(IY); D(IZ); D(IVX); D(IVY); D(IVZ);
    D(OX); D(OY); D(OZ); D(OVX); D(OVY); D(OVZ); D(TX); D(TY); D(TZ); D(NX); D(NY); D(NZ);
    D(T1X); D(T1Y); D(T1Z); D(T2X); D(T2Y); D(T2Z); D(BX); D(BY); D(BZ); D(KXX); D(KXY); D(KXZ); D(KYY); D(KYZ); D(KZZ);
    D(EFN); D(ENX); D(ENY); D(ENZ);
    U(NEARNODE); U(HOLD); U(INCONTACT); U(SLIDING);
    F(FNNODE); F(CNX); F(CNY); F(CNZ); F(UXB); F(UYB);
    I(CTRI);
    F(NODELAT); F(NODERAD); F(INNERLAT); F(INNERRAD);
    I(BA); I(BB); D(BL0); D(BLMIN); U(BCLASS); U(BKIND); F(BSTRAIN); D(BK); D(BDX); D(BDY); D(BDZ);
    I(LISTOFF); I(LISTIDX);
    F(GBOX); F(GTRI);
    double *Px = PX, *Py = PY, *Pz = PZ, *Vx = VX, *Vy = VY, *Vz = VZ, *Fx = FX, *Fy = FY, *Fz = FZ, *Ix = IX, *Iy = IY, *Iz = IZ, *IVx = IVX, *IVy = IVY, *IVz = IVZ;
    double *Ox = OX, *Oy = OY, *Oz = OZ, *OVx = OVX, *OVy = OVY, *OVz = OVZ, *Tx = TX, *Ty = TY, *Tz = TZ, *Nx = NX, *Ny = NY, *Nz = NZ;
    double *t1xA = T1X, *t1yA = T1Y, *t1zA = T1Z, *t2xA = T2X, *t2yA = T2Y, *t2zA = T2Z, *Bx = BX, *By = BY, *Bz = BZ;
    double *Kxx = KXX, *Kxy = KXY, *Kxz = KXZ, *Kyy = KYY, *Kyz = KYZ, *Kzz = KZZ, *eFn = EFN, *eNx = ENX, *eNy = ENY, *eNz = ENZ;
    u8 *nearNode = NEARNODE, *holdA = HOLD, *inContact = INCONTACT, *sliding = SLIDING;
    float *fnNode = FNNODE, *cnx = CNX, *cny = CNY, *cnz = CNZ, *ux = UXB, *uy = UYB, *nodeLat = NODELAT, *nodeRad = NODERAD, *innerLat = INNERLAT, *innerRad = INNERRAD, *bStrain = BSTRAIN;
    int *ctri = CTRI, *bA = BA, *bB = BB, *listOff = LISTOFF, *listIdx = LISTIDX;
    double *bL0 = BL0, *bLmin = BLMIN, *bK = BK, *bDx = BDX, *bDy = BDY, *bDz = BDZ;
    u8 *bClass = BCLASS, *bKind = BKIND;
    const float *gBox = GBOX, *gTri = GTRI;

    double hubAcc0 = P[P_HUBACC0], hubAcc1 = P[P_HUBACC1], hubAcc2 = P[P_HUBACC2], hubAcc3 = P[P_HUBACC3];
    double hcx = hubx, hcy = huby, hcz = hubz;
#define RIMFORCE(i, fx, fy, fz) do { double fx_ = (fx), fy_ = (fy), fz_ = (fz); \
        hubAcc0 += fx_; hubAcc1 += fy_; hubAcc2 += fz_; \
        double rx_ = Ix[i] - hcx, ry_ = Iy[i] - hcy, rz_ = Iz[i] - hcz; \
        hubAcc3 += Lx * (ry_ * fz_ - rz_ * fy_) + Ly * (rz_ * fx_ - rx_ * fz_) + Lz * (rx_ * fy_ - ry_ * fx_); } while (0)
#define ADDK(i, k, dx, dy, dz) do { double k_ = (k), dx_ = (dx), dy_ = (dy), dz_ = (dz); \
        Kxx[i] += k_ * dx_ * dx_; Kxy[i] += k_ * dx_ * dy_; Kxz[i] += k_ * dx_ * dz_; Kyy[i] += k_ * dy_ * dy_; Kyz[i] += k_ * dy_ * dz_; Kzz[i] += k_ * dz_ * dz_; } while (0)
#define ADDKV(i, k, dx, dy, dz, vax, vay, vaz) do { double k_ = (k), dx_ = (dx), dy_ = (dy), dz_ = (dz); \
        Kxx[i] += k_ * dx_ * dx_; Kxy[i] += k_ * dx_ * dy_; Kxz[i] += k_ * dx_ * dz_; Kyy[i] += k_ * dy_ * dy_; Kyz[i] += k_ * dy_ * dz_; Kzz[i] += k_ * dz_ * dz_; \
        double kv_ = k_ * ((vax) * dx_ + (vay) * dy_ + (vaz) * dz_); Bx[i] += kv_ * dx_; By[i] += kv_ * dy_; Bz[i] += kv_ * dz_; } while (0)

    double beamDamp[5], beamDampHalf[5];
    double omS = P[P_OMEGA], omSum = 0, phS = P[P_PHASE] - 0.5 * P[P_OMEGA] * dt;
    double alongSum = 0, damped = 0;
    double maxDepth = 0, count = 0, sumFn = 0, slideLoad = 0, cxs = 0, cys = 0, czs = 0, nxs = 0, nys = 0, nzs = 0, minF = 1e9, maxF = -1e9, bestFn = 0;
    int bestTri = -1;
    gTests = P[P_GTESTS];          /* (the tests of the boxes so far in this step, by TyreShell.js) */
    const double PI2 = 2 * 3.141592653589793;

    for (int s = 0; s < n; s++) {
        double tc = h * (s + 1) - 0.5 * dt, tq0 = hubAcc3;
        phS += omS * h;
        hcx = hubx + velx * tc; hcy = huby + vely * tc; hcz = hubz + velz * tc;
        /* placeShells(hcx, hcy, hcz, L, F, U, phS, omS, vel) */
        for (int k = 0; k < segs; k++) {
            double a = phS + PI2 * k / segs, sn = js_sin(a), c = js_cos(a);
            for (int j = 0; j < rings; j++) {
                int i = j * segs + k;
                double ro = nodeRad[j], lo = nodeLat[j];
                Tx[i] = Fdx * c - Ux * sn; Ty[i] = Fdy * c - Uy * sn; Tz[i] = Fdz * c - Uz * sn;
                Ox[i] = hcx + Lx * lo + Fdx * sn * ro + Ux * c * ro; Oy[i] = hcy + Ly * lo + Fdy * sn * ro + Uy * c * ro; Oz[i] = hcz + Lz * lo + Fdz * sn * ro + Uz * c * ro;
                double orx = Lx * lo + Fdx * sn * ro + Ux * c * ro, ory = Ly * lo + Fdy * sn * ro + Uy * c * ro, orz = Lz * lo + Fdz * sn * ro + Uz * c * ro;
                OVx[i] = velx + omS * (Ly * orz - Lz * ory); OVy[i] = vely + omS * (Lz * orx - Lx * orz); OVz[i] = velz + omS * (Lx * ory - Ly * orx);
                double ri = innerRad[j], li = innerLat[j];
                double rx = Lx * li + Fdx * sn * ri + Ux * c * ri, ry = Ly * li + Fdy * sn * ri + Uy * c * ri, rz = Lz * li + Fdz * sn * ri + Uz * c * ri;
                Ix[i] = hcx + rx; Iy[i] = hcy + ry; Iz[i] = hcz + rz;
                IVx[i] = velx + omS * (Ly * rz - Lz * ry); IVy[i] = vely + omS * (Lz * rx - Lx * rz); IVz[i] = velz + omS * (Lx * ry - Ly * rx);
            }
        }
        /* shellNormals */
        for (int i = 0; i < N; i++) {
            double nx = Px[i] - Ix[i], ny = Py[i] - Iy[i], nz = Pz[i] - Iz[i], l = orOne(dsqrt(nx * nx + ny * ny + nz * nz));
            Nx[i] = nx / l; Ny[i] = ny / l; Nz[i] = nz / l;
        }
        for (int i = 0; i < N; i++) { Fx[i] = Fy[i] = Fz[i] = 0; Kxx[i] = Kxy[i] = Kxz[i] = Kyy[i] = Kyz[i] = Kzz[i] = 0; Bx[i] = By[i] = Bz[i] = 0; holdA[i] = 0; }
        /* the pressure */
        for (int ip = 0; ip < N; ip++) {
            double fx = pA * Nx[ip], fy = pA * Ny[ip], fz = pA * Nz[ip];
            Fx[ip] += fx; Fy[ip] += fy; Fz[ip] += fz;
            RIMFORCE(ip, -fx, -fy, -fz);
        }
        /* the beams */
        for (int dcl = 0; dcl < 5; dcl++) { beamDamp[dcl] = zeta * 2 * dsqrt(classK[dcl] * mn); beamDampHalf[dcl] = zeta * 2 * dsqrt(classK[dcl] * mn * 0.5); }
        for (int b = 0; b < beamCount; b++) {
            int a = bA[b], c = bB[b], bInner = c >= N;
            double ax, ay, az, avx, avy, avz, bx, by, bz, bvx, bvy, bvz;
            ax = Px[a]; ay = Py[a]; az = Pz[a]; avx = Vx[a]; avy = Vy[a]; avz = Vz[a];
            if (bInner) { int ci = c - N; bx = Ix[ci]; by = Iy[ci]; bz = Iz[ci]; bvx = IVx[ci]; bvy = IVy[ci]; bvz = IVz[ci]; }
            else { bx = Px[c]; by = Py[c]; bz = Pz[c]; bvx = Vx[c]; bvy = Vy[c]; bvz = Vz[c]; }
            double dx = bx - ax, dy = by - ay, dz = bz - az, len = dsqrt(dx * dx + dy * dy + dz * dz);
            if (len < 1e-9) continue;
            dx /= len; dy /= len; dz /= len;
            double k = classK[bClass[b]], L0 = bL0[b], force = 0;
            int kind = bKind[b];
            double vr = (bvx - avx) * dx + (bvy - avy) * dy + (bvz - avz) * dz;
            if (kind == 2) {
                double cfPull = 0;
                if (!inContact[a] && omS * omS > 1) { double crx = Ox[a] - hcx, cry = Oy[a] - hcy, crz = Oz[a] - hcz, cax = crx * Lx + cry * Ly + crz * Lz; crx -= cax * Lx; cry -= cax * Ly; crz -= cax * Lz; cfPull = mn * omS * omS * dsqrt(crx * crx + cry * cry + crz * crz); }
                double lSlack = L0 - (pA + cfPull) / k, spring = 0;
                bK[b] = 0;
                if (len > lSlack) { spring = k * (len - lSlack); ADDKV(a, k, dx, dy, dz, bvx, bvy, bvz); bK[b] = k; }
                else if (len < bLmin[b]) { spring = -kStop * (bLmin[b] - len); ADDKV(a, kStop, dx, dy, dz, bvx, bvy, bvz); bK[b] = kStop; }
                bDx[b] = dx; bDy[b] = dy; bDz[b] = dz;
                force = spring + beamDamp[bClass[b]] * vr;
                bStrain[b] = (float)((len - L0) / L0);
            } else if (kind == 0) {
                double s0 = len - L0;
                if (s0 > 0 || beltTwoSided) force = k * s0 + beamDamp[bClass[b]] * vr; else force = 0;
                if (force < 0 && !beltTwoSided) force = 0;
                bStrain[b] = (float)(s0 / L0);
            } else {
                force = k * (len - L0) + beamDampHalf[bClass[b]] * vr;
                bStrain[b] = (float)((len - L0) / L0);
            }
            double gx = force * dx, gy = force * dy, gz = force * dz;
            Fx[a] += gx; Fy[a] += gy; Fz[a] += gz;
            if (bInner) RIMFORCE(c - N, -gx, -gy, -gz);
            else { Fx[c] -= gx; Fy[c] -= gy; Fz[c] -= gz; }
        }
        /* the shear of the tread against the rim */
        for (int is2 = 0; is2 < N; is2++) {
            double ex = Px[is2] - Ox[is2], ey = Py[is2] - Oy[is2], ez = Pz[is2] - Oz[is2];
            double dT = ex * Tx[is2] + ey * Ty[is2] + ez * Tz[is2], dL = ex * Lx + ey * Ly + ez * Lz;
            double rvx = Vx[is2] - OVx[is2], rvy = Vy[is2] - OVy[is2], rvz = Vz[is2] - OVz[is2];
            double vT = rvx * Tx[is2] + rvy * Ty[is2] + rvz * Tz[is2], vL = rvx * Lx + rvy * Ly + rvz * Lz;
            double fT = -(kShearT * dT + cShearT * vT), fL = -(kShearL * dL + cShearL * vL);
            ADDKV(is2, kShearT, Tx[is2], Ty[is2], Tz[is2], OVx[is2], OVy[is2], OVz[is2]); ADDKV(is2, kShearL, Lx, Ly, Lz, OVx[is2], OVy[is2], OVz[is2]);
            double sx = fT * Tx[is2] + fL * Lx, sy = fT * Ty[is2] + fL * Ly, sz = fT * Tz[is2] + fL * Lz;
            Fx[is2] += sx; Fy[is2] += sy; Fz[is2] += sz;
            RIMFORCE(is2, -sx, -sy, -sz);
        }
        /* the road on the nodes */
        count = 0; sumFn = 0; slideLoad = 0; maxDepth = 0; cxs = cys = czs = nxs = nys = nzs = 0; minF = 1e9; maxF = -1e9; bestFn = 0; bestTri = -1; alongSum = 0;
        double load = dmax(loadPrev, 1), springX = stiffX * load / halfPatch; (void)springX;
        int S = (int)dmax(contactSamples, dmin(24, __builtin_ceil(72.0 / segs)));
        double kgS = kg / S, mS = mn / S;
        for (int ie = 0; ie < N; ie++) { eFn[ie] = 0; eNx[ie] = eNy[ie] = eNz[ie] = 0; }
        for (int jr = 0; jr < rings; jr++) for (int kq = 0; kq < segs; kq++) {
            int na = jr * segs + kq, nb2 = jr * segs + (kq + 1) % segs;
            if (!nearNode[na] && !nearNode[nb2]) continue;
            double oax = Ox[na] - hcx, oay = Oy[na] - hcy, oaz = Oz[na] - hcz, obx = Ox[nb2] - hcx, oby = Oy[nb2] - hcy, obz = Oz[nb2] - hcz;
            double ringR = dsqrt(oax * oax + oay * oay + oaz * oaz);
            int ln = nearNode[na] ? na : nb2;
            const int *list = listIdx + listOff[ln]; int listCount = listOff[ln + 1] - listOff[ln];
            for (int m = 1; m < S; m++) {
                double tt = (double)m / S, qx = Px[na] + (Px[nb2] - Px[na]) * tt, qy = Py[na] + (Py[nb2] - Py[na]) * tt, qz = Pz[na] + (Pz[nb2] - Pz[na]) * tt;
                double lx = oax + (obx - oax) * tt, ly = oay + (oby - oay) * tt, lz = oaz + (obz - oaz) * tt, ll = orOne(dsqrt(lx * lx + ly * ly + lz * lz)), bul = ringR / ll - 1;
                qx += lx * bul; qy += ly * bul; qz += lz * bul;
                if (!contactAt(gBox, gTri, qx, qy, qz, hubx, huby, hubz, list, listCount, tol, Ux, Uy, Uz)) continue;
                double qvx = Vx[na] + (Vx[nb2] - Vx[na]) * tt, qvy = Vy[na] + (Vy[nb2] - Vy[na]) * tt, qvz = Vz[na] + (Vz[nb2] - Vz[na]) * tt;
                double qvn = qvx * cNx + qvy * cNy + qvz * cNz;
                double qd = -roadDamping * 2 * dsqrt(kgS * mS) * qvn, qcap = roadStop * mS * dabs(qvn) / h;
                if (qd > qcap) qd = qcap; else if (qd < -qcap) qd = -qcap;
                double qf = kgS * cDepth + qd;
                if (qf <= 0) continue;
                double fqx = qf * cNx, fqy = qf * cNy, fqz = qf * cNz, wa = 1 - tt;
                ADDK(na, kgS * wa * wa, cNx, cNy, cNz); ADDK(nb2, kgS * tt * tt, cNx, cNy, cNz);
                Fx[na] += fqx * wa; Fy[na] += fqy * wa; Fz[na] += fqz * wa; Fx[nb2] += fqx * tt; Fy[nb2] += fqy * tt; Fz[nb2] += fqz * tt;
                eFn[na] += qf * wa; eFn[nb2] += qf * tt;
                eNx[na] += fqx * wa; eNy[na] += fqy * wa; eNz[na] += fqz * wa; eNx[nb2] += fqx * tt; eNy[nb2] += fqy * tt; eNz[nb2] += fqz * tt;
                if (qf > bestFn) { bestFn = qf; bestTri = cTri; }
            }
        }
        for (int ig = 0; ig < N; ig++) {
            double depth = 0, nxg = 0, nyg = 0, nzg = 0, fnOwn = 0;
            if (nearNode[ig] && contactAt(gBox, gTri, Px[ig], Py[ig], Pz[ig], hubx, huby, hubz, listIdx + listOff[ig], listOff[ig + 1] - listOff[ig], tol, Ux, Uy, Uz)) {
                depth = cDepth; nxg = cNx; nyg = cNy; nzg = cNz;
                double vn = Vx[ig] * nxg + Vy[ig] * nyg + Vz[ig] * nzg;
                double dampF = -roadDamping * 2 * dsqrt(kgS * mS) * vn, dampCap = roadStop * mS * dabs(vn) / h;
                if (dampF > dampCap) dampF = dampCap; else if (dampF < -dampCap) dampF = -dampCap;
                fnOwn = kgS * depth + dampF;
                if (fnOwn < 0) fnOwn = 0;
                if (fnOwn > 0) ADDK(ig, kgS, nxg, nyg, nzg);
            }
            double fn = fnOwn + eFn[ig];
            if (fn <= 0) { inContact[ig] = 0; sliding[ig] = 0; fnNode[ig] = 0; ux[ig] = uy[ig] = 0; continue; }
            if (fnOwn > 0) { Fx[ig] += fnOwn * nxg; Fy[ig] += fnOwn * nyg; Fz[ig] += fnOwn * nzg; }
            double sxn = fnOwn * nxg + eNx[ig], syn = fnOwn * nyg + eNy[ig], szn = fnOwn * nzg + eNz[ig], sln = orOne(dsqrt(sxn * sxn + syn * syn + szn * szn));
            nxg = sxn / sln; nyg = syn / sln; nzg = szn / sln;
            if (fnOwn <= 0) cTri = bestTri;
            if (!inContact[ig]) { inContact[ig] = 1; sliding[ig] = 0; }
            fnNode[ig] = (float)fn; cnx[ig] = (float)nxg; cny[ig] = (float)nyg; cnz[ig] = (float)nzg; ctri[ig] = cTri;
            count++; sumFn += fn;
            if (depth > maxDepth) maxDepth = depth;
            cxs += fn * Px[ig]; cys += fn * Py[ig]; czs += fn * Pz[ig];
            nxs += fn * nxg; nys += fn * nyg; nzs += fn * nzg;
            double along = (Px[ig] - hubx) * Fdx + (Py[ig] - huby) * Fdy + (Pz[ig] - hubz) * Fdz;
            if (along < minF) minF = along;
            if (along > maxF) maxF = along;
            alongSum += fn * along;
            if (fn > bestFn) { bestFn = fn; bestTri = cTri; }
            double dotN = Fdx * nxg + Fdy * nyg + Fdz * nzg;
            double t1x = Fdx - nxg * dotN, t1y = Fdy - nyg * dotN, t1z = Fdz - nzg * dotN, tl = dsqrt(t1x * t1x + t1y * t1y + t1z * t1z);
            if (tl < 1e-3) continue;
            t1x /= tl; t1y /= tl; t1z /= tl;
            double t2x = nyg * t1z - nzg * t1y, t2y = nzg * t1x - nxg * t1z, t2z = nxg * t1y - nyg * t1x;
            double vnn = Vx[ig] * nxg + Vy[ig] * nyg + Vz[ig] * nzg;
            double tvx = Vx[ig] - vnn * nxg, tvy = Vy[ig] - vnn * nyg, tvz = Vz[ig] - vnn * nzg;
            double sxs = tvx * t1x + tvy * t1y + tvz * t1z, sys = tvx * t2x + tvy * t2y + tvz * t2z;
            if (!implicit) { ux[ig] = (float)((double)ux[ig] + sxs * h); uy[ig] = (float)((double)uy[ig] + sys * h); }
            t1xA[ig] = t1x; t1yA[ig] = t1y; t1zA[ig] = t1z; t2xA[ig] = t2x; t2yA[ig] = t2y; t2zA[ig] = t2z;
            double kx = stiffX * fn / halfPatch, ky = stiffY * fn / halfPatch;
            double slideSpeed = dsqrt(sxs * sxs + sys * sys);
            double muNow = surfSliding + (surfMu - surfSliding) * js_exp(-slideSpeed / stribeck);
            double dX = bristleDamping * 2 * dsqrt(kx * mn), dY = bristleDamping * 2 * dsqrt(ky * mn);
            double fX = -(kx * (double)ux[ig]) - dsign(sxs) * dmin(dX * dabs(sxs), 0.6 * mn * dabs(sxs) / h);
            double fY = -(ky * (double)uy[ig]) - dsign(sys) * dmin(dY * dabs(sys), 0.6 * mn * dabs(sys) / h);
            double mag = dsqrt(fX * fX + (fY / lateralGrip) * (fY / lateralGrip)), limit = muNow * fn;
            if (mag > limit && mag > 0) { double sc = limit / mag; ux[ig] = (float)((double)ux[ig] * sc); uy[ig] = (float)((double)uy[ig] * sc); fX *= sc; fY *= sc; sliding[ig] = 1; slideLoad += fn; holdA[ig] = 1; }
            else { sliding[ig] = 0; holdA[ig] = 1; ADDK(ig, kx, t1x, t1y, t1z); ADDK(ig, ky, t2x, t2y, t2z); damped += dmin(dX, 0.6 * mn / h) + cShearT + (kx * kShearT / (kx + kShearT)) * dt; }
            Fx[ig] += fX * t1x + fY * t2x; Fy[ig] += fX * t1y + fY * t2y; Fz[ig] += fX * t1z + fY * t2z;
        }
        if (count > 0) halfPatch = dmax(0.03, (maxF - minF) / 2 + spacing / 2);
        /* the nodes */
        double hh = h * h, th = dmax(0.5, dmin(1, theta)), hhT = hh * th, hhR = hh * (1 - th);
        for (int im = 0; im < N; im++) {
            double a11 = mn + hhT * Kxx[im], a12 = hhT * Kxy[im], a13 = hhT * Kxz[im], a22 = mn + hhT * Kyy[im], a23 = hhT * Kyz[im], a33 = mn + hhT * Kzz[im];
            double kvx = Kxx[im] * Vx[im] + Kxy[im] * Vy[im] + Kxz[im] * Vz[im], kvy = Kxy[im] * Vx[im] + Kyy[im] * Vy[im] + Kyz[im] * Vz[im], kvz = Kxz[im] * Vx[im] + Kyz[im] * Vy[im] + Kzz[im] * Vz[im];
            double b1 = mn * Vx[im] + h * Fx[im] + hh * Bx[im] - hhR * kvx, b2 = mn * Vy[im] + h * Fy[im] + hh * By[im] - hhR * kvy, b3 = mn * Vz[im] + h * Fz[im] + hh * Bz[im] - hhR * kvz;
            double c11 = a22 * a33 - a23 * a23, c12 = a13 * a23 - a12 * a33, c13 = a12 * a23 - a13 * a22;
            double det = a11 * c11 + a12 * c12 + a13 * c13;
            if (implicit && det > 1e-12) {
                double c22 = a11 * a33 - a13 * a13, c23 = a12 * a13 - a11 * a23, c33 = a11 * a22 - a12 * a12;
                Vx[im] = (c11 * b1 + c12 * b2 + c13 * b3) / det; Vy[im] = (c12 * b1 + c22 * b2 + c23 * b3) / det; Vz[im] = (c13 * b1 + c23 * b2 + c33 * b3) / det;
            } else { Vx[im] += Fx[im] / mn * h; Vy[im] += Fy[im] / mn * h; Vz[im] += Fz[im] / mn * h; }
            Px[im] += Vx[im] * h; Py[im] += Vy[im] * h; Pz[im] += Vz[im] * h;
            if (implicit && holdA[im]) { ux[im] = (float)((double)ux[im] + (Vx[im] * t1xA[im] + Vy[im] * t1yA[im] + Vz[im] * t1zA[im]) * h); uy[im] = (float)((double)uy[im] + (Vx[im] * t2xA[im] + Vy[im] * t2yA[im] + Vz[im] * t2zA[im]) * h); }
            double ex = Px[im] - Ox[im], ey = Py[im] - Oy[im], ez = Pz[im] - Oz[im];
            double e2 = ex * ex + ey * ey + ez * ez;
            if (e2 > 0.04 * R * R) { double es = 0.2 * R / dsqrt(e2); Px[im] = Ox[im] + ex * es; Py[im] = Oy[im] + ey * es; Pz[im] = Oz[im] + ez * es; Vx[im] = OVx[im]; Vy[im] = OVy[im]; Vz[im] = OVz[im]; }
        }
        if (implicit) {
            double hT = h * th;
            for (int bc = 0; bc < beamCount; bc++) {
                if (bKind[bc] != 2 || bK[bc] == 0) continue;
                int na2 = bA[bc], nc2 = bB[bc] - N;
                double relC = ((Vx[na2] - IVx[nc2]) * bDx[bc] + (Vy[na2] - IVy[nc2]) * bDy[bc] + (Vz[na2] - IVz[nc2]) * bDz[bc]) * hT * bK[bc];
                RIMFORCE(nc2, relC * bDx[bc], relC * bDy[bc], relC * bDz[bc]);
            }
            for (int ns = 0; ns < N; ns++) {
                double rvx2 = Vx[ns] - OVx[ns], rvy2 = Vy[ns] - OVy[ns], rvz2 = Vz[ns] - OVz[ns];
                double relT = (rvx2 * Tx[ns] + rvy2 * Ty[ns] + rvz2 * Tz[ns]) * hT * kShearT, relL = (rvx2 * Lx + rvy2 * Ly + rvz2 * Lz) * hT * kShearL;
                RIMFORCE(ns, relT * Tx[ns] + relL * Lx, relT * Ty[ns] + relL * Ly, relT * Tz[ns] + relL * Lz);
            }
        }
        if (!lockedSpin) omS += h * (hubAcc3 - tq0) / inertiaW;
        omSum += omS;
    }
    P[P_HUBACC0] = hubAcc0; P[P_HUBACC1] = hubAcc1; P[P_HUBACC2] = hubAcc2; P[P_HUBACC3] = hubAcc3;
    P[P_OMS] = omS; P[P_OMSUM] = omSum; P[P_COUNT] = count; P[P_SUMFN] = sumFn; P[P_SLIDELOAD] = slideLoad; P[P_MAXDEPTH] = maxDepth;
    P[P_CXS] = cxs; P[P_CYS] = cys; P[P_CZS] = czs; P[P_NXS] = nxs; P[P_NYS] = nys; P[P_NZS] = nzs;
    P[P_MINF] = minF; P[P_MAXF] = maxF; P[P_BESTFN] = bestFn; P[P_BESTTRI] = bestTri; P[P_ALONGSUM] = alongSum; P[P_DAMPED] = damped; P[P_GTESTS] = gTests;
    P[P_HALFPATCH] = halfPatch;
}
