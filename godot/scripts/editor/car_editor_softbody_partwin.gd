extends RefCounted
## The window of one loose part of the Soft body card (softbody-editor.js: partClick, openPartWindow, renderPartWinBody,
## shatterSection, drawPartGizmos, fadeOthers): a click on a loose object of the model (or its row in the Layers panel)
## opens a window over the view for it. An object that is no part yet can become a Hinge part (a first pin point at the
## origin of the object) or a Breakable one. A breakable part has its break force and delay and the shatter settings
## (what it breaks into, the particles, Show the broken mesh, Break it now). A hinge part has its pin points (+ add: a
## click on the surface), each with its free axes X Y Z, the limits of every free axis, the turn of the pin (three angles
## and the turn gizmo in the view, E), Opens at and Breaks off at; and its own deformation nodes (Add nodes: a click on
## the part puts one there, the rest of the car faded; the strength of all of them; a list with ✕). The view shows the
## pin points, the fans of the free axes between their limits (white: the zero, yellow: where the part lies) and the
## nodes of the part. The object under the mouse is lit in orange. Everything goes into car.json "parts" and
## "softbody.layout" as the browser writes them.

const AXES := ["x", "y", "z"]
const AXIS_COLOURS := {"x": Color("#ff5555"), "y": Color("#55dd77"), "z": Color("#5599ff")}
const ORANGE := Color("#ff9f43")
const PARTICLE_MATERIALS := [["glass", "Glass"], ["tinted", "Tinted glass"], ["red", "Red plastic"], ["orange", "Orange plastic"],
	["white", "White plastic"], ["black", "Black plastic"], ["chrome", "Chrome"], ["custom", "Colour of its own"]]
const SHAPES := [["shards", "Shards"], ["splinters", "Splinters"], ["grains", "Grains"]]
const LOOSE_NAME := "(?i)wheel|tyre|tire|steer|^rig-|^susp_|brake_caliper"
const BODY_SHARE := 0.45            # an object that covers this much of the car from above is the body, not a loose part

var card: Object                     # the Soft body card (car_editor_softbody.gd)
var ed: CarEditor
var name := ""                       # the object of the part that is open ("": closed)
var mode := ""                       # "pin": a click puts a pin point; "nodes": a click puts a node of the part
var pin_sel := -1
var panel: PanelContainer
var _title: Label
var _body: VBoxContainer
var _group: Node3D                   # follows the car of the bench: the frame of the car
var _lines: ImmediateMesh
var _tris: ImmediateMesh
var _balls: Node3D
var _pivot: Node3D                   # what the turn gizmo holds: the chosen pin
var _dirty := true
var _lit: Array = []                 # the meshes lit as the object under the mouse
var _lit_name := ""
var _faded: Array = []               # the meshes faded while nodes are added
var _light: StandardMaterial3D
var _foot := {}                      # object name -> its share of the car seen from above
var _drag_from := Vector2.INF
var _hover_at := Vector2.INF
var _hover_gone := false


func _init(owner_card: Object) -> void:
	card = owner_card
	ed = card.get("ed")
	panel = EditorStyle.float_panel()
	panel.custom_minimum_size = Vector2(330, 0)
	panel.visible = false
	panel.mouse_filter = Control.MOUSE_FILTER_STOP
	ed.view.overlay.add_child(panel)
	ed.view.container.mouse_exited.connect(func(): _hover_gone = true)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 6)
	panel.add_child(col)
	var head := HBoxContainer.new()
	_title = EditorStyle.label("Part", 13, EditorStyle.TEXT, false)
	_title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_title.mouse_filter = Control.MOUSE_FILTER_PASS
	head.add_child(_title)
	var x := EditorStyle.button("×", "small ghost", "Close")
	x.pressed.connect(close)
	head.add_child(x)
	head.gui_input.connect(_head_input)
	col.add_child(head)
	var sc := ScrollContainer.new()
	sc.custom_minimum_size = Vector2(330, 420)
	sc.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	col.add_child(sc)
	_body = VBoxContainer.new()
	_body.add_theme_constant_override("separation", 6)
	_body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	sc.add_child(_body)
	_group = Node3D.new()
	_group.name = "PartWindow"
	ed.view.viewport.add_child(_group)
	_lines = _immediate(false)
	_tris = _immediate(true)
	_balls = Node3D.new()
	_group.add_child(_balls)
	_pivot = Node3D.new()
	_pivot.name = "PinPivot"
	_group.add_child(_pivot)
	_light = StandardMaterial3D.new()
	_light.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_light.albedo_color = Color(1.0, 0.62, 0.26, 0.35)
	_light.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_light.render_priority = 4
	ed.view.gizmo.moved.connect(_gizmo_moved)
	ed.view.gizmo.drag_ended.connect(_gizmo_ended)


func _immediate(fill: bool) -> ImmediateMesh:
	var mi := MeshInstance3D.new()
	var im := ImmediateMesh.new()
	mi.mesh = im
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.vertex_color_use_as_albedo = true
	m.no_depth_test = true
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.render_priority = 9 if fill else 10
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.layers = CarEditorView.MARKER_LAYER
	mi.extra_cull_margin = 16384.0
	_group.add_child(mi)
	return im


## The window moves like a window: drag its title.
func _head_input(event: InputEvent) -> void:
	var mb := event as InputEventMouseButton
	if mb != null and mb.button_index == MOUSE_BUTTON_LEFT:
		_drag_from = mb.position if mb.pressed else Vector2.INF
	var mm := event as InputEventMouseMotion
	if mm != null and _drag_from != Vector2.INF:
		var room := ed.view.overlay.size
		panel.position = (panel.position + mm.position - _drag_from).clamp(Vector2.ZERO, room - Vector2(60, 40))


