/*
 * PhysicsLink.js
 *
 * Description: The physics of the player's car in a Web Worker (PhysicsWorker.js; the plan and the measurements: PHYSICS-WORKER.md). The vehicle in the page
 *              (car.vehicle) stays, with all its fields and methods, but it is not stepped here: it is a view, filled every frame from the snapshot that
 *              the worker sends (VehicleState.js). So everything that reads the car (the model, the cameras, the sound, the HUD, the replay, the parts)
 *              reads it as before.
 *
 *              What the page does to the car goes to the worker:
 *                - a value it writes into the vehicle (the jacks of the pit stop, a hit of a car or a prop, the fuel, the options): it is found by comparing
 *                  the view with what the last snapshot put there (VehicleState.changes) and sent with the next step; until a snapshot comes back that knows
 *                  it, the page keeps its own value;
 *                - a method it calls (reset, retune, repair, a puncture, an impulse, the shell's repair and its node grabber): the call is done here too, and
 *                  sent; the snapshots of the steps before it are not used.
 *              The worker steps once the page has a step for it and the last one came back: one step behind the page (a frame of 1/60 s), with the
 *              time of the frames it was busy added to the next one.
 *
 *              Until the car has its model (and its shell) the page steps it itself; then the worker takes over the whole state (setup). When the
 *              shell changes (the tuning menu builds the car again) the worker takes it over again. When the worker fails, or cannot keep up with the
 *              time of the game (it costs more than 0.9 s of work for a second of driving, over two seconds: a browser that puts a worker on a slow core,
 *              as Chrome does on a Mac, PHYSICS-WORKER.md), the page steps the car again. Used with ?worker=1 in the address (PhysicsLink.wanted).
 */

