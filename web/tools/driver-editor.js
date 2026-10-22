/*
 * driver-editor.js
 *
 * Description: The "Driver" card of the car editor: a model of a driver (a glb with a simple skeleton, made in Blender in the T pose) that sits in the car. It is placed with
 *              gizmos: the model itself (move and turn, scale in a field), the two places where the hands hold the steering wheel and the two feet on the pedals; the arms and
 *              the legs follow with inverse kinematics (Driver.js, the same code as the game). The sliders Steering, Throttle and Brake try the driver out: the hands turn with the
 *              wheel and pass over when they would cross, the feet follow the pedals. The bones of the arms and the legs are guessed from their names and can be set by hand.
 *              Everything goes in car.json as "driver" (see Driver.js); the glb is saved with the car as driver.glb.
 *
 *              car-editor.js makes this with the things it shares and calls read() when the car is saved, fill() when a car is loaded and frame() every frame.
 */

import { TransformControls } from "three/addons/controls/TransformControls.js";

const ROLES = [
    ["armL", "Left arm", ["upper arm", "forearm", "hand"]], ["armR", "Right arm", ["upper arm", "forearm", "hand"]],
    ["legL", "Left leg", ["thigh", "shin", "foot"]], ["legR", "Right leg", ["thigh", "shin", "foot"]]
];
const MARK = { handL: 0x5ec8ff, handR: 0xff6b6b, footL: 0x8ee26b, footR: 0xffd04d };
const POLES = { pArmL: "armL", pArmR: "armR", pLegL: "legL", pLegR: "legR" };      // where the elbows and the knees point to: nodes too
const POLE_COLOUR = { pArmL: 0xa8e0ff, pArmR: 0xffb3b3, pLegL: 0xc5f0b0, pLegR: 0xffe79a };

