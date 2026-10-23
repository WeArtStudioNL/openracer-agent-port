# Motorcycles (a prototype)

`"type": "motorcycle"` in a `car.json` makes a car a motorcycle. The first one is the Honda CBR 600 RR (`web/cars/honda-cbr600`, made by `tools/make-cbr600.py`).

## How it works
The game's physics has four wheels, and a motorcycle is that physics with changes, not a second engine:

* **Two wheels as four.** Every axle has two wheels of the physics at the same place (`front_track` and `rear_track` of 4 cm). The model has the two wheels it needs and two of a millimetre (`wheel_FR`, `wheel_RR`) for the other two. The front wheel carries its own `FL` slot, the rear wheel `RL`.
* **A rider that keeps it up.** A bike does not stand by itself. In `Vehicle.js` a torque about the long axis of the bike pulls the lean to the one that the corner needs (`lean = atan(a / g)`, with `a` from the steering and the speed, and a little of the yaw rate) and damps the fall. At a walking pace the lean is held at zero. Past about 66 degrees of lean the rider lets go and the bike goes down. `motorcycle.max_lean_deg` (50), `motorcycle.balance` (1: the strength of the pull) and `motorcycle.steer_speed` (14 m/s: the speed at which the steering is a half) are in `car.json`.
* **Steering.** The steering is a wish for a bend, not an angle: the angle that the keys or the wheel give is cut to what makes at most `motorcycle.max_lateral_g` (0.9) of sideways acceleration at this speed (`a = u^2 delta / L`; the more the steering is turned, up to half of the lock, the more of it is allowed), and the front wheel follows it with a delay of 0.07 s. So the same key is a gentle lean at 150 km/h and a full lock at a walking pace. The front end turns about the axis of the fork (`motorcycle.rake_deg`, 24.5), not about the vertical. The steering assist of the keyboard (the front wheel that follows a slide) is off for a bike.
* **Staying straight.** The rider also damps the yaw that the steering did not ask for (a torque about the vertical), which a bike with a light rear wheel in hard braking needs.
* **Braking.** The front brake is let off as the rear wheel loses its load (a stoppie goes over the front), and the rear brake goes with the load of the rear wheel (a light rear wheel that locks has no side grip). The engine braking of the CBR is 0.3 (a slipper clutch): at 1 the rear wheel slid at 30 % slip when the throttle was shut and the bike swung round.
* **The bodywork can lean.** While the lean is less than 66 degrees the body spheres do not touch the road (a bike in a corner has its fairing near it); past that they do, and the bike slides on its side.
* **Different suspension at the front and the rear:** `spring_front`/`spring_rear`, `damping_front`/`damping_rear` as for a car (a fork of 17 kN/m and a shock of 24 kN/m).

## The model
**The front end.** Two sets of parts, by name. What stays on the bike and only turns with the steering is `steerhead_...` (`steerhead_cylinder`: the upper tubes of the fork, `steerhead_clamp`: the triple clamp, `steerhead_handlebar`); the loader hangs them on the steering head. What goes with the front wheel is the parts of the wheel (the tyre and the disc spin) and the parts called `brake_..._FL` (`brake_fork_leg_FL`: the lower leg, `brake_caliper_FL`, `brake_mudguard_FL`): they turn with the steering and slide along the fork with the springs, in line with the cylinders (the physics lets the wheel go straight up and down; the visual moves it back a little as it goes up, `OpenRacer.updateFork`).

`tools/make-cbr600.py` makes `cbr600.glb`. Wheels: `wheel_FL` (the tyre), `wheel_FL_rim`, `wheel_FL_disc`, and the same for `RL`, listed in `wheels.nodes` of the car. What steers with the front wheel without spinning is a part whose name ends in `FL` and starts with or contains `brake` (`brake_fork_FL`, `brake_handlebar_FL`, ...): the loader hangs the parts of a brake caliper on the steering of its wheel.

## The engine sound
The sound is the combustion model of the game, with parameters. New presets in `web/js/EngineSim.js`: *Single 0.65 L (thumper)*, *Inline-3 0.8 L (triple)*, *Inline-4 0.6 L (supersport)* and *Inline-4 1.0 L (superbike)*. `node tools/check-engine-sound.js [preset]` (or `--car honda-cbr600`, `--wav file.wav` to write eight seconds from idle to the limiter to listen to) runs the real worklet without a browser and says if a preset is silent, clips or has not got the pitch of its firing frequency.

## What it cannot do yet
* A rider (no driver model; the driver editor has no bike seat).
* The tyre is a cylinder: at a lean the contact patch moves to its edge. There is no camber thrust of a round tyre.
* A wheelie and a stoppie are there (the springs and the weight transfer do them), but the rider does not catch them.
* Crashes: after about 66 degrees the bike falls over and slides; the rider is not thrown off.
* The suspension of the model (the fork that goes in) does not move; the physics does.
