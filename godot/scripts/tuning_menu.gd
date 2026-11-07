class_name TuningMenu
extends PanelContainer
## The tuning menu (U), as web/js/Tuning.js has it: a panel at the right of the screen with the cards of the car
## editor (Tuning.CARDS), each with its groups folded away, a row for every setting (the label, a number, the unit,
## ↺ back to the setup that is chosen, and a slider under it), the systems and the extras with a tick, the gears and
## the kinds of transmission, and the setups of the car (Default is car.json; Save, Save as new…, Delete). A change
## works at once: the car is set up again while it drives (in a race the game waits while the menu is open: World).
## A setting that cannot do anything with the others as they are is hidden (Tuning.visible); one that the Godot
## physics do not use yet is grey (Tuning.NOT_IN_GODOT). The tune in use is remembered per car.

signal closed

const WIDTH := 470.0
const HEAD := Color("#f4f6f8")
const MUTED := Color("#8d97a3")
const LINE := Color("#272e37")
const ACCENT := Color("#ff5a1f")
const ACCENT2 := Color("#ffb020")
const BG2 := Color("#14181d")
const GREY := 0.45                  # the alpha of a row that the Godot version does not use yet
## Keys of the values that are not settings (they say what the car is).
const NOT_SETTINGS := ["vehicle_type", "engine_build", "model_tyres", "gear_count"]

static var opened := {}             # the cards and groups that are open (kept while the game runs)
static var advanced_gears := false

var world: Node
var car: Car
var base: Dictionary = {}           # the car as car.json makes it
var values := {}                    # the values of the car as it is now, in the units of the menu
var _reference := {}                # the setup that is chosen (or the car as made): a value that differs is orange, ↺ goes back to it
var _controls: Array = []
var _sections: Array = []           # [the section, its content] of the cards and the groups, outer first
var _card_meta := {}
var _info: Label
var _message: Label
var _setup_pick: OptionButton
var _setup_names: Array = []
var _setups := {}
var _drop_b: Button
var _save_b: Button
var _gear_grid: GridContainer
var _gear_summary: Label
var _gear_counter: HBoxContainer
var _gear_toggle: Button
var _gear_boxes: Array = []
var _holds := 0
var _was_paused := false
var _refreshing := false
var _wheels: Dictionary = {}


func setup(w: Node, c: Car, base_config: Dictionary) -> void:
	world = w
	car = c
	base = base_config


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	theme = _make_theme()
	set_anchors_preset(Control.PRESET_RIGHT_WIDE)
	offset_left = -WIDTH - 10.0
	offset_right = -10.0
	offset_top = 10.0
	offset_bottom = -10.0
	add_theme_stylebox_override("panel", _box(Color(0.094, 0.114, 0.137, 0.92), 8, 0))
	var wl: Variant = Content.load_json("wheels/wheels.json")
	_wheels = wl if wl is Dictionary else {}
	for id in Content.arg("tuning-open").split(",", false):
		opened[id] = true
	values = Tuning.values_of(car.config, _cam())
	_update_reference()

	var outer := VBoxContainer.new()
	outer.add_theme_constant_override("separation", 0)
	add_child(outer)
	var header := PanelContainer.new()
	var hs := _box(Color(0.094, 0.114, 0.137, 0.98), 8, 0)
	hs.border_width_bottom = 1
	hs.border_color = LINE
	hs.corner_radius_bottom_left = 0
	hs.corner_radius_bottom_right = 0
	hs.content_margin_left = 14
	hs.content_margin_right = 8
	hs.content_margin_top = 6
	hs.content_margin_bottom = 6
	header.add_theme_stylebox_override("panel", hs)
	outer.add_child(header)
	var hrow := HBoxContainer.new()
	header.add_child(hrow)
	var title := Label.new()
	title.text = "Tuning"
	title.add_theme_font_size_override("font_size", 19)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	hrow.add_child(title)
	var close := _button("×", "Close the tuning menu (U)")
	close.add_theme_font_size_override("font_size", 20)
	close.flat = true
	close.pressed.connect(func(): closed.emit())
	hrow.add_child(close)

	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	outer.add_child(scroll)
	var margin := MarginContainer.new()
	margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	margin.add_theme_constant_override("margin_left", 14)
	margin.add_theme_constant_override("margin_right", 14)
	margin.add_theme_constant_override("margin_top", 8)
	margin.add_theme_constant_override("margin_bottom", 20)
	scroll.add_child(margin)
	var body := VBoxContainer.new()
	body.add_theme_constant_override("separation", 6)
	margin.add_child(body)

	var sub := _label("%s. Change the car while you drive (in a race the game waits while this menu is open). U shows or hides this menu. "
		% car.config.get("name", car.car_id) + "Grey settings are not in the Godot version yet: they are kept in the tune.", 12, MUTED)
	body.add_child(sub)
	var info_box := PanelContainer.new()
	var ib := _box(BG2, 5, 0)
	ib.content_margin_left = 8
	ib.content_margin_right = 8
	ib.content_margin_top = 6
	ib.content_margin_bottom = 6
	info_box.add_theme_stylebox_override("panel", ib)
	_info = _label("", 12, HEAD)
	info_box.add_child(_info)
	body.add_child(info_box)
	_message = _label("", 13, ACCENT2)
	body.add_child(_message)
	body.add_child(_setup_line())
	for card in Tuning.CARDS:
		_card(body, card)
	_refresh()


