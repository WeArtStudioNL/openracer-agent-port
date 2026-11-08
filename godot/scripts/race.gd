class_name Race
extends Node
## A race against AI cars (web/js/main.js startRace, Opponent.js): the cars on the grid of track.json, a countdown
## (3, 2, 1, GO: everyone is held), a number of laps, the positions along the racing line, and the results when
## the player finishes. The laps of the race are counted along the line from the finish line (the first gate), for
## everyone in the same way: the grid is behind the line, the first crossing starts lap 1. Before the countdown the
## camera flies over the grid (main.js beginFlyby; Enter, Space or a click skips it). A track without a racing line
## has a race without AI cars: the laps are those of the gates (LapTimer), as the browser counts the player's.

signal finished

enum State { FLYBY, COUNTDOWN, RACING, DONE }

const AUDIBLE := 3                  # the AI cars that are heard at once (the nearest)
## The pace of the AI for the difficulty of the menu (MainMenu.js raceStep: easy, normal, hard)
const DIFFICULTY := {"easy": 0.7, "normal": 0.8, "hard": 0.92}
const FLYBY_SECONDS := 6.0

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
	var audio: CarAudio = null
	var touching: Array = []
	var knocks := 0
	var put_back := 0
	var slot := 0                   # its place on the grid (an index of the slots, front to back when not on pole)

var world: Node
var line: RacingLine                # null: a race without AI cars, the laps by the gates (lap_timer)
var lap_timer: LapTimer = null
var track: Track
var laps := 3
var state := State.FLYBY
var countdown := 4.0
var flyby_time := 0.0
var flyby_skip := false
var track_name := ""
var clock := 0.0
var entries: Array[Entry] = []
var player: Entry
var origin := 0                     # the index of the line at the finish
var results_shown := false
var _grid := "front"
var _slots: Array = []


## extra (the menu): difficulty ("easy", "normal", "hard"), grid ("front", "random", "back": the player's place; else
## from_pole), opp (the cars chosen for the first places: [{car, tune}], the rest of the places as before).
func setup(w: Node, l: RacingLine, t: Track, player_car: Car, opponents: int, race_laps: int, from_pole: bool, extra := {}) -> void:
	name = "Race"
	world = w
	line = l
	track = t
	laps = race_laps
	track_name = str(t.config.get("name", t.track_id))
	if line == null:
		opponents = 0
	# (--flyby=0: the countdown at once; the tests that drive with --ai have none, --flyby=1 asks for it)
	var flyby := Content.arg("flyby")
	if flyby == "0" or (flyby == "" and Content.arg("ai") != ""):
		state = State.COUNTDOWN
	var player_slot := 0
	_grid = str(extra.get("grid", "front" if from_pole else "back"))
	if _grid != "front":
		player_slot = opponents if _grid == "back" else randi_range(0, opponents)
	player = Entry.new()
	player.car = player_car
	player.name = "You (%s)" % str(player_car.config.get("name", player_car.car_id))
	player.slot = player_slot
	entries.append(player)
	var cars := _opponent_cars(player_car) if opponents > 0 else []
	var chosen: Array = extra.get("opp", [])
	var pace := float(DIFFICULTY.get(str(extra.get("difficulty", "normal")), 0.8))
	var slot_i := 0
	for i in opponents:
		if slot_i == player_slot:
			slot_i += 1
		var id: String = cars[(i - chosen.size()) % cars.size()] if i >= chosen.size() else str(chosen[i].get("car", cars[0]))
		var cfg: Variant = Content.load_json("cars/%s/car.json" % id)
		# (a car of the menu with a setup of its own: the tune, as the player's car takes one)
		if i < chosen.size() and str(chosen[i].get("tune", "")) != "" and cfg is Dictionary:
			var tune_path: String = Tuning.list(id, cfg).get(str(chosen[i]["tune"]), "")
			var tuned := Tuning.tuned_config(tune_path, cfg) if tune_path != "" else {}
			if not tuned.is_empty():
				cfg = tuned
		# (Settings, Simulation: the AI cars without a soft body: rigid, Opponent.js aiDamage "off")
		if str(Settings.get_value("sim_ai_damage")) == "off" and cfg is Dictionary:
			cfg = (cfg as Dictionary).duplicate(true)
			var sbc: Variant = cfg.get("softbody", {})
			cfg["softbody"] = (sbc as Dictionary).merged({"enabled": false}, true) if sbc is Dictionary else {"enabled": false}
		var e := Entry.new()
		e.car = Car.new()
		e.car.engine_damage_on = false
		e.car.setup(id, cfg if cfg is Dictionary else {})
		e.car.freeze = true              # (until it is on its slot: the cars are all at the origin until then)
		e.car.set_meta("track_id", t.track_id)
		CarModel.paint(e.car.model_root, CarModel.AI_COLOURS[i % CarModel.AI_COLOURS.size()])
		e.audio = CarAudio.new()
		e.audio.setup(e.car, true)
		world.add_child(e.audio)
		var flames := ExhaustFlames.new()
		flames.setup(e.car)
		world.add_child(flames)
		e.car.name = "AI%d" % (i + 1)
		e.name = "%s %d" % [e.car.config.get("name", id), i + 1]
		world.add_child(e.car)
		e.driver = AIDriver.new()
		e.driver.setup(e.car, line, pace * (1.0 - 0.03 * (i % 4)))
		# its pit stops: box i + 2 of the track (box 1 is the player's), with tyre wear on (AIPit)
		e.driver.pit = AIPit.new()
		e.driver.pit.setup(e.car, line, t.config, i + 1, e.name)
		e.slot = slot_i
		e.car.contact_monitor = true
		e.car.max_contacts_reported = 4
		entries.append(e)
		slot_i += 1
	player_car.contact_monitor = true
	player_car.max_contacts_reported = 4
	var chosen_text := ", ".join(chosen.map(func(o): return "%s%s" % [o.get("car"), "~" + str(o["tune"]) if str(o.get("tune", "")) != "" else ""]))
	RunLog.event("race: %d laps, %d opponents (%s%s), the player %s (place %d), %s%s" % [laps, opponents, ", ".join(cars),
		"; chosen: %s" % chosen_text if not chosen.is_empty() else "",
		"on pole" if player_slot == 0 else ("at the back" if player_slot == opponents else "random"), player_slot + 1,
		str(extra.get("difficulty", "normal")), "" if line != null else ", no racing line: no AI cars, the laps by the gates"])


