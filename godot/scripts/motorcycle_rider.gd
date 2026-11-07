class_name MotorcycleRider
extends RefCounted
## The rider on a motorcycle (web/js/Driver.js, the part for a rider): the driver.glb of car.json "driver" put in its
## place (position, rotation, scale; the model turns about its hips), the hands on the grips (they turn with the
## handlebar), the feet on the pegs and down on the road at a standstill, the elbows and the knees by a two-bone
## inverse kinematics; the body where the posture of Motorcycle.gd puts it: flat on the throttle, back on the brake,
## hanging off to the inside of a bend with the inside knee out and down, the head turned into the bend. (Not here:
## the fingers at the levers, the levers, the shift lever, the give in the g-forces, the ragdoll of a crash: the rider
## is not drawn while the bike is down.)

const FOOT_ANKLE := 0.09

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
	# (three.js Euler "XYZ": Rx Ry Rz)
	var b := Basis(Vector3.RIGHT, deg_to_rad(float(r[0]))) * Basis(Vector3.UP, deg_to_rad(float(r[1]))) * Basis(Vector3.BACK, deg_to_rad(float(r[2])))
	base = car.model_root.transform * base
	root.transform = Transform3D(car.model_root.basis * b.scaled(Vector3.ONE * (sc if sc > 0.0 else 1.0)), base)
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


static func _key(s: String) -> String:
	var out := ""
	for ch in s.to_lower():
		if (ch >= "a" and ch <= "z") or (ch >= "0" and ch <= "9"):
			out += ch
	return out


func _bone(name: String) -> int:
	var want := _key(name)
	for i in skel.get_bone_count():
		if _key(skel.get_bone_name(i)) == want:
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


## A part of the bike by its name (the grips hang on the steering head, the pegs on the body).
func _part(name: String) -> Node3D:
	var want := _key(name)
	for n in car.find_children("*", "Node3D", true, false):
		if _key(str(n.name)) == want:
			return n as Node3D
	return null


## The pose of a bone in the space of the skeleton, from the local poses as they are now.
func _global(b: int) -> Transform3D:
	var t := skel.get_bone_pose(b)
	var p := skel.get_bone_parent(b)
	while p >= 0:
		t = skel.get_bone_pose(p) * t
		p = skel.get_bone_parent(p)
	return t


func _car_pos(b: int) -> Vector3:
	return CarModel.relative(skel, car) * _global(b).origin


## Turns a bone (in the space of the skeleton) so that the direction "from" goes to "to".
func _rotate_to(b: int, from: Vector3, to: Vector3) -> void:
	if from.length_squared() < 1e-10 or to.length_squared() < 1e-10:
		return
	var f := from.normalized()
	var t := to.normalized()
	if f.dot(t) > 0.999999:
		return
	var g := _global(b).basis.orthonormalized()
	var turned := Basis(Quaternion(f, t)) * g
	var p := skel.get_bone_parent(b)
	var local := (_global(p).basis.orthonormalized().inverse() * turned) if p >= 0 else turned
	skel.set_bone_pose_rotation(b, local.get_rotation_quaternion())


## Turns a bone by degrees about the axes of the car (on top of its rest), as the car editor sets the chest and the head.
func _turn(b: int, deg: Vector3, to_skel: Basis) -> void:
	if deg.length() < 1e-6:
		return
	var q := Basis(Vector3.RIGHT, deg_to_rad(deg.x)) * Basis(Vector3.UP, deg_to_rad(deg.y)) * Basis(Vector3.BACK, deg_to_rad(deg.z))
	var in_skel := to_skel * q * to_skel.inverse()
	var g := in_skel * _global(b).basis.orthonormalized()
	var p := skel.get_bone_parent(b)
	var local := (_global(p).basis.orthonormalized().inverse() * g) if p >= 0 else g
	skel.set_bone_pose_rotation(b, local.get_rotation_quaternion())


## The inverse kinematics of two bones: the upper one points at the elbow (or the knee), which is on the side of the
## pole, the lower one at the target (all in the space of the skeleton).
func _solve(chain: Array, target: Vector3, pole: Vector3) -> void:
	var a := _global(chain[0]).origin
	var bp := _global(chain[1]).origin
	var c := _global(chain[2]).origin
	var l1 := a.distance_to(bp)
	var l2 := bp.distance_to(c)
	if l1 < 1e-5 or l2 < 1e-5:
		return
	var u := target - a
	var d := u.length()
	if d < 1e-5:
		return
	u /= d
	var reach := clampf(d, absf(l1 - l2) + 1e-3, l1 + l2 - 1e-3)
	var x := (l1 * l1 - l2 * l2 + reach * reach) / (2.0 * reach)
	var h := sqrt(maxf(0.0, l1 * l1 - x * x))
	var n := (pole - a) - u * (pole - a).dot(u)
	if n.length_squared() < 1e-8:
		n = Vector3.UP - u * u.y
	n = n.normalized()
	var elbow := a + u * x + n * h
	_rotate_to(chain[0], bp - a, elbow - a)
	bp = _global(chain[1]).origin
	c = _global(chain[2]).origin
	_rotate_to(chain[1], c - bp, a + u * reach - bp)


