extends Node3D
## Headless regression tests for the motorcycle controller and shared tyre envelope.
## godot --headless --fixed-fps 120 --path godot res://tools/test_moto_physics.tscn -- --tyres=simple --user-dir=/tmp/moto-physics
## Repeat with --car=supermoto-700 and --ticks=60/120/240. The speed controller below
## supplies longitudinal test force only; steering and lateral motion use the real physics.

class WheelieProbe extends Car:
	var checked := false
	var preserved := false

	func _integrate_forces(state: PhysicsDirectBodyState3D) -> void:
		super._integrate_forces(state)
		if checked:
			return
		checked = true
		var front := wheels[0].contact
		var rear := wheels[2].contact
		var saved_speed := speed
		var saved_lean := bike.lean
		wheels[0].contact = false
		wheels[2].contact = true
		speed = 12.0
		bike.lean = 0.3
		config["extras"]["wheelie_steering_on"] = true
		var xf := state.transform
		var velocity := state.linear_velocity
		bike._wheelie_assist(self, state)
		preserved = state.transform == xf and state.linear_velocity == velocity
		config["extras"]["wheelie_steering_on"] = false
		wheels[0].contact = front
		wheels[2].contact = rear
		speed = saved_speed
		bike.lean = saved_lean


var car: WheelieProbe
var failures := 0
var elapsed := 0.0
var scenario := -1
var samples := 0
var lean_sum := 0.0
var error_max := 0.0
var slip_max := 0.0
var yaw_sum := 0.0
var speed_sum := 0.0
var previous_lean := 0.0
var roll_peak := 0.0
var _walls := WallGrid.new()
var cases := [
	{"name": "circle 36", "speed": 10.0, "steer": 0.3},
	{"name": "circle 72", "speed": 20.0, "steer": 0.3},
	{"name": "circle 108", "speed": 30.0, "steer": 0.3},
	{"name": "slalom", "speed": 20.0, "steer": 0.3},
	{"name": "brake in bend", "speed": 20.0, "steer": 0.3},
	{"name": "reset circle", "speed": 20.0, "steer": 0.3},
]
var results: Array[Dictionary] = []


func walls() -> WallGrid:
	return _walls


func check(ok: bool, message: String) -> void:
	print(("ok: " if ok else "FAIL: ") + message)
	if not ok:
		failures += 1


func _ready() -> void:
	process_physics_priority = -100
	if Content.arg("ticks") != "":
		Engine.physics_ticks_per_second = int(Content.arg("ticks"))
	if Content.arg("case") != "":
		cases = cases.filter(func(c: Dictionary) -> bool: return c["name"] == Content.arg("case"))
	Settings.set_value("tyre_wear", 0.0)
	Settings.set_value("damage", false)
	_grip_tests()
	var tune := {"type": "motorcycle"}
	Tuning.set_value(tune, "corner_pedals_strength", 0.4)
	check(is_equal_approx(float(tune.get("extras", {}).get("corner_pedals_strength", -1.0)), 0.4), "pedal assistance strength is saved in tune")
	add_to_group("track")
	var ground := StaticBody3D.new()
	var collision := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = Vector3(4000, 1, 4000)
	collision.shape = shape
	collision.position.y = -0.5
	ground.add_child(collision)
	add_child(ground)
	var id := Content.arg("car") if Content.arg("car") != "" else "sports-motorcycle-600cc"
	var cfg: Dictionary = Content.load_json("cars/%s/car.json" % id)
	cfg.get_or_add("extras", {})["corner_pedals_on"] = false
	cfg["extras"]["wheelie_control_on"] = false
	car = WheelieProbe.new()
	car.setup(id, cfg)
	add_child(car)
	car.steer_direct = true
	_next()


func _grip_tests() -> void:
	var w := Car.Wheel.new()
	w.condition = 0.8
	w.damage_grip = 0.9
	for surface in ["road", "wet", "gravel"]:
		w.surface = surface
		for load: float in [300.0, 1200.0, 4000.0]:
			var cap := CarWear.capacity(w, load)
			w.slip_ratio = 0.14
			w.slip_tan = 0.0
			CarWear.tyre_force(w, load, Ground.surface(surface), 10.0, 1.0)
			check(absf(w.fx - cap.x) < 0.01, "%s %.0f N: envelope matches peak force" % [surface, load])
			check(CarWear.remaining_lateral(w, load, cap.x) < 0.01, "no lateral reserve at longitudinal limit")
			check(CarWear.remaining_longitudinal(w, load, cap.y) < 0.01, "no longitudinal reserve at lateral limit")
	check(CarWear.capacity(w, 0.0) == Vector2.ZERO, "unloaded tyre has no grip")


