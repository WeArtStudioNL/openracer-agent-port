class_name RiderRagdoll
extends RefCounted
## The rider of a motorcycle thrown off as a ragdoll (web/js/Driver.js crash, ragdollStep, ragdollPose): fifteen
## particles (the hips, the chest, the head, the shoulders, the elbows, the hands, the hip joints, the knees and the
## feet) that fly, fall and slide over the road, held together by sticks (the bones keep their length, the torso is
## rigid, a limb folds no further than a minimum), Verlet at 240 Hz. The joints have the limits of a body and muscles
## (a soft zone before every limit, a weak tone towards the neutral posture, damping); the limbs keep out of each
## other; the road takes 0.55 g of speed out of him; a floor that is suddenly much higher is a wall. He collides with
## the body of the bike (here its collision box: a part that starts inside it is not pushed out of it until it has
## left it; the seat holds the hips and the knees of a limp rider while the bike is upright) and gives the bike what he
## hits it with (the hit in the first 0.3 s, then no more than half his weight). The skeleton is posed on the
## particles: the root on the hips and the chest, the arms and the legs by the inverse kinematics on the hand or the
## foot with the elbow or the knee as the pole, the head along the neck.

## the particles (Driver.js ORDER)
enum { HIPS, CHEST, HEAD, SH_L, EL_L, HA_L, SH_R, EL_R, HA_R, HI_L, KN_L, FT_L, HI_R, KN_R, FT_R }

const G := 9.81
const DEG := PI / 180.0
const H := 1.0 / 240.0
const PART_MASS := 80.0 / 15.0
const COUNT := 15
const RIGID := [HIPS, CHEST, SH_L, SH_R, HI_L, HI_R, HEAD]
const SEAT := [HIPS, HI_L, HI_R]
## the limits of the joints (degrees): the shoulder a round cone about forwards and out, the hip an ellipse between how
## far it goes forwards (less with the knee straight), back, out and in; the elbow and the knee fold this far
const SHOULDER := {"theta": 80.0, "phi": 45.0, "radius": 115.0}
const HIP := {"fwd": 135.0, "fwd_straight": 90.0, "back": 20.0, "out": 45.0, "inn": 25.0}
const ELBOW := 145.0
const KNEE := 135.0
## the neutral body posture (NASA, Skylab)
const NBP_SHOULDER := Vector2(40.0, 35.0)
const NBP_HIP := Vector2(50.0, 12.0)
const NBP_ELBOW := 50.0
const NBP_KNEE := 50.0
## the muscles: the tone (1/s), the soft zone before a limit (degrees), before straight, the pull at the limit (1/s),
## the damping of every joint and in the soft zone (1/s), and the hard stop past the limit (degrees)
const TONE := 2.5
const ZONE := 22.0
const ZONE_STRAIGHT := 8.0
const LIMIT := 32.0
const DAMP := 4.0
const DAMP_LIMIT := 45.0
const BEYOND := 12.0

var rider: MotorcycleRider
var car: Car
var p := PackedVector3Array()          # the place now
var q := PackedVector3Array()          # the place a step before (Verlet)
var v0 := PackedVector3Array()         # the speed to start with
var f := PackedVector3Array()          # where it was before this frame (the sleep test)
var rad := PackedFloat32Array()
var floor_y := PackedFloat32Array()
var inside := []                       # a part that started inside the body of the bike (not pushed out until it left)
var hold := []                         # a part held by the seat (a limp rider): its place in the frame of the body box
var sticks := []                       # [a, b, length]
var mins := []                         # [a, b, the least length]
var pairs := []                        # [a, b, the least distance]: parts that keep out of each other
var frame_up := Vector3.UP             # the frame of the torso in the space of the root, in the rest pose
var frame_side := Vector3.RIGHT
var centre := Vector3.ZERO
var seated := false
var asleep := 0.0
var time := 0.0
var started := false
var _acc := 0.0
var _y0 := 0.0
var _impulse_left := 0.0
var _space: PhysicsDirectSpaceState3D
# the body of the bike this frame (its collision box) and its motion
var _box_xf := Transform3D.IDENTITY
var _box_inv := Transform3D.IDENTITY
var _box_half := Vector3.ZERO
var _bike_v := Vector3.ZERO
var _bike_w := Vector3.ZERO
var _bike_c := Vector3.ZERO
var _box_on := false
# the frame of the torso and the swing of a limb, worked out once a joint (Driver.js jUp, jSide, jFwd, sw, bd)
var _up := Vector3.UP
var _side := Vector3.LEFT
var _fwd := Vector3.BACK
var _sw_len := 0.0
var _sw_theta := 0.0
var _sw_max := 0.0
var _m_d := Vector3.ZERO
var _m_z := Vector3.ZERO
var _m_h := Vector3.ZERO
var _bd_up := 0.0
var _bd_lo := 0.0
var _bd_beta := 0.0
var _bd_w := 0.0
var _m_a := Vector3.ZERO
var _m_b := Vector3.ZERO
var _m_c := Vector3.ZERO
var _spin := Vector3.ZERO
var _out := Vector3.UP
var _box: CollisionShape3D = null


