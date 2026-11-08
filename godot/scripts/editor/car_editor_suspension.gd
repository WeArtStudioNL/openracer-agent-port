class_name CarEditorSuspension
extends RefCounted
## The "Suspension and driveline" card of the car editor (suspension-editor.js): a type of suspension for the front and for
## the rear, where the engine is, and the mounts of the parts that are built from the parts library (PartsLibrary: web/parts/
## <type>/<part>.glb) as gizmos in the view, one row each with Move, Turn and Reset. The parts are shown as the game places
## them, built again when a mount is dragged. The mounts are kept per axle and per type, so switching the type back and
## forth does not lose them; the file gets the mounts of the chosen type (car.json "suspension" and "driveline").
## "Edit origins": only the mounts can be clicked in the view, through everything; W moves, E turns, Escape leaves.

const COLOURS := {"front": Color("#5ec8ff"), "rear": Color("#8ee26b"), "driveline": Color("#ffd04d")}
const AT_THE_WHEEL := ["upper_ball", "lower_ball", "strut_bottom", "tierod_outer"]
const WITH_AXLE := {"front": ["diff_front", "prop_front_end"], "rear": ["diff_rear", "prop_rear_end"]}

var ed: CarEditor
var editing := false
var mode := "move"
var state := {}
var _selects := {}
var _rows: VBoxContainer
var _missing: Label
var _edit_button: Button
var _group: Node3D = null
var _markers := {}                   # id -> { target, group, name, ball, last }
var _signature := ""
var _last_axles: Variant = null
var _moving := false
var _hidden := false
var _bar: PanelContainer
var _bar_name: Label
var _rebuild_soon := 0.0


func _init(editor: CarEditor) -> void:
	ed = editor
	_reset_state()


func _reset_state() -> void:
	state = {"front": {"type": "model", "mounts": {}, "hidden": []}, "rear": {"type": "model", "mounts": {}, "hidden": []},
		"driveline": {"engine": "front", "mounts": {}, "hidden": []}}


func build_card() -> void:
	var c := ed.add_card("Suspension and driveline")
	var b: VBoxContainer = c["body"]
	b.add_child(EditorStyle.tipline("Pick a type per axle, drag the mounts", "The suspension built from loose parts (web/parts/<type>/<part>.glb): pick a type for " +
		"each axle, where the engine is, and drag the mounts in the view. \"From the model\" keeps the parts of your own model (named susp_…)."))
	var types := []
	for t in PartsLibrary.TYPES:
		types.append([t, PartsLibrary.TYPES[t]["label"]])
	var r := EditorStyle.row(b)
	for axle in ["front", "rear"]:
		var o := EditorStyle.options(types)
		o.item_selected.connect(func(_i: int): _type_changed(axle))
		_selects[axle] = o
		r.add_child(EditorStyle.labelled(o, "Front suspension" if axle == "front" else "Rear suspension"))
	r = EditorStyle.row(b)
	var eng := EditorStyle.options([["front", "In the front"], ["mid", "In the middle"], ["rear", "In the rear"]])
	eng.item_selected.connect(func(_i: int):
		state["driveline"]["engine"] = EditorStyle.value_of(eng)
		refresh(true)
		ed.changed())
	_selects["engine"] = eng
	r.add_child(EditorStyle.labelled(eng, "Engine"))
	r.add_child(EditorStyle.hint("Propshaft to every driven axle over 40 cm away"))
	_edit_button = EditorStyle.button("Edit origins", "small",
		"Click the origin points in the view, through everything, to move (W) or turn (E) them; Escape leaves the mode")
	_edit_button.pressed.connect(func(): set_editing(not editing))
	b.add_child(_edit_button)
	_rows = VBoxContainer.new()
	b.add_child(_rows)
	_missing = EditorStyle.hint("")
	b.add_child(_missing)
	b.add_child(EditorStyle.tipline("Select a mount: W moves, E turns", "A mount: W moves, E turns (as the exhaust points). The parts of a stretched kind (arms, " +
		"springs, shafts) are aimed from their mount at their other end and stretched to it; a turn of such a mount rolls the part about its length."))


