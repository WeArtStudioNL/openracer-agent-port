class_name TrackEditorPanels
extends RefCounted
## The panels over the view of the track editor (track-editor.html #view): the bar of the tools at the bottom (only the tool in use
## and Done while one is used), the bar at the top right (Save, the reference, the colours of the surfaces, Snap, From above, undo,
## redo, Layers, ?), the hint of the tool at the top, the Layers panel, the panel of what is chosen with its numbers, the window of
## the drag strip, the drawer of the road designer (Track, Branches, Surfaces, Prefabs), the coordinates under the pointer and the
## list of the keys.

const MODES := [["view", "Look", "1"], ["grid", "Grid box", "2"], ["pitbox", "Pit box", "3"], ["pitline", "Pit line", "4"], ["gate", "Add gate", "5"],
	["drag", "Drag strip", "6"], ["object", "Place object", "7"], ["camera", "Add camera", "8"], ["curb", "Draw curb", "9"], ["measure", "Measure", "0"],
	["node", "Edit road", "N"], ["branch", "Branch", "B"], ["patch", "Surfaces", "G"], ["prefab", "Prefabs", "P"]]
const HINTS := {
	"grid": "Grid box: click on the road and drag in the direction that the car drives. Box 1 is the start of the player.",
	"pitbox": "Pit box: click on the road where the box is and drag in the direction that the car faces.",
	"pitline": "Pit line: click on the road, point after point, in the order that a car drives through the pit lane.",
	"gate": "Add gate: click on the road and drag in the direction that the car drives. The first gate is the finish line.",
	"drag": "Drag strip: click on the road where the start line is and drag in the direction of the strip.",
	"object": "Place object: press on the road and drag to say which way it faces. Escape goes back to Look.",
	"camera": "Add camera: click on the track where the camera stands.",
	"curb": "Draw curb: click on the road to start a curb, every next click adds a node at the nearest end; Enter ends it.",
	"node": "Nodes: click on the ground to add one between the two nearest nodes, drag a node to move it, the arrow above it for its height.",
	"branch": "Branch: click on the track where the new road starts, then its nodes, and click on a road where it ends (Enter: a free end).",
	"patch": "Surfaces: click the corners of an area, click the first corner or press Enter to close it.",
	"refscale": "Scale by two points: click two places on the picture whose distance you know.",
}
const KEYS := [["1 … 9, 0", "Look, Grid box, Pit box, Pit line, Add gate, Drag strip, Place object, Add camera, Draw curb, Measure"],
	["N, B, G, P", "Edit road, Branch, Surfaces, Prefabs (a road drawn with nodes)"], ["Click", "Choose what is under the pointer (in Look)"],
	["Handles", "The middle moves the chosen thing, the ring turns it, the square scales it, the arrow lifts a node of the road"],
	["Delete", "Take the chosen thing away"], ["Ctrl+Z, Ctrl+Y", "Undo, redo (all of the track; Ctrl+Shift+Z redoes too)"],
	["Ctrl+D", "Copy the chosen object, gate, curb or prefab"], ["Ctrl+S", "Save the track"],
	["Escape", "One step back: the curb that is drawn, what is chosen, then the tool"], ["Enter", "End the curb, the area, the branch or the row that is drawn"],
	["Shift + click", "Add a node to the racing line that is edited"], ["F", "Bring the chosen thing into view (nothing chosen: the whole track)"],
	["T", "From above"], ["End", "Put the chosen object, gate or box on the surface under it"], ["Mouse", "Left drag turns, right drag moves, the wheel zooms"],
	["?", "This list"]]


static func _panel(ed: TrackEditor) -> PanelContainer:
	var p := PanelContainer.new()
	p.mouse_filter = Control.MOUSE_FILTER_STOP
	(ed.ui["viewui"] as Control).add_child(p)
	return p


