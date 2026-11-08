class_name TrackEditorUI
extends RefCounted
## The side bar of the track editor (track-editor.html): the cards that fold, in the order of the browser (Track, Ready to race,
## Reference image, Model, Surfaces, Start and lap gates, Pit boxes, Objects, Curbs, Cinematic cameras, AI racing line, Sky and
## light) and the bar at the bottom with the status and Thumbnail, Export zip, Test drive and Save. The look of editor.css: dark
## cards, orange for the main button. The panels over the view are TrackEditorPanels.

const SIDE := 420.0
const CURB_COLOURS := ["red", "blue", "green", "yellow", "black"]
const BG := Color("14181d")
const CARD := Color("181d23")
const CARD_HEAD := Color("1c222a")
const LINE := Color("272e37")
const ACCENT := Color("ff5a1f")
const MUTED := Color("8d97a3")


static func make_theme() -> Theme:
	var t := Theme.new()
	t.default_font_size = 13
	var box := func(bg: Color, border: Color, radius := 8, pad := 6) -> StyleBoxFlat:
		var s := StyleBoxFlat.new()
		s.bg_color = bg
		s.border_color = border
		s.set_border_width_all(1)
		s.set_corner_radius_all(radius)
		s.content_margin_left = pad + 4
		s.content_margin_right = pad + 4
		s.content_margin_top = pad
		s.content_margin_bottom = pad
		return s
	t.set_stylebox("normal", "Button", box.call(Color("232a33"), Color("323c4a")))
	t.set_stylebox("hover", "Button", box.call(Color("2b3440"), Color("3d4a5c")))
	t.set_stylebox("pressed", "Button", box.call(Color("26344b"), Color("4a6a9c")))
	t.set_stylebox("disabled", "Button", box.call(Color("1b2027"), Color("272e37")))
	t.set_stylebox("focus", "Button", StyleBoxEmpty.new())
	t.set_color("font_color", "Button", Color("d9dee5"))
	t.set_color("font_pressed_color", "Button", Color.WHITE)
	t.set_stylebox("normal", "LineEdit", box.call(Color("0f1318"), LINE, 6, 4))
	t.set_stylebox("focus", "LineEdit", box.call(Color("0f1318"), Color("4a6a9c"), 6, 4))
	t.set_stylebox("normal", "OptionButton", box.call(Color("0f1318"), LINE, 6, 4))
	t.set_stylebox("hover", "OptionButton", box.call(Color("151a20"), Color("3d4a5c"), 6, 4))
	t.set_stylebox("pressed", "OptionButton", box.call(Color("151a20"), Color("4a6a9c"), 6, 4))
	t.set_stylebox("panel", "PanelContainer", box.call(Color(0.086, 0.106, 0.133, 0.94), Color("323c4a"), 10, 8))
	t.set_stylebox("panel", "FoldableContainer", box.call(CARD, LINE, 10, 10))
	t.set_stylebox("title_panel", "FoldableContainer", box.call(CARD_HEAD, LINE, 10, 8))
	t.set_stylebox("title_hover_panel", "FoldableContainer", box.call(Color("222a33"), LINE, 10, 8))
	t.set_stylebox("title_collapsed_panel", "FoldableContainer", box.call(CARD_HEAD, LINE, 10, 8))
	t.set_stylebox("title_collapsed_hover_panel", "FoldableContainer", box.call(Color("222a33"), LINE, 10, 8))
	t.set_color("font_color", "Label", Color("d9dee5"))
	return t


static func _accent(b: Button) -> Button:
	var s := StyleBoxFlat.new()
	s.bg_color = ACCENT
	s.set_corner_radius_all(8)
	s.content_margin_left = 14
	s.content_margin_right = 14
	s.content_margin_top = 6
	s.content_margin_bottom = 6
	b.add_theme_stylebox_override("normal", s)
	var h := s.duplicate() as StyleBoxFlat
	h.bg_color = Color("ff7440")
	b.add_theme_stylebox_override("hover", h)
	b.add_theme_color_override("font_color", Color.WHITE)
	return b


static func button(text: String, call: Callable, tip := "", accent := false) -> Button:
	var b := Button.new()
	b.text = text
	b.tooltip_text = tip
	b.focus_mode = Control.FOCUS_NONE
	b.pressed.connect(call)
	return _accent(b) if accent else b


static func label(text: String, muted := false, size := 0) -> Label:
	var l := Label.new()
	l.text = text
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	if muted:
		l.add_theme_color_override("font_color", MUTED)
	if size > 0:
		l.add_theme_font_size_override("font_size", size)
	return l


static func hbox(children: Array, sep := 6) -> HBoxContainer:
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", sep)
	for c in children:
		h.add_child(c)
	return h


## A field with its caption above it.
static func field(caption: String, control: Control) -> VBoxContainer:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 2)
	v.add_child(label(caption, true, 12))
	control.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	v.add_child(control)
	v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return v


static func number(value: float, lo: float, hi: float, step: float, on_change: Callable) -> SpinBox:
	var s := SpinBox.new()
	s.min_value = lo
	s.max_value = hi
	s.step = step
	s.value = value
	s.allow_greater = true
	s.allow_lesser = true
	s.custom_minimum_size.x = 70
	s.value_changed.connect(on_change)
	return s


static func check(text: String, on: bool, on_change: Callable, tip := "") -> CheckBox:
	var c := CheckBox.new()
	c.text = text
	c.button_pressed = on
	c.tooltip_text = tip
	c.focus_mode = Control.FOCUS_NONE
	c.toggled.connect(on_change)
	return c


static func options(items: Array, selected: int, on_change: Callable) -> OptionButton:
	var o := OptionButton.new()
	for it in items:
		o.add_item(str(it))
	if selected < items.size():
		o.select(selected)
	o.focus_mode = Control.FOCUS_NONE
	o.item_selected.connect(on_change)
	return o


static func colour(value: String, on_change: Callable) -> ColorPickerButton:
	var c := ColorPickerButton.new()
	c.color = Color(value)
	c.edit_alpha = false
	c.custom_minimum_size = Vector2(60, 28)
	c.color_changed.connect(on_change)
	return c


## A card of the side bar: a title, a note at the right of it, and its content.
static func card(ed: TrackEditor, key: String, title: String, open := true) -> VBoxContainer:
	var f := FoldableContainer.new()
	f.title = title
	f.folded = not open
	var meta := label("", true, 12)
	meta.autowrap_mode = TextServer.AUTOWRAP_OFF
	meta.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	meta.custom_minimum_size.x = 170
	meta.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	meta.clip_text = true
	f.add_title_bar_control(meta)
	ed.ui[key + "Note"] = meta
	ed.ui[key + "Card"] = f
	var body := VBoxContainer.new()
	body.add_theme_constant_override("separation", 8)
	f.add_child(body)
	(ed.ui["cards"] as VBoxContainer).add_child(f)
	return body


static func build(ed: TrackEditor) -> void:
	var side := PanelContainer.new()
	var bg := StyleBoxFlat.new()
	bg.bg_color = BG
	bg.border_color = LINE
	bg.border_width_right = 1
	side.add_theme_stylebox_override("panel", bg)
	side.custom_minimum_size.x = SIDE
	side.position = Vector2.ZERO
	side.size = Vector2(SIDE, ed.size.y)
	ed.add_child(side)
	ed.ui["side"] = side
	side.resized.connect(func(): ed.parts_kit.layout_view(side.size.x))
	var col := VBoxContainer.new()
	side.add_child(col)
	var head := hbox([label("Track editor", false, 17)])
	(head.get_child(0) as Label).size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(button("← Game", ed.close_editor, "Back to the main menu"))
	var hm := MarginContainer.new()
	for m in ["margin_left", "margin_right", "margin_top", "margin_bottom"]:
		hm.add_theme_constant_override(m, 12)
	hm.add_child(head)
	col.add_child(hm)
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	col.add_child(scroll)
	var sm := MarginContainer.new()
	sm.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for m in ["margin_left", "margin_right"]:
		sm.add_theme_constant_override(m, 12)
	scroll.add_child(sm)
	var cards := VBoxContainer.new()
	cards.add_theme_constant_override("separation", 10)
	sm.add_child(cards)
	ed.ui["cards"] = cards
	ed.ui["scroll"] = scroll
	_track_card(ed)
	var ready := card(ed, "ready", "Ready to race")
	ed.ui["readyList"] = ready
	_reference_card(ed)
	_model_card(ed)
	_surfaces_card(ed)
	_gates_card(ed)
	_pit_card(ed)
	_objects_card(ed)
	_curbs_card(ed)
	_cameras_card(ed)
	_line_card(ed)
	_sky_card(ed)
	# the bar at the bottom
	var foot := hbox([])
	var fm := MarginContainer.new()
	for m in ["margin_left", "margin_right", "margin_top", "margin_bottom"]:
		fm.add_theme_constant_override(m, 10)
	fm.add_child(foot)
	col.add_child(fm)
	var status := label("", true, 12)
	status.autowrap_mode = TextServer.AUTOWRAP_OFF
	status.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	status.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	status.clip_text = true
	status.mouse_filter = Control.MOUSE_FILTER_PASS
	ed.ui["status"] = status
	foot.add_child(status)
	foot.add_child(button("Thumbnail", func(): TrackEditorIO.take_thumbnail(ed), "A picture of the track for the menu, from the camera as it stands"))
	foot.add_child(button("Export zip", func(): _export(ed), "The saved track as a zip to share"))
	foot.add_child(button("Test drive", func(): _test_drive(ed), "Save the track and drive it in the game"))
	foot.add_child(button("Save", func(): TrackEditorIO.save(ed), "Save the track (Ctrl+S)", true))
	TrackEditorPanels.build(ed)
	ed.parts_kit.layout_view(SIDE)


