class_name CarParts
extends RefCounted
## The parts of a car that open and come off (web/js/Parts.js; car.json "parts", see SOFTBODY.md): objects of the
## model that sit on the car until the load on them passes their force. The load is the larger of the mass of the part
## times the acceleration of its place (the inertia) and the force of the shell on the nodes it hangs on (their
## displacement times the stiffness of an anchor); a part also comes loose when the anchor of one of its nodes tears.
##
##   "detachable"  goes on bending with the body for break_delay (0.15 s), then falls off: a RigidBody3D with a box
##                 of its size, that keeps the speed of its place on the car and the dent it had
##   "breakable"   breaks at once (glass, a lamp): it is gone, and its pieces and particles fly (Shatter)
##   "hinge"       hangs on pins ("mounts": [{point or node, axes, min, max, rot, limits, activate_force, break_force}],
##                 or "hinge": {origin, axis, min, max, rest, spring, damper, latch_force, break_force}). It sits shut
##                 until the load passes its latch (3 g of the part by default) or the "opens at" force of a pin, then
##                 swings on a joint of Jolt (Generic6DOFJoint3D: one axis a hinge between its angles, more a joint
##                 that turns about those, none a rigid pin; two pins without axes a hinge on the line between them,
##                 one a ball), with a spring and a damper. A pin tears at its break force (the load of the part shared
##                 over the pins that hold, the force of the shell on its node, or the push of the track on the part);
##                 with one left it swings on that one, with none it is free.
##
## A part with nodes of its own (the layout names it) dents by itself: its hold on the body is a link beam from each
## pin to the nearest node of the part, and a torn link is a torn pin; its nodes go on taking the hit for 0.3 s after it
## opens, then they go with it. A part whose object is in the object of another part rides on it: while that one swings
## or is loose its load is the change of the speed of its place on it, and it comes off at its own force.
##
## A part that has come loose does not hit its own car for 0.35 s, then as soon as it is clear of it (at most 3 s
## later; after that it stays a ghost to the car). A hinged part does not hit the car: the joint holds it. A loose part
## is damped and has a top speed (it jittered at the speed of a crash). Repair puts every part back.

const FREE_LAYER := 2               # the loose parts: not in the way of the rays of the wheels (layer 1)
const GRACE := 0.35
const CLEAR_WAIT := 3.0
const MAX_SPIN_HINGED := 9.0
const MAX_SPIN_FREE := 16.0
const EXTRA_SPEED := 10.0

class Mount:
	var node := -1                  # the node of the body that holds it
	var point := Vector3.ZERO       # in the frame of the car
	var break_force := 0.0
	var activate := 0.0
	var alive := true
	var beam := -1                  # the link beam to the nodes of the part
	var pin := false                # a pin of the part window: axes, limits, a turn
	var axes := {"x": true, "y": false, "z": false}
	var rot := Quaternion.IDENTITY
	var limits := {}                # axis -> [min, max] in radians

class Part:
	var name := ""
	var mode := "detachable"
	var spec: Dictionary = {}
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
	var mounts: Array[Mount] = []
	var hinge: Dictionary = {}      # origin, axis, min, max, rest, spring, damper, latch, break_force (a hinge part)
	var shatter: Dictionary = {}    # a breakable part: what it breaks into
	var state := "held"             # held, hinged, free, broken
	var timer := -1.0               # break_delay running (a detachable part)
	var open_timer := -1.0          # break_delay running (a hinge)
	var detach_timer := -1.0        # the nodes of the part leave the shell
	var last_v := Vector3.ZERO
	var has_v := false
	var acc := 0.0                  # the acceleration of its place, smoothed over a few steps (m/s^2)
	var load := 0.0
	var inertia := 0.0
	var wall_force := 0.0           # what the track pushes on a hinged part (N)
	var body: RigidBody3D = null
	var joint: Joint3D = null
	var offset := Vector3.ZERO      # where the body is on the car, in the frame of the car, when it came off
	var hidden: Array[Node3D] = []
	var copies: Array[MeshInstance3D] = []    # the bent meshes that it took along
	var grace := 0.0
	var pending := false            # waiting to be clear of the car
	var parent_part: Part = null
	var children: Array[Part] = []
	var on_parent := Transform3D.IDENTITY     # its place on the body of the part it rides on
	var home_rel := Transform3D.IDENTITY      # the object at home, in the frame of the car

var car: Car
var parts: Array[Part] = []
var events: Array[String] = []
var anchor: AnimatableBody3D = null   # what the hinges hang on: a body that is moved where the car will be (no force
                                      # goes back to the car through a joint; what the track pushes on a part does)
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
		p.spec = spec
		p.object = object
		p.home_parent = object.get_parent()
		p.home_xf = object.transform
		p.home_rel = CarModel.relative(object, car)
		p.centre = box.get_center()
		p.size = box.size.max(Vector3(0.08, 0.08, 0.08))
		p.mass = float(spec.get("mass", 15))
		p.break_force = float(spec.get("break_force", 0))
		p.break_delay = float(spec.get("break_delay", 0.15))
		if sb != null:
			_nodes_of(p, spec, sb)
		if mode == "hinge":
			_hinge_of(p, spec, sb)
		if mode == "breakable":
			var sh: Dictionary = spec.get("shatter", {}) if spec.get("shatter") is Dictionary else {}
			var how := str(sh.get("pieces", "faces"))
			p.shatter = {"how": how if how in ["mesh", "none"] else "faces", "max": clampi(roundi(float(sh.get("max_pieces", 40))), 1, 120),
				"particles": maxi(0, int(sh.get("particles", 120))), "shape": int(Shatter.SHAPES.get(str(sh.get("particle", "shards")), 0)),
				"colour": Shatter.colour_of(sh), "size": float(sh.get("size", 0.012)) if float(sh.get("size", 0)) > 0.0 else 0.012}
		parts.append(p)
	# parts on parts: a part whose object is in the object of another part goes with it
	for p in parts:
		var o := p.object.get_parent()
		while o != null and o != car and p.parent_part == null:
			for q in parts:
				if q != p and q.object == o:
					p.parent_part = q
					q.children.append(p)
					break
			o = o.get_parent()


