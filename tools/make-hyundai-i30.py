#!/usr/bin/env python3
"""
make-hyundai-i30.py

Writes web/cars/hyundai-i30/hyundai-i30-placeholder.glb: a placeholder model of a 2013 Hyundai i30 (GD, five-door hatchback, 4.30 m long) with
everything that the game and the car editor look for: the body, the windows, the steering wheel, four wheels (tyre and rim parts), brake calipers and the
moving parts of the suspension and the steering (MacPherson struts with lower arms and tie rods at the front, a multilink axle at the rear, see
SuspensionRig.js). Replace it with a real model when there is one: the names and the pivots are what the game wants.

    python3 tools/make-hyundai-i30.py

The car faces +Z, Y is up and X is to the left; the origin is at the height of the axles, midway between them, the car at rest.
Sizes: wheelbase 2.650 m, track 1.563 m (front) and 1.571 m (rear), tyres 205/55 R16 (0.632 m), width 1.78 m, height 1.465 m.
"""
import json
import math
import os
import struct

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "cars", "hyundai-i30", "hyundai-i30-placeholder.glb")

WHEELBASE, TRACK_F, TRACK_R, RADIUS, WIDTH = 2.650, 1.563, 1.571, 0.316, 0.205
FRONT, REAR = WHEELBASE / 2, -WHEELBASE / 2
GROUND = -RADIUS                                    # the road, in the space of the model
LENGTH, BODY_WIDTH, HEIGHT = 4.30, 1.78, 1.465

MATERIALS = {
    "Body paint": [0.16, 0.26, 0.45, 1], "Glass": [0.05, 0.08, 0.1, 0.35], "Black plastic": [0.05, 0.05, 0.06, 1], "Rubber": [0.07, 0.07, 0.08, 1],
    "Rim": [0.78, 0.8, 0.84, 1], "Brake": [0.75, 0.15, 0.12, 1], "arm": [0.2, 0.45, 0.9, 1], "upright": [0.95, 0.5, 0.15, 1], "spring": [0.95, 0.85, 0.2, 1],
    "steer": [0.3, 0.8, 0.4, 1]
}
material_index = {name: i for i, name in enumerate(MATERIALS)}
nodes, meshes, accessors, views = [], [], [], []
blob = bytearray()


def add_view(data, target=None):
    while len(blob) % 4:
        blob.append(0)
    offset = len(blob)
    blob.extend(data)
    view = {"buffer": 0, "byteOffset": offset, "byteLength": len(data)}
    if target:
        view["target"] = target
    views.append(view)
    return len(views) - 1


def add_mesh(name, positions, normals, indices, material):
    pos = struct.pack("<%df" % len(positions), *positions)
    nor = struct.pack("<%df" % len(normals), *normals)
    idx = struct.pack("<%dI" % len(indices), *indices)
    count = len(positions) // 3
    xs, ys, zs = positions[0::3], positions[1::3], positions[2::3]
    accessors.append({"bufferView": add_view(pos, 34962), "componentType": 5126, "count": count, "type": "VEC3",
                      "min": [min(xs), min(ys), min(zs)], "max": [max(xs), max(ys), max(zs)]})
    accessors.append({"bufferView": add_view(nor, 34962), "componentType": 5126, "count": count, "type": "VEC3"})
    accessors.append({"bufferView": add_view(idx, 34963), "componentType": 5125, "count": len(indices), "type": "SCALAR"})
    a = len(accessors) - 3
    meshes.append({"name": name, "primitives": [{"attributes": {"POSITION": a, "NORMAL": a + 1}, "indices": a + 2, "material": material_index[material]}]})
    return len(meshes) - 1


