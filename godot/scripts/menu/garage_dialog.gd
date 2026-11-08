class_name GarageDialog
extends MenuDialog
## The garage (MainMenu.js showGarage): the cars and the tracks of the player (Garage) with a picture, Export zip and
## Delete; Load (a car opens in the car editor, a track in the track editor), New (a car or a track in its editor),
## Import (zips, or a zip at a link), and a folder of the player's own (Settings garage_folder) to link or unlink.

signal edit_car(car_id: String)
signal new_car
signal edit_track(track_id: String)
signal new_track

var changed := false               # something was imported or deleted: the menu reads its lists again
var _list: VBoxContainer
var _link_input: LineEdit


func _init() -> void:
	super._init("My garage", "")
	var tools := HBoxContainer.new()
	tools.add_theme_constant_override("separation", 8)
	tools.add_child(MenuStyle.button("Load", "ghost", _load))
	tools.add_child(MenuStyle.button("New", "ghost", _new))
	tools.add_child(MenuStyle.button("Import", "ghost", _import))
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	tools.add_child(spacer)
	tools.add_child(MenuStyle.button("Close", "", close))
	box.add_child(tools)
	box.move_child(tools, 1)
	# a link to a zip (MainMenu.js: Import from a link)
	var link_row := HBoxContainer.new()
	link_row.add_theme_constant_override("separation", 8)
	_link_input = LineEdit.new()
	_link_input.placeholder_text = "Link to a zip (https://…)"
	_link_input.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_link_input.text_submitted.connect(func(_t: String): import_url(_link_input.text))
	link_row.add_child(_link_input)
	link_row.add_child(MenuStyle.button("Import", "ghost", func(): import_url(_link_input.text)))
	box.add_child(link_row)
	box.move_child(link_row, 2)
	_list = VBoxContainer.new()
	_list.add_theme_constant_override("separation", 6)
	box.add_child(_list)


func _ready() -> void:
	build()


func build() -> void:
	for c in _list.get_children():
		c.queue_free()
	var any := false
	for kind in ["cars", "tracks"]:
		var ids := Garage.ids(kind)
		if ids.is_empty():
			continue
		any = true
		_list.add_child(MenuStyle.label("CARS" if kind == "cars" else "TRACKS", 12, MenuStyle.MUTED))
		for id in ids:
			_list.add_child(_row(kind, id))
	if not any:
		_list.add_child(MenuStyle.label("No cars or tracks in your garage yet. Use New or Import above.", 14, MenuStyle.MUTED))
	_list.add_child(MenuStyle.label("A FOLDER ON YOUR COMPUTER", 12, MenuStyle.MUTED))
	var own := str(Settings.get_value("garage_folder"))
	var actions := HBoxContainer.new()
	actions.add_theme_constant_override("separation", 8)
	if own != "":
		_list.add_child(MenuStyle.label("Linked: %s%s." % [own, "" if DirAccess.dir_exists_absolute(own) else " (it is not there now)"], 14, MenuStyle.MUTED, true))
		actions.add_child(MenuStyle.button("Unlink the folder", "", func():
			Settings.set_value("garage_folder", "")
			changed = true
			build()))
	else:
		_list.add_child(MenuStyle.label("Read from the folder each time; nothing is copied. It needs a folder per car "
			+ "(with its car.json) or per track (with its track.json) in cars/ and tracks/.",
			14, MenuStyle.MUTED, true))
		actions.add_child(MenuStyle.button("Link a folder…", "", _link))
	_list.add_child(actions)
	var used := _size_of(ProjectSettings.globalize_path(Garage.DIR))
	_list.add_child(MenuStyle.label("The garage uses %s in %s." % [_format(used), ProjectSettings.globalize_path(Garage.DIR)], 13, MenuStyle.MUTED, true))
	focus_first.call_deferred()