static func build(ed: TrackEditor) -> void:
	var vu := Control.new()
	vu.mouse_filter = Control.MOUSE_FILTER_IGNORE
	vu.set_anchors_preset(Control.PRESET_FULL_RECT)
	ed.view_box.add_child(vu)
	ed.ui["viewui"] = vu
	var kit := TrackEditorUI
	# the hint of the tool
	var hint := kit.label("", false, 13)
	hint.position = Vector2(16, 62)
	hint.size = Vector2(620, 40)
	hint.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.8))
	hint.add_theme_constant_override("outline_size", 3)
	hint.mouse_filter = Control.MOUSE_FILTER_IGNORE
	vu.add_child(hint)
	ed.ui["hint"] = hint
	# the bar at the top right
	var top := kit.hbox([])
	top.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	top.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	top.position = Vector2(-16, 12)
	vu.add_child(top)
	top.add_child(kit.button("Save", func(): TrackEditorIO.save(ed), "Save the track (Ctrl+S)", true))
	ed.ui["refQuick"] = kit.check("reference", true, func(on: bool):
		if not ed.reference.is_empty():
			ed.reference["show"] = on
			TrackEditorIO.place_reference(ed)
			ed.refresh())
	top.add_child(ed.ui["refQuick"])
	top.add_child(kit.check("colours of the surfaces", true, func(on: bool):
		ed.colours = on
		ed.parts_kit.apply_colours(), "Show the surfaces in their own colours"))
	var snap := kit.button("⌗ Snap off", func(): pass, "Snap: what is placed or dragged goes to a grid of 1, 2 or 5 metres")
	snap.pressed.connect(func():
		ed.snap = TrackEditor.SNAP_STEPS[(TrackEditor.SNAP_STEPS.find(ed.snap) + 1) % TrackEditor.SNAP_STEPS.size()]
		snap.text = "⌗ Snap %d m" % roundi(ed.snap) if ed.snap > 0.0 else "⌗ Snap off")
	top.add_child(snap)
	top.add_child(kit.button("From above", ed.parts_kit.top_view, "T"))
	ed.ui["undo"] = kit.button("Undo", ed.history.undo, "Undo (Ctrl+Z)")
	ed.ui["redo"] = kit.button("Redo", ed.history.redo, "Redo (Ctrl+Y)")
	top.add_child(ed.ui["undo"])
	top.add_child(ed.ui["redo"])
	top.add_child(kit.button("Layers", func():
		ed.ui["layers"].visible = not ed.ui["layers"].visible, "The list of everything in the track"))
	top.add_child(kit.button("?", func(): TrackEditorUI.toggle_help(ed), "The keys (?)"))
	_modes(ed)
	_layers(ed)
	_props(ed)
	_drag_window(ed)
	_drawer(ed)
	_help(ed)
	var coords := kit.label("", true, 12)
	coords.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	coords.position = Vector2(14, -28)
	coords.mouse_filter = Control.MOUSE_FILTER_IGNORE
	vu.add_child(coords)
	ed.ui["coords"] = coords


static func _modes(ed: TrackEditor) -> void:
	var bar := _panel(ed)
	bar.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	bar.grow_horizontal = Control.GROW_DIRECTION_BOTH
	bar.grow_vertical = Control.GROW_DIRECTION_BEGIN
	bar.position.y = -14
	var row := TrackEditorUI.hbox([], 4)
	bar.add_child(row)
	ed.ui["modes"] = bar
	ed.ui["modeButtons"] = {}
	for m in MODES:
		var b := TrackEditorUI.button(m[1], func(): ed.set_mode(m[0]), "Key " + m[2])
		b.toggle_mode = true
		row.add_child(b)
		ed.ui["modeButtons"][m[0]] = b
	for s in [["draw", "Draw", "A row is made by dragging a line on the ground"], ["points", "Points", "A row is made by clicking its points (Enter ends it)"]]:
		var b := TrackEditorUI.button(s[1], func():
			if ed.drawing.get("kind", "") == "rowdraft":
				ed.road.finish_drawing()
			ed.prefab_style = s[0]
			ed.refresh(), s[2])
		b.toggle_mode = true
		row.add_child(b)
		ed.ui["style_" + s[0]] = b
	ed.ui["attach"] = TrackEditorUI.check("Attach to road", false, func(on: bool): ed.prefab_attach = on,
		"A new row lies along the edge of the road and follows it")
	row.add_child(ed.ui["attach"])
	ed.ui["done"] = TrackEditorUI.button("✓ Done", func():
		if ed.mode == "curb":
			ed.curbs_kit.end_curb_draw()
		if not ed.drawing.is_empty():
			ed.road.finish_drawing()
		ed.select("")
		ed.set_mode("view"), "Escape")
	row.add_child(ed.ui["done"])


static func _layers(ed: TrackEditor) -> void:
	var p := _panel(ed)
	p.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	p.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	p.grow_vertical = Control.GROW_DIRECTION_BEGIN
	p.position = Vector2(-16, -76)
	p.custom_minimum_size = Vector2(250, 0)
	p.visible = false
	ed.ui["layers"] = p
	var scroll := ScrollContainer.new()
	scroll.custom_minimum_size = Vector2(240, 360)
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	p.add_child(scroll)
	var v := VBoxContainer.new()
	v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(v)
	v.add_child(TrackEditorUI.label("Layers", false, 14))
	for s in [["Events", "layEvents"], ["Objects", "layObjects"], ["Gates", "layGates"], ["Curbs", "layCurbs"], ["Surfaces", "laySurfaces"], ["Grid", "layGrid"],
			["Pit boxes", "layPit"], ["Cameras", "layCameras"]]:
		var head := TrackEditorUI.label(str(s[0]).to_upper(), true, 11)
		v.add_child(head)
		var box := VBoxContainer.new()
		box.add_theme_constant_override("separation", 0)
		v.add_child(box)
		ed.ui[s[1]] = box


static func _props(ed: TrackEditor) -> void:
	var p := _panel(ed)
	p.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	p.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	p.position = Vector2(-16, 64)
	p.custom_minimum_size = Vector2(250, 0)
	p.visible = false
	ed.ui["props"] = p
	var v := VBoxContainer.new()
	p.add_child(v)
	ed.ui["propsBox"] = v


