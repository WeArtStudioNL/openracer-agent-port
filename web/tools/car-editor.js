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
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const $ = (id) => document.getElementById(id);
const SLOTS = ["FR", "FL", "RL", "RR"];
const SLOT_COLORS = { FR: 0xff6b6b, FL: 0x5ec8ff, RL: 0x8ee26b, RR: 0xffd04d };
const WHEEL_NAME = /wheel|tyre|tire|rim|felg|wiel|rueda|roue|ruota|velg|alloy/i;
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/;

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
    root: null,
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
scene.add(helpers);
const cameraMarkers = new THREE.Group(); // where the cameras of the game are
scene.add(cameraMarkers);

// the layers panel (see further down): what can be selected, and the gizmo that moves the cameras and the model
const LAYERS = [
    { group: "Cameras" },
    { id: "chase", label: "1 Fixed camera", color: "#4d8dff" },
    { id: "follow", label: "2 Follow camera", color: "#37d67a" },
    { id: "cockpit", label: "3 Cockpit camera", color: "#ff9f43" },
    { group: "Car" },
    { id: "model", label: "Model (offset)", color: "#c6cfdb" },
    { id: "steering", label: "Steering wheel", color: "#e0b040" },
    { group: "Wheels" },
    { id: "wFR", label: "Front right", color: "#ff6b6b" },
    { id: "wFL", label: "Front left", color: "#5ec8ff" },
    { id: "wRR", label: "Rear right", color: "#ffd04d" },
    { id: "wRL", label: "Rear left", color: "#8ee26b" }
];
const layers = { selected: null, dragging: false };
const gizmoTargets = { chase: new THREE.Object3D(), follow: new THREE.Object3D(), cockpit: new THREE.Object3D(), model: pivot };
[gizmoTargets.chase, gizmoTargets.follow, gizmoTargets.cockpit].forEach((o) => scene.add(o));
const gizmo = new TransformControls(camera, renderer.domElement);
gizmo.setSize(0.8);
gizmo.addEventListener("dragging-changed", (event) => { controls.enabled = !event.value; layers.dragging = event.value; if (!event.value) updateCameraMarkers(); });
gizmo.addEventListener("objectChange", () => gizmoMoved());
scene.add(typeof gizmo.getHelper === "function" ? gizmo.getHelper() : gizmo);

function resize() {
    const w = view.clientWidth, h = view.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
new ResizeObserver(resize).observe(view);
resize();
(function loop() {
    requestAnimationFrame(loop);
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
        $("modelInfo").textContent = main + " (" + (state.files.get(main).size / 1048576).toFixed(1) + " MB), " + state.nodes.length + " named parts";
        if (!replacing) status("Model loaded.", "ok");
    }, undefined, (error) => status("Could not read the model: " + (error.message || error), "error"));
}

function loadFromUrl(url, label) {
    new GLTFLoader().load(url, (gltf) => {
        setModel(gltf.scene, false);
        $("modelInfo").textContent = label + ", " + state.nodes.length + " named parts";
    }, undefined, (error) => status("Could not load the model of this car: " + (error.message || error), "error"));
}

function setModel(root, isNew, replace) {
    if (state.root) pivot.remove(state.root);
    state.root = root;
    pivot.add(root);
    state.materials = OpenRacer.prepareMaterials(THREE, root);
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
        if (object !== root && object.name) state.nodes.push({ name: object.name, depth });
        object.children.forEach((child) => walk(child, depth + 1));
    };
    walk(root, 0);
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
        const diameter = SLOTS.reduce((sum, s) => sum + centres[s].size.y, 0) / 4;
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

function wheelMode() {
    return document.querySelector("input[name=wheelMode]:checked").value;
}