func is_open() -> bool:
	return name != ""


# ---- the car, the part and the frames

func _car() -> Car:
	var c: Variant = card.get("car")
	return c as Car if c != null and is_instance_valid(c) else null


## The part of car.json "parts" whose object is open ({} when it is no part yet).
func part() -> Dictionary:
	for p in card.get("parts").list():
		if p is Dictionary and str(p.get("object", "")) == name:
			return p
	return {}


func pins() -> Array:
	var p := part()
	return p["mounts"] if p.get("mounts") is Array else []


## The object of the open part in the car of the bench (the bench makes a new car for every test).
func object() -> Node3D:
	var c := _car()
	var root: Node3D = c.model_root if c != null else ed.model_root
	return root.find_child(name, true, false) as Node3D if root != null and name != "" else null


## A mesh of the car as the model has it: a copy that the shell bends (under the skeleton "Shell") is its source.
func source(n: Node) -> Node:
	var c := _car()
	if c != null and c.shell_mesh != null and n is MeshInstance3D and c.shell_mesh.source_of.has(n):
		return c.shell_mesh.source_of[n]["node"]
	return n


## The loose object that holds what was hit: the outermost named object under the whole that is not the body (it covers
## less than BODY_SHARE of the car seen from above), not a wheel or a part that the rig moves; "" when there is none.
func loose_of(hit_node: Node) -> String:
	var c := _car()
	var root: Node3D = c.model_root if c != null else ed.model_root
	if root == null:
		return ""
	var named := {}
	for e in ed.nodes:
		named[str(e["name"])] = true
	var found := ""
	var n := source(hit_node)
	while n != null and n != root and n != c:
		var nm := str(n.name)
		if named.has(nm) and _footprint(n as Node3D, root) < BODY_SHARE:
			if RegEx.create_from_string(LOOSE_NAME).search(nm) != null:
				return ""
			found = nm
		n = n.get_parent()
	return found


func _footprint(o: Node3D, root: Node3D) -> float:
	if o == null:
		return 1.0
	var key := "%s/%d" % [o.name, root.get_instance_id()]
	if not _foot.has(key):
		var whole := _box(root)
		var own := _box(o)
		_foot[key] = (own.size.x * own.size.z) / maxf(1e-6, whole.size.x * whole.size.z)
	return _foot[key]


## The box of the meshes under a node, in the world.
static func _box(o: Node3D) -> AABB:
	var box := AABB()
	var first := true
	var list: Array = o.find_children("*", "MeshInstance3D", true, false)
	if o is MeshInstance3D:
		list.append(o)
	for m in list:
		var mi := m as MeshInstance3D
		if mi.mesh == null:
			continue
		var b := mi.global_transform * mi.mesh.get_aabb()
		box = b if first else box.merge(b)
		first = false
	return box


## A point of the world in the frame of the browser game (from the centre of gravity of the car).
func _local(world: Vector3) -> Vector3:
	var c := _car()
	var p := c.global_transform.affine_inverse() * world if c != null else world
	return p - card.call("com")


func _world(local: Vector3) -> Vector3:
	var c := _car()
	var p: Vector3 = local + card.call("com")
	return c.global_transform * p if c != null else p


static func _vec(a: Variant) -> Vector3:
	return Vector3(float(a[0]), float(a[1]), float(a[2])) if a is Array and (a as Array).size() >= 3 else Vector3.ZERO


static func _r(x: float, step := 0.001) -> float:
	return snappedf(x, step)


static func _quat(pin: Dictionary) -> Quaternion:
	var r: Variant = pin.get("rot")
	return Quaternion(float(r[0]), float(r[1]), float(r[2]), float(r[3])).normalized() if r is Array and (r as Array).size() == 4 else Quaternion.IDENTITY


static func axes_of(pin: Dictionary) -> Dictionary:
	var a: Variant = pin.get("axes")
	if a is Dictionary:
		return {"x": bool(a.get("x", false)), "y": bool(a.get("y", false)), "z": bool(a.get("z", false))}
	return {"x": true, "y": false, "z": false}


## The limits of a pin about one of its axes (degrees): its own, or the min and max of the pin (a pin of before).
static func limits_of(pin: Dictionary, a: String) -> Array:
	var l: Variant = pin.get("limits", {}).get(a) if pin.get("limits") is Dictionary else null
	if l is Array and (l as Array).size() == 2:
		return [float(l[0]), float(l[1])]
	return [float(pin.get("min", -90)), float(pin.get("max", 90))]


## The twist of a pin about its one free axis (rad): turning the pin about its axis moves the zero of the angles.
static func twist_of(pin: Dictionary) -> float:
	var on := AXES.filter(func(k: String) -> bool: return axes_of(pin)[k])
	if on.size() != 1 or not (pin.get("rot") is Array):
		return 0.0
	var q := _quat(pin)
	var e := {"x": Vector3.RIGHT, "y": Vector3.UP, "z": Vector3.BACK}[on[0]] as Vector3
	var t := 2.0 * atan2(q.x * e.x + q.y * e.y + q.z * e.z, q.w)
	return wrapf(t, -PI, PI)


static func euler_of(pin: Dictionary) -> Vector3:
	var e := Basis(_quat(pin)).get_euler(EULER_ORDER_XYZ)
	return Vector3(snappedf(rad_to_deg(e.x), 0.1), snappedf(rad_to_deg(e.y), 0.1), snappedf(rad_to_deg(e.z), 0.1))


# ---- open and close