func _unhandled_input(event: InputEvent) -> void:
	if _holds > 0:
		return
	if event.is_action_pressed("tuning") or event.is_action_pressed("menu"):
		closed.emit()
		get_viewport().set_input_as_handled()


# ---- the look (the colours and the sizes of web/js/Tuning.js)

func _box(colour: Color, radius: int, border: int) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = colour
	s.set_corner_radius_all(radius)
	s.set_border_width_all(border)
	s.border_color = LINE
	return s


func _make_theme() -> Theme:
	var t := Theme.new()
	t.default_font_size = 14
	t.set_color("font_color", "Label", HEAD)
	var normal := _box(LINE, 4, 0)
	normal.content_margin_left = 10
	normal.content_margin_right = 10
	normal.content_margin_top = 3
	normal.content_margin_bottom = 3
	var hover := normal.duplicate() as StyleBoxFlat
	hover.bg_color = Color("#343c47")
	var off := normal.duplicate() as StyleBoxFlat
	off.bg_color = Color(LINE, 0.5)
	for kind in ["Button", "OptionButton"]:
		t.set_stylebox("normal", kind, normal)
		t.set_stylebox("hover", kind, hover)
		t.set_stylebox("pressed", kind, hover)
		t.set_stylebox("focus", kind, StyleBoxEmpty.new())
		t.set_stylebox("disabled", kind, off)
		t.set_color("font_color", kind, Color.WHITE)
	var field := _box(BG2, 4, 1)
	field.content_margin_left = 5
	field.content_margin_right = 5
	t.set_stylebox("normal", "LineEdit", field)
	t.set_stylebox("focus", "LineEdit", _box(Color(0, 0, 0, 0), 4, 1))
	t.set_constant("separation", "HBoxContainer", 6)
	return t


func _label(text: String, size: int, colour: Color) -> Label:
	var l := Label.new()
	l.text = text
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", colour)
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return l


func _button(text: String, tip := "") -> Button:
	var b := Button.new()
	b.text = text
	b.tooltip_text = tip
	b.focus_mode = Control.FOCUS_NONE      # (the keys stay with the car: a button with the focus took the arrows)
	return b


## A part that folds away: a card (a frame, its name and a line on the right) or a group in it (a small title).
func _section(parent: Control, title: String, id: String, card: bool) -> VBoxContainer:
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 2)
	var wrap: Control = box
	if card:
		var panel := PanelContainer.new()
		var s := _box(Color(1, 1, 1, 0.025), 8, 1)
		s.content_margin_left = 10
		s.content_margin_right = 10
		s.content_margin_top = 2
		s.content_margin_bottom = 4
		panel.add_theme_stylebox_override("panel", s)
		panel.add_child(box)
		wrap = panel
	parent.add_child(wrap)
	var head := HBoxContainer.new()
	box.add_child(head)
	var b := _button("")
	b.flat = true
	b.alignment = HORIZONTAL_ALIGNMENT_LEFT
	b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	b.add_theme_font_size_override("font_size", 15 if card else 12)
	b.add_theme_color_override("font_color", HEAD if card else MUTED)
	b.add_theme_color_override("font_hover_color", Color.WHITE)
	head.add_child(b)
	if card:
		var meta := _label("", 12, MUTED)
		meta.size_flags_horizontal = Control.SIZE_SHRINK_END
		meta.autowrap_mode = TextServer.AUTOWRAP_OFF
		head.add_child(meta)
		_card_meta[title] = meta
	var content := VBoxContainer.new()
	content.add_theme_constant_override("separation", 2)
	content.visible = opened.get(id, false)
	box.add_child(content)
	var shown := func():
		b.text = ("▾  " if content.visible else "▸  ") + (title if card else title.to_upper())
	shown.call()
	b.pressed.connect(func():
		content.visible = not content.visible
		opened[id] = content.visible
		shown.call())
	_sections.append([wrap, content])
	return content


