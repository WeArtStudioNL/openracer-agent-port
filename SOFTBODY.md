# Soft body, parts and hinges: design

Branch `claude/soft-body`. Status: M1 to M4 built (M4: cars that dent each other, replay of the shell, the parts and the wheels, in the saved file too). Nothing here is released.

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
* **M4** both cars dent in a crash between two, replay (the displacements, the parts and the wheels are recorded), the saved file. *(built, see the end)*

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
* **Crash test**: a speed (10 to 150 km/h) and an angle of the wall; the car drives straight ahead from its start point into a wall on a 3D ground (only the wall is added, 19.8 m ahead of the middle of the car), the camera follows, and the card shows the peak deceleration, the bend, the energy that the shell took up, the torn anchors and beams and the part events. **Repair** puts everything back.
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

The car drives straight ahead from its start point and only the wall is added (19.8 m ahead of the middle of the car). The **camera follows the car** during the test, and is **put back where it was** when the test is stopped or the car is repaired. While the test runs the **test buttons are hidden** and a **Stop crash test** button sits in their place: it does what the **Stop test** button of the test buttons does: the wall goes, the test bench stops and the editor is back at the model as it is, with the test buttons back (they also come back after Repair).

The camera is put back by `stopCrash()` itself, so it goes back however the test ends: Stop crash test, Repair, a restart of the bench (a change in the part window) or a new test.

### The car accelerates with its own throttle

The car in the crash test no longer starts at the speed of the test: it starts from rest and accelerates with the throttle of the normal physics (full throttle until near the speed, then just enough to hold it; off at the hit). The wall is far enough for that: `max(19.8 m, 2.6 m + v² / 5)` ahead of the middle of the car (55 m for 60 km/h, 260 m for 130 km/h). The card says "Accelerating to …" and the peak g counts from the hit on.

### The angle fan shows where the part goes

The fan of the pin gizmo is swept from the direction in which the part itself lies from the pin (the middle of the part, projected on the plane of the axis), and not from a fixed axis of the car: it used to start from a fixed direction, so for a door that lay on the other side of the hinge it showed the mirror image of how the door moves. The angle is **right-handed about the axis** (checked against the joint of the engine: a part that lies along +x from a pin with the axis +Y goes towards -z at a positive angle), the white line is the rest place (angle 0). So a negative angle is the other way round than a positive one: with the thumb along the axis, positive is the way the fingers curl.

### The shell stays stable: the step follows the stiffest place

A door with many nodes close together dented by itself a few metres before the wall at 20 km/h (the shell only starts to be worked out when a wall is near, and then the door cluster blew up: 4.6e8 J of "plastic work" in a test of the shell alone). The cause is the explicit integration of springs and dampers: with a step of 1 ms a node with ten beams and a contact has a damper that is too strong for its mass of 2 kg. `SoftBody.js` now works out the biggest safe step (`safeStep`: for every node the stiffness and the damping of its anchor, its contacts and twice those of its beams, and a fraction of what each allows), and takes as many sub-steps as needed (3 to 14 per step of the physics; for the car of the example 0.146 ms is safe, so 14). Run on its own for 4000 steps at 0.5, 1, 2, 3 and 6 ms the shell stays at 0 displacement; before, at 3 ms it blew up. In the crash test at 20 km/h the door stays at 0 until the end. The step is recomputed when a link beam is added (`addBeam`). In the crash test a hit now also counts when it only bends the shell a little (5 mm), so the throttle goes off.

### Apply force on a door dents the door; Repair puts a door back exactly

