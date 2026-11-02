/*
 * track-editor.js
 *
 * Description: A tool in the browser to make tracks for OpenRacer: import a glTF or glb model (for example from Blender), say what every part
 *              of it is made of (road, grass, scenery, ...), put the start and the lap gates on the road and save it as tracks/<id>/
 *              (track.json and the model files). The game finds the track by itself. Tracks of the old format (a JSON geometry and scene file)
 *              can be opened to change their start, gates, name and description. Saving needs tools/serve.py (start-server.sh).
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { installZoomToMouse } from "./zoom-to-mouse.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { createDesign, PREFAB_TYPES, prefabGlb, prefabReady } from "./track-design.js";
import { buildTerrain, readHeights } from "./heightmap.js";

const $ = (id) => document.getElementById(id);
const ROLES = [["road", "Road"], ["track01", "Pit lane"], ["grass", "Grass"], ["ground", "Ground"], ["sand", "Sand"], ["gravel", "Gravel"], ["mud", "Mud"], ["scenery", "Scenery"], ["decor", "Decor"]];
const ROLE_COLORS = { road: 0x8a93a1, track01: 0xc2a672, grass: 0x4f9b45, ground: 0x9a7a4e, sand: 0xe0c27a, gravel: 0x9b9a93, mud: 0x5b432b, scenery: 0xc45d5d, decor: 0x6c8cd5 };
const DRIVABLE = { road: true, track01: true, grass: true, ground: true, sand: true, gravel: true, mud: true };
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/;

const state = {
    files: new Map(),     // name -> File, the files that were picked
    mainFile: null,       // name of the glb or gltf among them
    existingId: null,     // the id of the track that is being edited
    existingTrack: null,  // its configuration as it was loaded
    tracks: [],
    root: null,           // the model in the view
    parts: new Map(),     // name of a part -> the meshes with that name
    roles: {},            // name of a part -> role
    selected: null,       // name of the selected part
    start: null,          // { x, y, z, heading }: box 1 of the grid (kept for the gates and the line; track.json "start")
    grid: [],             // the start grid: up to eight boxes [{ x, y, z, heading }], box 1 the player, 2 to 8 the opponents (track.json "grid")
    pit: null,            // the older pit area: { points: [{ x, y, z }] }, a polygon on the ground (track.json "pit": { "polygon": [[x, z], ...] }); it is kept as it is, no longer drawn by hand
    pitLine: [],          // the path of the AI through the pit lane: [{ x, y, z }] in the order that a car drives (track.json "pit": { "line": [[x, z], ...] })
    pitBoxes: [],         // the pit boxes: [{ x, y, z, heading }], one for every player (track.json "pit": { "boxes": [{ x, z, heading }] }); 4 m by 8 m
    gates: [],            // [{ x, y, z, heading, width }]
    cameras: [],          // the cinematic cameras of the replay: [{ x, y, z, range: { x, z, r } }] (y is the height in the world; range: the circle on the floor where the camera is used, set by hand or not)
    camSel: -1,           // the chosen camera
    camRange: false,      // the range of the chosen camera is being changed
    drag: null,           // the drag strip: { x, y, z, heading, width, length } (the start line and the way the strip goes)
    mode: "view",
    markerScale: 1,
    env: OpenRacer.environmentDefaults(),
    envOn: true,
    skyFile: null,        // a sky picture that was picked
    skyName: "",          // the sky picture of the track (in its folder)
    oldSkyName: "",
    legacy: false,        // the track is of the old format
    idEdited: false
};

// ---- the 3D view

const view = $("view");
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));       // (an iPad is 2: a quarter less to draw, and the editor needs no more)
view.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x20262f);
const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 20000);
camera.position.set(0, 120, 160);
const controls = new OrbitControls(camera, renderer.domElement);
controls.update();
const hemi = new THREE.HemisphereLight(0xffffff, 0x556070, 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(50, 120, 80);
scene.add(sun);
let sky = null;
const trackGroup = new THREE.Group();
scene.add(trackGroup);
const markers = new THREE.Group(); // the start and the gates
scene.add(markers);
const objectLayer = new THREE.Group(); // the models of the objects, where they are placed
scene.add(objectLayer);
// the wheel zooms towards the point under the mouse (the track, its objects, else the floor), and that point is at once what the view turns about (zoom-to-mouse.js)
installZoomToMouse({ THREE, camera, controls, renderer, targets: () => [trackGroup, objectLayer], floorY: () => 0, orbitAtPoint: true });
// the objects of the track: models (glb) that were added, and where they stand. A model: { file (a Blob, when it was added now), name (the file in the folder of the track),
// kind (rigid, static or decor), mass (kg, 0: from its size), scene (the loaded model) }
const objectState = { models: new Map(), list: [], selected: null };
const library = { items: [] };                       // the library of models, the same for every track (objects/objects.json: [{ id, name, file, thumb, kind, mass }])
const gateUi = { selected: -1, dragging: false, width0: 24 };           // the gate that is chosen (the layers panel, a click in the view): its gizmo moves, turns and widens it
const raycaster = new THREE.Raycaster();
let editorReady = false;                                                 // (set at the end of this file: what is defined further down is there)
const boxSel = { kind: null, i: -1, dragging: false };                  // a box of the grid ("grid") or of the pit ("pit") that is chosen: the gizmo moves and turns it
const undoState = { past: [], future: [], last: null, busy: false };      // the undo of the whole editor (see "undo and redo" below)
const measureState = { points: [] };                                    // the points of the measure tool
const boxTarget = new THREE.Object3D();
scene.add(boxTarget);
const boxGizmo = new TransformControls(camera, renderer.domElement);
boxGizmo.setSize(0.9);
boxGizmo.showY = false;
scene.add(typeof boxGizmo.getHelper === "function" ? boxGizmo.getHelper() : boxGizmo);
// the meshes and materials of markers that are made again at every change are freed (they were never: the memory of the GPU grew during a session). The arrows share
// their geometry, and a sprite too: only their materials go.
function disposeTree(group) {
    group.traverse((o) => {
        const shared = o.isSprite || (o.parent && o.parent.type === "ArrowHelper");
        if (o.geometry && !shared) o.geometry.dispose();
        if (o.material) [].concat(o.material).forEach((m) => { if (m.map && o.isSprite) m.map.dispose(); m.dispose(); });
    });
    group.clear();
}
// the markers drawn again once per frame while a gizmo is dragged (each step of a drag drew all of them)
let markersQueued = false;
function scheduleMarkers() {
    if (markersQueued) return;
    markersQueued = true;
    requestAnimationFrame(() => { markersQueued = false; updateMarkers(); });
}

// ---- the cinematic cameras: a click chooses one, a gizmo moves it, and the button above it changes its range (a circle on the floor: the middle moves it, the node on the edge sets the radius)
const camTarget = new THREE.Object3D();
scene.add(camTarget);
const camGizmo = new TransformControls(camera, renderer.domElement);
camGizmo.setSize(0.8);
camGizmo.addEventListener("dragging-changed", (event) => { controls.enabled = !event.value; });
camGizmo.addEventListener("objectChange", () => {
    const c = state.cameras[state.camSel];
    if (!c) return;
    c.x = camTarget.position.x; c.y = camTarget.position.y; c.z = camTarget.position.z;
    scheduleMarkers();
});
scene.add(typeof camGizmo.getHelper === "function" ? camGizmo.getHelper() : camGizmo);
const DEFAULT_RANGE = 30;
function rangeOf(c) { return c.range || { x: c.x, z: c.z, r: DEFAULT_RANGE }; }
function selectCamera(i, rangeMode) {
    if (i >= 0) clearSelection("camera");
    state.camSel = i >= 0 && state.cameras[i] ? i : -1;
    state.camRange = state.camSel >= 0 && !!rangeMode;
    camGizmo.detach();
    if (state.camSel >= 0 && !state.camRange) {
        const c = state.cameras[state.camSel];
        camTarget.position.set(c.x, c.y, c.z);
        camGizmo.attach(camTarget);
    }
    updateMarkers();
}
const rangeRings = new Map();      // the heights of the floor along a circle, kept (the floor is looked up with rays)
function rangePoints(x, z, r) {
    const key = x.toFixed(1) + "," + z.toFixed(1) + "," + r.toFixed(1);
    if (rangeRings.has(key)) return rangeRings.get(key);
    const points = [];
    for (let i = 0; i <= 64; i++) {
        const a = i / 64 * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        points.push(new THREE.Vector3(px, groundY(px, pz, groundY(x, z)) + 0.5, pz));
    }
    if (rangeRings.size > 400) rangeRings.clear();
    rangeRings.set(key, points);
    return points;
}
const camIcons = document.createElement("div");
camIcons.style.cssText = "position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; overflow: hidden;";
view.appendChild(camIcons);
const iconVector = new THREE.Vector3();
function positionCamIcons() {
    const rect = renderer.domElement.getBoundingClientRect(), box = view.getBoundingClientRect();
    [...camIcons.children].forEach((button) => {
        const c = state.cameras[button.dataset.camera];
        if (!c) return;
        iconVector.set(c.x, c.y + 1.6 * state.markerScale, c.z).project(camera);
        const visible = iconVector.z < 1 && iconVector.z > -1;
        button.style.display = visible ? "" : "none";
        button.style.left = (rect.left - box.left + (iconVector.x * 0.5 + 0.5) * rect.width) + "px";
        button.style.top = (rect.top - box.top + (-iconVector.y * 0.5 + 0.5) * rect.height) + "px";
    });
}

// ---- the layers of the events (the drag strip): chosen in the list, it shows a gizmo with arrows for the place and a circle for the direction
const eventLayers = { selected: null, dragging: false };
const dragTarget = new THREE.Object3D();
scene.add(dragTarget);
const moveGizmo = new TransformControls(camera, renderer.domElement);
moveGizmo.setSize(0.9);
const turnGizmo = new TransformControls(camera, renderer.domElement);
turnGizmo.setMode("rotate");
turnGizmo.setSpace("world");
turnGizmo.setSize(0.8);
turnGizmo.showX = false; turnGizmo.showZ = false;       // the strip only turns about the vertical
[moveGizmo, turnGizmo].forEach((g) => {
    g.addEventListener("dragging-changed", (event) => { controls.enabled = !event.value; eventLayers.dragging = event.value; if (!event.value) updateMarkers(); });
    g.addEventListener("objectChange", () => dragGizmoMoved());
    scene.add(typeof g.getHelper === "function" ? g.getHelper() : g);
});
function dragGizmoMoved() {
    if (!state.drag) return;
    state.drag.x = dragTarget.position.x; state.drag.y = dragTarget.position.y; state.drag.z = dragTarget.position.z;
    state.drag.heading = -dragTarget.rotation.y;          // (the heading goes from +x towards +z, a turn about y goes the other way)
    scheduleMarkers();
}
function selectEvent(id) {
    eventLayers.selected = eventLayers.selected === id ? null : id;
    if (eventLayers.selected) clearSelection("drag");
    moveGizmo.detach(); turnGizmo.detach();
    if (eventLayers.selected === "drag" && state.drag) {
        syncDragTarget();
        moveGizmo.attach(dragTarget); turnGizmo.attach(dragTarget);
    } else eventLayers.selected = null;
    renderEventLayers();
}
function syncDragTarget() {
    if (!state.drag || eventLayers.dragging) return;
    dragTarget.position.set(state.drag.x, state.drag.y, state.drag.z);
    dragTarget.rotation.set(0, -state.drag.heading, 0);
}
function renderEventLayers() {
    const list = $("eventList");
    list.innerHTML = "";
    const row = document.createElement("div");
    row.className = "layer" + (eventLayers.selected === "drag" ? " selected" : "") + (state.drag ? "" : " dim");
    row.innerHTML = "<i></i><span>Drag strip</span><span class=\"meta\">" + (state.drag ? Math.round(state.drag.length) + " m" : "none") + "</span>";
    row.title = state.drag ? "Choose it to move it (arrows) and turn it (circle)" : "Place it with the Drag strip tool first";
    row.addEventListener("click", () => { if (state.drag) selectEvent("drag"); });
    list.appendChild(row);
}

// ---- the AI racing line: drawn in the view when the track has one, and edited with nodes (Edit the line): click a node to take it, move it with the arrows of the gizmo (across the
// road only: the height follows the road), Shift + click on the road adds a node on the nearest part of the line, Delete takes the chosen node away; Apply saves the line (a smooth curve
// through the nodes, a point every 2 m), Cancel keeps what it was
const lineLayer = new THREE.Group();
scene.add(lineLayer);
const lineEdit = { editing: false, nodes: [], selected: -1, dragging: false, show: true, drawing: false };
const lineTarget = new THREE.Object3D();
scene.add(lineTarget);
const lineGizmo = new TransformControls(camera, renderer.domElement);
lineGizmo.setSize(0.8);
lineGizmo.showY = false;                                   // the position only, over the road; no turning
lineGizmo.addEventListener("dragging-changed", (event) => { controls.enabled = !event.value; lineEdit.dragging = event.value; if (!event.value) drawLine(); });
lineGizmo.addEventListener("objectChange", () => {
    const n = lineEdit.nodes[lineEdit.selected];
    if (!n) return;
    n.x = lineTarget.position.x; n.z = lineTarget.position.z;
    n.y = groundY(n.x, n.z, n.y);
    drawLine(true);
});
scene.add(typeof lineGizmo.getHelper === "function" ? lineGizmo.getHelper() : lineGizmo);

// the points of the recorded line, or of the middle of a designed track, as the nodes to edit: about 8 m apart
function lineNodesFrom(points, spacing) {
    const nodes = [];
    let last = null;
    points.forEach((p) => {
        if (!last || Math.hypot(p.x - last.x, p.z - last.z) >= spacing) { nodes.push({ x: p.x, y: p.y || 0, z: p.z }); last = p; }
    });
    if (nodes.length > 3 && Math.hypot(nodes[0].x - nodes[nodes.length - 1].x, nodes[0].z - nodes[nodes.length - 1].z) < spacing * 0.6) nodes.pop();      // (the loop closes by itself)
    return nodes;
}
function lineCurve(nodes) {
    return new THREE.CatmullRomCurve3(nodes.map((n) => new THREE.Vector3(n.x, n.y, n.z)), true, "centripetal", 0.5);
}
function lineSourcePoints() {
    const track = state.existingTrack;
    if (track && track.racing_line && track.racing_line.length > 10) return track.racing_line;
    if (design && design.active()) {
        const nodes = design.toJSON().nodes;
        if (nodes && nodes.length >= 3) return lineCurve(nodes).getSpacedPoints(Math.max(32, Math.round(lineCurve(nodes).getLength() / 2))).map((v) => ({ x: v.x, y: v.y, z: v.z }));
    }
    return null;
}

function drawLine(keepNodes) {
    disposeTree(lineLayer);
    const track = state.existingTrack;
    let points = null;
    if (lineEdit.editing && lineEdit.nodes.length >= 3) {
        const curve = lineCurve(lineEdit.nodes);
        points = curve.getSpacedPoints(Math.max(32, Math.round(curve.getLength() / 2)));
    } else if (lineEdit.editing && lineEdit.nodes.length >= 2) {
        points = lineEdit.nodes.map((n) => new THREE.Vector3(n.x, n.y, n.z));              // (the first nodes of a line that is drawn: a line from one to the next, not yet a loop)
    } else if (lineEdit.show && !lineEdit.editing && track && track.racing_line && track.racing_line.length > 10) {
        points = track.racing_line.map((p) => new THREE.Vector3(p.x, p.y || 0, p.z));
        points.push(points[0].clone());
    }
    if (!points) { renderLineButtons(); return; }
    const lift = 0.5;
    const geometry = new THREE.BufferGeometry().setFromPoints(points.map((v) => new THREE.Vector3(v.x, v.y + lift, v.z)));
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: lineEdit.editing ? 0x4db8ff : 0xffd04d, depthTest: false, transparent: true }));
    line.renderOrder = 999;
    lineLayer.add(line);
    // a few arrows: the direction of the line
    const step = Math.max(1, Math.floor(points.length / 24));
    for (let i = 0; i + 1 < points.length; i += step) {
        const a = points[i], b = points[i + 1];
        const arrow = screenSize(makeArrow(a.x, a.y, a.z, Math.atan2(b.z - a.z, b.x - a.x), lineEdit.editing ? 0x4db8ff : 0xffd04d, 3 * state.markerScale), 34, 3 * state.markerScale);
        arrow.traverse((o) => { if (o.material) { o.material.depthTest = false; o.renderOrder = 999; } });
        lineLayer.add(arrow);
    }
    if (lineEdit.editing) {
        const radius = 0.9 * state.markerScale;
        lineEdit.nodes.forEach((n, i) => {
            const ball = new THREE.Mesh(new THREE.SphereGeometry(radius, 14, 10), new THREE.MeshBasicMaterial({ color: i === lineEdit.selected ? 0xff8a3d : (i === 0 ? 0x4ed88a : 0xffffff), depthTest: false, transparent: true }));
            ball.position.set(n.x, n.y + lift + radius * 0.5, n.z);
            ball.renderOrder = 1000;
            ball.userData.lineNode = i;
            screenSize(ball, 8, radius);
            lineLayer.add(ball);
        });
    }
    renderLineButtons();
}

function selectLineNode(i) {
    if (i >= 0) clearSelection("line");
    lineEdit.selected = i;
    lineGizmo.detach();
    if (i >= 0 && lineEdit.nodes[i]) {
        lineTarget.position.set(lineEdit.nodes[i].x, lineEdit.nodes[i].y, lineEdit.nodes[i].z);
        lineGizmo.attach(lineTarget);
    }
    drawLine();
}
function startLineEdit() {
    const points = lineSourcePoints();
    if (!points) { status("There is no line to edit: record one, or draw the track with nodes.", "error"); return; }
    lineEdit.nodes = lineNodesFrom(points, 8);
    if (lineEdit.nodes.length < 4) { status("The line is too short to edit.", "error"); return; }
    lineEdit.editing = true; lineEdit.show = true;
    lineEdit.start = JSON.stringify(lineEdit.nodes);
    selectLineNode(-1);
    status("Editing the line: click a node, move it with the arrows. Shift + click on the road adds a node, Delete takes the chosen one away.", "ok");
}
// a new line, drawn node by node: click on the road in the direction that the AI drives
function startLineDraw() {
    lineEdit.nodes = [];
    lineEdit.editing = true; lineEdit.show = true; lineEdit.drawing = true;
    lineEdit.start = "[]";
    selectLineNode(-1);
    status("Draw the line: click on the road, node after node, in the direction that the AI drives, all the way round (four at least). The line closes itself. Apply line saves it.", "ok");
}
function undoLineNode() {
    if (!lineEdit.nodes.length) return;
    lineEdit.nodes.pop();
    selectLineNode(-1);
}
// the line was changed since Edit the line or Draw the line (and not applied)
function lineChanged() { return lineEdit.editing && JSON.stringify(lineEdit.nodes) !== lineEdit.start; }
// Cancel and Escape: a line that was changed goes only after a question
async function cancelLineEdit() {
    if (lineChanged() && !(await OpenRacerDialog.ask({ title: "Throw away the changes of the line?", text: "The nodes are back as they were; the saved line stays.", ok: "Throw away", danger: true }))) return;
    stopLineEdit();
}
function stopLineEdit() {
    lineEdit.editing = false; lineEdit.drawing = false; lineEdit.nodes = []; lineEdit.selected = -1;
    lineGizmo.detach();
    drawLine();
}
function addLineNodeAt(x, z) {
    // on the nearest part of the line between two nodes
    const nodes = lineEdit.nodes;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i], b = nodes[(i + 1) % nodes.length];
        const dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2));
        const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
        if (d < bestD) { bestD = d; best = i; }
    }
    nodes.splice(best + 1, 0, { x, y: groundY(x, z, nodes[best].y), z });
    selectLineNode(best + 1);
}
function deleteLineNode() {
    if (lineEdit.drawing && lineEdit.selected >= 0) { lineEdit.nodes.splice(lineEdit.selected, 1); selectLineNode(-1); return; }
    if (lineEdit.selected < 0 || lineEdit.nodes.length <= 4) { if (lineEdit.nodes.length <= 4) status("A line needs at least four nodes.", "error"); return; }
    lineEdit.nodes.splice(lineEdit.selected, 1);
    selectLineNode(-1);
}
async function applyLineEdit() {
    const track = state.existingTrack;
    if (!track || !state.existingId) { status("Save the track first: the line is saved on the saved track.", "error"); return; }
    if (lineEdit.nodes.length < 4) { status("A line needs at least four nodes (there are " + lineEdit.nodes.length + ").", "error"); return; }
    const curve = lineCurve(lineEdit.nodes);
    const count = Math.max(32, Math.round(curve.getLength() / 2));
    const line = curve.getSpacedPoints(count).slice(0, count).map((v) => ({ x: Math.round(v.x * 100) / 100, y: Math.round(groundY(v.x, v.z, v.y) * 100) / 100, z: Math.round(v.z * 100) / 100 }));
    const config = JSON.parse(JSON.stringify(track));
    delete config.id;
    config.racing_line = line;
    config.line_date = new Date().toISOString();       // (a best lap driven before is no longer the line of the AI: Records.anyGhost)
    try {
        await store(track.id, config);
        track.racing_line = line;
        track.line_date = config.line_date;
        stopLineEdit();
        updateLineNote();
        status("The line is saved (" + line.length + " points): the AI drives it from the next start.", "ok");
    } catch (error) {
        status(error.message, "error");
    }
}
function renderLineButtons() {
    const edit = $("editLine");
    if (!edit) return;
    const hasLine = !!lineSourcePoints();
    edit.style.display = lineEdit.editing ? "none" : "";
    edit.disabled = !hasLine;
    $("drawLine").style.display = lineEdit.editing ? "none" : "";
    $("undoLineNode").style.display = lineEdit.editing && lineEdit.drawing ? "" : "none";
    for (const id of ["addLineNode", "deleteLineNode", "applyLine", "cancelLine"]) $(id).style.display = lineEdit.editing ? "" : "none";
    $("deleteLineNode").disabled = lineEdit.selected < 0;
    $("showLine").parentElement.style.display = lineEdit.editing ? "none" : "";
}

// ---- the curbs (Curbs.js). Draw curb: a click on the road starts a curb, and every next click adds a node at the end that is nearest to it; Enter ends the curb
// (the next click starts a new one). A curb that is chosen (in Look too): drag a node to move it over the surface (it sticks to what is under it), click on the
// strip to add a node there, Delete takes the chosen node away (the nodes beside it are joined; without nodes the curb is gone). The size of a node (0 to 1.5)
// makes the curb smaller there: a small size at an end makes it taper off. track.json "curbs": [{ nodes, width, height, colour, points }]
const curbLayer = new THREE.Group();           // the strips: in the thumbnail as the track
scene.add(curbLayer);
const curbNodeLayer = new THREE.Group();       // the nodes
scene.add(curbNodeLayer);
const curbState = { list: [], selected: -1, node: -1, drawing: false, dragging: false };
const curbMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0 });

function curbSettings() {
    const d = OpenRacer.CURB_DEFAULTS;
    return { width: Math.max(0.3, Math.min(4, parseFloat($("curbWidth").value) || d.width)), height: Math.max(0, Math.min(0.3, parseFloat($("curbHeight").value))) || 0, colour: $("curbColour").value || d.colour };
}
// the strip of one curb, made again from its nodes (the ground under it from the grid of the surfaces: fast, see groundY)
function buildCurb(i) {
    const c = curbState.list[i];
    if (!c) return;
    if (c.mesh) { curbLayer.remove(c.mesh); c.mesh.geometry.dispose(); c.mesh = null; }
    c.points = c.nodes.length >= 2 ? OpenRacer.curbPoints(THREE, c, groundY) : [];
    c.segments = c.nodes.length >= 2 ? OpenRacer.curbLine(THREE, c.nodes).map((q) => q.segment) : [];
    const geometry = OpenRacer.curbGeometry(THREE, c);
    if (!geometry) return;
    c.mesh = new THREE.Mesh(geometry, curbMaterial);
    c.mesh.userData.curbIndex = i;
    curbLayer.add(c.mesh);
    curbsChanged();
}
// the surfaces that connect to the road follow the curbs (not while a node is dragged, nor while all the curbs are made again)
function curbsChanged() {
    if (curbState.dragging || curbState.bulk) return;
    try { if (design.active()) design.curbsChanged(); } catch (e) { /* (the designer is made further down: not yet) */ }
}
// while a node is dragged: the strip once per frame
// Connect to road: the nodes of the curb lie on the edge of the road (the track or a branch), each a distance off it (node[4], in metres, away from the road
// when it is more than 0: the curb is then beside the road, less than 0 on it), and they follow the road when it is changed. Only for a designed track.
const curbOffset = (n) => (Number.isFinite(n[4]) ? n[4] : 0);
function setCurbOffset(n, offset) {
    const size = OpenRacer.curbSize(n), value = +Math.max(-6, Math.min(6, offset)).toFixed(2);
    n.length = 3;
    if (Math.abs(value) > 1e-3) n.push(size, value); else if (Math.abs(size - 1) > 1e-3) n.push(size);
}
function snapCurbNode(n) {
    const e = design.active() ? design.roadEdgeAt(n[0], n[2]) : null;
    if (!e) return false;
    const off = curbOffset(n);
    n[0] = e.x + e.nx * off; n[2] = e.z + e.nz * off; n[1] = groundY(n[0], n[2], n[1]);
    return true;
}
// a node that is put down on the road: its offset is where it is now, so that it stays there
function startCurbOffset(n) {
    const e = design.active() ? design.roadEdgeAt(n[0], n[2]) : null;
    if (e) setCurbOffset(n, (n[0] - e.x) * e.nx + (n[2] - e.z) * e.nz);
}
let curbQueued = -1;
function scheduleCurb(i) {
    if (curbQueued >= 0) return;
    curbQueued = i;
    requestAnimationFrame(() => { const k = curbQueued; curbQueued = -1; buildCurb(k); });
}
function curbLength(c) {
    let length = 0;
    for (let k = 1; k < (c.points || []).length; k++) length += Math.hypot(c.points[k][0] - c.points[k - 1][0], c.points[k][1] - c.points[k - 1][1]);
    return length;
}
function drawCurbs() {
    curbLayer.clear();
    curbState.bulk = true;
    curbState.list.forEach((c, i) => { c.mesh = null; buildCurb(i); });
    curbState.bulk = false;
    curbsChanged();
    drawCurbNodes();
}
// the nodes: of the chosen curb large (the chosen node orange, the first green), of the other curbs small, so that a click finds them
function drawCurbNodes() {
    disposeTree(curbNodeLayer);
    curbState.list.forEach((c, i) => {
        if (c.mesh) c.mesh.userData.curbIndex = i;
        const chosen = i === curbState.selected, radius = (chosen ? 0.6 : 0.4) * state.markerScale;
        c.nodes.forEach((n, k) => {
            const colour = chosen && k === curbState.node ? 0xff8a3d : (chosen ? (k === 0 ? 0x4ed88a : 0xffffff) : 0xff6a5a);
            const ball = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), new THREE.MeshBasicMaterial({ color: colour, depthTest: false, transparent: true }));
            ball.position.set(n[0], n[1] + 0.3 + radius * 0.5, n[2]);
            ball.renderOrder = 1000;
            ball.userData.curbNode = [i, k];
            screenSize(ball, chosen ? 8 : 5, radius);
            curbNodeLayer.add(ball);
        });
    });
    renderCurbs();
}
function selectCurb(i, node) {
    if (i >= 0) clearSelection("curb");
    curbState.selected = i >= 0 && curbState.list[i] ? i : -1;
    curbState.node = curbState.selected >= 0 && node >= 0 && node < curbState.list[curbState.selected].nodes.length ? node : -1;
    if (curbState.selected >= 0) {
        const c = curbState.list[curbState.selected];
        $("curbWidth").value = c.width; $("curbHeight").value = c.height; $("curbColour").value = c.colour; $("curbConnect").checked = !!c.connect;
    }
    drawCurbNodes();
    if (editorReady) updateContext();
}
// Draw curb: a click on the road. On the chosen curb's strip: a node there. Elsewhere: the next node at the end of the chosen curb that is nearest, or a new curb.
function curbClick(event) {
    const c = curbState.list[curbState.selected];
    const strip = curbStripHit(event);
    if (strip && strip.index === curbState.selected) { insertCurbNodeAt(strip.point); return; }
    if (strip) { selectCurb(strip.index, -1); return; }
    const road = roadHit(event);
    if (!road) return;
    const node = [road.point.x, groundY(road.point.x, road.point.z, road.point.y), road.point.z];
    const connect = c ? !!c.connect : $("curbConnect").checked && design.active();
    if (connect) startCurbOffset(node);
    if (!c) {
        curbState.list.push(Object.assign({ nodes: [node], points: [], segments: [], mesh: null }, curbSettings(), connect ? { connect: true } : {}));
        selectCurb(curbState.list.length - 1, 0);
        return;
    }
    const first = c.nodes[0], last = c.nodes[c.nodes.length - 1];
    const atStart = c.nodes.length >= 2 && Math.hypot(node[0] - first[0], node[2] - first[2]) < Math.hypot(node[0] - last[0], node[2] - last[2]);
    if (atStart) c.nodes.unshift(node); else c.nodes.push(node);
    buildCurb(curbState.selected);
    selectCurb(curbState.selected, atStart ? 0 : c.nodes.length - 1);
}
// the strip of a curb under the pointer, or within 10 pixels of its line (seen from far away a curb is a pixel wide): { index, point }, or null. The chosen
// curb first.
const stripVector = new THREE.Vector3();
function curbStripHit(event) {
    const hit = pointerRay(event).intersectObjects(curbLayer.children, false).find((h) => h.object.userData.curbIndex !== undefined);
    if (hit) return { index: hit.object.userData.curbIndex, point: hit.point };
    const rect = renderer.domElement.getBoundingClientRect(), mx = event.clientX - rect.left, my = event.clientY - rect.top;
    let best = null, bestD = 10;
    const order = curbState.list.map((c, i) => i).sort((a, b) => (b === curbState.selected) - (a === curbState.selected));
    for (const i of order) {
        (curbState.list[i].points || []).forEach((q) => {
            stripVector.set(q[0], q[3], q[1]).project(camera);
            if (stripVector.z > 1 || stripVector.z < -1) return;
            const d = Math.hypot((stripVector.x * 0.5 + 0.5) * rect.width - mx, (-stripVector.y * 0.5 + 0.5) * rect.height - my);
            if (d < bestD) { bestD = d; best = { index: i, point: new THREE.Vector3(q[0], q[3], q[1]) }; }
        });
        if (best && i === curbState.selected) break;
    }
    return best;
}
// a click on the strip of the chosen curb: a node there, between the two nodes of that piece (its size as the curb is there)
function insertCurbNodeAt(point) {
    const c = curbState.list[curbState.selected];
    if (!c || c.nodes.length < 2 || !c.points.length) return;
    let best = 0, bestD = Infinity;
    c.points.forEach((q, k) => { const d = Math.hypot(q[0] - point.x, q[1] - point.z); if (d < bestD) { bestD = d; best = k; } });
    const at = (c.segments[best] || 0) + 1, size = Number.isFinite(c.points[best][5]) ? c.points[best][5] : 1;
    const node = [point.x, groundY(point.x, point.z, point.y), point.z];
    if (Math.abs(size - 1) > 1e-3) node.push(+size.toFixed(2));
    if (c.connect) startCurbOffset(node);
    c.nodes.splice(at, 0, node);
    buildCurb(curbState.selected);
    selectCurb(curbState.selected, at);
}
// Enter: the curb is finished; the next click of Draw curb starts a new one
function endCurbDraw() {
    const c = curbState.list[curbState.selected];
    if (c && !c.nodes.length) removeCurb(curbState.selected);
}
// a node of a curb under the pointer: [curb, node], or null
function curbNodeHit(event) {
    const hit = pointerRay(event).intersectObjects(curbNodeLayer.children, false).find((h) => h.object.userData.curbNode);
    return hit ? hit.object.userData.curbNode : null;
}
var snapStep = 0;          // (the grid of the Snap button, in metres; 0 is off)
// where the pointer is on the surface, near the height y (a plane at that height, then the surface there, twice: it follows a slope)
function surfacePoint(event, y, rounds) {
    const ray = pointerRay(event).ray;
    let p = null, h = y;
    for (let k = 0; k < (rounds || 2); k++) {
        const q = ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -h), new THREE.Vector3());
        if (!q) break;
        if (snapStep) { q.x = Math.round(q.x / snapStep) * snapStep; q.z = Math.round(q.z / snapStep) * snapStep; }
        h = groundY(q.x, q.z, h + 20);
        p = new THREE.Vector3(q.x, h, q.z);
    }
    return p;
}
// Delete: the chosen node goes, the nodes on either side of it are joined; the last node takes the curb with it
function deleteCurbNode() {
    const c = curbState.list[curbState.selected];
    if (!c || curbState.node < 0) return false;
    c.nodes.splice(curbState.node, 1);
    if (!c.nodes.length) { removeCurb(curbState.selected); status("The curb had no nodes left and is gone.", "ok"); return true; }
    buildCurb(curbState.selected);
    selectCurb(curbState.selected, Math.min(curbState.node, c.nodes.length - 1));
    return true;
}
function removeCurb(i) {
    const c = curbState.list[i];
    if (!c) return;
    if (c.mesh) { curbLayer.remove(c.mesh); c.mesh.geometry.dispose(); }
    curbState.list.splice(i, 1);
    selectCurb(-1);
}
function resetCurbs(curbs) {
    curbState.list = (Array.isArray(curbs) ? curbs : []).filter((c) => c && Array.isArray(c.nodes)).map((c) => ({
        nodes: c.nodes.filter((n) => Array.isArray(n) && Number.isFinite(n[0]) && Number.isFinite(n[2])).map((n) => {
            const node = [n[0], groundY(n[0], n[2], Number.isFinite(n[1]) ? n[1] : undefined), n[2]];
            if (c.connect && Number.isFinite(n[4]) && Math.abs(n[4]) > 1e-3) node.push(OpenRacer.curbSize(n), n[4]);
            else if (Number.isFinite(n[3]) && Math.abs(n[3] - 1) > 1e-3) node.push(OpenRacer.curbSize(n));
            return node;
        }),
        width: c.width > 0 ? c.width : OpenRacer.CURB_DEFAULTS.width, height: c.height >= 0 ? c.height : OpenRacer.CURB_DEFAULTS.height,
        colour: OpenRacer.CURB_COLOURS[c.colour] ? c.colour : OpenRacer.CURB_DEFAULTS.colour, points: [], segments: [], mesh: null, ...(c.connect ? { connect: true } : {})
    })).filter((c) => c.nodes.length);
    curbState.selected = -1; curbState.node = -1;
    drawCurbs();
}
// as track.json keeps them (a curb of one node is not a curb yet: it is not saved)
function curbsJSON() {
    const r = (v) => Math.round(v * 1000) / 1000;
    return curbState.list.filter((c) => c.nodes.length >= 2).map((c) => ({
        nodes: c.nodes.map((n) => n.length > 4 ? [r(n[0]), r(n[1]), r(n[2]), r(n[3]), r(n[4])] : n.length > 3 ? [r(n[0]), r(n[1]), r(n[2]), r(n[3])] : [r(n[0]), r(n[1]), r(n[2])]), width: c.width, height: c.height, colour: c.colour,
        ...(c.connect ? { connect: true } : {}),
        points: c.points && c.points.length ? c.points : OpenRacer.curbPoints(THREE, c, groundY)
    }));
}
function renderCurbs() {
    const note = $("curbNote");
    if (note) note.textContent = curbState.list.length ? curbState.list.length + (curbState.list.length === 1 ? " curb" : " curbs") : "none";
    const c = curbState.list[curbState.selected];
    const info = $("curbInfo");
    if (info) info.textContent = c ? "Curb " + (curbState.selected + 1) + ": " + c.nodes.length + " nodes, " + Math.round(curbLength(c)) + " m" + (curbState.node >= 0 ? ", node " + (curbState.node + 1) + " chosen" : "")
        : state.mode === "curb" ? "Click on the road to start a curb." : "";
    // what goes with a chosen curb, and with a chosen node of it
    if ($("curbEdit")) $("curbEdit").style.display = c ? "" : "none";
    if ($("curbNodeBox")) {
        const n = c && c.nodes[curbState.node];
        $("curbNodeBox").style.display = n ? "" : "none";
        if (n && document.activeElement !== $("curbSize")) { $("curbSize").value = OpenRacer.curbSize(n); $("curbSizeValue").textContent = Math.round(OpenRacer.curbSize(n) * 100) + "%"; }
        $("curbOffsetBox").style.display = n && c.connect ? "" : "none";
        if (n && c.connect && document.activeElement !== $("curbOffset")) { $("curbOffset").value = curbOffset(n); $("curbOffsetValue").textContent = curbOffset(n).toFixed(2) + " m"; }
    }
    const list = $("curbLayers");
    if (!list) return;
    list.innerHTML = "";
    curbState.list.forEach((curb, i) => {
        const row = document.createElement("div");
        row.className = "layer" + (curbState.selected === i ? " selected" : "");
        row.innerHTML = "<i></i><span></span><span class=\"meta\"></span>";
        row.children[1].textContent = "Curb " + (i + 1);
        const length = curbLength(curb);
        row.children[2].textContent = curb.nodes.length + " nodes" + (length ? ", " + Math.round(length) + " m" : "");
        row.onclick = () => selectCurb(curbState.selected === i ? -1 : i, -1);
        list.appendChild(row);
    });
    if (!curbState.list.length) { const none = document.createElement("div"); none.style.cssText = "padding: 4px 14px; color: #66727f;"; none.textContent = "none drawn"; list.appendChild(none); }
}
// the width, the height and the colour: of the chosen curb, and of the next one that is drawn
["curbWidth", "curbHeight", "curbColour"].forEach((id) => $(id).addEventListener("change", () => {
    const c = curbState.list[curbState.selected];
    if (!c) return;
    Object.assign(c, curbSettings());
    buildCurb(curbState.selected);
    drawCurbNodes();
}));
// the size at the chosen node (and Taper the ends: the first and the last node small)
function setCurbSize(c, k, size) {
    const n = c.nodes[k];
    if (!n) return;
    const value = +Math.max(0, Math.min(1.5, size)).toFixed(2), off = curbOffset(n);
    n.length = 3;
    if (off) n.push(value, off); else if (Math.abs(value - 1) > 1e-3) n.push(value);
}
$("curbSize").addEventListener("input", () => {
    const c = curbState.list[curbState.selected];
    if (!c || curbState.node < 0) return;
    setCurbSize(c, curbState.node, parseFloat($("curbSize").value));
    $("curbSizeValue").textContent = Math.round(parseFloat($("curbSize").value) * 100) + "%";
    scheduleCurb(curbState.selected);
});
$("curbConnect").addEventListener("change", () => {
    const c = curbState.list[curbState.selected];
    if (!c) return;
    if ($("curbConnect").checked && !design.active()) { $("curbConnect").checked = false; status("Connect to road is for a track that is drawn with the road designer.", "warn"); return; }
    if ($("curbConnect").checked) { c.connect = true; c.nodes.forEach((n) => startCurbOffset(n)); }
    else { delete c.connect; c.nodes.forEach((n) => { const size = OpenRacer.curbSize(n); n.length = 3; if (Math.abs(size - 1) > 1e-3) n.push(size); }); }
    buildCurb(curbState.selected);
    drawCurbNodes();
});
$("curbOffset").addEventListener("input", () => {
    const c = curbState.list[curbState.selected], n = c && c.nodes[curbState.node];
    if (!c || !c.connect || !n) return;
    setCurbOffset(n, parseFloat($("curbOffset").value));
    snapCurbNode(n);
    $("curbOffsetValue").textContent = curbOffset(n).toFixed(2) + " m";
    buildCurb(curbState.selected);
    drawCurbNodes();
});
$("curbTaper").onclick = () => {
    const c = curbState.list[curbState.selected];
    if (!c || c.nodes.length < 2) return;
    setCurbSize(c, 0, 0.25); setCurbSize(c, c.nodes.length - 1, 0.25);
    buildCurb(curbState.selected); drawCurbNodes();
    status("Both ends of the curb taper off now (size 25%). Choose an end node to change it.", "ok");
};
$("curbDraw").onclick = () => { selectCurb(-1); setMode("curb"); };
$("curbDone").onclick = () => { endCurbDraw(); selectCurb(-1); };
$("curbDeleteNode").onclick = () => deleteCurbNode();
$("curbRemove").onclick = async () => {
    if (curbState.selected < 0) return;
    if (!(await OpenRacerDialog.ask({ title: "Remove curb " + (curbState.selected + 1) + "?", text: "With all its nodes.", ok: "Remove", danger: true }))) return;
    removeCurb(curbState.selected);
};
// ---- the reference image: a picture (a map, an aerial photo) lying flat in the view to draw a track over. Its opacity, its place (the gizmo or the fields), its turn
// and its width in metres; Scale by two points: click two places on the picture whose distance you know and type it, the picture is scaled about the first one.
// Saved with the track (track.json "reference": { image, x, y, z, width, rotation, opacity, show, top }, the picture in its folder as reference.<ext>); the game does not use it.
const REF_FILE = /^reference\.(png|jpe?g|webp)$/;
const refState = { file: null, name: "", oldName: "", url: "", x: 0, y: 0, z: 0, width: 500, aspect: 1, rotation: 0, opacity: 0.5, show: true, top: true, mesh: null, moving: false, scale: null };
const refGroup = new THREE.Group();
scene.add(refGroup);
const refMarks = new THREE.Group();            // the two points of Scale by two points, and the line between them
scene.add(refMarks);
const refGizmo = new TransformControls(camera, renderer.domElement);
refGizmo.setSize(0.9);
refGizmo.showY = false;
refGizmo.addEventListener("dragging-changed", (event) => { controls.enabled = !event.value; });
refGizmo.addEventListener("objectChange", () => { refState.x = refGroup.position.x; refState.z = refGroup.position.z; fillRefFields(); });
scene.add(typeof refGizmo.getHelper === "function" ? refGizmo.getHelper() : refGizmo);