## The particles where the joints of the rider are now, with the speed they have: the bike's at that place and the
## rider's own movement on it (own: car space per second, at most 5 m/s). on_bike: he goes limp where he sits.
func _init(r: MotorcycleRider, world_joints: Dictionary, own: Dictionary, on_bike: bool) -> void:
	rider = r
	car = r.car
	_space = car.get_world_3d().direct_space_state
	p.resize(COUNT)
	q.resize(COUNT)
	v0.resize(COUNT)
	f.resize(COUNT)
	rad.resize(COUNT)
	floor_y.resize(COUNT)
	var radius := [0.13, 0.14, 0.11, 0.1, 0.06, 0.05, 0.1, 0.06, 0.05, 0.1, 0.07, 0.06, 0.1, 0.07, 0.06]
	for i in COUNT:
		rad[i] = radius[i]
		floor_y[i] = -1e9
		p[i] = world_joints.get(i, Vector3.ZERO)
	p[CHEST] = (p[SH_L] + p[SH_R]) * 0.5
	var up_dir := (p[CHEST] - p[HIPS]).normalized()
	p[HEAD] = ((world_joints[HEAD] as Vector3) + up_dir * 0.1) if world_joints.has(HEAD) else p[CHEST] + up_dir * 0.3
	q = p.duplicate()
	_y0 = p[HIPS].y
	for i in RIGID.size():
		for j in range(i + 1, RIGID.size()):
			_stick(RIGID[i], RIGID[j])
	var limbs := [[SH_L, EL_L, HA_L], [SH_R, EL_R, HA_R], [HI_L, KN_L, FT_L], [HI_R, KN_R, FT_R]]
	for k in 4:
		var c: Array = limbs[k]
		_stick(c[0], c[1])
		_stick(c[1], c[2])
		var la := p[c[0]].distance_to(p[c[1]])
		var lb := p[c[1]].distance_to(p[c[2]])
		var fold := minf(175.0, (ELBOW if k < 2 else KNEE) + BEYOND) * DEG
		mins.append([c[0], c[2], sqrt(maxf(0.0, la * la + lb * lb + 2.0 * la * lb * cos(fold)))])
	# the parts that keep out of each other: every pair that no stick or fold limit joins (at least 7 cm each)
	var joined := {}
	for st in sticks + mins:
		joined[Vector2i(mini(st[0], st[1]), maxi(st[0], st[1]))] = true
	for i in COUNT:
		for j in range(i + 1, COUNT):
			if joined.has(Vector2i(i, j)):
				continue
			var ra := maxf(0.07, rad[i])
			var rb := maxf(0.07, rad[j])
			if p[i].distance_to(p[j]) < ra + rb:
				continue                # (already closer than that in the pose on the bike)
			pairs.append([i, j, ra + rb])
	# the speed of every part: the bike's at that place, and the rider's own movement on it
	var basis := car.global_transform.basis.orthonormalized()
	var com := car.global_transform * car.center_of_mass
	for i in COUNT:
		var vel := car.linear_velocity + car.angular_velocity.cross(p[i] - com)
		if own.has(i):
			vel += basis * (own[i] as Vector3).limit_length(5.0)
		v0[i] = vel
	v0[CHEST] = (v0[SH_L] + v0[SH_R]) * 0.5
	v0[HEAD] = v0[CHEST]
	centre = p[HIPS]
	inside.resize(COUNT)
	hold.resize(COUNT)
	seated = on_bike
	_read_bike()
	for i in COUNT:
		inside[i] = _box_on and _box_depth(p[i], rad[i]) > 0.0
		# (a limp rider: the hips, the hip joints and the knees sit in the seat; it holds them while the bike is upright)
		hold[i] = (_box_inv * p[i]) if on_bike and _box_on and i in SEAT else null