* **The cube hits what it was fired at.** A cube fired at a part that has nodes of its own (a door) pushes only on those nodes (`pushPlate(..., group)`); anything else pushes on the nodes of the body, which have no part. Before, it pushed on every node under its face, so a hard blow went through the door into the body behind it and the whole front dented while the door hardly moved. On the example car with a cube of 100 kg: a push of 1000 kg (11 km/h) leaves a springy door at 0 cm, 10 000 kg (106 km/h) dents the door 26 cm and the body 0.1 cm.
* **Repair put a door back a little wrong.** Moving an object to the scene (`attach`) changes its position, turn and size, and three.js builds the matrix from those again when the object updates itself, so putting the old matrix back was not enough (the door was 24 cm too low after the first repair, which looked like a door that was still ajar, and a ray no longer hit it). `Parts.js` keeps position, quaternion and scale of every part (`userData.partHome`, `restoreHome`) and gives them back on Repair and when a model is used again. Checked three rounds of hit, hinge, Repair: the door has the matrix of its home every time.

### The test buttons have tabs; the full test ends in a wall

* The test buttons (bottom of the view) have two tabs: **Tests** (play, rev, drop car, drive, full test, stop test) and **Crash test** (speed, angle, **Crash into the wall**). The Soft body card keeps **Repair** and the **Apply force** fields. The **Shake test** is gone (the button, its three sliders and its stage of the full test).
* The **full test** now ends with a wall of its own: after the steering stage a wall is put 100 m ahead (the same wall and 3D ground as the crash test, but its own run, separate from the crash test tab), the car gets full throttle until it hits it, is held on the brake and is still, and the test ends (the camera follows the car during that stage).
* **The car is steered at the wall**, in the crash test and in the full test: a car at 100 km/h pulled to the left by the torque of its engine and missed the wall. `steerAhead` keeps it on its line like a driver: the steering angle follows how far it heads off the line (the heading of its velocity) and how far it is off it, gentler at speed, up to 0.2 rad. After the hit the wheels are straight and the **brake is on**, so the car does not roll back from the wall (it rolled 100 m back and the full test never ended). Mustang at 100 km/h: at most 0.55 m off the line, at the wall within 0.1 m, then still at the wall.

### Turning a pin about its own axis moves the zero of the angles

Turning a pin about the axis of its hinge changed nothing in the view (the fan was swept from the direction of the part, so it always started at the part). Now the rotation of a pin is split in a **swing** (the tilt of the axis) and a **twist** (the turn about the axis): the swing is what turns the axis, the twist moves the **zero of the angles** against the part. The fan starts at the zero of the pin (the white line), the part lies where it lies (the yellow line), and the range of the hinge in the engine is `[min + twist, max + twist]` measured from the rest place of the part (`Parts.js`: `tau = 2 * atan2(q·axis, q.w)`). So the fan, the arcs and the real movement of the door agree, and turning the pin about its axis shifts the range. The window warns when the closed part lies outside min and max (it would be pushed into the range at the start). **Reset** (no rotation) is the old way: zero at the part.

A pin with several axes (a ball) keeps the old drawing; its angles are not enforced anyway.

### The Crash test tab has two rows; no Repair button

The **Crash test** tab of the test buttons has two rows: the crash test (speed, angle, **Crash into the wall**) and, under it, **Apply force** (push in kg, mass and side of the cube, the button). The Soft body card only keeps the line with the results of the crash test and of the cube. The **Repair** button is gone: **Stop crash test** (the Stop test button) goes back to the model, and the next test starts with a new car.

### Parts that fall off hit the wall and the ground

A part that comes loose is a rigid body in the engine that hits the track (the road and the walls: the triangles of the 3D ground near it, also the wall of the crash test) and the car. It went through the wall in the crash test: a thin plate that leaves the car at 28 m/s moves half a metre between two steps and was behind the wall before the engine saw it. Now every part has **continuous collision detection** (`setCcdEnabled`), its box is at least 8 cm thick when its model is flat (the hull of a flat plate does not exist), and the engine takes **two steps of half the time** per frame. Tested with the front licence plate at a crash on 100 km/h: it broke off at the wall and stayed in front of it (3 m before the wall, on the road).

### Stop test is an icon

**Stop test** is a small button with a turning-back arrow (↺) at the top right of the test buttons, in both tabs (it shows when the test bench runs).

### The camera of the crash test is fixed to the car