# ---- the cards and the rows

func _card(parent: Control, card: Array) -> void:
	var name_text: String = card[0]
	var content := _section(parent, name_text, name_text, true)
	if name_text == "Assists and extras":
		for f in Tuning.FEATURES:
			_feature_row(content, f)
		return
	for gname in card[1]:
		for g in Tuning.GROUPS:
			if g[0] == gname:
				_group(content, g, name_text)


func _group(parent: Control, group: Array, card_name: String) -> void:
	var title: String = group[0] + " settings" if group[0] == card_name else group[0]
	var id: String = card_name + "/" + group[0]
	var content := _section(parent, title, id, false)
	var fine: VBoxContainer = null
	for d in group[1]:
		var target := content
		if group[0] == "Tyres" and d[0] in Tuning.TYRE_FINE:
			if fine == null:
				fine = _section(content, "Fine-tune the tyre (on top of the kind)", id + "/fine", false)
				fine.get_parent().get_child(0).tooltip_text = "The kind of tyre sets most of these: change them only to move away from it"
			target = fine
		_row(target, d)
	# (the fine part goes at the end of its group, as in the browser)
	if fine != null:
		content.move_child(fine.get_parent(), content.get_child_count() - 1)


func _row(parent: Control, d: Array) -> void:
	var key: String = d[0]
	if key == "gearbox":
		_transmission_row(parent)
	if key == "gears":
		_gears_row(parent)
	elif key == "body_color" or key == "rim_color":
		_color_row(parent, d)
	elif key == "cam_cockpit_hide_driver":
		_bool_row(parent, d)
	elif _options(key).size() > 0 or float(d[4]) <= float(d[3]):
		_select_row(parent, key, d[1])
	else:
		_slider_row(parent, d)


## The choices of a select (the wheel library from wheels/wheels.json).
func _options(key: String) -> Array:
	if Tuning.SELECTS.has(key):
		return Tuning.SELECTS[key]
	if Tuning.SAME_LIST.has(key):
		return Tuning.SELECTS[Tuning.SAME_LIST[key]]
	if key in ["rim_front", "rim_rear", "tyre_front", "tyre_rear"]:
		var rims := key.begins_with("rim")
		var out := [["", "From the model" if rims else "From the model (tyres.shell of the car)"]]
		for e in _wheels.get("rims" if rims else "tyres", []):
			out.append([str(e.get("id", "")), str(e.get("name", e.get("id", "")))])
		if not rims:
			out.append(["custom", "Custom (made from the shell settings)"])
		return out
	return []


func _item(parent: Control, key: String) -> Array:
	var item := VBoxContainer.new()
	item.add_theme_constant_override("separation", 0)
	var line := HBoxContainer.new()
	item.add_child(line)
	parent.add_child(item)
	if key in Tuning.NOT_IN_GODOT:
		item.modulate.a = GREY
		item.tooltip_text = Tuning.NOT_YET
	return [item, line]


func _row_label(line: HBoxContainer, text: String, key: String) -> Label:
	var label := _label(text, 13, HEAD)
	label.mouse_filter = Control.MOUSE_FILTER_PASS
	if key in Tuning.NOT_IN_GODOT:
		label.tooltip_text = Tuning.NOT_YET
	line.add_child(label)
	return label


