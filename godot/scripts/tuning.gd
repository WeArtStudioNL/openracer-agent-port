class_name Tuning
extends RefCounted
## What can be set on a car in the tuning menu (after web/js/CarTuning.js: the groups, the labels, the units and
## the ranges in the units of the menu), and where it is in car.json. A tune is a whole car.json, kept as the
## browser game keeps it: { "openracer-tune": 1, "car", "name", "saved", "config" } (.openracer-tune.json), in
## user://tunes/<car>/, or one that comes with the car (web/cars/<car>/, car.json "tunes").
##
## An item: [key, label, unit, min, max, step, path in car.json, factor (menu value x factor = car.json value)].
## A select: [key, label, "select", options, path]. A switch: [key, label, "bool", path, on value, off value].

const KMH100 := 27.7778        # 100 km/h in m/s (the downforce of the menu is at that speed)

const GROUPS := [
	["Chassis", [
		["mass", "Mass", "kg", 50, 6000, 10, "chassis.mass", 1.0],
		["front_weight", "Weight on the front axle", "%", 25, 75, 0.5, "chassis.weight_distribution", 0.01],
		["cg_height", "Height of the centre of gravity", "m", 0.1, 1.5, 0.01, "chassis.cg_height", 1.0],
		["roll_front", "Roll stiffness at the front", "%", 10, 90, 1, "chassis.roll_front", 0.01],
		["spring_front", "Front springs (wheel rate)", "N/mm", 3, 200, 1, "chassis.spring_front", 1000.0],
		["spring_rear", "Rear springs (wheel rate)", "N/mm", 3, 200, 1, "chassis.spring_rear", 1000.0],
		["damping_front", "Front dampers", "%", 5, 200, 1, "chassis.damping_front", 0.01],
		["damping_rear", "Rear dampers", "%", 5, 200, 1, "chassis.damping_rear", 0.01],
		["damping_rebound", "Rebound damping (against compression damping)", "×", 0.5, 6, 0.1, "chassis.damping_rebound", 1.0],
		["suspension_travel", "Suspension travel before the bump stop", "cm", 1, 120, 1, "chassis.suspension_travel", 0.01],
		["roll_center_front", "Roll centre at the front", "cm", -20, 60, 1, "chassis.roll_center_front", 0.01],
		["roll_center_rear", "Roll centre at the rear", "cm", -20, 60, 1, "chassis.roll_center_rear", 0.01],
		["unsprung", "Suspension: none (a kart, the frame stands on its tyres)", "bool", "chassis.unsprung", true, false],
		["frame_torsion", "Frame stiffness against twisting (a kart: 0 is a rigid frame)", "N·m/°", 0, 2000, 10, "chassis.frame_torsion", 1.0],
		["inner_lift", "Inner rear wheel lift in a bend (a kart)", "mm", 0, 60, 1, "chassis.inner_lift", 0.001],
	]],
	["Tyres", [
		["compound", "Tyre compound", "select", ["eco", "road", "sport", "semislick", "slick", "winter", "offroad", "drag"], "tyres.compound"],
		["rubber_front", "Tyre at the front: rubber (a custom tyre)", "", 0, 100, 1, "wheels.library.front.custom.rubber", 1.0],
		["rubber_rear", "Tyre at the rear: rubber (a custom tyre)", "", 0, 100, 1, "wheels.library.rear.custom.rubber", 1.0],
		["tread_front", "Tyre at the front: tread (grip on grass, sand and mud)", "", 0, 100, 1, "wheels.library.front.custom.tread", 1.0],
		["tread_rear", "Tyre at the rear: tread", "", 0, 100, 1, "wheels.library.rear.custom.tread", 1.0],
		["grip", "Grip", "%", 20, 300, 1, "tyres.grip", 0.01],
		["grip_balance", "Grip of the rear tyres (as a share of the front)", "%", 40, 200, 1, "tyres.grip_balance", 0.01],
		["cornering", "Stiffness against the slip angle", "%", 20, 300, 1, "tyres.cornering", 0.01],
		["pressure_front", "Tyre pressure at the front", "bar", 0.5, 6, 0.1, "tyres.pressure_front", 1.0],
		["pressure_rear", "Tyre pressure at the rear", "bar", 0.5, 6, 0.1, "tyres.pressure_rear", 1.0],
		["rolling_resistance", "Rolling resistance", "", 0.002, 0.1, 0.001, "tyres.rolling_resistance", 1.0],
	]],
	["Engine", [
		["power", "Power (all of the torque, as a factor)", "%", 10, 400, 1, "engine.power_scale", 0.01],
		["idle_rpm", "Idle speed", "rpm", 300, 4000, 50, "engine.idle_rpm", 1.0],
		["limiter_rpm", "Rev limit", "rpm", 2000, 20000, 100, "engine.limiter_rpm", 1.0],
		["engine_inertia", "Inertia of the engine", "kg m²", 0.01, 3, 0.01, "engine.inertia", 1.0],
	]],
	["Transmission", [
		["drive", "Drive", "select", ["rwd", "fwd", "awd"], "drivetrain.drive"],
		["gearbox", "Gearbox", "select", ["gears", "cvt", "torque-converter", "amt", "dct"], "drivetrain.gearbox"],
		["final_drive", "Final drive", "", 1, 10, 0.05, "drivetrain.final_drive", 1.0],
		["gear1", "Gear 1", "", 0.3, 8, 0.01, "drivetrain.gear_ratios.0", 1.0],
		["gear2", "Gear 2", "", 0.3, 8, 0.01, "drivetrain.gear_ratios.1", 1.0],
		["gear3", "Gear 3", "", 0.3, 8, 0.01, "drivetrain.gear_ratios.2", 1.0],
		["gear4", "Gear 4", "", 0.3, 8, 0.01, "drivetrain.gear_ratios.3", 1.0],
		["gear5", "Gear 5", "", 0.3, 8, 0.01, "drivetrain.gear_ratios.4", 1.0],
		["gear6", "Gear 6", "", 0.3, 8, 0.01, "drivetrain.gear_ratios.5", 1.0],
		["reverse_ratio", "Reverse", "", 0.5, 10, 0.05, "drivetrain.reverse_ratio", 1.0],
		["shift_time", "Shift time", "s", 0.02, 3, 0.01, "drivetrain.shift_time", 1.0],
		["clutch", "Clutch capacity (x peak torque)", "", 0.5, 6, 0.05, "drivetrain.clutch", 1.0],
		["clutch_start_rpm", "Automatic clutch: starts to grip at", "rpm", 300, 10000, 50, "drivetrain.clutch_start_rpm", 1.0],
		["clutch_full_rpm", "Automatic clutch: grips fully at", "rpm", 400, 12000, 50, "drivetrain.clutch_full_rpm", 1.0],
		["cvt_rpm", "CVT: engine speed at full throttle", "rpm", 1000, 20000, 100, "drivetrain.cvt_rpm", 1.0],
		["tc_stall_rpm", "Torque converter: stall speed", "rpm", 500, 8000, 50, "drivetrain.tc_stall_rpm", 1.0],
		["tc_ratio", "Torque converter: torque ratio at stall", "", 1, 4, 0.05, "drivetrain.tc_ratio", 1.0],
		["tc_lockup", "Torque converter: lock-up clutch", "bool", "drivetrain.tc_lockup", true, false],
		["diff", "Differential", "select", ["open", "lsd", "welded", "locked"], "drivetrain.diff"],
		["diff_preload", "Limited slip: preload", "Nm", 0, 2000, 10, "drivetrain.diff_preload", 1.0],
		["diff_power", "Limited slip: lock under power", "%", 0, 100, 1, "drivetrain.diff_power", 0.01],
		["diff_coast", "Limited slip: lock off the throttle", "%", 0, 100, 1, "drivetrain.diff_coast", 0.01],
		["center_split", "Torque to the front (all wheel drive)", "%", 0, 100, 1, "drivetrain.center_split", 0.01],
		["efficiency", "Efficiency of the driveline", "", 0.5, 1, 0.01, "drivetrain.efficiency", 1.0],
	]],
	["Brakes", [
		["brake_front", "Brakes at the front (per wheel)", "Nm", 50, 10000, 50, "brakes.front", 1.0],
		["brake_rear", "Brakes at the rear (per wheel)", "Nm", 50, 10000, 50, "brakes.rear", 1.0],
	]],
	["Aerodynamics and steering", [
		["drag_coefficient", "Drag coefficient", "", 0.05, 2, 0.01, "chassis.drag_coefficient", 1.0],
		["downforce_front", "Downforce at the front axle at 100 km/h (negative: lift)", "N", -10000, 20000, 50, "chassis.downforce_front", 1.0 / (KMH100 * KMH100)],
		["downforce_rear", "Downforce at the rear axle at 100 km/h", "N", -10000, 20000, 50, "chassis.downforce_rear", 1.0 / (KMH100 * KMH100)],
		["max_steer_deg", "Steering lock", "°", 5, 80, 1, "chassis.max_steer_deg", 1.0],
		["ackermann", "Ackermann (the inner wheel steers more)", "%", -50, 150, 5, "chassis.ackermann", 0.01],
		["steering_degrees", "Steering wheel: turn at full lock (each way)", "°", 30, 1000, 10, "steering_wheel.degrees", 1.0],
	]],
	["Assists", [
		["tc_on", "Traction control fitted", "bool", "extras.tc_on", true, false],
		["abs_on", "ABS fitted", "bool", "extras.abs_on", true, false],
		["esc_on", "Stability control fitted", "bool", "extras.esc_on", true, false],
		["tc_allowance", "Traction control: wheel spin allowed", "%", 20, 400, 5, "assists.tc_allowance", 0.01],
		["esc_gain", "Stability control: strength", "%", 10, 300, 5, "assists.esc_gain", 0.01],
	]],
]