function updateHelpers() {
    helpers.clear();
    for (const slot of SLOTS) {
        const box = wheelMode() === "model" ? wheelBox(slot) : null;
        if (box) helpers.add(new THREE.Box3Helper(box, SLOT_COLORS[slot]));
    }
    const centres = wheelCenters();
    $("wheelInfo").textContent = centres ? "" : (wheelMode() === "model" ? "Every wheel needs at least one part." : "");
    const radius = (num("tyre") || 0.65) / 2;
    grid.position.y = wheelMode() === "model" && centres ? Math.min(...SLOTS.map((s) => centres[s].c.y - centres[s].size.y / 2)) : -radius;
    updateSpeedInfo();
    const box = new THREE.Box3().setFromObject(pivot);
    $("hud").textContent = state.root ? "Blue arrow: forward. The axes are the origin: it has to be at the height of the wheel axles, between the axles.\n" +
        "Model " + box.getSize(new THREE.Vector3()).toArray().map((v) => v.toFixed(2)).join(" x ") + " m (width x height x length)" : "";
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
    $("frontTrack").value = Math.abs(c.FL.c.x - c.FR.c.x).toFixed(3);
    $("rearTrack").value = Math.abs(c.RL.c.x - c.RR.c.x).toFixed(3);
    $("tyre").value = (SLOTS.reduce((sum, s) => sum + c[s].size.y, 0) / 4).toFixed(3);
    updateHelpers();
}

// ---- materials