func _stick(a: int, b: int) -> void:
	sticks.append([a, b, p[a].distance_to(p[b])])


## The frame of the torso in the space of the root, from the bones in their rest pose (the root is put on the
## particles from it).
func set_frame(sh_l: Vector3, sh_r: Vector3, hips: Vector3) -> void:
	frame_up = ((sh_l + sh_r) * 0.5 - hips).normalized()
	frame_side = sh_l - sh_r
	frame_side = (frame_side - frame_up * frame_side.dot(frame_up)).normalized()


# ---- the body of the bike

func _read_bike() -> void:
	if _box == null:
		for c in car.get_children():
			if c is CollisionShape3D and (c as CollisionShape3D).shape is BoxShape3D:
				_box = c
				break
	_box_on = _box != null
	if not _box_on:
		return
	_box_xf = _box.global_transform
	_box_half = (_box.shape as BoxShape3D).size / 2.0
	_box_inv = _box_xf.affine_inverse()
	_bike_v = car.linear_velocity
	_bike_w = car.angular_velocity
	_bike_c = car.global_transform * car.center_of_mass


## How far a sphere of radius r at x is in the box (> 0: in it), and the way out (world: _out).
func _box_depth(x: Vector3, r: float) -> float:
	var l := _box_inv * x
	var h := _box_half
	var c := Vector3(clampf(l.x, -h.x, h.x), clampf(l.y, -h.y, h.y), clampf(l.z, -h.z, h.z))
	var d := l - c
	var dist := d.length()
	if dist > 1e-6:
		_out = (_box_xf.basis * (d / dist)).normalized()
		return r - dist
	# (the middle is inside: out through the nearest face)
	var dx := h.x - absf(l.x)
	var dy := h.y - absf(l.y)
	var dz := h.z - absf(l.z)
	var n := Vector3(signf(l.x) if l.x != 0.0 else 1.0, 0, 0)
	var depth := dx
	if dy < depth:
		depth = dy
		n = Vector3(0, signf(l.y) if l.y != 0.0 else 1.0, 0)
	if dz < depth:
		depth = dz
		n = Vector3(0, 0, signf(l.z) if l.z != 0.0 else 1.0)
	_out = (_box_xf.basis * n).normalized()
	return depth + r


## A particle against the body of the bike: pushed out (a move, not a speed), its speed into it taken away and some of
## the speed along it (the leathers grip); the bike gets the speed that the part lost into it, as an impulse.
func _bike_contact(i: int, first: bool) -> void:
	var sv := _bike_v + _bike_w.cross(p[i] - _bike_c)
	if sv.length() > 60.0:
		sv = sv.normalized() * 60.0
	var held: bool = hold[i] != null and seated
	var push := 0.0
	var n := Vector3.ZERO
	if held:
		var target: Vector3 = _box_xf * (hold[i] as Vector3)      # (the body goes on with its speed within the frame)
		var d := target - p[i]
		push = d.length()
		n = d / push if push > 1e-6 else Vector3.UP
	else:
		var depth := _box_depth(p[i], rad[i])
		if depth <= 0.0:
			inside[i] = false              # (out of the body it started in: from now on it is solid for him)
			return
		if inside[i] and (seated or time < 0.4):
			return
		# (a part that was in it when he was thrown (the box is one body, not the spheres of the browser) is let out
		# gently after 0.4 s, 2 cm an iteration: the bike that falls onto him does not lie in him)
		push = minf(depth, 0.02) if inside[i] else depth
		n = _out
	var vel := p[i] - q[i] - sv * H
	if push > 0.0:
		p[i] += n * push
		var vn := vel.dot(n)
		if vn < 0.0:
			vel -= vn * n
			if first and not held and _impulse_left > 0.0:
				var jn := minf(_impulse_left, absf(vn) / H * PART_MASS)
				_impulse_left -= jn
				car.apply_impulse(-n * jn, p[i] - car.global_position)
	vel *= exp(-(40.0 if held else 6.0) * H)
	var cap := 4.0 * H                     # (never faster than 4 m/s relative to the bike out of a contact)
	if vel.length() > cap:
		vel = vel.normalized() * cap
	q[i] = p[i] - vel - sv * H