static func _drag_window(ed: TrackEditor) -> void:
	var p := _panel(ed)
	p.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	p.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	p.position = Vector2(-280, 64)
	p.custom_minimum_size = Vector2(270, 0)
	p.visible = false
	ed.ui["dragWindow"] = p
	var v := VBoxContainer.new()
	p.add_child(v)
	var kit := TrackEditorUI
	var close := kit.button("×", func(): ed.set_mode("view"), "Close")
	var title := kit.label("Drag strip", false, 14)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	v.add_child(kit.hbox([title, close]))
	v.add_child(kit.label("Click on the road where the start line is and drag in the direction of the strip. The finish line is that far from it.", true, 12))
	var changed := func() -> void:
		if not ed.drag.is_empty() and not ed.has_meta("filling"):
			ed.drag["length"] = TrackEditorUI.drag_length(ed)
			ed.drag["width"] = TrackEditorUI.drag_width(ed)
			ed.changed()
		ed.ui["dragOwnRow"].visible = ed.ui["dragLength"].selected == 6
	ed.ui["dragLength"] = kit.options(["1/8 mile (201 m)", "1000 feet (305 m)", "1/4 mile (402 m)", "1/2 mile (805 m)", "1 kilometre", "1 mile (1609 m)", "Own length…"], 2,
		func(_i: int): changed.call())
	v.add_child(kit.field("Distance", ed.ui["dragLength"]))
	ed.ui["dragOwn"] = kit.number(500, 50, 5000, 1, func(_x: float): changed.call())
	ed.ui["dragOwnRow"] = kit.field("Length (m)", ed.ui["dragOwn"])
	ed.ui["dragOwnRow"].visible = false
	v.add_child(ed.ui["dragOwnRow"])
	ed.ui["dragWidth"] = kit.number(12, 3, 200, 1, func(_x: float): changed.call())
	v.add_child(kit.field("Width of the strip (m)", ed.ui["dragWidth"]))
	ed.ui["dragInfo"] = kit.label("", true, 12)
	v.add_child(ed.ui["dragInfo"])
	v.add_child(kit.button("Remove the drag strip", func():
		ed.drag = {}
		ed.changed()))


