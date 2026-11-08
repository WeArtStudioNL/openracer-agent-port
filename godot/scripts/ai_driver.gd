class_name AIDriver
extends RefCounted
## Drives a car along the racing line: it steers at a point ahead on the line (further ahead the faster it goes)
## and holds the speed of the line there with the throttle and the brake (web/js/Driver.js). It backs off behind
## a slower car and moves aside to pass it. It drives the opponents of a race, the player's car after the finish,
## and the player's car in the tests (--ai).

var car: Car
var line: RacingLine
var pace := 0.8                  # a share of the grip that it uses
var others: Array[Car] = []       # the other cars of the race (to back off behind one and to move aside)
var pit: AIPit = null             # an AI car of a race: its pit stops (AIPit)
var put_back_reason := ""         # why it should be put back ("": it drives on); the race (or the world) does it
var ghost_left := 0.0             # s that it is still a ghost after it was put back: the other cars go through it
var measured_grip := 0.0          # g, the grip of the car on the skidpad (0: not measured)
var speed_cap := INF            # m/s at most (the player's car after the finish: half of the top speed it reached)
var _index := -1
var _speed_error_i := 0.0
var _side := 0.0                  # m to the side of the line, to pass a car
var _passing: Car = null
var _pass_side := 0.0
var _pass_for := 0.0
var _pass_lane := 0.0               # where it drives to pass (m left of the line)
var _brake := 9.0
var _speeds := PackedFloat32Array()
var _learned_at := -100
var _was_off := false
var _yaw_i := 0.0
var _last_index := -1
var _base_speeds := PackedFloat32Array()
var _rolled := 0.0                # a motorcycle: the throttle as it is rolled on
var _beside := NAN                # a motorcycle: how far it was to the left of the line
var _lateral := 1.0               # the g of the line in the dry (before the pace)
var _braking := 1.0
var _block_wait := 0.0
var _block_anchor := Vector3.INF
var _block_anchor_t := 0.0
var _stuck_t := 0.0
var _reverse_for := 0.0
var _reverse_steer := 0.0
var _lost_for := 0.0
var _still_anchor := Vector3.INF
var _still_for := 0.0
var _over_for := 0.0
var _blocker: Car = null          # the car in its path (the one it holds back for)
var _ignore_blocker: Car = null   # one it waited behind for six seconds: passed, not waited for
var _ignore_until := 0.0
var _clock := 0.0
var _ray_exclude: Array[RID] = []
var _speeds_grip := 1.2           # the grip of the road that the speeds were made for (Ground: the wet and the snow)


func setup(c: Car, l: RacingLine, p := -1.0) -> void:
	car = c
	line = l
	if p > 0.0:
		pace = p
	elif Content.arg("ai-pace") != "":
		pace = float(Content.arg("ai-pace"))
	var grip := 1.2 * float(c.config.get("tyres", {}).get("grip", 1.0))
	# the grip of the car as the skidpad measured it (Skidpad.measured_grip, in g, for this car and setup), else the
	# guess from tyres.grip (Opponent.js measuredGrip; --skidpad-grip=0 leaves it out)
	measured_grip = Skidpad.measured_grip(c.config, c.car_id) if Content.arg("skidpad-grip") != "0" else 0.0
	if measured_grip > 0.0:
		grip = measured_grip
		RunLog.line("AI %s: the grip measured on the skidpad, %.2f g" % [c.name, measured_grip])
	var lateral := grip
	var braking := grip * 0.75
	if c.bike != null:
		# a motorcycle holds what its lean and its max_lateral_g allow, and it cannot brake hard and lean at once
		# (Opponent.js); it leans as much as the bend that is asked needs
		var m: Dictionary = c.config.get("motorcycle", {})
		lateral = minf(minf(grip, c.bike.lateral_g(c)), minf(float(m.get("max_lateral_g", 0.9)), tan(deg_to_rad(minf(55.0, float(m.get("max_lean_deg", 50))))))) * 0.9
		# (a road-race bike with the fork that dives: 0.75 g, the rear goes light sooner and the front brake is let off
		# for it; at 0.8 g the 600 ran wide in the first bend of kartbaan-oldenzaal. A flat-track bike leans deeper
		# into a slow bend and keeps 0.8 g)
		var dive := 0.0 if bool(m.get("push", false)) else 0.05 * minf(1.0, c.bike.fork_dive)
		braking = minf(braking, 0.8 - dive) * pace
		c.bike.lean_from_bend = true
	# (its own speeds: the cars of a race differ, and it learns where it was too fast)
	_lateral = lateral
	_braking = braking
	_make_speeds()
	# what an AI with this car learned on this track before (where it ran off the road), as factors on the speeds
	# (--ai-learned=0: a test of the line as it is, without what was learned before, and nothing kept)
	var f := _learned_path()
	if FileAccess.file_exists(f) and Content.arg("ai-learned") != "0":
		var factors: Variant = bytes_to_var(FileAccess.get_file_as_bytes(f))
		if factors is PackedFloat32Array and factors.size() == _speeds.size():
			for i in _speeds.size():
				_speeds[i] = maxf(6.0, _base_speeds[i] * factors[i])
			RacingLine.brake_pass(_speeds, _brake)


