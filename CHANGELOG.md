# Changelog

What is new in every version of OpenRacer. The version is `OpenRacer.VERSION` in `web/js/Version.js`.

## Unreleased

**Race**
- In the race column of the main menu, a list with a tick for every car chooses which cars may race against you (shown when a race of laps or AI opponents is chosen; *all* and *none* above it; all are ticked by default and the choice is remembered). The AI cars are taken from the ticked cars in turn (`aicars` in the address); with none ticked every car may race.

**Track editor**
- The AI racing line is drawn in the view (yellow, with arrows in the direction it is driven; *Show the line* switches it off), and can be edited with nodes: *Edit the line* shows nodes about 8 m apart (blue line while editing), a click takes a node and the gizmo moves it over the road (the height follows the road), Shift + click on the road adds a node on the nearest part of the line, *Add node* adds one after the chosen node, Delete or *Delete node* takes one away, *Apply line* saves a smooth curve through the nodes (a point every 2 m) as `racing_line` of the track, *Cancel* keeps it as it was. A designed track without a recorded line can be edited from the middle of its road.

**Light vehicles**
- The joints of the suspension in the collision shell (the lower ball joint and the arms) scale with a wheel smaller than 0.3 m: those of a car wheel stood in the road under a kart and held back its weight and its speed (12 contacts with the road at rest: a kart took 8.8 s to 30 km/h, now 5.6 s).
- A vehicle under 600 kg (a kart) gets light wheels and a softer tyre: the wheels are 2.85 % of the mass (instead of 35 kg each), the tyre stiffness and damping go with the square root of the mass over 1230 kg, and the wheel inertia with the mass and the square of the diameter (a car wheel of 1.6 kg m² made the wheels most of the mass of a kart: a kart needed three times the power to get going).
- The automatic clutch starts to grip at `drivetrain.clutch_start_rpm` and grips fully at `clutch_full_rpm` (1050 and 2000 by default, also in the tuning table): a kart with a centrifugal clutch and one gear lets the clutch slip until it locks at its engagement speed.

**Car editor**
- A driver model that faces the back of the car (a Rigify mannequin from Blender does) is turned round when it is loaded (rotation 180° about y): the editor looks at which side the left and the right shoulders are on. A model whose rotation was set by hand keeps it.
- The driver supports a Rigify rig (a glb with all the control bones, 400 bones for a mannequin): the bones that move the mesh are taken (DEF-upper_arm, DEF-forearm, DEF-hand, DEF-thigh, DEF-shin, DEF-foot, DEF-spine for the hips and DEF-spine.006 for the head), not the controls (ORG-, MCH-, _fk, _ik, tweak) or the twist bones in between, and the lists of bones show the DEF- bones first. The arm and the leg that stand on the left of the car take the left hand and the left foot whatever the model calls them (a model that faces the other way has its L on the right). Tested with a Rigify mannequin: the arms take the right bones and the hands reach their grips exactly, and the head scales away for the cockpit view.
- The driver is edited in the view: click a node to take it (the coloured balls are the hands and the feet, the small cubes the elbows and the knees, which can be moved now and are saved as `driver.poles`; *Reset the elbows and knees* goes back to the automatic ones), click the figure to take the model, click the grey ring to take the wheel of the hands. The ring has a gizmo (move W, rotate E, scale R: its size is where the hands hold) to match it to the steering wheel of the model, which stays where it is; it is saved as `driver.wheel` (`position`, `rotation` in degrees, `radius`) and the hands turn about it in the game, the same way as the steering wheel of the car turns. Without it the ring is between the two hands, or the steering wheel of the model.
- Keyframes for the hands: instead of the automatic hand over, the movement of each hand can be set by hand in the car editor (Driver card, *Keyframes of the hands*). *Make keys from the automatic movement* gives a start; then turn the Steering slider to a place (the positive side), take a hand and move it (W), turn it (E) or set its grip: a key is made at that turn (marks under the slider; click one to go there; *Delete the key here*, and *rides the wheel* for a key whose place and turn go round with the wheel like a hand on the rim, otherwise they are fixed in the car). The hand goes through the keys (a smooth curve), turns and closes its fingers from key to key, holds the first and the last key outside them, and the way back is the same movement the other way. The other side of the steering is the mirror image with the hands changed over. Saved as `driver.keys` (`left` and `right`: `t` degrees, `pos`, `rot`, `grip`, `wheel`); *Back to automatic* removes them.

