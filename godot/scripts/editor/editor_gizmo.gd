class_name EditorGizmo
extends Node3D
## The gizmo of the car editor, where the browser has TransformControls: three arrows that move the object they are on
## along x, y or z (in the frame of the scene, as TransformControls in "world" space), or three rings that turn it about
## its own axes ("local" space, as the rotation gizmo of an exhaust point). A small square between two arrows moves it over that plane. The arrows and the rings keep their size on
## the screen. The view gives it the mouse: grab (on a press: true when an arrow or a ring was hit), drag, release.

signal drag_started
signal moved
signal drag_ended

const COLOURS := [Color("#ff4d4d"), Color("#52d46a"), Color("#4d8dff")]
const PIXELS := 90.0                 # the length of an arrow on the screen
const SQUARE := 0.24                 # the size of a square between two arrows, and how far its middle is along each of them (a share of an arrow)
const SQUARE_AT := 0.24
const PLANES := 3                    # a handle from here on is a square: 3 + the axis that stands on it

var target: Node3D = null
var mode := "move"                   # "move" or "rotate"
var show_axis := [true, true, true]
var dragging := false
var size_factor := 1.0

var _arrows: Array[Node3D] = []
var _rings: Array[Node3D] = []
var _materials: Array[StandardMaterial3D] = []
var _squares: Array[MeshInstance3D] = []
var _square_materials: Array[StandardMaterial3D] = []
var _hover := -1
var _axis := -1
var _start_point := Vector3.ZERO
var _start_xform := Transform3D.IDENTITY
var _plane := Plane()
var _camera: Camera3D = null


func _ready() -> void:
	for i in 3:
		var mat := StandardMaterial3D.new()
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		mat.no_depth_test = true
		mat.render_priority = 10
		mat.albedo_color = COLOURS[i]
		_materials.append(mat)
		var arrow := Node3D.new()
		var shaft := MeshInstance3D.new()
		var cyl := CylinderMesh.new()
		cyl.top_radius = 0.012
		cyl.bottom_radius = 0.012
		cyl.height = 0.8
		shaft.mesh = cyl
		shaft.position.y = 0.4
		shaft.material_override = mat
		arrow.add_child(shaft)
		var tip := MeshInstance3D.new()
		var cone := CylinderMesh.new()
		cone.top_radius = 0.0
		cone.bottom_radius = 0.05
		cone.height = 0.2
		tip.mesh = cone
		tip.position.y = 0.9
		tip.material_override = mat
		arrow.add_child(tip)
		# the arrow is made along +y and turned to its axis
		if i == 0:
			arrow.rotation.z = -PI / 2
		elif i == 2:
			arrow.rotation.x = PI / 2
		add_child(arrow)
		_arrows.append(arrow)
		var ring := MeshInstance3D.new()
		var torus := TorusMesh.new()
		torus.inner_radius = 0.72
		torus.outer_radius = 0.75
		torus.rings = 48
		torus.ring_segments = 6
		ring.mesh = torus
		ring.material_override = mat
		# a torus lies in the xz plane (its axis is y)
		if i == 0:
			ring.rotation.z = PI / 2
		elif i == 2:
			ring.rotation.x = PI / 2
		add_child(ring)
		_rings.append(ring)
		# the square that this axis stands on (coloured as the axis, as in TransformControls)
		var square := MeshInstance3D.new()
		var quad := QuadMesh.new()
		quad.size = Vector2.ONE * SQUARE
		square.mesh = quad
		var flat := StandardMaterial3D.new()
		flat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		flat.no_depth_test = true
		flat.render_priority = 9
		flat.cull_mode = BaseMaterial3D.CULL_DISABLED
		flat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		flat.albedo_color = Color(COLOURS[i], 0.45)
		square.material_override = flat
		add_child(square)
		_squares.append(square)
		_square_materials.append(flat)
	for c in get_children():
		_set_layer(c)
	visible = false


