class_name DragStrip
extends Node3D
## The drag strip of a track (web/js/DragStrip.js; track.json "dragstrip": { x, z, heading, width, length }: the start
## line, the way the strip goes and how far the finish is). The front wheels are the reference, as the beams of a
## real strip are. Near the line a text shows how far they are from it; with them at the line and the car still, "Get
## ready" shows for two seconds (time for the two-step), then the tree: stage, three ambers half a second apart, and
## green. The timing starts when the car leaves the line (30 cm); the reaction time is that moment minus the green.
## Leaving before the green is a false start (red): back behind the line and come up again. At every distance (60 ft,
## 330 ft, 1/8 mile, 1000 ft, 1/4 mile, ...) the time and speed come as a note at the top right; at the finish a time
## slip. The lines are drawn on the road and the tree stands in the middle of the strip, 12 m past the line. The best
## runs are kept per track (user://drag.cfg; the --ai tests use user://test-drag.cfg).

const MARKS := [["60 ft", 18.288], ["330 ft", 100.584], ["1/8 mile", 201.168], ["1000 ft", 304.8], ["1/4 mile", 402.336],
	["1/2 mile", 804.672], ["1 km", 1000.0], ["1 mile", 1609.344]]
const STAGE_MIN := -0.4
const STAGE_MAX := 0.25
const ROLLOUT := 0.3
const AMBER := 0.5

var car: Car
var track_id := ""
var state := "idle"
var origin := Vector3.ZERO
var dir := Vector3.FORWARD
var width := 12.0
var length := 402.336
var results: Array = []             # { label, metres, time, speed, finish }
var lit := {}                       # the lamps of the tree that are lit: name -> bool
var _clock := 0.0
var _t_ready := 0.0
var _t_tree := 0.0
var _t_green := 0.0
var _staged_s := 0.0
var _t0 := -1.0
var _reaction := 0.0
var _prev_t := 0.0
var _prev_s := 0.0
var _prev_v := 0.0
var _top_speed := 0.0
var _lamps := {}                    # name -> [MeshInstance3D, ...]
var _ui: CanvasLayer
var _status: Label
var _notes: VBoxContainer
var _slip: PanelContainer


## A drag strip for the car when the track has one (else null).
static func make(c: Car, track: Node3D, cfg: Dictionary, id: String) -> DragStrip:
	var ds: Variant = cfg.get("dragstrip")
	if not (ds is Dictionary):
		return null
	var d := DragStrip.new()
	d.setup(c, track, ds, id)
	return d


func setup(c: Car, track: Node3D, ds: Dictionary, id: String) -> void:
	car = c
	track_id = id
	name = "DragStrip"
	var h := float(ds.get("heading", 0.0))
	dir = Vector3(cos(h), 0.0, sin(h))
	width = float(ds.get("width", 12.0))
	length = float(ds.get("length", 402.336))
	var y := 0.0
	if track.has_method("ground_at"):
		y = track.ground_at(float(ds["x"]), float(ds["z"]))
	origin = Vector3(float(ds["x"]), y, float(ds["z"]))
	results.clear()
	for m in MARKS:
		if m[1] < length - 0.5:
			results.append({"label": m[0], "metres": m[1], "time": -1.0, "speed": 0.0, "finish": false})
	var named := ""
	for m in MARKS:
		if absf(m[1] - length) < 0.5:
			named = m[0]
	results.append({"label": named if named != "" else "Finish (%d m)" % roundi(length), "metres": length, "time": -1.0, "speed": 0.0, "finish": true})
	_build_lines(track)
	_build_tree(track)
	_build_ui()


func _ground(track: Node3D, at: Vector3) -> float:
	return track.ground_at(at.x, at.z) if track.has_method("ground_at") else origin.y


