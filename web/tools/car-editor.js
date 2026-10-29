/*
 * car-editor.js
 *
 * Description: A tool in the browser to make cars for OpenRacer: import a glTF or glb model (for example from Blender),
 *              show it with the places of the wheels, set up the car (size, chassis, drivetrain, engine, brakes) and
 *              save it as cars/<id>/ (car.json and the model files). The game finds the car by itself.
 *              Saving needs tools/serve.py (start-server.sh) to write the files.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { installZoomToMouse } from "./zoom-to-mouse.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { initSoftBody } from "./softbody-editor.js";
import { initDriver } from "./driver-editor.js";
import { initSuspension } from "./suspension-editor.js";

const $ = (id) => document.getElementById(id);
const SLOTS = ["FR", "FL", "RL", "RR"];
const SLOT_COLORS = { FR: 0xff6b6b, FL: 0x5ec8ff, RL: 0x8ee26b, RR: 0xffd04d };
const WHEEL_NAME = /wheel|tyre|tire|rim|felg|wiel|rueda|roue|ruota|velg|alloy/i;
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/;

let softBodyEditor = null; // the Soft body card (softbody-editor.js), made at the end
let driverEditor = null;   // the Driver card (driver-editor.js), made at the end
let suspensionEditor = null;                 // the Suspension and driveline card (suspension-editor.js)
const state = {
    files: new Map(),       // name -> File, the files that were picked
    mainFile: null,         // name of the glb or gltf among them
    existingId: null,       // the id of the car that is being edited
    existingModel: null,    // the model block of that car
    existingCar: null,      // the configuration of that car as it was loaded
    replacedModel: null,    // the model block that a new model replaces
    replaceNotes: [],
    materials: [],          // the materials of the model
    overrides: {},          // changes to the materials: material name -> { field: value }
    nodes: [],              // the named nodes of the model
    pendingLibrary: null,   // the rims and the tyres of the wheel library of a car that is loaded before the catalogue is (WheelLibrary.js)
    root: null,
    build: null,            // the engine as it is built (EngineBuild.js), or null: the curve is the car's own
    buildResult: null,
    curve: [[0, 0], [300, 80], [1000, 180], [2000, 230], [3000, 250], [4000, 255], [5000, 250], [6000, 225], [7000, 170]],
    idEdited: false,
    cars: []
};

// ---- the 3D view

const view = $("view");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
view.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x20262f);
const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 200);
camera.position.set(-5, 3, 6);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.4, 0);
controls.update();
// physically based materials need surroundings to reflect: a studio
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(4, 8, 5);
scene.add(sun);
const grid = new THREE.GridHelper(20, 40, 0x56627a, 0x333c4b);
scene.add(grid);
const axes = new THREE.AxesHelper(1);
scene.add(axes);
// the forward direction of the game
const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0.02, 0), 2.6, 0x4d8dff, 0.4, 0.25);
scene.add(arrow);
const pivot = new THREE.Group(); // holds the model with the turn, scale and offset of the car
scene.add(pivot);
const helpers = new THREE.Group();
const libPreview = new THREE.Group();                 // the rims and the tyres of the wheel library, drawn at the wheels of the model (WheelLibrary.js)
libPreview.name = "wheel library preview";
scene.add(libPreview);
let libHidden = [];                                   // the wheel parts of the model that the preview stands in for
const LIB_SELECTS = { front: { rim: "libRimFront", tyre: "libTyreFront" }, rear: { rim: "libRimRear", tyre: "libTyreRear" } };
scene.add(helpers);
const cameraMarkers = new THREE.Group(); // where the cameras of the game are
scene.add(cameraMarkers);

// the layers panel (see further down): what can be selected, and the gizmo that moves the cameras and the model
const LAYERS = [
    { group: "Cameras" },
    { id: "follow", label: "1 Follow camera", color: "#37d67a" },
    { id: "look", label: "1 Follow camera: looks at", color: "#9be8b8" },
    { id: "cockpit", label: "2 Cockpit camera", color: "#ff9f43" },
    { group: "Car" },
    { id: "model", label: "Model (offset)", color: "#c6cfdb" },
    { id: "steering", label: "Steering wheel", color: "#e0b040" },
    { id: "rig", label: "Suspension rig", color: "#9b8cff" },
    { group: "Wheels" },
    { id: "wFR", label: "Front right", color: "#ff6b6b" },
    { id: "wFL", label: "Front left", color: "#5ec8ff" },
    { id: "wRR", label: "Rear right", color: "#ffd04d" },
    { id: "wRL", label: "Rear left", color: "#8ee26b" }
];
const layers = { selected: null, dragging: false };
const gizmoTargets = { follow: new THREE.Object3D(), look: new THREE.Object3D(), cockpit: new THREE.Object3D(), model: pivot };
[gizmoTargets.follow, gizmoTargets.look, gizmoTargets.cockpit].forEach((o) => scene.add(o));
const gizmo = new TransformControls(camera, renderer.domElement);
gizmo.setSize(0.8);
gizmo.addEventListener("dragging-changed", (event) => { controls.enabled = !event.value; layers.dragging = event.value; if (!event.value) updateCameraMarkers(); });
gizmo.addEventListener("objectChange", () => { gizmoMoved(); syncExhaustFields(); });
scene.add(typeof gizmo.getHelper === "function" ? gizmo.getHelper() : gizmo);

// ---- the exhaust points: where the flames come out (pops, bangs, anti-lag; Flames.js in the game). A layer each, with a gizmo for the place and a second one
// for the direction: the flame goes along the negative z of the point, which the arrow shows. They go in car.json as "exhaust": [{ position, rotation (degrees) }]
const exhaust = [];                    // { id, target, pipe }
let flameTest = false, flames = null, flameTimer = 0, lastFrame = 0, smokePreview = null;     // the test of the flames (further down)
let exhaustCounter = 0;
const rotGizmo = new TransformControls(camera, renderer.domElement);
rotGizmo.setMode("rotate");
rotGizmo.setSpace("local");
rotGizmo.setSize(0.55);
rotGizmo.addEventListener("dragging-changed", (event) => { controls.enabled = !event.value; layers.dragging = event.value; if (!event.value) renderLayers(); });
rotGizmo.addEventListener("objectChange", () => { if (suspensionEditor && suspensionEditor.isMount(layers.selected)) { suspensionEditor.moved(layers.selected); return; } renderLayers(); syncExhaustFields(); });
scene.add(typeof rotGizmo.getHelper === "function" ? rotGizmo.getHelper() : rotGizmo);

// An exhaust point has two gizmos, one at a time (the buttons Move and Rotate of its window, or the W and E keys): the arrows move it, the rings turn it. Nothing is aligned
// for you: the point stays where you put it and points the way you turned it. The fields of the window give the numbers.
let exhaustMode = "move";
let exhaustFields = null;
function attachExhaustGizmo() {
    gizmo.detach(); rotGizmo.detach();
    const target = layers.selected && gizmoTargets[layers.selected];
    if (!target || !String(layers.selected).startsWith("ex")) return;
    if (exhaustMode === "move") { gizmo.attach(target); gizmo.showX = gizmo.showY = gizmo.showZ = true; }
    else rotGizmo.attach(target);
}
function syncExhaustFields() {
    const entry = exhaust.find((e) => e.id === layers.selected);
    if (!entry || !exhaustFields) return;
    const r = (v) => Math.round(v * 1000) / 1000, d = 180 / Math.PI;
    const p = entry.target.position, q = entry.target.rotation;
    exhaustFields.pos.forEach((input, i) => { if (document.activeElement !== input) input.value = r([p.x, p.y, p.z][i]); });
    exhaustFields.rot.forEach((input, i) => { if (document.activeElement !== input) input.value = Math.round([q.x, q.y, q.z][i] * d * 10) / 10; });
}
window.addEventListener("keydown", (e) => {
    if (!layers.selected || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target && e.target.tagName;
    if (t === "INPUT" || t === "TEXTAREA" || t === "SELECT") return;
    if (suspensionEditor && suspensionEditor.isMount(layers.selected)) {
        if (e.code === "KeyW") suspensionEditor.setMode("move"); else if (e.code === "KeyE") suspensionEditor.setMode("rotate");
        return;
    }
    if (!String(layers.selected).startsWith("ex")) return;
    if (e.code === "KeyW") { exhaustMode = "move"; attachExhaustGizmo(); updateExhaustWindow(); }
    else if (e.code === "KeyE") { exhaustMode = "rotate"; attachExhaustGizmo(); updateExhaustWindow(); }
});

const EXHAUST_DEFAULTS = { diameter: 0.08, smoke: 1, flame_length_cm: 30, flame_width_cm: 12, brightness: 1 };

function addExhaust(position, rotation, settings) {
    const target = new THREE.Object3D();
    const d = Math.PI / 180;
    target.position.set(position[0], position[1], position[2]);
    target.rotation.set(rotation[0] * d, rotation[1] * d, rotation[2] * d);
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.22, 14), new THREE.MeshBasicMaterial({ color: 0xff7a3d }));
    pipe.rotation.x = Math.PI / 2;     // along z, with its opening at the point and the rest of the pipe inside the car
    pipe.position.z = 0.11;
    const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, 0), 0.5, 0xffb070, 0.14, 0.09);
    target.add(pipe, arrow);
    const entry = { id: "ex" + (++exhaustCounter), target, pipe, s: Object.assign({}, EXHAUST_DEFAULTS, settings || {}) };
    // the older form had the length and the width as a factor: of 30 cm, and of 12 cm for a pipe of 8 cm
    if (settings && settings.flame_length !== undefined && settings.flame_length_cm === undefined) entry.s.flame_length_cm = Math.min(80, Math.max(1, Math.round(settings.flame_length * 30)));
    if (settings && settings.flame_width !== undefined && settings.flame_width_cm === undefined) entry.s.flame_width_cm = Math.min(80, Math.max(1, Math.round(settings.flame_width * 12 * entry.s.diameter / 0.08)));
    delete entry.s.flame_length; delete entry.s.flame_width;
    sizePipe(entry);
    pipe.userData.layer = entry.id;
    exhaust.push(entry);
    gizmoTargets[entry.id] = target;
    scene.add(target);
    return entry;
}

// the pipe of the marker has the diameter of the point
function sizePipe(entry) { const k = entry.s.diameter / 0.09; entry.pipe.scale.set(k, 1, k); }

function removeExhaust(id) {
    const i = exhaust.findIndex((e) => e.id === id);
    if (i < 0) return;
    if (layers.selected === id) selectLayer(id);          // (it is let go)
    scene.remove(exhaust[i].target);
    delete gizmoTargets[id];
    exhaust.splice(i, 1);
    renderLayers();
}

// the exhaust points of a car.json: the older form is a list of positions
function loadExhaust(list) {
    exhaust.slice().forEach((e) => removeExhaust(e.id));
    (list || []).forEach((e) => addExhaust(Array.isArray(e) ? e : e.position, Array.isArray(e) ? [0, 0, 0] : (e.rotation || [0, 0, 0]), Array.isArray(e) ? null : e));
    renderLayers();
}

// a new point: at the back of the car, on the other side than the last one
function newExhaust() {
    const centres = wheelCenters();
    const size = currentSizes();
    const rearZ = centres ? (centres.RL.c.z + centres.RR.c.z) / 2 - 0.7 : -size.dimensions.length * 0.45;
    const y = centres ? (centres.RL.c.y + centres.RR.c.y) / 2 - 0.05 : -0.3;
    const x = (exhaust.length % 2 === 0 ? -1 : 1) * size.dimensions.width * 0.3;
    return addExhaust([Math.round(x * 100) / 100, Math.round(y * 100) / 100, Math.round(rearZ * 100) / 100], [0, 0, 0]);
}

function exhaustConfig() {
    const r = (v) => Math.round(v * 1000) / 1000, deg = 180 / Math.PI;
    return exhaust.map((e) => ({ position: [r(e.target.position.x), r(e.target.position.y), r(e.target.position.z)],
        rotation: [r(e.target.rotation.x * deg), r(e.target.rotation.y * deg), r(e.target.rotation.z * deg)],
        diameter: r(e.s.diameter), smoke: r(e.s.smoke), flame_length_cm: r(e.s.flame_length_cm), flame_width_cm: r(e.s.flame_width_cm), brightness: r(e.s.brightness) }));
}

// The settings of the exhaust point that is chosen, in a window over the view: the diameter of the pipe, the smoke after a bang, the length and the width of the
// flame, and how bright it is (a pipe of 8 cm and the others at 100% are what the game has without them)
const EXHAUST_FIELDS = [
    ["diameter", "Diameter", "cm", 2, 20, 0.5, 100],
    ["smoke", "Smoke", "%", 0, 300, 10, 100],
    ["flame_length_cm", "Flame length", "cm", 1, 80, 1, 1],
    ["flame_width_cm", "Flame width", "cm", 1, 80, 1, 1],
    ["brightness", "Brightness", "%", 20, 300, 10, 100]
];
const exhaustWindow = document.createElement("div");
exhaustWindow.style.cssText = "position: absolute; left: 12px; bottom: 12px; width: 250px; padding: 10px 12px 12px; background: rgba(22, 27, 34, 0.94); border: 1px solid #323c4a; border-radius: 10px; color: #dfe6ef; font-size: 12.5px; display: none; z-index: 5;";
$("view").appendChild(exhaustWindow);
OpenRacer.Movable.make(exhaustWindow, { key: "editor-exhaust", handle: () => exhaustWindow.firstElementChild });
function updateExhaustWindow() {
    const entry = exhaust.find((e) => e.id === layers.selected);
    exhaustWindow.style.display = entry ? "block" : "none";
    if (!entry) return;
    exhaustWindow.innerHTML = "";
    const head = document.createElement("div");
    head.style.cssText = "display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-weight: bold;";
    head.style.touchAction = "none";
    head.style.cursor = "grab";
    head.innerHTML = "<span>Exhaust " + (exhaust.indexOf(entry) + 1) + "</span>";
    const close = document.createElement("button");
    close.textContent = "×";
    close.className = "small ghost";
    close.addEventListener("click", () => selectLayer(entry.id));
    head.appendChild(close);
    exhaustWindow.appendChild(head);
    // the two gizmos, one at a time
    const modes = document.createElement("div");
    modes.style.cssText = "display: flex; gap: 6px; margin-bottom: 8px;";
    [["move", "Move (W)"], ["rotate", "Rotate (E)"]].forEach(([mode, text]) => {
        const b = document.createElement("button");
        b.textContent = text;
        b.className = "small" + (exhaustMode === mode ? " accent" : " ghost");
        b.style.flex = "1";
        b.addEventListener("click", () => { exhaustMode = mode; attachExhaustGizmo(); updateExhaustWindow(); });
        modes.appendChild(b);
    });
    exhaustWindow.appendChild(modes);
    // the numbers of the place (m) and the turn (degrees), that can be typed too
    exhaustFields = { pos: [], rot: [] };
    [["Position", "pos", "m", 0.01], ["Rotation", "rot", "°", 1]].forEach(([label, key, unit, step]) => {
        const row = document.createElement("div");
        row.style.cssText = "display: flex; align-items: center; gap: 4px; margin: 4px 0;";
        const name = document.createElement("span");
        name.textContent = label;
        name.style.cssText = "width: 54px; flex: none; color: #9aa7b8;";
        row.appendChild(name);
        ["x", "y", "z"].forEach((axis, i) => {
            const input = document.createElement("input");
            input.type = "number"; input.step = step; input.style.cssText = "width: 50px; min-width: 0; padding: 4px 3px; font-size: 12px; box-sizing: border-box;"; input.title = axis + " (" + unit + ")";
            input.addEventListener("change", () => {
                const v = parseFloat(input.value);
                if (!Number.isFinite(v)) return;
                if (key === "pos") entry.target.position["xyz"[i]] = v;
                else entry.target.rotation["xyz"[i]] = v * Math.PI / 180;
                renderLayers();
            });
            exhaustFields[key].push(input);
            row.appendChild(input);
        });
        exhaustWindow.appendChild(row);
    });
    syncExhaustFields();
    EXHAUST_FIELDS.forEach(([key, label, unit, min, max, step, scale]) => {
        const row = document.createElement("div");
        row.style.cssText = "margin: 6px 0;";
        const line = document.createElement("div");
        line.style.cssText = "display: flex; align-items: center; gap: 6px;";
        const name = document.createElement("span");
        name.textContent = label;
        name.style.flex = "1";
        const number = document.createElement("input");
        number.type = "number"; number.min = min; number.max = max; number.step = step;
        number.style.width = "62px";
        const unitEl = document.createElement("span");
        unitEl.textContent = unit;
        unitEl.style.cssText = "width: 18px; color: #7f90a5;";
        line.append(name, number, unitEl);
        const range = document.createElement("input");
        range.type = "range"; range.min = min; range.max = max; range.step = step;
        range.style.width = "100%";
        const show = () => { const v = Math.round(entry.s[key] * scale * 10) / 10; number.value = v; range.value = v; };
        const set = (v) => {
            if (!Number.isFinite(v)) return;
            entry.s[key] = Math.min(max, Math.max(min, v)) / scale;
            sizePipe(entry);
            show();
        };
        range.addEventListener("input", () => set(parseFloat(range.value)));
        number.addEventListener("change", () => set(parseFloat(number.value)));
        show();
        row.append(line, range);
        exhaustWindow.appendChild(row);
    });
}

// the test of the flames: while it is on, the points make a flame now and then, the way the game does (Flames.js, with the pictures of web/images/flames/)
const standing = { px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1, vx: 0, vy: 0, vz: 0, wheels: [], collisionSpheres: null };
const flameCar = { exhaust: [], length: 4.5, width: 1.8, exhaustSystems: 1, imageBase: "../" };
window.carEditorView = { scene, camera, controls, exhaustConfig };       // (for the tests)
function setFlameTest(on) {
    flameTest = on;
    if (on && !flames && OpenRacer.ExhaustFlames) {
        // the smoke of the game (Smoke.js) is on its own layer of the camera
        if (OpenRacer.TyreSmoke) { smokePreview = new OpenRacer.TyreSmoke(scene); camera.layers.enable(1); flameCar.smoke = (x, y, z, vx, vy, vz) => smokePreview.spawn(x, y, z, vx, vy, vz, 0.15, false, true, true); }
        flames = new OpenRacer.ExhaustFlames(scene, flameCar);
    }
    if (!on && flames) { flames.clear(); if (smokePreview) smokePreview.clear(); }
    flameTimer = 0;
    renderLayers();
}
function updateFlames(now) {
    const dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    if (!flames) return;
    if (flameTest && exhaust.length) {
        flameTimer -= dt;
        if (flameTimer <= 0) {
            flameTimer = 0.18 + Math.random() * 0.4;
            flameCar.exhaust = exhaustConfig();
            flames.refresh();
            flames.emit({ vx: 0, vy: 0, vz: 0 }, { strength: 0.6 + Math.random() * 0.9, loud: 1, flame: 1 }, { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() });
        }
    }
    flames.update(dt, camera);
    if (smokePreview) smokePreview.update(dt, standing, camera, true);
}

// While the crash test runs the bars are away and the view is wider. The camera must not jump: viewLock = { cx } is the middle (in the page) of the
// view as it was, and the picture is kept where it was on the screen: the view shows a part of a wider picture that is centred on that middle.
// ---- the view: perspective or orthographic (the same camera object, so the gizmos, the picking and the other editors keep working: the flags that three.js looks at and the
// projection are switched), and the standard views (left, right, top, bottom, front) at the distance the camera has
let ortho = false, orthoHalf = 2;
// the wheel zooms towards the point under the mouse (the model, else the floor) and the view then turns about it (zoom-to-mouse.js)
installZoomToMouse({ THREE, camera, controls, renderer, targets: () => [pivot], isOrtho: () => ortho, floorY: () => grid.position.y });
const perspectiveProjection = camera.updateProjectionMatrix.bind(camera);
camera.updateProjectionMatrix = function () {
    if (!ortho) { perspectiveProjection(); return; }
    const h = orthoHalf / (camera.zoom || 1), w = h * camera.aspect;
    camera.left = -w; camera.right = w; camera.top = h; camera.bottom = -h;
    camera.projectionMatrix.makeOrthographic(-w, w, h, -h, camera.near, camera.far);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
};
function setOrtho(on) {
    if (on === ortho) return;
    const dist = camera.position.distanceTo(controls.target);
    if (on) { orthoHalf = dist * Math.tan(camera.fov * Math.PI / 360); camera.zoom = 1; }
    else {
        // back to a perspective that shows the same size: the camera at the distance that gives the half height of the picture
        const want = (orthoHalf / (camera.zoom || 1)) / Math.tan(camera.fov * Math.PI / 360);
        const dir = camera.position.clone().sub(controls.target).normalize();
        camera.position.copy(controls.target).addScaledVector(dir, want);
        camera.zoom = 1;
    }
    ortho = on;
    camera.isPerspectiveCamera = !on; camera.isOrthographicCamera = on;
    camera.updateProjectionMatrix();
    controls.update();
    $("viewOrtho").classList.toggle("accent", on);
    // the button shows the view it is in: a box with converging edges (perspective) or with parallel edges (orthographic)
    $("viewOrtho").innerHTML = on ? VIEW_ICON_ORTHO : VIEW_ICON_PERSP;
    $("viewOrtho").title = on ? "Orthographic view (no perspective); click for perspective (O)" : "Perspective view; click for orthographic (no perspective) (O)";
}
const VIEW_ICON_PERSP = '<svg width="18" height="16" viewBox="0 0 18 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M2 14 L16 14 L12.5 5 L5.5 5 Z"/><path d="M5.5 5 L7 2 L11 2 L12.5 5"/><path d="M2 14 L7 2 M16 14 L11 2"/></svg>';
const VIEW_ICON_ORTHO = '<svg width="18" height="16" viewBox="0 0 18 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M3 5 L10 2 L15 4 L15 11 L8 14 L3 12 Z"/><path d="M3 5 L8 7 L15 4 M8 7 L8 14"/></svg>';
function standardView(dx, dy, dz) {
    const dist = Math.max(0.5, camera.position.distanceTo(controls.target));
    camera.position.set(controls.target.x + dx * dist, controls.target.y + dy * dist, controls.target.z + dz * dist + (dy ? 0.0001 : 0));
    camera.lookAt(controls.target);
    controls.update();
}
$("viewOrtho").addEventListener("click", () => setOrtho(!ortho));
// the view back to its standard: perspective, the camera upright and unzoomed, looking at the model from the front left (a scroll beside every surface can send it far away)
function resetView() {
    setOrtho(false);
    camera.up.set(0, 1, 0);
    camera.zoom = 1;
    camera.near = 0.05; camera.far = 200;
    controls.target.set(0, 0.4, 0);
    camera.position.set(-5, 3, 6);
    camera.updateProjectionMatrix();
    controls.update();
    if (state.root) frameModel();
}
$("viewReset").addEventListener("click", resetView);
// the views: a dropdown at the top right (x is the left of the car); it goes back to its heading after a choice, so the same view can be chosen again
$("viewSelect").addEventListener("change", () => { const v = $("viewSelect").value; if (v) { const [x, y, z] = v.split(",").map(Number); standardView(x, y, z); } $("viewSelect").value = ""; $("viewSelect").blur(); });
window.addEventListener("keydown", (e) => {
    if (/input|textarea|select/i.test((document.activeElement || {}).tagName || "")) return;
    if (e.key === "o" || e.key === "O") setOrtho(!ortho);
    else if (e.key === "Home") resetView();
    else if (e.code === "Numpad4") standardView(1, 0, 0); else if (e.code === "Numpad6") standardView(-1, 0, 0);
    else if (e.code === "Numpad8") standardView(0, 1, 0); else if (e.code === "Numpad2") standardView(0, -1, 0); else if (e.code === "Numpad5") standardView(0, 0, 1);
    else if (e.code === "Numpad1") standardView(0, 0, -1);
    else return;
    e.preventDefault();
});
$("viewOrtho").innerHTML = VIEW_ICON_PERSP;

let viewLock = null;
function resize() {
    const w = view.clientWidth, h = view.clientHeight;
    renderer.setSize(w, h, false);
    if (viewLock) {
        const c = viewLock.cx - view.getBoundingClientRect().left;       // the old middle, in this view
        const half = Math.max(c, w - c), full = 2 * half;
        camera.aspect = full / h;
        camera.setViewOffset(full, h, half - c, 0, w, h);
    } else {
        camera.clearViewOffset();
        camera.aspect = w / h;
    }
    camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
new ResizeObserver(resize).observe(view);
resize();
(function loop(now) {
    requestAnimationFrame(loop);
    if (window.benchFrame) window.benchFrame(now || performance.now()); // the test bench, once the module has made it (below)
    updateFlames(now || performance.now());
    if (driverEditor) driverEditor.frame(0.016);
    renderer.render(scene, camera);
    renderThumbnail();
})();

// ---- messages

function status(text, kind) {
    const el = $("status");
    el.textContent = text;
    el.className = kind || "";
    if (window.editorToast) window.editorToast(text, kind);
}

function num(id) {
    return parseFloat($(id).value);
}

// ---- the model

function loadFromFiles(list) {
    state.files = new Map();
    for (const file of list) state.files.set(file.name, file);
    const main = [...state.files.keys()].find((n) => /\.glb$/i.test(n)) || [...state.files.keys()].find((n) => /\.gltf$/i.test(n));
    if (!main) {
        status("Pick a .glb file, or a .gltf with its .bin and texture files.", "error");
        return;
    }
    state.mainFile = main;
    // a car that exists keeps its model block until it is saved: its transform and the way it is set up are kept
    const replacing = !!state.existingId;
    state.replacedModel = state.existingModel;
    state.existingModel = null;
    const urls = new Map();
    for (const [name, file] of state.files) urls.set(name, URL.createObjectURL(file));
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
        const name = decodeURIComponent(url.split("?")[0].split("/").pop());
        return urls.has(name) ? urls.get(name) : url;
    });
    status("Loading " + main + "…");
    new GLTFLoader(manager).load(urls.get(main), (gltf) => {
        setModel(gltf.scene, !replacing, replacing);
        setDirty(true);
        $("modelInfo").textContent = main + " (" + (state.files.get(main).size / 1048576).toFixed(1) + " MB), " + state.nodes.length + " named parts";
        if (!replacing) quickSetup(main);
    }, undefined, (error) => status("Could not read the model: " + (error.message || error), "error"));
}

// the model of a car that exists; a car of the garage or of a folder on the PC has its files as blob URLs (Garage.js)
function loadFromUrl(url, label, car) {
    new GLTFLoader(OpenRacer.Garage.manager(car, THREE)).load(OpenRacer.Garage.resolve(car, url), (gltf) => {
        setModel(gltf.scene, false);
        $("modelInfo").textContent = label + ", " + state.nodes.length + " named parts";
    }, undefined, (error) => status("Could not load the model of this car: " + (error.message || error), "error"));
}

function setModel(root, isNew, replace) {
    if (state.root) pivot.remove(state.root);
    state.root = root;
    pivot.add(root);
    state.materials = OpenRacer.prepareMaterials(THREE, root);
    setTimeout(applyPaint, 0);                                   // (the paint of the tuning card, on the new model)
    if (replace) {
        // the materials that the new model still has keep their changes; the others are dropped
        const names = new Set(state.materials.map((m) => m.name));
        const dropped = Object.keys(state.overrides).filter((n) => !names.has(n));
        dropped.forEach((n) => delete state.overrides[n]);
        state.replaceNotes = dropped.length ? ["Material changes dropped, the new model has no material of that name: " + dropped.join(", ")] : [];
        state.materials.forEach((m) => {
            if (!state.overrides[m.name] && /glass|window|windscreen|windshield|ruit/i.test(m.name) && !m.map && !m.transparent && m.opacity === 1) {
                state.overrides[m.name] = Object.assign({}, OpenRacer.materialPresets["Glass"]);
            }
        });
    } else if (isNew || state.autoGlass) {
        // glass that the exporter did not understand arrives as an opaque white metal: start with glass that is see-through
        if (isNew) state.overrides = {};
        state.materials.forEach((m) => {
            if (!state.overrides[m.name] && /glass|window|windscreen|windshield|ruit/i.test(m.name) && !m.map && !m.transparent && m.opacity === 1) {
                state.overrides[m.name] = Object.assign({}, OpenRacer.materialPresets["Glass"]);
            }
        });
    }
    renderMaterials();
    state.nodes = [];
    const walk = (object, depth) => {
        if (object !== root && object.name) state.nodes.push({ name: object.name, depth, object });
        object.children.forEach((child) => walk(child, depth + 1));
    };
    walk(root, 0);
    renderLayers();
    updateSteeringInfo();
    for (const slot of SLOTS) {
        const select = $("w" + slot);
        select.innerHTML = "";
        state.nodes.forEach((node) => {
            const option = document.createElement("option");
            option.value = node.name;
            option.textContent = "  ".repeat(node.depth - 1) + node.name;
            select.appendChild(option);
        });
    }
    if (replace) {
        replaceModel();
    } else if (isNew) {
        $("rotation").value = 0;
        $("scale").value = 1;
        $("offsetX").value = $("offsetY").value = $("offsetZ").value = 0;
        applyTransform();
        guessWheels();
        if (wheelCenters()) fit();
        sizeFromModel();
        if (wheelCenters()) chassisFromWheels();
        defaultCameras();
        frameModel();
    } else {
        applyTransform();
        updateHelpers();
        frameModel();
    }
}

// A new model for a car that exists: the transform, the wheels (by the names of their parts) and the changes to the materials
// are kept where the new model still fits them; the chassis, the cameras, the engine and the sound are not touched.
function replaceModel() {
    const previous = state.replacedModel;
    const notes = state.replaceNotes || [];
    const legacy = !previous || previous.type !== "gltf";
    if (legacy) {
        // the old model was the model of the demo: there is no transform to keep
        $("rotation").value = 0;
        $("scale").value = 1;
        $("offsetX").value = $("offsetY").value = $("offsetZ").value = 0;
    }
    applyTransform();

    // the wheels
    const wanted = state.existingCar && state.existingCar.wheels && state.existingCar.wheels.nodes;
    const names = new Set(state.nodes.map((n) => n.name));
    let kept = false;
    if (!legacy && wanted && SLOTS.every((slot) => wanted[slot] && wanted[slot].some((n) => names.has(n)))) {
        for (const slot of SLOTS) {
            [...$("w" + slot).options].forEach((o) => { o.selected = wanted[slot].includes(o.value); });
        }
        document.querySelector("input[name=wheelMode][value=model]").checked = true;
        $("wheelSelects").style.display = "";
        updateHelpers();
        kept = true;
        notes.push("The wheels were found again by the names of their parts.");
    } else {
        document.querySelector("input[name=wheelMode][value=model]").checked = true;
        $("wheelSelects").style.display = "";
        guessWheels();
        notes.push(wheelCenters() ? "The wheels were looked for by their names and places: check them." : "The parts of the wheels were not found: select them, or use the wheel of the demo car.");
    }
    if (legacy && wheelCenters()) fit();

    // does the new model fit the chassis of the car?
    const centres = wheelCenters();
    if (centres) {
        const wheelbase = ((centres.FR.c.z + centres.FL.c.z) / 2) - ((centres.RR.c.z + centres.RL.c.z) / 2);
        const track = Math.abs(centres.FL.c.x - centres.FR.c.x);
        const diameter = meanTyre(centres);
        const off = [];
        if (Math.abs(wheelbase - num("wheelbase")) > 0.03) off.push("wheelbase " + wheelbase.toFixed(2) + " m (car: " + num("wheelbase") + ")");
        if (Math.abs(track - num("frontTrack")) > 0.03) off.push("front track " + track.toFixed(2) + " m (car: " + num("frontTrack") + ")");
        if (Math.abs(diameter - num("tyre")) > 0.02) off.push("tyre " + diameter.toFixed(2) + " m (car: " + num("tyre") + ")");
        if (off.length) notes.push("The new model measures " + off.join(", ") + ". \"Take wheelbase, track and tyre from the wheels\" sets the car to it; the car was left as it is.");
    }
    $("modelNote").textContent = "";
    status("The model is replaced, it is saved with “Save the car”.\n" + notes.join("\n"), "ok");
    frameModel();
    return kept;
}

function frameModel() {
    const box = new THREE.Box3().setFromObject(pivot);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const distance = Math.max(size.x, size.y, size.z) * 1.9 + 1;
    controls.target.copy(centre);
    camera.position.set(centre.x - distance * 0.7, centre.y + distance * 0.4, centre.z + distance * 0.7);
    camera.near = distance / 200;
    camera.far = distance * 40;
    camera.updateProjectionMatrix();
    controls.update();
}

function applyTransform() {
    pivot.rotation.y = (num("rotation") || 0) * Math.PI / 180;
    pivot.scale.setScalar(num("scale") > 0 ? num("scale") : 1);
    pivot.position.set(num("offsetX") || 0, num("offsetY") || 0, num("offsetZ") || 0);
    pivot.updateMatrixWorld(true);
    updateHelpers();
}

// the parts that are selected for a wheel, without the parts that are inside other selected parts
function wheelParts(slot) {
    if (!state.root) return [];
    const names = [...$("w" + slot).selectedOptions].map((o) => o.value);
    const parts = names.map((n) => state.root.getObjectByName(n)).filter(Boolean);
    return parts.filter((p) => !parts.some((o) => o !== p && isInside(p, o)));
}

function isInside(part, other) {
    for (let p = part.parent; p; p = p.parent) if (p === other) return true;
    return false;
}

function wheelBox(slot) {
    const parts = wheelParts(slot);
    if (!parts.length) return null;
    const box = new THREE.Box3();
    parts.forEach((p) => box.expandByObject(p));
    return box;
}

// the centres of the four wheels (in the space of the car), or null if a wheel has no parts
// the diameter of the tyre: the mean of the wheels that are wheels (a motorcycle has dots of a millimetre for the two slots that it does not need)
function meanTyre(c) {
    const sizes = SLOTS.map((s) => c[s].size.y), big = Math.max(...sizes), real = sizes.filter((v) => v >= 0.5 * big);
    return real.reduce((a, v) => a + v, 0) / real.length;
}

function isBike() { return $("vehicleType").value === "motorcycle"; }
// The type of the vehicle: a motorcycle shows only what a motorcycle has (the parts of the form marked carOnly go, the bikeOnly ones come), its wheels are one at each
// end (the Front left and Rear left selects; the right slots are kept the same, the physics has a pair 4 cm apart), the drive is to the rear wheel through a welded diff
const BIKE_DEFAULTS = { max_lean_deg: 52, fast_lean_deg: 30, rake_deg: 24.5, rider_mass: 80, hang_off: 0.3, max_lateral_g: 0.9, balance: 1, fork_dive: 1 };
function applyTypeUI() {
    const bike = isBike();
    document.body.classList.toggle("bike", bike);
    $("lblFL").innerHTML = bike ? '<span style="color:#5ec8ff">■</span> Front wheel' : '<span style="color:#5ec8ff">■</span> Front left';
    $("lblRL").innerHTML = bike ? '<span style="color:#8ee26b">■</span> Rear wheel' : '<span style="color:#8ee26b">■</span> Rear left';
    if (bike) { $("drive").value = "rwd"; $("diff").value = "welded"; syncBikeWheels(); }
    if (state.root) updateHelpers();
}
function syncBikeWheels() {
    if (!isBike()) return;
    [["FL", "FR"], ["RL", "RR"]].forEach(([from, to]) => {
        const names = [...$("w" + from).selectedOptions].map((o) => o.value);
        [...$("w" + to).options].forEach((o) => { o.selected = names.includes(o.value); });
    });
}
function fillBike(m) {
    const v = Object.assign({}, BIKE_DEFAULTS, m || {});
    $("bikeMaxLean").value = v.max_lean_deg; $("bikeFastLean").value = v.fast_lean_deg; $("bikeRake").value = v.rake_deg;
    $("bikeRiderMass").value = v.rider_mass; $("bikeHangOff").value = v.hang_off; $("bikeMaxLatG").value = v.max_lateral_g; $("bikeBalance").value = v.balance; $("bikeForkDive").value = v.fork_dive;
}
function readBike() {
    const n = (id, key) => { const x = parseFloat($(id).value); return Number.isFinite(x) ? x : BIKE_DEFAULTS[key]; };
    return { max_lean_deg: n("bikeMaxLean", "max_lean_deg"), fast_lean_deg: n("bikeFastLean", "fast_lean_deg"), rake_deg: n("bikeRake", "rake_deg"), rider_mass: n("bikeRiderMass", "rider_mass"), hang_off: n("bikeHangOff", "hang_off"), max_lateral_g: n("bikeMaxLatG", "max_lateral_g"), balance: n("bikeBalance", "balance"), fork_dive: n("bikeForkDive", "fork_dive") };
}
$("vehicleType").addEventListener("change", applyTypeUI);
["wFL", "wRL"].forEach((id) => $(id).addEventListener("change", syncBikeWheels));

function wheelCenters() {
    if (wheelMode() !== "model") return null;
    const centres = {};
    for (const slot of SLOTS) {
        const box = wheelBox(slot);
        if (!box) return null;
        centres[slot] = { c: box.getCenter(new THREE.Vector3()), size: box.getSize(new THREE.Vector3()) };
    }
    return centres;
}

function wheelRadio() {
    return document.querySelector("input[name=wheelMode]:checked").value;
}
// a model without wheels (its parts of a wheel are not chosen) whose two axles have a rim of the wheel library: the wheels are the library's, put where the form says (the wheelbase and the
// tracks of the Chassis card), as with the demo wheel; the test and the shell of the car work then too
function libraryOnly() {
    if (wheelRadio() !== "model") return false;
    if (SLOTS.some((slot) => $("w" + slot).selectedOptions.length)) return false;
    return !!($("libRimFront").value && $("libRimRear").value);
}
function wheelMode() {
    return libraryOnly() ? "default" : wheelRadio();
}

function updateHelpers() {
    helpers.clear();
    updateLibraryPreview();
    for (const slot of SLOTS) {
        const box = wheelMode() === "model" ? wheelBox(slot) : null;
        if (box) helpers.add(new THREE.Box3Helper(box, SLOT_COLORS[slot]));
    }
    const centres = wheelCenters();
    $("wheelInfo").textContent = wheelMode() === "model" ? (centres ? "4 of 4 found" : "") : (libraryOnly() ? "rims of the library" : "demo wheel");
    // a chip for each wheel: the parts that it has, or that it has none
    const chips = $("wheelChips");
    chips.innerHTML = "";
    for (const slot of isBike() ? ["FL", "RL"] : SLOTS) {
        const names = [...$("w" + slot).selectedOptions].map((o) => o.value.trim());
        const chip = document.createElement("span");
        chip.className = names.length ? "" : "missing";
        chip.style.borderColor = names.length ? "#" + SLOT_COLORS[slot].toString(16).padStart(6, "0") : "";
        chip.textContent = ({ FR: "Front right", FL: "Front left", RR: "Rear right", RL: "Rear left" })[slot] + ": " + (names.length ? (names.length > 1 ? names[0] + " +" + (names.length - 1) : names[0]) : "none");
        chips.appendChild(chip);
    }
    if (suspensionEditor) suspensionEditor.refresh(false);          // the mounts and the parts of the parts library follow the wheels
    const radius = (num("tyre") || 0.65) / 2;
    grid.position.y = wheelMode() === "model" && centres ? Math.min(...SLOTS.map((s) => centres[s].c.y - centres[s].size.y / 2)) : -radius;
    updateSpeedInfo();
    const box = new THREE.Box3().setFromObject(pivot);
    $("hud").textContent = !state.root ? "Drop a .glb file here to make a car" : "Blue arrow: forward. The axes are the origin: it has to be at the height of the wheel axles, between the axles.\n" +
        "Model " + box.getSize(new THREE.Vector3()).toArray().map((v) => v.toFixed(2)).join(" x ") + " m (width x height x length)";
}

// A new model is set up by itself: the wheels are found, the car takes its size from them and the model is put on the floor; what is left is a name and Save and drive
function quickSetup(file) {
    guessWheels();
    const ok = SLOTS.every((s) => $("w" + s).selectedOptions.length);
    if (ok) { chassisFromWheels(); fit(); sizeFromModel(); }
    if (!state.existingId && !$("name").value.trim()) { $("name").value = file.replace(/\.(glb|gltf)$/i, "").replace(/[_-]+/g, " ").trim(); if (!state.idEdited) $("id").value = slug($("name").value); }
    status(ok ? "Ready: Save and drive." : "Pick the four wheels (Wheels card), then Save and drive.", ok ? "ok" : "error");
}

function guessWheels() {
    if (!state.root) return;
    pivot.updateMatrixWorld(true);
    const all = new THREE.Box3().setFromObject(pivot);
    const centre = all.getCenter(new THREE.Vector3());
    const size = all.getSize(new THREE.Vector3());
    let candidates = [];
    state.root.traverse((o) => {
        if (o === state.root || !o.name || !WHEEL_NAME.test(o.name) || /steer|stuur|lenk|volant/i.test(o.name)) return; // not the steering wheel
        const box = new THREE.Box3().setFromObject(o);
        if (box.isEmpty()) return;
        const s = box.getSize(new THREE.Vector3());
        if (s.z > size.z * 0.4 || s.x > size.x * 0.5) return; // a part that is much bigger than a wheel
        candidates.push({ o, c: box.getCenter(new THREE.Vector3()) });
    });
    candidates = candidates.filter((a) => !candidates.some((b) => b !== a && isInside(a.o, b.o)));
    const picked = { FR: [], FL: [], RL: [], RR: [] };
    // a name that says which wheel it is wins over the place (the model may still have to be turned)
    const byName = (name) => {
        const n = name.toLowerCase().replace(/[^a-z]/g, " ");
        const m = n.match(/\b(fr|fl|rl|rr|lf|rf|lr|rb|lb|rr)\b/) || n.match(/\b(front|rear|back)\b.*\b(left|right)\b/) || n.match(/\b(left|right)\b.*\b(front|rear|back)\b/);
        if (!m) return null;
        if (m[2]) {
            const front = /front/.test(m[0]), left = /left/.test(m[0]);
            return (front ? "F" : "R") + (left ? "L" : "R");
        }
        const code = m[1];
        return { fr: "FR", fl: "FL", rl: "RL", rr: "RR", lf: "FL", rf: "FR", lr: "RL", rb: "RR", lb: "RL" }[code] || null;
    };
    candidates.forEach(({ o, c }) => {
        const named = byName(o.name);
        if (named) { picked[named].push(o.name); return; }
        const front = c.z > centre.z;
        const left = c.x > centre.x; // facing +z, the left of the car is +x
        picked[(front ? "F" : "R") + (left ? "L" : "R")].push(o.name);
    });
    for (const slot of SLOTS) {
        [...$("w" + slot).options].forEach((option) => { option.selected = picked[slot].includes(option.value); });
    }
    updateHelpers();
    const missing = SLOTS.filter((s) => !picked[s].length);
    status(missing.length ? "No parts found for: " + missing.join(", ") + ". Select them by hand, or use the wheel of the demo car." : "Found the wheels.", missing.length ? "error" : "ok");
}

// puts the origin of the model where the game wants it
function fit() {
    if (!state.root) return;
    pivot.updateMatrixWorld(true);
    const centres = wheelCenters();
    let ox = num("offsetX") || 0, oy = num("offsetY") || 0, oz = num("offsetZ") || 0;
    if (centres) {
        const avg = new THREE.Vector3();
        SLOTS.forEach((s) => avg.add(centres[s].c));
        avg.divideScalar(4);
        ox -= avg.x; oy -= avg.y; oz -= avg.z;
    } else {
        const box = new THREE.Box3().setFromObject(pivot);
        const c = box.getCenter(new THREE.Vector3());
        ox -= c.x; oz -= c.z;
        oy += -(num("tyre") || 0.65) / 2 - box.min.y;
    }
    $("offsetX").value = ox.toFixed(4);
    $("offsetY").value = oy.toFixed(4);
    $("offsetZ").value = oz.toFixed(4);
    applyTransform();
}

function sizeFromModel() {
    if (!state.root) return;
    pivot.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(pivot);
    const size = box.getSize(new THREE.Vector3());
    $("length").value = size.z.toFixed(2);
    $("width").value = size.x.toFixed(2);
    $("height").value = size.y.toFixed(2);
}

function chassisFromWheels() {
    const c = wheelCenters();
    if (!c) { status("Select the parts of the four wheels first.", "error"); return; }
    $("wheelbase").value = (((c.FR.c.z + c.FL.c.z) / 2) - ((c.RR.c.z + c.RL.c.z) / 2)).toFixed(3);
    $("frontTrack").value = Math.max(isBike() ? 0.04 : 0, Math.abs(c.FL.c.x - c.FR.c.x)).toFixed(3);
    $("rearTrack").value = Math.max(isBike() ? 0.04 : 0, Math.abs(c.RL.c.x - c.RR.c.x)).toFixed(3);
    $("tyre").value = meanTyre(c).toFixed(3);
    updateHelpers();
}

// ---- materials

let paintTimer = 0;
function applyOverrides(name) {
    state.materials.filter((m) => m.name === name).forEach((m) => OpenRacer.applyMaterialOverride(m, state.overrides[name]));
    clearTimeout(paintTimer); paintTimer = setTimeout(() => applyPaint(), 0);      // (the paint of the tuning card is laid on the material again)
}

function renderMaterials() {
    const box = $("materials");
    box.innerHTML = "";
    const names = [...new Set(state.materials.map((m) => m.name).filter(Boolean))];
    if (!names.length) {
        box.innerHTML = '<div class="hint">' + (state.root ? "The model has no named materials." : "Load a model to see its materials.") + "</div>";
        return;
    }
    names.forEach((name) => {
        const first = state.materials.find((m) => m.name === name);
        const unnamedCount = state.materials.filter((m) => m.name === name).length;
        const element = document.createElement("div");
        element.className = "material";
        const head = document.createElement("div");
        head.className = "head";
        const title = document.createElement("b");
        title.textContent = name + (unnamedCount > 1 ? " (" + unnamedCount + "x)" : "");
        title.title = name;
        head.appendChild(title);
        const presets = document.createElement("select");
        presets.innerHTML = "<option value=''>Preset…</option>" + Object.keys(OpenRacer.materialPresets).map((p) => "<option>" + p + "</option>").join("");
        head.appendChild(presets);
        const reset = document.createElement("button");
        reset.className = "small";
        reset.textContent = "Reset";
        reset.title = "Back to the material of the model";
        head.appendChild(reset);
        element.appendChild(head);

        const fields = document.createElement("div");
        fields.className = "fields";
        const inputs = {};
        const spec = [["color", "Colour"], ["metalness", "Metalness", 0, 1, 0.05], ["roughness", "Roughness", 0, 1, 0.05],
            ["opacity", "Opacity", 0, 1, 0.05], ["clearcoat", "Clear coat", 0, 1, 0.05], ["clearcoatRoughness", "Coat roughness", 0, 1, 0.05],
            ["envMapIntensity", "Reflection", 0, 5, 0.1]];
        spec.forEach(([field, label, min, max, step]) => {
            const wrap = document.createElement("div");
            const l = document.createElement("label");
            l.textContent = label;
            const input = document.createElement("input");
            if (field === "color") input.type = "color";
            else { input.type = "number"; input.min = min; input.max = max; input.step = step; }
            input.addEventListener("input", () => {
                const value = field === "color" ? input.value : parseFloat(input.value);
                if (field !== "color" && Number.isNaN(value)) return;
                (state.overrides[name] = state.overrides[name] || {})[field] = value;
                applyOverrides(name);
                refresh();
            });
            inputs[field] = input;
            wrap.appendChild(l);
            wrap.appendChild(input);
            fields.appendChild(wrap);
        });
        element.appendChild(fields);

        const refresh = () => {
            const values = Object.assign({}, first.userData.original, state.overrides[name] || {});
            for (const field of Object.keys(inputs)) {
                const shown = field === "color" ? values.color : Math.round(values[field] * 1000) / 1000;
                if (document.activeElement !== inputs[field]) inputs[field].value = shown;
            }
            element.classList.toggle("changed", !!(state.overrides[name] && Object.keys(state.overrides[name]).length));
        };
        presets.addEventListener("change", () => {
            if (!presets.value) return;
            state.overrides[name] = Object.assign({}, state.overrides[name] || {}, OpenRacer.materialPresets[presets.value]);
            presets.value = "";
            applyOverrides(name);
            refresh();
        });
        reset.addEventListener("click", () => { delete state.overrides[name]; applyOverrides(name); refresh(); });
        applyOverrides(name);
        refresh();
        box.appendChild(element);
    });
}

// ---- cameras

const CAM_FIELDS = {
    camFolDist: (c) => c.follow.distance, camFolHeight: (c) => c.follow.height, camFolLook: (c) => c.follow.look_height, camFolLookZ: (c) => c.follow.look_z || 0,
    camFolSmooth: (c) => c.follow.smoothing, camFolFovStand: (c) => c.follow.fov_standing, camFolFovFast: (c) => c.follow.fov_fast,
    camFolSpeed: (c) => Math.round(c.follow.fov_full_speed * 3.6), camFolDolly: (c) => c.follow.dolly,
    camCockX: (c) => c.cockpit.position[0], camCockY: (c) => c.cockpit.position[1], camCockZ: (c) => c.cockpit.position[2], camCockFov: (c) => c.cockpit.fov
};

function currentSizes() {
    return { dimensions: { length: num("length") || 4.5, width: num("width") || 1.8, height: num("height") || 1.35 }, chassis: { tire_diameter: num("tyre") || 0.65 } };
}

function fillCameras(cameras) {
    for (const [id, get] of Object.entries(CAM_FIELDS)) $(id).value = get(cameras);
    updateCameraMarkers();
}

function defaultCameras() {
    fillCameras(OpenRacer.cameraSettings(currentSizes()));
}

function readCameras() {
    const n = (id) => num(id);
    return {
        follow: { distance: n("camFolDist"), height: n("camFolHeight"), look_height: n("camFolLook"), look_z: n("camFolLookZ") || 0, smoothing: n("camFolSmooth"),
            fov_standing: n("camFolFovStand"), fov_fast: n("camFolFovFast"), fov_full_speed: n("camFolSpeed") / 3.6, dolly: n("camFolDolly") },
        cockpit: { position: [n("camCockX"), n("camCockY"), n("camCockZ")], fov: n("camCockFov") }
    };
}

function updateCameraMarkers() {
    cameraMarkers.clear();
    const c = readCameras();
    const r = (num("tyre") || 0.65) / 2;
    const dot = (color, x, y, z, layer) => {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(layer === layers.selected ? 0.13 : 0.09, 16, 12), new THREE.MeshBasicMaterial({ color }));
        mesh.position.set(x, y, z);
        mesh.userData.layer = layer;
        cameraMarkers.add(mesh);
        if (layer && gizmoTargets[layer] && !layers.dragging) gizmoTargets[layer].position.set(x, y, z);
        return mesh.position;
    };
    const line = (color, a, b) => {
        cameraMarkers.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color })));
    };
    // the road is r below the origin of the model; the cameras behind the car look at the middle of it
    if (Number.isFinite(c.follow.distance) && Number.isFinite(c.follow.height)) {
        line(0x37d67a, dot(0x37d67a, 0, c.follow.height - r, -c.follow.distance, "follow"), dot(0x9be8b8, 0, (c.follow.look_height || 0) - r, c.follow.look_z || 0, "look"));
        // where the camera is at full speed: closer, in the measure that the field of view is wider
        const k = 1 + c.follow.dolly * (Math.tan(c.follow.fov_standing * Math.PI / 360) / Math.tan(c.follow.fov_fast * Math.PI / 360) - 1);
        if (Number.isFinite(k)) {
            const look = c.follow.look_height || 0;
            dot(0x9be8b8, 0, look + (c.follow.height - look) * k - r, -c.follow.distance * k);
        }
    }
    const p = c.cockpit.position;
    if (p.every(Number.isFinite)) {
        line(0xff9f43, dot(0xff9f43, p[0], p[1], p[2], "cockpit"), new THREE.Vector3(p[0], p[1], p[2] + 2));
    }
    renderLayers();
    updateThumbnail(); // the thumbnail follows the camera, also while it is dragged
}

// ---- the layers panel: the cameras, the model and the wheels, with a gizmo to move the cameras and the model, and a thumbnail
// of what the selected camera sees

// the fields follow the gizmo
function gizmoMoved() {
    const id = layers.selected;
    if (id && id.startsWith("ex")) { renderLayers(); return; }
    if (suspensionEditor && suspensionEditor.isMount(id)) { suspensionEditor.moved(id); return; }
    const r = (num("tyre") || 0.65) / 2;
    const fix = (v) => Math.round(v * 100) / 100;
    if (id === "follow") {
        const p = gizmoTargets[id].position;
        p.x = 0;
        if (p.z > -0.5) p.z = -0.5;
        $("camFolDist").value = fix(-p.z);
        $("camFolHeight").value = fix(p.y + r);
    } else if (id === "look") {
        const p = gizmoTargets.look.position;
        p.x = 0;
        $("camFolLookZ").value = fix(p.z);
        $("camFolLook").value = fix(p.y + r);
    } else if (id === "cockpit") {
        const p = gizmoTargets.cockpit.position;
        $("camCockX").value = fix(p.x); $("camCockY").value = fix(p.y); $("camCockZ").value = fix(p.z);
    } else if (id === "model") {
        const p = pivot.position;
        $("offsetX").value = fix(p.x); $("offsetY").value = fix(p.y); $("offsetZ").value = fix(p.z);
        applyTransform();
        return;
    }
    updateCameraMarkers();
}

function selectLayer(id) {
    if (driverEditor) driverEditor.deselect();
    layers.selected = layers.selected === id ? null : id;
    const sel = layers.selected;
    gizmo.detach();
    rotGizmo.detach();
    if (sel && gizmoTargets[sel]) {
        if (sel === "model" && !state.root) { layers.selected = null; }
        else {
            if (sel.startsWith("ex")) attachExhaustGizmo();
            else if (suspensionEditor && suspensionEditor.isMount(sel)) suspensionEditor.attachGizmo(sel);
            else {
                gizmo.attach(gizmoTargets[sel]);
                gizmo.showX = sel !== "follow" && sel !== "look"; // the cameras behind the car are in the middle
                gizmo.showY = gizmo.showZ = true;
            }
        }
    }
    exhaust.forEach((e) => e.pipe.material.color.set(e.id === layers.selected ? 0xffd04d : 0xff7a3d));
    updateExhaustWindow();
    // a wheel or the steering wheel is only marked in the list: the view stays where it is
    updateCameraMarkers();
    updateThumbnail();
}

// The part that is chosen in the view (a click on a loose part, the Soft body card): its row in the Parts list is lit and the list scrolls to it
let chosenPart = null;
const expandedParts = new Set();       // the parents of the Parts list that are open
let partsFor = null;
function showChosenPart(name) {
    chosenPart = name || null;
    // the parents of the part open, so that its row is there
    if (chosenPart) {
        const at = state.nodes.findIndex((n) => n.name === chosenPart);
        if (at > 0) {
            let depth = state.nodes[at].depth, opened = false;
            for (let i = at - 1; i >= 0 && depth > 0; i--) {
                if (state.nodes[i].depth < depth) { depth = state.nodes[i].depth; if (!expandedParts.has(state.nodes[i].name)) { expandedParts.add(state.nodes[i].name); opened = true; } }
            }
            if (opened) renderLayers();
        }
    }
    let found = null;
    document.querySelectorAll("#layerList .layer.part").forEach((row) => {
        const on = !!chosenPart && row.dataset.part === chosenPart;
        row.classList.toggle("selected", on);
        if (on && !found) found = row;
    });
    if (found) found.scrollIntoView({ block: "center", behavior: "smooth" });
}

function renderLayers() {
    if (suspensionEditor) suspensionEditor.refresh(false);          // (the mounts and the parts follow the wheels: nothing is rebuilt when nothing changed)
    const list = $("layerList");
    list.innerHTML = "";
    const centres = wheelCenters();
    LAYERS.forEach((l) => {
        if (l.group) {
            const g = document.createElement("div");
            g.className = "group";
            g.textContent = l.group;
            list.appendChild(g);
            return;
        }
        const row = document.createElement("div");
        row.className = "layer" + (l.id === layers.selected ? " selected" : "");
        const dot = document.createElement("i");
        dot.style.background = l.color;
        const text = document.createElement("span");
        text.textContent = l.label;
        row.append(dot, text);
        const meta = document.createElement("span");
        meta.className = "meta";
        if (l.id === "follow") meta.textContent = num("camFolDist") + " m, " + num("camFolFovStand") + "°";
        if (l.id === "cockpit") meta.textContent = num("camCockFov") + "°";
        if (l.id === "model") { meta.textContent = state.root ? "" : "none"; if (!state.root) row.classList.add("dim"); }
        if (l.id.charAt(0) === "w") { const has = centres && centres[l.id.substring(1)]; if (!has) row.classList.add("dim"); meta.textContent = has ? "" : "not set"; }
        if (l.id === "steering") { const has = state.nodes.some((n) => /steeringwheel|steerwheel/i.test(n.name.replace(/[^a-z0-9]/gi, ""))); if (!has) row.classList.add("dim"); meta.textContent = has ? "" : "none"; }
        if (l.id === "rig") {
            // the moving parts of the suspension and the steering (SuspensionRig.js in the game): susp_<kind>_<corner>, steer_rack, steer_tierod_<corner>
            const count = state.nodes.filter((n) => /^(susp(upperarm|lowerarm|arm|wishbone|link|trailingarm|trailing|upright|hub|knuckle|spring|damper|strut|shock|coilover|driveshaft|halfshaft|shaft)[a-z]*(fl|fr|rl|rr)|steertierod[a-z]*(fl|fr|rl|rr)|steerrack|susprack|susp(axle|panhard|watt)[a-z]*(rear|front|back)?|[a-z]*trailing[a-z]*(fl|fr|rl|rr)|(coilover|damper|shock|strut|spring)cylinder[a-z]*(fl|fr|rl|rr)|(rear|front|back)?solid[a-z]*|[a-z]*(solid|live)axle[a-z]*|axle[a-z]*)$/i.test(n.name.replace(/[^a-z0-9]/gi, ""))).length;
            if (!count) row.classList.add("dim");
            meta.textContent = count ? count + " parts" : "none";
            row.title = "Parts named susp_lowerarm_FL, susp_upperarm_FL, susp_upright_FL, susp_spring_FL, susp_damper_FL, steer_rack, steer_tierod_FL or susp_axle_rear move with the suspension and the steering in the game";
        }
        row.appendChild(meta);
        row.addEventListener("click", () => selectLayer(l.id));
        list.appendChild(row);
    });
    // the exhaust points, with a button to remove one and a row to add one
    const exGroup = document.createElement("div");
    exGroup.className = "group";
    exGroup.style.cssText = "display: flex; align-items: center; justify-content: space-between;";
    const exTitle = document.createElement("span");
    exTitle.textContent = "Exhaust";
    const test = document.createElement("button");
    test.className = "small" + (flameTest ? " accent" : "");
    test.textContent = flameTest ? "Test: on" : "Test: off";
    test.title = "Show the flames of the pops and bangs at the exhaust points";
    test.addEventListener("click", () => setFlameTest(!flameTest));
    exGroup.append(exTitle, test);
    list.appendChild(exGroup);
    exhaust.forEach((e, i) => {
        const row = document.createElement("div");
        row.className = "layer" + (e.id === layers.selected ? " selected" : "");
        const dot = document.createElement("i");
        dot.style.background = "#ff7a3d";
        const text = document.createElement("span");
        text.textContent = "Exhaust " + (i + 1);
        const meta = document.createElement("span");
        meta.className = "meta";
        const p = e.target.position;
        meta.textContent = p.x.toFixed(2) + ", " + p.y.toFixed(2) + ", " + p.z.toFixed(2);
        const del = document.createElement("button");
        del.className = "del";
        del.textContent = "×";
        del.title = "Remove this exhaust point";
        del.addEventListener("click", (event) => { event.stopPropagation(); removeExhaust(e.id); });
        row.append(dot, text, meta, del);
        row.addEventListener("click", () => selectLayer(e.id));
        list.appendChild(row);
    });
    const addRow = document.createElement("div");
    addRow.className = "layer";
    addRow.innerHTML = "<i style=\"background: transparent; border: 1px solid #ff7a3d\"></i><span>+ Add an exhaust point</span>";
    addRow.title = "A point where the flames of the pops and bangs come out; move it and turn it with the gizmos";
    addRow.addEventListener("click", () => { const e = newExhaust(); layers.selected = null; selectLayer(e.id); });
    list.appendChild(addRow);
    // every named object of the model, with an eye to show or hide it (a hidden object hides what is inside it too)
    if (state.nodes.length) {
        const g = document.createElement("div");
        g.className = "group";
        g.textContent = "Parts";
        list.appendChild(g);
        // only the parents are shown, the objects inside them fold out with the arrow (all folded when a model is loaded)
        if (partsFor !== state.nodes) { partsFor = state.nodes; expandedParts.clear(); }
        let hiddenFrom = Infinity;                       // the depth of the folded parent that hides the rows below it
        const find = $("layerSearch").value.trim().toLowerCase();                // (a search shows every part with that in its name, folded or not)
        state.nodes.forEach((node, index) => {
            if (find) { if (!node.name.toLowerCase().includes(find)) return; }
            else {
            if (node.depth > hiddenFrom) return;
            hiddenFrom = Infinity;
            }
            const hasChildren = !find && index + 1 < state.nodes.length && state.nodes[index + 1].depth > node.depth;
            const open = expandedParts.has(node.name);
            if (hasChildren && !open) hiddenFrom = node.depth;
            const row = document.createElement("div");
            row.className = "layer part" + (node.name === chosenPart ? " selected" : "");
            row.dataset.part = node.name;
            row.style.paddingLeft = (6 + Math.min(find ? 0 : node.depth, 6) * 10) + "px";
            const arrow = document.createElement("button");
            arrow.className = "eye";
            arrow.style.cssText = "margin-left: 0; width: 18px; flex: none; opacity: " + (hasChildren ? 1 : 0) + ";";
            arrow.textContent = open ? "▾" : "▸";
            arrow.title = hasChildren ? (open ? "Fold" : "Show what is inside") : "";
            arrow.addEventListener("click", (e) => { e.stopPropagation(); if (!hasChildren) return; if (expandedParts.has(node.name)) expandedParts.delete(node.name); else expandedParts.add(node.name); renderLayers(); });
            const text = document.createElement("span");
            text.textContent = node.name;
            text.title = node.name;
            const eye = document.createElement("button");
            eye.className = "eye";
            const paint = () => { const on = node.object.visible; eye.textContent = on ? "👁" : "—"; eye.title = on ? "Hide" : "Show"; row.classList.toggle("dim", !on); };
            eye.addEventListener("click", (e) => { e.stopPropagation(); node.object.visible = !node.object.visible; syncBenchVisibility(); paint(); });
            paint();
            row.append(arrow, text, eye);
            list.appendChild(row);
        });
    }
}

// a click on a marker in the view selects its layer
const pickRay = new THREE.Raycaster();
let pickDown = null;
renderer.domElement.addEventListener("pointerdown", (e) => { pickDown = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener("pointerup", (e) => {
    if (!pickDown || layers.dragging || Math.abs(e.clientX - pickDown[0]) + Math.abs(e.clientY - pickDown[1]) > 4) { pickDown = null; return; }
    pickDown = null;
    const rect = renderer.domElement.getBoundingClientRect();
    pickRay.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
    // Edit origins (the Suspension and driveline card): only the balls of the mounts are picked, through everything
    if (suspensionEditor && suspensionEditor.editing) {
        const mount = pickRay.intersectObjects(suspensionEditor.pickables(), false).find((h) => h.object.userData.layer);
        if (mount && mount.object.userData.layer !== layers.selected) selectLayer(mount.object.userData.layer);
        return;
    }
    const hit = pickRay.intersectObjects(cameraMarkers.children.concat(exhaust.map((e) => e.pipe)), false).find((h) => h.object.userData.layer);
    if (hit && hit.object.userData.layer !== layers.selected) selectLayer(hit.object.userData.layer);
});

// the thumbnail: a small renderer in the panel that looks through the selected camera, the way the game does
const thumbRenderer = new THREE.WebGLRenderer({ antialias: true });
thumbRenderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
thumbRenderer.setSize(246, 138, false);
thumbRenderer.domElement.style.display = "none";
$("thumb").insertBefore(thumbRenderer.domElement, $("thumbLabel"));
const thumbCamera = new THREE.PerspectiveCamera(45, 246 / 138, 0.05, 300);

function updateThumbnail() {
    const id = layers.selected === "look" ? "follow" : layers.selected;      // (the target of the follow camera shows what that camera sees)
    const isCamera = id === "follow" || id === "cockpit";
    thumbRenderer.domElement.style.display = isCamera ? "block" : "none";
    if (!isCamera) { $("thumbLabel").textContent = "Select a camera to see what it sees."; return; }
    const c = readCameras();
    const r = (num("tyre") || 0.65) / 2;
    if (id === "follow") {
        thumbCamera.position.set(0, c.follow.height - r, -c.follow.distance);
        thumbCamera.lookAt(0, (c.follow.look_height || 0) - r, c.follow.look_z || 0);
        thumbCamera.fov = c.follow.fov_standing;
        $("thumbLabel").textContent = "1 Follow camera at a standstill, FOV " + c.follow.fov_standing + "° (" + c.follow.fov_fast + "° at full speed)";
    } else {
        const p = c.cockpit.position;
        thumbCamera.position.set(p[0], p[1], p[2]);
        thumbCamera.rotation.set(0, Math.PI, 0);
        thumbCamera.fov = c.cockpit.fov;
        $("thumbLabel").textContent = "2 Cockpit camera, FOV " + c.cockpit.fov + "°";
    }
    thumbCamera.updateProjectionMatrix();
}

function renderThumbnail() {
    const id = layers.selected === "look" ? "follow" : layers.selected;
    if (id !== "follow" && id !== "cockpit") return;
    // without the markers and the gizmo, the way the game shows it
    cameraMarkers.visible = false;
    const helper = typeof gizmo.getHelper === "function" ? gizmo.getHelper() : gizmo;
    const wasVisible = helper.visible;
    helper.visible = false;
    // (the cockpit camera: the torso and the head of the driver are not drawn, as in the game)
    const drv = driverEditor && driverEditor.driver ? driverEditor.driver() : null;
    if (drv && id === "cockpit") { drv.setCockpit(true); drv.update(0); }
    thumbRenderer.render(scene, thumbCamera);
    if (drv && id === "cockpit") { drv.setCockpit(false); drv.update(0); }
    helper.visible = wasVisible;
    cameraMarkers.visible = true;
}

// the panel: hide, show, and resize by dragging its edge
// the bars and the test buttons can be folded away, to see more of the car
// the tabs on the edges of the view fold the bars away and back; their caret points the way the bar will go
function paintTabs() { $("toggleSide").textContent = $("side").classList.contains("collapsed") ? "›" : "‹"; $("toggleLayers").textContent = $("layers").classList.contains("hidden") ? "‹" : "›"; }
$("toggleSide").addEventListener("click", () => { $("side").classList.toggle("collapsed"); paintTabs(); });
// the test bar is off until it is asked for (the choice is remembered)
function showTests(on) { $("testBar").style.display = on ? "" : "none"; try { localStorage.setItem("editor-tests", on ? "1" : "0"); } catch (e) { /* no storage */ } }
{ let on = false; try { on = localStorage.getItem("editor-tests") === "1"; } catch (e) { /* no storage */ } $("testBar").style.display = on ? "" : "none"; }
$("toggleTests").addEventListener("click", () => showTests($("testBar").style.display === "none"));
$("toggleLayers").addEventListener("click", () => { $($("layers").classList.contains("hidden") ? "layersShow" : "layersHide").click(); });
$("layersHide").addEventListener("click", () => { $("layers").classList.add("hidden"); $("layersOpen").style.display = ""; paintTabs(); });
$("layersShow").addEventListener("click", () => { $("layers").classList.remove("hidden"); $("layersOpen").style.display = "none"; paintTabs(); });
(function () {
    const handle = $("layersHandle"), panel = $("layers");
    let startX = 0, startWidth = 0;
    const move = (e) => { panel.style.width = Math.max(190, Math.min(520, startWidth + (startX - e.clientX))) + "px"; };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    handle.addEventListener("pointerdown", (e) => { startX = e.clientX; startWidth = panel.offsetWidth; window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); e.preventDefault(); });
})();
document.querySelectorAll(".cam").forEach((el) => el.addEventListener("input", updateThumbnail));
window.addEventListener("keydown", (e) => { if (e.key === "Escape" && layers.selected && !document.querySelector("dialog[open]")) selectLayer(layers.selected); });

