class_name Hud
extends CanvasLayer
## The prototype's dashboard: speed, gear and rev counter, and with F3 the state of each wheel.

var car: Car
var _speed: Label
var _gear: Label
var _rpm: ProgressBar
var _rpm_text: Label
var _info: Label
var _debug: Label
var _help: Label


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
	_help.text = "Arrows/WASD drive  ·  Space handbrake  ·  Q/E shift (manual)  ·  C camera  ·  R put back on its wheels  ·  Backspace start  ·  F3 data  ·  Esc menu"
	add_child(_help)
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


func toggle_debug() -> void:
	_debug.visible = not _debug.visible


func _process(_delta: float) -> void:
	if car == null:
		return
	_speed.text = "%d" % roundi(absf(car.speed) * 3.6)
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
