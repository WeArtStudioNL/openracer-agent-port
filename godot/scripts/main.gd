extends Node
## The start of the game: a menu to choose a car and a track, and the drive itself (World).
## On the command line: -- --car=<id> --track=<id> starts a drive at once; --quit-after=<seconds> ends it.

var menu: Control
var world: World
var steps: MainMenu = null          # the steps of Play (MainMenu), over the home screen
var _cars: Array[Dictionary] = []
var _tracks: Array[Dictionary] = []
var _note: Label


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
				"laps": int(Content.arg("laps")) if Content.arg("laps") != "" else 3, "pole": Content.arg("pole") != "",
				"grid": "front" if Content.arg("pole") != "" else "back", "difficulty": Content.arg("difficulty") if Content.arg("difficulty") != "" else "normal"}
		elif Content.arg("mode") == "skidpad":
			opts = {"mode": "skidpad", "surface": Content.arg("surface") if Content.arg("surface") != "" else "road"}
		_start(c if c != "" else "openracer-muscle", t if t != "" else ("skidpad" if opts.get("mode") == "skidpad" else "testtrack"), opts)
	elif Content.arg("menu-step") != "":
		_test_menu.call_deferred(Content.arg("menu-step"))
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


## The home screen (MainMenu.js home): the logo, Play, the quick start of a first visit, the links (the garage, the
## replays, the settings, the car editor, an import, quit) and the foot (openracer.eu, Discord, the version).
func _build_menu() -> void:
	menu = Control.new()
	menu.set_anchors_preset(Control.PRESET_FULL_RECT)
	menu.theme = MenuStyle.make_theme()
	add_child(menu)
	var bg := ColorRect.new()
	bg.color = MenuStyle.BG
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	menu.add_child(bg)
	var glow := TextureRect.new()
	var g := GradientTexture2D.new()
	g.fill = GradientTexture2D.FILL_RADIAL
	g.fill_from = Vector2(0.5, -0.1)
	g.fill_to = Vector2(0.5, 0.55)
	g.gradient = Gradient.new()
	g.gradient.set_color(0, Color(1.0, 0.35, 0.12, 0.16))
	g.gradient.set_color(1, Color(1.0, 0.35, 0.12, 0.0))
	glow.texture = g
	glow.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	glow.set_anchors_preset(Control.PRESET_FULL_RECT)
	glow.mouse_filter = Control.MOUSE_FILTER_IGNORE
	menu.add_child(glow)
	var centre := CenterContainer.new()
	centre.set_anchors_preset(Control.PRESET_FULL_RECT)
	menu.add_child(centre)
	var home := VBoxContainer.new()
	home.custom_minimum_size = Vector2(560, 0)
	home.add_theme_constant_override("separation", 14)
	centre.add_child(home)
	home.add_child(MenuStyle.logo(true))
	var tag := MenuStyle.label("A racing simulator, rebuilt in Godot.", 18, MenuStyle.MUTED)
	tag.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	home.add_child(tag)
	_note = MenuStyle.label("", 14, MenuStyle.ACCENT2, true)
	_note.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_note.visible = false
	home.add_child(_note)
	if Content.root == "":
		var err := MenuStyle.label("The cars and tracks were not found (the web folder next to godot/).", 16, MenuStyle.BAD)
		home.add_child(err)
		return
	var play_row := CenterContainer.new()
	home.add_child(play_row)
	var go := MenuStyle.button("Play", "primary", _open_steps)
	go.add_theme_font_size_override("font_size", 22)
	go.custom_minimum_size = Vector2(240, 60)
	go.disabled = _cars.is_empty() or _tracks.is_empty()
	play_row.add_child(go)
	# the first visit: a stadium truck over the dunes of the Desert, at once
	var store := ConfigFile.new()
	store.load(MainMenu.store_path())
	var has_truck := _cars.any(func(c): return c["id"] == "stadium-truck") and _tracks.any(func(t): return t["id"] == "desert")
	if has_truck and not store.get_value("menu", "welcomed", false):
		var quick := LinkButton.new()
		quick.text = "New here? Jump a stadium truck over the dunes of the Desert"
		quick.add_theme_color_override("font_color", MenuStyle.ACCENT2)
		quick.focus_mode = Control.FOCUS_ALL
		quick.pressed.connect(func():
			store.set_value("menu", "welcomed", true)
			store.save(MainMenu.store_path())
			_start("stadium-truck", "desert", {"mode": "practice", "ghost": false, "records": false}))
		var qc := CenterContainer.new()
		qc.add_child(quick)
		home.add_child(qc)
	var links := CenterContainer.new()
	home.add_child(links)
	var box := HFlowContainer.new()
	box.alignment = FlowContainer.ALIGNMENT_CENTER
	box.add_theme_constant_override("h_separation", 8)
	box.add_theme_constant_override("v_separation", 8)
	box.custom_minimum_size.x = 560
	links.add_child(box)
	var garage_button := MenuStyle.button("Garage", "ghost", _open_garage)
	box.add_child(garage_button)
	var replays := Button.new()
	replays.text = "Replays"
	replays.pressed.connect(_open_replays)
	box.add_child(replays)
	var track_editor := Button.new()
	track_editor.text = "Track editor"
	track_editor.pressed.connect(_open_track_editor)
	box.add_child(track_editor)
	var car_editor := Button.new()
	car_editor.text = "Car editor"
	car_editor.pressed.connect(_open_car_editor)
	box.add_child(car_editor)
	var settings := Button.new()
	settings.text = "Settings"
	settings.pressed.connect(_open_settings)
	box.add_child(settings)
	var quit := Button.new()
	quit.text = "Quit"
	quit.pressed.connect(get_tree().quit)
	box.add_child(quit)
	var foot := HBoxContainer.new()
	foot.alignment = BoxContainer.ALIGNMENT_CENTER
	foot.add_theme_constant_override("separation", 16)
	for l in [["openracer.eu", "https://openracer.eu"], ["Discord", "https://discord.gg/JFgHVFUagF"],
			["v" + str(ProjectSettings.get_setting("application/config/version")) + _game_version(), "https://openracer.eu/changelog.html"]]:
		var link := LinkButton.new()
		link.text = l[0]
		link.underline = LinkButton.UNDERLINE_MODE_ON_HOVER
		link.focus_mode = Control.FOCUS_ALL
		link.pressed.connect(OS.shell_open.bind(l[1]))
		foot.add_child(link)
	var gap := Control.new()
	gap.custom_minimum_size.y = 26
	home.add_child(gap)
	home.add_child(foot)
	go.grab_focus.call_deferred()


