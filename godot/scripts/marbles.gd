class_name Marbles
extends MultiMeshInstance3D
## The marbles (web/js/Marbles.js): small pellets of rubber that a tyre sheds when the surface of its tread is soft and
## hot (from about 150 to 180 C, before it smokes) and it slides. They are thrown off a little backwards and to the
## side, fall, bounce once or twice and lie on the road, off the line where the tyres run: dark octahedrons, smooth
## shaded, 4 to 10 mm (drawn 2.5 times bigger, so that they can be seen). One mesh holds all of them in a ring (the
## oldest go first when it is full), for every car of the scene. Like the skid marks they stay until the car is put
## back at the start.

const CAPACITY := 10000
const SEEN := 2.5                   # how much bigger they are drawn than they are

var _pos := PackedVector3Array()
var _vel := PackedVector3Array()
var _radius := PackedFloat32Array()
var _mass := PackedFloat32Array()
var _turn: Array[Basis] = []
var _air := PackedInt32Array()
var _carry := {}                    # car -> [4 floats]
var _next := 0
var _used := 0


func _init() -> void:
	name = "Marbles"
	add_to_group("clear_at_start")
	cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.mesh = _octahedron()
	mm.instance_count = CAPACITY
	mm.visible_instance_count = 0
	multimesh = mm
	var mat := StandardMaterial3D.new()
	mat.vertex_color_use_as_albedo = true
	mat.roughness = 0.55
	mat.metallic_specular = 0.3
	material_override = mat
	custom_aabb = AABB(Vector3(-1e5, -1e5, -1e5), Vector3(2e5, 2e5, 2e5))
	_pos.resize(CAPACITY)
	_vel.resize(CAPACITY)
	_radius.resize(CAPACITY)
	_mass.resize(CAPACITY)
	_turn.resize(CAPACITY)


## Six corners, eight faces, with a normal that points away from the middle (shaded smooth, like a lump of rubber).
static func _octahedron() -> ArrayMesh:
	var v := [Vector3(1, 0, 0), Vector3(-1, 0, 0), Vector3(0, 1, 0), Vector3(0, -1, 0), Vector3(0, 0, 1), Vector3(0, 0, -1)]
	var faces := [0, 2, 4, 2, 1, 4, 1, 3, 4, 3, 0, 4, 2, 0, 5, 1, 2, 5, 3, 1, 5, 0, 3, 5]
	var verts := PackedVector3Array()
	var normals := PackedVector3Array()
	for i in faces:
		verts.append(v[i] * 0.5)
		normals.append(v[i])
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = normals
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return mesh


func _put(i: int, x: Vector3, v: Vector3, radius: float, mass: float, shade: float) -> void:
	_pos[i] = x
	_vel[i] = v
	_radius[i] = radius
	_mass[i] = mass
	_turn[i] = Basis.from_euler(Vector3(randf() * TAU, randf() * TAU, randf() * TAU))
	if not _air.has(i):
		_air.append(i)
	multimesh.set_instance_color(i, Color(shade, shade, shade))
	_show(i)


func _show(i: int) -> void:
	# (drawn 2.5 times its size; its middle lifted so that its lowest corner is not far into the road)
	var s := 1.1 * _radius[i] * SEEN
	multimesh.set_instance_transform(i, Transform3D(_turn[i].scaled(Vector3.ONE * s), _pos[i] + Vector3.UP * (0.1 * s)))


## A marble in the next place of the ring.
func spawn(x: Vector3, v: Vector3) -> void:
	var i := _next
	_next = (_next + 1) % CAPACITY
	_used = maxi(_used, i + 1)
	multimesh.visible_instance_count = _used
	var radius := 0.004 + randf() * 0.006
	var mass := 0.0005 + (radius - 0.004) / 0.006 * 0.002 * (0.7 + 0.6 * randf())
	var shade := 0.04 + randf() * 0.07
	_put(i, x + Vector3.UP * radius, v, radius, mass, shade)


