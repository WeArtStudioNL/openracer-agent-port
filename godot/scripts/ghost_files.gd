class_name GhostFiles
extends RefCounted
## The ghost as a file (web/js/Ghost.js download and open): the best lap of a car on a track as an `.openracer-ghost`
## (JSON: format, version, track, car { id, name }, name, time, created, samples of t, x y z, qx qy qz qw, the four
## wheel centres in the world, the steering s and the spin r), to send, and the lap of such a file raced as the ghost.
## The files of the browser game open here and the other way round: the place of the body is fitted to the wheel
## centres (the body of the browser has its origin elsewhere), and a file written here says "engine": "godot".
## The ghost of a file is kept per track and car (the browser keeps it in its storage) until "Own lap".

const MAX_BYTES := 20 * 1048576


## The folder the saved laps go to (Downloads, as the browser; --ghost-dir for the tests).
static func out_dir() -> String:
	var d := Content.arg("ghost-dir")
	if d != "":
		return d
	var dl := OS.get_system_dir(OS.SYSTEM_DIR_DOWNLOADS)
	return dl if dl != "" else ProjectSettings.globalize_path("user://")


static func _r(v: float, n: int) -> float:
	var f := pow(10.0, n)
	return roundf(v * f) / f


## The best lap of laps as the data of a ghost file, or {} when there is none.
static func to_data(laps: LapTimer, player_name := "") -> Dictionary:
	var src := laps.best_samples()
	var car := laps.car
	var n := src.size() / LapTimer.FIELDS
	if n < 10 or laps.best_lap <= 0.0:
		return {}
	var samples: Array = []
	var spin := 0.0
	var r0 := car.wheels[0].radius
	for i in n:
		var a := i * LapTimer.FIELDS
		var o := Vector3(src[a], src[a + 1], src[a + 2])
		var q := Quaternion(src[a + 3], src[a + 4], src[a + 5], src[a + 6]).normalized()
		var w: Array = []
		for k in 4:
			var wh: Car.Wheel = car.wheels[k]
			var c := o + q * (wh.hub + Vector3.UP * (car.susp_length - src[a + 8 + k]))
			w.append([_r(c.x, 3), _r(c.y, 3), _r(c.z, 3)])
		if i > 0:
			spin = fmod(spin + o.distance_to(Vector3(src[a - LapTimer.FIELDS], src[a - LapTimer.FIELDS + 1], src[a - LapTimer.FIELDS + 2])) / r0, TAU)
		samples.append({"t": _r(i / LapTimer.RATE, 3), "x": _r(o.x, 3), "y": _r(o.y, 3), "z": _r(o.z, 3),
			"qx": _r(q.x, 4), "qy": _r(q.y, 4), "qz": _r(q.z, 4), "qw": _r(q.w, 4), "w": w, "s": _r(src[a + 7], 3), "r": _r(spin, 2)})
	return {"format": "openracer-ghost", "version": 1, "engine": "godot", "track": laps.track_id,
		"car": {"id": car.car_id, "name": str(car.config.get("name", car.car_id))}, "name": player_name,
		"time": laps.best_lap, "created": Time.get_datetime_string_from_system(true) + "Z", "samples": samples}


## The name of the file of a lap (as the browser names it).
static func file_name(track_id: String, car_id: String, time: float) -> String:
	var clean := func(s: String) -> String:
		var out := ""
		for ch in s:
			if (ch >= "a" and ch <= "z") or (ch >= "A" and ch <= "Z") or (ch >= "0" and ch <= "9") or ch == "_" or ch == "-":
				out += ch
		return out
	return "ghost-%s-%s-%s.openracer-ghost" % [clean.call(track_id), clean.call(car_id), LapTimer.format_time(time).replace(":", "-").replace(".", "-")]


## Saves the best lap of laps as a file in dir: its path, or "" when there is no best lap.
static func save_best(laps: LapTimer, dir := "", player_name := "") -> String:
	var data := to_data(laps, player_name)
	if data.is_empty():
		return ""
	if dir == "":
		dir = out_dir()
	DirAccess.make_dir_recursive_absolute(dir)
	var path := dir.path_join(file_name(laps.track_id, laps.car.car_id, laps.best_lap))
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f == null:
		return ""
	f.store_string(JSON.stringify(data))
	f.close()
	RunLog.event("ghost: the best lap %s saved as %s" % [LapTimer.format_time(laps.best_lap), path])
	return path


static func _num(v: Variant) -> bool:
	return (v is float or v is int) and is_finite(float(v))


## Every number of every sample, the four wheels as three numbers each, the times going up (Ghost.js validSamples).
static func valid_samples(samples: Variant) -> bool:
	if not (samples is Array) or (samples as Array).size() < 10:
		return false
	var prev := -INF
	for s: Variant in samples:
		if not (s is Dictionary):
			return false
		for k in ["t", "x", "y", "z", "qx", "qy", "qz", "qw"]:
			if not _num(s.get(k)):
				return false
		if not (float(s["t"]) > prev):
			return false
		prev = float(s["t"])
		var w: Variant = s.get("w")
		if not (w is Array) or (w as Array).size() < 4:
			return false
		for k in 4:
			var p: Variant = w[k]
			if not (p is Array) or (p as Array).size() < 3 or not _num(p[0]) or not _num(p[1]) or not _num(p[2]):
				return false
	return true


