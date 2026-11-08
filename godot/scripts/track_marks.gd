class_name TrackMarks
extends Node3D
## What the track editor puts on the road, drawn in the game:
##   - the grid boxes (web/js/TrackMarks.js; track.json "grid", up to eight { x, z, heading }): a white line across the front of
##     the box and a short leg back from each end of it, no numbers;
##   - the older pit area ("pit": { "polygon" }): a see-through surface with a line round it;
##   - the checkpoints (web/js/GateMarkers.js), when the track asks for them ("show_gates"): at every gate two posts, a bar over the
##     road and a strip on it. The finish line is white, the gate that is next green, the ones passed this lap dim and the others
##     orange; an arrow at the top of the screen points to the next gate with its distance, and a beep says a gate was the right
##     one (a low buzz: a gate out of turn).
## The pit boxes are PitStop.markings.

const BOX_W := 2.4
const BOX_L := 5.0
const LIFT := 0.04
const POST := 3.2
const GATE_COLOURS := {"finish": Color(1, 1, 1), "next": Color("35e06f"), "done": Color("4a6a58"), "other": Color("ff9a1f")}

var gates: Array = []
var next_gate := 0
var _passed: Array[bool] = []
var _holders: Array[Node3D] = []
var _mats := {}
var _car: Node3D = null
var _last := Vector3.INF
var _arrow: Control = null
var _label: Label = null
var _beep_good: AudioStreamPlayer = null
var _beep_bad: AudioStreamPlayer = null
var _track: Node3D


## Makes the marks of cfg (once the track is in the scene: the heights come from the ground of the track).
func setup(track: Node3D, cfg: Dictionary) -> void:
	name = "TrackMarks"
	_track = track
	var grid: Array = cfg.get("grid", []) if cfg.get("grid") is Array else []
	for b in grid:
		if b is Dictionary and b.has("x") and b.has("z"):
			_grid_box(float(b["x"]), float(b["z"]), float(b.get("heading", 0)))
	var pit: Variant = cfg.get("pit")
	if pit is Dictionary and pit.get("polygon") is Array and (pit["polygon"] as Array).size() >= 3:
		_pit_area(pit["polygon"])
	if cfg.get("show_gates", false) and cfg.get("gates") is Array and not (cfg["gates"] as Array).is_empty():
		gates = cfg["gates"]
		_build_gates()


func _y(x: float, z: float) -> float:
	return _track.ground_at(x, z) if _track != null and _track.has_method("ground_at") else 0.0


static func _flat_material(c: Color, alpha: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_color = Color(c, alpha)
	if alpha < 1.0:
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.disable_fog = true
	m.render_priority = 1
	return m


## A flat strip along a line of points (x, z), on the road.
func _strip(points: Array, width: float, mat: Material) -> void:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for i in points.size() - 1:
		var a: Vector2 = points[i]
		var b: Vector2 = points[i + 1]
		var d := (b - a).normalized()
		var n := Vector2(-d.y, d.x) * width / 2.0
		var ya := _y(a.x, a.y) + LIFT
		var yb := _y(b.x, b.y) + LIFT
		for v in [Vector3(a.x - n.x, ya, a.y - n.y), Vector3(b.x - n.x, yb, b.y - n.y), Vector3(b.x + n.x, yb, b.y + n.y),
				Vector3(a.x - n.x, ya, a.y - n.y), Vector3(b.x + n.x, yb, b.y + n.y), Vector3(a.x + n.x, ya, a.y + n.y)]:
			st.add_vertex(v)
	var mi := MeshInstance3D.new()
	mi.mesh = st.commit()
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)


func _grid_box(x: float, z: float, h: float) -> void:
	var c := cos(h)
	var s := sin(h)
	var ax := c * BOX_L / 2.0
	var az := s * BOX_L / 2.0
	var bx := -s * BOX_W / 2.0
	var bz := c * BOX_W / 2.0
	var w := 0.18
	var ex := w / 2.0
	var leg := 0.8
	var fl := Vector2(x + ax + bx, z + az + bz)
	var fr := Vector2(x + ax - bx, z + az - bz)
	var mat := _flat_material(Color(1, 1, 1), 0.9)
	_strip([Vector2(fl.x - c * leg, fl.y - s * leg), Vector2(fl.x + c * ex, fl.y + s * ex)], w, mat)
	_strip([Vector2(fr.x - c * leg, fr.y - s * leg), Vector2(fr.x + c * ex, fr.y + s * ex)], w, mat)
	_strip([Vector2(fl.x - s * ex, fl.y + c * ex), Vector2(fr.x + s * ex, fr.y - c * ex)], w, mat)


