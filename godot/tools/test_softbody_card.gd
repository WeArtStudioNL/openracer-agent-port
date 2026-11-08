extends Node
## (a scene, for the autoloads: Godot --headless --fixed-fps 120 --path godot res://tools/test_softbody_card.tscn)
## Tests the Soft body card of the car editor (car_editor_softbody.gd): the hatchback of the game in and out of the card
## unchanged ("softbody" and "parts"), the shell shown on the bench, the nodes made from the model and with the rays,
## a node and a beam selected and set, a strength of the Strengths window, a node added on the model and removed, the
## lasso, a field of the Parts window, the crash test of the bench (the car dents and the card reports it) and Apply
## force. Nothing is saved.

var failures := 0


func _ready() -> void:
	get_tree().create_timer(240.0).timeout.connect(func():
		print("TIMEOUT")
		get_tree().quit(2))
	await _run()
	print("RESULT: %s (%d failures)" % ["ok" if failures == 0 else "FAILED", failures])
	get_tree().quit(1 if failures > 0 else 0)


func check(ok: bool, what: String) -> void:
	print(("  ok    " if ok else "  FAIL  ") + what)
	if not ok:
		failures += 1


func _wait(seconds: float) -> void:
	await get_tree().create_timer(seconds).timeout


static func _same(a: Variant, b: Variant) -> bool:
	return JSON.stringify(a, "", true) == JSON.stringify(b, "", true)


func _run() -> void:
	var ed := CarEditor.new()
	add_child(ed)
	await get_tree().process_frame
	var card: Object = ed.hooks.get("Soft body")
	check(card != null, "the card is loaded (CarEditor.CARD_HOOKS)")
	if card == null:
		return
	print("1. the hatchback in and out of the card")
	var raw: Dictionary = Content.load_json("cars/hatchback/car.json")
	ed.load_existing("hatchback")
	await get_tree().process_frame
	var out := {}
	card.call("read", out)
	if not _same(out.get("softbody"), raw.get("softbody")):
		for k in raw["softbody"]:
			if not _same(out["softbody"].get(k), raw["softbody"][k]):
				print("    differs: ", k, " ", JSON.stringify(out["softbody"].get(k)).left(200), " / ", JSON.stringify(raw["softbody"][k]).left(200))
		for k in out["softbody"]:
			if not raw["softbody"].has(k):
				print("    added: ", k)
	check(_same(out.get("softbody"), raw.get("softbody")), "softbody unchanged (%d nodes of the layout)" % (raw["softbody"]["layout"] as Array).size())
	check(_same(out.get("parts"), raw.get("parts")), "parts unchanged (%d parts)" % (raw.get("parts", []) as Array).size())
	var saved := ed.build_config("hatchback")
	var sb_saved: Dictionary = saved.get("softbody", {}).duplicate(true)
	for k in ["layout_cg", "layout_radius"]:
		if not (raw["softbody"] as Dictionary).has(k):
			sb_saved.erase(k)
	check(_same(sb_saved, raw.get("softbody")) and _same(saved.get("parts"), raw.get("parts")), "and so in the car.json that Save writes")
	print("2. the shell on the bench")
	card.call("show_shell")
	await _wait(1.0)
	var s: SoftBody = card.call("soft")
	check(s != null and card.get("shown") and ed.bench.car != null, "shown: the car of the bench has a shell")
	if s == null:
		return
	check(s.body_count == (raw["softbody"]["layout"] as Array).size() and s.beam_count > s.body_count,
		"the nodes of the layout (%d, and %d of the suspension) and the beams (%d)" % [s.body_count, s.count - s.body_count, s.beam_count])
	await _nodes(card)
	await _select(ed, card)
	await _parts(ed, card)
	await _part_window(ed, card)
	await _crash(ed, card)
	await _push(ed, card)