## Every frame: the posture, the torso, the arms and the legs.
func update(_dt: float, bike: Motorcycle) -> void:
	if skel == null:
		return
	root.visible = not bike.crashed
	if bike.crashed:
		return
	var p := bike.posture
	var st := bike.style
	var lean := float(p["lean"])
	var flat := float(p["flat"])
	var lean_share := minf(1.0, absf(lean) / deg_to_rad(25.0))
	var off := Vector3((1.0 - flat) * float(p["lat"]) * float(st["shift"]) + flat * (-float(p["inside"]) * float(st["pelvis_slide"]) * lean_share),
		float(p["drop"]) * 0.7, float(p["long"]) * 0.7 + flat * float(st["forward"]) * minf(1.0, absf(lean) / deg_to_rad(20.0)))
	root.position = base + off
	skel.reset_bone_poses()
	if not _complete() or grips.is_empty():
		return
	var to_car := CarModel.relative(skel, car)
	var to_skel := to_car.affine_inverse()
	# the torso: flat on the tank on the throttle, back on the brake, into the bend
	var pitch := float(st["tuck_pitch"]) * float(p["tuck"]) - float(st["sit_pitch"]) * float(p["sit"])
	var roll := -float(st["chest_roll"]) * (float(p["lat"]) / 0.3) + float(st["upright"]) * float(p["push"]) * rad_to_deg(lean)
	pitch += float(st["chest_pitch"]) * flat * minf(1.0, absf(lean) / deg_to_rad(20.0))
	var c: Array = cfg.get("chest", {}).get("rotation", [0, 0, 0])
	var h: Array = cfg.get("head", {}).get("rotation", [0, 0, 0])
	if bones.has("chest"):
		_turn(bones["chest"], Vector3(float(c[0]) + pitch, float(c[1]), float(c[2]) + roll), to_skel.basis)
	if bones.has("head"):
		_turn(bones["head"], Vector3(float(h[0]) - 0.7 * pitch, float(h[1]) + 35.0 * float(p["look"]), float(h[2]) - 0.6 * roll), to_skel.basis)
	# the hands on the grips (the pivot is the grip and an offset in its frame)
	var hands: Dictionary = cfg.get("hands", {})
	var hoff: Dictionary = hands.get("offset", {})
	for e in [[arm_left, "left", 1.0], ["armR" if arm_left == "armL" else "armL", "right", -1.0]]:
		var chain: Array = bones[e[0]]
		var g := CarModel.relative(grips[e[1]], car)
		var target: Vector3 = g * _vec(hoff.get(e[1], [0, 0, 0]))
		var pole := _car_pos(chain[0]) + Vector3(float(e[2]) * 0.45, -0.25, -0.35)
		if float(p["push"]) > 0.01 and float(p["inside"]) * float(e[2]) > 0.0:
			pole += Vector3(float(e[2]) * 0.2, 0.35, 0.0) * float(p["push"])
		_solve(chain, to_skel * target, to_skel * pole)
	# the feet on the pegs, down on the road at a standstill; the inside knee out and down in a bend
	var feet: Dictionary = cfg.get("feet", {})
	var foff: Dictionary = feet.get("offset", {})
	var ground := -car.wheels[0].radius
	for e in [[leg_left, "left", 1.0, bike.foot_down_l], ["legR" if leg_left == "legL" else "legL", "right", -1.0, bike.foot_down]]:
		var chain: Array = bones[e[0]]
		var target: Vector3 = CarModel.relative(pegs[e[1]], car) * _vec(foff.get(e[1], [0, 0, 0]))
		var down := float(e[3])
		if down > 0.001:
			target = target.lerp(Vector3(target.x + float(e[2]) * 0.04, ground + FOOT_ANKLE, target.z + 0.06), down)
		var pole := _car_pos(chain[0]) + Vector3(float(e[2]) * 0.3, 0.1, 0.8)
		var knee := float(p["knee"])
		if knee > 0.01:
			var inside := float(p["inside"]) * float(e[2]) > 0.0
			pole.x += float(e[2]) * (float(st["knee_out"]) if inside else 0.25) * knee
			if inside:
				pole.y -= float(st["knee_down"]) * knee
		_solve(chain, to_skel * target, to_skel * pole)


static func _vec(a: Variant) -> Vector3:
	if a is Array and (a as Array).size() >= 3:
		return Vector3(float(a[0]), float(a[1]), float(a[2]))
	return Vector3.ZERO
