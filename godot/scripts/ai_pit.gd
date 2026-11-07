class_name AIPit
extends RefCounted
## The pit stops of an AI car in a race (web/js/Opponent.js, with tyre wear on): when the tyres are worn (past 75 %
## with two laps or more to go) or the fuel will not last the laps that are left, it drives to its own pit box
## (track.json "pit": { "boxes" }; box 1 is the player's, the AI cars have the next ones in the order of the grid),
## stops with its wheels in it until its PitStop is done, and goes back to the racing line. With a pit line
## (track.json "pit": { "line": [[x, z], ...] }, PitPath of Pit.js) it follows that line at the speed of the pit lane
## and stops at its point nearest to the box; without one it drives to a point on the axis of the box and then into it.

const PIT_SPEED := 16.0             # m/s in the pit lane
const BRAKE := 3.5                  # m/s2 for the stop and for the start of the pit line
const WEAR := 0.75
const STOP_WAIT := 6.0              # s standing at the stop without a stop going: it gives up and drives on
const STUCK := 10.0                 # s in the pits away from the stop without 4 m of headway: put back

var car: Car
var line: RacingLine
var pit: PitStop
var box := {}                       # { x, z, heading } of its own box ({}: no box, no stops)
var path := PackedVector2Array()    # the pit line, a point every metre (empty: the box mode)
var path_entry := 0                 # the index of the racing line where the pit line starts
var laps_left := 99                 # set by the race
var finished := false               # set by the race: no more stops after the finish
var pitting := false
var phase := 0.0                    # 0.5 slowing down for the pit line, 1 to the box and in it, 2 on the way out
var stops := 0
var at_stop := false
var waiting := false                # set by the driver: it waits behind a car (one that stands in its box)
var name := ""
var lane: PitLane = null            # the pit lane of a track without boxes (PitLane), made at the first look
var _pit_idx := 0
var _stop_idx := 0
var _stop_wait := 0.0
var _stuck := 0.0
var _fuel_at_lap := -1.0
var _fuel_per_lap := -1.0
var _pitted_this_lap := false
var _anchor := Vector3.ZERO
var _lane_looked := false
var _lane_stopped := false
var _failed := 0                    # visits to the pits that ended with the car put back on the line


func setup(c: Car, l: RacingLine, track_cfg: Dictionary, index: int, entry_name: String) -> void:
	car = c
	line = l
	name = entry_name
	pit = PitStop.new()
	pit.setup(c, track_cfg, index, false)
	c.add_child(pit)
	var boxes := PitStop.boxes_of(track_cfg)
	if index < boxes.size():
		box = boxes[index]
	# (a test: --ai-pit-line=0 leaves the pit line out, for the box mode on a track that has one)
	path = path_of(track_cfg) if Content.arg("ai-pit-line") != "0" else PackedVector2Array()
	if not path.is_empty():
		path_entry = line.nearest(Vector3(path[0].x, 0.0, path[0].y))
		_stop_idx = _path_nearest(box.get("x", 0.0), box.get("z", 0.0), -1) if not box.is_empty() else 0


## The pit line of a track.json (PitPath.build of Pit.js): a Catmull-Rom curve through the points, a sample every metre.
static func path_of(track_cfg: Dictionary) -> PackedVector2Array:
	var out := PackedVector2Array()
	var pit_cfg: Variant = track_cfg.get("pit", {})
	if not (pit_cfg is Dictionary) or not (pit_cfg.get("line") is Array):
		return out
	var pts := PackedVector2Array()
	for q in pit_cfg["line"]:
		if q is Array and q.size() >= 2:
			pts.append(Vector2(float(q[0]), float(q[1])))
	if pts.size() < 2:
		return out
	var fine := PackedVector2Array()
	for i in pts.size() - 1:
		var p0 := pts[maxi(0, i - 1)]
		var p1 := pts[i]
		var p2 := pts[i + 1]
		var p3 := pts[mini(pts.size() - 1, i + 2)]
		var steps := maxi(2, ceili(p1.distance_to(p2) / 0.25))
		for k in steps:
			var t := float(k) / steps
			var t2 := t * t
			fine.append(0.5 * ((2.0 * p1) + (-p0 + p2) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2 + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t2 * t))
	fine.append(pts[pts.size() - 1])
	out.append(fine[0])
	var carried := 0.0
	for j in range(1, fine.size()):
		carried += fine[j].distance_to(fine[j - 1])
		if carried >= 1.0:
			out.append(fine[j])
			carried = 0.0
	if out[out.size() - 1].distance_to(fine[fine.size() - 1]) > 0.3:
		out.append(fine[fine.size() - 1])
	return out


func _path_nearest(x: float, z: float, hint: int) -> int:
	var from := 0
	var to := path.size() - 1
	if hint >= 0:
		from = maxi(0, hint - 25)
		to = mini(path.size() - 1, hint + 40)
	var best := from
	var best_d := INF
	for q in range(from, to + 1):
		var d := path[q].distance_squared_to(Vector2(x, z))
		if d < best_d:
			best_d = d
			best = q
	return best


