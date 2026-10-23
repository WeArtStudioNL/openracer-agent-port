/**
 * GateMarkers.js
 *
 * The checkpoints of a track, shown in the game: at every gate (a line across the road, see the track editor) two posts and a bar over the road,
 * and a strip on it. The finish line is white, the gate that is next is green, the ones that were passed this lap are dim and the others orange.
 * It is a choice of the track (`show_gates` in track.json, a checkbox of the track editor); without it nothing is made.
 */
OpenRacer.GateMarkers = (function () {
    var group = null, gates = [], last = "";
    var POST = 3.2;     // the height of the posts (m)

    function colour(hex) { return new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.85, fog: false }); }
    var MATERIALS = null;

    // the height of the road at a place: the height that the editor saved, or a ray down onto the scene
    var raycaster = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0), origin = new THREE.Vector3();
    function heightAt(gate) {
        if (isFinite(gate.y)) return gate.y;
        origin.set(gate.x, 3000, gate.z);
        raycaster.set(origin, down);
        raycaster.camera = camera;       // sprites (smoke) need it
        var hits = [];
        try { hits = raycaster.intersectObjects(scene.children, true); } catch (e) { /* a thing that cannot be hit */ }
        for (var i = 0; i < hits.length; i++) if (hits[i].object.visible && hits[i].object.name !== "sky" && !hits[i].object.userData.gateMarker) return hits[i].point.y;
        return 0;
    }

    function build(trackArg) {
        clear();
        if (!trackArg || !trackArg.show_gates || !trackArg.gates || !trackArg.gates.length) return;
        MATERIALS = { finish: colour(0xffffff), next: colour(0x35e06f), done: colour(0x4a6a58), other: colour(0xff9a1f) };
        group = new THREE.Group();
        group.name = "gateMarkers";
        trackArg.gates.forEach(function (gate, i) {
            var width = gate.width || 24, y = heightAt(gate);
            var holder = new THREE.Group();
            holder.position.set(gate.x, y, gate.z);
            holder.rotation.y = -gate.heading;      // local +x is the way of the gate; the posts stand across it, along local z
            var material = MATERIALS.other;
            var parts = [];
            [-1, 1].forEach(function (side) {
                var post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, POST, 8), material);
                post.position.set(0, POST / 2, side * width / 2);
                parts.push(post);
            });
            var bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.35, width), material);
            bar.position.set(0, POST, 0);
            parts.push(bar);
            var strip = new THREE.Mesh(new THREE.PlaneGeometry(1.2, width), material.clone());
            strip.rotation.x = -Math.PI / 2;
            strip.position.set(0, 0.12, 0);
            strip.material.opacity = 0.35;
            strip.renderOrder = 2;
            parts.push(strip);
            parts.forEach(function (m) { m.castShadow = false; m.receiveShadow = false; m.userData.gateMarker = true; holder.add(m); });
            holder.userData.parts = parts;
            group.add(holder);
        });
        gates = group.children;
        scene.add(group);
        last = "";
        track = trackArg;
    }

    function clear() {
        if (group) { scene.remove(group); group.traverse(function (o) { if (o.geometry) o.geometry.dispose(); }); }
        group = null; gates = []; last = ""; track = null;
        if (hud) { hud.style.display = "none"; shown = false; }
    }

    // the gate that the player has to pass next: the finish line before the lap has started and after the last gate, else the first gate not passed
    function nextIndex(player) {
        var done = player.checkPointsCompleted;
        if (!player.lapStarted) return 0;
        for (var i = 1; i < done.length; i++) if (!done[i]) return i;
        return 0;
    }

    // ---- the arrow at the top of the screen: where the next gate is, and how far
    var hud = null, arrow = null, label = null, shown = false;
    function makeHud() {
        hud = document.createElement("div");
        hud.style.cssText = "position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 900; pointer-events: none; display: none; align-items: center; gap: 10px; " +
            "padding: 6px 16px 6px 10px; border-radius: 22px; background: rgba(24, 29, 35, 0.8); border: 1px solid var(--line); color: var(--head); " +
            "font: 700 18px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; font-variant-numeric: tabular-nums;";
        arrow = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        arrow.setAttribute("viewBox", "-12 -12 24 24");
        arrow.style.cssText = "width: 30px; height: 30px; transition: transform 0.08s linear;";
        arrow.innerHTML = "<path d=\"M0 -10 L8 8 L0 4 L-8 8 Z\" fill=\"#ff5a1f\" stroke=\"#fff\" stroke-width=\"1.5\" stroke-linejoin=\"round\"/>";
        label = document.createElement("span");
        hud.appendChild(arrow);
        hud.appendChild(label);
        document.body.appendChild(hud);
    }
    function updateHud(player, next) {
        var on = Settings.option("hud") !== false && !(typeof Replay !== "undefined" && document.body.classList.contains("replaying"));
        if (!hud) makeHud();
        if (on !== shown) { hud.style.display = on ? "flex" : "none"; shown = on; }
        if (!on) return;
        var gate = track.gates[next], v = player.vehicle;
        var dx = gate.x - v.px, dz = gate.z - v.pz;
        camera.getWorldDirection(forward);
        var fl = Math.hypot(forward.x, forward.z) || 1, fx = forward.x / fl, fz = forward.z / fl;
        var angle = Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz);
        arrow.style.transform = "rotate(" + angle + "rad)";
        var metres = Math.hypot(dx, dz);
        label.textContent = Settings.option("units") === "imperial" ? Math.round(metres * 3.281) + " ft" : Math.round(metres) + " m";
    }
    var forward = new THREE.Vector3(), track = null;

    // the colours follow the lap of the player: call it every frame, it only works when something changed
    function update(player) {
        if (!group || !player || !player.checkPointsCompleted) return;
        var done = player.checkPointsCompleted, next = nextIndex(player);
        updateHud(player, next);
        var key = done.map(function (d) { return d ? 1 : 0; }).join("") + ":" + next + ":" + (player.lapStarted ? 1 : 0);
        if (key === last) return;
        last = key;
        gates.forEach(function (holder, i) {
            var material = i === next ? MATERIALS.next : (i === 0 ? MATERIALS.finish : (done[i] ? MATERIALS.done : MATERIALS.other));
            holder.userData.parts.forEach(function (m, k) {
                m.material = k === 3 ? material.clone() : material;
                if (k === 3) m.material.opacity = 0.35;
            });
        });
    }

    // ---- the sounds, made here (no files): a rising double beep for the right gate, a low buzz for another one
    var audio = null;
    function tone(frequency, start, length, type, volume, to) {
        var o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + start;
        o.type = type;
        o.frequency.setValueAtTime(frequency, t);
        if (to) o.frequency.linearRampToValueAtTime(to, t + length);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(volume, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + length);
        o.connect(g); g.connect(audio.destination);
        o.start(t); o.stop(t + length + 0.02);
    }
    function sound(good) {
        if (Settings.option("sound") === false) return;
        try {
            var C = window.AudioContext || window.webkitAudioContext;
            if (!audio && C) audio = new C();
            if (!audio) return;
            if (audio.state === "suspended") audio.resume();
            var volume = 0.25 * (Settings.option("volume") === undefined ? 0.8 : Settings.option("volume"));
            if (good) { tone(880, 0, 0.12, "sine", volume); tone(1320, 0.1, 0.2, "sine", volume); }
            else { tone(160, 0, 0.35, "sawtooth", volume * 0.8, 110); }
        } catch (e) { /* no audio */ }
    }

    // the player went through gate `index` (called by Car.js before the lap is counted)
    function passed(player, index) {
        if (!group || index < 0 || !player.checkPointsCompleted) return;
        var next = nextIndex(player);
        if (index === next) sound(true);
        else if (!(index !== 0 && player.checkPointsCompleted[index])) sound(false);   // a gate that was passed already is not a mistake
    }

    return { build: build, clear: clear, update: update, passed: passed };
})();
