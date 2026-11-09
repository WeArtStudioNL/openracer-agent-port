// The shell tyre (web/js/TyreShell.js), see tyre_shell.h. The comments of TyreShell.js are kept short here; the
// numbers and the order of the arithmetic are those of the browser game.

#include "tyre_shell.h"

#include <godot_cpp/core/class_db.hpp>
#include <godot_cpp/variant/packed_byte_array.hpp>

#include <algorithm>
#include <cmath>

#ifndef M_PI
#define M_PI 3.14159265358979323846   // (not standard C++: MinGW leaves it out)
#endif

using namespace godot;

namespace orsound {

static inline double sgn(double v) { return v > 0 ? 1.0 : (v < 0 ? -1.0 : 0.0); }

// ---------------------------------------------------------------------------------------------------------------
// TyreGround: the triangles (Ground.js: addTriangle3D, boxNear, closest, normalOf, surfaceOf), in a grid seen from above

void TyreGround::clear() {
	tri.clear();
	box.clear();
	surf.clear();
	stamp.clear();
	cells.clear();
	names.clear();
	mark = 0;
}

void TyreGround::add_faces(const PackedVector3Array &faces, const Transform3D &xf, const String &surface) {
	int si = names.find(surface);
	if (si < 0) {
		names.push_back(surface);
		si = names.size() - 1;
	}
	int64_t nf = faces.size() / 3;
	for (int64_t f = 0; f < nf; f++) {
		Vector3 p0 = xf.xform(faces[3 * f]), p1 = xf.xform(faces[3 * f + 1]), p2 = xf.xform(faces[3 * f + 2]);
		double x0 = p0.x, y0 = p0.y, z0 = p0.z, x1 = p1.x, y1 = p1.y, z1 = p1.z, x2 = p2.x, y2 = p2.y, z2 = p2.z;
		double e1x = x1 - x0, e1y = y1 - y0, e1z = z1 - z0, e2x = x2 - x0, e2y = y2 - y0, e2z = z2 - z0;
		double nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
		double length = std::sqrt(nx * nx + ny * ny + nz * nz);
		if (length < 1e-9) {
			continue;
		}
		double minX = std::min({ x0, x1, x2 }), maxX = std::max({ x0, x1, x2 }), minY = std::min({ y0, y1, y2 }), maxY = std::max({ y0, y1, y2 });
		double minZ = std::min({ z0, z1, z2 }), maxZ = std::max({ z0, z1, z2 });
		int64_t i0 = (int64_t)std::floor(minX / CELL), i1 = (int64_t)std::floor(maxX / CELL), k0 = (int64_t)std::floor(minZ / CELL), k1 = (int64_t)std::floor(maxZ / CELL);
		if ((i1 - i0 + 1) * (k1 - k0 + 1) > 60000) {
			continue;  // (a triangle as big as a country: not a part of a track)
		}
		int t = (int)surf.size();
		double d[12] = { x0, y0, z0, e1x, e1y, e1z, e2x, e2y, e2z, nx / length, ny / length, nz / length };
		tri.insert(tri.end(), d, d + 12);
		double b[6] = { minX, minY, minZ, maxX, maxY, maxZ };
		box.insert(box.end(), b, b + 6);
		surf.push_back(si);
		stamp.push_back(0);
		for (int64_t i = i0; i <= i1; i++) {
			for (int64_t k = k0; k <= k1; k++) {
				cells[key(i, k)].push_back(t);
			}
		}
	}
}

String TyreGround::surface_name(int t) const {
	int s = surface_of(t);
	return s >= 0 && s < names.size() ? names[s] : String("road");
}

void TyreGround::near(double x, double y, double z, double r, std::vector<int> &out) {
	out.clear();
	mark++;
	int64_t i0 = (int64_t)std::floor((x - r) / CELL), i1 = (int64_t)std::floor((x + r) / CELL);
	int64_t k0 = (int64_t)std::floor((z - r) / CELL), k1 = (int64_t)std::floor((z + r) / CELL);
	for (int64_t i = i0; i <= i1; i++) {
		for (int64_t k = k0; k <= k1; k++) {
			auto it = cells.find(key(i, k));
			if (it == cells.end()) {
				continue;
			}
			for (int t : it->second) {
				if (stamp[t] == mark) {
					continue;
				}
				stamp[t] = mark;
				if (box_near(t, x, y, z, r)) {
					out.push_back(t);
				}
			}
		}
	}
}

double TyreGround::closest(int t, double px, double py, double pz, double &rx, double &ry, double &rz, int &region) const {
	const double *o = &tri[(size_t)t * 12];
	double ax = o[0], ay = o[1], az = o[2], abx = o[3], aby = o[4], abz = o[5], acx = o[6], acy = o[7], acz = o[8];
	double apx = px - ax, apy = py - ay, apz = pz - az;
	double d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
	region = 2;
	if (d1 <= 0 && d2 <= 0) {
		rx = ax;
		ry = ay;
		rz = az;
	} else {
		double bpx = apx - abx, bpy = apy - aby, bpz = apz - abz;
		double d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
		if (d3 >= 0 && d4 <= d3) {
			rx = ax + abx;
			ry = ay + aby;
			rz = az + abz;
		} else {
			double vc = d1 * d4 - d3 * d2;
			if (vc <= 0 && d1 >= 0 && d3 <= 0) {
				double vv = d1 / (d1 - d3);
				rx = ax + abx * vv;
				ry = ay + aby * vv;
				rz = az + abz * vv;
				region = 1;
			} else {
				double cpx = apx - acx, cpy = apy - acy, cpz = apz - acz;
				double d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
				if (d6 >= 0 && d5 <= d6) {
					rx = ax + acx;
					ry = ay + acy;
					rz = az + acz;
				} else {
					double vb = d5 * d2 - d1 * d6;
					if (vb <= 0 && d2 >= 0 && d6 <= 0) {
						double ww = d2 / (d2 - d6);
						rx = ax + acx * ww;
						ry = ay + acy * ww;
						rz = az + acz * ww;
						region = 1;
					} else {
						double va = d3 * d6 - d5 * d4;
						if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
							double w2 = (d4 - d3) / ((d4 - d3) + (d5 - d6));
							rx = ax + abx + (acx - abx) * w2;
							ry = ay + aby + (acy - aby) * w2;
							rz = az + abz + (acz - abz) * w2;
							region = 1;
						} else {
							double denom = 1 / (va + vb + vc), v2 = vb * denom, w3 = vc * denom;
							rx = ax + abx * v2 + acx * w3;
							ry = ay + aby * v2 + acy * w3;
							rz = az + abz * v2 + acz * w3;
							region = 0;
						}
					}
				}
			}
		}
	}
	double dx = px - rx, dy = py - ry, dz = pz - rz;
	return dx * dx + dy * dy + dz * dz;
}

void TyreGround::_bind_methods() {
	ClassDB::bind_method(D_METHOD("clear"), &TyreGround::clear);
	ClassDB::bind_method(D_METHOD("add_faces", "faces", "xf", "surface"), &TyreGround::add_faces);
	ClassDB::bind_method(D_METHOD("get_count"), &TyreGround::get_count);
	ClassDB::bind_method(D_METHOD("surface_name", "t"), &TyreGround::surface_name);
}

// ---------------------------------------------------------------------------------------------------------------
// TyreShell

static const int CLASS_RADIAL = 0, CLASS_BELT = 3, CLASS_CROSS = 4;
static const int BINS = 72;

void TyreShell::configure(const Dictionary &p) {
#define NUM(k, v)                      \
	if (p.has(k)) {                    \
		v = (double)p[k];              \
	}
#define FLAG(k, v)                     \
	if (p.has(k)) {                    \
		v = (bool)p[k];                \
	}
	NUM("force_filter", forceFilter) NUM("torsion", torsion) NUM("belt_mul", beltMul) NUM("step_angle", stepAngle)
	NUM("rim_stiffness", rimStiffness) NUM("rim_damping", rimDamping) NUM("road_stop", roadStop) NUM("bristle_damping", bristleDamping)
	NUM("shear_damping", shearDamping) NUM("shear_damping_lat", shearDampingLat) NUM("shoulder", shoulder) NUM("soft_share", softShare)
	NUM("rings", setRings) NUM("segments", setSegments) NUM("width", setWidth) NUM("stiff_x", stiffX) NUM("stiff_y", stiffY)
	NUM("stribeck", stribeck) NUM("tolerance", tolerance) NUM("vertical_stiffness", verticalStiffness) NUM("vertical_damping", verticalDamping)
	NUM("static_load", staticLoad) NUM("pressure", pressure) NUM("inner_ratio", innerRatio) NUM("carcass", carcass) NUM("tyre_mass", tyreMass)
	NUM("road_stiffness", roadStiffness) NUM("road_damping", roadDamping) NUM("theta", theta) NUM("max_substep", maxSubstep)
	NUM("max_substeps", maxSubsteps) NUM("beam_damping", beamDamping) NUM("radius", wheelRadius) NUM("inertia", wheelInertia)
	FLAG("belt_two_sided", beltTwoSided) FLAG("locked_spin", lockedSpin) FLAG("round", round) FLAG("implicit", implicit)
#undef NUM
#undef FLAG
}

