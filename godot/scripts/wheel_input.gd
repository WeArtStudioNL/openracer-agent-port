extends Node
## A racing wheel (steering, pedals, paddles), after web/js/WheelControls.js. Wheels report themselves as joypads
## whose axes and buttons differ per device, so they are not guessed: a calibration (K while driving, or the
## settings) asks to turn the wheel and press the pedals, finds the axis that moves most for each, and keeps what
## it found per device (Settings profiles, by guid).
##
## The state: active (a calibrated wheel is there), steer (-1 right .. 1 left, the whole lock), throttle, brake,
## clutch (0..1), and the shift buttons as the actions shift_up / shift_down.

signal calibration_text(text: String)        # what the calibration asks now ("" when it is done)

const STEPS := [
	{"id": "steer_left", "kind": "axis", "text": "Turn the wheel fully LEFT and hold it"},
	{"id": "steer_right", "kind": "axis", "text": "Turn the wheel fully RIGHT and hold it"},
	{"id": "throttle", "kind": "axis", "text": "Press the THROTTLE pedal fully"},
	{"id": "brake", "kind": "axis", "text": "Press the BRAKE pedal fully"},
	{"id": "clutch", "kind": "axis", "optional": true, "text": "Press the CLUTCH pedal fully"},
	{"id": "shift_up", "kind": "button", "optional": true, "text": "Press SHIFT UP (paddle or button)"},
	{"id": "shift_down", "kind": "button", "optional": true, "text": "Press SHIFT DOWN (paddle or button)"},
]
const AXES := 10
const HOLD := 0.5             # s that the end of an axis has to be held
const HOLD_LONG := 2.5        # s held still anywhere that also counts (an axis that does not reach its end)

var device := -1
var guid := ""
var wheel_name := ""
var active := false
var steer := 0.0
var throttle := 0.0
var brake := 0.0
var clutch := 0.0
var calibrating := false
var fake := {}                    # (the tests: axis -> value, "b<n>" -> pressed, instead of the device)

var _profile := {}
var _step := 0
var _rest: PackedFloat32Array = []
var _best_axis := -1
var _best_value := 0.0
var _extreme := 0.0
var _step_text := ""
var _held := 0.0
var _new_profile := {}
var _buttons_before := {}
var _was_up := false
var _was_down := false


func _ready() -> void:
	Input.joy_connection_changed.connect(func(_d: int, _c: bool): _pick())
	_pick()


## The device to use: the first joypad with a calibrated profile, else the first that looks like a wheel.
func _pick() -> void:
	device = -1
	active = false
	var pads := Input.get_connected_joypads()
	for d in pads:
		if not Settings.profile(Input.get_joy_guid(d)).is_empty():
			device = d
			break
	if device < 0:
		for d in pads:
			if Input.get_joy_name(d).to_lower().contains("wheel") or Input.get_joy_name(d).to_lower().contains("racing"):
				device = d
				break
	if device >= 0:
		guid = Input.get_joy_guid(device)
		wheel_name = Input.get_joy_name(device)
		_profile = Settings.profile(guid)
		active = not _profile.is_empty()
		RunLog.event("wheel %s (%s) %s" % [wheel_name, guid, "calibrated" if active else "not calibrated: press K"])


## Starts the calibration on the wheel (or on the first joypad).
func calibrate() -> void:
	var pads := Input.get_connected_joypads()
	if device < 0 and not pads.is_empty():
		device = pads[0]
		guid = Input.get_joy_guid(device)
		wheel_name = Input.get_joy_name(device)
	if device < 0:
		calibration_text.emit("No wheel or joypad is connected")
		return
	calibrating = true
	_new_profile = {}
	# where every axis rests, once, at the start (the wheel in the middle, the pedals up): a pedal that is let go after
	# its step must not be taken for the next one
	_rest.resize(AXES)
	for a in AXES:
		_rest[a] = _axis(a)
	_start_step(0)
	RunLog.event("calibration of %s started" % wheel_name)


func cancel() -> void:
	if calibrating:
		calibrating = false
		calibration_text.emit("")
		RunLog.event("calibration cancelled")


func skip() -> void:
	if calibrating and STEPS[_step].get("optional", false):
		_next()


func _start_step(i: int) -> void:
	_step = i
	_buttons_before = {}
	for b in 128:
		_buttons_before[b] = _pressed(b)
	_best_axis = -1
	_held = 0.0
	var s: Dictionary = STEPS[_step]
	_step_text = "Wheel calibration %d/%d: %s%s   [Esc] cancel" % [_step + 1, STEPS.size(), s["text"], "   [N] skip" if s.get("optional", false) else ""]
	calibration_text.emit(_step_text)


func _next() -> void:
	if _step + 1 >= STEPS.size():
		_finish()
		return
	_start_step(_step + 1)


func _process(delta: float) -> void:
	if device < 0:
		return
	if calibrating:
		_calibration_step(delta)
		return
	if not active:
		return
	var p := _profile
	if p.has("steer_axis"):
		var raw := _axis(int(p["steer_axis"]))
		var mid := (float(p["steer_left"]) + float(p["steer_right"])) / 2.0
		var half := (float(p["steer_left"]) - float(p["steer_right"])) / 2.0
		var s := (raw - mid) / half if absf(half) > 0.01 else 0.0           # 1 at the left stop, -1 at the right
		# the range: the part of the turn of the wheel that is the lock; the dead zone round the middle
		s /= maxf(0.1, float(Settings.get_value("wheel_range")))
		var dz := float(Settings.get_value("wheel_deadzone")) / 100.0
		s = signf(s) * maxf(0.0, absf(s) - dz) / (1.0 - dz)
		steer = s
	throttle = _pedal(p.get("throttle", {}))
	brake = _pedal(p.get("brake", {}))
	clutch = _pedal(p.get("clutch", {}))
	_press("shift_up", int(p.get("shift_up", -1)))
	_press("shift_down", int(p.get("shift_down", -1)))


