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
const HIT_MASS := 1000.0            # the cube of the middle mouse button: a tonne and a metre
const HIT_SIDE := 1.0
const HIT_START := 0.4

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
var _grab := {}                     # the node that is held by the elastic: node, depth, target (frame of the car), mouse
var _cube := {}                     # the hit of the middle mouse button: face, d, u, w, v, x, t
var _tool := ""                     # "hinge" or "break": what a right click does to a part
var _tool_text: Label
var _strength := 5000.0             # N/m of the elastic of the node grabber
var _hit_kmh := 50.0
var _tri_cache := {}
var _last_peak := 0.0               # N: the most the last hit pushed


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
		if not _grab.is_empty() or not _cube.is_empty():
			_grab = {}
			_cube = {}
			if world.car != null and world.car.shell != null:
				world.car.shell.pusher = Callable()
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
	if world != null and world.camera != null:
		world.camera.right_taken = on and _tool != ""
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
	if not _grab.is_empty() and _grab.has("world") and car.shell != null:
		_grab_target()
		_seg.append_array([xf * car.shell.sb.position(int(_grab["node"])), Vector3(_grab["world"])])
		_seg_c.append(RED)
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
			if ReplayFx.active:
				car.shell_tyres.replay_lines(i, pts, cols)      # (no physics in a replay: the shape it had, where the wheel is now)
			elif car.shell_tyres.touched[i] or not car.shell_tyres.results[i].is_empty():
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
	_panel.grow_horizontal = Control.GROW_DIRECTION_BEGIN     # (wider than it was made: to the left, on the screen)
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
	_tools(box)
	if world != null and world.car != null and world.car.bike != null:
		# (a motorcycle: the rules of a crash and the rider, DebugView.js crashSection)
		var rules := DebugCrashRules.new()
		box.add_child(rules)
		rules.setup(world)
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
		load("res://scripts/movable.gd").call("framed", _panel, "debug-panel", bar, box)


## The node grabber, the hit and the part tools (DebugView.js makeGrabPanel): the left mouse button on a node of the
## shell drags it on an elastic (its strength a slider), the middle mouse button hits the car with a cube of a tonne
## at a speed (a slider), and with Open hinges or Break parts a right click on a part does that; Pit stop here.
func _tools(box: VBoxContainer) -> void:
	var head := Label.new()
	head.text = "Node grabber"
	head.add_theme_color_override("font_color", Color(0.62, 0.69, 0.77))
	box.add_child(head)
	_strength = clampf(float(VideoPrefs.get_value("debug", "grab_strength", 5000.0)), 100.0, 200000.0)
	_hit_kmh = clampf(float(VideoPrefs.get_value("debug", "hit_speed", 50.0)), 5.0, 200.0)
	var elastic := _slider(box, "Elastic", 2.0, 5.3, 0.01, log(_strength) / log(10.0), func(v: float) -> String:
		_strength = roundf(pow(10.0, v))
		VideoPrefs.set_value("debug", "grab_strength", _strength)
		return "%d N/m" % _strength if _strength < 10000.0 else "%.0f kN/m" % (_strength / 1000.0))
	elastic.tooltip_text = "Press on a node of the shell with the left mouse button and drag it, held by this elastic"
	var hit := _slider(box, "Hit (middle mouse)", 5.0, 200.0, 5.0, _hit_kmh, func(v: float) -> String:
		_hit_kmh = v
		VideoPrefs.set_value("debug", "hit_speed", v)
		return "%d km/h (%d kN)" % [roundi(v), roundi(HIT_MASS * v / 3.6 / 0.03 / 1000.0)])
	hit.tooltip_text = "The hit of the middle mouse button: a block of a tonne and a metre at this speed"
	var row := HBoxContainer.new()
	for t in [["hinge", "Open hinges", "Right click a hinge (a door, the hood) to open it, again to close it where it was"],
			["break", "Break parts", "Right click a part to break it loose"]]:
		var b := Button.new()
		b.text = t[1]
		b.tooltip_text = t[2]
		b.toggle_mode = true
		b.focus_mode = Control.FOCUS_NONE
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.toggled.connect(func(v: bool):
			_tool = t[0] if v else ""
			for o in row.get_children():
				if o != b:
					(o as Button).set_pressed_no_signal(false)
			_say("Right click a hinge to open or close it." if _tool == "hinge" else ("Right click a part to break it loose." if _tool == "break" else "")))
		row.add_child(b)
	box.add_child(row)
	var pit := Button.new()
	pit.text = "Pit stop here"
	pit.tooltip_text = "A pit stop where the car stands (fuel, tyres, repair)"
	pit.focus_mode = Control.FOCUS_NONE
	pit.pressed.connect(pit_here)
	box.add_child(pit)
	_tool_text = Label.new()
	_tool_text.modulate = Color(0.62, 0.69, 0.77)
	_tool_text.autowrap_mode = TextServer.AUTOWRAP_WORD
	_tool_text.custom_minimum_size.x = 240
	box.add_child(_tool_text)


