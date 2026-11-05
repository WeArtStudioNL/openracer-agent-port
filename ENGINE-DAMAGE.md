# Engine damage

With Damage on, a crash hurts the engine too. The shell of the car (`SOFTBODY.md`) says where the car is bent or torn; `web/js/EngineDamage.js` turns the nodes
round the engine into the state of the engine: misfires, a leak of oil or coolant, heat, wear and, at the end, an engine that does not run any more.
Run `node tools/engine-damage-test.js` for the numbers below (a stand-in shell, fixed engine speeds).

## The idea

The engine bay is a sphere in the frame of the car (default radius 0.75 m). The nodes inside it, and the nodes round the radiator in front, are read 30 times a
second. A node counts as hurt by its **permanent bend** (5 cm is nothing, 30 cm is all of it) or when it is torn off. The springing of a hit (the elastic part)
only counts as a **jolt**. Every place keeps the worst it has had: a bent engine does not unbend.

| Place | Nodes | What it stands for | What it does |
|---|---|---|---|
| block | all nodes of the bay | the engine and its mounts | less power, more friction, slow wear, a leak of oil and coolant when badly bent |
| top | the nodes above the middle of the bay | ignition, wiring, intake | misfires, stalling |
| pan | the nodes below the middle | the oil pan | an oil leak |
| radiator | the nodes at the front of the car | radiator, hoses | a coolant leak, less cooling |

The ignition is `max(0.85 top, 0.6 block)`. A hard jolt (the shell springs more than 10 cm in the bay) shakes the wiring loose (top, up to 0.3) and can kill
the engine on the spot: the chance is `0.9 j^2 + 0.05 j` for a jolt `j` from 0 to 1 (10 to 40 cm of springing), once a second at most.

## What it does

* **Misfires** (the stumble): `9 · ignition^1.8` events a second, each a cut of 35 to 105 ms with no combustion (the engine brakes), a bang in the exhaust (the
  flames of the car) and the ignition that drops out in the sound. Above 118 degrees and in a worn engine there are more. At idle a misfire can stall the engine.
  A ruined ignition (above 0.95) does not start again.
* **Power**: `(1 - 0.5 block^1.3) (1 - 0.2 top) (1 - 0.4 overheat) (1 - 0.35 wear^1.3) (1 - 0.15 (1 - oil pressure))`, never below 0.2.
* **Friction** (engine braking): `1 + 1.2 wear + 0.6 block^2 + 0.3 (1 - oil pressure)`.
* **Leaks**: coolant `(radiator^1.6 + 0.3 (block - 0.4)^1.5) / 90` of the system a second (a destroyed radiator is empty in a minute and a half), oil
  `(pan^1.5 + 0.2 (block - 0.5)^1.5) / 150` (a destroyed pan: two and a half minutes). The hot system leaks faster.
* **Heat** (one lump, in degrees): heat in is `0.95 x power output + a share for idling and for the speed`; heat out is `UA (T - 20)`, where UA is made for 98 degrees
  at full power at speed, times the airflow (0.45 standing, 1 from 25 m/s), a thermostat (nearly shut below 78, open at 92), the coolant that is left (the cooling
  falls away below 45 % of it) and `(1 - 0.85 radiator)`. Whole, the engine idles at about 80 and stays under 102 flat out at speed.
  * above 108: power goes down (40 % at 148);
  * above 112: the coolant boils away (steam);
  * above 118: misfires;
  * above 135: the bearings wear fast; at 165 the engine is cooked.
* **Oil pressure**: from the level (full from 55 %) and thinner when hot. The bearings run dry in proportion to `(1 - pressure)` and to the engine speed and load,
  and in a hard corner (more than 9 m/s2 sideways) with less than 70 % oil the oil leaves the pickup. Wear grows by that, by a bent block under load and by
  boiling.
