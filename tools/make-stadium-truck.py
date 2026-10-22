#!/usr/bin/env python3
"""
make-stadium-truck.py

Writes web/cars/stadium-truck/stadium-truck.glb: a bare stadium truck / trophy truck to model around, with long travel double wishbones (independent at all four
wheels), two coilovers a corner, a rack with tie rods, drive shafts at the rear, brake calipers and a steering wheel, named and pivoted the way the game wants them
(see SuspensionRig.js and the README). Import it in Blender, model the body and the cage around the parts, and keep the names and the pivots of the moving parts.

    python3 tools/make-stadium-truck.py

The truck faces +Z, Y is up and X is to the left; the origin is at the height of the axles (the middle of the wheels), midway between them, the truck at rest. The ground
is 0.45 m (a tyre radius) below the origin. Every part is a separate node whose origin (its translation) is its pivot, and the mesh is modelled around that pivot.
The measures: 3.1 m wheelbase, 2.0 m track, tyres of 0.9 m by 0.36 m, a mounting height of the coilovers of 0.6 m above the wheel centres.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import glbtools as g

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "cars", "stadium-truck", "stadium-truck.glb")

WHEELBASE, TRACK, RADIUS, WIDTH = 3.1, 2.0, 0.45, 0.36
HALF = TRACK / 2
FRONT, REAR = WHEELBASE / 2, -WHEELBASE / 2

g.use_materials({
    "paint": [0.93, 0.93, 0.95, 1], "orange": [1.0, 0.45, 0.06, 1], "black": [0.08, 0.08, 0.09, 1], "steel": [0.55, 0.57, 0.6, 1],
    "arm": [0.2, 0.45, 0.9, 1], "upright": [0.95, 0.5, 0.15, 1], "spring": [0.95, 0.85, 0.2, 1], "damper": [0.9, 0.35, 0.1, 1],
    "steer": [0.3, 0.8, 0.4, 1], "tyre": [0.1, 0.1, 0.11, 1], "rim": [0.8, 0.8, 0.82, 1], "caliper": [0.85, 0.15, 0.12, 1], "glass": [0.1, 0.16, 0.2, 1]
})
box, bar, merge, part = g.box, g.bar, g.merge, g.part


def rotate_x(geometry, degrees, about=(0, 0, 0)):
    """The geometry turned about an axis along X through `about`."""
    p, n, i = geometry
    a = math.radians(degrees)
    c, s = math.cos(a), math.sin(a)
    p2, n2 = [], []
    for k in range(0, len(p), 3):
        y, z = p[k + 1] - about[1], p[k + 2] - about[2]
        p2 += [p[k], about[1] + y * c - z * s, about[2] + y * s + z * c]
        y, z = n[k + 1], n[k + 2]
        n2 += [n[k], y * c - z * s, y * s + z * c]
    return p2, n2, i


def ring(radius, thickness, segments=16):
    """A steering wheel rim (a ring of short rods in the XY plane) with a hub and three spokes, the pivot at the middle."""
    parts = []
    for k in range(segments):
        a0, a1 = 2 * math.pi * k / segments, 2 * math.pi * (k + 1) / segments
        parts.append(bar((math.cos(a0) * radius, math.sin(a0) * radius, 0), (math.cos(a1) * radius, math.sin(a1) * radius, 0), thickness))
    for a in (math.pi / 2 + math.pi * 2 / 3 * j for j in range(3)):
        parts.append(bar((0, 0, 0), (math.cos(a) * radius, math.sin(a) * radius, 0), thickness * 0.8))
    parts.append(box((0.07, 0.07, 0.05)))
    return merge(*parts)


# ---- the body: a tub, the cab, the hood and the nose, the bed and the fenders over the wheels (blocks to model over)
body = merge(
    box((1.15, 0.12, 3.7), (0, -0.14, 0)),                               # the floor
    box((1.45, 0.62, 1.3), (0, 0.23, 0.05)),                             # the cab
    box((1.35, 0.06, 1.1), (0, 0.98, 0.0)),                              # the roof
    box((1.5, 0.30, 1.05), (0, 0.10, 1.2)), box((1.5, 0.45, 0.40), (0, 0.02, 1.85)),     # the hood and the nose
    box((1.45, 0.38, 1.25), (0, 0.04, -1.1)),                            # the bed
    box((0.5, 0.1, 1.25), (HALF, 0.98, FRONT)), box((0.5, 0.1, 1.25), (-HALF, 0.98, FRONT)),    # the fenders: the tyre goes up into them
    box((0.5, 0.1, 1.25), (HALF, 0.98, REAR)), box((0.5, 0.1, 1.25), (-HALF, 0.98, REAR)),
    box((0.1, 0.55, 1.25), (HALF + 0.22, 0.7, FRONT)), box((0.1, 0.55, 1.25), (-HALF - 0.22, 0.7, FRONT)),
    box((0.1, 0.55, 1.25), (HALF + 0.22, 0.7, REAR)), box((0.1, 0.55, 1.25), (-HALF - 0.22, 0.7, REAR)),
    box((0.35, 0.25, 0.9), (0.4, -0.02, 0.95)), box((0.35, 0.25, 0.9), (-0.4, -0.02, 0.95)),     # the seats
)
part("body", (0, 0, 0), body, "paint")
# the roll cage: tubes round the cab and the towers of the coilovers
cage = merge(
    bar((0.62, -0.1, 0.6), (0.62, 0.95, 0.5), 0.05), bar((-0.62, -0.1, 0.6), (-0.62, 0.95, 0.5), 0.05),
    bar((0.62, -0.1, -0.5), (0.62, 0.95, -0.5), 0.05), bar((-0.62, -0.1, -0.5), (-0.62, 0.95, -0.5), 0.05),
    bar((0.62, 0.95, 0.5), (-0.62, 0.95, 0.5), 0.05), bar((0.62, 0.95, -0.5), (-0.62, 0.95, -0.5), 0.05),
    bar((0.62, 0.95, 0.5), (0.62, 0.95, -0.5), 0.05), bar((-0.62, 0.95, 0.5), (-0.62, 0.95, -0.5), 0.05),
    bar((0.55, 0.0, FRONT - 0.1), (0.62, 0.7, FRONT - 0.05), 0.05), bar((-0.55, 0.0, FRONT - 0.1), (-0.62, 0.7, FRONT - 0.05), 0.05),
    bar((0.55, 0.0, REAR + 0.1), (0.62, 0.7, REAR + 0.05), 0.05), bar((-0.55, 0.0, REAR + 0.1), (-0.62, 0.7, REAR + 0.05), 0.05),
    bar((0.62, 0.7, FRONT - 0.05), (-0.62, 0.7, FRONT - 0.05), 0.05), bar((0.62, 0.7, REAR + 0.05), (-0.62, 0.7, REAR + 0.05), 0.05),
)
part("cage", (0, 0, 0), cage, "steel")
part("differential_rear", (0, 0, REAR), box((0.4, 0.3, 0.4)), "black")

# ---- the steering wheel: a ring in front of the driver (on the left), tilted back; it turns about its middle with the steering
wheel_geometry = rotate_x(ring(0.19, 0.03), -18)
part("steeringwheel", (0.40, 0.55, 0.30), wheel_geometry, "black")

# ---- the front: double wishbones with long arms, an upright, two coilovers (a damper and a spring) and a rack with tie rods
for corner, side in (("FL", 1), ("FR", -1)):
    x_wheel = side * HALF
    # the arms: the pivot at the hinge on the frame, the free end at the upright
    part("susp_lowerarm_" + corner, (side * 0.30, -0.20, FRONT), bar((0, 0, 0), (side * 0.52, -0.08, 0), 0.05), "arm")
    part("susp_upperarm_" + corner, (side * 0.34, 0.42, FRONT), bar((0, 0, 0), (side * 0.48, -0.12, 0), 0.04), "arm")
    # the upright: the pivot at the middle of the wheel, the part inboard of it
    part("susp_upright_" + corner, (x_wheel, 0, FRONT), box((0.09, 0.64, 0.14), (-side * 0.17, 0.0, 0)), "upright")
    # the coilovers: the pivot at the top mount on the tower, down to the lower arm
    part("susp_damper_" + corner, (side * 0.62, 0.62, FRONT - 0.06), bar((0, 0, 0), (side * 0.20, -0.80, 0.04), 0.07), "damper")
    part("susp_spring_" + corner, (side * 0.58, 0.62, FRONT + 0.10), bar((0, 0, 0), (side * 0.20, -0.80, -0.06), 0.09), "spring")
    # the tie rod: the pivot at the end of the rack, the other end on the steering arm of the upright
    part("steer_tierod_" + corner, (side * 0.40, 0.05, FRONT + 0.32), bar((0, 0, 0), (side * 0.46, 0, -0.14), 0.03), "steer")
part("steer_rack", (0, 0.05, FRONT + 0.32), box((0.8, 0.06, 0.06)), "steer")

# ---- the rear: independent as well, with drive shafts from the differential to the wheels
for corner, side in (("RL", 1), ("RR", -1)):
    x_wheel = side * HALF
    part("susp_lowerarm_" + corner, (side * 0.30, -0.20, REAR), bar((0, 0, 0), (side * 0.52, -0.08, 0), 0.05), "arm")
    part("susp_upperarm_" + corner, (side * 0.34, 0.42, REAR), bar((0, 0, 0), (side * 0.48, -0.12, 0), 0.04), "arm")
    part("susp_upright_" + corner, (x_wheel, 0, REAR), box((0.09, 0.64, 0.14), (-side * 0.17, 0.0, 0)), "upright")
    part("susp_damper_" + corner, (side * 0.62, 0.62, REAR - 0.06), bar((0, 0, 0), (side * 0.20, -0.80, 0.04), 0.07), "damper")
    part("susp_spring_" + corner, (side * 0.58, 0.62, REAR + 0.10), bar((0, 0, 0), (side * 0.20, -0.80, -0.06), 0.09), "spring")
    part("susp_driveshaft_" + corner, (side * 0.22, 0.0, REAR), bar((0, 0, 0), (side * (HALF - 0.22), 0, 0), 0.06), "steel")

# ---- the wheels: tyre and rim as parts of their own, the pivot at the middle (the wheel parts in the car editor); and a brake caliper at every wheel
for corner, side, z in (("FL", 1, FRONT), ("FR", -1, FRONT), ("RL", 1, REAR), ("RR", -1, REAR)):
    x = side * HALF
    part("wheel_" + corner, (x, 0, z), g.cylinder_x(RADIUS, WIDTH), "tyre")
    part("rim_" + corner, (x, 0, z), g.cylinder_x(0.26, WIDTH * 0.9), "rim")
    part("brake_caliper_" + corner, (x, 0, z), box((0.08, 0.16, 0.24), (-side * 0.09, 0.2, 0)), "caliper")

g.write(OUT, "stadium-truck", "OpenRacer make-stadium-truck.py")
