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

var car: Car
var boxes: Array = []
var box_index := -1                 # the box of this car (the player 0, the AI from 1); -1: any box
var hold_car := false               # the player's car: on the jacks until the stop is done
var active := false
var done := false
var elapsed := 0.0
var plan := {}                      # { fuel, tyres, change, repair, work, total } in seconds
var _fuel_given := 0.0
var _fuel_wanted := 0.0
var _changed: Array = []
var _repaired := false
var _repairing := false
var _held := false


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


## Whether all four wheels are in a box (a little room round it), at least two of them on the ground.
func in_box() -> bool:
	if boxes.is_empty():
		return false
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
	if car == null or not is_instance_valid(car):
		return
	if float(Settings.get_value("tyre_wear")) <= 0.0:
		_end()
		return
	var still := (active and hold_car) or (absf(car.speed) < 0.4 and in_box())
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
	elapsed += dt
	var t := elapsed - LIFT
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
	if elapsed >= plan["total"]:
		done = true
		active = false
		RunLog.event("pit stop done: %s" % car.name)
		_release()


func _fresh_tyre(w: Car.Wheel) -> void:
	w.wear = 0.0
	w.temp = 60.0
	w.leak = 0.0
	w.pressure_loss = 0.0
	TyreDamage.apply(car, w)


func _end() -> void:
	active = false
	done = false
	plan = {}
	_release()


func _release() -> void:
	if _held:
		_held = false
		car.set_deferred("freeze", false)