## The defaults of the physics where car.json has nothing (Car.gd), so a slider starts where the car is.
const FALLBACK := {
	"chassis.roll_front": 0.5, "chassis.damping_rebound": 1.5, "chassis.roll_center_front": 0.1, "chassis.roll_center_rear": 0.1,
	"tyres.grip": 1.0, "tyres.grip_balance": 1.0, "tyres.cornering": 1.0, "tyres.pressure_front": 2.2, "tyres.pressure_rear": 2.2,
	"tyres.rolling_resistance": 0.015, "engine.power_scale": 1.0, "drivetrain.efficiency": 0.92, "drivetrain.clutch": 1.5,
	"chassis.drag_coefficient": 0.35, "chassis.downforce_front": 0.0, "chassis.downforce_rear": 0.0, "chassis.ackermann": 0.6,
	"assists.tc_allowance": 1.0, "assists.esc_gain": 1.0, "chassis.frame_torsion": 0.0, "chassis.inner_lift": 0.0,
}


## The value at a path of car.json ("chassis.mass", "drivetrain.gear_ratios.2"), or null when it is not there.
static func read(cfg: Dictionary, path: String) -> Variant:
	var at: Variant = cfg
	for part in path.split("."):
		if at is Dictionary and (at as Dictionary).has(part):
			at = at[part]
		elif at is Array and part.is_valid_int() and int(part) < (at as Array).size():
			at = at[int(part)]
		else:
			return null
	return at


