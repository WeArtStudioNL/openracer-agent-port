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
renderer.setPixelRatio(window.devicePixelRatio);
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
// the wheel zooms towards the point under the mouse (the track, its objects, else the floor) and the view then turns about it (zoom-to-mouse.js)
installZoomToMouse({ THREE, camera, controls, renderer, targets: () => [trackGroup, objectLayer], floorY: () => 0 });
// the objects of the track: models (glb) that were added, and where they stand. A model: { file (a Blob, when it was added now), name (the file in the folder of the track),
// kind (rigid, static or decor), mass (kg, 0: from its size), scene (the loaded model) }
const objectState = { models: new Map(), list: [], selected: null };
const library = { items: [] };                       // the library of models, the same for every track (objects/objects.json: [{ id, name, file, thumb, kind, mass }])
const gateUi = { selected: -1, dragging: false, width0: 24 };           // the gate that is chosen (the layers panel, a click in the view): its gizmo moves, turns and widens it
const raycaster = new THREE.Raycaster();

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
    updateMarkers();
});
scene.add(typeof camGizmo.getHelper === "function" ? camGizmo.getHelper() : camGizmo);
const DEFAULT_RANGE = 30;
function rangeOf(c) { return c.range || { x: c.x, z: c.z, r: DEFAULT_RANGE }; }
function selectCamera(i, rangeMode) {
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
window.addEventListener("keydown", (event) => {
    const t = event.target && event.target.tagName;
    if (event.code === "Escape" && t !== "INPUT" && t !== "TEXTAREA" && state.camSel >= 0) selectCamera(-1);
});

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
    updateMarkers();
}
function selectEvent(id) {
    eventLayers.selected = eventLayers.selected === id ? null : id;
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
    lineLayer.clear();
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
    selectLineNode(-1);
    status("Editing the line: click a node, move it with the arrows. Shift + click on the road adds a node, Delete takes the chosen one away.", "ok");
}
// a new line, drawn node by node: click on the road in the direction that the AI drives
function startLineDraw() {
    lineEdit.nodes = [];
    lineEdit.editing = true; lineEdit.show = true; lineEdit.drawing = true;
    selectLineNode(-1);
    status("Draw the line: click on the road, node after node, in the direction that the AI drives, all the way round (four at least). The line closes itself. Apply line saves it.", "ok");
}
function undoLineNode() {
    if (!lineEdit.nodes.length) return;
    lineEdit.nodes.pop();
    selectLineNode(-1);
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
window.addEventListener("keydown", (e) => {
    if (!lineEdit.editing || e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
    if (e.code === "Delete" || e.code === "Backspace") { deleteLineNode(); e.preventDefault(); }
    else if (e.code === "Escape") stopLineEdit();
});

function resize() {
    const w = view.clientWidth, h = view.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();
window.__trackEditorView = { scene, camera, renderer };          // (for the tests of the editor)
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
    trackGroup.clear();
    state.root = null;
    state.parts = new Map();
    state.roles = {};
    state.selected = null;
}

function registerMesh(mesh, role) {
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
function groundY(x, z, hint) {
    raycaster.set(new THREE.Vector3(x, (hint === undefined ? 10000 : hint + 50), z), new THREE.Vector3(0, -1, 0));
    const hits = raycaster.intersectObjects(trackGroup.children, true).filter((h) => DRIVABLE[state.roles[h.object.name || ""]]);
    return hits.length ? hits[0].point.y : (hint === undefined ? 0 : hint);
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
function makeArrow(x, y, z, h, colour, length) {
    return new THREE.ArrowHelper(new THREE.Vector3(Math.cos(h), 0, Math.sin(h)), new THREE.Vector3(x, y + 0.6, z), length, colour, length * 0.3, length * 0.2);
}

function updateMarkers() {
    markers.clear();
    showObjects();
    const k = state.markerScale;
    // the grid: a box on the road per place, box 1 (the start) in yellow with its arrow, the others in white, each with its number
    state.grid.forEach((b, i) => {
        const colour = i === 0 ? 0xffd04d : 0xffffff;
        const c = Math.cos(b.heading), sn = Math.sin(b.heading), ax = c * BOX_L / 2, az = sn * BOX_L / 2, bx = -sn * BOX_W / 2, bz = c * BOX_W / 2;
        const corners = [[b.x - ax + bx, b.z - az + bz], [b.x + ax + bx, b.z + az + bz], [b.x + ax - bx, b.z + az - bz], [b.x - ax - bx, b.z - az - bz]];
        const pts = corners.concat([corners[0]]).map((q) => new THREE.Vector3(q[0], groundY(q[0], q[1], b.y) + 0.08, q[1]));
        const loop = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: colour, depthTest: false }));
        loop.renderOrder = 996;
        markers.add(loop);
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
        const loop = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffe066, depthTest: false }));
        loop.renderOrder = 996;
        markers.add(loop);
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
    if (i >= 0 && gateUi.selected >= 0) selectGate(-1);
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
    const names = { translate: "Move (W)", rotate: "Turn (E)", scale: "Scale (R)" };
    const hint = $("objectGizmoMode");
    if (hint) hint.textContent = names[mode];
}
window.addEventListener("keydown", (event) => {
    const t = event.target && event.target.tagName;
    if (t === "INPUT" || t === "TEXTAREA" || t === "SELECT" || (objectUi.selected < 0 && gateUi.selected < 0)) return;
    if (event.code === "KeyW") setObjectGizmoMode("translate");
    else if (event.code === "KeyE") setObjectGizmoMode("rotate");
    else if (event.code === "KeyR") setObjectGizmoMode("scale");
    else if (event.code === "Delete" || event.code === "Backspace") {
        if (gateUi.selected >= 0) { state.gates.splice(gateUi.selected, 1); selectGate(-1); updateMarkers(); }
        else { objectState.list.splice(objectUi.selected, 1); selectObject(-1); updateMarkers(); }
    }
    else return;
    event.preventDefault();
});
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
    updateMarkers();
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
        if (objectUi.selected >= 0) selectObject(-1);
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
        const remove = document.createElement("button");
        remove.className = "small danger";
        remove.textContent = "Remove";
        remove.onclick = () => { state.grid.splice(i, 1); syncStart(); updateMarkers(); };
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
        const remove = document.createElement("button");
        remove.className = "small danger";
        remove.textContent = "Remove";
        remove.onclick = () => { state.pitBoxes.splice(i, 1); updateMarkers(); };
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
        remove.onclick = () => { state.gates.splice(i, 1); updateMarkers(); };
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
        remove.onclick = () => { state.cameras.splice(i, 1); selectCamera(-1); };
        row.appendChild(remove);
        list.appendChild(row);
    });
    $("cameraNote").textContent = state.cameras.length ? state.cameras.length + " cameras" : "none";
}

