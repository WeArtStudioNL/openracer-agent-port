class_name MotorcycleRider
extends RefCounted
## The rider on a motorcycle (web/js/Driver.js, the part for a rider): the driver.glb of car.json "driver" put in its
## place (position, rotation, scale; the model turns about its hips), the hands on the grips (they turn with the
## handlebar, the hand keeps its turn on the grip, hands.rotation on top), the feet on the pegs and down on the road at
## a standstill, the elbows and the knees by a two-bone inverse kinematics; the body where the posture of Motorcycle.gd
## puts it: flat on the throttle, back on the brake, hanging off to the inside of a bend with the inside knee out and
## down, the head turned into the bend; and the give in the g-forces (a mass on a spring and a damper on the bike).
## The right grip rolls with the throttle; the fingers point at the levers (frontbrake_R, clutch_L) and pull them, the
## levers turn about their hinge; the shift lever (shifter_L) taps with every shift and the left foot goes with it.
## When the bike goes down the rider is a ragdoll (RiderRagdoll) until a reset or a repair; the key 9 makes him limp
## on the bike.

const FOOT_ANKLE := 0.09
const CURL_DEGREES := 65.0
## the shift lever: the angle of a tap (rad; plus is down), of the tap into neutral, the time to it and back (s)
const SHIFT_FULL := 0.34
const SHIFT_HALF := 0.13
const SHIFT_UP := 0.07
const SHIFT_BACK := 0.2
const THROTTLE_ROLL := 0.75          # rad: the right grip at full throttle
const LEVER_PULL := 0.3              # rad: a lever at a full pull
## the give in the g-forces (OpenRacer.RiderFeel: the amount, how quick he comes back in Hz, the damping)
const FEEL_AMOUNT := 1.0
const FEEL_HZ := 1.4
const FEEL_DAMPING := 0.55

var car: Car
var cfg: Dictionary
var root: Node3D
var skel: Skeleton3D = null
var bones := {}                   # armL, armR, legL, legR: [upper, lower, end]; hips, chest, head: a bone
var grips := {}                   # left, right: the grip parts (on the handlebar); pegs: the footpegs
var pegs := {}
var base := Vector3.ZERO
var arm_left := "armL"            # (which chain is on the left of the bike: a Rigify rig may come facing the other way)
var leg_left := "legL"
var scale := 1.0
var levers := {}                  # brake, clutch: {node, rest, hinge, axis, side}
var shifter: Node3D = null
var shifter_rest := Transform3D.IDENTITY
var shifter_tip := Vector3.ZERO   # the toe peg end of the shift lever, in its own frame
var shifter_tip_at := Vector3.ZERO      # and where it is at rest, in the space of the car
var grip_rest := {}               # left, right: the transform of the grip part at rest (its own)
var grip_rest_car := {}           # and its turn in the space of the car
var hand_rel := {}                # left, right: the turn of the hand relative to its grip, found once (neutral)
var fingers := {"armL": [], "armR": []}
var shift := {"gear": -99, "neutral": false, "time": 9.0, "amp": 0.0, "angle": 0.0, "pull": 0.0}
var g_off := Vector3.ZERO         # the give in the g-forces: where the body is pushed (the space of the car)
var g_off_v := Vector3.ZERO
var g_acc := Vector3.ZERO
var ragdoll: RiderRagdoll = null
var _last_v := Vector3.ZERO
var _last_p := Vector3.ZERO
var _have_last := false
var _root_keep := Transform3D.IDENTITY
var _joints := {}                 # the particle of the ragdoll -> its bone
var _joints_prev := {}            # where they were a frame ago, in the space of the car
var _joints_dt := 0.0
var _road_hold := {}              # the road under a foot, smoothed and held per place (roadHold)


