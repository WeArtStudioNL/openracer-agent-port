extends Node
## (Godot --headless --path godot res://tools/test_settings_menu.tscn -- --user-dir=/tmp/folder)
## The settings menu with a gamepad (PadNav.js): R1 and L1 change the tab, left and right change a list that has the
## focus, B closes the menu. Every tab is built without an error.


func _ready() -> void:
	var menu := SettingsMenu.new()
	var closed := [false]
	menu.closed.connect(func(): closed[0] = true)
	add_child(menu)
	await get_tree().process_frame
	await get_tree().process_frame
	var tabs: TabContainer = menu._tabs
	print("tabs: ", range(tabs.get_tab_count()).map(func(i): return tabs.get_tab_title(i)))
	tabs.current_tab = 0
	var before := tabs.current_tab
	_pad(JOY_BUTTON_RIGHT_SHOULDER)
	await get_tree().process_frame
	print("R1: tab %d -> %d (%s)" % [before, tabs.current_tab, tabs.get_tab_title(tabs.current_tab)])
	_pad(JOY_BUTTON_LEFT_SHOULDER)
	_pad(JOY_BUTTON_LEFT_SHOULDER)
	await get_tree().process_frame
	print("L1 L1: tab %d (%s)" % [tabs.current_tab, tabs.get_tab_title(tabs.current_tab)])
	tabs.current_tab = 0
	await get_tree().process_frame
	var opt: OptionButton = tabs.get_current_tab_control().find_children("*", "OptionButton", true, false)[0]
	opt.grab_focus()
	var was := opt.selected
	_pad(JOY_BUTTON_DPAD_RIGHT)
	await get_tree().process_frame
	print("D-pad right on a list: %d -> %d" % [was, opt.selected])
	_pad(JOY_BUTTON_DPAD_LEFT)
	await get_tree().process_frame
	print("D-pad left: %d" % opt.selected)
	_pad(JOY_BUTTON_B)
	await get_tree().process_frame
	print("B closed the menu: ", closed[0])
	get_tree().quit()


func _pad(button: JoyButton) -> void:
	for pressed in [true, false]:
		var e := InputEventJoypadButton.new()
		e.button_index = button
		e.pressed = pressed
		e.device = 0
		Input.parse_input_event(e)