static func _track_card(ed: TrackEditor) -> void:
	var b := card(ed, "track", "Track")
	var existing := OptionButton.new()
	existing.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	existing.focus_mode = Control.FOCUS_NONE
	existing.item_selected.connect(func(i: int):
		if i <= 0:
			return
		var id: String = ed.tracks[i - 1]["id"]
		if ed.history.unsaved():
			ask(ed, "Open “%s”?" % id, "The changes to this track that are not saved are lost.", "Open", func(): TrackEditorIO.open(ed, id))
		else:
			TrackEditorIO.open(ed, id))
	ed.ui["existing"] = existing
	b.add_child(hbox([existing, button("New track", func():
		if ed.history.unsaved():
			ask(ed, "A new track?", "The changes that are not saved are lost.", "New track", func(): TrackEditorIO.new_track(ed))
		else:
			TrackEditorIO.new_track(ed))]))
	b.add_child(hbox([button("Delete…", func(): TrackEditorIO.delete_track(ed), "Delete this track of your garage, with all its files"),
		button("Height map…", func(): _height_dialog(ed), "Make a track from a height map and a colour map")]))
	var name := LineEdit.new()
	name.placeholder_text = "My track"
	var id := LineEdit.new()
	id.placeholder_text = "my-track"
	name.text_changed.connect(func(t: String):
		if not ed.has_meta("id_edited") or not ed.get_meta("id_edited"):
			id.text = TrackEditorIO.slug(t)
		refresh(ed))
	id.text_changed.connect(func(_t: String): ed.set_meta("id_edited", true))
	ed.ui["name"] = name
	ed.ui["id"] = id
	b.add_child(hbox([field("Name", name), field("Id (folder name)", id)]))
	var desc := LineEdit.new()
	desc.placeholder_text = "Short description for the menu"
	ed.ui["description"] = desc
	b.add_child(field("Description", desc))
	var repo := check("Save in the repository (web/tracks), not in my garage", false, func(on: bool): ed.save_to_repo = on,
		"The game runs from the repository: the track is saved with the tracks of the game")
	repo.visible = TrackEditorIO.repo_writable()
	b.add_child(repo)


static func fill_fields(ed: TrackEditor, name: String, id: String, description: String) -> void:
	ed.ui["name"].text = name
	ed.ui["id"].text = id
	ed.ui["description"].text = description
	ed.set_meta("id_edited", id != "")


static func _reference_card(ed: TrackEditor) -> void:
	var b := card(ed, "ref", "Reference image", false)
	b.add_child(label("A picture to draw the track over: a map or an aerial photo. It lies flat in the view, is only for this editor and is saved with the " +
		"track.", true, 12))
	b.add_child(hbox([button("Choose a picture…", func(): _pick_file(ed, ["*.png, *.jpg, *.jpeg, *.webp ; Pictures"], func(p: String): TrackEditorIO.pick_reference(ed, p))),
		button("Remove", func():
			ed.reference = {}
			ed.ref_source = ""
			TrackEditorIO.place_reference(ed)
			ed.changed())]))
	var ctl := VBoxContainer.new()
	ed.ui["refControls"] = ctl
	b.add_child(ctl)
	var set_ref := func(k: String, v: Variant) -> void:
		if ed.reference.is_empty():
			return
		ed.reference[k] = v
		TrackEditorIO.place_reference(ed)
		ed.changed()
	var op := HSlider.new()
	op.scrollable = false              # (the wheel scrolls the page)
	op.min_value = 0
	op.max_value = 100
	op.value_changed.connect(func(v: float): set_ref.call("opacity", v / 100.0))
	ed.ui["refOpacity"] = op
	ctl.add_child(field("Opacity", op))
	ed.ui["refShow"] = check("Show", true, func(on: bool): set_ref.call("show", on))
	ed.ui["refTop"] = check("On top of the track", true, func(on: bool): set_ref.call("top", on))
	ctl.add_child(hbox([ed.ui["refShow"], ed.ui["refTop"]]))
	ctl.add_child(button("Scale by two points", func():
		ed.measure_points.clear()
		ed.set_mode("refscale")))
	for k in [["refWidth", "Width (m)", "width"], ["refRotation", "Turn (°)", "rotation"], ["refX", "x (m)", "x"], ["refZ", "z (m)", "z"], ["refY", "Height (m)", "y"]]:
		ed.ui[k[0]] = number(0, -1e6, 1e6, 0.5, func(v: float): set_ref.call(k[2], v))
	ctl.add_child(hbox([field("Width (m)", ed.ui["refWidth"]), field("Turn (°)", ed.ui["refRotation"])]))
	ctl.add_child(hbox([field("x (m)", ed.ui["refX"]), field("z (m)", ed.ui["refZ"]), field("Height (m)", ed.ui["refY"])]))


static func _model_card(ed: TrackEditor) -> void:
	var b := card(ed, "model", "Model")
	b.add_child(label("A .glb, or a .gltf with its .bin and textures in its folder. Make the track in metres, y up. Importing a model in a track that exists " +
		"replaces its model.", true, 12))
	b.add_child(button("Import a model…", func():
		_pick_file(ed, ["*.glb, *.gltf ; glTF models"], func(p: String): TrackEditorIO.import_model(ed, p))))


static func _surfaces_card(ed: TrackEditor) -> void:
	var b := card(ed, "parts", "Surfaces")
	b.add_child(label("Road, pit lane, grass and ground can be driven on, scenery is driven into (walls, buildings), decor is only to look at. Click a part in " +
		"the view to find it.", true, 12))
	var filter := LineEdit.new()
	filter.placeholder_text = "Filter by name"
	filter.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	filter.text_changed.connect(func(_t: String): _parts_list(ed, true))
	ed.ui["filter"] = filter
	var roles := TrackEditor.ROLES.map(func(r: Array) -> String: return r[1])
	var bulk := options(roles, 0, func(_i: int): pass)
	ed.ui["bulkRole"] = bulk
	b.add_child(hbox([filter, bulk, button("Set all shown", func():
		for k in ed.parts:
			if filter.text == "" or str(k).to_lower().contains(filter.text.to_lower()):
				ed.roles[k] = TrackEditor.ROLES[bulk.selected][0]
		ed.invalidate_ground()
		ed.parts_kit.apply_colours()
		_parts_list(ed, true)
		ed.changed())]))
	var list := VBoxContainer.new()
	ed.ui["parts"] = list
	b.add_child(list)
	var legend := HFlowContainer.new()
	for r in TrackEditor.ROLES:
		var sw := ColorRect.new()
		sw.color = TrackEditor.ROLE_COLORS[r[0]]
		sw.custom_minimum_size = Vector2(10, 10)
		legend.add_child(hbox([sw, label(r[1], true, 11)], 3))
	b.add_child(legend)


## The list of the parts with their surfaces (made again when the parts or the filter change).
static func _parts_list(ed: TrackEditor, force := false) -> void:
	var list: VBoxContainer = ed.ui["parts"]
	var key := "%s|%s|%s" % [ed.parts.keys(), ed.ui["filter"].text, ed.selected_part]
	if not force and list.get_meta("key", "") == key:
		return
	list.set_meta("key", key)
	for c in list.get_children():
		c.free()
	var names: Array = ed.parts.keys()
	names.sort()
	var shown := 0
	for n in names:
		if ed.ui["filter"].text != "" and not str(n).to_lower().contains(ed.ui["filter"].text.to_lower()):
			continue
		shown += 1
		if shown > 300:
			continue
		var nm := Button.new()
		nm.text = str(n) if str(n) != "" else "(no name)"
		nm.flat = true
		nm.alignment = HORIZONTAL_ALIGNMENT_LEFT
		nm.clip_text = true
		nm.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		nm.focus_mode = Control.FOCUS_NONE
		if n == ed.selected_part:
			nm.add_theme_color_override("font_color", Color("ffd04d"))
		nm.pressed.connect(func():
			ed.select("part")
			ed.selected_part = n
			ed.parts_kit.apply_colours()
			refresh(ed))
		var idx := 0
		for i in TrackEditor.ROLES.size():
			if TrackEditor.ROLES[i][0] == ed.roles.get(n, "scenery"):
				idx = i
		var o := options(TrackEditor.ROLES.map(func(r: Array) -> String: return r[1]), idx, func(i: int): ed.parts_kit.set_role(n, TrackEditor.ROLES[i][0]))
		o.custom_minimum_size.x = 110
		list.add_child(hbox([nm, o]))
	ed.ui["partsNote"].text = ("%d of %d parts shown" % [mini(shown, 300), ed.parts.size()]) if not ed.parts.is_empty() else "No parts: load a model."