The camera no longer follows with smoothing: it moves by exactly the movement of the car (so it keeps its distance and its angle) until the car hits the wall; then it lets go and stays where it is. The full test does the same in its wall stage. Measured at 60 km/h: the offset between camera and car stayed 7.31 m / -7.32 m (z / x) for the whole drive, and after the hit the camera stayed at z = 63.1 while the car bounced back.

### The crash test shows the car, the wall and the stop button, nothing else

While the crash test runs the whole interface is hidden but the **Stop crash test** button: the side bars, the toggles, the text and the messages, the part window, the test buttons, the nodes and beams of the shell, the gizmos, the markers of the cameras, the axes, the arrow of the model and the floor grid of the editor. What is left is the car, the wall (10% opaque) and the button. Everything comes back when the test is stopped (`document.body.classList` "crashing", `crashUi`).

### The nodes of a part that opens stay for 0.3 s

When a part with nodes of its own opened (it was loaded past its "opens at"), its nodes left the shell at once. A car whose nose is made of the nodes of the hood, the bumper and the licence plate (opens at 20, 5 and 5 kN) therefore hit the wall with nothing to take the hit: the nodes were gone before they had moved, the shell did not bend (0.001 m, 0 J taken up) and the car bounced off the wall as a rigid body. Now the nodes of a part go on 0.3 s after it opens (`part.detachTimer`), so they take the hit and bend, and then they go with the part, with the dents they have. Mustang at 60 km/h after the change: the body 7.9 cm, the bumper 1.9 cm, 15 kJ taken up, the hood, the bumper and the plate open.

### Selecting parts: nothing, the body, and the right objects

* **A click on nothing (or on the body) lets go of the part**: the part window closes and the outline goes (not while a pin or the nodes are being added).
* **What is loose is told by the footprint**, not by the number of triangles. The test was "this object has less than 40% of the triangles of the model", and in a model where the engine has 550 000 triangles and the body 6 800 that was wrong: once the test bench had started (its model has no wheels, so its totals are different) the scene that holds all counted as loose, and a click on the plate or the bumper selected "Scene". Now an object whose width times length is 45% or more of that of the model (the body, and the scene) is not loose, and what the suspension rig moves (`rig-…`, `susp_…`, `brake_caliper…`), the wheels and the steering wheel are not either.
* **No gizmo of the pin while nodes are added**: the rings and the fan of the pin are away in that mode (they were in the way) and come back when it stops.

### More grip for the run of the crash test

At a high speed the car slid sideways under the torque of its engine and missed the wall (at 140 km/h it ended 14.9 m off its line and never hit). For the run of the crash test (and the wall stage of the full test) the tyres have **three times the grip** of the road (`bench.gripBoost`, `bench.grip`: the grip function of the bench multiplies the road by it); it is put back to 1 when the test stops. With the steering that keeps the car on its line (`steerAhead`) the car now drives straight: at 140 km/h at most 1.47 m off its line and 0.16 m off the middle of the wall at the hit, 204 g, 45 cm of bend, 142 kJ taken up, 130 km/h in 3 s. The factor is a property of the bench (`benchState.gripBoost`), 1 gives the plain tyres back.

### The floor of the crash test reaches past the wall

The floor of the test was a square of 600 m (300 m each way from the start), and the wall is 350 m away at 150 km/h (`2.6 + v²/5`): the car drove off the edge of the floor just before the wall and fell. The floor is now made of tiles of 100 m (the grid of the ground refuses a triangle that is too big, so one big floor would not do) from 150 m behind the start to 150 m behind the wall, 300 m wide. Mustang at 150 km/h: the height stayed between 0.25 and 0.56 m the whole way, it hit the wall at 348.3 m (the wall at 349.8 m) with 252 g and 43 cm of bend.

### Adding deformation nodes: the other objects fade and are clicked through

