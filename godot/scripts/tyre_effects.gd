class_name TyreEffects
extends Node3D
## What the tyres leave behind, after web/js/SkidMarks.js and web/js/Smoke.js.
##
## Marks: a strip of rubber along the path of the contact patch, of a fixed width across the direction it moves
## (also in a slide), darker the harder the tyre slides, with the darkness running smoothly from point to point
## and soft edges; black on the road, a lighter track on loose ground. The strips are kept in chunks of meshes, so
## only the newest chunk is built again; the oldest go first.
##
## Smoke and dust: puffs of a picture of smoke (four, in an atlas that is made once: noise with a ragged, curled
## edge, a lit top and a darker underside), each turned by its own angle, that rise, are carried by a little
## turbulence, grow and fade. Smoke lives long and grows to a wide plume; dust is lower and gone in a second or two.
## As in Smoke.js there are two layers: the plume (from a tyre that smokes hard and turns) and small dense puffs that
## hug the tyre and are gone in a second or two; both are thrown the other way from where the tread spins.
## The car is not a place for smoke: young smoke is pushed out of the box of its body (an attractor that repels), and
## where the car drives through a plume that has hung in the air a while it takes small wisps of it along (new
## short-lived puffs at its nose or tail with its speed), the way Smoke.js does it.

const CHUNK := 400                   # strips per mesh
const CHUNKS := 20                   # 8000 strips: about a kilometre of marks
const STEP := 0.12                   # m between the points of a mark
const LIFT := 0.012                  # m above the road
const TILE := 64                     # pixels of a puff in the atlas
const ATLAS_CACHE := "user://smoke_atlas.png"
const PLUME_AGE := 1.5               # s: from this age a plume is no longer pushed by the car (it makes wisps)
const PLUME_LIFE := 11.0             # s that a puff of the plume lives (Smoke.js: 10 + up to 1.4 + the heat)
const PLUME_POINTS := 600            # the places of the plumes that are kept for the wisps
const SMOKE := Color(0.9, 0.91, 0.94)
const DUST := Color(0.66, 0.55, 0.4)

static var _atlas: ImageTexture

var car: Car
var wisps: GPUParticles3D                      # the wisps that the car takes out of a plume
var wisps_made := 0                            # (the tests)
var _chunks: Array[MeshInstance3D] = []
var _strips: Array = []              # per chunk: Array of strips [p0a, p0b, p1a, p1b, a0, a1, dust]
var _chunk := 0
var _dirty := false
var _rebuild_in := 0.0
var _last: Array = [null, null, null, null]       # per wheel: {p, side, a}
var _smoke: Array[GPUParticles3D] = []
var _dust: Array[GPUParticles3D] = []
var _fine: Array[GPUParticles3D] = []          # the small dense puffs at the tyre (Smoke.js "fine")
var _repel: GPUParticlesAttractorBox3D         # the body of the car pushes the young smoke away
var _box := AABB()                             # the body in the frame of the car (without the wheels)
var _box_of: Node = null
var _plume: Array = []                         # [where, when it was made, when the car last took a wisp from it]
var _plume_in := [0.0, 0.0, 0.0, 0.0]
var _time := 0.0
var _mark_material: StandardMaterial3D
var _smoke_in := [0.0, 0.0, 0.0, 0.0]          # (the replay: a row of the smoke of a wheel 15 times a second)
var _hold := [0.0, 0.0, 0.0, 0.0]              # (in the replay: how long the smoke of a row goes on)