## The version of the browser game whose content this reads (web/js/Version.js), " · OpenRacer 2.5.0".
func _game_version() -> String:
	var f := Content.root.path_join("js/Version.js")
	if not FileAccess.file_exists(f):
		return ""
	var m := RegEx.create_from_string("VERSION\\s*=\\s*\"([^\"]+)\"").search(FileAccess.get_file_as_string(f))
	return " · OpenRacer " + m.get_string(1) if m != null else ""


## Play: the steps (MainMenu) over the home screen.
func _open_steps(at := "") -> void:
	if steps != null:
		steps.queue_free()
	steps = MainMenu.new()
	add_child(steps)
	menu.visible = false
	steps.home.connect(func():
		steps.queue_free()
		steps = null
		menu.visible = true
		_focus_home())
	steps.begin.connect(func(car_id: String, track_id: String, opts: Dictionary): _start(car_id, track_id, opts))
	if at != "" and at != "home":
		steps.go(at)


func _focus_home() -> void:
	for b in menu.find_children("*", "Button", true, false):
		if (b as Button).text == "Play":
			(b as Button).grab_focus()


## (the tests: --menu-step=car --mode=race opens that screen; --menu-shot=file.png --shot-at=3 saves it and quits)
func _test_menu(step: String) -> void:
	if step == "garage":
		_open_garage()
	elif step == "replays":
		_open_replays()
	elif step != "home":
		var store := ConfigFile.new()
		store.load(MainMenu.store_path())
		if Content.arg("mode") != "":
			store.set_value("menu", "mode", Content.arg("mode"))
			store.save(MainMenu.store_path())
		_open_steps(step)
		if step == "opponents" and Content.arg("pick") != "":
			steps._opp_pick = {"stage": Content.arg("pick")} if Content.arg("pick") == "car" else {"stage": "tune", "car": steps.choice["car"]}
			steps.render()
		if Content.arg("more") != "":
			steps._show_more()
		if Content.arg("menu-start") != "":
			steps.start()                  # (the test of what the menu starts)
		if Content.arg("drag-top") != "":
			DragTopWindow.open(steps, Content.arg("drag-top"), steps.track_config(Content.arg("drag-top")))
	var shot := Content.arg("menu-shot")
	if shot != "":
		await get_tree().create_timer(float(Content.arg("shot-at")) if Content.arg("shot-at") != "" else 3.0).timeout
		await RenderingServer.frame_post_draw
		get_viewport().get_texture().get_image().save_png(shot)
		print("shot: ", shot)
		get_tree().quit()


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


