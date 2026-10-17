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

This serves the `web` folder and opens http://localhost:8000 in your browser (WebGL required). Without the script: `cd web && python3 -m http.server 8000`.

## Racing wheel support
Wheels with pedals and a shifter are supported through the browser's Gamepad API.

1. Connect the wheel and press a button on it, so the browser exposes it.
2. Press **K** in the game to start the calibration. Follow the on-screen steps: steering left/right, throttle, brake, and optionally clutch, shift up/down buttons and an H-pattern shifter (gears and reverse).
3. The mapping is stored per device in the browser's localStorage. Press **K** again to recalibrate (finish all steps; **Esc** cancels and keeps the previous mapping). Every optional step, including each gear of an H-pattern shifter, can be skipped with **N**.
4. Press **M** to switch the wheel off (keyboard only) and on again. The debug line at the top shows the live wheel values.

With a shifter mapped, the gearbox becomes manual: sequential paddles shift up/down (shifting down from first gear at standstill selects reverse), and an H-pattern shifter selects gears directly, with neutral when no gear is engaged. Without a shifter the automatic gearbox is used.

The pedals must be reported by the same device as the wheel, and each pedal needs its own axis.
