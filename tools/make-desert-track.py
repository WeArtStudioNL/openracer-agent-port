#!/usr/bin/env python3
"""
make-desert-track.py

Writes the Desert track (web/tracks/desert/: track.json and desert.glb): a closed road of 12 m wide that winds through a landscape of dunes, with jumps (crests that a
car leaves the ground at speed), made from numbers: the centre line, the heights, the terrain and its colour. Needs numpy.

    python3 tools/make-desert-track.py

The glb has two parts: "road" (the asphalt, role road) and "terrain" (the sand, role sand; the surface that gives way: the off-road tyre grips there). The terrain
is flat for 16 m on both sides of the road (the road bed), then goes over into the dunes, so the road can be driven without the terrain coming through it.
"""
import json
import math
import os
import struct
import sys
import zlib

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import glbtools as g

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "tracks", "desert")
SIZE = 2000.0          # the side of the terrain (m)
N = 334                # the points on a side of the terrain: a cell of 6 m
ROAD = 12.0            # the width of the road (m)
FLAT = 16.0            # the terrain is flat (the road bed) this far from the middle of the road
BLEND = 75.0           # and goes over into the dunes in this distance
TEXTURE = 2048         # the colour of the terrain
rng = np.random.default_rng(7)


def smoothstep(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)


# ---- the middle of the road: a closed curve that winds round the middle, as a radius that changes with the angle (so it never crosses itself)
theta = np.linspace(0, 2 * math.pi, 8000, endpoint=False)
radius = 520 * (1 + 0.26 * np.sin(2 * theta + 0.4) + 0.16 * np.sin(3 * theta + 1.9) + 0.09 * np.sin(5 * theta + 0.7) + 0.05 * np.sin(8 * theta + 2.6))
raw = np.stack([radius * np.cos(theta), radius * np.sin(theta)], axis=1)
closed = np.vstack([raw, raw[:1]])
seg = np.hypot(*np.diff(closed, axis=0).T)
arc = np.concatenate([[0], np.cumsum(seg)])
LENGTH = arc[-1]
COUNT = int(round(LENGTH / 2.0))                 # a point every 2 m
s_samples = np.linspace(0, LENGTH, COUNT, endpoint=False)
cx = np.interp(s_samples, arc, closed[:, 0])
cz = np.interp(s_samples, arc, closed[:, 1])


def smooth_periodic(values, sigma_samples):
    """A gaussian smoothing of a closed curve (values: COUNT or COUNT x k)."""
    half = int(sigma_samples * 3)
    kernel = np.exp(-0.5 * (np.arange(-half, half + 1) / sigma_samples) ** 2)
    kernel /= kernel.sum()
    padded = np.concatenate([values[-half:], values, values[:half]])
    if values.ndim == 1:
        return np.convolve(padded, kernel, mode="valid")
    return np.stack([np.convolve(padded[:, k], kernel, mode="valid") for k in range(values.shape[1])], axis=1)


cx, cz = smooth_periodic(cx, 6), smooth_periodic(cz, 6)
dx, dz = np.gradient(cx, 2.0), np.gradient(cz, 2.0)       # (the step is 2 m, but the curve closes: good enough for a direction)
norm = np.hypot(dx, dz)
tx, tz = dx / norm, dz / norm
heading = np.arctan2(tz, tx)
dheading = np.angle(np.exp(1j * np.gradient(np.unwrap(heading))))
curvature = np.abs(dheading) / 2.0
MIN_RADIUS = 1.0 / curvature.max()

# ---- the dunes: a sum of waves in all directions (the long ones are high, the short ones are low), some of them ridged (a sharp crest)
waves = []
for lam in np.geomspace(1300, 45, 26):
    a = 0.012 * lam
    angle = rng.uniform(0, 2 * math.pi)
    waves.append((2 * math.pi / lam, math.cos(angle), math.sin(angle), rng.uniform(0, 2 * math.pi), a, rng.random() < 0.35))


def dunes(x, z):
    h = np.zeros_like(x)
    for k, ax, az, phase, a, ridged in waves:
        w = np.sin(k * (ax * x + az * z) + phase)
        h += a * ((1 - 2 * np.abs(w)) if ridged else w)
    return h


