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
    var raceOptions = { ai: 0, difficulty: "normal", ghost: true, records: true, laps: 0, wear: 1 };
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

    function addStyle() {
        var style = document.createElement("style");
        style.textContent =
            "#mainMenu { position: fixed; left: 0; top: 0; width: 100%; height: 100%; z-index: 3000; overflow-y: auto; color: #fff; " +
            "font-family: Arial, sans-serif; background: linear-gradient(180deg, #14181f 0%, #25303f 100%); }" +
            "#mainMenu .wrap { max-width: 1240px; margin: 0 auto; padding: 36px 28px 60px; }" +
            "#mainMenu h1 { font-size: 44px; margin: 0; letter-spacing: 2px; }" +
            "#mainMenu .tag { color: #8fa3bd; margin: 4px 0 28px; }" +
            "#mainMenu .columns { display: flex; gap: 32px; flex-wrap: wrap; }" +
            "#mainMenu .column { flex: 1; min-width: 300px; }" +
            "#mainMenu h2 { font-size: 15px; letter-spacing: 2px; color: #9ab; text-transform: uppercase; margin: 0 0 10px; }" +
            "#mainMenu .card { background: #1d232c; border: 2px solid #2c3541; border-radius: 8px; padding: 14px 16px; margin-bottom: 10px; cursor: pointer; }" +
            "#mainMenu .card:hover { border-color: #4a5a70; }" +
            "#mainMenu .card.selected { border-color: #3aa86a; background: #1f2d27; }" +
            "#mainMenu .card .name { font-size: 19px; font-weight: bold; }" +
            "#mainMenu .card .info { color: #9aa8ba; font-size: 14px; margin-top: 4px; }" +
            "#mainMenu .card .specs { color: #7e90a6; font-size: 13px; margin-top: 6px; }" +
            // the cars: square tiles with the turning model of the car on a dark radial gradient, the text over it
            "#mainMenu .cars { margin-bottom: 30px; }" +
            "#mainMenu .tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }" +
            "@media (max-width: 900px) { #mainMenu .tiles { grid-template-columns: repeat(2, 1fr); } }" +
            "#mainMenu .tile { position: relative; aspect-ratio: 1; border: 2px solid #2c3541; border-radius: 10px; overflow: hidden; cursor: pointer; " +
            "background: radial-gradient(circle at 50% 58%, #62676e 0%, #2b2f36 48%, #000000 100%); }" +
            "#mainMenu .tile:hover { border-color: #4a5a70; }" +
            "#mainMenu .tile.selected { border-color: #3aa86a; box-shadow: 0 0 0 1px #3aa86a inset, 0 0 18px rgba(58, 168, 106, 0.35); }" +
            "#mainMenu .tile canvas { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: block; }" +
            "#mainMenu .tile .over { position: absolute; left: 0; top: 0; right: 0; bottom: 0; padding: 12px 14px; pointer-events: none; display: flex; flex-direction: column; " +
            "text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9); background: linear-gradient(180deg, rgba(0, 0, 0, 0.45) 0%, rgba(0, 0, 0, 0) 38%, rgba(0, 0, 0, 0) 70%, rgba(0, 0, 0, 0.55) 100%); }" +
            "#mainMenu .tile .name { font-size: 19px; font-weight: bold; }" +
            "#mainMenu .tile .info { color: #c9d3df; font-size: 13px; margin-top: 2px; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }" +
            "#mainMenu .tile .bottom { margin-top: auto; display: flex; justify-content: space-between; align-items: flex-end; gap: 8px; }" +
            "#mainMenu .tile .hp { font-size: 26px; font-weight: bold; line-height: 1; white-space: nowrap; }" +
            "#mainMenu .tile .hp small { font-size: 12px; font-weight: normal; color: #9fb0c4; letter-spacing: 1px; margin-left: 4px; }" +
            "#mainMenu .tile .specs { color: #9fb0c4; font-size: 12px; line-height: 1.3; }" +
            "#mainMenu .start { margin-top: 18px; font-size: 22px; padding: 14px 44px; border: 0; border-radius: 8px; background: #2e9a5c; color: #fff; cursor: pointer; }" +
            "#mainMenu .start:hover { background: #38b56e; }" +
            "#mainMenu .secondary { margin-top: 18px; margin-left: 12px; font-size: 22px; padding: 14px 30px; border: 0; border-radius: 8px; background: #36404e; color: #fff; cursor: pointer; }" +
            "#mainMenu .secondary:hover { background: #4a586b; }" +
            "#mainMenu .start:disabled { background: #3a4350; color: #7c8794; cursor: default; }" +
            "#mainMenu .foot { margin-top: 30px; color: #7e90a6; font-size: 14px; line-height: 1.6; }" +
            "#mainMenu .foot a { color: #7fb8ff; }" +
            "#mainMenu .foot button { background: #2c3541; color: #fff; border: 0; border-radius: 4px; padding: 4px 10px; cursor: pointer; }" +
            "#mainMenu .error { color: #ff9a8a; }" +
            "#mainMenu .option { display: flex; align-items: center; justify-content: space-between; background: #1d232c; border: 2px solid #2c3541; border-radius: 8px; padding: 10px 14px; margin-bottom: 8px; }" +
            "#mainMenu .option .label { color: #cfd8e3; }" +
            "#mainMenu .option button { background: #2c3541; color: #fff; border: 0; border-radius: 4px; padding: 6px 12px; cursor: pointer; min-width: 120px; }" +
            "#mainMenu .option button:hover { background: #3a4656; }" +
            "#mainMenu .record { color: #9aa8ba; font-size: 14px; margin: 6px 0 14px; }" +
            // the badge of a car or track that is not of the server: the garage of this browser or a folder on the PC (Garage.js)
            "#mainMenu .badge { display: inline-block; font-size: 11px; font-weight: normal; letter-spacing: 1px; text-transform: uppercase; vertical-align: middle; " +
            "margin-left: 8px; padding: 2px 7px; border-radius: 10px; background: #3b5b8a; color: #dbe7f7; }" +
            "#mainMenu .badge.folder { background: #6b5a2b; color: #f3e6c4; }" +
            // the garage dialog
            "#garageDialog { position: fixed; left: 0; top: 0; width: 100%; height: 100%; z-index: 3100; background: rgba(0, 0, 0, 0.65); display: flex; align-items: center; justify-content: center; }" +
            "#garageDialog .box { width: 720px; max-width: calc(100% - 40px); max-height: calc(100% - 40px); overflow-y: auto; background: #1d232c; border: 2px solid #2c3541; border-radius: 10px; padding: 20px 24px; color: #fff; font-family: Arial, sans-serif; }" +
            "#garageDialog h2 { margin: 0 0 4px; font-size: 22px; letter-spacing: 1px; }" +
            "#garageDialog .note { color: #9aa8ba; font-size: 14px; line-height: 1.5; margin: 0 0 14px; }" +
            "#garageDialog h3 { font-size: 13px; letter-spacing: 2px; color: #9ab; text-transform: uppercase; margin: 16px 0 6px; }" +
            "#garageDialog .row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid #2c3541; border-radius: 6px; margin-bottom: 6px; }" +
            "#garageDialog .row .name { flex: 1; }" +
            "#garageDialog .row .meta { color: #7e90a6; font-size: 13px; }" +
            "#garageDialog button { background: #2c3541; color: #fff; border: 0; border-radius: 4px; padding: 6px 12px; cursor: pointer; }" +
            "#garageDialog button:hover { background: #3a4656; }" +
            "#garageDialog button.danger:hover { background: #8a3a32; }" +
            "#garageDialog .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }" +
            "#garageDialog .status { color: #ffd04d; font-size: 14px; min-height: 18px; margin-top: 10px; }" +
            "#garageDialog .status.error { color: #ff9a8a; }" +
            "#garageDialog .close { float: right; }";
        document.head.appendChild(style);
    }

    function carPower(car) {
        var curve = (car.engine && car.engine.torque_curve) || [];
        var peak = 0;
        curve.forEach(function(point) { peak = Math.max(peak, point[1] * point[0] * Math.PI / 30 / 745.7); });
        var scale = car.engine && car.engine.power_scale !== undefined ? car.engine.power_scale : 1; // the tuning that is in the car
        return Math.round(peak * scale);
    }

    function carSpecs(car) {
        var drive = (car.drivetrain && car.drivetrain.drive || "rwd").toUpperCase();
        var gears = car.drivetrain && car.drivetrain.gear_ratios ? car.drivetrain.gear_ratios.length : "?";
        return Math.round(car.chassis.mass) + " kg · " + drive + " · " + gears + " gears";
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

        function modelOf(car) {
            if(models[car.id]) return models[car.id];
            var entry = models[car.id] = { object: null, radius: car.chassis.tire_diameter / 2, length: (car.dimensions && car.dimensions.length) || 4.5 };
            OpenRacer.loadCarModel(car, function(model) {
                var object = new THREE.Group();
                var r = entry.radius;
                model.tilt.position.y = ((model.bodyLift || 1) - 1) * r;
                object.add(model.tilt);
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
        return { add: add, clear: clear };
    })();

    function carTile(car) {
        var div = document.createElement("div");
        div.className = "tile" + (choice.car === car.id ? " selected" : "");
        var canvas = document.createElement("canvas");
        div.appendChild(canvas);
        var over = document.createElement("div");
        over.className = "over";
        var name = document.createElement("div");
        name.className = "name";
        name.textContent = car.name || car.id;
        addBadge(name, car);
        over.appendChild(name);
        if(car.description) {
            var info = document.createElement("div");
            info.className = "info";
            info.textContent = car.description;
            over.appendChild(info);
        }
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
        div.onclick = function() { choice.car = car.id; remember(); render(); };
        div.ondblclick = start;
        showcase.add(car, canvas);
        return div;
    }

    function card(item, key, lines) {
        var div = document.createElement("div");
        div.className = "card" + (choice[key] === item.id ? " selected" : "");
        var name = document.createElement("div");
        name.className = "name";
        name.textContent = item.name || item.id;
        addBadge(name, item);
        div.appendChild(name);
        if(item.description) {
            var info = document.createElement("div");
            info.className = "info";
            info.textContent = item.description;
            div.appendChild(info);
        }
        if(lines) {
            var specs = document.createElement("div");
            specs.className = "specs";
            specs.textContent = lines;
            div.appendChild(specs);
        }
        div.onclick = function() { choice[key] = item.id; remember(); render(); };
        div.ondblclick = start;
        return div;
    }

    // "my garage" or "folder" after the name of a car or track that is not of the server (see Garage.js)
    function addBadge(name, item) {
        var source = OpenRacer.Garage ? OpenRacer.Garage.sourceOf(item) : null;
        if(!source) return;
        var badge = document.createElement("span");
        badge.className = "badge " + source;
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
            box.insertAdjacentHTML("beforeend", "<h2>My garage</h2><p class=\"note\">Your own cars and tracks live here, in this browser, next to the ones that come with the game: " +
                "what you save in the car editor and the track editor, what you import from a zip, and the tuning you save to a car. Nothing is sent to the server. " +
                "Export a car or track as a zip to pass it on or to keep it, and import a zip someone gave you.</p>");
            status = document.createElement("div");
            status.className = "status";

            Promise.all([Garage.list("cars"), Garage.list("tracks"), Garage.usage()]).then(function(result) {
                [["cars", "Cars", result[0]], ["tracks", "Tracks", result[1]]].forEach(function(section) {
                    var kind = section[0], records = section[2];
                    box.insertAdjacentHTML("beforeend", "<h3>" + section[1] + " in the garage</h3>");
                    if(!records.length) {
                        box.insertAdjacentHTML("beforeend", "<div class=\"note\">None yet.</div>");
                        return;
                    }
                    records.forEach(function(record) {
                        var row = document.createElement("div");
                        row.className = "row";
                        var name = document.createElement("div");
                        name.className = "name";
                        var files = Object.keys(record.files || {});
                        name.innerHTML = "<b></b> <span class=\"meta\"></span>";
                        name.querySelector("b").textContent = record.json.name || record.id;
                        name.querySelector(".meta").textContent = record.id + " · " + (files.length ? files.length + " file" + (files.length === 1 ? "" : "s") + ", " + formatSize(Garage.sizeOf(record)) :
                            "settings only, the files of the server are used");
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
                            if(!window.confirm("Delete " + (record.json.name || record.id) + " from the garage of this browser?")) return;
                            Garage.remove(kind, record.id).then(build).catch(function(error) { say("Could not delete: " + error.message, true); });
                        };
                        row.appendChild(deleteButton);
                        box.appendChild(row);
                    });
                });

                box.insertAdjacentHTML("beforeend", "<h3>Import</h3>");
                var actions = document.createElement("div");
                actions.className = "actions";
                var importInput = document.createElement("input");
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
                var importButton = document.createElement("button");
                importButton.textContent = "Import a zip…";
                importButton.onclick = function() { importInput.click(); };
                actions.appendChild(importButton);
                actions.appendChild(importInput);
                box.appendChild(actions);
                box.insertAdjacentHTML("beforeend", "<div class=\"note\" style=\"margin-top: 8px;\">A zip with car.json or track.json and the files of the model (an exported one, or a zipped folder from web/cars or web/tracks).</div>");

                // the folder on the PC
                box.insertAdjacentHTML("beforeend", "<h3>Folder on your PC</h3>");
                var folderActions = document.createElement("div");
                folderActions.className = "actions";
                if(!Garage.folderSupported()) {
                    box.insertAdjacentHTML("beforeend", "<div class=\"note\">This browser cannot read a folder on your PC (Chrome and Edge can). Import a zip instead.</div>");
                } else {
                    var info = Garage.folderInfo();
                    var folderNote = document.createElement("div");
                    folderNote.className = "note";
                    if(info.name) {
                        folderNote.textContent = "Linked: " + info.name + (info.permission === "granted" ? "" : " (allow the browser to read it)") +
                            ". Its cars/<id>/car.json and tracks/<id>/track.json are in the menu (or the folder itself when it holds cars directly).";
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
                        folderNote.textContent = "Link a folder on your PC with cars and tracks in it (cars/<id>/car.json and tracks/<id>/track.json, like web/cars and web/tracks): " +
                            "they are read from there every time the menu opens, nothing is copied.";
                        var link = document.createElement("button");
                        link.textContent = "Link a folder…";
                        link.onclick = function() {
                            Garage.linkFolder().then(function() { say("The folder is linked."); build(); }).catch(function(error) {
                                if(error && error.name !== "AbortError") say("Could not link the folder: " + error.message, true);
                            });
                        };
                        folderActions.appendChild(link);
                    }
                    box.appendChild(folderNote);
                }
                box.appendChild(folderActions);

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

    function start() {
        if(!choice.car || !choice.track) return;
        remember();
        window.location.href = window.location.pathname + "?car=" + encodeURIComponent(choice.car) + "&track=" + encodeURIComponent(choice.track) +
            "&ai=" + raceOptions.ai + "&difficulty=" + raceOptions.difficulty + "&ghost=" + (raceOptions.ghost ? 1 : 0) + "&records=" + (raceOptions.records ? 1 : 0) +
            "&laps=" + (raceOptions.laps || 0) + "&wear=" + (raceOptions.wear === undefined ? 1 : raceOptions.wear);
    }

    function render(error) {
        element.innerHTML = "";
        var wrap = document.createElement("div");
        wrap.className = "wrap";
        wrap.innerHTML = "<h1>OpenRacer</h1><div class=\"tag\">Choose a car and a track</div>";
        // the cars: a row of tiles over the whole width, four across
        var carRow = document.createElement("div");
        carRow.className = "cars";
        carRow.innerHTML = "<h2>Car</h2>";
        var tiles = document.createElement("div");
        tiles.className = "tiles";
        showcase.clear();
        cars.forEach(function(car) { tiles.appendChild(carTile(car)); });
        carRow.appendChild(tiles);
        wrap.appendChild(carRow);

        var columns = document.createElement("div");
        columns.className = "columns";

        var trackColumn = document.createElement("div");
        trackColumn.className = "column";
        trackColumn.innerHTML = "<h2>Track</h2>";
        tracks.forEach(function(track) { trackColumn.appendChild(card(track, "track", "")); });
        columns.appendChild(trackColumn);

        // the race: AI cars, the ghost and the records (see main.js)
        var raceColumn = document.createElement("div");
        raceColumn.className = "column";
        raceColumn.innerHTML = "<h2>Race</h2>";
        var option = function(label, text, onClick) {
            var row = document.createElement("div");
            row.className = "option";
            var l = document.createElement("span");
            l.className = "label";
            l.textContent = label;
            var b = document.createElement("button");
            b.textContent = text;
            b.onclick = function() { onClick(); rememberRace(); render(); };
            row.appendChild(l);
            row.appendChild(b);
            return row;
        };
        var lapCounts = [0, 3, 5, 10];
        raceColumn.appendChild(option("Race", raceOptions.laps ? raceOptions.laps + " laps" : "Practice", function() { raceOptions.laps = lapCounts[(lapCounts.indexOf(raceOptions.laps || 0) + 1) % lapCounts.length]; }));
        var counts = [0, 1, 2, 3, 5, 7];
        raceColumn.appendChild(option("AI opponents", raceOptions.ai === 0 ? "None" : String(raceOptions.ai), function() { raceOptions.ai = counts[(counts.indexOf(raceOptions.ai) + 1) % counts.length]; }));
        var levels = ["easy", "normal", "hard"], levelNames = { easy: "Easy", normal: "Normal", hard: "Hard" };
        raceColumn.appendChild(option("Difficulty", levelNames[raceOptions.difficulty] || "Normal", function() { raceOptions.difficulty = levels[(levels.indexOf(raceOptions.difficulty) + 1) % levels.length]; }));
        var wears = [0, 1, 3], wearNames = { 0: "Off", 1: "On", 3: "Fast (short races)" };
        raceColumn.appendChild(option("Tyre wear and fuel", wearNames[raceOptions.wear] || "On", function() { raceOptions.wear = wears[(wears.indexOf(raceOptions.wear === undefined ? 1 : raceOptions.wear) + 1) % wears.length]; }));
        raceColumn.appendChild(option("Ghost of your best lap", raceOptions.ghost ? "On" : "Off", function() { raceOptions.ghost = !raceOptions.ghost; }));
        raceColumn.appendChild(option("Save lap records", raceOptions.records ? "On" : "Off", function() { raceOptions.records = !raceOptions.records; }));
        var record = document.createElement("div");
        record.className = "record";
        var best = choice.track && choice.car && typeof OpenRacer !== "undefined" && OpenRacer.Records ? OpenRacer.Records.best(choice.track, choice.car) : null;
        var trackChosen = tracks.filter(function(t) { return t.id === choice.track; })[0];
        var hasLine = trackChosen && ((trackChosen.design && trackChosen.design.nodes) || (trackChosen.racing_line && trackChosen.racing_line.length > 10) ||
            (OpenRacer.Records && OpenRacer.Records.anyGhost(choice.track)));
        record.innerHTML = (raceOptions.laps ? "A race of " + raceOptions.laps + " laps from a standing start, with a countdown; practice has no end.<br>" : "") +
            (best ? "Best lap with this car: <b>" + OpenRacer.Records.format(best) + "</b>" : "No lap record with this car here yet.") +
            (raceOptions.ai > 0 ? "<br>" + (hasLine ? "The AI drives the racing line of this track." : "The AI needs a racing line: drive one lap here first, or draw the track in the track editor.") : "");
        raceColumn.appendChild(record);
        columns.appendChild(raceColumn);
        wrap.appendChild(columns);

        if(error) {
            var message = document.createElement("div");
            message.className = "foot error";
            message.textContent = error;
            wrap.appendChild(message);
        }

        var button = document.createElement("button");
        button.className = "start";
        button.textContent = "Start";
        button.disabled = !(choice.car && choice.track);
        button.onclick = start;
        wrap.appendChild(button);

        var editor = document.createElement("button");
        editor.className = "secondary";
        editor.textContent = "Car editor";
        editor.onclick = function() { window.location.href = "tools/car-editor.html"; };
        wrap.appendChild(editor);

        var trackEditor = document.createElement("button");
        trackEditor.className = "secondary";
        trackEditor.textContent = "Track editor";
        trackEditor.onclick = function() { window.location.href = "tools/track-editor.html"; };
        wrap.appendChild(trackEditor);

        // the garage: the player's own cars and tracks in this browser (Garage.js)
        if(OpenRacer.Garage && OpenRacer.Garage.available()) {
            var garage = document.createElement("button");
            garage.className = "secondary";
            garage.textContent = "My garage";
            garage.title = "Your own cars and tracks in this browser: import or export a zip, link a folder on your PC";
            garage.onclick = showGarage;
            wrap.appendChild(garage);
        }

        // the skidpad: the chosen car drives round the circle by itself until it lets go (main.js, startSkidpad)
        if(tracks.some(function(t) { return t.id === "skidpad"; })) {
            var skidpad = document.createElement("button");
            skidpad.className = "secondary";
            skidpad.textContent = "Skidpad";
            skidpad.title = "The chosen car drives round a circle of 50 m faster and faster until it lets go: how much lateral g does it hold?";
            skidpad.disabled = !choice.car;
            skidpad.onclick = function() {
                remember();
                window.location.href = window.location.pathname + "?car=" + encodeURIComponent(choice.car) + "&track=skidpad&mode=skidpad&ai=0&ghost=0&records=0&wear=0";
            };
            wrap.appendChild(skidpad);
        }

        // a replay that someone saved (Replay.js): it needs the same track and cars as the one who made it
        var replayInput = document.createElement("input");
        replayInput.type = "file";
        replayInput.style.display = "none";
        replayInput.onchange = function() {
            var file = replayInput.files && replayInput.files[0];
            if(!file) return;
            OpenRacer.Replay.openFile(file, cars, tracks).then(function(ids) {
                window.location.href = window.location.pathname + "?car=" + encodeURIComponent(ids.car) + "&track=" + encodeURIComponent(ids.track) + "&replay=1";
            }).catch(function(problem) { render(problem.message || "This file could not be opened."); });
        };
        wrap.appendChild(replayInput);
        var openReplay = document.createElement("button");
        openReplay.className = "secondary";
        openReplay.textContent = "Open a replay";
        openReplay.title = "Watch a replay that was saved from the game (a .openracer-replay file)";
        openReplay.onclick = function() { replayInput.click(); };
        wrap.appendChild(openReplay);

        var foot = document.createElement("div");
        foot.className = "foot";
        foot.innerHTML = "Cars are in <code>web/cars</code> and tracks in <code>web/tracks</code>: a folder with a <code>car.json</code> or " +
            "<code>track.json</code> is found by itself. Make a car from a glTF/glb model (for example from Blender) with the " +
            "<a href=\"tools/car-editor.html\">car editor</a>, and a track from a glTF/glb model with the <a href=\"tools/track-editor.html\">track editor</a>. " +
            "Without the server of start-server.sh they are kept in <i>My garage</i>, in this browser. ";
        var rescan = document.createElement("button");
        rescan.textContent = "Look for new cars and tracks";
        rescan.onclick = load;
        foot.appendChild(rescan);
        wrap.appendChild(foot);
        var version = document.createElement("div");
        version.className = "foot";
        version.style.cssText = "text-align: right; opacity: 0.6;";
        version.textContent = "OpenRacer " + OpenRacer.VERSION;
        wrap.appendChild(version);
        element.appendChild(wrap);
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

    function show() {
        addStyle();
        var last = remembered();
        choice.car = last.car || null;
        choice.track = last.track || null;
        element = document.createElement("div");
        element.id = "mainMenu";
        document.body.appendChild(element);
        window.addEventListener("keydown", function(event) {
            if(event.code === "Enter") start();
        });
        load();
    }

    return { show: show };
})();
