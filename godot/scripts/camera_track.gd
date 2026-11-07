class_name CameraTrack
extends RefCounted
## A camera track for a replay (web/js/CameraTrack.js): a list of keys (made in the video editor and kept in a
## replay file as "camera"), and what the camera does between them. A key is a Dictionary
## { t, pos: [x, y, z], yaw, pitch, roll, fov, parent, sky, aim, target, cut }:
##   t        the time in the replay (seconds)
##   pos      the place of the camera in the world, or, when it is parented, in the frame of the car
##   yaw, pitch   where it looks (radians, the order YXZ; in the frame of the car when parented), unless aim is on
##   roll     the tilt of the picture (radians)
##   fov      the vertical field of view (degrees)
##   parent   the camera goes with the car; sky (with parent): with its place only, the sky stays up
##   aim      the camera points at the car (0.7 m above its middle)
##   target   the car (0 the player, 1 and up the opponents)
##   cut      the camera does not move to this key from the one before: it holds that one and jumps here at t
## Between two keys the camera moves smoothly (slow at both ends). Before the first and after the last it stays.
## The same keys as the browser game: a replay file of either has the same "camera".

const MAX_KEYS := 500


static func _num(x: Variant, fallback: float) -> float:
	if x is float or x is int:
		var f := float(x)
		return f if is_finite(f) else fallback
	return fallback


## A list that came from a file: only keys with numbers in them, in the order of time.
static func clean(keys: Variant) -> Array:
	var out: Array = []
	if not (keys is Array):
		return out
	for k in keys:
		if out.size() >= MAX_KEYS:
			break
		if not (k is Dictionary) or not (k.get("pos") is Array) or (k["pos"] as Array).size() != 3:
			continue
		var ok := true
		for x in k["pos"]:
			if not (x is float or x is int) or not is_finite(float(x)) or absf(float(x)) > 1e6:
				ok = false
		if not ok:
			continue
		var parent := bool(k.get("parent", false))
		out.append({"t": maxf(0.0, _num(k.get("t"), 0.0)), "pos": [float(k["pos"][0]), float(k["pos"][1]), float(k["pos"][2])],
			"yaw": _num(k.get("yaw"), 0.0), "pitch": clampf(_num(k.get("pitch"), 0.0), -1.55, 1.55),
			"roll": clampf(_num(k.get("roll"), 0.0), -PI, PI), "fov": clampf(_num(k.get("fov"), 60.0), 8.0, 110.0),
			"parent": parent, "sky": parent and bool(k.get("sky", false)), "aim": bool(k.get("aim", false)),
			"target": clampi(int(_num(k.get("target"), 0.0)), 0, 11), "cut": bool(k.get("cut", false))})
	out.sort_custom(func(a, b): return a["t"] < b["t"])
	return out


## The place and the look of a key in the world now (the car moves: a key that goes with it is worked out every time).
static func pose(k: Dictionary, body: Node3D) -> Transform3D:
	var p := Vector3(k["pos"][0], k["pos"][1], k["pos"][2])
	var bxf := body.global_transform if body != null else Transform3D.IDENTITY
	var q := bxf.basis.get_rotation_quaternion()
	if bool(k["parent"]) and body != null:
		p = p + bxf.origin if bool(k["sky"]) else bxf.origin + q * p
	var basis: Basis
	if bool(k["aim"]) and body != null:
		var at := bxf.origin + Vector3.UP * 0.7
		basis = Basis.looking_at(at - p, Vector3.UP) if (at - p).length() > 1e-4 else Basis.IDENTITY
		if float(k["roll"]) != 0.0:
			basis = basis * Basis(Vector3.BACK, float(k["roll"]))
	else:
		basis = Basis.from_euler(Vector3(k["pitch"], k["yaw"], k["roll"]))
		if bool(k["parent"]) and body != null and not bool(k["sky"]):
			basis = Basis(q) * basis
	return Transform3D(basis.orthonormalized(), p)


static func _smooth(f: float) -> float:
	f = clampf(f, 0.0, 1.0)
	return f * f * (3.0 - 2.0 * f)


## Puts the camera where the track says at a time; body_of(i) gives the body of car i. False when there are no keys.
static func apply(keys: Array, time: float, cam: Camera3D, body_of: Callable) -> bool:
	if keys.is_empty():
		return false
	var n := keys.size()
	var i := 0
	while i < n - 1 and float(keys[i + 1]["t"]) <= time:
		i += 1
	var a: Dictionary = keys[i]
	var b: Dictionary = keys[mini(n - 1, i + 1)]
	var xf := pose(a, body_of.call(int(a["target"])))
	var fov := float(a["fov"])
	if b != a and time > float(a["t"]) and not bool(b["cut"]):
		var f := _smooth((time - float(a["t"])) / maxf(1e-6, float(b["t"]) - float(a["t"])))
		var xb := pose(b, body_of.call(int(b["target"])))
		var qa := xf.basis.get_rotation_quaternion()
		var qb := xb.basis.get_rotation_quaternion()
		xf = Transform3D(Basis(qa.slerp(qb, f)), xf.origin.lerp(xb.origin, f))
		fov = lerpf(fov, float(b["fov"]), f)
	cam.global_transform = xf
	cam.fov = fov
	cam.near = 0.03
	return true


## A key from the free camera of the replay (ReplayFreeCamera) as it is now.
static func from_free(free: ReplayFreeCamera, time: float) -> Dictionary:
	return {"t": time, "pos": [free.pos.x, free.pos.y, free.pos.z], "yaw": free.yaw, "pitch": free.pitch, "roll": free.roll,
		"fov": free.fov_now, "parent": free.parent, "sky": free.parent and free.sky, "aim": free.aim, "target": free.target, "cut": false}


## The free camera of the replay put where a key is.
static func to_free(free: ReplayFreeCamera, k: Dictionary) -> void:
	free.pos = Vector3(k["pos"][0], k["pos"][1], k["pos"][2])
	free.vel = Vector3.ZERO
	free.yaw = float(k["yaw"])
	free.yaw_t = free.yaw
	free.pitch = float(k["pitch"])
	free.pitch_t = free.pitch
	free.roll = float(k["roll"])
	free.roll_t = free.roll
	free.fov_now = float(k["fov"])
	free.fov_t = free.fov_now
	free.parent = bool(k["parent"])
	free.sky = bool(k["parent"]) and bool(k["sky"])
	free.aim = bool(k["aim"])
	free.target = int(k["target"])
