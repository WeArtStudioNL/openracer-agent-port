class_name SoftBody
extends RefCounted
## The shell of a car: a skeleton of nodes and beams in the frame of the car that dents (web/js/SoftBody.js, see
## SOFTBODY.md in the root of the repository).
##
## A node sits where a collision sphere of the car is (CollisionProxy). It is held to the frame of the car by an
## anchor, a spring that is elastic up to a yield force and then bends for good (the shape stays), and that tears
## off at its break force. Nodes that are near each other are joined by beams, with the same three: a spring, a
## yield force and a break force. Hits act on the nodes (CarShell finds them with the walls of the track and the
## other cars), and the rigid body of the car feels them through the anchors, so the peak of a hit is as high as
## what yields, and the energy of a crash goes into the bending.
##
## The frame is the space of the body of the car in Godot (x to the left, y up, z forward, the origin at the height
## of the axles, midway between them). Strengths in newtons, stiffnesses in N/m; every default can be set per car
## (car.json "softbody") and per node and beam. The suspension of every wheel is in the shell too (the rig, made by
## WheelRig: a hub, a knuckle and the pivots of the arms, joined by beams that bend and tear); its stiff beams and
## anchors are solved by position (XPBD, rigSolve of SoftBody.js), the rest explicitly. Not ported: the plate and the
## node grabber of the car editor, the copy for a physics worker.

const RIG_ITERS := 6               # the passes of the position solver over the suspension

var shell_mass := 300.0         # kg that the nodes share
var anchor_k := 8.0e5
var anchor_yield := 80000.0
var anchor_break := 250000.0
var anchor_damping := 0.6
var anchor_max_bend := 0.35     # m bent for good: the node is crushed solid
var beam_break_strain := 0.4    # stretched for good by this share of its length: the beam snaps
var beam_k := 4.0e5
var beam_yield := 40000.0
var beam_break := 120000.0
var beam_damping := 0.15
var hardening := 0.2            # how much the force goes on rising after the yield
var contact_k := 1.5e6
var contact_damping := 0.7
var friction := 0.5
var neighbours := 5
var reach := 1.1                # beams are not longer than this (m)

var count := 0
var part_of := PackedStringArray()     # the part (car.json "parts") a node belongs to, "" for the body
var is_rig := PackedByteArray()        # a node of the suspension (they come last: body_count is the number of the others)
var body_count := 0                    # the nodes of the car itself: the model and the parts only know these
var a_scale := PackedFloat64Array()    # the stiffness of the anchor of a node as a factor (a hub is held by its arms)
var rest := PackedVector3Array()       # where the node is when the car is whole
var radius := PackedFloat64Array()
var mass := PackedFloat64Array()
var u := PackedVector3Array()          # the elastic displacement
var w := PackedVector3Array()          # its speed
var q := PackedVector3Array()          # the bend that stays
var force := PackedVector3Array()      # the force on the nodes in one small step (the contacts add theirs here)
var node_yield := PackedFloat64Array()
var node_break := PackedFloat64Array()
var anchor_alive := PackedByteArray()
var gone := PackedByteArray()          # a node held by nothing any more (or of a part that came off): not simulated
var beam_a := PackedInt32Array()
var beam_b := PackedInt32Array()
var beam_rest := PackedFloat64Array()
var beam_made := PackedFloat64Array()
var beam_k_of := PackedFloat64Array()
var beam_yield_of := PackedFloat64Array()
var beam_break_of := PackedFloat64Array()
var beam_alive := PackedByteArray()
var beam_rig := PackedByteArray()      # a beam of the suspension: the position solver has it, not the explicit loop
var beam_count := 0

var displacement := PackedVector3Array()   # u + q of every node, for the model
var version := 0                       # goes up when a node moved, so the model is only updated then
var absorbed := 0.0                    # the energy that went into bending (J)
var quiet := true                      # nothing moves and nothing is pulled: a step can be left out
var reaction_force := Vector3.ZERO     # what the anchors pull on the car (frame, N), the mean over the last step
var reaction_torque := Vector3.ZERO    # and its torque about the origin of the frame (N m)
var min_steps := 3
var max_steps := 16
var safe_h := 0.001
var steps_used := 0
var blew_up := 0

