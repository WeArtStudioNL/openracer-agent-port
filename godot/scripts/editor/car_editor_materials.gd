class_name CarEditorMaterials
extends RefCounted
## The materials of the model and the changes to them (web/js/MaterialOverrides.js and the Materials window of the car
## editor): a model does not always arrive the way it looked in Blender (the glass of many models becomes opaque white
## metal), so a material can be set right with a preset or by hand. The changes are saved with the car (car.json
## "materials": { material name: { color, metalness, roughness, opacity, clearcoat, clearcoatRoughness, envMapIntensity } }).
## The paint of the tuning settings (the materials carpaint and rimpaint, CarModel.paint) is laid on top.

const PRESETS := {
	"Glass": {"color": "#0b1116", "metalness": 0, "roughness": 0.04, "opacity": 0.3, "clearcoat": 0, "envMapIntensity": 1.2},
	"Car paint": {"metalness": 0.5, "roughness": 0.28, "clearcoat": 1, "clearcoatRoughness": 0.03, "opacity": 1},
	"Chrome": {"color": "#ffffff", "metalness": 1, "roughness": 0.05, "clearcoat": 0, "opacity": 1},
	"Rubber": {"color": "#0a0a0a", "metalness": 0, "roughness": 0.9, "clearcoat": 0, "opacity": 1},
	"Black plastic": {"color": "#101010", "metalness": 0, "roughness": 0.45, "clearcoat": 0, "opacity": 1},
	"Brushed metal": {"color": "#b8bcc2", "metalness": 1, "roughness": 0.4, "clearcoat": 0, "opacity": 1},
}
const FIELDS := [["metalness", "Metalness", 0.0, 1.0, 0.05], ["roughness", "Roughness", 0.0, 1.0, 0.05], ["opacity", "Opacity", 0.0, 1.0, 0.05],
	["clearcoat", "Clear coat", 0.0, 1.0, 0.05], ["clearcoatRoughness", "Coat roughness", 0.0, 1.0, 0.05], ["envMapIntensity", "Reflection", 0.0, 5.0, 0.1]]

var ed: CarEditor
var _materials := {}                 # name -> [BaseMaterial3D]
var _dialog: Dictionary = {}


func _init(editor: CarEditor) -> void:
	ed = editor


func build_card() -> void:
	var c := ed.add_card("Materials")
	var r := EditorStyle.row(c["body"])
	r.add_child(EditorStyle.hint("Fix glass, paint or chrome that arrived wrong"))
	var open := EditorStyle.button("Materials…", "small")
	open.pressed.connect(func():
		render()
		(_dialog["window"] as Window).popup_centered())
	r.add_child(open)
	_dialog = EditorStyle.dialog(ed, "Materials", Vector2(620, 600))


static func values_of(m: BaseMaterial3D) -> Dictionary:
	return {"color": "#" + m.albedo_color.to_html(false), "metalness": m.metallic, "roughness": m.roughness, "opacity": m.albedo_color.a,
		"clearcoat": m.clearcoat if m.clearcoat_enabled else 0.0, "clearcoatRoughness": m.clearcoat_roughness, "envMapIntensity": 1.0,
		"transparency": m.transparency}


## The materials of a model, every one once, with what they were as made.
func collect(root: Node) -> void:
	_materials = {}
	for n in root.find_children("*", "MeshInstance3D", true, false):
		var mi := n as MeshInstance3D
		if mi.mesh == null:
			continue
		for i in mi.mesh.get_surface_count():
			var m := mi.mesh.surface_get_material(i) as BaseMaterial3D
			if m == null or m.resource_name == "":
				continue
			if not m.has_meta("original"):
				m.set_meta("original", values_of(m))
			if not _materials.has(m.resource_name):
				_materials[m.resource_name] = []
			if not m in _materials[m.resource_name]:
				_materials[m.resource_name].append(m)


func names() -> Array:
	return _materials.keys()


func has_material(n: String) -> bool:
	return _materials.has(n)


## A material without a map that is opaque (the glass that the exporter did not understand).
func plain_opaque(n: String) -> bool:
	for m in _materials.get(n, []):
		var b := m as BaseMaterial3D
		if b.albedo_texture != null or b.transparency != BaseMaterial3D.TRANSPARENCY_DISABLED or b.albedo_color.a < 1.0:
			return false
	return true


## A material as it was in the model, with an override (or none) on it.
static func apply_override(m: BaseMaterial3D, o: Variant) -> void:
	var v: Dictionary = (m.get_meta("original") as Dictionary).duplicate() if m.has_meta("original") else values_of(m)
	if o is Dictionary:
		v.merge(o, true)
	var c := Color(str(v["color"]))
	var opacity := float(v["opacity"])
	m.albedo_color = Color(c.r, c.g, c.b, opacity)
	m.metallic = float(v["metalness"])
	m.roughness = float(v["roughness"])
	m.clearcoat_enabled = float(v["clearcoat"]) > 0.0
	m.clearcoat = float(v["clearcoat"])
	m.clearcoat_roughness = float(v["clearcoatRoughness"])
	m.metallic_specular = clampf(0.5 * float(v["envMapIntensity"]), 0.0, 1.0)
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA if opacity < 1.0 else int(v.get("transparency", BaseMaterial3D.TRANSPARENCY_DISABLED))


func apply(n: String) -> void:
	for m in _materials.get(n, []):
		apply_override(m, ed.overrides.get(n))
	apply_paint()