def box(size, centre=(0, 0, 0)):
    """A box of size (sx, sy, sz) around centre (relative to the pivot of the part): positions, normals, indices."""
    sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
    cx, cy, cz = centre
    faces = [((1, 0, 0), ((1, -1, -1), (1, 1, -1), (1, 1, 1), (1, -1, 1))), ((-1, 0, 0), ((-1, -1, 1), (-1, 1, 1), (-1, 1, -1), (-1, -1, -1))),
             ((0, 1, 0), ((-1, 1, -1), (-1, 1, 1), (1, 1, 1), (1, 1, -1))), ((0, -1, 0), ((-1, -1, 1), (-1, -1, -1), (1, -1, -1), (1, -1, 1))),
             ((0, 0, 1), ((-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))), ((0, 0, -1), ((1, -1, -1), (-1, -1, -1), (-1, 1, -1), (1, 1, -1)))]
    positions, normals, indices = [], [], []
    for normal, corners in faces:
        base = len(positions) // 3
        for c in corners:
            positions += [cx + c[0] * sx, cy + c[1] * sy, cz + c[2] * sz]
            normals += list(normal)
        indices += [base, base + 1, base + 2, base, base + 2, base + 3]
    return positions, normals, indices


def bar(start, end, thickness):
    """A box from start to end (relative to the pivot), thickness across: a rod along any direction."""
    dx, dy, dz = end[0] - start[0], end[1] - start[1], end[2] - start[2]
    length = math.sqrt(dx * dx + dy * dy + dz * dz)
    ax, ay, az = dx / length, dy / length, dz / length
    # two directions across the rod
    ref = (0, 1, 0) if abs(ay) < 0.9 else (1, 0, 0)
    bx, by, bz = ay * ref[2] - az * ref[1], az * ref[0] - ax * ref[2], ax * ref[1] - ay * ref[0]
    bl = math.sqrt(bx * bx + by * by + bz * bz)
    bx, by, bz = bx / bl, by / bl, bz / bl
    cx, cy, cz = ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx
    t = thickness / 2
    positions, normals, indices = [], [], []

    def point(u, v, w):
        return [start[0] + ax * u + bx * v + cx * w, start[1] + ay * u + by * v + cy * w, start[2] + az * u + bz * v + cz * w]

    faces = [((bx, by, bz), [(0, t, -t), (length, t, -t), (length, t, t), (0, t, t)]), ((-bx, -by, -bz), [(0, -t, t), (length, -t, t), (length, -t, -t), (0, -t, -t)]),
             ((cx, cy, cz), [(0, -t, t), (0, t, t), (length, t, t), (length, -t, t)]), ((-cx, -cy, -cz), [(length, -t, -t), (length, t, -t), (0, t, -t), (0, -t, -t)]),
             ((ax, ay, az), [(length, -t, -t), (length, -t, t), (length, t, t), (length, t, -t)]), ((-ax, -ay, -az), [(0, t, -t), (0, t, t), (0, -t, t), (0, -t, -t)])]
    for normal, corners in faces:
        base = len(positions) // 3
        for u, v, w in corners:
            positions += point(u, v, w)
            normals += list(normal)
        indices += [base, base + 1, base + 2, base, base + 2, base + 3]
    return positions, normals, indices


def cylinder_x(radius, width, segments=28):
    """A wheel: a cylinder around the X axis, centred on the pivot."""
    positions, normals, indices = [], [], []
    for i in range(segments):
        a = i / segments * 2 * math.pi
        y, z = math.cos(a) * radius, math.sin(a) * radius
        positions += [-width / 2, y, z, width / 2, y, z]
        normals += [0, math.cos(a), math.sin(a), 0, math.cos(a), math.sin(a)]
    for i in range(segments):
        a, b = i * 2, ((i + 1) % segments) * 2
        indices += [a, b, a + 1, a + 1, b, b + 1]
    for side, nx in ((-width / 2, -1), (width / 2, 1)):
        centre = len(positions) // 3
        positions += [side, 0, 0]
        normals += [nx, 0, 0]
        ring = len(positions) // 3
        for i in range(segments):
            a = i / segments * 2 * math.pi
            positions += [side, math.cos(a) * radius, math.sin(a) * radius]
            normals += [nx, 0, 0]
        for i in range(segments):
            p, q = ring + i, ring + (i + 1) % segments
            indices += [centre, q, p] if nx > 0 else [centre, p, q]
    return positions, normals, indices


def part(name, pivot, geometry, material):
    mesh = add_mesh(name, *geometry, material=material)
    nodes.append({"name": name, "translation": list(pivot), "mesh": mesh})
    return len(nodes) - 1


