# Motorcycles (a prototype)

`"type": "motorcycle"` in a `car.json` makes a car a motorcycle. The first one is the Honda CBR 600 RR (`web/cars/honda-cbr600`, made by `tools/make-cbr600.py`).

## How it works
The game's physics has four wheels, and a motorcycle is that physics with changes, not a second engine:

* **Two wheels as four.** Every axle has two wheels of the physics at the same place (`front_track` and `rear_track` of 4 cm). The model has the two wheels it needs and two of a millimetre (`wheel_FR`, `wheel_RR`) for the other two. The front wheel carries its own `FL` slot, the rear wheel `RL`.
* **A rider that keeps it up.** A bike does not stand by itself. In `Vehicle.js` a torque about the long axis of the bike pulls the lean to the one that the corner needs (`lean = atan(a / g)`, with `a` from the steering and the speed, and a little of the yaw rate) and damps the fall. At a walking pace the lean is held at zero. Past about 66 degrees of lean the rider lets go and the bike goes down. `motorcycle.max_lean_deg` (50), `motorcycle.balance` (1: the strength of the pull) and `motorcycle.steer_speed` (14 m/s: the speed at which the steering is a half) are in `car.json`.
* **Steering.** The angle at the front wheel gets smaller with the speed (`1 / (1 + (u / steer_speed)^2)`), so the same key is a gentle lean at 150 km/h and a full lock at a walking pace. The wheel, the fork, the clamp, the handlebar and the mudguard turn with it.
* **The bodywork can lean.** While the lean is less than 66 degrees the body spheres do not touch the road (a bike in a corner has its fairing near it); past that they do, and the bike slides on its side.
* **Different suspension at the front and the rear:** `spring_front`/`spring_rear`, `damping_front`/`damping_rear` as for a car (a fork of 17 kN/m and a shock of 24 kN/m).

## The model
`tools/make-cbr600.py` makes `cbr600.glb`. Wheels: `wheel_FL` (the tyre), `wheel_FL_rim`, `wheel_FL_disc`, and the same for `RL`, listed in `wheels.nodes` of the car. What steers with the front wheel without spinning is a part whose name ends in `FL` and starts with or contains `brake` (`brake_fork_FL`, `brake_handlebar_FL`, ...): the loader hangs the parts of a brake caliper on the steering of its wheel.

## The engine sound
The sound is the combustion model of the game, with parameters. New presets in `web/js/EngineSim.js`: *Single 0.65 L (thumper)*, *Inline-3 0.8 L (triple)*, *Inline-4 0.6 L (supersport)* and *Inline-4 1.0 L (superbike)*. `node tools/check-engine-sound.js [preset]` (or `--car honda-cbr600`, `--wav file.wav` to write eight seconds from idle to the limiter to listen to) runs the real worklet without a browser and says if a preset is silent, clips or has not got the pitch of its firing frequency.

## What it cannot do yet
* A rider (no driver model; the driver editor has no bike seat).
* The tyre is a cylinder: at a lean the contact patch moves to its edge. There is no camber thrust of a round tyre.
* A wheelie and a stoppie are there (the springs and the weight transfer do them), but the rider does not catch them.
* Crashes: after about 66 degrees the bike falls over and slides; the rider is not thrown off.
* The suspension of the model (the fork that goes in) does not move; the physics does.
