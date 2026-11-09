extends Node
## (a scene, for the autoloads) The replay, the video editor, a take and the free cameras (Replay.js, VideoEditor.js,
## Take.js, FreeCam.js, CameraTrack.js). Always give temporary folders, so nothing goes into the player's data:
##   Godot --headless --fixed-fps 60 --path godot res://tools/test_replay.tscn -- --ai --replay-dir=/tmp/x/replays
##     --video-cfg=/tmp/x/video.cfg --video-dir=/tmp/x/videos [--car=openracer-muscle] [--track=kartbaan-oldenzaal]
##     [--browser=<a .openracer-replay file>] [--video=1] [--editor=1] [--take=1] [--shot=<folder for pictures>]
## The AI drives for 12 s, then: the free camera of the game (C four times, W moves it and does not drive the car);
## the replay opens, plays 2 s from 5 s back, the free camera is fixed to the car and aimed at it, the cinematic
## camera, the marks and the fragment (saved and read back), a bake at half speed, a camera track; with --video a
## fragment is filmed (needs a window); with --editor the video editor makes clips, a ramp, a zoom and saves an
## edit, a replay and (with a window) an mp4; with --take a take is kept as a replay. Then the game goes on. With
## --browser a replay of the browser is read and checked. --shot saves pictures of the replay, the bar and the editor.

var world: World
var _time := 0.0
var _step := 0
var _left_at := Vector3.ZERO
var _fails := 0
var _shots := ""
var _wait := 0.0


func _ready() -> void:
	for need in ["replay-dir", "video-cfg", "video-dir"]:
		if Content.arg(need) == "":
			push_error("test_replay: give --%s=<a temporary place> (nothing of a test goes into the player's data)" % need)
			get_tree().quit(2)
			return
	_shots = Content.arg("shot")
	if _shots != "":
		DirAccess.make_dir_recursive_absolute(_shots)
	if Content.arg("browser") != "":
		_browser(Content.arg("browser"))
	if Content.arg("watch") != "":
		_watch(Content.arg("watch"))
		return
	world = World.new()
	add_child(world)
	var car_id := Content.arg("car") if Content.arg("car") != "" else "openracer-muscle"
	var track_id := Content.arg("track") if Content.arg("track") != "" else "kartbaan-oldenzaal"
	world.setup(car_id, track_id, {})
	process_mode = Node.PROCESS_MODE_ALWAYS


func _check(ok: bool, what: String) -> void:
	print(("ok    " if ok else "FAIL  ") + what)
	if not ok:
		_fails += 1


func _shot(name: String) -> void:
	if _shots == "" or DisplayServer.get_name() == "headless":
		return
	await RenderingServer.frame_post_draw
	var path := _shots.path_join(name + ".png")
	get_viewport().get_texture().get_image().save_png(path)
	print("shot: ", path)


func _key(code: Key, down: bool) -> void:
	var e := InputEventKey.new()
	e.physical_keycode = code
	e.keycode = code
	e.pressed = down
	Input.parse_input_event(e)


## A viewer of a file (the main menu, Replays: Watch, or Edit with --edit-file=1), as main.gd starts it.
func _watch(path: String) -> void:
	var h := ReplayFiles.read_head(path)
	_check(not h.is_empty(), "the head of %s: %s, %s" % [path.get_file(), h.get("track", "?"), h.get("cars", [])])
	world = World.new()
	world.setup(str(h["cars"][0]), str(h["track"]), {"mode": "replay", "file": path, "edit": Content.arg("edit-file") != ""})
	add_child(world)
	process_mode = Node.PROCESS_MODE_ALWAYS
	_step = 50


