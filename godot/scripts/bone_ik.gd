class_name BoneIK
extends RefCounted
## What the driver of a car (CarDriver) and the rider of a motorcycle (MotorcycleRider) share (web/js/Driver.js): the
## bones of a Skeleton3D by name, their poses in the space of the skeleton, a bone turned so that it points somewhere,
## the inverse kinematics of two bones (an arm, a leg) with the elbow or the knee to the side of a pole, and the Euler
## angles of the browser game (three.js "XYZ", degrees).


## A name for comparing: lower case, letters and digits only (three.js takes the dots out of the names of a glb:
## "DEF-upper_arm.L" is "DEF-upper_armL" in car.json).
static func key(s: String) -> String:
	var out := ""
	for ch in s.to_lower():
		if (ch >= "a" and ch <= "z") or (ch >= "0" and ch <= "9"):
			out += ch
	return out


## The name of a bone as the browser game has it (three.js PropertyBinding.sanitizeNodeName: no [ ] . : /, spaces are _).
static func browser_name(s: String) -> String:
	var out := ""
	for ch in s:
		if ch in ["[", "]", ".", ":", "/"]:
			continue
		out += "_" if ch == " " or ch == "\t" else ch
	return out


## A bone by its name (the name of the browser or of the glb), or -1.
static func find(skel: Skeleton3D, bone_name: String) -> int:
	if bone_name == "":
		return -1
	var exact := skel.find_bone(bone_name)
	if exact >= 0:
		return exact
	var want := key(bone_name)
	for i in skel.get_bone_count():
		if key(skel.get_bone_name(i)) == want:
			return i
	return -1


## The pose of a bone in the space of the skeleton, from the local poses as they are now (Godot works out the poses
## that changed when they are asked for).
static func global(skel: Skeleton3D, b: int) -> Transform3D:
	return skel.get_bone_global_pose(b)


## Gives a bone the turn g in the space of the skeleton (its local turn is worked out from its parent as it is now).
static func set_global_basis(skel: Skeleton3D, b: int, g: Basis) -> void:
	var p := skel.get_bone_parent(b)
	var local := (global(skel, p).basis.orthonormalized().inverse() * g) if p >= 0 else g
	skel.set_bone_pose_rotation(b, local.orthonormalized().get_rotation_quaternion())


## Turns a bone (in the space of the skeleton) so that the direction "from" goes to "to".
static func rotate_to(skel: Skeleton3D, b: int, from: Vector3, to: Vector3) -> void:
	if from.length_squared() < 1e-10 or to.length_squared() < 1e-10:
		return
	var f := from.normalized()
	var t := to.normalized()
	if f.dot(t) > 0.999999:
		return
	set_global_basis(skel, b, Basis(Quaternion(f, t)) * global(skel, b).basis.orthonormalized())


## The inverse kinematics of two bones: the upper one points at the elbow (or the knee), which is on the side of the
## pole, the lower one at the target (all in the space of the skeleton). reset: the two bones start from their rest
## turn (Driver.js solve; the rider resets the whole skeleton once a frame instead).
static func solve(skel: Skeleton3D, chain: Array, target: Vector3, pole: Vector3, reset := false) -> void:
	if reset:
		for i in 2:
			skel.set_bone_pose_rotation(chain[i], skel.get_bone_rest(chain[i]).basis.get_rotation_quaternion())
	var a := global(skel, chain[0]).origin
	var bp := global(skel, chain[1]).origin
	var c := global(skel, chain[2]).origin
	var l1 := a.distance_to(bp)
	var l2 := bp.distance_to(c)
	if l1 < 1e-5 or l2 < 1e-5:
		return
	var u := target - a
	var d := u.length()
	if d < 1e-5:
		return
	u /= d
	var reach := clampf(d, absf(l1 - l2) + 1e-3, l1 + l2 - 1e-3)       # (out of reach: the arm stretches towards the target)
	var x := (l1 * l1 - l2 * l2 + reach * reach) / (2.0 * reach)
	var h := sqrt(maxf(0.0, l1 * l1 - x * x))
	var n := (pole - a) - u * (pole - a).dot(u)
	if n.length_squared() < 1e-8:
		n = Vector3.UP - u * u.y
	n = n.normalized()
	var elbow := a + u * x + n * h
	rotate_to(skel, chain[0], bp - a, elbow - a)
	bp = global(skel, chain[1]).origin
	c = global(skel, chain[2]).origin
	rotate_to(skel, chain[1], c - bp, a + u * reach - bp)


## The turn of three.js Euler angles in degrees, order "XYZ" (Rx * Ry * Rz).
static func euler(deg: Vector3) -> Basis:
	return Basis(Vector3.RIGHT, deg_to_rad(deg.x)) * Basis(Vector3.UP, deg_to_rad(deg.y)) * Basis(Vector3.BACK, deg_to_rad(deg.z))


## The three.js Euler angles ("XYZ", degrees) of a turn (Euler.setFromRotationMatrix).
static func euler_deg(b: Basis) -> Vector3:
	var m := b.orthonormalized()
	# (m_rc: row r, column c; a Basis holds its columns)
	var m13 := m.z.x
	var y := asin(clampf(m13, -1.0, 1.0))
	var x := 0.0
	var z := 0.0
	if absf(m13) < 0.9999999:
		x = atan2(-m.z.y, m.z.z)
		z = atan2(-m.y.x, m.x.x)
	else:
		x = atan2(m.y.z, m.y.y)
	return Vector3(rad_to_deg(x), rad_to_deg(y), rad_to_deg(z))


static func vec(a: Variant) -> Vector3:
	if a is Array and (a as Array).size() >= 3:
		return Vector3(float(a[0]), float(a[1]), float(a[2]))
	return Vector3.ZERO


## A vector as car.json keeps it (rounded to a millimetre, or to a tenth for degrees).
static func arr(v: Vector3, step := 0.001) -> Array:
	return [snappedf(v.x, step), snappedf(v.y, step), snappedf(v.z, step)]
