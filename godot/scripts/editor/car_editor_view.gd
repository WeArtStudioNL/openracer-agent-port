class_name CarEditorView
extends Control
## The 3D view of the car editor (the #view of car-editor.html): the model on a grid with the axes (the origin) and the
## blue arrow of the forward direction, the places of the wheels, the markers of the cameras and the exhaust points,
## the gizmo, and a camera that orbits (left button), pans (right or middle button) and zooms towards the point under
## the mouse (the wheel, zoom-to-mouse.js); O switches perspective and orthographic, Home resets the view, the numpad
## gives the standard views (4 6 8 2 5, 1 for the back). A small second view (thumbnail) looks through a camera of the
## game. The view sends a click that did not drag as clicked(position); the editor decides what it picks.

signal clicked(mouse: Vector2)
signal gizmo_moved
signal gizmo_released

const MARKER_LAYER := 2              # (the markers and the gizmo are on a layer of their own: the thumbnail does not draw them)
const DRIVER_LAYER := 1 << 9         # (the driver: the thumbnail of the cockpit camera does not draw it, as the game hides it inside)

var container: SubViewportContainer
var viewport: SubViewport
var camera: Camera3D
var pivot: Node3D                    # holds the model with the turn, scale and offset of the car
var helpers: Node3D                  # the boxes of the wheels
var lib_preview: Node3D              # the rims and tyres of the wheel library, or the grey wheels where the dynamic wheels go
var markers: Node3D                  # the cameras of the game
var extras: Node3D                   # the exhaust points, the suspension of the parts library and its mounts
var grid: MeshInstance3D
var gizmo: EditorGizmo
var chrome: Array[Node3D] = []       # the axes, the forward arrow and the grid (hidden while a crash test runs: hide_chrome)
var target := Vector3(0, 0.4, 0)     # the point the camera orbits
var ortho := false
var thumb_viewport: SubViewport
var thumb_camera: Camera3D
var hud: Label
var toast: Label
var overlay: Control                 # the floating bars are put here (over the view)
var input_hook := Callable()          # (a card that takes the mouse first: the lasso of the Soft body) true when it took the event

var _ortho_half := 2.0
var _down := Vector2.ZERO
var _drag_button := 0
var _moved := false
var _tri_cache := {}                 # MeshInstance3D id -> TriangleMesh
var _toast_time := 0.0


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	container = SubViewportContainer.new()
	container.stretch = true
	container.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	container.mouse_filter = Control.MOUSE_FILTER_STOP
	container.focus_mode = Control.FOCUS_CLICK
	add_child(container)
	viewport = SubViewport.new()
	viewport.own_world_3d = true
	viewport.msaa_3d = Viewport.MSAA_4X
	viewport.handle_input_locally = false
	container.add_child(viewport)
	container.gui_input.connect(_on_input)
	_build_scene()
	overlay = Control.new()
	overlay.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(overlay)
	hud = EditorStyle.label("", 12, Color("#c3cdd9"))
	hud.position = Vector2(14, 12)
	hud.custom_minimum_size.x = 520
	hud.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hud.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.8))
	hud.add_theme_constant_override("shadow_offset_y", 1)
	overlay.add_child(hud)
	toast = EditorStyle.label("", 13, EditorStyle.TEXT)
	toast.visible = false
	toast.z_index = 20                  # (over the panels: a message that is hidden behind the test bar says nothing)
	toast.mouse_filter = Control.MOUSE_FILTER_STOP
	var ts := EditorStyle.box(Color(0.09, 0.106, 0.133, 0.95), 10, 1, Color("#2f3845"))
	ts.content_margin_left = 14
	ts.content_margin_right = 14
	ts.content_margin_top = 9
	ts.content_margin_bottom = 9
	toast.add_theme_stylebox_override("normal", ts)
	toast.custom_minimum_size.x = 380
	toast.gui_input.connect(func(e: InputEvent):
		if e is InputEventMouseButton and e.pressed:
			toast.visible = false)
	overlay.add_child(toast)
	reset_view()


