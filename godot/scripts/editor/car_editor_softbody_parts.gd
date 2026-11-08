extends RefCounted
## The Parts window of the Soft body card (softbody-editor.js: dlgParts, partRow, readRow, setField): the objects of the
## model that swing on a hinge, come loose or break (car.json "parts", CarParts in the game), with every number and the
## Set buttons that take a value from the view: the object (a click on the model), the hinge points (the selected node,
## or a point on the surface), the nodes that hold the part shut and its own nodes (the selected nodes), the origin of
## the hinge (the object, a node, a point) and its axis (A→B, X, Y, Z). The window is not modal: it stays beside the
## view, so nodes can be selected while it is open. Places are in the frame of the browser game (from the centre of
## gravity, x left, y up, z forward). A row of the Layers panel opens the window at its part, or offers to add it.

const MODES := [["hinge", "Hinge"], ["detachable", "Loose"], ["breakable", "Breakable (shatters)"]]
const LOOSE_NAME := "(?i)wheel|tyre|tire|steer|^rig-|^susp_|brake_caliper"

var card: Object                     # the Soft body card (car_editor_softbody.gd)
var ed: CarEditor
var rows := []                       # { part, panel, f: field name -> control }
var _dialog := {}
var _box: VBoxContainer
var _offer: VBoxContainer
var _quiet := false


func _init(owner_card: Object) -> void:
	card = owner_card
	ed = card.get("ed")


## The parts of the car (car.json "parts", in the car of the form).
func list() -> Array:
	if not (ed.cfg.get("parts") is Array):
		ed.cfg["parts"] = []
	return ed.cfg["parts"]


static func vec(a: Variant) -> Vector3:
	return Vector3(float(a[0]), float(a[1]), float(a[2])) if a is Array and (a as Array).size() >= 3 else Vector3.ZERO


static func numbers(text: String) -> Variant:
	var list := []
	for x in text.replace(",", " ").replace(";", " ").split(" ", false):
		if not x.is_valid_float():
			return null
		list.append(float(x))
	return list if list.size() == 3 else null


static func text_of(v: Vector3) -> String:
	return "%s, %s, %s" % [snappedf(v.x, 0.001), snappedf(v.y, 0.001), snappedf(v.z, 0.001)]


## The three numbers of car.json as they are (a place read back unchanged keeps the pin data that goes with it).
static func text_list(a: Variant) -> String:
	return ", ".join((a as Array).slice(0, 3).map(func(x: Variant) -> String: return str(float(x)))) if a is Array and (a as Array).size() >= 3 else ""


func _build() -> void:
	_dialog = EditorStyle.dialog(ed, "Parts that swing or come loose", Vector2(700, 640))
	(_dialog["window"] as Window).exclusive = false
	var b: VBoxContainer = _dialog["body"]
	b.add_child(EditorStyle.tipline("Select nodes in the view, then Set", "Keep this panel open: select nodes in the view (or click on the model) and use " +
		"the Set buttons next to the fields."))
	var what := EditorStyle.fold(b, "What the fields mean")
	what.add_child(EditorStyle.hint("A part is an object of the model (a door, the hood, a mirror, a wing). Hinge: it turns about an axis, between two " +
		"angles, with a spring that brings it back to its rest angle and a damper. With a latch force it sits shut until the load on it passes that force, " +
		"with a break force it tears off then. Loose: it sits on the car until the load passes the break force, and then it is a free object that falls and " +
		"slides. Breakable: it breaks into pieces at its force. The load is the mass times the acceleration of its place, or the force of the shell on the " +
		"nodes it hangs on, whichever is more. The origin and the axis are in the frame of the car: x to the left, y up, z forward, from the centre of " +
		"gravity; with the shell shown, the orange arrows in the view are the hinges. (The Godot game has no swinging hinge yet: a hinged part falls off " +
		"when all its pins break.)"))
	_offer = VBoxContainer.new()
	b.add_child(_offer)
	_box = VBoxContainer.new()
	_box.add_theme_constant_override("separation", 10)
	b.add_child(_box)
	var add := EditorStyle.button("Add a part", "small accent")
	add.pressed.connect(func():
		list().append({"object": "", "mode": "hinge", "mass": 10, "hinge": {}})
		render())
	b.add_child(add)