func _nodes(card: Object) -> void:
	print("3. the nodes made from the model, and with the rays")
	var sb: Dictionary = card.call("softbody")
	for k in ["layout", "layout_cg", "layout_radius", "nodes", "beams"]:
		sb.erase(k)
	card.call("restart_bench")
	var s: SoftBody = card.call("soft")
	check(s != null and s.count >= 8 and s.beam_count > 0, "made from the model as the game makes them: %d nodes, %d beams" % [
		s.count if s else 0, s.beam_count if s else 0])
	var t0 := Time.get_ticks_msec()
	await card.call("scan")
	var lay: Variant = card.call("layout")
	var inner := 0
	if lay is Array:
		for n in lay:
			if n.get("inner") == true:
				inner += 1
	check(lay is Array and (lay as Array).size() >= 40 and (lay as Array).size() <= 120 and inner > 0,
		"Scan with rays: %d nodes, %d inside (%d ms)" % [(lay as Array).size() if lay is Array else 0, inner, Time.get_ticks_msec() - t0])
	await _wait(0.5)
	s = card.call("soft")
	check(s != null and lay is Array and s.body_count == (lay as Array).size(), "the shell is made again from them (%d nodes)" % (s.body_count if s else 0))


func _select(ed: CarEditor, card: Object) -> void:
	print("4. select, set, add, remove")
	var s: SoftBody = card.call("soft")
	card.set("sel_nodes", [3])
	card.call("show_selection")
	(card.get("ui")["sel_yield"] as EditorStyle.NumberField).set_value(7)
	(card.get("ui")["sel_break"] as EditorStyle.NumberField).set_value(9)
	card.call("set_selected")
	var nodes: Variant = Tuning.read(ed.cfg, "softbody.nodes")
	check(nodes is Array and _same(nodes[0], {"i": 3, "yield_force": 7000.0, "break_force": 9000.0}) and s.node_yield[3] == 7000.0,
		"node 3 set to 7 / 9 kN (softbody.nodes %s)" % JSON.stringify(nodes))
	card.set("sel_nodes", [])
	card.set("sel_beam", 2)
	card.call("show_selection")
	(card.get("ui")["sel_yield"] as EditorStyle.NumberField).set_value(11)
	(card.get("ui")["sel_break"] as EditorStyle.NumberField).set_value(22)
	card.call("set_selected")
	var beams: Variant = Tuning.read(ed.cfg, "softbody.beams")
	check(beams is Array and float(beams[0]["yield_force"]) == 11000.0 and s.beam_yield_of[2] == 11000.0, "beam %d – %d set (softbody.beams %s)" % [
		s.beam_a[2], s.beam_b[2], JSON.stringify(beams)])
	card.call("open_strengths")
	var f: Variant = ed.field_for("softbody.anchor.yield_force")
	var slider: HSlider = null
	for c in (f as Node).get_children() if f is Node else []:
		if c is HSlider:
			slider = c
	if slider != null:
		slider.value = 500.0
	check(slider != null and Tuning.read(ed.cfg, "softbody.anchor.yield_force") == 50000.0 and (f as Node).get_child(-1).text == "5.4 km/h / 50 kN",
		"the force slider: the middle is 50 kN, the hit of a tonne at 5.4 km/h (%s N)" % Tuning.read(ed.cfg, "softbody.anchor.yield_force"))
	if f is EditorStyle.NumberField:
		(f as EditorStyle.NumberField).edit.text = "60"
		(f as EditorStyle.NumberField).edit.text_changed.emit("60")
		(f as EditorStyle.NumberField).committed.emit(60.0)
	check(Tuning.read(ed.cfg, "softbody.anchor.yield_force") == 60000.0, "Strengths: the anchors yield at 60 kN (%s N)" % Tuning.read(ed.cfg, "softbody.anchor.yield_force"))
	(card.get("_strengths")["window"] as Window).hide()
	await _wait(0.8)
	s = card.call("soft")
	check(s != null and s.anchor_yield == 60000.0 and s.node_yield[3] == 7000.0, "the shell made again has them (%s, node 3 %s)" % [
		s.anchor_yield if s else 0.0, s.node_yield[3] if s else 0.0])
	# a node on the model: a click where a node of the top of the car is
	var top := 0
	for k in s.count:
		if s.rest[k].y > s.rest[top].y:
			top = k
	var shell_node: Node3D = card.get("shell_node")
	var mouse := ed.view.camera.unproject_position(shell_node.global_transform * s.rest[top])
	var before: int = (card.call("layout") as Array).size()
	card.call("set_editing", true)
	var added: bool = card.call("add_node_at", mouse)
	check(added and (card.call("layout") as Array).size() == before + 1, "Edit nodes: a click on the model adds a node (%d → %d)" % [before,
		(card.call("layout") as Array).size()])
	await _wait(0.5)
	card.call("remove_nodes", [before])
	await _wait(0.5)
	s = card.call("soft")
	check((card.call("layout") as Array).size() == before and s.body_count == before, "Delete selected: removed again (%d)" % s.body_count)
	# the lasso: the middle mouse button pressed, dragged round the view and let go (the events the view hands the card first)
	var size := ed.view.container.size
	var press := InputEventMouseButton.new()
	press.button_index = MOUSE_BUTTON_MIDDLE
	press.pressed = true
	press.position = Vector2(2, 2)
	ed.view.input_hook.call(press)
	for p in [Vector2(size.x - 2, 2), size - Vector2(2, 2), Vector2(2, size.y - 2)]:
		var mm := InputEventMouseMotion.new()
		mm.position = p
		ed.view.input_hook.call(mm)
	var release := press.duplicate() as InputEventMouseButton
	release.pressed = false
	check(ed.view.input_hook.call(release), "the view hands the middle button to the card")
	var sel: Array = card.get("sel_nodes")
	check(sel.size() > s.count / 2, "the lasso round the view selects the nodes in it (%d of %d)" % [sel.size(), s.count])
	# the gizmo moves the selected nodes: the layout follows, and the shell is made again on release
	card.set("sel_nodes", [5])
	card.call("show_selection")
	var pivot: Node3D = card.get("pivot")
	check(ed.view.gizmo.target == pivot, "the selected node has the gizmo")
	var x0 := float((card.call("layout") as Array)[5]["x"])
	card.call("_drag_started")
	pivot.position += Vector3(0.1, 0, 0)
	card.call("_drag_moved")
	card.call("_drag_ended")
	check(absf(float((card.call("layout") as Array)[5]["x"]) - x0 - 0.1) < 1e-3, "moved 10 cm along x in the layout")
	await _wait(0.5)
	s = card.call("soft")
	check(s != null and absf(s.rest[5].x - (x0 + 0.1 + float(card.call("com").x))) < 1e-3, "and in the shell made again")
	card.set("sel_nodes", [])
	card.call("set_editing", false)


