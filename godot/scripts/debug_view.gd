class_name DebugView
extends Node3D
## What the physics sees (web/js/DebugView.js), on and off with the key 0: the triangles of the track near the car
## (green: road that is driven on, orange: walls, blue-grey: the rest), the nodes and the beams of the shell (yellow; a
## node that is bent or torn off is red; a broken beam is not drawn), the engine bay and the radiator as rings (magenta
## and white, red as they are hurt), the nodes and beams of the shell tyres (ShellTyres), the contact of every wheel
## and its normal (cyan), a red cross at the hub of a wheel that has no contact; a motorcycle: the rider as an orange
## block where his posture puts him. The key - hides the model of the car while the view is on. It is drawn over
## everything and costs nothing while it is off. A panel at the top right has the weather, the time of day and the
## box that leaves out the nodes, the beams and the triangles. (--debug-view turns it on at the start)

const RADIUS := 14.0
const MAX_TRIANGLES := 5000
const CELL := 8.0
const GREEN := Color(0.2, 0.9, 0.3)
const ORANGE := Color(1, 0.55, 0.1)
const GREY := Color(0.45, 0.55, 0.75)
const RED := Color(1, 0.2, 0.2)
const YELLOW := Color(1, 0.9, 0.2)
const CYAN := Color(0.2, 0.9, 1)
const MAGENTA := Color(1, 0.3, 1)
const WHITE := Color(0.95, 0.95, 0.95)

var world: Node
var on := false
var models_hidden := false

var _lines: ImmediateMesh
var _points: ImmediateMesh
var _line_node: MeshInstance3D
var _point_node: MeshInstance3D
var _tri := PackedVector3Array()    # the triangles of the track, three corners each
var _tri_colour := PackedColorArray()
var _cells := {}                    # Vector2i -> PackedInt32Array of triangles
var _grid_made := false
var _layer: CanvasLayer
var _panel: PanelContainer
var _weather: OptionButton
var _time: OptionButton
var _seg := PackedVector3Array()
var _seg_c := PackedColorArray()
var _pts := PackedVector3Array()
var _pts_c := PackedColorArray()


func setup(w: Node) -> void:
	world = w
	name = "DebugView"


func _ready() -> void:
	_lines = ImmediateMesh.new()
	_points = ImmediateMesh.new()
	_line_node = _mesh_node(_lines, false)
	_point_node = _mesh_node(_points, true)
	_build_panel()
	if Content.arg("debug-view") != "":
		set_on.call_deferred(true)


func _mesh_node(mesh: ImmediateMesh, points: bool) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.extra_cull_margin = 16384.0
	mi.top_level = true
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.vertex_color_use_as_albedo = true
	mat.no_depth_test = true
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.render_priority = 100
	if points:
		mat.use_point_size = true
		mat.point_size = 6.0
	mi.material_override = mat
	mi.visible = false
	add_child(mi)
	return mi


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("debug_view"):
		set_on(not on)
		get_viewport().set_input_as_handled()
	elif event.is_action_pressed("debug_models") and on:
		models_hidden = not models_hidden
		_show_models(not models_hidden)
		get_viewport().set_input_as_handled()


func set_on(value: bool) -> void:
	on = value
	_line_node.visible = on
	_point_node.visible = on
	_panel.visible = on
	if on:
		_sync_weather()
		if not _grid_made:
			_make_grid()
	else:
		_lines.clear_surfaces()
		_points.clear_surfaces()
		if models_hidden:
			models_hidden = false
			_show_models(true)
	RunLog.event("debug view %s" % ("on" if on else "off"))


func _show_models(show: bool) -> void:
	var car: Car = world.car
	if car == null:
		return
	if car.model_root != null:
		car.model_root.visible = show
	for w in car.wheels:
		if w.hub_node != null:
			w.hub_node.visible = show