func _process(dt: float) -> void:
	if _step == 50 or _step == 51:          # (the viewer of a file; step 100 is the game's free camera)
		_time += dt
		if _step == 50 and _time > 3.0:
			var r := world.replay
			_check(r != null and r.playing and r.viewer, "the viewer plays the file (%.1f s, at %.1f s)" % [r.duration(), r.time])
			if Content.arg("edit-file") != "":
				_check(r.editor != null, "Edit opens the video editor")
			_shot("viewer")
			_step = 51
			_time = 0.0
		elif _step == 51 and _time > 0.5:
			print("%d failures" % _fails)
			get_tree().quit(1 if _fails > 0 else 0)
		return
	_time += dt
	_wait -= dt
	if _wait > 0.0:
		return
	var r := world.replay
	match _step:
		0:
			if _time > 6.0:
				_free_game_camera()
				_step = 1
				_time = 0.0
		1:
			if _time > 1.0:
				var moved := world.free_cam.global_position.distance_to(_left_at)
				_check(moved > 1.0, "the free camera of the game moves with W (%.1f m in 1 s)" % moved)
				_check(not Input.is_action_pressed("throttle"), "W does not drive the car while the free camera is on")
				_key(KEY_W, false)
				_shot("game_free_camera")
				_step = 100
		100:
			if _time > 1.3:
				world.set_free_camera(false)
				_check(world.camera.current and world.camera.mode == ChaseCamera.Mode.FOLLOW, "C after the free camera: the follow camera again")
				var ev := InputEventKey.new()
				ev.physical_keycode = KEY_W
				_check(InputMap.action_has_event("throttle", ev), "W drives again after the free camera")
				_step = 2
				_time = 0.0
		2:
			if _time > 6.0:
				_open_replay()
				_step = 3
				_time = 0.0
		3:
			if _time > 2.0:
				_in_replay()
				_step = 4
				_time = 0.0
				_wait = 0.5
		4:
			_cinema()
			_step = 41
			_wait = 0.5
		41:
			_cinema_and_marks()
			_step = 5
			_wait = 0.5
		5:
			_shot("replay_bar")
			if Content.arg("video") != "" and DisplayServer.get_name() != "headless":
				var f := r.fragment()
				r.bar.film(f[0], f[0] + 2.0, 1.0, "test-fragment", func(path: String):
					_check(FileAccess.file_exists(path), "the fragment filmed as a video: " + path)
					_probe(path, 2.0)
					_step = 7)
				_step = 6
			else:
				_step = 7
		6:
			pass                      # (the video is being made)
		7:
			if Content.arg("editor") != "":
				_editor()
				_step = 8
				_wait = 1.0
			else:
				_step = 10
		8:
			_editor_more()
			_step = 9 if Content.arg("video") != "" and DisplayServer.get_name() != "headless" else 10
		9:
			pass                      # (the editor films its program)
		10:
			if r.editor != null:
				r.editor._close()
			r.exit()
			print("back in the game: the car %.2f m from where it was left, paused %s" % [world.car.global_position.distance_to(_left_at), get_tree().paused])
			_check(world.car.global_position.distance_to(_left_at) < 0.05 and not get_tree().paused, "back in the game where it was left")
			_step = 11
			_time = 0.0
		11:
			if _time > 2.0:
				_check(world.car.global_position.distance_to(_left_at) > 1.0, "the car drives on (%.1f km/h)" % (world.car.speed * 3.6))
				if Content.arg("take") != "":
					_take()
					_step = 12
					_time = 0.0
				else:
					_step = 13
		12:
			if _time > 8.0 and world.take.taking:
				var t := world.take
				var a: int = t._from
				var b := r.sample_now()
				t._end(true)
				var last_cam: Dictionary = t._cam[-1] if not t._cam.is_empty() else {"xf": Transform3D()}
				var cam_d := (last_cam["xf"] as Transform3D).origin.distance_to(world.car.global_position)
				_check(t._cam.size() > 60 and cam_d < 20.0, "the take kept the camera: %d samples, the last %.1f m from the car" % [t._cam.size(), cam_d])
				_check(absf((b - a) / 30.0 - 3.0) < 0.3 and world.hud.visible, "the take ran %.1f s, the HUD is back" % ((b - a) / 30.0))
				var before := ReplayFiles.list_files().size()
				t._keep(r, "test take", a, b)
				_check(ReplayFiles.list_files().size() == before + 1, "the take kept as a replay")
				if Content.arg("video") != "" and DisplayServer.get_name() != "headless":
					t.kind = "video"
					t._keep(r, "test take video", a + 30, b)
					_check(r.playing and r.filming != null, "the take filmed from the replay with its camera")
					r.filming.finished.connect(func(path: String):
						_probe(path, (b - a - 30) / 30.0)
						_step = 13)
					_step = 14
					_time = 0.0
				else:
					_step = 13
		14:
			if _time > 1.0 and not has_meta("probed"):
				set_meta("probed", true)
				var cam := get_viewport().get_camera_3d()
				print("  during the film: camera %s, %.1f m from the car" % [cam.name, cam.global_position.distance_to(world.car.global_position)])
		13:
			print("%d failures" % _fails)
			get_tree().quit(1 if _fails > 0 else 0)


