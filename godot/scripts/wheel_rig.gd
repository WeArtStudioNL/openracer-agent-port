class_name WheelRig
extends RefCounted
## The suspension of the wheels as part of the shell (SOFTBODY.md, "The rig"; CollisionProxy.js, Vehicle.updateHubs).
##
## Every wheel has nodes in the shell (CollisionProxy makes them): the hub H (the collision sphere of the wheel, 18 kg),
## the knuckle (the ball joints above and below, Ub and Lb, and the end of the tie rod, Te: 6 kg each) and the pivots on
## the car (U1, U2 of the upper arm, L1, L2 of the lower arm, R of the tie rod: 10 kg, a stiff anchor). Six stiff
## beams make the knuckle (it turns, it does not bend); the two beams of each arm and the tie rod bend: elastic up to
## their yield force, bent for good above it, torn at their break force (arms 14 and 36 kN, the tie rod 12 and 36 kN;
## car.json softbody arm_yield, arm_break, tie_yield, tie_break in kN). The hub and the knuckle have almost no anchor
## of their own: what holds a wheel are its arms. The shell solves them by position (SoftBody._rig_solve).
##
## Once a step the wheel is read from where its nodes are: the camber from how the line from Lb to Ub leans against
## how it was made, the toe from how the line from the hub to Te has turned, and the hub gives the place of the wheel
## on the car (the track and the wheelbase change). A bent wheel grips up to 40 % less. The wheel is off when both
## beams of an arm are torn or the hub has moved hub_limit (0.3 m): it has no road, no spring, no drive and no brake
## any more, and it flies off as a RigidBody3D (a cylinder of its size) with the speed and the spin it had, rolls
## away, and hits the track and, once it is clear of it, the car. Repair puts everything back.

const GRACE := 0.35                 # s after coming off in which a wheel does not hit the car (it is inside it)
const CLEAR_WAIT := 3.0             # s after that in which it can come clear; then it stays a ghost to the car
const FREE_LAYER := 2

var car: Car
var sb: SoftBody
var hub_limit := 0.3
var rigs: Array = [null, null, null, null]   # per wheel: {nodes: {role: k}, upper, lower, tie, camber0, toe0, home}
var lost := [false, false, false, false]
var damage := [0.0, 0.0, 0.0, 0.0]
var bodies: Array = [null, null, null, null]  # the wheels that came off
var events: Array[String] = []
var _base_hub: Array = [null, null, null, null]   # the place of the hub as the car has it, without the bend
var _set_hub: Array = [null, null, null, null]
var _grace := [0.0, 0.0, 0.0, 0.0]
var _repair_from: Array = []


func _init(c: Car, s: SoftBody, spheres: Array, cfg: Dictionary) -> void:
	car = c
	sb = s
	hub_limit = float(cfg.get("hub_limit", 0.3))
	var nodes: Array = [{}, {}, {}, {}]
	for k in spheres.size():
		var sp: Dictionary = spheres[k]
		if sp.get("rig", false):
			nodes[int(sp["wheel"])][str(sp["role"])] = k
	var arm := {"stiffness": 8e5, "yield_force": float(cfg.get("arm_yield", 14)) * 1000.0, "break_force": float(cfg.get("arm_break", 36)) * 1000.0}
	var tie := {"stiffness": 1.2e6, "yield_force": float(cfg.get("tie_yield", 12)) * 1000.0, "break_force": float(cfg.get("tie_break", 36)) * 1000.0}
	var stiff := {"stiffness": 1e6, "yield_force": 60000.0, "break_force": 200000.0}
	for wi in 4:
		var n: Dictionary = nodes[wi]
		if not n.has("H"):
			continue
		sb.set_node(n["H"], {"mass": 18.0, "anchor_scale": 0.02, "yield": 1e9, "break": 1e9})
		for role in ["Ub", "Lb", "Te"]:
			sb.set_node(n[role], {"mass": 6.0, "anchor_scale": 0.02, "yield": 1e9, "break": 1e9})
		for role in ["U1", "U2", "L1", "L2", "R"]:
			sb.set_node(n[role], {"mass": 10.0, "anchor_scale": 3.0, "yield": 150000.0, "break": 400000.0})
		var rig := {"nodes": n, "upper": [sb.add_beam(n["U1"], n["Ub"], arm), sb.add_beam(n["U2"], n["Ub"], arm)],
			"lower": [sb.add_beam(n["L1"], n["Lb"], arm), sb.add_beam(n["L2"], n["Lb"], arm)], "tie": sb.add_beam(n["R"], n["Te"], tie)}
		for pair in [["H", "Ub"], ["H", "Lb"], ["H", "Te"], ["Ub", "Lb"], ["Ub", "Te"], ["Lb", "Te"]]:
			sb.add_beam(n[pair[0]], n[pair[1]], stiff)
		var ub := sb.rest[n["Ub"]]
		var lb := sb.rest[n["Lb"]]
		var te := sb.rest[n["Te"]]
		var h := sb.rest[n["H"]]
		rig["camber0"] = atan2(ub.x - lb.x, ub.y - lb.y)
		rig["toe0"] = atan2(te.x - h.x, te.z - h.z)
		rig["home"] = h
		rigs[wi] = rig


