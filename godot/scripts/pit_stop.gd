class_name PitStop
extends Node
## The pit stop (web/js/Pit.js): a car that stands still with its wheels in its pit box (track.json "pit": {
## "boxes": [{ x, z, heading }] }: box 1 is the player's, 2 to 8 the AI cars' in the order of the grid; a track with
## fewer boxes than cars lets a car without a box use any) is serviced, with tyre wear on (Settings): the tank is
## filled, the tyres are changed when the most worn is past 15 % or one leaks, and with damage on the car is
## repaired (the shell, the parts, the engine, the wheels that are bent or torn off: 1.5 s each). What it needs sets
## how long it takes; the fuel, the tyres and the repair go side by side, with a moment to lift the car and to drop
## it; through the repair the dents and the bent wheels go back bit by bit. The player's car is held on the jacks
## until the stop is done; a car that pulls away early (the AI) keeps what was done.
## In the picture (Car.js, Pit.js): the player's car goes up 10 cm on the jacks while it is lifted, its wheels hanging,
## and falls on them when it is let go; a wheel that has its tyre changed comes off and out by 60 cm, is gone, and the
## new one goes on (changeAt, showChange); the parts that came off fade away where they lie while the car goes up, and
## then each in its turn is brought from 60 cm out to its place on the car and fades in (Parts.js fetchFade, fetchTo).

const BOX_W := 4.0
const BOX_L := 8.0
const FUEL_RATE := 6.0              # litres a second
const LIFT := 1.2                   # s to lift the car and to drop it
const TYRES_MIN := 2.5
const TYRES_PER_WEAR := 5.0
const TYRES_WHEN := 0.15
const REPAIR_BASE := 1.0
const REPAIR_PER_CM := 1.5
const REPAIR_DENTS_MAX := 7.0
const REPAIR_PART := 1.0
const REPAIR_WHEEL := 1.5
const REPAIR_MAX := 10.0
const JACK_HEIGHT := 0.1            # m that the car goes up
const CHANGE_OUT := 0.6             # m that a wheel is pulled out, and a part brought from

var car: Car
var boxes: Array = []
var box_index := -1                 # the box of this car (the player 0, the AI from 1); -1: any box
var hold_car := false               # the player's car: on the jacks until the stop is done
var active := false
var done := false
var elapsed := 0.0
var forced := false                 # a stop where the car stands (the debug view, Pit.js forceStart)
var plan := {}                      # { fuel, tyres, change, repair, work, total } in seconds
var _fuel_given := 0.0
var _fuel_wanted := 0.0
var _changed: Array = []
var _repaired := false
var _repairing := false
var _held := false
var _jack := Transform3D.IDENTITY   # where the car stood when it went up
var _length0: Array = []            # the length of each spring then
var _fetching: Array = []           # the parts that are brought back: [part, its meshes]
var _wheel_hidden := [false, false, false, false]


func _ready() -> void:
	process_priority = 10           # (after the car has placed its wheels)


## The pit boxes of a track.json: [{ x, z, heading }], at most 8.
static func boxes_of(track_cfg: Dictionary) -> Array:
	var out: Array = []
	var pit: Variant = track_cfg.get("pit", {})
	if not (pit is Dictionary) or not (pit.get("boxes") is Array):
		return out
	for b in pit["boxes"]:
		if b is Dictionary and b.has("x") and b.has("z"):
			out.append({"x": float(b["x"]), "z": float(b["z"]), "heading": float(b.get("heading", 0.0))})
		if out.size() == 8:
			break
	return out


## The white lines of the boxes on the road (a node for the track), with the number of the box.
static func markings(boxes_list: Array, track: Node3D) -> Node3D:
	var root := Node3D.new()
	root.name = "PitBoxes"
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.albedo_color = Color(0.93, 0.93, 0.9)
	mat.render_priority = -1
	for n in boxes_list.size():
		var b: Dictionary = boxes_list[n]
		var along := Vector3(cos(b["heading"]), 0.0, sin(b["heading"]))
		var side := Vector3(-along.z, 0.0, along.x)
		var centre := Vector3(b["x"], 0.0, b["z"])
		var y := 0.0
		if track.has_method("ground_at"):
			y = track.ground_at(b["x"], b["z"])
		var st := SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		var lines := [[-1, -1, 1, -1], [1, -1, 1, 1], [-1, -1, -1, 1]]     # (the back and the two sides; the front is open)
		for l in lines:
			var a: Vector3 = centre + along * (l[0] * BOX_L / 2.0) + side * (l[1] * BOX_W / 2.0)
			var c: Vector3 = centre + along * (l[2] * BOX_L / 2.0) + side * (l[3] * BOX_W / 2.0)
			var d := (c - a).normalized()
			var w := Vector3(-d.z, 0.0, d.x) * 0.06
			var lift := Vector3(0, y + 0.02, 0)
			for v in [a - w, a + w, c + w, a - w, c + w, c - w]:
				st.add_vertex(v + lift)
		var mi := MeshInstance3D.new()
		mi.mesh = st.commit()
		mi.material_override = mat
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		root.add_child(mi)
		var label := Label3D.new()
		label.text = str(n + 1)
		label.font_size = 160
		label.pixel_size = 0.004
		label.modulate = Color(0.93, 0.93, 0.9)
		label.rotation = Vector3(-PI / 2.0, -float(b["heading"]) + PI / 2.0, 0.0)
		label.position = centre - along * (BOX_L / 2.0 - 0.8) + Vector3(0, y + 0.03, 0)
		root.add_child(label)
	return root