function refPlace() {
    refGroup.position.set(refState.x, refState.y, refState.z);
    refGroup.rotation.set(0, -refState.rotation * Math.PI / 180, 0);
    refGroup.scale.set(refState.width, 1, refState.width / (refState.aspect || 1));
    refGroup.visible = refState.show && !!refState.mesh;
    if (refState.mesh) {
        const m = refState.mesh.material;
        m.opacity = refState.opacity;
        m.depthTest = !refState.top;           // on top: over the model and the road (the markers and the nodes stay above it), else in its place in the depth
        refState.mesh.renderOrder = refState.top ? 900 : 0;
        m.needsUpdate = true;
    }
}
function fillRefFields() {
    const has = !!refState.mesh;
    $("refControls").style.display = has ? "" : "none";
    $("refQuick").style.display = has ? "" : "none";
    $("refName").textContent = refState.file ? refState.file.name : (refState.name || "none");
    if (!has) return;
    $("refOpacity").value = Math.round(refState.opacity * 100); $("refOpacityQuick").value = $("refOpacity").value;
    $("refOpacityValue").textContent = $("refOpacity").value + "%";
    $("refShow").checked = refState.show; $("refShowQuick").checked = refState.show;
    $("refTop").checked = refState.top;
    $("refWidth").value = +refState.width.toFixed(2);
    $("refRotation").value = +refState.rotation.toFixed(1);
    $("refX").value = +refState.x.toFixed(1); $("refZ").value = +refState.z.toFixed(1); $("refY").value = +refState.y.toFixed(2);
    $("refMove").classList.toggle("accent", refState.moving);
    $("refScale").classList.toggle("accent", state.mode === "refscale");
}
// the picture from a file or a URL: a flat plane of 1 by 1 (the group gives it its size); first: put it in the middle of what is in view, as wide as the track
function loadRef(url, first) {
    return new Promise((resolve, reject) => {
        new THREE.TextureLoader().load(url, (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
            if (refState.mesh) { refGroup.remove(refState.mesh); refState.mesh.material.map.dispose(); refState.mesh.material.dispose(); }
            const geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
            refState.mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
            refGroup.add(refState.mesh);
            refState.aspect = texture.image && texture.image.height ? texture.image.width / texture.image.height : 1;
            if (first) {
                const box = driveBox();
                const size = box && !box.isEmpty() ? box.getSize(new THREE.Vector3()) : null;
                refState.width = size ? Math.max(50, Math.round(Math.max(size.x, size.z * refState.aspect) * 1.1)) : 500;
                refState.x = controls.target.x; refState.z = controls.target.z;
                refState.y = box && !box.isEmpty() ? +box.min.y.toFixed(2) : 0;
                refState.rotation = 0; refState.show = true;
            }
            refPlace(); fillRefFields();
            resolve();
        }, undefined, () => reject(new Error("The picture could not be read.")));
    });
}
function clearRef() {
    if (refState.mesh) { refGroup.remove(refState.mesh); refState.mesh.material.map.dispose(); refState.mesh.material.dispose(); refState.mesh = null; }
    if (refState.url) URL.revokeObjectURL(refState.url);
    refState.file = null; refState.name = ""; refState.url = "";
    refGizmo.detach(); refState.moving = false;
    endRefScale();
    refPlace(); fillRefFields();
}
// a track that is opened: its picture and where it lies (or none)
async function resetRef(track) {
    clearRef();
    const r = track && track.reference;
    refState.oldName = r && REF_FILE.test(r.image || "") ? r.image : "";
    if (!refState.oldName) return;
    Object.assign(refState, {
        name: r.image, x: Number.isFinite(r.x) ? r.x : 0, y: Number.isFinite(r.y) ? r.y : 0, z: Number.isFinite(r.z) ? r.z : 0,
        width: r.width > 0 ? r.width : 500, rotation: Number.isFinite(r.rotation) ? r.rotation : 0,
        opacity: r.opacity >= 0 && r.opacity <= 1 ? r.opacity : 0.5, show: r.show !== false, top: r.top !== false
    });
    try { await loadRef(trackFile(track, r.image), false); } catch (error) { refState.name = ""; status("The reference image of the track could not be loaded.", "error"); }
}
function refJSON() {
    if (!refState.mesh) return null;
    const ext = refState.file ? (refState.file.name.split(".").pop() || "png").toLowerCase().replace("jpeg", "jpg") : null;
    return { image: refState.file ? "reference." + ext : refState.name, x: +refState.x.toFixed(2), y: +refState.y.toFixed(2), z: +refState.z.toFixed(2), width: +refState.width.toFixed(3),
        rotation: +refState.rotation.toFixed(2), opacity: +refState.opacity.toFixed(2), show: refState.show, top: refState.top };
}

// Scale by two points: two clicks on the picture, then the distance between them in metres (or feet: "400 ft")
function startRefScale() {
    if (!refState.mesh) return;
    refState.scale = [];
    refState.show = true; refPlace();
    setMode("refscale");
    fillRefFields();
}
function endRefScale() {
    refState.scale = null;
    refMarks.clear();
    if (state.mode === "refscale") setMode("view");
}
function drawRefMarks() {
    disposeTree(refMarks);
    const points = refState.scale || [];
    points.forEach((p) => {
        const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshBasicMaterial({ color: 0xff3df0, depthTest: false, transparent: true }));
        ball.position.copy(p);
        ball.renderOrder = 1001;
        screenSize(ball, 7, 1);
        refMarks.add(ball);
    });
    if (points.length === 2) {
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0xff3df0, depthTest: false, transparent: true }));
        line.renderOrder = 1001;
        refMarks.add(line);
    }
}
async function refScaleClick(event) {
    const hit = refState.mesh && pointerRay(event).intersectObject(refState.mesh, false)[0];
    if (!hit) { status("Click on the picture.", "error"); return; }
    refState.scale.push(hit.point.clone());
    drawRefMarks();
    if (refState.scale.length < 2) { $("hud").textContent = "Scale by two points: now click the second point (Escape cancels)."; return; }
    const [a, b] = refState.scale;
    const now = Math.hypot(b.x - a.x, b.z - a.z);
    if (now < 1e-6) { status("The two points are the same place: click two points further apart.", "error"); refState.scale = []; drawRefMarks(); return; }
    const answer = await OpenRacerDialog.prompt({ title: "How far apart are the two points?", text: "The distance in the world, in metres (or in feet: 400 ft). The picture is scaled about the first point. It is " + now.toFixed(1) + " m now.", input: "", ok: "Scale" });
    const match = answer && String(answer).trim().replace(",", ".").match(/^([0-9]*\.?[0-9]+)\s*(m|meter|meters|metres|ft|feet|foot)?$/i);
    const metres = match ? parseFloat(match[1]) * (/^f/i.test(match[2] || "") ? 0.3048 : 1) : NaN;
    if (!(metres > 0)) { if (answer !== null) status("That is not a distance: type a number, like 120 or 400 ft.", "error"); endRefScale(); fillRefFields(); return; }
    const k = metres / now;
    refState.width *= k;
    refState.x = a.x + (refState.x - a.x) * k;
    refState.z = a.z + (refState.z - a.z) * k;
    refPlace();
    endRefScale();
    fillRefFields();
    status("The picture is scaled ×" + k.toFixed(3) + ": it is " + refState.width.toFixed(1) + " m wide now.", "ok");
}

$("refFile").onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (!/\.(png|jpe?g|webp)$/i.test(file.name)) { status("A reference image is a png, jpg or webp.", "error"); return; }
    const url = URL.createObjectURL(file);
    try {
        await loadRef(url, !refState.mesh);
        if (refState.url) URL.revokeObjectURL(refState.url);
        refState.url = url; refState.file = file;
        fillRefFields();
        status("Reference image loaded. Move it with Move, then use Scale by two points.", "ok");
    } catch (error) { URL.revokeObjectURL(url); status(error.message, "error"); }
};
$("refPick").onclick = () => $("refFile").click();
$("refClear").onclick = () => clearRef();
const refOpacity = (v) => { refState.opacity = Math.max(0, Math.min(1, v / 100)); refPlace(); fillRefFields(); };
$("refOpacity").addEventListener("input", (e) => refOpacity(+e.target.value));
$("refOpacityQuick").addEventListener("input", (e) => refOpacity(+e.target.value));
$("refShow").onchange = (e) => { refState.show = e.target.checked; refPlace(); fillRefFields(); };
$("refShowQuick").onchange = (e) => { refState.show = e.target.checked; refPlace(); fillRefFields(); };
$("refTop").onchange = (e) => { refState.top = e.target.checked; refPlace(); };
[["refWidth", "width", 1], ["refRotation", "rotation", -1e9], ["refX", "x", -1e9], ["refZ", "z", -1e9], ["refY", "y", -1e9]].forEach(([id, key, min]) => $(id).addEventListener("change", (e) => {
    const v = parseFloat(e.target.value);
    if (Number.isFinite(v) && v >= min) refState[key] = v;
    refPlace(); fillRefFields();
}));
$("refMove").onclick = () => {
    refState.moving = !refState.moving;
    if (refState.moving) clearSelection("ref");
    refGizmo.detach();
    if (refState.moving && refState.mesh) refGizmo.attach(refGroup);
    fillRefFields();
};
$("refScale").onclick = () => { if (state.mode === "refscale") endRefScale(); else startRefScale(); fillRefFields(); };
fillRefFields();


function resize() {
    const w = view.clientWidth, h = view.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();
window.__trackEditorView = { scene, camera, renderer, curbState };          // (for the tests of the editor)
// The handles and the markers of the view (the nodes of the road, the points of a row of prefabs, the nodes of the racing line, the dots of the pit line and the pit area,
// the balls of the gates and the range of a camera, the arrows and the numbers) keep one size on the screen, however near or far the camera is: they were made in metres
// (markerScale, from the size of the track), so close by they filled the view and far away they were dots. screenSize(object, pixels, size): how large it is on the screen
// (a ball: its radius, an arrow: its length, a number: its height), and how large it is in metres at a scale of 1. A click on it is the same size as what is drawn.
function screenSize(object, pixels, size) { object.userData.screenPx = pixels; object.userData.baseSize = size || 1; return object; }
const sizeAt = new THREE.Vector3();
function keepScreenSizes() {
    const h = view.clientHeight || 1;
    const perPixel = camera.isOrthographicCamera ? (camera.top - camera.bottom) / camera.zoom / h : 2 * Math.tan(camera.fov * Math.PI / 360) / (camera.zoom || 1) / h;
    scene.traverseVisible((o) => {
        const px = o.userData.screenPx;
        if (!px) return;
        o.getWorldPosition(sizeAt);
        const metresPerPixel = camera.isOrthographicCamera ? perPixel : perPixel * camera.position.distanceTo(sizeAt);
        o.scale.setScalar(px * metresPerPixel / o.userData.baseSize);
    });
}
(function loop() {
    requestAnimationFrame(loop);
    keepScreenSizes();
    renderer.render(scene, camera);
    if (touchReady) drawLoupe();
    positionCamIcons();
})();

function status(text, kind) {
    const el = $("status");
    el.textContent = text;
    el.className = kind || "";
    el.title = text;
    // the same message in the view, as in the car editor: an error stays until it is clicked away (it went after 7 s, and the line at the bottom cut a long one off)
    if (window.editorToast) window.editorToast(text, kind);
}

function slug(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

// ---- the surfaces

const roleMaterials = {};
for (const [role] of ROLES) {
    roleMaterials[role] = new THREE.MeshLambertMaterial({ color: ROLE_COLORS[role], side: THREE.DoubleSide });
}
// a road lies a little above the ground that is under it, also seen from far away
for (const role of ["grass", "ground"]) { roleMaterials[role].polygonOffset = true; roleMaterials[role].polygonOffsetFactor = 2; roleMaterials[role].polygonOffsetUnits = 2; }
// decor (a sky dome, trees) is see-through, so that it does not hide the road
roleMaterials.decor.transparent = true;
roleMaterials.decor.opacity = 0.12;
roleMaterials.decor.depthWrite = false;
const highlightMaterial = new THREE.MeshBasicMaterial({ color: 0xffd04d, side: THREE.DoubleSide });

function guessRole(name, materialName) {
    const text = name + " " + (materialName || "");
    if (/sky|cloud|tree|flag|banner|sign|horizon|decor|grandstand|crowd|lamp/i.test(text)) return "decor";
    if (/pit/i.test(text) && /road|lane|asphalt|tarmac/i.test(text)) return "track01";
    if (/road|asphalt|tarmac|track|strip|kerb|curb|circuit/i.test(text)) return "road";
    if (/grass|gras|lawn|field/i.test(text)) return "grass";
    if (/sand|zand|desert|dune/i.test(text)) return "sand";
    if (/gravel|grind|split/i.test(text)) return "gravel";
    if (/mud|modder|klei/i.test(text)) return "mud";
    if (/dirt|ground|soil|terrain/i.test(text)) return "ground";
    return "scenery";
}

function materialOf(mesh) {
    const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    return m && m.name ? m.name : "";
}

function applyColours() {
    const colour = $("colour").checked;
    for (const [name, meshes] of state.parts) {
        for (const mesh of meshes) {
            if (name === state.selected) mesh.material = highlightMaterial;
            else mesh.material = (colour && roleMaterials[state.roles[name]]) || mesh.userData.original;      // (a role without a colour of its own, a zone: its own material)
        }
    }
}

function setRole(name, role) {
    state.roles[name] = role;
    applyColours();
}

function renderParts() {
    const filter = $("filter").value.trim().toLowerCase();
    const list = $("parts");
    list.innerHTML = "";
    let shown = 0;
    for (const name of [...state.parts.keys()].sort()) {
        if (filter && !name.toLowerCase().includes(filter)) continue;
        shown++;
        const row = document.createElement("div");
        row.className = "part" + (name === state.selected ? " selected" : "");
        row.dataset.name = name;
        const label = document.createElement("b");
        label.textContent = name || "(no name)";
        label.title = name;
        const select = document.createElement("select");
        for (const [role, text] of ROLES) {
            const option = document.createElement("option");
            option.value = role;
            option.textContent = text;
            select.appendChild(option);
        }
        select.value = state.roles[name];
        select.disabled = state.legacy;
        select.onchange = () => setRole(name, select.value);
        select.onclick = (e) => e.stopPropagation();
        row.onclick = () => selectPart(name, false);
        row.appendChild(label);
        row.appendChild(select);
        list.appendChild(row);
    }
    $("partsNote").textContent = state.parts.size
        ? shown + " of " + state.parts.size + " parts shown." + (state.legacy ? " This track is of the old format: its surfaces come from its textures and can not be changed here. Import a glb to replace its model." : "")
        : "No parts: load a model.";
}

function selectPart(name, scroll) {
    state.selected = name;
    applyColours();
    // a part that the filter hides is shown by clearing the filter
    if (scroll && name !== null && $("filter").value.trim() && ![...$("parts").children].some((row) => row.dataset.name === name)) {
        $("filter").value = "";
        renderParts();
    }
    for (const row of $("parts").children) {
        row.classList.toggle("selected", row.dataset.name === name);
        if (scroll && row.dataset.name === name) row.scrollIntoView({ block: "nearest" });
    }
}

function renderLegend() {
    $("legend").innerHTML = ROLES.map(([role, text]) => '<span><i style="background:#' + ROLE_COLORS[role].toString(16).padStart(6, "0") + '"></i>' + text + "</span>").join("");
    const bulk = $("bulkRole");
    bulk.innerHTML = ROLES.map(([role, text]) => '<option value="' + role + '">' + text + "</option>").join("");
}

// ---- loading a model

function clearTrack() {
    invalidateGround();
    trackGroup.clear();
    state.root = null;
    state.parts = new Map();
    state.roles = {};
    state.selected = null;
}

function registerMesh(mesh, role) {
    if (!mesh.userData.overlay) invalidateGround();
    const name = mesh.name || "";
    mesh.userData.original = mesh.material;
    if (!state.parts.has(name)) state.parts.set(name, []);
    state.parts.get(name).push(mesh);
    if (state.roles[name] === undefined) state.roles[name] = role || guessRole(name, materialOf(mesh));
}

// the box around what the car can drive on (a sky dome would make it far too big)
function driveBox() {
    const box = new THREE.Box3();
    for (const [name, meshes] of state.parts) {
        if (!DRIVABLE[state.roles[name]]) continue;
        for (const mesh of meshes) box.expandByObject(mesh);
    }
    return box.isEmpty() ? new THREE.Box3().setFromObject(trackGroup) : box;
}

function frameTrack() {
    const box = driveBox();
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const span = Math.max(size.x, size.z, 10);
    state.markerScale = Math.max(1, span / 250); // markers stay visible on a big track
    camera.far = span * 30;
    state.far = camera.far;
    camera.near = Math.max(0.5, span / 5000);
    camera.updateProjectionMatrix();
    camera.position.set(centre.x + span * 0.35, centre.y + span * 0.6, centre.z + span * 0.55);
    controls.target.copy(centre);
    controls.update();
}

function topView() {
    const box = driveBox();
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const span = Math.max(size.x, size.z, 10);
    camera.position.set(centre.x, centre.y + span * 1.0, centre.z + 0.01);
    controls.target.copy(centre);
    controls.update();
}

function setModel(root, roles) {
    clearTrack();
    state.root = root;
    root.updateMatrixWorld(true);
    root.traverse((object) => {
        if (object.isMesh) registerMesh(object, roles ? roles[object.name] || roles["@" + object.name] : null);
    });
    // a part that has no role of its own gets the role of its parent with a name (a node with several materials)
    root.traverse((object) => {
        if (!object.isMesh || !roles) return;
        for (let node = object; node; node = node.parent) {
            if (node.name && roles[node.name]) { state.roles[object.name || ""] = roles[node.name]; break; }
        }
    });
    trackGroup.add(root);
    frameTrack();
    applyEnv();
    applyColours();
    renderParts();
}

// A .gltf that names its .bin and textures with a folder ("textures/road.png"): the names without the folder. The files go flat into the folder of the track,
// and the game asked for tracks/<id>/textures/road.png: no texture, and a .bin in a folder did not load at all (here they were found by their names)
async function flatGltf(file) {
    let json;
    try { json = JSON.parse(await file.text()); } catch (e) { return file; }
    let changed = false;
    for (const item of [...(json.images || []), ...(json.buffers || [])]) {
        if (!item.uri || /^data:/i.test(item.uri)) continue;
        const flat = item.uri.split("?")[0].split(/[\\/]|%2F|%5C/i).pop();          // (the name keeps its own spelling: %20 stays %20)
        if (flat !== item.uri) { item.uri = flat; changed = true; }
    }
    return changed ? new File([JSON.stringify(json)], file.name, { type: "model/gltf+json" }) : file;
}

async function loadFromFiles(list, givenRoles) {
    state.files = new Map();
    for (const file of list) state.files.set(file.name, file);
    const main = [...state.files.keys()].find((n) => /\.glb$/i.test(n)) || [...state.files.keys()].find((n) => /\.gltf$/i.test(n));
    if (!main) {
        status("Pick a .glb file, or a .gltf with its .bin and texture files.", "error");
        return;
    }
    if (/\.gltf$/i.test(main)) state.files.set(main, await flatGltf(state.files.get(main)));
    state.mainFile = main;
    stopDesign();
    const urls = new Map();
    for (const [name, file] of state.files) urls.set(name, URL.createObjectURL(file));
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
        const name = decodeURIComponent(url.split("?")[0].split("/").pop());
        return urls.has(name) ? urls.get(name) : url;
    });
    status("Loading " + main + " (" + (state.files.get(main).size / 1048576).toFixed(1) + " MB)…");
    // a part of the new model that has the name of a part of the old one keeps its surface
    const kept = givenRoles || (state.parts.size && !state.legacy ? Object.assign({}, state.roles) : null);
    new GLTFLoader(manager).load(urls.get(main), (gltf) => {
        state.legacy = false;
        setModel(gltf.scene, kept);
        $("modelInfo").textContent = main + " (" + (state.files.get(main).size / 1048576).toFixed(1) + " MB), " + state.parts.size + " named parts";
        status("Model loaded: " + state.parts.size + " parts. " + (kept && !givenRoles ? "Parts with the name of an old part keep their surface; check the new ones. " : "") + "Save the track to keep it.", "ok");
        updateMarkers();
    }, undefined, (error) => status("Could not read the model: " + (error.message || error), "error"));
}