## The data of a ghost file as the ghost of laps: { name, time, samples (LapTimer's: 30 a second) }, or { error }.
static func read(laps: LapTimer, text: String) -> Dictionary:
	var d: Variant = JSON.parse_string(text)
	if not (d is Dictionary) or d.get("format") != "openracer-ghost" or not (d.get("samples") is Array) or (d["samples"] as Array).size() < 10:
		return {"error": "This is not a ghost file."}
	if str(d.get("track")) != laps.track_id:
		return {"error": "This ghost is for another track (%s)." % str(d.get("track")).substr(0, 40)}
	if not valid_samples(d["samples"]) or not _num(d.get("time")) or float(d["time"]) <= 0.0:
		return {"error": "This ghost file is damaged."}
	var car_name := ""
	if d.get("car") is Dictionary:
		car_name = str(d["car"].get("name", ""))
	var name := str(d.get("name", "")) if str(d.get("name", "")) != "" else (car_name if car_name != "" else "Ghost")
	return {"name": name.substr(0, 40), "time": float(d["time"]), "samples": to_samples(laps.car, d["samples"], d.get("engine") == "godot"),
		"text": text}


## The samples of a file as LapTimer's (position, rotation, steering, the four spring lengths; 30 a second from t = 0).
## own: written by the Godot game (x y z is the origin of this body), else the origin comes from the wheel centres.
static func to_samples(car: Car, samples: Array, own: bool) -> PackedFloat32Array:
	var rows: Array = []
	for s: Dictionary in samples:
		var q := Quaternion(float(s["qx"]), float(s["qy"]), float(s["qz"]), float(s["qw"])).normalized()
		var given := Vector3(float(s["x"]), float(s["y"]), float(s["z"]))
		var centres: Array[Vector3] = []
		for k in 4:
			centres.append(Vector3(float(s["w"][k][0]), float(s["w"][k][1]), float(s["w"][k][2])))
		var o := given
		if not own:
			var sum := Vector3.ZERO
			for k in 4:
				sum += centres[k] - q * car.wheels[k].hub
			var fit := sum / 4.0
			if fit.distance_to(given) < 3.0:
				o = fit
		var lengths: Array[float] = []
		for k in 4:
			var local := q.inverse() * (centres[k] - o)
			lengths.append(clampf(car.susp_length - (local.y - car.wheels[k].hub.y), 0.0, car.susp_length + car.droop))
		rows.append([float(s["t"]), o, q, float(s.get("s", 0.0)) if _num(s.get("s", 0.0)) else 0.0, lengths])
	var out := PackedFloat32Array()
	var t0: float = rows[0][0]
	var end: float = rows[-1][0] - t0
	var j := 0
	var i := 0
	while i / LapTimer.RATE <= end:
		var t := t0 + i / LapTimer.RATE
		while j < rows.size() - 2 and rows[j + 1][0] <= t:
			j += 1
		var a: Array = rows[j]
		var b: Array = rows[j + 1]
		var f := clampf((t - a[0]) / maxf(1e-6, b[0] - a[0]), 0.0, 1.0)
		var p: Vector3 = (a[1] as Vector3).lerp(b[1], f)
		var q: Quaternion = (a[2] as Quaternion).slerp(b[2], f)
		out.append_array([p.x, p.y, p.z, q.x, q.y, q.z, q.w, lerpf(a[3], b[3], f)])
		for k in 4:
			out.append(lerpf(a[4][k], b[4][k], f))
		i += 1
	return out


## Opens a ghost file and races it: "" or what was wrong.
static func open(laps: LapTimer, path: String) -> String:
	if not FileAccess.file_exists(path):
		return "The file is not there."
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null or f.get_length() > MAX_BYTES:
		return "This file is too large to be a ghost."
	var g := read(laps, f.get_as_text())
	if g.has("error"):
		return str(g["error"])
	DirAccess.make_dir_recursive_absolute(laps.ghosts_dir)
	var keep := FileAccess.open(_friend_path(laps), FileAccess.WRITE)
	if keep != null:
		keep.store_string(str(g["text"]))
	g.erase("text")
	laps.set_friend(g)
	RunLog.event("ghost: racing %s %s (%s)" % [g["name"], LapTimer.format_time(g["time"]), path.get_file()])
	return ""


static func _friend_path(laps: LapTimer) -> String:
	return laps.ghosts_dir.path_join("friend__%s__%s.openracer-ghost" % [laps.track_id, laps.car.car_id.validate_filename()])


## The ghost of a file that is kept for this track and car ({} when there is none).
static func load_friend(laps: LapTimer) -> Dictionary:
	var p := _friend_path(laps)
	if not FileAccess.file_exists(p):
		return {}
	var g := read(laps, FileAccess.get_file_as_string(p))
	if g.has("error"):
		return {}
	g.erase("text")
	return g


static func forget_friend(laps: LapTimer) -> void:
	var p := _friend_path(laps)
	if FileAccess.file_exists(p):
		DirAccess.remove_absolute(p)
