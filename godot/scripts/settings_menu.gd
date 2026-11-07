class_name SettingsMenu
extends PanelContainer
## The settings: sound, driving, keyboard, racing wheel and force feedback (Settings), with the calibration and the
## test of the force feedback. Used by the main menu and the pause menu.

signal closed

var _wheel_status: Label
var _controls_page: VBoxContainer
var _capture_label: Label
var _capture_action := ""            # the action that waits for an input ("" when none)
var _capture_index := 0


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	custom_minimum_size = Vector2(620, 0)
	var margin := MarginContainer.new()
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 20)
	add_child(margin)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 8)
	margin.add_child(box)
	var title := Label.new()
	title.text = "Settings"
	title.add_theme_font_size_override("font_size", 28)
	box.add_child(title)
	var tabs := TabContainer.new()
	tabs.custom_minimum_size = Vector2(600, 430)
	box.add_child(tabs)

	var sound := _page(tabs, "Sound")
	_slider(sound, "Engine volume", "volume", 0.0, 1.5, 0.05, true)
	_slider(sound, "Tyre volume", "tyre_volume", 0.0, 1.5, 0.05, true)

	var driving := _page(tabs, "Driving")
	_check(driving, "ABS", "abs")
	_check(driving, "Traction control", "tc")
	_check(driving, "Stability control", "esc")
	_check(driving, "Launch control (brake and full throttle at a standstill, let go of the brake)", "launch_control")
	_slider(driving, "Tyre temperature and wear (0: off)", "tyre_wear", 0.0, 5.0, 0.5, false)
	_check(driving, "Damage: the cars dent and lose parts (from the next start of a drive)", "damage")
	_check(driving, "Hold the brake at a standstill for reverse", "auto_reverse")
	_slider(driving, "Keys: steering speed", "key_steer_speed", 0.4, 2.0, 0.1, true)
	_slider(driving, "Keys: less steering at speed", "key_steer_at_speed", 0.0, 1.5, 0.1, true)

	var wheel := _page(tabs, "Wheel")
	_wheel_status = Label.new()
	_wheel_status.autowrap_mode = TextServer.AUTOWRAP_WORD
	wheel.add_child(_wheel_status)
	var row := HBoxContainer.new()
	var cal := Button.new()
	cal.text = "Calibrate the wheel (K)"
	cal.pressed.connect(func():
		closed.emit()
		WheelInput.calibrate())
	row.add_child(cal)
	var test := Button.new()
	test.text = "Test force feedback"
	test.pressed.connect(ForceFeedback.test)
	row.add_child(test)
	wheel.add_child(row)
	_slider(wheel, "Wheel rotation (degrees, lock to lock)", "wheel_degrees", 180, 1080, 10, false)
	_check(wheel, "Turn as far as the steering wheel of the car", "wheel_match")
	_slider(wheel, "Steering range", "wheel_range", 0.3, 1.0, 0.05, true)
	_slider(wheel, "Dead zone (%)", "wheel_deadzone", 0.0, 10.0, 0.5, false)
	_check(wheel, "Force feedback", "ffb")
	_slider(wheel, "Strength", "ffb_strength", 0.0, 1.5, 0.05, true)
	_slider(wheel, "Centring spring", "ffb_spring", 0.0, 1.0, 0.05, true)
	_slider(wheel, "Damping", "ffb_damping", 0.0, 1.0, 0.05, true)
	_slider(wheel, "Road detail", "ffb_road", 0.0, 1.5, 0.05, true)
	_check(wheel, "Reverse the force", "ffb_invert")

	_controls_page = _page(tabs, "Controls")
	if Content.arg("settings-tab") != "":
		tabs.set_deferred("current_tab", int(Content.arg("settings-tab")))      # (the screenshots of the tests)
	_build_controls()
	Controls.changed.connect(_build_controls)

	_capture_label = Label.new()
	_capture_label.add_theme_color_override("font_color", Color(1, 0.8, 0.3))
	_capture_label.autowrap_mode = TextServer.AUTOWRAP_WORD
	box.add_child(_capture_label)

	var done := Button.new()
	done.text = "Done"
	done.custom_minimum_size.y = 40
	done.pressed.connect(func(): closed.emit())
	box.add_child(done)
	done.grab_focus.call_deferred()


