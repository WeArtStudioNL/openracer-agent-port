#!/usr/bin/env python3
"""
make-rig-example.py

Writes web/examples/suspension-rig.glb: a bare test car with a frame, four wheels and the moving parts of the suspension and
the steering that the game animates (see SuspensionRig.js and the README), named and pivoted the way the game wants them.
Import it in Blender to see how the parts are set up, or load it in the car editor as the model of a car.

    python3 tools/make-rig-example.py

The car faces +Z, Y is up and X is to the left; the origin is at the height of the axles, midway between them, the car at rest.
Every part is a separate node whose origin (its translation) is its pivot, and the mesh is modelled around that pivot.
"""
import json
import math
import os
import struct

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "examples", "suspension-rig.glb")

WHEELBASE, TRACK, RADIUS, WIDTH = 2.6, 1.5, 0.32, 0.22
HALF_TRACK = TRACK / 2
FRONT, REAR = WHEELBASE / 2, -WHEELBASE / 2

MATERIALS = {
    "frame": [0.55, 0.57, 0.6, 1], "arm": [0.2, 0.45, 0.9, 1], "upright": [0.95, 0.5, 0.15, 1], "spring": [0.95, 0.85, 0.2, 1],
    "steer": [0.3, 0.8, 0.4, 1], "wheel": [0.12, 0.12, 0.13, 1], "rim": [0.8, 0.8, 0.82, 1]
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


def merge(*geometries):
    positions, normals, indices = [], [], []
    for p, n, i in geometries:
        base = len(positions) // 3
        positions += p
        normals += n
        indices += [base + k for k in i]
    return positions, normals, indices


# ---- the frame: two rails, cross members at the axles and a floor, as one part (the body)
frame = merge(box((0.08, 0.08, WHEELBASE + 1.0), (0.4, 0.05, 0)), box((0.08, 0.08, WHEELBASE + 1.0), (-0.4, 0.05, 0)),
              box((0.9, 0.08, 0.08), (0, 0.05, FRONT)), box((0.9, 0.08, 0.08), (0, 0.05, REAR)),
              box((0.9, 0.08, 0.08), (0, 0.05, 0)), box((0.8, 0.02, 1.4), (0, 0.1, 0)),
              box((0.08, 0.5, 0.08), (0.4, 0.3, FRONT - 0.15)), box((0.08, 0.5, 0.08), (-0.4, 0.3, FRONT - 0.15)),  # the towers of the front springs
              box((1.2, 0.06, 0.08), (0, 0.55, FRONT - 0.15)),
              box((0.08, 0.5, 0.08), (0.4, 0.3, REAR)), box((0.08, 0.5, 0.08), (-0.4, 0.3, REAR)), box((1.2, 0.06, 0.08), (0, 0.55, REAR)))
part("frame", (0, 0, 0), frame, "frame")

# ---- the front: double wishbones, an upright, a spring on the lower arm, a rack with tie rods
for corner, side in (("FL", 1), ("FR", -1)):
    x_wheel = side * HALF_TRACK
    x_hinge = side * 0.42
    # the arms: the pivot at the hinge on the frame, the free end at the upright
    part("susp_lowerarm_" + corner, (x_hinge, -0.12, FRONT), bar((0, 0, 0), (side * 0.28, 0, 0), 0.035), "arm")
    part("susp_upperarm_" + corner, (x_hinge, 0.18, FRONT), bar((0, 0, 0), (side * 0.24, 0, 0), 0.03), "arm")
    # the upright: the pivot at the middle of the wheel, the part a little inboard of it
    part("susp_upright_" + corner, (x_wheel, 0, FRONT), box((0.06, 0.38, 0.12), (-side * 0.06, 0.03, 0)), "upright")
    # the spring: the pivot at the top mount on the tower, the part down to the lower arm
    part("susp_spring_" + corner, (side * 0.6, 0.52, FRONT - 0.15), bar((0, 0, 0), (side * 0.04, -0.6, 0.12), 0.09), "spring")
    # the tie rod: the pivot at the end of the rack, the other end on the steering arm of the upright
    part("steer_tierod_" + corner, (side * 0.45, 0.04, FRONT + 0.22), bar((0, 0, 0), (side * 0.24, 0, -0.1), 0.025), "steer")
part("steer_rack", (0, 0.04, FRONT + 0.22), box((0.9, 0.05, 0.05)), "steer")

# ---- the rear: a live axle with a spring on each side
part("susp_axle_rear", (0, 0, REAR), merge(box((TRACK - 0.1, 0.09, 0.09)), box((0.3, 0.26, 0.26))), "arm")
for corner, side in (("RL", 1), ("RR", -1)):
    part("susp_spring_" + corner, (side * 0.55, 0.52, REAR), bar((0, 0, 0), (0, -0.47, 0), 0.09), "spring")

# ---- the wheels: tyre and rim as one part each, the pivot at the middle (set them as the wheel parts in the car editor)
for corner, x, z in (("FL", HALF_TRACK, FRONT), ("FR", -HALF_TRACK, FRONT), ("RL", HALF_TRACK, REAR), ("RR", -HALF_TRACK, REAR)):
    part("wheel_" + corner, (x, 0, z), cylinder_x(RADIUS, WIDTH), "wheel")
    part("rim_" + corner, (x, 0, z), cylinder_x(RADIUS * 0.62, WIDTH * 0.7), "rim")

# ---- the file
gltf = {
    "asset": {"version": "2.0", "generator": "OpenRacer make-rig-example.py"},
    "scene": 0, "scenes": [{"name": "suspension-rig", "nodes": list(range(len(nodes)))}],
    "nodes": nodes, "meshes": meshes, "accessors": accessors, "bufferViews": views,
    "buffers": [{"byteLength": len(blob)}],
    "materials": [{"name": name, "pbrMetallicRoughness": {"baseColorFactor": colour, "metallicFactor": 0.1, "roughnessFactor": 0.7}} for name, colour in MATERIALS.items()]
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