# ---- the heights of the road: the dunes, smoothed (the road does not follow every ripple), and the jumps on top
along = dunes(cx, cz)
road_h = smooth_periodic(along, 25) + 4.0
jumps = []
window = int(0.04 * COUNT)
for fraction in (0.07, 0.17, 0.28, 0.40, 0.52, 0.63, 0.75, 0.87):
    centre = int(fraction * COUNT)
    lo, hi = max(1, centre - window), min(COUNT - 1, centre + window)
    best = lo + int(np.argmin(curvature[lo:hi]))          # the straightest place near it
    height, sigma = rng.uniform(3.0, 4.2), rng.uniform(14, 19)
    jumps.append((best * 2.0, height, sigma))
    d_s = np.abs(s_samples - best * 2.0)
    d_s = np.minimum(d_s, LENGTH - d_s)
    road_h = road_h + height * np.exp(-0.5 * (d_s / sigma) ** 2)
slope = np.abs(np.gradient(road_h, 2.0))

# ---- the terrain
xs = np.linspace(-SIZE / 2, SIZE / 2, N)
gx, gz = np.meshgrid(xs, xs, indexing="xy")             # gx[j, i] = x of column i, gz[j, i] = z of row j
natural = dunes(gx, gz)
natural -= natural.min()
natural *= 0.9
# the nearest point of the road for every point of the terrain
points = np.stack([gx.ravel(), gz.ravel()], axis=1)
nearest = np.zeros(len(points), dtype=np.int32)
dist = np.zeros(len(points))
centre_xz = np.stack([cx, cz], axis=1)
for start in range(0, len(points), 2000):
    block = points[start:start + 2000]
    d2 = ((block[:, None, :] - centre_xz[None, :, :]) ** 2).sum(axis=2)
    best = d2.argmin(axis=1)
    nearest[start:start + 2000] = best
    dist[start:start + 2000] = np.sqrt(d2[np.arange(len(block)), best])
road_at = road_h[nearest].reshape(N, N)
d_map = dist.reshape(N, N)
mix = smoothstep((d_map - FLAT) / BLEND)
# the road bed: flat across the road and 6 cm under it; in the distance the dunes, which are lifted so that they join at the height of the road
lift = float(road_h.mean() - natural.mean())
heights = (1 - mix) * (road_at - 0.06) + mix * (natural + lift)
edge = np.maximum(np.abs(gx), np.abs(gz)) / (SIZE / 2)
heights += 140 * smoothstep((edge - 0.84) / 0.16) ** 1.4            # a wall of dunes round the map
floor = float(heights.min())
heights -= floor
road_h = road_h - floor                  # (the road goes with the terrain)
slope = np.abs(np.gradient(road_h, 2.0))

# the normals of the terrain
step = xs[1] - xs[0]
dHdz, dHdx = np.gradient(heights, step)
normals = np.stack([-dHdx, np.ones_like(heights), -dHdz], axis=2)
normals /= np.linalg.norm(normals, axis=2, keepdims=True)
steep = np.hypot(dHdx, dHdz)


def sample(arr, u, v):
    """The bilinear value of a grid of N x N at u, v in 0..1 (arrays)."""
    fx, fy = u * (N - 1), v * (N - 1)
    x0, y0 = np.clip(fx.astype(int), 0, N - 2), np.clip(fy.astype(int), 0, N - 2)
    tx_, ty_ = fx - x0, fy - y0
    return (arr[y0, x0] * (1 - tx_) * (1 - ty_) + arr[y0, x0 + 1] * tx_ * (1 - ty_) + arr[y0 + 1, x0] * (1 - tx_) * ty_ + arr[y0 + 1, x0 + 1] * tx_ * ty_)


