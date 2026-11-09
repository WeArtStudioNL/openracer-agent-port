class_name Movable
extends RefCounted
## A panel that floats over the game (the tuning menu, the debug view, the HUD editor) made movable and scalable, after
## web/js/Movable.js: drag it by its handle (or, without one, by any part of it that is not a control: a button, a field, a
## slider take their own clicks), and drag the grip at the bottom right corner to scale it; a window (edges) scales at every
## edge and corner, and what it holds scrolls in its body (framed). Where it is and how large it
## is, is kept per panel (a key) in Settings "panels", and a panel that would be out of the window is brought back.
##
## Movable.make(panel, "tuning", header); Movable.reset(panel, "tuning") puts it back as it was made.
## (a panel inside a Container is placed by the container: it is left as it is)

const CORNER := 18.0
const MIN_SIZE := Vector2(170, 80)
const BAND := 7.0                   # px: the band along the border of a window that scales it
const EDGE_DIRS := [Vector2i(-1, 0), Vector2i(1, 0), Vector2i(0, -1), Vector2i(0, 1), Vector2i(-1, -1), Vector2i(1, -1), Vector2i(-1, 1)]


## Makes the panel movable; its place and size of the last time come back (once it has its size).
static func make(panel: Control, key: String, handle: Control = null, edges := false, body: ScrollContainer = null) -> void:
	if panel == null or panel.has_meta("movable"):
		return
	var mover := Mover.new()
	mover.panel = panel
	mover.key = key
	mover.handle = handle
	mover.edges = edges
	mover.body = body
	mover.name = "Movable"
	panel.set_meta("movable", mover)
	panel.add_child(mover)
	panel.gui_input.connect(_keep_the_wheel.bind(panel))


## The wheel over a panel is for the panel: a list at its end lets it through, and then the camera behind it would zoom.
static func _keep_the_wheel(event: InputEvent, panel: Control) -> void:
	var mb := event as InputEventMouseButton
	var wheel := mb != null and mb.button_index in [MOUSE_BUTTON_WHEEL_UP, MOUSE_BUTTON_WHEEL_DOWN, MOUSE_BUTTON_WHEEL_LEFT, MOUSE_BUTTON_WHEEL_RIGHT]
	if wheel or event is InputEventPanGesture:
		panel.accept_event()


## A window (Movable.js frame): the head (the first child of content, the only child of the panel) stays at the top and
## drags the panel, what is under it scrolls by itself, and every edge and corner scales it.
static func framed(panel: Control, key: String, head: Control, content: Control) -> void:
	var outer := VBoxContainer.new()
	outer.add_theme_constant_override("separation", 4)
	panel.remove_child(content)
	panel.add_child(outer)
	content.remove_child(head)
	outer.add_child(head)
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	outer.add_child(scroll)
	content.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(content)
	make(panel, key, head, true, scroll)


## Back to the place and the size that the panel was made with, and forgotten.
static func reset(panel: Control, key: String) -> void:
	if panel != null and panel.has_meta("movable"):
		(panel.get_meta("movable") as Mover).restore()
	var all: Dictionary = (Settings.get_value("panels") as Dictionary).duplicate()
	if all.has(key):
		all.erase(key)
		Settings.set_value("panels", all)