func setup(c: Car) -> void:
	car = c
	name = "TyreEffects"
	_mark_material = StandardMaterial3D.new()
	_mark_material.vertex_color_use_as_albedo = true
	_mark_material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_mark_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_mark_material.cull_mode = BaseMaterial3D.CULL_DISABLED
	_mark_material.render_priority = -1
	_mark_material.albedo_texture = _strip_texture()
	for n in CHUNKS:
		var mi := MeshInstance3D.new()
		mi.mesh = ArrayMesh.new()
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.material_override = _mark_material
		add_child(mi)
		_chunks.append(mi)
		_strips.append([])
	var atlas := smoke_atlas()
	for i in 4:
		var s := emitter(atlas, false)
		# (the plume of a tyre lives long: Smoke.js 10 to 12 s, made at up to 90 puffs a second)
		s.lifetime = PLUME_LIFE
		s.amount = 1000
		(s.process_material as ParticleProcessMaterial).inherit_velocity_ratio = 0.06
		var d := emitter(atlas, true)
		d.amount = 90                    # (45 a second)
		d.lifetime = 2.0
		var f := fine_emitter(atlas)
		_smoke.append(s)
		_dust.append(d)
		_fine.append(f)
		add_child(s)
		add_child(d)
		add_child(f)
	wisps = wisp_emitter(atlas)
	add_child(wisps)
	_repel = GPUParticlesAttractorBox3D.new()
	_repel.strength = -6.0
	_repel.attenuation = 0.5
	_repel.directionality = 0.0
	_repel.size = Vector3(1, 1, 1)
	add_child(_repel)
	# the water of the puddles and the snow (the condition of the ground, Ground)
	var spray := GroundSpray.new()
	spray.setup(c)
	add_child(spray)
	ReplayFx.attach("skid", c, self)
	ReplayFx.attach("smoke", c, self)


## Across the strip: soft edges, a little uneven along it.
static func _strip_texture() -> Texture2D:
	var img := Image.create(32, 64, false, Image.FORMAT_RGBA8)
	var noise := FastNoiseLite.new()
	noise.frequency = 0.15
	for y in 64:
		for x in 32:
			var u := (x + 0.5) / 32.0
			var edge := smoothstep(0.0, 0.22, u) * smoothstep(1.0, 0.78, u)
			var grain := 0.8 + 0.2 * noise.get_noise_2d(x * 2.0, y)
			img.set_pixel(x, y, Color(1, 1, 1, edge * grain))
	return ImageTexture.create_from_image(img)


## The four pictures of a puff (Smoke.js makeAtlas), made once and kept in the user folder.
static func smoke_atlas() -> ImageTexture:
	if _atlas != null:
		return _atlas
	var img := Image.load_from_file(ATLAS_CACHE) if FileAccess.file_exists(ATLAS_CACHE) else null
	if img == null or img.get_width() != TILE * 2:
		img = _make_atlas()
		img.save_png(ATLAS_CACHE)
	_atlas = ImageTexture.create_from_image(img)
	return _atlas


static func _make_atlas() -> Image:
	var img := Image.create(TILE * 2, TILE * 2, false, Image.FORMAT_RGBA8)
	var rng := RandomNumberGenerator.new()
	rng.seed = 1
	for tile in 4:
		var lat := _lattice(rng)
		var warp := _lattice(rng)
		var ox := (tile % 2) * TILE
		var oy := (tile / 2) * TILE
		var blobs := []
		for b in 3:
			blobs.append(Vector3(0.5 + (rng.randf() - 0.5) * 0.3, 0.5 + (rng.randf() - 0.5) * 0.3, 0.34 + rng.randf() * 0.14))
		for y in TILE:
			for x in TILE:
				var u := float(x) / TILE
				var v := float(y) / TILE
				# the picture is bent by noise before the shape is looked up, so that the edge curls like smoke
				var wu := u + (_noise(warp, u * 5 + 2, v * 5 + 9) - 0.5) * 0.22
				var wv := v + (_noise(warp, u * 5 + 7, v * 5 + 1) - 0.5) * 0.22
				var shape := 0.0
				for bl: Vector3 in blobs:
					var d := Vector2(wu - bl.x, wv - bl.y).length() / bl.z
					shape = maxf(shape, pow(1.0 - minf(1.0, d), 0.8))
				var n := 0.5 * _noise(lat, u * 5, v * 5) + 0.3 * _noise(lat, u * 11 + 3, v * 11 + 7) + 0.2 * _noise(lat, u * 23 + 11, v * 23 + 5)
				var density := clampf(shape * 1.15 + (n - 0.5) * 0.95 - 0.2, 0.0, 1.0)
				density = density * density * (3.0 - 2.0 * density)
				var edge := clampf((0.5 - Vector2(u - 0.5, v - 0.5).length()) / 0.14, 0.0, 1.0)
				density *= edge * edge * (3.0 - 2.0 * edge)
				var patches := 0.6 * _noise(lat, u * 7 + 5, v * 7 + 13) + 0.4 * _noise(lat, u * 15 + 9, v * 15 + 2)
				var light := clampf(0.72 + 0.2 * (1.0 - v) + 0.3 * (patches - 0.5) - 0.05 * density, 0.3, 1.0)
				img.set_pixel(ox + x, oy + y, Color(light, light, minf(1.0, light + 0.03), density))
	return img


