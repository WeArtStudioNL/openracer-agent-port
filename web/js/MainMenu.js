/*
 * MainMenu.js
 *
 * Description: The menu at the start of the game, with the choice of the car and the track. Starting the game
 *              opens the page again with the choice in the address (index.html?car=...&track=...), so every
 *              start is a clean one; the main menu is the page without a choice.
 */

var MainMenu = (function() {
    var STORAGE_KEY = "openracer.lastChoice";
    var RACE_KEY = "openracer.raceOptions";
    var raceOptions = { ai: 0, difficulty: "normal", ghost: true, records: true, laps: 0, wear: 1, damage: true, opp: [] };
    try { raceOptions = Object.assign(raceOptions, JSON.parse(window.localStorage.getItem(RACE_KEY)) || {}); } catch(e) { /* no storage */ }
    function rememberRace() { try { window.localStorage.setItem(RACE_KEY, JSON.stringify(raceOptions)); } catch(e) { /* no storage */ } }
    var element = null;
    var choice = { car: null, track: null };
    var cars = [];
    var tracks = [];

    function remembered() {
        try {
            return JSON.parse(window.localStorage.getItem(STORAGE_KEY)) || {};
        } catch(e) {
            return {};
        }
    }

    function remember() {
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
        } catch(e) {}
    }

    // A picture kept in this browser under a key that holds a stamp of the car or the track: the pictures of the same car or track with an older stamp go
    // (every change of a car left its old picture behind, and the storage filled up until the records, the settings and the tunes could not be kept)
    function prunePictures(key, prefix) {
        try { Object.keys(window.localStorage).forEach(function(k) { if(k !== key && k.indexOf(prefix) === 0) window.localStorage.removeItem(k); }); } catch(e) { /* no storage */ }
    }
    function keepPicture(key, prefix, data) {
        prunePictures(key, prefix);
        try { window.localStorage.setItem(key, data); } catch(e) { /* full: the picture is made again next time */ }
    }

    function addStyle() {
        var style = document.createElement("style");
        style.textContent =
            // the look is the one of openracer.eu (theme.css); the menu is a few screens, one decision each
            "#mainMenu { position: fixed; left: 0; top: 0; width: 100%; height: 100%; z-index: 3000; display: flex; flex-direction: column; color: var(--text); " +
            "font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; background: radial-gradient(ellipse at 50% -10%, rgba(255, 90, 31, 0.16), transparent 55%), var(--bg); }" +
            "#mainMenu .top { display: flex; align-items: center; gap: 18px; padding: 14px 24px; border-bottom: 1px solid var(--line); flex: none; }" +
            "#mainMenu .steps { margin-left: auto; display: flex; gap: 6px; font-size: 13px; color: var(--muted); }" +
            "#mainMenu .steps span { padding: 4px 10px; border-radius: 12px; }" +
            "#mainMenu .steps span.on { background: var(--accent); color: #fff; font-weight: 600; }" +
            "#mainMenu .steps span.done { color: var(--text); cursor: pointer; }" +
            "#mainMenu .page { flex: 1; overflow-y: auto; }" +
            "#mainMenu .inner { max-width: 1120px; margin: 0 auto; padding: 28px 24px 40px; }" +
            "#mainMenu h2 { font-size: 26px; margin: 0 0 4px; color: var(--head); letter-spacing: -.01em; }" +
            "#mainMenu .sub { color: var(--muted); margin: 0 0 22px; }" +
            "#mainMenu .bar { flex: none; display: flex; align-items: center; gap: 14px; padding: 14px 24px; border-top: 1px solid var(--line); background: var(--bg2); }" +
            "#mainMenu .bar .summary { flex: 1; color: var(--muted); font-size: 14px; text-align: center; }" +
            "#mainMenu .bar .summary b { color: var(--head); }" +
            "#mainMenu .error { color: var(--bad); padding: 12px 24px; }" +
            // home
            "#mainMenu .home { margin: auto; text-align: center; padding: 30px 24px; }" +
            "#mainMenu .home .tagline { color: var(--muted); font-size: 18px; margin: 14px 0 34px; }" +
            "#mainMenu .home .play { font-size: 22px; padding: 16px 70px; border-radius: 12px; }" +
            "#mainMenu .home .quick { display: block; margin: 12px auto 0; background: none; border: 0; color: var(--accent2); cursor: pointer; font-size: 14px; }" +
            "#mainMenu .home .links { display: flex; justify-content: center; gap: 8px; margin-top: 34px; flex-wrap: wrap; }" +
            "#mainMenu .home .foot { margin-top: 40px; font-size: 13px; color: var(--muted); }" +
            "#mainMenu .home .foot a { color: var(--muted); margin: 0 8px; text-decoration: none; }" +
            "#mainMenu .home .foot a:hover { color: var(--head); }" +
            // the choice of the way to play
            "#mainMenu .modes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }" +
            "@media (max-width: 800px) { #mainMenu .modes { grid-template-columns: 1fr; } }" +
            "#mainMenu .mode { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 26px 22px; cursor: pointer; }" +
            "#mainMenu .mode:hover { border-color: var(--muted); }" +
            "#mainMenu .mode.selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; }" +
            "#mainMenu .mode b { display: block; font-size: 20px; color: var(--head); margin-bottom: 6px; }" +
            "#mainMenu .mode span { color: var(--muted); font-size: 14px; line-height: 1.5; }" +
            // the cars: tiles with the turning model of the car on a dark gradient, the text over it
            "#mainMenu .tiles , #pickDialog .tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }" +
            "@media (max-width: 900px) { #mainMenu .tiles , #pickDialog .tiles { grid-template-columns: repeat(2, 1fr); } }" +
            "#mainMenu .tile , #pickDialog .tile { position: relative; aspect-ratio: 1; border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; cursor: pointer; " +
            "background: radial-gradient(circle at 50% 58%, #3a3f47 0%, #1b1f25 52%, #0d0f12 100%); }" +
            "#mainMenu .tile:hover , #pickDialog .tile:hover { border-color: var(--muted); }" +
            "#mainMenu .tile.selected , #pickDialog .tile.selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset, 0 0 22px rgba(255, 90, 31, 0.28); }" +
            "#mainMenu .tile img , #pickDialog .tile img { position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: contain; display: block; }" +
            "#mainMenu .tile .over , #pickDialog .tile .over { position: absolute; left: 0; top: 0; right: 0; bottom: 0; padding: 12px 14px; pointer-events: none; display: flex; flex-direction: column; " +
            "text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9); background: linear-gradient(180deg, rgba(0, 0, 0, 0.5) 0%, rgba(0, 0, 0, 0) 30%, rgba(0, 0, 0, 0) 72%, rgba(0, 0, 0, 0.6) 100%); }" +
            "#mainMenu .tile .name , #pickDialog .tile .name { font-size: 18px; font-weight: 700; color: var(--head); }" +
            "#mainMenu .tile select.setup { pointer-events: auto; align-self: flex-start; margin-top: 6px; max-width: 100%; background: rgba(15, 18, 22, 0.8); color: var(--head); border: 1px solid var(--line); border-radius: 5px; padding: 3px 6px; font: inherit; font-size: 12px; }" +
            "#mainMenu .tile .bottom , #pickDialog .tile .bottom { margin-top: auto; display: flex; justify-content: space-between; align-items: flex-end; gap: 8px; }" +
            "#mainMenu .tile .hp , #pickDialog .tile .hp { font-size: 24px; font-weight: 700; line-height: 1; white-space: nowrap; color: var(--head); }" +
            "#mainMenu .tile .hp small , #pickDialog .tile .hp small { font-size: 11px; font-weight: normal; color: var(--muted); letter-spacing: 1px; margin-left: 4px; }" +
            "#mainMenu .tile .specs , #pickDialog .tile .specs { color: var(--muted); font-size: 12px; line-height: 1.3; }" +
            // the opponents of a race: the places of the grid, the empty ones with a +, and the buttons (copy, remove) on a car that is in it
            "#mainMenu .tile.empty { display: flex; align-items: center; justify-content: center; border-style: dashed; color: var(--muted); font-size: 56px; font-weight: 300; background: transparent; }" +
            "#mainMenu .tile.empty:hover { color: var(--head); }" +
            "#mainMenu .opps .tile .over { padding-right: 84px; }" +
            "#mainMenu .tile .acts { position: absolute; right: 8px; top: 8px; display: flex; gap: 6px; z-index: 2; }" +
            "#mainMenu .tile .acts button { width: 30px; height: 30px; border-radius: 15px; border: 1px solid var(--line); background: rgba(15, 18, 22, 0.85); color: var(--head); font-size: 15px; line-height: 1; cursor: pointer; padding: 0; }" +
            "#mainMenu .tile .acts button:hover { border-color: var(--accent); color: #fff; }" +
            // the tracks
            "#mainMenu .list , #pickDialog .list { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }" +
            "@media (max-width: 800px) { #mainMenu .list , #pickDialog .list { grid-template-columns: 1fr; } }" +
            "#mainMenu .card , #pickDialog .card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px 16px; cursor: pointer; display: flex; gap: 14px; align-items: center; }" +
            "#mainMenu .card .thumb, #pickDialog .card .thumb { width: 150px; height: 84px; flex: none; border-radius: 8px; object-fit: cover; background: radial-gradient(circle at 50% 60%, #3a3f47 0%, #1b1f25 60%, #0d0f12 100%); }" +
            "#mainMenu .card .text, #pickDialog .card .text { min-width: 0; flex: 1; }" +
            "#mainMenu .card:hover , #pickDialog .card:hover { border-color: var(--muted); }" +
            "#mainMenu .card.selected , #pickDialog .card.selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; }" +
            "#mainMenu .card .name , #pickDialog .card .name { font-size: 18px; font-weight: 700; color: var(--head); }" +
            "#mainMenu .card .info , #pickDialog .card .info { color: var(--muted); font-size: 14px; margin-top: 4px; line-height: 1.45; }" +
            "#mainMenu .card .extra , #pickDialog .card .extra { margin-top: 10px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 13px; color: var(--muted); }" +
            // the options of a race: a row with the choices as chips
            "#mainMenu .setting { display: flex; align-items: center; gap: 16px; padding: 16px 0; border-bottom: 1px solid var(--line); flex-wrap: wrap; }" +
            "#mainMenu .setting .label { width: 170px; color: var(--head); font-weight: 600; }" +
            "#mainMenu .chips { display: flex; gap: 6px; flex-wrap: wrap; }" +
            "#mainMenu .chip, .or-dialog .chip { background: var(--panel); border: 1px solid var(--line); color: var(--text); border-radius: 18px; padding: 7px 16px; cursor: pointer; font: inherit; font-size: 14px; }" +
            "#mainMenu .chip:hover, .or-dialog .chip:hover { border-color: var(--muted); }" +
            "#mainMenu .chip.on, .or-dialog .chip.on { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }" +
            "#mainMenu .hint { color: var(--muted); font-size: 14px; margin-top: 16px; line-height: 1.6; }" +
            // the keyboard: what can be chosen shows where the focus is
            "#mainMenu .mode:focus-visible, #mainMenu .tile:focus-visible, #mainMenu .card:focus-visible, #mainMenu .steps span:focus-visible, #mainMenu .chip:focus-visible, #mainMenu button:focus-visible { outline: 2px solid var(--accent2, #ffb36b); outline-offset: 2px; }" +
            // the notch and the home bar of a phone (index.html asks for the whole screen: viewport-fit=cover)
            "#mainMenu .top { padding-top: max(14px, env(safe-area-inset-top)); padding-left: max(24px, env(safe-area-inset-left)); padding-right: max(24px, env(safe-area-inset-right)); }" +
            "#mainMenu .bar { padding-bottom: max(14px, env(safe-area-inset-bottom)); padding-left: max(24px, env(safe-area-inset-left)); padding-right: max(24px, env(safe-area-inset-right)); }" +
            // a phone: the steps were wider than the screen (only the step you are on is shown), and the text of a car lay over its picture (the picture sits between the name and the numbers)
            "@media (max-width: 640px) {" +
            " #mainMenu .top { gap: 10px; padding-left: max(16px, env(safe-area-inset-left)); padding-right: max(16px, env(safe-area-inset-right)); }" +
            " #mainMenu .steps span:not(.on) { display: none; }" +
            " #mainMenu .inner { padding: 20px 16px 32px; }" +
            " #mainMenu h2 { font-size: 22px; }" +
            " #mainMenu .bar { gap: 10px; padding-left: max(16px, env(safe-area-inset-left)); padding-right: max(16px, env(safe-area-inset-right)); }" +
            " #mainMenu .bar .summary { font-size: 13px; }" +
            " #mainMenu .tile, #pickDialog .tile { aspect-ratio: 3 / 4; }" +
            " #mainMenu .tile img, #pickDialog .tile img { top: 24%; height: 50%; }" +
            " #mainMenu .tile .over, #pickDialog .tile .over { padding: 10px; background: none; }" +
            " #mainMenu .tile .name, #pickDialog .tile .name { font-size: 15px; line-height: 1.2; }" +
            " #mainMenu .tile .hp, #pickDialog .tile .hp { font-size: 19px; }" +
            " #mainMenu .tile .specs, #pickDialog .tile .specs { font-size: 11px; }" +
            " #mainMenu .setting .label { width: 100%; }" +
            " #mainMenu .card .thumb, #pickDialog .card .thumb { width: 104px; height: 64px; }" +
            "}" +
            // the badge of a car or track that is not of the server: the garage of this browser or a folder on the PC (Garage.js)
            ".or-badge, #mainMenu .badge { display: inline-block; font-size: 10px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; vertical-align: middle; " +
            "margin-left: 8px; padding: 2px 7px; border-radius: 10px; background: var(--line); color: var(--text); }" +
            // the windows (the replays, the garage, the jumps, more options, the editors)
            "#replaysDialog, #garageDialog, #editorsDialog, #moreDialog, #pickDialog { position: fixed; left: 0; top: 0; width: 100%; height: 100%; z-index: 3100; background: rgba(0, 0, 0, 0.7); display: flex; align-items: center; justify-content: center; }" +
            "#pickDialog { z-index: 3200; } #pickDialog .box { width: 420px; } #pickDialog.wide .box { width: 960px; } #pickDialog .tiles, #pickDialog .list { margin-top: 10px; }" +                 /* (the Car or Track question of the garage: over the garage) */
            ".or-dialog .box, #replaysDialog .box, #garageDialog .box { width: 720px; max-width: calc(100% - 40px); max-height: calc(100% - 40px); overflow-y: auto; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 22px 26px; color: var(--text); font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }" +
            ".or-dialog h2, #replaysDialog h2, #garageDialog h2 { margin: 0 0 4px; font-size: 22px; color: var(--head); }" +
            ".or-dialog .note, #replaysDialog .note, #garageDialog .note { color: var(--muted); font-size: 14px; line-height: 1.5; margin: 0 0 14px; }" +
            "#garageDialog h3 { font-size: 12px; letter-spacing: 2px; color: var(--muted); text-transform: uppercase; margin: 16px 0 6px; }" +
            "#garageDialog .titleRow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 0 0 4px; padding-right: 90px; } #garageDialog .titleRow h2 { margin: 0 12px 0 0; }" +
            ".or-dialog .row, #replaysDialog .row, #garageDialog .row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; margin-bottom: 6px; }" +
            "#replaysDialog .row .name, #garageDialog .row .name { flex: 1; min-width: 0; }" +
            "#replaysDialog .row .meta, #garageDialog .row .meta { color: var(--muted); font-size: 13px; }" +
            "#replaysDialog .error { color: var(--bad); font-size: 14px; margin: 8px 0; }" +
            "#replaysDialog button, #garageDialog button, .or-dialog button.or-btn { background: var(--bg2); color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 7px 14px; cursor: pointer; font: inherit; font-size: 14px; }" +
            "#replaysDialog button:hover, #garageDialog button:hover, .or-dialog button.or-btn:hover { border-color: var(--muted); color: var(--head); }" +
            "#replaysDialog button.primary, #garageDialog button.primary, .or-dialog button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }" +
            "#replaysDialog button.danger:hover, #garageDialog button.danger:hover { border-color: var(--bad); color: var(--bad); }" +
            "#garageDialog .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }" +
            "#garageDialog .status { color: var(--accent2); font-size: 14px; min-height: 18px; margin-top: 10px; }" +
            "#garageDialog .status.error { color: var(--bad); }" +
            "#garageDialog .close { float: right; }" + "#garageDialog details.more { margin-top: 16px; } #garageDialog details.more summary { cursor: pointer; color: var(--muted); font-size: 14px; }" +
            ".or-dialog label.tick { display: flex; align-items: center; gap: 8px; padding: 4px 0; cursor: pointer; }";
        document.head.appendChild(style);
    }

    function carPower(car) {
        var curve = (car.engine && car.engine.torque_curve) || [];
        var peak = 0;
        curve.forEach(function(point) { peak = Math.max(peak, point[1] * point[0] * Math.PI / 30 / 745.7); });
        var scale = car.engine && car.engine.power_scale !== undefined ? car.engine.power_scale : 1; // the tuning that is in the car
        return Math.round(peak * scale);
    }

    // the top speed worked out from the configuration (OpenRacer.topSpeed), in the units of the settings
    function topSpeedText(car) {
        var v = OpenRacer.topSpeed ? OpenRacer.topSpeed(car) : 0;
        if(!(v > 0)) return "";
        var imperial = typeof Settings !== "undefined" && Settings.option("units") === "imperial";
        return " · " + Math.round(v * (imperial ? 2.2369362920544 : 3.6)) + (imperial ? " mph" : " km/h");
    }

    function carSpecs(car) {
        if(car.type === "motorcycle") return Math.round(car.chassis.mass + OpenRacer.Motorcycle.riderMass(car)) + " kg · motorcycle · " + (car.drivetrain && car.drivetrain.gear_ratios ? car.drivetrain.gear_ratios.length : "?") + " gears" + topSpeedText(car);
        var drive = (car.drivetrain && car.drivetrain.drive || "rwd").toUpperCase();
        var gears = car.drivetrain && car.drivetrain.gear_ratios ? car.drivetrain.gear_ratios.length : "?";
        return Math.round(car.chassis.mass) + " kg · " + drive + " · " + gears + " gears" + topSpeedText(car);
    }

    // The showcase: the 3D model of every car turns slowly on its tile. One hidden WebGL renderer draws the cars one by one into
    // the canvas of each tile (a browser allows only a few WebGL contexts). The models are loaded once and kept.
    var showcase = (function() {
        var ready = false, tiles = [], models = {}, group = null, cam = null, size = 360, clock = 0, last = 0, running = false;
        function init() {
            if(ready) return;
            ready = true;
            // the renderer and the scene are the globals of the game (Scene.js); the game itself starts on another page
            renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
            renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
            renderer.setSize(size, size, false);
            renderer.setClearColor(0x000000, 0);
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            scene = new THREE.Scene();
            var pmrem = new THREE.PMREMGenerator(renderer);
            scene.environment = pmrem.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
            scene.add(new THREE.HemisphereLight(0xffffff, 0x303030, 0.9));
            var sun = new THREE.DirectionalLight(0xffffff, 1.6);
            sun.position.set(4, 7, 5);
            scene.add(sun);
            var floor = new THREE.Mesh(new THREE.CircleGeometry(4, 48), new THREE.ShadowMaterial({ opacity: 0.35 }));
            floor.rotation.x = -Math.PI / 2;
            floor.receiveShadow = true;
            scene.add(floor);
            renderer.shadowMap.enabled = true;
            sun.castShadow = true;
            sun.shadow.mapSize.set(1024, 1024);
            sun.shadow.camera.left = sun.shadow.camera.bottom = -4; sun.shadow.camera.right = sun.shadow.camera.top = 4;
            group = new THREE.Group();
            scene.add(group);
            cam = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
            if(typeof initialiseMaterials === "function" && typeof mlib === "undefined") {
                // the materials of the old models reflect a cube map: a grey room, taken once
                initialiseMaterials();
                scene.background = new THREE.Color(0x9a9ea6);
                cubeCamera.update(renderer, scene);
                scene.background = null;
            }
        }

        // (a tune of a car has a key of its own, car._previewKey: the car with the rims, the tyres, the parts and the colours of the tune)
        function modelOf(car) {
            var key = car._previewKey || car.id;
            if(models[key]) return models[key];
            var entry = models[key] = { object: null, radius: car.chassis.tire_diameter / 2, length: (car.dimensions && car.dimensions.length) || 4.5 };
            OpenRacer.loadCarModel(car, function(model) {
                if(car.colors && OpenRacer.applyCarColors) OpenRacer.applyCarColors([model.tilt].concat(model.wheels), car.colors);
                if(OpenRacer.CollisionProxy && OpenRacer.CollisionProxy.hideBeams) OpenRacer.CollisionProxy.hideBeams(model.tilt);          // (the drawing of the shell is not part of the car)
                var object = new THREE.Group();
                var r = entry.radius;
                model.tilt.position.y = ((model.bodyLift || 1) - 1) * r;
                // The car as it stands on the road (the game puts it there by the ride height of the axles): the body lower or higher against the wheels, and tilted when the front
                // and the rear differ, and the moving parts of the suspension (arms, uprights, springs) follow it. The springs carry the car at rest, so there is no sag to add.
                var pose = new THREE.Group();
                pose.add(model.tilt);
                object.add(pose);
                var ch = car.chassis || {}, rideF = ch.ride_front || 0, rideR = ch.ride_rear || 0;
                if(car.type !== "motorcycle" && (rideF || rideR)) {
                    pose.position.y = (rideF + rideR) / 2;
                    pose.rotation.x = Math.atan((rideR - rideF) / Math.max(1, ch.wheelbase || 2.5));
                }
                if(model.rig && model.rig.update && car.type !== "motorcycle") {
                    try {
                        var rest = ch.suspension_length || 0.28;
                        var lengths = [rest + rideF, rest + rideF, rest + rideR, rest + rideR];
                        model.rig.update({ restLength: rest, steerApplied: 0, front_track: ch.front_track, rear_track: ch.rear_track, wheelbase: ch.wheelbase,
                            wheels: lengths.map(function(l) { return { susLength: l, spin: 0, steerNow: 0 }; }) }, model.wheels.map(function(w) { return { object: w }; }));
                    } catch(e) { console.warn("Showcase: the suspension was not posed: " + e.message); }
                }
                var c = model.measured && model.measured.centres;
                var wb = car.chassis.wheelbase, ft = car.chassis.front_track, rt = car.chassis.rear_track;
                var places = c ? [c.FR, c.FL, c.RL, c.RR] : [{ x: -ft / 2, y: 0, z: wb / 2 }, { x: ft / 2, y: 0, z: wb / 2 }, { x: rt / 2, y: 0, z: -wb / 2 }, { x: -rt / 2, y: 0, z: -wb / 2 }];
                model.wheels.forEach(function(w, i) { w.position.set(places[i].x, places[i].y, places[i].z); object.add(w); });
                object.position.y = r; // the wheels on the floor
                object.traverse(function(child) { if(child.isMesh) child.castShadow = true; });
                // the camera is placed by the size of the model as it is, not by the figures of the configuration
                var box = new THREE.Box3().setFromObject(object);
                var size = box.getSize(new THREE.Vector3());
                if(size.x > 1 && size.z > 1) entry.length = Math.max(size.x, size.z);
                object.visible = false;
                group.add(object);
                entry.object = object;
            }, function(message) { console.warn("Showcase: " + message); });
            return entry;
        }

        // a tile for a car: its canvas is drawn every frame
        function add(car, canvas) {
            init();
            tiles.push({ car: car, canvas: canvas, context: canvas.getContext("2d"), model: modelOf(car), phase: tiles.length * 1.3 });
            if(!running) { running = true; last = performance.now(); requestAnimationFrame(frame); }
        }
        function clear() { tiles = []; }

        function frame(now) {
            if(!document.getElementById("mainMenu")) { running = false; return; }
            requestAnimationFrame(frame);
            var dt = Math.min(0.1, (now - last) / 1000);
            last = now;
            clock += dt;
            tiles.forEach(function(tile) {
                var m = tile.model;
                if(!m.object) return;
                var w = tile.canvas.clientWidth, h = tile.canvas.clientHeight;
                if(!w || !h) return;
                var px = Math.min(2, window.devicePixelRatio || 1);
                if(tile.canvas.width !== Math.round(w * px) || tile.canvas.height !== Math.round(h * px)) { tile.canvas.width = Math.round(w * px); tile.canvas.height = Math.round(h * px); }
                group.children.forEach(function(o) { o.visible = o === m.object; });
                m.object.rotation.y = clock * 0.35 + tile.phase;
                var d = m.length * 1.75;
                cam.position.set(Math.sin(0.6) * d, m.length * 0.4, Math.cos(0.6) * d);
                cam.lookAt(0, m.radius * 1.3, 0);
                renderer.render(scene, cam);
                tile.context.clearRect(0, 0, tile.canvas.width, tile.canvas.height);
                tile.context.drawImage(renderer.domElement, 0, 0, tile.canvas.width, tile.canvas.height);
            });
        }
        // one still of a car, from the front at an angle, as a webp (a Blob): the model is loaded if it is not yet, and the hidden renderer draws it once
        function still(car, done) {
            init();
            var m = modelOf(car), waited = 0;
            (function wait() {
                if(!m.object) {
                    if((waited += 100) > 20000) { done(null); return; }
                    setTimeout(wait, 100);
                    return;
                }
                renderer.setSize(480, 480, false);
                cam.aspect = 1; cam.updateProjectionMatrix();
                group.children.forEach(function(o) { o.visible = o === m.object; });
                m.object.rotation.y = 0;
                var d = m.length * 1.75;
                cam.position.set(Math.sin(0.75) * d, m.length * 0.38, Math.cos(0.75) * d);
                cam.lookAt(0, m.radius * 1.3, 0);
                renderer.render(scene, cam);
                renderer.domElement.toBlob(done, "image/webp", 0.88);
            })();
        }
        return { add: add, clear: clear, still: still, init: init };
    })();

    // The pictures of the cars in the menu: still, from the front at an angle. Once made they are kept: as a file of the car (preview.webp, when this server may write it)
    // and in this browser (localStorage), so the next time they are there at once. The car editor takes the file away when the car is saved again.
    var previews = (function() {
        var queue = [], busy = false;
        var POSE_EPOCH = Date.parse("2026-10-29T19:00:00Z");         // (a preview.webp from before the pictures showed the ride height is made again)
        function stamp(car) {
            var s = JSON.stringify([car.id, car.model, car.chassis, car.dimensions]), h = 0;
            for(var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
            return (h >>> 0).toString(36);
        }
        // (the stamp is of what car.json says: a model that was exported again under the same name did not change it, and the old picture stayed. The model file's own size and date
        // go into the key too, and a preview.webp that is older than the model is made again)
        function key(car) { return "openracer.preview.p2." + car.id + "." + stamp(car) + (car._modelTag || ""); }       // (p2: the car in its ride height, with its suspension)
        var headCache = {};
        function head(url) {
            if(!headCache[url]) headCache[url] = fetch(url, { method: "HEAD", cache: "no-store" }).then(function(r) {
                return r.ok ? { size: r.headers.get("content-length") || "", modified: Date.parse(r.headers.get("last-modified") || "") || 0 } : null;
            }).catch(function() { return null; });
            return headCache[url];
        }
        function next() {
            if(busy || !queue.length) return;
            busy = true;
            var job = queue.shift();
            showcase.still(job.car, function(blob) {
                busy = false;
                if(blob) {
                    var reader = new FileReader();
                    reader.onload = function() {
                        job.img.src = reader.result;
                        if(job.key) { try { window.localStorage.setItem(job.key, reader.result); } catch(e) { /* full */ } }      // (a tune: its own pruning, see requestTune)
                        else keepPicture(key(job.car), "openracer.preview.p2." + job.car.id + ".", reader.result);
                    };
                    reader.readAsDataURL(blob);
                    // (the picture of the car goes to the server as preview.webp; the picture of a tune stays in this browser)
                    if(!job.key && !(OpenRacer.Garage && OpenRacer.Garage.sourceOf(job.car))) {
                        fetch("/api/cars/" + encodeURIComponent(job.car.id) + "/preview.webp", { method: "PUT", body: blob }).catch(function() { /* not this server's to write */ });
                    }
                } else if(job.fallback) job.fallback();
                next();
            });
        }
        function request(car, img) {
            img.style.visibility = "hidden";
            img.onload = function() { img.style.visibility = ""; };
            function make() { queue.push({ car: car, img: img }); next(); }
            var fromGarage = OpenRacer.Garage && OpenRacer.Garage.sourceOf(car);
            var modelUrl = !fromGarage && car.model && typeof car.model.file === "string" ? car.model.file : null;
            (modelUrl ? head(modelUrl) : Promise.resolve(null)).then(function(info) {
                car._modelTag = info ? "." + info.size + "." + info.modified : "";
                var cached = null;
                try { cached = window.localStorage.getItem(key(car)); } catch(e) { /* no storage */ }
                if(cached) { img.src = cached; prunePictures(key(car), "openracer.preview.p2." + car.id + "."); return; }
                if(fromGarage) { make(); return; }
                var url = "cars/" + encodeURIComponent(car.id) + "/preview.webp";
                // the file of the picture is used when it is not older than the model
                head(url).then(function(pic) {
                    if(!pic || (info && info.modified && pic.modified && pic.modified < info.modified) || (pic.modified && pic.modified < POSE_EPOCH)) { make(); return; }
                    img.onerror = function() { img.onerror = null; make(); };
                    img.src = url + "?v=" + stamp(car) + (car._modelTag || "");
                });
            });
        }
        // the picture of a tune: the car with the tune laid over it (its rims and tyres, its parts, its colours), drawn like the picture of the car; kept in this browser
        // under the tune and what it is, and made again when the tune changes
        function requestTune(car, name, img) {
            var setup = OpenRacer.Setups.configOf(car.id, name, car);
            if(!setup) { request(car, img); return; }
            var cfg = Object.assign({}, car, setup, { id: car.id, model: car.model, preview: car.preview, folder: car.folder, source: car.source });
            if(cfg.driver && !cfg.driver.file && car.driver && car.driver.file) cfg.driver = Object.assign({}, cfg.driver, { file: car.driver.file });
            var s = JSON.stringify([stamp(car), setup.wheels, setup.colors, setup.materials, setup.suspension, setup.driveline, setup.dimensions, setup.chassis && [setup.chassis.tire_diameter, setup.chassis.ride_front, setup.chassis.ride_rear, setup.chassis.suspension_length, setup.chassis.wheelbase], "p2"]), h = 0;
            for(var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
            cfg._previewKey = car.id + "|" + name;
            var prefix = "openracer.preview." + car.id + ".tune." + encodeURIComponent(name) + ".", k = prefix + (h >>> 0).toString(36);
            img.style.visibility = "hidden";
            img.onload = function() { img.style.visibility = ""; };
            var cached = null;
            try { cached = window.localStorage.getItem(k); } catch(e) { /* no storage */ }
            if(cached) { img.src = cached; return; }
            // (the old pictures of this tune go: a tune that is saved often would fill the storage)
            try { Object.keys(window.localStorage).forEach(function(key) { if(key.indexOf(prefix) === 0 && key !== k) window.localStorage.removeItem(key); }); } catch(e) { /* no storage */ }
            queue.push({ car: cfg, img: img, key: k, fallback: function() { request(car, img); } });
            next();
        }
        return { request: request, requestTune: requestTune };
    })();

    function carTile(car, onClick) {
        var div = document.createElement("div");
        div.className = "tile" + (!onClick && choice.car === car.id ? " selected" : "");
        var picture = document.createElement("img");
        picture.alt = "";
        picture.draggable = false;
        div.appendChild(picture);
        var over = document.createElement("div");
        over.className = "over";
        var name = document.createElement("div");
        name.className = "name";
        name.textContent = car.name || car.id;
        addBadge(name, car);
        over.appendChild(name);
        div.title = car.description || "";
        var bottom = document.createElement("div");
        bottom.className = "bottom";
        var specs = document.createElement("div");
        specs.className = "specs";
        specs.textContent = carSpecs(car);
        bottom.appendChild(specs);
        var power = carPower(car);
        var hp = document.createElement("div");
        hp.className = "hp";
        hp.innerHTML = (power || "?") + "<small>HP</small>";
        bottom.appendChild(hp);
        over.appendChild(bottom);
        div.appendChild(over);
        div.onclick = onClick || function() { choice.car = car.id; remember(); goNext(); };      // (a click on a car goes on to the next step)
        previews.request(car, picture);
        return div;
    }

    // the start of the card of a track: its picture on the left, the name and the description in a column beside it (returned, for what a caller adds)
    function trackCardStart(d, track) {
        var thumb = document.createElement("img");
        thumb.className = "thumb"; thumb.alt = ""; thumb.draggable = false;
        d.appendChild(thumb);
        var text = document.createElement("div");
        text.className = "text";
        var name = document.createElement("div");
        name.className = "name";
        name.textContent = track.name || track.id;
        addBadge(name, track);
        text.appendChild(name);
        if(track.description) {
            var info = document.createElement("div");
            info.className = "info";
            info.textContent = track.description;
            text.appendChild(info);
        }
        d.appendChild(text);
        trackPreviews.request(track, thumb);
        return text;
    }

    // The pictures of the tracks: preview.webp of the track (the Thumbnail button of the track editor), else one made here from the start of the track, as the game shows it
    // (the track is loaded into a scene of its own with TrackLoader.js and drawn once from a camera behind the start), kept in this browser and, when this server may write it,
    // as the file of the track
    var trackPreviews = (function() {
        var queue = [], busy = false;
        function stamp(track) {
            var s = JSON.stringify([track.id, track.model, track.start, track.environment]), h = 0;
            for(var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
            return (h >>> 0).toString(36);
        }
        function key(track) { return "openracer.trackpreview." + track.id + "." + stamp(track); }
        function still(track, done) {
            if(typeof loadTrack !== "function" || typeof THREE === "undefined") { done(null); return; }
            showcase.init();                                      // (the renderer: the global of the game)
            var sceneWas = scene, timer = null, finished = false;
            var own = new THREE.Scene();
            own.background = new THREE.Color(track.environment && track.environment.sky_horizon ? track.environment.sky_horizon : 0x9fc3e6);
            // the lights of the game (Scene.js), which the track's environment sets (TrackLoader.applyTrackEnvironment): made here, where the game's scene does not exist
            if(typeof sunLight === "undefined" || !sunLight) window.sunLight = new THREE.DirectionalLight(0xffffff, 0.7 * Math.PI);
            if(typeof shadowLight === "undefined" || !shadowLight) window.shadowLight = new THREE.DirectionalLight(0xffffff, 0.5 * Math.PI);
            if(typeof ambientLight === "undefined" || !ambientLight) window.ambientLight = new THREE.AmbientLight(0xffffff, Math.PI * 0.5);
            if(typeof sunDirection === "undefined" || !sunDirection) window.sunDirection = new THREE.Vector3(40, 70, 40);
            sunLight.position.set(200, 400, 150);
            own.add(sunLight); own.add(ambientLight);
            own.add(new THREE.HemisphereLight(0xffffff, 0x445566, 0.5));
            scene = own;
            trackObjects = { track: [], grass: [], ground: [], other: [] };
            var finish = function(blob) { if(finished) return; finished = true; clearTimeout(timer); scene = sceneWas; done(blob); };
            timer = setTimeout(function() { finish(null); }, 60000);
            try {
                loadTrack(track, function() {
                    try {
                        var start = track.start || { x: 0, z: 0, heading: 0 }, h = start.heading || 0;
                        var fx = Math.sin(h), fz = Math.cos(h);
                        // the height of the road at the start: a ray straight down through the scene
                        var ray = new THREE.Raycaster(new THREE.Vector3(start.x, 2000, start.z), new THREE.Vector3(0, -1, 0));
                        var hits = ray.intersectObjects(own.children, true), y = hits.length ? hits[0].point.y : 0;
                        var cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.5, 20000);
                        cam.position.set(start.x - fx * 9, y + 3.2, start.z - fz * 9);
                        cam.lookAt(start.x + fx * 30, y + 0.5, start.z + fz * 30);
                        renderer.setSize(640, 360, false);
                        renderer.setClearColor(own.background, 1);
                        renderer.render(own, cam);
                        renderer.domElement.toBlob(function(blob) { renderer.setClearColor(0x000000, 0); finish(blob); }, "image/webp", 0.86);
                    } catch(e) { console.warn(e); finish(null); }
                });
            } catch(e) { console.warn(e); finish(null); }
        }
        function next() {
            if(busy || !queue.length) return;
            busy = true;
            var job = queue.shift();
            still(job.track, function(blob) {
                busy = false;
                if(blob) {
                    var reader = new FileReader();
                    reader.onload = function() {
                        job.img.src = reader.result;
                        keepPicture(key(job.track), "openracer.trackpreview." + job.track.id + ".", reader.result);
                    };
                    reader.readAsDataURL(blob);
                    if(!(OpenRacer.Garage && OpenRacer.Garage.sourceOf(job.track))) fetch("/api/tracks/" + encodeURIComponent(job.track.id) + "/preview.webp", { method: "PUT", body: blob }).catch(function() { /* not this server's to write */ });
                }
                next();
            });
        }
        function request(track, img) {
            img.style.visibility = "hidden";
            img.onload = function() { img.style.visibility = ""; };
            var cached = null;
            try { cached = window.localStorage.getItem(key(track)); } catch(e) { /* no storage */ }
            if(cached) { img.src = cached; prunePictures(key(track), "openracer.trackpreview." + track.id + "."); return; }
            var path = "tracks/" + encodeURIComponent(track.id) + "/preview.webp";
            var url = OpenRacer.Garage ? OpenRacer.Garage.resolve(track, path) : path;
            if(url === path) url += "?v=" + stamp(track);
            img.onerror = function() { img.onerror = null; queue.push({ track: track, img: img }); next(); };
            img.src = url;
        }
        return { request: request };
    })();

    // "my garage" or "folder" after the name of a car or track that is not of the server (see Garage.js)
    function addBadge(name, item) {
        var source = OpenRacer.Garage ? OpenRacer.Garage.sourceOf(item) : null;
        if(!source) return;
        var badge = document.createElement("span");
        badge.className = "or-badge " + source;
        badge.textContent = source === "folder" ? "folder" : "my garage";
        badge.title = source === "folder" ? "From the folder on your PC that is linked in the garage" : "In the garage of this browser";
        name.appendChild(badge);
    }

    function formatSize(bytes) {
        if(bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + " GB";
        if(bytes >= 1048576) return (bytes / 1048576).toFixed(1) + " MB";
        return Math.max(1, Math.round(bytes / 1024)) + " kB";
    }

    // The garage dialog: the cars and tracks of this browser (delete, export as a zip), import a zip, and a folder on the PC
    function showGarage() {
        var Garage = OpenRacer.Garage;
        var old = document.getElementById("garageDialog");
        if(old) old.remove();
        var overlay = document.createElement("div");
        overlay.id = "garageDialog";
        var box = document.createElement("div");
        box.className = "box";
        overlay.appendChild(box);
        overlay.onclick = function(event) { if(event.target === overlay) close(); };
        function close() { overlay.remove(); load(); }
        var status = null;
        function say(text, error) { if(status) { status.textContent = text || ""; status.className = "status" + (error ? " error" : ""); } }

        function build() {
            box.innerHTML = "";
            var closeButton = document.createElement("button");
            closeButton.className = "close";
            closeButton.textContent = "Close";
            closeButton.onclick = close;
            box.appendChild(closeButton);
            // the title, with what one does with the garage: Load (open a car or a track in its editor), New (a new car or track) and Import (a zip)
            var titleRow = document.createElement("div");
            titleRow.className = "titleRow";
            titleRow.innerHTML = "<h2>My garage</h2>";
            var pick = function(title, note, carAction, trackAction) {
                dialog("pickDialog", title, note, function(pbox, pclose) {
                    var prow = document.createElement("div");
                    prow.style.cssText = "display: flex; gap: 10px; flex-wrap: wrap; margin-top: 8px;";
                    prow.appendChild(button("Car", "primary", function() { pclose(); carAction(); }));
                    prow.appendChild(button("Track", "primary", function() { pclose(); trackAction(); }));
                    prow.appendChild(button("Cancel", "ghost", pclose));
                    pbox.appendChild(prow);
                });
            };
            // Load: the cars and the tracks together as thumbnails; a click opens it in its editor
            var loadAll = function() {
                dialog("pickDialog", "Load", "Click a car or a track to open it in its editor.", function(pbox, pclose) {
                    if(pbox.parentNode) pbox.parentNode.className += " wide";          // (the dialog is not in the page yet while this runs)
                    pbox.insertAdjacentHTML("beforeend", "<h3 style=\"margin: 12px 0 6px; font-size: 12px; letter-spacing: 2px; color: var(--muted); text-transform: uppercase;\">Cars</h3>");
                    var tilesBox = document.createElement("div");
                    tilesBox.className = "tiles";
                    cars.forEach(function(c) { tilesBox.appendChild(carTile(c, function() { window.location.href = "tools/car-editor.html?car=" + encodeURIComponent(c.id); })); });
                    pbox.appendChild(tilesBox);
                    pbox.insertAdjacentHTML("beforeend", "<h3 style=\"margin: 16px 0 6px; font-size: 12px; letter-spacing: 2px; color: var(--muted); text-transform: uppercase;\">Tracks</h3>");
                    var list = document.createElement("div");
                    list.className = "list";
                    tracks.forEach(function(track) {
                        var d = document.createElement("div");
                        d.className = "card";
                        trackCardStart(d, track);
                        d.onclick = function() { window.location.href = "tools/track-editor.html?track=" + encodeURIComponent(track.id); };
                        list.appendChild(d);
                    });
                    pbox.appendChild(list);
                    var row = document.createElement("div");
                    row.style.cssText = "display: flex; gap: 10px; margin-top: 12px;";
                    row.appendChild(button("Cancel", "ghost", pclose));
                    pbox.appendChild(row);
                });
            };
            titleRow.appendChild(button("Load", "ghost", loadAll));
            titleRow.appendChild(button("New", "ghost", function() {
                pick("New", "Make a new car or track from a model.", function() { window.location.href = "tools/car-editor.html?new=car"; }, function() { window.location.href = "tools/track-editor.html?new=1"; });
            }));
            var importTitle = button("Import", "ghost", function() { if(importInput) importInput.click(); });
            titleRow.appendChild(importTitle);
            box.appendChild(titleRow);
            status = document.createElement("div");
            status.className = "status";
            var importInput = null;

            Promise.all([Garage.list("cars"), Garage.list("tracks"), Garage.usage()]).then(function(result) {
                [["cars", "Cars", result[0]], ["tracks", "Tracks", result[1]]].forEach(function(section) {
                    var kind = section[0], records = section[2];
                    if(!records.length) {
                        if(kind === "tracks" && !result[0].length) box.insertAdjacentHTML("beforeend", "<div class=\"note\">No cars or tracks in your garage yet. Use New or Import above.</div>");
                        return;
                    }
                    box.insertAdjacentHTML("beforeend", "<h3>" + section[1] + "</h3>");
                    records.forEach(function(record) {
                        var row = document.createElement("div");
                        row.className = "row";
                        // a car: its little picture (the one of the menu), from the catalogue that has the car with its files
                        var carOfRecord = kind === "cars" ? cars.filter(function(c) { return c.id === record.id; })[0] : null;
                        if(carOfRecord) {
                            var thumb = document.createElement("img");
                            thumb.alt = "";
                            thumb.draggable = false;
                            thumb.style.cssText = "width: 84px; height: 56px; object-fit: contain; flex: none; border-radius: 6px; background: radial-gradient(circle at 50% 60%, #3a3f47 0%, #1b1f25 60%, #0d0f12 100%);";
                            row.appendChild(thumb);
                            previews.request(carOfRecord, thumb);
                        }
                        var name = document.createElement("div");
                        name.className = "name";
                        var files = Object.keys(record.files || {});
                        name.innerHTML = "<b></b> <span class=\"meta\"></span>";
                        name.querySelector("b").textContent = record.json.name || record.id;
                        name.querySelector(".meta").textContent = record.id + " · " + (files.length ? files.length + " file" + (files.length === 1 ? "" : "s") + ", " + formatSize(Garage.sizeOf(record)) :
                            "settings only");
                        row.appendChild(name);
                        var exportButton = document.createElement("button");
                        exportButton.textContent = "Export zip";
                        exportButton.onclick = function() {
                            say("Making the zip…");
                            Garage.exportZip(kind, record.id).then(function(zip) {
                                var a = document.createElement("a");
                                a.href = URL.createObjectURL(zip.blob);
                                a.download = zip.name;
                                document.body.appendChild(a);
                                a.click();
                                a.remove();
                                setTimeout(function() { URL.revokeObjectURL(a.href); }, 60000);
                                say("Exported " + zip.name + " (" + formatSize(zip.blob.size) + ").");
                            }).catch(function(error) { say("Could not export: " + error.message, true); });
                        };
                        row.appendChild(exportButton);
                        var deleteButton = document.createElement("button");
                        deleteButton.className = "danger";
                        deleteButton.textContent = "Delete";
                        deleteButton.onclick = function() {
                            OpenRacerDialog.ask({ title: "Delete " + (record.json.name || record.id) + "?", text: "It is removed from the garage of this browser.", ok: "Delete", danger: true }).then(function(yes) {
                                if(yes) Garage.remove(kind, record.id).then(build).catch(function(error) { say("Could not delete: " + error.message, true); });
                            });
                        };
                        row.appendChild(deleteButton);
                        box.appendChild(row);
                    });
                });

                importInput = document.createElement("input");
                importInput.type = "file";
                importInput.accept = ".zip,application/zip";
                importInput.multiple = true;
                importInput.style.display = "none";
                importInput.onchange = function() {
                    var files = Array.prototype.slice.call(importInput.files);
                    if(!files.length) return;
                    say("Importing…");
                    files.reduce(function(chain, file) {
                        return chain.then(function(done) {
                            return Garage.importZip(file).then(function(item) { return done.concat([item.kind.slice(0, -1) + " " + item.id]); });
                        });
                    }, Promise.resolve([])).then(function(done) {
                        build();
                        say("Imported " + done.join(", ") + ".");
                    }).catch(function(error) { say("Could not import: " + error.message, true); });
                };
                box.appendChild(importInput);
                var more = document.createElement("details");
                more.className = "more";
                more.innerHTML = "<summary>More ways to add a car or track</summary>";
                // a link to a zip: import it, or make the link of the game that imports it for someone else
                var linkRow = document.createElement("div");
                linkRow.className = "actions";
                var linkInput = document.createElement("input");
                linkInput.type = "text";
                linkInput.placeholder = "Link to a zip (https://…)";
                linkInput.style.cssText = "flex: 1; min-width: 200px; padding: 6px 8px; border-radius: 4px; border: 1px solid #2c3541; background: #11161d; color: #fff;";
                var linkImport = document.createElement("button");
                linkImport.textContent = "Import";
                linkImport.onclick = function() {
                    if(!linkInput.value.trim()) return;
                    say("Importing…");
                    Garage.importUrl(linkInput.value.trim()).then(function(item) { build(); say("Imported " + item.kind.slice(0, -1) + " " + item.id + "."); }).catch(function(error) { say("Could not import: " + error.message, true); });
                };
                var linkCopy = document.createElement("button");
                linkCopy.textContent = "Copy game link";
                linkCopy.title = "A link of this game that adds the zip at that link for whoever opens it";
                linkCopy.onclick = function() {
                    if(!linkInput.value.trim()) return;
                    var game = window.location.origin + window.location.pathname + "?import=" + encodeURIComponent(linkInput.value.trim());
                    (navigator.clipboard ? navigator.clipboard.writeText(game) : Promise.reject()).then(function() { say("Link copied."); }, function() { linkInput.value = game; linkInput.select(); say("Copy the link from the field."); });
                };
                linkRow.appendChild(linkInput); linkRow.appendChild(linkImport); linkRow.appendChild(linkCopy);
                more.appendChild(linkRow);
                
                // the folder on the PC
                more.insertAdjacentHTML("beforeend", "<h3>A folder on your PC</h3>");
                var folderActions = document.createElement("div");
                folderActions.className = "actions";
                if(!Garage.folderSupported()) {
                    more.insertAdjacentHTML("beforeend", "<div class=\"note\">This browser cannot read a folder on your PC (Chrome and Edge can). Import a zip instead.</div>");
                } else {
                    var info = Garage.folderInfo();
                    var folderNote = document.createElement("div");
                    folderNote.className = "note";
                    if(info.name) {
                        folderNote.textContent = "Linked: " + info.name + (info.permission === "granted" ? "" : " (allow the browser to read it)") +
                            ".";
                        if(info.permission !== "granted") {
                            var allow = document.createElement("button");
                            allow.textContent = "Allow reading " + info.name;
                            allow.onclick = function() {
                                Garage.folderPermission(true).then(function(state) {
                                    if(state === "granted") { say("The folder is read."); build(); } else say("The browser did not allow it.", true);
                                });
                            };
                            folderActions.appendChild(allow);
                        }
                        var unlink = document.createElement("button");
                        unlink.textContent = "Unlink the folder";
                        unlink.onclick = function() { Garage.unlinkFolder().then(build); };
                        folderActions.appendChild(unlink);
                    } else {
                        folderNote.textContent = "Read from the folder each time; nothing is copied.";
                        var link = document.createElement("button");
                        link.textContent = "Link a folder…";
                        link.onclick = function() {
                            Garage.linkFolder().then(function() { say("The folder is linked."); build(); }).catch(function(error) {
                                if(error && error.name !== "AbortError") say("Could not link the folder: " + error.message, true);
                            });
                        };
                        folderActions.appendChild(link);
                    }
                    more.appendChild(folderNote);
                }
                more.appendChild(folderActions);

                box.appendChild(more);

                var usage = result[2];
                var foot = document.createElement("div");
                foot.className = "note";
                foot.style.marginTop = "14px";
                foot.textContent = usage && usage.quota ? "This browser lets the site keep up to " + formatSize(usage.quota) + "; it uses " + formatSize(usage.used) + " now." : "";
                if(/^((?!chrome|android).)*safari/i.test(navigator.userAgent)) foot.textContent += " Safari forgets what a site keeps after seven days without a visit: export what you want to keep.";
                box.appendChild(foot);
                box.appendChild(status);
            }).catch(function(error) {
                status.textContent = "The garage could not be opened: " + error.message;
                status.className = "status error";
                box.appendChild(status);
            });
        }
        build();
        document.body.appendChild(overlay);
    }

    // the cars that may race against you (the ticks of the race column): all of them when none is ticked off; the ids go in the address as aicars
    function allowedAiCars() {
        var ids = cars.map(function(c) { return c.id; });
        if(!Array.isArray(raceOptions.aiCars)) return ids;
        return ids.filter(function(id) { return raceOptions.aiCars.indexOf(id) >= 0; });
    }
    function aiCarsParameter() {
        if(!Array.isArray(raceOptions.aiCars)) return "";
        var allowed = allowedAiCars();
        if(allowed.length === cars.length || !allowed.length) return "";
        return "&aicars=" + allowed.map(encodeURIComponent).join(",");
    }

    function start() {
        if(!choice.car || !choice.track) return;
        remember();
        var chosen = mode === "race" ? oppList() : [];
        window.location.href = window.location.pathname + "?car=" + encodeURIComponent(choice.car) + "&track=" + encodeURIComponent(choice.track) +
            "&ai=" + (chosen.length || raceOptions.ai) + (chosen.length ? "&opp=" + chosen.map(function(o) { return encodeURIComponent(o.car) + (o.tune ? "~" + encodeURIComponent(o.tune) : ""); }).join(",") : "") + "&difficulty=" + raceOptions.difficulty + "&ghost=" + (raceOptions.ghost ? 1 : 0) + "&records=" + (raceOptions.records ? 1 : 0) +
            "&laps=" + (raceOptions.laps || 0) + "&wear=" + (raceOptions.wear === undefined ? 1 : raceOptions.wear) + "&damage=" + (raceOptions.damage === false ? 0 : 1) + aiCarsParameter();
    }

    // The window of the replays: the saved ones to watch, download or delete, and a file to import
    function showReplays(carList, trackList) {
        var shade = document.createElement("div");
        shade.id = "replaysDialog";
        var box = document.createElement("div");
        box.className = "box";
        shade.appendChild(box);
        shade.onclick = function(e) { if(e.target === shade) shade.remove(); };
        var title = document.createElement("h2");
        title.textContent = "Replays";
        box.appendChild(title);
        var note = document.createElement("p");
        note.className = "note";
        note.textContent = "Replays you saved, kept in this browser. Import a replay file to watch someone else's (you need the same track and cars).";
        box.appendChild(note);
        var problem = document.createElement("div");
        problem.className = "error";
        box.appendChild(problem);
        var list = document.createElement("div");
        box.appendChild(list);
        var foot = document.createElement("div");
        foot.style.cssText = "display: flex; gap: 8px; justify-content: space-between; margin-top: 14px;";
        box.appendChild(foot);
        var input = document.createElement("input");
        input.type = "file";
        input.accept = ".openracer-replay";
        input.style.display = "none";
        var importButton = document.createElement("button");
        importButton.className = "primary";
        importButton.textContent = "Import replay…";
        importButton.title = "Add a replay file (.openracer-replay) to the list";
        importButton.onclick = function() { input.click(); };
        input.onchange = function() {
            var file = input.files && input.files[0];
            input.value = "";
            if(!file) return;
            problem.textContent = "";
            OpenRacer.Replay.library.importFile(file).then(fill).catch(function(error) { problem.textContent = error.message || "This file could not be imported."; });
        };
        var close = document.createElement("button");
        close.textContent = "Close";
        close.onclick = function() { shade.remove(); };
        foot.appendChild(importButton);
        foot.appendChild(input);
        foot.appendChild(close);
        document.body.appendChild(shade);

        var format = function(seconds) { var s = Math.round(seconds); return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2); };
        var size = function(bytes) { return bytes < 1048576 ? Math.max(1, Math.round(bytes / 1024)) + " KB" : (bytes / 1048576).toFixed(1) + " MB"; };
        function fill() {
            OpenRacer.Replay.library.list().then(function(items) {
                list.innerHTML = "";
                if(!items.length) {
                    var empty = document.createElement("div");
                    empty.className = "note";
                    empty.textContent = "No replays yet. The game asks to save one after a race or practice.";
                    list.appendChild(empty);
                    return;
                }
                items.forEach(function(item) {
                    var row = document.createElement("div");
                    row.className = "row";
                    var text = document.createElement("div");
                    text.className = "name";
                    var name = document.createElement("div");
                    name.textContent = item.name ? item.name + " · " + item.track.name : item.track.name;
                    var meta = document.createElement("div");
                    meta.className = "meta";
                    meta.textContent = (item.cars || []).slice(0, 3).join(", ") + ((item.cars || []).length > 3 ? " …" : "") + " · " + format(item.seconds) + " · " + new Date(item.created).toLocaleString() + " · " + size(item.bytes) + (item.edit ? " · edited" : "");
                    text.appendChild(name);
                    text.appendChild(meta);
                    row.appendChild(text);
                    var watch = document.createElement("button");
                    watch.className = "primary";
                    watch.textContent = "Watch";
                    if(item.edit) watch.title = "Play the edit that was made of this replay in the video editor (Edit goes on with it; the recording itself stays the source)";
                    watch.onclick = function() {
                        problem.textContent = "";
                        OpenRacer.Replay.library.open(item.id, carList, trackList).then(function(ids) {
                            window.location.href = window.location.pathname + "?car=" + encodeURIComponent(ids.car) + "&track=" + encodeURIComponent(ids.track) + "&replay=1";
                        }).catch(function(error) { problem.textContent = error.message || "This replay could not be opened."; });
                    };
                    var download = document.createElement("button");
                    download.textContent = "Download";
                    download.title = "Save the replay as a file, to keep or to send";
                    download.onclick = function() { OpenRacer.Replay.library.download(item.id, item.track.id).catch(function(error) { problem.textContent = error.message; }); };
                    var remove = document.createElement("button");
                    remove.className = "danger";
                    remove.textContent = "Delete";
                    remove.onclick = function() { OpenRacerDialog.ask({ title: "Delete this replay?", ok: "Delete", danger: true }).then(function(yes) { if(yes) OpenRacer.Replay.library.remove(item.id).then(fill); }); };
                    var edit = document.createElement("button");
                    edit.textContent = "Edit";
                    edit.title = "Open the replay in the video editor: cut it, change the speed, place the camera";
                    edit.onclick = function() {
                        problem.textContent = "";
                        OpenRacer.Replay.library.open(item.id, carList, trackList, { source: true }).then(function(ids) {
                            window.location.href = window.location.pathname + "?car=" + encodeURIComponent(ids.car) + "&track=" + encodeURIComponent(ids.track) + "&editor=1";
                        }).catch(function(error) { problem.textContent = error.message || "This replay could not be opened."; });
                    };
                    row.appendChild(watch);
                    row.appendChild(edit);
                    row.appendChild(download);
                    row.appendChild(remove);
                    list.appendChild(row);
                });
            }).catch(function(error) { problem.textContent = (error && error.message) || "The replays could not be read."; });
        }
        fill();
    }

    // ---- the screens: home, then the steps of Play: the way to play, the car, the track and (for a race) its options
    var screen = "home";
    var MODE_KEY = "openracer.mode";
    var mode = "free";
    try { mode = window.localStorage.getItem(MODE_KEY) || "free"; } catch(e) { /* no storage */ }
    var STEP_NAMES = { mode: "Play", car: "Car", tune: "Tune", track: "Track", weather: "Weather", race: "Race", opponents: "Opponents", surface: "Ground" };
    var oppPick = null;                  // while a car is added on the Opponents page: { stage: "car" } or { stage: "tune", car: id }
    var SURFACE_KEY = "openracer.skidSurface";
    var skidSurface = "road";
    try { skidSurface = window.localStorage.getItem(SURFACE_KEY) || "road"; } catch(e) { /* no storage */ }

    // the setups (tunes) of the car that is chosen (the tuning menu, the car editor; OpenRacer.Setups): a step of its own as soon as there is one (Default, the car as made, and the tune)
    function tunesOf() { return choice.car && OpenRacer.Setups ? OpenRacer.Setups.names(choice.car) : []; }
    function stepsOf() {
        var steps = mode === "race" ? ["mode", "car", "track", "weather", "race", "opponents"] : (mode === "skidpad" ? ["mode", "car", "surface"] : ["mode", "car", "track", "weather"]);
        if(tunesOf().length >= 1) steps.splice(2, 0, "tune");
        return steps;
    }
    function go(next) { screen = next; oppPick = null; render(); var page = element.querySelector(".page"); if(page) page.scrollTop = 0; }
    function setMode(value) {
        mode = value;
        try { window.localStorage.setItem(MODE_KEY, mode); } catch(e) { /* no storage */ }
        if(mode === "race") { if(!raceOptions.laps) raceOptions.laps = 3; if(!raceOptions.ai) raceOptions.ai = 3; rememberRace(); }
    }
    function goNext() {
        var steps = stepsOf(), at = steps.indexOf(screen);
        if(at < 0) return;
        if(at === steps.length - 1) begin(); else go(steps[at + 1]);
    }
    function goBack() {
        if(oppPick) { oppPick = null; render(); return; }          // (adding an opponent: back to the grid)
        var steps = stepsOf(), at = steps.indexOf(screen);
        go(at <= 0 ? "home" : steps[at - 1]);
    }

    // what the game is started with, from the way to play
    function begin() {
        if(!choice.car) return;
        remember();
        if(mode === "skidpad") {
            window.location.href = window.location.pathname + "?car=" + encodeURIComponent(choice.car) + "&track=skidpad&mode=skidpad&ai=0&ghost=0&records=0&wear=0&damage=" + (raceOptions.damage === false ? 0 : 1) + "&surface=" + encodeURIComponent(skidSurface);
            return;
        }
        if(!choice.track) return;
        var free = mode !== "race";
        var saved = { laps: raceOptions.laps, ai: raceOptions.ai };
        if(free) { raceOptions.laps = 0; raceOptions.ai = 0; }
        start();
        raceOptions.laps = saved.laps; raceOptions.ai = saved.ai;
    }

    function button(text, className, onClick) {
        var b = document.createElement("button");
        b.className = "or-btn" + (className ? " " + className : "");
        b.textContent = text;
        if(onClick) b.onclick = onClick;
        return b;
    }

    // a dialog with a title, a note and the content that the callback puts in; it is shut by a click beside it
    function dialog(id, title, note, fill) {
        var old = document.getElementById(id);
        if(old) old.remove();
        var shade = document.createElement("div");
        shade.id = id;
        shade.className = "or-dialog";
        var box = document.createElement("div");
        box.className = "box";
        shade.appendChild(box);
        function close() { shade.remove(); }
        shade.onclick = function(e) { if(e.target === shade) close(); };
        var h = document.createElement("h2");
        h.textContent = title;
        box.appendChild(h);
        if(note) { var n = document.createElement("div"); n.className = "note"; n.textContent = note; box.appendChild(n); }
        fill(box, close);
        document.body.appendChild(shade);
    }

    // the choices of a race that are not in the way: tyre wear and fuel, the ghost, the records and the cars that race
    function showMore() {
        dialog("moreDialog", "More race options", null, function(box, close) {
            function chips(label, items, current, apply) {
                var row = document.createElement("div");
                row.className = "setting";
                row.innerHTML = "<span class=\"label\"></span>";
                row.firstChild.textContent = label;
                var group = document.createElement("div");
                group.className = "chips";
                items.forEach(function(item) {
                    var c = document.createElement("button");
                    c.className = "chip" + (item[0] === current ? " on" : "");
                    c.textContent = item[1];
                    c.onclick = function() { apply(item[0]); rememberRace(); showMore(); };
                    group.appendChild(c);
                });
                row.appendChild(group);
                box.appendChild(row);
            }
            chips("Tyre wear and fuel", [[0, "Off"], [1, "On"], [3, "Fast"]], raceOptions.wear === undefined ? 1 : raceOptions.wear, function(v) { raceOptions.wear = v; });
            chips("Damage", [[false, "Off"], [true, "On"]], raceOptions.damage !== false, function(v) { raceOptions.damage = v; });      // off: rigid cars, nothing dents or comes off
            chips("Ghost of your best lap", [[false, "Off"], [true, "On"]], !!raceOptions.ghost, function(v) { raceOptions.ghost = v; });
            chips("Save lap records", [[false, "Off"], [true, "On"]], !!raceOptions.records, function(v) { raceOptions.records = v; });
            if(cars.length > 1 && mode === "race") {
                var title = document.createElement("div");
                title.className = "setting";
                title.innerHTML = "<span class=\"label\">Cars that may race</span>";
                var allowed = allowedAiCars();
                var group = document.createElement("div");
                group.style.cssText = "flex: 1; min-width: 220px;";
                cars.forEach(function(car) {
                    var label = document.createElement("label");
                    label.className = "tick";
                    var tick = document.createElement("input");
                    tick.type = "checkbox";
                    tick.checked = allowed.indexOf(car.id) >= 0;
                    tick.onchange = function() {
                        var current = allowedAiCars();
                        var at = current.indexOf(car.id);
                        if(tick.checked && at < 0) current.push(car.id);
                        else if(!tick.checked && at >= 0) current.splice(at, 1);
                        raceOptions.aiCars = current.length === cars.length ? null : current;
                        rememberRace();
                    };
                    label.appendChild(tick);
                    label.appendChild(document.createTextNode(car.name || car.id));
                    group.appendChild(label);
                });
                title.appendChild(group);
                box.appendChild(title);
            }
            var foot = document.createElement("div");
            foot.style.cssText = "display: flex; justify-content: flex-end; margin-top: 16px;";
            foot.appendChild(button("Done", "primary", close));
            box.appendChild(foot);
        });
    }

    function home(page) {
        var box = document.createElement("div");
        box.className = "home";
        var logo = document.createElement("div");
        logo.className = "or-logo big";
        logo.innerHTML = "<i></i>OpenRacer";
        box.appendChild(logo);
        var tag = document.createElement("div");
        tag.className = "tagline";
        tag.textContent = "A racing simulator that lives in a tab.";
        box.appendChild(tag);
        var play = button("Play", "primary play", function() { go("mode"); });
        play.disabled = !(cars.length && tracks.length);
        box.appendChild(play);
        var welcomed = false;
        try { welcomed = !!localStorage.getItem("openracer.welcomed"); } catch(e) { welcomed = true; }
        var hasTruck = cars.some(function(c) { return c.id === "stadium-truck"; }) && tracks.some(function(t) { return t.id === "desert"; });
        if(!welcomed && hasTruck) {
            var quick = document.createElement("button");
            quick.className = "quick";
            quick.textContent = "New here? Jump a stadium truck over the dunes of the Desert";
            quick.onclick = function() {
                try { localStorage.setItem("openracer.welcomed", "1"); } catch(e) {}
                window.location.href = window.location.pathname + "?car=stadium-truck&track=desert&ai=0&ghost=0&records=0";
            };
            box.appendChild(quick);
        }
        var links = document.createElement("div");
        links.className = "links";
        if(OpenRacer.Garage && OpenRacer.Garage.available()) links.appendChild(button("Garage", "ghost", showGarage));
        links.appendChild(button("Replays", "ghost", function() { showReplays(cars, tracks); }));
        links.appendChild(button("Settings", "ghost", function() { Settings.toggleMenu(); }));
        box.appendChild(links);
        var foot = document.createElement("div");
        foot.className = "foot";
        foot.innerHTML = "<a href=\"https://openracer.eu\" target=\"_blank\" rel=\"noopener\">openracer.eu</a><a href=\"https://discord.gg/JFgHVFUagF\" target=\"_blank\" rel=\"noopener\">Discord</a><span></span>";
        foot.lastChild.textContent = "v" + OpenRacer.VERSION;
        box.appendChild(foot);
        page.appendChild(box);
    }

    function modeStep(inner) {
        inner.innerHTML = "<h2>How do you want to play?</h2><div class=\"sub\">You can change it any time.</div>";
        var grid = document.createElement("div");
        grid.className = "modes";
        [["free", "Free drive", "Just drive. No end, no opponents, and your best lap is kept."],
         ["race", "Race", "Laps from a standing start against AI cars, with a countdown."],
         ["skidpad", "Skidpad", "Your car circles faster and faster until it lets go: how many g does it hold?"]].forEach(function(m) {
            var d = document.createElement("div");
            d.className = "mode" + (mode === m[0] ? " selected" : "");
            d.innerHTML = "<b></b><span></span>";
            d.firstChild.textContent = m[1];
            d.lastChild.textContent = m[2];
            d.onclick = function() { setMode(m[0]); go("car"); };
            grid.appendChild(d);
        });
        inner.appendChild(grid);
    }

    function carStep(inner) {
        inner.innerHTML = "<h2>Choose your car</h2><div class=\"sub\">Tap or click a car to go on.</div>";
        var tilesBox = document.createElement("div");
        tilesBox.className = "tiles";
        showcase.clear();
        cars.forEach(function(car) { tilesBox.appendChild(carTile(car)); });
        inner.appendChild(tilesBox);
    }

    // the tunes of the car: the car as made and every setup, each with its picture (the one taken when it was saved, or the picture of the car)
    function tuneStep(inner) {
        inner.innerHTML = "<h2>Choose your tune</h2><div class=\"sub\">Click a tune to go on. A tune is a setup saved in the tuning menu or the car editor; Default is the car as made (car.json).</div>";
        var car = cars.filter(function(c) { return c.id === choice.car; })[0];
        if(!car) return;
        tuneTiles(inner, car, OpenRacer.Setups.active(car.id) || "", function(name) { OpenRacer.Setups.use(car.id, name || null); goNext(); });
    }
    // the tiles of the tunes of a car (Default and every setup), each with its picture; onPick(name) with "" for Default
    function tuneTiles(inner, car, active, onPick) {
        var tilesBox = document.createElement("div");
        tilesBox.className = "tiles";
        [""].concat(OpenRacer.Setups.names(car.id)).forEach(function(name) {
            var div = document.createElement("div");
            div.className = "tile" + (active === name ? " selected" : "");
            var picture = document.createElement("img");
            picture.alt = "";
            picture.draggable = false;
            div.appendChild(picture);
            if(name) previews.requestTune(car, name, picture); else previews.request(car, picture);
            var over = document.createElement("div");
            over.className = "over";
            var label = document.createElement("div");
            label.className = "name";
            label.textContent = name || "Default";
            over.appendChild(label);
            var bottom = document.createElement("div");
            bottom.className = "bottom";
            var specs = document.createElement("div");
            specs.className = "specs";
            var cfg = name ? OpenRacer.Setups.configOf(car.id, name, car) : car;
            if(!cfg || !cfg.chassis) cfg = car;
            specs.textContent = carSpecs(cfg);
            bottom.appendChild(specs);
            var power = cfg ? carPower(cfg) : null;
            var hp = document.createElement("div");
            hp.className = "hp";
            hp.innerHTML = (power || "?") + "<small>HP</small>";
            bottom.appendChild(hp);
            over.appendChild(bottom);
            div.appendChild(over);
            div.onclick = function() { onPick(name); };
            tilesBox.appendChild(div);
        });
        inner.appendChild(tilesBox);
    }

    function trackStep(inner) {
        inner.innerHTML = "<h2>Choose the track</h2><div class=\"sub\">Choose a track, then Next (a double-click goes on at once).</div>";
        var list = document.createElement("div");
        list.className = "list";
        tracks.filter(function(t) { return t.id !== "skidpad"; }).forEach(function(track) {   // the skidpad is a way to play
            var d = document.createElement("div");
            d.className = "card" + (choice.track === track.id ? " selected" : "");
            var column = trackCardStart(d, track);
            if(choice.track === track.id) {
                var extra = document.createElement("div");
                extra.className = "extra";
                var best = choice.car && OpenRacer.Records ? OpenRacer.Records.best(track.id, choice.car) : null;
                var text = document.createElement("span");
                text.textContent = best ? "Best lap: " + OpenRacer.Records.format(best) : "No lap record yet";
                extra.appendChild(text);
                if(track.dragstrip && OpenRacer.DragStrip) extra.appendChild(button("Drag top 50", "ghost", function(e) { e.stopPropagation(); OpenRacer.DragStrip.showTop(track); }));
                column.appendChild(extra);
            }
            d.onclick = function() { choice.track = track.id; remember(); render(); };
            d.ondblclick = goNext;
            list.appendChild(d);
        });
        inner.appendChild(list);
        if(mode === "free") {
            // free drive has its choices too: the wear of the tyres and the fuel (the rest is under More options)
            var row = document.createElement("div");
            row.className = "setting";
            row.innerHTML = "<span class=\"label\">Tyre wear and fuel</span>";
            var group = document.createElement("div");
            group.className = "chips";
            [[0, "Off"], [1, "On"], [3, "Fast"]].forEach(function(item) {
                var c = document.createElement("button");
                c.className = "chip" + (item[0] === (raceOptions.wear === undefined ? 1 : raceOptions.wear) ? " on" : "");
                c.textContent = item[1];
                c.onclick = function() { raceOptions.wear = item[0]; rememberRace(); render(); };
                group.appendChild(c);
            });
            row.appendChild(group);
            group.appendChild(button("More options…", "ghost", showMore));
            row.style.cssText = "padding-top: 0;";
            inner.insertBefore(row, list);
            // and the damage: on, or off for rigid cars that neither dent nor lose parts
            row = document.createElement("div");
            row.className = "setting";
            row.innerHTML = "<span class=\"label\">Damage</span>";
            group = document.createElement("div");
            group.className = "chips";
            [[true, "On"], [false, "Off"]].forEach(function(item) {
                var c = document.createElement("button");
                c.className = "chip" + (item[0] === (raceOptions.damage !== false) ? " on" : "");
                c.textContent = item[1];
                c.onclick = function() { raceOptions.damage = item[0]; rememberRace(); render(); };
                group.appendChild(c);
            });
            row.appendChild(group);
            row.style.cssText = "margin-bottom: 14px; padding-top: 0;";
            inner.insertBefore(row, list);
        }
    }

    // the ground of the skidpad: the same circle on asphalt, wet asphalt, grass, gravel, sand or mud
    function surfaceStep(inner) {
        inner.innerHTML = "<h2>Choose the ground</h2><div class=\"sub\">Your car circles faster and faster on it until it lets go.</div>";
        var grid = document.createElement("div");
        grid.className = "modes";
        SKIDPAD_SURFACES.forEach(function(s) {
            var d = document.createElement("div");
            d.className = "mode" + (skidSurface === s.id ? " selected" : "");
            d.innerHTML = "<b></b><span></span>";
            var swatch = document.createElement("i");
            swatch.style.cssText = "display: inline-block; width: 14px; height: 14px; border-radius: 4px; margin-right: 10px; vertical-align: -1px; background: " + s.colour + ";";
            d.firstChild.appendChild(swatch);
            d.firstChild.appendChild(document.createTextNode(s.name));
            var surface = getSurface(s.id);
            d.lastChild.textContent = "Grip " + surface.static.toFixed(2) + (surface.loose ? ", loose ground" : "");
            d.onclick = function() { skidSurface = s.id; try { window.localStorage.setItem(SURFACE_KEY, s.id); } catch(e) {} render(); };
            d.ondblclick = goNext;
            grid.appendChild(d);
        });
        inner.appendChild(grid);
    }

    // the weather for this race or drive: the weather, the time of day and the ground, the same options as the Graphics page of the Escape menu (what is chosen here stays there)
    function weatherStep(inner) {
        inner.innerHTML = "<h2>Choose the weather</h2><div class=\"sub\">For this " + (mode === "race" ? "race" : "drive") + ". You can change it in the Escape menu (Graphics) while you drive.</div>";
        function pick(label, items, option) {
            var row = document.createElement("div");
            row.className = "setting";
            var l = document.createElement("span");
            l.className = "label";
            l.textContent = label;
            row.appendChild(l);
            var group = document.createElement("div");
            group.className = "chips";
            var current = typeof Settings !== "undefined" ? Settings.option(option) : null;
            items.forEach(function(item) {
                var c = document.createElement("button");
                c.className = "chip" + (item[0] === current ? " on" : "");
                c.textContent = item[1];
                c.onclick = function() {
                    if(typeof Settings !== "undefined") {
                        Settings.setOption(option, item[0]);
                        if(option === "gfxWeather") Settings.setOption("gfxGround", "auto");        // (a new weather brings its own ground: rain wets the road, snow covers it)
                    }
                    render();
                };
                group.appendChild(c);
            });
            row.appendChild(group);
            inner.appendChild(row);
        }
        pick("Weather", [["clear", "Clear"], ["cloudy", "Cloudy"], ["fog", "Fog"], ["rain", "Rain"], ["snow", "Snow"]], "gfxWeather");
        pick("Time of day", [[5.25, "Dawn"], [8, "Morning"], [12, "Noon"], [15, "Afternoon"], [17.5, "Evening"], [19, "Sunset"], [20.25, "Dusk"], [23.5, "Night"]], "gfxTime");
        pick("Ground", [["auto", "Follows the weather"], ["dry", "Dry"], ["wet", "Wet"], ["snow", "Snow"]], "gfxGround");
        var hint = document.createElement("div");
        hint.className = "hint";
        hint.textContent = "Rain wets the road and snow lies on it: both give less grip, and the AI drives slower. There are no headlights yet: the night is dark.";
        inner.appendChild(hint);
    }

    function raceStep(inner) {
        inner.innerHTML = "<h2>Set up the race</h2><div class=\"sub\">A race starts from a standing start, with a countdown.</div>";
        function setting(label, items, current, apply) {
            var row = document.createElement("div");
            row.className = "setting";
            var l = document.createElement("span");
            l.className = "label";
            l.textContent = label;
            row.appendChild(l);
            var group = document.createElement("div");
            group.className = "chips";
            items.forEach(function(item) {
                var c = document.createElement("button");
                c.className = "chip" + (item[0] === current ? " on" : "");
                c.textContent = item[1];
                c.onclick = function() { apply(item[0]); rememberRace(); render(); };
                group.appendChild(c);
            });
            row.appendChild(group);
            inner.appendChild(row);
        }
        setting("Laps", [[3, "3"], [5, "5"], [10, "10"], [25, "25"]], raceOptions.laps, function(v) { raceOptions.laps = v; });
        setting("Opponents", [[1, "1"], [2, "2"], [3, "3"], [5, "5"], [7, "7"]], raceOptions.ai, function(v) { raceOptions.ai = v; });
        setting("Difficulty", [["easy", "Easy"], ["normal", "Normal"], ["hard", "Hard"]], raceOptions.difficulty, function(v) { raceOptions.difficulty = v; });
        setting("Damage", [[true, "On"], [false, "Off"]], raceOptions.damage !== false, function(v) { raceOptions.damage = v; });      // off: rigid cars, nothing dents or comes off
        var trackChosen = tracks.filter(function(t) { return t.id === choice.track; })[0];
        var hasLine = trackChosen && ((trackChosen.design && trackChosen.design.nodes) || (trackChosen.racing_line && trackChosen.racing_line.length > 10) ||
            (OpenRacer.Records && OpenRacer.Records.anyGhost(choice.track)));
        var hasFinish = trackChosen && ((trackChosen.gates && trackChosen.gates.length) || (trackChosen.checkpoints && trackChosen.checkpoints.length));
        if(trackChosen && !hasFinish) {
            var noFinish = document.createElement("div");
            noFinish.className = "hint";
            noFinish.textContent = "This track has no finish line (no gates), so there is no race on it: it opens as free driving. Pick another track for a race, or add gates in the track editor.";
            inner.appendChild(noFinish);
        } else if(!hasLine) {
            var hint = document.createElement("div");
            hint.className = "hint";
            hint.textContent = "This track has no racing line yet, so the race has no AI cars: you race the clock. Drive a lap here first (it becomes the line), or draw the track in the track editor.";
            inner.appendChild(hint);
        }
        var more = document.createElement("div");
        more.style.marginTop = "18px";
        more.appendChild(button("More options…", "ghost", showMore));
        inner.appendChild(more);
    }

    // ---- the opponents: a grid of the places (as many as Opponents says, 4 in a row); a + adds a car (the way the car is chosen, then the tune when it has one), the copy button adds
    // the same car again. Nothing chosen: the cars of the garage take the places, as before
    function oppList() {
        var list = Array.isArray(raceOptions.opp) ? raceOptions.opp : [];
        return list.filter(function(o) { return o && cars.some(function(c) { return c.id === o.car; }) && (!o.tune || OpenRacer.Setups.names(o.car).indexOf(o.tune) >= 0); }).slice(0, raceOptions.ai);
    }
    function oppAdd(carId, tune) {
        var list = oppList();
        if(list.length >= raceOptions.ai) return;
        raceOptions.opp = list.concat([{ car: carId, tune: tune || "" }]);
        rememberRace();
    }
    function opponentsStep(inner) {
        if(oppPick && oppPick.stage === "car") {
            inner.innerHTML = "<h2>Add an opponent</h2><div class=\"sub\">Click a car to add it.</div>";
            var carTiles = document.createElement("div");
            carTiles.className = "tiles";
            showcase.clear();
            cars.forEach(function(car) {
                carTiles.appendChild(carTile(car, function() {
                    if(OpenRacer.Setups.names(car.id).length >= 1) { oppPick = { stage: "tune", car: car.id }; render(); }
                    else { oppAdd(car.id, ""); oppPick = null; render(); }
                }));
            });
            inner.appendChild(carTiles);
            return;
        }
        if(oppPick && oppPick.stage === "tune") {
            var picked = cars.filter(function(c) { return c.id === oppPick.car; })[0];
            inner.innerHTML = "<h2>Choose the tune</h2><div class=\"sub\">Click a tune of this car to add it. Default is the car as made.</div>";
            if(picked) tuneTiles(inner, picked, null, function(name) { oppAdd(picked.id, name); oppPick = null; render(); });
            return;
        }
        var max = raceOptions.ai, list = oppList();
        inner.innerHTML = "<h2>Choose your opponents</h2><div class=\"sub\">Up to " + max + ". Tap + to add a car; the copy button on a car adds the same one again. The places you leave empty get cars of the game.</div>";
        var grid = document.createElement("div");
        grid.className = "tiles opps";
        list.forEach(function(o, index) {
            var car = cars.filter(function(c) { return c.id === o.car; })[0];
            var div = document.createElement("div");
            div.className = "tile";
            var picture = document.createElement("img");
            picture.alt = "";
            picture.draggable = false;
            div.appendChild(picture);
            if(o.tune) previews.requestTune(car, o.tune, picture); else previews.request(car, picture);
            var over = document.createElement("div");
            over.className = "over";
            var label = document.createElement("div");
            label.className = "name";
            label.textContent = car.name || car.id;
            over.appendChild(label);
            var tuneLine = document.createElement("div");
            tuneLine.className = "specs";
            tuneLine.textContent = o.tune || "Default";
            over.appendChild(tuneLine);
            div.appendChild(over);
            var acts = document.createElement("div");
            acts.className = "acts";
            if(list.length < max) {
                var copy = document.createElement("button");
                copy.textContent = "⧉";
                copy.title = "Add the same car again";
                copy.onclick = function(e) { e.stopPropagation(); oppAdd(o.car, o.tune); render(); };
                acts.appendChild(copy);
            }
            var remove = document.createElement("button");
            remove.textContent = "✕";
            remove.title = "Remove this opponent";
            remove.onclick = function(e) { e.stopPropagation(); raceOptions.opp = list.filter(function(x, i) { return i !== index; }); rememberRace(); render(); };
            acts.appendChild(remove);
            div.appendChild(acts);
            grid.appendChild(div);
        });
        for(var i = list.length; i < max; i++) {
            var empty = document.createElement("div");
            empty.className = "tile empty";
            empty.textContent = "+";
            empty.title = "Add an opponent";
            empty.onclick = function() { oppPick = { stage: "car" }; render(); };
            grid.appendChild(empty);
        }
        inner.appendChild(grid);
    }

    function summary() {
        var car = cars.filter(function(c) { return c.id === choice.car; })[0];
        var track = tracks.filter(function(t) { return t.id === choice.track; })[0];
        var parts = [];
        if(screen !== "mode") parts.push({ free: "Free drive", race: "Race", skidpad: "Skidpad" }[mode]);
        if(car && screen !== "mode" && screen !== "car") parts.push(car.name || car.id);
        if(car && OpenRacer.Setups && tunesOf().length >= 1 && screen !== "mode" && screen !== "car" && screen !== "tune") parts.push(OpenRacer.Setups.active(car.id) || "Default");
        if(mode === "skidpad" && screen === "surface") parts.push((SKIDPAD_SURFACES.filter(function(s) { return s.id === skidSurface; })[0] || {}).name || "Asphalt");
        else if(car && screen === "car") parts.push(car.name || car.id);
        if(track && mode !== "skidpad" && (screen === "track" || screen === "weather" || screen === "race" || screen === "opponents")) parts.push(track.name || track.id);
        if(screen === "race") parts.push(raceOptions.laps + " laps, " + raceOptions.ai + " opponents");
        if(screen === "opponents") parts.push(raceOptions.laps + " laps, " + (oppList().length || raceOptions.ai) + " opponents" + (oppList().length ? "" : " (chosen by the game)"));
        return parts;
    }

    function render(error) {
        element.innerHTML = "";
        var top = document.createElement("div");
        top.className = "top";
        if(screen !== "home") {
            var logo = document.createElement("a");
            logo.className = "or-logo";
            logo.href = "#";
            logo.innerHTML = "<i></i>OpenRacer";
            logo.onclick = function(e) { e.preventDefault(); go("home"); };
            top.appendChild(logo);
            var steps = stepsOf();
            var chips = document.createElement("div");
            chips.className = "steps";
            var at = steps.indexOf(screen);
            steps.forEach(function(s, i) {
                var span = document.createElement("span");
                span.textContent = (i + 1) + " " + STEP_NAMES[s];
                span.className = i === at ? "on" : (i < at ? "done" : "");
                if(i < at) span.onclick = function() { go(s); };
                chips.appendChild(span);
            });
            top.appendChild(chips);
            element.appendChild(top);
        }
        var page = document.createElement("div");
        page.className = "page";
        element.appendChild(page);
        if(error) {
            var message = document.createElement("div");
            message.className = "error";
            message.textContent = error;
            page.appendChild(message);
        }
        if(screen === "home") {
            page.style.display = "flex";      // the home screen in the middle of the page, both ways
            home(page);
            return;
        }
        var inner = document.createElement("div");
        inner.className = "inner";
        page.appendChild(inner);
        if(screen === "mode") modeStep(inner);
        else if(screen === "car") carStep(inner);
        else if(screen === "tune") tuneStep(inner);
        else if(screen === "track") trackStep(inner);
        else if(screen === "weather") weatherStep(inner);
        else if(screen === "race") raceStep(inner);
        else if(screen === "opponents") opponentsStep(inner);
        else if(screen === "surface") surfaceStep(inner);

        var bar = document.createElement("div");
        bar.className = "bar";
        bar.appendChild(button("‹ Back", "ghost", goBack));
        var sum = document.createElement("div");
        sum.className = "summary";
        summary().forEach(function(part, i) {
            if(i) sum.appendChild(document.createTextNode("  ·  "));
            var b = document.createElement("b");
            b.textContent = part;
            sum.appendChild(b);
        });
        bar.appendChild(sum);
        if(screen !== "mode" && !oppPick) {
            var steps2 = stepsOf();
            var last = steps2.indexOf(screen) === steps2.length - 1;
            var next = button(last ? (mode === "skidpad" ? "Start" : "Start ▶") : "Next ›", "primary", goNext);
            next.disabled = (screen === "car" && !choice.car) || (screen === "track" && !choice.track);
            bar.appendChild(next);
        }
        element.appendChild(bar);
    }

    function pick(list, id) {
        for(var i = 0; i < list.length; i++) {
            if(list[i].id === id) return id;
        }
        return list.length ? list[0].id : null;
    }

    function load() {
        Promise.all([Catalog.load("cars"), Catalog.load("tracks")]).then(function(result) {
            cars = result[0];
            tracks = result[1];
            choice.car = pick(cars, choice.car);
            choice.track = pick(tracks, choice.track);
            render(cars.length && tracks.length ? null : "No cars or tracks found.");
        }).catch(function(error) {
            render("Could not read the list of cars and tracks: " + error.message);
        });
    }

    // ?import=<link to a zip>: the car or the track at that link is added to the garage, after a question
    function importFromAddress() {
        var url = new URLSearchParams(window.location.search).get("import");
        if(!url) return false;
        var host = url;
        try { host = new URL(url).host; } catch(e) { /* as it is */ }
        window.history.replaceState(null, "", window.location.pathname);
        OpenRacerDialog.ask({ title: "Add from " + host + "?", text: "The car or track at this link is added to your garage.", ok: "Add", cancel: "Not now" }).then(function(yes) {
            if(!yes) { load(); return; }
            element.innerHTML = "";
            var busy = document.createElement("div");
            busy.style.cssText = "margin: auto; color: var(--text); font-size: 18px;";
            busy.textContent = "Importing from " + host + "…";
            element.appendChild(busy);
            OpenRacer.Garage.importUrl(url).then(function(item) {
                if(item.kind === "cars") choice.car = item.id; else choice.track = item.id;
                remember();
                load();
            }).catch(function(error) { load(); OpenRacerDialog.tell({ title: "Could not import", text: error.message }); });
        });
        return true;
    }

    function show() {
        addStyle();
        var last = remembered();
        choice.car = last.car || null;
        choice.track = last.track || null;
        element = document.createElement("div");
        element.id = "mainMenu";
        document.body.appendChild(element);
        // (every choice of the menu is a card, a tile or a step: they get the focus with Tab and are chosen with Enter or Space, as a button is)
        var CHOOSABLE = ".mode, .tile, .card, .steps span.done";
        new MutationObserver(function() {
            element.querySelectorAll(CHOOSABLE).forEach(function(el) { if(!el.hasAttribute("tabindex")) { el.tabIndex = 0; el.setAttribute("role", "button"); } });
        }).observe(element, { childList: true, subtree: true });
        element.addEventListener("keydown", function(event) {
            var el = event.target;
            if(!el || !el.matches || !el.matches(CHOOSABLE) || (event.code !== "Enter" && event.code !== "Space")) return;
            // Enter on what is chosen already goes on (Next); otherwise it chooses it, as a click
            if(event.code === "Enter" && el.classList.contains("selected") && !el.classList.contains("mode")) return;       // (a way to play goes on when it is chosen)
            event.preventDefault(); event.stopPropagation();
            el.click();
            // (a choice builds the page again: the focus goes to what is chosen now, not back to the top of the page)
            if(!document.contains(el)) {
                var chosen = element.querySelector(".mode.selected, .tile.selected, .card.selected") || element.querySelector(CHOOSABLE);
                if(chosen) { chosen.tabIndex = 0; chosen.focus(); }
            }
        });
        window.addEventListener("keydown", function(event) {
            if(document.querySelector("#orDialog, #settingsMenu")) return;      // (a question or the settings: their own keys)
            // a window of the menu (the garage, the replays, more options, a pick): Escape closes it, the one on top
            var windows = document.querySelectorAll(".or-dialog, #replaysDialog, #garageDialog");
            if(windows.length) { if(event.code === "Escape") { windows[windows.length - 1].remove(); event.preventDefault(); } return; }
            // Enter on a button, a field or a link is that button's (it was also "Next", and the page changed under the click)
            if(event.code === "Enter" && event.target && /^(BUTTON|INPUT|SELECT|TEXTAREA|A)$/.test(event.target.tagName)) return;
            if(event.code === "Enter") { if(screen === "home") go("mode"); else if(screen !== "mode" && !oppPick) goNext(); }
            else if(event.code === "Escape" && screen !== "home") goBack();
        });
        if(!importFromAddress()) load();
    }

    return { show: show, importFromAddress: importFromAddress };
})();
