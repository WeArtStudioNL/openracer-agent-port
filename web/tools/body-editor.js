/*
 * body-editor.js
 *
 * Description: The "Body (shapes)" card of the car editor: a car without a model file, made of simple shapes (box, cylinder, sphere, cone, wedge) that are placed, turned, sized and
 *              coloured here and saved in car.json as "model": { "type": "shapes", "shapes": [...] } (Shapes.js builds them, in the game and in the view). A shape can be
 *              mirrored to the other side of the car and can have a parent, so that parts of the rig hang together. The wheels, the steering wheel and the rig parts are shapes
 *              with the names the game looks for (wheel_FL, steeringwheel, susp_upright_FL, ...), the same as the parts of a glTF model.
 *              Vertex editing of a shape comes later: a shape of type "mesh" would hold its own vertices in the same list.
 * Author:      Glenn Hofman
 * Date:        2026-10-29
 * License:     MIT
 */

export function initBody(api) {
    const { $, THREE, TransformControls, scene, pivot, camera, renderer, controls, status } = api;
    const S = () => window.OpenRacer.Shapes;
    const D = Math.PI / 180;
    let list = [];                       // the shapes, as saved (every field filled in)
    let selected = -1;
    let on = false;                      // the car has a body of shapes
    let group = null;                    // what Shapes.build made of the list (the car editor holds it as the model)
    let timer = 0;
    const proxy = new THREE.Object3D();  // the gizmo moves this; the shape follows
    pivot.add(proxy);
    const gizmo = new TransformControls(camera, renderer.domElement);
    gizmo.setSize(0.7);
    gizmo.setSpace("local");
    let dragging = false;
    gizmo.addEventListener("dragging-changed", (e) => { dragging = e.value; controls.enabled = !e.value; if (!e.value) rebuildNow(); });
    gizmo.addEventListener("objectChange", gizmoMoved);
    const helper = typeof gizmo.getHelper === "function" ? gizmo.getHelper() : gizmo;
    scene.add(helper);
    helper.visible = false;
    const outline = new THREE.BoxHelper(new THREE.Object3D(), 0xffd04d);
    outline.visible = false;
    scene.add(outline);

    const fields = {
        name: $("bodyName"), type: $("bodyType"), parent: $("bodyParent"), color: $("bodyColor"), metal: $("bodyMetal"), rough: $("bodyRough"), opacity: $("bodyOpacity"), mirror: $("bodyMirror"),
        pos: ["bodyPX", "bodyPY", "bodyPZ"].map($), rot: ["bodyRX", "bodyRY", "bodyRZ"].map($), size: ["bodySX", "bodySY", "bodySZ"].map($)
    };

    const STARTER = [
        { name: "body", type: "box", position: [0, 0.2, 0], size: [1.0, 0.3, 2.2], color: "#c0392b", metal: 0.4, rough: 0.45 },
        { name: "cabin", type: "box", parent: "body", position: [0, 0.3, -0.1], size: [0.8, 0.3, 1.0], color: "#1b2a38", metal: 0.1, rough: 0.1, opacity: 0.7 },
        { name: "nose", type: "wedge", parent: "body", position: [0, 0.0, 1.45], size: [1.0, 0.3, 0.7], color: "#c0392b", metal: 0.4, rough: 0.45 },
        { name: "wheel_FL", type: "cylinder", position: [0.62, 0, 0.75], rotation: [0, 0, 90], size: [0.5, 0.25, 0.5], color: "#1c1c1c", metal: 0, rough: 0.9, mirror: true },
        { name: "wheel_RL", type: "cylinder", position: [0.62, 0, -0.75], rotation: [0, 0, 90], size: [0.5, 0.25, 0.5], color: "#1c1c1c", metal: 0, rough: 0.9, mirror: true }
    ];

    const view = () => window.OpenRacer.Shapes;
    const fix = (v) => Math.round(v * 10000) / 10000;

    function rebuildSoon() { clearTimeout(timer); timer = setTimeout(rebuildNow, 60); }
    function rebuildNow() {
        clearTimeout(timer);
        if (!on) return;
        group = view().build(list);
        api.apply(group, false);
        placeProxy();
        fillParents();
        info();
    }
    function info() { $("bodyInfo").textContent = on ? list.length + " shape" + (list.length === 1 ? "" : "s") : "None"; }

    // ---- the list and the form
    function renderList() {
        const select = $("bodyList");
        select.innerHTML = "";
        list.forEach((s, i) => {
            const option = document.createElement("option");
            option.value = String(i);
            option.textContent = (s.parent ? "   " : "") + s.name + "  (" + s.type + (s.mirror ? ", mirrored" : "") + ")";
            select.appendChild(option);
        });
        if (selected >= 0 && selected < list.length) select.value = String(selected);
    }
    function fillParents() {
        const select = fields.parent, current = selected >= 0 && list[selected] ? list[selected].parent : "";
        select.innerHTML = "";
        const none = document.createElement("option"); none.value = ""; none.textContent = "(none)"; select.appendChild(none);
        list.forEach((s, i) => {
            if (i === selected) return;
            const option = document.createElement("option"); option.value = s.name; option.textContent = s.name; select.appendChild(option);
        });
        select.value = current;
    }
    function fillForm() {
        const s = list[selected];
        $("bodyForm").style.display = s ? "" : "none";
        if (!s) return;
        fields.name.value = s.name; fields.type.value = s.type; fields.color.value = s.color;
        fields.metal.value = s.metal; fields.rough.value = s.rough; fields.opacity.value = s.opacity; fields.mirror.checked = s.mirror;
        s.position.forEach((v, i) => { fields.pos[i].value = fix(v); });
        s.rotation.forEach((v, i) => { fields.rot[i].value = fix(v); });
        s.size.forEach((v, i) => { fields.size[i].value = fix(v); });
        fillParents();
    }
    function readForm() {
        const s = list[selected];
        if (!s) return;
        const old = s.name;
        let name = fields.name.value.trim() || s.name;
        // (a name is unique: the game finds a part by it)
        if (list.some((o, i) => i !== selected && (o.name === name || (o.mirror && view().mirrorName(o.name) === name)))) name = old;
        s.name = name; s.type = fields.type.value; s.parent = fields.parent.value; s.color = fields.color.value;
        s.metal = parseFloat(fields.metal.value); s.rough = parseFloat(fields.rough.value); s.opacity = parseFloat(fields.opacity.value); s.mirror = fields.mirror.checked;
        s.position = fields.pos.map((e) => parseFloat(e.value) || 0);
        s.rotation = fields.rot.map((e) => parseFloat(e.value) || 0);
        s.size = fields.size.map((e) => Math.max(0.001, parseFloat(e.value) || 0.001));
        if (old !== name) list.forEach((o) => { if (o.parent === old) o.parent = name; });
        list[selected] = view().normal(s);
        renderList();
        rebuildSoon();
    }
    function select(i) {
        selected = i;
        $("bodyList").value = i >= 0 ? String(i) : "";
        fillForm();
        placeProxy();
    }

    // ---- the gizmo and the outline
    function nodeOf(shape) { return group && group.userData.byName[shape.name]; }
    function placeProxy() {
        const s = list[selected], node = s && nodeOf(s);
        if (!node || !on) { gizmo.detach(); helper.visible = false; outline.visible = false; return; }
        group.updateMatrixWorld(true);
        const wp = node.getWorldPosition(new THREE.Vector3()), wq = node.getWorldQuaternion(new THREE.Quaternion());
        proxy.position.copy(pivot.worldToLocal(wp));
        proxy.quaternion.copy(wq);
        proxy.updateMatrixWorld(true);
        gizmo.attach(proxy);
        helper.visible = true;
        const target = node.isMesh ? node : node.children.find((c) => c.isMesh) || node;
        outline.setFromObject(target);
        outline.visible = true;
    }
    function gizmoMoved() {
        const s = list[selected], node = s && nodeOf(s);
        if (!s || !node) return;
        proxy.updateMatrixWorld(true);
        // the new place in the frame of the parent (or of the car)
        const parentNode = node.parent && node.parent !== group ? node.parent : null;
        const inverse = new THREE.Matrix4();
        if (parentNode) { parentNode.updateWorldMatrix(true, false); inverse.copy(parentNode.matrixWorld).invert(); }
        else inverse.copy(pivot.matrixWorld).invert();
        const local = new THREE.Matrix4().multiplyMatrices(inverse, proxy.matrixWorld);
        const p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
        local.decompose(p, q, sc);
        const e = new THREE.Euler().setFromQuaternion(q, "YXZ");
        const x = node.userData.mirrored ? -1 : 1;                    // (a mirrored copy: the place of the shape is the mirror of this)
        s.position = [fix(p.x * x), fix(p.y), fix(p.z)];
        s.rotation = [fix(e.x / D), fix(e.y / D * x), fix(e.z / D * x)];
        fillForm();
        // the shape follows at once, without building everything again while the gizmo is held
        node.position.set(p.x, p.y, p.z); node.quaternion.copy(q);
        const target = node.isMesh ? node : node.children.find((c) => c.isMesh) || node;
        outline.setFromObject(target);
    }
    $("bodyMove").addEventListener("click", () => { gizmo.setMode("translate"); });
    $("bodyTurn").addEventListener("click", () => { gizmo.setMode("rotate"); });
    window.addEventListener("keydown", (e) => {
        if (!on || e.target.closest && e.target.closest("input, select, textarea")) return;
        if (e.key === "w") gizmo.setMode("translate");
        else if (e.key === "e") gizmo.setMode("rotate");
    });

    // ---- picking in the view
    let down = null;
    renderer.domElement.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; });
    renderer.domElement.addEventListener("pointerup", (e) => {
        if (!on || !down || dragging || gizmo.axis) { down = null; return; }
        const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
        down = null;
        if (moved > 4 || !group) return;
        const rect = renderer.domElement.getBoundingClientRect();
        const ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
        const hit = ray.intersectObject(group, true)[0];
        if (!hit) return;
        for (let o = hit.object; o && o !== group; o = o.parent) {
            if (o.userData.shapeIndex !== undefined) { select(o.userData.shapeIndex); return; }
        }
    });

    // ---- buttons
    function unique(base) {
        let name = base, n = 2;
        while (list.some((s) => s.name === name || (s.mirror && view().mirrorName(s.name) === name))) name = base + "_" + (n++);
        return name;
    }
    function add(type, extra) {
        if (!on) begin(false);
        const s = view().normal(Object.assign({ name: unique(type), type, position: [0, 0.3, 0], size: type === "cylinder" || type === "cone" || type === "sphere" ? [0.3, 0.3, 0.3] : [0.4, 0.3, 0.6], color: "#9aa4b2" }, extra || {}));
        list.push(s);
        renderList(); select(list.length - 1); rebuildNow();
    }
    document.querySelectorAll("[data-body-add]").forEach((b) => b.addEventListener("click", () => add(b.dataset.bodyAdd)));
    $("bodyDuplicate").addEventListener("click", () => {
        const s = list[selected];
        if (!s) return;
        const copy = view().normal(JSON.parse(JSON.stringify(s)));
        copy.name = unique(s.name.replace(/_\d+$/, "")); copy.position[2] += 0.2; copy.mirror = s.mirror;
        list.push(copy); renderList(); select(list.length - 1); rebuildNow();
    });
    $("bodyDelete").addEventListener("click", () => {
        const s = list[selected];
        if (!s) return;
        list.forEach((o) => { if (o.parent === s.name) o.parent = s.parent; });       // (the children go up to the parent of the shape)
        list.splice(selected, 1);
        renderList(); select(Math.min(selected, list.length - 1)); rebuildNow();
    });
    for (const el of [fields.name, fields.type, fields.parent, fields.color, fields.metal, fields.rough, fields.opacity, fields.mirror, ...fields.pos, ...fields.rot, ...fields.size]) {
        el.addEventListener("input", readForm);
        el.addEventListener("change", readForm);
    }
    $("bodyList").addEventListener("change", () => select(parseInt($("bodyList").value, 10)));
    $("bodyStart").addEventListener("click", () => begin(true));

    // a new body: the starter (a body, a cabin, a nose and four wheels), or an empty one
    function begin(starter) {
        on = true;
        list = (starter ? STARTER : []).map((s) => view().normal(s));
        selected = list.length ? 0 : -1;
        group = view().build(list);
        api.apply(group, true);
        $("bodyEdit").style.display = ""; $("bodyStart").style.display = "none";
        renderList(); select(selected); placeProxy(); info();
        status(starter ? "A body of shapes: select a shape in the list or in the view and move it with the arrows (W: move, E: turn), or type the numbers." : "An empty body: add shapes.", "ok");
    }
    function load(shapes) {
        on = true;
        list = (shapes || []).map((s) => view().normal(s));
        selected = list.length ? 0 : -1;
        group = view().build(list);
        api.apply(group, "load");
        $("bodyEdit").style.display = ""; $("bodyStart").style.display = "none";
        renderList(); select(selected); placeProxy(); info();
    }
    function clear() {
        on = false; list = []; selected = -1; group = null;
        gizmo.detach(); helper.visible = false; outline.visible = false;
        $("bodyEdit").style.display = "none"; $("bodyStart").style.display = "";
        info();
    }
    info();
    return {
        begin, load, clear,
        active: () => on,
        shapes: () => JSON.parse(JSON.stringify(list)),
        // the other layers of the editor are picked: the gizmo of the shape is put away
        hideGizmo: () => { gizmo.detach(); helper.visible = false; outline.visible = false; }
    };
}
