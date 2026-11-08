# gdlint: disable=max-public-methods
class_name CarEditorLayers
extends RefCounted
## The layers panel of the car editor (the #layers aside of car-editor.html): the cameras of the game, the model (its
## offset), the steering wheel, the suspension rig and the wheels, the exhaust points (add, remove, a window with their
## settings, a gizmo that moves them and one that turns them: W and E), and every named object of the model with an eye
## that hides it and an arrow that folds what is inside it, with a search. A camera that is selected shows what it sees in
## the thumbnail. The tools over the view (perspective or orthographic, reset, the standard views, the bars folded away)
## are made here too.

const LAYERS := [
	["Cameras"], ["follow", "1 Follow camera", "#37d67a"], ["look", "1 Follow camera: looks at", "#9be8b8"], ["cockpit", "2 Cockpit camera", "#ff9f43"],
	["Car"], ["model", "Model (offset)", "#c6cfdb"], ["steering", "Steering wheel", "#e0b040"], ["rig", "Suspension rig", "#9b8cff"],
	["Wheels"], ["wFR", "Front right", "#ff6b6b"], ["wFL", "Front left", "#5ec8ff"], ["wRR", "Rear right", "#ffd04d"], ["wRL", "Rear left", "#8ee26b"],
]
const EXHAUST_DEFAULTS := {"diameter": 0.08, "smoke": 1.0, "flame_length_cm": 30.0, "flame_width_cm": 12.0, "brightness": 1.0}
const EXHAUST_FIELDS := [["diameter", "Diameter", "cm", 2.0, 20.0, 0.5, 100.0], ["smoke", "Smoke", "%", 0.0, 300.0, 10.0, 100.0],
	["flame_length_cm", "Flame length", "cm", 1.0, 80.0, 1.0, 1.0], ["flame_width_cm", "Flame width", "cm", 1.0, 80.0, 1.0, 1.0],
	["brightness", "Brightness", "%", 20.0, 300.0, 10.0, 100.0]]
const RIG_PLAIN := "^(susp|steertierod|steerrack|coilover|damper|shock|strut|spring|rear|front|back|solid|live|axle)"

var ed: CarEditor
var selected := ""
var exhaust: Array = []              # { id, target, pipe, s }
var exhaust_mode := "move"
var flame_test := false              # the flames of the pops and bangs at the exhaust points, now and then (setFlameTest)
var targets := {}                    # layer -> the Node3D the gizmo moves
var panel: PanelContainer
var _list: VBoxContainer
var _search: LineEdit
var _thumb: TextureRect
var _thumb_label: Label
var _expanded := {}
var _parts_for: Variant = null
var _flames: ExhaustFlames = null
var _flame_timer := 0.0
var _chosen_part := ""
var _counter := 0
var _window: PanelContainer
var _window_body: VBoxContainer
var _window_title: Label
var _pos_fields: Array = []
var _rot_fields: Array = []
var _ortho_button: Button
var _side_tab: Button
var _layers_tab: Button


func _init(editor: CarEditor) -> void:
	ed = editor


func build() -> Control:
	panel = PanelContainer.new()
	panel.add_theme_stylebox_override("panel", EditorStyle.box(Color("#161b22"), 0, 0))
	panel.custom_minimum_size.x = 270
	var col := VBoxContainer.new()
	panel.add_child(col)
	var head := HBoxContainer.new()
	var title := EditorStyle.label("Layers", 15, EditorStyle.TEXT, false)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(title)
	var hide := EditorStyle.button("×", "small ghost", "Hide")
	hide.pressed.connect(func(): show_layers(false))
	head.add_child(hide)
	var hm := MarginContainer.new()
	for s in ["left", "right", "top"]:
		hm.add_theme_constant_override("margin_" + s, 10)
	hm.add_child(head)
	col.add_child(hm)
	_search = EditorStyle.line_edit("", "Find a part…")
	_search.tooltip_text = "Find a part of the model by its name"
	_search.text_changed.connect(func(_t: String): render())
	var sm := MarginContainer.new()
	sm.add_theme_constant_override("margin_left", 10)
	sm.add_theme_constant_override("margin_right", 10)
	sm.add_child(_search)
	col.add_child(sm)
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	col.add_child(scroll)
	_list = VBoxContainer.new()
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_list.add_theme_constant_override("separation", 1)
	scroll.add_child(_list)
	var tm := MarginContainer.new()
	for s in ["left", "right", "bottom"]:
		tm.add_theme_constant_override("margin_" + s, 10)
	col.add_child(tm)
	var tb := VBoxContainer.new()
	tm.add_child(tb)
	_thumb = TextureRect.new()
	_thumb.custom_minimum_size = Vector2(246, 138)
	_thumb.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_thumb.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	_thumb.visible = false
	tb.add_child(_thumb)
	_thumb_label = EditorStyle.hint("Select a camera to see what it sees.")
	tb.add_child(_thumb_label)
	tb.add_child(EditorStyle.hint("Drag the arrows in the view to move it"))
	for id in ["follow", "look", "cockpit"]:
		var t := Node3D.new()
		t.name = "target_" + id
		ed.view.markers.add_child(t)
		targets[id] = t
	targets["model"] = ed.view.pivot
	_build_window()
	return panel