While nodes are added to a part, every other object (the body, the other parts, the engine, the wheels) gets a see-through copy of its material (10% opacity, no depth write), so the part can be seen, and a click goes through all of them and only hits the part that is open (a click on another object does nothing but say so). The own materials come back when the mode stops (Esc, the button, or closing the window). On a copy of the Mustang: with the hood open, a click on the door left the nodes at 182, a click on the hood made it 183; after Esc the faded copies were gone.

### Hinge part or breakable only

The part window offers two ways to make a part: **Hinge part** (pin points, nodes of its own, opens and breaks off, as before) and **Breakable only** (`"mode": "detachable"`): a mirror, a headlight, a plate. A breakable part has no pins and no nodes of its own: it **bends with the body** and, when the load on it passes **Breaks off at** (kN, default 3), it comes off and falls as a free object that hits the car, the road and the walls. It goes on bending for a **delay** (`break_delay`, seconds, 0.15 by default, a field in the window) after the force has been passed, and only then comes off, so the dent is made first (measured: the timer started and the part was free 154 ms later). A breakable part sits in `car.json` as `{ "object", "mode": "detachable", "mass", "break_force", "break_delay" }`.

### The outline: one at a time, and none left behind

The outline that shows an object could stay on an object that was no longer selected (when the test bench started or stopped, the outlines of the old copy of the model were not switched off). There is one outline at a time now: the object under the mouse, or, when the mouse is on nothing or leaves the view, the part that is open; every outline that was made is in a list and all but the wanted one are switched off, and when the bench stops none is left. Checked: hood open, hover on the door, on the headlight, leave the view (back to the hood), select the door, stop test: one outline at a time, 0 after the stop.

### The camera does not jump when the crash test starts

When the bars go the view gets wider (510 to 1200 px) and the picture was centred again, so the car jumped on the screen. The camera now shows a part of a wider picture (`camera.setViewOffset`) that is centred on the middle of the view as it was (`viewLock`), so what was on the screen stays where it is: the car stayed on the same horizontal place on the screen (689 px) when the test started, and `setViewOffset` is cleared when the test stops. The vertical place changed by 24 px (the car is put at its ride height at the start of the test).

### A part that comes off keeps the dent it had

The grille, the headlights and the plate fell off but were not bent: the moment a part without nodes of its own came off, its model went back to its own shape (`uDeform = 0`), so it flew off as good as new, and a part that opens at its first contact (a low "opens at") came off before the shell had bent at all. Now:

* **It keeps the bend that it has.** `SoftBodyMesh.release` takes a copy of the displacements of the nodes at that moment and gives that to the meshes of the part (`userData.sbUniform`, the shader takes it instead of the live displacements); the part stays as bent as it was and does not follow the shell any more. Repair gives it the live displacements again (`unfreeze`). Measured at 60 km/h on a copy of the Mustang: the vertices of the right headlight moved up to 28 cm, the left one 30 cm, the grille 36 cm and the plate 33 cm in the copy that they took with them (before: 0).
* **A hinge part also waits for its delay before it opens** (`openSoon`, the same `break_delay`, 0.15 s): it bends with the body for that moment and then swings, as a breakable part does before it comes off.

### Nodes do not stand on the road with the wheels

A layout made by the scan has nodes with a radius up to 0.3 m on the surface of the model, and a node low in the car (y = -0.25, radius 0.25) reached down to the level of the tyres (-0.499 m from the centre of gravity, where the road is). It was in soft contact with the road all the time (`softContacts` 1 at rest, 5 to 8 when standing against a wall), so the car rode on its nodes as well as on its wheels and could hover over bumps and crests with its wheels hardly loaded. `CollisionProxy.apply` now cuts the radius of a node of the layout to what lies above the underside of the car (the ground clearance, -0.37 m): the lowest node bottom is -0.37 m, and on the test track the car stands with `softContacts` 0 at rest. (Not reproduced as hovering in the air: standing on the road at the start, driving over the ramp and against the wall of the test track, the body stayed 0.5 m above the road and the four wheels on it.)

### Damping and top speeds for loose parts

