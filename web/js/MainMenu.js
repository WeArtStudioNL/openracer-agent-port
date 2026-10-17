/*
 * MainMenu.js
 *
 * Description: The menu at the start of the game, with the choice of the car and the track. Starting the game
 *              opens the page again with the choice in the address (index.html?car=...&track=...), so every
 *              start is a clean one; the main menu is the page without a choice.
 */

var MainMenu = (function() {
    var STORAGE_KEY = "openracer.lastChoice";
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
            "#mainMenu .wrap { max-width: 1000px; margin: 0 auto; padding: 36px 28px 60px; }" +
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
            "#mainMenu .start { margin-top: 18px; font-size: 22px; padding: 14px 44px; border: 0; border-radius: 8px; background: #2e9a5c; color: #fff; cursor: pointer; }" +
            "#mainMenu .start:hover { background: #38b56e; }" +
            "#mainMenu .start:disabled { background: #3a4350; color: #7c8794; cursor: default; }" +
            "#mainMenu .foot { margin-top: 30px; color: #7e90a6; font-size: 14px; line-height: 1.6; }" +
            "#mainMenu .foot a { color: #7fb8ff; }" +
            "#mainMenu .foot button { background: #2c3541; color: #fff; border: 0; border-radius: 4px; padding: 4px 10px; cursor: pointer; }" +
            "#mainMenu .error { color: #ff9a8a; }";
        document.head.appendChild(style);
    }

    function carSpecs(car) {
        var curve = (car.engine && car.engine.torque_curve) || [];
        var peak = 0;
        curve.forEach(function(point) { peak = Math.max(peak, point[1] * point[0] * Math.PI / 30 / 745.7); });
        var drive = (car.drivetrain && car.drivetrain.drive || "rwd").toUpperCase();
        var gears = car.drivetrain && car.drivetrain.gear_ratios ? car.drivetrain.gear_ratios.length : "?";
        return (peak ? Math.round(peak) + " hp · " : "") + Math.round(car.chassis.mass) + " kg · " + drive + " · " + gears + " gears" +
            (car.model && car.model.type === "gltf" ? " · glTF model" : "");
    }

    function card(item, key, lines) {
        var div = document.createElement("div");
        div.className = "card" + (choice[key] === item.id ? " selected" : "");
        var name = document.createElement("div");
        name.className = "name";
        name.textContent = item.name || item.id;
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

    function start() {
        if(!choice.car || !choice.track) return;
        remember();
        window.location.href = window.location.pathname + "?car=" + encodeURIComponent(choice.car) + "&track=" + encodeURIComponent(choice.track);
    }

    function render(error) {
        element.innerHTML = "";
        var wrap = document.createElement("div");
        wrap.className = "wrap";
        wrap.innerHTML = "<h1>OpenRacer</h1><div class=\"tag\">Choose a car and a track</div>";
        var columns = document.createElement("div");
        columns.className = "columns";

        var carColumn = document.createElement("div");
        carColumn.className = "column";
        carColumn.innerHTML = "<h2>Car</h2>";
        cars.forEach(function(car) { carColumn.appendChild(card(car, "car", carSpecs(car))); });
        columns.appendChild(carColumn);

        var trackColumn = document.createElement("div");
        trackColumn.className = "column";
        trackColumn.innerHTML = "<h2>Track</h2>";
        tracks.forEach(function(track) { trackColumn.appendChild(card(track, "track", "")); });
        columns.appendChild(trackColumn);
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

        var foot = document.createElement("div");
        foot.className = "foot";
        foot.innerHTML = "Cars are in <code>web/cars</code> and tracks in <code>web/tracks</code>: a folder with a <code>car.json</code> or " +
            "<code>track.json</code> is found by itself. Make a car from a glTF/glb model (for example from Blender) with the " +
            "<a href=\"tools/car-editor.html\">car editor</a>. ";
        var rescan = document.createElement("button");
        rescan.textContent = "Look for new cars and tracks";
        rescan.onclick = load;
        foot.appendChild(rescan);
        wrap.appendChild(foot);
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
