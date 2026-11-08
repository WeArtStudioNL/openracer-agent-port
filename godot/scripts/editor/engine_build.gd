class_name EngineBuild
extends RefCounted
## An engine as it is built, and the torque curve that a dyno measures on it (web/js/EngineBuild.js). The build (car.json
## "engine.build") is the block (cylinders, bore, stroke, compression), the cam, the inlet and the exhaust, the fuel and the
## mixture, and forced induction (a turbo or a supercharger); the curve is worked out from it and is not typed in.
## The engine blocks are the presets of the engine sound (EngineSim.js engineSimPresets), here in PRESETS.

const CYLINDERS := {"single": 1, "inline-2": 2, "inline-3": 3, "inline-4": 4, "inline-5": 5, "inline-6": 6, "v6": 6, "v8-crossplane": 8,
	"v8-flatplane": 8, "v10": 10, "v12": 12, "flat-4": 4, "flat-6": 6}
const T0 := 293.15
const FUELS := {
	"pump95": {"label": "Pump fuel (95)", "knock": 11.0, "energy": 1.0, "volume": 1.0},
	"pump98": {"label": "Pump fuel (98)", "knock": 12.0, "energy": 1.005, "volume": 1.0},
	"e85": {"label": "E85", "knock": 15.5, "energy": 1.03, "volume": 1.35},
	"race": {"label": "Race fuel (100+)", "knock": 13.0, "energy": 1.01, "volume": 1.02},
}
const INTERCOOLERS := {"none": {"label": "None", "value": 0.0}, "air": {"label": "Air to air", "value": 0.65}, "water": {"label": "Air to water", "value": 0.8}}
const TURBO_SIZES := {"small": {"label": "Small (to ~300 hp)", "spool": 2400.0, "flow": 0.30}, "medium": {"label": "Medium (to ~500 hp)", "spool": 3200.0, "flow": 0.50},
	"large": {"label": "Large (to ~800 hp)", "spool": 4200.0, "flow": 0.80}}
const TURBO_VARIANTS := {
	"single": {"label": "Single", "spool": 1.0, "flow": 1.0, "lag": 1.0},
	"twinscroll": {"label": "Twin-scroll", "spool": 0.88, "flow": 1.0, "lag": 0.85},
	"twin": {"label": "Twin (two small ones)", "spool": 0.9, "flow": 1.7, "lag": 0.9},
	"vgt": {"label": "Variable geometry", "spool": 0.7, "flow": 0.9, "lag": 0.7},
}
const SUPERCHARGERS := {
	"roots": {"label": "Roots", "eff": 0.6, "effDrop": 0.07},
	"screw": {"label": "Twin-screw", "eff": 0.7, "effDrop": 0.04},
	"centrifugal": {"label": "Centrifugal", "eff": 0.74, "effDrop": 0.02},
}
const BOOST_CAP := {"turbo": 3.0, "roots": 1.0, "screw": 1.5, "centrifugal": 1.5}
## The exhausts of the engine sound (EngineSim.js engineSimExhausts): the label and what it sounds like.
const EXHAUST_LABELS := [["standard", "Standard", "stock muffler: dark, quiet, boomy"], ["sport", "Sport", "resonator: fuller, more mid range"],
	["performance", "Performance", "free-flowing cat-back: louder, edgier"], ["straight", "Straight cut", "no muffler: raw and raspy"],
	["open", "Open headers", "race: loud and cracking"], ["quiet", "Quiet", "touring: muffled and soft"]]