func _pedal(a: Dictionary) -> float:
	if a.is_empty():
		return 0.0
	var raw := _axis(int(a["axis"]))
	var span := float(a["full"]) - float(a["rest"])
	return clampf((raw - float(a["rest"])) / span, 0.0, 1.0) if absf(span) > 0.05 else 0.0


## A paddle as the shift action, once per press.
func _press(action: String, button: int) -> void:
	if button < 0:
		return
	var down := _pressed(button)
	var was := _was_up if action == "shift_up" else _was_down
	if down and not was:
		var e := InputEventAction.new()
		e.action = action
		e.pressed = true
		Input.parse_input_event(e)
	if action == "shift_up":
		_was_up = down
	else:
		_was_down = down


func _calibration_step(delta: float) -> void:
	var s: Dictionary = STEPS[_step]
	if s["kind"] == "button":
		for b in 128:
			if _pressed(b) and not _buttons_before.get(b, false):
				_new_profile[s["id"]] = b
				_next()
				return
		return
	# the axis that moved most from where it rested at the start; for the right turn: the steering axis, once it is
	# past the middle, on the other side of the left turn by half of it at least
	var axis := -1
	var most := 0.0
	var used := _used_axes()
	if s["id"] == "steer_right":
		axis = int(_new_profile["steer_axis"])
		var left := float(_new_profile["steer_left"]) - _rest[axis]
		var now_d := _axis(axis) - _rest[axis]
		most = absf(now_d) if now_d * left < 0.0 and absf(now_d) > absf(left) / 2.0 else 0.0
	else:
		for a in AXES:
			if used.has(a):
				continue
			var d := absf(_axis(a) - _rest[a])
			if d > most:
				most = d
				axis = a
	if most < 0.3:
		_held = 0.0
		_best_axis = -1
		_show_live(-1, 0.0)
		return
	var value := _axis(axis)
	if axis != _best_axis:
		_best_axis = axis
		_extreme = value
		_held = 0.0
	# the end of the travel: the furthest it got from rest
	if absf(value - _rest[axis]) > absf(_extreme - _rest[axis]):
		_extreme = value
	if absf(value - _best_value) < 0.02:
		_held += delta
	else:
		_held = 0.0
	_best_value = value
	_show_live(axis, value)
	# accepted at the end of the range of the axis (a wheel at full lock, a pedal down, held a moment), or when it
	# is held still for long (a wheel or a pedal that does not reach the end of its axis)
	var at_end := absf(value) >= 0.95 and absf(value - _extreme) < 0.03
	if not ((at_end and _held >= HOLD) or _held >= HOLD_LONG):
		return
	match s["id"]:
		"steer_left":
			_new_profile["steer_axis"] = axis
			_new_profile["steer_left"] = _extreme
		"steer_right":
			_new_profile["steer_right"] = _extreme
		_:
			_new_profile[s["id"]] = {"axis": axis, "rest": _rest[axis], "full": _extreme}
	RunLog.event("calibration %s: axis %d, rest %.3f, end %.3f" % [s["id"], axis, _rest[axis], _extreme])
	_next()


## The end of the calibration: with force feedback, a short push finds which way a positive force turns this
## wheel (it differs per wheel), and the profile keeps it.
func _finish() -> void:
	# (from here the wheel is read with the new profile, and the steps are over)
	_profile = _new_profile
	calibrating = false
	active = true
	if ForceFeedback.is_open() and fake.is_empty():
		calibration_text.emit("Let go of the wheel: the force feedback is tested")
		await get_tree().create_timer(1.2, true).timeout
		var before := steer
		ForceFeedback.ffb.set_force(0.25)
		await get_tree().create_timer(0.35, true).timeout
		var moved := steer - before
		ForceFeedback.ffb.set_force(0.0)
		# a positive force should turn the wheel to the right (steer goes down)
		_new_profile["ffb_sign"] = -1.0 if moved > 0.02 else 1.0
		RunLog.event("force feedback direction: the wheel moved %+.3f under +0.25 -> sign %+d" % [moved, int(_new_profile["ffb_sign"])])
	Settings.set_profile(guid, _new_profile)
	_profile = _new_profile
	active = true
	calibration_text.emit("")
	RunLog.event("calibration done: %s" % [_new_profile])


## The sign of the force for this wheel (from the calibration).
func ffb_sign() -> float:
	return float(_profile.get("ffb_sign", 1.0))


## The step, with where the axis is now (so a slow turn can be seen going).
func _show_live(axis: int, value: float) -> void:
	if axis < 0:
		calibration_text.emit(_step_text)
	else:
		calibration_text.emit("%s\naxis %d: %+.2f%s" % [_step_text, axis, value, "  hold it there" if absf(value) >= 0.95 else ""])


## The axes that earlier steps took.
func _used_axes() -> Array:
	var used := []
	if _new_profile.has("steer_axis"):
		used.append(int(_new_profile["steer_axis"]))
	for k in ["throttle", "brake", "clutch"]:
		if _new_profile.has(k):
			used.append(int(_new_profile[k]["axis"]))
	return used


func _axis(a: int) -> float:
	return float(fake.get(a, 0.0)) if not fake.is_empty() else Input.get_joy_axis(device, a)


func _pressed(b: int) -> bool:
	return bool(fake.get("b%d" % b, false)) if not fake.is_empty() else Input.is_joy_button_pressed(device, b)


## How far the wheel is turned, as a part of the lock (for the hard stop of the force feedback).
func position() -> float:
	return steer