## The nodes of the shell that a part hangs on: car.json "nodes", or the nodes of the layout that name it (then it has
## nodes of its own), or the three nearest to its middle.
func _nodes_of(p: Part, spec: Dictionary, sb: SoftBody) -> void:
	for k in sb.body_count:
		if sb.part_of[k] == p.name:
			p.nodes.append(k)
	if not p.nodes.is_empty():
		p.group = p.name
	if spec.has("nodes"):
		p.nodes = PackedInt32Array()
		for n in spec.get("nodes", []):
			if int(n) >= 0 and int(n) < sb.body_count and not p.nodes.has(int(n)):
				p.nodes.append(int(n))
	if p.nodes.is_empty():
		var order := []
		for k in sb.body_count:
			if sb.part_of[k] == "":
				order.append([sb.rest[k].distance_squared_to(p.centre), k])
		order.sort_custom(func(x: Array, y: Array) -> bool: return x[0] < y[0])
		for i in mini(3, order.size()):
			p.nodes.append(int(order[i][1]))


## The hinge and the pins of a part (at most two pins: a node of the shell or a point, with the nearest node of the
## body holding it), and the link beams to its own nodes.
func _hinge_of(p: Part, spec: Dictionary, sb: SoftBody) -> void:
	var h: Dictionary = spec.get("hinge", {}) if spec.get("hinge") is Dictionary else {}
	var any_activate := false
	for m in spec.get("mounts", []):
		if p.mounts.size() >= 2 or not (m is Dictionary):
			continue
		var mt := Mount.new()
		var pt: Variant = m.get("point")
		if pt is Array and (pt as Array).size() == 3:
			mt.point = Vector3(float(pt[0]), float(pt[1]), float(pt[2])) + car.center_of_mass
		elif sb != null and int(m.get("node", -1)) >= 0 and int(m.get("node", -1)) < sb.count:
			mt.node = int(m["node"])
			mt.point = sb.rest[mt.node]
		else:
			continue
		if mt.node < 0 and sb != null:
			var best := INF
			for k in sb.body_count:
				if sb.part_of[k] != p.name and sb.rest[k].distance_squared_to(mt.point) < best:
					best = sb.rest[k].distance_squared_to(mt.point)
					mt.node = k
		mt.break_force = float(m.get("break_force", 0))
		mt.activate = float(m.get("activate_force", 0))
		any_activate = any_activate or mt.activate > 0.0
		mt.pin = m.has("axes")
		mt.axes = _axes(m.get("axes"))
		var r: Variant = m.get("rot")
		if r is Array and (r as Array).size() == 4:
			mt.rot = Quaternion(float(r[0]), float(r[1]), float(r[2]), float(r[3])).normalized()
		for k in ["x", "y", "z"]:
			var lim: Variant = m.get("limits", {}).get(k) if m.get("limits") is Dictionary else null
			var l: Array = lim if lim is Array and (lim as Array).size() == 2 else [float(m.get("min", -90)), float(m.get("max", 90))]
			mt.limits[k] = [deg_to_rad(minf(float(l[0]), float(l[1]))), deg_to_rad(maxf(float(l[0]), float(l[1])))]
		if p.group != "" and sb != null and mt.node >= 0:
			var nearest := p.nodes[0]
			var bd := INF
			for g in p.nodes:
				if sb.rest[g].distance_squared_to(sb.rest[mt.node]) < bd:
					bd = sb.rest[g].distance_squared_to(sb.rest[mt.node])
					nearest = g
			var bf := mt.break_force if mt.break_force > 0.0 else 1e9
			mt.beam = sb.add_beam(mt.node, nearest, {"break_force": bf, "yield_force": bf * 0.5})
		p.mounts.append(mt)
	var o: Variant = h.get("origin")
	var ax: Variant = h.get("axis")
	p.hinge = {"origin": Vector3(float(o[0]), float(o[1]), float(o[2])) + car.center_of_mass if o is Array and (o as Array).size() == 3 else p.centre,
		"axis": Vector3(float(ax[0]), float(ax[1]), float(ax[2])).normalized() if ax is Array and (ax as Array).size() == 3 else Vector3.UP,
		"min": deg_to_rad(float(h.get("min", -90))), "max": deg_to_rad(float(h.get("max", 90))), "rest": deg_to_rad(float(h.get("rest", 0))),
		"spring": float(h.get("spring", 0)), "damper": float(h.get("damper", 0)), "break_force": float(h.get("break_force", 0)),
		"latch": float(h["latch_force"]) if h.has("latch_force") else (INF if any_activate else p.mass * 9.81 * 3.0)}


static func _axes(a: Variant) -> Dictionary:
	if a is Array:
		var o := {"x": false, "y": false, "z": false}
		for k in a:
			o[str(k).to_lower()] = true
		return o
	if a is Dictionary:
		return {"x": bool(a.get("x", false)), "y": bool(a.get("y", false)), "z": bool(a.get("z", false))}
	return {"x": true, "y": false, "z": false}