## Opens the window of an object (the bench starts: the pin points are in the frame of the car).
func open(object_name: String) -> void:
	if RegEx.create_from_string(LOOSE_NAME).search(object_name) != null:
		ed.status(object_name + " is moved by the wheels, the steering or the suspension rig: it cannot be a loose part.")
		return
	if _car() == null:
		card.call("restart_bench")
	if mode == "nodes":
		_fade(false)
	name = object_name
	mode = ""
	pin_sel = 0 if not pins().is_empty() else -1
	panel.visible = true
	if panel.position == Vector2.ZERO:
		panel.position = Vector2(maxf(12.0, ed.view.overlay.size.x - 360.0), 60)
	render()
	_dirty = true
	ed.layers.show_part(object_name)


## A row of the Layers panel: the window of that object (again: it closes).
func toggle(object_name: String) -> void:
	if name == object_name:
		close()
	else:
		open(object_name)


func close() -> void:
	if mode == "nodes":
		_end_nodes()
	mode = ""
	name = ""
	panel.visible = false
	if ed.view.gizmo.target == _pivot:
		ed.view.gizmo.detach()
	_dirty = true


func _changed(rebuild := true) -> void:
	if rebuild:
		card.call("changed")
	else:
		ed.changed()
	render()
	_dirty = true
	card.get("parts").render()


# ---- clicks in the view

## A click in the view (the card asks first): a pin point, a node of the part, or the window of a loose object. True
## when it was taken.
func click(mouse: Vector2) -> bool:
	if card.get("pick").is_valid() or (card.get("crash") as Object).get("push_mode") or card.get("editing"):
		return false
	var hit: Dictionary = card.call("surface_at", mouse) if _car() != null else _model_hit(mouse)
	if mode != "":
		_place(hit)
		return true
	if hit.is_empty():
		if is_open():
			close()
		return false
	# with the shell shown a click near a node selects that node
	if card.get("shown") and card.call("soft") != null and int(card.call("node_at", mouse)) >= 0:
		return false
	var loose := loose_of(hit["node"])
	if loose == "":
		if is_open():
			close()
		return false
	open(loose)
	return true


## A click in the mode of pin points or of nodes: a pin point, or a node of the part, where the surface was hit.
func _place(hit: Dictionary) -> void:
	if mode == "pin":
		if not hit.is_empty():
			_add_pin(_local(hit["position"]))
	elif hit.is_empty() or not _within(source(hit["node"]), object()):
		ed.status("Click on the surface of %s to put a node there." % name)
	else:
		_add_node(_local(hit["position"]))


## The model of the editor under the mouse (no bench): { position, normal, node } or {}.
func _model_hit(mouse: Vector2) -> Dictionary:
	if ed.model_root == null:
		return {}
	return card.call("surface_at", mouse, ed.view.pivot)


static func _within(n: Node, o: Node) -> bool:
	while n != null:
		if n == o:
			return true
		n = n.get_parent()
	return false


func escape() -> bool:
	if mode != "":
		if mode == "nodes":
			_end_nodes()
		mode = ""
		render()
		_dirty = true
		return true
	return false


## The mouse moves over the view: the loose object under it is lit (once a frame, in frame()).
func hover(mouse: Vector2) -> void:
	_hover_at = mouse


func _light_up(object_name: String) -> void:
	if object_name == _lit_name:
		return
	for m in _lit:
		if is_instance_valid(m):
			(m as MeshInstance3D).material_overlay = null
	_lit.clear()
	_lit_name = object_name
	if object_name == "":
		return
	var c := _car()
	var root: Node3D = c.model_root if c != null else ed.model_root
	var o := root.find_child(object_name, true, false) as Node3D if root != null else null
	if o == null:
		return
	var list: Array = o.find_children("*", "MeshInstance3D", true, false)
	if o is MeshInstance3D:
		list.append(o)
	if c != null and c.shell_mesh != null:
		for bent in c.shell_mesh.source_of:
			if is_instance_valid(bent) and _within(c.shell_mesh.source_of[bent]["node"], o):
				list.append(bent)
	for m in list:
		(m as MeshInstance3D).material_overlay = _light
		_lit.append(m)


# ---- pins and nodes

func _add_pin(local: Vector3) -> void:
	var p := part()
	var pt := [_r(local.x), _r(local.y), _r(local.z)]
	var list := pins()
	list.append({"point": pt, "axes": {"x": true, "y": false, "z": false}, "min": -90, "max": 90})
	p["mounts"] = list
	if not (p.get("hinge") is Dictionary):
		p["hinge"] = {}
	p["hinge"]["origin"] = pt.duplicate()          # (the pin point is also the origin of the hinge)
	pin_sel = list.size() - 1
	mode = ""
	_changed()
	ed.status("Pin point %d at %s." % [list.size(), ", ".join(pt.map(func(x: float) -> String: return str(x)))], "ok")


func _add_node(local: Vector3) -> void:
	var lay: Variant = card.call("layout")
	if not lay is Array:
		return
	if (lay as Array).size() >= 2000:
		ed.status("A car can have 2000 nodes at most.", "error")
		return
	var e: Dictionary = card.call("layout_entry", local + card.call("com"), 0.1)
	e["part"] = name
	(lay as Array).append(e)
	_changed(false)
	ed.status("Node %d of %s added." % [(lay as Array).size() - 1, name], "ok")


func own_nodes() -> Array:
	var out := []
	var lay: Variant = card.call("layout")
	if lay is Array:
		for k in (lay as Array).size():
			if lay[k] is Dictionary and str(lay[k].get("part", "")) == name:
				out.append(k)
	return out