// a track of the garage or of a folder on the PC has its files as blob URLs (Garage.js)
function trackFile(track, name) { return OpenRacer.Garage.resolve(track, "../tracks/" + track.id + "/" + name); }

function loadGltfTrack(track) {
    return new Promise((resolve, reject) => new GLTFLoader(OpenRacer.Garage.manager(track, THREE)).load(trackFile(track, track.model), (gltf) => {
        state.legacy = false;
        setModel(gltf.scene, (track.surfaces && track.surfaces.meshes) || {});
        // what is not mentioned in the file is scenery
        for (const name of state.parts.keys()) {
            if (!(track.surfaces && track.surfaces.meshes && track.surfaces.meshes[name])) state.roles[name] = "scenery";
        }
        applyColours();
        renderParts();
        $("modelInfo").textContent = track.model + ", " + state.parts.size + " named parts";
        updateMarkers();
        resolve();
    }, undefined, (error) => reject(new Error("Could not load the model of this track: " + (error.message || error)))));
}

// A track of the old format: the vertices of every object in one file and the places and materials in another
async function loadLegacyTrack(track) {
    const [geometry, sceneData] = await Promise.all([
        fetch(trackFile(track, track.geometry)).then((r) => r.json()),
        fetch(trackFile(track, track.scene)).then((r) => r.json())
    ]);
    const root = new THREE.Group();
    const roles = {};
    for (const item of sceneData.transforms || []) {
        const data = geometry[item.name];
        if (!data || !data.vertices || !data.tris) continue;
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(data.vertices), 3));
        const indices = new Uint32Array(data.tris.length);
        for (let i = 0; i < indices.length; i += 3) {
            indices[i] = data.tris[i + 2];
            indices[i + 1] = data.tris[i + 1];
            indices[i + 2] = data.tris[i];
        }
        g.setIndex(new THREE.BufferAttribute(indices, 1));
        g.computeVertexNormals();
        const material = sceneData.materials && item.renderer ? sceneData.materials[item.renderer] : null;
        const texture = material ? material.colorTexture : "";
        const role = ROLE_COLORS[texture] !== undefined && texture !== "decor" && texture !== "scenery" ? texture : (/sky|horizon|alpha|grasst/.test(texture) ? "decor" : "scenery");
        const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0xcccccc, side: THREE.DoubleSide }));
        mesh.name = item.name;
        mesh.position.set(item.position[0], item.position[1], item.position[2]);
        root.add(mesh);
        roles["@" + item.name] = role;
        roles[item.name] = role;
    }
    state.legacy = true;
    setModel(root, roles);
    $("modelInfo").textContent = "Old format (" + track.geometry + "), " + state.parts.size + " parts";
    updateMarkers();
}

// ---- the start and the gates

const GRID_MAX = 8, BOX_W = 2.4, BOX_L = 5.0, PIT_W = 4, PIT_L = 8;
function syncStart() { const b = state.grid[0]; state.start = b ? { x: b.x, y: b.y, z: b.z, heading: b.heading } : null; }
// The height of the drivable surface at (x, z): the highest one that is not more than 50 m above hint (no hint: the highest). From a grid of the drivable
// triangles (Ground.js, as the game has it), made again when the track or its surfaces change: a ray against the meshes took milliseconds on a big track,
// and a curb asked for it hundreds of times at every step of a drag.
let groundIndex = null;
function invalidateGround() { groundIndex = null; }
function groundIndexOf() {
    const rolesKey = JSON.stringify(state.roles);
    if (groundIndex && groundIndex.rolesKey === rolesKey) return groundIndex;
    const world = new OpenRacer.GroundWorld(5);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    trackGroup.updateMatrixWorld(true);
    trackGroup.traverse((m) => {
        // (a patch of gravel on the ground is not the ground: the patch itself is made on it, and things stand on what is under it)
        if (!m.isMesh || !m.geometry || !m.geometry.attributes.position || !DRIVABLE[state.roles[m.name || ""]] || m.userData.overlay) return;
        const pos = m.geometry.attributes.position, index = m.geometry.index, count = index ? index.count : pos.count;
        const at = (k) => index ? index.getX(k) : k;
        for (let t = 0; t + 2 < count; t += 3) {
            a.fromBufferAttribute(pos, at(t)).applyMatrix4(m.matrixWorld);
            b.fromBufferAttribute(pos, at(t + 1)).applyMatrix4(m.matrixWorld);
            c.fromBufferAttribute(pos, at(t + 2)).applyMatrix4(m.matrixWorld);
            world.addTriangle(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, "road", m.name, 0);
        }
    });
    world.rolesKey = rolesKey;
    groundIndex = world;
    return world;
}
function groundY(x, z, hint) {
    const q = groundIndexOf().query(x, z, hint === undefined ? 1e7 : hint, 50);
    return q ? q.y : (hint === undefined ? 0 : hint);
}

function heading(degrees) {
    return degrees * Math.PI / 180;
}

function numberLabel(n, x, y, z, colour) {
    const c = document.createElement("canvas"); c.width = 64; c.height = 64;
    const ctx = c.getContext("2d");
    ctx.font = "bold 44px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.lineWidth = 6; ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.strokeText(String(n), 32, 34);
    ctx.fillStyle = "#" + colour.toString(16).padStart(6, "0"); ctx.fillText(String(n), 32, 34);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
    sprite.position.set(x, y + 1.2 * state.markerScale, z);
    sprite.scale.setScalar(1.6 * state.markerScale);
    sprite.renderOrder = 999;
    return screenSize(sprite, 22, 1);
}
// an invisible quad over a box of the grid or of the pit: what a click in Look finds (a line is hard to hit)
function boxPick(corners, y, kind, i) {
    const quad = new THREE.BufferGeometry();
    quad.setAttribute("position", new THREE.Float32BufferAttribute([].concat(...[0, 1, 2, 0, 2, 3].map((k) => [corners[k][0], y + 0.1, corners[k][1]])), 3));
    const mesh = new THREE.Mesh(quad, new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }));
    mesh.userData.box = { kind, i };
    return mesh;
}
function makeArrow(x, y, z, h, colour, length) {
    return new THREE.ArrowHelper(new THREE.Vector3(Math.cos(h), 0, Math.sin(h)), new THREE.Vector3(x, y + 0.6, z), length, colour, length * 0.3, length * 0.2);
}

function updateMarkers() {
    disposeTree(markers);
    showObjects();
    const k = state.markerScale;
    // the grid: a box on the road per place, box 1 (the start) in yellow with its arrow, the others in white, each with its number
    state.grid.forEach((b, i) => {
        const colour = boxSel.kind === "grid" && boxSel.i === i ? 0xff8a3d : (i === 0 ? 0xffd04d : 0xffffff);
        const c = Math.cos(b.heading), sn = Math.sin(b.heading), ax = c * BOX_L / 2, az = sn * BOX_L / 2, bx = -sn * BOX_W / 2, bz = c * BOX_W / 2;
        const corners = [[b.x - ax + bx, b.z - az + bz], [b.x + ax + bx, b.z + az + bz], [b.x + ax - bx, b.z + az - bz], [b.x - ax - bx, b.z - az - bz]];
        const pts = corners.concat([corners[0]]).map((q) => new THREE.Vector3(q[0], groundY(q[0], q[1], b.y) + 0.08, q[1]));
        const loop = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: colour, depthTest: false }));
        loop.renderOrder = 996;
        markers.add(loop);
        markers.add(boxPick(corners, b.y, "grid", i));
        markers.add(screenSize(makeArrow(b.x, b.y, b.z, b.heading, colour, (i === 0 ? 6 : 3.5) * k), i === 0 ? 60 : 40, (i === 0 ? 6 : 3.5) * k));
        markers.add(numberLabel(i + 1, b.x, b.y + 0.1, b.z, colour));
    });
    // the pit boxes: yellow and see-through, 4 by 8 m, with the arrow of the way that the car faces and its number
    state.pitBoxes.forEach((b, i) => {
        const c = Math.cos(b.heading), sn = Math.sin(b.heading), ax = c * PIT_L / 2, az = sn * PIT_L / 2, bx = -sn * PIT_W / 2, bz = c * PIT_W / 2;
        const corners = [[b.x - ax + bx, b.z - az + bz], [b.x + ax + bx, b.z + az + bz], [b.x + ax - bx, b.z + az - bz], [b.x - ax - bx, b.z - az - bz]];
        const y = (q) => groundY(q[0], q[1], b.y) + 0.07;
        const quad = new THREE.BufferGeometry();
        quad.setAttribute("position", new THREE.Float32BufferAttribute([].concat(...[0, 1, 2, 0, 2, 3].map((k) => [corners[k][0], y(corners[k]), corners[k][1]])), 3));
        const fill = new THREE.Mesh(quad, new THREE.MeshBasicMaterial({ color: 0xffd23c, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
        fill.renderOrder = 995;
        markers.add(fill);
        const pts = corners.concat([corners[0]]).map((q) => new THREE.Vector3(q[0], y(q) + 0.02, q[1]));
        const loop = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: boxSel.kind === "pit" && boxSel.i === i ? 0xff8a3d : 0xffe066, depthTest: false }));
        loop.renderOrder = 996;
        markers.add(loop);
        markers.add(boxPick(corners, b.y, "pit", i));
        markers.add(screenSize(makeArrow(b.x, b.y, b.z, b.heading, 0xffd04d, 3.5 * k), 40, 3.5 * k));
        markers.add(numberLabel(i + 1, b.x, b.y + 0.1, b.z, 0xffd04d));
    });
    // the pit line: orange, a smooth curve through the points with an arrow on every one, the first point in green (the start on the racing line) and the last in red
    if (state.pitLine.length) {
        const L = state.pitLine;
        const smooth = L.length >= 3 ? new THREE.CatmullRomCurve3(L.map((q) => new THREE.Vector3(q.x, q.y + 0.25, q.z)), false, "centripetal").getPoints(L.length * 12) : L.map((q) => new THREE.Vector3(q.x, q.y + 0.25, q.z));
        const curve = new THREE.Line(new THREE.BufferGeometry().setFromPoints(smooth), new THREE.LineBasicMaterial({ color: 0xff9a2e, depthTest: false }));
        curve.renderOrder = 996;
        markers.add(curve);
        L.forEach((q, i) => {
            const dot = new THREE.Mesh(new THREE.SphereGeometry(0.4 * k, 10, 8), new THREE.MeshBasicMaterial({ color: i === 0 ? 0x4ed88a : (i === L.length - 1 ? 0xff5a4a : 0xff9a2e), depthTest: false }));
            dot.position.set(q.x, q.y + 0.3, q.z);
            dot.renderOrder = 997;
            markers.add(screenSize(dot, 6, 0.4 * k));
            if (i < L.length - 1) markers.add(screenSize(makeArrow(q.x, q.y, q.z, Math.atan2(L[i + 1].z - q.z, L[i + 1].x - q.x), 0xff9a2e, 2.2 * k), 28, 2.2 * k));
        });
    }
    if (state.pit && state.pit.points.length) {
        const P = state.pit.points;
        if (P.length >= 3) {
            const shape = new THREE.Shape(P.map((q) => new THREE.Vector2(q.x, q.z)));
            const geometry = new THREE.ShapeGeometry(shape), pos = geometry.attributes.position;
            for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), z = pos.getY(i); pos.setXYZ(i, x, groundY(x, z, P[0].y) + 0.06, z); }
            const fill = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x5a7fa8, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
            markers.add(fill);
        }
        const ring = P.concat(P.length >= 3 ? [P[0]] : []).map((q) => new THREE.Vector3(q.x, q.y + 0.1, q.z));
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring), new THREE.LineBasicMaterial({ color: 0x9cc8ff, depthTest: false }));
        line.renderOrder = 996;
        markers.add(line);
        P.forEach((q, i) => {
            const dot = new THREE.Mesh(new THREE.SphereGeometry(0.35 * k, 10, 8), new THREE.MeshBasicMaterial({ color: i === P.length - 1 ? 0xffd04d : 0x9cc8ff, depthTest: false }));
            dot.position.set(q.x, q.y + 0.2, q.z);
            dot.renderOrder = 997;
            markers.add(screenSize(dot, 6, 0.35 * k));
        });
    }
    renderGrid(); renderPit(); renderGateLayers(); syncGateTarget();
    state.gates.forEach((gate, i) => {
        const chosen = i === gateUi.selected;
        const colour = chosen ? 0xffd04d : (i === 0 ? 0x4ed88a : 0x4db8ff);
        const material = () => new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: chosen ? 0.6 : 0.45, side: THREE.DoubleSide, depthWrite: false });
        const wall = new THREE.Mesh(new THREE.PlaneGeometry(gate.width, 4), material());
        wall.userData.gateIndex = i;
        wall.position.set(gate.x, gate.y + 2, gate.z);
        wall.rotation.y = Math.atan2(Math.cos(gate.heading), Math.sin(gate.heading));
        markers.add(wall);
        // a strip on the road, to be seen from above
        const strip = new THREE.Mesh(new THREE.PlaneGeometry(gate.width, 2 * k), material());
        strip.rotation.x = -Math.PI / 2;
        strip.rotation.z = Math.atan2(-Math.cos(gate.heading), -Math.sin(gate.heading)); // across the road
        strip.position.set(gate.x, gate.y + 0.3, gate.z);
        strip.userData.gateIndex = i;
        markers.add(strip);
        markers.add(screenSize(makeArrow(gate.x, gate.y, gate.z, gate.heading, colour, 5 * k), 50, 5 * k));
    });
    camIcons.innerHTML = "";
    state.cameras.forEach((c, i) => {
        // a camera: a body with a lens, a line down to the ground, and its range: a circle on the floor
        const chosen = i === state.camSel;
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1, 1.8), new THREE.MeshBasicMaterial({ color: chosen ? 0xffd04d : 0xff7bd5, depthTest: false, transparent: true }));
        body.position.set(c.x, c.y, c.z);
        body.scale.setScalar(k);
        body.renderOrder = 998;
        body.userData.camera = i;
        markers.add(body);
        const hit = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
        hit.position.copy(body.position);
        hit.scale.setScalar(k);
        hit.userData.camera = i;
        markers.add(hit);
        const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 0.8, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }));
        lens.rotation.x = Math.PI / 2;
        lens.position.set(c.x, c.y, c.z + 1.2 * k);
        lens.scale.setScalar(k);
        lens.renderOrder = 998;
        markers.add(lens);
        const ground = groundY(c.x, c.z, c.y);
        markers.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(c.x, c.y, c.z), new THREE.Vector3(c.x, ground, c.z)]), new THREE.LineBasicMaterial({ color: 0xff7bd5 })));
        const range = rangeOf(c);
        const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(rangePoints(range.x, range.z, range.r)), new THREE.LineBasicMaterial({ color: chosen ? 0xffd04d : 0xff7bd5, depthTest: false, transparent: true, opacity: chosen ? 1 : 0.5 }));
        ring.renderOrder = 997;
        markers.add(ring);
        if (chosen && state.camRange) {
            // the nodes of the range: the middle moves the circle, the one on the edge sets the radius
            const gy = groundY(range.x, range.z, c.y);
            const node = (x, z, name, colour) => {
                const ball = new THREE.Mesh(new THREE.SphereGeometry(0.9 * k, 14, 10), new THREE.MeshBasicMaterial({ color: colour, depthTest: false, transparent: true }));
                ball.position.set(x, groundY(x, z, gy) + 0.9 * k, z);
                ball.renderOrder = 1000;
                ball.userData.rangeNode = name;
                markers.add(screenSize(ball, 9, 0.9 * k));
            };
            node(range.x, range.z, "centre", 0xffffff);
            node(range.x + range.r, range.z, "edge", 0xff8a3d);
        }
        // the button above the camera: it opens the range
        const icon = document.createElement("button");
        icon.dataset.camera = String(i);
        icon.textContent = "◎";
        icon.title = "Change the range of this camera";
        icon.style.cssText = "position: absolute; transform: translate(-50%, -100%); width: 26px; height: 26px; border-radius: 13px; padding: 0; line-height: 24px; font-size: 15px; cursor: pointer; pointer-events: auto; border: 2px solid " + (chosen ? "#ffd04d" : "#ff7bd5") + "; color: #fff; background: " + (chosen && state.camRange ? "#ff7bd5" : "rgba(22, 27, 34, 0.9)") + ";";
        icon.onclick = () => selectCamera(i, !(state.camSel === i && state.camRange));
        camIcons.appendChild(icon);
    });
    renderCameras();
    if (state.drag) {
        // the drag strip: the start line (green), the finish line (red) and a line between them with a mark at every standard distance
        const d = state.drag, dx = Math.cos(d.heading), dz = Math.sin(d.heading);
        const fx = d.x + dx * d.length, fz = d.z + dz * d.length;
        const fy = groundY(fx, fz, d.y);
        const line = (x, y, z, colour) => {
            const m = new THREE.Mesh(new THREE.PlaneGeometry(d.width, 1.2 * k), new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
            m.rotation.x = -Math.PI / 2;
            m.rotation.z = Math.atan2(-dx, -dz);
            m.position.set(x, y + 0.35, z);
            m.userData.dragStrip = true;                 // (a click on a line chooses the strip: its width and length are in the card)
            markers.add(m);
        };
        line(d.x, d.y, d.z, 0x4ed88a);
        line(fx, fy, fz, 0xff5a4f);
        markers.add(screenSize(makeArrow(d.x, d.y, d.z, d.heading, 0x4ed88a, 9 * k), 70, 9 * k));
        markers.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(d.x, d.y + 0.5, d.z), new THREE.Vector3(fx, fy + 0.5, fz)]), new THREE.LineBasicMaterial({ color: 0xffffff })));
        DRAG_MARKS.filter(([, metres]) => metres < d.length - 0.5).forEach(([, metres]) => {
            const x = d.x + dx * metres, z = d.z + dz * metres;
            line(x, groundY(x, z, d.y), z, 0xffffff);
        });
        $("dragInfo").textContent = "Start " + d.x.toFixed(0) + ", " + d.z.toFixed(0) + " · " + Math.round(d.length) + " m · the marks show 60 ft, 330 ft, 1/8 mile, 1000 ft, 1/4 mile ... within the strip.";
    } else {
        $("dragInfo").textContent = "No drag strip yet: click on the road and drag in its direction.";
    }
    syncDragTarget();
    if (eventLayers.selected === "drag" && !state.drag) selectEvent("drag");
    renderEventLayers();
    renderGates();
    renderBoxLayers();
    renderProps();
    renderReady();
}

// the distances of the drag strip that are timed in the game (Name, metres)
const DRAG_MARKS = [["60 ft", 18.288], ["330 ft", 100.584], ["1/8 mile", 201.168], ["1000 ft", 304.8], ["1/4 mile", 402.336], ["1/2 mile", 804.672], ["1 km", 1000], ["1 mile", 1609.344]];

function dragLength() {
    const v = $("dragLength").value;
    return v === "own" ? Math.max(50, Math.min(5000, parseFloat($("dragOwn").value) || 500)) : parseFloat(v);
}
function dragChanged() {
    $("dragOwnRow").style.display = $("dragLength").value === "own" ? "block" : "none";
    if (state.drag) { state.drag.length = dragLength(); state.drag.width = Math.max(3, parseFloat($("dragWidth").value) || 12); updateMarkers(); }
}
["dragLength", "dragOwn", "dragWidth"].forEach((id) => $(id).addEventListener("input", dragChanged));
$("dragLength").addEventListener("change", dragChanged);
$("dragRemove").addEventListener("click", () => { state.drag = null; updateMarkers(); });
$("dragClose").addEventListener("click", () => setMode("view"));
OpenRacer.Movable.make($("dragWindow"), { key: "track-editor-drag", handle: $("dragWindow").firstElementChild });
// the Layers panel and the drawer of the track (Track, Prefabs) are moved by their heads too, as the other windows: they lay over each other at the bottom right
OpenRacer.Movable.make($("eventLayers"), { key: "track-editor-layers", handle: $("eventLayers").firstElementChild });
OpenRacer.Movable.make($("drawer"), { key: "track-editor-drawer", handle: $("drawer").querySelector(".head") });
// a drag strip that was loaded: the window shows its distance
function showDrag() {
    if (!state.drag) return;
    const options = [...$("dragLength").options].filter((o) => o.value !== "own");
    const match = options.find((o) => Math.abs(parseFloat(o.value) - state.drag.length) < 0.5);
    if (match) $("dragLength").value = match.value;
    else { $("dragLength").value = "own"; $("dragOwn").value = Math.round(state.drag.length); }
    $("dragWidth").value = state.drag.width;
    $("dragOwnRow").style.display = $("dragLength").value === "own" ? "block" : "none";
}

// ---- the objects

const OBJECT_PREFIX = "obj-";
function objectFileName(original) {
    const base = original.replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9._ -]+/g, "-").replace(/^[^A-Za-z0-9]+/, "").slice(0, 60) || "object";
    return OBJECT_PREFIX + base + ".glb";
}

function loadObjectScene(model, url) {
    return new Promise((resolve) => new GLTFLoader(OpenRacer.Garage.manager(state.existingTrack || { id: "" }, THREE)).load(url, (gltf) => {
        gltf.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        model.scene = gltf.scene;
        // the middle of the base of the model (in the space of the file): where an object stands when it is clicked on the road, whatever the origin of the file is
        gltf.scene.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(gltf.scene);
        model.base = box.isEmpty() ? null : new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
        resolve(true);
    }, undefined, () => { model.scene = null; resolve(false); }));
}

// the model of a glb (a file or a blob) for this track, loaded, with its origin at the middle of its base; name: the file in the folder of the track (null: from the file name)
async function makeObjectModel(file, name, kind, mass) {
    name = name || objectFileName(file.name || "object");
    let k = 2;
    if (!arguments[1]) while (objectState.models.has(name)) name = name.replace(/(-\d+)?\.glb$/, "-" + (k++) + ".glb");
    const model = { name, file, kind: kind || "rigid", mass: mass || 0, scene: null, origin: "base", pivot: null, base: null };
    const url = URL.createObjectURL(file);
    const ok = await loadObjectScene(model, url);
    URL.revokeObjectURL(url);
    if (!ok) return null;
    model.pivot = model.base ? model.base.clone() : null;          // (the origin of a model that is added: the middle of its base)
    return model;
}
// a model that was picked with +: it goes in the library (the same in every track) with a picture, and in this track, and you are placing it
async function addObjectModel(file) {
    const model = await makeObjectModel(file);
    if (!model) { status("The file “" + file.name + "” could not be read as a glb.", "error"); return; }
    objectState.models.set(model.name, model);
    try { await keepInLibrary(model, file.name); status("Model added to the library. Press on the road and drag to say which way it faces; Escape goes back to Look.", "ok"); }
    catch (error) { status("The model is in this track, but not in the library: " + error.message, "error"); }
    objectState.selected = model.name;
    renderObjects();
    setMode("object");
}

// an object of the track as it stands: the turn about the vertical (the heading), the tilt (pitch about x, roll about z) and the scale; the same order as the game (RigidObjects.js)
function applyObjectTransform(g, o) {
    g.position.set(o.x, o.y, o.z);
    g.rotation.set(o.pitch || 0, -o.heading, o.roll || 0, "YXZ");
    g.scale.set(o.sx || 1, o.sy || 1, o.sz || 1);
}
function newObject(model, x, y, z, heading) { return { model, x, y, z, heading, pitch: 0, roll: 0, sx: 1, sy: 1, sz: 1 }; }
let objectBox = null;
function showObjects() {
    const key = objectState.list.map((o) => o.model).join("|") + "#" + [...objectState.models.values()].map((m) => m.name + (m.scene ? m.scene.uuid : "") + (m.pivot ? m.pivot.toArray().join(",") : "")).join("|");
    if (key === objectLayer.userData.key) {
        // (the same objects: only where they stand; each step of a gizmo cloned every model of the track again)
        objectLayer.children.forEach((g) => { const o = objectState.list[g.userData.objectIndex]; if (o) applyObjectTransform(g, o); });
        if (objectBox) { scene.remove(objectBox); objectBox.dispose(); objectBox = null; }
        const chosen = objectLayer.children.find((g) => g.userData.objectIndex === objectUi.selected);
        if (chosen) { objectBox = new THREE.BoxHelper(chosen, 0xffd04d); scene.add(objectBox); }
        syncObjectTarget();
        return;
    }
    objectLayer.userData.key = key;
    objectLayer.clear();
    objectState.list.forEach((o, i) => {
        const model = objectState.models.get(o.model);
        if (!model || !model.scene) return;
        const copy = model.scene.clone(true);
        if (model.pivot) copy.position.set(-model.pivot.x, -model.pivot.y, -model.pivot.z);
        const holder = new THREE.Group();
        holder.add(copy);
        applyObjectTransform(holder, o);
        holder.userData.objectIndex = i;
        objectLayer.add(holder);
    });
    if (objectBox) { scene.remove(objectBox); objectBox.dispose(); objectBox = null; }
    const chosen = objectLayer.children.find((g) => g.userData.objectIndex === objectUi.selected);
    if (chosen) { objectBox = new THREE.BoxHelper(chosen, 0xffd04d); scene.add(objectBox); }
    syncObjectTarget();
}

