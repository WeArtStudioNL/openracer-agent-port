/*
 * PartsLibrary.js
 *
 * Description: The suspension and the driveline of a car built from loose parts, by what the car editor says: a type of suspension for the front and for the rear
 *              (a double wishbone, a MacPherson strut, a live axle on trailing arms, a live axle on leaf springs; or "model", the parts in the model of the car as
 *              before, or none), the drive (front, rear, all: drivetrain.drive) and where the engine is (front, mid, rear). The parts are glTF files in a folder
 *              of the game, web/parts/<type>/<part>.glb, one set per type, named the way this file expects them; the car editor says which are missing. Each part
 *              is modelled on a nominal size and the game fits it to the car:
 *
 *                a stretched part    its origin at the end that sits on the body (a hinge, a top mount, the gearbox), the part 1 m long along +Y to its other end;
 *                                    the game aims it at its other end and scales it along its length (the thickness stays): the arms, the trailing arms, the
 *                                    coilovers, dampers and struts, the tie rods, the Panhard rod, the propshaft, the driveshafts. A coilover or a strut may hold
 *                                    parts named ..._piston and ..._coil: the cylinder keeps its length, the piston slides and the coil gets shorter (SuspensionRig.js)
 *                the axle            its origin at its middle, 1 m long along X (from -0.5 to +0.5); scaled to the track less the width of the wheels
 *                the leaf spring     its origin at its middle, where it sits on the axle, 1 m long along Z (from -0.5 to +0.5); scaled from the front hanger to the rear
 *                a rigid part        at its own size, its origin at its mount: the upright (at the middle of the wheel), the engine, the gearbox, a differential
 *                the rack            its origin at its middle, 1 m wide along X; scaled to the width that its end mount (rack_end) gives
 *
 *              A part can be hidden in the car editor (the eye of the card: "hidden": ["engine", "gearbox"] of the axle or the driveline in car.json), for a car
 *              whose own model has that part.
 *              Every part is modelled for the LEFT side (+x); the right side is its mirror image. Where a part goes is a mount: a point (and a turn) in the frame of
 *              the car (x to the left, y up, z forward, the origin as the model has it) that the car editor shows as a gizmo, with a default from the wheels:
 *
 *                double-wishbone     upper_hinge, upper_ball, lower_hinge, lower_ball (the arms: the hinge on the body and the ball joint), spring_top, spring_bottom (the
 *                                    coilover: its top mount and its seat on the lower arm), tierod_inner, tierod_outer (the tie rod: on the rack, on the steering arm), rack (the front)
 *                macpherson          lower_hinge, lower_ball, strut_top, strut_bottom, tierod_inner, tierod_outer, rack
 *                live-trailing       lower_hinge, lower_arm_end, upper_hinge, upper_arm_end (the trailing arms: on the body, on the axle), spring_top, spring_bottom, damper_top,
 *                                    damper_bottom, panhard, panhard_axle (the rod: on the body, on the axle at the other side; these two are not mirrored)
 *                live-leaf           leaf_front, leaf_rear (the hangers), damper_top, damper_bottom
 *                the driveline       engine, gearbox, diff_front, diff_rear (a differential of an independent axle that is driven; a live axle holds its own),
 *                                    prop_rear_start, prop_rear_end (the two ends of a propshaft: at the gearbox, at the differential or the axle; prop_front_... likewise)
 *
 *              The parts are given the names that SuspensionRig.js moves (susp_lowerarm_FL, susp_spring_RL, susp_axle_rear, steer_rack, ...), so they move with the
 *              travel of the wheels and the steering as the parts of a model do. A propshaft goes from the gearbox to every driven axle whose differential is more than
 *              0.4 m from it; to a live axle it follows the axle. The physics is not changed by any of it.
 *
 *              car.json:  "suspension": { "front": { "type": "double-wishbone", "mounts": { "lower_hinge": { "position": [x, y, z], "rotation": [x, y, z] }, ... } },
 *                                         "rear": { ... } },
 *                         "driveline": { "engine": "front", "mounts": { "engine": { ... }, "gearbox": { ... }, "diff_rear": { ... } } }
 *
 *              OpenRacer.PartsLibrary.preload(config, manager, done)   loads the files the car needs (once; cached), then calls done
 *              OpenRacer.PartsLibrary.assemble(config, measured)       the parts, placed, in a group in the frame of the car: { group, names, missing }
 *              OpenRacer.PartsLibrary.base                             the folder of web/ as the page sees it ("" in the game, "../" in the car editor)
 * Author:      Glenn Hofman
 * Date:        2026-10-26
 * License:     MIT
 */