func _init(c: Car, driver: Dictionary) -> void:
	car = c
	cfg = driver
	var model := Content.load_model(str(driver["file"]))
	if model == null:
		return
	var found := model.find_children("*", "Skeleton3D", true, false)
	if found.is_empty():
		model.free()
		return
	skel = found[0] as Skeleton3D
	root = Node3D.new()
	root.name = "Rider"
	car.add_child(root)          # (not under the model: the shell that dents bends the meshes of the model)
	var p: Array = driver.get("position", [0, 0.5, -0.3])
	var r: Array = driver.get("rotation", [0, 0, 0])
	base = Vector3(float(p[0]), float(p[1]), float(p[2]))
	var sc := float(driver.get("scale", 1.0))
	scale = sc if sc > 0.0 else 1.0
	# (three.js Euler "XYZ": Rx Ry Rz)
	var b := Basis(Vector3.RIGHT, deg_to_rad(float(r[0]))) * Basis(Vector3.UP, deg_to_rad(float(r[1]))) * Basis(Vector3.BACK, deg_to_rad(float(r[2])))
	base = car.model_root.transform * base
	root.transform = Transform3D(car.model_root.basis * b.scaled(Vector3.ONE * scale), base)
	root.add_child(model)
	for m in model.find_children("*", "MeshInstance3D", true, false):
		(m as MeshInstance3D).extra_cull_margin = 2.0
	_bones(driver.get("bones", {}))
	# the model turns about its hips: it is moved so that its hips are at the origin of the rider
	if bones.has("hips"):
		var h := CarModel.relative(skel, root) * skel.get_bone_global_rest(bones["hips"]).origin
		model.position -= h
	for side in ["left", "right"]:
		var s := "L" if side == "left" else "R"
		grips[side] = _part("grip_" + s)
		pegs[side] = _part("footpeg_" + s)
	if grips["left"] == null or pegs["left"] == null or grips["right"] == null or pegs["right"] == null:
		grips.clear()
	# (the chain whose shoulder is on the left of the bike is the left arm)
	if _complete():
		var xl := _car_pos(bones["armL"][0]).x
		var xr := _car_pos(bones["armR"][0]).x
		arm_left = "armL" if xl >= xr else "armR"
		leg_left = "legL" if _car_pos(bones["legL"][0]).x >= _car_pos(bones["legR"][0]).x else "legR"
		_joints = {RiderRagdoll.SH_L: bones["armL"][0], RiderRagdoll.EL_L: bones["armL"][1], RiderRagdoll.HA_L: bones["armL"][2],
			RiderRagdoll.SH_R: bones["armR"][0], RiderRagdoll.EL_R: bones["armR"][1], RiderRagdoll.HA_R: bones["armR"][2],
			RiderRagdoll.HI_L: bones["legL"][0], RiderRagdoll.KN_L: bones["legL"][1], RiderRagdoll.FT_L: bones["legL"][2],
			RiderRagdoll.HI_R: bones["legR"][0], RiderRagdoll.KN_R: bones["legR"][1], RiderRagdoll.FT_R: bones["legR"][2]}
		if bones.has("hips"):
			_joints[RiderRagdoll.HIPS] = bones["hips"]
		if bones.has("head"):
			_joints[RiderRagdoll.HEAD] = bones["head"]
		_find_fingers()
	if not grips.is_empty():
		_record_rest()


func _bone(name: String) -> int:
	var want := BoneIK.key(name)
	for i in skel.get_bone_count():
		if BoneIK.key(skel.get_bone_name(i)) == want:
			return i
	return -1


func _bones(names: Dictionary) -> void:
	var defaults := {"armL": ["DEF-upper_armL", "DEF-forearmL", "DEF-handL"], "armR": ["DEF-upper_armR", "DEF-forearmR", "DEF-handR"],
		"legL": ["DEF-thighL", "DEF-shinL", "DEF-footL"], "legR": ["DEF-thighR", "DEF-shinR", "DEF-footR"]}
	for key in defaults:
		var list: Array = names.get(key, defaults[key])
		var ids: Array[int] = []
		for n in list:
			ids.append(_bone(str(n)))
		if not ids.has(-1):
			bones[key] = ids
	for key in ["hips", "chest", "head"]:
		var dflt: String = {"hips": "DEF-spine", "chest": "DEF-spine003", "head": "DEF-spine006"}[key]
		var b := _bone(str(names.get(key, dflt)))
		if b >= 0:
			bones[key] = b


func _complete() -> bool:
	return bones.has("armL") and bones.has("armR") and bones.has("legL") and bones.has("legR")


## The rider can be thrown off as a ragdoll.
func can_ragdoll() -> bool:
	return skel != null and _complete() and bones.has("hips")


## A part of the bike by its name (the grips hang on the steering head, the pegs on the body).
func _part(name: String) -> Node3D:
	var want := BoneIK.key(name)
	for n in car.find_children("*", "Node3D", true, false):
		if BoneIK.key(str(n.name)) == want and n != root and not root.is_ancestor_of(n):
			return n as Node3D
	return null


func _car_pos(b: int) -> Vector3:
	return CarModel.relative(skel, car) * BoneIK.global(skel, b).origin


