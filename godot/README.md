# O-Racer in Godot 4

A rebuild of OpenRacer in the Godot engine (4.7), on the branch `O-Racer-Godot`. It is built in phases;
after each phase the game is tested by driving it.

The Godot version reads the same content as the browser game: the cars, tracks and wheels in `../web`
(`car.json`, `track.json` and the glb models), loaded while the game runs. Nothing is copied, and a car or
a track made for the browser game drives here too.

## Building the native part

The engine sound and the shell tyre are C++ (a GDExtension in `native/`, built on godot-cpp, a git submodule). Build
it once, and again after a change in `native/src/` (the shell tyre came with `native/src/tyre_shell.cpp`: build again):

    git submodule update --init
    cd godot && /Applications/Godot.app/Contents/MacOS/Godot --headless --dump-extension-api && mv extension_api.json native/
    cd native && scons            # makes godot/bin/liboracer.macos.template_debug.universal.dylib

Without it the game runs, without the engine sound (a warning says so) and on the simple tyre.

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

The ghost as a file (`scripts/ghost_files.gd`, Ghost.js): the pause menu has a row Ghost with **Save lap** (the best lap
of this car on this track as an `.openracer-ghost` in Downloads, the browser's format: t, the place and the turn of the
body, the four wheel centres, the steering and the spin, 30 a second), **Race a ghost** (a file that someone sent: its
lap is the ghost, also in the next drives on this track with this car, and the HUD shows its time as the best) and
**Own lap** (back to the own best lap). Files of the browser game open here and the other way round: the place of the
body is fitted to the wheel centres (the bodies have their origin elsewhere). Settings, Tools: **Save my best lap as
the line** writes the lap (every third sample, in centimetres) as `racing_line` with `line_date` into the track.json of
the garage (RacingLine.save; the files of the track stay the game's). As in main.js, the best lap that any car drove
on a track since its `line_date` is the line of the AI in a race (smoothed, RacingLine.fromLap); without one the line
of track.json (`--bestline=0` leaves the lap out, and so do the tests with `--ai`). Test:
`Godot --headless --path godot res://tools/test_ghost.tscn -- --out=/tmp/folder --user-dir=/tmp/folder/u`.

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
temperature and wear" (Settings, Driving; on by default, as in the browser game) the tyres heat with the power
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

## The shell tyre

The tyre of the player's car in the browser game (TyreShell.js): two shells of nodes with beams between them. The
inner shell is the rim, the outer shell the tread and the shoulder, nodes with a mass held by cables to the rim (the
carcass, slack where the road pushes the node in), the belt between them, the pressure of the air, the shear of the
tread against the rim, and the road: a stiff spring out of the nearest triangle and the bristles that hold a node on it
(sliding past the friction of the road). The car gets the force of the beams on the rim. It is
`native/src/tyre_shell.cpp` (TyreShell, and TyreGround: the triangles of the ground in a grid, the nearest point of a
triangle), a port of TyreShell.js line for line, 14 small steps of a few hundred nodes and beams per wheel; around it
`scripts/shell_tyres.gd` does the part of Vehicle.js: the wheel is a mass of its own (chassis.unsprung_mass, else 35 kg,
a light car 2.85 % of its mass) between the spring and its digressive damper (solved implicitly, with the stops) and
the shell; the body gets the spring at the mount, the friction of the nodes along the wheel at the contact (raised by
the anti geometry) and across at the roll centre, the rolling resistance and the push of the nodes across the
suspension at the hub; the shell turns the wheel itself in its small steps and the drivetrain gets the torque of that
turn. Three steps of 1/360 s in a step of Godot (Vehicle.js steps at 1/300 s or less). A kart has no suspension: the
shell is its spring. The ground is every static collision shape on layer 1 (the road, the curbs, the floor of the
bench), made again when one comes or goes.

When: as in the browser game the player's car (and the car of the bench of the car editor), on Settings, Simulation,
"Tyres of my car" = Shell (the default; Simple is the ray and the slip curve of the AI cars). The AI cars, a
motorcycle (its Godot model is the v2 of the browser game, on the simple tyre) and the AI test driver (`--ai`) drive on
the simple tyre; `--tyres=shell|simple` sets it for one run. "Tyres of cars: detail" (Full, Medium: 2 rings, Low: 1
ring of 12; not a kart) as in Settings.js. The tuning rows of the tyre (width front and rear, rings, nodes round the
wheel, inner shell, carcass, the stiffness along and across, the height of the sidewall) work on it; a custom tyre of
the wheel library brings its own shell (WheelLibrary.js customSpec), as does a tyre of the catalogue.

The model of the wheel is pushed in as the outer nodes are (`scripts/tyre_deform.gd`, TyreDeform.js): the materials of
the tyre (not the rim, which lies inside the inner shell) get a vertex shader with the table of the shell per ring and
per place round the wheel. A StandardMaterial3D becomes a shader of the same look (colour, roughness, metal, normals and
their textures: Godot does not give a script the code of a StandardMaterial3D); a ShaderMaterial keeps its own code. The
debug view (0) draws the two shells and the beams (green where a node holds, red where it slides), the debug text (F3)
the nodes and steps of a tyre and how far each is in, and the car editor draws them over the car of the bench while a
tyre setting has the focus (without a test: the tyres of the library from their settings).

Tests: `res://tools/test_tyre_shell.tscn -- --car=<id> --quick` is `node tools/tyre-bench.js <id> --quick` on the
native tyre (the static curve, rolling, the slip sweeps, the relaxation, the cost); `res://tools/test_shell_car.tscn --
--car=<id> [--tyres=simple] --set=tc:false,esc:false` the road test of `tools/physics-bench.js` (at rest, 0-100 km/h,
100-0 km/h, the skidpad; `--shot=file.png --deform-gain=5`, not headless, a picture of the front wheel).

The bench, browser (node) against Godot, the same tyre on a flat road:

| | Muscle (3 x 12 nodes) browser | Godot | Kart (3 x 16) browser | Godot |
|---|---|---|---|---|
| deflection at static load (mm) | 12.88 | 13.28 | 0.63 | 0.63 |
| vertical stiffness (N/mm) | 331 | 349 | 105 | 105 |
| patch length (mm) | 514 | 513 | 167 | 167 |
| rolling radius / radius | 0.929 | 0.929 | 0.956 | 0.956 |
| rolling resistance (Crr) | 0.0284 | 0.0282 | 0.0352 | 0.0352 |
| load noise on the roll (%) | 11.1 | 11.0 | 4.11 | 4.11 |
| slip stiffness / Fz, peak mu x | 15.97, 0.946 | 15.86, 0.943 | 10.86, 0.957 | 10.86, 0.958 |
| cornering stiffness / Fz, peak mu y | 15.59, 0.989 | 15.51, 0.990 | 7.52, 0.861 | 7.52, 0.863 |
| relaxation length (m) | 0.09 | 0.09 | | 0.12 |
| cost (ms a step of a tyre) | 1.09 | 0.09 | | 0.13 |

Before the physics parity (see Physics parity for the figures now), the road test of the Muscle (`node tools/physics-bench.js openracer-muscle`, the browser game's car on its shell
tyres, against test_shell_car with the traction control on and no ESC):

| | browser (shell) | Godot shell | Godot simple |
|---|---|---|---|
| 0-100 km/h with TC (s) | 6.3 | 5.19 | 4.21 |
| 100-0 km/h (m) | 36.5 | 33.5 | 28.9 |
| skidpad (g) | 1.14 at 75 km/h | 1.26 at 114 km/h | 1.65 at 200 km/h |

The kart: the browser's skidpad 0.39 g at 83 km/h, Godot's shell 0.50 g at 84 km/h (simple 0.53 g); the browser's
kart tops out at 88.7 km/h where Godot's reaches 100 km/h in 12.2 s on either tyre (its engine and gearing are Godot's).
At rest the Muscle stands 8.9 mm in on its tyres (a patch of 347 mm, 6 nodes on the road). The rest of the gap is
the car around the tyres, which is Godot's own (the engine and drivetrain, the body, how the skidpad is measured:
the browser takes the lateral acceleration from the tyre forces, the test the speed times the yaw rate). The AI is
made for the simple tyre: on the shell (`--ai --tyres=shell`) it reads the slip of the shell (sliding nodes at the
back of the patch under drive) as wheelspin and lifts, and the Muscle laps Kartbaan Oldenzaal in 44.9 s against 36.1 s;
the kart on the shell leaves the track and gets stuck on the grass, so the AI tests keep the simple tyre.

## Tuning