static func _lattice(rng: RandomNumberGenerator) -> PackedFloat32Array:
	var a := PackedFloat32Array()
	a.resize(256)
	for i in 256:
		a[i] = rng.randf()
	return a


## Value noise on a 16 x 16 lattice that wraps.
static func _noise(a: PackedFloat32Array, x: float, y: float) -> float:
	var xi := floori(x)
	var yi := floori(y)
	var fx := x - xi
	var fy := y - yi
	fx = fx * fx * (3.0 - 2.0 * fx)
	fy = fy * fy * (3.0 - 2.0 * fy)
	var x0 := posmod(xi, 16)
	var y0 := posmod(yi, 16)
	var x1 := (x0 + 1) % 16
	var y1 := (y0 + 1) % 16
	return lerpf(lerpf(a[y0 * 16 + x0], a[y0 * 16 + x1], fx), lerpf(a[y1 * 16 + x0], a[y1 * 16 + x1], fx), fy)


## A cloud of puffs of the smoke atlas (also the steam and the smoke of a hurt engine, EngineFumes): the colour of the
## smoke (a light grey when not given) or of the dust.
static func emitter(atlas: Texture2D, dust: bool, colour := Color(0.9, 0.91, 0.94)) -> GPUParticles3D:
	var p := GPUParticles3D.new()
	p.amount = 160 if dust else 500
	p.lifetime = 1.8 if dust else 7.0
	p.randomness = 0.4
	p.local_coords = false
	p.interpolate = true
	p.fract_delta = true
	p.emitting = false
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	# (the emitter goes with the wheel, its smoke stays where it was made: a plume 300 m back is still drawn, as in Smoke.js)
	p.visibility_aabb = AABB(Vector3(-300, -10, -300), Vector3(600, 60, 600))
	var m := ParticleProcessMaterial.new()
	m.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	m.emission_sphere_radius = 0.15
	m.direction = Vector3(0, 1, 0)
	m.spread = 50.0
	m.initial_velocity_min = 0.3
	m.initial_velocity_max = 1.4 if dust else 1.0
	m.inherit_velocity_ratio = 0.15
	m.gravity = Vector3(0, -0.4, 0) if dust else Vector3(0, 0.22, 0)
	m.damping_min = 0.4
	m.damping_max = 0.9
	m.turbulence_enabled = true
	m.turbulence_noise_strength = 1.0
	m.turbulence_noise_scale = 6.0
	m.turbulence_influence_min = 0.03
	m.turbulence_influence_max = 0.1
	m.angle_min = -180.0
	m.angle_max = 180.0
	m.angular_velocity_min = -25.0
	m.angular_velocity_max = 25.0
	m.anim_offset_min = 0.0
	m.anim_offset_max = 1.0
	m.scale_min = 0.8
	m.scale_max = 1.25
	var grow := Curve.new()
	grow.max_value = 8.0
	var top := 2.6 if dust else 6.5
	for k in 9:
		var t := k / 8.0
		grow.add_point(Vector2(t, 0.35 + (top - 0.35) * sqrt(t)))
	var grow_tex := CurveTexture.new()
	grow_tex.curve = grow
	m.scale_curve = grow_tex
	var fade := Gradient.new()
	var a0 := 0.32 if dust else 0.42
	fade.offsets = PackedFloat32Array([0.0, 0.06, 0.35, 1.0])
	fade.colors = PackedColorArray([Color(1, 1, 1, 0), Color(1, 1, 1, a0), Color(1, 1, 1, a0 * 0.7), Color(1, 1, 1, 0)])
	var fade_tex := GradientTexture1D.new()
	fade_tex.gradient = fade
	m.color_ramp = fade_tex
	m.color = Color(0.66, 0.55, 0.4) if dust else colour
	p.process_material = m
	var quad := QuadMesh.new()
	quad.size = Vector2(1, 1)
	var mat := StandardMaterial3D.new()
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	mat.particles_anim_h_frames = 2
	mat.particles_anim_v_frames = 2
	mat.particles_anim_loop = false
	mat.vertex_color_use_as_albedo = true
	mat.albedo_texture = atlas
	mat.proximity_fade_enabled = true
	mat.proximity_fade_distance = 0.6
	quad.material = mat
	p.draw_pass_1 = quad
	return p