func _set_layer(n: Node) -> void:
	if n is VisualInstance3D:
		(n as VisualInstance3D).layers = 2
	for c in n.get_children():
		_set_layer(c)


func attach(node: Node3D, how := "move") -> void:
	target = node
	mode = how
	show_axis = [true, true, true]
	_hover = -1
	visible = target != null


func detach() -> void:
	target = null
	dragging = false
	visible = false


## The size of one unit of the gizmo at its place, so that it is PIXELS long on the screen.
func _scale_for(cam: Camera3D) -> float:
	var vp := cam.get_viewport().get_visible_rect().size
	if cam.projection == Camera3D.PROJECTION_ORTHOGONAL:
		return cam.size / vp.y * PIXELS * size_factor
	var depth := maxf(0.05, (global_position - cam.global_position).dot(-cam.global_basis.z))
	return 2.0 * depth * tan(deg_to_rad(cam.fov) / 2.0) / vp.y * PIXELS * size_factor


func update_view(cam: Camera3D) -> void:
	_camera = cam
	if target == null or not is_instance_valid(target) or not target.is_inside_tree():
		visible = false
		return
	visible = true
	var b := Basis.IDENTITY
	if mode == "rotate":
		b = target.global_basis.orthonormalized()
	global_transform = Transform3D(b.scaled(Vector3.ONE * _scale_for(cam)), target.global_position)
	for i in 3:
		_arrows[i].visible = mode == "move" and show_axis[i]
		_rings[i].visible = mode == "rotate" and show_axis[i]
		_materials[i].albedo_color = Color(1, 0.9, 0.3) if (i == _axis or (i == _hover and not dragging)) else COLOURS[i]
		var usable := _square_usable(cam, i)
		_squares[i].visible = usable
		if usable:
			var along := _square_axes(cam, i)
			_squares[i].transform = Transform3D(Basis(along[0], along[1], _axis_dir(i)), (along[0] + along[1]) * SQUARE_AT)
		var lit := PLANES + i == _axis or (PLANES + i == _hover and not dragging)
		_square_materials[i].albedo_color = Color(1, 0.9, 0.3, 0.75) if lit else Color(COLOURS[i], 0.45)


func _axis_dir(i: int) -> Vector3:
	if mode == "rotate" and target != null:
		return target.global_basis.orthonormalized()[i]
	return [Vector3.RIGHT, Vector3.UP, Vector3.BACK][i]


## The two arrows on the sides of the square of axis i, each towards the side of the camera (so the square is never hidden behind the object).
func _square_axes(cam: Camera3D, i: int) -> Array[Vector3]:
	var out: Array[Vector3] = []
	var eye := cam.global_position - global_position
	for k in [(i + 1) % 3, (i + 2) % 3]:
		var d := _axis_dir(k)
		out.append(d if eye.dot(d) >= 0.0 else -d)
	return out


## The square of axis i is there (moving, with both its arrows) and is not seen edge on.
func _square_usable(cam: Camera3D, i: int) -> bool:
	if mode != "move" or not show_axis[(i + 1) % 3] or not show_axis[(i + 2) % 3]:
		return false
	var view := -cam.global_basis.z if cam.projection == Camera3D.PROJECTION_ORTHOGONAL else (global_position - cam.global_position).normalized()
	return absf(view.dot(_axis_dir(i))) > 0.12


