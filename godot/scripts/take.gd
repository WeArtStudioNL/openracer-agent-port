class_name Take
extends CanvasLayer
## A take (web/js/Take.js): the 5 key starts one. A window asks for the picture (16:9, 9:16 or 1:1), what to make
## (a video or a replay) and whether the HUD goes away; then a count of five seconds in the frame, and the take runs:
## the picture as a frame in the window (a dark passepartout round it, a red blinking dot with the time at its top
## right). The 5 key again stops it, and a window asks for a name and what to cut off at the start and the end:
## a replay (the part of the recording from the start to the stop, in Replays of the main menu) or a video (the
## replay is opened on that part, played and filmed with the camera as it was during the take, and the game goes
## on). The replay recorder runs all the time: a take only marks where it starts and where it stops.
##
## (The browser films a take without a cut live from the screen; here every video of a take is filmed from the
## recording afterwards, at 30 frames a second, so that the game runs as it does while you drive.)

signal state_changed(state: String)

var world: Node
var taking := false
var counting := false
var asking := false
var kind := "video"
var _from := 0
var _count_left := 0.0
var _cam: Array = []                # the camera during the take: {s, xf, fov} per sample
var _overlay: Control
var _count_label: Label
var _blink := 0.0
var _hud_was := true


func setup(w: Node) -> void:
	world = w
	name = "Take"
	layer = 11
	process_mode = Node.PROCESS_MODE_ALWAYS


func _ready() -> void:
	_overlay = Control.new()
	_overlay.set_anchors_preset(Control.PRESET_FULL_RECT)
	_overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_overlay.draw.connect(_draw_overlay)
	_overlay.visible = false
	add_child(_overlay)
	_count_label = Label.new()
	_count_label.add_theme_font_size_override("font_size", 140)
	_count_label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.7))
	_count_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_count_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_count_label.set_anchors_preset(Control.PRESET_FULL_RECT)
	_count_label.visible = false
	add_child(_count_label)


func state() -> String:
	return "counting" if counting else ("taking" if taking else ("asking" if asking else "idle"))


func _replay() -> Replay:
	return world.get("replay") as Replay if world != null else null


func _unhandled_input(event: InputEvent) -> void:
	# (the key of Settings, Controls, 5 as it comes; the Record button of the touch controls is the same action)
	if event.is_action_pressed("take") and not event.is_echo():
		toggle()
		get_viewport().set_input_as_handled()


func _say(text: String) -> void:
	var hud: Variant = world.get("hud")
	if hud != null and hud.has_method("toast"):
		hud.toast(text)


## The 5 key: asks and starts, cancels the count, or stops the take and asks how to keep it.
func toggle() -> void:
	var r := _replay()
	if r == null or r.playing or r.viewer or asking:
		return
	if counting:
		_end(false)
		_say("Recording cancelled")
		return
	if not taking:
		if get_tree().paused:
			return
		_ask_start(r)
		return
	var to := r.sample_now()
	var seconds := (to - _from) / Replay.RATE
	_end(true)
	if seconds < 0.5:
		_say("The take is too short")
		return
	var track := str(r.cars[0].get_meta("track_name", "")) if not r.cars.is_empty() else ""
	var default_name := ("%stake %s" % [track + " " if track != "" else "", Time.get_datetime_string_from_system().replace("T", " ").left(16).replace(":", ".")]).left(80)
	_ask_save(r, seconds, default_name, _from, to)


func _hold(on: bool) -> void:
	get_tree().paused = on
	asking = on
	state_changed.emit(state())