// ---- the objects as layers: one is chosen in the list (or by a click on it in the view) and shown with a gizmo: W moves, E turns, R scales
const objectUi = { selected: -1, dragging: false };
const objectTarget = new THREE.Object3D();
scene.add(objectTarget);
const objectGizmo = new TransformControls(camera, renderer.domElement);
objectGizmo.setSize(0.9);
objectGizmo.addEventListener("dragging-changed", (event) => { controls.enabled = !event.value; objectUi.dragging = event.value; if (!event.value) renderObjects(); });
objectGizmo.addEventListener("objectChange", () => objectGizmoMoved());
scene.add(typeof objectGizmo.getHelper === "function" ? objectGizmo.getHelper() : objectGizmo);
function syncObjectTarget() {
    const o = objectState.list[objectUi.selected];
    if (!o || objectUi.dragging) return;
    applyObjectTransform(objectTarget, o);
}
function objectGizmoMoved() {
    const o = objectState.list[objectUi.selected];
    if (!o) return;
    o.x = objectTarget.position.x; o.y = objectTarget.position.y; o.z = objectTarget.position.z;
    const e = new THREE.Euler().setFromQuaternion(objectTarget.quaternion, "YXZ");
    o.pitch = e.x; o.heading = -e.y; o.roll = e.z;
    o.sx = Math.max(0.01, objectTarget.scale.x); o.sy = Math.max(0.01, objectTarget.scale.y); o.sz = Math.max(0.01, objectTarget.scale.z);
    showObjects();
}
function selectObject(i) {
    if (i >= 0) clearSelection("object");
    objectGizmo.detach();
    objectUi.selected = objectState.list[i] ? i : -1;
    if (objectUi.selected >= 0) { applyObjectTransform(objectTarget, objectState.list[objectUi.selected]); objectGizmo.attach(objectTarget); setObjectGizmoMode(objectGizmo.mode || "translate"); }
    if (objectUi.selected < 0 && $("objectGizmoMode")) $("objectGizmoMode").textContent = "";
    showObjects();
    renderObjects();
}
function setObjectGizmoMode(mode) {
    objectGizmo.setMode(mode);
    objectGizmo.setSpace(mode === "translate" ? "world" : "local");
    gateGizmo.setMode(mode);
    gateGizmo.setSpace(mode === "translate" ? "world" : "local");
    // a gate only moves, turns about the vertical and widens (the scale along its width)
    gateGizmo.showX = mode !== "rotate"; gateGizmo.showY = mode !== "scale"; gateGizmo.showZ = mode === "translate";
    // a box of the grid or of the pit moves over the road and turns about the vertical (it has no scale)
    {
        boxGizmo.setMode(mode === "rotate" ? "rotate" : "translate");
        boxGizmo.setSpace(mode === "rotate" ? "local" : "world");
        boxGizmo.showX = boxGizmo.showZ = mode !== "rotate"; boxGizmo.showY = mode === "rotate";
    }
    const names = { translate: "Move (W)", rotate: "Turn (E)", scale: "Scale (R)" };
    const hint = $("objectGizmoMode");
    if (hint) hint.textContent = names[mode];
}
// ---- the gates as layers: chosen in the layers panel or by a click on one in the view; the gizmo moves it (W), turns it about the vertical (E) and makes it wider or narrower (R)
const gateTarget = new THREE.Object3D();
scene.add(gateTarget);
const gateGizmo = new TransformControls(camera, renderer.domElement);
gateGizmo.setSize(0.9);
gateGizmo.addEventListener("dragging-changed", (event) => {
    controls.enabled = !event.value; gateUi.dragging = event.value;
    const g = state.gates[gateUi.selected];
    if (event.value && g) gateUi.width0 = g.width;
    if (!event.value) { gateTarget.scale.set(1, 1, 1); syncGateTarget(); renderGates(); }
});
gateGizmo.addEventListener("objectChange", () => {
    const g = state.gates[gateUi.selected];
    if (!g) return;
    g.x = gateTarget.position.x; g.y = gateTarget.position.y; g.z = gateTarget.position.z;
    g.heading = -2 * Math.atan2(gateTarget.quaternion.y, gateTarget.quaternion.w);           // (the heading goes from +x towards +z, a turn about y goes the other way)
    if (Math.abs(gateTarget.scale.x - 1) > 1e-4) g.width = Math.max(2, Math.min(400, Math.round(gateUi.width0 * gateTarget.scale.x * 10) / 10));
    scheduleMarkers();
});
scene.add(typeof gateGizmo.getHelper === "function" ? gateGizmo.getHelper() : gateGizmo);
function syncGateTarget() {
    const g = state.gates[gateUi.selected];
    if (!g || gateUi.dragging) return;
    gateTarget.position.set(g.x, g.y, g.z);
    gateTarget.rotation.set(0, -g.heading, 0);
    gateTarget.scale.set(1, 1, 1);
}
function selectGate(i) {
    gateGizmo.detach();
    gateUi.selected = state.gates[i] ? i : -1;
    if (gateUi.selected >= 0) {
        clearSelection("gate");
        syncGateTarget();
        gateGizmo.attach(gateTarget);
        setObjectGizmoMode(objectGizmo.mode || "translate");
    }
    updateMarkers();
}
function renderGateLayers() {
    const list = $("gateLayers");
    if (!list) return;
    list.innerHTML = "";
    state.gates.forEach((g, i) => {
        const row = document.createElement("div");
        row.className = "layer" + (gateUi.selected === i ? " selected" : "");
        row.innerHTML = "<i></i><span></span><span class=\"meta\"></span>";
        row.children[1].textContent = i === 0 ? "Gate 1 (finish)" : "Gate " + (i + 1);
        row.children[2].textContent = g.width + " m";
        row.title = "Choose it: W moves, E turns, R makes it wider, Delete takes it away";
        row.onclick = () => selectGate(gateUi.selected === i ? -1 : i);
        list.appendChild(row);
    });
    if (!state.gates.length) { const none = document.createElement("div"); none.style.cssText = "padding: 4px 14px; color: #66727f;"; none.textContent = "none placed"; list.appendChild(none); }
}
function objectIndexOf(object) {
    for (let n = object; n; n = n.parent) if (n.userData && n.userData.objectIndex !== undefined) return n.userData.objectIndex;
    return -1;
}

function renderObjects() {
    const holder = $("objectModels");
    holder.innerHTML = "";
    renderLibrary();
    renderPrefabs();
    for (const [name, model] of (objectState.models.has(objectState.selected) ? [[objectState.selected, objectState.models.get(objectState.selected)]] : [])) {
        const row = document.createElement("div");
        row.className = "gate";
        row.style.flexWrap = "wrap";
        const title = document.createElement("span");
        title.textContent = name.replace(OBJECT_PREFIX, "").replace(/\.glb$/, "") + " (" + objectState.list.filter((o) => o.model === name).length + ")";
        title.style.fontWeight = objectState.selected === name ? "700" : "400";
        // the kind: rigid (a body that is pushed over), static (stands still, can be hit), decor (only drawn: no collision, no physics)
        const rigid = document.createElement("select");
        rigid.title = "Rigid: a body that moves when it is hit. Static: stands still and is hit. Decor: only drawn, nothing collides with it.";
        [["rigid", "Rigid"], ["static", "Static"], ["decor", "Decor"]].forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; rigid.appendChild(o); });
        rigid.value = model.kind || (model.rigid === false ? "decor" : "rigid");
        rigid.onchange = () => { model.kind = rigid.value; mass.style.display = rigid.value === "rigid" ? "" : "none"; libraryRemember(model); };
        const mass = document.createElement("input");
        mass.type = "number"; mass.min = "0"; mass.step = "5"; mass.value = model.mass || ""; mass.placeholder = "kg (auto)";
        mass.style.cssText = "width:80px" + ((model.kind || "rigid") === "rigid" ? "" : ";display:none");
        mass.onchange = () => { model.mass = Math.max(0, parseFloat(mass.value) || 0); libraryRemember(model); };
        // the origin: the middle of the base of the model (the object stands where it is clicked, whatever the origin of the file is), or the origin of the file as it is
        const origin = document.createElement("select");
        origin.title = "Where the object stands on the place that you click: the middle of its base, or the origin of the file as it is";
        [["base", "Origin: middle of the base"], ["file", "Origin: as in the file"]].forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; origin.appendChild(o); });
        origin.value = model.pivot ? "base" : "file";
        origin.onchange = () => { model.pivot = origin.value === "base" && model.base ? model.base.clone() : null; showObjects(); updateMarkers(); };
        const place = document.createElement("button");
        place.className = "small";
        place.textContent = "Place";
        place.onclick = () => { objectState.selected = name; renderObjects(); setMode("object"); };
        const remove = document.createElement("button");
        remove.className = "small danger";
        remove.textContent = "Remove from the track";
        remove.onclick = async () => {
            if (objectState.list.some((o) => o.model === name) && !(await OpenRacerDialog.ask({ title: "Remove this model?", text: "The objects that stand in the track go too.", ok: "Remove", danger: true }))) return;
            objectState.models.delete(name);
            objectState.list = objectState.list.filter((o) => o.model !== name);
            if (objectState.selected === name) objectState.selected = null;
            objectGizmo.detach(); objectUi.selected = -1;
            renderObjects(); updateMarkers();
        };
        row.append(title, origin, rigid, mass, remove);
        holder.appendChild(row);
    }
    // the objects that stand in the track: in the card, and as layers in the panel of the view (choose one: the gizmo shows, W moves, E turns, R scales; Delete takes it away)
    const layerList = $("objectLayers");
    for (const list of [$("objectList"), layerList]) {
        if (!list) continue;
        list.innerHTML = "";
        objectState.list.forEach((o, i) => {
            const row = document.createElement("div");
            const name = o.model.replace(OBJECT_PREFIX, "").replace(/\.glb$/, "");
            if (list === layerList) {
                row.className = "layer" + (objectUi.selected === i ? " selected" : "");
                row.innerHTML = "<i></i><span></span><span class=\"meta\"></span>";
                row.children[1].textContent = name;
                row.children[2].textContent = o.x.toFixed(0) + ", " + o.z.toFixed(0);
                row.title = "Choose it: W moves, E turns, R scales, Delete takes it away";
                row.onclick = () => selectObject(objectUi.selected === i ? -1 : i);
            } else {
                row.className = "gate";
                const text = document.createElement("span");
                text.textContent = name + ": " + o.x.toFixed(0) + ", " + o.z.toFixed(0);
                text.style.cursor = "pointer";
                text.style.fontWeight = objectUi.selected === i ? "700" : "400";
                text.onclick = () => selectObject(objectUi.selected === i ? -1 : i);
                const remove = document.createElement("button");
                remove.className = "small danger";
                remove.textContent = "Remove";
                remove.onclick = () => { objectState.list.splice(i, 1); selectObject(-1); updateMarkers(); };
                row.append(text, remove);
            }
            list.appendChild(row);
        });
    }
    if (layerList && !objectState.list.length) { const none = document.createElement("div"); none.style.cssText = "padding: 4px 14px; color: #66727f;"; none.textContent = "none placed"; layerList.appendChild(none); }
    $("objectNote").textContent = objectState.list.length ? objectState.list.length + " placed" : (objectState.models.size ? objectState.models.size + " models" : "none");
}
$("objectAdd").onclick = () => $("objectFile").click();
$("objectFile").onchange = async (e) => { for (const f of e.target.files) await addObjectModel(f); $("objectFile").value = ""; };

// ---- the library of models (objects/: a glb and a picture of every model, and objects.json): the same for every track. A click on a model puts it in this track and you are
// placing it (press on the road and drag for the way it faces); Escape goes back to Look. Written through the server (serve.py, start-server.sh).
const LIB_URL = "../objects/", LIB_API = "../api/objects/";
async function libraryPut(name, blob) {
    const r = await fetch(LIB_API + encodeURIComponent(name), { method: "PUT", body: blob });
    if (!r.ok) throw new Error("the server did not take “" + name + "” (is it running with start-server.sh?)");
}
async function libraryIndex() { await libraryPut("objects.json", new Blob([JSON.stringify({ objects: library.items }, null, 1)], { type: "application/json" })); }
async function loadLibrary() {
    try {
        const r = await fetch(LIB_URL + "objects.json", { cache: "no-store" });
        library.items = r.ok ? ((await r.json()).objects || []).filter((e) => e && e.id && e.file) : [];
    } catch (e) { library.items = []; }
    renderLibrary();
}
// a picture of a model: 192 pixels, see-through, from a corner above
let thumbRenderer = null;
function thumbOf(object) {
    if (!thumbRenderer) {
        thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
        thumbRenderer.setSize(192, 192, false);
        thumbRenderer.setClearColor(0x000000, 0);
    }
    const sc = new THREE.Scene();
    sc.add(new THREE.HemisphereLight(0xffffff, 0x667788, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(3, 5, 4);
    sc.add(sun);
    const copy = object.clone(true);
    sc.add(copy);
    copy.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(copy), size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 0.01);
    const cam = new THREE.PerspectiveCamera(30, 1, radius * 0.05, radius * 20);
    cam.position.copy(centre).add(new THREE.Vector3(1, 0.75, 1.2).normalize().multiplyScalar(radius / Math.sin(15 * Math.PI / 180) * 1.02));
    cam.lookAt(centre);
    thumbRenderer.render(sc, cam);
    return thumbRenderer.domElement.toDataURL("image/webp", 0.9);
}
// the model of a track in the library: its glb and its picture to the server, and in the list
async function keepInLibrary(model, fileName) {
    const base = (fileName || model.name.replace(OBJECT_PREFIX, "")).replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "").slice(0, 60) || "object";
    let id = base.toLowerCase(), k = 2;
    while (library.items.some((e) => e.id === id)) id = base.toLowerCase() + "-" + (k++);
    let blob = model.file;
    if (!blob && state.existingTrack) blob = await fileOf(trackFile(state.existingTrack, model.name));
    if (!blob) throw new Error("the file of the model is not here");
    const thumb = await (await fetch(thumbOf(model.scene))).blob();
    const entry = { id, name: base, file: id + ".glb", thumb: id + ".webp", kind: model.kind || "rigid", mass: model.mass || 0 };
    await libraryPut(entry.file, blob);
    await libraryPut(entry.thumb, thumb);
    library.items.push(entry);
    await libraryIndex();
    model.library = id;
    renderLibrary();
}
// what a model of the library says (kind, mass) is kept when it is changed below the library
let libraryTimer = null;
function libraryRemember(model) {
    const entry = library.items.find((e) => e.id === model.library);
    if (!entry) return;
    entry.kind = model.kind; entry.mass = model.mass || 0;
    clearTimeout(libraryTimer);
    libraryTimer = setTimeout(() => libraryIndex().catch(() => {}), 600);
}
async function useLibraryModel(entry) {
    let name = OBJECT_PREFIX + entry.id + ".glb";
    for (const [other, m] of objectState.models) if (m.library === entry.id) name = other;          // (the model is in the track already, under the name that it was added with)
    if (!objectState.models.has(name)) {
        let blob;
        try { blob = await (await fetch(LIB_URL + entry.file, { cache: "no-store" })).blob(); } catch (e) { blob = null; }
        const model = blob ? await makeObjectModel(blob, name, entry.kind, entry.mass) : null;
        if (!model) { status("The model “" + entry.name + "” of the library could not be read.", "error"); return; }
        model.library = entry.id;
        objectState.models.set(name, model);
    }
    objectState.selected = name;
    renderObjects();
    setMode("object");
    status("Placing “" + entry.name + "”: press on the road and drag to say which way it faces. Escape goes back to Look.", "ok");
}
// ---- the prefabs of the track designer, placed as objects: a glb of the prefab (track-design.js) with the texture chosen, put in the track like a model. The kind follows the
// role of the prefab: scenery stands in the track and is hit (static), decor is only drawn (decor). The same model is used again when it is in the track already.
// on a designed track the designer has its own prefab tools (the Prefabs tab: single ones and rows along a line), so this row is not shown there
const prefabThumbs = new Map();
function renderPrefabs() {
    const holder = $("objectPrefabs");
    if (!holder) return;
    holder.innerHTML = "";
    holder.style.display = design && design.active() ? "none" : "";
    if (design && design.active()) return;
    PREFAB_TYPES.forEach((p) => {
        const div = document.createElement("div");
        div.className = "libtile";
        div.style.background = "#1d2630";
        // a picture of the prefab (made once, when its textures are there): the tile is not black without one
        const thumb = prefabThumbs.get(p.type + (p.textures ? ":default" : ""));
        if (thumb) div.style.backgroundImage = "url(" + thumb + ")";
        else prefabReady(p.type, p.textures ? p.textures[0] : undefined).then((g) => { const url = thumbOf(g); prefabThumbs.set(p.type + (p.textures ? ":default" : ""), url); div.style.backgroundImage = "url(" + url + ")"; }).catch(() => {});
        div.title = p.label + (p.role === "scenery" ? ": stands in the track and is hit" : ": only drawn") + " — click to place it";
        const label = document.createElement("div");
        label.className = "name";
        label.textContent = p.icon + " " + p.label;
        div.appendChild(label);
        let choice = null;
        if (p.textures) {
            choice = document.createElement("select");
            choice.style.cssText = "position:absolute; left:4px; bottom:20px; right:4px; font-size:11px";
            choice.title = "The texture of the " + p.label.toLowerCase();
            p.textures.forEach((t) => { const o = document.createElement("option"); o.value = t; o.textContent = t; choice.appendChild(o); });
            choice.onclick = (e) => e.stopPropagation();
            div.appendChild(choice);
        }
        div.style.position = "relative";
        div.onclick = () => usePrefab(p, choice ? choice.value : null);
        holder.appendChild(div);
    });
}
async function usePrefab(p, texture) {
    const suffix = texture ? "-" + texture : "";
    const name = OBJECT_PREFIX + "prefab-" + p.type + suffix + ".glb";
    if (!objectState.models.has(name)) {
        let model = null;
        try {
            const blob = await prefabGlb(p.type, texture || undefined);
            model = await makeObjectModel(new File([blob], name, { type: "model/gltf-binary" }), name, p.role === "scenery" ? "static" : "decor", 0);
        } catch (error) { status("The prefab “" + p.label + "” could not be made: " + error.message, "error"); return; }
        if (!model) { status("The prefab “" + p.label + "” could not be read.", "error"); return; }
        model.prefab = { type: p.type, texture: texture || null };
        objectState.models.set(name, model);
    }
    objectState.selected = name;
    renderObjects();
    setMode("object");
    status("Placing “" + p.label + "”: press on the road and drag to say which way it faces. Escape goes back to Look.", "ok");
}

function renderLibrary() {
    const holder = $("objectLibrary");
    if (!holder) return;
    holder.innerHTML = "";
    const inLibrary = new Set(library.items.map((e) => OBJECT_PREFIX + e.id + ".glb"));
    const tile = (name, picture, local) => {
        const div = document.createElement("div");
        div.className = "libtile" + (local ? " local" : "") + (objectState.selected === (local ? local.name : name) && state.mode === "object" ? " on" : "");
        div.style.backgroundImage = "url(" + picture + ")";
        const label = document.createElement("div");
        label.className = "name";
        label.textContent = name;
        div.appendChild(label);
        return div;
    };
    library.items.forEach((entry) => {
        const div = tile(entry.name, LIB_URL + entry.thumb, null);
        const used = [...objectState.models].find(([, m]) => m.library === entry.id);
        if (used && objectState.selected === used[0] && state.mode === "object") div.classList.add("on");
        div.title = entry.name + ": click to place it in the track";
        div.onclick = () => useLibraryModel(entry);
        const x = document.createElement("button");
        x.className = "x"; x.textContent = "×"; x.title = "Take it out of the library (the tracks that use it keep their copy)";
        x.onclick = async (e) => {
            e.stopPropagation();
            if (!(await OpenRacerDialog.ask({ title: "Take “" + entry.name + "” out of the library?", text: "The tracks that use it keep their own copy.", ok: "Remove", danger: true }))) return;
            try {
                await fetch(LIB_API + encodeURIComponent(entry.file), { method: "DELETE" });
                await fetch(LIB_API + encodeURIComponent(entry.thumb), { method: "DELETE" });
                library.items = library.items.filter((o) => o !== entry);
                await libraryIndex();
            } catch (error) { status("Could not remove it: " + error.message, "error"); }
            renderLibrary();
        };
        div.appendChild(x);
        holder.appendChild(div);
    });
    // the models that this track has and the library has not (a track from before the library): they can be placed too, and kept in the library
    for (const [name, model] of objectState.models) {
        if (inLibrary.has(name) || model.library || !model.scene) continue;
        if (!model.thumbUrl) { try { model.thumbUrl = thumbOf(model.scene); } catch (e) { model.thumbUrl = ""; } }
        const div = tile(name.replace(OBJECT_PREFIX, "").replace(/\.glb$/, ""), model.thumbUrl, model);
        div.title = "A model of this track: click to place it. The button keeps it in the library.";
        div.onclick = () => { objectState.selected = name; renderObjects(); setMode("object"); };
        const badge = document.createElement("div");
        badge.className = "badge"; badge.textContent = "track";
        div.appendChild(badge);
        const keep = document.createElement("button");
        keep.className = "x"; keep.textContent = "+"; keep.title = "Keep it in the library";
        keep.onclick = async (e) => { e.stopPropagation(); try { await keepInLibrary(model); status("Kept in the library.", "ok"); } catch (error) { status("Could not keep it: " + error.message, "error"); } };
        div.appendChild(keep);
        holder.appendChild(div);
    }
    if (!holder.children.length) { const none = document.createElement("div"); none.className = "hint"; none.style.gridColumn = "1 / -1"; none.textContent = "The library is empty: add a model with +."; holder.appendChild(none); }
}
loadLibrary();

// the objects of a track that is opened: the models that its objects use are loaded from its folder
async function loadObjects(track) {
    objectGizmo.detach(); objectUi.selected = -1;
    objectState.models = new Map(); objectState.list = []; objectState.selected = null;
    for (const spec of track.objects || []) {
        if (!spec.model || !isFinite(spec.x) || !isFinite(spec.z)) continue;
        let model = objectState.models.get(spec.model);
        if (!model) {
            model = { name: spec.model, file: null, kind: spec.kind || (spec.rigid === false ? "decor" : "rigid"), mass: spec.mass || 0, scene: null, origin: "file", pivot: null, base: null };
            objectState.models.set(spec.model, model);
            await loadObjectScene(model, trackFile(track, spec.model));
            if (Array.isArray(spec.pivot) && spec.pivot.length === 3 && spec.pivot.every(isFinite)) model.pivot = new THREE.Vector3(spec.pivot[0], spec.pivot[1], spec.pivot[2]);
        }
        const scale = typeof spec.scale === "number" ? [spec.scale, spec.scale, spec.scale] : (Array.isArray(spec.scale) && spec.scale.length === 3 ? spec.scale : [1, 1, 1]);
        objectState.list.push({ model: spec.model, x: spec.x, y: isFinite(spec.y) ? spec.y : groundY(spec.x, spec.z), z: spec.z, heading: (spec.heading || 0) * Math.PI / 180,
            pitch: (spec.pitch || 0) * Math.PI / 180, roll: (spec.roll || 0) * Math.PI / 180, sx: scale[0] || 1, sy: scale[1] || 1, sz: scale[2] || 1 });
    }
    renderObjects(); updateMarkers();
}

function resetObjects() {
    objectGizmo.detach(); objectUi.selected = -1;
    objectState.models = new Map(); objectState.list = []; objectState.selected = null;
    renderObjects(); updateMarkers();
}

function renderGrid() {
    const list = $("gridList");
    if (!list) return;
    list.innerHTML = "";
    state.grid.forEach((b, i) => {
        const row = document.createElement("div");
        row.className = "gate";
        const text = document.createElement("span");
        text.textContent = (i === 0 ? "Box 1 (the start)" : "Box " + (i + 1)) + ": " + b.x.toFixed(1) + ", " + b.z.toFixed(1) + ", " + (b.heading * 180 / Math.PI).toFixed(0) + "°";
        text.style.cursor = "pointer"; text.title = "Choose it: move it with the gizmo (W), turn it (E)";
        text.style.fontWeight = boxSel.kind === "grid" && boxSel.i === i ? "700" : "400";
        text.onclick = () => selectBox("grid", i);
        const remove = document.createElement("button");
        remove.className = "small danger";
        remove.textContent = "Remove";
        remove.onclick = () => { state.grid.splice(i, 1); syncStart(); selectBox(null, -1); };
        row.appendChild(text);
        row.appendChild(remove);
        list.appendChild(row);
    });
    if (!state.grid.length) { const none = document.createElement("div"); none.className = "hint"; none.textContent = "No grid yet: place box 1 with the Grid box tool (it is the start of the track)."; list.appendChild(none); }
}
function renderPit() {
    const note = $("pitNote"), list = $("pitList");
    if (!note) return;
    const n = state.pitBoxes.length, old = state.pit ? state.pit.points.length : 0;
    note.textContent = n ? n + " box" + (n > 1 ? "es" : "") + (state.pitLine.length ? " + line" : "") : (old ? "old area" : (state.pitLine.length ? "line" : "none"));
    if (!list) return;
    list.innerHTML = "";
    state.pitBoxes.forEach((b, i) => {
        const row = document.createElement("div");
        row.className = "gate";
        const text = document.createElement("span");
        text.textContent = (i === 0 ? "Box 1 (the player)" : "Box " + (i + 1)) + ": " + b.x.toFixed(1) + ", " + b.z.toFixed(1) + ", " + (b.heading * 180 / Math.PI).toFixed(0) + "°";
        text.style.cursor = "pointer"; text.title = "Choose it: move it with the gizmo (W), turn it (E)";
        text.style.fontWeight = boxSel.kind === "pit" && boxSel.i === i ? "700" : "400";
        text.onclick = () => selectBox("pit", i);
        const remove = document.createElement("button");
        remove.className = "small danger";
        remove.textContent = "Remove";
        remove.onclick = () => { state.pitBoxes.splice(i, 1); selectBox(null, -1); };
        row.append(text, remove);
        list.appendChild(row);
    });
    if (!n) { const none = document.createElement("div"); none.className = "hint"; none.textContent = "No pit boxes yet: place box 1 (the player's) with the Pit box tool."; list.appendChild(none); }
    const lineNote = $("pitLineNote");
    if (lineNote) {
        const m = state.pitLine.length;
        let length = 0;
        for (let q = 1; q < m; q++) length += Math.hypot(state.pitLine[q].x - state.pitLine[q - 1].x, state.pitLine[q].z - state.pitLine[q - 1].z);
        lineNote.textContent = m ? "Pit line: " + m + " points, " + Math.round(length) + " m" + (m < 2 ? " (two at least)" : "") : "No pit line yet: the AI drives straight to its box without one.";
    }
    if (old) {
        const row = document.createElement("div");
        row.className = "gate";
        const text = document.createElement("span");
        text.textContent = "The old pit area (" + old + " points) is still in the track";
        const remove = document.createElement("button");
        remove.className = "small danger";
        remove.textContent = "Remove";
        remove.onclick = () => { state.pit = null; updateMarkers(); };
        row.append(text, remove);
        list.appendChild(row);
    }
}
function renderGates() {
    const list = $("gates");
    list.innerHTML = "";
    state.gates.forEach((gate, i) => {
        const row = document.createElement("div");
        row.className = "gate";
        const text = document.createElement("span");
        text.textContent = (i === 0 ? "Gate 1 (finish line)" : "Gate " + (i + 1)) + ": " + gate.x.toFixed(0) + ", " + gate.z.toFixed(0) + ", " + gate.width + " m";
        const remove = document.createElement("button");
        remove.className = "small danger";
        remove.textContent = "Remove";
        remove.onclick = () => { state.gates.splice(i, 1); selectGate(-1); };
        row.appendChild(text);
        row.appendChild(remove);
        list.appendChild(row);
    });
    const oldCheckpoints = state.existingTrack && state.existingTrack.checkpoints ? state.existingTrack.checkpoints.length : 0;
    $("gateNote").textContent = state.gates.length
        ? "The lap is counted when the car drives through all " + state.gates.length + " gates in order, in the direction of the arrows."
        : (oldCheckpoints ? "No gates: this track counts laps with " + oldCheckpoints + " road pieces (old format). Gates replace them." : "No gates: no laps are counted.");
}

function renderCameras() {
    const list = $("cameras");
    list.innerHTML = "";
    state.cameras.forEach((c, i) => {
        const row = document.createElement("div");
        row.className = "gate";
        if (i === state.camSel) row.style.background = "rgba(255, 208, 77, 0.12)";
        const text = document.createElement("span");
        text.textContent = "Camera " + (i + 1);
        text.style.cursor = "pointer";
        text.title = "Choose this camera";
        text.onclick = () => selectCamera(i === state.camSel ? -1 : i);
        row.appendChild(text);
        for (const key of ["x", "y", "z"]) {
            const input = document.createElement("input");
            input.type = "number"; input.step = "0.5"; input.value = c[key].toFixed(1); input.style.width = "62px"; input.title = key === "y" ? "Height (m)" : key;
            input.onchange = () => { const v = parseFloat(input.value); if (isFinite(v)) { c[key] = v; if (i === state.camSel && !state.camRange) camTarget.position.set(c.x, c.y, c.z); updateMarkers(); } };
            row.appendChild(input);
        }
        const radius = document.createElement("input");
        radius.type = "number"; radius.step = "1"; radius.min = "2"; radius.value = rangeOf(c).r.toFixed(0); radius.style.width = "56px"; radius.title = "Radius of the range (m)";
        radius.onchange = () => { const v = parseFloat(radius.value); if (isFinite(v) && v >= 2) { c.range = Object.assign({}, rangeOf(c), { r: v }); updateMarkers(); } };
        row.appendChild(radius);
        const remove = document.createElement("button");
        remove.className = "small danger";
        remove.textContent = "Remove";
        remove.onclick = () => { state.cameras.splice(i, 1); selectCamera(-1); updateMarkers(); };
        row.appendChild(remove);
        list.appendChild(row);
    });
    $("cameraNote").textContent = state.cameras.length ? state.cameras.length + " cameras" : "none";
}