static func _gates_card(ed: TrackEditor) -> void:
	var b := card(ed, "gate", "Start and lap gates")
	b.add_child(label("Use the tools in the view: click on the road and drag in the direction that the car drives. Grid box places the next box of the start " +
		"grid: box 1 is the start of the player, 2 to 8 are for the opponents. The first gate is the finish line.", true, 12))
	var grid := VBoxContainer.new()
	ed.ui["gridList"] = grid
	b.add_child(grid)
	b.add_child(hbox([button("Fill the grid", func():
		confirm_if(ed, ed.grid.size() > 1, "Make the grid again?", "Boxes 2 to %d are put behind box 1 again." % ed.grid.size(), "Make the grid",
			func(): _fill_grid(ed)), "Boxes 2 to 8 behind box 1: two wide and staggered"), button("Clear the grid", func():
		confirm_if(ed, ed.grid.size() > 1, "Clear the grid?", "All %d boxes." % ed.grid.size(), "Clear", func():
			ed.grid.clear()
			ed.select("")
			ed.changed()))]))
	var gw := number(24, 2, 400, 1, func(v: float): ed.gate_width = v)
	b.add_child(hbox([field("Width of new gates (m)", gw), field(" ", button("Gate 1 at the start", func(): _gate_at_start(ed)))]))
	var count := number(8, 2, 40, 1, func(_v: float): pass)
	ed.ui["gatesCount"] = count
	b.add_child(hbox([field("Number of gates", count), field(" ", button("Auto gates", func(): _auto_gates(ed),
		"Gates at the same distance from each other along the racing line (or the middle of a drawn road)"))]))
	ed.ui["showGates"] = check("Show the checkpoints in the game", true, func(on: bool):
		ed.show_gates = on
		ed.changed())
	b.add_child(ed.ui["showGates"])
	var gates := VBoxContainer.new()
	ed.ui["gatesList"] = gates
	b.add_child(gates)


static func _pit_card(ed: TrackEditor) -> void:
	var b := card(ed, "pit", "Pit boxes", false)
	b.add_child(label("A box of 4 by 8 metres for every player. Choose Pit box in the toolbar, click on the road where the box is and drag in the direction that " +
		"the car faces. Box 1 is the box of the player, 2 to 8 those of the opponents.", true, 12))
	var list := VBoxContainer.new()
	ed.ui["pitList"] = list
	b.add_child(list)
	b.add_child(hbox([button("Fill the pit boxes", func():
		confirm_if(ed, ed.pit_boxes.size() > 1, "Make the pit boxes again?", "Boxes 2 to %d are put in a row after box 1." % ed.pit_boxes.size(),
			"Make the boxes", func(): _fill_pit(ed)), "Boxes 2 to 8 in a row after box 1, 10 m apart"), button("Clear the pit boxes", func():
		confirm_if(ed, ed.pit_boxes.size() > 1, "Clear the pit boxes?", "All %d boxes." % ed.pit_boxes.size(), "Clear", func():
			ed.pit_boxes.clear()
			ed.select("")
			ed.changed()))]))
	b.add_child(label("Pit line: the path that the AI cars follow to their box and back. Choose Pit line in the toolbar and click on the road in the order that a " +
		"car drives: from the racing line, through the boxes, back to the racing line.", true, 12))
	ed.ui["pitLineNote"] = label("", true, 12)
	b.add_child(ed.ui["pitLineNote"])
	# (a track of before has a pit area of its own, a polygon: it is drawn and can be taken away)
	var old_pit := HBoxContainer.new()
	var old_text := label("", true, 12)
	old_text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	old_pit.add_child(old_text)
	old_pit.add_child(button("Remove", func():
		ed.pit_polygon = []
		ed.changed()))
	ed.ui["oldPit"] = old_pit
	ed.ui["oldPitText"] = old_text
	b.add_child(old_pit)
	b.add_child(hbox([button("Undo the last point", func():
		if not ed.pit_line.is_empty():
			ed.pit_line.pop_back()
			ed.changed()), button("Clear the pit line", func():
		ed.pit_line.clear()
		ed.changed())]))


static func _objects_card(ed: TrackEditor) -> void:
	var b := card(ed, "object", "Objects")
	b.add_child(label("The library of your own models (glb: a barrel, a block, a tree), the same in every track. Click a model and you are placing it: press on " +
		"the road and drag to say which way it faces. A rigid object is pushed and falls when a car hits it; static stands still and is hit; decor only " +
			"shows.", true, 12))
	var lib := HFlowContainer.new()
	ed.ui["objectLibrary"] = lib
	b.add_child(lib)
	b.add_child(button("+ Add a model to the library", func():
		_pick_file(ed, ["*.glb ; glb models"], func(p: String): TrackEditorIO.add_to_library(ed, p))))
	var model := VBoxContainer.new()
	ed.ui["objectModel"] = model
	b.add_child(model)
	var pre := VBoxContainer.new()
	ed.ui["objectPrefabs"] = pre
	pre.add_child(label("The prefabs of the track designer: click one to place it. A wall or a cone stands in the track like a model; a tree or a bush only " +
		"shows.", true, 12))
	var flow := HFlowContainer.new()
	for type in DesignPrefabs.LIST:
		var info: Dictionary = DesignPrefabs.INFO[type]
		var choices: Array = DesignPrefabs.TEXTURE_CHOICES.get(type, [])
		var tex := [str(choices[0]) if not choices.is_empty() else ""]
		var pb := button("%s %s" % [info["icon"], info["label"]], func(): TrackEditorIO.use_prefab(ed, type, tex[0]))
		_tile(pb)
		pb.tooltip_text = info["label"] + (": stands in the track and is hit" if info["role"] == "scenery" else ": only drawn") + " — click to place it"
		ed.thumbs.request("prefab:" + type, func() -> Node3D: return DesignPrefabs.make(type, ""), _set_icon.bind(pb))
		if choices.is_empty():
			flow.add_child(pb)
			continue
		# (a prefab with textures: the texture to place it with, under its tile)
		var cell := VBoxContainer.new()
		cell.add_theme_constant_override("separation", 1)
		cell.add_child(pb)
		var pick := OptionButton.new()
		for t in choices:
			pick.add_item(str(t))
		pick.tooltip_text = "The texture of the " + str(info["label"]).to_lower()
		pick.add_theme_font_size_override("font_size", 11)
		pick.item_selected.connect(func(i: int): tex[0] = str(choices[i]))
		cell.add_child(pick)
		flow.add_child(cell)
	pre.add_child(flow)
	b.add_child(pre)
	var list := VBoxContainer.new()
	ed.ui["objectList"] = list
	b.add_child(list)