func _slider_row(parent: Control, d: Array) -> void:
	var key: String = d[0]
	var parts := _item(parent, key)
	var line: HBoxContainer = parts[1]
	var label := _row_label(line, d[1], key)
	var lo := float(d[3])
	var hi := float(d[4])
	# (a typed value may go past the slider: to half its lowest and twice its highest, away from zero; a share in %
	# stays a share)
	var typed_lo := lo * 2.0 if lo < 0.0 else lo / 2.0
	var typed_hi := hi * 2.0 if hi > 0.0 else hi / 2.0
	if d[2] == "%" and lo >= 0.0 and hi <= 100.0:
		typed_lo = maxf(0.0, typed_lo)
		typed_hi = minf(100.0, typed_hi)
	var num := SpinBox.new()
	num.min_value = typed_lo
	num.max_value = typed_hi
	num.step = float(d[5])
	num.custom_minimum_size.x = 100
	num.select_all_on_focus = true
	num.alignment = HORIZONTAL_ALIGNMENT_RIGHT
	num.get_line_edit().text_submitted.connect(func(_t: String): num.get_line_edit().release_focus())
	line.add_child(num)
	var unit := _label(str(d[2]), 11, MUTED)
	unit.custom_minimum_size.x = 46
	unit.size_flags_horizontal = Control.SIZE_FILL
	unit.autowrap_mode = TextServer.AUTOWRAP_OFF
	line.add_child(unit)
	var reset := _button("↺", "Back to the value of the setup that is chosen (or of the car as made)")
	reset.add_theme_constant_override("h_separation", 0)
	line.add_child(reset)
	var slider := HSlider.new()
	slider.min_value = lo
	slider.max_value = hi
	slider.step = float(d[5])
	slider.focus_mode = Control.FOCUS_NONE
	slider.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	parts[0].add_child(slider)
	slider.value_changed.connect(func(x: float):
		if not _refreshing:
			_change(key, x))
	num.value_changed.connect(func(x: float):
		if not _refreshing:
			_change(key, x))
	reset.pressed.connect(func(): _change(key, _reference.get(key, values.get(key))))
	_controls.append({"key": key, "kind": "slider", "item": parts[0], "label": label, "slider": slider, "num": num, "def": d})


func _select_row(parent: Control, key: String, text: String) -> void:
	var parts := _item(parent, key)
	var line: HBoxContainer = parts[1]
	var label := _row_label(line, text, key)
	var pick := OptionButton.new()
	pick.focus_mode = Control.FOCUS_NONE
	pick.fit_to_longest_item = false
	pick.clip_text = true
	pick.custom_minimum_size.x = 170
	for o in _options(key):
		pick.add_item(o[1])
		pick.set_item_metadata(pick.item_count - 1, o[0])
	pick.item_selected.connect(func(i: int):
		if not _refreshing:
			_change(key, pick.get_item_metadata(i)))
	line.add_child(pick)
	_controls.append({"key": key, "kind": "select", "item": parts[0], "label": label, "pick": pick})


func _bool_row(parent: Control, d: Array) -> void:
	var key: String = d[0]
	var parts := _item(parent, key)
	var line: HBoxContainer = parts[1]
	var check := CheckBox.new()
	check.focus_mode = Control.FOCUS_NONE
	line.add_child(check)
	var label := _row_label(line, d[1], key)
	check.toggled.connect(func(on: bool):
		if not _refreshing:
			_change(key, on))
	_controls.append({"key": key, "kind": "bool", "item": parts[0], "label": label, "check": check})


func _color_row(parent: Control, d: Array) -> void:
	var key: String = d[0]
	var parts := _item(parent, key)
	var line: HBoxContainer = parts[1]
	var label := _row_label(line, d[1], key)
	var pick := ColorPickerButton.new()
	pick.focus_mode = Control.FOCUS_NONE
	pick.custom_minimum_size = Vector2(44, 24)
	pick.edit_alpha = false
	pick.color_changed.connect(func(c: Color):
		if not _refreshing:
			_change(key, "#" + c.to_html(false)))
	line.add_child(pick)
	var reset := _button("↺", "The colour of the model")
	reset.pressed.connect(func(): _change(key, ""))
	line.add_child(reset)
	_controls.append({"key": key, "kind": "color", "item": parts[0], "label": label, "pick": pick})


## A system or an extra: a tick, and its settings under it while it is ticked.
func _feature_row(parent: Control, f: Array) -> void:
	var key: String = f[0] + "_on"
	var parts := _item(parent, key)
	var line: HBoxContainer = parts[1]
	var check := CheckBox.new()
	check.focus_mode = Control.FOCUS_NONE
	line.add_child(check)
	var label := _row_label(line, f[1], key)
	label.gui_input.connect(func(e: InputEvent):
		if e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT:
			check.button_pressed = not check.button_pressed)
	check.toggled.connect(func(on: bool):
		if not _refreshing:
			_change(key, on))
	var inner := MarginContainer.new()
	inner.add_theme_constant_override("margin_left", 14)
	inner.add_theme_constant_override("margin_bottom", 6)
	var rows := VBoxContainer.new()
	rows.add_theme_constant_override("separation", 2)
	inner.add_child(rows)
	parts[0].add_child(inner)
	for d in f[2]:
		_row(rows, d)
	_controls.append({"key": key, "kind": "feature", "item": parts[0], "label": label, "check": check, "inner": inner, "feature": f[0]})


