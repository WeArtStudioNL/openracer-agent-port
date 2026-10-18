#!/usr/bin/env python3
"""
make-textures.py

Makes the tileable textures of the track editor (web/textures/*.jpg): asphalt, grass, dirt, concrete, brick, roof tiles, wood,
metal and the like. They are made from periodic noise, so every one of them repeats seamlessly. Run it again to make them again;
the random seed is fixed, so the files come out the same.

    python3 tools/make-textures.py
"""
import os
import numpy as np
from PIL import Image

SIZE = 512
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "textures")
rng = np.random.default_rng(7)


def lattice_noise(period, size=SIZE):
    """Value noise on a lattice of `period` cells that wraps round, smoothly interpolated: it tiles."""
    values = rng.random((period, period))
    y, x = np.mgrid[0:size, 0:size].astype(np.float64)
    fx, fy = x / size * period, y / size * period
    x0, y0 = np.floor(fx).astype(int) % period, np.floor(fy).astype(int) % period
    x1, y1 = (x0 + 1) % period, (y0 + 1) % period
    tx, ty = fx - np.floor(fx), fy - np.floor(fy)
    tx, ty = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
    a = values[y0, x0] * (1 - tx) + values[y0, x1] * tx
    b = values[y1, x0] * (1 - tx) + values[y1, x1] * tx
    return a * (1 - ty) + b * ty


def fbm(period, octaves=4, gain=0.5):
    total, amp, norm = np.zeros((SIZE, SIZE)), 1.0, 0.0
    for _ in range(octaves):
        total += amp * lattice_noise(period)
        norm += amp
        period *= 2
        amp *= gain
    return total / norm


def grain(strength):
    return (rng.random((SIZE, SIZE)) - 0.5) * strength


def rgb(r, g, b):
    return np.array([r, g, b], dtype=np.float64) / 255


def shade(colour, light):
    """A colour (3) times a brightness map (SIZE x SIZE) -> image array."""
    return np.clip(colour[None, None, :] * light[:, :, None], 0, 1)


def mix(a, b, t):
    return a * (1 - t[:, :, None]) + b * t[:, :, None]


def save(name, img):
    arr = (np.clip(img, 0, 1) * 255).astype(np.uint8)
    Image.fromarray(arr, "RGB").save(os.path.join(OUT, name + ".jpg"), quality=86)
    print(" ", name + ".jpg")


def asphalt(name, base, variation):
    light = 0.85 + fbm(8, 3) * 0.3 + grain(variation)
    specks = (rng.random((SIZE, SIZE)) > 0.985).astype(np.float64) * 0.25
    save(name, shade(base, light + specks))


def grassy(name, dark, bright, dry):
    patches = fbm(6, 4)
    fine = lattice_noise(64) * 0.5 + lattice_noise(128) * 0.5
    img = mix(shade(dark, np.ones((SIZE, SIZE))), shade(bright, np.ones((SIZE, SIZE))), np.clip(patches * 0.7 + fine * 0.6 - 0.2, 0, 1))
    img = mix(img, shade(dry, np.ones((SIZE, SIZE))), np.clip((fbm(4, 2) - 0.55) * 2.5, 0, 1))
    light = 0.8 + fine * 0.5 + grain(0.18)
    save(name, img * light[:, :, None])