**U** opens the tuning menu, as the browser game has it (web/js/Tuning.js, CarTuning.js): a panel at the right of
the screen with the cards of the car editor in the browser's order (Wheels; Suspension and driveline; Chassis with
Brakes, Aero and Size; Drivetrain; Engine with Fuel; Engine sound; Assists and extras; Cameras; Soft body; and for a
motorcycle the Motorcycle card: the lean, the lean at speed, the rake, the rider's mass and hang off, the grip, the
balance, the dive of the fork, the lean speed, the rates in the air, the flat-track style and the pose of the rider in
either style, CarTuning.js), every
group folded away. A row has the label, a number, the unit, ↺ (back to the setup that is chosen, or the car as made)
and a slider with the units, ranges and steps of CarTuning.js; a changed value is orange. The brakes are a total and
a bias, the gears a summary with Advanced (gear by gear, − and +) and a list of kinds of transmission, the tyre's fine
settings are folded apart, the systems and the extras have a tick that opens their settings. A setting that cannot do
anything with the others is hidden (CarTuning.visible); none is grey now (the follow camera's look-ahead, field of view
with speed and dolly work: ChaseCamera, Car.js). The rows of the wheel library and the parts library suspension build
the car again at once, half a second after the last change, as the browser does (Car.rebuild: the model, the wheels, the
rig, the driver, the shell and its parts; a motorcycle at the next start). The shift pattern (normal, sport, drag,
manual), the heating and the life of the tyres, the steering wheel stop and degrees, hide the driver and the boost gauge
work. A change
works at once while the car drives (the cameras and the engine sound follow too); in a race the game waits while the
menu is open. Setups: "Default (the car as made)" is car.json; Save overwrites the setup that is chosen (on Default it
writes car.json, asked first: in the garage, or in web/cars when the game runs from the repository, as the car editor
saves; a car of an exported game is not written), Save as new… asks a name, Delete (or Undo changes for a tune that
comes with the car), Export… (the setup or the car as tuned as a tune file), Export to vehicle (a tune that comes with
the car: its file next to car.json is written) and Import… (a tune file: a setup of this car, chosen; one made for
another car gives only its tuning, CarTuning.js tuningOnly) (`scripts/tuning_files.gd`). The Engine card has the engine
build of the car editor (`scripts/tuning_engine.gd`, EngineBuildUI.js; the pieces of `car_editor_engine.gd`): the block
and Stock block, the exhaust, the chart with Run dyno, the build with its limits; a change works out the curve and the
turbo, the sound follows, and the car is heavier or lighter by the engine (EngineBuild.mass). A setup is a tune
(`user://tunes/<car>/<name>.openracer-tune.json`, the format of the browser game: a whole car.json); the tunes that
come with a car (car.json "tunes") are in the list too. The setup in use is remembered per car and used at the next
start. Not ported: the Mirrors card (the mirrors are in Settings, Mirrors). `--tuning` opens the menu at the start, `--tuning-open=Chassis,Chassis/Brakes`
opens cards and groups (for screenshots). Tests: `Godot --headless --path godot res://tools/test_tuning.tscn`, and with
HOME in a temporary folder (it writes a garage car, never web/) `res://tools/test_tuning_menu.tscn -- --user-dir=<tmp>
[--shot=file.png]` (the Engine card, the camera, a rim that rebuilds the car, Export, Import, Save on Default, Export to
vehicle).

A kart (chassis.unsprung) stands on its tyres: the tyre is the spring (its rate with the pressure), the frame
twists (frame_torsion) and the inner rear wheel is lifted (inner_lift) by the lateral acceleration, as in
Vehicle.js, and also by the steering (an addition: the caster of a kart lifts the inner rear wheel in a slow
hairpin). A welded or locked axle is solved as one body.

## Racing against the AI

In the menu: Mode "Race against the AI", the number of opponents (1 to 7), the laps and the start (at the back of
the grid or on pole). The opponents are cars of the player's kind (a car against cars, a kart against karts),
on the grid of track.json; 3, 2, 1, GO holds everyone; the positions and the laps of the race are measured along
the racing line from the finish. The AI drives as `Opponent.js` (`scripts/ai_driver.gd`): it holds back for the car
in its path (no faster than it can still stop behind it), and passes a car ahead on the side with room, beside that
car and only as far as there is road (a ray at the point ahead: no gravel, no kerb, no barrier). Behind a car that
stands it waits, and after six seconds it goes round it; pushing against something it backs up a moment. It is put
back (with the reason in the run log) when it is on its side or its roof, fell out of the world, gets nowhere (no
4 m in 8 s, or stuck for 7 s), or stays blocked for 15 s: a little further along the line, 3.5 m to its right where
there is road, repaired (with fuel if the tank was empty), and a ghost for ten seconds (the other cars and their
shells go through it). The player's car driven by the AI (`--ai`, after the finish) is put back the same way. The
AI learns where it ran off the road and where it crashed (the line before there a little slower) and keeps that
per track and car (`user://ai/`; with `--ai` in `user://test-ai/`), so it races cleaner the next time
(`--ai-learned=0`: a test without what was learned, and nothing kept). The run log has every put-back with its
reason and every touch between two cars. The AI cars have the colours
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

A model can bring its own shell (`collision_proxy.gd`, as `CollisionProxy.js`): an object called `beams` (also
`softbody_beams`, `shell_beams`) of vertices and edges (glTF lines: Blender, Data > Mesh > Loose Edges in the export).
Every vertex is a node and every edge a beam (at most 200 nodes, radius `softbody.beam_node_radius` or a third of the
mean edge); a `softbody.layout` (the car editor) goes before it, as SOFTBODY.md has it (the browser's code puts the
model first; the muscle car and the hatchback have both and keep their layouts). The debug view (key 0,
DebugView) draws the nodes and the beams, the suspension too.

The suspension is part of the shell (`scripts/wheel_rig.gd`, the rig of SOFTBODY.md; unless `softbody.wheel_hubs` is
false): per wheel the hub (the collision sphere of the wheel), the knuckle (ball joints above and below, the end of the
tie rod) and the pivots of the arms and of the tie rod on the body, joined by stiff knuckle beams and by the arms and
the tie rod that bend (14 and 36 kN, 12 and 36 kN: `softbody.arm_yield`, `arm_break`, `tie_yield`, `tie_break` in
kN). Their beams and anchors are solved by position (XPBD, `SoftBody._rig_solve` after rigSolve of SoftBody.js; a rig
that nothing touches is left out). Every step the wheel is read from its nodes: the camber from the lean of the knuckle,
the toe from its turn, and the hub gives the place of the wheel on the car; a bent wheel grips up to 40 % less, so a
car with a bent arm pulls to a side. When both beams of an arm tear, or the hub has moved `softbody.hub_limit` (0.3
m), the wheel is off: no road, spring, drive or brake on that corner, and it flies off as a RigidBody3D (a cylinder of
its size, with its rim and tyre) with the speed and spin it had, rolls away and, once it is clear of it, hits the car.

The parts of car.json `parts` (`scripts/car_parts.gd`, after `Parts.js`) come off when the load on them passes
their force: the larger of the mass of the part times the acceleration of its place (smoothed over a few steps) and
the force of the shell on the nodes it hangs on. A detachable part bends on with the body for its `break_delay` and
then falls off as a RigidBody3D with a box of its size, with the dent it had; it does not hit its own car for 0.35 s,
then as soon as it is clear of it. A breakable part (glass, a lamp) breaks at once (`scripts/shatter.gd`, Shatter.js):
its pieces (clusters of its faces, at most `shatter.max_pieces`, or the pieces of the hidden object `<name>_broken`
with `"pieces": "mesh"`) fly off, bounce off the walls, lie down flat and shrink away, with a cloud of particles of its
material (shards, splinters or grains; `scripts/specks.gd`). A hinged part hangs on its pins (`mounts`: a point or a
node; axes, limits, a turn `rot`, `activate_force` "opens at", `break_force` "breaks off at") or on the hinge of
`hinge` (origin, axis, limits, spring, damper, `latch_force`, default 3 g of the part): it sits shut until the load
passes its latch or the "opens at" of a pin, bends on for its delay, then swings on a Generic6DOFJoint3D of Jolt (one
axis a hinge between its angles, more axes a joint with a range about each, none a rigid pin; two pins without axes a
hinge on the line between them, one a ball). The joints hang on a body that is moved where the car will be (no force
goes from a joint into the car); what the track pushes on a hinged part goes to the car, as Vehicle.js partForces does
(only what stops the car at that place, at most 500 N a kilo of the part). A pin tears at its force (the load shared
over the pins that hold, the force of the shell on its node, or the push of the track); with one left the part swings
on it, with none it is free. A part with nodes of its own (the layout names it) dents by itself and hangs on link
beams (a torn link is a torn pin); its nodes take the hit for 0.3 s after it opens. A part in the object of another
rides on it and comes off it at its own force. Loose parts are damped and held to a top speed.

The tuning menu (U) has a card "Soft body" (in the browser it is read-only; here it can be set): the car dents or not,
the most nodes made from the model, the yield and break forces of the anchors and the beams, the hardening and the
mass of the shell. A change makes a new shell, whole (and the model is made again when the nodes changed).

Test: `Godot --headless --fixed-fps 120 --path godot res://tools/test_crash.tscn -- --car=openracer-muscle
--speed=60 [--angle=40] [--set=damage:false] [--replay=1]` drives into a wall and prints the bend, the energy, what
tore, the parts and the wheels (toe, camber, shift, off), then drives the car on and repairs it; with `--replay=1` it
plays the crash back and compares; without `--headless`, `--shot=file.png` saves a picture of the dent.
`res://tools/test_parts.tscn -- --car=hatchback` opens every hinged part while the car weaves and brakes (the angle of
each against the range of its pin), tears a wheel off (it must roll away and the car drive on three), breaks a part
and repairs the car.

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

A loose part (and a wheel that came off) meets its own car, the track and its things, not the other cars and their
parts, as in the browser, where each car's parts are in a physics world of their own (CarParts.keep_to_own). A wheel of
the other car feels a hit through the nodes of its suspension in the shell, as in the browser (WheelRig: the hub is
pushed, it bends, and past its limit it comes off; `res://tools/test_damage_cars.tscn`). Not yet from the browser game:
the fading of the parts in the pit stop (they are put back at the end of the repair).

