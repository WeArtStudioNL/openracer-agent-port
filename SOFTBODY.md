# Soft body, parts and hinges: design

Branch `claude/soft-body`. Status: M1 and M2 built (M2 with the first test parts); M3 and M4 to do. Nothing here is released.

## What the game has now

* The car is **one rigid body** (`Vehicle.js`): position, orientation, linear and angular velocity, mass and the inertia of a box, impulses at the point of a hit. On it hang four quarter-car suspensions, the tyres, the driveline.
* Since 2.2 (3D physics) the body is a cloud of **collision spheres** made from the model, tested against the triangles of the track.
* Cars hit each other as two discs each (`collideCars`). Nothing else moves: no props, no loose parts, no hinged doors.

So the question "do we use rigid body physics" is yes for the car, but there is no general rigid-body engine for the things around it.

## The decision: three layers

| Layer | What it is | Built with |
|---|---|---|
| 1. The car | the rigid body, the suspension, the tyres | our own code (tuned, keep it) |
| 2. The shell | a skeleton of nodes and beams in the frame of the car: it dents, it absorbs the energy of a crash, it changes the shape that hits things, and the model is deformed with it | our own code (`SoftBody.js`) |
| 3. Parts and props | doors, hood, boot lid, bumpers, mirrors, wings: hinged, detachable, loose. And cones, barrels, tyre stacks on the track | a rigid-body engine (Rapier, Apache-2.0, a WASM file loaded only when a car or track has such things), joints with limits, springs and break forces |

Why not one engine for everything: the driving model (tyres, suspension, driveline) is tuned for years of play and stays as it is. A general engine is good at what we lack (many bodies, joints, stacking, collisions of convex shapes), and a skeleton of beams is what makes a crash look right (energy in the deformation, a shape that stays bent). The three meet at the nodes: layer 2 gives layer 3 the points where parts are attached, and layer 3 gives layer 1 and 2 the forces of the joints.

## Layer 2: the shell (M1)

In the frame of the car (x left, y up, z forward, from the centre of gravity):

* **Nodes**: one for every collision sphere (`CollisionProxy.js`), at its rest place `p`. State: the displacement `u` from the rest place, the velocity `w` in the frame, and the permanent part `q` (the bend that stays). Mass: a share of the shell.
* **Anchor** of a node to the frame: a spring `F = -ka (u - q) - ca w` (the stiffness of the structure under it). Elastic up to a **yield** displacement; beyond that `q` moves along (**plastic**: the shape stays bent, the energy is gone). Past the **break** displacement or force the anchor tears off.
* **Beams** between neighbouring nodes: a spring and a damper along the line between them, with a **yield** (strain) and a **break** (force). A beam that yields gets a new rest length. A beam that breaks is gone.
* **Contacts**: the spheres hit the track as now, but the force goes to the **node** (a stiff penalty spring with friction, tested at the place where the node is now, bent or not). The rigid body feels the hit only through the anchors (and the beams), so the peak force is limited by what yields, and the energy of a crash goes into the plastic work.
* **The rigid body** gets the reaction of every anchor, as a force at the place of the node.
* **Strengths per node and per beam** can be set: yield and break, in newtons. The default comes from material presets.
* **The model** is deformed in the vertex shader: every vertex has its four nearest nodes and weights, and moves with them (`aNodes`, `aWeights`, a uniform array of the displacements). No work for the processor, only for the nodes.
* Cost: about 60 nodes and 250 beams, with 4 small steps in every step of the physics, is about 4000 spring evaluations a frame for a car.

## Layer 3: parts and props (M2)

* **Parts** are the objects of the glTF model (the door, the hood), listed in `car.json` under `parts`, each with a **mode**:
  * `fixed` (default): part of the shell, deformed with it.
  * `detachable`: attached to some nodes; when the load on those anchors passes its **break force** it becomes a free rigid body (a collider from its mesh, mass, inertia) that falls, bounces and slides on the track.
  * `hinge`: a revolute joint with an **axis**, an **origin**, **limits** (angles), a **spring** and a **damper** (a door that swings shut or stays open), a **latch force** (it opens when a force passes it) and a **break force** (it tears off, and becomes a detached part).
* The car stays a kinematic body in the engine (driven by our physics), so that parts collide with it; the forces of the joints are given back to the car.
* **Props** of a track (cones, barrels, tyre stacks): rigid bodies with convex colliders, from the track editor, hit by the car through the same spheres.
* The track is a static triangle mesh in the engine.

## The editor (M3)

The car editor gets a **Soft body** card:
* Generate the nodes and beams from the model (with the density as a setting), show them in the view as points and lines.
* Select a node or a beam in the view: set its yield and break force; presets for the material (steel, aluminium, plastic, glass, rubber); a paint brush for a region.
* **Parts**: choose an object of the model, set its mode; for a hinge draw the axis in the view (a gizmo), set limits, spring, damper, latch and break force; for a detachable part choose its attachment nodes (by region) and the break force.
* **Crash test** on the test bench: drive at a wall at a chosen speed, or drop on the nose, and watch it, with the forces as colours (green to red).
* All of it is saved in `car.json` (`softbody`, `parts`), so a car can be shared as a zip like now.

## Milestones

* **M1** the shell: nodes, beams, yield and break, the coupling with the body and the contacts, the deformation of the model, strengths in `car.json`, a crash test. *(now)*
* **M2** parts with the rigid-body engine: hinges, detaching. *(built: `js/Parts.js`; props of a track still to do)*
* **M3** the editor card.
* **M4** replay (the displacements and the parts are recorded), AI cars, the saved file.

## Not in scope

A solver that makes the whole car out of beams (BeamNG): the driving would have to be tuned again. The tyres stay our model. Fluid, fire, glass shards.

## `car.json`: parts (M2)

```json
"parts": [
  { "object": "hood", "mode": "hinge", "mass": 14,
    "hinge": { "origin": [0, 0.7, 1.1], "axis": [1, 0, 0], "min": -70, "max": 5, "rest": 0, "spring": 20, "damper": 2,
               "latch_force": 6000, "break_force": 40000 } },
  { "object": "licenseplate", "mode": "detachable", "mass": 1.2, "break_force": 2500, "nodes": [44, 46, 43] }
]
```

* `object`: the name of an object in the glTF model. `mode`: `fixed` (default, nothing happens), `detachable` or `hinge`. `mass` in kg.
* `origin` and `axis` are in the frame of the car (x left, y up, z forward, from the centre of gravity), `min`, `max` and `rest` in degrees.
* `nodes`: the nodes of the shell it hangs on; default the three nearest to its middle. A part comes loose at once when the anchor of one of them tears.
* The load on a part is the larger of mass times the acceleration of its place and the force of the shell on its nodes (displacement times stiffness).
* A hinge with `latch_force` sits shut until the load passes it; without, it is free to swing from the start. A hinge with `break_force`, and a detachable part, become a free body.
* What was tested: a plate that comes loose at an abrupt stop, flies on, lands on the road and sleeps; a hinged plate that unlatches; `repair()` puts both back. Not yet: a real door or hood (no car has one), a loose part that hits the car, and the replay of parts (M4).
* Known limits: no force goes back from a part to the car; the collision spheres of a part that has come loose stay on the car.
