/*
 * softbody-editor.js
 *
 * Description: The "Soft body" card of the car editor. It sets what the shell of a car (SoftBody.js) is made of, what single nodes and beams
 *              can take, which parts of the model swing on a hinge or come loose (Parts.js), and it shows and tests that on the test bench:
 *              the nodes and the beams are drawn over the model (green to red as a node bends), a click selects one, and a crash test drives
 *              the car into a wall. Everything is saved in car.json: "softbody" and "parts" (see SOFTBODY.md).
 *
 *              car-editor.js makes this with the things it shares (the scene, the test bench, the status line) and calls read() when the
 *              car is saved and fill() when a car is loaded.
 */

const DEFAULTS = {
    shell_mass: null, hardening: 0.2,
    "anchor.stiffness": 0.8, "anchor.yield_force": 80, "anchor.break_force": 250, "anchor.damping": 0.6,
    "beam.stiffness": 0.4, "beam.yield_force": 40, "beam.break_force": 120, "beam.damping": 0.15,
    "contact.stiffness": 1.5, "contact.damping": 0.7, "contact.friction": 0.5,
    neighbours: 5, reach: 1.1
};
// the kinds of material, as factors of the defaults: stiffness, yield force, break force
const PRESETS = {
    "Steel (the default)": [1, 1, 1],
    "Aluminium": [0.7, 0.6, 0.6],
    "Plastic": [0.4, 0.3, 0.5],
    "Foam and rubber": [0.2, 0.15, 0.3],
    "Race cage (stiff)": [2, 2.5, 3]
};
// a number in the field is in kN or kN/mm; the file has newtons and N/m
const SCALE = { "anchor.stiffness": 1e6, "anchor.yield_force": 1e3, "anchor.break_force": 1e3, "beam.stiffness": 1e6, "beam.yield_force": 1e3, "beam.break_force": 1e3, "contact.stiffness": 1e6 };

