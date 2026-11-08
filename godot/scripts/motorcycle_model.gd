class_name MotorcycleModel
extends RefCounted
## What a motorcycle looks like as it rides (web/js/CarLoader.js, Chain.js, Driver.js): the front end turns about
## the axis of the fork (the parts called steerhead_..., the grips and the levers; the axis is the empty called
## "steerhead", or the rake of car.json through the middle of the front wheel), the front wheel goes along the fork
## with the springs, the parts called brake_..._FL go with it (the fork legs, the caliper, the mudguard), the
## swingarm turns about its pivot with the rear wheel and the rear shock is stretched between the frame and the arm,
## the chain runs round the sprockets, and the rider sits on it (MotorcycleRider).

const ON_HANDLEBAR := ["gripl", "gripr", "frontbraker", "clutchl"]

var car: Car
var rider: MotorcycleRider = null
# the front end
var head: Node3D = null
var head_pivot := Vector3.ZERO
var head_axis := Vector3.UP
var head_custom := false
var rake := 0.0
var wheel_centre := Vector3.ZERO
# the swingarm and the rear shock
var arm: Node3D = null
var arm_rest := Basis.IDENTITY
var arm_axis := Vector3.RIGHT          # the x axis of the body, in the frame of the arm
var arm_length := 0.0
var arm_pivot_z := 0.0
var arm_axle_z := 0.0
var shock: Node3D = null
var shock_rest := Transform3D.IDENTITY  # in the space of the car
var shock_top := Vector3.ZERO           # the two ends, in the frame of the part
var shock_bot := Vector3.ZERO
var shock_bot_arm := Vector3.ZERO       # the lower end in the frame of the arm
var shock_len := 0.0
# the chain
var chain: MultiMeshInstance3D = null
var link_xf := Transform3D.IDENTITY
var pitch := 0.0
var along_z := true
var front_sprocket: Node3D = null
var front_rest := Transform3D.IDENTITY
var front_centre := Vector3.ZERO        # in the frame of its parent
var front_centre_car := Vector3.ZERO
var r_front := 0.0
var rear_sprocket: Node3D = null
var rear_centre := Vector3.ZERO         # in the frame of the spin of the rear wheel
var r_rear := 0.0
var chain_x := 0.0
var chain_s := 0.0
var spin_prev := INF


func _init(c: Car, body: Node3D) -> void:
	car = c
	if body == null:
		return
	wheel_centre = car.wheels[0].hub + car.wheels[0].visual_offset
	_make_head(body)
	_wheel_parts(body)
	_make_swingarm(body)
	_make_chain(body)
	var dcfg: Dictionary = car.config.get("driver", {})
	if dcfg.get("enabled", true) != false and dcfg.has("file"):
		rider = MotorcycleRider.new(car, dcfg)


static func _key(n: Node) -> String:
	var out := ""
	for ch in str(n.name).to_lower():
		if (ch >= "a" and ch <= "z") or (ch >= "0" and ch <= "9"):
			out += ch
	return out


static func _find(root: Node, test: Callable) -> Node3D:
	for n in root.find_children("*", "Node3D", true, false):
		if test.call(n):
			return n as Node3D
	return null


## Moves a part under another node and keeps where it is.
func _reparent(part: Node3D, to: Node3D) -> void:
	var t := CarModel.relative(part, car)
	part.get_parent().remove_child(part)
	part.owner = null
	to.add_child(part)
	part.transform = CarModel.relative(to, car).affine_inverse() * t


func _make_head(body: Node3D) -> void:
	var axis_node: Node3D = null
	var parts: Array[Node3D] = []
	for n in body.find_children("*", "Node3D", true, false):
		var k := _key(n)
		if k == "steerhead" and axis_node == null:
			axis_node = n
			if n.find_children("*", "MeshInstance3D", true, false).is_empty() and not n is MeshInstance3D:
				continue
		if k.begins_with("steerhead") or ON_HANDLEBAR.has(k):
			parts.append(n)
	# (a part inside another found part goes with it)
	var top: Array[Node3D] = []
	for p in parts:
		var inside := false
		for o in parts:
			if o != p and o.is_ancestor_of(p):
				inside = true
		if not inside:
			top.append(p)
	if top.is_empty():
		return
	head_pivot = wheel_centre
	var rake_deg := float(car.config.get("motorcycle", {}).get("rake_deg", 24.5))
	head_axis = Vector3(0.0, cos(deg_to_rad(rake_deg)), -sin(deg_to_rad(rake_deg)))
	if axis_node != null:
		var t := CarModel.relative(axis_node, car)
		var ax := (t.basis * Vector3.UP).normalized()
		if ax.y < 0.0:
			ax = -ax
		if ax.y >= 0.3:
			head_pivot = t.origin
			head_axis = ax
			head_custom = true
	rake = atan2(-head_axis.z, head_axis.y)
	car.bike.fork_slope = head_axis.z / head_axis.y      # (the physics: the fork dives under the brake, CarLoader.setForkGeometry)
	head = Node3D.new()
	head.name = "Steerhead"
	head.position = head_pivot
	car.add_child(head)
	for p in top:
		_reparent(p, head)