// ---- the engine sound (the combustion model of EngineSim.js), with a preview

const preview = { ctx: null, synth: null, loaded: false, playing: false, sweep: null };

function stopPreview() {
    if (preview.playing) {
        preview.playing = false;
        if (preview.synth) preview.synth.setSilent(true);
        $("soundPlay").textContent = "Play";
    }
}

function fillEngineSim(p) {
    for (const el of document.querySelectorAll(".es")) {
        const key = el.dataset.key;
        if (key === "timing") el.value = p.timing.map((t) => t[0] + ":" + t[1]).join(", ");
        else el.value = p[key];
    }
}

function readEngineSim() {
    const p = {};
    for (const el of document.querySelectorAll(".es")) {
        const key = el.dataset.key;
        if (key === "timing") {
            p.timing = el.value.split(",").map((t) => t.split(":").map(parseFloat)).filter((t) => t.length === 2 && t.every(Number.isFinite)).sort((a, b) => a[0] - b[0]);
        } else if (el.tagName === "SELECT") {
            p[key] = key === "exhaust_systems" ? parseInt(el.value, 10) : el.value;
        } else {
            p[key] = parseFloat(el.value);
        }
    }
    return p;
}

function engineSimValid(p) {
    return Object.entries(p).every(([key, v]) => key === "timing" ? v.length > 0 : (typeof v === "string" ? v.length > 0 : Number.isFinite(v)));
}

