class_name Race
extends Node
## A race against AI cars (web/js/main.js startRace, Opponent.js): the cars on the grid of track.json, a countdown
## (3, 2, 1, GO: everyone is held), a number of laps, the positions along the racing line, and the results when
## the player finishes. The laps of the race are counted along the line from the finish line (the first gate), for
## everyone in the same way: the grid is behind the line, the first crossing starts lap 1.

signal finished

enum State { COUNTDOWN, RACING, DONE }

class Entry:
	var car: Car
	var name := ""
	var driver: AIDriver = null     # null: the player
	var laps := 0                   # 0 on the grid; 1 from the first crossing of the finish
	var fraction := 0.0             # of the lap, from the finish
	var index := -1
	var finish_time := -1.0
	var lap_start := 0.0
	var best_lap := -1.0
	var stuck := 0.0
	var going := false
	var touching: Array = []
	var knocks := 0
	var put_back := 0

var world: Node
var line: RacingLine
var laps := 3
var state := State.COUNTDOWN
var countdown := 4.0
var clock := 0.0
var entries: Array[Entry] = []
var player: Entry
var origin := 0                     # the index of the line at the finish
var results_shown := false


func setup(w: Node, l: RacingLine, track: Track, player_car: Car, opponents: int, race_laps: int, from_pole: bool) -> void:
	name = "Race"
	world = w
	line = l
	laps = race_laps
	var gates: Array = track.config.get("gates", [])
	var start: Dictionary = track.start
	if not gates.is_empty():
		origin = line.nearest(Vector3(float(gates[0]["x"]), 0, float(gates[0]["z"])))
	else:
		origin = line.nearest(Vector3(float(start.get("x", 0)), 0, float(start.get("z", 0))))
	# the places on the grid: 0 is the start, then the grid boxes of the track, else two by two behind it on the line
	var slots := []
	for s in opponents + 1:
		slots.append(_slot(s, track))
	var player_slot := 0
	if not from_pole:
		# front to back along the start: the player takes the last
		var h := float(start.get("heading", 0))
		var dir := Vector2(cos(h), sin(h))
		var s0 := Vector2(float(start.get("x", 0)), float(start.get("z", 0)))
		slots.sort_custom(func(a, b): return (Vector2(a["x"], a["z"]) - s0).dot(dir) > (Vector2(b["x"], b["z"]) - s0).dot(dir))
		player_slot = opponents
	player = Entry.new()
	player.car = player_car
	player.name = "You"
	entries.append(player)
	var cars := _opponent_cars(player_car)
	var slot_i := 0
	for i in opponents:
		if slot_i == player_slot:
			slot_i += 1
		var id: String = cars[i % cars.size()]
		var cfg: Variant = Content.load_json("cars/%s/car.json" % id)
		var e := Entry.new()
		e.car = Car.new()
		e.car.setup(id, cfg if cfg is Dictionary else {})
		e.car.set_meta("track_id", track.track_id)
		e.car.name = "AI%d" % (i + 1)
		e.name = "%s %d" % [e.car.config.get("name", id), i + 1]
		world.add_child(e.car)
		e.driver = AIDriver.new()
		e.driver.setup(e.car, line, 0.8 * (1.0 - 0.03 * (i % 4)))
		e.car.set_meta("slot", slots[slot_i])
		e.car.contact_monitor = true
		e.car.max_contacts_reported = 4
		entries.append(e)
		slot_i += 1
	player_car.set_meta("slot", slots[player_slot])
	RunLog.event("race: %d laps, %d opponents (%s), the player %s" % [laps, opponents, ", ".join(cars), "on pole" if from_pole else "at the back"])


func _slot(s: int, track: Track) -> Dictionary:
	var start: Dictionary = track.start
	if s == 0:
		return {"x": float(start.get("x", 0)), "z": float(start.get("z", 0)), "heading": float(start.get("heading", 0))}
	var grid: Array = track.config.get("grid", [])
	if s < grid.size():
		var b: Dictionary = grid[s]
		return {"x": float(b.get("x", 0)), "z": float(b.get("z", 0)), "heading": float(b.get("heading", 0))}
	var start_i := line.nearest(Vector3(float(start.get("x", 0)), 0, float(start.get("z", 0))))
	var i := start_i - roundi((7.0 * s + 4.0) / RacingLine.STEP)
	var p := line.point(i)
	var nxt := line.point(i + 1)
	var h := atan2(nxt.z - p.z, nxt.x - p.x)
	var side := (1.0 if (s - 1) % 2 == 0 else -1.0) * 2.2
	return {"x": p.x - sin(h) * side, "z": p.z + cos(h) * side, "heading": h}


