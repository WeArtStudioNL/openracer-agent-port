class_name ReplayFiles
extends RefCounted
## The replay files (Replay.js: save, open, the Replays of the main menu).
##
## The game's own file (.oreplay) is a Godot Variant (FileAccess.store_var) of a Dictionary: { version, track,
## track_name, cars (ids), names, rate, count, stride, samples (PackedFloat32Array, count x cars x stride), created }
## and, when there are, name, camera (the keys of CameraTrack), cams (the cameras of the clips of the video editor:
## [first sample, "follow" | "cockpit" | "cinematic" | "track", look ahead]), zoom (one per sample), project (the
## clips and the camera track of the video editor, to go on with) and edit (the edit as it plays, a recording of
## its own, which Watch plays). Version 1 files (23 numbers per car, no velocity, pedals or squeal) are read too.
##
## The browser's files (.openracer-replay) are opened as well: gzip, then "ORRP", the length of a JSON header, the
## header, and per sample per car 36 float32 numbers (place, turn, velocity, steering, rpm, throttle, brake, gear,
## present + squeal, and per wheel its centre in the world, its turn and its spring). The cars and the track must
## be in this game (by their ids). Their camera track, the cameras of the clips and the zoom play as they do in the
## browser. Left out: the blocks after the numbers (the dents and the parts of the soft body, the skid marks, the
## smoke and the other effects, the rider as a ragdoll): the Godot replay has no soft body or effects yet.

const VERSION := 2
const EXT := "oreplay"
const BROWSER_EXT := "openracer-replay"
const BROWSER_STRIDE := 36
const BROWSER_FIELDS := 16
const MAX_FILE := 300 * 1024 * 1024


## Writes a file in the replays folder: <track>__<date>[__<name>].oreplay. The path, or "" when it failed.
static func write(data: Dictionary, label: String) -> String:
	var dir := VideoPrefs.replays_dir()
	DirAccess.make_dir_recursive_absolute(dir)
	var stamp := Time.get_datetime_string_from_system().replace(":", "-").replace("T", "_")
	var stem := "%s__%s" % [data.get("track", ""), stamp]
	if label != "":
		stem += "__" + VideoPrefs.safe_name(label).replace("__", "_")
	var path := dir.path_join(stem + "." + EXT)
	var n := 2
	while FileAccess.file_exists(path):
		path = dir.path_join("%s (%d).%s" % [stem, n, EXT])
		n += 1
	if label != "" and not data.has("name"):
		data["name"] = label
	return path if _store(path, data) else ""


static func _store(path: String, data: Dictionary) -> bool:
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f == null:
		return false
	f.store_var(data)
	f.close()
	RunLog.event("replay saved: %s (%.1f s, %d cars)" % [path, maxf(0.0, (int(data["count"]) - 1) / float(data["rate"])), (data["cars"] as Array).size()])
	return true


## Changes fields of a file of the game (the video editor keeps its project and its edit with the replay).
static func update(path: String, fields: Dictionary) -> bool:
	if not path.ends_with("." + EXT):
		return false
	var data := _raw(path)
	if data.is_empty():
		return false
	for k in fields:
		data[k] = fields[k]
	return _store(path, data)


static func _raw(path: String) -> Dictionary:
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return {}
	var data: Variant = f.get_var()
	f.close()
	return data if data is Dictionary else {}


## A file as a recording: { track, cars, count, samples (version 2), … }, or {} when it is not a replay.
static func read(path: String) -> Dictionary:
	if path.ends_with("." + BROWSER_EXT):
		return read_browser(path)
	var data := _raw(path)
	if data.is_empty() or not data.has("samples") or not data.has("cars"):
		return {}
	var v := int(data.get("version", 1))
	if v == 1 and int(data.get("stride", 0)) == 23:
		data["samples"] = _from_v1(data["samples"], int(data["count"]) * (data["cars"] as Array).size())
		data["stride"] = Replay.STRIDE
	if int(data.get("stride", 0)) != Replay.STRIDE:
		return {}
	if not data.has("names"):
		data["names"] = data["cars"]
	if data.get("edit") is Dictionary and int(data["edit"].get("stride", 0)) != Replay.STRIDE:
		data.erase("edit")
	return data