## The speeds of the line for the grip of the road now (Opponent.js buildSpeeds: a wet or a snowy road takes from the
## g of the bends and the brakes alike); what was learned stays, as factors on them.
func _make_speeds() -> void:
	var factors := PackedFloat32Array()
	if not _base_speeds.is_empty():
		for i in _speeds.size():
			factors.append(_speeds[i] / maxf(0.1, _base_speeds[i]))
	_speeds_grip = Ground.road_grip()
	var wetness := _speeds_grip / 1.2
	_speeds = line.compute_speeds(_lateral * Car.G * pace * wetness, _braking * Car.G * wetness, 90.0).duplicate()
	_brake = _braking * Car.G * wetness
	_base_speeds = _speeds.duplicate()
	if factors.size() == _speeds.size():
		for i in _speeds.size():
			_speeds[i] = maxf(6.0, _base_speeds[i] * factors[i])
		RacingLine.brake_pass(_speeds, _brake)


## The line was settled, turned or shortened (World, once the road can be felt): its speeds again (what was learned
## stays, as factors).
func line_changed() -> void:
	_make_speeds()
	_index = -1


## Keeps what it learned (the speeds as factors of those of the line) for the next time.
func save_learned() -> void:
	if _speeds.is_empty() or car == null or Content.arg("ai-learned") == "0":
		return
	var factors := PackedFloat32Array()
	factors.resize(_speeds.size())
	for i in _speeds.size():
		factors[i] = _speeds[i] / maxf(0.1, _base_speeds[i])
	DirAccess.make_dir_recursive_absolute(_learned_path().get_base_dir())
	var file := FileAccess.open(_learned_path(), FileAccess.WRITE)
	if file:
		file.store_buffer(var_to_bytes(factors))


func _learned_path() -> String:
	# (the AI of the tests, --ai, learns apart: not into what the AI of the player's races learned)
	var folder := "user://test-ai" if Content.arg("ai") != "" else "user://ai"
	return "%s/%s__%s__%d.learned" % [folder, car.get_meta("track_id", "track"), car.car_id, roundi(pace * 100)]


## Looks for the car on the line again (after a reset).
func lost() -> void:
	_index = -1
	_yaw_i = 0.0
	if pit != null:
		pit.reset()