# white lines across the strip: the start, every distance; the finish chequered
func _build_lines(track: Node3D) -> void:
	var side := Vector3(-dir.z, 0.0, dir.x)
	var white := StandardMaterial3D.new()
	white.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	white.albedo_color = Color(0.95, 0.95, 0.92)
	var black := white.duplicate() as StandardMaterial3D
	black.albedo_color = Color(0.05, 0.05, 0.05)
	var at_list: Array = [0.0]
	for r in results:
		at_list.append(r["metres"])
	for metres in at_list:
		var finish: bool = absf(metres - length) < 0.01
		var centre: Vector3 = origin + dir * metres
		centre.y = _ground(track, centre) + 0.02
		if finish:
			var squares := int(width / 0.5)
			for k in squares:
				for row in 2:
					var q := MeshInstance3D.new()
					var pm := PlaneMesh.new()
					pm.size = Vector2(0.5, 0.5)
					q.mesh = pm
					q.material_override = white if (k + row) % 2 == 0 else black
					q.position = centre + side * (-width / 2.0 + 0.25 + k * 0.5) + dir * (0.25 + row * 0.5)
					q.basis = Basis.looking_at(dir, Vector3.UP)
					add_child(q)
		else:
			var line := MeshInstance3D.new()
			var bm := BoxMesh.new()
			bm.size = Vector3(width, 0.005, 0.12 if metres == 0.0 else 0.08)
			line.mesh = bm
			line.material_override = white
			line.position = centre
			line.basis = Basis.looking_at(dir, Vector3.UP)
			add_child(line)


# the tree: a pole in the middle of the strip, 12 m past the line, its lamps facing the cars at the line
func _build_tree(track: Node3D) -> void:
	var at := origin + dir * 12.0
	at.y = _ground(track, at)
	var tree := Node3D.new()
	tree.position = at
	tree.basis = Basis.looking_at(dir, Vector3.UP)        # (its -z along the strip: the face, +z, looks back to the line)
	add_child(tree)
	var dark := StandardMaterial3D.new()
	dark.albedo_color = Color(0.08, 0.08, 0.09)
	var pole := MeshInstance3D.new()
	var cyl := CylinderMesh.new()
	cyl.top_radius = 0.06
	cyl.bottom_radius = 0.08
	cyl.height = 2.2
	pole.mesh = cyl
	pole.material_override = dark
	pole.position = Vector3(0, 1.1, 0)
	tree.add_child(pole)
	var head := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(0.7, 1.5, 0.15)
	head.mesh = bm
	head.material_override = dark
	head.position = Vector3(0, 2.6, 0)
	tree.add_child(head)
	var rows := [["pre", Color(1, 1, 1)], ["stage", Color(1, 1, 1)], ["amber1", Color(1, 0.72, 0.11)], ["amber2", Color(1, 0.72, 0.11)],
		["amber3", Color(1, 0.72, 0.11)], ["green", Color(0.18, 0.89, 0.42)], ["red", Color(1, 0.23, 0.19)]]
	for i in rows.size():
		var list: Array = []
		for x in [-0.17, 0.17]:
			var lamp := MeshInstance3D.new()
			var sm := SphereMesh.new()
			sm.radius = 0.075
			sm.height = 0.15
			lamp.mesh = sm
			var mat := StandardMaterial3D.new()
			mat.albedo_color = (rows[i][1] as Color) * 0.25
			mat.emission_enabled = true
			mat.emission = rows[i][1]
			mat.emission_energy_multiplier = 0.0
			lamp.material_override = mat
			lamp.position = Vector3(x, 3.2 - i * 0.19, 0.09)
			tree.add_child(lamp)
			list.append(lamp)
		_lamps[rows[i][0]] = list


func _lamp(lamp_name: String, on: bool) -> void:
	lit[lamp_name] = on                 # (the replay records the lamps from this: ReplayExtras)
	for m: MeshInstance3D in _lamps[lamp_name]:
		var mat := m.material_override as StandardMaterial3D
		mat.emission_energy_multiplier = 4.0 if on else 0.0


