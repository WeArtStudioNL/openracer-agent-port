extends Node
## (a scene, for the autoloads) The effects in the replay (ReplayFx, Replay.js attach): the car drives the skidpad (its
## circle, faster and faster until it lets go: marks and smoke), a breakable part is broken (pieces and shards),
## drops and stains of a leak are made; then the replay is opened: at a time before each of them it is not there, after
## it it is, and back in the game everything is as it was. Nothing is written but into the given folders:
##   Godot --headless --fixed-fps 60 --path godot res://tools/test_replay_fx.tscn -- --replay-dir=/tmp/x/r
##     --video-cfg=/tmp/x/v.cfg --user-dir=/tmp/x/u --steer=1 [--car=openracer-muscle] [--shot=/tmp/x/shot.png]
## The traction and stability control are off on the test car. The supermoto makes no marks on full lock: give it
## --steer=0.5. The hatchback slides but makes no smoke in the 17 s (its front tyre reaches about 155 C, smoke starts at
## 180 C).

var world: World
var _fails := 0
var _time := 0.0
var _phase := "drive"
var _broke_at := -1.0
var _leak_at := -1.0
var _game_strips := 0
var _bang_at := -1.0
var _limp_at := -1.0
var _pit_at := -1.0


func _check(ok: bool, what: String) -> void:
	print(("ok    " if ok else "FAIL  ") + what)
	if not ok:
		_fails += 1


func _ready() -> void:
	if Content.arg("replay-dir") == "" or Content.arg("video-cfg") == "":
		push_error("test_replay_fx: give --replay-dir and --video-cfg (nothing of a test goes into the player's data)")
		get_tree().quit(2)
		return
	world = World.new()
	add_child(world)
	var car_id := Content.arg("car") if Content.arg("car") != "" else "openracer-muscle"
	world.setup(car_id, "skidpad", {"mode": "practice", "ghost": false, "records": false})
	world.car.autopilot = true          # (full throttle in a tight circle: --steer, by default 1)
	# (without traction and stability control: with them on, as a new player has them, the car holds about 18 km/h
	# on full lock and its tyres never slide: no marks, no smoke)
	world.car.tc_fitted = false
	world.car.esc_fitted = false


func _strips() -> int:
	var n := 0
	for st: Array in world.effects.get("_strips"):
		n += st.size()
	return n


func _physics_process(dt: float) -> void:
	if world == null or world.car == null:
		return
	_time += dt
	# (the bangs of the exhaust, a rider that goes limp, a pit stop where it stands: ReplayExtras)
	if _phase == "drive" and _bang_at < 0.0 and _time > 6.0:
		_bang_at = world.replay.end_time()
		for k in 3:
			world.car.bang.emit({"strength": 1.2, "loud": true, "flame": 1.5})
	if _phase == "drive" and _limp_at < 0.0 and _time > 8.0 and world.car.bike_model != null:
		_limp_at = world.replay.end_time()
		world.car.bike_model.go_limp()
	if _phase == "drive" and _pit_at < 0.0 and _time > 10.0:
		var pit := world.car.get_node_or_null("PitStop") as PitStop
		if pit != null:
			world.car.wheels[0].wear = 0.6
			pit.force_start()
			_pit_at = world.replay.end_time()
	if _phase == "drive" and _time > 14.0:
		_phase = "break"
		if world.car.parts != null:
			for p in world.car.parts.parts:
				if p.mode == "breakable" and p.state == "held":
					world.car.parts._break(p)
					_broke_at = world.replay.end_time()
					print("broke %s at %.1f s" % [p.name, _broke_at])
					break
		var fumes := world.car.get_node_or_null("EngineFumes")
		if fumes != null:
			var at := world.car.global_position
			for k in 6:
				fumes.call("_drop", at + Vector3(k * 0.1, 0.5, 0), Vector3(0, -1, 0), 0)
			fumes.call("_stain", at + Vector3(0, 0.01, 0), Vector3.UP, 0.2, 0, 0.6)
			_leak_at = world.replay.end_time()
	if _phase == "break" and _time > 17.0:
		_phase = "replay"
		_game_strips = _strips()
		world._start_replay()
		_test.call_deferred()


