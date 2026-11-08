class_name TouchControls
extends CanvasLayer
## Controls for a phone or a tablet, drawn over the game (web/js/TouchControls.js). They only exist on a touch screen, or
## with the setting "touch" on (Settings), or --touch=1 on the command line (then the mouse works them too, for the tests).
##
## - The left half of the screen steers: touch anywhere and a stick appears under the finger; moving it left or right
##   steers. The stick follows a finger that goes far. How far the finger goes for the full steering is Settings
##   "touch_steer" (1 is the whole stick).
## - The pedals at the right: BRAKE and GAS, each for a thumb. They build up as the keys do (the time and the curve of the
##   Keyboard settings).
## - Buttons: shift up and down, the handbrake, reverse (held), and at the top reset, repair, camera, tuning and the menu.
##
## World reads steer (+1 left), throttle, brake and engaged every physics frame; the buttons are the actions of the game
## (Controls), pressed and let go as a key does. Every finger is its own: the car can be steered and braked while a
## button is held. The groups are HUD elements: the HUD editor moves, scales and fades them.

const STICK_DEAD := 0.06
const MOUSE := -100                  # (the index of the mouse, with --touch=1)
const PANEL := Color(0.153, 0.18, 0.216, 0.88)
const LINE := Color(0.227, 0.267, 0.322)
const ACCENT := Color(1.0, 0.353, 0.122)

var steer := 0.0
var throttle := 0.0
var brake := 0.0
var engaged := false
var world: Node

var _root: Control
var _stick_draw: Control
var _stick := {"id": null, "x0": 0.0, "y0": 0.0, "radius": 70.0, "travel": 70.0, "kx": 0.0, "ky": 0.0}
var _pedals := {"gas": {"id": null, "held": 0.0, "value": 0.0}, "brake": {"id": null, "held": 0.0, "value": 0.0}}
var _pedal_nodes := {}               # name -> [the pedal, its fill]
var _buttons: Array = []             # [{"node": Panel, "action": String, "tap": bool}]
var _held := {}                      # index of a finger -> the button it holds (an entry of _buttons)
var _forced := false
var _shown := true


## Whether the touch controls are wanted: a touch screen (setting "auto"), the setting on, or --touch=1.
static func wanted() -> bool:
	if Content.arg("touch") == "1":
		return true
	if Content.arg("touch") == "0":
		return false
	var s := str(Settings.get_value("touch"))
	return s == "on" or (s == "auto" and DisplayServer.is_touchscreen_available())


func setup(w: Node) -> void:
	world = w
	name = "TouchControls"


func _ready() -> void:
	layer = 4
	process_mode = Node.PROCESS_MODE_ALWAYS
	_forced = Content.arg("touch") == "1"
	_root = Control.new()
	_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_root)
	_stick_draw = Control.new()
	_stick_draw.set_anchors_preset(Control.PRESET_FULL_RECT)
	_stick_draw.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_stick_draw.draw.connect(_draw_stick)
	_root.add_child(_stick_draw)
	# the buttons of the gears (2 x 2), left of the pedals
	var grid := _group("buttons", "Gear buttons", Vector2(116, 116), Vector2(-14 - 104 - 12 - 86 - 12 - 116, -18 - 116))
	_button(grid, Rect2(0, 0, 54, 54), "shift_up", "chevron-up", "")
	_button(grid, Rect2(62, 0, 54, 54), "handbrake", "", "HB")
	_button(grid, Rect2(0, 62, 54, 54), "shift_down", "chevron-down", "")
	_button(grid, Rect2(62, 62, 54, 54), "reverse", "", "REV")
	_pedal(_group("brake", "Brake", Vector2(86, 128), Vector2(-14 - 104 - 12 - 86, -18 - 128)), "brake", "BRAKE", Color(0.9, 0.235, 0.196, 0.6))
	_pedal(_group("gas", "Gas", Vector2(104, 176), Vector2(-14 - 104, -18 - 176)), "gas", "GAS", Color(0.275, 0.784, 0.353, 0.55))
	# the top row: reset, repair, camera, tuning, menu (the Record button of the browser is the video of the replay)
	var top_items := [["reset", "rotate-ccw", "Reset"], ["repair", "wrench", "Repair"], ["camera", "camera", "Camera"],
		["tuning", "sliders", "Tune"], ["menu", "menu", "Menu"]]
	var width := top_items.size() * 52.0 - 8.0
	var top := _group("top", "Top buttons", Vector2(width, 44), Vector2(-12 - width, 12), true)
	for i in top_items.size():
		var it: Array = top_items[i]
		_button(top, Rect2(i * 52.0, 0, 44, 44), it[0], it[1], it[2], it[0] == "menu")
	RunLog.event("touch controls on%s" % (" (--touch=1: the mouse works them too)" if _forced else ""))