std::vector<double> TyreShell::key_now() const {
	return { (double)std::max(1L, std::min(5L, std::lround(setRings))), (double)std::max(4L, std::min(72L, std::lround(setSegments))), setWidth, wheelRadius,
		innerRatio, round ? 1.0 : 0.0, shoulder };
}

void TyreShell::build() {
	rings = (int)std::max(1L, std::min(5L, std::lround(setRings)));
	segs = (int)std::max(4L, std::min(72L, std::lround(setSegments)));
	radius = wheelRadius;
	width = setWidth > 0 ? setWidth : std::max(0.1, 0.7 * radius);
	N = rings * segs;
	nodeLat.assign(rings, 0);
	nodeRad.assign(rings, 0);
	innerLat.assign(rings, 0);
	innerRad.assign(rings, 0);
	double sh = shoulder > 0 ? shoulder : (round ? 0.3 * width : 0.02 * width), ratio = std::max(0.3, std::min(0.9, innerRatio)), power = round ? 2 : 4;
	for (int j = 0; j < rings; j++) {
		double t = rings == 1 ? 0 : ((double)j / (rings - 1)) * 2 - 1;
		// (Float32Array in TyreShell.js)
		nodeLat[j] = (float)(t * width / 2 * (rings == 1 ? 0 : 0.92));
		nodeRad[j] = (float)(radius - sh * std::pow(std::abs(t), power));
		innerLat[j] = (float)(nodeLat[j] * 0.62);
		innerRad[j] = (float)(radius * ratio);
	}
	for (auto *v : { &Px, &Py, &Pz, &Vx, &Vy, &Vz, &Fx, &Fy, &Fz, &Ix, &Iy, &Iz, &IVx, &IVy, &IVz, &Ox, &Oy, &Oz, &OVx, &OVy, &OVz, &Tx, &Ty, &Tz, &Nx, &Ny,
				 &Nz, &t1xA, &t1yA, &t1zA, &t2xA, &t2yA, &t2zA, &Bx, &By, &Bz, &Kxx, &Kxy, &Kxz, &Kyy, &Kyz, &Kzz, &eFn, &eNx, &eNy, &eNz, &ownDepth, &ownWet, &ownNx, &ownNy, &ownNz, &fnNode, &cnx, &cny,
				 &cnz, &ux, &uy }) {
		v->assign(N, 0.0);
	}
	nearNode.assign(N, 0);
	ownTri.assign(N, -1);
	holdA.assign(N, 0);
	inContact.assign(N, 0);
	sliding.assign(N, 0);
	ctri.assign(N, 0);
	nodeList.assign(N, std::vector<int>());
	auto local = [&](int j, int k, bool inner, double *out) {
		double a = 2 * M_PI * k / segs, r = inner ? innerRad[j] : nodeRad[j], o = inner ? innerLat[j] : nodeLat[j];
		out[0] = o;
		out[1] = std::sin(a) * r;
		out[2] = std::cos(a) * r;
	};
	bA.clear();
	bB.clear();
	bL0.clear();
	bLmin.clear();
	bClass.clear();
	bKind.clear();
	auto add = [&](int a, int b, const double *pa, const double *pb, int cls, int kind) {
		double d = std::sqrt((pa[0] - pb[0]) * (pa[0] - pb[0]) + (pa[1] - pb[1]) * (pa[1] - pb[1]) + (pa[2] - pb[2]) * (pa[2] - pb[2]));
		bA.push_back(a);
		bB.push_back(b);
		bL0.push_back(d);
		bLmin.push_back(kind == 2 ? 0.5 * d : 0);
		bClass.push_back((uint8_t)cls);
		bKind.push_back((uint8_t)kind);
	};
	for (int j2 = 0; j2 < rings; j2++) {
		for (int k = 0; k < segs; k++) {
			int o = j2 * segs + k;
			double po[3], pi[3], pn[3];
			local(j2, k, false, po);
			local(j2, k, true, pi);
			add(o, N + o, po, pi, CLASS_RADIAL, 2);
			int kp = (k + 1) % segs;
			local(j2, kp, false, pn);
			add(o, j2 * segs + kp, po, pn, CLASS_BELT, 1);
			if (j2 < rings - 1) {
				local(j2 + 1, k, false, pn);
				add(o, (j2 + 1) * segs + k, po, pn, CLASS_CROSS, 1);
			}
		}
	}
	beamCount = (int)bA.size();
	bStrain.assign(beamCount, 0.0f);
	bK.assign(beamCount, 0.0);
	bDx.assign(beamCount, 0.0);
	bDy.assign(beamCount, 0.0);
	bDz.assign(beamCount, 0.0);
	builtFor = key_now();
	started = false;
}

void TyreShell::place_shells(double cx, double cy, double cz, const Vector3 &L, const Vector3 &F, const Vector3 &U, double ph, double omega, const Vector3 &vel) {
	for (int k = 0; k < segs; k++) {
		double a = ph + 2 * M_PI * k / segs, s = std::sin(a), c = std::cos(a);
		for (int j = 0; j < rings; j++) {
			int i = j * segs + k;
			double ro = nodeRad[j], lo = nodeLat[j];
			Tx[i] = F.x * c - U.x * s;
			Ty[i] = F.y * c - U.y * s;
			Tz[i] = F.z * c - U.z * s;
			Ox[i] = cx + L.x * lo + F.x * s * ro + U.x * c * ro;
			Oy[i] = cy + L.y * lo + F.y * s * ro + U.y * c * ro;
			Oz[i] = cz + L.z * lo + F.z * s * ro + U.z * c * ro;
			double orx = L.x * lo + F.x * s * ro + U.x * c * ro, ory = L.y * lo + F.y * s * ro + U.y * c * ro, orz = L.z * lo + F.z * s * ro + U.z * c * ro;
			OVx[i] = vel.x + omega * (L.y * orz - L.z * ory);
			OVy[i] = vel.y + omega * (L.z * orx - L.x * orz);
			OVz[i] = vel.z + omega * (L.x * ory - L.y * orx);
			double ri = innerRad[j], li = innerLat[j];
			double rx = L.x * li + F.x * s * ri + U.x * c * ri, ry = L.y * li + F.y * s * ri + U.y * c * ri, rz = L.z * li + F.z * s * ri + U.z * c * ri;
			Ix[i] = cx + rx;
			Iy[i] = cy + ry;
			Iz[i] = cz + rz;
			IVx[i] = vel.x + omega * (L.y * rz - L.z * ry);
			IVy[i] = vel.y + omega * (L.z * rx - L.x * rz);
			IVz[i] = vel.z + omega * (L.x * ry - L.y * rx);
		}
	}
}

void TyreShell::shell_normals() {
	for (int i = 0; i < N; i++) {
		double nx = Px[i] - Ix[i], ny = Py[i] - Iy[i], nz = Pz[i] - Iz[i], l = std::sqrt(nx * nx + ny * ny + nz * nz);
		if (l == 0) {
			l = 1;
		}
		Nx[i] = nx / l;
		Ny[i] = ny / l;
		Nz[i] = nz / l;
	}
}