function applyOverrides(name) {
    state.materials.filter((m) => m.name === name).forEach((m) => OpenRacer.applyMaterialOverride(m, state.overrides[name]));
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
    camChaseDist: (c) => c.chase.distance, camChaseHeight: (c) => c.chase.height, camChaseFov: (c) => c.chase.fov,
    camFolDist: (c) => c.follow.distance, camFolHeight: (c) => c.follow.height, camFolLook: (c) => c.follow.look_height,
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
        chase: { distance: n("camChaseDist"), height: n("camChaseHeight"), fov: n("camChaseFov") },
        follow: { distance: n("camFolDist"), height: n("camFolHeight"), look_height: n("camFolLook"), smoothing: n("camFolSmooth"),
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
    if (Number.isFinite(c.chase.distance) && Number.isFinite(c.chase.height)) {
        line(0x4d8dff, dot(0x4d8dff, 0, c.chase.height - r, -c.chase.distance, "chase"), new THREE.Vector3(0, 0, 0));
    }
    if (Number.isFinite(c.follow.distance) && Number.isFinite(c.follow.height)) {
        line(0x37d67a, dot(0x37d67a, 0, c.follow.height - r, -c.follow.distance, "follow"), new THREE.Vector3(0, (c.follow.look_height || 0) - r, 0));
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
    const r = (num("tyre") || 0.65) / 2;
    const fix = (v) => Math.round(v * 100) / 100;
    if (id === "chase" || id === "follow") {
        const p = gizmoTargets[id].position;
        p.x = 0;
        if (p.z > -0.5) p.z = -0.5;
        $(id === "chase" ? "camChaseDist" : "camFolDist").value = fix(-p.z);
        $(id === "chase" ? "camChaseHeight" : "camFolHeight").value = fix(p.y + r);
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
    layers.selected = layers.selected === id ? null : id;
    const sel = layers.selected;
    gizmo.detach();
    if (sel && gizmoTargets[sel]) {
        if (sel === "model" && !state.root) { layers.selected = null; }
        else {
            gizmo.attach(gizmoTargets[sel]);
            gizmo.showX = sel !== "chase" && sel !== "follow"; // the cameras behind the car are in the middle
            gizmo.showY = gizmo.showZ = true;
        }
    }
    // a wheel or the steering wheel is only marked in the list: the view stays where it is
    updateCameraMarkers();
    updateThumbnail();
}

function renderLayers() {
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
        if (l.id === "chase") meta.textContent = num("camChaseDist") + " m, " + num("camChaseFov") + "°";
        if (l.id === "follow") meta.textContent = num("camFolDist") + " m, " + num("camFolFovStand") + "°";
        if (l.id === "cockpit") meta.textContent = num("camCockFov") + "°";
        if (l.id === "model") { meta.textContent = state.root ? "" : "none"; if (!state.root) row.classList.add("dim"); }
        if (l.id.charAt(0) === "w") { const has = centres && centres[l.id.substring(1)]; if (!has) row.classList.add("dim"); meta.textContent = has ? "" : "not set"; }
        if (l.id === "steering") { const has = state.nodes.some((n) => /steeringwheel|steerwheel/i.test(n.name.replace(/[^a-z0-9]/gi, ""))); if (!has) row.classList.add("dim"); meta.textContent = has ? "" : "none"; }
        row.appendChild(meta);
        row.addEventListener("click", () => selectLayer(l.id));
        list.appendChild(row);
    });
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
    const hit = pickRay.intersectObjects(cameraMarkers.children, false).find((h) => h.object.userData.layer);
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
    const id = layers.selected;
    const isCamera = id === "chase" || id === "follow" || id === "cockpit";
    thumbRenderer.domElement.style.display = isCamera ? "block" : "none";
    if (!isCamera) { $("thumbLabel").textContent = "Select a camera to see what it sees."; return; }
    const c = readCameras();
    const r = (num("tyre") || 0.65) / 2;
    if (id === "chase") {
        thumbCamera.position.set(0, c.chase.height - r, -c.chase.distance);
        thumbCamera.rotation.set(0, Math.PI, 0); // looks along the car
        thumbCamera.fov = c.chase.fov;
        $("thumbLabel").textContent = "1 Fixed camera, " + c.chase.distance + " m behind, " + c.chase.height + " m high, FOV " + c.chase.fov + "°";
    } else if (id === "follow") {
        thumbCamera.position.set(0, c.follow.height - r, -c.follow.distance);
        thumbCamera.lookAt(0, (c.follow.look_height || 0) - r, 0);
        thumbCamera.fov = c.follow.fov_standing;
        $("thumbLabel").textContent = "2 Follow camera at a standstill, FOV " + c.follow.fov_standing + "° (" + c.follow.fov_fast + "° at full speed)";
    } else {
        const p = c.cockpit.position;
        thumbCamera.position.set(p[0], p[1], p[2]);
        thumbCamera.rotation.set(0, Math.PI, 0);
        thumbCamera.fov = c.cockpit.fov;
        $("thumbLabel").textContent = "3 Cockpit camera, FOV " + c.cockpit.fov + "°";
    }
    thumbCamera.updateProjectionMatrix();
}

function renderThumbnail() {
    const id = layers.selected;
    if (id !== "chase" && id !== "follow" && id !== "cockpit") return;
    // without the markers and the gizmo, the way the game shows it
    cameraMarkers.visible = false;
    const helper = typeof gizmo.getHelper === "function" ? gizmo.getHelper() : gizmo;
    const wasVisible = helper.visible;
    helper.visible = false;
    thumbRenderer.render(scene, thumbCamera);
    helper.visible = wasVisible;
    cameraMarkers.visible = true;
}

// the panel: hide, show, and resize by dragging its edge
$("layersHide").addEventListener("click", () => { $("layers").classList.add("hidden"); $("layersOpen").style.display = ""; });
$("layersShow").addEventListener("click", () => { $("layers").classList.remove("hidden"); $("layersOpen").style.display = "none"; });
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

async function engineSimChanged() {
    const p = readEngineSim();
    if (!preview.synth || !engineSimValid(p)) return;
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
    const p = readEngineSim();
    if (!engineSimValid(p)) { status("Every field of the engine sound needs a value.", "error"); return; }
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
    state.curve.sort((a, b) => a[0] - b[0]);
    const body = $("curve").querySelector("tbody");
    body.innerHTML = "";
    state.curve.forEach((point, index) => {
        const row = document.createElement("tr");
        const cell = (value, field) => {
            const td = document.createElement("td");
            const input = document.createElement("input");
            input.type = "number";
            input.value = value;
            input.step = field === 0 ? 100 : 5;
            input.onchange = () => { state.curve[index][field] = parseFloat(input.value) || 0; renderCurve(); };
            td.appendChild(input);
            return td;
        };
        row.appendChild(cell(point[0], 0));
        row.appendChild(cell(point[1], 1));
        const hp = document.createElement("td");
        hp.textContent = Math.round(power(point[0], point[1]));
        row.appendChild(hp);
        const del = document.createElement("td");
        const button = document.createElement("button");
        button.className = "small";
        button.textContent = "✕";
        button.onclick = () => { state.curve.splice(index, 1); renderCurve(); };
        del.appendChild(button);
        row.appendChild(del);
        body.appendChild(row);
    });
    drawChart();
}

function drawChart() {
    const canvas = $("chart");
    const g = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    g.clearRect(0, 0, w, h);
    const maxRpm = Math.max(num("limiter") || 7000, ...state.curve.map((p) => p[0])) * 1.05;
    const maxNm = Math.max(1, ...state.curve.map((p) => p[1])) * 1.1;
    const maxHp = Math.max(1, ...state.curve.map((p) => power(p[0], p[1]))) * 1.1;
    g.strokeStyle = "#2c3541";
    g.fillStyle = "#6f7d92";
    g.font = "20px Arial";
    for (let r = 0; r <= maxRpm; r += 1000) {
        const x = r / maxRpm * w;
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h - 22); g.stroke();
        g.fillText(r / 1000 + "k", x + 3, h - 4);
    }
    const line = (color, value, scale) => {
        g.strokeStyle = color; g.lineWidth = 3; g.beginPath();
        state.curve.forEach((p, i) => {
            const x = p[0] / maxRpm * w, y = (h - 24) - value(p) / scale * (h - 30);
            if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        });
        g.stroke();
    };
    line("#ff9f43", (p) => p[1], maxNm);
    line("#54a0ff", (p) => power(p[0], p[1]), maxHp);
    const limitX = (num("limiter") || 0) / maxRpm * w;
    g.strokeStyle = "#ff5e5e"; g.lineWidth = 2; g.beginPath(); g.moveTo(limitX, 0); g.lineTo(limitX, h - 22); g.stroke();
    const peak = state.curve.reduce((best, p) => (power(p[0], p[1]) > best.hp ? { hp: power(p[0], p[1]), rpm: p[0] } : best), { hp: 0, rpm: 0 });
    const torque = Math.max(0, ...state.curve.map((p) => p[1]));
    $("peakInfo").textContent = Math.round(peak.hp) + " hp at " + peak.rpm + " rpm, " + Math.round(torque) + " Nm";
}