func apply_all() -> void:
	for n in _materials:
		for m in _materials[n]:
			apply_override(m, ed.overrides.get(n))
	apply_paint()


## The paint of the body and the rims (colors of car.json) on the model and the library wheels.
func apply_paint() -> void:
	for root in [ed.model_root, ed.view.lib_preview]:
		if root == null:
			continue
		for n in (root as Node).find_children("*", "MeshInstance3D", true, false):
			var mi := n as MeshInstance3D
			if mi.mesh == null:
				continue
			for i in mi.mesh.get_surface_count():
				if mi.get_surface_override_material(i) != null and mi.has_meta("painted"):
					mi.set_surface_override_material(i, null)
		var body: Variant = Tuning.read(ed.cfg, "colors.body")
		var rim: Variant = Tuning.read(ed.cfg, "colors.rim")
		var bf: Variant = Tuning.read(ed.cfg, "colors.bodyFinish")
		var rf: Variant = Tuning.read(ed.cfg, "colors.rimFinish")
		if (body is String and str(body) != "") or (rim is String and str(rim) != ""):
			CarModel.paint(root, Color(str(body)) if body is String and str(body) != "" else null, str(bf) if bf is String and str(bf) != "" else "gloss",
				Color(str(rim)) if rim is String and str(rim) != "" else null, str(rf) if rf is String and str(rf) != "" else "metallic")
			for n in (root as Node).find_children("*", "MeshInstance3D", true, false):
				(n as Node).set_meta("painted", true)


## A colour of car.json (colors.body, colors.rim), or null for the colour of the model.
func colour_of(path: String) -> Variant:
	var v: Variant = Tuning.read(ed.cfg, path)
	return Color(str(v)) if v is String and str(v) != "" else null


## The window: a material each, with a preset, Reset and its fields.
func render() -> void:
	if _dialog.is_empty():
		return
	var box: VBoxContainer = _dialog["body"]
	for c in box.get_children():
		c.queue_free()
	box.add_child(EditorStyle.tipline("Fix materials that arrived wrong", "The materials of the model are physically based and used as they are. A model does not " +
		"always arrive the way it looked in Blender (the glass of many models becomes opaque white metal): set such a material right with a preset or by hand. " +
		"The changes are saved with the car."))
	if _materials.is_empty():
		box.add_child(EditorStyle.hint("The model has no named materials." if ed.model_root != null else "Load a model to see its materials."))
		return
	for n in _materials:
		_material_row(box, str(n))


func _material_row(box: VBoxContainer, n: String) -> void:
	var panel := PanelContainer.new()
	var changed: bool = ed.overrides.has(n) and not (ed.overrides[n] as Dictionary).is_empty()
	panel.add_theme_stylebox_override("panel", EditorStyle.box(EditorStyle.CARD, 8, 1, EditorStyle.ACCENT2 if changed else EditorStyle.LINE))
	box.add_child(panel)
	var col := VBoxContainer.new()
	panel.add_child(col)
	var head := HBoxContainer.new()
	var count: int = (_materials[n] as Array).size()
	var title := EditorStyle.label(n + (" (%dx)" % count if count > 1 else ""), 13, EditorStyle.TEXT, false)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title.clip_text = true
	head.add_child(title)
	var presets := [["", "Preset…"]]
	for p in PRESETS:
		presets.append([p, p])
	var pick := EditorStyle.options(presets)
	pick.custom_minimum_size.x = 130
	pick.size_flags_horizontal = Control.SIZE_FILL
	pick.item_selected.connect(func(_i: int):
		var p := str(EditorStyle.value_of(pick))
		if p == "":
			return
		var o: Dictionary = ed.overrides.get(n, {})
		o.merge(PRESETS[p], true)
		ed.overrides[n] = o
		apply(n)
		render()
		ed.changed())
	head.add_child(pick)
	var reset := EditorStyle.button("Reset", "small", "Back to the material of the model")
	reset.pressed.connect(func():
		ed.overrides.erase(n)
		apply(n)
		render()
		ed.changed())
	head.add_child(reset)
	col.add_child(head)
	var first: BaseMaterial3D = _materials[n][0]
	var v: Dictionary = (first.get_meta("original") as Dictionary).duplicate() if first.has_meta("original") else values_of(first)
	v.merge(ed.overrides.get(n, {}), true)
	var grid := GridContainer.new()
	grid.columns = 4
	col.add_child(grid)
	var colour := ColorPickerButton.new()
	colour.color = Color(str(v["color"]))
	colour.edit_alpha = false
	colour.custom_minimum_size = Vector2(80, 26)
	colour.color_changed.connect(func(c: Color): _change(n, "color", "#" + c.to_html(false)))
	grid.add_child(EditorStyle.labelled(colour, "Colour"))
	for f in FIELDS:
		var num := EditorStyle.NumberField.new("", f[4], f[2], f[3])
		num.custom_minimum_size.x = 110
		num.set_value(snappedf(float(v.get(f[0], 0.0)), 0.001))
		num.committed.connect(func(x: float):
			if not is_nan(x):
				_change(n, f[0], x))
		grid.add_child(EditorStyle.labelled(num, f[1]))


func _change(n: String, field: String, value: Variant) -> void:
	var o: Dictionary = ed.overrides.get(n, {})
	o[field] = value
	ed.overrides[n] = o
	apply(n)
	ed.changed()
