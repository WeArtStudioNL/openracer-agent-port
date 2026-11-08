class_name GroundSpray
extends Node3D
## What the wheels throw up from the condition of the ground (the water and the snow of web/js/Debris.js): a wheel in
## a puddle that goes fast throws the water up and to the sides (the more the faster), white and grey droplets that
## fall again at once; a wheel that slips on snow throws flakes the way the tread moves against the ground. The Smoke
## of the Graphics settings scales them.

var car: Car
var _water: Array[GPUParticles3D] = []
var _snow: Array[GPUParticles3D] = []


func setup(c: Car) -> void:
	car = c
	name = "GroundSpray"
	for i in 4:
		_water.append(_emitter(Color(0.82, 0.86, 0.9, 0.5), 0.07, 3.5))
		_snow.append(_emitter(Color(0.95, 0.96, 1.0, 0.9), 0.08, 2.5))


func _emitter(colour: Color, size: float, up: float) -> GPUParticles3D:
	var p := GPUParticles3D.new()
	p.amount = 300
	p.lifetime = 0.9
	p.local_coords = false
	p.emitting = false
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	p.visibility_aabb = AABB(Vector3(-30, -5, -30), Vector3(60, 20, 60))
	var m := ParticleProcessMaterial.new()
	m.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	m.emission_sphere_radius = 0.12
	m.direction = Vector3(0, 1, 0)
	m.spread = 35.0
	m.initial_velocity_min = up * 0.4
	m.initial_velocity_max = up
	m.inherit_velocity_ratio = 0.5
	m.gravity = Vector3(0, -9.8, 0)
	m.scale_min = 0.6
	m.scale_max = 1.4
	var fade := Gradient.new()
	fade.offsets = PackedFloat32Array([0.0, 0.7, 1.0])
	fade.colors = PackedColorArray([Color(1, 1, 1, 1), Color(1, 1, 1, 0.8), Color(1, 1, 1, 0)])
	var fade_tex := GradientTexture1D.new()
	fade_tex.gradient = fade
	m.color_ramp = fade_tex
	m.color = colour
	p.process_material = m
	var quad := QuadMesh.new()
	quad.size = Vector2(size, size)
	var mat := StandardMaterial3D.new()
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	mat.vertex_color_use_as_albedo = true
	# (a round drop or flake: white, fading out to the edge)
	var img := Image.create_empty(16, 16, false, Image.FORMAT_RGBA8)
	for y in 16:
		for x in 16:
			var r := Vector2(x + 0.5 - 8.0, y + 0.5 - 8.0).length() / 8.0
			img.set_pixel(x, y, Color(1, 1, 1, clampf(1.0 - r, 0.0, 1.0)))
	mat.albedo_texture = ImageTexture.create_from_image(img)
	quad.material = mat
	p.draw_pass_1 = quad
	add_child(p)
	return p


func _process(_delta: float) -> void:
	if car == null:
		return
	var amount := float(Settings.get_value("gfx_smoke")) / 100.0
	var v := car.linear_velocity
	var speed := Vector2(v.x, v.z).length()
	for i in 4:
		var w := car.wheels[i]
		var water := 0.0
		var flakes := 0.0
		if w.contact:
			if w.local_water > 0.3 and speed > 3.0 and Ground.snow < 0.3:
				water = minf(1.0, speed / 25.0) * w.local_water
			var snow := Ground.snow if w.local_snow < 0.0 else w.local_snow
			var slip := Vector2(w.forward_speed - w.omega * w.radius, w.side_speed).length()
			if snow > 0.35 and slip > 1.2:
				flakes = minf(1.0, (slip - 1.0) / 6.0)
		for pair in [[_water[i], water], [_snow[i], flakes]]:
			var e: GPUParticles3D = pair[0]
			var r := clampf(float(pair[1]) * amount, 0.0, 1.0)
			e.global_position = w.point if w.contact else car.to_global(w.hub)
			e.amount_ratio = r
			e.emitting = r > 0.02