func _type_changed(axle: String) -> void:
	state[axle]["type"] = EditorStyle.value_of(_selects[axle])
	var none: bool = state["front"]["type"] == "none" and state["rear"]["type"] == "none"
	var unsprung: bool = Tuning.read(ed.cfg, "chassis.unsprung") == true
	if none and not unsprung:
		ed.cfg["chassis"]["unsprung"] = true
		ed.form.fill()
	elif unsprung and state[axle]["type"] != "none":
		ed.cfg["chassis"]["unsprung"] = false
		ed.form.fill()
	refresh(true)
	ed.tuning.sync_visibility()
	ed.changed()


## "No suspension (a kart)" and the type None on both axles are one thing: the one follows the other.
func unsprung_changed(on: bool) -> void:
	for axle in ["front", "rear"]:
		if on and state[axle]["type"] != "none":
			state[axle]["type"] = "none"
		elif not on and state[axle]["type"] == "none":
			state[axle]["type"] = "model"
		EditorStyle.select_value(_selects[axle], state[axle]["type"])
	refresh(true)


func _active() -> bool:
	return state["front"]["type"] != "model" or state["rear"]["type"] != "model"


## The car as the library reads it: the types, the mounts of the chosen types, the drive, the block of the engine.
func _config() -> Dictionary:
	var susp := {}
	for axle in ["front", "rear"]:
		var t: String = state[axle]["type"]
		susp[axle] = {"type": t, "mounts": state[axle]["mounts"].get(t, {}), "hidden": state[axle]["hidden"]}
	var c := {"suspension": susp, "driveline": {"engine": state["driveline"]["engine"], "mounts": state["driveline"]["mounts"], "hidden": state["driveline"]["hidden"]},
		"drivetrain": {"drive": str(Tuning.read(ed.cfg, "drivetrain.drive") if Tuning.read(ed.cfg, "drivetrain.drive") else "rwd")}}
	var block: Variant = Tuning.read(ed.cfg, "engine.build.block")
	if block is String:
		c["engine"] = {"build": {"block": block}}
	return c


func _measured() -> Dictionary:
	var places := ed.wheel_places()
	var centres := {}
	var d := 0.0
	for s in CarEditor.SLOTS:
		centres[s] = places[s]["c"]
		d += float(places[s]["size"].y) / 4.0
	return {"centres": centres, "diameter": d}


func read() -> Dictionary:
	var out := {}
	if not _active():
		return out
	var susp := {}
	for axle in ["front", "rear"]:
		var t: String = state[axle]["type"]
		var entry := {"type": t}
		var m: Dictionary = state[axle]["mounts"].get(t, {})
		if not m.is_empty():
			entry["mounts"] = m.duplicate(true)
		if not (state[axle]["hidden"] as Array).is_empty():
			entry["hidden"] = (state[axle]["hidden"] as Array).duplicate()
		susp[axle] = entry
	out["suspension"] = susp
	var dl := {"engine": state["driveline"]["engine"]}
	if not (state["driveline"]["mounts"] as Dictionary).is_empty():
		dl["mounts"] = (state["driveline"]["mounts"] as Dictionary).duplicate(true)
	if not (state["driveline"]["hidden"] as Array).is_empty():
		dl["hidden"] = (state["driveline"]["hidden"] as Array).duplicate()
	out["driveline"] = dl
	return out


