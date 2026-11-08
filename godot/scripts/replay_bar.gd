class_name ReplayBar
extends CanvasLayer
## The bar of the replay (Replay.js "the bar"): at the top REPLAY and the time, Save replay, Photo, Video, Video
## editor and Exit; the slider over the whole recording with the fragment on it (an orange band from Mark in to
## Mark out); the fragment row: Mark in (I), Mark out (O), Save fragment (a replay file, or a video at the chosen
## speed), the cross takes the marks away; the transport: start, -10 s, Rewind, Pause, Play, +10 s, end, the speed
## (0.1x to 5x), the frame (16:9, 9:16, 1:1: an orange outline in the window, what a video takes of the picture); the
## cameras: Follow, Cockpit, Bonnet, Free, Cinematic (the cameras of the track; with a zoom and a look ahead), the car
## (Tab); the free camera's row: its speed (0.01 to 3), the smoothing of the look (5 and 6), Aim at the car (F),
## Fixed to the car (L), Fixed with the sky up (K). At the top left: the speed, the gear, the revs and the pedals of
## the player's car. H hides it all, F2 (or Photo) saves the picture as a PNG.

const ORANGE := Color("ff8a1f")
const BAND := Color(0.43, 0.78, 1.0, 0.55)

var replay: Replay
var _panel: PanelContainer
var _time_label: Label
var _note: Label
var _show_file: Button
var _slider: HSlider
var _marks: Control
var _frag_text: Label
var _frag_clear: Button
var _buttons := {}
var _speed_buttons: Array = []
var _aspect_buttons: Array = []
var _cam_buttons := {}
var _cine_row: HBoxContainer
var _cine_label: Label
var _cine_slider: HSlider
var _lead_label: Label
var _lead_slider: HSlider
var _free_row: HBoxContainer
var _free_speed: HSlider
var _free_speed_label: Label
var _look_label: Label
var _info: Label
var _frame: Control
var _dialog: Control = null
var _sliding := false
var _hidden := false
var _note_for := 0.0
var _last_file := ""


func setup(r: Replay) -> void:
	replay = r
	name = "ReplayBar"
	layer = 12
	process_mode = Node.PROCESS_MODE_ALWAYS