// the grid and the pit area: their buttons
// (the clear buttons ask first: there is no undo for the markers, and one click took all the boxes)
const clearOk = (what, count) => count > 1 ? OpenRacerDialog.ask({ title: "Clear " + what + "?", text: "All " + count + " of them. This cannot be undone.", ok: "Clear", danger: true }) : Promise.resolve(true);
$("gridClear").onclick = async () => { if (!(await clearOk("the grid", state.grid.length))) return; state.grid = []; syncStart(); updateMarkers(); };
$("pitClear").onclick = async () => { if (!(await clearOk("the pit boxes", state.pitBoxes.length))) return; state.pitBoxes = []; updateMarkers(); };
$("pitLineUndo").onclick = () => { state.pitLine.pop(); updateMarkers(); };
$("pitLineClear").onclick = async () => { if (!(await clearOk("the pit line", state.pitLine.length))) return; state.pitLine = []; updateMarkers(); };
// the design of a track without a model: nodes, heights, widths and prefabs (see track-design.js)
const design = createDesign({
    scene, trackGroup, camera, renderer, controls, state, registerMesh, applyColours, renderParts, updateMarkers, frameTrack, status, $,
    setMode, getMode: () => state.mode, roleMaterials, screenSize
});
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
    state.mode = mode;
    if (typeof renderLibrary === "function") renderLibrary();
    $("dragWindow").style.display = mode === "drag" ? "block" : "none";
    for (const button of document.querySelectorAll("#modes button")) button.classList.toggle("active", button.dataset.mode === mode);
    $("hud").textContent = (design && design.hudText(mode)) || (mode === "grid" ? "Grid box: click on the road where box " + Math.min(GRID_MAX, state.grid.length + 1) + " is and drag in the direction that the car faces (box 1 is the start of the player, 2 to 8 the opponents)."
        : mode === "pitline" ? "Pit line: click on the road, in the order that a car drives: the first point on the racing line where the pit lane starts, then through the pit lane through the middle of every box, and the last point back on the racing line. Undo the last point in the Pit boxes card."
        : mode === "pitbox" ? "Pit box: click on the road where the box of a player is (4 by 8 m) and drag in the direction that the car faces. Box 1 is the player's, 2 to 8 the opponents', as the grid."
        : mode === "gate" ? "Add gate: click on the road and drag in the direction that the car drives through the gate."
        : mode === "camera" ? "Add camera: click on the road or beside it, the camera is put above that place (set the height in the list). Click a camera in Look to choose it and move it with the gizmo; the button above it changes its range."
        : mode === "object" ? "Place object: click on the road (or the ground) where the object stands, and drag to turn it. Add a model with + in the Objects card first."
        : mode === "drag" ? "Drag strip: click on the road where the start line is and drag in the direction of the strip."
        : "Look: drag to turn, right mouse button to move, scroll to zoom. Click a part to find it in the list.");
}
document.querySelectorAll("#modes button").forEach((b) => b.onclick = () => setMode(b.dataset.mode));
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
    return (drivable[0] || hits[0] || null);
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
    if ((state.mode === "grid" || state.mode === "pitbox" || state.mode === "pitline" || state.mode === "gate" || state.mode === "drag" || state.mode === "camera" || state.mode === "object") && !moveGizmo.axis && !turnGizmo.axis && !objectGizmo.axis) {
        const hit = roadHit(event);
        if (hit) {
            drag.hit = hit;
            controls.enabled = false;
            renderer.domElement.setPointerCapture(event.pointerId);
        }
    }
});