func toggle() -> void:
	if _dialog.is_empty():
		_build()
	var w: Window = _dialog["window"]
	if w.visible:
		w.hide()
	else:
		render()
		var room := ed.get_viewport().get_visible_rect().size
		w.popup(Rect2i(Vector2i(maxi(0, int(room.x) - w.size.x - 300), 80), w.size))


func is_open() -> bool:
	return not _dialog.is_empty() and (_dialog["window"] as Window).visible


## The rows again from the parts of the car.
func render() -> void:
	if _dialog.is_empty():
		return
	for c in _box.get_children():
		c.queue_free()
	rows.clear()
	if list().is_empty():
		_box.add_child(EditorStyle.hint("No parts: the whole model dents with the shell."))
	for part in list():
		if part is Dictionary:
			_row(part)
	card.call("lock_tree", _box.get_parent(), card.call("is_locked"))


# ---- a row

func _row(part: Dictionary) -> void:
	var panel := PanelContainer.new()
	var st := EditorStyle.box(Color("#1c222a"), 8, 1, EditorStyle.LINE)
	st.content_margin_left = 10
	st.content_margin_right = 10
	st.content_margin_top = 8
	st.content_margin_bottom = 8
	panel.add_theme_stylebox_override("panel", st)
	_box.add_child(panel)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 6)
	panel.add_child(v)
	var e := {"part": part, "panel": panel, "f": {}}
	rows.append(e)
	var f: Dictionary = e["f"]
	var top := EditorStyle.row(v)
	f["object"] = _text(top, "Object of the model", str(part.get("object", "")), "", e, [["Pick on the model", "object"]])
	f["mode"] = EditorStyle.options(MODES, str(part.get("mode", "hinge")))
	f["mode"].item_selected.connect(func(_i: int): _read(e))
	top.add_child(EditorStyle.labelled(f["mode"], "Behaviour"))
	f["mass"] = _num(top, "Mass (kg)", float(part.get("mass", 10)), 0.5, "", e)
	var rm := EditorStyle.button("Remove", "small ghost")
	rm.pressed.connect(func(): _remove(part))
	top.add_child(rm)
	var loose := EditorStyle.row(v)
	f["loose"] = loose
	f["break_force"] = _num(loose, "Breaks loose at (kN)", float(part["break_force"]) / 1000.0 if part.has("break_force") else NAN, 0.5, "never", e)
	f["break_delay"] = _num(loose, "Delay (s)", float(part["break_delay"]) if part.has("break_delay") else NAN, 0.05, "0.15", e)
	f["held"] = _text(v, "Held by nodes", ", ".join((part.get("nodes", []) as Array).map(func(x: Variant) -> String: return str(int(x)))),
		"the 3 nearest", e, [["Set = selected nodes", "held"]])
	var own := EditorStyle.row(v)
	var own_box := VBoxContainer.new()
	own_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	own_box.add_child(EditorStyle.label("Own nodes of the part", 12, Color("#b9c3d0")))
	f["own_info"] = EditorStyle.hint("")
	own_box.add_child(f["own_info"])
	own.add_child(own_box)
	for s in [["Set = selected nodes", "own"], ["Clear", "own_clear"]]:
		var sb := EditorStyle.button(s[0], "small ghost")
		sb.pressed.connect(set_field.bind(e, s[1]))
		own.add_child(sb)
	_hinge_fields(v, part, e)
	_show_mode(e)
	_own_info(e)


