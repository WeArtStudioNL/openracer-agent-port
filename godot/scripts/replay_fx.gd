class_name ReplayFx
extends RefCounted
## The effects in the replay (web/js/Replay.js attach, advanceEffect, buildEffects): the skid marks, the smoke and the
## dust, the marbles, the debris, the pieces and the particles of a part that broke, the drops and the stains of a leak,
## and the weather, the time of day and the state of the ground. They are not drawn from the samples of the cars:
## every effect tells the replay what it makes as it makes it (a row of numbers, with the time), and in the replay the
## same code makes it again: forwards in small steps from the rows, and for a jump or a way back made as it was at
## that time (from the rows of the last seconds, its lookback, or from all of them: replay_rebuild). What the game
## had is kept when the replay starts and put back when it ends.
##
## An effect: ReplayFx.attach(kind, car, object) when it is made (car null: one of the scene), and add(kind, car, row)
## for what it makes (row[0] is set to the time). The object has replay_lookback(kind) -> s, replay_add(kind, row),
## replay_step(kind, dt), replay_clear(kind), replay_snapshot(kind) -> Variant, replay_restore(kind, snap), and if it
## likes replay_rebuild(kind, rows, end, t) (makes what rows[0..end) left at time t; then the lookback is not used).
## While a replay plays, ReplayFx.active is true and the effects make nothing of their own.

const STEP := 1.0 / 30.0
const MAX_ROWS := 400000            # per effect (the oldest go first)
const NOT_IN_FILES := ["pieces"]    # (the pieces of a part that broke hold meshes: in a file only with their replay_pack)

static var recording: ReplayFx = null
static var active := false
static var _pending: Array = []     # [kind, car, object] made before the replay

var replay: Node
var rows := {}                      # key -> Array of rows (Array of floats; row[0] the time)
var objects := {}                   # key -> [object, kind]
var _cursor := {}
var _base := {}                     # key -> the number of the first row kept
var _snapshots := {}
var _extra := {}                    # key -> what a file holds for an effect besides its rows (replay_pack)
var _time := -1.0
var _built := 0


## An effect is made: its rows are recorded under kind and the index of its car in the replay.
static func attach(kind: String, car: Node, object: Object) -> void:
	if recording != null and is_instance_valid(recording.replay):
		recording._attach(kind, car, object)
	else:
		_pending.append([kind, weakref(car) if car != null else null, weakref(object)])


## What an effect makes: a row (row[0] is set to the time of the replay). The number of the row (for amend), or -1.
static func add(kind: String, car: Node, row: Array) -> int:
	if recording == null or active or not is_instance_valid(recording.replay):
		return -1
	return recording._add(kind, car, row)


## Changes a row that was recorded (a marble that came to rest: where and when).
static func amend(kind: String, car: Node, id: int, at: int, values: Array) -> void:
	if recording == null or id < 0:
		return
	var key := recording._key(kind, car)
	var list: Array = recording.rows.get(key, [])
	var i: int = id - int(recording._base.get(key, 0))
	if i < 0 or i >= list.size():
		return
	var row: Array = list[i]
	for k in values.size():
		if at + k < row.size():
			row[at + k] = values[k]
		else:
			row.append(values[k])


## The time of the replay now (s; 0 when nothing records).
static func now() -> float:
	return recording._now() if recording != null and is_instance_valid(recording.replay) else 0.0


## The replay of the drive is gone (the drive ends): nothing records, nothing is kept.
static func forget(r: ReplayFx) -> void:
	if recording == r:
		recording = null
		active = false
	_pending.clear()


func _init(r: Node) -> void:
	replay = r


## The recorder of the drive: takes the effects that were made before it.
func record() -> void:
	recording = self
	active = false
	for p in _pending:
		var car: Node = (p[1] as WeakRef).get_ref() if p[1] != null else null
		var obj: Object = (p[2] as WeakRef).get_ref()
		if obj != null and (p[1] == null or car != null):
			_attach(p[0], car, obj)
	_pending.clear()


func _key(kind: String, car: Node) -> String:
	if car == null:
		return kind
	var i: int = replay.cars.find(car)
	return "%s/%d" % [kind, i] if i >= 0 else ""


func _attach(kind: String, car: Node, object: Object) -> void:
	var key := _key(kind, car)
	if key == "":
		return
	objects[key] = [object, kind]
	if not rows.has(key):
		rows[key] = []
	if _extra.has(key) and object.has_method("replay_unpack"):
		object.replay_unpack(kind, _extra[key])


func _now() -> float:
	return (replay.first_index + replay.count) / Replay.RATE - maxf(0.0, replay.get("_record_in"))


func _add(kind: String, car: Node, row: Array) -> int:
	if replay.playing or replay.viewer:
		return -1
	var key := _key(kind, car)
	if key == "" or not rows.has(key):
		return -1
	var list: Array = rows[key]
	row[0] = _now()
	list.append(row)
	if list.size() > MAX_ROWS:
		list.remove_at(0)
		_base[key] = int(_base.get(key, 0)) + 1
	return int(_base.get(key, 0)) + list.size() - 1


## What is older than the recording is not needed (the replay dropped its oldest minute).
func trim(from: float) -> void:
	for key in rows:
		var list: Array = rows[key]
		var k := _first_after(list, from - 1e-6)
		if k > 0:
			rows[key] = list.slice(k)
			_base[key] = int(_base.get(key, 0)) + k


