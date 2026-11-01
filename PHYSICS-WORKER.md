# Physics in a Web Worker

A study (1 November 2026) of moving the physics of the cars out of the main thread, so that the game has more room for physics on
Windows, macOS, Android and iOS. Nothing in the game is changed yet; this is the plan and what it is based on.

## What a worker does and does not do

A worker does not make the physics cheaper: the same code does the same work, a little more in all (the state is copied across).
What it does is take the physics off the main thread, which now does everything one after the other: the input, the physics of
every car, the effects, the sound, the HUD and the drawing. With the physics on other cores the main thread only draws, and the
cars can be stepped side by side (two workers do two cars at the same time). The frame then lasts as long as the slowest of them,
not as long as all of them together. So the gain is in frames per second and in physics that fits in a frame (no slow motion,
`simLimit` in main.js), not in less CPU over all.

## Where the time goes now

Measured in the game (r187, preset "low", a Mac with 10 cores), per frame of 1/60 s of game time:

| Situation | Physics and game (`onEnterFrame`) | Drawing (`composer.render`) |
|---|---|---|
| Muscle alone, Netherlands 1 | about 2 ms | about 2.5 ms |
| Muscle and 5 AI cars, Short track | player 6.8 ms, the 5 AI cars 4.7 ms | about 4 ms |

With AI cars the physics is about three quarters of the main thread. A phone does the same work three to five times slower (an
estimate, not measured): 35 to 60 ms of physics a frame, which is where the game now falls back to slow motion.

## The proof of concept

Run from the console of the game (not in the repository):

* A classic worker loads `Engine.js`, `Wheel.js`, `TyreShell.js`, `SoftBody.js`, `Ground.js`, `Motorcycle.js` and `Vehicle.js`
  unchanged with `importScripts`. It needs a six-line `THREE.Vector3` (only `set` and `copy`, for `Wheel.position` and
  `Wheel.velocity`) and `getSurface` with its tables (Helpers.js). `OpenRacer.vehicleParams(config)` crosses as it is: its only
  function is `getSurface`.
* The same car (the Muscle with four shell tyres, flat ground, 600 steps of 1/60 s) gives the same speed and place in the worker as
  on the main thread (to 1e-6), in the same time (8.4 ms against 8.8 ms a step).
* Sending a snapshot of 60 KB (six cars with a soft body and the tables of their tyres) to a worker and back, with the buffer
  transferred: under 0.1 ms. Copying it into the objects of the main thread: about 1 µs.
* Six such cars, a frame of 1/60 s each:

  | Where | ms a frame |
  |---|---|
  | main thread | 53.4 |
  | 1 worker | 47.3 |
  | 2 workers (3 cars each) | 26.7 |
  | 3 workers | 21.4 |
  | 6 workers | 18.6 |

## What the physics depends on

The core is free of the scene: `Vehicle.js`, `TyreShell.js`, `SoftBody.js`, `Engine.js` and `Ground.js` (GroundWorld: typed arrays
and a grid, built from the track at load) use no three.js objects, no DOM and no Settings. What ties it to the main thread:

* **The input is the Car itself** (`vehicle.input`, Car.js:141). The automatic gearbox writes back into it (`current_gear`,
  Vehicle.js:917, 984-990).
* **Wheel.js** keeps `position` and `velocity` as `THREE.Vector3`.
* **getSurface** (Helpers.js:120) reads the globals `groundWet` and `groundSnow` (Atmosphere), and Atmosphere writes
  `wheel.localSnow` and `localWater`.
* **Motorcycle.js** reads `Settings.option` in its step (164, 201, 225).
* **Parts.js** (a Rapier world per car with parts) is stepped from `updateVisuals` (Car.js:572), reads the soft body and writes
  `v.partForces` for the next step and the matrices of the parts in the scene.
* **RigidObjects.js** (the props of the track, one Rapier world) builds meshes and writes their position.
* **Between the cars**: the shell contacts read the other cars live (`buildCarPairs`, Vehicle.js:1456), `collideCars`
  (Opponent.js:693) writes their speeds after all have stepped, and the AI reads where the player is.
* **Math.random** (punctures in Vehicle.js, pops in Engine.js).

The ground does not need the scene either: there are no rays against meshes while driving, only the triangle grid of Ground.js.
Its results carry the name of the surface and of the mesh, not the mesh.

## What reads the physics