## Marbles, debris and the parts library

The rigid objects of a track (RigidObjects.js) are `scripts/track_objects.gd` (the track editor); the loose parts
and the wheels that come off of a car meet them.

Marbles (`scripts/marbles.gd`, Marbles.js): a tyre whose tread is soft and hot (150 to 180 C, before it smokes) and
slides on the road sheds pellets of rubber of 4 to 10 mm, thrown back and to the side, that bounce and lie (up to
10000, for every car; they are only seen, as in the browser game). Debris (`scripts/debris.gd`, Debris.js): a wheel
that slips on grass, sand, gravel, mud or earth throws blades, grains, chunks and clumps the way its tread moves
against the ground (Settings, Graphics: Debris; the water and the snow are GroundSpray). Test: `res://tools/test_effects.tscn` (the desert: a stack of boxes (track objects), the sand, hot tyres;
`--shot=prefix` without `--headless` saves pictures).

The parts library (`scripts/editor/parts_library.gd`) and the suspension rig (`scripts/suspension_rig.gd`, CarVisuals)
are described with the look of a car below. The lean of the wheels of a live axle (Vehicle.axleLean) is not in the
physics: with it the lap of the muscle car at kartbaan-oldenzaal was 0.06 s slower. Test of the rig on its own:
`res://tools/test_rig.tscn -- --car=stadium-truck [--shot=file.png]`.

## The driver

A car with car.json "driver" (enabled, with a file: the hatchback, the go-karts, the stadium truck) has its driver in it
(`scripts/car_driver.gd`, Driver.js): the glb placed, turned and scaled about its hips, the bones of car.json or guessed
from their names (Rigify, Mixamo), the hands on the steering wheel turning with it (the hand over at a long turn, or the
keys of the car editor), the fingers closed by grip_curl, the feet on the pedals (left the brake, right the throttle), the
elbows and the knees to their poles (`scripts/bone_ik.gd`, the two-bone IK shared with the motorcycle rider: see
Motorcycles), the chest
and the head as set (or by their keys). In the cockpit view the head and the torso are not drawn (a copy of the mesh
with the torso weight in CUSTOM0, made the first time), or the whole driver with cameras.cockpit.hide_driver. A part of
the model called steeringwheel turns with the steering (`scripts/steering_wheel.gd`, CarLoader.js: about its middle and
its flattest axis, steering_wheel.degrees at full lock; the shell that dents leaves it alone). A driver more than 80 m from
the camera is not moved. The places of "driver" and the cockpit camera are in the space of the body of the car, as in the
browser (the cockpit camera no longer adds model.offset). Test: `Godot --headless --path godot res://tools/test_driver.tscn`
(add `--cars=hatchback --shot=/tmp/folder` with a window for pictures). Not ported: the ragdoll of a crash and the give in
the g-forces (motorcycle only in the browser).

## Motorcycles

`"type": "motorcycle"` (web/MOTORCYCLE.md): the physics of the cars with one wheel at each end (car.gd), the rider of
Motorcycle.js that keeps it up and leans it (`scripts/motorcycle.gd`), the model with its front end, swingarm, shock
and chain (`scripts/motorcycle_model.gd`) and the rider on it (`scripts/motorcycle_rider.gd`, Driver.js):

- **The fork and the swingarm in the physics** (Vehicle.js feLoad): the front wheel moves along the fork and the rear
  on the arc of the swingarm, so the road force along the wheel loads the spring with its share along the travel (the
  slope from the `steerhead` empty or the rake, and from the pivot of the `swingarm` part): the fork dives under the
  brake, a swingarm with its pivot above the axle resists squat. `motorcycle.fork_dive` (1; 0 off) scales it. The run
  log's BIKE line has it (`fork`, `arm`, N).
- **The rider keys**: `,` and `.` (hold) put the rider back or forward (tuck or sit up, his weight with it; in the air
  the nose down or up). **9**: the rider goes limp where he sits (to try a crash): no throttle, steering or balance;
  the seat holds his hips and knees while the bike is upright, his weight off the middle leans the bike, and it goes
  down past 40 degrees, when it stops, or when he has slid off it.
- **The ragdoll** (`scripts/rider_ragdoll.gd`, Driver.js crash): when the bike goes down the rider is thrown off: 15
  particles (hips, chest, head, shoulders, elbows, hands, hip joints, knees, feet) with the speed they had (the bike's
  at that place and his own movement), sticks, a rigid torso, the limits and the muscles of a body (a soft zone before
  every limit, the tone towards the neutral posture, damping), the limbs out of each other, Verlet at 240 Hz, 0.55 g of
  friction on the road, a sudden higher floor is a wall. He collides with the bike's spheres, as in the browser (the
  nodes of its shell, or its collision proxy without one; the collision box only for a bike with neither): a sphere a
  part starts in is not solid for it until it has left it, the seat holds the hips, the hip joints and the knees, the
  leathers grip; he gives the bike the hit in the first 0.3 s. Unlike the browser, a shoulder or a hip that starts
  past the soft zone before its limit (the knees out against the tank: past the ellipse of the hip) has that limit
  widened towards the way it started, as far as the riding pose; in the browser the muscles push it back at once,
  the seat holds the thigh, and the push sits the limp rider up and throws his arms over his head. Also unlike the
  browser: the damping of 0.998 a substep is on the speed of each part relative to the body (the body as a whole only
  feels the air, about 0.45 m/s2 at 40 km/h, not 0.5 g); a part that the seat holds is not pushed by the other
  spheres; and the spheres are where the bike was at each substep (found where it is at the end of the frame, they
  were a frame ahead of him, and the seat dragged his hips forward under him). The skeleton is posed on the particles (the root on the hips and
  the chest, the limbs by the IK, the head along the neck). The follow camera watches him from where it was (2.5 to
  5 m, at least 1.2 m up) until Reset or Repair. Not in the replay.
- **The levers, the fingers and the shift lever**: the right grip rolls with the throttle; the hands keep their turn on
  the grips (found once in the neutral pose, with `hands.rotation` on top); the fingers (not the thumb) point at
  `frontbrake_R` and `clutch_L` (the middle finger is the base) and close with the brake or the pull of a shift; the
  levers turn about their hinge (their vertex nearest the middle of the bike); `shifter_L` taps with every shift
  (first gear down, the others up, neutral a half tap) and the left foot goes with its toe peg.
- **The rider gives with the g-forces** (`gSpring`): a mass on a spring (1.4 Hz, damping 0.55) pushed by the
  acceleration of the bike in its own frame, 6 cm at 1 g (at most 10 cm to the side, 12 forward and back, 8 down and
  4 up), the trunk turning with it (1.2 degrees a cm). Only what is drawn.
- **Flat track**: the pelvis tilts against the bike (`push_pelvis_tilt`), the inside foot comes off the peg onto the
  road beside it, forward and out with the lean (`push_foot_out`, `push_foot_forward`, a ray for the road), and a foot
  is never below the road.
- **The AI** brakes for 0.75 g on a road-race bike with fork dive (0.8 before and for a flat-track bike): with the
  fork in the physics the 600 ran wide in the first bend of kartbaan-oldenzaal at 0.8 g.
- **Test**: `Godot --fixed-fps 60 --path godot res://tools/test_moto.tscn -- --car=sports-motorcycle-600cc` (the shift
  lever, the fork, the give and the brake lever on the brake, the limp rider, a crash into a wall, the ragdoll on the
  floor; with a window `--shot=/folder` saves throttle, brake, levers, limp_ride, limp and crash pictures, and the
  limp rider and the crash at a few moments: limp_0.25 to limp_1.50, crash_0.15 to crash_1.80).
- **Not ported**: model v2 (`"motorcycle": {"model": "v2"}`; no bike of the game uses it), the head that stays upright to the road and looks along the racing line, the ORG bones
  of a Rigify rig that follow the DEF ones, the ragdoll in the replay, walking the bike back with the feet.

## Garage

The garage (`scripts/garage.gd`, Garage.js): cars and tracks of the player next to the game's own, in the user folder
(`user://garage/cars/<id>/`, `user://garage/tracks/<id>/`) and in a folder of the player's own (setting
`garage_folder`, with cars/ and tracks/ in it). An item with the id of one of the game wins over it; an item with
only its car.json keeps using the files of the game's one. Main menu, "Import a car or track (zip)…" puts the item of
a zip (car.json or track.json at its root or in one folder, as the browser game exports it) in the garage; it shows in
the lists with "(garage)". The car editor and the track editor save into the garage (the track editor also deletes from
it, the car editor exports a car as a zip). The Garage window of the main menu deletes (to the Trash), exports, imports a
zip or **a zip at a link** (downloaded with HTTPRequest, Garage.js importUrl), links a folder, and **Load** and **New**
open a car in the car editor or a track in the track editor (`tools/test_garage_link.tscn` with a local http server).

## Car editor

Main menu, "Car editor" (`scripts/editor/`, after `web/tools/car-editor.html` and `car-editor.js`): the side bar with the
cards of the browser editor in its order, the 3D view in the middle and the layers on the right, in the colours of
`editor.css`.

