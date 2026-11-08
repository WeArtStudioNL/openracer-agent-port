class_name ExhaustFlames
extends Node3D
## The flames at the exhaust when unburnt fuel burns in it (pops and bangs, anti-lag), after web/js/Flames.js:
## short, bright puffs that fly backwards from the tail pipes with the speed of the car, pale at the start and orange
## at the end, drawn additive. The tail pipes are where car.json says ("exhaust": [{ position, rotation, diameter,
## smoke, flame_length_cm, flame_width_cm, brightness }], in the frame of the model: x to the left, y up, z forward;
## a flame goes along the negative z of the pipe, turned by its rotation), or a guess at the back.
## Every flame takes one of the pictures of web/images/flames/ (listed in its index.json; without it flame1.png,
## flame2.png, ... up to the first missing one; at most 16) at random: a picture points to the right, the nozzle at
## the middle of its left edge; it is turned to the way the flame flies as seen from the camera and stretched to the
## length of the flame (seen from behind, a round puff). Without pictures, a gradient that is made here.
## After a bang a few grey puffs of smoke come out of the pipe (the smoke of the tyres, Car.js car.smoke).

const POOL := 64
const MAX_PICTURES := 16

static var _pictures: Array = []                 # the pictures of web/images/flames/ (loaded once, for every car)
static var _pictures_loaded := false
static var _gradient: Texture2D

var car: Car
var root: Node3D                     # the frame of the pipes: the model of the car, or of the car editor (setup_preview)
var _pipes: Array = []               # { position (model), direction (model), diameter, smoke, length, width, brightness }
var _sprites: Array[MeshInstance3D] = []
var _materials: Array[StandardMaterial3D] = []
var _pos: Array[Vector3] = []
var _vel: Array[Vector3] = []
var _age: PackedFloat32Array = []
var _life: PackedFloat32Array = []
var _length: PackedFloat32Array = []
var _width: PackedFloat32Array = []
var _alpha: PackedFloat32Array = []
var _quad_picture: QuadMesh          # the nozzle at the left edge
var _quad_gradient: QuadMesh         # (the gradient starts a little in front of the pipe: a quarter of it)
var _smoke: GPUParticles3D           # the grey puffs after a bang
var _next := 0


func setup(c: Car) -> void:
	car = c
	root = c.model_root
	_make(c.config)
	c.bang.connect(emit_bang)


## The flame test of the car editor (car-editor.js setFlameTest): no car, the pipes in the frame of the node given.
func setup_preview(frame: Node3D, config: Dictionary) -> void:
	root = frame
	_make(config)


## The pipes again (the exhaust points were moved or changed).
func refresh(config: Dictionary) -> void:
	_pipes = pipes_of(config)


## The pictures of web/images/flames/ (Flames.js OpenRacer.flamePictures): the names of its index.json, or
## flame1.png, flame2.png, ... up to the first that is missing.
static func pictures() -> Array:
	if _pictures_loaded:
		return _pictures
	_pictures_loaded = true
	var names: Array = []
	var listed: Variant = null
	var index := Content.path("images/flames/index.json")
	if FileAccess.file_exists(index):
		listed = JSON.parse_string(FileAccess.get_file_as_string(index))
	if listed is Array:
		for n: Variant in (listed as Array).slice(0, MAX_PICTURES):
			var s := str(n)
			if s.get_extension().to_lower() == "png" and s.get_file() == s:
				names.append(s)
	else:
		for k in range(1, MAX_PICTURES + 1):
			if not FileAccess.file_exists(Content.path("images/flames/flame%d.png" % k)):
				break
			names.append("flame%d.png" % k)
	for n: String in names:
		var bytes := FileAccess.get_file_as_bytes(Content.path("images/flames/" + n))
		var img := Image.new()
		if bytes.is_empty() or img.load_png_from_buffer(bytes) != OK:
			continue
		_pictures.append(ImageTexture.create_from_image(img))
	return _pictures


## The flame without pictures (Flames.js): a round gradient, white in the middle, then pale yellow, orange, nothing.
static func gradient() -> Texture2D:
	if _gradient != null:
		return _gradient
	var g := Gradient.new()
	g.offsets = PackedFloat32Array([0.0, 0.25, 0.6, 1.0])
	g.colors = PackedColorArray([Color(1, 1, 1, 1), Color(1, 230.0 / 255.0, 170.0 / 255.0, 0.9), Color(1, 120.0 / 255.0, 30.0 / 255.0, 0.45),
		Color(1, 60.0 / 255.0, 0, 0)])
	var tex := GradientTexture2D.new()
	tex.gradient = g
	tex.width = 64
	tex.height = 64
	tex.fill = GradientTexture2D.FILL_RADIAL
	tex.fill_from = Vector2(0.5, 0.5)
	tex.fill_to = Vector2(0.5, 0.0)
	_gradient = tex
	return _gradient