func fill() -> void:
	_reset_state()
	var s: Dictionary = ed.cfg.get("suspension", {}) if ed.cfg.get("suspension") is Dictionary else {}
	for axle in ["front", "rear"]:
		var e: Dictionary = s.get(axle, {}) if s.get(axle) is Dictionary else {}
		var t := str(e.get("type", "model"))
		if not PartsLibrary.TYPES.has(t):
			t = "model"
		state[axle]["type"] = t
		if e.get("mounts") is Dictionary:
			state[axle]["mounts"][t] = (e["mounts"] as Dictionary).duplicate(true)
		state[axle]["hidden"] = (e.get("hidden", []) as Array).duplicate() if e.get("hidden") is Array else []
		EditorStyle.select_value(_selects[axle], t)
	var d: Dictionary = ed.cfg.get("driveline", {}) if ed.cfg.get("driveline") is Dictionary else {}
	state["driveline"]["engine"] = str(d.get("engine", "front")) if str(d.get("engine", "front")) in PartsLibrary.ENGINE else "front"
	state["driveline"]["mounts"] = (d.get("mounts", {}) as Dictionary).duplicate(true) if d.get("mounts") is Dictionary else {}
	state["driveline"]["hidden"] = (d.get("hidden", []) as Array).duplicate() if d.get("hidden") is Array else []
	EditorStyle.select_value(_selects["engine"], state["driveline"]["engine"])
	_last_axles = null
	refresh(true)


# ---- the parts in the view and the markers of the mounts

func _clear() -> void:
	if _group != null and is_instance_valid(_group):
		_group.queue_free()
	_group = null
	for id in _markers:
		(_markers[id]["target"] as Node).queue_free()
		ed.layers.targets.erase(id)
		if ed.layers.selected == id:
			ed.layers.selected = ""
			ed.view.gizmo.detach()
	_markers = {}
	for c in _rows.get_children():
		c.queue_free()
	_missing.text = ""
	_signature = ""


func _axles_of(meas: Dictionary) -> Dictionary:
	var c: Dictionary = meas["centres"]
	var fl: Vector3 = c["FL"] if c["FL"].x >= c["FR"].x else c["FR"]
	var rl: Vector3 = c["RL"] if c["RL"].x >= c["RR"].x else c["RR"]
	return {"front": Vector3(absf(fl.x), fl.y, (c["FL"].z + c["FR"].z) / 2.0), "rear": Vector3(absf(rl.x), rl.y, (c["RL"].z + c["RR"].z) / 2.0)}


## The mounts placed by hand go with the wheels when the form moves them (the wheelbase, the tracks, the place of the axles).
func _follow_wheels(meas: Dictionary) -> void:
	var now := _axles_of(meas)
	var was: Variant = _last_axles
	var go := _moving
	_last_axles = now
	_moving = false
	if was == null or not go:
		return
	for axle in ["front", "rear"]:
		var dv: Vector3 = now[axle] - was[axle]
		if dv.length() < 1e-6:
			continue
		var live := PartsLibrary.is_live(state[axle]["type"])
		var move := func(n: String, mt: Variant, across: bool) -> void:
			if not mt is Dictionary or not mt.get("position") is Array:
				return
			var p: Array = mt["position"]
			mt["position"] = [snappedf(float(p[0]) + (dv.x if across else 0.0), 0.001), snappedf(float(p[1]) + dv.y, 0.001), snappedf(float(p[2]) + dv.z, 0.001)]
		for t in state[axle]["mounts"]:
			for n in state[axle]["mounts"][t]:
				move.call(n, state[axle]["mounts"][t][n], not live and n in AT_THE_WHEEL)
		for n in WITH_AXLE[axle]:
			move.call(n, state["driveline"]["mounts"].get(n), false)


func wheels_moved() -> void:
	_moving = true


func refresh(force: bool) -> void:
	if _rows == null:
		return
	var meas := _measured()
	_follow_wheels(meas)
	if not _active():
		_clear()
		return
	var cfg := _config()
	var sig := JSON.stringify([cfg, meas["centres"].values()])
	if not force and sig == _signature:
		return
	_signature = sig
	_build(cfg, meas)


