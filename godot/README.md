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

## Controls

Arrows or WASD drive, Space is the handbrake, Q/E shift (the first shift switches to a manual gearbox),
C changes the camera (behind, cockpit, bonnet), R puts the car back on its wheels, Backspace goes back to
the start, F3 shows the data of the tyres, Esc goes to the menu. A gamepad: the triggers for gas and brake,
the left stick to steer, A handbrake, the shoulders shift, Y camera, X reset, Start menu.

Holding the brake at a standstill puts the car in reverse; then the brake drives and the throttle brakes.

## How it works

| file | what |
| --- | --- |
| `scripts/content.gd` | finds `web/`, reads json, loads glb models, the surfaces (Surfaces.js) |
| `scripts/car.gd` | the car: rigid body (Jolt), raycast suspension, tyres, drivetrain |
| `scripts/engine.gd` | torque curve, friction, idle control, limiter |
| `scripts/car_model.gd` | the body model and the wheels (model wheels or library rim + tyre) |
| `scripts/track.gd` | the track model, a collision shape per mesh with its surface, sky and sun |
| `scripts/chase_camera.gd`, `hud.gd`, `world.gd`, `main.gd`, `controls.gd` | camera, dashboard, a drive, menu, keys |
| `native/src/engine_sim.cpp` | the engine sound: EngineSimWorklet.js and the exhaust chain of EngineSim.js in C++ |
| `scripts/engine_sim_params.gd`, `car_audio.gd` | the sound parameters of car.json; the engine and the tyre squeal of a car |
| `scripts/tyre_effects.gd` | skid marks, tyre smoke and dust |
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
   the steering and the controls; racing wheels (SDL3 axes) and force feedback (in the GDExtension).
3. **Racing**: laps and gates from track.json, timing, ghosts, AI opponents on the racing line, grid start.
4. **The rest of the physics**: tyre heat and wear, pressure, camber, downforce, turbo, torque converter,
   traction and stability control, launch control; damage and the soft body.
5. **Motorcycles**: the bike model of Motorcycle.js with its rider.
6. **Garage, tuning and editors**: tuning menu, car and track editor, garage, replays.
7. **Release**: export for the web (openracer.eu), macOS, Windows and Linux.

Known in phase 1: one texture of the hatchback (a jpeg) does not load in Godot; the acceleration of the
cars with a centrifugal clutch (karts) or a torque converter is close to, but not yet compared with, the
browser game.