var _good_u := PackedVector3Array()
var _good_q := PackedVector3Array()
var _repair_from: Array = []           # [u, q] when a repair that takes time began (the pit stop)
# the position solver of the suspension: per wheel its nodes and beams (a rig is joined to nothing else, so a wheel
# that nothing touches is left out)
var _rig_groups: Array = []            # [{nodes: PackedInt32Array, beams: PackedInt32Array}]
var _rig_old := PackedVector3Array()
var _rig_lam_a := PackedFloat64Array()
var _rig_lam_b := PackedFloat64Array()
var _rig_speed2 := 0.0


## spheres: [{x, y, z, r, part}] in the frame of the car; cfg: car.json "softbody"; car_mass in kg.
func _init(spheres: Array, cfg: Dictionary, car_mass: float) -> void:
	var a_cfg: Dictionary = cfg.get("anchor", {})
	var b_cfg: Dictionary = cfg.get("beam", {})
	var c_cfg: Dictionary = cfg.get("contact", {})
	shell_mass = float(cfg.get("shell_mass", minf(400.0, 0.2 * car_mass)))
	anchor_k = float(a_cfg.get("stiffness", anchor_k))
	anchor_yield = float(a_cfg.get("yield_force", anchor_yield))
	anchor_break = float(a_cfg.get("break_force", anchor_break))
	anchor_damping = float(a_cfg.get("damping", anchor_damping))
	anchor_max_bend = float(a_cfg.get("max_bend", anchor_max_bend))
	beam_break_strain = float(b_cfg.get("break_strain", beam_break_strain))
	beam_k = float(b_cfg.get("stiffness", beam_k))
	beam_yield = float(b_cfg.get("yield_force", beam_yield))
	beam_break = float(b_cfg.get("break_force", beam_break))
	beam_damping = float(b_cfg.get("damping", beam_damping))
	hardening = float(cfg.get("hardening", hardening))
	contact_k = float(c_cfg.get("stiffness", contact_k))
	contact_damping = float(c_cfg.get("damping", contact_damping))
	friction = float(c_cfg.get("friction", friction))
	neighbours = int(cfg.get("neighbours", neighbours))
	reach = float(cfg.get("reach", reach))

	count = spheres.size()
	var n := count
	rest.resize(n)
	u.resize(n)
	w.resize(n)
	q.resize(n)
	force.resize(n)
	radius.resize(n)
	mass.resize(n)
	node_yield.resize(n)
	node_break.resize(n)
	anchor_alive.resize(n)
	gone.resize(n)
	part_of.resize(n)
	is_rig.resize(n)
	a_scale.resize(n)
	a_scale.fill(1.0)
	_rig_old.resize(n)
	_rig_lam_a.resize(n)
	displacement.resize(n)
	body_count = n
	for k in n:
		var s: Dictionary = spheres[k]
		rest[k] = Vector3(float(s["x"]), float(s["y"]), float(s["z"]))
		radius[k] = float(s["r"])
		part_of[k] = str(s.get("part", ""))
		is_rig[k] = 1 if s.get("rig", false) else 0
		if is_rig[k] == 1 and body_count == n:
			body_count = k
		mass[k] = maxf(2.0, shell_mass / n)
		node_yield[k] = anchor_yield
		node_break[k] = anchor_break
	for o in cfg.get("nodes", []):
		if not (o is Dictionary) or not o.has("i"):
			continue
		var i := int(o["i"])
		if i < 0 or i >= n:
			continue
		node_yield[i] = float(o.get("yield_force", node_yield[i]))
		node_break[i] = float(o.get("break_force", node_break[i]))
		if o.has("mass"):
			mass[i] = maxf(0.5, float(o["mass"]))

	# the beams: those of the model (an object "beams"), or every node to its nearest neighbours
	var seen := {}
	var explicit: Array = cfg.get("explicit_beams", [])
	for e in explicit:
		var lo := mini(int(e[0]), int(e[1]))
		var hi := maxi(int(e[0]), int(e[1]))
		if lo == hi or hi >= n or seen.has(lo * 4096 + hi) or is_rig[lo] == 1 or is_rig[hi] == 1:
			continue
		var d := rest[lo].distance_to(rest[hi])
		if d < 0.01:
			continue
		seen[lo * 4096 + hi] = true
		_add_beam(lo, hi, d, beam_k, beam_yield, beam_break)
	if explicit.is_empty():
		for a in n:
			var near := []
			var pa := rest[a]
			if is_rig[a] == 1:
				continue
			for b in n:
				if a == b or part_of[a] != part_of[b] or is_rig[b] == 1:
					continue
				var d := pa.distance_to(rest[b])
				if d < reach and d > 0.02:
					near.append([d, b])
			near.sort_custom(func(x: Array, y: Array) -> bool: return x[0] < y[0])
			for m in mini(neighbours, near.size()):
				var lo := mini(a, int(near[m][1]))
				var hi := maxi(a, int(near[m][1]))
				if seen.has(lo * 4096 + hi):
					continue
				seen[lo * 4096 + hi] = true
				_add_beam(lo, hi, float(near[m][0]), beam_k, beam_yield, beam_break)
	for o in cfg.get("beams", []):
		if not (o is Dictionary):
			continue
		for i in beam_count:
			if (beam_a[i] == int(o.get("a", -1)) and beam_b[i] == int(o.get("b", -1))) or (beam_a[i] == int(o.get("b", -1)) and beam_b[i] == int(o.get("a", -1))):
				beam_k_of[i] = float(o.get("stiffness", beam_k_of[i]))
				beam_yield_of[i] = float(o.get("yield_force", beam_yield_of[i]))
				beam_break_of[i] = float(o.get("break_force", beam_break_of[i]))
	_safe_step()
	_group_rigs()
	repair()