func _build(cfg: Dictionary, meas: Dictionary) -> void:
	if _group != null and is_instance_valid(_group):
		_group.queue_free()
	var model_names := []
	for n in ed.nodes:
		model_names.append(str(n["name"]))
	var out := PartsLibrary.assemble(cfg, meas["centres"], meas["diameter"], model_names)
	_group = out["group"]
	_group.visible = not _hidden
	ed.view.extras.add_child(_group)
	var mounts := PartsLibrary.mounts_of(cfg, meas["centres"], meas["diameter"])
	var keep := {}
	for c in _rows.get_children():
		c.queue_free()
	for grp in ["front", "rear", "driveline"]:
		var names: Array = (mounts[grp] as Dictionary).keys()
		if names.is_empty():
			continue
		_rows.add_child(EditorStyle.group("Driveline" if grp == "driveline" else ("Front suspension" if grp == "front" else "Rear suspension") +
			" (the left side; the right is its mirror)"))
		var eyes := HFlowContainer.new()
		eyes.add_theme_constant_override("h_separation", 6)
		for part in PartsLibrary.parts_of(cfg, grp):
			if part["file"] in out["from_model"][grp]:
				var own := EditorStyle.button("▣ " + str(part["label"]), "small ghost",
					"The model has this part itself (an object with its name): that object is used and the part of the library is not placed")
				own.disabled = true
				eyes.add_child(own)
				continue
			var hidden: bool = part["file"] in state[grp]["hidden"]
			var eb := EditorStyle.button("👁 " + str(part["label"]), "small ghost", ("Hidden: the car's own model has this part. Click to place it from the parts library"
				if hidden else "Placed from the parts library. Click to hide it (the car's own model has it)"))
			eb.add_theme_color_override("font_color", Color("#6b7480") if hidden else Color("#ff7a3d"))
			eb.pressed.connect(func():
				var h: Array = state[grp]["hidden"]
				if part["file"] in h:
					h.erase(part["file"])
				else:
					h.append(part["file"])
				refresh(true)
				ed.changed())
			eyes.add_child(eb)
		_rows.add_child(eyes)
		for n in names:
			var id := "mt:%s:%s" % [grp, n]
			var mt: Dictionary = mounts[grp][n]
			var m := _marker(id, grp, n)
			keep[id] = true
			var dragging := ed.view.gizmo.dragging and ed.layers.selected == id
			var tg: Node3D = m["target"]
			if not dragging:
				tg.position = Vector3(float(mt["position"][0]), float(mt["position"][1]), float(mt["position"][2]))
				tg.rotation = Vector3(deg_to_rad(float(mt["rotation"][0])), deg_to_rad(float(mt["rotation"][1])), deg_to_rad(float(mt["rotation"][2])))
				m["last"] = tg.position
			tg.visible = editing and not _hidden
			((m["ball"] as MeshInstance3D).material_override as StandardMaterial3D).albedo_color = Color.WHITE if ed.layers.selected == id else COLOURS[grp]
			var row := HBoxContainer.new()
			var p: Array = mt["position"]
			var l := EditorStyle.label("%s  (%.2f, %.2f, %.2f)" % [PartsLibrary.MOUNT_LABELS.get(n, n), p[0], p[1], p[2]], 11,
				Color.WHITE if ed.layers.selected == id else EditorStyle.TEXT, false)
			l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			l.clip_text = true
			row.add_child(l)
			var custom: bool = (state["driveline"]["mounts"] as Dictionary).has(n) if grp == "driveline" else \
				(state[grp]["mounts"].get(state[grp]["type"], {}) as Dictionary).has(n)
			for d in [["✥", "move", "Move (W)"], ["⟳", "rotate", "Turn (E)"]]:
				var btn := EditorStyle.button(d[0], "small" + ("" if ed.layers.selected == id and mode == d[1] else " ghost"), d[2])
				btn.pressed.connect(func():
					mode = d[1]
					if ed.layers.selected != id:
						ed.layers.select(id)
					else:
						attach_gizmo(id)
					refresh(true))
				row.add_child(btn)
			var reset := EditorStyle.button("↺", "small ghost", "Back to the default from the wheels")
			reset.modulate.a = 1.0 if custom else 0.4
			reset.pressed.connect(func(): _reset(id))
			row.add_child(reset)
			_rows.add_child(row)
	for id in _markers.keys():
		if not keep.has(id):
			(_markers[id]["target"] as Node).queue_free()
			ed.layers.targets.erase(id)
			if ed.layers.selected == id:
				ed.layers.selected = ""
				ed.view.gizmo.detach()
			_markers.erase(id)
	var missing := PartsLibrary.missing_files(cfg)
	_missing.text = ("Missing in web/parts: %s (the parts that are there are shown)." % ", ".join(missing)) if not missing.is_empty() else \
		"%d parts placed from web/parts." % (out["names"] as Array).size()
	ed.card_of["Suspension and driveline"]["meta"].text = "%s / %s" % [state["front"]["type"], state["rear"]["type"]]
	_show_selected()