Everything that reads the physics reads fields of `car.vehicle` and its wheels after the step, in the same frame: the body and the
wheels (`getBodyPose`, `center`, `spin`, `steerNow`), the soft body (`displacement`, a Float32Array of 3 floats a node) and the tyres
(`deformation()`, rings × 72), the cameras, skid marks, smoke, marbles, debris, the sound (rpm, squeal, impacts, pops), the HUD,
force feedback (`fy`, slip, `impactTime`), lap and gate timing, the drag strip, the pit stop, the replay (30 Hz) and the ghost. A
replay does not run the physics: it writes the recorded fields into the same vehicle objects.

## The plan

The main idea: the main thread keeps a **view** of every car, an object with the same fields as the vehicle (`px`, `qx`, `u`,
`wheels[i].center`, `hasContact`, `surface`, `slipTan`, ...), filled from the snapshot the worker sends. Everything that reads the
physics now reads the view and is not changed; the replay writes into the view, as it now writes into the vehicle. The car editor,
the soft body editor and `tools/physics-check.html` keep the vehicle in their own thread: it is the same code.

### Step 1: make the physics portable (no change in the game) — done

* **Surfaces.js**: `getSurface`, `uCoeff`, the ground condition (`setGroundCondition`) and `gravity`, out of Helpers.js. Loaded first
  in the game, and in the worker.
* **Wheel.js** keeps `position` and `velocity` in an `OpenRacer.Vec3` (x, y, z with `set` and `copy`) instead of a `THREE.Vector3`.
  Vehicle.js no longer reads the global `gravity` (in its puncture check; the car editor has no Helpers.js, so that line would have
  thrown there).
* **Motorcycle.js** reads its three menu options through `controller.options` when it is set (a worker sets it; the game leaves it
  null and reads Settings as before). `OpenRacer.Motorcycle.OPTIONS` lists them.
* **Random numbers**: `vehicle.random` (and `engine.random`) for the punctures and the pops. With `parameters.seed` it is
  `OpenRacer.seededRandom(seed)`, the same numbers in any thread; without, `Math.random` as before.
* **Ground.js**: `exportData()` gives the whole GroundWorld as plain data (typed arrays, arrays, a Map) and
  `OpenRacer.GroundWorld.fromData(data)` makes the same world from it. The Short track: 186 885 triangles in the 3D grid, posted to a
  worker in about 0.1 s, once.
* **VehicleState.js**: `snapshot(vehicle)` gives every number, flag and string of the vehicle, its engine, its controller and its
  wheels (about 740 values for a car, 790 for a bike) in a Float64Array, the schema of names only when it changes, the displacement of
  the soft body when it moved, the deformation of the shell tyres and the bangs of the exhaust. `apply(view, snapshot)` writes them
  into a view with the same names. It takes every field rather than a list, so a field that a reader starts to use later is there
  too. `INPUT` lists what the physics reads of its input; it writes only `current_gear` back (an automatic shifts), and the
  snapshot carries that.
* **PhysicsWorker.js**: the worker itself (ground, condition, add, remove, step; snapshots back with their buffers transferred).
  The game does not use it yet.
* **tools/physics-worker-check.html**: steps the same cars in the page and in the worker and checks that every value is the same,
  every frame; then times the page, one worker and a worker per car. It is the page to open on a phone.

Checked: four cars (Muscle, Hatchback, Sports motorcycle 600cc, Stadium truck) drive the same 20 s script on the Short track with the
same numbers before and after these changes (a fixed `Math.random`), and give the same numbers in the page and in the worker, frame
by frame. The snapshot of the Muscle in the game (its soft body of 166 nodes and four shell tyres) is 13.6 KB, and a view made from it
gives every value back. The game, a bike and the test bench of the car editor run as before.

Measured in Chrome, in a tab in front, on the Mac with 10 cores (tools/physics-worker-check.html, the four cars, 5 s):

| Where | ms a frame of 1/60 s, the four cars |
|---|---|
| The page, one after the other | 92 |
| One worker | 120 |
| A worker per car, side by side | 45 |

One worker is slower than the page, but not because of the code: the Muscle alone, 150 steps, takes 9.7 to 10.1 ms at the fastest
in a worker and 9.8 to 12 ms in the page, while the middle of the worker's times went from 12 to 40 ms between runs. The ground copied
into the worker is not the cause either (the same copy on the main thread is as fast as the original). It is where the system runs
the worker: a thread that works for a moment and then waits for the page, frame after frame, is put on a slow core (macOS has
efficiency cores; phones have them too). So:

* the worker should be busy, not wait for the page: in step 2 it steps on its own clock and the page takes the newest snapshot,
  rather than a question and an answer every frame;
* the gain is to be measured in the game itself, on a Mac, a Windows PC, an iPhone and an Android phone, before the player's car
  moves (step 3).

### What step 2 and step 3 would win (measured before starting step 2)

The Muscle and 5 AI cars on the Short track, in the game, per frame of 1/60 s (the Mac, the in-app browser):

| | Physics (`vehicle.update`) | The rest of its update (driver AI, placing the model, soft body mesh, parts, smoke, marks) |
|---|---|---|
| The player's car (shell tyres, soft body of 166 nodes, 38 parts) | 6.5 ms | 0.4 ms |
| The 5 AI cars together (simple tyres, soft bodies of 57 to 211 nodes) | 1.3 ms | 2.0 ms (driving: 0.03 ms) |

The AI cars drive on the simple tyre, so their physics is cheap and most of their time is the drawing side, which stays on the main
thread. Step 2 takes about 1.3 ms off the main thread; step 3 takes about 6.5 ms off it. Step 3 is where the gain is.

### Step 2: the AI cars in a worker

The AI cars have the fewest readers (no HUD, no force feedback, no camera). A worker steps them and their driver (`Opponent.drive`
reads only positions) on its own clock, so that it stays busy (see the measurements above); the main thread sends the place of the
player when it has a new one and draws the AI cars from the newest snapshot. Contacts between the player and an AI car use the other car of one frame before. Gain: the 4.7 ms of five AI cars off the
main thread, and with two workers the AI cars side by side.

### Step 3, first version — built, behind `?worker=1`

* **PhysicsLink.js** (new): the player's car is stepped in PhysicsWorker.js; `car.vehicle` stays in the page as a view that every
  snapshot fills. Nothing that reads the car was changed.
  * What the page writes into the vehicle (the jacks, a hit of an AI car or a prop, the fuel, the options) is found by comparing the
    view with what the last snapshot left there (`VehicleState.changes`) and sent with the next step; the page keeps its own value
    until a snapshot knows it.
  * The methods the page calls (reset, retune, repair, puncture, impulse, start the engine; the shell's repair, settle and node
    grabber; `detachGroup` of the parts) run in the page and are sent; older snapshots are then not used.
  * Until the car has its model the page steps it; then the worker takes over the whole state (the setup calls, every value, the
    collision spheres, the rig, the shell from what it was made of plus its state). A new shell (the tuning menu builds the car again)
    is taken over again.
  * The shell's state comes back every step (`SoftBody.exportState` / `importState`), so the parts (Rapier, still in the page), the
    pit stop and the replay read a live shell. The shell tyres in the page are stubs that show the worker's deformation.
  * The worker steps when the last step came back; the time of the frames in between is added to the next step (at most 0.1 s).
* **Falls back to the page** when the worker fails, or when it needs more than 0.9 s of work for a second of driving for two
  seconds.
* **The delay**: a brake at frame 3 slows the car from frame 3 in the page and from frame 4 with the worker (the Muscle at 93 km/h):
  one frame, as planned.
* **Nudges keep the snapshots**: the node grabber of the debug view calls `moveGrab` every frame, and every call threw the older
  snapshots away, so nothing came back while a node was dragged and the car stood still on the screen (found in the first test on
  the Mac). The calls that only nudge the car (an impulse, the grabber, the cube of the hit tool, the repair of the pit stop share by
  share) no longer do that; the shell keeps the objects of the cube and the elastic through the snapshots (the debug view knows
  them by their object). The debug view unpins the shell with `setPinned(false)` (it wrote `sb.pinned`, which did not reach the
  worker: the cube dented the car, but the car did not feel the hit).
