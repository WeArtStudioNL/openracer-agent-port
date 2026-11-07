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

const CHUNK := 400                   # strips per mesh
const CHUNKS := 20                   # 8000 strips: about a kilometre of marks
const STEP := 0.12                   # m between the points of a mark
const LIFT := 0.012                  # m above the road
const TILE := 64                     # pixels of a puff in the atlas
const ATLAS_CACHE := "user://smoke_atlas.png"

static var _atlas: ImageTexture

var car: Car
var _chunks: Array[MeshInstance3D] = []
var _strips: Array = []              # per chunk: Array of strips [p0a, p0b, p1a, p1b, a0, a1, dust]
var _chunk := 0
var _dirty := false
var _rebuild_in := 0.0
var _last: Array = [null, null, null, null]       # per wheel: {p, side, a}
var _smoke: Array[GPUParticles3D] = []
var _dust: Array[GPUParticles3D] = []
var _mark_material: StandardMaterial3D


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
	var atlas := _smoke_atlas()
	for i in 4:
		var s := _emitter(atlas, false)
		var d := _emitter(atlas, true)
		_smoke.append(s)
		_dust.append(d)
		add_child(s)
		add_child(d)


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
static func _smoke_atlas() -> ImageTexture:
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


func _emitter(atlas: Texture2D, dust: bool) -> GPUParticles3D:
	var p := GPUParticles3D.new()
	p.amount = 160 if dust else 500
	p.lifetime = 1.8 if dust else 7.0
	p.randomness = 0.4
	p.local_coords = false
	p.interpolate = true
	p.fract_delta = true
	p.emitting = false
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	p.visibility_aabb = AABB(Vector3(-60, -5, -60), Vector3(120, 40, 120))
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
	m.color = Color(0.66, 0.55, 0.4) if dust else Color(0.9, 0.91, 0.94)
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


## Takes the marks away (a new start).
func clear() -> void:
	for n in CHUNKS:
		_strips[n] = []
		(_chunks[n].mesh as ArrayMesh).clear_surfaces()
	_chunk = 0
	_last = [null, null, null, null]


func _process(delta: float) -> void:
	if car == null:
		return
	for i in 4:
		var w := car.wheels[i]
		var loose: bool = Content.surface(w.surface).get("loose", false)
		_mark(i, w, loose)
		var at := w.point if w.contact else car.to_global(w.hub)
		var amount := clampf(w.smoke, 0.0, 1.0)
		for e: GPUParticles3D in [_smoke[i], _dust[i]]:
			var mine := amount if (e == _dust[i]) == loose else 0.0
			e.global_position = at
			e.amount_ratio = mine
			e.emitting = mine > 0.02
	_rebuild_in -= delta
	if _dirty and _rebuild_in <= 0.0:
		_build(_chunk)
		_rebuild_in = 0.05


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
	strips.append([q - prev_side, q + prev_side, p - side, p + side, float(prev["a"]), a, dust])
	_last[i] = {"p": p, "side": side, "a": a}
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
