class_name ReplaySoft
extends RefCounted
## The soft body in the replay (Replay.js, Parts.js replayRecord/replayApply, SOFTBODY.md M4): next to the samples a
## car with a shell keeps a list of records, and a record is only made when something in it changed (a car that drives
## without a hit makes none). A record: the sample number, the displacement of every node of the shell that the model
## uses, for every part its state (0 held, 1 hinged, 2 free, 3 broken) and, when it is off, where what is seen of it
## is, and for every wheel whether it is off (and where its body is), its toe, its camber and the shift of its hub.
##
## Playback: the record at the time (the last one at or before it), and in between two that are at most two samples
## apart the shell and the parts that are off in both are interpolated. The model bends with the displacement of the
## record (the bones of the shell), a part that is off in the record is a copy with the dent the car had when it came
## off, at its place; a wheel that is off is hidden on the car and its copy is where its body was. The game (paused)
## is not touched: at the end everything is seen as the game has it again.

const EPS := 0.0005                 # m: a smaller change makes no record (the bend of a wheel at rest)

var entries: Array = []             # per car: {nodes, names, records: [{s, disp, parts, wheels}]} or null
var _shown: Array = []              # per car, while the replay is on: {copies: {part: Node3D}, wheels: {i: Node3D}, rec}


func _init(cars: Array) -> void:
	for c: Car in cars:
		entries.append(_entry_of(c))


static func _entry_of(c: Car) -> Variant:
	if not is_instance_valid(c) or c.shell == null:
		return null
	var names: Array = []
	if c.parts != null:
		for p in c.parts.parts:
			names.append(p.name)
	return {"nodes": c.shell.sb.body_count, "names": names, "records": []}


## Once a sample: a record of every car whose shell, parts or wheels changed.
func record(cars: Array, sample: int) -> void:
	for n in cars.size():
		var c: Car = cars[n]
		var e: Variant = entries[n] if n < entries.size() else null
		if e == null or not is_instance_valid(c) or c.shell == null or c.shell.sb.body_count != int(e["nodes"]):
			continue
		var sb := c.shell.sb
		var disp := sb.displacement.slice(0, sb.body_count)
		var parts: Array = []
		if c.parts != null:
			for p in c.parts.parts:
				var code := {"held": 0, "hinged": 1, "free": 2, "broken": 3}.get(p.state, 0) as int
				parts.append([code, c.parts.seen_at(p) if code == 1 or code == 2 else Transform3D.IDENTITY])
		var wheels: Array = []
		var rig := c.shell.rig
		for i in 4:
			var w := c.wheels[i]
			var body: Variant = rig.bodies[i] if rig != null else null
			var base: Variant = rig._base_hub[i] if rig != null else null
			wheels.append([rig != null and rig.lost[i], w.toe_bend, w.camber_bend, (w.hub - base) if base != null else Vector3.ZERO,
				(body as Node3D).global_transform if body != null and is_instance_valid(body) else Transform3D.IDENTITY])
		var recs: Array = e["records"]
		if not recs.is_empty() and _same(recs[-1], disp, parts, wheels):
			continue
		recs.append({"s": sample, "disp": disp, "parts": parts, "wheels": wheels})


static func _same(r: Dictionary, disp: PackedVector3Array, parts: Array, wheels: Array) -> bool:
	var d: PackedVector3Array = r["disp"]
	for k in disp.size():
		if d[k].distance_squared_to(disp[k]) > EPS * EPS:
			return false
	for i in parts.size():
		if r["parts"][i][0] != parts[i][0] or not (r["parts"][i][1] as Transform3D).origin.is_equal_approx(parts[i][1].origin) \
				or not (r["parts"][i][1] as Transform3D).basis.is_equal_approx(parts[i][1].basis):
			return false
	for i in 4:
		var a: Array = r["wheels"][i]
		var b: Array = wheels[i]
		if a[0] != b[0] or absf(a[1] - b[1]) > 0.002 or absf(a[2] - b[2]) > 0.002 or (a[3] as Vector3).distance_to(b[3]) > EPS \
				or (a[4] as Transform3D).origin.distance_to((b[4] as Transform3D).origin) > EPS:
			return false
	return true