renderer.domElement.addEventListener("pointermove", (event) => {
    if (!drag) return;
    if (Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) > 4) drag.moved = true;
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
    if (state.mode !== "camera" && !d.moved && !d.hit && state.cameras.length) {
        const hits = pointerRay(event).intersectObjects(markers.children, false).filter((h) => h.object.userData.camera !== undefined);
        if (hits.length) { selectCamera(hits[0].object.userData.camera, state.camRange && state.camSel === hits[0].object.userData.camera); return; }
    }
    if (d.hit) {
        if (state.mode === "pitline") { if (!d.moved) { state.pitLine.push({ x: d.hit.point.x, y: d.hit.point.y, z: d.hit.point.z }); updateMarkers(); } }
        else if (!d.added && (state.mode === "grid" || state.mode === "pitbox" || state.mode === "gate" || state.mode === "drag" || state.mode === "camera" || state.mode === "object")) place(d, false);
        return;
    }
    if (lineEdit.editing && !d.moved && !lineEdit.dragging) {
        const hits = pointerRay(event).intersectObjects(lineLayer.children, true).filter((h) => h.object.userData.lineNode !== undefined);
        if (hits.length) { selectLineNode(hits[0].object.userData.lineNode); return; }
        // a line that is drawn: a click on the road is the next node (Shift: between two others, as when a line is edited)
        if (lineEdit.drawing && !event.shiftKey) {
            const road = roadHit(event);
            if (road) { lineEdit.nodes.push({ x: road.point.x, y: road.point.y, z: road.point.z }); selectLineNode(-1); return; }
        }
        const road = event.shiftKey ? roadHit(event) : null;
        if (road) { addLineNodeAt(road.point.x, road.point.z); return; }
        if (!event.shiftKey) { selectLineNode(-1); return; }
    }
    if (state.mode === "view" && !d.moved && !lineEdit.editing && !(design && design.active()) && !objectGizmo.axis) {
        // an object that is clicked is chosen (its gizmo shows); a gate too; else the part of the model under the pointer
        const objectHit = pointerRay(event).intersectObjects(objectLayer.children, true)[0];
        if (objectHit && objectIndexOf(objectHit.object) >= 0) { selectObject(objectIndexOf(objectHit.object)); return; }
        const gateHit = pointerRay(event).intersectObjects(markers.children, false).find((h) => h.object.userData.gateIndex !== undefined);
        if (gateHit) { selectGate(gateHit.object.userData.gateIndex); return; }
        const hit = pointerRay(event).intersectObjects(trackGroup.children, true)[0];
        if (hit) selectPart(hit.object.name || "", true);
    }
});