bool TyreShell::contact_at(double x, double y, double z, const Vector3 &hub, TyreGround *ground, const std::vector<int> &list, double tol) {
	cDepth = 0;
	cTri = -1;
	cWet = 1;
	// (the deepest a node of a tyre can be: deeper, and it is not on that face. A node that went past the back wall of a ramp is not 1.3 m under its deck)
	double deep = 0.75 * radius;
	// the tread is a ball of rubber: the road is asked from its centre, a little inside the tyre, so that the centre stays in the air while the rubber is
	// pressed and the force turns smoothly around the edge of a ramp. On a face the depth is that of the point itself, as if there were no ball
	double ball = std::max(tol, std::min(0.03, 0.08 * radius)), inset = ball - tol;
	double rx = x - hub.x, ry = y - hub.y, rz = z - hub.z, along = rx * axisLx + ry * axisLy + rz * axisLz;
	rx -= axisLx * along;
	ry -= axisLy * along;
	rz -= axisLz * along;
	double rl = std::sqrt(rx * rx + ry * ry + rz * rz);
	if (rl > 1e-9) {
		rx /= rl;
		ry /= rl;
		rz /= rl;
	}
	double bx = x - rx * inset, by = y - ry * inset, bz = z - rz * inset;
	bool inside = false;  // (a ball really behind a face leaves by the nearest one: not through the wall of a ramp when it is just under the deck)
	double next = 1e9, nextX = 0, nextY = 0, nextZ = 0;  // (the face behind the nearest: near the corner the way out lies between the two)
	for (int t : list) {
		ground->tests++;
		if (!ground->box_near(t, bx, by, bz, tol + 0.06 + deep)) {
			continue;
		}
		double nrx, nry, nrz;
		int region;
		double d2 = ground->closest(t, bx, by, bz, nrx, nry, nrz, region), dist = std::sqrt(d2), mx, my, mz, front, tnx, tny, tnz;
		ground->normal_of(t, tnx, tny, tnz);
		double sideHub = (hub.x - nrx) * tnx + (hub.y - nry) * tny + (hub.z - nrz) * tnz, s;
		if (std::abs(tny) >= 0.5) {
			// a road or a ramp: its top is up in the world, whatever the car does (the triangles of a model can face either way). Its other
			// side only for a wheel that hangs under it upside down (a loop, a ceiling). The side of the hub says nothing here: a wheel beside a
			// ramp has its hub below the deck and a ring of the tyre on it
			s = tny >= 0 ? 1 : -1;
			if ((upX * tnx + upY * tny + upZ * tnz) * s < -0.3 && sideHub * s < 0) {
				s = -s;
			}
		} else {
			// a wall: the side where the wheel is. (The lean of the car said which side it was: a car leaning against the slope was pulled through it.)
			s = sideHub >= 0 ? 1 : -1;
		}
		if (region == 0) {
			mx = tnx * s;
			my = tny * s;
			mz = tnz * s;
			front = (bx - nrx) * mx + (by - nry) * my + (bz - nrz) * mz;
			if (front < -deep) {
				continue;
			}
		} else {
			// an edge or a corner of the triangle: away from it, not on the back of the face
			if (dist > ball || dist < 1e-6) {
				continue;
			}
			mx = (bx - nrx) / dist;
			my = (by - nry) / dist;
			mz = (bz - nrz) / dist;
			if ((mx * tnx + my * tny + mz * tnz) * s < -0.3) {
				continue;
			}
			front = dist;
		}
		double facing = -(rx * mx + ry * my + rz * mz), dd = tol - front + inset * std::max(0.0, facing);
		if (dd <= 0) {
			continue;
		}
		bool behind = front < 0;
		if (behind) {
			if (!inside || dd < cDepth) {
				if (inside && cNx * mx + cNy * my + cNz * mz < 0.9) {
					next = cDepth;
					nextX = cNx;
					nextY = cNy;
					nextZ = cNz;
				}
				inside = true;
				cDepth = dd;
				cTri = t;
				cNx = mx;
				cNy = my;
				cNz = mz;
			} else if (dd < next && cNx * mx + cNy * my + cNz * mz < 0.9) {
				next = dd;
				nextX = mx;
				nextY = my;
				nextZ = mz;
			}
		} else if (!inside && dd > cDepth) {
			cDepth = dd;
			cTri = t;
			cNx = mx;
			cNy = my;
			cNz = mz;
			cWet = region == 0 ? 1.0 : std::min(1.0, 2 * std::sqrt(2 * ball * dd) / wetSize);
		}
	}
	if (inside) {
		cWet = 1;
	}
	if (inside && next < 1e8) {
		double share = 1 - (next - cDepth) / ball;
		if (share > 0) {
			double ax = cNx + nextX * share, ay = cNy + nextY * share, az = cNz + nextZ * share, al = std::sqrt(ax * ax + ay * ay + az * az);
			if (al > 1e-9) {
				cNx = ax / al;
				cNy = ay / al;
				cNz = az / al;
			}
		}
	}
	return cTri >= 0;
}

void TyreShell::rim_force(int i, double fx, double fy, double fz) {
	hubAcc[0] += fx;
	hubAcc[1] += fy;
	hubAcc[2] += fz;
	double rx = Ix[i] - hubC[0], ry = Iy[i] - hubC[1], rz = Iz[i] - hubC[2];
	hubAcc[3] += axisLx * (ry * fz - rz * fy) + axisLy * (rz * fx - rx * fz) + axisLz * (rx * fy - ry * fx);
}

void TyreShell::add_k(int i, double k, double dx, double dy, double dz) {
	Kxx[i] += k * dx * dx;
	Kxy[i] += k * dx * dy;
	Kxz[i] += k * dx * dz;
	Kyy[i] += k * dy * dy;
	Kyz[i] += k * dy * dz;
	Kzz[i] += k * dz * dz;
}

void TyreShell::add_kv(int i, double k, double dx, double dy, double dz, double vax, double vay, double vaz) {
	add_k(i, k, dx, dy, dz);
	double kv = k * (vax * dx + vay * dy + vaz * dz);
	Bx[i] += kv * dx;
	By[i] += kv * dy;
	Bz[i] += kv * dz;
}

double TyreShell::friction_load() const {
	return std::max(std::max(staticLoad * 0.3, 1.0), loadPrev);
}