static func _drawer(ed: TrackEditor) -> void:
	var kit := TrackEditorUI
	var panel := _panel(ed)
	panel.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	panel.grow_vertical = Control.GROW_DIRECTION_BEGIN
	panel.position = Vector2(16, -80)
	panel.custom_minimum_size = Vector2(560, 0)
	panel.visible = false
	ed.ui["drawer"] = panel
	var v := VBoxContainer.new()
	panel.add_child(v)
	var tabs := kit.hbox([], 4)
	for t in [["track", "Track", "node"], ["branches", "Branches", "branch"], ["patches", "Surfaces", "patch"], ["prefabs", "Prefabs", "prefab"]]:
		var b := kit.button(t[1], func(): ed.set_mode(t[2]))
		b.toggle_mode = true
		ed.ui["tab_" + t[0]] = b
		tabs.add_child(b)
	ed.ui["dsInfo"] = kit.label("", true, 12)
	ed.ui["dsInfo"].size_flags_horizontal = Control.SIZE_EXPAND_FILL
	tabs.add_child(ed.ui["dsInfo"])
	v.add_child(tabs)
	var design := func() -> Dictionary: return ed.design.data if ed.design != null else {}
	# Track: the width of all, closed, the textures, the height and width of the chosen node
	var track := VBoxContainer.new()
	ed.ui["page_track"] = track
	ed.ui["dsWidth"] = kit.number(12, 3, 100, 1, func(w: float):
		if ed.design == null or ed.has_meta("filling"):
			return
		for n in design.call()["nodes"]:
			n["width"] = maxf(3.0, w)
		ed.rebuild_design(true)
		ed.changed())
	ed.ui["dsClosed"] = kit.check("closed loop", true, func(on: bool):
		if ed.design != null and not ed.has_meta("filling"):
			design.call()["closed"] = on
			ed.rebuild_design(true)
			ed.changed())
	var tex := []
	for what in ["road", "shoulder", "ground"]:
		var choices: Array = DesignPrefabs.TEXTURE_CHOICES[what]
		var o := kit.options(choices.map(func(c: String) -> String: return MeshKit.TEXTURES[c]["label"]), 0, func(i: int):
			if ed.design != null and not ed.has_meta("filling"):
				design.call()["textures"][what] = choices[i]
				ed.rebuild_design(true)
				ed.changed())
		ed.ui["dsTex" + what] = o
		tex.append(kit.field({"road": "Road", "shoulder": "Beside it", "ground": "Ground"}[what], o))
	track.add_child(kit.hbox([kit.field("Width of all (m)", ed.ui["dsWidth"]), ed.ui["dsClosed"], kit.button("Add nodes", func(): ed.set_mode("node")),
		kit.button("Flatten", func():
			for n in design.call()["nodes"]:
				n["y"] = 0
			ed.rebuild_design(true)
			ed.changed())]))
	track.add_child(kit.hbox(tex))
	var node_box := kit.hbox([])
	ed.ui["dsNodeBox"] = node_box
	ed.ui["dsHeight"] = kit.number(0, -1000, 1000, 0.5, func(y: float): _node_field(ed, "y", y))
	ed.ui["dsNodeWidth"] = kit.number(12, 3, 100, 1, func(w: float): _node_field(ed, "width", maxf(3.0, w)))
	node_box.add_child(kit.field("Height (m)", ed.ui["dsHeight"]))
	node_box.add_child(kit.field("Width here (m)", ed.ui["dsNodeWidth"]))
	node_box.add_child(kit.button("Delete node", func(): ed.road.delete_node()))
	track.add_child(node_box)
	track.add_child(kit.label("Click on the ground to add a node between the two nodes it is nearest to; drag a node to move it, and its arrow up or down for " +
		"hills.", true, 12))
	v.add_child(track)
	# Branches
	var br := VBoxContainer.new()
	ed.ui["page_branches"] = br
	ed.ui["dsBranchWidth"] = kit.number(8, 2, 60, 1, func(w: float):
		if ed.sel["kind"] == "branch" and not ed.has_meta("filling"):
			design.call()["branches"][ed.sel["i"]]["width"] = maxf(2.0, w)
			ed.rebuild_design(true)
			ed.changed())
	ed.ui["dsBranchNodeWidth"] = kit.number(8, 0, 60, 1, func(w: float):
		if ed.sel["kind"] == "branch" and ed.sel["node"] >= 0 and not ed.has_meta("filling"):
			var n: Dictionary = design.call()["branches"][ed.sel["i"]]["nodes"][ed.sel["node"]]
			if w >= 2.0:
				n["width"] = w
			else:
				n.erase("width")
			ed.rebuild_design(true)
			ed.changed())
	br.add_child(kit.hbox([kit.field("Width (m)", ed.ui["dsBranchWidth"]), kit.field("Width at the node (0: like the branch)", ed.ui["dsBranchNodeWidth"]),
		kit.button("Delete node", func():
			if ed.sel["kind"] == "branch":
				ed.road.delete_extra_point()), kit.button("Delete branch", func():
			if ed.sel["kind"] == "branch":
				ed.sel["node"] = -1
				ed.road.delete_extra_point())]))
	br.add_child(kit.label("A road of its own that joins the track: a pit lane, a side road. Click on the track where it starts, then on the ground for its nodes, " +
		"and on a road where it joins it again (Enter ends it free). Drag a node to move it.", true, 12))
	v.add_child(br)
	# Surfaces
	var pa := VBoxContainer.new()
	ed.ui["page_patches"] = pa
	var keys := TrackDesign.PATCH_SURFACES.keys()
	ed.ui["dsPatchSurface"] = kit.options(keys.map(func(k: String) -> String: return TrackDesign.PATCH_SURFACES[k]["label"]), keys.find("gravel"), func(i: int):
		ed.patch_surface = keys[i]
		if ed.sel["kind"] == "patch" and not ed.has_meta("filling"):
			design.call()["patches"][ed.sel["i"]]["surface"] = keys[i]
			ed.design.build_patches()
			ed.parts_kit.design_parts_changed()
			ed.changed())
	ed.ui["dsPatchConnect"] = kit.check("Connect to road", false, func(on: bool):
		ed.patch_connect = on
		if ed.sel["kind"] == "patch" and not ed.has_meta("filling"):
			var patch: Dictionary = design.call()["patches"][ed.sel["i"]]
			if on:
				patch["connect"] = true
			else:
				patch.erase("connect")
			ed.design.build_patches()
			ed.parts_kit.design_parts_changed()
			ed.changed())
	pa.add_child(kit.hbox([kit.field("Surface", ed.ui["dsPatchSurface"]), ed.ui["dsPatchConnect"], kit.button("Delete corner", func():
		if ed.sel["kind"] == "patch":
			ed.road.delete_extra_point()), kit.button("Delete area", func():
		if ed.sel["kind"] == "patch":
			ed.sel["node"] = -1
			ed.road.delete_extra_point())]))
	pa.add_child(kit.label("An area of road, gravel, sand, grass or dirt on the ground: click its corners, and the first corner again (or Enter) to close it. With " +
		"Connect to road a line along the road is enough.", true, 12))
	v.add_child(pa)
	# Prefabs
	var pr := VBoxContainer.new()
	ed.ui["page_prefabs"] = pr
	var pal := HFlowContainer.new()
	ed.ui["palette"] = pal
	for type in DesignPrefabs.LIST:
		var b := kit.button("%s %s" % [DesignPrefabs.INFO[type]["icon"], DesignPrefabs.INFO[type]["label"]], func():
			ed.prefab_type = type
			ed.set_mode("prefab"))
		b.toggle_mode = true
		pal.add_child(b)
		ed.ui["pal_" + type] = b
	pr.add_child(pal)
	var sel_box := kit.hbox([])
	ed.ui["dsPrefabBox"] = sel_box
	ed.ui["dsPrefabName"] = kit.label("", false, 12)
	ed.ui["dsPrefabRotation"] = kit.number(0, -360, 360, 15, func(d: float): _prefab_field(ed, "rotation", deg_to_rad(d)))
	ed.ui["dsPrefabSpacing"] = kit.number(4, 0.3, 100, 0.5, func(s: float): _prefab_field(ed, "spacing", maxf(0.3, s)))
	ed.ui["dsPrefabScale"] = kit.number(1, 0.1, 20, 0.1, func(s: float): _prefab_field(ed, "scale", maxf(0.1, s)))
	ed.ui["dsPrefabTexture"] = kit.options([], 0, func(i: int):
		var p := _prefab(ed)
		var choices: Array = DesignPrefabs.TEXTURE_CHOICES.get(p.get("type", ""), [])
		if i < choices.size():
			_prefab_field(ed, "texture", choices[i]))
	ed.ui["dsRowOffset"] = kit.number(0, -6, 6, 0.1, func(o: float):
		var p := _prefab(ed)
		if p.is_empty() or not p.get("attach", false) or ed.has_meta("filling"):
			return
		if ed.sel["node"] >= 0:
			p["points"][ed.sel["node"]]["offset"] = o
		else:
			p["offset"] = o
			for q in p["points"]:
				q.erase("offset")
		ed.road.refresh_prefabs()
		ed.changed())
	ed.ui["dsRowAttach"] = kit.check("Attach to road", false, func(on: bool):
		var p := _prefab(ed)
		if p.is_empty() or not p.get("row", false) or ed.has_meta("filling"):
			return
		if on:
			p["attach"] = true
			for q in p["points"]:
				ed.design.start_node_offset(q)
		else:
			p.erase("attach")
			p.erase("offset")
			for q in p["points"]:
				q.erase("offset")
		ed.road.refresh_prefabs()
		ed.changed())
	ed.ui["dsRotBox"] = kit.field("Rotation (°)", ed.ui["dsPrefabRotation"])
	ed.ui["dsSpacingBox"] = kit.field("Spacing (m)", ed.ui["dsPrefabSpacing"])
	ed.ui["dsTexBox"] = kit.field("Texture", ed.ui["dsPrefabTexture"])
	ed.ui["dsOffsetBox"] = kit.field("Offset (m)", ed.ui["dsRowOffset"])
	for c in [kit.field("Selected", ed.ui["dsPrefabName"]), ed.ui["dsRotBox"], ed.ui["dsSpacingBox"], kit.field("Scale", ed.ui["dsPrefabScale"]), ed.ui["dsTexBox"],
			ed.ui["dsOffsetBox"], ed.ui["dsRowAttach"]]:
		sel_box.add_child(c)
	pr.add_child(sel_box)
	pr.add_child(kit.hbox([kit.button("Duplicate", func():
		if ed.sel["kind"] == "prefab":
			ed.road.duplicate_prefab()
			ed.changed(), "Ctrl+D"), kit.button("Delete", func():
		if ed.sel["kind"] == "prefab":
			ed.road.delete_prefab()
			ed.changed(), "Delete")]))
	pr.add_child(kit.label("Pick a prefab: a click on the ground puts one down, a dragged line (Draw) or a line of clicked points (Points) makes a row of them that " +
		"follows the line. A chosen row: click on its line to add a node, drag its nodes.", true, 12))
	v.add_child(pr)