func drive(dt: float) -> void:
	_clock += dt
	if ghost_left > 0.0:
		ghost_left -= dt
		if ghost_left <= 0.0:
			_ghost(false)
	if absf(Ground.road_grip() - _speeds_grip) > 0.03:
		_make_speeds()
	var xf := car.global_transform
	_index = line.nearest_facing(xf.origin, xf.basis.z) if _index < 0 else line.nearest(xf.origin, _index)
	var v := absf(car.speed)
	# the point to steer at
	# (at least 7 m, as Opponent.js: a point 5 m ahead and a metre or two to the side was full lock from a standstill,
	# and a car that pulled away round a hairpin or from the grid scrubbed its tyres at full lock and crawled)
	var ahead := int(maxf(7.0, 5.0 + v * 0.45) / RacingLine.STEP)
	if car.bike != null:
		ahead = int(clampf(3.0 + v * 0.75, 7.0, 35.0) / RacingLine.STEP)      # (Opponent.js: a bike leans into a bend before it turns)
	var target := line.point(_index + ahead)
	var want := minf(speed_cap, _speeds[posmod(_index + int((3.0 + v * 0.3) / RacingLine.STEP), line.count())])
	# the pits (AIPit): a speed of the pit lane, and a point on the pit line or at the box to steer at
	var pits: Dictionary = pit.update(dt, _index, v) if pit != null else {}
	if not pits.is_empty():
		want = minf(want, float(pits["speed"]))
		if pits.has("target"):
			target = pits["target"]
	# the front tyres at their limit (understeer: the car runs wide): off the throttle, a little slower; and the
	# bend is learned: the line before here a little slower, for the next lap (what a driver learns, RacingLine.js factorOf)
	var front_s := maxf(car.wheels[0].s, car.wheels[1].s)
	if front_s > 1.0 and v > 8.0:
		want = minf(want, v - 1.5 * (front_s - 0.9))
	# (it learns when it ran off the road: a wheel on loose ground, away from the line; what it learned comes back
	# slowly while it stays on the road)
	var off_road := false
	for w in car.wheels:
		if w.contact and Content.surface(w.surface).get("loose", false):
			off_road = true
	if _index != _last_index:
		_speeds[_index] = minf(_base_speeds[_index], _speeds[_index] * 1.003)
		_last_index = _index
	var off_line := absf(_lane(_index, xf.origin))
	var off := off_road and off_line > 2.0 and v > 8.0 and absf(_side) < 0.5 and pits.is_empty()
	# (once for a trip off the road, when it starts)
	if off and not _was_off:
		for k in range(-30, 4):
			var j := posmod(_index + k, _speeds.size())
			_speeds[j] = maxf(6.0, _speeds[j] * 0.97)
		RacingLine.brake_pass(_speeds, _brake)
		_learned_at = _index
		RunLog.line("AI %s learned: slower before point %d (%.0f km/h, %.1f m off the line)" % [car.name, _index, v * 3.6, off_line])
	_was_off = off
	var inv := xf.affine_inverse()
	var cap := _traffic(xf, inv, v, dt)
	want = minf(want, cap)
	if pit != null:
		pit.waiting = cap < 0.5
	if not pits.is_empty():
		_side = 0.0
	if absf(_side) > 0.01 and not pits.has("target"):
		var nxt := line.point(_index + ahead + 1)
		var dir := Vector3(nxt.x - target.x, 0.0, nxt.z - target.z).normalized()
		target += Vector3(dir.z, 0.0, -dir.x) * _side     # (to the left of the line: +; x is to the left of forward)
	var local := inv * target
	# the angle to it in the plane of the car (x to the left, z forward): a positive angle is a turn to the left
	var angle := atan2(local.x, maxf(0.5, local.z))
	# pure pursuit: the curvature of the arc through the point, as a steering angle of the front wheels
	var dist := Vector2(local.x, local.z).length()
	var steer := atan(2.0 * car.wheelbase * sin(angle) / maxf(1.0, dist))
	# the tyres need a slip angle to turn the car (a soft tyre a large one): the yaw rate that the arc asks for against
	# the one the car has adds steering (less when the car turns too fast)
	var curvature := 2.0 * sin(angle) / maxf(1.0, dist)
	var yaw_error := v * curvature - car.angular_velocity.dot(xf.basis.y)
	_yaw_i = clampf(_yaw_i + yaw_error * dt, -0.6, 0.6)
	if car.bike == null:
		steer += 0.12 * yaw_error + 0.25 * _yaw_i
	else:
		# (a motorcycle, Opponent.js: a pull towards the line itself, scaled to the speed and damped by how fast it closes in)
		var beside := 0.0 if pits.has("target") else _lane(_index, xf.origin) - _side
		var rate := 0.0 if is_nan(_beside) else (beside - _beside) / maxf(dt, 1e-3)
		_beside = beside
		steer += clampf((-beside * 0.012 - rate * 0.01) * minf(1.0, 225.0 / maxf(225.0, v * v)), -0.05, 0.05)
	car.steer_direct = true
	car.steer_input = clampf(steer / car.max_steer, -1.0, 1.0)
	var err := want - v
	_speed_error_i = clampf(_speed_error_i + err * dt, -5.0, 5.0)
	var u := 0.6 * err + 0.1 * _speed_error_i
	# a driver's right foot: less throttle while the driven tyres are past their grip (the car would spin or the
	# wheels would only smoke) and while the wheels are turned far
	var slip := 0.0
	for w in car.wheels:
		if w.driven:
			slip = maxf(slip, w.s)
	# (not at a crawl: a car at full lock in a hairpin, its axle welded, scrubs its tyres past their grip, and with
	# the throttle taken off for that it crawled at 1 m/s for ten seconds)
	var traction := maxf(clampf(1.8 - slip, 0.0, 1.0), 0.8 * clampf((6.0 - v) / 3.0, 0.0, 1.0))
	# (not at low speed: a car that has to pull away round a bend needs its throttle)
	var lock := lerpf(1.0, clampf(1.3 - absf(car.steer_input) * 1.2, 0.3, 1.0), clampf((v - 3.0) / 3.0, 0.0, 1.0))
	car.throttle_input = clampf(u, 0.0, 1.0) * traction * lock
	if car.bike != null:
		# a motorcycle rolls the throttle on, and less of it the more it leans
		var max_lean := deg_to_rad(float(car.config.get("motorcycle", {}).get("max_lean_deg", 50)))
		_rolled = minf(minf(car.throttle_input, 1.0 - 0.7 * minf(1.0, absf(car.bike.lean) / max_lean)), _rolled + 2.5 * dt)
		car.throttle_input = _rolled
	car.brake_input = clampf(-u * 0.5, 0.0, 1.0) if err < -1.0 else 0.0
	car.handbrake_input = 0.0
	_recover(dt, v, cap, xf, not pits.is_empty())
	if pit != null and pit.at_stop:
		# in its box until the stop is done
		car.throttle_input = 0.0
		car.brake_input = 1.0 if v < 1.0 else maxf(car.brake_input, 0.2)


