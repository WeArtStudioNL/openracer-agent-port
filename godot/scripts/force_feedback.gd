extends Node
## The force feedback on a racing wheel (web/js/ForceFeedback.js): the torque that the driver would feel, from the
## physics every physics step (the aligning torque of the front tyres, which goes light when they slide, the bumps
## of the road, the rumble of loose ground, the slide of the front tyres, the pulses of the ABS, the jolt of a
## knock, the hard stop at the lock), sent to the wheel by WheelForce (native/src/wheel_force.cpp, HID PID).

var ffb: Object = null              # WheelForce
var status := "No force feedback wheel"
var _phase := 0.0
var _noise := 0.0
var _impact := 0.0
var _output := 0.0
var _last_steer := 0.0
var _steer_rate := 0.0
var _test_until := 0


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	Input.joy_connection_changed.connect(func(_d: int, _c: bool): _open.call_deferred())
	_open.call_deferred()


func _open() -> void:
	if not ClassDB.class_exists("WheelForce"):
		status = "Force feedback: the native part is not built"
		return
	if ffb == null:
		ffb = ClassDB.instantiate("WheelForce")
	if ffb.is_open():
		return
	for d in Input.get_connected_joypads():
		var info := Input.get_joy_info(d)
		var vid := int(info.get("vendor_id", 0))
		var pid := int(info.get("product_id", 0))
		if vid == 0:
			continue
		var why: String = ffb.open(vid, pid)
		for line in ffb.take_log():
			RunLog.line("FFB " + line)
		if why == "":
			status = "Force feedback: %s (HID PID%s%s)" % [ffb.device_name(), ", spring" if ffb.has_spring() else "", ", damper" if ffb.has_damper() else ""]
			RunLog.event(status)
			return
		RunLog.line("FFB %s: %s" % [Input.get_joy_name(d), why])
	status = "No force feedback wheel"


func is_open() -> bool:
	return ffb != null and ffb.is_open()


## The wheel let go: no force (the menu, a pause).
func neutral() -> void:
	_output = 0.0
	if is_open() and Time.get_ticks_msec() >= _test_until:
		ffb.set_force(0.0)


## Shakes the wheel for two seconds (the settings).
func test() -> void:
	_test_until = Time.get_ticks_msec() + 2000
	RunLog.event("force feedback test")


func _process(_delta: float) -> void:
	if is_open() and Time.get_ticks_msec() < _test_until:
		ffb.set_force(0.6 * sin(Time.get_ticks_msec() / 1000.0 * TAU * 1.5))


## A knock of this size (m/s of the change of speed): a jolt that dies away.
func knock(dv: float) -> void:
	_impact = clampf(dv / 8.0, 0.3, 1.0) * (1.0 if randf() < 0.5 else -1.0)


## Every physics step while the car drives. wheel_stop: how far the wheel is turned as a part of the lock of the car.
func update(car: Car, dt: float, wheel_stop: float) -> void:
	if not is_open() or Time.get_ticks_msec() < _test_until:
		return
	if not Settings.get_value("ffb"):
		ffb.set_force(0.0)
		return
	var strength := float(Settings.get_value("ffb_strength"))
	var road := float(Settings.get_value("ffb_road"))
	var torque := _compute(car, dt, strength, road, wheel_stop)
	var steer := car.steer_angle / maxf(0.05, car.max_steer)
	var speed := absf(car.speed)
	var speed_factor := 0.4 + 0.6 * clampf(speed / 25.0, 0.0, 1.0)
	var spring := float(Settings.get_value("ffb_spring"))
	var damping := float(Settings.get_value("ffb_damping"))
	# a centring spring when the wheel cannot make one, and damping that grows with the speed (the torque comes a
	# frame late: a wheel let go at speed would swing to and fro on the aligning torque)
	if not ffb.has_spring():
		torque -= spring * steer
	var rate := (steer - _last_steer) / dt if dt > 0.0 else 0.0
	_last_steer = steer
	_steer_rate += (rate - _steer_rate) * minf(1.0, dt / 0.02)
	torque -= damping * speed_factor * clampf(_steer_rate * 0.12, -0.7, 0.7)
	torque *= WheelInput.ffb_sign()
	if Settings.get_value("ffb_invert"):
		torque = -torque
	_output += (torque - _output) * minf(1.0, dt / (0.03 + 0.03 * clampf(speed / 30.0, 0.0, 1.0)))
	ffb.set_force(clampf(_output, -1.0, 1.0))
	ffb.set_spring(spring)
	ffb.set_damper(roundf(damping * speed_factor * 20.0) / 20.0)


## The torque in -1..1 (positive turns the wheel to the right).
func _compute(car: Car, dt: float, strength: float, road: float, stop: float) -> float:
	var w := car.wheels
	var front_weight := car.mass * Car.G * car.weight_front
	# the aligning torque: the side force of the front tyres on the trail of the steering, which shrinks as the slip
	# angle grows (the pneumatic trail collapses before the grip does): the wheel goes light in understeer
	var fy := 0.0
	for t in 2:
		var trail := clampf(1.0 - (w[t].s - 0.6) / 1.2, 0.12, 1.0)
		fy += w[t].fy * trail
	var aligning := clampf(fy / (0.75 * front_weight), -1.5, 1.5)
	var speed := absf(car.speed)
	aligning *= clampf(speed / 3.0, 0.0, 1.0)
	var torque := aligning * strength
	# the vibrations: bumps, loose ground, the slide of the front tyres, the ABS
	var bump := 0.0
	var rough := false
	var slide := 0.0
	var abs_on := false
	for i in 2:
		var wheel := w[i]
		if not wheel.contact:
			continue
		bump = maxf(bump, absf(wheel.comp_rate))
		if Content.surface(wheel.surface).get("loose", false):
			rough = true
		if wheel.s > 1.2 and speed > 3.0:
			slide = maxf(slide, clampf((wheel.s - 1.2) / 1.5, 0.0, 1.0))
		if wheel.abs_factor < 0.99:
			abs_on = true
	_phase += dt
	_noise += (randf() * 2.0 - 1.0 - _noise) * minf(1.0, dt * 40.0)
	var detail := 0.0
	if bump > 0.15:
		detail += clampf((bump - 0.15) / 1.5, 0.0, 0.6) * sin(_phase * TAU * 22.0)
	if rough and speed > 2.0:
		detail += 0.25 * clampf(speed / 15.0, 0.2, 1.0) * _noise
	if slide > 0.0:
		detail += 0.18 * slide * sin(_phase * TAU * 27.0)
	if abs_on:
		detail += 0.2 * signf(sin(_phase * TAU * 14.0))
	torque += detail * road
	if absf(_impact) > 0.01:
		torque += _impact * sin(_phase * TAU * 9.0)
		_impact *= exp(-dt * 7.0)
	# the hard stop past the lock of the car: the wheel is pushed back with all the force
	if absf(stop) > 0.97:
		var wall := clampf((absf(stop) - 0.97) / 0.06, 0.0, 1.0)
		# (stop is + to the left; the torque + turns the wheel to the right)
		torque = torque * (1.0 - wall) + signf(stop) * wall
	# the engine shakes the wheel a little at idle
	if speed < 1.0:
		torque += 0.02 * road * sin(_phase * TAU * car.engine.rpm() / 60.0)
	return clampf(torque, -1.0, 1.0)
