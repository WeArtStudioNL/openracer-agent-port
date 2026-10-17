# Codex code audit

- Audit date: 2026-10-17
- Repository: `WeArtStudioNL/openracer-agent-port`
- Audited branch: `master`
- Audited commit: `6dad0fafdc54ead84c1a1c2bc9c3feafee779aa8`
- Scope: application startup, asset-loading lifecycle, vehicle physics, mouse/gamepad input, and basic source checks.
- Status: findings documented; no implementation fixes included.

## Handoff to Claude

Steering wheel integration is currently in progress. Finish that integration before addressing this backlog. These findings describe the audited commit above, not the upcoming integration. Recheck each finding against the latest code and mark it resolved if the integration already addresses it.

Coordinate changes to `web/js/controls.js`, `web/js/Car.js`, and `web/index.html` with the steering wheel implementation. Preserve the intended wheel axis mappings, pedal calibration, and input ownership when fixing disconnect behavior.

Use English for all commit messages and code/repository comments in this repository.

## Recommended order

1. Fix startup readiness and the missing telemetry import (F01–F02).
2. Correct and validate physics integration (F03).
3. Fix suspension limits and ABS (F04–F05).
4. Recheck controller safety against the completed steering wheel integration (F06).
5. Keep bump-related grip changes local (F07).

## Findings

### F01 — High: telemetry constructor is used without loading its script

**Location:** `web/index.html:125`; script imports in the same file.

`trackLoaded()` calls `new OpenRacer.Telemetry(...)`, but the page never includes `js/Telemetry.js`. The constructor is therefore undefined when the track-load callback runs.

**Evidence:** loading the application classes included by the page leaves `typeof OpenRacer.Telemetry === "undefined"`. The file defining the constructor exists separately.

**Fix:** include `js/Telemetry.js` before application initialization, or explicitly make telemetry optional and guard all telemetry-dependent controls.

**Acceptance:** a cold page load completes without a telemetry constructor error, and pressing T safely toggles telemetry.

### F02 — High: simulation updates run before asynchronous initialization completes

**Locations:** `web/index.html:129–144`; `web/js/Car.js:265`, `445–446`, `604–605`, `736–737`.

Creating a car immediately makes it eligible for per-frame updates, but wheel geometry loads asynchronously. `Car.update()` unconditionally reads `this.wheels[3].forwardMPH` before the wheel array is guaranteed to contain four wheels.

Dashboard references have a separate race: they are assigned only after a fixed one-second timeout. The wheel-load callback calls `checkWheels()`, which writes to those references and can run before that timeout.

**Evidence:**

- Calling `update(1 / 60, true)` before the wheel-load callback throws: `Cannot read properties of undefined (reading 'forwardMPH')`.
- Calling `checkWheels()` with four initialized wheels and undefined dashboard references throws on assigning `className`.

**Fix:** initialize existing dashboard elements synchronously; expose an explicit vehicle-ready state after required assets finish loading; gate physics and vehicle input on readiness. Handle load failures explicitly rather than relying on elapsed time.

**Acceptance:** cold, cached, and deliberately delayed model loads produce no exceptions; vehicle updates begin only when the required state exists.

### F03 — High: acceleration integration uses stale acceleration and a zero correction

**Location:** `web/js/Wheel.js:554–570` (`updatePosition`).

Position and velocity are advanced using `lastAcceleration`. The subsequent correction assigns `newAccX = acceleration.x` and then subtracts `acceleration.x` from it; the same happens on Y and Z. This correction is always zero for finite inputs, so the new acceleration does not affect velocity during that call.

**Evidence:** from rest, with previous acceleration zero, passing acceleration `(10, 0, 0)` and `delta = 0.1` leaves both X position and X velocity at zero. Constant-acceleration motion over that interval would yield X = 0.05 m and VX = 1 m/s.

**Fix:** choose and consistently implement a documented integration method. Review the additional `updatePosition(delta, acc, true)` call in `Car.checkWheels2()` so rigid-body corrections do not accidentally integrate elapsed time twice. That interaction requires validation; it was not independently established as a separate defect by this audit.

**Acceptance:** verify constant acceleration, acceleration changes, braking, and comparable elapsed time at different update rates using analytic expectations and tolerances.

### F04 — Medium: front suspension compression limit is NaN

**Location:** `web/js/Wheel.js:88`.

The coilover constructor computes `spring_maxCompression` using `this.free_length`, but the configured value is `this.spring.free_length`. The former is undefined, producing NaN. Comparisons against this limit never enforce maximum compression.

**Evidence:** the front wheel created with the page's vehicle configuration has `Number.isNaN(wheel.spring_maxCompression) === true`.