A hinge that flew open at the speed of a crash, or a part that a hit threw, moved so fast that the joint and the walls could not keep up: it jittered or shot away. A part that has come loose now has:

* **damping**: a hinged part an angular damping of 2.0 and a linear damping of 0.2, a free part 0.4 and 0.05 (`damping` in the spec of the part sets the angular damping);
* **a top speed** that is kept after every step of the engine (two a frame): a hinged part spins at 12 rad/s at most and a free part at 30 (`max_spin` in the spec), and its speed does not exceed that of the car plus 12 m/s (plus 20 m/s more for a free part).

Mustang at 100 km/h (the car at 27.8 m/s): the hood on its hinge spun 2.8 rad/s at most, the plates and the headlights that flew off 12 to 27 rad/s, and no part went faster than 4 m/s against the car.

### The game no longer stutters on a bump or a ramp

On a bump, a jump or a ramp there are many triangles near the car that are not flat (the ramp itself), so the shell is worked out in full, and every one of its small steps (up to 14, see the step that follows the stiffest place) went through all those triangles for every node. `Vehicle.js` now finds, once per step of the physics, the triangles that each node can touch (`buildNodeTriangles`: within the radius of the node plus 0.2 m; the car does not move while the shell takes its small steps and a node moves a few centimetres at most), and the small steps only test those. On the test track with the Mustang of the example (195 nodes), driving up the ramp: the physics took 1.35 ms a step on average before (95% under 6.6 ms, at worst 13.4 ms) and 0.55 ms after (95% under 1.6 ms, at worst 2.4 ms). The crash test is the same as before (100 km/h: 38 cm of bend, 67 g, the parts come off).

## Loose parts and the car, and damage to the wheels

**Loose parts hit the car when they are clear of it.** A part that comes loose (or a hinged part that opens) has no contact with the car for 0.35 s;
after that it hits the car as soon as it does not overlap it (`clearOfCar` in `Parts.js`). A part that is inside the car, or touches it like a
door that is shut, used to be pushed out at a great speed when the contact started (a bumper flew off through the road). Now it waits until it is
clear (at most 3 s; then it stays a ghost to the car, but not to the road). The wheels are part of the car for the parts (balls of the size of the
tyre). A hinged part does not hit the car (the contact fights the joint: at a crash of 150 km/h the hood jittered at its top spin); it hits it when it tears off.

**Wheels.** A hit of a wheel on a wall (the hard contacts of the wheel spheres, `Vehicle.js`) adds damage: the impulse (N s) divided by
`softbody.wheel_strength` (kN s, default 25, 0 = the wheels never break; the field "wheel strength" of the Soft body card). Damage 0..1 bends
the suspension: the wheel points aside (toe 0.09 rad and camber 0.12 rad at 1) so the car pulls to a side, and it grips up to 40 % less (the bend
is shown on the model). At 1 the wheel is torn off: `wheelLost`, no tyre force and no spring on that corner, and `Parts.js` makes the wheel a
rigid body (a cylinder) that keeps the speed and the spin it had, rolls away, hits the road and the car, and is put back by Repair. In the crash
test with the Mustang: 60 km/h at a wall of 40 degrees bends the front wheel by 27 %, 80 km/h by 80 %, 110 km/h tears it off.

## The suspension as part of the beam network (design, and a first trial on the front wheels)

**What a good model is.** The cars of BeamNG (and the node-beam engines like the one in the Unity video) have no rigid body under the shell: the whole
car, the chassis, the arms, the hubs, the engine, is nodes and beams, and a hit goes through all of it. Ours has a rigid body (`Vehicle.js`, which
does the driving) and a shell of nodes on springs (anchors) on it, so a hit bends the shell and the body feels the peak through the anchors. That is
right for a dent and for the load on a part, but the suspension was outside it: a wheel that hit a wall got a damage number (`wheelStrength`).