export function initDriver(api) {
    const { $, THREE, scene, camera, renderer, controls, status } = api;
    const drv = { enabled: false, driver: null, file: null, existingFile: null, selected: null, mode: "move", dragging: false, steer: 0, throttle: 0, brake: 0, bones: {} };
    const targets = {};
    // an invisible ball round a marker, so that it is easy to click
    function addHitBall(mesh, radius) {
        const ball = new THREE.Mesh(new THREE.SphereGeometry(radius, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
        mesh.add(ball);
    }
    for (const [key, colour] of Object.entries(MARK)) {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(key.startsWith("hand") ? 0.03 : 0.045, 14, 10), new THREE.MeshBasicMaterial({ color: colour, depthTest: false, transparent: true }));
        mesh.renderOrder = 999;
        mesh.visible = false;
        addHitBall(mesh, 0.1);
        scene.add(mesh);
        targets[key] = mesh;
    }
    for (const [key, colour] of Object.entries(POLE_COLOUR)) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: colour, depthTest: false, transparent: true, opacity: 0.85 }));
        mesh.renderOrder = 999;
        mesh.visible = false;
        addHitBall(mesh, 0.09);
        scene.add(mesh);
        targets[key] = mesh;
    }
    const wheelPivot = new THREE.Object3D();                                  // the steering wheel for the test: the middle of the two grips, turned by the slider
    scene.add(wheelPivot);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 8, 48), new THREE.MeshBasicMaterial({ color: 0x9aa7b8, depthTest: false, transparent: true, opacity: 0.6 }));
    ring.renderOrder = 998;
    ring.visible = false;
    scene.add(ring);

    // ---- the card
    const anchor = $("sbInfo") && $("sbInfo").closest("details");
    const card = document.createElement("details");
    card.className = "card";
    card.innerHTML = `
        <summary>Driver<span class="meta" id="drvInfo">none</span></summary>
        <div class="body">
            <p class="sub">A driver in the car: a .glb with a simple skeleton in the T pose (from Blender). Place it and the hands and feet with the gizmos; in the game the hands hold the steering wheel and
            pass over when they would cross, and the feet follow the pedals.</p>
            <label class="check"><input type="checkbox" id="drvEnabled"> The car has a driver</label>
            <div class="row"><button class="small accent" id="drvPick">Load the driver model…</button><input type="file" id="drvFile" accept=".glb,.gltf" style="display:none"></div>
            <div class="hint" id="drvFileInfo">No model loaded.</div>
            <div class="group">Place (the gizmo is in the view)</div>
            <div class="row" id="drvPlace">
                <button class="small" data-t="model">Driver</button><button class="small" data-t="handL">Left hand</button><button class="small" data-t="handR">Right hand</button>
                <button class="small" data-t="footL">Left foot (brake)</button><button class="small" data-t="footR">Right foot (gas)</button><button class="small" data-t="wheel">Steering wheel</button>
            </div>
            <div class="row" id="drvModes"><button class="small accent" data-m="move">Move (W)</button><button class="small ghost" data-m="rotate">Rotate (E)</button><button class="small ghost" data-m="scale" id="drvScaleMode">Scale (R)</button></div>
            <div class="hint">Click a node in the view to take it: the coloured balls are the hands and the feet, the small cubes the elbows and the knees. Click the figure to take the model, click the steering wheel to take that.</div>
            <div class="row"><button class="small ghost" id="drvResetPoles">Reset the elbows and knees</button></div>
            <div class="row">
                <div><input type="number" id="drvScale" step="0.01" min="0.1" max="3" value="1"><div class="hint">scale</div></div>
                <div><input type="number" id="drvTravel" step="1" min="0" max="20" value="6"><div class="hint">pedal travel (cm)</div></div>
                <div><input type="number" id="drvElbow" step="0.05" min="-1" max="2" value="0.5"><div class="hint">elbows out</div></div>
                <div><input type="number" id="drvKnee" step="0.05" min="-1" max="2" value="0.15"><div class="hint">knees out</div></div>
            </div>
            <div class="group">Try it</div>
            <div class="hint">Steering <span id="drvSteerOut">0°</span></div><input type="range" id="drvSteer" min="-540" max="540" step="1" value="0" style="width:100%">
            <div class="hint">Throttle</div><input type="range" id="drvThrottle" min="0" max="1" step="0.01" value="0" style="width:100%">
            <div class="hint">Brake</div><input type="range" id="drvBrake" min="0" max="1" step="0.01" value="0" style="width:100%">
            <details class="sub-card"><summary class="hint" style="cursor:pointer">Bones of the arms and the legs</summary>
                <div class="row"><button class="small" id="drvGuess">Guess them from the names</button></div>
                <div id="drvBones"></div>
            </details>
        </div>`;
    if (anchor) anchor.after(card); else $("view").parentElement.appendChild(card);
    const el = (id) => card.querySelector("#" + id);

    // ---- the gizmo: one at a time, for the model (move or rotate) or for a hand or a foot (move)
    const gizmo = new TransformControls(camera, renderer.domElement);
    gizmo.setSize(0.7);
    gizmo.addEventListener("dragging-changed", (event) => { controls.enabled = !event.value; drv.dragging = event.value; if (api.setDragging) api.setDragging(event.value); });
    gizmo.addEventListener("objectChange", () => moved());
    scene.add(typeof gizmo.getHelper === "function" ? gizmo.getHelper() : gizmo);

    function attach() {
        gizmo.detach();
        const key = drv.selected;
        if (key === "wheel") { if (prepareWheel()) { gizmo.setMode(drv.mode === "rotate" ? "rotate" : drv.mode === "scale" ? "scale" : "translate"); gizmo.setSpace(drv.mode === "rotate" || drv.mode === "scale" ? "local" : "world"); gizmo.attach(wheel.target); } else { drv.selected = null; status("The model has no part called steering wheel.", "error"); } markButtons(); return; }
        if (!key || !drv.driver) { markButtons(); return; }
        if (key === "model") { gizmo.setMode(drv.mode === "rotate" ? "rotate" : "translate"); gizmo.setSpace(drv.mode === "rotate" ? "local" : "world"); gizmo.attach(drv.driver.root); }
        else { gizmo.setMode("translate"); gizmo.setSpace("world"); gizmo.attach(targets[key]); }
        markButtons();
    }
    function markButtons() {
        card.dataset.selected = drv.selected || "";
        card.querySelectorAll("#drvPlace button").forEach((b) => { b.className = "small" + (b.dataset.t === drv.selected ? " accent" : ""); });
        card.querySelectorAll("#drvModes button").forEach((b) => { b.className = "small" + (b.dataset.m === drv.mode ? " accent" : " ghost"); });
        el("drvModes").style.display = drv.selected === "model" || drv.selected === "wheel" ? "flex" : "none";
        el("drvScaleMode").style.display = drv.selected === "wheel" ? "" : "none";
    }
    function select(key) {
        drv.selected = drv.selected === key ? null : key;
        if (drv.selected && api.deselectLayers) api.deselectLayers();
        attach();
    }
    el("drvPlace").addEventListener("click", (e) => { const t = e.target.dataset && e.target.dataset.t; if (t) select(t); });
    el("drvModes").addEventListener("click", (e) => { const m = e.target.dataset && e.target.dataset.m; if (m) { drv.mode = m; attach(); } });
    window.addEventListener("keydown", (e) => {
        if ((drv.selected !== "model" && drv.selected !== "wheel") || e.ctrlKey || e.metaKey || e.altKey) return;
        const t = e.target && e.target.tagName;
        if (t === "INPUT" || t === "TEXTAREA" || t === "SELECT") return;
        if (e.code === "KeyW") { drv.mode = "move"; attach(); } else if (e.code === "KeyE") { drv.mode = "rotate"; attach(); } else if (e.code === "KeyR" && drv.selected === "wheel") { drv.mode = "scale"; attach(); }
    });

    // the gizmo moved something: the config follows
    function moved() {
        const d = drv.driver;
        if (drv.selected === "wheel") { applyWheel(); return; }
        if (!d) return;
        const r = (v) => Math.round(v * 1000) / 1000, deg = 180 / Math.PI, cfg = d.config;
        const key = drv.selected;
        if (key === "model") {
            cfg.position = [r(d.root.position.x), r(d.root.position.y), r(d.root.position.z)];
            cfg.rotation = [r(d.root.rotation.x * deg), r(d.root.rotation.y * deg), r(d.root.rotation.z * deg)];
        } else if (key === "wheel") {
            applyWheel();
        } else if (POLES[key]) {
            const p = targets[key].position;
            cfg.poles = cfg.poles || {};
            cfg.poles[POLES[key]] = [r(p.x), r(p.y), r(p.z)];
        } else if (key) {
            const p = targets[key].position, v = [r(p.x), r(p.y), r(p.z)];
            if (key === "handL") cfg.hands.left = v; else if (key === "handR") cfg.hands.right = v;
            else if (key === "footL") cfg.feet.left = v; else if (key === "footR") cfg.feet.right = v;
        }
    }

    // ---- the steering wheel of the car: the part of the model, moved, turned and scaled about its middle (steering_wheel.offset, .rotation, .scale in car.json)
    const wheel = { node: null, rest: null, centre: new THREE.Vector3(), target: new THREE.Object3D(), pending: null, root: null };
    scene.add(wheel.target);
    function findWheelNode(root) {
        let node = null;
        root.traverse((child) => {
            if (node) return;
            const name = (child.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
            if (name.indexOf("steeringwheel") !== -1 || name.indexOf("steerwheel") !== -1) node = child;
        });
        return node;
    }
    function prepareWheel() {
        const root = api.root && api.root();
        if (!root) return false;
        if (wheel.node && wheel.root === root) return true;
        const node = findWheelNode(root);
        if (!node) return false;
        root.updateMatrixWorld(true);
        wheel.node = node; wheel.root = root;
        wheel.rest = node.matrixWorld.clone();
        new THREE.Box3().setFromObject(node).getCenter(wheel.centre);
        wheel.target.position.copy(wheel.centre); wheel.target.quaternion.identity(); wheel.target.scale.set(1, 1, 1);
        if (wheel.pending) {
            const w = wheel.pending, d = Math.PI / 180;
            const off = w.offset || [0, 0, 0], rot = w.rotation || [0, 0, 0], sc = Array.isArray(w.scale) ? w.scale : [w.scale || 1, w.scale || 1, w.scale || 1];
            wheel.target.position.set(wheel.centre.x + off[0], wheel.centre.y + off[1], wheel.centre.z + off[2]);
            wheel.target.quaternion.setFromEuler(new THREE.Euler(rot[0] * d, rot[1] * d, rot[2] * d, "XYZ"));
            wheel.target.scale.set(sc[0], sc[1], sc[2]);
            wheel.pending = null;
            applyWheel();
        }
        return true;
    }
    function applyWheel() {
        if (!wheel.node) return;
        const M = new THREE.Matrix4().compose(wheel.target.position, wheel.target.quaternion, wheel.target.scale).multiply(new THREE.Matrix4().makeTranslation(-wheel.centre.x, -wheel.centre.y, -wheel.centre.z));
        const world = wheel.rest.clone().premultiply(M);
        const parent = wheel.node.parent;
        if (parent) { parent.updateWorldMatrix(true, false); world.premultiply(new THREE.Matrix4().copy(parent.matrixWorld).invert()); }
        world.decompose(wheel.node.position, wheel.node.quaternion, wheel.node.scale);
        wheel.node.updateMatrix();
    }
    function wheelConfig() {
        if (!wheel.node) return wheel.pending ? { offset: wheel.pending.offset, rotation: wheel.pending.rotation, scale: wheel.pending.scale } : null;
        const r = (v) => Math.round(v * 1000) / 1000, deg = 180 / Math.PI, p = wheel.target.position, q = new THREE.Euler().setFromQuaternion(wheel.target.quaternion, "XYZ"), s = wheel.target.scale;
        const moved = p.distanceTo(wheel.centre) > 1e-4 || wheel.target.quaternion.angleTo(new THREE.Quaternion()) > 1e-4 || Math.abs(s.x - 1) + Math.abs(s.y - 1) + Math.abs(s.z - 1) > 1e-4;
        if (!moved) return null;
        const uniform = Math.abs(s.x - s.y) < 1e-4 && Math.abs(s.y - s.z) < 1e-4;
        return { offset: [r(p.x - wheel.centre.x), r(p.y - wheel.centre.y), r(p.z - wheel.centre.z)], rotation: [r(q.x * deg), r(q.y * deg), r(q.z * deg)], scale: uniform ? r(s.x) : [r(s.x), r(s.y), r(s.z)] };
    }
    function resetWheel() { wheel.node = null; wheel.rest = null; wheel.root = null; wheel.pending = null; }

    // ---- the model
    function setEnabled(on) {
        drv.enabled = on;
        el("drvEnabled").checked = on;
        if (drv.driver) drv.driver.root.visible = on;
        ring.visible = on && !!drv.driver;
        for (const t of Object.values(targets)) t.visible = on && !!drv.driver;
        if (!on) { drv.selected = null; attach(); }
        info();
    }
    function info() {
        el("drvInfo").textContent = !drv.driver ? "none" : (drv.enabled ? "on" : "off");
        el("drvFileInfo").textContent = !drv.driver ? "No model loaded."
            : (drv.file ? drv.file.name + " (" + (drv.file.size / 1048576).toFixed(1) + " MB)" : "The model of this car (driver.glb)") + (drv.driver.complete() ? "" : ". Not every bone of the arms and the legs is found: set them under Bones.");
    }
    function install(sceneRoot, config) {
        if (drv.driver) drv.driver.dispose();
        const d = new OpenRacer.Driver(config, scene, { object: wheelPivot, axis: wheelAxis(config) });
        d.setModel(sceneRoot);
        drv.driver = d;
        syncTargets();
        fillBones();
        syncFields();
        setEnabled(true);
        attach();
    }
    function wheelAxis(config) {
        const a = config.wheel_axis;
        return new THREE.Vector3(a && a[0] !== undefined ? a[0] : 0, a && a[1] !== undefined ? a[1] : 0.3, a && a[2] !== undefined ? a[2] : -1).normalize();
    }
    function syncTargets() {
        const c = drv.driver.config;
        targets.handL.position.set(...c.hands.left); targets.handR.position.set(...c.hands.right);
        targets.footL.position.set(...c.feet.left); targets.footR.position.set(...c.feet.right);
    }
    function syncFields() {
        const c = drv.driver.config;
        el("drvScale").value = c.scale; el("drvTravel").value = Math.round(c.feet.travel * 100); el("drvElbow").value = c.elbow_out; el("drvKnee").value = c.knee_out;
    }
    function loadFile(file) {
        const url = URL.createObjectURL(file);
        new api.GLTFLoader().load(url, (gltf) => {
            const cfg = drv.driver ? drv.driver.config : OpenRacer.Driver.withDefaults({ enabled: true, position: [0, 0, 0] });
            drv.file = file; drv.existingFile = null;
            install(gltf.scene, cfg);
            status("Driver model loaded.", "ok");
        }, undefined, (error) => status("Could not read the driver model: " + (error.message || error), "error"));
    }
    el("drvPick").onclick = () => el("drvFile").click();
    el("drvFile").addEventListener("change", (e) => { if (e.target.files.length) loadFile(e.target.files[0]); e.target.value = ""; });
    el("drvEnabled").addEventListener("change", (e) => {
        if (e.target.checked && !drv.driver) { e.target.checked = false; status("Load the driver model first.", "error"); return; }
        setEnabled(e.target.checked);
    });

    // ---- the bones
    function boneNames() {
        const names = [];
        if (drv.driver && drv.driver.model) drv.driver.model.traverse((o) => { if (o.isBone) names.push(o.name); });
        return names;
    }
    function fillBones() {
        const box = el("drvBones");
        box.innerHTML = "";
        const names = boneNames(), d = drv.driver;
        const add = (key, index, label) => {
            const row = document.createElement("div");
            row.className = "row";
            const select = document.createElement("select");
            select.innerHTML = "<option value=''>(none)</option>" + names.map((n) => "<option>" + n.replace(/</g, "&lt;") + "</option>").join("");
            const bone = index === undefined ? d.bones[key] : d.bones[key][index];
            select.value = bone ? bone.name : "";
            select.addEventListener("change", () => {
                const cfg = d.config.bones;
                if (index === undefined) cfg[key] = select.value || undefined;
                else { const list = (cfg[key] || (d.bones[key] || []).map((b) => b && b.name)).slice(); list[index] = select.value || null; cfg[key] = list; }
                d.resolveBones();
                info();
            });
            const name = document.createElement("div");
            name.className = "hint";
            name.textContent = label;
            row.append(select, name);
            box.appendChild(row);
        };
        for (const [key, title, parts] of ROLES) parts.forEach((p, i) => add(key, i, title + ": " + p));
        add("hips", undefined, "Hips");
        add("head", undefined, "Head (hidden in the cockpit view)");
    }
    el("drvResetPoles").onclick = () => { if (drv.driver) { delete drv.driver.config.poles; drv.driver.config.poles = null; } };
    el("drvGuess").onclick = () => { if (!drv.driver) return; drv.driver.config.bones = {}; drv.driver.resolveBones(); fillBones(); info(); };

    // ---- a click in the view takes a node, the figure or the steering wheel
    const ray = new THREE.Raycaster();
    let down = null;
    renderer.domElement.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; });
    renderer.domElement.addEventListener("pointerup", (e) => {
        if (!down || drv.dragging || Math.abs(e.clientX - down[0]) + Math.abs(e.clientY - down[1]) > 4) { down = null; return; }
        down = null;
        if (gizmo.axis) return;                                           // (the click was on the gizmo)
        const rect = renderer.domElement.getBoundingClientRect();
        ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
        const markers = Object.entries(targets).filter(([, m]) => m.visible);
        const hit = ray.intersectObjects(markers.map(([, m]) => m), true)[0];
        if (hit) {
            let o = hit.object;
            while (o && !markers.some(([, m]) => m === o)) o = o.parent;
            const found = o && markers.find(([, m]) => m === o);
            if (found) { if (drv.selected !== found[0]) select(found[0]); return; }
        }
        if (drv.driver && drv.enabled && ray.intersectObject(drv.driver.root, true).length) { if (drv.selected !== "model") select("model"); return; }
        if (prepareWheel() && wheel.node && ray.intersectObject(wheel.node, true).length && drv.selected !== "wheel") select("wheel");
    });

    // ---- the fields and the test
    el("drvScale").addEventListener("change", () => { if (!drv.driver) return; const v = parseFloat(el("drvScale").value); if (v > 0) { drv.driver.config.scale = v; drv.driver.place(); } });
    el("drvTravel").addEventListener("change", () => { if (drv.driver) drv.driver.config.feet.travel = Math.max(0, parseFloat(el("drvTravel").value) || 0) / 100; });
    el("drvElbow").addEventListener("change", () => { if (drv.driver) drv.driver.config.elbow_out = parseFloat(el("drvElbow").value) || 0; });
    el("drvKnee").addEventListener("change", () => { if (drv.driver) drv.driver.config.knee_out = parseFloat(el("drvKnee").value) || 0; });
    el("drvSteer").addEventListener("input", () => { drv.steer = parseFloat(el("drvSteer").value); el("drvSteerOut").textContent = drv.steer + "°"; });
    el("drvThrottle").addEventListener("input", () => { drv.throttle = parseFloat(el("drvThrottle").value); });
    el("drvBrake").addEventListener("input", () => { drv.brake = parseFloat(el("drvBrake").value); });

    // every frame: the wheel of the test (the middle of the two grips, turned by the slider) and the driver
    function frame(dt) {
        const d = drv.driver;
        if (!d || !drv.enabled) return;
        const c = d.config;
        const mid = new THREE.Vector3((c.hands.left[0] + c.hands.right[0]) / 2, (c.hands.left[1] + c.hands.right[1]) / 2, (c.hands.left[2] + c.hands.right[2]) / 2);
        wheelPivot.position.copy(mid);
        const axis = wheelAxis(c);
        d.steering.axis.copy(axis);
        wheelPivot.quaternion.setFromAxisAngle(axis, -drv.steer * Math.PI / 180);
        const radius = Math.max(0.05, new THREE.Vector3(...c.hands.left).distanceTo(new THREE.Vector3(...c.hands.right)) / 2);
        ring.position.copy(mid);
        ring.scale.setScalar(radius);
        ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis);
        d.update(dt || 0.016, drv.throttle, drv.brake);
        for (const [key, role] of Object.entries(POLES)) {
            if (drv.dragging && drv.selected === key) continue;
            if (d.poles[role]) targets[key].position.copy(d.poles[role]);
        }
        if (!wheel.node && wheel.pending) prepareWheel();
    }

    // ---- the car: what goes in car.json, and what is read from it
    function read() {
        if (!drv.driver || !drv.enabled) return null;
        const c = drv.driver.config;
        const bones = {};
        for (const [key, , parts] of ROLES) { const list = drv.driver.bones[key]; if (list && list.every(Boolean)) bones[key] = list.map((b) => b.name); }
        if (drv.driver.bones.hips) bones.hips = drv.driver.bones.hips.name;
        if (drv.driver.bones.head) bones.head = drv.driver.bones.head.name;
        return { enabled: true, file: "", position: c.position.slice(), rotation: c.rotation.slice(), scale: c.scale, bones, hands: { left: c.hands.left.slice(), right: c.hands.right.slice() },
            feet: { left: c.feet.left.slice(), right: c.feet.right.slice(), travel: c.feet.travel, direction: c.feet.direction.slice() }, elbow_out: c.elbow_out, knee_out: c.knee_out,
            wheel_axis: c.wheel_axis, poles: c.poles ? JSON.parse(JSON.stringify(c.poles)) : undefined };
    }
    function newFile() { return drv.file; }
    function fill(car) {
        resetWheel();
        const sw = car && car.steering_wheel;
        if (sw && (sw.offset || sw.rotation || sw.scale)) wheel.pending = { offset: sw.offset, rotation: sw.rotation, scale: sw.scale };
        const config = car && car.driver;
        if (drv.driver) { drv.driver.dispose(); drv.driver = null; }
        drv.file = null; drv.existingFile = null; drv.selected = null;
        gizmo.detach();
        setEnabled(false);
        info();
        if (!config || !config.file) return;
        drv.existingFile = config.file;
        const url = api.resolve ? api.resolve(config.file) : config.file;
        new api.GLTFLoader().load(url, (gltf) => {
            install(gltf.scene, OpenRacer.Driver.withDefaults(Object.assign({}, config, { enabled: true })));
            setEnabled(config.enabled !== false);
        }, undefined, (error) => status("The driver model of this car could not be loaded: " + (error.message || error), "error"));
    }
    function deselect() { if (drv.selected) { drv.selected = null; attach(); } }

    return { read, fill, frame, newFile, wheelConfig, existingFile: () => drv.existingFile, deselect, saved: (path) => { drv.file = null; drv.existingFile = path; } };
}