func _build_scene() -> void:
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = EditorStyle.VIEW_BG
	# (physically based materials need surroundings to reflect: a studio sky, not shown, for the reflections)
	var sky := Sky.new()
	var sm := ProceduralSkyMaterial.new()
	sm.sky_top_color = Color(0.55, 0.6, 0.68)
	sm.sky_horizon_color = Color(0.75, 0.77, 0.8)
	sm.ground_bottom_color = Color(0.2, 0.22, 0.25)
	sm.ground_horizon_color = Color(0.55, 0.57, 0.6)
	sky.sky_material = sm
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = 0.7
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	var we := WorldEnvironment.new()
	we.environment = env
	viewport.add_child(we)
	var sun := DirectionalLight3D.new()
	sun.light_energy = 1.2
	sun.shadow_enabled = true
	sun.look_at_from_position(Vector3(4, 8, 5), Vector3.ZERO)
	viewport.add_child(sun)
	camera = Camera3D.new()
	camera.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF     # (moved in _process: no lag of its picture)
	camera.fov = 40.0
	camera.near = 0.05
	camera.far = 200.0
	camera.cull_mask = 0xFFFFF
	viewport.add_child(camera)
	grid = _grid_mesh(20.0, 40)
	viewport.add_child(grid)
	var axes := lines([Vector3.ZERO, Vector3.RIGHT, Vector3.ZERO, Vector3.UP, Vector3.ZERO, Vector3.BACK],
		[Color.RED, Color.RED, Color.GREEN, Color.GREEN, Color(0.3, 0.5, 1), Color(0.3, 0.5, 1)])
	viewport.add_child(axes)
	# the forward direction of the game
	var arrow := lines([Vector3(0, 0.02, 0), Vector3(0, 0.02, 2.2)], [Color("#4d8dff"), Color("#4d8dff")])
	var cone := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 0.0
	cm.bottom_radius = 0.125
	cm.height = 0.4
	cone.mesh = cm
	cone.material_override = flat_material(Color("#4d8dff"))
	cone.rotation.x = PI / 2
	cone.position = Vector3(0, 0.02, 2.4)
	arrow.add_child(cone)
	viewport.add_child(arrow)
	chrome = [axes, arrow, grid]
	pivot = Node3D.new()
	pivot.name = "Pivot"
	viewport.add_child(pivot)
	for n in ["helpers", "lib_preview", "markers", "extras"]:
		var node := Node3D.new()
		node.name = n
		viewport.add_child(node)
		set(n, node)
	gizmo = EditorGizmo.new()
	viewport.add_child(gizmo)
	gizmo.moved.connect(func(): gizmo_moved.emit())
	gizmo.drag_ended.connect(func(): gizmo_released.emit())
	thumb_viewport = SubViewport.new()
	thumb_viewport.size = Vector2i(492, 276)
	thumb_viewport.world_3d = viewport.find_world_3d()
	thumb_viewport.render_target_update_mode = SubViewport.UPDATE_DISABLED
	thumb_viewport.msaa_3d = Viewport.MSAA_4X
	add_child(thumb_viewport)
	thumb_camera = Camera3D.new()
	thumb_camera.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	thumb_camera.cull_mask = 1
	thumb_camera.near = 0.05
	thumb_camera.far = 300.0
	thumb_viewport.add_child(thumb_camera)


func _grid_mesh(size: float, divisions: int) -> MeshInstance3D:
	var pts: Array = []
	var cols: Array = []
	var half := size / 2.0
	for i in divisions + 1:
		var x := -half + size * i / divisions
		var c := Color("#56627a") if i == divisions / 2 else Color("#333c4b")
		pts.append_array([Vector3(x, 0, -half), Vector3(x, 0, half), Vector3(-half, 0, x), Vector3(half, 0, x)])
		cols.append_array([c, c, c, c])
	return lines(pts, cols)


static func flat_material(c: Color, on_top := false) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_color = c
	m.vertex_color_use_as_albedo = false
	if c.a < 1.0:
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	if on_top:
		m.no_depth_test = true
		m.render_priority = 5
	return m