## (version 1: position 3, rotation 4, steering, omega, throttle, gear, then the wheels)
static func _from_v1(old: PackedFloat32Array, rows: int) -> PackedFloat32Array:
	var out := PackedFloat32Array()
	out.resize(rows * Replay.STRIDE)
	for r in rows:
		var a := r * 23
		var b := r * Replay.STRIDE
		for i in 7:
			out[b + i] = old[a + i]
		out[b + Replay.P_STEER] = old[a + 7]
		out[b + Replay.P_OMEGA] = old[a + 8]
		out[b + Replay.P_THROTTLE] = old[a + 9]
		out[b + Replay.P_GEAR] = old[a + 10]
		out[b + Replay.P_PRESENT] = 1.0
		for k in 12:
			out[b + Replay.CAR_FIELDS + k] = old[a + 11 + k]
	# (the velocity, from the places)
	return out


## The head of a file: { track, cars, names, seconds, name, edited, browser } (without the recording), or {}.
static func read_head(path: String) -> Dictionary:
	var data := read(path)
	if data.is_empty():
		return {}
	var seconds := maxf(0.0, (int(data["count"]) - 1) / float(data.get("rate", 30.0)))
	var edit: Variant = data.get("edit")
	return {"track": data["track"], "track_name": data.get("track_name", data["track"]), "cars": data["cars"], "names": data.get("names", data["cars"]),
		"seconds": seconds, "name": str(data.get("name", "")), "edited": edit is Dictionary, "browser": data.get("browser", false),
		"edit_seconds": maxf(0.0, (int(edit["count"]) - 1) / 30.0) if edit is Dictionary else 0.0}


## The replay files, the newest first.
static func list_files() -> Array[String]:
	var dir := VideoPrefs.replays_dir()
	var out: Array[String] = []
	for f in DirAccess.get_files_at(dir):
		if f.ends_with("." + EXT) or f.ends_with("." + BROWSER_EXT):
			out.append(dir.path_join(f))
	out.sort_custom(func(a, b): return FileAccess.get_modified_time(a) > FileAccess.get_modified_time(b))
	return out


# ---- the browser's files