// a typical curve for a petrol engine from its peak power: P = Pmax (x + x^2 - x^3) with x = rpm / rpm at the peak
function generateCurve() {
    const hp = num("genPower"), peakRpm = num("genRpm");
    if (!(hp > 0 && peakRpm > 1000)) { status("Give the peak power and the rpm where it is.", "error"); return; }
    const watts = hp * 745.7;
    const curve = [[0, 0]];
    const limit = Math.max(num("limiter") || 0, peakRpm * 1.1);
    for (let rpm = 500; rpm <= limit + 600; rpm += 500) {
        const x = rpm / peakRpm;
        const p = watts * (x + x * x - x * x * x);
        curve.push([rpm, Math.max(0, Math.round(p / (rpm * Math.PI / 30) * 10) / 10)]);
    }
    state.curve = curve;
    renderCurve();
}

function updateSpeedInfo() {
    const gears = parseGears();
    const r = (num("tyre") || 0.65) / 2;
    const final = num("finalDrive");
    const limiter = num("limiter");
    if (!gears.length || !(final > 0) || !(limiter > 0)) { $("speedInfo").textContent = ""; return; }
    const speed = (ratio) => limiter * Math.PI / 30 * r / (ratio * final) * 3.6;
    $("speedInfo").textContent = "At the rev limit: " + gears.map((g, i) => (i + 1) + ": " + Math.round(speed(g)) + " km/h").join("   ");
}

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
            tire_diameter: need("tyre", "The tyre diameter"),
            drag_coefficient: need("drag", "The drag coefficient"),
            max_steer_deg: need("steer", "The steering lock")
        },
        drivetrain: {
            drive: $("drive").value,
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
    const camNumbers = [config.cameras.chase.distance, config.cameras.chase.height, config.cameras.chase.fov, config.cameras.follow.distance,
        config.cameras.follow.height, config.cameras.follow.look_height, config.cameras.follow.smoothing, config.cameras.follow.fov_standing,
        config.cameras.follow.fov_fast, config.cameras.follow.fov_full_speed, config.cameras.follow.dolly, config.cameras.cockpit.fov, ...config.cameras.cockpit.position];
    if (!camNumbers.every(Number.isFinite)) throw new Error("Every field of the cameras needs a number.");
    if (!config.name) throw new Error("Give the car a name.");
    if (wheelMode() === "model") {
        // the physics of the game takes the wheelbase, the tracks and the tyre from the wheels of the model: car.json says the same
        const c = wheelCenters();
        if (c) {
            const wb = (c.FR.c.z + c.FL.c.z) / 2 - (c.RL.c.z + c.RR.c.z) / 2;
            const ft = Math.abs(c.FR.c.x - c.FL.c.x), rt = Math.abs(c.RR.c.x - c.RL.c.x);
            const d = (c.FR.size.y + c.FL.size.y + c.RL.size.y + c.RR.size.y) / 4;
            if (wb > 1.2 && wb < 5 && ft > 0.6 && rt > 0.6 && d > 0.3 && d < 1.5) {
                config.chassis.wheelbase = Math.round(wb * 1000) / 1000;
                config.chassis.front_track = Math.round(ft * 1000) / 1000;
                config.chassis.rear_track = Math.round(rt * 1000) / 1000;
                config.chassis.tire_diameter = Math.round(d * 1000) / 1000;
            } else {
                throw new Error("The wheels of the model do not make a car: the front wheels have to be in front (turn the model) and the wheels have to be between 0.3 and 1.5 m. Check the wheel parts.");
            }
        }
        config.wheels.nodes = {};
        for (const slot of SLOTS) {
            const names = [...$("w" + slot).selectedOptions].map((o) => o.value);
            if (!names.length) throw new Error("Select the parts of every wheel, or use the wheel of the demo car.");
            config.wheels.nodes[slot] = names;
        }
    }
    return config;
}