## The engine blocks (EngineSim.js engineSimPresets): the sound of the block, and the build is made from it.
const PRESETS := {
	"Single 0.25 L (kart)": {"layout": "single", "bore": 70, "stroke": 65, "rod": 105, "compression_ratio": 9.0, "intake_duration": 232, "exhaust_duration": 226,
		"intake_lift": 8.0, "exhaust_lift": 7.5, "intake_lobe_centre": 108, "exhaust_lobe_centre": 108, "intake_flow": 110, "exhaust_flow": 90,
		"primary_length": 0.25, "primary_flow": 90, "exhaust_length": 0.9, "outlet_flow": 160, "exhaust_systems": 1, "impulse_response": "minimal_muffling_03"},
	"Single 0.4 L": {"layout": "single", "bore": 88, "stroke": 64, "rod": 110, "compression_ratio": 8.5, "intake_duration": 220, "exhaust_duration": 216,
		"intake_lift": 8.5, "exhaust_lift": 8.0, "intake_lobe_centre": 110, "exhaust_lobe_centre": 110, "intake_flow": 130, "exhaust_flow": 105,
		"primary_length": 0.3, "primary_flow": 100, "exhaust_length": 1.2, "outlet_flow": 200, "exhaust_systems": 1, "impulse_response": "minimal_muffling_02"},
	"Twin 0.8 L (parallel)": {"layout": "inline-2", "bore": 80, "stroke": 80, "rod": 130, "compression_ratio": 10.0, "intake_duration": 228, "exhaust_duration": 224,
		"intake_lift": 9.0, "exhaust_lift": 8.5, "intake_lobe_centre": 110, "exhaust_lobe_centre": 110, "intake_flow": 170, "exhaust_flow": 140,
		"primary_length": 0.35, "primary_flow": 140, "exhaust_length": 1.8, "outlet_flow": 300, "exhaust_systems": 1, "impulse_response": "minimal_muffling_02"},
	"Inline-3 1.0 L": {"layout": "inline-3", "bore": 74, "stroke": 77.1, "rod": 130, "compression_ratio": 10.5, "intake_duration": 230, "exhaust_duration": 226,
		"intake_lift": 9.2, "exhaust_lift": 8.8, "intake_lobe_centre": 110, "exhaust_lobe_centre": 110, "intake_flow": 200, "exhaust_flow": 160,
		"primary_length": 0.4, "primary_flow": 160, "exhaust_length": 2.0, "outlet_flow": 380, "exhaust_systems": 1, "impulse_response": "minimal_muffling_01"},
	"Single 0.65 L (thumper)": {"layout": "single", "bore": 100, "stroke": 82.6, "rod": 130, "compression_ratio": 10.0, "intake_duration": 236,
		"exhaust_duration": 232, "intake_lift": 9.5, "exhaust_lift": 9.0, "intake_lobe_centre": 108, "exhaust_lobe_centre": 108, "intake_flow": 160,
		"exhaust_flow": 130, "primary_length": 0.4, "primary_flow": 130, "exhaust_length": 1.1, "outlet_flow": 260, "exhaust_systems": 1, "impulse_response": "mild_exhaust"},
	"Inline-3 0.8 L (triple)": {"layout": "inline-3", "bore": 78, "stroke": 56, "rod": 108, "compression_ratio": 12.0, "intake_duration": 250, "exhaust_duration": 246,
		"intake_lift": 9.5, "exhaust_lift": 8.8, "intake_lobe_centre": 108, "exhaust_lobe_centre": 108, "intake_flow": 120, "exhaust_flow": 100,
		"primary_length": 0.3, "primary_flow": 100, "exhaust_length": 1.0, "outlet_flow": 300, "exhaust_systems": 1, "impulse_response": "sharp_01"},
	"Inline-4 0.6 L (supersport)": {"layout": "inline-4", "bore": 67, "stroke": 42.5, "rod": 100, "compression_ratio": 12.2, "intake_duration": 256,
		"exhaust_duration": 250, "intake_lift": 9.0, "exhaust_lift": 8.2, "intake_lobe_centre": 106, "exhaust_lobe_centre": 106, "intake_flow": 105,
		"exhaust_flow": 85, "primary_length": 0.3, "primary_flow": 90, "exhaust_length": 1.0, "outlet_flow": 300, "exhaust_systems": 1, "impulse_response": "sharp_01",
		"timing": [[0, 10], [2000, 14], [6000, 28], [10000, 36], [14000, 40], [17000, 40]], "input_cutoff": 3500, "noise_cutoff": 3500},
	"Inline-4 1.0 L (superbike)": {"layout": "inline-4", "bore": 76, "stroke": 55, "rod": 104, "compression_ratio": 13.0, "intake_duration": 254,
		"exhaust_duration": 248, "intake_lift": 10.0, "exhaust_lift": 9.0, "intake_lobe_centre": 106, "exhaust_lobe_centre": 106, "intake_flow": 140,
		"exhaust_flow": 115, "primary_length": 0.32, "primary_flow": 110, "exhaust_length": 1.1, "outlet_flow": 380, "exhaust_systems": 1, "impulse_response": "sharp_01",
		"timing": [[0, 10], [2000, 14], [6000, 28], [10000, 36], [14000, 40], [16000, 40]], "input_cutoff": 3000, "noise_cutoff": 3000},
	"Inline-4 2.0 L": {"layout": "inline-4", "bore": 86, "stroke": 86, "rod": 143, "compression_ratio": 10.5, "intake_duration": 228, "exhaust_duration": 228,
		"intake_lift": 9.5, "exhaust_lift": 9.0, "intake_lobe_centre": 110, "exhaust_lobe_centre": 110, "intake_flow": 230, "exhaust_flow": 180,
		"primary_length": 0.45, "primary_flow": 180, "exhaust_length": 2.4, "outlet_flow": 450, "exhaust_systems": 1, "impulse_response": "minimal_muffling_02"},
	"Inline-5 2.2 L": {"layout": "inline-5", "bore": 81, "stroke": 86.4, "rod": 144, "compression_ratio": 9.3, "intake_duration": 232, "exhaust_duration": 232,
		"intake_lift": 10, "exhaust_lift": 10, "intake_lobe_centre": 110, "exhaust_lobe_centre": 110, "intake_flow": 220, "exhaust_flow": 170,
		"primary_length": 0.4, "primary_flow": 180, "exhaust_length": 2.6, "outlet_flow": 500, "exhaust_systems": 2, "impulse_response": "smooth_39"},
	"Inline-6 3.0 L": {"layout": "inline-6", "bore": 84, "stroke": 89.6, "rod": 135, "compression_ratio": 10.2, "intake_duration": 236, "exhaust_duration": 232,
		"intake_lift": 9.7, "exhaust_lift": 9.5, "intake_lobe_centre": 112, "exhaust_lobe_centre": 110, "intake_flow": 240, "exhaust_flow": 190,
		"primary_length": 0.5, "primary_flow": 200, "exhaust_length": 2.8, "outlet_flow": 550, "exhaust_systems": 2, "impulse_response": "minimal_muffling_01"},
	"V6 3.5 L": {"layout": "v6", "bore": 94, "stroke": 83, "rod": 150, "compression_ratio": 10.8, "intake_duration": 236, "exhaust_duration": 232,
		"intake_lift": 10, "exhaust_lift": 9.5, "intake_lobe_centre": 112, "exhaust_lobe_centre": 110, "intake_flow": 260, "exhaust_flow": 200,
		"primary_length": 0.4, "primary_flow": 220, "exhaust_length": 2.6, "outlet_flow": 600, "exhaust_systems": 2, "impulse_response": "smooth_39"},
	"V8 5.7 L crossplane": {"layout": "v8-crossplane", "bore": 101.6, "stroke": 88.4, "rod": 146, "compression_ratio": 9.5, "intake_duration": 232,
		"exhaust_duration": 232, "intake_lift": 12, "exhaust_lift": 12, "intake_lobe_centre": 110, "exhaust_lobe_centre": 110, "intake_flow": 260,
		"exhaust_flow": 210, "primary_length": 0.5, "primary_flow": 220, "exhaust_length": 2.8, "outlet_flow": 650, "exhaust_systems": 2, "impulse_response": "smooth_39"},
	"V8 4.5 L flatplane": {"layout": "v8-flatplane", "bore": 94, "stroke": 81, "rod": 140, "compression_ratio": 12.5, "intake_duration": 250, "exhaust_duration": 246,
		"intake_lift": 11, "exhaust_lift": 10.5, "intake_lobe_centre": 108, "exhaust_lobe_centre": 108, "intake_flow": 280, "exhaust_flow": 230,
		"primary_length": 0.45, "primary_flow": 260, "exhaust_length": 2.2, "outlet_flow": 800, "exhaust_systems": 2, "impulse_response": "sharp_01"},
	"V10 5.2 L": {"layout": "v10", "bore": 84.5, "stroke": 92.8, "rod": 154, "compression_ratio": 12.5, "intake_duration": 248, "exhaust_duration": 244,
		"intake_lift": 11, "exhaust_lift": 10.5, "intake_lobe_centre": 110, "exhaust_lobe_centre": 108, "intake_flow": 260, "exhaust_flow": 210,
		"primary_length": 0.45, "primary_flow": 240, "exhaust_length": 2.4, "outlet_flow": 800, "exhaust_systems": 2, "impulse_response": "minimal_muffling_03"},
	"V12 6.0 L": {"layout": "v12", "bore": 89, "stroke": 80, "rod": 138, "compression_ratio": 11.5, "intake_duration": 244, "exhaust_duration": 240,
		"intake_lift": 10.5, "exhaust_lift": 10, "intake_lobe_centre": 110, "exhaust_lobe_centre": 108, "intake_flow": 250, "exhaust_flow": 200,
		"primary_length": 0.4, "primary_flow": 220, "exhaust_length": 2.6, "outlet_flow": 800, "exhaust_systems": 2, "impulse_response": "smooth_39"},
	"Flat-4 2.5 L": {"layout": "flat-4", "bore": 99.5, "stroke": 79, "rod": 130.6, "compression_ratio": 10, "intake_duration": 232, "exhaust_duration": 236,
		"intake_lift": 9.8, "exhaust_lift": 9.6, "intake_lobe_centre": 117, "exhaust_lobe_centre": 112, "intake_flow": 280, "exhaust_flow": 245,
		"primary_length": 1.0, "primary_flow": 400, "exhaust_length": 2.0, "outlet_flow": 1000, "exhaust_systems": 2, "impulse_response": "minimal_muffling_02"},
	"Flat-6 3.8 L": {"layout": "flat-6", "bore": 102, "stroke": 77.5, "rod": 128, "compression_ratio": 12.5, "intake_duration": 246, "exhaust_duration": 242,
		"intake_lift": 11, "exhaust_lift": 10.5, "intake_lobe_centre": 110, "exhaust_lobe_centre": 108, "intake_flow": 290, "exhaust_flow": 240,
		"primary_length": 0.6, "primary_flow": 260, "exhaust_length": 2.2, "outlet_flow": 800, "exhaust_systems": 2, "impulse_response": "sharp_01"},
}
const _TWO_VALVES := ["Single 0.25 L (kart)", "Single 0.4 L", "Twin 0.8 L (parallel)", "Single 0.65 L (thumper)", "V8 5.7 L crossplane", "Flat-4 2.5 L"]