static func _curbs_card(ed: TrackEditor) -> void:
	var b := card(ed, "curb", "Curbs")
	b.add_child(label("Curbstones along the edge of the road. Draw curb: click on the road to start one; every next click adds a node at the end that is nearest, " +
		"and Enter ends the curb. A chosen curb: drag a node to move it, click on the strip to add a node there, Delete takes the chosen node away.", true, 12))
	var update := func() -> void:
		if ed.sel["kind"] == "curb":
			var c: Dictionary = ed.curbs[ed.sel["i"]]
			c.merge(ed.curbs_kit.curb_settings(), true)
			ed.curbs_kit.build_curb(ed.sel["i"])
			ed.changed()
	ed.ui["curbWidth"] = number(1.2, 0.3, 4, 0.1, func(_v: float): update.call())
	ed.ui["curbHeight"] = number(0.05, 0, 0.3, 0.01, func(_v: float): update.call())
	ed.ui["curbColour"] = options(["Red / white", "Blue / white", "Green / white", "Yellow / white", "Black / white"], 0, func(_i: int): update.call())
	ed.ui["curbConnect"] = check("Connect to road", false, func(on: bool): _curb_connect(ed, on),
		"The nodes lie on the edge of the road and follow it when the road is changed (a track drawn with nodes)")
	b.add_child(hbox([field("Width (m)", ed.ui["curbWidth"]), field("Height (m)", ed.ui["curbHeight"]), field("Colour", ed.ui["curbColour"])]))
	b.add_child(ed.ui["curbConnect"])
	ed.ui["curbInfo"] = label("", true, 12)
	b.add_child(ed.ui["curbInfo"])
	b.add_child(button("Draw curb", func():
		ed.select("")
		ed.set_mode("curb"), "", true))
	var edit := VBoxContainer.new()
	ed.ui["curbEdit"] = edit
	b.add_child(edit)
	var node_box := VBoxContainer.new()
	ed.ui["curbNodeBox"] = node_box
	edit.add_child(node_box)
	var size := HSlider.new()
	size.scrollable = false              # (the wheel scrolls the page)
	size.min_value = 0
	size.max_value = 1.5
	size.step = 0.05
	size.value_changed.connect(func(v: float):
		if ed.sel["kind"] == "curb" and ed.sel["node"] >= 0 and not ed.has_meta("filling"):
			ed.curbs_kit.set_curb_size(ed.curbs[ed.sel["i"]]["nodes"][ed.sel["node"]], v)
			ed.curbs_kit.build_curb(ed.sel["i"])
			ed.changed())
	ed.ui["curbSize"] = size
	node_box.add_child(field("Size at this node", size))
	var off := HSlider.new()
	off.scrollable = false              # (the wheel scrolls the page)
	off.min_value = -6
	off.max_value = 6
	off.step = 0.05
	off.value_changed.connect(func(v: float):
		if ed.sel["kind"] == "curb" and ed.sel["node"] >= 0 and not ed.has_meta("filling"):
			var n: Array = ed.curbs[ed.sel["i"]]["nodes"][ed.sel["node"]]
			ed.curbs_kit.set_curb_offset(n, v)
			ed.curbs_kit.snap_curb_node(n)
			ed.curbs_kit.build_curb(ed.sel["i"])
			ed.changed())
	ed.ui["curbOffset"] = off
	ed.ui["curbOffsetBox"] = field("Distance from the road edge", off)
	node_box.add_child(ed.ui["curbOffsetBox"])
	node_box.add_child(button("Delete node", func():
		ed.curbs_kit.delete_curb_node()
		ed.changed()))
	edit.add_child(hbox([button("Taper the ends", func():
		var c: Dictionary = ed.curbs[ed.sel["i"]]
		ed.curbs_kit.set_curb_size(c["nodes"][0], 0.25)
		ed.curbs_kit.set_curb_size(c["nodes"][-1], 0.25)
		ed.curbs_kit.build_curb(ed.sel["i"])
		ed.changed(), "The first and the last node small (25%)"), button("Remove curb", func():
		ed.curbs_kit.remove_curb(ed.sel["i"])
		ed.changed()), button("Done", func():
		ed.curbs_kit.end_curb_draw()
		ed.select(""))]))


static func _curb_connect(ed: TrackEditor, on: bool) -> void:
	if ed.sel["kind"] != "curb" or ed.has_meta("filling"):
		return
	var c: Dictionary = ed.curbs[ed.sel["i"]]
	if on and ed.design == null:
		ed.ui["curbConnect"].set_pressed_no_signal(false)
		ed.status("Connect to road is for a track that is drawn with the road designer.", "warn")
		return
	if on:
		c["connect"] = true
		for n in c["nodes"]:
			ed.curbs_kit.start_curb_offset(n)
	else:
		c.erase("connect")
		for n in c["nodes"]:
			var s := Curbs.size_of(n)
			(n as Array).resize(3)
			if absf(s - 1.0) > 1e-3:
				(n as Array).append(s)
	ed.curbs_kit.build_curb(ed.sel["i"])
	ed.changed()


static func _cameras_card(ed: TrackEditor) -> void:
	var b := card(ed, "camera", "Cinematic cameras", false)
	b.add_child(label("Cameras for the replay: use Add camera in the view and click on the track. Click a camera to choose it; Range changes the circle on the " +
		"floor in which it is used (drag its middle and its edge).", true, 12))
	ed.ui["cameraHeight"] = number(3, 0.5, 100, 0.5, func(_v: float): pass)
	b.add_child(field("Height above the ground of a new camera (m)", ed.ui["cameraHeight"]))
	var list := VBoxContainer.new()
	ed.ui["cameraList"] = list
	b.add_child(list)


static func _line_card(ed: TrackEditor) -> void:
	var b := card(ed, "line", "AI racing line")
	b.add_child(label("The line that the AI cars drive. Record AI racing line drives the saved track in the game: every lap you finish replaces the " +
		"line, Esc or Stop saves the last one and comes back here. Edit the line shows its nodes (about 8 m apart): drag a node, Shift + click on the road adds a node, " +
		"Delete takes the chosen one away, Apply line saves it. Draw the line makes a new line: click on the road node after node in the direction that the AI " +
			"drives, all the way round. Without a line a road drawn with nodes is driven along its middle.", true, 12))
	ed.ui["showLine"] = check("Show the line", true, func(on: bool):
		ed.show_line = on
		ed.refresh())
	b.add_child(ed.ui["showLine"])
	b.add_child(hbox([button("Record AI racing line", func(): _record_line(ed), "", true)]))
	var row1 := hbox([button("Edit the line", func(): ed.line.start_line_edit(), "", true), button("Draw the line", func():
		if ed.existing_id == "":
			ed.status("Save the track first: the line is saved on the saved track.", "error")
			return
		ed.line.start_line_draw(), "", true), button("Forget the line", func(): _forget_line(ed))])
	ed.ui["lineIdle"] = row1
	b.add_child(row1)
	var row2 := HFlowContainer.new()
	for x in [["Undo the last node", func():
			if not (ed.line_edit["nodes"] as Array).is_empty():
				(ed.line_edit["nodes"] as Array).pop_back()
				ed.refresh()],
			["Add node", func():
				var n: Array = ed.line_edit["nodes"]
				if n.size() >= 2:
					var i := maxi(0, ed.line_edit["selected"])
					ed.line.add_line_node_at((n[i]["x"] + n[(i + 1) % n.size()]["x"]) / 2.0, (n[i]["z"] + n[(i + 1) % n.size()]["z"]) / 2.0)],
			["Delete node", func(): ed.line.delete_line_node()], ["Apply line", func(): _apply_line(ed)], ["Cancel", func(): cancel_line(ed)]]:
		row2.add_child(button(x[0], x[1], "", x[0] == "Apply line"))
	ed.ui["lineEdit"] = row2
	b.add_child(row2)


static func cancel_line(ed: TrackEditor) -> void:
	if JSON.stringify(ed.line_edit["nodes"]) != ed.line_edit["start"]:
		ask(ed, "Throw away the changes of the line?", "The nodes are back as they were; the saved line stays.", "Throw away", func(): ed.line.stop_line_edit())
	else:
		ed.line.stop_line_edit()


static func _apply_line(ed: TrackEditor) -> void:
	if (ed.line_edit["nodes"] as Array).size() < 4:
		ed.status("A line needs at least four nodes (there are %d)." % (ed.line_edit["nodes"] as Array).size(), "error")
		return
	var line := ed.line.line_json()
	if TrackEditorIO.store_line(ed, line):
		ed.line.stop_line_edit()
		ed.status("The line is saved (%d points): the AI drives it from the next start." % line.size(), "ok")


static func _forget_line(ed: TrackEditor) -> void:
	if (ed.existing.get("racing_line", []) as Array).is_empty():
		return
	ask(ed, "Forget the racing line?", "The recorded line is removed from the saved track.", "Forget", func():
		if TrackEditorIO.store_line(ed, null):
			ed.status("The line is forgotten.", "ok")
			ed.refresh())