- **Header**: the tune of the car (Default is car.json; Save writes to what is chosen, + New tune, Tune file: delete,
  export and import a tune file; the tunes are those of the tuning menu, `user://tunes/<car>/`; Ship with the car puts
  the tune that is chosen as `<name>.openracer-tune.json` next to car.json and in its "tunes", for everyone who has the
  car, and Take off the car takes it away again; a tune with the car that was changed here: Ship the changes), the summary (mass,
  front/rear, power, top speed, a wheelie warning for a motorcycle). Footer: Changes (what differs from the saved car),
  the ready check (what is missing before it can be saved), the status, Delete (to the Trash), Save and test (saves,
  asks the track and the conditions: the weather, the time of day and the ground, the settings of the game the drive
  starts with, or Use last settings; drives it in the game; Esc, Main menu comes back to the editor). Ctrl/Cmd+S saves, Ctrl/Cmd+Z undoes
  (Shift: redo).
- **Car**: open a car of the list (the game's and the garage's; the tune in use goes into the form), + Car, + Motorcycle,
  Make a copy, Export zip, the type, name, id (`^[a-z0-9][a-z0-9_-]{0,63}$`, made from the name until it is typed) and
  description, and where Save writes: the garage (`user://garage/cars/<id>/`, the default) or, when the game runs from the
  repository, the game's folder `web/cars/<id>/` (and `web/cars/index.json`, as tools/serve.py does).
