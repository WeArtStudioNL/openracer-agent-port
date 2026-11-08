#!/bin/bash
# The physics parity of the Godot version against the browser game: the road test of godot/tools/parity-bench.js (the
# browser's Vehicle.js in node) and of res://tools/test_parity.tscn (Godot), car by car, side by side.
#
#     godot/tools/parity.sh [simple|shell] [car ...]        (default: the simple tyre, every car of web/cars)
#
# The Godot runs keep their settings in a folder of their own (--user-dir), never in the player's.
cd "$(dirname "$0")/../.." || exit 1
GODOT=${GODOT:-/Applications/Godot.app/Contents/MacOS/Godot}
TYRES=${1:-simple}
shift
CARS=("$@")
if [ ${#CARS[@]} -eq 0 ]; then
    CARS=($(ls web/cars | while read -r c; do [ -f "web/cars/$c/car.json" ] && echo "$c"; done))
fi
OUT=${PARITY_OUT:-$(mktemp -d)}
USERDIR="$OUT/user"
mkdir -p "$USERDIR"
SHELLARG=""
[ "$TYRES" = "shell" ] && SHELLARG="--shell"
# (PARALLEL cars at once, 4 by default; WEB_FROM=folder takes the browser's figures of an earlier run: they only change
# with web/)
PARALLEL=${PARALLEL:-4}
n=0
for c in "${CARS[@]}"; do
    if [ -n "$WEB_FROM" ] && [ -s "$WEB_FROM/web-$c.json" ]; then
        cp "$WEB_FROM/web-$c.json" "$OUT/web-$c.json"
    else
        node godot/tools/parity-bench.js "$c" --json $SHELLARG > "$OUT/web-$c.json" &
    fi
    "$GODOT" --headless --path godot res://tools/test_parity.tscn -- --car="$c" --tyres="$TYRES" --user-dir="$USERDIR/$c" \
        --set=tc:true,esc:false,abs:true,tyre_wear:0 2>&1 | grep "^PARITY " | sed 's/^PARITY //' > "$OUT/godot-$c.json" &
    n=$((n + 1))
    [ $((n % PARALLEL)) -eq 0 ] && wait
done
wait
node -e '
const fs = require("fs"), dir = process.argv[1], cars = process.argv.slice(2);
const keys = ["0-50 (s)", "0-100 (s)", "top (km/h)", "brake", "skidpad R40 (g)", "skidpad at (km/h)"];
const fmt = (v, k) => v === null || v === undefined ? "-" : typeof v === "number" ? v.toFixed(k.includes("(g)") ? 2 : 1) : v;
const read = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return {}; } };
console.log("| car | " + keys.map((k) => k + " web / Godot").join(" | ") + " |");
console.log("|---|" + keys.map(() => "---").join("|") + "|");
const shifts = [];
for (const c of cars) {
    const w = read(dir + "/web-" + c + ".json")[c] || {}, g = read(dir + "/godot-" + c + ".json")[c] || {};
    const pick = (o, k) => { const key = Object.keys(o).find((x) => x.startsWith(k)); return key ? [o[key], key] : [null, k]; };
    console.log("| " + c + " | " + keys.map((k) => { const [a, ka] = pick(w, k), [b, kb] = pick(g, k); const pct = typeof a === "number" && typeof b === "number" && a ? " (" + (b >= a ? "+" : "") + Math.round((b / a - 1) * 100) + "%)" : "";
        return fmt(a, ka) + (k === "brake" ? " " + ka.replace("brake ", "").replace(" (m)", "") : "") + " / " + fmt(b, kb) + pct; }).join(" | ") + " |");
    shifts.push(c + "\n  web:   " + (w.shifts || "") + "\n  Godot: " + (g.shifts || ""));
}
console.log("\nShifts (gear, engine speed before the shift, km/h):\n" + shifts.join("\n"));
' "$OUT" "${CARS[@]}"