OpenRacer.PartsLibrary = (function () {
    var V = THREE.Vector3, Q = THREE.Quaternion, Y = new V(0, 1, 0), DEG = Math.PI / 180;

    // the types of suspension of an axle: the parts (web/parts/<type>/<part>.glb) and the mounts (the left side; the right is its mirror)
    var TYPES = {
        "model": { label: "From the model (parts named susp_…)", files: [], mounts: [] },
        "none": { label: "None", files: [], mounts: [] },
    // (a stretched part has a mount at each end: where it sits on the body, and where its other end goes: the ball joint on the upright, the seat of the spring on the arm or the axle)
        "double-wishbone": { label: "Double wishbone", files: ["upperarm", "lowerarm", "upright", "coilover", "tierod"], mounts: ["upper_hinge", "upper_ball", "lower_hinge", "lower_ball", "spring_top", "spring_bottom", "tierod_inner", "tierod_outer", "rack", "rack_end"] },
        "macpherson": { label: "MacPherson strut", files: ["lowerarm", "strut", "upright", "tierod"], mounts: ["lower_hinge", "lower_ball", "strut_top", "strut_bottom", "tierod_inner", "tierod_outer", "rack", "rack_end"] },
        "live-trailing": { label: "Live axle, trailing arms", files: ["axle", "trailingarm", "uppertrailingarm", "coilover", "damper", "panhard"], mounts: ["lower_hinge", "lower_arm_end", "upper_hinge", "upper_arm_end", "spring_top", "spring_bottom", "damper_top", "damper_bottom", "panhard", "panhard_axle"] },
        "live-leaf": { label: "Live axle, leaf springs", files: ["axle", "leafspring", "damper"], mounts: ["leaf_front", "leaf_rear", "damper_top", "damper_bottom"] }
    };
    var MOUNT_LABELS = {
        upper_hinge: "Upper arm: hinge on the body", upper_ball: "Upper arm: ball joint", lower_hinge: "Lower arm: hinge on the body", lower_ball: "Lower arm: ball joint",
        spring_top: "Spring: top mount", spring_bottom: "Spring: bottom (seat)", strut_top: "Strut: top mount", strut_bottom: "Strut: foot on the upright",
        tierod_inner: "Tie rod: inner end", tierod_outer: "Tie rod: outer end (steering arm)", rack: "Steering rack (the middle)", rack_end: "Steering rack: end (the width; along the rack only)",
        damper_top: "Damper: top mount", damper_bottom: "Damper: bottom (on the axle)", lower_arm_end: "Lower trailing arm: end on the axle", upper_arm_end: "Upper trailing arm: end on the axle",
        panhard: "Panhard rod: end on the body", panhard_axle: "Panhard rod: end on the axle (the other side)", leaf_front: "Leaf spring: front hanger", leaf_rear: "Leaf spring: rear hanger",
        engine: "Engine", gearbox: "Gearbox", diff_front: "Front differential", diff_rear: "Rear differential",
        prop_front_start: "Propshaft to the front: at the gearbox", prop_front_end: "Propshaft to the front: at the differential",
        prop_rear_start: "Propshaft to the rear: at the gearbox", prop_rear_end: "Propshaft to the rear: at the differential"
    };
    var ENGINE = ["front", "mid", "rear"];
    var DRIVELINE_FILES = ["engine", "gearbox", "differential", "propshaft", "driveshaft"];
    // the parts as the car editor names them, with an eye each: a part that is hidden is not placed (a car whose own model has its engine or its gearbox keeps those)
    var PART_LABELS = {
        upperarm: "Upper arm", lowerarm: "Lower arm", upright: "Upright", coilover: "Coilover", tierod: "Tie rod", strut: "Strut", rack: "Steering rack",
        axle: "Axle", trailingarm: "Lower trailing arm", uppertrailingarm: "Upper trailing arm", damper: "Damper", panhard: "Panhard rod", leafspring: "Leaf spring",
        engine: "Engine", gearbox: "Gearbox", differential: "Differential", propshaft: "Propshaft", driveshaft: "Driveshafts"
    };
    function hiddenOf(config, group) {
        var h = group === "driveline" ? (config.driveline && config.driveline.hidden) : (config.suspension && config.suspension[group] && config.suspension[group].hidden);
        return Array.isArray(h) ? h : [];
    }
    // the parts of a group of a car, for the editor: [{ file, label }]
    function partsOf(config, group) {
        if(group === "driveline") return DRIVELINE_FILES.map(function (f) { return { file: f, label: PART_LABELS[f] }; });
        var t = typeOf(config, group);
        if(t === "model" || t === "none") return [];
        var files = TYPES[t].files.slice();
        if(group === "front" && !isLive(t)) files.push("rack");
        return files.map(function (f) { return { file: f, label: PART_LABELS[f] || f }; });
    }
    var ORIGIN = new V(0, 0, 0);

    function isLive(type) { return type === "live-trailing" || type === "live-leaf"; }
    function typeOf(config, axle) { var s = config.suspension && config.suspension[axle]; return s && TYPES[s.type] ? s.type : "model"; }
    function enginePlace(config) { var e = config.driveline && config.driveline.engine; return ENGINE.indexOf(e) >= 0 ? e : "front"; }
    function drivenAxles(config) { var d = (config.drivetrain && config.drivetrain.drive) || "rwd"; return { front: d !== "rwd", rear: d !== "fwd" }; }

    // ---- the geometry of the car, from the wheels (CarLoader's measured: the centres in the frame of the car)
    function geometry(measured) {
        var c = measured.centres;
        var left = function (a, b) { return a.x >= b.x ? a : b; };
        var fl = left(c.FL, c.FR), rl = left(c.RL, c.RR);
        return {
            front: { W: new V(Math.abs(fl.x), fl.y, (c.FL.z + c.FR.z) / 2), track: Math.abs(c.FL.x - c.FR.x) },
            rear: { W: new V(Math.abs(rl.x), rl.y, (c.RL.z + c.RR.z) / 2), track: Math.abs(c.RL.x - c.RR.x) },
            radius: (measured.diameter || 0.6) / 2
        };
    }

    // ---- the mounts of an axle of a type: their defaults from the wheels, overridden by what the car editor set (the left side)
    function mountNames(type, axle) {
        var t = TYPES[type]; if(!t) return [];
        return t.mounts.filter(function (m) { return (m !== "rack" && m !== "rack_end") || axle === "front"; });
    }
    function defaultMount(name, axle, geo) {
        var g = geo[axle], xw = g.W.x, yw = g.W.y, z = g.W.z, fwd = axle === "front" ? 1 : -1;
        var p;
        switch(name) {
            case "upper_hinge": p = [0.35 * xw, yw + 0.18, z]; break;
            case "upper_ball": p = [xw - 0.12, yw + 0.17, z]; break;
            case "lower_hinge": p = [0.35 * xw, yw - 0.15, z]; break;
            case "lower_ball": p = [xw - 0.12, yw - 0.17, z]; break;
            case "spring_top": p = [0.62 * xw, yw + 0.65, z]; break;
            case "spring_bottom": p = [0.35 * xw + 0.75 * (xw - 0.12 - 0.35 * xw), yw - 0.15 + 0.75 * (-0.02), z]; break;       // (three quarters of the way out on the lower arm)
            case "strut_top": p = [0.75 * xw, yw + 0.7, z - 0.03]; break;
            case "strut_bottom": p = [xw - 0.12, yw - 0.05, z]; break;
            case "tierod_inner": p = [0.25 * xw, yw, z + fwd * 0.18]; break;
            case "tierod_outer": p = [xw - 0.12, yw, z + fwd * 0.14]; break;
            case "damper_bottom": p = [0.55 * xw, yw, z - 0.1]; break;
            case "rack": p = [0, yw, z + 0.18]; break;
            case "rack_end": p = [0.45 * xw, yw, z + 0.18]; break;                 // (the end of the rack: its width is twice this, from the middle)
            case "damper_top": p = [0.5 * xw, yw + 0.7, z - 0.15]; break;
            case "panhard": p = [0.8 * xw, yw + 0.15, z - 0.15]; break;
            case "leaf_front": p = [0.75 * xw, yw + 0.1, z + 0.6]; break;
            case "leaf_rear": p = [0.75 * xw, yw + 0.1, z - 0.6]; break;
            default: p = [0, yw, z];
        }
        return { position: p, rotation: [0, 0, 0] };
    }
    // the trailing arms of a live axle hang from hinges in front of it: the defaults differ from the independent ones
    function defaultLiveMount(name, axle, geo) {
        var g = geo[axle], xw = g.W.x, yw = g.W.y, z = g.W.z;
        var at = function (p) { return { position: p, rotation: [0, 0, 0] }; };
        if(name === "lower_hinge") return at([0.7 * xw, yw + 0.05, z + 1.0]);
        if(name === "lower_arm_end") return at([0.7 * xw, yw, z]);
        if(name === "upper_hinge") return at([0.35 * xw, yw + 0.3, z + 1.0]);
        if(name === "upper_arm_end") return at([0.35 * xw, yw + 0.25, z]);
        if(name === "spring_top") return at([0.7 * xw, yw + 0.75, z + 0.1]);
        if(name === "spring_bottom") return at([0.7 * xw, yw + 0.05, z]);
        if(name === "damper_bottom") return at([0.55 * xw, yw + 0.05, z - 0.1]);
        if(name === "panhard_axle") return at([-0.7 * xw, yw + 0.1, z - 0.15]);         // (the other side of the car: not mirrored)
        return defaultMount(name, axle, geo);
    }
    function resolveMounts(type, axle, set, geo) {
        var out = {};
        mountNames(type, axle).forEach(function (name) {
            var d = isLive(type) ? defaultLiveMount(name, axle, geo) : defaultMount(name, axle, geo);
            var m = set && set[name];
            out[name] = { position: m && m.position && m.position.length === 3 ? m.position.slice() : d.position, rotation: m && m.rotation && m.rotation.length === 3 ? m.rotation.slice() : d.rotation };
        });
        // the end of the rack sits on the line of the rack: only its distance from the middle counts (the width), its height and its place along the car are the rack's
        if(out.rack && out.rack_end) { out.rack_end.position = [out.rack.position[0] + Math.max(0.05, Math.abs(out.rack_end.position[0] - out.rack.position[0])), out.rack.position[1], out.rack.position[2]]; out.rack_end.rotation = [0, 0, 0]; }
        return out;
    }
    // the propshaft to an axle: the gearbox is more than 0.4 m from the differential of that axle (or the middle of a live axle); both its ends are mounts
    function propTo(config, axle, geo, set) {
        var t = typeOf(config, axle);
        if(!drivenAxles(config)[axle] || t === "model" || t === "none") return false;
        var gb = mountValue("gearbox", config, geo, set), target = isLive(t) ? [0, geo[axle].W.y, geo[axle].W.z] : mountValue("diff_" + axle, config, geo, set);
        return Math.hypot(gb[0] - target[0], gb[1] - target[1], gb[2] - target[2]) > 0.4;
    }
    function mountValue(name, config, geo, set) {
        var m = set && set[name];
        return m && m.position && m.position.length === 3 ? m.position : defaultDrivelineMount(name, config, geo).position;
    }
    function drivelineMountNames(config, geo, set) {
        var names = ["engine", "gearbox"], driven = drivenAxles(config);
        ["front", "rear"].forEach(function (axle) { var t = typeOf(config, axle); if(driven[axle] && t !== "model" && t !== "none" && !isLive(t)) names.push("diff_" + axle); });
        if(geo) ["front", "rear"].forEach(function (axle) { if(propTo(config, axle, geo, set)) names.push("prop_" + axle + "_start", "prop_" + axle + "_end"); });
        return names;
    }
    function defaultDrivelineMount(name, config, geo) {
        var zf = geo.front.W.z, zr = geo.rear.W.z, yw = (geo.front.W.y + geo.rear.W.y) / 2, place = enginePlace(config), p;
        if(name === "engine") p = place === "front" ? [0, yw + 0.35, zf - 0.35] : (place === "mid" ? [0, yw + 0.3, (zf + zr) / 2 - 0.4] : [0, yw + 0.3, zr - 0.2]);
        else if(name === "gearbox") p = place === "rear" ? [0, yw + 0.1, zr + 0.5] : (place === "front" ? [0, yw + 0.15, zf - 1.05] : [0, yw + 0.1, (zf + zr) / 2 - 1.1]);
        else if(name === "diff_front") p = [0, yw, zf];
        else if(name === "diff_rear") p = [0, yw, zr];
        else if(/^prop_(front|rear)_start$/.test(name)) p = mountValue("gearbox", config, geo, config.driveline && config.driveline.mounts).slice();
        else if(/^prop_(front|rear)_end$/.test(name)) { var ax = name.indexOf("front") >= 0 ? "front" : "rear"; p = isLive(typeOf(config, ax)) ? [0, geo[ax].W.y, geo[ax].W.z] : mountValue("diff_" + ax, config, geo, config.driveline && config.driveline.mounts).slice(); }
        else p = [0, yw, zr];
        return { position: p, rotation: [0, 0, 0] };
    }
    function resolveDriveline(config, geo) {
        var set = config.driveline && config.driveline.mounts, out = {};
        drivelineMountNames(config, geo, set).forEach(function (name) {
            var d = defaultDrivelineMount(name, config, geo), m = set && set[name];
            out[name] = { position: m && m.position && m.position.length === 3 ? m.position.slice() : d.position, rotation: m && m.rotation && m.rotation.length === 3 ? m.rotation.slice() : d.rotation };
        });
        return out;
    }

    // ---- the files
    var cache = {};                      // url -> { scene } or { error }
    var lib = { base: "" };
    function url(type, file) { return lib.base + "parts/" + type + "/" + file + ".glb"; }
    function filesFor(config) {
        var list = [], driven = drivenAxles(config), any = false;
        ["front", "rear"].forEach(function (axle) {
            var t = typeOf(config, axle);
            if(t === "model" || t === "none") return;
            any = true;
            TYPES[t].files.forEach(function (f) { list.push({ type: t, file: f }); });
            if(axle === "front" && !isLive(t)) list.push({ type: "steering", file: "rack" });
        });
        if(any) DRIVELINE_FILES.forEach(function (f) { list.push({ type: "driveline", file: f }); });
        return list;
    }
    function preload(config, manager, done) {
        var files = filesFor(config).filter(function (f) { return !cache[url(f.type, f.file)]; });
        var left = files.length;
        if(!left) { done(); return; }
        var loader = new THREE.GLTFLoader(manager);
        files.forEach(function (f) {
            var u = url(f.type, f.file);
            cache[u] = { loading: true };
            loader.load(u, function (loaded) { cache[u] = { scene: loaded.scene }; if(--left === 0) done(); },
                undefined, function (error) { cache[u] = { error: error || true }; console.warn("PartsLibrary: no " + u); if(--left === 0) done(); });
        });
    }
    function template(type, file) { var e = cache[url(type, file)]; return e && e.scene ? e.scene : null; }

    // ---- the assembly: the parts placed in the frame of the car. mirror: the right side (the part is the mirror image of the one on the left)
    function place(out, type, file, name, origin, far, mount, mirror) {
        var group = type === "driveline" ? "driveline" : out.axle;
        if(out.hidden[group] && out.hidden[group].indexOf(file) >= 0) return null;          // (hidden in the car editor: the car's own model has it)
        var t = template(type, file);
        if(!t) { if(out.missing.indexOf(type + "/" + file) < 0) out.missing.push(type + "/" + file); return null; }
        var node = new THREE.Object3D();
        node.name = name;
        node.add(t.clone(true));
        node.position.copy(origin);
        var rot = mount && mount.rotation ? mount.rotation : [0, 0, 0], s = mirror ? -1 : 1;
        if(far) {
            var d = new V().subVectors(far, origin), length = d.length();
            if(length < 1e-4) { d.set(0, -1, 0); length = 0.05; }
            node.quaternion.setFromUnitVectors(Y, d.normalize());
            if(rot[1]) node.quaternion.multiply(new Q().setFromAxisAngle(Y, rot[1] * DEG * s));         // (the turn of a stretched part is a roll about its own length)
            node.scale.set(s, length, 1);
            node.userData.rigFar = far.clone();                                                        // (the exact far end, for the rig: the box of a slanted part reaches past it)
        } else {
            node.quaternion.setFromEuler(new THREE.Euler(rot[0] * DEG, rot[1] * DEG * s, rot[2] * DEG * s));
            node.scale.set(s, 1, 1);
        }
        out.group.add(node);
        out.names.push(name);
        return node;
    }
    function mirrored(p, side) { return new V(p[0] * side, p[1], p[2]); }

    function buildAxle(out, config, type, axle, mounts, geo, driven) {
        var g = geo[axle], corners = axle === "front" ? ["FL", "FR"] : ["RL", "RR"], z = g.W.z;
        var tierodZ = axle === "front" ? 1 : -1;
        if(isLive(type)) {
            var axleCentre = new V(0, g.W.y, z), ax = place(out, type, "axle", "susp_axle_" + axle, axleCentre, null, null, false);
            if(ax) ax.scale.x = Math.max(0.2, g.track - 0.2);
        }
        [1, -1].forEach(function (side, i) {
            var corner = corners[i], mirror = side < 0, W = new V(g.W.x * side, g.W.y, z);
            var at = function (name) { return mirrored(mounts[name].position, side); };
            var m = function (name) { return mounts[name]; };
            if(type === "double-wishbone" || type === "macpherson") {
                place(out, type, "lowerarm", "susp_lowerarm_" + corner, at("lower_hinge"), at("lower_ball"), m("lower_hinge"), mirror);
                place(out, type, "upright", "susp_upright_" + corner, W, null, null, mirror);
                place(out, type, "tierod", "steer_tierod_" + corner, at("tierod_inner"), at("tierod_outer"), m("tierod_inner"), mirror);
                if(type === "double-wishbone") {
                    place(out, type, "upperarm", "susp_upperarm_" + corner, at("upper_hinge"), at("upper_ball"), m("upper_hinge"), mirror);
                    place(out, type, "coilover", "susp_spring_" + corner, at("spring_top"), at("spring_bottom"), m("spring_top"), mirror);
                } else place(out, type, "strut", "susp_strut_" + corner, at("strut_top"), at("strut_bottom"), m("strut_top"), mirror);
            } else if(type === "live-trailing") {
                place(out, type, "trailingarm", "susp_trailingarm_" + corner, at("lower_hinge"), at("lower_arm_end"), m("lower_hinge"), mirror);
                place(out, type, "uppertrailingarm", "susp_uppertrailingarm_" + corner, at("upper_hinge"), at("upper_arm_end"), m("upper_hinge"), mirror);
                place(out, type, "coilover", "susp_spring_" + corner, at("spring_top"), at("spring_bottom"), m("spring_top"), mirror);
                place(out, type, "damper", "susp_damper_" + corner, at("damper_top"), at("damper_bottom"), m("damper_top"), mirror);
            } else if(type === "live-leaf") {
                var lf = at("leaf_front"), lr = at("leaf_rear"), mid = lf.clone().add(lr).multiplyScalar(0.5);
                var leaf = place(out, type, "leafspring", "susp_axle_leaf_" + axle + "_" + (mirror ? "right" : "left"), mid, null, m("leaf_front"), mirror);
                if(leaf) leaf.scale.z = Math.max(0.2, Math.abs(lf.z - lr.z));
                place(out, type, "damper", "susp_damper_" + corner, at("damper_top"), at("damper_bottom"), m("damper_top"), mirror);
            }
        });
        if(type === "live-trailing") {
            // the Panhard rod: from the body on one side across to the axle on the other (its two mounts are as they are, not mirrored)
            place(out, type, "panhard", "susp_panhard_" + axle, mirrored(mounts.panhard.position, 1), mirrored(mounts.panhard_axle.position, 1), mounts.panhard, false);
        }
        if(axle === "front" && !isLive(type)) {
            // the rack: modelled 1 m wide along X about its middle, scaled to the width that its end mount gives (twice the distance from the middle)
            var rackNode = place(out, "steering", "rack", "steer_rack", mirrored(mounts.rack.position, 1), null, mounts.rack, false);
            if(rackNode && mounts.rack_end) rackNode.scale.x = Math.max(0.1, 2 * Math.abs(mounts.rack_end.position[0] - mounts.rack.position[0]));
        }
    }

    function buildDriveline(out, config, geo) {
        var dm = resolveDriveline(config, geo), driven = drivenAxles(config);
        var engine = mirrored(dm.engine.position, 1), gearbox = mirrored(dm.gearbox.position, 1);
        place(out, "driveline", "engine", "engine", engine, null, dm.engine, false);
        place(out, "driveline", "gearbox", "gearbox", gearbox, null, dm.gearbox, false);
        ["front", "rear"].forEach(function (axle) {
            var type = typeOf(config, axle);
            if(!driven[axle] || type === "model" || type === "none") return;
            var g = geo[axle], target;
            if(isLive(type)) target = new V(0, g.W.y, g.W.z);
            else {
                target = mirrored(dm["diff_" + axle].position, 1);
                place(out, "driveline", "differential", "differential_" + axle, target, null, dm["diff_" + axle], false);
                [1, -1].forEach(function (side, i) {
                    var corner = (axle === "front" ? ["FL", "FR"] : ["RL", "RR"])[i];
                    place(out, "driveline", "driveshaft", "susp_driveshaft_" + corner, target, new V(g.W.x * side, g.W.y, g.W.z), null, side < 0);
                });
            }
            // the propshaft between its two mounts (there when the gearbox is more than 0.4 m from the differential or the live axle)
            if(dm["prop_" + axle + "_start"]) {
                var ps = mirrored(dm["prop_" + axle + "_start"].position, 1), pe = mirrored(dm["prop_" + axle + "_end"].position, 1);
                if(ps.distanceTo(pe) > 0.1) place(out, "driveline", "propshaft", isLive(type) ? "susp_propshaft_" + axle : "propshaft_" + axle, ps, pe, dm["prop_" + axle + "_start"], false);
            }
        });
    }

    function assemble(config, measured) {
        var out = { group: new THREE.Group(), names: [], missing: [], hidden: { front: hiddenOf(config, "front"), rear: hiddenOf(config, "rear"), driveline: hiddenOf(config, "driveline") }, axle: "front" };
        out.group.name = "parts-library";
        if(!measured || !measured.centres || !measured.centres.FL) return out;
        var geo = geometry(measured), driven = drivenAxles(config), any = false;
        ["front", "rear"].forEach(function (axle) {
            var type = typeOf(config, axle);
            if(type === "model" || type === "none") return;
            any = true;
            out.axle = axle;
            var s = config.suspension[axle];
            buildAxle(out, config, type, axle, resolveMounts(type, axle, s.mounts, geo), geo, driven[axle]);
        });
        out.axle = "driveline";
        if(any) buildDriveline(out, config, geo);
        return out;
    }

    // for the car editor: the mounts of a car with their values (defaults filled in), to show as gizmos
    function mountsOf(config, measured) {
        var geo = geometry(measured), out = { front: {}, rear: {}, driveline: {} };
        ["front", "rear"].forEach(function (axle) {
            var type = typeOf(config, axle);
            if(type === "model" || type === "none") return;
            out[axle] = resolveMounts(type, axle, config.suspension[axle].mounts, geo);
        });
        if(typeOf(config, "front") !== "model" || typeOf(config, "rear") !== "model") {
            if(typeOf(config, "front") !== "none" || typeOf(config, "rear") !== "none") out.driveline = resolveDriveline(config, geo);
        }
        return out;
    }

    lib.TYPES = TYPES; lib.MOUNT_LABELS = MOUNT_LABELS; lib.ENGINE = ENGINE;
    lib.preload = preload; lib.assemble = assemble; lib.mountsOf = mountsOf; lib.filesFor = filesFor; lib.typeOf = typeOf; lib.isLive = isLive;
    lib.missingFiles = function (config) {
        return filesFor(config).filter(function (f) {
            var group = f.type === "driveline" ? "driveline" : (f.type === "steering" ? "front" : (typeOf(config, "front") === f.type ? "front" : "rear"));
            if(hiddenOf(config, group).indexOf(f.file) >= 0) return false;
            var e = cache[url(f.type, f.file)]; return !e || !e.scene;
        }).map(function (f) { return f.type + "/" + f.file + ".glb"; });
    };
    lib.partsOf = partsOf; lib.PART_LABELS = PART_LABELS;
    lib.url = url;
    return lib;
})();