func _hinge_fields(v: VBoxContainer, part: Dictionary, e: Dictionary) -> void:
	var f: Dictionary = e["f"]
	var hb := VBoxContainer.new()
	hb.add_theme_constant_override("separation", 6)
	v.add_child(hb)
	f["hinge"] = hb
	var h: Dictionary = part.get("hinge", {}) if part.get("hinge") is Dictionary else {}
	var m: Array = part.get("mounts", []) if part.get("mounts") is Array else []
	var mount := func(i: int, key: String) -> Variant:
		return (m[i] as Dictionary).get(key) if i < m.size() and m[i] is Dictionary else null
	var r1 := EditorStyle.row(hb)
	for side in [["A", 0], ["B", 1]]:
		var node: Variant = mount.call(side[1], "node")
		var force: Variant = mount.call(side[1], "break_force")
		f["m" + side[0]] = _num(r1, "Hinge point %s (node)" % side[0], float(node) if node != null else NAN, 1.0, "", e, [["Set", "m" + side[0]]])
		f["m" + side[0] + "f"] = _num(r1, "tears off at (kN)", float(force) / 1000.0 if force != null and float(force) > 0.0 else NAN, 1.0, "0: never", e)
	var r2 := EditorStyle.row(hb)
	for side in [["A", 0], ["B", 1]]:
		var pt: Variant = mount.call(side[1], "point")
		f["m" + side[0] + "pt"] = _text(r2, "Point %s on the surface (x, y, z)" % side[0], text_list(pt), "instead of a node", e,
			[["Pick point", "m" + side[0] + "pick"]])
	var r3 := EditorStyle.row(hb)
	f["origin"] = _text(r3, "Origin x, y, z (m)", text_list(h.get("origin")), "the middle of the part", e,
		[["Object", "origin_object"], ["Node", "origin_node"], ["Pick point", "origin_pick"]])
	f["axis"] = _text(r3, "Axis", text_list(h.get("axis")), "0, 1, 0", e,
		[["A→B", "axis_ab"], ["X", "axis_x"], ["Y", "axis_y"], ["Z", "axis_z"]])
	var r4 := EditorStyle.row(hb)
	for k in [["min", "Lowest angle (°)", 5.0, "-90"], ["max", "Highest angle (°)", 5.0, "90"], ["rest", "Rest angle (°)", 5.0, "0"]]:
		f[k[0]] = _num(r4, k[1], float(h[k[0]]) if h.has(k[0]) else NAN, k[2], k[3], e)
	var r5 := EditorStyle.row(hb)
	f["spring"] = _num(r5, "Spring (N·m/rad)", float(h["spring"]) if h.has("spring") else NAN, 1.0, "0", e)
	f["damper"] = _num(r5, "Damper (N·m·s/rad)", float(h["damper"]) if h.has("damper") else NAN, 0.5, "0", e)
	f["latch"] = _num(r5, "Latch force (kN)", float(h["latch_force"]) / 1000.0 if h.has("latch_force") else NAN, 0.5, "3 g; 0: open", e)
	f["hinge_break"] = _num(r5, "Tears off at (kN)", float(h["break_force"]) / 1000.0 if h.has("break_force") else NAN, 1.0, "0: never", e)


## A text field with its label and Set buttons ([text, what]) above it.
func _text(parent: Control, label: String, value: String, placeholder: String, e: Dictionary, sets := []) -> LineEdit:
	var le := EditorStyle.line_edit(value, placeholder)
	le.text_submitted.connect(func(_t: String): _read(e))
	le.focus_exited.connect(func(): _read(e))
	parent.add_child(_with_sets(le, label, e, sets))
	return le


func _num(parent: Control, label: String, value: float, step: float, placeholder: String, e: Dictionary, sets := []) -> EditorStyle.NumberField:
	var nf := EditorStyle.NumberField.new("", step, NAN, NAN, placeholder)
	nf.set_value(null if is_nan(value) else value)
	nf.committed.connect(func(_v: float): _read(e))
	parent.add_child(_with_sets(nf, label, e, sets))
	return nf


func _with_sets(control: Control, label: String, e: Dictionary, sets: Array) -> VBoxContainer:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 2)
	v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var head := HBoxContainer.new()
	head.add_child(EditorStyle.label(label, 12, Color("#b9c3d0"), false))
	for s in sets:
		var b := EditorStyle.button(s[0], "small ghost")
		b.pressed.connect(set_field.bind(e, s[1]))
		head.add_child(b)
	v.add_child(head)
	v.add_child(control)
	return v


