/*
 * PhysicsLink.js
 *
 * Description: The physics of the cars in a Web Worker (PhysicsWorker.js; the plan and the measurements: PHYSICS-WORKER.md, MACOS-METAL.md). One worker
 *              (the hub, below) steps the player's car and every AI car together, so that the cars meet each other as they do in the page (their shells,
 *              collideCars), with the WebAssembly of PhysicsWasm.js, while the page draws. A vehicle in the page (car.vehicle, opponent.vehicle) stays,
 *              with all its fields and methods, but it is not stepped here: it is a view, filled every frame from the snapshot that the worker sends
 *              (VehicleState.js). So everything that reads a car (the model, the cameras, the sound, the HUD, the replay, the parts, the AI drivers)
 *              reads it as before. The AI drivers stay in the page: what they press goes to the worker with the next step.
 *
 *              What the page does to a car goes to the worker:
 *                - a value it writes into the vehicle (the jacks of the pit stop, a hit of a prop, the fuel, the options, the rain on a wheel): it is found
 *                  by comparing the view with what the last snapshot put there (VehicleState.changes) and sent with the next step; until a snapshot comes
 *                  back that knows it, the page keeps its own value;
 *                - a method it calls (reset, retune, repair, a puncture, an impulse, the shell's repair and its node grabber): the call is done here too,
 *                  and sent; the snapshots of the steps before it are not used.
 *              Every frame each car queues its input and what was done to it (Link.update, from Car.update and Opponent.update), and at the end of the
 *              frame the hub sends one step for all of them (PhysicsLink.endFrame, main.js), when the last one came back: the page shows a frame later
 *              what was pressed, with the time of the frames the worker was busy added to the next step.
 *
 *              Until a car has its model (and its shell) the page steps it itself; then the worker takes over its whole state (setup). When the shell
 *              changes (the tuning menu builds the car again) the worker takes it over again. When the worker fails, or cannot keep up with the time
 *              of the game (more than 0.9 s of work for a second of driving, over two seconds), the page steps every car again. ?worker=1 in the
 *              address turns it on, ?worker=0 off (PhysicsLink.wanted).
 */