## Before it starts: the picture, video or replay, and whether the HUD goes away while it runs.
func _ask_start(r: Replay) -> void:
	_hold(true)
	if Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	var aspect := VideoPrefs.aspect()
	var fmt := str(VideoPrefs.get_value("take", "format", "video"))
	var hide := bool(VideoPrefs.get_value("take", "hide", true))
	var dlg := ReplayBar.ask(self, "Record", "The 5 key starts it after a count of five seconds, and stops it.", [["Cancel", func(): _hold(false)], ["Start", func():
		VideoPrefs.set_value("take", "format", fmt)
		VideoPrefs.set_value("take", "hide", hide)
		_hold(false)
		_begin(r, aspect, fmt, hide)]])
	var box: VBoxContainer = dlg.get("body")
	var pic := HBoxContainer.new()
	var make := HBoxContainer.new()
	var hint := Label.new()
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	hint.modulate.a = 0.7
	var sync := func() -> void:
		for b in pic.get_children():
			b.button_pressed = b.get_meta("v") == aspect
		for b in make.get_children():
			b.button_pressed = b.get_meta("v") == fmt
		hint.text = "The video is filmed from the recording when you stop." if fmt == "video" else \
			"The take is kept in Replays of the main menu, where it can be watched, edited and filmed."
	for a in [["16:9", "16:9 landscape"], ["9:16", "9:16 upright"], ["1:1", "1:1 square"]]:
		var b := Button.new()
		b.text = a[1]
		b.toggle_mode = true
		b.set_meta("v", a[0])
		b.pressed.connect(func():
			aspect = a[0]
			VideoPrefs.set_aspect(a[0])
			sync.call())
		pic.add_child(b)
	for f in [["video", "Video (mp4)"], ["replay", "Replay"]]:
		var b := Button.new()
		b.text = f[1]
		b.toggle_mode = true
		b.set_meta("v", f[0])
		b.pressed.connect(func():
			fmt = f[0]
			sync.call())
		make.add_child(b)
	var check := CheckBox.new()
	check.text = "Hide the HUD while it runs"
	check.button_pressed = hide
	check.toggled.connect(func(on: bool): hide = on)
	var at := 2
	for item in [_caption("PICTURE"), pic, _caption("MAKE"), make, hint, check]:
		box.add_child(item)
		box.move_child(item, at)
		at += 1
	sync.call()