func _free_game_camera() -> void:
	world.camera.mode = ChaseCamera.Mode.FOLLOW
	for k in 2:
		world._unhandled_input(_action("camera"))
	_check(world.camera.mode == ChaseCamera.Mode.BONNET, "C twice from the follow camera: the bonnet camera")
	world._unhandled_input(_action("camera"))
	_check(world.free_cam != null and world.free_cam.active and world.free_cam.current, "C again: the free camera of the game")
	_left_at = world.free_cam.global_position
	_key(KEY_W, true)


func _action(a: String) -> InputEventAction:
	var e := InputEventAction.new()
	e.action = a
	e.pressed = true
	return e


func _open_replay() -> void:
	var r := world.replay
	_left_at = world.car.global_position
	world.pause()
	world._start_replay()
	_check(r.playing and r.duration() > 10.0, "replay: %.1f s recorded, %d cars" % [r.duration(), r.cars.size()])
	_check(r.time == r.start_time() and not r.running, "a replay of the game begins at the start, paused")
	r.time = r.end_time() - 5.0
	r.play_forward()


func _in_replay() -> void:
	var r := world.replay
	_check(absf(r.time - (r.end_time() - 3.0)) < 0.3, "2 s of play from 5 s back: %.2f s before the end" % (r.end_time() - r.time))
	_check(not r.info.is_empty() and r.info["speed"] > 1.0, "the info of the replay: %d km/h, %s" % [roundi(r.info.get("speed", 0) * 3.6), r.info.get("gear", "")])
	_check(world.audio.process_mode == Node.PROCESS_MODE_ALWAYS, "the sound plays with the replay")
	r.running = false
	r._process(0.0)
	_check(world.audio.process_mode == Node.PROCESS_MODE_INHERIT, "no sound while it is paused")
	r.set_camera("free")
	_check(r.free.active and r.free.current and r.free.parent, "the free camera of the replay, fixed to the car")
	r.free.toggle_aim()
	for i in 30:
		r.free.update(1.0 / 30.0)
	var to := (world.car.global_position + Vector3.UP * 0.7 - r.free.global_position).normalized()
	_check((-r.free.global_transform.basis.z).dot(to) > 0.98, "aimed at the car")
	var before := world.car.global_transform.affine_inverse() * r.free.global_position
	r.time -= 1.0
	r._show(r.time)
	r.free.update(0.0)
	var after := world.car.global_transform.affine_inverse() * r.free.global_position
	_check(before.distance_to(after) < 0.05, "fixed to the car: it goes with it (%.2f m)" % before.distance_to(after))
	r.free.set_speed(0.05)
	_check(is_equal_approx(VideoPrefs.get_value("replay", "free_speed", 0.0), 0.05), "the speed of the free camera is remembered")
	_shot("replay_free_camera")


## The cinematic camera (the cameras of the track editor, track.json "cameras"): on for half a second, its picture taken.
func _cinema() -> void:
	var r := world.replay
	if not r.cinema_cameras().is_empty():
		r.set_camera("cinematic")
		r.update_cine(0.1)
		_check(r.cine_on and r._cine_cam.current, "the cinematic camera of the track (%d cameras)" % r.cinema_cameras().size())
		_shot("replay_cinematic")


