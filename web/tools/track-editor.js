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
import { createDesign } from "./track-design.js";

const $ = (id) => document.getElementById(id);
const ROLES = [["road", "Road"], ["track01", "Pit lane"], ["grass", "Grass"], ["ground", "Ground"], ["scenery", "Scenery"], ["decor", "Decor"]];
const ROLE_COLORS = { road: 0x8a93a1, track01: 0xc2a672, grass: 0x4f9b45, ground: 0x9a7a4e, scenery: 0xc45d5d, decor: 0x6c8cd5 };
const DRIVABLE = { road: true, track01: true, grass: true, ground: true };
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
    start: null,          // { x, y, z, heading }
    gates: [],            // [{ x, y, z, heading, width }]
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
const raycaster = new THREE.Raycaster();

function resize() {
    const w = view.clientWidth, h = view.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();
(function loop() {
    requestAnimationFrame(loop);
    renderer.render(scene, camera);
})();

let toastTimer = 0;
function status(text, kind) {
    const el = $("status");
    el.textContent = text;
    el.className = kind || "";
    // the same message in the view: the one in the side bar is at the bottom of a long page
    const toast = $("toast");
    clearTimeout(toastTimer);
    toast.textContent = text;
    toast.className = kind || "";
    toast.style.display = text ? "block" : "none";
    if (text && kind) toastTimer = setTimeout(() => { toast.style.display = "none"; }, 7000);
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
    if (/dirt|sand|gravel|ground|soil|mud|terrain/i.test(text)) return "ground";
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
            else mesh.material = colour ? roleMaterials[state.roles[name]] : mesh.userData.original;
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

function loadFromFiles(list) {
    state.files = new Map();
    for (const file of list) state.files.set(file.name, file);
    const main = [...state.files.keys()].find((n) => /\.glb$/i.test(n)) || [...state.files.keys()].find((n) => /\.gltf$/i.test(n));
    if (!main) {
        status("Pick a .glb file, or a .gltf with its .bin and texture files.", "error");
        return;
    }
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
    const kept = state.parts.size && !state.legacy ? Object.assign({}, state.roles) : null;
    new GLTFLoader(manager).load(urls.get(main), (gltf) => {
        state.legacy = false;
        setModel(gltf.scene, kept);
        $("modelInfo").textContent = main + " (" + (state.files.get(main).size / 1048576).toFixed(1) + " MB), " + state.parts.size + " named parts";
        status("Model loaded: " + state.parts.size + " parts. " + (kept ? "Parts with the name of an old part keep their surface; check the new ones. " : "") + "Save the track to keep it.", "ok");
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

function groundY(x, z, hint) {
    raycaster.set(new THREE.Vector3(x, (hint === undefined ? 10000 : hint + 50), z), new THREE.Vector3(0, -1, 0));
    const hits = raycaster.intersectObjects(trackGroup.children, true).filter((h) => DRIVABLE[state.roles[h.object.name || ""]]);
    return hits.length ? hits[0].point.y : (hint === undefined ? 0 : hint);
}

function heading(degrees) {
    return degrees * Math.PI / 180;
}

function makeArrow(x, y, z, h, colour, length) {
    return new THREE.ArrowHelper(new THREE.Vector3(Math.cos(h), 0, Math.sin(h)), new THREE.Vector3(x, y + 0.6, z), length, colour, length * 0.3, length * 0.2);
}

function updateMarkers() {
    markers.clear();
    const k = state.markerScale;
    if (state.start) {
        const s = state.start;
        markers.add(makeArrow(s.x, s.y, s.z, s.heading, 0xffd04d, 9 * k));
        const body = new THREE.Mesh(new THREE.BoxGeometry(4.8, 1.2, 1.9), new THREE.MeshBasicMaterial({ color: 0xffd04d, wireframe: true }));
        body.position.set(s.x, s.y + 0.8, s.z);
        body.rotation.y = Math.PI / 2 - s.heading;
        body.scale.setScalar(k);
        markers.add(body);
        $("startX").value = s.x.toFixed(2);
        $("startZ").value = s.z.toFixed(2);
        $("startHeading").value = (s.heading * 180 / Math.PI).toFixed(1);
    }
    state.gates.forEach((gate, i) => {
        const colour = i === 0 ? 0x4ed88a : 0x4db8ff;
        const material = () => new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
        const wall = new THREE.Mesh(new THREE.PlaneGeometry(gate.width, 4), material());
        wall.position.set(gate.x, gate.y + 2, gate.z);
        wall.rotation.y = Math.atan2(Math.cos(gate.heading), Math.sin(gate.heading));
        markers.add(wall);
        // a strip on the road, to be seen from above
        const strip = new THREE.Mesh(new THREE.PlaneGeometry(gate.width, 2 * k), material());
        strip.rotation.x = -Math.PI / 2;
        strip.rotation.z = Math.atan2(-Math.cos(gate.heading), -Math.sin(gate.heading)); // across the road
        strip.position.set(gate.x, gate.y + 0.3, gate.z);
        markers.add(strip);
        markers.add(makeArrow(gate.x, gate.y, gate.z, gate.heading, colour, 5 * k));
    });
    renderGates();
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

function readStartFields() {
    const x = parseFloat($("startX").value), z = parseFloat($("startZ").value), h = parseFloat($("startHeading").value) || 0;
    if (!isFinite(x) || !isFinite(z)) return;
    state.start = { x, z, y: groundY(x, z, state.start ? state.start.y : undefined), heading: heading(h) };
    updateMarkers();
}
["startX", "startZ", "startHeading"].forEach((id) => $(id).addEventListener("change", readStartFields));

// the design of a track without a model: nodes, heights, widths and prefabs (see track-design.js)
const design = createDesign({
    scene, trackGroup, camera, renderer, controls, state, registerMesh, applyColours, renderParts, updateMarkers, frameTrack, status, $,
    setMode, getMode: () => state.mode, roleMaterials
});
function startDesign(data) {
    clearTrack();
    $("colour").checked = false; // a designed track is shown with its textures; the colours of the surfaces can be switched on
    design.enable(data);
    $("modes").classList.add("design");
    setMode("node");
}
function stopDesign() {
    design.disable();
    $("modes").classList.remove("design");
    if (state.mode === "node" || state.mode === "prefab") setMode("view");
}

function setMode(mode) {
    state.mode = mode;
    for (const button of document.querySelectorAll("#modes button")) button.classList.toggle("active", button.dataset.mode === mode);
    $("hud").textContent = (design && design.hudText(mode)) || (mode === "start" ? "Place start: click on the road and drag in the direction that the car drives."
        : mode === "gate" ? "Add gate: click on the road and drag in the direction that the car drives through the gate."
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
    if (state.mode === "start" || state.mode === "gate") {
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
    if (state.mode === "start") {
        state.start = { x: point.x, y: point.y, z: point.z, heading: h };
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
    if (d.hit) {
        if (!d.added && state.mode === "start") place(d, false);
        else if (!d.added && state.mode === "gate") place(d, false);
        return;
    }
    if (state.mode === "view" && !d.moved && !(design && design.active())) {
        const hit = pointerRay(event).intersectObjects(trackGroup.children, true)[0];
        if (hit) selectPart(hit.object.name || "", true);
    }
});

$("topView").onclick = topView;
$("gateAtStart").onclick = () => {
    if (!state.start) { status("Place the start first.", "error"); return; }
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
    state.start = track.start ? { x: track.start.x, y: 0, z: track.start.z, heading: track.start.heading || 0 } : null;
    state.gates = [];
    $("delete").style.display = "";
    $("editing").textContent = "Changing the track “" + id + "”. Saving overwrites it.";
    status("Loading…");
    try {
        if (track.design && track.design.nodes) { startDesign(JSON.parse(JSON.stringify(track.design))); setMode("view"); }
        else if (track.model) { stopDesign(); await loadGltfTrack(track); }
        else { stopDesign(); await loadLegacyTrack(track); }
        // the heights of the start and the gates come from the road
        if (state.start) state.start.y = groundY(state.start.x, state.start.z);
        state.gates = (track.gates || []).map((g) => ({ x: g.x, y: groundY(g.x, g.z), z: g.z, heading: g.heading, width: g.width || 24 }));
        updateMarkers();
        updateLineNote();
        status("", "");
    } catch (error) {
        status("Could not load the track: " + error.message, "error");
    }
}

function newTrack() {
    state.existingId = null;
    state.existingTrack = null;
    state.files = new Map();
    state.mainFile = null;
    state.start = null;
    state.gates = [];
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
}

// ---- saving

// Writes track.json (and files) through the server when it is there (serve.py), otherwise to the garage of this browser (Garage.js)
async function store(id, config, files, remove) {
    return OpenRacer.Garage.store("tracks", id, config, files || {}, { base: "../", remove: remove || [] });
}

async function save() {
    try {
        const name = $("name").value.trim();
        const id = $("id").value.trim() || slug(name);
        if (!name) throw new Error("Give the track a name.");
        if (!ID_PATTERN.test(id)) throw new Error("The id may only have lower case letters, digits, - and _.");
        if (!state.start) throw new Error("Place the start of the track on the road.");
        if (!state.root && !design.active()) throw new Error("Import a model first, or draw the track with nodes.");
        if (state.tracks.some((t) => t.id === id) && id !== state.existingId &&
            !confirm("There already is a track with the id “" + id + "”. Replace it?")) return;

        const old = state.existingTrack;
        const config = old && id === state.existingId ? JSON.parse(JSON.stringify(old)) : {};
        delete config.id;
        config.name = name;
        config.description = $("description").value.trim();
        config.start = { x: +state.start.x.toFixed(3), z: +state.start.z.toFixed(3), heading: +state.start.heading.toFixed(5) };
        if (state.gates.length) {
            config.gates = state.gates.map((g) => ({ x: +g.x.toFixed(3), z: +g.z.toFixed(3), heading: +g.heading.toFixed(5), width: g.width }));
            delete config.checkpoints; // gates replace the road pieces of the old format
        } else {
            delete config.gates;
        }

        const uploads = [];
        let oldModel = null;
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
            const blob = await (await fetch(trackFile(old, old.model))).blob();
            if (!/\.glb$/i.test(old.model)) throw new Error("To save this track under another id, import its model files again.");
            uploads.push([old.model, blob]);
        }
        let oldSky = null;
        if (state.envOn) {
            const e = readEnv();
            if (state.skyFile) {
                if (!FILE_PATTERN.test(state.skyFile.name)) throw new Error("The file name of the sky picture has characters that are not allowed.");
                uploads.push([state.skyFile.name, state.skyFile]);
                if (state.oldSkyName && state.oldSkyName !== state.skyFile.name && id === state.existingId) oldSky = state.oldSkyName;
            } else if (state.skyName && id !== state.existingId && state.existingId) {
                const blob = await (await fetch(trackFile(state.existingTrack, state.skyName))).blob();
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
        await refreshList(id);
        $("delete").style.display = "";
        updateLineNote();
        status(saved.where === "server" ? "Saved as tracks/" + id + ". It is in the main menu of the game now."
            : "Saved in your garage, in this browser (the server does not save). It is in the main menu of the game now.", "ok");
    } catch (error) {
        status(error.message, "error");
    }
}

async function deleteTrack() {
    if (!state.existingId || !confirm("Delete the track “" + state.existingId + "” with all its files?")) return;
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
}

$("recordLine").onclick = async () => {
    if (!state.existingId) { status("Save the track first: the line is recorded on the saved track.", "error"); return; }
    if (!state.gates.length && !(state.existingTrack.checkpoints || []).length) { status("Place a gate at the start first: a lap is counted through the gates.", "error"); return; }
    // the car: the one chosen last in the main menu, or else the first one
    let car = null;
    try { car = (JSON.parse(localStorage.getItem("openracer.lastChoice")) || {}).car; } catch (e) { /* no storage */ }
    if (!car) {
        try { const cars = await Catalog.load("cars", "../"); car = cars.length ? cars[0].id : null; } catch (e) { /* nothing to drive */ }
    }
    if (!car) { status("No car to drive with.", "error"); return; }
    window.location.href = "../index.html?car=" + encodeURIComponent(car) + "&track=" + encodeURIComponent(state.existingId) + "&recordline=1&ai=0&ghost=0&records=0";
};

$("clearLine").onclick = async () => {
    const track = state.existingTrack;
    if (!track || !track.racing_line) return;
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

// ---- the form

$("files").addEventListener("change", (e) => { if (e.target.files.length) loadFromFiles([...e.target.files]); });
$("existing").addEventListener("change", () => $("existing").value ? loadExisting() : newTrack());
$("newTrack").onclick = newTrack;
$("save").onclick = save;
$("delete").onclick = deleteTrack;
$("id").addEventListener("input", () => { state.idEdited = true; });
$("name").addEventListener("input", () => { if (!state.idEdited && !state.existingId) $("id").value = slug($("name").value); });

renderLegend();
renderParts();
fillEnv(OpenRacer.environmentDefaults());
applyEnv();
updateLineNote();
openFromAddress();