## The helpers of the view (the camera markers, the axes, the forward arrow, the grid) go while a crash test runs (hideChrome).
func hide_chrome(on: bool) -> void:
	for n in chrome:
		n.visible = not on
	markers.visible = not on


## Lines between every two points (the colours per point).
static func lines(points: Array, colours: Array, on_top := false) -> MeshInstance3D:
	var mesh := ArrayMesh.new()
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = PackedVector3Array(points)
	arrays[Mesh.ARRAY_COLOR] = PackedColorArray(colours)
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_LINES, arrays)
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.vertex_color_use_as_albedo = true
	if on_top:
		m.no_depth_test = true
		m.render_priority = 5
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return mi


## The edges of a box (Box3Helper).
static func box_lines(box: AABB, c: Color) -> MeshInstance3D:
	var p := []
	for i in 8:
		p.append(box.get_endpoint(i))
	var e := [[0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4], [0, 4], [1, 5], [2, 6], [3, 7]]
	var pts := []
	var cols := []
	for pair in e:
		pts.append(p[pair[0]])
		pts.append(p[pair[1]])
		cols.append(c)
		cols.append(c)
	var mi := lines(pts, cols)
	mi.layers = MARKER_LAYER
	return mi


static func sphere(radius: float, c: Color, on_top := false) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var s := SphereMesh.new()
	s.radius = radius
	s.height = radius * 2.0
	s.radial_segments = 16
	s.rings = 8
	mi.mesh = s
	mi.material_override = flat_material(c, on_top)
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.layers = MARKER_LAYER
	return mi


func _process(delta: float) -> void:
	gizmo.update_view(camera)
	if toast.visible and _toast_time > 0.0:
		_toast_time -= delta
		if _toast_time <= 0.0:
			toast.visible = false
	toast.position = Vector2((size.x - toast.size.x) / 2.0, size.y - toast.size.y - 90.0)


func show_toast(text: String, kind := "") -> void:
	toast.text = text
	toast.add_theme_color_override("font_color", EditorStyle.ERROR if kind == "error" else (EditorStyle.WARN if kind == "warn" else
		(EditorStyle.OK if kind == "ok" else EditorStyle.TEXT)))
	toast.visible = text != ""
	toast.reset_size()
	_toast_time = 0.0 if kind == "error" or kind == "warn" else 6.0


# ---- the camera

func _distance() -> float:
	return camera.position.distance_to(target)


func _look() -> void:
	var up := Vector3.UP
	var dir := (target - camera.position).normalized()
	if absf(dir.dot(Vector3.UP)) > 0.999:
		up = Vector3.BACK
	camera.look_at(target, up)


func reset_view() -> void:
	set_ortho(false)
	camera.near = 0.05
	camera.far = 200.0
	target = Vector3(0, 0.4, 0)
	camera.position = Vector3(-5, 3, 6)
	_look()
	if pivot.get_child_count() > 0:
		frame_model()


func frame_model() -> void:
	var box := bounds_of(pivot)
	if box.size == Vector3.ZERO:
		return
	var distance := maxf(box.size.x, maxf(box.size.y, box.size.z)) * 1.9 + 1.0
	target = box.get_center()
	camera.position = target + Vector3(-distance * 0.7, distance * 0.4, distance * 0.7)
	camera.near = distance / 200.0
	camera.far = distance * 40.0
	if ortho:
		_ortho_half = distance * tan(deg_to_rad(camera.fov) / 2.0)
		camera.size = _ortho_half * 2.0
	_look()


func set_ortho(on: bool) -> void:
	if on == ortho:
		return
	var dist := _distance()
	if on:
		_ortho_half = dist * tan(deg_to_rad(camera.fov) / 2.0)
		camera.projection = Camera3D.PROJECTION_ORTHOGONAL
		camera.size = _ortho_half * 2.0
	else:
		var want := (camera.size / 2.0) / tan(deg_to_rad(camera.fov) / 2.0)
		var dir := (camera.position - target).normalized()
		camera.position = target + dir * want
		camera.projection = Camera3D.PROJECTION_PERSPECTIVE
	ortho = on