func _show_mode(e: Dictionary) -> void:
	var hinge := str(EditorStyle.value_of(e["f"]["mode"])) == "hinge"
	e["f"]["hinge"].visible = hinge
	e["f"]["loose"].visible = not hinge


func _own_info(e: Dictionary) -> void:
	var n := 0
	var lay: Variant = card.call("layout")
	if lay is Array:
		for x in lay:
			if x is Dictionary and x.get("part") == e["part"].get("object"):
				n += 1
	e["f"]["own_info"].text = "%d nodes of its own (orange in the view)" % n if n > 0 else "none: the part is one rigid piece"


func _remove(part: Dictionary) -> void:
	if not await ed.ask("Remove “%s” from the loose parts?" % part.get("object", ""), "Its hinge, pins and strengths go.", "Remove"):
		return
	list().erase(part)
	render()
	card.call("changed")


# ---- what the row says into the part (readRow)

func _read(e: Dictionary) -> void:
	if _quiet:
		return
	var part: Dictionary = e["part"]
	var f: Dictionary = e["f"]
	var was_hinge := str(part.get("mode", "")) == "hinge"
	var was_object := str(part.get("object", ""))
	part["object"] = (f["object"] as LineEdit).text.strip_edges()
	part["mode"] = str(EditorStyle.value_of(f["mode"]))
	# a part that becomes a hinge (or a hinge that gets its object) turns about the origin of its object, unless an origin is set
	if part["mode"] == "hinge" and part["object"] != "" and (not was_hinge or was_object != part["object"]) and numbers(f["origin"].text) == null:
		var o: Variant = object_origin(part["object"])
		if o != null:
			f["origin"].text = text_of(o)
	var mass: float = f["mass"].value()
	part["mass"] = mass if mass > 0.0 else 10.0
	var held := []
	for x in (f["held"] as LineEdit).text.replace(",", " ").replace(";", " ").split(" ", false):
		if x.is_valid_int() and int(x) >= 0:
			held.append(int(x))
	if held.is_empty():
		part.erase("nodes")
	else:
		part["nodes"] = held
	if part["mode"] == "hinge":
		_read_hinge(part, f)
		part.erase("break_force")
		part.erase("break_delay")
	else:
		var bf: float = f["break_force"].value()
		if bf > 0.0:
			part["break_force"] = bf * 1000.0
		else:
			part.erase("break_force")
		var bd: float = f["break_delay"].value()
		if bd >= 0.0:
			part["break_delay"] = bd
		else:
			part.erase("break_delay")
		part.erase("hinge")
		part.erase("mounts")
	_show_mode(e)
	_own_info(e)
	card.call("changed")


func _read_hinge(part: Dictionary, f: Dictionary) -> void:
	var hinge := {}
	var origin: Variant = numbers(f["origin"].text)
	var axis: Variant = numbers(f["axis"].text)
	if origin != null:
		hinge["origin"] = origin
	if axis != null:
		hinge["axis"] = axis
	for k in ["min", "max", "rest", "spring", "damper"]:
		var x: float = f[k].value()
		if not is_nan(x):
			hinge[k] = x
	var latch: float = f["latch"].value()
	if not is_nan(latch):
		hinge["latch_force"] = latch * 1000.0
	var hb: float = f["hinge_break"].value()
	if hb > 0.0:
		hinge["break_force"] = hb * 1000.0
	part["hinge"] = hinge
	var mounts := []
	for side in ["A", "B"]:
		var point: Variant = numbers(f["m" + side + "pt"].text)
		var node: float = f["m" + side].value()
		var mount := {}
		if point != null:
			mount["point"] = point                  # (a point on the surface wins over a node)
		elif node >= 0.0:
			mount["node"] = int(node)
		else:
			continue
		var force: float = f["m" + side + "f"].value()
		if force > 0.0:
			mount["break_force"] = force * 1000.0
		mounts.append(mount)
	# the pin points of the part window of the browser have more than the fields here (axes, angles, more than two): they are kept
	var prev: Array = part.get("mounts", []) if part.get("mounts") is Array else []
	for i in mounts.size():
		var old: Variant = prev[i] if i < prev.size() else null
		if old is Dictionary and old.has("axes") and str(old.get("point")) == str(mounts[i].get("point")) and old.get("node") == mounts[i].get("node"):
			for k in ["axes", "min", "max", "limits", "rot", "activate_force"]:
				if old.has(k):
					mounts[i][k] = old[k]
	for i in range(2, prev.size()):
		mounts.append(prev[i])
	if mounts.is_empty():
		part.erase("mounts")
	else:
		part["mounts"] = mounts