func _slider(box: Control, text: String, lo: float, hi: float, step: float, value: float, shown: Callable) -> HSlider:
	var row := HBoxContainer.new()
	var l := Label.new()
	l.text = text
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(l)
	var v := Label.new()
	row.add_child(v)
	box.add_child(row)
	var sl := HSlider.new()
	sl.min_value = lo
	sl.max_value = hi
	sl.step = step
	sl.value = value
	sl.focus_mode = Control.FOCUS_NONE
	v.text = shown.call(value)
	sl.value_changed.connect(func(x: float): v.text = shown.call(x))
	box.add_child(sl)
	return sl


func _say(text: String) -> void:
	if _tool_text != null:
		_tool_text.text = text


## Pit stop here (Pit.js forceStart): a stop where the car stands.
func pit_here() -> void:
	var car: Car = world.car
	var pit: PitStop = null
	for c in car.get_children():
		if c is PitStop:
			pit = c
	if pit == null:
		return
	if pit.active:
		_say("A stop is going on.")
		return
	pit.force_start()
	_say("Pit stop where the car stands.")


func _replaying() -> bool:
	var r: Variant = world.get("replay")
	return r != null and (r.playing or r.viewer)


func _input(event: InputEvent) -> void:
	if not on or world == null or world.car == null or _replaying():
		return
	var car: Car = world.car
	var mb := event as InputEventMouseButton
	if mb != null and mb.pressed:
		if _panel.get_global_rect().has_point(mb.position):
			return
		if mb.button_index == MOUSE_BUTTON_LEFT and car.shell != null:
			var k := _node_under(mb.position)
			if k >= 0:
				var cam := get_viewport().get_camera_3d()
				var p: Vector3 = car.global_transform * car.shell.sb.position(k)
				_grab = {"node": k, "depth": cam.global_position.distance_to(p), "mouse": mb.position}
				_grab_target()
				car.shell.pusher = _push
				get_viewport().set_input_as_handled()
		elif mb.button_index == MOUSE_BUTTON_MIDDLE:
			if hit_car(mb.position):
				get_viewport().set_input_as_handled()
		elif mb.button_index == MOUSE_BUTTON_RIGHT and _tool != "":
			_part_tool(mb.position)
			get_viewport().set_input_as_handled()
	elif mb != null and not mb.pressed and mb.button_index == MOUSE_BUTTON_LEFT and not _grab.is_empty():
		drop()
	elif event is InputEventMouseMotion and not _grab.is_empty():
		_grab["mouse"] = (event as InputEventMouseMotion).position
		_grab_target()


## The node of the shell nearest to the mouse on the screen (within 30 pixels), or -1.
func _node_under(mouse: Vector2) -> int:
	var car: Car = world.car
	var cam := get_viewport().get_camera_3d()
	if car.shell == null or cam == null:
		return -1
	var sb := car.shell.sb
	var xf := car.global_transform
	var best := -1
	var best_d := 30.0
	for k in sb.count:
		if sb.anchor_alive[k] == 0 and sb.part_of[k] == "":
			continue
		var p := xf * sb.position(k)
		if cam.is_position_behind(p):
			continue
		var d := cam.unproject_position(p).distance_to(mouse)
		if d < best_d:
			best_d = d
			best = k
	return best


## The point under the mouse at the depth of the node, in the frame of the car.
func _grab_target() -> void:
	var cam := get_viewport().get_camera_3d()
	var m: Vector2 = _grab["mouse"]
	var at := cam.project_ray_origin(m) + cam.project_ray_normal(m) * float(_grab["depth"])
	_grab["world"] = at
	_grab["target"] = world.car.global_transform.affine_inverse() * at


## Lets the node go.
func drop() -> void:
	_grab = {}
	if _cube.is_empty() and world.car.shell != null:
		world.car.shell.pusher = Callable()