## A standard view: from the side dx, dy, dz (x is the left of the car), at the distance the camera has.
func standard_view(dx: float, dy: float, dz: float) -> void:
	var dist := maxf(0.5, _distance())
	camera.position = target + Vector3(dx, dy, dz + (0.0001 if dy != 0.0 else 0.0)) * dist
	_look()


func _orbit(rel: Vector2) -> void:
	var h := maxf(1.0, size.y)
	var offset := camera.position - target
	var yaw := -TAU * rel.x / h
	var pitch := -TAU * rel.y / h
	offset = offset.rotated(Vector3.UP, yaw)
	var right := offset.cross(Vector3.UP).normalized()
	if right.length() > 0.5:
		var turned := offset.rotated(right, -pitch)
		if absf(turned.normalized().dot(Vector3.UP)) < 0.995:
			offset = turned
	camera.position = target + offset
	_look()


func _pan(rel: Vector2) -> void:
	var h := maxf(1.0, size.y)
	var world_per_px := (camera.size if ortho else 2.0 * _distance() * tan(deg_to_rad(camera.fov) / 2.0)) / h
	var move := (-camera.global_basis.x * rel.x + camera.global_basis.y * rel.y) * world_per_px
	camera.position += move
	target += move


## The wheel zooms towards the point under the mouse: the model, else the floor, else the orbit centre.
func _zoom(mouse: Vector2, steps: float) -> void:
	var f := pow(0.88, steps)
	var hit: Variant = pick_mesh(mouse, pivot)
	var point: Vector3
	if hit is Dictionary:
		point = hit["position"]
	else:
		var floor_hit: Variant = Plane(Vector3.UP, grid.position.y).intersects_ray(camera.project_ray_origin(mouse), camera.project_ray_normal(mouse))
		if floor_hit is Vector3 and (floor_hit as Vector3).distance_to(camera.position) < camera.far * 0.5:
			point = floor_hit
		else:
			point = camera.project_position(mouse, _distance())
	if ortho:
		var before := camera.project_ray_origin(mouse)
		camera.size = clampf(camera.size * f, 0.05, 500.0)
		var after := camera.project_ray_origin(mouse)
		camera.position += before - after
		target += before - after
		return
	var new_pos := point + (camera.position - point) * f
	if new_pos.distance_to(point) < 0.05 and steps > 0.0:
		return
	camera.position = new_pos
	target = point + (target - point) * f
	_look()


func _on_input(event: InputEvent) -> void:
	if input_hook.is_valid() and input_hook.call(event):
		accept_event()
		return
	if event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_WHEEL_UP and mb.pressed:
			_zoom(mb.position, 1.0 * maxf(1.0, mb.factor))
			accept_event()
		elif mb.button_index == MOUSE_BUTTON_WHEEL_DOWN and mb.pressed:
			_zoom(mb.position, -1.0 * maxf(1.0, mb.factor))
			accept_event()
		elif mb.pressed:
			container.grab_focus()
			_down = mb.position
			_drag_button = mb.button_index
			_moved = false
			if mb.button_index == MOUSE_BUTTON_LEFT and gizmo.grab(camera, mb.position):
				_drag_button = -1
		else:
			if _drag_button == -1:
				gizmo.release()
			elif not _moved and mb.button_index == MOUSE_BUTTON_LEFT:
				clicked.emit(mb.position)
			_drag_button = 0
	elif event is InputEventMouseMotion:
		var mm := event as InputEventMouseMotion
		if _drag_button == -1:
			gizmo.drag(camera, mm.position)
			return
		if _drag_button == 0:
			gizmo.hover(camera, mm.position)
			return
		if mm.position.distance_to(_down) > 4.0:
			_moved = true
		if not _moved:
			return
		if _drag_button == MOUSE_BUTTON_LEFT and not mm.shift_pressed:
			_orbit(mm.relative)
		else:
			_pan(mm.relative)
	elif event is InputEventMagnifyGesture:
		_zoom((event as InputEventMagnifyGesture).position, ((event as InputEventMagnifyGesture).factor - 1.0) * 8.0)
	elif event is InputEventPanGesture:
		_zoom((event as InputEventPanGesture).position, -(event as InputEventPanGesture).delta.y)


