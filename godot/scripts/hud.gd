class_name Hud
extends CanvasLayer
## What is shown on top of the game (web/js/Hud.js): bottom right the round gauge (HudGauge: the engine speed, the
## speed, the gear, the coolant and the oil, the badges of the systems) and the boost gauge of a turbo; top left the
## lap panel (the lap, the time of the lap that is going, the place and the gaps in a race, the last laps, the best and
## a new record, the delta at the gates); under it the car panel (the tyres, the fuel, the pit stop, the engine when it
## is hurt); the pit stop in the middle; the hint bar bottom left; the notices of the keys. The HUD can be switched off
## (H, Settings hud), the units are metric or imperial, the debug text (F3) is apart. Every element can be moved,
## scaled and faded (HudLayout, Edit HUD…).

const GO_TIME := 1.5

var car: Car
var world: Node
var laps: LapTimer
var race: Race
var gauge: HudGauge
var boost: HudGauge
var editor: HudLayout = null
var _lap_panel: PanelContainer
var _lap_label: RichTextLabel
var _car_panel: PanelContainer
var _tyre_cells: Array[Panel] = []
var _tyre_wear: Array[ColorRect] = []
var _tyre_text: Array[Label] = []
var _fuel_label: Label
var _fuel_bar: ProgressBar
var _tyres_label: Label
var _pit_line: Label
var _engine_line: Label
var _tyre_box: Control
var _pit_panel: VBoxContainer
var _pit_what: Label
var _pit_count: Label
var _hint: Label
var _lights: Label
var _toast: Label
var _toast_time := 0.0
var _notice: PanelContainer
var _notice_label: Label
var _notice_time := 0.0
var _calibration: Label
var _debug: Label
var _keys_box: PanelContainer = null
var _gauge_size := 0.0
var _pit_was := false
var _pit_go_until := 0.0
var _fuel_lap_start := -1.0
var _fuel_per_lap := 0.0
var _laps_seen := 0
var _layout_in := 0.0
var _pad_used := false


func _ready() -> void:
	add_to_group("hud")
	gauge = HudGauge.new()
	gauge.hud = self
	_element(gauge, "gauge", "Gauge", Control.PRESET_BOTTOM_RIGHT)
	boost = HudGauge.new()
	boost.hud = self
	boost.boost = true
	boost.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_element(boost, "boost", "Boost", Control.PRESET_BOTTOM_RIGHT)
	_build_lap_panel()
	_build_car_panel()
	_build_pit()
	_hint = _label(14, Color("#ffe08a"))
	_hint.anchor_top = 1.0
	_hint.anchor_bottom = 1.0
	_hint.offset_left = 16
	_hint.offset_top = -34
	add_child(_hint)
	_toast = _label(22)
	_toast.anchor_left = 0.5
	_toast.anchor_right = 0.5
	_toast.offset_left = -400
	_toast.offset_right = 400
	_toast.offset_top = 90
	_toast.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	add_child(_toast)
	_build_notice()
	_lights = _label(120)
	_lights.anchor_left = 0.5
	_lights.anchor_right = 0.5
	_lights.offset_left = -200
	_lights.offset_right = 200
	_lights.offset_top = 120
	_lights.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	add_child(_lights)
	_calibration = _label(24)
	_calibration.anchor_left = 0.5
	_calibration.anchor_right = 0.5
	_calibration.offset_left = -500
	_calibration.offset_right = 500
	_calibration.offset_top = 140
	_calibration.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_calibration.autowrap_mode = TextServer.AUTOWRAP_WORD
	add_child(_calibration)
	_debug = _label(14)
	_debug.anchor_left = 0.5
	_debug.anchor_right = 0.5
	_debug.offset_left = -330
	_debug.offset_top = 14
	add_child(_debug)
	Settings.changed.connect(func(key: String):
		if key == "hud_layout":
			HudLayout.apply(get_tree(), Settings.get_value("hud_layout")))
	if not Settings.get_value("keys_shown") and Content.arg("shot") == "" and Content.arg("ai") == "":
		_show_keys_once.call_deferred()


func _element(c: Control, id: String, text: String, preset: Control.LayoutPreset) -> void:
	c.set_anchors_preset(preset)
	c.add_to_group("hud_element")
	c.set_meta("hud_id", id)
	c.set_meta("hud_label", text)
	add_child(c)