## The bangs, the rider as a ragdoll, the pit stop, the scraped snow (--set=gfx_ground:snow) and the pieces in a file.
func _test_extras(r: Replay, fx: ReplayFx, shatter: Shatter) -> void:
	var flames: ExhaustFlames = null
	for n in world.get_children():
		if n is ExhaustFlames and (n as ExhaustFlames).car == world.car:
			flames = n
	var lit := func() -> int:
		var k := 0
		for m: MeshInstance3D in flames.get("_sprites"):
			k += 1 if m.visible else 0
		return k
	_check((fx.rows.get("bangs/0", []) as Array).size() >= 3, "the bangs are recorded: %d rows" % (fx.rows.get("bangs/0", []) as Array).size())
	if flames != null and _bang_at > 0.0:
		fx.call("_build", "bangs/0", _bang_at - 1.0)
		var before: int = lit.call()
		fx.call("_build", "bangs/0", _bang_at + 0.05)
		var after: int = lit.call()
		_check(before == 0 and after > 0, "the flames of the bangs: %d before, %d just after" % [before, after])
	if world.car.bike != null:
		# (the posture of the rider: off the seat and the knee out in the bend, as it was at that time)
		var rows: Array = fx.rows.get("posture/0", [])
		_check(rows.size() > 10, "the posture of the rider is recorded: %d rows" % rows.size())
		# (the part of the posture that changed most from the start: hanging off on a sports bike, the foot or the
		# look on a supermoto)
		var keys: Array = ReplayExtras.PostureTrack.POSTURE
		var most: Array = []
		var col := 1
		for row: Array in rows:
			for k in keys.size():
				var d := absf(float(row[1 + k]) - float(rows[0][1 + k]))
				if most.is_empty() or d > absf(float(most[col]) - float(rows[0][col])):
					most = row
					col = 1 + k
		if not most.is_empty():
			var bike: Motorcycle = world.car.bike
			var key: String = keys[col - 1]
			fx.call("_build", "posture/0", float(rows[0][0]) + 0.01)
			var at_start := float(bike.posture[key])
			fx.call("_build", "posture/0", float(most[0]) + 0.01)
			var later := float(bike.posture[key])
			_check(absf(at_start - float(rows[0][col])) < 1e-4 and absf(later - float(most[col])) < 1e-4 and absf(later - at_start) > 0.05,
				"the rider sits as he did: %s %.2f at the start, %.2f at %.1f s (%.2f recorded)" % [key, at_start, later, float(most[0]), float(most[col])])
	if _limp_at > 0.0:
		var rider: MotorcycleRider = world.car.bike_model.rider
		_check((fx.rows.get("rider/0", []) as Array).size() > 10, "the ragdoll is recorded: %d rows" % (fx.rows.get("rider/0", []) as Array).size())
		fx.call("_build", "rider/0", _limp_at - 1.0)
		var on_bike := rider.ragdoll == null
		fx.call("_build", "rider/0", _limp_at + 1.5)
		_check(on_bike and rider.ragdoll != null, "the rider: on the bike before, a ragdoll %.1f s after" % 1.5)
	if _pit_at > 0.0:
		var pit := world.car.get_node_or_null("PitStop") as PitStop
		var rows: Array = fx.rows.get("pit/0", [])
		_check(rows.size() >= 1, "the pit stop is recorded: %d rows" % rows.size())
		fx.call("_build", "pit/0", _pit_at - 1.0)
		var idle := not pit.active
		fx.call("_build", "pit/0", _pit_at + 0.6)
		_check(idle and pit.active and pit.elapsed > 0.4, "the pit stop: idle before, going %.1f s after (elapsed %.2f)" % [0.6, pit.elapsed])
	var ground: Array = fx.rows.get("ground", [])
	if Ground.snow > 0.03:
		_check(ground.size() > 10, "the scraped snow is recorded: %d rows" % ground.size())
		var at: Array = ground[ground.size() / 2]
		fx.call("_build", "ground", r.start_time())
		var fresh := Ground.clear_at(at[2], at[3])
		fx.call("_build", "ground", r.end_time())
		var bare := Ground.clear_at(at[2], at[3])
		_check(fresh < 0.05 and bare > 0.2, "the snow where a wheel went: %.2f bare at the start, %.2f at the end" % [fresh, bare])
	# the pieces in a file: their meshes go with the rows
	if shatter != null and fx.rows.has("pieces"):
		var data := fx.pack(r.start_time(), r.end_time() + 1.0)
		_check(data.has("pieces") and data.has("pieces:data"), "a file has the pieces and their looks")
		var bytes := var_to_bytes(data)
		var again := ReplayFx.new(r)
		again.unpack(bytes_to_var(bytes))
		var keep: Array = shatter.get("_looks").duplicate()
		shatter.set("_looks", [])
		again._attach("pieces", null, shatter)
		var looks: int = (shatter.get("_looks") as Array).size()
		_check(looks > 0 and looks <= keep.size(), "the looks of the pieces back from the file: %d (of %d made)" % [looks, keep.size()])
		shatter.set("_looks", keep)
		fx._attach("pieces", null, shatter)