## The places on the grid, once the line is as it will be (World settles and shortens it when the road can be felt):
## 0 is the start, then the grid boxes of the track, else two by two behind it on the line; from another place than
## pole the places go front to back along the start. And where the laps are counted from: the finish (the first gate).
func _make_slots() -> void:
	var start: Dictionary = track.start
	var gates: Array = track.config.get("gates", [])
	if line != null:
		if not gates.is_empty():
			origin = line.nearest(Vector3(float(gates[0]["x"]), 0, float(gates[0]["z"])))
		else:
			origin = line.nearest(Vector3(float(start.get("x", 0)), 0, float(start.get("z", 0))))
	_slots.clear()
	for s in entries.size():
		_slots.append(_slot(s))
	if _grid != "front":
		var h := float(start.get("heading", 0))
		var dir := Vector2(cos(h), sin(h))
		var s0 := Vector2(float(start.get("x", 0)), float(start.get("z", 0)))
		_slots.sort_custom(func(a, b): return (Vector2(a["x"], a["z"]) - s0).dot(dir) > (Vector2(b["x"], b["z"]) - s0).dot(dir))


func _slot(s: int) -> Dictionary:
	var start: Dictionary = track.start
	if s == 0:
		return {"x": float(start.get("x", 0)), "z": float(start.get("z", 0)), "heading": float(start.get("heading", 0))}
	var grid: Array = track.config.get("grid", [])
	if s < grid.size():
		var b: Dictionary = grid[s]
		return {"x": float(b.get("x", 0)), "z": float(b.get("z", 0)), "heading": float(b.get("heading", 0))}
	if line == null:
		return {"x": float(start.get("x", 0)), "z": float(start.get("z", 0)), "heading": float(start.get("heading", 0))}
	var start_i := line.nearest(Vector3(float(start.get("x", 0)), 0, float(start.get("z", 0))))
	var i := start_i - roundi((7.0 * s + 4.0) / RacingLine.STEP)
	var p := line.point(i)
	var nxt := line.point(i + 1)
	var h := atan2(nxt.z - p.z, nxt.x - p.x)
	var side := (1.0 if (s - 1) % 2 == 0 else -1.0) * 2.2
	return {"x": p.x - sin(h) * side, "z": p.z + cos(h) * side, "heading": h}


