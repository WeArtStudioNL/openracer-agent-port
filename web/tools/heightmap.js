/*
 * heightmap.js
 *
 * Description: A track from a height map and a colour map (the track editor, "Import height map"). The height map is a picture of the height of the ground, a 16 bit grey
 *              PNG (black is the lowest, white is the highest, 65536 steps: smooth enough for a road); the colour map is a picture of the colour of the same ground, as big
 *              as you like. Both cover the same square. The browser turns a 16 bit PNG into 8 bits when it draws it, so the PNG is read here (decodePng).
 *              buildTerrain makes a mesh of the height map with the colour map as its texture and gives it as a .glb, which the track editor takes like any model.
 *
 * The picture is seen from above with the north (the top of the picture) towards -z: the top left pixel is at x = -size / 2, z = -size / 2.
 */

import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function inflate(bytes) {
    if (typeof DecompressionStream === "undefined") return Promise.reject(new Error("This browser cannot read a PNG here. Use a recent Chrome, Edge, Safari or Firefox."));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new Response(stream).arrayBuffer().then((buffer) => new Uint8Array(buffer), () => { throw new Error("This PNG is damaged."); });
}

function paeth(a, b, c) {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
}

// The first channel of every pixel of a PNG (the grey of a grey picture, the red of a colour one) as 16 bit numbers, whatever the depth of the file is: { width, height, data: Uint16Array, depth }
export async function decodePng(buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 33 || SIGNATURE.some((v, i) => bytes[i] !== v)) throw new Error("This is not a PNG file.");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
    const parts = [];
    let at = 8;
    while (at + 8 <= bytes.length) {
        const length = view.getUint32(at), type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
        const body = bytes.subarray(at + 8, at + 8 + length);
        if (type === "IHDR") { width = view.getUint32(at + 8); height = view.getUint32(at + 12); depth = bytes[at + 16]; colorType = bytes[at + 17]; interlace = bytes[at + 20]; }
        else if (type === "IDAT") parts.push(body);
        else if (type === "IEND") break;
        at += 12 + length;
    }
    if (!width || !height || !parts.length) throw new Error("This PNG is damaged.");
    if (interlace) throw new Error("This PNG is interlaced (Adam7). Save it again without interlacing.");
    if (colorType === 3) throw new Error("This PNG has a palette. Save it as a grey picture (16 bit) instead.");
    if (width * height > 64e6) throw new Error("This picture is too big.");
    const joined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { joined.set(p, o); o += p.length; }
    const raw = await inflate(joined);
    const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
    if (!channels) throw new Error("This kind of PNG is not supported.");
    const bits = channels * depth, bpp = Math.max(1, bits >> 3), stride = (width * bits + 7) >> 3;
    if (raw.length < (stride + 1) * height) throw new Error("This PNG is damaged.");
    // the filters of the rows
    const rows = new Uint8Array(stride * height);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride, up = dst - stride;
        for (let x = 0; x < stride; x++) {
            const value = raw[src + x];
            const left = x >= bpp ? rows[dst + x - bpp] : 0, above = y > 0 ? rows[up + x] : 0, upLeft = x >= bpp && y > 0 ? rows[up + x - bpp] : 0;
            rows[dst + x] = filter === 0 ? value : filter === 1 ? value + left : filter === 2 ? value + above : filter === 3 ? value + ((left + above) >> 1) : value + paeth(left, above, upLeft);
        }
    }
    const data = new Uint16Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let v;
            if (depth === 16) { const i = y * stride + x * channels * 2; v = (rows[i] << 8) | rows[i + 1]; }
            else if (depth === 8) v = rows[y * stride + x * channels] * 257;
            else { const per = 8 / depth, i = y * stride + Math.floor(x / per), shift = 8 - depth * (1 + (x % per)); v = ((rows[i] >> shift) & ((1 << depth) - 1)) * 65535 / ((1 << depth) - 1); }
            data[y * width + x] = v;
        }
    }
    return { width, height, data, depth };
}

// The heights of a picture of any kind: a PNG is read as it is (16 bit), another kind of picture (jpg, webp) by the browser, in 8 bits
export async function readHeights(file) {
    const buffer = await file.arrayBuffer();
    const head = new Uint8Array(buffer, 0, Math.min(8, buffer.byteLength));
    if (SIGNATURE.every((v, i) => head[i] === v)) return decodePng(buffer);
    const bitmap = await createImageBitmap(new Blob([buffer]));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const data = new Uint16Array(canvas.width * canvas.height);
    for (let i = 0; i < data.length; i++) data[i] = pixels[i * 4] * 257;
    return { width: canvas.width, height: canvas.height, data, depth: 8 };
}

// The colours of a surface map, and the surface that each one is (the nearest colour counts)
export const SURFACE_COLOURS = { road: [128, 128, 128], sand: [255, 255, 0], gravel: [255, 255, 255], mud: [120, 72, 30], grass: [0, 170, 0], ground: [200, 120, 40] };

