extends Node
## The start of the game: a menu to choose a car and a track, and the drive itself (World).
## On the command line: -- --car=<id> --track=<id> starts a drive at once; --quit-after=<seconds> ends it.

var menu: Control
var world: World
var _cars: Array[Dictionary] = []
var _tracks: Array[Dictionary] = []
var _car_pick: OptionButton
var _track_pick: OptionButton


func _ready() -> void:
	_fit_window()
	_cars = Content.list_cars()
	_tracks = Content.list_tracks()
	_build_menu()
	var c := Content.arg("car")
	var t := Content.arg("track")
	if c != "" or t != "":
		_start(c if c != "" else "openracer-muscle", t if t != "" else "testtrack")
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
	sub.text = "Godot prototype · phase 1 · " + str(ProjectSettings.get_setting("application/config/version"))
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
	var go := Button.new()
	go.text = "Drive"
	go.custom_minimum_size.y = 48
	go.pressed.connect(func(): _start(_cars[_car_pick.selected]["id"], _tracks[_track_pick.selected]["id"]))
	box.add_child(go)
	var quit := Button.new()
	quit.text = "Quit"
	quit.pressed.connect(get_tree().quit)
	box.add_child(quit)
	go.grab_focus.call_deferred()


func _caption(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.modulate.a = 0.7
	return l


func _start(car_id: String, track_id: String) -> void:
	if world != null:
		world.queue_free()
	menu.visible = false
	RunLog.event("drive  car %s  track %s" % [car_id, track_id])
	world = World.new()
	world.setup(car_id, track_id)
	world.leave.connect(_back_to_menu)
	add_child(world)


func _back_to_menu() -> void:
	RunLog.event("menu")
	if world != null:
		world.queue_free()
		world = null
	menu.visible = true
