class_name TyreDeform
extends RefCounted
## The deformation of the shell tyre on the model of the wheel (web/js/TyreDeform.js): the vertices of the tyre are
## pushed in by how far the outer nodes of the shell are pushed in (flat where the road holds the tread, out where the
## air pushes it). The table of the shell (per ring across the tread and per place round the wheel, in the frame of the
## wheel that does not spin) goes to the vertex shader of every material of the wheel: the shader turns every vertex
## with the spin of the wheel to find its place in that frame, takes the push-in of the two rings beside it and of the
## two places beside it, and moves the vertex towards the axle by it, more the nearer it is to the tread (nothing below
## the radius of the inner shell: the rim stays). A StandardMaterial3D becomes a ShaderMaterial with Godot's own code
## for it and these lines in front of its vertex(); a ShaderMaterial gets the lines too. (The shadow is the same pass in
## Godot: it is pushed in as well, where the browser game left its depth shader.)

const BINS := 72
const MAX_RINGS := 5
const HEAD := """
uniform float def_table[360];
uniform float def_on = 0.0;
uniform float def_spin = 0.0;
uniform float def_rin = 0.2;
uniform float def_rout = 0.3;
uniform float def_k = 1.0;
uniform float def_rings = 3.0;
uniform mat4 def_to_spin = mat4(1.0);
uniform mat4 def_from_spin = mat4(1.0);
float def_at(int ring, float t) {
	int i0 = int(floor(t));
	float f = t - float(i0);
	i0 = i0 % 72;
	if (i0 < 0) { i0 += 72; }
	int i1 = i0 + 1;
	if (i1 >= 72) { i1 -= 72; }
	return mix(def_table[ring * 72 + i0], def_table[ring * 72 + i1], f);
}
void def_vertex(inout vec3 vtx) {
	if (def_on > 0.5) {
		vec3 p = (def_to_spin * vec4(vtx, 1.0)).xyz;
		float cs = cos(def_spin), sn = sin(def_spin);
		float yy = p.y * cs - p.z * sn, zz = p.y * sn + p.z * cs;
		float rr = sqrt(yy * yy + zz * zz);
		float wgt = smoothstep(def_rin, def_rout, rr);
		if (wgt > 0.0) {
			float ang = atan(zz, yy);
			if (ang < 0.0) { ang += 6.2831853; }
			float lat = clamp(p.x * def_k, -1.0, 1.0);
			float rp = clamp((lat * 0.5 + 0.5) * (def_rings - 1.0), 0.0, def_rings - 1.0);
			int r0 = int(floor(rp));
			int r1 = int(min(float(r0) + 1.0, def_rings - 1.0));
			float rf = rp - float(r0);
			float t = ang * (72.0 / 6.2831853);
			float d = mix(def_at(r0, t), def_at(r1, t), rf);
			float k = 1.0 - d * wgt / max(rr, 1e-4);
			float ny = yy * k, nz = zz * k;
			p.y = ny * cs + nz * sn;
			p.z = -ny * sn + nz * cs;
			vtx = (def_from_spin * vec4(p, 1.0)).xyz;
		}
	}
}
"""

## (a StandardMaterial3D as a shader: the look of a tyre and a rim)
const LITE := """shader_type spatial;
render_mode %s;
uniform vec4 albedo : source_color = vec4(1.0);
uniform sampler2D albedo_texture : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform bool has_albedo_texture = false;
uniform float roughness : hint_range(0.0, 1.0) = 1.0;
uniform sampler2D roughness_texture : hint_roughness_r, filter_linear_mipmap_anisotropic, repeat_enable;
uniform bool has_roughness_texture = false;
uniform float metallic : hint_range(0.0, 1.0) = 0.0;
uniform sampler2D metallic_texture : hint_default_white, filter_linear_mipmap_anisotropic, repeat_enable;
uniform bool has_metallic_texture = false;
uniform sampler2D normal_texture : hint_roughness_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform bool has_normal_texture = false;
uniform float normal_scale = 1.0;
uniform vec3 uv1_scale = vec3(1.0);
uniform vec3 uv1_offset = vec3(0.0);
void vertex() {
	UV = UV * uv1_scale.xy + uv1_offset.xy;
}
void fragment() {
	vec4 c = albedo;
	if (has_albedo_texture) { c *= texture(albedo_texture, UV); }
	ALBEDO = c.rgb;
	ROUGHNESS = roughness * (has_roughness_texture ? texture(roughness_texture, UV).r : 1.0);
	METALLIC = metallic * (has_metallic_texture ? texture(metallic_texture, UV).b : 1.0);
	if (has_normal_texture) {
		NORMAL_MAP = texture(normal_texture, UV).rgb;
		NORMAL_MAP_DEPTH = normal_scale;
	}
}
"""

static var _shaders := {}            # the code of a material -> its Shader with the deformation

var gain := 1.0                      # (to see it, for a test: 5 draws the push-in five times as deep)
var _mats: Array[ShaderMaterial] = []
var _table := PackedFloat32Array()


