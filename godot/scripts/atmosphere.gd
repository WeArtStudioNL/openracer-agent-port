class_name Atmosphere
extends Node3D
## The sky, the light, the weather and the condition of the ground of a drive (web/js/Atmosphere.js). The sky is the
## same on every track: a sky shader made from the time of day and the weather, so that the sun, the moon, the stars,
## the clouds, the light and the fog all go together. The track only gives how bright its materials like the light
## (the intensities of the "environment" of track.json).
##
## Time of day (gfx_time, the hour 0 to 24): the sun rises at 5:00, is highest at 12:00 and sets at 19:00
## (gfx_sun_azimuth is where it stands at noon); its light gets warm and weak near the horizon, the sky goes orange and
## then dark blue, and from dusk to dawn the moon (gfx_moon: its phase) gives a faint light under the stars.
## Weather (gfx_weather): clear, cloudy, fog, rain and snow: the clouds, the sun and the sky light, the view (fog), and
## rain or snow that falls past the camera. The ground follows the weather (Ground): wet, puddles, snow.
##
## It also holds the graphics settings of the drive (Graphics) and applies both live when a setting changes.

## What the weather does: the share of the sun and of the light of the sky that is left, how grey the sky gets, the
## clouds (how much of the sky they cover), the shadows, the view (near, far of the fog; [] none), what falls, and how
## dark it gets.
const WEATHER := {
	"clear": {"sun": 1.0, "sky": 1.0, "grey": 0.0, "cover": 0.4, "shadow": 1.0, "fog": [], "fall": "", "dark": 1.0},
	"cloudy": {"sun": 0.4, "sky": 1.15, "grey": 0.6, "cover": 0.78, "shadow": 0.35, "fog": [], "fall": "", "dark": 1.0},
	"fog": {"sun": 0.25, "sky": 1.25, "grey": 1.0, "cover": 0.9, "shadow": 0.2, "fog": [4.0, 110.0], "fall": "", "dark": 1.0},
	"rain": {"sun": 0.18, "sky": 0.95, "grey": 0.9, "cover": 0.97, "shadow": 0.12, "fog": [15.0, 380.0], "fall": "rain", "dark": 0.7},
	"snow": {"sun": 0.3, "sky": 1.2, "grey": 0.75, "cover": 0.9, "shadow": 0.2, "fog": [10.0, 300.0], "fall": "snow", "dark": 1.0},
}
## The sky of the game (TrackEnvironment.js environmentDefaults): the same on every track.
const SKY_TOP := "#4a82c4"
const SKY_HORIZON := "#d3e4f4"
const AMBIENT := "#576777"
const ATMOSPHERE_KEYS := ["gfx_time", "gfx_weather", "gfx_sun_azimuth", "gfx_moon"]

var env: Environment
var sun: DirectionalLight3D
var post: CanvasLayer
var _sky_mat: ShaderMaterial
var _track_sun := 1.0
var _track_sky := 1.0
var _falls := {}                         # "rain"/"snow" -> MeshInstance3D
var _clear_img: Image
var _clear_tex: ImageTexture
var _rings_img: Image
var _rings_tex: ImageTexture
var _cars: Array = []
var _cars_in := 0.0
var _upload_in := 0.0
var _log_in := 0.0
var _weather := ""
var _applied := false


## track_env: the "environment" of track.json; model: the track model (its surfaces get the ground look).
func setup(track_env: Dictionary, model: Node) -> void:
	name = "Atmosphere"
	_track_sun = float(track_env.get("sun", {}).get("intensity", 1.0))
	_track_sky = float(track_env.get("ambient", {}).get("intensity", 1.0))
	_clear_img = Image.create_empty(Ground.CLEAR_N, Ground.CLEAR_N, false, Image.FORMAT_RH)
	_clear_tex = ImageTexture.create_from_image(_clear_img)
	_rings_img = Image.create_empty(Ground.RINGS, 1, false, Image.FORMAT_RGBAF)
	_rings_tex = ImageTexture.create_from_image(_rings_img)
	GroundMaterial.make_globals(_clear_tex, _rings_tex)
	RenderingServer.global_shader_parameter_set("ground_clear", _clear_tex)
	RenderingServer.global_shader_parameter_set("ground_rings", _rings_tex)
	if model != null:
		var n := GroundMaterial.patch(model)
		RunLog.event("atmosphere: %d materials of the track have the ground look" % n)

	var shader := Shader.new()
	shader.code = AtmosphereShaders.SKY
	_sky_mat = ShaderMaterial.new()
	_sky_mat.shader = shader
	var sky := Sky.new()
	sky.sky_material = _sky_mat
	sky.radiance_size = Sky.RADIANCE_SIZE_128
	env = Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.fog_mode = Environment.FOG_MODE_DEPTH
	env.fog_sky_affect = 0.0
	env.fog_sun_scatter = 0.0
	env.fog_depth_curve = 1.0
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	sun = DirectionalLight3D.new()
	sun.name = "Sun"
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 220.0
	add_child(sun)
	_falls["rain"] = _make_fall(true)
	_falls["snow"] = _make_fall(false)
	post = Graphics.make_post()
	add_child(post)
	_weather = str(Settings.get_value("gfx_weather"))
	Ground.start(_weather)
	Settings.changed.connect(_on_setting)
	apply()