static func read_browser(path: String) -> Dictionary:
	if FileAccess.get_size(path) > MAX_FILE:
		return {}
	var bytes := FileAccess.get_file_as_bytes(path)
	if bytes.size() > 2 and bytes[0] == 0x1f and bytes[1] == 0x8b:
		bytes = bytes.decompress_dynamic(MAX_FILE, FileAccess.COMPRESSION_GZIP)
	if bytes.size() < 16 or bytes.slice(0, 4).get_string_from_ascii() != "ORRP":
		return {}
	var hl := bytes.decode_u32(4)
	if 8 + hl > bytes.size():
		return {}
	var h: Variant = JSON.parse_string(bytes.slice(8, 8 + hl).get_string_from_utf8())
	if not (h is Dictionary) or h.get("format") != "openracer-replay" or int(h.get("stride", 0)) != BROWSER_STRIDE or int(h.get("rate", 0)) != 30:
		return {}
	var hc: Array = h.get("cars", [])
	var n := int(h.get("samples", 0))
	if hc.is_empty() or hc.size() > 12 or n < 2:
		return {}
	var start := 8 + hl
	var wanted := n * hc.size() * BROWSER_STRIDE * 4
	if bytes.size() < start + wanted:
		return {}
	var raw := bytes.slice(start, start + wanted).to_float32_array()
	var gears: Array = h.get("gears", [""])
	var ids: Array = []
	var names: Array = []
	for c in hc:
		var id := str(c.get("id", "")) if c is Dictionary else ""
		if id == "" and c is Dictionary and c.has("name"):
			id = _slug(str(c["name"]))
		ids.append(id)
		names.append(str(c.get("name", id)) if c is Dictionary else id)
	var rows := n * hc.size()
	var out := PackedFloat32Array()
	out.resize(rows * Replay.STRIDE)
	var centres := PackedFloat32Array()
	centres.resize(rows * 12)
	for r in rows:
		var a := r * BROWSER_STRIDE
		var b := r * Replay.STRIDE
		for i in 10:                                  # place, turn, velocity
			out[b + i] = _fin(raw[a + i])
		var steer := _fin(raw[a + 10])
		out[b + Replay.P_STEER] = steer
		out[b + Replay.P_OMEGA] = _fin(raw[a + 11]) * TAU / 60.0
		out[b + Replay.P_THROTTLE] = _fin(raw[a + 12])
		out[b + Replay.P_BRAKE] = _fin(raw[a + 13])
		var label := str(gears[int(raw[a + 14])]) if int(raw[a + 14]) >= 0 and int(raw[a + 14]) < gears.size() else ""
		out[b + Replay.P_GEAR] = _gear(label)
		out[b + Replay.P_PRESENT] = _fin(raw[a + 15])
		for k in 4:
			var o := a + BROWSER_FIELDS + k * 5
			var p := b + Replay.CAR_FIELDS + k * Replay.WHEEL_FIELDS
			out[p] = _fin(raw[o + 4])
			out[p + 1] = steer if k < 2 else 0.0
			out[p + 2] = _fin(raw[o + 3])
			centres[r * 12 + k * 3] = _fin(raw[o])
			centres[r * 12 + k * 3 + 1] = _fin(raw[o + 1])
			centres[r * 12 + k * 3 + 2] = _fin(raw[o + 2])
	var tr: Dictionary = h.get("track", {}) if h.get("track") is Dictionary else {}
	var data := {"version": VERSION, "browser": true, "track": str(tr.get("id", "")), "track_name": str(tr.get("name", tr.get("id", ""))),
		"cars": ids, "names": names, "rate": 30.0, "count": n, "stride": Replay.STRIDE, "samples": out, "centres": centres,
		"created": str(h.get("created", "")), "game": str(h.get("game", ""))}
	if h.has("name"):
		data["name"] = str(h["name"])
	if h.get("camera") is Array:
		data["camera"] = CameraTrack.clean(h["camera"])
	if h.get("cams") is Array:
		data["cams"] = h["cams"]
	if h.get("zoom") is Array:
		data["zoom"] = h["zoom"]
	return data


## A gear of the browser ("R", "N", "1", "D3", "D") as the number of the game (-1 reverse, 0 neutral, 1 …).
static func _gear(label: String) -> int:
	if label.begins_with("R"):
		return -1
	var digits := ""
	for ch in label:
		if ch >= "0" and ch <= "9":
			digits += ch
	if digits != "":
		return int(digits)
	return 1 if label.begins_with("D") else 0


## (a car whose setup had no id: the id is its name as a slug, hatchback for Hatchback, as Replay.js does)
static func _slug(text: String) -> String:
	var out := ""
	for ch in text.strip_edges().to_lower():
		out += ch if (ch >= "a" and ch <= "z") or (ch >= "0" and ch <= "9") else "-"
	while out.contains("--"):
		out = out.replace("--", "-")
	return out.trim_prefix("-").trim_suffix("-")


static func _fin(x: float) -> float:
	return x if is_finite(x) else 0.0


