class_name EngineSimParams
extends RefCounted
## The parameters of the engine sound of a car ("sound.engine_sim" of car.json), as web/js/EngineSim.js makes
## them: the defaults, the layouts of the cylinders, the exhausts, and the options for the synthesizer
## (EngineSimSynth, native/src/engine_sim.cpp).

## The cylinders in the order in which they fire, evenly over the 720 degree cycle, and the exhaust system of each.
const LAYOUTS := {
	"single": [0],
	"inline-2": [0, 0],
	"inline-3": [0, 0, 0],
	"inline-4": [0, 0, 0, 0],
	"inline-5": [0, 0, 0, 0, 0],
	"inline-6": [0, 1, 0, 1, 0, 1],
	"v6": [0, 1, 0, 1, 0, 1],
	"v8-crossplane": [0, 1, 1, 0, 1, 0, 0, 1],
	"v8-flatplane": [0, 1, 0, 1, 0, 1, 0, 1],
	"v10": [0, 1, 0, 1, 0, 1, 0, 1, 0, 1],
	"v12": [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1],
	"flat-4": [0, 0, 1, 1],
	"flat-6": [0, 1, 0, 1, 0, 1],
}

const IMPULSE_RESPONSES := {
	"smooth_39": "smooth_39.wav",
	"minimal_muffling_01": "minimal_muffling_01.wav",
	"minimal_muffling_02": "minimal_muffling_02.wav",
	"minimal_muffling_03": "minimal_muffling_03.wav",
	"mild_exhaust": "mild_exhaust.wav",
	"sharp_01": "sharp_01.wav",
	"exhaust_standard": "exhaust_standard.wav",
	"exhaust_sport": "exhaust_sport.wav",
	"exhaust_performance": "exhaust_performance.wav",
	"exhaust_straight": "exhaust_straight.wav",
	"exhaust_open": "exhaust_open.wav",
}

## The exhausts ("exhaust_type"): the impulse response and how much of it, the drive, the tone, the muffler, the
## volume, and what the exhaust does to the engine (the outlet flow and the length of the pipe, as factors).
## drive_ceiling: the rms of the signal the drive gets at most, a little above what it gets at the usual rpm, so that a
## resonance of the pipe at one rpm does not turn the sound into a square wave there (0: not held, no drive to protect).
const EXHAUSTS := {
	"standard": {"ir": "exhaust_standard", "wet": 1.0, "drive": 0.0, "drive_ceiling": 0.0,
		"lowpass": 2500, "bass": 3, "mid": 0, "mid_hz": 600, "treble": 0, "volume": 0.9, "outlet": 0.7, "length": 1.15},
	"sport": {"ir": "exhaust_sport", "wet": 0.9, "drive": 2.5, "drive_ceiling": 0.13,
		"lowpass": 6000, "bass": 0, "mid": 6, "mid_hz": 700, "treble": 2, "volume": 1.0, "outlet": 1.0, "length": 1.0},
	"performance": {"ir": "exhaust_performance", "wet": 0.8, "drive": 4.0, "drive_ceiling": 0.09,
		"lowpass": 10000, "bass": -2, "mid": 8, "mid_hz": 1100, "treble": 4, "volume": 1.05, "outlet": 1.6, "length": 0.9},
	"straight": {"ir": "exhaust_straight", "wet": 0.7, "drive": 5.0, "drive_ceiling": 0.08,
		"lowpass": 20000, "bass": -3, "mid": 6, "mid_hz": 1400, "treble": 4, "volume": 1.15, "outlet": 2.5, "length": 0.6},
	"open": {"ir": "exhaust_open", "wet": 0.5, "drive": 8.0, "drive_ceiling": 0.11,
		"lowpass": 20000, "bass": -6, "mid": 6, "mid_hz": 2000, "treble": 6, "volume": 1.2, "outlet": 4.0, "length": 0.35},
	"quiet": {"ir": "mild_exhaust", "wet": 1.0, "drive": 0.0, "drive_ceiling": 0.0,
		"lowpass": 1600, "bass": 4, "mid": -2, "mid_hz": 600, "treble": -3, "volume": 0.8, "outlet": 0.4, "length": 1.4},
}

