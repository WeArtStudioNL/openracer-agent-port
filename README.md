# OpenRacer
OpenRacer is an open-source initiative to build a high-quality racing simulation running in-browser.

*Sorry! I know I said on the website that all the code is here, but I'm doing a fair amount of housekeeping with the code as I go, and it's taking longer than I thought. There's a lot to read through! It'll all be online as soon as possible.*

It is released under the GPLv3 License.

I'm just starting to upload the source code now - this may take a little while as I'm making some modifications as I go through each file.

The files should include everything you need to open this as a project in NetBeans.

Note that I'm being very 'open' with my code - a lot of this is currently a HUGE hack-job, as I never wrote it with the intention of giving out publicly. Therefore, the first major task is going to be reformatting everything for a style guide, taking out any hard-coded elements and restructuring.

With regards to coding conventions - I will be putting together my own set of guidelines as to how this should be coded up, however it'll be based on a standard style guide. My only caveat is that sometimes, in my opinion, OOP and bleeding-edge-get-every-last-drop-out-of-the-CPU efficiency don't go together so well. I fully intend to break OOP conventions in some places, but only when *absolutely* necessary.

Chris Barnard.


## Running locally
OpenRacer is a static web app. Serve the `web` folder with any local web server (opening `index.html` directly does not work, because the track and car models are loaded with XMLHttpRequest):

    ./start-server.sh        # optionally pass a port, default 8000

This serves the `web` folder and opens http://localhost:8000 in your browser (WebGL required). The server does not cache, so after a `git pull` a normal page refresh is enough and the server never needs a restart. Without the script: `cd web && python3 -m http.server 8000`. With Node instead: `npx http-server web -c-1 -o` (`-c-1` disables caching).

## Driving model
The car is simulated as a chain of connected parts (`web/js/Vehicle.js`, with no 3D dependencies): engine (with inertia, idle, rev limiter and stalling) → friction clutch → gearbox → differential → rear wheels → tyres. The clutch can only transmit a limited torque, so it grips, slips or slides depending on the pedal and the load. Each wheel is an inertia whose speed follows from the engine, brakes and tyre; the slip between the tyre and the road decides how much force it makes (peak grip, then sliding), so wheels can spin or lock up. Gravity pulls the car down the slope of the road, and load moves between the wheels while accelerating, braking and cornering.

* Without a clutch pedal the car works the clutch itself (it engages with the engine speed and opens while shifting), so it does not stall. With a clutch pedal on a calibrated wheel the clutch is yours: release it too quickly and the engine stalls (clutch + throttle, or **I**, starts it again), dump it at high revs and the tyres spin.
* Traction control and ABS are on by default (the dashboard lights show when they act) and can be switched in the settings menu or with **C** and **B**. Traction control takes torque off the engine until the driven wheels hook up again. **Space** is the handbrake, **R** puts the car back at the start, **X** and **Z** shift up and down (this switches to the manual gearbox).

## Settings and controls
Press **Esc** for the settings menu (the game pauses). It has options for traction control, ABS, the gearbox (automatic or manual) and the engine sound, and the list of all actions with their inputs. Every action can have several inputs at once: a key, a button or axis of a controller and a button of a racing wheel, shown as small chips. **✎** sets a new input (press a key or button, or move an axis; Esc cancels), **✕** removes it and **+** adds one. An input belongs to one action: taking it for another action removes it from the first. The pedals, steering and H-shifter of a wheel are measured by the wheel calibration, which can be redone per input from the same list. The bindings are stored in the browser (localStorage).

## three.js
The game uses three.js r186 (`web/js/three`, vendored: the build and the few add-ons for post-processing). three.js is an ES module, so `web/js/bootstrap.js` imports it, exposes it as the global `THREE` and then loads the other scripts in order. The old JSON car models are converted to `BufferGeometry` by `parseLegacyModel` in `Helpers.js`.

## Racing wheel support
Wheels with pedals and a shifter are supported through the browser's Gamepad API.

1. Connect the wheel and press a button on it, so the browser exposes it.
2. Open the settings menu (**Esc**) and press *Calibrate the wheel from scratch*, or use the **K** key. Follow the on-screen steps: steering left/right, throttle, brake, and optionally clutch, shift up/down buttons and an H-pattern shifter (gears and reverse). Every optional step can be skipped with **N**; **Esc** cancels and keeps the previous mapping.
3. The mapping is stored per device in the browser's localStorage. In the settings menu the ✎ next to a wheel input (pedal, steering, shift button or gear) measures just that input again.
4. **M** switches the wheel off (keyboard only) and on again. The debug line at the top shows the live wheel values.

With both an H-pattern shifter and paddles mapped, the most recent action decides: moving the shifter into a gear gives control to the shifter, pulling a paddle gives control to the paddles.

With a shifter mapped, the gearbox becomes manual: sequential paddles shift up/down (shifting down from first gear at standstill selects reverse), and an H-pattern shifter selects gears directly, with neutral when no gear is engaged. Without a shifter the automatic gearbox is used.

The pedals must be reported by the same device as the wheel, and each pedal needs its own axis.

## Engine sound
The engine sound is synthesised with the Web Audio API and follows the engine RPM and throttle, including free revving in neutral or with the clutch pressed. Browsers only start audio after a key press or click, so press any key once. The sound can be switched off in the settings menu (**Esc**), or with **E**. The RPM in the debug line at the top is the same value that drives the sound.