func _label(size: int, colour := Color.WHITE) -> Label:
	var l := Label.new()
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", colour)
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.8))
	l.add_theme_constant_override("outline_size", maxi(2, size / 8))
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l


func _panel_style() -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.055, 0.07, 0.094, 0.62)
	sb.set_corner_radius_all(10)
	sb.content_margin_left = 14
	sb.content_margin_right = 14
	sb.content_margin_top = 9
	sb.content_margin_bottom = 10
	return sb


func _build_lap_panel() -> void:
	_lap_panel = PanelContainer.new()
	_lap_panel.add_theme_stylebox_override("panel", _panel_style())
	_lap_panel.offset_left = 16
	_lap_panel.offset_top = 14
	_lap_panel.custom_minimum_size = Vector2(210, 0)
	_lap_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_lap_label = RichTextLabel.new()
	_lap_label.bbcode_enabled = true
	_lap_label.fit_content = true
	_lap_label.autowrap_mode = TextServer.AUTOWRAP_OFF
	_lap_label.scroll_active = false
	_lap_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_lap_label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.8))
	_lap_label.add_theme_constant_override("shadow_offset_y", 1)
	_lap_panel.add_child(_lap_label)
	_element(_lap_panel, "laps", "Lap times", Control.PRESET_TOP_LEFT)
	_lap_panel.offset_left = 16
	_lap_panel.offset_top = 14


func _small(text: String, colour := Color("#9fb0c4"), size := 11) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", colour)
	return l


func _build_car_panel() -> void:
	_car_panel = PanelContainer.new()
	_car_panel.add_theme_stylebox_override("panel", _panel_style())
	_car_panel.custom_minimum_size = Vector2(210, 0)
	_car_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 4)
	_car_panel.add_child(box)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	box.add_child(row)
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 4)
	grid.add_theme_constant_override("v_separation", 4)
	_tyre_box = grid
	row.add_child(grid)
	for k in 4:
		var cell := Panel.new()
		cell.custom_minimum_size = Vector2(40, 26)
		var wear := ColorRect.new()
		wear.color = Color(0, 0, 0, 0.55)
		wear.anchor_left = 0.0
		wear.anchor_right = 1.0
		wear.anchor_top = 1.0
		wear.anchor_bottom = 1.0
		cell.add_child(wear)
		var t := _small("", Color.WHITE, 10)
		t.set_anchors_preset(Control.PRESET_FULL_RECT)
		t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		t.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		cell.add_child(t)
		grid.add_child(cell)
		_tyre_cells.append(cell)
		_tyre_wear.append(wear)
		_tyre_text.append(t)
	var fuel := VBoxContainer.new()
	fuel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(fuel)
	_fuel_label = _small("FUEL")
	fuel.add_child(_fuel_label)
	_fuel_bar = ProgressBar.new()
	_fuel_bar.show_percentage = false
	_fuel_bar.custom_minimum_size = Vector2(0, 8)
	var bg := StyleBoxFlat.new()
	bg.bg_color = Color(1, 1, 1, 0.15)
	bg.set_corner_radius_all(4)
	var fill := StyleBoxFlat.new()
	fill.bg_color = Color("#5fb3ff")
	fill.set_corner_radius_all(4)
	_fuel_bar.add_theme_stylebox_override("background", bg)
	_fuel_bar.add_theme_stylebox_override("fill", fill)
	fuel.add_child(_fuel_bar)
	_tyres_label = _small("TYRES")
	fuel.add_child(_tyres_label)
	_pit_line = _small("", Color("#ffd04d"), 12)
	box.add_child(_pit_line)
	_engine_line = _small("", Color("#e8d98a"), 11)
	box.add_child(_engine_line)
	_element(_car_panel, "car", "Tyres and fuel", Control.PRESET_TOP_LEFT)


func _build_pit() -> void:
	_pit_panel = VBoxContainer.new()
	_pit_panel.anchor_left = 0.5
	_pit_panel.anchor_right = 0.5
	_pit_panel.anchor_top = 0.38
	_pit_panel.anchor_bottom = 0.38
	_pit_panel.offset_left = -300
	_pit_panel.offset_right = 300
	_pit_panel.offset_top = -60
	_pit_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_pit_what = _label(16, Color("#ffd04d"))
	_pit_what.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_pit_panel.add_child(_pit_what)
	_pit_count = _label(72)
	_pit_count.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_pit_panel.add_child(_pit_count)
	add_child(_pit_panel)


