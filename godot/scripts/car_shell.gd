class_name CarShell
extends RefCounted
## The shell of a car (SoftBody) in the physics of the car (the soft body parts of web/js/Vehicle.js): its nodes
## meet the walls of the track and the nodes of the other cars, the force of a hit goes to the node (a stiff
## penalty spring with a damper and friction, where the node is now, bent or not), and the rigid body feels it
## through the anchors (SoftBody.reaction_force), so the peak of a hit is limited by what yields.
##
## The road under the car is not the business of the nodes (the wheels and the box of the body take it), nor is a
## wall lower than the kerb height above the underside of the car (it is driven over).

const KERB_HEIGHT := 0.3
const TRI_MARGIN := 0.2             # m: a node moves a few centimetres in a step; the triangles it can touch in it

static var shells: Array[CarShell] = []    # the cars with a shell, for the hits between cars

var car: Car
var sb: SoftBody
var walls: WallGrid = null
var floor_y := -0.2                 # the underside of the car in its frame
var bound := 1.0                    # m from the origin of the frame to the farthest edge of a node
var hit := 0.0                      # the biggest force on a node in the last step (N)
var car_contacts := 0
var steps := 0                      # the steps of the shell that were worked out (not quiet)
var step_usec := 0                  # the time of the last of them
# the state of the car in this step (also what the other cars read)
var xf := Transform3D.IDENTITY
var lin_v := Vector3.ZERO
var ang_v := Vector3.ZERO
var com_w := Vector3.ZERO

var _cand := PackedInt32Array()
var _cand_at := Vector3(1e9, 1e9, 1e9)
var _node_tris: Array[PackedInt32Array] = []
var _active := PackedInt32Array()
var _pairs: Array[PackedInt32Array] = []
var _other_p := PackedVector3Array()
var _other_v := PackedVector3Array()
var _other_r := PackedFloat64Array()
var _pair_count := 0
var _logged := 0.0


## Makes the shell of a car; sb stays null when the car has too few nodes.
func _init(c: Car) -> void:
	car = c
	var cfg: Dictionary = car.config.get("softbody", {})
	var spheres := CollisionProxy.spheres_of(car)
	if spheres.size() < 3:
		return
	sb = SoftBody.new(spheres, cfg, car.mass)
	floor_y = float(car.get_meta("floor_y", floor_y))
	for k in sb.count:
		bound = maxf(bound, sb.position(k).length() + sb.radius[k])
		_node_tris.append(PackedInt32Array())
		_pairs.append(PackedInt32Array())
	shells.append(self)


func dispose() -> void:
	shells.erase(self)


func repair() -> void:
	sb.repair()
	_logged = 0.0


## One step of the physics: the contacts of the nodes in the small steps of the shell, and the reaction of the
## anchors on the body.
func step(state: PhysicsDirectBodyState3D) -> void:
	var dt := state.step
	xf = state.transform
	lin_v = state.linear_velocity
	ang_v = state.angular_velocity
	com_w = xf.origin + state.center_of_mass
	hit = 0.0
	car_contacts = 0
	if walls == null:
		var track := car.get_tree().get_first_node_in_group("track") if car.is_inside_tree() else null
		if track != null and track.has_method("walls"):
			walls = track.walls()
	if walls != null and xf.origin.distance_squared_to(_cand_at) > 0.64:
		_cand_at = xf.origin
		_cand = _walls_near()
	_build_pairs()
	var touching := _build_node_tris()
	if sb.quiet and not touching:
		return
	var t0 := Time.get_ticks_usec()
	sb.step(dt, _contacts)
	step_usec = Time.get_ticks_usec() - t0
	steps += 1
	if sb.quiet and sb.absorbed > _logged + 200.0:
		# (a hit is over: in the log of the run)
		_logged = sb.absorbed
		var st := sb.stats()
		RunLog.event("dent %s: bend %.1f cm, %.1f kJ taken up, %d anchors and %d beams torn" % [car.name, st["max_bend"] * 100.0,
			st["absorbed"] / 1000.0, st["torn_anchors"], st["torn_beams"]])
	var f := xf.basis * sb.reaction_force
	var t := xf.basis * (sb.reaction_torque - car.center_of_mass.cross(sb.reaction_force))
	state.apply_central_force(f)
	state.apply_torque(t)


## The walls near the car (within its reach, and that much more again for the next few steps), without the ones
## that are lower than the kerb height above its underside.
func _walls_near() -> PackedInt32Array:
	var out := PackedInt32Array()
	var up := xf.basis.y
	var under := xf.origin + up * floor_y
	for t in walls.near(xf.origin, bound + 1.5):
		var top := maxf((walls.a[t] - under).dot(up), maxf((walls.b[t] - under).dot(up), (walls.c[t] - under).dot(up)))
		if top >= KERB_HEIGHT:
			out.append(t)
	return out