func _row(kind: String, id: String) -> PanelContainer:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	var cfg: Variant = Content.load_json("%s/%s/%s" % [kind, id, Garage.CONFIG_FILE[kind]])
	var c: Dictionary = cfg if cfg is Dictionary else {}
	var pic := TextureRect.new()
	pic.custom_minimum_size = Vector2(84, 56)
	pic.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	pic.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	pic.texture = CarInfo.car_picture(id, c, self, func(t: Texture2D): pic.texture = t) if kind == "cars" else CarInfo.track_picture(id)
	row.add_child(pic)
	var text := VBoxContainer.new()
	text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	text.add_child(MenuStyle.label(str(c.get("name", id)), 16, MenuStyle.HEAD))
	var folder := _folder(kind, id)
	var files := _count(folder)
	var src := CarInfo.source(kind, id)
	var what := "%d file%s, %s" % [files, "" if files == 1 else "s", _format(_size_of(folder))] if files > 1 else "settings only"
	text.add_child(MenuStyle.label("%s · %s · %s" % [id, what, src],
		13, MenuStyle.MUTED))
	row.add_child(text)
	row.add_child(MenuStyle.button("Export zip", "", _export.bind(kind, id, folder)))
	var del := MenuStyle.button("Delete", "danger", func():
		var label := str(c.get("name", id))
		MenuDialog.confirm(get_parent(), "Delete %s?" % label, ("It goes from the garage to the Trash. If "
			+ "the game has its own %s, that one stays.") % label, "Delete", func():
			Garage.remove(kind, id)
			RunLog.event("garage: %s %s deleted" % [kind, id])
			changed = true
			build()))
	# (an item of the linked folder is the player's own folder: not deleted from here)
	del.disabled = src == "folder"
	if del.disabled:
		del.tooltip_text = "It is in your own folder: delete it there."
	row.add_child(del)
	var frame := PanelContainer.new()
	frame.add_theme_stylebox_override("panel", MenuStyle.flat(Color(0, 0, 0, 0), MenuStyle.LINE, 8, 1, 8))
	frame.add_child(row)
	return frame


## The folder of an item (the one that wins: the player's folder, then the user folder).
static func _folder(kind: String, id: String) -> String:
	for r in Garage.roots():
		var p := r.path_join(kind).path_join(id)
		if FileAccess.file_exists(p.path_join(Garage.CONFIG_FILE[kind])):
			return p
	return ""


func _export(kind: String, id: String, folder: String) -> void:
	MenuDialog.file_dialog(self, FileDialog.FILE_MODE_SAVE_FILE, PackedStringArray(["*.zip ; Zip"]), "Export %s" % id, func(p: Variant):
		var err := export_zip(folder, id, str(p))
		say("Exported %s (%s)." % [str(p).get_file(), _format(FileAccess.open(str(p), FileAccess.READ).get_length())] if err == OK
			else "Could not export: %s" % error_string(err), err != OK), "%s.%s.zip" % [id, kind.trim_suffix("s")])


## A zip of an item: its files in one folder named by its id (as the browser exports it, and Garage.import_zip reads).
static func export_zip(folder: String, id: String, out: String) -> Error:
	var zip := ZIPPacker.new()
	var err := zip.open(out)
	if err != OK:
		return err
	for f in _files(folder, ""):
		zip.start_file(id.path_join(f))
		zip.write_file(FileAccess.get_file_as_bytes(folder.path_join(f)))
		zip.close_file()
	zip.close()
	return OK


static func _files(folder: String, rel: String) -> Array[String]:
	var out: Array[String] = []
	var here := folder.path_join(rel)
	for f in DirAccess.get_files_at(here):
		if f != ".DS_Store":
			out.append(rel.path_join(f) if rel != "" else f)
	for d in DirAccess.get_directories_at(here):
		out.append_array(_files(folder, rel.path_join(d) if rel != "" else d))
	return out


static func _count(folder: String) -> int:
	return _files(folder, "").size() if folder != "" and DirAccess.dir_exists_absolute(folder) else 0


static func _size_of(folder: String) -> int:
	if folder == "" or not DirAccess.dir_exists_absolute(folder):
		return 0
	var n := 0
	for f in _files(folder, ""):
		var fa := FileAccess.open(folder.path_join(f), FileAccess.READ)
		if fa != null:
			n += fa.get_length()
	return n


static func _format(bytes: int) -> String:
	if bytes >= 1073741824:
		return "%.1f GB" % (bytes / 1073741824.0)
	if bytes >= 1048576:
		return "%.1f MB" % (bytes / 1048576.0)
	return "%d kB" % maxi(1, bytes / 1024)


func _import() -> void:
	MenuDialog.file_dialog(self, FileDialog.FILE_MODE_OPEN_FILES, PackedStringArray(["*.zip ; Car or track"]), "Cars or tracks (zip)", func(p: Variant):
		var done := PackedStringArray()
		var failed := PackedStringArray()
		for f in p:
			var r := Garage.import_zip(str(f))
			if r.has("error"):
				failed.append("%s: %s" % [str(f).get_file(), r["error"]])
			else:
				done.append("%s %s" % [str(r["kind"]).trim_suffix("s"), r["id"]])
		changed = changed or not done.is_empty()
		build()
		say(("Imported %s." % ", ".join(done) if not done.is_empty() else "") + (" Not imported: %s" % "; ".join(failed) if not failed.is_empty() else ""),
			done.is_empty() and not failed.is_empty()))