**The target.** The suspension and the steering in the network: per wheel a hub, a lower arm and an upper arm (two beams each, to the chassis), a tie
rod to the rack (so the toe follows the steering), a spring-damper that is the real spring of `Vehicle.js`. A hit on the wheel then loads the
beams: an arm yields (the camber and the toe change for good), the tie rod yields (toe), a mount tears off (the wheel hangs, or comes off). The
alignment of the wheel (toe, camber, place) is worked out from where the nodes are, and the tyre force of `Wheel.js` uses that, so a car with a bent arm
pulls to a side as the real one. A more stable solver (impulses, backward Euler for the stiff beams, as in the video) lets the beams of the
suspension be as stiff as they are in the car, without the 14 steps of the explicit scheme.

**The steps.**
1. (done, below) A hub node per front wheel, in the shell: a hit bends it, its place gives the toe, the camber and the place of the wheel.
2. Arms and tie rod: more nodes and beams around the hub, so the way it bends (an arm, the tie rod) decides the toe and the camber, not one factor.
3. The rear wheels the same, and the springs and dampers as beams that carry the load of the body (the spring of `Vehicle.js` becomes a beam).
4. A solver of impulses for the suspension beams (the stiff ones), the shell stays as it is.
5. The rest: both cars dent in a crash between two (M4), replay of the shell and the parts.

**The first trial (step 1; replaced by the rig below).** The front wheels do not have a collision sphere of their own any more (the `wheel` sphere of `CollisionProxy.js`): the
sphere is a node of the shell, the hub (`hub: true` in the list of spheres, nodes 195 and 196 on the Mustang), with an anchor (yield 20 kN, break
100 kN, 25 kg, `softbody.hub_yield`, `hub_break`) and the beams to the shell around it that every node gets. `Vehicle.updateHubs()` reads where the hub is
now against where it was made: the place of the wheel on the car shifts with it (`shiftX`, `shiftZ` on the mount), the toe is 0.5 rad per metre that
the hub went back (at most 0.2) and the camber 1 rad per metre that it went in, with a loss of grip of up to 40%. A hub that has moved 0.3 m
(`softbody.hub_limit`) has taken the wheel with it: the anchor is released, the wheel comes off as a rigid body (`Parts.js`, as before). The rear wheels keep
the damage as a number (`wheel_strength`); `"wheel_hubs": false` keeps all of them so.

In the crash test of the Mustang, against a wall of 40 degrees: 70 km/h puts the front-right hub back 4 cm (toe 1.3 degrees), 90 km/h 19 cm (toe 5
degrees, 62% damage), 110 km/h tears the wheel off; head-on at 110 km/h the wheels are not touched (1 cm), as the wheels are behind the nose. What this
does not do yet: the hub has no arms, so the bend is one displacement turned into toe and camber with factors, not what the arms do; and it is
a node among the shell nodes, so the model of the car around the wheel arch is pulled along with it (the vertices tied to that node).

### The rig: steps 2 and 3, for all four wheels

Every wheel has a suspension of nodes and beams (`CollisionProxy.js` makes the spheres, then the beams after the shell; the nodes come last in the
list and are not part of the model: `SoftBody.bodyCount` is the number of nodes of the car, `SoftBodyMesh`, `Parts` and the car editor only see those):

- **The knuckle**: the hub `H` (the collision sphere of the wheel, 18 kg) and three more nodes, the ball joint above `Ub`, the one below `Lb` and the
  end of the tie rod `Te` (6 kg), joined by six stiff beams (it turns, it does not bend).
- **The pivots on the car** (10 kg, a stiff anchor): two for the upper arm (`U1`, `U2`), two for the lower arm (`L1`, `L2`) and one for the tie rod (`R`).
- **The beams that bend**: the two beams of the upper arm (to `Ub`), the two of the lower arm (to `Lb`) and the tie rod (`R` to `Te`). Each is elastic
  up to its yield force, bends for good above it and tears at its break force (arms 14 and 36 kN, tie rod 12 and 36 kN;
  `softbody.arm_yield`, `arm_break`, `tie_yield`, `tie_break`). The hub and the knuckle have almost no anchor of their own (`setNode`, `anchorScale`),
  so what holds a wheel are its arms.

