# O-Racer in Godot 4

A rebuild of OpenRacer in the Godot engine (4.7), on the branch `O-Racer-Godot`. It is built in phases;
after each phase the game is tested by driving it.

The Godot version reads the same content as the browser game: the cars, tracks and wheels in `../web`
(`car.json`, `track.json` and the glb models), loaded while the game runs. Nothing is copied, and a car or
a track made for the browser game drives here too.

## Building the native part

The engine sound is C++ (a GDExtension in `native/`, built on godot-cpp, a git submodule). Build it once, and
again after a change in `native/src/`:

    git submodule update --init
    cd godot && /Applications/Godot.app/Contents/MacOS/Godot --headless --dump-extension-api && mv extension_api.json native/
    cd native && scons            # makes godot/bin/liboracer.macos.template_debug.universal.dylib

Without it the game runs, without the engine sound (a warning says so).

## Running

Open `godot/project.godot` in Godot 4.7 and press Play (F5), or from the command line:

    /Applications/Godot.app/Contents/MacOS/Godot --path godot

The main menu (see Menus, settings and the HUD) chooses the way to play, the car and the track. Arguments after `--` start a
drive at once and help to test:

    --car=openracer-muscle --track=short-track   start this drive (without the menu)
    --drive                                      full throttle (and --steer=0.5 for a circle, + is left)
    --log=1                                      print speed, gear, rpm and wheel loads every second (--verbose: each tyre)
    --shot=file.png --shot-at=5 --quit           save a screenshot after 5 seconds and stop
    --quit-after=10                              stop after 10 seconds
    --diff=open                                  another differential than car.json's
    --content=/path/to/web                       another content folder
    --user-dir=/tmp/folder                       keep settings.cfg and the files of the menus there (the tests: never the player's)
    --race --opponents=3 --laps=1 --pole --difficulty=hard   a race;  --mode=skidpad --surface=gravel   the skidpad

For example, a test without a window:

    Godot --headless --path godot -- --car=hatchback --track=skidpad --drive --log=1 --quit-after=10

## The log of a run

Every start writes `godot/logs/run-<date>-<time>.log` (not in git; the newest 30 are kept): the machine and the
commit, what happened when (a drive, the camera, a reset, a shift, a knock) and four times a second the state of
the car and every tyre. **F8** marks a moment: a line `MARK n` and a screenshot next to the log. Godot's own
errors and warnings are in the `godot.log` whose path is at the top of the log.

## Racing wheel and force feedback

A racing wheel is calibrated once (**K** while driving, or Settings, Wheel): turn it left and right, press the
pedals and the paddles; what it found is kept per device in `user://settings.cfg`. At the end a short push finds
which way a positive force turns that wheel. The force feedback (the aligning torque of the front tyres, bumps,
loose ground, slides, ABS, knocks, the hard stop at the lock) follows `web/js/ForceFeedback.js` and is sent to a
wheel that speaks HID PID (PXN, Thrustmaster, Fanatec, Moza, Simagic, Logitech G920/G923 ...) by
`native/src/wheel_force.cpp`, through the HID functions of the SDL3 inside Godot. Tested on a PXN-V99. Tests:
`tools/test_wheel.gd` (the calibration with made-up input), `tools/ffb_probe.gd -- --pulse` (opens the wheel and
pushes it both ways), `tools/list_pads.gd`, `tools/watch_pad.gd`.

Building the native part needs the headers of SDL3 (`brew install sdl3`); the game does not load that library.

## Laps, records and the ghost

A track with gates (track.json "gates": the first is the finish) counts laps: crossing the finish starts the
timing, and a lap counts when every gate was crossed in its direction (after a reset in the lap it counts, but
it is no record). The dashboard shows the lap, the last and the best time, and at every gate how far ahead or
behind the best lap you are. The best lap per track and car is kept in `user://records.cfg`, its recording in
`user://ghosts/`, and a see-through car drives it again in the next laps.

R puts the car back on the racing line where it is nearest, facing along it.

The AI (`scripts/ai_driver.gd`) drives along the racing line (`scripts/racing_line.gd`, with the speed profile
of RacingLine.js); for now it drives the player's car in the tests, the first step to opponents:

    Godot --headless --fixed-fps 120 --path godot -- --car=openracer-kart --track=kartbaan-oldenzaal --ai --quit-after=200

(`--fixed-fps 120` runs the simulation as fast as the computer can; `--ai-pace=0.7` drives slower; the laps of
the AI go to `user://test-records.cfg`, not to the player's records.)

## Tyres, aero and assists

The tyres have the kinds of Wheel.js (eco to drag slick, off-road, winter; a custom tyre has a rubber of 0 to 100
between them, and a tread): grip, the stiffness across the tyre, the rolling resistance, what they do on loose
ground. The pressure of car.json works on the grip (best at 2.2 bar), the stiffness and the rolling. With "Tyre
temperature and wear" (Settings, Driving; off by default, as in the browser game) the tyres heat with the power
of their slip and the flexing, grip less outside their window, and wear; the dashboard shows the temperature and
what is left of each. Downforce per axle (chassis.downforce_front/rear) presses with the square of the speed.
The torque converter of Vehicle.js (it multiplies the torque while it slips, creeps at idle, locks up at speed).
Traction control and stability control after Vehicle.js (when the car has them: extras.tc_on, esc_on; switched
in Settings, Driving); TC, ESC and ABS light up on the dashboard when they work.

Camber (a leaning tyre pushes to the side it leans to; the wheels lean with the roll of the body, roll_camber),
toe, the ride height, progressive springs, anti-dive, anti-squat and anti-lift, and the geometric load transfer
of the roll centres and of the anti geometry straight to the tyres, as in Vehicle.js. The engine of Engine.js:
the idle controller, the pedal curve, the rev limiter at limiter_hz, the engine braking (braking_scale) and a
turbo (a share of the torque, or a boost pressure, with spool time and threshold). The automatic gearbox of
Vehicle.js (shift points with the throttle, a kick-down, up at the limiter when the wheels spin). Fuel, with
"Tyre temperature and wear" on (as the browser game has it with wear): the tank empties with the work of the
engine, the mass goes down with it, an empty tank stops the engine.

`--set=tyre_wear:3.0,tc:false` changes settings for one run (the tests).

## Tuning

**U** opens the tuning menu, as the browser game has it (web/js/Tuning.js, CarTuning.js): a panel at the right of
the screen with the cards of the car editor in the browser's order (Wheels; Suspension and driveline; Chassis with
Brakes, Aero and Size; Drivetrain; Engine with Fuel; Engine sound; Assists and extras; Cameras; Soft body), every
group folded away. A row has the label, a number, the unit, ↺ (back to the setup that is chosen, or the car as made)
and a slider with the units, ranges and steps of CarTuning.js; a changed value is orange. The brakes are a total and
a bias, the gears a summary with Advanced (gear by gear, − and +) and a list of kinds of transmission, the tyre's fine
settings are folded apart, the systems and the extras have a tick that opens their settings. A setting that cannot do
anything with the others is hidden (CarTuning.visible); one that the Godot physics do not use yet is grey with a
tooltip (Tuning.NOT_IN_GODOT: the paint, the wheel library, the tyre shell and tread stiffness, heating and life,
tyre damage, the shift pattern, diff build-up, the centre differential, the parts library suspension and engine
place, the steering wheel stops, look-ahead/fov-speed/dolly/hide-driver of the cameras, the boost gauge). A change
works at once while the car drives (the cameras and the engine sound follow too); in a race the game waits while the
menu is open. Setups: "Default (the car as made)" is car.json; Save overwrites the setup that is chosen, Save as
new… asks a name, Delete (or Undo changes for a tune that comes with the car). A setup is a tune
(`user://tunes/<car>/<name>.openracer-tune.json`, the format of the browser game: a whole car.json); the tunes that
come with a car (car.json "tunes") are in the list too. The setup in use is remembered per car and used at the next
start. Not ported: the engine build with its chart and dyno (the browser's Engine card), Export/Import of a tune
file, the Mirrors card, the Motorcycle card. `--tuning` opens the menu at the start, `--tuning-open=Chassis,Chassis/Brakes`
opens cards and groups (for screenshots). Test: `Godot --headless --path godot res://tools/test_tuning.tscn`.

A kart (chassis.unsprung) stands on its tyres: the tyre is the spring (its rate with the pressure), the frame
twists (frame_torsion) and the inner rear wheel is lifted (inner_lift) by the lateral acceleration, as in
Vehicle.js, and also by the steering (an addition: the caster of a kart lifts the inner rear wheel in a slow
hairpin). A welded or locked axle is solved as one body.

## Racing against the AI

In the menu: Mode "Race against the AI", the number of opponents (1 to 7), the laps and the start (at the back of
the grid or on pole). The opponents are cars of the player's kind (a car against cars, a kart against karts),
on the grid of track.json; 3, 2, 1, GO holds everyone; the positions and the laps of the race are measured along
the racing line from the finish; the AI backs off behind a slower car and moves aside to pass, and a car that is
stuck is put back on the line. The AI learns where it ran off the road (the line before there a little slower)
and keeps that per track and car (`user://ai/`), so it races cleaner the next time. The AI cars have the colours
of the browser game (the materials called carpaint, or body); the three nearest are heard (3D, a lighter engine
simulation). When the player finishes, the results show and the AI drives the player's car
on. Home (back to the start), Restart in the pause menu or "Race again" starts it again. A track without a racing line has no race (free driving).

    Godot --path godot -- --car=openracer-muscle --track=short-track --race --opponents=5 --laps=3 [--pole] [--ai]

## Damage: the soft body

With "Damage" on (Settings, Driving; on by default, as in the browser game, where `&damage=0` switches it off) a
car dents. It is the shell of `web/js/SoftBody.js` (see `SOFTBODY.md` in the root): a node for every collision
sphere of the car (car.json `softbody.layout`, the list of the car editor; without it a cloud of spheres made from
the model, as `CollisionProxy.js` does), beams to the nearest neighbours, and an anchor that holds every node to the
body. An anchor is elastic up to its yield force, then the node bends for good (with hardening), a node bent
`max_bend` (35 cm) is crushed solid, an anchor tears at its break force and a beam snaps when it is stretched too
far. The strengths come from car.json `softbody` (`anchor`, `beam`, `contact`, `hardening`, `shell_mass`, per node
`nodes`, per beam `beams`).

The nodes meet the walls of the track (the triangles of its collision that do not lie flat, found in a grid,
`scripts/wall_grid.gd`; a wall lower than 30 cm above the underside is driven over) and the nodes of the other
cars, as stiff springs with a damper and friction (`scripts/car_shell.gd`). The body feels a hit only through the
anchors, so the peak of a hit is limited by what yields and the energy goes into the bending. The shell is worked
out in 16 small steps per physics step (0.5 ms: what the explicit springs need to stay stable), and only while
something touches it or moves in it: a car that drives without hitting anything costs nothing. With a shell the
box of the body is made smaller by what a node can be crushed (it stays for the road, a car on its roof and as a
backstop; it grows to the full car again as the car tips onto its side or its nose, which the nodes do not
take); with damage off the car is the rigid body it was.

The model bends with the nodes (`scripts/soft_body_mesh.gd`, as `SoftBodyMesh.js`): every vertex is tied to its
four nearest nodes with weights, and the skinning of Godot moves it (a Skeleton3D "Shell" with a bone per node;
the meshes of the body are made again once with the nodes as bones, in a thread when the car is made). Back to
the start (Home, or the pause menu) and Backspace (repair where it is) repair the car and puts its parts back; R puts it back on its wheels and
keeps the dents and the parts that are off.

The parts of car.json `parts` (`scripts/car_parts.gd`, after `Parts.js`) come off when the load on them passes
their `break_force`: the larger of the mass of the part times the acceleration of its place (smoothed over a few
steps) and the force of the shell on the nodes it hangs on. A detachable part bends on with the body for its
`break_delay` and then falls off as a RigidBody3D with a box of its size, with the dent it had, and hits the track
and the other cars; a breakable part (glass, a lamp) is gone at once in a cloud of shards; a hinged part sits shut
until all its pins break and then falls off.

The tuning menu (U) has a card "Soft body" (in the browser it is read-only; here it can be set): the car dents or not,
the most nodes made from the model, the yield and break forces of the anchors and the beams, the hardening and the
mass of the shell. A change makes a new shell, whole (and the model is made again when the nodes changed).

Test: `Godot --headless --fixed-fps 120 --path godot res://tools/test_crash.tscn -- --car=openracer-muscle
--speed=60 [--angle=40] [--set=damage:false]` drives into a wall and prints the bend, the energy and what tore,
then drives the car on and repairs it; without `--headless`, `--shot=file.png` saves a picture of the dent.

The engine takes damage as in the browser game (`EngineDamage.js`, `scripts/engine_damage.gd`; not for the AI cars,
which have no pit stop): the nodes of the shell in the engine bay and at the radiator say how hurt the block, the
top, the oil pan, the front of the engine and the radiator are; from that come misfires (a bang in the exhaust),
stalls at a hard hit, coolant and oil leaks, a blown head gasket, the heat of the engine (less power above 108 C),
the wear of the bearings without oil pressure, and an engine that seizes. The HUD shows a line "ENGINE ...° ·
COOLANT ...%" with what is wrong once something is; a repair makes it whole. car.json `engine.damage` sets the bay
and radiator, as in the browser. The crash test prints what the hit did to the engine. What it shows
(`scripts/engine_fumes.gd`, after `Car.js` and `Leaks.js`): steam and oil smoke out of the bay, white smoke out of
the tail pipes after a blown head gasket, drops of oil and coolant (a dripping radiator, or 1 to 5 jets from one torn
open) and the stains they leave on the road (oil stays, coolant dries in 70 s).

Punctures (`scripts/tyre_damage.gd`, Vehicle.js): with car.json `tyres.damage` (the tuning row "Tyre damage") and
damage on, a hard hit on a tyre (more than five times its static load: a kerb, a landing) punctures it now and then;
it leaks 0.05 to 0.15 bar a second down to 0.15 bar, and its grip, its sidewall and (a kart) its spring follow. A
repair makes the tyres whole. The crash test takes `--puncture=1`.

Not yet from the browser game: the suspension as nodes and beams (a bent arm that pulls the car aside, a wheel that
comes off), hinged parts that swing open (doors, a hood) and the link beams of parts with nodes of their own, the
pieces of a part that shatters (`Shatter.js`), a loose part that hits its own car, the shell of the model drawn as an
object "beams", the replay of the shell.

## Garage

The garage (`scripts/garage.gd`, Garage.js): cars and tracks of the player next to the game's own, in the user folder
(`user://garage/cars/<id>/`, `user://garage/tracks/<id>/`) and in a folder of the player's own (setting
`garage_folder`, with cars/ and tracks/ in it). An item with the id of one of the game wins over it; an item with
only its car.json keeps using the files of the game's one. Main menu, "Import a car or track (zip)…" puts the item of
a zip (car.json or track.json at its root or in one folder, as the browser game exports it) in the garage; it shows in
the lists with "(garage)". The car editor and the track editor save into the garage (the track editor also deletes from
it, the car editor exports a car as a zip). Not yet: deleting from the main menu.

## Car editor

Main menu, "Car editor" (`scripts/editor/`, after `web/tools/car-editor.html` and `car-editor.js`): the side bar with the
cards of the browser editor in its order, the 3D view in the middle and the layers on the right, in the colours of
`editor.css`.

- **Header**: the tune of the car (Default is car.json; Save writes to what is chosen, + New tune, Tune file: delete,
  export and import a tune file; the tunes are those of the tuning menu, `user://tunes/<car>/`), the summary (mass,
  front/rear, power, top speed, a wheelie warning for a motorcycle). Footer: Changes (what differs from the saved car),
  the ready check (what is missing before it can be saved), the status, Delete (to the Trash), Save and test (saves,
  asks a track and drives it in the game; Esc, Main menu comes back to the editor). Ctrl/Cmd+S saves, Ctrl/Cmd+Z undoes
  (Shift: redo).
- **Car**: open a car of the list (the game's and the garage's; the tune in use goes into the form), + Car, + Motorcycle,
  Make a copy, Export zip, the type, name, id (`^[a-z0-9][a-z0-9_-]{0,63}$`, made from the name until it is typed) and
  description, and where Save writes: the garage (`user://garage/cars/<id>/`, the default) or, when the game runs from the
  repository, the game's folder `web/cars/<id>/` (and `web/cars/index.json`, as tools/serve.py does).
- **Model**: Import model… (a native file dialog: a .glb, or a .gltf with its .bin and textures; a name the game does not
  allow is made safe), turn, scale, the offset, Fit to the wheels and the floor. A new model is set up by itself (the
  wheels found, the size and the chassis measured, the model on the floor, glass that arrived opaque made see-through);
  a new model for a car that exists keeps what still fits (the transform, the wheels by name, the materials).
- **Wheels**: Dynamic wheels or Wheels from model, Find the wheels (by their names: FL, front left …, and their places),
  the parts by hand (four lists, Ctrl/Cmd adds), the rims of the wheel library per axle (the tyre made from the Tyres
  settings, or the rim and tyre of the model; the motorcycle tyres of the library), Rear = front, the steering wheel
  (degrees, stops). The boxes of the wheels, the library wheels or the grey dynamic wheels are drawn in the view.
- **Suspension and driveline**: the parts library (`scripts/editor/parts_library.gd`, PartsLibrary.js): a type per axle,
  where the engine is, the parts placed from `web/parts/` and shown in the view, an eye per part, every mount a row with
  move, turn and reset; Edit origins makes only the mounts clickable (W moves, E turns, Escape leaves).
- **Chassis**, **Motorcycle**, **Drivetrain**: the fields of the form, a slider under every number with a range, and the
  groups of the tuning table that the form has no field for (Tuning.GROUPS: Chassis settings with the paint, Brakes,
  Aerodynamics and steering, Tyres in Wheels, Fuel and Engine in Engine, Transmission in Drivetrain), hidden when they
  cannot do anything (Tuning.visible), ↺ back to the car as loaded.
- **Engine**: the engine block (`scripts/editor/engine_build.gd`, EngineBuild.js: the curve is worked out from the block,
  the cam, inlet and exhaust, the fuel and a turbo or supercharger, every field within the limits the others allow; the
  turbo of the game and the engine sound follow), the exhaust, Simple or Advanced, the chart of torque and power with Run
  dyno (a pull at the wheels, with the sound), the engine speeds. **Engine sound**: the exhaust effect and All settings…
  (every field of engine_sim and the ignition timing); the Tests bar of the view plays it (EngineSimSynth, rpm, throttle,
  Rev, cockpit).
- **Assists and extras**, **Cameras** (the window with the follow and cockpit cameras, Defaults for the size of the car),
  **Materials** (a preset or the fields per material: colour, metalness, roughness, opacity, clear coat; car.json
  "materials").
- **View**: orbit (left button), pan (right or middle, or Shift), the wheel zooms to the point under the mouse; O
  perspective/orthographic, Home reset, the numpad (4 6 8 2 5, 1) or View… for the standard views; the bars fold away at
  the edges. The gizmo (`editor_gizmo.gd`, where the browser has TransformControls) moves the cameras (follow, its look
  point, cockpit), the model and the exhaust points, and turns the exhaust points and the mounts (W, E). A click on a dot
  selects it; a click on the model shows its part in the layers.
- **Layers**: the cameras, the model, the steering wheel, the suspension rig, the wheels, the exhaust points (+ Add, ×,
  a window with the place, the turn, the diameter, smoke, flame length and width, brightness), every named object of the
  model with an eye and folding, a search, and the thumbnail of the selected camera.
- **Tests**: Drop car (`car_editor_bench.gd`: the car built by the game's Car from the form, saved or not, dropped from a
  height and a tilt on a floor), Drive (the keys of the game, the view follows, the engine heard), ↺ back to the model.

The Soft body and the Driver cards are ported apart: the editor loads `scripts/editor/car_editor_softbody.gd` and
`car_editor_driver.gd` when they are there (`CarEditor.CARD_HOOKS`): an object with `setup(editor, card_body)`,
`fill(cfg)`, `read(cfg)` (writes its part into the car.json that is saved), and if it likes `frame(dt)`,
`on_model(root)`, `picked(hit)` (a click on the model) and `open_part(name)` (a click on a part in the layers). Until
then the car keeps what car.json has for them.

Not ported: the crash test, Apply force and Full test of the bench, the flame test of the exhaust points, the nodes of the
tyre shells on the bench (the Godot physics have no tyre shells), the weather, time of day and ground of Save and test,
Ship with the car of a tune, and the material field "reflection" (envMapIntensity) is saved but only approximated (the specular of the material).

Tests: `Godot --headless --path godot res://tools/test_car_editor.tscn -- --out=/tmp/folder` opens the hatchback, drops it
on the bench, changes fields, saves it as zz-editor-test into that folder (never the garage or web/), checks the car.json
(the keys, their order and the number format of the browser), and makes a new car from Kart.glb. The game drives a car of
that folder with `--set=garage_folder:'"/tmp/folder"'` (add `--keep` to the test to keep the files). Pictures:
`Godot --path godot res://tools/shot_car_editor.tscn -- --car=openracer-muscle --open=Engine --scroll=Engine --dyno=1
--shot=/tmp/editor.png` (also `--select=follow|ex1|model|mt:front:lower_ball`, `--suspension=1`, `--tests`, `--drop=1`,
`--window=Cameras|Materials|Sound`).

## Track editor

The track editor of the browser (`web/tools/track-editor.html`, track-editor.js, track-design.js, heightmap.js) in
`scripts/editor/`: main menu, "Track editor", or `-- --editor` (`--editor=<id>` opens that track). The side bar has
the cards of the browser: Track (open a track, New track, Delete… for a track of the garage, Height map…, name, id,
description), Ready to race, Reference image (a picture to draw over: opacity, place, Scale by two points), Model
(import a .glb or .gltf), Surfaces (the role of every part: road, pit lane, grass, ground, sand, gravel, mud,
scenery, decor), Start and lap gates (Fill the grid, Gate 1 at the start, Auto gates, Show the checkpoints), Pit
boxes and the pit line, Objects (the library of `web/objects` and `user://garage/objects`, + adds a glb; the
prefabs on a track with a model; rigid, static or decor, mass, origin), Curbs (width, height, colour, connect to the
road, the size and the offset of a node, Taper the ends), Cinematic cameras (and their range), AI racing line (Edit
the line, Draw the line, Apply, Forget) and Sky and light; at the bottom Thumbnail (preview.webp), Export zip, Test
drive (saves and drives it with the car of the menu) and Save. The view: the tools in a bar at the bottom (1 to 0:
Look, Grid box, Pit box, Pit line, Add gate, Drag strip, Place object, Add camera, Draw curb, Measure; on a road of
nodes N, B, G, P: Edit road, Branch, Surfaces, Prefabs with Draw/Points and Attach to road), at the top right Save,
the colours of the surfaces, Snap 1/2/5 m, From above, Undo/Redo (all of the track), Layers and ? (the keys); the
panel of what is chosen with its numbers, the drag strip window and the drawer of the road (Track, Branches,
Surfaces, Prefabs). Left drag turns the view, right drag moves it, the wheel zooms to the pointer; what is chosen
has handles: the middle moves it, the ring turns it, the square scales it, the arrow lifts a node of the road.
Keys as in the browser: Delete, Escape, Enter, Ctrl+Z/Y/D/S, F, T, End, W E R.

A track is saved as `track.json` in the format of the browser (the numbers rounded as it does) with its files, in
the garage (`user://garage/tracks/<id>/`; files it has not got come from the game's folder of that id) or, when the
game runs from the repository and "Save in the repository" is ticked, in `web/tracks/<id>/` (and `index.json`). A
road of nodes is built as track-design.js builds it (the same centripetal Catmull-Rom curve as three.js,
`scripts/catmull_rom.gd`; the road, shoulders, terrain, branches, surfaces and prefabs come out part for part as
the browser's, `res://tools/test_design.tscn -- --track=go-kart-track-1`) and written as `<id>.glb` with
GLTFDocument, the hidden triangles left out. The game draws what the editor makes: curbs (`scripts/curbs.gd`, road),
the grid boxes, the pit area and the checkpoints with the arrow to the next gate (`scripts/track_marks.gd`), the
objects (`scripts/track_objects.gd`: a rigid one sleeps until a car's box pushes it and the push comes back to the
car, a static one is a wall, decor only shows), `double_sided`, and on a road of nodes without a recorded line the
middle of the road as the racing line (`scripts/racing_line.gd`).

Test (never in the garage or in web/): `Godot --path godot res://tools/test_track_editor.tscn -- --out=/tmp/te`
(with a window and `--shot-dir=/tmp` it takes screenshots) uses the tools with the mouse on testtrack, draws a new
road with a node, a prefab row, a tree and a gravel area, saves both into `/tmp/te/tracks/`, checks the fields of
track.json, and saves go-kart-track-1 again unchanged (its design, grid, gates, pit, objects and surfaces equal,
the curb points within 1 mm). A saved track drives with `-- --content=<a folder with tracks/ and links to web/cars>`.
Not yet: recording the racing line by driving (draw or edit it instead), the touch layout and the loupe of the
browser, the draft that is kept every few seconds, thumbnails of the library models, the cinematic cameras in the
replay. On desert-drag-strip the barrier on the strip (`prefab_barrier_1` of the design) is scenery in the browser
too: its rail and posts (0.78 m) are higher than what a car drives over (0.13 + 0.3 m, Vehicle.js), so both games
stop a car there.

## Replay

The replay (`scripts/replay.gd`, Replay.js): every car of the session (the player and the opponents) is recorded
30 times a second, the last half hour: the place, the turn, the velocity, the steering, the engine, the pedals, the
gear, how hard the tyres squeal, and per wheel the spring, the steering and the turn. Esc, Replay: the game stays
paused behind it and the recording plays through the same code that draws the cars; the engine and the tyres are
heard as they were (while it plays forwards). The bar (`scripts/replay_bar.gd`): Save replay, Photo (F2: a PNG
without the bar), ● Video (the whole replay as an mp4), Video editor, Exit; the slider with the fragment on it; Mark in
and Mark out (I and O; × takes them away) and Save fragment (a replay file of that part, or an mp4 of it played at
the chosen speed with the camera as it is set); start, -10 s, Rewind, Pause, Play, +10 s, end, the speed (0.1x to
5x); the frame (16:9, 9:16, 1:1: an orange outline, what a video takes of the picture); the cameras: Follow, Cockpit,
Bonnet, Free, Cinematic (the cameras of the track, track.json `cameras`: the one whose range the car is in, turning to
follow it; a field of view slider ×0.2..3 and a look ahead 0..40 m; [ ] zoom), and the car (Tab). At the top left the
speed, the gear, the revs and the pedals. Keys: Enter or Space play/pause, left and right one frame (held: on), up and
down one second, Home and End, T the next camera, H hides the bar.

The free camera of the replay (`scripts/replay_free_camera.gd`): W A S D or the arrows (W the way it looks), Z, Space,
Shift up, X, Alt, Ctrl down, Q E tilt, [ ] field of view, click the scene to look with the mouse (Esc lets it go), a
gamepad (left stick moves, right stick looks, triggers up and down, shoulders zoom); F aims at the car, L fixes it to
the car (its frame), K fixes it with the sky up; a speed slider 0.01..3 (log) and the smoothing of the look (5 and 6),
both remembered. It starts fixed to the car where the camera was. (In the free camera the arrows move it, not the time.)

The files (`scripts/replay_files.gd`): `.oreplay` in `user://replays` (a Godot Variant: the ids of the track and the
cars, the recording; and when there are a name, the camera track, the cameras of the clips and the zoom of an edit,
the project of the video editor and the edit as it plays). Version 1 files are still read. The browser's
`.openracer-replay` files open as well (gzip, "ORRP", the JSON header, 36 floats per car per sample): the place is
fitted to where the wheels were, the rpm, the pedals, the gear labels and the squeal are taken over, and their camera
track, clip cameras and zoom play; the blocks after the numbers (the dents and parts of the soft body, the skid marks,
the smoke and the other effects, the rider as a ragdoll) are left out, as the Godot replay has none of these yet.
The main menu, Replays…: Watch (an edit when there is one), Edit (the video editor on the recording), Delete (to the
Trash), Open a file… (copies a .oreplay or a browser file into the folder), Show the folder. Going to the main menu
from a drive of a minute or more that was not saved asks Save the replay?

Video files (`scripts/replay_film.gd`, `scripts/video_writer.gd`): a part of the replay is played at the chosen speed
and rendered a second time in a SubViewport of the video's size (the same world, the camera of the screen with its
field of view narrowed to the orange outline; at most 1920 on the long side), every frame exactly 1/30 s of replay
time, paced to real time so the sound of the replay is recorded with it (an AudioEffectRecord on Master). The frames
go straight into ffmpeg (a pipe, raw RGBA to H.264, crf 20, at most 20 Mbit/s, + AAC sound; when the frames came slower
than real time the sound is stretched to the picture with atempo). ffmpeg is looked for on the PATH and in
/opt/homebrew/bin, /usr/local/bin, /usr/bin; without it the frames are a PNG sequence in a folder with sound.wav.
Videos go to Movies/OpenRacer, photos to Pictures/OpenRacer. Esc stops a video (it is kept as far as it went).

The video editor (`scripts/video_editor.gd`, `scripts/video_timeline.gd`, VideoEditor.js), from the bar (over the
game, which stays paused) or Edit in Replays: the source monitor (from behind the car, a scrubber, play Shift+Enter,
In and Out I/O, Insert at playhead, Add to end) and the program monitor (in the aspect: 1280x720, 720x1280, 960x960;
Enter, Home, End, arrows a frame, Shift a second); the timeline with the ruler, the clips (trim handles, the speed
ramp keys, zoom keys and look-ahead keys drawn and dragged in them) and the camera lane (keys; click: go there, double
click: edit it with the free camera; K or Key here puts one, Delete removes); the inspector: the camera of the clip
(camera track, a fixed shot of the free camera with Take camera and Go to shot, follow, cockpit, cinematic with a
look ahead), the speed 0.05..8 with a ramp, the zoom 0.5..4 with keys, ease in/out per key, split, move, delete.
Save keeps the project and the edit with the replay's file (a replay of the game is saved first); Save as replay
writes a new named replay (cuts, speeds, camera track `CameraTrack`, clip cameras, zoom); Save as mp4 films the program.
The two monitors are SubViewports sharing the world: the source is drawn every other frame (the cars put at its time,
and back after the draw).

A take (`scripts/take.gd`, Take.js): 5 in the game asks for the picture (16:9, 9:16, 1:1), Video or Replay and
whether the HUD goes away; a count of 5 s in the frame, then REC with the time (a dark passepartout outside the
frame); 5 again stops it and asks for a name and what to cut off at the start and the end. A replay goes to Replays; a
video is filmed afterwards from the recording with the camera of the take (also without a cut: the browser films
that live from the screen).

The free camera of the game (`scripts/game_free_camera.gd`, FreeCam.js): the fourth camera of C (follow, cockpit,
bonnet, free; settings `camera` 3 starts with it). W A S D, Space/Z up, Alt/X down, mouse look (click, Esc lets go), Q E
tilt, 3 4 slower/faster, 7 8 look smoothing, [ ] field of view; P looks at the car, O moves with it, I fixes it to it
(rays keep it out of the walls). These keys are taken from the controls while it is on (the arrows still drive). The
panel (with the HUD): the toggles, sliders for speed, movement smoothing, look smoothing, field of view, tilt (Level),
tilt speed and smoothing, and Record (the take). Remembered per car in `user://video.cfg` with the aspect and the rest.

Test: `res://tools/test_replay.tscn -- --ai --replay-dir=<tmp> --video-cfg=<tmp> --video-dir=<tmp> [--editor=1]
[--video=1] [--take=1] [--browser=<file>] [--watch=<file> [--edit-file=1]] [--shot=<folder>]` (the folders are
required, so a test never writes into the player's data; --video needs a window). Not yet: the soft body, the parts,
the effects (skid marks, smoke) and the rider's ragdoll in the replay; Godot does not write browser files (it reads
them); the live "cinematic camera after a race" of main.js; the Godot replay of the weather is the weather of now.

## Pit stops and the drag strip

The pit stop (`scripts/pit_stop.gd`, Pit.js): with "Tyre temperature and wear" on, the player's car standing still
in pit box 1 of the track (track.json `pit.boxes`, drawn on the road with their numbers) is serviced: the tank is
filled at 6 L/s, the tyres are changed when the most worn is past 15 % or one leaks, and with damage on the car is
repaired; the parts go side by side, with 1.2 s to lift the car and to drop it, and the car is held until it is done.
The HUD shows "PIT STOP 3.2 s · repair · tyres · fuel". Test: `res://tools/test_pit.tscn -- --set=tyre_wear:1`.
The AI cars of a race pit too (`scripts/ai_pit.gd`, Opponent.js): when the most worn tyre is past 75 % with two
laps or more to go, or the fuel will not last the laps that are left (the fuel of a lap measured, else 12 % of the
tank), each drives to its own box (box 2 for the first AI car, and so on; a car without a box does not pit):
along the pit line of the track (track.json `pit.line`) at 16 m/s, braking for its box and straightening up on its
axis, or without a pit line to a point behind the box and into it; it stands until its stop is done and rejoins.
Not after the finish. The log says "race: Hatchback 2 pits (fuel 5.1 L, wear 0.12)" and the stop; the race's
put-back leaves a car alone while it stands in its box. Tests: `--set=tyre_wear:1 --ai-fuel=6` (the AI cars start
with 6 L) and `--ai-pit-line=0` (the box mode on a track with a pit line).
A track without pit boxes has the pit lane instead (`scripts/pit_lane.gd`, PitLane of Pit.js): the road of the
surface `track01` beside the racing line; the AI cars drive through it at 16 m/s and stop in its middle, and a car
standing still with its wheels on it is serviced (the player's too). No track of the game has one now.
Not yet: the car is not lifted in the picture.

The drag strip (`scripts/drag_strip.gd`, DragStrip.js): on a track with `dragstrip` the front wheels at the line,
the car still, "Get ready" for 2 s, then the tree (stage, three ambers half a second apart, green, red for a false
start); reaction time, the times and speeds at 60 ft, 330 ft, 1/8 mile, 1000 ft and 1/4 mile as notes, and a time
slip at the finish; the 50 best runs per track in `user://drag.cfg`. Test: `res://tools/test_drag.tscn -- --ai=1`.
Note: on desert-drag-strip a barrier of the track model (`prefab_barrier_12`) lies along the middle of the strip
just past the line, in the path of a car from the start position; the test starts in the right lane.

## Atmosphere, weather and graphics

The sky, the light and the weather of `web/js/Atmosphere.js` (`scripts/atmosphere.gd`): the sky is a shader made from
the time of day and the weather, the same on every track (the track's environment only gives how bright it likes the
sun and the sky light). The sun rises at 5:00, is highest at noon and sets at 19:00; its light goes warm and weak near
the horizon, the sky orange and then dark blue; from dusk to dawn the moon (its phase) gives a faint light under the
stars. The weather (clear, cloudy, fog, rain, snow) sets the clouds, the light, the grey of the sky, the shadows and the
fog, and rain or snow falls past the camera. The ground follows it (`scripts/ground.gd`): rain wets the road in about
40 s and it dries in about 3 minutes, the puddles fill in a minute and a half, snow covers the ground in about 2.5
minutes and melts slowly; a race in snow starts with the road partly bare. The wet and the snow take the grip of
`Surfaces.js` from every surface (a wet road keeps 72 %, a snowy road 38 %; loose ground loses less), per wheel: a wheel
in a puddle loses more, and where the cars scraped the snow away (a sliding tyre most, a rolling one a little; the heat
under the car melts it) the grip comes back; it is kept in tiles of 25.6 m, and grows back while it snows. The AI makes
its speeds again for the grip of the road. The surfaces of the track get the look (`scripts/ground_material.gd`: the
StandardMaterial3D of the glb made again as a shader with the wet, the puddles with the rings of the wheels and of the
rain, and the snow); the wheels throw up the water of a puddle and the snow (`scripts/ground_spray.gd`).

Settings, Graphics (`scripts/graphics_page.gd`, `scripts/graphics.gd`; the Graphics page of the browser's Escape menu)
works at once while driving: the preset (low, medium, high, ultra; a change makes it Custom), the resolution (the 3D
scale of the viewport), MSAA and an edge smoothing over it (FXAA, SMAA, TAA: Godot's own), anisotropic filtering (the
track's textures), sharpening and the vignette (a pass over the picture), the draw distance, the shadows (the size of
the atlas and the distance), the reflections (screen space), SSAO, global illumination (SSIL, Godot's counterpart of
the browser's SSGI), the tone mapping (Neutral is Filmic in Godot), exposure, contrast and saturation, the time of day,
the sun direction, the moon, the weather and the smoke. In a drive it also has "Save as HDR"
(`scripts/environment_export.gd`, EnvironmentExport.js): the surroundings of the car as an equirect .hdr (Radiance)
in `user://environments/`, for the world of Blender. The main menu chooses the weather and the time of day of a race;
a free drive starts clear, as in the browser.

    Godot --headless --fixed-fps 120 --path godot -- --car=openracer-muscle --track=kartbaan-oldenzaal --ai --quit-after=100 --set=gfx_weather:rain
    Godot --path godot res://tools/test_graphics.tscn -- --ai [--shot=file.png] [--hdr=file.hdr]

The test sets the presets and the weathers for that run only and prints what the viewport, the environment and the
ground are. The AI on kartbaan-oldenzaal with the muscle car: 35.9 s dry, 41.1 s in the rain, 45.3 s for the first lap
in snow (it gets slower as the snow builds up). Not yet: the debris of loose ground (grass, sand, gravel of
Debris.js), the weather in the replay (a replay shows the weather of now), headlights (the night is dark, as in the
browser).

## Controls

The keys of the browser game (web/js/Settings.js): W A S D or the arrows drive, Space handbrake, P parking brake, . reverse
(held), Q two-step, F transbrake, X / Z shift (the first shift makes the gearbox manual), an H-shifter (gear 1 to 8 and
reverse, buttons of a wheel), R back on the racing line, 4 saves the place for R on a track without a line, Backspace repairs
the car where it is, Home back to the start, T camera, [ ] turn the follow camera round the car and ` puts it back, H the
HUD, F3 the debug text, F2 a photo without the HUD (in the pictures folder, O-Racer), C / B / N / J / Y traction control,
ABS, ESC, launch control, two-step on and off (a short note says it), I starts the engine, E the engine sound, V the
telemetry, 0 the debug view (- hides the car), U tuning, K calibrates a wheel, M the wheel on and off, F8 a mark in the
log, Esc pause. A gamepad: the triggers gas and brake, the left stick steers, A handbrake, the shoulders shift, X camera,
Y back on the line, Back repair, Start pause. The rider keys and the ragdoll of a motorcycle are bound but not in the
Godot physics yet. 5 starts and stops a take (Take.js); the camera key goes through follow, cockpit, bonnet and the free
camera (FreeCam.js: its own keys while it is on, see Replay).

All of it can be set in Settings, Controls: every action, by group, has chips of its inputs (Key, Pad, Wheel; ✎ a new one,
✕ removes it, + adds one); the steering and the pedals of a wheel come from its calibration. An input that another action
had is taken from it (the menu says so). A gamepad binding works on every joypad but the wheel. A player who saved bindings
before keeps them; an action that came later gets its defaults without the inputs that are taken. The bindings are kept
in `user://settings.cfg`. Tests: `Godot --headless --path godot res://tools/test_controls.tscn -- --user-dir=/tmp/t` and
`res://tools/test_settings_menu.tscn` (the gamepad in the settings).

Holding the brake at a standstill puts the car in reverse (Settings, Car: with the key, with a pedal, below a speed).
The keys bring the pedals up over a time and a curve (Settings, Keyboard).

## Menus, settings and the HUD

**Main menu** (`scripts/main_menu.gd`, `scripts/menu/`, after MainMenu.js): the home screen (Play, the quick start in the
stadium truck the first time, Garage, Replays, Import, Car editor, Settings, Quit, openracer.eu, Discord, the version), then
the steps with the chips at the top and Back / Next at the bottom: the way to play (free drive, race, skidpad), the car
(tiles with preview.webp, a garage car without one is drawn once and kept in `previews/`; the specs, the top speed in the
units, the power), its setup (the tunes), the track (cards with the picture, the best lap of the car and setup, Drag top 50,
the wear, the damage and More options), the weather, the race (laps, opponents, difficulty, the start: pole, random,
last; damage, wear, the ghost, save records) and the opponents (the cars and their setups on the places of the grid). The
skidpad (`scripts/skidpad.gd`): the car circles faster and faster on the chosen ground until it lets go; the g it held.
The Garage window (export, delete to the Trash, import, link a folder, Load and New open the car editor) and the Replays
window (watch, download, delete, import). The choice is kept in `user://menu.cfg`. Screenshots: `--menu-step=car --mode=race
--menu-shot=file.png --shot-at=3` (home, mode, car, tune, track, weather, race, opponents, surface, garage, replays).

**Settings** (`scripts/settings_menu.gd`, `settings_pages.gd`, `settings_rows.gd`, `settings_controls_page.gd`): the tabs of
the browser, Car, Keyboard, Gamepad, Wheel (with the calibrated wheels and Forget), Display and sound, Mobile (with the touch
controls), Graphics, Simulation, Tools (debug text, back up and restore the settings, the records and the tunes in one file,
forget the records of a track, Save as HDR), Controls; Reset all settings. What the Godot game does not do yet is grey with
the tooltip "Not in the Godot version yet" (the steering assists, the pad steering at speed, the motorcycle options, the
debris, the simulation rows). The pause menu (`scripts/pause_menu.gd`): Resume, Replay, Tune the car, Restart, Back to the
start, Settings, the drag strip Top 50, Main menu. `--settings --settings-tab=Wheel` opens a tab (`pause`: the pause menu).

**HUD** (`scripts/hud.gd`, `hud_gauge.gd`, after Hud.js): the round gauge (the engine speed with the red zone and the shift
light, the speed, the gear, the coolant arc and the oil lamp, the badges of TC, ESC, ABS, launch control and two-step from
`web/images/HUD`, P and TB; a click on a badge switches it), the boost gauge of a turbo (the extra of the tuning), the lap
panel (the lap, the place and the gaps in a race, the last three laps, the best and a new record), the car panel (the
tyres by temperature and wear, the fuel in litres and laps, the pit stop, the engine when it is hurt), the pit stop in
the middle, the notes of the keys, and the first time the keys that matter. **Edit HUD…** (Settings, Display and sound;
`scripts/hud_layout.gd`, HudLayout.js): the game is held, every element (and the touch controls) can be moved, scaled and
faded, Save keeps it (`hud_layout`). `--edit-hud=gauge` opens it for a screenshot.

**Gamepad in the menus** (PadNav.js): the D-pad or the stick moves the focus, A chooses, B goes back, Start pauses and
resumes (in the main menu it goes on), L1/R1 change the tab of the settings; the tuning menu takes the pad while it holds
a race.

**Debug view** (0, `scripts/debug_view.gd`, DebugView.js): the triangles of the track near the car, the nodes and beams of
the shell, the engine bay and the radiator, the contacts of the wheels; a panel with the weather and the time of day.
**Telemetry** (V, `scripts/telemetry.gd`): every value of the car and the wheels. **Touch controls**
(`scripts/touch_controls.gd`, TouchControls.js): on a touch screen (or `--touch=1`, Settings Mobile): the steering stick
on the left half, the pedals, the gear buttons and the top buttons. **Movable panels** (`scripts/movable.gd`): the tuning
menu, the debug panel and the HUD editor are dragged and scaled, and kept. Icons of Lucide (`scripts/icons.gd`).

Not ported: the turning 3D cars on the tiles (stills), a picture per setup, the ghost files (Save lap, Race a ghost), saving
a lap as the racing line, the node grabber and the hit of the debug view, the Take button of the touch controls (the video
editor), import from a link, the browser's storage notes; TextureBudget.js (the phones of the browser) has no use here.

## How it works

| file | what |
| --- | --- |
| `scripts/content.gd` | finds `web/`, reads json, loads glb models, the surfaces (Surfaces.js) |
| `scripts/car.gd` | the car: rigid body (Jolt), raycast suspension, tyres, drivetrain |
| `scripts/engine.gd` | torque curve, friction, idle control, limiter |
| `scripts/car_model.gd` | the body model and the wheels (model wheels or library rim + tyre) |
| `scripts/track.gd` | the track model, a collision shape per mesh with its surface |
| `scripts/atmosphere.gd`, `ground.gd`, `ground_material.gd`, `graphics.gd` | the sky, light and weather; the wet and the snow and their grip; the look of the ground; the graphics settings |
| `scripts/chase_camera.gd`, `hud.gd`, `world.gd`, `main.gd`, `controls.gd` | camera, dashboard, a drive, menu, keys |
| `scripts/main_menu.gd`, `menu/`, `settings_*.gd`, `pause_menu.gd`, `hud_*.gd` | the main menu, the settings, the pause menu, the gauge and the HUD editor |
| `native/src/engine_sim.cpp` | the engine sound: EngineSimWorklet.js and the exhaust chain of EngineSim.js in C++ |
| `scripts/engine_sim_params.gd`, `car_audio.gd` | the sound parameters of car.json; the engine and the tyre squeal of a car |
| `scripts/tyre_effects.gd` | skid marks, tyre smoke and dust |
| `scripts/soft_body.gd`, `car_shell.gd`, `collision_proxy.gd`, `wall_grid.gd`, `soft_body_mesh.gd`, `car_parts.gd` | the shell that dents, its contacts, its nodes, the walls of the track, the model that bends, the parts that come off |
| `tools/render_engine.gd` | renders the engine sound of a car to a wav (a test) |

The engine sound is the one of the browser game, calculated: the gas in every cylinder at 10 kHz (the valves, the
burn, the exhaust runners and the collectors, after engine-sim of Ange Yaghi), then the impulse response of the
exhaust (a partitioned convolution), the drive, the tone, the muffler and a limiter. It follows the rpm, the
throttle and the ignition (the rev limiter cuts it, and unburnt fuel bangs in the exhaust). The cockpit and the
bonnet camera hear it from inside (duller). The tyres heat with the power their slip burns: they squeal past the
peak of their grip, smoke from about 220 C, and leave marks; on loose ground they throw up dust.

The physics follow `web/js/Vehicle.js` and `Wheel.js`: the body is a rigid body; each wheel casts a ray
down its suspension; the spring, the damper, the bump stop and the anti-roll bars give the load of each
tyre; the tyre force comes from the slip ratio and slip angle through the magic formula of `Wheel.js`
(friction circle, load sensitivity, the grip of the surface). The side force acts at the roll centre.
The wheels, the clutch and the engine are stepped 8 times per physics step (960 Hz), the wheels implicitly
against the secant of the tyre curve, and the body gets the mean force of the tyres. The clutch is solved
implicitly as in Vehicle.js. Gearboxes: manual/automatic gears, CVT, and a torque converter as an automatic
clutch. Differentials: open, limited slip, welded/locked; four wheel drive with a fixed split.

## Phases

1. **Prototype** (this): menu, the cars (no motorcycles yet) on the tracks, suspension, tyres, engine,
   clutch, gearbox, differentials, ABS, chase/cockpit/bonnet camera, speed and rpm. *Done.*
2. **Feel and sound**: the engine sound (EngineSim), tyre squeal, skid marks and smoke *(done)*; settings for
   the steering and the controls, racing wheels and force feedback *(done)*.
3. **Racing**: laps and gates from track.json, timing, records and the ghost; AI opponents on the racing
   line, grid start, a race of some laps, positions and results, the colours and the engine sound of the AI
   cars, racecraft after Opponent.js and the AI that learns where it ran off *(done)*.
4. **The rest of the physics**: the kinds of tyre, tyre heat and wear, pressure, downforce, torque converter,
   traction and stability control, camber, toe, ride height, anti geometry, the engine of Engine.js with turbo,
   the automatic gearbox, fuel, launch control and the extras *(done)*; damage: the soft body that dents, the
   model that bends with it, the parts that come off *(done)*.
5. **Motorcycles**: the bike model of Motorcycle.js with its rider (`scripts/motorcycle.gd`): lean, steering from the
   lean, balance, camber thrust, posture, wheelie control, brakes, crash rules, camera roll; the front end, swingarm,
   shock and chain (`motorcycle_model.gd`), the rider with IK (`motorcycle_rider.gd`), the AI rides them *(done; not
   yet: the ragdoll of a crash, the levers and fingers, model v2, the menu options of the bikes)*.
6. **Garage, tuning and editors**: tuning menu *(done)*, replays *(the core done)*, car editor *(done, see Car editor)*, track editor, garage.
7. **Release**: export for the web (openracer.eu), macOS, Windows and Linux. macOS *(done)*: `sh godot/tools/export_macos.sh`
   makes `godot/build/macos/O-Racer.app` (universal, signed ad hoc, not notarised: the first start needs a right
   click, Open), with the cars, tracks, wheels and sounds of web/ inside it (Contents/Resources/web; about 380 MB).
   It needs the release build of the native part first (`cd godot/native && scons target=template_release
   arch=universal`). The exported game keeps its logs in its user folder (`logs/`), next to the settings.
   Windows and Linux *(done, built on a Mac)*: `sh godot/tools/export_desktop.sh` makes `godot/build/windows/`
   (O-Racer.exe) and `godot/build/linux/` (O-Racer.x86_64), each with a folder `web` (cars, tracks, wheels, sounds)
   next to the program, and a zip of each. The native part for them is cross-compiled: Windows with MinGW
   (`brew install mingw-w64`; `cd godot/native && scons platform=windows use_mingw=yes arch=x86_64
   target=template_release`: it needs only the Windows system libraries), Linux with zig (`brew install zig`; the
   objects with `scons platform=linux arch=x86_64 target=template_release use_static_cpp=no` through wrappers that
   call `zig cc/c++ -target x86_64-linux-gnu.2.28` and turn `-march=x86-64` into `-march=x86_64`, then linked by hand:
   `zig c++ -target x86_64-linux-gnu.2.28 -shared -o ../bin/liboracer.linux.template_release.x86_64.so
   src/*.o godot-cpp/bin/libgodot-cpp.linux.template_release.x86_64.a`, as scons on a Mac names the objects .os;
   glibc 2.28 or newer). On Windows the force feedback looks up the SDL HID functions in the executable
   (GetProcAddress); when Godot does not export them there, force feedback is off and the rest works.
   Web *(done, tested locally, not on openracer.eu yet)*: `sh godot/tools/export_web.sh` makes `godot/build/web/`:
   index.html (the shell `tools/web_shell.html`), the engine (index.js, index.wasm, index.side.wasm, the audio
   worklets), the game (index.pck, under 1 MB), the native part (liboracer.web.template_release.wasm32.wasm, 1.1 MB)
   and the content: `content.pck` (the cars, tracks, wheels and sounds of web/ as res://content, packed by
   `tools/pack_content.gd`; about 207 MB, so about 254 MB for the folder). The page fetches content.pck together
   with the game and puts it next to index.pck before the engine starts; `scripts/content.gd` loads it
   (ProjectSettings.load_resource_pack), so GLTFDocument reads the models from res://content. The export preset "Web"
   has threads and GDExtension on (the web_dlink templates; the renderer there is Compatibility, WebGL 2) and plays
   all sound as a stream (audio/general/default_playback_type.web), as the engine sound is an AudioStreamGenerator.
   The native part is built with Emscripten **4.0.20** (the version of the 4.7.2 templates; emsdk in ~/emsdk:
   `./emsdk install 4.0.20 && ./emsdk activate 4.0.20`, then with its PATH: `cd godot/native && scons platform=web
   target=template_release threads=yes`, and `threads=no` for a build without threads). The engine sound
   (EngineSimSynth) loads and runs in the browser ("engine sound on" in the log; not yet listened to); the force feedback (WheelForce) is built but has no HID there and reports
   no wheel. Without the native part the game runs silent (the scripts check ClassDB.class_exists). Threads need
   cross-origin isolation: the server must send `Cross-Origin-Opener-Policy: same-origin` and
   `Cross-Origin-Embedder-Policy: require-corp` for the files of the game; `python3 godot/tools/serve_web.py`
   serves godot/build/web with them on http://localhost:8060. In the browser the run log goes to the console
   (without the telemetry). The keyboard works as on the desktop; gamepads go through the browser's Gamepad API (not tested yet).

Known in phase 1: the acceleration of the
cars with a centrifugal clutch (karts) or a torque converter is close to, but not yet compared with, the
browser game.