## The kinds of transmission: one sets the gearbox, its gears, the shifting and the converter.
func _transmission_row(parent: Control) -> void:
	var parts := _item(parent, "")
	var line: HBoxContainer = parts[1]
	_row_label(line, "Transmission", "")
	var pick := OptionButton.new()
	pick.focus_mode = Control.FOCUS_NONE
	pick.fit_to_longest_item = false
	pick.clip_text = true
	pick.custom_minimum_size.x = 170
	pick.tooltip_text = "Sets the gearbox, its gears, the shifting and the converter of a kind of transmission. The values can be changed after."
	pick.add_item("Choose a transmission…")
	for t in Tuning.TRANSMISSIONS:
		pick.add_item(t[0])
	pick.item_selected.connect(func(i: int):
		pick.select(0)
		if i <= 0:
			return
		var cfg := car.config.duplicate(true)
		Tuning.use_transmission(cfg, Tuning.TRANSMISSIONS[i - 1][1])
		_apply(cfg, "transmission " + str(Tuning.TRANSMISSIONS[i - 1][0]))
		_message.text = str(Tuning.TRANSMISSIONS[i - 1][0]) + ".")
	line.add_child(pick)


## The gear ratios: a line with how many and from what to what; Advanced opens them gear by gear, with − and +.
func _gears_row(parent: Control) -> void:
	var parts := _item(parent, "gears")
	var line: HBoxContainer = parts[1]
	var label := _row_label(line, "Gear ratios", "gears")
	label.size_flags_horizontal = Control.SIZE_FILL
	label.autowrap_mode = TextServer.AUTOWRAP_OFF
	_gear_summary = _label("", 12, MUTED)
	line.add_child(_gear_summary)
	_gear_counter = HBoxContainer.new()
	for b in [["−", -1, "One gear fewer"], ["+", 1, "One gear more"]]:
		var button := _button(b[0], b[2])
		var delta: int = b[1]
		button.pressed.connect(func():
			var n := clampi(int(values.get("gear_count", 1)) + delta, 1, 10)
			if n != int(values.get("gear_count", 1)):
				_change("gear_count", n))
		_gear_counter.add_child(button)
	line.add_child(_gear_counter)
	_gear_toggle = _button("")
	_gear_toggle.pressed.connect(func():
		advanced_gears = not advanced_gears
		_show_gears())
	line.add_child(_gear_toggle)
	_gear_grid = GridContainer.new()
	_gear_grid.columns = 3
	_gear_grid.add_theme_constant_override("h_separation", 8)
	parts[0].add_child(_gear_grid)
	_show_gears()


func _show_gears() -> void:
	_gear_grid.visible = advanced_gears
	_gear_counter.visible = advanced_gears
	_gear_toggle.text = "Simple" if advanced_gears else "Advanced"
	_gear_toggle.tooltip_text = "Hide the ratios of the gears" if advanced_gears else "Set the ratio of every gear, and the number of gears"


func _build_gear_grid() -> void:
	for c in _gear_grid.get_children():
		c.queue_free()
	_gear_boxes.clear()
	for i in int(values.get("gear_count", 0)):
		var cell := VBoxContainer.new()
		cell.add_theme_constant_override("separation", 0)
		cell.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		cell.add_child(_label("Gear %d" % (i + 1), 11, MUTED))
		var box := SpinBox.new()
		box.min_value = 0.3
		box.max_value = 7.0
		box.step = 0.01
		box.select_all_on_focus = true
		box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		box.get_line_edit().text_submitted.connect(func(_t: String): box.get_line_edit().release_focus())
		var gear := i
		box.value_changed.connect(func(x: float):
			if not _refreshing and x > 0.0:
				_change("gear%d" % gear, x))
		cell.add_child(box)
		_gear_grid.add_child(cell)
		_gear_boxes.append(box)


# ---- the setups

