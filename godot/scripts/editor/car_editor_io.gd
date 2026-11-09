class_name CarEditorIO
extends RefCounted
## What the car editor reads and writes: the list of the cars (the game's and the garage's), a new car, a glTF model, the
## car.json that is saved (buildConfig and save of car-editor.js) with the model files next to it, a car deleted, a car
## as a zip, and the sums of the browser editor (the top speed, the wheelie check, CameraSettings of CarDefaults.js).

## The order of the keys of a car.json as the browser editor writes it.
const ORDER := ["name", "description", "type", "model", "wheels", "dimensions", "chassis", "drivetrain", "engine", "brakes", "cameras", "steering_wheel",
	"sound", "motorcycle", "tyres", "fuel", "assists", "extras", "colors", "materials", "exhaust", "suspension", "driveline", "driver", "softbody", "parts", "tunes"]

const BIKE_TYRE := {"front": "moto-120-70-17", "rear": "moto-180-55-17"}

var driver_written := false         # (save_driver) the driver went in car.json
var ed: CarEditor


func _init(editor: CarEditor) -> void:
	ed = editor


static func slug(text: String) -> String:
	var out := ""
	for ch in text.to_lower():
		out += ch if (ch >= "a" and ch <= "z") or (ch >= "0" and ch <= "9") else "-"
	while out.contains("--"):
		out = out.replace("--", "-")
	return out.trim_prefix("-").trim_suffix("-").substr(0, 64)


## A file name the game allows (a .glb is renamed: it has everything inside it).
static func safe_file_name(file_name: String) -> String:
	if RegEx.create_from_string(CarEditor.FILE_PATTERN).search(file_name) != null:
		return file_name
	var base := ""
	for ch in file_name.get_basename():
		var ok := (ch >= "a" and ch <= "z") or (ch >= "A" and ch <= "Z") or (ch >= "0" and ch <= "9") or ch in [".", "_", " ", "-"]
		base += ch if ok else "-"
	while base != "" and not ((base[0] >= "a" and base[0] <= "z") or (base[0] >= "A" and base[0] <= "Z") or (base[0] >= "0" and base[0] <= "9")):
		base = base.substr(1)
	base = base.substr(0, 120)
	return (base if base != "" else "model") + "." + file_name.get_extension().to_lower()


## The web folder of the repository when the game runs from it (godot/ next to web/), else "".
static func repo_web() -> String:
	var repo := ProjectSettings.globalize_path("res://").path_join("../web").simplify_path()
	return repo if Content.root != "" and Content.root.simplify_path() == repo and FileAccess.file_exists(repo.path_join("cars/index.json")) else ""


func list_cars() -> Array:
	var out := []
	var own := Garage.ids("cars")
	for c in Content.list_cars():
		var nm := str(c["name"]).trim_suffix("  (garage)")
		out.append({"id": c["id"], "name": nm, "source": "garage" if own.has(c["id"]) else "game"})
	return out


static func load_gltf(path: String) -> Node3D:
	if not FileAccess.file_exists(path):
		return null
	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	if doc.append_from_file(path, state) != OK:
		return null
	return doc.generate_scene(state) as Node3D


## A new car or motorcycle: the defaults of the form of car-editor.html.
func default_car(kind: String) -> Dictionary:
	var c := {
		"name": "", "description": "",
		"model": {"type": "gltf", "rotation_y": 0, "scale": 1, "offset": [0, 0, 0]},
		"wheels": {"mode": "default"},
		"dimensions": {"length": 4.5, "width": 1.8, "height": 1.35},
		"chassis": {"mass": 1400, "wheelbase": 2.7, "front_axle_offset": 0, "rear_axle_offset": 0, "front_track": 1.55, "rear_track": 1.55,
			"weight_distribution": 0.55, "cg_height": 0.5, "suspension_travel": 0.09, "unsprung": false, "tire_diameter": 0.65, "drag_coefficient": 0.32,
			"max_steer_deg": 30},
		"drivetrain": {"drive": "rwd", "gearbox": "gears", "tc_lockup": true, "diff": "open", "diff_preload": 150, "diff_power": 0.3, "diff_coast": 0.1,
			"center_diff": "open", "center_split": 0.4, "gear_ratios": [3.6, 2.1, 1.4, 1.0, 0.8], "reverse_ratio": 3.4, "final_drive": 3.5, "efficiency": 0.92},
		"engine": {"idle_rpm": 850, "limiter_rpm": 6800, "inertia": 0.3, "torque_curve": CarEditor.DEFAULT_CURVE.duplicate(true)},
		"brakes": {"front": 1600, "rear": 900},
		"steering_wheel": {"degrees": 450, "stop": "rods"},
		"sound": {"engine_sim": _sound_defaults()},
		"motorcycle": CarEditor.BIKE_DEFAULTS.duplicate(),
	}
	if kind == "motorcycle":
		c["type"] = "motorcycle"
		c["wheels"]["mode"] = "model"
		c["chassis"].merge({"mass": 190, "weight_distribution": 0.49, "cg_height": 0.62, "suspension_travel": 0.12, "tire_diameter": 0.61, "drag_coefficient": 0.6,
			"max_steer_deg": 22, "wheelbase": 1.4}, true)
		c["brakes"] = {"front": 1200, "rear": 250}
		c["drivetrain"].merge({"gear_ratios": [2.75, 2, 1.667, 1.444, 1.304, 1.208], "final_drive": 6, "drive": "rwd", "diff": "welded"}, true)
		c["dimensions"] = {"length": 2.0, "width": 0.72, "height": 1.1}
	return c