func _process(delta: float) -> void:
	delta = clampf(delta, 0.0, 0.05)
	if delta <= 0.0 or get_tree().paused:
		return
	for c in get_parent().get_children():
		if c is Car and not (c as Car).is_ghost and not (c as Car).freeze:
			_shed(c as Car, delta)
	if _air.is_empty():
		return
	var space := get_world_3d().direct_space_state
	var keep := PackedInt32Array()
	for i in _air:
		if _fly(i, delta, space):
			keep.append(i)
	_air = keep


## A car makes marbles at its wheels that slide with a soft, hot surface: they come off at the back of the patch of
## contact with the speed of the tread (a tyre that rolls lets them fall where they are, one that spins throws them
## back, a locked one leaves them with the car), into a cone a little to the side and up.
func _shed(car: Car, delta: float) -> void:
	var carry: Array = _carry.get(car, [0.0, 0.0, 0.0, 0.0])
	_carry[car] = carry
	var fwd := car.global_transform.basis.z
	fwd = Vector3(fwd.x, 0.0, fwd.z).normalized()
	for wi in 4:
		var w := car.wheels[wi]
		if not w.contact or not (w.surface in ["road", "track01"]) or w.load < 300.0:
			carry[wi] = 0.0
			continue
		var off := float(w.kind.get("smoke", 0))
		var soft := clampf((w.surf_t - (150.0 + off)) / 30.0, 0.0, 1.0) * (1.0 - 0.8 * clampf((w.surf_t - (220.0 + off)) / 40.0, 0.0, 1.0))
		var slide := Vector2(w.omega * w.radius - w.forward_speed, w.slip_tan * maxf(absf(w.forward_speed), 1.5)).length()
		carry[wi] += 32.0 * soft * clampf((slide - 1.5) / 5.0, 0.0, 1.0) * delta
		var n := floori(carry[wi])
		carry[wi] -= n
		var tangent := w.omega * w.radius
		var left := Vector3(fwd.z, 0.0, -fwd.x)
		for k in n:
			var side := (randf() - 0.5) * 0.25
			var d := (-fwd + left * side + Vector3.UP * randf() * 0.15).normalized()
			var at := w.point - fwd * 0.1 + Vector3((randf() - 0.5) * 0.05, 0.0, (randf() - 0.5) * 0.05)
			spawn(at, car.linear_velocity + d * tangent + Vector3.UP * randf() * 0.3)


## One marble in the air for a time step: gravity, the drag of the air, and the track (a ray from where it was to
## where it goes). False when it has come to rest (or fallen off the world).
func _fly(i: int, delta: float, space: PhysicsDirectSpaceState3D) -> bool:
	var r := _radius[i]
	var v := _vel[i] + Vector3.DOWN * 9.81 * delta
	var speed := v.length()
	if speed > 1e-3:
		v *= 1.0 - minf(0.9, 0.5 * 1.225 * 0.7 * PI * r * r * speed / _mass[i] * delta)
	var rolling := pow(0.65, delta * 60.0)
	var p := _pos[i]
	var to := p + v * delta
	var rest := false
	var hit := space.intersect_ray(PhysicsRayQueryParameters3D.create(p, to + v.normalized() * r if speed > 1e-4 else to + Vector3.DOWN * r, 1))
	if not hit.is_empty():
		var n: Vector3 = hit["normal"]
		to = hit["position"] + n * r
		var vn := v.dot(n)
		if vn < 0.0:
			# (hot rubber does not bounce much: a quarter of the speed into the surface comes back, it rolls only a little)
			v -= n * (1.25 * vn)
			v = Vector3(v.x * rolling, v.y, v.z * rolling)
		if n.y > 0.6 and absf(vn) < 0.5 and v.x * v.x + v.z * v.z < 0.16:
			rest = true
			v = Vector3.ZERO
	_pos[i] = to
	_vel[i] = v
	if not rest and to.y < -500.0:
		multimesh.set_instance_transform(i, Transform3D(Basis.from_scale(Vector3.ZERO), to))
		return false
	_show(i)
	return not rest


## All gone (the car is put back at the start).
func clear() -> void:
	_air.clear()
	_next = 0
	_used = 0
	multimesh.visible_instance_count = 0


func count() -> int:
	return _used