## The size over the life of a puff (from s0 to s1 as the root of the age, Smoke.js) and its fade (in over the
## first 5 %, out as (1 - t)^1.4).
static func _shape(m: ParticleProcessMaterial, s0: float, s1: float, a0: float) -> void:
	var grow := Curve.new()
	grow.max_value = maxf(1.0, s1 * 1.1)
	for k in 9:
		var t := k / 8.0
		grow.add_point(Vector2(t, s0 + (s1 - s0) * sqrt(t)))
	var grow_tex := CurveTexture.new()
	grow_tex.curve = grow
	m.scale_curve = grow_tex
	var fade := Gradient.new()
	var offsets := PackedFloat32Array([0.0, 0.05])
	var colors := PackedColorArray([Color(1, 1, 1, 0), Color(1, 1, 1, a0 * pow(0.95, 1.4))])
	for k in range(1, 7):
		var t := 0.05 + 0.95 * k / 6.0
		offsets.append(t)
		colors.append(Color(1, 1, 1, a0 * pow(1.0 - t, 1.4)))
	fade.offsets = offsets
	fade.colors = colors
	var fade_tex := GradientTexture1D.new()
	fade_tex.gradient = fade
	m.color_ramp = fade_tex


## The second layer of the smoke of a tyre (Smoke.js "fine"): small dense puffs close to the tyre that curl up behind
## it, gone in a second or two (up to 300 a second).
static func fine_emitter(atlas: Texture2D) -> GPUParticles3D:
	var p := emitter(atlas, false)
	p.amount = 400
	p.lifetime = 1.8
	p.randomness = 0.5
	var m := p.process_material as ParticleProcessMaterial
	m.emission_sphere_radius = 0.12
	m.emission_shape_offset = Vector3(0, 0.15, 0)
	m.initial_velocity_min = 0.5
	m.initial_velocity_max = 1.6
	m.spread = 30.0
	m.inherit_velocity_ratio = 0.05
	m.scale_min = 0.8
	m.scale_max = 1.3
	_shape(m, 0.2, 0.7, 0.55)
	return p


## The wisps that the car takes out of a plume (Smoke.js): small puffs with the speed of the car, gone in a second or
## two; made one by one (emit_particle), at the nose or the tail of the car.
static func wisp_emitter(atlas: Texture2D) -> GPUParticles3D:
	var p := emitter(atlas, false)
	p.amount = 64
	p.lifetime = 1.7
	p.randomness = 0.5
	p.emitting = false
	p.amount_ratio = 1.0
	var m := p.process_material as ParticleProcessMaterial
	m.initial_velocity_min = 0.0
	m.initial_velocity_max = 0.0
	m.inherit_velocity_ratio = 0.0
	m.damping_min = 8.0             # (the air takes their speed quickly: Smoke.js e^-2.2 t)
	m.damping_max = 14.0
	m.gravity = Vector3(0, 0.22, 0)
	m.scale_min = 0.85
	m.scale_max = 1.2
	_shape(m, 0.3, 1.2, 0.35)
	return p


## Takes the marks away (a new start).
func clear() -> void:
	for n in CHUNKS:
		_strips[n] = []
		(_chunks[n].mesh as ArrayMesh).clear_surfaces()
	_chunk = 0
	_last = [null, null, null, null]


