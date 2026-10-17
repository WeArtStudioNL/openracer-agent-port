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
OpenRacer is a static web app with a small helper for the lists of cars and tracks. Run it with

    ./start-server.sh        # optionally pass a port, default 8000

This serves the `web` folder (`tools/serve.py`) and opens http://localhost:8000 in your browser (WebGL required). Nothing is cached, so after a `git pull` a normal page refresh is enough and the server never needs a restart. Opening `index.html` directly does not work, because the game loads its files. A plain web server (`cd web && python3 -m http.server 8000`) works too, but then the car editor cannot save, and new cars and tracks are only found when they are in `web/cars/index.json` and `web/tracks/index.json`.

## Main menu, cars and tracks
The game starts with a main menu to choose a car and a track (**Esc** in the game has a button to come back to it). Both lists are made by looking at the folders: every `web/cars/<id>/car.json` is a car and every `web/tracks/<id>/track.json` is a track, so a new folder shows up at the next refresh (or with *Look for new cars and tracks*). The choice is in the address (`index.html?car=<id>&track=<id>`).

A track folder has `track.json` (name, the track geometry and scene files, the folder of the textures, `start` with x, z and heading, and the names of the road pieces that make a lap) and the files it names. `web/tracks/circuit` is the track of the demo.

## Making a car
`web/cars/<id>/car.json` describes a car: the model, the size, the chassis (mass, wheelbase, tracks, weight distribution, height of the centre of gravity, tyre diameter, drag, steering lock), the drivetrain (rear or front wheel drive, gear ratios, reverse, final drive), the engine (idle, rev limit, inertia, torque curve in `[rpm, Nm]`) and the brakes. `web/cars/mustang` is the car of the demo, with its original models.

The **car editor** at http://localhost:8000/tools/car-editor.html makes such a car from a glTF or glb file, for example from Blender (it needs `start-server.sh`, which writes the files):

1. Pick the `.glb` (or the `.gltf` with its `.bin` and textures). The editor shows the model, the arrow is the front of the car. Turn it if it faces another way, and press *Fit*: the origin of the model has to be at the height of the wheel axles, in the middle between the axles.
2. The wheels have to be separate parts of the model, because they steer and spin. Select the parts of each wheel (*Find the wheels* does this by their names and places), or choose the wheel of the demo car. The wheelbase, the tracks, the tyre diameter and the size can be taken from the model.
3. Set the mass, the gears, the engine (a torque table with a chart, or generate a typical curve from the peak power), and the brakes.
4. *Save the car*: it is written to `web/cars/<id>/` and is in the main menu. Existing cars can be edited, copied (save under another id) and deleted from the same page.

The materials of a glTF model are used as they are (physically based: base colour, metalness, roughness, normal, occlusion and emissive maps, clearcoat, transmission). They are lit by the surroundings of the car: the cube map around the car is filtered by roughness and used as the lighting (image based lighting), so paint, glass and chrome reflect the track and the sky. The *Tone mapping* option of the settings menu (Neutral, AgX or ACES) gives a picture closer to Blender's; it is off by default, because it changes the colours of the track too. The car editor shows the model in a studio for the same reason.

A model does not always arrive the way it looked in Blender: a shader that the glTF exporter does not know, such as the glass of many models, ends up as a plain opaque white metal. The *Materials* part of the car editor lists the materials of the model and sets them right with a preset (glass, car paint, chrome, rubber, plastic, brushed metal) or by hand (colour, metalness, roughness, opacity, clear coat, reflection), with a live preview. The changes are saved with the car (`materials` in `car.json`). Glass that arrives opaque is set to see-through glass as a suggestion.

In Blender a car that looks towards -Y (the front view) exports as it should; the model needs a name per part for the wheels to be found. glTF files with Draco or Meshopt compression are not supported.

## Driving model
The car is simulated as a chain of connected parts (`web/js/Vehicle.js`, with no 3D dependencies): engine (with inertia, idle, rev limiter and stalling) → friction clutch → gearbox → differential → rear wheels → tyres. The clutch can only transmit a limited torque, so it grips, slips or slides depending on the pedal and the load. Each wheel is an inertia whose speed follows from the engine, brakes and tyre; the slip between the tyre and the road decides how much force it makes (peak grip, then sliding), so wheels can spin or lock up. Gravity pulls the car down the slope of the road, and load moves between the wheels while accelerating, braking and cornering.

