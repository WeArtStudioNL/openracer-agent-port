class_name EditorStyle
extends RefCounted
## The look of the car editor (web/tools/editor.css): a side bar of cards that fold, fields with a hint under them, buttons
## in their kinds (primary, accent, ghost, danger, small), and the colours of the browser editor. The widgets are made
## by the functions here, so every card of the editor looks the same.

const BG := Color("#0a0f1c")
const SIDE := Color("#0e1424")
const CARD := Color("#121a2e")
const CARD_HEAD := Color("#162036")
const LINE := Color("#212c45")
const TEXT := Color("#dbe4f5")
const MUTED := Color("#8e9cb8")
const FAINT := Color("#5e6b88")
const ACCENT := Color("#3d7bff")
const ACCENT2 := Color("#9fe3ff")
const WARN := Color("#e0b040")
const ERROR := Color("#ff8a80")
const OK := Color("#7fe0a8")
const FIELD := Color("#0d1322")
const FIELD_LINE := Color("#2b3853")
const BUTTON := Color("#27344f")
const BUTTON_LINE := Color("#33405c")
const VIEW_BG := Color("#18233a")
const FLOAT_BG := Color(0.055, 0.08, 0.14, 0.92)

## The cards that are open (kept while the game runs, as the browser keeps them in its storage).
static var open_cards := {"Car": true, "Model": true}


static func box(colour: Color, radius := 7, border := 0, border_colour := LINE) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = colour
	s.set_corner_radius_all(radius)
	s.set_border_width_all(border)
	s.border_color = border_colour
	s.content_margin_left = 9
	s.content_margin_right = 9
	s.content_margin_top = 4
	s.content_margin_bottom = 4
	return s


static func make_theme() -> Theme:
	var t := Theme.new()
	t.default_font_size = 13
	t.set_color("font_color", "Label", TEXT)
	for kind in ["Button", "OptionButton", "MenuButton", "CheckBox", "CheckButton"]:
		t.set_color("font_color", kind, TEXT)
		t.set_color("font_hover_color", kind, Color.WHITE)
		t.set_color("font_pressed_color", kind, Color.WHITE)
		t.set_color("font_focus_color", kind, TEXT)
		t.set_color("font_disabled_color", kind, FAINT)
	for kind in ["Button", "OptionButton", "MenuButton"]:
		t.set_stylebox("normal", kind, box(BUTTON, 7, 1, BUTTON_LINE))
		t.set_stylebox("hover", kind, box(Color("#3a4554"), 7, 1, BUTTON_LINE))
		t.set_stylebox("pressed", kind, box(Color("#3a4554"), 7, 1, ACCENT))
		t.set_stylebox("focus", kind, StyleBoxEmpty.new())
		t.set_stylebox("disabled", kind, box(Color(BUTTON, 0.45), 7, 1, BUTTON_LINE))
	for kind in ["CheckBox", "CheckButton"]:
		for state in ["normal", "hover", "pressed", "hover_pressed", "focus", "disabled"]:
			t.set_stylebox(state, kind, StyleBoxEmpty.new())
		t.set_color("checkbox_checked_color", kind, ACCENT)
		t.set_color("checkbox_unchecked_color", kind, MUTED)
	var field := box(FIELD, 7, 1, FIELD_LINE)
	t.set_stylebox("normal", "LineEdit", field)
	t.set_stylebox("focus", "LineEdit", box(Color(0, 0, 0, 0), 7, 1, ACCENT))
	t.set_stylebox("read_only", "LineEdit", box(Color(FIELD, 0.5), 7, 1, FIELD_LINE))
	t.set_color("font_color", "LineEdit", TEXT)
	t.set_color("font_placeholder_color", "LineEdit", FAINT)
	t.set_stylebox("panel", "ItemList", box(FIELD, 7, 1, FIELD_LINE))
	t.set_stylebox("panel", "Tree", box(FIELD, 7, 1, FIELD_LINE))
	t.set_color("font_color", "ItemList", TEXT)
	t.set_stylebox("panel", "PopupMenu", box(Color("#162036"), 6, 1, FIELD_LINE))
	t.set_stylebox("panel", "TooltipPanel", box(Color("#162036"), 6, 1, FIELD_LINE))
	t.set_color("font_color", "TooltipLabel", TEXT)
	t.set_constant("separation", "HBoxContainer", 8)
	t.set_constant("separation", "VBoxContainer", 6)
	var grab := StyleBoxFlat.new()
	grab.bg_color = ACCENT
	grab.set_corner_radius_all(3)
	t.set_stylebox("grabber_area", "HSlider", grab)
	t.set_stylebox("grabber_area_highlight", "HSlider", grab)
	var track := StyleBoxFlat.new()
	track.bg_color = Color("#2c3541")
	track.set_corner_radius_all(3)
	track.content_margin_top = 2
	track.content_margin_bottom = 2
	t.set_stylebox("slider", "HSlider", track)
	return t