static func _sky_card(ed: TrackEditor) -> void:
	var b := card(ed, "sky", "Sky and light", false)
	ed.ui["envOn"] = check("Set the sky and the light of this track", true, func(on: bool):
		ed.env_on = on
		TrackEditorIO.apply_env(ed))
	b.add_child(ed.ui["envOn"])
	b.add_child(label("In the game the sky, the fog, the sun and the time of day come from the player's weather and time settings. Of this card the game uses the " +
		"strength of the sun and of the ambient light.", true, 12))
	var set_env := func(path: Array, v: Variant) -> void:
		if path.size() == 1:
			ed.env[path[0]] = v
		else:
			ed.env[path[0]][path[1]] = v
		TrackEditorIO.apply_env(ed)
	var e := ed.env if not ed.env.is_empty() else TrackEditorIO.environment_defaults()
	ed.ui["skyTop"] = colour(e["sky_top"], func(c: Color): set_env.call(["sky_top"], "#" + c.to_html(false)))
	ed.ui["skyHorizon"] = colour(e["sky_horizon"], func(c: Color): set_env.call(["sky_horizon"], "#" + c.to_html(false)))
	b.add_child(hbox([field("Sky overhead", ed.ui["skyTop"]), field("Sky at the horizon", ed.ui["skyHorizon"])]))
	ed.ui["skyImageName"] = label("", true, 12)
	b.add_child(hbox([button("Picture of the whole sky…", func():
		_pick_file(ed, ["*.jpg, *.jpeg, *.png, *.webp ; Pictures"], func(p: String):
			ed.sky_source = p
			TrackEditorIO.apply_env(ed)
			refresh(ed))), button("No picture", func():
		ed.sky_source = ""
		ed.sky_name = ""
		TrackEditorIO.apply_env(ed)
		refresh(ed)), ed.ui["skyImageName"]]))
	ed.ui["fogOn"] = check("Fog (the game uses the fog of its weather)", false, func(on: bool): set_env.call(["fog", "enabled"], on))
	b.add_child(ed.ui["fogOn"])
	ed.ui["fogColor"] = colour(e["fog"]["color"], func(c: Color): set_env.call(["fog", "color"], "#" + c.to_html(false)))
	ed.ui["fogNear"] = number(300, 0, 1e5, 50, func(v: float): set_env.call(["fog", "near"], v))
	ed.ui["fogFar"] = number(2500, 10, 1e5, 100, func(v: float): set_env.call(["fog", "far"], v))
	b.add_child(hbox([field("colour", ed.ui["fogColor"]), field("from (m)", ed.ui["fogNear"]), field("until (m)", ed.ui["fogFar"])]))
	ed.ui["sunAz"] = number(40, -360, 360, 5, func(v: float): set_env.call(["sun", "azimuth"], v))
	ed.ui["sunEl"] = number(45, 2, 90, 5, func(v: float): set_env.call(["sun", "elevation"], v))
	ed.ui["sunInt"] = number(1, 0, 3, 0.1, func(v: float): set_env.call(["sun", "intensity"], v))
	b.add_child(hbox([field("Sun direction (°)", ed.ui["sunAz"]), field("height (°)", ed.ui["sunEl"]), field("strength", ed.ui["sunInt"])]))
	ed.ui["sunColor"] = colour(e["sun"]["color"], func(c: Color): set_env.call(["sun", "color"], "#" + c.to_html(false)))
	ed.ui["ambColor"] = colour(e["ambient"]["color"], func(c: Color): set_env.call(["ambient", "color"], "#" + c.to_html(false)))
	ed.ui["ambInt"] = number(1, 0, 3, 0.1, func(v: float): set_env.call(["ambient", "intensity"], v))
	b.add_child(hbox([field("colour of the sun", ed.ui["sunColor"]), field("light of the sky", ed.ui["ambColor"]), field("strength of it", ed.ui["ambInt"])]))
	b.add_child(button("Back to the defaults", func():
		ed.env = TrackEditorIO.environment_defaults()
		ed.sky_source = ""
		ed.sky_name = ""
		TrackEditorIO.apply_env(ed)
		_fill_env(ed)))


static func _fill_env(ed: TrackEditor) -> void:
	var e := ed.env
	ed.set_meta("filling", true)
	ed.ui["envOn"].set_pressed_no_signal(ed.env_on)
	ed.ui["skyTop"].color = Color(str(e["sky_top"]))
	ed.ui["skyHorizon"].color = Color(str(e["sky_horizon"]))
	ed.ui["fogOn"].set_pressed_no_signal(bool(e["fog"]["enabled"]))
	ed.ui["fogColor"].color = Color(str(e["fog"]["color"]))
	ed.ui["fogNear"].set_value_no_signal(float(e["fog"]["near"]))
	ed.ui["fogFar"].set_value_no_signal(float(e["fog"]["far"]))
	ed.ui["sunAz"].set_value_no_signal(float(e["sun"]["azimuth"]))
	ed.ui["sunEl"].set_value_no_signal(float(e["sun"]["elevation"]))
	ed.ui["sunInt"].set_value_no_signal(float(e["sun"]["intensity"]))
	ed.ui["sunColor"].color = Color(str(e["sun"]["color"]))
	ed.ui["ambColor"].color = Color(str(e["ambient"]["color"]))
	ed.ui["ambInt"].set_value_no_signal(float(e["ambient"]["intensity"]))
	ed.remove_meta("filling")


# ---- the buttons of the cards

static func _fill_grid(ed: TrackEditor) -> void:
	if ed.grid.is_empty():
		ed.status("Place box 1 of the grid first (the start): the other boxes go behind it.", "error")
		return
	var b: Dictionary = ed.grid[0]
	var f := Vector2(cos(b["heading"]), sin(b["heading"]))
	var s := Vector2(-f.y, f.x)
	var gap := 4.5
	var road := func(x: float, z: float) -> bool:
		var q := ed.ground_y(x, z, float(b["y"]))
		return absf(q - float(b["y"])) < 1.5 and ed.part_role_at(x, z, float(b["y"])) in ["road", "track01"]
	var side := 1.0 if road.call(b["x"] + s.x * gap, b["z"] + s.y * gap) else (-1.0 if road.call(b["x"] - s.x * gap, b["z"] - s.y * gap) else 1.0)
	ed.grid = [b]
	for k in range(1, TrackEditor.GRID_MAX):
		var x: float = b["x"] - f.x * k * 4.0 + s.x * (k % 2) * gap * side
		var z: float = b["z"] - f.y * k * 4.0 + s.y * (k % 2) * gap * side
		ed.grid.append({"x": x, "y": ed.ground_y(x, z, b["y"]), "z": z, "heading": b["heading"]})
	ed.select("")
	ed.changed()
	ed.status("The grid has 8 boxes: two wide, behind box 1. Move one with a click on it and its handle.", "ok")


static func _fill_pit(ed: TrackEditor) -> void:
	if ed.pit_boxes.is_empty():
		ed.status("Place pit box 1 first (the player's): the other boxes follow it.", "error")
		return
	var b: Dictionary = ed.pit_boxes[0]
	ed.pit_boxes = [b]
	for k in range(1, TrackEditor.GRID_MAX):
		var x: float = b["x"] + cos(b["heading"]) * 10.0 * k
		var z: float = b["z"] + sin(b["heading"]) * 10.0 * k
		ed.pit_boxes.append({"x": x, "y": ed.ground_y(x, z, b["y"]), "z": z, "heading": b["heading"]})
	ed.select("")
	ed.changed()


static func _gate_at_start(ed: TrackEditor) -> void:
	if ed.grid.is_empty():
		ed.status("Place box 1 of the grid first (the start).", "error")
		return
	var s: Dictionary = ed.grid[0]
	var x: float = s["x"] + cos(s["heading"]) * 6.0
	var z: float = s["z"] + sin(s["heading"]) * 6.0
	ed.gates.push_front({"x": x, "y": ed.ground_y(x, z, s["y"]), "z": z, "heading": s["heading"], "width": maxf(2.0, ed.gate_width)})
	ed.changed()


static func _auto_gates(ed: TrackEditor, asked := false) -> void:
	if not ed.gates.is_empty() and not asked:
		var n := clampi(int(ed.ui["gatesCount"].value), 2, 40)
		ask(ed, "Replace the gates?", "The %d gates that are there go; %d new ones come along the line." % [ed.gates.size(), n], "Replace",
			func(): _auto_gates(ed, true))
		return
	var src := ed.line.line_source()
	if src.size() < 10:
		ed.status("Auto gates needs a racing line (draw one) or a road drawn with nodes.", "error")
		return
	if ed.grid.is_empty():
		ed.status("Place box 1 of the grid first: gate 1 goes in front of the start.", "error")
		return
	var start: Dictionary = ed.grid[0]
	var count := clampi(int(ed.ui["gatesCount"].value), 2, 40)
	var p: Array = src.map(func(q: Dictionary) -> Vector2: return Vector2(float(q["x"]), float(q["z"])))
	var near := 0
	var best := INF
	for i in p.size():
		var d := (p[i] as Vector2).distance_to(Vector2(start["x"], start["z"]))
		if d < best:
			best = d
			near = i
	var a: Vector2 = p[near]
	var b: Vector2 = p[(near + 1) % p.size()]
	if cos((b - a).angle() - float(start["heading"])) < 0.0:
		p.reverse()
		near = p.size() - 1 - near
	p = p.slice(near) + p.slice(0, near)
	var along: Array[float] = [0.0]
	for i in range(1, p.size() + 1):
		along.append(along[i - 1] + (p[i % p.size()] as Vector2).distance_to(p[i - 1]))
	var total: float = along[p.size()]
	ed.gates = []
	for k in count:
		var s := fposmod(6.0 + k * total / count, total)
		var i := 0
		while i < p.size() - 1 and along[i + 1] < s:
			i += 1
		var q: Vector2 = p[i]
		var r: Vector2 = p[(i + 1) % p.size()]
		var t := (s - along[i]) / maxf(1e-6, along[i + 1] - along[i])
		var g := q.lerp(r, t)
		ed.gates.append({"x": g.x, "y": ed.ground_y(g.x, g.y, start["y"]), "z": g.y, "heading": (r - q).angle(), "width": maxf(2.0, ed.gate_width)})
	ed.select("")
	ed.changed()
	ed.status("%d gates along the line (%d m), gate 1 just in front of the start. Check that each one is as wide as the road there." % [count, roundi(total)], "ok")