func _path_point(i: int) -> Vector3:
	var p := path[clampi(i, 0, path.size() - 1)]
	return Vector3(p.x, car.global_position.y, p.y)


## A lap is done (the race): the fuel that a lap takes, for the decision (a lap with a stop in it does not count).
func lap_done() -> void:
	if _fuel_at_lap >= 0.0 and not _pitted_this_lap:
		_fuel_per_lap = maxf(_fuel_per_lap, _fuel_at_lap - car.fuel)
	_fuel_at_lap = car.fuel
	_pitted_this_lap = false


## Out of the pits (the car was put back on the line). Put back from the pits twice, it gives up its box (a box
## that it cannot reach: the box mode on a track whose boxes lie behind a wall).
func reset() -> void:
	if pitting:
		_failed += 1
		if _failed >= 2:
			RunLog.event("race: %s cannot reach its box, no more stops" % name)
			box = {}
	pitting = false
	phase = 0.0
	at_stop = false
	_stop_wait = 0.0
	_stuck = 0.0


func _max_wear() -> float:
	var worn := 0.0
	for w in car.wheels:
		worn = maxf(worn, w.wear)
	return worn


func _needs_stop() -> bool:
	var fuel_needed := _fuel_per_lap * (laps_left + 0.4) if _fuel_per_lap >= 0.0 else car.tank * 0.12
	return not finished and laps_left >= 1 and ((_max_wear() > WEAR and laps_left >= 2) or car.fuel < fuel_needed)


## What the pits ask of the driver now, at index i of the racing line: {} when it races on; else { speed } (at most
## this fast) and target (a point to steer at instead of the line's) when it is in the pits; at_stop is set while it
## stands in its box.
func update(dt: float, i: int, speed: float) -> Dictionary:
	at_stop = false
	if pit.active:
		_pitted_this_lap = true
	if float(Settings.get_value("tyre_wear")) <= 0.0:
		pitting = false
		return {}
	if box.is_empty():
		return _lane_update(i, speed)
	var n := line.count()
	var p := car.global_position
	if not pitting and _needs_stop():
		if path.is_empty():
			var to_box := posmod(line.nearest(Vector3(box["x"], 0.0, box["z"]), i) - i, n) * RacingLine.STEP
			if to_box < 70.0:
				_begin(1.0)
		elif posmod(path_entry - i, n) * RacingLine.STEP < 120.0:
			_begin(0.5)
			_pit_idx = 0
	if not pitting:
		return {}
	var out := {"speed": PIT_SPEED}
	if not path.is_empty():
		if phase == 0.5:
			var to_start := posmod(path_entry - i, n) * RacingLine.STEP
			out["speed"] = sqrt(PIT_SPEED * PIT_SPEED + 2.0 * BRAKE * maxf(0.0, to_start - 2.0))
			if to_start < 6.0 or Vector2(p.x, p.z).distance_to(path[0]) < 7.0:
				phase = 1.0
				_pit_idx = _path_nearest(p.x, p.z, -1)
		if phase >= 1.0:
			_pit_idx = _path_nearest(p.x, p.z, _pit_idx)
			var look := clampf(2.0 + speed * 0.55, 4.0, 12.0)
			out["target"] = _path_point(mini(path.size() - 1, _pit_idx + roundi(look)))
			var dist_stop := float(_stop_idx - _pit_idx)
			# the last metres to the stop along the axis of the box: the pit line may pass a metre beside its middle,
			# and a wide car stood with its wheels over the side line (no stop)
			var off := _box_offset()
			if phase == 1.0 and dist_stop < 25.0 and absf(off.y) < 6.0 and off.x > -22.0:
				var bf := Vector3(cos(float(box["heading"])), 0.0, sin(float(box["heading"])))
				out["target"] = Vector3(box["x"], p.y, box["z"]) + bf * (off.x + clampf(1.5 + speed * 0.4, 3.0, 8.0))
				dist_stop = 1.0 - off.x          # (a metre past the middle: more room to come straight in the box)
			if phase == 1.0 and pit.done:
				_leave()
			if phase == 1.0:
				out["speed"] = minf(PIT_SPEED, sqrt(2.0 * BRAKE * maxf(0.0, dist_stop - 0.2)) + 0.7)
				if dist_stop < 0.8 and speed < 2.0 and not pit.done:
					at_stop = true
			elif _pit_idx >= path.size() - 3:
				_end()
				return {}
	else:
		var bf := cos(float(box["heading"]))
		var bg := sin(float(box["heading"]))
		var rx: float = p.x - box["x"]
		var rz: float = p.z - box["z"]
		var dist := Vector2(rx, rz).length()
		var along := rx * bf + rz * bg
		if phase == 1.0 and pit.done:
			_leave()
		if phase == 1.0:
			if along < -9.0 and dist > 10.0:
				out["target"] = Vector3(box["x"] - bf * 9.0, p.y, box["z"] - bg * 9.0)
				out["speed"] = minf(16.0, 3.0 + (dist - 9.0) * 0.7)
			else:
				out["target"] = Vector3(box["x"], p.y, box["z"])
				out["speed"] = minf(12.0, 1.5 + dist * 0.9)
			if dist < 1.3 and speed < 3.0 and not pit.done:
				at_stop = true
		else:
			# back to the line: the normal point ahead on it, slowly until it is on it again
			out["speed"] = 14.0
			var here := line.point(i)
			if Vector2(here.x - p.x, here.z - p.z).length() < 3.5 and dist > 12.0:
				_end()
				return {}
	# (a stop that does not begin: the car stands and no stop goes, after six seconds it gives up and drives on)
	if at_stop and absf(speed) < 1.0 and not pit.active:
		_stop_wait += dt
		if _stop_wait > STOP_WAIT:
			var off := _box_offset()
			RunLog.event("race: %s gives up the stop (not in its box: %.1f m along it, %.1f m across)" % [name, off.x, off.y])
			_stop_wait = 0.0
			at_stop = false
			_leave()
	elif not at_stop:
		_stop_wait = 0.0
	if at_stop:
		out["speed"] = 0.0
	return out