static func _node_field(ed: TrackEditor, key: String, v: float) -> void:
	if ed.sel["kind"] != "dnode" or ed.has_meta("filling"):
		return
	ed.design.data["nodes"][ed.sel["i"]][key] = v
	ed.rebuild_design(true)
	ed.changed()


static func _prefab(ed: TrackEditor) -> Dictionary:
	if ed.design == null or ed.sel["kind"] != "prefab" or ed.sel["i"] >= (ed.design.data["prefabs"] as Array).size():
		return {}
	return ed.design.data["prefabs"][ed.sel["i"]]


static func _prefab_field(ed: TrackEditor, key: String, v: Variant) -> void:
	var p := _prefab(ed)
	if p.is_empty() or ed.has_meta("filling"):
		return
	p[key] = v
	ed.road.refresh_prefabs()
	ed.changed()


static func _help(ed: TrackEditor) -> void:
	var p := _panel(ed)
	p.set_anchors_preset(Control.PRESET_CENTER_TOP)
	p.grow_horizontal = Control.GROW_DIRECTION_BOTH
	p.position.y = 60
	p.visible = false
	ed.ui["help"] = p
	var g := GridContainer.new()
	g.columns = 2
	for k in KEYS:
		var a := TrackEditorUI.label(k[0], false, 12)
		a.add_theme_color_override("font_color", Color("ffd04d"))
		a.autowrap_mode = TextServer.AUTOWRAP_OFF
		var b := TrackEditorUI.label(k[1], false, 12)
		b.custom_minimum_size.x = 420
		g.add_child(a)
		g.add_child(b)
	var v := VBoxContainer.new()
	var title := TrackEditorUI.label("Keys", false, 14)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	v.add_child(TrackEditorUI.hbox([title, TrackEditorUI.button("×", func(): p.visible = false, "Close (Escape)")]))
	v.add_child(g)
	p.add_child(v)