func _build_ui() -> void:
	_ui = CanvasLayer.new()
	add_child(_ui)
	_status = Label.new()
	_status.add_theme_font_size_override("font_size", 26)
	_status.add_theme_color_override("font_outline_color", Color.BLACK)
	_status.add_theme_constant_override("outline_size", 6)
	_status.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_status.set_anchors_and_offsets_preset(Control.PRESET_CENTER_TOP)
	_status.position.y = 90
	_ui.add_child(_status)
	_notes = VBoxContainer.new()
	_notes.set_anchors_and_offsets_preset(Control.PRESET_TOP_RIGHT)
	_notes.position = Vector2(-300, 200)
	_notes.custom_minimum_size = Vector2(280, 0)
	_ui.add_child(_notes)


func _note(text: String, colour := Color.WHITE) -> void:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", 20)
	l.add_theme_color_override("font_color", colour)
	l.add_theme_color_override("font_outline_color", Color.BLACK)
	l.add_theme_constant_override("outline_size", 5)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_notes.add_child(l)
	get_tree().create_timer(5.0).timeout.connect(l.queue_free)


func _physics_process(dt: float) -> void:
	if car == null or not is_instance_valid(car):
		return
	_clock += dt
	var a := car.to_global(car.wheels[0].hub)
	var b := car.to_global(car.wheels[1].hub)
	var mid := (a + b) / 2.0
	var s := (mid - origin).dot(dir)
	var side := (mid - origin).dot(Vector3(-dir.z, 0.0, dir.x))
	var fwd := car.global_transform.basis.z
	var aligned := Vector2(fwd.x, fwd.z).normalized().dot(Vector2(dir.x, dir.z)) > 0.8
	var speed := absf(car.speed)
	var fspeed := car.speed
	var in_lane := absf(side) <= width / 2.0 + 1.0
	match state:
		"idle", "approach", "void":
			if not in_lane or s < -45.0 or s > length + 60.0:
				state = "idle"
			elif state == "void":
				if s < -3.0:
					state = "approach"
			elif s > 5.0 and speed > 1.0:
				state = "void"
			else:
				state = "approach"
				if s >= STAGE_MIN and s <= STAGE_MAX and speed < 1.5 and aligned:
					state = "ready"
					_t_ready = _clock
		"ready":
			if s < STAGE_MIN - 0.3 or s > STAGE_MAX + 0.3 or speed > 1.5 or not in_lane:
				state = "approach"
			elif _clock - _t_ready >= float(Settings.get_value("drag_ready")):
				state = "tree"
				_t_tree = _clock
				_staged_s = s
		"tree":
			if s > _staged_s + ROLLOUT:
				state = "false"
			elif s < STAGE_MIN - 0.5 or not in_lane:
				state = "approach"
			elif _clock - _t_tree >= 4.0 * AMBER:
				state = "go"
				_t_green = _t_tree + 4.0 * AMBER
				_t0 = -1.0
				_top_speed = 0.0
				for r in results:
					r["time"] = -1.0
		"go":
			_go(s, side, speed, fspeed, in_lane)
		"false", "finished":
			if s < -3.0 and in_lane:
				state = "approach"
	_prev_t = _clock
	_prev_s = s
	_prev_v = fspeed
	_show(s)


func _go(s: float, side: float, speed: float, fspeed: float, in_lane: bool) -> void:
	if _t0 < 0.0:
		if s < STAGE_MIN - 0.5 or not in_lane:
			state = "approach"
			return
		if _clock - _t_green > 5.0 and s < _staged_s + ROLLOUT:
			state = "void"
			return
		if s >= _staged_s + ROLLOUT:
			var f := clampf((_staged_s + ROLLOUT - _prev_s) / maxf(1e-6, s - _prev_s), 0.0, 1.0)
			_t0 = _prev_t + (_clock - _prev_t) * f
			_reaction = _t0 - _t_green
	if _t0 < 0.0:
		return
	_top_speed = maxf(_top_speed, speed)
	for r in results:
		var at: float = r["metres"] + _staged_s
		if r["time"] < 0.0 and s >= at:
			var k := clampf((at - _prev_s) / maxf(1e-6, s - _prev_s), 0.0, 1.0)
			r["time"] = _prev_t + (_clock - _prev_t) * k - _t0
			r["speed"] = _prev_v + (fspeed - _prev_v) * k
			_note("%s  %.3f s  %.1f km/h" % [r["label"], r["time"], r["speed"] * 3.6])
	if s >= length + _staged_s:
		state = "finished"
		_finish()
	elif s < _staged_s - 1.0 or (not in_lane and absf(side) > width):
		state = "void"