## The cars of the player's kind (a car against cars, a kart against karts, a motorcycle against motorcycles), not the player's own; else the player's.
func _opponent_cars(player_car: Car) -> Array:
	# (a kart: light, or a kart by its name; the go-kart 250cc weighs 330 kg)
	var kind := func(cfg: Dictionary) -> String:
		if str(cfg.get("type", "car")) == "motorcycle":
			return "motorcycle"
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
	# (the road under a slot, through the cars: the ray found the roof of a car that stood there, and the car was
	# dropped from more than a metre, which threw a motorcycle over on the grid)
	var cars: Array[RID] = []
	for e in entries:
		cars.append(e.car.get_rid())
	var space: PhysicsDirectSpaceState3D = (world.track as Node3D).get_world_3d().direct_space_state
	_make_slots()
	for e in entries:
		var s: Dictionary = _slots[e.slot]
		e.car.set_meta("slot", s)
		var q := PhysicsRayQueryParameters3D.create(Vector3(s["x"], 2000.0, s["z"]), Vector3(s["x"], -2000.0, s["z"]), 0xFFFFFFFF, cars)
		var hit: Dictionary = space.intersect_ray(q)
		var y: float = float(hit["position"].y) if not hit.is_empty() else world.track.ground_at(s["x"], s["z"])
		e.car.place(Vector3(s["x"], y + e.car.wheels[0].radius + 0.15, s["z"]), s["heading"])
		e.car.repair()
		e.car.freeze = false
		e.index = -1
		e.laps = 0
		# (a test: the AI cars start with this many litres, to make them pit soon)
		if e.driver != null and Content.arg("ai-fuel") != "":
			e.car.fuel = minf(e.car.tank, float(Content.arg("ai-fuel")))


func is_held() -> bool:
	return state == State.FLYBY or (state == State.COUNTDOWN and countdown > 1.0)


## The fly-by ends (its time, or Enter, Space or a click): the countdown.
func skip_flyby() -> void:
	if state == State.FLYBY:
		flyby_skip = true


## The camera of the fly-by now (main.js beginFlyby): over the grid from the front to the back, at the side of it,
## 2.4 m up, looking a little ahead along the grid; [position, the point it looks at].
func flyby_camera() -> Array:
	var s: Dictionary = track.start
	var h := float(s.get("heading", 0))
	var d := Vector3(cos(h), 0.0, sin(h))
	var s0 := Vector3(float(s.get("x", 0)), 0.0, float(s.get("z", 0)))
	var front := 0.0
	var back := 0.0
	for e in entries:
		var at := (e.car.global_position - s0).dot(d)
		if e.driver != null:
			front = maxf(front, at)
		back = minf(back, at)
	front += 14.0
	back -= 14.0
	var t := minf(1.0, flyby_time / FLYBY_SECONDS)
	var k := t * t * (3.0 - 2.0 * t)
	var along := front + (back - front) * k
	var ground := player.car.global_position.y - player.car.wheels[0].radius
	var across := Vector3(-d.z, 0.0, d.x)
	var eye := s0 + d * along + across * 8.0
	eye.y = ground + 2.4
	var look := s0 + d * (along - 5.0) - across * 0.5
	look.y = ground + 0.7
	return [eye, look]


func _physics_process(dt: float) -> void:
	if state == State.FLYBY:
		flyby_time += minf(dt, 1.0)
		if flyby_skip or flyby_time >= FLYBY_SECONDS:
			state = State.COUNTDOWN
			countdown = 4.0
			RunLog.event("race: the fly-by %s" % ("skipped" if flyby_skip else "done"))
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
					RunLog.line("race: %s touches %s at %.0f km/h" % [e.car.name, (b as Car).name, absf(e.car.speed) * 3.6])
		e.touching = now
		# (Settings, Simulation: "Only near my car": the shell of an AI car further than the range is not worked out)
		if e.driver != null and e.car.shell != null:
			e.car.shell.skip = str(Settings.get_value("sim_ai_damage")) == "near" and player != null \
				and e.car.global_position.distance_to(player.car.global_position) > float(Settings.get_value("sim_ai_range"))
		if e.driver == null:
			continue
		if is_held():
			e.car.throttle_input = 0.0
			e.car.brake_input = 1.0
			e.car.handbrake_input = 1.0
			e.car.steer_input = 0.0
			continue
		e.driver.others = others
		var pit := e.driver.pit
		pit.laps_left = laps - maxi(0, e.laps - 1)
		pit.finished = e.finish_time >= 0.0
		e.driver.drive(dt)
		# put back on the line (AIDriver: on its side, lost, no headway, blocked for long; Opponent.js crashedAt); in
		# the pits only when it gets nowhere away from its stop for a while (not while it waits in its box)
		var why := e.driver.put_back_reason
		if why == "" and pit.stuck(dt):
			why = "stuck in the pits"
		if why != "":
			e.driver.put_back()
			e.put_back += 1
			RunLog.event("race: %s put back on the line (%s)" % [e.name, why])