// what the form gives, as the synth gets it (an exhaust type decides the impulse response and the amount of it)
function playParams() { return OpenRacer.engineSimParams({ sound: { engine_sim: readEngineSim() } }); }
async function engineSimChanged() {
    const raw = readEngineSim();
    if (!preview.synth || !engineSimValid(raw)) return;
    const p = playParams();
    preview.synth.setParams(p);
    if (preview.synth.impulseResponseName !== p.impulse_response) {
        try {
            const ir = await OpenRacer.EngineSimSynth.loadImpulseResponse(preview.ctx, "../sounds/ir/", p.impulse_response);
            preview.synth.setImpulseResponse(ir.buffer, ir.name);
        } catch (error) {
            status("Could not load the impulse response: " + error.message, "error");
        }
    }
}

async function playSound() {
    if (preview.playing) { stopPreview(); return; }
    if (!window.AudioWorkletNode) { status("This browser cannot play the engine sound (AudioWorklet).", "error"); return; }
    if (!preview.ctx) preview.ctx = new AudioContext();
    if (preview.ctx.state === "suspended") await preview.ctx.resume();
    if (!engineSimValid(readEngineSim())) { status("Every field of the engine sound needs a value.", "error"); return; }
    const p = playParams();
    if (!preview.synth) {
        try {
            if (!preview.loaded) { await OpenRacer.EngineSimSynth.load(preview.ctx, "../js/EngineSimWorklet.js"); preview.loaded = true; }
            let ir = null;
            try { ir = await OpenRacer.EngineSimSynth.loadImpulseResponse(preview.ctx, "../sounds/ir/", p.impulse_response); }
            catch (error) { status("Could not load the impulse response: " + error.message, "error"); }
            preview.synth = new OpenRacer.EngineSimSynth(preview.ctx, p, ir && ir.buffer);
            if (ir) preview.synth.impulseResponseName = ir.name;
            preview.synth.connect(preview.ctx.destination);
        } catch (error) {
            status("Could not start the engine sound: " + error.message, "error");
            return;
        }
    }
    preview.playing = true;
    preview.synth.setSilent(false);
    preview.synth.setInside($("soundInside").checked);
    soundSliders();
    $("soundPlay").textContent = "Stop";
}

function soundSliders() {
    const rpm = parseFloat($("soundRpm").value);
    const throttle = parseFloat($("soundThrottle").value) / 100;
    $("soundRpmLabel").textContent = Math.round(rpm) + " rpm";
    $("soundThrottleLabel").textContent = Math.round(throttle * 100) + "%";
    if (preview.synth && preview.playing) {
        preview.synth.setRpm(rpm);
        preview.synth.setThrottle(throttle);
    }
}

function soundSweep() {
    if (!preview.playing) playSound().then(() => soundSweep());
    if (!preview.playing) return;
    const idle = num("idle") || 900, limit = num("limiter") || 6500, start = performance.now(), duration = 6000;
    cancelAnimationFrame(preview.sweep);
    const step = (now) => {
        const t = Math.min(1, (now - start) / duration);
        // up in the first half, down in the second; the throttle is open on the way up
        const up = t < 0.5 ? t * 2 : 2 - t * 2;
        $("soundRpm").value = idle + (limit - idle) * up;
        $("soundThrottle").value = t < 0.5 ? 100 : 0;
        soundSliders();
        if (t < 1) preview.sweep = requestAnimationFrame(step);
    };
    preview.sweep = requestAnimationFrame(step);
}

function initEngineSim() {
    $("esLayout").innerHTML = Object.entries(OpenRacer.engineSimLayouts).map(([id, l]) => "<option value='" + id + "'>" + l.label + "</option>").join("");
    $("esIr").innerHTML = OpenRacer.engineSimImpulseResponses.map((ir) => "<option value='" + ir.id + "'>" + ir.label + "</option>").join("");
    const presets = $("esPreset");
    presets.innerHTML = "<option value=''>Choose a preset…</option>" + Object.keys(OpenRacer.engineSimPresets).map((n) => "<option>" + n + "</option>").join("");
    presets.addEventListener("change", () => {
        if (!presets.value) return;
        fillEngineSim(Object.assign({}, OpenRacer.engineSimParams({ sound: { engine_sim: readEngineSim() } }), OpenRacer.engineSimPresets[presets.value]));
        presets.value = "";
        engineSimChanged();
    });
    document.querySelectorAll(".es").forEach((el) => el.addEventListener(el.tagName === "SELECT" ? "change" : "input", engineSimChanged));
    $("soundPlay").addEventListener("click", playSound);
    $("soundSweep").addEventListener("click", soundSweep);
    $("soundRpm").addEventListener("input", soundSliders);
    $("soundThrottle").addEventListener("input", soundSliders);
    $("soundInside").addEventListener("change", () => { if (preview.synth) preview.synth.setInside($("soundInside").checked); });
    fillEngineSim(OpenRacer.engineSimParams(null));
    soundSliders();
}

// ---- the engine

function power(rpm, nm) {
    return nm * rpm * Math.PI / 30 / 745.7; // hp
}

function renderCurve() {
    clearDyno();
    state.curve.sort((a, b) => a[0] - b[0]);
    drawChart();
}

function drawChart() {
    const canvas = $("chart");
    const g = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    g.clearRect(0, 0, w, h);
    const maxRpm = Math.max(num("limiter") || 7000, ...state.curve.map((p) => p[0])) * 1.05;
    // torque (Nm) and power (hp) share one scale on the left, with a step of 1, 2 or 5 times a power of ten (0, 10, 20, 30 ... or 0, 50, 100, 150 ...) that has at most 7 lines
    const top = Math.max(1, ...state.curve.map((p) => p[1]), ...state.curve.map((p) => power(p[0], p[1]))) * 1.08;
    let step = 1;
    for (const m of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]) { step = m; if (top / m <= 7) break; }
    const maxY = Math.ceil(top / step) * step;
    const left = 62, bottom = h - 24, plotW = w - left - 4, plotH = bottom - 8;
    const X = (rpm) => left + rpm / maxRpm * plotW, Y = (v) => bottom - v / maxY * plotH;
    g.font = "24px Arial";
    g.lineWidth = 1;
    // the horizontal lines, with the numbers at the left
    for (let v = 0; v <= maxY + 1e-9; v += step) {
        g.strokeStyle = "#2c3541"; g.beginPath(); g.moveTo(left, Y(v)); g.lineTo(w, Y(v)); g.stroke();
        g.fillStyle = "#8a97aa"; g.textAlign = "right"; g.textBaseline = "middle";
        g.fillText(String(v), left - 8, Math.min(bottom - 8, Math.max(10, Y(v))));
    }
    g.textAlign = "left"; g.textBaseline = "alphabetic";
    g.strokeStyle = "#2c3541"; g.fillStyle = "#6f7d92";
    for (let r = 0; r <= maxRpm; r += 1000) {
        const x = X(r);
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x, bottom); g.stroke();
        g.fillText(r / 1000 + "k", x + 3, h - 4);
    }
    const line = (color, value) => {
        g.strokeStyle = color; g.lineWidth = 3; g.beginPath();
        state.curve.forEach((p, i) => { const x = X(p[0]), y = Y(value(p)); if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); });
        g.stroke();
    };
    line("#ff9f43", (p) => p[1]);
    line("#54a0ff", (p) => power(p[0], p[1]));
    if (dyno) {
        // the pull at the wheels: dashed, as far as the run has come
        const shown = dyno.points.slice(0, dyno.upTo + 1);
        g.setLineDash([10, 7]); g.lineWidth = 3;
        for (const [color, value] of [["#ffd29a", (p) => p.nm], ["#a9cdff", (p) => p.hp]]) {
            g.strokeStyle = color; g.beginPath();
            shown.forEach((p, i) => { const x = X(p.rpm), y = Y(value(p)); if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); });
            g.stroke();
        }
        if (state.buildResult && state.buildResult.maxBoost > 0) {            // the boost of the pull (green; the scale is on the right)
            const maxB = Math.max(0.5, Math.ceil(state.buildResult.maxBoost * 5) / 5);
            g.strokeStyle = "#6fdc8c"; g.beginPath();
            shown.forEach((p, i) => { const x = X(p.rpm), y = bottom - p.boost / maxB * plotH * 0.6; if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); });
            g.stroke();
            g.setLineDash([]); g.fillStyle = "#6fdc8c"; g.textAlign = "right"; g.fillText(maxB.toFixed(1) + " bar", w - 4, bottom - plotH * 0.6 - 4); g.textAlign = "left";
        }
        g.setLineDash([]);
        const tip = shown[shown.length - 1];
        if (tip && dyno.upTo < dyno.points.length - 1) { g.strokeStyle = "#ffffff"; g.lineWidth = 2; g.beginPath(); g.moveTo(X(tip.rpm), 0); g.lineTo(X(tip.rpm), bottom); g.stroke(); }
    }
    const limitX = X(num("limiter") || 0);
    g.strokeStyle = "#ff5e5e"; g.lineWidth = 2; g.beginPath(); g.moveTo(limitX, 0); g.lineTo(limitX, bottom); g.stroke();
    const peak = state.curve.reduce((best, p) => (power(p[0], p[1]) > best.hp ? { hp: power(p[0], p[1]), rpm: p[0] } : best), { hp: 0, rpm: 0 });
    const torque = Math.max(0, ...state.curve.map((p) => p[1]));
    $("peakInfo").textContent = Math.round(peak.hp) + " hp at " + peak.rpm + " rpm, " + Math.round(torque) + " Nm" + (dynoBest && dyno && dyno.upTo >= dyno.points.length - 1 ? " · " + Math.round(dynoBest.hp) + " hp at the wheels" : "");
    chartGeo = { left, bottom, plotW, plotH, maxRpm, maxY, w, h };
    if (document.activeElement !== $("simpleHp")) $("simpleHp").value = Math.round(peak.hp) || "";
    if (document.activeElement !== $("simpleRpm")) $("simpleRpm").value = num("limiter") || "";
}