## The triangles of the collision of the track, in cells seen from above (once, the first time the view is on).
func _make_grid() -> void:
	_grid_made = true
	var track: Node = world.track
	if track == null:
		return
	var t0 := Time.get_ticks_msec()
	for col: CollisionShape3D in track.find_children("*", "CollisionShape3D", true, false):
		var shape := col.shape as ConcavePolygonShape3D
		if shape == null:
			continue
		var xf := col.global_transform
		var faces := shape.get_faces()
		for t in faces.size() / 3:
			var p0 := xf * faces[3 * t]
			var p1 := xf * faces[3 * t + 1]
			var p2 := xf * faces[3 * t + 2]
			var n := (p1 - p0).cross(p2 - p0)
			if n.length_squared() < 1e-12:
				continue
			n = n.normalized()
			var i := _tri_colour.size()
			_tri.append_array([p0, p1, p2])
			_tri_colour.append(GREEN if absf(n.y) > 0.7 else (ORANGE if absf(n.y) < 0.5 else GREY))
			var lo := p0.min(p1).min(p2)
			var hi := p0.max(p1).max(p2)
			for gx in range(floori(lo.x / CELL), floori(hi.x / CELL) + 1):
				for gz in range(floori(lo.z / CELL), floori(hi.z / CELL) + 1):
					var key := Vector2i(gx, gz)
					if not _cells.has(key):
						_cells[key] = PackedInt32Array()
					var list: PackedInt32Array = _cells[key]
					list.append(i)
					_cells[key] = list
	RunLog.event("debug view: %d triangles of the track in %d ms" % [_tri_colour.size(), Time.get_ticks_msec() - t0])


func _process(_delta: float) -> void:
	if not on or world == null or world.car == null:
		return
	var car: Car = world.car
	_seg.clear()
	_seg_c.clear()
	_pts.clear()
	_pts_c.clear()
	var show_shell := bool(Settings.get_value("debug_show_shell"))
	if show_shell:
		_track_near(car.global_position)
	var xf := car.get_global_transform_interpolated()
	if show_shell and car.shell != null:
		_shell(car.shell.sb, xf)
	if show_shell and car.engine_damage != null and car.engine_damage.usable:
		_engine(car.engine_damage, xf)
	_wheels(car)
	if car.bike != null:
		_rider(car, xf)
	_flush()


func _track_near(p: Vector3) -> void:
	var seen := {}
	var r2 := RADIUS * RADIUS
	var drawn := 0
	for gx in range(floori((p.x - RADIUS) / CELL), floori((p.x + RADIUS) / CELL) + 1):
		for gz in range(floori((p.z - RADIUS) / CELL), floori((p.z + RADIUS) / CELL) + 1):
			var list: Variant = _cells.get(Vector2i(gx, gz))
			if list == null:
				continue
			for i: int in list:
				if seen.has(i) or drawn >= MAX_TRIANGLES:
					continue
				seen[i] = true
				var a := _tri[3 * i]
				var b := _tri[3 * i + 1]
				var c := _tri[3 * i + 2]
				var mid := (a + b + c) / 3.0
				if Vector2(mid.x - p.x, mid.z - p.z).length_squared() > r2:
					continue
				drawn += 1
				var col := _tri_colour[i]
				_line(a, b, col)
				_line(b, c, col)
				_line(c, a, col)


func _shell(sb: SoftBody, xf: Transform3D) -> void:
	if sb == null:
		return
	for k in sb.count:
		if sb.gone[k] == 1:
			continue
		var bent := not sb.alive(k) or (sb.u[k] + sb.q[k]).length() > 0.02
		_point(xf * sb.position(k), RED if bent else YELLOW)
	for k in sb.beam_count:
		if sb.beam_alive[k] == 0:
			continue
		var a := sb.beam_a[k]
		var b := sb.beam_b[k]
		if sb.gone[a] == 1 or sb.gone[b] == 1:
			continue
		_line(xf * sb.position(a), xf * sb.position(b), YELLOW)


