class_name ReplayExtras
extends RefCounted
## What else the replay shows as it was (web/js/Replay.js recordRider and the attach of DragStrip.js, Flames.js and
## Pit.js), recorded through ReplayFx as rows: the rider of a motorcycle that is a ragdoll ("rider", the places of his
## fifteen particles every sample while he is one, and a row without them when he is back on the bike), the lamps of
## the drag tree ("dragTree", a row at every change), the bangs of the exhaust ("bangs", the strength, how loud, the
## flame: the flames are made again at the pipes of the car as it stands in the replay, and the pop is heard) and the
## pit stops ("pit", a row when a stop begins and when it ends: how long, which tyres, the repair; the PitStop of the
## car is given that state in the replay, for what draws it).
##
## The replay watches the cars every sample (record): these are read from the game as it is, not told by the code
## that makes them. One Effect per kind and car, with the methods of ReplayFx.

const RIDER_FLOATS := 45             # 15 particles, x y z
const LAMPS := ["pre", "stage", "amber1", "amber2", "amber3", "green", "red"]

var replay: Node
var _tracks := {}                    # key -> Effect


func _init(r: Node) -> void:
	replay = r


## Makes the tracks of the cars and the scene that are there (once each), and records what changed.
func record() -> void:
	attach_all()
	for key in _tracks:
		(_tracks[key] as Effect).watch()


## The tracks of what is there now (also for a file that is watched: its rows find their objects).
func attach_all() -> void:
	var world: Node = replay.get("world")
	for c: Car in replay.cars:
		if not is_instance_valid(c):
			continue
		if c.bike_model != null and c.bike_model.can_ragdoll() and _new("rider", c):
			_add("rider", c, RiderTrack.new(c))
		if _new("bangs", c):
			_add("bangs", c, BangTrack.new(c, world))
		var pit := c.get_node_or_null("PitStop") as PitStop
		if pit != null and _new("pit", c):
			_add("pit", c, PitTrack.new(c, pit))
	if world != null and _new("dragTree", null):
		for n in world.get_children():
			if n is DragStrip:
				_add("dragTree", null, DragTrack.new(n))


## The tyre smoke and dust after a jump of the replay (TyreEffects "smoke": [t, wheel, x, y, z, amount, loose]): the
## clouds of the rows of the last seconds made again at once, every puff with the age it has at time t (a GPU particle
## cannot be wound back, so they are emitted one by one, older, where the wheel was and as far up as they drift).
## smoke and dust: the emitters of the four wheels.
static func smoke_rebuild(smoke: Array, dust: Array, rows: Array, end: int, t: float) -> void:
	for e: GPUParticles3D in smoke + dust:
		e.emitting = false
		e.restart()
		e.amount_ratio = 1.0
	var flags := GPUParticles3D.EMIT_FLAG_POSITION | GPUParticles3D.EMIT_FLAG_VELOCITY | GPUParticles3D.EMIT_FLAG_CUSTOM
	for i in range(ReplayFx._first_after(rows, t - 7.0), end):
		var r: Array = rows[i]
		var w := int(r[1])
		if w < 0 or w >= smoke.size():
			continue
		var loose := float(r[6]) > 0.5
		var e: GPUParticles3D = dust[w] if loose else smoke[w]
		var age := t - float(r[0])
		if age >= e.lifetime:
			continue
		# (as many as the emitter makes in a fifteenth of a second at that amount)
		var n := roundi(float(r[5]) * e.amount / e.lifetime / 15.0)
		for k in n:
			var at := Vector3(r[2], r[3], r[4]) + Vector3(randf() - 0.5, 0.0, randf() - 0.5) * 0.3
			at.y += (-0.2 if loose else 0.45) * age
			e.emit_particle(Transform3D(Basis(), at), Vector3(randf() - 0.5, 0.3, randf() - 0.5) * 0.4, Color.WHITE,
				Color(randf() * TAU, age / e.lifetime, randf(), 1.0), flags)


func _key(kind: String, car: Car) -> String:
	return "%s/%d" % [kind, car.get_instance_id() if car != null else 0]


func _new(kind: String, car: Car) -> bool:
	return not _tracks.has(_key(kind, car))


func _add(kind: String, car: Car, track: Effect) -> void:
	var key := _key(kind, car)
	track.kind = kind
	track.car = car
	_tracks[key] = track
	ReplayFx.attach(kind, car, track)