## Once a physics step (the car has stepped): the loads, and the parts that open, tear and come off.
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
		if p.state == "broken":
			continue
		if p.open_timer >= 0.0:
			p.open_timer -= dt
			if p.open_timer < 0.0 and p.state == "held":
				_start(p, "hinge")
		if p.detach_timer >= 0.0:
			p.detach_timer -= dt
			if p.detach_timer < 0.0 and sb != null:
				sb.detach_group(p.group)
				_rebake(p)
		var riding := p.state == "held" and _riding(p)
		var v: Vector3 = _parent_point(p)[1] if riding else _point_velocity(p.centre)
		# (the change of the speed in one step of 1/120 s is rough: a landing on the bump stops or a touch of the box
		# of the body gives a spike of a few ms, which tore a battery of 15 kg off when the car was put on the road)
		if p.has_v:
			p.acc += (v.distance_to(p.last_v) / dt - p.acc) * minf(1.0, dt / 0.02)
		p.last_v = v
		p.has_v = true
		p.inertia = p.mass * p.acc
		var shell := 0.0
		var torn := false
		if sb != null and not riding:
			for k in p.nodes:
				if sb.anchor_alive[k] == 0 and p.state == "held":
					torn = true
				shell = maxf(shell, (sb.u[k] + sb.q[k]).length() * sb.anchor_k)
		p.load = maxf(p.inertia, shell)
		if p.state != "held":
			_free_step(p, dt, sb, torn)
			continue
		if riding:
			# (on a part that moves: it comes off it at its force; a hinge at the force that tears it off)
			var limit := p.break_force if p.break_force > 0.0 else float(p.hinge.get("break_force", 0.0))
			if limit > 0.0 and p.load > limit:
				_come_off(p)
			continue
		if not p.mounts.is_empty():
			_pins_held(p, sb)
			if p.state != "held":
				continue
		if not p.hinge.is_empty():
			if p.open_timer < 0.0 and (p.hinge["latch"] <= 0.0 or p.load > p.hinge["latch"] or torn):
				_open_soon(p)
		elif p.timer >= 0.0:
			# (it goes on bending with the body for a moment after its force was passed, and then it comes off)
			p.timer -= dt
			if p.timer < 0.0:
				_come_off(p)
		elif torn or (p.break_force > 0.0 and p.load > p.break_force):
			RunLog.event("part %s of %s: %s at %.0f N" % [p.name, car.name, "breaks" if p.mode == "breakable" else "comes off", p.load])
			if p.mode == "breakable" or p.break_delay <= 0.0:
				_come_off(p)
			else:
				p.timer = p.break_delay
	_limit_speeds()
	_place_anchor(dt)


## The anchor of the hinges where the car will be at the end of this step (its speed and its turn now): Jolt moves it
## there through the step, so the hinges go with the car and not one step behind it.
func _place_anchor(dt: float) -> void:
	if anchor == null:
		return
	var xf := car.global_transform
	var av := car.angular_velocity
	var b := xf.basis
	if av.length() > 1e-6:
		b = Basis(av.normalized(), av.length() * dt) * b
	anchor.global_transform = Transform3D(b.orthonormalized(), xf.origin + car.linear_velocity * dt)


## The pins of a part that is shut: one loaded past its break force is gone (it opens on the others, or is free); one
## loaded past its "opens at" force lets it open; a link beam that tore is a pin that is gone.
func _pins_held(p: Part, sb: SoftBody) -> void:
	var holding := p.mounts.filter(func(m: Mount) -> bool: return m.alive)
	var broke := false
	var activated := false
	for m: Mount in holding:
		var pin_load := _mount_load(p, m, holding.size(), sb)
		if m.break_force > 0.0 and pin_load > m.break_force:
			m.alive = false
			broke = true
			_event(p, "mount torn")
		elif m.pin and m.activate > 0.0 and pin_load > m.activate:
			activated = true
		elif sb != null and m.beam >= 0 and sb.beam_alive[m.beam] == 0:
			m.alive = false
			broke = true
			_event(p, "mount torn")
	if broke:
		_start(p, "hinge" if p.mounts.any(func(m: Mount) -> bool: return m.alive) else "free")
	elif activated:
		_open_soon(p)


## The load on a pin (N): the force in its link beam, the force of the shell on its node of the body, or the inertia
## of the part shared over the pins that hold, whichever is more.
func _mount_load(p: Part, m: Mount, holding: int, sb: SoftBody) -> float:
	var load := p.inertia / maxf(1.0, holding)
	if sb != null and m.node >= 0:
		load = maxf(load, (sb.u[m.node] + sb.q[m.node]).length() * sb.anchor_k)
		if m.beam >= 0:
			load = maxf(load, absf(sb.beam_force(m.beam)))
	return load