func _pit_area(poly: Array) -> void:
	var pts := PackedVector2Array()
	for p in poly:
		if p is Array and p.size() >= 2:
			pts.append(Vector2(float(p[0]), float(p[1])))
	var tris := Geometry2D.triangulate_polygon(pts)
	if tris.is_empty():
		return
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for i in tris:
		st.add_vertex(Vector3(pts[i].x, _y(pts[i].x, pts[i].y) + LIFT, pts[i].y))
	var fill := MeshInstance3D.new()
	fill.mesh = st.commit()
	fill.material_override = _flat_material(Color("5a7fa8"), 0.28)
	add_child(fill)
	var ring: Array = []
	for p in pts:
		ring.append(p)
	ring.append(pts[0])
	_strip(ring, 0.25, _flat_material(Color(1, 1, 1), 0.8))


func _build_gates() -> void:
	for k in GATE_COLOURS:
		_mats[k] = _flat_material(GATE_COLOURS[k], 0.85)
		_mats[k + "_strip"] = _flat_material(GATE_COLOURS[k], 0.35)
	for gate in gates:
		var width := float(gate.get("width", 24))
		var y := float(gate["y"]) if gate.has("y") else _y(float(gate["x"]), float(gate["z"]))
		var holder := Node3D.new()
		holder.position = Vector3(float(gate["x"]), y, float(gate["z"]))
		holder.rotation.y = -float(gate.get("heading", 0))
		for side in [-1, 1]:
			var post := MeshInstance3D.new()
			var cm := CylinderMesh.new()
			cm.top_radius = 0.18
			cm.bottom_radius = 0.18
			cm.height = POST
			cm.radial_segments = 8
			post.mesh = cm
			post.position = Vector3(0, POST / 2.0, side * width / 2.0)
			holder.add_child(post)
		var bar := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(0.12, 0.35, width)
		bar.mesh = bm
		bar.position = Vector3(0, POST, 0)
		holder.add_child(bar)
		var strip := MeshInstance3D.new()
		var pm := PlaneMesh.new()
		pm.size = Vector2(1.2, width)
		strip.mesh = pm
		strip.position = Vector3(0, 0.12, 0)
		holder.add_child(strip)
		for m in holder.get_children():
			(m as MeshInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(holder)
		_holders.append(holder)
	_passed.resize(gates.size())
	_passed.fill(false)
	next_gate = 0
	_colour()


func _colour() -> void:
	for i in _holders.size():
		var key := "next" if i == next_gate else ("finish" if i == 0 else ("done" if _passed[i] else "other"))
		var parts := _holders[i].get_children()
		for k in parts.size():
			(parts[k] as MeshInstance3D).material_override = _mats[key + "_strip"] if k == 3 else _mats[key]


## The car whose lap the markers follow (the player's).
func follow(car: Node3D) -> void:
	_car = car
	if gates.is_empty() or _arrow != null:
		return
	var layer := CanvasLayer.new()
	layer.layer = 4
	add_child(layer)
	var pill := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.094, 0.114, 0.137, 0.8)
	sb.set_corner_radius_all(22)
	sb.content_margin_left = 10
	sb.content_margin_right = 16
	sb.content_margin_top = 4
	sb.content_margin_bottom = 4
	pill.add_theme_stylebox_override("panel", sb)
	pill.set_anchors_preset(Control.PRESET_CENTER_TOP)
	pill.position.y = 12
	pill.grow_horizontal = Control.GROW_DIRECTION_BOTH
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	_arrow = Control.new()
	_arrow.custom_minimum_size = Vector2(30, 30)
	_arrow.pivot_offset = Vector2(15, 15)
	_arrow.draw.connect(func():
		var pts := PackedVector2Array([Vector2(15, 2.5), Vector2(25, 25), Vector2(15, 20), Vector2(5, 25)])
		_arrow.draw_colored_polygon(pts, Color("ff5a1f"))
		pts.append(pts[0])
		_arrow.draw_polyline(pts, Color.WHITE, 1.5, true))
	row.add_child(_arrow)
	_label = Label.new()
	_label.add_theme_font_size_override("font_size", 18)
	row.add_child(_label)
	pill.add_child(row)
	layer.add_child(pill)
	_beep_good = _tone_player([[880.0, 0.0, 0.12], [1320.0, 0.1, 0.2]], false)
	_beep_bad = _tone_player([[160.0, 0.0, 0.35]], true)