* Without a clutch pedal the car works the clutch itself (it engages with the engine speed and opens while shifting), so it does not stall. With a clutch pedal on a calibrated wheel the clutch is yours: release it too quickly and the engine stalls (clutch + throttle, or **I**, starts it again), dump it at high revs and the tyres spin.
* **Gearbox modes** (*Gearbox* in the settings menu, or the gearbox mode key, **G** by default; every mode has its own gear display):
  * *Automatic* (P R N D): the gears and the clutch are automatic. The shift buttons (**X**/**Z**, paddles) move the selector up and down (P, R, N, D; P and R only while standing still), **.** is reverse while it is held. In P the wheels are locked. The display shows D and the gear it is in.
  * *Sequential* (1, 2, … with N and R below 1): the shift buttons change the gear, the clutch is automatic, no clutch pedal needed.
  * *Manual*: the H-pattern shifter selects the gear and the clutch pedal is used; the paddles still shift, with the automatic clutch. What was used last decides the clutch: after the paddles (or a key) the clutch is automatic, after the H-pattern shifter or the clutch pedal it is the clutch pedal. Without a clutch pedal the clutch is always automatic.
* **Traction control** (*C*, on by default; the dashboard light shows when it acts) keeps the driven wheels from going past the grip of the tyre, driving and cornering together, so power does not take the grip the car needs to turn. It also is a stability control: the steering angle is limited to what the grip can use at the speed, a car that turns more than the steering asks for gets the outer front wheel braked (understeer: the inner rear wheel) and power taken off. It has a limit, so a sudden steer from left to right at high speed can still make the car slide; with the control off the car slides when it asks for more than the tyres have. ABS (**B**) is on by default. **Space** is the handbrake, **R** puts the car back at the start.

* The car collides with walls, fences, buildings and steep embankments (`web/js/Collision.js`): the steep triangles of the track are kept as outlines in a grid, and the car is a rectangle that is pushed out of them. A hit stops the car, makes it bounce a little and spins it when it hits with a corner. Things lower than 30 cm (kerbs) are driven over.

## HUD
Bottom right is a round gauge: the ring is the engine speed (with a red zone at the rev limit and a shift light that goes orange and flashes at the limiter), in the middle are the speed, the gear (P R N D and the gear of the automatic, or 1, 2, … N R) and the gearbox mode, and the two small arcs are the throttle (green, left) and the brake (red, right). Next to it are the indicators of traction control (TC) and ABS: red is off, green is on and yellow is working; a red P shows while the parking lock holds the car. Top left are the lap, the time of the lap that is going and the last laps (the best one is green).

In the settings menu (**Esc**) the HUD can be switched off (**H** by default, a key that can be remapped), the units are metric (km/h) or imperial (mph), and *Debug text* (**F3**) shows the technical text at the top of the screen (wheel values, clutch, FPS).

## Settings and controls
Press **Esc** for the settings menu (the game pauses). It has options for traction control, ABS, the gearbox (automatic or manual) and the engine sound, and the list of all actions with their inputs. Every action can have several inputs at once: a key, a button or axis of a controller and a button of a racing wheel, shown as small chips. **✎** sets a new input (press a key or button, or move an axis; Esc cancels), **✕** removes it and **+** adds one. Buttons, axes and the D-pad of a wheel or controller can all be used (a D-pad that the browser reports as one axis with a value per direction is recognised, and every direction can have its own action). An input belongs to one action: taking it for another action removes it from the first. The pedals, steering and H-shifter of a wheel are measured by the wheel calibration, which can be redone per input from the same list. The bindings are stored in the browser (localStorage).

## three.js
The game uses three.js r186 (`web/js/three`, vendored: the build and the few add-ons for post-processing). three.js is an ES module, so `web/js/bootstrap.js` imports it, exposes it as the global `THREE` and then loads the other scripts in order. The old JSON car models are converted to `BufferGeometry` by `parseLegacyModel` in `Helpers.js`.

## Racing wheel support
Wheels with pedals and a shifter are supported through the browser's Gamepad API.

1. Connect the wheel and press a button on it, so the browser exposes it.
2. Open the settings menu (**Esc**) and press *Calibrate the wheel from scratch*, or use the **K** key. Follow the on-screen steps: steering left/right, throttle, brake, and optionally clutch, shift up/down buttons and an H-pattern shifter (gears and reverse). Every optional step can be skipped with **N**; **Esc** cancels and keeps the previous mapping.
3. The mapping is stored per device in the browser's localStorage, so it survives a refresh (steering, throttle and brake are already kept when the rest of the calibration is not finished). If the browser shows the wheel under another name, the calibration of the last calibrated wheel with the same number of axes and buttons is used. The settings menu shows what is known about the wheel. In the settings menu the ✎ next to a wheel input (pedal, steering, shift button or gear) measures just that input again.
4. **M** switches the wheel off (keyboard only) and on again. The debug line at the top shows the live wheel values.

The wheel steers the car over its whole calibrated range (a 900 degree wheel gives full lock at 450 degrees to each side). *Wheel steering range* in the settings menu lowers this to 75% or 50% of the range for full lock. Within a few percent of the middle the wheel counts as centred.

With both an H-pattern shifter and paddles mapped, the most recent action decides: moving the shifter into a gear gives control to the shifter, pulling a paddle gives control to the paddles.

What the shift buttons and the H-pattern shifter of the wheel do depends on the gearbox mode (see above): the paddles shift in every mode and the H-pattern shifter selects the gears in the manual mode.

The pedals must be reported by the same device as the wheel, and each pedal needs its own axis.

## Engine sound
The engine sound is synthesised with the Web Audio API and follows the engine RPM and throttle, including free revving in neutral or with the clutch pressed. Browsers only start audio after a key press or click, so press any key once. The sound can be switched off in the settings menu (**Esc**), or with **E**. The RPM in the debug line at the top is the same value that drives the sound.