func _free_step(p: Part, dt: float, sb: SoftBody, torn: bool) -> void:
	if p.body == null or not is_instance_valid(p.body):
		return
	if p.state == "hinged":
		p.wall_force = _push_car(p, dt)
		var alive := p.mounts.filter(func(m: Mount) -> bool: return m.alive)
		var changed := false
		for m: Mount in alive:
			var shell := 0.0
			if sb != null and m.node >= 0:
				if sb.anchor_alive[m.node] == 0:
					m.alive = false
					changed = true
					continue
				shell = (sb.u[m.node] + sb.q[m.node]).length() * sb.anchor_k
			if m.break_force > 0.0 and maxf(shell, maxf(p.inertia, p.wall_force) / alive.size()) > m.break_force:
				m.alive = false
				changed = true
				_event(p, "mount torn")
		if changed:
			if p.mounts.any(func(m: Mount) -> bool: return m.alive):
				_join(p)
			else:
				_start(p, "free")
				return
		var hb := float(p.hinge.get("break_force", 0.0))
		if torn or (hb > 0.0 and maxf(p.load, p.wall_force) > hb):
			_start(p, "free")
		return
	# a free part: it hits the car when it is clear of it
	if p.pending:
		p.grace -= dt
		if p.grace <= 0.0:
			if clear_of(p.body, car):
				p.body.remove_collision_exception_with(car)
				p.pending = false
			elif p.grace < -CLEAR_WAIT:
				p.pending = false


## What the track pushes on a hinged part in the last step (N, from its contacts), and its push on the car through the
## hinge (Vehicle.js, partForces): only what stops the car at the place it touches, at most 500 N a kilo of the part
## (1.5 kN at least), with a third of the arm (it is held by a hinge, it is not a wall: a door that dragged on the road
## turned the car over its nose).
func _push_car(p: Part, dt: float) -> float:
	var st := PhysicsServer3D.body_get_direct_state(p.body.get_rid())
	if st == null:
		return 0.0
	var f := Vector3.ZERO
	var at := Vector3.ZERO
	var wsum := 0.0
	for i in st.get_contact_count():
		var imp := st.get_contact_impulse(i)
		f += imp
		at += st.get_contact_local_position(i) * imp.length()
		wsum += imp.length()
	f /= maxf(dt, 1e-4)
	var mag := f.length()
	if mag < 1.0 or wsum <= 0.0:
		return 0.0
	at /= wsum
	var r := at - car.global_transform.origin
	var pv := car.linear_velocity + car.angular_velocity.cross(at - car.global_transform * car.center_of_mass)
	var pvn := -pv.dot(f) / mag
	if pvn > 0.0:
		var s := minf(1.0, minf(car.mass * pvn / maxf(dt, 1e-4) / mag, maxf(1500.0, 500.0 * p.mass) / mag))
		car.apply_force(f * s, r * 0.33)
	return mag


## Whether a body is clear of the car (its shapes do not overlap the box of the car).
static func clear_of(body: RigidBody3D, c: Car) -> bool:
	if not body.is_inside_tree():
		return true
	var space := body.get_world_3d().direct_space_state
	for col in body.get_children():
		if not (col is CollisionShape3D):
			continue
		var q := PhysicsShapeQueryParameters3D.new()
		q.shape = (col as CollisionShape3D).shape
		q.transform = (col as CollisionShape3D).global_transform
		q.collision_mask = c.collision_layer
		q.exclude = [body.get_rid()]
		for hit in space.intersect_shape(q, 8):
			if hit.get("collider") == c:
				return false
	return true


## The speed of a point of the car (in its frame), in the world.
func _point_velocity(local: Vector3) -> Vector3:
	var xf := car.global_transform
	return car.linear_velocity + car.angular_velocity.cross(xf.basis * (local - car.center_of_mass))


func _riding(p: Part) -> bool:
	return p.parent_part != null and p.parent_part.state in ["hinged", "free"] and p.parent_part.body != null and is_instance_valid(p.parent_part.body)


## Where a part that rides on another is now, and its speed: [transform, velocity] (world).
func _parent_point(p: Part) -> Array:
	var b := p.parent_part.body
	var gx := b.global_transform * p.on_parent
	return [gx, b.linear_velocity + b.angular_velocity.cross(gx.origin - b.global_transform.origin)]


## No load for a few steps (the car was put somewhere: its speed jumped).
func settle() -> void:
	_settle = 60


func _open_soon(p: Part) -> void:
	if p.open_timer >= 0.0:
		return
	if p.break_delay <= 0.0:
		_start(p, "hinge")
	else:
		p.open_timer = p.break_delay


func _come_off(p: Part) -> void:
	p.timer = -1.0
	if p.mode == "breakable":
		_break(p)
	else:
		_start(p, "free")


func _event(p: Part, what: String) -> void:
	events.append("%s %s" % [p.name, what])
	RunLog.event("part %s of %s: %s" % [p.name, car.name, what])


## A part opens on its hinge, or comes off: a body in the world, with the dent it has, at its place on the car.
func _start(p: Part, how: String) -> void:
	p.open_timer = -1.0
	if p.state == "held":
		_make_body(p)
		for ch in p.children:
			if ch.state == "held":
				ch.on_parent = p.body.global_transform.affine_inverse() * Transform3D(car.global_transform.basis, car.global_transform * ch.centre)
				ch.has_v = false
		if p.group != "":
			p.detach_timer = 0.3       # (the nodes of the part go with it, but not before the hit is over)
	if how == "hinge":
		_join(p)
		p.state = "hinged"
		p.body.angular_damp = float(p.spec.get("damping", 2.0))
		p.body.linear_damp = 0.2
		p.body.add_collision_exception_with(car)
		p.body.contact_monitor = true
		p.body.max_contacts_reported = 8
		p.pending = false
		_event(p, "unlatched")
	else:
		if p.joint != null:
			p.joint.queue_free()
			p.joint = null
		p.state = "free"
		p.body.angular_damp = float(p.spec.get("damping", 1.2))
		p.body.linear_damp = 0.15
		p.body.contact_monitor = false
		p.body.add_collision_exception_with(car)
		p.grace = GRACE
		p.pending = true
		_event(p, "detached")