## Record AI racing line (track-editor.js recordLine): the line is recorded on the saved track, so the changes are saved
## first; a lap is counted through the gates, so there has to be one.
static func _record_line(ed: TrackEditor) -> void:
	if ed.existing_id == "":
		ed.status("Save the track first: the line is recorded on the saved track.", "error")
		return
	var go := func():
		if (ed.existing.get("gates", []) as Array).is_empty() and (ed.existing.get("checkpoints", []) as Array).is_empty():
			ed.status("Place a gate at the start first and save: a lap is counted through the gates.", "error")
			return
		ed.record_line.emit(ed.existing_id)
	if ed.history.unsaved():
		ask(ed, "Save the track first?", "The line is recorded on the saved track. Save the changes and drive it?", "Save and record", func():
			if TrackEditorIO.save(ed):
				go.call())
	else:
		go.call()


## Asks first when it is so (a bulk replace or clear: track-editor.js clearOk and the questions of gridAuto, pitAuto, gatesAuto), else does it.
static func confirm_if(ed: TrackEditor, cond: bool, title: String, text: String, ok: String, then: Callable) -> void:
	if cond:
		ask(ed, title, text, ok, then)
	else:
		then.call()


static func _test_drive(ed: TrackEditor) -> void:
	if ed.history.unsaved() or ed.existing_id == "":
		if not TrackEditorIO.save(ed):
			return
	ed.drive.emit(ed.existing_id)


static func _export(ed: TrackEditor) -> void:
	var dlg := FileDialog.new()
	dlg.file_mode = FileDialog.FILE_MODE_SAVE_FILE
	dlg.access = FileDialog.ACCESS_FILESYSTEM
	dlg.use_native_dialog = true
	dlg.filters = PackedStringArray(["*.zip ; Zip"])
	dlg.current_file = (ed.existing_id if ed.existing_id != "" else "track") + ".zip"
	dlg.file_selected.connect(func(p: String):
		TrackEditorIO.export_zip(ed, p)
		dlg.queue_free())
	dlg.canceled.connect(dlg.queue_free)
	ed.add_child(dlg)
	dlg.popup_centered_ratio(0.6)


static func _pick_file(ed: TrackEditor, filters: Array, done: Callable) -> void:
	var dlg := FileDialog.new()
	dlg.file_mode = FileDialog.FILE_MODE_OPEN_FILE
	dlg.access = FileDialog.ACCESS_FILESYSTEM
	dlg.use_native_dialog = true
	dlg.filters = PackedStringArray(filters)
	dlg.file_selected.connect(func(p: String):
		dlg.queue_free()
		done.call(p))
	dlg.canceled.connect(dlg.queue_free)
	ed.add_child(dlg)
	dlg.popup_centered_ratio(0.6)


## At the start (track-editor.js startDialog): open the track of last time again, open a track (the picker), make one from a height
## map, or a new track.
static func start_dialog(ed: TrackEditor) -> void:
	var dlg := AcceptDialog.new()
	dlg.title = "Track editor"
	dlg.ok_button_text = "New track"
	var v := VBoxContainer.new()
	v.custom_minimum_size.x = 440
	v.add_theme_constant_override("separation", 8)
	v.add_child(label("What do you want to do?", false, 13))
	var choice := func(title: String, hint: String, action: Callable) -> void:
		var b := Button.new()
		b.text = title + "\n" + hint
		b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		b.custom_minimum_size.y = 52
		b.pressed.connect(func():
			dlg.hide()
			dlg.queue_free()
			action.call())
		v.add_child(b)
	var last_id := str(Settings.get_value("editor_last_track"))
	var last: Array = ed.tracks.filter(func(t: Dictionary) -> bool: return t["id"] == last_id)
	if not last.is_empty():
		choice.call("Open “%s” again" % last[0].get("name", last_id), "The track you opened last", func(): TrackEditorIO.open(ed, last_id))
	choice.call("Open track", "%d tracks to change" % ed.tracks.size() if not ed.tracks.is_empty() else "There are no tracks yet", func():
		if not ed.tracks.is_empty():
			track_picker(ed))
	choice.call("Import height map", "A track from a height map (16 bit grey PNG) and a colour map", func(): _height_dialog(ed))
	choice.call("New track", "Start empty: import a model, or draw the road with nodes", func(): pass)
	dlg.add_child(v)
	dlg.confirmed.connect(dlg.queue_free)
	dlg.canceled.connect(dlg.queue_free)
	ed.add_child(dlg)
	dlg.popup_centered()


## Open track: every track a tile with its picture (preview.webp), a search by name or id; a click opens it.
static func track_picker(ed: TrackEditor) -> void:
	var dlg := AcceptDialog.new()
	dlg.title = "Open a track"
	dlg.ok_button_text = "Back"
	var v := VBoxContainer.new()
	v.custom_minimum_size = Vector2(640, 520)
	var search := LineEdit.new()
	search.placeholder_text = "Search by name or id"
	search.clear_button_enabled = true
	v.add_child(search)
	var sc := ScrollContainer.new()
	sc.size_flags_vertical = Control.SIZE_EXPAND_FILL
	sc.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	v.add_child(sc)
	var grid := GridContainer.new()
	grid.columns = 2
	grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	sc.add_child(grid)
	var tiles: Array = []
	var chosen := [false]
	for t in ed.tracks:
		var id: String = t["id"]
		var b := Button.new()
		b.text = "%s\n%s" % [t.get("name", id), id]
		b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		b.vertical_icon_alignment = VERTICAL_ALIGNMENT_TOP
		b.icon_alignment = HORIZONTAL_ALIGNMENT_LEFT
		b.expand_icon = false
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.custom_minimum_size = Vector2(300, 0)
		var pic := Content.path("tracks/%s/preview.webp" % id)
		var img := Image.load_from_file(pic) if FileAccess.file_exists(pic) else null
		if img != null and not img.is_empty():
			img.resize(288, 162, Image.INTERPOLATE_BILINEAR)
			b.icon = ImageTexture.create_from_image(img)
		b.set_meta("find", ("%s %s" % [t.get("name", ""), id]).to_lower())
		b.pressed.connect(func():
			chosen[0] = true
			dlg.hide()
			dlg.queue_free()
			TrackEditorIO.open(ed, id))
		grid.add_child(b)
		tiles.append(b)
	search.text_changed.connect(func(q: String):
		for b in tiles:
			(b as Button).visible = q.strip_edges() == "" or str((b as Button).get_meta("find")).contains(q.strip_edges().to_lower()))
	dlg.add_child(v)
	dlg.confirmed.connect(func():
		dlg.queue_free()
		start_dialog(ed))
	dlg.canceled.connect(func():
		dlg.queue_free()
		if not chosen[0]:
			start_dialog(ed))
	ed.add_child(dlg)
	dlg.popup_centered()
	search.grab_focus.call_deferred()


static func _height_dialog(ed: TrackEditor) -> void:
	var dlg := ConfirmationDialog.new()
	dlg.title = "Import height map"
	dlg.ok_button_text = "Make the track"
	var v := VBoxContainer.new()
	v.custom_minimum_size = Vector2(480, 0)
	var paths := {"height": "", "colour": "", "surface": ""}
	for k in [["height", "Height map (greyscale, 16 bit PNG: black is low, white is high)"], ["colour", "Colour map (a picture of the same square)"],
			["surface", "Surface map (optional: grey road, yellow sand, white gravel, brown mud, green grass, orange ground)"]]:
		var shown := label("none", true, 12)
		v.add_child(field(k[1], hbox([button("Choose…", func(): _pick_file(ed, ["*.png, *.jpg, *.jpeg, *.webp ; Pictures"], func(p: String):
			paths[k[0]] = p
			shown.text = p.get_file())), shown])))
	var size := number(1024, 10, 100000, 1, func(_v: float): pass)
	var top := number(60, 0, 10000, 1, func(_v: float): pass)
	var step := options(["every 2nd pixel (fine, heavy)", "every 4th pixel", "every 8th pixel (light)", "every pixel"], 1, func(_i: int): pass)
	var role := options(["Road", "Sand", "Gravel", "Mud", "Grass", "Ground"], 0, func(_i: int): pass)
	v.add_child(field("Size of the square (m)", size))
	v.add_child(field("Height of white (m)", top))
	v.add_child(field("Mesh", step))
	v.add_child(field("Surface (for the whole map, when there is no surface map)", role))
	dlg.add_child(v)
	dlg.confirmed.connect(func():
		if paths["height"] == "":
			ed.status("Choose the height map first.", "error")
			return
		TrackEditorIO.make_from_height_map(ed, paths["height"], {"size": size.value, "top": top.value, "step": [2, 4, 8, 1][step.selected],
			"role": ["road", "sand", "gravel", "mud", "grass", "ground"][role.selected], "colour": paths["colour"], "surface": paths["surface"]})
		dlg.queue_free())
	dlg.canceled.connect(dlg.queue_free)
	ed.add_child(dlg)
	dlg.popup_centered()


## A question with OK and Cancel.
static func ask(ed: TrackEditor, title: String, text: String, ok: String, then: Callable, otherwise := Callable()) -> void:
	if Content.arg("editor-yes") != "":
		then.call()
		return
	var dlg := ConfirmationDialog.new()
	dlg.title = title
	dlg.dialog_text = text
	dlg.ok_button_text = ok
	dlg.confirmed.connect(func():
		dlg.queue_free()
		then.call())
	dlg.canceled.connect(func():
		dlg.queue_free()
		if otherwise.is_valid():
			otherwise.call())
	ed.add_child(dlg)
	dlg.popup_centered()