## The vertices of the meshes of a part, in the frame of another node.
static func _vertices(part: Node3D, frame: Node3D) -> PackedVector3Array:
	var out := PackedVector3Array()
	var list: Array[Node] = part.find_children("*", "MeshInstance3D", true, false)
	if part is MeshInstance3D:
		list.append(part)
	for m in list:
		var mi := m as MeshInstance3D
		if mi.mesh == null:
			continue
		var t := CarModel.relative(mi, frame)
		for s in mi.mesh.get_surface_count():
			var arrays := mi.mesh.surface_get_arrays(s)
			for vtx: Vector3 in arrays[Mesh.ARRAY_VERTEX]:
				out.append(t * vtx)
	return out


## The grips, the levers and the shift lever as they are at rest (recordRest): a lever turns about an axis up through
## its hinge, the end of it nearest the middle of the bike (its origin is where the fingers go).
func _record_rest() -> void:
	for side in ["left", "right"]:
		var g: Node3D = grips[side]
		grip_rest[side] = g.transform
		grip_rest_car[side] = CarModel.relative(g, car).basis.orthonormalized()
	for e in [["brake", "frontbrake_R"], ["clutch", "clutch_L"]]:
		var lever := _part(e[1])
		if lever == null:
			continue
		var best := INF
		var hinge := Vector3.ZERO
		for vtx in _vertices(lever, car):
			if absf(vtx.x) < best:
				best = absf(vtx.x)
				hinge = vtx
		if best == INF:
			continue
		var to_car := CarModel.relative(lever, car)
		levers[e[0]] = {"node": lever, "rest": lever.transform, "hinge": to_car.affine_inverse() * hinge,
			"axis": (to_car.basis.inverse() * Vector3.UP).normalized(), "side": 1.0 if to_car.origin.x >= 0.0 else -1.0}
	shifter = _part("shifter_L")
	if shifter != null:
		shifter_rest = shifter.transform
		var most := 0.0
		for vtx in _vertices(shifter, shifter):
			if vtx.length_squared() > most:
				most = vtx.length_squared()
				shifter_tip = vtx
		shifter_tip_at = CarModel.relative(shifter, car) * shifter_tip


# ---- the fingers: every bone below a hand, except the bones of the palm, turns about its local x axis (car_driver.gd)

func _find_fingers() -> void:
	fingers = {"armL": [], "armR": []}
	var axis := Vector3(-1.0 if str(cfg.get("grip_curl", "x")) == "-x" else 1.0, 0, 0)
	var digit := RegEx.create_from_string("(?i)^DEF-.*(f_|finger|thumb)")
	for k in ["armL", "armR"]:
		var hand: int = bones[k][2]
		var deform := false
		for b in _below(hand):
			deform = deform or digit.search(skel.get_bone_name(b)) != null
		_walk_fingers(k, hand, hand, 0, false, deform, axis)


func _below(b: int) -> Array[int]:
	var out: Array[int] = []
	for c in skel.get_bone_children(b):
		out.append(c)
		out.append_array(_below(c))
	return out


func _walk_fingers(k: String, hand: int, bone: int, depth: int, thumb: bool, deform: bool, axis: Vector3) -> void:
	var nm := skel.get_bone_name(bone)
	var palm := RegEx.create_from_string("(?i)palm|meta").search(nm) != null and depth == 0
	if not palm and bone != hand and not (deform and not nm.begins_with("DEF-")):
		fingers[k].append({"bone": bone, "depth": depth, "thumb": thumb, "axis": axis, "rest": skel.get_bone_rest(bone).basis.get_rotation_quaternion()})
		depth += 1
	elif palm:
		depth = 0
	for c in skel.get_bone_children(bone):
		_walk_fingers(k, hand, c, depth, thumb or skel.get_bone_name(c).to_lower().contains("thumb"), deform, axis)