func _make_body(p: Part) -> void:
	var sb := car.shell.sb if car.shell != null else null
	var riding := _riding(p)
	var xf := car.global_transform
	var shift := Vector3.ZERO
	if sb != null and not p.nodes.is_empty():
		for k in p.nodes:
			shift += sb.u[k] + sb.q[k]
		shift /= p.nodes.size()
	p.offset = p.centre + shift
	var body := RigidBody3D.new()
	body.name = "Part %s" % p.name
	body.mass = maxf(0.2, p.mass)
	body.continuous_cd = true
	body.collision_layer = FREE_LAYER
	body.collision_mask = 1 | FREE_LAYER | TrackObjects.LAYER_OBJECT | Track.SCENERY_LAYER
	var mat := PhysicsMaterial.new()
	mat.friction = 0.8
	mat.bounce = 0.12
	body.physics_material_override = mat
	var col := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = p.size
	col.shape = shape
	body.add_child(col)
	car.get_parent().add_child(body)
	var gx := _parent_point(p)[0] as Transform3D if riding else Transform3D(xf.basis, xf * p.offset)
	body.global_transform = gx
	if riding:
		var pb := p.parent_part.body
		body.linear_velocity = _parent_point(p)[1]
		body.angular_velocity = pb.angular_velocity
		# (its meshes are on the body of the part it rode on: they come along)
		for m: MeshInstance3D in p.parent_part.copies.duplicate():
			if _belongs(m, p):
				var mx := m.global_transform
				m.reparent(body)
				m.global_transform = mx
				p.parent_part.copies.erase(m)
				p.copies.append(m)
	else:
		body.linear_velocity = _point_velocity(p.offset)
		body.angular_velocity = car.angular_velocity
	p.body = body
	if not riding:
		_take_meshes(p)


## What is seen of a part goes with its body: the meshes as they are bent now (a copy that does not follow the shell
## any more), or the object itself while the model does not bend.
func _take_meshes(p: Part) -> void:
	var baked := _bent_meshes(p)
	if baked.is_empty() and p.copies.is_empty():
		var gx := p.object.global_transform
		p.object.get_parent().remove_child(p.object)
		p.body.add_child(p.object)
		p.object.global_transform = gx
		return
	for m in baked:
		p.body.add_child(m)
		m.transform = Transform3D(Basis.IDENTITY, -p.offset)
		p.copies.append(m)


## The nodes of a part with nodes of its own have left the shell: its meshes again, with the dent of the whole hit.
func _rebake(p: Part) -> void:
	if p.body == null or not is_instance_valid(p.body) or car.shell_mesh == null:
		return
	var mine: Array[MeshInstance3D] = []
	for c in p.copies:
		if not _belongs_to_child(c, p):
			mine.append(c)
	if mine.is_empty():
		return
	var bents := p.hidden.filter(func(h: Node3D) -> bool: return car.shell_mesh.meshes.has(h))
	for h: Node3D in bents:
		h.visible = true
		p.hidden.erase(h)
	for m in mine:
		p.copies.erase(m)
		m.queue_free()
	for m in _bent_meshes(p):
		p.body.add_child(m)
		m.transform = Transform3D(Basis.IDENTITY, -p.offset)
		p.copies.append(m)


func _belongs(m: MeshInstance3D, p: Part) -> bool:
	var src: Variant = m.get_meta("source", null)
	return src is Node and is_instance_valid(src) and (src == p.object or p.object.is_ancestor_of(src))


func _belongs_to_child(m: MeshInstance3D, p: Part) -> bool:
	for ch in p.children:
		if _belongs(m, ch):
			return true
	return false


## The meshes of a part with the bend of the shell in them (a copy that does not follow the shell any more, in the
## frame of the car), and the bending meshes are hidden.
func _bent_meshes(p: Part) -> Array[MeshInstance3D]:
	var out: Array[MeshInstance3D] = []
	var m := car.shell_mesh
	if m == null or not m.ready or car.shell == null:
		return out
	for bent in m.meshes:
		var node: Node = m.source_of[bent]["node"]
		if not is_instance_valid(node) or not (node == p.object or p.object.is_ancestor_of(node)) or not bent.visible:
			continue
		var copy := MeshInstance3D.new()
		copy.mesh = _baked(bent)
		copy.material_override = bent.material_override
		copy.set_meta("source", node)
		for si in copy.mesh.get_surface_count():
			copy.set_surface_override_material(si, bent.get_surface_override_material(si))
		bent.visible = false
		p.hidden.append(bent)
		out.append(copy)
	return out


## A mesh that bends with the shell as it is now: its vertices in the frame of the car, with the displacement in them.
func _baked(bent: MeshInstance3D, with_disp := PackedVector3Array()) -> ArrayMesh:
	var src: Dictionary = car.shell_mesh.source_of[bent]
	var disp := car.shell.sb.displacement if with_disp.is_empty() else with_disp
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
	return mesh