$("topView").onclick = topView;
$("gateAtStart").onclick = () => {
    if (!state.start) { status("Place box 1 of the grid first (the start).", "error"); return; }
    const s = state.start;
    const width = Math.max(2, parseFloat($("gateWidth").value) || 24);
    // the finish line is a few metres in front of the start, so that the first gate is passed at the start of the first lap
    const x = s.x + Math.cos(s.heading) * 6, z = s.z + Math.sin(s.heading) * 6;
    state.gates.unshift({ x, y: groundY(x, z, s.y), z, heading: s.heading, width });
    updateMarkers();
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

async function loadExisting() {
    const id = $("existing").value;
    if (!id) return;
    const track = state.tracks.find((t) => t.id === id);
    if (!track) return;
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
        if (track.design && track.design.nodes) { startDesign(JSON.parse(JSON.stringify(track.design))); setMode("view"); }
        else if (track.model) { stopDesign(); await loadGltfTrack(track); }
        else { stopDesign(); await loadLegacyTrack(track); }
        // the heights of the start and the gates come from the road
        state.grid.forEach((b) => { b.y = groundY(b.x, b.z); });
        syncStart();
        if (state.pit) state.pit.points.forEach((q) => { q.y = groundY(q.x, q.z); });
        state.pitBoxes.forEach((b) => { b.y = groundY(b.x, b.z); });
        state.pitLine.forEach((q) => { q.y = groundY(q.x, q.z); });
        $("showGates").checked = !!track.show_gates;
        gateGizmo.detach(); gateUi.selected = -1;
        state.gates = (track.gates || []).map((g) => ({ x: g.x, y: groundY(g.x, g.z), z: g.z, heading: g.heading, width: g.width || 24 }));
        state.cameras = (track.cameras || []).filter((c) => isFinite(c.x) && isFinite(c.z)).map((c) => {
            const camera = { x: c.x, y: isFinite(c.y) ? c.y : groundY(c.x, c.z) + 3, z: c.z };
            if (c.range && isFinite(c.range.x) && isFinite(c.range.z) && c.range.r > 0) camera.range = { x: c.range.x, z: c.range.z, r: c.range.r };
            return camera;
        });
        selectCamera(-1);
        await loadObjects(track);
        state.drag = track.dragstrip ? { x: track.dragstrip.x, y: groundY(track.dragstrip.x, track.dragstrip.z), z: track.dragstrip.z, heading: track.dragstrip.heading || 0, width: track.dragstrip.width || 12, length: track.dragstrip.length || 402.336 } : null;
        showDrag();
        updateMarkers();
        updateLineNote();
        status("", "");
        markSaved();
    } catch (error) {
        status("Could not load the track: " + error.message, "error");
    }
}

function newTrack() {
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
}