func _add_beam(a: int, b: int, d: float, k: float, y: float, br: float) -> void:
	beam_a.append(a)
	beam_b.append(b)
	beam_rest.append(d)
	beam_made.append(d)
	beam_k_of.append(k)
	beam_yield_of.append(y)
	beam_break_of.append(br)
	beam_alive.append(1)
	beam_rig.append(1 if is_rig[a] == 1 or is_rig[b] == 1 else 0)
	_rig_lam_b.append(0.0)
	beam_count = beam_a.size()


## A beam that is added afterwards (the link of a mount of a part, the arms of the suspension): its index. params:
## {stiffness, yield_force, break_force} (N/m, N).
func add_beam(a: int, b: int, params := {}) -> int:
	for i in beam_count:
		if (beam_a[i] == a and beam_b[i] == b) or (beam_a[i] == b and beam_b[i] == a):
			return i
	_add_beam(mini(a, b), maxi(a, b), rest[a].distance_to(rest[b]), float(params.get("stiffness", beam_k)),
		float(params.get("yield_force", beam_yield)), float(params.get("break_force", beam_break)))
	_safe_step()
	_group_rigs()
	return beam_count - 1


## The strength and the mass of a node afterwards (the hub of a wheel): {yield, break (N, of its anchor), mass (kg),
## anchor_scale, release (its anchor is gone: it is held by its beams only)}.
func set_node(k: int, o: Dictionary) -> void:
	if o.has("yield"):
		node_yield[k] = float(o["yield"])
	if o.has("break"):
		node_break[k] = float(o["break"])
	if o.has("mass"):
		mass[k] = maxf(0.5, float(o["mass"]))
	if o.has("anchor_scale"):
		a_scale[k] = float(o["anchor_scale"])
	if o.get("release", false):
		anchor_alive[k] = 0
		quiet = false
	_safe_step()


## The force in a beam now (N, along it: positive when it is stretched), for the load on a link of a part.
func beam_force(i: int) -> float:
	if beam_alive[i] == 0 or gone[beam_a[i]] == 1 or gone[beam_b[i]] == 1:
		return 0.0
	return beam_k_of[i] * (position(beam_b[i]).distance_to(position(beam_a[i])) - beam_rest[i])