## The parts that go with a wheel without spinning (brake_fork_leg_FL, brake_caliper_FL, brake_mudguard_FL), and the
## rear sprocket that spins with the rear wheel.
func _wheel_parts(body: Node3D) -> void:
	for n in body.find_children("*", "Node3D", true, false):
		var k := _key(n)
		if not (k.contains("caliper") or k.contains("brake")) or k.contains("disc") or k.contains("rotor") or k == "frontbraker":
			continue
		if k.ends_with("fl"):
			_reparent(n, car.wheels[0].steer_node)
		elif k.ends_with("rl"):
			_reparent(n, car.wheels[2].steer_node)
	rear_sprocket = _find(body, func(n: Node) -> bool: return ["rearsprocket", "sprocketrear", "sprocketr", "sprocketrl"].has(_key(n)))
	if rear_sprocket != null:
		_reparent(rear_sprocket, car.wheels[2].spin_node)


func _make_swingarm(body: Node3D) -> void:
	var re := RegEx.create_from_string("(?i)^(swing_?arm|rear_?arm)")
	arm = _find(body, func(n: Node) -> bool: return re.search(str(n.name)) != null)
	if arm == null:
		return
	var t := CarModel.relative(arm, car)
	var axle := car.wheels[2].hub + car.wheels[2].visual_offset
	arm_length = Vector2(axle.y - t.origin.y, axle.z - t.origin.z).length()
	if arm_length < 0.1:
		arm = null
		return
	arm_rest = arm.basis
	arm_axis = (t.basis.inverse() * Vector3.RIGHT).normalized()
	arm_pivot_z = t.origin.z
	arm_axle_z = axle.z
	# (the physics: the tangent of the arc of the axle, forward over up, when the pivot is in front of the axle)
	car.bike.swing_slope = (axle.y - t.origin.y) / (t.origin.z - axle.z) if t.origin.z > axle.z else 0.0
	# the rear shock between the frame and the arm: its long axis from its mesh, the higher end on the frame
	var re2 := RegEx.create_from_string("(?i)^(rear_?(spring|shock|damper|strut)|(spring|shock|damper|strut)_?rear)")
	shock = _find(body, func(n: Node) -> bool: return re2.search(str(n.name)) != null)
	if shock == null:
		return
	var mesh := shock as MeshInstance3D
	if mesh == null or mesh.mesh == null:
		shock = null
		return
	var bb := mesh.mesh.get_aabb()
	var axis := Vector3.RIGHT if bb.size.x >= bb.size.y and bb.size.x >= bb.size.z else (Vector3.UP if bb.size.y >= bb.size.z else Vector3.BACK)
	var half := maxf(bb.size.x, maxf(bb.size.y, bb.size.z)) / 2.0
	var e1 := bb.get_center() + axis * half
	var e2 := bb.get_center() - axis * half
	shock_rest = CarModel.relative(shock, car)
	var hi := (shock_rest * e1).y >= (shock_rest * e2).y
	shock_top = e1 if hi else e2
	shock_bot = e2 if hi else e1
	shock_len = shock_top.distance_to(shock_bot)
	shock_bot_arm = t.affine_inverse() * (shock_rest * shock_bot)
	if shock_len < 0.02:
		shock = null


