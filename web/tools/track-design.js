/*
 * track-design.js
 *
 * Description: The design of a track in the track editor without a model from Blender: a road drawn with nodes (a smooth closed loop
 *              through them, with the height and the width of the road at every node), the grass beside it and the ground under it, and
 *              prefabs (walls, tyre stacks, barriers, trees, bushes, houses, a grandstand, lamp posts, cones) that are put down in the
 *              view and moved with a gizmo. The design is kept in track.json ("design": nodes and prefabs, so it can be changed again)
 *              and saved as a glb that the game loads like any other track (the parts are named so that the surfaces are known).
 */

import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const UP = new THREE.Vector3(0, 1, 0);

// ---- the tileable textures (web/textures, made by tools/make-textures.py): the file, how many metres one tile covers, and the
// roughness of the surface. The UVs of everything are in metres divided by the size, so a texture repeats seamlessly over a road of
// any length and a wall of any size, and it goes into the glb with the track.
const TEXTURE_PATH = "../textures/";
const TEXTURES = {
    asphalt: { label: "Asphalt", size: 4, roughness: 0.9 },
    "asphalt-light": { label: "Light asphalt", size: 4, roughness: 0.9 },
    concrete: { label: "Concrete", size: 3, roughness: 0.85 },
    gravel: { label: "Gravel", size: 3, roughness: 1 },
    grass: { label: "Grass", size: 6, roughness: 1 },
    "grass-dry": { label: "Dry grass", size: 6, roughness: 1 },
    dirt: { label: "Dirt", size: 6, roughness: 1 },
    sand: { label: "Sand", size: 6, roughness: 1 },
    brick: { label: "Brick", size: 2, roughness: 0.85 },
    plaster: { label: "Plaster", size: 3, roughness: 0.8 },
    roof: { label: "Roof tiles", size: 2.5, roughness: 0.8 },
    wood: { label: "Wood", size: 2, roughness: 0.75 },
    metal: { label: "Metal", size: 1.5, roughness: 0.45 },
    rubber: { label: "Rubber", size: 0.5, roughness: 0.9 },
    leaves: { label: "Leaves", size: 2, roughness: 1 },
    bark: { label: "Bark", size: 1, roughness: 1 }
};
// the textures to choose from for the road, the shoulders, the ground and the prefabs that have a choice
const TEXTURE_CHOICES = {
    road: ["asphalt", "asphalt-light", "concrete", "gravel", "dirt"],
    shoulder: ["grass", "grass-dry", "dirt", "gravel", "sand"],
    ground: ["grass", "grass-dry", "dirt", "sand", "gravel"],
    wall: ["concrete", "brick", "plaster", "wood", "metal"],
    house: ["plaster", "brick", "wood", "concrete"],
    grandstand: ["concrete", "metal", "wood"],
    barrier: ["metal", "wood", "concrete"]
};
const DEFAULT_TEXTURES = { road: "asphalt", shoulder: "grass", ground: "grass" };

const textureCache = new Map(), materialCache = new Map();
let maxAnisotropy = 1;
function texture(name) {
    if (!textureCache.has(name)) {
        // (the picture is loaded before a glb is written from it: prefabGlb waits for this promise)
        let done, failed;
        const loaded = new Promise((resolve, reject) => { done = resolve; failed = reject; });
        const t = new THREE.TextureLoader().load(TEXTURE_PATH + name + ".jpg", () => done(), undefined, () => failed(new Error("the texture " + name + " could not be loaded")));
        t.userData.loaded = loaded;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = maxAnisotropy;
        t.name = name;
        t.userData.mimeType = "image/jpeg"; // the exporter keeps it a jpeg in the glb (a png would be six times the size)
        textureCache.set(name, t);
    }
    return textureCache.get(name);
}
// a material with a texture (and a tint, white by default): one per texture and tint, so merged rows and the glb share them
function textured(name, tint, side) {
    const key = name + ":" + (tint === undefined ? "ffffff" : tint.toString(16)) + ":" + (side || 0);
    if (!materialCache.has(key)) {
        const def = TEXTURES[name];
        const m = new THREE.MeshStandardMaterial({ map: texture(name), color: tint === undefined ? 0xffffff : tint, roughness: def.roughness, metalness: name === "metal" ? 0.3 : 0, side: side || THREE.FrontSide });
        m.name = name;
        materialCache.set(key, m);
    }
    return materialCache.get(key);
}
function material(color) { return typeof color === "string" ? textured(color) : new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0 }); }

// UVs in metres from the position, on the axis that the face looks along (exact for a box: every face is tiled by its size)
function worldUVs(geometry, size) {
    const position = geometry.attributes.position, normal = geometry.attributes.normal, uv = geometry.attributes.uv;
    for (let i = 0; i < position.count; i++) {
        const nx = Math.abs(normal.getX(i)), ny = Math.abs(normal.getY(i)), nz = Math.abs(normal.getZ(i));
        const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
        if (ny >= nx && ny >= nz) uv.setXY(i, x / size, z / size);
        else if (nx >= nz) uv.setXY(i, z / size, y / size);
        else uv.setXY(i, x / size, y / size);
    }
    uv.needsUpdate = true;
    return geometry;
}
function scaleUVs(geometry, su, sv) {
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    return geometry;
}
function sizeOf(tex) { return typeof tex === "string" ? TEXTURES[tex].size : 1; }
function box(w, h, d, tex, x, y, z) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (typeof tex === "string") worldUVs(g, sizeOf(tex));
    const m = new THREE.Mesh(g, material(tex)); m.position.set(x, y, z); return m;
}
function cylinder(r, h, tex, x, y, z) {
    const g = new THREE.CylinderGeometry(r, r, h, 16);
    if (typeof tex === "string") scaleUVs(g, 2 * Math.PI * r / sizeOf(tex), h / sizeOf(tex));
    const m = new THREE.Mesh(g, material(tex)); m.position.set(x, y, z); return m;
}
function cone(r, h, segments, tex) {
    const g = new THREE.ConeGeometry(r, h, segments);
    if (typeof tex === "string") scaleUVs(g, Math.PI * r / sizeOf(tex), Math.hypot(r, h) / sizeOf(tex));
    return new THREE.Mesh(g, material(tex));
}

// ---- the prefabs: a function that makes the object (y = 0 is the ground; t is the chosen texture of the prefabs that have a
// choice, see TEXTURE_CHOICES), and the surface of its parts in the game
const PREFABS = {
    wall: { label: "Wall", icon: "▬", role: "scenery", make: (t) => {
        const g = new THREE.Group();
        g.add(box(4, 1, 0.3, t || "concrete", 0, 0.5, 0));
        return g;
    } },
    barrier: { label: "Barrier", icon: "═", role: "scenery", make: (t) => {
        const g = new THREE.Group();
        g.add(box(4, 0.35, 0.08, t || "metal", 0, 0.6, 0));
        g.add(box(0.1, 0.75, 0.1, "metal", -1.9, 0.375, 0));
        g.add(box(0.1, 0.75, 0.1, "metal", 1.9, 0.375, 0));
        return g;
    } },
    tyres: { label: "Tyre stack", icon: "◎", role: "scenery", make: () => {
        const g = new THREE.Group();
        for (let i = 0; i < 4; i++) g.add(cylinder(0.36, 0.22, i === 3 ? 0xc53b32 : "rubber", 0, 0.11 + i * 0.22, 0));
        return g;
    } },
    tyrewall: { label: "Tyre wall", icon: "◎◎◎", role: "scenery", make: () => {
        const g = new THREE.Group();
        for (let s = -1; s <= 1; s++) for (let i = 0; i < 3; i++) g.add(cylinder(0.36, 0.22, (i + s) % 2 ? "rubber" : 0xe8e8e0, s * 0.75, 0.11 + i * 0.22, 0));
        return g;
    } },
    cone: { label: "Cone", icon: "▲", role: "decor", make: () => {
        const g = new THREE.Group();
        const c = cone(0.2, 0.7, 12, 0xf26b1d);
        c.position.y = 0.35;
        g.add(c);
        g.add(box(0.45, 0.03, 0.45, "rubber", 0, 0.015, 0));
        return g;
    } },
    tree: { label: "Tree", icon: "♣", role: "scenery", make: () => {
        const g = new THREE.Group();
        g.add(cylinder(0.18, 2.2, "bark", 0, 1.1, 0));
        for (let i = 0; i < 3; i++) {
            const c = cone(1.8 - i * 0.4, 2.2, 10, "leaves");
            c.position.y = 2.6 + i * 1.3;
            g.add(c);
        }
        return g;
    } },
    bush: { label: "Bush", icon: "●", role: "decor", make: () => {
        const g = new THREE.Group();
        const b = new THREE.Mesh(scaleUVs(new THREE.SphereGeometry(0.9, 12, 9), 2 * Math.PI * 0.9 / 2, Math.PI * 0.9 / 2), material("leaves"));
        b.scale.set(1.2, 0.8, 1);
        b.position.y = 0.6;
        g.add(b);
        return g;
    } },
    house: { label: "House", icon: "⌂", role: "scenery", make: (t) => {
        const g = new THREE.Group();
        g.add(box(8, 3.2, 6, t || "plaster", 0, 1.6, 0));
        const roof = cone(5.6, 2.4, 4, "roof");
        roof.position.y = 4.4;
        roof.rotation.y = Math.PI / 4;
        roof.scale.set(1, 1, 0.75);
        g.add(roof);
        g.add(box(1, 2.1, 0.1, "wood", 0, 1.05, 3.05));
        return g;
    } },
    grandstand: { label: "Grandstand", icon: "▤", role: "scenery", make: (t) => {
        const g = new THREE.Group();
        for (let i = 0; i < 5; i++) g.add(box(16, 0.6, 1.4, t || "concrete", 0, 0.3 + i * 0.6, -i * 1.4));
        g.add(box(16, 0.2, 7, "metal", 0, 4.2, -2.8));
        for (const x of [-7.5, 7.5]) for (const z of [0.2, -5.8]) g.add(box(0.2, 4.2, 0.2, "metal", x, 2.1, z));
        return g;
    } },
    lamp: { label: "Lamp post", icon: "¡", role: "scenery", make: () => {
        const g = new THREE.Group();
        g.add(cylinder(0.08, 7, "metal", 0, 3.5, 0));
        g.add(box(1.2, 0.15, 0.3, "metal", 0.5, 7, 0));
        g.add(box(0.5, 0.1, 0.25, 0xfff2b0, 0.95, 6.9, 0));
        return g;
    } },
    sign: { label: "Sign board", icon: "▭", role: "decor", make: () => {
        const g = new THREE.Group();
        g.add(box(6, 1.2, 0.08, 0x2d5fbf, 0, 1.8, 0));
        g.add(box(0.1, 1.2, 0.1, "metal", -2.8, 0.6, 0));
        g.add(box(0.1, 1.2, 0.1, "metal", 2.8, 0.6, 0));
        return g;
    } }
};

function defaultDesign() {
    // an oval to start from
    const nodes = [];
    for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2;
        nodes.push({ x: Math.round(Math.cos(a) * 120), y: 0, z: Math.round(Math.sin(a) * 70), width: 12 });
    }
    return { nodes, closed: true, prefabs: [], textures: Object.assign({}, DEFAULT_TEXTURES) };
}

// ---- prefabs as a glb of their own (the objects of a track with its own model: track-editor.js puts them in the track like any model)
// the prefabs to choose from, with what the editor shows for them
export const PREFAB_TYPES = Object.keys(PREFABS).map((type) => ({ type, label: PREFABS[type].label, icon: PREFABS[type].icon, role: PREFABS[type].role, textures: TEXTURE_CHOICES[type] || null }));
export { TEXTURE_CHOICES };

// The glb of one prefab (type, and the texture it has a choice of): a binary glb as the exporter writes it. The pictures of its textures are loaded first,
// the exporter needs them. The parts keep the names of their materials, so the game finds the surfaces (see the prefab's role).
// the prefab as a group, once its pictures are loaded (for the glb, and for the picture of the editor's list)
export async function prefabReady(type, texture) {
    const def = PREFABS[type];
    if (!def) throw new Error("there is no prefab “" + type + "”");
    const group = def.make(texture);
    group.name = "prefab_" + type;
    group.updateMatrixWorld(true);
    const pictures = new Set();
    group.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { if (m.map && m.map.userData.loaded) pictures.add(m.map); }); });
    await Promise.all([...pictures].map((t) => t.userData.loaded));
    return group;
}
export async function prefabGlb(type, texture) {
    const group = await prefabReady(type, texture);
    const glb = await new GLTFExporter().parseAsync(group, { binary: true });
    return new Blob([glb], { type: "model/gltf-binary" });
}