bool TyreShell::step(double dt, const Vector3 &hub, const Vector3 &vel, const Vector3 &L, const Vector3 &F, const Vector3 &U, double omega,
		const Ref<TyreGround> &groundRef, double surfMu, double surfSliding, double lateralGrip) {
	TyreGround *ground = groundRef.ptr();
	if (ground == nullptr || dt <= 0) {
		return false;
	}
	if (N == 0 || builtFor != key_now()) {
		build();
	}
	rHasOmega = true;
	double R = radius, mn = std::max(0.01, (tyreMass > 0 ? tyreMass : 8) / N);
	// ---- the constants of the beams from the pressure and the stiffness
	double Pa = std::max(0.15, pressure) * 1e5, An = (2 * M_PI * R / segs) * (width / rings), pA = Pa * An;
	double softness = carcass > 0 ? std::max(0.003, carcass / 1000) : std::max(0.003, softShare * staticLoad / std::max(1e4, verticalStiffness));
	// (the air, and what the carcass carries by itself, about 34 N/mm for a whole tyre: without air it does not fold flat at once. Shared by the nodes of a patch.)
	double patchNodes = rings * std::max(1.0, 0.27 / (2 * M_PI * R / segs));
	double kr = pA / softness + 34000.0 / patchNodes;
	double spacing = 2 * M_PI * R / segs, nominal = std::max(4.0, rings * 0.19 / spacing);
	double Kt = torsion > 0 ? torsion * 1000 / (R * R) : 3 * stiffX * staticLoad / 0.095, Ky = 3 * stiffY * staticLoad / 0.095;
	double inertia = wheelInertia != 0 ? wheelInertia : 1.6;
	Kt = std::min(Kt, 20 * inertia / (R * R * dt * dt));
	classK[CLASS_RADIAL] = kr;
	double kShearT = Kt / nominal, kShearL = Ky / nominal;
	double cShearT = 2 * shearDamping * std::sqrt(kShearT * mn), cShearL = 2 * shearDampingLat * std::sqrt(kShearL * mn);
	classK[CLASS_BELT] = beltMul * kr;
	classK[CLASS_CROSS] = beltMul * kr;
	double kg = roadStiffness * kr, kStop = 20 * kr, zeta = beamDamping;
	double hubx = hub.x, huby = hub.y, hubz = hub.z;
	double kSum = implicit ? 2 * classK[CLASS_BELT] + 2 * classK[CLASS_CROSS] : kg + kr + kShearT + kShearL + 2 * classK[CLASS_BELT] + 2 * classK[CLASS_CROSS];
	double stepMax = dt / maxSubsteps;
	mn = std::max(mn, 1.15 * kSum * (stepMax / stepAngle) * (stepMax / stepAngle));
	int nWanted = (int)std::max(std::ceil(dt * std::sqrt(kSum / mn) / stepAngle), std::ceil(dt / maxSubstep));
	int n = std::max(2, std::min((int)maxSubsteps, nWanted));
	rSubstepsWanted = nWanted;
	rSubsteps = n;
	double h = dt / n;
	// ---- the first step, or a jump of the car: the nodes start on the shape of the tyre
	bool jumped = started && ((Px[0] - hub.x) * (Px[0] - hub.x) + (Py[0] - hub.y) * (Py[0] - hub.y) + (Pz[0] - hub.z) * (Pz[0] - hub.z) > 4 * R * R);
	place_shells(hub.x, hub.y, hub.z, L, F, U, phase, omega, vel);
	if (!started || jumped) {
		for (int i0 = 0; i0 < N; i0++) {
			Px[i0] = Ox[i0];
			Py[i0] = Oy[i0];
			Pz[i0] = Oz[i0];
			Vx[i0] = OVx[i0];
			Vy[i0] = OVy[i0];
			Vz[i0] = OVz[i0];
			ux[i0] = uy[i0] = 0;
			inContact[i0] = 0;
		}
		started = true;
	}
	double tol = tolerance;
	upX = U.x;
	upY = U.y;
	upZ = U.z;
	hubAcc[0] = hubAcc[1] = hubAcc[2] = hubAcc[3] = 0;
	axisLx = L.x;
	axisLy = L.y;
	axisLz = L.z;
	double hcx = hubx, hcy = huby, hcz = hubz;
	hubC[0] = hcx;
	hubC[1] = hcy;
	hubC[2] = hcz;
	// (the friction of the road: frictionOf(Math.max(load0, loadPrev), surface), asked by the caller for friction_load())
	double surfMuV = surfMu, surfSlidingV = surfSliding;
	// ---- the nodes that a triangle can reach in this step (the candidates of Vehicle.js: the triangles near the hub)
	static thread_local std::vector<int> list;
	ground->near(hubx, huby, hubz, R + width / 2 + 0.12, list);
	const int blockSize = 6, blocks = (segs + blockSize - 1) / blockSize;
	if ((int)blockList.size() < blocks) {
		blockList.resize(blocks);
	}
	for (int bl = 0; bl < blocks; bl++) {
		double bx = 0, by = 0, bz = 0, bc = 0, bv = 0;
		int k0 = bl * blockSize, k1 = std::min(segs, k0 + blockSize);
		for (int jb = 0; jb < rings; jb++) {
			for (int kb = k0; kb < k1; kb++) {
				int ib = jb * segs + kb;
				bx += Px[ib];
				by += Py[ib];
				bz += Pz[ib];
				bc++;
				double vb = Vx[ib] * Vx[ib] + Vy[ib] * Vy[ib] + Vz[ib] * Vz[ib];
				if (vb > bv) {
					bv = vb;
				}
			}
		}
		bx /= bc;
		by /= bc;
		bz /= bc;
		double rad = 0;
		for (int jc = 0; jc < rings; jc++) {
			for (int kc = k0; kc < k1; kc++) {
				int ic = jc * segs + kc;
				double dxb = Px[ic] - bx, dyb = Py[ic] - by, dzb = Pz[ic] - bz, db = std::sqrt(dxb * dxb + dyb * dyb + dzb * dzb);
				if (db > rad) {
					rad = db;
				}
			}
		}
		double reachB = rad * 1.05 + tol + 0.06 + 0.75 * radius + 0.03 + 1.4 * dt * std::sqrt(bv) * 1.2;
		std::vector<int> &bList = blockList[bl];
		bList.clear();
		for (int t : list) {
			ground->tests++;
			if (ground->box_near(t, bx, by, bz, reachB)) {
				bList.push_back(t);
			}
		}
	}
	for (int inr = 0; inr < N; inr++) {
		double reachN = tol + 0.06 + 0.75 * radius + 0.03 + 1.4 * dt * std::sqrt(Vx[inr] * Vx[inr] + Vy[inr] * Vy[inr] + Vz[inr] * Vz[inr]);
		std::vector<int> &mine = nodeList[inr];
		const std::vector<int> &fromBlock = blockList[(inr % segs) / blockSize];
		mine.clear();
		for (int t : fromBlock) {
			ground->tests++;
			if (ground->box_near(t, Px[inr], Py[inr], Pz[inr], reachN)) {
				mine.push_back(t);
			}
		}
		nearNode[inr] = mine.empty() ? 0 : 1;
	}
	// ---- the steps
	double damped = 0;
	double omS = omega, omSum = 0, phS = phase - 0.5 * omega * dt, inertiaW = std::max(0.05, wheelInertia != 0 ? wheelInertia : 1.6);
	double alongSum = 0;
	double maxDepth = 0, sumFn = 0, slideLoad = 0, cxs = 0, cys = 0, czs = 0, nxs = 0, nys = 0, nzs = 0, minF = 1e9, maxF = -1e9, bestFn = 0, sag = 0;
	int count = 0, bestTri = -1;
	for (int s = 0; s < n; s++) {
		double tc = h * (s + 1) - 0.5 * dt, tq0 = hubAcc[3];
		phS += omS * h;
		hcx = hub.x + vel.x * tc;
		hcy = hub.y + vel.y * tc;
		hcz = hub.z + vel.z * tc;
		hubC[0] = hcx;
		hubC[1] = hcy;
		hubC[2] = hcz;
		place_shells(hcx, hcy, hcz, L, F, U, phS, omS, vel);
		shell_normals();
		for (int i = 0; i < N; i++) {
			Fx[i] = Fy[i] = Fz[i] = 0;
			Kxx[i] = Kxy[i] = Kxz[i] = Kyy[i] = Kyz[i] = Kzz[i] = 0;
			Bx[i] = By[i] = Bz[i] = 0;
			holdA[i] = 0;
		}
		// the pressure: on the outer node, outwards, and the reaction on the rim node under it
		for (int ip = 0; ip < N; ip++) {
			double fx = pA * Nx[ip], fy = pA * Ny[ip], fz = pA * Nz[ip];
			Fx[ip] += fx;
			Fy[ip] += fy;
			Fz[ip] += fz;
			rim_force(ip, -fx, -fy, -fz);
		}
		// the beams
		for (int dcl = 0; dcl < 5; dcl++) {
			beamDamp[dcl] = zeta * 2 * std::sqrt(classK[dcl] * mn);
			beamDampHalf[dcl] = zeta * 2 * std::sqrt(classK[dcl] * mn * 0.5);
		}
		for (int b = 0; b < beamCount; b++) {
			int a = bA[b], c = bB[b];
			bool bInner = c >= N;
			double ax = Px[a], ay = Py[a], az = Pz[a], avx = Vx[a], avy = Vy[a], avz = Vz[a], bx, by, bz, bvx, bvy, bvz;
			if (bInner) {
				int ci = c - N;
				bx = Ix[ci];
				by = Iy[ci];
				bz = Iz[ci];
				bvx = IVx[ci];
				bvy = IVy[ci];
				bvz = IVz[ci];
			} else {
				bx = Px[c];
				by = Py[c];
				bz = Pz[c];
				bvx = Vx[c];
				bvy = Vy[c];
				bvz = Vz[c];
			}
			double dx = bx - ax, dy = by - ay, dz = bz - az, len = std::sqrt(dx * dx + dy * dy + dz * dz);
			if (len < 1e-9) {
				continue;
			}
			dx /= len;
			dy /= len;
			dz /= len;
			double k = classK[bClass[b]], L0 = bL0[b], force = 0;
			int kind = bKind[b];
			double vr = (bvx - avx) * dx + (bvy - avy) * dy + (bvz - avz) * dz;
			if (kind == 2) {
				double cfPull = 0;
				if (!inContact[a] && omS * omS > 1) {
					double crx = Ox[a] - hcx, cry = Oy[a] - hcy, crz = Oz[a] - hcz, cax = crx * L.x + cry * L.y + crz * L.z;
					crx -= cax * L.x;
					cry -= cax * L.y;
					crz -= cax * L.z;
					cfPull = mn * omS * omS * std::sqrt(crx * crx + cry * cry + crz * crz);
				}
				double lSlack = L0 - (pA + cfPull) / k, spring = 0;
				bK[b] = 0;
				if (len > lSlack) {
					spring = k * (len - lSlack);
					add_kv(a, k, dx, dy, dz, bvx, bvy, bvz);
					bK[b] = k;
				} else if (len < bLmin[b]) {
					spring = -kStop * (bLmin[b] - len);
					add_kv(a, kStop, dx, dy, dz, bvx, bvy, bvz);
					bK[b] = kStop;
				}
				bDx[b] = dx;
				bDy[b] = dy;
				bDz[b] = dz;
				force = spring + beamDamp[bClass[b]] * vr;
				bStrain[b] = (float)((len - L0) / L0);
			} else if (kind == 0) {
				double s0 = len - L0;
				if (s0 > 0 || beltTwoSided) {
					force = k * s0 + beamDamp[bClass[b]] * vr;
				} else {
					force = 0;
				}
				if (force < 0 && !beltTwoSided) {
					force = 0;
				}
				bStrain[b] = (float)(s0 / L0);
			} else {
				force = k * (len - L0) + beamDampHalf[bClass[b]] * vr;
				bStrain[b] = (float)((len - L0) / L0);
			}
			double gx = force * dx, gy = force * dy, gz = force * dz;
			Fx[a] += gx;
			Fy[a] += gy;
			Fz[a] += gz;
			if (bInner) {
				rim_force(c - N, -gx, -gy, -gz);
			} else {
				Fx[c] -= gx;
				Fy[c] -= gy;
				Fz[c] -= gz;
			}
		}
		// the shear of the tread against the rim
		for (int is2 = 0; is2 < N; is2++) {
			double ex = Px[is2] - Ox[is2], ey = Py[is2] - Oy[is2], ez = Pz[is2] - Oz[is2];
			double dT = ex * Tx[is2] + ey * Ty[is2] + ez * Tz[is2], dL = ex * L.x + ey * L.y + ez * L.z;
			double rvx = Vx[is2] - OVx[is2], rvy = Vy[is2] - OVy[is2], rvz = Vz[is2] - OVz[is2];
			double vT = rvx * Tx[is2] + rvy * Ty[is2] + rvz * Tz[is2], vL = rvx * L.x + rvy * L.y + rvz * L.z;
			double fT = -(kShearT * dT + cShearT * vT), fL = -(kShearL * dL + cShearL * vL);
			add_kv(is2, kShearT, Tx[is2], Ty[is2], Tz[is2], OVx[is2], OVy[is2], OVz[is2]);
			add_kv(is2, kShearL, L.x, L.y, L.z, OVx[is2], OVy[is2], OVz[is2]);
			double sx = fT * Tx[is2] + fL * L.x, sy = fT * Ty[is2] + fL * L.y, sz = fT * Tz[is2] + fL * L.z;
			Fx[is2] += sx;
			Fy[is2] += sy;
			Fz[is2] += sz;
			rim_force(is2, -sx, -sy, -sz);
		}
		// the road on the nodes: the stiff spring out of the triangle, and the bristles
		count = 0;
		sumFn = 0;
		slideLoad = 0;
		maxDepth = 0;
		cxs = cys = czs = nxs = nys = nzs = 0;
		minF = 1e9;
		maxF = -1e9;
		bestFn = 0;
		bestTri = -1;
		sag = 0;
		alongSum = 0;
		const int contactSamples = 4;
		int S = std::max(contactSamples, std::min(24, (int)std::ceil(72.0 / segs)));
		double kgS = kg / S, mS = mn / S;
		wetSize = std::sqrt(An / S);
		// (a safety net for a point deep in a solid: what a point may press follows the rubber that touches, this is far above it)
		double pointMax = 8.0 * pA / S;
		for (int ie = 0; ie < N; ie++) {
			eFn[ie] = 0;
			eNx[ie] = eNy[ie] = eNz[ie] = 0;
		}
		// the road at the nodes themselves, first: the samples across the tyre ask where the rings are
		for (int io = 0; io < N; io++) {
			ownTri[io] = -1;
			if (nearNode[io] && contact_at(Px[io], Py[io], Pz[io], hub, ground, nodeList[io], tol)) {
				ownTri[io] = cTri;
				ownDepth[io] = cDepth;
				ownWet[io] = cWet;
				ownNx[io] = cNx;
				ownNy[io] = cNy;
				ownNz[io] = cNz;
			}
		}
		// one point of the tread on the road, between the nodes na and nb (tt: how far to nb)
		auto tread_at = [&](double qx, double qy, double qz, const int (&at)[4], const double (&share)[4], const std::vector<int> &near, double area) {
			if (!contact_at(qx, qy, qz, hub, ground, near, tol)) {
				return;
			}
			double qvx = 0, qvy = 0, qvz = 0;
			for (int c = 0; c < 4; c++) {
				if (at[c] >= 0) {
					qvx += Vx[at[c]] * share[c];
					qvy += Vy[at[c]] * share[c];
					qvz += Vz[at[c]] * share[c];
				}
			}
			double qvn = qvx * cNx + qvy * cNy + qvz * cNz;
			double qk = kgS * cWet * area, qd = -roadDamping * 2 * std::sqrt(qk * mS) * qvn * std::min(1.0, cDepth / tol), qcap = roadStop * mS * std::abs(qvn) / h;
			if (qd > qcap) {
				qd = qcap;
			} else if (qd < -qcap) {
				qd = -qcap;
			}
			double qf = qk * cDepth + qd;
			if (qf <= 0) {
				return;
			}
			bool capped = qf >= pointMax * area;
			if (capped) {
				qf = pointMax * area;
			}
			double fqx = qf * cNx, fqy = qf * cNy, fqz = qf * cNz;
			for (int c = 0; c < 4; c++) {
				if (at[c] < 0) {
					continue;
				}
				int i = at[c];
				double u = share[c];
				if (!capped) {
					add_k(i, qk * u * u, cNx, cNy, cNz);
				}
				Fx[i] += fqx * u;
				Fy[i] += fqy * u;
				Fz[i] += fqz * u;
				eFn[i] += qf * u;
				eNx[i] += fqx * u;
				eNy[i] += fqy * u;
				eNz[i] += fqz * u;
			}
			if (qf > bestFn) {
				bestFn = qf;
				bestTri = cTri;
			}
		};
		// (a point between two nodes of a ring)
		auto tread_sample = [&](double qx, double qy, double qz, int na, int nb, double tt, const std::vector<int> &near) {
			const int at[4] = { na, nb, -1, -1 };
			const double share[4] = { 1 - tt, tt, 0, 0 };
			tread_at(qx, qy, qz, at, share, near, 1.0);
		};
		for (int jr = 0; jr < rings; jr++) {
			for (int kq = 0; kq < segs; kq++) {
				int na = jr * segs + kq, nb2 = jr * segs + (kq + 1) % segs;
				if (!nearNode[na] && !nearNode[nb2]) {
					continue;
				}
				double oax = Ox[na] - hcx, oay = Oy[na] - hcy, oaz = Oz[na] - hcz, obx = Ox[nb2] - hcx, oby = Oy[nb2] - hcy, obz = Oz[nb2] - hcz;
				double ringR = std::sqrt(oax * oax + oay * oay + oaz * oaz);
				for (int m = 1; m < S; m++) {
					double tt = (double)m / S, qx = Px[na] + (Px[nb2] - Px[na]) * tt, qy = Py[na] + (Py[nb2] - Py[na]) * tt, qz = Pz[na] + (Pz[nb2] - Pz[na]) * tt;
					double lx = oax + (obx - oax) * tt, ly = oay + (oby - oay) * tt, lz = oaz + (obz - oaz) * tt, ll = std::sqrt(lx * lx + ly * ly + lz * lz);
					if (ll == 0) {
						ll = 1;
					}
					double bul = ringR / ll - 1;
					qx += lx * bul;
					qy += ly * bul;
					qz += lz * bul;
					tread_sample(qx, qy, qz, na, nb2, tt, nearNode[na] ? nodeList[na] : nodeList[nb2]);
				}
			}
		}
		// the piece of tread between two rings and two nodes, where its corners are not on one plane (a ring on the road and one past its edge, or two faces):
		// a raster of points, each giving its force to the four corners by how near it is. On a flat road no piece has one, and nothing changes there
		for (int jr = 0; jr + 1 < rings; jr++) {
			double gap = nodeLat[jr + 1] - nodeLat[jr], along = 2 * M_PI * R / (segs * S);
			int spans = std::max(2, std::min(8, (int)std::ceil(gap / along)));
			double area = std::min(1.0, gap / (width / rings) / spans);       // (a point of the raster stands for its small piece of the tread)
			for (int kq = 0; kq < segs; kq++) {
				int kn = (kq + 1) % segs;
				int a0 = jr * segs + kq, a1 = jr * segs + kn, b0 = a0 + segs, b1 = a1 + segs;
				if (!nearNode[a0] && !nearNode[a1] && !nearNode[b0] && !nearNode[b1]) {
					continue;
				}
				bool hit = ownTri[a0] >= 0 && ownTri[a1] >= 0 && ownTri[b0] >= 0 && ownTri[b1] >= 0;
				if (hit) {
					double f = ownNx[a0] * ownNx[a1] + ownNy[a0] * ownNy[a1] + ownNz[a0] * ownNz[a1];
					f = std::min(f, ownNx[a0] * ownNx[b0] + ownNy[a0] * ownNy[b0] + ownNz[a0] * ownNz[b0]);
					f = std::min(f, ownNx[a0] * ownNx[b1] + ownNy[a0] * ownNy[b1] + ownNz[a0] * ownNz[b1]);
					hit = f > 0.995;
				}
				if (hit) {
					continue;
				}
				const std::vector<int> &near = nearNode[a0] ? nodeList[a0] : (nearNode[b0] ? nodeList[b0] : (nearNode[a1] ? nodeList[a1] : nodeList[b1]));
				for (int m = 1; m < spans; m++) {
					double v = (double)m / spans;
					for (int k2 = 0; k2 < S; k2++) {
						double u = (double)k2 / S;
						const int at[4] = { a0, a1, b0, b1 };
						const double share[4] = { (1 - v) * (1 - u), (1 - v) * u, v * (1 - u), v * u };
						double qx = 0, qy = 0, qz = 0, lx = 0, ly = 0, lz = 0, ringR = 0;
						for (int c = 0; c < 4; c++) {
							int i = at[c];
							qx += Px[i] * share[c];
							qy += Py[i] * share[c];
							qz += Pz[i] * share[c];
							double ox = Ox[i] - hcx, oy = Oy[i] - hcy, oz = Oz[i] - hcz;
							lx += ox * share[c];
							ly += oy * share[c];
							lz += oz * share[c];
							ringR += std::sqrt(ox * ox + oy * oy + oz * oz) * share[c];
						}
						double ll = std::sqrt(lx * lx + ly * ly + lz * lz);
						if (ll > 0) {
							double bul = ringR / ll - 1;
							qx += lx * bul;
							qy += ly * bul;
							qz += lz * bul;
						}
						tread_at(qx, qy, qz, at, share, near, area);
					}
				}
			}
		}
		for (int ig = 0; ig < N; ig++) {
			double depth = 0, nxg = 0, nyg = 0, nzg = 0, fnOwn = 0;
			if (ownTri[ig] >= 0) {
				cTri = ownTri[ig];
				double kOwn = kgS * ownWet[ig];
				depth = ownDepth[ig];
				nxg = ownNx[ig];
				nyg = ownNy[ig];
				nzg = ownNz[ig];
				double vn = Vx[ig] * nxg + Vy[ig] * nyg + Vz[ig] * nzg;
				double dampF = -roadDamping * 2 * std::sqrt(kOwn * mS) * vn * std::min(1.0, depth / tol), dampCap = roadStop * mS * std::abs(vn) / h;
				if (dampF > dampCap) {
					dampF = dampCap;
				} else if (dampF < -dampCap) {
					dampF = -dampCap;
				}
				fnOwn = kOwn * depth + dampF;
				if (fnOwn < 0) {
					fnOwn = 0;
				}
				if (fnOwn >= pointMax) {
					fnOwn = pointMax;
				} else if (fnOwn > 0) {
					add_k(ig, kOwn, nxg, nyg, nzg);
				}
			}
			double fn = fnOwn + eFn[ig];
			if (fn <= 0) {
				inContact[ig] = 0;
				sliding[ig] = 0;
				fnNode[ig] = 0;
				ux[ig] = uy[ig] = 0;
				continue;
			}
			if (fnOwn > 0) {
				Fx[ig] += fnOwn * nxg;
				Fy[ig] += fnOwn * nyg;
				Fz[ig] += fnOwn * nzg;
			}
			double sxn = fnOwn * nxg + eNx[ig], syn = fnOwn * nyg + eNy[ig], szn = fnOwn * nzg + eNz[ig], sln = std::sqrt(sxn * sxn + syn * syn + szn * szn);
			if (sln == 0) {
				sln = 1;
			}
			nxg = sxn / sln;
			nyg = syn / sln;
			nzg = szn / sln;
			if (fnOwn <= 0) {
				cTri = bestTri;
			}
			if (!inContact[ig]) {
				inContact[ig] = 1;
				sliding[ig] = 0;
			}
			fnNode[ig] = (float)fn;
			cnx[ig] = (float)nxg;
			cny[ig] = (float)nyg;
			cnz[ig] = (float)nzg;
			ctri[ig] = cTri;
			count++;
			sumFn += fn;
			if (depth > maxDepth) {
				maxDepth = depth;
			}
			cxs += fn * Px[ig];
			cys += fn * Py[ig];
			czs += fn * Pz[ig];
			nxs += fn * nxg;
			nys += fn * nyg;
			nzs += fn * nzg;
			double along = (Px[ig] - hub.x) * F.x + (Py[ig] - hub.y) * F.y + (Pz[ig] - hub.z) * F.z;
			if (along < minF) {
				minF = along;
			}
			if (along > maxF) {
				maxF = along;
			}
			alongSum += fn * along;
			if (fn > bestFn) {
				bestFn = fn;
				bestTri = cTri;
			}
			// the bristles: the speed of the tread over the road is the speed of the node
			double dotN = F.x * nxg + F.y * nyg + F.z * nzg;
			double t1x = F.x - nxg * dotN, t1y = F.y - nyg * dotN, t1z = F.z - nzg * dotN, tl = std::sqrt(t1x * t1x + t1y * t1y + t1z * t1z);
			if (tl < 1e-3) {
				continue;
			}
			t1x /= tl;
			t1y /= tl;
			t1z /= tl;
			double t2x = nyg * t1z - nzg * t1y, t2y = nzg * t1x - nxg * t1z, t2z = nxg * t1y - nyg * t1x;
			double vnn = Vx[ig] * nxg + Vy[ig] * nyg + Vz[ig] * nzg;
			double tvx = Vx[ig] - vnn * nxg, tvy = Vy[ig] - vnn * nyg, tvz = Vz[ig] - vnn * nzg;
			double sxs = tvx * t1x + tvy * t1y + tvz * t1z, sys = tvx * t2x + tvy * t2y + tvz * t2z;
			if (!implicit) {
				ux[ig] = (float)(ux[ig] + sxs * h);
				uy[ig] = (float)(uy[ig] + sys * h);
			}
			t1xA[ig] = t1x;
			t1yA[ig] = t1y;
			t1zA[ig] = t1z;
			t2xA[ig] = t2x;
			t2yA[ig] = t2y;
			t2zA[ig] = t2z;
			double kx = stiffX * fn / halfPatch, ky = stiffY * fn / halfPatch;
			double slideSpeed = std::sqrt(sxs * sxs + sys * sys);
			double muNow = surfSlidingV + (surfMuV - surfSlidingV) * std::exp(-slideSpeed / stribeck);
			double dX = bristleDamping * 2 * std::sqrt(kx * mn), dY = bristleDamping * 2 * std::sqrt(ky * mn);
			double fX = -(kx * ux[ig]) - sgn(sxs) * std::min(dX * std::abs(sxs), 0.6 * mn * std::abs(sxs) / h);
			double fY = -(ky * uy[ig]) - sgn(sys) * std::min(dY * std::abs(sys), 0.6 * mn * std::abs(sys) / h);
			double mag = std::sqrt(fX * fX + (fY / lateralGrip) * (fY / lateralGrip)), limit = muNow * fn;
			if (mag > limit && mag > 0) {
				double sc = limit / mag;
				ux[ig] = (float)(ux[ig] * sc);
				uy[ig] = (float)(uy[ig] * sc);
				fX *= sc;
				fY *= sc;
				sliding[ig] = 1;
				slideLoad += fn;
				holdA[ig] = 1;
			} else {
				sliding[ig] = 0;
				holdA[ig] = 1;
				add_k(ig, kx, t1x, t1y, t1z);
				add_k(ig, ky, t2x, t2y, t2z);
				damped += std::min(dX, 0.6 * mn / h) + cShearT + (kx * kShearT / (kx + kShearT)) * dt;
			}
			Fx[ig] += fX * t1x + fY * t2x;
			Fy[ig] += fX * t1y + fY * t2y;
			Fz[ig] += fX * t1z + fY * t2z;
		}
		if (count > 0) {
			halfPatch = std::max(0.03, (maxF - minF) / 2 + spacing / 2);
		}
		// the nodes
		double hh = h * h, th = std::max(0.5, std::min(1.0, theta)), hhT = hh * th, hhR = hh * (1 - th);
		for (int im = 0; im < N; im++) {
			double a11 = mn + hhT * Kxx[im], a12 = hhT * Kxy[im], a13 = hhT * Kxz[im], a22 = mn + hhT * Kyy[im], a23 = hhT * Kyz[im], a33 = mn + hhT * Kzz[im];
			double kvx = Kxx[im] * Vx[im] + Kxy[im] * Vy[im] + Kxz[im] * Vz[im], kvy = Kxy[im] * Vx[im] + Kyy[im] * Vy[im] + Kyz[im] * Vz[im];
			double kvz = Kxz[im] * Vx[im] + Kyz[im] * Vy[im] + Kzz[im] * Vz[im];
			double b1 = mn * Vx[im] + h * Fx[im] + hh * Bx[im] - hhR * kvx, b2 = mn * Vy[im] + h * Fy[im] + hh * By[im] - hhR * kvy;
			double b3 = mn * Vz[im] + h * Fz[im] + hh * Bz[im] - hhR * kvz;
			double c11 = a22 * a33 - a23 * a23, c12 = a13 * a23 - a12 * a33, c13 = a12 * a23 - a13 * a22;
			double det = a11 * c11 + a12 * c12 + a13 * c13;
			if (implicit && det > 1e-12) {
				double c22 = a11 * a33 - a13 * a13, c23 = a12 * a13 - a11 * a23, c33 = a11 * a22 - a12 * a12;
				Vx[im] = (c11 * b1 + c12 * b2 + c13 * b3) / det;
				Vy[im] = (c12 * b1 + c22 * b2 + c23 * b3) / det;
				Vz[im] = (c13 * b1 + c23 * b2 + c33 * b3) / det;
			} else {
				Vx[im] += Fx[im] / mn * h;
				Vy[im] += Fy[im] / mn * h;
				Vz[im] += Fz[im] / mn * h;
			}
			Px[im] += Vx[im] * h;
			Py[im] += Vy[im] * h;
			Pz[im] += Vz[im] * h;
			if (implicit && holdA[im]) {
				ux[im] = (float)(ux[im] + (Vx[im] * t1xA[im] + Vy[im] * t1yA[im] + Vz[im] * t1zA[im]) * h);
				uy[im] = (float)(uy[im] + (Vx[im] * t2xA[im] + Vy[im] * t2yA[im] + Vz[im] * t2zA[im]) * h);
			}
			double ex = Px[im] - Ox[im], ey = Py[im] - Oy[im], ez = Pz[im] - Oz[im];
			double e2 = ex * ex + ey * ey + ez * ez;
			if (e2 > 0.04 * R * R) {
				double es = 0.2 * R / std::sqrt(e2);
				Px[im] = Ox[im] + ex * es;
				Py[im] = Oy[im] + ey * es;
				Pz[im] = Oz[im] + ez * es;
				Vx[im] = OVx[im];
				Vy[im] = OVy[im];
				Vz[im] = OVz[im];
			}
		}
		if (implicit) {
			double hT = h * th;
			for (int bc = 0; bc < beamCount; bc++) {
				if (bKind[bc] != 2 || bK[bc] == 0) {
					continue;
				}
				int na2 = bA[bc], nc2 = bB[bc] - N;
				double relC = ((Vx[na2] - IVx[nc2]) * bDx[bc] + (Vy[na2] - IVy[nc2]) * bDy[bc] + (Vz[na2] - IVz[nc2]) * bDz[bc]) * hT * bK[bc];
				rim_force(nc2, relC * bDx[bc], relC * bDy[bc], relC * bDz[bc]);
			}
			for (int ns = 0; ns < N; ns++) {
				double rvx2 = Vx[ns] - OVx[ns], rvy2 = Vy[ns] - OVy[ns], rvz2 = Vz[ns] - OVz[ns];
				double relT = (rvx2 * Tx[ns] + rvy2 * Ty[ns] + rvz2 * Tz[ns]) * hT * kShearT, relL = (rvx2 * L.x + rvy2 * L.y + rvz2 * L.z) * hT * kShearL;
				rim_force(ns, relT * Tx[ns] + relL * L.x, relT * Ty[ns] + relL * L.y, relT * Tz[ns] + relL * L.z);
			}
		}
		if (!lockedSpin) {
			omS += h * (hubAcc[3] - tq0) / inertiaW;
		}
		omSum += omS;
	}
	double fHubX = hubAcc[0], fHubY = hubAcc[1], fHubZ = hubAcc[2], torque = hubAcc[3];
	rOmegaOut = omS;
	rOmegaAvg = omSum / n;
	phase += rOmegaAvg * dt;
	frHx = hub.x + vel.x * 0.5 * dt;
	frHy = hub.y + vel.y * 0.5 * dt;
	frHz = hub.z + vel.z * 0.5 * dt;
	frFx = F.x;
	frFy = F.y;
	frFz = F.z;
	frUx = U.x;
	frUy = U.y;
	frUz = U.z;
	frameOk = true;
	if (phase > 1e4 || phase < -1e4) {
		phase = std::fmod(phase, 2 * M_PI);
	}
	// a shell that has blown up starts again on the shape of the tyre, and the car gets nothing this step
	if (!(std::isfinite(fHubX) && std::isfinite(fHubY) && std::isfinite(fHubZ)) || std::abs(fHubX) + std::abs(fHubY) + std::abs(fHubZ) > 1e7) {
		started = false;
		filtered = false;
		rContacts = 0;
		rNormal = Vector3();
		rFriction = Vector3();
		loadPrev = 0;
		return false;
	}
	double af = forceFilter > 0 ? 1 - std::exp(-dt / forceFilter) : 1;
	if (!filtered || jumped) {
		fltX = fHubX / n;
		fltY = fHubY / n;
		fltZ = fHubZ / n;
		fltT = torque / n;
		filtered = true;
	} else {
		fltX += af * (fHubX / n - fltX);
		fltY += af * (fHubY / n - fltY);
		fltZ += af * (fHubZ / n - fltZ);
		fltT += af * (torque / n - fltT);
	}
	double hubFx = fltX, hubFy = fltY, hubFz = fltZ, hubTorque = torque / n;
	double rawX = fHubX / n, rawY = fHubY / n, rawZ = fHubZ / n;
	rContacts = count;
	rMaxDepth = maxDepth;
	rAxleTorque = hubTorque;
	rDampSlope = damped / n;
	for (int is = 0; is < N; is++) {
		if (inContact[is]) {
			double sd = std::sqrt((Px[is] - Ox[is]) * (Px[is] - Ox[is]) + (Py[is] - Oy[is]) * (Py[is] - Oy[is]) + (Pz[is] - Oz[is]) * (Pz[is] - Oz[is]));
			if (sd > sag) {
				sag = sd;
			}
		}
	}
	rSag = sag;
	if (count == 0 || sumFn <= 0) {
		rPatch = 0;
		rNormal = Vector3();
		rFriction = Vector3();
		rSlidingShare = 0;
		rUsed = 0;
		loadPrev = 0;
		return false;
	}
	double nl = std::sqrt(nxs * nxs + nys * nys + nzs * nzs);
	if (nl == 0) {
		nl = 1;
	}
	Vector3 sn(nxs / nl, nys / nl, nzs / nl);
	rSurfaceNormal = sn;
	rCentre = Vector3(cxs / sumFn, cys / sumFn, czs / sumFn);
	rSurface = ground->surface_of(bestTri);
	rSurfaceName = ground->surface_name(bestTri);
	rPatch = 2 * halfPatch;
	rCentreAlong = alongSum / sumFn;
	// (the rim is a short cylinder: the road meets it at its radius across the axle, and at its half width along the axle, for a wheel lying flat)
	double along_axle = std::min(1.0, (double)std::abs(sn.x * L.x + sn.y * L.y + sn.z * L.z));
	double rimR = (R * std::max(0.3, std::min(0.9, innerRatio)) + 0.01) * std::sqrt(1 - along_axle * along_axle) + 0.42 * width * along_axle;
	double hubH = (hub.x - rCentre.x) * sn.x + (hub.y - rCentre.y) * sn.y + (hub.z - rCentre.z) * sn.z;
	// (the rim strikes a road that lies under the hub. A patch out on the side of the tyre, on the edge of a ramp, has only air under the hub; and a hub
	// past the plane is no deeper than the road at the rim: a metre there is a million newtons)
	hubH = std::max(0.0, hubH);
	bool under = false;
	if (hubH < rimR) {
		for (int t : list) {
			double px, py, pz, tx, ty, tz;
			int where;
			ground->closest(t, hub.x, hub.y, hub.z, px, py, pz, where);
			ground->normal_of(t, tx, ty, tz);
			if (where == 0 && std::abs(tx * sn.x + ty * sn.y + tz * sn.z) > 0.9) {
				under = true;
				break;
			}
		}
	}
	if (under) {
		double vnRim = vel.x * sn.x + vel.y * sn.y + vel.z * sn.z;
		// (the rim comes on gradually: the tyre folds under it over the first 2 cm, then it is the stop)
		double rimIn = rimR - hubH, rimSoft = 0.02, fRim = rimStiffness * (rimIn < rimSoft ? rimIn * rimIn / (2 * rimSoft) : rimIn - rimSoft / 2) - (vnRim < 0 ? rimDamping * vnRim * std::min(1.0, rimIn / rimSoft) : 0);
		hubFx += fRim * sn.x;
		hubFy += fRim * sn.y;
		hubFz += fRim * sn.z;
		rRimStrike = fRim;
	} else {
		rRimStrike = 0;
	}
	// a wheel that lies on its side: the sidewall folds and keeps most of what it is given, it does not throw the car back up (the shell of nodes is a stiff, nearly
	// lossless spring that way round)
	double flank = along_axle <= 0.5 ? 0.0 : std::min(1.0, (along_axle - 0.5) / 0.3);
	if (flank > 0) {
		double vnFlank = vel.x * sn.x + vel.y * sn.y + vel.z * sn.z, cFlank = 2 * 0.8 * std::sqrt(verticalStiffness * std::max(500.0, staticLoad) / 9.81);
		double fFlank = -cFlank * flank * vnFlank;
		hubFx += fFlank * sn.x;
		hubFy += fFlank * sn.y;
		hubFz += fFlank * sn.z;
	}
	double vnHub = vel.x * sn.x + vel.y * sn.y + vel.z * sn.z, cHub = verticalDamping * std::min(1.0, loadPrev / std::max(1.0, 0.3 * staticLoad));
	hubFx -= cHub * vnHub * sn.x;
	hubFy -= cHub * vnHub * sn.y;
	hubFz -= cHub * vnHub * sn.z;
	double fn0 = hubFx * sn.x + hubFy * sn.y + hubFz * sn.z;
	double fnRaw = rawX * sn.x + rawY * sn.y + rawZ * sn.z;
	rNormal = sn * fn0;
	rFriction = Vector3(rawX - sn.x * fnRaw, rawY - sn.y * fnRaw, rawZ - sn.z * fnRaw);
	loadPrev = std::max(0.0, fn0);
	rSlidingShare = slideLoad / std::max(sumFn, 1.0);
	double fm = rFriction.length();
	rUsed = fm / std::max(1.0, surfMuV * std::max(loadPrev, 1.0));
	return true;
}

