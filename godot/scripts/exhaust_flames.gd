class_name ExhaustFlames
extends Node3D
## The flames at the exhaust when unburnt fuel burns in it (pops and bangs, anti-lag), after web/js/Flames.js:
## short, bright puffs that fly backwards from the tail pipes with the speed of the car, orange with a pale core,
## drawn additive. The tail pipes are where car.json says ("exhaust": [{ position, rotation, diameter,
## flame_length_cm, flame_width_cm, brightness }], in the frame of the model: x to the left, y up, z forward; a
## flame goes along the negative z of the pipe, turned by its rotation), or a guess at the back.

const POOL := 32

var car: Car
var _pipes: Array = []               # { position (model), direction (model), diameter, length, width, brightness }
var _sprites: Array[MeshInstance3D] = []
var _vel: Array[Vector3] = []
var _age: PackedFloat32Array = []
var _life: PackedFloat32Array = []
var _size: PackedFloat32Array = []
var _next := 0


func setup(c: Car) -> void:
	car = c
	name = "Flames"
	top_level = true
	_pipes = pipes_of(c.config)
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	mat.vertex_color_use_as_albedo = true
	var g := Gradient.new()
	g.offsets = PackedFloat32Array([0.0, 0.35, 1.0])
	g.colors = PackedColorArray([Color(1.0, 0.95, 0.8, 1.0), Color(1.0, 0.55, 0.15, 0.8), Color(0.8, 0.2, 0.05, 0.0)])
	var tex := GradientTexture2D.new()
	tex.gradient = g
	tex.fill = GradientTexture2D.FILL_RADIAL
	tex.fill_from = Vector2(0.5, 0.5)
	tex.fill_to = Vector2(0.5, 0.0)
	mat.albedo_texture = tex
	var quad := QuadMesh.new()
	quad.size = Vector2(1, 1)
	quad.material = mat
	for i in POOL:
		var m := MeshInstance3D.new()
		m.mesh = quad
		m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		m.visible = false
		add_child(m)
		_sprites.append(m)
		_vel.append(Vector3.ZERO)
	_age.resize(POOL)
	_life.resize(POOL)
	_size.resize(POOL)
	c.bang.connect(emit_bang)


## The tail pipes of car.json "exhaust" in the frame of the model ({ position, direction, diameter, length,
## brightness }), or a guess at the back.
static func pipes_of(config: Dictionary) -> Array:
	var pipes: Array = []
	var list: Array = config.get("exhaust", [])
	for e in list:
		var pos: Array = e.get("position", e) if e is Dictionary else e
		var rot: Array = e.get("rotation", [0, 0, 0]) if e is Dictionary else [0, 0, 0]
		var b := Basis.from_euler(Vector3(deg_to_rad(float(rot[0])), deg_to_rad(float(rot[1])), deg_to_rad(float(rot[2]))))
		pipes.append({
			"position": Vector3(float(pos[0]), float(pos[1]), float(pos[2])),
			"direction": (b * Vector3(0, 0, -1)).normalized(),
			"diameter": float(e.get("diameter", 0.06)) if e is Dictionary else 0.06,
			"length": float(e.get("flame_length_cm", 30)) / 100.0 if e is Dictionary else 0.3,
			"brightness": float(e.get("brightness", 1.0)) if e is Dictionary else 1.0,
		})
	if pipes.is_empty():
		var dims: Dictionary = config.get("dimensions", {})
		pipes.append({"position": Vector3(-0.4, 0.1, -float(dims.get("length", 4.2)) / 2.0), "direction": Vector3(0, 0, -1),
			"diameter": 0.06, "length": 0.3, "brightness": 1.0})
	return pipes


## A bang: { strength (0.5 to 1.5), loud, flame (a factor) }: a few puffs from every pipe.
func emit_bang(event: Dictionary) -> void:
	var flame := float(event.get("flame", 1.0))
	if flame <= 0.01 or car == null:
		return
	var s := float(event.get("strength", 1.0)) * minf(2.0, flame)
	var xf := car.model_root.global_transform
	for p in _pipes:
		var at: Vector3 = xf * p["position"]
		var dir: Vector3 = (xf.basis * p["direction"]).normalized()
		for c in 2 + roundi(s * 3.0):
			var i := _next
			_next = (_next + 1) % POOL
			var m := _sprites[i]
			m.global_position = at + dir * randf() * 0.15
			_vel[i] = dir * (2.5 + randf() * 5.0 * s) + car.linear_velocity * 0.95 + Vector3(randf() - 0.5, randf() * 0.5, randf() - 0.5) * 0.8
			_age[i] = 0.0
			_life[i] = 0.07 + randf() * 0.13 * minf(1.5, s)
			_size[i] = float(p["length"]) * (0.4 + 0.4 * randf()) * minf(2.0, flame) * float(p["brightness"])
			m.visible = true


func _process(delta: float) -> void:
	for i in POOL:
		var m := _sprites[i]
		if not m.visible:
			continue
		_age[i] += delta
		var t := _age[i] / maxf(0.01, _life[i])
		if t >= 1.0:
			m.visible = false
			continue
		m.global_position += _vel[i] * delta
		var k := _size[i] * (0.4 + 0.8 * sqrt(t))
		m.scale = Vector3.ONE * maxf(0.01, k)
		m.transparency = clampf(t * t, 0.0, 1.0)