# ---- the ground

func _ground_y(x: float, z: float) -> float:
	var from := Vector3(x, _y0 + 20.0, z)
	var ray := PhysicsRayQueryParameters3D.create(from, from + Vector3.DOWN * 100.0, 1, [car.get_rid()])
	var hit := _space.intersect_ray(ray)
	return float((hit["position"] as Vector3).y) if not hit.is_empty() else _y0 - 0.6


# ---- the limits of the joints

## A particle moved to a limit: its old place goes with it (the move gives it no speed), the speed into the limit is
## taken out; by no more than 2 cm an iteration, and never into the road.
func _to_limit(i: int, dir: Vector3, move: float) -> void:
	move = clampf(move, -0.02, 0.02)
	var m := dir * move
	if m.y < 0.0 and p[i].y <= floor_y[i] + 0.002:
		m.y = 0.0
	p[i] += m
	q[i] += m
	var vn := (p[i] - q[i]).dot(dir)
	if vn * move < 0.0:
		q[i] += dir * vn


func _hinge(a: int, mid: int, b: int, sign: float) -> void:
	var limb := p[b] - p[a]
	var limb_len := limb.length()
	if limb_len < 1e-6:
		return
	var dir := limb.cross(_side)
	var sin_a := dir.length() / limb_len
	var w := clampf((sin_a - 0.25) / 0.25, 0.0, 1.0)
	if w <= 0.0:
		return
	dir = dir.normalized()
	var m := (p[a] + p[b]) * 0.5
	var d := (p[mid] - m).dot(dir)
	var d_min := sign * 0.03                  # (never quite straight)
	if (d - d_min) * sign < 0.0:
		_to_limit(mid, dir, (d_min - d) * w)
		d += (d_min - d) * w
	# (the joint bends in its own plane: the middle stands out sideways by no more than 35 degrees of its bend)
	var lat_dir := limb.normalized().cross(dir)
	var lat := (p[mid] - m).dot(lat_dir)
	var lat_max := maxf(0.05, 0.7 * absf(d))
	if absf(lat) > lat_max:
		_to_limit(mid, lat_dir, -(lat - signf(lat) * lat_max) * w)


func _torso_frame() -> void:
	_up = (p[CHEST] - p[HIPS]).normalized()
	var s := p[SH_L] - p[SH_R]
	_side = (s - _up * s.dot(_up)).normalized()
	_fwd = _side.cross(_up)


## The swing of a limb from its root to its end in the frame of the torso: its angle from the middle of its range,
## the way round, and how far it may go that way (the shoulder: a round cone; the hip: an ellipse).
func _swing_of(root: int, end: int, out: float, shoulder: bool, fwd_max: float) -> bool:
	_m_d = p[end] - p[root]
	var length := _m_d.length()
	_sw_len = length
	if length < 1e-6:
		return false
	if shoulder:
		var th := float(SHOULDER["theta"]) * DEG
		var ph := float(SHOULDER["phi"]) * DEG
		_m_z = -_up * cos(th) + _fwd * (sin(th) * cos(ph)) + _side * (out * sin(th) * sin(ph))
	else:
		_m_z = -_up
	var z := _m_d.dot(_m_z) / length
	_m_h = _m_d / length - _m_z * z
	var hl := _m_h.length()
	_sw_theta = atan2(hl, z)
	_m_h = _m_h / hl if hl > 1e-6 else _fwd
	if shoulder:
		_sw_max = float(SHOULDER["radius"]) * DEG
		return true
	var cphi := _m_h.dot(_fwd)
	var sphi := out * _m_h.dot(_side)
	var a := (fwd_max if cphi >= 0.0 else float(HIP["back"])) * DEG
	var b := (float(HIP["out"]) if sphi >= 0.0 else float(HIP["inn"])) * DEG
	_sw_max = 1.0 / sqrt(cphi * cphi / (a * a) + sphi * sphi / (b * b))
	return true