## The lap and the part of it, along the line from the finish (no line: the laps of the gates, LapTimer).
func _progress(e: Entry) -> void:
	if line == null:
		if lap_timer == null:
			return
		var n := lap_timer.laps_done + (1 if lap_timer.lap_started else 0)
		while e.laps < n and e.finish_time < 0.0:
			_crossed(e)
		return
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
	if e.driver != null and e.driver.pit != null:
		e.driver.pit.lap_done()
	if e.laps > laps and state != State.COUNTDOWN:
		e.finish_time = clock
		var pitted := "" if e.driver == null or e.driver.pit == null else ", %d pit stops" % e.driver.pit.stops
		RunLog.event("race: %s finished P%d in %s%s" % [e.name, position_of(e), LapTimer.format_time(clock), pitted])
		if e.driver != null:
			e.driver.save_learned()
		if e == player:
			state = State.DONE
			finished.emit()
			var knocks := 0
			var back := 0
			var stops := PackedStringArray()
			for x in entries:
				if x.driver != null:
					knocks += x.knocks
					back += x.put_back
					stops.append("%s %d" % [x.name, x.driver.pit.stops])
			RunLog.event("race stats: touches between cars %d (each counted by both), AI put back %d, pit stops: %s" % [knocks, back, ", ".join(stops)])


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


## The AI cars that are heard: the three nearest to the camera.
func _process(_delta: float) -> void:
	var cam := get_viewport().get_camera_3d()
	if cam == null:
		return
	var ais: Array[Entry] = []
	for e in entries:
		if e.audio != null:
			ais.append(e)
	var at := cam.global_position
	ais.sort_custom(func(a: Entry, b: Entry) -> bool: return a.car.global_position.distance_squared_to(at) < b.car.global_position.distance_squared_to(at))
	for k in ais.size():
		ais[k].audio.set_audible(k < AUDIBLE)


func countdown_text() -> String:
	if state != State.COUNTDOWN:
		return ""
	var n := ceili(countdown - 1.0)
	return str(n) if n > 0 else "GO"


## The results as the browser shows them (main.js renderResults): a headline ("You won!", "Finished P2"), the laps and
## the track, and a row per car: the place, the name, the best lap and the time of the winner, the gap of the others
## (+1.234) or how many laps a car that still runs is behind the leader (+1 lap). The rows change as the others come in.
## [headline, subtitle, rows: [place, name, best, time, player]].
func results() -> Array:
	var rows := order()
	var position := rows.find(player) + 1
	var head := "Finished" if rows.size() < 2 else ("You won!" if position == 1 else "Finished P%d" % position)
	var leader: Entry = rows[0]
	var leader_progress := float(laps) if leader.finish_time >= 0.0 else _progress_of(leader)
	var out: Array = []
	for i in rows.size():
		var r: Entry = rows[i]
		var time := ""
		if r.finish_time < 0.0:
			var down := maxi(0, floori(leader_progress - _progress_of(r) + 1e-6))
			time = ("+%d lap%s" % [down, "s" if down > 1 else ""]) if down > 0 else "running"
		elif i == 0:
			time = LapTimer.format_time(r.finish_time)
		else:
			time = "+" + LapTimer.format_time(r.finish_time - leader.finish_time)
		out.append([i + 1, r.name, "–" if r.best_lap < 0.0 else LapTimer.format_time(r.best_lap), time, r == player])
	return [head, "%d laps · %s" % [laps, track_name], out]


## The laps that a car has done, and the part of the one it drives (on the grid a little under 0).
func _progress_of(e: Entry) -> float:
	return e.laps - 1 + e.fraction


func results_text() -> String:
	var r := results()
	var lines := PackedStringArray([r[0], r[1]])
	for row: Array in r[2]:
		lines.append("%d.  %-28s %10s   best %s" % [row[0], row[1], row[3], row[2]])
	return "\n".join(lines)
