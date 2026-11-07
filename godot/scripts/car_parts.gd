class_name CarParts
extends RefCounted
## The parts of a car that come off (web/js/Parts.js; car.json "parts", see SOFTBODY.md): objects of the model that
## sit on the car until the load on them passes their break force. The load is the larger of the mass of the part
## times the acceleration of its place (the inertia) and the force of the shell on the nodes it hangs on (their
## displacement times the stiffness of an anchor); a part also comes loose when the anchor of one of its nodes tears.
##
##   "detachable"  goes on bending with the body for break_delay (0.15 s), then falls off: a RigidBody3D with a box
##                 of its size, that keeps the speed of its place on the car and the dent it had, and hits the track
##                 and the other cars (not its own car)
##   "breakable"   breaks at once (glass, a lamp): it is gone, and a cloud of shards flies
##   "hinge"       here it sits shut until all its pins break (the largest break_force of its mounts), then it falls
##                 off as a detachable part; the hinge that swings open is not made yet
##
## The nodes of the shell that it hangs on: car.json "nodes", or the nodes of the layout that name it, or the three
## nearest to its middle. Repair puts every part back.

const FREE_LAYER := 2               # the loose parts: not in the way of the rays of the wheels (layer 1)

class Part:
	var name := ""
	var mode := "detachable"
	var object: Node3D
	var home_parent: Node
	var home_xf := Transform3D.IDENTITY
	var centre := Vector3.ZERO      # in the frame of the car
	var size := Vector3.ONE
	var mass := 2.0
	var break_force := 0.0          # N, 0: it never comes off
	var break_delay := 0.15
	var nodes := PackedInt32Array()
	var group := ""                 # the part has nodes of its own (the layout names it)
	var state := "held"             # held, free, broken
	var timer := -1.0
	var detach_timer := -1.0
	var last_v := Vector3.ZERO
	var has_v := false
	var acc := 0.0                  # the acceleration of its place, smoothed over a few steps (m/s^2)
	var load := 0.0
	var body: RigidBody3D = null
	var hidden: Array[Node3D] = []

var car: Car
var parts: Array[Part] = []
var _settle := 60                   # physics steps without load (after a jump of the car: put on the road, a reset)


func _init(c: Car) -> void:
	car = c
	var sb := car.shell.sb if car.shell != null else null
	for spec in car.config.get("parts", []):
		if not (spec is Dictionary) or not spec.has("object"):
			continue
		var mode := str(spec.get("mode", "fixed"))
		if not mode in ["detachable", "breakable", "hinge"]:
			continue
		var object := car.model_root.find_child(str(spec["object"]), true, false) as Node3D
		if object == null:
			continue
		var box := CarModel.bounds(object, car)
		if box.size == Vector3.ZERO:
			continue
		var p := Part.new()
		p.name = str(spec["object"])
		p.mode = mode
		p.object = object
		p.home_parent = object.get_parent()
		p.home_xf = object.transform
		p.centre = box.get_center()
		p.size = box.size.max(Vector3(0.08, 0.08, 0.08))
		p.mass = float(spec.get("mass", 15))
		p.break_delay = float(spec.get("break_delay", 0.15))
		if mode == "hinge":
			var most := float(spec.get("hinge", {}).get("break_force", 0))
			for m in spec.get("mounts", []):
				if m is Dictionary:
					most = maxf(most, float(m.get("break_force", 0)))
			p.break_force = most
		else:
			p.break_force = float(spec.get("break_force", 0))
		if sb != null:
			for k in sb.count:
				if sb.part_of[k] == p.name:
					p.nodes.append(k)
			if not p.nodes.is_empty():
				p.group = p.name
			for n in spec.get("nodes", []):
				if int(n) >= 0 and int(n) < sb.count and not p.nodes.has(int(n)):
					p.nodes.append(int(n))
			if p.nodes.is_empty():
				var order := []
				for k in sb.count:
					if sb.part_of[k] == "":
						order.append([sb.rest[k].distance_squared_to(p.centre), k])
				order.sort_custom(func(x: Array, y: Array) -> bool: return x[0] < y[0])
				for i in mini(3, order.size()):
					p.nodes.append(int(order[i][1]))
		parts.append(p)


