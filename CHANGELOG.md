# Changelog

What is new in every version of OpenRacer. The version is `OpenRacer.VERSION` in `web/js/Version.js`.

## Unreleased

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