func _show(s: float) -> void:
	var text := ""
	match state:
		"approach":
			text = "%.2f m to the line\n%s" % [-s, "Stand still at the line" if s > STAGE_MIN and s <= STAGE_MAX else "Front wheels to the line, slowly"]
		"void":
			text = "%.2f m to the line\nDrive back behind the line, then come up slowly" % -s
		"ready":
			text = "Get ready…\nHold the car still at the line"
		"false":
			text = "FALSE START\nDrive back behind the line and come up slowly"
	_status.text = text
	_status.add_theme_color_override("font_color", Color(1, 0.4, 0.35) if state == "false" or state == "void" else Color.WHITE)
	var tree_on := state == "tree" or state == "false" or (state == "go" and _clock - _t_green < float(Settings.get_value("drag_green")))
	var ambers := mini(3, int((_clock - _t_tree) / AMBER)) if state == "tree" else (3 if state == "go" else 0)
	_lamp("pre", tree_on or state == "ready" or (state == "approach" and s > -1.0 and s <= STAGE_MAX))
	_lamp("stage", tree_on or state == "ready")
	for i in 3:
		_lamp("amber%d" % (i + 1), tree_on and ambers > i)
	_lamp("green", tree_on and state == "go")
	_lamp("red", state == "false")


func _finish() -> void:
	var run := {"car": car.car_id, "rt": _reaction, "top": _top_speed, "splits": []}
	var et := 0.0
	var trap := 0.0
	for r in results:
		run["splits"].append([r["label"], r["time"], r["speed"]])
		if r["finish"]:
			et = r["time"]
			trap = r["speed"]
	run["et"] = et
	run["trap"] = trap
	var best := _save(run)
	RunLog.event("drag run: %s  R/T %.3f  ET %.3f s  %.1f km/h%s" % [car.car_id, _reaction, et, trap * 3.6, "  (best of the track)" if best else ""])
	_time_slip(run, best)


# the best runs of the track, the 50 quickest
func _save(run: Dictionary) -> bool:
	var path := "user://test-drag.cfg" if Content.arg("ai") != "" else "user://drag.cfg"
	var cfg := ConfigFile.new()
	cfg.load(path)
	var runs: Array = cfg.get_value("runs", track_id, [])
	var best := runs.is_empty() or float(run["et"]) < float(runs[0]["et"])
	runs.append(run)
	runs.sort_custom(func(x, y): return float(x["et"]) < float(y["et"]))
	cfg.set_value("runs", track_id, runs.slice(0, 50))
	cfg.save(path)
	return best


func _time_slip(run: Dictionary, best: bool) -> void:
	if _slip != null:
		_slip.queue_free()
	_slip = PanelContainer.new()
	_slip.set_anchors_and_offsets_preset(Control.PRESET_TOP_RIGHT)
	_slip.position = Vector2(-330, 20)
	_slip.custom_minimum_size = Vector2(310, 0)
	var box := VBoxContainer.new()
	_slip.add_child(box)
	var lines := ["TIME SLIP%s" % ("  ·  BEST" if best else ""), str(run["car"]), "R/T  %.3f s" % run["rt"]]
	for sp in run["splits"]:
		lines.append("%s  %.3f s  %.1f km/h" % [sp[0], sp[1], float(sp[2]) * 3.6])
	lines.append("Top speed  %.1f km/h" % (float(run["top"]) * 3.6))
	for t in lines:
		var l := Label.new()
		l.text = t
		l.add_theme_font_size_override("font_size", 18)
		box.add_child(l)
	var close := Button.new()
	close.text = "Close"
	close.pressed.connect(_slip.queue_free)
	box.add_child(close)
	_ui.add_child(_slip)
	get_tree().create_timer(20.0).timeout.connect(_close_slip.bind(_slip))


func _close_slip(slip: PanelContainer) -> void:
	if is_instance_valid(slip):
		slip.queue_free()