func _process(delta: float) -> void:
	if car == null or ReplayFx.active:
		return
	_time += delta
	var setting := float(Settings.get_value("gfx_smoke")) / 100.0         # (the Smoke of the Graphics settings)
	var fwd := car.global_transform.basis.z
	fwd = Vector3(fwd.x, 0.0, fwd.z).normalized() if Vector2(fwd.x, fwd.z).length() > 1e-3 else Vector3.RIGHT
	var left := Vector3(fwd.z, 0.0, -fwd.x)
	for i in 4:
		var w := car.wheels[i]
		var loose: bool = Content.surface(w.surface).get("loose", false)
		_mark(i, w, loose)
		var at := w.point if w.contact else car.to_global(w.hub)
		var amount := clampf(w.smoke * setting, 0.0, 1.0)
		if not w.contact:
			amount = 0.0
		# the plume comes when the tyre smokes hard and turns (a tyre that stands still makes only a few small
		# puffs); the small layer from the first smoke (Smoke.js bigShare, fineShare)
		var tread := w.omega * w.radius
		var along := w.forward_speed
		var turning := minf(1.0, maxf(absf(tread), absf(along)) / 3.0)
		var big := amount if loose else amount * clampf((w.smoke - 0.25) / 0.45, 0.0, 1.0) * turning
		var fine := minf(1.0, w.smoke * 20.0) * (0.12 + 0.88 * turning) * minf(1.0, setting) * (40.0 / 300.0 if loose else 1.0)
		if amount <= 0.02:
			fine = 0.0
		# thrown the other way from where the tread spins, at the speed it spins faster than the car moves
		var spun := maxf(0.0, absf(tread) - absf(along)) * (1.0 if tread * along >= 0.0 or absf(along) < 1.0 else 0.5)
		var dir := -1.0 if tread >= 0.0 else 1.0
		var outward := left * (1.0 if w.left else -1.0)
		var throw := fwd * dir * minf(6.0, spun * 0.29) + outward * minf(1.2, spun * 0.03)
		for e: GPUParticles3D in [_smoke[i], _dust[i], _fine[i]]:
			var mine := fine if e == _fine[i] else (big if (e == _dust[i]) == loose else 0.0)
			e.global_position = at
			e.amount_ratio = mine
			e.emitting = mine > 0.005
			if e == _dust[i] or not e.emitting:
				continue
			var m := e.process_material as ParticleProcessMaterial
			var up := 0.85 + minf(2.0, spun * 0.08) if e == _smoke[i] else 1.05 + minf(1.2, spun * 0.05)
			var v := throw * (1.0 if e == _smoke[i] else 0.5) + Vector3.UP * up
			m.direction = v.normalized()
			m.initial_velocity_min = v.length() * 0.6
			m.initial_velocity_max = v.length() * 1.3
			m.damping_max = 0.9 + 1.4 * throw.length()
			m.damping_min = m.damping_max * 0.5
			if e == _fine[i]:
				m.color = DUST if loose else SMOKE
		_smoke_in[i] -= delta
		if amount > 0.02 and _smoke_in[i] <= 0.0:
			_smoke_in[i] = 1.0 / 15.0
			ReplayFx.add("smoke", car, [0.0, i, at.x, at.y, at.z, amount, 1.0 if loose else 0.0])
		# the plume where it was made, for the wisps (not the dust: it is gone before it is a cloud)
		_plume_in[i] -= delta
		if big > 0.1 and not loose and _plume_in[i] <= 0.0:
			_plume_in[i] = 0.1
			_plume.append([at, _time, -1e9])
			if _plume.size() > PLUME_POINTS:
				_plume.pop_front()
	_body_smoke()
	_rebuild_in -= delta
	if _dirty and _rebuild_in <= 0.0:
		_build(_chunk)
		_rebuild_in = 0.05


## The box of the body in the frame of the car: the meshes of the model without the wheels (Smoke.js takes the
## collision spheres of the shell), or the dimensions of car.json.
func _body_box() -> AABB:
	if _box_of == car.model_root and _box.size != Vector3.ZERO:
		return _box
	_box_of = car.model_root
	if car.model_root != null:
		_box = CarModel.bounds(car.model_root, car)
	if car.model_root == null or _box.size == Vector3.ZERO:
		var dims: Dictionary = car.config.get("dimensions", {})
		var size := Vector3(float(dims.get("width", 1.8)), float(dims.get("height", 1.3)), float(dims.get("length", 4.2)))
		_box = AABB(Vector3(-size.x / 2.0, 0.0, -size.z / 2.0), size)
	return _box