- **Model**: Import model… (a native file dialog: a .glb, or a .gltf with its .bin and textures; or dropped on the
  window; a name the game does not
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
- **Layers**: the cameras, the model, the steering wheel, the suspension rig, the wheels, the exhaust points (Test: on
  shows the flames of the pops and bangs at them now and then, as the game makes them, ExhaustFlames; + Add, ×,
  a window with the place, the turn, the diameter, smoke, flame length and width, brightness), every named object of the
  model with an eye and folding, a search, and the thumbnail of the selected camera.
- **Tests**: Full test (a drop from 1 m at 5°, two seconds later the engine in neutral to the rev limiter and a second on
  it, a metre forwards and a metre back, the steering to both locks, then a wall 100 m ahead and full throttle into it,
  the view with the car until the hit; the engine is heard), Drop car (`car_editor_bench.gd`: the car built by the game's Car from the form, saved or not, dropped from a
  height and a tilt on a floor), Drive (the keys of the game, the view follows, the engine heard), ↺ back to the model.

- **Driver** (`scripts/editor/car_editor_driver.gd`, driver-editor.js): The car has a driver, Load the driver model… (a
  native file dialog; a model picked here is saved with the car as `driver.glb`), Remove; Edit driver shows the nodes in
  the view (the hands with their turn, the feet, the chest, the head, the elbows and the knees, the ring of the wheel the
  hands hold) and the buttons that give one the gizmo (a click on a node or on the figure takes it too; W moves, E turns,
  Escape stops), the grip of a hand and the way the fingers close, Reset the elbows and knees; the place, turn and scale
  of the figure, the pedal travel, elbows and knees out and the radius of the ring as fields; Try it: the steering slider
  (the hands and the steering wheel of the model turn), the strip of the keys, Make keys from the automatic movement,
  Back to automatic, Add or Delete a key here, Mirror the + keys, rides the wheel, Throttle and Brake; the bones of the
  arms and the legs, the chest, the hips and the head (Guess them from the names). The figure is the game's (CarDriver);
  on the test bench the car of the game has its own. Not here: the rider of a motorcycle on its grips and pegs (the card
  places the figure and its bones; the game poses the rider), scaling the ring with the gizmo (its radius is a field).

- **Soft body** (`scripts/editor/car_editor_softbody.gd`, softbody-editor.js; `_nodes.gd`, `_parts.gd` and `_crash.gd`
  beside it): The car dents; Show the shell starts the bench and draws the nodes and beams of the car of the game over it
  (green, yellow at the yield bend, red above it, grey torn, blue inside, orange of a part; the hinges in orange); a click
  selects a node (Shift adds) or a beam, the middle mouse button draws a lasso, and yield and break (kN) are Set on them
  (softbody.nodes, softbody.beams) or back to Default; the selected nodes have the gizmo (W), and the first move makes the
  nodes a list of the car (softbody.layout, with layout_cg and layout_radius). Strengths… (a material preset, the shell
  mass, the hardening, the anchors, beams and contacts, beams per node and the longest beam; the forces with a slider on a
  scale of tenfolds that says the hit of a tonne that makes them), the most nodes, Scan with rays (rays from the six sides
  of the model on a 10 cm grid; the nodes spread over the hits, the inside filled when ticked), Fill the inside, the
  wheel strength, Edit nodes (a click on the model adds a node of the radius set, Delete removes the selected ones, Make
  the nodes from the model again). Parts… (a window that stays beside the view): every part with its object (Pick on the
  model), behaviour (hinge, loose, breakable), mass, break force and delay, the nodes that hold it and its own nodes (Set =
  selected nodes), the hinge points A and B (a node or a point picked on the surface, each with its tear force), the
  origin (the object, a node, a point) and the axis (A→B, X, Y, Z), the angles, spring, damper, latch and tear force; a
  part chosen in the Parts window opens its row or offers to add it. **The window of a part**
  (`car_editor_softbody_partwin.gd`): a click on a loose object in the view (lit in orange under the mouse) or its row in
  the layers opens a window over the view for it: Hinge part (a first pin point at the origin of the object) or Breakable
  only; the mass, Remove from loose parts; a breakable part has its break force and delay and "Breakable: it shatters"
  (its faces, the mesh `<name>_broken` or particles only, the most pieces, the particles with their shape, size and
  material or colour, Show the broken mesh, Break it now: a new car on the bench and the part breaks); a hinge part has
  its pin points (+ add: a click on the surface), each with its free axes X Y Z, the limits of every free axis (sliders),
  the turn of the pin (three angles, Reset, and the turn gizmo in the view), Opens at and Breaks off at (with a warning
  when they do not fit, or when the part lies outside its limits), and its deformation nodes (Add nodes: a click on the
  part puts one there with the rest of the car faded; the strength of all of them; the list with ✕). The view shows the
  pin points, the fan of every free axis between its limits (white: the zero, yellow: where the part lies). A model with
  an object "beams" has its shell from it: the scan, the fill and the editing of nodes are not shown then. With a tune chosen the card is shown but locked (the shell
  and the parts belong to the car; Go to Default). Ctrl/Cmd+Z undoes the nodes too (they are in the form).
- **Crash test** (the second tab of the test bar): Crash into the wall (speed, angle of the wall): a new car on the bench
  drives on its own throttle, kept on its line, into a wall of 80 m (a StaticBody3D for the body, and the walls of the
  shell: `CarShell.use_walls`, `WallGrid.add_body`); the camera goes with the car until the hit, a bar over the view shows
  the speed and Stop crash test, and the card reports the peak deceleration, the bend, the energy taken up of the energy
  of the car, the torn anchors and beams and the parts that came off. Apply force (km/h): an arrow on the surface under
  the mouse, a click fires an invisible cube of a tonne and a metre at the car there (`CarShell.pusher`, a contact of
  its face with the nodes under it, or the own nodes of the part that was hit), and the card says its peak force, how far
  it went into the shell and what it did. A part that hangs on a hinge, breaks or comes off at a force feels the hit
  itself (`CarParts.hit`): it opens past its latch or the force of a pin, tears at its break force, shatters; the card
  says what it did. The view helpers (the camera markers, the axes, the arrow, the grid) go while a crash test runs.

The Soft body and the Driver cards are ported apart: the editor loads `scripts/editor/car_editor_softbody.gd` and
`car_editor_driver.gd` when they are there (`CarEditor.CARD_HOOKS`): an object with `setup(editor, card_body)`,
`fill(cfg)`, `read(cfg)` (writes its part into the car.json that is saved), and if it likes `frame(dt)`,
`on_model(root)`, `picked(hit)` (a click on the model), `open_part(name)` (a click on a part in the layers), `click`,
`key`, `crash_tab(pane)` and `bench_stopped`.

Not ported: the rider of a motorcycle on its grips and pegs; the material field "reflection" (envMapIntensity) has no counterpart per material in Godot: it
scales the specular of a dielectric, the colour of a metal (to white at most) and the clear coat, which is closer but
not the same. Of the browser's page also not: the width of the Layers panel by dragging, the cards, the test bar and the
engine mode remembered, the big chart beside the side bar, the car of last time opened at the start. The menu picture of
a car is made again after a save (its preview.webp to the Trash, as the browser does); the cockpit thumbnail leaves the
driver out, as the game does inside.

Test of the Soft body card: `Godot --headless --fixed-fps 120 --path godot res://tools/test_softbody_card.tscn` (the
hatchback in and out of the card unchanged, the shell on the bench, the scan, a node and a beam set, a strength, a node
added and removed, the lasso, the gizmo, the Parts window, the window of a part (hood: a pin added, an axis, a limit, the
turn gizmo, nodes of the part with the rest faded, the lock; left-taillight: Break it now; an object that is no part
yet: Breakable only), the lock of a tune, the crash test and Apply force (also at the left door, which opens or tears
off); nothing is saved). Pictures: `shot_car_editor.tscn -- --car=hatchback --open="Soft body" --scroll="Soft body" --shell=1|edit
--sel=3,4`, `--window=Strengths|Parts`, `--crashtab=1`, `--crash=50 --angle=20 --wait=12`.

Test of the Driver card and the driver: `Godot --headless --path godot res://tools/test_driver.tscn -- --out=/tmp/folder`
(see "The driver"); pictures: `shot_car_editor.tscn -- --car=go-kart-250cc --open=Driver --scroll=Driver --driver=handL --steer=-90`.

Tests: `Godot --headless --path godot res://tools/test_car_editor.tscn -- --out=/tmp/folder` opens the hatchback, drops it
on the bench, runs the Full test (every stage, the limiter, a metre each way, both locks, the wall), the flame test,
changes fields, saves it as zz-editor-test into that folder (never the garage or web/), checks the car.json
(the keys, their order and the number format of the browser), ships a tune with it and takes it off again (the tunes
of the test in its folder: `Tuning.tunes_root`), opens the window of Save and test, and makes a new car from Kart.glb. The game drives a car of
that folder with `--set=garage_folder:'"/tmp/folder"'` (add `--keep` to the test to keep the files). Pictures:
`Godot --path godot res://tools/shot_car_editor.tscn -- --car=openracer-muscle --open=Engine --scroll=Engine --dyno=1
--shot=/tmp/editor.png` (also `--select=follow|ex1|model|mt:front:lower_ball`, `--suspension=1`, `--tests`, `--drop=1`,
`--window=Cameras|Materials|Sound`, `--partwin=hood --pin=0`, `--flames=1 --cam=x,y,z --look=x,y,z`, `--fulltest=1`,
`--savetest=1`).

## Track editor

The track editor of the browser (`web/tools/track-editor.html`, track-editor.js, track-design.js, heightmap.js) in
`scripts/editor/`: main menu, "Track editor", or `-- --editor` (`--editor=<id>` opens that track). The side bar has
the cards of the browser: Track (open a track, New track, Delete… for a track of the garage, Height map…, name, id,
description; opened without a track it asks what to do: the track of last time, Open track with the pictures of the
tracks and a search, Import height map or New track), Ready to race, Reference image (a picture to draw over: opacity,
place, Scale by two points in metres or feet), Model
(import a .glb or .gltf), Surfaces (the role of every part: road, pit lane, grass, ground, sand, gravel, mud,
scenery, decor), Start and lap gates (Fill the grid, Gate 1 at the start, Auto gates, Show the checkpoints), Pit
boxes and the pit line, Objects (the library of `web/objects` and `user://garage/objects`, + adds a glb; the
prefabs on a track with a model, with the texture of a prefab that has a choice; every tile with a picture of its
model, drawn in the editor when it has none (`model_thumbs.gd`) and kept beside a model added to the player's
library; × takes a model out of the library, + keeps a model of the track in it; rigid, static or decor and the mass,
also written into the library; origin), Curbs (width, height, colour, connect to the
road, the size and the offset of a node, Taper the ends), Cinematic cameras (and their range), AI racing line (Edit
the line, Draw the line, Apply, Forget) and Sky and light; at the bottom Thumbnail (preview.webp), Export zip, Test
drive (saves and drives it with the car of the menu) and Save. The view: the tools in a bar at the bottom (1 to 0:
Look, Grid box, Pit box, Pit line, Add gate, Drag strip, Place object, Add camera, Draw curb, Measure; on a road of
nodes N, B, G, P: Edit road, Branch, Surfaces, Prefabs with Draw/Points and Attach to road), at the top right Save,
the colours of the surfaces, Snap 1/2/5 m, From above, Undo/Redo (all of the track), Layers and ? (the keys); the
panel of what is chosen with its numbers, the drag strip window and the drawer of the road (Track, Branches,
Surfaces, Prefabs). Left drag turns the view, right drag moves it, the wheel zooms to the pointer; what is chosen
has handles: the middle moves it, the ring turns it, the square scales it, the arrow lifts a node of the road.
Keys as in the browser: Delete, Escape, Enter, Ctrl+Z/Y/D/S, F, T, End, W E R. The panel of a chosen object also has
its tilt (forward, sideways) and its scale per axis. Saving under the id of another track asks Replace the track?; Fill
the grid, Fill the pit boxes, Auto gates and the Clear buttons ask before they replace more than one; removing a model
that is placed asks too. The old pit area of a track of before (a polygon) is drawn and has Remove.

Record AI racing line (the AI racing line card; main.js recordLine): the saved track (changes are saved first; it needs
a gate) is driven in the game with the car of the menu, alone, without ghost or records (`scripts/line_recorder.gd`): every lap
that counts replaces the line, Esc or Stop writes the last one as "racing_line" of track.json (every third sample,
rounded to centimetres, and line_date) and comes back to the editor, which says what came of it.
`-- --car=<car> --track=<track> --record-line=1 --ai --record-laps=1` records a lap of the AI. The draft: what is not
saved is kept every 8 s and when the editor closes (`user://track-editor-draft.json`; the tests: their folder); the next
time that track is opened the editor offers to restore it, and a save throws it away.

A track is saved as `track.json` in the format of the browser (the numbers rounded as it does) with its files, in
the garage (`user://garage/tracks/<id>/`; files it has not got come from the game's folder of that id) or, when the
game runs from the repository and "Save in the repository" is ticked, in `web/tracks/<id>/` (and `index.json`). A
road of nodes is built as track-design.js builds it (the same centripetal Catmull-Rom curve as three.js,
`scripts/catmull_rom.gd`; the road, shoulders, terrain, branches, surfaces and prefabs come out part for part as
the browser's, `res://tools/test_design.tscn -- --track=go-kart-track-1`; surfaces of the track's own: New surface, Edit
surface with a name, a colour or a repeating texture with its tile size, and the grip; an area with Connect to road
closes along the visible edge of the roads and the curbs, over the outside of a curb that lies on the edge and back,
as edgeGraph does) and written as `<id>.glb` with
GLTFDocument, the hidden triangles left out. The game draws what the editor makes: curbs (`scripts/curbs.gd`, road),
the grid boxes, the pit area and the checkpoints with the arrow to the next gate (`scripts/track_marks.gd`), the
objects (`scripts/track_objects.gd`: a rigid one sleeps until a car's box pushes it and the push comes back to the
car, a static one is a wall, decor only shows), `double_sided`, and on a road of nodes without a recorded line the
middle of the road as the racing line (`scripts/racing_line.gd`). A part of a model that track.json does not name is scenery, as in
TrackLoader.js (it was road): scenery and static objects lie on a layer of their own (`Track.SCENERY_LAYER`) that the
body of a car and the loose parts meet and the wheels do not, as the wheels of the browser meet only the drivable
triangles (Ground.js).

Test (never in the garage or in web/): `Godot --path godot res://tools/test_track_editor.tscn -- --out=/tmp/te`
(with a window and `--shot-dir=/tmp` it takes screenshots) uses the tools with the mouse on testtrack, draws a new
road with a node, a prefab row, a tree and a gravel area, saves both into `/tmp/te/tracks/`, checks the fields of
track.json, and saves go-kart-track-1 again unchanged (its design, grid, gates, pit, objects and surfaces equal,
the curb points within 1 mm); it also checks the way of a connected surface over a curb, the draft and its
restore, Record AI racing line, a picture of a model, a surface of the track's own, the feet, and two cameras of the
editor that `test_replay.tscn -- --content=<that folder> --track=te-test-design` films from. A saved track drives with `-- --content=<a folder with tracks/ and links to web/cars>`.
Not yet: the touch layout and the loupe of the browser, the side bar that narrows to the
card of the work at hand, the gizmo of the reference image (its place is in fields), the tracks in the old
geometry/scene format, the size and depth of a height map shown when it is chosen. The cameras of the editor are not
interpolated (the physics interpolation of the project drew a marker from where the camera had been: "p.d == 0"). On desert-drag-strip the barrier on the strip (`prefab_barrier_1` of the design) is scenery in the browser
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
required, so a test never writes into the player's data; --video needs a window). The soft body is in it
(`scripts/replay_soft.gd`): a record of the shell, the parts and the wheels of a car whenever one changed, played
back with the dent of the time, the parts that were off as copies where they were (with the dent they had when they
came off) and the wheels with their bend or off; it is in the saved file too (`test_crash.tscn -- --replay=1`).

The effects are in the replay too (`scripts/replay_fx.gd`, Replay.js attach): every effect records what it makes as a
row with the time, and the replay makes it again with the same code, forwards in small steps, or as it was at the time
of a jump (from the rows of its last seconds, or rebuilt from all of them); what the game showed is put back at the end.
The skid marks (every strip), the tyre smoke and dust (where and how much, 15 times a second), the marbles (where they
came to rest), the debris, the pieces and the shards of a part that broke, the drops and the stains of a leak (the
coolant dried as far as it had), and every second the hour, the weather, the sun, the moon and the wet, snow and puddles
of the ground. They are in the .oreplay files ("fx"; not the pieces, which hold meshes). Test:
`res://tools/test_replay_fx.tscn -- --replay-dir=<tmp> --video-cfg=<tmp> --user-dir=<tmp> --steer=1`.

After the finish of a race the camera is the cinematic camera of the track (main.js startAutopilot, `Replay.live_cine`;
C takes the camera of the game back), and the AI drives the player's car at most half of the top speed reached in the
race.

## Pit stops and the drag strip

The pit stop (`scripts/pit_stop.gd`, Pit.js): with "Tyre temperature and wear" on, the player's car standing still
in pit box 1 of the track (track.json `pit.boxes`, drawn on the road with their numbers) is serviced: the tank is
filled at 6 L/s, the tyres are changed when the most worn is past 15 % or one leaks, and with damage on the car is
repaired; the parts go side by side, with 1.2 s to lift the car and to drop it, and the car is held until it is done.
The HUD shows "PIT STOP 3.2 s · repair · tyres · fuel". A repair takes 1.5 s more for every wheel that is bent or off,
and the dents and the bent wheels go back bit by bit through it. Test: `res://tools/test_pit.tscn -- --set=tyre_wear:1
[--bend=1]`.
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
a free drive starts clear, as in the browser. The ground can also be fixed (`gfx_ground`: Follows the weather, Dry,
Wet, Snow; the Graphics page and Save and test of the car editor), as Atmosphere.js groundOverride does.

    Godot --headless --fixed-fps 120 --path godot -- --car=openracer-muscle --track=kartbaan-oldenzaal --ai --quit-after=100 --set=gfx_weather:rain
    Godot --path godot res://tools/test_graphics.tscn -- --ai [--shot=file.png] [--hdr=file.hdr]

The test sets the presets and the weathers for that run only and prints what the viewport, the environment and the
ground are. The AI on kartbaan-oldenzaal with the muscle car: 35.9 s dry, 41.1 s in the rain, 45.3 s for the first lap
in snow (it gets slower as the snow builds up). No headlights: the night is dark, as in the browser (Atmosphere.js and
Car.js have no light of the car; its menu says so too).

## The look of a car: suspension rig, paint and mirrors

`scripts/car_visuals.gd` (one node per car, made by `Car._build_visual`) holds three parts:

- **The suspension rig** (`scripts/suspension_rig.gd`, SuspensionRig.js): the parts of the model named `susp_lowerarm_FL`,
  `susp_upperarm_FL`, `susp_upright_FL`, `susp_spring_FL`/`susp_strut_FL`/`susp_damper_FL` (a coilover's `_piston` slides
  and its `_coil` is squeezed), `steer_rack`, `steer_tierod_FL`, `susp_axle_rear`, trailing arms, a Panhard rod,
  driveshafts and propshafts, and the same parts that the parts library builds from car.json `suspension` and `driveline`
  (`PartsLibrary.assemble`, as CarLoader.js does), follow the travel of every wheel and the steering: arms swing, uprights
  go up and turn, springs get shorter, the rack slides, a live axle rises and rolls, shafts turn with the wheels. The
  muscle car (double wishbone front, live axle on leaf springs rear) and the hatchback (MacPherson) use the library. The
  fixed tie rods on a steering column (a kart) are ported but need a steering wheel to give the column (`rig.column`).
- **Materials and paint** (`scripts/car_paint.gd`, MaterialOverrides.js and CarColors.js): car.json `materials` (colour,
  metalness, roughness, opacity, clear coat, "reflection" as the specular) and `colors` (the body: materials called
  carpaint, the rims: rimpaint) with every finish: gloss, satin, matte, metallic, pearl, metal flake (the patterns noise,
  voronoi, hexagons, marble as normal maps made in code, at a size, on the UV map of the model or generated: Godot's
  triplanar mapping), candy, chrome, brushed. A changed material is a copy per car (surface override), so the model and
  the parts library keep theirs; the tuning menu's paint rows work while driving. The car editor uses the same code
  (`CarEditorMaterials.apply_override`, `apply_paint`). Pearl is approximated (Godot has no thin-film iridescence: a rim
  light stands in).
- **Mirrors** (`scripts/car_mirrors.gd`, Mirrors.js): the glass of the model (a material called mirror or spiegel that is
  a metal) turns about its middle by Settings, Mirrors (turn and tilt per mirror, at most 25 degrees), and a real mirror
  (on by default; the browser's option mirror*Real) shows what is behind it: a SubViewport 512 pixels wide with a camera
  at the mirror image of the eye, whose frustum is the glass (its near plane on the glass), projected onto the glass;
  every second frame, only for the car the camera rides in with the cockpit or bonnet camera, only when the glass is in
  view. The glass is left out of the soft body (it does not dent) and out of the pictures of the mirrors.

Test: `Godot --headless --path godot res://tools/test_car_visuals.tscn` (the rig of the muscle car and the hatchback found and
moving with travel and steering, the overrides and the paint, the patterns, the mirrors aimed and made real from the
cockpit). Pictures (without --headless): `-- --car=hatchback --shot=file.png [--view=side|below|front] [--hide-body=1]
[--corner=FL --travel=0.06 --steer=0.35]` (a corner with the wheel up and steered), `-- --mirror-shot=file.png
[--set=mirror_left_tilt:25]` (the cockpit with marks behind the car, and the picture of each mirror).

## Controls

The keys of the browser game (web/js/Settings.js): W A S D or the arrows drive, Space handbrake, P parking brake, . reverse
(held), Q two-step, F transbrake, X / Z shift (the first shift makes the gearbox manual), an H-shifter (gear 1 to 8 and
reverse, buttons of a wheel), R back on the racing line, 4 saves the place for R on a track without a line, Backspace repairs
the car where it is, Home back to the start, T camera, [ ] turn the follow camera round the car and ` puts it back, H the
HUD, F3 the debug text, F2 a photo without the HUD (in the pictures folder, O-Racer), C / B / N / J / Y traction control,
ABS, ESC, launch control, two-step on and off (a short note says it), I starts the engine, E the engine sound, V the
telemetry, 0 the debug view (- hides the car), U tuning, K calibrates a wheel, M the wheel on and off, F8 a mark in the
log, Esc pause. A gamepad: the triggers gas and brake, the left stick steers, A handbrake, the shoulders shift, X camera,
Y back on the line, Back repair, Start pause. On a motorcycle `,` and `.` put the rider back and forward while held
(and in the air the nose up and down), 9 makes the rider go limp (see Motorcycles). 5 starts and stops a take (Take.js); the camera key goes through follow, cockpit, bonnet and the free
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
The Garage window (export, delete to the Trash, import a zip or a zip at a link, link a folder, Load and New open the car
editor or the track editor) and the Replays window (`ReplayFiles.open_dialog`: watch, edit, delete, open a file, the
folder). The choice is kept in `user://menu.cfg`. Screenshots: `--menu-step=car --mode=race
--menu-shot=file.png --shot-at=3` (home, mode, car, tune, track, weather, race, opponents, surface, garage, replays).

**Settings** (`scripts/settings_menu.gd`, `settings_pages.gd`, `settings_rows.gd`, `settings_controls_page.gd`): the tabs of
the browser, Car, Keyboard, Gamepad, Wheel (with the calibrated wheels and Forget), Display and sound, Mobile (with the touch
controls), Graphics, Simulation, Tools (debug text, back up and restore the settings, the records and the tunes in one file,
forget the records of a track, Save as HDR), Controls (with the free camera's P and O and the take key 5); Reset all
settings. Nothing is grey now (SettingsRows.NOT_IN_GODOT is empty). The keys, the stick and the touch screen steer as the
browser does (`scripts/steer_model.gd`: Car.js for the keys, the time to the lock, slower and a smaller lock at speed,
the centring and the curve; controls.js for the stick, 6 rad/s divided by 1 + "slower at speed" x speed / 10); the AI
cars' soft body takes the fewest steps of "AI cars: soft body detail"; a touch device (a phone or a tablet, or
`--touch=1`) starts on the Low graphics. Test of driving with keys: `res://tools/test_keys.tscn -- --user-dir=<tmp>`. The steering assist of the keys and the pad (the front wheels turn into a slide), AI cars damage
(always, only near my car within its range, off) and the debris rows work. The motorcycle options (shown with a motorcycle): Motorcycle steering (lean only, or countersteer + lean: the
push on the bars that starts a lean, off on the brake and back slowly after it), Wheelie control, Flat-track style for
every bike, the Motorcycle follow camera (it rolls with the lean, or the classic chase of a car), the lean at top speed. The pause menu (`scripts/pause_menu.gd`): Resume, Replay, Tune the car, Restart, Back to the
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
the shell, the engine bay and the radiator, the contacts of the wheels; a panel with the node grabber (the left mouse
button on a node drags it on an elastic; its strength a slider), the hit of the middle mouse button (a cube of a tonne at
the speed of the slider, along the view, against the shell; the car feels it; on a tyre the wheel takes the damage by
the impulse against softbody.wheel_strength and can come off, on a part that is off the car its body takes it), Open
hinges (a right click opens a hinge, another closes it where it was) and Break parts, Pit stop here (a stop where the
car stands), a motorcycle's crash rules and rider (`scripts/debug_crash_rules.gd`: each rule on or off with its limits,
with the browser's wall and "only hard hits" rules, how the rider gives with the g-forces, a meter of the push and the
g; kept in the prefs of the video), the weather and the time of day. Test:
`res://tools/test_debug_tools.tscn -- --user-dir=<tmp> --video-cfg=<tmp>`.
**Telemetry** (V, `scripts/telemetry.gd`): every value of the car and the wheels. **Touch controls**
(`scripts/touch_controls.gd`, TouchControls.js): on a touch screen (or `--touch=1`, Settings Mobile): the steering stick
on the left half, the pedals, the gear buttons and the top buttons (Record: a take, red with Stop while it runs). **Movable panels** (`scripts/movable.gd`): the tuning
menu, the debug panel and the HUD editor are dragged and scaled, and kept. Icons of Lucide (`scripts/icons.gd`).

The car tiles: every car turns in 3D on its tile (MainMenu.js showcase): the cars stand in one world, each on a render
layer of its own, and every tile has a small viewport with a camera on its layer (the browser draws them one by one with
one renderer; 19 at once, a tile past them keeps its still picture). A setup that looks otherwise than the car (its
rims, tyres, colours, parts) has a picture of its own. Not ported: the browser's storage notes; TextureBudget.js (the
phones of the browser) has no use here.

## Physics parity

The physics of every car and bike are held against the browser game's own: `godot/tools/parity-bench.js` runs
web/js/Vehicle.js (with Engine.js, Wheel.js, TyreShell.js, Motorcycle.js) headless in node, set up as the game sets
up a car (vehicleParams and the retune of Opponent.js, the rubber, tread and size of a custom tyre and the shift
style as Car.js gives them), and `res://tools/test_parity.tscn` runs the same road test in Godot with the same
controllers, on a flat floor: full throttle from a standstill (0-50, 0-100 km/h, the top speed, every upshift with
the engine speed before it), the brakes from 100 km/h (50 when the top speed is under 110), and a skidpad of 40 m
(the steering held on the curvature of the path, the speed raised by 0.25 m/s a second: the most speed x yaw rate
while the car follows the circle). TC on (as the AI drives) when the car has it, ESC off, ABS on, no wear and fuel.

    godot/tools/parity.sh [simple|shell] [car ...]        # both, side by side (PARALLEL=4 cars at once)
    node godot/tools/parity-bench.js <car> [--shell] [--verbose]
    Godot --headless --path godot res://tools/test_parity.tscn -- --car=<car> [--tyres=simple|shell]
        --user-dir=/tmp/x --set=tc:true,esc:false,abs:true,tyre_wear:0 [--only=brake|skidpad|coast --from=150] [--verbose]

What was different, and is now as Vehicle.js has it:

- The drivetrain (`scripts/car_drivetrain.gd`, new, out of car.gd): the CVT (the ratio for the engine speed the
  throttle asks for, from the road speed, at most e^cvt_rate a second; the kart's went to its top ratio on the spinning
  wheels), the automatic gearbox and the timing of every shift (shift_time; a dual clutch 0.08-0.15 s with its cut and
  blip, an automated manual half a second at least; the clutch open and taken up in the last 0.14 s; the throttle at
  15 %), the ABS (a wheel past the peak of its tyre, released to 5 %), the torque converter's stall at 35 % of the
  limiter without tc_stall_rpm, the limited slip with diff_lock and its calm above 25 km/h, the centre differential
  (lsd, locked), the welded axle as Vehicle.js steps it, the clutch of car.json for every gearbox (1050/2000 rpm).
- The simple tyre: the slip along the wheel relaxed over 0.35 m as the slip across, the wheel turned explicitly in steps
  of 1/360 s (Vehicle.js: 3 ms at most), the damping of the slip speed (400 N per m/s), and the rolling resistance as a
  force at the contact (not a torque on the wheel), four times on grass; the brake over the same inertia as the grip
  (a braked wheel settled where its tyre gave (I + dt slope) / I times the brake torque: the hatchback stopped in 31 m
  where the browser needs 40).
- The centre of gravity between the axles where they are (front_axle_offset, rear_axle_offset moved the axles and not
  the centre of gravity: the dune buggy had a third less on its front and stood nose up, 200 N of the springs against
  the travel).
- The camber of the roll (Vehicle.wheelLean adds the roll of the body to the lean of a wheel: the outer wheel leans into
  the bend; Godot took it away), a kart's from the twist of its frame and the lift of its inner rear wheel.
- The drag area 0.85 x width x height (it was 0.82) and the air 1.29 kg/m3 (1.225); the anti-roll bars of
  Vehicle.layout (a bar on the axle short of its share only); the wheel inertia (1.6 kg m2, a light vehicle by its mass
  and its tyre); the defaults of car.json (a limited slip with 150 N m of preload, rebound 1.7, tc_ratio 1.9, the
  travel 5 cm short of the room); the engine inertia of car.json (0.4 without one; it was held at 0.06 at least).
- The engine braking: Engine.js holds the motoring of a small engine at 0.3 of the 580 N m engine, Godot had 0.04 so a
  kart engine of 30 N m idles; now 0.04 at idle and the floor of Engine.js from twice the idle speed, for a car. A
  motorcycle keeps the lighter one (with the floor of Engine.js the AI's Sports 600 went light at the rear on the
  brakes into the last bend of Kartbaan Oldenzaal, ran on to the grass and fell).

The simple tyre (the AI cars, and the player's car on Simple), browser / Godot before / Godot after:

| car | 0-50 (s): browser / before / after | 0-100 (s): browser / before / after | top (km/h): browser / before / after | brake (m): browser / before / after | skidpad R40 (g): browser / before / after |
|---|---|---|---|---|---|
| dune-buggy | 2.5 / 3.0 / **2.5** | 6.9 / 8.1 / **6.9** | 212.9 / 196.6 / **209.2** | 38.4 / 33.6 / **37.8** (100-0) | 1.26 / 1.01 / **1.13** |
| enduro-600 | 3.3 / 3.2 / **3.0** | 7.4 / 6.7 / **6.3** | 183.2 / 181.6 / **184.0** | 48.3 / 58.4 / **44.6** (100-0) | 0.25 / 0.31 / **0.31** |
| go-kart-250cc | 4.5 / 5.9 / **4.3** | 12.2 / 13.2 / **11.7** | 157.5 / 157.6 / **157.5** | 40.1 / 54.5 / **38.9** (100-0) | 1.62 / 2.15 / **1.79** |
| hatchback | 8.1 / 8.1 / **7.4** | 18.2 / 18.1 / **17.6** | 154.7 / 158.7 / **154.3** | 40.4 / 30.9 / **39.9** (100-0) | 1.74 / 1.63 / **1.68** |
| openracer-kart | 12.7 / 12.9 / **11.6** | - / - / **-** | 72.0 / 72.0 / **72.0** | 12.3 / 15.2 / **12.5** (50-0) | 1.00 / 1.01 / **1.01** |
| openracer-muscle | 1.6 / 1.4 / **1.5** | 4.3 / 4.2 / **4.2** | 213.6 / 213.6 / **213.6** | 27.9 / 28.8 / **29.3** (100-0) | 1.56 / 1.63 / **1.63** |
| sports-motorcycle-600cc | 2.8 / 2.2 / **2.2** | 6.8 / 4.2 / **4.2** | 213.8 / 240.8 / **240.9** | 47.7 / 49.9 / **57.5** (100-0) | 0.75 / 0.85 / **0.85** |
| stadium-truck | 27.0 / 31.2 / **29.3** | - / - / **-** | 59.8 / 60.9 / **59.5** | 7.5 / 5.6 / **7.6** (50-0) | 0.00 / 0.00 / **0.01** |
| supermoto-700 | 3.3 / 2.6 / **2.6** | 10.8 / 5.8 / **6.8** | 152.8 / 177.5 / **177.6** | 45.8 / 37.4 / **38.8** (100-0) | 0.58 / 0.66 / **0.66** |

The shell tyre (the player's car), browser / Godot before / Godot after:

| car | 0-50 (s): browser / before / after | 0-100 (s): browser / before / after | top (km/h): browser / before / after | brake (m): browser / before / after | skidpad R40 (g): browser / before / after |
|---|---|---|---|---|---|
| openracer-muscle | 2.4 / 2.2 / **3.3** | 5.1 / 5.2 / **6.4** | 203.6 / 194.6 / **194.3** | 33.6 / 33.4 / **33.4** (100-0) | 1.27 / 1.26 / **1.26** |
| hatchback | 5.5 / 6.3 / **6.4** | 16.2 / 20.1 / **20.5** | 123.6 / 125.9 / **124.1** | 33.4 / 36.7 / **35.3** (100-0) | 1.23 / 1.09 / **1.13** |
| go-kart-250cc | 3.8 / 4.3 / **3.1** | - / 12.2 / **9.6** | 86.9 / 119.7 / **119.3** | 12.7 / 41.0 / **50.9** (50-0) | 0.14 / 0.49 / **0.50** |
| dune-buggy | 1.7 / 2.4 / **1.5** | 4.9 / 5.3 / **3.9** | 232.2 / 206.4 / **215.6** | 41.2 / 33.2 / **34.2** (100-0) | 1.17 / 1.15 / **1.20** |
| stadium-truck | 19.2 / 20.1 / **19.2** | - / - / **-** | 59.8 / 68.0 / **66.7** | 8.4 / 10.8 / **9.7** (50-0) | 0.60 / 0.64 / **0.63** |

The shift points are the browser's within 1 %, every gear of every car (the dune buggy shifts at 7136-7138 rpm in
both, the Sports 600 at 13 600-13 800).

Still different, and why:

- The motorcycles accelerate faster and reach a higher top speed in Godot (the Supermoto 0-100 in 6.8 s against
  10.8, 178 km/h against 153). In the browser the front wheel of a bike on the simple tyre hops (its load drops to
  nothing several times a second, also at 200 km/h), and the wheelie control takes the throttle away at every hop
  within 0.03 s and gives it back over 0.25 s: the bike runs at about 60 % of its throttle. Godot's front wheel stays
  on the road; copying the hop would be copying a fault. The coast-down of a bike is the same (1.42 against 1.44 m/s2
  from 150 km/h), and so are the shift points. Their braking differs by their engine braking (above) and the bike's
  fork and swingarm, which are Godot's (MotorcycleModel).
- The browser's simple tyre on a braked wheel that does not drive gives more than its brake (the force of the relaxed
  slip goes to the body while the wheel is only brought back to the road speed): the Muscle's front tyres give up to
  2.7 times their brake torque at a walking pace. Godot steps it the same way, in the same steps, and is within 5 %.
- The skidpads of the karts: the browser's kart on the simple tyre hops on its stiff tyres (its loads drop to nothing)
  and its lateral acceleration is noisy; the go-kart is 10 % over, the dune buggy (welded front and rear) 10 % under.
- The stadium truck (the committed car.json: a 37 N m engine, which the user is changing) takes 27 s to 50 km/h in
  both and does not follow the circle of the skidpad at walking pace in either.
- The shell tyre: the braking and the skidpad are within a few percent; the acceleration of the Muscle is slower
  (6.4 s to 100 against 5.1: the traction control cuts more on the shell, whose rear tyres run at 15-20 % of slip; with
  the engine inertia of before, 0.06, it is 5.2 s), and the go-kart on the browser's shell tyre is a car of its own (top
  speed 87 km/h, 0.14 g on the skidpad: it spins).