func _marker(id: String, grp: String, n: String) -> Dictionary:
	if _markers.has(id):
		return _markers[id]
	var target := Node3D.new()
	var ball := CarEditorView.sphere(0.021, COLOURS[grp], true)
	target.add_child(ball)
	var axes := CarEditorView.lines([Vector3.ZERO, Vector3(0.1, 0, 0), Vector3.ZERO, Vector3(0, 0.1, 0), Vector3.ZERO, Vector3(0, 0, 0.1)],
		[Color.RED, Color.RED, Color.GREEN, Color.GREEN, Color.BLUE, Color.BLUE], true)
	axes.layers = CarEditorView.MARKER_LAYER
	target.add_child(axes)
	target.set_meta("layer", id)
	ed.view.extras.add_child(target)
	ed.layers.targets[id] = target
	_markers[id] = {"target": target, "group": grp, "name": n, "ball": ball, "last": Vector3.ZERO}
	return _markers[id]


func _store(id: String) -> void:
	var m: Dictionary = _markers.get(id, {})
	if m.is_empty():
		return
	var tg: Node3D = m["target"]
	if m["name"] == "rack_end":
		var rack: Dictionary = _markers.get("mt:%s:rack" % m["group"], {})
		if not rack.is_empty():
			tg.position.y = (rack["target"] as Node3D).position.y
			tg.position.z = (rack["target"] as Node3D).position.z
			tg.rotation = Vector3.ZERO
	if m["name"] == "axle_end":
		var was: Vector3 = m["last"]
		tg.position.y = was.y
		tg.position.z = was.z
		tg.rotation = Vector3.ZERO
	if m["name"] == "rack":
		var end: Dictionary = _markers.get("mt:%s:rack_end" % m["group"], {})
		if not end.is_empty():
			(end["target"] as Node3D).position += tg.position - (m["last"] as Vector3)
			_store_target(end)
	m["last"] = tg.position
	_store_target(m)


func _store_target(m: Dictionary) -> void:
	var tg: Node3D = m["target"]
	var p := tg.position
	var r := tg.rotation
	var entry := {"position": [snappedf(p.x, 0.001), snappedf(p.y, 0.001), snappedf(p.z, 0.001)],
		"rotation": [snappedf(rad_to_deg(r.x), 0.1), snappedf(rad_to_deg(r.y), 0.1), snappedf(rad_to_deg(r.z), 0.1)]}
	if m["group"] == "driveline":
		state["driveline"]["mounts"][m["name"]] = entry
	else:
		var t: String = state[m["group"]]["type"]
		if not state[m["group"]]["mounts"].has(t):
			state[m["group"]]["mounts"][t] = {}
		state[m["group"]]["mounts"][t][m["name"]] = entry


func _reset(id: String) -> void:
	var m: Dictionary = _markers.get(id, {})
	if m.is_empty():
		return
	if m["group"] == "driveline":
		(state["driveline"]["mounts"] as Dictionary).erase(m["name"])
	else:
		var t: String = state[m["group"]]["type"]
		if state[m["group"]]["mounts"].has(t):
			(state[m["group"]]["mounts"][t] as Dictionary).erase(m["name"])
	refresh(true)
	ed.changed()


