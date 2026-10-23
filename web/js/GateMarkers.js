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

    function build(track) {
        clear();
        if (!track || !track.show_gates || !track.gates || !track.gates.length) return;
        MATERIALS = { finish: colour(0xffffff), next: colour(0x35e06f), done: colour(0x4a6a58), other: colour(0xff9a1f) };
        group = new THREE.Group();
        group.name = "gateMarkers";
        track.gates.forEach(function (gate, i) {
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
    }

    function clear() {
        if (group) { scene.remove(group); group.traverse(function (o) { if (o.geometry) o.geometry.dispose(); }); }
        group = null; gates = []; last = "";
    }

    // the colours follow the lap of the player: call it every frame, it only works when something changed
    function update(player) {
        if (!group || !player || !player.checkPointsCompleted) return;
        var done = player.checkPointsCompleted, next = -1;
        for (var i = 1; i < done.length; i++) if (!done[i]) { next = i; break; }
        if (next < 0) next = 0;                         // all passed: the finish line is next
        var key = done.map(function (d) { return d ? 1 : 0; }).join("") + ":" + next + ":" + (player.lapStarted ? 1 : 0);
        if (key === last) return;
        last = key;
        gates.forEach(function (holder, i) {
            var material = i === 0 ? MATERIALS.finish : (i === next ? MATERIALS.next : (done[i] ? MATERIALS.done : MATERIALS.other));
            if (i === 0 && next === 0 && player.lapStarted) material = MATERIALS.next;
            holder.userData.parts.forEach(function (m, k) {
                var opacity = m.material.opacity;
                m.material = k === 3 ? material.clone() : material;
                if (k === 3) m.material.opacity = 0.35;
            });
        });
    }

    return { build: build, clear: clear, update: update };
})();
