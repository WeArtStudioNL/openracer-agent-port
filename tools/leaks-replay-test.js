/*
 * leaks-replay-test.js
 *
 * Runs web/js/Leaks.js with a stand-in for THREE and the road, records the oil drops and the stains as the replay does, and checks that the replay makes them again:
 * no stain before the car leaked, the same stains after, none of the stains of the game that were made later.   node tools/leaks-replay-test.js
 */
var fs = require("fs"), path = require("path"), vm = require("vm");
function Thing() { this.attributes = {}; this.position = {}; this.userData = {}; }
Thing.prototype.setAttribute = function (n, a) { this.attributes[n] = a; };
Thing.prototype.setIndex = function () {};
function Attr(a) { this.array = a; }
function Vec(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; }
Vec.prototype.set = function (x, y, z) { this.x = x; this.y = y; this.z = z; return this; };
Vec.prototype.applyQuaternion = function () { return this; };
Vec.prototype.multiplyScalar = function (k) { this.x *= k; this.y *= k; this.z *= k; return this; };
var THREE = { BufferGeometry: Thing, BufferAttribute: Attr, Sphere: function () {}, Vector3: Vec, Quaternion: function () { this.set = function () {}; },
    ShaderMaterial: function () {}, MeshBasicMaterial: function () {}, Points: function () { this.visible = true; this.userData = {}; }, Mesh: function () { this.userData = {}; }, CanvasTexture: function () {}, DoubleSide: 2 };
var canvas = { getContext: function () { return { createRadialGradient: function () { return { addColorStop: function () {} }; }, beginPath: function () {}, arc: function () {}, fill: function () {} }; } };
var attached = null;
var sandbox = { OpenRacer: { Replay: { attach: function (n, o) { attached = o; } } }, THREE: THREE, document: { createElement: function () { return canvas; } },
    console: console, Math: Math, groundWorld: { query: function (x, z, y) { return { y: 0, nx: 0, ny: 1, nz: 0, surface: "tarmac" }; } } };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "web", "js", "Leaks.js"), "utf8"), sandbox, { filename: "Leaks.js" });
var leaks = new sandbox.OpenRacer.Leaks({ add: function () {} });
var fails = 0;
function check(name, ok, extra) { console.log((ok ? "ok   " : "FAIL ") + name + (extra ? "  " + extra : "")); if (!ok) fails++; }

check("the leaks are attached to the replay", attached === leaks);
var rows = [], time = 0;
leaks.recorder = function (row) { row[0] = time; rows.push(row); return rows.length - 1; };
var v = { px: 0, py: 0.5, pz: 0, vx: 20, vy: 0, vz: 0, qx: 0, qy: 0, qz: 0, qw: 1, engineHealth: { leaking: true, oilFlow: 0, coolFlow: 0, jets: 0, coolant: 1, bx: 0, by: 0, bz: 0, rx: 0, ry: 0, rz: 0 } };
// 5 s sound, then 10 s of oil leak at 20 m/s
function drive(seconds, oil) {
    v.engineHealth.oilFlow = oil;
    for (var t = 0; t < seconds; t += 1 / 60) { time += 1 / 60; v.px += v.vx / 60; leaks.update(1 / 60, v, null, sandbox.groundWorld, null); }
}
drive(5, 0);
check("a car that does not leak makes no rows", rows.length === 0);
drive(10, 0.5);
var drops = rows.filter(function (r) { return r[1] === 1; }).length, stains = rows.filter(function (r) { return r[1] === 2; });
check("the oil drops and the stains are recorded", drops > 50 && stains.length > 20, drops + " drops, " + stains.length + " stains");
check("the game has the stains on the road", leaks.stainCount() === stains.length, leaks.stainCount() + " of " + stains.length);
var gameState = leaks.replaySnapshot();

// the replay at the start: nothing on the road (the game left the whole trail there)
leaks.replayRebuild(rows, rows.length && 0, 0);
check("a replay at the start has no stain", leaks.stainCount() === 0, "" + leaks.stainCount());
// at 8 s (3 s after the leak began): only the stains made by then
function upTo(t) { var n = 0; while (n < rows.length && rows[n][0] <= t) n++; return n; }
var end8 = upTo(8), want8 = rows.slice(0, end8).filter(function (r) { return r[1] === 2; }).length;
leaks.replayRebuild(rows, end8, 8);
check("a replay at 8 s has the stains made by then", leaks.stainCount() === want8 && want8 > 0 && want8 < stains.length, leaks.stainCount() + " of " + want8);
// stepping on from 8 s to 12 s with the rows gives the same as a rebuild at 12 s
var end12 = upTo(12), want12 = rows.slice(0, end12).filter(function (r) { return r[1] === 2; }).length;
var cursor = end8;
for (var t = 8; t < 12 - 1e-9; t += 1 / 30) {
    while (cursor < end12 && rows[cursor][0] <= t + 1 / 30) leaks.replayAdd(rows[cursor++]);
    leaks.replayStep(1 / 30);
}
check("playing on makes the stains of the rows", leaks.stainCount() === want12, leaks.stainCount() + " of " + want12);
leaks.replayRebuild(rows, end12, 12);
check("a jump gives the same stains as playing", leaks.stainCount() === want12, leaks.stainCount() + " of " + want12);
// the end: the game as it was
leaks.replayRestore(gameState);
check("the replay puts the game back", leaks.stainCount() === stains.length, "" + leaks.stainCount());
console.log(fails ? fails + " failed" : "all ok");
process.exit(fails ? 1 : 0);
