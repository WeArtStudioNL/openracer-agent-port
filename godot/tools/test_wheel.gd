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
	w.calibrate()
	for step in [[0, -0.9], [0, 0.95], [5, 1.0], [4, 0.8], ["skip"], [5, "button"], [4, "button"]]:
		await _hold(0.1)
		if step[0] is String:
			w.skip()
		elif step[1] is String:
			_button(step[0], true)
			await _hold(0.1)
			_button(step[0], false)
		else:
			_move(step[0], step[1])
			await _hold(1.0)
			_move(step[0], 0.0)
	await _hold(0.2)
	print("texts: ", _texts.size(), "  last: '", _texts[-1], "'")
	print("profile: ", settings.profile(w.guid))
	_move(0, -0.45)
	_move(5, 0.5)
	await _hold(0.2)
	print("steer %.2f (expect about 0.5)  throttle %.2f (expect 0.5)  active %s" % [w.steer, w.throttle, w.active])
	settings.set_profile(w.guid, {})
	quit()