func show_layers(on: bool) -> void:
	panel.visible = on
	if _layers_tab != null:
		_layers_tab.text = "›" if on else "‹"


## The tools over the view: the view buttons at the top right and the tabs at the edges that fold the bars away.
func build_view_tools() -> void:
	ed.view.thumb_viewport.size = Vector2i(492, 276)
	_thumb.texture = ed.view.thumb_viewport.get_texture()
	var bar := EditorStyle.float_panel()
	bar.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	bar.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	bar.position = Vector2(-12, 12)
	ed.view.overlay.add_child(bar)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	bar.add_child(row)
	var tests := EditorStyle.button("Tests", "small ghost", "Hide or show the test buttons (the engine sound)")
	tests.pressed.connect(func(): ed.engine.toggle_test_bar())
	row.add_child(tests)
	_ortho_button = EditorStyle.button("Perspective", "small ghost", "Perspective view; click for orthographic (no perspective) (O)")
	_ortho_button.pressed.connect(func(): ed.view.set_ortho(not ed.view.ortho))
	row.add_child(_ortho_button)
	var reset := EditorStyle.button("Reset", "small ghost", "Reset the view: the camera back to its standard place, looking at the car, in perspective (Home)")
	reset.pressed.connect(func(): ed.view.reset_view())
	row.add_child(reset)
	var views := EditorStyle.options([["", "View…"], ["1,0,0", "Left"], ["-1,0,0", "Right"], ["0,1,0", "Top"], ["0,-1,0", "Bottom"], ["0,0,1", "Front"], ["0,0,-1", "Back"]])
	views.tooltip_text = "Look at the car from a side (numpad 4 6 8 2 5, 1 for the back)"
	views.custom_minimum_size.x = 90
	views.item_selected.connect(func(_i: int):
		var v := str(EditorStyle.value_of(views))
		if v != "":
			var p := v.split(",")
			ed.view.standard_view(float(p[0]), float(p[1]), float(p[2]))
		views.select(0))
	row.add_child(views)
	_side_tab = EditorStyle.button("‹", "small ghost", "Hide or show the left bar")
	_side_tab.set_anchors_preset(Control.PRESET_CENTER_LEFT)
	_side_tab.position = Vector2(2, 0)
	_side_tab.pressed.connect(func():
		ed.side.visible = not ed.side.visible
		_side_tab.text = "‹" if ed.side.visible else "›")
	ed.view.overlay.add_child(_side_tab)
	_layers_tab = EditorStyle.button("›", "small ghost", "Hide or show the right bar")
	_layers_tab.set_anchors_preset(Control.PRESET_CENTER_RIGHT)
	_layers_tab.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	_layers_tab.position.x = -2
	_layers_tab.pressed.connect(func(): show_layers(not panel.visible))
	ed.view.overlay.add_child(_layers_tab)


# ---- selection and the gizmo

func is_exhaust(id: String) -> bool:
	return id.begins_with("ex")


func select(id: String) -> void:
	selected = "" if selected == id else id
	var g := ed.view.gizmo
	g.detach()
	if selected != "":
		if selected == "model" and ed.model_root == null:
			selected = ""
		elif is_exhaust(selected):
			_attach_exhaust()
		elif ed.suspension.is_mount(selected):
			ed.suspension.attach_gizmo(selected)
		elif targets.has(selected):
			g.attach(targets[selected], "move")
			g.show_axis = [selected != "follow" and selected != "look", true, true]
	for e in exhaust:
		(e["pipe"].material_override as StandardMaterial3D).albedo_color = Color("#ffd04d") if e["id"] == selected else Color("#ff7a3d")
	_update_window()
	update_camera_markers()
	render()