## The joint of a hinged part (Jolt: a Generic6DOFJoint3D between the car and the part, at the pin; its X is the axis
## of the hinge). Two pins that hold: a hinge on the line between them; one: it swings about that point; none (a part
## without pins): the hinge of the spec, about its origin and axis. A pin with axes (the part window of the car editor):
## the first pin that holds is the joint.
func _join(p: Part) -> void:
	if p.joint != null:
		p.joint.queue_free()
		p.joint = null
	var alive := p.mounts.filter(func(m: Mount) -> bool: return m.alive)
	if not p.mounts.is_empty() and alive.is_empty():
		return
	var origin: Vector3 = p.hinge.get("origin", p.centre)
	var axis: Vector3 = p.hinge.get("axis", Vector3.UP)
	var lo: float = p.hinge.get("min", -PI / 2.0)
	var hi: float = p.hinge.get("max", PI / 2.0)
	var free_axes := ["x"]          # in the frame of the joint
	var limits := {}
	var ball := false
	var frame := Basis.IDENTITY
	var pins := alive.filter(func(m: Mount) -> bool: return m.pin)
	if not pins.is_empty():
		var pin: Mount = pins[0]
		origin = pin.point
		var on := ["x", "y", "z"].filter(func(k: String) -> bool: return pin.axes[k])
		frame = Basis(pin.rot)
		free_axes = on
		for k in on:
			limits[k] = pin.limits[k]
		if on.size() == 1:
			# (the axis of the pin is the X of the joint; the zero of the angles is the pin's own: its twist about the axis
			# shifts the range against the rest place of the part)
			var a := Vector3(1 if on[0] == "x" else 0, 1 if on[0] == "y" else 0, 1 if on[0] == "z" else 0)
			var tau := 2.0 * atan2(Vector3(pin.rot.x, pin.rot.y, pin.rot.z).dot(a), pin.rot.w)
			tau = wrapf(tau, -PI, PI)
			axis = pin.rot * a
			lo = pin.limits[on[0]][0] + tau
			hi = pin.limits[on[0]][1] + tau
	elif not p.mounts.is_empty():
		origin = alive[0].point
		if alive.size() >= 2:
			axis = (alive[1].point - alive[0].point).normalized()
		else:
			ball = true
	var j := Generic6DOFJoint3D.new()
	j.name = "Hinge %s" % p.name
	var xf := car.global_transform
	if free_axes.size() == 1 and not ball:
		frame = _basis_x(axis)
		limits = {"x": [lo, hi]}
		free_axes = ["x"]
	for k in ["x", "y", "z"]:
		for prop in ["linear_limit_%s/enabled", "angular_limit_%s/enabled"]:
			j.set(prop % k, true)
		j.set("linear_limit_%s/upper_distance" % k, 0.0)
		j.set("linear_limit_%s/lower_distance" % k, 0.0)
		if ball:
			j.set("angular_limit_%s/enabled" % k, false)
		elif free_axes.has(k):
			# (the angles of the joint of Jolt turn the other way than the right hand about its axis: the range is mirrored)
			var l: Array = limits.get(k, [-PI / 2.0, PI / 2.0])
			j.set("angular_limit_%s/lower_angle" % k, -float(l[1]))
			j.set("angular_limit_%s/upper_angle" % k, -float(l[0]))
		else:
			j.set("angular_limit_%s/lower_angle" % k, 0.0)
			j.set("angular_limit_%s/upper_angle" % k, 0.0)
	var spring := float(p.hinge.get("spring", 0.0))
	if spring > 0.0 and free_axes == ["x"] and not ball:
		j.set("angular_spring_x/enabled", true)
		j.set("angular_spring_x/stiffness", spring)
		j.set("angular_spring_x/damping", float(p.hinge.get("damper", 0.0)))
		j.set("angular_spring_x/equilibrium_point", -float(p.hinge.get("rest", 0.0)))
	car.get_parent().add_child(j)
	j.global_transform = Transform3D(xf.basis * frame, xf * origin)
	j.node_a = j.get_path_to(_anchor())
	j.node_b = j.get_path_to(p.body)
	p.joint = j


func _anchor() -> AnimatableBody3D:
	if anchor == null or not is_instance_valid(anchor):
		anchor = AnimatableBody3D.new()
		anchor.name = "Hinges of %s" % car.name
		anchor.sync_to_physics = false
		anchor.collision_layer = 0
		anchor.collision_mask = 0
		car.get_parent().add_child(anchor)
		anchor.global_transform = car.global_transform
	return anchor


static func _basis_x(axis: Vector3) -> Basis:
	var x := axis.normalized()
	var t := Vector3.UP if absf(x.y) < 0.9 else Vector3.RIGHT
	var z := x.cross(t).normalized()
	var y := z.cross(x)
	return Basis(x, y, z)


## A part breaks: it is gone at once (hidden, its own nodes out of the shell, what rides on it falls), and its pieces
## fly off with the speed that the car has at their place and a little more outward and up, turning; the particles
## with them (Shatter).
func _break(p: Part) -> void:
	if p.state == "broken":
		return
	for ch in p.children:
		if ch.state == "held":
			_come_off(ch)
	var meshes := _shatter_meshes(p)
	var riding := _riding(p)
	p.state = "broken"
	p.timer = -1.0
	if p.joint != null:
		p.joint.queue_free()
		p.joint = null
	if p.group != "" and car.shell != null:
		car.shell.sb.detach_group(p.group)
	_hide(p)
	if p.body != null:
		p.body.queue_free()
		p.body = null
	_event(p, "broken")
	var fx := Shatter.of(car)
	if fx == null:
		return
	var info := p.shatter
	var looks: Array = [] if info.get("how", "faces") == "none" else Shatter.pieces_of(meshes, int(info.get("max", 40)), info.get("how") == "mesh")
	var xf := car.global_transform
	var mid := Vector3.ZERO
	var box := AABB()
	for i in looks.size():
		var look: Dictionary = looks[i]
		var at: Vector3 = look["centre"]
		box = AABB(at, Vector3.ZERO) if i == 0 else box.expand(at)
		var v := _point_velocity(xf.affine_inverse() * at)
		var out := Vector3(at.x - xf.origin.x, 0.0, at.z - xf.origin.z)
		out = (out.normalized() if out.length() > 1e-3 else Vector3.RIGHT) * (0.6 + randf() * 1.6)
		v += Vector3(out.x + (randf() - 0.5) * 0.8, 0.4 + randf() * 1.4, out.z + (randf() - 0.5) * 0.8)
		var spin := Vector3(randf() - 0.5, randf() - 0.5, randf() - 0.5).normalized() * (3.0 + randf() * 9.0)
		fx.piece(look, v, spin)
	if int(info.get("particles", 0)) > 0:
		mid = box.get_center() if not looks.is_empty() else (xf * p.centre if not riding else p.object.global_position)
		var extent := maxf(box.size.x, maxf(box.size.y, box.size.z)) if not looks.is_empty() else p.size.length()
		fx.burst(mid, _point_velocity(xf.affine_inverse() * mid), int(info["particles"]), int(info["shape"]), info["colour"], float(info["size"]),
			maxf(0.05, extent * 0.4))