- In the browser, without the traction control, the Muscle on the simple tyre does not get past 32 km/h: its welded
  rear axle rings at the launch with the engine of 0.02 kg m2. The bench therefore runs with TC on.

The AI on Kartbaan Oldenzaal (`--ai --ai-learned=0`, 220 s), before / after: the go-kart 33.1 / 38.1 s a lap (the CVT
now holds the engine at the speed the throttle asks, and the engine brakes as in the browser), the Muscle 36.2 / 35.8,
the Sports 600 45.2 (a lap not counted) / 44.9, the hatchback 43.7 / 42.4, the Supermoto 44.7 / 45.7, the dune buggy
63-67 / 55-57, the stadium truck 52.5 / 52.3, all clean; a race of three laps (the Muscle and three AI cars) clean, no
car put back, every car finished.

## Parity: what is still different

A pass over every file of `web/js/` and `web/tools/` and every menu, key, HUD element, setting and mode of the browser
game (November 2026). What the Godot version still lacks or does otherwise, and why:

**Race and modes** (main.js)
- The fly-by of the camera over the grid before the countdown (Enter or Space skips it): not ported; the race starts
  with the countdown at once.
- The results: a table written once (absolute times, "lap n"), where the browser has a headline ("You won!",
  "Finished P2"), the gaps (+1.234, +1 lap) and rows that change as the others come in.