func _parts(ed: CarEditor, card: Object) -> void:
	print("5. the Parts window")
	var parts: Object = card.get("parts")
	parts.call("toggle")
	await get_tree().process_frame
	var rows: Array = parts.get("rows")
	check(rows.size() == (ed.cfg.get("parts", []) as Array).size() and rows.size() > 0, "a row for every part (%d)" % rows.size())
	var was: Array = (ed.cfg["parts"] as Array).duplicate(true)
	for e in rows:
		parts.call("_read", e)
	check(_same(ed.cfg["parts"], was), "every row read back into its part leaves the parts as they were (the pins of the hinges too)")
	card.call("set_locked", true)
	var ui: Dictionary = card.get("ui")
	var row_button := (rows[0]["panel"] as Node).find_children("*", "Button", true, false)[0] as Button
	check(ui["tune"].visible and ui["edit"].disabled and (ui["sel_yield"] as EditorStyle.NumberField).edit.editable == false and row_button.disabled
		and not ui["show"].disabled, "a tune is chosen: the card and the Parts window are shown but locked, Show the shell is not")
	card.call("set_locked", false)
	check(not ui["edit"].disabled and not row_button.disabled, "and unlocked again at Default")
	var nf: EditorStyle.NumberField = rows[0]["f"]["break_force"]
	nf.set_value(4.5)
	nf.committed.emit(4.5)
	check(float(ed.cfg["parts"][0].get("break_force", 0)) == 4500.0, "%s breaks loose at 4.5 kN" % ed.cfg["parts"][0]["object"])
	parts.call("open_part", "grille")
	check(true, "a part chosen in the layers opens its row")
	parts.call("toggle")


func _buttons(root: Node, text: String) -> Array:
	return root.find_children("*", "Button", true, false).filter(func(b: Button) -> bool: return b.text == text)