## Sets the value at a path, making the dictionaries on the way (an index of a list must be there already).
static func write(cfg: Dictionary, path: String, value: Variant) -> void:
	var parts := path.split(".")
	var at: Variant = cfg
	for i in parts.size() - 1:
		var part := parts[i]
		var nxt: Variant = null
		if at is Dictionary:
			if not (at as Dictionary).has(part):
				at[part] = {}
			nxt = at[part]
		elif at is Array and part.is_valid_int():
			nxt = at[int(part)]
		if nxt == null:
			return
		at = nxt
	var last := parts[parts.size() - 1]
	if at is Dictionary:
		at[last] = value
	elif at is Array and last.is_valid_int() and int(last) < (at as Array).size():
		at[int(last)] = value


static func tunes_dir(car_id: String) -> String:
	return "user://tunes/%s" % car_id


## The tunes of a car: { name: path } (its own from web/cars/<car>/, and the player's).
static func list(car_id: String, cfg: Dictionary) -> Dictionary:
	var out := {}
	for f in cfg.get("tunes", []):
		var p := Content.path("cars/%s/%s" % [car_id, f])
		var t: Variant = JSON.parse_string(FileAccess.get_file_as_string(p)) if FileAccess.file_exists(p) else null
		if t is Dictionary:
			out[str(t.get("name", f))] = p
	var dir := tunes_dir(car_id)
	if DirAccess.dir_exists_absolute(dir):
		for f in DirAccess.get_files_at(dir):
			if f.ends_with(".openracer-tune.json"):
				var t: Variant = JSON.parse_string(FileAccess.get_file_as_string(dir.path_join(f)))
				if t is Dictionary:
					out[str(t.get("name", f))] = dir.path_join(f)
	return out


static func load_tune(path: String) -> Dictionary:
	var t: Variant = JSON.parse_string(FileAccess.get_file_as_string(path)) if FileAccess.file_exists(path) else null
	return t.get("config", {}) if t is Dictionary else {}


static func save_tune(car_id: String, tune_name: String, cfg: Dictionary) -> String:
	DirAccess.make_dir_recursive_absolute(tunes_dir(car_id))
	var safe := tune_name.validate_filename().replace(" ", "-").to_lower()
	var path := tunes_dir(car_id).path_join(safe + ".openracer-tune.json")
	var data := {"openracer-tune": 1, "car": car_id, "name": tune_name, "saved": Time.get_datetime_string_from_system(true) + "Z", "config": cfg}
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify(data, "  "))
	return path