## For every node the walls it can touch in this step; true when any node can touch something.
func _build_node_tris() -> bool:
	var any := false
	var close := PackedInt32Array()
	for t in _cand:
		if walls.box_near(t, xf.origin, bound + TRI_MARGIN):
			close.append(t)
	_active.clear()
	for k in sb.count:
		var list := PackedInt32Array()
		if sb.anchor_alive[k] == 1 and not close.is_empty():
			var p := xf * sb.position(k)
			var reach := sb.radius[k] + TRI_MARGIN
			for t in close:
				# (near the box of the triangle and its plane: a long wall has a box that takes in the road)
				if walls.box_near(t, p, reach) and absf((p - walls.a[t]).dot(walls.normal[t])) < reach:
					list.append(t)
		_node_tris[k] = list
		if not list.is_empty() or not _pairs[k].is_empty():
			_active.append(k)
			any = true
	return any


## The nodes of the other cars that are near (where they are now, bent or not, with their speed), and for every node
## of this car the ones it can touch in this step. Both cars do the same sum for their own nodes against the other,
## so the forces are equal and opposite without one car handing a force to the other.
func _build_pairs() -> void:
	_other_p.clear()
	_other_v.clear()
	_other_r.clear()
	for k in sb.count:
		if not _pairs[k].is_empty():
			_pairs[k] = PackedInt32Array()
	_pair_count = 0
	for o in shells:
		if o == self or o.sb == null or not is_instance_valid(o.car) or not o.car.is_inside_tree() or o.car.freeze:
			continue
		var reach := bound + o.bound + 0.6
		if o.xf.origin.distance_squared_to(xf.origin) > reach * reach:
			continue
		for j in o.sb.count:
			if o.sb.anchor_alive[j] == 0:
				continue
			var p := o.xf * o.sb.position(j)
			var r: float = o.sb.radius[j]
			if p.distance_to(xf.origin) > bound + r + 0.3:
				continue
			_other_p.append(p)
			_other_v.append(o.lin_v + o.ang_v.cross(p - o.com_w) + o.xf.basis * o.sb.w[j])
			_other_r.append(r)
	if _other_p.is_empty():
		return
	for k in sb.count:
		if sb.anchor_alive[k] == 0:
			continue
		var p := xf * sb.position(k)
		var rk: float = sb.radius[k] + 0.25
		var list := PackedInt32Array()
		for g in _other_p.size():
			var rr := rk + _other_r[g]
			if p.distance_squared_to(_other_p[g]) < rr * rr:
				list.append(g)
		if not list.is_empty():
			_pairs[k] = list
			_pair_count += list.size()


## The forces of the walls and the other cars on the nodes, in a small step of h seconds (into sb.force, frame).
func _contacts(h: float) -> void:
	var basis := xf.basis
	var up := basis.y
	var inv := basis.transposed()
	for k in _active:
		if sb.anchor_alive[k] == 0:
			continue
		var local := sb.position(k)
		var p := xf * local
		var r: float = sb.radius[k]
		var m: float = sb.mass[k]
		var vel := lin_v + ang_v.cross(p - com_w) + basis * sb.w[k]
		var fsum := Vector3.ZERO
		for t in _node_tris[k]:
			var res := walls.closest(t, p)
			var near_p: Vector3 = res[0]
			var dv := p - near_p
			var d2 := dv.length_squared()
			if d2 >= r * r:
				continue
			var dist := sqrt(d2)
			var n: Vector3 = dv / dist if dist > 1e-5 else walls.normal[t]
			var depth := r - dist
			if depth < 1e-4:
				continue
			if int(res[1]) != 0 and absf(n.dot(walls.normal[t])) < 0.85:
				continue                # the seam between two triangles of a surface: the neighbour has the contact
			if n.y >= 0.5 or n.dot(up) >= 0.5:
				continue                # a surface that the car rides on: the springs of the body
			fsum += _spring(n, depth, vel, sb.contact_k, m, h, 1)
		var pairs := _pairs[k]
		if not pairs.is_empty():
			var over := PackedInt32Array()
			for g in pairs:
				var rr := r + _other_r[g]
				if p.distance_squared_to(_other_p[g]) < rr * rr:
					over.append(g)
			if not over.is_empty():
				# the node has one stiffness: it is shared over the spheres that it touches
				var kc := sb.contact_k / over.size()
				for g in over:
					var e := p - _other_p[g]
					var dist := e.length()
					var n := e / dist if dist > 1e-5 else Vector3.UP
					fsum += _spring(n, r + _other_r[g] - dist, vel - _other_v[g], kc, m, h, over.size())
				car_contacts += over.size()
		if fsum != Vector3.ZERO:
			sb.force[k] += inv * fsum


## A penalty spring with a damper along n and friction across it, from the speed vel of the node against the other
## side (world).
func _spring(n: Vector3, depth: float, vel: Vector3, kc: float, m: float, h: float, shared: int) -> Vector3:
	var vn := vel.dot(n)
	var cc := 2.0 * sb.contact_damping * sqrt(kc * m)
	var fn := maxf(0.0, kc * depth - cc * vn)
	if fn > hit:
		hit = fn
	var tv := vel - n * vn
	var tl := tv.length()
	var out := n * fn
	if tl > 1e-6:
		out -= tv / tl * minf(sb.friction * fn, tl * m / h / shared)
	return out
