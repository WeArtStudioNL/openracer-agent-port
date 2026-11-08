class_name RacingLine
extends RefCounted
## The line that the AI drives and that the race is measured along (web/js/RacingLine.js): a closed loop of points
## 2 m apart ("racing_line" of track.json), with for every point the speed that a car can take there, from the
## curvature of the line and the braking that the bends ahead ask for.

const STEP := 2.0

var points := PackedVector3Array()
var speeds := PackedFloat32Array()
var length := 0.0


static func from_track(cfg: Dictionary) -> RacingLine:
	var raw: Array = cfg.get("racing_line", [])
	if raw.size() < 10:
		raw = _from_design(cfg)
	if raw.size() < 10:
		return null
	var line := RacingLine.new()
	var src := PackedVector3Array()
	for p in raw:
		var v := Vector3(float(p.get("x", 0)), float(p.get("y", 0)), float(p.get("z", 0)))
		if src.is_empty() or Vector2(v.x - src[-1].x, v.z - src[-1].z).length() > 0.05:
			src.append(v)
	src.append(src[0])
	# resampled every STEP metres, so that an index is a distance along the line
	line.points.append(src[0])
	var carry := 0.0
	for i in range(1, src.size()):
		var a := src[i - 1]
		var b := src[i]
		var d := Vector2(b.x - a.x, b.z - a.z).length()
		var pos := carry
		while pos < d:
			line.points.append(a.lerp(b, pos / d))
			pos += STEP
		carry = pos - d
	line.points.remove_at(0)
	line.length = line.points.size() * STEP
	return line


## A designed track without a recorded line: the middle of the road (RacingLine.fromDesign), in the direction of the start.
static func _from_design(cfg: Dictionary) -> Array:
	var design: Variant = cfg.get("design")
	if not (design is Dictionary) or not (design.get("nodes") is Array) or (design["nodes"] as Array).size() < 3:
		return []
	var pts := PackedVector3Array()
	for n in design["nodes"]:
		pts.append(Vector3(float(n.get("x", 0)), float(n.get("y", 0)), float(n.get("z", 0))))
	var curve := CatmullRom.make(pts, design.get("closed", true) != false)
	var samples := maxi(32, roundi(curve.length() / 2.0))
	var out: Array = []
	for i in samples:
		var p := curve.point_at(float(i) / samples)
		out.append({"x": p.x, "y": p.y, "z": p.z})
	# (the line runs the way the track is driven: the direction of the start)
	var start: Dictionary = cfg.get("start", {})
	var sx := float(start.get("x", 0))
	var sz := float(start.get("z", 0))
	var best := 0
	var best_d := INF
	for i in out.size():
		var d := Vector2(out[i]["x"] - sx, out[i]["z"] - sz).length_squared()
		if d < best_d:
			best_d = d
			best = i
	var a: Dictionary = out[best]
	var b: Dictionary = out[(best + 1) % out.size()]
	if cos(atan2(b["z"] - a["z"], b["x"] - a["x"]) - float(start.get("heading", 0))) < 0.0:
		out.reverse()
	return out


func count() -> int:
	return points.size()


func point(i: int) -> Vector3:
	return points[posmod(i, points.size())]


## The index of the point nearest to pos, searched around hint when it is given (-1: all of them).
func nearest(pos: Vector3, hint := -1) -> int:
	var best := 0
	var best_d := INF
	var n := points.size()
	if hint < 0:
		for i in n:
			var d := Vector2(points[i].x - pos.x, points[i].z - pos.z).length_squared()
			if d < best_d:
				best_d = d
				best = i
		return best
	for k in range(-30, 60):
		var i := posmod(hint + k, n)
		var d := Vector2(points[i].x - pos.x, points[i].z - pos.z).length_squared()
		if d < best_d:
			best_d = d
			best = i
	return best


## The nearest point whose direction goes the way of dir (within 60 degrees): where a car that faces dir is on
## the line, also where the track runs past itself (the start of a track that passes close by a later part).
func nearest_facing(pos: Vector3, dir: Vector3) -> int:
	var best := 0
	var best_d := INF
	var flat := Vector2(dir.x, dir.z).normalized()
	for i in points.size():
		var a := points[i]
		var b := point(i + 2)
		var along := Vector2(b.x - a.x, b.z - a.z).normalized()
		if along.dot(flat) < 0.5:
			continue
		var d := Vector2(a.x - pos.x, a.z - pos.z).length_squared()
		if d < best_d:
			best_d = d
			best = i
	return best if best_d < INF else nearest(pos)


## The speed at every point (computeSpeeds of RacingLine.js): the bend (lateral acceleration a_lat), the braking
## (a_brake) that the slower points ahead ask for, at most v_max.
func compute_speeds(a_lat: float, a_brake: float, v_max: float) -> PackedFloat32Array:
	var n := points.size()
	speeds = PackedFloat32Array()
	speeds.resize(n)
	for i in n:
		var a := point(i - 4)
		var b := point(i)
		var c := point(i + 4)
		var ab := Vector2(b.x - a.x, b.z - a.z)
		var bc := Vector2(c.x - b.x, c.z - b.z)
		var ac := Vector2(c.x - a.x, c.z - a.z)
		var cross := ab.x * bc.y - ab.y * bc.x
		var den := ab.length() * bc.length() * ac.length()
		var curvature := absf(2.0 * cross / den) if den > 1e-6 else 0.0
		speeds[i] = minf(v_max, sqrt(a_lat / curvature)) if curvature > 1e-4 else v_max
		speeds[i] = maxf(6.0, speeds[i])
	for _pass in 2:
		for k in range(n - 1, -1, -1):
			var nxt := (k + 1) % n
			var allowed := sqrt(speeds[nxt] * speeds[nxt] + 2.0 * a_brake * STEP)
			if speeds[k] > allowed:
				speeds[k] = allowed
	return speeds


## The braking before the points: no point may be faster than the next one allows (after a change of the speeds).
static func brake_pass(sp: PackedFloat32Array, a_brake: float) -> void:
	var n := sp.size()
	for k in range(n - 1, -1, -1):
		var nxt := (k + 1) % n
		var allowed := sqrt(sp[nxt] * sp[nxt] + 2.0 * a_brake * STEP)
		if sp[k] > allowed:
			sp[k] = allowed