func _setup_line() -> Control:
	var flow := HFlowContainer.new()
	flow.add_theme_constant_override("h_separation", 6)
	flow.add_theme_constant_override("v_separation", 6)
	var l := _label("Setup", 13, MUTED)
	l.size_flags_horizontal = Control.SIZE_FILL
	l.autowrap_mode = TextServer.AUTOWRAP_OFF
	flow.add_child(l)
	_setup_pick = OptionButton.new()
	_setup_pick.focus_mode = Control.FOCUS_NONE
	_setup_pick.fit_to_longest_item = false
	_setup_pick.clip_text = true
	_setup_pick.custom_minimum_size.x = 250
	_setup_pick.item_selected.connect(_pick_setup)
	flow.add_child(_setup_pick)
	_save_b = _button("Save", "The setup that is chosen is overwritten with the car as it is now")
	var accent := _box(ACCENT, 4, 0)
	accent.content_margin_left = 10
	accent.content_margin_right = 10
	_save_b.add_theme_stylebox_override("normal", accent)
	var accent_hover := accent.duplicate() as StyleBoxFlat
	accent_hover.bg_color = ACCENT.lightened(0.15)
	_save_b.add_theme_stylebox_override("hover", accent_hover)
	_save_b.pressed.connect(_save)
	flow.add_child(_save_b)
	var save_new := _button("Save as new…", "The car as it is now, kept under a new name")
	save_new.pressed.connect(_save_new)
	flow.add_child(save_new)
	_drop_b = _button("Delete")
	_drop_b.pressed.connect(_delete)
	flow.add_child(_drop_b)
	return flow


func _active_name() -> String:
	var path: String = Settings.get_value("tunes").get(car.car_id, "")
	if path == "":
		return ""
	for n in _setups:
		if _setups[n]["own"] == path or _setups[n]["car"] == path:
			return n
	return ""


func _path_of(n: String) -> String:
	if not _setups.has(n):
		return ""
	return _setups[n]["own"] if _setups[n]["own"] != "" else _setups[n]["car"]


func _fill_setups() -> void:
	_setups = Tuning.list_detail(car.car_id, base)
	var active := _active_name()
	_setup_pick.clear()
	_setup_names = [""]
	_setup_pick.add_item("Default (the car as made)")
	var changed := _differs(_reference)
	for n in _setups:
		var text: String = n + (" · with the car" if _setups[n]["car"] != "" else "")
		if n == active and changed:
			text += " (changed)"
		_setup_pick.add_item(text)
		_setup_names.append(n)
	_setup_pick.select(maxi(0, _setup_names.find(active)))
	var own: bool = active != "" and _setups[active]["own"] != ""
	var shipped: bool = active != "" and _setups[active]["car"] != ""
	_drop_b.disabled = not own
	_drop_b.text = "Undo changes" if own and shipped else "Delete"
	_drop_b.tooltip_text = "This setup comes with the car" if shipped and not own \
		else "The setup as it comes with the car, without the changes saved here" if own and shipped else ""
	_save_b.tooltip_text = "Default is car.json, the car as made (the car editor of the browser game writes it)" if active == "" \
		else "The setup that is chosen is overwritten with the car as it is now"


func _pick_setup(i: int) -> void:
	var to: String = _setup_names[i] if i < _setup_names.size() else ""
	var was := _active_name()
	if to == was:
		return
	# (tuning that was not saved is lost by a switch: asked first)
	if not _differs(_reference):
		_switch(to)
		return
	_setup_pick.select(maxi(0, _setup_names.find(was)))
	_dialog("Switch the setup?", "The tuning on the car has changes that are not saved. They are lost when you switch to %s."
		% ("“" + to + "”" if to != "" else "the car as made"), "Switch", func(_t: String): _switch(to))


func _switch(n: String) -> void:
	var path := _path_of(n)
	var cfg := Tuning.load_tune(path) if path != "" else base.duplicate(true)
	if cfg.is_empty():
		_message.text = "This setup could not be read."
		return
	_use(cfg, path)
	_message.text = "Setup %s." % n if n != "" else "The car as it was made."


## The car takes a whole configuration (a tune, or the car as made).
func _use(cfg: Dictionary, path: String) -> void:
	_remember(path)
	_update_reference(cfg)
	_apply(cfg, "setup " + (path if path != "" else "the car as made"))


func _remember(path: String) -> void:
	var tunes: Dictionary = Settings.get_value("tunes").duplicate()
	if path == "":
		tunes.erase(car.car_id)
	else:
		tunes[car.car_id] = path
	Settings.set_value("tunes", tunes)