func _build_notice() -> void:
	_notice = PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.08, 0.094, 0.12, 0.85)
	sb.set_corner_radius_all(6)
	sb.content_margin_left = 18
	sb.content_margin_right = 18
	sb.content_margin_top = 8
	sb.content_margin_bottom = 8
	_notice.add_theme_stylebox_override("panel", sb)
	_notice.anchor_left = 0.5
	_notice.anchor_right = 0.5
	_notice.anchor_top = 0.38
	_notice.anchor_bottom = 0.38
	_notice.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_notice.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_notice_label = Label.new()
	_notice_label.add_theme_font_size_override("font_size", 16)
	_notice.add_child(_notice_label)
	_notice.visible = false
	add_child(_notice)


## What the wheel calibration asks ("" hides it).
func calibration(text: String) -> void:
	_calibration.text = text
	if text == "" and not WheelInput.calibrating and WheelInput.active:
		toast("Wheel calibrated")


## A message in the middle of the screen for a few seconds.
func toast(text: String) -> void:
	_toast.text = text
	_toast_time = 3.0


## A short line in the middle of the screen when a key turns a driver aid on or off (Settings.js notice).
func notice(text: String) -> void:
	_notice_label.text = text
	_notice.visible = true
	_notice.offset_left = -_notice_label.get_minimum_size().x / 2.0 - 18
	_notice.offset_right = -_notice.offset_left
	_notice_time = 1.6


func toggle_debug() -> void:
	Settings.set_value("debug", not Settings.get_value("debug"))


## The HUD editor (HudLayout): the game is held while it is open; the pause menu comes back after it.
func edit_layout() -> void:
	if editor != null:
		return
	var w := world
	var pause_layer: CanvasLayer = w.get("pause_layer") if w != null else null
	if pause_layer != null:
		pause_layer.visible = false
	var was_paused := get_tree().paused
	get_tree().paused = true
	editor = HudLayout.new()
	editor.closed.connect(func():
		editor = null
		if pause_layer != null and is_instance_valid(pause_layer):
			pause_layer.visible = true
		else:
			get_tree().paused = was_paused)
	add_child(editor)


func _input(event: InputEvent) -> void:
	if event is InputEventJoypadButton or (event is InputEventJoypadMotion and absf(event.axis_value) > 0.5):
		_pad_used = true
	elif event is InputEventKey:
		_pad_used = false


## The first drive on this computer: the keys that matter, for a while at the side (Settings.js showKeysOnce).
func _show_keys_once() -> void:
	Settings.set_value("keys_shown", true)
	if world != null and world.get("touch") != null:
		return
	var of := func(action: String) -> String:
		var names := []
		for b: Dictionary in Controls.bindings(action):
			if (b.get("type") == "key") != _pad_used:
				names.append(Controls.describe(b))
		return " / ".join(names.slice(0, 2)) if not names.is_empty() else "–"
	var rows := [["Throttle, brake", of.call("throttle") + ", " + of.call("brake")], ["Steer", of.call("steer_left") + ", " + of.call("steer_right")],
		["Handbrake", of.call("handbrake")], ["Shift up, down", of.call("shift_up") + ", " + of.call("shift_down")],
		["Back on the line", of.call("reset")], ["Repair", of.call("repair")], ["Camera", of.call("camera")],
		["Pause, restart, all controls", "Start" if _pad_used else "Esc"]]
	_keys_box = PanelContainer.new()
	var sb := _panel_style()
	sb.bg_color = Color(0.08, 0.094, 0.12, 0.88)
	_keys_box.add_theme_stylebox_override("panel", sb)
	_keys_box.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	_keys_box.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	_keys_box.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_keys_box.offset_right = -16
	_keys_box.offset_bottom = -(_gauge_size + 40.0 if _gauge_size > 0.0 else 380.0)
	_keys_box.tooltip_text = "Click to close"
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 14)
	var title := _small("Controls", Color.WHITE, 13)
	grid.add_child(title)
	grid.add_child(Control.new())
	for r in rows:
		grid.add_child(_small(r[0], Color(1, 1, 1, 0.75), 13))
		grid.add_child(_small(r[1], Color.WHITE, 13))
	_keys_box.add_child(grid)
	_keys_box.gui_input.connect(func(e: InputEvent):
		if e is InputEventMouseButton and e.pressed and is_instance_valid(_keys_box):
			_keys_box.queue_free())
	add_child(_keys_box)
	get_tree().create_timer(20.0).timeout.connect(func():
		if is_instance_valid(_keys_box):
			_keys_box.queue_free())


