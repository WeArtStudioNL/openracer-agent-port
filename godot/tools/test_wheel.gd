extends SceneTree
## Runs the wheel calibration with made-up input on joypad 0 (axis 0 steering, axis 5 throttle, axis 4 brake,
## button 5 / 4 the paddles), checks what it found and how the wheel reads after it, and removes the profile again.

var w: Node
var _texts := []


func _move(axis: int, value: float) -> void:
	w.fake[axis] = value


func _button(b: int, down: bool) -> void:
	w.fake["b%d" % b] = down


func _hold(seconds: float) -> void:
	var end := Time.get_ticks_msec() + int(seconds * 1000)
	while Time.get_ticks_msec() < end:
		await process_frame


func _init() -> void:
	await process_frame
	w = root.get_node("/root/WheelInput")
	w.fake = {"test": true}
	var settings: Node = root.get_node("/root/Settings")
	w.calibration_text.connect(func(t): _texts.append(t))
	var kept: Dictionary = settings.profile(w.guid)     # (the real profile of the wheel, put back at the end)
	w.calibrate()
	# slowly to the left, with pauses on the way (they must not end the step), then full lock
	for v in [-0.3, -0.6, -0.8, -1.0]:
		_move(0, v)
		await _hold(1.0)
	print("after left: ", w._new_profile, "  releasing: ", w._release_left > 0.0)
	# still at the left lock while the release runs; then the wheel back in the middle
	await _hold(1.0)
	_move(0, 0.0)
	await _hold(2.5)
	print("after the release, step %d (expect 1)" % w._step)
	for v in [-0.5, 0.0, 0.4, 0.7, 1.0]:
		_move(0, v)
		await _hold(1.0)
	_move(0, 0.0)
	await _hold(3.2)
	print("after right and its release: step %d (expect 2)" % w._step)
	# the throttle slowly down; then let go while the brake step starts
	for v in [0.4, 1.0]:
		_move(5, v)
		await _hold(1.0)
	_move(5, 0.0)
	# a brake that does not reach the end of its axis: taken after holding it still
	_move(4, 0.7)
	await _hold(3.0)
	_move(4, 0.0)
	await _hold(0.1)
	w.skip()
	for b in [5, 4]:
		await _hold(0.1)
		_button(b, true)
		await _hold(0.1)
		_button(b, false)
	await _hold(0.2)
	print("texts: ", _texts.size(), "  last: '", _texts[-1], "'")
	print("profile: ", settings.profile(w.guid))
	var on_wheel := 0
	for action in ["reset", "restart", "shift_down", "camera", "steer_left"]:
		for e in InputMap.action_get_events(action):
			if (e is InputEventJoypadButton or e is InputEventJoypadMotion) and (e.device == w.device or e.device == -1):
				on_wheel += 1
	print("gamepad bindings that reach the wheel: %d (expect 0)" % on_wheel)
	_move(0, -0.45)
	_move(5, 0.5)
	await _hold(0.2)
	print("steer %.2f (expect about 0.5)  throttle %.2f (expect 0.5)  active %s" % [w.steer, w.throttle, w.active])
	settings.set_profile(w.guid, kept)
	quit()