func _attach_exhaust() -> void:
	var t: Node3D = targets.get(selected)
	if t != null:
		ed.view.gizmo.attach(t, exhaust_mode)


## W moves, E turns (an exhaust point, a mount of the suspension); Escape lets go. True when the key was used.
func key(code: Key) -> bool:
	var used := false
	if code == KEY_ESCAPE:
		if ed.suspension.editing:
			ed.suspension.set_editing(false)
			used = true
		elif selected != "":
			select(selected)
			used = true
	elif selected != "" and (code == KEY_W or code == KEY_E):
		if ed.suspension.is_mount(selected):
			ed.suspension.set_mode("move" if code == KEY_W else "rotate")
			used = true
		elif is_exhaust(selected):
			exhaust_mode = "move" if code == KEY_W else "rotate"
			_attach_exhaust()
			_update_window()
			used = true
	return used


## The fields follow the gizmo.
func gizmo_moved() -> void:
	var id := selected
	if is_exhaust(id):
		_sync_exhaust_fields()
		render_meta()
		return
	if ed.suspension.is_mount(id):
		ed.suspension.moved(id)
		return
	var r := ed.num("chassis.tire_diameter", 0.65) / 2.0
	if id == "follow":
		var p: Vector3 = targets["follow"].position
		p.x = 0.0
		p.z = minf(p.z, -0.5)
		targets["follow"].position = p
		ed.cfg["cameras"]["follow"]["distance"] = snappedf(-p.z, 0.01)
		ed.cfg["cameras"]["follow"]["height"] = snappedf(p.y + r, 0.01)
	elif id == "look":
		var p: Vector3 = targets["look"].position
		p.x = 0.0
		targets["look"].position = p
		ed.cfg["cameras"]["follow"]["look_z"] = snappedf(p.z, 0.01)
		ed.cfg["cameras"]["follow"]["look_height"] = snappedf(p.y + r, 0.01)
	elif id == "cockpit":
		var p: Vector3 = targets["cockpit"].position
		ed.cfg["cameras"]["cockpit"]["position"] = [snappedf(p.x, 0.01), snappedf(p.y, 0.01), snappedf(p.z, 0.01)]
	elif id == "model":
		var p := ed.view.pivot.position
		ed.cfg["model"]["offset"] = [snappedf(p.x, 0.01), snappedf(p.y, 0.01), snappedf(p.z, 0.01)]
		ed.refresh_fields()
		ed.update_helpers()
		return
	ed.refresh_fields()
	update_camera_markers()


# ---- the cameras of the game in the view

func update_camera_markers() -> void:
	for c in ed.view.markers.get_children():
		if not targets.values().has(c):
			c.queue_free()
	var cams: Dictionary = ed.cfg.get("cameras", {}) if ed.cfg.get("cameras") is Dictionary else {}
	var f: Dictionary = cams.get("follow", {})
	var r := ed.num("chassis.tire_diameter", 0.65) / 2.0
	var dragging := ed.view.gizmo.dragging
	var dot := func(c: Color, p: Vector3, layer: String) -> Vector3:
		var s := CarEditorView.sphere(0.13 if layer != "" and layer == selected else 0.09, c)
		s.position = p
		if layer != "":
			s.set_meta("layer", layer)
			if not dragging and targets.has(layer):
				targets[layer].position = p
		ed.view.markers.add_child(s)
		return p
	var line := func(c: Color, a: Vector3, b: Vector3) -> void:
		var l := CarEditorView.lines([a, b], [c, c])
		l.layers = CarEditorView.MARKER_LAYER
		ed.view.markers.add_child(l)
	if f.get("distance") != null and f.get("height") != null:
		var cam_p: Vector3 = dot.call(Color("#37d67a"), Vector3(0, float(f["height"]) - r, -float(f["distance"])), "follow")
		var look_p: Vector3 = dot.call(Color("#9be8b8"), Vector3(0, float(f.get("look_height", 0)) - r, float(f.get("look_z", 0))), "look")
		line.call(Color("#37d67a"), cam_p, look_p)
		var k := 1.0 + float(f.get("dolly", 1)) * (tan(deg_to_rad(float(f.get("fov_standing", 45))) / 2.0) / tan(deg_to_rad(float(f.get("fov_fast", 75))) / 2.0) - 1.0)
		if is_finite(k):
			var lh := float(f.get("look_height", 0))
			dot.call(Color("#9be8b8"), Vector3(0, lh + (float(f["height"]) - lh) * k - r, -float(f["distance"]) * k), "")
	var cp: Variant = Tuning.read(cams, "cockpit.position")
	if cp is Array and (cp as Array).size() == 3:
		var p := Vector3(float(cp[0]), float(cp[1]), float(cp[2]))
		dot.call(Color("#ff9f43"), p, "cockpit")
		line.call(Color("#ff9f43"), p, p + Vector3(0, 0, 2))
	render_meta()


