# Changelog

What is new in every version of OpenRacer. The version is `OpenRacer.VERSION` in `web/js/Version.js`.

## Unreleased

**Debug view**
- The 0 key (also on the numeric keypad) shows what the physics sees: the triangles near the car (road, walls and the rest), the collision spheres, the nodes and beams of the shell, the contact of every wheel and the tread nodes of the tyre of nodes. See `DebugView.js`.

**Performance**
- A wall of tyres no longer drops the frame rate when the car drives close to it: the physics tested every triangle near the car (a tyre has 832, so 15,000 and more within 2 m) against every sphere of the car, 740 ms per step on Kartbaan Oldenzaal. Small props of 200 triangles and more (less than 1.5 m across) now hit the car as their box (12 triangles); the physics triangles of that track went from 2.4 million to 42 thousand, and a step next to the wall takes about 2.6 ms. What you see is unchanged.
- Decor that is only drawn (tyre walls, trees) is merged per material and per 40 m cell when a track is loaded, so a track with thousands of loose parts needs a few hundred draw calls instead of thousands (Kartbaan Oldenzaal: 3852 parts in 68 groups). The collision and the road are unchanged.

**Tyres**
- A repair key (Backspace, *Esc → Controls → Other → Repair the car where it stands*, and a 🔧 button on touch screens) repairs the car where it stands: the dents of the shell, the parts that came off, the wheels and the punctured tyres. *Back to the start* (R) now repairs the tyres too (it repaired the body only).
- Tyre of nodes: a car at a standstill no longer rocks on its tyres. The spring of the nodes and the mass of the car rang with too little damping when the car stood still (it showed 1.1 m/s and 1.4 rad/s of rocking, and went away once the car rolled); near a standstill and while the wheel hardly slips the damping is now a critical one for the share of the car that the tyre carries, fading out with speed and slip (rocking 0.007 rad/s). 0 to 100 km/h is 13.6 s with both tyre models.
- The tyre of nodes has a carcass now: every tread node is a radial spring that the road presses in by the round of the tyre minus the height of the road under it (the wheel already measures the road at five places along the tyre), and the load is shared over the nodes by how deep they are pressed in. The patch comes out of the stiffness and the pressure of the tyre, and a kerb or a bump under a part of the patch moves the load to the nodes on it. 0 to 100 km/h 13.17 s and braking from 100 km/h 44.3 m on the Hyundai i30, as before (13.19 s, 44.9 m).
- Tyre damage (*Tyre damage: On* in the tuning menu, `tyres.damage` in car.json): a hard hit (a load of more than 3.2 times the static one on a tyre) can puncture it; the tyre leaks and loses its pressure, so its grip, its sidewall stiffness and its vertical stiffness fall, and with the tyre of nodes the contact patch grows. `vehicle.puncture(wheel)` and `vehicle.repairTyres()` do it by hand. The patch of the tyre of nodes now follows the vertical stiffness of the tyre (and so its pressure). Beams between the carcass nodes (a sidewall that deforms) are not done yet.
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