func _cinema_and_marks() -> void:
	var r := world.replay
	r.set_camera("follow")
	_check(world.camera.current and r.camera_name() == "follow", "back to the follow camera")
	r.time = r.end_time() - 8.0
	r.set_mark("in")
	r.time = r.end_time() - 4.0
	r.set_mark("out")
	var f := r.fragment()
	_check(not f.is_empty() and absf(f[1] - f[0] - 4.0) < 0.05, "a fragment of 4 s between the marks")
	var p := ReplayFiles.write(r.pack(roundi(f[0] * Replay.RATE), roundi(f[1] * Replay.RATE) + 1), "fragment")
	var back := ReplayFiles.read(p)
	_check(not back.is_empty() and int(back["count"]) == 121, "the fragment saved and read back: %s samples" % back.get("count", "?"))
	var i0 := roundi(f[0] * Replay.RATE) - r.first_index
	var per := r.cars.size() * Replay.STRIDE
	_check(not back.is_empty() and back["samples"][0] == r.samples[i0 * per], "the fragment starts at Mark in")
	# a wheel that came off before the fragment and one that comes off in it: the records of the soft body go with the fragment
	var a0 := roundi(f[0] * Replay.RATE)
	var off := [true, 0.0, 0.0, Vector3.ZERO, Transform3D.IDENTITY]
	var on := [false, 0.0, 0.0, Vector3.ZERO, Transform3D.IDENTITY]
	var was_entries: Array = r.soft.entries
	r.soft.entries = [{"nodes": 1, "names": [], "records": [
		{"s": a0 - r.first_index - 20, "disp": PackedVector3Array(), "parts": [], "wheels": [off, on, on, on]},
		{"s": a0 - r.first_index + 30, "disp": PackedVector3Array(), "parts": [], "wheels": [off, off, on, on]},
		{"s": a0 - r.first_index + 9000, "disp": PackedVector3Array(), "parts": [], "wheels": [off, off, off, on]}]}]
	var p2 := ReplayFiles.write(r.pack(a0, roundi(f[1] * Replay.RATE) + 1), "fragment-soft")
	r.soft.entries = was_entries
	var back2 := ReplayFiles.read(p2)
	var kept: Array = back2.get("soft")[0]["records"] if back2.get("soft") is Array and not (back2["soft"] as Array).is_empty() else []
	_check(kept.size() == 2 and int(kept[0]["s"]) == 0 and bool(kept[0]["wheels"][0][0]) and not bool(kept[0]["wheels"][1][0]), "a wheel off before the fragment is off at its start")
	_check(kept.size() == 2 and int(kept[1]["s"]) == 30 and bool(kept[1]["wheels"][1][0]), "a wheel that comes off in the fragment comes off there")
	DirAccess.remove_absolute(p2)
	# the video editor keeps the same: a film of moments takes the records at the samples they fall on
	var baked_soft: Array = ReplaySoft.new([]).baked([]) if false else []
	var was2: Array = r.soft.entries
	r.soft.entries = [{"nodes": 1, "names": [], "records": [{"s": 0, "disp": PackedVector3Array(), "parts": [], "wheels": [on, on, on, on]},
		{"s": 40, "disp": PackedVector3Array(), "parts": [], "wheels": [off, on, on, on]}]}]
	baked_soft = r.soft.baked([10.0, 20.0, 30.0, 45.0, 50.0])
	r.soft.entries = was2
	var film: Array = baked_soft[0]["records"]
	_check(film.size() == 2 and int(film[0]["s"]) == 0 and int(film[1]["s"]) == 3 and bool(film[1]["wheels"][0][0]), "a film made in the video editor has the wheel off where it comes off")
	var times: Array = []
	for k in 60:
		times.append(f[0] + k * 0.5 / 30.0)
	var baked := r.bake(times, {"camera": [{"t": 0.0, "pos": [0, 5, -8], "yaw": 0.0, "pitch": -0.3, "fov": 50, "parent": true}]})
	_check(int(baked["count"]) == 60 and (baked["samples"] as PackedFloat32Array).size() == 60 * per, "a bake at half speed: 60 samples for 1 s")
	var cam := Camera3D.new()
	add_child(cam)
	CameraTrack.apply(CameraTrack.clean(baked["camera"]), 0.5, cam, r.car_body)
	var want: Vector3 = world.car.global_transform * Vector3(0, 5, -8)
	_check(cam.global_position.distance_to(want) < 0.01, "the camera track: a key fixed to the car")
	cam.queue_free()
	var saved := r.save()
	_check(saved != "" and r.save() == saved, "Save replay (a second save is the same file)")
	var head := ReplayFiles.read_head(saved)
	_check(not head.is_empty() and absf(head["seconds"] - r.duration()) < 0.05, "its head: %s, %.1f s" % [head.get("track", "?"), head.get("seconds", 0.0)])
	# the effects (ReplayFx): the weather every second, the skid marks as strips; a jump makes them as they were
	var atmos: Array = r.fx.rows.get("atmos", [])
	_check(atmos.size() >= 10, "the weather and the ground in the replay: %d rows" % atmos.size())
	var skid: Array = r.fx.rows.get("skid/0", [])
	print("skid marks: %d strips, smoke: %d rows, marbles: %d, debris: %d" % [skid.size(), r.fx.rows.get("smoke/0", []).size(),
		r.fx.rows.get("marbles", []).size(), r.fx.rows.get("debris/0", []).size()])
	var mid := r.start_time() + r.duration() * 0.5
	r.seek(mid)
	r.fx.call("_build", "skid/0", mid)
	var shown := 0
	for st: Array in world.effects.get("_strips"):
		shown += st.size()
	var want_strips := ReplayFx._first_after(skid, mid)
	_check(shown == mini(want_strips, TyreEffects.CHUNK * TyreEffects.CHUNKS), "the marks at %.1f s: %d strips (%d made by then)" % [mid, shown, want_strips])
	var file_fx: Dictionary = ReplayFiles.read(saved).get("fx", {})
	_check(file_fx.has("atmos"), "the effects are in the file (%s)" % ", ".join(file_fx.keys()))