func _start_nodes() -> void:
	var s: SoftBody = card.call("soft")
	if s == null:
		card.call("restart_bench")
		s = card.call("soft")
	if s == null:
		ed.status("The car does not dent: tick “The car dents” first.", "error")
		return
	card.call("freeze")
	mode = "nodes"
	_fade(true)
	render()
	_dirty = true


func _end_nodes() -> void:
	_fade(false)
	mode = ""
	card.call("changed", true)
	if not card.get("shown"):
		card.call("restart_bench")
	render()
	_dirty = true


## While nodes are added the rest of the car is almost see-through (10 %), so the part can be seen and clicked.
func _fade(on: bool) -> void:
	for m in _faded:
		if is_instance_valid(m):
			(m as GeometryInstance3D).transparency = 0.0
	_faded.clear()
	var c := _car()
	if not on or c == null:
		return
	var o := object()
	for m in c.find_children("*", "MeshInstance3D", true, false):
		var mi := m as MeshInstance3D
		if _within(source(mi), o):
			continue
		mi.transparency = 0.9
		_faded.append(mi)


# ---- the window

func render() -> void:
	for ch in _body.get_children():
		ch.queue_free()
	if name == "":
		return
	_title.text = "Part: " + name
	var p := part()
	if card.call("is_locked"):
		_body.add_child(EditorStyle.hint("The shell, its dents and the loose parts belong to the car, not to a tune: every tune uses those of the car. " +
			"Choose Default (the car as made) to change them, and save the car.", Color("#f0d79a")))
	if p.is_empty():
		_body.add_child(EditorStyle.hint("Part not added to loose parts"))
		var r := EditorStyle.row(_body)
		var h := EditorStyle.button("Hinge part", "small accent", "A part that swings on pin points (a door, the hood) and can fall off")
		h.pressed.connect(_make_hinge)
		r.add_child(h)
		var b := EditorStyle.button("Breakable only", "small", "A part that bends with the body and falls off at a force (a mirror, a headlight, a plate)")
		b.pressed.connect(func():
			card.get("parts").list().append({"object": name, "mode": "detachable", "mass": 2, "break_force": 3000})
			_changed())
		r.add_child(b)
		_lock()
		return
	var top := EditorStyle.row(_body)
	var mass := _num(top, "Mass (kg)", float(p.get("mass", 10)), 0.5, "")
	mass.committed.connect(func(v: float):
		if v > 0.0 and v != float(p.get("mass", 10)):
			p["mass"] = v
			_changed())
	var rm := EditorStyle.button("Remove from loose parts", "small ghost")
	rm.size_flags_vertical = Control.SIZE_SHRINK_END
	rm.pressed.connect(_remove)
	top.add_child(rm)
	if str(p.get("mode", "")) in ["detachable", "breakable"]:
		_loose_section(p)
	else:
		_pin_section()
		_nodes_section()
	_lock()


func _lock() -> void:
	card.call("lock_tree", _body, card.call("is_locked"))


func _num(parent: Control, label: String, value: float, step: float, placeholder: String) -> EditorStyle.NumberField:
	var nf := EditorStyle.NumberField.new("", step, NAN, NAN, placeholder)
	nf.set_value(null if is_nan(value) else value)
	parent.add_child(EditorStyle.labelled(nf, label))
	return nf


func _make_hinge() -> void:
	# the hinge is at the origin of the object (its pivot in the model): a first pin point there, about X
	var o: Variant = card.get("parts").object_origin(name)
	var part_d := {"object": name, "mode": "hinge", "mass": 10, "hinge": {}, "mounts": []}
	if o != null:
		var pt := [_r(o.x), _r(o.y), _r(o.z)]
		part_d["hinge"] = {"origin": pt.duplicate()}
		part_d["mounts"] = [{"point": pt, "axes": {"x": true, "y": false, "z": false}, "min": -90, "max": 90}]
	card.get("parts").list().append(part_d)
	pin_sel = 0 if o != null else -1
	_changed()


func _remove() -> void:
	if not await ed.ask("Remove “%s” from the loose parts?" % name, "Its hinge, pins and strengths go.", "Remove"):
		return
	card.get("parts").list().erase(part())
	var lay: Variant = card.call("layout")
	if lay is Array:
		for n in lay:
			if n is Dictionary and str(n.get("part", "")) == name:
				n.erase("part")
	pin_sel = -1
	_changed()


## A part that is only breakable: no pins and no nodes of its own; it bends with the body and comes off at a force.
func _loose_section(p: Dictionary) -> void:
	var bf := _num(_body, "Breaks off at (kN)", float(p["break_force"]) / 1000.0 if p.has("break_force") else NAN, 0.5, "")
	card.call("force_slider", bf, "never")
	bf.committed.connect(func(v: float):
		if v > 0.0:
			p["break_force"] = v * 1000.0
		else:
			p.erase("break_force")
		_changed())
	var bd := _num(_body, "Delay (s)", float(p["break_delay"]) if p.has("break_delay") else NAN, 0.05, "0.15")
	bd.committed.connect(func(v: float):
		if v >= 0.0:
			p["break_delay"] = v
		else:
			p.erase("break_delay")
		_changed())
	_body.add_child(EditorStyle.hint("It bends with the body, and when the load on it passes this force it comes off and falls as a free object " +
		"(it hits the car, the road and the walls)."))
	_shatter_section(p)