def merge_old(*geometries):
    positions, normals, indices = [], [], []
    for p, n, i in geometries:
        base = len(positions) // 3
        positions += p
        normals += n
        indices += [base + k for k in i]
    return positions, normals, indices




def flat(points):
    """A flat polygon face (list of 3D points, in order) with its own normal: positions, normals, indices as a fan."""
    ux, uy, uz = [points[1][k] - points[0][k] for k in range(3)]
    vx, vy, vz = [points[2][k] - points[0][k] for k in range(3)]
    nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
    length = math.sqrt(nx * nx + ny * ny + nz * nz) or 1
    positions, normals, indices = [], [], []
    for p in points:
        positions += list(p)
        normals += [nx / length, ny / length, nz / length]
    for i in range(1, len(points) - 1):
        indices += [0, i, i + 1]
    return positions, normals, indices


def prism(polygon, x0, x1):
    """A convex polygon in the (z, y) plane (listed in order) extruded from x0 to x1: the side faces and the quads around."""
    n = len(polygon)
    # the order that makes the +x cap face outwards: counter clockwise seen from +x (z to the right?, y up): the sign of the area
    area = sum(polygon[i][0] * polygon[(i + 1) % n][1] - polygon[(i + 1) % n][0] * polygon[i][1] for i in range(n))
    pts = polygon if area > 0 else polygon[::-1]
    geometries = []
    # +x cap: seen from +x, z points to the left, so the order of (z, y) counter clockwise is clockwise in view: reverse it
    geometries.append(flat([(x1, p[1], p[0]) for p in pts[::-1]]))
    geometries.append(flat([(x0, p[1], p[0]) for p in pts]))
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        geometries.append(flat([(x0, a[1], a[0]), (x1, a[1], a[0]), (x1, b[1], b[0]), (x0, b[1], b[0])]))
    return merge(*geometries)


def torus(radius, tube, segments=24, around=8):
    """A ring around the Y axis (the rim of a steering wheel), centred on the pivot."""
    positions, normals, indices = [], [], []
    for i in range(segments):
        a = i / segments * 2 * math.pi
        for j in range(around):
            b = j / around * 2 * math.pi
            cx, cz = math.cos(a), math.sin(a)
            r = radius + tube * math.cos(b)
            positions += [cx * r, tube * math.sin(b), cz * r]
            normals += [cx * math.cos(b), math.sin(b), cz * math.cos(b)]
    for i in range(segments):
        for j in range(around):
            p = i * around + j
            q = ((i + 1) % segments) * around + j
            p1 = i * around + (j + 1) % around
            q1 = ((i + 1) % segments) * around + (j + 1) % around
            indices += [p, q, p1, p1, q, q1]
    return positions, normals, indices


def part_two(name, pivot, geometries):
    """A part with more than one material: a mesh with a primitive for each (geometry, material)."""
    primitives = []
    for geometry, material in geometries:
        positions, normals, idx = geometry
        pos = struct.pack("<%df" % len(positions), *positions)
        nor = struct.pack("<%df" % len(normals), *normals)
        ind = struct.pack("<%dI" % len(idx), *idx)
        count = len(positions) // 3
        xs, ys, zs = positions[0::3], positions[1::3], positions[2::3]
        accessors.append({"bufferView": add_view(pos, 34962), "componentType": 5126, "count": count, "type": "VEC3",
                          "min": [min(xs), min(ys), min(zs)], "max": [max(xs), max(ys), max(zs)]})
        accessors.append({"bufferView": add_view(nor, 34962), "componentType": 5126, "count": count, "type": "VEC3"})
        accessors.append({"bufferView": add_view(ind, 34963), "componentType": 5125, "count": len(idx), "type": "SCALAR"})
        a = len(accessors) - 3
        primitives.append({"attributes": {"POSITION": a, "NORMAL": a + 1}, "indices": a + 2, "material": material_index[material]})
    meshes.append({"name": name, "primitives": primitives})
    nodes.append({"name": name, "translation": list(pivot), "mesh": len(meshes) - 1})


def merge(*geometries):
    positions, normals, indices = [], [], []
    for p, n, i in geometries:
        base = len(positions) // 3
        positions += p
        normals += n
        indices += [base + k for k in i]
    return positions, normals, indices


