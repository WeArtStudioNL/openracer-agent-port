# gdlint: disable=max-public-methods
class_name VideoEditor
extends CanvasLayer
## The video editor (web/js/VideoEditor.js; "Video editor" in the bar of a replay, or Edit in Replays). One replay
## is the source; what is made of it is a list of clips on a timeline, and a camera track:
##
##   Source (left):  the source replay seen from behind the car, a scrubber, play (Shift+Enter), an In and an Out
##                   marker (I and O). "Insert at playhead" puts the part between them in the timeline where the
##                   playhead is (a clip that is there is cut in two), "Add to end" after the last clip.
##   Program (right): the result, played from the timeline (Enter, Home, End, the arrows a frame, Shift a second),
##                   in the aspect that is chosen (16:9 1280x720, 9:16 720x1280, 1:1 960x960).
##   Clips:          trimmed with the handles at their edges; a speed (0.05 to 8) with keys for a ramp, a zoom (0.5
##                   to 4: the field of view of its camera divided by it) with keys, the camera of the clip (the
##                   camera track, the free camera as a fixed shot, follow, cockpit, cinematic with a look ahead and
##                   its keys); split, move, delete (Delete). The inspector under the timeline has them.
##   Camera track:   the free camera of the replay (Free camera: W A S D, the arrows, Space/Alt, Q E tilt, click the
##                   picture to look, [ ] zoom; Parent to car L, Point at car F); Key here (K) puts a key at the
##                   playhead; between keys the camera moves smoothly (CameraTrack). Without keys: the game camera.
##   Save:           with the replay (its file keeps the project and the edit as it plays: Watch plays the edit,
##                   Edit goes on); Save as replay (a new file with the cuts, the speeds and the camera); Save as
##                   mp4 (the program from the start to the end, with the sound, ReplayFilm).
##
## The two monitors are SubViewports that share the world of the game; the source is rendered on every other frame
## (the cars are put at the time of the source for it, and back after it is drawn).

signal closed

const DT := 1.0 / 30.0
const STEP := 1.0 / 60.0
const MIN_SPEED := 0.05
const MAX_SPEED := 8.0
const MIN_ZOOM := 0.5
const MAX_ZOOM := 4.0
const KEY_FIELDS := {"speed": ["keys", "speed"], "zoom": ["zoomKeys", "zoom"], "lead": ["leadKeys", "lead"]}

var replay: Replay
var standalone := false             # opened from Replays: Close goes back to the main menu
var clips: Array = []
var camera_keys: Array = []
var head_t := 0.0                        # the playhead (s of the program)
var src_t := 0.0
var src_in := -1.0
var src_out := -1.0
var selected := -1
var selected_cam := -1
var sel_keys := {"speed": -1, "zoom": -1, "lead": -1}
var final_playing := false
var src_playing := false
var dirty := false
var scale_px := 40.0
var zoomed := false
var _film: ReplayFilm = null
var _ui := {}
var _src_vp: SubViewport
var _prog_vp: SubViewport
var _src_cam: Camera3D
var _prog_cam: Camera3D
var _timeline: VideoTimeline
var _src_turn := false
var _say_for := 0.0
var _late: Node
var _dialog: Control = null


func setup(r: Replay) -> void:
	replay = r
	name = "VideoEditor"
	layer = 14
	process_mode = Node.PROCESS_MODE_ALWAYS
	process_priority = -15


func _ready() -> void:
	replay.editor = self
	replay.running = false
	if replay.bar != null:
		replay.bar.visible = false
	src_t = replay.start_time()
	_build()
	_apply_aspect()
	if not replay.is_edit and replay.header.get("project") is Dictionary:
		from_project(replay.header["project"])
	elif not replay.header.get("camera", []).is_empty():
		camera_keys = CameraTrack.clean(replay.header["camera"])
	_late = _Late.new()
	_late.ed = self
	add_child(_late)
	get_tree().root.disable_3d = true
	_fit()
	render_inspector()
	RunLog.event("video editor open: %.1f s of source" % replay.duration())


static func fmt(s: float) -> String:
	s = maxf(0.0, s)
	var m := int(s / 60.0)
	return "%d:%05.2f" % [m, s - m * 60.0]


# ---- the clips: a part of the source, and a speed that may change along it

## A value that is keyed along a clip (the speed of the ramp, the zoom, the look ahead) at an offset in the source.
func keyed_value(clip: Dictionary, kind: String, offset: float) -> float:
	var keys: Array = clip.get(KEY_FIELDS[kind][0], [])
	var field: String = KEY_FIELDS[kind][1]
	if keys.is_empty():
		return float(clip.get(field, 1.0 if kind != "lead" else 0.0))
	if offset <= keys[0]["at"]:
		return keys[0][field]
	for i in range(1, keys.size()):
		if offset <= keys[i]["at"]:
			var a: Dictionary = keys[i - 1]
			var b: Dictionary = keys[i]
			var f: float = (offset - a["at"]) / maxf(1e-6, b["at"] - a["at"])
			if a.get("easeOut", false) and b.get("easeIn", false):
				f = f * f * (3.0 - 2.0 * f)
			elif a.get("easeOut", false):
				f = f * f
			elif b.get("easeIn", false):
				f = 1.0 - (1.0 - f) * (1.0 - f)
			return lerpf(a[field], b[field], f)
	return keys[keys.size() - 1][field]


## The table of a clip: the time in the program at every step of the source (the integral of 1 / speed).
func prepare(clip: Dictionary) -> void:
	for kind in KEY_FIELDS:
		(clip[KEY_FIELDS[kind][0]] as Array).sort_custom(func(a, b): return a["at"] < b["at"])
	var length: float = clip["out"] - clip["in"]
	var n := maxi(1, ceili(length / STEP))
	var acc := PackedFloat64Array()
	acc.resize(n + 1)
	for i in n:
		var a := i * STEP
		var b := minf(length, (i + 1) * STEP)
		acc[i + 1] = acc[i] + (b - a) / clampf(keyed_value(clip, "speed", (a + b) / 2.0), MIN_SPEED, MAX_SPEED)
	clip["acc"] = acc
	clip["duration"] = acc[n]


func new_clip(a: float, b: float, spd := 1.0, keys := [], cam := "track") -> Dictionary:
	var clip := {"in": a, "out": b, "speed": spd, "keys": keys, "cam": cam, "zoom": 1.0, "zoomKeys": [], "lead": 0.0, "leadKeys": [], "freeKey": null}
	prepare(clip)
	return clip