async function readSurfaces(file) {
    const bitmap = await createImageBitmap(file);
    const size = Math.min(1024, Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = size; canvas.height = size;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.imageSmoothingEnabled = false;
    context.drawImage(bitmap, 0, 0, size, size);
    return { size, pixels: context.getImageData(0, 0, size, size).data };
}

function surfaceAt(map, u, v) {
    const x = Math.min(map.size - 1, Math.floor(u * map.size)), y = Math.min(map.size - 1, Math.floor(v * map.size)), i = (y * map.size + x) * 4;
    let best = "road", bestD = Infinity;
    for (const [role, c] of Object.entries(SURFACE_COLOURS)) {
        const d = (map.pixels[i] - c[0]) ** 2 + (map.pixels[i + 1] - c[1]) ** 2 + (map.pixels[i + 2] - c[2]) ** 2;
        if (d < bestD) { bestD = d; best = role; }
    }
    return best;
}

function loadImage(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("The colour map could not be read as a picture."));
        image.src = url;
    });
}

// The mesh of the height map: size (m) is the length of the side of the square, top the height (m) of white, step the number of pixels between two vertices (more = lighter),
// colourFile the colour map (or null: grey). Gives { file: the .glb as a File, vertices, triangles, grid }
export async function buildTerrain(heightFile, colourFile, options) {
    const map = await readHeights(heightFile);
    const size = Math.max(10, options.size || map.width), top = options.top === undefined ? 60 : options.top;
    const step = Math.max(1, Math.round(options.step || 4));
    const nx = Math.max(2, Math.floor((map.width - 1) / step) + 1), nz = Math.max(2, Math.floor((map.height - 1) / step) + 1);
    if (nx * nz > 600 * 600) throw new Error("That is too many points (" + nx + " × " + nz + "). Take a bigger step.");
    const depthSize = size * map.height / map.width;
    const sample = (px, py) => {      // bilinear, px and py in pixels
        const x0 = Math.min(map.width - 1, Math.floor(px)), y0 = Math.min(map.height - 1, Math.floor(py));
        const x1 = Math.min(map.width - 1, x0 + 1), y1 = Math.min(map.height - 1, y0 + 1), fx = px - x0, fy = py - y0;
        const h = (x, y) => map.data[y * map.width + x];
        return ((h(x0, y0) * (1 - fx) + h(x1, y0) * fx) * (1 - fy) + (h(x0, y1) * (1 - fx) + h(x1, y1) * fx) * fy) / 65535;
    };
    const positions = new Float32Array(nx * nz * 3), uvs = new Float32Array(nx * nz * 2);
    for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) {
            const u = i / (nx - 1), v = j / (nz - 1), k = j * nx + i;
            positions[3 * k] = (u - 0.5) * size;
            positions[3 * k + 1] = sample(u * (map.width - 1), v * (map.height - 1)) * top;
            positions[3 * k + 2] = (v - 0.5) * depthSize;
            uvs[2 * k] = u; uvs[2 * k + 1] = v;                       // (the picture is read from the top, as glTF has it)
        }
    }
    // the cells, by surface: with a surface map every cell has the surface of the colour of the map where it is (a part for every surface), without one the whole terrain has the one
    const surfaces = options.surfaceFile ? await readSurfaces(options.surfaceFile) : null;
    const cells = {};
    for (let j = 0; j < nz - 1; j++) {
        for (let i = 0; i < nx - 1; i++) {
            const role = surfaces ? surfaceAt(surfaces, (i + 0.5) / (nx - 1), (j + 0.5) / (nz - 1)) : "all";
            const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
            (cells[role] || (cells[role] = [])).push(a, c, b, b, c, d);
        }
    }
    const indices = { length: Object.values(cells).reduce((n, l) => n + l.length, 0) };
    const base = new THREE.BufferGeometry();
    base.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    base.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    base.setIndex(new THREE.BufferAttribute(new Uint32Array(cells[Object.keys(cells)[0]]), 1));
    base.computeVertexNormals();
    const geometry = base;
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    material.name = "terrain";
    if (colourFile) {
        const image = await loadImage(colourFile);
        const texture = new THREE.Texture(image);
        texture.flipY = false;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.userData.mimeType = /jpe?g$/i.test(colourFile.name) ? "image/jpeg" : "image/png";
        texture.needsUpdate = true;
        material.map = texture;
    } else {
        material.color.set(0x8a9a78);
    }
    const scene = new THREE.Scene();
    const roles = {};
    for (const [role, list] of Object.entries(cells)) {
        const part = new THREE.BufferGeometry();
        part.setAttribute("position", base.getAttribute("position"));
        part.setAttribute("normal", base.getAttribute("normal"));
        part.setAttribute("uv", base.getAttribute("uv"));
        part.setIndex(new THREE.BufferAttribute(new Uint32Array(list), 1));
        const mesh = new THREE.Mesh(part, material);
        mesh.name = role === "all" ? "terrain" : "terrain_" + role;
        roles[mesh.name] = role === "all" ? (options.role || "road") : role;
        scene.add(mesh);
    }
    const glb = await new Promise((resolve, reject) => new GLTFExporter().parse(scene, resolve, (e) => reject(new Error("The terrain could not be made: " + (e.message || e))), { binary: true }));
    return { file: new File([glb], "terrain.glb", { type: "model/gltf-binary" }), vertices: nx * nz, triangles: indices.length / 3, roles, parts: Object.keys(cells).length, grid: [nx, nz], size: [size, depthSize], pixels: [map.width, map.height], depth: map.depth };
}