## A part that shatters (car.json mode "breakable"): it breaks into pieces and particles at its force instead of falling
## off whole. The pieces are its faces (in clusters) or the pieces of the hidden object <name>_broken of the model.
func _shatter_section(p: Dictionary) -> void:
	var on := str(p.get("mode", "")) == "breakable"
	var sh: Dictionary = p["shatter"] if p.get("shatter") is Dictionary else {}
	var c := _car()
	var root: Node3D = c.model_root if c != null else ed.model_root
	var broken := root.find_child(name + "_broken", true, false) as Node3D if root != null else null
	var tick := CheckBox.new()
	tick.text = "Breakable: it shatters"
	tick.button_pressed = on
	tick.focus_mode = Control.FOCUS_NONE
	tick.toggled.connect(func(yes: bool):
		if yes:
			p["mode"] = "breakable"
			var s := {"pieces": "mesh" if broken != null else "faces", "particles": 120, "particle": "shards", "material": "glass"}
			s.merge(sh, true)
			p["shatter"] = s
		else:
			p["mode"] = "detachable"
			p.erase("shatter")
		_changed())
	_body.add_child(tick)
	if not on:
		return
	var put := func(key: String, value: Variant):
		var s: Dictionary = (p["shatter"] as Dictionary).duplicate() if p.get("shatter") is Dictionary else {}
		if value == null:
			s.erase(key)
		else:
			s[key] = value
		p["shatter"] = s
		_changed()
	var r1 := EditorStyle.row(_body)
	var pieces := EditorStyle.options([["faces", "Its faces (rigid pieces)"], ["mesh", "The mesh %s_broken" % name], ["none", "Particles only"]],
		str(sh.get("pieces", "faces")))
	pieces.item_selected.connect(func(_i: int): put.call("pieces", EditorStyle.value_of(pieces)))
	r1.add_child(EditorStyle.labelled(pieces, "Breaks into"))
	var most := _num(r1, "Pieces at most", float(sh["max_pieces"]) if sh.has("max_pieces") else NAN, 1.0, "40")
	most.committed.connect(func(v: float): put.call("max_pieces", roundi(v) if v > 0.0 else null))
	_body.add_child(EditorStyle.hint(("The model has %s_broken: it is not seen and not in the physics; its pieces are the pieces when it breaks." % name)
		if broken != null else ("The model has no %s_broken (a copy of the part cut into pieces, with that name): it breaks into its faces." % name)))
	var r2 := EditorStyle.row(_body)
	var count := _num(r2, "Particles", float(sh["particles"]) if sh.has("particles") else NAN, 10.0, "120")
	count.committed.connect(func(v: float): put.call("particles", roundi(v) if v >= 0.0 else null))
	var shape := EditorStyle.options(SHAPES, str(sh.get("particle", "shards")))
	shape.item_selected.connect(func(_i: int): put.call("particle", EditorStyle.value_of(shape)))
	r2.add_child(EditorStyle.labelled(shape, "Shape"))
	var size := _num(r2, "Size (mm)", roundf(float(sh["size"]) * 1000.0) if float(sh.get("size", 0)) > 0.0 else NAN, 1.0, "12")
	size.committed.connect(func(v: float): put.call("size", v / 1000.0 if v > 0.0 else null))
	var r3 := EditorStyle.row(_body)
	var mat := EditorStyle.options(PARTICLE_MATERIALS, "custom" if sh.has("colour") else str(sh.get("material", "glass")))
	r3.add_child(EditorStyle.labelled(mat, "Material of the particles"))
	var colour := ColorPickerButton.new()
	colour.color = Color(str(sh.get("colour", "#dceeff")))
	colour.disabled = not sh.has("colour")
	colour.custom_minimum_size = Vector2(60, 26)
	r3.add_child(EditorStyle.labelled(colour, "Colour"))
	mat.item_selected.connect(func(_i: int):
		var s: Dictionary = (p["shatter"] as Dictionary).duplicate() if p.get("shatter") is Dictionary else {}
		if EditorStyle.value_of(mat) == "custom":
			s["colour"] = "#" + colour.color.to_html(false)
			s.erase("material")
		else:
			s["material"] = EditorStyle.value_of(mat)
			s.erase("colour")
		p["shatter"] = s
		_changed())
	colour.color_changed.connect(func(cl: Color): put.call("colour", "#" + cl.to_html(false)))
	var r4 := EditorStyle.row(_body)
	var show := EditorStyle.button("Hide the broken mesh" if broken != null and broken.visible else "Show the broken mesh", "small")
	show.disabled = broken == null
	show.pressed.connect(func():
		if broken != null:
			broken.visible = not broken.visible
			show.text = "Hide the broken mesh" if broken.visible else "Show the broken mesh")
	r4.add_child(show)
	var now := EditorStyle.button("Break it now", "small accent", "Breaks it on the bench, as a hit would")
	now.pressed.connect(break_now)
	r4.add_child(now)


## Break it now: a new car on the bench from the form (with the part as it is set now), and the part breaks.
func break_now() -> String:
	card.call("restart_bench")
	await ed.get_tree().physics_frame
	await ed.get_tree().physics_frame
	var c := _car()
	var p: CarParts.Part = c.parts.part_named(name) if c != null and c.parts != null else null
	if p == null:
		ed.status("Start the bench first (the test of the car), with the part in it; damage has to be on (Settings, Driving).", "error")
		return "none"
	if not c.parts.break_loose(p):
		ed.status(name + " is broken already: ↺ and a new test put it back.")
		return p.state
	ed.status(name + " broke." if p.state == "broken" else name + " came off.", "ok")
	return p.state