func is_mount(id: String) -> bool:
	return id.begins_with("mt:")


func attach_gizmo(id: String) -> void:
	var g := ed.view.gizmo
	g.detach()
	var m: Dictionary = _markers.get(id, {})
	if m.is_empty():
		return
	var end_only: bool = m["name"] == "rack_end" or m["name"] == "axle_end"
	g.attach(m["target"], "move" if mode == "move" or end_only else "rotate")
	if end_only:
		g.show_axis = [true, false, false]
	for k in _markers:
		((_markers[k]["ball"] as MeshInstance3D).material_override as StandardMaterial3D).albedo_color = Color.WHITE if k == id else COLOURS[_markers[k]["group"]]
	_show_selected()


## A mount was dragged: stored, and the parts built again (at most ten times a second while it moves).
func moved(id: String) -> void:
	_store(id)
	if _rebuild_soon <= 0.0:
		_rebuild_soon = 0.1
		ed.get_tree().create_timer(0.1).timeout.connect(func():
			_rebuild_soon = 0.0
			refresh(true))


func set_mode(m: String) -> void:
	mode = m
	if is_mount(ed.layers.selected):
		attach_gizmo(ed.layers.selected)
		refresh(true)


func hide(on: bool) -> void:
	_hidden = on
	if _group != null:
		_group.visible = not on
	for id in _markers:
		(_markers[id]["target"] as Node3D).visible = editing and not on


func pickables() -> Array:
	var out := []
	for id in _markers:
		out.append(_markers[id]["target"])
	return out


func _show_selected() -> void:
	if _bar_name == null:
		return
	var m: Dictionary = _markers.get(ed.layers.selected, {})
	if m.is_empty():
		_bar_name.text = "No point selected"
		_bar_name.add_theme_color_override("font_color", EditorStyle.MUTED)
		return
	var side := "" if m["group"] == "driveline" else ("Front: " if m["group"] == "front" else "Rear: ")
	_bar_name.text = side + str(PartsLibrary.MOUNT_LABELS.get(m["name"], m["name"])) + ("  (turn)" if mode == "rotate" else "  (move)")
	_bar_name.add_theme_color_override("font_color", Color("#37d67a"))


## Edit origins: the balls of the mounts are the only things a click in the view picks; a bar at the bottom saves and leaves.
func set_editing(on: bool) -> void:
	if on and not _active():
		ed.status("Pick a type of suspension first: there are no origins to edit.", "warn")
		return
	editing = on
	EditorStyle.style_button(_edit_button, "small" + (" accent" if on else ""))
	_edit_button.text = "Editing origins… (Escape leaves)" if on else "Edit origins"
	if _bar == null:
		_bar = EditorStyle.float_panel()
		_bar.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
		_bar.grow_horizontal = Control.GROW_DIRECTION_BOTH
		_bar.grow_vertical = Control.GROW_DIRECTION_BEGIN
		_bar.position.y = -14
		var row := HBoxContainer.new()
		_bar.add_child(row)
		_bar_name = EditorStyle.label("No point selected", 14, EditorStyle.MUTED, false)
		_bar_name.custom_minimum_size.x = 200
		row.add_child(_bar_name)
		var leave := EditorStyle.button("Leave", "small ghost")
		leave.pressed.connect(func(): set_editing(false))
		row.add_child(leave)
		var save := EditorStyle.button("Save the car", "primary", "Save the car and leave the mode")
		save.pressed.connect(func():
			if await ed.save():
				set_editing(false))
		row.add_child(save)
		ed.view.overlay.add_child(_bar)
	_bar.visible = on
	for id in _markers:
		(_markers[id]["target"] as Node3D).visible = on and not _hidden
	ed.view.markers.visible = not on
	if not on and is_mount(ed.layers.selected):
		ed.layers.select(ed.layers.selected)
	_show_selected()