## What can be clicked in the view: the dots of the cameras and the pipes of the exhaust points.
func pickables() -> Array:
	var out := []
	for c in ed.view.markers.get_children():
		if c.has_meta("layer"):
			out.append(c)
	for e in exhaust:
		out.append(e["target"])
	return out


func frame() -> void:
	var id := "follow" if selected == "look" else selected
	var is_camera := id == "follow" or id == "cockpit"
	_thumb.visible = is_camera
	if not is_camera:
		_thumb_label.text = "Select a camera to see what it sees."
		return
	var cams: Dictionary = ed.cfg.get("cameras", {})
	var r := ed.num("chassis.tire_diameter", 0.65) / 2.0
	# (the cockpit camera does not see the driver, as in the game, which hides the head and the body inside)
	ed.view.thumb_camera.cull_mask = 1 | (CarEditorView.DRIVER_LAYER if id == "follow" else 0)
	if id == "follow":
		var f: Dictionary = cams.get("follow", {})
		var pos := Vector3(0, float(f.get("height", 2)) - r, -float(f.get("distance", 6)))
		var look := Vector3(0, float(f.get("look_height", 0.6)) - r, float(f.get("look_z", 0)))
		var xf := Transform3D(Basis.IDENTITY, pos).looking_at(look, Vector3.UP)
		ed.view.render_thumb(xf, float(f.get("fov_standing", 45)))
		_thumb_label.text = "1 Follow camera at a standstill, FOV %s° (%s° at full speed)" % [f.get("fov_standing", 45), f.get("fov_fast", 75)]
	else:
		var cp: Variant = Tuning.read(cams, "cockpit.position")
		var p := Vector3(float(cp[0]), float(cp[1]), float(cp[2])) if cp is Array and (cp as Array).size() == 3 else Vector3.ZERO
		ed.view.render_thumb(Transform3D(Basis(Vector3.UP, PI), p), float(Tuning.read(cams, "cockpit.fov") if Tuning.read(cams, "cockpit.fov") != null else 75.0))
		_thumb_label.text = "2 Cockpit camera, FOV %s°" % Tuning.read(cams, "cockpit.fov")
	if _ortho_button != null:
		_ortho_button.text = "Orthographic" if ed.view.ortho else "Perspective"


# ---- the exhaust points: where the flames come out (car.json "exhaust": [{ position, rotation (degrees), diameter, smoke, flame_length_cm, ... }])