func _pin_section() -> void:
	var head := EditorStyle.row(_body)
	head.add_child(EditorStyle.label("Pin points", 13, EditorStyle.TEXT, false))
	var add := EditorStyle.button("Cancel" if mode == "pin" else "+ add", "small" + (" accent" if mode == "pin" else ""))
	add.pressed.connect(func():
		mode = "" if mode == "pin" else "pin"
		render())
	head.add_child(add)
	if mode == "pin":
		_body.add_child(EditorStyle.hint("Click on the surface where the pin point goes (Esc cancels)."))
	var list := pins()
	if list.is_empty() and mode != "pin":
		_body.add_child(EditorStyle.hint("No pin points yet."))
	for i in list.size():
		if list[i] is Dictionary and (list[i] as Dictionary).get("point") is Array:
			_pin_box(list[i], i)


func _pin_box(pin: Dictionary, i: int) -> void:
	var box := PanelContainer.new()
	var st := EditorStyle.box(Color("#1c222a"), 8, 1, EditorStyle.ACCENT if i == pin_sel else EditorStyle.LINE)
	st.content_margin_left = 8
	st.content_margin_right = 8
	st.content_margin_top = 6
	st.content_margin_bottom = 6
	box.add_theme_stylebox_override("panel", st)
	box.gui_input.connect(func(e: InputEvent):
		if e is InputEventMouseButton and (e as InputEventMouseButton).pressed and pin_sel != i:
			pin_sel = i
			render()
			_dirty = true)
	_body.add_child(box)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 4)
	box.add_child(v)
	var h := HBoxContainer.new()
	v.add_child(h)
	var pt := _vec(pin["point"])
	var title := EditorStyle.label("Pin %d  %.2f, %.2f, %.2f" % [i + 1, pt.x, pt.y, pt.z], 12, EditorStyle.TEXT, false)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	h.add_child(title)
	var axes := axes_of(pin)
	for a in AXES:
		var b := EditorStyle.button(a.to_upper(), "small " + ("accent" if axes[a] else "ghost"), "The pin turns freely about its %s axis" % a)
		b.custom_minimum_size.x = 26
		b.pressed.connect(func():
			var now := axes_of(pin)
			now[a] = not now[a]
			pin["axes"] = now
			pin_sel = i
			_changed())
		h.add_child(b)
	var del := EditorStyle.button("✕", "small ghost", "Remove this pin point")
	del.pressed.connect(func():
		pins().remove_at(i)
		pin_sel = mini(pin_sel, pins().size() - 1)
		_changed())
	h.add_child(del)
	# the limits: every free axis has its own (it turns between its min and max from the rest place)
	var free := AXES.filter(func(k: String) -> bool: return axes[k])
	if free.is_empty():
		v.add_child(EditorStyle.hint("No free axis: the pin holds the part fast."))
	for a in free:
		var lim := limits_of(pin, a)
		var row := EditorStyle.row(v)
		for j in 2:
			var cell := VBoxContainer.new()
			cell.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			var l := EditorStyle.label("", 11, AXIS_COLOURS[a], false)
			cell.add_child(l)
			var s := HSlider.new()
			s.min_value = -180.0 if j == 0 else 0.0
			s.max_value = 0.0 if j == 0 else 180.0
			s.step = 1.0
			s.value = lim[j]
			s.focus_mode = Control.FOCUS_NONE
			s.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			l.text = "%s %s %d°" % [a.to_upper(), "min" if j == 0 else "max", roundi(lim[j])]
			s.value_changed.connect(func(x: float):
				var now := limits_of(pin, a)
				now[j] = x
				var lims: Dictionary = (pin["limits"] as Dictionary).duplicate() if pin.get("limits") is Dictionary else {}
				lims[a] = now
				pin["limits"] = lims
				if a == free[0]:
					pin["min"] = now[0]                 # (the pair of before: the first free axis)
					pin["max"] = now[1]
				l.text = "%s %s %d°" % [a.to_upper(), "min" if j == 0 else "max", roundi(x)]
				pin_sel = i
				_dirty = true
				ed.changed())
			s.drag_ended.connect(func(_c: bool): card.call("changed"))
			cell.add_child(s)
			row.add_child(cell)
	# the turn of the pin: three angles (X, then Y, then Z), and the gizmo in the view
	var rr := EditorStyle.row(v)
	var eul := euler_of(pin)
	var fields: Array = []
	for k in 3:
		var nf := _num(rr, "Rotation " + "xyz"[k] + " (°)", eul[k], 5.0, "0")
		fields.append(nf)
	for nf in fields:
		(nf as EditorStyle.NumberField).committed.connect(func(_x: float):
			var r := Vector3()
			for k in 3:
				var x: float = fields[k].value()
				r[k] = deg_to_rad(x if not is_nan(x) else 0.0)
			var q := Basis.from_euler(r, EULER_ORDER_XYZ).get_rotation_quaternion()
			var was: Variant = pin.get("rot")
			pin["rot"] = [_r(q.x, 0.00001), _r(q.y, 0.00001), _r(q.z, 0.00001), _r(q.w, 0.00001)]
			if str(was) != str(pin["rot"]):
				pin_sel = i
				_changed())
	var reset := EditorStyle.button("Reset", "small ghost", "The pin turned as the car")
	reset.size_flags_vertical = Control.SIZE_SHRINK_END
	reset.pressed.connect(func():
		pin.erase("rot")
		pin_sel = i
		_changed())
	rr.add_child(reset)
	var fr := EditorStyle.row(v)
	var act := _num(fr, "Opens at (kN)", float(pin["activate_force"]) / 1000.0 if float(pin.get("activate_force", 0)) > 0.0 else NAN, 1.0, "")
	card.call("force_slider", act, "the part stays shut")
	var brk := _num(fr, "Breaks off at (kN)", float(pin["break_force"]) / 1000.0 if float(pin.get("break_force", 0)) > 0.0 else NAN, 10.0, "")
	card.call("force_slider", brk, "never")
	var warn := EditorStyle.hint("", Color("#f0b83a"))
	v.add_child(warn)
	warn.text = _warning(pin)
	warn.visible = warn.text != ""
	for pair in [[act, "activate_force"], [brk, "break_force"]]:
		(pair[0] as EditorStyle.NumberField).committed.connect(func(x: float):
			var key: String = pair[1]
			var old := float(pin.get(key, 0))
			if x > 0.0:
				pin[key] = x * 1000.0
			else:
				pin.erase(key)
			if old != float(pin.get(key, 0)):
				pin_sel = i
				_changed())


