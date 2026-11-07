class_name Hud
extends CanvasLayer
## The prototype's dashboard: speed, gear and rev counter, and with F3 the state of each wheel.

var car: Car
var laps: LapTimer
var race: Race
var _lights: Label
var _race: Label
var _delta: Label
var _speed: Label
var _gear: Label
var _rpm: ProgressBar
var _rpm_text: Label
var _info: Label
var _debug: Label
var _help: Label
var _toast: Label
var _toast_time := 0.0
var _calibration: Label


func _ready() -> void:
	var box := VBoxContainer.new()
	box.anchor_left = 1.0
	box.anchor_right = 1.0
	box.anchor_top = 1.0
	box.anchor_bottom = 1.0
	box.offset_left = -300
	box.offset_top = -170
	box.offset_right = -30
	box.offset_bottom = -30
	box.alignment = BoxContainer.ALIGNMENT_END
	add_child(box)
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_END
	box.add_child(row)
	_speed = _label(64)
	row.add_child(_speed)
	var unit := _label(20)
	unit.text = "km/h"
	row.add_child(unit)
	_gear = _label(64)
	_gear.custom_minimum_size.x = 70
	_gear.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	row.add_child(_gear)
	_rpm = ProgressBar.new()
	_rpm.show_percentage = false
	_rpm.custom_minimum_size = Vector2(270, 14)
	box.add_child(_rpm)
	_rpm_text = _label(16)
	_rpm_text.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	box.add_child(_rpm_text)

	_info = _label(16)
	_info.position = Vector2(20, 14)
	add_child(_info)
	_help = _label(14)
	_help.position = Vector2(20, 40)
	_help.modulate.a = 0.75
	_help.text = ("Arrows/WASD drive  ·  Space handbrake  ·  Q/E shift (manual)  ·  C camera  ·  R put back on its wheels  ·  "
		+ "Backspace start  ·  K calibrate wheel  ·  F3 data  ·  F8 mark  ·  Esc pause")
	add_child(_help)
	_toast = _label(22)
	_toast.anchor_left = 0.5
	_toast.anchor_right = 0.5
	_toast.offset_left = -300
	_toast.offset_right = 300
	_toast.offset_top = 90
	_toast.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	add_child(_toast)
	var race_box := VBoxContainer.new()
	race_box.anchor_left = 1.0
	race_box.anchor_right = 1.0
	race_box.offset_left = -360
	race_box.offset_right = -30
	race_box.offset_top = 16
	add_child(race_box)
	_race = _label(22)
	_race.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	race_box.add_child(_race)
	_delta = _label(30)
	_delta.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	race_box.add_child(_delta)
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
	_debug.position = Vector2(20, 70)
	_debug.visible = false
	add_child(_debug)


func _label(size: int) -> Label:
	var l := Label.new()
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.8))
	l.add_theme_constant_override("outline_size", maxi(2, size / 8))
	return l


## What the wheel calibration asks ("" hides it).
func calibration(text: String) -> void:
	_calibration.text = text
	if text == "" and not WheelInput.calibrating and WheelInput.active:
		toast("Wheel calibrated")


## A message in the middle of the screen for a few seconds.
func toast(text: String) -> void:
	_toast.text = text
	_toast_time = 3.0


func _race_panel() -> void:
	if race != null:
		var t := race.countdown_text()
		_lights.text = t
		_lights.add_theme_color_override("font_color", Color(0.35, 0.9, 0.45) if t == "GO" else (Color(1, 0.75, 0.2) if t == "1" else Color.WHITE))
		var lap := clampi(race.player.laps, 1, race.laps)
		var lines := PackedStringArray()
		lines.append("P%d / %d" % [race.position_of(race.player), race.entries.size()])
		lines.append("Lap %d / %d   %s" % [lap, race.laps, LapTimer.format_time(race.clock - race.player.lap_start) if race.player.laps > 0 else ""])
		lines.append("Best  %s" % LapTimer.format_time(race.player.best_lap))
		_race.text = "\n".join(lines)
		_delta.text = ""
		return
	if laps == null or not laps.has_laps():
		_race.text = "Free driving (this track has no finish line)" if laps != null else ""
		_delta.text = ""
		return
	var lines := PackedStringArray()
	if laps.lap_started:
		lines.append("Lap %d   %s%s" % [laps.laps_done + 1, LapTimer.format_time(laps.lap_time()), "  (reset)" if laps.lap_invalid else ""])
	else:
		lines.append("Cross the finish line to start")
	lines.append("Last  %s" % LapTimer.format_time(laps.last_lap))
	lines.append("Best  %s" % LapTimer.format_time(laps.best_lap))
	_race.text = "\n".join(lines)
	if laps.clock - laps.delta_time < 4.0:
		_delta.text = "%+.2f" % laps.delta
		_delta.add_theme_color_override("font_color", Color(0.4, 1, 0.45) if laps.delta < 0.0 else Color(1, 0.45, 0.4))
	else:
		_delta.text = ""


func toggle_debug() -> void:
	_debug.visible = not _debug.visible


func _process(delta: float) -> void:
	_toast_time -= delta
	_toast.visible = _toast_time > 0.0
	if car == null:
		return
	_speed.text = "%d" % roundi(absf(car.speed) * 3.6)
	_race_panel()
	_gear.text = car.gear_name()
	var rpm := car.engine.rpm()
	_rpm.max_value = car.engine.limiter_rpm
	_rpm.value = rpm
	_rpm.modulate = Color(1, 0.3, 0.2) if rpm > car.engine.limiter_rpm * 0.92 else Color(1, 1, 1)
	_rpm_text.text = "%d rpm%s" % [roundi(rpm), "  manual" if car.manual else ""]
	_info.text = "%s  ·  %s  ·  %d fps" % [car.config.get("name", car.car_id), car.get_meta("track_name", ""), Engine.get_frames_per_second()]
	if _debug.visible:
		var lines := PackedStringArray()
		lines.append("clutch %.2f  throttle %.2f  brake %.2f  steer %.1f°" % [car.clutch_engagement, car.throttle, car.brake, rad_to_deg(car.steer_angle)])
		for w in car.wheels:
			lines.append("%s  load %5d N  slip %+.2f  angle %+.2f  s %.2f  fx %+6d  fy %+6d  %s%s" % [
				w.slot, roundi(w.load), w.slip_ratio, w.slip_tan, w.s, roundi(w.fx), roundi(w.fy), w.surface,
				"" if w.contact else "  (air)"])
		_debug.text = "\n".join(lines)
