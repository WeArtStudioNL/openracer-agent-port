# gdlint: disable=max-public-methods
extends RefCounted
## The Soft body card of the car editor (web/tools/softbody-editor.js): what the shell of a car (SoftBody, CarShell) is
## made of, what single nodes and beams can take, which parts of the model swing on a hinge, come loose or break (the
## Parts window, car_editor_softbody_parts.gd), and the crash test and Apply force of the test bar
## (car_editor_softbody_crash.gd). Everything is saved in car.json: "softbody" and "parts" (see SOFTBODY.md); the card
## keeps them in the car of the form (CarEditor.cfg), so the undo of the editor takes them too.
##
## Show the shell starts the test bench (the car of the game, CarEditorBench) and draws its nodes and beams over it: a
## node green when whole, yellow at its yield bend, red above it, grey when its anchor is torn, blue inside, orange of a
## part. A click selects a node (Shift adds) or a beam, the middle mouse button and a drag draw a lasso; the selected
## nodes get the gizmo of the view (the first move makes the nodes a list of the car, softbody.layout). Edit nodes: a
## click on the model puts a node on its surface, Delete removes the selected ones. Scan with rays and Fill the inside
## make the nodes from the model (car_editor_softbody_nodes.gd). The editor loads this file (CarEditor.CARD_HOOKS) and
## calls setup, fill, read, frame, on_model, picked, open_part, click, key, crash_tab and bench_stopped.

const NodesTool := preload("res://scripts/editor/car_editor_softbody_nodes.gd")
const PartsPanel := preload("res://scripts/editor/car_editor_softbody_parts.gd")
const CrashTest := preload("res://scripts/editor/car_editor_softbody_crash.gd")
# the numbers of the Strengths window: [path in softbody, hint, step, scale (what is shown is the value times it), the default]
const STRENGTHS := [
	["Anchor: node to the car", [["anchor.stiffness", "stiffness (kN/mm)", 0.1, 1e-6, "0.8"], ["anchor.yield_force", "yield (kN)", 5.0, 1e-3, "80"],
		["anchor.break_force", "break (kN)", 10.0, 1e-3, "250"], ["anchor.damping", "damping", 0.05, 1.0, "0.6"]]],
	["Beams: node to node", [["beam.stiffness", "stiffness (kN/mm)", 0.1, 1e-6, "0.4"], ["beam.yield_force", "yield (kN)", 5.0, 1e-3, "40"],
		["beam.break_force", "break (kN)", 10.0, 1e-3, "120"], ["beam.damping", "damping", 0.05, 1.0, "0.15"]]],
	["Contact with the road and walls", [["contact.stiffness", "stiffness (kN/mm)", 0.1, 1e-6, "1.5"], ["contact.damping", "damping", 0.05, 1.0, "0.7"],
		["contact.friction", "friction", 0.05, 1.0, "0.5"]]],
	["Shape of the skeleton", [["neighbours", "beams per node", 1.0, 1.0, "5"], ["reach", "longest beam (m)", 0.1, 1.0, "1.1"]]],
]
const DEFAULTS := {"anchor.stiffness": 8.0e5, "anchor.yield_force": 80000.0, "anchor.break_force": 250000.0,
	"beam.stiffness": 4.0e5, "beam.yield_force": 40000.0, "beam.break_force": 120000.0}
# the kinds of material, as factors of the defaults: stiffness, yield force, break force
const PRESETS := [["Steel (the default)", 1.0, 1.0, 1.0], ["Aluminium", 0.7, 0.6, 0.6], ["Plastic", 0.4, 0.3, 0.5],
	["Foam and rubber", 0.2, 0.15, 0.3], ["Race cage (stiff)", 2.0, 2.5, 3.0]]
const MOST_NODES := 2000
const SCAN_MOST := 120
const NODE_PIXELS := 14.0
const BEAM_PIXELS := 8.0
const ORANGE := Color("#ff9f43")
# the force sliders: 0.5 kN to 5000 kN on a scale of tenfolds; a force as the hit of a block of a tonne in 30 ms that makes it
const KN_MIN := 0.5
const KN_DECADES := 4.0
const HIT_KG := 1000.0
const HIT_S := 0.03

var ed: CarEditor
var car: Car = null                  # the car of the bench whose shell is shown
var shown := false
var editing := false                 # Edit nodes: a click on the model puts a node there
var sel_nodes := []
var sel_beam := -1
var pick := Callable()               # a Set button of the Parts window waits for a click on the model: pick.call(local, node)
var parts: PartsPanel
var crash: CrashTest
var shell_node: Node3D               # in the frame of the car of the bench (it follows the car)
var pivot: Node3D                    # what the gizmo moves: the middle of the selected nodes
var ui := {}

var _points: ImmediateMesh
var _lines: ImmediateMesh
var _hinges: ImmediateMesh
var _dragging := false
var _last_pivot := Vector3.ZERO
var _rebuild_in := -1.0              # seconds to the shell being made again (a moment after the last change)
var _lasso := PackedVector2Array()
var _lasso_add := false
var _lasso_line: Line2D
var _lasso_fill: Polygon2D
var _tri_cache := {}                 # MeshInstance3D id -> TriangleMesh (the surface under the mouse)
var _strengths := {}
var _force_boxes: Array[Callable] = []
var _locked := false                 # a tune is chosen: the shell and the parts are the car's, shown but not changed here


func setup(editor: CarEditor, card_body: VBoxContainer) -> void:
	ed = editor
	shell_node = Node3D.new()
	shell_node.name = "SoftBodyShell"
	shell_node.visible = false
	ed.view.viewport.add_child(shell_node)
	_lines = _immediate(false, 0)
	_points = _immediate(true, 0)
	_hinges = _immediate(false, 1)
	pivot = Node3D.new()
	pivot.name = "ShellPivot"
	shell_node.add_child(pivot)
	_lasso_fill = Polygon2D.new()
	_lasso_fill.color = Color(1, 1, 1, 0.12)
	ed.view.overlay.add_child(_lasso_fill)
	_lasso_line = Line2D.new()
	_lasso_line.width = 1.5
	_lasso_line.default_color = Color.WHITE
	_lasso_line.closed = true
	ed.view.overlay.add_child(_lasso_line)
	parts = PartsPanel.new(self)
	crash = CrashTest.new(self)
	_build(card_body)
	ed.view.input_hook = _input
	ed.view.gizmo.drag_started.connect(_drag_started)
	ed.view.gizmo.moved.connect(_drag_moved)
	ed.view.gizmo.drag_ended.connect(_drag_ended)
	show_selection()


