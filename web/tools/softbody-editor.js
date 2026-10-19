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

import { TransformControls } from "three/addons/controls/TransformControls.js";

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
    const sb = { nodeEdits: new Map(), beamEdits: new Map(), parts: [], shown: false, group: null, points: null, lines: null, hinges: [], sel: { nodes: new Set(), beam: null }, layout: null, edit: false, keepSelection: null, crash: null, wall: null, dirty: false, partWin: null, partMode: null, pinSel: -1, win: null, partGroup: null, deferRestart: false };

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
    $("sbMaxNodes").addEventListener("change", () => { if (!sb.layout) changed(); });

    // the shell is made again from the new settings when the bench runs
    let restartTimer = 0;
    function changed(keep) {
        sb.dirty = true;                                  // the bench has to be made again before the next test
        scheduleSave();
        clearTimeout(restartTimer);
        if (sb.deferRestart) return;                      // nodes are being added: the bench is made again when that stops
        if (bench.vehicle && (sb.shown || sb.crash)) restartTimer = setTimeout(async () => { sb.crash = null; sb.restarting = true; await show(true); sb.restarting = false; }, keep === true ? 150 : 400);
    }

    // ---- the parts
    const MODES = [["hinge", "Hinge"], ["detachable", "Loose"]];
    function partRow(part, index) {
        const row = document.createElement("div");
        row.className = "material";
        const h = part.hinge || {};
        const vec = (v, d) => (v || d).join(", ");
        const set = (f, label) => '<button type="button" class="small ghost set" data-set="' + f + '">' + label + "</button>";
        row.innerHTML =
            '<div class="row"><div><label>Object of the model ' + set("object", "Pick on the model") + '</label><input type="text" list="sbObjectNames" data-f="object"></div>' +
            '<div><label>Behaviour</label><select data-f="mode">' + MODES.map((m) => '<option value="' + m[0] + '">' + m[1] + "</option>").join("") + "</select></div>" +
            '<div><label>Mass (kg)</label><input type="number" data-f="mass" step="0.5" min="0.1"></div>' +
            '<div class="fixed"><label>&nbsp;</label><button class="small ghost" data-f="remove">Remove</button></div></div>' +
            '<div class="row loose"><div><label>Breaks loose at (kN)</label><input type="number" data-f="break_force" step="0.5" min="0"></div><div></div><div></div></div>' +
            '<div class="row"><div><label>Held by nodes ' + set("heldBy", "Set = selected nodes") + '</label><input type="text" data-f="heldBy" placeholder="the 3 nearest"></div></div>' +
            '<div class="row"><div><label>Own nodes of the part ' + set("partNodes", "Set = selected nodes") + set("partNodesClear", "Clear") + '</label><div class="hint" data-f="partNodesInfo"></div></div></div>' +
            '<div class="hinge"><div class="row"><div><label>Hinge point A (node) ' + set("mA", "Set = selected node") + '</label><input type="number" data-f="mA" step="1" min="0"></div><div><label>tears off at (kN)</label><input type="number" data-f="mAf" step="1" min="0" placeholder="0: never"></div>' +
            '<div><label>Hinge point B (node) ' + set("mB", "Set = selected node") + '</label><input type="number" data-f="mB" step="1" min="0"></div><div><label>tears off at (kN)</label><input type="number" data-f="mBf" step="1" min="0" placeholder="0: never"></div></div>' +
            '<div class="row"><div><label>Point A on the surface (x, y, z) ' + set("mAPick", "Pick point") + '</label><input type="text" data-f="mApt" placeholder="instead of a node"></div>' +
            '<div><label>Point B on the surface (x, y, z) ' + set("mBPick", "Pick point") + '</label><input type="text" data-f="mBpt" placeholder="instead of a node"></div></div>' +
            '<div class="row"><div><label>Origin x, y, z (m) ' + set("originNode", "Node") + set("originPick", "Pick point") + '</label><input type="text" data-f="origin" placeholder="the middle of the part"></div>' +
            '<div><label>Axis ' + set("axisAB", "A→B") + set("axisX", "X") + set("axisY", "Y") + set("axisZ", "Z") + '</label><input type="text" data-f="axis" placeholder="0, 1, 0"></div></div>' +
            '<div class="row"><div><label>Lowest angle (°)</label><input type="number" data-f="min" step="5" placeholder="-90"></div>' +
            '<div><label>Highest angle (°)</label><input type="number" data-f="max" step="5" placeholder="90"></div>' +
            '<div><label>Rest angle (°)</label><input type="number" data-f="rest" step="5" placeholder="0"></div></div>' +
            '<div class="row"><div><label>Spring (N·m/rad)</label><input type="number" data-f="spring" step="1" min="0" placeholder="0"></div>' +
            '<div><label>Damper (N·m·s/rad)</label><input type="number" data-f="damper" step="0.5" min="0" placeholder="0"></div>' +
            '<div><label>Latch force (kN)</label><input type="number" data-f="latch" step="0.5" min="0" placeholder="3 g of the part; 0: open"></div>' +
            '<div><label>Tears off at (kN)</label><input type="number" data-f="hinge_break" step="1" min="0" placeholder="0: never"></div></div></div>';
        const q = (f) => row.querySelector('[data-f="' + f + '"]');
        q("object").value = part.object || "";
        q("mode").value = part.mode || "hinge";
        q("mass").value = part.mass !== undefined ? part.mass : 10;
        q("break_force").value = part.break_force !== undefined ? part.break_force / 1000 : "";
        q("origin").value = h.origin ? vec(h.origin) : "";
        q("axis").value = h.axis ? vec(h.axis) : "";
        ["min", "max", "rest", "spring", "damper"].forEach((f) => { q(f).value = h[f] !== undefined ? h[f] : ""; });
        const m = part.mounts || [];
        q("mA").value = m[0] && m[0].node !== undefined ? m[0].node : ""; q("mApt").value = m[0] && m[0].point ? vec(m[0].point) : ""; q("mAf").value = m[0] && m[0].break_force ? m[0].break_force / 1000 : "";
        q("mB").value = m[1] && m[1].node !== undefined ? m[1].node : ""; q("mBpt").value = m[1] && m[1].point ? vec(m[1].point) : ""; q("mBf").value = m[1] && m[1].break_force ? m[1].break_force / 1000 : "";
        q("heldBy").value = (part.nodes || []).join(", ");
        q("latch").value = h.latch_force !== undefined ? h.latch_force / 1000 : "";
        q("hinge_break").value = h.break_force !== undefined ? h.break_force / 1000 : "";
        const showMode = () => {
            const hinge = q("mode").value === "hinge";
            row.querySelector(".hinge").style.display = hinge ? "" : "none";
            row.querySelector(".loose").style.display = hinge ? "none" : "";
        };
        showMode();
        row.addEventListener("change", () => { readRow(row, part); showMode(); changed(); drawHinges(); });
        row.addEventListener("click", (e) => { const b = e.target.closest("[data-set]"); if (b) setField(row, part, b.dataset.set); });
        const own = sb.layout ? sb.layout.filter((n) => n.part === part.object).length : 0;
        q("partNodesInfo").textContent = own ? own + " nodes of its own (orange in the view)" : "none: the part is one rigid piece";
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
        const held = q("heldBy").value.split(/[\s,;]+/).filter(Boolean).map((x) => parseInt(x, 10)).filter((x) => x >= 0);
        if (held.length) part.nodes = held; else delete part.nodes;
        if (part.mode === "hinge") {
            const hinge = {};
            const origin = numbers(q("origin").value), axis = numbers(q("axis").value);
            if (origin) hinge.origin = origin;
            if (axis) hinge.axis = axis;
            ["min", "max", "rest", "spring", "damper"].forEach((f) => { if (n(f) !== undefined) hinge[f] = n(f); });
            if (n("latch") !== undefined) hinge.latch_force = n("latch") * 1000;
            if (n("hinge_break")) hinge.break_force = n("hinge_break") * 1000;
            part.hinge = hinge;
            const mounts = [];
            [["mA", "mAf", "mApt"], ["mB", "mBf", "mBpt"]].forEach(([nf, ff, pf]) => {
                const point = numbers(q(pf).value);
                let mount;
                if (point) mount = { point };                                       // a point on the surface wins over a node
                else if (n(nf) !== undefined && n(nf) >= 0) mount = { node: n(nf) };
                else return;
                if (n(ff)) mount.break_force = n(ff) * 1000;
                mounts.push(mount);
            });
            // the pin points of the part window have more than the fields here (axes, angles, more than two): they are kept
            const prev = part.mounts || [];
            mounts.forEach((m, i) => { const old = prev[i]; if (old && old.axes && JSON.stringify(old.point || null) === JSON.stringify(m.point || null) && old.node === m.node) { m.axes = old.axes; m.min = old.min; m.max = old.max; if (old.rot) m.rot = old.rot; if (old.activate_force) m.activate_force = old.activate_force; } });
            if (prev.length > 2) prev.slice(2).forEach((m) => mounts.push(m));
            if (mounts.length) part.mounts = mounts; else delete part.mounts;
            delete part.break_force;
        } else {
            if (n("break_force")) part.break_force = n("break_force") * 1000; else delete part.break_force;
            delete part.hinge; delete part.mounts;
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
    // the panel is not modal: it stays beside the view, so nodes can be selected while it is open
    $("sbPartsOpen").addEventListener("click", () => { const d = $("dlgParts"); if (d.open) d.close(); else { renderParts(); d.show(); } });


    // The Set buttons of a part: the value comes from what is selected in the view, or from a click on the model
    function setField(row, part, what) {
        const s = softBody();
        const q = (f) => row.querySelector('[data-f="' + f + '"]');
        const put = (f, value) => { q(f).value = value; q(f).dispatchEvent(new Event("change", { bubbles: true })); };
        const fail = (text) => status(text, "error");
        if (!s || !sb.shown) { fail("Show the shell first (the Soft body card), then select nodes in the view."); return; }
        const one = () => { if (sb.sel.nodes.size !== 1) { fail("Select one node in the view (a click on it)."); return null; } return [...sb.sel.nodes][0]; };
        const rest = new THREE.Vector3();
        switch (what) {
            case "mA": case "mB": { const k = one(); if (k !== null) { q(what + "pt").value = ""; put(what, k); status("Node " + k + " is the hinge point " + what.slice(1) + ".", "ok"); } break; }
            case "heldBy":
                if (!sb.sel.nodes.size) { fail("Select the nodes that hold the part in the view."); break; }
                put("heldBy", [...sb.sel.nodes].join(", ")); break;
            case "originNode": { const k = one(); if (k !== null) { s.restPosition(k, rest); put("origin", [rest.x, rest.y, rest.z].map((x) => x.toFixed(3)).join(", ")); } break; }
            case "mAPick": case "mBPick": sb.pick = { type: "mount", part, row, field: what.slice(0, 2) + "pt", node: what.slice(0, 2) }; status("Click the model where the pin point is.", "ok"); break;
            case "originPick": sb.pick = { type: "origin", part, row }; status("Click the model where the hinge is.", "ok"); break;
            case "object": sb.pick = { type: "object", part, row }; status("Click the part on the model.", "ok"); break;
            case "axisAB": {
                const place = (f, nf) => {
                    const pt = numbers(q(f).value);
                    if (pt) return new THREE.Vector3(...pt);
                    const k = parseInt(q(nf).value, 10);
                    return k >= 0 && k < s.count ? s.restPosition(k, new THREE.Vector3()) : null;
                };
                const p1 = place("mApt", "mA"), p2 = place("mBpt", "mB");
                if (!p1 || !p2 || p1.distanceTo(p2) < 1e-4) { fail("Set the hinge points A and B first (a node or a point on the surface)."); break; }
                p2.sub(p1).normalize();
                put("axis", [p2.x, p2.y, p2.z].map((x) => x.toFixed(3)).join(", ")); break;
            }
            case "axisX": put("axis", "1, 0, 0"); break;
            case "axisY": put("axis", "0, 1, 0"); break;
            case "axisZ": put("axis", "0, 0, 1"); break;
            case "partNodes":
                if (!sb.sel.nodes.size) { fail("Select the nodes of the part in the view first (a click, or a lasso with the middle mouse button)."); break; }
                assignPartNodes(part); break;
            case "partNodesClear":
                if (sb.layout) { sb.layout.forEach((n) => { if (n.part === part.object) delete n.part; }); changed(true); renderParts(); }
                break;
        }
    }
    // a click on the model while a Set button waits for it
    function handlePick(mx, my, rect) {
        const pick = sb.pick;
        const hit = surfaceAt(mx, my, rect);
        if (!hit) return;
        sb.pick = null;
        const field = (f) => pick.row.querySelector('[data-f="' + f + '"]');
        const put = (f, value) => { field(f).value = value; field(f).dispatchEvent(new Event("change", { bubbles: true })); };
        if (pick.type === "mount") {
            const local = sb.group.worldToLocal(hit.point.clone());
            pick.row.querySelector('[data-f="' + pick.node + '"]').value = "";
            put(pick.field, [local.x, local.y, local.z].map((x) => x.toFixed(3)).join(", "));
            status("The pin point is on the surface where you clicked. The hinge goes through the points A and B.", "ok");
        } else if (pick.type === "origin") {
            const local = sb.group.worldToLocal(hit.point.clone());
            put("origin", [local.x, local.y, local.z].map((x) => x.toFixed(3)).join(", "));
            status("The hinge origin is on the surface where you clicked.", "ok");
        } else {
            const names = [];
            for (let o = hit.object; o && o !== bench.model.tilt; o = o.parent) if (o.name) names.push(o.name);
            if (!names.length) { status("That object has no name in the model.", "error"); return; }
            // the group around the mesh when there is one (a part is usually a group of meshes)
            put("object", names.length > 1 ? names[1] : names[0]);
            status("Object: " + names.join(" ← ") + ". Used: " + (names.length > 1 ? names[1] : names[0]) + " (type another name of the list if you mean another level).", "ok");
        }
    }

    // the nodes of a part: the selected nodes get its name in the layout (the nodes of a part are joined to each other, and to the body by the links of its hinge points)
    function assignPartNodes(part) {
        const s = softBody();
        freeze(s);
        sb.layout.forEach((n) => { if (n.part === part.object) delete n.part; });
        sb.sel.nodes.forEach((k) => { if (sb.layout[k]) sb.layout[k].part = part.object; });
        changed(true);
        renderParts();
    }

    // ---- what is saved
    function read() {
        const out = { softbody: null, parts: null };
        const soft = readSettings();
        if ($("sbEnabled").checked === false) soft.enabled = false;
        const nodes = [...sb.nodeEdits].map(([i, e]) => Object.assign({ i }, e));
        const beams = [...sb.beamEdits.values()];
        const max = parseInt($("sbMaxNodes").value, 10);
        if (max >= 10) soft.max_nodes = Math.min(120, max);
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
        $("sbMaxNodes").value = soft.max_nodes || "";
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
            if (restart || !bench.vehicle) { await api.startBench(); sb.dirty = false; }
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
        tc.detach();
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
        const room = Math.max(B, 1200);                  // while a node is dragged the beams are made again and may be more
        lineGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6 * room), 3));
        lineGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(6 * room), 3));
        lineGeo.setDrawRange(0, 2 * B);
        sb.lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.8 }));
        sb.lines.renderOrder = 9; sb.lines.frustumCulled = false;
        group.add(sb.lines, sb.points);
        sb.group = group;
        scene.add(group);
        sb.pivot = new THREE.Object3D();
        group.add(sb.pivot);
        drawHinges();
        updateShell();
        showSelection();
    }

    // the lines of the hinges follow the nodes
    function updateMounts(s) {
        if (!sb.mountLines) return;
        const pos = sb.mountLines.geometry.attributes.position, p = new THREE.Vector3(), q = new THREE.Vector3();
        let n = 0;
        sb.parts.forEach((part) => {
            const m = (part.mounts || []).filter((x) => x.point || x.node < s.count);
            const at = (mount, out) => (mount.point ? out.set(mount.point[0], mount.point[1], mount.point[2]) : s.position(mount.node, out));
            if (m.length >= 2 && n < 38) {
                at(m[0], p); at(m[1], q);
                pos.setXYZ(2 * n, p.x, p.y, p.z); pos.setXYZ(2 * n + 1, q.x, q.y, q.z); n++;
            }
            if (m.length >= 1) {
                (part.nodes || []).forEach((k) => {
                    if (k >= s.count || n >= 39) return;
                    at(m[0], p); s.position(k, q);
                    pos.setXYZ(2 * n, p.x, p.y, p.z); pos.setXYZ(2 * n + 1, q.x, q.y, q.z); n++;
                });
            }
        });
        sb.mountLines.geometry.setDrawRange(0, 2 * n);
        pos.needsUpdate = true;
    }

    // the hinges as arrows: the origin and the axis of every part that has them
    function drawHinges() {
        if (!sb.group) return;
        sb.hinges.forEach((a) => sb.group.remove(a));
        sb.hinges = [];
        if (sb.mountLines) { sb.group.remove(sb.mountLines); sb.mountLines = null; }
        const withMounts = sb.parts.filter((p) => p.mounts && p.mounts.length);
        if (withMounts.length) {
            // the hinge as a line between its two points, and a line from each of them to the nodes that hold the part shut
            const g = new THREE.BufferGeometry();
            g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3 * 2 * 40), 3));
            sb.mountLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xff9f43, depthTest: false, linewidth: 2 }));
            sb.mountLines.renderOrder = 12; sb.mountLines.frustumCulled = false;
            sb.group.add(sb.mountLines);
        }
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
        if (sb.pushMode) pushReading();
        if (sb.group) updateShell();
        placePartGroup();
    }
    function updateShell() {
        const s = softBody(), v = bench.vehicle;
        if (!s || !sb.group) return;
        sb.group.position.set(v.px, v.py, v.pz);
        sb.group.quaternion.set(v.qx, v.qy, v.qz, v.qw);
        if (sb.dragging) { dragPreview(s); return; }
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
            if (sb.layout && sb.layout[k] && sb.layout[k].inner && s.alive(k)) tint.setRGB(0.35, 0.6, 1);
            if (sb.layout && sb.layout[k] && sb.layout[k].part && s.alive(k)) tint.setRGB(1, 0.62, 0.26);
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
        sb.lines.geometry.setDrawRange(0, 2 * s.beamCount);
        updateMounts(s);
    }

    // ---- the gizmo: the selected nodes can be moved; the beams are made again from the nearest neighbours while they move
    const tc = new TransformControls(camera, renderer.domElement);
    tc.setSize(0.7);
    scene.add(typeof tc.getHelper === "function" ? tc.getHelper() : tc);
    let lastPivot = new THREE.Vector3();
    tc.addEventListener("dragging-changed", (event) => {
        controls.enabled = !event.value;
        const s = softBody();
        if (event.value) {
            if (!s) return;
            freeze(s);                                          // the nodes are a list of the car from the first move on
            sb.dragging = true;
            lastPivot.copy(sb.pivot.position);
        } else if (sb.dragging) {
            sb.dragging = false;
            changed(true);                                      // the shell is made again from the new places
        }
    });
    tc.addEventListener("objectChange", () => {
        if (!sb.dragging || !sb.layout) return;
        const dx = sb.pivot.position.x - lastPivot.x, dy = sb.pivot.position.y - lastPivot.y, dz = sb.pivot.position.z - lastPivot.z;
        lastPivot.copy(sb.pivot.position);
        sb.sel.nodes.forEach((k) => { const n = sb.layout[k]; if (n) { n.x += dx; n.y += dy; n.z += dz; } });
    });
    // the gizmo sits on the middle of the selected nodes
    function attachGizmo() {
        const s = softBody();
        if (!s || !sb.group || !sb.pivot || !sb.shown || !sb.sel.nodes.size || sb.dragging) { if (!sb.dragging) tc.detach(); return; }
        const mid = new THREE.Vector3(), p = new THREE.Vector3();
        sb.sel.nodes.forEach((k) => { if (sb.layout && sb.layout[k]) p.set(sb.layout[k].x, sb.layout[k].y, sb.layout[k].z); else s.restPosition(k, p); mid.add(p); });
        mid.multiplyScalar(1 / sb.sel.nodes.size);
        sb.pivot.position.copy(mid);
        sb.pivot.quaternion.identity();
        tc.attach(sb.pivot);
    }
    // while a node is dragged: the points from the list of the car, and the beams from the nearest neighbours (as SoftBody.js makes them)
    function dragPreview(s) {
        const list = sb.layout, N = list.length;
        const near = parseInt((document.querySelector('input.sb[data-key="neighbours"]') || {}).value, 10) || DEFAULTS.neighbours;
        const reach = parseFloat((document.querySelector('input.sb[data-key="reach"]') || {}).value) || DEFAULTS.reach;
        const pos = sb.points.geometry.attributes.position, col = sb.points.geometry.attributes.color;
        for (let k = 0; k < N; k++) {
            pos.setXYZ(k, list[k].x, list[k].y, list[k].z);
            if (sb.sel.nodes.has(k)) tint.setRGB(1, 1, 1); else if (list[k].part) tint.setRGB(1, 0.62, 0.26); else if (list[k].inner) tint.setRGB(0.35, 0.6, 1); else tint.setRGB(0.3, 0.85, 0.35);
            col.setXYZ(k, tint.r, tint.g, tint.b);
        }
        pos.needsUpdate = true; col.needsUpdate = true;
        const lp = sb.lines.geometry.attributes.position, lc = sb.lines.geometry.attributes.color;
        const seen = new Set();
        let n = 0;
        for (let a = 0; a < N && n < 1200; a++) {
            const close = [];
            for (let b = 0; b < N; b++) {
                if (a === b || (list[a].part || null) !== (list[b].part || null)) continue;
                const d = Math.hypot(list[a].x - list[b].x, list[a].y - list[b].y, list[a].z - list[b].z);
                if (d < reach && d > 0.02) close.push([d, b]);
            }
            close.sort((x, y) => x[0] - y[0]);
            for (let m = 0; m < Math.min(near, close.length) && n < 1200; m++) {
                const lo = Math.min(a, close[m][1]), hi = Math.max(a, close[m][1]), key = lo * 4096 + hi;
                if (seen.has(key)) continue;
                seen.add(key);
                lp.setXYZ(2 * n, list[lo].x, list[lo].y, list[lo].z); lp.setXYZ(2 * n + 1, list[hi].x, list[hi].y, list[hi].z);
                const moving = sb.sel.nodes.has(lo) || sb.sel.nodes.has(hi);
                tint.setRGB(moving ? 1 : 0.3, moving ? 1 : 0.55, moving ? 1 : 0.9);
                lc.setXYZ(2 * n, tint.r, tint.g, tint.b); lc.setXYZ(2 * n + 1, tint.r, tint.g, tint.b);
                n++;
            }
        }
        sb.lines.geometry.setDrawRange(0, 2 * n);
        lp.needsUpdate = true; lc.needsUpdate = true;
    }

    // ---- selecting nodes and beams: a click, Shift and a click to add, and a lasso with the middle mouse button
    const lassoCanvas = document.createElement("canvas");
    lassoCanvas.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:5";
    renderer.domElement.parentElement.appendChild(lassoCanvas);
    let down = null, lasso = null;
    const savedMiddle = controls.mouseButtons.MIDDLE;
    renderer.domElement.addEventListener("pointerdown", (e) => {
        if (e.button === 0 && !tc.axis && !rc.axis) down = { x: e.clientX, y: e.clientY };           // a press on a gizmo is no click on the model
        if (!sb.shown || !softBody()) return;
        if (e.button === 1) {
            e.preventDefault();
            const rect = renderer.domElement.getBoundingClientRect();
            lasso = { points: [[e.clientX - rect.left, e.clientY - rect.top]], add: e.shiftKey || e.ctrlKey };
            controls.mouseButtons.MIDDLE = -1;                      // the middle button is not the dolly of the orbit controls now
            try { renderer.domElement.setPointerCapture(e.pointerId); } catch (error) { /* a synthetic event */ }
        }
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
        if (!down || e.button !== 0) return;
        const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
        down = null;
        if (moved > 4) return;
        if (partClick(e)) return;                                   // the part window: a pin point, a node of the part, or the window of a loose object
        if (!sb.shown || !softBody()) return;
        click(e);
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
        if (sb.pick) { handlePick(mx, my, rect); return; }
        if (sb.pushMode) { applyForceAt(mx, my, rect); return; }
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
        attachGizmo();
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
        if (sb.layout.length >= 200) { status("A car can have 200 nodes at most.", "error"); return true; }
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
        if (sb.sel.nodes.size) removeNodes(new Set(sb.sel.nodes));
    }
    function removeNodes(gone) {
        const s = softBody();
        if (!s || !gone.size) return;
        freeze(s);
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

    // ---- the scan: rays at the model from all round the car make the nodes of the shell, then the inside of the shell is worked out
    const tick = () => new Promise((r) => setTimeout(r, 0));
    function modelMeshes() { const list = []; bench.model.tilt.traverse((o) => { if (o.isMesh && o.visible && o.geometry) list.push(o); }); return list; }
    // The triangles of the model in a grid of 0.25 m cells, in the world: a ray visits the cells along its way, so thousands of rays cost
    // next to nothing (three.js tests every triangle of the model for every ray). Both sides of a triangle count; back is true when the ray
    // hits the back of it, which is how the inside is known.
    function triangleGrid(meshes) {
        const CELL = 0.25;
        const tris = [], grid = new Map();
        const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
        meshes.forEach((mesh) => {
            const pos = mesh.geometry.attributes.position, index = mesh.geometry.index;
            const n = index ? index.count : pos.count;
            for (let i = 0; i < n; i += 3) {
                const i0 = index ? index.getX(i) : i, i1 = index ? index.getX(i + 1) : i + 1, i2 = index ? index.getX(i + 2) : i + 2;
                a.fromBufferAttribute(pos, i0).applyMatrix4(mesh.matrixWorld);
                b.fromBufferAttribute(pos, i1).applyMatrix4(mesh.matrixWorld);
                c.fromBufferAttribute(pos, i2).applyMatrix4(mesh.matrixWorld);
                const id = tris.length / 9;
                tris.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
                const lo = [Math.min(a.x, b.x, c.x), Math.min(a.y, b.y, c.y), Math.min(a.z, b.z, c.z)];
                const hi = [Math.max(a.x, b.x, c.x), Math.max(a.y, b.y, c.y), Math.max(a.z, b.z, c.z)];
                if ((hi[0] - lo[0]) / CELL > 40 || (hi[1] - lo[1]) / CELL > 40 || (hi[2] - lo[2]) / CELL > 40) continue;
                for (let x = Math.floor(lo[0] / CELL); x <= Math.floor(hi[0] / CELL); x++)
                    for (let y = Math.floor(lo[1] / CELL); y <= Math.floor(hi[1] / CELL); y++)
                        for (let z = Math.floor(lo[2] / CELL); z <= Math.floor(hi[2] / CELL); z++) {
                            const key = (x + 512) * 1048576 + (y + 512) * 1024 + (z + 512);
                            const list = grid.get(key);
                            if (list) list.push(id); else grid.set(key, [id]);
                        }
            }
        });
        const stamp = new Int32Array(tris.length / 9);
        let stampValue = 0;
        // the nearest hit of the ray (origin o, unit direction d) within maxT: { t, back } or null
        return function cast(ox, oy, oz, dx, dy, dz, maxT) {
            stampValue++;
            let bestT = Infinity, back = false, lastKey = -1;
            for (let t = 0; t <= maxT + CELL; t += CELL * 0.45) {
                const x = Math.floor((ox + dx * t) / CELL), y = Math.floor((oy + dy * t) / CELL), z = Math.floor((oz + dz * t) / CELL);
                const key = (x + 512) * 1048576 + (y + 512) * 1024 + (z + 512);
                if (key === lastKey) continue;
                lastKey = key;
                const list = grid.get(key);
                if (list) {
                    for (const id of list) {
                        if (stamp[id] === stampValue) continue;
                        stamp[id] = stampValue;
                        const o = id * 9;
                        const e1x = tris[o + 3] - tris[o], e1y = tris[o + 4] - tris[o + 1], e1z = tris[o + 5] - tris[o + 2];
                        const e2x = tris[o + 6] - tris[o], e2y = tris[o + 7] - tris[o + 1], e2z = tris[o + 8] - tris[o + 2];
                        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
                        const det = e1x * px + e1y * py + e1z * pz;
                        if (det > -1e-12 && det < 1e-12) continue;
                        const inv = 1 / det;
                        const tx = ox - tris[o], ty = oy - tris[o + 1], tz = oz - tris[o + 2];
                        const u = (tx * px + ty * py + tz * pz) * inv;
                        if (u < 0 || u > 1) continue;
                        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
                        const v = (dx * qx + dy * qy + dz * qz) * inv;
                        if (v < 0 || u + v > 1) continue;
                        const hit = (e2x * qx + e2y * qy + e2z * qz) * inv;
                        if (hit < 0 || hit > maxT || hit >= bestT) continue;
                        bestT = hit;
                        // the normal e1 x e2 points to the front: the ray comes from the front when it goes against it
                        const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
                        back = nx * dx + ny * dy + nz * dz > 0;
                    }
                }
                if (bestT < t) break;            // the nearest hit lies behind the cells that were looked in: no triangle of the next cells is nearer
            }
            return bestT === Infinity ? null : { t: bestT, back };
        };
    }
    // greedy: the point that is farthest from the ones chosen, again and again, so the nodes lie even over the shape
    function spread(points, count, chosen, minGap) {
        const dist = points.map((p) => chosen.reduce((m, c) => Math.min(m, p.distanceToSquared(c)), 1e9));
        const out = [];
        while (out.length < count) {
            let best = -1, bestD = minGap * minGap;
            for (let i = 0; i < points.length; i++) if (dist[i] > bestD) { bestD = dist[i]; best = i; }
            if (best < 0) break;
            out.push(points[best]);
            for (let i = 0; i < points.length; i++) dist[i] = Math.min(dist[i], points[i].distanceToSquared(points[best]));
        }
        return out;
    }
    async function scan() {
        try {
            if (!sb.shown) await show(false);
            const s = softBody();
            if (!s) return;
            const max = Math.min(120, Math.max(10, parseInt($("sbMaxNodes").value, 10) || 80));
            if (sb.layout && !confirm("Make new nodes with the rays? The nodes you made and the strengths set on single nodes go.")) return;
            const meshes = modelMeshes();
            bench.model.tilt.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(bench.model.tilt);
            sb.group.updateMatrixWorld(true);
            status("Scanning the model with rays…");
            await tick();
            const cast = triangleGrid(meshes);
            const surface = [];
            {
                const step = 0.1;
                const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
                let count = 0;
                for (const d of dirs) {
                    const dir = new THREE.Vector3(...d);
                    // a grid on the face of the box that the ray starts from
                    const a = d[0] ? [1, 2] : d[1] ? [0, 2] : [0, 1];
                    const lo = box.min.toArray(), hi = box.max.toArray();
                    for (let u = lo[a[0]] + step / 2; u < hi[a[0]]; u += step) {
                        for (let w = lo[a[1]] + step / 2; w < hi[a[1]]; w += step) {
                            const o = [0, 0, 0];
                            const axis = d[0] ? 0 : d[1] ? 1 : 2;
                            o[a[0]] = u; o[a[1]] = w; o[axis] = d[axis] > 0 ? lo[axis] - 0.1 : hi[axis] + 0.1;
                            const span = hi[axis] - lo[axis] + 0.2;
                            const hit = cast(o[0], o[1], o[2], d[0], d[1], d[2], span);
                            if (hit) surface.push(sb.group.worldToLocal(new THREE.Vector3(o[0] + d[0] * hit.t, o[1] + d[1] * hit.t, o[2] + d[2] * hit.t)));
                            if (++count % 2000 === 0) await tick();
                        }
                    }
                }
            }
            if (surface.length < 20) throw new Error("The rays hit almost nothing of the model.");
            const surfaceCount = $("sbScanInside").checked ? Math.round(max * 0.7) : max;
            const picked = spread(surface, surfaceCount, [], 0.05);
            // the size of a node: from how far apart they lie
            let gap = 0;
            picked.forEach((p, i) => { let m = 1e9; picked.forEach((q, j) => { if (i !== j) m = Math.min(m, p.distanceTo(q)); }); gap += m; });
            gap /= picked.length;
            const r = +Math.min(0.3, Math.max(0.08, gap * 0.55)).toFixed(3);
            sb.layout = picked.map((p) => ({ x: +p.x.toFixed(4), y: +p.y.toFixed(4), z: +p.z.toFixed(4), r }));
            sb.nodeEdits.clear(); sb.beamEdits.clear(); sb.sel.nodes.clear(); sb.sel.beam = null;
            let inner = 0;
            if ($("sbScanInside").checked) inner = await fillInside(max, box, meshes);
            status(sb.layout.length + " nodes: " + picked.length + " on the surface" + (inner ? " and " + inner + " inside" : "") + ".", "ok");
            changed(true);
        } catch (error) { status(error.message, "error"); }
    }
    // The inside of the shell: points of a grid that lie inside the model (a ray from them hits the back of a surface, in most directions), the
    // ones farthest from the nodes that there are, up to the most nodes
    async function fillInside(max, box, meshes) {
        bench.model.tilt.updateMatrixWorld(true);
        box = box || new THREE.Box3().setFromObject(bench.model.tilt);
        meshes = meshes || modelMeshes();
        sb.group.updateMatrixWorld(true);
        const room = Math.min(120, max) - sb.layout.length;
        if (room < 1) return 0;
        const cell = 0.2, inside = [];
        const dirs = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
        const cast = triangleGrid(meshes);
        const reach = 8;
        let count = 0;
        for (let x = box.min.x + cell / 2; x < box.max.x; x += cell) {
            for (let y = box.min.y + cell / 2; y < box.max.y; y += cell) {
                for (let z = box.min.z + cell / 2; z < box.max.z; z += cell) {
                    // inside when most directions see the back of a surface first (the car is open at the windows and the wheel arches)
                    let votes = 0;
                    for (const d of dirs) { const hit = cast(x, y, z, d[0], d[1], d[2], reach); if (hit && hit.back) votes++; }
                    if (votes >= 5) inside.push(sb.group.worldToLocal(new THREE.Vector3(x, y, z)));
                    if (++count % 1500 === 0) await tick();
                }
            }
        }
        const chosen = sb.layout.map((n) => new THREE.Vector3(n.x, n.y, n.z));
        const picked = spread(inside, room, chosen, 0.22);
        picked.forEach((p) => sb.layout.push({ x: +p.x.toFixed(4), y: +p.y.toFixed(4), z: +p.z.toFixed(4), r: 0.12, inner: true }));
        return picked.length;
    }
    $("sbScan").addEventListener("click", scan);
    $("sbInside").addEventListener("click", async () => {
        try {
            if (!sb.shown) await show(false);
            const s = softBody();
            if (!s) return;
            freeze(s);
            status("Working out the inside…");
            const max = Math.min(120, Math.max(10, parseInt($("sbMaxNodes").value, 10) || 100));
            const added = await fillInside(max);
            status(added ? added + " nodes added inside." : "No room for more nodes inside (raise the most nodes), or no gap left.", added ? "ok" : "");
            if (added) changed(true);
        } catch (error) { status(error.message, "error"); }
    });

    // ---- apply force: an arrow on the surface under the mouse, and a click presses a flat invisible plate on the car with that force
    const hover = new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), new THREE.Vector3(), 0.8, 0xff9f43, 0.3, 0.18);
    hover.visible = false;
    hover.traverse((o) => { if (o.material) { o.material.depthTest = false; o.renderOrder = 13; } });
    scene.add(hover);
    // the point of the model under the mouse, and its outer normal, in the world
    function surfaceAt(mx, my, rect) {
        const model = viewModel();
        if (!model) return null;
        caster.setFromCamera(new THREE.Vector2(mx / rect.width * 2 - 1, -(my / rect.height) * 2 + 1), camera);
        const hit = caster.intersectObject(model, true).filter((h) => h.object.isMesh && h.object.visible && h.face)[0];
        if (!hit) return null;
        const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
        if (n.dot(caster.ray.direction) > 0) n.negate();                  // the side that the ray comes from is the outside
        return { point: hit.point, normal: n, object: hit.object };
    }
    renderer.domElement.addEventListener("pointermove", (e) => {
        if (!sb.pushMode || lasso) return;
        const rect = renderer.domElement.getBoundingClientRect();
        const hit = surfaceAt(e.clientX - rect.left, e.clientY - rect.top, rect);
        hover.visible = !!hit;
        if (!hit) return;
        hover.setDirection(hit.normal.clone().negate());
        hover.position.copy(hit.point).addScaledVector(hit.normal, 0.8);
    });
    function applyForceAt(mx, my, rect) {
        const s = softBody();
        const hit = surfaceAt(mx, my, rect);
        if (!s || !hit) return;
        const kg = parseFloat($("sbForceKg").value) || 1000, side = parseFloat($("sbPlate").value) || 0.6;
        const local = sb.group.worldToLocal(hit.point.clone());
        const normal = hit.normal.clone().applyQuaternion(sb.group.quaternion.clone().invert());
        releaseForce();
        const cubeMass = parseFloat($("sbCubeMass").value) || 100;
        s.pushPlate([local.x, local.y, local.z], [normal.x, normal.y, normal.z], kg * 9.81, side, cubeMass, 0.03);
        // the arrow stays on the car while it is pushed
        const arrow = new THREE.ArrowHelper(normal.clone().negate(), local.clone().addScaledVector(normal, 0.8), 0.8, 0xff5555, 0.3, 0.18);
        arrow.traverse((o) => { if (o.material) { o.material.depthTest = false; o.renderOrder = 13; } });
        sb.group.add(arrow);
        sb.pushArrow = arrow;
        sb.pushStart = { kg, speed: kg * 9.81 * 0.03 / cubeMass };
        hover.visible = false;
        status("Cube of " + cubeMass + " kg fired with a push of " + kg + " kg (" + (kg * 9.81 * 0.03 / cubeMass * 3.6).toFixed(0) + " km/h). Click again to fire another.", "ok");
    }
    function releaseForce() {
        const s = softBody();
        if (s) s.releasePlate();
        if (sb.pushArrow && sb.group) sb.group.remove(sb.pushArrow);
        sb.pushArrow = null; sb.pushStart = null;
    }
    function ensureGround3D() {
        const v = bench.vehicle;
        if (v && !v.ground.use3D) { sb.savedGround = sb.savedGround || v.ground; v.ground = crashGround(api.floorY(), 0); }
    }
    $("sbPush").addEventListener("click", async () => {
        if (!sb.pushMode && !sb.shown) await show(false);
        if (!softBody()) return;
        sb.pushMode = !sb.pushMode;
        // the shell is only worked out on a 3D ground (the plain floor of the bench has none)
        if (sb.pushMode) ensureGround3D();
        if (!sb.pushMode) { releaseForce(); hover.visible = false; }
        $("sbPush").textContent = sb.pushMode ? "Release" : "Apply force";
        $("sbPush").classList.toggle("ghost", sb.pushMode);
        if (sb.pushMode) status("Point at the car: the arrow shows where and which way the plate pushes. Click to push.", "ok");
    });
    // the reading: while the cube is at the car, and what it did when it has gone
    function pushReading() {
        const s = softBody();
        if (!s || !sb.pushStart) return;
        const pl = s.plate || s.lastPlate;
        if (!pl) return;
        const st = s.stats();
        const kg = (x) => (x / 9.81).toFixed(0);
        $("sbResult").textContent = (s.plate ? "Cube at " + (sb.pushStart.speed * 3.6).toFixed(0) + " km/h: " : "Hit with " + (sb.pushStart.speed * 3.6).toFixed(0) + " km/h: ") +
            "peak " + kg(pl.peak) + " kg of force, " + ((pl.maxIn || 0) * 100).toFixed(1) + " cm into the shell" +
            " · bend " + (st.maxBend * 100).toFixed(1) + " cm · took up " + (st.absorbed / 1000).toFixed(1) + " kJ · " + st.brokenAnchors + " anchors and " + st.brokenBeams + " beams torn";
        if (!s.plate && sb.pushArrow) { sb.group.remove(sb.pushArrow); sb.pushArrow = null; }       // the cube is gone
    }

    // ---- the part window: hover a loose object (orange outline), click it, and a window that can be moved opens: pin points, nodes
    let saveTimer = 0, saving = false;
    // every change is saved after a moment, as when the Save button is pressed
    function scheduleSave() {
        if (!api.canSave || !api.canSave()) return;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(async () => {
            if (saving) { scheduleSave(); return; }
            saving = true;
            try { await api.save(); } finally { saving = false; }
        }, 900);
    }
    // the model that is in the view: the one of the test bench when it runs, else the one of the editor
    function viewModel() { return bench.model ? bench.model.tilt : api.root(); }
    // a point of the world in the frame of the car (the car of the bench is at rest while the parts are made)
    const frameM = new THREE.Matrix4(), frameQ = new THREE.Quaternion(), frameP = new THREE.Vector3(), unitS = new THREE.Vector3(1, 1, 1);
    function toVeh(point) {
        const v = bench.vehicle;
        if (!v) return null;
        frameM.compose(frameP.set(v.px, v.py, v.pz), frameQ.set(v.qx, v.qy, v.qz, v.qw), unitS).invert();
        return point.clone().applyMatrix4(frameM);
    }
    async function rebuild() {
        const wasShown = sb.shown;
        sb.restarting = true;
        try { if (wasShown) await show(true); else await api.startBench(); } finally { sb.restarting = false; }
        sb.dirty = false;
    }

    // which objects are loose: a named object that is not (a part of) the body, the wheels or the steering wheel. The body is the object with
    // most of the triangles; what hangs in it (the plates) and beside it (a door, the hood) is loose.
    const triCache = new WeakMap();
    function triangles(o) {
        if (triCache.has(o)) return triCache.get(o);
        let n = 0;
        o.traverse((m) => { if (m.isMesh && m.geometry) n += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; });
        triCache.set(o, n);
        return n;
    }
    function looseOf(hitObject) {
        const root = viewModel();
        if (!root) return null;
        const total = triangles(root) || 1;
        let found = null;
        for (let o = hitObject; o && o !== root; o = o.parent) {
            if (!o.name || triangles(o) / total >= 0.4) continue;          // no name, or the body (or the scene that holds all)
            if (/wheel|tyre|tire|steer/i.test(o.name)) return null;
            found = o;
        }
        return found;
    }
    // the orange outline: the edges of the meshes of the object
    const outlines = new WeakMap();
    let outlined = null;
    function outline(object) {
        if (outlined === object) return;
        if (outlined && outlines.has(outlined)) outlines.get(outlined).forEach((l) => { l.visible = false; });
        outlined = object;
        if (!object) return;
        if (!outlines.has(object)) {
            const lines = [];
            object.traverse((m) => {
                if (!m.isMesh || !m.geometry) return;
                const line = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 25), new THREE.LineBasicMaterial({ color: 0xff9f43, depthTest: false, transparent: true, opacity: 0.95 }));
                line.renderOrder = 14; line.raycast = () => {};            // the outline is not picked
                m.add(line);
                lines.push(line);
            });
            outlines.set(object, lines);
        }
        outlines.get(object).forEach((l) => { l.visible = true; });
    }
    let hoverBusy = false;
    renderer.domElement.addEventListener("pointermove", (e) => {
        if (hoverBusy || lasso || sb.pushMode || sb.pick || tc.dragging || rc.dragging || sb.dragging) return;
        hoverBusy = true;
        requestAnimationFrame(() => {
            hoverBusy = false;
            const rect = renderer.domElement.getBoundingClientRect();
            const hit = surfaceAt(e.clientX - rect.left, e.clientY - rect.top, rect);
            // in the pin and node modes the part that is open is the one that counts
            if (sb.partMode === "nodes" && sb.partWin) { outline(hit && within(hit.object, partObj()) ? partObj() : null); return; }
            outline(hit ? looseOf(hit.object) : null);
        });
    });
    // the object of the open part in the model that is in the view now (the bench makes a new copy of the model for every test)
    function partObj() { const m = viewModel(); return m && sb.partWin ? m.getObjectByName(sb.partWin.name) : null; }
    function ancestorOf(object, ancestor) { for (let o = object; o; o = o.parent) if (o === ancestor) return true; return false; }
    function within(object, ancestor) { return ancestorOf(object, ancestor); }

    // a click, when it is for the part window: true when it was
    function partClick(e) {
        if (sb.pick || sb.pushMode || sb.edit) return false;
        const rect = renderer.domElement.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        const hit = surfaceAt(mx, my, rect);
        if (sb.partWin && sb.partMode === "pin") {
            if (!hit) return true;
            const local = toVeh(hit.point);
            const part = sb.partWin.part;
            const pin = { point: [+local.x.toFixed(3), +local.y.toFixed(3), +local.z.toFixed(3)], axes: { x: true, y: false, z: false }, min: -90, max: 90 };
            part.mounts = (part.mounts || []).concat([pin]);
            part.hinge = part.hinge || {};
            part.hinge.origin = pin.point.slice();                      // the pin point is also the origin of the hinge
            sb.pinSel = part.mounts.length - 1;
            sb.partMode = null;
            partChanged();
            return true;
        }
        if (sb.partWin && sb.partMode === "nodes") {
            if (!hit || !within(hit.object, partObj())) { status("Click on the surface of " + sb.partWin.name + " to put a node there.", ""); return true; }
            addPartNode(toVeh(hit.point));
            return true;
        }
        if (!hit) return false;
        // with the shell shown a click near a node is a selection of that node
        if (sb.shown && softBody()) {
            sb.group.updateMatrixWorld(true);
            const s = softBody();
            for (let k = 0; k < s.count; k++) { const [x, y] = screenOf(s, k, rect); if (Math.hypot(x - mx, y - my) < 14) return false; }
        }
        const loose = looseOf(hit.object);
        if (!loose) return false;
        openPartWindow(loose);
        return true;
    }
    window.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        if (sb.partMode) { endPartMode(); e.preventDefault(); }
    });
    function endPartMode() {
        const was = sb.partMode;
        sb.partMode = null;
        sb.deferRestart = false;
        if (was === "nodes") { changed(true); rebuildSoon(); }
        renderPartWin();
    }
    function rebuildSoon() { clearTimeout(restartTimer); restartTimer = setTimeout(() => { if (bench.vehicle) rebuild(); }, 200); }

    // ---- the window
    function ensureWindow() {
        if (sb.win) return sb.win;
        const el = document.createElement("div");
        el.className = "partwin";
        el.innerHTML = '<div class="pw-head"><span class="pw-title"></span><button class="pw-close" title="Close">×</button></div><div class="pw-body"></div>';
        document.querySelector("#view").appendChild(el);
        // it moves like a window: drag the title
        const head = el.querySelector(".pw-head");
        head.addEventListener("pointerdown", (e) => {
            if (e.target.closest("button")) return;
            const r = el.getBoundingClientRect(), v = el.parentElement.getBoundingClientRect();
            const dx = e.clientX - r.left, dy = e.clientY - r.top;
            head.setPointerCapture(e.pointerId);
            const move = (m) => { el.style.left = Math.max(0, Math.min(v.width - 60, m.clientX - v.left - dx)) + "px"; el.style.top = Math.max(0, Math.min(v.height - 40, m.clientY - v.top - dy)) + "px"; el.style.right = "auto"; };
            const up = () => { head.removeEventListener("pointermove", move); head.removeEventListener("pointerup", up); };
            head.addEventListener("pointermove", move); head.addEventListener("pointerup", up);
        });
        el.querySelector(".pw-close").addEventListener("click", closePartWindow);
        sb.win = el;
        return el;
    }
    async function openPartWindow(object) {
        try {
            if (!bench.vehicle) await api.startBench();                // the pin points are in the frame of the car, which the bench has
        } catch (error) { status(error.message, "error"); return; }
        const existing = sb.parts.find((p) => p.object === object.name);
        sb.partWin = { object: viewModel().getObjectByName(object.name) || object, name: object.name, part: existing || null };
        sb.partMode = null;
        sb.pinSel = existing && existing.mounts && existing.mounts.length ? 0 : -1;
        ensureWindow().style.display = "";
        renderPartWin();
        drawPartGizmos();
    }
    function closePartWindow() {
        if (sb.partMode === "nodes") { sb.deferRestart = false; sb.partMode = null; changed(true); rebuildSoon(); }
        sb.partMode = null;
        if (sb.win) sb.win.style.display = "none";
        sb.partWin = null;
        drawPartGizmos();
        outline(null);
    }
    function partChanged() {
        changed();
        renderPartWin();
        drawPartGizmos();
        renderParts();                                                // the list of the Parts panel
    }
    const AXES = ["x", "y", "z"], AXIS_COLOURS = { x: 0xff5555, y: 0x55dd77, z: 0x5599ff };
    function renderPartWin() {
        const w = sb.partWin;
        if (!w || !sb.win) return;
        const part = w.part;
        sb.win.querySelector(".pw-title").textContent = "Part: " + w.name;
        const body = sb.win.querySelector(".pw-body");
        body.innerHTML = "";
        const add = (html) => { const d = document.createElement("div"); d.innerHTML = html; body.appendChild(d); return d; };
        if (!part) {
            const d = add('<p class="hint">Part not added to loose parts</p><button class="small accent" data-a="add">Add</button>');
            d.querySelector('[data-a="add"]').addEventListener("click", () => {
                w.part = { object: w.name, mode: "hinge", mass: 10, hinge: {}, mounts: [] };
                sb.parts.push(w.part);
                partChanged();
            });
            return;
        }
        // mass and remove
        const top = add('<div class="row"><div><label>Mass (kg)</label><input type="number" data-a="mass" min="0.1" step="0.5"></div><div class="fixed"><label>&nbsp;</label><button class="small ghost" data-a="remove">Remove from loose parts</button></div></div>');
        top.querySelector('[data-a="mass"]').value = part.mass !== undefined ? part.mass : 10;
        top.querySelector('[data-a="mass"]').addEventListener("change", (e) => { part.mass = parseFloat(e.target.value) || 10; partChanged(); });
        top.querySelector('[data-a="remove"]').addEventListener("click", () => {
            sb.parts.splice(sb.parts.indexOf(part), 1);
            if (sb.layout) sb.layout.forEach((n) => { if (n.part === w.name) delete n.part; });
            w.part = null; sb.pinSel = -1;
            partChanged();
        });
        // pin points
        const head = add('<div class="pw-section"><b>Pin points</b> <button class="small" data-a="addpin">+ add</button></div>');
        head.querySelector('[data-a="addpin"]').addEventListener("click", () => {
            sb.partMode = sb.partMode === "pin" ? null : "pin";
            renderPartWin();
        });
        if (sb.partMode === "pin") add('<p class="hint">Click on the surface where the pin point goes (Esc cancels).</p>');
        const pins = part.mounts || [];
        if (!pins.length && sb.partMode !== "pin") add('<p class="hint">No pin points yet.</p>');
        pins.forEach((pin, i) => {
            if (!pin.point) return;
            const axes = pin.axes || { x: true, y: false, z: false };
            const d = add('<div class="pw-pin' + (i === sb.pinSel ? " sel" : "") + '"><div class="pw-pinhead"><b>Pin ' + (i + 1) + '</b> <span class="hint">' + pin.point.map((x) => x.toFixed(2)).join(", ") + '</span>' +
                ' <span class="pw-axes">' + AXES.map((a) => '<button class="small ' + (axes[a] ? "accent" : "ghost") + '" data-axis="' + a + '">' + a.toUpperCase() + "</button>").join("") + '</span> <button class="small ghost" data-a="del" title="Remove this pin point">✕</button></div>' +
                '<div class="row"><div><label>Min <b data-v="min"></b>°</label><input type="range" data-a="min" min="-180" max="0" step="1"></div><div><label>Max <b data-v="max"></b>°</label><input type="range" data-a="max" min="0" max="180" step="1"></div></div>' +
                '<div class="row"><div><label>Rotation of the pin (°) <button class="small ghost set" data-a="rot0">Reset</button></label><div class="row"><input type="number" data-a="rx" step="5"><input type="number" data-a="ry" step="5"><input type="number" data-a="rz" step="5"></div></div></div>' +
                '<div class="row"><div><label title="1 kN is about 102 kg of force">Opens at (kN)</label><input type="number" data-a="activate" min="0" step="1" placeholder="the part stays shut"></div>' +
                '<div><label title="1 kN is about 102 kg of force">Breaks off at (kN)</label><input type="number" data-a="force" min="0" step="10" placeholder="0: never"></div></div>' +
                '<div class="hint pw-warn"></div></div>');
            const pinEl = d.querySelector(".pw-pin");
            const q = (a) => d.querySelector('[data-a="' + a + '"]');
            const min = pin.min !== undefined ? pin.min : -90, max = pin.max !== undefined ? pin.max : 90;
            q("min").value = min; q("max").value = max;
            d.querySelector('[data-v="min"]').textContent = min; d.querySelector('[data-v="max"]').textContent = max;
            q("force").value = pin.break_force ? pin.break_force / 1000 : "";
            q("activate").value = pin.activate_force ? pin.activate_force / 1000 : "";
            const warn = d.querySelector(".pw-warn");
            const checkForces = () => { warn.textContent = pin.activate_force && pin.break_force && pin.break_force <= pin.activate_force ? "Breaks off should be higher than opens at, or the part never swings: it falls off at once." : ""; };
            checkForces();
            q("activate").addEventListener("change", () => { const v = parseFloat(q("activate").value); if (v > 0) pin.activate_force = v * 1000; else delete pin.activate_force; checkForces(); partChanged(); });
            const eul = eulerOf(pin);
            q("rx").value = eul[0]; q("ry").value = eul[1]; q("rz").value = eul[2];
            // the numbers turn the pin too (X, then Y, then Z); the gizmo in the view does the same by hand
            ["rx", "ry", "rz"].forEach((f) => q(f).addEventListener("change", () => {
                const rad = ["rx", "ry", "rz"].map((k) => (parseFloat(q(k).value) || 0) * Math.PI / 180);
                const qn = new THREE.Quaternion().setFromEuler(new THREE.Euler(rad[0], rad[1], rad[2], "XYZ"));
                pin.rot = [+qn.x.toFixed(5), +qn.y.toFixed(5), +qn.z.toFixed(5), +qn.w.toFixed(5)];
                sb.pinSel = i; partChanged();
            }));
            q("rot0").addEventListener("click", () => { delete pin.rot; sb.pinSel = i; partChanged(); });
            pinEl.addEventListener("pointerdown", () => { if (sb.pinSel !== i) { sb.pinSel = i; drawPartGizmos(); pinEl.parentElement.parentElement.querySelectorAll(".pw-pin").forEach((x) => x.classList.toggle("sel", x === pinEl)); } });
            d.querySelectorAll("[data-axis]").forEach((b) => b.addEventListener("click", () => {
                pin.axes = Object.assign({ x: false, y: false, z: false }, pin.axes || { x: true });
                pin.axes[b.dataset.axis] = !pin.axes[b.dataset.axis];
                sb.pinSel = i;
                partChanged();
            }));
            // the sliders show on the gizmo while they move
            ["min", "max"].forEach((k) => {
                q(k).addEventListener("input", () => { pin[k] = parseFloat(q(k).value); d.querySelector('[data-v="' + k + '"]').textContent = pin[k]; sb.pinSel = i; drawPartGizmos(); });
                q(k).addEventListener("change", () => partChanged());
            });
            q("force").addEventListener("change", () => { const v = parseFloat(q("force").value); if (v > 0) pin.break_force = v * 1000; else delete pin.break_force; checkForces(); partChanged(); });
            q("del").addEventListener("click", () => { part.mounts.splice(i, 1); sb.pinSel = part.mounts.length ? Math.min(sb.pinSel, part.mounts.length - 1) : -1; partChanged(); });
        });
        // nodes of the part
        const own = [];
        if (sb.layout) sb.layout.forEach((n, k) => { if (n.part === w.name) own.push(k); });
        const nh = add('<div class="pw-section"><b>Deformation nodes</b> <button class="small ' + (sb.partMode === "nodes" ? "accent" : "") + '" data-a="nodes">' + (sb.partMode === "nodes" ? "Stop adding nodes" : "Add nodes") + "</button></div>");
        nh.querySelector('[data-a="nodes"]').addEventListener("click", async () => {
            if (sb.partMode === "nodes") { endPartMode(); return; }
            const s = softBody();
            if (!s) { status("The car does not dent: tick “The car dents” first.", "error"); return; }
            freeze(s);
            sb.partMode = "nodes"; sb.deferRestart = true;
            renderPartWin();
        });
        if (sb.partMode === "nodes") add('<p class="hint">Click on the surface of ' + w.name + ' to add nodes: the part bends with them. Esc or the button stops.</p>');
        if (!own.length) add('<p class="hint">No nodes added yet: the part does not bend, it is one stiff piece.</p>');
        else {
            const st = add('<div class="row"><div><label>Strength of all nodes (kN): how much force they take before they bend</label><input type="number" data-a="strength" min="0" step="10"></div></div>');
            const first = sb.nodeEdits.get(own[0]);
            st.querySelector('[data-a="strength"]').value = first && own.every((k) => sb.nodeEdits.has(k) && sb.nodeEdits.get(k).yield_force === first.yield_force) ? first.yield_force / 1000 : "";
            st.querySelector('[data-a="strength"]').addEventListener("change", (e) => {
                const v = parseFloat(e.target.value);
                if (!(v > 0)) return;
                // the node bends at the strength and tears at two and a half times
                own.forEach((k) => sb.nodeEdits.set(k, { yield_force: v * 1000, break_force: v * 2500 }));
                partChanged();
            });
            const list = add('<div class="pw-nodes">' + own.map((k) => '<div class="pw-node"><span class="hint">node ' + k + "</span> <button class=\"small ghost\" data-del=\"" + k + '">✕</button></div>').join("") + "</div>");
            list.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => { removeNodes(new Set([parseInt(b.dataset.del, 10)])); renderPartWin(); drawPartGizmos(); }));
        }
    }
    function addPartNode(local) {
        const w = sb.partWin;
        if (!w || !sb.layout) return;
        const r = 0.1;
        sb.layout.push({ x: +local.x.toFixed(4), y: +local.y.toFixed(4), z: +local.z.toFixed(4), r, part: w.name });
        if (sb.layout.length > 200) { sb.layout.pop(); status("A car can have 200 nodes at most.", "error"); return; }
        changed();
        renderPartWin();
        drawPartGizmos();
    }

    // the rotate gizmo of the chosen pin: its axes can be turned, for the most freedom
    const rc = new TransformControls(camera, renderer.domElement);
    rc.setMode("rotate"); rc.setSpace("local"); rc.setSize(0.6);
    scene.add(typeof rc.getHelper === "function" ? rc.getHelper() : rc);
    rc.addEventListener("dragging-changed", (event) => {
        controls.enabled = !event.value;
        if (!event.value && sb.partWin && sb.partWin.part) { renderPartWin(); changed(); renderParts(); }      // let go: saved
    });
    rc.addEventListener("objectChange", () => {
        const part = sb.partWin && sb.partWin.part, pin = part && part.mounts && part.mounts[sb.pinSel];
        if (!pin || !sb.pinPivot) return;
        const q = sb.pinPivot.quaternion;
        pin.rot = [+q.x.toFixed(5), +q.y.toFixed(5), +q.z.toFixed(5), +q.w.toFixed(5)];
        drawPartGizmos();
    });
    function eulerOf(pin) {
        const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...(pin.rot || [0, 0, 0, 1])), "XYZ");
        return [e.x, e.y, e.z].map((r) => Math.round(r * 180 / Math.PI * 10) / 10);
    }

    // what the window shows in the view: the pin points, the gizmo of the pin that is chosen, the nodes of the part
    function drawPartGizmos() {
        if (!sb.partGroup) { sb.partGroup = new THREE.Group(); scene.add(sb.partGroup); }
        const g = sb.partGroup;
        while (g.children.length) { const c = g.children.pop(); c.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
        const w = sb.partWin;
        if (!w) { if (rc.object) rc.detach(); return; }
        const part = w.part;
        const mark = (color) => new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true });
        (part && part.mounts || []).forEach((pin, i) => {
            if (!pin.point) return;
            const ball = new THREE.Mesh(new THREE.SphereGeometry(i === sb.pinSel ? 0.04 : 0.028, 14, 10), mark(0xff9f43));
            ball.position.set(...pin.point); ball.renderOrder = 15;
            g.add(ball);
            if (i !== sb.pinSel) return;
            // the gizmo: every axis that is free, and the angles that it may turn through (from the rest place, towards min and max)
            const axes = pin.axes || { x: true, y: false, z: false };
            const min = (pin.min !== undefined ? pin.min : -90) * Math.PI / 180, max = (pin.max !== undefined ? pin.max : 90) * Math.PI / 180;
            const holder = new THREE.Group();                            // at the pin, turned as the pin is turned
            holder.position.set(...pin.point);
            if (pin.rot) holder.quaternion.set(...pin.rot);
            g.add(holder);
            AXES.forEach((a) => {
                if (!axes[a]) return;
                const axis = new THREE.Vector3(a === "x" ? 1 : 0, a === "y" ? 1 : 0, a === "z" ? 1 : 0);
                const u = new THREE.Vector3(a === "x" ? 0 : a === "y" ? 0 : 1, a === "x" ? 1 : 0, a === "x" ? 0 : a === "y" ? 1 : 0);
                const v = new THREE.Vector3().crossVectors(axis, u);
                const centre = new THREE.Vector3();
                const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([centre.clone().addScaledVector(axis, -0.35), centre.clone().addScaledVector(axis, 0.35)]), new THREE.LineBasicMaterial({ color: AXIS_COLOURS[a], depthTest: false }));
                line.renderOrder = 15; holder.add(line);
                const radius = 0.3, steps = Math.max(2, Math.ceil((max - min) / (Math.PI / 36)));
                const arc = [];
                for (let k = 0; k <= steps; k++) { const t = min + (max - min) * k / steps; arc.push(centre.clone().addScaledVector(u, Math.cos(t) * radius).addScaledVector(v, Math.sin(t) * radius)); }
                const verts = [];
                for (let k = 0; k < arc.length - 1; k++) verts.push(centre.x, centre.y, centre.z, arc[k].x, arc[k].y, arc[k].z, arc[k + 1].x, arc[k + 1].y, arc[k + 1].z);
                const fan = new THREE.Mesh(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(verts, 3)), new THREE.MeshBasicMaterial({ color: AXIS_COLOURS[a], transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthTest: false }));
                fan.renderOrder = 15; holder.add(fan);
                const rim = new THREE.Line(new THREE.BufferGeometry().setFromPoints([centre, ...arc, centre]), new THREE.LineBasicMaterial({ color: AXIS_COLOURS[a], depthTest: false }));
                rim.renderOrder = 15; holder.add(rim);
                // the rest place: where the angle is 0
                const zero = new THREE.Line(new THREE.BufferGeometry().setFromPoints([centre, centre.clone().addScaledVector(u, radius * 1.1)]), new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false }));
                zero.renderOrder = 15; holder.add(zero);
            });
        });
        // the nodes of the part
        if (sb.layout) {
            const pts = [];
            sb.layout.forEach((n) => { if (n.part === w.name) pts.push(n.x, n.y, n.z); });
            if (pts.length) {
                const geo = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
                const points = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffb040, size: 9, sizeAttenuation: false, depthTest: false, transparent: true }));
                points.renderOrder = 15; g.add(points);
            }
        }
        // the pivot that the rotate gizmo holds: at the chosen pin, turned as it is
        const pinNow = part && part.mounts && part.mounts[sb.pinSel];
        if (pinNow && pinNow.point) {
            if (!sb.pinPivot) sb.pinPivot = new THREE.Object3D();
            g.add(sb.pinPivot);
            if (!rc.dragging) { sb.pinPivot.position.set(...pinNow.point); sb.pinPivot.quaternion.set(...(pinNow.rot || [0, 0, 0, 1])); }
            if (rc.object !== sb.pinPivot) rc.attach(sb.pinPivot);
        } else if (rc.object) rc.detach();
        placePartGroup();
    }
    function placePartGroup() {
        const v = bench.vehicle;
        if (!sb.partGroup || !v) return;
        sb.partGroup.position.set(v.px, v.py, v.pz);
        sb.partGroup.quaternion.set(v.qx, v.qy, v.qz, v.qw);
    }

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
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(80, 6, 0.3), new THREE.MeshStandardMaterial({ color: 0x59636f, roughness: 0.9, transparent: true, opacity: 0.1, depthWrite: false }));   // 10%: the car is seen through it
        mesh.position.set(0, floorY + 3, WALL_Z + 0.15);
        mesh.rotation.y = -angleDeg * Math.PI / 180;
        return mesh;
    }
    async function crash() {
        try {
            if (!bench.vehicle || !softBody()) await api.startBench();
            else if (sb.dirty) await rebuild();                        // what was changed in the part window is in the test
            const s = softBody(), v = bench.vehicle;
            if (!s) throw new Error("The car does not dent: tick “The car dents” first.");
            const speed = parseFloat($("sbSpeed").value) / 3.6, angle = parseFloat($("sbAngle").value);
            const floorY = api.floorY();
            stopCrash();
            cameraToCar();
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
    // the camera back on the car in the middle of the view, from the side and a little above
    function cameraToCar() {
        const target = new THREE.Vector3(0, api.floorY() + 0.7, 0);
        const distance = Math.min(12, Math.max(5, camera.position.distanceTo(controls.target)));
        controls.target.copy(target);
        camera.position.set(target.x - distance * 0.7, target.y + distance * 0.4, target.z + distance * 0.7);
        controls.update();
    }
    $("sbCrash").addEventListener("click", crash);
    $("sbRepair").addEventListener("click", () => {
        const v = bench.vehicle;
        if (!v) return;
        stopCrash();
        releaseForce();
        sb.savedGround = null;
        if (sb.pushMode) ensureGround3D();                          // the push mode needs the 3D ground
        v.reset(0, 0, Math.PI / 2);
        cameraToCar();
        $("sbResult").textContent = "Repaired.";
    });

    // the bench stops: the shell and the wall go
    function onStop() {
        if (OpenRacer.SoftBodyMesh && api.root()) OpenRacer.SoftBodyMesh.restore(api.root());      // the model of the editor is not bent by the shell of the bench any more
        if (!sb.restarting) { sb.edit = false; $("sbEdit").textContent = "Edit nodes"; $("sbEdit").classList.remove("accent"); $("sbEditBox").style.display = "none"; sb.sel.nodes.clear(); sb.sel.beam = null; }
        stopCrash();
        sb.savedGround = null;
        sb.pushMode = false; sb.pushArrow = null; $("sbPush").textContent = "Apply force"; $("sbPush").classList.remove("ghost");
        hide();
        $("sbInfo").textContent = "";
        $("sbResult").textContent = "";
        if (!sb.restarting && api.frameModel) api.frameModel();
    }

    return { read, fill, frame, onStop, changed, debug: { sb, tc, showSelection } };
}