## The fields of the engine sound as the form has them (engineSimParams of no car): what the browser saves.
static func _sound_defaults() -> Dictionary:
	var p := EngineSimParams.params({})
	var keep := ["layout", "impulse_response", "exhaust_type", "convolution", "bore", "stroke", "rod", "compression_ratio", "burn_duration", "burn_randomness",
		"intake_duration", "intake_lift", "intake_lobe_centre", "exhaust_duration", "exhaust_lift", "exhaust_lobe_centre", "intake_flow", "exhaust_flow",
		"idle_pressure", "exhaust_systems", "primary_length", "primary_flow", "exhaust_length", "outlet_flow", "collector_area", "hf_gain", "noise", "jitter",
		"volume", "audio_volume", "simulation_frequency", "timing"]
	var out := {}
	for k in keep:
		out[k] = p[k]
	return out


## A car as the form keeps it: one shift of both axles (the wheelbase is the distance between them), the sections there.
func normalise(c: Dictionary) -> Dictionary:
	for k in ["dimensions", "chassis", "drivetrain", "engine", "brakes"]:
		if not c.get(k) is Dictionary:
			c[k] = default_car("car")[k]
	var ch: Dictionary = c["chassis"]
	var fo := float(ch.get("front_axle_offset", 0.0))
	var ro := float(ch.get("rear_axle_offset", 0.0))
	ch["wheelbase"] = snappedf(float(ch.get("wheelbase", 2.6)) + fo - ro, 0.001)
	ch["front_axle_offset"] = snappedf((fo + ro) / 2.0, 0.001)
	ch["rear_axle_offset"] = ch["front_axle_offset"]
	var d: Dictionary = c["drivetrain"]
	if not d.has("diff"):
		d["diff"] = "lsd"
	if not d.has("center_diff"):
		d["center_diff"] = "lsd"
	if not str(d.get("gearbox", "gears")) in ["cvt", "torque-converter", "dct", "amt", "imt"]:
		d["gearbox"] = "gears"
	if not c.get("model") is Dictionary:
		c["model"] = {"type": "gltf", "rotation_y": 0, "scale": 1, "offset": [0, 0, 0]}
	if not c.get("sound") is Dictionary or not c["sound"].get("engine_sim") is Dictionary:
		c["sound"] = {"engine_sim": _sound_defaults()}
	else:
		var full := EngineSimParams.params(c)
		var es: Dictionary = c["sound"]["engine_sim"]
		for k in _sound_defaults():
			if not es.has(k):
				es[k] = full[k]
	var bike: Dictionary = CarEditor.BIKE_DEFAULTS.duplicate()
	if c.get("motorcycle") is Dictionary:
		bike.merge(c["motorcycle"], true)
	c["motorcycle"] = bike
	if not c.get("steering_wheel") is Dictionary:
		c["steering_wheel"] = {"degrees": 450, "stop": "rods"}
	c["cameras"] = camera_settings(c)
	return c


## The cameras of a car with defaults from its size (OpenRacer.cameraSettings of CarDefaults.js).
static func camera_settings(c: Dictionary) -> Dictionary:
	var d: Dictionary = c.get("dimensions", {})
	var r := float(c.get("chassis", {}).get("tire_diameter", 0.65)) / 2.0
	var length := float(d.get("length", 4.5))
	var width := float(d.get("width", 1.8))
	var height := float(d.get("height", 1.35))
	var given: Dictionary = c.get("cameras", {}) if c.get("cameras") is Dictionary else {}
	var follow := {"distance": snappedf(length * 1.55, 0.1), "height": snappedf(height * 1.6, 0.01), "look_height": snappedf(height * 0.6, 0.01), "look_z": 0,
		"smoothing": 3.5, "fov_standing": 45, "fov_fast": 75, "fov_full_speed": 70, "dolly": 1}
	var cockpit := {"position": [snappedf(width * 0.2, 0.01), snappedf(height * 0.8 - r, 0.01), snappedf(length * 0.05, 0.01)], "fov": 75, "hide_driver": false}
	var offset: Variant = Tuning.read(c, "model.offset")
	var bonnet := {"position": [0.0, snappedf(height * 0.62 + (float(offset[1]) if offset is Array and (offset as Array).size() == 3 else 0.0), 0.01), snappedf(length * 0.12, 0.01)], "fov": 72}
	follow["distance_fast"] = 0
	follow["height_fast"] = 0
	if given.get("bonnet") is Dictionary:
		bonnet.merge(given["bonnet"], true)
	if given.get("follow") is Dictionary:
		follow.merge(given["follow"], true)
	if given.get("cockpit") is Dictionary:
		cockpit.merge(given["cockpit"], true)
		if not cockpit.get("position") is Array:
			cockpit["position"] = [snappedf(width * 0.2, 0.01), snappedf(height * 0.8 - r, 0.01), snappedf(length * 0.05, 0.01)]
	return {"follow": follow, "cockpit": cockpit, "bonnet": bonnet}


