class_name TuningFiles
extends RefCounted
## The files of the tuning menu (Tuning.js, CarTuning.js Setups): Save on Default writes car.json (the car as made
## becomes the car as it is tuned), a tune as a file to share (Export…) and one of someone else (Import…: it becomes a
## setup of this car), and Export to vehicle (a tune that comes with the car, its file next to car.json, overwritten with
## the car as it is tuned now). The browser writes car.json and the tune files of a car through its own server; here
## they are written where the car editor writes the car: the car's folder in the garage, or web/cars/<car> when the game
## runs from the repository (CarEditorIO.repo_web). Neither: the game's own cars of an exported game are not written.

## What belongs to the model of a car, not to its tuning (CarTuning.js tuningOnly): a tune of another car keeps the car's.
const MODEL_KEYS := ["type", "name", "description", "dimensions", "softbody", "parts", "driver", "cameras", "exhaust", "motorcycle",
	"steering_wheel", "materials", "model", "preview", "tunes", "suspension", "driveline"]
const CHASSIS_KEYS := ["wheelbase", "front_track", "rear_track", "tire_diameter", "front_axle_offset", "rear_axle_offset", "cg_height", "mass",
	"weight_distribution", "drag_coefficient"]


## The folder of a car that may be written (its car.json is there): the garage's, else the repository's when the game runs
## from it; "" for none.
static func car_dir(car_id: String) -> String:
	for r in Garage.roots():
		var d := r.path_join("cars").path_join(car_id)
		if FileAccess.file_exists(d.path_join("car.json")):
			return d
	var repo := CarEditorIO.repo_web()
	if repo != "" and FileAccess.file_exists(repo.path_join("cars").path_join(car_id).path_join("car.json")):
		return repo.path_join("cars").path_join(car_id)
	return ""


## Where a car is, for the messages: "garage", "repository" or "" (the game's own, not written).
static func where(car_id: String) -> String:
	var d := car_dir(car_id)
	if d == "":
		return ""
	return "repository" if CarEditorIO.repo_web() != "" and d.begins_with(CarEditorIO.repo_web()) else "garage"


## Writes car.json of a car with cfg (without its id, as the browser does): "" or what went wrong.
static func write_car_json(car_id: String, cfg: Dictionary) -> String:
	var d := car_dir(car_id)
	if d == "":
		return "this car comes with the game, and the game does not run from the repository (the car editor saves a car in your garage)"
	var out := cfg.duplicate(true)
	out.erase("id")
	var f := FileAccess.open(d.path_join("car.json"), FileAccess.WRITE)
	if f == null:
		return error_string(FileAccess.get_open_error())
	f.store_string(CarEditorIO.to_json(out))
	f.close()
	if CarEditorIO.repo_web() != "" and d.begins_with(CarEditorIO.repo_web()):
		CarEditorIO.write_index(CarEditorIO.repo_web().path_join("cars"))
	return ""


## The text of a tune file ({ "openracer-tune": 1, car, name, saved, config }, CarTuning.js shipFile).
static func tune_text(car_id: String, tune_name: String, cfg: Dictionary) -> String:
	var c := cfg.duplicate(true)
	for k in ["model", "id", "tunes"]:
		c.erase(k)
	return JSON.stringify({"openracer-tune": 1, "car": car_id, "name": tune_name, "saved": Time.get_datetime_string_from_system(true) + "Z",
		"config": c}, " ") + "\n"


## The name of a tune file: <name>.openracer-tune.json next to car.json, <car>-<name>.openracer-tune.json to share.
static func file_name(tune_name: String) -> String:
	var s := RegEx.create_from_string("[^a-z0-9]+").sub(tune_name.to_lower(), "-", true).trim_prefix("-").trim_suffix("-")
	return (s if s != "" else "tune") + ".openracer-tune.json"


static func export_file(path: String, car_id: String, tune_name: String, cfg: Dictionary) -> String:
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f == null:
		return error_string(FileAccess.get_open_error())
	f.store_string(tune_text(car_id, tune_name, cfg))
	f.close()
	return ""


## A tune file read (CarTuning.js parseFile): { name, car, config } or { error }.
static func parse_file(path: String) -> Dictionary:
	var data: Variant = JSON.parse_string(FileAccess.get_file_as_string(path)) if FileAccess.file_exists(path) else null
	if data == null:
		return {"error": "This is not a tune file (no JSON)."}
	if not data is Dictionary or int(data.get("openracer-tune", 0)) != 1 or not data.get("config") is Dictionary:
		return {"error": "This is not an OpenRacer tune file."}
	var c: Dictionary = (data["config"] as Dictionary).duplicate(true)
	if not (c.has("chassis") or c.has("drivetrain") or c.has("tyres")):
		return {"error": "The tune file has no car in it."}
	for k in ["model", "id", "tunes"]:
		c.erase(k)
	if c.get("engine") is Dictionary:
		(c["engine"] as Dictionary).erase("power_scale")
	return {"name": str(data.get("name", "Imported tune")).left(40), "car": str(data.get("car", "")), "config": c}


## The tuning of a tune made for another car, on the model of this one (CarTuning.js tuningOnly).
static func tuning_only(config: Dictionary, base: Dictionary) -> Dictionary:
	var c := config.duplicate(true)
	var own := base.duplicate(true)
	for k in MODEL_KEYS:
		c.erase(k)
		if own.has(k):
			c[k] = own[k]
	if own.has("wheels"):
		c["wheels"] = own["wheels"]
	else:
		c.erase("wheels")
	if c.has("chassis") or own.has("chassis"):
		var ch: Dictionary = (c.get("chassis", {}) as Dictionary).duplicate() if c.get("chassis") is Dictionary else {}
		for k in CHASSIS_KEYS:
			if own.get("chassis") is Dictionary and own["chassis"].has(k):
				ch[k] = own["chassis"][k]
			else:
				ch.erase(k)
		c["chassis"] = ch
	return c


## The configuration of an imported tune on this car: the car as made, with the tune laid over it (a shallow merge, as
## Object.assign of the browser).
static func imported(tune: Dictionary, car_id: String, base: Dictionary) -> Dictionary:
	var taken: Dictionary = tune["config"]
	if str(tune.get("car", "")) != "" and str(tune["car"]) != car_id:
		taken = tuning_only(taken, base)
	var out := base.duplicate(true)
	out.merge(taken, true)
	return out


## Export to vehicle: the tune that comes with the car (its file next to car.json) overwritten with cfg: "" or the error.
static func write_shipped(car_id: String, tune_path: String, tune_name: String, cfg: Dictionary) -> String:
	var d := car_dir(car_id)
	if d == "" or tune_path.get_base_dir().simplify_path() != d.simplify_path():
		return "the tune files of this car are not written here (a car of the garage, or of the repository when the game runs from it)"
	var f := FileAccess.open(tune_path, FileAccess.WRITE)
	if f == null:
		return error_string(FileAccess.get_open_error())
	f.store_string(tune_text(car_id, tune_name, cfg))
	f.close()
	return ""