- Hand grip and hand orientation: with a hand selected the Driver card has a *Grip* slider (0 open to 100% closed) that curls all the fingers of that hand (every bone below the hand except the palm; a Rigify rig curls its DEF- fingers; every joint, the thumb too, turns 65 degrees about its local x axis at full grip, like a Blender rig; a select turns it the other way (-x)), and Rotate (E) turns the hand (the small cross on the ball shows how). The turn is saved as `driver.hands.rotation` (degrees, in the space of the car), the grip as `driver.hands.grip` (0 to 1) and `driver.grip_curl`. In the game the hand turns about the middle of the wheel as it goes round it, so a hand that holds the wheel keeps the same hold. Tested with the Rigify mannequin: 15 finger bones per hand curl, the hand turns 90 degrees with the wheel.

- Hand over, changed: the right hand lets go at 130 degrees and goes by the chest to the top (as before); when it has taken the top the left hand lets go and goes in one smooth movement by the chest to the top, from there to a little before the end of the lock, and the right hand does not let go again. The hands are a function of the turn of the wheel, so the way back to the middle is exactly the same movement the other way. The car now gives the driver the angle of the steering wheel itself (a wheel that turns more than 360 degrees was read wrong from the rotation).
- The driver turns and scales about its hips (the pivot of the gizmo is in the body, not at the feet; a driver saved with the origin at the feet is converted and stays where it was). The chest and the head can be turned too: two small markers with a rotate gizmo (`driver.chest.rotation`, `driver.head.rotation`, degrees); the head stays hidden in the cockpit view.
- A driver: a *Driver* card in the car editor loads a .glb with a simple skeleton in the T pose (made in Blender), saved with the car as driver.glb (`driver` in car.json: `file`, `position`, `rotation`, `scale`, `bones`, `hands`, `feet`, `elbow_out`, `knee_out`). It is placed with gizmos: the model (move with W, turn with E, scale in a field), the two grips of the hands on the steering wheel and the two feet on the pedals; the arms and the legs follow with inverse kinematics (two bones with an elbow or knee that bends to a pole; the bones are guessed from their names, Blender, Rigify and Mixamo style, and can be set by hand). The sliders *Steering*, *Throttle* and *Brake* try it out. In the game the hands turn with the steering wheel of the car and turn a long way the way a driver does (to the right: hands at 9 and 3 o'clock; at 130 degrees the right hand lets go and goes to the top in one slow, smooth movement by the chest (out of the way of the left arm; a curve through the place where it let go, the chest and the top, that starts and ends slowly, about a second), the left hand rides on to about 4 o'clock, then the right hand takes the top (12 o'clock) while the left hand lets go (to the chest) and comes forward to the top when the right one has pulled a little, both ride on, a hand that comes to 4 o'clock takes the top again; back at the middle both go back to 9 and 3), the right foot follows the throttle and the left foot the brake along the way of the pedal, and the head is not drawn in the cockpit view. Tested with a skeleton made for the test: the lead hand is at 3 o'clock at 170 degrees and at 4 o'clock at 200 degrees, the other hand takes the top at about 210 degrees, and the feet reach the pedals exactly. AI cars have no driver yet.
- Exhaust points: one gizmo at a time (the buttons *Move* and *Rotate* in the window of the point, or the W and E keys) instead of the arrows and the rings over each other, and fields for the place (m) and the turn (degrees) that follow the gizmo and can be typed. Nothing is aligned for you.
- A texture that reads a set of texture coordinates that its mesh does not have (the badge of the Lotus Elise model says texCoord 6) no longer breaks the shader ("uv6: undeclared identifier": the part was not drawn): it falls back to the first set when the car is loaded (`CarLoader.js`).
- The test bench of the car editor loads the tyre scripts (`NodeTyre.js`, `TyreBody.js`) with the rest of the physics: without them the test crashed with "OpenRacer.NodeTyre is not a constructor". The floor of the test bench has no 3D road, so the tyre there is the ring of nodes.
- Engine sound: layouts and presets for one, two and three cylinders: *Single 0.25 L (kart)*, *Single 0.4 L*, *Twin 0.8 L (parallel, 360 degrees)* and *Inline-3 1.0 L* (the layouts *Single cylinder* and *Inline 2* are new; *Inline 3* was there without a preset). Played offline, every one gives sound without errors, at about the level of the existing presets.
- Small cars: a model with a wheelbase down to 0.6 m, tracks down to 0.4 m and wheels down to 0.1 m is accepted (a kart: 1.09 m wheelbase and 0.30 m wheels was refused: "The wheels of the model do not make a car", the limits were 1.2 m and 0.3 m). The same limits are in the game for the wheels of the model (`Car.js`).

**Debug view**
- The 0 key (also on the numeric keypad) shows what the physics sees: the triangles near the car (road, walls and the rest), the collision spheres, the nodes and beams of the shell, the contact of every wheel and the tread nodes of the tyre of nodes. See `DebugView.js`.

**Performance**
- A wall of tyres no longer drops the frame rate when the car drives close to it: the physics tested every triangle near the car (a tyre has 832, so 15,000 and more within 2 m) against every sphere of the car, 740 ms per step on Kartbaan Oldenzaal. Small props of 200 triangles and more (less than 1.5 m across) now hit the car as their box (12 triangles); the physics triangles of that track went from 2.4 million to 42 thousand, and a step next to the wall takes about 2.6 ms. What you see is unchanged.
- Decor that is only drawn (tyre walls, trees) is merged per material and per 40 m cell when a track is loaded, so a track with thousands of loose parts needs a few hundred draw calls instead of thousands (Kartbaan Oldenzaal: 3852 parts in 68 groups). The collision and the road are unchanged.

**Tyres**
- The repair key (Backspace) now also puts the car back on its wheels where it is: the same place and heading, the roof up, 30 cm above the road, not moving (a car that lies on its roof or its side). Tested with a kart on its roof: after the key it stands again on its wheels with the normal loads.
- The classic tyre (the slip curves, Pacejka's magic formula) is gone: the tyre body of nodes and beams (the *cylinder*) is the tyre of every car. *Tyre model* has two choices now, *Cylinder* (the default, also for `tyres.model` "classic" or nothing in an older car.json) and *Ring of nodes* (the simple ring, used on tracks with 2D physics, which have no 3D road for the cylinder).
- Tyre of nodes: a car that slid off a ramp kept rocking on its tyres (yaw of ±5°, creeping at 0.25 m/s) for as long as it stood: the damping near a standstill was too low for the whole car (the yaw as well as the car as a share of its tyres). It is doubled (`restDamping` 2); after the same drop (taken from a replay) the yaw is 0° and the car stands (0.017 m/s), with the same classic result. 0 to 40 km/h on the flat takes 1.25 s instead of 1.23 s.
- Tyre model *Cylinder* (experimental, `tyres.model` "cylinder" in car.json, *Tyre model* in the tuning menu and the car editor): the tyre is one body of nodes and beams, a rounded cylinder (rings of nodes across the tread, the outer rings lower on the shoulder, nodes round the wheel, `tyres.shell`: `width`, `rings`, `segments`; the tuning table has them as *Tyre cylinder*), and it replaces the single ring and the slip curve. The nodes and the places on the beams between them are tested against every triangle of the track (road, kerb faces, the sides of ramps, walls), so the tyre does not go through the side of a ramp; they are pushed back by springs (the stiffness and the pressure of the tyre) and drawn flattened where they touch. Every node in contact holds the surface with a bristle (spring and damper, up to the friction of the surface times what presses it, with a Stribeck fall), so the grip, the combined slip, the stick at a standstill and the way the tyre lets go come out of the nodes; the sums go to the wheel (the load along the suspension, the forces along the road, and what presses across the suspension, such as the side of a ramp, to the car at the hub). The debug view (0) draws the nodes and beams per wheel (green where a node holds, red where it slides). On the openracer-frame car: loads on the tyres as with classic (3032 and 2440 N), 0 to 100 km/h in 3.2 s against 3.4 s, braking from 100 km/h in 74 m against 71 m, 0.45 g against 0.44 g after 1.5 s of steering at 40 km/h, and no rocking after a drop from a ramp. It is not the default yet, and it costs about 0.8 ms per frame against 0.15 ms; the visible tyre model does not deform yet, and the tyre cylinder cannot be set graphically in the car editor yet, only by its numbers.
- Tyre of nodes: a node keeps its deflection when it leaves the contact patch and relaxes only as the wheel rolls (it was set to zero), so the patch that moves a little with the load no longer lets a parked car creep. Tyre damage needs a harder hit (5 times the static load) after a bounce off a post punctured the rear tyres.
- A repair key (Backspace, *Esc → Controls → Other → Repair the car where it stands*, and a 🔧 button on touch screens) repairs the car where it stands: the dents of the shell, the parts that came off, the wheels and the punctured tyres. *Back to the start* (R) now repairs the tyres too (it repaired the body only).
- Tyre of nodes: a car at a standstill no longer rocks on its tyres. The spring of the nodes and the mass of the car rang with too little damping when the car stood still (it showed 1.1 m/s and 1.4 rad/s of rocking, and went away once the car rolled); near a standstill and while the wheel hardly slips the damping is now a critical one for the share of the car that the tyre carries, fading out with speed and slip (rocking 0.007 rad/s). 0 to 100 km/h is 13.6 s with both tyre models.
- The tyre of nodes has a carcass now: every tread node is a radial spring that the road presses in by the round of the tyre minus the height of the road under it (the wheel already measures the road at five places along the tyre), and the load is shared over the nodes by how deep they are pressed in. The patch comes out of the stiffness and the pressure of the tyre, and a kerb or a bump under a part of the patch moves the load to the nodes on it. 0 to 100 km/h 13.17 s and braking from 100 km/h 44.3 m on the Hyundai i30, as before (13.19 s, 44.9 m).
- Tyre damage (*Tyre damage: On* in the tuning menu, `tyres.damage` in car.json): a hard hit (a load of more than 5 times the static one on a tyre, one hit in three or so) can puncture it; the tyre leaks and loses its pressure, so its grip, its sidewall stiffness and its vertical stiffness fall, and with the tyre of nodes the contact patch grows. `vehicle.puncture(wheel)` and `vehicle.repairTyres()` do it by hand. The patch of the tyre of nodes now follows the vertical stiffness of the tyre (and so its pressure). Beams between the carcass nodes (a sidewall that deforms) are not done yet.
- An experimental tyre model made of nodes (*Tyre model: Nodes* in the tuning menu, `tyres.model` in car.json): a ring of tread nodes with springs and friction instead of slip curves. The default stays the classic model.

**Engine**
- A turbo with a boost pressure in bar: the power follows the pressure (pressure ratio, compressor and intercooler efficiency, exhaust back pressure); the older share of torque stays for cars without it.

**Gearbox**
- The automatic gearbox shifts up when the engine is near the rev limiter with the wheels spinning faster than the road (a lot of power in a low gear): before, it only looked at the speed of the road and stayed on the limiter until the throttle was lifted. After such a shift it does not kick down for three seconds.

**Controls**
- Automatic gearbox: holding the brake key at a standstill (or below a speed that can be set) puts the car in reverse while it is held; the gas key brakes in reverse and is D again at a standstill.

**Camera**
- The fixed and the follow camera no longer go through walls or over a crest: three rays from the car to the camera (and to a place beside it) against the triangles of the track bring the camera in front of what is in the way; it comes in at once and goes out again smoothly.

**Drag strip**
- The Top 50 has a tab for every distance.
- A Top 50 of the drag runs in the main menu (the car with its tuning, the 1/4 and 2/4 mile times, the top speed, and the ticket of the run); the drag strip is a layer in the track editor with a gizmo for its place and its direction.
- A *Drag strip* tool in the track editor (a window for the distance and the width; the start line is where you click, the strip goes the way you drag), and in the game: the distance to the start line, the lights, false starts, and the times and speeds at the standard distances within the strip. At the finish a time slip slides in from the top at the right (a cross or Escape closes it).

**Panels**
- The tuning menu, the free camera panel, the replay bar and its speed box, and the exhaust window of the car editor can be moved (drag a part that is not a control) and scaled (the bottom right corner); where they are is kept in the browser.

**Extras**
- Optional extras with a checkbox in the tuning menu (the settings open below it): **pops and bangs** (sound and flames at the exhaust), **anti-lag** and a **boost gauge**. They are kept in car.json under `extras`.
- The exhaust points of a car are placed in the car editor (the *Exhaust* layer, with a gizmo for the place and one for the direction); the flames can be your own pictures (`web/images/flames/`).

**Launch**
- The rev limiter is a hard fuel cut with a set rate (*Cuts per second*), so the engine bounces against the limit.
- **Two-step** (Y switches it on; the clutch pedal in at a standstill, or Q on a keyboard), **transbrake** (F) and **launch control** (J, an option) with their own engine speeds in the tuning menu and the car editor; the pills LC, 2S and TB show them.

**3D physics**
- The road is no longer one height per place. Every triangle of the track is in a 3D grid, the wheels feel the road with rays along their own axis, and the body is a cloud of spheres, so a loop, a road on a wall or a bridge works: a car with enough speed goes up the wall of a loop, over the top upside down and lands on the exit.
- The collision shape of a car is made from its model when the car loads (about 40 to 90 spheres), instead of a box.
- A wall counts where the car is lower than its top, measured along the car; the seams between triangles do not push the car; only a car that goes into a wall is hit hard.
- It is the default for every track. A track can keep the old physics with `"physics": "2d"` in `track.json` (or `?physics=2d`).

## 2.1.0 (2026-10-19)

**Replay**
- Everything is recorded from the first frame of the game: all cars, thirty times a second. Press Esc and choose **Replay** to watch it.
- A slider over the whole recording, rewind (backwards), pause, play, jumps of ten seconds, and the speed from 0.1x to 5x.
- Cameras in the replay: Fixed, Follow, Cockpit, and **Free**. The free camera moves with WASD or the arrows, Shift and Control go up and down, the mouse (or the right stick) looks around, `[` and `]` zoom, F aims at the car, L fixes the camera to the car and Tab chooses the car. Everything is smoothed, and a slider (0.1 to 3) sets the speed.
- **Save replay** writes a `.openracer-replay` file and **Open a replay** in the main menu plays one that someone sent you. The file is checked, says what is missing (the track and the cars are not in the file), and nothing goes to a server.

**Fixes**
- The end and the sides of a ramp were walls for a car that was above them. A wall now only counts where the car is lower than its top.
- The sky trembled: in some frames it stood a few metres beside the camera. It is now centred on the camera in every render.
- An error on loading a game, before the wheels of the car had loaded.

## 2.0.1 (2026-10-19)

- **Touch controls** for phones and tablets: a floating steering stick on the left, GAS and BRAKE on the right, and buttons for the handbrake, shifting, reverse, back to the start, the camera and the menu.
- A phone does not run out of memory any more: the picture is limited to about two million pixels there, and the page has a viewport tag.
- A new version reaches the player at once (versioned scripts, no stale cache).
- Security: the helper server only accepts writes for its own name (DNS rebinding), names of cars and tracks are escaped, and the site has security headers.

## 2.0.0 (2026-10-19)

The fork of OpenRacer by Chris Barnard, developed with AI, as a new version:
- A new driving model: quarter-car suspension, combined-slip tyres with pressure, camber, toe, heat and wear, aerodynamics per axle, turbo, ESC and traction control.
- Races with a countdown, laps and results, AI opponents, a ghost, lap records, fuel and pit stops.
- Keyboard, gamepad and racing wheel with force feedback, and an engine sound that is calculated from the engine.
- A car editor with a test bench, a track editor that can draw a track, a tuning menu, the skidpad and the physics bench.
- A local garage for your own cars and tracks, in the browser or in a folder, shared as zip files.