func _gauge_px() -> float:
	var view := get_viewport().get_visible_rect().size
	var small := world != null and world.get("touch") != null and minf(view.x, view.y) < 600.0
	return roundf(maxf(130.0 if small else 210.0, minf(330.0, minf(view.x, view.y) * (0.3 if small else 0.36))))


## The places of the gauges (they grow with the window; on a touch screen they stand above the pedals).
func _place_gauges() -> void:
	var s := _gauge_px()
	if s == _gauge_size:
		return
	_gauge_size = s
	var bottom := 16.0
	if world != null and world.get("touch") != null:
		bottom = 210.0
	gauge.offset_right = -16
	gauge.offset_left = -16 - s
	gauge.offset_bottom = -bottom
	gauge.offset_top = -bottom - s
	var b := roundf(s * 0.5)
	boost.offset_right = -(16.0 + roundf(s * 0.77))
	boost.offset_left = boost.offset_right - b
	boost.offset_bottom = -(bottom + roundf(s * 0.72))
	boost.offset_top = boost.offset_bottom - b
	HudLayout.rebase(gauge)
	HudLayout.rebase(boost)


func _process(delta: float) -> void:
	_toast_time -= delta
	_toast.visible = _toast_time > 0.0
	_notice_time -= delta
	_notice.visible = _notice_time > 0.0
	_debug.visible = bool(Settings.get_value("debug"))
	if car == null:
		return
	var on := bool(Settings.get_value("hud"))
	gauge.visible = on
	_lap_panel.visible = on
	_hint.visible = on
	_place_gauges()
	_lights_of_systems()
	_race_lights()
	_update_laps()
	_update_car(on)
	_update_pit(on)
	var x: Dictionary = car.engine.extras
	boost.visible = on and bool(x.get("boost_gauge_on", false)) and car.engine.has_turbo()
	var audio: Variant = world.get("audio") if world != null else null
	_hint.text = "" if audio == null or audio.get("synth") != null else "No engine sound: the native part is not built (README, Building the native part)"
	if _debug.visible:
		_debug_text()
	if editor == null:
		_layout_in -= delta
		if _layout_in <= 0.0:
			_layout_in = 0.5
			HudLayout.apply(get_tree(), Settings.get_value("hud_layout"))


## The states of the lights of the gauge (a system the car does not have has none).
func _lights_of_systems() -> void:
	var tc := false
	var abs_working := false
	for w in car.wheels:
		tc = tc or w.tc
		abs_working = abs_working or w.abs_factor < 0.95
	var st := gauge.states
	st["ABS"] = "off" if not Settings.get_value("abs") else ("active" if abs_working else "on")
	st["TC"] = null if not car.tc_fitted else ("off" if not Settings.get_value("tc") else ("active" if tc else "on"))
	st["ESC"] = null if not car.esc_fitted or car.bike != null else ("off" if not Settings.get_value("esc") else ("active" if car.esc_level > 0.05 else "on"))
	st["LC"] = null if not car.launch_control_fitted else ("off" if not Settings.get_value("launch_control") else (
		"active" if car.lc_armed or car.launching > 0.0 else "on"))
	st["2S"] = null if not car.two_step_fitted else ("active" if car.two_step_active else ("off" if not Settings.get_value("two_step") else "on"))
	st["TB"] = "active" if car.transbrake_held else null
	st["P"] = "park" if world != null and bool(world.get("parking_brake")) else null


func _race_lights() -> void:
	_lights.text = ""
	if race != null:
		var t := race.countdown_text()
		_lights.text = t
		_lights.add_theme_color_override("font_color", Color(0.35, 0.9, 0.45) if t == "GO" else (Color(1, 0.75, 0.2) if t == "1" else Color.WHITE))