func _make_chain(body: Node3D) -> void:
	var link_node := _find(body, func(n: Node) -> bool: return ["chainlink", "chain"].has(_key(n)))
	front_sprocket = _find(body, func(n: Node) -> bool: return ["frontsprocket", "sprocketfront", "sprocketf"].has(_key(n)))
	if link_node == null or front_sprocket == null or rear_sprocket == null:
		return
	var mesh := link_node as MeshInstance3D
	if mesh == null:
		mesh = _find(link_node, func(n: Node) -> bool: return n is MeshInstance3D) as MeshInstance3D
	if mesh == null or mesh.mesh == null:
		return
	var fb := CarModel.relative(front_sprocket, car) * CarModel.bounds(front_sprocket, front_sprocket)
	var rb := CarModel.bounds(rear_sprocket, rear_sprocket)
	var lb := CarModel.relative(mesh, car) * mesh.mesh.get_aabb()
	r_front = maxf(fb.size.y, fb.size.z) / 2.0
	r_rear = maxf(rb.size.y, rb.size.z) / 2.0
	pitch = maxf(lb.size.y, lb.size.z)
	along_z = lb.size.z >= lb.size.y
	link_xf = Transform3D(Basis.IDENTITY, -lb.get_center()) * CarModel.relative(mesh, car)
	front_centre_car = fb.get_center()
	front_centre = CarModel.relative(front_sprocket.get_parent() as Node3D, car).affine_inverse() * front_centre_car
	front_rest = front_sprocket.transform
	rear_centre = rear_sprocket.transform * rb.get_center()
	chain_x = (front_centre_car.x + (CarModel.relative(rear_sprocket, car) * rb.get_center()).x) / 2.0
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = mesh.mesh
	chain = MultiMeshInstance3D.new()
	chain.name = "Chain"
	chain.multimesh = mm
	if mesh.get_surface_override_material_count() > 0 and mesh.get_surface_override_material(0) != null:
		chain.material_override = mesh.get_surface_override_material(0)
	car.add_child(chain)
	link_node.get_parent().remove_child(link_node)
	link_node.queue_free()


## Every frame, after the wheels of the car are placed.
func update(dt: float) -> void:
	var bike := car.bike
	var front := car.wheels[0]
	var rear := car.wheels[2]
	var steer := front.steer
	if head != null:
		head.transform = Transform3D(Basis(head_axis, steer), head_pivot)
		front.steer_node.basis = Basis(head_axis, steer)
		if head_custom:
			# (the wheel swings round the pivot of an axis that is not through its middle)
			var d := wheel_centre - head_pivot
			front.hub_node.position += Basis(head_axis, steer) * d - d
		var compression := car.susp_length + car.ride_front - front.length
		front.hub_node.position.z -= compression * tan(rake)
	if arm != null:
		var up := car.susp_length + car.ride_rear - rear.length
		var a := asin(clampf(up / arm_length, -1.0, 1.0))
		if arm_pivot_z < arm_axle_z:
			a = -a
		arm.basis = arm_rest * Basis(arm_axis, a)
		rear.hub_node.position.z += arm_length * (1.0 - cos(a)) * (-1.0 if arm_pivot_z < arm_axle_z else 1.0)
		if shock != null:
			_update_shock()
	if chain != null:
		_update_chain()
	if rider != null:
		if rider.ragdoll != null and not bike.crashed and not bike.limp:
			rider.recover()          # (a reset or a repair: the rider is back on the bike)
		rider.update(dt, bike)


## The rider goes limp where he sits (the key 9, to try a crash: Car.js goLimp); the bike rides on without him until
## his weight tips it over.
func go_limp() -> void:
	var bike := car.bike
	if bike.crashed or bike.limp or not can_ragdoll():
		return
	bike.limp = true
	rider.crash(true)
	RunLog.event("motorcycle %s: the rider goes limp" % car.name)


## The rider can be a ragdoll (a model with the bones of the arms and the legs).
func can_ragdoll() -> bool:
	return rider != null and rider.can_ragdoll()


## The middle of the rider's ragdoll (the crash camera looks at it), or null.
func rider_centre() -> Variant:
	return rider.ragdoll.centre if rider != null and rider.ragdoll != null else null