## The meshes that a part breaks into, as Shatter takes them ({xf, mesh, mats}): its _broken object (shatter "mesh"),
## or its own meshes as they are now (the copies that ride on a body, the bent meshes on the car, or the object).
func _shatter_meshes(p: Part) -> Array:
	var out: Array = []
	if p.shatter.get("how") == "mesh":
		var broken := car.model_root.find_child(p.name + "_broken", true, false) as Node3D
		if broken != null:
			var list: Array = broken.find_children("*", "MeshInstance3D", true, false)
			if broken is MeshInstance3D:
				list.append(broken)
			for m in list:
				if (m as MeshInstance3D).mesh != null:
					out.append(_entry(m, (m as MeshInstance3D).mesh, m.global_transform))
			if not out.is_empty():
				return out
		p.shatter["how"] = "faces"
	var skip := p.children.map(func(c: Part) -> Node: return c.object)
	var not_child := func(n: Node) -> bool: return not skip.any(func(o: Node) -> bool: return o == n or o.is_ancestor_of(n))
	for m in p.copies:
		if is_instance_valid(m) and not _belongs_to_child(m, p):
			out.append(_entry(m, m.mesh, m.global_transform))
	if not out.is_empty():
		return out
	if car.shell_mesh != null and car.shell_mesh.ready:
		for bent in car.shell_mesh.meshes:
			var node: Node = car.shell_mesh.source_of[bent]["node"]
			if is_instance_valid(node) and (node == p.object or p.object.is_ancestor_of(node)) and bent.visible and not_child.call(node):
				out.append(_entry(bent, _baked(bent), car.global_transform))
	if out.is_empty():
		var list: Array = p.object.find_children("*", "MeshInstance3D", true, false)
		if p.object is MeshInstance3D:
			list.append(p.object)
		for m in list:
			var mi := m as MeshInstance3D
			if mi.mesh != null and mi.is_visible_in_tree() and not_child.call(mi):
				out.append(_entry(mi, mi.mesh, mi.global_transform))
	return out


static func _entry(mi: MeshInstance3D, mesh: Mesh, xf: Transform3D) -> Dictionary:
	var mats: Array = []
	for si in mesh.get_surface_count():
		var mat: Material = mi.material_override
		if mat == null and si < mi.get_surface_override_material_count():
			mat = mi.get_surface_override_material(si)
		if mat == null:
			mat = mesh.surface_get_material(si)
		mats.append(mat)
	return {"xf": xf, "mesh": mesh, "mats": mats}


func _hide(p: Part) -> void:
	var m := car.shell_mesh
	if m != null and m.ready:
		for bent in m.meshes:
			var node: Node = m.source_of[bent]["node"]
			if is_instance_valid(node) and (node == p.object or p.object.is_ancestor_of(node)) and bent.visible:
				bent.visible = false
				p.hidden.append(bent)
	for c in p.copies:
		if is_instance_valid(c) and c.visible:
			c.visible = false
			p.hidden.append(c)
	if p.object.visible:
		p.object.visible = false
		p.hidden.append(p.object)


## A loose part is damped and has a top speed (its spin, and its speed against the car).
func _limit_speeds() -> void:
	var car_speed := car.linear_velocity.length()
	for p in parts:
		if p.state in ["held", "broken"] or p.body == null or not is_instance_valid(p.body):
			continue
		var max_spin := float(p.spec.get("max_spin", MAX_SPIN_HINGED if p.state == "hinged" else MAX_SPIN_FREE))
		if p.body.angular_velocity.length() > max_spin:
			p.body.angular_velocity = p.body.angular_velocity.normalized() * max_spin
		var max_lin := car_speed + EXTRA_SPEED + (0.0 if p.state == "hinged" else 20.0)
		if p.body.linear_velocity.length() > max_lin:
			p.body.linear_velocity = p.body.linear_velocity.normalized() * max_lin


## A part breaks or comes loose now (Parts.js breakLoose: Break it now of the car editor): false when it is off already.
func break_loose(p: Part) -> bool:
	if p == null or p.state in ["free", "broken"]:
		return false
	if p.mode == "breakable":
		_break(p)
		return true
	for m in p.mounts:
		m.alive = false
	_start(p, "free")
	return true