## The places of a browser file are those of its physics body: here the car is put where its wheels were (the
## middle of the four wheel centres of the file against the hubs of this car at the same springs).
static func fit_browser(data: Dictionary, cars: Array) -> void:
	var centres: PackedFloat32Array = data.get("centres", PackedFloat32Array())
	var s: PackedFloat32Array = data["samples"]
	var n := int(data["count"])
	var nc := cars.size()
	if centres.size() != n * nc * 12:
		return
	for c in nc:
		var car: Car = cars[c]
		if car == null:
			continue
		for i in n:
			var r := i * nc + c
			var b := r * Replay.STRIDE
			var q := Quaternion(s[b + 3], s[b + 4], s[b + 5], s[b + 6]).normalized()
			var sum := Vector3.ZERO
			for k in 4:
				var w: Car.Wheel = car.wheels[k]
				var hub := w.hub + Vector3.UP * (car.susp_length - s[b + Replay.CAR_FIELDS + k * Replay.WHEEL_FIELDS])
				sum += Vector3(centres[r * 12 + k * 3], centres[r * 12 + k * 3 + 1], centres[r * 12 + k * 3 + 2]) - q * hub
			var o := sum / 4.0
			if o.distance_to(Vector3(s[b], s[b + 1], s[b + 2])) < 3.0:
				s[b] = o.x
				s[b + 1] = o.y
				s[b + 2] = o.z
	data["samples"] = s
	data.erase("centres")


# ---- the Replays of the main menu

## A window with the replays: a field to find one, Watch (the edit when there is one), Edit (the video editor), Rename, Delete (to the Trash),
## Open a file… (a .oreplay or a .openracer-replay of the browser, copied into the replays folder), the folder.
## start(car, track, options) starts a viewer.
static func open_dialog(host: Node, start: Callable) -> void:
	var dlg := AcceptDialog.new()
	dlg.title = "Replays"
	dlg.ok_button_text = "Close"
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 8)
	dlg.add_child(box)
	var search := LineEdit.new()
	search.placeholder_text = "Find a replay: a name, a track, a car…"
	search.clear_button_enabled = true
	box.add_child(search)
	var list := ItemList.new()
	list.custom_minimum_size = Vector2(760, 380)
	box.add_child(list)
	var name_row := HBoxContainer.new()
	name_row.visible = false
	var name_edit := LineEdit.new()
	name_edit.placeholder_text = "A name for this replay"
	name_edit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	name_row.add_child(name_edit)
	box.add_child(name_row)
	var note := Label.new()
	note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	note.custom_minimum_size.x = 760
	box.add_child(note)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	box.add_child(row)
	var heads: Array = []
	var known := {}                     # (the file -> its head: a file is read once, not at every letter of the search)
	var fill := func() -> void:
		list.clear()
		heads.clear()
		var word := search.text.strip_edges().to_lower()
		for f in list_files():
			var h: Dictionary = known[f] if known.has(f) else read_head(f)
			known[f] = h
			if h.is_empty():
				continue
			if word != "" and not ("%s %s %s %s %s" % [h["name"], h["track_name"], h["track"], " ".join(h["names"]), f.get_file()]).to_lower().contains(word):
				continue
			heads.append([f, h])
			var stamp := Time.get_datetime_string_from_unix_time(FileAccess.get_modified_time(f)).replace("T", " ").left(16)
			var title: String = h["name"] if h["name"] != "" else "%s · %s" % [h["track_name"], ", ".join((h["names"] as Array).slice(0, 3))]
			list.add_item("%s%s · %s · %d car%s · %s%s · %s" % ["[browser] " if h["browser"] else "", title, h["track"], (h["cars"] as Array).size(),
				"" if (h["cars"] as Array).size() == 1 else "s", LapTimer.format_time(h["seconds"]),
				" · edited %s" % LapTimer.format_time(h["edit_seconds"]) if h["edited"] else "", stamp])
		if heads.is_empty():
			list.add_item("No replay with that in it." if word != "" else "No replays yet: Esc, Replay, Save replay while you drive.")
	fill.call()
	search.text_changed.connect(func(_t: String): fill.call())
	var chosen := func() -> Array:
		var sel := list.get_selected_items()
		return heads[sel[0]] if not sel.is_empty() and sel[0] < heads.size() else []
	var go := func(edit: bool) -> void:
		var it: Array = chosen.call()
		if it.is_empty():
			note.text = "Choose a replay in the list first."
			return
		var h: Dictionary = it[1]
		var missing := missing_content(h)
		if missing != "":
			note.text = "This replay needs %s, which this game does not have. Import it (a zip) in the main menu." % missing
			return
		dlg.queue_free()
		start.call(str(h["cars"][0]), str(h["track"]), {"mode": "replay", "file": it[0], "edit": edit})
	list.item_activated.connect(func(_i: int): go.call(false))
	var renaming := [""]
	name_edit.text_submitted.connect(func(t: String):
		if renaming[0] != "" and update(renaming[0], {"name": t.strip_edges()}):
			known.erase(renaming[0])
			note.text = "Renamed."
			fill.call()
		elif renaming[0] != "":
			note.text = "This replay cannot be renamed here (a replay of the browser)."
		renaming[0] = ""
		name_row.visible = false)
	for item in [["Watch", func(): go.call(false)], ["Edit (video editor)", func(): go.call(true)], ["Rename", func():
			var it: Array = chosen.call()
			if it.is_empty():
				note.text = "Choose a replay in the list first."
				return
			renaming[0] = it[0]
			name_edit.text = str(it[1]["name"])
			name_row.visible = true
			name_edit.grab_focus()
			name_edit.select_all()
			note.text = "Type a name and press Enter."], ["Delete", func():
			var it: Array = chosen.call()
			if not it.is_empty():
				OS.move_to_trash(ProjectSettings.globalize_path(it[0]))
				note.text = "Moved to the Trash: " + str(it[0]).get_file()
				fill.call()], ["Open a file…", func(): _import(host, func(msg: String):
					note.text = msg
					fill.call())], ["Show the folder", func():
			DirAccess.make_dir_recursive_absolute(VideoPrefs.replays_dir())
			OS.shell_open(ProjectSettings.globalize_path(VideoPrefs.replays_dir()))]]:
		var b := Button.new()
		b.text = item[0]
		b.pressed.connect(item[1])
		row.add_child(b)
	dlg.confirmed.connect(dlg.queue_free)
	dlg.canceled.connect(dlg.queue_free)
	host.add_child(dlg)
	dlg.popup_centered()