* **Only data goes to the worker**: what is copied for it leaves out objects of a class and loops. A suspension change in the tuning
  menu put a 3D object in a value the page wrote (a wheel's `deform`, for drawing its tyre), and the copy went round in it for ever
  (a stack overflow). Tested: all six suspension types front and rear on the Stadium truck. The forces of the loose parts
  (`partForces`, the same array filled again every frame) are sent every frame that has some.
* **A label** with `worker=1` or `worker=0` in the address: the frames per second, where the physics runs and what it costs. It is for
  a test on a device.
* Not in the worker yet: the contacts of the shell with the AI cars (the worker's car has no other cars; the rigid contact of
  `collideCars` in the page still pushes it, through the values it writes); the pose between two snapshots is not smoothed (when the
  worker steps every other frame, the car moves every other frame).

What was measured (the Mac, 10 cores):

* **Chrome in the background** (another app in front) puts the page and its workers on the efficiency cores: a loop that takes 75 to
  90 ms on a fast core took 440 ms in the worker, for 30 s on end; the game ran at 20 fps with or without the worker, and with it the
  worker could not keep up (1189 ms for a second of driving) and gave the car back. Measurements in a browser that is not in front say
  little.
* **The browser in front** (the browser of the Claude app): the same loop takes 74 ms in the page and 90 to 160 ms in a worker. The
  Muscle with 5 AI cars on the Short track: the worker needs 350 to 430 ms for a second of driving (it keeps up), and the page spends
  19 ms a frame instead of 35 ms. The frame rate itself could not be measured there (its pane was hidden, at 1 fps).
* **To do before it can be on by default**: drive with `worker=1` and with `worker=0` on a Mac (Chrome and Safari, in front), a
  Windows PC, an iPhone and an Android phone, and compare the label; then smooth the pose between snapshots, and move the contacts
  with the AI cars into the worker.

### Step 3: the player's car in a worker (the plan)

The main thread sends the input of frame N+1 and draws frame N while the worker steps (pipelined). That is one frame more between
a key and the picture (17 ms at 60 frames); the camera, the sound and the force feedback read the snapshot. The parts of the car
(Parts.js, Rapier) go with it: Rapier (the compat build, the WebAssembly in the file) loads in a worker, the worker sends the poses
of the parts. The props (RigidObjects.js) go into the same worker.

### Step 4 (optional): shared memory

With `SharedArrayBuffer` the snapshot is not copied at all, and a worker can step at its own rate. It needs the page to be
cross-origin isolated (`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, in
`web/.htaccess` on the LiteSpeed server and in `tools/serve.py`). Not needed for the gain: the copy costs microseconds.

## Expected gain

On the Mac of the measurements, 5 AI cars on the Short track:

| | Main thread | Workers | A frame takes about |
|---|---|---|---|
| Now | 15.5 ms | - | 15.5 ms |
| Step 2 | 10.8 ms | 4.7 ms | 10.8 ms |
| Step 3 | 4 to 5 ms | 6.8 ms and 4.7 ms side by side | 7 ms |

On a phone (an estimate, to be measured): now 45 to 75 ms with slow motion; after step 3 the drawing (12 to 20 ms) and the
player's car (20 to 35 ms) side by side.

## Platforms

* **Workers and `importScripts`**: every browser the game runs in (Chrome, Edge, Firefox and Safari on the desktop, Chrome on
  Android, and every browser on iOS, which are all WebKit).
* **Transferable ArrayBuffers**: everywhere, without any header.
* **Rapier in a worker**: a dynamic `import()` in a classic worker works in Chrome and Safari; check it in Firefox. Otherwise the
  worker that has the parts is a module worker.
* **Phones** have two to four fast cores and some slow ones. A worker can land on a slow core, so use one or two physics workers on
  a phone (more on a desktop: `navigator.hardwareConcurrency`, which Safari caps). They also get slower when they heat up. Measure on
  a real iPhone and Android phone before step 3.
* **A fallback**: a setting "Physics in a worker", on by default where `Worker` exists. Off: everything as now, on the main thread.

## Risks

* **One frame more of latency** for the player's car (step 3). If that is felt, the view can be drawn from the newest snapshot
  rather than one frame behind (step 2 has no extra latency for the player).
* **Order within a frame changes**: contacts between cars in different workers use the state of one frame before. The car-to-car
  contacts and the AI need a test.
* **Everything that writes into the physics** from outside (the pit stop, the jacks, reset, repair, the tuning menu, the node grabber
  and the hit tools of the debug view, the ragdoll of a rider that pushes the bike) becomes a message to the worker. This is the
  bulk of the work in step 3.
* **Replays and records**: they are made from the views on the main thread, so they keep working; the seeded random numbers make a
  replay closer to what happened.