# the colour of the terrain, per pixel: sand that is lighter or redder with the height and the place, rock on the steep slopes, a packed bed along the road
pix = (np.arange(TEXTURE) + 0.5) / TEXTURE
U, V = np.meshgrid(pix, pix, indexing="xy")
H_px = sample(heights, U, V)
S_px = sample(steep, U, V)
D_px = sample(d_map, U, V)
X_px, Z_px = (U - 0.5) * SIZE, (V - 0.5) * SIZE
patch = (np.sin(X_px * 0.011 + 1.3) * np.sin(Z_px * 0.009 + 0.4) + 0.5 * np.sin(X_px * 0.031 + Z_px * 0.023)) * 0.5
fine = rng.normal(0, 1, (TEXTURE, TEXTURE)) * 0.018
sand = np.array([0.74, 0.58, 0.38])
red = np.array([0.68, 0.40, 0.24])
rock = np.array([0.42, 0.29, 0.22])
bed = np.array([0.66, 0.54, 0.40])
tint = smoothstep((H_px - H_px.min()) / (H_px.max() - H_px.min() + 1e-6))[..., None]
colour = sand * (1 - tint * 0.45) + red * (tint * 0.45)
colour = colour + (patch[..., None] * 0.07) + fine[..., None]
colour = colour * (1 - smoothstep((S_px - 0.25) / 0.35)[..., None]) + rock * smoothstep((S_px - 0.25) / 0.35)[..., None]
colour = colour * (1 - 0.6 * smoothstep(1 - (D_px - 8) / 10)[..., None]) + bed * 0.6 * smoothstep(1 - (D_px - 8) / 10)[..., None]
terrain_png_pixels = (np.clip(colour, 0, 1) * 255).astype(np.uint8)


def png(pixels):
    height, width = pixels.shape[:2]
    raw = b"".join(b"\x00" + pixels[y].tobytes() for y in range(height))

    def chunk(kind, body):
        c = struct.pack(">I", len(body)) + kind + body
        return c + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b"")


# the asphalt: across the road in 256 pixels, along it 24 m in 512: white edge lines, a dashed middle line, grain
RW, RL = 256, 512
road_px = np.zeros((RL, RW, 3))
asphalt = 0.20 + 0.04 * rng.normal(0, 1, (RL, RW))
asphalt += 0.02 * np.sin(np.arange(RL)[:, None] * 0.05 + np.arange(RW)[None, :] * 0.11)
road_px[:] = asphalt[..., None] * np.array([1.0, 1.0, 1.04])
u_px = (np.arange(RW) + 0.5) / RW
v_px = (np.arange(RL) + 0.5) / RL
edge_line = ((np.abs(u_px - 0.045) < 0.010) | (np.abs(u_px - 0.955) < 0.010))[None, :] & np.ones((RL, 1), bool)
dash = ((np.abs(u_px - 0.5) < 0.008)[None, :]) & ((v_px % 0.5) < 0.25)[:, None]
road_px[edge_line] = [0.82, 0.82, 0.80]
road_px[dash] = [0.85, 0.74, 0.18]
road_png = png((np.clip(road_px, 0, 1) * 255).astype(np.uint8))

# ---- the files
g.use_materials({
    "sand": {"pbrMetallicRoughness": {"baseColorTexture": {"index": g.add_texture(png(terrain_png_pixels))}, "metallicFactor": 0.0, "roughnessFactor": 1.0}},
    "asphalt": {"pbrMetallicRoughness": {"baseColorTexture": {"index": g.add_texture(road_png)}, "metallicFactor": 0.0, "roughnessFactor": 0.9}},
    "rock": {"pbrMetallicRoughness": {"baseColorFactor": [0.47, 0.35, 0.28, 1], "metallicFactor": 0.0, "roughnessFactor": 1.0}},
    "cactus": {"pbrMetallicRoughness": {"baseColorFactor": [0.22, 0.42, 0.2, 1], "metallicFactor": 0.0, "roughnessFactor": 0.9}, "doubleSided": True},
})