func _ready() -> void:
	_frame = Control.new()
	_frame.set_anchors_preset(Control.PRESET_FULL_RECT)
	_frame.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_frame.draw.connect(_draw_frame)
	add_child(_frame)
	var info_panel := PanelContainer.new()
	info_panel.position = Vector2(16, 30)
	info_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(info_panel)
	_info = Label.new()
	_info.add_theme_font_size_override("font_size", 17)
	info_panel.add_child(_info)
	_panel = PanelContainer.new()
	_panel.anchor_left = 0.5
	_panel.anchor_right = 0.5
	_panel.anchor_top = 1.0
	_panel.anchor_bottom = 1.0
	_panel.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_panel.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_panel.offset_left = -700
	_panel.offset_right = 700
	_panel.offset_bottom = -12
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.094, 0.114, 0.137, 0.88)
	sb.set_corner_radius_all(12)
	sb.set_content_margin_all(12)
	sb.border_color = Color(1, 1, 1, 0.14)
	sb.set_border_width_all(1)
	_panel.add_theme_stylebox_override("panel", sb)
	add_child(_panel)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 6)
	_panel.add_child(box)
	# the head
	var head := _row(box)
	var tag := Label.new()
	tag.text = "REPLAY"
	tag.add_theme_color_override("font_color", ORANGE)
	head.add_child(tag)
	_time_label = Label.new()
	_time_label.custom_minimum_size.x = 210
	head.add_child(_time_label)
	_note = Label.new()
	_note.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_note.clip_text = true
	_note.add_theme_color_override("font_color", Color(0.8, 0.9, 1.0))
	head.add_child(_note)
	_show_file = _button(head, "Show the file", "Show the file that was made in its folder", func(): OS.shell_show_in_file_manager(_last_file))
	_show_file.visible = false
	_buttons["save"] = _button(head, "Save replay", "Keep the replay in Replays in the main menu", _save)
	_buttons["save"].visible = not replay.viewer or replay.file_path == ""
	_button(head, "Photo", "Save the picture as it is now as a PNG, without the bar (F2)", photo)
	_buttons["video"] = _button(head, "● Video", "Record the replay from the start to the end as a video (.mp4)", _toggle_video)
	_button(head, "Video editor", "Cut this replay, change the speed, place the camera, and save it as a replay or as a video", _open_editor)
	_buttons["exit"] = _button(head, "Main menu" if replay.viewer else "Back to the game", "Escape", replay.exit)
	# the slider and the fragment on it
	var track := Control.new()
	track.custom_minimum_size.y = 28
	box.add_child(track)
	_slider = HSlider.new()
	_slider.set_anchors_preset(Control.PRESET_FULL_RECT)
	_slider.step = 0.0
	_slider.focus_mode = Control.FOCUS_NONE
	_slider.drag_started.connect(func():
		_sliding = true
		replay.scrubbing = true)
	_slider.drag_ended.connect(func(_c: bool):
		_sliding = false
		replay.scrubbing = false)
	_slider.value_changed.connect(func(v: float):
		if _sliding or not is_equal_approx(v, replay.time):
			replay.time = v)
	track.add_child(_slider)
	_marks = Control.new()
	_marks.set_anchors_preset(Control.PRESET_FULL_RECT)
	_marks.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_marks.draw.connect(_draw_marks)
	track.add_child(_marks)
	var frag := _row(box)
	_button(frag, "[ Mark in", "The fragment starts here (I)", func(): replay.set_mark("in"))
	_button(frag, "Mark out ]", "The fragment ends here (O)", func(): replay.set_mark("out"))
	_buttons["fragment"] = _button(frag, "Save fragment", "Keep the part from Mark in to Mark out: as a replay file or as a video (.mp4)", _save_fragment)
	_frag_clear = _button(frag, "×", "Take the marks away", func():
		replay.mark_in = -1.0
		replay.mark_out = -1.0)
	_frag_text = Label.new()
	_frag_text.modulate.a = 0.7
	frag.add_child(_frag_text)
	# the transport, the speed, the frame
	var tr := _row(box)
	_button(tr, "⏮", "To the start (Home)", func(): replay.jump(-1e9))
	_button(tr, "−10 s", "Ten seconds back", func(): replay.jump(-10.0))
	_buttons["rewind"] = _button(tr, "◀ Rewind", "Play backwards", replay.rewind)
	_buttons["pause"] = _button(tr, "❚❚ Pause", "Pause (Enter)", func(): replay.running = false)
	_buttons["play"] = _button(tr, "▶ Play", "Play forwards", replay.play_forward)
	_button(tr, "+10 s", "Ten seconds forward", func(): replay.jump(10.0))
	_button(tr, "⏭", "To the end (End)", func(): replay.jump(1e9))
	_label(tr, "  Speed")
	for s in Replay.SPEEDS:
		_speed_buttons.append(_button(tr, "%s×" % str(s), "Playback speed %s×" % str(s), func(): replay.speed = s))
	_label(tr, "  Frame")
	for a in VideoPrefs.ASPECT_NAMES:
		_aspect_buttons.append(_button(tr, a, "The aspect of the picture: the orange outline shows what a video takes of it (%s)" % a, func():
			VideoPrefs.set_aspect(a)
			_frame.queue_redraw()))
	# the cameras
	var cams := _row(box)
	_label(cams, "Camera")
	for c in [["follow", "Follow", "The camera that follows the car"], ["cockpit", "Cockpit", "In the car"], ["bonnet", "Bonnet", "On the bonnet"],
			["free", "Free", "A camera that you move yourself: press Move camera, then W A S D or the arrows, Z and X up and down, the mouse to look, " +
				"[ and ] zoom, 5 and 6 the smoothing of the look; Escape stops it"],
			["cinematic", "Cinematic", "The cameras of the track: the one nearest to the car, which turns to follow it"]]:
		_cam_buttons[c[0]] = _button(cams, c[1], c[2], func(): replay.set_camera(c[0]))
	_cam_buttons["cinematic"].visible = not replay.cinema_cameras().is_empty()
	_buttons["car"] = _button(cams, "Car", "The car that the camera follows (Tab)", replay.next_car)
	_buttons["car"].visible = replay.cars.size() > 1
	_cine_row = _row(box)
	_cine_label = _label(_cine_row, "")
	_cine_slider = _slider_of(_cine_row, 0.2, 3.0, 0.01, replay.cine_scale, func(v: float): replay.cine_scale = v)
	_cine_slider.tooltip_text = "Zoom the cinematic camera: below 1 in, above 1 out ([ and ] too)"
	_lead_label = _label(_cine_row, "")
	_lead_slider = _slider_of(_cine_row, 0.0, 40.0, 1.0, replay.cine_lead, func(v: float): replay.cine_lead = v)
	_lead_slider.tooltip_text = "Where the cinematic camera looks: at the car (0), or this many metres in front of it"
	_free_row = _row(box)
	_free_speed_label = _label(_free_row, "")
	_free_speed = _slider_of(_free_row, 0.0, 1.0, 0.002, log(replay.free.speed / 0.01) / log(300.0), func(v: float): replay.free.set_speed(0.01 * pow(300.0, v)))
	_free_speed.tooltip_text = "How fast the free camera moves, looks and zooms (0.01 to 3)"
	_look_label = _label(_free_row, "")
	_look_label.tooltip_text = "The smoothing of the mouse look: 5 smoother, 6 sharper"
	_buttons["move"] = _button(_free_row, "Move camera",
		"The keys and the mouse move the camera, until you press Escape. Otherwise the arrows and Space are for the timeline",
		func(): replay.free.start_moving())
	_buttons["aim"] = _button(_free_row, "Aim at the car (F)", "The camera keeps looking at the car", func(): replay.free.toggle_aim())
	_buttons["parent"] = _button(_free_row, "Fixed to the car (L)", "The camera goes with the car, from where it is now (its place and its turn)",
		func(): replay.free.toggle_parent())
	_buttons["sky"] = _button(_free_row, "Fixed, sky up (K)", "The camera goes with the car but does not turn with it: it keeps the sky up",
		func(): replay.free.toggle_sky())
	var hint := _label(_free_row, "Move camera: WASD/arrows move · Space up · Alt down · Q E tilt · mouse looks · [ ] zoom · Esc stops")
	hint.modulate.a = 0.55
	hint.add_theme_font_size_override("font_size", 12)