## The fingers of a hand: the thumb round the grip, the others a little closed and pointing at the lever (the middle
## finger is the base: the turn about its x axis that points it best at the lever is given to all of them).
func _fingers_at_lever(k: String, lever: Variant, amount: float, to_skel: Transform3D) -> void:
	var list: Array = fingers[k]
	for fg in list:
		skel.set_bone_pose_rotation(fg["bone"], fg["rest"] * Quaternion(fg["axis"], deg_to_rad(CURL_DEGREES) * (0.9 if fg["thumb"] else amount)))
	if lever == null:
		return
	var roots := list.filter(func(fg: Dictionary) -> bool: return not fg["thumb"] and fg["depth"] == 0)
	if roots.is_empty():
		return
	var mid := RegEx.create_from_string("(?i)middle|mid|f_?2|finger.?2")
	var base_f: Dictionary = {}
	for fg in roots:
		if mid.search(skel.get_bone_name(fg["bone"])) != null:
			base_f = fg
			break
	if base_f.is_empty():
		var sorted := roots.duplicate()
		sorted.sort_custom(func(x: Dictionary, y: Dictionary) -> bool: return skel.get_bone_name(x["bone"]) < skel.get_bone_name(y["bone"]))
		base_f = sorted[mini(1, sorted.size() - 1)]
	var kids := skel.get_bone_children(base_f["bone"])
	if kids.is_empty():
		return
	# (the place of the child bone for a turn of the base, worked out without posing the skeleton)
	var b: int = base_f["bone"]
	var parent_g := BoneIK.global(skel, skel.get_bone_parent(b))
	var p0 := parent_g * skel.get_bone_pose_position(b)
	var child_at := skel.get_bone_pose_position(kids[0])
	var start := skel.get_bone_pose_rotation(b)
	var want := to_skel * (lever as Vector3) - p0
	var best := 0.0
	var best_angle := INF
	for step in range(-14, 15):
		var theta := step * 0.1
		var p1 := parent_g.basis * (Basis(start * Quaternion(base_f["axis"], theta)) * child_at)
		var angle := p1.angle_to(want)
		if angle < best_angle:
			best_angle = angle
			best = theta
	for fg in roots:
		skel.set_bone_pose_rotation(fg["bone"], skel.get_bone_pose_rotation(fg["bone"]) * Quaternion(fg["axis"], best))


## Turns a bone by degrees about the axes of the car (on top of its rest), as the car editor sets the chest and the head.
func _turn(b: int, deg: Vector3, to_skel: Basis) -> void:
	if deg.length() < 1e-6:
		return
	var q := Basis(Vector3.RIGHT, deg_to_rad(deg.x)) * Basis(Vector3.UP, deg_to_rad(deg.y)) * Basis(Vector3.BACK, deg_to_rad(deg.z))
	var in_skel := to_skel * q * to_skel.inverse()
	var g := in_skel * BoneIK.global(skel, b).basis.orthonormalized()
	var p := skel.get_bone_parent(b)
	var local := (BoneIK.global(skel, p).basis.orthonormalized().inverse() * g) if p >= 0 else g
	skel.set_bone_pose_rotation(b, local.get_rotation_quaternion())


# ---- the gear: the shift lever taps, the clutch hand pulls

func _shift_events() -> void:
	var g := car.gear
	var neutral := g == 0
	if int(shift["gear"]) == -99:
		shift["gear"] = maxi(1, g)
		shift["neutral"] = neutral
		return
	var amp := 0.0
	if neutral != bool(shift["neutral"]):
		# (neutral is between the first and the second: a small tap up from the first, down from the second)
		if neutral:
			amp = -SHIFT_HALF if int(shift["gear"]) == 1 else SHIFT_HALF
		else:
			amp = SHIFT_FULL if g == 1 else -SHIFT_FULL
	elif not neutral and g != int(shift["gear"]):
		amp = -SHIFT_FULL if g > int(shift["gear"]) else SHIFT_FULL      # (the first gear is a tap down, the others up)
	if amp != 0.0:
		shift["amp"] = amp
		shift["time"] = 0.0
	if not neutral:
		shift["gear"] = g
	shift["neutral"] = neutral


func _shift_angle(dt: float) -> float:
	var t := float(shift["time"]) + dt
	shift["time"] = t
	var k := t / SHIFT_UP if t < SHIFT_UP else maxf(0.0, 1.0 - (t - SHIFT_UP) / SHIFT_BACK)
	k = k * k * (3.0 - 2.0 * minf(1.0, k))
	shift["angle"] = float(shift["amp"]) * k
	shift["pull"] = sin(PI * minf(1.0, t / (SHIFT_UP + SHIFT_BACK))) if t < SHIFT_UP + SHIFT_BACK else 0.0
	return float(shift["angle"])


## A lever turned about its hinge (the hinge stays where it is), by LEVER_PULL at a full pull, the tip to the rider.
func _pull_lever(k: String, amount: float) -> void:
	if not levers.has(k):
		return
	var l: Dictionary = levers[k]
	var h: Vector3 = l["hinge"]
	var turn := Transform3D(Basis(l["axis"], float(l["side"]) * LEVER_PULL * amount), Vector3.ZERO)
	(l["node"] as Node3D).transform = (l["rest"] as Transform3D) * Transform3D(Basis.IDENTITY, h) * turn * Transform3D(Basis.IDENTITY, -h)


# ---- the give in the g-forces