func _make(config: Dictionary) -> void:
	name = "Flames"
	top_level = true
	_pipes = pipes_of(config)
	pictures()
	_quad_picture = QuadMesh.new()
	_quad_picture.size = Vector2(1, 1)
	_quad_picture.center_offset = Vector3(0.5, 0, 0)
	_quad_gradient = QuadMesh.new()
	_quad_gradient.size = Vector2(1, 1)
	_quad_gradient.center_offset = Vector3(0.25, 0, 0)
	for i in POOL:
		var mat := StandardMaterial3D.new()
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		mat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
		mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		mat.cull_mode = BaseMaterial3D.CULL_DISABLED
		mat.disable_fog = true
		mat.albedo_texture = gradient()
		var m := MeshInstance3D.new()
		m.mesh = _quad_gradient
		m.material_override = mat
		m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		m.visible = false
		add_child(m)
		_sprites.append(m)
		_materials.append(mat)
		_pos.append(Vector3.ZERO)
		_vel.append(Vector3.ZERO)
	for a: PackedFloat32Array in [_age, _life, _length, _width, _alpha]:
		a.resize(POOL)
	if car != null:
		_smoke = TyreEffects.fine_emitter(TyreEffects.smoke_atlas())
		_smoke.emitting = false
		_smoke.amount = 48
		var pm := _smoke.process_material as ParticleProcessMaterial
		pm.initial_velocity_min = 0.0
		pm.initial_velocity_max = 0.0
		pm.inherit_velocity_ratio = 0.0
		pm.damping_min = 1.0
		pm.damping_max = 2.0
		# (the smoke of an exhaust: half as light as the smoke of a tyre and thinner, Smoke.js grey)
		pm.color = Color(0.45, 0.455, 0.47, 0.7)
		add_child(_smoke)


## The tail pipes of car.json "exhaust" in the frame of the model ({ position, direction, diameter, smoke, length,
## width, brightness }; the length and the width of the flame at its largest, in m), or a guess at the back.
static func pipes_of(config: Dictionary) -> Array:
	var pipes: Array = []
	var list: Array = config.get("exhaust", [])
	for e in list:
		var pos: Array = e.get("position", e) if e is Dictionary else e
		var rot: Array = e.get("rotation", [0, 0, 0]) if e is Dictionary else [0, 0, 0]
		var o: Dictionary = e if e is Dictionary else {}
		var b := Basis.from_euler(Vector3(deg_to_rad(float(rot[0])), deg_to_rad(float(rot[1])), deg_to_rad(float(rot[2]))))
		var diameter := float(o.get("diameter", 0.08))
		# (the length and the width in cm, as the car editor has them; the older form was a factor of 30 and of 12 cm)
		var length := float(o["flame_length_cm"]) / 100.0 if o.has("flame_length_cm") else (float(o["flame_length"]) * 0.3 if o.has("flame_length") else 0.3)
		var width := float(o["flame_width_cm"]) / 100.0 if o.has("flame_width_cm") \
			else (float(o["flame_width"]) * 0.12 * diameter / 0.08 if o.has("flame_width") else 0.12)
		pipes.append({
			"position": Vector3(float(pos[0]), float(pos[1]), float(pos[2])),
			"direction": (b * Vector3(0, 0, -1)).normalized(),
			"diameter": diameter,
			"smoke": float(o.get("smoke", 1.0)),
			"length": clampf(length, 0.01, 0.8),
			"width": clampf(width, 0.01, 0.8),
			"brightness": float(o.get("brightness", 1.0)),
		})
	if pipes.is_empty():
		var dims: Dictionary = config.get("dimensions", {})
		pipes.append({"position": Vector3(-0.4, 0.1, -float(dims.get("length", 4.2)) / 2.0), "direction": Vector3(0, 0, -1),
			"diameter": 0.08, "smoke": 1.0, "length": 0.3, "width": 0.12, "brightness": 1.0})
	return pipes