## What a replay needs that the game does not have ("" when it has it all).
static func missing_content(h: Dictionary) -> String:
	var parts: Array = []
	if not (Content.load_json("tracks/%s/track.json" % h["track"]) is Dictionary):
		parts.append("the track %s" % h["track"])
	for id in h["cars"]:
		var t := "the car %s" % id
		if not (Content.load_json("cars/%s/car.json" % id) is Dictionary) and not parts.has(t):
			parts.append(t)
	return ", ".join(parts)


static func _import(host: Node, done: Callable) -> void:
	var fd := FileDialog.new()
	fd.file_mode = FileDialog.FILE_MODE_OPEN_FILE
	fd.access = FileDialog.ACCESS_FILESYSTEM
	fd.use_native_dialog = true
	fd.filters = PackedStringArray(["*.oreplay, *.openracer-replay ; Replays"])
	fd.title = "A replay file"
	host.add_child(fd)
	fd.file_selected.connect(func(p: String):
		fd.queue_free()
		if read(p).is_empty():
			done.call("This is not a replay that this game can open: " + p.get_file())
			return
		var dir := VideoPrefs.replays_dir()
		DirAccess.make_dir_recursive_absolute(dir)
		var to := dir.path_join(p.get_file())
		if FileAccess.file_exists(to):
			to = dir.path_join("%s (%s).%s" % [p.get_file().get_basename(), VideoPrefs.stamp(), p.get_extension()])
		var err := DirAccess.copy_absolute(p, to)
		done.call("Added: " + to.get_file() if err == OK else "Could not copy the file."))
	fd.canceled.connect(fd.queue_free)
	fd.popup_centered_ratio(0.6)
