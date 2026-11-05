/*
 * WheelLibrary.js
 *
 * Description: Rims and tyres to choose from, in place of the wheels of the model of a car: a catalogue, web/wheels/wheels.json, that you add to yourself, with a glTF
 *              file for every rim and every tyre:
 *
 *                { "rims":  [ { "id": "alloy-17", "name": "Alloy 17\"", "file": "rims/alloy-17.glb", "offset": 0 }, ... ],
 *                  "tyres": [ { "id": "road-205-55-16", "name": "Road 205/55 R16", "file": "tyres/road-205-55-16.glb",
 *                               "shell": { "rings": 3, "segments": 36, "inner_ratio": 0.62, "carcass": 0 }, "width": 0.205, "diameter": 0.632 }, ... ] }
 *
 *              The file of a rim or a tyre (relative to web/wheels/): its origin at the middle of the wheel, on the axle, where it is mounted (the game puts it at
 *              the middle of the wheel of the model of the car, or, without wheel parts, at the wheelbase and the tracks of car.json); the wheel turns about X and the
 *              tread lies in the Y-Z plane; modelled for the LEFT side of the car (+X is outwards, the face of the rim), the right side is turned half a turn about Y;
 *              at real size, in metres: the diameter and the width of the tyre and the diameter of the rim are measured from the file ("width" and "diameter" of a tyre
 *              in the catalogue override the measure); "flip": true turns a file round that was modelled for the right side. "offset" of a rim (m) moves the rim and the
 *              tyre outwards (the track with it). tools/make-wheels.py writes a set
 *              of plain examples.
 *
 *              The TREADS: the look of a custom tyre for every pattern of tread (Wheel.js, treadPattern: "slick", "road", "allterrain", "knobbly"), from the rubber and the tread sliders:
 *
 *                "treads": [ { "id": "knobbly", "name": "Knobbly", "file": "tyres/tread-knobbly.glb" }, ... ]
 *
 *              The file is a tyre like those above (the axle along X, the middle at the origin), at any size: it is fitted between the inner and the outer shell of the custom tyre
 *              (the radius from the bead to the top of the tread stretched to the height of the sidewall, the width to the width of the tyre), so the profile keeps its depth as
 *              a share of the sidewall. A pattern without a file, or a file that did not load, is made from numbers (customMesh: no grooves on a slick, three on a road tyre,
 *              blocks on an all-terrain tyre, big lugs on a knobbly one).
 *
 *              The SHELL of the tyre (TyreShell.js: the rings of nodes across the tread, the nodes round the wheel, the radius of the inner shell as a share of the tyre,
 *              the carcass in mm) is a property of the tyre, set once here, and goes with the tyre to every car that mounts it: "tyres.shell" of car.json is not used for
 *              an axle on a tyre of the library, and the tuning menu hides those sliders. Without "inner_ratio" the rim that is mounted gives it (its radius over the
 *              tyre's); the width of the tread is the width of the tyre.
 *
 *              car.json:  "wheels": { "mode": "model", "nodes": { ... }, "library": { "front": { "rim": "alloy-17", "tyre": "sport-245-40-18" }, "rear": { ... } } }
 *                         an axle with a rim or a tyre of the library loses the wheel parts of the model (they are replaced; their middle is the hub); an axle without
 *                         keeps its own wheels. The car editor (the Wheels card) and the tuning menu (the Tyres group) choose them; the tuning menu builds the car again.
 *
 *              OpenRacer.WheelLibrary.load(base)                  loads the catalogue (once; a promise of it); base is the folder of web/ as the page sees it
 *              OpenRacer.WheelLibrary.rims() / .tyres()           the entries (empty before the catalogue has loaded)
 *              OpenRacer.WheelLibrary.choiceOf(config, axle)      { rim, tyre } ids of an axle ("" for none)
 *              OpenRacer.WheelLibrary.uses(config)                true when any axle has a rim or a tyre of the library
 *              OpenRacer.WheelLibrary.preload(config, manager, done)   loads the catalogue and the files the car needs (cached), then calls done
 *              OpenRacer.WheelLibrary.wheelFor(config, slot)      the wheel of a slot (FR, FL, RL, RR) built from the files: { object, diameter, width, shell, offset }, or null
 *              OpenRacer.WheelLibrary.shellOf(config, axle)       the shell of the library tyre of an axle ({ width, rings, segments, inner_ratio, carcass }), or null
 *              OpenRacer.WheelLibrary.base                        the folder of web/ ("" in the game, "../" in the car editor); null takes PartsLibrary.base
 * Author:      Glenn Hofman
 * Date:        2026-10-27
 * License:     MIT
 */