# the terrain: a grid, two triangles a cell (up is +y), in CHUNKS x CHUNKS parts: the game draws only the parts that are in the picture (frustum culling), a single part
# that is 2 km wide is always in it
CHUNKS = 8
edges = np.linspace(0, N - 1, CHUNKS + 1).astype(int)
terrain_parts, road_parts, rock_parts, cactus_parts = [], [], [], []
for cj in range(CHUNKS):
    for ci in range(CHUNKS):
        i0, i1, j0, j1 = edges[ci], edges[ci + 1], edges[cj], edges[cj + 1]
        w, h = i1 - i0 + 1, j1 - j0 + 1
        sub = lambda arr: arr[j0:j1 + 1, i0:i1 + 1]
        pos = np.stack([sub(gx), sub(heights), sub(gz)], axis=2).reshape(-1, 3)
        nor = sub(normals).reshape(-1, 3)
        uv = np.stack([(sub(gx) / SIZE) + 0.5, (sub(gz) / SIZE) + 0.5], axis=2).reshape(-1, 2)
        ii, jj = np.meshgrid(np.arange(w - 1), np.arange(h - 1), indexing="xy")
        a_ = (jj * w + ii).ravel()
        idx = np.stack([a_, a_ + w, a_ + 1, a_ + 1, a_ + w, a_ + w + 1], axis=1).ravel()
        name = "terrain_%d_%d" % (ci, cj)
        g.part_uv(name, (0, 0, 0), pos.ravel().tolist(), nor.ravel().tolist(), uv.ravel().tolist(), idx.tolist(), "sand")
        terrain_parts.append(name)

# the road: a strip along the middle, 12 m wide, a quad every 2 m; the texture is a tile of 24 m along it; in 16 parts along the road
closed_i = np.concatenate([np.arange(COUNT), [0]])
left = np.stack([cx - tz * ROAD / 2, road_h, cz + tx * ROAD / 2], axis=1)
right = np.stack([cx + tz * ROAD / 2, road_h, cz - tx * ROAD / 2], axis=1)
verts, tex, nrm = [], [], []
slope_signed = np.gradient(road_h, 2.0)
for k in range(COUNT + 1):
    q = closed_i[k]
    n = np.array([-slope_signed[q] * tx[q], 1.0, -slope_signed[q] * tz[q]])
    n /= np.linalg.norm(n)
    v = k * 2.0 / 24.0
    verts += [left[q], right[q]]
    tex += [[0.0, v], [1.0, v]]
    nrm += [n, n]
verts, tex, nrm = np.array(verts), np.array(tex), np.array(nrm)
probe = np.cross(verts[1] - verts[0], verts[2] - verts[0])           # which way the first triangle faces: up is wanted
flip = probe[1] < 0
ROAD_PARTS = 16
for part in range(ROAD_PARTS):
    k0, k1 = part * COUNT // ROAD_PARTS, (part + 1) * COUNT // ROAD_PARTS
    sel = slice(2 * k0, 2 * k1 + 2)
    quads = []
    for k in range(k1 - k0):
        l0, r0, l1, r1 = 2 * k, 2 * k + 1, 2 * k + 2, 2 * k + 3
        quads += ([l0, l1, r0, r0, l1, r1] if flip else [l0, r0, l1, r0, r1, l1])
    name = "road_%d" % part
    g.part_uv(name, (0, 0, 0), verts[sel].ravel().tolist(), nrm[sel].ravel().tolist(), tex[sel].ravel().tolist(), quads, "asphalt")
    road_parts.append(name)

# ---- rocks (low, flat shaded stones that the car drives into) and cacti (only to look at), put on the sand away from the road bed; in the chunks of the terrain
def ground_at(x, z):
    """The height of the terrain and the distance to the road at x, z (bilinear)."""
    fx, fz = (x / SIZE + 0.5) * (N - 1), (z / SIZE + 0.5) * (N - 1)
    x0, z0 = int(np.clip(fx, 0, N - 2)), int(np.clip(fz, 0, N - 2))
    tx_, tz_ = fx - x0, fz - z0
    interp = lambda arr: (arr[z0, x0] * (1 - tx_) * (1 - tz_) + arr[z0, x0 + 1] * tx_ * (1 - tz_) + arr[z0 + 1, x0] * (1 - tx_) * tz_ + arr[z0 + 1, x0 + 1] * tx_ * tz_)
    return interp(heights), interp(d_map), interp(steep)


def chunk_of(x, z):
    ci = int(np.clip(np.searchsorted(edges, (x / SIZE + 0.5) * (N - 1), side="right") - 1, 0, CHUNKS - 1))
    cj = int(np.clip(np.searchsorted(edges, (z / SIZE + 0.5) * (N - 1), side="right") - 1, 0, CHUNKS - 1))
    return ci, cj


