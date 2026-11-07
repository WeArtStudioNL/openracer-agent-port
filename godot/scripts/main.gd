extends Node
## The start of the game: a menu to choose a car and a track, and the drive itself (World).
## On the command line: -- --car=<id> --track=<id> starts a drive at once; --quit-after=<seconds> ends it.

var menu: Control
var world: World
var _cars: Array[Dictionary] = []
var _tracks: Array[Dictionary] = []
var _car_pick: OptionButton
var _track_pick: OptionButton
var _mode_pick: OptionButton
var _opponents_pick: OptionButton
var _laps_pick: OptionButton
var _grid_pick: OptionButton
var _race_rows: Array[Control] = []


func _ready() -> void:
	_fit_window()
	_cars = Content.list_cars()
	_tracks = Content.list_tracks()
	_build_menu()
	if Content.arg("editor") != "":
		_open_track_editor.call_deferred(Content.arg("editor") if Content.arg("editor") != "1" else "")
	var c := Content.arg("car")
	var t := Content.arg("track")
	if (c != "" or t != "") and Content.arg("editor") == "":
		var opts := {}
		if Content.arg("race") != "":
			opts = {"mode": "race", "opponents": int(Content.arg("opponents")) if Content.arg("opponents") != "" else 5,
				"laps": int(Content.arg("laps")) if Content.arg("laps") != "" else 3, "pole": Content.arg("pole") != ""}
		_start(c if c != "" else "openracer-muscle", t if t != "" else "testtrack", opts)
	var quit_after := Content.arg("quit-after")
	if quit_after != "":
		get_tree().create_timer(float(quit_after)).timeout.connect(get_tree().quit)


## On a screen with a scale (a Retina screen: 2), the window of 1600 x 900 pixels is half as big as meant: it is
## made as big as the scale asks, at most nine tenths of the screen, in the middle. The menu and the dashboard
## grow with the window (the stretch mode canvas_items of project.godot).
func _fit_window() -> void:
	if DisplayServer.get_name() == "headless" or DisplayServer.window_get_mode() != DisplayServer.WINDOW_MODE_WINDOWED:
		return
	var screen := DisplayServer.window_get_current_screen()
	var scale := DisplayServer.screen_get_scale(screen)
	if scale <= 1.0:
		return
	var usable := DisplayServer.screen_get_usable_rect(screen)
	var want := Vector2(DisplayServer.window_get_size()) * scale
	want = want * minf(1.0, minf(usable.size.x * 0.9 / want.x, usable.size.y * 0.9 / want.y))
	var size := Vector2i(want)
	DisplayServer.window_set_size(size)
	DisplayServer.window_set_position(usable.position + (usable.size - size) / 2)
	RunLog.line("window fitted to the screen scale %.1f: %s" % [scale, size])


func _build_menu() -> void:
	menu = Control.new()
	menu.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(menu)
	var bg := ColorRect.new()
	bg.color = Color(0.09, 0.12, 0.16)
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	menu.add_child(bg)
	var centre := CenterContainer.new()
	centre.set_anchors_preset(Control.PRESET_FULL_RECT)
	menu.add_child(centre)
	var box := VBoxContainer.new()
	box.custom_minimum_size = Vector2(420, 0)
	box.add_theme_constant_override("separation", 14)
	centre.add_child(box)
	var title := Label.new()
	title.text = "O-Racer"
	title.add_theme_font_size_override("font_size", 56)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(title)
	var sub := Label.new()
	sub.text = "Godot prototype · phase 3 · " + str(ProjectSettings.get_setting("application/config/version"))
	sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	sub.modulate.a = 0.7
	box.add_child(sub)
	if Content.root == "":
		var err := Label.new()
		err.text = "The cars and tracks were not found (the web folder next to godot/)."
		box.add_child(err)
		return
	box.add_child(_caption("Car"))
	_car_pick = OptionButton.new()
	for c in _cars:
		_car_pick.add_item(str(c["name"]))
		if c["id"] == "openracer-muscle":
			_car_pick.select(_car_pick.item_count - 1)
	box.add_child(_car_pick)
	box.add_child(_caption("Track"))
	_track_pick = OptionButton.new()
	for t in _tracks:
		_track_pick.add_item(str(t["name"]))
		if t["id"] == "testtrack":
			_track_pick.select(_track_pick.item_count - 1)
	box.add_child(_track_pick)
	box.add_child(_caption("Mode"))
	_mode_pick = _options(box, ["Practice (free driving, laps and the ghost)", "Race against the AI"], 0)
	_opponents_pick = _race_row(box, "Opponents", ["1", "2", "3", "4", "5", "6", "7"], 4)
	_laps_pick = _race_row(box, "Laps", ["1", "2", "3", "4", "5", "8", "10"], 2)
	_grid_pick = _race_row(box, "Start", ["At the back of the grid", "On pole"], 0)
	_mode_pick.item_selected.connect(func(_i: int): _show_race_rows())
	_show_race_rows()
	var go := Button.new()
	go.text = "Drive"
	go.custom_minimum_size.y = 48
	go.pressed.connect(func():
		var opts := {"mode": "practice"}
		if _mode_pick.selected == 1:
			opts = {"mode": "race", "opponents": int(_opponents_pick.get_item_text(_opponents_pick.selected)),
				"laps": int(_laps_pick.get_item_text(_laps_pick.selected)), "pole": _grid_pick.selected == 1}
		_start(_cars[_car_pick.selected]["id"], _tracks[_track_pick.selected]["id"], opts))
	box.add_child(go)
	var replays := Button.new()
	replays.text = "Replays…"
	replays.pressed.connect(_open_replays)
	box.add_child(replays)
	var editor := Button.new()
	editor.text = "Track editor"
	editor.pressed.connect(_open_track_editor)
	box.add_child(editor)
	var garage := Button.new()
	garage.text = "Import a car or track (zip)…"
	garage.pressed.connect(_import_zip)
	box.add_child(garage)
	var settings := Button.new()
	settings.text = "Settings"
	settings.pressed.connect(_open_settings)
	box.add_child(settings)
	var quit := Button.new()
	quit.text = "Quit"
	quit.pressed.connect(get_tree().quit)
	box.add_child(quit)
	go.grab_focus.call_deferred()