func setup(c: Car, track_cfg: Dictionary, index: int, hold: bool) -> void:
	car = c
	name = "PitStop"
	boxes = boxes_of(track_cfg)
	box_index = index if index < boxes.size() else -1
	hold_car = hold


## Whether all four wheels are in a box (a little room round it), at least two of them on the ground; on a track
## without boxes, whether the car stands on the pit lane (PitLane).
func in_box() -> bool:
	if boxes.is_empty():
		# (a track without boxes: the pit lane, all four wheels on the road of the surface track01)
		for w in car.wheels:
			if not w.contact or w.surface != "track01":
				return false
		return true
	var list: Array = [boxes[box_index]] if box_index >= 0 else boxes
	for b in list:
		var cs := cos(float(b["heading"]))
		var sn := sin(float(b["heading"]))
		var touching := 0
		var inside := true
		for w in car.wheels:
			var at := car.to_global(w.hub)
			var dx: float = at.x - b["x"]
			var dz: float = at.z - b["z"]
			if w.contact:
				touching += 1
			if absf(dx * cs + dz * sn) > BOX_L / 2.0 + 0.25 or absf(-dx * sn + dz * cs) > BOX_W / 2.0 + 0.25:
				inside = false
				break
		if inside and touching >= 2:
			return true
	return false


func remaining() -> float:
	return maxf(0.0, float(plan.get("total", 0.0)) - elapsed) if active else 0.0


## What a stop would take now (s).
func estimate() -> float:
	return float(_plan_for()["total"])


func _repair_time() -> float:
	if not Settings.get_value("damage"):
		return 0.0
	var secs := 0.0
	if car.shell != null:
		var sb := car.shell.sb
		var sum := 0.0
		var broken := 0
		for k in sb.body_count:
			sum += sb.q[k].length()
			if not sb.alive(k):
				broken += 1
		var mean := sum / maxf(1.0, sb.body_count)
		if mean > 0.002 or broken > 0:
			secs += REPAIR_BASE + minf(REPAIR_DENTS_MAX, mean * 100.0 * REPAIR_PER_CM)
	if car.engine_damage != null:
		var h := car.engine_damage.health
		var worst: float = maxf(maxf(h["block"], h["top"]), maxf(maxf(h["pan"], h["radiator"]), h["wear"]))
		if worst > 0.02 or h["coolant"] < 0.95 or h["oil"] < 0.95 or h["failed"] > 0.0:
			secs += 3.0 + 6.0 * worst + (3.0 if h["failed"] > 0.0 else 0.0)
	if car.parts != null:
		secs += REPAIR_PART * car.parts.count_off()
	if car.shell != null and car.shell.rig != null:
		secs += REPAIR_WHEEL * car.shell.rig.bent()
	return minf(REPAIR_MAX, secs)


func _plan_for() -> Dictionary:
	var fuel := (car.tank - car.fuel) / FUEL_RATE
	if fuel < 0.05:
		fuel = 0.0
	var repair := _repair_time()
	var worn := 0.0
	for w in car.wheels:
		worn = maxf(worn, w.wear)
	var leaking := TyreDamage.punctured(car)
	var tyres := TYRES_MIN + TYRES_PER_WEAR * minf(1.0, worn) if worn > TYRES_WHEN or leaking else 0.0
	var change: Array = []
	if tyres > 0.0:
		for i in car.wheels.size():
			if car.wheels[i].wear > TYRES_WHEN or car.wheels[i].leak > 0.0:
				change.append(i)
	var work := maxf(fuel, maxf(tyres, repair))
	return {"fuel": fuel, "tyres": tyres, "change": change, "repair": repair, "work": work,
		"total": LIFT + work + (LIFT if tyres > 0.0 or repair > 0.0 else 0.3)}