## Getting out of trouble (Opponent.js drive): it waits behind a car that stands (that is no being stuck) and goes
## round it after six seconds; it backs up a moment when it pushes against something; and it asks to be put back
## (put_back_reason) when it is on its side or its roof, has fallen out of the world, makes no headway, or stays
## blocked. in_pits: the pits look after themselves (AIPit.stuck).
func _recover(dt: float, v: float, cap: float, xf: Transform3D, in_pits: bool) -> void:
	var p := xf.origin
	# waiting behind a car that stands (one that spun, that crashed, the queue at a stop): it stands too. After six
	# seconds it goes round it; when that does not get it 8 m on in 15 s (wedged, no room beside it), it is put back
	if _block_anchor != Vector3.INF and p.distance_to(_block_anchor) > 8.0:
		_block_anchor = Vector3.INF
	if _block_anchor != Vector3.INF and _clock - _block_anchor_t > 15.0 and not in_pits:
		_block_anchor = Vector3.INF
		put_back_reason = "blocked"
	if _blocker != null and cap < 0.5 and v < 1.0:
		if _block_anchor == Vector3.INF:
			_block_anchor = p
			_block_anchor_t = _clock
		_block_wait += dt
		if _block_wait < 6.0:
			# (the handbrake and a light brake: the brake held hard at a standstill puts the car in reverse, Car._controls)
			car.throttle_input = 0.0
			car.brake_input = 0.4
			car.handbrake_input = 1.0
			_stuck_t = 0.0
			_lost_for = 0.0
			_still_anchor = Vector3.INF
			_reverse_for = 0.0
			return
		_ignore_blocker = _blocker
		_ignore_until = _clock + 5.0
		_block_wait = 0.0
	else:
		_block_wait = 0.0
	# pushing against something (a wall, a car across its nose, the wall of its pit box): back up a moment, the
	# wheels the other way
	if _reverse_for > 0.0:
		_reverse_for -= dt
		car.gear = -1
		car.throttle_input = 0.0
		car.brake_input = 0.6               # (in reverse the brake pedal drives: Car._controls)
		car.steer_input = -_reverse_steer
		if _reverse_for <= 0.0:
			car.gear = 1
	elif v < 0.5 and car.throttle_input > 0.3 and car.bike == null and not (pit != null and pit.at_stop):
		_stuck_t += dt
		if _stuck_t > 2.5:
			_stuck_t = 0.0
			_reverse_for = 2.0
			_reverse_steer = car.steer_input
	else:
		_stuck_t = 0.0
	if in_pits:
		_lost_for = 0.0
		_still_anchor = Vector3.INF
		_over_for = 0.0
		return
	# lost: slow with the throttle open (or backing up) for seven seconds, or far from the line
	var here := line.point(_index)
	var off_line := Vector2(here.x - p.x, here.z - p.z).length()
	# (Opponent.js: 1.5 m/s; a weak car that pulls away slowly, the stadium truck, was put back from the grid)
	if (v < 0.5 and (car.throttle_input > 0.3 or _reverse_for > 0.0)) or off_line > 45.0:
		_lost_for += dt
	else:
		_lost_for = maxf(0.0, _lost_for - 2.0 * dt)
	# no headway: a car that rocks against a wall (never slow for long) gets nowhere either: 8 s within 4 m
	if _still_anchor == Vector3.INF or p.distance_to(_still_anchor) > 4.0:
		_still_anchor = p
		_still_for = 0.0
	else:
		_still_for += dt
	_over_for = _over_for + dt if xf.basis.y.y < 0.25 else 0.0
	if p.y < here.y - 25.0:
		put_back_reason = "fell"
	elif _over_for > 2.0:
		put_back_reason = "on its side or roof"
	elif off_line > 45.0 and _lost_for > 7.0:
		put_back_reason = "off the line %.0f m" % off_line
	elif _lost_for > 7.0:
		put_back_reason = "stuck"
	elif _still_for > 8.0:
		put_back_reason = "no headway"