static func _turn(a: float) -> float:
	return a - TAU if a > PI else (a + TAU if a < -PI else a)


## Once a physics step, before the suspension: the bend of every wheel from its nodes, and a wheel that comes off.
func update(dt: float) -> void:
	for i in 4:
		var w := car.wheels[i]
		# (the tuning menu makes the wheels again: the place of the hub as it is now is the one without the bend)
		if _set_hub[i] == null or w.hub != _set_hub[i]:
			_base_hub[i] = w.hub
		if lost[i]:
			w.lost = true
			w.omega = 0.0
			_settle_body(i, dt)
			continue
		var rig: Variant = rigs[i]
		if rig == null:
			continue
		var n: Dictionary = rig["nodes"]
		var upper := sb.beam_alive[rig["upper"][0]] == 1 or sb.beam_alive[rig["upper"][1]] == 1
		var lower := sb.beam_alive[rig["lower"][0]] == 1 or sb.beam_alive[rig["lower"][1]] == 1
		var hub := sb.position(n["H"])
		var d: Vector3 = hub - rig["home"]
		var moved := d.length()
		if not upper or not lower or moved > hub_limit:
			sb.set_node(n["H"], {"release": true})
			_lose(i)
			continue
		var ub := sb.position(n["Ub"])
		var lb := sb.position(n["Lb"])
		var camber := _turn(atan2(ub.x - lb.x, ub.y - lb.y) - float(rig["camber0"]))
		var te := sb.position(n["Te"])
		var toe := _turn(atan2(te.x - hub.x, te.z - hub.z) - float(rig["toe0"]))
		# (in the frame of Godot a positive steer and a positive lean are to the left, as these angles are)
		w.toe_bend = clampf(toe, -0.35, 0.35)
		w.camber_bend = clampf(camber, -0.35, 0.35)
		damage[i] = minf(0.99, maxf(moved / hub_limit, maxf(absf(toe) / 0.2, absf(camber) / 0.2)))
		w.damage_grip = 1.0 - 0.4 * damage[i]
		_place(i, Vector3(d.x, 0.0, d.z))


func _place(i: int, shift: Vector3) -> void:
	var w := car.wheels[i]
	w.hub = (_base_hub[i] as Vector3) + shift
	_set_hub[i] = w.hub
	if w.hub_node != null and car.bike == null:
		w.hub_node.rotation.z = -w.camber_bend


## The bend of every wheel as it is (for the pit stop, which straightens it bit by bit), and its share of the way back.
func repair_start() -> void:
	_repair_from = []
	for w in car.wheels:
		_repair_from.append([w.toe_bend, w.camber_bend, w.hub])


func repair_to(share: float) -> void:
	if _repair_from.is_empty():
		return
	var k := 1.0 - clampf(share, 0.0, 1.0)
	for i in 4:
		var w := car.wheels[i]
		var f: Array = _repair_from[i]
		w.toe_bend = float(f[0]) * k
		w.camber_bend = float(f[1]) * k
		if _base_hub[i] != null:
			_place(i, ((f[2] as Vector3) - (_base_hub[i] as Vector3)) * k)


func bent() -> int:
	var n := 0
	for i in 4:
		var w := car.wheels[i]
		if lost[i] or damage[i] > 0.01 or absf(w.toe_bend) > 0.002 or absf(w.camber_bend) > 0.002:
			n += 1
	return n


## Every wheel whole and on the car again.
func repair() -> void:
	_repair_from = []
	for i in 4:
		var w := car.wheels[i]
		if lost[i]:
			w.lost = false
			if w.hub_node != null:
				w.hub_node.visible = true
		lost[i] = false
		damage[i] = 0.0
		w.toe_bend = 0.0
		w.camber_bend = 0.0
		w.damage_grip = 1.0
		if _base_hub[i] != null:
			_place(i, Vector3.ZERO)
		if bodies[i] != null and is_instance_valid(bodies[i]):
			(bodies[i] as Node).queue_free()
		bodies[i] = null