func _ready() -> void:
	get_viewport().size_changed.connect(_resized)


func _resized() -> void:
	get_viewport().scaling_3d_scale = Graphics.scale_3d(get_viewport())


func _on_setting(key: String) -> void:
	if ATMOSPHERE_KEYS.has(key):
		if key == "gfx_weather":
			RunLog.event("weather: %s" % Settings.get_value("gfx_weather"))
		apply()
	elif key.begins_with("gfx_"):
		Graphics.preset_follows(key)
		if is_inside_tree():
			Graphics.apply_all(get_viewport(), env, sun, post)


static func _lin(hex: String) -> Color:
	return Color(hex).srgb_to_linear()


static func _sun_height(hour: float) -> float:
	return 62.0 * sin(PI * (hour - 5.0) / 14.0)


## The direction to the sun (OpenRacer.sunVector: azimuth from +x towards +z, elevation up), a unit vector.
static func sun_vector(azimuth: float, elevation: float) -> Vector3:
	var az := deg_to_rad(azimuth)
	var el := deg_to_rad(elevation)
	return Vector3(cos(el) * cos(az), sin(el), cos(el) * sin(az))


static func _v3(c: Color) -> Vector3:
	return Vector3(c.r, c.g, c.b)


## The hour now (gfx_time; below 0: 14:00).
static func hour_now() -> float:
	var h := float(Settings.get_value("gfx_time"))
	return h if h >= 0.0 else 14.0


