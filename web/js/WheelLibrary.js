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
    var catalog = { rims: [], tyres: [] }, loading = null, loaded = false;
    var cache = {};                      // url -> { scene, size: { diameter, width } } or { error }
    var AXLE_OF = { FR: "front", FL: "front", RL: "rear", RR: "rear" }, LEFT = { FL: true, RL: true };

    function baseOf() { return lib.base !== null ? lib.base : (OpenRacer.PartsLibrary ? OpenRacer.PartsLibrary.base : ""); }
    function url(file) { return baseOf() + "wheels/" + file; }

    function load(base) {
        if(base !== undefined && base !== null) lib.base = base;
        if(loading) return loading;
        loading = fetch(url("wheels.json"), { cache: "no-store" }).then(function (r) { if(!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then(function (json) {
            catalog = { rims: Array.isArray(json.rims) ? json.rims.filter(function (e) { return e && e.id && e.file; }) : [], tyres: Array.isArray(json.tyres) ? json.tyres.filter(function (e) { return e && e.id && e.file; }) : [] };
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

    // what car.json chose for an axle ("library": { "front": { "rim", "tyre" }, "rear": { ... } }; or { "rim", "tyre" } for both axles)
    function choiceOf(config, axle) {
        var L = config && config.wheels && config.wheels.library;
        if(!L) return { rim: "", tyre: "" };
        var a = L[axle] || (L.rim !== undefined || L.tyre !== undefined ? L : null) || {};
        return { rim: a.rim || "", tyre: a.tyre || "" };
    }
    function uses(config) { return ["front", "rear"].some(function (axle) { var c = choiceOf(config, axle); return !!(c.rim || c.tyre); }); }
    function usesAxle(config, axle) { var c = choiceOf(config, axle); return !!(c.rim || c.tyre); }

    // ---- the files
    function filesFor(config) {
        var list = [];
        ["front", "rear"].forEach(function (axle) {
            var c = choiceOf(config, axle), r = rim(c.rim), t = tyre(c.tyre);
            if(c.rim && !r) console.warn("WheelLibrary: no rim '" + c.rim + "' in wheels.json");
            if(c.tyre && !t) console.warn("WheelLibrary: no tyre '" + c.tyre + "' in wheels.json");
            [r, t].forEach(function (e) { if(e && list.indexOf(e.file) < 0) list.push(e.file); });
        });
        return list;
    }
    // the size of a loaded scene: the diameter across the Y-Z plane and the width along X (the axle)
    function measure(scene) {
        var box = new THREE.Box3().setFromObject(scene), size = box.getSize(new THREE.Vector3());
        return { diameter: Math.max(size.y, size.z), width: size.x, centre: box.getCenter(new THREE.Vector3()) };
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
            [["rim", rim(c.rim), c.rim], ["tyre", tyre(c.tyre), c.tyre]].forEach(function (k) {
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
        if(!t) return null;
        var s = t.shell || {}, tf = entryFile(t), rf = entryFile(rim(c.rim));
        var diameter = t.diameter > 0 ? t.diameter : (tf ? tf.size.diameter : 0);
        var width = t.width > 0 ? t.width : (tf ? tf.size.width : 0);
        var inner = s.inner_ratio > 0 ? s.inner_ratio : (rf && diameter > 0 ? Math.max(0.3, Math.min(0.9, rf.size.diameter / diameter)) : undefined);
        return { width: width, rings: s.rings, segments: s.segments, inner_ratio: inner, carcass: s.carcass, diameter: diameter };
    }

    // the wheel of a slot: the rim and the tyre of its axle, copied from the files, turned for the side; null when the axle has nothing of the library
    function wheelFor(config, slot) {
        var axle = AXLE_OF[slot], c = choiceOf(config, axle);
        if(!(c.rim || c.tyre)) return null;
        var r = rim(c.rim), t = tyre(c.tyre), rf = entryFile(r), tf = entryFile(t);
        if(!rf && !tf) return null;
        var object = new THREE.Object3D();
        object.name = "wheel_" + slot + "_library";
        var inner = new THREE.Object3D();
        inner.name = (c.rim || "") + (c.rim && c.tyre ? " + " : "") + (c.tyre || "");
        if(!LEFT[slot]) inner.rotation.y = Math.PI;          // (modelled for the left side: +X outwards)
        // ("flip": true in the catalogue: the file was modelled for the right side, it is turned round)
        if(rf) { var rc = rf.scene.clone(true); rc.name = "rim_" + slot; if(r.flip) rc.rotation.y = Math.PI; inner.add(rc); }
        if(tf) { var tc = tf.scene.clone(true); tc.name = "tyre_" + slot; if(t.flip) tc.rotation.y = Math.PI; inner.add(tc); }
        object.add(inner);
        object.traverse(function (child) { if(child.isMesh) { child.castShadow = true; child.receiveShadow = false; } });
        var shell = shellOf(config, axle);
        var diameter = shell && shell.diameter > 0 ? shell.diameter : (rf ? rf.size.diameter : 0);
        var width = shell && shell.width > 0 ? shell.width : (rf ? rf.size.width : 0);
        return { object: object, diameter: diameter, width: width, shell: shell, offset: r && r.offset > 0 ? r.offset : 0, rim: r, tyre: t };
    }

    lib.load = load; lib.rims = rims; lib.tyres = tyres; lib.rim = rim; lib.tyre = tyre; lib.choiceOf = choiceOf; lib.uses = uses; lib.usesAxle = usesAxle;
    lib.preload = preload; lib.wheelFor = wheelFor; lib.shellOf = shellOf; lib.filesFor = filesFor;
    lib.ready = function () { return loaded; }; lib.problems = problems;
    return lib;
})();