func _immediate(points: bool, priority: int) -> ImmediateMesh:
	var mi := MeshInstance3D.new()
	var im := ImmediateMesh.new()
	mi.mesh = im
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.vertex_color_use_as_albedo = true
	m.no_depth_test = true
	m.render_priority = 6 + priority
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	if points:
		m.use_point_size = true
		m.point_size = 8.0
		m.render_priority = 8
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.layers = CarEditorView.MARKER_LAYER
	mi.extra_cull_margin = 16384.0
	shell_node.add_child(mi)
	return im


# ---- the card

func _build(b: VBoxContainer) -> void:
	b.add_child(EditorStyle.tipline("Dents, breaks, loose parts", "The shell of the car: nodes and beams made from the model that dent, with a yield " +
		"force and a break force, and parts that swing on a hinge or come loose. Show the shell, click a node or a beam in the view and set what it can take."))
	ui["body"] = b
	ui["tune"] = VBoxContainer.new()
	ui["tune"].visible = false
	ui["tune"].add_child(EditorStyle.hint("The shell, its dents, the strength of the wheels and the loose parts belong to the car, not to a tune: every " +
		"tune uses those of the car. Choose Default (the car as made) to change them, and save the car.", EditorStyle.WARN))
	ui["to_default"] = EditorStyle.button("Go to Default", "small", "The car as made (car.json), where the shell and the parts are set")
	ui["to_default"].size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	ui["to_default"].pressed.connect(func():
		ed.tuning._setup_pick.select(0)
		ed.tuning._setup_pick.item_selected.emit(0))
	ui["tune"].add_child(ui["to_default"])
	b.add_child(ui["tune"])
	var dents := func():
		if Tuning.read(ed.cfg, "softbody.enabled") == true:
			Tuning.erase(ed.cfg, "softbody.enabled")
		changed()
	ed.bind_check(b, "softbody.enabled", "The car dents", dents, true)
	var r := EditorStyle.row(b)
	ui["show"] = EditorStyle.button("Show the shell", "small accent", "Starts the test bench and draws the nodes and beams of the shell over the car")
	ui["show"].pressed.connect(_toggle_shell)
	r.add_child(ui["show"])
	var st := EditorStyle.button("Strengths…", "small", "The material of the shell and the strength of anchors, beams and contacts")
	st.pressed.connect(open_strengths)
	ui["open_strengths"] = st
	r.add_child(st)
	var pa := EditorStyle.button("Parts…", "small", "The parts panel stays open next to the view, so you can select nodes while it is open")
	pa.pressed.connect(func(): parts.toggle())
	ui["open_parts"] = pa
	r.add_child(pa)
	b.add_child(EditorStyle.group("Selection"))
	ui["selection"] = EditorStyle.hint("")
	b.add_child(ui["selection"])
	var sf := EditorStyle.row(b)
	ui["sel_fields"] = sf
	ui["sel_yield"] = EditorStyle.NumberField.new("yield (kN)", 1.0)
	sf.add_child(ui["sel_yield"])
	ui["sel_break"] = EditorStyle.NumberField.new("break (kN)", 1.0)
	sf.add_child(ui["sel_break"])
	var set_b := EditorStyle.button("Set", "small")
	set_b.pressed.connect(set_selected)
	sf.add_child(set_b)
	var def_b := EditorStyle.button("Default", "small ghost", "Back to the strength of the material (after the shell is made again)")
	def_b.pressed.connect(clear_selected)
	sf.add_child(def_b)
	var mr := EditorStyle.row(b)
	var most := func():
		if not (Tuning.read(ed.cfg, "softbody.layout") is Array):
			changed()
	ed.bind_number(mr, "softbody.max_nodes", "most nodes to make", 5.0, NAN, NAN, 1.0, "auto", most, true)
	var scan_b := EditorStyle.button("Scan with rays", "small accent", "Casts rays at the model from all round the car and puts the nodes on what they hit")
	scan_b.pressed.connect(scan)
	mr.add_child(scan_b)
	var in_b := EditorStyle.button("Fill the inside", "small", "Adds nodes inside the shell")
	in_b.pressed.connect(fill_inside)
	mr.add_child(in_b)
	ui["scan_inside"] = CheckBox.new()
	ui["scan_inside"].text = "The scan also fills the inside"
	ui["scan_inside"].button_pressed = true
	ui["scan_inside"].focus_mode = Control.FOCUS_NONE
	b.add_child(ui["scan_inside"])
	ed.bind_number(b, "softbody.wheel_strength", "wheel strength (kN·s of a hit that tears it off, 0: never)", 1.0, NAN, NAN, 1.0, "25",
		func(): changed(), true)
	var er := EditorStyle.row(b)
	ui["edit"] = EditorStyle.button("Edit nodes", "small", "Click the model to put a node on it, select nodes and remove them")
	ui["edit"].pressed.connect(func(): set_editing(not editing))
	er.add_child(ui["edit"])
	ui["delete"] = EditorStyle.button("Delete selected", "small danger", "Removes the selected nodes (Delete key)")
	ui["delete"].pressed.connect(delete_selected)
	er.add_child(ui["delete"])
	var eb := VBoxContainer.new()
	eb.visible = false
	ui["edit_box"] = eb
	b.add_child(eb)
	var rr := EditorStyle.row(eb)
	ui["radius"] = EditorStyle.NumberField.new("radius of a new node (m)", 0.05, 0.05, 0.6)
	ui["radius"].set_value(0.2)
	rr.add_child(ui["radius"])
	var again := EditorStyle.button("Make the nodes from the model again", "small ghost")
	again.pressed.connect(reset_nodes)
	again.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	rr.add_child(again)
	eb.add_child(EditorStyle.tipline("Click: add a node · Middle drag: lasso", "A click on the model puts a node on its surface; it is held by beams to its " +
		"nearest neighbours. A click on a node selects it (Shift adds), the middle mouse button and a drag draws a lasso round many. The nodes are also " +
		"what the car hits the road and the walls with. Ctrl/Cmd+Z undoes."))
	b.add_child(EditorStyle.group("Crash test"))
	ui["result"] = EditorStyle.hint("The tab Crash test of the test bar (Tests in the view) drives the car into a wall, or fires a cube at it.")
	b.add_child(ui["result"])