## The light, the sky and the fog from the hour and the weather (Atmosphere.js apply). The colours are worked out
## in linear light, as three.js does.
func apply() -> void:
	var hour := hour_now()
	var kind := str(Settings.get_value("gfx_weather"))
	var w: Dictionary = WEATHER.get(kind, WEATHER["clear"])
	var azimuth := float(Settings.get_value("gfx_sun_azimuth"))
	var phase := float(Settings.get_value("gfx_moon"))
	var raw := _sun_height(hour)
	var az := azimuth + (hour - 12.0) * 15.0
	var daylight := smoothstep(-12.0, 8.0, raw)
	var glow := exp(-pow((raw - 2.0) / 8.0, 2.0)) * (1.0 if raw > -10.0 else 0.0)
	var sun_colour := Color.WHITE.lerp(_lin("#ff9a4d"), minf(1.0, glow * 0.9))
	var sun_intensity := smoothstep(-1.0, 10.0, raw)
	var ambient_colour := _lin(AMBIENT).lerp(_lin("#1d2b52"), 1.0 - daylight)
	var ambient_intensity := 0.22 + 0.78 * daylight
	var top := _lin(SKY_TOP).lerp(_lin("#050a1e"), 1.0 - daylight)
	var horizon := _lin(SKY_HORIZON).lerp(_lin("#0d1631"), 1.0 - daylight)
	horizon = horizon.lerp(_lin("#ff8a4a"), minf(1.0, glow * 0.65) * smoothstep(-10.0, 0.0, raw))
	top = top.lerp(_lin("#7a5a8a"), glow * 0.18)
	# the moon: where the sun stood that many hours later (a full moon is opposite the sun)
	var moon_hour := fmod(hour + 12.0 * phase, 24.0)
	var moon_raw := _sun_height(moon_hour)
	var moon_az := azimuth + (moon_hour - 12.0) * 15.0
	var moon_light := smoothstep(-2.0, 8.0, moon_raw) * (1.0 - smoothstep(-3.0, 6.0, raw)) * (0.2 + 0.8 * phase)
	# the light that is used: the sun, or the moon when the sun is down
	var light_el := raw
	var light_az := az
	if raw < -1.0:
		light_el = maxf(8.0, moon_raw)
		light_az = moon_az
		sun_colour = _lin("#9fb6ff")
		sun_intensity = 0.16 * moon_light
	# the weather
	var dark := float(w["dark"])
	var grey := _lin("#aab3bd") * ((0.1 + 0.9 * daylight) * dark)
	grey.a = 1.0
	var w_grey := float(w["grey"])
	if w_grey > 0.0:
		var top_grey := grey * 0.8
		top_grey.a = 1.0
		top = top.lerp(top_grey, w_grey * 0.9)
		horizon = horizon.lerp(grey, w_grey)
		ambient_colour = ambient_colour.lerp(grey, w_grey * 0.5)
	sun_intensity *= float(w["sun"])
	ambient_intensity *= float(w["sky"]) * dark

	var dir := sun_vector(light_az, light_el)
	sun.basis = Basis.looking_at(-dir, Vector3.UP if absf(dir.y) < 0.99 else Vector3.FORWARD)
	sun.light_color = sun_colour.linear_to_srgb()
	sun.light_energy = 1.2 * sun_intensity * _track_sun
	sun.shadow_opacity = 0.8 * float(w["shadow"])
	env.ambient_light_color = ambient_colour.linear_to_srgb()
	env.ambient_light_energy = ambient_intensity * _track_sky

	# the sky
	var m := _sky_mat
	m.set_shader_parameter("top", _v3(top))
	m.set_shader_parameter("horizon", _v3(horizon))
	m.set_shader_parameter("sun_dir", sun_vector(az, raw))
	var sky_sun := Color.WHITE.lerp(_lin("#ff9a4d"), minf(1.0, glow * 0.9)) * (0.5 + 0.5 * smoothstep(-4.0, 6.0, raw))
	m.set_shader_parameter("sun_color", _v3(sky_sun))
	m.set_shader_parameter("moon_dir", sun_vector(moon_az, moon_raw))
	m.set_shader_parameter("moon_phase", phase)
	var cover := float(w["cover"])
	m.set_shader_parameter("sun_vis", (1.0 - minf(1.0, cover * 1.1)) * smoothstep(-2.0, 3.0, raw))
	m.set_shader_parameter("moon_vis", (1.0 - minf(1.0, cover * 1.15)) * (1.0 - smoothstep(-6.0, 4.0, raw)) * smoothstep(-3.0, 3.0, moon_raw))
	m.set_shader_parameter("stars", (1.0 - smoothstep(-14.0, -3.0, raw)) * (1.0 - minf(1.0, cover * 1.2)))
	m.set_shader_parameter("cover", cover)
	var bright := 0.12 + 0.88 * daylight
	var grey_cloud := grey * 1.15
	var cloud := Color.WHITE.lerp(grey_cloud, minf(1.0, w_grey * 1.1)) * bright
	cloud = cloud.lerp(_lin("#ff9d6a") * bright, minf(1.0, glow * 0.5) * (1.0 - w_grey * 0.6))
	m.set_shader_parameter("cloud_color", _v3(cloud))
	m.set_shader_parameter("cloud_shade", _v3(cloud) * 0.55)
	var fog: Array = w["fog"]
	m.set_shader_parameter("haze", 0.9 if not fog.is_empty() else 0.35)

	# the view: the fog of the weather, in the colour of the horizon
	env.fog_enabled = not fog.is_empty()
	if env.fog_enabled:
		env.fog_light_color = horizon.linear_to_srgb()
		env.fog_light_energy = 1.0
		env.fog_density = 1.0
		env.fog_depth_begin = float(fog[0])
		env.fog_depth_end = float(fog[1])
	for k: String in _falls:
		(_falls[k] as MeshInstance3D).visible = k == str(w["fall"])
	_weather = kind