## Once a physics step (the car has stepped): the loads, and the parts that come off.
func update(dt: float) -> void:
	if _settle > 0:
		_settle -= 1
		for p in parts:
			p.has_v = false
			p.acc = 0.0
		return
	var sb := car.shell.sb if car.shell != null else null
	var xf := car.global_transform
	for p in parts:
		if p.detach_timer >= 0.0:
			p.detach_timer -= dt
			if p.detach_timer < 0.0 and sb != null:
				sb.detach_group(p.group)
		if p.state != "held":
			continue
		var v := car.linear_velocity + car.angular_velocity.cross(xf.basis * (p.centre - car.center_of_mass))
		# (the change of the speed in one step of 1/120 s is rough: a landing on the bump stops or a touch of the box
		# of the body gives a spike of a few ms, which tore a battery of 15 kg off when the car was put on the road)
		if p.has_v:
			p.acc += (v.distance_to(p.last_v) / dt - p.acc) * minf(1.0, dt / 0.02)
		p.last_v = v
		p.has_v = true
		var inertia := p.mass * p.acc
		var shell := 0.0
		var torn := false
		if sb != null:
			for k in p.nodes:
				if sb.anchor_alive[k] == 0:
					torn = true
				shell = maxf(shell, (sb.u[k] + sb.q[k]).length() * sb.anchor_k)
		p.load = maxf(inertia, shell)
		if p.timer >= 0.0:
			# (it goes on bending with the body for a moment after its force was passed, and then it comes off)
			p.timer -= dt
			if p.timer < 0.0:
				_come_off(p, v)
		elif torn or (p.break_force > 0.0 and p.load > p.break_force):
			RunLog.event("part %s of %s: %s at %.0f N" % [p.name, car.name, "breaks" if p.mode == "breakable" else "comes off", p.load])
			if p.mode == "breakable" or p.break_delay <= 0.0:
				_come_off(p, v)
			else:
				p.timer = p.break_delay


## No load for a few steps (the car was put somewhere: its speed jumped).
func settle() -> void:
	_settle = 60


func _come_off(p: Part, v: Vector3) -> void:
	p.timer = -1.0
	if p.group != "":
		p.detach_timer = 0.3
	var xf := car.global_transform
	var at := xf * p.centre
	if p.mode == "breakable":
		p.state = "broken"
		_hide(p)
		_shards(at, v)
		return
	p.state = "free"
	var body := RigidBody3D.new()
	body.name = "Part %s" % p.name
	body.mass = maxf(0.2, p.mass)
	body.continuous_cd = true
	body.collision_layer = FREE_LAYER
	body.collision_mask = 1 | FREE_LAYER
	body.linear_damp = 0.05
	body.angular_damp = 0.4
	var col := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = p.size
	col.shape = shape
	body.add_child(col)
	body.add_collision_exception_with(car)
	car.get_parent().add_child(body)
	body.global_transform = Transform3D(xf.basis, at)
	body.linear_velocity = v
	body.angular_velocity = car.angular_velocity
	p.body = body
	# what is seen: the meshes of the part as they are bent now, or the object itself while the model does not bend yet
	var baked := _bent_meshes(p)
	if baked.is_empty():
		var gx := p.object.global_transform
		p.object.get_parent().remove_child(p.object)
		body.add_child(p.object)
		p.object.global_transform = gx
	else:
		for m in baked:
			body.add_child(m)
			m.transform = Transform3D(Basis.IDENTITY, -p.centre)