## The oldest samples went (drop of them): the records follow, one before the start is kept as the state at the start.
func trim(drop: int) -> void:
	for e: Variant in entries:
		if e == null:
			continue
		var recs: Array = e["records"]
		var first := 0
		while first + 1 < recs.size() and int(recs[first + 1]["s"]) <= drop:
			first += 1
		recs = recs.slice(first)
		for r: Dictionary in recs:
			r["s"] = maxi(0, int(r["s"]) - drop)
		e["records"] = recs


## The replay begins: nothing of the game is changed, what is shown is laid over it.
func begin(cars: Array) -> void:
	_shown.clear()
	for c in cars:
		_shown.append({"copies": {}, "wheels": {}, "rec": null})


## The cars as they were at sample f (a fraction between two samples).
func show(cars: Array, f: float) -> void:
	for n in cars.size():
		var c: Car = cars[n]
		var e: Variant = entries[n] if n < entries.size() else null
		if e == null or not is_instance_valid(c) or c.shell == null or c.shell_mesh == null or not c.shell_mesh.ready or n >= _shown.size():
			continue
		if c.shell.sb.body_count != int(e["nodes"]) or (c.parts != null and c.parts.parts.size() != (e["names"] as Array).size()):
			continue
		var recs: Array = e["records"]
		var i := _find(recs, f)
		if i < 0:
			_apply(c, n, null, null, 0.0)
			continue
		var a: Dictionary = recs[i]
		var b: Variant = recs[i + 1] if i + 1 < recs.size() and int(recs[i + 1]["s"]) - int(a["s"]) <= 2 else null
		var u := clampf((f - int(a["s"])) / float(int(b["s"]) - int(a["s"])), 0.0, 1.0) if b != null else 0.0
		_apply(c, n, a, b, u)


## The last record at or before sample f, or -1.
static func _find(recs: Array, f: float) -> int:
	var lo := 0
	var hi := recs.size() - 1
	var out := -1
	while lo <= hi:
		var mid := (lo + hi) / 2
		if float(recs[mid]["s"]) <= f:
			out = mid
			lo = mid + 1
		else:
			hi = mid - 1
	return out


func _apply(c: Car, n: int, a: Variant, b: Variant, u: float) -> void:
	var shown: Dictionary = _shown[n]
	var sb := c.shell.sb
	var sk := c.shell_mesh.skeleton
	var disp := PackedVector3Array()
	disp.resize(sb.count)
	if a != null:
		var da: PackedVector3Array = a["disp"]
		var db: PackedVector3Array = b["disp"] if b != null else da
		for k in da.size():
			disp[k] = da[k].lerp(db[k], u)
	if sk != null:
		for k in sb.count:
			sk.set_bone_pose_position(k, disp[k])
	# the parts: a copy where one that is off in the record was, the meshes on the car for one that is held
	if c.parts != null:
		# (all the meshes on the car first, then the ones of a part that is off, with what rides on it, are hidden)
		for p in c.parts.parts:
			for m in c.parts.meshes_on_car(p):
				m.visible = true
		for pi in c.parts.parts.size():
			if a != null and int(a["parts"][pi][0]) != 0:
				for m in c.parts.meshes_on_car(c.parts.parts[pi]):
					m.visible = false
		for pi in c.parts.parts.size():
			var p: CarParts.Part = c.parts.parts[pi]
			var code: int = a["parts"][pi][0] if a != null else 0
			if p.body != null and is_instance_valid(p.body):
				p.body.visible = false
			var copy: Node3D = shown["copies"].get(pi)
			if code == 1 or code == 2:
				if copy == null:
					copy = c.parts.copy_of(p, _frozen(c, n, pi, a))
					c.get_parent().add_child(copy)
					shown["copies"][pi] = copy
				var xa: Transform3D = a["parts"][pi][1]
				var xb: Transform3D = b["parts"][pi][1] if b != null and b["parts"][pi][0] == code else xa
				copy.global_transform = xa.interpolate_with(xb, u)
				copy.visible = true
			elif copy != null:
				copy.visible = false
	# the wheels: the bend, and a wheel that is off where its body was
	for i in 4:
		var w := c.wheels[i]
		var rig := c.shell.rig
		if rig == null or rig._base_hub[i] == null:
			continue
		var wr: Array = a["wheels"][i] if a != null else [false, 0.0, 0.0, Vector3.ZERO, Transform3D.IDENTITY]
		w.toe_bend = wr[1]
		w.camber_bend = wr[2]
		w.hub = (rig._base_hub[i] as Vector3) + (wr[3] as Vector3)
		if w.hub_node != null:
			w.hub_node.visible = not wr[0]
			w.hub_node.rotation.z = -w.camber_bend if c.bike == null else w.hub_node.rotation.z
		if rig.bodies[i] != null and is_instance_valid(rig.bodies[i]):
			(rig.bodies[i] as Node3D).visible = false
		var wc: Node3D = shown["wheels"].get(i)
		if wr[0]:
			if wc == null:
				wc = Node3D.new()
				for child in w.spin_node.get_children():
					wc.add_child(child.duplicate())
				c.get_parent().add_child(wc)
				shown["wheels"][i] = wc
			wc.global_transform = wr[4]
			wc.visible = true
		elif wc != null:
			wc.visible = false