// ---- the engine build: the torque curve comes from the block, the cam, the inlet and the exhaust, the fuel and the turbo or supercharger (EngineBuild.js)
const EB = OpenRacer.EngineBuild;
function fillSelect(select, entries, labelOf) { select.innerHTML = Object.keys(entries).map((k) => "<option value='" + k + "'>" + labelOf(entries[k]) + "</option>").join(""); }
// the exhaust of the Engine card is the exhaust type of the engine sound (kept in the hidden field of the sound card)
function syncExhaustSelect() { const t = $("esExhaust").value; if ($("bExhaustSound").value !== t) $("bExhaustSound").value = t; }
// the exhaust that goes with a block, until it is chosen otherwise
function defaultExhaust(block) {
    if (/kart|Single 0.4|Twin/.test(block)) return "straight";
    if (/supersport|superbike|triple|thumper/.test(block)) return "performance";
    if (/flatplane|V10|V12|Flat-6/.test(block)) return "sport";
    return "standard";
}
function initBuildUi() {
    const exhaustOptions = "<option value='custom'>Custom (as it was set before)</option>" + Object.entries(OpenRacer.engineSimExhausts).map(([id, e]) => "<option value='" + id + "'>" + e.label + " · " + e.hint + "</option>").join("");
    $("bExhaustSound").innerHTML = exhaustOptions; $("esExhaust").innerHTML = exhaustOptions;
    $("bExhaustSound").addEventListener("change", () => { $("esExhaust").value = $("bExhaustSound").value; $("esExhaust").dispatchEvent(new Event("change", { bubbles: true })); });
    $("bBlock").innerHTML = "<option value=''>Choose an engine block…</option>" + Object.keys(OpenRacer.engineSimPresets).map((n) => "<option>" + n + "</option>").join("");
    fillSelect($("bFuel"), EB.FUELS, (f) => f.label);
    fillSelect($("bIntercooler"), EB.INTERCOOLERS, (i) => i.label);
    fillSelect($("bSize"), EB.TURBO_SIZES, (t) => t.label);
    fillBuildVariants();
}
function fillBuildVariants() {
    const turbo = $("bInduction").value === "turbo";
    fillSelect($("bVariant"), turbo ? EB.TURBO_VARIANTS : EB.SUPERCHARGERS, (v) => v.label);
}
const BUILD_FIELDS = { bBore: "bore", bStroke: "stroke", bCompression: "compression", bCam: "cam_duration", bIntakeFlow: "intake_flow", bExhaustFlow: "exhaust_flow", bPrimary: "primary_length", bExhaustLen: "exhaust_length" };
function showBuild(build) {
    for (const [id, key] of Object.entries(BUILD_FIELDS)) $(id).value = build[key];
    $("bValves").value = String(build.valves || 4); $("bFuel").value = build.fuel || "pump95"; $("bLambda").value = build.lambda || 0.9;
    const ind = build.induction || { type: "none" };
    $("bInduction").value = ind.type; fillBuildVariants();
    if (ind.variant) $("bVariant").value = ind.variant;
    $("bSize").value = ind.size || "medium"; $("bBoost").value = ind.boost || 0.6; $("bIntercooler").value = ind.intercooler || "air";
    $("bTemp").value = build.ambient ? build.ambient.celsius : 20; $("bAltitude").value = build.ambient ? build.ambient.altitude : 0;
}
function readBuild() {
    const b = { block: $("bBlock").value, layout: state.build ? state.build.layout : "inline-4", rod: state.build ? state.build.rod : 140 };
    for (const [id, key] of Object.entries(BUILD_FIELDS)) b[key] = parseFloat($(id).value) || 0;
    b.valves = parseInt($("bValves").value, 10); b.fuel = $("bFuel").value; b.lambda = parseFloat($("bLambda").value) || 0.9;
    const type = $("bInduction").value;
    b.induction = { type, variant: $("bVariant").value, size: $("bSize").value, boost: parseFloat($("bBoost").value) || 0, intercooler: $("bIntercooler").value };
    b.ambient = { celsius: parseFloat($("bTemp").value) || 0, altitude: parseFloat($("bAltitude").value) || 0 };
    return b;
}
// what is shown for the build that is (or is not) there
function applyBuildUi() {
    const has = !!state.build;
    updateBuildLimits();
    $("bBuild").hidden = !has;
    const type = $("bInduction").value;
    $("bVariantBox").style.display = type === "none" ? "none" : "";
    $("bBoostRow").style.display = type === "none" ? "none" : "";
    $("bSizeBox").style.display = type === "turbo" ? "" : "none";
    $("simpleHp").disabled = true;
    $("simpleRpm").disabled = !has; $("simpleRpm").title = has ? "The rev limit of the engine" : "Choose an engine block first";
    const placeholder = $("bBlock").options[0];
    placeholder.disabled = has;
    if (!has) $("bBlock").value = "";
    const res = state.buildResult;
    $("bInfo").textContent = has && res
        ? res.displacement.toFixed(1) + " L, " + res.cylinders + " cylinders · " + Math.round(res.peakPower) + " hp at " + res.peakPowerRpm + " rpm · piston speed at the limit " + res.pistonSpeedAtLimit.toFixed(0) + " m/s" +
          (res.pistonSpeedAtLimit > 25 ? " (too fast for the engine to last)" : "") + (res.knock > 0.03 ? " · knock: " + Math.round(res.knock * 100) + "% of the torque is lost, use better fuel or less boost" : "")
        : "This car still has an old torque curve that cannot be changed. Choose an engine block to build its engine: the curve then follows from it.";
}
function recomputeBuild() {
    if (!state.build) { state.buildResult = null; applyBuildUi(); return; }
    for (let i = 0; i < 3 && updateBuildLimits(); i++);        // (a value that the others do not allow any more is pulled in)
    state.build = readBuild();
    const res = EB.compute(state.build, num("limiter") || 7000, num("idle") || 850);
    state.buildResult = res;
    state.curve = res.curve.map((p) => p.slice());
    const tn = tuning;
    const spec = EB.turboSpec(state.build), ind = state.build.induction;
    tn.turbo_share = spec ? Math.round(res.boostShare * 100 / 5) * 5 : 0;
    tn.turbo_boost = 0;
    if (spec) {
        tn.turbo_spool = spec.spool; tn.turbo_threshold = spec.threshold; tn.turbo_intercooler = Math.round(EB.INTERCOOLERS[ind.intercooler].value * 100); tn.turbo_efficiency = 72; tn.boost_full = ind.boost;
    }
    renderTuningCard(); tuningChanged();
    renderCurve(); updateSpeedInfo(); applyBuildUi();
}
function buildEdited() { recomputeBuild(); $("bBuild").dispatchEvent(new Event("change", { bubbles: true })); }
// the engine sound follows the engine that is built (the same bore, stroke, compression, cam, flows and lengths)
function syncSoundFromBuild(build, wholePreset) {
    const p = Object.assign({}, readEngineSim());
    if (wholePreset && OpenRacer.engineSimPresets[build.block]) { Object.assign(p, OpenRacer.engineSimPresets[build.block]); p.exhaust_type = defaultExhaust(build.block); }
    Object.assign(p, { bore: build.bore, stroke: build.stroke, compression_ratio: build.compression, intake_duration: build.cam_duration, exhaust_duration: Math.max(180, build.cam_duration - 4),
        intake_flow: build.intake_flow, exhaust_flow: build.exhaust_flow, primary_length: build.primary_length, exhaust_length: build.exhaust_length });
    fillEngineSim(p);
    syncExhaustSelect();
    engineSimChanged();
}
$("bBlock").addEventListener("change", () => {
    const name = $("bBlock").value;
    if (!name) return;
    const build = EB.fromPreset(name, OpenRacer.engineSimPresets[name]);
    state.build = build; showBuild(build);
    const lim = EB.compute(build, 9000, num("idle") || 850).suggestedLimiter;
    $("limiter").value = lim; $("limiter").dispatchEvent(new Event("input", { bubbles: true }));
    syncSoundFromBuild(build, true);
    recomputeBuild();
});
document.querySelectorAll(".b").forEach((el) => el.addEventListener(el.tagName === "SELECT" ? "change" : "input", () => {
    if (!state.build) return;
    if (el.id === "bInduction") fillBuildVariants();
    if (el.type === "number" && el.min !== "" && el.max !== "") { const v = parseFloat(el.value); if (Number.isFinite(v) && (v < +el.min || v > +el.max)) el.value = Math.min(+el.max, Math.max(+el.min, v)); }     // (a number typed beyond what is possible)
    syncSoundFromBuild(readBuild(), false);
    recomputeBuild();
}));

// ---- sliders for the build, with limits that follow from the other settings (EngineBuild.limits): a bore that the stroke does not allow, a compression that the fuel cannot take
const LIMIT_FIELDS = { bBore: "bore", bStroke: "stroke", bCompression: "compression", bCam: "cam", bIntakeFlow: "intake", bExhaustFlow: "exhaust", bPrimary: "primary", bExhaustLen: "exhaustLen",
    bLambda: "lambda", bBoost: "boost", bTemp: "temp", bAltitude: "altitude", idle: "idle", limiter: "limiter", inertia: "inertia" };
function initBuildSliders() {
    for (const id of Object.keys(LIMIT_FIELDS)) {
        const n = $(id), r = document.createElement("input");
        r.type = "range"; r.id = id + "Slider"; r.className = "bslider"; r.step = n.step || "any"; r.setAttribute("aria-label", n.getAttribute("aria-label") || id);
        n.parentNode.insertBefore(r, n.nextSibling);
        r.addEventListener("input", () => { n.value = r.value; n.dispatchEvent(new Event("input", { bubbles: true })); });
        n.addEventListener("input", () => { r.value = n.value; });
    }
}
const OWN_LIMITS = { idle: [300, 4000], limiter: [1500, 20000], inertia: [0.01, 3] };
function updateBuildLimits() {
    const own = !state.build;
    let lim = null, changed = false;
    if (!own) { try { lim = EB.limits(readBuild(), num("limiter") || 7000, num("idle") || 850); } catch (e) { lim = null; } }
    if (!own && !lim) return false;
    for (const [id, key] of Object.entries(LIMIT_FIELDS)) {
        const n = $(id), r = $(id + "Slider");
        if (own && !OWN_LIMITS[key]) continue;
        const [lo, hi, why] = own ? OWN_LIMITS[key] : lim[key];
        const low = Math.min(lo, hi), high = Math.max(lo, hi);
        n.min = r.min = low; n.max = r.max = high; n.title = r.title = why || "";
        const v = parseFloat(n.value);
        if (Number.isFinite(v) && (v < low || v > high)) { n.value = Math.min(high, Math.max(low, v)); changed = true; }
        r.value = n.value;
    }
    if (lim) {
        [...$("bValves").options].forEach((o) => { o.disabled = !lim.valves.includes(parseInt(o.value, 10)); });
        if ($("bValves").selectedOptions[0] && $("bValves").selectedOptions[0].disabled) { $("bValves").value = String(lim.valves[lim.valves.length - 1]); changed = true; }
        [...$("bSize").options].forEach((o) => { o.disabled = !lim.turboSizes.includes(o.value); });
        if ($("bSize").selectedOptions[0] && $("bSize").selectedOptions[0].disabled) { $("bSize").value = lim.turboSizes[lim.turboSizes.length - 1]; changed = true; }
        if ($("bInduction").value === "turbo") {
            [...$("bVariant").options].forEach((o) => { o.disabled = !lim.turboVariants.includes(o.value); });
            if ($("bVariant").selectedOptions[0] && $("bVariant").selectedOptions[0].disabled) { $("bVariant").value = "single"; changed = true; }
        }
    }
    return changed;
}
initBuildSliders();
initBuildUi();

// ---- the dyno: a full-throttle pull, measured at the wheels; only the chart shows it
let dyno = null, dynoFrame = 0, dynoBest = null;       // dynoBest: the best point of the last pull that was run to the end
let dynoSound = false, dynoRamp = 0;       // the engine sound was started by the dyno run (and stops with it)
// the run is over: the throttle closes and the engine runs down to idle slowly (the weight of the rollers keeps it turning), then the sound stops
function dynoSoundOff() {
    if (!dynoSound || !preview.playing) { dynoSound = false; return; }
    cancelAnimationFrame(dynoRamp);
    const from = parseFloat($("soundRpm").value), idle = num("idle") || 850, start = performance.now();
    const duration = Math.max(3000, Math.min(9000, 3000 + (from - idle) * 0.9));      // (the engine and the rollers run down slowly: about 8 s from 6000 rpm)
    $("soundThrottle").value = 0;
    const step = (now) => {
        const f = Math.max(0, Math.min(1, (now - start) / duration)), e = 1 - Math.pow(1 - f, 1.5);
        $("soundRpm").value = from + (idle - from) * e;
        soundSliders();
        if (f < 1 && dynoSound && preview.playing) { dynoRamp = requestAnimationFrame(step); return; }
        if (dynoSound) setTimeout(() => { if (dynoSound && preview.playing) stopPreview(); dynoSound = false; }, 500);
    };
    dynoRamp = requestAnimationFrame(step);
}
function clearDyno() { if (!dyno) return; cancelAnimationFrame(dynoFrame); dynoSoundOff(); dyno = null; dynoBest = null; $("runDyno").disabled = false; $("dynoInfo").textContent = ""; }
function dynoPull() {
    const gears = parseGears(), final = num("finalDrive"), limit = num("limiter"), r = (num("tyre") || 0.65) / 2, mass = num("mass") || 1000;
    if (!gears.length || !(final > 0) || !(limit > 0) || state.curve.length < 2) return null;
    const ratio = gears.reduce((best, g) => (Math.abs(g - 1) < Math.abs(best - 1) ? g : best), gears[0]);
    const G = ratio * final, eff = num("efficiency") || 0.92, curve = state.curve.slice().sort((a, b) => a[0] - b[0]);
    // with a build the dyno room counts: the curve is for the standard air, the dyno has its own (an uncorrected result)
    const room = state.build && state.build.ambient ? 1 / EB.correction(state.build.ambient.altitude, state.build.ambient.celsius) : 1;
    const boostAt = (rpm) => { const b = state.buildResult && state.buildResult.boost; if (!b) return 0; for (let i = 1; i < b.length; i++) if (rpm <= b[i][0]) return b[i - 1][1] + (b[i][1] - b[i - 1][1]) * (rpm - b[i - 1][0]) / (b[i][0] - b[i - 1][0]); return 0; };
    const torqueAt = (rpm) => {
        if (rpm > curve[curve.length - 1][0]) return 0;
        for (let i = 1; i < curve.length; i++) if (rpm <= curve[i][0]) { const a = curve[i - 1], b = curve[i], f = b[0] > a[0] ? (rpm - a[0]) / (b[0] - a[0]) : 0; return (a[1] + (b[1] - a[1]) * f) * room; }
        return 0;
    };
    // a chassis dyno holds the car still on its rollers: no air drag and no loss of grip, only the drivetrain (the efficiency) and the rolling of the tyres count
    const rolling = 0.012 * mass * 9.81;
    const meff = mass + (num("inertia") || 0.3) * G * G / (r * r);
    let rpm = Math.max(num("idle") * 1.4 || 1200, limit * 0.25), v = rpm * Math.PI / 30 * r / G, lastRpm = -1e9;
    const points = [];
    for (let t = 0; t < 120 && rpm < limit; t += 0.01) {
        const net = torqueAt(rpm) * G * eff / r - rolling;
        if (rpm - lastRpm >= 50) { points.push({ rpm, boost: boostAt(rpm), nm: Math.max(0, net * r / G), hp: Math.max(0, net * v / 745.7) }); lastRpm = rpm; }
        if (net <= 0 && rpm > curve[1][0]) break;
        v += Math.max(net, 0) / meff * 0.01 + 0.002;
        rpm = v * 30 / Math.PI * G / r;
    }
    return points.length > 3 ? { points, gear: gears.indexOf(ratio) + 1, room } : null;
}
$("runDyno").addEventListener("click", () => {
    clearDyno();
    const run = dynoPull();
    if (!run) { $("dynoInfo").textContent = "Needs gears, a final drive, a rev limit and a curve."; return; }
    dyno = { points: run.points, upTo: 0 };
    $("runDyno").disabled = true;
    // the engine sound runs with the pull at full throttle (it is started here when it was not playing)
    cancelAnimationFrame(dynoRamp);
    const owned = dynoSound || !preview.playing;       // (the sound is the dyno's: it started it, or it is still dropping to idle from the last run)
    const starting = preview.playing ? Promise.resolve() : playSound();
    dynoSound = owned;
    starting.then(() => {
    const start = performance.now(), duration = 4500;
    const step = (now) => {
        if (!dyno) { $("runDyno").disabled = false; return; }
        const f = Math.max(0, Math.min(1, (now - start) / duration));      // (the first frame can be stamped before the start)
        dyno.upTo = Math.floor(f * (dyno.points.length - 1));
        if (!dyno.points[dyno.upTo]) { clearDyno(); return; }
        if (preview.playing) { $("soundRpm").value = dyno.points[dyno.upTo].rpm; $("soundThrottle").value = 100; soundSliders(); }
        drawChart();
        if (f < 1) { dynoFrame = requestAnimationFrame(step); return; }
        $("runDyno").disabled = false;
        dynoSoundOff();
        const best = dyno.points.reduce((m, p) => (p.hp > m.hp ? p : m), dyno.points[0]);
        dynoBest = best; drawChart(); updateSummary();
        const engine = state.curve.reduce((m, p) => Math.max(m, power(p[0], p[1])), 0);
        $("dynoInfo").textContent = "At the wheels (dashed): " + Math.round(best.hp) + " hp at " + Math.round(best.rpm / 10) * 10 + " rpm, " + Math.round(100 * (1 - best.hp / engine)) + "% below the engine · gear " + run.gear + (state.build && run.room !== 1 ? " · in this air; corrected (DIN) " + Math.round(best.hp / run.room) + " hp" : "") + (state.buildResult && state.buildResult.maxBoost > 0 ? " · boost up to " + state.buildResult.maxBoost.toFixed(2) + " bar" : "");
    };
    dynoFrame = requestAnimationFrame(step);
    });
});

// ---- the engine card: Simple (power and max rpm) or Advanced (draw the curve in the chart)
let curveAdvanced = false, chartGeo = null;
try { curveAdvanced = localStorage.getItem("editor-engine-advanced") === "1"; } catch (e) { /* no storage */ }
function setEngineMode(advanced) {
    curveAdvanced = advanced;
    try { localStorage.setItem("editor-engine-advanced", advanced ? "1" : "0"); } catch (e) { /* no storage */ }
    $("engineAdvanced").hidden = !advanced; $("engineSimple").hidden = advanced;
    $("engineMode").querySelectorAll("button").forEach((b) => b.classList.toggle("on", (b.dataset.mode === "advanced") === advanced));
    applyBuildUi();
    drawChart();
}
$("engineMode").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setEngineMode(b.dataset.mode === "advanced"); });
// Simple: the max rpm is the rev limit of the build (the torque curve follows from the engine and is not drawn or stretched by hand)
$("simpleRpm").addEventListener("change", () => {
    if (!state.build) return;
    const want = num("simpleRpm");
    if (!(want > 1000)) return;
    $("limiter").value = Math.round(want);
    $("limiter").dispatchEvent(new Event("input", { bubbles: true }));
    $("limiter").dispatchEvent(new Event("change", { bubbles: true }));
});

function updateSpeedInfo() {
    const gears = parseGears();
    const r = (num("tyre") || 0.65) / 2;
    const final = num("finalDrive");
    const limiter = num("limiter");
    if (!gears.length || !(final > 0) || !(limiter > 0)) { $("speedInfo").textContent = ""; return; }
    const speed = (ratio) => limiter * Math.PI / 30 * r / (ratio * final) * 3.6;
    // the top speed: the thrust against the drag and the rolling resistance (OpenRacer.topSpeed), with what is in the form
    const top = OpenRacer.topSpeed({
        chassis: { mass: num("mass"), tire_diameter: num("tyre"), drag_coefficient: num("drag") },
        dimensions: { width: num("width"), height: num("height") },
        drivetrain: { gear_ratios: gears, final_drive: final, gearbox: $("gearbox").value },
        engine: { limiter_rpm: limiter, torque_curve: state.curve.slice().sort((a, b) => a[0] - b[0]) }
    });
    $("speedInfo").textContent = top > 0 ? "Top speed ~" + Math.round(top * 3.6) + " km/h" : "";
    $("speedInfo").title = "At the rev limit: " + gears.map((g, i) => "gear " + (i + 1) + ": " + Math.round(speed(g)) + " km/h").join(", ");
}

function updateSummary() {
    const el = $("summary"); if (!el) return;
    const peak = state.curve.reduce((m, p) => Math.max(m, p[1] * p[0] * Math.PI / 30), 0) / 1000;      // (kW: torque x rpm)
    const top = /~(\d+)/.exec($("speedInfo").textContent);
    const parts = [];
    if (num("mass")) parts.push(Math.round(num("mass")) + " kg");
    if (num("front")) parts.push(Math.round(num("front")) + "/" + (100 - Math.round(num("front"))) + " front/rear");
    if (peak > 0) parts.push(Math.round(peak) + " kW (" + Math.round(peak * 1.341) + " hp)");
    if (dynoBest && dyno) parts.push(Math.round(dynoBest.hp) + " hp at the wheels");
    if (top) parts.push(top[1] + " km/h");
    el.textContent = parts.join(" · ");
}
setInterval(updateSummary, 800);
function parseGears() {
    return $("gears").value.split(/[,;\s]+/).map(parseFloat).filter((v) => v > 0);
}

// ---- the configuration