func _tone_player(tones: Array, buzz: bool) -> AudioStreamPlayer:
	var rate := 22050
	var total := 0.0
	for t in tones:
		total = maxf(total, t[1] + t[2])
	var n := int(total * rate)
	var data := PackedByteArray()
	data.resize(n * 2)
	for i in n:
		var time := float(i) / rate
		var v := 0.0
		for t in tones:
			var local: float = time - t[1]
			if local < 0.0 or local > t[2]:
				continue
			var env := minf(1.0, local / 0.01) * exp(-4.0 * local / t[2])
			var f: float = t[0] * (1.0 - 0.3 * local / t[2] if buzz else 1.0)
			var ph := fmod(local * f, 1.0)
			v += env * ((ph * 2.0 - 1.0) * 0.8 if buzz else sin(ph * TAU))
		data.encode_s16(i * 2, int(clampf(v * 0.25, -1.0, 1.0) * 32767))
	var wav := AudioStreamWAV.new()
	wav.format = AudioStreamWAV.FORMAT_16_BITS
	wav.mix_rate = rate
	wav.data = data
	var p := AudioStreamPlayer.new()
	p.stream = wav
	add_child(p)
	return p


func _physics_process(_dt: float) -> void:
	if _car == null or gates.is_empty() or not is_instance_valid(_car):
		return
	var p := _car.global_position
	if _last != Vector3.INF:
		var g := _crossed(_last, p)
		if g >= 0:
			_gate(g)
	_last = p
	var gate: Dictionary = gates[next_gate]
	var cam := get_viewport().get_camera_3d()
	if _arrow != null and cam != null:
		var f := -cam.global_transform.basis.z
		var fl := Vector2(f.x, f.z).normalized()
		var d := Vector2(float(gate["x"]) - p.x, float(gate["z"]) - p.z)
		_arrow.rotation = atan2(d.x * -fl.y + d.y * fl.x, d.x * fl.x + d.y * fl.y)
		_label.text = "%d m" % roundi(d.length())


func _crossed(a: Vector3, b: Vector3) -> int:
	for g in gates.size():
		var gate: Dictionary = gates[g]
		var h := float(gate.get("heading", 0))
		var dx := cos(h)
		var dz := sin(h)
		var a0 := (a.x - float(gate["x"])) * dx + (a.z - float(gate["z"])) * dz
		var a1 := (b.x - float(gate["x"])) * dx + (b.z - float(gate["z"])) * dz
		if a0 < 0.0 and a1 >= 0.0:
			var t := a0 / (a0 - a1)
			var px := a.x + (b.x - a.x) * t - float(gate["x"])
			var pz := a.z + (b.z - a.z) * t - float(gate["z"])
			if absf(-px * dz + pz * dx) <= float(gate.get("width", 30)) / 2.0:
				return g
	return -1


## The car went through gate g: the right one turns the markers on, another one only buzzes.
func _gate(g: int) -> void:
	var n := gates.size()
	if g == next_gate:
		if _beep_good != null:
			_beep_good.play()
		if g == 0:
			_passed.fill(false)
			next_gate = 1 if n > 1 else 0
		else:
			_passed[g] = true
			next_gate = g + 1 if g + 1 < n else 0
		_colour()
	elif not _passed[g] and _beep_bad != null:
		_beep_bad.play()


## Back at the start: the finish line is next again.
func restart() -> void:
	_passed.fill(false)
	next_gate = 0
	_last = Vector3.INF
	if not _holders.is_empty():
		_colour()