## The car and the smoke: the young smoke is pushed out of the body (the car pushes the air away, it does not carry
## it); where the car drives through a plume that has hung in the air for a while (PLUME_AGE), it takes small wisps of
## it along: two new puffs at its nose or its tail, with nine tenths of its speed, at most six a frame and from one
## place of the plume every half second.
func _body_smoke() -> void:
	var box := _body_box()
	var xf := car.global_transform
	# (under the floor the smoke can go: the car stands a hand above the road)
	var low := box.position.y + 0.1
	var top := box.end.y + 0.12
	var centre := Vector3(box.get_center().x, (low + top) / 2.0, box.get_center().z)
	_repel.global_transform = Transform3D(xf.basis.orthonormalized(), xf * centre)
	_repel.size = Vector3(box.size.x + 0.24, top - low, box.size.z + 0.24)
	var v := car.linear_velocity
	wisps.global_position = xf.origin             # (its box of what is seen goes with the car)
	if _plume.is_empty():
		return
	var oldest := _time - PLUME_LIFE * 0.9
	while not _plume.is_empty() and float(_plume[0][1]) < oldest:
		_plume.pop_front()
	if Vector2(v.x, v.z).length() < 3.0 or not wisps.is_inside_tree():
		return
	var inv := xf.affine_inverse()
	var reach := box.size.length() / 2.0 + 0.5
	var made := 0
	var m := 0.12
	for pt: Array in _plume:
		if made >= 6:
			break
		var age := _time - float(pt[1])
		if age < PLUME_AGE or _time - float(pt[2]) < 0.5:
			continue
		# (the plume has risen a little from the road where it was made, and grown: its middle is about 0.6 m up)
		var p: Vector3 = pt[0] + Vector3(0.0, 0.6, 0.0)
		if p.distance_to(xf.origin) > reach:
			continue
		var lp := inv * p
		if lp.x < box.position.x - m or lp.x > box.end.x + m or lp.z < box.position.z - m or lp.z > box.end.z + m:
			continue
		if lp.y < low - 0.6 or lp.y > top + 0.6:
			continue
		pt[2] = _time
		var out := Vector3(clampf(lp.x, box.position.x, box.end.x), clampf(lp.y, low, box.position.y + 0.55 * box.size.y),
			box.end.z + m if lp.z > box.get_center().z else box.position.z - m)
		var wp := xf * out
		for k in 2:
			var t := Transform3D(Basis.IDENTITY, wp + Vector3(randf_range(-0.15, 0.15), -0.04, randf_range(-0.15, 0.15)))
			wisps.emit_particle(t, v * 0.9 + Vector3(0.0, 0.2, 0.0), Color(SMOKE, 1.0), Color(), GPUParticles3D.EMIT_FLAG_POSITION | GPUParticles3D.EMIT_FLAG_VELOCITY)
			wisps_made += 1
		made += 2


func _mark(i: int, w: Car.Wheel, dust: bool) -> void:
	var prev = _last[i]
	if not w.contact or w.mark < 0.05:
		_last[i] = null
		return
	var p := w.point + w.normal * LIFT
	var a := minf(0.85, w.mark * (0.5 if dust else 0.95))
	if prev == null:
		_last[i] = {"p": p, "side": Vector3.ZERO, "a": a * 0.3}
		return
	var d: Vector3 = p - prev["p"]
	var dist := d.length()
	if dist < STEP:
		return
	if dist > 3.0:
		_last[i] = {"p": p, "side": Vector3.ZERO, "a": a * 0.3}
		return
	# the width across the direction the patch moves: the same in a slide as rolling
	var half := maxf(0.08, w.width * 0.42)
	var side := w.normal.cross(d / dist).normalized() * half
	var prev_side: Vector3 = prev["side"]
	if prev_side == Vector3.ZERO:
		prev_side = side
	var strips: Array = _strips[_chunk]
	if strips.size() >= CHUNK:
		_build(_chunk)
		_chunk = (_chunk + 1) % CHUNKS
		strips = []
		_strips[_chunk] = strips
	var q: Vector3 = prev["p"]
	var strip := [q - prev_side, q + prev_side, p - side, p + side, float(prev["a"]), a, dust]
	strips.append(strip)
	_last[i] = {"p": p, "side": side, "a": a}
	_dirty = true
	var row := [0.0]
	for k in 4:
		var v: Vector3 = strip[k]
		row.append_array([v.x, v.y, v.z])
	row.append_array([strip[4], a, 1.0 if dust else 0.0])
	ReplayFx.add("skid", car, row)


## A strip of a mark in the chunk that is filled (a new chunk when it is full).
func _push(strip: Array) -> void:
	if (_strips[_chunk] as Array).size() >= CHUNK:
		_build(_chunk)
		_chunk = (_chunk + 1) % CHUNKS
		_strips[_chunk] = []
	(_strips[_chunk] as Array).append(strip)
	_dirty = true