// ---- the hub: the one worker, and the step of all the cars
OpenRacer.PhysicsHub = (function () {
    var worker = null, ready = false, failed = false, busy = false, gaveBack = null;
    var frame = 0, pendingTime = 0, sentAt = 0, sentTime = 0, liveFor = 0, slowFor = 0;
    // the game time the page has given the worker (pageClock: what it has to step, up to the end of the last frame) and that the step of a frame brings the cars
    // to (clockOf): a car is shown at pageClock, its snapshot carried forward by what is missing (Link.update)
    var pageClock = 0, sentClock = 0, clockOf = {};
    var links = {};                     // id: Link
    var groundSent = null, wetSent = null, snowSent = null;
    var stats = { steps: 0, answers: 0, lastMs: 0, skipped: 0, cost: 0, gaveBack: null, roundTrip: 0, cars: 0 };

    function start() {
        if (worker || failed) return;
        try { worker = new Worker("js/PhysicsWorker.js"); } catch (e) { fail(e); return; }
        worker.onmessage = function (e) {
            var m = e.data;
            if (m.type === "ready") { ready = true; stats.wasm = m.wasm; stats.wasmFailed = m.wasmFailed || null; }
            else if (m.type === "state") {
                busy = false; stats.answers++; stats.lastMs = m.ms; stats.roundTrip = performance.now() - sentAt;
                if (sentTime > 0) stats.cost += 0.2 * (m.ms / sentTime - stats.cost);        // the work for a second of driving (ms), smoothed
                var at = clockOf[m.frame]; delete clockOf[m.frame];
                for (var id in m.cars) if (links[id]) { m.cars[id].frame = m.frame; m.cars[id].clock = at; links[id].latest = m.cars[id]; }
            }
            else if (m.type === "error") fail(new Error(m.message));
        };
        worker.onerror = function (e) { fail(new Error(e.message || "the physics worker failed")); };
    }
    function fail(error) {
        if (failed) return;
        failed = true;
        gaveBack = stats.gaveBack = error && error.message ? error.message : String(error);
        console.warn("PhysicsLink: the physics of the cars goes back to the page: " + gaveBack);
        if (worker) worker.terminate();
        worker = null;
        for (var id in links) links[id].gaveBack();
    }
    function post(message, transfer) { if (worker) worker.postMessage(message, transfer || []); }
    function sendGround() {
        if (typeof groundWorld === "undefined" || !groundWorld || !groundWorld.exportData) return false;
        if (groundSent !== groundWorld) { post({ type: "ground", data: groundWorld.exportData() }); groundSent = groundWorld; }
        return true;
    }
    function sendCondition() {
        if (typeof groundWet === "undefined") return;
        if (groundWet === wetSent && groundSnow === snowSent) return;
        wetSent = groundWet; snowSent = groundSnow;
        post({ type: "condition", wet: groundWet, snow: groundSnow });
    }

    return {
        start: start,
        // the page takes the cars back (a test, or a setting that turns the worker off)
        stop: function (why) { fail(new Error(why || "stopped")); },
        ready: function () { return ready && !failed; },
        failed: function () { return failed; },
        gaveBack: function () { return gaveBack; },
        frame: function () { return frame; },
        pageClock: function () { return pageClock; },
        post: post,
        sendGround: sendGround,
        register: function (id, link) { links[id] = link; },
        unregister: function (id) { if (links[id]) { if (links[id].live()) post({ type: "remove", id: id }); delete links[id]; } },
        // some car is stepped by the worker (the page leaves collideCars to it)
        anyLive: function () { for (var id in links) if (links[id].live()) return true; return false; },
        // every car is stepped by the worker
        allLive: function (vehicles) { for (var i = 0; i < vehicles.length; i++) if (!vehicles[i].physicsLinked || !vehicles[i].physicsLinked.live()) return false; return true; },
        // the end of a frame (main.js): one step for every car that is in the worker, when the last one came back
        endFrame: function (delta) {
            if (failed || !worker) return;
            var live = [];
            for (var id in links) if (links[id].live()) live.push(id);
            stats.cars = live.length;
            if (!live.length) return;
            sendCondition();
            var before = pendingTime;
            pendingTime = Math.min(0.1, pendingTime + delta);
            pageClock += pendingTime - before;            // (time beyond the cap of a step is not stepped: it is not shown either)
            liveFor += delta;
            slowFor = liveFor > 1 && stats.cost > 900 ? slowFor + delta : 0;
            if (slowFor > 2) { fail(new Error("the worker needs " + Math.round(stats.cost) + " ms for a second of driving")); return; }
            if (busy) return;
            frame++;
            var inputs = {}, ops = {}, controllers = {};
            live.forEach(function (id) { var q = links[id].take(frame); inputs[id] = q.input; ops[id] = q.ops; });
            sentClock += pendingTime; clockOf[frame] = sentClock;
            post({ type: "step", frame: frame, d: pendingTime, inputs: inputs, ops: ops, controllers: controllers });
            sentTime = pendingTime; pendingTime = 0; busy = true; stats.steps++; sentAt = performance.now();
        },
        stats: stats
    };
})();