OpenRacer.WheelLibrary = (function () {
    var lib = { base: null };
    var catalog = { rims: [], tyres: [], treads: [] }, loading = null, loaded = false;
    var cache = {};                      // url -> { scene, size: { diameter, width } } or { error }
    var AXLE_OF = { FR: "front", FL: "front", RL: "rear", RR: "rear" }, LEFT = { FL: true, RL: true };

    function baseOf() { return lib.base !== null ? lib.base : (OpenRacer.PartsLibrary ? OpenRacer.PartsLibrary.base : ""); }
    function url(file) { return baseOf() + "wheels/" + file; }

    function load(base) {
        if(base !== undefined && base !== null) lib.base = base;
        if(loading) return loading;
        loading = fetch(url("wheels.json"), { cache: "no-store" }).then(function (r) { if(!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then(function (json) {
            catalog = { rims: Array.isArray(json.rims) ? json.rims.filter(function (e) { return e && e.id && e.file; }) : [], tyres: Array.isArray(json.tyres) ? json.tyres.filter(function (e) { return e && e.id && e.file; }) : [],
                treads: Array.isArray(json.treads) ? json.treads.filter(function (e) { return e && e.id; }) : [] };
            loaded = true;
            return catalog;
        }).catch(function (e) { console.warn("WheelLibrary: no wheels/wheels.json (" + (e && e.message || e) + ")"); loaded = true; return catalog; });
        return loading;
    }
    function rims() { return catalog.rims; }
    function tyres() { return catalog.tyres; }
    function find(list, id) { for(var i = 0; i < list.length; i++) if(list[i].id === id) return list[i]; return null; }
    function rim(id) { return id ? find(catalog.rims, id) : null; }
    function tyre(id) { return id ? find(catalog.tyres, id) : null; }
    function treadOf(pattern) { var t = find(catalog.treads, pattern); return t && t.file ? t : null; }

    var BIKE_TYRE = { front: "moto-120-70-17", rear: "moto-180-55-17" };
    // the tyres to offer a vehicle: those made for motorcycles only on a motorcycle (an entry with "for": "motorcycle"), none of them on a car
    function tyresFor(config) { var bike = !!config && config.type === "motorcycle"; return catalog.tyres.filter(function (t) { return bike ? t.for === "motorcycle" : t.for !== "motorcycle"; }); }

    // what car.json chose for an axle ("library": { "front": { "rim", "tyre" }, "rear": { ... } }; or { "rim", "tyre" } for both axles)
    function choiceOf(config, axle) {
        var L = config && config.wheels && config.wheels.library;
        if(!L) return { rim: "", tyre: "" };
        var a = L[axle] || (L.rim !== undefined || L.tyre !== undefined ? L : null) || {};
        // (a rim of the library brings a custom tyre, made from the numbers: the tyres of the library are no longer chosen, only kept for the cars that have one)
        // (a motorcycle with a rim of the library and no tyre named: the tyre of the library for its end of the bike, 120/70 at the front and 180/55 at the rear, round in the crown)
        var tyreId = a.tyre || (a.rim && !a.model && config.type === "motorcycle" && BIKE_TYRE[axle] && find(catalog.tyres, BIKE_TYRE[axle]) ? BIKE_TYRE[axle] : (a.rim || a.model ? "custom" : ""));
        return { rim: a.rim || "", tyre: tyreId, custom: tyreId === "custom" ? a.custom || {} : undefined, model: !!a.model };
    }

    // ---- the custom tyre: made from numbers, no file. The tyre is the space between the outer shell (the diameter, the width) and the inner shell (inner_ratio of the diameter): its
    // section is drawn between the two, with the grooves of a road tyre and none on a slick; the rim of the axle is scaled to the inner shell, whichever rim it is.
    var CUSTOM_ID = "custom";
    function customSpec(c) {
        var k = c || {};
        var width = k.width > 0 ? k.width : 0.245, diameter = k.diameter > 0 ? k.diameter : 0.65;
        var ratio = k.inner_ratio > 0 ? Math.max(0.3, Math.min(0.9, k.inner_ratio)) : 0.7;
        return { width: width, diameter: diameter, inner_ratio: ratio, rings: k.rings > 0 ? k.rings : 4, segments: k.segments > 0 ? k.segments : 36, carcass: k.carcass > 0 ? k.carcass : 0,
            rubber: k.rubber >= 0 ? Math.min(100, k.rubber) : 50, tread: k.tread >= 0 ? Math.min(100, k.tread) : 0 };
    }
    function patternOf(spec) { return OpenRacer.treadPattern ? OpenRacer.treadPattern(spec.tread, spec.rubber) : (spec.rubber < 75 ? "road" : "slick"); }
    // the geometries of a list in one (position, normal, uv; without an index)
    function merge(list) {
        var parts = list.map(function (g) { return g.index ? g.toNonIndexed() : g; }), count = 0;
        parts.forEach(function (g) { count += g.attributes.position.count; });
        var out = new THREE.BufferGeometry(), at = 0;
        var pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), uv = new Float32Array(count * 2);
        parts.forEach(function (g) {
            pos.set(g.attributes.position.array, at * 3); nor.set(g.attributes.normal.array, at * 3); uv.set(g.attributes.uv.array, at * 2);
            at += g.attributes.position.count;
        });
        out.setAttribute("position", new THREE.BufferAttribute(pos, 3)); out.setAttribute("normal", new THREE.BufferAttribute(nor, 3)); out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
        out.computeBoundingSphere(); out.computeBoundingBox();
        return out;
    }
    // the blocks of an off-road tread: rows across the tyre (the middle of the block across the tread as a share of the width, its width as a share, its length round the tyre as
    // a share of the pitch, and a shift round the tyre as a share of the pitch, which staggers the rows), every block a box that stands on the carcass and reaches the outer shell
    var TREAD_BLOCKS = {
        allterrain: { depth: 0.009, pitch: 0.045, rows: [[-0.36, 0.2, 0.62, 0], [-0.12, 0.2, 0.55, 0.5], [0.12, 0.2, 0.55, 0], [0.36, 0.2, 0.62, 0.5]] },
        knobbly: { depth: 0.016, pitch: 0.075, rows: [[-0.42, 0.18, 0.5, 0], [-0.15, 0.26, 0.45, 0.5], [0.15, 0.26, 0.45, 0], [0.42, 0.18, 0.5, 0.5]] }
    };
    function treadBlocks(kind, R, W) {
        var depth = kind.depth, n = Math.max(12, Math.round(2 * Math.PI * R / kind.pitch)), step = 2 * Math.PI / n, list = [];
        kind.rows.forEach(function (row) {
            var len = 2 * Math.PI * R / n * row[2];
            for(var i = 0; i < n; i++) {
                // (one more mm into the carcass: no gap where the box meets the round of the lathe)
                var box = new THREE.BoxGeometry(row[1] * W, depth + 0.001, len);
                box.translate(row[0] * W, R - (depth + 0.001) / 2, 0);
                box.rotateX((i + row[3]) * step);
                list.push(box);
            }
        });
        return list;
    }
    var customCache = {};
    function customMesh(spec) {
        var pattern = patternOf(spec), blocks = TREAD_BLOCKS[pattern];
        var key = [spec.width, spec.diameter, spec.inner_ratio, pattern].join("|");
        if(customCache[key]) return customCache[key].clone(true);
        // (an off-road tread: the carcass ends under the blocks, which stand on it up to the outer shell)
        var R0 = spec.diameter / 2, R = blocks ? R0 - blocks.depth : R0, Ri = R0 * spec.inner_ratio, W = spec.width, H = R - Ri, pts = [];
        function p(r, a) { pts.push(new THREE.Vector2(r, a)); }
        // (the profile as radius and position along the axle, from the bead on one side over the tread to the bead on the other)
        p(Ri, -0.43 * W); p(Ri + 0.14 * H, -0.5 * W); p(Ri + 0.5 * H, -0.505 * W); p(Ri + 0.82 * H, -0.47 * W); p(R - 0.025 * H, -0.4 * W); p(R, -0.31 * W);
        if(pattern === "road") {
            // the grooves of a tyre for the road: three, 4 mm deep
            [-0.16, 0, 0.16].forEach(function(at) { p(R, (at - 0.03) * W); p(R - 0.004, (at - 0.022) * W); p(R - 0.004, (at + 0.022) * W); p(R, (at + 0.03) * W); });
        }
        p(R, 0.31 * W); p(R - 0.025 * H, 0.4 * W); p(Ri + 0.82 * H, 0.47 * W); p(Ri + 0.5 * H, 0.505 * W); p(Ri + 0.14 * H, 0.5 * W); p(Ri, 0.43 * W);
        var geometry = new THREE.LatheGeometry(pts, 72);
        geometry.rotateZ(-Math.PI / 2);                               // (the lathe turns about Y: the wheel turns about X)
        geometry.computeVertexNormals();
        if(blocks) geometry = merge([geometry].concat(treadBlocks(blocks, R0, W)));
        var mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x151516, roughness: pattern === "slick" ? 0.62 : 0.88, metalness: 0, side: THREE.DoubleSide }));
        mesh.name = "tyre_custom";
        customCache[key] = mesh;
        return mesh.clone(true);
    }
    // a rim of a plain look for a custom tyre without a rim of the library: a disc with a lip, in the size of the inner shell
    function plainRim(spec) {
        var Ri = spec.diameter / 2 * spec.inner_ratio, W = spec.width * 0.8, group = new THREE.Group();
        var barrel = new THREE.Mesh(new THREE.CylinderGeometry(Ri * 0.98, Ri * 0.98, W, 40, 1, true), new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.9, roughness: 0.35, side: THREE.DoubleSide }));
        barrel.rotation.z = Math.PI / 2;
        var face = new THREE.Mesh(new THREE.CylinderGeometry(Ri * 0.94, Ri * 0.94, 0.02, 40), new THREE.MeshStandardMaterial({ color: 0x777d86, metalness: 0.9, roughness: 0.4 }));
        face.rotation.z = Math.PI / 2; face.position.x = W / 2 - 0.02;
        group.add(barrel); group.add(face);
        group.name = "rim_custom";
        return group;
    }
    function uses(config) { return ["front", "rear"].some(function (axle) { var c = choiceOf(config, axle); return !!(c.rim || c.tyre); }); }
    function usesAxle(config, axle) { var c = choiceOf(config, axle); return !!(c.rim || c.tyre); }

    // ---- the files
    function filesFor(config) {
        var list = [];
        ["front", "rear"].forEach(function (axle) {
            var c = choiceOf(config, axle), r = rim(c.rim), t = c.tyre === CUSTOM_ID ? null : tyre(c.tyre);
            if(c.rim && !r) console.warn("WheelLibrary: no rim '" + c.rim + "' in wheels.json");
            if(c.tyre && c.tyre !== CUSTOM_ID && !t) console.warn("WheelLibrary: no tyre '" + c.tyre + "' in wheels.json");
            // (a custom tyre: the model of its pattern of tread, when the catalogue has one)
            var tr = c.tyre === CUSTOM_ID && !c.model ? treadOf(patternOf(customSpec(c.custom))) : null;
            [r, t, tr].forEach(function (e) { if(e && list.indexOf(e.file) < 0) list.push(e.file); });
        });
        return list;
    }
    // the size of a loaded scene: the diameter across the Y-Z plane and the width along X (the axle)
    function measure(scene) {
        var box = new THREE.Box3().setFromObject(scene), size = box.getSize(new THREE.Vector3());
        // (the smallest radius about the axle: the bead of a tyre, the hub of a rim)
        var inner = Infinity, v = new THREE.Vector3();
        scene.traverse(function (m) { if(!m.isMesh || !m.geometry || !m.geometry.attributes.position) return; var p = m.geometry.attributes.position; for(var i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld); var r = Math.sqrt(v.y * v.y + v.z * v.z); if(r < inner) inner = r; } });
        return { diameter: Math.max(size.y, size.z), width: size.x, inner: inner, centre: box.getCenter(new THREE.Vector3()) };
    }
    // (the catalogue is loaded for every car, also one without a wheel of the library: the tuning menu lists it)
    function preload(config, manager, done) {
        load().then(function () {
            if(!uses(config)) { done(); return; }
            // every file once: a file that is loading already (another car, the preview of the car editor) is waited for, not asked for again and not taken as there
            var waits = filesFor(config).map(function (f) {
                var u = url(f);
                if(cache[u] && cache[u].promise) return cache[u].promise;
                var entry = { loading: true };
                entry.promise = new Promise(function (resolve) {
                    var loader = new THREE.GLTFLoader(manager);
                    loader.load(u, function (gltf) { gltf.scene.updateMatrixWorld(true); entry.scene = gltf.scene; entry.size = measure(gltf.scene); entry.loading = false; resolve(); },
                        undefined, function (error) { entry.error = error || true; entry.loading = false; console.warn("WheelLibrary: no " + u); resolve(); });
                });
                cache[u] = entry;
                return entry.promise;
            });
            Promise.all(waits).then(function () { done(); });
        });
    }
    function entryFile(entry) { var e = entry && cache[url(entry.file)]; return e && e.scene ? e : null; }
    // what is wrong with the choice of a car, for a message: ids that are not in the catalogue, files that did not load
    function problems(config) {
        var out = [];
        ["front", "rear"].forEach(function (axle) {
            var c = choiceOf(config, axle);
            [["rim", rim(c.rim), c.rim], ["tyre", tyre(c.tyre), c.tyre === CUSTOM_ID ? "" : c.tyre]].forEach(function (k) {
                if(!k[2]) return;
                if(!k[1]) { out.push("no " + k[0] + " '" + k[2] + "' in wheels.json"); return; }
                var e = cache[url(k[1].file)];
                if(e && e.error) out.push(k[0] + " '" + k[2] + "': the file wheels/" + k[1].file + " did not load");
            });
        });
        return out;
    }

    // the shell of the tyre of an axle: what the catalogue says, the width and the inner shell from the files when they are loaded
    function shellOf(config, axle) {
        var c = choiceOf(config, axle), t = tyre(c.tyre);
        if(!t) return null;          // (a custom tyre has no shell of the library: its numbers are the shell sliders of the menu)
        var s = t.shell || {}, tf = entryFile(t), rf = entryFile(rim(c.rim));
        var diameter = t.diameter > 0 ? t.diameter : (tf ? tf.size.diameter : 0);
        var width = t.width > 0 ? t.width : (tf ? tf.size.width : 0);
        var inner = s.inner_ratio > 0 ? s.inner_ratio : (rf && diameter > 0 ? Math.max(0.3, Math.min(0.9, rf.size.diameter / diameter)) : undefined);
        return { width: width, rings: s.rings, segments: s.segments, inner_ratio: inner, carcass: s.carcass, diameter: diameter };
    }

    // the wheel of a slot: the rim and the tyre of its axle, copied from the files, turned for the side; null when the axle has nothing of the library
    function wheelFor(config, slot, root) {
        var axle = AXLE_OF[slot], c = choiceOf(config, axle);
        if(!(c.rim || c.tyre)) return null;
        var r = rim(c.rim), rf = entryFile(r);
        if(c.tyre === CUSTOM_ID) return customWheel(c, slot, r, rf, c.model ? root : null);
        var t = tyre(c.tyre), tf = entryFile(t);
        if(!rf && !tf) return null;
        var object = new THREE.Object3D();
        object.name = "wheel_" + slot + "_library";
        var inner = new THREE.Object3D();
        inner.name = (c.rim || "") + (c.rim && c.tyre ? " + " : "") + (c.tyre || "");
        if(!LEFT[slot]) inner.rotation.y = Math.PI;          // (modelled for the left side: +X outwards)
        // ("flip": true in the catalogue: the file was modelled for the right side, it is turned round)
        if(rf) {
            var rc = rf.scene.clone(true); rc.name = "rim_" + slot; if(r.flip) rc.rotation.y = Math.PI;
            // (a rim and a tyre of a motorcycle: the rim is fitted to the tyre, its diameter to the bead of the tyre as the file measures it and its width to the tread, whatever size the file of the rim is)
            if(tf && t && t.for === "motorcycle" && rf.size.diameter > 0 && tf.size.inner > 0 && tf.size.width > 0) {
                var sd = Math.max(0.8, Math.min(1.25, (2 * tf.size.inner + 0.004) / rf.size.diameter)), sw = rf.size.width > 0 ? Math.max(0.5, Math.min(1.3, 0.8 * tf.size.width / rf.size.width)) : 1;
                rc.scale.set(sw, sd, sd);
                var holder = new THREE.Object3D(); holder.add(rc); rc = holder;
            }
            inner.add(rc);
        }
        if(tf) { var tc = tf.scene.clone(true); tc.name = "tyre_" + slot; if(t.flip) tc.rotation.y = Math.PI; inner.add(tc); }
        object.add(inner);
        object.traverse(function (child) { if(child.isMesh) { child.castShadow = true; child.receiveShadow = false; } });
        var shell = shellOf(config, axle);
        var diameter = shell && shell.diameter > 0 ? shell.diameter : (rf ? rf.size.diameter : 0);
        var width = shell && shell.width > 0 ? shell.width : (rf ? rf.size.width : 0);
        return { object: object, diameter: diameter, width: width, shell: shell, offset: r && r.offset > 0 ? r.offset : 0, rim: r, tyre: t };
    }

    // ---- the rim and the tyre of the model itself: objects called "rim" and "tyre" (or "tire"; a number after the name is allowed) in the model. They are the wheel of every corner: baked
    // to the frame of a wheel (the axle along X, the middle at the origin, the outside to +X as on the left of the car), the rim scaled to the inner shell and the tyre fitted between
    // the inner shell and the outer shell, with its section kept (the radius from the bead to the tread is stretched to the height of the sidewall, the width to the width of the tyre)
    var NAMES_RIM = /^rim$/, NAMES_TYRE = /^(tyre|tire)$/;
    var bakeCache = typeof WeakMap !== "undefined" ? new WeakMap() : null;
    function findNamed(root, re) {
        var found = null;
        root.traverse(function (o) { if(!found && re.test((o.name || "").toLowerCase().replace(/[^a-z]/g, ""))) found = o; });
        return found;
    }
    function bake(obj) {
        obj.updateWorldMatrix(true, true);
        var parts = [], box = new THREE.Box3();
        obj.traverse(function (m) {
            if(!m.isMesh || !m.geometry || !m.geometry.attributes.position) return;
            var g = m.geometry.clone();
            g.applyMatrix4(m.matrixWorld);
            g.computeBoundingBox();
            box.union(g.boundingBox);
            parts.push({ geometry: g, material: m.material });
        });
        if(!parts.length) return null;
        var size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
        // the axle is the thinnest side of the box
        var axis = size.x <= size.y && size.x <= size.z ? "x" : (size.y <= size.z ? "y" : "z");
        var flip = axis === "x" ? centre.x < -0.01 : centre.x < -0.01;
        var R = 0, Rin = Infinity, xMin = Infinity, xMax = -Infinity;
        parts.forEach(function (part) {
            var g = part.geometry;
            g.translate(-centre.x, -centre.y, -centre.z);
            if(axis === "z") g.rotateY(Math.PI / 2); else if(axis === "y") g.rotateZ(Math.PI / 2);
            if(flip) g.rotateY(Math.PI);
            var pos = g.attributes.position;
            for(var i = 0; i < pos.count; i++) {
                var rr = Math.sqrt(pos.getY(i) * pos.getY(i) + pos.getZ(i) * pos.getZ(i));
                if(rr > R) R = rr; if(rr < Rin) Rin = rr;
                if(pos.getX(i) < xMin) xMin = pos.getX(i); if(pos.getX(i) > xMax) xMax = pos.getX(i);
            }
        });
        return { parts: parts, R: R, Rin: Rin, width: xMax - xMin, centreX: (xMin + xMax) / 2 };
    }
    // the rim and the tyre of a model: { rim, tyre } baked (kept for the model), or null when it has none of them
    function modelWheelParts(root) {
        if(!root) return null;
        var cached = bakeCache && bakeCache.get(root);
        if(cached) { cached.objects.forEach(function (o) { o.visible = false; }); return cached.rim || cached.tyre ? cached : null; }
        var rimObj = findNamed(root, NAMES_RIM), tyreObj = findNamed(root, NAMES_TYRE);
        if(!rimObj && !tyreObj) return null;
        var out = { rim: rimObj ? bake(rimObj) : null, tyre: tyreObj ? bake(tyreObj) : null, objects: [rimObj, tyreObj].filter(Boolean) };
        if(bakeCache) bakeCache.set(root, out);
        if(!out.rim && !out.tyre) return null;
        out.objects.forEach(function (o) { o.visible = false; o.traverse(function (m) { if(m.isMesh) { m.userData = m.userData || {}; m.userData.noCollision = true; } }); });          // (a drawing to take from: not seen, not a part of the shell)
        return out;
    }
    function modelObjects(root) { var p = modelWheelParts(root); return p ? p.objects : []; }
    function modelRim(baked, spec) {
        var group = new THREE.Group(), s = baked.R > 0 ? spec.diameter / 2 * spec.inner_ratio / baked.R : 1;
        baked.parts.forEach(function (part) { var mesh = new THREE.Mesh(part.geometry.clone(), part.material); mesh.scale.set(s, s, s); group.add(mesh); });
        group.name = "rim_model";
        return group;
    }
    function modelTyre(baked, spec) {
        var group = new THREE.Group(), R = spec.diameter / 2, Ri = R * spec.inner_ratio;
        var span = baked.R - baked.Rin > 1e-4 ? baked.R - baked.Rin : 1, sx = baked.width > 1e-4 ? spec.width / baked.width : 1;
        baked.parts.forEach(function (part) {
            var g = part.geometry.clone(), pos = g.attributes.position;
            for(var i = 0; i < pos.count; i++) {
                var y = pos.getY(i), z = pos.getZ(i), rr = Math.sqrt(y * y + z * z);
                if(rr > 1e-6) { var rn = Ri + (rr - baked.Rin) / span * (R - Ri), f = rn / rr; pos.setY(i, y * f); pos.setZ(i, z * f); }
                pos.setX(i, pos.getX(i) * sx);
            }
            pos.needsUpdate = true; g.computeBoundingSphere(); g.computeBoundingBox();
            group.add(new THREE.Mesh(g, part.material));
        });
        group.name = "tyre_model";
        return group;
    }

    // the model of the pattern of tread of a custom tyre (the "treads" of the catalogue), fitted between the shells; null when there is none or it did not load
    function treadModel(spec) {
        var tr = treadOf(patternOf(spec)), tf = entryFile(tr);
        if(!tf) return null;
        if(!tf.baked) tf.baked = bake(tf.scene);
        if(!tf.baked) return null;
        var group = modelTyre(tf.baked, spec);
        group.name = "tyre_tread_" + tr.id;
        return group;
    }
    // the wheel of a slot with a custom tyre: the tyre between the shells, and the rim (of the library or a plain one) scaled to the inner shell
    function customWheel(c, slot, r, rf, root) {
        var spec = customSpec(c.custom);
        var modelParts = root ? modelWheelParts(root) : null;
        var object = new THREE.Object3D();
        object.name = "wheel_" + slot + "_library";
        var inner = new THREE.Object3D();
        inner.name = (modelParts && modelParts.rim ? "rim of the model" : (c.rim || "plain rim")) + " + " + (modelParts && modelParts.tyre ? "tyre of the model" : "custom tyre");
        if(!LEFT[slot]) inner.rotation.y = Math.PI;
        var rimObject;
        if(modelParts && modelParts.rim) {
            // the rim of the model, scaled to the inner shell (the same on every side of the car)
            rimObject = modelRim(modelParts.rim, spec);
        } else if(rf) {
            rimObject = rf.scene.clone(true); rimObject.name = "rim_" + slot; if(r.flip) rimObject.rotation.y = Math.PI;
            // the rim takes the size of the inner shell: its diameter, and a width in step with the tyre (a rim of the library keeps its look, only scaled)
            var wanted = spec.diameter * spec.inner_ratio, widthWanted = spec.width * 0.8;
            var sd = rf.size.diameter > 0 ? wanted / rf.size.diameter : 1, sw = rf.size.width > 0 ? Math.max(0.55, Math.min(1.6, widthWanted / rf.size.width)) : 1;
            rimObject.scale.set(sw, sd, sd);
            var holder = new THREE.Object3D(); holder.add(rimObject); rimObject = holder;
        } else rimObject = plainRim(spec);
        inner.add(rimObject);
        inner.add(modelParts && modelParts.tyre ? modelTyre(modelParts.tyre, spec) : (treadModel(spec) || customMesh(spec)));
        object.add(inner);
        object.traverse(function (child) { if(child.isMesh) { child.castShadow = true; child.receiveShadow = false; } });
        var shell = { width: spec.width, rings: spec.rings, segments: spec.segments, inner_ratio: spec.inner_ratio, carcass: spec.carcass, diameter: spec.diameter };
        return { object: object, diameter: spec.diameter, width: spec.width, shell: shell, offset: r && r.offset > 0 ? r.offset : 0, rim: r, tyre: { id: CUSTOM_ID, custom: spec }, rubber: spec.rubber };
    }

    lib.load = load; lib.rims = rims; lib.tyres = tyres; lib.tyresFor = tyresFor; lib.bikeTyre = function (axle) { return BIKE_TYRE[axle] || ""; }; lib.treads = function () { return catalog.treads; }; lib.rim = rim; lib.tyre = tyre; lib.choiceOf = choiceOf; lib.uses = uses; lib.usesAxle = usesAxle;
    lib.preload = preload; lib.wheelFor = wheelFor; lib.modelParts = modelWheelParts; lib.modelObjects = modelObjects; lib.shellOf = shellOf; lib.filesFor = filesFor;
    lib.ready = function () { return loaded; }; lib.problems = problems;
    return lib;
})();
