#!/usr/bin/env python3
"""
make-cbr600.py

Writes web/cars/honda-cbr600/cbr600.glb: a prototype of a Honda CBR 600 RR (the 2007 to 2012 shape) to run in the game as a motorcycle, and
web/cars/honda-cbr600/car.json when there is none (an existing one is not touched).

    python3 tools/make-cbr600.py

The bike faces +Z, Y is up, X is to the left; the origin is at the height of the axles, midway between them (wheelbase 1.375 m, the road is 0.305 m below the
origin). The game wants four wheels, so the bike has the two it needs and two more of one millimetre at the same places (wheel_FR, wheel_RR): the physics
treats a motorcycle as a pair of wheels at every axle with no track in between (see MOTORCYCLE.md). The front end that steers (the fork, the triple clamp, the
handlebar, the front mudguard) is a set of parts called brake_<name>_FL: the loader hangs the parts of a brake caliper on the steering of the wheel, and these
turn with it without spinning.
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import glbtools as g

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "cars", "honda-cbr600")
OUT = os.path.join(ROOT, "cbr600.glb")

g.use_materials({
    "paint": [0.74, 0.04, 0.05, 1], "white": [0.92, 0.92, 0.94, 1], "black": [0.06, 0.06, 0.07, 1], "alu": [0.62, 0.64, 0.68, 1],
    "tyre": [0.05, 0.05, 0.055, 1], "rim": [0.1, 0.1, 0.11, 1], "disc": [0.7, 0.7, 0.72, 1], "glass": [0.12, 0.16, 0.2, 0.55], "steel": [0.4, 0.42, 0.45, 1],
    "gold": [0.8, 0.62, 0.15, 1]
})
box, bar, merge, part = g.box, g.bar, g.merge, g.part

WHEELBASE = 1.375
FRONT, REAR = WHEELBASE / 2, -WHEELBASE / 2
GROUND = -0.305


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def norm(v):
    l = math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2) or 1
    return (v[0] / l, v[1] / l, v[2] / l)


def mesh_from(points, faces):
    """Geometry (positions, normals, indices) from points [(x, y, z)] and triangles, with smooth normals (the normals of the faces that meet at a point, added)."""
    acc = [[0.0, 0.0, 0.0] for _ in points]
    for a, b, c in faces:
        pa, pb, pc = points[a], points[b], points[c]
        n = cross((pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]), (pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]))
        for i in (a, b, c):
            acc[i][0] += n[0]; acc[i][1] += n[1]; acc[i][2] += n[2]
    positions, normals, indices = [], [], []
    for p, n in zip(points, acc):
        positions += list(p)
        normals += list(norm(n))
    for f in faces:
        indices += list(f)
    return positions, normals, indices


def ring(z, cx, cy, hw, hh, n=2.4, segments=22):
    """A rounded ring (a superellipse) at z: centre (cx, cy), half width hw, half height hh."""
    out = []
    for i in range(segments):
        t = 2 * math.pi * i / segments
        c, s = math.cos(t), math.sin(t)
        out.append((cx + hw * math.copysign(abs(c) ** (2 / n), c), cy + hh * math.copysign(abs(s) ** (2 / n), s), z))
    return out


def loft(rings, close=True):
    """A body through rings of the same number of points, closed at the ends."""
    points, faces = [], []
    n = len(rings[0])
    for r in rings:
        points += r
    for k in range(len(rings) - 1):
        for i in range(n):
            a, b = k * n + i, k * n + (i + 1) % n
            c, d = (k + 1) * n + (i + 1) % n, (k + 1) * n + i
            faces += [(a, d, c), (a, c, b)]
    if close:
        for k, flip in ((0, True), (len(rings) - 1, False)):
            r = rings[k]
            centre = (sum(p[0] for p in r) / n, sum(p[1] for p in r) / n, sum(p[2] for p in r) / n)
            ci = len(points)
            points.append(centre)
            for i in range(n):
                a, b = k * n + i, k * n + (i + 1) % n
                faces.append((ci, b, a) if flip else (ci, a, b))
    return mesh_from(points, faces)


def tyre(outer, width, rim_radius, segments=40, tube=14):
    """A tyre: a torus around the X axis, flattened to the width, with the outer radius of the tyre, centred on the pivot."""
    rm = (outer + rim_radius) / 2
    half = (outer - rim_radius) / 2
    points, faces = [], []
    for i in range(segments):
        u = 2 * math.pi * i / segments
        cu, su = math.cos(u), math.sin(u)
        for j in range(tube):
            v = 2 * math.pi * j / tube
            # the cross section: an ellipse, wider than high; the shoulders of a motorcycle tyre are round
            a = (width / 2) * math.sin(v)
            r = rm + half * math.cos(v)
            points.append((a, r * cu, r * su))
    for i in range(segments):
        for j in range(tube):
            a, b = i * tube + j, i * tube + (j + 1) % tube
            c, d = ((i + 1) % segments) * tube + (j + 1) % tube, ((i + 1) % segments) * tube + j
            faces += [(a, b, c), (a, c, d)]
    return mesh_from(points, faces)


def spokes(rim_radius, width, count=5):
    """The spokes of a cast wheel: five boxes from the hub to the rim."""
    parts = []
    for k in range(count):
        a = 2 * math.pi * k / count
        parts.append(bar((0, 0.03 * math.cos(a), 0.03 * math.sin(a)), (0, (rim_radius - 0.02) * math.cos(a), (rim_radius - 0.02) * math.sin(a)), 0.035))
    parts.append(g.cylinder_x(0.035, width))
    return merge(*parts)


def tube(a, b, thickness):
    return bar(a, b, thickness)


def mirrored(function, *args):
    """A geometry for the left (x > 0) and the right side."""
    return merge(function(1, *args), function(-1, *args))


# ---- the wheels: the tyre, the rim with its spokes and the brake disc as parts of their own, every one with the pivot at the middle of the wheel
for name, z, outer, width in (("FL", FRONT, 0.300, 0.125), ("RL", REAR, 0.310, 0.18)):
    part("wheel_" + name, (0, 0, z), tyre(outer, width, 0.216), "tyre")
    part("wheel_" + name + "_rim", (0, 0, z), merge(g.cylinder_x(0.222, width * 0.82), spokes(0.222, width * 0.9)), "rim")
    def disc(radius, x):
        p, n, i = g.cylinder_x(radius, 0.008)
        return [v + (x if k % 3 == 0 else 0) for k, v in enumerate(p)], n, i
    if name == "FL":
        part("wheel_" + name + "_disc", (0, 0, z), merge(disc(0.155, 0.075), disc(0.155, -0.075)), "disc")
    else:
        part("wheel_" + name + "_disc", (0, 0, z), disc(0.11, 0.075), "disc")
# the other two wheels of the physics: a millimetre, in the middle of the wheel
part("wheel_FR", (0, 0, FRONT), box((0.002, 0.002, 0.002)), "black")
part("wheel_RR", (0, 0, REAR), box((0.002, 0.002, 0.002)), "black")

# ---- the front end that steers, hung on the front wheel: the fork, the triple clamp, the handlebar, the mudguard (parts called brake_..._FL)
rake = math.radians(24.5)
axle = (0.0, 0.0, FRONT)
top = (axle[0], axle[1] + 0.62 * math.cos(rake), axle[2] - 0.62 * math.sin(rake))
mid = (axle[0], axle[1] + 0.32 * math.cos(rake), axle[2] - 0.32 * math.sin(rake))


# The fork is two parts. The cylinder (the upper tube, black) hangs on the steering head and stays where it is, it only turns with the steering; the leg (the lower
# leg, gold) goes with the wheel: it slides into the cylinder and out of it, in line with it, with the wheel, the disc, the brake caliper and the mudguard.
# The clamp (the triple clamp) and the handlebar stay where they are and only turn. The parts that stay and turn are called steerhead_..., the ones that go
# with the wheel and turn are called brake_..._FL (the loader hangs the parts of a brake caliper on the steering of the front wheel).
def along(l):
    return (axle[0], axle[1] + l * math.cos(rake), axle[2] - l * math.sin(rake))


def cylinder_tubes():
    out = []
    for s in (1, -1):
        a, b = along(0.30), along(0.64)
        out.append(tube((s * 0.095, a[1], a[2]), (s * 0.095, b[1], b[2]), 0.058))
    return merge(*out)


def leg_tubes():
    out = []
    for s in (1, -1):
        a, b = along(0.0), along(0.36)
        out.append(tube((s * 0.095, a[1], a[2]), (s * 0.095, b[1], b[2]), 0.044))
    return merge(*out)


part("steerhead_cylinder", (0, 0, 0), cylinder_tubes(), "black")
part("brake_fork_leg_FL", (0, 0, 0), leg_tubes(), "gold")
clamp_top, clamp_low = along(0.60), along(0.40)
part("steerhead_clamp", (0, 0, 0), merge(box((0.24, 0.05, 0.08), (0, clamp_top[1], clamp_top[2])), box((0.24, 0.045, 0.08), (0, clamp_low[1], clamp_low[2]))), "alu")
handle = merge(*[tube((s * 0.07, top[1] + 0.03, top[2] - 0.0), (s * 0.255, top[1] + 0.06, top[2] - 0.135), 0.03) for s in (1, -1)])
part("steerhead_handlebar", (0, 0, 0), handle, "black")

# The places that the rider takes hold of, as parts of their own (the driver of the game finds them by name, see Driver.js). They hang on the handlebar and turn with the steering
# (the loader takes them with the steering head): grip_L and grip_R, the rubber grips (the right one turns with the throttle), frontbrake_R, the brake lever, and clutch_L, the clutch
# lever; the origin of a lever is where the fingers go. The pivot of a part is its origin.
GRIP_Y, GRIP_Z = top[1] + 0.06, top[2] - 0.135
for side, name in ((1, "L"), (-1, "R")):
    part("grip_" + name, (side * 0.31, GRIP_Y, GRIP_Z), g.cylinder_x(0.02, 0.12), "black")
lever_at = (GRIP_Y - 0.018, GRIP_Z + 0.085)
part("frontbrake_R", (-0.30, lever_at[0], lever_at[1]), merge(tube((0.0, 0.025, -0.045), (0.01, -0.03, 0.055), 0.016), box((0.03, 0.02, 0.02), (0.0, -0.03, 0.055))), "alu")
part("clutch_L", (0.30, lever_at[0], lever_at[1]), merge(tube((0.0, 0.025, -0.045), (-0.01, -0.03, 0.055), 0.016), box((0.03, 0.02, 0.02), (0.0, -0.03, 0.055))), "alu")
part("brake_mudguard_FL", (0, 0, 0), merge(*[box((0.02, 0.03, 0.30), (s * 0.12, 0.33, FRONT - 0.02)) for s in (1, -1)], box((0.17, 0.018, 0.30), (0, 0.352, FRONT - 0.02))), "paint")
part("brake_caliper_FL", (0, 0, 0), merge(*[box((0.03, 0.09, 0.07), (s * 0.095, -0.12, FRONT + 0.08)) for s in (1, -1)]), "gold")

# ---- the frame: two spars of aluminium from the steering head over the engine to the swingarm pivot, and the sub frame to the tail
frame_parts = []
head = (0.0, 0.46, 0.43)
pivot = (0.0, -0.06, REAR + 0.30)
for s in (1, -1):
    frame_parts.append(tube((s * 0.07, 0.47, 0.43), (s * 0.15, 0.34, 0.05), 0.07))
    frame_parts.append(tube((s * 0.15, 0.34, 0.05), (s * 0.15, 0.0, REAR + 0.30), 0.07))
    frame_parts.append(tube((s * 0.15, 0.0, REAR + 0.30), (s * 0.15, -0.14, REAR + 0.30), 0.07))
    frame_parts.append(tube((s * 0.13, 0.30, REAR + 0.30), (s * 0.10, 0.40, REAR - 0.25), 0.04))
    frame_parts.append(tube((s * 0.10, 0.40, REAR - 0.25), (s * 0.09, 0.42, REAR - 0.30), 0.04))
frame_parts.append(box((0.3, 0.08, 0.1), (0, 0.45, 0.42)))
part("frame", (0, 0, 0), merge(*frame_parts), "alu")

# the swingarm: two arms from the pivot to the rear axle
swing = []
for s in (1, -1):
    swing.append(tube((s * 0.115, -0.08, REAR + 0.30), (s * 0.095, 0.0, REAR), 0.055))
swing.append(box((0.24, 0.05, 0.05), (0, -0.07, REAR + 0.28)))
part("swingarm", (0, 0, 0), merge(*swing), "alu")
part("rear_shock", (0, 0, 0), tube((0, 0.13, REAR + 0.20), (0, -0.07, REAR + 0.40), 0.05), "gold")

# ---- the engine: an inline four of 599 cc, with the head and the sump, and the exhaust under it to the silencer under the seat
engine = merge(box((0.38, 0.17, 0.36), (0, -0.04, 0.10)), box((0.34, 0.14, 0.30), (0, 0.11, 0.10)), box((0.34, 0.10, 0.30), (0, -0.16, 0.08)),
               box((0.36, 0.17, 0.20), (0, -0.01, -0.17)))
part("engine", (0, 0, 0), engine, "black")
pipes = [tube((s * 0.07 * (1 + k), 0.04 - 0.02 * k, 0.28), (s * 0.04, -0.20, 0.12), 0.035) for s in (1, -1) for k in (0, 1)]
pipes += [tube((0.04, -0.20, 0.12), (0.0, -0.21, -0.20), 0.07), tube((0.0, -0.21, -0.20), (0.115, -0.04, REAR - 0.02), 0.07)]
part("exhaust", (0, 0, 0), merge(*pipes), "steel")
part("silencer", (0, 0, 0), tube((0.115, -0.04, REAR + 0.0), (0.13, 0.06, REAR - 0.34), 0.12), "alu")

# ---- the bodywork: the fairing with the nose and the cheeks, the screen, the tank, the seat and the tail
fairing = loft([
    ring(0.93, 0, 0.30, 0.05, 0.05), ring(0.84, 0, 0.33, 0.11, 0.10), ring(0.70, 0, 0.30, 0.19, 0.17), ring(0.50, 0, 0.18, 0.26, 0.24),
    ring(0.28, 0, 0.08, 0.27, 0.24), ring(0.05, 0, -0.02, 0.22, 0.2), ring(-0.12, 0, -0.10, 0.17, 0.16)])
part("fairing", (0, 0, 0), fairing, "paint")
part("belly", (0, 0, 0), loft([ring(0.35, 0, -0.18, 0.12, 0.05), ring(0.05, 0, -0.22, 0.16, 0.06), ring(-0.22, 0, -0.20, 0.14, 0.05)]), "white")
part("screen", (0, 0, 0), loft([ring(0.62, 0, 0.50, 0.15, 0.003, 2.0, 12), ring(0.50, 0, 0.60, 0.13, 0.003, 2.0, 12), ring(0.42, 0, 0.65, 0.10, 0.003, 2.0, 12)]), "glass")
part("headlight", (0, 0, 0), merge(*[box((0.12, 0.05, 0.03), (s * 0.09, 0.40, 0.80)) for s in (1, -1)]), "white")
part("tank", (0, 0, 0), loft([
    ring(0.40, 0, 0.49, 0.11, 0.07), ring(0.25, 0, 0.52, 0.16, 0.10), ring(0.05, 0, 0.51, 0.18, 0.11), ring(-0.12, 0, 0.47, 0.15, 0.09), ring(-0.22, 0, 0.44, 0.10, 0.06)]), "paint")
part("seat", (0, 0, 0), loft([
    ring(-0.10, 0, 0.42, 0.14, 0.04), ring(-0.30, 0, 0.45, 0.17, 0.045), ring(-0.52, 0, 0.47, 0.17, 0.045), ring(-0.66, 0, 0.47, 0.13, 0.04)]), "black")
part("tail", (0, 0, 0), loft([
    ring(-0.60, 0, 0.45, 0.12, 0.06), ring(-0.80, 0, 0.50, 0.13, 0.06), ring(-0.98, 0, 0.55, 0.11, 0.04), ring(-1.04, 0, 0.56, 0.09, 0.03)]), "paint")
part("taillight", (0, 0, 0), box((0.14, 0.03, 0.02), (0, 0.56, -1.05)), "paint")
part("mirrors", (0, 0, 0), merge(*[merge(tube((s * 0.15, 0.62, 0.45), (s * 0.24, 0.72, 0.36), 0.015), box((0.09, 0.05, 0.02), (s * 0.25, 0.72, 0.35))) for s in (1, -1)]), "black")
# the footpegs (footpeg_L and footpeg_R: where the feet of the rider go) and the shift lever (shifter_L): its origin is its hinge, the lever goes forward from it to a toe peg and turns about
# the x axis (the game turns it a little with every shift, and the left foot follows the toe peg)
for side, name in ((1, "L"), (-1, "R")):
    part("footpeg_" + name, (side * 0.21, -0.10, -0.12), merge(tube((side * -0.08, 0.0, 0.0), (side * -0.03, 0.0, 0.0), 0.025), box((0.05, 0.015, 0.08))), "alu")
part("shifter_L", (0.17, -0.13, -0.24), merge(tube((0.0, 0.0, 0.0), (0.0, 0.015, 0.20), 0.02), box((0.04, 0.012, 0.03), (0.0, 0.02, 0.215))), "alu")

g.write(OUT, "honda-cbr600", "OpenRacer make-cbr600.py")

# ---- car.json: only when there is none
CAR = os.path.join(ROOT, "car.json")
if not os.path.exists(CAR):
    car = {
        "name": "Honda CBR 600 RR",
        "description": "A 600 cc supersport motorcycle (prototype): 118 hp, 195 kg, it leans into the corners by itself.",
        "type": "motorcycle",
        "model": {"type": "gltf", "file": "cars/honda-cbr600/cbr600.glb", "rotation_y": 0, "scale": 1, "offset": [0, 0, 0]},
        "wheels": {"mode": "model", "nodes": {
            "FR": ["wheel_FR"], "FL": ["wheel_FL", "wheel_FL_rim", "wheel_FL_disc"], "RL": ["wheel_RL", "wheel_RL_rim", "wheel_RL_disc"], "RR": ["wheel_RR"]}},
        "dimensions": {"length": 2.04, "width": 0.69, "height": 1.12},
        "chassis": {
            "mass": 270, "wheelbase": WHEELBASE, "front_track": 0.04, "rear_track": 0.04, "weight_distribution": 0.49, "cg_height": 0.62,
            "suspension_travel": 0.12, "tire_diameter": 0.61, "drag_coefficient": 0.6, "max_steer_deg": 22,
            "roll_front": 0.5, "spring_front": 17000, "spring_rear": 24000, "damping_front": 0.45, "damping_rear": 0.5,
            "downforce_front": 0, "downforce_rear": 0, "ackermann": 0, "ride_front": 0, "ride_rear": 0,
            "roll_center_front": 0.3, "roll_center_rear": 0.3, "toe_front": 0, "toe_rear": 0, "camber_front": 0, "camber_rear": 0, "roll_camber": 0
        },
        "motorcycle": {"rake_deg": 24.5, "max_lean_deg": 52, "balance": 1.0, "rider_mass": 75, "max_lateral_g": 0.9},
        "drivetrain": {
            "drive": "rwd", "diff": "welded", "diff_preload": 0, "diff_power": 0, "diff_coast": 0, "center_diff": "lsd", "center_split": 0.4,
            "gear_ratios": [2.75, 2.0, 1.667, 1.444, 1.304, 1.208], "reverse_ratio": 3.0, "final_drive": 6.03, "efficiency": 0.93, "shift_time": 0.12,
            "clutch": 3, "diff_lock": 0, "clutch_start_rpm": 2800, "clutch_full_rpm": 4000
        },
        "engine": {
            "idle_rpm": 1400, "limiter_rpm": 15500, "inertia": 0.06,
            "torque_curve": [[0, 0], [1000, 30], [2000, 38], [3000, 42], [4000, 45], [5000, 47], [6000, 50], [7000, 52], [8000, 55], [9000, 58], [10000, 62],
                             [11000, 65], [11250, 66], [12000, 65.5], [13000, 63], [13500, 60.5], [14000, 57], [15000, 48], [16000, 20]],
            "power_scale": 1, "braking_scale": 0.3, "limiter_hz": 20, "two_step_rpm": 8000, "launch_rpm": 9000
        },
        "brakes": {"front": 380, "rear": 110},
        "tyres": {"compound": "sport", "model": "cylinder", "damage": False, "grip": 1.1, "grip_balance": 1, "cornering": 1, "rolling_resistance": 0.012,
                  "heating": 1, "life": 1, "pressure_front": 2.5, "pressure_rear": 2.5},
        "fuel": {"tank": 18, "use": 1},
        "assists": {"tc_allowance": 1, "esc_gain": 0},
        "cameras": {
            "follow": {"distance": 3.4, "height": 1.3, "look_height": 0.7, "smoothing": 3.5, "fov_standing": 45, "fov_fast": 75, "fov_full_speed": 70, "dolly": 1},
            "cockpit": {"position": [0, 0.78, 0.18], "fov": 80}
        },
        # the preset "Inline-4 0.6 L (supersport)" of web/js/EngineSim.js
        "sound": {"engine_sim": {
            "layout": "inline-4", "bore": 67, "stroke": 42.5, "rod": 100, "compression_ratio": 12.2, "intake_duration": 256, "exhaust_duration": 250,
            "intake_lift": 9.0, "exhaust_lift": 8.2, "intake_lobe_centre": 106, "exhaust_lobe_centre": 106, "intake_flow": 105, "exhaust_flow": 85,
            "primary_length": 0.3, "primary_flow": 90, "exhaust_length": 1.0, "outlet_flow": 300, "exhaust_systems": 1, "impulse_response": "sharp_01",
            "timing": [[0, 10], [2000, 14], [6000, 28], [10000, 36], [14000, 40], [17000, 40]], "input_cutoff": 3500, "noise_cutoff": 3500}}
    }
    os.makedirs(ROOT, exist_ok=True)
    with open(CAR, "w") as f:
        json.dump(car, f, indent=1)
    print("wrote " + CAR)
