extends Node
## (a scene, for the autoloads) Driving with the keys (the --drive and --ai tests do not use them): the keys are
## pressed as a player does (Input.parse_input_event), and the steering of the browser game is checked (SteerModel:
## Car.js for the keys, controls.js for the stick): the rate at a standstill, slower at speed, the smaller lock at
## speed, the centring, the curve, the stick's "slower at speed"; and the actions of Settings, Controls that came
## from fixed keys (P and O of the free camera, 5 of a take).
##   Godot --headless --fixed-fps 60 --path godot res://tools/test_keys.tscn -- --user-dir=/tmp/x/u [--car=hatchback]

var world: World
var _fails := 0


func _check(ok: bool, what: String) -> void:
	print(("ok    " if ok else "FAIL  ") + what)
	if not ok:
		_fails += 1


func _ready() -> void:
	if Content.arg("user-dir") == "":
		push_error("test_keys: give --user-dir (nothing of a test goes into the player's data)")
		get_tree().quit(2)
		return
	Settings.reset()
	world = World.new()
	add_child(world)
	world.setup(Content.arg("car") if Content.arg("car") != "" else "hatchback", "testtrack", {"ghost": false, "records": false})
	_run.call_deferred()


## Waits the physics steps of so many seconds of the game (a timer counts the frames of --fixed-fps).
func _wait(seconds: float) -> void:
	for i in roundi(seconds * Engine.physics_ticks_per_second):
		await get_tree().physics_frame


func _key(code: Key, down: bool) -> void:
	var e := InputEventKey.new()
	e.physical_keycode = code
	e.keycode = code
	e.pressed = down
	Input.parse_input_event(e)