func _engine(ed: EngineDamage, xf: Transform3D) -> void:
	var h := ed.health
	var bay_c := _tint(MAGENTA, maxf(float(h.get("block", 0.0)), maxf(float(h.get("top", 0.0)), float(h.get("pan", 0.0)))))
	var rad_c := _tint(WHITE, float(h.get("radiator", 0.0)))
	for plane in 3:
		_ring(xf, ed.bay, float(ed.get("_bay_r")), plane, bay_c)
		_ring(xf, ed.radiator_at, float(ed.get("_rad_r")), plane, rad_c)
	_point(xf * ed.bay, bay_c)
	_point(xf * ed.radiator_at, rad_c)


func _tint(base: Color, hurt: float) -> Color:
	hurt = clampf(hurt, 0.0, 1.0)
	return Color(base.r + (1.0 - base.r) * hurt, base.g * (1.0 - hurt) + 0.2 * hurt, base.b * (1.0 - hurt) + 0.2 * hurt)


func _ring(xf: Transform3D, c: Vector3, r: float, plane: int, col: Color) -> void:
	var prev := Vector3.ZERO
	for a in 25:
		var ang := float(a) / 24.0 * TAU
		var o := Vector3(cos(ang) * r, sin(ang) * r, 0.0)
		if plane == 1:
			o = Vector3(o.x, 0.0, o.y)
		elif plane == 2:
			o = Vector3(0.0, o.x, o.y)
		var p := xf * (c + o)
		if a > 0:
			_line(prev, p, col)
		if a % 3 == 0:
			_point(p, col)
		prev = p


func _wheels(car: Car) -> void:
	# the shell tyre (ShellTyres): the nodes and the beams of every wheel; green where a node holds, red where it slides
	if car.shell_tyres != null and bool(Settings.get_value("debug_show_shell")):
		var pts := []
		var cols := []
		for i in 4:
			if car.shell_tyres.touched[i] or not car.shell_tyres.results[i].is_empty():
				ShellTyres.shell_lines(car.shell_tyres.tyres[i].call("shells"), pts, cols)
		for k in range(0, pts.size() - 1, 2):
			_line(pts[k], pts[k + 1], cols[k])
	for w in car.wheels:
		if w.contact:
			_line(w.point, w.point + w.normal * 0.5, CYAN)
		elif w.hub_node != null:
			var c := w.hub_node.global_position
			var s := 0.12
			_line(c - Vector3(s, 0, 0), c + Vector3(s, 0, 0), RED)
			_line(c - Vector3(0, s, 0), c + Vector3(0, s, 0), RED)
			_line(c - Vector3(0, 0, s), c + Vector3(0, 0, s), RED)


## The rider as a block where his posture puts him (lat to the left, long forward, drop up, in the space of the body).
func _rider(car: Car, xf: Transform3D) -> void:
	var p: Dictionary = car.bike.posture
	var ctr := Vector3(float(p.get("lat", 0.0)), float(p.get("drop", 0.0)), float(p.get("long", 0.0)))
	var half := Vector3(0.16, 0.22, 0.14)
	var corners := []
	for i in 8:
		corners.append(xf * (ctr + Vector3(half.x * (1 if i & 1 else -1), half.y * (1 if i & 2 else -1), half.z * (1 if i & 4 else -1))))
	for i in 8:
		for bit in [1, 2, 4]:
			if not (i & bit):
				_line(corners[i], corners[i | bit], ORANGE)
	_line(xf.origin, xf * ctr, ORANGE)


func _line(a: Vector3, b: Vector3, c: Color) -> void:
	_seg.append(a)
	_seg.append(b)
	_seg_c.append(c)


func _point(a: Vector3, c: Color) -> void:
	_pts.append(a)
	_pts_c.append(c)


func _flush() -> void:
	_lines.clear_surfaces()
	if not _seg.is_empty():
		_lines.surface_begin(Mesh.PRIMITIVE_LINES)
		for i in _seg_c.size():
			_lines.surface_set_color(_seg_c[i])
			_lines.surface_add_vertex(_seg[2 * i])
			_lines.surface_add_vertex(_seg[2 * i + 1])
		_lines.surface_end()
	_points.clear_surfaces()
	if not _pts.is_empty():
		_points.surface_begin(Mesh.PRIMITIVE_POINTS)
		for i in _pts.size():
			_points.surface_set_color(_pts_c[i])
			_points.surface_add_vertex(_pts[i])
		_points.surface_end()