static func _f(d: Dictionary, key: String, fallback: float) -> float:
	var v: Variant = d.get(key)
	return float(v) if (v is float or v is int) else fallback


static func _smooth(x: float) -> float:
	x = clampf(x, 0.0, 1.0)
	return x * x * (3.0 - 2.0 * x)


static func cylinders(b: Dictionary) -> int:
	if b.get("cylinders") is float or b.get("cylinders") is int:
		return int(b["cylinders"])
	return int(CYLINDERS.get(str(b.get("layout", "")), 4))


## The displacement in litres.
static func displacement(b: Dictionary) -> float:
	return PI / 4.0 * pow(_f(b, "bore", 86.0) / 1000.0, 2.0) * (_f(b, "stroke", 86.0) / 1000.0) * cylinders(b) * 1000.0


## About what an engine weighs (kg), from its size and its cylinders (EngineBuild.js mass): a kart single about 28, a
## 2.0 four about 100, a 5.7 V8 about 240. For a swap the difference goes to the mass of the car (the tuning menu).
static func mass(b: Dictionary) -> float:
	return 15.0 + 32.0 * displacement(_sized(b)) + 5.0 * cylinders(b)


static func air_density(altitude: float, celsius: float) -> float:
	var p := 101.325 * pow(1.0 - 2.25577e-5 * altitude, 5.25588)
	return (p / 101.325) * (T0 / (273.15 + celsius))