async function put(url, body) {
    const response = await fetch(url, { method: "PUT", body });
    if (!response.ok) {
        throw new Error("The server did not accept " + url + " (" + response.status + "). Start the game with start-server.sh, which has the part that saves.");
    }
}

async function save() {
    try {
        const name = $("name").value.trim();
        const id = $("id").value.trim() || slug(name);
        if (!ID_PATTERN.test(id)) throw new Error("The id may only have lower case letters, digits, - and _.");
        const config = buildConfig(id);
        if (state.cars.some((car) => car.id === id) && id !== state.existingId &&
            !confirm("There already is a car with the id “" + id + "”. Replace it?")) return;

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
                const blob = await (await fetch("../" + config.model.file)).blob();
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

        // what the tuning menu of the game has put in the configuration, and that this form does not have, is kept
        const old = state.existingCar;
        if (old && id === state.existingId) {
            for (const section of ["chassis", "drivetrain", "engine"]) config[section] = Object.assign({}, old[section], config[section]);
            for (const section of ["tyres", "assists"]) if (old[section] && !config[section]) config[section] = old[section];
        }

        // the model that is replaced is removed from the folder of the car when it has another name
        const oldFile = state.replacedModel && state.replacedModel.type === "gltf" ? state.replacedModel.file : null;

        status("Saving…");
        for (const [fileName, file] of uploads) await put("/api/cars/" + id + "/" + encodeURIComponent(fileName), file);
        await put("/api/cars/" + id + "/car.json", JSON.stringify(config, null, 2) + "\n");
        if (oldFile && config.model.type === "gltf" && oldFile !== config.model.file && oldFile.startsWith("cars/" + id + "/")) {
            await fetch("/api/cars/" + id + "/" + encodeURIComponent(oldFile.split("/").pop()), { method: "DELETE" });
        }
        state.replacedModel = null;
        state.existingId = id;
        state.existingModel = config.model;
        state.existingCar = Object.assign({}, config, { id });
        state.files = new Map();
        state.mainFile = null;
        await refreshList(id);
        $("delete").style.display = "";
        status("Saved as cars/" + id + ". It is in the main menu of the game now.", "ok");
    } catch (error) {
        status(error.message, "error");
    }
}