## The rear shock: the top stays on the frame, the bottom goes round with the arm; the part is turned and stretched
## between the two (OpenRacer.updateRearShock).
func _update_shock() -> void:
	var top := shock_rest * shock_top
	var bot := CarModel.relative(arm, car) * shock_bot_arm
	var d0 := (shock_rest.basis * (shock_bot - shock_top)).normalized()
	var d1 := bot - top
	var len := d1.length()
	if len < 1e-4:
		return
	d1 /= len
	var k := len / shock_len
	var r := Basis(Quaternion(d0, d1)) if d0.dot(d1) < 0.99999 else Basis.IDENTITY
	# (a stretch along the axis: I + (k - 1) d0 d0^T)
	var stretch := Basis(Vector3.RIGHT + (k - 1.0) * d0 * d0.x, Vector3.UP + (k - 1.0) * d0 * d0.y, Vector3.BACK + (k - 1.0) * d0 * d0.z)
	var b := r * stretch * shock_rest.basis
	var xf := Transform3D(b, top - b * shock_top)
	shock.transform = CarModel.relative(shock.get_parent() as Node3D, car).affine_inverse() * xf


## The chain round the two sprockets, in the plane of the bike (z along it, y up), moving with the rear wheel.
func _update_chain() -> void:
	var rear := car.wheels[2]
	var c2v := rear.hub_node.transform * rear.steer_node.transform * rear.spin_node.transform * rear_centre
	var c1 := Vector2(front_centre_car.z, front_centre_car.y)
	var c2 := Vector2(c2v.z, c2v.y)
	var u := c2 - c1
	var d := u.length()
	if d < r_front + r_rear + 0.01:
		return
	u /= d
	var psi := acos(clampf((r_front - r_rear) / d, -1.0, 1.0))
	var n_top := u.rotated(psi)
	var n_bot := u.rotated(-psi)
	if n_top.y < n_bot.y:
		var sw := n_top
		n_top = n_bot
		n_bot = sw
	var a_top := n_top.angle()
	var a_bot := n_bot.angle()
	var pieces := [
		[0, c2 + r_rear * n_top, c1 + r_front * n_top],
		[1, c1, r_front, a_top, _sweep(a_top, a_bot, (-u).angle())],
		[0, c1 + r_front * n_bot, c2 + r_rear * n_bot],
		[1, c2, r_rear, a_bot, _sweep(a_bot, a_top, u.angle())],
	]
	var total := 0.0
	var lens: Array[float] = []
	for p in pieces:
		var l: float = (p[2] as Vector2).distance_to(p[1]) if p[0] == 0 else absf(float(p[4])) * float(p[2])
		lens.append(l)
		total += l
	var mm := chain.multimesh
	if mm.instance_count == 0:
		mm.instance_count = maxi(4, roundi(total / maxf(0.005, pitch)))
	var spin := rear.spin
	if spin_prev == INF:
		spin_prev = spin
	var ds := spin - spin_prev
	spin_prev = spin
	if absf(ds) > PI:
		ds -= signf(ds) * TAU
	chain_s = fposmod(chain_s + r_rear * ds, total)
	var spacing := total / mm.instance_count
	var phi0 := 0.0 if along_z else PI / 2.0
	for k in mm.instance_count:
		var s := fmod(chain_s + k * spacing, total)
		var j := 0
		while j < 3 and s > lens[j]:
			s -= lens[j]
			j += 1
		var p: Array = pieces[j]
		var pos: Vector2
		var dir: Vector2
		var f := minf(s, lens[j]) / maxf(1e-6, lens[j])
		if p[0] == 0:
			pos = (p[1] as Vector2).lerp(p[2], f)
			dir = ((p[2] as Vector2) - (p[1] as Vector2)).normalized()
		else:
			var a := float(p[3]) + float(p[4]) * f
			var sg := 1.0 if float(p[4]) >= 0.0 else -1.0
			pos = (p[1] as Vector2) + float(p[2]) * Vector2(cos(a), sin(a))
			dir = Vector2(-sin(a), cos(a)) * sg
		var angle := atan2(dir.y, dir.x)
		mm.set_instance_transform(k, Transform3D(Basis(Vector3.RIGHT, -(angle - phi0)), Vector3(chain_x, pos.y, pos.x)) * link_xf)
	# the front sprocket turns with the chain
	var a1 := chain_s / maxf(1e-6, r_front)
	front_sprocket.transform = Transform3D(Basis.IDENTITY, front_centre) * Transform3D(Basis(Vector3.RIGHT, a1), Vector3.ZERO) \
		* Transform3D(Basis.IDENTITY, -front_centre) * front_rest


## The sweep from angle a to angle b that passes through the angle "through".
static func _sweep(a: float, b: float, through: float) -> float:
	var ccw := fposmod(b - a, TAU)
	var to_t := fposmod(through - a, TAU)
	return ccw if to_t <= ccw else ccw - TAU