func _update_reference(cfg := {}) -> void:
	if cfg.is_empty():
		var path: String = Settings.get_value("tunes").get(car.car_id, "")
		cfg = Tuning.load_tune(path) if path != "" else {}
		if cfg.is_empty():
			cfg = base
	_reference = Tuning.values_of(cfg, _cam())


func _save() -> void:
	var n := _active_name()
	if n == "":
		_message.text = "Default is car.json, the car as made: the Godot version does not write it. Keep the tuning with Save as new…"
		return
	_save_as(n)


func _save_new() -> void:
	_dialog("Save as new", "The name of the new setup", "Save", func(n: String):
		n = n.strip_edges().left(40)
		if n == "":
			return
		if not _setups.has(n):
			_save_as(n)
			return
		_dialog("Overwrite the setup “%s”?" % n, "There is a setup with this name already.", "Overwrite", func(_t: String): _save_as(n)),
		true)


func _save_as(n: String) -> void:
	var path := Tuning.save_tune(car.car_id, n, car.config)
	_remember(path)
	_update_reference(car.config)
	_refresh()
	_message.text = "Setup %s saved." % n
	RunLog.event("tune saved: %s (%s)" % [n, path])


func _delete() -> void:
	var n := _active_name()
	if n == "" or _setups[n]["own"] == "":
		return
	var own: String = _setups[n]["own"]
	if _setups[n]["car"] != "":
		_dialog("Undo the changes to “%s”?" % n, "The setup goes back to how it comes with the car.", "Undo changes", func(_t: String):
			Tuning.delete_tune(own)
			_fill_setups()
			_switch(n))
		return
	_dialog("Delete the setup “%s”?" % n, "The tuning on the car stays as it is (until the next start).", "Delete", func(_t: String):
		Tuning.delete_tune(own)
		_remember("")
		_update_reference()
		_refresh()
		_message.text = "Setup %s deleted (the tuning on the car stays as it is)." % n
		RunLog.event("tune deleted: %s" % own))


## A question in a window of the game (with a name to type when asked). The game waits while it is open.
func _dialog(title: String, text: String, ok_text: String, on_ok: Callable, with_input := false) -> void:
	var d := ConfirmationDialog.new()
	d.title = title
	d.ok_button_text = ok_text
	d.exclusive = true
	var edit: LineEdit = null
	if with_input:
		var box := VBoxContainer.new()
		var l := Label.new()
		l.text = text
		box.add_child(l)
		edit = LineEdit.new()
		edit.max_length = 40
		box.add_child(edit)
		d.add_child(box)
		d.register_text_enter(edit)
	else:
		d.dialog_text = text
		d.dialog_autowrap = true
	add_child(d)
	_hold(true)
	d.confirmed.connect(func(): on_ok.call(edit.text if edit != null else ""))
	d.visibility_changed.connect(func():
		if not d.visible:
			_hold(false)
			d.queue_free())
	d.popup_centered(Vector2i(440, 0))
	if edit != null:
		edit.grab_focus.call_deferred()
		edit.select_all.call_deferred()


func _hold(on: bool) -> void:
	_holds += 1 if on else -1
	if on and _holds == 1:
		_was_paused = get_tree().paused
		get_tree().paused = true
	elif not on and _holds == 0:
		get_tree().paused = _was_paused


# ---- the car follows the values

## What the camera uses where car.json has no camera (the defaults of ChaseCamera).
func _cam() -> Dictionary:
	var c: ChaseCamera = world.get("camera") if world != null else null
	if c == null:
		return {}
	return {"distance": c.distance, "height": c.height, "look_height": c.look_height, "smoothing": c.smoothing, "fov_standing": c.fov_standing,
		"fov_fast": c.fov_fast, "cockpit": c.cockpit, "cockpit_fov": c.cockpit_fov}


func _change(key: String, value: Variant) -> void:
	var cfg := car.config.duplicate(true)
	Tuning.set_value(cfg, key, value, _cam())
	_apply(cfg, "%s = %s" % [key, value])


func _apply(cfg: Dictionary, what: String) -> void:
	var cams_before: Variant = car.config.get("cameras")
	var sound_before: Variant = car.config.get("sound")
	car.apply_config(cfg)
	if world != null:
		var c: ChaseCamera = world.get("camera")
		if c != null and cfg.get("cameras") != cams_before:
			c.read_config(car)
		var audio: CarAudio = world.get("audio")
		if audio != null and cfg.get("sound") != sound_before:
			audio.reconfigure()
	values = Tuning.values_of(car.config, _cam())
	_refresh()
	RunLog.event("tuning " + what)