def part(name, pivot, geometry, material):
    mesh = add_mesh(name, *geometry, material=material)
    nodes.append({"name": name, "translation": list(pivot), "mesh": mesh})
    return len(nodes) - 1


def g(y):
    """A height above the road, in the space of the model."""
    return GROUND + y


# ---- the body: the lower body in pieces, so that the wheels have arches, and the cabin on top
HALF = BODY_WIDTH / 2 - 0.02
FRONT_Z, REAR_Z = LENGTH / 2 - 0.04 - 0.0, -LENGTH / 2


def top_edge(z):
    """The upper edge of the lower body (the height above the road) along the car: the hood rises to the windshield, the deck is level to the hatch."""
    knots = [(2.15, 0.62), (1.1, 0.95), (-1.0, 0.95), (-2.15, 0.98)]
    for (z0, y0), (z1, y1) in zip(knots, knots[1:]):
        if z1 <= z <= z0:
            return y0 + (y1 - y0) * (z0 - z) / (z0 - z1)
    return knots[-1][1]


arch_f = (FRONT - 0.36, FRONT + 0.36)
arch_r = (REAR - 0.36, REAR + 0.36)
bottom = g(0.17)
above_wheel = g(0.66)
pieces = [
    (2.15, arch_f[1], bottom), (arch_f[1], arch_f[0], above_wheel), (arch_f[0], arch_r[1], bottom), (arch_r[1], arch_r[0], above_wheel), (arch_r[0], -2.15, bottom)
]
lower = []
for z0, z1, low in pieces:
    lower.append(prism([(z0, low), (z1, low), (z1, g(top_edge(z1))), (z0, g(top_edge(z0)))], -HALF, HALF))
cabin = prism([(0.95, g(0.95)), (0.5, g(1.465)), (-1.0, g(1.44)), (-1.95, g(0.97)), (-1.95, g(0.95))], -0.70, 0.70)
part("Body", (0, 0, 0), merge(*lower, cabin), "Body paint")

# the bumpers and the grille as dark parts at both ends
part("bumpers", (0, 0, 0), merge(box((BODY_WIDTH - 0.06, 0.16, 0.06), (0, g(0.24), 2.15)), box((BODY_WIDTH - 0.06, 0.16, 0.06), (0, g(0.26), -2.15)),
                                 box((0.9, 0.12, 0.03), (0, g(0.5), 2.14))), "Black plastic")

# the windows: the sides, the windshield and the rear window
side_poly = [(0.8, g(1.0)), (0.52, g(1.4)), (-0.95, g(1.38)), (-1.7, g(1.05)), (-1.7, g(1.0))]
part("windows", (0, 0, 0), merge(prism(side_poly, 0.699, 0.706), prism(side_poly, -0.706, -0.699),
                                 flat([(0.62, g(0.96), 0.935), (-0.62, g(0.96), 0.935), (-0.62, g(1.445), 0.51), (0.62, g(1.445), 0.51)]),
                                 flat([(-0.62, g(1.41), -1.01), (0.62, g(1.41), -1.01), (0.62, g(1.0), -1.96), (-0.62, g(1.0), -1.96)])), "Glass")

# the steering wheel: a ring about its own Y axis, tilted back towards the driver (left hand drive); the pivot at the middle of the ring
steering = merge(torus(0.17, 0.015), box((0.05, 0.03, 0.34)), box((0.34, 0.03, 0.05)))
part("steeringwheel", (0.37, g(0.98), 0.5), steering, "Black plastic")
nodes[-1]["rotation"] = [-0.6132573485374451, 0, 0, 0.7898831963539124]

