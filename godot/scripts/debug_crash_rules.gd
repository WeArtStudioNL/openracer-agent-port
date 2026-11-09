class_name DebugCrashRules
extends VBoxContainer
## The rules of a crash of a motorcycle in the panel of the debug view (DebugView.js crashSection): each rule ticked on or
## off with its limits (Motorcycle.crash_rules, kept in VideoPrefs), how the rider gives with the g-forces
## (Motorcycle.feel), Back to the standard rules, and a line with what the bike gets now: the push of the road and the
## things on its body (kN) and the g, the most of the last second, so that a limit can be set from a knock that should
## or should not put the rider down. Folded away under its title; shown for a motorcycle.

## [rule, text, field (null: only the tick), lo, hi, step, unit]
const ROWS := [
	["lean", "Lean past", "deg", 40.0, 120.0, 1.0, "deg"],
	["lowside", "Lowside: a slide past", "slip", 5.0, 80.0, 1.0, "deg"], ["lowside", "Lowside: leaning more than", "lean", 0.0, 70.0, 1.0, "deg"],
	["lowside", "Lowside: for", "time", 0.2, 8.0, 0.1, "s"],
	["spin", "Spin faster than", "rate", 1.0, 20.0, 0.5, "rad/s"],
	["over", "On its back", null, 0.0, 0.0, 0.0, ""],
	["rider", "The head, the chest, the hips or a shoulder of the rider touch the ground", null, 0.0, 0.0, 0.0, ""],
	["blow", "A blow of more than", "g", 2.0, 40.0, 0.5, "g"],
	["hit", "Speed lost in 0.1 s more than", "loss", 2.0, 40.0, 0.5, "m/s"],
	["wall", "The body hits something faster than", "kmh", 5.0, 150.0, 1.0, "km/h"],
	["force", "Only when the ground or a thing pushes on the bike with more than", "kN", 1.0, 200.0, 1.0, "kN"],
]
const FEEL_ROWS := [["amount", "Rider gives with the g-forces", 0.0, 3.0, 0.05, ""], ["hz", "Comes back at", 0.3, 4.0, 0.05, "Hz"],
	["damping", "Damping", 0.05, 1.5, 0.05, ""]]
## The name of each rule on its tick (the panel is narrow: the limits have the long text).
const TICKS := {"lean": "Lean", "lowside": "Lowside", "spin": "Spin", "over": "On its back", "rider": "Rider on the ground", "blow": "Blow", "hit": "Hit",
	"wall": "Wall", "force": "Only hard hits"}
const MUTED := Color(0.62, 0.69, 0.77)
## The rule of a crash in words, and the unit of its limit.
const NAMES := {"lean": "Lean", "lowside": "Lowside", "spin": "Spin", "over": "On its back", "blow": "Blow", "hit": "Hit", "wall": "Wall", "rider": "Rider on the ground", "limp-lean": "Limp rider tipped it over", "limp-still": "Limp rider stopped", "limp-off": "Rider off (limp)"}
const UNITS := {"lean": "°", "lowside": "s", "spin": "rad/s", "blow": "g", "hit": "m/s", "wall": "km/h"}

var world: Node
var _body: VBoxContainer
var _meter: Label
var _last: Label
var _peaks: Array = []
var _clock := 0.0


func setup(w: Node) -> void:
	world = w
	add_theme_constant_override("separation", 3)
	var head := Button.new()
	head.flat = true
	head.alignment = HORIZONTAL_ALIGNMENT_LEFT
	head.focus_mode = Control.FOCUS_NONE
	head.add_theme_color_override("font_color", MUTED)
	add_child(head)
	_meter = Label.new()
	_meter.autowrap_mode = TextServer.AUTOWRAP_WORD
	_meter.custom_minimum_size.x = 240
	_meter.add_theme_color_override("font_color", Color(0.94, 0.72, 0.23))
	_meter.add_theme_font_size_override("font_size", 12)
	add_child(_meter)
	_last = Label.new()
	_last.autowrap_mode = TextServer.AUTOWRAP_WORD
	_last.custom_minimum_size.x = 240
	_last.add_theme_font_size_override("font_size", 12)
	add_child(_last)
	_body = VBoxContainer.new()
	_body.add_theme_constant_override("separation", 2)
	_body.visible = bool(VideoPrefs.get_value("debug", "crash_open", false))
	add_child(_body)
	var title := func(): head.text = ("▾ " if _body.visible else "▸ ") + "Motorcycle crash"
	title.call()
	head.pressed.connect(func():
		_body.visible = not _body.visible
		VideoPrefs.set_value("debug", "crash_open", _body.visible)
		title.call())
	_fill()