## The Strengths window (dlgSoftBody): a preset and every number of softbody; an empty field is the default.
func open_strengths() -> void:
	if _strengths.is_empty():
		_strengths = EditorStyle.dialog(ed, "Soft body: material and strengths", Vector2(620, 600))
		var b: VBoxContainer = _strengths["body"]
		b.add_child(EditorStyle.tipline("Empty field: the default", "What the shell is made of. An empty field is the default (shown grey). A hit pushes a " +
			"node: it springs back up to the yield force, bends for good above it (the energy is gone) and tears off at the break force. A node is held " +
			"to the car by its anchor, and to its neighbours by beams. Single nodes and beams are set in the view."))
		var r := EditorStyle.row(b)
		var items := []
		for p in PRESETS:
			items.append([p[0], p[0]])
		var preset := EditorStyle.options(items)
		preset.item_selected.connect(func(i: int): _preset(PRESETS[i]))
		r.add_child(EditorStyle.labelled(preset, "Material preset"))
		var m := VBoxContainer.new()
		m.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		m.add_child(EditorStyle.label("Shell mass (kg)", 12, Color("#b9c3d0")))
		ed.bind_number(m, "softbody.shell_mass", "", 10.0, NAN, NAN, 1.0, "20% of the car", func(): changed(), true)
		r.add_child(m)
		var h := VBoxContainer.new()
		h.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		h.add_child(EditorStyle.label("Hardening", 12, Color("#b9c3d0")))
		ed.bind_number(h, "softbody.hardening", "", 0.05, NAN, NAN, 1.0, "0.2", func(): changed(), true)
		r.add_child(h)
		for g in STRENGTHS:
			b.add_child(EditorStyle.group(g[0]))
			var gr := EditorStyle.row(b)
			for f in g[1]:
				var nf := ed.bind_number(gr, "softbody." + str(f[0]), f[1], f[2], NAN, NAN, f[3], f[4], func(): changed(), true)
				if str(f[0]).ends_with("_force"):
					force_slider(nf, "the default")
		var defaults := EditorStyle.button("Back to the defaults", "small ghost")
		defaults.pressed.connect(func(): _to_defaults(preset))
		defaults.size_flags_horizontal = Control.SIZE_SHRINK_END
		b.add_child(defaults)
		b.add_child(EditorStyle.tipline("Strengths follow the node numbers", "The nodes are numbered from the model. Strengths set on single nodes and " +
			"beams belong to those numbers: when you change the model, check them."))
		ed.refresh_fields()
		lock_tree(b, _locked)
	refresh_forces()
	(_strengths["window"] as Window).popup_centered()


## A force field (kN) gets a slider under it on a scale of tenfolds (0.5 to 5000 kN; the left end is "not set": off) and a
## line that says the force as the hit that makes it: a block of a tonne at that speed, "6.5 km/h / 60 kN".
func force_slider(f: EditorStyle.NumberField, off: String) -> void:
	var slider := HSlider.new()
	slider.min_value = 0
	slider.max_value = 1000
	slider.step = 1
	slider.focus_mode = Control.FOCUS_NONE
	slider.custom_minimum_size.y = 12
	slider.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var text := EditorStyle.hint("")
	f.add_child(slider)
	f.add_child(text)
	var quiet := [false]
	var refresh := func():
		var kn := f.value() if f.value() > 0.0 else 0.0
		quiet[0] = true
		slider.value = clampf(roundf(1000.0 * log(maxf(KN_MIN, kn) / KN_MIN) / log(10.0) / KN_DECADES), 1.0, 1000.0) if kn > 0.0 else 0.0
		quiet[0] = false
		text.text = force_text(kn, off)
	slider.value_changed.connect(func(pos: float):
		if quiet[0]:
			return
		var kn := KN_MIN * pow(10.0, KN_DECADES * pos / 1000.0) if pos > 0.0 else 0.0
		kn = roundf(kn) if kn >= 100.0 else (roundf(kn * 2.0) / 2.0 if kn >= 10.0 else roundf(kn * 10.0) / 10.0)
		text.text = force_text(kn, off)
		if kn > 0.0:
			f.set_value(kn)
			f.edited.emit(kn)
		else:
			f.set_value(null)
			f.committed.emit(NAN))
	f.edit.text_changed.connect(func(_t: String): refresh.call())
	_force_boxes.append(refresh)
	refresh.call()


static func force_text(kn: float, off: String) -> String:
	if kn <= 0.0:
		return off
	var kmh := kn * 1000.0 * HIT_S / HIT_KG * 3.6
	return "%s km/h / %s kN" % [String.num(kmh, 1).trim_suffix(".0") if kmh < 10.0 else str(roundi(kmh)),
		String.num(kn, 1).trim_suffix(".0") if kn < 10.0 else str(roundi(kn))]


## The sliders of the forces follow their fields (a preset, the defaults, a car loaded).
func refresh_forces() -> void:
	for r in _force_boxes:
		r.call()


## A tune is chosen (locked): the shell, the strengths and the parts are the car's (every tune uses them), so they are
## shown but cannot be changed here, with a word on where they are changed; showing the shell and the tests go on.
func set_locked(on: bool) -> void:
	_locked = on
	ui["tune"].visible = on
	if on:
		set_editing(false)
		pick = Callable()
		if ed.view.gizmo.target == pivot:
			ed.view.gizmo.detach()
	lock_tree(ui["body"], on)
	if not _strengths.is_empty():
		lock_tree(_strengths["body"], on)
	parts.render()
	show_selection()


func is_locked() -> bool:
	return _locked


## The fields and buttons under a node are off (on) or on again; Show the shell, the windows and Go to Default stay.
func lock_tree(root: Node, on: bool) -> void:
	for c in root.get_children():
		if c in [ui["show"], ui["to_default"], ui["open_strengths"], ui["open_parts"]]:
			continue
		if c is BaseButton:
			(c as BaseButton).disabled = on
		elif c is LineEdit:
			(c as LineEdit).editable = not on
		elif c is Range:
			(c as Range).editable = not on
		lock_tree(c, on)


func _preset(p: Array) -> void:
	var plain := float(p[1]) == 1.0 and float(p[2]) == 1.0 and float(p[3]) == 1.0
	for g in ["anchor", "beam"]:
		for e in [["stiffness", p[1]], ["yield_force", p[2]], ["break_force", p[3]]]:
			var path := "softbody.%s.%s" % [g, e[0]]
			if plain:
				Tuning.erase(ed.cfg, path)
			else:
				Tuning.write(ed.cfg, path, snappedf(float(DEFAULTS[g + "." + e[0]]) * float(e[1]), 1.0))
	ed.refresh_fields()
	refresh_forces()
	ed.changed()
	changed()