## The displacement of the shell when part pi came off (the first record of its run off before a): it keeps that dent.
func _frozen(c: Car, n: int, pi: int, a: Dictionary) -> PackedVector3Array:
	var recs: Array = entries[n]["records"]
	var i := recs.find(a)
	while i > 0 and int(recs[i - 1]["parts"][pi][0]) != 0:
		i -= 1
	var d: PackedVector3Array = (recs[maxi(0, i)]["disp"] as PackedVector3Array).duplicate()
	d.resize(c.shell.sb.count)
	return d


## Back to the game: every car is seen as the game has it.
func end(cars: Array) -> void:
	for n in mini(cars.size(), _shown.size()):
		var c: Car = cars[n]
		var shown: Dictionary = _shown[n]
		for k: int in shown["copies"]:
			(shown["copies"][k] as Node).queue_free()
		for k: int in shown["wheels"]:
			(shown["wheels"][k] as Node).queue_free()
		if not is_instance_valid(c) or c.shell == null:
			continue
		if c.shell_mesh != null:
			c.shell_mesh.use(c.shell.sb)
		if c.parts != null:
			for p in c.parts.parts:
				for m in c.parts.meshes_on_car(p):
					m.visible = true
			for p in c.parts.parts:
				if p.state != "held":
					for m in c.parts.meshes_on_car(p):
						m.visible = false
				if p.body != null and is_instance_valid(p.body):
					p.body.visible = true
		var rig := c.shell.rig
		if rig != null:
			for i in 4:
				var w := c.wheels[i]
				if rig._set_hub[i] != null:
					w.hub = rig._set_hub[i]
				if w.hub_node != null:
					w.hub_node.visible = not rig.lost[i]
				if rig.bodies[i] != null and is_instance_valid(rig.bodies[i]):
					(rig.bodies[i] as Node3D).visible = true
	_shown.clear()


## The records of the samples from to to (not in it), for a fragment: numbered from its first sample, and the last one before it as the state at its start
## (a wheel that came off earlier is still off).
func part(from: int, to: int) -> Array:
	var out: Array = []
	for e: Variant in entries:
		if e == null:
			out.append(null)
			continue
		var recs: Array = e["records"]
		var kept: Array = []
		var i := _find(recs, float(from))
		for k in range(maxi(0, i), recs.size()):
			var r: Dictionary = recs[k]
			if int(r["s"]) >= to:
				break
			if int(r["s"]) >= from or k == i:
				var copy := r.duplicate()
				copy["s"] = maxi(0, int(r["s"]) - from)
				kept.append(copy)
		out.append({"nodes": e["nodes"], "names": e["names"], "records": kept})
	return out


## The records for a film made of these moments (at: the sample, a fraction, of every sample of the film): a record when what is seen changes.
func baked(at: Array) -> Array:
	var out: Array = []
	for e: Variant in entries:
		if e == null:
			out.append(null)
			continue
		var recs: Array = e["records"]
		var kept: Array = []
		var was := -2
		for i in at.size():
			var k := _find(recs, float(at[i]))
			if k != was and k >= 0:
				var copy: Dictionary = (recs[k] as Dictionary).duplicate()
				copy["s"] = i
				kept.append(copy)
			was = k
		out.append({"nodes": e["nodes"], "names": e["names"], "records": kept})
	return out


## For the file of a replay: [{nodes, names, records}] (null for a car without a shell).
func save_data() -> Array:
	return entries


func load_data(data: Variant, cars: Array) -> void:
	entries.clear()
	for n in cars.size():
		var e: Variant = data[n] if data is Array and n < (data as Array).size() else null
		entries.append(e if e is Dictionary and (e as Dictionary).has("records") else null)