func add_exhaust(position: Array, rotation: Array, settings: Variant) -> Dictionary:
	_counter += 1
	var target := Node3D.new()
	target.position = Vector3(float(position[0]), float(position[1]), float(position[2]))
	target.rotation = Vector3(deg_to_rad(float(rotation[0])), deg_to_rad(float(rotation[1])), deg_to_rad(float(rotation[2])))
	target.rotation_order = EULER_ORDER_XYZ
	var pipe := MeshInstance3D.new()
	var cyl := CylinderMesh.new()
	cyl.top_radius = 0.045
	cyl.bottom_radius = 0.045
	cyl.height = 0.22
	cyl.radial_segments = 14
	pipe.mesh = cyl
	pipe.material_override = CarEditorView.flat_material(Color("#ff7a3d"))
	pipe.rotation.x = PI / 2
	pipe.position.z = 0.11
	pipe.layers = CarEditorView.MARKER_LAYER
	target.add_child(pipe)
	var arrow := CarEditorView.lines([Vector3.ZERO, Vector3(0, 0, -0.5)], [Color("#ffb070"), Color("#ffb070")])
	arrow.layers = CarEditorView.MARKER_LAYER
	target.add_child(arrow)
	var s := EXHAUST_DEFAULTS.duplicate()
	if settings is Dictionary:
		for k in EXHAUST_DEFAULTS:
			if settings.has(k):
				s[k] = float(settings[k])
		# (the older form had the length and the width as a factor: of 30 cm, and of 12 cm for a pipe of 8 cm)
		if settings.has("flame_length") and not settings.has("flame_length_cm"):
			s["flame_length_cm"] = clampf(roundf(float(settings["flame_length"]) * 30.0), 1.0, 80.0)
		if settings.has("flame_width") and not settings.has("flame_width_cm"):
			s["flame_width_cm"] = clampf(roundf(float(settings["flame_width"]) * 12.0 * float(s["diameter"]) / 0.08), 1.0, 80.0)
	var e := {"id": "ex%d" % _counter, "target": target, "pipe": pipe, "s": s}
	target.set_meta("layer", e["id"])
	_size_pipe(e)
	exhaust.append(e)
	targets[e["id"]] = target
	ed.view.extras.add_child(target)
	return e


func _size_pipe(e: Dictionary) -> void:
	var k := float(e["s"]["diameter"]) / 0.09
	(e["pipe"] as Node3D).scale = Vector3(k, 1, k)


func remove_exhaust(id: String) -> void:
	for i in exhaust.size():
		if exhaust[i]["id"] == id:
			if selected == id:
				select(id)
			(exhaust[i]["target"] as Node).queue_free()
			targets.erase(id)
			exhaust.remove_at(i)
			break
	render()


func load_exhaust(list: Variant) -> void:
	for e in exhaust.duplicate():
		remove_exhaust(e["id"])
	if list is Array:
		for e in list:
			if e is Array:
				add_exhaust(e, [0, 0, 0], null)
			elif e is Dictionary:
				add_exhaust(e.get("position", [0, 0, 0]), e.get("rotation", [0, 0, 0]), e)
	render()


## A new point: at the back of the car, on the other side than the last one.
func new_exhaust() -> Dictionary:
	var c: Variant = ed.wheel_centers()
	var length := ed.num("dimensions.length", 4.5)
	var width := ed.num("dimensions.width", 1.8)
	var rear_z: float = (c["RL"]["c"].z + c["RR"]["c"].z) / 2.0 - 0.7 if c is Dictionary else -length * 0.45
	var y: float = (c["RL"]["c"].y + c["RR"]["c"].y) / 2.0 - 0.05 if c is Dictionary else -0.3
	var x := (-1.0 if exhaust.size() % 2 == 0 else 1.0) * width * 0.3
	return add_exhaust([snappedf(x, 0.01), snappedf(y, 0.01), snappedf(rear_z, 0.01)], [0, 0, 0], null)


## The flame test: while it is on, the points make a flame now and then, as the game does (ExhaustFlames).
func set_flame_test(on: bool) -> void:
	flame_test = on
	if on and _flames == null:
		_flames = ExhaustFlames.new()
		ed.view.viewport.add_child(_flames)
		_flames.setup_preview(ed.view.extras, {"exhaust": exhaust_config()})
	_flame_timer = 0.0
	render()


func flames_frame(dt: float) -> void:
	if _flames == null or not flame_test or exhaust.is_empty():
		return
	_flame_timer -= dt
	if _flame_timer <= 0.0:
		_flame_timer = 0.18 + randf() * 0.4
		_flames.refresh({"exhaust": exhaust_config()})
		_flames.emit_bang({"strength": 0.6 + randf() * 0.9, "loud": 1.0, "flame": 1.0})


func exhaust_config() -> Array:
	var out := []
	for e in exhaust:
		var t: Node3D = e["target"]
		var p := t.position
		var r := t.rotation
		var s: Dictionary = e["s"]
		out.append({"position": [snappedf(p.x, 0.001), snappedf(p.y, 0.001), snappedf(p.z, 0.001)],
			"rotation": [snappedf(rad_to_deg(r.x), 0.001), snappedf(rad_to_deg(r.y), 0.001), snappedf(rad_to_deg(r.z), 0.001)],
			"diameter": snappedf(float(s["diameter"]), 0.001), "smoke": snappedf(float(s["smoke"]), 0.001),
			"flame_length_cm": snappedf(float(s["flame_length_cm"]), 0.001), "flame_width_cm": snappedf(float(s["flame_width_cm"]), 0.001),
			"brightness": snappedf(float(s["brightness"]), 0.001)})
	return out


