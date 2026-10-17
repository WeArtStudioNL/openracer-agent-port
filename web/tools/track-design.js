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

// ---- the prefabs: a function that makes the object (y = 0 is the ground), and the surface of its parts in the game
const PREFABS = {
    wall: { label: "Wall", icon: "▬", role: "scenery", make: () => {
        const g = new THREE.Group();
        g.add(box(4, 1, 0.3, 0xd8d8d2, 0, 0.5, 0));
        return g;
    } },
    barrier: { label: "Barrier", icon: "═", role: "scenery", make: () => {
        const g = new THREE.Group();
        g.add(box(4, 0.35, 0.08, 0xb9bec6, 0, 0.6, 0));
        g.add(box(0.1, 0.75, 0.1, 0x6a6f78, -1.9, 0.375, 0));
        g.add(box(0.1, 0.75, 0.1, 0x6a6f78, 1.9, 0.375, 0));
        return g;
    } },
    tyres: { label: "Tyre stack", icon: "◎", role: "scenery", make: () => {
        const g = new THREE.Group();
        for (let i = 0; i < 4; i++) g.add(cylinder(0.36, 0.22, i === 3 ? 0xc53b32 : 0x1e2024, 0, 0.11 + i * 0.22, 0));
        return g;
    } },
    tyrewall: { label: "Tyre wall", icon: "◎◎◎", role: "scenery", make: () => {
        const g = new THREE.Group();
        for (let s = -1; s <= 1; s++) for (let i = 0; i < 3; i++) g.add(cylinder(0.36, 0.22, (i + s) % 2 ? 0x1e2024 : 0xe8e8e0, s * 0.75, 0.11 + i * 0.22, 0));
        return g;
    } },
    cone: { label: "Cone", icon: "▲", role: "decor", make: () => {
        const g = new THREE.Group();
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.7, 12), material(0xf26b1d));
        c.position.y = 0.35;
        g.add(c);
        g.add(box(0.45, 0.03, 0.45, 0x222222, 0, 0.015, 0));
        return g;
    } },
    tree: { label: "Tree", icon: "♣", role: "scenery", make: () => {
        const g = new THREE.Group();
        g.add(cylinder(0.18, 2.2, 0x6b4a2b, 0, 1.1, 0));
        for (let i = 0; i < 3; i++) {
            const c = new THREE.Mesh(new THREE.ConeGeometry(1.8 - i * 0.4, 2.2, 10), material(i % 2 ? 0x2f7a35 : 0x3a8f3f));
            c.position.y = 2.6 + i * 1.3;
            g.add(c);
        }
        return g;
    } },
    bush: { label: "Bush", icon: "●", role: "decor", make: () => {
        const g = new THREE.Group();
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 9), material(0x3f8a3c));
        b.scale.set(1.2, 0.8, 1);
        b.position.y = 0.6;
        g.add(b);
        return g;
    } },
    house: { label: "House", icon: "⌂", role: "scenery", make: () => {
        const g = new THREE.Group();
        g.add(box(8, 3.2, 6, 0xd9c7a8, 0, 1.6, 0));
        const roof = new THREE.Mesh(new THREE.ConeGeometry(5.6, 2.4, 4), material(0x9a3b32));
        roof.position.y = 4.4;
        roof.rotation.y = Math.PI / 4;
        roof.scale.set(1, 1, 0.75);
        g.add(roof);
        g.add(box(1, 2.1, 0.1, 0x4a3a2a, 0, 1.05, 3.05));
        return g;
    } },
    grandstand: { label: "Grandstand", icon: "▤", role: "scenery", make: () => {
        const g = new THREE.Group();
        for (let i = 0; i < 5; i++) g.add(box(16, 0.6, 1.4, i % 2 ? 0x6c7484 : 0x7b8596, 0, 0.3 + i * 0.6, -i * 1.4));
        g.add(box(16, 0.2, 7, 0x3c4350, 0, 4.2, -2.8));
        for (const x of [-7.5, 7.5]) for (const z of [0.2, -5.8]) g.add(box(0.2, 4.2, 0.2, 0x3c4350, x, 2.1, z));
        return g;
    } },
    lamp: { label: "Lamp post", icon: "¡", role: "scenery", make: () => {
        const g = new THREE.Group();
        g.add(cylinder(0.08, 7, 0x8a9099, 0, 3.5, 0));
        g.add(box(1.2, 0.15, 0.3, 0x8a9099, 0.5, 7, 0));
        g.add(box(0.5, 0.1, 0.25, 0xfff2b0, 0.95, 6.9, 0));
        return g;
    } },
    sign: { label: "Sign board", icon: "▭", role: "decor", make: () => {
        const g = new THREE.Group();
        g.add(box(6, 1.2, 0.08, 0x2d5fbf, 0, 1.8, 0));
        g.add(box(0.1, 1.2, 0.1, 0x8a9099, -2.8, 0.6, 0));
        g.add(box(0.1, 1.2, 0.1, 0x8a9099, 2.8, 0.6, 0));
        return g;
    } }
};