func _to_defaults(preset: OptionButton) -> void:
	if not await ed.ask("Back to the defaults?", "The strengths set for the shell go back to the defaults of the game.", "Defaults"):
		return
	for k in ["shell_mass", "hardening", "anchor", "beam", "contact", "neighbours", "reach"]:
		Tuning.erase(ed.cfg, "softbody." + k)
	preset.select(0)
	ed.refresh_fields()
	refresh_forces()
	ed.changed()
	changed()


# ---- the car: loaded, saved

## A car was loaded (or undone): the selection goes, the parts are listed again, the shell is made again when it is shown.
func fill(_cfg: Dictionary) -> void:
	sel_nodes.clear()
	sel_beam = -1
	pick = Callable()
	parts.render()
	refresh_forces()
	if shown or crash.running():
		changed()
	show_selection()


func on_model(_root: Node3D) -> void:
	_tri_cache.clear()
	if shown:
		changed()


## The car is saved: "softbody" and "parts" as the browser writes them (an empty group is left out, a part without an
## object too, the most nodes within 10 and 120).
func read(c: Dictionary) -> void:
	var sb: Variant = ed.cfg.get("softbody")
	if sb is Dictionary:
		var out: Dictionary = (sb as Dictionary).duplicate(true)
		for g in ["anchor", "beam", "contact"]:
			if out.get(g) is Dictionary and (out[g] as Dictionary).is_empty():
				out.erase(g)
		for k in ["nodes", "beams"]:
			if out.get(k) is Array and (out[k] as Array).is_empty():
				out.erase(k)
		if out.has("max_nodes"):
			if float(out["max_nodes"]) > SCAN_MOST:
				out["max_nodes"] = SCAN_MOST
			elif not (float(out["max_nodes"]) >= 10.0):
				out.erase("max_nodes")
		if out.has("wheel_strength") and not (float(out["wheel_strength"]) >= 0.0):
			out.erase("wheel_strength")
		if out.is_empty():
			c.erase("softbody")
		else:
			c["softbody"] = out
	else:
		c.erase("softbody")
	var list := []
	for p in ed.cfg.get("parts", []) if ed.cfg.get("parts") is Array else []:
		if p is Dictionary and str(p.get("object", "")).strip_edges() != "":
			list.append((p as Dictionary).duplicate(true))
	if list.is_empty():
		c.erase("parts")
	else:
		c["parts"] = list


## A change of the shell: the car is not saved, and the shell is made again a moment after the last change (when it is
## shown or a crash test ran).
func changed(soon := false) -> void:
	ed.changed()
	if shown or crash.running():
		_rebuild_in = 0.15 if soon else 0.4


func soft() -> SoftBody:
	return car.shell.sb if car != null and is_instance_valid(car) and car.shell != null else null


func softbody() -> Dictionary:
	if not (ed.cfg.get("softbody") is Dictionary):
		ed.cfg["softbody"] = {}
	return ed.cfg["softbody"]


func layout() -> Variant:
	var l: Variant = Tuning.read(ed.cfg, "softbody.layout")
	return l if l is Array and (l as Array).size() >= 3 else null


## The middle of the browser's frame (the centre of gravity) in the frame of the body: the car of the bench, or worked
## out from the form as Car does.
func com() -> Vector3:
	if car != null and is_instance_valid(car):
		return car.center_of_mass
	var mean_r := ed.num("chassis.tire_diameter", 0.65) / 2.0
	return Vector3(0.0, ed.num("chassis.cg_height", 0.5) - mean_r, ed.num("chassis.wheelbase", 2.6) * (ed.num("chassis.weight_distribution", 0.5) - 0.5))


## A place in the frame of the body as an entry of softbody.layout (the frame of the browser game, from the centre of gravity).
func layout_entry(local: Vector3, r: float) -> Dictionary:
	var p := local - com()
	return {"x": snappedf(p.x, 0.0001), "y": snappedf(p.y, 0.0001), "z": snappedf(p.z, 0.0001), "r": snappedf(r, 0.0001)}


func layout_point(n: Dictionary) -> Vector3:
	return Vector3(float(n.get("x", 0)), float(n.get("y", 0)), float(n.get("z", 0))) + com()


func status(text: String, kind := "") -> void:
	ed.status(text, kind)


# ---- the shell on the bench

## Starts the bench (when it is not running, or when the shell has changed) and draws the shell.
func show_shell() -> void:
	if not Settings.get_value("damage"):
		status("Damage is off (Settings, Driving): the cars do not dent.", "error")
		return
	if ed.bench.car == null:
		restart_bench()
	car = ed.bench.car
	if soft() == null:
		status("The car does not dent: tick “The car dents”." if Tuning.read(ed.cfg, "softbody.enabled") == false else
			"The model gave no shell (it has too little in it).", "error")
		return
	shown = true
	shell_node.visible = true
	ui["show"].text = "Hide the shell"
	_info()
	show_selection()


func _toggle_shell() -> void:
	if shown:
		hide_shell()
	else:
		show_shell()


func hide_shell() -> void:
	shown = false
	shell_node.visible = false
	ui["show"].text = "Show the shell"
	set_editing(false)
	if ed.view.gizmo.target == pivot:
		ed.view.gizmo.detach()
	_info()


## A new car on the bench from the form as it is (the shell made again); the selection is kept where it still fits.
func restart_bench() -> void:
	_rebuild_in = -1.0
	ed.bench.drop(0.05, 0.0)
	car = ed.bench.car
	var s := soft()
	if s != null:
		sel_nodes = sel_nodes.filter(func(k: int) -> bool: return k < s.count)
		if sel_beam >= s.beam_count:
			sel_beam = -1
	_hide_driver()
	_info()
	show_selection()


## The test bench stopped (↺): the shell, the editing and the crash test go.
func bench_stopped() -> void:
	crash.stopped()
	if shown:
		hide_shell()
	car = null


func _info() -> void:
	var s := soft()
	var meta: Label = ed.card_of["Soft body"]["meta"]
	meta.text = "%d nodes, %d beams" % [s.count, s.beam_count] if s != null and shown else ""


func frame(dt: float) -> void:
	if (ed.tuning.chosen_tune() != "") != _locked:
		set_locked(not _locked)
	if _rebuild_in > 0.0:
		_rebuild_in -= dt
		if _rebuild_in <= 0.0 and not _dragging:
			_rebuild_in = -1.0
			if crash.running():
				crash.again()
			elif shown:
				restart_bench()
	if ed.bench.car != car:
		if ed.bench.car == null:
			bench_stopped()
		else:
			car = ed.bench.car
			_info()
	crash.frame(dt)
	if shown and soft() != null:
		_draw()


