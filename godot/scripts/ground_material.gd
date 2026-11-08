class_name GroundMaterial
extends RefCounted
## The surfaces of a track get the wet, the puddles and the snow (Atmosphere.js patchMaterial): every opaque
## StandardMaterial3D of the track model is made again as a ShaderMaterial of the ground shader (AtmosphereShaders.GROUND)
## with the same colour, texture, normal map, roughness and metallic. The numbers of the ground are global uniforms,
## shared by all of them, set every frame (Atmosphere).

const GLOBALS := {
	"ground_wet": RenderingServer.GLOBAL_VAR_TYPE_FLOAT,
	"ground_snow": RenderingServer.GLOBAL_VAR_TYPE_FLOAT,
	"ground_puddle": RenderingServer.GLOBAL_VAR_TYPE_FLOAT,
	"ground_road_melt": RenderingServer.GLOBAL_VAR_TYPE_FLOAT,
	"ground_rain": RenderingServer.GLOBAL_VAR_TYPE_FLOAT,
	"ground_regrow": RenderingServer.GLOBAL_VAR_TYPE_FLOAT,
	"ground_clear_centre": RenderingServer.GLOBAL_VAR_TYPE_VEC2,
	"ground_clear_size": RenderingServer.GLOBAL_VAR_TYPE_FLOAT,
	"ground_clear": RenderingServer.GLOBAL_VAR_TYPE_SAMPLER2D,
	"ground_rings": RenderingServer.GLOBAL_VAR_TYPE_SAMPLER2D,
}

static var _shaders := {}
static var _globals_made := false


## The global uniforms of the ground shader (once; they must be there before a ground shader is compiled).
static func make_globals(clear: Texture2D, rings: Texture2D) -> void:
	if _globals_made:
		return
	_globals_made = true
	# (the list is only there in the editor: an exported game reports an error for it, and has none of these yet)
	var have: Array = RenderingServer.global_shader_parameter_get_list() if OS.has_feature("editor") else []
	for key: String in GLOBALS:
		if have.has(StringName(key)):
			continue
		var value: Variant = 0.0
		match key:
			"ground_clear_centre":
				value = Vector2.ZERO
			"ground_clear_size":
				value = Ground.CLEAR_SIZE
			"ground_clear":
				value = clear
			"ground_rings":
				value = rings
		RenderingServer.global_shader_parameter_add(StringName(key), GLOBALS[key], value)


static func _shader(cull: String, scissor: bool) -> Shader:
	var key := cull + ("s" if scissor else "")
	if not _shaders.has(key):
		var s := Shader.new()
		var alpha := "ALPHA = base.a; ALPHA_SCISSOR_THRESHOLD = alpha_scissor;" if scissor else ""
		s.code = AtmosphereShaders.GROUND.replace("@CULL@", cull).replace("@ALPHA@", alpha)
		_shaders[key] = s
	return _shaders[key]


## The ground material of a material of the track, or null for one that stays as it is (see-through, unshaded, not a
## StandardMaterial3D).
static func from_standard(m: Material) -> ShaderMaterial:
	var sm := m as StandardMaterial3D
	if sm == null:
		return null
	if sm.transparency != BaseMaterial3D.TRANSPARENCY_DISABLED and sm.transparency != BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR:
		return null
	if sm.shading_mode != BaseMaterial3D.SHADING_MODE_PER_PIXEL:
		return null
	var cull := "cull_back"
	if sm.cull_mode == BaseMaterial3D.CULL_DISABLED:
		cull = "cull_disabled"
	elif sm.cull_mode == BaseMaterial3D.CULL_FRONT:
		cull = "cull_front"
	var out := ShaderMaterial.new()
	out.shader = _shader(cull, sm.transparency == BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR)
	out.resource_name = sm.resource_name
	out.set_shader_parameter("albedo", sm.albedo_color)
	if sm.albedo_texture != null:
		out.set_shader_parameter("albedo_texture", sm.albedo_texture)
		out.set_shader_parameter("use_texture", true)
	out.set_shader_parameter("use_vertex_color", sm.vertex_color_use_as_albedo)
	out.set_shader_parameter("roughness", sm.roughness)
	out.set_shader_parameter("metallic", sm.metallic)
	out.set_shader_parameter("specular", sm.metallic_specular)
	if sm.normal_enabled and sm.normal_texture != null:
		out.set_shader_parameter("normal_texture", sm.normal_texture)
		out.set_shader_parameter("use_normal", true)
		out.set_shader_parameter("normal_scale", sm.normal_scale)
	out.set_shader_parameter("uv1_scale", sm.uv1_scale)
	out.set_shader_parameter("uv1_offset", sm.uv1_offset)
	if sm.emission_enabled:
		out.set_shader_parameter("emission", sm.emission)
		out.set_shader_parameter("emission_energy", sm.emission_energy_multiplier)
	out.set_shader_parameter("alpha_scissor", sm.alpha_scissor_threshold)
	return out


## Every mesh of a model (the track) gets the ground materials; a material shared by meshes is made once.
static func patch(model: Node) -> int:
	var done := {}
	var count := 0
	for node in model.find_children("*", "MeshInstance3D", true, false):
		var mi := node as MeshInstance3D
		if mi.mesh == null:
			continue
		for s in mi.mesh.get_surface_count():
			var m := mi.get_active_material(s)
			if m == null:
				continue
			if not done.has(m):
				done[m] = from_standard(m)
				if done[m] != null:
					count += 1
			if done[m] != null:
				mi.set_surface_override_material(s, done[m])
	return count