## What does not fit: a break force under the force that opens it, or a part that lies outside its limits.
static func _warning(pin: Dictionary) -> String:
	var msgs := []
	var act := float(pin.get("activate_force", 0))
	var brk := float(pin.get("break_force", 0))
	if act > 0.0 and brk > 0.0 and brk <= act:
		msgs.append("Breaks off should be higher than opens at, or the part never swings: it falls off at once.")
	var free := AXES.filter(func(k: String) -> bool: return axes_of(pin)[k])
	var lim := limits_of(pin, free[0]) if free.size() == 1 else [-180.0, 180.0]
	var lie := -rad_to_deg(twist_of(pin))
	if pin.get("rot") is Array and (lie < lim[0] - 0.5 or lie > lim[1] + 0.5):
		msgs.append("The part lies at %d° from the zero of the pin, outside min and max: it is pushed into the range at the start." % roundi(lie))
	return " ".join(msgs)


func _nodes_section() -> void:
	var own := own_nodes()
	var head := EditorStyle.row(_body)
	head.add_child(EditorStyle.label("Deformation nodes", 13, EditorStyle.TEXT, false))
	var b := EditorStyle.button("Stop adding nodes" if mode == "nodes" else "Add nodes", "small" + (" accent" if mode == "nodes" else ""))
	b.pressed.connect(func():
		if mode == "nodes":
			_end_nodes()
		else:
			_start_nodes())
	head.add_child(b)
	if mode == "nodes":
		_body.add_child(EditorStyle.hint("Click on the surface of %s to add nodes: the part bends with them. Esc or the button stops." % name))
	if own.is_empty():
		_body.add_child(EditorStyle.hint("No nodes added yet: the part does not bend, it is one stiff piece."))
		return
	var edits := {}
	var sbd: Dictionary = card.call("softbody")
	for e in sbd.get("nodes", []) if sbd.get("nodes") is Array else []:
		if e is Dictionary:
			edits[int(e.get("i", -1))] = e
	var first: Variant = edits.get(own[0])
	var same: bool = first != null and own.all(func(k: int) -> bool: return edits.has(k) and edits[k].get("yield_force") == first.get("yield_force"))
	var strength := _num(_body, "Strength of all nodes (kN): how much force they take before they bend",
		float(first["yield_force"]) / 1000.0 if same else NAN, 10.0, "")
	strength.committed.connect(func(v: float):
		if not (v > 0.0):
			return
		# the node bends at the strength and tears at two and a half times
		var list: Array = (sbd["nodes"] as Array).filter(func(e: Variant) -> bool: return not (e is Dictionary and own.has(int(e.get("i", -1))))) \
			if sbd.get("nodes") is Array else []
		for k in own:
			list.append({"i": k, "yield_force": v * 1000.0, "break_force": v * 2500.0})
		sbd["nodes"] = list
		_changed())
	var flow := HFlowContainer.new()
	_body.add_child(flow)
	for k in own:
		var cell := HBoxContainer.new()
		cell.add_child(EditorStyle.label("node %d" % k, 11, EditorStyle.MUTED, false))
		var x := EditorStyle.button("✕", "small ghost", "Remove this node")
		x.pressed.connect(func():
			card.call("remove_nodes", [k])
			render()
			_dirty = true)
		cell.add_child(x)
		flow.add_child(cell)


# ---- what the window shows in the view

func frame(_dt: float) -> void:
	var c := _car()
	_group.global_transform = c.global_transform if c != null else Transform3D.IDENTITY
	if _hover_at != Vector2.INF:
		var at := _hover_at
		_hover_at = Vector2.INF
		var hit: Dictionary = card.call("surface_at", at) if c != null else _model_hit(at)
		var under := loose_of(hit["node"]) if not hit.is_empty() else ""
		_light_up(name if mode == "nodes" and name != "" else (under if under != "" else name))
	elif _lit_name != name and (_hover_gone or ed.driver_editing() or (ed.bench.car != null and not ed.bench.parked)):
		_light_up(name)              # (what is under a mouse that stands still stays lit: it goes when the mouse leaves the view)
	_hover_gone = false
	if _dirty:
		_dirty = false
		_draw()