function slug(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

// the configuration of the car from the form; throws a message when something is not right
function buildConfig(id) {
    const need = (id, label) => {
        const value = num(id);
        if (!(value > 0)) throw new Error(label + " has to be a number above 0.");
        return value;
    };
    const gears = parseGears();
    if (!gears.length) throw new Error("Give at least one gear ratio.");
    const curve = state.curve.filter((p) => p[1] >= 0).sort((a, b) => a[0] - b[0]);
    if (curve.length < 3) throw new Error("The engine needs at least three points on its torque curve.");
    if (!(num("limiter") > num("idle"))) throw new Error("The rev limit has to be above the idle speed.");
    const config = {
        name: $("name").value.trim(),
        description: $("description").value.trim(),
        model: null,
        wheels: { mode: wheelMode() },
        dimensions: { length: need("length", "The length"), width: need("width", "The width"), height: need("height", "The height") },
        chassis: {
            mass: need("mass", "The mass"),
            wheelbase: need("wheelbase", "The wheelbase"),
            front_track: need("frontTrack", "The front track"),
            rear_track: need("rearTrack", "The rear track"),
            weight_distribution: Math.min(0.9, Math.max(0.1, need("front", "The front weight") / 100)),
            cg_height: need("cgHeight", "The height of the centre of gravity"),
            suspension_travel: Math.max(0.01, (parseFloat($("travel").value) || 9) / 100),
            unsprung: $("unsprung").checked,
            tire_diameter: need("tyre", "The tyre diameter"),
            drag_coefficient: need("drag", "The drag coefficient"),
            max_steer_deg: need("steer", "The steering lock")
        },
        drivetrain: {
            drive: $("drive").value,
            gearbox: ["cvt", "torque-converter", "dct", "amt", "imt"].includes($("gearbox").value) ? $("gearbox").value : "gears",
            cvt_rpm: num("cvtRpm") > 0 ? num("cvtRpm") : undefined,
            tc_stall_rpm: num("tcStall") > 0 ? num("tcStall") : undefined,
            tc_ratio: num("tcRatio") > 0 ? num("tcRatio") : undefined,
            tc_lockup: $("tcLockup").checked,
            diff: $("diff").value,
            diff_preload: Math.max(0, num("diffPreload") || 0),
            diff_power: Math.min(1, Math.max(0, (num("diffPower") || 0) / 100)),
            diff_coast: Math.min(1, Math.max(0, (num("diffCoast") || 0) / 100)),
            center_diff: $("centerDiff").value,
            center_split: Math.min(1, Math.max(0, (isFinite(num("centerSplit")) ? num("centerSplit") : 40) / 100)),
            gear_ratios: gears,
            reverse_ratio: need("reverse", "The reverse ratio"),
            final_drive: need("finalDrive", "The final drive"),
            efficiency: Math.min(1, Math.max(0.5, need("efficiency", "The efficiency")))
        },
        engine: {
            idle_rpm: need("idle", "The idle speed"),
            limiter_rpm: need("limiter", "The rev limit"),
            inertia: need("inertia", "The inertia"),
            torque_curve: curve
        },
        brakes: { front: need("brakeFront", "The front brakes"), rear: need("brakeRear", "The rear brakes") },
        cameras: readCameras(),
        steering_wheel: { degrees: Math.min(1000, Math.max(30, num("steeringDegrees") || 450)) },
        sound: { engine_sim: readEngineSim() }
    };
    if (!engineSimValid(config.sound.engine_sim)) throw new Error("Every field of the engine sound needs a value.");
    if (state.build) config.engine.build = JSON.parse(JSON.stringify(readBuild()));
    const camNumbers = [config.cameras.follow.distance,
        config.cameras.follow.height, config.cameras.follow.look_height, config.cameras.follow.look_z, config.cameras.follow.smoothing, config.cameras.follow.fov_standing,
        config.cameras.follow.fov_fast, config.cameras.follow.fov_full_speed, config.cameras.follow.dolly, config.cameras.cockpit.fov, ...config.cameras.cockpit.position];
    if (!camNumbers.every(Number.isFinite)) throw new Error("Every field of the cameras needs a number.");
    if (!config.name) throw new Error("Give the car a name.");
    // a motorcycle: the type, the rider and the lean from the Motorcycle card; the drive is to the rear wheel (welded: one wheel on the axle, the ghost wheel goes with it)
    if (isBike()) { config.type = "motorcycle"; config.motorcycle = readBike(); config.drivetrain.drive = "rwd"; config.drivetrain.diff = "welded"; }
    // the settings of the Tuning card (the rest of the tuning menu) go into the configuration too
    const withTuning = OpenRacer.CarTuning.toConfig(config, tuningValues(config));
    ["tyres", "fuel", "assists", "extras"].forEach((k) => { if (withTuning[k] !== undefined) config[k] = withTuning[k]; });
    if (withTuning.colors) config.colors = withTuning.colors; else delete config.colors;      // (the paint of the body and the rims)      // (extras: the pops, the anti-lag, the boost gauge of the card)
    Object.assign(config.chassis, withTuning.chassis);
    Object.assign(config.engine, withTuning.engine);
    Object.assign(config.drivetrain, withTuning.drivetrain);
    if (wheelMode() === "model") {
        // the physics of the game takes the wheelbase, the tracks and the tyre from the wheels of the model: car.json says the same
        const c = wheelCenters();
        if (c) {
            const wb = (c.FR.c.z + c.FL.c.z) / 2 - (c.RL.c.z + c.RR.c.z) / 2;
            const ft = Math.abs(c.FR.c.x - c.FL.c.x), rt = Math.abs(c.RR.c.x - c.RL.c.x);
            const d = meanTyre(c);
            const bike = isBike();         // (a motorcycle has a wheel at each end: no track, the physics has a pair of wheels 4 cm apart)
            if (wb > 0.6 && wb < 5 && (bike || (ft > 0.4 && rt > 0.4)) && d > 0.1 && d < 1.5) {
                config.chassis.wheelbase = Math.round(wb * 1000) / 1000;
                config.chassis.front_track = Math.round((bike ? Math.max(0.04, ft) : ft) * 1000) / 1000;
                config.chassis.rear_track = Math.round((bike ? Math.max(0.04, rt) : rt) * 1000) / 1000;
                config.chassis.tire_diameter = Math.round(d * 1000) / 1000;
            } else {
                throw new Error("The wheels of the model do not make a car: the front wheels have to be in front (turn the model) and the wheels have to be between 0.1 and 1.5 m (a wheelbase of at least 0.6 m, tracks of at least 0.4 m). Check the wheel parts.");
            }
        }
        config.wheels.nodes = {};
        for (const slot of SLOTS) {
            const names = [...$("w" + slot).selectedOptions].map((o) => o.value);
            if (!names.length) throw new Error("Select the parts of every wheel, or use the wheel of the demo car.");
            config.wheels.nodes[slot] = names;
        }
    }
    const library = libraryChoice();
    if (library) config.wheels.library = library;                           // the rims and the tyres of the wheel library (WheelLibrary.js)
    if (exhaust.length) config.exhaust = exhaustConfig();
    if (suspensionEditor) Object.assign(config, suspensionEditor.read());          // the suspension and the driveline from the parts library
    const driverConfig = driverEditor && driverEditor.read();
    if (driverConfig) config.driver = driverConfig;
    if (softBodyEditor) {
        const soft = softBodyEditor.read();
        if (soft.softbody) config.softbody = soft.softbody;
        // (the layout of the shell is in the frame of the body: the centre of gravity and the tyre it was drawn at go with it, so a tune with another centre keeps the shell on the model)
        if (config.softbody && config.softbody.layout) { config.softbody.layout_cg = config.chassis.cg_height; config.softbody.layout_radius = config.chassis.tire_diameter / 2; }
        if (soft.parts) config.parts = soft.parts;
    }
    return config;
}

async function save() {
    let done = false;
    try {
        const name = $("name").value.trim();
        const id = $("id").value.trim() || slug(name);
        if (!ID_PATTERN.test(id)) throw new Error("The id may only have lower case letters, digits, - and _.");
        const config = buildConfig(id);
        if (state.cars.some((car) => car.id === id) && id !== state.existingId &&
            !(await OpenRacerDialog.ask({ title: "Replace the car “" + id + "”?", text: "There already is a car with this id.", ok: "Replace" }))) return;

        // the model
        const uploads = [];
        if (state.mainFile && state.files.size) {
            for (const [fileName, file] of state.files) {
                if (!FILE_PATTERN.test(fileName)) throw new Error("The file name “" + fileName + "” has characters that are not allowed. Use letters, digits, - _ . and spaces.");
                uploads.push([fileName, file]);
            }
            config.model = { type: "gltf", file: "cars/" + id + "/" + state.mainFile };
        } else if (state.existingModel) {
            config.model = JSON.parse(JSON.stringify(state.existingModel));
            if (config.model.type === "gltf" && id !== state.existingId) {
                if (!/\.glb$/i.test(config.model.file)) throw new Error("To save this car under another id, load its model files again.");
                const blob = await (await fetch(OpenRacer.Garage.resolve(state.existingCar, "../" + config.model.file))).blob();
                const fileName = config.model.file.split("/").pop();
                uploads.push([fileName, blob]);
                config.model.file = "cars/" + id + "/" + fileName;
            }
        } else {
            throw new Error("Load a model first.");
        }
        if (config.model.type === "gltf") {
            const overrides = {};
            for (const [materialName, override] of Object.entries(state.overrides)) {
                if (Object.keys(override).length) overrides[materialName] = override;
            }
            if (Object.keys(overrides).length) config.materials = overrides;
            config.model.rotation_y = num("rotation") || 0;
            config.model.scale = num("scale") > 0 ? num("scale") : 1;
            config.model.offset = [num("offsetX") || 0, num("offsetY") || 0, num("offsetZ") || 0];
        }

        // the driver model: a new file is saved as driver.glb in the folder of the car; the one that the car has goes along when it is saved under another id
        if (config.driver) {
            const fresh = driverEditor.newFile();
            const kept = driverEditor.existingFile();
            if (fresh) { uploads.push(["driver.glb", fresh]); config.driver.file = "cars/" + id + "/driver.glb"; }
            else if (kept && id !== state.existingId) {
                const blob = await (await fetch(OpenRacer.Garage.resolve(state.existingCar, "../" + kept))).blob();
                uploads.push(["driver.glb", blob]);
                config.driver.file = "cars/" + id + "/driver.glb";
            } else if (kept) config.driver.file = kept;
            else delete config.driver;
        }

        // what the tuning menu of the game has put in the configuration, and that this form does not have, is kept
        const old = state.existingCar;
        if (old && id === state.existingId) {
            for (const section of ["chassis", "drivetrain", "engine"]) config[section] = Object.assign({}, old[section], config[section]);
            for (const section of ["tyres", "assists", "extras"]) if (old[section] && !config[section]) config[section] = old[section];
        }

        // the model that is replaced is removed from the folder of the car when it has another name
        const oldFile = state.replacedModel && state.replacedModel.type === "gltf" ? state.replacedModel.file : null;

        status("Saving…");
        // the server when it is there (serve.py), otherwise the garage of this browser (Garage.js)
        const files = {};
        for (const [fileName, file] of uploads) files[fileName] = file;
        const remove = oldFile && config.model.type === "gltf" && oldFile !== config.model.file && oldFile.startsWith("cars/" + id + "/") ? [oldFile.split("/").pop()] : [];
        const saved = await OpenRacer.Garage.store("cars", id, config, files, { base: "../", remove });
        fetch("../api/cars/" + encodeURIComponent(id) + "/preview.webp", { method: "DELETE" }).catch(() => {});      // the picture in the menu is made again
        state.replacedModel = null;
        state.existingId = id;
        state.existingModel = config.model;
        state.existingCar = Object.assign({}, config, { id });
        state.files = new Map();
        state.mainFile = null;
        if (driverEditor) driverEditor.saved(config.driver ? config.driver.file : null);
        await refreshList(id);
        $("delete").style.display = "";
        status(saved.where === "server" ? "Saved as cars/" + id + ". It is in the main menu of the game now."
            : "Saved in your garage, in this browser (the server does not save). It is in the main menu of the game now.", "ok");
        done = true;
        setDirty(false);
    } catch (error) {
        status(error.message, "error");
    }
    return done;
}

// the car is saved and driven at once, on the track that was chosen last
// Save and test: the car is saved, then a window asks for a track and the conditions (the weather, the time of day and the ground are the options of the game: what is chosen
// here is what the game starts with), or starts at once with the last settings
const TEST_WEATHER = [["clear", "Clear"], ["cloudy", "Cloudy"], ["fog", "Fog"], ["rain", "Rain"], ["snow", "Snow"]];
const TEST_TIME = [[5.25, "Dawn"], [8, "Morning"], [12, "Noon"], [15, "Afternoon"], [17.5, "Evening"], [19, "Sunset"], [20.25, "Dusk"], [23.5, "Night"]];
const TEST_GROUND = [["auto", "Follows the weather"], ["dry", "Dry"], ["wet", "Wet"], ["snow", "Snow"]];
function gameSettings() { try { return JSON.parse(localStorage.getItem("openracer.settings")) || {}; } catch (e) { return {}; } }
function lastTestChoice() {
    const options = gameSettings().options || {};
    let track = "circuit";
    try { track = (JSON.parse(localStorage.getItem("openracer.lastChoice")) || {}).track || track; } catch (e) { /* no storage */ }
    return { track, weather: options.gfxWeather || "clear", time: options.gfxTime !== undefined ? options.gfxTime : 12, ground: options.gfxGround || "auto" };
}
function startTest(choice) {
    // the conditions go where the game keeps its options (the rest of the settings stays as it is), the track where the main menu keeps its choice
    try {
        const settings = gameSettings();
        settings.options = Object.assign({}, settings.options, { gfxWeather: choice.weather, gfxTime: choice.time, gfxGround: choice.ground });
        localStorage.setItem("openracer.settings", JSON.stringify(settings));
        const last = JSON.parse(localStorage.getItem("openracer.lastChoice")) || {};
        last.track = choice.track; last.car = state.existingId;
        localStorage.setItem("openracer.lastChoice", JSON.stringify(last));
    } catch (e) { /* no storage */ }
    window.location.href = "../index.html?car=" + encodeURIComponent(state.existingId) + "&track=" + encodeURIComponent(choice.track);
}
let testTracks = null;
async function openTestDialog() {
    if (!testTracks) { try { testTracks = await Catalog.load("tracks", "../"); } catch (e) { testTracks = []; } }
    const last = lastTestChoice(), picked = Object.assign({}, last);
    const trackName = (id) => { const t = testTracks.find((x) => x.id === id); return t ? (t.name || t.id) : id; };
    const nameOf = (list, v) => { const e = list.find((x) => x[0] === v); return e ? e[1] : v; };
    const select = $("testTrack");
    select.innerHTML = testTracks.map((t) => "<option value='" + t.id + "'>" + (t.name || t.id) + "</option>").join("");
    if (!testTracks.some((t) => t.id === picked.track) && testTracks.length) picked.track = testTracks[0].id;
    select.value = picked.track;
    select.onchange = () => { picked.track = select.value; };
    const chips = (id, list, key) => {
        const box = $(id); box.innerHTML = "";
        list.forEach(([value, label]) => {
            const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.className = "small" + (picked[key] === value ? " on" : "");
            b.onclick = () => { picked[key] = value; [...box.children].forEach((c) => c.classList.toggle("on", c === b)); };
            box.appendChild(b);
        });
    };
    chips("testWeather", TEST_WEATHER, "weather"); chips("testTime", TEST_TIME, "time"); chips("testGround", TEST_GROUND, "ground");
    $("testLast").textContent = "Use last settings: " + trackName(last.track) + ", " + nameOf(TEST_WEATHER, last.weather).toLowerCase() + ", " + nameOf(TEST_TIME, last.time).toLowerCase();
    $("testLast").onclick = () => startTest(last);
    $("testStart").onclick = () => startTest(picked);
    $("dlgTest").showModal();
}
async function saveAndDrive() {
    if (!(await save())) return;
    openTestDialog();
}
$("saveDrive").addEventListener("click", saveAndDrive);
// a .glb that is dropped on the page becomes the model
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
    e.preventDefault();
    const files = [...(e.dataTransfer ? e.dataTransfer.files : [])];
    if (files.some((f) => /\.(glb|gltf)$/i.test(f.name))) loadFromFiles(files);
});

async function deleteCar() {
    if (!state.existingId || !(await OpenRacerDialog.ask({ title: "Delete the car “" + state.existingId + "”?", text: "With all its files.", ok: "Delete", danger: true }))) return;
    try {
        const result = await OpenRacer.Garage.discard("cars", state.existingId, { base: "../" });
        status(result.where === "server" ? "Deleted." : "Deleted from your garage.", "ok");
    } catch (error) {
        status("The car could not be deleted (" + error.message + ").", "error");
        return;
    }
    newCar();
    refreshList();
}

// ---- the steering wheel

// The steering wheel of the model turns with the Steering slider of the Driver card (the ring of the hands is the axis and the middle): angle in radians about axis through centre
// (scene space), or null to put it back where it was
let steerRest = null;
function steeringPreview(centre, axis, angle) {
    const found = state.nodes.find((n) => /steeringwheel|steerwheel/i.test(n.name.replace(/[^a-z0-9]/gi, "")));
    if (steerRest && (!found || steerRest.object !== found.object)) { steerRest.object.matrix.copy(steerRest.matrix); steerRest.object.matrix.decompose(steerRest.object.position, steerRest.object.quaternion, steerRest.object.scale); steerRest = null; }
    if (!found) return;
    const object = found.object;
    if (!steerRest) { object.updateMatrix(); steerRest = { object, matrix: object.matrix.clone() }; }
    object.matrix.copy(steerRest.matrix);
    object.matrix.decompose(object.position, object.quaternion, object.scale);
    if (angle === null || !angle) { object.updateMatrixWorld(true); return; }
    object.updateMatrixWorld(true);
    const parent = object.parent;
    if (parent) parent.updateMatrixWorld(true);
    const world = object.matrixWorld.clone();
    const turn = new THREE.Matrix4().makeTranslation(centre.x, centre.y, centre.z)
        .multiply(new THREE.Matrix4().makeRotationAxis(axis, angle))
        .multiply(new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z));
    world.premultiply(turn);
    if (parent) world.premultiply(parent.matrixWorld.clone().invert());
    world.decompose(object.position, object.quaternion, object.scale);
    object.updateMatrixWorld(true);
}

function updateSteeringInfo() {
    const found = state.nodes.find((n) => /steeringwheel|steerwheel/i.test(n.name.replace(/[^a-z0-9]/gi, "")));
    $("steeringInfo").textContent = !state.nodes.length ? "No model loaded."
        : found ? "Found the part “" + found.name + "”: it turns with the steering in the game."
        : "No part called steeringwheel in this model: the steering wheel does not turn. Name it that way in Blender to make it turn.";
}

// ---- the differentials

const DIFF_INFO = {
    open: "Open: the wheel with least grip decides. Easy, but the worst traction.",
    lsd: "Limited slip: locks more the harder it is driven. Traction out of corners.",
    welded: "Welded: both wheels turn the same. Best for drifting; scrubs in slow corners."
};

function updateDiffFields() {
    const drive = $("drive").value, diff = $("diff").value;
    $("lsdBox").style.display = diff === "lsd" ? "" : "none";
    $("centerBox").style.display = drive === "awd" ? "" : "none";
    $("splitBox").style.display = drive === "awd" ? "" : "none";
    $("diffInfo").textContent = DIFF_INFO[diff] + (drive === "awd" ? " Centre: " + ({ open: "open, the fixed share", lsd: "limited slip", locked: "locked" })[$("centerDiff").value] + "." : "");
}
["drive", "diff", "centerDiff"].forEach((id) => $(id).addEventListener("change", updateDiffFields));
updateDiffFields();

// ---- cars that exist

async function refreshList(select) {
    try {
        // the cars of the server, of the garage of this browser and of a linked folder (Catalog.js)
        state.cars = await Catalog.load("cars", "../");
    } catch (e) {
        state.cars = [];
    }
    const el = $("existing");
    el.innerHTML = "<option value=''>Choose a car to change…</option>";
    state.cars.forEach((car) => {
        const option = document.createElement("option");
        option.value = car.id;
        const source = OpenRacer.Garage.sourceOf(car);
        option.textContent = (car.name || car.id) + " (" + car.id + ")" + (source === "garage" ? " · my garage" : source === "folder" ? " · folder" : "");
        el.appendChild(option);
    });
    if (select) el.value = select;
}

function fill(car) {
    $("name").value = car.name || "";
    $("id").value = car.id;
    state.idEdited = true;
    $("description").value = car.description || "";
    const set = (id, value) => { if (value !== undefined) $(id).value = value; };
    set("length", car.dimensions.length); set("width", car.dimensions.width); set("height", car.dimensions.height);
    const c = car.chassis;
    set("mass", c.mass); set("front", +(c.weight_distribution * 100).toFixed(2)); set("cgHeight", c.cg_height);
    set("travel", Math.round((c.suspension_travel || 0.09) * 100)); $("travelLabel").textContent = $("travel").value + " cm";
    $("unsprung").checked = !!c.unsprung;
    set("wheelbase", c.wheelbase); set("frontTrack", c.front_track); set("rearTrack", c.rear_track);
    set("tyre", c.tire_diameter); set("drag", c.drag_coefficient); set("steer", c.max_steer_deg);
    $("vehicleType").value = car.type === "motorcycle" ? "motorcycle" : "car";
    fillBike(car.motorcycle);
    applyTypeUI();
    tuningFromCar(car);
    const d = car.drivetrain;
    set("steeringDegrees", (car.steering_wheel && car.steering_wheel.degrees) || 450);
    set("drive", d.drive); set("diff", d.diff || "lsd"); set("centerDiff", d.center_diff || "lsd");
    set("gearbox", ["cvt", "torque-converter", "dct", "amt", "imt"].includes(d.gearbox) ? d.gearbox : "gears"); $("cvtRpm").value = d.cvt_rpm || "";
    $("tcStall").value = d.tc_stall_rpm || ""; $("tcRatio").value = d.tc_ratio || ""; $("tcLockup").checked = d.tc_lockup !== false;
    syncGearboxBoxes();
    set("diffPreload", d.diff_preload !== undefined ? d.diff_preload : 150);
    set("diffPower", Math.round((d.diff_power !== undefined ? d.diff_power : 0.3) * 100));
    set("diffCoast", Math.round((d.diff_coast !== undefined ? d.diff_coast : 0.1) * 100));
    set("centerSplit", Math.round((d.center_split !== undefined ? d.center_split : 0.4) * 100));
    updateDiffFields();
    set("finalDrive", d.final_drive); set("gears", d.gear_ratios.join(", "));
    set("reverse", d.reverse_ratio); set("efficiency", d.efficiency);
    const e = car.engine;
    set("idle", e.idle_rpm); set("limiter", e.limiter_rpm); set("inertia", e.inertia);
    state.curve = e.torque_curve.map((p) => [p[0], p[1]]);
    state.build = e.build && e.build.bore ? JSON.parse(JSON.stringify(e.build)) : null;
    $("bBlock").value = state.build ? (state.build.block || "") : "";
    if (state.build) { showBuild(state.build); state.buildResult = EB.compute(state.build, e.limiter_rpm, e.idle_rpm); }
    else state.buildResult = null;
    applyBuildUi();
    set("brakeFront", car.brakes.front); set("brakeRear", car.brakes.rear);
    fillCameras(OpenRacer.cameraSettings(car));
    loadExhaust(car.exhaust);
    if (suspensionEditor) suspensionEditor.fill(car);
    if (softBodyEditor) softBodyEditor.fill(car);
    if (driverEditor) driverEditor.fill(car);
    fillEngineSim(OpenRacer.engineSimParams(car));
    syncExhaustSelect();
    stopPreview();
    engineSimChanged();
    renderCurve();
    setLibraryChoice(car.wheels && car.wheels.library || null);            // the rims and the tyres of the wheel library of this car or tune
}

function loadExisting() {
    const car = state.cars.find((c) => c.id === $("existing").value);
    if (!car) return;
    try { localStorage.setItem("editor-last-car", car.id); } catch (e) { /* no storage */ }
    newCar();
    state.existingId = car.id;
    state.existingModel = car.model;
    state.existingCar = car;
    // the tune that is chosen for this car (the main menu, the tuning menu, this editor: OpenRacer.Setups) goes into the form at once, as choosing it in the list does
    const activeTune = OpenRacer.Setups ? OpenRacer.Setups.active(car.id) : null;
    let shown = car;
    if (activeTune) {
        const saved = OpenRacer.Setups.configOf(car.id, activeTune, car);
        if (saved) shown = Object.assign({}, car, saved, { id: car.id, model: car.model });
        if (shown.driver && !shown.driver.file && car.driver && car.driver.file) shown.driver = Object.assign({}, shown.driver, { file: car.driver.file });
        if (shown.softbody && shown.softbody.layout && !isFinite(shown.softbody.layout_cg) && car.chassis) shown.softbody = Object.assign({}, shown.softbody, { layout_cg: car.chassis.cg_height, layout_radius: car.chassis.tire_diameter / 2 });
    }
    fill(shown);
    state.overrides = JSON.parse(JSON.stringify(shown.materials || car.materials || {}));
    state.autoGlass = !car.materials; // a car that was made before the materials could be set gets see-through glass as a suggestion
    $("delete").style.display = "";
    if (car.model.type === "gltf") {
        const m = car.model;
        $("rotation").value = m.rotation_y || 0;
        $("scale").value = m.scale || 1;
        const o = m.offset || [0, 0, 0];
        $("offsetX").value = o[0]; $("offsetY").value = o[1]; $("offsetZ").value = o[2];
        const wheels = shown.wheels || car.wheels || { mode: "default" };
        setLibraryChoice(wheels.library || null);
        document.querySelector("input[name=wheelMode][value=" + wheels.mode + "]").checked = true;
        $("wheelSelects").style.display = wheels.mode === "model" ? "" : "none";
        loadFromUrl("../" + m.file, m.file, car);
        // the parts are known once the model is loaded
        const wait = setInterval(() => {
            if (!state.root) return;
            clearInterval(wait);
            for (const slot of SLOTS) {
                const names = (wheels.nodes && wheels.nodes[slot]) || [];
                [...$("w" + slot).options].forEach((option) => { option.selected = names.includes(option.value); });
            }
            updateHelpers();
        }, 100);
        $("modelInfo").textContent = "Loading " + m.file + "…";
    } else {
        // the model of the original demo has its own wheels
        document.querySelector("input[name=wheelMode][value=default]").checked = true;
        $("wheelSelects").style.display = "none";
        $("modelInfo").textContent = "This car uses the model of the original demo. It cannot be changed here, but everything else can.";
    }
    $("editing").textContent = "Editing " + (car.name || car.id) + " (cars/" + car.id + "). Saving overwrites it; change the id to save a copy.";
    $("modelNote").textContent = "A new model keeps the wheels, materials and settings where they still fit.";
    setDirty(false);
    status("Loaded " + (car.name || car.id) + (activeTune && shown !== car ? " with the tune " + activeTune : "") + ".");
}

function newCar(type) {
    $("vehicleType").value = type === "motorcycle" ? "motorcycle" : "car";
    fillBike(null);
    if (softBodyEditor) softBodyEditor.fill({});
    if (driverEditor) driverEditor.fill({});
    fillEngineSim(OpenRacer.engineSimParams(null));
    tuningFromCar(null);
    stopPreview();
    state.existingId = null;
    state.existingModel = null;
    state.existingCar = null;
    state.files = new Map();
    state.mainFile = null;
    state.idEdited = false;
    if (state.root) pivot.remove(state.root);
    state.root = null;
    state.nodes = [];
    updateSteeringInfo();
    state.materials = [];
    state.overrides = {};
    state.autoGlass = false;
    renderMaterials();
    for (const slot of SLOTS) $("w" + slot).innerHTML = "";
    $("modelInfo").textContent = "No model loaded.";
    $("modelNote").textContent = "";
    $("files").value = "";
    $("name").value = ""; $("id").value = ""; $("description").value = "";
    $("delete").style.display = "none";
    $("editing").textContent = "Choose a car to change it, or make a new one below. Saving a car that was chosen here overwrites it.";
    helpers.clear();
    setDirty(false);
    status("");
}

// ---- events

$("importBtn").addEventListener("click", () => $("files").click());
$("files").addEventListener("change", (e) => loadFromFiles(e.target.files));
for (const id of ["rotation", "scale", "offsetX", "offsetY", "offsetZ"]) $(id).addEventListener("input", applyTransform);
document.querySelectorAll("[data-turn]").forEach((button) => button.addEventListener("click", () => {
    $("rotation").value = (((num("rotation") || 0) + parseFloat(button.dataset.turn)) % 360);
    applyTransform();
}));
$("fit").addEventListener("click", fit);
$("guessWheels").addEventListener("click", guessWheels);

