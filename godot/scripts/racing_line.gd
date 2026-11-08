class_name RacingLine
extends RefCounted
## The line that the AI drives and that the race is measured along (web/js/RacingLine.js): a closed loop of points
## 2 m apart ("racing_line" of track.json), with for every point the speed that a car can take there, from the
## curvature of the line and the braking that the bends ahead ask for.

const STEP := 2.0

var points := PackedVector3Array()
var speeds := PackedFloat32Array()
var surfaces := PackedStringArray()  # the surface under every point (settle; empty before it)
var length := 0.0
var driven := false                  # the line of a lap that was driven (not shortened: it is the way a driver went)


static func from_track(cfg: Dictionary) -> RacingLine:
	var raw: Array = cfg.get("racing_line", [])
	if raw.size() < 10:
		raw = _from_design(cfg)
	return _build(raw)


## The line of a lap that was driven (LapTimer's samples: the place of the body 30 times a second; RacingLine.fromLap):
## a lap wobbles and its ends do not meet, so it is smoothed (a moving average over 10 m, four times, round the loop).
static func from_lap(samples: PackedFloat32Array) -> RacingLine:
	var n := samples.size() / LapTimer.FIELDS
	if n < 10:
		return null
	var pts: Array[Vector3] = []
	for i in n:
		var a := i * LapTimer.FIELDS
		pts.append(Vector3(samples[a], samples[a + 1], samples[a + 2]))
	var half := 5
	if n >= 2 * half + 3:
		for _pass in 4:
			var next: Array[Vector3] = []
			for i in n:
				var sum := Vector3.ZERO
				for k in range(-half, half + 1):
					sum += pts[posmod(i + k, n)]
				next.append(sum / (2 * half + 1))
			pts = next
	var raw: Array = []
	for p in pts:
		raw.append({"x": p.x, "y": p.y, "z": p.z})
	var line := _build(raw)
	if line != null:
		line.driven = true
	return line


## The best lap that any car drove on a track since its road or line was last changed (Records.anyGhost, track.json
## line_date): the samples, or empty. records and ghosts: the files of LapTimer.
static func best_lap_of(track_id: String, line_date: String, records := LapTimer.RECORDS, ghosts := LapTimer.GHOSTS) -> PackedFloat32Array:
	var cfg := ConfigFile.new()
	if cfg.load(records) != OK or not cfg.has_section(track_id):
		return PackedFloat32Array()
	var best_key := ""
	var best_time := INF
	for k in cfg.get_section_keys(track_id):
		if k.contains(":"):
			continue
		var t := float(cfg.get_value(track_id, k, -1.0))
		if t <= 0.0 or t >= best_time:
			continue
		if line_date != "" and not (str(cfg.get_value(track_id, k + ":date", "")) > line_date):
			continue
		if not FileAccess.file_exists(ghosts.path_join(LapTimer.ghost_file(track_id, k))):
			continue
		best_time = t
		best_key = k
	if best_key == "":
		return PackedFloat32Array()
	var v: Variant = bytes_to_var(FileAccess.get_file_as_bytes(ghosts.path_join(LapTimer.ghost_file(track_id, best_key))))
	return v if v is PackedFloat32Array else PackedFloat32Array()


## Saves a lap that was driven as "racing_line" of a track (RacingLine.save): every third sample, rounded to
## centimetres, with line_date, in the track.json of the garage (only the json: the files stay the game's). The
## number of points, or -1 when it could not be written.
static func save_lap(track_id: String, samples: PackedFloat32Array) -> int:
	var cfg: Variant = Content.load_json("tracks/%s/track.json" % track_id)
	if not (cfg is Dictionary):
		return -1
	var line: Array = []
	var n := samples.size() / LapTimer.FIELDS
	for i in range(0, n, 3):
		var a := i * LapTimer.FIELDS
		line.append({"x": roundf(samples[a] * 100.0) / 100.0, "y": roundf(samples[a + 1] * 100.0) / 100.0,
			"z": roundf(samples[a + 2] * 100.0) / 100.0})
	cfg.erase("id")
	cfg["racing_line"] = line
	cfg["line_date"] = Time.get_datetime_string_from_system(true) + "Z"
	var file := Content.path("tracks/%s/track.json" % track_id)
	var garage_file := false
	for r in Garage.roots():
		if file.begins_with(r):
			garage_file = true
	if not garage_file:
		file = Garage.roots()[0].path_join("tracks").path_join(track_id).path_join("track.json")
	DirAccess.make_dir_recursive_absolute(file.get_base_dir())
	var f := FileAccess.open(file, FileAccess.WRITE)
	if f == null:
		return -1
	f.store_string(JSON.stringify(cfg, "  ", false))
	f.close()
	RunLog.event("racing line of %s saved from a lap (%d points) in %s" % [track_id, line.size(), file])
	return line.size()


static func _build(raw: Array) -> RacingLine:
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


## The line the other way round (a track can be drawn against the direction in which it is driven).
func reverse() -> void:
	points.reverse()
	surfaces.reverse()
	speeds = PackedFloat32Array()


## The direction of the line at its point nearest to (x, z), as a heading from +x towards +z.
func heading_at(x: float, z: float) -> float:
	var i := nearest(Vector3(x, 0, z))
	var a := point(i)
	var b := point(i + 1)
	return atan2(b.z - a.z, b.x - a.x)


