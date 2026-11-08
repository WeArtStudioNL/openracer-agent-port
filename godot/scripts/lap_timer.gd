class_name LapTimer
extends Node
## The laps of the player (web/js/Car.js updateLaps, Records.js and Ghost.js). A track with gates (lines across the
## road in track.json: x, z, heading, width; the first is the finish) counts a lap when the car crosses the finish
## after all the other gates, each in its direction. The time of every gate is kept, so a lap can be compared
## with the best one as it goes. The best lap per track and car is kept in user://records.cfg, and its recording
## (the body and the wheels, 30 times a second) in user://ghosts/, to be driven again by a see-through car.

signal message(text: String)
signal lap_done(samples: PackedFloat32Array)     # a lap was counted: its recording (the racing line recorder)

const RECORDS := "user://records.cfg"
const GHOSTS := "user://ghosts"
const TEST_RECORDS := "user://test-records.cfg"     # (the AI of the tests drives: not the player's records)
const TEST_GHOSTS := "user://test-ghosts"
const RATE := 30.0
const FIELDS := 12                  # per sample: position 3, rotation 4, steering 1, suspension 4

var car: Car
var gates: Array = []
var track_id := ""
var clock := 0.0                    # s of driving (the physics time)
var lap_started := false
var lap_start := 0.0
var lap_invalid := false            # a reset in the lap: no record
var laps_done := 0
var last_lap := -1.0
var best_lap := -1.0
var lap_times: Array[float] = []    # every lap of this drive (the HUD shows the last three)
var new_record := false             # the best lap of this drive is a record
var best_splits := PackedFloat32Array()
var splits := PackedFloat32Array()  # the time of every gate in this lap (-1: not yet)
var delta := 0.0                    # against the best lap at the last gate
var delta_time := -100.0            # the clock when it was shown
var ghost: Car = null
var records_file := RECORDS
var key := ""                       # the record of: the car, or "car~tune" with a setup of its own (Records.js key)
var save_records := true            # the menu: "Save lap records" (off: no record is kept)
var use_ghost := true               # the menu: "Ghost of your best lap"
var ghosts_dir := GHOSTS

var _passed: Array[bool] = []
var _last_pos := Vector3.INF
var _recording := PackedFloat32Array()
var _record_in := 0.0
var _best_samples := PackedFloat32Array()


## opts (the menu): records (bool), ghost (bool), tune (the name of the setup in use, "" for the car as made).
func setup(c: Car, track: Track, opts := {}) -> void:
	name = "LapTimer"
	car = c
	key = car.car_id + ("~" + str(opts["tune"]) if str(opts.get("tune", "")) != "" else "")
	save_records = bool(opts.get("records", true))
	use_ghost = bool(opts.get("ghost", true))
	track_id = track.track_id
	gates = track.config.get("gates", [])
	if Content.arg("ai") != "":
		records_file = TEST_RECORDS
		ghosts_dir = TEST_GHOSTS
	_passed.resize(gates.size())
	splits.resize(gates.size())
	splits.fill(-1.0)
	var cfg := ConfigFile.new()
	if cfg.load(records_file) == OK:
		best_lap = float(cfg.get_value(track_id, key, -1.0))
		best_splits = cfg.get_value(track_id, key + ":splits", PackedFloat32Array())
	var f := _ghost_path()
	if FileAccess.file_exists(f):
		_best_samples = bytes_to_var(FileAccess.get_file_as_bytes(f))
	if not _best_samples.is_empty() and use_ghost:
		_make_ghost.call_deferred()


func has_laps() -> bool:
	return not gates.is_empty()


## A new start: no lap is going.
func restart() -> void:
	lap_started = false
	lap_invalid = false
	_last_pos = Vector3.INF
	_recording = PackedFloat32Array()
	if ghost:
		ghost.visible = false


## A reset in the lap: it goes on, but it is no record.
func invalidate() -> void:
	if lap_started:
		lap_invalid = true
	_last_pos = Vector3.INF


func lap_time() -> float:
	return clock - lap_start if lap_started else 0.0


func _physics_process(dt: float) -> void:
	if car == null or car.freeze or gates.is_empty():
		return
	clock += dt
	var p := car.global_position
	if _last_pos != Vector3.INF:
		var g := _crossed(_last_pos, p)
		if g >= 0:
			_gate(g)
	_last_pos = p
	if lap_started:
		_record(dt)
		_drive_ghost()


## The gate whose line the car crossed between a and b in its direction, or -1.
func _crossed(a: Vector3, b: Vector3) -> int:
	for g in gates.size():
		var gate: Dictionary = gates[g]
		var h := float(gate.get("heading", 0))
		var dx := cos(h)
		var dz := sin(h)
		var gx := float(gate.get("x", 0))
		var gz := float(gate.get("z", 0))
		var a0 := (a.x - gx) * dx + (a.z - gz) * dz
		var a1 := (b.x - gx) * dx + (b.z - gz) * dz
		if a0 < 0.0 and a1 >= 0.0:
			var t := a0 / (a0 - a1)
			var px := a.x + (b.x - a.x) * t - gx
			var pz := a.z + (b.z - a.z) * t - gz
			var across := -px * dz + pz * dx
			if absf(across) <= float(gate.get("width", 30)) / 2.0:
				return g
	return -1