## The lap panel (Hud.js updateLaps).
func _update_laps() -> void:
	var lines := PackedStringArray()
	var head := ""
	var current := 0.0
	if race != null:
		var p := race.player
		var done := clampi(p.laps - 1, 0, race.laps)
		if p.finish_time >= 0.0:
			head = "FINISHED"
		elif p.laps >= race.laps:
			head = "FINAL LAP"
		else:
			head = "LAP %d/%d" % [maxi(1, p.laps), race.laps]
		head += "  ·  P%d/%d" % [race.position_of(p), race.entries.size()]
		current = race.clock - p.lap_start if p.laps > 0 and race.state != Race.State.COUNTDOWN else 0.0
		lines.append("[font_size=12][color=#9fb0c4]%s[/color][/font_size]" % head)
		lines.append("[font_size=34][b]%s[/b][/font_size]" % LapTimer.format_time(maxf(0.0, current)))
		if done < race.laps and race.state == Race.State.RACING:
			var gaps := _gaps()
			if gaps != "":
				lines.append("[font_size=14][color=#cfd8e3]%s[/color][/font_size]" % gaps)
	elif laps != null and laps.has_laps():
		head = "LAP %d" % (laps.laps_done + 1)
		if laps.lap_invalid:
			head += "  ·  reset in the lap"
		if not laps.lap_started:
			head = "CROSS THE FINISH LINE TO START"
		lines.append("[font_size=12][color=#9fb0c4]%s[/color][/font_size]" % head)
		lines.append("[font_size=34][b]%s[/b][/font_size]" % LapTimer.format_time(laps.lap_time()))
	else:
		lines.append("[font_size=12][color=#9fb0c4]FREE DRIVE · NO FINISH LINE[/color][/font_size]")
	if laps != null:
		var times := laps.lap_times
		if not times.is_empty():
			var best: float = times.min()
			var shown := 0
			for i in range(times.size() - 1, -1, -1):
				if shown >= 3:
					break
				var t := LapTimer.format_time(times[i])
				lines.append("[font_size=14][color=#cfd8e3]%d. %s[/color][/font_size]" % [i + 1, "[color=#7ee7a0][b]%s[/b][/color]" % t if is_equal_approx(times[i], best) else t])
				shown += 1
		if laps.shown_best() > 0.0:
			lines.append("[font_size=14][color=#cfd8e3]best %s%s[/color][/font_size]" % [LapTimer.format_time(laps.shown_best()),
				" [color=#7ee7a0][b]new record[/b][/color]" if laps.new_record else ""])
		if race == null and laps.clock - laps.delta_time < 4.0:
			lines.append("[font_size=22][color=%s]%+.2f[/color][/font_size]" % ["#66ff73" if laps.delta < 0.0 else "#ff7366", laps.delta])
	var touch: bool = world != null and world.get("touch") != null
	if not touch:
		lines.append("[font_size=11][color=#7f90a5]%s: pause, restart, settings and controls[/color][/font_size]" % ("Start" if _pad_used else "Esc"))
	else:
		lines.append("[font_size=11][color=#7f90a5]Menu: settings and controls[/color][/font_size]")
	var text := "\n".join(lines)
	if _lap_label.text != text:
		_lap_label.text = text


## The gaps to the car ahead and the one behind, from the distance along the racing line and the speed.
func _gaps() -> String:
	var order := race.order()
	var i := order.find(race.player)
	var length := maxf(1.0, race.line.length)
	var me := race.player.laps + race.player.fraction
	var v := maxf(8.0, absf(car.speed))
	var fmt := func(s: float) -> String: return LapTimer.format_time(s) if s >= 60.0 else "%.1f s" % s
	var parts := PackedStringArray()
	if i > 0:
		var a := order[i - 1]
		parts.append("ahead " + fmt.call(((a.laps + a.fraction) - me) * length / v))
	if i >= 0 and i < order.size() - 1:
		var b := order[i + 1]
		parts.append("behind " + fmt.call((me - (b.laps + b.fraction)) * length / v))
	return "  ·  ".join(parts)


func _tyre_colour(t: float) -> Color:
	if t < 70.0:
		var c := clampf((t - 25.0) / 45.0, 0.0, 1.0)
		return Color8(roundi(60 + 20 * c), roundi(120 + 70 * c), roundi(220 - 90 * c))
	if t <= 100.0:
		return Color8(70, 190, 110)
	var h := clampf((t - 100.0) / 40.0, 0.0, 1.0)
	return Color8(roundi(90 + 150 * h), roundi(190 - 130 * h), roundi(110 - 70 * h))