## The correction factor of DIN 70020 (a dyno in other air than the standard one).
static func correction(altitude: float, celsius: float) -> float:
	var p := 101.325 * pow(1.0 - 2.25577e-5 * altitude, 5.25588)
	return (101.325 / p) * sqrt((273.15 + celsius) / 293.15)


static func _sized(b: Dictionary) -> Dictionary:
	var out := b.duplicate(true)
	if not (_f(b, "bore", 0.0) > 0.0):
		out["bore"] = 86.0
	if not (_f(b, "stroke", 0.0) > 0.0):
		out["stroke"] = 86.0
	return out


static func _prepare(b: Dictionary) -> Dictionary:
	var n := cylinders(b)
	var vd_l := displacement(b)
	var vcyl := vd_l * 1000.0 / n
	var duration := clampf(_f(b, "cam_duration", 230.0), 190.0, 290.0)
	var valves := int(_f(b, "valves", 4.0))
	var adequacy := clampf((_f(b, "intake_flow", 200.0) / vcyl) / 0.42, 0.6, 1.6)
	var ve_base := 0.82 + (0.08 if valves >= 5 else 0.07 if valves == 4 else 0.04 if valves == 3 else 0.0)
	var exhaust_ratio := _f(b, "exhaust_flow", 160.0) / _f(b, "intake_flow", 200.0)
	var ve_peak := ve_base - 0.1 * maxf(0.0, 0.8 - exhaust_ratio) / 0.8
	var ps_torque := minf(15.5, 9.0 + (duration - 210.0) * 0.2)
	var stroke := _f(b, "stroke", 86.0)
	var rpm_torque := ps_torque * 30000.0 / stroke * pow(0.4 / _f(b, "primary_length", 0.4), 0.15)
	var cr := _f(b, "compression", 10.0)
	return {
		"n": n, "vdL": vd_l, "vdM3": vd_l / 1000.0, "duration": duration, "valves": valves, "vePeak": ve_peak, "rpmTorque": rpm_torque,
		"low": clampf(0.35 + (duration - 210.0) * 0.012, 0.3, 1.2), "high": 0.75 / adequacy,
		"fuel": FUELS.get(str(b.get("fuel", "pump95")), FUELS["pump95"]), "lambda": clampf(_f(b, "lambda", 0.9), 0.75, 1.15),
		"cr": cr, "stroke": stroke, "etaCr": (1.0 - pow(cr, -0.33)) / 0.539, "rpmPower": rpm_torque * 1.3,
	}