## The source offset (s from the start of the clip) at a time in the clip.
func offset_at(clip: Dictionary, f: float) -> float:
	var acc: PackedFloat64Array = clip["acc"]
	var n := acc.size() - 1
	if f <= 0.0:
		return 0.0
	if f >= acc[n]:
		return clip["out"] - clip["in"]
	var lo := 0
	var hi := n
	while hi - lo > 1:
		var mid := (lo + hi) >> 1
		if acc[mid] <= f:
			lo = mid
		else:
			hi = mid
	var part := (f - acc[lo]) / maxf(1e-9, acc[hi] - acc[lo])
	return minf(clip["out"] - clip["in"], (lo + part) * STEP)


## The time in the clip at a source offset.
func time_at_offset(clip: Dictionary, offset: float) -> float:
	var acc: PackedFloat64Array = clip["acc"]
	var n := acc.size() - 1
	var position := clampf(offset, 0.0, clip["out"] - clip["in"]) / STEP
	var i := mini(n - 1, floori(position))
	return acc[i] + (acc[i + 1] - acc[i]) * (position - i)


func starts() -> Array:
	var out: Array = []
	var at := 0.0
	for c in clips:
		out.append(at)
		at += c["duration"]
	return out


func total() -> float:
	var at := 0.0
	for c in clips:
		at += c["duration"]
	return at


## What the timeline shows at a time: { index, clip, src, local }, or {} when it is empty.
func map_final(t: float) -> Dictionary:
	var at := 0.0
	for i in clips.size():
		var clip: Dictionary = clips[i]
		if t < at + clip["duration"] or i == clips.size() - 1:
			var f := clampf(t - at, 0.0, clip["duration"])
			return {"index": i, "clip": clip, "src": clip["in"] + offset_at(clip, f), "local": f}
		at += clip["duration"]
	return {}


# ---- the operations

func touch() -> void:
	dirty = true
	if not zoomed and _ui.has("scroller"):
		var width := maxf(200.0, (_ui["scroller"] as Control).size.x - 24.0)
		var t := total()
		if t * scale_px > width or t * scale_px < width * 0.4:
			scale_px = clampf(width / maxf(1.0, t + 1.0), 4.0, 600.0)
	_refresh_timeline()
	render_inspector()


## The part between the markers into the timeline: at the playhead (a clip that it is in is cut) or at the end.
func insert_part(at_end: bool) -> void:
	if src_in < 0.0 or src_out < 0.0 or src_out - src_in < 0.1:
		say("Set an In and an Out marker in the source first (I and O), at least 0.1 s apart.")
		return
	var part := new_clip(src_in, src_out)
	var index := clips.size()
	if not at_end and not clips.is_empty():
		var at := 0.0
		for i in clips.size():
			var d: float = clips[i]["duration"]
			if head_t <= at + 0.02:
				index = i
				break
			if head_t < at + d - 0.02:
				split_clip(i, head_t - at)
				index = i + 1
				break
			at += d
	clips.insert(index, part)
	select_clip(index, false)
	head_t = starts()[index]
	touch()


## A clip in two at a time in the clip (the keys go with their part; both get a key at the cut).
func split_clip(index: int, f: float) -> bool:
	var clip: Dictionary = clips[index]
	if f <= 0.02 or f >= clip["duration"] - 0.02:
		return false
	var offset := offset_at(clip, f)
	var a := new_clip(clip["in"], clip["in"] + offset, clip["speed"], [], clip["cam"])
	var b := new_clip(clip["in"] + offset, clip["out"], clip["speed"], [], clip["cam"])
	for kind in KEY_FIELDS:
		var list: String = KEY_FIELDS[kind][0]
		var field: String = KEY_FIELDS[kind][1]
		var here := keyed_value(clip, kind, offset)
		var ka: Array = []
		var kb: Array = []
		for k in clip[list]:
			var c: Dictionary = k.duplicate()
			if k["at"] < offset:
				ka.append(c)
			else:
				c["at"] = k["at"] - offset
				kb.append(c)
		if not (clip[list] as Array).is_empty():
			ka.append({"at": offset, field: here})
			kb.push_front({"at": 0.0, field: here})
		a[list] = ka
		b[list] = kb
		a[field] = clip[field]
		b[field] = clip[field]
	if clip.get("freeKey") is Dictionary:
		a["freeKey"] = clip["freeKey"].duplicate(true)
		b["freeKey"] = clip["freeKey"].duplicate(true)
	prepare(a)
	prepare(b)
	clips.remove_at(index)
	clips.insert(index, b)
	clips.insert(index, a)
	return true


func delete_clip(index: int) -> void:
	if index < 0 or index >= clips.size():
		return
	clips.remove_at(index)
	selected = mini(selected, clips.size() - 1)
	_clear_keys()
	head_t = minf(head_t, total())
	touch()


func move_clip(index: int, by: int) -> void:
	var to := index + by
	if index < 0 or to < 0 or to >= clips.size():
		return
	var c: Dictionary = clips[index]
	clips.remove_at(index)
	clips.insert(to, c)
	selected = to
	touch()


func select_clip(i: int, render := true) -> void:
	selected = i
	_clear_keys()
	if render:
		_refresh_timeline()
		render_inspector()


func select_key(clip: int, kind: String, index: int) -> void:
	selected = clip
	_clear_keys()
	sel_keys[kind] = index
	_refresh_timeline()
	render_inspector()


func selected_key(kind: String) -> int:
	return sel_keys[kind]


func _clear_keys() -> void:
	for k in sel_keys:
		sel_keys[k] = -1


## A key of a kind at the playhead (inside the selected clip); the first makes a key at both ends.
func add_key(kind: String) -> void:
	var clip: Dictionary = clips[selected]
	var f: float = head_t - starts()[selected]
	if f < 0.0 or f > clip["duration"]:
		say("Put the playhead inside this clip first.")
		return
	var list: String = KEY_FIELDS[kind][0]
	var field: String = KEY_FIELDS[kind][1]
	var offset := offset_at(clip, f)
	var now := keyed_value(clip, kind, offset)
	var keys: Array = clip[list]
	if keys.is_empty():
		keys.append({"at": 0.0, field: clip[field]})
		keys.append({"at": clip["out"] - clip["in"], field: clip[field]})
	var near := -1
	for i in keys.size():
		if absf(keys[i]["at"] - offset) < 0.02:
			near = i
	if near < 0:
		var k := {"at": offset, field: snappedf(now, 0.01)}
		keys.append(k)
		prepare(clip)
		near = keys.find(k)
	_clear_keys()
	sel_keys[kind] = near
	touch()


## Back to one value of a kind (the value at the start of the clip).
func remove_keys(kind: String) -> void:
	var clip: Dictionary = clips[selected]
	clip[KEY_FIELDS[kind][1]] = snappedf(keyed_value(clip, kind, 0.0), 0.01)
	clip[KEY_FIELDS[kind][0]] = []
	prepare(clip)
	touch()


