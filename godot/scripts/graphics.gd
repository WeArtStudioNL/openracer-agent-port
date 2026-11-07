class_name Graphics
extends RefCounted
## The graphics settings (web/js/Graphics.js, the Graphics page of the Escape menu) in Godot: the resolution (the 3D
## scale of the viewport), the anti-aliasing (MSAA, and FXAA, SMAA or TAA over it), the texture sharpness at a slant
## (anisotropic filtering), sharpening and the vignette (a pass over the picture), the draw distance, the shadows (the
## size of the shadow atlas and its distance), the reflections (screen space reflections), ambient occlusion (SSAO)
## and global illumination (SSIL: the light that the surfaces on the screen give off, as the SSGI of the browser), the
## tone mapping, the exposure, the contrast and the saturation. Applied live to the drive (Atmosphere) when a setting
## changes; a preset sets all of them at once.

const PRESETS := {
	"low": {"gfx_resolution": 720, "gfx_aa": 0, "gfx_shadows": 1, "gfx_reflections": 1, "gfx_ao": 0, "gfx_gi": 0, "gfx_vignette": false,
		"gfx_smoke": 50, "gfx_distance": 500, "gfx_aniso": 2, "gfx_sharpen": 0},
	"medium": {"gfx_resolution": "native", "gfx_aa": 2, "gfx_shadows": 2, "gfx_reflections": 1, "gfx_ao": 0, "gfx_gi": 0, "gfx_vignette": true,
		"gfx_smoke": 75, "gfx_distance": 1000, "gfx_aniso": 4, "gfx_sharpen": 0},
	"high": {"gfx_resolution": "native", "gfx_aa": 4, "gfx_shadows": 2, "gfx_reflections": 2, "gfx_ao": 0, "gfx_gi": 0, "gfx_vignette": true,
		"gfx_smoke": 100, "gfx_distance": 2000, "gfx_aniso": 8, "gfx_sharpen": 1},
	"ultra": {"gfx_resolution": "native", "gfx_aa": 4, "gfx_shadows": 3, "gfx_reflections": 2, "gfx_ao": 2, "gfx_gi": 1, "gfx_vignette": true,
		"gfx_smoke": 100, "gfx_distance": 5000, "gfx_aniso": 16, "gfx_sharpen": 2},
}
const SHARPEN := [0.0, 0.18, 0.35, 0.55]
const SHADOW_SIZES := [0, 512, 1024, 2048, 4096]
const SHADOW_DISTANCE := [0.0, 80.0, 150.0, 220.0, 300.0]
const RESOLUTIONS := ["native", 720, 1080, 1440, 2160]
const MSAA := {0: Viewport.MSAA_DISABLED, 2: Viewport.MSAA_2X, 4: Viewport.MSAA_4X, 8: Viewport.MSAA_8X}
const ANISO := {1: Viewport.ANISOTROPY_DISABLED, 2: Viewport.ANISOTROPY_2X, 4: Viewport.ANISOTROPY_4X, 8: Viewport.ANISOTROPY_8X,
	16: Viewport.ANISOTROPY_16X}
## The tone mapping of the browser and the one of Godot that is nearest (Godot has no PBR Neutral: Filmic keeps the
## colours and rolls the highlights off).
const TONE := {"neutral": Environment.TONE_MAPPER_FILMIC, "agx": Environment.TONE_MAPPER_AGX, "aces": Environment.TONE_MAPPER_ACES,
	"none": Environment.TONE_MAPPER_LINEAR}
## The keys of a preset (a change of another one does not make the preset Custom).
const PRESET_KEYS := ["gfx_resolution", "gfx_aa", "gfx_shadows", "gfx_reflections", "gfx_ao", "gfx_gi", "gfx_vignette", "gfx_smoke",
	"gfx_distance", "gfx_aniso", "gfx_sharpen"]

## The pass over the picture: the vignette of three.js (VignetteShader, darkness 1.2) and the sharpening of Graphics.js
## (the picture minus the blur of its four neighbours, a little of it added back).
const POST := """
shader_type canvas_item;
uniform sampler2D screen : hint_screen_texture, filter_nearest;
uniform float strength = 0.0;
uniform float vignette = 0.0;
void fragment() {
	vec2 px = SCREEN_PIXEL_SIZE;
	vec3 c = texture(screen, SCREEN_UV).rgb;
	if (strength > 0.0) {
		vec3 blur = 0.25 * (texture(screen, SCREEN_UV + vec2(px.x, 0.0)).rgb + texture(screen, SCREEN_UV - vec2(px.x, 0.0)).rgb
			+ texture(screen, SCREEN_UV + vec2(0.0, px.y)).rgb + texture(screen, SCREEN_UV - vec2(0.0, px.y)).rgb);
		c = clamp(c + (c - blur) * strength * 2.0, vec3(0.0), vec3(1.0));
	}
	vec2 uv = SCREEN_UV - 0.5;
	c = mix(c, vec3(1.0 - 1.2), dot(uv, uv) * vignette);
	COLOR = vec4(c, 1.0);
}
"""


static func value(key: String) -> Variant:
	return Settings.get_value(key)