static func _boost_at(b: Dictionary, p: Dictionary, rpm: float, limiter: float) -> float:
	var ind: Dictionary = b.get("induction", {}) if b.get("induction") is Dictionary else {}
	var want := _f(ind, "boost", 0.0)
	if ind.is_empty() or str(ind.get("type", "none")) == "none" or not (want > 0.0):
		return 0.0
	var boost := 0.0
	if ind["type"] == "turbo":
		var size: Dictionary = TURBO_SIZES.get(str(ind.get("size", "medium")), TURBO_SIZES["medium"])
		var variant: Dictionary = TURBO_VARIANTS.get(str(ind.get("variant", "single")), TURBO_VARIANTS["single"])
		var threshold: float = size["spool"] * variant["spool"] * clampf(pow(2.0 / maxf(0.3, p["vdL"]), 0.25), 0.7, 1.4)
		boost = want * _smooth((rpm - threshold) / (threshold * 0.6 + 400.0))
		var pr := 1.0 + boost / 1.013
		var mass: float = 1.2 * p["vdM3"] * rpm / 120.0 * p["vePeak"] * pr
		var cap: float = size["flow"] * variant["flow"]
		if mass > cap:
			boost *= maxf(0.1, pow(cap / mass, 1.2))
	elif ind["type"] == "supercharger":
		var lim := limiter if limiter > 0.0 else 7000.0
		if ind.get("variant") == "centrifugal":
			boost = want * pow(clampf(rpm / lim, 0.0, 1.2), 2.0)
		else:
			boost = want * _smooth(rpm / 1200.0) * (1.0 - 0.1 * clampf(rpm / lim, 0.0, 1.0))
	return minf(boost, want * 1.05)


static func _compressor_eff(b: Dictionary, rpm: float) -> float:
	var ind: Dictionary = b.get("induction", {})
	if ind.get("type") == "supercharger":
		var s: Dictionary = SUPERCHARGERS.get(str(ind.get("variant", "screw")), SUPERCHARGERS["screw"])
		return maxf(0.4, float(s["eff"]) - float(s["effDrop"]) * rpm / 6000.0)
	return 0.72


