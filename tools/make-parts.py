#!/usr/bin/env python3
"""
make-parts.py

Writes the placeholder parts of the parts library (PartsLibrary.js): plain shapes, one glTF file per part, in web/parts/<type>/<part>.glb, named and
sized the way the game expects them, so that a suspension that the car editor builds from loose parts works out of the box. Replace them with your own
models of the same names (see the README, "Parts library"):

    a stretched part    origin at the end on the body, 1 m long along +Y to its other end (the game aims and stretches it); a coilover or a strut holds
                        children named <part>_piston and <part>_coil
    the axle            origin at its middle, 1 m long along X
    the leaf spring     origin at its middle, 1 m long along Z
    a rigid part        at its own size, origin at its mount (the upright at the middle of the wheel)

    python3 tools/make-parts.py
"""
import json
import math
import os
import struct

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "parts")

COLOURS = {
    "arm": [0.22, 0.24, 0.27, 1], "upright": [0.5, 0.52, 0.55, 1], "cylinder": [0.75, 0.76, 0.78, 1], "piston": [0.85, 0.86, 0.88, 1], "coil": [0.85, 0.15, 0.12, 1],
    "steer": [0.3, 0.32, 0.35, 1], "shaft": [0.6, 0.62, 0.65, 1], "engine": [0.35, 0.36, 0.38, 1], "gearbox": [0.45, 0.46, 0.48, 1], "diff": [0.3, 0.3, 0.32, 1], "leaf": [0.25, 0.25, 0.27, 1]
}


class Glb:
    def __init__(self):
        self.nodes, self.meshes, self.accessors, self.views, self.materials = [], [], [], [], []
        self.material_index = {}
        self.blob = bytearray()

    def material(self, name):
        if name not in self.material_index:
            self.material_index[name] = len(self.materials)
            self.materials.append({"name": name, "pbrMetallicRoughness": {"baseColorFactor": COLOURS[name], "metallicFactor": 0.6 if name in ("cylinder", "piston", "shaft") else 0.2, "roughnessFactor": 0.45 if name in ("cylinder", "piston", "shaft") else 0.7}})
        return self.material_index[name]

    def view(self, data, target):
        while len(self.blob) % 4:
            self.blob.append(0)
        offset = len(self.blob)
        self.blob.extend(data)
        self.views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(data), "target": target})
        return len(self.views) - 1

    def mesh(self, name, geometry, material):
        positions, normals, indices = geometry
        count = len(positions) // 3
        xs, ys, zs = positions[0::3], positions[1::3], positions[2::3]
        self.accessors.append({"bufferView": self.view(struct.pack("<%df" % len(positions), *positions), 34962), "componentType": 5126, "count": count, "type": "VEC3", "min": [min(xs), min(ys), min(zs)], "max": [max(xs), max(ys), max(zs)]})
        self.accessors.append({"bufferView": self.view(struct.pack("<%df" % len(normals), *normals), 34962), "componentType": 5126, "count": count, "type": "VEC3"})
        self.accessors.append({"bufferView": self.view(struct.pack("<%dI" % len(indices), *indices), 34963), "componentType": 5125, "count": len(indices), "type": "SCALAR"})
        a = len(self.accessors) - 3
        self.meshes.append({"name": name, "primitives": [{"attributes": {"POSITION": a, "NORMAL": a + 1}, "indices": a + 2, "material": self.material(material)}]})
        return len(self.meshes) - 1

    def node(self, name, geometry, material, translation=(0, 0, 0), children=None):
        n = {"name": name, "mesh": self.mesh(name, geometry, material), "translation": list(translation)}
        if children:
            n["children"] = children
        self.nodes.append(n)
        return len(self.nodes) - 1

    def write(self, path, roots):
        gltf = {"asset": {"version": "2.0", "generator": "OpenRacer make-parts.py"}, "scene": 0, "scenes": [{"nodes": roots}], "nodes": self.nodes, "meshes": self.meshes,
                "accessors": self.accessors, "bufferViews": self.views, "buffers": [{"byteLength": len(self.blob)}], "materials": self.materials}
        while len(self.blob) % 4:
            self.blob.append(0)
        body = json.dumps(gltf, separators=(",", ":")).encode()
        while len(body) % 4:
            body += b" "
        total = 12 + 8 + len(body) + 8 + len(self.blob)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(struct.pack("<III", 0x46546C67, 2, total))
            f.write(struct.pack("<II", len(body), 0x4E4F534A))
            f.write(body)
            f.write(struct.pack("<II", len(self.blob), 0x004E4942))
            f.write(self.blob)


# ---- shapes (positions, normals, indices)
def box(size, centre=(0, 0, 0)):
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


