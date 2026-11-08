class_name CarMirrors
extends RefCounted
## The mirrors of a car (web/js/Mirrors.js). The glass of a mirror is a mesh of the model with a material called
## "mirror" (or "spiegel") that is a metal. Each glass is put in a pivot at its own middle, so that it can be aimed: the
## settings mirror_<side>_yaw and mirror_<side>_tilt (degrees, at most 25; the turn positive outwards for the left and the
## right glass, to the left for the one inside; the tilt positive up), the side found from where the glass is (left,
## right, or near the middle: the one inside, "centre").
##
## A real mirror (setting mirror_<side>_real) shows what is behind it: a second picture of the scene from the mirror
## image of the eye (a SubViewport and a Camera3D whose frustum is the glass seen from there, with its near plane on
## the glass), laid on the glass by a projection. As in the browser it is made every second frame, 512 pixels wide,
## and only when it can be seen: here only for the car the camera rides in (the cockpit and the bonnet camera), with the
## eye in front of the glass. The glass is left out of the pictures of the mirrors (a layer of its own).

const LIMIT := 25.0
const LAYER := 1 << 19                     # (the visual layer of the glass: the mirror cameras do not see it)
const WIDTH := 512
const SHADER := """
shader_type spatial;
render_mode unshaded, cull_disabled, shadows_disabled;
uniform sampler2D mirror_tex : filter_linear, repeat_disable;
uniform mat4 tex_matrix;
uniform vec3 tint = vec3(0.9, 0.93, 0.96);
uniform float show = 1.0;
varying vec4 proj;
void vertex() {
	proj = tex_matrix * (MODEL_MATRIX * vec4(VERTEX, 1.0));
}
void fragment() {
	if (show < 0.5) {
		discard;
	}
	ALBEDO = texture(mirror_tex, proj.xy / proj.w).rgb * tint;
}
"""

static var _shader: Shader = null

var car: Car
var list: Array[Dictionary] = []           # { mesh, pivot, side, surfaces, normal (in the mesh), box (in the mesh), real }
var holder: Node = null                    # where the viewports of the real mirrors go
var _env: Environment = null
var _env_from: Environment = null
var _env_age := 0.0


static func is_glass(m: Material) -> bool:
	var b := m as BaseMaterial3D
	return b != null and RegEx.create_from_string("(?i)mirror|spiegel").search(b.resource_name) != null and b.metallic > 0.5


## The glass of the model under root (the body of the car), or null when it has none.
static func find(c: Car, root: Node3D) -> CarMirrors:
	if root == null:
		return null
	var glass: Array[MeshInstance3D] = []
	for n in root.find_children("*", "MeshInstance3D", true, false):
		var mi := n as MeshInstance3D
		if mi.mesh == null:
			continue
		for i in mi.mesh.get_surface_count():
			if is_glass(mi.get_active_material(i)):
				glass.append(mi)
				break
	if glass.is_empty():
		return null
	var cm := CarMirrors.new()
	cm.car = c
	var widest := 0.0
	for mi in glass:
		var e := cm._pivot(mi)
		widest = maxf(widest, absf(e["x"]))
		cm.list.append(e)
	for e in cm.list:
		e["side"] = "centre" if absf(e["x"]) < widest * 0.35 else ("left" if e["x"] > 0.0 else "right")
	cm.aim()
	return cm


## The glass surfaces of a mesh as a mesh of their own (a glTF primitive with its own material is a mesh of its own in
## three.js, a surface in Godot: the glass alone turns, and its middle and its normal are those of the glass).
static func _split(mi: MeshInstance3D) -> MeshInstance3D:
	var glass := ArrayMesh.new()
	var rest := ArrayMesh.new()
	for i in mi.mesh.get_surface_count():
		var m := mi.get_active_material(i)
		var target := glass if is_glass(m) else rest
		target.add_surface_from_arrays(mi.mesh.surface_get_primitive_type(i), mi.mesh.surface_get_arrays(i))
		target.surface_set_material(target.get_surface_count() - 1, mi.mesh.surface_get_material(i))
		if mi.get_surface_override_material(i) != null:
			target.surface_set_material(target.get_surface_count() - 1, mi.get_surface_override_material(i))
	if rest.get_surface_count() == 0:
		return mi
	var own := MeshInstance3D.new()
	own.name = str(mi.name) + "_glass"
	own.mesh = glass
	own.transform = mi.transform
	own.layers = mi.layers
	mi.mesh = rest
	for i in rest.get_surface_count():
		mi.set_surface_override_material(i, null)
	mi.get_parent().add_child(own)
	mi.get_parent().move_child(own, mi.get_index() + 1)
	return own


