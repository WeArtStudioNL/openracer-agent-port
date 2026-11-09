// The shell tyre of the browser game (web/js/TyreShell.js): the tyre as two shells of nodes with beams between them.
// The inner shell is the rim (fixed to the wheel, it turns with it); the outer shell is the tread and the shoulder,
// nodes with a mass that move on their own, held by cables to the rim (the carcass), the belt between them, the
// pressure of the air, the shear of the tread against the rim, and the road (a stiff spring out of a triangle and
// the bristles that hold a node on it). What the car gets is the force of the beams on the rim. TyreGround holds the
// triangles of the ground (Ground.js for the tyre: the boxes, the nearest point of a triangle, the surface).
//
// The port keeps the arithmetic of TyreShell.js line for line (the same names where it can); it is C++ because the
// shell takes up to 14 small steps of a few hundred nodes and beams per wheel and per step of the car.

#pragma once

#include <godot_cpp/classes/ref.hpp>
#include <godot_cpp/classes/ref_counted.hpp>
#include <godot_cpp/variant/dictionary.hpp>
#include <godot_cpp/variant/packed_float32_array.hpp>
#include <godot_cpp/variant/packed_int32_array.hpp>
#include <godot_cpp/variant/packed_string_array.hpp>
#include <godot_cpp/variant/packed_vector3_array.hpp>
#include <godot_cpp/variant/transform3d.hpp>
#include <godot_cpp/variant/vector3.hpp>

#include <cstdint>
#include <unordered_map>
#include <vector>

namespace orsound {

class TyreGround : public godot::RefCounted {
	GDCLASS(TyreGround, godot::RefCounted)

public:
	void clear();
	// the triangles of a collision shape (faces as ConcavePolygonShape3D.get_faces gives them), placed by xf, with a surface
	void add_faces(const godot::PackedVector3Array &faces, const godot::Transform3D &xf, const godot::String &surface);
	int get_count() const { return (int)surf.size(); }
	godot::String surface_name(int t) const;

	// (for the shell)
	void near(double x, double y, double z, double r, std::vector<int> &out);
	bool box_near(int t, double x, double y, double z, double r) const {
		const double *b = &box[(size_t)t * 6];
		return !(b[0] > x + r || b[3] < x - r || b[1] > y + r || b[4] < y - r || b[2] > z + r || b[5] < z - r);
	}
	// the nearest point of triangle t to (x, y, z): its squared distance; region 0 inside the face, 1 on an edge or a corner
	double closest(int t, double x, double y, double z, double &nx, double &ny, double &nz, int &region) const;
	void normal_of(int t, double &x, double &y, double &z) const {
		const double *d = &tri[(size_t)t * 12 + 9];
		x = d[0];
		y = d[1];
		z = d[2];
	}
	int surface_of(int t) const { return t >= 0 && t < (int)surf.size() ? surf[t] : 0; }
	int64_t tests = 0;

protected:
	static void _bind_methods();

private:
	std::vector<double> tri;  // per triangle: a, b, c, normal (12)
	std::vector<double> box;  // per triangle: lo, hi (6)
	std::vector<int> surf;
	std::vector<int> stamp;
	int mark = 0;
	godot::PackedStringArray names;
	std::unordered_map<int64_t, std::vector<int>> cells;
	static constexpr double CELL = 4.0;
	static int64_t key(int64_t gx, int64_t gz) { return (gx << 32) ^ (gz & 0xffffffffLL); }
};

class TyreShell : public godot::RefCounted {
	GDCLASS(TyreShell, godot::RefCounted)

public:
	// the settings of the tyre (the keys of TyreShell.js in snake case: rings, segments, width, pressure, inner_ratio, carcass,
	// tyre_mass, stiff_x, stiff_y, vertical_stiffness, vertical_damping, static_load, round, shoulder, ...) and of its wheel
	// (radius, inertia); a key that is not there keeps its value
	void configure(const godot::Dictionary &p);
	// one step of the car (TyreShell.step): the hub, its velocity, the axes of the wheel (L to the left along the axle, F
	// forward in its plane, U up), the turn of the wheel, the ground, the friction of the road (mu and sliding, for the
	// load of friction_load()) and the share of the grip across. True when the tyre touches the road.
	bool step(double dt, const godot::Vector3 &hub, const godot::Vector3 &vel, const godot::Vector3 &L, const godot::Vector3 &F,
			const godot::Vector3 &U, double omega, const godot::Ref<TyreGround> &ground, double mu, double sliding, double lateral_grip);
	// the load that the friction of the next step is asked for (frictionOf(Math.max(load0, loadPrev)))
	double friction_load() const;
	// what the step found: normal, friction, centre, surface_normal (Vector3), surface (int), contacts, max_depth, sag,
	// patch, sliding_share, used, omega_out, omega_avg, damp_slope, axle_torque, substeps, rim_strike, centre_along
	godot::Dictionary result() const;
	// the deformation of the tread for the model (TyreDeform.js): per ring and per place round the wheel (72), in m
	godot::PackedFloat32Array deformation();
	int get_rings() const { return rings; }
	int get_segments() const { return segs; }
	double get_width() const { return width; }
	// for the debug view: the nodes of the two shells, the beams and their strain
	godot::Dictionary shells() const;
	void reset();