## The defaults: those of EngineSim.js, with the V8 5.7 L crossplane preset.
const DEFAULTS := {
	"exhaust_type": "custom",
	"lobe_gamma": 1.0, "exhaust_runner_volume": 100, "primary_area": 10, "collector_area": 20, "audio_volume": 1,
	"idle_pressure": 0.35, "throttle_gamma": 2.0, "burn_duration": 45, "burn_efficiency": 0.85, "burn_randomness": 0.2,
	"afterfire_temperature": 650,
	"timing": [[0, 12], [1000, 12], [2000, 20], [3000, 26], [4000, 30], [5000, 34], [6000, 38], [9000, 38]],
	"simulation_frequency": 10000, "fluid_steps": 2, "input_cutoff": 1900, "hf_gain": 0.01, "noise": 1.0, "noise_cutoff": 2000,
	"jitter": 0.5, "jitter_cutoff": 10000, "leveler_target": 0.5, "leveler_max_gain": 12, "signal_scale": 4e-5,
	"convolution": 1.0, "volume": 1,
	"layout": "v8-crossplane", "bore": 101.6, "stroke": 88.4, "rod": 146, "compression_ratio": 9.5,
	"intake_duration": 232, "exhaust_duration": 232, "intake_lift": 12, "exhaust_lift": 12,
	"intake_lobe_centre": 110, "exhaust_lobe_centre": 110, "intake_flow": 260, "exhaust_flow": 210,
	"primary_length": 0.5, "primary_flow": 220, "exhaust_length": 2.8, "outlet_flow": 650, "exhaust_systems": 2,
	"impulse_response": "smooth_39",
}

const LENGTHS := [1, 1.15, 0.9, 1.05, 1.1, 0.95, 1.2, 1.0, 1.08, 0.92, 1.12, 0.98]
const ATTENUATION := [0.9, 1.1, 0.8, 0.85, 0.9, 1.1, 0.8, 0.75, 1.0, 0.95, 1.05, 0.9]


## The parameters of a car (OpenRacer.engineSimParams): the defaults with what car.json gives.
static func params(car_config: Dictionary) -> Dictionary:
	var given: Dictionary = car_config.get("sound", {}).get("engine_sim", {})
	var p := DEFAULTS.duplicate(true)
	p.merge(given, true)
	if not LAYOUTS.has(p["layout"]):
		p["layout"] = DEFAULTS["layout"]
	if not (p["timing"] is Array) or (p["timing"] as Array).is_empty():
		p["timing"] = DEFAULTS["timing"]
	var ex: Dictionary = EXHAUSTS.get(str(p["exhaust_type"]), {})
	if not ex.is_empty():
		p["impulse_response"] = ex["ir"]
		p["convolution"] = ex["wet"]
	return p


## The options of the synthesizer (OpenRacer.engineSimWorkletOptions, and the chain of EngineSimSynth.apply).
static func options(p: Dictionary) -> Dictionary:
	var layout: Array = LAYOUTS.get(str(p["layout"]), LAYOUTS["inline-4"])
	var systems := 2 if float(p.get("exhaust_systems", 1)) >= 2 else 1
	var cylinders := []
	for i in layout.size():
		cylinders.append({
			"fire": i * 720.0 / layout.size(),
			"exhaust": layout[i] if systems == 2 else 0,
			"primary": float(p["primary_length"]) * LENGTHS[i % LENGTHS.size()],
			"attenuation": ATTENUATION[i % ATTENUATION.size()],
		})
	var o := p.duplicate(true)
	var ex: Dictionary = EXHAUSTS.get(str(p["exhaust_type"]), {})
	if not ex.is_empty():
		o["outlet_flow"] = float(p["outlet_flow"]) * float(ex["outlet"])
		o["exhaust_length"] = float(p["exhaust_length"]) * float(ex["length"])
		for k in ["drive", "drive_ceiling", "lowpass", "bass", "mid", "mid_hz", "treble"]:
			o[k] = ex[k]
		o["exhaust_volume"] = ex["volume"]
	o["cylinders"] = cylinders
	o["exhaust_systems"] = systems
	return o