func _unhandled_key_input(event: InputEvent) -> void:
	var k := event as InputEventKey
	if k == null or not k.pressed or k.echo or k.ctrl_pressed or k.meta_pressed:
		return
	var focus := get_viewport().gui_get_focus_owner()
	if focus is LineEdit or focus is TextEdit:
		return
	match k.physical_keycode:
		KEY_O:
			set_ortho(not ortho)
		KEY_HOME:
			reset_view()
		KEY_KP_4:
			standard_view(1, 0, 0)
		KEY_KP_6:
			standard_view(-1, 0, 0)
		KEY_KP_8:
			standard_view(0, 1, 0)
		KEY_KP_2:
			standard_view(0, -1, 0)
		KEY_KP_5:
			standard_view(0, 0, 1)
		KEY_KP_1:
			standard_view(0, 0, -1)
		_:
			return
	get_viewport().set_input_as_handled()


# ---- what is under the mouse

## The bounding box of the meshes under a node, in the frame of the scene (hidden ones too, as Box3.setFromObject of three.js:
## the wheel parts that the library wheels stand in for are measured all the same).
static func bounds_of(node: Node3D) -> AABB:
	var box := AABB()
	var first := true
	var list: Array[Node] = node.find_children("*", "MeshInstance3D", true, false)
	if node is MeshInstance3D:
		list.append(node)
	for m in list:
		var mi := m as MeshInstance3D
		if mi.mesh == null or not mi.is_inside_tree():
			continue
		var b: AABB = mi.global_transform * mi.mesh.get_aabb()
		box = b if first else box.merge(b)
		first = false
	return box


## The mesh under the mouse in what root holds: { node (MeshInstance3D), position } or null.
func pick_mesh(mouse: Vector2, root: Node3D) -> Variant:
	if root == null or not root.is_visible_in_tree():
		return null
	var from := camera.project_ray_origin(mouse)
	var dir := camera.project_ray_normal(mouse)
	var best: Variant = null
	var best_d := INF
	for m in root.find_children("*", "MeshInstance3D", true, false):
		var mi := m as MeshInstance3D
		if mi.mesh == null or not mi.is_visible_in_tree():
			continue
		var aabb: AABB = mi.global_transform * mi.mesh.get_aabb()
		if aabb.grow(0.01).intersects_ray(from, dir) == null:
			continue
		var key := "%d/%d" % [mi.get_instance_id(), mi.mesh.get_rid().get_id()]      # (the soft body gives a mesh a new one: its triangles)
		if not _tri_cache.has(key):
			_tri_cache[key] = mi.mesh.generate_triangle_mesh()
		var tm: TriangleMesh = _tri_cache[key]
		if tm == null:
			continue
		var inv := mi.global_transform.affine_inverse()
		var hit: Dictionary = tm.intersect_ray(inv * from, (inv.basis * dir).normalized())
		if hit.is_empty():
			continue
		var p: Vector3 = mi.global_transform * Vector3(hit["position"])
		var d := p.distance_to(from)
		if d < best_d:
			best_d = d
			best = {"node": mi, "position": p}
	return best


## The marker nearest to the mouse (within 14 pixels) among nodes with the meta "layer": its layer, or "".
func pick_marker(mouse: Vector2, nodes: Array) -> String:
	var best := ""
	var best_d := 14.0
	for n in nodes:
		var node := n as Node3D
		if node == null or not node.is_visible_in_tree() or not node.has_meta("layer"):
			continue
		if camera.is_position_behind(node.global_position):
			continue
		var d := camera.unproject_position(node.global_position).distance_to(mouse)
		if d < best_d:
			best_d = d
			best = str(node.get_meta("layer"))
	return best


func forget_meshes() -> void:
	_tri_cache.clear()


## Renders the thumbnail through a camera of the game (a transform and a field of view) once.
func render_thumb(xform: Transform3D, fov: float) -> void:
	thumb_camera.global_transform = xform
	thumb_camera.fov = clampf(fov, 5.0, 170.0)
	thumb_viewport.render_target_update_mode = SubViewport.UPDATE_ONCE