func _draw() -> void:
	var s := soft()
	if not _dragging:
		shell_node.global_transform = car.global_transform
	shell_node.visible = not crash.hides_shell()
	_points.clear_surfaces()
	_lines.clear_surfaces()
	if _dragging and layout() != null:
		_draw_preview()
	else:
		var lay: Variant = layout()
		_points.surface_begin(Mesh.PRIMITIVE_POINTS)
		for k in s.count:
			_points.surface_set_color(_node_colour(s, k, lay))
			_points.surface_add_vertex(s.position(k))
		_points.surface_end()
		if s.beam_count > 0:
			_lines.surface_begin(Mesh.PRIMITIVE_LINES)
			for i in s.beam_count:
				var a := s.beam_a[i]
				var c := s.beam_b[i]
				var alive := s.beam_alive[i] == 1 and s.alive(a) and s.alive(c)
				var col := Color.WHITE if i == sel_beam else (Color(0.3, 0.55, 0.9, 0.8) if alive else Color(0.25, 0.1, 0.1, 0.8))
				_lines.surface_set_color(col)
				_lines.surface_add_vertex(s.position(a))
				_lines.surface_set_color(col)
				_lines.surface_add_vertex(s.position(c))
			_lines.surface_end()
	_draw_hinges(s)


## Green when whole, yellow at the bend at which its anchor yields, red above it, grey when torn; blue inside, orange of a part.
func _node_colour(s: SoftBody, k: int, lay: Variant) -> Color:
	if sel_nodes.has(k):
		return Color.WHITE
	if not s.alive(k):
		return Color(0.35, 0.35, 0.4)
	var entry: Variant = (lay as Array)[k] if lay != null and k < (lay as Array).size() else null
	if entry is Dictionary and (entry as Dictionary).get("part") is String:
		return Color(1, 0.62, 0.26)
	if entry is Dictionary and (entry as Dictionary).get("inner") == true:
		return Color(0.35, 0.6, 1)
	var strain := (s.u[k] + s.q[k]).length() / maxf(1e-6, s.node_yield[k] / s.anchor_k)
	return Color.from_hsv(0.33 * maxf(0.0, 1.0 - strain * 0.5), 0.8, 0.95)


## While nodes are moved with the gizmo: the points of the list of the car and the beams from the nearest neighbours.
func _draw_preview() -> void:
	var lay: Array = layout()
	var pts := PackedVector3Array()
	var groups := PackedStringArray()
	_points.surface_begin(Mesh.PRIMITIVE_POINTS)
	for k in lay.size():
		var n: Dictionary = lay[k]
		var p := layout_point(n)
		pts.append(p)
		groups.append(str(n["part"]) if n.get("part") is String else "")
		_points.surface_set_color(Color.WHITE if sel_nodes.has(k) else (Color(1, 0.62, 0.26) if n.get("part") is String else Color(0.3, 0.85, 0.35)))
		_points.surface_add_vertex(p)
	_points.surface_end()
	var near := int(ed.num("softbody.neighbours", 5.0))
	var pairs := NodesTool.beams_of(pts, groups, near, ed.num("softbody.reach", 1.1))
	if pairs.is_empty():
		return
	_lines.surface_begin(Mesh.PRIMITIVE_LINES)
	for i in range(0, pairs.size(), 2):
		var moving := sel_nodes.has(pairs[i]) or sel_nodes.has(pairs[i + 1])
		var col := Color.WHITE if moving else Color(0.3, 0.55, 0.9, 0.8)
		_lines.surface_set_color(col)
		_lines.surface_add_vertex(pts[pairs[i]])
		_lines.surface_set_color(col)
		_lines.surface_add_vertex(pts[pairs[i + 1]])
	_lines.surface_end()


## The hinges in orange: the line between the two hinge points of a part and from the first to the nodes that hold it
## shut, and an arrow along the axis at the origin.
func _draw_hinges(s: SoftBody) -> void:
	_hinges.clear_surfaces()
	var pts := PackedVector3Array()
	for part in parts.list():
		var m := []
		for mount in part.get("mounts", []):
			if mount is Dictionary and (mount.get("point") is Array or int(mount.get("node", -1)) in range(s.count)):
				m.append(mount)
		var at := func(mount: Dictionary) -> Vector3:
			return (PartsPanel.vec(mount["point"]) + com()) if mount.get("point") is Array else s.position(int(mount["node"]))
		if m.size() >= 2:
			pts.append(at.call(m[0]))
			pts.append(at.call(m[1]))
		if m.size() >= 1:
			for k in part.get("nodes", []):
				if int(k) >= 0 and int(k) < s.count:
					pts.append(at.call(m[0]))
					pts.append(s.position(int(k)))
		var h: Variant = part.get("hinge")
		if str(part.get("mode", "")) == "hinge" and h is Dictionary and h.get("origin") is Array:
			var axis := PartsPanel.vec(h["axis"]) if h.get("axis") is Array else Vector3.UP
			if axis.length() > 1e-3:
				axis = axis.normalized()
				var o := PartsPanel.vec(h["origin"]) + com()
				var tip := o + axis * 0.3
				var side := axis.cross(Vector3.UP if absf(axis.y) < 0.9 else Vector3.RIGHT).normalized() * 0.05
				for p in [o - axis * 0.3, tip, tip, tip - axis * 0.1 + side, tip, tip - axis * 0.1 - side]:
					pts.append(p)
	if pts.is_empty():
		return
	_hinges.surface_begin(Mesh.PRIMITIVE_LINES)
	for p in pts:
		_hinges.surface_set_color(ORANGE)
		_hinges.surface_add_vertex(p)
	_hinges.surface_end()


# ---- selecting: a click, Shift and a click to add, a lasso with the middle mouse button

func _screen(local: Vector3) -> Variant:
	var w := shell_node.global_transform * local
	if ed.view.camera.is_position_behind(w):
		return null
	return ed.view.camera.unproject_position(w)


func node_at(mouse: Vector2) -> int:
	var s := soft()
	var best := -1
	var best_d := NODE_PIXELS
	for k in s.count:
		var p: Variant = _screen(s.position(k))
		if p != null and (p as Vector2).distance_to(mouse) < best_d:
			best_d = (p as Vector2).distance_to(mouse)
			best = k
	return best


