class_name Movable
extends RefCounted
## A panel that floats over the game (the tuning menu, the debug view, the HUD editor) made movable and scalable, after
## web/js/Movable.js: drag it by its handle (or, without one, by any part of it that is not a control: a button, a field, a
## slider take their own clicks), and drag the grip at the bottom right corner to scale it. Where it is and how large it
## is, is kept per panel (a key) in Settings "panels", and a panel that would be out of the window is brought back.
##
## Movable.make(panel, "tuning", header); Movable.reset(panel, "tuning") puts it back as it was made.
## (a panel inside a Container is placed by the container: it is left as it is)

const CORNER := 18.0
const MIN_SIZE := Vector2(170, 80)


## Makes the panel movable; its place and size of the last time come back (once it has its size).
static func make(panel: Control, key: String, handle: Control = null) -> void:
	if panel == null or panel.has_meta("movable"):
		return
	var mover := Mover.new()
	mover.panel = panel
	mover.key = key
	mover.handle = handle
	mover.name = "Movable"
	panel.set_meta("movable", mover)
	panel.add_child(mover)


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
	var _grip: Control
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
		get_viewport().size_changed.connect(_keep)
		_restore_saved.call_deferred()

	func _process(_delta: float) -> void:
		if _grip != null and _grip.is_inside_tree():
			_grip.visible = panel.is_visible_in_tree() and _movable()
			_grip.global_position = panel.global_position + panel.size - _grip.size

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
		panel.position = Vector2(float(v["x"]), float(v["y"]))
		panel.size = Vector2(maxf(MIN_SIZE.x, float(v["w"])), maxf(MIN_SIZE.y, float(v["h"])))
		_keep()

	func restore() -> void:
		_free = false
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