# ---- the front: MacPherson struts (the spring and the damper in one), lower arms, uprights, a rack and tie rods
for corner, side in (("FL", 1), ("FR", -1)):
    x_wheel = side * TRACK_F / 2
    part("susp_lowerarm_" + corner, (side * 0.36, -0.1, FRONT - 0.05), bar((0, 0, 0), (side * 0.38, 0, 0.05), 0.04), "arm")
    part("susp_upright_" + corner, (x_wheel, 0, FRONT), box((0.07, 0.4, 0.13), (-side * 0.07, 0.03, 0)), "upright")
    # the strut: the pivot at the top mount in the tower, the part down to the upright
    part("susp_strut_" + corner, (side * 0.56, 0.5, FRONT - 0.02), bar((0, 0, 0), (side * 0.15, -0.58, 0.02), 0.1), "spring")
    part("steer_tierod_" + corner, (side * 0.3, 0.03, FRONT - 0.18), bar((0, 0, 0), (side * 0.44, 0.01, -0.02), 0.025), "steer")
    part("brake_caliper_" + corner, (x_wheel - side * 0.04, 0, FRONT), box((0.04, 0.12, 0.09), (-side * 0.02, 0.02, 0.2)), "Brake")
part("steer_rack", (0, 0.03, FRONT - 0.18), box((0.6, 0.05, 0.05)), "steer")

# ---- the rear: a multilink axle: a lower arm, an upper (toe) link, a spring and a damper on each side
for corner, side in (("RL", 1), ("RR", -1)):
    x_wheel = side * TRACK_R / 2
    part("susp_lowerarm_" + corner, (side * 0.34, -0.12, REAR + 0.05), bar((0, 0, 0), (side * 0.43, 0.0, 0.0), 0.04), "arm")
    part("susp_upperarm_" + corner, (side * 0.38, 0.1, REAR - 0.12), bar((0, 0, 0), (side * 0.39, 0.0, 0.1), 0.03), "arm")
    part("susp_upright_" + corner, (x_wheel, 0, REAR), box((0.07, 0.38, 0.12), (-side * 0.07, 0.03, 0)), "upright")
    part("susp_spring_" + corner, (side * 0.5, 0.32, REAR - 0.02), bar((0, 0, 0), (side * 0.12, -0.38, 0), 0.09), "spring")
    part("susp_damper_" + corner, (side * 0.58, 0.4, REAR + 0.14), bar((0, 0, 0), (side * 0.12, -0.46, -0.1), 0.05), "spring")
    part("brake_caliper_" + corner, (x_wheel - side * 0.04, 0, REAR), box((0.04, 0.1, 0.08), (-side * 0.02, 0.02, -0.18)), "Brake")

# ---- the wheels: the tyre and the rim as two parts each, the pivot at the middle (the wheel parts in the car editor)
for corner, x, z in (("FL", TRACK_F / 2, FRONT), ("FR", -TRACK_F / 2, FRONT), ("RL", TRACK_R / 2, REAR), ("RR", -TRACK_R / 2, REAR)):
    part("wheel_" + corner, (x, 0, z), cylinder_x(RADIUS, WIDTH), "Rubber")
    part("rim_" + corner, (x, 0, z), cylinder_x(RADIUS * 0.66, WIDTH * 0.92), "Rim")

# ---- the file
gltf = {
    "asset": {"version": "2.0", "generator": "OpenRacer make-hyundai-i30.py"},
    "scene": 0, "scenes": [{"name": "hyundai-i30", "nodes": list(range(len(nodes)))}],
    "nodes": nodes, "meshes": meshes, "accessors": accessors, "bufferViews": views,
    "buffers": [{"byteLength": len(blob)}],
    "materials": [dict({"name": name, "pbrMetallicRoughness": {"baseColorFactor": colour, "metallicFactor": 0.2, "roughnessFactor": 0.5}}, **({"alphaMode": "BLEND"} if name == "Glass" else {})) for name, colour in MATERIALS.items()]
}
while len(blob) % 4:
    blob.append(0)
json_bytes = json.dumps(gltf, separators=(",", ":")).encode()
while len(json_bytes) % 4:
    json_bytes += b" "
total = 12 + 8 + len(json_bytes) + 8 + len(blob)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "wb") as f:
    f.write(struct.pack("<III", 0x46546C67, 2, total))
    f.write(struct.pack("<II", len(json_bytes), 0x4E4F534A))
    f.write(json_bytes)
    f.write(struct.pack("<II", len(blob), 0x004E4942))
    f.write(blob)
print("wrote " + OUT + " (" + str(total) + " bytes, " + str(len(nodes)) + " parts)")