## The preset that all the options are now, or "custom".
static func current_preset() -> String:
	for name: String in PRESETS:
		var p: Dictionary = PRESETS[name]
		var same := true
		for k: String in p:
			if str(value(k)) != str(p[k]):
				same = false
		if same:
			return name
	return "custom"


static func apply_preset(name: String) -> void:
	if not PRESETS.has(name):
		return
	var p: Dictionary = PRESETS[name]
	for k: String in p:
		Settings.set_value(k, p[k])
	Settings.set_value("gfx_preset", name)


## An option of a preset was changed by hand: the preset follows (Custom, or the one that it is now).
static func preset_follows(key: String) -> void:
	if PRESET_KEYS.has(key) and current_preset() != str(value("gfx_preset")):
		Settings.set_value("gfx_preset", current_preset())


## The post pass (a CanvasLayer under the dashboard).
static func make_post() -> CanvasLayer:
	var layer := CanvasLayer.new()
	layer.name = "GraphicsPost"
	layer.layer = 0
	var rect := ColorRect.new()
	rect.name = "Rect"
	rect.set_anchors_preset(Control.PRESET_FULL_RECT)
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var shader := Shader.new()
	shader.code = POST
	var mat := ShaderMaterial.new()
	mat.shader = shader
	rect.material = mat
	layer.add_child(rect)
	return layer


## The 3D scale for a resolution: "native" draws at the size of the window; a height in pixels draws the picture that
## many pixels high, whatever the size of the window (up to twice the window).
static func scale_3d(vp: Viewport) -> float:
	var res: Variant = value("gfx_resolution")
	if not (res is int or res is float):
		return 1.0
	var h := float(DisplayServer.window_get_size().y) if DisplayServer.get_name() != "headless" else vp.get_visible_rect().size.y
	return clampf(float(res) / maxf(1.0, h), 0.25, 2.0)


## Everything, on the viewport, the environment, the sun and the camera of a drive.
static func apply_all(vp: Viewport, env: Environment, sun: DirectionalLight3D, post: CanvasLayer) -> void:
	vp.scaling_3d_mode = Viewport.SCALING_3D_MODE_BILINEAR
	vp.scaling_3d_scale = scale_3d(vp)
	vp.msaa_3d = MSAA.get(int(value("gfx_aa")), Viewport.MSAA_4X)
	var smooth := str(value("gfx_smooth"))
	vp.screen_space_aa = Viewport.SCREEN_SPACE_AA_FXAA if smooth == "fxaa" else (Viewport.SCREEN_SPACE_AA_SMAA if smooth == "smaa" else Viewport.SCREEN_SPACE_AA_DISABLED)
	vp.use_taa = smooth == "taa"
	vp.anisotropic_filtering_level = ANISO.get(int(value("gfx_aniso")), Viewport.ANISOTROPY_8X)
	var cam := vp.get_camera_3d()
	if cam != null:
		cam.far = float(value("gfx_distance"))
	var level := clampi(int(value("gfx_shadows")), 0, 4)
	if sun != null:
		sun.shadow_enabled = level > 0
		sun.directional_shadow_max_distance = SHADOW_DISTANCE[level] if level > 0 else 220.0
	if level > 0:
		# (the atlas holds the four splits: twice the size of the browser's one map, so that a split is about that size)
		RenderingServer.directional_shadow_atlas_set_size(SHADOW_SIZES[level] * 2, true)
	if env != null:
		var refl := int(value("gfx_reflections"))
		env.ssr_enabled = refl > 0
		env.ssr_max_steps = 32 if refl == 1 else 64
		var ao := int(value("gfx_ao"))
		env.ssao_enabled = ao > 0
		env.ssao_radius = 1.2
		env.ssao_intensity = 2.0
		RenderingServer.environment_set_ssao_quality(RenderingServer.ENV_SSAO_QUALITY_HIGH if ao > 1 else RenderingServer.ENV_SSAO_QUALITY_LOW,
			ao < 2, 0.5, 2, 50.0, 300.0)
		var gi := int(value("gfx_gi"))
		env.ssil_enabled = gi > 0
		env.ssil_radius = 3.5
		env.ssil_intensity = 1.5 if gi > 1 else 1.0
		RenderingServer.environment_set_ssil_quality(RenderingServer.ENV_SSIL_QUALITY_HIGH if gi > 1 else RenderingServer.ENV_SSIL_QUALITY_LOW,
			true, 0.5, 4, 50.0, 300.0)
		env.tonemap_mode = TONE.get(str(value("gfx_tone")), Environment.TONE_MAPPER_FILMIC)
		env.tonemap_exposure = float(value("gfx_exposure"))
		env.adjustment_enabled = true
		env.adjustment_contrast = float(value("gfx_contrast"))
		env.adjustment_saturation = float(value("gfx_saturation"))
	if post != null:
		var rect := post.get_node("Rect") as ColorRect
		var sharpen: float = SHARPEN[clampi(int(value("gfx_sharpen")), 0, 3)]
		var vignette := bool(value("gfx_vignette"))
		(rect.material as ShaderMaterial).set_shader_parameter("strength", sharpen)
		(rect.material as ShaderMaterial).set_shader_parameter("vignette", 1.0 if vignette else 0.0)
		post.visible = sharpen > 0.0 or vignette