## The materials of the wheel (under its spin node) made deformable; null when it has no meshes. A mesh that lies inside
## the inner shell (ratio of the radius: the rim) does not move, and keeps its own materials.
static func make(w: Car.Wheel, ratio: float) -> TyreDeform:
	if w.spin_node == null:
		return null
	var d := TyreDeform.new()
	d._table.resize(BINS * MAX_RINGS)
	for n in w.spin_node.find_children("*", "MeshInstance3D", true, false):
		var mi := n as MeshInstance3D
		if mi.mesh == null:
			continue
		var to_spin := CarModel.relative(mi, w.spin_node)
		var box := to_spin * mi.get_aabb()
		var reach := 0.0
		for k in 8:
			var c := box.get_endpoint(k)
			reach = maxf(reach, Vector2(c.y, c.z).length())
		if reach < w.radius * ratio * 1.05:
			continue
		for s in mi.mesh.get_surface_count():
			var src := mi.get_active_material(s)
			var mat := _patched(src if src != null else StandardMaterial3D.new())
			if mat == null:
				continue
			mat.set_shader_parameter("def_to_spin", Projection(to_spin))
			mat.set_shader_parameter("def_from_spin", Projection(to_spin.affine_inverse()))
			mi.set_surface_override_material(s, mat)
			d._mats.append(mat)
	return d if not d._mats.is_empty() else null


static func _patched(src: Material) -> ShaderMaterial:
	var code := ""
	var params := {}
	if src is ShaderMaterial:
		var sm := src as ShaderMaterial
		if sm.shader == null:
			return null
		code = sm.shader.code
		for u in sm.shader.get_shader_uniform_list():
			params[u["name"]] = sm.get_shader_parameter(u["name"])
	elif src is StandardMaterial3D:
		# (Godot does not give the code it makes for a StandardMaterial3D to a script: a plain material of the same look,
		# the colour, the textures of the colour, the roughness, the metal and the normals)
		var m := src as StandardMaterial3D
		if m.transparency != BaseMaterial3D.TRANSPARENCY_DISABLED:
			return null
		code = LITE % ("cull_disabled" if m.cull_mode == BaseMaterial3D.CULL_DISABLED else "cull_back")
		params = {"albedo": m.albedo_color, "albedo_texture": m.albedo_texture, "has_albedo_texture": m.albedo_texture != null,
			"roughness": m.roughness, "roughness_texture": m.roughness_texture, "has_roughness_texture": m.roughness_texture != null,
			"metallic": m.metallic, "metallic_texture": m.metallic_texture, "has_metallic_texture": m.metallic_texture != null,
			"normal_texture": m.normal_texture, "has_normal_texture": m.normal_enabled and m.normal_texture != null, "normal_scale": m.normal_scale,
			"uv1_scale": m.uv1_scale, "uv1_offset": m.uv1_offset}
	if code == "" or not code.contains("shader_type spatial"):
		return null
	var shader: Shader = _shaders.get(code)
	if shader == null:
		shader = Shader.new()
		shader.code = _inject(code)
		_shaders[code] = shader
	var mat := ShaderMaterial.new()
	mat.shader = shader
	for k: String in params:
		if params[k] != null:
			mat.set_shader_parameter(k, params[k])
	mat.render_priority = src.render_priority
	return mat


## The lines in front of vertex(), and the call at its start (a shader without vertex() gets one).
static func _inject(code: String) -> String:
	var lines := code.split("\n")
	var at := 0
	for i in lines.size():
		var l := lines[i].strip_edges()
		if l.begins_with("shader_type") or l.begins_with("render_mode"):
			at = i + 1
	lines.insert(at, HEAD)
	var out := "\n".join(lines)
	var re := RegEx.create_from_string("void\\s+vertex\\s*\\(\\s*\\)\\s*\\{")
	var m := re.search(out)
	if m != null:
		return out.substr(0, m.get_end()) + "\n\tdef_vertex(VERTEX);" + out.substr(m.get_end())
	return out + "\nvoid vertex() {\n\tdef_vertex(VERTEX);\n}\n"


## Once a frame: the table from the shell tyre of the wheel (TyreShell.deformation).
func update(w: Car.Wheel, tyre: Object, ratio: float) -> void:
	var table: PackedFloat32Array = tyre.call("deformation")
	var rings := int(tyre.call("get_rings"))
	if table.is_empty() or rings < 1:
		off()
		return
	for i in BINS * MAX_RINGS:
		_table[i] = table[i] * gain if i < table.size() else 0.0
	var width := float(tyre.call("get_width"))
	for m in _mats:
		m.set_shader_parameter("def_table", _table)
		m.set_shader_parameter("def_rin", w.radius * ratio)
		m.set_shader_parameter("def_rout", w.radius * 0.97)
		m.set_shader_parameter("def_k", 1.0 / maxf(0.01, width / 2.0))
		m.set_shader_parameter("def_rings", float(rings))
		m.set_shader_parameter("def_spin", w.spin)
		m.set_shader_parameter("def_on", 1.0)


## Back to the plain shape (the simple tyre, or the tyre off the road).
func off() -> void:
	for m in _mats:
		m.set_shader_parameter("def_on", 0.0)