# ---- refresh

static func refresh(ed: TrackEditor) -> void:
	ed.ui["hint"].text = hint_text(ed)
	ed.ui["undo"].disabled = not ed.history.can_undo()
	ed.ui["redo"].disabled = not ed.history.can_redo()
	ed.ui["refQuick"].visible = not ed.reference.is_empty()
	var tool := ed.mode != "view"
	for m in ed.ui["modeButtons"]:
		var b: Button = ed.ui["modeButtons"][m]
		b.set_pressed_no_signal(m == ed.mode)
		b.visible = (m == ed.mode or not tool) and (ed.design != null or not (m in TrackEditor.DESIGN_MODES))
	for s in ["draw", "points"]:
		ed.ui["style_" + s].visible = ed.mode == "prefab"
		ed.ui["style_" + s].set_pressed_no_signal(ed.prefab_style == s)
	ed.ui["attach"].visible = ed.mode == "prefab"
	ed.ui["done"].visible = tool
	ed.ui["dragWindow"].visible = ed.mode == "drag" or ed.sel["kind"] == "drag"
	ed.ui["dragInfo"].text = ("Start %d, %d · %d m" % [roundi(ed.drag["x"]), roundi(ed.drag["z"]), roundi(ed.drag["length"])]) if not ed.drag.is_empty() \
		else "No drag strip yet: click on the road and drag in its direction."
	_props_refresh(ed)
	_layers_refresh(ed)
	_drawer_refresh(ed)


## The panel of what is chosen: its place, its direction and its size as numbers.
static func _props_refresh(ed: TrackEditor) -> void:
	var p: PanelContainer = ed.ui["props"]
	var box: VBoxContainer = ed.ui["propsBox"]
	var sk: String = ed.sel["kind"]
	var it := ed.input.item() if sk in ["grid", "pit", "pitline", "gate", "object", "camera", "drag"] else {}
	p.visible = not it.is_empty()
	if it.is_empty():
		box.set_meta("key", "")
		return
	var titles := {"grid": "Grid box %d", "pit": "Pit box %d", "pitline": "Pit line point %d", "gate": "Gate %d", "object": "Object %d",
		"camera": "Camera %d", "drag": "Drag strip"}
	var title: String = titles[sk] % (ed.sel["i"] + 1) if sk != "drag" else titles[sk]
	if sk == "gate" and ed.sel["i"] == 0:
		title = "Gate 1 (finish)"
	var fields: Array = [["x", "x", 1.0], ["z", "z", 1.0]]
	if sk in ["object", "camera"]:
		fields.append(["Height (y)", "y", 1.0])
	if TrackEditorInput.heading_of(sk, it) != null:
		fields.append(["Direction (°)", "heading", 0.0])
	if sk == "gate":
		fields.append(["Width (m)", "width", 1.0])
	if sk == "drag":
		fields.append_array([["Width (m)", "width", 1.0], ["Length (m)", "length", 1.0]])
	if sk == "object":
		fields.append(["Scale", "sx", 1.0])
	if sk == "camera":
		fields.append(["Range (m)", "range", 1.0])
	var key := "%s%d" % [sk, ed.sel["i"]]
	if box.get_meta("key", "") != key:
		box.set_meta("key", key)
		for c in box.get_children():
			c.free()
		var head := TrackEditorUI.label(title, false, 13)
		head.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		box.add_child(TrackEditorUI.hbox([head, TrackEditorUI.button("F", ed.input.frame_chosen, "Bring it into view (F)"), TrackEditorUI.button("Delete", func():
			ed.input.delete_chosen()
			ed.changed(), "Take it away (Delete)")]))
		var g := GridContainer.new()
		g.columns = 2
		box.add_child(g)
		for f in fields:
			var n := TrackEditorUI.number(0, -1e6, 1e6, 0.01, func(v: float): _prop_set(ed, f[1], v))
			n.name = f[1]
			g.add_child(TrackEditorUI.field(f[0], n))
	var grid := box.get_child(1) as GridContainer
	for f in fields:
		var n := grid.find_child(f[1], true, false) as SpinBox
		if n == null or n.get_line_edit().has_focus():
			continue
		var v: float
		match f[1]:
			"heading":
				v = rad_to_deg(float(it.get("heading", 0)))
			"range":
				v = float(it.get("range", {"r": 30.0})["r"])
			_:
				v = float(it.get(f[1], 0))
		n.set_value_no_signal(snappedf(v, 0.01))


static func _prop_set(ed: TrackEditor, key: String, v: float) -> void:
	var it := ed.input.item()
	if it.is_empty():
		return
	match key:
		"heading":
			it["heading"] = deg_to_rad(v)
		"range":
			if v >= 2.0:
				var r: Dictionary = it.get("range", {"x": it["x"], "z": it["z"], "r": 30.0})
				it["range"] = {"x": r["x"], "z": r["z"], "r": v}
		"width":
			if v >= 2.0:
				it["width"] = v
		"length":
			if v >= 50.0:
				it["length"] = v
		"sx":
			if v > 0.0:
				var k := v / float(it["sx"])
				it["sx"] = v
				it["sy"] = float(it["sy"]) * k
				it["sz"] = float(it["sz"]) * k
		"x", "z":
			it[key] = v
			if ed.sel["kind"] != "camera":
				it["y"] = ed.ground_y(float(it["x"]), float(it["z"]), float(it.get("y", 0)))
		_:
			it[key] = v
	ed.parts_kit.show_objects()
	ed.changed()