## The rigs of the wheels as groups: the nodes that the beams of the suspension join (a union of their ends).
func _group_rigs() -> void:
	var root := {}
	var find := func(k: int) -> int:
		while int(root.get(k, k)) != k:
			k = int(root[k])
		return k
	for i in beam_count:
		if beam_rig[i] == 1:
			var ra: int = find.call(beam_a[i])
			var rb: int = find.call(beam_b[i])
			if ra != rb:
				root[ra] = rb
	var by_root := {}
	for i in beam_count:
		if beam_rig[i] == 0:
			continue
		var r: int = find.call(beam_a[i])
		if not by_root.has(r):
			by_root[r] = {"nodes": PackedInt32Array(), "beams": PackedInt32Array()}
		var g: Dictionary = by_root[r]
		g["beams"].append(i)
		for k in [beam_a[i], beam_b[i]]:
			if is_rig[k] == 1 and not (g["nodes"] as PackedInt32Array).has(k):
				g["nodes"].append(k)
	_rig_groups = by_root.values()


## The biggest step with which the nodes stay stable (safeStep of SoftBody.js): for every node the stiffness of its
## anchor, its contacts and twice that of its beams, and the same for the dampers.
func _safe_step() -> void:
	var k_sum := PackedFloat64Array()
	var c_sum := PackedFloat64Array()
	k_sum.resize(count)
	c_sum.resize(count)
	for k in count:
		# (the anchors and the beams of the suspension are solved by position: they do not limit the step)
		var ka := 0.0 if is_rig[k] == 1 else anchor_k * a_scale[k]
		k_sum[k] = ka + contact_k
		c_sum[k] = 2.0 * anchor_damping * sqrt(ka * mass[k]) + 2.0 * contact_damping * sqrt(contact_k * mass[k])
	for i in beam_count:
		if beam_rig[i] == 1:
			continue
		var a := beam_a[i]
		var b := beam_b[i]
		var cb := 2.0 * beam_damping * sqrt(beam_k_of[i] * minf(mass[a], mass[b]))
		k_sum[a] += 2.0 * beam_k_of[i]
		k_sum[b] += 2.0 * beam_k_of[i]
		c_sum[a] += 2.0 * cb
		c_sum[b] += 2.0 * cb
	var h := 1.0
	for j in count:
		h = minf(h, minf(0.9 / sqrt(k_sum[j] / mass[j]), 0.6 * mass[j] / c_sum[j]))
	safe_h = h


## Where the node is now, in the frame of the car.
func position(k: int) -> Vector3:
	return rest[k] + u[k] + q[k]


func alive(k: int) -> bool:
	return anchor_alive[k] == 1


func bend_of(k: int) -> float:
	return q[k].length()


## How bent the car is: the biggest permanent displacement (m), the biggest elastic one, the anchors and beams that
## are gone, the energy taken up.
func stats() -> Dictionary:
	var max_q := 0.0
	var max_u := 0.0
	var anchors := 0
	var beams := 0
	for k in count:
		max_q = maxf(max_q, q[k].length())
		max_u = maxf(max_u, u[k].length())
		if anchor_alive[k] == 0 and gone[k] == 0:
			anchors += 1
	for i in beam_count:
		if beam_alive[i] == 0:
			beams += 1
	return {"nodes": count, "beams": beam_count, "max_bend": max_q, "max_elastic": max_u, "torn_anchors": anchors,
		"torn_beams": beams, "absorbed": absorbed}


## The car is whole again.
func repair() -> void:
	_repair_from = []
	u.fill(Vector3.ZERO)
	w.fill(Vector3.ZERO)
	q.fill(Vector3.ZERO)
	force.fill(Vector3.ZERO)
	anchor_alive.fill(1)
	gone.fill(0)
	beam_alive.fill(1)
	for j in beam_count:
		beam_rest[j] = rest[beam_a[j]].distance_to(rest[beam_b[j]])
	absorbed = 0.0
	displacement.fill(Vector3.ZERO)
	quiet = true
	version += 1


## The car is put somewhere else and stands still: the movement of the nodes stops, the shape stays as it is.
func settle() -> void:
	w.fill(Vector3.ZERO)
	force.fill(Vector3.ZERO)
	_sync_displacement()