func delete_key(kind: String) -> void:
	var clip: Dictionary = clips[selected]
	var keys: Array = clip[KEY_FIELDS[kind][0]]
	keys.remove_at(sel_keys[kind])
	sel_keys[kind] = -1
	if keys.size() < 2:
		if not keys.is_empty():
			clip[KEY_FIELDS[kind][1]] = keys[0][KEY_FIELDS[kind][1]]
		clip[KEY_FIELDS[kind][0]] = []
	prepare(clip)
	touch()


func scrub_to(t: float) -> void:
	if recording():
		return
	head_t = clampf(t, 0.0, total())
	final_playing = false
	selected_cam = -1


func recording() -> bool:
	return _film != null


func say(text: String) -> void:
	if _ui.has("message"):
		_ui["message"].text = text
		_say_for = 5.0


# ---- the camera track

func toggle_free() -> void:
	if replay.free.active:
		replay.set_camera("follow")
		return
	replay.set_camera("free")
	final_playing = false


## The fixed shot of a clip: the free camera as it is now (it is left afterwards: the clips show their cameras).
func take_free(clip: Dictionary) -> void:
	if not replay.free.active:
		replay.set_camera("free")
		final_playing = false
	clip["freeKey"] = CameraTrack.from_free(replay.free, 0.0)
	replay.set_camera("follow")
	say("The shot of clip %d is the camera as it was%s. Go to shot puts the free camera back on it." % [clips.find(clip) + 1,
		" (it goes with the car)" if clip["freeKey"]["parent"] else ""])


func key_here() -> void:
	if not replay.free.active:
		replay.set_camera("free")
		final_playing = false
	var key := CameraTrack.from_free(replay.free, snappedf(head_t, 0.001))
	var same := -1
	for i in camera_keys.size():
		if absf(float(camera_keys[i]["t"]) - key["t"]) < 0.05:
			same = i
	if same >= 0:
		camera_keys[same] = key
	else:
		camera_keys.append(key)
	camera_keys.sort_custom(func(a, b): return a["t"] < b["t"])
	selected_cam = camera_keys.find(key)
	say("Camera key at " + fmt(key["t"]))
	touch()


func delete_cam_key() -> void:
	if selected_cam < 0 or selected_cam >= camera_keys.size():
		say("Select a camera key first (click it in the camera lane).")
		return
	camera_keys.remove_at(selected_cam)
	selected_cam = -1
	touch()


func go_to_cam_key(i: int) -> void:
	selected_cam = i
	head_t = float(camera_keys[i]["t"])
	final_playing = false
	_refresh_timeline()


## The free camera starts from a key: it can be moved and Key here replaces it.
func edit_key(i: int) -> void:
	go_to_cam_key(i)
	if not replay.free.active:
		replay.set_camera("free")
	CameraTrack.to_free(replay.free, camera_keys[i])


# ---- the project and saving

func to_project() -> Dictionary:
	var out: Array = []
	for c in clips:
		out.append({"in": c["in"], "out": c["out"], "speed": c["speed"], "keys": c["keys"], "cam": c["cam"], "lead": c["lead"], "leadKeys": c["leadKeys"],
			"zoom": c["zoom"], "zoomKeys": c["zoomKeys"], "freeKey": c["freeKey"]})
	return {"version": 1, "clips": out, "camera": CameraTrack.clean(camera_keys), "aspect": VideoPrefs.aspect()}


func from_project(p: Dictionary) -> bool:
	if not (p.get("clips") is Array):
		return false
	var a := replay.start_time()
	var b := replay.end_time()
	clips.clear()
	for c in p["clips"]:
		if not (c is Dictionary) or float(c.get("out", 0)) <= float(c.get("in", 0)):
			continue
		var keys: Array = []
		for k in c.get("keys", []):
			keys.append(_key_of(k, "speed", MIN_SPEED, MAX_SPEED))
		var spd := clampf(float(c.get("speed", 1.0)), MIN_SPEED, MAX_SPEED)
		var clip := new_clip(clampf(float(c["in"]), a, b), clampf(float(c["out"]), a, b), spd, keys, str(c.get("cam", "track")))
		clip["lead"] = clampf(float(c.get("lead", 0.0)), 0.0, 40.0)
		clip["zoom"] = clampf(float(c.get("zoom", 1.0)), MIN_ZOOM, MAX_ZOOM)
		for k in c.get("leadKeys", []):
			clip["leadKeys"].append(_key_of(k, "lead", 0.0, 40.0))
		for k in c.get("zoomKeys", []):
			clip["zoomKeys"].append(_key_of(k, "zoom", MIN_ZOOM, MAX_ZOOM))
		if c.get("freeKey") is Dictionary:
			var fk := CameraTrack.clean([c["freeKey"]])
			clip["freeKey"] = fk[0] if not fk.is_empty() else null
		prepare(clip)
		clips.append(clip)
	camera_keys = CameraTrack.clean(p.get("camera", []))
	if VideoPrefs.ASPECTS.has(str(p.get("aspect", ""))):
		VideoPrefs.set_aspect(str(p["aspect"]))
	selected = 0 if not clips.is_empty() else -1
	head_t = 0.0
	return true


static func _key_of(k: Dictionary, field: String, lo: float, hi: float) -> Dictionary:
	return {"at": float(k.get("at", 0.0)), field: clampf(float(k.get(field, lo)), lo, hi), "easeIn": bool(k.get("easeIn", false)), "easeOut": bool(k.get("easeOut", false))}


## The times of the samples of the edit, their zoom and the cameras of the clips.
func _bake_parts() -> Dictionary:
	var n := floori(total() / DT) + 1
	var times: Array = []
	var zooms: Array = []
	var any_zoom := false
	var runs: Array = []
	var any_cam := false
	for i in n:
		var m := map_final(minf(total(), i * DT))
		times.append(m["src"])
		var clip: Dictionary = m["clip"]
		var off: float = m["src"] - clip["in"]
		var z := snappedf(keyed_value(clip, "zoom", off), 0.001)
		zooms.append(z)
		any_zoom = any_zoom or z != 1.0
		var mode: String = clip["cam"] if clip["cam"] != "free" else "track"
		var lead := snappedf(keyed_value(clip, "lead", off), 0.1) if mode == "cinematic" else 0.0
		if runs.is_empty() or runs[-1][1] != mode or runs[-1][2] != lead:
			runs.append([i, mode, lead])
		any_cam = any_cam or mode != "track"
	var extra := {"camera": CameraTrack.clean(_baked_camera())}
	if any_zoom:
		extra["zoom"] = zooms
	if any_cam:
		extra["cams"] = runs
	return {"times": times, "extra": extra}


