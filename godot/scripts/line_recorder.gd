class_name LineRecorder
extends CanvasLayer
## Recording the racing line for the track editor ("Record AI racing line", main.js recordLine and RacingLine.save):
## the player drives calm laps through all the gates; every lap that is finished replaces the line. Esc or Stop saves
## the last lap as "racing_line" of the track (every third sample of the lap, 30 a second, rounded to centimetres, and
## line_date) and goes back to the editor. The track.json that is written is the one the game loaded (the garage's,
## or the game's folder when it runs from the repository and the track is there), else a copy in the garage.

signal done(result: String)          # the number of points, "none" (no lap) or "failed"

var world: Node
var track_id := ""
var laps := 0
var lap := PackedFloat32Array()      # the samples of the last lap (LapTimer: FIELDS per sample, the place first)
var result := ""
var _note: Label


func setup(w: Node, id: String, timer: LapTimer) -> void:
	world = w
	track_id = id
	layer = 12
	name = "LineRecorder"
	timer.lap_done.connect(func(samples: PackedFloat32Array):
		lap = samples
		laps += 1
		_show()
		# (a test: --record-laps=n stops after n laps, as Stop would)
		if Content.arg("record-laps") != "" and laps >= int(Content.arg("record-laps")):
			finish.call_deferred())
	var panel := PanelContainer.new()
	var st := StyleBoxFlat.new()
	st.bg_color = Color(0.08, 0.09, 0.12, 0.85)
	st.set_corner_radius_all(6)
	st.set_content_margin_all(12)
	panel.add_theme_stylebox_override("panel", st)
	panel.set_anchors_preset(Control.PRESET_CENTER_TOP)
	panel.grow_horizontal = Control.GROW_DIRECTION_BOTH
	panel.position.y = 60
	add_child(panel)
	_note = Label.new()
	_note.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_note.add_theme_font_size_override("font_size", 16)
	panel.add_child(_note)
	var stop := Button.new()
	stop.text = "Stop"
	stop.focus_mode = Control.FOCUS_NONE
	stop.add_theme_font_size_override("font_size", 16)
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color("#d94a3d")
	sb.set_corner_radius_all(6)
	sb.content_margin_left = 26
	sb.content_margin_right = 26
	sb.content_margin_top = 10
	sb.content_margin_bottom = 10
	for s in ["normal", "hover", "pressed"]:
		stop.add_theme_stylebox_override(s, sb)
	stop.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	stop.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	stop.grow_vertical = Control.GROW_DIRECTION_BEGIN
	stop.position = Vector2(-20, -60)
	stop.pressed.connect(finish)
	add_child(stop)
	_show()
	RunLog.event("recording the racing line of %s" % track_id)


func _show() -> void:
	_note.text = "Recording the AI racing line\nDrive a calm lap through all the gates: every lap you finish replaces the line.\n" + \
		("Laps driven: %d (the last one is the line). " % laps if laps > 0 else "") + "Esc or Stop saves the last lap as the line and goes back to the editor."


func _unhandled_input(event: InputEvent) -> void:
	if result == "" and event.is_action_pressed("menu"):
		get_viewport().set_input_as_handled()
		finish()


## Esc or Stop: the last lap is the line of the track (or nothing changes when no lap was finished).
func finish() -> void:
	if result != "":
		return
	if lap.is_empty():
		result = "none"
	else:
		var n := save(track_id, lap)
		result = str(n) if n > 0 else "failed"
	RunLog.event("racing line recording: %s" % result)
	done.emit(result)


## The points of a lap (every third sample, rounded to centimetres) as "racing_line" of the track: the number of points,
## or 0 when it could not be written.
static func save(id: String, samples: PackedFloat32Array) -> int:
	var line := []
	var n := samples.size() / LapTimer.FIELDS
	for i in range(0, n, 3):
		var k := i * LapTimer.FIELDS
		line.append({"x": snappedf(samples[k], 0.01), "y": snappedf(samples[k + 1], 0.01), "z": snappedf(samples[k + 2], 0.01)})
	var rel := "tracks/%s/track.json" % id
	var path := Content.path(rel)
	var config: Variant = JSON.parse_string(FileAccess.get_file_as_string(path)) if FileAccess.file_exists(path) else null
	if not config is Dictionary or line.size() < 10:
		return 0
	(config as Dictionary).erase("id")
	config["racing_line"] = line
	config["line_date"] = Time.get_datetime_string_from_system(true) + "Z"      # (the laps of before are not the line of the AI)
	# (where the track was loaded from; a track of the game that cannot be written there gets a copy in the garage)
	var f := FileAccess.open(path, FileAccess.WRITE) if not path.begins_with("res://") else null
	if f == null:
		path = ProjectSettings.globalize_path(Garage.DIR).path_join(rel)
		DirAccess.make_dir_recursive_absolute(path.get_base_dir())
		f = FileAccess.open(path, FileAccess.WRITE)
	if f == null:
		return 0
	f.store_string(JSON.stringify(config, "  ", false))
	f.close()
	return line.size()