## An effect in the replay (the methods that ReplayFx calls).
class Effect:
	extends RefCounted
	var kind := ""
	var car: Car = null

	func watch() -> void:
		pass

	func replay_lookback(_kind: String) -> float:
		return 0.0

	func replay_add(_kind: String, _row: Array) -> void:
		pass

	func replay_step(_kind: String, _dt: float) -> void:
		pass

	func replay_clear(_kind: String) -> void:
		pass

	func replay_snapshot(_kind: String) -> Variant:
		return null

	func replay_restore(_kind: String, _snap: Variant) -> void:
		pass

	## The state of the last row before the time (a jump).
	func replay_rebuild(k: String, rows: Array, end: int, _t: float) -> void:
		if end > 0:
			replay_add(k, rows[end - 1])
		else:
			replay_clear(k)


## The rider that is a ragdoll: [t, 1, 45 floats] every sample while he is one, [t, 0] when he is back on the bike.
class RiderTrack:
	extends Effect
	var _was := false

	func _init(c: Car) -> void:
		car = c

	func _rider() -> MotorcycleRider:
		return car.bike_model.rider if is_instance_valid(car) and car.bike_model != null else null

	func watch() -> void:
		var r := _rider()
		if r == null:
			return
		if r.ragdoll != null:
			var row := [0.0, 1.0]
			for p in r.ragdoll.p:
				row.append_array([p.x, p.y, p.z])
			ReplayFx.add(kind, car, row)
			_was = true
		elif _was:
			ReplayFx.add(kind, car, [0.0, 0.0])
			_was = false

	func replay_add(_kind: String, row: Array) -> void:
		var r := _rider()
		if r == null:
			return
		r.replay_hold = true
		if row.size() >= 2 + RIDER_FLOATS and float(row[1]) > 0.5:
			var places := PackedVector3Array()
			for i in RIDER_FLOATS / 3:
				places.append(Vector3(row[2 + i * 3], row[3 + i * 3], row[4 + i * 3]))
			r.show_ragdoll(places)
		elif r.ragdoll != null:
			r.recover()

	## (the end of a replay of a file: he is on the bike again, the game moves him)
	func replay_clear(_kind: String) -> void:
		var r := _rider()
		if r == null:
			return
		if r.ragdoll != null:
			r.recover()
		r.replay_hold = false

	func replay_rebuild(k: String, rows: Array, end: int, _t: float) -> void:
		if end > 0:
			replay_add(k, rows[end - 1])
		else:
			replay_add(k, [0.0, 0.0])

	func replay_snapshot(_kind: String) -> Variant:
		var r := _rider()
		if r == null:
			return null
		r.replay_hold = true
		return {"ragdoll": r.ragdoll, "p": r.ragdoll.p.duplicate() if r.ragdoll != null else PackedVector3Array()}

	func replay_restore(_kind: String, snap: Variant) -> void:
		var r := _rider()
		if r == null or not (snap is Dictionary):
			return
		r.keep_ragdoll(snap["ragdoll"], snap["p"])
		r.replay_hold = false


## The lamps of the drag tree: [t, pre, stage, amber1, amber2, amber3, green, red] at every change.
class DragTrack:
	extends Effect
	var drag: DragStrip
	var _last := []

	func _init(d: DragStrip) -> void:
		drag = d

	func _now() -> Array:
		var out := []
		for name in LAMPS:
			out.append(1.0 if bool(drag.lit.get(name, false)) else 0.0)
		return out

	func watch() -> void:
		if not is_instance_valid(drag):
			return
		var now := _now()
		if now != _last:
			_last = now
			ReplayFx.add(kind, null, [0.0] + now)

	func _show(row: Array) -> void:
		if not is_instance_valid(drag):
			return
		for i in LAMPS.size():
			drag._lamp(LAMPS[i], i + 1 < row.size() and float(row[i + 1]) > 0.5)

	func replay_add(_kind: String, row: Array) -> void:
		_show(row)

	func replay_clear(_kind: String) -> void:
		_show([0.0])

	func replay_snapshot(_kind: String) -> Variant:
		return [0.0] + _now() if is_instance_valid(drag) else null

	func replay_restore(_kind: String, snap: Variant) -> void:
		if snap is Array:
			_show(snap)


