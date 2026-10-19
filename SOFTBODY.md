# Soft body, parts and hinges: design

Branch `claude/soft-body`. Status: M1, M2 and M3 built; M4 to do. Nothing here is released.

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
* **M3** the editor card. *(built: `web/tools/softbody-editor.js`)*
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

## The editor card (M3)

The "Soft body" card of the car editor (`web/tools/softbody-editor.js`, hooked into `car-editor.js`):

* **The car dents** (on/off), **Material and strengths…**: a preset (steel, aluminium, plastic, foam and rubber, race cage) and every number of `softbody` (shell mass, hardening, anchor, beam and contact: stiffness in kN/mm, forces in kN, damping, friction, beams per node and their reach). An empty field is the default and is not written to `car.json`.
* **Show the shell**: starts the test bench, makes the shell from the model as the game does, and draws the nodes and beams over it. A node is green when whole, yellow at its yield bend, red above it, grey when its anchor is torn.
* **Selection**: click a node or a beam in the view; set its yield and break force (kN) or put it back to the default. Saved as `softbody.nodes` (`{ i, yield_force, break_force }`) and `softbody.beams` (`{ a, b, ... }`). The numbers belong to the nodes as they are made from the model: change the model and they may point elsewhere.
* **Parts…**: a list of the objects of the model with a behaviour (hinge or loose) and every number of `parts`; the hinges are drawn as orange arrows in the view.
* **Crash test**: a speed (10 to 150 km/h) and an angle of the wall; the car drives straight ahead from its start point into a wall on a 3D ground (only the wall is added, 6.6 m ahead of the middle of the car), the camera follows, and the card shows the peak deceleration, the bend, the energy that the shell took up, the torn anchors and beams and the part events. **Repair** puts everything back.
* Edits of strengths in the view act on the bench at once; the other settings make the shell again (a moment after the last change).

### Editing the nodes, the lasso and the folding bars

* **Edit nodes** (in the card): a click on the model puts a node on its surface (radius from the field, 0.2 m by default); it is joined by beams to its nearest neighbours, as the nodes of the model are. A click on a node selects it (Shift or Ctrl adds), the **middle mouse button and a drag** draws a lasso round many nodes (also without the edit mode, to set strengths on all of them). **Delete selected** (or the Delete key) removes the selected nodes; the strengths that were set on the nodes behind them follow their new numbers. At least 3 and at most 120 nodes. "Make the nodes from the model again" throws the changes away.
* From the first edit on the nodes are a list of the car: `softbody.layout`: `[{ "x", "y", "z", "r" }]` in the frame of the car, in the order of the numbers of the nodes. `CollisionProxy.apply` uses it instead of the nodes made from the model, so they are also the spheres that hit the road and the walls. Without `layout` nothing changes.
* The editor has three buttons (top right of the view) that fold the left bar, the right bar (Layers) and the test buttons away.

### The ray scan, the inside, the most nodes

* **Most nodes to make** (`softbody.max_nodes`, 10 to 120): the limit for the nodes that are made from the model (CollisionProxy.js takes a bigger cell until they fit) and for the scan. Empty is the old behaviour (about 90).
* **Scan with rays** (the card): rays go at the model from the six sides of its box on a grid of 10 cm, and the first thing they hit gives the points of the surface; the nodes are spread evenly over those points (farthest point first), their radius follows the distance between them. The triangles of the model are put in a grid of 25 cm cells for this, so the scan takes a moment and not minutes.
* **The inside**: a point of a 20 cm grid is inside the model when at least five of six rays from it hit the back of a surface first (the car is open at the windows and the wheel arches). Of those points the ones farthest from the nodes that there are become nodes inside (radius 12 cm, `"inner": true` in the layout, blue in the view), up to the most nodes; the scan takes 70% of the most for the surface when it also fills the inside. "Fill the inside" does it for the nodes that there are.
* Fixed: after nodes were made, removed or scanned again, the model did not bend in the next crash test: `SoftBodyMesh.attach` kept the weights and the materials of the first shell. It starts from the original materials now (`SoftBodyMesh.restore`), and the model of the editor is back to itself when the test stops.
* The camera of the crash test goes back to the car in the middle of the view with Repair, with a new crash and when the test stops.

### The gizmo

A selected node (or the middle of several selected nodes) gets a move gizmo in the view. While it is dragged the beams are made again from the nearest neighbours (the same rule as `SoftBody.js`, with the "beams per node" and "longest beam" of the settings) and drawn live, the moving ones in white; on release the shell is made again from the new places. The first move turns the nodes into a list of the car (`softbody.layout`).

### Hinge points on the body (mounts)

A hinged part (a hood, a door) can hang on **two nodes of the body**, each with its own force:

```json
{ "object": "hood", "mode": "hinge", "mass": 14,
  "mounts": [ { "node": 12, "break_force": 30000 }, { "node": 15, "break_force": 30000 } ],
  "nodes": [20, 21],
  "hinge": { "min": -70, "max": 5, "spring": 20, "damper": 2, "latch_force": 6000 } }
```

