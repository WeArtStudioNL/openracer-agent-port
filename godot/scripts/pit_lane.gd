class_name PitLane
extends RefCounted
## The pit lane of a track without pit boxes (PitLane of web/js/Pit.js): the road of the surface "track01" beside the
## racing line, found from its triangles: where it starts and ends along the racing line, the points to drive through
## (smoothed) and the point to stop at (the middle). The AI cars (AIPit) drive through it at the speed of the lane and
## stop there; PitStop serves a car that stands still with its wheels on it.

var points: Array = []              # [Vector3 (x, y, z), index of the racing line]
var entry := 0
var exit := 0
var stop := 0                       # the point to stop at
var count := 0                      # points of the racing line


## The lane of a track, or null when it has none (fewer than six triangles of track01 within 60 m of the line).
static func build(track: Track, line: RacingLine) -> PitLane:
	if track == null or line == null:
		return null
	var centroids := track.surface_centroids("track01")
	if centroids.size() < 6:
		return null
	var n := line.count()
	var by_index := {}
	var hint := -1
	for c: Vector3 in centroids:
		var i := line.nearest(c, hint) if hint >= 0 else line.nearest(c)
		hint = i
		var p := line.point(i)
		if Vector2(p.x - c.x, p.z - c.z).length() > 60.0:
			continue
		if not by_index.has(i):
			by_index[i] = [Vector3.ZERO, 0]
		by_index[i][0] += c
		by_index[i][1] += 1
	var indices: Array = by_index.keys()
	if indices.size() < 3:
		return null
	indices.sort()
	# (one stretch along the line: it starts after the biggest gap, also round the end of the line)
	var start := 0
	var biggest := -1
	for k in indices.size():
		var gap := posmod(int(indices[(k + 1) % indices.size()]) - int(indices[k]), n)
		if gap > biggest:
			biggest = gap
			start = (k + 1) % indices.size()
	var ordered: Array = indices.slice(start) + indices.slice(0, start)
	var raw: Array = []
	for i in ordered:
		raw.append(by_index[i][0] / float(by_index[i][1]))
	var lane := PitLane.new()
	lane.count = n
	for k in raw.size():
		var a: Vector3 = raw[maxi(0, k - 1)]
		var b: Vector3 = raw[k]
		var c: Vector3 = raw[mini(raw.size() - 1, k + 1)]
		lane.points.append([Vector3((a.x + b.x + c.x) / 3.0, b.y, (a.z + b.z + c.z) / 3.0), int(ordered[k])])
	lane.entry = int(ordered[0])
	lane.exit = int(ordered[ordered.size() - 1])
	lane.stop = lane.points.size() / 2
	return lane


## Whether index i of the racing line is along the lane.
func covers(i: int) -> bool:
	return posmod(i - entry, count) <= posmod(exit - entry, count)


## The point of the lane for an index of the racing line (the nearest one along it).
func point_at(i: int) -> Vector3:
	var best: Vector3 = points[0][0]
	var best_d := count
	for p in points:
		var d := absi(posmod(int(p[1]) - i + count / 2, count) - count / 2)
		if d < best_d:
			best_d = d
			best = p[0]
	return best
