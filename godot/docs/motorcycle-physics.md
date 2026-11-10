# Motorcycle physics simplification

Date: 2026-11-10
Base: `O-Racer-Godot`, `66441233bffa5926a3f2344648e1cd5f1b2cab9d`

## Controller

The default (`motorcycle.model = "v2"`) now uses one bounded roll servo.
The desired lean still comes from player input, speed, rider posture and available
front/rear tyre grip. Low-speed balance and moving roll gains blend inside that
single servo. The separate high-speed steering/roll loop and extra body roll assist have been
removed from v2. Direct body yaw stabilisation is reduced to one one-sided yaw
hold (see below).

Front steering starts with the geometric angle for the actual lean and speed.
A bounded PI trim corrects the angle for tyre slip using measured yaw, with
smoothing and a low-speed blend. This is yaw feedback through the front tyre,
not another controller of roll error and not a direct yaw torque. An open-loop
geometric angle alone produced excessive yaw at high speed in the regression
scenarios; the trim keeps the turn consistent with lean and speed.
The existing optional countersteer input remains available. This is an assisted
game model, not a simulation of unconstrained real motorcycle steering geometry.

### Changes after measuring on the shell tyres (Godot 4.7.2)

The plan above was measured with the audit bench (skidpad, `--tyres=shell`:
a step into a lean, a change of side and full braking in the lean, at 60 and
130 km/h, enduro, supermoto and sports motorcycle). Three things are different
from the plan:

- **Steer trim off by default** (`steer_trim_max = 0`, `steer_trim_p = 0`).
  With the trim the sports motorcycle slid 15.5 degrees on the brake at 60 km/h
  and the enduro 16; without it 2.0 and 1.8, with less roll servo torque. A
  stronger trim made the enduro spin on the change of side. The code stays and
  can be turned on per tune (`steer_trim_tau`, `steer_trim_max`, `steer_trim_p`).
- **One yaw hold stays** (`yaw_brake`, `rider_yaw_hold`, 0 turns each off):
  a yaw torque on the brake, and at speed only when the bike turns more than
  1.25 times what its lean goes round, not while the lean changes. Without it
  the enduro spun on the brake after the change of side at 130 km/h (sideslip
  87 degrees); with it 3 degrees.
- **ABS in a lean counts the side force the tyre carries now**
  (`brake_side_felt = 1`): the larger of tan(lean) times the load and the
  measured side force. The rear tyre often carries twice its share.

Bench result (sideslip on the brake in the lean, 60 / 130 km/h): enduro 1.8 /
3.1 degrees, sports motorcycle 2.0 / 3.6, supermoto 1.8 / 1.2. Braking in a
deep lean is weaker than before, because the shared grip ellipse leaves
little for the brake at 45 degrees. The enduro reaches 25 instead of 33
degrees right after the change of side at 130 km/h.

The damping of the roll servo works on the difference between the rate of
the asked lean and the rate of the bike (`rider_roll_ff = 1`; 0 damps every
roll motion, as before). In a steady lean nothing changes; on a change of side
the bike follows the asked lean instead of lagging about 0.3 s behind it.
Change of side from full lean, time to -30 degrees at 60 / 100 / 130 km/h:
sports motorcycle 1.13 / 1.13 / 1.13 s before, 0.79 / 0.79 / 0.86 s with it;
enduro 1.46 / 2.19 / never, now 0.86 / 0.86 / 0.86 s; supermoto 1.39 / 1.46 /
1.46, now 1.06 / 1.06 / 1.06 s. Sideslip in the change of side rises by about
1 to 3 degrees; braking in the lean and straight braking are unchanged.

The roll settings are `rider_ref_tau`, `rider_roll_kp`, `rider_roll_kd`,
`rider_roll_ff` and `rider_roll_max` in the `motorcycle` object. The last is a torque limit relative
to mass * gravity * centre-of-gravity height. Obsolete steering-DOF/body-assist
settings no longer affect v2. Model `v1` keeps its legacy ground roll/yaw controller.

## Grip

`CarWear.peak_mu()` is the shared source for surface, tyre condition, damage,
compound and load sensitivity. `capacity()` exposes the same peak longitudinal /
lateral ellipse as the tyre curve, including the lateral 1.05 factor and drift
multiplier. Lean planning, brake reserve and corner pedal assistance use this
envelope instead of separate approximate friction formulas. The peak envelope
is a capacity estimate; a sliding tyre can deliver less than its peak.
The shared tyre force curve for cars is otherwise unchanged.

## Separate assistance

The tuning menu exposes these motorcycle-only choices:

- Corner pedal assistance: existing enable switch plus strength 0..1.
  Zero strength / disabled passes inputs through. Releasing gas immediately
  returns zero throttle unless speed hold was explicitly enabled.
- Corner speed hold: off by default. Requires corner pedal assistance and can
  add throttle when both pedals are released. Older tunes without this field
  now coast / engine-brake when gas is released rather than holding speed.
- Wheelie steering assistance: off by default. When enabled it applies bounded
  yaw torque only. It never rotates the transform or linear velocity; rear tyre
  forces must redirect the path. Wheelies therefore behave differently from
  the previous automatic velocity rotation.

Pitch and air assistance, ABS, traction control and wheelie throttle control
remain separate systems. Existing crash response still has its own post-crash
velocity limits and damping; it was not replaced by this change.

## Reset

`Motorcycle.recover()` clears all transient controller state, histories, filtered
loads, posture, pedal filters, air state and steering trim. It preserves settings,
model-derived suspension geometry, AI input mode and the last crash report.
`Car.place()` also clears motorcycle wheel contacts, loads, forces and camber /
drift state. The reset test compares recovered state against a fresh controller
and repeats a circle after the other scenarios.

## Validation

Run from the repository root:

```sh
godot --headless --fixed-fps 120 --path godot res://tools/test_moto_physics.tscn -- --tyres=simple --user-dir=/tmp/moto-physics
godot --headless --fixed-fps 120 --path godot res://tools/test_moto_physics.tscn -- --tyres=simple --car=supermoto-700 --ticks=60 --user-dir=/tmp/moto-physics-60
godot --headless --fixed-fps 120 --path godot res://tools/test_moto_physics.tscn -- --tyres=simple --car=supermoto-700 --user-dir=/tmp/moto-physics-super
godot --headless --fixed-fps 120 --path godot res://tools/test_moto_physics.tscn -- --tyres=simple --ticks=240 --user-dir=/tmp/moto-physics-240
godot --headless --fixed-fps 120 --path godot res://tools/test_moto.tscn -- --tyres=simple --car=sports-motorcycle-600cc --user-dir=/tmp/moto-rider
```

The physics test covers the peak tyre envelope on road/wet/gravel at three loads,
zero-load grip, tune serialization, reset equivalence, pedal pass-through and
gas release, wheelie assistance preserving transform/velocity, circles at 36,
72 and 108 km/h, a left/right transition, braking in a bend and repeatability.
Circles check direction, lean tracking, sideslip and yaw agreement with lean /
speed. The longitudinal test force maintains speed without imposing lateral
motion. Braking tests use raw pedals (corner pedal assistance disabled); the
sideslip bound applies above 5 m/s, where it is meaningful. Telemetry is printed
for each scenario. `--case=slalom` (or another exact scenario name) selects a
single scenario for diagnosis.

The existing `test_moto` additionally covers the rider, fork dive, shifting,
falling, reset and wall impact. Tests use shipped car configurations, not the
user's saved garage/tune overrides.

All five commands above completed with exit code 0 and zero test failures.

| Configuration | Physics rate | Result |
| --- | ---: | --- |
| Sports motorcycle, physics regression | 120 Hz | Pass |
| Sports motorcycle, physics regression | 240 Hz | Pass |
| Supermoto, physics regression | 60 Hz | Pass |
| Supermoto, physics regression | 120 Hz | Pass |
| Sports motorcycle, rider/crash regression | 120 Hz | Pass |

At 108 km/h the sports motorcycle circle at 240 Hz measured 14.98 degrees
mean lean, 1.03 degrees maximum lean tracking error and 2.04 degrees maximum
sideslip. These are scenario measurements, not a claim of real-world accuracy.
The rider/crash regression also reports resource cleanup warnings at exit.

The first validation used Godot 4.6.3 with Jolt and simple tyres; the five
physics commands also pass in Godot 4.7.2 with the native shell tyres
(`--tyres=shell`). The project declares
4.7. Native extension binaries are not included in this checkout; Godot reports
the missing extension at startup and the simple-tyre fallback runs. Native shell
tyres, visual ride feel, banked/uneven tracks and extreme grip-loss manoeuvres
still need playtesting in the target build. These tests demonstrate bounded,
repeatable handling in their scenarios, not physical accuracy on every surface.

The shared four-slot wheel representation is retained for compatibility with the
car drivetrain, editor, damage and replay code; motorcycles still use slots 0
and 2. Converting that infrastructure to true two-wheel storage is a separate
refactor and is not required for this controller simplification.