func _probe(path: String, seconds: float) -> void:
	var out: Array = []
	OS.execute("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_name,width,height", "-of", "default=nw=1", path], out)
	var text := str(out[0]) if not out.is_empty() else ""
	print(text.strip_edges().replace("\n", ", "))
	var dur := 0.0
	for line in text.split("\n"):
		if line.begins_with("duration="):
			dur = float(line.get_slice("=", 1))
	_check(absf(dur - seconds) < 0.25, "the video lasts %.2f s (%.2f wanted), %s" % [dur, seconds, "with sound" if text.contains("aac") else "no sound"])


func _editor() -> void:
	var r := world.replay
	r.bar._open_editor()
	var ed: VideoEditor = r.editor
	_check(ed != null and r.editor == ed, "the video editor opens over the replay")
	ed.src_t = r.end_time() - 10.0
	ed._set_in()
	ed.src_t = r.end_time() - 6.0
	ed._set_out()
	ed.insert_part(true)
	ed.src_t = r.end_time() - 4.0
	ed._set_in()
	ed.src_t = r.end_time() - 2.0
	ed._set_out()
	ed.insert_part(true)
	_check(ed.clips.size() == 2 and absf(ed.total() - 6.0) < 0.01, "two clips: %.2f s" % ed.total())
	ed.head_t = 1.0
	ed.split_clip(0, 1.0)
	_check(ed.clips.size() == 3 and absf(ed.total() - 6.0) < 0.01, "split at 1 s: three clips")
	ed.selected = 1
	ed.head_t = 2.0
	ed.add_key("speed")
	var k: Dictionary = ed.clips[1]["keys"][ed.sel_keys["speed"]]
	k["speed"] = 0.25
	ed.prepare(ed.clips[1])
	_check(ed.total() > 7.0, "a ramp to 0.25x makes it longer: %.2f s" % ed.total())
	ed.clips[2]["zoom"] = 2.0
	ed.clips[2]["cam"] = "cockpit"
	var m := ed.map_final(ed.total() - 0.5)
	_check(m["index"] == 2, "the program at the end is the last clip")
	ed.set("head_t", 0.5)
	ed.final_playing = true