// the grid and the pit area: their buttons
// (the clear buttons ask first: there is no undo for the markers, and one click took all the boxes)
const clearOk = (what, count) => count > 1 ? OpenRacerDialog.ask({ title: "Clear " + what + "?", text: "All " + count + " of them. This cannot be undone.", ok: "Clear", danger: true }) : Promise.resolve(true);
$("gridClear").onclick = async () => { if (!(await clearOk("the grid", state.grid.length))) return; state.grid = []; syncStart(); selectBox(null, -1); };
$("pitClear").onclick = async () => { if (!(await clearOk("the pit boxes", state.pitBoxes.length))) return; state.pitBoxes = []; selectBox(null, -1); };
$("pitLineUndo").onclick = () => { state.pitLine.pop(); updateMarkers(); };
$("pitLineClear").onclick = async () => { if (!(await clearOk("the pit line", state.pitLine.length))) return; state.pitLine = []; updateMarkers(); };
// the design of a track without a model: nodes, heights, widths and prefabs (see track-design.js)
const design = createDesign({
    scene, trackGroup, camera, renderer, controls, state, registerMesh, applyColours, renderParts, updateMarkers, frameTrack, status, $,
    setMode, getMode: () => state.mode, roleMaterials, screenSize,
    curbs: () => curbState.list.map((c) => ({ points: c.points, width: c.width })),
    blockPick: (event) => !!curbStripHit(event),
    snapStep: () => snapStep,
    renderLayers: () => { try { renderSurfaceLayers(); } catch (e) { /* (the designer is made further down: not yet) */ } },
    ownUndo: true, onCommit: () => noteDesignStep(), onSelect: () => clearSelection("design"), onRebuild: () => snapToSurface(), groundY: (x, z) => groundY(x, z)
});
window.__trackEditorView.design = design;          // (for the tests: the glb it makes)
function startDesign(data) {
    clearTrack();
    $("colour").checked = false; // a designed track is shown with its textures; the colours of the surfaces can be switched on
    design.enable(data);
    $("modes").classList.add("design");
    renderPrefabs();
    setMode("node");
}
function stopDesign() {
    design.disable();
    $("modes").classList.remove("design");
    renderPrefabs();
    if (state.mode === "node" || state.mode === "prefab") setMode("view");
}

function setMode(mode) {
    if (mode !== "curb" && typeof endCurbDraw === "function") endCurbDraw();
    if (state.mode === "measure" && mode !== "measure") clearMeasure();
    if (mode !== "view" && mode !== state.mode && state.mode !== undefined && typeof gizmoBusy === "function" && mode !== "curb") clearSelection();
    state.mode = mode;
    if (typeof renderLibrary === "function") renderLibrary();
    $("dragWindow").style.display = mode === "drag" ? "block" : "none";
    for (const button of document.querySelectorAll("#modes button")) button.classList.toggle("active", button.dataset.mode === mode);
    $("modes").classList.toggle("tool", mode !== "view");
    $("modes").classList.toggle("prefab", mode === "prefab");
    if (typeof design !== "undefined" && design && design.prefabStyle) try { syncPrefabStyle(); } catch (err) { /* (not yet made) */ }
    if (design && design.modeChanged) design.modeChanged(mode);
    if (editorReady) updateContext();
    $("hud").textContent = (design && design.hudText(mode)) || (mode === "grid" ? "Grid box: click on the road where box " + Math.min(GRID_MAX, state.grid.length + 1) + " is and drag in the direction that the car faces (box 1 is the start of the player, 2 to 8 the opponents)."
        : mode === "pitline" ? "Pit line: click on the road, in the order that a car drives: the first point on the racing line where the pit lane starts, then through the pit lane through the middle of every box, and the last point back on the racing line. Undo the last point in the Pit boxes card."
        : mode === "pitbox" ? "Pit box: click on the road where the box of a player is (4 by 8 m) and drag in the direction that the car faces. Box 1 is the player's, 2 to 8 the opponents', as the grid."
        : mode === "gate" ? "Add gate: click on the road and drag in the direction that the car drives through the gate."
        : mode === "camera" ? "Add camera: click on the road or beside it, the camera is put above that place (set the height in the list). Click a camera in Look to choose it and move it with the gizmo; the button above it changes its range."
        : mode === "object" ? "Place object: click on the road (or the ground) where the object stands, and drag to turn it. Add a model with + in the Objects card first."
        : mode === "drag" ? "Drag strip: click on the road where the start line is and drag in the direction of the strip."
        : mode === "measure" ? "Measure: click a point on the track, then the next ones; the length is shown here. Escape ends it."
        : mode === "refscale" ? "Scale by two points: click a place on the reference image whose distance to another place you know, then that other place (Escape cancels)."
        : mode === "curb" ? "Draw curb: click on the road to start a curb, and on to add nodes at its nearest end; click on the curb to add a node there; drag a node to move it. Enter: the next click starts a new curb."
        : "Look: drag to turn, right mouse button to move, scroll to zoom. Click a part to find it in the list.");
    if (typeof touchSync === "function") touchSync(true);
}
document.querySelectorAll("#modes button[data-mode]").forEach((b) => b.onclick = () => setMode(b.dataset.mode));
// how a new row of prefabs is made: Draw (a line is dragged) or Points (its points are clicked)
function syncPrefabStyle() { document.querySelectorAll("#modes button.sub").forEach((b) => b.classList.toggle("on", b.dataset.style === design.prefabStyle())); }
$("prefabAttach").addEventListener("change", () => design.setPrefabAttach($("prefabAttach").checked));
document.querySelectorAll("#modes button.sub").forEach((b) => b.onclick = () => { design.setPrefabStyle(b.dataset.style); syncPrefabStyle(); $("hud").textContent = design.hudText("prefab"); });
setMode("view");

function pointerRay(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster;
}

function roadHit(event) {
    const hits = pointerRay(event).intersectObjects(trackGroup.children, true);
    const drivable = hits.filter((h) => DRIVABLE[state.roles[h.object.name || ""]]);
    const hit = drivable[0] || hits[0] || null;
    // (Snap: an object or a camera goes to the grid; the other things are placed on the road itself)
    if (hit && snapStep && (state.mode === "object" || state.mode === "camera")) { hit.point.x = Math.round(hit.point.x / snapStep) * snapStep; hit.point.z = Math.round(hit.point.z / snapStep) * snapStep; }
    return hit;
}

let drag = null;
renderer.domElement.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    drag = { x: event.clientX, y: event.clientY, hit: null, moved: false };
    if (state.camRange && state.camSel >= 0) {
        // the nodes of the range of the chosen camera
        const nodes = pointerRay(event).intersectObjects(markers.children, false).filter((h) => h.object.userData.rangeNode);
        if (nodes.length) {
            drag.range = nodes[0].object.userData.rangeNode;
            drag.level = nodes[0].object.position.y;
            controls.enabled = false;
            renderer.domElement.setPointerCapture(event.pointerId);
            return;
        }
    }
    if ((state.mode === "grid" || state.mode === "pitbox" || state.mode === "pitline" || state.mode === "gate" || state.mode === "drag" || state.mode === "camera" || state.mode === "object") && !gizmoBusy()) {
        const hit = roadHit(event);
        if (hit) {
            drag.hit = hit;
            controls.enabled = false;
            renderer.domElement.setPointerCapture(event.pointerId);
        }
    }
});

// a node of a curb (in Look and in Draw curb): chosen, and dragged over the surface while the button is down. In the capture phase, before the designer of the
// road and the camera: they do not take the press too
renderer.domElement.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || (state.mode !== "view" && state.mode !== "curb") || lineEdit.editing || gizmoBusy()) return;
    const node = curbNodeHit(event);
    if (!node) return;
    drag = { x: event.clientX, y: event.clientY, hit: null, moved: false, curbNode: node };
    selectCurb(node[0], node[1]);
    renderer.domElement.setPointerCapture(event.pointerId);
    event.stopImmediatePropagation();
}, true);
renderer.domElement.addEventListener("pointermove", (event) => {
    if (!drag) return;
    if (Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) > 4) drag.moved = true;
    if (drag.curbNode) {
        const c = curbState.list[drag.curbNode[0]], n = c && c.nodes[drag.curbNode[1]];
        if (!n || !drag.moved) return;
        const p = surfacePoint(event, n[1]);
        if (!p) return;
        n[0] = p.x; n[1] = p.y; n[2] = p.z;
        if (c.connect) snapCurbNode(n);
        curbState.dragging = true;
        // the ball follows at once, the strip once per frame
        const ball = curbNodeLayer.children.find((b) => b.userData.curbNode[0] === drag.curbNode[0] && b.userData.curbNode[1] === drag.curbNode[1]);
        if (ball) ball.position.set(n[0], n[1] + 0.3 + ball.geometry.parameters.radius * 0.5, n[2]);
        scheduleCurb(drag.curbNode[0]);
        return;
    }
    if (drag.range) {
        const c = state.cameras[state.camSel];
        const p = pointerRay(event).ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -drag.level), new THREE.Vector3());
        if (c && p) {
            const range = rangeOf(c);
            if (drag.range === "centre") c.range = { x: p.x, z: p.z, r: range.r };
            else c.range = { x: range.x, z: range.z, r: Math.max(2, Math.hypot(p.x - range.x, p.z - range.z)) };
            updateMarkers();
        }
        return;
    }
    if (!drag.hit) return;
    // the direction: from the place that was clicked to where the pointer is, on the level of the road there
    const ray = pointerRay(event).ray;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -drag.hit.point.y);
    const p = ray.intersectPlane(plane, new THREE.Vector3());
    if (p && Math.hypot(p.x - drag.hit.point.x, p.z - drag.hit.point.z) > 0.5) {
        drag.heading = Math.atan2(p.z - drag.hit.point.z, p.x - drag.hit.point.x);
        place(drag, true);
    }
});

function place(d, preview) {
    const point = d.hit.point;
    const h = d.heading === undefined ? (state.start ? state.start.heading : 0) : d.heading;
    if (state.mode === "grid") {
        // (a box past the last one is not placed: d.full, not d.added, or the drag took the last box away and put this one in its place)
        if (d.full) return;
        if (preview && d.added) state.grid.pop();
        if (state.grid.length >= GRID_MAX) { status("The grid has its " + GRID_MAX + " boxes: remove one in the card first.", "error"); d.full = true; return; }
        state.grid.push({ x: point.x, y: point.y, z: point.z, heading: h });
        d.added = true;
        syncStart();
    } else if (state.mode === "pitbox") {
        // (a box past the last one is not placed: d.full, not d.added, or the drag took the last box away and put this one in its place)
        if (d.full) return;
        if (preview && d.added) state.pitBoxes.pop();
        if (state.pitBoxes.length >= GRID_MAX) { status("There are " + GRID_MAX + " pit boxes: remove one in the card first.", "error"); d.full = true; return; }
        state.pitBoxes.push({ x: point.x, y: point.y, z: point.z, heading: h });
        d.added = true;
        renderPit();
    } else if (state.mode === "drag") {
        state.drag = { x: point.x, y: point.y, z: point.z, heading: h, width: Math.max(3, parseFloat($("dragWidth").value) || 12), length: dragLength() };
        d.added = true;
    } else if (state.mode === "camera") {
        if (!d.added) state.cameras.push({ x: point.x, y: point.y + Math.max(0.5, parseFloat($("cameraHeight").value) || 3), z: point.z });
        d.added = true;
    } else if (state.mode === "object") {
        if (!objectState.selected || !objectState.models.has(objectState.selected)) { status("Add a model with + in the Objects card and choose Place first.", "error"); d.added = true; return; }
        if (preview && d.added) objectState.list.pop();
        objectState.list.push(newObject(objectState.selected, point.x, point.y, point.z, h));
        d.added = true;
        renderObjects();
    } else if (state.mode === "gate") {
        const width = Math.max(2, parseFloat($("gateWidth").value) || 24);
        if (preview && d.added) state.gates.pop();
        state.gates.push({ x: point.x, y: point.y, z: point.z, heading: h, width });
        d.added = true;
    }
    updateMarkers();
}

renderer.domElement.addEventListener("pointerup", (event) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    controls.enabled = true;
    if (d.range) { renderCameras(); return; }
    if (d.curbNode) {
        curbState.dragging = false;
        if (d.moved) { buildCurb(d.curbNode[0]); drawCurbNodes(); renderProps(); }
        return;
    }
    if (state.mode === "refscale") { if (!d.moved && !gizmoBusy()) refScaleClick(event); return; }
    if (state.mode === "measure") { if (!d.moved && !gizmoBusy()) measureClick(event); return; }
    if (d.hit) {
        if (state.mode === "pitline") { if (!d.moved) { state.pitLine.push({ x: d.hit.point.x, y: d.hit.point.y, z: d.hit.point.z }); updateMarkers(); } }
        else if (!d.added && (state.mode === "grid" || state.mode === "pitbox" || state.mode === "gate" || state.mode === "drag" || state.mode === "camera" || state.mode === "object")) place(d, false);
        return;
    }
    if (d.moved || gizmoBusy()) return;
    // Draw curb: a click on the road adds to the chosen curb (or starts one), a click on its strip puts a node there
    if (state.mode === "curb") { curbClick(event); return; }
    if (lineEdit.editing && !lineEdit.dragging) {
        const hits = pointerRay(event).intersectObjects(lineLayer.children, true).filter((h) => h.object.userData.lineNode !== undefined);
        if (hits.length) { selectLineNode(hits[0].object.userData.lineNode); return; }
        // a line that is drawn: a click on the road is the next node (Shift: between two others, as when a line is edited)
        const shift = event.shiftKey || touchInsert;
        if (lineEdit.drawing && !shift) {
            const road = roadHit(event);
            if (road) { lineEdit.nodes.push({ x: road.point.x, y: road.point.y, z: road.point.z }); selectLineNode(-1); return; }
        }
        const road = shift ? roadHit(event) : null;
        if (road) { addLineNodeAt(road.point.x, road.point.z); return; }
        if (!shift) { selectLineNode(-1); return; }
    }
    if (state.mode !== "view") return;
    // the designer of the road took the click (a node or a prefab was chosen by it)
    if (design.active() && design.selection() !== designSelAtDown) return;
    // a click on the strip of the chosen curb puts a node there
    if (curbState.selected >= 0) { const strip = curbStripHit(event); if (strip && strip.index === curbState.selected) { insertCurbNodeAt(strip.point); return; } }
    // what is clicked is chosen, and nothing else: a camera, a curb, an object, a gate, a box of the grid or of the pit; else (a track with a model) the part under the pointer
    const ray = pointerRay(event);
    const camHit = ray.intersectObjects(markers.children, false).find((h) => h.object.userData.camera !== undefined);
    if (camHit) { selectCamera(camHit.object.userData.camera, state.camRange && state.camSel === camHit.object.userData.camera); return; }
    // the drag strip: a click on one of its lines chooses it (the card shows its width and length)
    if (state.drag && ray.intersectObjects(markers.children, false).some((h) => h.object.userData.dragStrip)) { if (eventLayers.selected !== "drag") selectEvent("drag"); return; }
    const curbHit = curbStripHit(event);
    if (curbHit) { selectCurb(curbHit.index, -1); return; }
    const objectHit = ray.intersectObjects(objectLayer.children, true)[0];
    if (objectHit && objectIndexOf(objectHit.object) >= 0) { selectObject(objectIndexOf(objectHit.object)); return; }
    const markerHit = ray.intersectObjects(markers.children, false).find((h) => h.object.userData.gateIndex !== undefined || h.object.userData.box);
    if (markerHit && markerHit.object.userData.gateIndex !== undefined) { selectGate(markerHit.object.userData.gateIndex); return; }
    if (markerHit) { selectBox(markerHit.object.userData.box.kind, markerHit.object.userData.box.i); return; }
    if (design.active()) { clearSelection(); return; }
    const hit = ray.intersectObjects(trackGroup.children, true)[0];
    if (hit) { clearSelection("part"); selectPart(hit.object.name || "", true); }
    else clearSelection();
});
// what the designer had chosen when the button went down (its own handler runs first and chooses a node or a prefab)
let designSelAtDown = "";
renderer.domElement.addEventListener("pointerdown", () => { designSelAtDown = design.selection(); }, true);


$("topView").onclick = topView;
$("gateAtStart").onclick = () => {
    if (!state.start) { status("Place box 1 of the grid first (the start).", "error"); return; }
    const s = state.start;
    const width = Math.max(2, parseFloat($("gateWidth").value) || 24);
    // the finish line is a few metres in front of the start, so that the first gate is passed at the start of the first lap
    const x = s.x + Math.cos(s.heading) * 6, z = s.z + Math.sin(s.heading) * 6;
    state.gates.unshift({ x, y: groundY(x, z, s.y), z, heading: s.heading, width });
    selectGate(-1);
};

$("filter").addEventListener("input", renderParts);
$("colour").addEventListener("change", applyColours);
$("bulkApply").onclick = () => {
    if (state.legacy) return;
    const filter = $("filter").value.trim().toLowerCase();
    for (const name of state.parts.keys()) {
        if (!filter || name.toLowerCase().includes(filter)) state.roles[name] = $("bulkRole").value;
    }
    applyColours();
    renderParts();
};


// ---- the sky and the light

function readEnv() {
    const e = OpenRacer.environmentDefaults();
    e.sky_top = $("skyTop").value;
    e.sky_horizon = $("skyHorizon").value;
    e.sky_image = state.skyFile ? state.skyFile.name : state.skyName;
    e.fog = { enabled: $("fogOn").checked, color: $("fogColor").value, near: parseFloat($("fogNear").value) || 0, far: Math.max(10, parseFloat($("fogFar").value) || 1000) };
    e.sun = { azimuth: parseFloat($("sunAz").value) || 0, elevation: Math.min(90, Math.max(2, parseFloat($("sunEl").value) || 45)), intensity: Math.max(0, parseFloat($("sunInt").value)), color: $("sunColor").value };
    if (!isFinite(e.sun.intensity)) e.sun.intensity = 1;
    e.ambient = { color: $("ambColor").value, intensity: Math.max(0, parseFloat($("ambInt").value)) };
    if (!isFinite(e.ambient.intensity)) e.ambient.intensity = 1;
    return e;
}

function fillEnv(e) {
    state.env = e;
    $("skyTop").value = e.sky_top;
    $("skyHorizon").value = e.sky_horizon;
    $("fogOn").checked = e.fog.enabled;
    $("fogColor").value = e.fog.color;
    $("fogNear").value = e.fog.near;
    $("fogFar").value = e.fog.far;
    $("sunAz").value = e.sun.azimuth;
    $("sunEl").value = e.sun.elevation;
    $("sunInt").value = e.sun.intensity;
    $("sunColor").value = e.sun.color;
    $("ambColor").value = e.ambient.color;
    $("ambInt").value = e.ambient.intensity;
    $("skyImageName").textContent = state.skyFile ? state.skyFile.name : (state.skyName || "");
}

// shows the sky and the light in the view
function applyEnv() {
    state.envOn = $("envOn").checked;
    $("envFields").style.opacity = state.envOn ? 1 : 0.45;
    if (sky) { scene.remove(sky); sky = null; }
    if (!state.envOn) {
        scene.background = new THREE.Color(0x20262f);
        scene.fog = null;
        hemi.color.set(0xffffff); hemi.groundColor.set(0x556070); hemi.intensity = 1.1;
        sun.color.set(0xffffff); sun.intensity = 1.4; sun.position.set(50, 120, 80);
        return;
    }
    const e = state.env = readEnv();
    const v = OpenRacer.sunVector(e, 500);
    sun.position.set(v.x, v.y, v.z);
    sun.color.set(e.sun.color);
    sun.intensity = 1.8 * e.sun.intensity;
    hemi.color.set(e.sky_top); hemi.groundColor.set(e.ambient.color); hemi.intensity = 0.9 * e.ambient.intensity + 0.2;
    const build = (texture) => {
        if (sky) scene.remove(sky);
        sky = OpenRacer.makeSky(THREE, e, texture);
        sky.scale.setScalar(Math.min(1, (state.far || 3500) * 0.9 / 3000));
        scene.add(sky);
    };
    if (state.skyFile) build(new THREE.TextureLoader().load(URL.createObjectURL(state.skyFile)));
    else if (state.skyName && state.existingTrack) build(new THREE.TextureLoader().load(trackFile(state.existingTrack, state.skyName)));
    else build(null);
    // the fog is not shown here: seen from above the whole track would disappear in it
    scene.background = new THREE.Color(e.sky_horizon);
    scene.fog = null;
}

for (const id of ["envOn", "skyTop", "skyHorizon", "fogOn", "fogColor", "fogNear", "fogFar", "sunAz", "sunEl", "sunInt", "sunColor", "ambColor", "ambInt"]) {
    $(id).addEventListener("input", applyEnv);
}
$("skyImage").addEventListener("change", (e) => {
    if (e.target.files.length) { state.skyFile = e.target.files[0]; $("skyImageName").textContent = state.skyFile.name; applyEnv(); }
});
$("skyImageClear").onclick = () => { state.skyFile = null; state.skyName = ""; $("skyImage").value = ""; $("skyImageName").textContent = ""; applyEnv(); };
$("envDefaults").onclick = () => { state.skyFile = null; state.skyName = ""; $("skyImage").value = ""; fillEnv(OpenRacer.environmentDefaults()); applyEnv(); };

// ---- tracks that exist

async function refreshList(select) {
    try {
        // the tracks of the server, of the garage of this browser and of a linked folder (Catalog.js)
        state.tracks = await Catalog.load("tracks", "../");
    } catch (error) {
        state.tracks = [];
    }
    const el = $("existing");
    el.innerHTML = '<option value="">—</option>' + state.tracks.map((t) => {
        const source = OpenRacer.Garage.sourceOf(t);
        const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
        return '<option value="' + esc(t.id) + '">' + esc(t.name || t.id) + " (" + esc(t.id) + ")" + (source === "garage" ? " · my garage" : source === "folder" ? " · folder" : "") + "</option>";
    }).join("");
    el.value = select || "";
}

let loadToken = 0;
async function loadExisting() {
    const id = $("existing").value;
    if (!id) return;
    const track = state.tracks.find((t) => t.id === id);
    if (!track) return;
    const token = ++loadToken;          // (a second track chosen while this one loads: this one stops)
    stopLineEdit(); clearSelection(); clearMeasure(); if (state.mode !== "view") setMode("view");
    state.existingId = id;
    state.existingTrack = track;
    state.files = new Map();
    state.mainFile = null;
    state.thumbnail = null;          // (a picture taken of another track was saved as the picture of this one)
    $("name").value = track.name || "";
    $("id").value = id;
    $("id").disabled = false;
    $("description").value = track.description || "";
    state.idEdited = true;
    state.skyFile = null;
    state.skyName = (track.environment && track.environment.sky_image) || "";
    state.oldSkyName = state.skyName;
    $("skyImage").value = "";
    fillEnv(OpenRacer.environmentOf(track));
    $("envOn").checked = !!(track.model || track.environment);
    applyEnv();
    // the grid: the boxes of the file, or box 1 from the start of a track from before the grid
    state.grid = Array.isArray(track.grid) && track.grid.length ? track.grid.filter((b) => b && isFinite(b.x) && isFinite(b.z)).slice(0, GRID_MAX).map((b) => ({ x: b.x, y: 0, z: b.z, heading: b.heading || 0 }))
        : (track.start ? [{ x: track.start.x, y: 0, z: track.start.z, heading: track.start.heading || 0 }] : []);
    syncStart();
    state.pitBoxes = track.pit && Array.isArray(track.pit.boxes) ? track.pit.boxes.filter((b) => b && isFinite(b.x) && isFinite(b.z)).slice(0, GRID_MAX).map((b) => ({ x: b.x, y: 0, z: b.z, heading: b.heading || 0 })) : [];
    state.pitLine = track.pit && Array.isArray(track.pit.line) ? track.pit.line.filter((q) => Array.isArray(q) && isFinite(q[0]) && isFinite(q[1])).map((q) => ({ x: q[0], y: 0, z: q[1] })) : [];
    state.pit = track.pit && Array.isArray(track.pit.polygon) ? { points: track.pit.polygon.filter((q) => Array.isArray(q) && isFinite(q[0]) && isFinite(q[1])).map((q) => ({ x: q[0], y: 0, z: q[1] })) } : null;
    if (state.pit && !state.pit.points.length) state.pit = null;
    state.gates = []; gateGizmo.detach(); gateUi.selected = -1;
    state.cameras = [];
    $("delete").style.display = "";
    $("editing").textContent = "Changing the track “" + id + "”. Saving overwrites it.";
    status("Loading…");
    try {
        state.loadedDesign = null;
        if (track.design && track.design.nodes) {
            startDesign(JSON.parse(JSON.stringify(track.design))); setMode("view");
            // (the design as the designer made it at load, to compare at the save: it adds the textures and snaps the rows again, and track.design differed with no change)
            state.loadedDesign = JSON.stringify(design.toJSON());
        }
        else if (track.model) { stopDesign(); await loadGltfTrack(track); }
        else { stopDesign(); await loadLegacyTrack(track); }
        if (token !== loadToken) return;
        // the heights of the start and the gates come from the road
        state.grid.forEach((b) => { b.y = groundY(b.x, b.z); });
        syncStart();
        if (state.pit) state.pit.points.forEach((q) => { q.y = groundY(q.x, q.z); });
        state.pitBoxes.forEach((b) => { b.y = groundY(b.x, b.z); });
        state.pitLine.forEach((q) => { q.y = groundY(q.x, q.z); });
        $("showGates").checked = !!track.show_gates;
        gateGizmo.detach(); gateUi.selected = -1;
        state.gates = (track.gates || []).map((g) => ({ x: g.x, y: groundY(g.x, g.z, Number.isFinite(g.y) ? g.y : undefined), z: g.z, heading: g.heading, width: g.width || 24 }));
        state.cameras = (track.cameras || []).filter((c) => isFinite(c.x) && isFinite(c.z)).map((c) => {
            const camera = { x: c.x, y: isFinite(c.y) ? c.y : groundY(c.x, c.z) + 3, z: c.z };
            if (c.range && isFinite(c.range.x) && isFinite(c.range.z) && c.range.r > 0) camera.range = { x: c.range.x, z: c.range.z, r: c.range.r };
            return camera;
        });
        selectCamera(-1);
        await loadObjects(track);
        if (token !== loadToken) return;
        resetCurbs(track.curbs);
        await resetRef(track);
        if (token !== loadToken) return;
        state.drag = track.dragstrip ? { x: track.dragstrip.x, y: groundY(track.dragstrip.x, track.dragstrip.z), z: track.dragstrip.z, heading: track.dragstrip.heading || 0, width: track.dragstrip.width || 12, length: track.dragstrip.length || 402.336 } : null;
        showDrag();
        updateMarkers();
        updateLineNote();
        status("", "");
        markSaved();
        resetHistory();
        try { localStorage.setItem(LAST_TRACK, id); } catch (e) { /* (private window) */ }
    } catch (error) {
        if (token !== loadToken) return;
        // (half of this track and half of the one before stayed in the editor, and a save wrote that over this track: an empty track instead)
        newTrack();
        status("Could not load the track “" + id + "”: " + error.message + ". The editor has an empty track now.", "error");
    }
}

function newTrack() {
    loadToken++;
    stopLineEdit(); clearSelection(); clearMeasure();
    state.existingId = null;
    state.existingTrack = null;
    state.thumbnail = null;
    state.files = new Map();
    state.mainFile = null;
    state.start = null;
    state.grid = [];
    state.pit = null;
    state.pitBoxes = [];
    state.pitLine = [];
    state.gates = []; gateGizmo.detach(); gateUi.selected = -1;
    $("showGates").checked = true;
    state.cameras = [];
    resetObjects();
    resetCurbs([]);
    clearRef(); refState.oldName = "";
    selectCamera(-1);
    state.drag = null;
    state.legacy = false;
    state.idEdited = false;
    clearTrack();
    renderParts();
    updateMarkers();
    markers.clear();
    state.skyFile = null; state.skyName = ""; state.oldSkyName = "";
    $("skyImage").value = "";
    fillEnv(OpenRacer.environmentDefaults());
    $("envOn").checked = true;
    applyEnv();
    $("existing").value = "";
    $("files").value = "";
    $("name").value = "";
    $("id").value = "";
    $("description").value = "";
    $("modelInfo").textContent = "No model loaded.";
    $("delete").style.display = "none";
    $("editing").textContent = "Choose a track to change it, or import a model below.";
    status("");
    updateLineNote();
    startDesign(null);
    status("A new track: draw it with nodes in the view, or import a model.", "ok");
    markSaved();
    resetHistory();
}

// ---- the thumbnail: the track as the game shows it, from the camera as it stands, without the markers, the nodes, the gizmos and the line (everything in the scene that is
// not the track itself, its objects, its sky and its lights is hidden for one frame); 640 by 360, saved with the track as preview.webp (the menu shows it on the track's card)
function takeThumbnail() {
    if (!state.root && !design.active()) { status("Load or draw a track first.", "error"); return; }
    const keep = new Set([trackGroup, objectLayer, curbLayer, hemi, sun]);
    if (sky) keep.add(sky);
    const hidden = [];
    scene.children.forEach((o) => { if (!keep.has(o) && o.visible) { o.visible = false; hidden.push(o); } });
    // the track with its textures, as the game shows it: the colours of the roles and the highlight of a chosen part are off for the picture
    const colourWas = $("colour").checked, selectedWas = state.selected;
    $("colour").checked = false; state.selected = null; applyColours();
    try {
        renderer.render(scene, camera);
        const out = document.createElement("canvas");
        out.width = 640; out.height = 360;
        const ctx = out.getContext("2d");
        const src = renderer.domElement, sw = src.width, sh = src.height, want = 16 / 9;
        // the middle of the view, cut to 16:9
        let cw = sw, ch = Math.round(sw / want); if (ch > sh) { ch = sh; cw = Math.round(sh * want); }
        ctx.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, 640, 360);
        out.toBlob((blob) => {
            if (!blob) { status("The thumbnail could not be made.", "error"); return; }
            state.thumbnail = blob;
            const url = URL.createObjectURL(blob);
            status("Thumbnail taken (640 x 360): it is saved with the track. ", "ok");
            const img = document.createElement("img");
            img.src = url; img.style.cssText = "height: 54px; border-radius: 6px; vertical-align: middle; margin-left: 8px;";
            $("status").appendChild(img);
        }, "image/webp", 0.86);
    } finally {
        hidden.forEach((o) => { o.visible = true; });
        $("colour").checked = colourWas; state.selected = selectedWas; applyColours();
    }
}
$("thumbnail").addEventListener("click", takeThumbnail);

// ---- saving