## The meshes of a part with the bend of the shell in them (a copy, that does not follow the shell any more), and
## the bending meshes are hidden.
func _bent_meshes(p: Part) -> Array[MeshInstance3D]:
	var out: Array[MeshInstance3D] = []
	var m := car.shell_mesh
	if m == null or not m.ready or car.shell == null:
		return out
	var disp := car.shell.sb.displacement
	for bent in m.meshes:
		var src: Dictionary = m.source_of[bent]
		var node: Node = src["node"]
		if not is_instance_valid(node) or not (node == p.object or p.object.is_ancestor_of(node)) or not bent.visible:
			continue
		var mesh := ArrayMesh.new()
		var outs: Array = src["out"]
		for si in outs.size():
			var arrays: Array = (src["surfaces"][si] as Array).duplicate()
			var res: Dictionary = outs[si]
			var verts: PackedVector3Array = (res["v"] as PackedVector3Array).duplicate()
			var bones: PackedInt32Array = res["bones"]
			var weights: PackedFloat32Array = res["weights"]
			for vi in verts.size():
				var o := 4 * vi
				verts[vi] += disp[bones[o]] * weights[o] + disp[bones[o + 1]] * weights[o + 1] + disp[bones[o + 2]] * weights[o + 2] \
					+ disp[bones[o + 3]] * weights[o + 3]
			arrays[Mesh.ARRAY_VERTEX] = verts
			arrays[Mesh.ARRAY_NORMAL] = res.get("n", null)
			arrays[Mesh.ARRAY_TANGENT] = res.get("t", null)
			arrays[Mesh.ARRAY_BONES] = null
			arrays[Mesh.ARRAY_WEIGHTS] = null
			mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays, [], {}, int(res.get("flags", 0)))
			mesh.surface_set_material(si, bent.mesh.surface_get_material(si))
		var copy := MeshInstance3D.new()
		copy.mesh = mesh
		copy.material_override = bent.material_override
		for si in mesh.get_surface_count():
			copy.set_surface_override_material(si, bent.get_surface_override_material(si))
		bent.visible = false
		p.hidden.append(bent)
		out.append(copy)
	return out


func _hide(p: Part) -> void:
	var m := car.shell_mesh
	if m != null and m.ready:
		for bent in m.meshes:
			var node: Node = m.source_of[bent]["node"]
			if is_instance_valid(node) and (node == p.object or p.object.is_ancestor_of(node)) and bent.visible:
				bent.visible = false
				p.hidden.append(bent)
	if p.object.visible:
		p.object.visible = false
		p.hidden.append(p.object)


## A cloud of shards of a part that breaks (Shatter.js throws the faces of the part as well; here only the cloud).
func _shards(at: Vector3, v: Vector3) -> void:
	var fx := CPUParticles3D.new()
	fx.one_shot = true
	fx.amount = 60
	fx.lifetime = 1.4
	fx.explosiveness = 1.0
	var piece := BoxMesh.new()
	piece.size = Vector3(0.025, 0.004, 0.02)
	var glass := StandardMaterial3D.new()
	glass.albedo_color = Color(0.85, 0.92, 1.0, 0.7)
	glass.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	glass.metallic = 0.6
	glass.roughness = 0.1
	piece.material = glass
	fx.mesh = piece
	fx.direction = Vector3.UP
	fx.spread = 180.0
	fx.initial_velocity_min = 1.5
	fx.initial_velocity_max = 5.0
	fx.angular_velocity_min = -720.0
	fx.angular_velocity_max = 720.0
	fx.gravity = Vector3(0, -9.81, 0)
	car.get_parent().add_child(fx)
	fx.global_position = at
	# (the cloud keeps a part of the speed of the car)
	fx.direction = (Vector3.UP + v * 0.1).normalized()
	fx.emitting = true
	fx.finished.connect(fx.queue_free)


## Every part back in its place, whole.
func repair() -> void:
	for p in parts:
		if p.body != null:
			if p.object.get_parent() == p.body:
				p.body.remove_child(p.object)
				p.home_parent.add_child(p.object)
				p.object.transform = p.home_xf
			p.body.queue_free()
			p.body = null
		for h in p.hidden:
			if is_instance_valid(h):
				h.visible = true
		p.hidden.clear()
		p.state = "held"
		p.timer = -1.0
		p.detach_timer = -1.0
		p.has_v = false
		p.acc = 0.0
		p.load = 0.0
	_settle = 60


## The parts that came off and lie about (the car is going away).
func dispose() -> void:
	for p in parts:
		if p.body != null and is_instance_valid(p.body):
			p.body.queue_free()
			p.body = null


func count_off() -> int:
	var n := 0
	for p in parts:
		if p.state != "held":
			n += 1
	return n