async function deleteCar() {
    if (!state.existingId || !confirm("Delete the car “" + state.existingId + "” with all its files?")) return;
    const response = await fetch("/api/cars/" + state.existingId, { method: "DELETE" });
    if (!response.ok) { status("The car could not be deleted (" + response.status + ").", "error"); return; }
    status("Deleted.", "ok");
    newCar();
    refreshList();
}

// ---- the steering wheel

function updateSteeringInfo() {
    const found = state.nodes.find((n) => /steeringwheel|steerwheel/i.test(n.name.replace(/[^a-z0-9]/gi, "")));
    $("steeringInfo").textContent = !state.nodes.length ? "No model loaded."
        : found ? "Found the part “" + found.name + "”: it turns with the steering in the game."
        : "No part called steeringwheel in this model: the steering wheel does not turn. Name it that way in Blender to make it turn.";
}

// ---- the differentials

const DIFF_INFO = {
    open: "Open: the same torque to both wheels, so the wheel with the least grip decides how much there is. Spins the inner wheel in a corner under power; the easiest to drive straight, the worst for traction.",
    lsd: "Limited slip: locks the wheels together more the harder it is driven (preload, and a share of the torque under power and off the throttle). Gives traction out of corners; a high lock makes the car push or slide with the power.",
    welded: "Welded: both wheels always turn at the same speed. Best traction in a straight line and for drifting; it scrubs and pushes in slow corners, and a car is touchy on the throttle at the limit."
};

function updateDiffFields() {
    const drive = $("drive").value, diff = $("diff").value;
    $("lsdBox").style.display = diff === "lsd" ? "" : "none";
    $("centerBox").style.display = drive === "awd" ? "" : "none";
    $("splitBox").style.display = drive === "awd" ? "" : "none";
    $("diffInfo").textContent = DIFF_INFO[diff] + (drive === "awd" ? " Centre differential: " + ({ open: "open gives the axles the share above all the time", lsd: "a limited slip one moves torque to the axle that turns slower", locked: "a locked one turns both axles at the same speed" })[$("centerDiff").value] + "." : "");
}
["drive", "diff", "centerDiff"].forEach((id) => $(id).addEventListener("change", updateDiffFields));
updateDiffFields();

// ---- cars that exist

