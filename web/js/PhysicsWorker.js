/*
 * PhysicsWorker.js
 *
 * Description: The physics of the cars in a Web Worker (PHYSICS-WORKER.md): the same files as in the page (Vehicle.js and what it uses), stepped
 *              here, and the state of every car sent back as a snapshot (VehicleState.js). Not used by the game yet: tools/physics-worker-check.html
 *              runs it next to the main thread and checks that both give the same numbers.
 *
 *              Messages in (postMessage):
 *                { type: "ground", data }              the ground of the track (GroundWorld.exportData), or { type: "ground", flat: y } a flat road
 *                { type: "condition", wet, snow }      the ground condition (setGroundCondition, Surfaces.js)
 *                { type: "add", id, params, input, place: [x, z, heading] }   a vehicle (OpenRacer.vehicleParams without getSurface; a seed in it
 *                                                      gives the same random numbers as in the page)
 *                { type: "remove", id }
 *                { type: "step", frame, d, inputs: { id: input }, controllers: { id: fields } }   one frame of d seconds for every vehicle
 *              Messages out:
 *                { type: "ready" }, { type: "added", id }
 *                { type: "state", frame, ms, cars: { id: snapshot } }   after a step: the snapshots (their buffers are transferred)
 *                { type: "error", message }
 */

self.OpenRacer = {};
importScripts("Surfaces.js", "Engine.js", "Wheel.js", "TyreShell.js", "SoftBody.js", "Ground.js", "Motorcycle.js", "Vehicle.js", "VehicleState.js");

var ground = null;
var cars = {};       // id: { vehicle, input, cache }

function place(car, p) { if(p) car.vehicle.reset(p[0], p[1], p[2] || 0); }

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
            self.postMessage({ type: "added", id: m.id });
        } else if(m.type === "remove") {
            delete cars[m.id];
        } else if(m.type === "step") {
            var start = performance.now(), out = {}, transfer = [];
            for(var id in cars) {
                var car = cars[id];
                if(m.inputs && m.inputs[id]) Object.assign(car.input, m.inputs[id]);
                if(m.controllers && m.controllers[id] && car.vehicle.controller) Object.assign(car.vehicle.controller, m.controllers[id]);
                car.vehicle.update(m.d);
            }
            var ms = performance.now() - start;
            for(var id in cars) {
                var snap = OpenRacer.VehicleState.snapshot(cars[id].vehicle, cars[id].cache);
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