// ---- the wheel library (WheelLibrary.js, web/wheels/wheels.json): a rim and a tyre per axle in place of the wheel parts of the model
OpenRacer.WheelLibrary.base = "../";
OpenRacer.WheelLibrary.load().then(() => {
    for (const axle of ["front", "rear"]) {
        for (const kind of ["rim", "tyre"]) {
            const select = $(LIB_SELECTS[axle][kind]);
            const list = kind === "rim" ? OpenRacer.WheelLibrary.rims() : OpenRacer.WheelLibrary.tyres();
            for (const entry of list) {
                const option = document.createElement("option");
                option.value = entry.id;
                option.textContent = entry.name || entry.id;
                select.appendChild(option);
            }
        }
    }
    if (!OpenRacer.WheelLibrary.rims().length && !OpenRacer.WheelLibrary.tyres().length) $("libInfo").textContent = "No wheel library found (web/wheels/wheels.json): tools/make-wheels.py writes a set of examples.";
    if (state.pendingLibrary) setLibraryChoice(state.pendingLibrary);
    updateLibraryPreview();
});
// what is chosen: { front: { rim, tyre, custom }, rear: { ... } } without the empty ones, or null. A rim brings a custom tyre, made from the numbers of the Tyres settings (width, diameter,
// height of the sidewall, rubber: CarTuning.libraryOf); a tyre of the library only stays where a car has one
function libraryChoice() {
    const values = Object.assign({}, tuning, { rim_front: $("libRimFront").value, tyre_front: $("libTyreFront").value, rim_rear: $("libRimRear").value, tyre_rear: $("libTyreRear").value });
    const out = OpenRacer.CarTuning.libraryOf(values);
    return Object.keys(out).length ? out : null;
}
function setLibraryChoice(library) {
    state.pendingLibrary = library;
    const cfg = { wheels: { library: library || {} } };
    for (const axle of ["front", "rear"]) {
        const c = OpenRacer.WheelLibrary.choiceOf(cfg, axle);
        for (const kind of ["rim", "tyre"]) {
            const select = $(LIB_SELECTS[axle][kind]);
            select.value = [...select.options].some((o) => o.value === c[kind]) ? c[kind] : "";
        }
    }
    for (const axle of ["front", "rear"]) { const select = $(LIB_SELECTS[axle].tyre); select.parentNode.style.display = select.value ? "" : "none"; }          // (the tyre of the library is only shown for a car that has one)
    syncTuningVisibility();
    updateLibraryPreview();                 // (a tune loaded into the form: its rims and tyres show at once)
}
// the preview: the wheel parts of the model of an axle on the library are hidden and the rim and the tyre of the library are drawn at their middle (or, without wheel parts, where car.json puts the wheels)
function updateLibraryPreview() {
    libHidden.forEach((p) => { p.visible = true; });
    libHidden = [];
    libPreview.clear();
    const library = libraryChoice();
    const lines = [];
    if (!library) { $("libInfo").textContent = ""; return; }
    const cfg = { type: $("vehicleType") ? $("vehicleType").value : "car", wheels: { library } };
    OpenRacer.WheelLibrary.preload(cfg, undefined, () => {
        if (JSON.stringify(libraryChoice()) !== JSON.stringify(library)) return;          // (changed again while the files loaded)
        libHidden.forEach((p) => { p.visible = true; });
        libHidden = [];
        libPreview.clear();
        const bike = cfg.type === "motorcycle";
        for (const slot of SLOTS) {
            if (bike && (slot === "FR" || slot === "RR")) continue;
            const wheel = OpenRacer.WheelLibrary.wheelFor(cfg, slot);
            if (!wheel) continue;
            let centre = null;
            if (wheelMode() === "model") {
                const box = wheelBox(slot);
                if (box) { centre = box.getCenter(new THREE.Vector3()); wheelParts(slot).forEach((p) => { p.visible = false; libHidden.push(p); }); }
            }
            if (!centre) {
                const front = slot[0] === "F", left = slot[1] === "L", track = (front ? num("frontTrack") : num("rearTrack")) || 1.5;
                centre = new THREE.Vector3((bike ? 0 : (left ? 1 : -1) * track / 2), 0, (front ? 1 : -1) * ((num("wheelbase") || 2.6) / 2));
            }
            if (wheel.offset) centre.x += (slot[1] === "L" ? 1 : -1) * wheel.offset;
            wheel.object.position.copy(centre);
            libPreview.add(wheel.object);
        }
        for (const axle of ["front", "rear"]) {
            const shell = OpenRacer.WheelLibrary.shellOf(cfg, axle);
            if (shell) lines.push(axle + ": tyre " + (shell.diameter * 1000).toFixed(0) + " mm across, " + (shell.width * 1000).toFixed(0) + " mm wide, shell " + (shell.rings || 3) + " rings × " + (shell.segments || 36) + " nodes, inner shell " + Math.round((shell.inner_ratio || 0.62) * 100) + " %, carcass " + (shell.carcass || 0) + " mm");
        }
        const bad = OpenRacer.WheelLibrary.problems(cfg);
        if (bad.length) lines.push("Not found: " + bad.join("; ") + " (check \"file\" in web/wheels/wheels.json; the wheels of the model are used).");
        $("libInfo").style.whiteSpace = "pre-line";
        $("libInfo").textContent = lines.join("\n");
    });
}
Object.values(LIB_SELECTS).forEach((axle) => Object.values(axle).forEach((id) => $(id).addEventListener("change", () => { state.pendingLibrary = null; updateHelpers(); syncTuningVisibility(); if (bench.vehicle) restartBench(); })));
for (const slot of SLOTS) $("w" + slot).addEventListener("change", updateHelpers);
document.querySelectorAll("input[name=wheelMode]").forEach((radio) => radio.addEventListener("change", () => {
    $("wheelSelects").style.display = wheelRadio() === "model" ? "" : "none";
    updateHelpers();
}));
$("sizeFromModel").addEventListener("click", sizeFromModel);
$("chassisFromWheels").addEventListener("click", chassisFromWheels);
for (const id of ["limiter", "idle"]) $(id).addEventListener("input", () => { if (state.build) recomputeBuild(); clearDyno(); drawChart(); updateSpeedInfo(); $("soundRpm").max = Math.round((num("limiter") || 7000) * 1.1); });
for (const id of ["gears", "finalDrive", "tyre"]) $(id).addEventListener("input", updateSpeedInfo);
$("name").addEventListener("input", () => { if (!state.idEdited) $("id").value = slug($("name").value); });
$("id").addEventListener("input", () => { state.idEdited = true; });
$("existing").addEventListener("change", loadExisting);
$("camDefaults").addEventListener("click", defaultCameras);
document.querySelectorAll(".cam").forEach((el) => el.addEventListener("input", updateCameraMarkers));
for (const id of ["length", "width", "height", "tyre"]) $(id).addEventListener("input", updateCameraMarkers);
$("newCar").addEventListener("click", () => { newCar("car"); $("existing").value = ""; applyTypeUI(); });
if (new URLSearchParams(window.location.search).get("new") === "car") { try { localStorage.removeItem("editor-last-car"); } catch (e) { /* no storage */ } }      // (New in the garage of the main menu: no car is loaded)
$("newBike").addEventListener("click", () => {
    newCar("motorcycle"); $("existing").value = "";
    // what a motorcycle has by default (the CBR 600 of the game as a start): the mass without the rider, a tall centre of gravity, a 17 inch wheel, short gears
    const set = (id, v) => { $(id).value = v; };
    set("mass", 190); set("front", 49); set("cgHeight", 0.62); set("travel", 12); $("travelLabel").textContent = "12 cm"; set("tyre", 0.61); set("drag", 0.6); set("steer", 22);
    set("brakeFront", 1200); set("brakeRear", 250); set("gears", "2.75, 2, 1.667, 1.444, 1.304, 1.208"); set("finalDrive", 6); set("length", 2.0); set("width", 0.72); set("height", 1.1); set("wheelbase", 1.4);
    applyTypeUI();
});
$("save").addEventListener("click", () => {
    const name = $("setupSelect").value, id = $("id").value.trim();
    if (!name) { save(); return; }
    try { saveTune(id, name); $("setupSelect").value = name; updateTuneButtons(); setDirty(false); status("Tune " + name + " saved (car.json is not written)."); }
    catch (error) { status("Could not save the tune: " + error.message); }
});
$("delete").addEventListener("click", deleteCar);

initEngineSim();
syncExhaustSelect();
renderCurve();
setEngineMode(curveAdvanced);
updateSpeedInfo();
defaultCameras();
// the car that was open last time is open again: no choosing in the list first
refreshList().then(() => {
    let last = null;
    try { last = localStorage.getItem("editor-last-car"); } catch (e) { /* no storage */ }
    const asked = new URLSearchParams(window.location.search).get("car");                  // (Load in the garage of the main menu: this car)
    if (asked && state.cars.some((c) => c.id === asked)) last = asked;
    const id = state.cars.some((c) => c.id === last) ? last : (state.cars[0] && state.cars[0].id);      // the one of last time, else the first of the list
    if (id && !$("existing").value) { $("existing").value = id; loadExisting(); }
});


// ---- the Tuning card: everything of the tuning menu of the game that the form does not have, from the shared table (CarTuning.js)
const EDITOR_HAS = new Set(["mass", "front_weight", "cg_height", "drag_coefficient", "max_steer_deg", "idle_rpm", "limiter_rpm", "engine_inertia",
    "final_drive", "reverse_ratio", "brake_total", "brake_bias", "diff_preload", "diff_power", "diff_coast", "center_split", "suspension_travel",
    // (the rows of the tuning menu that the form has as its own cards)
    "efficiency", "length", "width", "height", "steering_degrees", "gen_power", "gen_peak_rpm", "sb_max_nodes", "sb_wheel_strength",
    "cam_follow_distance", "cam_follow_height", "cam_follow_look_height", "cam_follow_look_z", "cam_follow_smoothing", "cam_follow_fov_standing", "cam_follow_fov_fast", "cam_follow_fov_full_speed", "cam_follow_dolly",
    "cam_cockpit_x", "cam_cockpit_y", "cam_cockpit_z", "cam_cockpit_fov",
    "bike_max_lean", "bike_fast_lean", "bike_rake", "bike_rider_mass", "bike_hang_off", "bike_max_lateral_g", "bike_balance", "bike_fork_dive"]);
const TUNING_KEYS = OpenRacer.CarTuning.keys().filter((k) => !EDITOR_HAS.has(k));
let tuning = {};
const DEFAULT_CAR = { chassis: { mass: 1400, weight_distribution: 0.55, drag_coefficient: 0.35 }, drivetrain: { gear_ratios: [3, 2, 1.4, 1], final_drive: 3.5 }, engine: {} };

function tuningFromCar(car) {
    const all = OpenRacer.CarTuning.fromConfig(car || DEFAULT_CAR);
    tuning = {};
    TUNING_KEYS.forEach((k) => { tuning[k] = all[k]; });
    tuning.compound = all.compound;                       // (not a number: the kind of tyre)
    tuning.tyre_damage = all.tyre_damage === "on" ? "on" : "off";     // (a word in the table, as the tuning menu has it)
    PAINT_WORDS.forEach((k) => { tuning[k] = all[k]; });               // (the paint: colours as text, the finish and the pattern as words)
    Object.keys(OpenRacer.CarTuning.FEATURE_DEFAULTS).forEach((k) => { tuning[k] = all[k]; });     // the ticks of the systems and the extras, with their settings
    tuningBase = Object.assign({}, tuning);
    renderTuningCard();
}

// ---- the paint: the colour and the finish of the body (the material carpaint) and of the rims (rimpaint), as in the tuning menu of the game (CarColors.js)
const PAINT_WORDS = ["body_color", "rim_color", "body_finish", "rim_finish", "body_pattern", "rim_pattern", "body_uv", "rim_uv"], PAINT_KEYS = ["body_flake", "rim_flake"];
function applyPaint() {
    if (!state.root || !OpenRacer.applyCarColors) return;
    const t = tuning;
    OpenRacer.applyCarColors([state.root], {
        body: t.body_color || null, rim: t.rim_color || null, bodyFinish: t.body_finish || "", rimFinish: t.rim_finish || "",
        bodyFlake: t.body_flake || 100, rimFlake: t.rim_flake || 100, bodyPattern: t.body_pattern || "noise", rimPattern: t.rim_pattern || "noise", bodyUv: t.body_uv || "model", rimUv: t.rim_uv || "model"
    });
}
function paintSection() {
    const details = document.createElement("details");
    details.className = "inner";
    details.open = false;
    details.innerHTML = "<summary title='Only the materials called carpaint (the body) and rimpaint (the rims) of the model are painted'>Paint (the materials carpaint and rimpaint)</summary>";
    const row = (labelText, control) => {
        const wrap = document.createElement("div"); wrap.className = "tuneItem";
        const line = document.createElement("div"); line.className = "tuneLine";
        const text = document.createElement("span"); text.className = "tuneLabel"; text.textContent = labelText;
        line.appendChild(text); line.appendChild(control); wrap.appendChild(line); details.appendChild(wrap);
        return wrap;
    };
    const changed = () => { tuningChanged(); setDirty(true); };
    for (const part of ["body", "rim"]) {
        const label = part === "body" ? "body" : "rims";
        const colour = document.createElement("input"); colour.type = "color";
        colour.value = tuning[part + "_color"] || "#888888"; colour.style.opacity = tuning[part + "_color"] ? "" : 0.45;
        colour.addEventListener("input", () => { tuning[part + "_color"] = colour.value; colour.style.opacity = ""; changed(); });
        const reset = document.createElement("button"); reset.type = "button"; reset.className = "small ghost"; reset.textContent = "↺"; reset.title = "The colour of the model";
        reset.addEventListener("click", () => { tuning[part + "_color"] = ""; colour.style.opacity = 0.45; changed(); });
        const box = document.createElement("span"); box.appendChild(colour); box.appendChild(reset);
        row("Colour of the " + label, box);
        const finish = document.createElement("select");
        Object.entries(OpenRacer.carFinishes).forEach(([id, f]) => { const o = document.createElement("option"); o.value = id; o.textContent = f.label; finish.appendChild(o); });
        finish.value = tuning[part + "_finish"] || "";
        row("Finish of the " + label, finish);
        const pattern = document.createElement("select");
        Object.entries(OpenRacer.carFlakePatterns).forEach(([id, name]) => { const o = document.createElement("option"); o.value = id; o.textContent = name; pattern.appendChild(o); });
        pattern.value = tuning[part + "_pattern"] || "noise";
        const patternRow = row("Flake pattern of the " + label, pattern);
        const uv = document.createElement("select");
        Object.entries(OpenRacer.carFlakeUvs).forEach(([id, name]) => { const o = document.createElement("option"); o.value = id; o.textContent = name; uv.appendChild(o); });
        uv.value = tuning[part + "_uv"] || "model";
        uv.title = "Generated: the flakes are laid on the car by where they are in space, so a model without a good UV map gets them too";
        const uvRow = row("Flake map of the " + label + " (the UV map)", uv);
        uv.addEventListener("change", () => { tuning[part + "_uv"] = uv.value; changed(); });
        const size = tuneSlider(["" + part + "_flake", "Flake size of the " + label + " (metal flake)", "%", 2, 400, 1], changed);
        details.appendChild(size);
        const showFlake = () => { const on = finish.value === "flake"; patternRow.style.display = on ? "" : "none"; uvRow.style.display = on ? "" : "none"; size.style.display = on ? "" : "none"; };
        finish.addEventListener("change", () => { tuning[part + "_finish"] = finish.value; showFlake(); changed(); });
        pattern.addEventListener("change", () => { tuning[part + "_pattern"] = pattern.value; changed(); });
        showFlake();
    }
    return details;
}

let tuningBase = {};                                  // the values of the car as it was loaded (the ↺ of a setting goes back to it)

// a setting as a line (the label, a number, the unit, ↺) with a slider under it, as the tuning menu of the game has it (Tuning.js): the slider covers the range of the
// table, the number takes anything up to twice that
function tuneSlider(item, onChange) {
    const [key, label, unit, min, max, step] = item;
    const wrap = document.createElement("div");
    wrap.className = "tuneItem";
    wrap.dataset.tuneKey = key;
    const line = document.createElement("div");
    line.className = "tuneLine";
    const text = document.createElement("span");
    text.className = "tuneLabel";
    text.textContent = label;
    const number = document.createElement("input");
    number.type = "number"; number.min = min; number.max = max; number.step = step; number.id = "tune_" + key;
    const unitSpan = document.createElement("span");
    unitSpan.className = "tuneUnit";
    unitSpan.textContent = unit;
    const reset = document.createElement("button");
    reset.type = "button"; reset.className = "small ghost tuneReset"; reset.textContent = "↺"; reset.title = "Back to the value of the car as loaded";
    line.appendChild(text); line.appendChild(number); line.appendChild(unitSpan); line.appendChild(reset);
    // a setting of the rear that has a front twin: a button gives it the value of the front
    const twin = key.endsWith("_rear") ? key.replace(/_rear$/, "_front") : null;
    if (twin && TUNING_KEYS.includes(twin)) {
        const same = document.createElement("button");
        same.type = "button"; same.className = "small ghost"; same.textContent = "= front"; same.title = "The value of the front";
        same.addEventListener("click", () => { if (Number.isFinite(tuning[twin])) { tuning[key] = tuning[twin]; show(); onChange(); } });
        line.insertBefore(same, reset);
    }
    const range = document.createElement("input");
    range.type = "range"; range.min = min; range.max = max; range.step = step;
    wrap.appendChild(line); wrap.appendChild(range);
    const digits = step >= 1 ? 0 : (step >= 0.1 ? 1 : (step >= 0.01 ? 2 : 3));
    const show = () => {
        const v = Number.isFinite(tuning[key]) ? tuning[key] : min;
        if (document.activeElement !== number) number.value = Number(v).toFixed(digits);
        range.value = Math.min(max, Math.max(min, v));
        const changed = Number.isFinite(tuningBase[key]) && Math.abs(tuningBase[key] - v) > 1e-9;
        line.classList.toggle("changed", changed);
        reset.style.visibility = changed ? "" : "hidden";
    };
    const set = (v) => { tuning[key] = v; show(); onChange(); };
    range.addEventListener("input", () => set(parseFloat(range.value)));
    number.addEventListener("change", () => { const v = parseFloat(number.value); if (Number.isFinite(v)) set(Math.min(max * 2, Math.max(min < 0 ? min * 2 : min / 2, v))); else show(); });
    reset.addEventListener("click", () => { if (Number.isFinite(tuningBase[key])) set(tuningBase[key]); });
    show();
    return wrap;
}

// where a group of the tuning table lives: in the card of what it is about (the table is the one of the game's tuning menu, CarTuning.js)
const TUNING_HOMES = { "Chassis": "Chassis", "Brakes": "Chassis", "Aerodynamics and steering": "Chassis", "Size and steering wheel": "Chassis", "Tyres": "Wheels", "Fuel": "Engine", "Engine": "Engine",
    "Transmission": "Drivetrain", "Suspension and driveline": "Suspension and driveline", "Systems and extras": "Assists and extras" };
function cardBodyOf(name) {
    const card = [...document.querySelectorAll("#side details.card")].find((c) => c.querySelector("summary").firstChild.textContent.trim() === name);
    return card ? card.querySelector(".body") : $("tuningFields");
}
function renderTuningCard() {
    // (the groups are built again: the old ones go first)
    document.querySelectorAll("#side details.tuneGroup").forEach((g) => g.remove());
    OpenRacer.CarTuning.GROUPS.forEach((group) => {
        const items = group.items.filter((item) => TUNING_KEYS.includes(item[0]));
        if (!items.length) return;
        const details = document.createElement("details");
        details.className = "tuneGroup";
        details.open = false;
        const summary = document.createElement("summary");
        // (a group called as its card: "Engine" in the Engine card)
        summary.textContent = TUNING_HOMES[group.name] === group.name ? group.name + " settings" : group.name;
        details.appendChild(summary);
        if (group.name === "Tyres") {
            // the kind of tyre: a choice, not a number; it changes the grip, the working temperature, the wear and where the rubber smokes
            const wrap = document.createElement("div");
            wrap.className = "tuneItem";
            const line = document.createElement("div");
            line.className = "tuneLine";
            const text = document.createElement("span");
            text.className = "tuneLabel";
            text.textContent = "Tyre compound (grip, working temperature, wear, smoke)";
            const select = document.createElement("select");
            select.id = "tune_compound";
            OpenRacer.TyreCompounds.forEach((k) => { const o = document.createElement("option"); o.value = k.id; o.textContent = k.name; select.appendChild(o); });
            select.value = tuning.compound || "road";
            select.addEventListener("change", () => { tuning.compound = select.value; tuningChanged(); });
            line.appendChild(text); line.appendChild(select);
            wrap.appendChild(line);
            details.appendChild(wrap);
        }
        // (the settings of the tyre on top of its kind: folded away in a part of their own)
        const fineKeys = group.name === "Tyres" ? OpenRacer.CarTuning.TYRE_FINE : [];
        const fine = document.createElement("details");
        fine.className = "inner";
        fine.innerHTML = "<summary title='The kind of tyre sets most of these: change them only to move away from it'>Fine-tune the tyre (on top of the kind)</summary>";
        if (group.name === "Chassis") details.appendChild(paintSection());
        items.forEach((item) => { if (item[4] > item[3] && !PAINT_KEYS.includes(item[0])) (fineKeys.includes(item[0]) ? fine : details).appendChild(tuneSlider(item, tuningChanged)); });
        if (fine.children.length > 1) details.appendChild(fine);
        if (group.name === "Tyres") {
            // a hard hit can puncture a tyre: a tick, as the tuning menu has it
            const line = document.createElement("label");
            line.className = "check";
            const tick = document.createElement("input");
            tick.type = "checkbox"; tick.id = "tune_tyre_damage"; tick.checked = tuning.tyre_damage === "on";
            tick.addEventListener("change", () => { tuning.tyre_damage = tick.checked ? "on" : "off"; tuningChanged(); });
            line.appendChild(tick); line.appendChild(document.createTextNode(" Tyre damage (a hard hit can puncture a tyre)"));
            details.appendChild(line);
        }
        cardBodyOf(TUNING_HOMES[group.name] || "Chassis").appendChild(details);
    });
    // the systems and the extras: a tick each, with their settings below it while it is ticked
    const features = document.createElement("details");
    features.className = "tuneGroup";
    features.innerHTML = "<summary>Systems and extras</summary>";
    OpenRacer.CarTuning.FEATURES.forEach((feature) => {
        const wrap = document.createElement("div");
        wrap.dataset.tuneFeature = feature.key;
        wrap.className = "tuneFeature";
        const line = document.createElement("label");
        line.className = "check";
        const tick = document.createElement("input");
        tick.type = "checkbox"; tick.id = "tune_" + feature.key + "_on"; tick.checked = tuning[feature.key + "_on"] !== false;
        line.appendChild(tick); line.appendChild(document.createTextNode(" " + feature.label));
        wrap.appendChild(line);
        const inner = document.createElement("div");
        inner.className = "tuneInner";
        inner.style.display = tick.checked ? "" : "none";
        tick.addEventListener("change", () => { tuning[feature.key + "_on"] = tick.checked; inner.style.display = tick.checked ? "" : "none"; tuningChanged(); });
        feature.items.forEach((item) => {
            const [key, label, unit, min, max] = item;
            if (max > min) { inner.appendChild(tuneSlider(item, tuningChanged)); return; }
            const w = document.createElement("div");
            w.className = "tuneItem";
            const l = document.createElement("div");
            l.className = "tuneLine";
            const t = document.createElement("span");
            t.className = "tuneLabel";
            t.textContent = label + (unit ? " (" + unit + ")" : "");
            const sel = document.createElement("select");
            (key === "antilag_mode" ? [["lift", "After lifting off the throttle"], ["launch", "Only with the two-step, the transbrake or the launch control"]] : []).forEach(([v, tx]) => { const o = document.createElement("option"); o.value = v; o.textContent = tx; sel.appendChild(o); });
            sel.value = tuning[key];
            sel.addEventListener("change", () => { tuning[key] = sel.value; tuningChanged(); });
            l.appendChild(t); l.appendChild(sel);
            w.appendChild(l);
            inner.appendChild(w);
        });
        wrap.appendChild(inner);
        features.appendChild(wrap);
    });
    cardBodyOf("Assists and extras").appendChild(features);
    features.open = true;
    features.querySelector("summary").style.display = "none";
    syncTuningVisibility();
    renderSetups();
}

// ---- the setups of the car (OpenRacer.Setups, shared with the tuning menu of the game): named tunings kept in this browser; a setup holds all the values of the table
// (the form's and the card's), loading one fills the form and the card with them
function renderSetups() {
    const id = $("id").value.trim(), select = $("setupSelect");
    const names = id && OpenRacer.Setups ? OpenRacer.Setups.names(id) : [];
    select.innerHTML = "";
    [["", "Default (the car as made)"]].concat(names.map((n) => [n, n])).forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; select.appendChild(o); });
    const active = id && OpenRacer.Setups ? OpenRacer.Setups.active(id) : null;
    select.value = active && names.includes(active) ? active : "";
    select.disabled = !id;
    updateTuneButtons();
}
// the Save button writes to what the list says: the car (car.json) or the tune that is chosen; a tune can be deleted
function updateTuneButtons() {
    const name = $("setupSelect").value;
    $("save").textContent = name ? "Save tune" : "Save the car";
    $("save").title = name ? "Overwrite the tune " + name + " with the car as the form has it (car.json is not written)" : "Save the car (car.json)";
    $("setupDelete").style.display = name ? "" : "none";
    $("saveTo").textContent = name ? "Save writes to the tune " + name : "Save writes car.json";
}
// the car as the form has it, kept as a tune under a name (buildConfig: the chassis, the tyres, the engine, the gearbox, the suspension and the parts, the driver, the soft body,
// the cameras, the sound, the exhaust, the rims and the tyres), with the colours of the materials and a picture of the view; the model stays the car's own
function saveTune(id, name) {
    const config = buildConfig(id);
    if (state.overrides && Object.keys(state.overrides).length) config.materials = JSON.parse(JSON.stringify(state.overrides));
    delete config.model;
    // the driver: the form gives no file (save() writes it with the car); the tune takes the file the car has, a driver that is not saved with the car yet cannot be in a tune
    if (config.driver) {
        const kept = (driverEditor && driverEditor.existingFile()) || (state.existingCar && state.existingCar.driver && state.existingCar.driver.file) || "";
        if (kept) config.driver.file = kept; else delete config.driver;
    }
    if (OpenRacer.Setups.save(id, name, config) === false) throw new Error("the storage of this browser is full (clear site data of this page, or export the tune as a file)");            // (the main menu draws the picture of the tune itself)
    renderSetups();
}
$("setupSelect").addEventListener("change", () => {
    const id = $("id").value.trim(), name = $("setupSelect").value;
    if (!id) return;
    OpenRacer.Setups.setActive(id, name || null);
    try {
        const base = state.existingCar && state.existingCar.id === id ? state.existingCar : null;
        let config;
        if (!name) {
            if (!base) { status("Default is not here: this car is not saved yet."); return; }
            config = JSON.parse(JSON.stringify(base));
        } else {
            const saved = OpenRacer.Setups.configOf(id, name, base || buildConfig(id));
            if (!saved) return;
            config = Object.assign({}, base || {}, saved, { id, model: base ? base.model : saved.model });
            if (config.driver && !config.driver.file && base && base.driver && base.driver.file) config.driver = Object.assign({}, config.driver, { file: base.driver.file });
            if (config.softbody && config.softbody.layout && !isFinite(config.softbody.layout_cg) && base && base.chassis) config.softbody = Object.assign({}, config.softbody, { layout_cg: base.chassis.cg_height, layout_radius: base.chassis.tire_diameter / 2 });      // (a layout drawn for the car as made)
        }
        fill(config);
        if (bench.vehicle) restartBench();              // (the car on the bench is built again from the tune, a metre up)                       // the whole form, the cards of the suspension, the driver and the soft body, and the Tuning card (which lists the setups again)
        if (config.materials) { state.overrides = JSON.parse(JSON.stringify(config.materials)); Object.keys(state.overrides).forEach((n) => applyOverrides(n)); }
        formChanged(); tuningChanged();
        $("setupSelect").value = name;      // (fill lists the tunes again)
        updateTuneButtons(); setDirty(false);
        status(name ? "Tune " + name + " is in the form." : "Default, the car as made, is in the form.");
    } catch (error) { status("Could not load the tune: " + error.message); }
});
$("setupSave").addEventListener("click", () => {
    const id = $("id").value.trim();
    if (!id) { status("Give the car an id first."); return; }
    let name = window.prompt("The name of the new tune", "");
    if (name === null) return;
    name = name.trim().slice(0, 40);
    if (!name) return;
    try { saveTune(id, name); status("Tune " + name + " saved; the main menu asks which tune to drive."); }
    catch (error) { status("Could not save the tune: " + error.message); }
});
// a tune as a file, to share: Export (the tune that is chosen, or the car as the form has it), Import (a file becomes a tune of this car and goes into the form)
$("tuneExport").addEventListener("click", () => {
    const id = $("id").value.trim(), name = $("setupSelect").value;
    if (!id) { status("Give the car an id first."); return; }
    try {
        const config = name ? OpenRacer.Setups.get(id, name) : (() => { const c = buildConfig(id); if (state.overrides && Object.keys(state.overrides).length) c.materials = JSON.parse(JSON.stringify(state.overrides)); return c; })();
        if (!config) { status("The tune is not here any more."); return; }
        OpenRacer.Setups.exportFile(id, name || ($("name").value.trim() || id) + " as in the editor", config);
        status("Tune " + (name || "as in the editor") + " saved as a file (in your downloads).", "ok");
    } catch (error) { status("Could not export the tune: " + error.message, "error"); }
});
$("tuneImport").addEventListener("click", () => $("tuneImportFile").click());
$("tuneImportFile").addEventListener("change", async () => {
    const file = $("tuneImportFile").files && $("tuneImportFile").files[0];
    $("tuneImportFile").value = "";
    const id = $("id").value.trim();
    if (!file || !id) { if (!id) status("Give the car an id first."); return; }
    const tune = OpenRacer.Setups.parseFile(await file.text());
    if (tune instanceof Error) { status(tune.message, "error"); return; }
    let name = window.prompt("The name of this tune" + (tune.car && tune.car !== id ? " (it was made for " + tune.car + ")" : ""), tune.name);
    if (name === null) return;
    name = name.trim().slice(0, 40) || tune.name;
    OpenRacer.Setups.save(id, name, tune.config);
    renderSetups();
    $("setupSelect").value = name;
    $("setupSelect").dispatchEvent(new Event("change"));
    status("Tune " + name + " imported and loaded into the form" + (tune.car && tune.car !== id ? " (it was made for " + tune.car + ": mind the wheels and the parts)" : "") + ".", "ok");
});
$("setupDelete").addEventListener("click", () => {
    const id = $("id").value.trim(), name = $("setupSelect").value;
    if (!id || !name) return;
    if (!window.confirm("Delete the tune " + name + "?")) return;
    OpenRacer.Setups.remove(id, name);
    renderSetups();
    status("Tune " + name + " deleted.");
});