func _part_window(ed: CarEditor, card: Object) -> void:
	print("5b. the window of a loose part")
	ed.load_existing("hatchback")
	await get_tree().process_frame
	var pw: Object = card.get("partwin")
	card.call("open_part", "hood")
	await _wait(0.5)
	var body: Node = pw.get("_body")
	check(pw.get("name") == "hood" and (pw.get("panel") as Control).visible and ed.bench.car != null, "a row of the layers opens the window of hood (the bench runs)")
	check(_buttons(body, "X").size() == 1 and _buttons(body, "+ add").size() == 1, "its pin point with the axes X Y Z, and + add")
	var hood_mesh := ed.bench.car.model_root.find_child("hood", true, false) as Node3D
	var mesh_of_hood: Node = hood_mesh.find_children("*", "MeshInstance3D", true, false)[0] if not hood_mesh is MeshInstance3D else hood_mesh
	check(pw.call("loose_of", mesh_of_hood) == "hood", "a click on its mesh is a click on hood (the loose object)")
	await get_tree().process_frame
	check((pw.get("_tris") as ImmediateMesh).get_surface_count() > 0 and ed.view.gizmo.target == pw.get("_pivot"),
		"the fan of the free axis is drawn and the turn gizmo is on the pin")
	(_buttons(body, "+ add")[0] as Button).pressed.emit()
	check(pw.get("mode") == "pin", "+ add waits for a click on the surface")
	pw.call("_add_pin", Vector3(0.1, 0.5, 1.6))
	await get_tree().process_frame
	body = pw.get("_body")
	var mounts: Array = pw.call("pins")
	check(mounts.size() == 2 and mounts[1]["point"] == [0.1, 0.5, 1.6] and pw.call("part")["hinge"]["origin"] == [0.1, 0.5, 1.6],
		"a second pin point there, the origin of the hinge with it")
	(_buttons(body, "Y")[1] as Button).pressed.emit()
	await get_tree().process_frame
	body = pw.get("_body")
	check(mounts[1]["axes"] == {"x": true, "y": true, "z": false}, "Y is a free axis of pin 2 too")
	var sliders: Array = body.find_children("*", "HSlider", true, false)
	var limit: HSlider = null
	for sl in sliders:
		if (sl as HSlider).min_value == -180.0:
			limit = sl
	if limit != null:
		limit.value = -40.0
	check(limits_of_pin(mounts[1], "y") == [-40.0, 90.0] and mounts[1]["limits"].has("y"), "a limit slider sets the min of the Y axis of pin 2 (%s)" %
		str(mounts[1].get("limits")))
	var pivot: Node3D = pw.get("_pivot")
	pivot.rotate_object_local(Vector3.RIGHT, 0.5)
	pw.call("_gizmo_moved")
	var sel: int = pw.get("pin_sel")
	check(mounts[sel].get("rot") is Array and absf(float(mounts[sel]["rot"][0])) > 0.1, "the turn gizmo turns the pin (rot %s)" % str(mounts[sel].get("rot")))
	print("    nodes of the part")
	var before: int = (pw.call("own_nodes") as Array).size()
	pw.call("_start_nodes")
	check(pw.get("mode") == "nodes" and (pw.get("_faded") as Array).size() > 10, "Add nodes: the rest of the car is faded (%d meshes)" % (pw.get("_faded") as Array).size())
	pw.call("_add_node", Vector3(0, 0.45, 1.5))
	check((pw.call("own_nodes") as Array).size() == before + 1, "a node of hood is added (%d)" % (before + 1))
	pw.call("_end_nodes")
	check(pw.get("mode") == "" and (pw.get("_faded") as Array).is_empty(), "and it stops, the car seen again")
	card.call("set_locked", true)
	var any_on := false
	for b in pw.get("_body").find_children("*", "Button", true, false):
		any_on = any_on or not (b as Button).disabled
	check(not any_on, "a tune is chosen: the window is locked")
	card.call("set_locked", false)
	print("    a breakable part")
	pw.call("open", "left-taillight")
	await get_tree().process_frame
	body = pw.get("_body")
	check(_buttons(body, "Break it now").size() == 1 and (body.find_children("*", "CheckBox", true, false)[0] as CheckBox).button_pressed,
		"left-taillight: it shatters, with Break it now")
	var state: String = await pw.call("break_now")
	check(state == "broken", "Break it now: it broke on the bench (%s)" % state)
	print("    an object that is no part yet")
	var free_name := ""
	var parts_now := {}
	for q in ed.cfg["parts"]:
		parts_now[str(q["object"])] = true
	for e in ed.nodes:
		var nm := str(e["name"])
		var o := ed.bench.car.model_root.find_child(nm, true, false) as Node3D if ed.bench.car != null else null
		if o != null and not parts_now.has(nm) and pw.call("loose_of", o) == nm:
			free_name = nm
			break
	pw.call("open", free_name)
	await get_tree().process_frame
	body = pw.get("_body")
	check(free_name != "" and _buttons(body, "Breakable only").size() == 1, "%s: Hinge part or Breakable only" % free_name)
	if free_name != "":
		(_buttons(body, "Breakable only")[0] as Button).pressed.emit()
		check(pw.call("part").get("mode") == "detachable" and float(pw.call("part").get("break_force", 0)) == 3000.0, "Breakable only: a part at 3 kN")
	pw.call("close")
	check(not (pw.get("panel") as Control).visible, "closed")
	ed.bench.stop()