func _options(box: Control, items: Array, selected: int) -> OptionButton:
	var o := OptionButton.new()
	for it in items:
		o.add_item(str(it))
	o.select(selected)
	box.add_child(o)
	return o


## A choice of the race, with its caption beside it (shown in race mode).
func _race_row(box: Control, caption: String, items: Array, selected: int) -> OptionButton:
	var row := HBoxContainer.new()
	var l := _caption(caption)
	l.custom_minimum_size.x = 110
	row.add_child(l)
	var o := OptionButton.new()
	for it in items:
		o.add_item(str(it))
	o.select(selected)
	o.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(o)
	box.add_child(row)
	_race_rows.append(row)
	return o


func _show_race_rows() -> void:
	for r in _race_rows:
		r.visible = _mode_pick.selected == 1


func _open_settings() -> void:
	var layer := CanvasLayer.new()
	layer.layer = 10
	add_child(layer)
	var centre := CenterContainer.new()
	centre.set_anchors_preset(Control.PRESET_FULL_RECT)
	layer.add_child(centre)
	var m := SettingsMenu.new()
	m.closed.connect(layer.queue_free)
	centre.add_child(m)


func _caption(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.modulate.a = 0.7
	return l


func _start(car_id: String, track_id: String, opts := {}) -> void:
	if world != null:
		world.queue_free()
	menu.visible = false
	RunLog.event("drive  car %s  track %s  %s" % [car_id, track_id, opts])
	world = World.new()
	world.setup(car_id, track_id, opts)
	world.leave.connect(_back_to_menu)
	add_child(world)


## (Race again: the world made a new one of itself)
## The saved replays (Replay): one is played in a viewer, Exit comes back here.
func _open_replays() -> void:
	var files := Replay.list_files()
	var dlg := AcceptDialog.new()
	dlg.title = "Replays"
	dlg.ok_button_text = "Close"
	var list := ItemList.new()
	list.custom_minimum_size = Vector2(620, 360)
	var heads: Array = []
	for f in files:
		var h := Replay.read_head(f)
		if h.is_empty():
			continue
		heads.append([f, h])
		var stamp := f.get_file().get_basename().get_slice("__", 1)
		list.add_item("%s · %s · %d car%s · %s · %s" % [h["track"], h["cars"][0], h["cars"].size(), "" if h["cars"].size() == 1 else "s",
			LapTimer.format_time(h["seconds"]), stamp])
	if heads.is_empty():
		list.add_item("No replays yet: Esc, Replay, Save replay while you drive.")
	list.item_activated.connect(func(i: int):
		if i < heads.size():
			dlg.queue_free()
			var h: Dictionary = heads[i][1]
			_start(str(h["cars"][0]), str(h["track"]), {"mode": "replay", "file": heads[i][0]}))
	dlg.add_child(list)
	dlg.confirmed.connect(dlg.queue_free)
	dlg.canceled.connect(dlg.queue_free)
	add_child(dlg)
	dlg.popup_centered()


## The track editor (TrackEditor): Test drive saves the track and drives it with the car chosen in the menu; leaving it
## comes back here with the tracks of the garage in the list.
func _open_track_editor(track_id := "") -> void:
	menu.visible = false
	var ed := TrackEditor.new()
	if track_id != "":
		ed.set_meta("open", track_id)
	ed.leave.connect(func():
		ed.queue_free()
		_rebuild_menu(""))
	ed.drive.connect(func(id: String):
		ed.queue_free()
		_rebuild_menu("")
		menu.visible = false
		_start(_cars[_car_pick.selected]["id"] if _car_pick != null else "openracer-muscle", id, {"mode": "practice"}))
	add_child(ed)


## A car or a track from a zip into the garage (Garage): the menu is made again with it in its list.
func _import_zip() -> void:
	var dlg := FileDialog.new()
	dlg.file_mode = FileDialog.FILE_MODE_OPEN_FILE
	dlg.access = FileDialog.ACCESS_FILESYSTEM
	dlg.use_native_dialog = true
	dlg.filters = PackedStringArray(["*.zip ; Car or track"])
	dlg.title = "A car or a track (zip)"
	add_child(dlg)
	dlg.file_selected.connect(func(p: String):
		var r := Garage.import_zip(p)
		dlg.queue_free()
		_rebuild_menu(str(r.get("error", "")) if r.has("error") else "%s imported: %s" % ["Car" if r["kind"] == "cars" else "Track", r["id"]]))
	dlg.canceled.connect(dlg.queue_free)
	dlg.popup_centered_ratio(0.6)


func _rebuild_menu(message: String) -> void:
	_cars = Content.list_cars()
	_tracks = Content.list_tracks()
	if menu != null:
		menu.queue_free()
	_build_menu()
	if message != "":
		var note := Label.new()
		note.text = message
		note.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		note.position = Vector2(20, 20)
		menu.add_child(note)


func set_world(w: World) -> void:
	world = w


func _back_to_menu() -> void:
	RunLog.event("menu")
	if world != null:
		world.queue_free()
		world = null
	menu.visible = true