## The camera track for a file: the keys of the track, and for every clip with a fixed shot a key at its start (a
## cut) and at its end; where the track goes on after such a clip, a key with the track as it is there (a cut).
func _baked_camera() -> Array:
	var keys: Array = camera_keys.duplicate(true)
	var at := 0.0
	var eps := 0.001
	var probe := Camera3D.new()
	add_child(probe)
	for clip in clips:
		var t0 := at
		var t1: float = at + clip["duration"]
		at = t1
		if clip["cam"] != "free" or not (clip.get("freeKey") is Dictionary):
			continue
		keys = keys.filter(func(k): return k["t"] < t0 - eps or k["t"] > t1 + eps)
		var s: Dictionary = clip["freeKey"].duplicate(true)
		s["t"] = snappedf(t0, 0.001)
		s["cut"] = true
		var e: Dictionary = clip["freeKey"].duplicate(true)
		e["t"] = snappedf(maxf(t0, t1 - eps), 0.001)
		e["cut"] = false
		keys.append(s)
		keys.append(e)
		if camera_keys.any(func(k): return k["t"] > t1):
			CameraTrack.apply(camera_keys, t1, probe, replay.car_body)
			var eu := probe.global_transform.basis.get_euler()
			keys.append({"t": snappedf(t1 + eps, 0.001), "pos": [probe.global_position.x, probe.global_position.y, probe.global_position.z], "yaw": eu.y,
				"pitch": eu.x, "roll": eu.z, "fov": probe.fov, "parent": false, "sky": false, "aim": false, "target": 0, "cut": true})
	probe.queue_free()
	keys.sort_custom(func(a, b): return a["t"] < b["t"])
	return keys


## Save: the project and the edit as it plays, with the replay (its file; a replay of the game is saved first).
func save_project() -> void:
	if clips.is_empty():
		say("The timeline is empty: put a part of the source in it first.")
		return
	if replay.is_edit or not replay.file_path.ends_with("." + ReplayFiles.EXT):
		replay.file_path = ""
		replay.saved_count = -1
		replay.is_edit = false
		replay.header = {}
	var path := replay.save()
	var parts := _bake_parts()
	var edit := replay.bake(parts["times"], parts["extra"])
	var project := to_project()
	if path != "" and ReplayFiles.update(path, {"project": project, "edit": edit}):
		replay.header["project"] = project
		replay.header["edit"] = edit
		dirty = false
		say("Saved with the replay: Watch plays this edit, Edit goes on from here.")
	else:
		say("The edit could not be saved.")


func save_replay() -> void:
	if clips.is_empty():
		say("The timeline is empty: put a part of the source in it first.")
		return
	_ask_name("Save as replay", "The name in the list of Replays (main menu).", "My edit", "Save", func(n: String):
		var parts := _bake_parts()
		var extra: Dictionary = parts["extra"]
		extra["name"] = n
		var path := ReplayFiles.write(replay.bake(parts["times"], extra), n)
		if path != "":
			dirty = false
			say("Saved as \"%s\" in Replays." % n)
		else:
			say("The replay could not be saved."))


## Save as mp4: the program from the start to the end, filmed in its aspect, with the sound.
func save_video() -> void:
	if clips.is_empty():
		say("The timeline is empty: put a part of the source in it first.")
		return
	_ask_name("Save as mp4", "The name of the video. The program is played from the start to the end and filmed, with the sound of the engine.",
		"My video", "Record", func(n: String):
			if replay.free.active:
				replay.set_camera("follow")
			var f := ReplayFilm.new()
			f.source_viewport = _prog_vp
			f.program = func(i: int): head_t = minf(total(), i * DT)
			if not f.begin(replay, 0.0, total(), 1.0, n):
				say("The video could not be started: " + f.writer.error)
				return
			_film = f
			head_t = 0.0
			final_playing = false
			replay.editor_playing = true
			f.finished.connect(func(path: String):
				_film = null
				replay.editor_playing = false
				say(("Saved " + path) if path != "" else "The video is empty.")
				if path != "":
					_ui["show_file"].visible = true
					_ui["show_file"].set_meta("path", path))
			add_child(f))


func _ask_name(title: String, text: String, value: String, ok: String, done: Callable) -> void:
	var line := LineEdit.new()
	line.text = value
	line.max_length = 60
	line.select_all_on_focus = true
	_dialog = ReplayBar.ask(self, title, text, [["Cancel", Callable()], [ok, func():
		var n := " ".join(line.text.split(" ", false)).strip_edges()
		if n != "":
			done.call(n)]])
	var box: VBoxContainer = _dialog.get("body")
	box.add_child(line)
	box.move_child(line, 2)
	line.grab_focus.call_deferred()
	line.text_submitted.connect(func(_t: String):
		var n := " ".join(line.text.split(" ", false)).strip_edges()
		if n != "":
			_dialog.queue_free()
			done.call(n))


func close() -> void:
	if dirty and not clips.is_empty():
		_dialog = ReplayBar.ask(self, "Leave the video editor?", "What you made is not saved (Save, Save as replay or Save as mp4).", [["Stay", Callable()], ["Leave", _close]])
		return
	_close()


func _close() -> void:
	if _film != null:
		_film.stop()
	get_tree().root.disable_3d = false
	replay.editor = null
	replay.editor_playing = false
	replay.cine_override = -1.0
	replay.set_camera("follow")
	if replay.bar != null:
		replay.bar.visible = true
	RunLog.event("video editor closed")
	closed.emit()
	queue_free()
	if standalone:
		replay.exit()


# ---- the frame

func _process(delta: float) -> void:
	if not replay.playing or replay.free == null:
		return
	delta = minf(0.1, delta)
	var length := total()
	if _film == null:
		if final_playing:
			head_t += delta
			if head_t >= length:
				head_t = length
				final_playing = false
		if src_playing:
			src_t += delta
			var stop := src_out if src_out >= 0.0 and src_in >= 0.0 else replay.end_time()
			if src_t >= stop or src_t >= replay.end_time():
				src_t = minf(stop, replay.end_time())
				src_playing = false
	var m := map_final(head_t)
	replay.time = m["src"] if not m.is_empty() else src_t
	replay.editor_playing = _film != null or final_playing or src_playing
	replay.free.keys_on = not (get_viewport().gui_get_focus_owner() is LineEdit)
	var cam: String = m["clip"]["cam"] if not m.is_empty() else "track"
	replay.set_clip_camera(cam, keyed_value(m["clip"], "lead", m["src"] - m["clip"]["in"]) if not m.is_empty() else -1.0)
	_src_turn = not _src_turn and _film == null
	_update_ui(m)
	_say_for -= delta
	if _say_for <= 0.0 and _ui.has("message"):
		_ui["message"].text = ""