// the settings that cannot do anything with the others as they are (the gearbox, the differential, the drive, the turbo) are hidden, as in the tuning menu of the game (CarTuning.visible)
function syncTuningVisibility() {
    const v = Object.assign({}, tuning, { drive: $("drive").value, diff: $("diff").value, center_diff: $("centerDiff").value, gearbox: $("gearbox").value },
        { rim_front: $("libRimFront").value, tyre_front: $("libTyreFront").value, rim_rear: $("libRimRear").value, tyre_rear: $("libTyreRear").value });
    document.querySelectorAll("#tuningBox [data-tune-key], #tuningCard [data-tune-key], [data-tune-key]").forEach((cell) => { cell.style.display = OpenRacer.CarTuning.visible(cell.dataset.tuneKey, v) ? "" : "none"; });
    document.querySelectorAll("[data-tune-key]").forEach((cell) => { const row = cell.parentNode; if (row && row.classList.contains("row")) row.style.display = [...row.children].some((c) => c.style.display !== "none") ? "" : "none"; });
    document.querySelectorAll("[data-tune-feature]").forEach((wrap) => { wrap.style.display = OpenRacer.CarTuning.visibleFeature(wrap.dataset.tuneFeature, v) ? "" : "none"; });
}
["drive", "diff", "centerDiff", "gearbox"].forEach((id) => $(id).addEventListener("change", () => syncTuningVisibility()));

// a change goes to the car of the test bench at once
let librarySig = "", libraryBenchTimer = 0;
function tuningChanged() {
    syncTuningVisibility();
    applyPaint();
    // (the tyre of a rim of the library follows the width, the diameter, the sidewall and the rubber at once)
    const sig = JSON.stringify(libraryChoice());
    if (sig !== librarySig) {
        librarySig = sig; updateLibraryPreview();
        // (the shell of the bench is made from the tyre when the car is built: the car of the bench is built again when the sliders rest)
        clearTimeout(libraryBenchTimer); libraryBenchTimer = setTimeout(() => { if (bench.vehicle) restartBench(); }, 500);
    }
    if (!bench.vehicle || !bench.config) return;
    try {
        const config = OpenRacer.CarTuning.toConfig(bench.config, tuningValues(bench.config));
        const area = config.dimensions.width * config.dimensions.height * 0.85;
        bench.vehicle.retune(OpenRacer.CarTuning.toRetune(OpenRacer.CarTuning.fromConfig(config), area, 1.29));
    } catch (error) { console.warn(error); }
}

// the form of the car (mass, weight on the front, centre of gravity, size of the wheels and the axles, drag) goes to the car of the bench at
// once too, as the Tuning card does: before, only a new test showed it
function formChanged() {
    if (!bench.vehicle || !bench.model) return;
    try {
        const config = buildConfig("test");
        const area = config.dimensions.width * config.dimensions.height * 0.85;
        const retune = OpenRacer.CarTuning.toRetune(tuningValues(config), area, 1.29);
        // the wheels of the model give the wheelbase, the tracks and the tyre (startBench); without them the form does
        if (!bench.model.measured) Object.assign(retune, { wheelbase: config.chassis.wheelbase, front_track: config.chassis.front_track, rear_track: config.chassis.rear_track, tire_diameter: config.chassis.tire_diameter });
        bench.vehicle.retune(retune);
    } catch (error) { /* a field that is empty or not valid yet: the next change tries again */ }
}
for (const id of ["mass", "front", "cgHeight", "wheelbase", "frontTrack", "rearTrack", "tyre", "drag", "steer"]) $(id).addEventListener("input", formChanged);
// the fields of the gearbox that is chosen
function syncGearboxBoxes() { const g = $("gearbox").value; $("cvtBox").style.visibility = g === "cvt" ? "" : "hidden"; $("tcBox").style.display = g === "torque-converter" ? "" : "none"; }
$("gearbox").addEventListener("change", () => { syncGearboxBoxes(); formChanged(); });
for (const id of ["cvtRpm", "tcStall", "tcRatio"]) $(id).addEventListener("input", formChanged);
$("tcLockup").addEventListener("change", formChanged);

// all the values of the table for a configuration from the form: the form's own, with the card's on top
function tuningValues(config) {
    const values = OpenRacer.CarTuning.fromConfig(config);
    TUNING_KEYS.forEach((k) => { if (Number.isFinite(tuning[k])) values[k] = tuning[k]; });
    if (tuning.compound) values.compound = tuning.compound;
    if (tuning.tyre_damage !== undefined) values.tyre_damage = tuning.tyre_damage;
    PAINT_WORDS.forEach((k) => { if (tuning[k] !== undefined) values[k] = tuning[k]; });
    return values;
}

// ---- the test bench: the car on the floor of the editor with the physics of the game (Vehicle.js), to see the suspension work.
// "Drop car" lets it fall from a height, The model is built the way the game
// builds it (CarLoader.js: the wheels taken out, the suspension rig found), from the model and the settings as they are now.
window.THREE = Object.assign({}, THREE, { GLTFLoader });
const PHYSICS_SCRIPTS = ["Engine.js", "Wheel.js", "TyreShell.js", "Vehicle.js", "Opponent.js", "SuspensionRig.js", "PartsLibrary.js", "Chain.js", "CarLoader.js", "Ground.js", "CollisionProxy.js", "SoftBody.js", "SoftBodyMesh.js", "Parts.js"];
let physicsLoading = null;
function loadPhysics() {
    if (!physicsLoading) {
        physicsLoading = PHYSICS_SCRIPTS.reduce((chain, file) => chain.then(() => new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = "../js/" + file;
            script.onload = resolve;
            script.onerror = () => reject(new Error("Could not load " + file));
            document.head.appendChild(script);
        })), Promise.resolve()).then(() => { if (OpenRacer.PartsLibrary) OpenRacer.PartsLibrary.base = "../"; });          // (the parts of the car are in web/parts, one folder up from the editor)
    }
    return physicsLoading;
}
const bench = { vehicle: null, model: null, body: null, objects: [], last: 0, modelMid: null, grip: 1, gripBoost: 3 };      // grip: a factor on the grip of the road (1, but the crash test sets gripBoost for its run)
let flatRoad = null;                                     // the road of the bench: flat, at the height of the grid, with the triangles the tyre needs (OpenRacer.FlatGround, Ground.js)
const roadGrip = () => ({ static: 1.2 * bench.grip, kinetic: 1.06 * bench.grip });

async function startBench() {
    if (!state.root) throw new Error("Load a model first.");
    if (wheelMode() !== "model" && !($("libRimFront").value && $("libRimRear").value)) throw new Error("The test needs the wheels of the model, or a rim of the wheel library on both axles: select the parts of every wheel.");
    await loadPhysics();
    const config = buildConfig("test");
    config.id = "test";
    config.model = { type: "gltf", file: "", rotation_y: num("rotation") || 0, scale: num("scale") > 0 ? num("scale") : 1, offset: [num("offsetX") || 0, num("offsetY") || 0, num("offsetZ") || 0] };
    config.materials = state.overrides;
    bench.starting = true;                                  // a new test is not a stop: the camera stays where the user has put it
    stopBench();
    bench.starting = false;
    const model = await new Promise((resolve, reject) => OpenRacer.loadCarModel(config, resolve, (message) => reject(new Error(message)), state.root));
    // the parking lock holds the wheels; not the brake pedal: a car that stands on its brakes is held still by the physics (its speed
    // is set to zero when it is nearly still)
    const input = { throttle: 0, brakePedal: 0, clutch: 0, clutchPedalPresent: false, handbrake: false, turnAngle: 0, neutral: true, reverse: false, manualGearbox: false, current_gear: 0, parkingLock: true };
    const v = new OpenRacer.Vehicle(OpenRacer.vehicleParams(config, roadGrip), input);
    if (!flatRoad) flatRoad = new OpenRacer.FlatGround(grid.position.y, "road"); else flatRoad.setHeight(grid.position.y);
    v.ground = flatRoad;
    if (v.controller) v.controller.noFoot = true;     // (a motorcycle: upright on the bench, not resting on the foot of the rider as at a standstill in the game)
    bench.modelMid = null;
    if (model.measured) {
        // the physics takes the wheelbase, the tracks and the tyre from the wheels of the model, as the game does
        const c = model.measured.centres;
        // (a motorcycle has no track: the physics gets 4 cm, as in the game; a track of 0 is a division by zero in the physics and the bench blew up with it)
        const minTrack = isBike() ? 0.04 : 0;
        v.retune({ wheelbase: (c.FR.z + c.FL.z) / 2 - (c.RL.z + c.RR.z) / 2, front_track: Math.max(minTrack, Math.abs(c.FR.x - c.FL.x)), rear_track: Math.max(minTrack, Math.abs(c.RR.x - c.RL.x)), tire_diameter: model.measured.diameter });
        bench.modelMid = new THREE.Vector3((c.FR.x + c.FL.x + c.RL.x + c.RR.x) / 4, (c.FR.y + c.FL.y + c.RL.y + c.RR.y) / 4, (c.FR.z + c.FL.z + c.RL.z + c.RR.z) / 4);
    }
    v.reset(0, 0, Math.PI / 2); // facing +z, the way the editor shows the car
    bench.body = new THREE.Object3D();
    bench.body.add(model.tilt);
    scene.add(bench.body);
    model.wheels.forEach((w) => scene.add(w));
    bench.objects = [bench.body, ...model.wheels];
    // the shell and the parts of the car, as the game makes them when it has loaded the model (CollisionProxy.js)
    bench.obj = { vehicle: v, wheels: v.wheels, config, bodyLift: null };
    try { OpenRacer.CollisionProxy.apply(bench.obj, model, bench.modelMid); } catch (e) { console.warn("soft body: " + e.message); }
    if (OpenRacer.setForkGeometry) OpenRacer.setForkGeometry(v, model, config);
    bench.vehicle = v; bench.model = model; bench.input = input; bench.config = config; bench.script = null; bench.last = performance.now();
    syncBenchVisibility();
    if (driverEditor) driverEditor.attachToBench(model.tilt);       // the driver goes with the car that is tested
    pivot.visible = false; helpers.visible = false; libPreview.visible = false;          // (the bench builds the car as the game does, with its own library wheels)
    if (suspensionEditor) suspensionEditor.hide(true);
    $("testStop").style.display = "";
    status("Test: the car with the physics of the game" + (model.rig ? ", " + model.rig.count + " moving parts of the suspension" : "") + ". Stop test goes back to the model.", "ok");
    return v;
}

// the test shows a copy of the model: the eyes of the Parts list (state.nodes) are followed by name
function syncBenchVisibility() {
    if (!bench.objects.length) return;
    const hidden = new Map(state.nodes.map((n) => [n.name, n.object.visible]));
    bench.objects.forEach((root) => root.traverse((o) => { if (o.name && hidden.has(o.name)) o.visible = hidden.get(o.name); }));
}

function stopBench() {
    if (bench.obj && bench.obj.parts && bench.obj.parts.dispose) bench.obj.parts.dispose();   // a door that was thrown off does not stay on the floor
    if (driverEditor) driverEditor.detachFromBench();
    bench.objects.forEach((o) => scene.remove(o));
    if (bench.script && preview.playing) stopPreview();
    if (bench.driving) stopDriving();
    bench.objects = []; bench.vehicle = null; bench.model = null; bench.script = null; bench.obj = null; bench.grip = 1;
    if (softBodyEditor) softBodyEditor.onStop();
    pivot.visible = true; helpers.visible = true; libPreview.visible = true;
    if (suspensionEditor) suspensionEditor.hide(false);
    $("testStop").style.display = "none";
}

const benchPose = { x: 0, y: 0, z: 0 }, benchQuat = { x: 0, y: 0, z: 0, w: 1 }, benchUp = new THREE.Vector3();
// ---- the nodes of the tyres (TyreShell.js) over the car of the bench while a tyre setting is being changed: the outer shell (green where a node holds the road, red where it
// slides, teal in the air), the rim (white), the beams between them coloured by their strain and the belt (teal), as the debug view of the game (DebugView.js, the 0 key).
// They appear when a tyre setting (the Tyres group of the Tuning card, the pressures too) gets the focus or is moved, and go when another input gets the focus.
const TYRE_DEBUG_KEYS = new Set(["tyre_diameter_front", "tyre_diameter_rear", "tyre_height_front", "tyre_height_rear", "tyre_width", "tyre_width_rear", "tyre_rings", "tyre_segments", "tyre_inner_ratio", "tyre_carcass", "tyre_stiff_x", "tyre_stiff_y", "pressure_front", "pressure_rear"]);
const tyreDebug = { group: null, points: null, lines: null, on: false };
function tyreDebugLayer(kind) {
    const geometry = new THREE.BufferGeometry();
    const material = kind === "points" ? new THREE.PointsMaterial({ size: 6, sizeAttenuation: false, vertexColors: true, depthTest: false, transparent: true })
        : new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.85 });
    const object = kind === "points" ? new THREE.Points(geometry, material) : new THREE.LineSegments(geometry, material);
    object.frustumCulled = false; object.renderOrder = 1000;
    tyreDebug.group.add(object);
    return { object, pos: [], col: [] };
}
function showTyreDebug(on) {
    if (on === tyreDebug.on) return;
    tyreDebug.on = on;
    if (!tyreDebug.group) {
        tyreDebug.group = new THREE.Group();
        scene.add(tyreDebug.group);
        tyreDebug.points = tyreDebugLayer("points");
        tyreDebug.lines = tyreDebugLayer("lines");
    }
    tyreDebug.group.visible = on;
    if (on && !bench.vehicle) startBench().catch((error) => status(error.message, "error"));      // (the nodes are those of the car on the bench)
}
function updateTyreDebug(v) {
    if (!tyreDebug.on || !tyreDebug.group) return;
    const GREEN = [0.3, 1, 0.4], RED = [1, 0.25, 0.2], TEAL = [0.3, 0.8, 0.8], WHITE = [1, 1, 1], DIM = [0.35, 0.4, 0.45];
    const L = tyreDebug.lines, P = tyreDebug.points;
    const push = (l, x, y, z, c) => { l.pos.push(x, y, z); l.col.push(c[0], c[1], c[2]); };
    const seg = (ax, ay, az, bx, by, bz, c) => { push(L, ax, ay, az, c); push(L, bx, by, bz, c); };
    for (let i = 0; i < 4; i++) {
        const tbody = v.wheels[i].tyreBody;
        if (!tbody || !tbody.shells || !v.wheels[i].cylActive) continue;
        const sh = tbody.shells();
        for (let k = 0; k < sh.beams; k++) {
            const ba = sh.a[k], bb = sh.b[k], inner = bb >= sh.count, cls = sh.bclass[k];
            const ex = sh.ox[ba], ey = sh.oy[ba], ez = sh.oz[ba];
            const fx = inner ? sh.ix[bb - sh.count] : sh.ox[bb], fy = inner ? sh.iy[bb - sh.count] : sh.oy[bb], fz = inner ? sh.iz[bb - sh.count] : sh.oz[bb];
            const strain = sh.strain[k], tt = Math.max(-1, Math.min(1, strain / 0.12));
            const colour = tt >= 0 ? [DIM[0] * (1 - tt) + 0.2 * tt, DIM[1] * (1 - tt) + 0.9 * tt, DIM[2] * (1 - tt) + 1 * tt] : [DIM[0] * (1 + tt) + 1 * -tt, DIM[1] * (1 + tt) + 0.2 * -tt, DIM[2] * (1 + tt) + 0.2 * -tt];
            if (cls === 0 && (k % 2 === 0 || Math.abs(strain) > 0.02)) seg(ex, ey, ez, fx, fy, fz, colour);
            else if (cls === 3 || cls === 4) seg(ex, ey, ez, fx, fy, fz, TEAL);
        }
        for (let k = 0; k < sh.count; k++) {
            push(P, sh.ox[k], sh.oy[k], sh.oz[k], sh.contact[k] ? (sh.sliding[k] ? RED : GREEN) : TEAL);
            if (k % 2 === 0) push(P, sh.ix[k], sh.iy[k], sh.iz[k], WHITE);
        }
    }
    [L, P].forEach((l) => {
        const g = l.object.geometry;
        g.setAttribute("position", new THREE.Float32BufferAttribute(l.pos, 3));
        g.setAttribute("color", new THREE.Float32BufferAttribute(l.col, 3));
        g.computeBoundingSphere();
        l.pos.length = 0; l.col.length = 0;
    });
}
// a tyre setting in use shows the nodes; the focus on any other input hides them
function tyreDebugInput(target) { const item = target && target.closest ? target.closest(".tuneItem") : null; return !!(item && TYRE_DEBUG_KEYS.has(item.dataset.tuneKey)); }
document.addEventListener("focusin", (e) => { showTyreDebug(tyreDebugInput(e.target)); });
document.addEventListener("pointerdown", (e) => { if (tyreDebugInput(e.target)) showTyreDebug(true); }, true);
document.addEventListener("input", (e) => { if (tyreDebugInput(e.target)) showTyreDebug(true); }, true);

function benchFrame(now) {
    const v = bench.vehicle;
    if (!v) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - bench.last) / 1000));
    bench.last = now;
    if (bench.script) runScript(dt);
    if (!bench.vehicle) return;                       // the script has ended the test
    if (bench.driving) driveFrame(dt);
    v.update(dt);
    // the shell is being edited: the car is held where it is (something that pushes it, a tune that rolls, would take the nodes away from under the pointer); the shell itself goes on
    if (softBodyEditor && softBodyEditor.holding && softBodyEditor.holding()) {
        if (!bench.held) bench.held = { px: v.px, py: v.py, pz: v.pz, qx: v.qx, qy: v.qy, qz: v.qz, qw: v.qw };
        v.px = bench.held.px; v.py = bench.held.py; v.pz = bench.held.pz; v.qx = bench.held.qx; v.qy = bench.held.qy; v.qz = bench.held.qz; v.qw = bench.held.qw;
        v.vx = v.vy = v.vz = 0; v.wx = v.wy = v.wz = 0;
    } else bench.held = null;
    v.getBodyPose(benchPose, benchQuat);
    const body = bench.body;
    body.quaternion.set(benchQuat.x, benchQuat.y, benchQuat.z, benchQuat.w);
    if (bench.modelMid) {
        benchUp.copy(bench.modelMid).applyQuaternion(body.quaternion);
        body.position.set(benchPose.x - benchUp.x, benchPose.y - benchUp.y, benchPose.z - benchUp.z);
    } else {
        benchUp.set(0, 1, 0).applyQuaternion(body.quaternion);
        const lift = ((bench.model.bodyLift || 1) - 1) * v.wheels[0].radius;
        body.position.set(benchPose.x + benchUp.x * lift, benchPose.y + benchUp.y * lift, benchPose.z + benchUp.z * lift);
    }
    bench.model.wheels.forEach((object, i) => {
        const w = v.wheels[i];
        object.position.set(w.center.x, w.center.y, w.center.z);
        if (v.soloWheels) object.position.add(new THREE.Vector3(w.b, 0, 0).applyQuaternion(body.quaternion));     // (a motorcycle: the wheel of the model is drawn in the middle, not 2 cm aside as the physics has it)
        object.quaternion.copy(body.quaternion);
        if (object.children[0]) {
            // the wheel as the physics has it: its steer with the toe and the Ackermann (steerNow), its lean with the camber and the roll (lean), and a bent wheel aside
            object.children[0].rotation.y = -(w.steerNow !== undefined ? w.steerNow : (i < 2 ? v.steerApplied : 0)) - (w.toeBend || 0);
            object.children[0].rotation.z = w.lean !== undefined ? -w.lean : (w.camberBend || 0);
            if (object.children[0].children[0]) object.children[0].children[0].rotation.x = w.spin;
        }
        // a motorcycle: the front wheel along the fork, the rear wheel on the swingarm (as in the game)
        // (the wheel of the physics has no object of the model: updateFork and updateSwingarm get the object and the travel of this wheel)
        const drawn = { object, restLengthWheel: w.restLengthWheel, susLength: w.susLength, toeBend: w.toeBend };
        if (bench.model.head && i === 0) OpenRacer.updateFork(bench.model.head, drawn, body, v.steerApplied);
        if (bench.model.swingarm && i === 2) OpenRacer.updateSwingarm(bench.model.swingarm, drawn, body);
        if (bench.model.chain && i === 2) OpenRacer.Chain.update(bench.model.chain, w.spin);
    });
    updateTyreDebug(v);
    if (bench.model.rig) bench.model.rig.update(v);
    if (softBodyEditor) softBodyEditor.frame(dt);
    if (bench.driving) followCar(v);
}

function placeForDrop(v, height, tiltDegrees) {
        v.reset(0, 0, Math.PI / 2);
        v.py += height;
        // tilted, so that it does not land on all four wheels at once: rolled to the left by the angle, and a little nose down
        const tilt = tiltDegrees * Math.PI / 180;
        if (tilt > 0) {
            const q = new THREE.Quaternion(v.qx, v.qy, v.qz, v.qw);
            const roll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), tilt);        // about the car's forward axis
            const pitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt * 0.35); // about the car's left axis
            q.multiply(roll).multiply(pitch);
            v.qx = q.x; v.qy = q.y; v.qz = q.z; v.qw = q.w;
            v.py += Math.sin(tilt) * (v.front_track || 1.5) / 2; // the low wheel is not pushed into the floor
        }
}

async function dropCar() {
    try {
        const v = bench.vehicle || await startBench();
        placeForDrop(v, parseFloat($("testDropHeight").value), parseFloat($("testTilt").value));
        bench.script = null;
    } catch (error) { status(error.message, "error"); }
}

// The full test, one thing after the other: a drop from 1 m at 5 degrees; two seconds later the engine in neutral to the rev
// limiter and a second on it; a metre forwards and a metre back; the steering to the left lock and to the right lock; and at the end a
// wall far ahead, and full throttle into it (that is its own, and not the crash test of the Soft body card).
async function fullTest() {
    try {
        const v = bench.vehicle || await startBench();
        placeForDrop(v, 1, 5);
        bench.script = { stage: "drop", t: 0, limiterT: 0, brake: 0 };
        status("Full test: the drop…", "ok");
        if (!preview.playing) await playSound(); // the engine sound follows the engine of the bench during the test
    } catch (error) { status(error.message, "error"); }
}