**Fix:** use the configured spring free length and validate the resulting finite compression limit.

**Acceptance:** the front compression limit is finite and the spring cannot compress beyond the configured minimum length.

### F05 — Medium: ABS threshold ignores the sign of forward braking force

**Locations:** `web/js/Wheel.js:278–285`, `370–375`.

Forward motion makes braking force negative, but ABS checks `this.brakingForce > Ff` against a positive friction limit. Strong forward braking therefore fails this condition.

**Evidence:** an isolated wheel update at 20 m/s with 7500 N of braking on road produces `slip === true`, `abs === false`, and leaves the brake pedal at 1.

**Fix:** compare braking-force magnitude with available grip while retaining the proper force direction. Review reverse traction control for the same signed-force pattern.

**Acceptance:** excessive braking can activate ABS in both travel directions; braking below the threshold does not.

### F06 — Medium: controller disconnect retains pedal input; layout assumptions can throw

**Location:** `web/js/controls.js:55–81`.

When the controller disappears, only `usingGamepad` is reset. Previously assigned throttle and brake values remain on the car. The function also assumes `navigator.getGamepads`, axis 0, and buttons 6 and 7 are available.

**Evidence:**

- A car throttle of 0.8 remains 0.8 after polling an empty gamepad list.
- A controller with fewer than eight buttons throws when reading a missing button's `value`.

**Fix after steering wheel integration:** validate API availability and the selected device's layout; neutralize input owned by a disconnected device; define safe handover between wheel, gamepad, keyboard, and mouse without clearing another active input source.

**Acceptance:** disconnecting a wheel or gamepad while accelerating or braking safely releases its input. Unsupported layouts do not throw or inject NaN. Reconnection and switching input sources work predictably.

### F07 — Medium: a bump permanently changes the shared grass friction configuration

**Location:** `web/js/Wheel.js:174–183`.

`friction` references the shared `uCoeff[lastGround]` object. A random bump overwrites that object's `static` and `kinetic` properties, changing later updates and other wheels using the same surface.

**Evidence:** forcing a grass bump changes the shared coefficients from 0.35/0.3 to 0.5/0.4. A subsequent update without a bump retains 0.5/0.4.

**Fix:** derive local friction coefficients per wheel and update without mutating surface configuration.

**Acceptance:** a bump may affect its intended update, but the shared grass coefficients remain 0.35/0.3 afterward.

## Validation performed and limitations

- Reviewed the application HTML and custom JavaScript, including vehicle/wheel logic, scene initialization, track loading, telemetry, and controls.
- Ran targeted Node VM reproductions using the repository's Three.js implementation, with browser globals and asynchronous model loading stubbed as needed.
- Checked 90 tracked files with a `.js` extension: 89 pass JavaScript syntax checking. `web/scene/test_scene.js` is valid JSON scene data, not an executable JavaScript source file; it was not classified as a runtime syntax defect.
- No existing automated test suite was found in the audited checkout.
- No full browser/WebGL run, physical gamepad/steering wheel test, or dependency vulnerability scan was performed.
- This is a scoped code audit, not a guarantee that all defects or security issues have been identified.
- File line numbers refer to the audited commit and may shift during the steering wheel work.

## Resolution status (branch `claude/wheel-support`)

Rechecked against the latest code after the steering wheel integration.

| Finding | Status | Notes |
| --- | --- | --- |
| F01 | Resolved | `js/Telemetry.js` is loaded by `index.html`; pressing T is guarded until telemetry exists. |
| F02 | Resolved | Dashboard elements are looked up synchronously. `Car.isReady()` gates `update()`. Model loads use an explicit error path that shows a banner and keeps the car idle. |
| F03 | Resolved, with a caveat | `Wheel.updatePosition` (and the unused `updatePositionF`) now use velocity Verlet: velocity advances with the average of the previous and new acceleration. From rest with acceleration 10 and delta 0.1, VX is 0.5 after the first step and 1.5 after the second. The extra `updatePosition(delta, acc, true)` call in `Car.checkWheels2()` was not changed and still needs validation for double time integration. |
| F04 | Resolved | `spring_maxCompression` uses `spring.free_length` and is finite (-0.30 m for the front coilover). |
| F05 | Resolved | ABS and traction control compare the force magnitude with available grip, in both travel directions. |
| F06 | Resolved | A disconnected wheel or gamepad releases the pedals it owned. A pad without the expected layout is ignored instead of throwing. Input from other sources is left untouched. |
| F07 | Resolved | Bumps change a per-wheel copy of the friction coefficients; the shared surface table is not mutated. |

Not verified: no browser/WebGL run and no physical wheel were available. Fixes were checked with Node VM reproductions only.
