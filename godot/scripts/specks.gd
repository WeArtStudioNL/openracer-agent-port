class_name Specks
extends MultiMeshInstance3D
## Small things that fly and fall: the particles of a part that breaks (Shatter.js) and the grass, sand, gravel, mud,
## earth and snow that a wheel throws up (Debris.js). Points in one draw call (a MultiMesh of quads turned to the
## camera), each with the shape of what it is: 0 an angular chunk or shard, 1 a thin blade or splinter (turned along
## the way it flies on the screen), 2 a round grain or clump, 3 a thicker blade. They fly with gravity and a little
## drag, come down where they began (or on the road under them), lie a while and fade. A ring: the oldest go first.
##
## Only the ones in the air are moved here; the fading is done by the graphics card from the time they end.

const SHADER := """
shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_never, blend_mix, skip_vertex_transform, shadows_disabled;
uniform float now;
uniform float light = 1.0;
uniform float size_scale = 1.0;
varying vec4 v_custom;
varying float v_angle;
void vertex() {
	vec3 centre = (MODELVIEW_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
	float size = MODEL_MATRIX[0].x * size_scale;
	vec3 vel = (VIEW_MATRIX * vec4(MODEL_MATRIX[1].xyz, 0.0)).xyz;
	v_custom = INSTANCE_CUSTOM;
	v_angle = (length(vel.xy) > 1e-4 ? atan(vel.y, vel.x) : 0.0) + INSTANCE_CUSTOM.y;
	float shape = INSTANCE_CUSTOM.x;
	// (a blade is drawn at least a few pixels: a thin line of a few millimetres is nothing at a distance)
	float least = ((shape > 0.5 && shape < 1.5) || shape > 2.5) ? 0.004 : 0.0015;
	float s = max(size, least * max(1.0, -centre.z));
	VERTEX = centre + vec3(VERTEX.xy * s, 0.0);
	NORMAL = vec3(0.0, 0.0, 1.0);
}
void fragment() {
	vec2 c = UV - 0.5;
	float a;
	float edge = 0.0;
	float cs = cos(v_angle);
	float sn = sin(v_angle);
	vec2 r = vec2(c.x * cs + c.y * sn, -c.x * sn + c.y * cs);
	if (v_custom.x < 0.5) { float d = abs(r.x) + abs(r.y) * 1.4; a = smoothstep(0.5, 0.42, d); edge = smoothstep(0.3, 0.45, d); }
	else if (v_custom.x < 1.5) { float w = 0.035 + 0.07 * (1.0 - abs(r.x) * 2.0); a = smoothstep(w, w * 0.35, abs(r.y)) * smoothstep(0.5, 0.4, abs(r.x)); }
	else if (v_custom.x > 2.5) { float w = 0.06 + 0.1 * (1.0 - abs(r.x) * 2.0); a = smoothstep(w, w * 0.5, abs(r.y)) * smoothstep(0.5, 0.35, abs(r.x)); }
	else a = smoothstep(0.5, 0.2, length(c));
	float fade = clamp((v_custom.z - now) / max(0.05, v_custom.w), 0.0, 1.0) * COLOR.a;
	if (a * fade < 0.02) discard;
	ALBEDO = COLOR.rgb * light * (1.0 + 0.6 * edge * step(v_custom.x, 0.5));
	ALPHA = a * fade;
}
"""

var cap := 4000
var drag := 0.7                     # per second, of the speed (the air)
var bounce_walls := false           # a wall in the way: it bounces off (the particles of a part that breaks)
var lie_from := 5.0                 # s that a piece lies on the ground: from, and up to as much more
var lie_more := 9.0
var now := 0.0

var _pos := PackedVector3Array()
var _vel := PackedVector3Array()
var _floor := PackedFloat32Array()
var _size := PackedFloat32Array()
var _end := PackedFloat32Array()      # the time it is gone
var _quick := PackedByteArray()
var _air := PackedInt32Array()        # the ones in the air
var _next := 0
var _used := 0
var _mat: ShaderMaterial


