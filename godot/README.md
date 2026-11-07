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

The menu chooses a car and a track. Arguments after `--` start a drive at once and help to test:

    --car=openracer-muscle --track=short-track   start this drive (without the menu)
    --drive                                      full throttle (and --steer=0.5 for a circle, + is left)
    --log=1                                      print speed, gear, rpm and wheel loads every second (--verbose: each tyre)
    --shot=file.png --shot-at=5 --quit           save a screenshot after 5 seconds and stop
    --quit-after=10                              stop after 10 seconds
    --diff=open                                  another differential than car.json's
    --content=/path/to/web                       another content folder

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
on. Backspace or "Race again" starts it again. A track without a racing line has no race (free driving).

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
the start (Backspace, or the pause menu) repairs the car and puts its parts back; R puts it back on its wheels and
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
the lists with "(garage)". Not yet: export to a zip, deleting from the menu, the car and track editors.

## Replay

The replay (`scripts/replay.gd`, Replay.js): every car of the session (the player and the opponents) is recorded
30 times a second, the last half hour. Esc, Replay: the game stays paused behind it and the recording plays through
the same code that draws the cars. The bar: a slider over the whole recording, start, -10 s, play/pause, +10 s, end,
the speed (0.1x to 5x), the camera (T: follow, cockpit, bonnet, and a free camera: W A S D, Space/Z up, X down, drag the
mouse to look, F aims at the car, L goes with it, [ and ] the field of view) and the car it follows (Tab); Exit (Esc) goes back to the game where it was
left. Keys: Enter play/pause, left and right one frame (held: on), up and down one second, Home and End, H hides the
bar. Save replay (in the bar) keeps it in `user://replays` (the ids of the track and the cars, and the recording); the main
menu, Replays…, plays one in a viewer. Test: `res://tools/test_replay.tscn -- --ai=1`. Not yet: marks and fragments, video, the soft body and the parts in the replay.

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

Arrows or WASD drive, Space is the handbrake, Q/E shift (the first shift switches to a manual gearbox),
C changes the camera (behind, cockpit, bonnet), R puts the car back on its wheels, Backspace goes back to
the start, K calibrates a racing wheel, F3 shows the data of the tyres, F8 marks a moment in the log, Esc
pauses (resume, settings, back to the start, main menu). A gamepad: the triggers for gas and brake,
the left stick to steer, A handbrake, the shoulders shift, Y camera, X reset, Start pause.

All of it can be set in Settings, Controls: every action takes keys, gamepad buttons and sticks, and buttons of
the racing wheel (click a binding and press what it should be; + adds one, Delete removes one; an input that
another action had is taken from it). A gamepad binding works on every joypad but the wheel. The bindings are
kept in `user://settings.cfg`. Test: `Godot --headless --path godot res://tools/test_controls.tscn`.

Holding the brake at a standstill puts the car in reverse; then the brake drives and the throttle brakes.

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
6. **Garage, tuning and editors**: tuning menu *(done)*, replays *(the core done)*, car and track editor, garage.
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

Known in phase 1: the acceleration of the
cars with a centrifugal clutch (karts) or a torque converter is close to, but not yet compared with, the
browser game.