func _caption(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.modulate.a = 0.6
	l.add_theme_font_size_override("font_size", 12)
	return l


func _begin(r: Replay, aspect: String, fmt: String, hide: bool) -> void:
	VideoPrefs.set_aspect(aspect)
	kind = fmt
	_from = r.sample_now()
	var hud: Variant = world.get("hud")
	if hud is CanvasLayer:
		_hud_was = hud.visible
		if hide:
			hud.visible = false
	_overlay.visible = true
	counting = true
	_count_left = 5.0
	state_changed.emit(state())


func _end(_save: bool) -> void:
	taking = false
	counting = false
	_overlay.visible = false
	_count_label.visible = false
	var hud: Variant = world.get("hud")
	if hud is CanvasLayer:
		hud.visible = _hud_was
	state_changed.emit(state())


func _process(delta: float) -> void:
	if counting and not get_tree().paused:
		_count_left -= delta
		_count_label.visible = true
		_count_label.text = str(ceili(_count_left))
		if _count_left <= 0.0:
			counting = false
			_count_label.visible = false
			var r := _replay()
			taking = true
			_from = r.sample_now()
			_cam.clear()
			state_changed.emit(state())
	if taking:
		var r := _replay()
		var cam := get_viewport().get_camera_3d()
		var s := r.sample_now()
		if cam != null and (_cam.is_empty() or _cam[-1]["s"] != s):
			_cam.append({"s": s, "xf": cam.global_transform, "fov": cam.fov})
	if _overlay.visible:
		_blink += delta
		_overlay.queue_redraw()


func _draw_overlay() -> void:
	var size := _overlay.size
	var f := VideoPrefs.frame_rect(size)
	var dark := Color(0, 0, 0, 0.6)
	_overlay.draw_rect(Rect2(0, 0, size.x, f.position.y), dark)
	_overlay.draw_rect(Rect2(0, f.end.y, size.x, size.y - f.end.y), dark)
	_overlay.draw_rect(Rect2(0, f.position.y, f.position.x, f.size.y), dark)
	_overlay.draw_rect(Rect2(f.end.x, f.position.y, size.x - f.end.x, f.size.y), dark)
	_overlay.draw_rect(f, Color(1, 1, 1, 0.55), false, 1.0)
	if taking:
		var r := _replay()
		var secs := (r.sample_now() - _from) / Replay.RATE
		var text := "REC %d:%02d" % [int(secs / 60.0), int(secs) % 60]
		var font := ThemeDB.fallback_font
		var box := Rect2(f.end.x - 118, f.position.y + 8, 108, 26)
		_overlay.draw_rect(box, Color(0.055, 0.07, 0.09, 0.6))
		if fmod(_blink, 1.0) < 0.5:
			_overlay.draw_circle(box.position + Vector2(14, 13), 5.5, Color("ff3b30"))
		_overlay.draw_string(font, box.position + Vector2(26, 18), text, HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Color.WHITE)


## After it: a name, what to cut from the start and from the end, and save.
func _ask_save(r: Replay, seconds: float, default_name: String, a0: int, b0: int) -> void:
	_hold(true)
	var cut := {"start": 0.0, "end": 0.0}
	var line := LineEdit.new()
	line.text = default_name
	line.max_length = 80
	var result := Label.new()
	result.text = "Saved: %.1f s" % seconds
	var save := func() -> void:
		_hold(false)
		var n := line.text.strip_edges() if line.text.strip_edges() != "" else default_name
		var a := a0 + roundi(cut["start"] * Replay.RATE)
		var b := b0 - roundi(cut["end"] * Replay.RATE)
		_keep(r, n, a, b)
	var dlg := ReplayBar.ask(self, "Save the take", "%.1f s, as a %s." % [seconds, "video (mp4)" if kind == "video" else "replay"],
		[["Discard", func(): _hold(false)], ["Save", save]])
	var box: VBoxContainer = dlg.get("body")
	var items: Array = [_caption("NAME"), line, _caption("CUT OFF")]
	var limit := maxf(0.0, floorf((seconds - 0.5) * 2.0) / 2.0)
	for side in [["From the start", "start"], ["From the end", "end"]]:
		var row := HBoxContainer.new()
		var l := Label.new()
		l.text = side[0]
		l.custom_minimum_size.x = 120
		var s := HSlider.new()
		s.max_value = limit
		s.step = 0.1
		s.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var v := Label.new()
		v.text = "0.0 s"
		v.custom_minimum_size.x = 60
		s.value_changed.connect(func(x: float):
			var other := "end" if side[1] == "start" else "start"
			cut[side[1]] = minf(x, maxf(0.0, seconds - 0.5 - cut[other]))
			s.set_value_no_signal(cut[side[1]])
			v.text = "%.1f s" % cut[side[1]]
			result.text = "Saved: %.1f s" % (seconds - cut["start"] - cut["end"]))
		row.add_child(l)
		row.add_child(s)
		row.add_child(v)
		items.append(row)
	items.append(result)
	var at := 2
	for item in items:
		box.add_child(item)
		box.move_child(item, at)
		at += 1
	line.grab_focus.call_deferred()
	line.text_submitted.connect(func(_t: String):
		dlg.queue_free()
		save.call())


## The take kept: a replay of the part, or a video of it filmed from the recording with the camera of the take.
func _keep(r: Replay, n: String, a: int, b: int) -> void:
	if kind == "replay":
		var p := ReplayFiles.write(r.pack(a, b), n)
		_say("Replay saved (%.1f s): in Replays of the main menu" % ((b - a) / Replay.RATE) if p != "" else "The take could not be saved")
		return
	var samples := _cam.duplicate()
	get_tree().paused = true
	r.play()
	r.bar.visible = false
	r.camera_override = func(t: float) -> Array: return _place(samples, t)
	var ok := r.bar.film(a / Replay.RATE, b / Replay.RATE, 1.0, n, func(path: String):
		r.camera_override = Callable()
		r.stop()
		get_tree().paused = false
		_say(("Video saved: " + path.get_file()) if path != "" else "No video"))
	if not ok:
		r.camera_override = Callable()
		r.stop()
		get_tree().paused = false
		_say("No video here")


## The camera at a time of the replay from the samples of the take: [Transform3D, fov] or [] when there are none.
static func _place(samples: Array, t: float) -> Array:
	if samples.is_empty():
		return []
	var s := t * Replay.RATE
	var i := 0
	while i < samples.size() - 1 and float(samples[i + 1]["s"]) <= s:
		i += 1
	var a: Dictionary = samples[i]
	var b: Dictionary = samples[mini(i + 1, samples.size() - 1)]
	var f := clampf((s - float(a["s"])) / (float(b["s"]) - float(a["s"])), 0.0, 1.0) if float(b["s"]) > float(a["s"]) else 0.0
	var xa: Transform3D = a["xf"]
	var xb: Transform3D = b["xf"]
	var q := xa.basis.get_rotation_quaternion().slerp(xb.basis.get_rotation_quaternion(), f)
	return [Transform3D(Basis(q), xa.origin.lerp(xb.origin, f)), lerpf(a["fov"], b["fov"], f)]