## The body of the rider is a mass on a spring and a damper on the bike: the acceleration of the bike in its own frame
## (smoothed over 40 ms, at most 4 g) pushes him the other way, 6 cm at 1 g; he comes back smoothly (gSpring).
func _g_spring(dt: float) -> void:
	var v := car.linear_velocity
	var pos := car.global_position
	if not _have_last or pos.distance_to(_last_p) > 5.0 or dt <= 0.0:
		_have_last = true
		_last_v = v
		_last_p = pos
		return
	var cap := 4.0 * 9.81
	g_acc += (((v - _last_v) / dt).clamp(-Vector3.ONE * cap, Vector3.ONE * cap) - g_acc) * minf(1.0, dt / 0.04)
	_last_v = v
	_last_p = pos
	var b := car.global_transform.basis.orthonormalized()
	var a := Vector3(g_acc.dot(b.x), g_acc.dot(b.y), g_acc.dot(b.z))        # left, up, forward
	var w := TAU * FEEL_HZ
	var z := FEEL_DAMPING
	var gain := FEEL_AMOUNT * 0.06 / 9.81 * w * w
	var n := maxi(1, ceili(dt * 120.0))
	var h := dt / n
	for i in n:
		g_off_v += (-w * w * g_off - 2.0 * z * w * g_off_v - gain * a) * h
		g_off += g_off_v * h
	# (how far he can go: 10 cm to the side, 8 cm down and 4 up, 12 cm forward and back)
	var lo := Vector3(-0.1, -0.08, -0.12)
	var hi := Vector3(0.1, 0.04, 0.12)
	for i in 3:
		if g_off[i] < lo[i]:
			g_off[i] = lo[i]
			g_off_v[i] = maxf(0.0, g_off_v[i])
		elif g_off[i] > hi[i]:
			g_off[i] = hi[i]
			g_off_v[i] = minf(0.0, g_off_v[i])


# ---- a crash: the ragdoll

## Where the joints are, in the space of the car (a frame ago: the rider's own movement in the speed of the ragdoll).
func _track_joints(dt: float) -> void:
	if _joints.is_empty():
		return
	var t := CarModel.relative(skel, car)
	for i in _joints:
		_joints_prev[i] = t * BoneIK.global(skel, _joints[i]).origin
	_joints_dt = dt


## The bike went down (or the key 9: on_bike, he goes limp where he sits): the rider is a ragdoll from here on.
func crash(on_bike: bool) -> void:
	if ragdoll != null or not can_ragdoll():
		return
	var sx := skel.global_transform
	var to_car := CarModel.relative(skel, car)
	var world := {}
	var own := {}
	for i in _joints:
		var at := BoneIK.global(skel, _joints[i]).origin
		world[i] = sx * at
		if _joints_prev.has(i) and _joints_dt > 0.0:
			own[i] = (to_car * at - (_joints_prev[i] as Vector3)) / _joints_dt
	_root_keep = root.transform
	# (the limbs loose: every bone in its rest pose; the skeleton is posed on the particles from here on)
	skel.reset_bone_poses()
	ragdoll = RiderRagdoll.new(self, world, own, on_bike)
	var to_root := CarModel.relative(skel, root)
	ragdoll.set_frame(to_root * BoneIK.global(skel, bones["armL"][0]).origin, to_root * BoneIK.global(skel, bones["armR"][0]).origin,
		to_root * BoneIK.global(skel, bones["hips"]).origin)
	var keep := root.global_transform
	root.top_level = true
	root.global_transform = keep
	root.visible = true
	_pose_ragdoll()


## Back on the bike (a reset or a repair).
func recover() -> void:
	if ragdoll == null:
		return
	ragdoll = null
	root.top_level = false
	root.transform = _root_keep
	skel.reset_bone_poses()
	_have_last = false
	g_off = Vector3.ZERO
	g_off_v = Vector3.ZERO