// ---- the thumbnail: the track as the game shows it, from the camera as it stands, without the markers, the nodes, the gizmos and the line (everything in the scene that is
// not the track itself, its objects, its sky and its lights is hidden for one frame); 640 by 360, saved with the track as preview.webp (the menu shows it on the track's card)
function takeThumbnail() {
    if (!state.root && !design.active()) { status("Load or draw a track first.", "error"); return; }
    const keep = new Set([trackGroup, objectLayer, hemi, sun]);
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
            if (newModel) { delete config.racing_line; delete config.skidpad; }
            if (newModel || JSON.stringify(old.design || null) !== JSON.stringify(config.design || null)) {
                config.line_date = new Date().toISOString();
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

        status("Saving…");
        const files = {};
        for (const [fileName, file] of uploads) files[fileName] = file;
        const saved = await store(id, config, files, [oldSky, oldModel].filter(Boolean));
        state.existingId = id;
        state.existingTrack = Object.assign({}, config, { id });
        state.files = new Map();
        state.mainFile = null;
        state.skyName = config.environment && config.environment.sky_image || "";
        state.oldSkyName = state.skyName;
        state.skyFile = null;
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
        if (!(config.gates || []).length && !(config.checkpoints || []).length) missing.push("no gates: no lap counts (Gates, put gate 1 on the start line)");
        if (!(config.racing_line && config.racing_line.length > 10) && !(config.design && config.design.nodes)) missing.push("no racing line: the AI cannot race here (Record AI racing line)");
        if (lineOfOldRoad) missing.push("the racing line was made on the road as it was: record it again, or edit it to the new road");
        status((saved.where === "server" ? "Saved as tracks/" + id + ". It is in the main menu of the game now."
            : "Saved in your garage, in this browser (the server does not save). It is in the main menu of the game now.") +
            (missing.length ? "\nStill to do: " + missing.join("; ") + "." : ""), missing.length ? "warn" : "ok");
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
$("cancelLine").onclick = stopLineEdit;
$("showLine").onchange = () => { lineEdit.show = $("showLine").checked; drawLine(); };

$("clearLine").onclick = async () => {
    const track = state.existingTrack;
    if (!track || !track.racing_line) return;
    // (it is written to the saved track at once: a recorded line was gone for good with one click)
    if (!(await OpenRacerDialog.ask({ title: "Forget the racing line?", text: "The recorded line is removed from the saved track. The AI then follows " +
        (track.design && track.design.nodes ? "the middle of the road" : "the best lap driven here, or cannot race") + ".", ok: "Forget", danger: true }))) return;
    const config = JSON.parse(JSON.stringify(track));
    delete config.id;
    delete config.racing_line;
    config.line_date = new Date().toISOString();
    try {
        await store(track.id, config);
        delete track.racing_line;
        track.line_date = config.line_date;
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

function fingerprint() {
    try {
        const fields = [...document.querySelectorAll("input, select, textarea")].filter((e) => e.id && e.id !== "existing" && e.type !== "file")
            .map((e) => e.id + "=" + (e.type === "checkbox" ? e.checked : e.value));
        return JSON.stringify([fields, state.start, state.grid, state.pit, state.pitLine, state.pitBoxes, state.gates, state.cameras, state.drag, state.roles, state.env, state.skyName,
            design.active && design.active() ? design.toJSON() : null, objectState.list.map((o) => [o.model, o.x, o.y, o.z, o.heading, o.sx, o.sy, o.sz, o.pitch, o.roll]),
            [...objectState.models.values()].map((m) => [m.name, m.kind, m.mass, m.pivot]), !!state.thumbnail]);
    } catch (error) { return ""; }
}
let savedPrint = null;
function markSaved() { savedPrint = fingerprint(); }
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

function dialog(title, build) {
    const shade = document.createElement("div");
    shade.style.cssText = "position: fixed; left: 0; top: 0; width: 100%; height: 100%; z-index: 50; background: rgba(0, 0, 0, 0.6); display: flex; align-items: center; justify-content: center; font-family: inherit;";
    const box = document.createElement("div");
    box.style.cssText = "width: 440px; max-width: calc(100% - 32px); max-height: calc(100% - 32px); overflow-y: auto; background: #1d232c; border: 1px solid #323c4a; border-radius: 10px; padding: 18px 20px; color: #dfe6ef;";
    const heading = document.createElement("div");
    heading.textContent = title;
    heading.style.cssText = "font-size: 18px; font-weight: bold; margin-bottom: 10px;";
    box.appendChild(heading);
    shade.appendChild(box);
    document.body.appendChild(shade);
    const close = () => shade.remove();
    build(box, close);
    return { close, shade };
}

// Open track: every track is a button, and a click opens it at once (Back goes to the choices of the start)
function trackPicker() {
    dialog("Open a track", (box, close) => {
        const list = document.createElement("div");
        list.style.cssText = "display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; max-height: 60vh; overflow-y: auto; margin-bottom: 12px;";
        for (const t of state.tracks) {
            const b = document.createElement("button");
            b.style.cssText = "text-align: left; padding: 10px 14px; height: auto; white-space: normal;";
            b.innerHTML = "<b></b><div style='font-weight: normal; font-size: 12.5px; opacity: 0.75; margin-top: 2px'></div>";
            b.firstChild.textContent = t.name || t.id;
            b.lastChild.textContent = t.id;
            b.onclick = async () => { if (!(await discardOk())) return; $("existing").value = t.id; close(); loadExisting(); };
            list.appendChild(b);
        }
        box.appendChild(list);
        const back = document.createElement("button");
        back.textContent = "Back";
        back.onclick = () => { close(); startDialog(); };
        box.appendChild(back);
    });
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
        choice("Open track", state.tracks.length ? state.tracks.length + " tracks to change" : "There are no tracks yet", () => { if (state.tracks.length) { close(); trackPicker(); } });
        choice("Import height map", "A track from a height map (16 bit grey PNG) and a colour map", () => { close(); heightDialog(true); });
        choice("New track", "Start empty: import a model, or draw the road with nodes", async () => { if (await discardOk()) { close(); newTrack(); } });
    });
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
    });
}
$("importHeight").onclick = () => heightDialog(false);

renderLegend();
renderParts();
fillEnv(OpenRacer.environmentDefaults());
applyEnv();
updateLineNote();
openFromAddress().then(() => { if (!new URLSearchParams(window.location.search).get("track")) startDialog(); });

// Escape: always back to Look, with nothing chosen (objects, gates, the drag strip, a camera)
window.addEventListener("keydown", (event) => {
    if (event.code !== "Escape") return;
    const t = event.target && event.target.tagName;
    if (t === "INPUT" || t === "TEXTAREA" || t === "SELECT") return;
    selectObject(-1);
    selectGate(-1);
    if (state.selected !== null && state.selected !== undefined) selectPart(null);          // (the part of the model that is yellow: chosen by a click in Look)
    if (eventLayers.selected) selectEvent(eventLayers.selected);
    if (state.camSel >= 0) selectCamera(-1);
    if (state.mode !== "view" && !lineEdit.editing) setMode("view");
});