def brick():
    rows, cols = 16, 8
    y, x = np.mgrid[0:SIZE, 0:SIZE]
    row = y * rows // SIZE
    shift = (row % 2) * (SIZE // cols // 2)
    col = ((x + shift) % SIZE) * cols // SIZE
    cell_y, cell_x = y * rows % SIZE, (x + shift) % SIZE * cols % SIZE
    mortar_w = SIZE // rows * 0.14
    mortar = (cell_y / rows < mortar_w) | (cell_x / cols < mortar_w)
    seeds = rng.random((rows, cols))
    per_brick = seeds[row % rows, col % cols]
    base = mix(shade(rgb(150, 62, 48), np.ones((SIZE, SIZE))), shade(rgb(190, 96, 70), np.ones((SIZE, SIZE))), per_brick)
    light = 0.9 + grain(0.25) + lattice_noise(32) * 0.2
    img = base * light[:, :, None]
    img[mortar] = (shade(rgb(205, 198, 185), 0.9 + grain(0.2)))[mortar]
    save("brick", img)


def roof():
    rows, cols = 12, 10
    y, x = np.mgrid[0:SIZE, 0:SIZE]
    row = y * rows // SIZE
    shift = (row % 2) * (SIZE // cols // 2)
    cell_y = (y * rows % SIZE) / SIZE          # 0..1 down a tile
    cell_x = ((x + shift) % SIZE * cols % SIZE) / SIZE
    seeds = rng.random((rows, cols))
    per_tile = seeds[row % rows, ((x + shift) % SIZE * cols // SIZE) % cols]
    base = mix(shade(rgb(128, 52, 42), np.ones((SIZE, SIZE))), shade(rgb(178, 86, 62), np.ones((SIZE, SIZE))), per_tile)
    curve = 1 - 0.35 * cell_y - 0.25 * np.abs(cell_x - 0.5)   # darker at the bottom and the edges of a tile
    edge = (cell_y < 0.06) | (np.abs(cell_x - 0.5) > 0.47)
    light = curve + grain(0.12)
    img = base * light[:, :, None]
    img[edge] *= 0.55
    save("roof", img)


def wood():
    y, x = np.mgrid[0:SIZE, 0:SIZE]
    planks = 6
    plank = x * planks // SIZE
    gap = (x * planks % SIZE) / SIZE < 0.03
    seeds = rng.random(planks)
    per_plank = seeds[plank % planks]
    grain_n = lattice_noise(4) * 0 + fbm(3, 3)
    # the grain runs along the plank: the noise is stretched vertically
    stretched = np.roll(fbm(16, 3), 0, axis=0)
    rings = (np.sin((stretched * 6 + x / SIZE * 3) * np.pi * 2) * 0.5 + 0.5) * 0.25
    base = mix(shade(rgb(160, 112, 66), np.ones((SIZE, SIZE))), shade(rgb(196, 150, 96), np.ones((SIZE, SIZE))), per_plank)
    light = 0.8 + rings + grain(0.08) + grain_n * 0.1
    img = base * light[:, :, None]
    img[gap] *= 0.45
    save("wood", img)


def metal():
    y, x = np.mgrid[0:SIZE, 0:SIZE]
    streaks = lattice_noise(2) * 0 + fbm(64, 2) * 0.12 + fbm(2, 2) * 0.1
    light = 0.78 + streaks + grain(0.05)
    save("metal", shade(rgb(150, 156, 165), light))


def rubber():
    y, x = np.mgrid[0:SIZE, 0:SIZE]
    tread = ((x * 24 % SIZE) / SIZE < 0.5).astype(np.float64) * 0.12
    light = 0.75 + tread + grain(0.1) + fbm(8, 2) * 0.15
    save("rubber", shade(rgb(38, 40, 44), light))


def main():
    os.makedirs(OUT, exist_ok=True)
    print("textures in " + OUT)
    asphalt("asphalt", rgb(70, 73, 79), 0.22)
    asphalt("asphalt-light", rgb(118, 120, 124), 0.18)
    light = 0.85 + fbm(4, 4) * 0.25 + grain(0.12)
    save("concrete", shade(rgb(176, 174, 168), light))
    grassy("grass", rgb(52, 96, 40), rgb(96, 150, 58), rgb(140, 142, 70))
    grassy("grass-dry", rgb(104, 110, 48), rgb(160, 156, 78), rgb(186, 170, 98))
    save("dirt", shade(rgb(118, 90, 60), 0.75 + fbm(6, 4) * 0.45 + grain(0.2)))
    specks = (lattice_noise(128) > 0.62).astype(np.float64) * 0.35 + (lattice_noise(96) < 0.3).astype(np.float64) * -0.2
    save("gravel", shade(rgb(142, 134, 120), 0.75 + specks + fbm(16, 2) * 0.2 + grain(0.2)))
    save("sand", shade(rgb(214, 196, 150), 0.86 + fbm(5, 3) * 0.2 + grain(0.1)))
    brick()
    save("plaster", shade(rgb(226, 214, 190), 0.9 + fbm(6, 3) * 0.12 + grain(0.08)))
    roof()
    wood()
    metal()
    rubber()
    leaves = fbm(12, 4)
    img = mix(shade(rgb(34, 86, 30), np.ones((SIZE, SIZE))), shade(rgb(92, 160, 56), np.ones((SIZE, SIZE))), np.clip(leaves * 1.6 - 0.3, 0, 1))
    save("leaves", img * (0.85 + grain(0.25) + lattice_noise(96) * 0.3)[:, :, None])
    bark = fbm(3, 3) * 0.3 + np.roll(lattice_noise(24), 0, axis=1) * 0.2   # ridges along the trunk
    y, x = np.mgrid[0:SIZE, 0:SIZE]
    ridges = (np.sin(x / SIZE * np.pi * 2 * 18 + fbm(6, 2) * 6) * 0.5 + 0.5) * 0.3
    save("bark", shade(rgb(96, 70, 46), 0.7 + bark + ridges + grain(0.12)))


if __name__ == "__main__":
    main()