func _draw() -> void:
	_lines.clear_surfaces()
	_tris.clear_surfaces()
	for b in _balls.get_children():
		b.queue_free()
	var c := _car()
	if name == "" or c == null:
		if ed.view.gizmo.target == _pivot:
			ed.view.gizmo.detach()
		return
	var com: Vector3 = card.call("com")
	var line_pts := PackedVector3Array()
	var line_cols := PackedColorArray()
	var tri_pts := PackedVector3Array()
	var tri_cols := PackedColorArray()
	var o := object()
	var centre: Variant = null
	if o != null:
		centre = c.global_transform.affine_inverse() * _box(o).get_center()
	var list := pins()
	for i in list.size():
		var pin: Variant = list[i]
		if not (pin is Dictionary) or not (pin as Dictionary).get("point") is Array:
			continue
		var at := _vec(pin["point"]) + com
		var ball := MeshInstance3D.new()
		var sm := SphereMesh.new()
		sm.radius = 0.04 if i == pin_sel else 0.028
		sm.height = sm.radius * 2.0
		ball.mesh = sm
		ball.material_override = CarEditorView.flat_material(ORANGE, true)
		ball.layers = CarEditorView.MARKER_LAYER
		ball.position = at
		_balls.add_child(ball)
		if i != pin_sel or mode == "nodes":
			continue
		var q := _quat(pin)
		var axes := axes_of(pin)
		var single := AXES.filter(func(k: String) -> bool: return axes[k]).size() == 1
		for a in AXES:
			if not axes[a]:
				continue
			var axis := {"x": Vector3.RIGHT, "y": Vector3.UP, "z": Vector3.BACK}[a] as Vector3
			var u := {"x": Vector3.UP, "y": Vector3.BACK, "z": Vector3.RIGHT}[a] as Vector3
			# the fan is swept from the way the part lies from the pin, so it shows where the part goes
			if centre != null:
				var d_world: Vector3 = centre - at
				var d: Vector3
				if single and pin.get("rot") is Array:
					var dot := q.x * axis.x + q.y * axis.y + q.z * axis.z
					var twist := Quaternion(axis.x * dot, axis.y * dot, axis.z * dot, q.w).normalized()
					var swing := q * twist.inverse()
					d = swing.inverse() * d_world
				else:
					d = q.inverse() * d_world
				d -= axis * d.dot(axis)
				if d.length() > 0.02:
					u = d.normalized()
				if single:
					var lie := q.inverse() * d_world
					lie -= axis * lie.dot(axis)
					if lie.length() > 0.02:
						_seg(line_pts, line_cols, at, at + q * (lie.normalized() * 0.34), Color("#ffe14d"))
			var v := axis.cross(u)
			_seg(line_pts, line_cols, at + q * (axis * -0.35), at + q * (axis * 0.35), AXIS_COLOURS[a])
			var lim := limits_of(pin, a)
			var lo := deg_to_rad(lim[0])
			var hi := deg_to_rad(lim[1])
			var steps := maxi(2, ceili((hi - lo) / (PI / 36.0)))
			var arc: Array[Vector3] = []
			for k in steps + 1:
				var t := lo + (hi - lo) * k / steps
				arc.append(at + q * (u * cos(t) * 0.3 + v * sin(t) * 0.3))
			var fan := Color(AXIS_COLOURS[a], 0.28)
			for k in arc.size() - 1:
				tri_pts.append_array([at, arc[k], arc[k + 1]])
				tri_cols.append_array([fan, fan, fan])
			_seg(line_pts, line_cols, at, arc[0], AXIS_COLOURS[a])
			for k in arc.size() - 1:
				_seg(line_pts, line_cols, arc[k], arc[k + 1], AXIS_COLOURS[a])
			_seg(line_pts, line_cols, arc[arc.size() - 1], at, AXIS_COLOURS[a])
			_seg(line_pts, line_cols, at, at + q * (u * 0.33), Color.WHITE)      # the rest place: the angle 0
	# the nodes of the part
	var lay: Variant = card.call("layout")
	if lay is Array:
		for n in lay:
			if n is Dictionary and str(n.get("part", "")) == name:
				var p: Vector3 = card.call("layout_point", n)
				for d in [Vector3(0.02, 0, 0), Vector3(0, 0.02, 0), Vector3(0, 0, 0.02)]:
					_seg(line_pts, line_cols, p - d, p + d, Color("#ffb040"))
	_flush(_lines, Mesh.PRIMITIVE_LINES, line_pts, line_cols)
	_flush(_tris, Mesh.PRIMITIVE_TRIANGLES, tri_pts, tri_cols)
	# the pivot that the turn gizmo holds: at the chosen pin, turned as it is
	var now: Variant = list[pin_sel] if pin_sel >= 0 and pin_sel < list.size() else null
	if now is Dictionary and mode != "nodes" and not card.call("is_locked"):
		if not ed.view.gizmo.dragging:
			_pivot.transform = Transform3D(Basis(_quat(now)), _vec(now["point"]) + com)
		if ed.view.gizmo.target != _pivot:
			ed.view.gizmo.attach(_pivot, "rotate")
	elif ed.view.gizmo.target == _pivot:
		ed.view.gizmo.detach()


static func _seg(pts: PackedVector3Array, cols: PackedColorArray, a: Vector3, b: Vector3, c: Color) -> void:
	pts.append(a)
	pts.append(b)
	cols.append(c)
	cols.append(c)


static func _flush(im: ImmediateMesh, kind: Mesh.PrimitiveType, pts: PackedVector3Array, cols: PackedColorArray) -> void:
	if pts.is_empty():
		return
	im.surface_begin(kind)
	for i in pts.size():
		im.surface_set_color(cols[i])
		im.surface_add_vertex(pts[i])
	im.surface_end()


## The turn gizmo of the chosen pin: its turn is the turn of the pin (rot), drawn as it moves, saved when it lets go.
func _gizmo_moved() -> void:
	if ed.view.gizmo.target != _pivot:
		return
	var list := pins()
	if pin_sel < 0 or pin_sel >= list.size():
		return
	var q := _pivot.transform.basis.get_rotation_quaternion()
	list[pin_sel]["rot"] = [_r(q.x, 0.00001), _r(q.y, 0.00001), _r(q.z, 0.00001), _r(q.w, 0.00001)]
	_dirty = true


func _gizmo_ended() -> void:
	if ed.view.gizmo.target == _pivot:
		_changed()