## The bend of an elbow or a knee from straight (0) about the axis of the joint; w fades it where the axis is not defined.
func _bend_of(root: int, mid: int, end: int, sign: float) -> bool:
	_m_a = p[mid] - p[root]
	_m_b = p[end] - p[mid]
	_bd_up = _m_a.length()
	_bd_lo = _m_b.length()
	if _bd_up < 1e-6 or _bd_lo < 1e-6:
		return false
	_m_a /= _bd_up
	_m_b /= _bd_lo
	_m_c = _side * sign
	_m_c -= _m_a * _m_c.dot(_m_a)
	var l := _m_c.length()
	_bd_w = clampf((l - 0.25) / 0.25, 0.0, 1.0)
	if _bd_w <= 0.0:
		return false
	_m_c /= l
	_bd_beta = atan2(_m_a.cross(_m_b).dot(_m_c), _m_a.dot(_m_b))
	return true


## How far the hip goes forwards: less with the knee straight (the hamstrings).
func _hip_fwd(hi: int, kn: int, ft: int) -> float:
	if not _bend_of(hi, kn, ft, 1.0):
		return float(HIP["fwd"])
	var k := clampf(_bd_beta / (90.0 * DEG), 0.0, 1.0)
	return float(HIP["fwd_straight"]) + (float(HIP["fwd"]) - float(HIP["fwd_straight"])) * k


func _swing_stop(root: int, end: int, out: float, shoulder: bool, fwd_max: float) -> void:
	if not _swing_of(root, end, out, shoulder, fwd_max):
		return
	var stop := minf(PI, _sw_max + BEYOND * DEG)
	if _sw_theta <= stop:
		return
	var t := (_m_z * cos(stop) + _m_h * sin(stop)) * _sw_len + p[root] - p[end]
	var move := t.length()
	if move < 1e-9:
		return
	_to_limit(end, t / move, move)


func _joint_limits() -> void:
	_torso_frame()
	_hinge(SH_L, EL_L, HA_L, -1.0)
	_hinge(SH_R, EL_R, HA_R, -1.0)
	_hinge(HI_L, KN_L, FT_L, 1.0)
	_hinge(HI_R, KN_R, FT_R, 1.0)
	_swing_stop(SH_L, EL_L, 1.0, true, 0.0)
	_swing_stop(SH_R, EL_R, -1.0, true, 0.0)
	_swing_stop(HI_L, KN_L, 1.0, false, _hip_fwd(HI_L, KN_L, FT_L))
	_swing_stop(HI_R, KN_R, -1.0, false, _hip_fwd(HI_R, KN_R, FT_R))


# ---- the muscles

## The turn of the torso in this substep (radians, as a vector).
func _torso_spin() -> Vector3:
	var u := (p[CHEST] - p[HIPS]).normalized()
	var uq := (q[CHEST] - q[HIPS]).normalized()
	var s := (p[SH_L] - p[SH_R]).normalized()
	var sq := (q[SH_L] - q[SH_R]).normalized()
	var fw := s.cross(u)
	var fq := sq.cross(uq)
	return (u.cross(u - uq) + s.cross(s - sq) + fw.cross(fw - fq)) * 0.5


## A pull (m/s2) on the end e and the other way on r, the turn that gives the limb the other way on the part it hangs
## from (pa, pb; what is left about that line on pc, pd), and the damping of e relative to r square to the limb.
func _muscle(e: int, r: int, acc: Vector3, spin: Vector3, c: float, pa := -1, pb := -1, pc := -1, pd := -1) -> void:
	var h2 := H * H
	p[e] += acc * h2
	p[r] -= acc * h2
	if pa >= 0:
		var t := -(p[e] - p[r]).cross(acc)
		var ca := p[pa] - p[pb]
		var l2 := ca.length_squared()
		if l2 > 1e-8:
			var along := t.dot(ca) / l2
			var cg := t.cross(ca) * (h2 / l2)
			p[pa] += cg
			p[pb] -= cg
			if pc >= 0:
				t = ca * along
				ca = p[pc] - p[pd]
				l2 = ca.length_squared()
				if l2 > 1e-8:
					cg = t.cross(ca) * (h2 / l2)
					p[pc] += cg
					p[pd] -= cg
	var x := p[e] - p[r]
	var length := x.length()
	if length < 1e-6:
		return
	x /= length
	var tw := spin.cross(x) * length
	var vel := (p[e] - q[e]) - (p[r] - q[r]) - tw
	vel -= x * vel.dot(x)
	var k := 0.5 * (1.0 - exp(-c * H))
	q[e] += vel * k
	q[r] -= vel * k