// Writes track.json (and files) through the server when it is there (serve.py), otherwise to the garage of this browser (Garage.js)
async function store(id, config, files, remove) {
    return OpenRacer.Garage.store("tracks", id, config, files || {}, { base: "../", remove: remove || [] });
}

// a file of a track that is copied into another folder: only when it is there (a 404 page was stored as the model, the sky or an object of the copy)
async function fileOf(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(decodeURIComponent(url.split("/").pop()) + " could not be read (HTTP " + response.status + ")");
    return response.blob();
}
async function save() {
    try {
        const name = $("name").value.trim();
        const id = $("id").value.trim() || slug(name);
        if (!name) throw new Error("Give the track a name.");
        if (!ID_PATTERN.test(id)) throw new Error("The id may only have lower case letters, digits, - and _.");
        if (!state.start) throw new Error("Place box 1 of the grid on the road: it is the start of the track.");
        if (!state.root && !design.active()) throw new Error("Import a model first, or draw the track with nodes.");
        if (state.tracks.some((t) => t.id === id) && id !== state.existingId &&
            !(await OpenRacerDialog.ask({ title: "Replace the track “" + id + "”?", text: "There already is a track with this id.", ok: "Replace" }))) return;

        const old = state.existingTrack;
        // (a copy under another id starts from the track too: it lost the racing line, the skidpad and what else only the file has; the model, the sky and the
        // objects are written below for the new folder; audit 2.2.0 §3.24)
        const config = old ? JSON.parse(JSON.stringify(old)) : {};
        // (a copy with another model that was imported: the racing line and the skidpad of the old road do not fit it, and the AI followed them. A drawn track
        // makes the same road from the same design, and keeps them)
        if (old && id !== state.existingId && !design.active() && state.mainFile && state.files.size) { delete config.racing_line; delete config.skidpad; }
        delete config.id;
        config.name = name;
        config.description = $("description").value.trim();
        config.start = { x: +state.start.x.toFixed(3), z: +state.start.z.toFixed(3), heading: +state.start.heading.toFixed(5) };      // (box 1 of the grid: the start, as before the grid)
        config.grid = state.grid.map((b) => ({ x: +b.x.toFixed(3), z: +b.z.toFixed(3), heading: +b.heading.toFixed(5) }));
        const pit = {};
        if (state.pitBoxes.length) pit.boxes = state.pitBoxes.map((b) => ({ x: +b.x.toFixed(3), z: +b.z.toFixed(3), heading: +b.heading.toFixed(5) }));
        if (state.pit && state.pit.points.length >= 3) pit.polygon = state.pit.points.map((q) => [+q.x.toFixed(2), +q.z.toFixed(2)]);
        if (state.pitLine.length >= 2) pit.line = state.pitLine.map((q) => [+q.x.toFixed(2), +q.z.toFixed(2)]);
        if (pit.boxes || pit.polygon || pit.line) config.pit = pit; else delete config.pit;
        if (state.gates.length) {
            config.gates = state.gates.map((g) => ({ x: +g.x.toFixed(3), z: +g.z.toFixed(3), heading: +g.heading.toFixed(5), width: g.width, y: +g.y.toFixed(2) }));
            if ($("showGates").checked) config.show_gates = true; else delete config.show_gates;
            delete config.checkpoints; // gates replace the road pieces of the old format
        } else {
            delete config.gates;
        }

        if (state.cameras.length) config.cameras = state.cameras.map((c) => Object.assign({ x: +c.x.toFixed(2), y: +c.y.toFixed(2), z: +c.z.toFixed(2) }, c.range ? { range: { x: +c.range.x.toFixed(2), z: +c.range.z.toFixed(2), r: +c.range.r.toFixed(1) } } : {}));
        else delete config.cameras;
        const curbs = curbsJSON();
        if (curbs.length) config.curbs = curbs; else delete config.curbs;

        if (state.drag) config.dragstrip = { x: +state.drag.x.toFixed(3), z: +state.drag.z.toFixed(3), heading: +state.drag.heading.toFixed(5), width: state.drag.width, length: +state.drag.length.toFixed(2) };
        else delete config.dragstrip;

        const uploads = [];
        let oldModel = null;
        if (state.thumbnail) uploads.push(["preview.webp", state.thumbnail]);            // the picture of the track for the menu (the Thumbnail button)
        if (design.active()) {
            if (design.toJSON().nodes.length < 3) throw new Error("A track needs at least three nodes.");
            status("Making the model of the track…");
            const buffer = await design.exportGlb();
            const fileName = id + ".glb";
            uploads.push([fileName, new Blob([buffer], { type: "model/gltf-binary" })]);
            oldModel = old && old.model && id === state.existingId && old.model !== fileName ? old.model : null;
            config.model = fileName;
            config.design = design.toJSON();
            delete config.geometry; delete config.scene; delete config.textures;
        } else if (state.mainFile && state.files.size) {
            delete config.design;
            for (const [fileName, file] of state.files) {
                if (!FILE_PATTERN.test(fileName)) throw new Error("The file name “" + fileName + "” has characters that are not allowed. Use letters, digits, - _ . and spaces.");
                uploads.push([fileName, file]);
            }
            oldModel = old && old.model && id === state.existingId && old.model !== state.mainFile ? old.model : null;
            config.model = state.mainFile;
            delete config.geometry; delete config.scene; delete config.textures;
        } else if (state.legacy) {
            if (id !== state.existingId) throw new Error("A track of the old format can only be saved under its own id. Import a glb to make a new track.");
        } else if (old && old.model && id !== state.existingId) {
            const blob = await fileOf(trackFile(old, old.model));
            if (!/\.glb$/i.test(old.model)) throw new Error("To save this track under another id, import its model files again.");
            uploads.push([old.model, blob]);
            config.model = old.model;
        }
        // the objects: their models go in the folder of the track; the objects of the old file that have no model of ours (written by hand) stay
        const handMade = (old && id === state.existingId && Array.isArray(old.objects) ? old.objects : (old && Array.isArray(old.objects) ? old.objects : [])).filter((o) => !o.model);
        const made = [];
        for (const o of objectState.list) {
            const model = objectState.models.get(o.model);
            if (!model) continue;
            if (!FILE_PATTERN.test(model.name)) throw new Error("The file name “" + model.name + "” has characters that are not allowed.");
            const spec = { model: model.name, x: +o.x.toFixed(3), z: +o.z.toFixed(3), y: +o.y.toFixed(3), heading: +(o.heading * 180 / Math.PI).toFixed(2) };
            if (model.pivot) spec.pivot = [+model.pivot.x.toFixed(4), +model.pivot.y.toFixed(4), +model.pivot.z.toFixed(4)];
            if (Math.abs(o.pitch || 0) > 1e-4) spec.pitch = +(o.pitch * 180 / Math.PI).toFixed(2);
            if (Math.abs(o.roll || 0) > 1e-4) spec.roll = +(o.roll * 180 / Math.PI).toFixed(2);
            const sc = [o.sx || 1, o.sy || 1, o.sz || 1].map((v) => +v.toFixed(4));
            if (Math.abs(sc[0] - 1) > 1e-4 || Math.abs(sc[1] - 1) > 1e-4 || Math.abs(sc[2] - 1) > 1e-4) spec.scale = (sc[0] === sc[1] && sc[1] === sc[2]) ? sc[0] : sc;
            const kind = model.kind || "rigid";
            if (kind === "rigid") { if (model.mass > 0) spec.mass = model.mass; }
            else { spec.kind = kind; if (kind === "decor") spec.rigid = false; }        // (rigid: false too, for an older game that only knows that)
            made.push(spec);
        }
        for (const model of objectState.models.values()) {
            if (!made.some((o) => o.model === model.name)) continue;
            if (model.file) uploads.push([model.name, model.file]);
            else if (id !== state.existingId && state.existingTrack) uploads.push([model.name, await fileOf(trackFile(state.existingTrack, model.name))]);
        }
        // the road changed under the same id (other nodes, another model): the laps driven on the old road are no longer the line of the AI (Records.anyGhost),
        // and a recorded line of another model is dropped (the AI drove the old road into the new walls). A design keeps its line: it can be edited to fit
        let lineOfOldRoad = false;
        if (old && id === state.existingId) {
            const newModel = !design.active() && state.mainFile && state.files.size;
            if (newModel) delete config.racing_line;          // (the skidpad stays: its radius is not the road of the model)
            if (newModel || (config.design && state.loadedDesign !== JSON.stringify(config.design))) {
                // (road_date: a record from before is replaced by the next lap, Records.lap; line_date: no older lap is the line of the AI)
                config.line_date = config.road_date = new Date().toISOString();
                lineOfOldRoad = !!(config.racing_line && config.racing_line.length);
            }
        }
        if (handMade.length || made.length) config.objects = handMade.concat(made); else delete config.objects;
        let oldSky = null;
        if (state.envOn) {
            const e = readEnv();
            if (state.skyFile) {
                if (!FILE_PATTERN.test(state.skyFile.name)) throw new Error("The file name of the sky picture has characters that are not allowed.");
                uploads.push([state.skyFile.name, state.skyFile]);
                if (state.oldSkyName && state.oldSkyName !== state.skyFile.name && id === state.existingId) oldSky = state.oldSkyName;
            } else if (state.skyName && id !== state.existingId && state.existingId) {
                const blob = await fileOf(trackFile(state.existingTrack, state.skyName));
                uploads.push([state.skyName, blob]);
            } else if (!state.skyName && state.oldSkyName && id === state.existingId) {
                oldSky = state.oldSkyName;
            }
            e.sky_image = state.skyFile ? state.skyFile.name : state.skyName;
            if (!e.sky_image) delete e.sky_image;
            config.environment = e;
        } else {
            delete config.environment;
            if (state.oldSkyName && id === state.existingId) oldSky = state.oldSkyName;
        }
        if (!state.legacy) {
            const meshes = {};
            for (const [partName, role] of Object.entries(state.roles)) if (role !== "scenery" && partName) meshes[partName] = role;
            config.surfaces = { meshes };
        }

        // the reference image (only for this editor): the picture that was picked, or the one of the track copied into a new folder
        let oldRef = null;
        const ref = refJSON();
        if (ref) {
            if (refState.file) {
                uploads.push([ref.image, refState.file]);
                if (refState.oldName && refState.oldName !== ref.image && id === state.existingId) oldRef = refState.oldName;
            } else if (id !== state.existingId && state.existingId) uploads.push([ref.image, await fileOf(trackFile(state.existingTrack, ref.image))]);
            config.reference = ref;
        } else {
            delete config.reference;
            if (refState.oldName && id === state.existingId) oldRef = refState.oldName;
        }

        status("Saving…");
        const files = {};
        for (const [fileName, file] of uploads) files[fileName] = file;
        const saved = await store(id, config, files, [oldSky, oldModel, oldRef].filter(Boolean));
        state.existingId = id;
        state.existingTrack = Object.assign({}, config, { id });
        state.loadedDesign = config.design ? JSON.stringify(config.design) : null;
        state.files = new Map();
        state.mainFile = null;
        state.skyName = config.environment && config.environment.sky_image || "";
        state.oldSkyName = state.skyName;
        state.skyFile = null;
        refState.name = ref ? ref.image : ""; refState.oldName = refState.name; refState.file = null;
        state.thumbnail = null;          // (it is preview.webp now; a later save of another track did not get it)
        for (const m of objectState.models.values()) m.file = null;       // the models are in the folder of the track now
        await refreshList(id);
        // (the track as the list has it now, with where it is kept: the copy of the form had no garage mark, and a second copy of a garage track looked for its files on the server)
        const fresh = state.tracks.find((t) => t.id === id);
        if (fresh) state.existingTrack = fresh;
        $("delete").style.display = "";
        updateLineNote();
        // what the game still needs to race here (it saved, and said it was ready, with no gates or no line for the AI)
        const missing = [];
        const special = config.skidpad || (config.dragstrip && !(config.gates || []).length);       // (a skidpad or a drag strip: no laps, no AI)
        if (!special && !(config.gates || []).length && !(config.checkpoints || []).length) missing.push("no gates: no lap counts (Gates, put gate 1 on the start line)");
        if (!special && !(config.racing_line && config.racing_line.length > 10) && !(config.design && config.design.nodes)) missing.push("no racing line: the AI cannot race here (Record AI racing line)");
        if (lineOfOldRoad) missing.push("the racing line was made on the road as it was: record it again, or edit it to the new road");
        status((saved.where === "server" ? "Saved as tracks/" + id + ". It is in the main menu of the game now."
            : "Saved in your garage, in this browser (the server does not save). It is in the main menu of the game now.") +
            (missing.length ? "\nStill to do: " + missing.join("; ") + "." : "") +
            (curbState.list.some((c) => c.nodes.length === 1) ? "\nA curb with one node is not saved: give it a second node." : ""), missing.length ? "warn" : "ok");
        markSaved();
    } catch (error) {
        status(error.message, "error");
    }
}

async function deleteTrack() {
    if (!state.existingId || !(await OpenRacerDialog.ask({ title: "Delete the track “" + state.existingId + "”?", text: "With all its files.", ok: "Delete", danger: true }))) return;
    let result;
    try {
        result = await OpenRacer.Garage.discard("tracks", state.existingId, { base: "../" });
    } catch (error) {
        status("The track could not be deleted (" + error.message + ").", "error");
        return;
    }
    newTrack();
    await refreshList();
    status(result.where === "server" ? "Deleted." : "Deleted from your garage.", "ok");
}

// ---- the AI racing line: recorded by driving in the game (main.js, ?recordline=1), which comes back here with ?track=<id>&line=<result>

function updateLineNote() {
    const track = state.existingTrack;
    const line = track && track.racing_line;
    $("lineNote").textContent = !track ? "save the track first"
        : line && line.length > 10 ? "recorded, " + line.length + " points"
        : (track.design && track.design.nodes ? "the middle of the road (not recorded)" : "none: the AI cannot race here");
    $("recordLine").disabled = !track;
    $("clearLine").style.display = line && line.length ? "" : "none";
    drawLine();
}

// the car to drive with: the one chosen last in the main menu, or else the first one
async function lastCar() {
    let car = null;
    try { car = (JSON.parse(localStorage.getItem("openracer.lastChoice")) || {}).car; } catch (e) { /* no storage */ }
    if (!car) {
        try { const cars = await Catalog.load("cars", "../"); car = cars.length ? cars[0].id : null; } catch (e) { /* nothing to drive */ }
    }
    return car;
}

// Test drive: the saved track in the game, in a tab of its own, alone on it (it was save, go to the game and find the track in the menu). The tab is opened
// at the click, before the save, or the browser takes it for a pop-up
async function testDrive() {
    const tab = window.open("", "_blank");
    const fail = (text) => { if (tab) tab.close(); status(text, "error"); };
    if (unsaved() || !state.existingId) {
        await save();
        if (unsaved() || !state.existingId) { if (tab) tab.close(); return; }           // (the save failed or was cancelled: its message is shown)
    }
    const car = await lastCar();
    if (!car) { fail("No car to drive with."); return; }
    const url = "../index.html?car=" + encodeURIComponent(car) + "&track=" + encodeURIComponent(state.existingId) + "&ai=0";
    if (tab) tab.location.href = url; else window.location.href = url;
}

$("recordLine").onclick = async () => {
    if (!state.existingId) { status("Save the track first: the line is recorded on the saved track.", "error"); return; }
    const car = await lastCar();
    if (!car) { status("No car to drive with.", "error"); return; }
    // the line is recorded on the saved track: the changes are saved first (they were thrown away, gates too, and then no lap of the saved track counted)
    if (unsaved()) {
        if (!(await OpenRacerDialog.ask({ title: "Save the track first?", text: "The line is recorded on the saved track. Save the changes and drive it?", ok: "Save and record" }))) return;
        await save();
        if (unsaved()) return;           // (the save failed: its message is shown)
    }
    const saved = state.existingTrack;
    if (!(saved.gates || []).length && !(saved.checkpoints || []).length) { status("Place a gate at the start first and save: a lap is counted through the gates.", "error"); return; }
    savedPrint = null;           // (the question was asked: the page may go)
    window.location.href = "../index.html?car=" + encodeURIComponent(car) + "&track=" + encodeURIComponent(state.existingId) + "&recordline=1&ai=0&ghost=0&records=0";
};

$("editLine").onclick = startLineEdit;
$("drawLine").onclick = () => {
    if (!state.existingId) { status("Save the track first: the line is saved on the saved track.", "error"); return; }
    startLineDraw();
};
$("undoLineNode").onclick = undoLineNode;
$("addLineNode").onclick = () => { if (lineEdit.nodes.length) { const n = lineEdit.nodes[Math.max(0, lineEdit.selected)], m = lineEdit.nodes[(Math.max(0, lineEdit.selected) + 1) % lineEdit.nodes.length]; addLineNodeAt((n.x + m.x) / 2, (n.z + m.z) / 2); } };
$("deleteLineNode").onclick = deleteLineNode;
$("applyLine").onclick = applyLineEdit;
$("cancelLine").onclick = cancelLineEdit;
$("showLine").onchange = () => { lineEdit.show = $("showLine").checked; drawLine(); };

$("clearLine").onclick = async () => {
    const track = state.existingTrack;
    if (!track || !track.racing_line) return;
    // (it is written to the saved track at once: a recorded line was gone for good with one click)
    if (!(await OpenRacerDialog.ask({ title: "Forget the racing line?", text: "The recorded line is removed from the saved track. The AI then follows " +
        (track.design && track.design.nodes ? "the middle of the road" : "the best lap driven here since the line was made, or cannot race until one is driven") + ".", ok: "Forget", danger: true }))) return;
    const config = JSON.parse(JSON.stringify(track));
    delete config.id;
    delete config.racing_line;
    try {
        await store(track.id, config);
        delete track.racing_line;
        updateLineNote();
        status("The line is forgotten.", "ok");
    } catch (error) {
        status(error.message, "error");
    }
};

// back from recording: the track is selected again and the result is shown
async function openFromAddress() {
    const query = new URLSearchParams(window.location.search);
    const id = query.get("track");
    await refreshList(id);
    if (!id || !state.tracks.some((t) => t.id === id)) return;
    await loadExisting();
    const line = query.get("line");
    if (line === "none") status("No lap was finished: the line is as it was. Drive through all the gates and over the finish line to record one.", "error");
    else if (line === "failed") status("The line could not be saved.", "error");
    else if (line) status("The line is recorded (" + line + " points): the AI drives it from the next start.", "ok");
    if (line) history.replaceState(null, "", window.location.pathname + "?track=" + encodeURIComponent(id));
}

// ---- unsaved changes: what would be saved (the fields, the markers, the design, the objects) is compared with what it was when the track was
// loaded, made new or saved. Leaving the page, Record AI racing line, choosing another track and New track ask first when it differs (all of it was lost
// without a word)

const SAVED_FIELDS = ["name", "id", "description", "showGates", "envOn", "skyTop", "skyHorizon", "fogOn", "fogColor", "fogNear", "fogFar", "sunAz", "sunEl", "sunInt", "sunColor", "ambColor", "ambInt"];
function fingerprint() {
    try {
        // (only the fields that are saved: a filter, the colours of the view, the width of the next gate or a field that shows what is chosen said the track had changes)
        const fields = SAVED_FIELDS.map((id) => { const e = $(id); return e ? id + "=" + (e.type === "checkbox" ? e.checked : e.value) : ""; });
        return JSON.stringify([fields, state.start, state.grid, state.pit, state.pitLine, state.pitBoxes, state.gates, state.cameras, state.drag, state.roles, state.env, state.skyName,
            design.active && design.active() ? design.toJSON() : null, objectState.list.map((o) => [o.model, o.x, o.y, o.z, o.heading, o.sx, o.sy, o.sz, o.pitch, o.roll]),
            curbState.list.map((c) => [c.nodes, c.width, c.height, c.colour]), refJSON(), refState.file ? refState.file.name : "",
            [...objectState.models.values()].map((m) => [m.name, m.kind, m.mass, m.pivot]), !!state.thumbnail,
            state.mainFile, [...state.files.values()].map((f) => [f.name, f.size, f.lastModified]), lineChanged()]);
    } catch (error) { return ""; }
}
let savedPrint = null;
function markSaved() { savedPrint = fingerprint(); if (draftResolved) clearDraft(); }
function unsaved() { return savedPrint !== null && fingerprint() !== savedPrint; }
async function discardOk() {
    if (!unsaved()) return true;
    return OpenRacerDialog.ask({ title: "Discard the changes?", text: "The track has changes that are not saved.", ok: "Discard", danger: true });
}
window.addEventListener("beforeunload", (e) => { if (unsaved()) { e.preventDefault(); e.returnValue = ""; } });

// ---- the form

$("files").addEventListener("change", (e) => { if (e.target.files.length) loadFromFiles([...e.target.files]); });
let shownTrack = "";
$("existing").addEventListener("focus", () => { shownTrack = $("existing").value; });
$("existing").addEventListener("change", async () => {
    if (!(await discardOk())) { $("existing").value = shownTrack; return; }
    shownTrack = $("existing").value;
    await ($("existing").value ? loadExisting() : newTrack());
});
$("newTrack").onclick = async () => { if (await discardOk()) newTrack(); };
// The track as it is saved, as a zip to share (as Export zip of the car editor): a track of the garage as the garage keeps it, a track of the server from its
// folder: track.json and every file it names (the model with the .bin and pictures of a .gltf, the objects, the sky picture) and the thumbnail. A track saved
// through the local server, the normal way, could not be shared from anywhere
async function exportTrack() {
    const id = state.existingId, track = state.existingTrack;
    if (!id || !track) { status("Save the track first: the zip is made of the track as it is saved.", "error"); return; }
    try {
        let zip;
        const source = OpenRacer.Garage.sourceOf(track);
        if (source === "folder") throw new Error("this track is in a folder of your PC that is linked to the garage: zip that folder itself");
        if (source === "garage") zip = await OpenRacer.Garage.exportZip("tracks", id);
        else {
            const base = "../tracks/" + id + "/", answer = await fetch(base + "track.json", { cache: "no-store" });
            if (!answer.ok) throw new Error("track.json of " + id + " could not be read (HTTP " + answer.status + "); save the track first");
            const json = await answer.json();
            const names = new Set(["preview.webp"]);
            if (json.model) names.add(json.model);
            (json.objects || []).forEach((o) => { if (o && o.model) names.add(o.model); });
            if (json.environment && json.environment.sky_image) names.add(json.environment.sky_image);
            if (json.geometry) names.add(json.geometry);
            if (json.scene) names.add(json.scene);
            const entries = [{ name: id + "/track.json", data: JSON.stringify(json, null, 2) + "\n" }];
            for (const name of names) {
                if (typeof name !== "string" || !/^[^/\\]+(\/[^/\\]+)*$/.test(name) || name.split("/").includes("..")) continue;
                const response = await fetch(base + name.split("/").map(encodeURIComponent).join("/"));
                if (!response.ok) { if (name !== "preview.webp") throw new Error(name + " could not be read (HTTP " + response.status + ")"); continue; }
                const bytes = new Uint8Array(await response.arrayBuffer());
                entries.push({ name: id + "/" + name, data: bytes });
                if (/\.gltf$/i.test(name)) {
                    try {
                        const gltf = JSON.parse(new TextDecoder().decode(bytes)), dir = name.includes("/") ? name.slice(0, name.lastIndexOf("/") + 1) : "";
                        [].concat(gltf.buffers || [], gltf.images || []).forEach((r) => { if (r && r.uri && !/^data:/.test(r.uri)) names.add(dir + decodeURIComponent(r.uri)); });
                    } catch (e) { /* not JSON: kept as it is */ }
                }
            }
            zip = { blob: await OpenRacer.Zip.write(entries), name: id + ".track.zip" };
        }
        const link = document.createElement("a");
        link.href = URL.createObjectURL(zip.blob); link.download = zip.name;
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 10000);
        status("Saved " + zip.name + " (" + (zip.blob.size / 1048576).toFixed(1) + " MB) in your downloads: the Garage of the main menu imports it." +
            (unsaved() ? " It has the track as it is saved, not the changes since." : ""), "ok");
    } catch (error) { status("Could not make the zip: " + error.message, "error"); }
}

$("save").onclick = save;
$("exportTrack").onclick = exportTrack;
$("testDrive").onclick = testDrive;
$("delete").onclick = deleteTrack;
$("id").addEventListener("input", () => { state.idEdited = true; });
$("name").addEventListener("input", () => { if (!state.idEdited && !state.existingId) $("id").value = slug($("name").value); });

// ---- the first choice, and the height map

function dialog(title, build, onClose) {
    const shade = document.createElement("div");
    shade.className = "te-modal";
    shade.style.cssText = "position: fixed; left: 0; top: 0; width: 100%; height: 100%; z-index: 50; background: rgba(0, 0, 0, 0.6); display: flex; align-items: center; justify-content: center; font-family: inherit;";
    const box = document.createElement("div");
    box.style.cssText = "width: 440px; max-width: calc(100% - 32px); max-height: calc(100% - 32px); overflow-y: auto; background: #1d232c; border: 1px solid #323c4a; border-radius: 10px; padding: 18px 20px; color: #dfe6ef;";
    const heading = document.createElement("div");
    heading.textContent = title;
    heading.style.cssText = "font-size: 18px; font-weight: bold; margin-bottom: 10px;";
    box.appendChild(heading);
    shade.appendChild(box);
    document.body.appendChild(shade);
    const close = () => { shade.remove(); document.removeEventListener("keydown", onKey, true); };
    // (the start dialog could not be closed: × and Escape close it, and say what then happens)
    const dismiss = () => { close(); if (onClose) onClose(); };
    const x = document.createElement("button");
    x.className = "small ghost"; x.textContent = "×"; x.title = "Close (Escape)";
    x.style.cssText = "float: right; margin: -6px -8px 0 0;";
    x.onclick = dismiss;
    heading.prepend(x);
    const onKey = (e) => { if (e.key === "Escape" && !document.getElementById("orDialog")) { e.preventDefault(); e.stopImmediatePropagation(); dismiss(); } };
    document.addEventListener("keydown", onKey, true);
    build(box, close);
    return { close, shade };
}

// Open track: every track is a button, and a click opens it at once (Back goes to the choices of the start)
function trackPicker() {
    dialog("Open a track", (box, close) => {
        const search = document.createElement("input");
        search.type = "search"; search.placeholder = "Search by name or id"; search.style.cssText = "width: 100%; margin-bottom: 10px;";
        const list = document.createElement("div");
        list.style.cssText = "display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; max-height: 60vh; overflow-y: auto; margin-bottom: 12px;";
        const buttons = state.tracks.map((t) => {
            const b = document.createElement("button");
            b.style.cssText = "text-align: left; padding: 0 0 8px; height: auto; white-space: normal; overflow: hidden;";
            b.innerHTML = "<div style='aspect-ratio: 16 / 9; background: #11151b center / cover no-repeat; margin-bottom: 6px;'></div><b style='padding: 0 10px; display: block'></b><div style='font-weight: normal; font-size: 12px; opacity: 0.7; padding: 0 10px'></div>";
            b.firstChild.style.backgroundImage = "url(\"" + trackFile(t, "preview.webp") + "\")";
            b.children[1].textContent = t.name || t.id;
            b.children[2].textContent = t.id;
            b.dataset.find = ((t.name || "") + " " + t.id).toLowerCase();
            b.onclick = async () => { if (!(await discardOk())) return; $("existing").value = t.id; close(); loadExisting(); };
            list.appendChild(b);
            return b;
        });
        search.addEventListener("input", () => { const q = search.value.trim().toLowerCase(); buttons.forEach((b) => { b.style.display = !q || b.dataset.find.includes(q) ? "" : "none"; }); });
        box.append(search, list);
        const back = document.createElement("button");
        back.textContent = "Back";
        back.onclick = () => { close(); startDialog(); };
        box.appendChild(back);
        box.style.width = "620px";
        setTimeout(() => search.focus(), 0);
    }, () => startDialog());
}

// At the start: open a track, make a track from a height map, or a new track
function startDialog() {
    dialog("Track editor", (box, close) => {
        const note = document.createElement("div");
        note.textContent = "What do you want to do?";
        note.style.cssText = "color: #9aa8ba; margin-bottom: 12px;";
        box.appendChild(note);
        const choice = (label, hint, action) => {
            const b = document.createElement("button");
            b.className = "";
            b.style.cssText = "display: block; width: 100%; text-align: left; margin-bottom: 8px; padding: 10px 14px; height: auto;";
            b.innerHTML = "<b></b><div style='font-weight: normal; font-size: 12.5px; opacity: 0.8; margin-top: 2px'></div>";
            b.firstChild.textContent = label; b.lastChild.textContent = hint;
            b.onclick = action;
            box.appendChild(b);
            return b;
        };
        let last = null;
        try { last = state.tracks.find((t) => t.id === localStorage.getItem(LAST_TRACK)); } catch (e) { /* (private window) */ }
        if (last) choice("Open “" + (last.name || last.id) + "” again", "The track you opened last", async () => { if (!(await discardOk())) return; close(); $("existing").value = last.id; loadExisting(); });
        choice("Open track", state.tracks.length ? state.tracks.length + " tracks to change" : "There are no tracks yet", () => { if (state.tracks.length) { close(); trackPicker(); } });
        choice("Import height map", "A track from a height map (16 bit grey PNG) and a colour map", () => { close(); heightDialog(true); });
        choice("New track", "Start empty: import a model, or draw the road with nodes", async () => { if (await discardOk()) { close(); newTrack(); } });
    }, () => { if (!state.existingId && !state.root && !design.active()) newTrack(); });
}