## A line of text asked for (the browser's prompt): then.call(text), "" when it was cancelled.
static func ask_text(ed: TrackEditor, title: String, text: String, then: Callable) -> void:
	var dlg := ConfirmationDialog.new()
	dlg.title = title
	var v := VBoxContainer.new()
	v.add_child(label(text, true))
	v.custom_minimum_size.x = 420
	var edit := LineEdit.new()
	v.add_child(edit)
	dlg.add_child(v)
	var done := [false]
	var finish := func(answer: String):
		if done[0]:
			return
		done[0] = true
		dlg.queue_free()
		then.call(answer)
	dlg.confirmed.connect(func(): finish.call(edit.text.strip_edges()))
	edit.text_submitted.connect(func(t: String): finish.call(t.strip_edges()))
	dlg.canceled.connect(func(): finish.call(""))
	ed.add_child(dlg)
	dlg.popup_centered()
	edit.grab_focus.call_deferred()


static func ask_number(ed: TrackEditor, title: String, text: String, value: float, then: Callable) -> void:
	var dlg := ConfirmationDialog.new()
	dlg.title = title
	var v := VBoxContainer.new()
	v.add_child(label(text))
	var n := number(snappedf(value, 0.1), 0, 1e6, 0.1, func(_v: float): pass)
	v.add_child(n)
	dlg.add_child(v)
	dlg.confirmed.connect(func():
		dlg.queue_free()
		then.call(n.value))
	dlg.canceled.connect(func():
		dlg.queue_free()
		then.call(0.0))
	ed.add_child(dlg)
	dlg.popup_centered()


static func toggle_help(ed: TrackEditor) -> void:
	(ed.ui["help"] as Control).visible = not (ed.ui["help"] as Control).visible


static func drag_length(ed: TrackEditor) -> float:
	var i: int = ed.ui["dragLength"].selected
	var lengths := [201.168, 304.8, 402.336, 804.672, 1000.0, 1609.344]
	return lengths[i] if i < lengths.size() else clampf(float(ed.ui["dragOwn"].value), 50.0, 5000.0)


static func drag_width(ed: TrackEditor) -> float:
	return maxf(3.0, float(ed.ui["dragWidth"].value))


static func camera_height(ed: TrackEditor) -> float:
	return maxf(0.5, float(ed.ui["cameraHeight"].value))


## The drag strip that was loaded: the window shows its distance.
static func show_drag(ed: TrackEditor) -> void:
	if ed.drag.is_empty():
		return
	var lengths := [201.168, 304.8, 402.336, 804.672, 1000.0, 1609.344]
	var idx := 6
	for i in lengths.size():
		if absf(lengths[i] - float(ed.drag["length"])) < 0.5:
			idx = i
	ed.ui["dragLength"].select(idx)
	ed.ui["dragOwn"].set_value_no_signal(roundf(ed.drag["length"]))
	ed.ui["dragWidth"].set_value_no_signal(ed.drag["width"])


# ---- refresh: the lists and the notes of the cards

static func refresh(ed: TrackEditor) -> void:
	if not ed.ui.has("cards"):
		return
	_parts_list(ed)
	_ready_list(ed)
	_list(ed.ui["gridList"], ed.grid, func(i: int) -> String: return "Box 1 (start)" if i == 0 else "Box %d" % (i + 1), "grid", ed)
	_list(ed.ui["pitList"], ed.pit_boxes, func(i: int) -> String: return "Pit box 1 (player)" if i == 0 else "Pit box %d" % (i + 1), "pit", ed)
	_list(ed.ui["gatesList"], ed.gates, func(i: int) -> String: return ("Gate 1 (finish)" if i == 0 else "Gate %d" % (i + 1)) + ", %d m wide" % roundi(ed.gates[i]["width"]),
		"gate", ed)
	_list(ed.ui["cameraList"], ed.cameras, func(i: int) -> String: return "Camera %d" % (i + 1), "camera", ed)
	_list(ed.ui["objectList"], ed.objects, func(i: int) -> String: return str(ed.objects[i]["model"]).trim_prefix("obj-").trim_suffix(".glb"), "object", ed)
	ed.ui["gateNote"].text = "%d boxes, %d gates" % [ed.grid.size(), ed.gates.size()]
	ed.ui["pitNote"].text = "%d boxes%s" % [ed.pit_boxes.size(), ", a pit line" if ed.pit_line.size() >= 2 else ""]
	ed.ui["pitLineNote"].text = "%d points" % ed.pit_line.size() if not ed.pit_line.is_empty() else "No pit line."
	ed.ui["oldPit"].visible = not ed.pit_polygon.is_empty()
	ed.ui["oldPitText"].text = "The old pit area (%d points) is still in the track" % ed.pit_polygon.size()
	ed.ui["cameraNote"].text = "%d" % ed.cameras.size() if not ed.cameras.is_empty() else "none"
	ed.ui["objectNote"].text = "%d placed" % ed.objects.size() if not ed.objects.is_empty() else ("%d models" % ed.models.size() if not ed.models.is_empty() else "none")
	ed.ui["curbNote"].text = "%d curb%s" % [ed.curbs.size(), "" if ed.curbs.size() == 1 else "s"] if not ed.curbs.is_empty() else "none"
	ed.ui["trackNote"].text = ("changing “%s”" % ed.existing_id) if ed.existing_id != "" else "a new track"
	ed.ui["modelNote"].text = ("Designed track: %d nodes, %d prefabs" % [(ed.design.data["nodes"] as Array).size(), (ed.design.data["prefabs"] as Array).size()]
		if ed.design != null else (ed.model_file + ", %d parts" % ed.parts.size() if ed.model_root != null else "No model loaded."))
	ed.ui["refNote"].text = str(ed.reference.get("image", "none")) if not ed.reference.is_empty() else "none"
	ed.ui["skyImageName"].text = ed.sky_source.get_file() if ed.sky_source != "" else ed.sky_name
	var raw: Array = ed.existing.get("racing_line", [])
	ed.ui["lineNote"].text = ("save the track first" if ed.existing_id == "" else ("recorded, %d points" % raw.size() if raw.size() > 10
		else ("the middle of the road (not recorded)" if ed.design != null else "none: the AI cannot race here")))
	ed.ui["lineIdle"].visible = not ed.line_edit["editing"]
	ed.ui["lineEdit"].visible = ed.line_edit["editing"]
	ed.ui["showLine"].visible = not ed.line_edit["editing"]
	ed.ui["objectPrefabs"].visible = ed.design == null
	_ref_fields(ed)
	_curb_fields(ed)
	_object_model(ed)
	_library(ed)
	if not ed.has_meta("filling"):
		ed.ui["showGates"].set_pressed_no_signal(ed.show_gates)
		_fill_env(ed)
	TrackEditorPanels.refresh(ed)


static func _list(box: VBoxContainer, items: Array, name_of: Callable, kind: String, ed: TrackEditor) -> void:
	var key := "%s|%s|%s" % [items.size(), JSON.stringify(items).hash(), ed.sel]
	if box.get_meta("key", "") == key:
		return
	box.set_meta("key", key)
	for c in box.get_children():
		c.free()
	for i in items.size():
		var it: Dictionary = items[i]
		var b := Button.new()
		b.text = "%s   %d, %d" % [name_of.call(i), roundi(it["x"]), roundi(it["z"])]
		b.flat = true
		b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.focus_mode = Control.FOCUS_NONE
		if ed.sel["kind"] == kind and ed.sel["i"] == i:
			b.add_theme_color_override("font_color", Color("ffd04d"))
		b.pressed.connect(func(): ed.select("" if ed.sel["kind"] == kind and ed.sel["i"] == i else kind, i))
		var x := button("×", func():
			items.remove_at(i)
			if kind == "object":
				ed.parts_kit.show_objects()
			ed.select("")
			ed.changed(), "Remove")
		box.add_child(hbox([b, x]))


static func _ready_list(ed: TrackEditor) -> void:
	var box: VBoxContainer = ed.ui["readyList"]
	for c in box.get_children():
		c.free()
	var bad := 0
	var warn := 0
	for it in TrackEditorIO.ready_items(ed):
		var mark: Array = {"ok": ["✓", Color("4ed88a")], "warn": ["!", Color("ffc04d")], "bad": ["✗", Color("ff6a5a")]}[it[0]]
		var m := label(mark[0])
		m.add_theme_color_override("font_color", mark[1])
		m.custom_minimum_size.x = 14
		var t := label(it[1], false, 12)
		t.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		box.add_child(hbox([m, t]))
		if it[0] == "bad":
			bad += 1
		elif it[0] == "warn":
			warn += 1
	var note: Label = ed.ui["readyNote"]
	note.text = "%d to do" % bad if bad > 0 else ("ready, %d to check" % warn if warn > 0 else "ready")
	note.add_theme_color_override("font_color", Color("ff6a5a") if bad > 0 else (Color("ffc04d") if warn > 0 else Color("4ed88a")))