# ---- the wheel library (WheelLibrary.js, CarTuning.libraryOf)

## The rims and the tyres of the axles from the values of the tuning table: { front: { rim, tyre, custom }, rear: ... }.
static func library_of(v: Dictionary) -> Dictionary:
	var lib := {}
	for axle in ["front", "rear"]:
		var from_model: bool = v.get("model_tyres") == "on"
		var r := "" if from_model else str(v.get("rim_" + axle, ""))
		if r == "<null>":
			r = ""
		var entry := {}
		var bike_tyre: String = BIKE_TYRE[axle] if v.get("vehicle_type") == "motorcycle" and r != "" else ""
		var t := str(v.get("tyre_" + axle, ""))
		if t == "" or t == "<null>":
			t = bike_tyre if bike_tyre != "" else ("custom" if r != "" or from_model else "")
		if from_model:
			entry["model"] = true
		if r != "":
			entry["rim"] = r
		if t != "":
			entry["tyre"] = t
		if t == "custom":
			var width_cm := float(v.get("tyre_width", 0.0))
			if axle == "rear" and float(v.get("tyre_width_rear", 0.0)) > 0.0:
				width_cm = float(v["tyre_width_rear"])
			if not (width_cm > 0.0):
				width_cm = 24.5
			var dia := float(v.get("tyre_diameter_" + axle, 650.0))
			if not (dia > 0.0):
				dia = 650.0
			var height := float(v.get("tyre_height_" + axle, 0.0))
			entry["custom"] = {"width": width_cm / 100.0, "diameter": dia / 1000.0,
				"inner_ratio": clampf(1.0 - 2.0 * height / dia, 0.3, 0.9) if height > 0.0 else (float(v.get("tyre_inner_ratio", 62.0)) / 100.0),
				"rings": int(v.get("tyre_rings", 4)) if float(v.get("tyre_rings", 0)) > 0.0 else 4,
				"segments": int(v.get("tyre_segments", 36)) if float(v.get("tyre_segments", 0)) > 0.0 else 36,
				"carcass": float(v.get("tyre_carcass", 0.0)), "rubber": float(v.get("rubber_" + axle, 50.0)), "tread": float(v.get("tread_" + axle, 0.0))}
		if r != "" or t != "":
			lib[axle] = entry
	return lib


## The library of the car made again from its values (after a rim, a tyre or a tyre setting changed).
func rebuild_library() -> void:
	var v := Tuning.values_of(ed.cfg)
	var lib := library_of(v)
	var w: Dictionary = ed.cfg.get("wheels", {}) if ed.cfg.get("wheels") is Dictionary else {}
	if lib.is_empty():
		w.erase("library")
	else:
		w["library"] = lib
	ed.cfg["wheels"] = w


## The diameters of the wheels from the custom tyres of the axles (FR FL RL RR), or [] (the same for all).
func library_wheel_sizes() -> Array:
	var lib: Variant = Tuning.read(ed.cfg, "wheels.library")
	if not lib is Dictionary:
		return []
	var f: Variant = Tuning.read(ed.cfg, "wheels.library.front.custom.diameter")
	var r: Variant = Tuning.read(ed.cfg, "wheels.library.rear.custom.diameter")
	if f == null or r == null or Tuning.read(ed.cfg, "wheels.library.front.tyre") != "custom" or Tuning.read(ed.cfg, "wheels.library.rear.tyre") != "custom":
		return []
	return [float(f), float(f), float(r), float(r)]


static func wheels_json() -> Dictionary:
	var lib: Variant = Content.load_json("wheels/wheels.json")
	return lib if lib is Dictionary else {}


# ---- the sums

## The top speed in m/s from the numbers (OpenRacer.topSpeed of CarDefaults.js).
static func top_speed(c: Dictionary) -> float:
	var ch: Dictionary = c.get("chassis", {})
	var dt: Dictionary = c.get("drivetrain", {})
	var eng: Dictionary = c.get("engine", {})
	var dim: Dictionary = c.get("dimensions", {})
	var curve: Array = eng.get("torque_curve", []) if eng.get("torque_curve") is Array else []
	var gears: Array = dt.get("gear_ratios", []) if dt.get("gear_ratios") is Array else []
	var final := float(dt.get("final_drive", 0.0))
	var limiter := float(eng.get("limiter_rpm", 0.0))
	if curve.size() < 2 or gears.is_empty() or not (final > 0.0) or not (limiter > 0.0) or not (float(ch.get("tire_diameter", 0)) > 0.0):
		return 0.0
	var axle := "front" if dt.get("drive") == "fwd" else "rear"
	var fitted: Variant = Tuning.read(c, "wheels.library.%s.custom.diameter" % axle)
	var r := (float(fitted) if fitted != null and float(fitted) > 0.0 else float(ch["tire_diameter"])) / 2.0
	var scale := float(eng.get("power_scale", 1.0))
	var eff := float(dt.get("efficiency", 0.92))
	var cdrag := 0.5 * float(ch.get("drag_coefficient", 0.3)) * float(dim.get("width", 1.8)) * float(dim.get("height", 1.4)) * 0.85 * 1.29
	var roll := float(Tuning.read(c, "tyres.rolling_resistance") if Tuning.read(c, "tyres.rolling_resistance") != null else 0.015) * float(ch.get("mass", 1000)) * 9.81
	var ratios := gears.duplicate()
	if dt.get("gearbox") == "cvt":
		var lo: float = gears.min()
		var hi: float = gears.max()
		ratios = []
		for k in 41:
			ratios.append(lo + (hi - lo) * k / 40.0)
	var best := 0.0
	for ratio in ratios:
		var total := float(ratio) * final
		var v := limiter * PI / 30.0 * r / total
		while v > 0.5:
			var rpm := v / r * total * 30.0 / PI
			var tq := 0.0
			for i in range(1, curve.size()):
				if rpm <= float(curve[i][0]):
					var a: Array = curve[i - 1]
					var b: Array = curve[i]
					tq = float(a[1]) + (float(b[1]) - float(a[1])) * (rpm - float(a[0])) / maxf(1e-9, float(b[0]) - float(a[0]))
					break
			if tq * scale * eff * total / r >= cdrag * v * v + roll:
				best = maxf(best, v)
				break
			v -= 0.1
	return best