static func _layers_refresh(ed: TrackEditor) -> void:
	if not ed.ui["layers"].visible:
		return
	var fill := func(box_key: String, rows: Array) -> void:
		var box: VBoxContainer = ed.ui[box_key]
		for c in box.get_children():
			c.free()
		for r in rows:
			var b := Button.new()
			b.text = "%s   %s" % [r[0], r[1]]
			b.flat = true
			b.alignment = HORIZONTAL_ALIGNMENT_LEFT
			b.focus_mode = Control.FOCUS_NONE
			if r[3]:
				b.add_theme_color_override("font_color", Color("ffd04d"))
			b.pressed.connect(r[2])
			box.add_child(b)
		if rows.is_empty():
			box.add_child(TrackEditorUI.label("none", true, 12))
	var rows_of := func(list: Array, kind: String, name_of: Callable) -> Array:
		var out: Array = []
		for i in list.size():
			out.append([name_of.call(i), "%d, %d" % [roundi(list[i]["x"]), roundi(list[i]["z"])],
				func(): ed.select("" if ed.sel["kind"] == kind and ed.sel["i"] == i else kind, i), ed.sel["kind"] == kind and ed.sel["i"] == i])
		return out
	fill.call("layEvents", [["Drag strip", "%d m" % roundi(ed.drag["length"]), func(): ed.select("drag", 0), ed.sel["kind"] == "drag"]] if not ed.drag.is_empty() else [])
	fill.call("layObjects", rows_of.call(ed.objects, "object", func(i: int) -> String: return str(ed.objects[i]["model"]).trim_prefix("obj-").trim_suffix(".glb")))
	fill.call("layGates", rows_of.call(ed.gates, "gate", func(i: int) -> String: return "Gate 1 (finish)" if i == 0 else "Gate %d" % (i + 1)))
	var curb_rows: Array = []
	for i in ed.curbs.size():
		curb_rows.append(["Curb %d" % (i + 1), "%d nodes" % (ed.curbs[i]["nodes"] as Array).size(), func(): ed.select("curb", i),
			ed.sel["kind"] == "curb" and ed.sel["i"] == i])
	fill.call("layCurbs", curb_rows)
	var patch_rows: Array = []
	if ed.design != null:
		var patches: Array = ed.design.data["patches"]
		for i in patches.size():
			patch_rows.append(["%d. %s" % [i + 1, ed.design.surface_of(str(patches[i].get("surface", "gravel")))["label"]], "%d points" % (patches[i]["points"] as Array).size(),
				func():
					ed.mode = "patch"
					ed.select("patch", i), ed.sel["kind"] == "patch" and ed.sel["i"] == i])
	fill.call("laySurfaces", patch_rows)
	fill.call("layGrid", rows_of.call(ed.grid, "grid", func(i: int) -> String: return "Box 1 (start)" if i == 0 else "Box %d" % (i + 1)))
	fill.call("layPit", rows_of.call(ed.pit_boxes, "pit", func(i: int) -> String: return "Pit box 1 (player)" if i == 0 else "Pit box %d" % (i + 1)))
	var cam_rows: Array = rows_of.call(ed.cameras, "camera", func(i: int) -> String: return "Camera %d" % (i + 1))
	if ed.sel["kind"] == "camera":
		cam_rows.append(["◎ Range of camera %d" % (ed.sel["i"] + 1), "on" if ed.cam_range else "off", func():
			ed.cam_range = not ed.cam_range
			ed.refresh(), ed.cam_range])
	fill.call("layCameras", cam_rows)