## A hit on a part from outside (Parts.js hit: Apply force of the car editor): along dir (a unit vector in the world,
## into the part), with an impulse (N s) and the force it is over the time of the hit (N). A part that is off the car
## gets the impulse on its body; a hinge opens past its latch or the "opens at" force of a pin, tears at its break
## force or at the break force of a pin; a part on the car (a breakable one) comes off at its break force. Gives what
## happened: "held", "opened", "off", "broke", "tore off", "pushed" or "none".
func hit(p: Part, dir: Vector3, impulse: float, force: float) -> String:
	if p == null or p.state == "broken":
		return "none"
	var result := "pushed"
	if p.state == "held":
		if p.mode == "hinge":
			var open := INF
			for m in p.mounts:
				if m.alive and m.activate > 0.0:
					open = minf(open, m.activate)
			if is_inf(open):
				open = float(p.hinge.get("latch", INF))
			if not (force > open):
				return "held"
			_start(p, "hinge")
			result = "opened"
		else:
			if p.break_force > 0.0 and force > p.break_force:
				_come_off(p)
				return "broke" if p.mode == "breakable" else "off"
			return "held"
	if p.state == "hinged":
		var alive := p.mounts.filter(func(m: Mount) -> bool: return m.alive)
		var torn := alive.filter(func(m: Mount) -> bool: return m.break_force > 0.0 and force / maxf(1.0, alive.size()) > m.break_force)
		for m: Mount in torn:
			m.alive = false
		var hb := float(p.hinge.get("break_force", 0.0))
		if hb > 0.0 and force > hb:
			_start(p, "free")
			result = "tore off"
		elif not torn.is_empty():
			_event(p, "mount torn")
			if p.mounts.any(func(m: Mount) -> bool: return m.alive):
				_join(p)
			else:
				_start(p, "free")
				result = "tore off"
	if p.body != null and is_instance_valid(p.body) and p.state in ["hinged", "free"]:
		p.body.apply_central_impulse(dir.normalized() * impulse)
	return result


func part_named(object_name: String) -> Part:
	for p in parts:
		if p.name == object_name:
			return p
	return null


## Every part back in its place, whole.
func repair() -> void:
	for p in parts:
		if p.joint != null and is_instance_valid(p.joint):
			p.joint.queue_free()
		p.joint = null
		if p.body != null and is_instance_valid(p.body):
			if p.object.get_parent() == p.body:
				p.body.remove_child(p.object)
				p.home_parent.add_child(p.object)
				p.object.transform = p.home_xf
			p.body.queue_free()
		p.body = null
		for c in p.copies:
			if is_instance_valid(c) and not c.is_queued_for_deletion():
				c.queue_free()
		p.copies.clear()
		for h in p.hidden:
			if is_instance_valid(h) and not (h is MeshInstance3D and p.copies.has(h)):
				h.visible = true
		p.hidden.clear()
		for m in p.mounts:
			m.alive = true
		p.state = "held"
		p.timer = -1.0
		p.open_timer = -1.0
		p.detach_timer = -1.0
		p.has_v = false
		p.acc = 0.0
		p.load = 0.0
		p.inertia = 0.0
		p.wall_force = 0.0
		p.pending = false
	_settle = 60


## The parts that came off and lie about (the car is going away).
func dispose() -> void:
	if anchor != null and is_instance_valid(anchor):
		anchor.queue_free()
	anchor = null
	for p in parts:
		if p.joint != null and is_instance_valid(p.joint):
			p.joint.queue_free()
		p.joint = null
		if p.body != null and is_instance_valid(p.body):
			p.body.queue_free()
			p.body = null


## The meshes of a part on the car (the ones that bend with the shell, or the object itself while the model does not
## bend), for the replay.
func meshes_on_car(p: Part) -> Array[Node3D]:
	var out: Array[Node3D] = []
	var m := car.shell_mesh
	if m != null and m.ready:
		for bent in m.meshes:
			var node: Node = m.source_of[bent]["node"]
			if is_instance_valid(node) and (node == p.object or p.object.is_ancestor_of(node)):
				out.append(bent)
	if out.is_empty() and p.object.get_parent() == p.home_parent:
		out.append(p.object)
	return out


## Where what is seen of a part that is off is (the transform that puts its meshes, made in the frame of the car, in
## the world), for the replay.
func seen_at(p: Part) -> Transform3D:
	if p.body == null or not is_instance_valid(p.body):
		return car.global_transform
	if p.object.get_parent() == p.body:
		return p.object.global_transform * p.home_rel.affine_inverse()
	return p.body.global_transform * Transform3D(Basis.IDENTITY, -p.offset)


## A copy of what is seen of a part, in the frame of the car, with the dent of disp (the replay).
func copy_of(p: Part, disp: PackedVector3Array) -> Node3D:
	var holder := Node3D.new()
	var m := car.shell_mesh
	if m != null and m.ready and disp.size() == car.shell.sb.count:
		for bent in meshes_on_car(p):
			if not (bent is MeshInstance3D) or not m.meshes.has(bent):
				continue
			var copy := MeshInstance3D.new()
			copy.mesh = _baked(bent, disp)
			copy.material_override = (bent as MeshInstance3D).material_override
			for si in copy.mesh.get_surface_count():
				copy.set_surface_override_material(si, (bent as MeshInstance3D).get_surface_override_material(si))
			holder.add_child(copy)
	if holder.get_child_count() == 0:
		var dup := p.object.duplicate() as Node3D
		holder.add_child(dup)
		dup.transform = p.home_rel
		dup.visible = true
	return holder


func count_off() -> int:
	var n := 0
	for p in parts:
		if p.state != "held":
			n += 1
	return n