## The cars of the player's kind (a car against cars, a kart against karts), not the player's own; else the player's.
func _opponent_cars(player_car: Car) -> Array:
	# (a kart: light, or a kart by its name; the go-kart 250cc weighs 330 kg)
	var kind := func(cfg: Dictionary) -> String:
		var light := float(cfg.get("chassis", {}).get("mass", 1000)) < 400
		return "kart" if light or str(cfg.get("name", "")).to_lower().contains("kart") else "car"
	var own: String = kind.call(player_car.config)
	var out := []
	for c in Content.list_cars():
		if c["id"] == player_car.car_id:
			continue
		var cfg: Variant = Content.load_json("cars/%s/car.json" % c["id"])
		if cfg is Dictionary and kind.call(cfg) == own:
			out.append(c["id"])
	if out.is_empty():
		out.append(player_car.car_id)
	return out


## Places every car on its slot (the start of the race).
func place_all() -> void:
	for e in entries:
		var s: Dictionary = e.car.get_meta("slot")
		var y: float = world.track.ground_at(s["x"], s["z"])
		e.car.place(Vector3(s["x"], y + e.car.wheels[0].radius + 0.15, s["z"]), s["heading"])
		e.car.freeze = false
		e.index = -1
		e.laps = 0


func is_held() -> bool:
	return state == State.COUNTDOWN and countdown > 1.0


func _physics_process(dt: float) -> void:
	if state == State.COUNTDOWN:
		countdown -= dt
		if countdown <= 1.0 and countdown + dt > 1.0:
			RunLog.event("race: GO")
		if countdown <= 0.0:
			state = State.RACING
	if not is_held():
		clock += dt
	var others: Array[Car] = []
	for e in entries:
		others.append(e.car)
	for e in entries:
		_progress(e)
		# a touch of two cars (for the racecraft of the AI): a new contact with another car
		var now: Array = []
		for b in e.car.get_colliding_bodies():
			if b is Car:
				now.append(b)
				if not e.touching.has(b) and not is_held():
					e.knocks += 1
		e.touching = now
		if e.driver == null:
			continue
		if is_held():
			e.car.throttle_input = 0.0
			e.car.brake_input = 1.0
			e.car.steer_input = 0.0
			continue
		e.driver.others = others
		e.driver.drive(dt)
		# stuck (against a wall, on its side): back on the line
		if absf(e.car.speed) > 5.0:
			e.going = true
		e.stuck = e.stuck + dt if absf(e.car.speed) < 1.0 else 0.0
		if e.stuck > (4.0 if e.going else 8.0):
			e.stuck = 0.0
			e.going = false
			world.put_on_line(e.car)
			e.driver.lost()
			e.put_back += 1
			RunLog.event("race: %s put back on the line" % e.name)


## The lap and the part of it, along the line from the finish.
func _progress(e: Entry) -> void:
	var p := e.car.global_position
	e.index = line.nearest_facing(p, e.car.global_transform.basis.z) if e.index < 0 else line.nearest(p, e.index)
	var n := line.count()
	var f := float(posmod(e.index - origin, n)) / n
	if e.fraction > 0.8 and f < 0.2:
		_crossed(e)
	elif e.fraction < 0.2 and f > 0.8 and e.laps > 0:
		e.laps -= 1                     # (back over the line)
	e.fraction = f


func _crossed(e: Entry) -> void:
	if e.finish_time >= 0.0:
		return
	if e.laps > 0:
		var t := clock - e.lap_start
		if e.best_lap < 0.0 or t < e.best_lap:
			e.best_lap = t
	e.lap_start = clock
	e.laps += 1
	if e.laps > laps and state != State.COUNTDOWN:
		e.finish_time = clock
		RunLog.event("race: %s finished P%d in %s" % [e.name, position_of(e), LapTimer.format_time(clock)])
		if e.driver != null:
			e.driver.save_learned()
		if e == player:
			state = State.DONE
			finished.emit()
			var knocks := 0
			var back := 0
			for x in entries:
				if x.driver != null:
					knocks += x.knocks
					back += x.put_back
			RunLog.event("race stats: touches between cars %d (each counted by both), AI put back %d" % [knocks, back])


## 1 for the leader: the finished cars by their time, then the others by laps and the part of the lap.
func position_of(e: Entry) -> int:
	return order().find(e) + 1


func order() -> Array[Entry]:
	var list := entries.duplicate()
	list.sort_custom(func(a: Entry, b: Entry) -> bool:
		if a.finish_time >= 0.0 or b.finish_time >= 0.0:
			if a.finish_time >= 0.0 and b.finish_time >= 0.0:
				return a.finish_time < b.finish_time
			return a.finish_time >= 0.0
		return a.laps + a.fraction > b.laps + b.fraction)
	return list


func countdown_text() -> String:
	if state != State.COUNTDOWN:
		return ""
	var n := ceili(countdown - 1.0)
	return str(n) if n > 0 else "GO"


func results_text() -> String:
	var lines := PackedStringArray(["Results"])
	var i := 1
	for e in order():
		var t := LapTimer.format_time(e.finish_time) if e.finish_time >= 0.0 else "lap %d" % mini(e.laps, laps)
		lines.append("%d.  %-24s %10s   best %s" % [i, e.name, t, LapTimer.format_time(e.best_lap)])
		i += 1
	return "\n".join(lines)