## (late in the frame, after every camera has moved) The program camera: the camera of the replay, or the camera
## track, or the fixed shot of the clip, with the zoom of the clip. Every other frame the source monitor instead.
func late_frame() -> void:
	if not replay.playing or replay.free == null:
		return
	var m := map_final(head_t)
	var cam := replay.get_viewport().get_camera_3d()
	if cam != null:
		_prog_cam.global_transform = cam.global_transform
		_prog_cam.fov = cam.fov
		_prog_cam.environment = cam.environment
		_prog_cam.attributes = cam.attributes
	var clip_cam: String = m["clip"]["cam"] if not m.is_empty() else "track"
	if not replay.free.active:
		if clip_cam == "track" and not camera_keys.is_empty():
			CameraTrack.apply(camera_keys, head_t, _prog_cam, replay.car_body)
		elif clip_cam == "free" and m["clip"].get("freeKey") is Dictionary:
			CameraTrack.apply([m["clip"]["freeKey"]], 0.0, _prog_cam, replay.car_body)
	if not m.is_empty():
		_prog_cam.fov = clampf(_prog_cam.fov / clampf(keyed_value(m["clip"], "zoom", m["src"] - m["clip"]["in"]), MIN_ZOOM, MAX_ZOOM), 2.0, 150.0)
	_prog_cam.near = 0.03
	if _film != null:
		return
	if _src_turn:
		_source_pass()
	else:
		_prog_vp.render_target_update_mode = SubViewport.UPDATE_ONCE


## The source at its time, from behind the car (drawn this frame; the cars go back to the program after it).
func _source_pass() -> void:
	replay._show(src_t)
	var body := replay.car_body(0)
	if body != null:
		var back := -body.global_transform.basis.z
		back.y = 0.0
		back = back.normalized() if back.length() > 1e-3 else Vector3.BACK
		var at := body.global_position + Vector3.UP * 0.8
		var p := body.global_position + back * 6.5 + Vector3.UP * 2.3
		_src_cam.global_transform = Transform3D(Basis.looking_at(at - p, Vector3.UP), p)
		_src_cam.fov = 50.0
	_src_vp.render_target_update_mode = SubViewport.UPDATE_ONCE
	await RenderingServer.frame_post_draw
	if is_instance_valid(replay) and replay.playing:
		replay._show(replay.time)


func _apply_aspect() -> void:
	var a: Dictionary = VideoPrefs.ASPECTS[VideoPrefs.aspect()]
	_prog_vp.size = Vector2i(a["width"], a["height"])
	var r: float = a["ratio"]
	_src_vp.size = Vector2i(640, roundi(640 / r)) if r >= 1.0 else Vector2i(roundi(640 * r), 640)
	for b in _ui.get("aspects", []):
		_on(b, b.text == VideoPrefs.aspect())


func _fit() -> void:
	var width := maxf(200.0, (_ui["scroller"] as Control).size.x - 24.0) if (_ui["scroller"] as Control).size.x > 0 else 1200.0
	scale_px = clampf(width / maxf(1.0, total() + 1.0), 4.0, 600.0)
	_refresh_timeline()


func _refresh_timeline() -> void:
	if _timeline == null:
		return
	var sc := _ui["scroller"] as ScrollContainer
	_timeline.custom_minimum_size = Vector2(maxf(sc.size.x, (total() + 4.0) * scale_px), 130)
	_timeline.queue_redraw()


func _unhandled_key_input(event: InputEvent) -> void:
	if recording() or _dialog != null and is_instance_valid(_dialog) or not event.pressed:
		return
	if get_viewport().gui_get_focus_owner() is LineEdit:
		return
	var free := replay.free.active
	var handled := true
	var code: Key = event.physical_keycode
	match code:
		KEY_ENTER, KEY_KP_ENTER:
			if event.shift_pressed:
				_toggle_src()
			else:
				_toggle_final()
		KEY_I:
			_set_in()
		KEY_O:
			_set_out()
		KEY_HOME:
			head_t = 0.0
			final_playing = false
		KEY_END:
			head_t = total()
			final_playing = false
		KEY_LEFT, KEY_RIGHT:
			if free:
				handled = false
			else:
				head_t = clampf(head_t + (1.0 if event.shift_pressed else DT) * (-1.0 if code == KEY_LEFT else 1.0), 0.0, total())
				final_playing = false
		KEY_DELETE, KEY_BACKSPACE:
			if selected_cam >= 0:
				delete_cam_key()
			elif selected >= 0:
				delete_clip(selected)
		KEY_K:
			if free:
				key_here()
		KEY_F:
			if free and not event.echo:
				replay.free.toggle_aim()
		KEY_L:
			if free and not event.echo:
				replay.free.toggle_parent()
		KEY_TAB:
			replay.next_car()
		KEY_ESCAPE:
			if Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
				Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
		_:
			handled = false
	if handled:
		get_viewport().set_input_as_handled()
		_refresh_timeline()


func _set_in() -> void:
	src_in = src_t
	if src_out >= 0.0 and src_out <= src_in:
		src_out = -1.0


func _set_out() -> void:
	src_out = src_t
	if src_in >= 0.0 and src_in >= src_out:
		src_in = -1.0


func _toggle_src() -> void:
	src_playing = not src_playing
	if src_playing and src_t >= replay.end_time() - 0.02:
		src_t = src_in if src_in >= 0.0 else replay.start_time()


func _toggle_final() -> void:
	if recording():
		return
	final_playing = not final_playing
	if final_playing and head_t >= total() - 0.02:
		head_t = 0.0


func _on(b: Button, on: bool) -> void:
	if on:
		var sb := StyleBoxFlat.new()
		sb.bg_color = Color("ff5a1f")
		sb.set_corner_radius_all(6)
		sb.set_content_margin_all(5)
		b.add_theme_stylebox_override("normal", sb)
	else:
		b.remove_theme_stylebox_override("normal")


# ---- the page