- A race on a track without a racing line: the browser runs the laps and the countdown without AI cars; Godot drives
  free there (it says so).
- The banners "no pit lane here" and "no best lap yet: the ghost comes from the next start": not shown.
- The racing line: the browser shortens a recorded line inside the road (`shorten`, the AI cuts the bends; `?cut=0` is
  the Godot behaviour), settles it on the ground and turns it the way of the start; Godot reverses only a line of a
  designed road.
- The grip measured on the skidpad (OpenRacer.SkidpadGrip) is not used by the AI.
- "Save the replay?" is asked only from Main menu of the pause menu, not on Restart or Race again.
- A car or a track that is missing: an error in the log, where the browser shows a dialog (`?missing=`).

**Settings and keys**: a motorcycle steers with the keys by Godot's own lean command (key_steer_speed), not the
browser's keyRate (the car's keys, stick and touch screen are the browser's).

**Tuning** (Tuning.js): the mirrors are in Settings, Mirrors; the chart of the Engine card is in the card, not pinned
at the left of the menu; a motorcycle is built again with the wheel and parts library at the next start.

**Main menu**: past 19 car tiles at once the others keep their still pictures. No "Copy game link" (`?import=`): the Godot game has no address.

**Replay**: the pieces of a part that broke are in the replay but not in its files (they hold meshes); the snow scraped by
the tyres (the tiles of the ground) and the rider's ragdoll, the drag tree lamps, the exhaust bangs and the pit stop's
tyres and parts are not replayed; tyre smoke starts fresh after a jump (GPU particles cannot be wound back); browser
replay files open without their blocks (soft body, effects), and Godot does not write browser files.

