class_name TyreEffects
extends Node3D
## What the tyres leave behind: the marks on the road (one mesh of strips, the oldest go first) and the smoke of
## burning rubber or the dust of loose ground (particles at each wheel). The amounts come from Car.gd
## (_tyre_effects: Wheel.mark and Wheel.smoke).

const MAX_QUADS := 4000
const STEP := 0.3                    # m between the points of a mark
const LIFT := 0.015                  # m above the road

var car: Car
var _mesh_instance: MeshInstance3D
var _mesh := ArrayMesh.new()
var _quads: Array[PackedVector3Array] = []   # 4 corners each
var _alpha: PackedFloat32Array = []
var _next := 0
var _dirty := false
var _rebuild_in := 0.0
var _last_point: Array = [null, null, null, null]
var _last_side: Array = [Vector3.ZERO, Vector3.ZERO, Vector3.ZERO, Vector3.ZERO]
var _smoke: Array[GPUParticles3D] = []


func setup(c: Car) -> void:
	car = c
	name = "TyreEffects"
	_mesh_instance = MeshInstance3D.new()
	_mesh_instance.mesh = _mesh
	_mesh_instance.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var mat := StandardMaterial3D.new()
	mat.vertex_color_use_as_albedo = true
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	mat.render_priority = -1
	_mesh_instance.material_override = mat
	add_child(_mesh_instance)
	for i in 4:
		var p := _make_smoke()
		_smoke.append(p)
		add_child(p)


func _make_smoke() -> GPUParticles3D:
	var p := GPUParticles3D.new()
	p.amount = 90
	p.lifetime = 2.6
	p.local_coords = false
	p.emitting = true
	p.amount_ratio = 0.0
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	p.visibility_aabb = AABB(Vector3(-30, -5, -30), Vector3(60, 30, 60))
	var m := ParticleProcessMaterial.new()
	m.direction = Vector3(0, 1, 0)
	m.spread = 60.0
	m.initial_velocity_min = 0.4
	m.initial_velocity_max = 1.6
	m.gravity = Vector3(0, 0.35, 0)
	m.damping_min = 0.6
	m.damping_max = 1.2
	m.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	m.emission_sphere_radius = 0.2
	m.scale_min = 0.6
	m.scale_max = 1.0
	var grow := Curve.new()
	grow.add_point(Vector2(0, 0.5))
	grow.add_point(Vector2(1, 3.2))
	var grow_tex := CurveTexture.new()
	grow_tex.curve = grow
	m.scale_curve = grow_tex
	var fade := Gradient.new()
	fade.set_color(0, Color(1, 1, 1, 0.55))
	fade.set_color(1, Color(1, 1, 1, 0.0))
	var fade_tex := GradientTexture1D.new()
	fade_tex.gradient = fade
	m.color_ramp = fade_tex
	p.process_material = m
	var quad := QuadMesh.new()
	quad.size = Vector2(1.2, 1.2)
	var mat := StandardMaterial3D.new()
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	mat.vertex_color_use_as_albedo = true
	mat.albedo_color = Color(0.9, 0.9, 0.92)
	var puff := Gradient.new()
	puff.set_color(0, Color(1, 1, 1, 1))
	puff.set_color(1, Color(1, 1, 1, 0))
	var tex := GradientTexture2D.new()
	tex.gradient = puff
	tex.fill = GradientTexture2D.FILL_RADIAL
	tex.fill_from = Vector2(0.5, 0.5)
	tex.fill_to = Vector2(0.5, 0.0)
	tex.width = 64
	tex.height = 64
	mat.albedo_texture = tex
	quad.material = mat
	p.draw_pass_1 = quad
	return p


## Takes the marks away (a new start).
func clear() -> void:
	_quads.clear()
	_alpha.clear()
	_next = 0
	_last_point = [null, null, null, null]
	_dirty = true


func _process(delta: float) -> void:
	if car == null:
		return
	for i in 4:
		var w := car.wheels[i]
		_marks(i, w)
		var p := _smoke[i]
		p.global_position = w.point if w.contact else car.to_global(w.hub)
		p.amount_ratio = clampf(w.smoke, 0.0, 1.0)
		var surf := Content.surface(w.surface)
		var m := p.process_material as ParticleProcessMaterial
		m.color = Color(0.72, 0.62, 0.48) if surf.get("loose", false) else Color(0.92, 0.92, 0.94)
	_rebuild_in -= delta
	if _dirty and _rebuild_in <= 0.0:
		_rebuild()
		_rebuild_in = 0.1


func _marks(i: int, w: Car.Wheel) -> void:
	if not w.contact or w.mark < 0.05:
		_last_point[i] = null
		return
	var here := w.point + w.normal * LIFT
	var side := w.lf * (w.width * 0.45)
	if _last_point[i] == null:
		_last_point[i] = here
		_last_side[i] = side
		return
	var last: Vector3 = _last_point[i]
	if last.distance_to(here) < STEP:
		return
	if last.distance_to(here) > 3.0:
		_last_point[i] = here
		_last_side[i] = side
		return
	var ls: Vector3 = _last_side[i]
	var q := PackedVector3Array([last - ls, last + ls, here + side, here - side])
	var a := clampf(w.mark, 0.0, 1.0) * 0.55
	if _quads.size() < MAX_QUADS:
		_quads.append(q)
		_alpha.append(a)
	else:
		_quads[_next] = q
		_alpha[_next] = a
		_next = (_next + 1) % MAX_QUADS
	_last_point[i] = here
	_last_side[i] = side
	_dirty = true


func _rebuild() -> void:
	_dirty = false
	_mesh.clear_surfaces()
	if _quads.is_empty():
		return
	var verts := PackedVector3Array()
	var colors := PackedColorArray()
	verts.resize(_quads.size() * 6)
	colors.resize(_quads.size() * 6)
	var k := 0
	for n in _quads.size():
		var q := _quads[n]
		var c := Color(0.04, 0.04, 0.04, _alpha[n])
		for idx in [0, 1, 2, 0, 2, 3]:
			verts[k] = q[idx]
			colors[k] = c
			k += 1
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_COLOR] = colors
	_mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