`Vehicle.updateHubs()` reads the wheel from where the nodes are: the **camber** is how far the line from `Lb` to `Ub` has leaned against how it was
made, the **toe** how far the line from the hub to `Te` has turned, and the hub gives the **place** of the wheel (`shiftX`, `shiftZ`, on the mount, so the
track and the wheelbase change). Toe and camber go into the tyre forces and into the model of the wheel; a bent wheel also grips up to 40% less. The wheel is
**off** when both beams of an arm are torn, or the hub has moved 0.3 m (`hub_limit`); it then flies off as a rigid body (`Parts.js`) as before. A tie rod
that is torn leaves the toe where it was. `"wheel_hubs": false` gives the old number (`wheel_strength`) for all the wheels.

The crash test of the Mustang, front-right wheel, against a wall of 40 degrees: 75 km/h nothing, 90 km/h toe 6 degrees (56%), 110 km/h toe 20 degrees,
130 km/h the wheel is off; head-on at 100 km/h the wheels are not touched. The step of the shell (physics 0.6 ms on average) did not grow
noticeably with the 36 nodes and 98 beams of the four suspensions.

**What is left of the design.** The spring and the damper are still the ones of `Vehicle.js` (a beam in the network would make the
body feel the load of the road through the same beams, and that needs the solver below to be stable). The solver is still explicit with 3 to 14 steps: the
suspension beams are stiff, and a solver of impulses (as the video says) would let them be as stiff as in the real car with fewer steps. (Both cars dent in a
crash between two, and the replay of the shell and the parts: done, see M4 below.)

## M4: two cars that dent each other, and the replay of the soft body

### Two cars (`Vehicle.js`, `Opponent.js`)

* **How it works.** `OpenRacer.collideCars` (once a frame) gives every car that has a soft body the list of the other cars (`vehicle.otherCars`; a car without
  a soft body gets an empty list and costs nothing). In its step (`shellStep`) a car looks at the others that are within the sum of their bounding radii
  (+ 0.6 m): `buildCarPairs` takes the place and the speed of every collision sphere of those cars (`vehicle.sphereWorld(i, out, o)`: where the node of that
  sphere is now, bent or not; a torn node or a wheel that is off is not there), puts them in a cache, and finds for every node of this car the spheres that it can
  touch (once per step of the physics, like `buildNodeTriangles`). The small steps of the shell then only test those pairs (`carContactsOfNode`): a penalty
  spring with a damper along the line between the centres, with friction from the relative speed, as the wall contact. A node has one contact stiffness: it is
  shared over the spheres that it touches.
* **Both cars do the same sum for their own nodes** against the spheres of the other, so the two forces are equal and opposite without one car handing a force to
  the other (no latency, no order of the cars). The reaction goes to the body through the anchors, as for a wall, so the peak is limited by what yields and the
  energy goes into the plastic work. Loose parts feel it through their nodes and the load on their mounts (a hood, a headlight, a plate comes off as in a wall crash).
* **The discs of `collideCars`** (two per car) are kept as a backstop for a hit that goes through the shell, but only a smaller one (0.35 m less) when both cars
  have a soft body and the 3D physics; before, they kept the cars a bumper apart and the shells never touched. A soft car against a car without a soft body, or
  on a 2D track, is as before.