## What the engine gives at one rpm: { nm, boost (bar), knock (lost share of torque), power (hp) }.
static func at(b: Dictionary, p: Dictionary, rpm: float, limiter: float) -> Dictionary:
	var rho := 1.0
	var r: float = rpm / float(p["rpmTorque"])
	var shape := maxf(0.25, 1.0 - float(p["low"]) * (1.0 - r) * (1.0 - r)) if r < 1.0 else maxf(0.05, 1.0 - float(p["high"]) * pow(r - 1.0, 1.4))
	var ve: float = float(p["vePeak"]) * shape
	var boost := _boost_at(b, p, rpm, limiter)
	var ind: Dictionary = b.get("induction", {"type": "none"})
	var pr := 1.0 + boost / 1.013
	var density := 1.0
	var parasitic := 0.0
	var t_charge := 1.0
	if boost > 0.0:
		var eff := _compressor_eff(b, rpm)
		var ic: float = INTERCOOLERS[ind["intercooler"]]["value"] if INTERCOOLERS.has(str(ind.get("intercooler", ""))) else 0.65
		var out := T0 * (1.0 + (pow(pr, 0.286) - 1.0) / eff)
		var manifold := out - ic * (out - T0)
		density = pr * T0 / manifold
		t_charge = manifold / T0
		if ind.get("type") == "turbo":
			density *= 1.0 - 0.035 * boost
		else:
			var mass: float = 1.2 * rho * float(p["vdM3"]) * rpm / 120.0 * ve * pr
			parasitic = mass * 1005.0 * T0 * (pow(pr, 0.286) - 1.0) / eff / 0.95 / maxf(1.0, rpm * PI / 30.0)
	var fuel: Dictionary = p["fuel"]
	var lambda: float = p["lambda"]
	var knock_limit: float = float(fuel["knock"]) + maxf(0.0, 1.0 - lambda) * 8.0
	var knock_index: float = float(p["cr"]) * pow(pr, 0.4) * pow(t_charge, 0.8)
	var knock := clampf(0.06 * (knock_index - knock_limit), 0.0, 0.4)
	var mix := 1.0 - 2.2 * pow(lambda - 0.88, 2.0)
	var imep: float = 15.8 * ve * rho * density * float(p["etaCr"]) * float(fuel["energy"]) * mix * (1.0 - knock)
	var sp: float = 2.0 * float(p["stroke"]) * rpm / 60000.0
	var fmep := 0.4 + 0.004 * (45.0 + 12.0 * density * rho) + 0.09 * sp + 0.0009 * sp * sp + (0.06 if int(p["valves"]) >= 4 else 0.0)
	var nm: float = (imep - fmep) * 1e5 * float(p["vdM3"]) / (4.0 * PI) - parasitic
	nm *= clampf(rpm / maxf(600.0, _f(b, "idle", 850.0) * 1.1), 0.0, 1.0)
	nm = maxf(0.0, nm)
	return {"nm": nm, "boost": boost, "knock": knock, "power": nm * rpm * PI / 30.0 / 745.7}


## The torque curve of a build up to the rev limit (the standard air), the boost at every point, and what it gives.
static func compute(build: Dictionary, limiter: float, idle: float) -> Dictionary:
	var b := _sized(build)
	b["idle"] = idle
	var p := _prepare(b)
	var curve := [[0.0, 0.0]]
	var boost := [[0.0, 0.0]]
	var top := 0.0
	var peak_power := 0.0
	var peak_rpm := 0.0
	var top_nm := 0.0
	var end := maxf(1000.0, limiter) + 600.0
	var rpm := 500.0
	while rpm <= end:
		var v := at(b, p, rpm, limiter)
		var nm := roundf(float(v["nm"]) * 10.0) / 10.0
		curve.append([rpm, nm])
		boost.append([rpm, roundf(float(v["boost"]) * 100.0) / 100.0])
		if rpm <= limiter:
			if float(v["power"]) > peak_power:
				peak_power = v["power"]
				peak_rpm = rpm
			top_nm = maxf(top_nm, nm)
			top = maxf(top, v["boost"])
		rpm += 500.0
	var na := b.duplicate(true)
	na["induction"] = {"type": "none"}
	var na_p := _prepare(na)
	var na_peak := 0.0
	var knock_lost := 0.0
	var r2 := 1000.0
	while r2 <= limiter:
		na_peak = maxf(na_peak, at(na, na_p, r2, limiter)["nm"])
		knock_lost = maxf(knock_lost, at(b, p, r2, limiter)["knock"])
		r2 += 500.0
	return {
		"curve": curve, "boost": boost, "peakPower": peak_power, "peakPowerRpm": peak_rpm, "peakTorque": top_nm, "maxBoost": top,
		"boostShare": clampf(1.0 - na_peak / top_nm, 0.0, 0.9) if top_nm > 0.0 else 0.0,
		"displacement": p["vdL"], "cylinders": p["n"], "pistonSpeedAtLimit": 2.0 * float(b["stroke"]) * limiter / 60000.0, "knock": knock_lost,
		"suggestedLimiter": roundf(minf(float(p["rpmPower"]) * 1.12, 25.0 * 30000.0 / float(b["stroke"])) / 100.0) * 100.0,
	}


