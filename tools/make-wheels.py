#!/usr/bin/env python3
"""
make-wheels.py

Writes the example rims and tyres of the wheel library (WheelLibrary.js, web/wheels/wheels.json): plain shapes, one glTF file per rim and per tyre, in
web/wheels/rims/<id>.glb and web/wheels/tyres/<id>.glb, made the way the game expects every rim and tyre of the library:

    the origin         at the middle of the wheel, on the axle: where the wheel is mounted on the car (the game puts it at the middle of the wheel of the model)
    the axis           X: the wheel turns about X, the tread lies in the Y-Z plane
    the side           modelled for the LEFT side of the car: +X is outwards (the face of the rim); on the right side the game turns it half a turn about Y
    the size           real size, in metres: the game measures the tyre (its diameter and its width) and the rim (its diameter) from the file

Replace them with your own models of the same names, or add your own and list them in web/wheels/wheels.json (see the README, "Wheel library").

    python3 tools/make-wheels.py
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import glbtools as g  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "wheels")
IN = 0.0254

# (double-sided: the plain shapes have no inside to hide)
MATERIALS = {
    "rubber": {"pbrMetallicRoughness": {"baseColorFactor": [0.03, 0.03, 0.03, 1], "metallicFactor": 0.0, "roughnessFactor": 0.9}, "doubleSided": True},
    "sidewall": {"pbrMetallicRoughness": {"baseColorFactor": [0.05, 0.05, 0.05, 1], "metallicFactor": 0.0, "roughnessFactor": 0.75}, "doubleSided": True},
    "alloy": {"pbrMetallicRoughness": {"baseColorFactor": [0.78, 0.79, 0.8, 1], "metallicFactor": 0.9, "roughnessFactor": 0.3}, "doubleSided": True},
    "dark_alloy": {"pbrMetallicRoughness": {"baseColorFactor": [0.18, 0.18, 0.2, 1], "metallicFactor": 0.8, "roughnessFactor": 0.4}, "doubleSided": True},
    "steel": {"pbrMetallicRoughness": {"baseColorFactor": [0.3, 0.3, 0.32, 1], "metallicFactor": 0.7, "roughnessFactor": 0.55}, "doubleSided": True},
    "beadlock": {"pbrMetallicRoughness": {"baseColorFactor": [0.85, 0.35, 0.05, 1], "metallicFactor": 0.4, "roughnessFactor": 0.5}, "doubleSided": True},
    "hub": {"pbrMetallicRoughness": {"baseColorFactor": [0.4, 0.4, 0.42, 1], "metallicFactor": 0.8, "roughnessFactor": 0.4}, "doubleSided": True},
}

# the rims: id, name, the diameter (inches), the width (m), the materials of the face and the barrel, spokes (0: a disc), a beadlock ring
RIMS = [
    ("steel-16", "Steel 16\"", 16, 0.17, "steel", "steel", 0, False),
    ("alloy-17", "Alloy 17\", ten spokes", 17, 0.20, "alloy", "dark_alloy", 10, False),
    ("alloy-18", "Alloy 18\", five spokes", 18, 0.22, "alloy", "dark_alloy", 5, False),
    ("black-18", "Black alloy 18\", five spokes", 18, 0.24, "dark_alloy", "dark_alloy", 5, False),
    ("beadlock-17", "Beadlock 17\" (off-road)", 17, 0.30, "dark_alloy", "steel", 8, True),
    ("moto-17", "Motorcycle 17\", five spokes", 17, 0.12, "dark_alloy", "dark_alloy", 5, False),
]

# the tyres: id, name, the width (m), the aspect ratio (%), the rim (inches), the shell (rings across the tread, nodes round the wheel, carcass in mm), round (a motorcycle tyre)
TYRES = [
    ("road-205-55-16", "Road 205/55 R16", 0.205, 55, 16, (3, 36, 0), False),
    ("sport-245-40-18", "Sport 245/40 R18", 0.245, 40, 18, (3, 36, 0), False),
    ("semi-slick-265-35-18", "Semi-slick 265/35 R18", 0.265, 35, 18, (4, 24, 0), False),
    ("slick-300-660-18", "Slick 300/660 R18", 0.300, None, 18, (4, 10, 0), False),
    ("offroad-35-12.5-17", "Off-road 35x12.5 R17", 0.3175, None, 17, (4, 20, 3), False),
    ("moto-120-70-17", "Motorcycle front 120/70 R17", 0.120, 70, 17, (5, 72, 0), True),
    ("moto-180-55-17", "Motorcycle rear 180/55 R17", 0.180, 55, 17, (4, 28, 0), True),
]
# the diameter of the tyres that have no aspect ratio (m)
DIAMETERS = {"slick-300-660-18": 0.660, "offroad-35-12.5-17": 35 * IN}


def reset():
    del g.nodes[:], g.meshes[:], g.accessors[:], g.views[:], g.images[:], g.textures[:]
    del g.blob[:]


def ring_x(outer, inner, width, segments=48, round_profile=False, shoulder=0.0):
    """A tyre: a band round the X axis from the inner radius (at the rim) over the sidewalls to the tread at the outer radius. A round profile
    (a motorcycle) bulges the tread; a shoulder (m) drops the tread at its edges (a car tyre)."""
    profile = []  # (x, r) round the cross-section, from the inner edge on the inside, over the tread, to the inner edge on the outside
    h = width / 2
    if round_profile:
        n = 14
        for i in range(n + 1):
            a = -math.pi / 2 + math.pi * i / n
            profile.append((h * math.sin(a), inner + (outer - inner) * (0.55 + 0.45 * math.cos(a))))
    else:
        bulge = 0.5 * (outer - inner)
        profile += [(-h, inner), (-h * 1.04, inner + bulge * 0.7), (-h * 1.0, outer - shoulder), (-h * 0.75, outer), (h * 0.75, outer), (h * 1.0, outer - shoulder), (h * 1.04, inner + bulge * 0.7), (h, inner)]
    positions, normals, indices = [], [], []
    m = len(profile)
    for i in range(segments + 1):
        a = i / segments * 2 * math.pi
        cy, cz = math.cos(a), math.sin(a)
        for j, (x, r) in enumerate(profile):
            # the normal from the neighbours of the profile point
            x0, r0 = profile[max(0, j - 1)]
            x1, r1 = profile[min(m - 1, j + 1)]
            dx, dr = x1 - x0, r1 - r0
            length = math.hypot(dx, dr) or 1
            nx, nr = -dr / length, dx / length          # (outwards: the profile runs from the inside over the tread to the outside)
            positions += [x, cy * r, cz * r]
            normals += [nx, cy * nr, cz * nr]
    for i in range(segments):
        for j in range(m - 1):
            a = i * m + j
            b = (i + 1) * m + j
            indices += [a, b, a + 1, a + 1, b, b + 1]
    # the inside of the tyre (at the rim) is closed by the rim; the inner band between the two ends of the profile faces the axle
    for i in range(segments):
        a = i * m
        b = (i + 1) * m
        indices += [a, a + m - 1, b, b, a + m - 1, b + m - 1]
    return positions, normals, indices


def disc_x(radius, width, segments=48, hole=0.0):
    """A disc (the face of a rim) with a hole in the middle, from -width/2 to +width/2 along X."""
    positions, normals, indices = [], [], []
    if hole <= 0:
        return g.cylinder_x(radius, width, segments)
    for side, nx in ((-width / 2, -1), (width / 2, 1)):
        base = len(positions) // 3
        for i in range(segments):
            a = i / segments * 2 * math.pi
            positions += [side, math.cos(a) * hole, math.sin(a) * hole, side, math.cos(a) * radius, math.sin(a) * radius]
            normals += [nx, 0, 0, nx, 0, 0]
        for i in range(segments):
            p, q = base + i * 2, base + ((i + 1) % segments) * 2
            indices += ([p, p + 1, q, q, p + 1, q + 1] if nx > 0 else [p, q, p + 1, p + 1, q, q + 1])
    # the outer band and the band of the hole
    for r, out in ((radius, True), (hole, False)):
        base = len(positions) // 3
        for i in range(segments):
            a = i / segments * 2 * math.pi
            cy, cz = math.cos(a), math.sin(a)
            positions += [-width / 2, cy * r, cz * r, width / 2, cy * r, cz * r]
            s = 1 if out else -1
            normals += [0, cy * s, cz * s, 0, cy * s, cz * s]
        for i in range(segments):
            a, b = base + i * 2, base + ((i + 1) % segments) * 2
            indices += ([a, b, a + 1, a + 1, b, b + 1] if out else [a, a + 1, b, b, a + 1, b + 1])
    return positions, normals, indices


def spoke(angle, r0, r1, thickness, x):
    """One spoke of a rim: a bar in the Y-Z plane at x, from radius r0 to r1."""
    return g.bar((x, math.cos(angle) * r0, math.sin(angle) * r0), (x, math.cos(angle) * r1, math.sin(angle) * r1), thickness)


def make_rim(rim_id, name, inches, width, face, barrel, spokes, beadlock):
    reset()
    g.use_materials(MATERIALS)
    r = inches * IN / 2
    # the barrel: a short tube at the rim radius, open to the tyre
    g.part("barrel", (0, 0, 0), ring_x(r, r - 0.012, width * 0.96, 48, False, 0.0), barrel)
    # the face: a disc near the outside (the dish), with spokes or without
    fx = width * 0.5 - 0.03
    if spokes:
        g.part("hub", (0, 0, 0), disc_x(r * 0.32, 0.05, 32), "hub")
        g.nodes[-1]["translation"] = [fx, 0, 0]
        parts = [spoke(2 * math.pi * i / spokes, r * 0.25, r - 0.02, r * 0.14, fx) for i in range(spokes)]
        g.part("spokes", (0, 0, 0), g.merge(*parts), face)
        g.part("lip", (0, 0, 0), disc_x(r - 0.005, 0.02, 48, r - 0.03), face)
        g.nodes[-1]["translation"] = [fx, 0, 0]
    else:
        g.part("face", (0, 0, 0), disc_x(r - 0.005, 0.03, 48, r * 0.18), face)
        g.nodes[-1]["translation"] = [fx, 0, 0]
        g.part("hub", (0, 0, 0), disc_x(r * 0.18, 0.04, 32), "hub")
        g.nodes[-1]["translation"] = [fx, 0, 0]
    if beadlock:
        g.part("beadlock", (0, 0, 0), disc_x(r + 0.012, 0.03, 48, r - 0.03), "beadlock")
        g.nodes[-1]["translation"] = [width * 0.5 - 0.01, 0, 0]
    g.write(os.path.join(ROOT, "rims", rim_id + ".glb"), rim_id, "make-wheels.py")
    return {"id": rim_id, "name": name, "file": "rims/" + rim_id + ".glb"}


def make_tyre(tyre_id, name, width, aspect, inches, shell, round_profile):
    reset()
    g.use_materials(MATERIALS)
    rim = inches * IN / 2
    outer = DIAMETERS[tyre_id] / 2 if aspect is None else rim + width * aspect / 100
    g.part("tyre", (0, 0, 0), ring_x(outer, rim, width, 56 if not round_profile else 64, round_profile, 0.0 if round_profile else 0.012), "rubber")
    g.write(os.path.join(ROOT, "tyres", tyre_id + ".glb"), tyre_id, "make-wheels.py")
    rings, segments, carcass = shell
    return {"id": tyre_id, "name": name, "file": "tyres/" + tyre_id + ".glb", "width": round(width, 4), "diameter": round(2 * outer, 4),
            "shell": {"rings": rings, "segments": segments, "inner_ratio": round(rim / outer, 3), "carcass": carcass}}


def main():
    import json
    rims = [make_rim(*r) for r in RIMS]
    tyres = [make_tyre(*t) for t in TYRES]
    out = os.path.join(ROOT, "wheels.json")
    existing = {"rims": [], "tyres": []}
    if os.path.exists(out):
        with open(out) as f:
            existing = json.load(f)
    # the entries of this script are written again; the ones that are not from here (your own) are kept
    own = {r["id"] for r in rims} | {t["id"] for t in tyres}
    rims += [r for r in existing.get("rims", []) if r.get("id") not in own]
    tyres += [t for t in existing.get("tyres", []) if t.get("id") not in own]
    with open(out, "w") as f:
        json.dump({"rims": rims, "tyres": tyres}, f, indent=2)
        f.write("\n")
    print("wrote " + out + " (" + str(len(rims)) + " rims, " + str(len(tyres)) + " tyres)")


if __name__ == "__main__":
    main()