static func _ref_fields(ed: TrackEditor) -> void:
	var r := ed.reference
	ed.ui["refControls"].visible = not r.is_empty()
	if r.is_empty():
		return
	ed.set_meta("filling", true)
	ed.ui["refOpacity"].set_value_no_signal(float(r.get("opacity", 0.5)) * 100.0)
	ed.ui["refShow"].set_pressed_no_signal(bool(r.get("show", true)))
	ed.ui["refTop"].set_pressed_no_signal(bool(r.get("top", true)))
	for k in [["refWidth", "width"], ["refRotation", "rotation"], ["refX", "x"], ["refZ", "z"], ["refY", "y"]]:
		ed.ui[k[0]].set_value_no_signal(float(r.get(k[1], 0)))
	ed.remove_meta("filling")


static func _curb_fields(ed: TrackEditor) -> void:
	var on: bool = ed.sel["kind"] == "curb" and ed.sel["i"] < ed.curbs.size()
	ed.ui["curbEdit"].visible = on
	if not on:
		ed.ui["curbInfo"].text = "Click on the road to start a curb." if ed.mode == "curb" else ""
		return
	var c: Dictionary = ed.curbs[ed.sel["i"]]
	var length := 0.0
	var pts: Array = c["points"]
	for k in range(1, pts.size()):
		length += Vector2(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]).length()
	ed.ui["curbInfo"].text = "Curb %d: %d nodes, %d m%s" % [ed.sel["i"] + 1, (c["nodes"] as Array).size(), roundi(length),
		", node %d chosen" % (ed.sel["node"] + 1) if ed.sel["node"] >= 0 else ""]
	ed.set_meta("filling", true)
	ed.ui["curbWidth"].set_value_no_signal(c["width"])
	ed.ui["curbHeight"].set_value_no_signal(c["height"])
	ed.ui["curbColour"].select(maxi(0, CURB_COLOURS.find(c["colour"])))
	ed.ui["curbConnect"].set_pressed_no_signal(c.get("connect", false))
	var node_on: bool = ed.sel["node"] >= 0 and ed.sel["node"] < (c["nodes"] as Array).size()
	ed.ui["curbNodeBox"].visible = node_on
	if node_on:
		var n: Array = c["nodes"][ed.sel["node"]]
		ed.ui["curbSize"].set_value_no_signal(Curbs.size_of(n))
		ed.ui["curbOffsetBox"].visible = c.get("connect", false)
		ed.ui["curbOffset"].set_value_no_signal(n[4] if n.size() > 4 else 0.0)
	ed.remove_meta("filling")


## The settings of the model that Place object puts down: where it stands (the middle of its base or the origin of the file), its kind and mass.
static func _object_model(ed: TrackEditor) -> void:
	var box: VBoxContainer = ed.ui["objectModel"]
	var key := "%s|%s" % [ed.object_model, ed.models.get(ed.object_model, {}).get("kind", "")]
	if box.get_meta("key", "") == key:
		return
	box.set_meta("key", key)
	for c in box.get_children():
		c.free()
	if not ed.models.has(ed.object_model):
		return
	var m: Dictionary = ed.models[ed.object_model]
	var count := ed.objects.filter(func(o: Dictionary) -> bool: return o["model"] == ed.object_model).size()
	box.add_child(label("%s (%d placed)" % [ed.object_model.trim_prefix("obj-").trim_suffix(".glb"), count]))
	var kinds := ["rigid", "static", "decor"]
	var kind := options(["Rigid", "Static", "Decor"], maxi(0, kinds.find(m["kind"])), func(i: int):
		m["kind"] = kinds[i]
		TrackEditorIO.remember_in_library(ed, m)
		ed.changed())
	var origin := options(["Origin: middle of the base", "Origin: as in the file"], 0 if m.get("pivot") != null else 1, func(i: int):
		m["pivot"] = m["base"] if i == 0 else null
		ed.parts_kit.show_objects()
		ed.changed())
	var mass := number(float(m.get("mass", 0)), 0, 1e6, 5, func(v: float):
		m["mass"] = v
		TrackEditorIO.remember_in_library(ed, m))
	mass.tooltip_text = "kg (0: from its size)"
	box.add_child(hbox([origin, kind, mass]))
	box.add_child(hbox([button("Place", func(): ed.set_mode("object")), button("Remove from the track", func():
		var name := ed.object_model
		confirm_if(ed, ed.objects.any(func(o: Dictionary) -> bool: return o["model"] == name), "Remove this model?",
			"The objects that stand in the track go too.", "Remove", func():
				ed.models.erase(name)
				ed.objects = ed.objects.filter(func(o: Dictionary) -> bool: return o["model"] != name)
				ed.object_model = ""
				ed.parts_kit.show_objects()
				ed.select("")
				ed.changed()))]))


static func _library(ed: TrackEditor) -> void:
	var flow: HFlowContainer = ed.ui["objectLibrary"]
	var lib: Array = ed.get_meta("library") if ed.has_meta("library") else TrackEditorIO.library(ed)
	var key := "%s|%s|%s" % [lib.size(), ed.models.keys(), ed.object_model]
	if flow.get_meta("key", "") == key:
		return
	flow.set_meta("key", key)
	for c in flow.get_children():
		c.free()
	for e in lib:
		var file := "obj-%s.glb" % e["id"]
		var b := button(str(e["name"]), func():
			if ed.models.has(file):
				ed.object_model = file
				ed.set_mode("object")
			else:
				TrackEditorIO.add_model(ed, e["path"], file, e["kind"], e["mass"]), "Click to place it in the track")
		_tile(b)
		var img := Image.load_from_file(e["thumb"]) if FileAccess.file_exists(e["thumb"]) else null
		if img != null and not img.is_empty():
			b.icon = _icon(ImageTexture.create_from_image(img))
		else:
			# (a model without its picture: one is drawn, as the browser draws the models of a track)
			var path: String = e["path"]
			ed.thumbs.request(path, func() -> Node3D: return ModelThumbs.load_glb(path), _set_icon.bind(b))
		if ed.object_model == file:
			b.add_theme_color_override("font_color", Color("ffd04d"))
		if TrackEditorIO.library_writable(e["path"]):
			var x := Button.new()
			x.text = "×"
			x.flat = true
			x.tooltip_text = "Take it out of the library (the tracks that use it keep their copy)"
			x.pressed.connect(func():
				ask(ed, "Take “%s” out of the library?" % e["name"], "The tracks that use it keep their own copy.", "Remove", func():
					TrackEditorIO.remove_from_library(ed, e)
					refresh(ed)))
			b.add_child(x)
			x.set_anchors_preset(Control.PRESET_TOP_RIGHT)
			x.position = Vector2(-22, 0)
		flow.add_child(b)
	# the models of this track that the library has not got
	for name in ed.models:
		if lib.any(func(e: Dictionary) -> bool: return "obj-%s.glb" % e["id"] == name):
			continue
		var b := button(str(name).trim_prefix("obj-").trim_suffix(".glb") + " (track)", func():
			ed.object_model = name
			ed.set_mode("object"))
		_tile(b)
		b.tooltip_text = "A model of this track: click to place it. + keeps it in the library."
		var keep := Button.new()
		keep.text = "+"
		keep.flat = true
		keep.tooltip_text = "Keep it in the library"
		keep.pressed.connect(func():
			if TrackEditorIO.keep_in_library(ed, name):
				ed.status("Kept in the library.", "ok")
				refresh(ed))
		b.add_child(keep)
		keep.set_anchors_preset(Control.PRESET_TOP_RIGHT)
		keep.position = Vector2(-22, 0)
		var m: Dictionary = ed.models[name]
		if m.get("scene") is Node3D:
			ed.thumbs.request("track:%s:%s" % [name, m.get("source", "")], func() -> Node3D: return (m["scene"] as Node3D).duplicate(), _set_icon.bind(b))
		if ed.object_model == name:
			b.add_theme_color_override("font_color", Color("ffd04d"))
		flow.add_child(b)


## A tile of the library: the picture above the name.
static func _tile(b: Button) -> void:
	b.icon_alignment = HORIZONTAL_ALIGNMENT_CENTER
	b.vertical_icon_alignment = VERTICAL_ALIGNMENT_TOP
	b.custom_minimum_size = Vector2(84, 0)
	b.clip_text = true


static func _icon(tex: Texture2D) -> Texture2D:
	var img := tex.get_image()
	if img == null or img.is_empty():
		return null
	img.resize(64, 64, Image.INTERPOLATE_LANCZOS)
	return ImageTexture.create_from_image(img)


static func _set_icon(tex: Texture2D, b: Button) -> void:
	if tex != null and is_instance_valid(b):
		b.icon = _icon(tex)
