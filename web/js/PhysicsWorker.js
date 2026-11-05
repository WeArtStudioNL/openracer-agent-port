/*
 * PhysicsWorker.js
 *
 * Description: The physics of the cars in a Web Worker (PHYSICS-WORKER.md): the same files as in the page (Vehicle.js and what it uses), stepped
 *              here, and the state of every car sent back as a snapshot (VehicleState.js). PhysicsLink.js drives the player's car with it;
 *              tools/physics-worker-check.html runs it next to the main thread and checks that both give the same numbers.
 *
 *              Messages in (postMessage):
 *                { type: "ground", data }              the ground of the track (GroundWorld.exportData), or { type: "ground", flat: y } a flat road
 *                { type: "condition", wet, snow }      the ground condition (setGroundCondition, Surfaces.js)
 *                { type: "add", id, params, input, place: [x, z, heading], setup }   a vehicle (OpenRacer.vehicleParams without getSurface; a seed in
 *                                                      it gives the same random numbers as in the page); setup: see below
 *                { type: "setup", id, setup }          a vehicle takes over the state of the one in the page (after its model loaded, or was built again):
 *                                                      setup = { calls, engine, fields, objects, softBody } (PhysicsLink.setupOf)
 *                { type: "remove", id }
 *                { type: "step", frame, d, inputs: { id: input }, ops: { id: [op] }, controllers: { id: fields } }   one step of d seconds for every
 *                                                      vehicle; the ops first: { op: "set", name, value } (a value the page wrote, by its name in
 *                                                      VehicleState) and { op: "call", target, method, args } (vehicle, engine, softBody, controller)
 *              Messages out:
 *                { type: "ready" }, { type: "added", id }
 *                { type: "state", frame, ms, cars: { id: snapshot } }   after a step: the snapshots (their buffers are transferred); a snapshot has
 *                                                      softState (SoftBody.exportState) when the car has a shell
 *                { type: "error", message }
 */

self.OpenRacer = {};
importScripts("Surfaces.js", "Engine.js", "Wheel.js", "TyreShell.js", "SoftBody.js", "EngineDamage.js", "Ground.js", "Motorcycle.js", "Vehicle.js", "VehicleState.js");

var ground = null;
var cars = {};       // id: { vehicle, input, cache }

function place(car, p) { if(p) car.vehicle.reset(p[0], p[1], p[2] || 0); }

function targetOf(v, name) { return name === "vehicle" ? v : name === "engine" ? v.engine : name === "softBody" ? v.softBody : name === "controller" ? v.controller : null; }

// the vehicle takes over the state of the one in the page: the calls that set it up (retune, the tyres: what they leave in the vehicle that is not a value of it),
// its values, the objects the shell is made of, and the shell
function setup(car, s) {
    var v = car.vehicle;
    (s.calls || []).forEach(function (c) { var t = targetOf(v, c[0]); if(t && t[c[1]]) t[c[1]].apply(t, c[2]); });
    if(s.engine) Object.keys(s.engine).forEach(function (k) { v.engine[k] = s.engine[k]; });
    if(s.fields) OpenRacer.VehicleState.apply(v, s.fields, {});
    if(s.objects) Object.keys(s.objects).forEach(function (k) { v[k] = s.objects[k]; });
    v.proxy3 = null;                                   // (the spheres of the body in the world are made again from collisionSpheres)
    v.softBody = null;
    if(s.softBody) {
        var sb = v.softBody = new OpenRacer.SoftBody(v, s.softBody.spheres, s.softBody.config);
        s.softBody.calls.forEach(function (c) { sb[c[0]].apply(sb, c[1]); });
        if(s.softBody.state) sb.importState(s.softBody.state);
    }
    car.cache = {};
}

function run(car, op) {
    var v = car.vehicle;
    if(op.op === "set") OpenRacer.VehicleState.set(v, op.name, op.value);
    else if(op.op === "call") { var t = targetOf(v, op.target); if(t && typeof t[op.method] === "function") t[op.method].apply(t, op.args || []); }
}

self.onmessage = function (e) {
    var m = e.data;
    try {
        if(m.type === "ground") {
            ground = m.data ? OpenRacer.GroundWorld.fromData(m.data) : new OpenRacer.FlatGround(m.flat || 0, "road");
            for(var id in cars) cars[id].vehicle.ground = ground;
        } else if(m.type === "condition") {
            setGroundCondition(m.wet || 0, m.snow || 0);
        } else if(m.type === "add") {
            var input = Object.assign({}, m.input);
            var vehicle = new OpenRacer.Vehicle(Object.assign({}, m.params, { getSurface: getSurface }), input);
            vehicle.ground = ground;
            cars[m.id] = { vehicle: vehicle, input: input, cache: {} };
            place(cars[m.id], m.place);
            if(m.setup) setup(cars[m.id], m.setup);
            self.postMessage({ type: "added", id: m.id });
        } else if(m.type === "setup") {
            if(cars[m.id]) setup(cars[m.id], m.setup);
        } else if(m.type === "remove") {
            delete cars[m.id];
        } else if(m.type === "step") {
            var start = performance.now(), out = {}, transfer = [];
            for(var id in cars) {
                var car = cars[id];
                if(m.ops && m.ops[id]) m.ops[id].forEach(function (op) { run(car, op); });
                if(m.inputs && m.inputs[id]) Object.assign(car.input, m.inputs[id]);
                if(m.controllers && m.controllers[id] && car.vehicle.controller) Object.assign(car.vehicle.controller, m.controllers[id]);
                car.vehicle.update(m.d);
            }
            var ms = performance.now() - start;
            for(var id in cars) {
                var v = cars[id].vehicle, snap = OpenRacer.VehicleState.snapshot(v, cars[id].cache);
                if(v.softBody && v.softBody.exportState) {
                    var st = snap.softState = v.softBody.exportState();
                    transfer.push(st.u.buffer, st.w.buffer, st.q.buffer, st.displacement.buffer);
                }
                out[id] = snap;
                transfer.push(snap.num.buffer);
                if(snap.soft) transfer.push(snap.soft.buffer);
                if(snap.tyres) snap.tyres.forEach(function (t) { if(t) transfer.push(t.table.buffer); });
            }
            self.postMessage({ type: "state", frame: m.frame, ms: ms, cars: out }, transfer);
        }
    } catch(error) {
        self.postMessage({ type: "error", message: String(error && error.stack || error) });
    }
};
self.postMessage({ type: "ready" });