## The nodes of a part that came off leave the shell (they keep their bend: the model of the part keeps its dents).
func detach_group(group: String) -> void:
	for k in count:
		if part_of[k] == group:
			gone[k] = 1
			anchor_alive[k] = 0
			w[k] = Vector3.ZERO
	version += 1


func _sync_displacement() -> void:
	for k in count:
		displacement[k] = u[k] + q[k]
	version += 1


## A node that is held by nothing any more (its anchor torn and its beams snapped) stays where it is.
func _loose(k: int) -> void:
	if anchor_alive[k] == 1 or gone[k] == 1:
		return
	for i in beam_count:
		if beam_alive[i] == 1 and ((beam_a[i] == k and gone[beam_b[i]] == 0) or (beam_b[i] == k and gone[beam_a[i]] == 0)):
			return
	gone[k] = 1
	w[k] = Vector3.ZERO


## One step of dt seconds of the nodes and the beams, in small steps; contacts (h) is called in every small step to
## add the forces of the hits to force (frame, N). Afterwards reaction_force and reaction_torque hold what the
## anchors pulled on the car. Returns false when the shell blew up (it goes back to its last good state).
##
## Breaking and crushing (as SoftBody.js): a node that is bent anchor.max_bend from where it belongs is crushed
## solid (it bends no further and its anchor takes the full force); an anchor tears at its break force, but not once
## it is crushed solid; a beam snaps past its break force or when it was stretched for good by more than
## beam.break_strain of its length as made (one that is pushed together crumples).
func step(dt: float, contacts: Callable) -> bool:
	var hard := hardening
	var rf := Vector3.ZERO
	var rt := Vector3.ZERO
	_good_u = u.duplicate()
	_good_q = q.duplicate()
	var moved := false
	var max_speed2 := 0.0
	var steps := clampi(ceili(dt / safe_h), min_steps, max_steps)
	steps_used = steps
	var h := dt / steps
	var share := h / dt
	_rig_speed2 = 0.0
	for s in steps:
		contacts.call(h)
		# the beams: a spring and a damper along each, with a yield (a new rest length) and a snap
		for i in beam_count:
			if beam_alive[i] == 0 or beam_rig[i] == 1:
				continue
			var na := beam_a[i]
			var nb := beam_b[i]
			if gone[na] == 1 or gone[nb] == 1:
				continue
			var e := rest[nb] + u[nb] + q[nb] - rest[na] - u[na] - q[na]
			var length := e.length()
			if length < 1e-6:
				continue
			var nrm := e / length
			var ext := length - beam_rest[i]
			var kb := beam_k_of[i]
			var fb := kb * ext
			if absf(fb) > beam_yield_of[i]:
				var change := signf(ext) * (absf(ext) - beam_yield_of[i] / kb) * (1.0 - hard)
				beam_rest[i] += change
				absorbed += beam_yield_of[i] * absf(change)
				ext = length - beam_rest[i]
				fb = kb * ext
				moved = true
			if absf(fb) > beam_break_of[i] or beam_rest[i] - beam_made[i] > beam_break_strain * beam_made[i]:
				beam_alive[i] = 0
				_loose(na)
				_loose(nb)
				moved = true
				continue
			fb += 2.0 * beam_damping * sqrt(kb * minf(mass[na], mass[nb])) * (w[nb] - w[na]).dot(nrm)
			var fv := nrm * fb
			force[na] += fv
			force[nb] -= fv
		# the anchors (elastic up to the yield, then the shape stays bent; the node stands at rest + q + u and the
		# anchor is stretched by u only), and the step of every node: semi-implicit Euler
		for k in count:
			if gone[k] == 1:
				force[k] = Vector3.ZERO
				continue
			if anchor_alive[k] == 1 and is_rig[k] == 0:
				var ka := anchor_k * a_scale[k]
				var d := u[k].length()
				var yield_d := node_yield[k] / ka
				if d > yield_d:
					var room := maxf(0.0, anchor_max_bend - q[k].length())
					var shift := u[k] * (minf((d - yield_d) * (1.0 - hard), room) / d)
					q[k] += shift
					u[k] -= shift
					absorbed += node_yield[k] * shift.length()
					d = u[k].length()
					moved = true
				var fa := u[k] * ka + w[k] * (2.0 * anchor_damping * sqrt(ka * mass[k]))
				if ka * d > node_break[k] and anchor_max_bend - q[k].length() > 1e-6:
					anchor_alive[k] = 0
					_loose(k)
					moved = true
				else:
					force[k] -= fa
					fa *= share
					rf += fa
					rt += (rest[k] + u[k] + q[k]).cross(fa)
			w[k] += force[k] * (h / mass[k])
			var sp := w[k].length_squared()
			if sp > max_speed2:
				max_speed2 = sp
			if is_rig[k] == 1:
				_rig_old[k] = u[k]
			u[k] += w[k] * h
			force[k] = Vector3.ZERO
		if not _rig_groups.is_empty():
			var r := _rig_solve(h, share)
			if r[0]:
				moved = true
			rf += r[1]
			rt += r[2]
	if not _sane() or not rf.is_finite() or not rt.is_finite():
		# a shell that blew up goes back to its last good state; when that blows up as well it is made whole
		blew_up += 1
		if blew_up > 1:
			repair()
		else:
			u = _good_u
			q = _good_q
			w.fill(Vector3.ZERO)
			force.fill(Vector3.ZERO)
			_sync_displacement()
		reaction_force = Vector3.ZERO
		reaction_torque = Vector3.ZERO
		push_warning("SoftBody: the shell blew up (%d nodes); it goes back to its last good state" % count)
		return false
	blew_up = 0
	reaction_force = rf
	reaction_torque = rt
	# (nothing yields and nothing moves: a shell that keeps a dent stands in its own balance, its anchors pull nothing on
	# the car in sum, and the steps can be left out until something hits it again. The browser game also asks for an
	# elastic stretch under 0.1 mm, which a dent keeps for good: its shell was worked out in every step after a hit)
	quiet = not moved and max_speed2 < 1e-6 and _rig_speed2 < 1e-6
	var any := moved
	if not any:
		for m in count:
			if u[m].length_squared() > 1e-8:
				any = true
				break
	if any:
		_sync_displacement()
	return true