## What was placed by hand on the model (it does not follow a new model, or its scale and turn).
func placed_on_model() -> Array:
	var list := []
	if Tuning.read(ed.cfg, "softbody.layout") is Array:
		list.append("the nodes of the shell")
	if not exhaust.is_empty():
		list.append("the exhaust points")
	if ed.cfg.get("driver") is Dictionary:
		list.append("the driver")
	if (ed.cfg.get("parts", []) as Array).any(func(p: Variant) -> bool: return p is Dictionary and (p.has("mounts") or p.has("hinge"))):
		list.append("the hinges and pins of the parts")
	return list


## The settings of the exhaust point that is chosen, in a window over the view.
func _build_window() -> void:
	_window = EditorStyle.float_panel()
	_window.custom_minimum_size.x = 270
	_window.visible = false
	var col := VBoxContainer.new()
	_window.add_child(col)
	var head := HBoxContainer.new()
	_window_title = EditorStyle.label("Exhaust", 13, EditorStyle.TEXT, false)
	_window_title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(_window_title)
	var close := EditorStyle.button("×", "small ghost", "Let go of the exhaust")
	close.pressed.connect(func():
		if is_exhaust(selected):
			select(selected))
	head.add_child(close)
	col.add_child(head)
	_window_body = VBoxContainer.new()
	col.add_child(_window_body)


func _update_window() -> void:
	if _window.get_parent() == null:
		ed.view.overlay.add_child(_window)
	var entry: Variant = null
	for e in exhaust:
		if e["id"] == selected:
			entry = e
	_window.visible = entry != null
	if entry == null:
		return
	_window.position = Vector2(12, 96)
	for c in _window_body.get_children():
		c.queue_free()
	_window_title.text = "Exhaust %d" % (exhaust.find(entry) + 1)
	var modes := HBoxContainer.new()
	for m in [["move", "Move (W)"], ["rotate", "Rotate (E)"]]:
		var b := EditorStyle.button(m[1], "small" + (" accent" if exhaust_mode == m[0] else " ghost"))
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.pressed.connect(func():
			exhaust_mode = m[0]
			_attach_exhaust()
			_update_window())
		modes.add_child(b)
	_window_body.add_child(modes)
	_pos_fields = []
	_rot_fields = []
	for kind in ["pos", "rot"]:
		var row := HBoxContainer.new()
		row.add_child(EditorStyle.label("Position" if kind == "pos" else "Rotation", 12, EditorStyle.MUTED, false))
		for i in 3:
			var f := EditorStyle.line_edit()
			f.custom_minimum_size.x = 56
			f.tooltip_text = "xyz"[i] + (" (m)" if kind == "pos" else " (°)")
			f.text_submitted.connect(func(t: String):
				if not t.is_valid_float():
					return
				var tg: Node3D = entry["target"]
				if kind == "pos":
					var p := tg.position
					p[i] = float(t)
					tg.position = p
				else:
					var r := tg.rotation
					r[i] = deg_to_rad(float(t))
					tg.rotation = r
				render_meta()
				ed.changed())
			row.add_child(f)
			(_pos_fields if kind == "pos" else _rot_fields).append(f)
		_window_body.add_child(row)
	_sync_exhaust_fields()
	for d in EXHAUST_FIELDS:
		var key: String = d[0]
		var scale: float = d[6]
		var f := EditorStyle.NumberField.new("", d[5], d[3], d[4])
		var line := HBoxContainer.new()
		var l := EditorStyle.label("%s (%s)" % [d[1], d[2]], 12, EditorStyle.TEXT, false)
		l.custom_minimum_size.x = 120
		line.add_child(l)
		line.add_child(f)
		_window_body.add_child(line)
		f.set_value(snappedf(float(entry["s"][key]) * scale, 0.1))
		f.edited.connect(func(v: float):
			entry["s"][key] = clampf(v, d[3], d[4]) / scale
			_size_pipe(entry)
			ed.changed(false))
		f.committed.connect(func(_v: float): ed.changed())