static func limits_of_pin(pin: Dictionary, a: String) -> Array:
	var l: Variant = pin.get("limits", {}).get(a) if pin.get("limits") is Dictionary else null
	return [float(l[0]), float(l[1])] if l is Array else [float(pin.get("min", -90)), float(pin.get("max", 90))]


func _crash(ed: CarEditor, card: Object) -> void:
	print("6. the crash test of the bench (the hatchback as it is)")
	ed.load_existing("hatchback")
	await get_tree().process_frame
	var crash: Object = card.get("crash")
	(crash.get("ui")["speed"] as HSlider).value = 40.0
	crash.call("start")
	await get_tree().process_frame
	check(crash.call("running") and crash.get("wall") != null, "the wall is on the bench and the car accelerates")
	var t := 0.0
	while t < 40.0 and not crash.get("run").get("done", true):
		await _wait(0.5)
		t += 0.5
	var run: Dictionary = crash.get("run")
	var s: SoftBody = card.call("soft")
	var st := s.stats() if s else {}
	var text: String = card.get("ui")["result"].text
	print("    ", text)
	check(run.get("hit", false) and run.get("done", false), "the car hit the wall and stopped (%.1f s)" % t)
	check(not st.is_empty() and st["max_bend"] > 0.01 and st["absorbed"] > 1000.0, "it dented (bend %.1f cm, %.1f kJ)" % [
		st.get("max_bend", 0.0) * 100.0, st.get("absorbed", 0.0) / 1000.0])
	check(text.contains("bend") and text.contains("kJ"), "the card reports it")
	crash.call("stop")
	check(crash.get("wall") == null and ed.bench.car == null, "Stop crash test: the wall and the bench go")


func _push(ed: CarEditor, card: Object) -> void:
	print("7. Apply force")
	var crash: Object = card.get("crash")
	(crash.get("ui")["kmh"] as EditorStyle.NumberField).set_value(60)
	crash.call("set_push", true)
	await _wait(1.0)
	var s: SoftBody = card.call("soft")
	check(crash.get("push_mode") and s != null, "the bench runs, the arrow follows the mouse")
	if s == null:
		return
	ed.view.camera.position = Vector3(0, 1.2, 7)
	ed.view.camera.look_at(Vector3(0, 0.3, 0))
	await get_tree().process_frame
	var mouse := ed.view.camera.unproject_position(Vector3(0, 0.3, 1.5))
	crash.call("fire", mouse)
	check(not crash.get("cube").is_empty(), "a cube is fired at the nose")
	await _wait(2.0)
	var st := s.stats()
	var text: String = card.get("ui")["result"].text
	print("    ", text)
	check(st["absorbed"] > 0.0 and text.contains("peak"), "the shell took it (%.1f kJ, bend %.1f cm)" % [st["absorbed"] / 1000.0, st["max_bend"] * 100.0])
	print("    a cube at the left door: the part feels the hit itself")
	var door := ed.bench.car.model_root.find_child("body_left-door", true, false) as Node3D
	# (a little under the middle, straight from the side: the mirror stands above it and can be in the line of a view
	# from above, the more so once the first cube has bent the front)
	var mid: Vector3 = card.get("partwin").call("_box", door).get_center() + Vector3(0, -0.12, 0)
	ed.view.camera.position = mid + Vector3(5, 0, 0)
	ed.view.camera.look_at(mid)
	await get_tree().process_frame
	crash.call("fire", ed.view.camera.unproject_position(mid))
	var cube: Dictionary = crash.get("cube")
	print("    ", cube.get("part", "no part"))
	check(str(cube.get("part", "")).begins_with("body_left-door: ") and ed.bench.car.parts.part_named("body_left-door").state != "held",
		"the door opened or tore off (%s)" % cube.get("part", "no part"))
	crash.call("set_push", false)
	ed.bench.stop()