func _run() -> void:
	await _wait(2.0)
	var car := world.car
	var lock := car.max_steer
	# the actions that were fixed keys
	for a in [["free_cam_aim", KEY_P], ["free_cam_follow", KEY_O], ["take", KEY_5]]:
		var e := InputEventKey.new()
		e.physical_keycode = a[1]
		e.pressed = true
		_check(InputMap.event_is_action(e, a[0]), "%s is on %s (Settings, Controls)" % [a[0], OS.get_keycode_string(a[1])])
	var e2 := InputEventKey.new()
	e2.physical_keycode = KEY_P
	e2.pressed = true
	_check(InputMap.event_is_action(e2, "parking_brake"), "P is still the parking brake too")
	# a standstill: D for 0.3 s turns right at the lock in key_steer_time (0.9 s)
	_key(KEY_D, true)
	await _wait(0.3)
	var a1 := car.steer_angle
	var want := -lock * 0.3 / float(Settings.get_value("key_steer_time"))
	_check(a1 < 0.0 and absf(a1 - want) < 0.25 * absf(want), "D at a standstill: %.1f deg after 0.3 s (the browser %.1f)" % [rad_to_deg(a1), rad_to_deg(want)])
	_key(KEY_D, false)
	await _wait(0.3)
	_check(absf(car.steer_angle) < 0.05 * absf(a1), "let go: the wheels centre (%.2f deg)" % rad_to_deg(car.steer_angle))
	# W: the car drives off with the keys
	_key(KEY_W, true)
	await _wait(5.0)
	var v := car.speed
	_check(v > 7.0, "W drives: %.0f km/h after 5 s (the --drive test of the hatchback: 38)" % (v * 3.6))
	# A held: the car turns left
	_key(KEY_A, true)
	await _wait(0.5)
	_check(car.steer_angle > 0.02, "A turns left at %.0f km/h: %.1f deg" % [car.speed * 3.6, rad_to_deg(car.steer_angle)])
	# the curve of the steering: 2 makes the angle of a half-way key a quarter
	_key(KEY_A, false)
	_key(KEY_W, false)
	_key(KEY_S, true)
	await _wait(6.0)
	_key(KEY_S, false)
	await _wait(0.5)
	Settings.set_value("key_steer_curve", 2.0)
	_key(KEY_A, true)
	await _wait(0.3)
	var u2 := absf(car.speed)
	var raw := lock * 0.3 / float(Settings.get_value("key_steer_time")) / (1.0 + maxf(0.0, u2 / 4.0 - 1.0))
	var lock2 := lock * maxf(0.2, 1.0 / (1.0 + pow(u2 / 22.0, 2.0)))
	var curved := lock2 * pow(minf(1.0, raw / lock2), 2.0)
	_check(car.steer_angle < raw * 0.8 and absf(car.steer_angle - curved) < 0.3 * curved + 0.003,
		"the curve 2: %.1f deg where the raw angle is %.1f (the browser %.1f)" % [rad_to_deg(car.steer_angle), rad_to_deg(raw), rad_to_deg(curved)])
	_key(KEY_A, false)
	Settings.set_value("key_steer_curve", 1.0)
	# a key held at 90 km/h: slower (by 1 + (u / 4 - 1)) and no further than the lock of the speed (Car.js)
	# (the model alone, on the car held still: no assist, as the car may still slide)
	Settings.set_value("key_assist", false)
	Settings.set_value("pad_assist", false)
	car.freeze = true
	car.speed = 25.0
	var k := SteerModel.new()
	car.steer_angle = 0.0
	var k1 := 0.0
	for i in 12:
		k1 = k.keys(car, 1.0, 1.0 / 60.0)
		car.steer_angle = k1
	var want_k := lock / 0.9 / (1.0 + (25.0 / 4.0 - 1.0)) * 0.2
	_check(absf(k1 - want_k) < 0.02 * lock, "a key at 90 km/h: %.2f deg in 0.2 s (the browser %.2f)" % [rad_to_deg(k1), rad_to_deg(want_k)])
	for i in 300:
		k1 = k.keys(car, 1.0, 1.0 / 60.0)
		car.steer_angle = k1
	var lock_90 := lock * maxf(0.2, 1.0 / (1.0 + pow(25.0 / 22.0, 2.0)))
	_check(absf(k1 - lock_90) < 1e-3, "held: the lock of the speed %.1f deg (the browser %.1f, of %.1f)" % [rad_to_deg(k1), rad_to_deg(lock_90), rad_to_deg(lock)])
	await _wait(0.5)
	# the stick: one to one at a standstill, slower at speed (6 / (1 + pad_slow x speed / 10) rad/s out)
	var m := SteerModel.new()
	car.speed = 0.0
	car.steer_angle = 0.0
	var s0 := 0.0
	for i in 6:
		s0 = m.pad(car, 1.0, 1.0 / 60.0)
		car.steer_angle = s0
	_check(absf(s0 - minf(lock, 6.0 * 0.1)) < 0.02, "the stick at a standstill: %.1f deg in 0.1 s (6 rad/s)" % rad_to_deg(s0))
	Settings.set_value("pad_slow", 1.5)
	var fast := SteerModel.new()
	car.speed = 20.0
	car.steer_angle = 0.0
	var s1 := 0.0
	for i in 6:
		s1 = fast.pad(car, 1.0, 1.0 / 60.0)
		car.steer_angle = s1
	var rate := 6.0 / (1.0 + 1.5 * 20.0 / 10.0)
	car.freeze = false
	_check(absf(s1 - rate * 0.1) < 0.01, "the stick at 72 km/h, slower at speed 1.5: %.2f deg in 0.1 s (the browser %.2f)" % [rad_to_deg(s1), rad_to_deg(rate * 0.1)])
	# the take: its key (5) asks for the picture of the take
	if world.take != null:
		_key(KEY_5, true)
		await _wait(0.2)
		_key(KEY_5, false)
		_check(world.take.state() == "asking", "5: the take asks (%s)" % world.take.state())
	print("FAILS %d" % _fails)
	get_tree().quit(1 if _fails > 0 else 0)
