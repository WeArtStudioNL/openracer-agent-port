class_name SettingsControlsPage
extends RefCounted
## The Controls tab of the settings (Settings.js renderRow): every action by its group, a chip per input (Key, Pad or
## Wheel, the name, ✎ to set a new input in its place, ✕ to remove it), + to add one, "not set" when it has none. The
## inputs of the racing wheel that its calibration measures (the steering, the pedals, the clutch, the paddles) are
## chips of their own; ✎ on them calibrates the wheel again.

## The part of the wheel profile (WheelInput) of an action.
const WHEEL_PART := {"steer_wheel": "steer_axis", "throttle": "throttle", "brake": "brake", "clutch": "clutch",
	"shift_up": "shift_up", "shift_down": "shift_down"}

var menu: SettingsMenu
var page: VBoxContainer


func _init(m: SettingsMenu, p: VBoxContainer) -> void:
	menu = m
	page = p


func build() -> void:
	for c in page.get_children():
		page.remove_child(c)
		c.queue_free()
	SettingsRows.note(page, "Every action can have several inputs: a key, a button or axis of a controller, a button of a racing wheel. "
		+ "✎ sets a new input, ✕ removes it and + adds one. The pedals and the steering of a wheel are set up by moving them (the "
		+ "calibration). Press Delete while it waits to remove that input, Esc to cancel.")
	var status := Label.new()
	status.autowrap_mode = TextServer.AUTOWRAP_WORD
	status.modulate.a = 0.72
	if WheelInput.device >= 0:
		status.text = "Wheel: %s (%s)" % [WheelInput.wheel_name, "calibrated" if WheelInput.active else "not calibrated yet: K"]
	else:
		status.text = "No racing wheel connected."
	page.add_child(status)
	var group := ""
	for a in Controls.ACTIONS:
		if a[2] != group:
			group = a[2]
			SettingsRows.section(page, group)
		if _visible(a[0]):
			_row(a)
	var reset := Button.new()
	reset.text = "Reset the controls to the defaults"
	SettingsRows.style(reset)
	reset.pressed.connect(func():
		menu.pages.call("_confirm", "Reset the controls?", "Every key, pad button and wheel button goes back to the default. The "
			+ "bindings you made are lost.", "Reset", func():
				Controls.reset_defaults()
				menu.hint("The controls are back to the defaults.")))
	page.add_child(reset)


## The gears of the shifter that the car does not have are not shown.
func _visible(action: String) -> bool:
	if not action.begins_with("gear") or menu.world == null:
		return true
	var car: Car = menu.world.get("car")
	return car == null or int(action.substr(4)) <= car.gear_ratios.size()


func _row(a: Array) -> void:
	var action: String = a[0]
	var r := HBoxContainer.new()
	r.add_theme_constant_override("separation", 10)
	var label := Label.new()
	label.text = a[1]
	label.custom_minimum_size.x = 330
	label.autowrap_mode = TextServer.AUTOWRAP_WORD
	r.add_child(label)
	var chips := HFlowContainer.new()
	chips.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	chips.add_theme_constant_override("h_separation", 6)
	r.add_child(chips)
	page.add_child(r)
	var shown := 0
	var wheel_only: bool = a.size() > 3 and a[3] == "wheel"
	if not wheel_only:
		var list: Array = Controls.bindings(action)
		for i in list.size():
			shown += 1
			if menu.capturing(action, i):
				chips.add_child(_waiting())
				continue
			var b: Dictionary = list[i]
			var dev := "Key" if b["type"] == "key" else ("Wheel" if b["type"] == "wheel_button" else "Pad")
			chips.add_child(_chip(dev, Controls.describe(b).trim_prefix("Pad "), func(): menu._capture(action, i), func():
				Controls.clear_binding(action, i)))
	var wheel := _wheel_text(action)
	if wheel != "":
		shown += 1
		chips.add_child(_chip("Wheel", wheel, _calibrate, func(): _forget_wheel_part(action)))
	if menu.capturing(action, Controls.bindings(action).size()):
		chips.add_child(_waiting())
	else:
		var add := Button.new()
		add.text = "+"
		add.custom_minimum_size.x = 34
		SettingsRows.style(add)
		add.tooltip_text = "Set up the wheel (its calibration)" if wheel_only else "Add an input"
		add.pressed.connect(_calibrate if wheel_only else func(): menu._capture(action, Controls.bindings(action).size()))
		chips.add_child(add)
	if shown == 0 and not menu.capturing(action, 0):
		var none := Label.new()
		none.text = "not set"
		none.modulate.a = 0.5
		chips.add_child(none)
		chips.move_child(none, 0)


func _wheel_text(action: String) -> String:
	if not WHEEL_PART.has(action):
		return ""
	var p := Settings.profile(WheelInput.guid) if WheelInput.guid != "" else {}
	var part: String = WHEEL_PART[action]
	if not p.has(part):
		return ""
	var v: Variant = p[part]
	if v is Dictionary:
		return "Axis %d" % int(v.get("axis", -1))
	if action == "steer_wheel":
		return "Axis %d" % int(v)
	return "Button %d" % int(v)


func _forget_wheel_part(action: String) -> void:
	var p := Settings.profile(WheelInput.guid).duplicate(true)
	p.erase(WHEEL_PART[action])
	if action == "steer_wheel":
		p.erase("steer_left")
		p.erase("steer_right")
	Settings.set_profile(WheelInput.guid, p)
	WheelInput._pick()
	build()


func _calibrate() -> void:
	if WheelInput.device < 0 and Input.get_connected_joypads().is_empty():
		menu.hint("No wheel found. Connect it and press a button on it first.")
		return
	menu.closed.emit()
	WheelInput.calibrate()


func _chip(dev: String, text: String, edit: Callable, remove: Callable) -> PanelContainer:
	var chip := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color("#3a3326") if dev == "Wheel" else Color("#212c45")
	sb.set_corner_radius_all(4)
	sb.content_margin_left = 8
	sb.content_margin_right = 2
	chip.add_theme_stylebox_override("panel", sb)
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 4)
	chip.add_child(h)
	var d := Label.new()
	d.text = dev.to_upper()
	d.add_theme_font_size_override("font_size", 10)
	d.modulate.a = 0.55
	h.add_child(d)
	var t := Label.new()
	t.text = text
	h.add_child(t)
	var e := Button.new()
	e.text = "✎"
	e.flat = true
	e.tooltip_text = "Set a new input"
	e.pressed.connect(edit)
	h.add_child(e)
	var x := Button.new()
	x.text = "✕"
	x.flat = true
	x.tooltip_text = "Remove"
	x.pressed.connect(remove)
	h.add_child(x)
	return chip


func _waiting() -> Label:
	var l := Label.new()
	l.text = "Press a key or a button, or move an axis… (Esc cancels)"
	l.add_theme_color_override("font_color", Color(1, 0.8, 0.3))
	return l