func _beam_at(mouse: Vector2) -> int:
	var s := soft()
	var best := -1
	var best_d := BEAM_PIXELS
	for i in s.beam_count:
		var a: Variant = _screen(s.position(s.beam_a[i]))
		var b: Variant = _screen(s.position(s.beam_b[i]))
		if a == null or b == null:
			continue
		var c := Geometry2D.get_closest_point_to_segment(mouse, a, b)
		if c.distance_to(mouse) < best_d:
			best_d = c.distance_to(mouse)
			best = i
	return best


## The point of the model of the bench under the mouse: { position, normal (towards the camera), node } in the world, or {}.
func surface_at(mouse: Vector2, root: Node3D = null) -> Dictionary:
	if root == null:
		# (the whole car: once the shell bends the model, its meshes are copies under the skeleton "Shell" of the car, SoftBodyMesh)
		root = car if car != null and is_instance_valid(car) else null
	if root == null:
		return {}
	var from := ed.view.camera.project_ray_origin(mouse)
	var dir := ed.view.camera.project_ray_normal(mouse)
	var best := {}
	var best_d := INF
	for m in root.find_children("*", "MeshInstance3D", true, false):
		var mi := m as MeshInstance3D
		if mi.mesh == null or not mi.is_visible_in_tree() or CollisionProxy.hidden_object(mi):
			continue
		if (mi.global_transform * mi.mesh.get_aabb()).grow(0.01).intersects_ray(from, dir) == null:
			continue
		var key := "%d/%d" % [mi.get_instance_id(), mi.mesh.get_rid().get_id()]      # (the soft body gives a mesh a new one: its triangles)
		if not _tri_cache.has(key):
			_tri_cache[key] = mi.mesh.generate_triangle_mesh()
		var tm: TriangleMesh = _tri_cache[key]
		if tm == null:
			continue
		var inv := mi.global_transform.affine_inverse()
		var hit: Dictionary = tm.intersect_ray(inv * from, (inv.basis * dir).normalized())
		if hit.is_empty():
			continue
		var p: Vector3 = mi.global_transform * Vector3(hit["position"])
		if p.distance_to(from) < best_d:
			best_d = p.distance_to(from)
			var n := (mi.global_transform.basis.inverse().transposed() * Vector3(hit["normal"])).normalized()
			best = {"position": p, "normal": n if n.dot(dir) < 0.0 else -n, "node": mi}
	return best


## A click in the view (CarEditor._on_view_click): true when the card took it.
func click(mouse: Vector2) -> bool:
	if crash.click(mouse):
		return true
	if car == null or not is_instance_valid(car):
		return false
	if pick.is_valid():
		var hit := surface_at(mouse)
		if not hit.is_empty():
			var f := pick
			pick = Callable()
			f.call(car.global_transform.affine_inverse() * Vector3(hit["position"]), hit["node"])
		return true
	if not shown or soft() == null:
		return false
	return _click_shell(mouse)


func _click_shell(mouse: Vector2) -> bool:
	var additive := Input.is_key_pressed(KEY_SHIFT) or Input.is_key_pressed(KEY_CTRL) or Input.is_key_pressed(KEY_META)
	var k := node_at(mouse)
	if k >= 0:
		sel_beam = -1
		if additive:
			if sel_nodes.has(k):
				sel_nodes.erase(k)
			else:
				sel_nodes.append(k)
		else:
			sel_nodes = [k]
		show_selection()
		return true
	if editing and add_node_at(mouse):
		return true
	var b := _beam_at(mouse)
	if not additive:
		sel_nodes.clear()
	sel_beam = b
	show_selection()
	return b >= 0


## A click on the model of the editor (no bench): a Set button of the Parts window that waits for a point or an object.
func picked(hit: Dictionary) -> void:
	if pick.is_valid():
		var f := pick
		pick = Callable()
		f.call(Vector3(hit["position"]), hit["node"])


## The tab Crash test of the test bar (CarEditorEngine.build_test_bar): the crash test and Apply force.
func crash_tab(pane: VBoxContainer) -> void:
	crash.build(pane)


## A part chosen in the Layers panel: its row in the Parts window.
func open_part(part_name: String) -> void:
	parts.open_part(part_name)


func _input(event: InputEvent) -> bool:
	if crash.input(event):
		return true
	if not shown or soft() == null:
		return false
	var mb := event as InputEventMouseButton
	if mb != null and mb.button_index == MOUSE_BUTTON_MIDDLE:
		if mb.pressed:
			_lasso = PackedVector2Array([mb.position])
			_lasso_add = mb.shift_pressed or mb.ctrl_pressed or mb.meta_pressed
		else:
			if _lasso.size() > 2:
				lasso_select(_lasso, _lasso_add)
			_lasso = PackedVector2Array()
		_draw_lasso()
		return true
	var mm := event as InputEventMouseMotion
	if mm != null and not _lasso.is_empty():
		_lasso.append(mm.position)
		_draw_lasso()
		return true
	return false


func _draw_lasso() -> void:
	_lasso_line.points = _lasso
	_lasso_fill.polygon = _lasso if _lasso.size() > 2 else PackedVector2Array()


## The nodes inside a lasso (points of the view) are selected (add: to those that are).
func lasso_select(polygon: PackedVector2Array, add: bool) -> void:
	var s := soft()
	if not add:
		sel_nodes.clear()
	sel_beam = -1
	for k in s.count:
		var p: Variant = _screen(s.position(k))
		if p != null and Geometry2D.is_point_in_polygon(p, polygon) and not sel_nodes.has(k):
			sel_nodes.append(k)
	show_selection()