## The bangs of the exhaust: [t, strength, loud, flame] as the car makes them; in the replay the car makes them again
## (the flames at its pipes, the pop of its sound) and the flames fly on (ExhaustFlames, which the pause holds).
class BangTrack:
	extends Effect
	var world: Node
	var _flames: ExhaustFlames = null

	func _init(c: Car, w: Node) -> void:
		car = c
		world = w
		c.bang.connect(_on_bang)

	func _on_bang(e: Dictionary) -> void:
		if not ReplayFx.active:
			ReplayFx.add(kind, car, [0.0, float(e.get("strength", 1.0)), 1.0 if e.get("loud", false) else 0.0, float(e.get("flame", 1.0))])

	## The flames of the car (a car of a file has none: they are made).
	func flames() -> ExhaustFlames:
		if _flames != null and is_instance_valid(_flames):
			return _flames
		if world != null:
			for n in world.get_children():
				if n is ExhaustFlames and (n as ExhaustFlames).car == car:
					_flames = n
					return _flames
			_flames = ExhaustFlames.new()
			_flames.setup(car)
			world.add_child(_flames)
		return _flames

	func replay_lookback(_kind: String) -> float:
		return 2.0

	func replay_add(_kind: String, row: Array) -> void:
		if not is_instance_valid(car) or row.size() < 4:
			return
		flames()
		car.bang.emit({"strength": row[1], "loud": float(row[2]) > 0.5, "flame": row[3]})

	func replay_step(_kind: String, dt: float) -> void:
		var f := flames()
		if f != null:
			f._process(dt)

	func replay_clear(_kind: String) -> void:
		var f := flames()
		if f != null:
			f._process(60.0)           # (every flame is at its end: gone)

	## A jump: the flames of the last moment as they were then (no pop: the sound is of a replay that plays).
	func replay_rebuild(k: String, rows: Array, end: int, t: float) -> void:
		replay_clear(k)
		var f := flames()
		if f == null:
			return
		for i in range(ReplayFx._first_after(rows, t - 0.4), end):
			var row: Array = rows[i]
			f.emit_bang({"strength": row[1], "loud": float(row[2]) > 0.5, "flame": row[3]})
			var next: float = float(rows[i + 1][0]) if i + 1 < end else t
			f._process(maxf(0.0, next - float(row[0])))

	func replay_restore(k: String, _snap: Variant) -> void:
		replay_clear(k)


## The pit stops: [t, active, elapsed, tyres, repair, work, total, n, wheels 0..3] when a stop begins and when it ends
## (and when its plan changes); the replay gives the PitStop of the car that state at its time.
class PitTrack:
	extends Effect
	var pit: PitStop
	var _was := false
	var _plan := {}

	func _init(c: Car, p: PitStop) -> void:
		car = c
		pit = p

	func watch() -> void:
		if not is_instance_valid(pit):
			return
		if pit.active == _was and (not pit.active or pit.plan.hash() == _plan.hash()):
			return
		_was = pit.active
		var plan: Dictionary = pit.plan if pit.active else {}
		_plan = plan.duplicate()
		var list: Array = plan.get("change", [])
		var row := [0.0, 1.0 if pit.active else 0.0, pit.elapsed, float(plan.get("tyres", 0.0)), float(plan.get("repair", 0.0)),
			float(plan.get("work", 0.0)), float(plan.get("total", 0.0)), float(list.size())]
		for k in 4:
			row.append(float(list[k]) if k < list.size() else -1.0)
		row.append(float(plan.get("fuel", 0.0)))
		ReplayFx.add(kind, car, row)

	func _show(row: Array, t: float) -> void:
		if not is_instance_valid(pit) or row.size() < 12:
			return
		pit.active = float(row[1]) > 0.5
		if not pit.active:
			pit.plan = {}
			pit.elapsed = 0.0
			return
		var change: Array = []
		for k in int(row[7]):
			change.append(int(row[8 + k]))
		pit.plan = {"fuel": float(row[12]) if row.size() > 12 else 0.0, "tyres": row[3], "change": change, "repair": row[4],
			"work": row[5], "total": row[6]}
		pit.elapsed = float(row[2]) + maxf(0.0, t - float(row[0]))

	func replay_add(_kind: String, row: Array) -> void:
		_show(row, float(row[0]))

	func replay_step(_kind: String, dt: float) -> void:
		if is_instance_valid(pit) and pit.active:
			pit.elapsed += dt

	func replay_clear(_kind: String) -> void:
		if is_instance_valid(pit):
			pit.active = false
			pit.plan = {}

	func replay_rebuild(k: String, rows: Array, end: int, t: float) -> void:
		if end > 0:
			_show(rows[end - 1], t)
		else:
			replay_clear(k)

	func replay_snapshot(_kind: String) -> Variant:
		if not is_instance_valid(pit):
			return null
		return {"active": pit.active, "elapsed": pit.elapsed, "plan": pit.plan.duplicate(true), "done": pit.done}

	func replay_restore(_kind: String, snap: Variant) -> void:
		if not is_instance_valid(pit) or not (snap is Dictionary):
			return
		pit.active = snap["active"]
		pit.elapsed = snap["elapsed"]
		pit.plan = snap["plan"]
		pit.done = snap["done"]