static func _first_after(list: Array, t: float) -> int:
	var lo := 0
	var hi := list.size()
	while lo < hi:
		var mid := (lo + hi) >> 1
		if float(list[mid][0]) <= t:
			lo = mid + 1
		else:
			hi = mid
	return lo


# ---- playback

## The replay starts: what the effects of the game show is kept.
func begin() -> void:
	active = true
	_time = -1.0
	_snapshots.clear()
	for key in objects:
		var o: Array = objects[key]
		if is_instance_valid(o[0]) and not replay.viewer:
			_snapshots[key] = o[0].replay_snapshot(o[1])


## The replay ends: the effects of the game as they were.
func end() -> void:
	active = false
	for key in objects:
		var o: Array = objects[key]
		if not is_instance_valid(o[0]):
			continue
		if _snapshots.has(key):
			o[0].replay_restore(o[1], _snapshots[key])
		else:
			o[0].replay_clear(o[1])
	_snapshots.clear()
	_time = -1.0


## Once per frame of the replay: the effects go to its time (forwards in steps, or made again for a jump).
func show(t: float) -> void:
	if _time >= 0.0 and t >= _time and t - _time <= 0.25:
		if t > _time:
			for key in objects:
				_advance(key, _time, t)
		_time = t
		return
	var real := Time.get_ticks_msec()
	if _time >= 0.0 and real - _built < 80:
		return
	_built = real
	for key in objects:
		_build(key, t)
	_time = t


func _advance(key: String, from: float, to: float) -> void:
	var o: Array = objects[key]
	if not is_instance_valid(o[0]):
		return
	var list: Array = rows.get(key, [])
	var c: int = _cursor.get(key, 0)
	var a := from
	while a < to - 1e-9:
		var b := to if a + STEP >= to - 1e-6 else a + STEP
		while c < list.size() and float(list[c][0]) <= b:
			o[0].replay_add(o[1], list[c])
			c += 1
		o[0].replay_step(o[1], b - a)
		a = b
	_cursor[key] = c


func _build(key: String, t: float) -> void:
	var o: Array = objects[key]
	if not is_instance_valid(o[0]):
		return
	var list: Array = rows.get(key, [])
	if o[0].has_method("replay_rebuild"):
		var end := _first_after(list, t)
		o[0].replay_rebuild(o[1], list, end, t)
		_cursor[key] = end
		return
	o[0].replay_clear(o[1])
	var start := maxf(replay.start_time(), t - float(o[0].replay_lookback(o[1])))
	var c := _first_after(list, start)
	var a := start
	while a < t - 1e-9:
		var b := t if a + 0.05 >= t - 1e-6 else a + 0.05
		while c < list.size() and float(list[c][0]) <= b:
			o[0].replay_add(o[1], list[c])
			c += 1
		o[0].replay_step(o[1], b - a)
		a = b
	_cursor[key] = c


# ---- the files

## The rows from time a to b (s) for a file: key -> Array of PackedFloat32Array (the time from a).
## An effect whose rows need more than numbers (the pieces of a part that broke: their meshes) gives that with
## replay_pack(kind, rows) (it may renumber the rows), kept as "<key>:data", and takes it back with replay_unpack.
func pack(a: float, b: float) -> Dictionary:
	var out := {}
	for key in rows:
		var kind := (key as String).get_slice("/", 0)
		var o: Array = objects.get(key, [null])
		var packer: Object = o[0] if is_instance_valid(o[0]) and o[0].has_method("replay_pack") else null
		if kind in NOT_IN_FILES and packer == null:
			continue
		var list: Array = rows[key]
		var part: Array = []
		for i in range(_first_after(list, a - 1e-6), _first_after(list, b)):
			var r := PackedFloat32Array(list[i])
			r[0] -= a
			part.append(r)
		if not part.is_empty():
			if packer != null:
				var extra: Variant = packer.replay_pack(kind, part)
				if extra != null:
					out[key + ":data"] = extra
				elif kind in NOT_IN_FILES:
					continue
			out[key] = part
	return out


## The rows of a film made of moments of this recording (times: the time of every sample of the film, rate: its samples a second): a row goes to where its moment is in the film.
func baked(times: Array, rate: float) -> Dictionary:
	var lo := float(times.min())
	var hi := float(times.max())
	var whole := pack(lo, hi + 1.0 / rate)
	var out := {}
	for key: String in whole:
		if key.ends_with(":data"):
			out[key] = whole[key]
			continue
		var list: Array = whole[key]
		var part: Array = []
		for i in range(times.size() - 1):
			var a := float(times[i]) - lo
			var b := float(times[i + 1]) - lo
			if b <= a:
				continue
			for r in list:
				if float(r[0]) >= a and float(r[0]) < b:
					var row := PackedFloat32Array(r)
					row[0] = (i + (float(r[0]) - a) / (b - a)) / rate
					part.append(row)
		if not part.is_empty():
			out[key] = part
	return out


## The rows of a file (pack), at the times of its samples (the file starts at 0).
func unpack(data: Variant) -> void:
	if not (data is Dictionary):
		return
	for key in data:
		if str(key).ends_with(":data"):
			_extra[str(key).trim_suffix(":data")] = data[key]
			continue
		var list: Array = []
		if not (data[key] is Array):
			continue
		for r in data[key]:
			if (r is PackedFloat32Array or r is Array) and r.size() > 0:
				list.append(Array(r))
		rows[str(key)] = list