## In every small step of the shell: the elastic pulls its node, the cube presses on the nodes under its face.
func _push(h: float) -> void:
	var car: Car = world.car
	if car.shell == null:
		return
	var sb := car.shell.sb
	if not _grab.is_empty() and _grab.has("target"):
		var k: int = _grab["node"]
		var f := (Vector3(_grab["target"]) - sb.position(k)) * _strength - sb.w[k] * 2.0 * sqrt(_strength * sb.mass[k])
		sb.force[k] += f
		sb.quiet = false
	if _cube.is_empty():
		return
	# (the cube flies in the world: the car that it pushes moves away from it; in the frame of the car for the nodes)
	var inv := car.global_transform.affine_inverse()
	var dw: Vector3 = _cube["d"]
	var d := (inv.basis * dw).normalized()
	var face := inv * (Vector3(_cube["face"]) + dw * float(_cube["x"]))
	var u := (inv.basis * Vector3(_cube["u"])).normalized()
	var across := d.cross(u)
	var half := HIT_SIDE / 2.0
	var v: float = _cube["v"]
	var v_rel := v - car.linear_velocity.dot(dw)
	var total := 0.0
	for k in sb.count:
		# (the body: not the nodes of a part or of the suspension, which are solved apart; and only the nodes that were in
		# front of the face when it was fired: one already inside the cube was shot off by the whole depth at once)
		if sb.anchor_alive[k] == 0 or sb.part_of[k] != "" or sb.is_rig[k] == 1 or (_cube["front"] as PackedByteArray)[k] == 0:
			continue
		var rel := sb.position(k) - face
		var depth := sb.radius[k] - rel.dot(d)        # (how far the leading face of the cube has gone past the node)
		if depth <= 0.0 or depth > HIT_SIDE or absf(rel.dot(u)) > half or absf(rel.dot(across)) > half:
			continue
		var vn := v_rel - sb.w[k].dot(d)
		# (the spring and the damper within what the small step of a light node can carry: an explicit step blows up past it)
		var m := sb.mass[k]
		var kc := minf(sb.contact_k, 0.5 * m / (h * h))
		var fn := maxf(0.0, kc * depth + minf(2.0 * sb.contact_damping * sqrt(kc * m), 0.9 * m / h) * vn)
		sb.force[k] += d * fn
		total += fn
	v -= total / HIT_MASS * h
	_cube["v"] = v
	_cube["x"] += v * h
	_cube["t"] += h
	_cube["peak"] = maxf(float(_cube.get("peak", 0.0)), total)
	_last_peak = _cube["peak"]
	if (v_rel < 0.0 and float(_cube["x"]) < -0.05) or float(_cube["x"]) > HIT_START + 1.5 or _cube["t"] > 3.0:
		_cube = {}
		if _grab.is_empty():
			car.shell.pusher = Callable()



## A hit of the middle mouse button (DebugView.js hitCar): a cube of a tonne and a metre at the speed of the panel
## against the car where the mouse is (the surface of the model, or the node of the shell under the mouse), coming the
## way the camera looks (CarShell.pusher, as Apply force of the car editor; the car is not held: it feels the hit through
## the anchors of the shell).
## False when the mouse is not on the car.
func hit_car(mouse: Vector2) -> bool:
	var car: Car = world.car
	# (a tyre, and a part that is off the car, take the hit themselves: DebugView.js hitCar)
	var other := _hit_tyre_or_part(mouse)
	if other != "":
		return other != "none"
	if car.shell == null:
		return false
	var cam := get_viewport().get_camera_3d()
	# (the node of the shell under the mouse: what the cube pushes; else where the ray meets the model)
	var hit := {}
	var k := _node_under(mouse)
	if k >= 0:
		hit = {"position": car.global_transform * car.shell.sb.position(k) - cam.project_ray_normal(mouse) * car.shell.sb.radius[k]}
	else:
		hit = _surface_at(mouse)
	if hit.is_empty():
		return false
	var d := cam.project_ray_normal(mouse)
	var n := -d
	var u := d.cross(Vector3.UP if absf(d.y) < 0.9 else Vector3.RIGHT).normalized()
	_cube = {"face": Vector3(hit["position"]) + n * HIT_START, "d": d, "u": u, "v": _hit_kmh / 3.6 + car.linear_velocity.dot(d), "x": 0.0, "t": 0.0,
		"at": hit["position"]}
	var front := PackedByteArray()
	front.resize(car.shell.sb.count)
	var inv := car.global_transform.affine_inverse()
	var dl := (inv.basis * d).normalized()
	var face := inv * Vector3(_cube["face"])
	for i in car.shell.sb.count:
		front[i] = 1 if car.shell.sb.radius[i] - (car.shell.sb.position(i) - face).dot(dl) <= 0.0 else 0
	_cube["front"] = front
	car.shell.pusher = _push
	_say("Hit at %d km/h." % roundi(_hit_kmh))
	RunLog.event("debug view: a hit at %d km/h" % roundi(_hit_kmh))
	return true