## Puts the car back (Opponent.js putBack): a little further along the line, 3.5 m to its right where there is road
## (else 1.5 m, else on the line), facing along it, standing, repaired (and with fuel when its tank was empty), and a
## ghost for ten seconds: the other cars go through it.
func put_back() -> void:
	var xf := car.global_transform
	var i := (_index if _index >= 0 else line.nearest_facing(xf.origin, xf.basis.z)) + 3
	var a := line.point(i)
	var b := line.point(i + 2)
	var d := Vector2(b.x - a.x, b.z - a.z).normalized()
	var space := car.get_world_3d().direct_space_state
	_ray_exclude.clear()
	for o in others:
		if is_instance_valid(o):
			_ray_exclude.append(o.get_rid())
	_ray_exclude.append(car.get_rid())
	var road := _ground(space, a)
	if road.is_empty():
		road = space.intersect_ray(PhysicsRayQueryParameters3D.create(Vector3(a.x, 2000, a.z), Vector3(a.x, -2000, a.z), 1, _ray_exclude))
	var pos := Vector3(a.x, float(road["position"].y) if not road.is_empty() else a.y, a.z)
	for off in [3.5, 1.5]:
		# (to the right of the line: the left is (d.y, -d.x), as _lane)
		var q := Vector3(a.x - d.y * off, pos.y, a.z + d.x * off)
		var hit := _ground(space, q)
		if hit.is_empty() or absf(float(hit["position"].y) - pos.y) > 0.4:
			continue
		var col: Object = hit.get("collider")
		var surf := str(col.get_meta("surface")) if col != null and col.has_meta("surface") else "road"
		if not Content.surface(surf).get("loose", false):
			pos = hit["position"]
			break
	# a crash is learned (Opponent.js learnEnd crashed): the line before here slower; not for a car that waited in
	# traffic or a test of the pits
	if (put_back_reason == "on its side or roof" or put_back_reason == "stuck") and _index >= 0:
		for k in range(-30, 1):
			var j := posmod(_index + k, _speeds.size())
			_speeds[j] = maxf(6.0, _speeds[j] * 0.92)
		RacingLine.brake_pass(_speeds, _brake)
		RunLog.line("AI %s learned: slower before point %d (put back: %s)" % [car.name, _index, put_back_reason])
	car.place(pos + Vector3.UP * (car.wheels[0].radius + 0.4), atan2(d.y, d.x))
	car.repair()
	if car.fuel < 1.0:
		car.fuel = car.tank
	put_back_reason = ""
	_block_wait = 0.0
	_block_anchor = Vector3.INF
	_stuck_t = 0.0
	_reverse_for = 0.0
	_lost_for = 0.0
	_still_anchor = Vector3.INF
	_over_for = 0.0
	_side = 0.0
	_passing = null
	_pass_side = 0.0
	lost()
	_ghost(true)


