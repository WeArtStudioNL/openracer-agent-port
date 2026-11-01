/*
 * suspension-editor.js
 *
 * Description: The "Suspension and driveline" card of the car editor: a type of suspension for the front and for the rear, where the engine is, and the mounts of
 *              the parts that the game builds from the parts library (PartsLibrary.js: web/parts/<type>/<part>.glb) as gizmos in the view, one row each with Move,
 *              Turn and Reset. The parts are shown in the view as the game will place them (the car at rest), rebuilt as a mount is dragged, and the game and the
 *              test bench build them the same way from what is saved (car.json: "suspension" and "driveline").
 *              The mounts are kept per axle and per type, so switching the type back and forth does not lose them; the file gets the mounts of the chosen type.
 * Author:      Glenn Hofman
 * Date:        2026-10-26
 * License:     MIT
 */

export function initSuspension(api) {
    const { $, THREE, scene, gizmo, rotGizmo, gizmoTargets, layers, selectLayer, wheelCenters, driveValue, loadLibrary, renderLayers, save } = api;
    let editing = false;                     // Edit origins: only the mounts can be clicked in the view, through everything
    const state = { front: { type: "model", mounts: {}, hidden: [] }, rear: { type: "model", mounts: {}, hidden: [] }, driveline: { engine: "front", mounts: {}, hidden: [] } };
    // the buttons of a row are icons: move (arrows), turn (a circle arrow), reset (back to the default), and the eye of a part (orange: shown, grey: hidden)
    const ICONS = {
        move: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1v14M1 8h14M8 1l-2 2M8 1l2 2M8 15l-2-2M8 15l2-2M1 8l2-2M1 8l2 2M15 8l-2-2M15 8l-2 2"/></svg>',
        turn: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 1.5v3.5h-3.5"/></svg>',
        reset: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9"/><path d="M2.5 1.5v3.5h3.5"/><circle cx="8" cy="8" r="1" fill="currentColor"/></svg>',
        eye: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z"/><circle cx="8" cy="8" r="2.2"/></svg>'
    };
    const selects = { front: $("suspFront"), rear: $("suspRear"), engine: $("enginePlace") };
    const rows = $("suspMounts"), missingBox = $("suspMissing");
    let mode = "move";                       // what the gizmo of a mount does: move or rotate
    let group = null;                        // the parts in the view
    let signature = "";                      // what the parts were built from: nothing is rebuilt when nothing changed
    let markers = {};                        // id -> { target, group, name }
    let timer = null, building = false, again = false, hidden = false;
    const D = Math.PI / 180;
    const COLOURS = { front: 0x5ec8ff, rear: 0x8ee26b, driveline: 0xffd04d };

    const lib = () => (window.OpenRacer && window.OpenRacer.PartsLibrary) || null;
    const typeOf = (axle) => state[axle].type;
    const active = () => typeOf("front") !== "model" || typeOf("rear") !== "model";

    // the car as the library reads it: the types, the mounts of the chosen types, the drive
    function config() {
        const susp = {};
        ["front", "rear"].forEach((axle) => { susp[axle] = { type: state[axle].type, mounts: state[axle].mounts[state[axle].type] || {}, hidden: state[axle].hidden }; });
        // (the block of the engine: an engine with a model of its own, parts/driveline/<block>.glb, is shown with that one, PartsLibrary.engineModel)
        const block = api.engineBlock ? api.engineBlock() : "";
        return { suspension: susp, driveline: { engine: state.driveline.engine, mounts: state.driveline.mounts, hidden: state.driveline.hidden }, drivetrain: { drive: driveValue() }, engine: block ? { build: { block } } : undefined };
    }
    function measured() {
        const c = wheelCenters();
        if (!c) return null;
        const centres = {}; let d = 0;
        for (const slot of ["FR", "FL", "RL", "RR"]) { centres[slot] = c[slot].c.clone(); d += c[slot].size.y / 4; }
        return { centres, diameter: d };
    }

    // The mounts that were placed by hand are kept where they were put, in the frame of the car: when a wheel moves (the wheelbase, the tracks, the position of the axles
    // of the Chassis card) they go with it, or the damper and the leaf springs of a live axle stayed behind while the axle moved. Along the car and in height every mount of
    // the axle goes (the corner as a whole: the arms keep their length); across, only the mounts that sit at the wheel (the ball joints, the foot of a strut, the steering arm).
    // The differential and the end of the propshaft of an axle go with it too. The defaults follow the wheels by themselves (PartsLibrary.defaultMount).
    const AT_THE_WHEEL = ["upper_ball", "lower_ball", "strut_bottom", "tierod_outer"];
    const WITH_AXLE = { front: ["diff_front", "prop_front_end"], rear: ["diff_rear", "prop_rear_end"] };
    let lastAxles = null;                    // the middle of the left wheel of each axle when the mounts were last placed
    let moving = false;                      // the wheels were moved in the form (wheelsMoved): only then the mounts go with them, not when a car or its model is loaded
    function axlesOf(meas) {
        const c = meas.centres, left = (a, b) => (a.x >= b.x ? a : b);
        const fl = left(c.FL, c.FR), rl = left(c.RL, c.RR);
        return { front: { x: Math.abs(fl.x), y: fl.y, z: (c.FL.z + c.FR.z) / 2 }, rear: { x: Math.abs(rl.x), y: rl.y, z: (c.RL.z + c.RR.z) / 2 } };
    }
    function followWheels(meas) {
        const now = axlesOf(meas), was = lastAxles, go = moving;
        lastAxles = now; moving = false;
        if (!was || !go) return;
        ["front", "rear"].forEach((axle) => {
            const dx = now[axle].x - was[axle].x, dy = now[axle].y - was[axle].y, dz = now[axle].z - was[axle].z;
            if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6 && Math.abs(dz) < 1e-6) return;
            const fix = (v) => Math.round(v * 1000) / 1000;
            const move = (name, mt, across) => { if (!mt || !mt.position) return; mt.position = [fix(mt.position[0] + (across ? dx : 0)), fix(mt.position[1] + dy), fix(mt.position[2] + dz)]; };
            const live = typeOf(axle) === "live-leaf" || typeOf(axle) === "live-trailing";
            Object.values(state[axle].mounts).forEach((set) => Object.keys(set || {}).forEach((name) => move(name, set[name], !live && AT_THE_WHEEL.includes(name))));
            WITH_AXLE[axle].forEach((name) => move(name, state.driveline.mounts[name], false));
        });
    }

    // ---- what is saved and what is read
    function read() {
        const out = {};
        if (active()) {
            out.suspension = {};
            ["front", "rear"].forEach((axle) => {
                const t = state[axle].type, entry = { type: t };
                const m = state[axle].mounts[t];
                if (m && Object.keys(m).length) entry.mounts = m;
                if (state[axle].hidden.length) entry.hidden = state[axle].hidden.slice();
                out.suspension[axle] = entry;
            });
            out.driveline = { engine: state.driveline.engine };
            if (Object.keys(state.driveline.mounts).length) out.driveline.mounts = state.driveline.mounts;
            if (state.driveline.hidden.length) out.driveline.hidden = state.driveline.hidden.slice();
        }
        return out;
    }
    function fill(car) {
        const s = (car && car.suspension) || {};
        ["front", "rear"].forEach((axle) => {
            const e = s[axle] || {}, t = [...selects[axle].options].some((o) => o.value === e.type) ? e.type : "model";
            state[axle].type = t;
            state[axle].mounts = {};
            if (e.mounts) state[axle].mounts[t] = JSON.parse(JSON.stringify(e.mounts));
            state[axle].hidden = Array.isArray(e.hidden) ? e.hidden.slice() : [];
            selects[axle].value = t;
        });
        const d = (car && car.driveline) || {};
        state.driveline.engine = ["front", "mid", "rear"].indexOf(d.engine) >= 0 ? d.engine : "front";
        state.driveline.mounts = d.mounts ? JSON.parse(JSON.stringify(d.mounts)) : {};
        state.driveline.hidden = Array.isArray(d.hidden) ? d.hidden.slice() : [];
        selects.engine.value = state.driveline.engine;
        lastAxles = null;                    // (the mounts of this car are where its wheels are now)
        refresh(true);
    }

    // ---- the parts in the view and the markers of the mounts
    function clearAll() {
        if (group) { scene.remove(group); group = null; }
        for (const id in markers) { scene.remove(markers[id].target); delete gizmoTargets[id]; if (layers.selected === id) selectLayer(id); }
        markers = {};
        rows.innerHTML = "";
        missingBox.textContent = "";
        signature = "";
    }
    function marker(id, grp, name) {
        let m = markers[id];
        if (m) return m;
        const target = new THREE.Object3D();
        // (small: a ball of 2 cm, so that the part under it is seen; it is drawn over everything, so it is found all the same)
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.021, 12, 10), new THREE.MeshBasicMaterial({ color: COLOURS[grp], depthTest: false, transparent: true, opacity: 0.9 }));
        ball.renderOrder = 999;
        const axes = new THREE.AxesHelper(0.1);
        axes.material.depthTest = false; axes.renderOrder = 999;
        target.add(ball, axes);
        ball.userData.layer = id;            // (a click on the ball in the view selects the mount: Edit origins)
        target.userData.mount = { group: grp, name };
        scene.add(target);
        gizmoTargets[id] = target;
        m = markers[id] = { target, group: grp, name, ball };
        return m;
    }
    function store(id) {
        const m = markers[id]; if (!m) return;
        // the end of the rack: only along the rack (x); its height and place along the car are the rack's. The rack: its end goes with it
        if (m.name === "rack_end") { const rack = markers["mt:" + m.group + ":rack"]; if (rack) { m.target.position.y = rack.target.position.y; m.target.position.z = rack.target.position.z; m.target.rotation.set(0, 0, 0); } }
        if (m.name === "axle_end") { const was = m.lastStored || m.target.position; m.target.position.y = was.y; m.target.position.z = was.z; m.target.rotation.set(0, 0, 0); }       // (along the axle only; its height and place are the axle's)
        if (m.name === "rack") {
            const end = markers["mt:" + m.group + ":rack_end"];
            if (end) { const was = m.lastStored || m.target.position.clone(); end.target.position.add(m.target.position.clone().sub(was)); storeTarget(end); }
        }
        m.lastStored = m.target.position.clone();
        storeTarget(m);
    }
    function storeTarget(m) {
        const p = m.target.position, r = m.target.rotation, fix = (v) => Math.round(v * 1000) / 1000;
        const entry = { position: [fix(p.x), fix(p.y), fix(p.z)], rotation: [Math.round(r.x / D * 10) / 10, Math.round(r.y / D * 10) / 10, Math.round(r.z / D * 10) / 10] };
        if (m.group === "driveline") state.driveline.mounts[m.name] = entry;
        else { const t = state[m.group].type; (state[m.group].mounts[t] = state[m.group].mounts[t] || {})[m.name] = entry; }
    }
    function reset(id) {
        const m = markers[id]; if (!m) return;
        if (api.changed) api.changed();          // (a change of the car: Save lights up, leaving asks; it did not)
        if (m.group === "driveline") delete state.driveline.mounts[m.name];
        else { const t = state[m.group].type; if (state[m.group].mounts[t]) delete state[m.group].mounts[t][m.name]; }
        refresh(true);
    }

    function refresh(force) {
        const meas = measured();
        if (meas) followWheels(meas);        // (also while the parts library is not used: what was set for it stays with the wheels)
        if (!active()) { clearAll(); return; }
        if (!meas) { clearAll(); rows.innerHTML = "<p class=\"sub\">Select the parts of the four wheels first: the mounts are placed from the wheels.</p>"; return; }
        const cfg = config();
        const sig = JSON.stringify([cfg, Object.values(meas.centres).map((c) => [c.x, c.y, c.z].map((v) => Math.round(v * 1000)))]);
        if (!force && sig === signature) return;
        signature = sig;
        if (building) { again = true; return; }
        building = true;
        loadLibrary().then(() => new Promise((done) => { const L = lib(); L.base = "../"; L.preload(cfg, undefined, done); })).then(() => build(cfg, meas)).catch((e) => { console.warn(e); }).then(() => {
            building = false;
            if (again) { again = false; refresh(true); }
        });
    }
    function build(cfg, meas) {
        const L = lib();
        if (group) scene.remove(group);
        const out = L.assemble(cfg, meas);
        group = out.group;
        group.visible = !hidden;
        scene.add(group);
        // the markers: one per mount of the chosen types, where the mount is (a default from the wheels, or what was set)
        const mounts = L.mountsOf(cfg, meas), keep = {};
        rows.innerHTML = "";
        ["front", "rear", "driveline"].forEach((grp) => {
            const names = Object.keys(mounts[grp] || {});
            if (!names.length) return;
            const head = document.createElement("div");
            head.className = "group";
            head.textContent = grp === "driveline" ? "Driveline" : (grp === "front" ? "Front suspension" : "Rear suspension") + " (the left side; the right is its mirror)";
            rows.appendChild(head);
            // the parts of the group, an eye each: orange is placed, grey is hidden (the car's own model has that part)
            const eyes = document.createElement("div");
            eyes.style.cssText = "display: flex; flex-wrap: wrap; gap: 4px 10px; margin: 2px 0 6px;";
            L.partsOf(cfg, grp).forEach((part) => {
                const hidden = state[grp].hidden.indexOf(part.file) >= 0;
                const b = document.createElement("button");
                b.className = "small ghost"; b.innerHTML = ICONS.eye + " " + part.label;
                b.style.cssText = "display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px; color: " + (hidden ? "#6b7480" : "#ff7a3d") + ";";
                b.title = hidden ? "Hidden: the car's own model has this part. Click to place it from the parts library" : "Placed from the parts library. Click to hide it (the car's own model has it)";
                b.addEventListener("click", () => { const h = state[grp].hidden, i = h.indexOf(part.file); if (i >= 0) h.splice(i, 1); else h.push(part.file); refresh(true); if (api.changed) api.changed(); });
                eyes.appendChild(b);
            });
            rows.appendChild(eyes);
            names.forEach((name) => {
                const id = "mt:" + grp + ":" + name, mt = mounts[grp][name], m = marker(id, grp, name);
                keep[id] = true;
                const dragging = layers.dragging && layers.selected === id;
                if (!dragging) {
                    m.target.position.set(mt.position[0], mt.position[1], mt.position[2]);
                    m.target.rotation.set(mt.rotation[0] * D, mt.rotation[1] * D, mt.rotation[2] * D);
                    m.lastStored = m.target.position.clone();
                }
                m.target.visible = editing && !hidden;              // (the points are only shown while they are edited)
                m.ball.material.color.set(layers.selected === id ? 0xffffff : COLOURS[grp]);
                const row = document.createElement("div");
                row.className = "row mount" + (layers.selected === id ? " selected" : "");
                row.style.cssText = "align-items: center; gap: 6px; margin: 2px 0;";
                const label = document.createElement("span");
                label.style.cssText = "flex: 1; font-size: 12px;" + (layers.selected === id ? " color: #fff;" : "");
                label.textContent = (L.MOUNT_LABELS[name] || name) + "  (" + mt.position.map((v) => v.toFixed(2)).join(", ") + ")";
                const set = (isSet) => isSet ? "" : " ghost";
                const custom = grp === "driveline" ? !!state.driveline.mounts[name] : !!(state[grp].mounts[state[grp].type] && state[grp].mounts[state[grp].type][name]);
                const icon = (b, svg) => { b.innerHTML = svg; b.style.cssText = "display: inline-flex; align-items: center; padding: 4px 7px;"; };
                const bMove = document.createElement("button"); bMove.className = "small" + (layers.selected === id && mode === "move" ? "" : " ghost"); icon(bMove, ICONS.move); bMove.title = "Move (W)";
                bMove.addEventListener("click", () => { mode = "move"; if (layers.selected !== id) selectLayer(id); else attachGizmo(id); renderRows(); });
                const bTurn = document.createElement("button"); bTurn.className = "small" + (layers.selected === id && mode === "rotate" ? "" : " ghost"); icon(bTurn, ICONS.turn); bTurn.title = "Turn (E)";
                bTurn.addEventListener("click", () => { mode = "rotate"; if (layers.selected !== id) selectLayer(id); else attachGizmo(id); renderRows(); });
                const bReset = document.createElement("button"); bReset.className = "small ghost"; icon(bReset, ICONS.reset); bReset.title = "Back to the default from the wheels"; bReset.style.opacity = custom ? 1 : 0.4;
                bReset.addEventListener("click", () => reset(id));
                row.append(label, bMove, bTurn, bReset);
                rows.appendChild(row);
            });
        });
        for (const id in markers) if (!keep[id]) { scene.remove(markers[id].target); delete gizmoTargets[id]; if (layers.selected === id) selectLayer(id); delete markers[id]; }
        showSelected();
        const missing = L.missingFiles(cfg);
        missingBox.textContent = missing.length ? "Missing in web/parts: " + missing.join(", ") + " (the parts that are there are shown; add the files and load the car again)." : out.names.length + " parts placed from web/parts.";
        if (typeof renderLayers === "function") renderLayers();
    }
    // the rows again without rebuilding the parts (a selection changed)
    function renderRows() { signature = ""; refresh(true); }
    // the bar of Edit origins names the selected point, in green
    function showSelected() {
        const m = markers[layers.selected], L = lib();
        const el = $("originsName");
        if (!el) return;
        if (!m) { el.textContent = "No point selected"; el.style.color = "#8d97a3"; return; }
        const side = m.group === "driveline" ? "" : (m.group === "front" ? "Front: " : "Rear: ");
        el.textContent = side + ((L && L.MOUNT_LABELS[m.name]) || m.name) + (mode === "rotate" ? "  (turn)" : "  (move)");
        el.style.color = "#37d67a";
    }

    // ---- the gizmo of a mount
    function isMount(id) { return typeof id === "string" && id.indexOf("mt:") === 0; }
    function attachGizmo(id) {
        gizmo.detach(); rotGizmo.detach();
        const target = gizmoTargets[id];
        if (!target) return;
        const m = markers[id], endOnly = m && (m.name === "rack_end" || m.name === "axle_end");
        if (mode === "move" || endOnly) { gizmo.attach(target); gizmo.showX = true; gizmo.showY = gizmo.showZ = !endOnly; } else rotGizmo.attach(target);
        for (const k in markers) markers[k].ball.material.color.set(k === id ? 0xffffff : COLOURS[markers[k].group]);
        showSelected();
    }
    // a mount was dragged: stored, and the parts rebuilt (at most ten times a second while it moves)
    function moved(id) {
        store(id);
        if (timer) return;
        timer = setTimeout(() => { timer = null; refresh(true); }, 100);
    }
    function setMode(m) { mode = m; if (isMount(layers.selected)) { attachGizmo(layers.selected); renderRows(); } }
    function hide(on) { hidden = on; if (group) group.visible = !on; for (const id in markers) markers[id].target.visible = editing && !on; }

    // ---- Edit origins: a mode in which the balls of the mounts are the only things a click in the view picks (through the model), W and E as always, Escape leaves it,
    // and a Save button at the bottom of the view saves the car and leaves it
    function setEditing(on) {
        if (on && !active()) { api.status && api.status("Pick a type of suspension first: there are no origins to edit.", "warn"); return; }
        editing = on;
        $("suspEdit").classList.toggle("accent", on);
        $("suspEdit").textContent = on ? "Editing origins… (Escape leaves)" : "Edit origins";
        $("originsBar").style.display = on ? "" : "none";
        $("testBar").style.display = on ? "none" : "";
        for (const id in markers) markers[id].target.visible = on && !hidden;
        if (api.hideOthers) api.hideOthers(on);                                                       // (the cameras, the exhaust points, the wheel boxes and the axes go out of the way)
        if (!on && isMount(layers.selected)) { selectLayer(layers.selected); renderRows(); }          // (deselects, and the rows show it)
    }
    function pickables() { return Object.keys(markers).map((id) => markers[id].ball); }
    $("suspEdit").addEventListener("click", () => setEditing(!editing));
    $("originsCancel").addEventListener("click", () => setEditing(false));
    $("originsSave").addEventListener("click", async () => { try { await save(); setEditing(false); } catch (e) { /* save says what went wrong */ } });
    window.addEventListener("keydown", (e) => {
        if (!editing || e.code !== "Escape") return;
        const t = e.target && e.target.tagName;
        if (t === "INPUT" || t === "TEXTAREA" || t === "SELECT") return;
        if (document.pointerLockElement) return;
        setEditing(false);
    });

    // "No suspension (a kart)" and the type None on both axles are one thing: the one follows the other (a kart with no parts still had springs)
    const unsprungBox = $("unsprung");
    let linking = false;
    const setUnsprung = (on) => { if (!unsprungBox || unsprungBox.checked === on) return; unsprungBox.checked = on; unsprungBox.dispatchEvent(new Event("change")); };
    ["front", "rear"].forEach((axle) => selects[axle].addEventListener("change", () => {
        state[axle].type = selects[axle].value;
        if (!linking) {
            const none = selects.front.value === "none" && selects.rear.value === "none";
            linking = true;        // (the checkbox follows the selects here, not the other way round)
            if (none) setUnsprung(true); else if (unsprungBox && unsprungBox.checked && selects[axle].value !== "none") setUnsprung(false);
            linking = false;
        }
        refresh(true);
    }));
    if (unsprungBox) unsprungBox.addEventListener("change", () => {
        if (linking) return;
        linking = true;
        ["front", "rear"].forEach((axle) => {
            if (unsprungBox.checked && selects[axle].value !== "none") { selects[axle].value = "none"; state[axle].type = "none"; }
            else if (!unsprungBox.checked && selects[axle].value === "none") { selects[axle].value = "model"; state[axle].type = "model"; }
        });
        linking = false;
        refresh(true);
    });
    selects.engine.addEventListener("change", () => { state.driveline.engine = selects.engine.value; refresh(true); });
    $("drive").addEventListener("change", () => refresh(false));

    // the form moved the wheels: the next refresh takes the mounts that were placed by hand along
    function wheelsMoved() { moving = true; }
    return { read, fill, refresh, wheelsMoved, isMount, attachGizmo, moved, setMode, hide, pickables, get editing() { return editing; }, selected: () => (isMount(layers.selected) ? layers.selected : null) };
}
