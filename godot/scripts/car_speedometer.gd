extends Node
## A digital speedometer drawn on the object "speedometer" of a model (a flat circle in the dashboard), when the tuning says so
## (car.json cockpit.show_speedometer). The speed is drawn in a small picture of its own, made again only when the number changes.

const SIZE := 256

var car: Node3D
var face: MeshInstance3D
var _view: SubViewport = null
var _number: Label
var _unit: Label
var _material: StandardMaterial3D
var _text := ""
var _on := false


## The object speedometer of a model, or null.
static func find(root: Node3D) -> MeshInstance3D:
	for n in root.find_children("*", "MeshInstance3D", true, false):
		if SuspensionRig.clean(str(n.name)).begins_with("speedometer") and (n as MeshInstance3D).mesh is ArrayMesh:
			return n
	return null


func setup(c: Node3D, mi: MeshInstance3D) -> void:
	car = c
	face = mi
	name = "Speedometer"
	face.mesh = _with_uv(face.mesh, CarModel.relative(face, c).basis)
	face.set_meta("no_bend", true)          # (the soft body would draw a copy of it, with the material of the model)
	face.visible = false                    # (off: the object is not there)


func enabled() -> bool:
	var cockpit: Variant = car.get("config").get("cockpit")
	return cockpit is Dictionary and cockpit.get("show_speedometer", false) == true


## A copy of the mesh whose picture lies flat on it, upright as seen from the driver: from the shape, so that a circle without a UV map works.
func _with_uv(mesh: ArrayMesh, b: Basis) -> ArrayMesh:
	var centre := Vector3.ZERO
	var normal := Vector3.ZERO
	var count := 0
	for s in mesh.get_surface_count():
		var a: Array = mesh.surface_get_arrays(s)
		for v: Vector3 in a[Mesh.ARRAY_VERTEX]:
			centre += b * v
			count += 1
		if a[Mesh.ARRAY_NORMAL] != null:
			for n: Vector3 in a[Mesh.ARRAY_NORMAL]:
				normal += b.inverse().transposed() * n
	centre /= maxf(1.0, float(count))
	normal = normal.normalized() if normal.length() > 1e-6 else Vector3.BACK
	if normal.z > 0.0:
		normal = -normal                    # (the side that the driver looks at: the car drives along +z)
	var up := (Vector3.UP - normal * Vector3.UP.dot(normal)).normalized()
	if up.length() < 0.5:
		up = Vector3.BACK
	var right := up.cross(normal).normalized()
	var reach := 1e-4
	for s in mesh.get_surface_count():
		for v: Vector3 in mesh.surface_get_arrays(s)[Mesh.ARRAY_VERTEX]:
			var p := b * v - centre
			reach = maxf(reach, maxf(absf(p.dot(right)), absf(p.dot(up))))
	var out := ArrayMesh.new()
	out.resource_name = mesh.resource_name
	for s in mesh.get_surface_count():
		var a: Array = mesh.surface_get_arrays(s)
		var uvs := PackedVector2Array()
		for v: Vector3 in a[Mesh.ARRAY_VERTEX]:
			var p := b * v - centre
			uvs.append(Vector2(0.5 + p.dot(right) / (2.0 * reach), 0.5 - p.dot(up) / (2.0 * reach)))
		a[Mesh.ARRAY_TEX_UV] = uvs
		a[Mesh.ARRAY_TANGENT] = null
		out.add_surface_from_arrays(mesh.surface_get_primitive_type(s), a)
		out.surface_set_material(s, mesh.surface_get_material(s))
	return out


func _build() -> void:
	_view = SubViewport.new()
	_view.size = Vector2i(SIZE, SIZE)
	_view.disable_3d = true
	_view.render_target_update_mode = SubViewport.UPDATE_ONCE
	add_child(_view)
	var bg := ColorRect.new()
	bg.color = Color("#05070a")
	bg.size = Vector2(SIZE, SIZE)
	_view.add_child(bg)
	_number = _label(112, Rect2(0, 56, SIZE, 120))
	_unit = _label(30, Rect2(0, 172, SIZE, 40))
	_unit.add_theme_color_override("font_color", Color("#7f8fa3"))
	_material = StandardMaterial3D.new()
	_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_material.albedo_texture = _view.get_texture()
	_material.cull_mode = BaseMaterial3D.CULL_DISABLED


func _label(size: int, r: Rect2) -> Label:
	var l := Label.new()
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", Color("#7df0ff"))
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	l.position = r.position
	l.size = r.size
	_view.add_child(l)
	return l


func _process(_delta: float) -> void:
	if not is_instance_valid(face):
		return
	var on := enabled() and bool(car.get("player_tyres"))
	if on != _on:
		_on = on
		if on and _view == null:
			_build()
		face.material_override = _material if on else null
		face.visible = on
	if not on:
		return
	var metric := str(Settings.get_value("units")) != "imperial"
	var text := "%d" % roundi(absf(float(car.get("speed"))) * (3.6 if metric else 2.2369362920544))
	var unit := "km/h" if metric else "mph"
	if text != _text or _unit.text != unit:
		_text = text
		_number.text = text
		_unit.text = unit
		_view.render_target_update_mode = SubViewport.UPDATE_ONCE