## A ghost (after it was put back): the other cars go through it and it through them, its shell too (CarShell).
func _ghost(on: bool) -> void:
	if not on:
		# (not while it is in another car: the two would be thrown apart)
		for o in others:
			if o != car and is_instance_valid(o) and o.global_position.distance_to(car.global_position) < 5.0:
				ghost_left = 0.5
				return
	ghost_left = 10.0 if on else 0.0
	if on:
		car.set_meta("ghost", true)
	else:
		car.remove_meta("ghost")
	for o in others:
		if o == car or not is_instance_valid(o):
			continue
		if on:
			car.add_collision_exception_with(o)
		else:
			car.remove_collision_exception_with(o)


## The other cars (Opponent.js drive): the car ahead is passed on a side that is chosen once and kept until it is
## by (or a second without it ahead); the car in its path, close by along its heading or further along the line in
## its lane, gives the speed at which it can still stop behind it. Returns that speed (INF: none).
func _traffic(xf: Transform3D, inv: Transform3D, v: float, dt: float) -> float:
	var ahead: Car = null
	var ahead_along := INF
	var ahead_across := 0.0
	var blocker_along := INF
	var blocker_speed := 0.0
	var blocker_len := 4.5
	_blocker = null
	var my_lane := _lane(_index, xf.origin)
	var my_w := float(car.config.get("dimensions", {}).get("width", 1.9))
	var fwd := xf.basis.z
	var reach := maxf(25.0, v * 1.5)
	for o in others:
		if o == car or not is_instance_valid(o):
			continue
		var rel := inv * o.global_position
		var along := rel.z
		var across := rel.x
		if absf(rel.y) > 3.0:
			continue                        # (a bridge, an underpass)
		var box := 5.5 if o == _passing else 3.2
		if along > -2.0 and along < 22.0 and absf(across) < box and (along > 0.0 or o == _passing) and along < ahead_along:
			ahead = o
			ahead_along = along
			ahead_across = across
		# (one it waited behind for six seconds is passed: it is no blocker for five seconds, Opponent.js)
		if o == _ignore_blocker and _clock < _ignore_until:
			continue
		var closing := maxf(0.0, o.linear_velocity.dot(fwd))
		var o_len := float(o.config.get("dimensions", {}).get("length", 4.2))
		# (in its path: overlapping sideways, by the half widths of both and a little; 2.2 m as Opponent.js at most.
		# Two motorcycles 1.4 m apart pass each other, and one that moved aside to pass still held back for it)
		var overlap := minf(2.2, (my_w + float(o.config.get("dimensions", {}).get("width", 1.9))) / 2.0 + 0.4)
		if along > 1.5 and along < 10.0 and absf(across) < overlap:
			if along < blocker_along:
				blocker_along = along
				blocker_speed = closing
				blocker_len = o_len
				_blocker = o
		elif along > 0.0 and rel.length() < reach + 5.0:
			var oi := line.nearest(o.global_position, _index)
			var on_line := posmod(oi - _index, line.count()) * RacingLine.STEP
			if on_line > 1.5 and on_line < reach and absf(_lane(oi, o.global_position) - my_lane) < overlap and on_line < blocker_along:
				blocker_along = on_line
				# (its speed along the line there: in the bend ahead its speed along our heading is less than it goes)
				var lp := line.point(oi)
				var ln := line.point(oi + 1)
				blocker_speed = maxf(0.0, o.linear_velocity.dot(Vector3(ln.x - lp.x, 0.0, ln.z - lp.z).normalized()))
				blocker_len = o_len
				_blocker = o
	# the side is chosen once for a car and kept until it is passed (or a second has gone by without it ahead): the
	# side away from it, unless the road has more room on the other (Opponent.js takes the side away from it, and on
	# a narrow kart track there was no room there: it stayed behind a slow car for the whole race). It moves aside of
	# that car, not of the line: by the half widths of both and a little.
	var side_want := 0.0
	if ahead != null:
		var ahead_lane := _lane(line.nearest(ahead.global_position, _index), ahead.global_position)
		var gap := maxf(1.8, (my_w + float(ahead.config.get("dimensions", {}).get("width", 1.9))) / 2.0 + 0.6)
		if ahead != _passing or _pass_side == 0.0:
			_passing = ahead
			_pass_side = -1.0 if ahead_across > 0.0 else 1.0
			var away := absf(_room(ahead_lane + _pass_side * gap, v) - ahead_lane)
			var other := absf(_room(ahead_lane - _pass_side * gap, v) - ahead_lane)
			if other > away + 0.3:
				_pass_side = -_pass_side
		_pass_for = 0.0
		_pass_lane = ahead_lane + _pass_side * gap
		side_want = _pass_lane
	elif _passing != null:
		_pass_for += dt
		if _pass_for < 1.0:
			side_want = _pass_lane
		else:
			_passing = null
			_pass_side = 0.0
	if side_want != 0.0:
		side_want = _room(side_want, v)
	_side = move_toward(_side, side_want, dt * 1.5)
	if blocker_along == INF:
		return INF
	var my_len := float(car.config.get("dimensions", {}).get("length", 4.2))
	var gap := blocker_along - (my_len + blocker_len) / 2.0 - 0.3
	if gap < 2.0:
		return maxf(0.0, blocker_speed * 0.85 - (2.0 - gap))
	return blocker_speed + sqrt(2.0 * _brake * 0.8 * (gap - 2.0))


