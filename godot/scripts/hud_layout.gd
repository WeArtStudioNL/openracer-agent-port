class_name HudLayout
extends CanvasLayer
## Where the HUD is, how big and how see-through (web/js/HudLayout.js): every element of the HUD (the gauge, the boost,
## the lap times, the tyres and the fuel, and on a touch screen the pedals and the buttons) is a Control in the group
## "hud_element" with the metas hud_id and hud_label. The layout (Settings "hud_layout": id -> {x, y as parts of the
## window, s the scale, o the opacity}) is put on them by apply(), on top of where they are anchored.
##
## The editor (Hud.edit_layout, Settings, Display and sound, Edit HUD…): the game is held; a click on an element or on
## its name chooses it, a drag moves it, the sliders scale it and make it see-through; Reset element, Reset all,
## Cancel (Esc) and Save.

signal closed

const MIN_SCALE := 0.4
const MAX_SCALE := 2.5
const MIN_OPACITY := 0.1

var working := {}
var selected := ""
var _boxes: Control
var _panel: PanelContainer
var _chips: HFlowContainer
var _help: Label
var _size: HSlider
var _opacity: HSlider
var _size_text: Label
var _opacity_text: Label
var _drag := {}


## Puts a layout on the elements that exist now.
static func apply(tree: SceneTree, layout: Dictionary) -> void:
	var view := tree.root.get_visible_rect().size
	for el: Control in tree.get_nodes_in_group("hud_element"):
		if not el.has_meta("hud_base"):
			el.set_meta("hud_base", [el.offset_left, el.offset_top, el.offset_right, el.offset_bottom])
		var base: Array = el.get_meta("hud_base")
		var v: Dictionary = layout.get(str(el.get_meta("hud_id", "")), {})
		var dx := float(v.get("x", 0.0)) * view.x
		var dy := float(v.get("y", 0.0)) * view.y
		el.offset_left = base[0] + dx
		el.offset_top = base[1] + dy
		el.offset_right = base[2] + dx
		el.offset_bottom = base[3] + dy
		var s := float(v.get("s", 1.0))
		el.pivot_offset = el.size / 2.0
		el.scale = Vector2(s, s)
		el.modulate.a = float(v.get("o", 1.0))


## An element moved its own anchored place (the gauge grows with the window): its base is taken again.
static func rebase(el: Control) -> void:
	el.remove_meta("hud_base")


static func is_default(v: Dictionary) -> bool:
	return absf(float(v.get("x", 0))) < 1e-4 and absf(float(v.get("y", 0))) < 1e-4 and is_equal_approx(float(v.get("s", 1)), 1.0) \
		and is_equal_approx(float(v.get("o", 1)), 1.0)


func _ready() -> void:
	layer = 30
	process_mode = Node.PROCESS_MODE_ALWAYS
	working = Settings.get_value("hud_layout").duplicate(true)
	_boxes = Control.new()
	_boxes.set_anchors_preset(Control.PRESET_FULL_RECT)
	_boxes.mouse_filter = Control.MOUSE_FILTER_STOP
	_boxes.draw.connect(_draw_boxes)
	_boxes.gui_input.connect(_catch)
	add_child(_boxes)
	var shade := ColorRect.new()
	shade.color = Color(0.03, 0.04, 0.05, 0.35)
	shade.set_anchors_preset(Control.PRESET_FULL_RECT)
	shade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_boxes.add_child(shade)
	_build_panel()
	_refresh()
	RunLog.event("HUD editor open")