func _start(car_id: String, track_id: String, opts := {}) -> void:
	CarInfo.showcase_end()
	if world != null:
		world.queue_free()
	menu.visible = false
	if steps != null:
		steps.queue_free()
		steps = null
	RunLog.event("drive  car %s  track %s  %s" % [car_id, track_id, opts])
	world = World.new()
	world.setup(car_id, track_id, opts)
	world.leave.connect(_back_to_menu)
	add_child(world)


## (Race again: the world made a new one of itself)
## The saved replays (ReplayFiles): Watch plays one in a viewer, Edit opens the video editor; Exit comes back here.
func _open_replays() -> void:
	ReplayFiles.open_dialog(self, _start)


## The track editor (TrackEditor): Test drive saves the track and drives it with the car chosen in the menu; leaving it
## comes back here with the tracks of the garage in the list.
func _open_track_editor(track_id := "") -> void:
	CarInfo.showcase_end()
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
		_start(str(steps.choice["car"]) if steps != null and str(steps.choice["car"]) != "" else "openracer-muscle", id, {"mode": "practice"}))
	add_child(ed)


## The garage (GarageDialog): its cars and tracks, import, export, delete, a folder of the player's own.
func _open_garage() -> void:
	var d := GarageDialog.new()
	d.theme = MenuStyle.make_theme()
	add_child(d)
	d.closed.connect(func():
		if d.changed:
			_rebuild_menu("")
		else:
			_focus_home())
	d.edit_car.connect(_open_car_editor)
	d.new_car.connect(_open_car_editor.bind(""))
	d.edit_track.connect(_open_track_editor)
	d.new_track.connect(_open_track_editor.bind(""))


## The car editor (scripts/editor/car_editor.gd): over the menu; Save and test drives the car, back in the editor after.
func _open_car_editor(car_id := "") -> void:
	CarInfo.showcase_end()
	var ed := CarEditor.new()
	add_child(ed)
	menu.visible = false
	if car_id != "":
		ed.load_existing.call_deferred(car_id)
	ed.closed.connect(func():
		ed.queue_free()
		_rebuild_menu(""))
	ed.test_drive.connect(func(car_id: String, track_id: String): _start(car_id, track_id, {"mode": "practice"}))


func _rebuild_menu(message: String) -> void:
	_cars = Content.list_cars()
	_tracks = Content.list_tracks()
	if menu != null:
		menu.queue_free()
	_build_menu()
	if message != "":
		_note.text = message
		_note.visible = true


func set_world(w: World) -> void:
	world = w


func _back_to_menu() -> void:
	RunLog.event("menu")
	if world != null:
		world.queue_free()
		world = null
	menu.visible = true
	_focus_home()