## The skeleton on the particles: the root on the hips and the chest, the limbs by the inverse kinematics with the
## middle particle (pushed out to the side it bends to) as the pole, the head along the neck (as far as 50 degrees).
func _pose_ragdoll() -> void:
	var p := ragdoll.p
	var up := (p[RiderRagdoll.CHEST] - p[RiderRagdoll.HIPS]).normalized()
	var side := p[RiderRagdoll.SH_L] - p[RiderRagdoll.SH_R]
	side = (side - up * side.dot(up)).normalized()
	var m := Basis(side, up, side.cross(up))
	var m0 := Basis(ragdoll.frame_side, ragdoll.frame_up, ragdoll.frame_side.cross(ragdoll.frame_up))
	root.global_transform = Transform3D((m * m0.inverse()).orthonormalized().scaled(Vector3.ONE * scale), p[RiderRagdoll.HIPS])
	skel.reset_bone_poses()
	var to_skel := skel.global_transform.affine_inverse()
	for e in [["armL", RiderRagdoll.SH_L, RiderRagdoll.EL_L, RiderRagdoll.HA_L, -1.0], ["armR", RiderRagdoll.SH_R, RiderRagdoll.EL_R, RiderRagdoll.HA_R, -1.0],
			["legL", RiderRagdoll.HI_L, RiderRagdoll.KN_L, RiderRagdoll.FT_L, 1.0], ["legR", RiderRagdoll.HI_R, RiderRagdoll.KN_R, RiderRagdoll.FT_R, 1.0]]:
		var a: Vector3 = p[e[1]]
		var mid: Vector3 = p[e[2]]
		var b: Vector3 = p[e[3]]
		var pole := (b - a).cross(side)
		pole = mid + pole.normalized() * 0.2 * float(e[4]) if pole.length_squared() > 1e-8 else mid
		BoneIK.solve(skel, bones[e[0]], to_skel * b, to_skel * pole)
	if bones.has("head"):
		var hb: int = bones["head"]
		var head_at := skel.global_transform * BoneIK.global(skel, hb).origin
		var from := head_at - p[RiderRagdoll.CHEST]
		var to := p[RiderRagdoll.HEAD] - p[RiderRagdoll.CHEST]
		if from.length_squared() > 1e-6 and to.length_squared() > 1e-6:
			var angle := from.angle_to(to)
			if angle > 0.87:
				to = from.normalized().lerp(to.normalized(), 0.87 / angle)
			BoneIK.rotate_to(skel, hb, to_skel.basis * from, to_skel.basis * to)


# ---- every frame