static func _same(a: Variant, b: Variant) -> bool:
	if (a is float or a is int) and (b is float or b is int):
		return absf(float(a) - float(b)) <= 1e-6 * maxf(1.0, absf(float(a)))
	return a == b


## The values differ from those of a setup (all the gears too).
func _differs(ref: Dictionary) -> bool:
	if Tuning.gears_of(values) != Tuning.gears_of(ref):
		return true
	for k in values:
		if k in NOT_SETTINGS or str(k).begins_with("gear"):
			continue
		if not _same(values[k], ref.get(k)):
			return true
	return false


func _refresh() -> void:
	_refreshing = true
	if _gear_grid != null and _gear_boxes.size() != int(values.get("gear_count", 0)):
		_build_gear_grid()
	for c in _controls:
		var key: String = c["key"]
		var item: Control = c["item"]
		item.visible = Tuning.visible_feature(c["feature"], values) if c["kind"] == "feature" else Tuning.visible(key, values)
		var v: Variant = values.get(key)
		var changed := not _same(v, _reference.get(key))
		match c["kind"]:
			"slider":
				var d: Array = c["def"]
				var slider: HSlider = c["slider"]
				var x := float(v) if v != null else 0.0
				# (a value outside of the slider, typed in, widens it)
				slider.min_value = minf(float(d[3]), x)
				slider.max_value = maxf(float(d[4]), x)
				slider.set_value_no_signal(x)
				var num: SpinBox = c["num"]
				if not num.get_line_edit().has_focus():
					num.set_value_no_signal(x)
			"select":
				var pick: OptionButton = c["pick"]
				var at := -1
				for i in pick.item_count:
					if str(pick.get_item_metadata(i)) == str(v):
						at = i
				pick.select(at)
			"bool":
				(c["check"] as CheckBox).set_pressed_no_signal(v == true)
			"color":
				var cp: ColorPickerButton = c["pick"]
				cp.color = Color.from_string(str(v), Color("#888888")) if str(v) != "" else Color("#888888")
				cp.modulate.a = 1.0 if str(v) != "" else 0.45
			"feature":
				(c["check"] as CheckBox).set_pressed_no_signal(v == true)
				(c["inner"] as Control).visible = v == true
		(c["label"] as Label).add_theme_color_override("font_color", ACCENT2 if changed else HEAD)
	for i in _gear_boxes.size():
		var box: SpinBox = _gear_boxes[i]
		if not box.get_line_edit().has_focus():
			box.set_value_no_signal(float(values.get("gear%d" % i, 1.0)))
		var ref_g: Variant = _reference.get("gear%d" % i)
		box.get_line_edit().add_theme_color_override("font_color", ACCENT2 if not _same(values.get("gear%d" % i), ref_g) else Color.WHITE)
	if _gear_summary != null:
		var g := Tuning.gears_of(values)
		_gear_summary.text = "%d gears · %.2f … %.2f" % [g.size(), g[0], g[g.size() - 1]] if not g.is_empty() else ""
	# a group whose settings are all hidden goes too, and so does a card with nothing left in it
	for i in range(_sections.size() - 1, -1, -1):
		var content: Control = _sections[i][1]
		var any := false
		for ch in content.get_children():
			if ch is Control and (ch as Control).visible:
				any = true
		(_sections[i][0] as Control).visible = any
	_refreshing = false
	_fill_setups()
	_update_info()


func _update_info() -> void:
	var pk := Tuning.peak_of(car.config)
	var top := Tuning.top_speed(car.config) * 3.6
	var mass := float(values.get("mass", car.mass))
	_info.text = "%d hp at %d rpm · %d Nm · top speed ~%d km/h · %d kg · %.1f kg/hp" % [
		roundi(pk["hp"]), roundi(pk["rpm"]), roundi(pk["nm"]), roundi(top), roundi(mass), mass / maxf(1.0, pk["hp"])]
	if _card_meta.has("Engine"):
		_card_meta["Engine"].text = "%d hp at %d rpm, %d Nm" % [roundi(pk["hp"]), roundi(pk["rpm"]), roundi(pk["nm"])]
	if _card_meta.has("Drivetrain"):
		_card_meta["Drivetrain"].text = "Top speed ~%d km/h" % roundi(top) if top > 0.0 else ""