static func label(text: String, size := 13, colour := TEXT, wrap := true) -> Label:
	var l := Label.new()
	l.text = text
	if wrap:
		l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", colour)
	return l


static func hint(text: String, colour := MUTED) -> Label:
	var l := label(text, 11, colour)
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return l


## A heading of a part of a card (uppercase, small).
static func group(text: String) -> Label:
	var l := label(text.to_upper(), 10, FAINT)
	l.add_theme_constant_override("line_spacing", 0)
	return l


## A button: kind is a list of words as the css has them ("small ghost", "primary", "accent small", "danger").
static func button(text: String, kind := "", tip := "") -> Button:
	var b := Button.new()
	b.text = text
	b.tooltip_text = tip
	b.focus_mode = Control.FOCUS_NONE
	style_button(b, kind)
	return b


static func style_button(b: Button, kind: String) -> void:
	var words := kind.split(" ", false)
	var bg := BUTTON
	var line := BUTTON_LINE
	var fg := TEXT
	if "primary" in words or "accent" in words or "on" in words:
		bg = ACCENT
		line = ACCENT
		fg = Color.WHITE
	elif "ghost" in words:
		bg = Color(0, 0, 0, 0)
		fg = Color("#c6cfdb")
	elif "danger" in words:
		bg = Color(0, 0, 0, 0)
		line = Color("#5a3331")
		fg = Color("#ff8a80")
	var small := "small" in words
	for state in ["normal", "hover", "pressed", "disabled"]:
		var c := bg
		if state == "hover" or state == "pressed":
			c = bg.lightened(0.12) if bg.a > 0.0 else Color("#2a323e")
		var s := box(c if state != "disabled" else Color(c, c.a * 0.45), 7, 1, line)
		s.content_margin_top = 2 if small else 5
		s.content_margin_bottom = 2 if small else 5
		s.content_margin_left = 9 if small else 12
		s.content_margin_right = 9 if small else 12
		b.add_theme_stylebox_override(state, s)
	b.add_theme_color_override("font_color", fg)
	b.add_theme_color_override("font_hover_color", Color.WHITE)
	b.add_theme_font_size_override("font_size", 12 if small else 13)


## A row of fields side by side, each as wide as the others.
static func row(parent: Control = null) -> HBoxContainer:
	var r := HBoxContainer.new()
	r.add_theme_constant_override("separation", 8)
	if parent != null:
		parent.add_child(r)
	return r


static func expand(c: Control) -> Control:
	c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	c.custom_minimum_size.x = maxf(c.custom_minimum_size.x, 40.0)
	return c


static func line_edit(text := "", placeholder := "") -> LineEdit:
	var e := LineEdit.new()
	e.text = text
	e.placeholder_text = placeholder
	e.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	e.custom_minimum_size.y = 30
	e.select_all_on_focus = true
	return e


static func options(items: Array, selected: Variant = null) -> OptionButton:
	var o := OptionButton.new()
	o.focus_mode = Control.FOCUS_NONE
	o.clip_text = true
	o.fit_to_longest_item = false
	o.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	o.custom_minimum_size.x = 60
	for it in items:
		if it is Array:
			o.add_item(str(it[1]))
			o.set_item_metadata(o.item_count - 1, it[0])
		else:
			o.add_item(str(it))
			o.set_item_metadata(o.item_count - 1, it)
	if selected != null:
		select_value(o, selected)
	return o


## Selects the item of an OptionButton whose metadata is value (or the first).
static func select_value(o: OptionButton, value: Variant) -> void:
	for i in o.item_count:
		var m: Variant = o.get_item_metadata(i)
		var same := (float(m) == float(value)) if ((m is int or m is float) and (value is int or value is float)) else str(m) == str(value)
		if same:
			o.select(i)
			return
	if o.item_count > 0:
		o.select(0)