## The road at (x, z) (GroundWorld.query): the first thing of the track below y_top, { y, surface }, or {} when there
## is nothing.
static func ground_query(space: PhysicsDirectSpaceState3D, x: float, z: float, y_top: float) -> Dictionary:
	var hit := space.intersect_ray(PhysicsRayQueryParameters3D.create(Vector3(x, y_top, z), Vector3(x, -2000.0, z), 1))
	if hit.is_empty():
		return {}
	var col: Object = hit["collider"]
	return {"y": float(hit["position"].y), "surface": str(col.get_meta("surface", "road")) if col != null else "road"}


## The heights of the points from the road and the surface under each (RacingLine.settle): the surface at the height
## of the point (under a bridge the road, not the deck above it); a point with no surface near its height (a line
## drawn flat, at 0) takes the highest one.
func settle(space: PhysicsDirectSpaceState3D) -> void:
	surfaces.resize(points.size())
	for i in points.size():
		var p := points[i]
		var road := ground_query(space, p.x, p.z, p.y + 1.5)
		if road.is_empty() or float(road["y"]) < p.y - 1.5:
			var top := ground_query(space, p.x, p.z, 2000.0)
			if not top.is_empty():
				road = top
		if not road.is_empty():
			points[i] = Vector3(p.x, road["y"], p.z)
			surfaces[i] = road["surface"]


## A line drawn along the middle of the road is not the quickest way round (RacingLine.shorten): every point moves
## sideways within the road (the ground there is the surface of the line, up to margin metres from its edge) to the
## smoothest line there is (a bend cut, a straight kept straight). The points are probed to either side every half
## metre, up to reach metres; a point with no room (a one-lane stretch, a bridge) stays where it is. After settle.
func shorten(space: PhysicsDirectSpaceState3D, margin := 1.5, reach := 6.0) -> void:
	var n := points.size()
	if n < 8 or surfaces.size() != n:
		return
	var base := points.duplicate()
	var nrm := PackedVector2Array()
	nrm.resize(n)
	var left := PackedFloat32Array()
	var right := PackedFloat32Array()
	left.resize(n)
	right.resize(n)
	for i in n:
		var t := Vector2(base[(i + 1) % n].x - base[posmod(i - 1, n)].x, base[(i + 1) % n].z - base[posmod(i - 1, n)].z)
		var tl := t.length() if t.length() > 0.0 else 1.0
		nrm[i] = Vector2(-t.y / tl, t.x / tl)             # (to the left of the direction of the line)
		var p := base[i]
		for side in [-1.0, 1.0]:
			var room := 0.0
			var d := 0.5
			while d <= reach:
				var q := ground_query(space, p.x + nrm[i].x * d * side, p.z + nrm[i].y * d * side, p.y + 1.1)
				if q.is_empty() or str(q["surface"]) != surfaces[i] or absf(float(q["y"]) - p.y) > 0.5:
					break
				room = d
				d += 0.5
			if side < 0.0:
				right[i] = maxf(0.0, room - margin)
			else:
				left[i] = maxf(0.0, room - margin)
	var off := PackedFloat32Array()
	off.resize(n)
	for _it in 300:
		for k in n:
			var pa := posmod(k - 1, n)
			var pb := (k + 1) % n
			var mx := (base[pa].x + nrm[pa].x * off[pa] + base[pb].x + nrm[pb].x * off[pb]) / 2.0 - base[k].x
			var mz := (base[pa].z + nrm[pa].y * off[pa] + base[pb].z + nrm[pb].y * off[pb]) / 2.0 - base[k].z
			var want := mx * nrm[k].x + mz * nrm[k].y
			off[k] = clampf(off[k] + (want - off[k]) * 0.5, -right[k], left[k])
	for m in n:
		points[m] = Vector3(base[m].x + nrm[m].x * off[m], base[m].y, base[m].z + nrm[m].y * off[m])
	settle(space)


## The speed at every point (computeSpeeds of RacingLine.js): the bend (lateral acceleration a_lat), the braking
## (a_brake) that the slower points ahead ask for, at most v_max.
func compute_speeds(a_lat: float, a_brake: float, v_max: float) -> PackedFloat32Array:
	var n := points.size()
	speeds = PackedFloat32Array()
	speeds.resize(n)
	# the grip of the surface under a point as a share of the road's (sand, grass: slower there; settle gives them),
	# and the height smoothed over five points (the crests)
	var grip := PackedFloat32Array()
	grip.resize(n)
	grip.fill(1.0)
	if surfaces.size() == n:
		var road := maxf(0.1, float(Content.surface("road")["static"]))
		for i in n:
			if surfaces[i] != "" and surfaces[i] != "road":
				grip[i] = clampf(float(Content.surface(surfaces[i])["static"]) / road, 0.25, 1.0)
	var height := PackedFloat32Array()
	height.resize(n)
	for i in n:
		height[i] = (point(i - 2).y + point(i - 1).y + point(i).y + point(i + 1).y + point(i + 2).y) / 5.0
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
		speeds[i] = minf(v_max, sqrt(a_lat * grip[i] / curvature)) if curvature > 1e-4 else v_max
		# the crest: above sqrt(g / curvature) of the height along the line the car leaves the ground over the top (a
		# hop of 15 % over that is allowed)
		var d2 := (height[(i + 3) % n] - 2.0 * height[i] + height[posmod(i - 3, n)]) / (3.0 * STEP * 3.0 * STEP)
		if d2 < -1e-4:
			speeds[i] = minf(speeds[i], 1.15 * sqrt(9.81 / -d2))
		speeds[i] = maxf(6.0, speeds[i])
	for _pass in 2:
		for k in range(n - 1, -1, -1):
			var nxt := (k + 1) % n
			var allowed := sqrt(speeds[nxt] * speeds[nxt] + 2.0 * a_brake * grip[k] * STEP)
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