func _build_panel() -> void:
	_panel = PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.086, 0.106, 0.133, 0.96)
	sb.border_color = Color("#323c4a")
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(10)
	sb.set_content_margin_all(12)
	_panel.add_theme_stylebox_override("panel", sb)
	_panel.custom_minimum_size = Vector2(560, 0)
	_panel.anchor_left = 0.5
	_panel.anchor_right = 0.5
	_panel.offset_left = -280
	_panel.offset_right = 280
	_panel.offset_top = 10
	add_child(_panel)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 8)
	_panel.add_child(box)
	var head := HBoxContainer.new()
	var title := Label.new()
	title.text = "Edit HUD"
	title.add_theme_font_size_override("font_size", 17)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(title)
	var fold := Button.new()
	fold.icon = _icon("chevron-up")
	fold.tooltip_text = "Fold the panel"
	head.add_child(fold)
	box.add_child(head)
	var body := VBoxContainer.new()
	body.add_theme_constant_override("separation", 8)
	box.add_child(body)
	fold.pressed.connect(func():
		body.visible = not body.visible
		fold.icon = _icon("chevron-up" if body.visible else "chevron-down"))
	_help = Label.new()
	_help.modulate = Color(0.55, 0.6, 0.64)
	_help.autowrap_mode = TextServer.AUTOWRAP_WORD
	body.add_child(_help)
	_chips = HFlowContainer.new()
	body.add_child(_chips)
	var rows := _slider_row(body, "Size", MIN_SCALE * 100.0, MAX_SCALE * 100.0)
	_size = rows[0]
	_size_text = rows[1]
	_size.value_changed.connect(func(v: float):
		if selected != "":
			_entry(selected)["s"] = v / 100.0
			_size_text.text = "%d%%" % roundi(v)
			apply(get_tree(), working))
	rows = _slider_row(body, "Opacity", MIN_OPACITY * 100.0, 100.0)
	_opacity = rows[0]
	_opacity_text = rows[1]
	_opacity.value_changed.connect(func(v: float):
		if selected != "":
			_entry(selected)["o"] = v / 100.0
			_opacity_text.text = "%d%%" % roundi(v)
			apply(get_tree(), working))
	var foot := HBoxContainer.new()
	box.add_child(foot)
	_button(foot, "Reset element", "rotate-ccw", func():
		if selected != "":
			working.erase(selected)
			apply(get_tree(), working)
			_refresh())
	_button(foot, "Reset all", "", func():
		working = {}
		apply(get_tree(), working)
		_refresh())
	var gap := Control.new()
	gap.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	foot.add_child(gap)
	_button(foot, "Cancel", "x", cancel)
	var save_button := _button(foot, "Save", "check", save)
	save_button.grab_focus.call_deferred()
	if ResourceLoader.exists("res://scripts/movable.gd"):
		load("res://scripts/movable.gd").call("make", _panel, "hud-editor", head)


func _icon(icon_name: String) -> Texture2D:
	if ResourceLoader.exists("res://scripts/icons.gd"):
		return load("res://scripts/icons.gd").call("texture", icon_name, 16)
	return null


func _button(parent: Control, text: String, icon_name: String, on: Callable) -> Button:
	var b := Button.new()
	b.text = text
	if icon_name != "":
		b.icon = _icon(icon_name)
	b.pressed.connect(on)
	parent.add_child(b)
	return b


func _slider_row(parent: Control, text: String, lo: float, hi: float) -> Array:
	var row := HBoxContainer.new()
	var l := Label.new()
	l.text = text
	l.custom_minimum_size.x = 70
	row.add_child(l)
	var s := HSlider.new()
	s.scrollable = false              # (the wheel scrolls the page)
	s.min_value = lo
	s.max_value = hi
	s.step = 5
	s.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	s.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(s)
	var v := Label.new()
	v.custom_minimum_size.x = 56
	v.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	row.add_child(v)
	parent.add_child(row)
	return [s, v]


func _entry(id: String) -> Dictionary:
	if not working.has(id):
		working[id] = {"x": 0.0, "y": 0.0, "s": 1.0, "o": 1.0}
	return working[id]


func _elements() -> Array:
	return get_tree().get_nodes_in_group("hud_element").filter(func(el: Control): return el.is_visible_in_tree() and el.size.x > 2 and el.size.y > 2)


func _rect(el: Control) -> Rect2:
	return el.get_global_rect() if el.scale == Vector2.ONE else el.get_global_transform() * Rect2(Vector2.ZERO, el.size)


func _refresh() -> void:
	for c in _chips.get_children():
		c.queue_free()
	var shown := []
	for el: Control in _elements():
		var id := str(el.get_meta("hud_id", ""))
		shown.append(id)
		var b := Button.new()
		b.text = str(el.get_meta("hud_label", id))
		b.toggle_mode = true
		b.button_pressed = id == selected
		b.pressed.connect(func():
			selected = id
			_refresh())
		_chips.add_child(b)
	if selected != "" and selected not in shown:
		selected = ""
	var on := selected != ""
	_size.editable = on
	_opacity.editable = on
	_size.set_value_no_signal(float(_entry(selected).get("s", 1.0)) * 100.0 if on else 100.0)
	_opacity.set_value_no_signal(float(_entry(selected).get("o", 1.0)) * 100.0 if on else 100.0)
	_size_text.text = "%d%%" % roundi(_size.value)
	_opacity_text.text = "%d%%" % roundi(_opacity.value)
	var label := ""
	for el: Control in _elements():
		if str(el.get_meta("hud_id", "")) == selected:
			label = str(el.get_meta("hud_label", selected)).to_lower()
	if on:
		_help.text = "Drag %s on the screen to move it." % label
	elif shown.is_empty():
		_help.text = "There is nothing on the screen to move. Close the menu with the HUD on."
	else:
		_help.text = "Click an element or its name, then drag it. Nothing is chosen."


