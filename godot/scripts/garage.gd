class_name Garage
extends RefCounted
## The garage (web/js/Garage.js): cars and tracks of the player, next to the ones the game comes with. They are kept
## in the user folder (user://garage/cars/<id>/car.json and its files, user://garage/tracks/<id>/track.json), and a
## folder of the player's own can be added (Settings "garage_folder", with cars/ and tracks/ in it). An item there with
## the id of one of the game wins over it; an item with only its json keeps using the files of the game's one (a car
## that was only tuned). A zip of an item (car.json or track.json at its root or in one folder, as the browser game
## exports it) is put in the garage with import_zip.

const DIR := "user://garage"
const CONFIG_FILE := {"cars": "car.json", "tracks": "track.json"}


## The folders that hold garage items, first the one that wins.
static func roots() -> Array[String]:
	var out: Array[String] = []
	var own := str(Settings.get_value("garage_folder"))
	if own != "" and DirAccess.dir_exists_absolute(own):
		out.append(own)
	out.append(ProjectSettings.globalize_path(DIR))
	return out


## The ids of the items of a kind ("cars" or "tracks") in the garage.
static func ids(kind: String) -> Array[String]:
	var out: Array[String] = []
	for r in roots():
		var d := DirAccess.open(r.path_join(kind))
		if d == null:
			continue
		for id in d.get_directories():
			if FileAccess.file_exists(r.path_join(kind).path_join(id).path_join(CONFIG_FILE[kind])) and not out.has(id):
				out.append(id)
	return out


## The file of the garage for a path of the game (cars/<id>/model.glb), or "" when the garage does not have it.
static func resolve(rel: String) -> String:
	var parts := rel.split("/", false, 2)
	if parts.size() < 3 or not CONFIG_FILE.has(parts[0]):
		return ""
	for r in roots():
		var p := r.path_join(rel)
		if FileAccess.file_exists(p):
			return p
	return ""


## Puts the item of a zip in the garage: { kind, id } or { error }.
static func import_zip(path: String) -> Dictionary:
	var zip := ZIPReader.new()
	if zip.open(path) != OK:
		return {"error": "The file is not a zip."}
	var files := zip.get_files()
	var kind := ""
	var config_at := ""
	for f in files:
		var name := f.get_file()
		var depth := f.count("/")
		for k in CONFIG_FILE:
			if name == CONFIG_FILE[k] and depth <= 1 and (config_at == "" or depth < config_at.count("/")):
				kind = k
				config_at = f
	if config_at == "":
		zip.close()
		return {"error": "The zip has no car.json or track.json."}
	var json: Variant = JSON.parse_string(zip.read_file(config_at).get_string_from_utf8())
	if not (json is Dictionary):
		zip.close()
		return {"error": "The %s in the zip is not valid JSON." % CONFIG_FILE[kind]}
	var folder := config_at.get_base_dir()
	var id := str(json.get("id", folder if folder != "" else path.get_file().get_basename().trim_suffix(".car").trim_suffix(".track")))
	id = _slug(id if id != "" else str(json.get("name", "item")))
	var target := ProjectSettings.globalize_path(DIR).path_join(kind).path_join(id)
	DirAccess.make_dir_recursive_absolute(target)
	var written := 0
	for f in files:
		if f.ends_with("/") or (folder != "" and not f.begins_with(folder + "/")):
			continue
		var rel := f.substr(folder.length() + 1) if folder != "" else f
		if rel.begins_with("__MACOSX") or rel.get_file() == ".DS_Store":
			continue
		var out := target.path_join(rel)
		DirAccess.make_dir_recursive_absolute(out.get_base_dir())
		var fa := FileAccess.open(out, FileAccess.WRITE)
		if fa != null:
			fa.store_buffer(zip.read_file(f))
			fa.close()
			written += 1
	zip.close()
	RunLog.event("garage: %s %s imported from %s (%d files)" % [kind, id, path.get_file(), written])
	return {"kind": kind, "id": id}


## Takes an item out of the garage (the game's own one, if it has one, comes back).
static func remove(kind: String, id: String) -> void:
	var p := ProjectSettings.globalize_path(DIR).path_join(kind).path_join(id)
	if DirAccess.dir_exists_absolute(p):
		OS.move_to_trash(p)


static func _slug(s: String) -> String:
	var out := ""
	for ch in s.to_lower():
		out += ch if (ch >= "a" and ch <= "z") or (ch >= "0" and ch <= "9") or ch == "_" or ch == "-" else "-"
	while out.contains("--"):
		out = out.replace("--", "-")
	return out.trim_prefix("-").trim_suffix("-").substr(0, 64)