Dictionary TyreShell::result() const {
	Dictionary d;
	d["normal"] = rNormal;
	d["friction"] = rFriction;
	d["centre"] = rCentre;
	d["surface_normal"] = rSurfaceNormal;
	d["surface"] = rSurfaceName;
	d["contacts"] = rContacts;
	d["max_depth"] = rMaxDepth;
	d["sag"] = rSag;
	d["patch"] = rPatch;
	d["sliding_share"] = rSlidingShare;
	d["used"] = rUsed;
	d["omega_out"] = rOmegaOut;
	d["omega_avg"] = rOmegaAvg;
	d["damp_slope"] = rDampSlope;
	d["axle_torque"] = rAxleTorque;
	d["substeps"] = rSubsteps;
	d["substeps_wanted"] = rSubstepsWanted;
	d["rim_strike"] = rRimStrike;
	d["centre_along"] = rCentreAlong;
	d["load_prev"] = loadPrev;
	return d;
}

PackedFloat32Array TyreShell::deformation() {
	PackedFloat32Array out;
	if (!frameOk || N == 0) {
		return out;
	}
	out.resize(rings * BINS);
	std::vector<double> o(rings * BINS, 0.0), w(rings * BINS, 0.0);
	for (int j = 0; j < rings; j++) {
		for (int k = 0; k < segs; k++) {
			int i = j * segs + k;
			double qx = Px[i] - frHx, qy = Py[i] - frHy, qz = Pz[i] - frHz;
			double y = qx * frUx + qy * frUy + qz * frUz, f = qx * frFx + qy * frFy + qz * frFz;
			double ox = Ox[i] - frHx, oy = Oy[i] - frHy, oz = Oz[i] - frHz;
			double yo = ox * frUx + oy * frUy + oz * frUz, fo = ox * frFx + oy * frFy + oz * frFz;
			double d = std::sqrt(yo * yo + fo * fo) - std::sqrt(y * y + f * f);
			double ang = std::atan2(f, y);
			if (ang < 0) {
				ang += 2 * M_PI;
			}
			double t = ang / (2 * M_PI) * BINS;
			int b0 = (int)std::floor(t);
			double fr = t - b0;
			int b1 = (b0 + 1) % BINS;
			b0 = b0 % BINS;
			o[j * BINS + b0] += d * (1 - fr);
			w[j * BINS + b0] += 1 - fr;
			o[j * BINS + b1] += d * fr;
			w[j * BINS + b1] += fr;
		}
	}
	for (int jj = 0; jj < rings; jj++) {
		int base = jj * BINS;
		for (int b = 0; b < BINS; b++) {
			if (w[base + b] > 0.05) {
				o[base + b] /= w[base + b];
			}
		}
		for (int b2 = 0; b2 < BINS; b2++) {
			if (w[base + b2] <= 0.05) {
				int lo = (b2 + BINS - 1) % BINS, hi = (b2 + 1) % BINS;
				o[base + b2] = 0.5 * (o[base + lo] + o[base + hi]);
			}
		}
	}
	for (int z = 0; z < rings * BINS; z++) {
		out.set(z, (float)o[z]);
	}
	return out;
}