## A bang: { strength (0.5 to 1.5), loud, flame (a factor) }: a few flames from every pipe, and a few grey puffs.
func emit_bang(event: Dictionary) -> void:
	var flame := float(event.get("flame", 1.0))
	if flame <= 0.01 or root == null or not is_instance_valid(root):
		return
	var strength := float(event.get("strength", 1.0))
	var s := strength * minf(2.0, flame)
	var xf := root.global_transform
	var moving := car.linear_velocity if car != null else Vector3.ZERO
	var pics := pictures()
	for p: Dictionary in _pipes:
		var at: Vector3 = xf * p["position"]
		var dir: Vector3 = (xf.basis * p["direction"]).normalized()
		var dia := float(p["diameter"])
		for c in 2 + roundi(s * 3.0):
			var i := _next
			_next = (_next + 1) % POOL
			_pos[i] = at + Vector3(randf() - 0.5, randf() - 0.5, randf() - 0.5) * dia * 0.5 + dir * randf() * 0.15
			_vel[i] = dir * (2.5 + randf() * 5.0 * s) + moving * 0.95 + Vector3(randf() - 0.5, randf() - 0.5, randf() - 0.5) * 0.8 + Vector3(0, 0.3, 0)
			_age[i] = 0.0
			_life[i] = 0.07 + randf() * 0.13 * minf(1.5, s)
			_alpha[i] = 0.9 * float(p["brightness"])
			# the length and the width of the flame at its largest (m), a little different for every one
			_length[i] = float(p["length"]) * minf(2.0, flame) * (0.75 + 0.25 * minf(1.5, strength)) * (0.8 + 0.4 * randf())
			_width[i] = float(p["width"]) * minf(2.0, flame) * (0.85 + 0.3 * randf())
			var pic: Texture2D = pics[randi() % pics.size()] if not pics.is_empty() else null
			_materials[i].albedo_texture = pic if pic != null else gradient()
			_sprites[i].mesh = _quad_picture if pic != null else _quad_gradient
			_place(i)
			_sprites[i].visible = true
		if _smoke != null and float(p["smoke"]) > 0.01:
			_smoke.global_position = at
			var puff_at := at + dir * 0.12
			for k in roundi(float(p["smoke"]) * (1.0 + strength * 1.5)):
				var v := dir * (0.8 + randf()) + moving * 0.5 + Vector3((randf() - 0.5) * 0.4, 0.2 + randf() * 0.3, (randf() - 0.5) * 0.4)
				_smoke.emit_particle(Transform3D(Basis.IDENTITY, puff_at), v, Color.WHITE, Color(),
					GPUParticles3D.EMIT_FLAG_POSITION | GPUParticles3D.EMIT_FLAG_VELOCITY)


## A flame where it is now, as seen from the camera: drawn a little towards it (the body of the car does not hide
## the start of a flame at a pipe), long in the way that it flies, the nozzle at the pipe; seen from the front or
## the back a round puff. Its colour from pale to orange, and it fades.
func _place(i: int) -> void:
	var t := minf(1.0, _age[i] / maxf(0.01, _life[i]))
	var cam := get_viewport().get_camera_3d() if is_inside_tree() else null
	var at := _pos[i]
	var right := Vector3.RIGHT
	var up := Vector3.UP
	var back := Vector3.BACK
	var side := 1.0
	var angle := 0.0
	if cam != null:
		var cb := cam.global_transform.basis
		right = cb.x
		up = cb.y
		back = cb.z
		var to_cam := cam.global_position - at
		var d := maxf(to_cam.length(), 1e-3)
		at += to_cam * (minf(0.4, d * 0.4) / d)
		var view := cb.inverse() * _vel[i]
		angle = atan2(view.y, view.x)
		side = minf(1.0, Vector2(view.x, view.y).length() * 1.2)
	var grow := 0.35 + 0.65 * sqrt(t)
	var l := _length[i] * grow
	var w := maxf(0.005, _width[i] * grow)
	var sx := maxf(0.005, w * 1.2 + (l - w * 1.2) * side)
	var ax := right * cos(angle) + up * sin(angle)
	var ay := -right * sin(angle) + up * cos(angle)
	_sprites[i].global_transform = Transform3D(Basis(ax * sx, ay * w, back), at)
	# (a brightness above 1: added on brighter, the alpha cannot go over 1)
	var a := _alpha[i] * pow(1.0 - t, 1.5)
	var over := maxf(1.0, a)
	_materials[i].albedo_color = Color(over, (0.9 - 0.55 * t) * over, (0.7 - 0.65 * t) * over, clampf(a, 0.0, 1.0))


func _process(delta: float) -> void:
	for i in POOL:
		var m := _sprites[i]
		if not m.visible:
			continue
		_age[i] += delta
		if _age[i] >= _life[i]:
			m.visible = false
			continue
		_pos[i] += _vel[i] * delta
		_vel[i] *= exp(-5.0 * delta)
		_place(i)