async function refreshList(select) {
    try {
        const response = await fetch("/api/cars");
        state.cars = await response.json();
    } catch (e) {
        state.cars = [];
    }
    const el = $("existing");
    el.innerHTML = "<option value=''>Choose a car to change…</option>";
    state.cars.forEach((car) => {
        const option = document.createElement("option");
        option.value = car.id;
        option.textContent = (car.name || car.id) + " (" + car.id + ")";
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
    set("wheelbase", c.wheelbase); set("frontTrack", c.front_track); set("rearTrack", c.rear_track);
    set("tyre", c.tire_diameter); set("drag", c.drag_coefficient); set("steer", c.max_steer_deg);
    const d = car.drivetrain;
    set("steeringDegrees", (car.steering_wheel && car.steering_wheel.degrees) || 450);
    set("drive", d.drive); set("diff", d.diff || "lsd"); set("centerDiff", d.center_diff || "lsd");
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
    set("brakeFront", car.brakes.front); set("brakeRear", car.brakes.rear);
    fillCameras(OpenRacer.cameraSettings(car));
    fillEngineSim(OpenRacer.engineSimParams(car));
    stopPreview();
    engineSimChanged();
    renderCurve();
}

function loadExisting() {
    const car = state.cars.find((c) => c.id === $("existing").value);
    if (!car) return;
    newCar();
    state.existingId = car.id;
    state.existingModel = car.model;
    state.existingCar = car;
    fill(car);
    state.overrides = JSON.parse(JSON.stringify(car.materials || {}));
    state.autoGlass = !car.materials; // a car that was made before the materials could be set gets see-through glass as a suggestion
    $("delete").style.display = "";
    if (car.model.type === "gltf") {
        const m = car.model;
        $("rotation").value = m.rotation_y || 0;
        $("scale").value = m.scale || 1;
        const o = m.offset || [0, 0, 0];
        $("offsetX").value = o[0]; $("offsetY").value = o[1]; $("offsetZ").value = o[2];
        const wheels = car.wheels || { mode: "default" };
        document.querySelector("input[name=wheelMode][value=" + wheels.mode + "]").checked = true;
        $("wheelSelects").style.display = wheels.mode === "model" ? "" : "none";
        loadFromUrl("../" + m.file, m.file);
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
    $("modelNote").textContent = "To update the model of this car pick a new .glb here: the rest of the car is kept (the transform, the wheels and the material changes where the new model still fits them).";
    status("Loaded " + (car.name || car.id) + ".");
}

function newCar() {
    fillEngineSim(OpenRacer.engineSimParams(null));
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
    $("delete").style.display = "none";
    $("editing").textContent = "Choose a car to change it, or make a new one below. Saving a car that was chosen here overwrites it.";
    helpers.clear();
    status("");
}

// ---- events

$("files").addEventListener("change", (e) => loadFromFiles(e.target.files));
for (const id of ["rotation", "scale", "offsetX", "offsetY", "offsetZ"]) $(id).addEventListener("input", applyTransform);
document.querySelectorAll("[data-turn]").forEach((button) => button.addEventListener("click", () => {
    $("rotation").value = (((num("rotation") || 0) + parseFloat(button.dataset.turn)) % 360);
    applyTransform();
}));
$("fit").addEventListener("click", fit);
$("guessWheels").addEventListener("click", guessWheels);
for (const slot of SLOTS) $("w" + slot).addEventListener("change", updateHelpers);
document.querySelectorAll("input[name=wheelMode]").forEach((radio) => radio.addEventListener("change", () => {
    $("wheelSelects").style.display = wheelMode() === "model" ? "" : "none";
    updateHelpers();
}));
$("sizeFromModel").addEventListener("click", sizeFromModel);
$("chassisFromWheels").addEventListener("click", chassisFromWheels);
$("addPoint").addEventListener("click", () => {
    const last = state.curve[state.curve.length - 1] || [0, 0];
    state.curve.push([last[0] + 500, last[1]]);
    renderCurve();
});
$("generate").addEventListener("click", generateCurve);
for (const id of ["limiter", "idle"]) $(id).addEventListener("input", () => { drawChart(); updateSpeedInfo(); $("soundRpm").max = Math.round((num("limiter") || 7000) * 1.1); });
for (const id of ["gears", "finalDrive", "tyre"]) $(id).addEventListener("input", updateSpeedInfo);
$("name").addEventListener("input", () => { if (!state.idEdited) $("id").value = slug($("name").value); });
$("id").addEventListener("input", () => { state.idEdited = true; });
$("existing").addEventListener("change", loadExisting);
$("camDefaults").addEventListener("click", defaultCameras);
document.querySelectorAll(".cam").forEach((el) => el.addEventListener("input", updateCameraMarkers));
for (const id of ["length", "width", "height", "tyre"]) $(id).addEventListener("input", updateCameraMarkers);
$("newCar").addEventListener("click", () => { newCar(); $("existing").value = ""; });
$("save").addEventListener("click", save);
$("delete").addEventListener("click", deleteCar);

initEngineSim();
renderCurve();
updateSpeedInfo();
defaultCameras();
refreshList();