func _swing_muscle(root: int, end: int, out: float, shoulder: bool, fwd_max: float, nbp: Vector2) -> void:
	if not _swing_of(root, end, out, shoulder, fwd_max):
		return
	var zone := ZONE * DEG
	var c := DAMP
	var th := nbp.x * DEG
	var ph := nbp.y * DEG
	var t := (-_up * cos(th) + _fwd * (sin(th) * cos(ph)) + _side * (out * sin(th) * sin(ph))) * _sw_len - _m_d
	var x := _m_d / _sw_len
	t -= x * t.dot(x)
	var acc := t * TONE * TONE
	var into := (_sw_theta - (_sw_max - zone)) / zone
	if into > 0.0:
		var xs := minf(into, 1.0 + BEYOND / ZONE)
		var a := LIMIT * LIMIT * _sw_len * zone * xs * xs
		acc += a * (sin(_sw_theta) * _m_z - cos(_sw_theta) * _m_h)
		c += DAMP_LIMIT * minf(1.0, into)
	_muscle(end, root, acc, _spin, c, CHEST, HIPS, SH_L, SH_R)


func _bend_muscle(root: int, mid: int, end: int, sign: float, fold: float, nbp: float) -> void:
	if not _bend_of(root, mid, end, sign):
		return
	var zone := ZONE * DEG
	var zs := ZONE_STRAIGHT * DEG
	var c := DAMP
	var w := _bd_w
	var x := p[mid] - p[root]
	var tx := p[mid] - q[mid] - p[root] + q[root]
	var uw := x.cross(tx) / maxf(1e-6, x.length_squared())
	var way := _m_c.cross(_m_b)
	var a := TONE * TONE * _bd_lo * (nbp * DEG - _bd_beta)
	var into := (_bd_beta - (fold * DEG - zone)) / zone
	if into > 0.0:
		var xs := minf(into, 1.0 + BEYOND / ZONE)
		a -= LIMIT * LIMIT * _bd_lo * zone * xs * xs
		c += DAMP_LIMIT * minf(1.0, into)
	var y := (zs - _bd_beta) / zs
	if y > 0.0:
		var ys := minf(y, 2.0)
		a += LIMIT * LIMIT * _bd_lo * zs * ys * ys
		c += DAMP_LIMIT * minf(1.0, y)
	a *= w
	_muscle(end, mid, way * a, uw, DAMP + (c - DAMP) * w, mid, root)


func _muscles() -> void:
	_torso_frame()
	_spin = _torso_spin()
	_swing_muscle(SH_L, EL_L, 1.0, true, 0.0, NBP_SHOULDER)
	_swing_muscle(SH_R, EL_R, -1.0, true, 0.0, NBP_SHOULDER)
	var fl := _hip_fwd(HI_L, KN_L, FT_L)
	var fr := _hip_fwd(HI_R, KN_R, FT_R)
	_torso_frame()
	_swing_muscle(HI_L, KN_L, 1.0, false, fl, NBP_HIP)
	_swing_muscle(HI_R, KN_R, -1.0, false, fr, NBP_HIP)
	_torso_frame()
	_bend_muscle(SH_L, EL_L, HA_L, -1.0, ELBOW, NBP_ELBOW)
	_bend_muscle(SH_R, EL_R, HA_R, -1.0, ELBOW, NBP_ELBOW)
	_bend_muscle(HI_L, KN_L, FT_L, 1.0, KNEE, NBP_KNEE)
	_bend_muscle(HI_R, KN_R, FT_R, 1.0, KNEE, NBP_KNEE)


# ---- the step

