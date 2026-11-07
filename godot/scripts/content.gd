extends Node
## The content of OpenRacer: the cars, the tracks and the wheel library.
##
## The Godot version reads the same files as the browser game (car.json, track.json and the glb models in the
## web folder of the repository), so nothing is copied and a car or a track made for the browser game drives
## here too. The models are loaded while the game runs (GLTFDocument), the way the browser game loads them.

## The friction of the surfaces (web/js/Surfaces.js): the grip at the peak of the tyre curve (static) and while
## sliding (kinetic); loose ground also has a drag (a factor on the rolling resistance).
const SURFACES := {
	"road": {"static": 1.2, "kinetic": 1.06},
	"track01": {"static": 1.03, "kinetic": 0.93},
	"wet": {"static": 0.85, "kinetic": 0.75},
	"grass": {"static": 0.62, "kinetic": 0.52, "loose": true},
	"sand": {"static": 0.6, "kinetic": 0.5, "loose": true, "drag": 4.5},
	"gravel": {"static": 0.78, "kinetic": 0.66, "loose": true, "drag": 3.0},
	"mud": {"static": 0.5, "kinetic": 0.44, "loose": true, "drag": 6.0},
	"ground": {"static": 0.7, "kinetic": 0.58, "loose": true},
}


## The folder with cars/, tracks/ and wheels/ (an absolute path), or "" when it was not found.
var root := ""


func _ready() -> void:
	root = _find_root()
	if root == "":
		push_error("Content: the web folder of OpenRacer was not found (cars/index.json)")


func _find_root() -> String:
	var candidates: Array[String] = []
	var arg_root := _arg("content")
	if arg_root != "":
		candidates.append(arg_root)
	# in the repository: godot/ next to web/
	candidates.append(ProjectSettings.globalize_path("res://").path_join("../web").simplify_path())
	# an exported game: a web folder next to the program
	candidates.append(OS.get_executable_path().get_base_dir().path_join("web"))
	candidates.append("res://content")
	for c in candidates:
		if FileAccess.file_exists(c.path_join("cars/index.json")):
			return c
	return ""


## A command line argument after "--": --name=value gives "value", --name gives "1".
func _arg(name: String) -> String:
	for a in OS.get_cmdline_user_args():
		if a == "--" + name:
			return "1"
		if a.begins_with("--" + name + "="):
			return a.substr(name.length() + 3)
	return ""


func arg(name: String) -> String:
	return _arg(name)


func path(rel: String) -> String:
	return root.path_join(rel)


func load_json(rel: String) -> Variant:
	var p := path(rel)
	if not FileAccess.file_exists(p):
		push_warning("Content: no file " + p)
		return null
	return JSON.parse_string(FileAccess.get_file_as_string(p))


## The cars that the prototype can drive: { id, name } (the motorcycles come in a later phase).
func list_cars() -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	var ids: Variant = load_json("cars/index.json")
	if ids is Array:
		for id in ids:
			var c: Variant = load_json("cars/%s/car.json" % id)
			if c is Dictionary and c.get("type", "car") != "motorcycle":
				out.append({"id": id, "name": c.get("name", id)})
	return out


func list_tracks() -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	var ids: Variant = load_json("tracks/index.json")
	if ids is Array:
		for id in ids:
			var t: Variant = load_json("tracks/%s/track.json" % id)
			if t is Dictionary:
				out.append({"id": id, "name": t.get("name", id)})
	return out


## Loads a glb or gltf file (a path in the content folder) as a new scene; null when it fails.
func load_model(rel: String) -> Node3D:
	var p := path(rel)
	if not FileAccess.file_exists(p):
		push_warning("Content: no model " + p)
		return null
	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	var err := doc.append_from_file(p, state)
	if err != OK:
		push_warning("Content: could not read %s (%s)" % [p, error_string(err)])
		return null
	return doc.generate_scene(state) as Node3D


func surface(id: String) -> Dictionary:
	return SURFACES.get(id, SURFACES["road"])