## The car panel (Hud.js updateCar): the tyres, the fuel in litres and in laps, the pit stop and the engine.
func _update_car(on: bool) -> void:
	var engine_row := _engine_row()
	var wear_on := float(Settings.get_value("tyre_wear")) > 0.0
	_car_panel.visible = on and (wear_on or engine_row != "")
	if not _car_panel.visible:
		return
	# under the lap panel as it grows, unless one of them was moved in the HUD editor
	var lay: Dictionary = Settings.get_value("hud_layout")
	var top := _lap_panel.offset_top + _lap_panel.size.y + 8.0 if not lay.has("laps") and not lay.has("car") else 150.0
	if _car_panel.has_meta("hud_base") and editor == null:
		_car_panel.set_meta("hud_base", [16.0, top, 16.0 + _car_panel.size.x, top + _car_panel.size.y])
	else:
		_car_panel.offset_left = 16
		_car_panel.offset_top = top
	_engine_line.text = engine_row
	_engine_line.visible = engine_row != ""
	_tyre_box.get_parent().visible = wear_on
	_pit_line.visible = wear_on
	if not wear_on:
		return
	var order := [0, 1, 2, 3]
	var max_wear := 0.0
	for k in 4:
		var w: Car.Wheel = car.wheels[order[k]] if order[k] < car.wheels.size() else car.wheels[0]
		var sb := StyleBoxFlat.new()
		sb.bg_color = _tyre_colour(w.temp)
		sb.border_color = Color(1, 1, 1, 0.25)
		sb.set_border_width_all(1)
		sb.set_corner_radius_all(4)
		_tyre_cells[k].add_theme_stylebox_override("panel", sb)
		_tyre_wear[k].offset_top = -26.0 * clampf(w.wear, 0.0, 1.0)
		_tyre_text[k].text = "%d°" % roundi(w.temp)
		max_wear = maxf(max_wear, w.wear)
	# the fuel of a lap, measured
	if laps != null and laps.laps_done != _laps_seen:
		if _fuel_lap_start >= 0.0 and _fuel_lap_start > car.fuel:
			_fuel_per_lap = _fuel_lap_start - car.fuel
		_fuel_lap_start = car.fuel
		_laps_seen = laps.laps_done
	elif _fuel_lap_start < 0.0 and laps != null and laps.lap_started:
		_fuel_lap_start = car.fuel
	var laps_of_fuel := car.fuel / _fuel_per_lap if _fuel_per_lap > 0.0 else -1.0
	_fuel_label.text = "FUEL %.1f L%s" % [car.fuel, " · %.1f laps" % laps_of_fuel if laps_of_fuel >= 0.0 else ""]
	_fuel_bar.value = 100.0 * car.fuel / maxf(1.0, car.tank)
	_tyres_label.text = "TYRES %d%%" % roundi((1.0 - minf(1.0, max_wear)) * 100.0)
	var pit := car.get_node_or_null("PitStop") as PitStop
	var line := ""
	_pit_line.modulate.a = 1.0
	if pit != null and pit.active:
		line = "PIT STOP %.1f s" % pit.remaining()
		for k in ["repair", "tyres", "fuel"]:
			if float(pit.plan.get(k, 0.0)) > 0.0:
				line += " · " + k
		_pit_line.add_theme_color_override("font_color", Color("#ffd04d"))
	elif pit != null and pit.done:
		line = "PIT STOP DONE · go"
		_pit_line.add_theme_color_override("font_color", Color("#7ee7a0"))
	elif car.fuel <= 0.0:
		line = "OUT OF FUEL"
		_pit_line.add_theme_color_override("font_color", Color("#ff6b62"))
	else:
		var laps_left := race.laps - race.player.laps + 1 if race != null else 1000000
		var low := laps_of_fuel < laps_left and laps_of_fuel < 1.5 if laps_of_fuel >= 0.0 else car.fuel < car.tank * 0.12
		var reasons := PackedStringArray()
		if max_wear > 0.8:
			reasons.append("tyres")
		if low:
			reasons.append("fuel")
		if not reasons.is_empty():
			line = "PIT · " + " · ".join(reasons)
			_pit_line.add_theme_color_override("font_color", Color("#ffd04d"))
			_pit_line.modulate.a = 1.0 if int(Time.get_ticks_msec() / 90) % 2 == 0 else 0.4
	_pit_line.text = line
	_pit_line.visible = line != ""


