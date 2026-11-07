extends Node
## (run as a scene, so that the autoloads are there: Godot --path godot res://tools/test_controls.tscn)
## Tests the bindings (Controls): a binding set, the same input taken from the other action, a binding removed,
## the defaults back; and the menu takes an input (a key) for an action. The player's own bindings are put back.


func _ready() -> void:
	var controls: Node = get_node("/root/Controls")
	var settings: Node = get_node("/root/Settings")
	var kept: Variant = settings.get_value("controls")
	# (whatever happens, the player's bindings come back, and the test ends)
	get_tree().create_timer(20.0).timeout.connect(func():
		settings.set_value("controls", kept)
		get_tree().quit())
	await get_tree().process_frame
	controls.reset_defaults()
	print("camera: ", _names(controls, "camera"))
	# R (reset) on the camera: it is taken from reset
	controls.set_binding("camera", 0, {"type": "key", "code": KEY_R})
	print("camera after R: ", _names(controls, "camera"), "   reset: ", _names(controls, "reset"))
	print("R works camera: ", _works("camera", KEY_R), "  R works reset: ", _works("reset", KEY_R))
	# a wheel button on the camera
	controls.set_binding("camera", 2, {"type": "wheel_button", "button": 7})
	print("wheel buttons: ", get_node("/root/WheelInput").button_actions)
	# the menu: the + of shift_up, then the key T
	var menu := SettingsMenu.new()
	add_child(menu)
	await get_tree().process_frame
	menu._capture("shift_up", controls.bindings("shift_up").size())
	var e := InputEventKey.new()
	e.physical_keycode = KEY_T
	e.pressed = true
	menu._input(e)
	print("shift_up after the menu took T: ", _names(controls, "shift_up"))
	controls.clear_binding("shift_up", 0)
	print("shift_up after removing the first: ", _names(controls, "shift_up"))
	controls.reset_defaults()
	print("defaults again: camera ", _names(controls, "camera"), "  reset ", _names(controls, "reset"))
	settings.set_value("controls", kept)
	get_tree().quit()


func _names(controls: Node, action: String) -> Array:
	return controls.bindings(action).map(func(b): return controls.describe(b))


func _works(action: String, key: Key) -> bool:
	var e := InputEventKey.new()
	e.physical_keycode = key
	e.pressed = true
	return InputMap.event_is_action(e, action)