func _reset_tests() -> void:
	var bike := car.bike
	bike.lean = 0.5
	bike._lean_ref = 0.4
	bike.key_command = 0.6
	bike._corner_t = 0.8
	bike._air_time = 1.0
	bike._road = Vector3.RIGHT
	bike._force_hist = [[1.0, 50000.0]]
	bike.posture["assist"] = 0.3
	bike.last_crash = {"reason": "test"}
	bike.recover()
	var fresh := Motorcycle.new(car.config.get("motorcycle", {}))
	fresh.posture["assist"] = 0.0
	fresh.recover()
	for prop in fresh.get_property_list():
		if (int(prop["usage"]) & PROPERTY_USAGE_SCRIPT_VARIABLE) == 0:
			continue
		var key: String = prop["name"]
		if key in ["last_crash", "lean_from_bend", "fork_slope", "swing_slope"]:
			continue
		check(bike.get(key) == fresh.get(key), "reset matches fresh state: " + key)
	check(bike.last_crash.get("reason") == "test", "reset preserves crash report")
	bike.lean = 0.5
	car.speed = 20.0
	var raw := bike.corner_pedals(car, 0.7, 0.2, 0.01)
	check(raw == Vector2(0.7, 0.2), "disabled pedal assist passes inputs through")
	car.config["extras"]["corner_pedals_on"] = true
	car.config["extras"]["corner_pedals_strength"] = 0.0
	check(bike.corner_pedals(car, 0.7, 0.2, 0.01) == raw, "zero strength passes inputs through")
	car.config["extras"]["corner_pedals_strength"] = 1.0
	bike._corner_t = 0.8
	check(bike.corner_pedals(car, 0.0, 0.0, 0.01).x == 0.0, "gas release never adds throttle by default")
	car.config["extras"]["corner_pedals_on"] = false


func _next() -> void:
	scenario += 1
	if scenario >= cases.size():
		check(car.checked and car.preserved, "wheelie assist never overwrites transform or velocity")
		if results.size() == 6:
			check(absf(float(results[1]["lean"]) - float(results[5]["lean"])) < 2.0, "circle is repeatable after reset (within 2 degrees)")
		print("RESULT: %s (%d failures)" % ["ok" if failures == 0 else "FAILED", failures])
		get_tree().quit(0 if failures == 0 else 1)
		return
	_reset_tests()
	car.place(Vector3(0, car.wheels[0].radius + 0.05, 0), PI / 2.0)
	car.speed = float(cases[scenario]["speed"])
	car.linear_velocity = Vector3(0, 0, car.speed)
	for w in car.wheels:
		w.omega = car.speed / w.radius
	car.gear = 3
	car.engine.omega = car.speed / car.wheels[2].radius * car.gear_total()
	elapsed = 0.0
	samples = 0
	lean_sum = 0.0
	error_max = 0.0
	slip_max = 0.0
	yaw_sum = 0.0
	speed_sum = 0.0
	roll_peak = 0.0
	previous_lean = 0.0


func _physics_process(dt: float) -> void:
	if car == null or scenario >= cases.size():
		return
	elapsed += dt
	var test: Dictionary = cases[scenario]
	var speed: float = test["speed"]
	var steering: float = test["steer"]
	if test["name"] == "slalom" and elapsed > 4.0:
		steering = -steering
	car.steer_input = steering if elapsed > 1.0 else 0.0
	car.throttle_input = 0.0
	car.brake_input = 0.35 if test["name"] == "brake in bend" and elapsed > 5.0 else 0.0
	if car.brake_input == 0.0:
		car.apply_central_force(car.global_basis.z * car.mass * clampf((speed - car.speed) * 4.0, -5.0, 5.0))
	if elapsed > 3.0:
		samples += 1
		lean_sum += rad_to_deg(car.bike.lean)
		error_max = maxf(error_max, absf(rad_to_deg(car.bike.lean - car.bike.lean_ref())))
		if absf(car.speed) > 5.0:
			slip_max = maxf(slip_max, absf(rad_to_deg(atan2(car.linear_velocity.dot(car.global_basis.x), maxf(1.0, absf(car.speed))))))
		yaw_sum += car.angular_velocity.y
		speed_sum += car.speed
		roll_peak = maxf(roll_peak, absf(car.bike.lean - previous_lean) / dt)
	previous_lean = car.bike.lean
	if elapsed >= 8.0:
		var mean_lean := lean_sum / maxf(1.0, samples)
		var mean_yaw := yaw_sum / maxf(1.0, samples)
		var mean_speed := speed_sum / maxf(1.0, samples)
		var rider_offset := atan((car.bike.rider_mass / car.mass) * float(car.bike.posture["lat"]) / car.cg_height)
		var expected_yaw := 9.81 * tan(deg_to_rad(mean_lean) + rider_offset) / maxf(1.0, mean_speed)
		print("%s: lean %.2f deg, error %.2f deg, sideslip %.2f deg, yaw %.3f rad/s, radius %.1f m, roll rate %.2f rad/s" % [test["name"], mean_lean, error_max, slip_max, mean_yaw, mean_speed / maxf(0.001, absf(mean_yaw)), roll_peak])
		results.append({"lean": mean_lean})
		check(not car.bike.crashed, "%s stays upright (%s)" % [test["name"], car.bike.crash_reason])
		check(car.linear_velocity.is_finite() and car.global_position.is_finite(), "%s remains finite" % test["name"])
		check(slip_max < 20.0, "%s sideslip below 20 degrees" % test["name"])
		if test["name"].begins_with("circle"):
			check(mean_lean > 3.0 and mean_yaw > 0.01, "%s turns in the requested direction" % test["name"])
			check(absf(mean_yaw - expected_yaw) < maxf(0.03, absf(expected_yaw) * 0.35), "%s turn agrees with lean and speed" % test["name"])
			check(error_max < 15.0, "%s follows lean within 15 degrees" % test["name"])
		if test["name"] == "slalom":
			check(car.bike.lean < -0.05, "slalom changes lean direction")
		if test["name"] == "brake in bend":
			check(car.speed < speed - 2.0, "braking in bend reduces speed")
		_next()