func _build(n: int) -> void:
	_dirty = false
	var mesh := _chunks[n].mesh as ArrayMesh
	mesh.clear_surfaces()
	var strips: Array = _strips[n]
	if strips.is_empty():
		return
	var verts := PackedVector3Array()
	var colors := PackedColorArray()
	var uvs := PackedVector2Array()
	verts.resize(strips.size() * 6)
	colors.resize(strips.size() * 6)
	uvs.resize(strips.size() * 6)
	var k := 0
	var v_along := 0.0
	for s in strips:
		var tint := Vector3(0.36, 0.29, 0.2) if s[6] else Vector3(0.05, 0.05, 0.05)
		var c0 := Color(tint.x, tint.y, tint.z, s[4])
		var c1 := Color(tint.x, tint.y, tint.z, s[5])
		var corners := [s[0], s[1], s[2], s[3]]
		var cols := [c0, c0, c1, c1]
		var cuv := [Vector2(0, v_along), Vector2(1, v_along), Vector2(0, v_along + 0.25), Vector2(1, v_along + 0.25)]
		v_along += 0.25
		for idx in [0, 2, 1, 1, 2, 3]:
			verts[k] = corners[idx]
			colors[k] = cols[idx]
			uvs[k] = cuv[idx]
			k += 1
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_COLOR] = colors
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)


# ---- the replay (ReplayFx): "skid" (a row is a strip of a mark), "smoke" (a row: the smoke or dust of a wheel, where)

func replay_lookback(_kind: String) -> float:
	return 0.0


static func _strip_of(r: Array) -> Array:
	return [Vector3(r[1], r[2], r[3]), Vector3(r[4], r[5], r[6]), Vector3(r[7], r[8], r[9]), Vector3(r[10], r[11], r[12]),
		r[13], r[14], float(r[15]) > 0.5]


func replay_add(kind: String, r: Array) -> void:
	if kind == "skid":
		_push(_strip_of(r))
		return
	var i := int(r[1])
	var dust := float(r[6]) > 0.5
	for e: GPUParticles3D in [_smoke[i], _dust[i], _fine[i]]:
		var mine: float = r[5] if (e == _dust[i]) == dust else 0.0
		if e == _fine[i]:
			mine = minf(1.0, float(r[5]) * 20.0) * (40.0 / 300.0 if dust else 1.0)
		e.global_position = Vector3(r[2], r[3], r[4])
		e.amount_ratio = mine
		e.emitting = mine > 0.02
	_hold[i] = 0.12


func replay_step(kind: String, dt: float) -> void:
	if kind == "skid":
		if _dirty:
			_build(_chunk)
		return
	for i in 4:
		if _hold[i] > 0.0:
			_hold[i] -= dt
			if _hold[i] <= 0.0:
				_smoke[i].emitting = false
				_dust[i].emitting = false
				_fine[i].emitting = false


func replay_clear(kind: String) -> void:
	if kind == "skid":
		clear()
		return
	for e: GPUParticles3D in _smoke + _dust + _fine:
		e.emitting = false
		e.restart()
		e.emitting = false
	_hold = [0.0, 0.0, 0.0, 0.0]


## The marks at time t: every strip that was made by then (the newest that fit).
func replay_rebuild(kind: String, rows: Array, end: int, _t: float) -> void:
	if kind != "skid":
		return
	clear()
	for j in range(maxi(0, end - CHUNK * CHUNKS), end):
		_push(_strip_of(rows[j]))
	for n in CHUNKS:
		_build(n)


func replay_snapshot(kind: String) -> Variant:
	if kind == "skid":
		var copy: Array = []
		for st: Array in _strips:
			copy.append(st.duplicate())
		return {"strips": copy, "chunk": _chunk}
	# (the smoke goes on in the replay, while the game is paused)
	for e: GPUParticles3D in _smoke + _dust + _fine:
		e.process_mode = Node.PROCESS_MODE_ALWAYS
	replay_clear(kind)
	return null


func replay_restore(kind: String, snap: Variant) -> void:
	if kind == "skid":
		_strips = snap["strips"]
		_chunk = snap["chunk"]
		_last = [null, null, null, null]
		for n in CHUNKS:
			_build(n)
		return
	replay_clear(kind)
	for e: GPUParticles3D in _smoke + _dust + _fine:
		e.process_mode = Node.PROCESS_MODE_INHERIT