## A track without pit boxes (Opponent.js): through the pit lane (PitLane) at the speed of the lane, a stop in its
## middle (once a visit).
func _lane_update(i: int, speed: float) -> Dictionary:
	if not _lane_looked:
		_lane_looked = true
		var track := car.get_tree().get_first_node_in_group("track") as Track if car.is_inside_tree() else null
		lane = PitLane.build(track, line)
		if lane != null:
			RunLog.event("race: %s has the pit lane (%d points, from line point %d to %d)" % [name, lane.points.size(), lane.entry, lane.exit])
	if lane == null:
		pitting = false
		return {}
	var n := line.count()
	var to_entry := posmod(lane.entry - i, n) * RacingLine.STEP
	if not pitting and _needs_stop() and to_entry < 60.0:
		pitting = true
		_lane_stopped = false
		RunLog.event("race: %s pits (the lane; fuel %.1f L, wear %.2f)" % [name, car.fuel, _max_wear()])
	if not pitting:
		return {}
	if not (lane.covers(i) or to_entry < 60.0):
		pitting = false
		stops += 1
		RunLog.event("race: %s back on the track (stop %d)" % [name, stops])
		return {}
	if pit.done:
		_lane_stopped = true
	var out := {"speed": PIT_SPEED}
	var look := clampf(3.0 + speed * 0.6, 5.0, 14.0)
	out["target"] = lane.point_at(i + roundi(look / RacingLine.STEP))
	var stop_index: int = lane.points[lane.stop][1]
	var at := posmod(i - lane.entry, n)
	var stop_at := posmod(stop_index - lane.entry, n)
	if not pit.done and not _lane_stopped:
		if at <= stop_at:
			out["speed"] = minf(PIT_SPEED, sqrt(2.0 * BRAKE * maxf(0.0, (stop_at - at) * RacingLine.STEP - 1.0)) + 0.6)
		if at >= stop_at - 1 and at <= stop_at + 2:
			at_stop = true
			out["speed"] = 0.0
	return out


## Stuck in the pits (against a wall, away from its stop): no 4 m of headway in ten seconds (a car that rocks
## against a wall is never slow for long).
func stuck(dt: float) -> bool:
	var p := car.global_position
	if not pitting or at_stop or waiting or pit.active or p.distance_to(_anchor) > 4.0:
		_anchor = p
		_stuck = 0.0
		return false
	_stuck += dt
	return _stuck > STUCK


## Where the car is in its box: along it (+ forward) and across it, from the middle.
func _box_offset() -> Vector2:
	var p := car.global_position
	var cs := cos(float(box["heading"]))
	var sn := sin(float(box["heading"]))
	var dx: float = p.x - box["x"]
	var dz: float = p.z - box["z"]
	return Vector2(dx * cs + dz * sn, -dx * sn + dz * cs)


func _begin(p: float) -> void:
	pitting = true
	phase = p
	_stop_wait = 0.0
	_stuck = 0.0
	RunLog.event("race: %s pits (fuel %.1f L, wear %.2f)" % [name, car.fuel, _max_wear()])


func _leave() -> void:
	phase = 2.0
	if pit.done:
		stops += 1
	RunLog.event("race: %s leaves its box (fuel %.1f L, wear %.2f, stop %d)" % [name, car.fuel, _max_wear(), stops])


func _end() -> void:
	pitting = false
	phase = 0.0
	RunLog.event("race: %s back on the track" % name)