## The posture, the torso, the arms, the hands and the fingers, the levers and the legs; or the ragdoll.
func update(dt: float, bike: Motorcycle) -> void:
	if skel == null:
		return
	if ragdoll != null:
		ragdoll.seated = not bike.crashed and absf(bike.lean) < 0.5
		ragdoll.step(minf(0.05, dt))
		_pose_ragdoll()
		if bike.limp and not bike.crashed:
			# (his weight leans the bike; off it, beside it or on the road, nothing holds the bike up any more)
			var c := ragdoll.centre
			bike.rider_load = c
			var at := car.global_position
			if Vector2(c.x - at.x, c.z - at.z).length() > 1.1 or c.y - at.y < -0.3:
				bike.fall_off(car.linear_velocity)
		return
	if bike.crashed:
		if can_ragdoll():
			crash(false)
		else:
			root.visible = false
		return
	root.visible = true
	_track_joints(dt)
	_g_spring(dt)
	var p := bike.posture
	var st := bike.style
	var lean := float(p["lean"])
	var flat := float(p["flat"])
	var lean_share := minf(1.0, absf(lean) / deg_to_rad(25.0))
	var off := Vector3((1.0 - flat) * float(p["lat"]) * float(st["shift"]) + flat * (-float(p["inside"]) * float(st["pelvis_slide"]) * lean_share),
		float(p["drop"]) * 0.7, float(p["long"]) * 0.7 + flat * float(st["forward"]) * minf(1.0, absf(lean) / deg_to_rad(20.0)))
	skel.reset_bone_poses()
	if not _complete() or grips.is_empty():
		root.position = base + off + g_off
		return
	if hand_rel.is_empty():
		root.position = base
		_find_hand_rel()
		skel.reset_bone_poses()
	root.position = base + off + g_off
	# the gear, the levers and the throttle
	_shift_events()
	var angle := _shift_angle(dt)
	if shifter != null:
		shifter.transform = shifter_rest * Transform3D(Basis(Vector3.RIGHT, angle), Vector3.ZERO)
	var brake := clampf(car.brake, 0.0, 1.0)
	_pull_lever("brake", brake)
	_pull_lever("clutch", float(shift["pull"]))
	var gr: Node3D = grips["right"]
	gr.transform = (grip_rest["right"] as Transform3D) * Transform3D(Basis(Vector3.RIGHT, -THROTTLE_ROLL * clampf(car.throttle, 0.0, 1.0)), Vector3.ZERO)
	var to_car := CarModel.relative(skel, car)
	var to_skel := to_car.affine_inverse()
	# the torso: flat on the tank on the throttle, back on the brake, into the bend; the give in the g-forces turns it
	# too (1.2 degrees a cm: pushed back it leans back, pushed to the side it leans that way)
	var pitch := float(st["tuck_pitch"]) * float(p["tuck"]) - float(st["sit_pitch"]) * float(p["sit"])
	var roll := -float(st["chest_roll"]) * (float(p["lat"]) / 0.3) + float(st["upright"]) * float(p["push"]) * rad_to_deg(lean)
	pitch += float(st["chest_pitch"]) * flat * minf(1.0, absf(lean) / deg_to_rad(20.0))
	pitch += 120.0 * g_off.z
	roll -= 120.0 * g_off.x
	var c: Array = cfg.get("chest", {}).get("rotation", [0, 0, 0])
	var h: Array = cfg.get("head", {}).get("rotation", [0, 0, 0])
	# (flat track: the pelvis tilts the other way from the bike, so that it stays about level with the road; the back
	# keeps the turn that it had)
	var tilt := float(st["pelvis_tilt"])
	var hip_roll := flat * clampf(0.7 * rad_to_deg(lean), -tilt, tilt)
	if bones.has("hips") and absf(hip_roll) > 1e-3 and bones["hips"] != bones.get("chest", -1):
		_turn(bones["hips"], Vector3(0.0, 0.0, hip_roll), to_skel.basis)
	if bones.has("chest"):
		_turn(bones["chest"], Vector3(float(c[0]) + pitch, float(c[1]), float(c[2]) + roll - hip_roll), to_skel.basis)
	if bones.has("head"):
		_turn(bones["head"], Vector3(float(h[0]) - 0.7 * pitch, float(h[1]) + 35.0 * float(p["look"]), float(h[2]) - 0.6 * roll), to_skel.basis)
	# the hands on the grips (the pivot is the grip and an offset in its frame); the hand keeps its turn on the grip;
	# the fingers at the levers: the left ones pull the clutch with a shift, the right ones close with the brake
	var hands: Dictionary = cfg.get("hands", {})
	var hoff: Dictionary = hands.get("offset", {})
	var hrot: Dictionary = hands.get("rotation", {}) if hands.get("rotation") is Dictionary else {}
	var rot := to_skel.basis.orthonormalized()
	for e in [[arm_left, "left", 1.0, "clutch", 0.25 + 0.5 * float(shift["pull"])], ["armR" if arm_left == "armL" else "armL", "right", -1.0, "brake", 0.25 + 0.4 * brake]]:
		var chain: Array = bones[e[0]]
		var g := CarModel.relative(grips[e[1]], car)
		var target: Vector3 = g * BoneIK.vec(hoff.get(e[1], [0, 0, 0]))
		BoneIK.solve(skel, chain, to_skel * target, to_skel * _arm_pole(chain, e[0], float(e[2]), p))
		var turn := BoneIK.euler(BoneIK.vec(hrot.get(e[1], [0, 0, 0])))
		BoneIK.set_global_basis(skel, chain[2], rot * (turn * g.basis.orthonormalized() * (hand_rel[e[1]] as Basis)))
		var lever: Variant = (CarModel.relative(levers[e[3]]["node"], car).origin) if levers.has(e[3]) else null
		_fingers_at_lever(e[0], lever, float(e[4]), to_skel)
	# the feet on the pegs (the left one on the toe peg of the shift lever as far as it moved), down on the road at a
	# standstill; the inside knee out and down in a bend
	var feet: Dictionary = cfg.get("feet", {})
	var foff: Dictionary = feet.get("offset", {})
	var ground := -car.wheels[0].radius
	var shift_move := (CarModel.relative(shifter, car) * shifter_tip - shifter_tip_at) if shifter != null else Vector3.ZERO
	for e in [[leg_left, "left", 1.0, bike.foot_down_l], ["legR" if leg_left == "legL" else "legL", "right", -1.0, bike.foot_down]]:
		var chain: Array = bones[e[0]]
		var target: Vector3 = CarModel.relative(pegs[e[1]], car) * BoneIK.vec(foff.get(e[1], [0, 0, 0]))
		if e[1] == "left":
			target += shift_move
		var down := float(e[3])
		if down > 0.001:
			target = target.lerp(Vector3(target.x + float(e[2]) * 0.04, ground + FOOT_ANKLE, target.z + 0.06), down)
		var road: Variant = null
		var push := float(p["push"]) if float(p["push"]) > 0.01 and float(p["inside"]) * float(e[2]) > 0.0 else 0.0
		var car_xf := car.global_transform
		if push > 0.0:
			# flat track: the inside foot comes off the peg and stands on the road beside it, forward and out as the
			# lean goes up (a bent knee at a small lean, stretched out beside the front wheel at the most), within
			# the reach of the leg from the hip
			var lv := clampf((rad_to_deg(absf(lean)) - 12.0) / 36.0, 0.0, 1.0)
			lv = lv * lv * (3.0 - 2.0 * lv)
			var w := car_xf * target
			var out_dir := car_xf.basis.x * float(e[2])
			out_dir.y = 0.0
			var fwd := car_xf.basis.z
			fwd.y = 0.0
			w += out_dir.normalized() * (0.1 + float(st["foot_out"]) * lv) + fwd.normalized() * (0.05 + float(st["foot_forward"]) * lv)
			road = _road_under(e[0], w)
			var ry: float = float(road) if road != null else w.y - 0.35
			var hip := skel.global_transform * BoneIK.global(skel, chain[0]).origin
			var reach := 0.97 * (BoneIK.global(skel, chain[0]).origin.distance_to(BoneIK.global(skel, chain[1]).origin)
				+ BoneIK.global(skel, chain[1]).origin.distance_to(BoneIK.global(skel, chain[2]).origin)) * scale
			w.y = ry + FOOT_ANKLE + 0.03
			if w.distance_to(hip) > reach:
				w = hip + (w - hip).normalized() * reach
			w.y = maxf(w.y, ry + FOOT_ANKLE + 0.03)
			target = target.lerp(car_xf.affine_inverse() * w, minf(1.0, push * 1.5))
		# (a foot is never below the road: a bike at a deep lean has its peg near it)
		var tw := car_xf * target
		if road == null and absf(lean) > deg_to_rad(25.0):
			road = _road_under(str(e[0]) + "p", tw)
		if road != null and tw.y < float(road) + FOOT_ANKLE:
			tw.y = float(road) + FOOT_ANKLE
			target = car_xf.affine_inverse() * tw
		var pole := _car_pos(chain[0]) + Vector3(float(e[2]) * 0.3, 0.1, 0.8)
		var knee := float(p["knee"])
		if knee > 0.01:
			var inside := float(p["inside"]) * float(e[2]) > 0.0
			pole.x += float(e[2]) * (float(st["knee_out"]) if inside else 0.25) * knee
			if inside:
				pole.y -= float(st["knee_down"]) * knee
		BoneIK.solve(skel, chain, to_skel * target, to_skel * pole)