## Streaks of rain or flakes of snow in a box round the camera, moved in the shader (no work for the processor).
func _make_fall(rainy: bool) -> MeshInstance3D:
	var count := 4000 if rainy else 3500
	var verts := PackedVector3Array()
	var uvs := PackedVector2Array()
	var corners := PackedVector2Array()
	var index := PackedInt32Array()
	for i in count:
		var p := Vector3(randf() * 40.0, randf() * 28.0, randf() * 40.0)
		var k := 0.7 + randf() * 0.6
		if rainy:
			verts.append(p)
			uvs.append(Vector2(0.0, k))
			verts.append(p)
			uvs.append(Vector2(1.0, k))
		else:
			# (a flake is a quad that the shader turns to the camera)
			var size := randf()
			var n := verts.size()
			for c in [Vector2(-1, -1), Vector2(1, -1), Vector2(1, 1), Vector2(-1, 1)]:
				verts.append(p)
				uvs.append(Vector2(size, k))
				corners.append(c)
			index.append_array([n, n + 1, n + 2, n, n + 2, n + 3])
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	if not rainy:
		arrays[Mesh.ARRAY_TEX_UV2] = corners
		arrays[Mesh.ARRAY_INDEX] = index
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_LINES if rainy else Mesh.PRIMITIVE_TRIANGLES, arrays)
	var shader := Shader.new()
	shader.code = AtmosphereShaders.RAIN if rainy else AtmosphereShaders.SNOW
	var mat := ShaderMaterial.new()
	mat.shader = shader
	mat.render_priority = 5
	mesh.surface_set_material(0, mat)
	var mi := MeshInstance3D.new()
	mi.name = "Rain" if rainy else "Snow"
	mi.mesh = mesh
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.custom_aabb = AABB(Vector3(-1e5, -1e5, -1e5), Vector3(2e5, 2e5, 2e5))
	mi.visible = false
	add_child(mi)
	return mi


## The cars of the drive (the player's first: the window of the cleared snow follows it).
func _find_cars() -> Array:
	var out: Array = []
	var world := get_parent().get_parent() if get_parent() != null else null
	if world == null:
		return out
	var first: Variant = world.get("car")
	if first is Car:
		out.append(first)
	for n in world.get_children():
		if n is Car and n != first and not (n as Car).is_ghost:
			out.append(n)
	return out


func _physics_process(dt: float) -> void:
	_cars_in -= dt
	if _cars_in <= 0.0:
		_cars_in = 1.0
		_cars = _find_cars()
	for i in range(_cars.size() - 1, -1, -1):
		if not is_instance_valid(_cars[i]):
			_cars.remove_at(i)
	Ground.step(dt, _weather, _cars)
	_log_in -= dt
	if _log_in <= 0.0:
		_log_in = 10.0
		RunLog.line("ground: %s, wet %.2f, snow %.2f, puddles %.2f, grip %.2f, road %.2f" % [_weather, Ground.wet, Ground.snow, Ground.puddle,
			Ground.grip(), Ground.road_grip()])


func _process(delta: float) -> void:
	# (the graphics once the camera of the drive is there: the draw distance is on it)
	if not _applied and get_viewport().get_camera_3d() != null:
		_applied = true
		Graphics.apply_all(get_viewport(), env, sun, post)
	RenderingServer.global_shader_parameter_set("ground_wet", Ground.wet)
	RenderingServer.global_shader_parameter_set("ground_snow", Ground.snow)
	RenderingServer.global_shader_parameter_set("ground_puddle", Ground.puddle)
	RenderingServer.global_shader_parameter_set("ground_road_melt", Ground.road_melt)
	RenderingServer.global_shader_parameter_set("ground_rain", Ground.rain)
	RenderingServer.global_shader_parameter_set("ground_regrow", Ground.regrow)
	RenderingServer.global_shader_parameter_set("ground_clear_centre", Ground.window_middle())
	RenderingServer.global_shader_parameter_set("ground_clear_size", Ground.CLEAR_SIZE)
	if Ground.puddle > 0.01:
		for k in Ground.RINGS:
			var r: Vector4 = Ground.rings[k] if k < Ground.rings.size() else Vector4(0, 0, 99, 0)
			_rings_img.set_pixel(k, 0, Color(r.x, r.y, r.z, r.w))
		_rings_tex.update(_rings_img)
	_upload_in -= delta
	if Ground.window_dirty and _upload_in <= 0.0 and Ground.snow > 0.003 and not Ground.window.is_empty():
		_upload_in = 0.05
		Ground.window_dirty = false
		var img := Image.create_from_data(Ground.CLEAR_N, Ground.CLEAR_N, false, Image.FORMAT_RF, Ground.window.to_byte_array())
		img.convert(Image.FORMAT_RH)
		_clear_tex.update(img)