## A block from a preset of the engine sound.
static func from_preset(block_name: String) -> Dictionary:
	var preset: Dictionary = PRESETS.get(block_name, PRESETS["V8 5.7 L crossplane"])
	var cr := float(preset["compression_ratio"])
	return {
		"block": block_name, "layout": preset["layout"], "bore": float(preset["bore"]), "stroke": float(preset["stroke"]), "rod": float(preset["rod"]),
		"compression": cr, "cam_duration": float(preset["intake_duration"]), "valves": 2 if block_name in _TWO_VALVES else 4,
		"intake_flow": float(preset["intake_flow"]), "exhaust_flow": float(preset["exhaust_flow"]),
		"primary_length": float(preset["primary_length"]), "exhaust_length": float(preset["exhaust_length"]),
		"fuel": "pump98" if cr >= 12.0 else "pump95", "lambda": 0.9,
		"induction": {"type": "none", "variant": "single", "size": "medium", "boost": 0.6, "intercooler": "air"},
		"ambient": {"celsius": 20, "altitude": 0},
	}


## What the turbo does to the engine of the game: the threshold rpm and the spool time; {} without a turbo.
static func turbo_spec(b: Dictionary) -> Dictionary:
	var ind: Dictionary = b.get("induction", {}) if b.get("induction") is Dictionary else {}
	if ind.get("type") != "turbo":
		return {}
	var size: Dictionary = TURBO_SIZES.get(str(ind.get("size", "medium")), TURBO_SIZES["medium"])
	var variant: Dictionary = TURBO_VARIANTS.get(str(ind.get("variant", "single")), TURBO_VARIANTS["single"])
	var lag: float = {"small": 0.5, "medium": 0.8, "large": 1.2}.get(str(ind.get("size", "medium")), 0.8)
	return {"threshold": roundf(float(size["spool"]) * float(variant["spool"]) * clampf(pow(2.0 / maxf(0.3, displacement(b)), 0.25), 0.7, 1.4) / 100.0) * 100.0,
		"spool": roundf(lag * float(variant["lag"]) * 20.0) / 20.0}


static func _charge_factor(b: Dictionary, boost: float) -> float:
	var ind: Dictionary = b.get("induction", {})
	if not (boost > 0.0) or str(ind.get("type", "none")) == "none":
		return 1.0
	var pr := 1.0 + boost / 1.013
	var eff := _compressor_eff(b, 5000.0)
	var ic: float = INTERCOOLERS[ind["intercooler"]]["value"] if INTERCOOLERS.has(str(ind.get("intercooler", ""))) else 0.65
	var out := T0 * (1.0 + (pow(pr, 0.286) - 1.0) / eff)
	var manifold := out - ic * (out - T0)
	return pow(pr, 0.4) * pow(manifold / T0, 0.8)


static func _round(x: float, step: float) -> float:
	return roundf(x / step) * step


