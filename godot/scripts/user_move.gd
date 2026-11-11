extends Node
## The game was called "O-Racer Godot" before it was GripWorks: its user folder was Godot/app_userdata/O-Racer Godot
## in the data folder of the system (Application Support, AppData/Roaming, ~/.local/share/godot). Now it has its own
## folder, GripWorks. The first time GripWorks starts without settings of its own, the old folder is copied into it
## (the settings, the garage, the tunes, the replays, the ghosts). The old folder stays where it was.
## (The first autoload: it runs before the others read the user folder. Not with --user-dir, the folder of the tests.)

const OLD := ["Godot/app_userdata/O-Racer Godot", "godot/app_userdata/O-Racer Godot"]


func _init() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--user-dir="):
			return
	if FileAccess.file_exists("user://settings.cfg"):
		return
	var to := ProjectSettings.globalize_path("user://")
	for rel: String in OLD:
		var from := OS.get_data_dir().path_join(rel)
		if from != to.trim_suffix("/") and DirAccess.dir_exists_absolute(from):
			var n := _copy(from, to)
			print("GripWorks: %d files of O-Racer Godot copied from %s" % [n, from])
			return


## Every file under from into to, but the logs (the new game writes its own); the files that are there already stay.
static func _copy(from: String, to: String) -> int:
	var n := 0
	DirAccess.make_dir_recursive_absolute(to)
	var d := DirAccess.open(from)
	if d == null:
		return 0
	d.include_hidden = true
	for f in d.get_files():
		if not FileAccess.file_exists(to.path_join(f)) and d.copy(from.path_join(f), to.path_join(f)) == OK:
			n += 1
	for sub in d.get_directories():
		if sub != "logs":
			n += _copy(from.path_join(sub), to.path_join(sub))
	return n