## A HUD element: a control anchored at the bottom right (or the top right), at its place from that corner.
func _group(id: String, text: String, size: Vector2, at: Vector2, from_top := false) -> Control:
	var g := Control.new()
	g.name = id
	g.mouse_filter = Control.MOUSE_FILTER_IGNORE
	g.set_anchors_preset(Control.PRESET_TOP_RIGHT if from_top else Control.PRESET_BOTTOM_RIGHT)
	g.offset_left = at.x
	g.offset_top = at.y
	g.offset_right = at.x + size.x
	g.offset_bottom = at.y + size.y
	g.add_to_group("hud_element")
	g.set_meta("hud_id", id)
	g.set_meta("hud_label", text)
	_root.add_child(g)
	return g


func _box(colour: Color, radius: int) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = colour
	sb.border_color = LINE
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(radius)
	return sb


func _caption(text: String, size: int) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.8))
	l.add_theme_constant_override("outline_size", 3)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l


## A button that holds an action while a finger is on it (tap: the action once, when it is let go: the menu).
func _button(parent: Control, r: Rect2, action: String, icon: String, text: String, tap := false) -> void:
	var p := Panel.new()
	p.position = r.position
	p.size = r.size
	p.mouse_filter = Control.MOUSE_FILTER_IGNORE
	p.add_theme_stylebox_override("panel", _box(PANEL, 8))
	p.tooltip_text = Controls.label(action)
	var box := VBoxContainer.new()
	box.set_anchors_preset(Control.PRESET_FULL_RECT)
	box.alignment = BoxContainer.ALIGNMENT_CENTER
	box.add_theme_constant_override("separation", 0)
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	p.add_child(box)
	var small := r.size.y < 50.0
	if icon != "":
		var t := TextureRect.new()
		t.texture = Icons.texture(icon, 20 if small else 24)
		t.stretch_mode = TextureRect.STRETCH_KEEP_CENTERED
		t.mouse_filter = Control.MOUSE_FILTER_IGNORE
		box.add_child(t)
	if text != "":
		box.add_child(_caption(text, 9 if (small and icon != "") else 13))
	parent.add_child(p)
	_buttons.append({"node": p, "action": action, "tap": tap})


func _pedal(parent: Control, pedal_name: String, text: String, colour: Color) -> void:
	var p := Panel.new()
	p.set_anchors_preset(Control.PRESET_FULL_RECT)
	p.mouse_filter = Control.MOUSE_FILTER_IGNORE
	p.clip_contents = true
	p.add_theme_stylebox_override("panel", _box(PANEL, 10))
	var fill := ColorRect.new()
	fill.color = colour
	fill.mouse_filter = Control.MOUSE_FILTER_IGNORE
	fill.anchor_left = 0.0
	fill.anchor_right = 1.0
	fill.anchor_top = 1.0
	fill.anchor_bottom = 1.0
	p.add_child(fill)
	var l := _caption(text, 15)
	l.anchor_left = 0.0
	l.anchor_right = 1.0
	l.anchor_top = 1.0
	l.anchor_bottom = 1.0
	l.offset_top = -34
	l.offset_bottom = -12
	p.add_child(l)
	parent.add_child(p)
	_pedal_nodes[pedal_name] = [p, fill]


## How far a finger goes for the full steering: the stick of a hand, times the setting.
func _base_radius() -> float:
	var s := _root.get_viewport_rect().size
	return clampf(0.17 * minf(s.x, s.y), 50.0, 90.0)


func _travel() -> float:
	return _base_radius() * clampf(float(Settings.get_value("touch_steer")), 0.01, 1.0)


func _input(event: InputEvent) -> void:
	if not _shown:
		return
	if event is InputEventScreenTouch:
		if event.pressed:
			_down(event.index, event.position)
		else:
			_up(event.index)
	elif event is InputEventScreenDrag:
		_move(event.index, event.position)
	elif _forced and event is InputEventMouseButton and event.device != InputEvent.DEVICE_ID_EMULATION \
			and event.button_index == MOUSE_BUTTON_LEFT:
		if event.pressed:
			_down(MOUSE, event.position)
		else:
			_up(MOUSE)
	elif _forced and event is InputEventMouseMotion and event.device != InputEvent.DEVICE_ID_EMULATION:
		_move(MOUSE, event.position)


## The rectangle of a control as it is on the screen (with the scale of the HUD editor).
func _rect_of(c: Control) -> Rect2:
	return c.get_global_transform() * Rect2(Vector2.ZERO, c.size)


func _down(index: int, pos: Vector2) -> void:
	for b in _buttons:
		var node: Control = b["node"]
		if node.is_visible_in_tree() and _rect_of(node).grow(4).has_point(pos):
			_held[index] = b
			_box_of(b, true)
			if not b["tap"]:
				_action(b["action"], true)
			get_viewport().set_input_as_handled()
			return
	for pedal_name in _pedal_nodes:
		var p: Control = _pedal_nodes[pedal_name][0]
		if p.is_visible_in_tree() and _rect_of(p).has_point(pos):
			_pedals[pedal_name]["id"] = index
			get_viewport().set_input_as_handled()
			return
	if pos.x < _root.get_viewport_rect().size.x * 0.5:
		# (a finger that is down already, and a new one: the old one lost its end, the new touch takes over)
		_stick["id"] = index
		_stick["x0"] = pos.x
		_stick["y0"] = pos.y
		_stick["kx"] = pos.x
		_stick["ky"] = pos.y
		_stick["radius"] = _base_radius()
		_stick["travel"] = _travel()
		steer = 0.0
		_stick_draw.queue_redraw()
		get_viewport().set_input_as_handled()