## The engine when something is wrong with it (EngineDamage, Hud.js engineHealthRow); nothing when it is whole and cool.
func _engine_row() -> String:
	if car.engine_damage == null:
		return ""
	var h := car.engine_damage.health
	var hot: bool = h["temp"] > 104.0
	var trouble: bool = hot or h["coolant"] < 0.97 or h["wear"] > 0.02 or h["ignition"] > 0.02 or h["gasket"] > 0.02 or h["failed"] > 0.0
	if not trouble:
		return ""
	var colour := Color("#e8d98a")
	if h["failed"] > 0.0 or h["temp"] > 125.0 or h["coolant"] < 0.2:
		colour = Color("#ff6b62")
	elif hot or h["coolant"] < 0.5 or h["misfire"] > 0.2:
		colour = Color("#ffb347")
	_engine_line.add_theme_color_override("font_color", colour)
	var state := ""
	if h["failed"] > 0.0:
		state = "ENGINE FAILED"
	elif h["temp"] > 118.0:
		state = "OVERHEATING"
	elif h["gasket"] > 0.3:
		state = "HEAD GASKET"
	elif h["misfire"] > 0.15:
		state = "MISFIRING"
	elif h["wear"] > 0.5:
		state = "ENGINE WORN"
	if h["oil"] < 0.2:
		state += (" · " if state != "" else "") + "OIL"
	return "ENGINE %d° · COOLANT %d%%%s" % [roundi(h["temp"]), roundi(h["coolant"] * 100.0), " · " + state if state != "" else ""]


## The pit stop in the middle of the screen, and GO for a moment when the car is let go (Hud.js updatePit).
func _update_pit(on: bool) -> void:
	var pit := car.get_node_or_null("PitStop") as PitStop
	var now := Time.get_ticks_msec() / 1000.0
	var what := ""
	var count := ""
	if pit != null and pit.active:
		var parts := PackedStringArray()
		for k in [["repair", "REPAIR"], ["tyres", "TYRES"], ["fuel", "FUEL"]]:
			if float(pit.plan.get(k[0], 0.0)) > 0.0:
				parts.append(k[1])
		what = "PIT STOP" + (" · " + " · ".join(parts) if not parts.is_empty() else "")
		count = "%.1f" % pit.remaining()
		_pit_count.add_theme_color_override("font_color", Color.WHITE)
	else:
		if _pit_was and pit != null and pit.done:
			_pit_go_until = now + GO_TIME
		if now < _pit_go_until:
			what = "PIT STOP DONE"
			count = "GO"
			_pit_count.add_theme_color_override("font_color", Color("#7ee7a0"))
	_pit_was = pit != null and pit.active
	_pit_what.text = what
	_pit_count.text = count
	_pit_panel.visible = on and what != ""


func _debug_text() -> void:
	var lines := PackedStringArray()
	lines.append("%s  ·  %s  ·  %d fps" % [car.config.get("name", car.car_id), car.get_meta("track_name", ""), Engine.get_frames_per_second()])
	lines.append("%d rpm%s  clutch %.2f  throttle %.2f  brake %.2f  steer %.1f°" % [roundi(car.engine.rpm()), "  manual" if car.manual else "",
		car.clutch_engagement, car.throttle, car.brake, rad_to_deg(car.steer_angle)])
	for w in car.wheels:
		lines.append("%s  load %5d N  slip %+.2f  angle %+.2f  s %.2f  fx %+6d  fy %+6d  %s%s" % [
			w.slot, roundi(w.load), w.slip_ratio, w.slip_tan, w.s, roundi(w.fx), roundi(w.fy), w.surface,
			"" if w.contact else "  (air)"])
	if car.shell_tyres != null:
		# (the shell tyre, Scene.js and Car.js: its nodes, the small steps it takes, and how far each tyre is in)
		var r: Dictionary = car.shell_tyres.results[0]
		var t: Object = car.shell_tyres.tyres[0]
		var ins := PackedStringArray()
		for i in 4:
			ins.append("%s %d mm" % [car.wheels[i].slot, roundi(float(car.shell_tyres.results[i].get("sag", 0.0)) * 1000.0)])
		lines.append("Tyre shell: %d rings x %d segments = %d nodes a tyre, %d substeps in a step of %.1f ms  |  in: %s" % [int(t.call("get_rings")),
			int(t.call("get_segments")), int(t.call("get_rings")) * int(t.call("get_segments")), int(r.get("substeps", 0)),
			1000.0 / Engine.physics_ticks_per_second / ShellTyres.STEPS, "  ".join(ins)])
	_debug.text = "\n".join(lines)
