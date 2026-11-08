extends SceneTree
## Packs the content of the game (cars, tracks, wheels and sounds of web/) into a pck as res://content, for the web
## version (tools/export_web.sh): Content loads it at start.
##
##   Godot --headless --path godot --script tools/pack_content.gd -- <web folder> <out.pck>

const KINDS := ["cars", "tracks", "wheels", "sounds"]
## What the game does not read (sources, archives, notes)
const SKIP_EXT := ["zip", "py", "md", "blend", "blend1"]


func _init() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() < 2:
		printerr("usage: -- <web folder> <out.pck>")
		quit(1)
		return
	var src := args[0]
	var out := args[1]
	var pck := PCKPacker.new()
	if pck.pck_start(out) != OK:
		printerr("cannot write " + out)
		quit(1)
		return
	var count := 0
	var size := 0
	for k in KINDS:
		var files: Array[String] = []
		_walk(src.path_join(k), k, files)
		for rel in files:
			var file := src.path_join(rel)
			if pck.add_file("res://content/" + rel, file) != OK:
				printerr("cannot add " + file)
				quit(1)
				return
			count += 1
			size += FileAccess.get_size(file)
	pck.flush()
	print("pack_content: %d files, %.1f MB -> %s" % [count, size / 1048576.0, out])
	quit(0)


func _walk(dir: String, rel: String, out: Array[String]) -> void:
	var d := DirAccess.open(dir)
	if d == null:
		return
	for f in d.get_files():
		if f.begins_with(".") or SKIP_EXT.has(f.get_extension().to_lower()):
			continue
		out.append(rel.path_join(f))
	for sub in d.get_directories():
		if not sub.begins_with("."):
			_walk(dir.path_join(sub), rel.path_join(sub), out)