def tube(axis, radius, start, end, segments=16, closed=True):
    """A cylinder along one axis ('x', 'y' or 'z') from start to end along it."""
    i = "xyz".index(axis)
    j, k = (i + 1) % 3, (i + 2) % 3
    positions, normals, indices = [], [], []

    def p(a, r, along):
        v = [0, 0, 0]
        v[i] = along
        v[j] = math.cos(a) * r
        v[k] = math.sin(a) * r
        return v

    for s in range(segments):
        a = s / segments * 2 * math.pi
        n = p(a, 1, 0)
        positions += p(a, radius, start) + p(a, radius, end)
        normals += n + n
    for s in range(segments):
        a, b = s * 2, ((s + 1) % segments) * 2
        indices += [a, a + 1, b, b, a + 1, b + 1]
    if closed:
        for along, sign in ((start, -1), (end, 1)):
            n = [0, 0, 0]
            n[i] = sign
            centre = len(positions) // 3
            positions += p(0, 0, along)
            normals += n
            ring = len(positions) // 3
            for s in range(segments):
                positions += p(s / segments * 2 * math.pi, radius, along)
                normals += n
            for s in range(segments):
                q, r = ring + s, ring + (s + 1) % segments
                indices += [centre, r, q] if sign < 0 else [centre, q, r]
    return positions, normals, indices


def helix(radius, wire, start, end, turns, segments=10, steps=160):
    """A coil spring along +Y from start to end: a tube swept along a helix."""
    positions, normals, indices = [], [], []
    for t in range(steps + 1):
        f = t / steps
        a = f * turns * 2 * math.pi
        cx, cy, cz = math.cos(a) * radius, start + (end - start) * f, math.sin(a) * radius
        # a frame along the helix: the tangent, and two directions across it
        tx, ty, tz = -math.sin(a) * radius * turns * 2 * math.pi, end - start, math.cos(a) * radius * turns * 2 * math.pi
        tl = math.sqrt(tx * tx + ty * ty + tz * tz)
        tx, ty, tz = tx / tl, ty / tl, tz / tl
        rx, ry, rz = math.cos(a), 0, math.sin(a)                     # outwards
        ux, uy, uz = ty * rz - tz * ry, tz * rx - tx * rz, tx * ry - ty * rx
        for s in range(segments):
            b = s / segments * 2 * math.pi
            nx, ny, nz = math.cos(b) * rx + math.sin(b) * ux, math.cos(b) * ry + math.sin(b) * uy, math.cos(b) * rz + math.sin(b) * uz
            positions += [cx + nx * wire, cy + ny * wire, cz + nz * wire]
            normals += [nx, ny, nz]
    for t in range(steps):
        for s in range(segments):
            a, b = t * segments + s, t * segments + (s + 1) % segments
            c, d = a + segments, b + segments
            indices += [a, c, b, b, c, d]
    return positions, normals, indices


def merge(*geometries):
    positions, normals, indices = [], [], []
    for p, n, i in geometries:
        base = len(positions) // 3
        positions += p
        normals += n
        indices += [base + k for k in i]
    return positions, normals, indices


# ---- the parts
def write(path, builder):
    g = Glb()
    roots = builder(g)
    g.write(os.path.join(ROOT, path), roots)
    print("wrote parts/" + path)


def arm(thick, fork=False):
    # a wishbone: two legs from the hinge (spread along z) to the ball joint at 1 m along +Y, or one rod
    def build(g):
        if fork:
            geom = merge(box((thick, 1.0, thick), (0, 0.5, 0)), box((thick * 0.9, 0.02, 0.26), (0, 0.01, 0)), box((thick * 2.2, thick * 1.2, thick * 2.2), (0, 1.0, 0)))
            legs = merge(*[rod_between((0, 0, dz), (0, 1.0, 0), thick * 0.8) for dz in (-0.12, 0.12)])
            geom = merge(geom, legs)
        else:
            geom = merge(box((thick, 1.0, thick), (0, 0.5, 0)), box((thick * 1.8, thick * 1.2, thick * 1.8), (0, 1.0, 0)))
        return [g.node("arm", geom, "arm")]
    return build


def rod_between(a, b, thick):
    """A thin box from a to b (axis-aligned enough for a placeholder: a box around the segment's bounding box with a minimum thickness)."""
    cx, cy, cz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2
    sx, sy, sz = max(thick, abs(b[0] - a[0])), max(thick, abs(b[1] - a[1])), max(thick, abs(b[2] - a[2]))
    return box((sx, sy, sz), (cx, cy, cz))


def coilover(name, coil=True, foot=True):
    # the cylinder on the top mount (origin), 0.55 m along +Y; the piston from the far end (1 m) up into it; the coil from 0.08 to 0.92
    def build(g):
        cyl = merge(tube("y", 0.032, 0.0, 0.55), tube("y", 0.045, 0.0, 0.05), box((0.1, 0.03, 0.06), (0, 0.0, 0)))
        # the piston: its origin at the far end of the part (1 m), its rod up from there into the cylinder
        piston = merge(tube("y", 0.016, -0.5, 0.0), tube("y", 0.04, -0.03, 0.03)) if foot else tube("y", 0.016, -0.5, 0.0)
        children = [g.node(name + "_piston", piston, "piston", (0, 1.0, 0))]
        if coil:
            children.append(g.node(name + "_coil", helix(0.06, 0.009, -0.84, 0.0, 7), "coil", (0, 0.92, 0)))
        return [g.node(name, cyl, "cylinder", (0, 0, 0), children)]
    return build