## The wheels that came off and lie about (the car is going away).
func dispose() -> void:
	for i in 4:
		if bodies[i] != null and is_instance_valid(bodies[i]):
			(bodies[i] as Node).queue_free()
		bodies[i] = null


## A hit on a tyre from outside (the debug view; Vehicle.js hitWheel): the damage of a hit of the wheel by its impulse
## (N s) against the strength of the wheels (car.json softbody.wheel_strength, kN s, 25; 0: never); at 1 it is torn off.
## True when it came off.
func hit_wheel(i: int, impulse: float) -> bool:
	var sbc: Variant = car.config.get("softbody", {})
	var strength := float(sbc.get("wheel_strength", 25.0) if sbc is Dictionary else 25.0) * 1000.0
	if not (strength > 0.0) or lost[i] or car.wheels[i].lost:
		return false
	damage[i] = minf(1.0, float(damage[i]) + impulse / strength)
	if damage[i] >= 1.0:
		tear_off(i)
		return true
	return false


## A wheel torn off from outside (a test, the debug of the car editor).
func tear_off(i: int) -> void:
	if lost[i] or car.wheels[i].lost:
		return
	if rigs[i] != null:
		sb.set_node(rigs[i]["nodes"]["H"], {"release": true})
	_lose(i)


func _lose(i: int) -> void:
	var w := car.wheels[i]
	lost[i] = true
	damage[i] = 1.0
	var spin := w.omega
	w.lost = true
	w.omega = 0.0
	w.contact = false
	events.append("wheel %s torn off" % w.slot)
	RunLog.event("wheel %s of %s torn off" % [w.slot, car.name])
	if w.hub_node == null or not car.is_inside_tree() or car.get_parent() == null:
		return
	# (the body is made after the step of the physics: this can be in the middle of one)
	var gx := w.spin_node.global_transform
	var r := gx.origin - car.global_transform * car.center_of_mass
	_spawn.call_deferred(i, gx, car.linear_velocity + car.angular_velocity.cross(r), car.angular_velocity + gx.basis.x.normalized() * spin)


## The wheel as it is seen, as a body that keeps the speed and the spin it had.
func _spawn(i: int, gx: Transform3D, lin: Vector3, ang: Vector3) -> void:
	var w := car.wheels[i]
	if not lost[i] or not is_instance_valid(car) or not car.is_inside_tree():
		return
	var body := RigidBody3D.new()
	body.name = "Wheel %s" % w.slot
	body.mass = clampf(20.0 * pow(w.radius / 0.33, 2.0), 3.0, 40.0)
	body.continuous_cd = true
	body.collision_layer = FREE_LAYER
	body.collision_mask = 1 | FREE_LAYER | TrackObjects.LAYER_OBJECT | Track.SCENERY_LAYER
	body.linear_damp = 0.05
	body.angular_damp = 0.1
	var mat := PhysicsMaterial.new()
	mat.friction = 0.9
	mat.bounce = 0.3
	body.physics_material_override = mat
	var col := CollisionShape3D.new()
	var shape := CylinderShape3D.new()
	shape.radius = w.radius
	shape.height = clampf(w.width, 0.1, 0.5)
	col.shape = shape
	col.rotation.z = PI / 2.0
	body.add_child(col)
	for child in w.spin_node.get_children():
		body.add_child(child.duplicate())
	body.add_collision_exception_with(car)
	car.get_parent().add_child(body)
	CarParts.keep_to_own(body, car)          # (not the other cars and their parts: Parts.js)
	body.global_transform = gx.orthonormalized()
	body.linear_velocity = lin
	body.angular_velocity = ang
	w.hub_node.visible = false
	bodies[i] = body
	_grace[i] = GRACE


## A wheel that came off hits the car when it is clear of it (it starts inside the wheel arch).
func _settle_body(i: int, dt: float) -> void:
	var body: RigidBody3D = bodies[i]
	if body == null or not is_instance_valid(body) or _grace[i] <= -CLEAR_WAIT - 1.0:
		return
	_grace[i] -= dt
	if _grace[i] > 0.0:
		return
	if CarParts.clear_of(body, car):
		body.remove_collision_exception_with(car)
		_grace[i] = -CLEAR_WAIT - 2.0
	elif _grace[i] < -CLEAR_WAIT:
		_grace[i] = -CLEAR_WAIT - 2.0