* **Wear**: from 0 to 1. At 1 the engine seizes: it stops, and does not start again until it is repaired.
* **A radiator that is an object of the model** (a part of the car whose name has *radiator* in it, `parts` in car.json, `Parts.js`): its own nodes give how hurt it is
  (the mean and the worst), and a crushed one is empty in 40 s (`radiator^1.3 / 40` of the system a second; the radiator that is only a place in the shell:
  `radiator^1.6 / 90`). A radiator that has come off (or was broken) is empty in 8 s, whatever the temperature. This needs the parts on the main thread (not
  `?worker=1`).
* **Drops and stains** (`Leaks.js`): oil from the pan (black drops, `oilFlow`) and coolant from the radiator (pale green, a spray when it is hurt, a gush when it is
  off: `coolFlow`) fall with gravity and land on the road under them, where they leave a blot: oil stays (up to 3000 stains in all, with the other leaks), coolant
  fades in 70 s. A moving car drips a line, one that stands makes a puddle; on grass, sand and gravel the stains are fainter.
* **Steam and smoke** from the engine bay: white steam when it is hot and leaking, dark smoke from oil that burns (a worn engine, a leaking pan).

At 15 km/h into a wall nothing happens to the engine; at 30 km/h a slow radiator leak; at 50 km/h about 20 % of the power and a stumble; at 70 km/h a
bent block, a leaking radiator and pan, 35 % less power and a misfire a third of the time.

## The HUD, repair and who has it

* **The round gauge**: the left arc is the oil temperature and the right arc the coolant temperature (they took the place of the throttle and the brake). The oil
  follows the coolant plus 6 to 30 degrees with the engine speed and load (and more with little oil or dry bearings), slowly (a minute and a half). The icons beside
  the arcs are `images/HUD/oil-idle.png`, `oil-warning.png`, `coolant-idle.png` and `coolant-warning.png`; the warning one blinks when it is too hot, when less
  than 30 % of the oil or the coolant is left, or when the engine has failed.
* The car panel gets a line **ENGINE 96° · OIL 80% · COOLANT 55%** (with MISFIRING, OVERHEATING, ENGINE WORN or ENGINE FAILED) as soon as something is wrong with
  the engine; nothing when it is whole and cool. It is also shown when tyre wear and fuel are off.
* A **pit stop** repairs the engine with the shell: the oil and the coolant are full, the heat is gone, nothing is bent. It takes `3 + 6 · worst + 3 (failed)`
  seconds, side by side with the other work. The reset key, which repairs the car, does the same.
* **Debug view** (key 0): the engine bay is drawn as a sphere of three rings with dots (magenta) and the radiator as a white one; they go red as the block, the
  ignition or the pan (bay) and the radiator are hurt. They follow the Show the nodes and the beams box of the panel.
* The player's car only. The AI cars have no engine damage (they have no pit stop to mend it, `Vehicle.engineDamageOn`).
* Only with a shell (Damage on). `?damage=0` and `softbody.enabled: false` leave it out.

## Settings (car.json `engine.damage`, all optional)

| Field | Default | What |
|---|---|---|
| `enabled` | true | `false` leaves the engine damage out for this car |
| `position` | from `driveline.engine`: front `[0, mid height, front axle - 0.2]`, mid behind the cabin, rear above the rear axle | the middle of the engine bay, `[x, y, z]` in the frame of the car from the centre of gravity |
| `radiator` | in front of the engine; at the nose for a mid or rear engine | the middle of the radiator |
| `radius` | 0.75 | the radius of the bay (m) |
| `radiator_radius` | 0.55 | the radius of the radiator (m) |
| `coolant`, `oil` | 7, 5 | litres (for the readout; the leaks are shares of the system) |
| `strength` | 1 | how much bend counts: 2 takes twice the bend |

## Not done

* A fuel leak and a fire (the tank is in the rear nodes: the same method).
* A gearbox, clutch or driveshaft that is hurt: the nodes of the driveline.
* The car editor has no window for these fields yet (the position of the engine is in the file).
* A turbo or an intercooler that is hurt, and the weather (the air temperature is 20 degrees).