func step(dt: float) -> void:
	time += dt
	if asleep > 1.0:
		return                         # lying still: nothing moves any more
	_acc += dt
	var n := mini(12, floori(_acc / H))
	_acc -= n * H
	if n == 0:
		return
	_read_bike()
	# (what he may give the bike this frame: the hit in the first moments, then no more than half his weight)
	_impulse_left = 160.0 if time < 0.3 else 40.0 * G * minf(dt, 0.1)
	var near := _box_on and _box_xf.origin.distance_to(centre) < 3.5
	for i in COUNT:
		var fl := _ground_y(p[i].x, p[i].z) + rad[i]
		# (a floor that is suddenly much higher is a wall or a kerb: he bounces back off it)
		if floor_y[i] > -1e8 and fl > floor_y[i] + 0.3:
			var b := p[i] - q[i]
			p[i] = Vector3(q[i].x - 0.3 * b.x, p[i].y, q[i].z - 0.3 * b.z)
			q[i] = Vector3(p[i].x + 0.3 * b.x, q[i].y, p[i].z + 0.3 * b.z)
			fl = _ground_y(p[i].x, p[i].z) + rad[i]
			if fl > floor_y[i] + 0.3:
				fl = floor_y[i]
		floor_y[i] = fl
		f[i] = p[i]
	if not started:
		started = true
		for i in COUNT:
			q[i] = p[i] - v0[i] * H
	var box_step := _bike_v * H
	for s in n:
		for i in COUNT:
			var vel := p[i] - q[i]
			q[i] = p[i]
			p[i] += vel * 0.998 + Vector3(0.0, -G * H * H, 0.0)
		_muscles()
		if s > 0 and near:
			# (the body of the bike goes on with its speed within the frame)
			_box_xf.origin += box_step
			_bike_c += box_step
			_box_inv = _box_xf.affine_inverse()
		for it in 5:
			if near:
				for i in COUNT:
					_bike_contact(i, it == 0)
			for st in sticks:
				var a: int = st[0]
				var b: int = st[1]
				var d := p[b] - p[a]
				var length := d.length()
				if length < 1e-6:
					continue
				var corr := d * ((length - float(st[2])) / length * 0.5)
				p[a] += corr
				p[b] -= corr
			for mn in mins:
				var a: int = mn[0]
				var b: int = mn[1]
				var d := p[b] - p[a]
				var length := d.length()
				if length >= float(mn[2]) or length < 1e-6:
					continue
				var corr := d * ((length - float(mn[2])) / length * 0.5)
				p[a] += corr
				p[b] -= corr
			_joint_limits()
			for pr in pairs:
				var a: int = pr[0]
				var b: int = pr[1]
				var d := p[b] - p[a]
				var length := d.length()
				if length >= float(pr[2]) or length < 1e-6:
					continue
				d /= length
				var half := (float(pr[2]) - length) * 0.5
				_to_limit(a, d, -half)
				_to_limit(b, d, half)
			var touching := 0
			for i in COUNT:
				if p[i].y < floor_y[i]:
					var fy := floor_y[i]
					var qy := fy if q[i].y < fy else fy + (q[i].y - fy) * 0.2      # (the fall is taken, a little bounce)
					if fy - qy > 3.0 * H:
						qy = fy - 3.0 * H                                     # (never thrown up faster than 3 m/s)
					p[i].y = fy
					q[i].y = qy
					touching += 1
			# the road takes the speed out of him (leathers on tarmac: about 0.55 g)
			if touching > 0 and it == 0:
				var dv := 0.55 * G * H * H * minf(1.0, touching / 4.0)
				for i in COUNT:
					var sx := p[i].x - q[i].x
					var sz := p[i].z - q[i].z
					var sp := sqrt(sx * sx + sz * sz)
					if sp < 1e-9:
						continue
					var k := maxf(0.0, sp - dv) / sp
					q[i].x = p[i].x - sx * k
					q[i].z = p[i].z - sz * k
	centre = Vector3.ZERO
	var most := 0.0
	for i in COUNT:
		most = maxf(most, p[i].distance_squared_to(f[i]))
		centre += p[i]
	centre /= COUNT
	if sqrt(most) / (n * H) < 0.08 and not near:
		asleep += dt
	else:
		asleep = 0.0