# ---- the panel

func _build_panel() -> void:
	_layer = CanvasLayer.new()
	_layer.layer = 6
	add_child(_layer)
	_panel = PanelContainer.new()
	_panel.anchor_left = 1.0
	_panel.anchor_right = 1.0
	_panel.offset_left = -290
	_panel.offset_right = -16
	_panel.offset_top = 14
	_panel.visible = false
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.055, 0.07, 0.094, 0.86)
	style.border_color = Color(0.196, 0.235, 0.29)
	style.set_border_width_all(1)
	style.set_corner_radius_all(10)
	style.set_content_margin_all(10)
	_panel.add_theme_stylebox_override("panel", style)
	_layer.add_child(_panel)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 6)
	_panel.add_child(box)
	var bar := HBoxContainer.new()
	var title := Label.new()
	title.text = "Debug view (0)"
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title.add_theme_color_override("font_color", Color(0.62, 0.69, 0.77))
	bar.add_child(title)
	var close := Button.new()
	close.text = "×"
	close.flat = true
	close.tooltip_text = "Close the debug view (0)"
	close.focus_mode = Control.FOCUS_NONE
	close.pressed.connect(set_on.bind(false))
	bar.add_child(close)
	box.add_child(bar)
	var shell := CheckBox.new()
	shell.text = "Show the nodes and the beams"
	shell.button_pressed = bool(Settings.get_value("debug_show_shell"))
	shell.focus_mode = Control.FOCUS_NONE
	shell.toggled.connect(func(v: bool): Settings.set_value("debug_show_shell", v))
	box.add_child(shell)
	var pit := Button.new()
	pit.text = "Pit stop here"
	pit.disabled = true
	pit.tooltip_text = "Not in the Godot version yet: the pit stop starts only in a pit box (PitStop has no stop where the car stands)"
	box.add_child(pit)
	var head := Label.new()
	head.text = "Weather"
	head.add_theme_color_override("font_color", Color(0.62, 0.69, 0.77))
	box.add_child(head)
	_weather = _pick(box, "Weather", GraphicsPage.WEATHERS, func(i: int): Settings.set_value("gfx_weather", GraphicsPage.WEATHERS[i][0]))
	_time = _pick(box, "Time of day", GraphicsPage.TIMES, func(i: int): Settings.set_value("gfx_time", float(GraphicsPage.TIMES[i][0])))
	var note := Label.new()
	note.text = "The ground follows the weather."
	note.modulate.a = 0.7
	box.add_child(note)
	if ResourceLoader.exists("res://scripts/movable.gd"):
		load("res://scripts/movable.gd").call("make", _panel, "debug-panel", bar)


func _pick(box: Control, text: String, items: Array, on_pick: Callable) -> OptionButton:
	var row := HBoxContainer.new()
	var l := Label.new()
	l.text = text
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(l)
	var o := OptionButton.new()
	for it in items:
		o.add_item(str(it[1]))
	o.focus_mode = Control.FOCUS_NONE
	o.item_selected.connect(on_pick)
	row.add_child(o)
	box.add_child(row)
	return o


## The weather and the hour of the settings in the lists (an hour of the slider: the nearest name).
func _sync_weather() -> void:
	for i in GraphicsPage.WEATHERS.size():
		if GraphicsPage.WEATHERS[i][0] == str(Settings.get_value("gfx_weather")):
			_weather.select(i)
	var hour := float(Settings.get_value("gfx_time"))
	var best := 0
	for i in GraphicsPage.TIMES.size():
		if absf(float(GraphicsPage.TIMES[i][0]) - hour) < absf(float(GraphicsPage.TIMES[best][0]) - hour):
			best = i
	_time.select(best)