// ---- a link: one car (the player's or an AI car) whose vehicle is a view of the one in the worker. owner: the Car or the Opponent (its vehicle, its
// input, isReady); options.preControls: the page called vehicle.updateControls before vehicle.update (an AI car), the worker does the same
OpenRacer.PhysicsLink = function (owner, id, options) {
    options = options || {};
    var self = this;
    var VS = OpenRacer.VehicleState, hub = OpenRacer.PhysicsHub;
    var v = owner.vehicle;
    v.physicsLinked = this;

    // the methods whose calls go to the worker, per object; CONFIG: the ones that set the vehicle up, done again in the worker when it takes over
    var CALLS = {
        vehicle: ["reset", "relocate", "retune", "repair", "repairUpright", "repairWheels", "repairWheel", "repairTyres", "freshTyres", "freshTyre", "fuelAndTyres",
            "puncture", "applyImpulse", "hitWheel", "setRubber", "setCompound", "setAnti", "applyPressure", "standOnWheels", "startEngine", "pushDown"],
        engine: ["start"],
        softBody: ["detachGroup", "repairStart", "repairTo", "repair", "settle", "syncDisplacement", "pushPlate", "grab", "moveGrab", "release", "releasePlate",
            "addBeam", "setNode", "setPinned"],
        controller: ["recover"]
    };
    var CONFIG = { retune: 1, setRubber: 1, setCompound: 1, setAnti: 1, applyPressure: 1 };
    // the calls that nudge the car (an impulse, the node grabber that moves every frame, the cube of the hit tool, the repair of the pit stop share by share): the
    // snapshots of the steps before them are still used. After the other calls (a reset, a repair) they are not: they would put the car back for a frame.
    var NUDGE = { applyImpulse: 1, hitWheel: 1, pushDown: 1, puncture: 1, startEngine: 1, start: 1, grab: 1, moveGrab: 1, release: 1, pushPlate: 1, releasePlate: 1, repairTo: 1, repairStart: 1, setPinned: 1 };
    // objects and values outside the snapshot that the page sets: sent when they change (partForces: every frame that has some, as the parts fill the same array
    // again, Parts.js; the steps of the shell of an AI car, Settings > Simulation)
    var WATCH = ["engine.torque_curve", "engine.extras", "softBody.minSteps"];
    var partForcesSent = 0;

    var live = false, failed = false;
    this.latest = null;
    this.freshFrames = 0; this.staleFrames = 0;           // frames with a new snapshot, and frames without one (the car stood still on the screen for a frame)
    var ops = [];
    var cache = {};                  // the schema of the snapshots and what the last one left in the view (VehicleState)
    var keepFrom = {};               // name: the first step whose snapshot knows the value the page wrote
    var callFrame = 0;               // the snapshots of steps before this one are not used (a call changed the car)
    var configCalls = [];            // [target, method, args] (CONFIG), for the setup
    var depth = 0;                   // (a call inside a call is not sent: the worker does it in the outer one)
    var watched = {};
    var sentShell = null, sentSpheres = null, gearSent = null;
    var tyreStubs = [];
    this.stats = hub.stats;

    // a copy of a value with only the data in it (what postMessage can take): plain objects, arrays, numbers, strings, typed arrays. An object of a class (a part of
    // the 3D scene: its children point back at their parent, and the copy went round for ever) and an object that is already on the way are left out; the first one
    // that is left out is said once in the console
    var leftOut = false;
    function plain(x, path, way) {
        if (typeof x === "function") return undefined;
        if (!x || typeof x !== "object" || ArrayBuffer.isView(x)) return x;
        way = way || [];
        var proto = Object.getPrototypeOf(x);
        if ((proto !== Object.prototype && proto !== Array.prototype && proto !== null) || way.indexOf(x) >= 0) {
            if (!leftOut) { leftOut = true; console.warn("PhysicsLink: left out of what goes to the worker: " + (path || "a value") + " (" + (x.constructor && x.constructor.name || "a loop") + ")"); }
            return undefined;
        }
        way.push(x);
        var out;
        if (Array.isArray(x)) { out = new Array(x.length); for (var i = 0; i < x.length; i++) out[i] = plain(x[i], (path || "") + "[" + i + "]", way); }
        else { out = {}; for (var k in x) if (Object.prototype.hasOwnProperty.call(x, k) && typeof x[k] !== "function") out[k] = plain(x[k], (path || "") + "." + k, way); }
        way.pop();
        return out;
    }

    function wrap(obj, target, names) {
        if (!obj) return;
        names.forEach(function (name) {
            var fn = obj[name];
            if (typeof fn !== "function" || fn.linked) return;
            var wrapped = function () {
                var args = Array.prototype.slice.call(arguments), outer = depth === 0;
                if (outer && live) flush();                 // (what the page wrote before the call goes first)
                depth++;
                var result;
                try { result = fn.apply(this, arguments); } finally { depth--; }
                if (outer) {
                    if (target === "vehicle" && CONFIG[name]) configCalls.push([target, name, plain(args, name)]);
                    if (live) {
                        ops.push({ op: "call", target: target, method: name, args: plain(args, target + "." + name) });
                        VS.rebase(v, cache);
                        if (!NUDGE[name]) callFrame = hub.frame() + 1;
                    }
                }
                return result;
            };
            wrapped.linked = true;
            obj[name] = wrapped;
        });
    }
    function wrapAll() {
        wrap(v, "vehicle", CALLS.vehicle);
        wrap(v.engine, "engine", CALLS.engine);
        wrap(v.softBody, "softBody", CALLS.softBody);
        wrap(v.controller, "controller", CALLS.controller);
    }
    wrapAll();

    // what the page wrote into the vehicle since the last snapshot: to the worker, and kept here until a snapshot knows it
    function flush() {
        VS.changes(v, cache).forEach(function (c) { ops.push({ op: "set", name: c.name, value: plain(c.value, c.name) }); keepFrom[c.name] = hub.frame() + 1; });
        WATCH.forEach(function (name) {
            var x = VS.get(v, name);
            if (x !== watched[name]) { watched[name] = x; if (x !== undefined) ops.push({ op: "set", name: name, value: plain(x, name) }); }
        });
        var pf = v.partForces, n = pf ? pf.length : 0;
        if (n || partForcesSent) { ops.push({ op: "set", name: "partForces", value: n ? plain(pf, "partForces") : null }); partForcesSent = n; }
        VS.rebase(v, cache);
    }

    // everything the worker needs to take the car over as it is in the page
    function setupOf() {
        var sb = v.softBody;
        return {
            calls: configCalls,
            engine: { torque_curve: plain(v.engine.torque_curve, "engine.torque_curve"), extras: plain(v.engine.extras, "engine.extras") },
            fields: VS.snapshot(v, {}),
            objects: { collisionSpheres: plain(v.collisionSpheres, "collisionSpheres"), rig: plain(v.rig, "rig"), partForces: null },
            softBody: sb && sb.made ? { spheres: plain(sb.made.spheres, "softBody.spheres"), config: plain(sb.made.config, "softBody.config"), calls: plain(sb.made.calls, "softBody.calls"), state: sb.exportState() } : null
        };
    }
    function takeOver() {
        var s = setupOf();
        if (!live) hub.post({ type: "add", id: id, params: plain(v.parameters, "parameters"), input: VS.readInput(owner), setup: s, preControls: !!options.preControls });
        else hub.post({ type: "setup", id: id, setup: s });
        sentShell = v.softBody; sentSpheres = v.collisionSpheres;
        wrapAll();
        // the base of the changes: the view as it is now
        cache = {}; VS.apply(v, s.fields, cache); keepFrom = {};
        WATCH.forEach(function (name) { watched[name] = VS.get(v, name); });
        callFrame = hub.frame() + 1;
        live = true;
    }

    // the shell tyres in the page show what the worker's tyres do (TyreDeform.js reads deformation())
    function tyreStub(i, t) {
        var stub = tyreStubs[i] || (tyreStubs[i] = { table: null, rings: 0, deformation: function (out) { if (this.table) out.set(this.table.subarray(0, out.length)); return this.rings; } });
        stub.table = t.table; stub.rings = t.rings; stub.isShell = t.isShell; stub.innerRatio = t.innerRatio; stub.width = t.width;
        return stub;
    }

    function applySnapshot(snap) {
        if (snap.frame < callFrame) { hub.stats.skipped++; return false; }
        VS.apply(v, snap, cache, function (i) {
            var name = cache.steps[i].name, k = keepFrom[name];
            if (k === undefined) return false;
            if (snap.frame >= k) { delete keepFrom[name]; return false; }
            return true;
        });
        // the gear an automatic chose, unless the page shifted since
        if (snap.input && owner.current_gear === gearSent) owner.current_gear = snap.input.current_gear;
        var events = v.engine.events;
        events.length = 0;
        if (snap.events) for (var e = 0; e < snap.events.length; e++) events.push(snap.events[e]);
        if (snap.softState && v.softBody && v.softBody.importState) v.softBody.importState(snap.softState);
        if (snap.tyres) for (var w = 0; w < snap.tyres.length; w++) if (snap.tyres[w]) v.wheels[w].tyreBody = tyreStub(w, snap.tyres[w]);
        return true;
    }

    // the pose of the body and the wheels carried forward by dt seconds, as Vehicle.js integrates them (for the screen only: the next snapshot puts the real one back)
    var shownClock = null, ahead = 0;
    function carryForward(dt) {
        var dx = v.vx * dt, dy = v.vy * dt, dz = v.vz * dt;
        v.px += dx; v.py += dy; v.pz += dz;
        var hx = v.wx * dt * 0.5, hy = v.wy * dt * 0.5, hz = v.wz * dt * 0.5;
        var nqx = v.qx + hx * v.qw + hy * v.qz - hz * v.qy, nqy = v.qy + hy * v.qw + hz * v.qx - hx * v.qz;
        var nqz = v.qz + hz * v.qw + hx * v.qy - hy * v.qx, nqw = v.qw - hx * v.qx - hy * v.qy - hz * v.qz;
        var norm = Math.sqrt(nqx * nqx + nqy * nqy + nqz * nqz + nqw * nqw) || 1;
        v.qx = nqx / norm; v.qy = nqy / norm; v.qz = nqz / norm; v.qw = nqw / norm;
        for (var i = 0; i < v.wheels.length; i++) {
            var w = v.wheels[i];
            if (w.center) { w.center.x += dx; w.center.y += dy; w.center.z += dz; }
            if (typeof w.omega === "number") w.spin += w.omega * dt;
        }
    }

    // the hub takes what this car has for the next step
    this.take = function (frame) {
        var input = VS.readInput(owner);
        gearSent = input.current_gear;
        var out = ops; ops = [];
        return { input: input, ops: out };
    };
    // the worker failed: the page steps the car from the view, and its tyres are its own again (the stubs only show the worker's)
    this.gaveBack = function () {
        failed = true; live = false;
        for (var i = 0; i < v.wheels.length; i++) if (v.wheels[i].tyreBody && tyreStubs.indexOf(v.wheels[i].tyreBody) >= 0) v.wheels[i].tyreBody = null;
    };

    // In place of vehicle.update(delta) (and, with preControls, vehicle.updateControls(delta) before it), every frame
    this.update = function (delta) {
        if (failed || hub.failed()) { if (options.preControls) v.updateControls(delta); v.update(delta); return; }
        hub.start();
        if (!live) {
            if (options.preControls) v.updateControls(delta);
            v.update(delta);
            if (hub.ready() && owner.isReady() && hub.sendGround()) takeOver();
            return;
        }
        if (v.softBody !== sentShell || v.collisionSpheres !== sentSpheres) { flush(); takeOver(); }
        flush();
        var snap = this.latest, fresh = snap && applySnapshot(snap);
        this.latest = null;
        if (fresh) { this.freshFrames++; shownClock = snap.clock; ahead = 0; } else this.staleFrames++;
        // the car is shown at the time of this frame, as the page would show it (pageClock is the end of the last frame, delta this one): the snapshot (of the step of
        // the last frame, or older when the worker was not done) is carried forward by its speed and its turn. Without it the car moved on the screen by the time of
        // the frame before, which did not fit a frame of another length, and stood still in a frame without a snapshot and then jumped two (PHYSICS-WORKER.md)
        if (shownClock !== null) {
            var want = Math.min(0.1, Math.max(0, hub.pageClock() + delta - shownClock));
            if (want > ahead + 1e-6) { carryForward(want - ahead); ahead = want; VS.rebase(v, cache); }
        }
        if (!fresh) { v.soundImpact = 0; v.engine.events.length = 0; }       // (a pulse of one step is not repeated)
        if (v.pushes) v.pushes.length = 0;                                     // (pushDown is done by the worker)
    };
    this.live = function () { return live && !failed; };
    this.stop = function () { hub.unregister(id); live = false; failed = true; };
    hub.register(id, this);
};