# ---- the Set buttons: the value from what is selected in the view, or from a click on the model

func set_field(e: Dictionary, what: String) -> void:
	var f: Dictionary = e["f"]
	var part: Dictionary = e["part"]
	var s: SoftBody = card.call("soft")
	var sel: Array = card.get("sel_nodes")
	var needs_shell := what in ["mA", "mB", "held", "own", "origin_node"]
	if needs_shell and (s == null or not card.get("shown")):
		ed.status("Show the shell first (the Soft body card), then select nodes in the view.", "error")
		return
	if what in ["mA", "mB", "origin_node"] and sel.size() != 1:
		ed.status("Select one node in the view (a click on it).", "error")
		return
	if what in ["held", "own"] and sel.is_empty():
		ed.status("Select the nodes in the view first (a click, or a lasso with the middle mouse button).", "error")
		return
	match what:
		"mA", "mB":
			f[what + "pt"].text = ""
			f[what].set_value(sel[0])
			ed.status("Node %d is the hinge point %s." % [sel[0], what.substr(1)], "ok")
		"held":
			f["held"].text = ", ".join(sel.map(func(x: Variant) -> String: return str(x)))
		"own":
			_own_nodes(part, sel)
		"own_clear":
			_own_nodes(part, [])
		"origin_object":
			var o: Variant = object_origin(str(part.get("object", "")))
			if o == null:
				ed.status("Choose the object of the part first.", "error")
				return
			f["origin"].text = text_of(o)
		"origin_node":
			f["origin"].text = text_of(s.rest[sel[0]] - card.call("com"))
		"axis_ab":
			var a: Variant = _hinge_point(f, "A", s)
			var b: Variant = _hinge_point(f, "B", s)
			if a == null or b == null or (a as Vector3).distance_to(b) < 1e-4:
				ed.status("Set the hinge points A and B first (a node or a point on the surface).", "error")
				return
			f["axis"].text = text_of(((b as Vector3) - (a as Vector3)).normalized())
		"axis_x", "axis_y", "axis_z":
			f["axis"].text = {"axis_x": "1, 0, 0", "axis_y": "0, 1, 0", "axis_z": "0, 0, 1"}[what]
		_:
			_wait_for_click(e, what)
			return
	_read(e)


func _wait_for_click(e: Dictionary, what: String) -> void:
	var f: Dictionary = e["f"]
	var com: Vector3 = card.call("com")
	if what == "object":
		card.set("pick", func(_local: Vector3, node: Node):
			var names := []
			var root: Node = node
			while root != null and not (root is Car) and root != ed.model_root and root != ed.view.pivot:
				names.append(str(root.name))
				root = root.get_parent()
			if names.is_empty():
				return
			f["object"].text = names[0]
			ed.status("Object: %s. Used: %s (type another name of the list if you mean another level)." % [" ← ".join(names), names[0]], "ok")
			_read(e))
		ed.status("Click the part on the model.", "ok")
		return
	var field: String = "origin" if what == "origin_pick" else what.substr(0, 2) + "pt"
	card.set("pick", func(local: Vector3, _node: Node):
		f[field].text = text_of(local - com)
		if field != "origin":
			f[field.substr(0, 2)].set_value(null)
		ed.status("The point is on the surface where you clicked." + (" The hinge goes through the points A and B." if field != "origin" else ""), "ok")
		_read(e))
	ed.status("Click the model where the hinge is." if field == "origin" else "Click the model where the pin point is.", "ok")