Dictionary TyreShell::shells() const {
	Dictionary d;
	PackedVector3Array outer, inner;
	PackedByteArray contact, slide, bclass;
	PackedInt32Array a, b;
	PackedFloat32Array strain;
	outer.resize(N);
	inner.resize(N);
	contact.resize(N);
	slide.resize(N);
	for (int i = 0; i < N; i++) {
		outer.set(i, Vector3(Px[i], Py[i], Pz[i]));
		inner.set(i, Vector3(Ix[i], Iy[i], Iz[i]));
		contact.set(i, inContact[i]);
		slide.set(i, sliding[i]);
	}
	a.resize(beamCount);
	b.resize(beamCount);
	strain.resize(beamCount);
	bclass.resize(beamCount);
	for (int k = 0; k < beamCount; k++) {
		a.set(k, bA[k]);
		b.set(k, bB[k]);
		strain.set(k, bStrain[k]);
		bclass.set(k, bClass[k]);
	}
	d["rings"] = rings;
	d["segments"] = segs;
	d["count"] = N;
	d["outer"] = outer;
	d["inner"] = inner;
	d["contact"] = contact;
	d["sliding"] = slide;
	d["beams"] = beamCount;
	d["a"] = a;
	d["b"] = b;
	d["strain"] = strain;
	d["bclass"] = bclass;
	return d;
}