## Aside only as far as there is road (Opponent.js): on the inside or the outside of a bend 2.6 m from the line is
## often the kerb, the gravel or the barrier. The point ahead is looked at in steps and the side shrinks to where the
## road still is (the ground there no loose surface and as high as the road under the line); less than 0.8 m: none.
func _room(side: float, v: float) -> float:
	if not car.is_inside_tree():
		return side
	var k := _index + roundi(maxf(6.0, v * 0.6) / RacingLine.STEP)
	var a := line.point(k)
	var b := line.point(k + 1)
	var d := Vector2(b.x - a.x, b.z - a.z).normalized()
	var space := car.get_world_3d().direct_space_state
	if _ray_exclude.is_empty():
		for o in others:
			if is_instance_valid(o):
				_ray_exclude.append(o.get_rid())
		_ray_exclude.append(car.get_rid())
	var road := _ground(space, Vector3(a.x, car.global_position.y, a.z))
	if road.is_empty():
		return side
	var road_y: float = road["position"].y
	for _try in 4:
		# (to the left of the line: +, as _lane)
		var p := Vector3(a.x + d.y * side, road_y, a.z - d.x * side)
		var hit := _ground(space, p)
		if not hit.is_empty() and absf(float(hit["position"].y) - road_y) < 0.4:
			var col: Object = hit.get("collider")
			var surf := str(col.get_meta("surface")) if col != null and col.has_meta("surface") else "road"
			if not Content.surface(surf).get("loose", false):
				return side
		side *= 0.6
	return side if absf(side) >= 0.8 else 0.0


func _ground(space: PhysicsDirectSpaceState3D, p: Vector3) -> Dictionary:
	var q := PhysicsRayQueryParameters3D.create(p + Vector3.UP * 3.0, p + Vector3.DOWN * 4.0, 1, _ray_exclude)
	return space.intersect_ray(q)


## How far to the left of the line a point is, at point i of the line.
func _lane(i: int, p: Vector3) -> float:
	var a := line.point(i)
	var b := line.point(i + 1)
	var d := Vector2(b.x - a.x, b.z - a.z)
	var l := maxf(1e-3, d.length())
	# (left of forward is + x in the car's terms; along the line (d.x, d.y) the left is (d.y, -d.x))
	return ((p.x - a.x) * d.y - (p.z - a.z) * d.x) / l


## How far along the line the car is (0..1 of a lap, from the first point).
func progress() -> float:
	return float(_index) / maxf(1.0, line.count())
