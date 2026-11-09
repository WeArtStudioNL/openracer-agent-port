class_name SettingsRows
extends RefCounted
## The rows of the settings menu (the rows of web/js/Settings.js: optionRow, sliderRow, pickRow, checkRow, curveRow):
## a label at the left and what sets the option at the right. An option the Godot game does not do yet is grey,
## with a tooltip that says so.

const LABEL_WIDTH := 360
const NOT_YET := "Not in the Godot version yet"

## The options that are in the menu for parity with the browser game, but that the Godot game does not use yet.
const NOT_IN_GODOT: Array[String] = []


## The curve of the easing of a key (Settings.js curveRow): the pedal from 0 to 1 over the time the key is held.
class CurveView:
	extends Control
	var power := 1.0

	func _init() -> void:
		custom_minimum_size = Vector2(60, 32)
		mouse_filter = Control.MOUSE_FILTER_IGNORE

	func _draw() -> void:
		draw_rect(Rect2(1, 1, 58, 30), Color("#272e37"), false, 1.0)
		var pts := PackedVector2Array()
		for i in 21:
			pts.append(Vector2(2.0 + i * 2.8, 30.0 - 28.0 * pow(i / 20.0, power)))
		draw_polyline(pts, Color("#ff5a1f"), 2.0, true)


static func section(page: Control, text: String) -> Label:
	var l := Label.new()
	l.text = text.to_upper()
	l.add_theme_font_size_override("font_size", 15)
	l.add_theme_color_override("font_color", Color(0.62, 0.69, 0.77))
	page.add_child(l)
	return l


static func note(page: Control, text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.autowrap_mode = TextServer.AUTOWRAP_WORD
	l.modulate.a = 0.72
	l.custom_minimum_size.x = 200
	page.add_child(l)
	return l


static func row(page: Control, text: String) -> HBoxContainer:
	var r := HBoxContainer.new()
	r.add_theme_constant_override("separation", 10)
	var label := Label.new()
	label.text = text
	label.custom_minimum_size.x = LABEL_WIDTH
	label.autowrap_mode = TextServer.AUTOWRAP_WORD
	r.add_child(label)
	page.add_child(r)
	return r


## Grey and not to be used: an option that the Godot game does not do yet.
static func grey(r: Control, tip := NOT_YET) -> void:
	r.modulate.a = 0.45
	r.tooltip_text = tip
	for c in r.find_children("*", "Control", true, false):
		c.tooltip_text = tip
		if c is BaseButton:
			(c as BaseButton).disabled = true
		elif c is Slider:
			(c as Slider).editable = false


static func _maybe_grey(r: Control, key: String) -> void:
	if key in NOT_IN_GODOT:
		grey(r)


static func check(page: Control, text: String, key: String, note_text := "", after := Callable()) -> HBoxContainer:
	var r := row(page, text)
	var c := CheckButton.new()
	c.button_pressed = bool(Settings.get_value(key))
	var state := Label.new()
	state.text = "On" if c.button_pressed else "Off"
	state.custom_minimum_size.x = 36
	c.toggled.connect(func(on: bool):
		state.text = "On" if on else "Off"
		Settings.set_value(key, on)
		if after.is_valid():
			after.call(on))
	r.add_child(c)
	r.add_child(state)
	if note_text != "":
		var n := Label.new()
		n.text = note_text
		n.autowrap_mode = TextServer.AUTOWRAP_WORD
		n.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		n.modulate.a = 0.7
		r.add_child(n)
	_maybe_grey(r, key)
	return r


## A slider: fmt(value) is the text beside it; with after, called with the value as it moves.
static func slider(page: Control, text: String, key: String, lo: float, hi: float, step: float, fmt: Callable,
		after := Callable()) -> HBoxContainer:
	var r := row(page, text)
	var s := HSlider.new()
	s.scrollable = false              # (the wheel scrolls the page)
	s.min_value = lo
	s.max_value = hi
	s.step = step
	s.value = float(Settings.get_value(key))
	s.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	s.custom_minimum_size.x = 260
	r.add_child(s)
	var value := Label.new()
	value.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	value.autowrap_mode = TextServer.AUTOWRAP_WORD
	value.text = fmt.call(s.value)
	r.add_child(value)
	s.value_changed.connect(func(v: float):
		value.text = fmt.call(v)
		Settings.set_value(key, int(v) if Settings.DEFAULTS.get(key) is int else v)
		if after.is_valid():
			after.call(v))
	_maybe_grey(r, key)
	return r


## A choice: items are [value, text]; apply(value) when one is chosen (the item of the value now is selected).
static func pick(page: Control, text: String, current: Variant, items: Array, apply: Callable, key := "") -> HBoxContainer:
	var r := row(page, text)
	var o := OptionButton.new()
	o.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	o.fit_to_longest_item = false
	var chosen := -1
	for i in items.size():
		o.add_item(str(items[i][1]))
		if str(items[i][0]) == str(current) or (current is float and items[i][0] is float and is_equal_approx(current, items[i][0])):
			chosen = i
	o.select(chosen)
	o.item_selected.connect(func(i: int): apply.call(items[i][0]))
	r.add_child(o)
	if key != "":
		_maybe_grey(r, key)
	return r


## A choice of an option of the settings.
static func pick_key(page: Control, text: String, key: String, items: Array) -> HBoxContainer:
	return pick(page, text, Settings.get_value(key), items, func(v: Variant): Settings.set_value(key, v), key)


## A row with a button (Settings.js optionRow).
static func action(page: Control, text: String, button_text: String, on_press: Callable, tip := "") -> Button:
	var r := row(page, text)
	var b := Button.new()
	b.text = button_text
	b.custom_minimum_size.x = 150
	style(b)
	b.pressed.connect(on_press)
	if tip != "":
		b.tooltip_text = tip
	r.add_child(b)
	return b


## The time and the curve of a key (Settings.js curveRow, with the drawing of the curve).
static func curve(page: Control, text: String, key: String) -> HBoxContainer:
	var view := CurveView.new()
	view.power = float(Settings.get_value(key))
	var r := slider(page, text, key, 0.3, 3.0, 0.1, func(v: float) -> String:
		return "%.1f%s" % [v, " (straight)" if absf(v - 1.0) < 0.05 else (" (quick at first)" if v < 1.0 else " (slow at first)")],
		func(v: float):
			view.power = v
			view.queue_redraw())
	r.add_child(view)
	return r


## A button that stands out on the dark panel (the buttons of Settings.js: var(--line), the hover lighter).
static func style(b: Button) -> void:
	for st in [["normal", Color("#272e37")], ["hover", Color("#343c47")], ["pressed", Color("#ff5a1f")], ["focus", Color(0, 0, 0, 0)],
			["disabled", Color("#1e242c")]]:
		var sb := StyleBoxFlat.new()
		sb.bg_color = st[1]
		sb.set_corner_radius_all(4)
		sb.content_margin_left = 12
		sb.content_margin_right = 12
		sb.content_margin_top = 5
		sb.content_margin_bottom = 5
		if st[0] == "focus":
			sb.draw_center = false
			sb.border_color = Color("#ffb020")
			sb.set_border_width_all(2)
		b.add_theme_stylebox_override(st[0], sb)


static func percent(v: float) -> String:
	return "%d%%" % roundi(v * 100.0)


static func seconds(v: float) -> String:
	return "%.2f s" % v