func _process(_delta: float) -> void:
	_boxes.queue_redraw()


## The dashed boxes round the elements, with their names; the chosen one in orange.
func _draw_boxes() -> void:
	var font := _boxes.get_theme_default_font()
	for el: Control in _elements():
		var r := _rect(el)
		var id := str(el.get_meta("hud_id", ""))
		if id == selected:
			_boxes.draw_rect(r, Color(1, 0.35, 0.12, 0.12))
			_boxes.draw_rect(r, Color("#3d7bff"), false, 2.0)
		else:
			_boxes.draw_dashed_line(r.position, Vector2(r.end.x, r.position.y), Color(1, 1, 1, 0.55), 2.0, 6.0)
			_boxes.draw_dashed_line(Vector2(r.end.x, r.position.y), r.end, Color(1, 1, 1, 0.55), 2.0, 6.0)
			_boxes.draw_dashed_line(r.end, Vector2(r.position.x, r.end.y), Color(1, 1, 1, 0.55), 2.0, 6.0)
			_boxes.draw_dashed_line(Vector2(r.position.x, r.end.y), r.position, Color(1, 1, 1, 0.55), 2.0, 6.0)
		var t := str(el.get_meta("hud_label", id))
		var w := font.get_string_size(t, HORIZONTAL_ALIGNMENT_LEFT, -1, 12).x + 12
		_boxes.draw_rect(Rect2(r.position + Vector2(0, -20), Vector2(w, 18)), Color(0.08, 0.09, 0.11, 0.85))
		_boxes.draw_string(font, r.position + Vector2(6, -6), t, HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color.WHITE)


## The element under a point: the smallest (a button on top of a bigger element).
func _hit(p: Vector2) -> String:
	var best := ""
	var area := INF
	for el: Control in _elements():
		var r := _rect(el).grow(6)
		if r.has_point(p) and r.get_area() < area:
			area = r.get_area()
			best = str(el.get_meta("hud_id", ""))
	return best


func _catch(event: InputEvent) -> void:
	var down: bool = (event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT) or event is InputEventScreenTouch
	if down and event.pressed:
		var id := _hit(event.position)
		selected = id
		if id != "":
			var v := _entry(id)
			_drag = {"x": event.position.x, "y": event.position.y, "sx": float(v.get("x", 0.0)), "sy": float(v.get("y", 0.0))}
		_refresh()
	elif down:
		_drag = {}
	elif (event is InputEventMouseMotion or event is InputEventScreenDrag) and not _drag.is_empty() and selected != "":
		var view := get_viewport().get_visible_rect().size
		var v := _entry(selected)
		v["x"] = float(_drag["sx"]) + (event.position.x - float(_drag["x"])) / view.x
		v["y"] = float(_drag["sy"]) + (event.position.y - float(_drag["y"])) / view.y
		apply(get_tree(), working)
		_keep_on_screen(v, view)


## The element stays on the screen: at least a part of it that can be found again.
func _keep_on_screen(v: Dictionary, view: Vector2) -> void:
	for el: Control in _elements():
		if str(el.get_meta("hud_id", "")) != selected:
			continue
		var r := _rect(el)
		var keep := minf(40.0, minf(r.size.x / 2.0, r.size.y / 2.0))
		var dx := 0.0
		var dy := 0.0
		if r.end.x < keep:
			dx = keep - r.end.x
		elif r.position.x > view.x - keep:
			dx = view.x - keep - r.position.x
		if r.end.y < keep:
			dy = keep - r.end.y
		elif r.position.y > view.y - keep:
			dy = view.y - keep - r.position.y
		if dx != 0.0 or dy != 0.0:
			v["x"] = float(v["x"]) + dx / view.x
			v["y"] = float(v["y"]) + dy / view.y
			_drag["x"] = float(_drag["x"]) + dx
			_drag["y"] = float(_drag["y"]) + dy
			apply(get_tree(), working)


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel") or (event is InputEventKey and event.pressed and event.physical_keycode == KEY_ESCAPE):
		cancel()
		get_viewport().set_input_as_handled()


func cancel() -> void:
	apply(get_tree(), Settings.get_value("hud_layout"))
	_close("cancelled")


func save() -> void:
	for id in working.keys():
		if is_default(working[id]):
			working.erase(id)
	Settings.set_value("hud_layout", working.duplicate(true))
	apply(get_tree(), working)
	_close("saved")


func _close(how: String) -> void:
	RunLog.event("HUD editor %s" % how)
	closed.emit()
	queue_free()