## The mesh goes into a pivot at its middle, in the space of its parent (it keeps its place).
func _pivot(mi: MeshInstance3D) -> Dictionary:
	var box := mi.mesh.get_aabb()
	var centre := box.get_center()
	var parent := mi.get_parent()
	var pivot := Node3D.new()
	pivot.name = "mirror pivot"
	pivot.rotation_order = EULER_ORDER_YXZ
	pivot.position = mi.transform * centre
	var at := mi.get_index()
	mi.owner = null
	parent.remove_child(mi)
	parent.add_child(pivot)
	parent.move_child(pivot, at)
	mi.transform = Transform3D(Basis.IDENTITY, -pivot.position) * mi.transform
	pivot.add_child(mi)
	mi.set_meta("mirror_glass", true)     # (the soft body leaves it as it is: SoftBodyMesh)
	var surfaces := []
	for i in mi.mesh.get_surface_count():
		if is_glass(mi.get_active_material(i)):
			surfaces.append(i)
	return {"mesh": mi, "pivot": pivot, "x": (CarModel.relative(mi, car) * centre).x, "side": "", "surfaces": surfaces,
		"normal": _normal_of(mi.mesh), "box": box, "real": {}}


## The normal of a glass: the faces weighed by their area, each turned to the side of the largest face (a glass that is a
## thin slab has its back faces too: they would cancel the front).
static func _normal_of(mesh: Mesh) -> Vector3:
	var faces: Array[Vector3] = []
	var ref := Vector3.ZERO
	for si in mesh.get_surface_count():
		var arrays := mesh.surface_get_arrays(si)
		var v: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
		var idx: PackedInt32Array = arrays[Mesh.ARRAY_INDEX] if arrays[Mesh.ARRAY_INDEX] != null else PackedInt32Array()
		var count := idx.size() if not idx.is_empty() else v.size()
		var t := 0
		while t + 2 < count:
			var a := v[idx[t] if not idx.is_empty() else t]
			var b := v[idx[t + 1] if not idx.is_empty() else t + 1]
			var c := v[idx[t + 2] if not idx.is_empty() else t + 2]
			var f := (b - a).cross(c - a)
			faces.append(f)
			if f.length_squared() > ref.length_squared():
				ref = f
			t += 3
	var n := Vector3.ZERO
	for f in faces:
		n += f if f.dot(ref) >= 0.0 else -f
	return n.normalized() if n.length_squared() > 1e-12 else Vector3.BACK


## Turns every glass as the settings say.
func aim() -> void:
	for e in list:
		var side: String = e["side"]
		var yaw := clampf(float(Settings.get_value("mirror_%s_yaw" % side)), -LIMIT, LIMIT)
		var tilt := clampf(float(Settings.get_value("mirror_%s_tilt" % side)), -LIMIT, LIMIT)
		var s := -1.0 if side == "right" else 1.0
		(e["pivot"] as Node3D).rotation = Vector3(deg_to_rad(tilt), deg_to_rad(-yaw * s), 0.0)


## Every frame: the real mirrors when cam rides in this car (active), else the glass as the model has it.
func update(cam: Camera3D, active: bool, dt: float) -> void:
	for e in list:
		var mi: MeshInstance3D = e["mesh"]
		var on := active and cam != null and is_instance_valid(mi) and bool(Settings.get_value("mirror_%s_real" % e["side"])) \
			and mi.is_visible_in_tree() and car.is_ancestor_of(mi)
		if not on:
			_off(e)
			continue
		if (e["real"] as Dictionary).is_empty():
			_make_real(e)
		_reflect(e, cam, dt)


func _make_real(e: Dictionary) -> void:
	if _shader == null:
		_shader = Shader.new()
		_shader.code = SHADER
	var vp := SubViewport.new()
	vp.name = "Mirror " + str(e["side"])
	vp.size = Vector2i(WIDTH, 384)
	vp.use_hdr_2d = true                  # (linear, the main picture tone maps it once)
	vp.render_target_update_mode = SubViewport.UPDATE_DISABLED
	vp.msaa_3d = Viewport.MSAA_DISABLED
	vp.positional_shadow_atlas_size = 0
	vp.mesh_lod_threshold = 4.0
	var cam := Camera3D.new()
	cam.cull_mask = 0xFFFFF & ~LAYER
	cam.projection = Camera3D.PROJECTION_FRUSTUM
	cam.keep_aspect = Camera3D.KEEP_HEIGHT
	vp.add_child(cam)
	holder.add_child(vp)
	cam.current = true
	var mat := ShaderMaterial.new()
	mat.shader = _shader
	mat.set_shader_parameter("mirror_tex", vp.get_texture())
	var mi: MeshInstance3D = e["mesh"]
	var originals := {}
	for i in e["surfaces"]:
		originals[i] = mi.get_surface_override_material(i)
	e["real"] = {"vp": vp, "cam": cam, "mat": mat, "originals": originals, "layers": mi.layers, "skip": 0, "on": false}


## Back to the glass of the model; the viewport stops.
func _off(e: Dictionary) -> void:
	var r: Dictionary = e["real"]
	if r.is_empty() or not r["on"]:
		return
	r["on"] = false
	(r["vp"] as SubViewport).render_target_update_mode = SubViewport.UPDATE_DISABLED
	var mi: MeshInstance3D = e["mesh"]
	if is_instance_valid(mi):
		for i in r["originals"]:
			mi.set_surface_override_material(i, r["originals"][i])
		mi.layers = r["layers"]


