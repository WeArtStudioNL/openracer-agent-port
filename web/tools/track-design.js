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
    const { scene, trackGroup, camera, renderer, controls, state, registerMesh, applyColours, renderParts, updateMarkers, status, $ } = api;
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
    gizmo.addEventListener("dragging-changed", (e) => { controls.enabled = !e.value; dragging = e.value; if (!e.value && gizmo.object && gizmo.object.userData.nodeIndex !== undefined) rebuild(true); });
    gizmo.addEventListener("objectChange", () => {
        const o = gizmo.object;
        if (!o) return;
        if (o.userData.nodeIndex !== undefined) {
            const n = design.data.nodes[o.userData.nodeIndex];
            n.x = round(o.position.x); n.y = round(o.position.y); n.z = round(o.position.z);
            fillNodeFields();
            scheduleRebuild();
        } else if (o.userData.prefab) {
            const p = o.userData.prefab;
            p.x = round(o.position.x); p.y = round(o.position.y); p.z = round(o.position.z);
            if (gizmo.mode === "rotate") p.rotation = round(o.rotation.y);
            fillPrefabFields();
        }
    });
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
        // the line through the nodes, when there are too few for a road
        if (design.data.nodes.length >= 2) {
            const curve = curveOf(design.data);
            const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(Math.max(64, design.data.nodes.length * 16)).map((p) => p.clone().setY(p.y + 0.3))),
                new THREE.LineBasicMaterial({ color: 0x4db8ff }));
            nodeGroup.add(line);
        }
        if (design.selectedNode >= 0 && nodeGroup.children[design.selectedNode]) {
            gizmo.attach(nodeGroup.children[design.selectedNode]);
            gizmo.setMode("translate");
            gizmo.enabled = true;
        }
    }

    function selectNode(i) {
        design.selectedNode = i;
        design.selectedPrefab = null;
        gizmo.detach();
        gizmo.enabled = false;
        renderNodes();
        fillNodeFields();
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
    }

    function deleteNode() {
        if (design.selectedNode < 0) return;
        design.data.nodes.splice(design.selectedNode, 1);
        design.selectedNode = Math.min(design.selectedNode, design.data.nodes.length - 1);
        rebuild();
        selectNode(design.selectedNode);
    }

    function fillNodeFields() {
        const n = design.selectedNode >= 0 ? design.data.nodes[design.selectedNode] : null;
        $("dsNodeBox").style.display = n ? "" : "none";
        $("dsNodeInfo").textContent = n ? "Node " + (design.selectedNode + 1) + " of " + design.data.nodes.length : "No node selected: click a node, or add one.";
        if (n) { $("dsHeight").value = n.y; $("dsNodeWidth").value = n.width; }
    }

    // ---- the prefabs
    function makePrefab(p, index) {
        const def = PREFABS[p.type] || PREFABS.wall;
        const g = def.make();
        g.position.set(p.x, p.y, p.z);
        g.rotation.y = p.rotation || 0;
        g.scale.setScalar(p.scale || 1);
        g.userData.prefab = p;
        g.name = "prefab_" + p.type + "_" + (index + 1);
        g.traverse((m) => { if (m.isMesh) { m.name = g.name; m.userData.role = def.role; } });
        return g;
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
        if (roadGroup.children.length) $("modelInfo").textContent = $("modelInfo").textContent.replace(/\d+ prefabs/, design.data.prefabs.length + " prefabs");
    }

    function addPrefab(x, y, z) {
        const p = { type: design.prefabType, x: round(x), y: round(y), z: round(z), rotation: 0, scale: 1 };
        design.data.prefabs.push(p);
        rebuildPrefabs();
        selectPrefab(design.data.prefabs.length - 1);
    }

    function selectPrefab(i) {
        design.selectedNode = -1;
        design.selectedPrefab = i;
        gizmo.detach();
        renderNodes();
        const g = prefabGroup.children[i];
        if (g) { gizmo.attach(g); gizmo.setMode($("dsRotate").checked ? "rotate" : "translate"); gizmo.enabled = true; }
        fillNodeFields();
        fillPrefabFields();
        renderPrefabList();
    }

    function deletePrefab() {
        if (design.selectedPrefab === null) return;
        design.data.prefabs.splice(design.selectedPrefab, 1);
        design.selectedPrefab = null;
        gizmo.detach();
        rebuildPrefabs();
        fillPrefabFields();
    }

    function fillPrefabFields() {
        const p = design.selectedPrefab !== null ? design.data.prefabs[design.selectedPrefab] : null;
        $("dsPrefabBox").style.display = p ? "" : "none";
        if (p) { $("dsPrefabRotation").value = Math.round((p.rotation || 0) * 180 / Math.PI); $("dsPrefabScale").value = p.scale || 1; $("dsPrefabName").textContent = (PREFABS[p.type] || PREFABS.wall).label; }
    }

    function renderPrefabList() {
        const list = $("dsPalette");
        list.innerHTML = "";
        Object.entries(PREFABS).forEach(([type, def]) => {
            const b = document.createElement("button");
            b.className = "small" + (type === design.prefabType ? " active" : "");
            b.innerHTML = "<span class='icon'>" + def.icon + "</span> " + def.label;
            b.onclick = () => { design.prefabType = type; renderPrefabList(); api.setMode("prefab"); };
            list.appendChild(b);
        });
    }

    // ---- pointer: adding nodes and prefabs, and picking them
    function pointerRay(event) {
        const rect = renderer.domElement.getBoundingClientRect();
        raycaster.setFromCamera(new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1), camera);
        return raycaster;
    }
    function groundPoint(event) {
        const ray = pointerRay(event);
        const hits = ray.intersectObjects(roadGroup.children, true);
        if (hits.length) return hits[0].point;
        const plane = ray.intersectObject(pickPlane);
        return plane.length ? plane[0].point : null;
    }
    let down = null;
    renderer.domElement.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; });
    renderer.domElement.addEventListener("pointerup", (e) => {
        if (!design.data || !down || dragging || e.button !== 0) { down = null; return; }
        const moved = Math.abs(e.clientX - down[0]) + Math.abs(e.clientY - down[1]) > 4;
        down = null;
        if (moved) return;
        const mode = api.getMode();
        const ray = pointerRay(e);
        // a node marker or a prefab under the pointer is selected in any design mode
        const nodeHit = ray.intersectObjects(nodeGroup.children.filter((o) => o.isMesh), false)[0];
        if (nodeHit && (mode === "node" || mode === "view")) { selectNode(nodeHit.object.userData.nodeIndex); return; }
        const prefabHit = ray.intersectObjects(prefabGroup.children, true)[0];
        if (prefabHit && (mode === "prefab" || mode === "view")) {
            let g = prefabHit.object;
            while (g.parent && g.parent !== prefabGroup) g = g.parent;
            selectPrefab(prefabGroup.children.indexOf(g));
            return;
        }
        if (mode === "node") {
            const p = groundPoint(e);
            if (p) addNode(p.x, p.z);
        } else if (mode === "prefab") {
            const p = groundPoint(e);
            if (p) addPrefab(p.x, p.y, p.z);
        }
    });
    window.addEventListener("keydown", (e) => {
        if (!design.data || e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;
        if (e.key === "Delete" || e.key === "Backspace") { if (design.selectedPrefab !== null) deletePrefab(); else if (design.selectedNode >= 0 && design.data.nodes.length > 3) deleteNode(); }
        if (e.key === "Escape") { design.selectedNode = -1; design.selectedPrefab = null; gizmo.detach(); renderNodes(); fillNodeFields(); fillPrefabFields(); }
        if ((e.key === "r" || e.key === "R") && design.selectedPrefab !== null) { $("dsRotate").checked = !$("dsRotate").checked; gizmo.setMode($("dsRotate").checked ? "rotate" : "translate"); }
    });

    // ---- the drawer
    $("dsHeight").addEventListener("input", () => { if (design.selectedNode >= 0) { design.data.nodes[design.selectedNode].y = parseFloat($("dsHeight").value) || 0; scheduleRebuild(); } });
    $("dsNodeWidth").addEventListener("input", () => { if (design.selectedNode >= 0) { design.data.nodes[design.selectedNode].width = Math.max(3, parseFloat($("dsNodeWidth").value) || 12); scheduleRebuild(); } });
    $("dsWidth").addEventListener("change", () => { if (!design.data) return; const w = Math.max(3, parseFloat($("dsWidth").value) || 12); design.data.nodes.forEach((n) => { n.width = w; }); rebuild(); fillNodeFields(); });
    $("dsClosed").addEventListener("change", () => { if (design.data) { design.data.closed = $("dsClosed").checked; rebuild(); } });
    $("dsFlatten").onclick = () => { if (design.data) { design.data.nodes.forEach((n) => { n.y = 0; }); rebuild(); fillNodeFields(); } };
    $("dsDeleteNode").onclick = deleteNode;
    $("dsAddNode").onclick = () => api.setMode("node");
    $("dsDeletePrefab").onclick = deletePrefab;
    $("dsPrefabRotation").addEventListener("input", () => { const p = design.data.prefabs[design.selectedPrefab]; if (p) { p.rotation = (parseFloat($("dsPrefabRotation").value) || 0) * Math.PI / 180; prefabGroup.children[design.selectedPrefab].rotation.y = p.rotation; } });
    $("dsPrefabScale").addEventListener("input", () => { const p = design.data.prefabs[design.selectedPrefab]; if (p) { p.scale = Math.max(0.1, parseFloat($("dsPrefabScale").value) || 1); prefabGroup.children[design.selectedPrefab].scale.setScalar(p.scale); } });
    $("dsRotate").addEventListener("change", () => { if (gizmo.object && gizmo.object.userData.prefab) gizmo.setMode($("dsRotate").checked ? "rotate" : "translate"); });
    $("dsDuplicate").onclick = () => {
        const p = design.selectedPrefab !== null ? design.data.prefabs[design.selectedPrefab] : null;
        if (!p) return;
        design.data.prefabs.push(Object.assign({}, p, { x: p.x + 4 * Math.cos(p.rotation || 0), z: p.z + 4 * Math.sin(p.rotation || 0) }));
        rebuildPrefabs();
        selectPrefab(design.data.prefabs.length - 1);
    };
    document.querySelectorAll("#drawer .tab").forEach((b) => b.addEventListener("click", () => {
        document.querySelectorAll("#drawer .tab").forEach((t) => t.classList.toggle("active", t === b));
        document.querySelectorAll("#drawer .page").forEach((p) => { p.style.display = p.dataset.page === b.dataset.tab ? "" : "none"; });
    }));
    $("drawerToggle").onclick = () => $("drawer").classList.toggle("collapsed");

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
        rebuild();
        rebuildPrefabs();
        fillNodeFields();
        fillPrefabFields();
        api.frameTrack();
    }

    function disable() {
        design.data = null;
        gizmo.detach();
        gizmo.enabled = false;
        nodeGroup.clear();
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
        hudText: (mode) => mode === "node" ? "Add node: click on the ground to add a node between the two nearest nodes; drag the arrows to move a node. Delete removes it."
            : mode === "prefab" ? "Place prefab: click on the ground to put down a " + (PREFABS[design.prefabType] || PREFABS.wall).label.toLowerCase() + "; drag the arrows to move it, R turns the gizmo to rotation, Delete removes it."
            : null
    };
}