export function initSoftBody(api) {
    const { $, THREE, scene, camera, renderer, controls, bench, status } = api;
    const sb = { nodeEdits: new Map(), beamEdits: new Map(), parts: [], shown: false, group: null, points: null, lines: null, hinges: [], sel: { nodes: new Set(), beam: null }, layout: null, edit: false, keepSelection: null, crash: null, wall: null };

    // ---- the settings
    const fields = [...document.querySelectorAll("input.sb")];
    function readSettings() {
        const out = {};
        fields.forEach((input) => {
            const key = input.dataset.key;
            if (input.value === "") return;
            const value = parseFloat(input.value);
            if (!isFinite(value)) return;
            const [group, name] = key.includes(".") ? key.split(".") : [null, key];
            const stored = value * (SCALE[key] || 1);
            if (group) { (out[group] = out[group] || {})[name] = stored; } else out[name] = stored;
        });
        return out;
    }
    function fillSettings(config) {
        fields.forEach((input) => {
            const key = input.dataset.key;
            const [group, name] = key.includes(".") ? key.split(".") : [null, key];
            const stored = group ? (config[group] || {})[name] : config[name];
            input.value = stored === undefined ? "" : String(+(stored / (SCALE[key] || 1)).toPrecision(6));
        });
    }
    const presetSelect = $("sbPreset");
    Object.keys(PRESETS).forEach((name) => { const o = document.createElement("option"); o.textContent = name; presetSelect.appendChild(o); });
    presetSelect.addEventListener("change", () => {
        const [k, y, b] = PRESETS[presetSelect.value];
        const set = (key, value) => { document.querySelector('input.sb[data-key="' + key + '"]').value = k === 1 && y === 1 && b === 1 ? "" : String(+value.toPrecision(4)); };
        ["anchor", "beam"].forEach((group) => {
            set(group + ".stiffness", DEFAULTS[group + ".stiffness"] * k);
            set(group + ".yield_force", DEFAULTS[group + ".yield_force"] * y);
            set(group + ".break_force", DEFAULTS[group + ".break_force"] * b);
        });
        changed();
    });
    $("sbDefaults").addEventListener("click", () => { fields.forEach((i) => { i.value = ""; }); presetSelect.selectedIndex = 0; changed(); });
    fields.forEach((i) => i.addEventListener("change", changed));
    $("sbEnabled").addEventListener("change", changed);

    // the shell is made again from the new settings when the bench runs
    let restartTimer = 0;
    function changed(keep) {
        clearTimeout(restartTimer);
        if (bench.vehicle && (sb.shown || sb.crash)) restartTimer = setTimeout(async () => { sb.crash = null; sb.restarting = true; await show(true); sb.restarting = false; }, keep === true ? 150 : 400);
    }

    // ---- the parts
    const MODES = [["hinge", "Hinge"], ["detachable", "Loose"]];
    function partRow(part, index) {
        const row = document.createElement("div");
        row.className = "material";
        const h = part.hinge || {};
        const vec = (v, d) => (v || d).join(", ");
        row.innerHTML =
            '<div class="row"><div><label>Object of the model</label><input type="text" list="sbObjectNames" data-f="object"></div>' +
            '<div><label>Behaviour</label><select data-f="mode">' + MODES.map((m) => '<option value="' + m[0] + '">' + m[1] + "</option>").join("") + "</select></div>" +
            '<div><label>Mass (kg)</label><input type="number" data-f="mass" step="0.5" min="0.1"></div>' +
            '<div class="fixed"><label>&nbsp;</label><button class="small ghost" data-f="remove">Remove</button></div></div>' +
            '<div class="row loose"><div><label>Breaks loose at (kN)</label><input type="number" data-f="break_force" step="0.5" min="0"></div><div></div><div></div></div>' +
            '<div class="hinge"><div class="row"><div><label>Origin x, y, z (m)</label><input type="text" data-f="origin" placeholder="the middle of the part"></div>' +
            '<div><label>Axis x, y, z</label><input type="text" data-f="axis" placeholder="0, 1, 0"></div></div>' +
            '<div class="row"><div><label>Lowest angle (°)</label><input type="number" data-f="min" step="5" placeholder="-90"></div>' +
            '<div><label>Highest angle (°)</label><input type="number" data-f="max" step="5" placeholder="90"></div>' +
            '<div><label>Rest angle (°)</label><input type="number" data-f="rest" step="5" placeholder="0"></div></div>' +
            '<div class="row"><div><label>Spring (N·m/rad)</label><input type="number" data-f="spring" step="1" min="0" placeholder="0"></div>' +
            '<div><label>Damper (N·m·s/rad)</label><input type="number" data-f="damper" step="0.5" min="0" placeholder="0"></div>' +
            '<div><label>Latch force (kN)</label><input type="number" data-f="latch" step="0.5" min="0" placeholder="0: not latched"></div>' +
            '<div><label>Tears off at (kN)</label><input type="number" data-f="hinge_break" step="1" min="0" placeholder="0: never"></div></div></div>';
        const q = (f) => row.querySelector('[data-f="' + f + '"]');
        q("object").value = part.object || "";
        q("mode").value = part.mode || "hinge";
        q("mass").value = part.mass !== undefined ? part.mass : 10;
        q("break_force").value = part.break_force !== undefined ? part.break_force / 1000 : "";
        q("origin").value = h.origin ? vec(h.origin) : "";
        q("axis").value = h.axis ? vec(h.axis) : "";
        ["min", "max", "rest", "spring", "damper"].forEach((f) => { q(f).value = h[f] !== undefined ? h[f] : ""; });
        q("latch").value = h.latch_force !== undefined ? h.latch_force / 1000 : "";
        q("hinge_break").value = h.break_force !== undefined ? h.break_force / 1000 : "";
        const showMode = () => {
            const hinge = q("mode").value === "hinge";
            row.querySelector(".hinge").style.display = hinge ? "" : "none";
            row.querySelector(".loose").style.display = hinge ? "none" : "";
        };
        showMode();
        row.addEventListener("change", () => { readRow(row, part); showMode(); changed(); drawHinges(); });
        q("remove").addEventListener("click", () => { sb.parts.splice(sb.parts.indexOf(part), 1); renderParts(); changed(); drawHinges(); });
        return row;
    }
    function numbers(text) {
        const list = String(text).split(/[\s,;]+/).filter(Boolean).map(parseFloat);
        return list.length === 3 && list.every(isFinite) ? list : null;
    }
    function readRow(row, part) {
        const q = (f) => row.querySelector('[data-f="' + f + '"]');
        const n = (f) => (q(f).value === "" ? undefined : parseFloat(q(f).value));
        part.object = q("object").value.trim();
        part.mode = q("mode").value;
        part.mass = n("mass") || 10;
        if (part.mode === "hinge") {
            const hinge = {};
            const origin = numbers(q("origin").value), axis = numbers(q("axis").value);
            if (origin) hinge.origin = origin;
            if (axis) hinge.axis = axis;
            ["min", "max", "rest", "spring", "damper"].forEach((f) => { if (n(f) !== undefined) hinge[f] = n(f); });
            if (n("latch")) hinge.latch_force = n("latch") * 1000;
            if (n("hinge_break")) hinge.break_force = n("hinge_break") * 1000;
            part.hinge = hinge;
            delete part.break_force;
        } else {
            if (n("break_force")) part.break_force = n("break_force") * 1000; else delete part.break_force;
            delete part.hinge;
        }
    }
    function renderParts() {
        const box = $("sbParts");
        box.innerHTML = "";
        if (!sb.parts.length) box.innerHTML = '<p class="hint">No parts: the whole model dents with the shell.</p>';
        sb.parts.forEach((part, i) => box.appendChild(partRow(part, i)));
        const names = $("sbObjectNames");
        names.innerHTML = "";
        api.nodeNames().forEach((name) => { const o = document.createElement("option"); o.value = name; names.appendChild(o); });
    }
    $("sbAddPart").addEventListener("click", () => { sb.parts.push({ object: "", mode: "hinge", mass: 10, hinge: {} }); renderParts(); });
    document.querySelector('[data-open="dlgParts"]').addEventListener("click", renderParts);

    // ---- what is saved
    function read() {
        const out = { softbody: null, parts: null };
        const soft = readSettings();
        if ($("sbEnabled").checked === false) soft.enabled = false;
        const nodes = [...sb.nodeEdits].map(([i, e]) => Object.assign({ i }, e));
        const beams = [...sb.beamEdits.values()];
        if (sb.layout) soft.layout = sb.layout;
        if (nodes.length) soft.nodes = nodes;
        if (beams.length) soft.beams = beams;
        if (Object.keys(soft).length) out.softbody = soft;
        const parts = sb.parts.filter((p) => p.object);
        if (parts.length) out.parts = parts.map((p) => JSON.parse(JSON.stringify(p)));
        return out;
    }
    function fill(car) {
        const soft = car.softbody || {};
        fillSettings(soft);
        presetSelect.selectedIndex = 0;
        $("sbEnabled").checked = soft.enabled !== false;
        sb.nodeEdits = new Map((soft.nodes || []).map((n) => [n.i, { yield_force: n.yield_force, break_force: n.break_force }]));
        sb.beamEdits = new Map((soft.beams || []).map((b) => [Math.min(b.a, b.b) + "-" + Math.max(b.a, b.b), b]));
        sb.parts = JSON.parse(JSON.stringify(car.parts || []));
        sb.sel.nodes.clear(); sb.sel.beam = null;
        sb.layout = Array.isArray(soft.layout) ? soft.layout.map((n) => Object.assign({}, n)) : null;
        showSelection();
        renderParts();
    }

    // ---- the shell in the view
    const nodePos = new THREE.Vector3();
    function softBody() { return bench.obj && bench.vehicle && bench.vehicle.softBody; }

    async function show(restart) {
        try {
            if (restart || !bench.vehicle) await api.startBench();
            const s = softBody();
            if (!s) throw new Error($("sbEnabled").checked ? "The model gave no shell (it has too little in it)." : "The car does not dent: tick “The car dents”.");
            drawShell(s);
            sb.shown = true;
            showSelection();
            $("sbShow").textContent = "Hide the shell";
            $("sbInfo").textContent = s.count + " nodes, " + s.beamCount + " beams";
        } catch (error) { status(error.message, "error"); }
    }
    function hide() {
        sb.shown = false;
        if (sb.group) { scene.remove(sb.group); sb.group = null; }
        $("sbShow").textContent = "Show the shell";
    }
    $("sbShow").addEventListener("click", () => { if (sb.shown) hide(); else show(false); });

    function drawShell(s) {
        if (sb.group) scene.remove(sb.group);
        const group = new THREE.Group();
        const N = s.count, B = s.beamCount;
        const pointGeo = new THREE.BufferGeometry();
        pointGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3 * N), 3));
        pointGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(3 * N), 3));
        sb.points = new THREE.Points(pointGeo, new THREE.PointsMaterial({ size: 8, sizeAttenuation: false, vertexColors: true, depthTest: false, transparent: true }));
        sb.points.renderOrder = 10; sb.points.frustumCulled = false;
        const lineGeo = new THREE.BufferGeometry();
        lineGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6 * B), 3));
        lineGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(6 * B), 3));
        sb.lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.8 }));
        sb.lines.renderOrder = 9; sb.lines.frustumCulled = false;
        group.add(sb.lines, sb.points);
        sb.group = group;
        scene.add(group);
        drawHinges();
        updateShell();
        showSelection();
    }

    // the hinges as arrows: the origin and the axis of every part that has them
    function drawHinges() {
        if (!sb.group) return;
        sb.hinges.forEach((a) => sb.group.remove(a));
        sb.hinges = [];
        sb.parts.forEach((part) => {
            const h = part.hinge;
            if (part.mode !== "hinge" || !h || !h.origin) return;
            const axis = h.axis ? new THREE.Vector3(...h.axis) : new THREE.Vector3(0, 1, 0);
            if (axis.lengthSq() < 1e-6) return;
            const arrow = new THREE.ArrowHelper(axis.normalize(), new THREE.Vector3(...h.origin).addScaledVector(axis, -0.3), 0.6, 0xff9f43, 0.12, 0.07);
            arrow.traverse((o) => { if (o.material) { o.material.depthTest = false; o.renderOrder = 12; } });
            sb.hinges.push(arrow);
            sb.group.add(arrow);
        });
    }

    const tint = new THREE.Color();
    // every frame of the bench: the shell follows the car and shows how bent it is
    function frame(dt) {
        const o = bench.obj, v = bench.vehicle;
        if (!o || !v) return;
        if (o.softBodyMesh) o.softBodyMesh.update();
        if (o.parts) o.parts.update(dt);
        if (sb.crash) crashFrame(dt);
        if (sb.group) updateShell();
    }
    function updateShell() {
        const s = softBody(), v = bench.vehicle;
        if (!s || !sb.group) return;
        sb.group.position.set(v.px, v.py, v.pz);
        sb.group.quaternion.set(v.qx, v.qy, v.qz, v.qw);
        const pos = sb.points.geometry.attributes.position, col = sb.points.geometry.attributes.color;
        const lp = sb.lines.geometry.attributes.position, lc = sb.lines.geometry.attributes.color;
        const rest = new THREE.Vector3();
        for (let k = 0; k < s.count; k++) {
            s.position(k, nodePos); s.restPosition(k, rest);
            pos.setXYZ(k, nodePos.x, nodePos.y, nodePos.z);
            if (!s.alive(k)) tint.setRGB(0.35, 0.35, 0.4);
            else {
                // the bend against the bend at which the anchor yields: green, yellow at the yield, red above it
                const strain = nodePos.distanceTo(rest) / Math.max(1e-6, s.nodeYield[k] / s.params.anchorK);
                tint.setHSL(0.33 * Math.max(0, 1 - strain * 0.5), 0.9, 0.55);
            }
            if (sb.sel.nodes.has(k)) tint.setRGB(1, 1, 1);
            col.setXYZ(k, tint.r, tint.g, tint.b);
        }
        pos.needsUpdate = true; col.needsUpdate = true;
        const a = new THREE.Vector3(), b = new THREE.Vector3();
        for (let i = 0; i < s.beamCount; i++) {
            const alive = s.beamAlive[i] === 1 && s.alive(s.beamA[i]) && s.alive(s.beamB[i]);
            s.position(s.beamA[i], a); s.position(s.beamB[i], b);
            lp.setXYZ(2 * i, a.x, a.y, a.z); lp.setXYZ(2 * i + 1, b.x, b.y, b.z);
            const chosen = sb.sel.beam === i;
            if (chosen) tint.setRGB(1, 1, 1); else if (alive) tint.setRGB(0.3, 0.55, 0.9); else tint.setRGB(0.25, 0.1, 0.1);
            lc.setXYZ(2 * i, tint.r, tint.g, tint.b); lc.setXYZ(2 * i + 1, tint.r, tint.g, tint.b);
        }
        lp.needsUpdate = true; lc.needsUpdate = true;
    }

    // ---- selecting nodes and beams: a click, Shift and a click to add, and a lasso with the middle mouse button
    const lassoCanvas = document.createElement("canvas");
    lassoCanvas.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:5";
    renderer.domElement.parentElement.appendChild(lassoCanvas);
    let down = null, lasso = null;
    const savedMiddle = controls.mouseButtons.MIDDLE;
    renderer.domElement.addEventListener("pointerdown", (e) => {
        if (!sb.shown || !softBody()) return;
        if (e.button === 1) {
            e.preventDefault();
            const rect = renderer.domElement.getBoundingClientRect();
            lasso = { points: [[e.clientX - rect.left, e.clientY - rect.top]], add: e.shiftKey || e.ctrlKey };
            controls.mouseButtons.MIDDLE = -1;                      // the middle button is not the dolly of the orbit controls now
            try { renderer.domElement.setPointerCapture(e.pointerId); } catch (error) { /* a synthetic event */ }
        } else if (e.button === 0) down = { x: e.clientX, y: e.clientY };
    });
    renderer.domElement.addEventListener("pointermove", (e) => {
        if (!lasso) return;
        const rect = renderer.domElement.getBoundingClientRect();
        lasso.points.push([e.clientX - rect.left, e.clientY - rect.top]);
        drawLasso();
    });
    renderer.domElement.addEventListener("pointerup", (e) => {
        if (lasso && e.button === 1) {
            const l = lasso; lasso = null;
            drawLasso();
            if (l.points.length > 2) lassoSelect(l);
            return;
        }
        if (!down || !sb.shown || !softBody() || e.button !== 0) return;
        const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
        down = null;
        if (moved <= 4) click(e);
    });
    renderer.domElement.addEventListener("auxclick", (e) => { if (e.button === 1) e.preventDefault(); });
    function drawLasso() {
        const rect = renderer.domElement.getBoundingClientRect();
        lassoCanvas.width = rect.width; lassoCanvas.height = rect.height;
        const g = lassoCanvas.getContext("2d");
        g.clearRect(0, 0, rect.width, rect.height);
        if (!lasso) return;
        g.beginPath();
        lasso.points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.closePath();
        g.fillStyle = "rgba(255,255,255,0.12)"; g.fill();
        g.strokeStyle = "#ffffff"; g.setLineDash([5, 4]); g.lineWidth = 1.5; g.stroke();
    }
    function inside(polygon, x, y) {
        let c = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
            if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
        }
        return c;
    }
    // the screen place of a node (in pixels of the view)
    const screenP = new THREE.Vector3();
    function screenOf(s, k, rect) {
        s.position(k, screenP);
        screenP.applyMatrix4(sb.group.matrixWorld).project(camera);
        return [(screenP.x + 1) / 2 * rect.width, (1 - screenP.y) / 2 * rect.height, screenP.z];
    }
    function lassoSelect(l) {
        const s = softBody(), rect = renderer.domElement.getBoundingClientRect();
        sb.group.updateMatrixWorld(true);
        if (!l.add) sb.sel.nodes.clear();
        sb.sel.beam = null;
        for (let k = 0; k < s.count; k++) {
            const [x, y, z] = screenOf(s, k, rect);
            if (z < 1 && inside(l.points, x, y)) sb.sel.nodes.add(k);
        }
        showSelection();
    }
    const caster = new THREE.Raycaster();
    function click(e) {
        const s = softBody(), rect = renderer.domElement.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        sb.group.updateMatrixWorld(true);
        const p = new THREE.Vector3(), p2 = new THREE.Vector3();
        let node = -1, bestD = 14;
        for (let k = 0; k < s.count; k++) {
            const [x, y] = screenOf(s, k, rect);
            const d = Math.hypot(x - mx, y - my);
            if (d < bestD) { bestD = d; node = k; }
        }
        const additive = e.shiftKey || e.ctrlKey;
        if (node >= 0) {
            sb.sel.beam = null;
            if (additive) { if (!sb.sel.nodes.delete(node)) sb.sel.nodes.add(node); }
            else { sb.sel.nodes.clear(); sb.sel.nodes.add(node); }
            showSelection();
            return;
        }
        // in the edit mode a click on the model puts a node on its surface
        if (sb.edit && addAt(mx, my, rect)) return;
        // else a beam
        let beam = -1;
        bestD = 8;
        for (let i = 0; i < s.beamCount; i++) {
            const [x1, y1] = screenOf(s, s.beamA[i], rect), [x2, y2] = screenOf(s, s.beamB[i], rect);
            const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy || 1;
            const t = Math.max(0, Math.min(1, ((mx - x1) * dx + (my - y1) * dy) / len2));
            const d = Math.hypot(x1 + t * dx - mx, y1 + t * dy - my);
            if (d < bestD) { bestD = d; beam = i; }
        }
        if (!additive) sb.sel.nodes.clear();
        sb.sel.beam = beam >= 0 ? beam : null;
        showSelection();
    }
    function showSelection() {
        const s = softBody(), box = $("sbSelFields"), text = $("sbSelection");
        const nodes = [...sb.sel.nodes], beam = sb.sel.beam;
        $("sbDelete").disabled = !nodes.length || !sb.edit;
        if (!s || (!nodes.length && beam === null)) {
            box.style.display = "none";
            text.textContent = !sb.shown ? "Show the shell, then click a node or a beam in the view."
                : sb.edit ? "Click the model to put a node on it, a node to select it (Shift adds). Middle mouse button and drag: a lasso."
                : "Click a node or a beam in the view (Shift adds). Middle mouse button and drag: a lasso.";
            return;
        }
        box.style.display = "";
        if (nodes.length) {
            const edited = nodes.filter((k) => sb.nodeEdits.has(k)).length;
            text.textContent = nodes.length === 1 ? "Node " + nodes[0] + (edited ? " (set by you)" : "") + ": the anchor that holds it to the car."
                : nodes.length + " nodes selected" + (edited ? " (" + edited + " set by you)" : "") + ": what you set goes to all of them.";
            const same = (arr) => arr.every((x) => x === arr[0]);
            const ys = nodes.map((k) => s.nodeYield[k]), bs = nodes.map((k) => s.nodeBreak[k]);
            $("sbSelYield").value = same(ys) ? +(ys[0] / 1000).toPrecision(5) : "";
            $("sbSelBreak").value = same(bs) ? +(bs[0] / 1000).toPrecision(5) : "";
        } else {
            const a = s.beamA[beam], b = s.beamB[beam];
            const edited = sb.beamEdits.has(Math.min(a, b) + "-" + Math.max(a, b));
            text.textContent = "Beam " + a + " – " + b + (edited ? " (set by you)" : "") + ".";
            $("sbSelYield").value = +(s.beamYield[beam] / 1000).toPrecision(5);
            $("sbSelBreak").value = +(s.beamBreak[beam] / 1000).toPrecision(5);
        }
    }
    $("sbSelSet").addEventListener("click", () => {
        const s = softBody();
        if (!s) return;
        const y = parseFloat($("sbSelYield").value) * 1000, b = parseFloat($("sbSelBreak").value) * 1000;
        if (!(y >= 0) || !(b >= 0)) { status("Give the yield and the break force as numbers.", "error"); return; }
        if (b < y) { status("The break force has to be at least the yield force.", "error"); return; }
        if (sb.sel.nodes.size) {
            sb.sel.nodes.forEach((k) => { sb.nodeEdits.set(k, { yield_force: y, break_force: b }); s.nodeYield[k] = y; s.nodeBreak[k] = b; });
        } else if (sb.sel.beam !== null) {
            const a = Math.min(s.beamA[sb.sel.beam], s.beamB[sb.sel.beam]), c = Math.max(s.beamA[sb.sel.beam], s.beamB[sb.sel.beam]);
            sb.beamEdits.set(a + "-" + c, { a, b: c, yield_force: y, break_force: b });
            s.beamYield[sb.sel.beam] = y; s.beamBreak[sb.sel.beam] = b;
        }
        showSelection();
        status("Set. Save the car to keep it.", "ok");
    });
    $("sbSelClear").addEventListener("click", () => {
        const s = softBody();
        if (!s) return;
        sb.sel.nodes.forEach((k) => sb.nodeEdits.delete(k));
        if (sb.sel.beam !== null) sb.beamEdits.delete(Math.min(s.beamA[sb.sel.beam], s.beamB[sb.sel.beam]) + "-" + Math.max(s.beamA[sb.sel.beam], s.beamB[sb.sel.beam]));
        status("Back to the default after the shell is made again (a moment).", "ok");
        changed();
    });

    // ---- editing the nodes: a click on the model puts one there, the selected ones can be removed
    // The nodes are made from the model once; from the first edit on they are a list of the car (softbody.layout), which the game uses as it is.
    function freeze(s) {
        if (sb.layout) return;
        const p = new THREE.Vector3();
        sb.layout = [];
        for (let k = 0; k < s.count; k++) { s.restPosition(k, p); sb.layout.push({ x: +p.x.toFixed(4), y: +p.y.toFixed(4), z: +p.z.toFixed(4), r: +s.radiusOf(k).toFixed(4) }); }
    }
    function addAt(mx, my, rect) {
        const s = softBody();
        if (!bench.model) return false;
        caster.setFromCamera(new THREE.Vector2(mx / rect.width * 2 - 1, -(my / rect.height) * 2 + 1), camera);
        const hits = caster.intersectObject(bench.model.tilt, true).filter((h) => h.object.isMesh && h.object.visible);
        if (!hits.length) return false;
        freeze(s);
        if (sb.layout.length >= 120) { status("A car can have 120 nodes at most.", "error"); return true; }
        const local = sb.group.worldToLocal(hits[0].point.clone());
        const r = parseFloat($("sbRadius").value) || 0.2;
        sb.layout.push({ x: +local.x.toFixed(4), y: +local.y.toFixed(4), z: +local.z.toFixed(4), r });
        sb.sel.nodes.clear(); sb.sel.beam = null;
        sb.sel.nodes.add(sb.layout.length - 1);       // the new node is the last one: it is selected when the shell is made again
        sb.keepSelection = [sb.layout.length - 1];
        status("Node " + (sb.layout.length - 1) + " added. It joins its nearest neighbours.", "ok");
        changed(true);
        return true;
    }
    function deleteSelected() {
        const s = softBody();
        if (!s || !sb.sel.nodes.size) return;
        freeze(s);
        const gone = new Set(sb.sel.nodes);
        if (sb.layout.length - gone.size < 3) { status("A car needs at least 3 nodes.", "error"); return; }
        // the numbers of the nodes behind a removed one go down: the strengths that were set follow them
        const map = new Map();
        let next = 0;
        sb.layout.forEach((n, i) => { if (!gone.has(i)) map.set(i, next++); });
        sb.layout = sb.layout.filter((n, i) => !gone.has(i));
        sb.nodeEdits = new Map([...sb.nodeEdits].filter(([i]) => map.has(i)).map(([i, e]) => [map.get(i), e]));
        const beams = new Map();
        sb.beamEdits.forEach((b) => {
            if (!map.has(b.a) || !map.has(b.b)) return;
            const a = Math.min(map.get(b.a), map.get(b.b)), c = Math.max(map.get(b.a), map.get(b.b));
            beams.set(a + "-" + c, Object.assign({}, b, { a, b: c }));
        });
        sb.beamEdits = beams;
        sb.sel.nodes.clear(); sb.sel.beam = null;
        status(gone.size + " node" + (gone.size > 1 ? "s" : "") + " removed.", "ok");
        changed(true);
    }
    $("sbDelete").addEventListener("click", deleteSelected);
    window.addEventListener("keydown", (e) => {
        if (!sb.edit || (e.key !== "Delete" && e.key !== "Backspace")) return;
        if (/input|textarea|select/i.test((document.activeElement || {}).tagName || "")) return;
        e.preventDefault();
        deleteSelected();
    });
    $("sbEdit").addEventListener("click", async () => {
        if (!sb.edit && !sb.shown) await show(false);
        if (!softBody()) return;
        sb.edit = !sb.edit;
        $("sbEdit").textContent = sb.edit ? "Stop editing nodes" : "Edit nodes";
        $("sbEdit").classList.toggle("accent", sb.edit);
        $("sbEditBox").style.display = sb.edit ? "" : "none";
        showSelection();
    });
    $("sbResetNodes").addEventListener("click", () => {
        if (!sb.layout) { status("The nodes are the ones made from the model already.", "ok"); return; }
        if (!confirm("Throw away your nodes and make them again from the model? The strengths set on single nodes and beams go too.")) return;
        sb.layout = null; sb.nodeEdits.clear(); sb.beamEdits.clear(); sb.sel.nodes.clear(); sb.sel.beam = null;
        changed(true);
    });

    // ---- the crash test: the car at a speed into a wall
    $("sbSpeed").addEventListener("input", () => { $("sbSpeedLabel").textContent = $("sbSpeed").value + " km/h"; });
    $("sbAngle").addEventListener("input", () => { $("sbAngleLabel").textContent = $("sbAngle").value + "°"; });
    const WALL_Z = 40;
    // the floor and the wall as the triangles of a 3D ground (Ground.js), which the physics of the shell needs
    function crashGround(floorY, angleDeg) {
        const g = new OpenRacer.GroundWorld(5);
        g.use3D = true;
        const tri = (a, b, c, name, drivable) => g.addTriangle3D(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], drivable ? "road" : "wall", name, 0, drivable);
        const R = 300;
        tri([-R, floorY, -R], [-R, floorY, R], [R, floorY, -R], "floor", true);
        tri([R, floorY, R], [R, floorY, -R], [-R, floorY, R], "floor", true);
        const turn = angleDeg * Math.PI / 180, cos = Math.cos(turn), sin = Math.sin(turn);
        const W = 40, H = 6;
        const at = (x, y) => [x * cos + WALL_Z * 0 - 0, floorY + y, WALL_Z + x * sin];      // the wall turned about its middle
        // faces the car (normal to -z, turned with the wall)
        tri(at(-W, 0), at(-W, H), at(W, 0), "wall", false);
        tri(at(W, H), at(W, 0), at(-W, H), "wall", false);
        return g;
    }
    function wallMesh(floorY, angleDeg) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(80, 6, 0.3), new THREE.MeshStandardMaterial({ color: 0x59636f, roughness: 0.9 }));
        mesh.position.set(0, floorY + 3, WALL_Z + 0.15);
        mesh.rotation.y = -angleDeg * Math.PI / 180;
        return mesh;
    }
    async function crash() {
        try {
            if (!bench.vehicle || !softBody()) await api.startBench();
            const s = softBody(), v = bench.vehicle;
            if (!s) throw new Error("The car does not dent: tick “The car dents” first.");
            const speed = parseFloat($("sbSpeed").value) / 3.6, angle = parseFloat($("sbAngle").value);
            const floorY = api.floorY();
            stopCrash();
            sb.wall = wallMesh(floorY, angle);
            scene.add(sb.wall);
            sb.savedGround = sb.savedGround || v.ground;
            v.ground = crashGround(floorY, angle);
            v.reset(0, 0, Math.PI / 2);
            v.pz = WALL_Z - 1.5 - 2.2 - speed * 0.9;
            v.vz = speed;
            v.wheels.forEach((w) => { w.omega = speed / w.radius; });
            Object.assign(bench.input, { parkingLock: false, neutral: true, throttle: 0, brakePedal: 0, handbrake: false });     // it rolls: no brake before the wall
            bench.shake = null; bench.script = null;
            sb.crash = { t: 0, speed, energy: 0.5 * v.mass * speed * speed, startZ: v.pz, peakG: 0, lastU: speed, stopped: 0 };
            $("sbResult").textContent = "Driving at " + (speed * 3.6).toFixed(0) + " km/h…";
            if (!sb.shown) await show(false);
        } catch (error) { status(error.message, "error"); }
    }
    function crashFrame(dt) {
        const c = sb.crash, v = bench.vehicle, s = softBody();
        c.t += dt;
        const u = v.vz;
        c.peakG = Math.max(c.peakG, Math.abs(u - c.lastU) / Math.max(dt, 1e-3) / 9.81);
        c.lastU = u;
        // the camera follows the car
        const dx = v.px - controls.target.x, dy = v.py - controls.target.y, dz = v.pz - controls.target.z;
        controls.target.x += dx * 0.08; controls.target.y += dy * 0.08; controls.target.z += dz * 0.08;
        camera.position.x += dx * 0.08; camera.position.y += dy * 0.08; camera.position.z += dz * 0.08;
        const st = s.stats();
        const events = bench.obj.parts ? bench.obj.parts.events.length : 0;
        $("sbResult").textContent = "Peak " + c.peakG.toFixed(0) + " g · bend " + (st.maxBend * 100).toFixed(0) + " cm · took up " + (st.absorbed / 1000).toFixed(0) + " kJ of " +
            (c.energy / 1000).toFixed(0) + " kJ · " + st.brokenAnchors + " anchors and " + st.brokenBeams + " beams torn" + (events ? " · " + events + " part events" : "");
        if (Math.abs(u) < 0.3 && c.t > 1) { c.stopped += dt; if (c.stopped > 1.5) sb.crash = null; }
        if (c.t > 25) sb.crash = null;
    }
    function stopCrash() {
        sb.crash = null;
        if (sb.wall) { scene.remove(sb.wall); sb.wall = null; }
        if (bench.vehicle && sb.savedGround) { bench.vehicle.ground = sb.savedGround; }
    }
    $("sbCrash").addEventListener("click", crash);
    $("sbRepair").addEventListener("click", () => {
        const v = bench.vehicle;
        if (!v) return;
        stopCrash();
        sb.savedGround = null;
        v.reset(0, 0, Math.PI / 2);
        $("sbResult").textContent = "Repaired.";
    });

    // the bench stops: the shell and the wall go
    function onStop() {
        if (!sb.restarting) { sb.edit = false; $("sbEdit").textContent = "Edit nodes"; $("sbEdit").classList.remove("accent"); $("sbEditBox").style.display = "none"; sb.sel.nodes.clear(); sb.sel.beam = null; }
        stopCrash();
        sb.savedGround = null;
        hide();
        $("sbInfo").textContent = "";
        $("sbResult").textContent = "";
    }

    return { read, fill, frame, onStop, changed };
}