static func _drawer_refresh(ed: TrackEditor) -> void:
	var on: bool = ed.design != null and (ed.mode in TrackEditor.DESIGN_MODES or ed.sel["kind"] in ["dnode", "prefab", "patch", "branch"])
	ed.ui["drawer"].visible = on
	if not on:
		return
	var page: String = {"node": "track", "branch": "branches", "patch": "patches", "prefab": "prefabs"}.get(ed.mode, "")
	if page == "":
		page = {"dnode": "track", "prefab": "prefabs", "patch": "patches", "branch": "branches"}.get(ed.sel["kind"], "track")
	for t in ["track", "branches", "patches", "prefabs"]:
		ed.ui["page_" + t].visible = t == page
		ed.ui["tab_" + t].set_pressed_no_signal(t == page)
	var d: Dictionary = ed.design.data
	ed.set_meta("filling", true)
	ed.ui["dsClosed"].set_pressed_no_signal(d.get("closed", true) != false)
	if not (d["nodes"] as Array).is_empty():
		ed.ui["dsWidth"].set_value_no_signal(float(d["nodes"][0]["width"]))
	for what in ["road", "shoulder", "ground"]:
		ed.ui["dsTex" + what].select(maxi(0, (DesignPrefabs.TEXTURE_CHOICES[what] as Array).find(ed.design.texture_of(what))))
	var sk: String = ed.sel["kind"]
	ed.ui["dsNodeBox"].visible = sk == "dnode"
	ed.ui["dsInfo"].text = ""
	if sk == "dnode":
		var n: Dictionary = d["nodes"][ed.sel["i"]]
		ed.ui["dsHeight"].set_value_no_signal(float(n["y"]))
		ed.ui["dsNodeWidth"].set_value_no_signal(float(n["width"]))
		ed.ui["dsInfo"].text = "Node %d of %d" % [ed.sel["i"] + 1, (d["nodes"] as Array).size()]
	if sk == "branch" and ed.sel["i"] < (d["branches"] as Array).size():
		var b: Dictionary = d["branches"][ed.sel["i"]]
		ed.ui["dsBranchWidth"].set_value_no_signal(float(b.get("width", 8)))
		ed.ui["dsBranchNodeWidth"].set_value_no_signal(float(b["nodes"][ed.sel["node"]].get("width", 0)) if ed.sel["node"] >= 0 else 0.0)
		ed.ui["dsInfo"].text = "Branch %d: %d nodes" % [ed.sel["i"] + 1, (b["nodes"] as Array).size()]
	if sk == "patch" and ed.sel["i"] < (d["patches"] as Array).size():
		var pa: Dictionary = d["patches"][ed.sel["i"]]
		var keys := TrackDesign.PATCH_SURFACES.keys()
		ed.ui["dsPatchSurface"].select(maxi(0, keys.find(str(pa.get("surface", "gravel")))))
		ed.ui["dsPatchConnect"].set_pressed_no_signal(pa.get("connect", false))
	for type in DesignPrefabs.LIST:
		ed.ui["pal_" + type].set_pressed_no_signal(type == ed.prefab_type)
	var p := _prefab(ed)
	ed.ui["dsPrefabBox"].visible = not p.is_empty()
	if not p.is_empty():
		var row: bool = p.get("row", false)
		var g: Node = null
		for c in ed.design.prefab_group.get_children():
			if int(c.get_meta("prefab", -1)) == ed.sel["i"]:
				g = c
		ed.ui["dsPrefabName"].text = str(DesignPrefabs.INFO.get(p["type"], DesignPrefabs.INFO["wall"])["label"]) + \
			(" (row of %d)" % int(g.get_meta("copies", 0)) if row and g != null else "")
		ed.ui["dsRotBox"].visible = not row
		ed.ui["dsSpacingBox"].visible = row
		ed.ui["dsOffsetBox"].visible = row and p.get("attach", false)
		ed.ui["dsRowAttach"].visible = row
		ed.ui["dsRowAttach"].set_pressed_no_signal(p.get("attach", false))
		ed.ui["dsPrefabRotation"].set_value_no_signal(roundf(rad_to_deg(float(p.get("rotation", 0)))))
		ed.ui["dsPrefabSpacing"].set_value_no_signal(float(p.get("spacing", DesignPrefabs.SPACING.get(p["type"], 4.0))))
		ed.ui["dsPrefabScale"].set_value_no_signal(float(p.get("scale", 1)))
		var node: Dictionary = p["points"][ed.sel["node"]] if row and ed.sel["node"] >= 0 else {}
		ed.ui["dsRowOffset"].set_value_no_signal(float(node.get("offset", p.get("offset", 0))))
		var choices: Array = DesignPrefabs.TEXTURE_CHOICES.get(p["type"], [])
		ed.ui["dsTexBox"].visible = not choices.is_empty() and not ["road", "shoulder", "ground"].has(p["type"])
		var o: OptionButton = ed.ui["dsPrefabTexture"]
		o.clear()
		for c in choices:
			o.add_item(MeshKit.TEXTURES[c]["label"])
		if not choices.is_empty():
			o.select(maxi(0, choices.find(str(p.get("texture", choices[0])))))
	ed.remove_meta("filling")


## The hint of the tool in use (the line at the top of the view).
static func hint_text(ed: TrackEditor) -> String:
	if HINTS.has(ed.mode):
		return HINTS[ed.mode]
	var text := "Look: drag to turn, right mouse button to move, scroll to zoom. Click a thing to choose it."
	if ed.mode == "measure":
		text = TrackEditorMarkers.measure_text(ed)
	elif ed.mode == "prefab":
		text = "Prefabs: click to put down a %s, or %s." % [str(DesignPrefabs.INFO[ed.prefab_type]["label"]).to_lower(),
			"click the points of a row of them (Enter ends it)" if ed.prefab_style == "points" else "drag a line to make a row of them"]
	elif ed.line_edit["editing"]:
		text = "The line: click a node and drag it, Shift + click on the road adds a node, Delete takes the chosen one away." + \
			(" Click on the road for the next node." if ed.line_edit["drawing"] else "")
	return text