def upright():
    def build(g):
        geom = merge(box((0.06, 0.34, 0.12), (0, 0, 0)), tube("x", 0.05, -0.02, 0.1), box((0.05, 0.06, 0.28), (0, 0, 0.0)))
        return [g.node("upright", geom, "upright")]
    return build


def tierod():
    def build(g):
        return [g.node("tierod", merge(tube("y", 0.012, 0.0, 1.0, 10), tube("y", 0.03, 0.0, 0.05, 10), tube("y", 0.03, 0.95, 1.0, 10)), "steer")]
    return build


def rack():
    def build(g):
        return [g.node("rack", merge(tube("x", 0.025, -0.45, 0.45, 12), box((0.3, 0.09, 0.09)), box((0.06, 0.06, 0.12), (0.12, 0.02, -0.08))), "steer")]
    return build


def axle():
    def build(g):
        return [g.node("axle", merge(tube("x", 0.045, -0.5, 0.5, 18), tube("x", 0.13, -0.17, 0.17, 20), box((0.26, 0.3, 0.3), (0, -0.01, 0.04))), "diff")]
    return build


def trailing(thick):
    def build(g):
        return [g.node("trailingarm", merge(tube("y", thick, 0.0, 1.0, 12), tube("x", thick * 1.5, -0.05, 0.05, 12), box((0.1, 0.04, 0.08), (0, 1.0, 0))), "arm")]
    return build


def panhard():
    def build(g):
        return [g.node("panhard", merge(tube("y", 0.015, 0.0, 1.0, 10), tube("z", 0.03, -0.03, 0.03, 10)), "steer")]
    return build


def leafspring():
    def build(g):
        leaves = merge(box((0.07, 0.012, 1.0), (0, 0, 0)), box((0.07, 0.012, 0.7), (0, -0.014, 0)), box((0.07, 0.012, 0.4), (0, -0.028, 0)), box((0.09, 0.05, 0.12), (0, 0.03, 0)))
        return [g.node("leafspring", leaves, "leaf")]
    return build


def shaft(radius, joints):
    def build(g):
        geom = tube("y", radius, 0.0, 1.0, 14)
        if joints:
            geom = merge(geom, tube("y", radius * 1.8, 0.0, 0.06, 14), tube("y", radius * 1.8, 0.94, 1.0, 14))
        return [g.node("shaft", geom, "shaft")]
    return build


def engine():
    def build(g):
        geom = merge(box((0.55, 0.5, 0.6), (0, 0.1, 0)), box((0.45, 0.12, 0.5), (0, 0.41, 0)), tube("z", 0.07, -0.42, 0.42, 14), box((0.6, 0.18, 0.35), (0, -0.24, 0)))
        return [g.node("engine", geom, "engine")]
    return build


def gearbox():
    def build(g):
        return [g.node("gearbox", merge(box((0.32, 0.3, 0.6), (0, 0, 0)), tube("z", 0.1, -0.4, -0.3, 14), tube("z", 0.05, 0.3, 0.38, 14)), "gearbox")]
    return build


def differential():
    def build(g):
        return [g.node("differential", merge(tube("x", 0.13, -0.15, 0.15, 18), box((0.24, 0.24, 0.28), (0, 0, -0.02)), tube("z", 0.05, 0.1, 0.25, 12)), "diff")]
    return build


if __name__ == "__main__":
    write("double-wishbone/upperarm.glb", arm(0.03, fork=True))
    write("double-wishbone/lowerarm.glb", arm(0.035, fork=True))
    write("double-wishbone/upright.glb", upright())
    write("double-wishbone/coilover.glb", coilover("coilover"))
    write("double-wishbone/tierod.glb", tierod())
    write("macpherson/lowerarm.glb", arm(0.035, fork=True))
    write("macpherson/strut.glb", coilover("strut"))
    write("macpherson/upright.glb", upright())
    write("macpherson/tierod.glb", tierod())
    write("live-trailing/axle.glb", axle())
    write("live-trailing/trailingarm.glb", trailing(0.028))
    write("live-trailing/uppertrailingarm.glb", trailing(0.022))
    write("live-trailing/coilover.glb", coilover("coilover"))
    write("live-trailing/damper.glb", coilover("damper", coil=False))
    write("live-trailing/panhard.glb", panhard())
    write("live-leaf/axle.glb", axle())
    write("live-leaf/leafspring.glb", leafspring())
    write("live-leaf/damper.glb", coilover("damper", coil=False))
    write("steering/rack.glb", rack())
    write("driveline/engine.glb", engine())
    write("driveline/gearbox.glb", gearbox())
    write("driveline/differential.glb", differential())
    write("driveline/propshaft.glb", shaft(0.03, True))
    write("driveline/driveshaft.glb", shaft(0.022, True))