## A hinge point in the frame of the browser game: its point, or the place of its node.
func _hinge_point(f: Dictionary, side: String, s: SoftBody) -> Variant:
	var pt: Variant = numbers(f["m" + side + "pt"].text)
	if pt != null:
		return vec(pt)
	var k: float = f["m" + side].value()
	if s != null and k >= 0.0 and int(k) < s.count:
		return s.rest[int(k)] - card.call("com")
	return null


## The nodes of a part: the selected nodes get its name in the layout (they are joined to each other, not to the body).
func _own_nodes(part: Dictionary, sel: Array) -> void:
	card.call("freeze")
	var lay: Variant = card.call("layout")
	if not lay is Array:
		return
	for n in lay:
		if n is Dictionary and n.get("part") == part.get("object"):
			n.erase("part")
	for k in sel:
		if int(k) < (lay as Array).size():
			lay[int(k)]["part"] = str(part.get("object", ""))
	card.call("changed", true)


## The origin of an object of the model (its pivot) in the frame of the browser game: where a hinge turns when nothing else is set.
func object_origin(object_name: String) -> Variant:
	if object_name == "":
		return null
	var cv: Variant = card.get("car")
	var c: Car = cv as Car if cv != null and is_instance_valid(cv) else null
	var root: Node3D = c.model_root if c != null else ed.model_root
	var n := root.find_child(object_name, true, false) as Node3D if root != null else null
	if n == null:
		return null
	var world := n.global_position
	var local := c.global_transform.affine_inverse() * world if c != null else world
	return local - card.call("com")


# ---- a part chosen in the Layers panel

func open_part(object_name: String) -> void:
	if _dialog.is_empty():
		_build()
	if not (_dialog["window"] as Window).visible:
		toggle()
	for c in _offer.get_children():
		c.queue_free()
	for e in rows:
		var st: StyleBoxFlat = (e["panel"] as PanelContainer).get_theme_stylebox("panel")
		st.border_color = EditorStyle.ACCENT if e["part"].get("object") == object_name else EditorStyle.LINE
		if e["part"].get("object") == object_name:
			var sc := _box.get_parent().get_parent().get_parent() as ScrollContainer
			if sc != null:
				sc.ensure_control_visible.call_deferred(e["panel"])
	for p in list():
		if p is Dictionary and p.get("object") == object_name:
			return
	if RegEx.create_from_string(LOOSE_NAME).search(object_name) != null:
		ed.status(object_name + " is moved by the wheels, the steering or the suspension rig: it cannot be a loose part.")
		return
	_offer.add_child(EditorStyle.hint("“%s” is not a part yet." % object_name))
	var r := EditorStyle.row(_offer)
	var hinge := EditorStyle.button("Hinge part", "small accent", "A part that swings on pin points (a door, the hood) and can fall off")
	hinge.pressed.connect(func(): _add(object_name, "hinge"))
	r.add_child(hinge)
	var brk := EditorStyle.button("Breakable only", "small", "A part that bends with the body and falls off at a force (a mirror, a headlight, a plate)")
	brk.pressed.connect(func(): _add(object_name, "detachable"))
	r.add_child(brk)


func _add(object_name: String, mode: String) -> void:
	var part := {"object": object_name, "mode": mode, "mass": 10 if mode == "hinge" else 2}
	if mode == "hinge":
		var o: Variant = object_origin(object_name)
		part["hinge"] = {"origin": [snappedf(o.x, 0.001), snappedf(o.y, 0.001), snappedf(o.z, 0.001)]} if o != null else {}
	else:
		part["break_force"] = 3000
	list().append(part)
	for c in _offer.get_children():
		c.queue_free()
	render()
	card.call("changed")
	ed.status("%s is a %s part." % [object_name, "hinged" if mode == "hinge" else "breakable"], "ok")