## The middle mouse button on a tyre or on a part that is off the car (hinged open, loose): a tyre takes the damage of
## the hit (WheelRig.hit_wheel) and the car the impulse where the tyre is; a part that is off takes the hit on its body
## (CarParts.hit); a part on the car that can open or break gets the force, and the shell is hit as well. What was
## done: "" (nothing of these: the shell), "tyre", "part" or "none" (a part on the car that held, and no shell).
func _hit_tyre_or_part(mouse: Vector2) -> String:
	var hit := _surface_at(mouse, true)
	if hit.is_empty():
		return ""
	var into := get_viewport().get_camera_3d().project_ray_normal(mouse)
	var impulse := HIT_MASS * _hit_kmh / 3.6
	if _hit_tyre(hit, into, impulse):
		return "tyre"
	return _hit_part(hit, into, impulse)


func _hit_tyre(hit: Dictionary, into: Vector3, impulse: float) -> bool:
	var car: Car = world.car
	var node: Node = hit["node"]
	for i in car.wheels.size():
		var w := car.wheels[i]
		if w.hub_node == null or not (w.hub_node == node or w.hub_node.is_ancestor_of(node)):
			continue
		var torn := false
		var dmg := 0.0
		if car.shell != null and car.shell.rig != null:
			torn = car.shell.rig.hit_wheel(i, impulse)
			dmg = float(car.shell.rig.damage[i])
		car.apply_impulse(into * impulse, Vector3(hit["position"]) - car.global_position)
		_say("Tyre %s %s." % [w.slot, "torn off" if torn else "(%d%% damaged)" % roundi(minf(1.0, dmg) * 100.0)])
		RunLog.event("debug view: a hit at %d km/h on the tyre %s" % [roundi(_hit_kmh), w.slot])
		return true
	return false


## A part: one that is off the car, or one on it that can open or break (DebugView.js: after the hit a part that is
## off takes it itself; one that held, the shell takes it too).
func _hit_part(hit: Dictionary, into: Vector3, impulse: float) -> String:
	var car: Car = world.car
	var p: CarParts.Part = car.parts.part_of(hit["node"]) if car.parts != null else null
	if p == null or p.state == "broken" or (p.state == "held" and p.mode != "hinge" and p.mode != "breakable" and not (p.break_force > 0.0)):
		return ""
	var what := car.parts.hit(p, into, impulse, impulse / 0.03)
	_say("%s: %s" % [p.name, what])
	RunLog.event("debug view: a hit at %d km/h on the part %s: %s" % [roundi(_hit_kmh), p.name, what])
	if p.state != "held":
		return "part"
	return "" if car.shell != null else "none"


## The surface of the car under the mouse: { position, normal (towards the camera), node }, or {}. loose: with the parts
## that are off the car (their bodies lie in the world).
func _surface_at(mouse: Vector2, loose := false) -> Dictionary:
	var car: Car = world.car
	var cam := get_viewport().get_camera_3d()
	var from := cam.project_ray_origin(mouse)
	var dir := cam.project_ray_normal(mouse)
	var best := {}
	var best_d := INF
	var meshes := car.find_children("*", "MeshInstance3D", true, false)
	if loose and car.parts != null:
		for p in car.parts.parts:
			if p.state in ["hinged", "free"] and p.body != null and is_instance_valid(p.body):
				meshes.append_array(p.body.find_children("*", "MeshInstance3D", true, false))
	for m in meshes:
		var mi := m as MeshInstance3D
		if mi.mesh == null or not mi.is_visible_in_tree() or mi.top_level:
			continue
		if (mi.global_transform * mi.mesh.get_aabb()).grow(0.05).intersects_ray(from, dir) == null:
			continue
		var key := "%d/%d" % [mi.get_instance_id(), mi.mesh.get_rid().get_id()]
		if not _tri_cache.has(key):
			_tri_cache[key] = mi.mesh.generate_triangle_mesh()
		var tm: TriangleMesh = _tri_cache[key]
		if tm == null:
			continue
		var inv := mi.global_transform.affine_inverse()
		var h: Dictionary = tm.intersect_ray(inv * from, (inv.basis * dir).normalized())
		if h.is_empty():
			continue
		var p: Vector3 = mi.global_transform * Vector3(h["position"])
		if p.distance_to(from) < best_d:
			best_d = p.distance_to(from)
			var nn := (mi.global_transform.basis.inverse().transposed() * Vector3(h["normal"])).normalized()
			best = {"position": p, "normal": nn if nn.dot(dir) < 0.0 else -nn, "node": mi}
	return best


## Open hinges or Break parts: a right click on a part.
func _part_tool(mouse: Vector2) -> void:
	var car: Car = world.car
	if car.parts == null:
		_say("This car has no parts.")
		return
	var hit := _surface_at(mouse)
	var p: CarParts.Part = car.parts.part_of(hit["node"]) if not hit.is_empty() else null
	if p == null:
		_say("No part there.")
		return
	_say(p.name + ": " + car.parts.tool(p, _tool))


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