// The height map and the colour map: the size of the square in metres, the height of white, and how fine the mesh is. From the start dialog Cancel goes back
// to it; from the side bar it only closes (the start dialog opened the way to New track and Open over the work, without a question)
function heightDialog(fromStart) {
    dialog("Import height map", (box, close) => {
        const field = (label, node, hint) => {
            const row = document.createElement("div");
            row.style.marginBottom = "10px";
            const l = document.createElement("label");
            l.textContent = label;
            l.style.cssText = "display: block; font-size: 12.5px; color: #9aa8ba; margin-bottom: 3px;";
            row.append(l, node);
            if (hint) { const h = document.createElement("div"); h.className = "hint"; h.textContent = hint; h.style.cssText = "font-size: 12px; color: #7f90a5; margin-top: 3px;"; row.appendChild(h); }
            box.appendChild(row);
            return row;
        };
        const input = (type, extra) => { const e = document.createElement("input"); e.type = type; Object.assign(e, extra || {}); e.style.width = "100%"; return e; };
        const heightFile = input("file", { accept: ".png,.jpg,.jpeg,.webp" });
        const colourFile = input("file", { accept: ".png,.jpg,.jpeg,.webp" });
        const surfaceFile = input("file", { accept: ".png,.jpg,.jpeg,.webp" });
        const info = document.createElement("div");
        info.style.cssText = "font-size: 12.5px; color: #9aa8ba; margin: -4px 0 10px;";
        const size = input("number", { min: 10, step: 1, value: 1024 });
        const top = input("number", { min: 0, step: 1, value: 60 });
        const step = document.createElement("select");
        step.style.width = "100%";
        step.innerHTML = "<option value='2'>every 2nd pixel (fine, heavy)</option><option value='4' selected>every 4th pixel</option><option value='8'>every 8th pixel (light)</option><option value='1'>every pixel (too heavy for 1024 × 1024)</option>";
        const role = document.createElement("select");
        role.style.width = "100%";
        role.innerHTML = "<option value='road'>Road</option><option value='sand'>Sand</option><option value='gravel'>Gravel</option><option value='mud'>Mud</option><option value='grass'>Grass</option><option value='ground'>Ground</option>";
        field("Height map (greyscale, 16 bit PNG: black is low, white is high)", heightFile);
        box.appendChild(info);
        field("Colour map (a picture of the colour of the same square, any size: 2048 or 4096 for a map of 1024)", colourFile);
        field("Surface map (optional: grey road, yellow sand, white gravel, brown mud, green grass, orange ground)", surfaceFile);
        field("Size of the square (m)", size, "1024 pixels and 1024 m: a pixel is a metre.");
        field("Height of white (m)", top, "Black is the level of the start, white is this many metres higher.");
        field("Mesh", step);
        field("Surface", role, "For the whole map, when there is no surface map.");
        let map = null;
        heightFile.onchange = async () => {
            map = null; info.textContent = "";
            if (!heightFile.files[0]) return;
            try {
                map = await readHeights(heightFile.files[0]);
                info.textContent = map.width + " × " + map.height + " pixels, " + map.depth + " bit" + (map.depth < 16 ? " (a 16 bit picture has smoother slopes)" : "") + (map.width !== map.height ? ". Not a square: the map is as wide as the size and as deep as its shape gives." : "");
                size.value = map.width;
            } catch (error) { info.textContent = error.message; info.style.color = "#ff8a80"; return; }
            info.style.color = "#9aa8ba";
        };
        const row = document.createElement("div");
        row.style.cssText = "display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px;";
        const cancel = document.createElement("button");
        cancel.textContent = "Cancel";
        cancel.onclick = () => { close(); if (fromStart === true) startDialog(); };
        const make = document.createElement("button");
        make.className = "primary";
        make.textContent = "Make the track";
        make.onclick = async () => {
            if (!heightFile.files[0]) { info.textContent = "Choose the height map first."; info.style.color = "#ff8a80"; return; }
            if (!(await discardOk())) return;          // (the work on the open track was replaced without a question)
            make.disabled = true; make.textContent = "Making…";
            try {
                const result = await buildTerrain(heightFile.files[0], colourFile.files[0] || null, { size: parseFloat(size.value), top: parseFloat(top.value), step: parseInt(step.value, 10), role: role.value, surfaceFile: surfaceFile.files[0] || null });
                close();
                newTrack();
                loadFromFiles([result.file], result.roles);
                status("The height map is a mesh of " + result.grid[0] + " × " + result.grid[1] + " points (" + result.triangles + " triangles), " + Math.round(result.size[0]) + " × " + Math.round(result.size[1]) + " m. Place the start on it, add gates and save.", "ok");
            } catch (error) {
                make.disabled = false; make.textContent = "Make the track";
                info.textContent = error.message || String(error); info.style.color = "#ff8a80";
            }
        };
        row.append(cancel, make);
        box.appendChild(row);
    }, () => { if (fromStart === true) startDialog(); });
}
$("importHeight").onclick = () => heightDialog(false);



// ---- one thing chosen at a time: a click on something lets go of whatever else was chosen (an object, a gate, a curb, a camera, the drag strip, a node of the
// line, a node or a prefab of the road, a box of the grid or of the pit, the reference image, a part of the model). Two gizmos at once dragged both, and Delete took
// the wrong one away.
function gizmoBusy() {
    return [camGizmo, moveGizmo, turnGizmo, lineGizmo, objectGizmo, gateGizmo, refGizmo, boxGizmo].some((g) => g.object && (g.dragging || g.axis !== null));
}
function clearSelection(keep) {
    if (keep !== "object" && objectUi.selected >= 0) selectObject(-1);
    if (keep !== "gate" && gateUi.selected >= 0) selectGate(-1);
    if (keep !== "curb" && curbState.selected >= 0 && !curbState.drawing) selectCurb(-1);
    if (keep !== "camera" && state.camSel >= 0) selectCamera(-1);
    if (keep !== "drag" && eventLayers.selected) { eventLayers.selected = null; moveGizmo.detach(); turnGizmo.detach(); renderEventLayers(); }
    if (keep !== "line" && lineEdit.editing && lineEdit.selected >= 0) selectLineNode(-1);
    if (keep !== "design" && design.active()) design.deselect();
    if (keep !== "ref" && refState.moving) { refState.moving = false; refGizmo.detach(); fillRefFields(); }
    if (keep !== "box" && boxSel.kind) selectBox(null, -1);
    if (keep !== "part" && state.selected !== null && state.selected !== undefined) selectPart(null);
}
function anythingChosen() {
    return objectUi.selected >= 0 || gateUi.selected >= 0 || curbState.selected >= 0 || state.camSel >= 0 || !!eventLayers.selected || (lineEdit.editing && lineEdit.selected >= 0)
        || refState.moving || !!boxSel.kind || (state.selected !== null && state.selected !== undefined);
}

// ---- the boxes of the grid and of the pit: chosen in the view or in their card, moved with the gizmo (W) and turned (E); the height follows the road
function boxList(kind) { return kind === "grid" ? state.grid : kind === "pit" ? state.pitBoxes : null; }
function boxOf() { const list = boxList(boxSel.kind); return list ? list[boxSel.i] : null; }
boxGizmo.addEventListener("dragging-changed", (event) => { controls.enabled = !event.value; boxSel.dragging = event.value; if (!event.value) updateMarkers(); });
boxGizmo.addEventListener("objectChange", () => {
    const b = boxOf();
    if (!b) return;
    b.x = boxTarget.position.x; b.z = boxTarget.position.z; b.y = groundY(b.x, b.z, b.y);
    b.heading = -2 * Math.atan2(boxTarget.quaternion.y, boxTarget.quaternion.w);
    boxTarget.position.y = b.y;
    if (boxSel.kind === "grid") syncStart();
    scheduleMarkers();
});
function selectBox(kind, i) {
    boxGizmo.detach();
    const list = boxList(kind);
    boxSel.kind = null; boxSel.i = -1;
    if (list && list[i]) {
        clearSelection("box");
        boxSel.kind = kind; boxSel.i = i;
        const b = list[i];
        boxTarget.position.set(b.x, b.y, b.z);
        boxTarget.rotation.set(0, -b.heading, 0);
        boxGizmo.attach(boxTarget);
        setObjectGizmoMode(objectGizmo.mode === "rotate" ? "rotate" : "translate");
    }
    updateMarkers();
}

// ---- the keys, in one place and in this order (before the designer of the road, which has its own Delete and Escape for its nodes and prefabs)
// Ctrl+S saves, Ctrl+Z and Ctrl+Y undo and redo everything, Ctrl+D copies the chosen object, gate or curb, Delete takes the chosen thing away, Escape goes one step back
// (the measure, the curb that is drawn, what is chosen, then the tool), Enter ends a curb, 1 to 0 are the tools, N and P the tools of the road, F brings the chosen
// thing into view, T looks from above, End puts the chosen thing on the surface, W E R move, turn and scale, ? shows the keys.
const MODE_KEYS = { Digit1: "view", Digit2: "grid", Digit3: "pitbox", Digit4: "pitline", Digit5: "gate", Digit6: "drag", Digit7: "object", Digit8: "camera", Digit9: "curb", Digit0: "measure" };
function dialogOpen() { return !!document.getElementById("orDialog") || !!document.querySelector("dialog[open]") || !!document.querySelector(".te-modal"); }
window.addEventListener("keydown", (e) => {
    if (dialogOpen()) return;
    const t = e.target && e.target.tagName, typing = t === "INPUT" || t === "TEXTAREA" || t === "SELECT";
    const ctrl = e.ctrlKey || e.metaKey;
    const done = () => { e.preventDefault(); e.stopImmediatePropagation(); setTimeout(() => { noteEditorStep(); renderProps(); }, 0); };
    if (ctrl && e.code === "KeyS") { done(); save(); return; }
    if (typing) return;
    if (ctrl && e.code === "KeyZ") { done(); if (e.shiftKey) redo(); else undo(); return; }
    if (ctrl && e.code === "KeyY") { done(); redo(); return; }
    if (ctrl && e.code === "KeyD") { if (duplicateChosen()) done(); return; }
    if (ctrl || e.altKey) return;
    if (e.code === "Delete" || e.code === "Backspace") { if (deleteChosen()) done(); return; }
    if (e.code === "Escape") { if (escapeStep()) done(); return; }
    if (e.code === "Enter" && state.mode === "curb" && curbState.selected >= 0) { done(); endCurbDraw(); selectCurb(-1); return; }
    if (e.key === "?" || (e.code === "Slash" && e.shiftKey)) { done(); toggleHelp(); return; }
    if (lineEdit.editing) return;
    if (MODE_KEYS[e.code]) { done(); setMode(MODE_KEYS[e.code]); return; }
    if (design.active() && (e.code === "KeyN" || e.code === "KeyP" || e.code === "KeyG" || e.code === "KeyB")) { done(); setMode({ KeyN: "node", KeyP: "prefab", KeyG: "patch", KeyB: "branch" }[e.code]); return; }
    if (e.code === "KeyF") { done(); frameChosen(); return; }
    if (e.code === "KeyT") { done(); topView(); return; }
    if (e.code === "End") { if (dropChosen()) done(); return; }
    if ((e.code === "KeyW" || e.code === "KeyE" || e.code === "KeyR") && (objectUi.selected >= 0 || gateUi.selected >= 0 || boxSel.kind)) {
        done(); setObjectGizmoMode({ KeyW: "translate", KeyE: "rotate", KeyR: "scale" }[e.code]);
    }
}, true);
// Escape: one step back at a time; false when there was nothing to do here (the designer then lets go of its node or prefab)
function escapeStep() {
    if (helpShown()) { toggleHelp(false); return true; }
    if (refState.scale) { endRefScale(); fillRefFields(); return true; }
    if (state.mode === "measure") { clearMeasure(); setMode("view"); return true; }
    if (lineEdit.editing) { if (lineEdit.selected >= 0) selectLineNode(-1); else cancelLineEdit(); return true; }
    if (design.active() && design.selection()) return false;
    if (anythingChosen()) { clearSelection(); return true; }
    if (state.mode !== "view") { setMode("view"); return true; }
    return false;
}
// Delete: the chosen thing goes (Ctrl+Z brings it back); false when nothing of the editor was chosen (the designer then takes its node or prefab away)
function deleteChosen() {
    if (curbState.node >= 0) return deleteCurbNode();
    if (lineEdit.editing) { if (lineEdit.selected >= 0) deleteLineNode(); return true; }
    if (objectUi.selected >= 0) { objectState.list.splice(objectUi.selected, 1); selectObject(-1); updateMarkers(); return true; }
    if (gateUi.selected >= 0) { state.gates.splice(gateUi.selected, 1); selectGate(-1); return true; }
    if (boxSel.kind) { boxList(boxSel.kind).splice(boxSel.i, 1); if (boxSel.kind === "grid") syncStart(); selectBox(null, -1); return true; }
    if (state.camSel >= 0) { state.cameras.splice(state.camSel, 1); selectCamera(-1); updateMarkers(); return true; }
    if (curbState.selected >= 0) { removeCurb(curbState.selected); return true; }
    if (eventLayers.selected === "drag" && state.drag) { state.drag = null; selectEvent("drag"); showDrag(); updateMarkers(); return true; }
    return false;
}
// Ctrl+D: a copy of the chosen object (3 m aside), gate (20 m further) or curb (2 m aside), chosen
function duplicateChosen() {
    if (objectUi.selected >= 0) {
        const o = objectState.list[objectUi.selected], copy = Object.assign({}, o, { x: o.x + 3 });
        copy.y = groundY(copy.x, copy.z, o.y);
        objectState.list.push(copy); renderObjects(); selectObject(objectState.list.length - 1); updateMarkers();
        return true;
    }
    if (gateUi.selected >= 0) {
        const g = state.gates[gateUi.selected], x = g.x + Math.cos(g.heading) * 20, z = g.z + Math.sin(g.heading) * 20;
        state.gates.splice(gateUi.selected + 1, 0, Object.assign({}, g, { x, z, y: groundY(x, z, g.y) }));
        selectGate(gateUi.selected + 1);
        return true;
    }
    if (curbState.selected >= 0 && !curbState.drawing) {
        const c = curbState.list[curbState.selected];
        curbState.list.push({ nodes: c.nodes.map((n) => [n[0] + 2, groundY(n[0] + 2, n[2], n[1]), n[2]]), width: c.width, height: c.height, colour: c.colour, points: [], mesh: null });
        buildCurb(curbState.list.length - 1);
        selectCurb(curbState.list.length - 1, -1);
        return true;
    }
    return false;
}
// End: the chosen object, gate or box on the surface under it
function dropChosen() {
    const o = objectState.list[objectUi.selected];
    if (o) { o.y = groundY(o.x, o.z, o.y + 20); selectObject(objectUi.selected); updateMarkers(); return true; }
    const g = state.gates[gateUi.selected];
    if (g) { g.y = groundY(g.x, g.z, g.y + 20); syncGateTarget(); updateMarkers(); return true; }
    const b = boxOf();
    if (b) { b.y = groundY(b.x, b.z, b.y + 20); selectBox(boxSel.kind, boxSel.i); return true; }
    return false;
}
// F: the view turns to the chosen thing (from as far as it was, but not further than 120 m); nothing chosen: the whole track
function chosenPoint() {
    const v = (x, y, z) => new THREE.Vector3(x, y, z);
    if (objectUi.selected >= 0) { const o = objectState.list[objectUi.selected]; return v(o.x, o.y, o.z); }
    if (gateUi.selected >= 0) { const g = state.gates[gateUi.selected]; return v(g.x, g.y, g.z); }
    if (boxOf()) { const b = boxOf(); return v(b.x, b.y, b.z); }
    if (state.camSel >= 0) { const c = state.cameras[state.camSel]; return v(c.x, c.y, c.z); }
    const curb = curbState.list[curbState.selected];
    if (curb) { const n = curb.nodes[Math.max(0, curbState.node)] || curb.nodes[0]; return v(n[0], n[1], n[2]); }
    if (lineEdit.editing && lineEdit.nodes[lineEdit.selected]) { const n = lineEdit.nodes[lineEdit.selected]; return v(n.x, n.y, n.z); }
    if (eventLayers.selected === "drag" && state.drag) return v(state.drag.x, state.drag.y, state.drag.z);
    if (refState.moving) return v(refState.x, refState.y, refState.z);
    return null;
}
function frameChosen() {
    const p = chosenPoint();
    if (!p) { frameTrack(); return; }
    const offset = camera.position.clone().sub(controls.target);
    offset.setLength(Math.min(120, Math.max(15, offset.length())));
    controls.target.copy(p);
    camera.position.copy(p).add(offset);
    controls.update();
}

// ---- undo and redo of the whole editor: a step is what the track was before and after a click, a key or a field (the grid, the pit, the gates, the cameras, the drag
// strip, the objects, the curbs, the surfaces and the place of the reference image), or one step of the road of the designer (its own undo, in the same list). The
// racing line has its own Cancel while it is edited.
function editorSnapshot() {
    return JSON.stringify({
        grid: state.grid, pit: state.pit, pitLine: state.pitLine, pitBoxes: state.pitBoxes, gates: state.gates, cameras: state.cameras, drag: state.drag,
        objects: objectState.list, curbs: curbState.list.map((c) => ({ nodes: c.nodes, width: c.width, height: c.height, colour: c.colour })), roles: state.roles,
        ref: refState.mesh ? { x: refState.x, y: refState.y, z: refState.z, width: refState.width, rotation: refState.rotation, opacity: refState.opacity, show: refState.show, top: refState.top } : null
    });
}
function noteEditorStep() {
    if (undoState.busy || curbState.dragging || objectUi.dragging || gateUi.dragging || boxSel.dragging || lineEdit.dragging) return;
    const now = editorSnapshot();
    if (undoState.last === null) { undoState.last = now; return; }
    if (now === undoState.last) return;
    undoState.past.push({ kind: "editor", before: undoState.last, after: now });
    if (undoState.past.length > 200) undoState.past.shift();
    undoState.future = [];
    undoState.last = now;
    updateUndoUi();
}
// a step of the designer (after its road was made again: what moved with it, the curbs and the gates on the road, belongs to that step)
function noteDesignStep() {
    if (undoState.busy) return;
    undoState.last = editorSnapshot();
    undoState.past.push({ kind: "design" });
    if (undoState.past.length > 200) undoState.past.shift();
    undoState.future = [];
    updateUndoUi();
}
function resetHistory() { undoState.past = []; undoState.future = []; undoState.last = editorSnapshot(); updateUndoUi(); }
function restoreEditor(json) {
    const s = JSON.parse(json);
    undoState.busy = true;
    try {
        clearSelection();
        state.grid = s.grid; syncStart();
        state.pit = s.pit; state.pitLine = s.pitLine; state.pitBoxes = s.pitBoxes; state.gates = s.gates; state.cameras = s.cameras; state.drag = s.drag;
        objectState.list = s.objects;
        if (JSON.stringify(curbState.list.map((c) => ({ nodes: c.nodes, width: c.width, height: c.height, colour: c.colour }))) !== JSON.stringify(s.curbs)) resetCurbs(s.curbs);
        if (s.ref && refState.mesh) { Object.assign(refState, s.ref); refPlace(); fillRefFields(); }
        if (JSON.stringify(state.roles) !== JSON.stringify(s.roles)) { state.roles = s.roles; applyColours(); renderParts(); }
        showDrag(); renderObjects(); updateMarkers();
    } finally { undoState.busy = false; }
}
function undo() {
    noteEditorStep();          // (a change that was not looked at yet is a step of its own first)
    const step = undoState.past.pop();
    if (!step) { status("There is nothing to undo.", ""); return; }
    undoState.busy = true;
    try { if (step.kind === "design") design.undo(); } finally { undoState.busy = false; }
    if (step.kind === "editor") restoreEditor(step.before);
    undoState.last = editorSnapshot();
    undoState.future.push(step);
    updateUndoUi();
}
function redo() {
    if (editorSnapshot() !== undoState.last) { noteEditorStep(); return; }          // (a change since the undo: there is nothing to redo any more)
    const step = undoState.future.pop();
    if (!step) { status("There is nothing to redo.", ""); return; }
    undoState.busy = true;
    try { if (step.kind === "design") design.redo(); } finally { undoState.busy = false; }
    if (step.kind === "editor") restoreEditor(step.after);
    undoState.last = editorSnapshot();
    undoState.past.push(step);
    updateUndoUi();
}
function updateUndoUi() {
    for (const id of ["undoButton", "dsUndo"]) if ($(id)) $(id).disabled = !undoState.past.length;
    for (const id of ["redoButton", "dsRedo"]) if ($(id)) $(id).disabled = !undoState.future.length;
}
// after every click, key and field the editor looks whether the track changed (one step per drag of a gizmo: it is looked at when the button is let go)
["pointerup", "keyup", "change", "click"].forEach((type) => window.addEventListener(type, () => setTimeout(() => { noteEditorStep(); renderProps(); if (typeof updateActions === "function") updateActions(); }, 0), true));
$("undoButton").onclick = undo;
$("redoButton").onclick = redo;
$("dsUndo").onclick = undo;
$("dsRedo").onclick = redo;

// ---- the road of the designer changed: what stands on it goes to its new height (the curbs floated or sank, and the game built them there)
function snapToSurface() {
    const clean = undoState.last === null || undoState.last === editorSnapshot();
    const onRoad = (q) => { q.y = groundY(q.x, q.z, q.y); };
    state.grid.forEach(onRoad); syncStart();
    state.pitBoxes.forEach(onRoad); state.pitLine.forEach(onRoad);
    if (state.pit) state.pit.points.forEach(onRoad);
    state.gates.forEach(onRoad);
    objectState.list.forEach(onRoad);
    if (state.drag) onRoad(state.drag);
    curbState.list.forEach((c) => c.nodes.forEach((n) => { if (c.connect) snapCurbNode(n); else n[1] = groundY(n[0], n[2], n[1]); }));
    drawCurbs();
    syncGateTarget(); syncObjectTarget();
    updateMarkers();
    if (clean) undoState.last = editorSnapshot();          // (it belongs to the step of the road, not to a step of its own)
}

// ---- the panel of what is chosen: its place, its direction and its size as numbers (the width of a gate could only be dragged, an object had no fields)
let propsKey = "";
function propsOf() {
    const deg = (h) => +(h * 180 / Math.PI).toFixed(1), rad = (d) => d * Math.PI / 180, r1 = (v) => +(+v).toFixed(2);
    const onRoad = (q) => { q.y = groundY(q.x, q.z, q.y); };
    if (objectUi.selected >= 0) {
        const o = objectState.list[objectUi.selected];
        return { key: "o" + objectUi.selected, title: "Object " + (objectUi.selected + 1) + ": " + o.model.replace(OBJECT_PREFIX, "").replace(/\.glb$/, ""), fields: [
            ["x", r1(o.x), (v) => { o.x = v; onRoad(o); }], ["z", r1(o.z), (v) => { o.z = v; onRoad(o); }], ["Height (y)", r1(o.y), (v) => { o.y = v; }],
            ["Direction (°)", deg(o.heading), (v) => { o.heading = rad(v); }], ["Scale", r1(o.sx), (v) => { if (v > 0) { const k = v / o.sx; o.sx = v; o.sy *= k; o.sz *= k; } }]
        ], after: () => { syncObjectTarget(); showObjects(); renderObjects(); } };
    }
    if (gateUi.selected >= 0) {
        const g = state.gates[gateUi.selected];
        return { key: "g" + gateUi.selected, title: gateUi.selected === 0 ? "Gate 1 (finish)" : "Gate " + (gateUi.selected + 1), fields: [
            ["x", r1(g.x), (v) => { g.x = v; onRoad(g); }], ["z", r1(g.z), (v) => { g.z = v; onRoad(g); }], ["Direction (°)", deg(g.heading), (v) => { g.heading = rad(v); }],
            ["Width (m)", g.width, (v) => { if (v >= 2) g.width = Math.min(400, v); }]
        ], after: () => syncGateTarget() };
    }
    const b = boxOf();
    if (b) {
        return { key: boxSel.kind + boxSel.i, title: (boxSel.kind === "grid" ? "Grid box " : "Pit box ") + (boxSel.i + 1), fields: [
            ["x", r1(b.x), (v) => { b.x = v; onRoad(b); }], ["z", r1(b.z), (v) => { b.z = v; onRoad(b); }], ["Direction (°)", deg(b.heading), (v) => { b.heading = rad(v); }]
        ], after: () => { if (boxSel.kind === "grid") syncStart(); selectBox(boxSel.kind, boxSel.i); } };
    }
    if (state.camSel >= 0) {
        const c = state.cameras[state.camSel];
        return { key: "c" + state.camSel, title: "Camera " + (state.camSel + 1), fields: [
            ["x", r1(c.x), (v) => { c.x = v; }], ["z", r1(c.z), (v) => { c.z = v; }], ["Height (y)", r1(c.y), (v) => { c.y = v; }],
            ["Range (m)", r1(rangeOf(c).r), (v) => { if (v >= 2) c.range = Object.assign({}, rangeOf(c), { r: v }); }]
        ], after: () => { if (!state.camRange) camTarget.position.set(c.x, c.y, c.z); } };
    }
    if (eventLayers.selected === "drag" && state.drag) {
        const d = state.drag;
        return { key: "drag", title: "Drag strip", fields: [
            ["x", r1(d.x), (v) => { d.x = v; onRoad(d); }], ["z", r1(d.z), (v) => { d.z = v; onRoad(d); }], ["Direction (°)", deg(d.heading), (v) => { d.heading = rad(v); }],
            ["Width (m)", d.width, (v) => { if (v >= 3) d.width = v; }], ["Length (m)", r1(d.length), (v) => { if (v >= 50) d.length = v; }]
        ], after: () => { syncDragTarget(); showDrag(); } };
    }
    return null;
}
function renderProps() {
    if (!editorReady) return;
    updateContext();
    const panel = $("props");
    if (!panel) return;
    const p = propsOf();
    panel.style.display = p ? "" : "none";
    if (!p) { propsKey = ""; return; }
    const inputs = [...panel.querySelectorAll("input")];
    if (p.key === propsKey && inputs.length === p.fields.length) {
        // (the same thing: only the values, and not the one that is being typed in)
        p.fields.forEach((f, i) => { if (document.activeElement !== inputs[i]) inputs[i].value = f[1]; });
        return;
    }
    propsKey = p.key;
    panel.innerHTML = "";
    const head = document.createElement("div");
    head.className = "propsHead";
    head.innerHTML = "<span></span><button class='small ghost' title='Bring it into view (F)'>F</button><button class='small danger' title='Take it away (Delete; Ctrl+Z brings it back)'>Delete</button>";
    head.firstChild.textContent = p.title; head.firstChild.title = p.title;
    head.children[1].onclick = frameChosen;
    head.children[2].onclick = () => { deleteChosen(); noteEditorStep(); };
    panel.appendChild(head);
    const grid = document.createElement("div");
    grid.className = "propsGrid";
    p.fields.forEach(([label, value, set]) => {
        const l = document.createElement("label");
        l.textContent = label;
        const input = document.createElement("input");
        input.type = "number"; input.step = "any"; input.value = value;
        input.addEventListener("change", () => {
            const v = parseFloat(input.value);
            if (!Number.isFinite(v)) { input.value = value; return; }
            const now = propsOf();
            if (!now || now.key !== p.key) return;
            set(v);
            now.after && now.after();
            updateMarkers();
        });
        l.appendChild(input);
        grid.appendChild(l);
    });
    panel.appendChild(grid);
}

// ---- the Layers panel: the boxes of the grid and of the pit, and the cameras, as rows (a click chooses one)
function renderBoxLayers() {
    const fill = (id, list, name, chosen, choose) => {
        const holder = $(id);
        if (!holder) return;
        holder.innerHTML = "";
        list.forEach((item, i) => {
            const row = document.createElement("div");
            row.className = "layer" + (chosen(i) ? " selected" : "");
            row.innerHTML = "<i></i><span></span><span class=\"meta\"></span>";
            row.children[1].textContent = name(i);
            row.children[2].textContent = Math.round(item.x) + ", " + Math.round(item.z);
            row.onclick = () => choose(i);
            holder.appendChild(row);
        });
        if (!list.length) { const none = document.createElement("div"); none.style.cssText = "padding: 4px 14px; color: #66727f;"; none.textContent = "none placed"; holder.appendChild(none); }
    };
    fill("gridLayers", state.grid, (i) => i === 0 ? "Box 1 (start)" : "Box " + (i + 1), (i) => boxSel.kind === "grid" && boxSel.i === i, (i) => selectBox(boxSel.kind === "grid" && boxSel.i === i ? null : "grid", i));
    fill("pitLayers", state.pitBoxes, (i) => i === 0 ? "Pit box 1 (player)" : "Pit box " + (i + 1), (i) => boxSel.kind === "pit" && boxSel.i === i, (i) => selectBox(boxSel.kind === "pit" && boxSel.i === i ? null : "pit", i));
    fill("cameraLayers", state.cameras, (i) => "Camera " + (i + 1), (i) => state.camSel === i, (i) => selectCamera(state.camSel === i ? -1 : i));
}
// the surfaces of the road designer, as rows (a click chooses one: the Surfaces tool opens on it; a click on the chosen one lets it go)
function renderSurfaceLayers() {
    const holder = $("surfaceLayers");
    if (!holder) return;
    holder.innerHTML = "";
    const rows = design.active() ? design.patchRows() : [];
    rows.forEach((item, i) => {
        const row = document.createElement("div");
        row.className = "layer" + (item.selected ? " selected" : "");
        row.innerHTML = "<i></i><span></span><span class=\"meta\"></span>";
        row.children[1].textContent = (i + 1) + ". " + item.label;
        row.children[2].textContent = item.meta;
        row.onclick = () => design.choosePatch(i);
        holder.appendChild(row);
    });
    if (!rows.length) { const none = document.createElement("div"); none.style.cssText = "padding: 4px 14px; color: #66727f;"; none.textContent = design.active() ? "none drawn" : "only for a drawn road"; holder.appendChild(none); }
}
// the sections of the Layers panel fold with a click on their head
document.querySelectorAll("#eventLayers .layersHead").forEach((head) => head.addEventListener("click", () => {
    const list = head.nextElementSibling;
    if (!list) return;
    const folded = list.style.display === "none";
    list.style.display = folded ? "" : "none";
    head.classList.toggle("folded", !folded);
}));