func _test() -> void:
	var r: Replay = world.replay
	var fx := r.fx
	var skid: Array = fx.rows.get("skid/0", [])
	var smoke: Array = fx.rows.get("smoke/0", [])
	print("rows: %s" % ", ".join(fx.rows.keys().map(func(k): return "%s %d" % [k, (fx.rows[k] as Array).size()])))
	# (a motorcycle hardly slides on the skidpad: a few marks from the rear wheel are enough to test them)
	_check(skid.size() > (5 if world.car.bike != null else 20), "the skid marks are recorded: %d strips (the game shows %d)" % [skid.size(), _game_strips])
	_check(smoke.size() > 5, "the smoke is recorded: %d rows" % smoke.size())
	# the marks at a time: the strips made by then
	for frac in [0.3, 0.9]:
		var t: float = r.start_time() + r.duration() * frac
		r.seek(t)
		fx.show(t)
		fx.call("_build", "skid/0", t)
		var want := mini(ReplayFx._first_after(skid, t), TyreEffects.CHUNK * TyreEffects.CHUNKS)
		_check(_strips() == want, "the marks at %.1f s: %d strips (%d made by then)" % [t, _strips(), want])
	# playing on: the marks grow as they were made
	var t0 := r.start_time() + r.duration() * 0.5
	fx.call("_build", "skid/0", t0)
	var before := _strips()
	fx.call("_advance", "skid/0", t0, t0 + 2.0)
	var grown := ReplayFx._first_after(skid, t0 + 2.0) - ReplayFx._first_after(skid, t0)
	_check(_strips() - before == mini(grown, TyreEffects.CHUNK * TyreEffects.CHUNKS - before), "2 s of play adds the %d strips made then (%d)" % [grown, _strips() - before])
	# the pieces of the part that broke, the stain of the leak
	var shatter := get_tree().get_first_node_in_group("shatter") as Shatter
	if _broke_at > 0.0 and shatter != null:
		fx.call("_build", "pieces", _broke_at - 1.0)
		var none: int = shatter.count()["pieces"]
		fx.call("_build", "pieces", _broke_at + 0.5)
		var some: int = shatter.count()["pieces"]
		_check(none == 0 and some > 0, "the pieces: none before the break, %d after it" % some)
		fx.call("_build", "shards", _broke_at + 0.3)
		_check(shatter.count()["particles"] > 0, "the shards fly after the break (%d)" % shatter.count()["particles"])
	else:
		print("(no breakable part on this car: the pieces are not tested)")
	var fumes := world.car.get_node_or_null("EngineFumes")
	if _leak_at > 0.0 and fumes != null:
		fx.call("_build", "leaks/0", _leak_at - 1.0)
		var stains_before: int = fumes.get("_used_stains")
		fx.call("_build", "leaks/0", _leak_at + 0.5)
		var stains_after: int = fumes.get("_used_stains")
		_check(stains_before == 0 and stains_after >= 1, "the stain of the leak: %d before, %d after" % [stains_before, stains_after])
	_test_extras(r, fx, shatter)
	if Content.arg("shot") != "":
		r.seek(r.end_time() - 0.5)
		await get_tree().create_timer(1.0, true, false, true).timeout
		get_viewport().get_texture().get_image().save_png(Content.arg("shot"))
		print("shot: " + Content.arg("shot"))
	r.exit()
	await get_tree().process_frame
	_check(_strips() == _game_strips, "back in the game: the marks of the game (%d strips)" % _strips())
	print("replay fx test: %s" % ("all fine" if _fails == 0 else "%d failed" % _fails))
	get_tree().quit(1 if _fails else 0)