GOLD = (1 + 5 ** 0.5) / 2
ICO = [(-1, GOLD, 0), (1, GOLD, 0), (-1, -GOLD, 0), (1, -GOLD, 0), (0, -1, GOLD), (0, 1, GOLD), (0, -1, -GOLD), (0, 1, -GOLD), (GOLD, 0, -1), (GOLD, 0, 1), (-GOLD, 0, -1), (-GOLD, 0, 1)]
ICO_FACES = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8), (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]


def rock(x, y, z, size):
    """A rock: an icosahedron with every point moved a little, flat shaded (a point for every face), a little flattened and turned at random."""
    base = np.array(ICO, dtype=float)
    base /= np.linalg.norm(base, axis=1)[:, None]
    base *= (0.75 + 0.5 * rng.random(len(base)))[:, None]
    base[:, 1] *= 0.7
    angle = rng.random() * 2 * math.pi
    c, s_ = math.cos(angle), math.sin(angle)
    base = np.stack([base[:, 0] * c - base[:, 2] * s_, base[:, 1], base[:, 0] * s_ + base[:, 2] * c], axis=1) * size
    base[:, 1] += size * 0.2                                           # (a part of it is in the ground)
    p, n, i = [], [], []
    for f in ICO_FACES:
        a_, b_, c_ = base[f[0]], base[f[1]], base[f[2]]
        normal = np.cross(b_ - a_, c_ - a_)
        normal /= np.linalg.norm(normal) + 1e-9
        if np.dot(normal, (a_ + b_ + c_) / 3) < 0:
            normal = -normal
            b_, c_ = c_, b_
        k = len(p) // 3
        for q in (a_, b_, c_):
            p += [x + q[0], y + q[1], z + q[2]]
            n += list(normal)
        i += [k, k + 1, k + 2]
    return p, n, i


def cactus(x, y, z, height):
    """A cactus: a tube of eight sides with a rounded top and sometimes an arm or two."""
    p, n, i = [], [], []

    def tube(cx_, cy_, cz_, r, h, lean=(0.0, 0.0)):
        base = len(p) // 3
        for ring, t in enumerate((0.0, 1.0)):
            for k in range(8):
                a_ = 2 * math.pi * k / 8
                p.extend([cx_ + math.cos(a_) * r + lean[0] * t, cy_ + h * t, cz_ + math.sin(a_) * r + lean[1] * t])
                n.extend([math.cos(a_), 0.0, math.sin(a_)])
        for k in range(8):
            a0, a1 = base + k, base + (k + 1) % 8
            i.extend([a0, a0 + 8, a1, a1, a0 + 8, a1 + 8])
        top = len(p) // 3
        p.extend([cx_ + lean[0], cy_ + h + r * 0.9, cz_ + lean[1]])
        n.extend([0, 1, 0])
        for k in range(8):
            i.extend([base + 8 + (k + 1) % 8, base + 8 + k, top])

    r = 0.22 + 0.06 * rng.random()
    tube(x, y - 0.1, z, r, height)
    for arm in range(int(rng.integers(0, 3))):
        side = 1 if rng.random() < 0.5 else -1
        h0 = height * (0.35 + 0.25 * rng.random())
        a_ = rng.random() * 2 * math.pi
        dx, dz = math.cos(a_), math.sin(a_)
        tube(x + dx * (r + 0.05), y + h0, z + dz * (r + 0.05), r * 0.6, 0.35, (dx * 0.5, dz * 0.5))
        tube(x + dx * (r + 0.55), y + h0 + 0.3, z + dz * (r + 0.55), r * 0.6, height * 0.25)
    return p, n, i