* Debugging: `vehicle.carContacts` (pairs that touch in the last step) and `vehicle.carHit` (the biggest force on a node, N).
* Also fixed: `Opponent.updateVisuals` used `delta` (the parts) without having it, so an AI car with parts threw an error in every frame.
* **Tested** (Playwright, the game stepped by hand, two Mustangs on the test track): an AI car at 18 m/s into the rear of a car that rolls back at 2.5 m/s: the
  front of the AI car bends 7.2 cm and takes up 20.6 kJ, the other car's rear gives 8 cm elastically (the peak force is 183 kN against 83 kN: the nose has more
  nodes than the rear), the speeds after are 1.5 and 8.6 m/s, the hood opens and the lamps, grille and bumper come off; head-on at 19 m/s against a car that
  stands: the AI car's shell goes 0.49 m in, the other 0.03 m, the car that stood is pushed back at 9 m/s. The physics step costs about 8 ms instead of 3.6 ms in
  headless Chrome while the cars are in contact (cars more than a few metres apart cost nothing extra). Not done: a loose part of one car that hits the other car (the engine
  of the parts only knows the car it belongs to), the wheels of the other car do not feel the hit (the spheres of a wheel push, they take nothing).

### The replay (`Replay.js`, `Parts.js`, `SoftBody.js`)

* **What is recorded.** Next to the samples (30 a second, as before) a car that has a soft body keeps a list of **records**, and a record is only made when
  something in it changed, so a car that drives without a hit makes none (a car without a soft body makes no list at all). A record has: the sample number; the
  displacements of the nodes of the shell that the model uses (`bodyCount`, 16 bits each, in 1/1024 m); for every part of `Parts.js` its state (0 held,
  1 hinged, 2 free) and, when it is not held, the place of its object in the scene (position, turn, size: 11 numbers); for every wheel whether it is torn off and
  its toe, camber and shift (rounded to 0.5 mm, or the bend of a wheel at rest would make a record in every sample). The oldest records go with the oldest
  blocks of samples (`trimSoft`; one record before the start is kept as the state at the start).
* **Playback.** `showSoft` looks up the record at the time (the last one at or before it) and interpolates to the next when that is at most two samples away
  (the shell, and the parts that are loose in both: position, size and the turn along the shortest way); in between records the state is held. The shell
  goes into `softBody.displacement` (the model reads it as in the game, `SoftBody.syncDisplacement()` puts the real ones back afterwards), the wheels get their
  bend and `wheelLost`, and `Parts.replay.replayApply` puts every part where it was: a part that is loose in the record leaves the model (`awayFromModel`: into the
  scene, with the dent that the shell had **when it came off**: `frozenShell` takes the first record of its loose run), a part that is held again (scrubbing back)
  returns to its place on the model with `restoreHome` and follows the shell again. The engine of the parts (`Parts.update`) does not run while a replay is shown
  (`replayBegin`, also for a car that is built while the replay is open: the viewer of a file), and `replayEnd` puts every part back where the game has it, so
  that the game goes on where it was left.
* **The file.** Version 2 (`FILE_VERSION`): the header has `soft` per car (`null`, or `{ nodes, parts: [names], count }`) and `softBytes`; the records follow the
  numbers as a block of bytes (little endian: sample u32, displacements i16 padded to four bytes, the parts, the wheels). A version 1 file is still opened (no
  soft body in it). The reader checks: the sizes against the header (the block must be exactly the size that the header says), the number of nodes (at most
  400), of parts (at most 64) and of records, the order of the samples (rising, inside the recording), every number finite, and every state 0, 1 or 2; anything else
  is "damaged". On playback a car whose number of nodes or names of parts are not those of the file (the car was changed) shows no soft body, and the rest of the
  replay is as before.
* **Tested** (Playwright, the game stepped by hand, a head-on crash of two Mustangs, 70 times compared): for every moment the displacement of the shell (within 4 mm), the
  parts that are away and where the hood and a lamp are (the same to 0.01 m) are those of the live game, before and after the hit and when going back and forth;
  after `stop` the live state is as it was (the same displacements, the same states of the parts); a wheel that is torn off and one that is bent come back in the replay
  and are put back at the end; the saved file (98 KB, gzip) opened in the viewer (`?replay=1`) after being stashed shows no dent at 1 s, and at the end the dent,
  and the parts that were loose, with at most 0.5 mm difference to the live shell. Not tested: a file that was made on purpose to be wrong (the checks are in the code
  and follow the older ones), the editor's crash test in a full run (started in headless Chrome, which draws less than a frame a second).