* `mounts` (at most two): the numbers of nodes of the shell. The hinge is the line from the first to the second; `origin` and `axis` are not needed then. A mount tears off at its `break_force` (the inertia of the part shared over the mounts that hold, or the force of the shell on its node, whichever is more), or when the anchor of its node tears. **With one mount left the part swings about that point** (a ball joint), with none it is free (a `detached` event). Events: `unlatched`, `mount torn`, `detached`.
* `nodes`: the nodes that hold the part shut (and the displacement of which is the load on it); with `hinge.latch_force` it opens when the load passes it.
* In the editor: the part window (below) or the Set buttons of the "Parts…" panel. The hinge is drawn as an orange line between its points (the lines to the nodes that hold it shut start at A). (The "Part points" card that did this by node numbers has been taken out: the part window does it.)
* Not yet: beams inside a part, so that the part itself dents. A part is a rigid body in the engine; while it sits on the car it bends with the shell, like the rest of the model.

### Apply force (a cube that is fired)

* **Apply force** (the card, next to the crash test): point at the car and an arrow shows the surface under the mouse and the way the cube will come (against the outer normal). A click fires an **invisible rigid cube** at the car there: a short push (30 ms) of the force in **kg** (kg times 9.81 N) on a cube of the mass that is set (100 kg by default) and the side that is set, so the speed is `force * 0.03 / mass` (the card tells it in km/h). The cube starts 0.4 m outside the surface, flies free after the push, hits the nodes under its face as in a crash (`SoftBody.pushPlate`, anchors and beams yield and tear), **rebounds** and is gone when it has moved away again; then the car is let go. Not a constant pressure but a blow.
* The card shows the peak force of the hit (in kg), how far the cube got into the shell, the bend, the energy and the torn anchors and beams. A click fires another cube; **Release** (or Repair) stops it.
* The car is clamped while the cube is at it (`softBody.pinned`): the anchors do not move the rigid body, or a big blow would carry the car away. The dent is what is tested.
* The wall of the crash test is 10% opaque, so the car is seen through it when the camera is behind it.

### Nodes and beams of a part

A part can have **nodes of its own**, so that it dents by itself and its hold on the body is made of beams:

* In the editor: select the nodes of the part in the view (a click, a lasso with the middle mouse button), pick the part in the card and press **Part nodes = selection**. The nodes get `"part": "<object name>"` in `softbody.layout` (orange in the view). Delete, move and set strengths on them as on any node.
* The nodes of a part are joined to each other by beams (the nearest neighbours, as always) and **not** to the body. The body is joined to the part by **link beams**: every hinge point (`mounts`, a node of the body) gets a beam to the nearest node of the part, with the break force of the mount. The strengths of those beams can be set in the view like any beam.
* The model of the part (the meshes of the object that the part names) bends with the nodes of the part only, and the model of the body with the nodes that belong to no part.
* When a link beam tears, that mount is gone and the part opens on the other one; with none left it is free. When the part comes loose its nodes leave the shell (they are not simulated, they do not hit the road), and **the part keeps its dents**: its model keeps the bend that it had.
* Without nodes of its own a part is a rigid piece that bends with the shell while it sits on the car, as before.

### The Set buttons (parts panel)

The "Parts…" panel is not modal any more: it stays beside the view, so nodes can be selected while it is open. Next to every value there is a button that takes it from the view, so no node numbers have to be known:

* **Pick on the model** (object): click the part on the model; the name of the group around the mesh is used (the chain from mesh to root is in the status line, and the field can be edited).
* **Set = selected node** (hinge point A and B), **Set = selected nodes** (held by, own nodes of the part), **Clear** (own nodes).
* **Origin**: **Node** (the place of the selected node) or **Pick point** (click a point on the model surface). **Axis**: **A→B** (from the two hinge points) or **X**, **Y**, **Z**.

### Repair and the latch

A hinge part **without** `latch_force` used to start open: after Repair it swung on its hinge point at once (and with a hinge point far from the part it hung and swung away from its place, which looked like a part that was not repaired). A hinge now has a **default latch of 3 g of the part** (`mass * 9.81 * 3` N): it sits shut in driving and opens in a crash. `latch_force: 0` is a hinge that is open from the start. After Repair every part is back in its place, shut.

### Pin points on the surface

A hinge point (`mounts`) can be a **point on the surface** instead of a node: `{ "point": [x, y, z], "break_force": N }`, in the frame of the car. The hinge goes through the exact points; the hold on the body (the link beam of a part with nodes of its own, the shell load on the mount) is taken by the nearest node of the body. In the editor the hinge point fields have **Pick point** (click the model) next to **Set = selected node**; the axis button **A→B** works with both. A point wins over a node when both are filled in.

