/*
 * VehicleState.js
 *
 * Description: The state of a vehicle (Vehicle.js) as numbers in a typed array, and back: what a physics worker sends to the main thread
 *              every frame, so that the main thread can draw the car, play its sound and fill the HUD from a view of it (PHYSICS-WORKER.md).
 *              No 3D library and no page: it loads in a Web Worker as well.
 *
 *              snapshot(vehicle, cache) gives { schema, num, str, soft, softVersion, tyres, events }:
 *                num     a Float64Array with every number and flag of the vehicle, its engine, its controller (a motorcycle) and its wheels,
 *                        and of the small records in them (a wheel's centre, contact and normal, the posture of a rider);
 *                str     the strings among them (the surface under a wheel, the gearbox), in the same order as the schema says;
 *                schema  the names and kinds of those values, only when they changed since the last snapshot with this cache (null otherwise);
 *                soft    a copy of the displacement of the soft body (SoftBody.js) when it moved, softVersion its version;
 *                tyres   per wheel the deformation of a shell tyre (TyreShell.deformation: rings of 72 depths) and its rings;
 *                events  the bangs of the exhaust of this frame (Engine.events);
 *                input   what the physics wrote into its input (INPUT_WRITTEN: the gear of an automatic).
 *              apply(view, snap, cache, keep) writes them into a view: an object (or a vehicle) with the same names; the records and the wheels are
 *              made when the view does not have them yet. changes(view, cache) gives what was written into the view since (by the main thread);
 *              set(root, name, value) and get(root, name) reach a value by its name in the schema.
 *              INPUT lists what the physics reads of its input (the Car, or a plain object), and INPUT_WRITTEN what it writes back into it.
 */