## How far each setting can go with the others as they are: key -> [min, max, why]; and the valves, turbo sizes and variants.
static func limits(build: Dictionary, limiter: float, idle: float) -> Dictionary:
	var b := _sized(build)
	var bore: float = b["bore"]
	var stroke: float = b["stroke"]
	var valves := int(_f(b, "valves", 4.0))
	var vd_l := displacement(b)
	var ind: Dictionary = b.get("induction", {"type": "none"})
	var kind := str(ind.get("type", "none"))
	var fuel: Dictionary = FUELS.get(str(b.get("fuel", "pump95")), FUELS["pump95"])
	var ki_max: float = float(fuel["knock"]) + maxf(0.0, 1.0 - _f(b, "lambda", 0.9)) * 8.0 + 3.0
	var intake_max := 0.036 * bore * bore * (0.85 + 0.075 * valves)
	var intake_min := 0.012 * bore * bore
	var stroke_max := minf(130.0, minf(bore * 1.5, 28.0 * 30000.0 / maxf(2000.0, limiter)))
	var stroke_min := maxf(30.0, bore * 0.45)
	var cr_max := minf(16.0, ki_max)
	var cap := 3.0
	if kind != "none":
		cap = BOOST_CAP["turbo"] if kind == "turbo" else float(BOOST_CAP.get(str(ind.get("variant", "")), 1.5))
		cr_max = minf(16.0, ki_max / _charge_factor(b, _f(ind, "boost", 0.0)))
	var boost_max := cap
	var x := 0.1
	while x <= cap + 1e-9:
		var trial := b.duplicate(true)
		var ti: Dictionary = ind.duplicate()
		ti["boost"] = x
		trial["induction"] = ti
		if _f(b, "compression", 10.0) * _charge_factor(trial, x) > ki_max:
			boost_max = maxf(0.1, x - 0.05)
			break
		x += 0.05
	var cam_max := 290.0 if valves >= 4 else 265.0 if valves == 3 else 250.0
	var intake := _f(b, "intake_flow", 200.0)
	var valve_list := []
	for v in [2, 3, 4, 5]:
		if bore >= (65.0 if v == 5 else 50.0 if v == 4 else 55.0 if v == 3 else 0.0):
			valve_list.append(v)
	var sizes := []
	for z in ["small", "medium", "large"]:
		if vd_l >= (1.5 if z == "large" else 0.6 if z == "medium" else 0.0):
			sizes.append(z)
	var variants := []
	for v in TURBO_VARIANTS:
		if v != "twin" or vd_l >= 1.2:
			variants.append(v)
	return {
		"bore": [maxf(40.0, stroke / 1.5), minf(120.0, stroke / 0.45), "The bore against the stroke: between 0.45 and 1.5 times"],
		"stroke": [stroke_min, stroke_max, "The stroke against the bore, and the piston speed at the rev limit (28 m/s at most)"],
		"compression": [7.0, _round(maxf(7.5, cr_max) - 0.05, 0.1), "The most that " + str(fuel["label"]).to_lower() + " allows without knock"],
		"cam": [200.0, cam_max, "The longest cam that still runs"],
		"intake": [roundf(intake_min), roundf(intake_max), "%d valves in a bore of %s mm flow at most this much" % [valves, bore]],
		"exhaust": [roundf(intake * 0.5), roundf(intake), "An exhaust flows less than the inlet"],
		"primary": [0.15, minf(1.5, _f(b, "exhaust_length", 2.0) - 0.2), "The header is shorter than the whole exhaust"],
		"exhaustLen": [maxf(0.5, _f(b, "primary_length", 0.4) + 0.2), 4.0, "The whole exhaust is longer than the header"],
		"lambda": [0.75, 1.1, "Richer than 0.75 does not burn, leaner than 1.1 runs hot"],
		"boost": [0.1, _round(boost_max, 0.05), "The compression and the fuel (knock) may allow less"],
		"temp": [-20.0, 45.0, "Air of a dyno room"], "altitude": [0.0, 4000.0, "Altitude of the dyno"],
		"idle": [400.0, maxf(500.0, minf(1500.0, floorf(limiter * 0.35 / 50.0) * 50.0)), "The idle speed of an engine: 400 to 1500 rpm"],
		"limiter": [maxf(2500.0, idle * 3.0), floorf(minf(20000.0, 28.0 * 30000.0 / stroke) / 100.0) * 100.0,
			"The piston speed at the rev limit stays under 28 m/s (the stroke)"],
		"inertia": [0.02, roundf((0.35 * vd_l + 0.6) * 100.0) / 100.0, "A flywheel in proportion to the engine"],
		"valves": valve_list, "turboSizes": sizes, "turboVariants": variants,
	}