func _on(e: Dictionary) -> void:
	var r: Dictionary = e["real"]
	if r["on"]:
		return
	r["on"] = true
	var mi: MeshInstance3D = e["mesh"]
	for i in e["surfaces"]:
		r["originals"][i] = mi.get_surface_override_material(i)
		mi.set_surface_override_material(i, r["mat"])
	r["layers"] = mi.layers
	mi.layers = LAYER


## The picture of one glass from the mirror image of the eye (Mirrors.js reflect).
func _reflect(e: Dictionary, eye_cam: Camera3D, dt: float) -> void:
	var r: Dictionary = e["real"]
	var mi: MeshInstance3D = e["mesh"]
	var mat: ShaderMaterial = r["mat"]
	var gx := mi.global_transform
	var box: AABB = e["box"]
	var centre := gx * box.get_center()
	var normal := (gx.basis.inverse().transposed() * (e["normal"] as Vector3)).normalized()
	var eye := eye_cam.global_position
	if (centre - eye).dot(normal) > 0.0:
		normal = -normal                   # (the glass is a mirror on the side it is seen from)
	var dist := (eye - centre).dot(normal)
	_on(e)
	mat.set_shader_parameter("show", 1.0 if dist >= 0.02 else 0.0)
	if dist < 0.02 or not _seen(eye_cam, gx, box):
		return
	r["skip"] = int(r["skip"]) - 1
	if int(r["skip"]) >= 0:
		return                             # (every second picture)
	r["skip"] = 1
	var z := -normal                       # (the camera looks along -z: through the glass, to the side of the eye)
	var up := eye_cam.global_basis.y
	up = up - 2.0 * up.dot(normal) * normal
	var x := up.cross(z)
	if x.length_squared() < 1e-8:
		x = Vector3.UP.cross(z) if absf(z.y) < 0.9 else Vector3.RIGHT
	x = x.normalized()
	var xf := Transform3D(Basis(x, z.cross(x), z), eye - normal * 2.0 * dist)
	var inv := xf.affine_inverse()
	var near := maxf(0.05, dist * 0.98)
	var l := 1e9
	var rr := -1e9
	var b := 1e9
	var t := -1e9
	for i in 8:
		var p := inv * (gx * box.get_endpoint(i))
		if p.z > -near * 0.2:
			return                         # (a corner level with or behind the camera: the glass is seen edge on)
		l = minf(l, p.x / -p.z * near)
		rr = maxf(rr, p.x / -p.z * near)
		b = minf(b, p.y / -p.z * near)
		t = maxf(t, p.y / -p.z * near)
	if rr - l < 1e-4 or t - b < 1e-4:
		return
	var vp: SubViewport = r["vp"]
	var h := clampi(roundi(WIDTH * (t - b) / (rr - l)), 64, 1024)
	if vp.size.y != h:
		vp.size = Vector2i(WIDTH, h)
	var cam: Camera3D = r["cam"]
	cam.transform = xf
	cam.set_frustum(t - b, Vector2((l + rr) / 2.0, (b + t) / 2.0), near, eye_cam.far)
	cam.environment = _environment(eye_cam, dt)
	vp.render_target_update_mode = SubViewport.UPDATE_ONCE
	# (world -> the picture: x and y from -1..1 to 0..1, y down)
	var bias := Projection(Vector4(0.5, 0.0, 0.0, 0.0), Vector4(0.0, -0.5, 0.0, 0.0), Vector4(0.0, 0.0, 1.0, 0.0), Vector4(0.5, 0.5, 0.0, 1.0))
	mat.set_shader_parameter("tex_matrix", bias * cam.get_camera_projection() * Projection(inv))


## Whether a corner or the middle of the box of the glass is in the view of the camera.
static func _seen(cam: Camera3D, gx: Transform3D, box: AABB) -> bool:
	if cam.is_position_in_frustum(gx * box.get_center()):
		return true
	for i in 8:
		if cam.is_position_in_frustum(gx * box.get_endpoint(i)):
			return true
	return false


## The environment of the picture: the one of the scene, without the tone mapping (the main picture does that) and
## without the effects of the screen; copied again every second (the weather and the time of day change it).
func _environment(eye_cam: Camera3D, dt: float) -> Environment:
	var src: Environment = eye_cam.environment
	if src == null and eye_cam.get_world_3d() != null:
		src = eye_cam.get_world_3d().environment
	if src == null:
		return null
	_env_age += dt
	if _env != null and src == _env_from and _env_age < 1.0:
		return _env
	_env_age = 0.0
	_env_from = src
	_env = src.duplicate() as Environment
	_env.tonemap_mode = Environment.TONE_MAPPER_LINEAR
	_env.tonemap_exposure = 1.0
	_env.glow_enabled = false
	_env.ssr_enabled = false
	_env.ssao_enabled = false
	_env.ssil_enabled = false
	_env.sdfgi_enabled = false
	_env.adjustment_enabled = false
	return _env


## The number of real mirrors that are on (a test).
func real_count() -> int:
	var n := 0
	for e in list:
		if not (e["real"] as Dictionary).is_empty() and e["real"]["on"]:
			n += 1
	return n