func _process(_delta: float) -> void:
	if _wheel_status == null:
		return
	var w := "No wheel or joypad connected"
	if WheelInput.device >= 0:
		w = "%s: %s" % [WheelInput.wheel_name, "calibrated" if WheelInput.active else "not calibrated yet"]
	_wheel_status.text = "%s\n%s" % [w, ForceFeedback.status]


## Every action with what works it: a button per binding (click: a new one in its place) and + (add one).
func _build_controls() -> void:
	for c in _controls_page.get_children():
		c.queue_free()
	var note := Label.new()
	note.text = ("Click a binding and press a key, a button or a stick of a gamepad, or a button of the wheel. + adds one. "
		+ "The steering and the pedals of a wheel are set with its calibration (Wheel tab).")
	note.autowrap_mode = TextServer.AUTOWRAP_WORD
	note.modulate.a = 0.75
	_controls_page.add_child(note)
	for a in Controls.ACTIONS:
		var action: String = a[0]
		var row := HBoxContainer.new()
		var l := Label.new()
		l.text = a[1]
		l.custom_minimum_size.x = 210
		row.add_child(l)
		var list: Array = Controls.bindings(action)
		for i in list.size():
			var b := Button.new()
			b.text = Controls.describe(list[i])
			b.pressed.connect(_capture.bind(action, i))
			row.add_child(b)
		var add := Button.new()
		add.text = "+"
		add.tooltip_text = "Add a binding"
		add.pressed.connect(_capture.bind(action, list.size()))
		row.add_child(add)
		_controls_page.add_child(row)
	var reset := Button.new()
	reset.text = "Reset all to the defaults"
	reset.pressed.connect(Controls.reset_defaults)
	_controls_page.add_child(reset)


func _capture(action: String, index: int) -> void:
	_capture_action = action
	_capture_index = index
	var name_text := ""
	for a in Controls.ACTIONS:
		if a[0] == action:
			name_text = a[1]
	_capture_label.text = "%s: press a key, a gamepad button or stick, or a wheel button  (Esc: cancel, Delete: remove this one)" % name_text


## While a binding waits for an input, every input goes here (and to nothing else).
func _input(event: InputEvent) -> void:
	if _capture_action == "":
		return
	if event is InputEventKey and event.pressed and event.physical_keycode == KEY_ESCAPE:
		_end_capture()
		get_viewport().set_input_as_handled()
		return
	if event is InputEventKey and event.pressed and event.physical_keycode == KEY_DELETE:
		Controls.clear_binding(_capture_action, _capture_index)
		_end_capture()
		get_viewport().set_input_as_handled()
		return
	var b: Variant = Controls.binding_of(event)
	if b == null:
		if event is InputEventKey or event is InputEventJoypadButton or event is InputEventJoypadMotion:
			get_viewport().set_input_as_handled()
		return
	RunLog.event("binding %s %d = %s" % [_capture_action, _capture_index, Controls.describe(b)])
	Controls.set_binding(_capture_action, _capture_index, b)
	_end_capture()
	get_viewport().set_input_as_handled()


func _end_capture() -> void:
	_capture_action = ""
	_capture_label.text = ""


func _page(tabs: TabContainer, name_text: String) -> VBoxContainer:
	var scroll := ScrollContainer.new()
	scroll.name = name_text
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	var page := VBoxContainer.new()
	page.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	page.add_theme_constant_override("separation", 6)
	scroll.add_child(page)
	tabs.add_child(scroll)
	return page


func _slider(page: VBoxContainer, text: String, key: String, lo: float, hi: float, step: float, percent: bool) -> void:
	var row := HBoxContainer.new()
	var label := Label.new()
	label.text = text
	label.custom_minimum_size.x = 300
	row.add_child(label)
	var slider := HSlider.new()
	slider.min_value = lo
	slider.max_value = hi
	slider.step = step
	slider.value = float(Settings.get_value(key))
	slider.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	slider.custom_minimum_size.x = 180
	row.add_child(slider)
	var value := Label.new()
	value.custom_minimum_size.x = 64
	var show := func(v: float) -> void: value.text = "%d%%" % roundi(v * 100) if percent else str(snappedf(v, step))
	show.call(slider.value)
	row.add_child(value)
	slider.value_changed.connect(func(v: float):
		show.call(v)
		Settings.set_value(key, v))
	page.add_child(row)


func _check(page: VBoxContainer, text: String, key: String) -> void:
	var c := CheckBox.new()
	c.text = text
	c.button_pressed = bool(Settings.get_value(key))
	c.toggled.connect(func(on: bool): Settings.set_value(key, on))
	page.add_child(c)
