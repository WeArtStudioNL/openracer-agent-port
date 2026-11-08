class_name CarEditorTyreNodes
extends RefCounted
## The nodes of the tyres (the shell tyre, ShellTyres) over the car of the bench while a tyre setting is being changed
## (car-editor.js showTyreDebug): the outer shell (green where a node holds the road, red where it slides, teal in the
## air), the rim (white), the cables between them coloured by their strain (dark at rest, towards cyan stretched,
## towards red pushed in) and the belt (teal), as the debug view of the game draws them. They appear when a tyre
## setting (the Tyres group of the tuning, the pressures too) gets the focus or is moved, and go when another input gets
## the focus. Without a test running the tyres of the wheel library are drawn from their settings (the bench is not
## started for that, so that changing a setting does not drop the car); a car without them starts the bench.

const KEYS := ["tyre_diameter_front", "tyre_diameter_rear", "tyre_height_front", "tyre_height_rear", "tyre_width", "tyre_width_rear", "tyre_rings",
	"tyre_segments", "tyre_inner_ratio", "tyre_carcass", "tyre_stiff_x", "tyre_stiff_y", "pressure_front", "pressure_rear"]
const TEAL := Color(0.3, 0.8, 0.8)
const DIM := Color(0.35, 0.4, 0.45)

var ed: CarEditor
var on := false
var _lines: MeshInstance3D = null
var _static_for := ""


func _init(editor: CarEditor) -> void:
	ed = editor
	if editor.is_inside_tree():
		editor.get_viewport().gui_focus_changed.connect(_focus)


## A tyre setting got the focus: the nodes; any other input: none.
func _focus(c: Control) -> void:
	var n: Node = c
	while n != null and n != ed:
		if n.has_meta("tyre_key"):
			show(true)
			return
		n = n.get_parent()
	show(false)


func show(want: bool) -> void:
	if want == on:
		if on and ed.bench.car == null:
			_static_for = ""            # (a setting changed: the tyres of the library are drawn again)
		return
	on = want
	_static_for = ""
	if not on:
		_clear()
		return
	if ed.bench.car == null and not _has_library():
		ed.status("The tyres of the wheels of a model get their nodes when the car runs: press Drop car.", "ok")


func _has_library() -> bool:
	var lib: Variant = Tuning.read(ed.cfg, "wheels.library")
	return lib is Dictionary and not (lib as Dictionary).is_empty()


func _clear() -> void:
	if _lines != null:
		_lines.queue_free()
		_lines = null


func _draw(points: Array, colours: Array, parent: Node, xf := Transform3D.IDENTITY) -> void:
	_clear()
	if points.is_empty() or parent == null:
		return
	_lines = CarEditorView.lines(points, colours, true)
	_lines.transform = xf
	parent.add_child(_lines)


## Once a frame (the bench): the nodes of the shells as the bench's car has them, or the tyres of the library from
## their settings.
func frame() -> void:
	if not on:
		return
	var car := ed.bench.car
	if car != null:
		_static_for = ""
		var pts := []
		var cols := []
		if car.shell_tyres != null:
			for i in 4:
				if car.shell_tyres.touched[i] or not car.shell_tyres.results[i].is_empty():
					ShellTyres.shell_lines(car.shell_tyres.tyres[i].call("shells"), pts, cols)
		_draw(pts, cols, ed.view.viewport)
		return
	var key := str(Tuning.read(ed.cfg, "wheels.library")) + str(Tuning.read(ed.cfg, "chassis.tire_diameter"))
	if key == _static_for:
		return
	_static_for = key
	var pts := []
	var cols := []
	var lib: Variant = Tuning.read(ed.cfg, "wheels.library")
	for s in CarEditor.SLOTS:
		if not lib is Dictionary or (ed.is_bike() and (s == "FR" or s == "RR")):
			continue
		var custom: Variant = (lib as Dictionary).get("front" if s[0] == "F" else "rear", {}).get("custom")
		if not custom is Dictionary:
			continue
		var centre := ed.form_hub(s)
		if ed.wheel_mode() == "model":
			var bx: Variant = ed.wheel_box(s)
			if bx == null:
				continue
			centre = (bx as AABB).get_center()
		_static_wheel(custom, centre, pts, cols)
	_draw(pts, cols, ed.view.lib_preview.get_parent(), ed.view.lib_preview.transform)


## The nodes of a tyre from its settings (refreshStaticTyres of car-editor.js).
func _static_wheel(c: Dictionary, centre: Vector3, pts: Array, cols: Array) -> void:
	var r := float(c.get("diameter", ed.num("chassis.tire_diameter", 0.65))) / 2.0
	var ri := r * float(c.get("inner_ratio", 0.7))
	var rings := maxi(1, int(c.get("rings", 3)))
	var segs := maxi(4, int(c.get("segments", 36)))
	var half := float(c.get("width", 0.245)) * 0.45
	var outer := []
	var inner := []
	for j in rings:
		var lat := (float(j) / (rings - 1) - 0.5) * 2.0 * half if rings > 1 else 0.0
		for k in segs:
			var a := TAU * k / segs
			outer.append(centre + Vector3(lat, r * cos(a), r * sin(a)))
			inner.append(centre + Vector3(lat * 0.8, ri * cos(a), ri * sin(a)))
	for j in rings:
		for k in segs:
			var i := j * segs + k
			var nxt := j * segs + (k + 1) % segs
			pts.append_array([outer[i], outer[nxt], inner[i], inner[nxt]])
			cols.append_array([TEAL, TEAL, DIM, DIM])
			if j + 1 < rings:
				pts.append_array([outer[i], outer[i + segs]])
				cols.append_array([TEAL, TEAL])
			if k % 2 == 0:
				pts.append_array([outer[i], inner[i]])
				cols.append_array([DIM, DIM])
			# (a node: a small cross)
			pts.append_array([outer[i] + Vector3(0, 0.006, 0), outer[i] - Vector3(0, 0.006, 0)])
			cols.append_array([TEAL, TEAL])
