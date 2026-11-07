class_name PauseMenu
extends CenterContainer
## The pause menu of a drive (the top of the Escape menu of web/js/Settings.js): Resume, Replay, Tune the car,
## Restart, Back to the start, Main menu, the drag strip of the track, and Settings (SettingsMenu in its place).
## Esc, B and Start resume; in the settings B and Esc come back here (PadNav.js).

var world: World
var settings: SettingsMenu = null
var _box: VBoxContainer


func setup(w: World) -> void:
	world = w
	process_mode = Node.PROCESS_MODE_ALWAYS
	set_anchors_preset(Control.PRESET_FULL_RECT)


func _ready() -> void:
	SettingsMenu.pad_ui()
	show_buttons()


func show_buttons() -> void:
	if settings != null:
		settings.queue_free()
		settings = null
	if _box != null:
		_box.queue_free()
	_box = VBoxContainer.new()
	_box.custom_minimum_size = Vector2(340, 0)
	_box.add_theme_constant_override("separation", 10)
	add_child(_box)
	var title := Label.new()
	title.text = "Paused"
	title.add_theme_font_size_override("font_size", 30)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_box.add_child(title)
	var can_replay: bool = world.replay != null and world.replay.count >= 2
	var items := [
		["Resume", world.resume, ""],
		["Replay", world._start_replay, "" if can_replay else "Nothing is recorded yet"],
		["Tune the car", _tune, ""],
		["Restart", _restart, "Start again from the grid, with the same car, track and options" if world.race != null
			else "Start the drive again"],
		["Back to the start", _to_start, ""],
		["Settings", show_settings, ""],
	]
	if world.track != null and world.track.config.get("dragstrip") is Dictionary:
		items.append(["Drag strip: Top 50 and tickets", func(): DragTopWindow.open(self, world.track.track_id, world.track.config), ""])
	items.append(["Main menu", _main_menu, ""])
	for item in items:
		var b := Button.new()
		b.text = item[0]
		b.custom_minimum_size.y = 44
		b.pressed.connect(item[1])
		if item[0] == "Replay" and not can_replay:
			b.disabled = true
		if item[2] != "":
			b.tooltip_text = item[2]
		_box.add_child(b)
	(_box.get_child(1) as Button).grab_focus.call_deferred()


func show_settings() -> void:
	if Content.arg("settings-tab") == "pause" and settings == null and _box != null and _box.get_meta("first", true):
		_box.set_meta("first", false)          # (the screenshot of the pause menu: --settings --settings-tab=pause)
		return
	if _box != null:
		_box.queue_free()
		_box = null
	settings = SettingsMenu.new()
	settings.closed.connect(func():
		if WheelInput.calibrating:
			world.resume()
		else:
			show_buttons())
	add_child(settings)


func _tune() -> void:
	world.resume()
	world.open_tuning()


func _restart() -> void:
	world.resume()
	if world.race != null:
		world._restart_race()
	else:
		world.to_start()


func _to_start() -> void:
	world.resume()
	world.to_start()


func _main_menu() -> void:
	world.resume()
	RunLog.car = null
	ForceFeedback.neutral()
	world.leave.emit()


## Esc, B or Start: resume (the settings handle their own Esc and B first).
func _unhandled_input(event: InputEvent) -> void:
	if settings != null or not is_visible_in_tree():
		return
	if event.is_action_pressed("ui_cancel") or event.is_action_pressed("menu"):
		get_viewport().set_input_as_handled()
		world.resume()