// ---- the grid in one go: boxes 2 to 8 behind box 1, two wide and staggered (4 m apart along the road, 8 m from one box to the next on the same side); the second
// row goes to the side of box 1 where there is road
function roadAt(x, z, hint) {
    raycaster.set(new THREE.Vector3(x, hint + 50, z), new THREE.Vector3(0, -1, 0));
    const hit = raycaster.intersectObjects(trackGroup.children, true).find((h) => DRIVABLE[state.roles[h.object.name || ""]]);
    return !!hit && (state.roles[hit.object.name] === "road" || state.roles[hit.object.name] === "track01");
}
$("gridAuto").onclick = async () => {
    const b = state.grid[0];
    if (!b) { status("Place box 1 of the grid first (the start): the other boxes go behind it.", "error"); return; }
    if (state.grid.length > 1 && !(await OpenRacerDialog.ask({ title: "Make the grid again?", text: "Boxes 2 to " + state.grid.length + " are put in new places behind box 1.", ok: "Make the grid" }))) return;
    const fx = Math.cos(b.heading), fz = Math.sin(b.heading), sx = -fz, sz = fx, gap = 4.5;
    const side = roadAt(b.x + sx * gap, b.z + sz * gap, b.y) ? 1 : (roadAt(b.x - sx * gap, b.z - sz * gap, b.y) ? -1 : 1);
    state.grid = [b];
    for (let k = 1; k < GRID_MAX; k++) {
        const back = k * 4, across = (k % 2) * gap * side;
        const x = b.x - fx * back + sx * across, z = b.z - fz * back + sz * across;
        state.grid.push({ x, y: groundY(x, z, b.y), z, heading: b.heading });
    }
    syncStart(); selectBox(null, -1);
    status("The grid has " + GRID_MAX + " boxes: two wide, behind box 1. Move one with a click on it and the gizmo.", "ok");
};
// the pit boxes in a row: boxes 2 to 8 one after the other in the direction of box 1, 10 m apart
$("pitAuto").onclick = async () => {
    const b = state.pitBoxes[0];
    if (!b) { status("Place pit box 1 first (the player's): the other boxes follow it.", "error"); return; }
    if (state.pitBoxes.length > 1 && !(await OpenRacerDialog.ask({ title: "Make the pit boxes again?", text: "Boxes 2 to " + state.pitBoxes.length + " are put in a row after box 1.", ok: "Make the boxes" }))) return;
    const fx = Math.cos(b.heading), fz = Math.sin(b.heading);
    state.pitBoxes = [b];
    for (let k = 1; k < GRID_MAX; k++) {
        const x = b.x + fx * 10 * k, z = b.z + fz * 10 * k;
        state.pitBoxes.push({ x, y: groundY(x, z, b.y), z, heading: b.heading });
    }
    selectBox(null, -1);
    status("There are " + GRID_MAX + " pit boxes in a row, 10 m apart, in the direction of box 1.", "ok");
};

// ---- the gates in one go: as many as asked, at the same distance from each other along the racing line (or the middle of a drawn road), gate 1 a few metres in front
// of the start, all in the direction that the line is driven
$("gatesAuto").onclick = async () => {
    const points = lineSourcePoints();
    if (!points || points.length < 10) { status("Auto gates needs a racing line (record or draw one) or a road drawn with nodes.", "error"); return; }
    if (!state.start) { status("Place box 1 of the grid first: gate 1 goes in front of the start.", "error"); return; }
    const count = Math.max(2, Math.min(40, parseInt($("gatesCount").value, 10) || 8));
    if (state.gates.length && !(await OpenRacerDialog.ask({ title: "Replace the gates?", text: "The " + state.gates.length + " gates that are there go; " + count + " new ones come along the line.", ok: "Replace" }))) return;
    let p = points.map((q) => ({ x: q.x, z: q.z }));
    // the line in the direction that the car starts in
    let near = 0, best = Infinity;
    p.forEach((q, i) => { const d = Math.hypot(q.x - state.start.x, q.z - state.start.z); if (d < best) { best = d; near = i; } });
    const a = p[near], b = p[(near + 1) % p.length];
    if (Math.cos(Math.atan2(b.z - a.z, b.x - a.x) - state.start.heading) < 0) { p = p.reverse(); near = p.length - 1 - near; }
    p = p.slice(near).concat(p.slice(0, near));          // (from the start round)
    const along = [0];
    for (let i = 1; i <= p.length; i++) along.push(along[i - 1] + Math.hypot(p[i % p.length].x - p[i - 1].x, p[i % p.length].z - p[i - 1].z));
    const total = along[p.length], width = Math.max(2, parseFloat($("gateWidth").value) || 24);
    const at = (s) => {
        s = ((s % total) + total) % total;
        let i = 0;
        while (i < p.length - 1 && along[i + 1] < s) i++;
        const q = p[i], r = p[(i + 1) % p.length], t = (s - along[i]) / Math.max(1e-6, along[i + 1] - along[i]);
        return { x: q.x + (r.x - q.x) * t, z: q.z + (r.z - q.z) * t, heading: Math.atan2(r.z - q.z, r.x - q.x) };
    };
    state.gates = [];
    for (let k = 0; k < count; k++) {
        const g = at(6 + k * total / count);
        state.gates.push({ x: g.x, y: groundY(g.x, g.z, state.start.y), z: g.z, heading: g.heading, width });
    }
    selectGate(-1);
    status(count + " gates along the line (" + Math.round(total) + " m), gate 1 just in front of the start. Check that each one is as wide as the road there.", "ok");
};

// ---- ready to race: what the game needs, checked while you work (it was only said after a save)
function renderReady() {
    const list = $("readyList");
    if (!list) return;
    const items = [];
    const add = (ok, text, warn) => items.push([ok ? "ok" : (warn ? "warn" : "bad"), text]);
    add(!!$("name").value.trim(), $("name").value.trim() ? "Name: " + $("name").value.trim() : "No name yet (Track card)");
    add(!!(state.root || design.active()), state.root || design.active() ? "A road: " + (design.active() ? "drawn with nodes" : "a model") : "No road: import a model or draw it with nodes");
    add(!!state.start, state.start ? "Start: box 1 of the grid" : "No start: place box 1 with Grid box (2)");
    add(state.grid.length >= GRID_MAX, state.grid.length + " of " + GRID_MAX + " grid boxes" + (state.grid.length < GRID_MAX ? " (the opponents need boxes 2 to " + GRID_MAX + ": Fill the grid)" : ""), true);
    const special = state.existingTrack && (state.existingTrack.skidpad || (state.drag && !state.gates.length));
    if (!special) {
        add(state.gates.length >= 2, state.gates.length ? state.gates.length + " gates" : "No gates: no lap is counted (Add gate, or Auto gates)");
        if (state.gates.length && state.start) {
            const d = Math.hypot(state.gates[0].x - state.start.x, state.gates[0].z - state.start.z);
            add(d < 150, d < 150 ? "Gate 1 (the finish line) is " + Math.round(d) + " m in front of the start" : "Gate 1 (the finish line) is " + Math.round(d) + " m from the start: is that right?", true);
        }
        const line = lineSourcePoints();
        add(!!line, line ? "A racing line for the AI" : "No racing line: the AI cannot race (record or draw one)");
        if (line && state.gates.length >= 2) {
            // every gate on the line, and the gates in the order that the line passes them
            const index = state.gates.map((g) => { let n = 0, b = Infinity; line.forEach((q, i) => { const d = Math.hypot(q.x - g.x, q.z - g.z); if (d < b) { b = d; n = i; } }); return [n, b, g.width]; });
            const off = index.filter(([, d, w]) => d > w / 2 + 2).length;
            add(!off, off ? off + " gate" + (off > 1 ? "s are" : " is") + " not on the racing line" : "The line goes through every gate", true);
            let turns = 0;
            for (let i = 1; i < index.length; i++) if (index[i][0] < index[i - 1][0]) turns++;
            add(turns <= 1, turns <= 1 ? "The gates are in the order of the line" : "The gates are not in the order that the line passes them", true);
        }
    }
    add(state.pitBoxes.length > 0 && state.pitLine.length >= 2, state.pitBoxes.length ? state.pitBoxes.length + " pit boxes" + (state.pitLine.length >= 2 ? " and a pit line" : ", no pit line") : "No pit (optional)", true);
    const one = curbState.list.filter((c) => c.nodes.length === 1).length;
    if (one) add(false, one + " curb" + (one > 1 ? "s have" : " has") + " only one node: it is not saved", true);
    list.innerHTML = "";
    items.forEach(([kind, text]) => { const row = document.createElement("div"); row.className = "ready " + kind; row.textContent = text; list.appendChild(row); });
    const bad = items.filter((i) => i[0] === "bad").length, warn = items.filter((i) => i[0] === "warn").length;
    $("readyNote").textContent = bad ? bad + " to do" : warn ? "ready, " + warn + " to check" : "ready";
    $("readyNote").className = "meta " + (bad ? "bad" : warn ? "warn" : "ok");
}
$("name").addEventListener("input", renderReady);

// ---- the measure tool (0): clicks on the track (or on the reference image) make a line, and the length of it is shown; Escape ends it
const measureLayer = new THREE.Group();
scene.add(measureLayer);
function measurePoint(event) {
    const road = roadHit(event);
    if (road) return road.point.clone();
    const onRef = refState.mesh && refState.show ? pointerRay(event).intersectObject(refState.mesh, false)[0] : null;
    if (onRef) return onRef.point.clone();
    return pointerRay(event).ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -controls.target.y), new THREE.Vector3());
}
function measureClick(event) {
    const p = measurePoint(event);
    if (!p) return;
    measureState.points.push(p);
    drawMeasure();
}
function drawMeasure() {
    disposeTree(measureLayer);
    const pts = measureState.points;
    pts.forEach((p) => {
        const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0x7dff9a, depthTest: false, transparent: true }));
        ball.position.copy(p).setY(p.y + 0.3); ball.renderOrder = 1001;
        measureLayer.add(screenSize(ball, 6, 1));
    });
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += pts[i].distanceTo(pts[i - 1]);
    if (pts.length >= 2) {
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map((p) => p.clone().setY(p.y + 0.3))), new THREE.LineBasicMaterial({ color: 0x7dff9a, depthTest: false, transparent: true }));
        line.renderOrder = 1001;
        measureLayer.add(line);
    }
    const flat = pts.length >= 2 ? Math.hypot(pts[pts.length - 1].x - pts[pts.length - 2].x, pts[pts.length - 1].z - pts[pts.length - 2].z) : 0;
    $("hud").textContent = pts.length < 2 ? "Measure: click a point on the track, then the next ones. Escape ends it." :
        "Measure: " + total.toFixed(1) + " m in all (" + (total / 0.3048).toFixed(0) + " ft); the last piece " + flat.toFixed(1) + " m over the ground. Escape ends it.";
}
function clearMeasure() { measureState.points = []; disposeTree(measureLayer); }

// ---- where the pointer is: x, z and the height of the track under it, at the bottom left of the view
let coordsTime = 0;
renderer.domElement.addEventListener("pointermove", (event) => {
    const now = performance.now();
    if (now - coordsTime < 80 || drag) return;
    coordsTime = now;
    const p = surfacePoint(event, groundY(controls.target.x, controls.target.z), 5);
    $("coords").textContent = p ? "x " + p.x.toFixed(1) + "   z " + p.z.toFixed(1) + "   y " + p.y.toFixed(2) : "";
});
renderer.domElement.addEventListener("pointerleave", () => { $("coords").textContent = ""; });

// ---- the keys (?): a list in the view
function helpShown() { return $("helpPanel").style.display !== "none"; }
function toggleHelp(show) { $("helpPanel").style.display = (show === undefined ? !helpShown() : show) ? "" : "none"; }
$("helpButton").onclick = () => toggleHelp();
$("helpClose").onclick = () => toggleHelp(false);

// ---- the cards: a long explanation becomes a short line with an (i) button that shows the rest (editor-ui.js); the Layers panel moves up above the drawer of the road
document.querySelectorAll("#scroll .card p.sub").forEach((p) => {
    const text = p.textContent.replace(/\s+/g, " ").trim();
    if (text.length < 150) return;
    const first = (text.match(/^.*?[.:](\s|$)/) || [text])[0].trim().replace(/:$/, ".");
    const line = document.createElement("div");
    line.className = "tipline sub";
    const span = document.createElement("span");
    span.textContent = first.length > 130 ? first.slice(0, 120).replace(/\s\S*$/, "") + "…" : first;
    const info = document.createElement("button");
    info.type = "button"; info.className = "info"; info.textContent = "i"; info.dataset.tip = text; info.setAttribute("aria-label", "More information");
    line.append(span, info);
    p.replaceWith(line);
});
// the panels of the view do not lie over each other: the drawer of the road stands on the bar of the tools (which can take two or three rows), the Layers panel on the
// drawer, and the Layers panel stays under the bar at the top
function placePanels() {
    const modes = $("modes"), drawer = $("drawer"), layers = $("eventLayers");
    const barTop = modes.offsetHeight + 14 + 10;
    drawer.style.bottom = barTop + "px";
    const open = drawer.offsetHeight > 0;
    const bottom = open ? barTop + drawer.offsetHeight + 10 : barTop;
    layers.style.bottom = bottom + "px";
    layers.style.maxHeight = Math.max(120, view.clientHeight - bottom - 64) + "px";
    $("props").style.right = layers.style.display === "none" ? "16px" : "268px";
}
if (window.ResizeObserver) {
    const panels = new ResizeObserver(placePanels);
    [$("modes"), $("drawer"), view].forEach((e) => panels.observe(e));
    new MutationObserver(placePanels).observe($("drawer"), { attributes: true, attributeFilter: ["style", "class"] });
}
placePanels();

// ---- only what the work of the moment needs: while a curb is drawn or chosen the side bar shows the Curbs card and nothing else, while the grid or a gate
// is placed or chosen the card of the start and the gates, and so on (a bar at the top goes back to all of it); the drawer of the road shows only while the road
// is edited; the bar of the tools shows only the tool that is in use and Done; the Layers panel is a button.
const CONTEXTS = {
    line: ["editLine", "AI racing line"], ref: ["refPick", "Reference image"], curb: ["curbDraw", "Curbs"], gates: ["gridList", "Start and gates"],
    pit: ["pitList", "Pit"], objects: ["objectLibrary", "Objects"], cameras: ["cameras", "Cinematic cameras"], drag: [null, "Drag strip"], road: [null, "The road"], measure: [null, "Measure"]
};
let lastContext = null;
function contextOf() {
    if (lineEdit.editing) return "line";
    if (state.mode === "refscale" || refState.moving) return "ref";
    if (state.mode === "curb" || curbState.selected >= 0) return "curb";
    if (state.mode === "grid" || state.mode === "gate" || gateUi.selected >= 0 || boxSel.kind === "grid") return "gates";
    if (state.mode === "pitbox" || state.mode === "pitline" || boxSel.kind === "pit") return "pit";
    if (state.mode === "object" || objectUi.selected >= 0) return "objects";
    if (state.mode === "camera" || state.camSel >= 0) return "cameras";
    if (state.mode === "drag" || eventLayers.selected === "drag") return "drag";
    if (state.mode === "node" || state.mode === "prefab" || state.mode === "patch" || state.mode === "branch" || (design.active() && design.selection())) return "road";
    if (state.mode === "measure") return "measure";
    return "";
}
function updateContext() {
    const ctx = contextOf();
    $("drawer").classList.toggle("ctxHidden", ctx !== "road");
    if (ctx === lastContext) return;
    lastContext = ctx;
    const entry = CONTEXTS[ctx];
    const card = entry && entry[0] && $(entry[0]) ? $(entry[0]).closest("details.card") : null;
    document.querySelectorAll("#scroll details.card").forEach((c) => c.classList.toggle("ctxHidden", !!ctx && c !== card));
    if (card) card.open = true;
    $("focusBar").style.display = ctx ? "" : "none";
    $("focusTitle").textContent = entry ? entry[1] : "";
    $("focusNote").style.display = ctx && !card ? "" : "none";
    placePanels();
}
$("focusBack").onclick = () => {
    if (lineEdit.editing) { cancelLineEdit(); return; }
    if (refState.scale) endRefScale();
    clearSelection();
    setMode("view");
    updateContext();
};
// the Layers panel: shown or not with its button (kept in this browser)
const LAYERS_KEY = "openracer-track-editor-layers";
function showLayers(show) {
    $("eventLayers").style.display = show ? "" : "none";
    $("layersButton").classList.toggle("accent", show);
    try { localStorage.setItem(LAYERS_KEY, show ? "1" : "0"); } catch (e) { /* (private window) */ }
    placePanels();
}
document.querySelector("#modes .done").onclick = () => { if (state.mode === "curb") endCurbDraw(); clearSelection(); setMode("view"); };
$("layersButton").onclick = () => showLayers($("eventLayers").style.display === "none");
{ let shown = false; try { shown = localStorage.getItem(LAYERS_KEY) === "1"; } catch (e) { /* (private window) */ } showLayers(shown); }

// ---- touch screens (an iPad Air, in both directions): the side bar is a drawer that slides over the view, the bars are one row, what is touched is 44 px
// (editor.css: html.compact, html.touch). One finger uses the tool and two fingers move and zoom the view (the pen always uses the tool); what the keys do
// (Enter, Delete, Shift, W E R, F, Ctrl+D) is a button in the bar under the menu, and a long press on a button says what it does (its title).
var touchReady = false, touchInsert = false, draftResolved = false;
const compactQuery = window.matchMedia("(pointer: coarse), (max-width: 1100px)");
const coarseQuery = window.matchMedia("(pointer: coarse)");
const sideBar = $("side");
let orbitOn = false;
function pressKey(key, code, extra) { window.dispatchEvent(new KeyboardEvent("keydown", Object.assign({ key, code, bubbles: true, cancelable: true }, extra || {}))); }
function layoutClasses() {
    const root = document.documentElement;
    root.classList.toggle("compact", compactQuery.matches);
    root.classList.toggle("touch", coarseQuery.matches);
    if (!compactQuery.matches) sideBar.classList.remove("open");
    resize(); placePanels(); touchSync();
}
// what the tool of the moment lets a finger do, and which buttons of the bar under the menu show
function touchSync(modeChanged) {
    if (!touchReady) return;
    const touch = coarseQuery.matches;
    $("orbitToggle").style.display = touch && state.mode !== "view" ? "" : "none";
    $("orbitToggle").classList.toggle("accent", orbitOn);
    $("orbitToggle").classList.toggle("ghost", !orbitOn);
    controls.touches.ONE = state.mode === "view" || orbitOn ? THREE.TOUCH.ROTATE : -1;
    if (state.mode !== "node" && state.mode !== "view") { /* (a finger on the ground does what the tool does) */ }
    // the explanation of a tool: where the hints are hidden, a short message when it is chosen
    if (modeChanged && compactQuery.matches && state.mode !== "view" && !document.documentElement.classList.contains("hints")) editorToast($("hud").textContent, "ok");
    updateActions();
}
function updateActions() {
    if (!touchReady) return;
    const road = design.active && design.active();
    const chosen = anythingChosen() || !!(road && design.selection());
    const gizmo = objectUi.selected >= 0 || gateUi.selected >= 0 || !!boxSel.kind;
    const show = {
        finish: !!(road && design.isDrawing()) || (state.mode === "curb" && curbState.selected >= 0), insert: lineEdit.editing,
        move: gizmo, rotate: gizmo, scale: gizmo, frame: chosen, duplicate: chosen && !lineEdit.editing, delete: chosen
    };
    let any = false;
    document.querySelectorAll("#actions button").forEach((b) => { const on = !!show[b.dataset.act]; b.style.display = on ? "" : "none"; any = any || on; });
    $("actions").style.display = any && compactQuery.matches ? "" : "none";
    const insert = document.querySelector('#actions [data-act="insert"]');
    insert.classList.toggle("accent", touchInsert); insert.classList.toggle("ghost", !touchInsert);
    if (!lineEdit.editing && touchInsert) touchInsert = false;
}
document.querySelectorAll("#actions button").forEach((b) => b.onclick = () => {
    const act = b.dataset.act;
    if (act === "insert") touchInsert = !touchInsert;
    else if (act === "finish") pressKey("Enter", "Enter");
    else if (act === "delete") pressKey("Delete", "Delete");
    else if (act === "duplicate") pressKey("d", "KeyD", { ctrlKey: true });
    else if (act === "frame") pressKey("f", "KeyF");
    else pressKey({ move: "w", rotate: "e", scale: "r" }[act], { move: "KeyW", rotate: "KeyE", scale: "KeyR" }[act]);
    setTimeout(() => { noteEditorStep(); renderProps(); updateActions(); }, 0);
});
$("sideToggle").onclick = () => sideBar.classList.toggle("open");
$("hintToggle").onclick = () => document.documentElement.classList.toggle("hints");
$("orbitToggle").onclick = () => { orbitOn = !orbitOn; touchSync(); };
$("saveQuick").onclick = () => $("save").click();
view.addEventListener("pointerdown", () => sideBar.classList.remove("open"), true);
// the pen draws and places (and drags what it touches): it never turns the view, fingers do
renderer.domElement.addEventListener("pointerdown", (e) => { if (e.pointerType === "pen") controls.enabled = false; }, true);
["pointerup", "pointercancel"].forEach((t) => window.addEventListener(t, (e) => { if (e.pointerType === "pen") controls.enabled = true; }, true));
// a long press (touch) on a button, a label or a field: what its title says, in the message of the view (the title was only there for the mouse)
{
    let timer = 0, swallow = false, sx = 0, sy = 0;
    document.addEventListener("pointerdown", (e) => {
        swallow = false; clearTimeout(timer);
        if (e.pointerType !== "touch" || !e.target.closest) return;
        const el = e.target.closest("[title]");
        if (!el || !el.title || el === $("toast")) return;
        sx = e.clientX; sy = e.clientY;
        timer = setTimeout(() => { swallow = true; editorToast(el.title, "ok"); }, 550);
    }, true);
    document.addEventListener("pointermove", (e) => { if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 10) clearTimeout(timer); }, true);
    ["pointerup", "pointercancel"].forEach((t) => document.addEventListener(t, () => clearTimeout(timer), true));
    document.addEventListener("click", (e) => { if (swallow) { swallow = false; e.preventDefault(); e.stopPropagation(); } }, true);
}
// buttons with only a sign (✓ ↶ ↷ ▾ ?) say in words what they are
document.querySelectorAll("button").forEach((b) => { if (!b.getAttribute("aria-label") && b.title && b.textContent.trim().length <= 2) b.setAttribute("aria-label", b.title); });

// ---- the draft: what has not been saved is kept in this browser every few seconds (an iPad drops a tab that is in the background); the next time the track
// is opened the editor offers it. A save clears it.
function draftTrackId() { return $("id") ? $("id").value : ""; }
function readDraft() { try { return JSON.parse(localStorage.getItem("openracer-track-editor-draft")); } catch (e) { return null; } }
function clearDraft() { try { localStorage.removeItem("openracer-track-editor-draft"); } catch (e) { /* (no storage) */ } }
function saveDraft() {
    try {
        if (!draftResolved || !unsaved() || !draftTrackId()) return;
        localStorage.setItem("openracer-track-editor-draft", JSON.stringify({ id: draftTrackId(), at: Date.now(), editor: editorSnapshot(), design: design.active() ? design.toJSON() : null }));
    } catch (e) { /* (no storage, or it is full) */ }
}
const pendingDraft = readDraft();
async function offerDraft() {
    const draft = pendingDraft;
    draftResolved = true;
    if (!draft || !draft.id || draft.id !== draftTrackId() || !draft.editor) return;
    const same = draft.editor === editorSnapshot() && JSON.stringify(draft.design) === JSON.stringify(design.active() ? design.toJSON() : null);
    if (same) { clearDraft(); return; }
    const when = new Date(draft.at).toLocaleString();
    const ok = await OpenRacerDialog.ask({ title: "Restore the unsaved changes?", text: "The editor kept changes to “" + draft.id + "” from " + when + " that were never saved.", ok: "Restore", danger: false });
    if (!ok) { clearDraft(); return; }
    if (draft.design) startDesign(draft.design);
    restoreEditor(draft.editor);
    status("The unsaved changes are back. Save the track to keep them.", "ok");
}
setInterval(saveDraft, 8000);
document.addEventListener("visibilitychange", () => { if (document.hidden) saveDraft(); });
window.addEventListener("pagehide", saveDraft);
setInterval(() => { if (touchReady) $("saveQuick").textContent = unsaved() ? "Save •" : "Save"; }, 1500);

// Snap: what is placed or dragged goes to a grid of 1, 2 or 5 metres (the nodes, the points and the prefabs of the road, the nodes of the curbs, the objects, the cameras)
const SNAP_STEPS = [0, 1, 2, 5];
try { const saved = parseFloat(localStorage.getItem("openracer-track-editor-snap")); if (SNAP_STEPS.includes(saved)) snapStep = saved; } catch (e) { /* (no storage) */ }
function showSnap() {
    $("snapButton").textContent = snapStep ? "⌗ Snap " + snapStep + " m" : "⌗ Snap off";
    $("snapButton").classList.toggle("accent", !!snapStep); $("snapButton").classList.toggle("ghost", !snapStep);
}
$("snapButton").onclick = () => {
    snapStep = SNAP_STEPS[(SNAP_STEPS.indexOf(snapStep) + 1) % SNAP_STEPS.length];
    try { localStorage.setItem("openracer-track-editor-snap", String(snapStep)); } catch (e) { /* (no storage) */ }
    showSnap();
};
showSnap();

// The loupe: a finger (or the pen) hides the place that it points at, so while a finger is down with a tool, a round enlargement of that place shows above it
const loupe = document.createElement("canvas");
const LOUPE = 132, LOUPE_AREA = 46;
loupe.id = "loupe";
loupe.width = loupe.height = Math.round(LOUPE * Math.min(window.devicePixelRatio || 1, 2));
loupe.style.cssText = "position: absolute; display: none; width: " + LOUPE + "px; height: " + LOUPE + "px; border-radius: 50%; border: 3px solid #ffffffcc; box-shadow: 0 4px 18px #000a; pointer-events: none; z-index: 9; background: #20262f;";
view.appendChild(loupe);
var loupeState = { ids: new Set(), x: 0, y: 0 };
window.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    if (e.target === renderer.domElement) loupeState.ids.add(e.pointerId);
    loupeState.x = e.clientX; loupeState.y = e.clientY;
}, true);
window.addEventListener("pointermove", (e) => { if (loupeState.ids.has(e.pointerId)) { loupeState.x = e.clientX; loupeState.y = e.clientY; } }, true);
["pointerup", "pointercancel"].forEach((t) => window.addEventListener(t, (e) => { loupeState.ids.delete(e.pointerId); }, true));
function drawLoupe() {
    // (not with two fingers, which move the view, and not while a finger only turns it)
    const on = loupeState.ids.size === 1 && (state.mode !== "view" || !controls.enabled);
    if (!on) { if (loupe.style.display !== "none") loupe.style.display = "none"; return; }
    const gl = renderer.domElement, rect = gl.getBoundingClientRect(), k = gl.width / rect.width;
    const ctx = loupe.getContext("2d");
    const half = LOUPE_AREA / 2, x = loupeState.x - rect.left, y = loupeState.y - rect.top;
    ctx.clearRect(0, 0, loupe.width, loupe.height);
    ctx.drawImage(gl, (x - half) * k, (y - half) * k, LOUPE_AREA * k, LOUPE_AREA * k, 0, 0, loupe.width, loupe.height);
    const c = loupe.width / 2;
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2; ctx.shadowColor = "#000"; ctx.shadowBlur = 3;
    ctx.beginPath(); ctx.moveTo(c - 12, c); ctx.lineTo(c + 12, c); ctx.moveTo(c, c - 12); ctx.lineTo(c, c + 12); ctx.stroke();
    ctx.shadowBlur = 0;
    const left = Math.max(4, Math.min(rect.width - LOUPE - 4, x - LOUPE / 2));
    const top = y - LOUPE - 60 >= 4 ? y - LOUPE - 60 : y + 60;
    loupe.style.left = left + "px"; loupe.style.top = Math.min(top, rect.height - LOUPE - 4) + "px"; loupe.style.display = "block";
}

compactQuery.addEventListener("change", layoutClasses);
coarseQuery.addEventListener("change", layoutClasses);
touchReady = true;
layoutClasses();
try {
    if (coarseQuery.matches && !localStorage.getItem("openracer-track-editor-touchtip")) {
        localStorage.setItem("openracer-track-editor-touchtip", "1");
        setTimeout(() => editorToast("Touch: one finger uses the tool, two fingers move and zoom the view. ⟳ Turn view turns it with one finger. ☰ Menu has the settings, ⓘ Hints explains the tool.", "ok"), 1500);
    }
} catch (e) { /* (no storage) */ }

// ---- the last track that was opened: in the start dialog
const LAST_TRACK = "openracer-track-editor-last";

// ---- the start
renderLegend();
renderParts();
fillEnv(OpenRacer.environmentDefaults());
applyEnv();
updateLineNote();
editorReady = true;
updateUndoUi();
renderReady();
updateContext();
openFromAddress().then(async () => { resetHistory(); await offerDraft(); if (!new URLSearchParams(window.location.search).get("track")) startDialog(); });