func _sync_exhaust_fields() -> void:
	for e in exhaust:
		if e["id"] != selected:
			continue
		var t: Node3D = e["target"]
		for i in mini(3, _pos_fields.size()):
			if not (_pos_fields[i] as LineEdit).has_focus():
				_pos_fields[i].text = str(snappedf(t.position[i], 0.001))
			if not (_rot_fields[i] as LineEdit).has_focus():
				_rot_fields[i].text = str(snappedf(rad_to_deg(t.rotation[i]), 0.1))


# ---- the list

func _row(text: String, colour: Color, meta: String, sel: bool, dim := false) -> HBoxContainer:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 6)
	row.mouse_filter = Control.MOUSE_FILTER_STOP
	var dot := ColorRect.new()
	dot.color = colour
	dot.custom_minimum_size = Vector2(9, 9)
	dot.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	dot.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.add_child(dot)
	var l := EditorStyle.label(text, 12, Color.WHITE if sel else (EditorStyle.FAINT if dim else EditorStyle.TEXT), false)
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	l.clip_text = true
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.add_child(l)
	var m := EditorStyle.label(meta, 11, EditorStyle.MUTED, false)
	m.mouse_filter = Control.MOUSE_FILTER_IGNORE
	m.name = "meta"
	row.add_child(m)
	var wrap := PanelContainer.new()
	var st := EditorStyle.box(Color("#2a3a52") if sel else Color(0, 0, 0, 0), 6, 0)
	st.content_margin_top = 3
	st.content_margin_bottom = 3
	wrap.add_theme_stylebox_override("panel", st)
	wrap.add_child(row)
	wrap.mouse_filter = Control.MOUSE_FILTER_STOP
	_list.add_child(wrap)
	return row


func _clickable(row: HBoxContainer, fn: Callable) -> void:
	(row.get_parent() as Control).gui_input.connect(func(e: InputEvent):
		if e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT:
			fn.call())


func render_meta() -> void:
	for wrap in _list.get_children():
		var row := wrap.get_child(0) if wrap.get_child_count() > 0 else null
		if row == null or not row.has_meta("ex"):
			continue
		for e in exhaust:
			if e["id"] == row.get_meta("ex"):
				var p: Vector3 = e["target"].position
				(row.get_node("meta") as Label).text = "%.2f, %.2f, %.2f" % [p.x, p.y, p.z]