static func value_of(o: OptionButton) -> Variant:
	return o.get_item_metadata(o.selected) if o.selected >= 0 else null


## A field with its label above (the browser's <label>) or its hint under it (".hint").
static func labelled(control: Control, text: String, above := true) -> VBoxContainer:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 2)
	v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	if above:
		v.add_child(label(text, 12, Color("#b9c3d0")))
		v.add_child(control)
	else:
		v.add_child(control)
		v.add_child(hint(text))
	return v


## A line of text with an (i) that shows the longer explanation (the browser's tipline).
static func tipline(text: String, tip: String) -> HBoxContainer:
	var r := HBoxContainer.new()
	r.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var l := hint(text)
	l.custom_minimum_size.x = 140
	r.add_child(l)
	var i := button("i", "small ghost", tip)
	i.custom_minimum_size = Vector2(24, 22)
	i.pressed.connect(func(): i.tooltip_text = tip)
	r.add_child(i)
	return r


## A card that folds (details.card): { panel, head (Button), meta (Label), body (VBoxContainer) }.
static func card(parent: Control, title: String) -> Dictionary:
	var panel := PanelContainer.new()
	var s := box(CARD, 10, 1, LINE)
	s.content_margin_left = 0
	s.content_margin_right = 0
	s.content_margin_top = 0
	s.content_margin_bottom = 0
	panel.add_theme_stylebox_override("panel", s)
	panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	parent.add_child(panel)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 0)
	panel.add_child(col)
	var head_bg := PanelContainer.new()
	var hs := box(CARD_HEAD, 10, 0)
	hs.corner_radius_bottom_left = 0
	hs.corner_radius_bottom_right = 0
	hs.content_margin_left = 10
	hs.content_margin_right = 12
	hs.content_margin_top = 2
	hs.content_margin_bottom = 2
	head_bg.add_theme_stylebox_override("panel", hs)
	col.add_child(head_bg)
	var head_row := HBoxContainer.new()
	head_bg.add_child(head_row)
	var head := Button.new()
	head.flat = true
	head.focus_mode = Control.FOCUS_NONE
	head.alignment = HORIZONTAL_ALIGNMENT_LEFT
	head.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_theme_font_size_override("font_size", 14)
	head.add_theme_color_override("font_color", TEXT)
	head_row.add_child(head)
	var meta := label("", 11, MUTED, false)
	meta.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	meta.custom_minimum_size.x = 10
	meta.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	meta.size_flags_stretch_ratio = 1.2
	meta.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	meta.mouse_filter = Control.MOUSE_FILTER_PASS
	head_row.add_child(meta)
	var margin := MarginContainer.new()
	for side in ["left", "right"]:
		margin.add_theme_constant_override("margin_" + side, 14)
	margin.add_theme_constant_override("margin_top", 10)
	margin.add_theme_constant_override("margin_bottom", 14)
	col.add_child(margin)
	var body := VBoxContainer.new()
	body.add_theme_constant_override("separation", 8)
	margin.add_child(body)
	margin.visible = open_cards.get(title, false)
	var show := func():
		head.text = ("▾  " if margin.visible else "▸  ") + title
	show.call()
	head.pressed.connect(func():
		margin.visible = not margin.visible
		open_cards[title] = margin.visible
		show.call())
	return {"panel": panel, "head": head, "meta": meta, "body": body, "margin": margin, "title": title}


## A part of a card that folds (details.inner): { head, body }.
static func fold(parent: Control, title: String, open := false) -> VBoxContainer:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 4)
	parent.add_child(v)
	var head := Button.new()
	head.flat = true
	head.focus_mode = Control.FOCUS_NONE
	head.alignment = HORIZONTAL_ALIGNMENT_LEFT
	head.add_theme_font_size_override("font_size", 11)
	head.add_theme_color_override("font_color", MUTED)
	v.add_child(head)
	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 10)
	v.add_child(margin)
	var body := VBoxContainer.new()
	body.add_theme_constant_override("separation", 6)
	margin.add_child(body)
	margin.visible = open
	var show := func(): head.text = ("▾  " if margin.visible else "▸  ") + title.to_upper()
	show.call()
	head.pressed.connect(func():
		margin.visible = not margin.visible
		show.call())
	return body