## The road under a point (the world height of the ground, a ray down from a metre above it), smoothed and held per
## place, or null.
func _road_under(key: String, at: Vector3) -> Variant:
	var from := at + Vector3.UP * 1.0
	var ray := PhysicsRayQueryParameters3D.create(from, from + Vector3.DOWN * 4.0, 1, [car.get_rid()])
	var hit := car.get_world_3d().direct_space_state.intersect_ray(ray)
	if hit.is_empty():
		_road_hold.erase(key)
		return null
	var r := float((hit["position"] as Vector3).y)
	var held: Variant = _road_hold.get(key)
	var y := r if held == null or absf(r - float(held)) > 0.6 else float(held) + (r - float(held)) * 0.35
	_road_hold[key] = y
	return y


## The pole of an elbow (the space of the car): out, down and back from the shoulder; flat track: the inside elbow
## goes up and out.
func _arm_pole(chain: Array, _key: String, side: float, p: Dictionary) -> Vector3:
	var pole := _car_pos(chain[0]) + Vector3(side * 0.45, -0.25, -0.35)
	if float(p["push"]) > 0.01 and float(p["inside"]) * side > 0.0:
		pole += Vector3(side * 0.2, 0.35, 0.0) * float(p["push"])
	return pole


## The turn of each hand relative to its grip, found once with the rider in his neutral posture (the hand at the grip
## at rest, the arm as the inverse kinematics puts it there) and kept: a rider that hangs off does not turn his hands
## on the grips.
func _find_hand_rel() -> void:
	var to_car := CarModel.relative(skel, car)
	var to_skel := to_car.affine_inverse()
	var hoff: Dictionary = cfg.get("hands", {}).get("offset", {})
	for e in [[arm_left, "left", 1.0], ["armR" if arm_left == "armL" else "armL", "right", -1.0]]:
		var chain: Array = bones[e[0]]
		var g: Node3D = grips[e[1]]
		var keep := g.transform
		g.transform = grip_rest[e[1]]
		var target: Vector3 = CarModel.relative(g, car) * BoneIK.vec(hoff.get(e[1], [0, 0, 0]))
		g.transform = keep
		BoneIK.solve(skel, chain, to_skel * target, to_skel * (_car_pos(chain[0]) + Vector3(float(e[2]) * 0.45, -0.25, -0.35)))
		var hand := to_car.basis.orthonormalized() * BoneIK.global(skel, chain[2]).basis.orthonormalized()
		hand_rel[e[1]] = (grip_rest_car[e[1]] as Basis).inverse() * hand
