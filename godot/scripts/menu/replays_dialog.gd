class_name ReplaysDialog
extends MenuDialog
## The window of the replays (MainMenu.js showReplays): the saved ones to watch, to download (copy to a file) or to
## delete, and a file to import. (Edit, the video editor, is not here.)

signal watch(car_id: String, track_id: String, file: String)

var _list: VBoxContainer


func _init() -> void:
	super._init("Replays", "Replays you saved, kept on this computer. Import a replay file to watch someone else's (you need the same track and cars).")
	_list = VBoxContainer.new()
	_list.add_theme_constant_override("separation", 6)
	box.add_child(_list)
	foot([MenuStyle.button("Import replay…", "primary", _import), MenuStyle.button("Close", "", close)])


func _ready() -> void:
	fill()


func fill() -> void:
	for c in _list.get_children():
		c.queue_free()
	var shown := 0
	for f in Replay.list_files():
		var h := Replay.read_head(f)
		if h.is_empty():
			continue
		shown += 1
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 10)
		var text := VBoxContainer.new()
		text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		var cars: Array = h.get("cars", [])
		var stamp := f.get_file().get_basename().get_slice("__", 1)
		text.add_child(MenuStyle.label(_track_name(str(h.get("track", ""))), 16, MenuStyle.HEAD))
		var bytes := FileAccess.open(f, FileAccess.READ).get_length() if FileAccess.file_exists(f) else 0
		text.add_child(MenuStyle.label("%s%s · %s · %s · %s" % [", ".join(cars.slice(0, 3)), " …" if cars.size() > 3 else "",
			LapTimer.format_time(float(h.get("seconds", 0))).get_slice(".", 0), stamp, _size(bytes)], 13, MenuStyle.MUTED))
		row.add_child(text)
		row.add_child(MenuStyle.button("Watch", "primary", func():
			close()
			watch.emit(str(cars[0]) if not cars.is_empty() else "", str(h.get("track", "")), f)))
		row.add_child(MenuStyle.button("Download", "", _download.bind(f)))
		row.add_child(MenuStyle.button("Delete", "danger", func():
			MenuDialog.confirm(get_parent(), "Delete this replay?", "", "Delete", func():
				OS.move_to_trash(ProjectSettings.globalize_path(f))
				RunLog.event("replay deleted: %s" % f)
				fill())))
		var frame := PanelContainer.new()
		frame.add_theme_stylebox_override("panel", MenuStyle.flat(Color(0, 0, 0, 0), MenuStyle.LINE, 8, 1, 8))
		frame.add_child(row)
		_list.add_child(frame)
	if shown == 0:
		_list.add_child(MenuStyle.label("No replays yet. Esc, Replay, Save replay while you drive.", 14, MenuStyle.MUTED))
	focus_first.call_deferred()


func _download(f: String) -> void:
	MenuDialog.file_dialog(self, FileDialog.FILE_MODE_SAVE_FILE, PackedStringArray(["*.%s ; Replay" % Replay.EXT]), "Save the replay", func(p: Variant):
		var err := DirAccess.copy_absolute(ProjectSettings.globalize_path(f), str(p))
		say("Saved %s." % str(p).get_file() if err == OK else "Could not save it (%s)." % error_string(err), err != OK), f.get_file())


func _import() -> void:
	MenuDialog.file_dialog(self, FileDialog.FILE_MODE_OPEN_FILE, PackedStringArray(["*.%s ; Replay" % Replay.EXT]), "A replay file", func(p: Variant):
		var path := str(p)
		var h := Replay.read_head(path)
		if h.is_empty():
			say("This is not a replay of this version.", true)
			return
		DirAccess.make_dir_recursive_absolute(Replay.DIR)
		var err := DirAccess.copy_absolute(path, ProjectSettings.globalize_path(Replay.DIR.path_join(path.get_file())))
		say("Imported %s." % path.get_file() if err == OK else "Could not import it (%s)." % error_string(err), err != OK)
		fill())


static func _track_name(id: String) -> String:
	var t: Variant = Content.load_json("tracks/%s/track.json" % id) if id != "" else null
	return str(t.get("name", id)) if t is Dictionary else id


static func _size(bytes: int) -> String:
	return "%d KB" % maxi(1, bytes / 1024) if bytes < 1048576 else "%.1f MB" % (bytes / 1048576.0)
