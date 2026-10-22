"""
glbtools.py

The small glTF writer of the example models (make-stadium-truck.py): parts that are boxes, rods and cylinders, every one a node whose origin is its pivot,
written as a .glb. The same helpers as make-rig-example.py, in a module. Set `materials` (name -> [r, g, b, a]) first.

The car faces +Z, Y is up and X is to the left (the car editor and the game use the same).
"""
import json
import math
import os
import struct

materials = {}
material_index = {}


def use_materials(table):
    materials.clear()
    materials.update(table)
    material_index.clear()
    material_index.update({name: i for i, name in enumerate(table)})


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


def write(out, scene_name, generator):
    gltf = {
        "asset": {"version": "2.0", "generator": generator},
        "scene": 0, "scenes": [{"name": scene_name, "nodes": list(range(len(nodes)))}],
        "nodes": nodes, "meshes": meshes, "accessors": accessors, "bufferViews": views,
        "buffers": [{"byteLength": len(blob)}],
        "materials": [{"name": name, "pbrMetallicRoughness": {"baseColorFactor": colour, "metallicFactor": 0.1, "roughnessFactor": 0.7}} for name, colour in materials.items()]
    }
    while len(blob) % 4:
        blob.append(0)
    json_bytes = json.dumps(gltf, separators=(",", ":")).encode()
    while len(json_bytes) % 4:
        json_bytes += b" "
    total = 12 + 8 + len(json_bytes) + 8 + len(blob)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(json_bytes), 0x4E4F534A))
        f.write(json_bytes)
        f.write(struct.pack("<II", len(blob), 0x004E4942))
        f.write(blob)
    print("wrote " + out + " (" + str(total) + " bytes, " + str(len(nodes)) + " parts)")