func _gate(g: int) -> void:
	var p := car.global_position
	RunLog.line("GATE %d at %.1f %.1f %.1f  lap time %.2f" % [g, p.x, p.y, p.z, lap_time()])
	if g != 0:
		if lap_started:
			_passed[g] = true
			splits[g] = lap_time()
			if g < best_splits.size() and best_splits[g] > 0.0 and not lap_invalid:
				delta = splits[g] - best_splits[g]
				delta_time = clock
		return
	# the finish: a lap of less than twenty seconds is no lap (back and forth over the line)
	if lap_started and lap_time() < 20.0:
		return
	if lap_started:
		var missed := -1
		for k in range(1, gates.size()):
			if not _passed[k] and missed < 0:
				missed = k
		# (a reset in the lap may have put the car past a gate: the lap counts, but it is no record)
		if missed > 0 and lap_invalid:
			missed = -1
		if missed > 0:
			message.emit("Lap not counted: gate %d was missed" % missed)
			RunLog.event("lap not counted: gate %d missed" % missed)
		else:
			var t := lap_time()
			last_lap = t
			lap_times.append(t)
			laps_done += 1
			lap_done.emit(_recording)
			var record := not lap_invalid and (best_lap < 0.0 or t < best_lap)
			RunLog.event("lap %d: %s%s%s" % [laps_done, format_time(t), "  RECORD" if record else "", "  (reset in the lap)" if lap_invalid else ""])
			if best_lap > 0.0 and not lap_invalid:
				delta = t - best_lap
				delta_time = clock
			if record:
				new_record = save_records
				best_lap = t
				splits[0] = t
				best_splits = splits.duplicate()
				_best_samples = _recording
				if save_records:
					_save()
				message.emit("New best lap  %s" % format_time(t))
				if ghost == null and use_ghost:
					_make_ghost()
			else:
				message.emit("Lap %s" % format_time(t))
	else:
		RunLog.event("lap timing started")
	lap_started = true
	lap_invalid = false
	lap_start = clock
	_passed.fill(false)
	splits.fill(-1.0)
	_recording = PackedFloat32Array()
	_record_in = 0.0
	if ghost:
		ghost.visible = true
		RunLog.event("the ghost of the best lap (%s) drives" % format_time(best_lap))


func _save() -> void:
	var cfg := ConfigFile.new()
	cfg.load(records_file)
	cfg.set_value(track_id, key, best_lap)
	cfg.set_value(track_id, key + ":splits", best_splits)
	cfg.save(records_file)
	DirAccess.make_dir_recursive_absolute(ghosts_dir)
	var f := FileAccess.open(_ghost_path(), FileAccess.WRITE)
	if f:
		f.store_buffer(var_to_bytes(_best_samples))


func _ghost_path() -> String:
	return ghosts_dir.path_join("%s__%s.ghost" % [track_id, key.replace("~", "__tune__").validate_filename()])


func _record(dt: float) -> void:
	_record_in -= dt
	if _record_in > 0.0:
		return
	_record_in += 1.0 / RATE
	var xf := car.global_transform
	var q := xf.basis.get_rotation_quaternion()
	_recording.append_array([xf.origin.x, xf.origin.y, xf.origin.z, q.x, q.y, q.z, q.w, car.steer_angle])
	for w in car.wheels:
		_recording.append(w.length)


## The see-through car of the best lap: the same car, without physics.
func _make_ghost() -> void:
	ghost = Car.new()
	ghost.setup(car.car_id, car.config)
	ghost.make_ghost()
	ghost.visible = false
	get_parent().add_child(ghost)


func _drive_ghost() -> void:
	if ghost == null or _best_samples.is_empty():
		return
	var n := _best_samples.size() / FIELDS
	var f := lap_time() * RATE
	var i := int(f)
	if i >= n - 1:
		ghost.visible = false
		return
	ghost.visible = true
	var t := f - i
	var a := i * FIELDS
	var b := (i + 1) * FIELDS
	var pos := Vector3(_best_samples[a], _best_samples[a + 1], _best_samples[a + 2]).lerp(Vector3(_best_samples[b], _best_samples[b + 1], _best_samples[b + 2]), t)
	var qa := Quaternion(_best_samples[a + 3], _best_samples[a + 4], _best_samples[a + 5], _best_samples[a + 6])
	var qb := Quaternion(_best_samples[b + 3], _best_samples[b + 4], _best_samples[b + 5], _best_samples[b + 6])
	ghost.global_transform = Transform3D(Basis(qa.slerp(qb, t)), pos)
	ghost.steer_angle = lerpf(_best_samples[a + 7], _best_samples[b + 7], t)
	var speed := pos.distance_to(Vector3(_best_samples[b], _best_samples[b + 1], _best_samples[b + 2])) * RATE
	for k in 4:
		var w := ghost.wheels[k]
		w.length = lerpf(_best_samples[a + 8 + k], _best_samples[b + 8 + k], t)
		w.steer = ghost.steer_angle if w.front else 0.0
		w.spin = fmod(w.spin + speed / w.radius * get_physics_process_delta_time(), TAU)


static func format_time(t: float) -> String:
	if t < 0.0:
		return "-:--.---"
	var m := int(t / 60.0)
	return "%d:%06.3f" % [m, t - m * 60.0]