OpenRacer.VehicleState = (function () {
    // what a snapshot leaves out: links to other objects, and what the main thread owns (the input, the ground, the model)
    var SKIP = { input: 1, ground: 1, collision: 1, softBody: 1, parts: 1, engine: 1, controller: 1, wheels: 1, rig: 1, collisionSpheres: 1, otherCars: 1,
        pushes: 1, proxy3: 1, liveAxle: 1, object: 1, comp: 1, tyreBody: 1, events: 1, torque_curve: 1, extras: 1, onWheelLost: 1, parameters: 1 };
    var TABLE = 5 * 72;         // the deformation of a shell tyre: at most 5 rings of 72 bins (TyreShell.js)

    var INPUT = ["throttle", "brakePedal", "clutch", "clutchPedalPresent", "clutchAvailable", "handbrake", "turnAngle", "maxTurn", "turnLimit", "neutral", "reverse",
        "manualGearbox", "current_gear", "parkingLock", "twoStep", "transbrake"];
    var INPUT_WRITTEN = ["current_gear"];          // the automatic gearbox shifts (Vehicle.updateControls)

    function primitive(x) { var t = typeof x; return t === "number" || t === "boolean" || t === "string" || x === null || x === undefined; }
    // a small record: a plain object of numbers, flags and strings only (a centre, a contact, a normal, a posture)
    function record(x) {
        if(!x || typeof x !== "object" || Array.isArray(x) || ArrayBuffer.isView(x)) return false;
        for(var k in x) if(Object.prototype.hasOwnProperty.call(x, k) && (!primitive(x[k]) || typeof x[k] === "function")) return false;
        return true;
    }
    function kind(x) { return typeof x === "number" ? "n" : typeof x === "boolean" ? "b" : typeof x === "string" ? "s" : x === null ? "z" : "u"; }

    // the values of one object (the vehicle, its engine, a wheel) under a prefix: [path, value] pairs
    function collect(prefix, o, out) {
        if(!o) return;
        var keys = Object.keys(o);
        for(var i = 0; i < keys.length; i++) {
            var k = keys[i], x = o[k];
            if(SKIP[k] || typeof x === "function") continue;
            if(primitive(x)) out.push(prefix + k, x);
            else if(Array.isArray(x)) { if(x.length <= 16 && x.every(primitive)) for(var j = 0; j < x.length; j++) out.push(prefix + k + "#" + j, x[j]); }
            else if(record(x)) { var rk = Object.keys(x); for(var r = 0; r < rk.length; r++) out.push(prefix + k + "." + rk[r], x[rk[r]]); }
        }
    }
    function pairsOf(v) {
        var out = [];
        collect("", v, out);
        collect("engine.", v.engine, out);
        collect("controller.", v.controller, out);
        for(var w = 0; w < v.wheels.length; w++) collect("wheels#" + w + ".", v.wheels[w], out);
        return out;
    }

    function snapshot(v, cache) {
        cache = cache || {};
        var pairs = pairsOf(v), n = pairs.length / 2;
        var names = new Array(n), kinds = "", num = new Float64Array(n), str = [];
        for(var i = 0; i < n; i++) {
            var x = pairs[2 * i + 1], k = kind(x);
            names[i] = pairs[2 * i]; kinds += k;
            num[i] = k === "n" ? x : k === "b" ? (x ? 1 : 0) : NaN;
            if(k === "s") str.push(x);
        }
        var schema = names.join("|") + "/" + kinds, changed = schema !== cache.schema;
        cache.schema = schema;
        var snap = { schema: changed ? schema : null, num: num, str: str, soft: null, softVersion: 0, tyres: null, events: v.engine && v.engine.events.length ? v.engine.events.slice() : null,
            input: v.input ? readInput(v.input, {}, INPUT_WRITTEN) : null };
        var sb = v.softBody;
        if(sb && sb.displacement) {
            snap.softVersion = sb.version;
            if(sb.version !== cache.softVersion) snap.soft = sb.displacement.slice();
            cache.softVersion = sb.version;
        }
        for(var w = 0; w < v.wheels.length; w++) {
            var body = v.wheels[w].tyreBody;
            if(!body || !body.deformation) continue;
            if(!snap.tyres) snap.tyres = [];
            var table = new Float32Array(TABLE);
            snap.tyres[w] = { rings: body.deformation(table), table: table, isShell: !!body.isShell, innerRatio: body.innerRatio, width: body.width };
        }
        return snap;
    }

    // a name of the schema ("wheels#2.center.x", "wheelLost#1") as the way to its value: the keys of the objects on the way, the last key, and whether it is an
    // element of an array
    function stepOf(name) {
        var path = name.split("."), key = path.pop(), at = [];
        for(var p = 0; p < path.length; p++) { var hp = path[p].split("#"); at.push(hp[0]); if(hp.length > 1) at.push(+hp[1]); }
        var hk = key.split("#"), list = hk.length > 1;
        if(list) { at.push(hk[0]); key = +hk[1]; }
        return { at: at, key: key, list: list };
    }
    function compile(schema) {
        var parts = schema.split("/"), names = parts[0] ? parts[0].split("|") : [], kinds = parts[1], steps = [];
        for(var i = 0; i < names.length; i++) { var st = stepOf(names[i]); st.kind = kinds[i]; st.name = names[i]; steps.push(st); }
        return steps;
    }
    // the object that a value goes into (made when missing; list: the value is an element of an array)
    function target(view, at, list) {
        var o = view;
        for(var i = 0; i < at.length; i++) {
            var k = at[i];
            if(o[k] === undefined || o[k] === null) o[k] = typeof at[i + 1] === "number" || (list && i === at.length - 1) ? [] : {};
            o = o[k];
        }
        return o;
    }
    function valueAt(view, st) {
        var o = view;
        for(var i = 0; i < st.at.length; i++) { o = o[st.at[i]]; if(o === undefined || o === null) return undefined; }
        return o[st.key];
    }
    function same(a, b) { return a === b || (a !== a && b !== b); }

    // keep(i): the value i of the view is kept as it is (the main thread wrote it after this snapshot was made, PhysicsLink.js). What the view holds afterwards
    // is remembered (cache.base), so that changes() can tell what was written into it since.
    function apply(view, snap, cache, keep) {
        if(snap.schema) cache.steps = compile(snap.schema);
        var steps = cache.steps, s = 0;
        if(!steps) throw new Error("VehicleState.apply: a snapshot without a schema before it");
        var base = cache.base = new Array(steps.length);
        for(var i = 0; i < steps.length; i++) {
            var st = steps[i], o = target(view, st.at, st.list), x = snap.num[i];
            var value = st.kind === "n" ? x : st.kind === "b" ? x === 1 : st.kind === "s" ? snap.str[s++] : st.kind === "z" ? null : undefined;
            if(!keep || !keep(i)) o[st.key] = value;
            base[i] = o[st.key];
        }
        return view;
    }
    // what was written into the view since the last apply: [{ i, name, value }]
    function changes(view, cache) {
        var out = [], steps = cache.steps, base = cache.base;
        if(!steps || !base) return out;
        for(var i = 0; i < steps.length; i++) { var x = valueAt(view, steps[i]); if(!same(x, base[i])) out.push({ i: i, name: steps[i].name, value: x }); }
        return out;
    }
    // after the main thread did something to the view that is also done in the worker (a call): what it holds now is the base
    function rebase(view, cache) {
        if(!cache.steps) return;
        for(var i = 0; i < cache.steps.length; i++) cache.base[i] = valueAt(view, cache.steps[i]);
    }
    // a value by its name (a name of the schema), in an object; made on the way when missing
    function set(root, name, value) { var st = stepOf(name); target(root, st.at, st.list)[st.key] = value; }
    function get(root, name) { return valueAt(root, stepOf(name)); }

    // the input of a vehicle as a plain object (from the Car, which is the input in the game); keys: which (INPUT when left out)
    function readInput(from, out, keys) {
        out = out || {}; keys = keys || INPUT;
        for(var i = 0; i < keys.length; i++) out[keys[i]] = from[keys[i]];
        return out;
    }

    return { snapshot: snapshot, apply: apply, changes: changes, rebase: rebase, set: set, get: get, readInput: readInput, INPUT: INPUT, INPUT_WRITTEN: INPUT_WRITTEN, pairsOf: pairsOf };
})();