### The editor leaves nothing behind

The car editor makes a new car for every test. A part that a test has thrown off stays in the scene, so after a few tests a door lay on the floor (also after Repair, which only puts back the parts of the car of the current test). `Parts.dispose()` takes the thrown parts out of the scene when a test ends, and a model that is used again gets its parts back in their place before they are measured (`userData.partHome`).

### The part window (the way to make a part)

The editor opens with the car of last time loaded (`localStorage` "editor-last-car", else the first car of the list). Making a part needs no card and no node numbers:

1. **Hover a loose object** in the view: it gets an orange outline. Loose is a named object that is not (a part of) the body, a wheel or the steering wheel; the body is the object with most of the triangles (40% or more), so what hangs in it (a plate) and beside it (a door, the hood) is loose.
2. **Click it**: a window opens that can be moved by its title (and closed with the cross). "Part not added to loose parts" with **Add**.
3. **Pin points** (**+ add**, then click the surface): the point is added to the list, and is also the origin of the hinge. Each pin point has toggles **X Y Z** (the axes of the car that it may turn about; by default only X), sliders for the **minimum and maximum angle**, and a **breaking force** (kN; empty: never). The gizmo in the view follows: a line for every free axis and a fan for the angles that it may turn through, from the rest place (the white line is angle 0), live while a slider moves. One axis is a hinge between the two angles, two or three axes make a ball joint (the angles are not enforced), none is a rigid pin. A pin that breaks is gone; with none left the part is free. With more pins the first one that holds is the joint, the others add to the hold (put them on one line, so that they do not fight).
4. **Nodes** (**Add nodes**): a click on the surface of the object puts a node there (only on that object; up to 200 nodes for the whole car, instead of 120); **Stop adding nodes** or Esc ends it, and the bench is made again then. The nodes are in a list with a cross each, and one field sets the **strength of all of them** (kN: they bend at that force and tear at two and a half times).
5. **Every change is saved** (after a moment) into the car that is open: `parts` (with `mounts`: `{ point, axes, min, max, break_force }`) and `softbody.layout`.

The next crash test starts from what the window changed. The older "Parts…" panel stays, for numbers; it keeps the pin points of the window. The "Part points" card is gone.

### Turning a pin

A pin point can be turned, so that its axes are not the axes of the car: a **rotate gizmo** (three rings) sits on the chosen pin in the view, and three fields (**Rotation of the pin**, degrees, X then Y then Z) do the same by number; **Reset** puts it straight again. The gizmo with the angle fan turns with it. Saved as `rot` (a quaternion `[x, y, z, w]`) in the pin point; `Parts.js` turns the axis of the hinge by it (the angles are measured from the rest place of the part). Without `rot` nothing changes.

### A door: opens at one force, falls off at a higher one

Every pin point has two forces (kN; 1 kN is about 102 kg of force):

* **Opens at** (`activate_force`): the part sits shut until the load on this pin passes it, then it swings on the hinge of the pin (axis, rotation, angles). Without it the part opens at the default latch of 3 g of the part (`hinge.latch_force` still sets that for the whole part, and 0 is open from the start).
* **Breaks off at** (`break_force`, higher): when the load on the pin passes it the pin is gone; with no pin left the whole object is a free rigid body, which falls, bounces and **hits the car and the road** (after 0.35 s, so that it does not start inside the car). The editor warns when this is not higher than "opens at".

The load on a pin is the largest of: the force in the link beam of the pin (a part with nodes of its own: the hits on its deformation nodes come through that beam), the force of the shell on the node of the body that the pin hangs on, and the inertia of the part (mass times acceleration) shared over the pins that hold. So a door that is hit on its side nodes opens at the force that gets to the pin, and an object that is only shaken opens at its mass times the acceleration. The **deformation nodes** (the nodes of the part) bend and tear at their own strength, set for all of them with one number.

Tested with a door of 10 kg: at 30 and 60 km/h against a wall it stayed shut with the pin at 20 kN; at 130 km/h it opened and hung on its hinge (breaks off at 200 kN); with opens at 1 kN and breaks off at 5 kN it opened, the pin tore, and it flew off as a free body that came to rest on the road with collision with the car on. Note that a door of 10 kg only loads a pin with about 18 kN at 130 km/h on its own inertia: use lower forces for the pin, or hit the door on the side.

### The crash test: the camera follows, the test buttons make room

The car drives straight ahead from its start point and only the wall is added (6.6 m ahead of the middle of the car). The **camera follows the car** during the test, and is **put back where it was** when the test is stopped or the car is repaired. While the test runs the **test buttons are hidden** and a **Stop crash test** button sits in their place: it takes the wall away, puts the car back at its start and brings the test buttons back (also after Repair or when the bench stops).

The camera is put back by `stopCrash()` itself, so it goes back however the test ends: Stop crash test, Repair, a restart of the bench (a change in the part window) or a new test.