## A motorcycle that lifts its front wheel on full throttle (OpenRacer.wheelieCheck): the warning, or "".
func wheelie_text() -> String:
	var c := ed.cfg
	var ch: Dictionary = c.get("chassis", {})
	var dt: Dictionary = c.get("drivetrain", {})
	var curve: Variant = Tuning.read(c, "engine.torque_curve")
	var gears: Array = dt.get("gear_ratios", []) if dt.get("gear_ratios") is Array else []
	if not curve is Array or gears.is_empty() or not (float(dt.get("final_drive", 0)) > 0.0) or not (ed.num("chassis.cg_height") > 0.0):
		return ""
	var fitted: Variant = Tuning.read(c, "wheels.library.rear.custom.diameter")
	var r := (float(fitted) if fitted != null and float(fitted) > 0.0 else ed.num("chassis.tire_diameter", 0.6)) / 2.0
	var peak := 0.0
	for p in curve:
		peak = maxf(peak, float(p[1]))
	var mass := ed.num("chassis.mass", 200.0) + ed.num("motorcycle.rider_mass", 80.0)
	var wd := ed.num("chassis.weight_distribution", 0.5)
	var limit := ed.num("chassis.wheelbase", 1.4) * wd / ed.num("chassis.cg_height", 0.6)
	var worst := 0.0
	var lifted := []
	for i in gears.size():
		var g := peak * float(dt.get("efficiency", 0.9)) * float(gears[i]) * float(dt["final_drive"]) / r / (mass * 9.81)
		worst = maxf(worst, g)
		if g > limit:
			lifted.append(i + 1)
	if lifted.is_empty():
		return ""
	return "⚠ %s on full throttle in gear %s: thrust up to %.2f g, the front comes up at %.2f g (wheelie control and traction control tame it)" % [
		"loops over" if worst > 1.8 * limit else "wheelie", str(lifted[0]) if lifted.size() == 1 else "%d-%d" % [lifted[0], lifted[-1]], worst, limit]


# ---- the car.json

## The car.json of the form, checked as the browser's buildConfig: the car, or { "_error": message }.
func build_config(_id: String, quiet := false) -> Dictionary:
	var c := ed.cfg.duplicate(true)
	var e := _check(c)
	if e == "":
		e = _wheels(c)
	if e != "":
		return {"_error": e}
	var ex: Array = ed.layers.exhaust_config()
	if ex.is_empty():
		c.erase("exhaust")
	else:
		c["exhaust"] = ex
	c.erase("suspension")
	c.erase("driveline")
	c.merge(ed.suspension.read(), true)
	if not quiet:
		for h in ed.hooks.values():
			if h != null and h.has_method("read"):
				h.call("read", c)
	if c.get("softbody") is Dictionary and c["softbody"].has("layout") and not (c["softbody"].get("layout_cg") is float):
		c["softbody"]["layout_cg"] = c["chassis"]["cg_height"]
		c["softbody"]["layout_radius"] = float(c["chassis"]["tire_diameter"]) / 2.0
	for k in ["materials", "id", "tunes"]:
		c.erase(k)
	return c