function runScript(dt) {
    const sc = bench.script, v = bench.vehicle, inp = bench.input;
    if (!sc || !v) return;
    sc.t += dt;
    const lock = (bench.config && bench.config.chassis.max_steer_deg || 30) * Math.PI / 180;
    const next = (stage, message) => { sc.stage = stage; sc.t = 0; sc.brake = 0; if (message) status("Full test: " + message, "ok"); };
    const settle = () => { inp.throttle = 0; inp.brakePedal = 0; inp.neutral = true; inp.parkingLock = true; inp.reverse = false; inp.turnAngle = 0; };
    // a gentle stop: the brake comes on over half a second, to a third, and holds
    const brakeGently = () => { sc.brake = Math.min(0.35, sc.brake + dt * 0.7); inp.throttle = 0; inp.brakePedal = sc.brake; };
    // the engine sound follows the engine of the bench
    if (preview.playing) {
        $("soundRpm").value = Math.round(v.engine.getRPM()); $("soundThrottle").value = Math.round(inp.throttle * 100);
        soundSliders();
    }
    switch (sc.stage) {
        case "drop":
            settle();
            if (sc.t > 2) next("rev", "the engine to the rev limiter in neutral");
            break;
        case "rev": {
            // the throttle open until the engine is at the limiter, a second on it, then the throttle shut and a moment for it to fall
            inp.neutral = true; inp.parkingLock = true;
            const rpm = v.engine.getRPM();
            if (rpm >= v.engine.limiterRPM - 250) sc.limiterT += dt;
            inp.throttle = sc.limiterT < 1 ? 1 : 0;
            if (sc.limiterT >= 1 && rpm < v.engine.idleRPM + 500) next("forward", "a metre forwards");
            if (sc.t > 12) next("forward", "a metre forwards");
            break;
        }
        case "forward":
            // gently away, off the throttle a little before the metre, a gentle brake to a stop
            inp.parkingLock = false; inp.neutral = false; inp.reverse = false; inp.current_gear = 0;
            if (v.z < 0.5) { inp.throttle = Math.min(0.2, sc.t * 0.2); inp.brakePedal = 0; }
            else if (v.z < 0.7) { inp.throttle = 0; inp.brakePedal = 0; }
            else { brakeGently(); if (Math.abs(v.u) < 0.03) next("pause1"); }
            if (sc.t > 10) next("pause1");
            break;
        case "pause1":
            brakeGently();
            if (sc.t > 0.8) next("back", "a metre back");
            break;
        case "back":
            inp.parkingLock = false; inp.neutral = false; inp.reverse = true;
            if (v.z > 0.55) { inp.throttle = Math.min(0.2, sc.t * 0.2); inp.brakePedal = 0; }
            else if (v.z > 0.35) { inp.throttle = 0; inp.brakePedal = 0; }
            else { brakeGently(); if (Math.abs(v.u) < 0.03) next("steer", "the steering to both locks"); }
            if (sc.t > 10) next("steer", "the steering to both locks");
            break;
        case "steer": {
            inp.throttle = 0; inp.brakePedal = 1; inp.reverse = false; inp.neutral = true; inp.parkingLock = true;
            // to the left in a second, hold, to the right in two, hold, back to the middle in one
            const t = sc.t;
            let a;
            if (t < 1) a = -t; else if (t < 1.5) a = -1; else if (t < 3.5) a = -1 + (t - 1.5); else if (t < 4) a = 1; else if (t < 5) a = 1 - (t - 4); else a = 0;
            inp.turnAngle = a * lock;
            if (t > 5.2) {
                // done: a moment with the wheels straight, then back to the model by itself
                inp.turnAngle = 0;
                if (t > 6) next("wall", "a wall ahead: full throttle");
            }
            break;
        }
        case "wall": {
            // a wall 100 m ahead, and full throttle until the car hits it and is still; the camera follows
            if (!sc.walled) { sc.walled = true; sc.hit = false; sc.still = 0; bench.grip = bench.gripBoost; softBodyEditor.addWall(v.pz + 100); }
            inp.parkingLock = false; inp.neutral = false; inp.reverse = false; inp.current_gear = 0;
            if (!sc.hit && softBodyEditor.wallHit()) sc.hit = true;
            inp.throttle = sc.hit ? 0 : 1;
            inp.brakePedal = sc.hit ? 1 : 0;                       // after the hit it is held, it does not roll back
            if (sc.hit) inp.turnAngle = 0; else softBodyEditor.steerAhead(v, inp);      // and until then it is steered at the wall
            // the camera is fixed to the car until it hits the wall, then it stays
            if (!sc.hit) {
                if (sc.last) {
                    const fx = v.px - sc.last.x, fy = v.py - sc.last.y, fz = v.pz - sc.last.z;
                    controls.target.x += fx; controls.target.y += fy; controls.target.z += fz;
                    camera.position.x += fx; camera.position.y += fy; camera.position.z += fz;
                }
                sc.last = { x: v.px, y: v.py, z: v.pz };
            }
            if (sc.hit && Math.abs(v.u) < 0.3) sc.still += dt; else sc.still = 0;
            if (sc.still > 1.5 || sc.t > 60) {
                softBodyEditor.removeWall();
                bench.script = null; if (preview.playing) stopPreview(); stopBench(); status("Full test done.", "ok");
            }
            break;
        }
    }
}

// the shake as the sliders have it (the full test uses the same, so the two shakes look the same)
$("testDrop").addEventListener("click", dropCar);
$("testFull").addEventListener("click", fullTest);
$("testStop").addEventListener("click", stopBench);
$("testDropHeight").addEventListener("input", () => { $("testDropLabel").textContent = parseFloat($("testDropHeight").value).toFixed(1) + " m"; });
$("testTilt").addEventListener("input", () => { $("testTiltLabel").textContent = $("testTilt").value + "°"; });
// the travel of the suspension: shown, and put on the car of the test bench at once
$("cgHeight").addEventListener("change", () => { if (bench.vehicle) restartBench(); });        // (the shell sits on the centre of gravity: the car on the bench is built again)
$("unsprung").addEventListener("change", () => { if (bench.vehicle) bench.vehicle.retune({ unsprung: $("unsprung").checked }); syncTuningVisibility(); });
$("travel").addEventListener("input", () => {
    $("travelLabel").textContent = $("travel").value + " cm";
    if (bench.vehicle) bench.vehicle.retune({ suspension_travel: parseFloat($("travel").value) / 100 });
});
// the tabs of the test buttons: the tests, and the crash test
document.querySelectorAll("#testBar [data-tab]").forEach((tab) => tab.addEventListener("click", () => {
    document.querySelectorAll("#testBar [data-tab]").forEach((t) => { t.classList.toggle("accent", t === tab); t.classList.toggle("ghost", t !== tab); });
    document.querySelectorAll("#testBar [data-pane]").forEach((pane) => { pane.style.display = pane.dataset.pane === tab.dataset.tab ? "" : "none"; });
}));
window.benchFrame = benchFrame; // the render loop at the top calls it from here on
window.benchState = bench; // for a look from the console
window.softBodyEditor = () => softBodyEditor;

// ---- driving on the test bench: the keyboard drives the car over the floor (arrows or WASD, space the handbrake, R back to the start)
const keys = {};
const bigGrid = new THREE.GridHelper(400, 100, 0x3e4756, 0x2a313c);
bigGrid.visible = false;
scene.add(bigGrid);
window.addEventListener("keydown", (e) => {
    if (!bench.driving || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    keys[e.code] = true;
    if (e.code === "KeyR") resetCar();
    if (e.code === "KeyX" || e.code === "KeyE" || e.code === "PageUp") shiftBench(1);
    if (e.code === "KeyZ" || e.code === "KeyQ" || e.code === "PageDown") shiftBench(-1);
    if (/^(Arrow|Space)/.test(e.code)) e.preventDefault();
});
window.addEventListener("keyup", (e) => { keys[e.code] = false; });

async function toggleDrive() {
    try {
        if (bench.driving) { stopDriving(); return; }
        const v = bench.vehicle || await startBench();
        beginDriving();
        status("Drive: arrows or WASD, space is the handbrake, R puts the car back at the start. Automatic; X/E and Z/Q shift and make it sequential.", "ok");
        if (!preview.playing) await playSound();
    } catch (error) { status(error.message, "error"); }
}
function beginDriving() {
    bench.script = null;
    bench.driving = { throttle: 0, brake: 0, turn: 0, sequential: false };
    bench.input.parkingLock = false; bench.input.neutral = false; bench.input.reverse = false; bench.input.current_gear = 0; bench.input.manualGearbox = false;
    bigGrid.visible = true; bigGrid.position.y = grid.position.y - 0.001;
    $("testDrive").textContent = "Stop driving"; $("testReset").style.display = "";
}
// the car on the bench built again from the form as it is now (another tune, other rims and tyres): where it stood, with its heading, a metre up so that a car of
// another size does not start in the floor; the drive goes on
let restarting = null;
async function restartBench() {
    if (!bench.vehicle || restarting) return;
    const old = bench.vehicle, x = old.x, z = old.z, heading = Number.isFinite(old.psi) ? old.psi : Math.PI / 2, driving = !!bench.driving;
    restarting = (async () => {
        try {
            const v = await startBench();
            v.reset(x, z, heading);
            v.py += 1;
            if (driving) { beginDriving(); if (!preview.playing) await playSound(); }        // (the stop of the old bench stopped the engine sound too)
            status("The car is built again from the form" + (driving ? ", the drive goes on" : "") + ".", "ok");
        } catch (error) { status(error.message, "error"); }
        restarting = null;
    })();
    await restarting;
}

// a shift while driving: the gearbox is automatic until the first shift, then sequential (X or E up, Z or Q down, as in the game);
// down from first at a standstill is reverse, up from reverse is first
function shiftBench(direction) {
    const d = bench.driving, inp = bench.input, v = bench.vehicle;
    if (!d || !v) return;
    const gears = bench.config.drivetrain.gear_ratios.length;
    const standing = Math.abs(v.u) < 1.5;
    if (!inp.manualGearbox) { inp.manualGearbox = true; d.sequential = true; }
    if (direction > 0) {
        if (inp.reverse) { if (standing) { inp.reverse = false; inp.current_gear = 0; } }
        else inp.current_gear = Math.min(gears - 1, inp.current_gear + 1);
    } else {
        if (inp.reverse) return;
        if (inp.current_gear > 0) inp.current_gear--;
        else if (standing) inp.reverse = true;
    }
    status("Drive, sequential: " + (inp.reverse ? "reverse" : "gear " + (inp.current_gear + 1)) + " · X/E up, Z/Q down · space handbrake · R reset", "ok");
}

function stopDriving() {
    bench.driving = null;
    bigGrid.visible = false;
    $("testDrive").textContent = "Drive"; $("testReset").style.display = "none";
    if (bench.input) { bench.input.throttle = 0; bench.input.brakePedal = 0; bench.input.turnAngle = 0; bench.input.parkingLock = true; bench.input.neutral = true; bench.input.handbrake = false; bench.input.manualGearbox = false; bench.input.reverse = false; bench.input.current_gear = 0; }
    if (preview.playing) stopPreview();
}

function resetCar() {
    const v = bench.vehicle;
    if (!v) return;
    v.reset(0, 0, Math.PI / 2);
    if (bench.driving) { bench.driving.throttle = bench.driving.brake = bench.driving.turn = 0; }
    controls.target.set(0, 0.4, 0);
    camera.position.set(-5, 3, 6);
    controls.update();
}

// the keys to the pedals and the steering, the way Car.js does it for the keyboard; the camera keeps the car in view
function driveFrame(dt) {
    const d = bench.driving, inp = bench.input, v = bench.vehicle;
    if (!d || !v) return;
    const up = keys.ArrowUp || keys.KeyW, down = keys.ArrowDown || keys.KeyS, left = keys.ArrowLeft || keys.KeyA, right = keys.ArrowRight || keys.KeyD;
    d.throttle = up ? Math.min(1, d.throttle + (1 - d.throttle) * dt * 4) : 0;
    d.brake = down ? Math.min(1, d.brake + (1 - d.brake) * dt * 6) : 0;
    // backwards: the brake key with the car at a standstill is reverse
    if (d.sequential) { inp.throttle = d.throttle; inp.brakePedal = d.brake; }   // the gears are the driver's
    else if (down && Math.abs(v.u) < 0.3 && !up) { inp.reverse = true; inp.throttle = 0.5; inp.brakePedal = 0; }
    else if (inp.reverse && down && v.u <= 0.3) { inp.throttle = d.brake * 0.6; inp.brakePedal = 0; }
    else { inp.reverse = false; inp.throttle = d.throttle; inp.brakePedal = d.brake; }
    inp.neutral = false; inp.parkingLock = false; inp.handbrake = !!keys.Space;
    const lock = (bench.config.chassis.max_steer_deg || 30) * Math.PI / 180;
    const speedFactor = Math.max(Math.abs(v.u) / 4, 1), rate = 0.6 / speedFactor;
    const dir = (right ? 1 : 0) - (left ? 1 : 0);
    if (dir === 0) d.turn *= Math.pow(0.75, dt * 60);
    else if (dir * d.turn < 0) d.turn += dir * rate * 3 * dt;
    else d.turn = Math.max(-lock, Math.min(lock, d.turn + dir * rate * dt));
    inp.turnAngle = d.turn;
    if (preview.playing) { $("soundRpm").value = Math.round(v.engine.getRPM()); $("soundThrottle").value = Math.round(inp.throttle * 100); soundSliders(); }
}
// the camera follows the car: its target is the car, and it keeps its distance (after the step of the physics, so that the car does not jump against the camera)
function followCar(v) {
    const offset = camera.position.clone().sub(controls.target);
    controls.target.set(v.x, grid.position.y + 0.6, v.z);
    camera.position.copy(controls.target).add(offset);
    controls.update();
}

$("testDrive").addEventListener("click", toggleDrive);
$("testReset").addEventListener("click", resetCar);
tuningFromCar(null); // the Tuning card for a new car

driverEditor = initDriver({
    $, THREE, scene, camera, renderer, controls, status, GLTFLoader,
    steeringPreview,
    resolve: (file) => OpenRacer.Garage.resolve(state.existingCar, "../" + file),
    setDragging: (on) => { layers.dragging = on; },
    deselectLayers: () => { if (layers.selected) selectLayer(layers.selected); },
    pickLocked: () => !!(suspensionEditor && suspensionEditor.editing)        // (Edit origins: nothing else is picked in the view)
});

suspensionEditor = initSuspension({
    $, THREE, scene, gizmo, rotGizmo, gizmoTargets, layers, selectLayer, wheelCenters,
    driveValue: () => $("drive").value,
    loadLibrary: () => loadPhysics(),
    renderLayers: () => renderLayers(),
    save: () => save(),
    status,
    // Edit origins: everything else that can be picked or marks something in the view is hidden, so that only the points are seen
    hideOthers: (on) => { cameraMarkers.visible = !on; axes.visible = !on; arrow.visible = !on; helpers.visible = !on; exhaust.forEach((e) => { e.target.visible = !on; }); if (driverEditor && driverEditor.deselect) driverEditor.deselect(); }
});
window.__carEditorView = { camera, scene, renderer, bench };          // (for the tests of the editor: where a point of the scene is on the screen)

softBodyEditor = initSoftBody({
    $, THREE, scene, camera, renderer, controls, bench, status, startBench, stopBench,
    partChosen: showChosenPart,
    driverUnder: (e) => !!(driverEditor && driverEditor.under(e)),
    hideDriver: (on) => { if (driverEditor) driverEditor.hide(on); },      // the figure is in the way of the nodes: hidden while they are edited
    nodeNames: () => state.nodes.map((n) => n.name),
    floorY: () => grid.position.y,
    root: () => state.root,
    // saves the car that is open, as the Save button does (the part panel saves after every change)
    // the helpers of the view (the cameras, the axes and the arrow of the model) are hidden while the crash test runs
    viewCenterX: () => { const r = view.getBoundingClientRect(); return r.left + r.width / 2; },
    lockView: (cx) => { viewLock = cx === null ? null : { cx }; resize(); },
    hideChrome: (on) => { cameraMarkers.visible = !on; axes.visible = !on; arrow.visible = !on; grid.visible = !on; bigGrid.visible = bigGrid.visible && !on; },
    pickLocked: () => !!(suspensionEditor && suspensionEditor.editing),
    canSave: () => !!state.existingId && !!state.root,
    save: () => save(),
    frameModel
});

// ---- quality of life: what is not saved, what is missing, Ctrl+S, the cards that stay as they were, a copy of a car
let dirty = false;
function setDirty(on) {
    dirty = on;
    if (!on) setTimeout(() => { if (!dirty) takeBaseline(); }, 400);
    for (const id of ["save", "saveDrive"]) $(id).classList.toggle("dirty", on);
    $("changes").hidden = !on || !state.existingCar;
    refreshReady();
}
$("side").addEventListener("input", (e) => { if (!e.target.closest("#setupRow, #existing, #copyCar")) setDirty(true); }, true);
window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s") { e.preventDefault(); $("save").click(); }
});

function problems() {
    const list = [];
    if (!$("name").value.trim()) list.push("Give the car a name");
    else if (!ID_PATTERN.test($("id").value.trim() || slug($("name").value))) list.push("The id may only have a-z, 0-9, - and _");
    if (!state.root && !state.existingModel) list.push("Import a model");
    else if (wheelMode() === "model" && state.root && !wheelCenters()) list.push("Pick the parts of all four wheels");
    for (const [id, label] of [["mass", "mass"], ["wheelbase", "wheelbase"], ["tyre", "tyre diameter"]]) if (!(num(id) > 0)) list.push("Fill in the " + label);
    if (!state.build) list.push("Choose an engine block");
    for (const w of modelWarnings()) list.push(w);
    return list;
}
function refreshReady() {
    const list = problems(), el = $("ready");
    el.textContent = list.length ? "⚠ " + list.length + " to fix" : "✓ Ready";
    el.title = list.join("\n") || "Nothing is missing";
    el.style.color = list.length ? "var(--warn)" : "var(--muted)";
    // a model with an object "beams" has its shell: the scan, the fill and the editing of nodes make nodes that are not used then
    const modelBeams = state.nodes.some((n) => /^(softbody|shell)?beams?$/i.test(n.name.replace(/[^a-z]/gi, "")));
    $("sbLine").textContent = modelBeams ? "Shell from the beams of the model" : "Dents, breaks, loose parts";
    for (const id of ["sbMaxNodes", "sbScan", "sbInside", "sbScanInside", "sbEdit"]) { const el = $(id); const holder = el.closest(".row > div") || el.closest("label") || el; holder.style.display = modelBeams ? "none" : ""; }
}
$("ready").addEventListener("click", () => { const list = problems(); status(list.length ? list.join(" · ") : "Nothing is missing.", list.length ? "error" : "ok"); });
setInterval(refreshReady, 1000);

// the cards that were open are open again next time (the first time: the car and the model)
{
    const cards = [...document.querySelectorAll("#side details.card")];
    const nameOf = (c) => c.querySelector("summary").firstChild.textContent.trim();
    let kept = null;
    try { kept = JSON.parse(localStorage.getItem("editor-cards") || "null"); } catch (e) { /* no storage */ }
    cards.forEach((c) => { c.open = kept ? kept.includes(nameOf(c)) : ["Car", "Model"].includes(nameOf(c)); });
    cards.forEach((c) => c.addEventListener("toggle", () => { try { localStorage.setItem("editor-cards", JSON.stringify(cards.filter((x) => x.open).map(nameOf))); } catch (e) { /* no storage */ } }));
}

$("copyCar").addEventListener("click", () => {
    if (!state.existingId) { status("Save the car first, then make a copy.", "error"); return; }
    $("name").value = ($("name").value.trim() || state.existingId) + " copy";
    $("id").value = slug($("name").value);
    state.idEdited = true;
    setDirty(true);
    status("Saving now makes a new car: " + $("id").value + ". Change the name first if you like.", "ok");
});
refreshReady();

// ---- the parts of the model that are called wrong: found when a model is loaded and listed in the ready check
var RIG_NAME = /^(susp(upperarm|lowerarm|arm|wishbone|link|trailingarm|trailing|upright|hub|knuckle|spring|damper|strut|shock|coilover|driveshaft|halfshaft|shaft)[a-z]*(fl|fr|rl|rr)|steertierod[a-z]*(fl|fr|rl|rr)|steerrack|susprack|susp(axle|panhard|watt)[a-z]*(rear|front|back)?|[a-z]*trailing[a-z]*(fl|fr|rl|rr)|(coilover|damper|shock|strut|spring)cylinder[a-z]*(fl|fr|rl|rr)|(rear|front|back)?solid[a-z]*|[a-z]*(solid|live)axle[a-z]*|axle[a-z]*)$/i;
var namesFor = null, namesFound = [];
function modelWarnings() {
    if (namesFor === state.nodes) return namesFound;
    namesFor = state.nodes;
    const out = [];
    if (state.root) pivot.updateMatrixWorld(true);
    const all = state.root ? new THREE.Box3().setFromObject(pivot) : null;
    const middle = all ? all.getCenter(new THREE.Vector3()).z : 0;
    for (const node of state.nodes) {
        const plain = node.name.replace(/[^a-z0-9]/gi, "");
        if (/trierod/i.test(plain)) out.push("“" + node.name + "”: tierod, not trierod");
        else if (/^(susp|steer(?!ing|wheel))/i.test(plain) && !RIG_NAME.test(plain)) out.push("“" + node.name + "” is not a part the suspension knows");
        if (/(fl|fr|rl|rr)\d{3}$/i.test(plain) && /^(wheel|susp|steer|brake)/i.test(plain)) out.push("“" + node.name + "” ends in .001: give it a corner (FL, FR, RL, RR)");
        const corner = /(caliper|brake)/i.test(plain) && !/disc|disk|rotor/i.test(plain) ? plain.slice(-2).toLowerCase() : "";
        if (["fl", "fr", "rl", "rr"].includes(corner)) {
            const box = new THREE.Box3().setFromObject(node.object);
            if (!box.isEmpty()) {
                const front = box.getCenter(new THREE.Vector3()).z > middle;
                if (front !== (corner[0] === "f")) out.push("“" + node.name + "” sits at the " + (front ? "front" : "rear") + " but is named for the " + (corner[0] === "f" ? "front" : "rear") + " (it would follow that wheel)");
            }
        }
    }
    namesFound = out.slice(0, 8);
    return namesFound;
}

// ---- undo: the form, the tuning card, the torque curve and the materials as they were before the last change (Ctrl or Cmd + Z; Shift for redo)
const undoStack = [], redoStack = [];
let restoring = false, lastShot = null;
const fieldList = () => [...document.querySelectorAll("#side input, #side select, #side textarea")].filter((e) => (e.id || e.name) && e.type !== "file" && !e.closest(".tuneItem, #setupRow") && !["existing", "layerSearch"].includes(e.id));
function snapshot() {
    const fields = {};
    for (const e of fieldList()) {
        const key = e.type === "radio" ? "r:" + e.name + ":" + e.value : e.id;
        fields[key] = e.type === "checkbox" || e.type === "radio" ? e.checked : (e.multiple ? [...e.selectedOptions].map((o) => o.value) : e.value);
    }
    return { fields, tuning: Object.assign({}, tuning), curve: state.curve.map((p) => p.slice()), overrides: JSON.parse(JSON.stringify(state.overrides || {})) };
}
function restore(shot) {
    restoring = true;
    try {
        for (const e of fieldList()) {
            const key = e.type === "radio" ? "r:" + e.name + ":" + e.value : e.id;
            if (!(key in shot.fields)) continue;
            const v = shot.fields[key];
            const now = e.type === "checkbox" || e.type === "radio" ? e.checked : (e.multiple ? [...e.selectedOptions].map((o) => o.value) : e.value);
            if (JSON.stringify(now) === JSON.stringify(v)) continue;
            if (e.type === "checkbox" || e.type === "radio") e.checked = v;
            else if (e.multiple) [...e.options].forEach((o) => { o.selected = v.includes(o.value); });
            else e.value = v;
            e.dispatchEvent(new Event("input", { bubbles: true }));
            e.dispatchEvent(new Event("change", { bubbles: true }));
        }
        tuning = Object.assign({}, shot.tuning);
        state.curve = shot.curve.map((p) => p.slice());
        state.overrides = JSON.parse(JSON.stringify(shot.overrides));
        renderTuningCard(); renderCurve(); drawChart(); renderMaterials(); updateHelpers(); formChanged(); tuningChanged();
    } finally { restoring = false; }
    lastShot = snapshot();
}
function remember() {
    if (restoring) return;
    if (lastShot) { undoStack.push(lastShot); if (undoStack.length > 60) undoStack.shift(); redoStack.length = 0; }
    lastShot = snapshot();
}
$("side").addEventListener("change", remember, true);
$("side").addEventListener("click", (e) => { if (e.target.closest("button")) setTimeout(() => { if (!restoring && lastShot && JSON.stringify(snapshot()) !== JSON.stringify(lastShot)) remember(); }, 50); }, true);
window.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== "z") return;
    if (e.target.closest && e.target.closest("input[type=text], input[type=search], input[type=number], textarea")) return;       // (a field has its own undo)
    e.preventDefault();
    const from = e.shiftKey ? redoStack : undoStack, to = e.shiftKey ? undoStack : redoStack;
    if (!from.length) { status(e.shiftKey ? "Nothing to redo." : "Nothing to undo."); return; }
    to.push(snapshot());
    restore(from.pop());
    setDirty(true);
    status(e.shiftKey ? "Redone." : "Undone.", "ok");
});
setTimeout(() => { lastShot = snapshot(); }, 1500);

// ---- what is different from the last saved version
function flat(object, path, out) {
    if (Array.isArray(object) || (object && typeof object === "object")) {
        const keys = new Set([...(Array.isArray(object) ? object.map((_, i) => i) : Object.keys(object))]);
        for (const k of keys) flat(object[k], path ? path + (Array.isArray(object) ? "[" + k + "]" : "." + k) : String(k), out);
    } else out[path] = object;
    return out;
}
let baseline = null;       // the form as it was when it was loaded or saved (a tune that is chosen counts as the start)
function takeBaseline() { try { baseline = JSON.parse(JSON.stringify(buildConfig(state.existingId || ($("id").value.trim() || slug($("name").value))))); } catch (e) { baseline = null; } }
function differences() {
    const before = baseline || state.existingCar;
    if (!before) return null;
    const now = buildConfig(state.existingId || ($("id").value.trim() || slug($("name").value)));
    const skip = /^(model|softbody|driver|materials|id|wheels\.nodes|sound|cameras|exhaust|suspension|driveline)/;
    const a = flat(JSON.parse(JSON.stringify(before)), "", {}), b = flat(JSON.parse(JSON.stringify(now)), "", {}), out = [];
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (skip.test(k)) continue;
        const x = a[k], y = b[k];
        if (x === undefined && y === undefined) continue;
        if (typeof x === "number" && typeof y === "number" && Math.abs(x - y) < 1e-6 * Math.max(1, Math.abs(x))) continue;
        if (x !== y) out.push(k + ": " + (x === undefined ? "–" : x) + " → " + (y === undefined ? "–" : y));
    }
    return out;
}
$("changes").addEventListener("click", () => {
    let list;
    try { list = differences(); } catch (e) { status(e.message, "error"); return; }
    if (list === null) { status("This car is not saved yet."); return; }
    status(list.length ? list.length + " changed: " + list.slice(0, 6).join(" · ") + (list.length > 6 ? " · …" : "") : "Nothing in the settings is different from the saved car.", "ok");
});
$("layerSearch").addEventListener("input", () => renderLayers());
$("libSame").addEventListener("click", () => {
    for (const k of ["tyre_diameter", "tyre_height", "rubber"]) if (Number.isFinite(tuning[k + "_front"])) tuning[k + "_rear"] = tuning[k + "_front"];          // (the tyre of the front too)
    if (Number.isFinite(tuning.tyre_width)) tuning.tyre_width_rear = 0;
    renderTuningCard();
    $("libRimRear").value = $("libRimFront").value; $("libTyreRear").value = $("libTyreFront").value;
    $("libRimRear").dispatchEvent(new Event("change", { bubbles: true })); $("libTyreRear").dispatchEvent(new Event("change", { bubbles: true }));
});

// ---- the chart and Run dyno of the Engine card are pinned next to the sidebar while the card is open (not on a narrow window)
{
    const panel = $("enginePanel"), card = panel.closest("details");
    const place = () => {
        const pinned = card.open && window.innerWidth >= 1000;
        panel.classList.toggle("pinned", pinned);
        if (pinned) panel.style.left = ($("side").getBoundingClientRect().right + 12) + "px"; else panel.style.left = "";
    };
    $("enginePanelClose").addEventListener("click", () => { card.open = false; });
    card.addEventListener("toggle", place);
    window.addEventListener("resize", place);
    if (window.ResizeObserver) new ResizeObserver(place).observe($("side"));
    place();
}
