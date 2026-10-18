#!/usr/bin/env python3
"""
make-skidpad.py

Writes the skidpad of the game (web/tracks/skidpad): a flat round pad of asphalt, 130 m across, with a painted circle of 50 m
radius to drive on, grass around it, and a track.json. The game's skidpad mode (main.js, ?mode=skidpad) drives the chosen car
round the circle faster and faster until it lets go, and shows the lateral acceleration it held.

    python3 tools/make-skidpad.py
"""
import json
import math
import os
import struct

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "tracks", "skidpad")
RADIUS = 50.0          # of the painted circle (m)
PAD = 65.0             # of the asphalt
FIELD = 400.0          # of the grass around it

MATERIALS = {"asphalt": [0.26, 0.27, 0.29, 1], "paint": [0.92, 0.92, 0.9, 1], "grass": [0.3, 0.52, 0.24, 1]}
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
    nodes.append({"name": name, "mesh": len(meshes) - 1})


def ring(name, r_in, r_out, y, material, segments=128):
    """A flat ring (or a disc when r_in is 0) at height y, facing up."""
    positions, normals, indices = [], [], []
    for i in range(segments):
        a = i / segments * 2 * math.pi
        for r in (r_in, r_out):
            positions += [math.cos(a) * r, y, math.sin(a) * r]
            normals += [0, 1, 0]
    for i in range(segments):
        a, b = i * 2, ((i + 1) % segments) * 2
        indices += [a, a + 1, b, b, a + 1, b + 1]   # counter-clockwise seen from above
    add_mesh(name, positions, normals, indices, material)


ring("pad", 0.001, PAD, 0, "asphalt")
ring("circle", RADIUS - 0.15, RADIUS + 0.15, 0.003, "paint")     # the line to drive on
ring("circle_inner", 20 - 0.15, 20 + 0.15, 0.003, "paint")         # a smaller one for a tighter test
ring("field", PAD, FIELD, -0.02, "grass")

gltf = {
    "asset": {"version": "2.0", "generator": "OpenRacer make-skidpad.py"},
    "scene": 0, "scenes": [{"name": "skidpad", "nodes": list(range(len(nodes)))}],
    "nodes": nodes, "meshes": meshes, "accessors": accessors, "bufferViews": views,
    "buffers": [{"byteLength": len(blob)}],
    "materials": [{"name": n, "pbrMetallicRoughness": {"baseColorFactor": c, "metallicFactor": 0, "roughnessFactor": 0.95}} for n, c in MATERIALS.items()]
}
while len(blob) % 4:
    blob.append(0)
json_bytes = json.dumps(gltf, separators=(",", ":")).encode()
while len(json_bytes) % 4:
    json_bytes += b" "
total = 12 + 8 + len(json_bytes) + 8 + len(blob)
os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, "skidpad.glb"), "wb") as f:
    f.write(struct.pack("<III", 0x46546C67, 2, total))
    f.write(struct.pack("<II", len(json_bytes), 0x4E4F534A))
    f.write(json_bytes)
    f.write(struct.pack("<II", len(blob), 0x004E4942))
    f.write(blob)
track = {
    "name": "Skidpad",
    "description": "A round pad with a circle of 50 m radius: how much lateral g does the car hold?",
    "start": {"x": RADIUS, "z": 0, "heading": math.pi / 2},     # on the circle, facing +z: round it anticlockwise seen from above
    "model": "skidpad.glb",
    "skidpad": {"radius": RADIUS, "inner_radius": 20},
    "environment": {"sky_top": "#4a82c4", "sky_horizon": "#d3e4f4", "fog": {"enabled": False, "color": "#cfdbe8", "near": 300, "far": 2500},
                    "sun": {"azimuth": 40, "elevation": 50, "intensity": 1, "color": "#ffffff"}, "ambient": {"color": "#576777", "intensity": 1}},
    "surfaces": {"meshes": {"pad": "road", "circle": "road", "circle_inner": "road", "field": "grass"}}
}
with open(os.path.join(OUT, "track.json"), "w") as f:
    json.dump(track, f, indent=2)
    f.write("\n")
print("wrote " + OUT + " (" + str(total) + " bytes)")