func _fill() -> void:
	for c in _body.get_children():
		c.queue_free()
	var note := Label.new()
	note.text = "Tick a rule to use it. The log names the rule of every crash."
	note.autowrap_mode = TextServer.AUTOWRAP_WORD
	note.custom_minimum_size.x = 240
	note.modulate.a = 0.7
	_body.add_child(note)
	var rules := Motorcycle.crash_rules()
	var done := {}
	var bike: Variant = world.car.bike if world != null and world.car != null else null
	for r in ROWS:
		var key: String = r[0]
		var now: Dictionary = rules[key]
		if not done.has(key):
			done[key] = true
			var tick := CheckBox.new()
			tick.text = TICKS[key]
			tick.button_pressed = bool(now.get("on", true))
			tick.focus_mode = Control.FOCUS_NONE
			tick.toggled.connect(func(v: bool): Motorcycle.set_crash_rule(key, "on", v))
			_body.add_child(tick)
		if r[2] == null:
			continue
		var field: String = r[2]
		var value: Variant = now.get(field)
		if value == null:
			# (lean: the bike's own crash_lean_deg until the panel sets it)
			value = rad_to_deg(float(bike.crash_lean)) if bike != null and key == "lean" else 78.0
		_slider(r[1], float(value), r[3], r[4], r[5], r[6],
			func(x: float): Motorcycle.set_crash_rule(key, field, x))
	var rider := Label.new()
	rider.text = "Rider"
	rider.add_theme_color_override("font_color", MUTED)
	_body.add_child(rider)
	var f := Motorcycle.feel()
	for r in FEEL_ROWS:
		var key: String = r[0]
		_slider(r[1], float(f[key]), r[2], r[3], r[4], r[5], func(x: float): Motorcycle.set_feel(key, x))
	var reset := Button.new()
	reset.text = "Back to the standard rules"
	reset.focus_mode = Control.FOCUS_NONE
	reset.pressed.connect(func():
		Motorcycle.reset_rules()
		_fill())
	_body.add_child(reset)


func _slider(text: String, value: float, lo: float, hi: float, step: float, unit: String, on_change: Callable) -> void:
	if text != "":
		var l := Label.new()
		l.text = text
		l.autowrap_mode = TextServer.AUTOWRAP_WORD
		l.custom_minimum_size.x = 240
		l.modulate.a = 0.8
		_body.add_child(l)
	var row := HBoxContainer.new()
	var sl := HSlider.new()
	sl.scrollable = false              # (the wheel scrolls the page)
	sl.min_value = lo
	sl.max_value = hi
	sl.step = step
	sl.value = value
	sl.focus_mode = Control.FOCUS_NONE
	sl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	sl.custom_minimum_size.y = 16
	var out := Label.new()
	out.custom_minimum_size.x = 70
	out.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	out.text = ("%s %s" % [str(snappedf(value, step)), unit]).strip_edges()
	sl.value_changed.connect(func(x: float):
		out.text = ("%s %s" % [str(snappedf(x, step)), unit]).strip_edges()
		on_change.call(x))
	row.add_child(sl)
	row.add_child(out)
	_body.add_child(row)


## The push and the g of the bike, the most of the last second, ten times a second.
func _process(delta: float) -> void:
	_clock += delta
	if _clock < 0.1:
		return
	_clock = 0.0
	var bike: Variant = world.car.bike if world != null and world.car != null else null
	if bike == null:
		_meter.text = ""
		return
	var d: Dictionary = bike.dbg_values
	_peaks.append([float(bike.dbg_force), float(bike.dbg_accel) / 9.81, float(d.get("lean", 0.0)), float(d.get("slide", 0.0)), float(d.get("spin", 0.0)), float(d.get("lost", 0.0)), float(d.get("wall", 0.0))])
	if _peaks.size() > 10:
		_peaks.pop_front()
	var most := [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
	for p in _peaks:
		for i in most.size():
			most[i] = maxf(most[i], p[i])
	_meter.text = "push %.1f kN  ·  %.1f g  ·  lean %.0f°  ·  slide %.0f°\nspin %.1f rad/s  ·  lost %.1f m/s in 0.1 s  ·  body hit %.0f km/h\n(the most of 1 s)" % ([most[0] / 1000.0] + most.slice(1))
	_last.text = _last_text(bike.last_crash)


## The rule of the last crash, how far past its limit, and what the bike measured then.
static func _last_text(c: Dictionary) -> String:
	if c.is_empty():
		return "Last crash: none yet"
	var reason := str(c["reason"])
	var unit: String = UNITS.get(reason, "")
	var over := " (limit %.1f %s)" % [float(c["limit"]), unit] if float(c.get("limit", -1.0)) >= 0.0 else ""
	return "Last crash: %s%s at %.0f km/h\nlean %.0f°  ·  slide %.0f° for %.1f s  ·  spin %.1f rad/s\n%.1f g  ·  push %.1f kN  ·  lost %.1f m/s in 0.1 s  ·  body hit %.0f km/h" % [
		NAMES.get(reason, reason), over, float(c["kmh"]), float(c["lean"]), float(c["slide"]), float(c["slide_time"]), float(c["spin"]), float(c["g"]), float(c["kN"]), float(c["lost"]), float(c["wall"])]