// The physics of the cars in a worker: ?worker=1 in the address (?worker=0: not), else what the Mac app says (window.OpenRacerApp.physicsWorker, View menu), else not
OpenRacer.PhysicsLink.wanted = function () {
    if (typeof Worker === "undefined" || typeof location === "undefined") return false;
    var q = new URLSearchParams(location.search).get("worker");
    if (q === "1" || q === "0") return q === "1";
    return !!(typeof window !== "undefined" && window.OpenRacerApp && window.OpenRacerApp.physicsWorker);
};
// the end of a frame (main.js): the hub sends the step of every car
OpenRacer.PhysicsLink.endFrame = function (delta) { OpenRacer.PhysicsHub.endFrame(delta); };

// A small label for a test on a device (the address has worker=1 or worker=0): the frames per second, and where the physics of the cars runs and what it costs
// (ms of work for a second of driving: of the worker, or of the page, main.js simCost). Compare a drive with worker=1 against one with worker=0.
OpenRacer.PhysicsLink.badge = function (car) {
    if (typeof document === "undefined" || typeof location === "undefined") return;
    var mode = new URLSearchParams(location.search).get("worker");
    if (mode !== "1" && mode !== "0") return;
    var el = document.createElement("div");
    el.style.cssText = "position:fixed; left:8px; bottom:28px; z-index:50; font:12px/1.4 monospace; color:#fff; background:rgba(0,0,0,0.6); padding:4px 8px; border-radius:4px; pointer-events:none";
    document.body.appendChild(el);
    setInterval(function () {
        var L = car.physicsLink, H = OpenRacer.PhysicsHub, text = (typeof fps !== "undefined" ? fps : "?") + " fps · ";
        if (L && L.live()) text += "physics in a worker: " + H.stats.cars + " cars, " + Math.round(H.stats.cost) + " ms/s, " + Math.round(H.stats.roundTrip) + " ms a step";
        else text += "physics in the page: " + (typeof simCost !== "undefined" ? Math.round(simCost) : "?") + " ms/s" + (H.gaveBack() ? " (the worker gave it back: " + H.gaveBack() + ")" : "");
        el.textContent = text + " · " + (navigator.hardwareConcurrency || "?") + " cores";
    }, 1000);
};