## The text and the fields of the selection, and the gizmo on the middle of the selected nodes.
func show_selection() -> void:
	var s := soft()
	ui["delete"].disabled = sel_nodes.is_empty() or not editing
	var g := ed.view.gizmo
	if s == null or not shown or (sel_nodes.is_empty() and sel_beam < 0):
		ui["sel_fields"].visible = false
		ui["selection"].text = "Show the shell, then click a node or a beam in the view." if not shown else (
			"Click the model to put a node on it, a node to select it (Shift adds). Middle mouse button and drag: a lasso." if editing else
			"Click a node or a beam in the view (Shift adds). Middle mouse button and drag: a lasso.")
		if g.target == pivot:
			g.detach()
		return
	ui["sel_fields"].visible = true
	var edits := _edits("nodes")
	if not sel_nodes.is_empty():
		var mine := 0
		for k in sel_nodes:
			if edits.has(k):
				mine += 1
		ui["selection"].text = ("Node %d%s: the anchor that holds it to the car." % [sel_nodes[0], " (set by you)" if mine > 0 else ""]) if sel_nodes.size() == 1 \
			else "%d nodes selected%s: what you set goes to all of them." % [sel_nodes.size(), " (%d set by you)" % mine if mine > 0 else ""]
		var ys := sel_nodes.map(func(k: int) -> float: return s.node_yield[k])
		var bs := sel_nodes.map(func(k: int) -> float: return s.node_break[k])
		ui["sel_yield"].set_value(snappedf(ys[0] / 1000.0, 0.001) if ys.all(func(x: float) -> bool: return x == ys[0]) else null)
		ui["sel_break"].set_value(snappedf(bs[0] / 1000.0, 0.001) if bs.all(func(x: float) -> bool: return x == bs[0]) else null)
		var mid := Vector3.ZERO
		for k in sel_nodes:
			mid += s.rest[k]
		if not _dragging:
			pivot.transform = Transform3D(Basis(), mid / sel_nodes.size())
			if g.target != pivot and not crash.running() and not _locked:
				g.attach(pivot, "move")
	else:
		var a := s.beam_a[sel_beam]
		var c := s.beam_b[sel_beam]
		ui["selection"].text = "Beam %d – %d%s." % [a, c, " (set by you)" if _beam_edit(a, c) >= 0 else ""]
		ui["sel_yield"].set_value(snappedf(s.beam_yield_of[sel_beam] / 1000.0, 0.001))
		ui["sel_break"].set_value(snappedf(s.beam_break_of[sel_beam] / 1000.0, 0.001))
		if g.target == pivot:
			g.detach()


func _edits(key: String) -> Dictionary:
	var out := {}
	var list: Variant = softbody().get(key)
	if list is Array:
		for e in list:
			if e is Dictionary and key == "nodes":
				out[int(e.get("i", -1))] = e
	return out


func _beam_edit(a: int, b: int) -> int:
	var list: Variant = softbody().get("beams")
	if list is Array:
		for i in (list as Array).size():
			var e: Variant = list[i]
			if e is Dictionary and mini(int(e.get("a", -1)), int(e.get("b", -1))) == mini(a, b) and maxi(int(e.get("a", -1)), int(e.get("b", -1))) == maxi(a, b):
				return i
	return -1


## Set: the yield and break force (kN) of the selected nodes or beam, saved per node or beam and in the shell at once.
func set_selected() -> void:
	var s := soft()
	if s == null:
		return
	var y: float = ui["sel_yield"].value() * 1000.0
	var b: float = ui["sel_break"].value() * 1000.0
	if not (y >= 0.0) or not (b >= 0.0):
		status("Give the yield and the break force as numbers.", "error")
		return
	if b < y:
		status("The break force has to be at least the yield force.", "error")
		return
	# (the numbers of the nodes are those of this shell: kept as a layout, or another model made other nodes)
	freeze()
	var sb := softbody()
	if not sel_nodes.is_empty():
		var list: Array = sb.get("nodes", []) if sb.get("nodes") is Array else []
		list = list.filter(func(e: Variant) -> bool: return not (e is Dictionary and sel_nodes.has(int(e.get("i", -1)))))
		for k in sel_nodes:
			list.append({"i": k, "yield_force": y, "break_force": b})
			s.node_yield[k] = y
			s.node_break[k] = b
		sb["nodes"] = list
	elif sel_beam >= 0:
		var a := mini(s.beam_a[sel_beam], s.beam_b[sel_beam])
		var c := maxi(s.beam_a[sel_beam], s.beam_b[sel_beam])
		var list: Array = sb.get("beams", []) if sb.get("beams") is Array else []
		var at := _beam_edit(a, c)
		if at >= 0:
			list.remove_at(at)
		list.append({"a": a, "b": c, "yield_force": y, "break_force": b})
		sb["beams"] = list
		s.beam_yield_of[sel_beam] = y
		s.beam_break_of[sel_beam] = b
	ed.changed()
	show_selection()
	status("Set. Save the car to keep it.", "ok")


func clear_selected() -> void:
	var s := soft()
	if s == null:
		return
	var sb := softbody()
	if sb.get("nodes") is Array:
		sb["nodes"] = (sb["nodes"] as Array).filter(func(e: Variant) -> bool: return not (e is Dictionary and sel_nodes.has(int(e.get("i", -1)))))
	if sel_beam >= 0 and sb.get("beams") is Array:
		var at := _beam_edit(s.beam_a[sel_beam], s.beam_b[sel_beam])
		if at >= 0:
			(sb["beams"] as Array).remove_at(at)
	status("Back to the default after the shell is made again (a moment).", "ok")
	changed()


# ---- editing the nodes

## The nodes are made from the model once; from the first edit on they are a list of the car (softbody.layout), with the
## centre of gravity and the tyre of the car they were drawn at (the game shifts them by the difference).
func freeze() -> void:
	var s := soft()
	if layout() != null or s == null:
		return
	var list := []
	for k in s.count:
		var e := layout_entry(s.rest[k], s.radius[k])
		if s.part_of[k] != "":
			e["part"] = s.part_of[k]
		list.append(e)
	var sb := softbody()
	sb["layout"] = list
	sb["layout_cg"] = car.cg_height
	sb["layout_radius"] = car.wheels[0].radius


func set_editing(on: bool) -> void:
	if on and not shown:
		show_shell()
		if not shown:
			return
	editing = on
	ui["edit"].text = "Stop editing nodes" if on else "Edit nodes"
	EditorStyle.style_button(ui["edit"], "small accent" if on else "small")
	ui["edit_box"].visible = on
	_hide_driver()
	show_selection()


## (the driver of the car of the bench is out of the way while nodes are edited)
func _hide_driver() -> void:
	var frame := car.get_node_or_null("Driver") if car != null and is_instance_valid(car) else null
	if frame != null and frame.get("driver") != null:
		(frame.get("driver").root as Node3D).visible = not editing


## A node on the surface of the model under the mouse (the radius of the field): true when the model was hit.
func add_node_at(mouse: Vector2) -> bool:
	var hit := surface_at(mouse)
	if hit.is_empty():
		return false
	var n := (layout() as Array).size() if layout() != null else soft().count
	if n >= MOST_NODES:
		status("A car can have %d nodes at most." % MOST_NODES, "error")
		return true
	freeze()
	var r: float = ui["radius"].value()
	var local := car.global_transform.affine_inverse() * Vector3(hit["position"])
	var lay: Array = layout()
	lay.append(layout_entry(local, r if r > 0.0 else 0.2))
	sel_nodes = [lay.size() - 1]
	sel_beam = -1
	status("Node %d added. It joins its nearest neighbours." % (lay.size() - 1), "ok")
	changed(true)
	return true