func _physics_process(dt: float) -> void:
	# (in a replay the stop is shown from what was recorded: ReplayExtras gives it its state, the car its place)
	if car == null or not is_instance_valid(car) or ReplayFx.active:
		return
	if forced and done:
		forced = false
	if float(Settings.get_value("tyre_wear")) <= 0.0 and not forced:
		_end()
		return
	var still := (active and hold_car) or forced or (absf(car.speed) < 0.4 and in_box())
	if not still:
		if active or done:
			_end()
		return
	if done:
		return
	if not active:
		active = true
		elapsed = 0.0
		plan = _plan_for()
		_fuel_given = 0.0
		_fuel_wanted = car.tank - car.fuel
		_changed.clear()
		_repaired = false
		_repairing = false
		if plan["fuel"] <= 0.0 and plan["tyres"] <= 0.0 and plan["repair"] <= 0.0:
			done = true
			active = false
			return
		RunLog.event("pit stop: %s, %.1f s (fuel %.1f s, tyres %.1f s, repair %.1f s)" % [car.name, plan["total"], plan["fuel"], plan["tyres"], plan["repair"]])
		if hold_car:
			_held = true
			car.set_deferred("freeze", true)
			_jack = car.global_transform
			_length0 = car.wheels.map(func(w: Car.Wheel) -> float: return w.length)
		if plan["repair"] > 0.0:
			_fetch_start()
	elapsed += dt
	if _held:
		_jack_up()
	var t := elapsed - LIFT
	if not _fetching.is_empty():
		_fetch_step(t)
	if t > 0.0:
		var give := minf(_fuel_wanted, t * FUEL_RATE) - _fuel_given
		if give > 0.0:
			car.fuel = minf(car.tank, car.fuel + give)
			_fuel_given += give
		var list: Array = plan["change"]
		var slot: float = plan["tyres"] / list.size() if not list.is_empty() else 0.0
		for c in list.size():
			if c >= _changed.size():
				_changed.append(false)
			if not _changed[c] and t >= slot * (c + 0.5):
				_changed[c] = true
				_fresh_tyre(car.wheels[list[c]])
	if plan["repair"] > 0.0 and not _repaired and t > 0.0 and car.shell != null:
		# (the dents and the bent wheels go back bit by bit through the work; then all is whole)
		if not _repairing:
			_repairing = true
			car.shell.sb.repair_start()
			car.shell.rig.repair_start()
		car.shell.sb.repair_to(t / maxf(0.01, plan["work"]))
		car.shell.rig.repair_to(t / maxf(0.01, plan["work"]))
	if plan["repair"] > 0.0 and not _repaired and t >= plan["work"]:
		_repaired = true
		car.repair()
		_fetch_end()
	if elapsed >= plan["total"]:
		done = true
		active = false
		RunLog.event("pit stop done: %s" % car.name)
		_release()


## A stop where the car stands, whether it is in a box or not (the debug view: Pit stop here).
func force_start() -> void:
	forced = true
	done = false


func _fresh_tyre(w: Car.Wheel) -> void:
	w.wear = 0.0
	w.temp = 60.0
	w.leak = 0.0
	w.pressure_loss = 0.0
	TyreDamage.apply(car, w)


func _end() -> void:
	# (a car that pulls away in the middle of a stop, the AI: the parts that were being brought back go on at once)
	if not _fetching.is_empty() and car.parts != null:
		car.parts.repair()
		_fetch_end()
	active = false
	done = false
	plan = {}
	_release()


## How far the car is up on the jacks, 0 to 1: it goes up in the first part of the stop and stays up (Pit.js lift).
func lift() -> float:
	return minf(1.0, elapsed / LIFT) if active and not plan.is_empty() else 0.0


## The car on the jacks: held where it stopped, 10 cm up as it is lifted; its wheels hang (each spring as long as it is
## without load, at most to its droop stop).
func _jack_up() -> void:
	var up := JACK_HEIGHT * lift()
	car.global_transform = Transform3D(_jack.basis, _jack.origin + Vector3.UP * up)
	car.linear_velocity = Vector3.ZERO
	car.angular_velocity = Vector3.ZERO
	var most := car.susp_length + car.droop
	for i in car.wheels.size():
		var w := car.wheels[i]
		var hang := minf(most, w.free_length - w.offset)
		var was: float = _length0[i] if i < _length0.size() else w.length
		w.length = minf(maxf(was, hang), was + up)
		w.contact = w.length < hang - 1e-3