func _btn(parent: Control, text: String, tip: String, action: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.tooltip_text = tip
	b.focus_mode = Control.FOCUS_NONE
	b.pressed.connect(action)
	parent.add_child(b)
	return b


func _lbl(parent: Control, text: String, dim := true) -> Label:
	var l := Label.new()
	l.text = text
	if dim:
		l.modulate.a = 0.65
	parent.add_child(l)
	return l


func _hrow(parent: Control) -> HBoxContainer:
	var r := HBoxContainer.new()
	r.add_theme_constant_override("separation", 6)
	parent.add_child(r)
	return r


## (a row that wraps when the monitor is narrow)
func _frow(parent: Control) -> HFlowContainer:
	var r := HFlowContainer.new()
	r.add_theme_constant_override("h_separation", 6)
	r.add_theme_constant_override("v_separation", 4)
	parent.add_child(r)
	return r


func _viewport(cam_name: String) -> SubViewport:
	var vp := SubViewport.new()
	vp.world_3d = replay.get_viewport().find_world_3d()
	var root := replay.get_viewport()
	vp.msaa_3d = root.msaa_3d
	vp.screen_space_aa = root.screen_space_aa
	vp.render_target_update_mode = SubViewport.UPDATE_DISABLED
	add_child(vp)
	var cam := Camera3D.new()
	cam.name = cam_name
	cam.far = 4000.0
	cam.near = 0.03
	cam.current = true
	vp.add_child(cam)
	return vp


func _monitor(parent: Control, vp: SubViewport) -> TextureRect:
	var screen := PanelContainer.new()
	screen.size_flags_vertical = Control.SIZE_EXPAND_FILL
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color("07090b")
	sb.border_color = Color("2b333d")
	sb.set_border_width_all(1)
	sb.set_corner_radius_all(8)
	screen.add_theme_stylebox_override("panel", sb)
	parent.add_child(screen)
	var tex := TextureRect.new()
	tex.texture = vp.get_texture()
	tex.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	tex.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	tex.size_flags_vertical = Control.SIZE_EXPAND_FILL
	screen.add_child(tex)
	return tex


func _build() -> void:
	_src_vp = _viewport("SourceCamera")
	_src_cam = _src_vp.get_child(0)
	_prog_vp = _viewport("ProgramCamera")
	_prog_cam = _prog_vp.get_child(0)
	var root := Panel.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	var bg := StyleBoxFlat.new()
	bg.bg_color = Color("0e1217")
	root.add_theme_stylebox_override("panel", bg)
	add_child(root)
	var page := VBoxContainer.new()
	page.set_anchors_preset(Control.PRESET_FULL_RECT)
	page.offset_left = 12
	page.offset_right = -12
	page.offset_top = 8
	page.offset_bottom = -8
	page.add_theme_constant_override("separation", 8)
	root.add_child(page)
	var top := _hrow(page)
	var title := _lbl(top, "VIDEO EDITOR", false)
	title.add_theme_font_size_override("font_size", 16)
	_ui["message"] = _lbl(top, "", false)
	_ui["message"].add_theme_color_override("font_color", Color("ff5a1f"))
	_ui["message"].size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_ui["message"].clip_text = true
	_ui["aspects"] = []
	for a in VideoPrefs.ASPECT_NAMES:
		_ui["aspects"].append(_btn(top, a, "The aspect of the picture, and of the video that is made of it (%s)" % a, func():
			if not recording():
				VideoPrefs.set_aspect(a)
				_apply_aspect()))
	_ui["show_file"] = _btn(top, "Show the video", "Show the video that was made in its folder", func():
		OS.shell_show_in_file_manager(str(_ui["show_file"].get_meta("path", ""))))
	_ui["show_file"].visible = false
	_ui["save_project"] = _btn(top, "Save", "Keep the clips, their keys and the camera track with this replay in Replays: " +
		"Watch then plays the edit, Edit goes on from here", save_project)
	_ui["save"] = _btn(top, "Save as replay", "Cut, speeds and camera track as a new replay in Replays", save_replay)
	_ui["video"] = _btn(top, "Save as mp4", "The result recorded from the start to the end, as a video file", save_video)
	_ui["close"] = _btn(top, "Close", "Back to the replay" if not standalone else "Back to the main menu", close)
	var monitors := HBoxContainer.new()
	monitors.size_flags_vertical = Control.SIZE_EXPAND_FILL
	monitors.add_theme_constant_override("separation", 10)
	page.add_child(monitors)
	# the source
	var left := VBoxContainer.new()
	left.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	left.custom_minimum_size.x = 200
	monitors.add_child(left)
	var h: Dictionary = replay.header
	var names: Array = h.get("names", [])
	_lbl(left, "SOURCE" + (" · %s · %s" % [str(h.get("track_name", "")).left(40), ", ".join(names.slice(0, 3))] if not h.is_empty() else ""))
	_monitor(left, _src_vp)
	var sr := _hrow(left)
	_ui["src_play"] = _btn(sr, "▶", "Play the source (Shift + Enter)", _toggle_src)
	_btn(sr, "⏮", "To the start of the source", func(): src_t = replay.start_time())
	_ui["src_time"] = _lbl(sr, "", false)
	var scrub := Control.new()
	scrub.custom_minimum_size.y = 26
	left.add_child(scrub)
	_ui["src_slider"] = HSlider.new()
	_ui["src_slider"].set_anchors_preset(Control.PRESET_FULL_RECT)
	_ui["src_slider"].step = 0.0
	_ui["src_slider"].focus_mode = Control.FOCUS_NONE
	_ui["src_slider"].value_changed.connect(func(v: float):
		if not is_equal_approx(v, src_t):
			src_t = v
			src_playing = false)
	scrub.add_child(_ui["src_slider"])
	_ui["src_marks"] = Control.new()
	_ui["src_marks"].set_anchors_preset(Control.PRESET_FULL_RECT)
	_ui["src_marks"].mouse_filter = Control.MOUSE_FILTER_IGNORE
	_ui["src_marks"].draw.connect(_draw_src_marks)
	scrub.add_child(_ui["src_marks"])
	var mr := _frow(left)
	_btn(mr, "In (I)", "Put the In marker here", _set_in)
	_btn(mr, "Out (O)", "Put the Out marker here", _set_out)
	_btn(mr, "Clear", "Take the markers away", func():
		src_in = -1.0
		src_out = -1.0)
	_ui["mark_info"] = _lbl(mr, "")
	_ui["insert"] = _btn(mr, "Insert at playhead", "Put the part between the markers in the timeline where the playhead is (a clip there is cut in two)",
		func(): insert_part(false))
	_ui["append"] = _btn(mr, "Add to end", "Put the part between the markers after the last clip", func(): insert_part(true))
	# the program
	var right := VBoxContainer.new()
	right.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	right.custom_minimum_size.x = 200
	monitors.add_child(right)
	_lbl(right, "PROGRAM")
	var prog := _monitor(right, _prog_vp)
	prog.gui_input.connect(func(e: InputEvent):
		if replay.free.active and e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT and not replay.free.aim:
			Input.mouse_mode = Input.MOUSE_MODE_CAPTURED)
	_ui["empty"] = Label.new()
	_ui["empty"].text = "Empty. Set In and Out in the source, then Insert."
	_ui["empty"].horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_ui["empty"].vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_ui["empty"].set_anchors_preset(Control.PRESET_FULL_RECT)
	prog.add_child(_ui["empty"])
	var fr := _hrow(right)
	_ui["play"] = _btn(fr, "▶", "Play the result (Enter)", _toggle_final)
	_btn(fr, "⏮", "To the start (Home)", func():
		if not recording():
			head_t = 0.0
			final_playing = false)
	_ui["time"] = _lbl(fr, "", false)
	var cr := _frow(right)
	_lbl(cr, "Camera:")
	_ui["free"] = _btn(cr, "Free camera", "Fly the camera: WASD or the arrows, Space and Alt up and down, Q and E tilt, click the picture to look, " +
		"[ and ] zoom", toggle_free)
	_ui["parent"] = _btn(cr, "Parent to car", "The camera goes with the car, from where it is now (L)", func(): _free_do("toggle_parent"))
	_ui["sky"] = _btn(cr, "Parent, sky up", "The camera goes with the car's place but not with its turn", func(): _free_do("toggle_sky"))
	_ui["aim"] = _btn(cr, "Point at car", "The camera keeps looking at the car (F)", func(): _free_do("toggle_aim"))
	_ui["car"] = _btn(cr, "Car", "The next car (Tab)", replay.next_car)
	_ui["speed_label"] = _lbl(cr, "")
	var sp := HSlider.new()
	sp.min_value = 0.1
	sp.max_value = 3.0
	sp.step = 0.1
	sp.value = replay.free.speed
	sp.custom_minimum_size = Vector2(90, 20)
	sp.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	sp.focus_mode = Control.FOCUS_NONE
	sp.tooltip_text = "How fast the free camera moves, looks and zooms"
	sp.value_changed.connect(func(v: float): replay.free.set_speed(v))
	cr.add_child(sp)
	_ui["key"] = _btn(cr, "Key here", "Put a camera key at the playhead, with the camera as it is now (K)", key_here)
	_ui["del_key"] = _btn(cr, "Delete key", "Delete the selected camera key", delete_cam_key)
	_ui["clear_cam"] = _btn(cr, "Clear track", "Delete all camera keys", func():
		camera_keys.clear()
		selected_cam = -1
		touch())
	# the timeline
	var tools := _hrow(page)
	_lbl(tools, "TIMELINE")
	_btn(tools, "−", "Zoom out", func():
		zoomed = true
		scale_px = maxf(4.0, scale_px / 1.5)
		_refresh_timeline())
	_btn(tools, "+", "Zoom in", func():
		zoomed = true
		scale_px = minf(600.0, scale_px * 1.5)
		_refresh_timeline())
	_btn(tools, "Fit", "The whole timeline in view", func():
		zoomed = false
		_fit())
	_ui["total"] = _lbl(tools, "")
	var sc := ScrollContainer.new()
	sc.custom_minimum_size.y = 146
	sc.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	page.add_child(sc)
	_ui["scroller"] = sc
	_timeline = VideoTimeline.new()
	_timeline.ed = self
	_timeline.custom_minimum_size = Vector2(1200, 130)
	sc.add_child(_timeline)
	var insp := HFlowContainer.new()
	insp.custom_minimum_size.y = 44
	insp.add_theme_constant_override("h_separation", 8)
	page.add_child(insp)
	_ui["inspector"] = insp


func _free_do(what: String) -> void:
	if replay.free.active:
		replay.free.call(what)
	else:
		say("Turn on the free camera first.")


func _draw_src_marks() -> void:
	var c: Control = _ui["src_marks"]
	var a := replay.start_time()
	var span := maxf(0.001, replay.end_time() - a)
	var w := c.size.x - 16.0
	var x := func(t: float) -> float: return 8.0 + w * clampf((t - a) / span, 0.0, 1.0)
	if src_in >= 0.0 and src_out >= 0.0:
		c.draw_rect(Rect2(x.call(src_in), 9, x.call(src_out) - x.call(src_in), 8), Color(1.0, 0.35, 0.12, 0.45))
	for m in [src_in, src_out]:
		if m >= 0.0:
			c.draw_rect(Rect2(x.call(m) - 1, 3, 2, 20), Color("ffd04d"))


func _update_ui(m: Dictionary) -> void:
	var a := replay.start_time()
	var b := replay.end_time()
	var length := total()
	_ui["src_slider"].min_value = a
	_ui["src_slider"].max_value = maxf(a + 0.001, b)
	_ui["src_slider"].set_value_no_signal(src_t)
	_ui["src_marks"].queue_redraw()
	_ui["src_time"].text = "%s / %s" % [fmt(src_t - a), fmt(b - a)]
	_ui["src_play"].text = "❚❚" if src_playing else "▶"
	var info := "Markers: I and O"
	if src_in >= 0.0 and src_out >= 0.0:
		info = "In %s · Out %s · %.2f s" % [fmt(src_in - a), fmt(src_out - a), src_out - src_in]
	elif src_in >= 0.0:
		info = "In " + fmt(src_in - a)
	elif src_out >= 0.0:
		info = "Out " + fmt(src_out - a)
	_ui["mark_info"].text = info
	var ready := src_in >= 0.0 and src_out >= 0.0 and src_out - src_in >= 0.1 and not recording()
	_ui["insert"].disabled = not ready
	_ui["append"].disabled = not ready
	_ui["play"].text = "❚❚" if final_playing else "▶"
	var at_speed := ""
	if not m.is_empty():
		at_speed = "   ×%s" % str(snappedf(keyed_value(m["clip"], "speed", m["src"] - m["clip"]["in"]), 0.01))
	_ui["time"].text = "%s / %s%s" % [fmt(head_t), fmt(length), at_speed]
	var free := replay.free
	_on(_ui["free"], free.active)
	_on(_ui["parent"], free.active and free.parent and not free.sky)
	_on(_ui["sky"], free.active and free.parent and free.sky)
	_on(_ui["aim"], free.active and free.aim)
	_ui["car"].visible = replay.cars.size() > 1
	_ui["car"].text = "Car %d" % (replay.target + 1)
	_ui["speed_label"].text = "speed %.1f×" % free.speed
	_ui["del_key"].disabled = selected_cam < 0
	_ui["clear_cam"].disabled = camera_keys.is_empty()
	_ui["empty"].visible = clips.is_empty()
	_ui["video"].disabled = recording() or clips.is_empty()
	_ui["save"].disabled = recording() or clips.is_empty()
	_ui["video"].text = ("Recording %d %%" % roundi(_film.progress() * 100.0)) if recording() else "Save as mp4"
	_ui["close"].disabled = recording()
	for btn in _ui["aspects"]:
		btn.disabled = recording()
	_ui["total"].text = (" · %d clip%s, %s" % [clips.size(), "" if clips.size() == 1 else "s", fmt(length)]) if not clips.is_empty() else " · empty"
	var sc0 := _ui["scroller"] as ScrollContainer
	if not zoomed and sc0.size.x > 0.0:
		var want := clampf((sc0.size.x - 24.0) / maxf(1.0, length + 1.0), 4.0, 600.0)
		if absf(want - scale_px) > 0.01:
			scale_px = want
			_refresh_timeline()
	if _timeline.custom_minimum_size.x < sc0.size.x:
		_refresh_timeline()
	_timeline.queue_redraw()
	if final_playing or recording():
		var sc := _ui["scroller"] as ScrollContainer
		var x := head_t * scale_px
		if x > sc.scroll_horizontal + sc.size.x - 30.0 or x < sc.scroll_horizontal:
			sc.scroll_horizontal = int(maxf(0.0, x - 40.0))


func _spin(parent: Control, lo: float, hi: float, step: float, value: float, changed: Callable, width := 70.0) -> SpinBox:
	var s := SpinBox.new()
	s.min_value = lo
	s.max_value = hi
	s.step = step
	s.value = value
	s.custom_minimum_size.x = width
	s.value_changed.connect(changed)
	parent.add_child(s)
	return s


func _check(parent: Control, text: String, on: bool, changed: Callable) -> void:
	var c := CheckBox.new()
	c.text = text
	c.button_pressed = on
	c.focus_mode = Control.FOCUS_NONE
	c.toggled.connect(changed)
	parent.add_child(c)


## The inspector under the timeline: the clip that is selected (its camera, speed, zoom, keys, split, move,
## delete), or one key of it (its value and its ease).
func render_inspector() -> void:
	if not _ui.has("inspector"):
		return
	var box: HFlowContainer = _ui["inspector"]
	for c in box.get_children():
		c.queue_free()
	if selected < 0 or selected >= clips.size():
		_lbl(box, "Select a clip to change its speed, or to make a ramp with keys. A camera key: click it in the camera lane.")
		return
	var clip: Dictionary = clips[selected]
	for kind in ["lead", "zoom", "speed"]:
		var ki: int = sel_keys[kind]
		var keys: Array = clip[KEY_FIELDS[kind][0]]
		if ki < 0 or ki >= keys.size():
			continue
		var key: Dictionary = keys[ki]
		var field: String = KEY_FIELDS[kind][1]
		var what: String = {"speed": "Ramp key at %s · speed", "zoom": "Zoom key at %s · zoom ×", "lead": "Look-ahead key at %s · metres ahead of the car"}[kind]
		_lbl(box, what % fmt(clip["in"] + key["at"]))
		var lo: float = {"speed": MIN_SPEED, "zoom": MIN_ZOOM, "lead": 0.0}[kind]
		var hi: float = {"speed": MAX_SPEED, "zoom": MAX_ZOOM, "lead": 40.0}[kind]
		_spin(box, lo, hi, 1.0 if kind == "lead" else 0.05, key[field], func(v: float):
			key[field] = v
			prepare(clip)
			touch())
		_check(box, "ease in", key.get("easeIn", false), func(on: bool):
			key["easeIn"] = on
			prepare(clip)
			touch())
		_check(box, "ease out", key.get("easeOut", false), func(on: bool):
			key["easeOut"] = on
			prepare(clip)
			touch())
		_btn(box, "Delete key", "Delete this key", func(): delete_key(kind))
		_lbl(box, "Click the clip for the clip itself. Drag a key along for when, up and down for the value.")
		return
	_lbl(box, "Clip %d:  camera" % (selected + 1))
	var cam_sel := OptionButton.new()
	var cams := [["track", "Camera track"], ["free", "Free camera (a fixed shot)"], ["follow", "Follow"], ["cockpit", "Cockpit"], ["cinematic", "Cinematic"]]
	for i in cams.size():
		cam_sel.add_item(cams[i][1], i)
		if cams[i][0] == clip["cam"]:
			cam_sel.select(i)
	cam_sel.focus_mode = Control.FOCUS_NONE
	cam_sel.item_selected.connect(func(i: int):
		clip["cam"] = cams[i][0]
		if clip["cam"] == "free" and not (clip.get("freeKey") is Dictionary):
			take_free(clip)
		touch())
	box.add_child(cam_sel)
	if clip["cam"] == "free":
		_btn(box, "Take camera", "The shot of this clip is the free camera as it is now", func():
			take_free(clip)
			touch())
		_btn(box, "Go to shot", "Put the free camera where the shot of this clip is, to move it and take it again", func():
			if not (clip.get("freeKey") is Dictionary):
				say("This clip has no shot yet: Take camera.")
				return
			if not replay.free.active:
				replay.set_camera("free")
			CameraTrack.to_free(replay.free, clip["freeKey"])
			final_playing = false)
	if clip["cam"] == "cinematic":
		var lk: Array = clip["leadKeys"]
		_lbl(box, "look ahead from the keys" if not lk.is_empty() else "look ahead (m)")
		var ls := _spin(box, 0.0, 40.0, 1.0, clip["lead"], func(v: float):
			clip["lead"] = v
			touch(), 64.0)
		ls.editable = lk.is_empty()
		_btn(box, "Add look-ahead key at playhead", "A key of the look ahead at the playhead: it changes smoothly between the keys", func(): add_key("lead"))
		if not lk.is_empty():
			_btn(box, "Remove look-ahead keys", "Back to one look ahead", func(): remove_keys("lead"))
	var keys: Array = clip["keys"]
	_lbl(box, "speed from the ramp keys" if not keys.is_empty() else "speed")
	var s := _spin(box, MIN_SPEED, MAX_SPEED, 0.05, clip["speed"], func(v: float):
		clip["speed"] = v
		prepare(clip)
		touch())
	s.editable = keys.is_empty()
	_btn(box, "Add ramp key at playhead", "A speed key at the playhead: the speed changes smoothly between the keys", func(): add_key("speed"))
	if not keys.is_empty():
		_btn(box, "Remove ramp", "Back to one speed", func(): remove_keys("speed"))
	var zk: Array = clip["zoomKeys"]
	_lbl(box, "zoom from the keys" if not zk.is_empty() else "zoom ×")
	var z := _spin(box, MIN_ZOOM, MAX_ZOOM, 0.05, clip["zoom"], func(v: float):
		clip["zoom"] = v
		touch(), 64.0)
	z.editable = zk.is_empty()
	_btn(box, "Add zoom key at playhead", "A zoom key at the playhead: the zoom changes smoothly between the keys", func(): add_key("zoom"))
	if not zk.is_empty():
		_btn(box, "Remove zoom keys", "Back to one zoom", func(): remove_keys("zoom"))
	_btn(box, "Split at playhead", "Cut the clip in two at the playhead", func():
		if split_clip(selected, head_t - starts()[selected]):
			touch()
		else:
			say("Put the playhead inside the clip first."))
	_btn(box, "◀", "Move the clip to the left", func(): move_clip(selected, -1))
	_btn(box, "▶", "Move the clip to the right", func(): move_clip(selected, 1))
	_btn(box, "Delete clip", "Take the clip out of the timeline", func(): delete_clip(selected))


class _Late:
	extends Node
	var ed: VideoEditor

	func _ready() -> void:
		process_mode = Node.PROCESS_MODE_ALWAYS
		process_priority = 160

	func _process(_delta: float) -> void:
		ed.late_frame()