func _row(parent: Control) -> HBoxContainer:
	var r := HBoxContainer.new()
	r.add_theme_constant_override("separation", 6)
	parent.add_child(r)
	return r


func _label(parent: Control, text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.modulate.a = 0.75
	parent.add_child(l)
	return l


func _button(parent: Control, text: String, tip: String, action: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.tooltip_text = tip
	b.focus_mode = Control.FOCUS_NONE
	b.custom_minimum_size.y = 32
	b.pressed.connect(action)
	parent.add_child(b)
	return b


func _slider_of(parent: Control, lo: float, hi: float, step: float, value: float, changed: Callable) -> HSlider:
	var s := HSlider.new()
	s.min_value = lo
	s.max_value = hi
	s.step = step
	s.value = value
	s.custom_minimum_size = Vector2(160, 24)
	s.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	s.focus_mode = Control.FOCUS_NONE
	s.value_changed.connect(changed)
	parent.add_child(s)
	return s


func _on(b: Button, on: bool) -> void:
	if on:
		b.add_theme_color_override("font_color", Color.WHITE)
		var sb := StyleBoxFlat.new()
		sb.bg_color = ORANGE
		sb.set_corner_radius_all(6)
		sb.set_content_margin_all(6)
		b.add_theme_stylebox_override("normal", sb)
	else:
		b.remove_theme_color_override("font_color")
		b.remove_theme_stylebox_override("normal")


func _process(delta: float) -> void:
	if replay == null or not replay.playing or replay.free == null:
		return
	var r := replay
	_slider.min_value = r.start_time()
	_slider.max_value = maxf(r.start_time() + 0.001, r.end_time())
	if not _sliding:
		_slider.set_value_no_signal(r.time)
	_marks.queue_redraw()
	_frame.queue_redraw()
	var state := ("   %s %s×" % ["◀" if r.direction < 0.0 else "▶", str(r.speed)]) if r.running else "   paused"
	_time_label.text = "%s / %s%s" % [_fmt(r.time), _fmt(r.end_time()), state]
	_note_for -= delta
	if _note_for <= 0.0 and r.filming == null:
		_note.text = ""
		_show_file.visible = false
	elif r.filming != null:
		_note.text = "Recording %d %%   (Esc stops)" % roundi(r.filming.call("progress") * 100.0)
	_on(_buttons["rewind"], r.running and r.direction < 0.0)
	_on(_buttons["play"], r.running and r.direction > 0.0)
	_on(_buttons["pause"], not r.running)
	for i in _speed_buttons.size():
		_on(_speed_buttons[i], is_equal_approx(Replay.SPEEDS[i], r.speed))
	for i in _aspect_buttons.size():
		_on(_aspect_buttons[i], VideoPrefs.ASPECT_NAMES[i] == VideoPrefs.aspect())
	var cam := r.camera_name()
	for k in _cam_buttons:
		_on(_cam_buttons[k], k == cam)
	_buttons["video"].text = "■ Stop (recording)" if r.filming != null else "● Video"
	_panel.modulate.a = 0.4 if r.filming != null else 1.0
	if r.cars.size() > 1:
		_buttons["car"].text = "Car: " + str(r.cars[r.target].config.get("name", r.cars[r.target].car_id)).left(24)
	_cine_row.visible = r.cine_on
	_cine_label.text = "Field of view ×%.2f" % r.cine_scale
	_cine_slider.set_value_no_signal(r.cine_scale)
	_lead_label.text = "Look ahead %d m" % roundi(r.cine_lead)
	_free_row.visible = r.free.active
	if r.free.active:
		var fs: float = r.free.speed
		_free_speed_label.text = "Speed %s×" % ("%.2f" % fs if fs < 0.1 else "%.1f" % fs)
		_look_label.text = "Look " + ("direct" if r.free.look_rate >= 60.0 else str(roundi(r.free.look_rate)))
		_on(_buttons["move"], r.free.moving)
		_on(_buttons["aim"], r.free.aim)
		_on(_buttons["parent"], r.free.parent and not r.free.sky)
		_on(_buttons["sky"], r.free.parent and r.free.sky)
	var f := r.fragment()
	var any := r.mark_in >= 0.0 or r.mark_out >= 0.0
	_frag_clear.visible = any
	var ftext := "no marks: the whole replay"
	if any:
		ftext = "%s – %s (%.1f s)" % [_fmt(f[0]), _fmt(f[1]), f[1] - f[0]] if not f.is_empty() else "the fragment is too short"
	_frag_text.text = ftext
	if not r.info.is_empty():
		_info.text = "%d km/h   %s   %.1f ×1000 rpm   gas %d%%   brake %d%%" % [roundi(r.info["speed"] * 3.6), r.info["gear"], r.info["rpm"] / 1000.0,
			roundi(r.info["throttle"] * 100.0), roundi(r.info["brake"] * 100.0)]


static func _fmt(s: float) -> String:
	s = maxf(0.0, s)
	var m := int(s / 60.0)
	return "%d:%04.1f" % [m, s - m * 60.0]


func say(text: String, file := "") -> void:
	_note.text = text
	_note_for = 6.0
	_last_file = file
	_show_file.visible = file != ""


func toggle_hidden() -> void:
	_hidden = not _hidden
	_panel.visible = not _hidden
	_info.get_parent().visible = not _hidden


func _draw_frame() -> void:
	if replay == null or replay.editor != null or _hidden:
		return
	var rect := VideoPrefs.frame_rect(_frame.size)
	_frame.draw_rect(rect, ORANGE, false, 2.0)
	_frame.draw_string(ThemeDB.fallback_font, rect.position + Vector2(8, 18), VideoPrefs.aspect(), HORIZONTAL_ALIGNMENT_LEFT, -1, 12, ORANGE)


func _draw_marks() -> void:
	var r := replay
	var a := r.start_time()
	var b := maxf(a + 0.001, r.end_time())
	var w := _marks.size.x - 16.0
	var x := func(t: float) -> float: return 8.0 + w * clampf((t - a) / (b - a), 0.0, 1.0)
	var any := r.mark_in >= 0.0 or r.mark_out >= 0.0
	var f := r.fragment()
	if any and not f.is_empty():
		_marks.draw_rect(Rect2(x.call(f[0]), 9, x.call(f[1]) - x.call(f[0]), 10), BAND)
	for m in [r.mark_in, r.mark_out]:
		if m >= 0.0:
			_marks.draw_rect(Rect2(x.call(m) - 1.5, 1, 3, 26), Color.WHITE)


func _save() -> void:
	var p := replay.save()
	_buttons["save"].text = "Saved in Replays" if p != "" else "Could not save"
	if p != "":
		say("Saved: " + p.get_file(), ProjectSettings.globalize_path(p))


## The picture as it is now, without the bar, as a PNG in the Pictures folder (OpenRacer).
func photo() -> void:
	visible = false
	await RenderingServer.frame_post_draw
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	visible = true
	var path := VideoPrefs.photos_dir().path_join("openracer-%s-%s.png" % [_track_id(), Time.get_datetime_string_from_system().replace(":", "")])
	if img.save_png(path) == OK:
		say("Photo saved: " + path.get_file(), path)
		RunLog.event("photo: " + path)


func _track_id() -> String:
	return str(replay.cars[0].get_meta("track_id", "track")) if not replay.cars.is_empty() else "track"


func _toggle_video() -> void:
	if replay.filming != null:
		replay.filming.call("stop")
		return
	film(replay.start_time(), replay.end_time(), 1.0, "openracer-%s-%s" % [_track_id(), VideoPrefs.stamp()])


## Films a part of the replay (ReplayFilm); done(path) after.
func film(t0: float, t1: float, spd: float, stem: String, done := Callable()) -> bool:
	var f := ReplayFilm.new()
	if not f.begin(replay, t0, t1, spd, stem):
		say("The video could not be started: " + f.writer.error)
		return false
	replay.filming = f
	replay.running = false
	f.finished.connect(func(path: String):
		replay.filming = null
		if path != "":
			say("Video saved: " + path.get_file(), path)
		else:
			say("No video: " + f.writer.error)
		if done.is_valid():
			done.call(path))
	replay.add_child(f)
	return true


func _save_fragment() -> void:
	var f := replay.fragment()
	if f.is_empty():
		_buttons["fragment"].text = "Mark a longer part"
		get_tree().create_timer(2.5, true, false, true).timeout.connect(func(): _buttons["fragment"].text = "Save fragment")
		return
	if _dialog != null or replay.filming != null:
		return
	var text := ("%s to %s (%.1f s). A replay file can be opened again in Replays and in the video editor; the video is played and filmed " +
		"at %s× (the playback speed that is chosen), with the camera as it is set now.") % [
		_fmt(f[0]), _fmt(f[1]), f[1] - f[0], str(replay.speed)]
	_dialog = ask(self, "Save the fragment", text, [["Cancel", Callable()], ["Replay file", func():
		var data := replay.pack(roundi(f[0] * Replay.RATE), roundi(f[1] * Replay.RATE) + 1)
		var p := ReplayFiles.write(data, "fragment")
		say("Fragment saved: " + p.get_file() if p != "" else "The fragment could not be saved.", ProjectSettings.globalize_path(p) if p != "" else "")],
		["MP4 video", func(): film(f[0], f[1], replay.speed, "openracer-%s-fragment-%s" % [_track_id(), VideoPrefs.stamp()])]])
	_dialog.tree_exited.connect(func(): _dialog = null)


func dialog_open() -> bool:
	return _dialog != null


func close_dialog() -> void:
	if _dialog != null:
		_dialog.queue_free()
		_dialog = null


func _open_editor() -> void:
	if replay.editor != null or replay.filming != null:
		return
	var ed := VideoEditor.new()
	ed.setup(replay)
	replay.add_child(ed)


## A small window: a title, a text and buttons ([label, Callable]; every button closes it, the first is Cancel and
## Escape works it). Gives the window.
static func ask(host: Node, title: String, text: String, buttons: Array) -> Control:
	var shade := _Shade.new()
	shade.color = Color(0, 0, 0, 0.6)
	shade.set_anchors_preset(Control.PRESET_FULL_RECT)
	shade.process_mode = Node.PROCESS_MODE_ALWAYS
	var centre := CenterContainer.new()
	centre.set_anchors_preset(Control.PRESET_FULL_RECT)
	shade.add_child(centre)
	var panel := PanelContainer.new()
	panel.custom_minimum_size.x = 460
	centre.add_child(panel)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 12)
	panel.add_child(box)
	var t := Label.new()
	t.text = title
	t.add_theme_font_size_override("font_size", 20)
	box.add_child(t)
	var p := Label.new()
	p.text = text
	p.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	p.custom_minimum_size.x = 440
	p.modulate.a = 0.8
	box.add_child(p)
	shade.body = box
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_END
	row.add_theme_constant_override("separation", 8)
	box.add_child(row)
	for item in buttons:
		var b := Button.new()
		b.text = item[0]
		b.custom_minimum_size = Vector2(90, 36)
		var act: Callable = item[1]
		b.pressed.connect(func():
			shade.queue_free()
			if act.is_valid():
				act.call())
		row.add_child(b)
	if not buttons.is_empty():
		var first: Callable = buttons[0][1]
		shade.on_escape = func():
			shade.queue_free()
			if first.is_valid():
				first.call()
	host.add_child(shade)
	if row.get_child_count() > 0:
		(row.get_child(row.get_child_count() - 1) as Button).grab_focus.call_deferred()
	return shade


class _Shade:
	extends ColorRect
	var on_escape: Callable
	var body: VBoxContainer

	func _input(event: InputEvent) -> void:
		if event is InputEventKey and event.pressed and event.physical_keycode == KEY_ESCAPE:
			get_viewport().set_input_as_handled()
			if on_escape.is_valid():
				on_escape.call()
			else:
				queue_free()