## A wheel in its turn of a tyre change at a time of the work (s from when the car is up): { out (m), off }, or {}
## when it is not being changed. The first 40 % of its turn the old wheel comes off and out by 60 cm, then it is
## gone, the last 40 % the new one goes on (Pit.js changeAt).
static func change_at(list: Array, slot: float, work: float, index: int) -> Dictionary:
	var c := list.find(index)
	if c < 0 or not (slot > 0.0):
		return {}
	var f := (work - slot * c) / slot
	if f <= 0.0 or f >= 1.0:
		return {}
	if f < 0.4:
		return {"out": CHANGE_OUT * smoothstep(0.0, 1.0, f / 0.4), "off": false}
	if f < 0.6:
		return {"out": CHANGE_OUT, "off": true}
	return {"out": CHANGE_OUT * smoothstep(0.0, 1.0, (1.0 - f) / 0.4), "off": false}


## The wheel of index while its tyre is changed now, or {} (Pit.js tyreChange).
func tyre_change(index: int) -> Dictionary:
	if not active or plan.is_empty() or (plan["change"] as Array).is_empty():
		return {}
	var list: Array = plan["change"]
	return change_at(list, float(plan["tyres"]) / list.size(), elapsed - LIFT, index)


## The wheels in the picture (Pit.js showChange): one that is changed is pulled out sideways (to its own side) or
## hidden between the old one and the new one. (After the car has placed its wheels: process_priority.)
func _process(_delta: float) -> void:
	if car == null or not is_instance_valid(car):
		return
	for i in car.wheels.size():
		var w := car.wheels[i]
		if w.hub_node == null:
			continue
		var ch := tyre_change(i) if active else {}
		if ch.is_empty():
			if _wheel_hidden[i]:
				_wheel_hidden[i] = false
				w.hub_node.visible = true
			continue
		w.hub_node.position += Vector3(1.0 if w.left else -1.0, 0.0, 0.0) * float(ch["out"])
		if bool(ch["off"]) == w.hub_node.visible:
			w.hub_node.visible = not ch["off"]
			_wheel_hidden[i] = ch["off"]


## The parts that came off are taken out of the physics (they no longer move or hit anything) to be brought back.
func _fetch_start() -> void:
	_fetch_end()
	if car.parts == null:
		return
	for p: CarParts.Part in car.parts.parts:
		if p.state == "held" or p.body == null or not is_instance_valid(p.body):
			continue
		if p.joint != null and is_instance_valid(p.joint):
			p.joint.queue_free()
		p.joint = null
		if p.state == "hinged":
			p.state = "free"
		p.pending = false
		p.body.freeze = true
		p.body.collision_layer = 0
		p.body.collision_mask = 0
		var meshes: Array[GeometryInstance3D] = []
		for n in p.body.find_children("*", "GeometryInstance3D", true, false):
			meshes.append(n as GeometryInstance3D)
		_fetching.append([p, meshes])


## While the car goes up the parts fade away where they lie; then each in its turn (a share of the work) comes from
## 60 cm out to its place on the car and comes into sight over the first 60 % of its turn, and holds there.
func _fetch_step(t: float) -> void:
	var turn := maxf(0.1, float(plan["work"])) / _fetching.size()
	for c in _fetching.size():
		var p: CarParts.Part = _fetching[c][0]
		if p.body == null or not is_instance_valid(p.body):
			continue
		var seen := 1.0
		if t < 0.0:
			seen = -t / LIFT if p.state != "broken" else 0.0
		else:
			var share := clampf((t - turn * c) / turn, 0.0, 1.0)
			seen = minf(1.0, share / 0.6)
			if share > 0.0:
				var out := car.global_basis * p.centre
				out.y = 0.0
				out = out.normalized() if out.length() > 1e-3 else car.global_basis.x
				var e := smoothstep(0.0, 1.0, share)
				var home := Transform3D(car.global_basis, car.global_position + out * CHANGE_OUT * (1.0 - e))
				p.body.global_transform = home * car.parts.seen_at(p).affine_inverse() * p.body.global_transform
		for m: GeometryInstance3D in _fetching[c][1]:
			if is_instance_valid(m):
				m.transparency = 1.0 - clampf(seen, 0.0, 1.0)


## The parts are on the car again (the repair, or the car pulled away): all of them seen as they are.
func _fetch_end() -> void:
	for f: Array in _fetching:
		for m: GeometryInstance3D in f[1]:
			if is_instance_valid(m):
				m.transparency = 0.0
	_fetching.clear()


func _release() -> void:
	if _held:
		_held = false
		car.set_deferred("freeze", false)