func _link() -> void:
	MenuDialog.file_dialog(self, FileDialog.FILE_MODE_OPEN_DIR, PackedStringArray(), "A folder with cars/ and tracks/", func(p: Variant):
		Settings.set_value("garage_folder", str(p))
		changed = true
		build()
		var cars := DirAccess.get_directories_at(str(p).path_join("cars")).size() if DirAccess.dir_exists_absolute(str(p).path_join("cars")) else 0
		var tracks := DirAccess.get_directories_at(str(p).path_join("tracks")).size() if DirAccess.dir_exists_absolute(str(p).path_join("tracks")) else 0
		say("The folder is linked: %d car%s and %d track%s found." % [cars, "" if cars == 1 else "s", tracks, "" if tracks == 1 else "s"], cars + tracks == 0))


## Load: the cars and the tracks as pictures; a car opens in the car editor, a track in the track editor.
func _load() -> void:
	var d := MenuDialog.new("Load", "Click a car or a track to open it in its editor.", 960)
	get_parent().add_child(d)
	d.box.add_child(MenuStyle.label("CARS", 12, MenuStyle.MUTED))
	var grid := GridContainer.new()
	grid.columns = 4
	grid.add_theme_constant_override("h_separation", 12)
	grid.add_theme_constant_override("v_separation", 12)
	for c in Content.list_cars():
		var cfg: Variant = Content.load_json("cars/%s/car.json" % c["id"])
		var tile := MainMenu.car_tile(str(c["id"]), cfg if cfg is Dictionary else {}, false, self, 210)
		tile.pressed.connect(func():
			d.close()
			close()
			edit_car.emit(str(c["id"])))
		grid.add_child(tile)
	d.box.add_child(grid)
	d.box.add_child(MenuStyle.label("TRACKS", 12, MenuStyle.MUTED))
	var tracks := GridContainer.new()
	tracks.columns = 4
	tracks.add_theme_constant_override("h_separation", 12)
	tracks.add_theme_constant_override("v_separation", 12)
	for t in Content.list_tracks():
		var b := MenuStyle.button(str(t["name"]), "")
		b.custom_minimum_size = Vector2(210, 60)
		var pic := CarInfo.track_picture(str(t["id"]))
		if pic != null:
			b.icon = pic
			b.expand_icon = true
			b.custom_minimum_size = Vector2(210, 150)
			b.vertical_icon_alignment = VERTICAL_ALIGNMENT_TOP
		b.tooltip_text = "Open %s in the track editor" % t["name"]
		b.pressed.connect(func():
			d.close()
			close()
			edit_track.emit(str(t["id"])))
		tracks.add_child(b)
	d.box.add_child(tracks)
	d.foot([MenuStyle.button("Cancel", "ghost", d.close)])
	d.focus_first.call_deferred()


func _new() -> void:
	var d := MenuDialog.new("New", "Make a new car or track from a model.", 420)
	get_parent().add_child(d)
	var car := MenuStyle.button("Car", "primary", func():
		d.close()
		close()
		new_car.emit())
	var track := MenuStyle.button("Track", "primary", func():
		d.close()
		close()
		new_track.emit())
	d.foot([car, track, MenuStyle.button("Cancel", "ghost", d.close)])
	car.grab_focus.call_deferred()


## Imports the zip at a link (Garage.js importUrl): it is downloaded into the folder for temporary files and put in the garage as
## a zip that was chosen (Garage.import_zip). The message says what came of it.
func import_url(url: String) -> void:
	url = url.strip_edges()
	if not (url.begins_with("http://") or url.begins_with("https://")):
		say("Give a link that starts with https:// (or http://).", true)
		return
	say("Downloading…")
	var http := HTTPRequest.new()
	http.body_size_limit = 512 * 1048576
	http.timeout = 120.0
	var tmp := OS.get_temp_dir().path_join("openracer-download-%d.zip" % Time.get_ticks_msec())
	DirAccess.make_dir_recursive_absolute(tmp.get_base_dir())
	http.download_file = tmp
	add_child(http)
	http.request_completed.connect(func(result: int, code: int, _h: PackedStringArray, _b: PackedByteArray):
		http.queue_free()
		if result != HTTPRequest.RESULT_SUCCESS or code < 200 or code >= 300:
			DirAccess.remove_absolute(tmp)
			say("Could not download it (%s)." % ("HTTP %d" % code if result == HTTPRequest.RESULT_SUCCESS else "error %d" % result), true)
			return
		var r := Garage.import_zip(tmp)
		DirAccess.remove_absolute(tmp)
		if r.has("error"):
			say("Could not import it: %s" % r["error"], true)
			return
		changed = true
		build()
		say("Imported %s %s." % [str(r["kind"]).trim_suffix("s"), r["id"]])
		RunLog.event("garage: imported from %s" % url))
	var err := http.request(url)
	if err != OK:
		http.queue_free()
		say("Could not download it (error %d)." % err, true)