	// the settings (TyreShell.js)
	double forceFilter = 0.0015, torsion = 0, beltMul = 0.25, stepAngle = 0.7, rimStiffness = 1.5e6, rimDamping = 8000, roadStop = 0.5;
	double bristleDamping = 0.3, shearDamping = 1.0, shearDampingLat = 0.15, shoulder = 0, softShare = 1.8;
	double setRings = 3, setSegments = 36, setWidth = 0;
	double stiffX = 20, stiffY = 18, stribeck = 8, tolerance = 0.004;
	double verticalStiffness = 220000, verticalDamping = 3000, staticLoad = 3000, pressure = 2.2, innerRatio = 0.62, carcass = 0, tyreMass = 0;
	double roadStiffness = 4, roadDamping = 0.05, theta = 0.6, maxSubstep = 0.00022, maxSubsteps = 14, beamDamping = 0.3;
	bool beltTwoSided = false, lockedSpin = false, round = false, implicit = false;
	double wheelRadius = 0.33, wheelInertia = 1.6;

protected:
	static void _bind_methods();

private:
	std::vector<double> key_now() const;
	void build();
	void place_shells(double cx, double cy, double cz, const godot::Vector3 &L, const godot::Vector3 &F, const godot::Vector3 &U, double ph,
			double omega, const godot::Vector3 &vel);
	void shell_normals();
	bool contact_at(double x, double y, double z, const godot::Vector3 &hub, TyreGround *ground, const std::vector<int> &list, double tol);
	void rim_force(int i, double fx, double fy, double fz);
	void add_k(int i, double k, double dx, double dy, double dz);
	void add_kv(int i, double k, double dx, double dy, double dz, double vax, double vay, double vaz);

	int rings = 3, segs = 36, N = 0;
	double width = 0, radius = 0, phase = 0;
	std::vector<double> builtFor;
	std::vector<double> nodeLat, nodeRad, innerLat, innerRad;
	std::vector<double> Px, Py, Pz, Vx, Vy, Vz, Fx, Fy, Fz, Ix, Iy, Iz, IVx, IVy, IVz, Ox, Oy, Oz, OVx, OVy, OVz, Tx, Ty, Tz, Nx, Ny, Nz;
	std::vector<std::vector<int>> blockList, nodeList;
	std::vector<uint8_t> nearNode, holdA, inContact, sliding;
	std::vector<double> Bx, By, Bz, Kxx, Kxy, Kxz, Kyy, Kyz, Kzz, t1xA, t1yA, t1zA, t2xA, t2yA, t2zA, eFn, eNx, eNy, eNz, ownDepth, ownWet, ownNx, ownNy, ownNz;
	std::vector<int> ownTri;
	std::vector<double> fnNode, cnx, cny, cnz, ux, uy;
	std::vector<int> ctri;
	std::vector<int> bA, bB;
	std::vector<double> bL0, bLmin, bK, bDx, bDy, bDz;
	std::vector<float> bStrain;
	std::vector<uint8_t> bClass, bKind;
	int beamCount = 0;
	bool started = false;
	double classK[5] = { 0, 0, 0, 0, 0 }, beamDamp[5] = { 0, 0, 0, 0, 0 }, beamDampHalf[5] = { 0, 0, 0, 0, 0 };
	double hubAcc[4] = { 0, 0, 0, 0 }, hubC[3] = { 0, 0, 0 };
	double axisLx = 0, axisLy = 0, axisLz = 0, upX = 0, upY = 1, upZ = 0;
	double cDepth = 0, cNx = 0, cNy = 0, cNz = 0;
	double cWet = 1, wetSize = 0.07;  // how much of a piece of tread touches: all of it on a face, a strip that grows with the depth on an edge
	int cTri = -1;
	double halfPatch = 0.1;
	double loadPrev = 0, fltX = 0, fltY = 0, fltZ = 0, fltT = 0;
	bool filtered = false;
	// the frame of the last step (for the deformation)
	bool frameOk = false;
	double frHx = 0, frHy = 0, frHz = 0, frFx = 0, frFy = 0, frFz = 1, frUx = 0, frUy = 1, frUz = 0;
	// the results
	godot::Vector3 rNormal, rFriction, rCentre, rSurfaceNormal = godot::Vector3(0, 1, 0);
	godot::String rSurfaceName = "road";
	int rSurface = 0, rContacts = 0, rSubsteps = 0, rSubstepsWanted = 0;
	double rMaxDepth = 0, rSag = 0, rPatch = 0, rSlidingShare = 0, rUsed = 0, rOmegaOut = 0, rOmegaAvg = 0, rDampSlope = 0, rAxleTorque = 0;
	double rRimStrike = 0, rCentreAlong = 0;
	bool rHasOmega = false;
};

} // namespace orsound