func _editor_more() -> void:
	var r := world.replay
	var ed: VideoEditor = r.editor
	_check(ed.head_t > 0.6, "the program plays (%.2f s)" % ed.head_t)
	ed.final_playing = false
	_shot("video_editor")
	ed.save_project()
	var data := ReplayFiles.read(r.file_path)
	_check(data.get("project") is Dictionary and (data["project"]["clips"] as Array).size() == 3 and data.get("edit") is Dictionary,
		"Save: the project and the edit kept with the replay")
	if data.get("edit") is Dictionary:
		var e: Dictionary = data["edit"]
		var secs := (int(e["count"]) - 1) / 30.0
		_check(absf(secs - ed.total()) < 0.05 and e.has("cams") and e.has("zoom"), "the edit: %.2f s, its cameras and zoom" % secs)
	var parts := ed._bake_parts()
	var p := ReplayFiles.write(r.bake(parts["times"], parts["extra"]), "test edit")
	_check(ReplayFiles.read_head(p).get("name", "") == "test edit", "Save as replay: a named replay")
	var again := VideoEditor.new()
	again.replay = r
	again.from_project(data["project"])
	_check(again.clips.size() == 3 and absf(again.total() - ed.total()) < 0.01, "the project opens again as it was")
	again.free()
	if _step == 8 and Content.arg("video") != "" and DisplayServer.get_name() != "headless":
		var f := ReplayFilm.new()
		f.source_viewport = ed._prog_vp
		f.program = func(i: int): ed.head_t = minf(ed.total(), i / 30.0)
		var length := minf(3.0, ed.total())
		_check(f.begin(r, 0.0, length, 1.0, "test-editor"), "the editor films its program")
		ed._film = f
		f.finished.connect(func(path: String):
			ed._film = null
			_check(FileAccess.file_exists(path), "the program as a video: " + path)
			_probe(path, length)
			_step = 10)
		ed.add_child(f)


func _take() -> void:
	var t := world.take
	t.kind = "replay"
	t._begin(world.replay, "16:9", "replay", true)
	_check(t.counting and not world.hud.visible, "a take: the count, without the HUD")
	await get_tree().create_timer(1.0).timeout
	_shot("take_count")


func _browser(path: String) -> void:
	var data := ReplayFiles.read(path)
	_check(not data.is_empty(), "a browser replay is read: %s" % path.get_file())
	if data.is_empty():
		return
	var s: PackedFloat32Array = data["samples"]
	print("  track %s, cars %s, %d samples, first place (%.2f %.2f %.2f), gear %d, rpm %.0f" % [data["track"], data["cars"], data["count"],
		s[0], s[1], s[2], int(s[Replay.P_GEAR]), s[Replay.P_OMEGA] * 60.0 / TAU])
	_check(ReplayFiles.missing_content(ReplayFiles.read_head(path)) == "", "this game has its track and cars")
	var car := Car.new()
	var cfg: Variant = Content.load_json("cars/%s/car.json" % data["cars"][0])
	car.setup(str(data["cars"][0]), cfg if cfg is Dictionary else {})
	var before := Vector3(s[0], s[1], s[2])
	ReplayFiles.fit_browser(data, [car])
	var s2: PackedFloat32Array = data["samples"]
	print("  the body put where the wheels were: moved %.2f m" % before.distance_to(Vector3(s2[0], s2[1], s2[2])))
	car.free()