export function createDesign(api) {
    const { scene, trackGroup, camera, renderer, controls, state, registerMesh, applyColours, renderParts, updateMarkers, status, $, roleMaterials, screenSize } = api;
    const roadGroup = new THREE.Group();     // the road, the shoulders and the ground: made again whenever a node changes
    const prefabGroup = new THREE.Group();   // the prefabs, each a group with userData.prefab
    const nodeGroup = new THREE.Group();     // the markers of the nodes (not a part of the track)
    roadGroup.name = "design-road";
    prefabGroup.name = "design-prefabs";
    scene.add(nodeGroup);
    const pickPlane = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), new THREE.MeshBasicMaterial({ visible: false }));
    pickPlane.rotation.x = -Math.PI / 2;
    scene.add(pickPlane);
    const raycaster = new THREE.Raycaster();

    const design = { data: null, selectedNode: -1, selectedPrefab: null, selectedPatch: null, selectedBranch: null, selectedPoint: -1, drawing: null, prefabType: "wall", prefabStyle: "draw", prefabAttach: false, draft: [], selectedRowPoint: -1, rebuildPending: false };
    const gizmo = new TransformControls(camera, renderer.domElement);
    gizmo.setSize(0.9);
    let dragging = false;
    gizmo.addEventListener("dragging-changed", (e) => { controls.enabled = !e.value; dragging = e.value; });
    scene.add(typeof gizmo.getHelper === "function" ? gizmo.getHelper() : gizmo);
    gizmo.enabled = false;

    function round(v) { return Math.round(v * 100) / 100; }

    // ---- the road from the nodes
    function curveOf(data) {
        const points = data.nodes.map((n) => new THREE.Vector3(n.x, n.y, n.z));
        const curve = new THREE.CatmullRomCurve3(points, data.closed, "centripetal", 0.5);
        curve.arcLengthDivisions = Math.max(200, points.length * 40);
        return curve;
    }

    // the width along the curve: between the nodes it goes smoothly from the one to the next
    function widthAt(data, curve, u) {
        const n = data.nodes.length;
        const lengths = curve.getLengths();
        const total = lengths[lengths.length - 1];
        const fractions = data.nodes.map((node, i) => {
            const t = data.closed ? i / n : i / (n - 1);
            return lengths[Math.min(lengths.length - 1, Math.round(t * (lengths.length - 1)))] / total;
        });
        for (let i = 0; i < n; i++) {
            const next = (i + 1) % n;
            let a = fractions[i], b = data.closed && next === 0 ? 1 : fractions[next];
            if (!data.closed && next === 0) return data.nodes[i].width;
            if (u >= a && u <= b) {
                const s = b > a ? (u - a) / (b - a) : 0;
                const k = s * s * (3 - 2 * s);
                return data.nodes[i].width + (data.nodes[next].width - data.nodes[i].width) * k;
            }
        }
        return data.nodes[n - 1].width;
    }

    function strip(name, left, right, tex, role, along, open) {
        // a ribbon between two rows of points, closed or not (open: a branch); the texture is tiled in metres: across by the width of the ribbon
        // there, along by the distance along the road (along[i])
        const count = left.length;
        const closed = open ? false : design.data.closed;
        const size = TEXTURES[tex].size;
        const positions = [], uvs = [], indices = [];
        for (let i = 0; i < count; i++) {
            positions.push(left[i].x, left[i].y, left[i].z, right[i].x, right[i].y, right[i].z);
            const v = along[i] / size;
            uvs.push(0, v, left[i].distanceTo(right[i]) / size, v);
        }
        const segments = closed ? count : count - 1;
        for (let i = 0; i < segments; i++) {
            const a = i * 2, b = ((i + 1) % count) * 2;
            indices.push(a, a + 1, b, a + 1, b + 1, b);            // (counter-clockwise from above: the normals point up, as the weather of the game needs, Atmosphere.js)
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, textured(tex, undefined, THREE.DoubleSide));
        mesh.name = name;
        mesh.userData.role = role;
        return mesh;
    }

    function textureOf(what) {
        const chosen = design.data.textures && design.data.textures[what];
        return TEXTURES[chosen] ? chosen : DEFAULT_TEXTURES[what];
    }

    // A row of points beside a line (the edge of the road, the outer edge of a shoulder) folds over itself on the inside of a bend that is
    // sharper than the distance to the line: the points there go backwards, and the ribbon overlapped itself (dark, turned triangles in a
    // hairpin). A point that goes backwards against the direction of the line is put on the last point that went forwards: the ribbon
    // narrows to a fan there instead of folding.
    function unfold(points, tangents, closed) {
        const n = points.length;
        if (n < 3) return points;
        // (a closed loop starts where the road is straightest: a row of points never folds there)
        let start = 0;
        if (closed) {
            let best = Infinity;
            for (let i = 0; i < n; i++) {
                const a = tangents[(i + n - 1) % n], c = tangents[(i + 1) % n], turn = 1 - (a.x * c.x + a.z * c.z);
                if (turn < best) { best = turn; start = i; }
            }
        }
        let last = points[start];
        for (let k = 1; k < n; k++) {
            const i = (start + k) % n;
            if (!closed && i < start) break;
            // (forwards along the line here and at the point before: the piece from the point before to this one must not go backwards either)
            const p = points[i], t = tangents[i], t0 = tangents[(i + n - 1) % n];
            if ((p.x - last.x) * t.x + (p.z - last.z) * t.z <= 0.01 || (p.x - last.x) * t0.x + (p.z - last.z) * t0.z <= 0.01) points[i] = last.clone();
            else last = p;
        }
        return points;
    }

    let lastTerrain = null;
    function rebuild(withTerrain) {
        if (withTerrain === undefined) withTerrain = !dragging;
        design.rebuildPending = false;
        const data = design.data;
        // the old parts go out of the list
        roadGroup.children.slice().forEach((m) => { roadGroup.remove(m); state.parts.delete(m.name); });
        if (withTerrain) lastTerrain = null;
        if (!data || data.nodes.length < 2) { renderNodes(); renderParts(); return; }
        const curve = curveOf(data);
        const length = curve.getLength();
        const samples = Math.max(24, Math.min(2000, Math.round(length / 2)));
        const left = [], right = [], shoulderL = [], shoulderR = [];
        const count = data.closed ? samples : samples + 1;
        let minY = Infinity;
        const bounds = new THREE.Box2();
        const centreLine = []; // { x, z, y, reach }: the road and its shoulders, for the terrain
        const along = [];      // the distance along the road at every sample, for the textures
        const tangents = [];
        design.mainLine = [];  // the middle of the road, for the branches that join it
        for (let i = 0; i < count; i++) {
            const u = data.closed ? i / samples : i / samples;
            along.push(Math.min(1, u) * length);
            const p = curve.getPointAt(Math.min(1, u));
            const tangent = curve.getTangentAt(Math.min(1, u)).setY(0).normalize();
            const side = new THREE.Vector3().crossVectors(UP, tangent).normalize();
            const w = widthAt(data, curve, Math.min(1, u)) / 2;
            tangents.push(tangent);
            design.mainLine.push({ x: p.x, y: p.y, z: p.z, w, u: Math.min(1, u) });
            left.push(p.clone().addScaledVector(side, w));
            right.push(p.clone().addScaledVector(side, -w));
            shoulderL.push(p.clone().addScaledVector(side, w + 14).add(new THREE.Vector3(0, -0.3, 0)));
            shoulderR.push(p.clone().addScaledVector(side, -(w + 14)).add(new THREE.Vector3(0, -0.3, 0)));
            minY = Math.min(minY, p.y);
            bounds.expandByPoint(new THREE.Vector2(p.x, p.z));
            centreLine.push({ x: p.x, z: p.z, y: p.y, reach: w + 14 });
        }
        [left, right, shoulderL, shoulderR].forEach((row) => unfold(row, tangents, data.closed));
        design.mainCurve = curve;
        design.roadEdges = [{ pts: left, closed: !!data.closed }, { pts: right, closed: !!data.closed }];      // (for the surfaces and the curbs that connect to the road)
        design.edgeCache = null;
        // the branches before the terrain: the terrain lies under them as under the road
        const branchLines = buildBranchLines();
        branchLines.forEach((b) => b.points.forEach((q) => { centreLine.push({ x: q.x, z: q.z, y: q.y, reach: q.w + 6 }); bounds.expandByPoint(new THREE.Vector2(q.x, q.z)); minY = Math.min(minY, q.y); }));
        const road = strip("road", left, right, textureOf("road"), "road", along);
        // (the grass of the shoulder at the edge of the road lay over a branch where it leaves the road: there its inner edge is lower)
        const branchParts = makeBranchParts(branchLines);
        const innerL = left.map((q) => q.clone()), innerR = right.map((q) => q.clone());
        // (a point of the edge is tested a little out from the road: the edge itself is on the outline of the branch)
        const under = (q, outer) => { const dx = outer.x - q.x, dz = outer.z - q.z, l = Math.hypot(dx, dz) || 1, x = q.x + dx / l * 0.4, z = q.z + dz / l * 0.4; return branchParts.rings.some((r) => insideRing(r, x, z)); };
        if (branchParts.rings.length) {
            innerL.forEach((q, i) => { if (under(q, shoulderL[i])) q.y -= 0.15; });
            innerR.forEach((q, i) => { if (under(q, shoulderR[i])) q.y -= 0.15; });
        }
        const shoulderLeft = strip("shoulder_left", shoulderL, innerL, textureOf("shoulder"), "grass", along);
        const shoulderRight = strip("shoulder_right", innerR, shoulderR, textureOf("shoulder"), "grass", along);
        // (the road has no painted kerbs: curbs are drawn where they are wanted, with Draw curb of the editor, Curbs.js)
        // the ground: a landscape that joins the shoulders of the road and rolls gently further away (during a drag the old one stays)
        const ground = (!withTerrain && lastTerrain) ? lastTerrain : terrain(centreLine, bounds, minY);
        lastTerrain = ground;
        [road, shoulderLeft, shoulderRight, ground].forEach((m) => { roadGroup.add(m); registerMesh(m, m.userData.role); state.roles[m.name] = m.userData.role; });
        roadGroup.updateMatrixWorld(true);
        addBranchParts(branchParts);
        if (withTerrain) buildPatches();
        renderNodes();
        renderHandles();
        applyColours();
        renderParts();
        updateMarkers();
        if (withTerrain && api.onRebuild) api.onRebuild();          // (the curbs, gates and objects onto the new road; not at every step of a drag)
        if (design.data.prefabs && design.data.prefabs.some((q) => q.row && q.attach)) rebuildPrefabs();          // (the rows that are attached to the road follow it)
        $("modelInfo").textContent = "Designed track: " + data.nodes.length + " nodes, " + Math.round(length) + " m, " + data.prefabs.length + " prefabs";
    }

    // ---- the branches: roads of their own (a pit lane, a side road, the streets of a town) that start and end on the track or on another
    // branch. data.branches: [{ nodes: [{ x, z }], width, start, end }]; start and end: { road (-1 the track, else a branch), u (0 to 1 along it) }
    // or null (a free end). The first and the last node follow the road they join. The height goes evenly from the one end to the other,
    // a few centimetres under the road they join (where they lie over each other the road of the track shows).
    const branchGroup = new THREE.Group();   // the branches
    branchGroup.name = "design-branches";
    const patchGroup = new THREE.Group();    // the patches of gravel, sand ... on the ground
    patchGroup.name = "design-patches";
    const handleGroup = new THREE.Group();   // the points of the chosen patch or branch
    scene.add(handleGroup);
    design.branchLines = [];
    const BRANCH_STEP = 2;
    const BRANCH_SHOULDER = 6;      // the width of the grass beside a branch (where the terrain under it ends: reach of the branch in rebuild)
    // the place on a road at u: the track (road -1) or a branch (its line of this rebuild, or of the one before)
    function attachPoint(a, lines) {
        if (!a) return null;
        if (a.road < 0) {
            if (!design.mainCurve) return null;
            const p = design.mainCurve.getPointAt(Math.max(0, Math.min(1, a.u)));
            return { x: p.x, y: p.y, z: p.z };
        }
        const line = (lines[a.road] || design.branchLines[a.road] || {}).points;
        if (!line || line.length < 2) return null;
        const f = Math.max(0, Math.min(1, a.u)) * (line.length - 1), i = Math.min(line.length - 2, Math.floor(f)), t = f - i;
        const q = line[i], r = line[i + 1];
        return { x: q.x + (r.x - q.x) * t, y: q.y + (r.y - q.y) * t, z: q.z + (r.z - q.z) * t };
    }
    // the height of the nearest point of the track (a free end of a branch)
    function nearestRoadY(x, z) {
        let best = Infinity, y = 0;
        (design.mainLine || []).forEach((q) => { const d = (q.x - x) * (q.x - x) + (q.z - z) * (q.z - z); if (d < best) { best = d; y = q.y; } });
        return y;
    }
    function buildBranchLines() {
        const lines = [];
        (design.data.branches || []).forEach((b, k) => {
            const nodes = b.nodes;
            if (nodes.length < 2) { lines.push({ points: [], index: k }); return; }
            const a = attachPoint(b.start, lines), e = attachPoint(b.end, lines);
            if (a) { nodes[0].x = round(a.x); nodes[0].z = round(a.z); }
            if (e) { nodes[nodes.length - 1].x = round(e.x); nodes[nodes.length - 1].z = round(e.z); }
            const y0 = a ? a.y - 0.03 : nearestRoadY(nodes[0].x, nodes[0].z), y1 = e ? e.y - 0.03 : (a ? y0 : nearestRoadY(nodes[nodes.length - 1].x, nodes[nodes.length - 1].z));
            const vectors = nodes.map((n) => new THREE.Vector3(n.x, 0, n.z));
            const curve = vectors.length === 2 ? new THREE.LineCurve3(vectors[0], vectors[1]) : new THREE.CatmullRomCurve3(vectors, false, "centripetal", 0.5);
            const length = curve.getLength(), count = Math.max(2, Math.ceil(length / BRANCH_STEP));
            // the width: of the branch, or of the node (node.width), and in between from one node to the next, with every node at its share of the length
            const half = (n) => Math.max(2, n.width || b.width || 8) / 2, cum = [0];
            for (let i = 1; i < nodes.length; i++) cum.push(cum[i - 1] + Math.hypot(nodes[i].x - nodes[i - 1].x, nodes[i].z - nodes[i - 1].z));
            const total = cum[cum.length - 1] || 1, points = [];
            const widthAt = (u) => {
                const at = u * total;
                let i = 0;
                while (i < cum.length - 2 && cum[i + 1] < at) i++;
                const f = Math.max(0, Math.min(1, (at - cum[i]) / ((cum[i + 1] - cum[i]) || 1))), s = f * f * (3 - 2 * f);
                return half(nodes[i]) + (half(nodes[i + 1]) - half(nodes[i])) * s;
            };
            for (let i = 0; i <= count; i++) {
                const u = i / count, p = curve.getPointAt(u), t = curve.getTangentAt(u).setY(0).normalize();
                const s = u * u * (3 - 2 * u);
                points.push({ x: p.x, y: y0 + (y1 - y0) * s, z: p.z, w: widthAt(u), tangent: t, along: u * length });
            }
            lines.push({ points, index: k });
        });
        design.branchLines = lines;
        return lines;
    }
    // The road that a branch joins at its end: its direction and its half width at the place of the join, and the normal across it towards the branch
    function hostAt(attach, lines, a, towards) {
        const list = attach.road < 0 ? (design.mainLine || []) : ((lines[attach.road] || {}).points || []);
        if (list.length < 2) return null;
        let best = 0, bestD = Infinity;
        if (attach.road >= 0) best = Math.max(0, Math.min(list.length - 1, Math.round(attach.u * (list.length - 1))));       // (a branch that joins itself: its own end is nearer)
        else list.forEach((q, i) => { const d = (q.x - a.x) * (q.x - a.x) + (q.z - a.z) * (q.z - a.z); if (d < bestD) { bestD = d; best = i; } });
        const q0 = list[Math.max(0, best - 1)], q1 = list[Math.min(list.length - 1, best + 1)];
        const tx = q1.x - q0.x, tz = q1.z - q0.z, len = Math.hypot(tx, tz) || 1;
        const t = { x: tx / len, z: tz / len };
        let n = { x: -t.z, z: t.x };
        if ((towards.x - a.x) * n.x + (towards.z - a.z) * n.z < 0) n = { x: -n.x, z: -n.z };
        return { t, n, w: list[best].w, y: list[best].y };
    }
    // How far a branch end runs back (or on) over the road it joins: 0.9 of the half width of that road there, but no further than the corners of
    // its end stay inside the road (a branch that joined at an angle stuck out on the far side); 0 for a free end. Over the road the branch lies
    // under the road surface, so its edges cross the edge of the road at whatever angle they meet it: no mouth is worked out.
    // a: the end of the line, towards: a point further along the branch, e: +1 for the end of the line, -1 for the start (which runs back).
    function joinStep(attach, lines, a, towards, e) {
        const host = attach ? hostAt(attach, lines, a, towards) : null;
        if (!host) return 0;
        const dx = e * a.tangent.x, dz = e * a.tangent.z;          // the direction in which the end runs on, into the road
        const into = -(dx * host.n.x + dz * host.n.z);                  // how fast it goes across the road, away from the branch side
        const reach = Math.abs(a.tangent.z * host.n.x - a.tangent.x * host.n.z) * a.w;   // how far its corners are across the road from its middle
        let step = host.w * 0.9;
        if (into > 1e-3) step = Math.min(step, (host.w - 0.6 - reach) / into);
        return Math.max(0, step);
    }
    // the meshes of the branches (one strip each, its ends running on over the road they join), and the footprints of the branches that join the track:
    // the shoulders of the track are pressed down under them (see the shoulders of the track, above)
    function makeBranchParts(lines) {
        const meshes = [], rings = [], built = [];
        design.branchEdges = [];
        design.edgeCache = null;
        lines.forEach((line) => {
            if (line.points.length < 2) return;
            const b = design.data.branches[line.index], pts = line.points, last = pts.length - 1;
            const back = joinStep(b.start, lines, pts[0], pts[Math.min(4, last)], -1);
            const fore = joinStep(b.end, lines, pts[last], pts[Math.max(0, last - 4)], 1);
            const left = [], right = [], tangents = [], along = [];
            const addRow = (x, y, z, t, s, w) => {
                const c = new THREE.Vector3(x, y, z), n = new THREE.Vector3().crossVectors(UP, t).normalize();
                left.push(c.clone().addScaledVector(n, w)); right.push(c.clone().addScaledVector(n, -w));
                tangents.push(t); along.push(s);
            };
            const first = pts[0], end = pts[last];
            if (back) addRow(first.x - first.tangent.x * back, first.y, first.z - first.tangent.z * back, first.tangent, -back, first.w);
            pts.forEach((q) => addRow(q.x, q.y, q.z, q.tangent, q.along, q.w));
            if (fore) addRow(end.x + end.tangent.x * fore, end.y, end.z + end.tangent.z * fore, end.tangent, end.along + fore, end.w);
            unfold(left, tangents, false); unfold(right, tangents, false);
            const footprint = left.concat(right.slice().reverse());
            if ((b.start && b.start.road < 0) || (b.end && b.end.road < 0)) rings.push(footprint);
            const tex = textureOf("road"), name = "branch_" + (line.index + 1);
            const road = strip(name, left, right, tex, "road", along, true);
            road.userData.branchIndex = line.index;
            meshes.push(road);
            built.push({ line, b, pts, name, left, right, along, back, footprint });
        });
        // the grass beside the branch, as beside the track: from the edge of the branch down to 0.3 m under it, BRANCH_SHOULDER wide (it is not made along the
        // stretch that runs on over the road, which has no edge of its own there). Where another branch (or the branch itself) joins it, its edge is lower under
        // the one that joins, as at the track (rebuild): the road that joins lies a few centimetres under the one it joins, and the grass must not lie over it
        built.forEach(({ line, pts, name, left, right, along, back }) => {
            const off = back ? 1 : 0, count = pts.length, innerL = left.slice(off, off + count), innerR = right.slice(off, off + count);
            const outer = (sign) => pts.map((q) => new THREE.Vector3(q.x, q.y - 0.3, q.z).addScaledVector(new THREE.Vector3().crossVectors(UP, q.tangent).normalize(), sign * (q.w + BRANCH_SHOULDER)));
            const outerL = outer(1), outerR = outer(-1), tangentsOnly = pts.map((q) => q.tangent), alongOnly = along.slice(off, off + count);
            unfold(outerL, tangentsOnly, false); unfold(outerR, tangentsOnly, false);
            const joined = built.filter((o) => (o.b.start && o.b.start.road === line.index) || (o.b.end && o.b.end.road === line.index)).map((o) => o.footprint);
            if (joined.length) {
                const lower = (inner, far) => inner.forEach((q, i) => {
                    const dx = far[i].x - q.x, dz = far[i].z - q.z, l = Math.hypot(dx, dz) || 1, x = q.x + dx / l * 0.4, z = q.z + dz / l * 0.4;
                    if (joined.some((r) => insideRing(r, x, z))) q.y -= 0.15;
                });
                lower(innerL, outerL); lower(innerR, outerR);
            }
            const grass = textureOf("shoulder"), first = meshes.length;
            meshes.push(strip(name + "_shoulder_1", outerL, innerL, grass, "grass", alongOnly, true), strip(name + "_shoulder_2", innerR, outerR, grass, "grass", alongOnly, true));
            for (let k = first; k < meshes.length; k++) meshes[k].userData.branchIndex = line.index;          // (a click on any part of the branch chooses it)
            design.branchEdges.push({ pts: innerL, closed: false }, { pts: innerR, closed: false });
        });
        return { meshes, rings };
    }
    function addBranchParts(parts) {
        branchGroup.children.slice().forEach((m) => { branchGroup.remove(m); m.geometry.dispose(); state.parts.delete(m.name); });
        parts.meshes.forEach((mesh) => { branchGroup.add(mesh); registerMesh(mesh, mesh.userData.role); state.roles[mesh.name] = mesh.userData.role; });
        branchGroup.updateMatrixWorld(true);
    }
    function buildBranches(lines) { addBranchParts(makeBranchParts(lines)); }
    function insideRing(ring, x, z) {
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const a = ring[i], b = ring[j];
            if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / ((b.z - a.z) || 1e-9) + a.x) inside = !inside;
        }
        return inside;
    }

    // ---- the patches: a surface of its own (gravel, sand, grass, dirt) drawn as an area on the ground, as the gravel beside a bend.
    // data.patches: [{ surface, points: [{ x, z }], connect }]. The area is cut into triangles of at most 1.2 m that lie on the highest ground under and around
    // their corners (so it follows the terrain and the shoulders), 12 cm above it inside and coming down to 2 cm over the last metre at the edge (the game
    // takes the higher surface where two are more than 5 cm apart).
    const PATCH_SURFACES = { road: { label: "Road", texture: null, role: "road" }, gravel: { label: "Gravel", texture: "gravel", role: "gravel" }, sand: { label: "Sand", texture: "sand", role: "sand" },
        grass: { label: "Grass", texture: "grass", role: "grass" }, dirt: { label: "Dirt", texture: "dirt", role: "ground" } };
    // the surfaces of the track itself: data.surfaces [{ id, label, kind: "colour" | "texture", colour: "#rrggbb", texture, size (m a tile covers), grip: the role of the game }],
    // chosen by a patch as "c:" + id
    const GRIP_CHOICES = [["road", "Road"], ["grass", "Grass"], ["ground", "Dirt"], ["sand", "Sand"], ["gravel", "Gravel"], ["mud", "Mud"]];
    design.patchSurface = "gravel";
    design.patchConnect = false;
    function surfaceOf(key) {
        if (typeof key === "string" && key.startsWith("c:")) {
            const c = ((design.data && design.data.surfaces) || []).find((q) => "c:" + q.id === key);
            if (c) return { label: c.label, texture: c.kind === "texture" && TEXTURES[c.texture] ? c.texture : null, colour: c.kind === "texture" ? null : (c.colour || "#8a7a5a"), size: c.size, role: GRIP_CHOICES.some(([k]) => k === c.grip) ? c.grip : "ground" };
        }
        const built = PATCH_SURFACES[key] || PATCH_SURFACES.gravel;
        return key === "road" ? Object.assign({}, built, { texture: textureOf("road") }) : built;
    }
    function surfaceMaterial(surface) {
        if (surface.texture) return textured(surface.texture);
        const key = "colour:" + surface.colour;
        if (!materialCache.has(key)) { const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(surface.colour), roughness: 0.9, metalness: 0 }); m.name = "colour-" + surface.colour.replace("#", ""); materialCache.set(key, m); }
        return materialCache.get(key);
    }
    // ---- the edges that a surface or a curb connects to. The edges of the roads (the track, the branches) and of the curbs of the editor (api.curbs()),
    // as lines of points, and which points of them can be seen from outside: a point that lies on another road or curb is no edge any more (a branch cut
    // the edge of the track, a curb lies over it). Kept until the road or a curb changes (design.edgeCache = null).
    const BRIDGE = 1.6;       // metres: the edges of two curbs, or of a curb and a road, that are this close are joined
    function boxOf(points) {
        const box = [Infinity, Infinity, -Infinity, -Infinity];
        points.forEach((q) => { box[0] = Math.min(box[0], q.x); box[1] = Math.min(box[1], q.z); box[2] = Math.max(box[2], q.x); box[3] = Math.max(box[3], q.z); });
        return box;
    }
    function edgeSets() {
        if (design.edgeCache) return design.edgeCache;
        const edges = [], prints = [];
        const re = design.roadEdges || [];
        if (re.length === 2) {
            const [l, r] = re;
            edges.push({ owner: "main", pts: l.pts, closed: l.closed, other: r.pts, road: true }, { owner: "main", pts: r.pts, closed: r.closed, other: l.pts, road: true });
            if (l.closed) prints.push({ owner: "main", road: true, box: boxOf(l.pts), test: (x, z) => insideRing(l.pts, x, z) !== insideRing(r.pts, x, z) });
            else { const ring = l.pts.concat(r.pts.slice().reverse()); prints.push({ owner: "main", road: true, box: boxOf(ring), test: (x, z) => insideRing(ring, x, z) }); }
        }
        const be = design.branchEdges || [];
        for (let i = 0; i + 1 < be.length; i += 2) {
            const owner = "b" + i / 2, a = be[i].pts, b = be[i + 1].pts, ring = a.concat(b.slice().reverse());
            edges.push({ owner, pts: a, closed: false, other: b, road: true }, { owner, pts: b, closed: false, other: a, road: true });
            prints.push({ owner, road: true, box: boxOf(ring), test: (x, z) => insideRing(ring, x, z) });
        }
        // the curbs: the strip from its points, as Curbs.js makes it (half the width times the size at a point, to either side)
        (api.curbs ? api.curbs() : []).forEach((c, i) => {
            const pts = (c.points || []).filter((q) => Array.isArray(q) && Number.isFinite(q[0]) && Number.isFinite(q[1]));
            if (pts.length < 2) return;
            const half = (c.width > 0 ? c.width : 1.2) / 2, L = [], R = [];
            pts.forEach((q, k) => {
                const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)], tx = b[0] - a[0], tz = b[1] - a[1], len = Math.hypot(tx, tz) || 1;
                const w = half * Math.max(0.05, Number.isFinite(q[5]) ? q[5] : 1), sx = tz / len * w, sz = -tx / len * w;
                L.push({ x: q[0] + sx, z: q[1] + sz }); R.push({ x: q[0] - sx, z: q[1] - sz });
            });
            const owner = "c" + i, ring = L.concat(R.slice().reverse());
            edges.push({ owner, pts: L, closed: false }, { owner, pts: R, closed: false });
            prints.push({ owner, road: false, box: boxOf(ring), test: (x, z) => insideRing(ring, x, z) });
        });
        const covered = (e, q, roadOnly) => prints.some((f) => f.owner !== e.owner && (!roadOnly || f.road) && q.x >= f.box[0] && q.x <= f.box[2] && q.z >= f.box[1] && q.z <= f.box[3] && f.test(q.x, q.z));
        edges.forEach((e) => { e.valid = e.pts.map((q) => !covered(e, q, false)); e.roadValid = e.road ? e.pts.map((q) => !covered(e, q, true)) : null; });
        design.edgeCache = { edges, prints, graph: null };
        return design.edgeCache;
    }
    // the visible edges as a graph (the points along an edge, and bridges to the points of other edges that are close), to find the way along the edge
    function edgeGraph() {
        const cache = edgeSets();
        if (cache.graph) return cache.graph;
        const nodes = [], index = new Map();
        cache.edges.forEach((e, k) => e.pts.forEach((q, i) => { if (e.valid[i]) { index.set(k + ":" + i, nodes.length); nodes.push({ x: q.x, z: q.z, k, adj: [] }); } }));
        const link = (a, b, factor) => { const d = Math.hypot(a.x - b.x, a.z - b.z) * factor; a.adj.push([b, d]); b.adj.push([a, d]); };
        // (along an edge from a point to the next one that can be seen; over a run of at most 8 covered points too, as at the tapered end of a curb that lies
        // half on the edge of the road: the way then stays on the edge of the curb)
        cache.edges.forEach((e, k) => {
            const n = e.pts.length;
            for (let i = 0; i < n + (e.closed ? 0 : -1); i++) {
                const a = index.get(k + ":" + i);
                if (a === undefined) continue;
                for (let step = 1; step <= 9; step++) {
                    const j = i + step;
                    if (!e.closed && j >= n) break;
                    const b = index.get(k + ":" + (j % n));
                    if (b !== undefined) { if (a !== b) link(nodes[a], nodes[b], step === 1 ? 1 : 1.2); break; }
                }
            }
        });
        const grid = new Map(), key = (x, z) => Math.floor(x / BRIDGE) + ":" + Math.floor(z / BRIDGE);
        nodes.forEach((nd) => { const k = key(nd.x, nd.z); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(nd); });
        nodes.forEach((nd) => {
            for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
                (grid.get(Math.floor(nd.x / BRIDGE) + dx + ":" + (Math.floor(nd.z / BRIDGE) + dz)) || []).forEach((o) => {
                    if (o.k > nd.k && Math.hypot(o.x - nd.x, o.z - nd.z) < BRIDGE) link(nd, o, 1.5);
                });
            }
        });
        cache.graph = { nodes };
        return cache.graph;
    }
    function shortestPath(from, to) {
        const dist = new Map([[from, 0]]), prev = new Map(), heap = [[0, from]], done = new Set();
        const push = (item) => { heap.push(item); let i = heap.length - 1; while (i > 0) { const up = (i - 1) >> 1; if (heap[up][0] <= heap[i][0]) break; [heap[up], heap[i]] = [heap[i], heap[up]]; i = up; } };
        const pop = () => {
            const top = heap[0], last = heap.pop();
            if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } }
            return top;
        };
        while (heap.length) {
            const [d, node] = pop();
            if (done.has(node)) continue;
            done.add(node);
            if (node === to) break;
            node.adj.forEach(([next, w]) => { const nd = d + w; if (!dist.has(next) || nd < dist.get(next)) { dist.set(next, nd); prev.set(next, node); push([nd, next]); } });
        }
        if (!done.has(to)) return null;
        const path = [];
        for (let n = to; n; n = prev.get(n)) path.push(n);
        return path.reverse();
    }
    // is a point well inside a road or a curb (also 10 cm to every side of it)? A surface that connects to the road lies under it there, not on it: where
    // the line of its edge cuts a corner, the bit that lies over the road or the curb is hidden, and the edge is the edge of the road
    function roadMask() {
        const prints = edgeSets().prints, d = 0.1;
        return (x, z) => prints.some((f) => x >= f.box[0] && x <= f.box[2] && z >= f.box[1] && z <= f.box[3]
            && f.test(x, z) && f.test(x + d, z) && f.test(x - d, z) && f.test(x, z + d) && f.test(x, z - d));
    }
    // the way along the visible edge of the roads and curbs from the nearest edge point of b to that of a (none when there is no way within 60 m)
    function edgePath(a, b) {
        const nodes = edgeGraph().nodes;
        const nearest = (pt) => { let best = null, bestD = 60 * 60; nodes.forEach((nd) => { const d = (nd.x - pt[0]) * (nd.x - pt[0]) + (nd.z - pt[1]) * (nd.z - pt[1]); if (d < bestD) { bestD = d; best = nd; } }); return best; };
        const na = nearest(a), nb = nearest(b);
        if (!na || !nb) return [];
        const path = na === nb ? [na] : shortestPath(nb, na);
        return path ? path.map((n) => [n.x, n.z]) : [];
    }
    // the nearest place on the edge of the track or of a branch (not of a curb): { x, z, nx, nz (the unit vector away from the road), d }, or null
    function roadEdgeAt(x, z) {
        let best = null;
        edgeSets().edges.forEach((e) => {
            if (!e.road) return;
            const n = e.pts.length, count = e.closed ? n : n - 1;
            for (let i = 0; i < count; i++) {
                const j = (i + 1) % n;
                if (!e.roadValid[i] || !e.roadValid[j]) continue;
                const a = e.pts[i], b = e.pts[j], dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1e-9)));
                const px = a.x + dx * t, pz = a.z + dz * t, d = Math.hypot(x - px, z - pz);
                if (best && d >= best.d) continue;
                const oa = e.other[i], ob = e.other[j], nx = (a.x - oa.x) * (1 - t) + (b.x - ob.x) * t, nz = (a.z - oa.z) * (1 - t) + (b.z - ob.z) * t, l = Math.hypot(nx, nz) || 1;
                best = { d, x: px, z: pz, nx: nx / l, nz: nz / l };
            }
        });
        return best;
    }
    // the outline of an area: its corners, and for one that connects to the road the way back along the edge of the road from the last corner to the first
    // (gives { poly, path }: the outline, and the part of it that runs along the road)
    function patchOutline(p) {
        const pts = p.points.map((q) => [q.x, q.z]), path = p.connect && pts.length >= 2 ? edgePath(pts[0], pts[pts.length - 1]) : [];
        return { poly: pts.concat(path), path };
    }
    function edgeDistance(poly, x, z) {
        let best = Infinity;
        for (let i = 0; i < poly.length; i++) {
            const a = poly[i], b = poly[(i + 1) % poly.length], dx = b[0] - a[0], dz = b[1] - a[1], len2 = dx * dx + dz * dz || 1;
            const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / len2));
            best = Math.min(best, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t));
        }
        return best;
    }
    function patchMesh(p, index) {
        if (!p.points || p.points.length < (p.connect ? 2 : 3)) return null;
        const surface = surfaceOf(p.surface), size = surface.size || (surface.texture ? TEXTURES[surface.texture].size : 4);
        const { poly, path } = patchOutline(p), deep = p.connect ? roadMask() : null;
        if (poly.length < 3) return null;
        const ground = api.groundY || ((x, z) => surfaceHeight(x, z, null));
        // (the ground at a point and around it, the highest: a ridge of the terrain or of a shoulder between two points of the area stuck through it)
        const positions = [], uvs = [], heights = new Map(), r = 0.5;
        const highest = (x, z) => Math.max(ground(x, z), ground(x + r, z), ground(x - r, z), ground(x, z + r), ground(x, z - r));
        // beside a road the area starts at the height of the road and comes down to the ground over CONNECT_BLEND metres (at the inside of a sharp bend the
        // ground falls away from the edge of the road: the area would lie in a ditch)
        const CONNECT_BLEND = 3, edgeHeights = path.map(([x, z]) => highest(x, z));
        const height = (x, z) => {
            const key = x.toFixed(3) + "," + z.toFixed(3);
            if (!heights.has(key)) {
                let y = highest(x, z);
                if (path.length) {
                    let near = Infinity, at = 0;
                    path.forEach((q, i) => { const d = Math.hypot(q[0] - x, q[1] - z); if (d < near) { near = d; at = i; } });
                    const t = Math.min(1, near / CONNECT_BLEND);
                    if (edgeHeights[at] > y) y += (edgeHeights[at] - y) * (1 - t * t * (3 - 2 * t));
                }
                heights.set(key, deep && deep(x, z) ? ground(x, z) - 0.1 : y + 0.02 + 0.10 * Math.min(1, edgeDistance(poly, x, z)));
            }
            return heights.get(key);
        };
        // the outline is cut into triangles as it is (the area can be concave, with a way along the edge of a road), and these are halved along their longest side
        // until no side is longer than 1.2 m: the corners are where the outline is, and in between the area follows the ground
        const contour = poly.filter((q, i) => { const o = poly[(i + poly.length - 1) % poly.length]; return Math.hypot(q[0] - o[0], q[1] - o[1]) > 1e-4; });
        if (contour.length < 3) return null;
        const stack = THREE.ShapeUtils.triangulateShape(contour.map(([x, z]) => new THREE.Vector2(x, z)), []).map((tri) => tri.map((k) => contour[k]));
        const longest = 1.2;
        while (stack.length) {
            const [a, b, c] = stack.pop();
            const sides = [[a, b, c], [b, c, a], [c, a, b]].map(([u, w, o]) => [Math.hypot(w[0] - u[0], w[1] - u[1]), u, w, o]);
            const [length, u, w, o] = sides.reduce((m, q) => (q[0] > m[0] ? q : m));
            if (length > longest) {
                const mid = [(u[0] + w[0]) / 2, (u[1] + w[1]) / 2];
                stack.push([u, mid, o], [mid, w, o]);
                continue;
            }
            if (deep && deep(a[0], a[1]) && deep(b[0], b[1]) && deep(c[0], c[1])) continue;          // (wholly under a road or a curb: not made)
            // (counter-clockwise seen from above: the normal up)
            const order = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) < 0 ? [a, b, c] : [a, c, b];
            order.forEach(([x, z]) => { positions.push(x, height(x, z), z); uvs.push(x / size, z / size); });
        }
        if (!positions.length) return null;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, surfaceMaterial(surface));
        mesh.name = "patch_" + (p.surface || "gravel").replace(/[^\w-]/g, "_") + "_" + (index + 1);
        mesh.userData.role = surface.role;
        mesh.userData.overlay = true;          // (the editor does not stand things on it: track-editor.js, groundY)
        mesh.userData.patchIndex = index;
        return mesh;
    }
    function buildPatches() {
        patchGroup.children.slice().forEach((m) => { patchGroup.remove(m); m.geometry.dispose(); state.parts.delete(m.name); });
        (design.data.patches || []).forEach((p, i) => {
            const mesh = patchMesh(p, i);
            if (!mesh) return;
            patchGroup.add(mesh);
            registerMesh(mesh, mesh.userData.role);
            state.roles[mesh.name] = mesh.userData.role;
        });
        patchGroup.updateMatrixWorld(true);
        applyColours();
        renderParts();
        if (api.renderLayers) api.renderLayers();
    }
    // one patch made again (while its points are dragged)
    function refreshPatch(i) {
        const old = patchGroup.children.find((m) => m.userData.patchIndex === i);
        if (old) { patchGroup.remove(old); old.geometry.dispose(); }
        const mesh = patchMesh(design.data.patches[i], i);
        if (!mesh) return;
        if ($("colour").checked) { mesh.userData.original = mesh.material; mesh.material = roleMaterials[mesh.userData.role] || mesh.material; }
        else mesh.userData.original = mesh.material;
        state.roles[mesh.name] = mesh.userData.role;
        patchGroup.add(mesh);
        patchGroup.updateMatrixWorld(true);
    }

    // the points of the chosen patch (yellow) or branch (blue, an end that joins a road green), and the outline of a patch that is drawn
    function renderHandles() {
        handleGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
        handleGroup.clear();
        if (!design.data) return;
        const scale = Math.max(1, state.markerScale || 1) * 0.7;
        const ball = (x, y, z, colour, kind, i, chosen) => {
            const m = new THREE.Mesh(new THREE.SphereGeometry(scale, 12, 8), new THREE.MeshBasicMaterial({ color: chosen ? 0xff8a3d : colour, depthTest: false, transparent: true }));
            m.position.set(x, y + 0.4, z);
            m.renderOrder = 1000;
            m.userData.handle = { kind, i };
            if (screenSize) screenSize(m, chosen ? 9 : 7, scale);
            handleGroup.add(m);
        };
        const line = (points, colour, closed) => {
            if (points.length < 2) return;
            const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.concat(closed ? [points[0]] : [])), new THREE.LineBasicMaterial({ color: colour, depthTest: false, transparent: true }));
            l.renderOrder = 999;
            handleGroup.add(l);
        };
        const p = design.selectedPatch !== null ? design.data.patches[design.selectedPatch] : null;
        if (p) {
            const ys = p.points.map((q) => surfaceHeight(q.x, q.z, null));
            p.points.forEach((q, i) => ball(q.x, ys[i], q.z, 0xffd04d, "patch", i, i === design.selectedPoint));
            line(p.points.map((q, i) => new THREE.Vector3(q.x, ys[i] + 0.3, q.z)), 0xffd04d, !p.connect && !(design.drawing && design.drawing.kind === "patch"));
        }
        const b = design.selectedBranch !== null ? design.data.branches[design.selectedBranch] : null;
        if (b) {
            const line3 = (design.branchLines[design.selectedBranch] || {}).points || [];
            const yAt = (k) => line3.length ? line3[k === 0 ? 0 : line3.length - 1].y : nearestRoadY(b.nodes[k].x, b.nodes[k].z);
            b.nodes.forEach((n, i) => {
                const end = i === 0 ? b.start : (i === b.nodes.length - 1 ? b.end : null);
                const y = i === 0 || i === b.nodes.length - 1 ? yAt(i) : surfaceHeight(n.x, n.z, null);
                ball(n.x, y, n.z, end ? 0x4ed88a : 0x4db8ff, "branch", i, i === design.selectedPoint);
            });
            line(line3.map((q) => new THREE.Vector3(q.x, q.y + 0.3, q.z)), 0x4db8ff, false);
            if (design.drawing && design.drawing.kind === "branch" && b.nodes.length === 1) line([], 0, false);
        }
    }

    // The terrain: a grid of heights. Under the road and its shoulders it lies a little below the lowest road nearby (a road that
    // crosses over another one becomes a bridge), further away it follows the heights of the road around it (the nearer, the more),
    // with some gentle hills of its own that start where the shoulders end.
    function terrain(centreLine, bounds, minY) {
        const margin = 220;
        const minX = bounds.min.x - margin, maxX = bounds.max.x + margin, minZ = bounds.min.y - margin, maxZ = bounds.max.y + margin;
        const span = Math.max(maxX - minX, maxZ - minZ);
        const cell = Math.min(10, Math.max(4, span / 110));
        const nx = Math.ceil((maxX - minX) / cell) + 1, nz = Math.ceil((maxZ - minZ) / cell) + 1;
        // the road samples in buckets, to find the ones nearby quickly
        const bucket = 40;
        const buckets = new Map();
        const key = (bx, bz) => bx + ":" + bz;
        centreLine.forEach((p) => {
            const k = key(Math.floor(p.x / bucket), Math.floor(p.z / bucket));
            if (!buckets.has(k)) buckets.set(k, []);
            buckets.get(k).push(p);
        });
        const reachMax = 80; // how far the road pulls the terrain to its height
        const cells = Math.ceil(reachMax / bucket);
        const noise = (x, z) => {
            // value noise with a few octaves: soft hills
            let v = 0, amp = 1, f = 1 / 48;
            for (let o = 0; o < 2; o++) {
                v += amp * (Math.sin(x * f * 1.7 + Math.cos(z * f * 1.3)) * Math.cos(z * f * 1.1 - Math.sin(x * f * 0.7)));
                amp *= 0.5; f *= 2.1;
            }
            return v;
        };
        const positions = new Float32Array(nx * nz * 3);
        const uvs = new Float32Array(nx * nz * 2);
        const tex = textureOf("ground");
        const texSize = TEXTURES[tex].size;
        let n = 0, nuv = 0;
        for (let j = 0; j < nz; j++) {
            for (let i = 0; i < nx; i++) {
                const x = minX + i * cell, z = minZ + j * cell;
                uvs[nuv++] = x / texSize; uvs[nuv++] = z / texSize;
                let weightSum = 0, heightSum = 0, nearest = Infinity, under = Infinity;
                const bx = Math.floor(x / bucket), bz = Math.floor(z / bucket);
                for (let dx = -cells; dx <= cells; dx++) {
                    for (let dz = -cells; dz <= cells; dz++) {
                        const list = buckets.get(key(bx + dx, bz + dz));
                        if (!list) continue;
                        for (let k = 0; k < list.length; k++) {
                            const p = list[k];
                            const d = Math.hypot(p.x - x, p.z - z);
                            const outside = d - p.reach;          // distance beyond the shoulder
                            if (outside < nearest) nearest = outside;
                            if (outside <= 0.5) under = Math.min(under, p.y);
                            if (outside < reachMax) {
                                const w = 1 / (Math.max(outside, 0) * Math.max(outside, 0) * 0.02 + 1);
                                weightSum += w; heightSum += w * p.y;
                            }
                        }
                    }
                }
                let y;
                if (under < Infinity) {
                    y = under - 0.35;                       // under the road and the shoulders: just below the lowest road here
                } else if (weightSum > 0) {
                    const t = Math.min(1, nearest / reachMax);            // 0 at the shoulder, 1 far away
                    const near = heightSum / weightSum - 0.35;
                    const far = minY - 1 + noise(x, z) * 2.5;
                    const s = t * t * (3 - 2 * t);
                    y = near * (1 - s) + far * s + noise(x, z) * 1.2 * Math.min(1, nearest / 40);
                } else {
                    y = minY - 1 + noise(x, z) * 2.5;
                }
                positions[n++] = x; positions[n++] = y; positions[n++] = z;
            }
        }
        const indices = [];
        for (let j = 0; j < nz - 1; j++) {
            for (let i = 0; i < nx - 1; i++) {
                const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
                indices.push(a, c, b, b, c, d);
            }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, textured(tex));
        mesh.name = "ground";
        mesh.userData.role = "ground";
        return mesh;
    }

    let terrainTimer = 0;
    function scheduleRebuild() {
        // the road at once (without the terrain, which is slow), the terrain when the changes stop for a moment
        if (!design.rebuildPending) {
            design.rebuildPending = true;
            requestAnimationFrame(() => rebuild(false));
        }
        clearTimeout(terrainTimer);
        terrainTimer = setTimeout(() => { if (!dragging && design.data) rebuild(true); }, 400);
    }

    // ---- undo and redo: snapshots of the design
    const history = { past: [], future: [] };
    function snapshot() { return JSON.stringify(design.data); }
    function commit() {
        if (!design.data) return;
        const s = snapshot();
        if (history.past.length && history.past[history.past.length - 1] === s) return;
        history.past.push(s);
        if (history.past.length > 100) history.past.shift();
        history.future = [];
        updateUndoButtons();
        if (api.onCommit && history.past.length > 1) api.onCommit();          // (the undo of the editor: one step of the road in its list)
    }
    function restore(s) {
        design.data = JSON.parse(s);
        design.selectedNode = -1;
        design.selectedPrefab = null;
        design.selectedPatch = null; design.selectedBranch = null; design.selectedPoint = -1; design.drawing = null;
        gizmo.detach();
        rebuild(true);
        rebuildPrefabs();
        fillNodeFields();
        fillPrefabFields();
    }
    function undo() {
        if (history.past.length < 2) return;
        history.future.push(history.past.pop());
        restore(history.past[history.past.length - 1]);
        updateUndoButtons();
    }
    function redo() {
        if (!history.future.length) return;
        const s = history.future.pop();
        history.past.push(s);
        restore(s);
        updateUndoButtons();
    }
    function updateUndoButtons() {
        $("dsUndo").disabled = history.past.length < 2;
        $("dsRedo").disabled = !history.future.length;
    }

    // ---- the node markers
    function renderNodes() {
        nodeGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });      // (made again at every change: the old ones were never freed)
        nodeGroup.clear();
        if (!design.data) return;
        const scale = Math.max(1, state.markerScale || 1);
        design.data.nodes.forEach((n, i) => {
            const mesh = new THREE.Mesh(new THREE.SphereGeometry(i === design.selectedNode ? 1.3 * scale : 0.9 * scale, 14, 10),
                new THREE.MeshBasicMaterial({ color: i === design.selectedNode ? 0xffd04d : (i === 0 ? 0x4ed88a : 0x4db8ff) }));
            mesh.position.set(n.x, n.y + 0.3, n.z);
            mesh.userData.nodeIndex = i;
            if (screenSize) screenSize(mesh, i === design.selectedNode ? 11 : 8, i === design.selectedNode ? 1.3 * scale : 0.9 * scale);          // (one size on the screen, track-editor.js)
            nodeGroup.add(mesh);
        });
        if (design.data.nodes.length >= 2) {
            const curve = curveOf(design.data);
            const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(Math.max(64, design.data.nodes.length * 16)).map((p) => p.clone().setY(p.y + 0.3))),
                new THREE.LineBasicMaterial({ color: 0x4db8ff }));
            nodeGroup.add(line);
        }
        if (design.selectedNode >= 0 && nodeGroup.children[design.selectedNode]) {
            // the gizmo of a node: only up and down (dragging the node itself moves it over the ground)
            gizmo.attach(nodeGroup.children[design.selectedNode]);
            gizmo.setMode("translate");
            gizmo.space = "world";
            gizmo.showX = gizmo.showZ = false;
            gizmo.showY = true;
            gizmo.enabled = true;
        }
    }

    function selectNode(i) {
        if (i >= 0 && api.onSelect) api.onSelect();          // (the editor lets go of what else was chosen)
        if (i >= 0) letGoExtras();
        design.selectedNode = i;
        design.selectedPrefab = null;
        gizmo.detach();
        gizmo.enabled = false;
        rowGroup.clear();
        renderNodes();
        fillNodeFields();
        fillPrefabFields();
        renderPrefabList();
    }

    // A new node goes between the two nodes it is nearest to (the segment of the loop that is closest to the click), with the height and
    // the width in between those two.
    function addNode(x, z) {
        const data = design.data;
        const nodes = data.nodes;
        let node, at;
        if (nodes.length < 2) {
            node = { x: round(x), y: 0, z: round(z), width: parseFloat($("dsWidth").value) || 12 };
            at = nodes.length;
        } else {
            let best = Infinity, bestI = nodes.length - 1, bestT = 0;
            const segments = data.closed ? nodes.length : nodes.length - 1;
            for (let i = 0; i < segments; i++) {
                const a = nodes[i], b = nodes[(i + 1) % nodes.length];
                const dx = b.x - a.x, dz = b.z - a.z;
                const len2 = dx * dx + dz * dz || 1;
                const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2));
                const d = Math.hypot(a.x + dx * t - x, a.z + dz * t - z);
                if (d < best) { best = d; bestI = i; bestT = t; }
            }
            const a = nodes[bestI], b = nodes[(bestI + 1) % nodes.length];
            node = { x: round(x), y: round(a.y + (b.y - a.y) * bestT), z: round(z), width: round(a.width + (b.width - a.width) * bestT) };
            at = bestI + 1;
        }
        nodes.splice(at, 0, node);
        design.selectedNode = at;
        rebuild();
        selectNode(at);
        commit();
    }

    function deleteNode() {
        if (design.selectedNode < 0 || design.data.nodes.length <= 3) return;
        design.data.nodes.splice(design.selectedNode, 1);
        design.selectedNode = Math.min(design.selectedNode, design.data.nodes.length - 1);
        rebuild();
        selectNode(design.selectedNode);
        commit();
    }

    function fillNodeFields() {
        const n = design.selectedNode >= 0 ? design.data.nodes[design.selectedNode] : null;
        $("dsNodeBox").style.display = n ? "" : "none";
        $("dsNodeInfo").textContent = n ? "Node " + (design.selectedNode + 1) + " of " + design.data.nodes.length
            : (design.selectedPrefab !== null ? "Prefab selected" : "");
        if (n) { $("dsHeight").value = n.y; $("dsNodeWidth").value = n.width; }
    }

    // ---- the prefabs: single ones, and rows (a prefab repeated along a line drawn on the ground)
    const SPACING = { wall: 4, barrier: 4, tyres: 0.8, tyrewall: 2.3, cone: 3, tree: 8, bush: 3, house: 12, grandstand: 17, lamp: 20, sign: 8 };
    const rowGroup = new THREE.Group();      // the markers of the points of a selected row
    scene.add(rowGroup);

    // the ground (the road, the terrain or another prefab) under a point: its height and the direction it faces
    function surfaceAt(x, z, exclude) {
        raycaster.set(new THREE.Vector3(x, 1000, z), new THREE.Vector3(0, -1, 0));
        const targets = roadGroup.children.concat(branchGroup.children, patchGroup.children, prefabGroup.children.filter((g) => g !== exclude));
        const hits = raycaster.intersectObjects(targets, true);
        if (!hits.length) return { y: 0, normal: UP.clone() };
        const hit = hits[0];
        const normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize() : UP.clone();
        if (normal.y < 0) normal.negate();
        return { y: hit.point.y, normal };
    }
    function surfaceHeight(x, z, exclude) { return surfaceAt(x, z, exclude).y; }

    // a prefab stands on the surface: its up is the normal of the ground, and it is turned by its rotation around that
    function orient(object, normal, yaw) {
        const tilt = new THREE.Quaternion().setFromUnitVectors(UP, normal || UP);
        object.quaternion.copy(tilt).multiply(new THREE.Quaternion().setFromAxisAngle(UP, yaw || 0));
        object.userData.tilt = tilt;
    }
    function yawOf(object) {
        const tilt = object.userData.tilt || new THREE.Quaternion();
        const q = tilt.clone().invert().multiply(object.quaternion);
        return new THREE.Euler().setFromQuaternion(q, "YXZ").y;
    }

    function instance(def, p, x, y, z, rotation, scale, name, normal) {
        const g = def.make(TEXTURES[p.texture] ? p.texture : undefined);
        g.position.set(x, y, z);
        orient(g, normal, rotation);
        g.scale.setScalar(scale || 1);
        g.traverse((m) => { if (m.isMesh) { m.name = name; m.userData.role = def.role; } });
        return g;
    }

    function rowCurve(p) {
        const pts = p.points.map((q) => new THREE.Vector3(q.x, q.y || 0, q.z));
        if (pts.length === 1) return null;
        return new THREE.CatmullRomCurve3(pts, false, "centripetal", 0.5);
    }

    function makePrefab(p, index, exclude) {
        const def = PREFABS[p.type] || PREFABS.wall;
        const name = "prefab_" + p.type + "_" + (index + 1);
        const g = new THREE.Group();
        g.name = name;
        g.userData.prefab = p;
        if (p.row) {
            // the copies along the line are merged into one mesh per material, so a long row stays light (also in the glb)
            const curve = rowCurve(p);
            const spacing = Math.max(0.3, p.spacing || SPACING[p.type] || 4);
            const copies = [];
            if (curve) {
                const length = curve.getLength();
                const count = Math.max(1, Math.min(400, Math.floor(length / spacing) + 1));
                for (let k = 0; k < count; k++) {
                    const u = count > 1 ? (k * spacing) / length : 0;
                    const pos = curve.getPointAt(Math.min(1, u));
                    const t = curve.getTangentAt(Math.min(1, u));
                    const ground = surfaceAt(pos.x, pos.z, exclude);   // every copy stands on the ground under it
                    copies.push(instance(def, p, pos.x, ground.y, pos.z, Math.atan2(-t.z, t.x), p.scale, name, ground.normal));
                }
            } else {
                const ground = surfaceAt(p.points[0].x, p.points[0].z, exclude);
                copies.push(instance(def, p, p.points[0].x, ground.y, p.points[0].z, 0, p.scale, name, ground.normal));
            }
            const byColour = new Map();
            copies.forEach((c) => {
                c.updateMatrixWorld(true);
                c.traverse((m) => {
                    if (!m.isMesh) return;
                    const key = m.material.uuid; // the textured materials are shared, a colour is one per mesh
                    const colourKey = m.material.map ? key : "c" + m.material.color.getHex();
                    if (!byColour.has(colourKey)) byColour.set(colourKey, { material: m.material, geometries: [] });
                    const geometry = m.geometry.clone().applyMatrix4(m.matrixWorld);
                    byColour.get(colourKey).geometries.push(geometry);
                });
            });
            byColour.forEach((entry) => {
                const merged = mergeGeometries(entry.geometries.map((geometry) => geometry.index ? geometry.toNonIndexed() : geometry), false);
                entry.geometries.forEach((geometry) => geometry.dispose());
                const m = new THREE.Mesh(merged, entry.material);
                m.name = name;
                m.userData.role = def.role;
                m.userData.copies = copies.length;
                g.add(m);
            });
        } else {
            // a single prefab: the group itself is placed and turned, so the ring of the gizmo is around it
            const ground = surfaceAt(p.x, p.z, exclude);
            p.y = round(ground.y);
            g.position.set(p.x, p.y, p.z);
            orient(g, ground.normal, p.rotation);
            g.scale.setScalar(p.scale || 1);
            const body = def.make(TEXTURES[p.texture] ? p.texture : undefined);
            body.traverse((m) => { if (m.isMesh) { m.name = name; m.userData.role = def.role; } });
            g.add(body);
        }
        return g;
    }

    // the points of a row lie on the ground
    function snapRow(p, exclude) {
        p.points.forEach((q) => { q.y = round(surfaceHeight(q.x, q.z, exclude)); });
    }

    // Attach to road: the nodes of a row lie on the edge of the road (the track or a branch), each a distance off it (node.offset, else the offset of the row:
    // row.offset; in metres, away from the road when it is more than 0), and they follow the road when it changes
    function attachRow(p, exclude) {
        if (!p.row || !p.attach) return;
        p.points.forEach((q) => {
            const e = roadEdgeAt(q.x, q.z);
            if (!e) return;
            const off = q.offset !== undefined ? q.offset : (p.offset || 0);
            q.x = round(e.x + e.nx * off); q.z = round(e.z + e.nz * off);
        });
        snapRow(p, exclude || null);
    }
    // a node that is put on the road is where it is: its offset is its distance from the edge now
    function startNodeOffset(q) {
        const e = roadEdgeAt(q.x, q.z);
        if (e) q.offset = Math.max(-6, Math.min(6, round((q.x - e.x) * e.nx + (q.z - e.z) * e.nz)));
    }
    function rebuildPrefabs() {
        prefabGroup.children.slice().forEach((g) => { prefabGroup.remove(g); state.parts.delete(g.name); });
        if (!design.data) return;
        design.data.prefabs.forEach((p) => attachRow(p, null));
        design.data.prefabs.forEach((p, i) => {
            const g = makePrefab(p, i, null);
            prefabGroup.add(g);
            g.traverse((m) => { if (m.isMesh) registerMesh(m, m.userData.role); });
            state.roles[g.name] = (PREFABS[p.type] || PREFABS.wall).role;
        });
        prefabGroup.updateMatrixWorld(true);
        applyColours();
        renderParts();
        renderPrefabList();
        renderRowPoints();
        if (roadGroup.children.length) $("modelInfo").textContent = $("modelInfo").textContent.replace(/\d+ prefabs/, design.data.prefabs.length + " prefabs");
    }

    // only the one prefab is made again (while it is dragged)
    function refreshPrefab(i) {
        const old = prefabGroup.children[i];
        if (!old) { rebuildPrefabs(); return; }
        prefabGroup.remove(old);
        attachRow(design.data.prefabs[i], null);
        const g = makePrefab(design.data.prefabs[i], i, null);
        prefabGroup.children.splice(i, 0, g);
        g.parent = prefabGroup;
        g.traverse((m) => { if (m.isMesh) { m.userData.original = m.material; if (!$("colour").checked) return; m.material = roleMaterials[m.userData.role] || m.material; } });
        g.updateMatrixWorld(true);
        const parts = state.parts.get(g.name) || [];
        parts.length = 0;
        g.traverse((m) => { if (m.isMesh) parts.push(m); });
        state.parts.set(g.name, parts);
        if (design.selectedPrefab === i && !design.data.prefabs[i].row) { gizmo.attach(g); }
        renderRowPoints();
    }

    function addPrefab(x, z) {
        const y = surfaceHeight(x, z, null);
        const p = { type: design.prefabType, x: round(x), y: round(y), z: round(z), rotation: 0, scale: 1 };
        design.data.prefabs.push(p);
        rebuildPrefabs();
        selectPrefab(design.data.prefabs.length - 1);
        commit();
    }

    function addRow(points) {
        const p = { type: design.prefabType, row: true, points: points.map((q) => ({ x: round(q.x), y: 0, z: round(q.z) })), spacing: SPACING[design.prefabType] || 4, scale: 1 };
        if (design.prefabAttach) { p.attach = true; p.points.forEach(startNodeOffset); }
        snapRow(p, null);
        design.data.prefabs.push(p);
        rebuildPrefabs();
        selectPrefab(design.data.prefabs.length - 1);
        commit();
    }

    // a click on the line of the chosen row (within 12 pixels): where, as the piece between two points (at) and the place on the line
    function rowLineHit(e, p) {
        const curve = rowCurve(p);
        if (!curve) return null;
        let best = null, bestD = 12;
        for (let i = 0; i <= 160; i++) {
            const t = i / 160, v = curve.getPoint(t), s = toScreen(v.x, v.y + 0.2, v.z);
            if (!s) continue;
            const dist = Math.hypot(e.clientX - s.x, e.clientY - s.y);
            if (dist < bestD) { bestD = dist; best = { t, x: v.x, z: v.z }; }
        }
        if (best) best.at = Math.min(p.points.length - 2, Math.floor(best.t * (p.points.length - 1)));
        return best;
    }
    // a node on the line of the chosen row: the line keeps its shape
    function insertRowPoint(hit) {
        const p = design.selectedPrefab !== null ? design.data.prefabs[design.selectedPrefab] : null;
        if (!p || !p.row) return;
        const node = { x: round(hit.x), y: 0, z: round(hit.z) };
        if (p.attach) startNodeOffset(node);
        p.points.splice(hit.at + 1, 0, node);
        snapRow(p, prefabGroup.children[design.selectedPrefab]);
        design.selectedRowPoint = hit.at + 1;
        rebuildPrefabs(); fillPrefabFields();
        commit();
    }
    // the chosen node of the chosen row goes; a row of two nodes goes with its last one
    function deleteRowPoint() {
        const p = design.selectedPrefab !== null ? design.data.prefabs[design.selectedPrefab] : null;
        if (!p || !p.row || design.selectedRowPoint < 0) return;
        p.points.splice(design.selectedRowPoint, 1);
        design.selectedRowPoint = -1;
        if (p.points.length < 2) { deletePrefab(); return; }
        rebuildPrefabs(); fillPrefabFields();
        commit();
    }
    // Points: the corners of a new row are clicked one by one (Enter, Done or another tool ends it; one point is one prefab)
    function addDraftPoint(x, z) {
        design.draft.push({ x: round(x), z: round(z) });
        design.drawing = { kind: "rowdraft" };
        previewStroke(design.draft);
        status && status("Row: " + design.draft.length + " points. Enter ends it.", "ok");
    }

    function selectPrefab(i) {
        design.selectedRowPoint = -1;
        if (i !== null && i >= 0 && api.onSelect) api.onSelect();
        if (i !== null && i >= 0) letGoExtras();
        design.selectedNode = -1;
        design.selectedPrefab = i;
        gizmo.detach();
        gizmo.enabled = false;
        renderNodes();
        const p = design.data.prefabs[i];
        const g = prefabGroup.children[i];
        if (g && p && !p.row) {
            // a ring to turn it; moving is by dragging the prefab itself
            gizmo.attach(g);
            gizmo.setMode("rotate");
            gizmo.space = "local";
            gizmo.showX = gizmo.showZ = false;
            gizmo.showY = true;
            gizmo.enabled = true;
        }
        fillNodeFields();
        fillPrefabFields();
        renderPrefabList();
        renderRowPoints();
    }

    function deletePrefab() {
        if (design.selectedPrefab === null) return;
        design.data.prefabs.splice(design.selectedPrefab, 1);
        design.selectedPrefab = null;
        design.selectedRowPoint = -1;
        gizmo.detach();
        rebuildPrefabs();
        fillPrefabFields();
        commit();
    }

    function duplicatePrefab() {
        const p = design.selectedPrefab !== null ? design.data.prefabs[design.selectedPrefab] : null;
        if (!p) return;
        const copy = JSON.parse(JSON.stringify(p));
        if (copy.row) copy.points.forEach((q) => { q.x += 5; q.z += 5; });
        else { copy.x += 4 * Math.cos(copy.rotation || 0); copy.z -= 4 * Math.sin(copy.rotation || 0); copy.y = surfaceHeight(copy.x, copy.z, null); }
        design.data.prefabs.push(copy);
        rebuildPrefabs();
        selectPrefab(design.data.prefabs.length - 1);
        commit();
    }

    function fillPrefabFields() {
        const p = design.selectedPrefab !== null ? design.data.prefabs[design.selectedPrefab] : null;
        $("dsPrefabBox").style.display = p ? "" : "none";
        if (!p) return;
        const def = PREFABS[p.type] || PREFABS.wall;
        const g = prefabGroup.children[design.selectedPrefab];
        $("dsPrefabName").textContent = def.label + (p.row ? " (row of " + (g && g.children[0] ? g.children[0].userData.copies : 0) + ")" : "");
        $("dsPrefabRotationBox").style.display = p.row ? "none" : "";
        $("dsPrefabSpacingBox").style.display = p.row ? "" : "none";
        $("dsRowNodeBox").style.display = p.row ? "" : "none";
        $("dsRowNodeDelete").disabled = design.selectedRowPoint < 0;
        $("dsRowAttach").checked = !!p.attach;
        $("dsRowOffsetBox").style.display = p.row && p.attach ? "" : "none";
        const node = p.row && design.selectedRowPoint >= 0 ? p.points[design.selectedRowPoint] : null;
        $("dsRowOffsetLabel").textContent = node ? "Offset at the node (m)" : "Offset of the row (m)";
        if (document.activeElement !== $("dsRowOffset")) $("dsRowOffset").value = node ? (node.offset !== undefined ? node.offset : (p.offset || 0)) : (p.offset || 0);
        $("dsPrefabRotation").value = Math.round((p.rotation || 0) * 180 / Math.PI);
        $("dsPrefabSpacing").value = p.spacing || SPACING[p.type] || 4;
        $("dsPrefabScale").value = p.scale || 1;
        // the texture, for the prefabs that have a choice
        const choices = TEXTURE_CHOICES[p.type];
        $("dsPrefabTextureBox").style.display = choices ? "" : "none";
        if (choices) fillTextureSelect($("dsPrefabTexture"), choices, TEXTURES[p.texture] ? p.texture : choices[0]);
    }

    function fillTextureSelect(select, choices, value) {
        select.innerHTML = choices.map((name) => '<option value="' + name + '">' + TEXTURES[name].label + "</option>").join("");
        select.value = value;
    }

    function fillTextureFields() {
        ["road", "shoulder", "ground"].forEach((what) => fillTextureSelect($("dsTex" + what), TEXTURE_CHOICES[what], textureOf(what)));
    }

    function renderRowPoints() {
        rowGroup.clear();
        const p = design.selectedPrefab !== null ? design.data.prefabs[design.selectedPrefab] : null;
        if (!p || !p.row) return;
        const scale = Math.max(1, state.markerScale || 1) * 0.6;
        p.points.forEach((q, i) => {
            const m = new THREE.Mesh(new THREE.SphereGeometry(scale, 12, 8), new THREE.MeshBasicMaterial({ color: i === design.selectedRowPoint ? 0xff8a3d : 0xffd04d }));
            m.position.set(q.x, (q.y || 0) + 0.2, q.z);
            m.userData.rowPoint = i;
            if (screenSize) screenSize(m, 7, scale);
            rowGroup.add(m);
        });
        const curve = rowCurve(p);
        if (curve) rowGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(64).map((v) => v.clone().setY(v.y + 0.2))), new THREE.LineBasicMaterial({ color: 0xffd04d })));
    }

    function renderPrefabList() {
        const list = $("dsPalette");
        list.innerHTML = "";
        Object.entries(PREFABS).forEach(([type, def]) => {
            const b = document.createElement("button");
            b.className = "small" + (type === design.prefabType ? " active" : "");
            b.innerHTML = "<span class='icon'>" + def.icon + "</span> " + def.label;
            b.title = "Click on the ground to put one down, or drag a line to make a row of them";
            b.onclick = () => { design.prefabType = type; renderPrefabList(); api.setMode("prefab"); };
            list.appendChild(b);
        });
    }

    // ---- pointer: dragging nodes, prefabs and row points over the ground, adding nodes, placing prefabs and drawing rows
    function pointerRay(event) {
        const rect = renderer.domElement.getBoundingClientRect();
        raycaster.setFromCamera(new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1), camera);
        return raycaster;
    }
    function groundPoint(event, exclude) {
        const ray = pointerRay(event);
        const targets = roadGroup.children.concat(branchGroup.children, patchGroup.children, prefabGroup.children.filter((g) => g !== exclude));
        const hits = ray.intersectObjects(targets, true);
        if (hits.length) return hits[0].point;
        const plane = ray.intersectObject(pickPlane);
        return plane.length ? plane[0].point : null;
    }
    // where the pointer is on a horizontal plane at a height (to drag something without it jumping with the terrain under the pointer)
    function planePoint(event, y) {
        const ray = pointerRay(event).ray;
        return ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), new THREE.Vector3());
    }
    function prefabIndexOf(object) {
        let g = object;
        while (g.parent && g.parent !== prefabGroup) g = g.parent;
        return prefabGroup.children.indexOf(g);
    }
    function under(event) {
        const ray = pointerRay(event);
        const node = ray.intersectObjects(nodeGroup.children.filter((o) => o.isMesh), false)[0];
        if (node) return { node: node.object.userData.nodeIndex };
        const point = ray.intersectObjects(rowGroup.children.filter((o) => o.isMesh), false)[0];
        if (point) return { rowPoint: point.object.userData.rowPoint };
        const prefab = ray.intersectObjects(prefabGroup.children, true)[0];
        if (prefab) return { prefab: prefabIndexOf(prefab.object) };
        return {};
    }

    let drag = null; // { kind, index, start, moved, offset, stroke }
    renderer.domElement.addEventListener("pointerdown", (e) => {
        if (!design.data || e.button !== 0 || dragging) return;
        const mode = api.getMode();
        if (mode !== "node" && mode !== "prefab" && mode !== "view" && mode !== "patch" && mode !== "branch") return;
        const hit = under(e);
        drag = { start: [e.clientX, e.clientY], moved: false, stroke: null };
        const handle = handleHit(e);
        // (a click on the line of the chosen row adds a node there)
        const selRow = design.selectedPrefab !== null ? design.data.prefabs[design.selectedPrefab] : null;
        const rowHit = selRow && selRow.row && (mode === "prefab" || mode === "view") ? rowLineHit(e, selRow) : null;
        if (handle) {
            drag.kind = "handle"; drag.handle = handle;
            const q = handle.kind === "patch" ? design.data.patches[design.selectedPatch].points[handle.i] : design.data.branches[design.selectedBranch].nodes[handle.i];
            drag.y = surfaceHeight(q.x, q.z, null);
            const pp = planePoint(e, drag.y);
            drag.offset = pp ? { x: q.x - pp.x, z: q.z - pp.z } : { x: 0, z: 0 };
            design.selectedPoint = handle.i;
            renderHandles(); fillExtraFields();
        } else if (mode === "patch" || mode === "branch") {
            drag.kind = mode;
        } else if (hit.node !== undefined && mode !== "prefab") {
            if (design.selectedNode !== hit.node) selectNode(hit.node);
            const n = design.data.nodes[hit.node];
            drag.kind = "node"; drag.index = hit.node; drag.y = n.y;
            const p = planePoint(e, n.y);
            drag.offset = p ? { x: n.x - p.x, z: n.z - p.z } : { x: 0, z: 0 };
        } else if (hit.rowPoint !== undefined) {
            const p = design.data.prefabs[design.selectedPrefab];
            const q = p.points[hit.rowPoint];
            design.selectedRowPoint = hit.rowPoint; renderRowPoints(); fillPrefabFields();
            drag.kind = "rowPoint"; drag.index = hit.rowPoint; drag.y = q.y || 0;
            const pp = planePoint(e, drag.y);
            drag.offset = pp ? { x: q.x - pp.x, z: q.z - pp.z } : { x: 0, z: 0 };
        } else if (rowHit && hit.prefab === undefined) {
            drag.kind = "rowInsert"; drag.clickInsert = rowHit;
            if (mode === "view") return;          // (the camera still turns)
        } else if (hit.prefab !== undefined && hit.prefab >= 0 && mode !== "node") {
            if (rowHit && design.data.prefabs[hit.prefab] === selRow) drag.clickInsert = rowHit;          // (a click on a prefab of the chosen row, on its line: a node; dragged: the row moves)
            if (design.selectedPrefab !== hit.prefab) selectPrefab(hit.prefab);
            const p = design.data.prefabs[hit.prefab];
            drag.kind = "prefab"; drag.index = hit.prefab;
            drag.y = p.row ? (p.points[0].y || 0) : p.y;
            const pp = planePoint(e, drag.y);
            const ox = p.row ? p.points[0].x : p.x, oz = p.row ? p.points[0].z : p.z;
            drag.offset = pp ? { x: ox - pp.x, z: oz - pp.z } : { x: 0, z: 0 };
            drag.origin = p.row ? p.points.map((q) => ({ x: q.x, z: q.z })) : null;
        } else if (mode === "prefab" && design.prefabStyle === "points") {
            drag.kind = "draft";
        } else if (mode === "prefab") {
            drag.kind = "draw"; drag.stroke = [];
            const g = groundPoint(e, null);
            if (g) drag.stroke.push({ x: g.x, z: g.z });
        } else if (mode === "node") {
            drag.kind = "add";
        } else if (mode === "view" && !(api.blockPick && api.blockPick(e)) && pointerRay(e).intersectObjects(patchGroup.children.concat(branchGroup.children), false)[0]) {
            // (in Look a click on a surface or on a branch chooses it: its tool opens on it; the camera still turns when the pointer is dragged)
            const picked = pointerRay(e).intersectObjects(patchGroup.children.concat(branchGroup.children), false)[0].object.userData;
            drag.kind = "pick"; drag.patch = picked.patchIndex; drag.branch = picked.branchIndex;
            return;
        } else {
            drag = null;
            return;
        }
        controls.enabled = false;
        renderer.domElement.setPointerCapture(e.pointerId);
    });

    renderer.domElement.addEventListener("pointermove", (e) => {
        if (!drag) {
            // the cursor says what can be dragged
            if (design.data && !dragging) {
                const mode = api.getMode();
                const hit = (mode === "node" || mode === "prefab" || mode === "view") ? under(e) : {};
                renderer.domElement.style.cursor = (hit.node !== undefined || hit.rowPoint !== undefined || (hit.prefab !== undefined && hit.prefab >= 0) || handleHit(e)) ? "grab"
                    : (mode === "node" || mode === "prefab" || mode === "patch" || mode === "branch" ? "crosshair" : "");
            }
            return;
        }
        if (Math.abs(e.clientX - drag.start[0]) + Math.abs(e.clientY - drag.start[1]) > 3) drag.moved = true;
        if (!drag.moved) return;
        renderer.domElement.style.cursor = "grabbing";
        if (drag.kind === "handle") {
            const pp = planePoint(e, drag.y);
            if (!pp) return;
            const x = round(pp.x + drag.offset.x), z = round(pp.z + drag.offset.z);
            if (drag.handle.kind === "patch") {
                const q = design.data.patches[design.selectedPatch].points[drag.handle.i];
                q.x = x; q.z = z;
                schedule(() => { refreshPatch(design.selectedPatch); renderHandles(); });
            } else {
                const b = design.data.branches[design.selectedBranch], q = b.nodes[drag.handle.i];
                q.x = x; q.z = z;
                // (an end that is dragged lets go of its road; it joins a road again where it is let go)
                if (drag.handle.i === 0) b.start = null;
                if (drag.handle.i === b.nodes.length - 1) b.end = null;
                schedule(() => { buildBranches(buildBranchLines()); renderHandles(); });
            }
        } else if (drag.kind === "node") {
            const p = planePoint(e, drag.y);
            if (!p) return;
            const n = design.data.nodes[drag.index];
            n.x = round(p.x + drag.offset.x); n.z = round(p.z + drag.offset.z);
            scheduleRebuild();
        } else if (drag.kind === "rowPoint") {
            const p = planePoint(e, drag.y);
            if (!p) return;
            const row = design.data.prefabs[design.selectedPrefab];
            const q = row.points[drag.index];
            q.x = round(p.x + drag.offset.x); q.z = round(p.z + drag.offset.z);
            q.y = round(surfaceHeight(q.x, q.z, prefabGroup.children[design.selectedPrefab]));
            refreshPrefab(design.selectedPrefab);
        } else if (drag.kind === "prefab") {
            const pp = planePoint(e, drag.y);
            if (!pp) return;
            const p = design.data.prefabs[drag.index];
            const own = prefabGroup.children[drag.index];
            if (p.row) {
                const dx = pp.x + drag.offset.x - drag.origin[0].x, dz = pp.z + drag.offset.z - drag.origin[0].z;
                p.points.forEach((q, i) => { q.x = round(drag.origin[i].x + dx); q.z = round(drag.origin[i].z + dz); });
                snapRow(p, own);
            } else {
                p.x = round(pp.x + drag.offset.x); p.z = round(pp.z + drag.offset.z); // the height follows the ground when it is built
            }
            refreshPrefab(drag.index);
        } else if (drag.kind === "draw") {
            const g = groundPoint(e, null);
            if (!g) return;
            const last = drag.stroke[drag.stroke.length - 1];
            if (!last || Math.hypot(g.x - last.x, g.z - last.z) > 1.5) {
                drag.stroke.push({ x: g.x, z: g.z });
                previewStroke(drag.stroke);
            }
        }
    });

    renderer.domElement.addEventListener("pointerup", (e) => {
        if (!drag) return;
        const d = drag;
        drag = null;
        controls.enabled = true;
        renderer.domElement.style.cursor = "";
        strokeLine.visible = false;
        if (d.clickInsert && !d.moved) { insertRowPoint(d.clickInsert); return; }
        if (d.kind === "handle") {
            // (a click on the first corner of an area that is drawn closes it)
            if (!d.moved && design.drawing && design.drawing.kind === "patch" && d.handle.kind === "patch" && d.handle.i === 0 && design.data.patches[design.drawing.index].points.length >= 3) { finishDrawing(); return; }
            if (!d.moved) return;
            if (d.handle.kind === "branch") {
                const b = design.data.branches[design.selectedBranch], i = d.handle.i;
                if (i === 0 || i === b.nodes.length - 1) {
                    const snap = snapRoad(b.nodes[i].x, b.nodes[i].z, design.selectedBranch, { index: design.selectedBranch, end: i !== 0 });
                    if (snap) { b.nodes[i].x = round(snap.x); b.nodes[i].z = round(snap.z); if (i === 0) b.start = { road: snap.road, u: snap.u }; else b.end = { road: snap.road, u: snap.u }; }
                }
                rebuild(true);
            } else buildPatches();
            renderHandles();
            commit();
        } else if (d.kind === "pick") {
            if (!d.moved && d.patch !== undefined && design.data.patches[d.patch]) { api.setMode("patch"); selectPatch(d.patch); }
            else if (!d.moved && d.branch !== undefined && design.data.branches[d.branch]) { api.setMode("branch"); selectBranch(d.branch); }
        } else if (d.kind === "patch") {
            if (!d.moved) patchClick(e);
        } else if (d.kind === "branch") {
            if (!d.moved) branchClick(e);
        } else if (d.kind === "add") {
            if (!d.moved) { const g = groundPoint(e, null); if (g) addNode(g.x, g.z); }
        } else if (d.kind === "draft") {
            if (!d.moved) { const g = groundPoint(e, null); if (g) addDraftPoint(g.x, g.z); }
            if (design.draft.length) previewStroke(design.draft);
        } else if (d.kind === "rowInsert") {
            // (a click on the line was handled above)
        } else if (d.kind === "draw") {
            if (!d.moved || strokeLength(d.stroke) < 2) { const g = groundPoint(e, null); if (g) addPrefab(g.x, g.z); }
            else addRow(simplify(d.stroke, 1.5));
        } else if (d.moved) {
            if (d.kind === "node") rebuild(true);
            commit();
        }
    });

    // ---- the clicks of Gravel and Branch, and the points of what is chosen
    let scheduled = null;
    function schedule(fn) { if (scheduled) { scheduled = fn; return; } scheduled = fn; requestAnimationFrame(() => { const f = scheduled; scheduled = null; f(); }); }
    function toScreen(x, y, z) {
        const rect = renderer.domElement.getBoundingClientRect(), v = new THREE.Vector3(x, y, z).project(camera);
        return v.z > 1 || v.z < -1 ? null : { x: rect.left + (v.x * 0.5 + 0.5) * rect.width, y: rect.top + (-v.y * 0.5 + 0.5) * rect.height };
    }
    function handleHit(e) {
        const hit = pointerRay(e).intersectObjects(handleGroup.children.filter((o) => o.isMesh), false)[0];
        return hit ? hit.object.userData.handle : null;
    }
    // the piece of a row of points (closed: also from the last to the first) nearest to the pointer, within 12 pixels: its first index
    function nearPiece(e, points, closed, yOf) {
        let best = -1, bestD = 12;
        const last = closed ? points.length : points.length - 1;
        for (let i = 0; i < last; i++) {
            const a = points[i], b = points[(i + 1) % points.length];
            const sa = toScreen(a.x, yOf(a), a.z), sb = toScreen(b.x, yOf(b), b.z);
            if (!sa || !sb) continue;
            const dx = sb.x - sa.x, dy = sb.y - sa.y, len2 = dx * dx + dy * dy || 1;
            const t = Math.max(0, Math.min(1, ((e.clientX - sa.x) * dx + (e.clientY - sa.y) * dy) / len2));
            const d = Math.hypot(e.clientX - sa.x - dx * t, e.clientY - sa.y - dy * t);
            if (d < bestD) { bestD = d; best = i; }
        }
        return best;
    }
    function letGoExtras() {
        if (design.drawing) finishDrawing();
        if (design.selectedPatch === null && design.selectedBranch === null) return;
        design.selectedPatch = null; design.selectedBranch = null; design.selectedPoint = -1;
        renderHandles(); fillExtraFields();
    }
    function selectPatch(i, point) {
        if (api.onSelect) api.onSelect();
        design.selectedNode = -1; design.selectedPrefab = null; gizmo.detach(); gizmo.enabled = false; rowGroup.clear(); renderNodes();
        design.selectedBranch = null; design.selectedPatch = i; design.selectedPoint = point === undefined ? -1 : point;
        const p = design.data.patches[i];
        if (p) { design.patchSurface = p.surface || "gravel"; design.patchConnect = !!p.connect; }
        renderHandles(); fillExtraFields(); fillNodeFields(); fillPrefabFields();
    }
    function selectBranch(i, point) {
        if (api.onSelect) api.onSelect();
        design.selectedNode = -1; design.selectedPrefab = null; gizmo.detach(); gizmo.enabled = false; rowGroup.clear(); renderNodes();
        design.selectedPatch = null; design.selectedBranch = i; design.selectedPoint = point === undefined ? -1 : point;
        const b = design.data.branches[i];
        if (b) $("dsBranchWidth").value = b.width || 8;
        renderHandles(); fillExtraFields(); fillNodeFields(); fillPrefabFields();
    }
    // Surfaces: a click starts an area, the next clicks are its corners, a click on the first corner (or Enter) closes it. A chosen area: a click
    // on its edge adds a corner there, its corners are dragged.
    function patchClick(e) {
        const g = groundPoint(e, null);
        const yOf = (q) => surfaceHeight(q.x, q.z, null);
        const dr = design.drawing;
        if (dr && dr.kind === "patch") {
            const p = design.data.patches[dr.index], first = p.points[0], s = first && toScreen(first.x, yOf(first), first.z);
            if (p.points.length >= 3 && s && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 14) { finishDrawing(); return; }
            if (!g) return;
            p.points.push({ x: round(g.x), z: round(g.z) });
            design.selectedPoint = p.points.length - 1;
            if (p.points.length >= (p.connect ? 2 : 3)) refreshPatch(dr.index);
            renderHandles(); fillExtraFields();
            return;
        }
        const chosen = design.selectedPatch !== null ? design.data.patches[design.selectedPatch] : null;
        if (chosen && g) {
            const piece = nearPiece(e, chosen.points, !chosen.connect, yOf);
            if (piece >= 0) {
                chosen.points.splice(piece + 1, 0, { x: round(g.x), z: round(g.z) });
                buildPatches(); selectPatch(design.selectedPatch, piece + 1); commit();
                return;
            }
        }
        const hit = pointerRay(e).intersectObjects(patchGroup.children, false)[0];
        if (hit) { selectPatch(hit.object.userData.patchIndex); return; }
        if (!g) return;
        design.data.patches.push(Object.assign({ surface: design.patchSurface, points: [{ x: round(g.x), z: round(g.z) }] }, design.patchConnect ? { connect: true } : {}));
        design.drawing = { kind: "patch", index: design.data.patches.length - 1 };
        selectPatch(design.data.patches.length - 1, 0);
    }
    // the nearest place on the middle of a road (the track, or a branch but not the one that is drawn) within its width and 2 m: { road, u, x, y, z }
    // own: { index, end }: the branch that is drawn or dragged may join itself too, far enough along its own line from the end that is placed
    function snapRoad(x, z, exclude, own) {
        let best = null, bestD = Infinity;
        const look = (points, road, uOf) => points.forEach((q, i) => {
            const d = Math.hypot(q.x - x, q.z - z);
            if (d < q.w + 2 && d < bestD) { bestD = d; best = { road, u: uOf(q, i), x: q.x, y: q.y, z: q.z }; }
        });
        look(design.mainLine || [], -1, (q) => q.u);
        design.branchLines.forEach((line, k) => { if (k !== exclude && line.points.length > 1) look(line.points, k, (q, i) => i / (line.points.length - 1)); });
        const mine = own && design.branchLines[own.index];
        if (mine && mine.points.length > 1) {
            const pts = mine.points, total = pts[pts.length - 1].along, gap = Math.max(12, pts[own.end ? pts.length - 1 : 0].w * 6);
            pts.forEach((q, i) => {
                if (own.end ? q.along > total - gap : q.along < gap) return;
                const d = Math.hypot(q.x - x, q.z - z);
                if (d < q.w + 2 && d < bestD) { bestD = d; best = { road: own.index, u: i / (pts.length - 1), x: q.x, y: q.y, z: q.z }; }
            });
        }
        return best;
    }
    // Branch: a click on a road starts a branch there (anywhere else: a free end), the next clicks are its nodes, and a click on a road ends it
    // there (Enter ends it where it is). A chosen branch: a click near it adds a node there, its nodes are dragged.
    function branchClick(e) {
        const g = groundPoint(e, null);
        const dr = design.drawing;
        if (dr && dr.kind === "branch") {
            if (!g) return;
            const b = design.data.branches[dr.index];
            const snap = snapRoad(g.x, g.z, dr.index, { index: dr.index, end: true }), first = b.nodes[0];
            const away = first && Math.hypot(g.x - first.x, g.z - first.z) > (b.width || 8);
            if (snap && away && b.nodes.length >= 1) {
                b.nodes.push({ x: round(snap.x), z: round(snap.z) });
                b.end = { road: snap.road, u: snap.u };
                finishDrawing();
                return;
            }
            b.nodes.push({ x: round(g.x), z: round(g.z) });
            design.selectedPoint = b.nodes.length - 1;
            buildBranches(buildBranchLines()); renderHandles(); fillExtraFields();
            return;
        }
        const chosen = design.selectedBranch !== null ? design.data.branches[design.selectedBranch] : null;
        if (chosen && g) {
            const piece = nearPiece(e, chosen.nodes, false, (q) => nearestRoadY(q.x, q.z));
            if (piece >= 0) {
                chosen.nodes.splice(piece + 1, 0, { x: round(g.x), z: round(g.z) });
                rebuild(true); selectBranch(design.selectedBranch, piece + 1); commit();
                return;
            }
        }
        // a click on (or near) a branch chooses it
        let nearest = null;
        design.branchLines.forEach((line, k) => { if (nearest === null && line.points.length > 1 && nearPiece(e, line.points, false, (q) => q.y) >= 0) nearest = k; });
        if (nearest !== null) { selectBranch(nearest); return; }
        if (!g) return;
        const snap = snapRoad(g.x, g.z, -2);
        const start = snap ? { x: round(snap.x), z: round(snap.z) } : { x: round(g.x), z: round(g.z) };
        design.data.branches.push({ nodes: [start], width: Math.max(2, parseFloat($("dsBranchWidth").value) || 8), start: snap ? { road: snap.road, u: snap.u } : null, end: null });
        design.drawing = { kind: "branch", index: design.data.branches.length - 1 };
        selectBranch(design.data.branches.length - 1, 0);
    }
    // the end of drawing: an area needs three corners, a branch two nodes, or it goes
    function finishDrawing() {
        const dr = design.drawing;
        if (!dr) return;
        design.drawing = null;
        if (dr.kind === "rowdraft") {
            const points = design.draft;
            design.draft = [];
            strokeLine.visible = false;
            if (points.length >= 2) addRow(points); else if (points.length === 1) addPrefab(points[0].x, points[0].z);
            return;
        }
        if (dr.kind === "patch") {
            const p = design.data.patches[dr.index];
            if (!p || p.points.length < (p.connect ? 2 : 3)) { design.data.patches.splice(dr.index, 1); design.selectedPatch = null; }
            buildPatches();
        } else {
            const b = design.data.branches[dr.index];
            if (!b || b.nodes.length < 2) { removeBranch(dr.index); design.selectedBranch = null; }
            rebuild(true);
        }
        design.selectedPoint = -1;
        renderHandles(); fillExtraFields();
        commit();
    }
    // a branch goes: the branches that joined it get a free end there, and the numbers of the ones after it go down
    function removeBranch(i) {
        design.data.branches.splice(i, 1);
        design.data.branches.forEach((b) => ["start", "end"].forEach((k) => {
            const a = b[k];
            if (!a || a.road < 0) return;
            if (a.road === i) b[k] = null; else if (a.road > i) a.road--;
        }));
    }
    // Delete: the chosen point (a patch with no corners, a branch with no nodes goes), or the patch or the branch when no point is chosen
    function deleteExtraPoint() {
        if (design.drawing) { finishDrawing(); return; }
        if (design.selectedPatch !== null) {
            const p = design.data.patches[design.selectedPatch];
            if (design.selectedPoint >= 0 && p.points.length > 1) { p.points.splice(design.selectedPoint, 1); design.selectedPoint = -1; }
            else { design.data.patches.splice(design.selectedPatch, 1); design.selectedPatch = null; }
            buildPatches();
        } else if (design.selectedBranch !== null) {
            const b = design.data.branches[design.selectedBranch], i = design.selectedPoint;
            if (i >= 0 && b.nodes.length > 1) {
                b.nodes.splice(i, 1);
                if (i === 0) b.start = null;
                if (i === b.nodes.length) b.end = null;
                design.selectedPoint = -1;
                if (b.nodes.length < 2) { removeBranch(design.selectedBranch); design.selectedBranch = null; }
            } else { removeBranch(design.selectedBranch); design.selectedBranch = null; }
            rebuild(true);
        }
        renderHandles(); fillExtraFields();
        commit();
    }
    function fillExtraFields() {
        if (api.renderLayers) api.renderLayers();
        const p = design.selectedPatch !== null ? design.data.patches[design.selectedPatch] : null;
        const b = design.selectedBranch !== null ? design.data.branches[design.selectedBranch] : null;
        $("dsPatchBox").style.display = p ? "" : "none";
        $("dsBranchBox").style.display = b ? "" : "none";
        fillSurfaceSelect();
        $("dsPatchSurface").value = p ? (p.surface || "gravel") : design.patchSurface;
        $("dsPatchConnect").checked = p ? !!p.connect : design.patchConnect;
        $("dsSurfaceEdit").style.display = $("dsPatchSurface").value.startsWith("c:") ? "" : "none";
        $("dsPatchPointDelete").disabled = !p || design.selectedPoint < 0;
        $("dsBranchNodeDelete").disabled = !b || design.selectedPoint < 0;
        const node = b && design.selectedPoint >= 0 ? b.nodes[design.selectedPoint] : null;
        $("dsBranchNodeWidthBox").style.display = node ? "" : "none";
        if (node && document.activeElement !== $("dsBranchNodeWidth")) $("dsBranchNodeWidth").value = node.width || b.width || 8;
        $("dsBranchNodeWidthReset").disabled = !node || !node.width;
        const dr = design.drawing;
        $("dsPatchInfo").textContent = p ? (dr && dr.kind === "patch" ? "Drawing: " + p.points.length + (p.connect ? " points. Press Enter to end: the area closes along the edge of the road." : " corners. Click the first corner or press Enter to close it.") : "Area " + (design.selectedPatch + 1) + ": " + p.points.length + " corners" + (design.selectedPoint >= 0 ? ", corner " + (design.selectedPoint + 1) + " chosen" : "")) : "";
        $("dsBranchInfo").textContent = b ? (dr && dr.kind === "branch" ? "Drawing: " + b.nodes.length + " nodes. Click on a road to join it, or press Enter to end here." : "Branch " + (design.selectedBranch + 1) + ": " + b.nodes.length + " nodes" + (b.start ? ", starts on " + (b.start.road < 0 ? "the track" : "branch " + (b.start.road + 1)) : "") + (b.end ? ", ends on " + (b.end.road < 0 ? "the track" : "branch " + (b.end.road + 1)) : "")) : "";
    }
    // the choice of surfaces: the ones of the editor and the ones of this track
    function fillSurfaceSelect() {
        const customs = (design.data && design.data.surfaces) || [];
        const sig = JSON.stringify(customs.map((c) => [c.id, c.label]));
        if (design.surfaceSig === sig) return;
        design.surfaceSig = sig;
        const select = $("dsPatchSurface");
        select.innerHTML = "";
        Object.entries(PATCH_SURFACES).forEach(([k, v]) => select.add(new Option(v.label, k)));
        customs.forEach((c) => select.add(new Option(c.label, "c:" + c.id)));
    }
    const selectedPatch = () => design.selectedPatch !== null ? design.data.patches[design.selectedPatch] : null;
    $("dsPatchSurface").addEventListener("change", () => {
        design.patchSurface = $("dsPatchSurface").value;
        const p = selectedPatch();
        if (p) { p.surface = design.patchSurface; buildPatches(); commit(); }
        fillExtraFields();
    });
    $("dsPatchConnect").addEventListener("change", () => {
        design.patchConnect = $("dsPatchConnect").checked;
        const p = selectedPatch();
        if (p) { if (design.patchConnect) p.connect = true; else delete p.connect; buildPatches(); renderHandles(); commit(); }
        fillExtraFields();
    });
    // a surface of the track: a colour, or a texture that repeats, and the grip it gives
    $("dsSurfaceTexture").innerHTML = Object.entries(TEXTURES).map(([k, v]) => '<option value="' + k + '">' + v.label + "</option>").join("");
    $("dsSurfaceGrip").innerHTML = GRIP_CHOICES.map(([k, label]) => '<option value="' + k + '">' + label + "</option>").join("");
    function syncSurfaceForm() {
        const texture = $("dsSurfaceKind").value === "texture";
        $("dsSurfaceColourBox").style.display = texture ? "none" : "";
        $("dsSurfaceTextureBox").style.display = texture ? "" : "none";
        $("dsSurfaceSizeBox").style.display = texture ? "" : "none";
    }
    function showSurfaceEditor(id) {
        const c = id === "new" ? { label: "My surface", kind: "colour", colour: "#8a7a5a", texture: "gravel", size: TEXTURES.gravel.size, grip: "ground" } : ((design.data.surfaces || []).find((q) => q.id === id));
        if (!c) return;
        design.surfaceEditing = id;
        $("dsSurfaceName").value = c.label;
        $("dsSurfaceKind").value = c.kind === "texture" ? "texture" : "colour";
        $("dsSurfaceColour").value = c.colour || "#8a7a5a";
        $("dsSurfaceTexture").value = TEXTURES[c.texture] ? c.texture : "gravel";
        $("dsSurfaceSize").value = c.size || TEXTURES[$("dsSurfaceTexture").value].size;
        $("dsSurfaceGrip").value = c.grip || "ground";
        $("dsSurfaceDelete").style.display = id === "new" ? "none" : "";
        syncSurfaceForm();
        $("dsSurfaceBox").style.display = "";
    }
    $("dsSurfaceKind").addEventListener("change", syncSurfaceForm);
    $("dsSurfaceTexture").addEventListener("change", () => { $("dsSurfaceSize").value = TEXTURES[$("dsSurfaceTexture").value].size; });
    $("dsSurfaceNew").onclick = () => showSurfaceEditor("new");
    $("dsSurfaceEdit").onclick = () => { const v = $("dsPatchSurface").value; if (v.startsWith("c:")) showSurfaceEditor(v.slice(2)); };
    $("dsSurfaceCancel").onclick = () => { design.surfaceEditing = null; $("dsSurfaceBox").style.display = "none"; };
    $("dsSurfaceSave").onclick = () => {
        if (!design.data || !design.surfaceEditing) return;
        const id = design.surfaceEditing === "new" ? "s" + Date.now().toString(36) : design.surfaceEditing;
        const def = { id, label: ($("dsSurfaceName").value || "").trim().slice(0, 40) || "Surface", kind: $("dsSurfaceKind").value, colour: $("dsSurfaceColour").value, texture: $("dsSurfaceTexture").value,
            size: Math.max(0.25, parseFloat($("dsSurfaceSize").value) || TEXTURES[$("dsSurfaceTexture").value].size), grip: $("dsSurfaceGrip").value };
        if (!design.data.surfaces) design.data.surfaces = [];
        const at = design.data.surfaces.findIndex((q) => q.id === id);
        if (at >= 0) design.data.surfaces[at] = def; else design.data.surfaces.push(def);
        design.patchSurface = "c:" + id;
        const p = selectedPatch();
        if (p) p.surface = design.patchSurface;
        design.surfaceEditing = null;
        $("dsSurfaceBox").style.display = "none";
        buildPatches(); fillExtraFields(); commit();
    };
    $("dsSurfaceDelete").onclick = () => {
        const id = design.surfaceEditing;
        if (!design.data || !id || id === "new") return;
        design.data.surfaces = (design.data.surfaces || []).filter((q) => q.id !== id);
        design.data.patches.forEach((q) => { if (q.surface === "c:" + id) q.surface = "gravel"; });
        if (design.patchSurface === "c:" + id) design.patchSurface = "gravel";
        design.surfaceEditing = null;
        $("dsSurfaceBox").style.display = "none";
        buildPatches(); fillExtraFields(); commit();
    };
    $("dsPatchDelete").onclick = () => { if (design.selectedPatch !== null) { design.selectedPoint = -1; deleteExtraPoint(); } };
    $("dsPatchPointDelete").onclick = () => deleteExtraPoint();
    $("dsBranchWidth").addEventListener("change", () => {
        const b = design.selectedBranch !== null ? design.data.branches[design.selectedBranch] : null;
        if (b) { b.width = Math.max(2, parseFloat($("dsBranchWidth").value) || 8); rebuild(true); commit(); }
    });
    const chosenNode = () => { const b = design.selectedBranch !== null ? design.data.branches[design.selectedBranch] : null; return b && design.selectedPoint >= 0 ? b.nodes[design.selectedPoint] : null; };
    $("dsBranchNodeWidth").addEventListener("change", () => {
        const n = chosenNode();
        if (n) { n.width = Math.max(2, parseFloat($("dsBranchNodeWidth").value) || 8); rebuild(true); commit(); fillExtraFields(); }
    });
    $("dsBranchNodeWidthReset").onclick = () => {
        const n = chosenNode();
        if (n) { delete n.width; rebuild(true); commit(); fillExtraFields(); }
    };
    $("dsBranchDelete").onclick = () => { if (design.selectedBranch !== null) { design.selectedPoint = -1; deleteExtraPoint(); } };
    $("dsBranchNodeDelete").onclick = () => deleteExtraPoint();

    // the line that is being drawn
    const strokeLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffd04d }));
    strokeLine.visible = false;
    scene.add(strokeLine);
    function previewStroke(stroke) {
        strokeLine.geometry.dispose();
        strokeLine.geometry = new THREE.BufferGeometry().setFromPoints(stroke.map((q) => new THREE.Vector3(q.x, surfaceHeight(q.x, q.z, null) + 0.3, q.z)));
        strokeLine.visible = true;
    }
    function strokeLength(stroke) {
        let l = 0;
        for (let i = 1; i < stroke.length; i++) l += Math.hypot(stroke[i].x - stroke[i - 1].x, stroke[i].z - stroke[i - 1].z);
        return l;
    }
    // fewer points that still follow the line (Douglas-Peucker)
    function simplify(points, tolerance) {
        if (points.length <= 2) return points.slice();
        const a = points[0], b = points[points.length - 1];
        let far = 0, index = 0;
        for (let i = 1; i < points.length - 1; i++) {
            const p = points[i];
            const dx = b.x - a.x, dz = b.z - a.z;
            const len2 = dx * dx + dz * dz || 1;
            const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
            const d = Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z);
            if (d > far) { far = d; index = i; }
        }
        if (far <= tolerance) return [a, b];
        return simplify(points.slice(0, index + 1), tolerance).slice(0, -1).concat(simplify(points.slice(index), tolerance));
    }

    gizmo.addEventListener("objectChange", () => {
        const o = gizmo.object;
        if (!o) return;
        if (o.userData.nodeIndex !== undefined) {
            const n = design.data.nodes[o.userData.nodeIndex];
            n.y = round(o.position.y - 0.3);
            fillNodeFields();
            scheduleRebuild();
        } else if (o.userData.prefab) {
            const p = o.userData.prefab;
            p.rotation = round(yawOf(o));
            fillPrefabFields();
        }
    });
    gizmo.addEventListener("dragging-changed", (e) => { if (!e.value && gizmo.object) { if (gizmo.object.userData.nodeIndex !== undefined) rebuild(true); commit(); } });

    window.addEventListener("keydown", (e) => {
        if (!design.data || e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;
        const ctrl = e.ctrlKey || e.metaKey;
        // (Ctrl+Z and Ctrl+Y: the editor has one undo for all of the track when it says so, api.ownUndo, and calls undo and redo below)
        if (!api.ownUndo && ctrl && (e.key === "z" || e.key === "Z")) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
        if (!api.ownUndo && ctrl && (e.key === "y" || e.key === "Y")) { e.preventDefault(); redo(); return; }
        if (ctrl && (e.key === "d" || e.key === "D")) { e.preventDefault(); duplicatePrefab(); return; }
        // (not when a gate, an object or a node of the line took the key first: both went, the gate and the road node that was still chosen)
        if ((e.key === "Delete" || e.key === "Backspace") && !e.defaultPrevented) {
            if (design.selectedPatch !== null || design.selectedBranch !== null) deleteExtraPoint();
            else if (design.selectedPrefab !== null) { if (design.selectedRowPoint >= 0) deleteRowPoint(); else deletePrefab(); } else if (design.selectedNode >= 0) deleteNode();
        }
        if (e.key === "Enter" && design.drawing) { e.preventDefault(); finishDrawing(); return; }
        if (e.key === "Escape" && design.drawing) { finishDrawing(); return; }
        if (e.key === "Escape" && (design.selectedPatch !== null || design.selectedBranch !== null)) { letGoExtras(); return; }
        if (e.key === "Escape") {
            if (design.selectedNode >= 0 || design.selectedPrefab !== null) { design.selectedNode = -1; design.selectedPrefab = null; gizmo.detach(); rowGroup.clear(); renderNodes(); fillNodeFields(); fillPrefabFields(); }
            else api.setMode("view");
        }
    });

    // ---- the drawer
    let fieldTimer = 0;
    const commitSoon = () => { clearTimeout(fieldTimer); fieldTimer = setTimeout(commit, 600); };
    $("dsHeight").addEventListener("input", () => { if (design.selectedNode >= 0) { design.data.nodes[design.selectedNode].y = parseFloat($("dsHeight").value) || 0; scheduleRebuild(); commitSoon(); } });
    $("dsNodeWidth").addEventListener("input", () => { if (design.selectedNode >= 0) { design.data.nodes[design.selectedNode].width = Math.max(3, parseFloat($("dsNodeWidth").value) || 12); scheduleRebuild(); commitSoon(); } });
    $("dsWidth").addEventListener("change", () => { if (!design.data) return; const w = Math.max(3, parseFloat($("dsWidth").value) || 12); design.data.nodes.forEach((n) => { n.width = w; }); rebuild(); fillNodeFields(); commit(); });
    $("dsClosed").addEventListener("change", () => { if (design.data) { design.data.closed = $("dsClosed").checked; rebuild(); commit(); } });
    ["road", "shoulder", "ground"].forEach((what) => {
        $("dsTex" + what).addEventListener("change", () => { if (design.data) { design.data.textures[what] = $("dsTex" + what).value; rebuild(what === "ground"); commit(); } });
    });
    $("dsPrefabTexture").addEventListener("change", () => { const p = design.data.prefabs[design.selectedPrefab]; if (p) { p.texture = $("dsPrefabTexture").value; refreshPrefab(design.selectedPrefab); commit(); } });
    $("dsFlatten").onclick = () => { if (design.data) { design.data.nodes.forEach((n) => { n.y = 0; }); rebuild(); fillNodeFields(); commit(); } };
    $("dsDeleteNode").onclick = deleteNode;
    $("dsAddNode").onclick = () => api.setMode("node");
    $("dsDeletePrefab").onclick = deletePrefab;
    $("dsRowNodeDelete").onclick = deleteRowPoint;
    $("dsRowAttach").addEventListener("change", () => {
        const p = design.selectedPrefab !== null ? design.data.prefabs[design.selectedPrefab] : null;
        if (!p || !p.row) return;
        if ($("dsRowAttach").checked) { p.attach = true; p.points.forEach(startNodeOffset); }
        else { delete p.attach; delete p.offset; p.points.forEach((q) => { delete q.offset; }); }
        rebuildPrefabs(); fillPrefabFields(); commit();
    });
    // the offset: of the chosen node, or (no node chosen) of the whole row, which takes the offsets of the nodes away
    $("dsRowOffset").addEventListener("change", () => {
        const p = design.selectedPrefab !== null ? design.data.prefabs[design.selectedPrefab] : null;
        if (!p || !p.row || !p.attach) return;
        const value = Math.max(-6, Math.min(6, parseFloat($("dsRowOffset").value) || 0));
        if (design.selectedRowPoint >= 0) p.points[design.selectedRowPoint].offset = value;
        else { p.offset = value; p.points.forEach((q) => { delete q.offset; }); }
        rebuildPrefabs(); fillPrefabFields(); commit();
    });
    $("dsDuplicate").onclick = duplicatePrefab;
    $("dsUndo").onclick = undo;
    $("dsRedo").onclick = redo;
    $("dsPrefabRotation").addEventListener("input", () => { const p = design.data.prefabs[design.selectedPrefab]; if (p && !p.row) { p.rotation = (parseFloat($("dsPrefabRotation").value) || 0) * Math.PI / 180; refreshPrefab(design.selectedPrefab); commitSoon(); } });
    $("dsPrefabSpacing").addEventListener("input", () => { const p = design.data.prefabs[design.selectedPrefab]; if (p && p.row) { p.spacing = Math.max(0.3, parseFloat($("dsPrefabSpacing").value) || 1); refreshPrefab(design.selectedPrefab); fillPrefabFields(); commitSoon(); } });
    $("dsPrefabScale").addEventListener("input", () => { const p = design.data.prefabs[design.selectedPrefab]; if (p) { p.scale = Math.max(0.1, parseFloat($("dsPrefabScale").value) || 1); refreshPrefab(design.selectedPrefab); commitSoon(); } });
    document.querySelectorAll("#drawer .tab").forEach((b) => b.addEventListener("click", () => {
        document.querySelectorAll("#drawer .tab").forEach((t) => t.classList.toggle("active", t === b));
        document.querySelectorAll("#drawer .page").forEach((p) => { p.style.display = p.dataset.page === b.dataset.tab ? "" : "none"; });
        api.setMode({ prefabs: "prefab", patches: "patch", branches: "branch" }[b.dataset.tab] || "node");
    }));
    $("drawerToggle").onclick = () => { $("drawer").classList.toggle("collapsed"); $("drawerToggle").textContent = $("drawer").classList.contains("collapsed") ? "▴" : "▾"; };

    // ---- enable, disable, save, load
    function enable(data) {
        design.data = data || defaultDesign();
        if (!design.data.textures) design.data.textures = Object.assign({}, DEFAULT_TEXTURES);
        maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
        design.selectedNode = -1;
        design.selectedPrefab = null;
        fillTextureFields();
        if (!design.data.patches) design.data.patches = [];
        design.surfaceSig = null; design.surfaceEditing = null;
        fillSurfaceSelect();
        if (!design.data.branches) design.data.branches = [];
        design.selectedPatch = null; design.selectedBranch = null; design.selectedPoint = -1; design.drawing = null;
        if (!trackGroup.children.includes(roadGroup)) trackGroup.add(roadGroup);
        if (!trackGroup.children.includes(branchGroup)) trackGroup.add(branchGroup);
        if (!trackGroup.children.includes(patchGroup)) trackGroup.add(patchGroup);
        if (!trackGroup.children.includes(prefabGroup)) trackGroup.add(prefabGroup);
        state.legacy = false;
        $("drawer").style.display = "";
        $("dsWidth").value = design.data.nodes[0] ? design.data.nodes[0].width : 12;
        $("dsClosed").checked = design.data.closed !== false;
        renderPrefabList();
        rebuild(true);
        design.data.prefabs.forEach((p) => { if (p.row) snapRow(p, null); });
        rebuildPrefabs();
        fillNodeFields();
        fillPrefabFields();
        api.frameTrack();
        history.past = [snapshot()];
        history.future = [];
        updateUndoButtons();
    }

    function disable() {
        design.data = null;
        gizmo.detach();
        gizmo.enabled = false;
        nodeGroup.clear();
        rowGroup.clear();
        roadGroup.clear();
        prefabGroup.clear();
        branchGroup.clear(); patchGroup.clear(); handleGroup.clear();
        trackGroup.remove(roadGroup);
        trackGroup.remove(branchGroup); trackGroup.remove(patchGroup);
        trackGroup.remove(prefabGroup);
        $("drawer").style.display = "none";
    }

    function toJSON() {
        return JSON.parse(JSON.stringify(design.data));
    }

    // The surfaces lie over each other: the ground under the road and the shoulders, the shoulders under a branch and the gravel, a
    // mouth under the road. The game sees only the highest one, but it tested the triangles under it too (Ground.js: all the triangles of
    // a cell). For the glb, a triangle that lies wholly under another part (above it by more than HIDDEN_MIN and less than HIDDEN_MAX: not
    // under a bridge) is left out. (A triangle that is partly under one stays whole: cut into smaller ones it gave the game more triangles to
    // test in a cell, not fewer.) Gives a Map: mesh -> its geometry without them, for the parts that lost triangles.
    const HIDDEN_MIN = 0.005, HIDDEN_MAX = 2, HIDDEN_CELL = 4, HIDDEN_STEP = 1;
    function withoutHidden() {
        const meshes = [];
        [roadGroup, branchGroup, patchGroup].forEach((g) => g.children.forEach((m) => { if (m.isMesh && m.geometry.attributes.position) meshes.push(m); }));
        // every triangle of every part in world coordinates (x0 z0 y0 x1 z1 y1 x2 z2 y2), its part, and a grid on the ground to find them
        const tris = [], owner = [], cells = new Map(), v = new THREE.Vector3();
        const parts = meshes.map((m, mi) => {
            const pos = m.geometry.attributes.position, index = m.geometry.index, world = new Float32Array(pos.count * 3);
            for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); world[i * 3] = v.x; world[i * 3 + 1] = v.y; world[i * 3 + 2] = v.z; }
            const corners = [];
            for (let k = 0; k < (index ? index.count : pos.count); k++) corners.push(index ? index.getX(k) : k);
            for (let k = 0; k + 2 < corners.length; k += 3) {
                const t = owner.length, [a, b, d] = [corners[k] * 3, corners[k + 1] * 3, corners[k + 2] * 3];
                tris.push(world[a], world[a + 2], world[a + 1], world[b], world[b + 2], world[b + 1], world[d], world[d + 2], world[d + 1]);
                owner.push(mi);
                const x0 = Math.floor(Math.min(world[a], world[b], world[d]) / HIDDEN_CELL), x1 = Math.floor(Math.max(world[a], world[b], world[d]) / HIDDEN_CELL);
                const z0 = Math.floor(Math.min(world[a + 2], world[b + 2], world[d + 2]) / HIDDEN_CELL), z1 = Math.floor(Math.max(world[a + 2], world[b + 2], world[d + 2]) / HIDDEN_CELL);
                for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) { const key = i + "," + j; if (!cells.has(key)) cells.set(key, []); cells.get(key).push(t); }
            }
            return { m, corners, first: owner.length - corners.length / 3 };
        });
        // whether another part lies over (x, y, z)
        const covered = (x, z, y, self) => {
            const list = cells.get(Math.floor(x / HIDDEN_CELL) + "," + Math.floor(z / HIDDEN_CELL));
            if (!list) return false;
            for (let q = 0; q < list.length; q++) {
                const t = list[q];
                if (owner[t] === self) continue;
                const o = t * 9, ax = tris[o], az = tris[o + 1], bx = tris[o + 3], bz = tris[o + 4], cx = tris[o + 6], cz = tris[o + 7];
                const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
                if (Math.abs(d) < 1e-12) continue;
                const a = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, b = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, c = 1 - a - b;
                if (a < -1e-6 || b < -1e-6 || c < -1e-6) continue;
                const h = a * tris[o + 2] + b * tris[o + 5] + c * tris[o + 8] - y;
                if (h > HIDDEN_MIN && h < HIDDEN_MAX) return true;
            }
            return false;
        };
        // whether all of triangle t is under another part: points about every HIDDEN_STEP metres in it, its corners too
        const hidden = (t) => {
            const o = t * 9, edge = Math.max(Math.hypot(tris[o + 3] - tris[o], tris[o + 4] - tris[o + 1]), Math.hypot(tris[o + 6] - tris[o + 3], tris[o + 7] - tris[o + 4]), Math.hypot(tris[o] - tris[o + 6], tris[o + 1] - tris[o + 7]));
            const n = Math.max(1, Math.ceil(edge / HIDDEN_STEP));
            for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
                const a = i / n, b = j / n, c = 1 - a - b;
                if (!covered(a * tris[o] + b * tris[o + 3] + c * tris[o + 6], a * tris[o + 1] + b * tris[o + 4] + c * tris[o + 7], a * tris[o + 2] + b * tris[o + 5] + c * tris[o + 8], owner[t])) return false;
            }
            return true;
        };
        const result = new Map();
        parts.forEach(({ m, corners, first }) => {
            const index = [];
            for (let k = 0; k + 2 < corners.length; k += 3) if (!hidden(first + k / 3)) index.push(corners[k], corners[k + 1], corners[k + 2]);
            if (index.length === corners.length) return;
            const geometry = new THREE.BufferGeometry();
            Object.entries(m.geometry.attributes).forEach(([name, attribute]) => geometry.setAttribute(name, attribute.clone()));
            geometry.setIndex(index);
            result.set(m, geometry);
        });
        return result;
    }

    // the glb of the track: the road and the prefabs, the names of the parts say what they are. The parts are exported with their own
    // materials (not the colours of the surfaces), without the data of the editor and without the triangles that lie under another part.
    async function exportGlb() {
        const saved = [];
        const cut = withoutHidden();
        [roadGroup, branchGroup, patchGroup, prefabGroup].forEach((g) => g.traverse((m) => {
            if (!m.isMesh) return;
            saved.push({ mesh: m, material: m.material, userData: m.userData, geometry: m.geometry });
            m.material = (m.userData && m.userData.original) || m.material;
            if (cut.has(m)) m.geometry = cut.get(m);
            m.userData = {};
        }));
        // (a part with nothing left is not exported)
        const empty = saved.filter((s) => s.mesh.geometry.index && s.mesh.geometry.index.count === 0);
        empty.forEach((s) => { s.parent = s.mesh.parent; s.parent.remove(s.mesh); });
        try {
            const exporter = new GLTFExporter();
            return await exporter.parseAsync([roadGroup, branchGroup, patchGroup, prefabGroup], { binary: true });
        } finally {
            empty.forEach((s) => s.parent.add(s.mesh));
            saved.forEach((s) => { s.mesh.material = s.material; s.mesh.userData = s.userData; if (s.geometry !== s.mesh.geometry) { s.mesh.geometry.dispose(); s.mesh.geometry = s.geometry; } });
        }
    }

    return {
        enable, disable, toJSON, exportGlb, undo, redo, roadEdgeAt,
        // the surfaces as rows of the Layers panel, and a click on one
        patchRows: () => (design.data && design.data.patches ? design.data.patches : []).map((p, i) => ({ label: surfaceOf(p.surface).label + (p.connect ? ", connected" : ""), meta: p.points.length + " points", selected: design.selectedPatch === i })),
        choosePatch: (i) => { if (!design.data || !design.data.patches[i]) return; if (design.selectedPatch === i) letGoExtras(); else { api.setMode("patch"); selectPatch(i); } },
        // how a new row is made: Draw (a line is dragged) or Points (the corners are clicked)
        prefabStyle: () => design.prefabStyle,
        prefabAttach: () => design.prefabAttach,
        setPrefabAttach: (on) => { design.prefabAttach = !!on; },
        setPrefabStyle: (style) => { if (design.drawing && design.drawing.kind === "rowdraft") finishDrawing(); design.prefabStyle = style === "points" ? "points" : "draw"; },
        outlineOf: (i) => (design.data && design.data.patches[i] ? patchOutline(design.data.patches[i]).poly : []),          // (for the tests: the outline of an area with the way along the road)
        // a curb of the editor changed: the surfaces that connect to the road follow its edge
        curbsChanged: () => { design.edgeCache = null; if (design.data && (design.data.patches || []).some((q) => q.connect)) buildPatches(); },
        active: () => !!design.data,
        // what is chosen ("" nothing, "n3" node 3, "p2" prefab 2), and letting go of it (the editor chooses one thing at a time)
        selection: () => !design.data ? "" : design.selectedNode >= 0 ? "n" + design.selectedNode : design.selectedPrefab !== null ? "p" + design.selectedPrefab
            : design.selectedPatch !== null ? "g" + design.selectedPatch + "." + design.selectedPoint : design.selectedBranch !== null ? "b" + design.selectedBranch + "." + design.selectedPoint : "",
        deselect: () => { if (design.data && (design.selectedNode >= 0 || design.selectedPrefab !== null)) { selectNode(-1); rowGroup.clear(); } if (design.data) letGoExtras(); },
        // the tool changed: the drawer shows its page, and what was being drawn is ended
        modeChanged: (mode) => {
            if (!design.data) return;
            if (design.drawing && mode !== design.drawing.kind) finishDrawing();
            const tab = { prefab: "prefabs", patch: "patches", branch: "branches", node: "track" }[mode];
            if (tab) {
                document.querySelectorAll("#drawer .tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
                document.querySelectorAll("#drawer .page").forEach((p) => { p.style.display = p.dataset.page === tab ? "" : "none"; });
            }
        },
        roles: () => { const r = {}; [roadGroup, branchGroup, patchGroup].forEach((g) => g.children.forEach((m) => { r[m.name] = m.userData.role; })); prefabGroup.children.forEach((g) => { r[g.name] = state.roles[g.name]; }); return r; },
        hudText: (mode) => mode === "node" ? "Nodes: click on the ground to add one between the two nearest nodes, drag a node to move it, the arrow for its height. Delete removes it, Ctrl+Z undoes."
            : mode === "patch" ? "Surfaces: click on the ground for the corners of an area (gravel beside a bend, a car park, a run-off), click the first corner or press Enter to close it. With Connect to road a line is enough: the area closes along the edge of the road. A chosen area: drag its corners, click its edge to add a corner, Delete takes the chosen corner away."
            : mode === "branch" ? "Branch: click on the track (or a branch) where the new road starts, then its nodes, and click on a road where it ends (Enter: a free end). A chosen branch: drag its nodes, click on it to add a node, Delete takes the chosen node away."
            : mode === "prefab" ? "Prefabs: click to put down a " + (PREFABS[design.prefabType] || PREFABS.wall).label.toLowerCase() + ", or " + (design.prefabStyle === "points" ? "click the points of a row of them (Enter ends it)" : "drag a line to make a row of them")
                + ". Drag one to move it (it sits on what is under it), the ring turns it. A chosen row: click on its line to add a node, click a node to choose it, Delete removes the node (or the prefab)."
            : (design.data ? "Look: drag to turn, right mouse button to move, scroll to zoom. Nodes and prefabs can be dragged here too." : null)
    };
}