## The numbers of the form: "" when they make a car, else what is wrong. The values are put in their ranges.
func _check(c: Dictionary) -> String:
	for pair in [["dimensions.length", "The length"], ["dimensions.width", "The width"], ["dimensions.height", "The height"], ["chassis.mass", "The mass"],
			["chassis.wheelbase", "The wheelbase"], ["chassis.front_track", "The front track"], ["chassis.rear_track", "The rear track"],
			["chassis.weight_distribution", "The front weight"], ["chassis.cg_height", "The height of the centre of gravity"],
			["chassis.tire_diameter", "The tyre diameter"], ["chassis.drag_coefficient", "The drag coefficient"], ["chassis.max_steer_deg", "The steering lock"],
			["drivetrain.reverse_ratio", "The reverse ratio"], ["drivetrain.final_drive", "The final drive"], ["drivetrain.efficiency", "The efficiency"],
			["engine.idle_rpm", "The idle speed"], ["engine.limiter_rpm", "The rev limit"], ["engine.inertia", "The inertia"],
			["brakes.front", "The front brakes"], ["brakes.rear", "The rear brakes"]]:
		var v: Variant = Tuning.read(c, pair[0])
		if not (v is float or v is int) or not (float(v) > 0.0):
			return pair[1] + " has to be a number above 0."
	var gears: Variant = Tuning.read(c, "drivetrain.gear_ratios")
	var curve := []
	for p in Tuning.read(c, "engine.torque_curve") if Tuning.read(c, "engine.torque_curve") is Array else []:
		if float(p[1]) >= 0.0:
			curve.append([float(p[0]), float(p[1])])
	curve.sort_custom(func(a, b): return a[0] < b[0])
	c["engine"]["torque_curve"] = curve
	var cam_ok := true
	for path in ["follow.distance", "follow.height", "follow.look_height", "follow.look_z", "follow.smoothing", "follow.fov_standing", "follow.fov_fast",
			"follow.fov_full_speed", "follow.dolly", "cockpit.fov", "cockpit.position.0", "cockpit.position.1", "cockpit.position.2"]:
		var v: Variant = Tuning.read(c.get("cameras", {}), path)
		cam_ok = cam_ok and (v is float or v is int)
	var e := ""
	if not gears is Array or (gears as Array).is_empty():
		e = "Give at least one gear ratio."
	elif curve.size() < 3:
		e = "The engine needs at least three points on its torque curve."
	elif not (float(c["engine"]["limiter_rpm"]) > float(c["engine"]["idle_rpm"])):
		e = "The rev limit has to be above the idle speed."
	elif not cam_ok:
		e = "Every field of the cameras needs a number."
	elif str(c.get("name", "")).strip_edges() == "":
		e = "Give the car a name."
	if e == "":
		_tidy(c)
	return e


## The values put in their ranges, and what a motorcycle or a car does not have taken out.
func _tidy(c: Dictionary) -> void:
	c["name"] = str(c["name"]).strip_edges()
	c["description"] = str(c.get("description", "")).strip_edges()
	var ch: Dictionary = c["chassis"]
	ch["weight_distribution"] = clampf(float(ch["weight_distribution"]), 0.1, 0.9)
	ch["suspension_travel"] = maxf(0.01, float(ch.get("suspension_travel", 0.09)))
	ch["rear_axle_offset"] = ch.get("front_axle_offset", 0)
	var dt: Dictionary = c["drivetrain"]
	dt["efficiency"] = clampf(float(dt["efficiency"]), 0.5, 1.0)
	for k in ["cvt_rpm", "tc_stall_rpm", "tc_ratio"]:
		if dt.has(k) and not (float(dt[k]) > 0.0):
			dt.erase(k)
	for k in ["diff_power", "diff_coast", "center_split"]:
		dt[k] = clampf(float(dt.get(k, 0.0)), 0.0, 1.0)
	var sw: Dictionary = c.get("steering_wheel", {})
	sw["degrees"] = clampf(float(sw.get("degrees", 450)), 30.0, 1000.0)
	sw["stop"] = "degrees" if sw.get("stop") == "degrees" else "rods"
	c["steering_wheel"] = sw
	if ed.is_bike():
		c["type"] = "motorcycle"
		dt["drive"] = "rwd"
		dt["diff"] = "welded"
	else:
		c.erase("type")
		c.erase("motorcycle")
	if not (Tuning.read(c, "engine.build") is Dictionary):
		Tuning.erase(c, "engine.build")


## The wheels: with Wheels from model the wheelbase, the tracks and the tyre are measured on the parts (as the physics of the game does).
func _wheels(c: Dictionary) -> String:
	var ch: Dictionary = c["chassis"]
	var wheels: Dictionary = c.get("wheels", {}) if c.get("wheels") is Dictionary else {}
	wheels["mode"] = ed.wheel_mode()
	wheels.erase("nodes")
	c["wheels"] = wheels
	var all := true
	var n := {}
	for s in CarEditor.SLOTS:
		all = all and not (ed.wheel_parts[s] as Array).is_empty()
		n[s] = (ed.wheel_parts[s] as Array).duplicate()
	if ed.wheel_mode() != "model":
		if all:
			wheels["nodes"] = n
		return ""
	var cen: Variant = ed.wheel_centers()
	if cen is Dictionary:
		var wb: float = (cen["FR"]["c"].z + cen["FL"]["c"].z) / 2.0 - (cen["RL"]["c"].z + cen["RR"]["c"].z) / 2.0
		var ft: float = absf(cen["FR"]["c"].x - cen["FL"]["c"].x)
		var rt: float = absf(cen["RR"]["c"].x - cen["RL"]["c"].x)
		var dia := ed.mean_tyre(cen)
		var bike := ed.is_bike()
		if not (wb > 0.6 and wb < 5.0 and (bike or (ft > 0.4 and rt > 0.4)) and dia > 0.1 and dia < 1.5):
			return "The wheels of the model do not make a car: the front wheels have to be in front (turn the model) and the wheels have to be between " + \
				"0.1 and 1.5 m (a wheelbase of at least 0.6 m, tracks of at least 0.4 m). Check the wheel parts."
		ch["wheelbase"] = snappedf(wb, 0.001)
		ch["front_track"] = snappedf(maxf(0.04, ft) if bike else ft, 0.001)
		ch["rear_track"] = snappedf(maxf(0.04, rt) if bike else rt, 0.001)
		ch["tire_diameter"] = snappedf(dia, 0.001)
	if not all:
		return "Select the parts of every wheel, or use Dynamic wheels."
	wheels["nodes"] = n
	return ""