function material(color) { return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0 }); }
function box(w, h, d, color, x, y, z) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(color)); m.position.set(x, y, z); return m; }
function cylinder(r, h, color, x, y, z) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 16), material(color)); m.position.set(x, y, z); return m; }

function defaultDesign() {
    // an oval to start from
    const nodes = [];
    for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2;
        nodes.push({ x: Math.round(Math.cos(a) * 120), y: 0, z: Math.round(Math.sin(a) * 70), width: 12 });
    }
    return { nodes, closed: true, prefabs: [] };
}

export function createDesign(api) {
    const { scene, trackGroup, camera, renderer, controls, state, registerMesh, applyColours, renderParts, updateMarkers, status, $, roleMaterials } = api;
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

    const design = { data: null, selectedNode: -1, selectedPrefab: null, prefabType: "wall", rebuildPending: false };
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

    function strip(name, left, right, color, role, roughness) {
        // a ribbon between two rows of points, closed or not
        const count = left.length;
        const closed = design.data.closed;
        const positions = [], uvs = [], indices = [];
        for (let i = 0; i < count; i++) {
            positions.push(left[i].x, left[i].y, left[i].z, right[i].x, right[i].y, right[i].z);
            uvs.push(0, i * 0.1, 1, i * 0.1);
        }
        const segments = closed ? count : count - 1;
        for (let i = 0; i < segments; i++) {
            const a = i * 2, b = ((i + 1) % count) * 2;
            indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: roughness || 0.95, metalness: 0, side: THREE.DoubleSide }));
        mesh.name = name;
        mesh.userData.role = role;
        return mesh;
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
        const left = [], right = [], shoulderL = [], shoulderR = [], kerbLo = [], kerbLi = [], kerbRo = [], kerbRi = [];
        const count = data.closed ? samples : samples + 1;
        let minY = Infinity;
        const bounds = new THREE.Box2();
        const centreLine = []; // { x, z, y, reach }: the road and its shoulders, for the terrain
        for (let i = 0; i < count; i++) {
            const u = data.closed ? i / samples : i / samples;
            const p = curve.getPointAt(Math.min(1, u));
            const tangent = curve.getTangentAt(Math.min(1, u)).setY(0).normalize();
            const side = new THREE.Vector3().crossVectors(UP, tangent).normalize();
            const w = widthAt(data, curve, Math.min(1, u)) / 2;
            left.push(p.clone().addScaledVector(side, w));
            right.push(p.clone().addScaledVector(side, -w));
            kerbLi.push(p.clone().addScaledVector(side, w - 0.6).add(new THREE.Vector3(0, 0.012, 0)));
            kerbLo.push(p.clone().addScaledVector(side, w + 0.05).add(new THREE.Vector3(0, 0.012, 0)));
            kerbRi.push(p.clone().addScaledVector(side, -(w - 0.6)).add(new THREE.Vector3(0, 0.012, 0)));
            kerbRo.push(p.clone().addScaledVector(side, -(w + 0.05)).add(new THREE.Vector3(0, 0.012, 0)));
            shoulderL.push(p.clone().addScaledVector(side, w + 14).add(new THREE.Vector3(0, -0.3, 0)));
            shoulderR.push(p.clone().addScaledVector(side, -(w + 14)).add(new THREE.Vector3(0, -0.3, 0)));
            minY = Math.min(minY, p.y);
            bounds.expandByPoint(new THREE.Vector2(p.x, p.z));
            centreLine.push({ x: p.x, z: p.z, y: p.y, reach: w + 14 });
        }
        const road = strip("road", left, right, 0x40444b, "road", 0.9);
        const shoulderLeft = strip("shoulder_left", shoulderL, left, 0x4e8a3e, "grass");
        const shoulderRight = strip("shoulder_right", right, shoulderR, 0x4e8a3e, "grass");
        // the kerbs: red and white every 4 metres
        const kerbs = [];
        const step = Math.max(1, Math.round(4 / (length / count)));
        [["kerb_left", kerbLo, kerbLi], ["kerb_right", kerbRi, kerbRo]].forEach(([name, outer, inner]) => {
            const pos = [], idx = [], col = [];
            for (let i = 0; i < count; i++) {
                pos.push(outer[i].x, outer[i].y, outer[i].z, inner[i].x, inner[i].y, inner[i].z);
                const red = Math.floor(i / step) % 2 === 0;
                for (let k = 0; k < 2; k++) col.push(red ? 0.85 : 0.95, red ? 0.15 : 0.95, red ? 0.12 : 0.92);
            }
            const segs = data.closed ? count : count - 1;
            for (let i = 0; i < segs; i++) { const a = i * 2, b = ((i + 1) % count) * 2; idx.push(a, b, a + 1, a + 1, b, b + 1); }
            const g = new THREE.BufferGeometry();
            g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
            g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
            g.setIndex(idx);
            g.computeVertexNormals();
            const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }));
            m.name = name;
            m.userData.role = "road";
            kerbs.push(m);
        });
        // the ground: a landscape that joins the shoulders of the road and rolls gently further away (during a drag the old one stays)
        const ground = (!withTerrain && lastTerrain) ? lastTerrain : terrain(centreLine, bounds, minY);
        lastTerrain = ground;
        [road, shoulderLeft, shoulderRight, ...kerbs, ground].forEach((m) => { roadGroup.add(m); registerMesh(m, m.userData.role); state.roles[m.name] = m.userData.role; });
        roadGroup.updateMatrixWorld(true);
        renderNodes();
        applyColours();
        renderParts();
        updateMarkers();
        $("modelInfo").textContent = "Designed track: " + data.nodes.length + " nodes, " + Math.round(length) + " m, " + data.prefabs.length + " prefabs";
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
        let n = 0;
        for (let j = 0; j < nz; j++) {
            for (let i = 0; i < nx; i++) {
                const x = minX + i * cell, z = minZ + j * cell;
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
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x7f6f4a, roughness: 1 }));
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
    }
    function restore(s) {
        design.data = JSON.parse(s);
        design.selectedNode = -1;
        design.selectedPrefab = null;
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
        nodeGroup.clear();
        if (!design.data) return;
        const scale = Math.max(1, state.markerScale || 1);
        design.data.nodes.forEach((n, i) => {
            const mesh = new THREE.Mesh(new THREE.SphereGeometry(i === design.selectedNode ? 1.3 * scale : 0.9 * scale, 14, 10),
                new THREE.MeshBasicMaterial({ color: i === design.selectedNode ? 0xffd04d : (i === 0 ? 0x4ed88a : 0x4db8ff) }));
            mesh.position.set(n.x, n.y + 0.3, n.z);
            mesh.userData.nodeIndex = i;
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
            gizmo.showX = gizmo.showZ = false;
            gizmo.showY = true;
            gizmo.enabled = true;
        }
    }

    function selectNode(i) {
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

    // the height of the ground (the road, the terrain or another prefab) under a point
    function surfaceHeight(x, z, exclude) {
        raycaster.set(new THREE.Vector3(x, 1000, z), new THREE.Vector3(0, -1, 0));
        const targets = roadGroup.children.concat(prefabGroup.children.filter((g) => g !== exclude));
        const hits = raycaster.intersectObjects(targets, true);
        return hits.length ? hits[0].point.y : 0;
    }

    function instance(def, p, x, y, z, rotation, scale, name) {
        const g = def.make();
        g.position.set(x, y, z);
        g.rotation.y = rotation || 0;
        g.scale.setScalar(scale || 1);
        g.traverse((m) => { if (m.isMesh) { m.name = name; m.userData.role = def.role; } });
        return g;
    }

    function rowCurve(p) {
        const pts = p.points.map((q) => new THREE.Vector3(q.x, q.y || 0, q.z));
        if (pts.length === 1) return null;
        return new THREE.CatmullRomCurve3(pts, false, "centripetal", 0.5);
    }

    function makePrefab(p, index) {
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
                    copies.push(instance(def, p, pos.x, pos.y, pos.z, Math.atan2(-t.z, t.x), p.scale, name));
                }
            } else {
                copies.push(instance(def, p, p.points[0].x, p.points[0].y || 0, p.points[0].z, 0, p.scale, name));
            }
            const byColour = new Map();
            copies.forEach((c) => {
                c.updateMatrixWorld(true);
                c.traverse((m) => {
                    if (!m.isMesh) return;
                    const key = m.material.color.getHex();
                    if (!byColour.has(key)) byColour.set(key, { material: m.material, geometries: [] });
                    const geometry = m.geometry.clone().applyMatrix4(m.matrixWorld);
                    byColour.get(key).geometries.push(geometry);
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
            g.add(instance(def, p, p.x, p.y, p.z, p.rotation, p.scale, name));
        }
        return g;
    }

    // the points of a row lie on the ground
    function snapRow(p, exclude) {
        p.points.forEach((q) => { q.y = round(surfaceHeight(q.x, q.z, exclude)); });
    }

    function rebuildPrefabs() {
        prefabGroup.children.slice().forEach((g) => { prefabGroup.remove(g); state.parts.delete(g.name); });
        if (!design.data) return;
        design.data.prefabs.forEach((p, i) => {
            const g = makePrefab(p, i);
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
        const g = makePrefab(design.data.prefabs[i], i);
        prefabGroup.remove(old);
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
        snapRow(p, null);
        design.data.prefabs.push(p);
        rebuildPrefabs();
        selectPrefab(design.data.prefabs.length - 1);
        commit();
    }

    function selectPrefab(i) {
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
        $("dsPrefabRotation").value = Math.round((p.rotation || 0) * 180 / Math.PI);
        $("dsPrefabSpacing").value = p.spacing || SPACING[p.type] || 4;
        $("dsPrefabScale").value = p.scale || 1;
    }

    function renderRowPoints() {
        rowGroup.clear();
        const p = design.selectedPrefab !== null ? design.data.prefabs[design.selectedPrefab] : null;
        if (!p || !p.row) return;
        const scale = Math.max(1, state.markerScale || 1) * 0.6;
        p.points.forEach((q, i) => {
            const m = new THREE.Mesh(new THREE.SphereGeometry(scale, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd04d }));
            m.position.set(q.x, (q.y || 0) + 0.2, q.z);
            m.userData.rowPoint = i;
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
        const targets = roadGroup.children.concat(prefabGroup.children.filter((g) => g !== exclude));
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
        if (mode !== "node" && mode !== "prefab" && mode !== "view") return;
        const hit = under(e);
        drag = { start: [e.clientX, e.clientY], moved: false, stroke: null };
        if (hit.node !== undefined && mode !== "prefab") {
            if (design.selectedNode !== hit.node) selectNode(hit.node);
            const n = design.data.nodes[hit.node];
            drag.kind = "node"; drag.index = hit.node; drag.y = n.y;
            const p = planePoint(e, n.y);
            drag.offset = p ? { x: n.x - p.x, z: n.z - p.z } : { x: 0, z: 0 };
        } else if (hit.rowPoint !== undefined) {
            const p = design.data.prefabs[design.selectedPrefab];
            const q = p.points[hit.rowPoint];
            drag.kind = "rowPoint"; drag.index = hit.rowPoint; drag.y = q.y || 0;
            const pp = planePoint(e, drag.y);
            drag.offset = pp ? { x: q.x - pp.x, z: q.z - pp.z } : { x: 0, z: 0 };
        } else if (hit.prefab !== undefined && hit.prefab >= 0 && mode !== "node") {
            if (design.selectedPrefab !== hit.prefab) selectPrefab(hit.prefab);
            const p = design.data.prefabs[hit.prefab];
            drag.kind = "prefab"; drag.index = hit.prefab;
            drag.y = p.row ? (p.points[0].y || 0) : p.y;
            const pp = planePoint(e, drag.y);
            const ox = p.row ? p.points[0].x : p.x, oz = p.row ? p.points[0].z : p.z;
            drag.offset = pp ? { x: ox - pp.x, z: oz - pp.z } : { x: 0, z: 0 };
            drag.origin = p.row ? p.points.map((q) => ({ x: q.x, z: q.z })) : null;
        } else if (mode === "prefab") {
            drag.kind = "draw"; drag.stroke = [];
            const g = groundPoint(e, null);
            if (g) drag.stroke.push({ x: g.x, z: g.z });
        } else if (mode === "node") {
            drag.kind = "add";
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
                renderer.domElement.style.cursor = (hit.node !== undefined || hit.rowPoint !== undefined || (hit.prefab !== undefined && hit.prefab >= 0)) ? "grab"
                    : (mode === "node" || mode === "prefab" ? "crosshair" : "");
            }
            return;
        }
        if (Math.abs(e.clientX - drag.start[0]) + Math.abs(e.clientY - drag.start[1]) > 3) drag.moved = true;
        if (!drag.moved) return;
        renderer.domElement.style.cursor = "grabbing";
        if (drag.kind === "node") {
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
                p.x = round(pp.x + drag.offset.x); p.z = round(pp.z + drag.offset.z);
                p.y = round(surfaceHeight(p.x, p.z, own)); // snaps to the ground, the road or what it is put on
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
        if (d.kind === "add") {
            if (!d.moved) { const g = groundPoint(e, null); if (g) addNode(g.x, g.z); }
        } else if (d.kind === "draw") {
            if (!d.moved || strokeLength(d.stroke) < 2) { const g = groundPoint(e, null); if (g) addPrefab(g.x, g.z); }
            else addRow(simplify(d.stroke, 1.5));
        } else if (d.moved) {
            if (d.kind === "node") rebuild(true);
            commit();
        }
    });

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
            p.rotation = round(o.rotation.y);
            fillPrefabFields();
        }
    });
    gizmo.addEventListener("dragging-changed", (e) => { if (!e.value && gizmo.object) { if (gizmo.object.userData.nodeIndex !== undefined) rebuild(true); commit(); } });

    window.addEventListener("keydown", (e) => {
        if (!design.data || e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;
        const ctrl = e.ctrlKey || e.metaKey;
        if (ctrl && (e.key === "z" || e.key === "Z")) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
        if (ctrl && (e.key === "y" || e.key === "Y")) { e.preventDefault(); redo(); return; }
        if (ctrl && (e.key === "d" || e.key === "D")) { e.preventDefault(); duplicatePrefab(); return; }
        if (e.key === "Delete" || e.key === "Backspace") { if (design.selectedPrefab !== null) deletePrefab(); else if (design.selectedNode >= 0) deleteNode(); }
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
    $("dsFlatten").onclick = () => { if (design.data) { design.data.nodes.forEach((n) => { n.y = 0; }); rebuild(); fillNodeFields(); commit(); } };
    $("dsDeleteNode").onclick = deleteNode;
    $("dsAddNode").onclick = () => api.setMode("node");
    $("dsDeletePrefab").onclick = deletePrefab;
    $("dsDuplicate").onclick = duplicatePrefab;
    $("dsUndo").onclick = undo;
    $("dsRedo").onclick = redo;
    $("dsPrefabRotation").addEventListener("input", () => { const p = design.data.prefabs[design.selectedPrefab]; if (p && !p.row) { p.rotation = (parseFloat($("dsPrefabRotation").value) || 0) * Math.PI / 180; refreshPrefab(design.selectedPrefab); commitSoon(); } });
    $("dsPrefabSpacing").addEventListener("input", () => { const p = design.data.prefabs[design.selectedPrefab]; if (p && p.row) { p.spacing = Math.max(0.3, parseFloat($("dsPrefabSpacing").value) || 1); refreshPrefab(design.selectedPrefab); fillPrefabFields(); commitSoon(); } });
    $("dsPrefabScale").addEventListener("input", () => { const p = design.data.prefabs[design.selectedPrefab]; if (p) { p.scale = Math.max(0.1, parseFloat($("dsPrefabScale").value) || 1); refreshPrefab(design.selectedPrefab); commitSoon(); } });
    document.querySelectorAll("#drawer .tab").forEach((b) => b.addEventListener("click", () => {
        document.querySelectorAll("#drawer .tab").forEach((t) => t.classList.toggle("active", t === b));
        document.querySelectorAll("#drawer .page").forEach((p) => { p.style.display = p.dataset.page === b.dataset.tab ? "" : "none"; });
        if (b.dataset.tab === "prefabs") api.setMode("prefab"); else if (b.dataset.tab === "track") api.setMode("node");
    }));
    $("drawerToggle").onclick = () => { $("drawer").classList.toggle("collapsed"); $("drawerToggle").textContent = $("drawer").classList.contains("collapsed") ? "▴" : "▾"; };

    // ---- enable, disable, save, load
    function enable(data) {
        design.data = data || defaultDesign();
        design.selectedNode = -1;
        design.selectedPrefab = null;
        if (!trackGroup.children.includes(roadGroup)) trackGroup.add(roadGroup);
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
        trackGroup.remove(roadGroup);
        trackGroup.remove(prefabGroup);
        $("drawer").style.display = "none";
    }

    function toJSON() {
        return JSON.parse(JSON.stringify(design.data));
    }

    // the glb of the track: the road and the prefabs, the names of the parts say what they are. The parts are exported with their own
    // materials (not the colours of the surfaces) and without the data of the editor.
    async function exportGlb() {
        const saved = [];
        [roadGroup, prefabGroup].forEach((g) => g.traverse((m) => {
            if (!m.isMesh) return;
            saved.push({ mesh: m, material: m.material, userData: m.userData });
            m.material = (m.userData && m.userData.original) || m.material;
            m.userData = {};
        }));
        try {
            const exporter = new GLTFExporter();
            return await exporter.parseAsync([roadGroup, prefabGroup], { binary: true });
        } finally {
            saved.forEach((s) => { s.mesh.material = s.material; s.mesh.userData = s.userData; });
        }
    }

    return {
        enable, disable, toJSON, exportGlb,
        active: () => !!design.data,
        roles: () => { const r = {}; roadGroup.children.forEach((m) => { r[m.name] = m.userData.role; }); prefabGroup.children.forEach((g) => { r[g.name] = state.roles[g.name]; }); return r; },
        hudText: (mode) => mode === "node" ? "Nodes: click on the ground to add one between the two nearest nodes, drag a node to move it, the arrow for its height. Delete removes it, Ctrl+Z undoes."
            : mode === "prefab" ? "Prefabs: click to put down a " + (PREFABS[design.prefabType] || PREFABS.wall).label.toLowerCase() + ", or drag a line to make a row of them. Drag one to move it (it sits on what is under it), the ring turns it, Delete removes it."
            : (design.data ? "Look: drag to turn, right mouse button to move, scroll to zoom. Nodes and prefabs can be dragged here too." : null)
    };
}