func delete_selected() -> void:
	if not sel_nodes.is_empty():
		remove_nodes(sel_nodes.duplicate())


## Removes nodes; the numbers of the nodes behind them go down, and the strengths set on them follow.
func remove_nodes(gone: Array) -> void:
	var s := soft()
	if s == null or gone.is_empty():
		return
	if s.count - gone.size() < 3:
		status("A car needs at least 3 nodes.", "error")
		return
	freeze()
	var sb := softbody()
	var map := {}
	var kept := []
	var lay: Array = layout()
	for i in lay.size():
		if not gone.has(i):
			map[i] = kept.size()
			kept.append(lay[i])
	sb["layout"] = kept
	if sb.get("nodes") is Array:
		var nodes := []
		for e in sb["nodes"]:
			if e is Dictionary and map.has(int(e.get("i", -1))):
				var c: Dictionary = e.duplicate()
				c["i"] = map[int(e["i"])]
				nodes.append(c)
		sb["nodes"] = nodes
	if sb.get("beams") is Array:
		var beams := []
		for e in sb["beams"]:
			if e is Dictionary and map.has(int(e.get("a", -1))) and map.has(int(e.get("b", -1))):
				var c: Dictionary = e.duplicate()
				c["a"] = mini(map[int(e["a"])], map[int(e["b"])])
				c["b"] = maxi(map[int(e["a"])], map[int(e["b"])])
				beams.append(c)
		sb["beams"] = beams
	sel_nodes.clear()
	sel_beam = -1
	status("%d node%s removed." % [gone.size(), "s" if gone.size() > 1 else ""], "ok")
	changed(true)


func reset_nodes() -> void:
	if layout() == null:
		status("The nodes are the ones made from the model already.", "ok")
		return
	if not await ed.ask("Make the nodes again?", "Your nodes are thrown away and made again from the model. The strengths set on single nodes " +
			"and beams go too.", "Make again"):
		return
	for k in ["layout", "layout_cg", "layout_radius", "nodes", "beams"]:
		softbody().erase(k)
	sel_nodes.clear()
	sel_beam = -1
	changed(true)


## (W moves the selected nodes with the gizmo; the beams are drawn from the nearest neighbours while they move.)
func _drag_started() -> void:
	if ed.view.gizmo.target != pivot:
		return
	freeze()
	_dragging = true
	_last_pivot = pivot.position


func _drag_moved() -> void:
	if not _dragging or layout() == null:
		return
	var d := pivot.position - _last_pivot
	_last_pivot = pivot.position
	var lay: Array = layout()
	for k in sel_nodes:
		if k < lay.size():
			var n: Dictionary = lay[k]
			n["x"] = snappedf(float(n["x"]) + d.x, 0.0001)
			n["y"] = snappedf(float(n["y"]) + d.y, 0.0001)
			n["z"] = snappedf(float(n["z"]) + d.z, 0.0001)


func _drag_ended() -> void:
	if _dragging:
		_dragging = false
		changed(true)


## A key (CarEditor._unhandled_key_input): Delete removes the selected nodes, Escape stops a pick, Apply force or editing.
func key(code: Key) -> bool:
	if code == KEY_ESCAPE:
		if pick.is_valid():
			pick = Callable()
			status("")
			return true
		if crash.escape():
			return true
		if editing:
			set_editing(false)
			return true
		return false
	if editing and (code == KEY_DELETE or code == KEY_BACKSPACE) and not sel_nodes.is_empty():
		delete_selected()
		return true
	return false


# ---- the scan: rays at the model from all round the car make the nodes, then the inside is worked out

func _wheel_names() -> Array:
	var out := []
	for s in CarEditor.SLOTS:
		out.append_array(ed.wheel_parts[s])
	return out


func scan() -> void:
	if not shown:
		show_shell()
	if soft() == null:
		return
	var most := clampi(int(ed.num("softbody.max_nodes", 80.0)), 10, SCAN_MOST)
	if layout() != null and not await ed.ask("Make new nodes with the rays?", "The nodes you made and the strengths set on single nodes go.",
			"Make new nodes"):
		return
	status("Scanning the model with rays…")
	await ed.get_tree().process_frame
	var tool := NodesTool.new(car, _wheel_names())
	var surface := tool.surface() if tool.ok() else PackedVector3Array()
	if surface.size() < 20:
		status("The rays hit almost nothing of the model.", "error")
		return
	var with_inside: bool = ui["scan_inside"].button_pressed
	var picked := NodesTool.spread(surface, roundi(most * 0.7) if with_inside else most, PackedVector3Array(), 0.05)
	var r := NodesTool.radius_for(picked)
	var lay := []
	for p in picked:
		lay.append(layout_entry(p, r))
	var sb := softbody()
	sb["layout"] = lay
	sb["layout_cg"] = car.cg_height
	sb["layout_radius"] = car.wheels[0].radius
	sb.erase("nodes")
	sb.erase("beams")
	sel_nodes.clear()
	sel_beam = -1
	var inner := _fill_inside(tool, most) if with_inside else 0
	status("%d nodes: %d on the surface%s." % [lay.size(), picked.size(), " and %d inside" % inner if inner > 0 else ""], "ok")
	changed(true)


func _fill_inside(tool: NodesTool, most: int) -> int:
	var lay: Array = layout()
	var room := mini(SCAN_MOST, most) - lay.size()
	if room < 1:
		return 0
	var chosen := PackedVector3Array()
	for n in lay:
		chosen.append(layout_point(n))
	var picked := NodesTool.spread(tool.inside(), room, chosen, 0.22)
	for p in picked:
		var e := layout_entry(p, NodesTool.INSIDE_RADIUS)
		e["inner"] = true
		lay.append(e)
	return picked.size()


func fill_inside() -> void:
	if not shown:
		show_shell()
	if soft() == null:
		return
	freeze()
	status("Working out the inside…")
	await ed.get_tree().process_frame
	var tool := NodesTool.new(car, _wheel_names())
	var added := _fill_inside(tool, clampi(int(ed.num("softbody.max_nodes", 100.0)), 10, SCAN_MOST)) if tool.ok() else 0
	status("%d nodes added inside." % added if added > 0 else "No room for more nodes inside (raise the most nodes), or no gap left.", "ok" if added > 0 else "")
	if added > 0:
		changed(true)


func set_result(text: String) -> void:
	ui["result"].text = text