**Pit stop and drag strip**: the car is not lifted on the jacks in the picture, the wheels are not seen being changed,
the parts that are put back do not fade; the drag time slip cannot be saved as a PNG.

**Effects and sound**: no tyre noise on loose ground and no thud of a hit, a landing or the bump stop (EngineSound.js);
the smoke is not pushed aside by the car (Smoke.js wisps); the flame pictures of `web/images/flames/` are not used (a
made gradient).

**Debug view**: the motorcycle crash rules are shown for a motorcycle only (the browser shows them for every car).

**Other**: the motorcycle's ragdoll, levers and fingers and model v2 are another
part of the port; in the editors the browser's part window of the soft
body card, Full test of the bench, the flame test, the autosave draft, the touch layout and the loupe of the track editor.

**Browser-only, no port needed**: TextureBudget.js, PhysicsWorker.js and PhysicsLink.js (`?worker=`), the storage notes
and "Ask the browser to keep my data", the permission of a linked folder, Zip.js, bootstrap.js, Scene.js's picture probe
(F9), EngineSimWorklet.js (C++ here), the save API of tools/serve.py, Version.js, physics-check.html and
physics-worker-check.html (the headless tests stand in for them).

## How it works

| file | what |
| --- | --- |
| `scripts/content.gd` | finds `web/`, reads json, loads glb models, the surfaces (Surfaces.js) |
| `scripts/car.gd` | the car: rigid body (Jolt), raycast suspension, tyres |
| `scripts/car_drivetrain.gd` | the gearbox, the clutch or converter, the differentials, the brakes and the wheel speeds (Vehicle.js) |
| `tools/parity-bench.js`, `tools/test_parity.tscn`, `tools/parity.sh` | the physics parity bench (Physics parity) |
| `scripts/engine.gd` | torque curve, friction, idle control, limiter |
| `scripts/car_model.gd` | the body model and the wheels (model wheels or library rim + tyre) |
| `scripts/car_visuals.gd`, `suspension_rig.gd`, `car_paint.gd`, `car_mirrors.gd` | the suspension rig, the materials and paint, the mirrors |
| `scripts/track.gd` | the track model, a collision shape per mesh with its surface |
| `scripts/atmosphere.gd`, `ground.gd`, `ground_material.gd`, `graphics.gd` | the sky, light and weather; the wet and the snow and their grip; the look of the ground; the graphics settings |
| `scripts/chase_camera.gd`, `hud.gd`, `world.gd`, `main.gd`, `controls.gd` | camera, dashboard, a drive, menu, keys |
| `scripts/steer_model.gd` | the steering of the keys, the stick and the touch screen (Car.js, controls.js) |
| `scripts/tuning_menu.gd`, `tuning_engine.gd`, `tuning_files.gd` | the tuning menu, its Engine card, its files (car.json, tune files) |
| `scripts/debug_view.gd`, `debug_crash_rules.gd` | the debug view (0), the crash rules of a motorcycle in its panel |
| `scripts/main_menu.gd`, `menu/`, `settings_*.gd`, `pause_menu.gd`, `hud_*.gd` | the main menu, the settings, the pause menu, the gauge and the HUD editor |
| `native/src/engine_sim.cpp` | the engine sound: EngineSimWorklet.js and the exhaust chain of EngineSim.js in C++ |
| `native/src/tyre_shell.cpp`, `scripts/shell_tyres.gd`, `tyre_deform.gd` | the shell tyre: TyreShell.js in C++, the wheels on it (Vehicle.js), the tread of the model pushed in (TyreDeform.js) |
| `scripts/engine_sim_params.gd`, `car_audio.gd` | the sound parameters of car.json; the engine and the tyre squeal of a car |
| `scripts/tyre_effects.gd` | skid marks, tyre smoke and dust |
| `scripts/soft_body.gd`, `car_shell.gd`, `collision_proxy.gd`, `wall_grid.gd`, `soft_body_mesh.gd`, `car_parts.gd` | the shell that dents, its contacts, its nodes, the walls of the track, the model that bends, the parts that come off |
| `scripts/wheel_rig.gd`, `shatter.gd`, `specks.gd`, `replay_soft.gd` | the suspension in the shell, a part that breaks, the small particles, the soft body in the replay |
| `scripts/marbles.gd`, `debris.gd` | marbles, debris |
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
   model that bends with it, the parts that come off, the suspension in the shell, hinges, shatter, the things
   on a track, marbles, debris *(done)*.
5. **Motorcycles**: the bike model of Motorcycle.js with its rider (`scripts/motorcycle.gd`): lean, steering from the
   lean, balance, camber thrust, posture, wheelie control, brakes, crash rules, camera roll; the front end, swingarm,
   shock and chain (`motorcycle_model.gd`), the rider with IK (`motorcycle_rider.gd`), the AI rides them; the ragdoll
   of a crash, the levers, fingers and shift lever, the give in the g-forces, the fork and swingarm in the physics,
   the rider keys, the options of the menu and the Motorcycle card of tuning *(done, see Motorcycles; not: model v2,
   which no bike of the game uses)*.
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
   `zig c++ -target x86_64-linux-gnu.2.28 -shared -Wl,-z,nodelete -o ../bin/liboracer.linux.template_release.x86_64.so
   src/*.o godot-cpp/bin/libgodot-cpp.linux.template_release.x86_64.a`, as scons on a Mac names the objects .os;
   glibc 2.28 or newer; `-z nodelete` keeps the library loaded to the end: Godot frees the last objects after it
   unloads its extensions, and their destructors were gone, a crash at quit). On Windows the force feedback looks up the SDL HID functions in the executable
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
