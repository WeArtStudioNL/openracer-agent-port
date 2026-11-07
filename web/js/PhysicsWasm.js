/*
 * PhysicsWasm.js
 *
 * Description: The physics in WebAssembly (MACOS-METAL.md, phase M3). For now one part: the substeps of the shell tyre (TyreShell.js), which is most of the
 *              time of a step of a car (PHYSICS-WORKER.md). The C is in wasm/tyre_shell.c, built by wasm/build.sh into js/wasm/tyre_shell.wasm.
 *
 *              The arrays of a tyre are made on the memory of the module (alloc), so TyreShell.js and the WebAssembly use the same numbers and nothing is
 *              copied for a step. The memory can grow; the typed arrays on the old buffer are then dead, so a user of alloc keeps the generation it made its
 *              arrays at and makes them again when it changed (TyreShell.js does that at the start of a step).
 *
 *              The address says what is used: ?wasm=0 the JavaScript (as before), ?wasm=1 the WebAssembly, ?wasm=verify both: every step of a tyre is done by
 *              the WebAssembly and then again by the JavaScript from the same state, and the results are compared to the bit (the counts are in
 *              OpenRacer.PhysicsWasm.stats). Without it in the address the default below holds.
 *
 *              sin, cos and exp are those of JavaScript (Math.*): with its own libm the WebAssembly would differ in the last bit.
 */

OpenRacer.PhysicsWasm = (function () {
    var DEFAULT = "1";                       // what the game uses without ?wasm= in the address (checked to the bit in races on 4 tracks, 7 November 2026)
    var mode = DEFAULT;
    try { var q = new URLSearchParams(self.location.search).get("wasm"); if (q === "0" || q === "1" || q === "verify") mode = q; } catch (e) { /* no address (a worker) */ }

    var instance = null, memory = null, generation = 0, top = 0, free = {}, failed = null;
    var stats = { steps: 0, verified: 0, mismatches: 0, firstMismatch: null };

    function load(base) {
        if (mode === "0" || typeof WebAssembly === "undefined") return Promise.resolve(false);
        var imports = { env: { sin: Math.sin, cos: Math.cos, exp: Math.exp } };
        var url = (base || "js/") + "wasm/tyre_shell.wasm";
        return fetch(url).then(function (r) { if (!r.ok) throw new Error(url + ": HTTP " + r.status); return r.arrayBuffer(); })
            .then(function (bytes) { return WebAssembly.instantiate(bytes, imports); })
            .then(function (result) {
                instance = result.instance; memory = instance.exports.memory;
                top = (instance.exports.heap_base() + 15) & ~15;
                generation++;
                return true;
            }).catch(function (error) { failed = error; console.warn("PhysicsWasm: the WebAssembly of the physics did not load, the JavaScript is used (" + error.message + ")"); return false; });
    }

    // a block of bytes (16 aligned) in the memory of the module; a freed block of the same size is used again
    function alloc(bytes) {
        bytes = (bytes + 15) & ~15;
        var list = free[bytes];
        if (list && list.length) return list.pop();
        var at = top;
        top += bytes;
        if (top > memory.buffer.byteLength) {
            memory.grow(Math.ceil((top - memory.buffer.byteLength) / 65536) + 64);       // (and some room, so it does not grow at every tyre)
            generation++;
        }
        return at;
    }
    function release(at, bytes) {
        bytes = (bytes + 15) & ~15;
        (free[bytes] = free[bytes] || []).push(at);
    }

    // the triangles of a ground (Ground.js boxes and triangleData) in the memory: copied when the arrays of the ground are new or have grown
    var ground = { box: null, tri: null, boxAt: 0, triAt: 0, boxBytes: 0, triBytes: 0 };
    function groundIn(box, tri) {
        // (a grown memory keeps its contents and its addresses: only new arrays of the ground are copied)
        if (box === ground.box && tri === ground.tri) return ground;
        if (ground.boxBytes) { release(ground.boxAt, ground.boxBytes); release(ground.triAt, ground.triBytes); }
        ground.boxBytes = box.byteLength; ground.triBytes = tri.byteLength;
        ground.boxAt = alloc(box.byteLength); ground.triAt = alloc(tri.byteLength);
        new Float32Array(memory.buffer, ground.boxAt, box.length).set(box);
        new Float32Array(memory.buffer, ground.triAt, tri.length).set(tri);
        ground.box = box; ground.tri = tri;
        return ground;
    }

    return {
        load: load,
        ready: function () { return !!instance; },
        mode: function () { return mode; },
        verify: function () { return mode === "verify"; },
        failed: function () { return failed; },
        generation: function () { return generation; },
        buffer: function () { return memory.buffer; },
        alloc: alloc,
        release: release,
        groundIn: groundIn,
        tyreSubsteps: function (pAt, aAt) { instance.exports.tyre_substeps(pAt, aAt); },
        stats: stats
    };
})();

// the game loads it at once (the cars are made after the track, by then it is there); the editors and the worker do not, and keep the JavaScript
if (typeof document !== "undefined") OpenRacer.PhysicsWasm.load("js/");