## A window over the editor (the browser's dialogs): a head with its title and ×, a content that scrolls.
static func dialog(host: Control, title: String, size := Vector2(560, 520)) -> Dictionary:
	var win := Window.new()
	win.title = title
	win.size = Vector2i(size)
	win.wrap_controls = false
	win.transient = true
	win.exclusive = false
	win.unresizable = false
	win.visible = false
	win.close_requested.connect(func(): win.hide())
	host.add_child(win)
	var bg := PanelContainer.new()
	bg.add_theme_stylebox_override("panel", box(SIDE, 0, 0))
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	bg.theme = host.theme if host.theme != null else make_theme()
	win.add_child(bg)
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	bg.add_child(scroll)
	var margin := MarginContainer.new()
	margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 14)
	scroll.add_child(margin)
	var body := VBoxContainer.new()
	body.add_theme_constant_override("separation", 8)
	margin.add_child(body)
	return {"window": win, "body": body}


## A floating bar over the 3D view (.float).
static func float_panel() -> PanelContainer:
	var p := PanelContainer.new()
	var s := box(FLOAT_BG, 12, 1, Color("#2f3845"))
	s.content_margin_left = 10
	s.content_margin_right = 10
	s.content_margin_top = 8
	s.content_margin_bottom = 8
	p.add_theme_stylebox_override("panel", s)
	return p


## A number field (input type=number) with an optional slider under it and a hint: the value is NaN when it is empty.
class NumberField:
	extends VBoxContainer
	signal edited(value: float)
	signal committed(value: float)

	var edit: LineEdit
	var slider: HSlider = null
	var hint_label: Label = null
	var step := 0.01
	var lo := -INF
	var hi := INF
	var _quiet := false

	func _init(hint_text := "", step_size := 0.01, range_lo := NAN, range_hi := NAN, placeholder := "") -> void:
		add_theme_constant_override("separation", 2)
		size_flags_horizontal = Control.SIZE_EXPAND_FILL
		step = step_size
		edit = EditorStyle.line_edit("", placeholder)
		edit.custom_minimum_size.x = 50
		add_child(edit)
		edit.text_changed.connect(func(t: String):
			if not _quiet and t.strip_edges().is_valid_float():
				_sync_slider()
				edited.emit(float(t)))
		edit.text_submitted.connect(func(_t: String):
			edit.release_focus())
		edit.focus_exited.connect(func():
			if not _quiet:
				committed.emit(value()))
		if not is_nan(range_lo) and not is_nan(range_hi) and range_hi > range_lo:
			lo = range_lo
			hi = range_hi
			slider = HSlider.new()
			slider.min_value = lo
			slider.max_value = hi
			slider.step = step if step > 0.0 else 0.001
			slider.focus_mode = Control.FOCUS_NONE
			slider.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			slider.custom_minimum_size.y = 12
			slider.value_changed.connect(func(x: float):
				if _quiet:
					return
				_quiet = true
				edit.text = _fmt(x)
				_quiet = false
				edited.emit(x)
				committed.emit(x))
			add_child(slider)
		if hint_text != "":
			hint_label = EditorStyle.hint(hint_text)
			add_child(hint_label)

	func value() -> float:
		var t := edit.text.strip_edges()
		return float(t) if t.is_valid_float() else NAN

	func set_value(v: Variant) -> void:
		_quiet = true
		if v == null or ((v is float) and is_nan(v)):
			edit.text = ""
		else:
			edit.text = _fmt(float(v))
		_sync_slider()
		_quiet = false

	func set_range(a: float, b: float, why := "") -> void:
		lo = minf(a, b)
		hi = maxf(a, b)
		if slider != null:
			_quiet = true
			slider.min_value = lo
			slider.max_value = hi
			_quiet = false
		tooltip_text = why
		_sync_slider()

	func _sync_slider() -> void:
		if slider == null:
			return
		var v := value()
		var was := _quiet
		_quiet = true
		if not is_nan(v):
			slider.min_value = minf(lo, v)
			slider.max_value = maxf(hi, v)
			slider.value = v
		_quiet = was

	func _fmt(x: float) -> String:
		var digits := 0 if step >= 1.0 else (1 if step >= 0.1 else (2 if step >= 0.01 else (3 if step >= 0.001 else 4)))
		var s := String.num(x, digits + 2)
		if s.contains("."):
			s = s.rstrip("0").trim_suffix(".")
		return s