## The car.json in the order of the browser's, every whole number written without a fraction (as JSON.stringify does).
static func to_json(c: Dictionary) -> String:
	var ordered := {}
	for k in ORDER:
		if c.has(k):
			ordered[k] = c[k]
	for k in c:
		if not ordered.has(k):
			ordered[k] = c[k]
	return _json(ordered, "") + "\n"


static func _json(v: Variant, indent: String) -> String:
	var inner := indent + "  "
	if v is Dictionary:
		if (v as Dictionary).is_empty():
			return "{}"
		var parts := []
		for k in v:
			parts.append(inner + JSON.stringify(str(k)) + ": " + _json(v[k], inner))
		return "{\n" + ",\n".join(parts) + "\n" + indent + "}"
	if v is Array:
		if (v as Array).is_empty():
			return "[]"
		var parts := []
		for x in v:
			parts.append(inner + _json(x, inner))
		return "[\n" + ",\n".join(parts) + "\n" + indent + "]"
	if v is float:
		var f: float = v
		if is_nan(f) or is_inf(f):
			return "null"
		if f == floorf(f) and absf(f) < 1e15:
			return str(int(f))
		return JSON.stringify(f)
	return JSON.stringify(v)


static func _copy(from: String, to: String) -> int:
	if from == to:
		return OK
	var bytes := FileAccess.get_file_as_bytes(from)
	if bytes.is_empty() and not FileAccess.file_exists(from):
		return ERR_FILE_NOT_FOUND
	var f := FileAccess.open(to, FileAccess.WRITE)
	if f == null:
		return FileAccess.get_open_error()
	f.store_buffer(bytes)
	f.close()
	return OK


## Saves the car: true when it was saved.
func save() -> bool:
	var nm := str(ed.cfg.get("name", "")).strip_edges()
	var id := ed.car_id.strip_edges() if ed.car_id.strip_edges() != "" else slug(nm)
	var plan := _plan(id)
	if plan.has("error"):
		ed.status(str(plan["error"]), "error")
		return false
	var taken := false
	for car in ed.cars:
		taken = taken or car["id"] == id
	if taken and id != ed.existing_id and not await ed.ask("Replace the car “%s”?" % id, "There already is a car with this id.", "Replace"):
		return false
	var dir := ed.save_dir().path_join(id)
	var e := _write(dir, plan)
	if e != "":
		ed.status(e, "error")
		return false
	_saved(id, dir, plan["config"])
	return true


## Values written in car.json of the car as it is on disk (paths with their values), and in the car as made in the form. An error, or "".
func patch_car(values: Dictionary) -> String:
	var dir := ed.save_dir().path_join(ed.existing_id)
	var file := dir.path_join("car.json")
	for p: String in values:
		Tuning.write(ed.existing, p, values[p])
	if not FileAccess.file_exists(file):
		return ""
	var disk: Variant = JSON.parse_string(FileAccess.get_file_as_string(file))
	if not disk is Dictionary:
		return "Could not read " + file
	for p: String in values:
		Tuning.write(disk, p, values[p])
	return _write(dir, {"config": disk, "uploads": []})


## The driver belongs to the car: when it was changed it goes in car.json of the car, also when a tune is chosen (only
## its "driver"; the rest of car.json stays as it is). An error, or "".
func save_driver(c: Dictionary) -> String:
	driver_written = false
	var card: Variant = ed.hooks.get("Driver")
	if card == null or not card.touched:
		return ""
	var dir := ed.save_dir().path_join(ed.existing_id)
	var file := dir.path_join("car.json")
	var disk: Variant = JSON.parse_string(FileAccess.get_file_as_string(file)) if FileAccess.file_exists(file) else null
	var out: Dictionary = disk if disk is Dictionary else ed.existing.duplicate(true)
	var uploads := []
	if c.get("driver") is Dictionary:
		var d: Dictionary = (c["driver"] as Dictionary).duplicate(true)
		var f := str(d.get("file", ""))
		if f.is_absolute_path():
			uploads.append([f, "driver.glb"])
			d["file"] = "cars/%s/driver.glb" % ed.existing_id
		out["driver"] = d
	else:
		out.erase("driver")
	var e := _write(dir, {"config": out, "uploads": uploads})
	if e != "":
		return e
	ed.existing = out.duplicate(true)
	ed._hook_call("saved", [out])
	driver_written = true
	return ""