OpenRacer.PhysicsLink = function (car) {
    var self = this;
    var VS = OpenRacer.VehicleState;
    var v = car.vehicle;

    // the methods whose calls go to the worker, per object; CONFIG: the ones that set the vehicle up, done again in the worker when it takes over
    var CALLS = {
        vehicle: ["reset", "relocate", "retune", "repair", "repairUpright", "repairWheels", "repairWheel", "repairTyres", "freshTyres", "freshTyre", "fuelAndTyres",
            "puncture", "applyImpulse", "hitWheel", "setRubber", "setCompound", "setAnti", "applyPressure", "standOnWheels", "startEngine", "pushDown"],
        engine: ["start"],
        softBody: ["detachGroup", "repairStart", "repairTo", "repair", "settle", "syncDisplacement", "pushPlate", "grab", "moveGrab", "release", "releasePlate",
            "addBeam", "setNode"],
        controller: ["recover"]
    };
    var CONFIG = { retune: 1, setRubber: 1, setCompound: 1, setAnti: 1, applyPressure: 1 };
    // the calls that nudge the car (an impulse, the node grabber that moves every frame, the cube of the hit tool, the repair of the pit stop share by share): the
    // snapshots of the steps before them are still used. After the other calls (a reset, a repair) they are not: they would put the car back for a frame.
    var NUDGE = { applyImpulse: 1, hitWheel: 1, pushDown: 1, puncture: 1, startEngine: 1, start: 1, grab: 1, moveGrab: 1, release: 1, pushPlate: 1, releasePlate: 1, repairTo: 1, repairStart: 1 };
    // objects in the vehicle that are not values of a snapshot, which the page sets: sent when they are another object
    var WATCH = ["partForces", "engine.torque_curve", "engine.extras"];

    var worker = null, workerReady = false, live = false, failed = false, busy = false;
    var frame = 0, pendingTime = 0, ops = [], latest = null;
    var cache = {};                  // the schema of the snapshots and what the last one left in the view (VehicleState)
    var keepFrom = {};               // name: the first step whose snapshot knows the value the page wrote
    var callFrame = 0;               // the snapshots of steps before this one are not used (a call changed the car)
    var configCalls = [];            // [target, method, args] (CONFIG), for the setup
    var depth = 0;                   // (a call inside a call is not sent: the worker does it in the outer one)
    var watched = {};
    var sentShell = null, sentSpheres = null, gearSent = null, wetSent = null, snowSent = null;
    var tyreStubs = [];
    this.stats = { steps: 0, answers: 0, lastMs: 0, skipped: 0, cost: 0, gaveBack: null, roundTrip: 0 };
    var sentAt = 0;                                      // when the step that is out was sent (performance.now)
    var sentTime = 0, liveFor = 0, slowFor = 0;          // the game time of the step that is out, and how long the worker has had the car and been too slow

    // a copy of a value without functions (what postMessage can take)
    function plain(x) {
        if(typeof x === "function") return undefined;
        if(!x || typeof x !== "object" || ArrayBuffer.isView(x)) return x;
        if(Array.isArray(x)) return x.map(plain);
        var out = {};
        for(var k in x) if(Object.prototype.hasOwnProperty.call(x, k) && typeof x[k] !== "function") out[k] = plain(x[k]);
        return out;
    }

    function wrap(obj, target, names) {
        if(!obj) return;
        names.forEach(function (name) {
            var fn = obj[name];
            if(typeof fn !== "function" || fn.linked) return;
            var wrapped = function () {
                var args = Array.prototype.slice.call(arguments), outer = depth === 0;
                if(outer && live) flush();                 // (what the page wrote before the call goes first)
                depth++;
                var result;
                try { result = fn.apply(this, arguments); } finally { depth--; }
                if(outer) {
                    if(target === "vehicle" && CONFIG[name]) configCalls.push([target, name, plain(args)]);
                    if(live) {
                        ops.push({ op: "call", target: target, method: name, args: plain(args) });
                        VS.rebase(v, cache);
                        if(!NUDGE[name]) callFrame = frame + 1;
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
        VS.changes(v, cache).forEach(function (c) { ops.push({ op: "set", name: c.name, value: plain(c.value) }); keepFrom[c.name] = frame + 1; });
        WATCH.forEach(function (name) {
            var x = VS.get(v, name);
            if(x !== watched[name]) { watched[name] = x; ops.push({ op: "set", name: name, value: plain(x) }); }
        });
        VS.rebase(v, cache);
    }

    function start() {
        try {
            worker = new Worker("js/PhysicsWorker.js");
        } catch(e) { fail(e); return; }
        worker.onmessage = function (e) {
            var m = e.data;
            if(m.type === "ready") workerReady = true;
            else if(m.type === "state") {
                busy = false; self.stats.answers++; self.stats.lastMs = m.ms; self.stats.roundTrip = performance.now() - sentAt;
                // the work for a second of driving (ms), smoothed
                if(sentTime > 0) self.stats.cost += 0.2 * (m.ms / sentTime - self.stats.cost);
                if(m.cars.player) { m.cars.player.frame = m.frame; latest = m.cars.player; }
            }
            else if(m.type === "error") fail(new Error(m.message));
        };
        worker.onerror = function (e) { fail(new Error(e.message || "the physics worker failed")); };
    }
    function fail(error) {
        if(failed) return;
        failed = true; live = false;
        self.stats.gaveBack = error && error.message ? error.message : String(error);
        console.warn("PhysicsLink: the physics of the car goes back to the page: " + self.stats.gaveBack);
        if(worker) worker.terminate();
        worker = null;
        // the page steps the car from the view: its tyres are its own again (the stubs only show the worker's)
        for(var i = 0; i < v.wheels.length; i++) if(v.wheels[i].tyreBody && tyreStubs.indexOf(v.wheels[i].tyreBody) >= 0) v.wheels[i].tyreBody = null;
    }

    // everything the worker needs to take the car over as it is in the page
    function setupOf() {
        var sb = v.softBody;
        return {
            calls: configCalls,
            engine: { torque_curve: plain(v.engine.torque_curve), extras: plain(v.engine.extras) },
            fields: VS.snapshot(v, {}),
            objects: { collisionSpheres: plain(v.collisionSpheres), rig: plain(v.rig), partForces: null },
            softBody: sb && sb.made ? { spheres: plain(sb.made.spheres), config: plain(sb.made.config), calls: plain(sb.made.calls), state: sb.exportState() } : null
        };
    }
    function takeOver() {
        var s = setupOf();
        if(!live) {
            worker.postMessage({ type: "ground", data: groundWorld.exportData() });
            worker.postMessage({ type: "add", id: "player", params: plain(v.parameters), input: VS.readInput(car), setup: s });
        } else worker.postMessage({ type: "setup", id: "player", setup: s });
        sendCondition();
        sentShell = v.softBody; sentSpheres = v.collisionSpheres;
        wrapAll();
        // the base of the changes: the view as it is now
        cache = {}; VS.apply(v, s.fields, cache); keepFrom = {};
        WATCH.forEach(function (name) { watched[name] = VS.get(v, name); });
        callFrame = frame + 1;
        live = true;
    }
    function sendCondition() {
        if(typeof groundWet === "undefined") return;
        if(groundWet === wetSent && groundSnow === snowSent) return;
        wetSent = groundWet; snowSent = groundSnow;
        worker.postMessage({ type: "condition", wet: groundWet, snow: groundSnow });
    }

    // the shell tyres in the page show what the worker's tyres do (TyreDeform.js reads deformation())
    function tyreStub(i, t) {
        var stub = tyreStubs[i] || (tyreStubs[i] = { table: null, rings: 0, deformation: function (out) { if(this.table) out.set(this.table.subarray(0, out.length)); return this.rings; } });
        stub.table = t.table; stub.rings = t.rings; stub.isShell = t.isShell; stub.innerRatio = t.innerRatio; stub.width = t.width;
        return stub;
    }

    function applySnapshot(snap) {
        if(snap.frame < callFrame) { self.stats.skipped++; return false; }
        VS.apply(v, snap, cache, function (i) {
            var name = cache.steps[i].name, k = keepFrom[name];
            if(k === undefined) return false;
            if(snap.frame >= k) { delete keepFrom[name]; return false; }
            return true;
        });
        // the gear an automatic chose, unless the page shifted since
        if(snap.input && car.current_gear === gearSent) car.current_gear = snap.input.current_gear;
        var events = v.engine.events;
        events.length = 0;
        if(snap.events) for(var e = 0; e < snap.events.length; e++) events.push(snap.events[e]);
        if(snap.softState && v.softBody && v.softBody.importState) v.softBody.importState(snap.softState);
        if(snap.tyres) for(var w = 0; w < snap.tyres.length; w++) if(snap.tyres[w]) v.wheels[w].tyreBody = tyreStub(w, snap.tyres[w]);
        return true;
    }

    // In place of vehicle.update(delta), every frame (Car.update)
    this.update = function (delta) {
        if(failed) { v.update(delta); return; }
        if(!worker) start();
        if(!live) {
            v.update(delta);
            if(workerReady && car.isReady() && typeof groundWorld !== "undefined" && groundWorld && groundWorld.exportData) takeOver();
            return;
        }
        if(v.softBody !== sentShell || v.collisionSpheres !== sentSpheres) { flush(); takeOver(); }
        flush();
        sendCondition();
        var fresh = latest && applySnapshot(latest);
        latest = null;
        if(!fresh) { v.soundImpact = 0; v.engine.events.length = 0; }       // (a pulse of one step is not repeated)
        if(v.pushes) v.pushes.length = 0;                                     // (pushDown is done by the worker)
        pendingTime = Math.min(0.1, pendingTime + delta);
        // a worker that cannot keep up with the game gives the car back (the drive would go in slow motion)
        liveFor += delta;
        slowFor = liveFor > 1 && self.stats.cost > 900 ? slowFor + delta : 0;
        if(slowFor > 2) { fail(new Error("the worker needs " + Math.round(self.stats.cost) + " ms for a second of driving")); return; }
        if(!busy) {
            frame++;
            var input = VS.readInput(car);
            gearSent = input.current_gear;
            var opsOf = {}; opsOf.player = ops; ops = [];
            worker.postMessage({ type: "step", frame: frame, d: pendingTime, inputs: { player: input }, ops: opsOf });
            sentTime = pendingTime; pendingTime = 0; busy = true; self.stats.steps++; sentAt = performance.now();
        }
    };
    this.live = function () { return live; };
    this.stop = function () { if(worker) worker.terminate(); worker = null; live = false; failed = true; };
};

// the physics of the player's car in a worker: ?worker=1 in the address
OpenRacer.PhysicsLink.wanted = function () {
    return typeof Worker !== "undefined" && typeof location !== "undefined" && new URLSearchParams(location.search).get("worker") === "1";
};

// A small label for a test on a device (the address has worker=1 or worker=0): the frames per second, and where the physics of the car runs and what it costs
// (ms of work for a second of driving: of the worker, or of the page, main.js simCost). Compare a drive with worker=1 against one with worker=0.
OpenRacer.PhysicsLink.badge = function (car) {
    if(typeof document === "undefined" || typeof location === "undefined") return;
    var mode = new URLSearchParams(location.search).get("worker");
    if(mode !== "1" && mode !== "0") return;
    var el = document.createElement("div");
    el.style.cssText = "position:fixed; left:8px; bottom:28px; z-index:50; font:12px/1.4 monospace; color:#fff; background:rgba(0,0,0,0.6); padding:4px 8px; border-radius:4px; pointer-events:none";
    document.body.appendChild(el);
    setInterval(function () {
        var L = car.physicsLink, text = (typeof fps !== "undefined" ? fps : "?") + " fps · ";
        if(L && L.live()) text += "physics in a worker: " + Math.round(L.stats.cost) + " ms/s, " + Math.round(L.stats.roundTrip) + " ms a step";
        else text += "physics in the page: " + (typeof simCost !== "undefined" ? Math.round(simCost) : "?") + " ms/s" + (L && L.stats.gaveBack ? " (the worker gave it back: " + L.stats.gaveBack + ")" : "");
        el.textContent = text + " · " + (navigator.hardwareConcurrency || "?") + " cores";
    }, 1000);
};
