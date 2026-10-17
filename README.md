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
3. Set the cameras (where they are is shown by dots in the view), the mass, the gears, the engine (a torque table with a chart, or generate a typical curve from the peak power), and the brakes.
4. To update the model of a car that exists, choose the car in the list and pick the new `.glb`: the transform, the wheels (found by the names of their parts) and the material changes (by name) are kept where the new model still fits them, the rest of the car (chassis, cameras, engine, sound) is not touched, and the editor says if the wheelbase, the track or the tyre of the new model differ from the car. The old model file is removed when you save.
5. *Save the car*: it is written to `web/cars/<id>/` and is in the main menu. Choosing an existing car in the list at the top loads its configuration; saving overwrites it (change the id to save a copy). A car can also be deleted from the same page.

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
* **Traction control** (*C*, on by default) only looks at the wheels: when a driven wheel turns faster than the road under it (it spins), power is taken off the engine until it grips again.
* **ESC**, the electronic stability control (**N**, on by default; the *ESC* light shows when it works): it compares what the driver asks for (the steering angle, which gives the direction that the car should turn to at that speed) with what the car does (its yaw rate and the direction it moves in). When these differ it steps in: a car that turns more than asked (oversteer, a rear end that slides out) gets a short brake on the outer front wheel, a car that turns less (understeer) gets the inner rear wheel braked, and both take power off the engine. The steering itself is never changed. It has a limit, so a sudden steer from left to right at high speed can still make the car slide; with ESC off the car slides when it asks for more than the tyres have. ABS (**B**) is on by default. **Space** is the handbrake, **R** puts the car back at the start.
* **Cameras** (**V** switches; also in the settings menu): 1 is the fixed camera behind the car, 2 follows the direction of the car with a smooth rotation and has a wider field of view the faster the car goes, while the camera comes closer in the same measure, so that the car keeps its size in the picture and only the sense of speed changes (a dolly zoom; "comes closer" in the editor sets how far this goes), 3 is the cockpit. **[** and **]** turn the camera, **`** puts it back. The place of every camera is set per car, in the car editor (*Cameras*); without settings a car gets defaults from its size.

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

## Blender: render settings that look like the game
The game and Blender light a car differently, so a car never looks exactly the same, but it can come close. What matters:

* **Materials:** use the Principled BSDF with the inputs that glTF has (base colour, metallic, roughness, normal, emission, alpha, clear coat, transmission). Other shaders (many glass shaders) do not survive the export and arrive as opaque white metal; set them right in the car editor (*Materials*), or use a Principled BSDF with *Transmission* and a low roughness for glass.
* **Colour management** (Render properties): the game shows the colours as they come ("Standard") unless the *Tone mapping* option of the settings menu is set to AgX/ACES/Neutral. Use the same in Blender: view transform *Standard* with the Tone mapping of the game off, or *AgX* with AgX. Look *None*, gamma 1. The game brightens the picture by 20% at the end (x1.2, which is +0.26 exposure in Blender).
* **Lighting:** the car is lit by the surroundings of the track (the sky and the ground are reflected), by three lights and by a bit of ambient light. Save the surroundings in the game (**Esc**, *Surroundings for Blender*) as `openracer-environment.hdr`, and use it as the world (Environment Texture, strength 1). Add the lights: a sun of strength 2.2 from (350, -250, 75), a sun of strength 1.6 from (40, -40, 70) that casts the shadow and one of strength 3.1 from (500, 0, 1000) (positions in Blender axes; these are the lights of the game).
* **Render engine:** EEVEE, without screen space reflections / ray tracing (the game reflects only the surroundings), without bloom and ambient occlusion; soft shadows; 64 samples. The game has a 35 degree vertical field of view on the fixed camera (a lens of 38 mm on a 24 mm high sensor), and a slight vignette that is left out.
* **The car itself:** y up, forward along +Z in the game (Blender exports a car that looks towards -Y correctly), the origin where you like (the car editor moves it), the wheels as separate parts with their own names.

`tools/blender_match_game.py` does all this: in Blender open the Scripting workspace, open the file, set `HDRI` to the saved `.hdr` (or put it next to the script or the `.blend`) and press Run Script (or `blender car.blend --python tools/blender_match_game.py`). It does not delete anything, and adds a road under the car for the shadow and a camera if there is none. It was tested with Blender 5.1; the settings that do not exist in a version are skipped.

## Engine sound
The engine sound is calculated from a physical model of the engine (`web/js/EngineSoundWorklet.js`, an AudioWorklet that runs on the audio thread): every cylinder has pipes for the intake, the exhaust and the extractor in which the pressure wave of the burn travels up and down and is partly reflected, with valves that open and close with the crank angle; the exhausts come together in a pipe, a muffler of several elements and the outlet. It follows the engine speed and the throttle (louder and rougher under load, quiet at closed throttle, cut by the rev limiter), and the cockpit camera gives the sound of the inside of the car: the engine and the intake close, the outlet far away.

The model is a port of the engine sound generator of Antonio-R1 (https://github.com/Antonio-R1/engine-sound-generator, MIT license, see `web/js/ENGINE_SOUND_LICENSE.txt`), after the paper "Physically informed car engine sound synthesis for virtual and augmented environments" (Baldan et al., 2015), with the throttle, the sample rate and parameters that can be changed while it runs added.

The sound of a car is in its `car.json` (`sound`: cylinders, the lengths of the pipes, how much the valves reflect, the muffler, the mix of the intake, the engine block and the outlet, and the volume); a car without it gets a V8. The car editor has an *Engine sound* part with presets (inline-4, turbo, V6, V8, flat-6, V10, V12, straight pipes) and a preview: press Play, set the engine speed and the throttle (or *Rev up and down*), and change the values while you listen. The volume and the sound as a whole are set in the settings menu (**Esc**); browsers only start audio after a key press or a click.

## Tuning menu
**U** (a key that can be remapped, also a button in the settings menu) shows or hides the tuning menu, with which the car is changed while it drives: mass, weight distribution, height of the centre of gravity, roll stiffness, springs, grip and stiffness of the tyres, rolling resistance, engine power, idle and rev limit, inertia and engine braking, drive (rear or front wheels), final drive, every gear, reverse, clutch, differential, brakes, drag, steering lock, the traction control and ESC, and the engine sound. The power, the weight and the top speed that follow are shown at the top. The tuning of a car is kept in the browser; *Reset to the car* goes back to the car as it was made, and *Save to the car* writes the tuning to `cars/<id>/car.json` (it needs `start-server.sh`).