void TyreShell::reset() {
	started = false;
	filtered = false;
	loadPrev = 0;
	for (int i = 0; i < N; i++) {
		ux[i] = uy[i] = 0;
		inContact[i] = 0;
		sliding[i] = 0;
	}
}

void TyreShell::_bind_methods() {
	ClassDB::bind_method(D_METHOD("configure", "settings"), &TyreShell::configure);
	ClassDB::bind_method(D_METHOD("step", "dt", "hub", "vel", "l", "f", "u", "omega", "ground", "mu", "sliding", "lateral_grip"), &TyreShell::step);
	ClassDB::bind_method(D_METHOD("friction_load"), &TyreShell::friction_load);
	ClassDB::bind_method(D_METHOD("result"), &TyreShell::result);
	ClassDB::bind_method(D_METHOD("deformation"), &TyreShell::deformation);
	ClassDB::bind_method(D_METHOD("get_rings"), &TyreShell::get_rings);
	ClassDB::bind_method(D_METHOD("get_segments"), &TyreShell::get_segments);
	ClassDB::bind_method(D_METHOD("get_width"), &TyreShell::get_width);
	ClassDB::bind_method(D_METHOD("shells"), &TyreShell::shells);
	ClassDB::bind_method(D_METHOD("reset"), &TyreShell::reset);
}

} // namespace orsound