## The helper that lives in the panel: it takes the drags and keeps the place.
class Mover:
	extends Node

	var panel: Control
	var key := ""
	var handle: Control = null
	var edges := false
	var body: ScrollContainer = null
	var _grip: Control
	var _edge_grips := []            # {control, dir}: the edges and the other corners of a window
	var _dir := Vector2i.ZERO
	var _sized := false              # the player gave it a size: the body scrolls and does not ask for room any more
	var _body_min := Vector2.ZERO    # (a body with a size of its own until then)
	var _free := false
	var _original := {}
	var _drag := ""                  # "move", "size" or ""
	var _from := Vector2.ZERO        # the mouse at the start of the drag
	var _start := Rect2()

	func _ready() -> void:
		_original = {"anchors": [panel.anchor_left, panel.anchor_top, panel.anchor_right, panel.anchor_bottom],
			"offsets": [panel.offset_left, panel.offset_top, panel.offset_right, panel.offset_bottom]}
		(handle if handle != null else panel).gui_input.connect(_on_input.bind(false))
		if handle != null:
			handle.mouse_default_cursor_shape = Control.CURSOR_MOVE
			if handle.mouse_filter == Control.MOUSE_FILTER_IGNORE:
				handle.mouse_filter = Control.MOUSE_FILTER_PASS
		# the grip of the corner: a small control of its own over the panel (top level: the panel is often a container)
		_grip = Control.new()
		_grip.name = "Grip"
		_grip.top_level = true
		_grip.size = Vector2(CORNER, CORNER)
		_grip.mouse_default_cursor_shape = Control.CURSOR_FDIAGSIZE
		_grip.mouse_filter = Control.MOUSE_FILTER_STOP
		_grip.gui_input.connect(_on_input.bind(true))
		_grip.draw.connect(_draw_grip)
		panel.add_child.call_deferred(_grip)
		if edges:
			for dir: Vector2i in EDGE_DIRS:
				var g := Control.new()
				g.top_level = true
				g.mouse_filter = Control.MOUSE_FILTER_STOP
				g.mouse_default_cursor_shape = Control.CURSOR_HSIZE if dir.y == 0 else (Control.CURSOR_VSIZE if dir.x == 0 else
					(Control.CURSOR_FDIAGSIZE if dir.x == dir.y else Control.CURSOR_BDIAGSIZE))
				g.gui_input.connect(_on_edge.bind(dir, g))
				panel.add_child.call_deferred(g)
				_edge_grips.append({"control": g, "dir": dir})
		if body != null:
			_body_min = body.custom_minimum_size
		get_viewport().size_changed.connect(_keep)
		_restore_saved.call_deferred()

	func _process(_delta: float) -> void:
		if _grip != null and _grip.is_inside_tree():
			_grip.visible = panel.is_visible_in_tree() and _movable()
			_grip.global_position = panel.global_position + panel.size - _grip.size
		for e in _edge_grips:
			_place_edge(e["control"], e["dir"])
		_fit_body()

	func _place_edge(g: Control, dir: Vector2i) -> void:
		if not g.is_inside_tree():
			return
		g.visible = panel.is_visible_in_tree() and _movable()
		var at := panel.global_position
		var s := panel.size
		g.size = Vector2(BAND if dir.x != 0 else s.x - 2.0 * BAND, BAND if dir.y != 0 else s.y - 2.0 * BAND)
		g.global_position = at + Vector2(BAND if dir.x == 0 else (0.0 if dir.x < 0 else s.x - BAND), BAND if dir.y == 0 else (0.0 if dir.y < 0 else s.y - BAND))

	## Until the player gives the window a size, its body has the room of what it holds (at most what the screen has).
	func _fit_body() -> void:
		if body == null or body.get_child_count() == 0:
			return
		var want := Vector2.ZERO
		if not _sized:
			var win := panel.get_viewport_rect().size
			want = _body_min if _body_min != Vector2.ZERO else (body.get_child(0) as Control).get_combined_minimum_size().min(win * Vector2(0.95, 0.7))
		if want != body.custom_minimum_size:
			body.custom_minimum_size = want
			if _free and not _sized:
				panel.reset_size()

	## (a panel that a Container places cannot be moved by hand)
	func _movable() -> bool:
		return not (panel.get_parent() is Container)

	func _draw_grip() -> void:
		var c := Color(1, 1, 1, 0.45)
		for i in 3:
			var d := 5.0 + i * 4.0
			_grip.draw_line(Vector2(CORNER - d, CORNER - 2), Vector2(CORNER - 2, CORNER - d), c, 1.5)

	func _on_input(event: InputEvent, corner: bool) -> void:
		if not _movable():
			return
		if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
			if event.pressed:
				_make_free()
				_drag = "size" if corner else "move"
				if corner:
					_give_size()
				_from = event.global_position
				_start = Rect2(panel.position, panel.size)
				(_grip if corner else (handle if handle != null else panel)).accept_event()
			elif _drag != "":
				_drag = ""
				_keep()
				_store()
		elif event is InputEventMouseMotion and _drag != "":
			var d: Vector2 = event.global_position - _from
			if _drag == "move":
				panel.position = _start.position + d
			else:
				panel.size = Vector2(maxf(MIN_SIZE.x, _start.size.x + d.x), maxf(MIN_SIZE.y, _start.size.y + d.y))

	func _give_size() -> void:
		_sized = true
		panel.custom_minimum_size = Vector2.ZERO
		_fit_body()

	## An edge or a corner of a window is dragged.
	func _on_edge(event: InputEvent, dir: Vector2i, g: Control) -> void:
		if not _movable():
			return
		if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
			if event.pressed:
				_make_free()
				_give_size()
				_drag = "edge"
				_dir = dir
				_from = event.global_position
				_start = Rect2(panel.position, panel.size)
				g.accept_event()
			elif _drag != "":
				_drag = ""
				_keep()
				_store()
		elif event is InputEventMouseMotion and _drag == "edge":
			_scale_edges(event.global_position - _from)

	func _scale_edges(d: Vector2) -> void:
		var least := panel.get_combined_minimum_size().max(MIN_SIZE)
		var r := _start
		if _dir.x != 0:
			var w := maxf(least.x, _start.size.x + d.x * _dir.x)
			r.position.x = _start.position.x + (_start.size.x - w if _dir.x < 0 else 0.0)
			r.size.x = w
		if _dir.y != 0:
			var h := maxf(least.y, _start.size.y + d.y * _dir.y)
			r.position.y = _start.position.y + (_start.size.y - h if _dir.y < 0 else 0.0)
			r.size.y = h
		panel.position = r.position
		panel.size = r.size

	## From the anchors it was made with to a place and a size of its own, as it is seen now.
	func _make_free() -> void:
		if _free:
			return
		_free = true
		var r := panel.get_global_rect()
		var parent_origin := Vector2.ZERO
		if panel.get_parent() is Control:
			parent_origin = (panel.get_parent() as Control).global_position
		panel.set_anchors_preset(Control.PRESET_TOP_LEFT)
		panel.position = r.position - parent_origin
		panel.size = r.size

	## A part of the panel stays in the window, and it is no larger than the window.
	func _keep() -> void:
		if not _free or not panel.is_visible_in_tree():
			return
		var win := panel.get_viewport_rect().size
		panel.size = Vector2(minf(panel.size.x, maxf(MIN_SIZE.x, win.x - 10.0)), minf(panel.size.y, maxf(MIN_SIZE.y, win.y - 10.0)))
		var p := panel.position
		p.x = clampf(p.x, 60.0 - panel.size.x, win.x - 60.0)
		p.y = clampf(p.y, 0.0, win.y - 40.0)
		if p.y + panel.size.y > win.y and panel.size.y <= win.y:
			p.y = maxf(0.0, win.y - panel.size.y - 5.0)
		panel.position = p

	func _store() -> void:
		var all: Dictionary = (Settings.get_value("panels") as Dictionary).duplicate()
		all[key] = {"x": panel.position.x, "y": panel.position.y, "w": panel.size.x, "h": panel.size.y}
		Settings.set_value("panels", all)

	func _restore_saved() -> void:
		var v: Variant = (Settings.get_value("panels") as Dictionary).get(key)
		if not (v is Dictionary) or float(v.get("w", 0)) <= 0.0 or not _movable():
			return
		_make_free()
		_give_size()
		panel.position = Vector2(float(v["x"]), float(v["y"]))
		panel.size = Vector2(maxf(MIN_SIZE.x, float(v["w"])), maxf(MIN_SIZE.y, float(v["h"])))
		_keep()

	func restore() -> void:
		_free = false
		_sized = false
		var a: Array = _original["anchors"]
		var o: Array = _original["offsets"]
		panel.anchor_left = a[0]
		panel.anchor_top = a[1]
		panel.anchor_right = a[2]
		panel.anchor_bottom = a[3]
		panel.offset_left = o[0]
		panel.offset_top = o[1]
		panel.offset_right = o[2]
		panel.offset_bottom = o[3]