func _move(index: int, pos: Vector2) -> void:
	if _stick["id"] != index:
		return
	var dx: float = pos.x - _stick["x0"]
	var travel: float = _stick["travel"]
	var limit := travel * 1.35
	# the stick follows a finger that goes far, so the hand does not run out of room
	if absf(dx) > limit:
		_stick["x0"] = pos.x - signf(dx) * limit
		dx = signf(dx) * limit
	var n := clampf(dx / travel, -1.0, 1.0)
	var r: float = _stick["radius"]
	_stick["kx"] = _stick["x0"] + n * travel
	_stick["ky"] = _stick["y0"] + clampf((pos.y - _stick["y0"]) / r, -0.35, 0.35) * r * 0.5
	# a little progressive, so small movements are fine adjustments (+ is to the left, as Input.get_axis)
	var a := absf(n)
	steer = 0.0 if a < STICK_DEAD else -signf(n) * pow((a - STICK_DEAD) / (1.0 - STICK_DEAD), 1.25)
	_stick_draw.queue_redraw()
	get_viewport().set_input_as_handled()


func _up(index: int) -> void:
	if _stick["id"] == index:
		_stick["id"] = null
		steer = 0.0
		_stick_draw.queue_redraw()
	for pedal_name in _pedals:
		if _pedals[pedal_name]["id"] == index:
			_pedals[pedal_name]["id"] = null
	if _held.has(index):
		var b: Dictionary = _held[index]
		_held.erase(index)
		_box_of(b, false)
		if b["tap"]:
			_action(b["action"], true)
		_action(b["action"], false)


func _box_of(b: Dictionary, down: bool) -> void:
	(b["node"] as Panel).add_theme_stylebox_override("panel", _box(ACCENT if down else PANEL, 8))


## An action pressed or let go, as a key does it (World reads the events and the state of the actions).
func _action(action: String, pressed: bool) -> void:
	var e := InputEventAction.new()
	e.action = action
	e.pressed = pressed
	e.strength = 1.0 if pressed else 0.0
	Input.parse_input_event(e)


func _release_all() -> void:
	_stick["id"] = null
	steer = 0.0
	for pedal_name in _pedals:
		_pedals[pedal_name]["id"] = null
	for index in _held.keys():
		var b: Dictionary = _held[index]
		_box_of(b, false)
		if not b["tap"]:
			_action(b["action"], false)
	_held.clear()
	_stick_draw.queue_redraw()


func _draw_stick() -> void:
	if _stick["id"] == null:
		return
	var travel: float = _stick["travel"]
	var ring := maxf(travel, 28.0)       # (the ring is as wide as the finger goes: it shows how far the full steering is)
	var c := Vector2(_stick["x0"], _stick["y0"])
	_stick_draw.draw_circle(c, ring, Color(0, 0, 0, 0.22))
	_stick_draw.draw_arc(c, ring, 0.0, TAU, 64, Color(1, 1, 1, 0.45), 2.0, true)
	var k := Vector2(_stick["kx"], _stick["ky"])
	_stick_draw.draw_circle(k, 28.0, Color(1, 1, 1, 0.55))
	_stick_draw.draw_arc(k, 28.0, 0.0, TAU, 48, Color(1, 1, 1, 0.85), 2.0, true)


## Hidden while the game is paused (the menus), and everything let go then; the pedals build up as the keys do.
func _process(delta: float) -> void:
	var show := not get_tree().paused
	if show != _shown:
		_shown = show
		_root.visible = show
		if not show:
			_release_all()
	for pedal_name in _pedals:
		var p: Dictionary = _pedals[pedal_name]
		var key := "throttle" if pedal_name == "gas" else "brake"
		var time := maxf(0.02, float(Settings.get_value("key_%s_time" % key)))
		var curve := float(Settings.get_value("key_%s_curve" % key))
		if p["id"] != null:
			p["held"] += delta
			p["value"] = pow(minf(1.0, p["held"] / time), curve)
		else:
			p["held"] = 0.0
			p["value"] = 0.0
		var fill: ColorRect = _pedal_nodes[pedal_name][1]
		fill.offset_top = -(_pedal_nodes[pedal_name][0] as Control).size.y * p["value"]
	throttle = _pedals["gas"]["value"]
	brake = _pedals["brake"]["value"]
	engaged = _stick["id"] != null or _pedals["gas"]["id"] != null or _pedals["brake"]["id"] != null or throttle > 0.0 or brake > 0.0