## What is saved: { config, uploads: [[from, file name]] }, or { error }.
func _plan(id: String) -> Dictionary:
	if RegEx.create_from_string(CarEditor.ID_PATTERN).search(id) == null:
		return {"error": "The id may only have lower case letters, digits, - and _."}
	var c := build_config(id)
	if c.has("_error"):
		return {"error": c["_error"]}
	var uploads := []
	if ed.main_file != "" and not ed.model_files.is_empty():
		for p in ed.model_files:
			var n := p.get_file()
			if p.get_extension().to_lower() in ["glb", "gltf"] and safe_file_name(n) == ed.main_file:
				uploads.append([p, ed.main_file])
			elif RegEx.create_from_string(CarEditor.FILE_PATTERN).search(n) == null:
				return {"error": "The file name “%s” has characters that are not allowed. Use letters, digits, - _ . and spaces." % n}
			else:
				uploads.append([p, n])
		c["model"] = {"type": "gltf", "file": "cars/%s/%s" % [id, ed.main_file]}
	elif ed.existing.get("model") is Dictionary:
		var m: Dictionary = (ed.existing["model"] as Dictionary).duplicate(true)
		if str(m.get("type")) == "gltf" and id != ed.existing_id:
			if str(m.get("file", "")).get_extension().to_lower() != "glb":
				return {"error": "To save this car under another id, load its model files again."}
			uploads.append([Content.path(str(m["file"])), str(m["file"]).get_file()])
			m["file"] = "cars/%s/%s" % [id, str(m["file"]).get_file()]
		c["model"] = m
	else:
		return {"error": "Load a model first."}
	_finish(c, id, uploads)
	return {"config": c, "uploads": uploads}


## The materials, the transform of the model, the driver that goes along, and what the tuning menu put in the car and the form does not have.
func _finish(c: Dictionary, id: String, uploads: Array) -> void:
	if str(c["model"].get("type")) == "gltf":
		var own := {}
		for k in ed.overrides:
			if not (ed.overrides[k] as Dictionary).is_empty():
				own[k] = ed.overrides[k]
		if not own.is_empty():
			c["materials"] = own
		var mm: Dictionary = ed.cfg.get("model", {})
		c["model"]["rotation_y"] = float(mm.get("rotation_y", 0))
		c["model"]["scale"] = float(mm.get("scale", 1)) if float(mm.get("scale", 1)) > 0.0 else 1.0
		c["model"]["offset"] = (mm.get("offset", [0, 0, 0]) as Array).duplicate()
	if c.get("driver") is Dictionary and str(c["driver"].get("file", "")) != "":
		var f := str(c["driver"]["file"])
		# (a driver model picked in the Driver card is an absolute path: it goes with the car as driver.glb)
		var picked := f.is_absolute_path() and FileAccess.file_exists(f)
		if picked or (id != ed.existing_id and f.begins_with("cars/") and FileAccess.file_exists(Content.path(f))):
			uploads.append([Content.path(f), "driver.glb"])
			c["driver"]["file"] = "cars/%s/driver.glb" % id
	var old := ed.existing
	if old.is_empty():
		return
	for section in ["chassis", "drivetrain", "engine"]:
		var merged: Dictionary = (old.get(section, {}) as Dictionary).duplicate(true) if old.get(section) is Dictionary else {}
		merged.merge(c[section], true)
		c[section] = merged
	for section in ["tyres", "assists", "extras"]:
		if old.get(section) is Dictionary and not c.has(section):
			c[section] = old[section].duplicate(true)
	if id == ed.existing_id and old.get("tunes") is Array and not (old["tunes"] as Array).is_empty():
		c["tunes"] = old["tunes"].duplicate()


## The files into the folder of the car: "" or what went wrong.
func _write(dir: String, plan: Dictionary) -> String:
	DirAccess.make_dir_recursive_absolute(dir)
	for u in plan["uploads"]:
		var e := _copy(str(u[0]), dir.path_join(str(u[1])))
		if e != OK:
			return "Could not write %s (%s)." % [u[1], error_string(e)]
	var f := FileAccess.open(dir.path_join("car.json"), FileAccess.WRITE)
	if f == null:
		return "Could not write car.json in %s (%s)." % [dir, error_string(FileAccess.get_open_error())]
	f.store_string(to_json(plan["config"]))
	f.close()
	# the model that is replaced is taken out of the folder when it has another name (to the Trash)
	var c: Dictionary = plan["config"]
	var old_file := str(ed.replaced_model.get("file", "")) if ed.replaced_model.get("type") == "gltf" else ""
	var old_path := dir.path_join(old_file.get_file())
	if old_file != "" and old_file != str(c["model"].get("file")) and old_file.get_base_dir() == "cars/" + dir.get_file() and FileAccess.file_exists(old_path):
		OS.move_to_trash(old_path)
	if repo_web() != "" and dir.begins_with(repo_web()):
		write_index(repo_web().path_join("cars"))
	_new_picture(dir)
	return ""


## The picture in the menu is made again from the car as it is now (car-editor.js: preview.webp deleted after a save):
## the old preview.webp of the folder goes to the Trash, and the picture the menu drew of the car before is forgotten.
func _new_picture(dir: String) -> void:
	var id := dir.get_file()
	if FileAccess.file_exists(dir.path_join("preview.webp")):
		OS.move_to_trash(dir.path_join("preview.webp"))
	CarInfo._textures.erase(dir.path_join("preview.webp"))
	if ed.save_root_override != "":
		return                       # (a test: nothing of the player's)
	var drawn := Settings.path("previews/%s.png" % id)
	CarInfo._textures.erase(drawn)
	CarInfo._rendering.erase(id)
	if FileAccess.file_exists(drawn):
		DirAccess.remove_absolute(drawn)


