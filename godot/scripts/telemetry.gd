class_name Telemetry
extends CanvasLayer
## The telemetry (web/js/Telemetry.js), on and off with V: every simple value of the car and of each of its wheels (the
## numbers, the switches, the texts and the vectors of their scripts), ten times a second, in five columns: the car and
## the four wheels. (--telemetry opens it at the start)

const EVERY := 0.1

var world: Node
var shown := false

var _panel: PanelContainer
var _columns: Array[Label] = []
var _wait := 0.0


func setup(w: Node) -> void:
	world = w
	name = "Telemetry"
	layer = 7


func _ready() -> void:
	_panel = PanelContainer.new()
	_panel.set_anchors_preset(Control.PRESET_FULL_RECT)
	_panel.offset_left = 16
	_panel.offset_right = -16
	_panel.offset_top = 60
	_panel.offset_bottom = -16
	_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.055, 0.07, 0.094, 0.78)
	style.set_corner_radius_all(8)
	style.set_content_margin_all(8)
	_panel.add_theme_stylebox_override("panel", style)
	add_child(_panel)
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_AUTO
	_panel.add_child(scroll)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 18)
	scroll.add_child(row)
	var font := SystemFont.new()
	font.font_names = PackedStringArray(["Menlo", "Consolas", "DejaVu Sans Mono", "monospace"])
	for i in 5:
		var l := Label.new()
		l.add_theme_font_override("font", font)
		l.add_theme_font_size_override("font_size", 11)
		l.add_theme_color_override("font_color", Color(0.88, 0.92, 0.96))
		l.custom_minimum_size.x = 250
		l.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
		row.add_child(l)
		_columns.append(l)
	_panel.visible = false
	if Content.arg("telemetry") != "":
		set_shown(true)


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("telemetry"):
		set_shown(not shown)
		get_viewport().set_input_as_handled()


func set_shown(value: bool) -> void:
	shown = value
	_panel.visible = shown
	_wait = 0.0


func _process(delta: float) -> void:
	if not shown or world == null or world.car == null:
		return
	_wait -= delta
	if _wait > 0.0:
		return
	_wait = EVERY
	var car: Car = world.car
	_columns[0].text = "CAR\n" + _values(car)
	for i in mini(4, car.wheels.size()):
		_columns[i + 1].text = "WHEEL %s\n%s" % [car.wheels[i].slot, _values(car.wheels[i])]


## Every script variable of the object that is a number, a switch, a text or a vector, one per line.
static func _values(o: Object) -> String:
	var lines := PackedStringArray()
	for p in o.get_property_list():
		if not (int(p["usage"]) & PROPERTY_USAGE_SCRIPT_VARIABLE):
			continue
		var v: Variant = o.get(p["name"])
		match typeof(v):
			TYPE_FLOAT:
				lines.append("%s: %s" % [p["name"], snappedf(v, 0.0001)])
			TYPE_INT, TYPE_BOOL, TYPE_STRING, TYPE_STRING_NAME:
				lines.append("%s: %s" % [p["name"], v])
			TYPE_VECTOR2, TYPE_VECTOR3:
				lines.append("%s: (%s)" % [p["name"], ", ".join(Array(_parts(v)).map(func(x): return str(snappedf(x, 0.001))))])
	return "\n".join(lines)


static func _parts(v: Variant) -> PackedFloat64Array:
	if v is Vector2:
		return PackedFloat64Array([v.x, v.y])
	return PackedFloat64Array([v.x, v.y, v.z])