## The handle under the mouse: 0, 1, 2, a square (PLANES + the axis that stands on it) or -1.
func handle_at(cam: Camera3D, mouse: Vector2) -> int:
	if not visible or target == null:
		return -1
	update_view(cam)
	var o := global_position
	var unit := _scale_for(cam)
	var best := -1
	var best_d := 10.0
	for i in 3:
		if not show_axis[i]:
			continue
		var dir := _axis_dir(i)
		if mode == "move":
			if cam.is_position_behind(o + dir * unit):
				continue
			var a := cam.unproject_position(o + dir * unit * 0.15)
			var b := cam.unproject_position(o + dir * unit)
			var d := Geometry2D.get_closest_point_to_segment(mouse, a, b).distance_to(mouse)
			if d < best_d:
				best_d = d
				best = i
		else:
			var u := dir.cross(Vector3.UP if absf(dir.y) < 0.9 else Vector3.RIGHT).normalized()
			var v := dir.cross(u).normalized()
			var prev := Vector2.ZERO
			for k in 49:
				var ang := TAU * k / 48.0
				var at := o + (u * cos(ang) + v * sin(ang)) * unit * 0.735
				if cam.is_position_behind(at):
					prev = Vector2.INF
					continue
				var p := cam.unproject_position(at)
				if k > 0 and prev != Vector2.INF:
					var d := Geometry2D.get_closest_point_to_segment(mouse, prev, p).distance_to(mouse)
					if d < best_d:
						best_d = d
						best = i
				prev = p
	if best < 0 and mode == "move":
		for i in 3:
			if not _square_usable(cam, i):
				continue
			var along := _square_axes(cam, i)
			var mid := o + (along[0] + along[1]) * unit * SQUARE_AT
			var half := unit * SQUARE / 2.0
			var corners := PackedVector2Array()
			for c: Vector2 in [Vector2(-1, -1), Vector2(1, -1), Vector2(1, 1), Vector2(-1, 1)]:
				corners.append(cam.unproject_position(mid + (along[0] * c.x + along[1] * c.y) * half))
			if Geometry2D.is_point_in_polygon(mouse, corners):
				return PLANES + i
	return best


func hover(cam: Camera3D, mouse: Vector2) -> void:
	_hover = handle_at(cam, mouse)


func _ray_on_plane(cam: Camera3D, mouse: Vector2) -> Variant:
	return _plane.intersects_ray(cam.project_ray_origin(mouse), cam.project_ray_normal(mouse))


## A press: true when an arrow or a ring was hit, and the drag starts.
func grab(cam: Camera3D, mouse: Vector2) -> bool:
	var i := handle_at(cam, mouse)
	if i < 0:
		return false
	_axis = i
	var o := global_position
	var dir := _axis_dir(i % PLANES)
	if i >= PLANES:
		_plane = Plane(dir.normalized(), o)
	elif mode == "move":
		var view := -cam.global_basis.z if cam.projection == Camera3D.PROJECTION_ORTHOGONAL else (o - cam.global_position).normalized()
		var n := dir.cross(view).cross(dir)
		if n.length() < 1e-4:
			n = view
		_plane = Plane(n.normalized(), o)
	else:
		_plane = Plane(dir.normalized(), o)
	var hit: Variant = _ray_on_plane(cam, mouse)
	if hit == null:
		_axis = -1
		return false
	_start_point = hit
	_start_xform = target.global_transform
	dragging = true
	drag_started.emit()
	return true


func drag(cam: Camera3D, mouse: Vector2) -> void:
	if not dragging or target == null:
		return
	var hit: Variant = _ray_on_plane(cam, mouse)
	if hit == null:
		return
	var p: Vector3 = hit
	if _axis >= PLANES:
		target.global_position = _start_xform.origin + (p - _start_point)
		moved.emit()
		return
	var dir := _axis_dir(_axis) if mode == "move" else _start_xform.basis.orthonormalized()[_axis]
	if mode == "move":
		var d := (p - _start_point).dot(dir)
		target.global_position = _start_xform.origin + dir * d
	else:
		var o := _start_xform.origin
		var a := (_start_point - o).normalized()
		var b := (p - o).normalized()
		if a.length() < 0.5 or b.length() < 0.5:
			return
		var angle := atan2(a.cross(b).dot(dir), a.dot(b))
		var rot := Basis(dir.normalized(), angle)
		target.global_basis = rot * _start_xform.basis
	moved.emit()


func release() -> void:
	if dragging:
		dragging = false
		_axis = -1
		drag_ended.emit()
