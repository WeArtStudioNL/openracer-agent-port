class_name MenuStyle
extends RefCounted
## The look of the main menu: the colours of GripWorks (deep cobalt, a blue accent, ice for the focus) and the pieces
## of MainMenu.js
## (a button, a chip, a card, a tile), as StyleBoxFlat.

const BG := Color("#0a0f1c")
const BG2 := Color("#0e1424")
const PANEL := Color("#121a2e")
const LINE := Color("#212c45")
const TEXT := Color("#dbe4f5")
const MUTED := Color("#8e9cb8")
const HEAD := Color("#f3f7ff")
const ACCENT := Color("#3d7bff")
const ACCENT2 := Color("#9fe3ff")
const BAD := Color("#ff6b62")
const OK := Color("#3ddc84")


static func flat(fill: Color, border := Color(0, 0, 0, 0), radius := 10, width := 1, pad := 0) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = fill
	s.border_color = border
	s.set_border_width_all(width if border.a > 0.0 else 0)
	s.set_corner_radius_all(radius)
	s.set_content_margin_all(pad)
	s.anti_aliasing = true
	return s


## The theme of the menu: dark panels, orange for what is chosen, the focus of the keyboard and the gamepad in the
## second accent (an outline of #9fe3ff, as PadNav.js draws it).
static func make_theme() -> Theme:
	var t := Theme.new()
	t.default_font_size = 16
	t.set_color("font_color", "Label", TEXT)
	for kind in ["Button", "OptionButton", "LinkButton", "CheckBox"]:
		t.set_color("font_color", kind, TEXT)
		t.set_color("font_hover_color", kind, HEAD)
		t.set_color("font_focus_color", kind, HEAD)
		t.set_color("font_pressed_color", kind, HEAD)
	for kind in ["Button", "OptionButton"]:
		t.set_stylebox("normal", kind, flat(PANEL, LINE, 8, 1, 10))
		t.set_stylebox("hover", kind, flat(PANEL, MUTED, 8, 1, 10))
		t.set_stylebox("pressed", kind, flat(BG2, MUTED, 8, 1, 10))
		t.set_stylebox("disabled", kind, flat(Color(PANEL, 0.5), LINE, 8, 1, 10))
		t.set_stylebox("focus", kind, focus_box())
	t.set_stylebox("panel", "PanelContainer", flat(PANEL, LINE, 12, 1, 22))
	t.set_stylebox("focus", "LinkButton", focus_box())
	t.set_stylebox("focus", "CheckBox", focus_box())
	t.set_color("font_color", "LinkButton", MUTED)
	t.set_color("font_hover_color", "LinkButton", HEAD)
	return t


static func focus_box() -> StyleBoxFlat:
	var f := flat(Color(0, 0, 0, 0), ACCENT2, 10, 2)
	f.expand_margin_left = 2
	f.expand_margin_right = 2
	f.expand_margin_top = 2
	f.expand_margin_bottom = 2
	return f


## A button of the menu: "primary" (orange), "ghost" (no fill) or "" (a panel).
static func button(text: String, kind := "", on_press: Callable = Callable()) -> Button:
	var b := Button.new()
	b.text = text
	b.focus_mode = Control.FOCUS_ALL
	if kind == "primary":
		b.add_theme_stylebox_override("normal", flat(ACCENT, ACCENT, 8, 1, 10))
		b.add_theme_stylebox_override("hover", flat(ACCENT.lightened(0.1), ACCENT, 8, 1, 10))
		b.add_theme_stylebox_override("pressed", flat(ACCENT.darkened(0.1), ACCENT, 8, 1, 10))
		b.add_theme_color_override("font_color", Color.WHITE)
	elif kind == "ghost":
		b.add_theme_stylebox_override("normal", flat(Color(0, 0, 0, 0), LINE, 8, 1, 10))
	elif kind == "danger":
		b.add_theme_stylebox_override("hover", flat(PANEL, BAD, 8, 1, 10))
		b.add_theme_color_override("font_hover_color", BAD)
	if on_press.is_valid():
		b.pressed.connect(on_press)
	return b


## A choice of a row (MainMenu.js .chip): orange when it is on.
static func chip(text: String, on: bool, on_press: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.focus_mode = Control.FOCUS_ALL
	var fill := ACCENT if on else PANEL
	var border := ACCENT if on else LINE
	for st in [["normal", border], ["hover", MUTED if not on else ACCENT], ["pressed", border]]:
		var box := flat(fill, st[1], 18, 1, 7)
		box.content_margin_left = 16
		box.content_margin_right = 16
		b.add_theme_stylebox_override(st[0], box)
	b.add_theme_stylebox_override("focus", focus_box())
	if on:
		b.add_theme_color_override("font_color", Color.WHITE)
		b.add_theme_color_override("font_focus_color", Color.WHITE)
		b.add_theme_color_override("font_hover_color", Color.WHITE)
	b.pressed.connect(on_press)
	return b


## A card or a tile (a Button with children that do not take the mouse): the frame orange when it is chosen.
static func card(selected: bool, radius := 10, fill := PANEL) -> Button:
	var b := Button.new()
	b.focus_mode = Control.FOCUS_ALL
	b.clip_contents = true
	var border := ACCENT if selected else LINE
	b.add_theme_stylebox_override("normal", flat(fill, border, radius, 2 if selected else 1))
	b.add_theme_stylebox_override("hover", flat(fill, ACCENT if selected else MUTED, radius, 2 if selected else 1))
	b.add_theme_stylebox_override("pressed", flat(fill, ACCENT, radius, 2))
	b.add_theme_stylebox_override("focus", focus_box())
	return b


static func label(text: String, size := 16, colour := TEXT, wrap := false) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", colour)
	if wrap:
		l.autowrap_mode = TextServer.AUTOWRAP_WORD
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l


## The logo of GripWorks: two slanted bars like the blocks of a tread (blue and ice), then GRIP in white and WORKS in
## the blue.
static func logo(big: bool) -> HBoxContainer:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 16 if big else 10)
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var bars := HBoxContainer.new()
	bars.add_theme_constant_override("separation", 5 if big else 3)
	bars.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var h := 38 if big else 20
	for c: Color in [ACCENT, ACCENT2]:
		var bar := Panel.new()
		bar.custom_minimum_size = Vector2(h * 0.38, h)
		var box := flat(c, Color(0, 0, 0, 0), 4 if big else 2)
		box.skew = Vector2(0.35, 0)
		bar.add_theme_stylebox_override("panel", box)
		bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
		bars.add_child(bar)
	var holder := CenterContainer.new()
	holder.add_child(bars)
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.add_child(holder)
	var words := HBoxContainer.new()
	words.add_theme_constant_override("separation", 0)
	words.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for w: Array in [["GRIP", HEAD], ["WORKS", ACCENT]]:
		var l := label(w[0], 46 if big else 22, w[1])
		l.add_theme_constant_override("outline_size", 0)
		words.add_child(l)
	row.add_child(words)
	return row


## A badge after a name: "my garage" or "folder" (Garage.js).
static func badge(text: String) -> PanelContainer:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", flat(LINE, Color(0, 0, 0, 0), 10, 0, 3))
	var l := label(text.to_upper(), 10, TEXT)
	p.add_child(l)
	p.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return p


## Every child of a card lets the mouse through to the card.
static func pass_mouse(node: Node) -> void:
	for c in node.get_children():
		if c is Control and not c is Button and not c is OptionButton:
			(c as Control).mouse_filter = Control.MOUSE_FILTER_IGNORE
		pass_mouse(c)