func _saved(id: String, dir: String, c: Dictionary) -> void:
	ed.replaced_model = {}
	ed._hook_call("saved", [c])
	ed.existing_id = id
	ed.car_id = id
	ed.existing = c.duplicate(true)
	ed.model_files = []
	ed.main_file = ""
	ed._refresh_list(id)
	ed.tuning.render_setups()
	ed.delete_button.visible = true
	ed.set_dirty(false)
	var repo := repo_web() != "" and dir.begins_with(repo_web())
	var where := ("the game's folder web/cars/%s" % id) if repo else (dir if ed.save_root_override != "" else "your garage (%s)" % dir)
	ed.status("Saved in %s. It is in the main menu of the game now." % where, "ok")
	RunLog.event("car editor: saved %s in %s" % [id, dir])


## web/cars/index.json: the folders with a car.json (serve.py write_indexes).
static func write_index(cars_dir: String) -> void:
	var ids := []
	for d in DirAccess.get_directories_at(cars_dir):
		if FileAccess.file_exists(cars_dir.path_join(d).path_join("car.json")):
			ids.append(d)
	ids.sort()
	var lines := []
	for i in ids:
		lines.append(" " + JSON.stringify(i))
	var f := FileAccess.open(cars_dir.path_join("index.json"), FileAccess.WRITE)
	if f != null:
		f.store_string("[\n" + ",\n".join(lines) + "\n]\n")
		f.close()


func delete_car(id: String) -> Dictionary:
	var dirs := []
	for r in Garage.roots():
		var p := r.path_join("cars").path_join(id)
		if FileAccess.file_exists(p.path_join("car.json")):
			dirs.append(p)
	if ed.save_root_override != "" and DirAccess.dir_exists_absolute(ed.save_root_override.path_join(id)):
		dirs.append(ed.save_root_override.path_join(id))
	var repo := repo_web()
	if dirs.is_empty() and ed.save_to_repo and repo != "" and DirAccess.dir_exists_absolute(repo.path_join("cars").path_join(id)):
		dirs.append(repo.path_join("cars").path_join(id))
	if dirs.is_empty():
		return {"error": "This car comes with the game: only the cars of your garage can be deleted here (or switch Save to the game's folder)."}
	var e := OS.move_to_trash(dirs[0])
	if e != OK:
		return {"error": "The car could not be deleted (%s)." % error_string(e)}
	if repo != "" and str(dirs[0]).begins_with(repo):
		write_index(repo.path_join("cars"))
	return {"message": "Moved to the Trash: " + str(dirs[0])}


## The car as it is saved, as a zip to share (car.json and every file it refers to): its path, or { error }.
func export_zip(id: String, to_path: String) -> Dictionary:
	var cfg_path := Content.path("cars/%s/car.json" % id)
	var json: Variant = JSON.parse_string(FileAccess.get_file_as_string(cfg_path)) if FileAccess.file_exists(cfg_path) else null
	if not json is Dictionary:
		return {"error": "car.json of %s could not be read; save the car first" % id}
	var names := {"preview.webp": true}
	var walk := func(v: Variant, me: Callable) -> void:
		if v is String and (v as String).begins_with("cars/%s/" % id):
			names[(v as String).substr(("cars/%s/" % id).length())] = true
		elif v is Array:
			for x in v:
				me.call(x, me)
		elif v is Dictionary:
			for x in (v as Dictionary).values():
				me.call(x, me)
	walk.call(json, walk)
	for t in json.get("tunes", []):
		names[str(t)] = true
	var zip := ZIPPacker.new()
	if zip.open(to_path) != OK:
		return {"error": "could not write " + to_path}
	zip.start_file(id + "/car.json")
	zip.write_file(FileAccess.get_file_as_string(cfg_path).to_utf8_buffer())
	zip.close_file()
	for n in names:
		if str(n).contains(".."):
			continue
		var p := Content.path("cars/%s/%s" % [id, n])
		if not FileAccess.file_exists(p):
			continue
		zip.start_file(id + "/" + str(n))
		zip.write_file(FileAccess.get_file_as_bytes(p))
		zip.close_file()
	zip.close()
	return {"path": to_path}


static func _flat(v: Variant, path: String, out: Dictionary) -> Dictionary:
	if v is Dictionary:
		for k in v:
			_flat(v[k], (path + "." if path != "" else "") + str(k), out)
	elif v is Array:
		for i in (v as Array).size():
			_flat(v[i], path + "[%d]" % i, out)
	else:
		out[path] = v
	return out


## What is different between two car.jsons (the Changes button): "path: before → after".
static func differences(before: Dictionary, now: Dictionary) -> Array:
	var skip := RegEx.create_from_string("^(model|softbody|driver|materials|id|wheels\\.nodes|sound|cameras|exhaust|suspension|driveline)")
	var a := _flat(before, "", {})
	var b := _flat(now, "", {})
	var keys := a.keys()
	for k in b:
		if not a.has(k):
			keys.append(k)
	var out := []
	for k in keys:
		if skip.search(str(k)) != null:
			continue
		var x: Variant = a.get(k)
		var y: Variant = b.get(k)
		if (x is float or x is int) and (y is float or y is int) and absf(float(x) - float(y)) < 1e-6 * maxf(1.0, absf(float(x))):
			continue
		if str(x) != str(y):
			out.append("%s: %s → %s" % [k, "–" if x == null else str(x), "–" if y == null else str(y)])
	return out