## The suspension by position (rigSolve of SoftBody.js): its beams and the anchors of its nodes are constraints with a
## compliance of 1/k (XPBD: backward Euler for the springs, stable at any step), Gauss-Seidel over the few of a wheel;
## then the speed from the move, the dampers as an impulse that cannot overshoot, yield and break from the final
## lengths, and what the anchors pull on the car. A wheel whose rig nothing moves is left out. Returns [moved, force,
## torque] (frame, the share of this small step).
func _rig_solve(h: float, share: float) -> Array:
	var hard := hardening
	var h2 := h * h
	var moved := false
	var rf := Vector3.ZERO
	var rt := Vector3.ZERO
	for g: Dictionary in _rig_groups:
		var nodes: PackedInt32Array = g["nodes"]
		var beams: PackedInt32Array = g["beams"]
		var busy := false
		for k in nodes:
			if gone[k] == 0 and (w[k].length_squared() > 1e-12 or u[k].length_squared() > 1e-12):
				busy = true
				break
		if not busy:
			continue
		for k in nodes:
			_rig_lam_a[k] = 0.0
		for i in beams:
			_rig_lam_b[i] = 0.0
		for _it in RIG_ITERS:
			for k in nodes:
				if anchor_alive[k] == 0 or gone[k] == 1:
					continue
				var d := u[k].length()
				if d < 1e-12:
					continue
				var alpha := 1.0 / (anchor_k * a_scale[k] * h2)
				var wk := 1.0 / mass[k]
				var dl := (-d - alpha * _rig_lam_a[k]) / (wk + alpha)
				_rig_lam_a[k] += dl
				u[k] += u[k] * (wk * dl / d)
			for i in beams:
				var na := beam_a[i]
				var nb := beam_b[i]
				if beam_alive[i] == 0 or gone[na] == 1 or gone[nb] == 1:
					continue
				var e := rest[nb] + u[nb] + q[nb] - rest[na] - u[na] - q[na]
				var length := e.length()
				if length < 1e-6:
					continue
				var wa := 1.0 / mass[na]
				var wb := 1.0 / mass[nb]
				var al := 1.0 / (beam_k_of[i] * h2)
				var dlb := (beam_rest[i] - length - al * _rig_lam_b[i]) / (wa + wb + al)
				_rig_lam_b[i] += dlb
				var c := e / length * dlb
				u[na] -= c * wa
				u[nb] += c * wb
		for k in nodes:
			if gone[k] == 0:
				w[k] = (u[k] - _rig_old[k]) / h
		for i in beams:
			var na := beam_a[i]
			var nb := beam_b[i]
			if beam_alive[i] == 0 or gone[na] == 1 or gone[nb] == 1:
				continue
			var e := rest[nb] + u[nb] + q[nb] - rest[na] - u[na] - q[na]
			var l2 := e.length()
			if l2 < 1e-6:
				continue
			var n := e / l2
			var ma := mass[na]
			var mb := mass[nb]
			var rv := (w[nb] - w[na]).dot(n)
			var cb := 2.0 * beam_damping * sqrt(beam_k_of[i] * minf(ma, mb))
			var imp := rv * cb * h / (1.0 + cb * h * (1.0 / ma + 1.0 / mb))
			w[na] += n * (imp / ma)
			w[nb] -= n * (imp / mb)
			var ext := l2 - beam_rest[i]
			var fb := beam_k_of[i] * ext
			if absf(fb) > beam_yield_of[i]:
				var change := signf(ext) * (absf(ext) - beam_yield_of[i] / beam_k_of[i]) * (1.0 - hard)
				beam_rest[i] += change
				absorbed += beam_yield_of[i] * absf(change)
				fb = beam_k_of[i] * (l2 - beam_rest[i])
				moved = true
			if absf(fb) > beam_break_of[i] or beam_rest[i] - beam_made[i] > beam_break_strain * beam_made[i]:
				beam_alive[i] = 0
				_loose(na)
				_loose(nb)
				moved = true
		for k in nodes:
			if gone[k] == 1:
				continue
			if anchor_alive[k] == 0:
				_rig_speed2 = maxf(_rig_speed2, w[k].length_squared())
				continue
			var ka := anchor_k * a_scale[k]
			var c := 2.0 * anchor_damping * sqrt(ka * mass[k])
			w[k] *= 1.0 / (1.0 + c * h / mass[k])
			var d := u[k].length()
			var yield_d := node_yield[k] / ka
			if d > yield_d:
				var shift := u[k] * (minf((d - yield_d) * (1.0 - hard), maxf(0.0, anchor_max_bend - q[k].length())) / d)
				q[k] += shift
				u[k] -= shift
				absorbed += node_yield[k] * shift.length()
				d = u[k].length()
				moved = true
			_rig_speed2 = maxf(_rig_speed2, w[k].length_squared())
			if ka * d > node_break[k] and anchor_max_bend - q[k].length() > 1e-6:
				anchor_alive[k] = 0
				_loose(k)
				moved = true
				continue
			var fa := (u[k] * ka + w[k] * c) * share
			rf += fa
			rt += (rest[k] + u[k] + q[k]).cross(fa)
	return [moved, rf, rt]


## A repair that takes time (the pit stop): repair_start keeps the shape as it is, repair_to(share) puts every node
## that share of the way back to its place (0: as it was, 1: where it belongs) and keeps it still; repair() at the end
## makes it whole.
func repair_start() -> void:
	_repair_from = [u.duplicate(), q.duplicate()]


func repair_to(share: float) -> void:
	if _repair_from.is_empty():
		return
	var k := 1.0 - clampf(share, 0.0, 1.0)
	var fu: PackedVector3Array = _repair_from[0]
	var fq: PackedVector3Array = _repair_from[1]
	for n in count:
		u[n] = fu[n] * k
		q[n] = fq[n] * k
	w.fill(Vector3.ZERO)
	force.fill(Vector3.ZERO)
	_sync_displacement()



func _sane() -> bool:
	for k in count:
		var x := u[k]
		var y := q[k]
		var z := w[k]
		if not (x.length_squared() < 2500.0) or not (y.length_squared() < 2500.0) or not (z.length_squared() < 1e8):
			return false
	return true