def scatter(count, maker, low, high, store, min_road=22.0, far=900.0):
    """Puts count things on the terrain at random places, between the distances low and high from the road, and gathers them per chunk."""
    cells = {}
    tries = 0
    while sum(len(v) for v in cells.values()) < count and tries < count * 40:
        tries += 1
        x, z = rng.uniform(-SIZE / 2 + 60, SIZE / 2 - 60), rng.uniform(-SIZE / 2 + 60, SIZE / 2 - 60)
        y, d, steepness = ground_at(x, z)
        if d < min_road or d > far or steepness > 0.5:
            continue
        cells.setdefault(chunk_of(x, z), []).append(maker(x, y, z))
    for (ci, cj), items in cells.items():
        p, n, i = g.merge(*items)
        store.append((ci, cj, p, n, i))
    return sum(len(v) for v in cells.values())


rocks = scatter(160, lambda x, y, z: rock(x, y, z, float(rng.choice([0.8, 1.2, 1.8, 2.6, 4.0], p=[0.3, 0.3, 0.2, 0.15, 0.05]))), 20, 900, rock_parts)
cacti = scatter(260, lambda x, y, z: cactus(x, y, z, float(rng.uniform(1.8, 4.2))), 20, 900, cactus_parts)
rock_names, cactus_names = [], []
for ci, cj, p, n, i in rock_parts:
    name = "rocks_%d_%d" % (ci, cj)
    g.part(name, (0, 0, 0), (p, n, i), "rock")
    rock_names.append(name)
for ci, cj, p, n, i in cactus_parts:
    name = "cacti_%d_%d" % (ci, cj)
    g.part(name, (0, 0, 0), (p, n, i), "cactus")
    cactus_names.append(name)
os.makedirs(ROOT, exist_ok=True)
g.write(os.path.join(ROOT, "desert.glb"), "desert", "OpenRacer make-desert-track.py")

# ---- track.json: the start, the gates, the surfaces, the sky, the line for the AI and the cameras at the jumps
def at(s):
    i = int(round(s / 2.0)) % COUNT
    return i


def round2(v):
    return round(float(v), 2)


start_i = 0
gates = []
for k in range(0, 10):
    i = at(6.0 + k * LENGTH / 10)
    gates.append({"x": round2(cx[i]), "z": round2(cz[i]), "heading": round(float(heading[i]), 5), "width": 22})
track = {
    "name": "Desert",
    "description": "A winding road of 12 m through the dunes, with eight jumps. Best with the off-road tyre when you leave the road.",
    "start": {"x": round2(cx[start_i]), "z": round2(cz[start_i]), "heading": round(float(heading[start_i]), 5)},
    "gates": gates,
    "model": "desert.glb",
    "environment": {
        "sky_top": "#2f78d2", "sky_horizon": "#f1d9b3",
        "fog": {"enabled": True, "color": "#ecd5b0", "near": 700, "far": 3500},
        "sun": {"azimuth": 35, "elevation": 48, "intensity": 0.95, "color": "#fff1d6"},
        "ambient": {"color": "#8a7a68", "intensity": 1}
    },
    "surfaces": {"meshes": dict([(n, "road") for n in road_parts] + [(n, "sand") for n in terrain_parts] + [(n, "scenery") for n in rock_names] + [(n, "decor") for n in cactus_names])},
    "racing_line": [{"x": round2(cx[i]), "y": round2(road_h[i]), "z": round2(cz[i])} for i in range(0, COUNT, 2)],
    "cameras": []
}
for s, height, sigma in jumps:
    i = at(s)
    # beside the road, a little before the crest, high enough to see the car leave the ground
    for offset in (-34.0, 22.0):
        j = (i + int(offset / 2.0)) % COUNT
        px, pz = cx[j] + tz[j] * 14.0, cz[j] - tx[j] * 14.0
        track["cameras"].append({"x": round2(px), "y": round2(road_h[j] + 3.0), "z": round2(pz), "range": {"x": round2(cx[i]), "z": round2(cz[i]), "r": 55.0}})
with open(os.path.join(ROOT, "track.json"), "w") as f:
    json.dump(track, f, indent=1)
print("%d rocks, %d cacti, %d terrain parts, %d road parts" % (rocks, cacti, len(terrain_parts), len(road_parts)))
print("road: %.1f km, smallest bend radius %.0f m, steepest %.1f degrees, %d jumps, heights %.0f to %.0f m" % (LENGTH / 1000, MIN_RADIUS, math.degrees(math.atan(slope.max())), len(jumps), heights.min(), heights.max()))