func _init(capacity := 4000) -> void:
	cap = capacity
	name = "Specks"
	cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.use_custom_data = true
	var quad := QuadMesh.new()
	quad.size = Vector2(1, 1)
	mm.mesh = quad
	mm.instance_count = cap
	mm.visible_instance_count = 0
	multimesh = mm
	_mat = ShaderMaterial.new()
	var sh := Shader.new()
	sh.code = SHADER
	_mat.shader = sh
	material_override = _mat
	custom_aabb = AABB(Vector3(-1e5, -1e5, -1e5), Vector3(2e5, 2e5, 2e5))
	_pos.resize(cap)
	_vel.resize(cap)
	_floor.resize(cap)
	_size.resize(cap)
	_end.resize(cap)
	_quick.resize(cap)


## The light on them (1 normal) and their size (1 normal, 0 hides them).
func set_look(light: float, size_scale: float) -> void:
	_mat.set_shader_parameter("light", light)
	_mat.set_shader_parameter("size_scale", size_scale)
	visible = size_scale > 0.0


## One from p with a speed: colour (linear, its alpha the most it gets), size (m), shape (0..3), tilt (rad), life in
## the air at most (s), the height it comes down to; quick: gone soon after it came down (water).
func add(p: Vector3, v: Vector3, colour: Color, size: float, shape: int, tilt: float, life: float, floor_y: float, quick := false) -> void:
	var i := _next
	_next = (_next + 1) % cap
	_used = maxi(_used, i + 1)
	_pos[i] = p
	_vel[i] = v
	_floor[i] = floor_y
	_size[i] = size
	_end[i] = now + life
	_quick[i] = 1 if quick else 0
	if not _air.has(i):
		_air.append(i)
	multimesh.visible_instance_count = _used
	multimesh.set_instance_color(i, colour)
	multimesh.set_instance_custom_data(i, Color(shape, tilt, now + life, 0.25))
	_put(i)


func _put(i: int) -> void:
	var b := Basis(Vector3(maxf(0.0005, _size[i]), 0, 0), _vel[i], Vector3(0, 0, 1))
	multimesh.set_instance_transform(i, Transform3D(b, _pos[i]))


## Moves the ones in the air; one that comes down lies where it is a while (lie_from to lie_from + lie_more s), then
## fades. space: for the walls (bounce_walls).
func step(delta: float, space: PhysicsDirectSpaceState3D = null) -> void:
	delta = minf(delta, 0.05)
	now += delta
	_mat.set_shader_parameter("now", now)
	if _air.is_empty():
		return
	var dk := exp(-drag * delta)
	var keep := PackedInt32Array()
	for i in _air:
		if now >= _end[i]:
			continue
		var v := _vel[i]
		v = Vector3(v.x * dk, v.y * dk - 9.81 * delta, v.z * dk)
		var p := _pos[i]
		var to := p + v * delta
		if bounce_walls and space != null and v.length_squared() * delta * delta > 1e-6:
			var hit := space.intersect_ray(PhysicsRayQueryParameters3D.create(p, to + v.normalized() * 0.005, 1))
			if not hit.is_empty() and absf(hit["normal"].y) <= 0.7:
				var n: Vector3 = hit["normal"]
				to = hit["position"] + n * 0.005
				v = (v - n * (1.25 * v.dot(n))) * Vector3(0.6, 0.8, 0.6)
		_vel[i] = v
		_pos[i] = to
		if to.y < _floor[i]:
			_pos[i] = Vector3(to.x, _floor[i] + 0.004, to.z)
			_vel[i] = Vector3.ZERO
			var lie := 0.15 if _quick[i] == 1 else lie_from + randf() * lie_more
			_end[i] = now + lie
			var cd := multimesh.get_instance_custom_data(i)
			multimesh.set_instance_custom_data(i, Color(cd.r, cd.g, now + lie, 0.25 if _quick[i] == 1 else 1.5))
			_put(i)
			continue
		_put(i)
		keep.append(i)
	_air = keep


## All gone.
func clear() -> void:
	_air.clear()
	_end.fill(0.0)
	_next = 0
	_used = 0
	multimesh.visible_instance_count = 0


func count_air() -> int:
	return _air.size()