func render() -> void:
	if _list == null:
		return
	for c in _list.get_children():
		c.queue_free()
	for l in LAYERS:
		if l.size() == 1:
			var g := EditorStyle.group(l[0])
			_list.add_child(g)
			continue
		var id: String = l[0]
		var meta := ""
		var dim := false
		if id == "follow":
			meta = "%s m, %s°" % [Tuning.read(ed.cfg, "cameras.follow.distance"), Tuning.read(ed.cfg, "cameras.follow.fov_standing")]
		elif id == "cockpit":
			meta = "%s°" % Tuning.read(ed.cfg, "cameras.cockpit.fov")
		elif id == "model":
			dim = ed.model_root == null
			meta = "none" if dim else ""
		elif id.begins_with("w"):
			# (the parts of the wheel; a car with Dynamic wheels and no parts has its wheels where the Chassis card puts them: the browser said
			# "not set" for those, but they are set)
			var parts: Array = ed.wheel_parts[id.substr(1)]
			dim = parts.is_empty() and ed.wheel_mode() == "model"
			meta = str(parts[0]) if not parts.is_empty() else ("not set" if dim else "dynamic")
		elif id == "steering":
			dim = true
			for n in ed.nodes:
				var p := CarEditorForm._plain(str(n["name"]))
				if p.contains("steeringwheel") or p.contains("steerwheel"):
					dim = false
			meta = "none" if dim else ""
		elif id == "rig":
			var count := 0
			var rig := RegEx.create_from_string(CarEditorForm.RIG_NAME)
			for n in ed.nodes:
				if rig.search(CarEditorForm._plain(str(n["name"]))) != null:
					count += 1
			dim = count == 0
			meta = "%d parts" % count if count > 0 else "none"
		var row := _row(l[1], Color(l[2]), meta, id == selected, dim)
		if id == "rig":
			(row.get_parent() as Control).tooltip_text = "Parts named susp_lowerarm_FL, susp_upright_FL, susp_spring_FL, steer_rack, steer_tierod_FL or susp_axle_rear " + \
				"move with the suspension and the steering in the game"
		_clickable(row, func(): select(id))
	# the exhaust points
	var head := HBoxContainer.new()
	var t := EditorStyle.group("Exhaust")
	t.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(t)
	var test := EditorStyle.button("Test: on" if flame_test else "Test: off", "small" + (" accent" if flame_test else " ghost"),
		"Show the flames of the pops and bangs at the exhaust points")
	test.pressed.connect(func(): set_flame_test(not flame_test))
	head.add_child(test)
	_list.add_child(head)
	for i in exhaust.size():
		var e: Dictionary = exhaust[i]
		var p: Vector3 = e["target"].position
		var row := _row("Exhaust %d" % (i + 1), Color("#ff7a3d"), "%.2f, %.2f, %.2f" % [p.x, p.y, p.z], e["id"] == selected)
		row.set_meta("ex", e["id"])
		var del := EditorStyle.button("×", "small ghost", "Remove this exhaust point")
		del.pressed.connect(func():
			remove_exhaust(e["id"])
			ed.changed())
		row.add_child(del)
		_clickable(row, func(): select(e["id"]))
	var add := _row("+ Add an exhaust point", Color(0, 0, 0, 0), "", false)
	(add.get_parent() as Control).tooltip_text = "A point where the flames of the pops and bangs come out; move it and turn it with the gizmos"
	_clickable(add, func():
		var e := new_exhaust()
		selected = ""
		select(e["id"])
		ed.changed())
	# every named object of the model, with an eye to show or hide it (folded: only the parents; a search shows every match)
	if ed.nodes.is_empty():
		return
	_list.add_child(EditorStyle.group("Parts"))
	if _parts_for != ed.nodes:
		_parts_for = ed.nodes
		_expanded.clear()
	var hidden_from := 1 << 30
	var find := _search.text.strip_edges().to_lower()
	for index in ed.nodes.size():
		var node: Dictionary = ed.nodes[index]
		var depth := int(node["depth"])
		if find != "":
			if not str(node["name"]).to_lower().contains(find):
				continue
		else:
			if depth > hidden_from:
				continue
			hidden_from = 1 << 30
		var has_children: bool = find == "" and index + 1 < ed.nodes.size() and int(ed.nodes[index + 1]["depth"]) > depth
		var open: bool = _expanded.has(node["name"])
		if has_children and not open:
			hidden_from = depth
		var obj: Node3D = node["node"]
		var row := _row(str(node["name"]), Color(0, 0, 0, 0), "", node["name"] == _chosen_part, not obj.visible)
		row.get_child(0).custom_minimum_size.x = 2.0 + mini(0 if find != "" else depth, 6) * 10.0
		var arrow := EditorStyle.button(("▾" if open else "▸") if has_children else " ", "small ghost", "Fold" if open else "Show what is inside")
		arrow.custom_minimum_size.x = 22
		arrow.disabled = not has_children
		arrow.pressed.connect(func():
			if _expanded.has(node["name"]):
				_expanded.erase(node["name"])
			else:
				_expanded[node["name"]] = true
			render())
		row.add_child(arrow)
		row.move_child(arrow, 1)
		var eye := EditorStyle.button("👁" if obj.visible else "—", "small ghost", "Hide" if obj.visible else "Show")
		eye.pressed.connect(func():
			obj.visible = not obj.visible
			render())
		row.add_child(eye)
		(row.get_parent() as Control).tooltip_text = "Click: %s as a part (hinge, loose, breakable)" % node["name"]
		_clickable(row, func():
			show_part(str(node["name"]))
			for h in ed.hooks.values():
				if h != null and h.has_method("open_part"):
					h.call("open_part", node["name"]))


## The part that is chosen in the view: its row is lit and the parents above it open.
func show_part(part_name: String) -> void:
	_chosen_part = part_name
	var at := -1
	for i in ed.nodes.size():
		if ed.nodes[i]["name"] == part_name:
			at = i
	if at > 0:
		var depth := int(ed.nodes[at]["depth"])
		for i in range(at - 1, -1, -1):
			if depth <= 0:
				break
			if int(ed.nodes[i]["depth"]) < depth:
				depth = int(ed.nodes[i]["depth"])
				_expanded[ed.nodes[i]["name"]] = true
	render()
	if part_name != "":
		ed.status("Part: " + part_name)
