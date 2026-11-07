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
	GLTFDocument.register_gltf_document_extension(GltfJpegFix.new())
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
	# an exported game: a web folder next to the program, in the bundle of a macOS app (Contents/Resources/web), or
	# next to the app
	var exe_dir := OS.get_executable_path().get_base_dir()
	candidates.append(exe_dir.path_join("web"))
	candidates.append(exe_dir.path_join("../Resources/web").simplify_path())
	candidates.append(exe_dir.path_join("../../../web").simplify_path())
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


## The file for a path of the game (cars/<id>/car.json): the player's garage first (Garage), else the game's.
func path(rel: String) -> String:
	if rel.begins_with("/"):          # (an absolute path: the car editor tests a model that is not saved yet)
		return rel
	var own := Garage.resolve(rel)
	return own if own != "" else root.path_join(rel)


func load_json(rel: String) -> Variant:
	var p := path(rel)
	if not FileAccess.file_exists(p):
		push_warning("Content: no file " + p)
		return null
	return JSON.parse_string(FileAccess.get_file_as_string(p))


## The cars (and the motorcycles) that can be driven: { id, name }.
func list_cars() -> Array[Dictionary]:
	return _list("cars", "car.json")


func list_tracks() -> Array[Dictionary]:
	return _list("tracks", "track.json")


## The items of the game (its index.json) and of the garage: { id, name, garage }.
func _list(kind: String, file: String) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	var ids: Array = []
	var game: Variant = JSON.parse_string(FileAccess.get_file_as_string(root.path_join(kind + "/index.json"))) if root != "" else null
	if game is Array:
		ids.append_array(game)
	var own := Garage.ids(kind)
	for id in own:
		if not ids.has(id):
			ids.append(id)
	for id in ids:
		var c: Variant = load_json("%s/%s/%s" % [kind, id, file])
		if c is Dictionary:
			out.append({"id": id, "name": str(c.get("name", id)) + ("  (garage)" if own.has(id) else ""), "garage": own.has(id)})
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


## The grip of a surface with the condition of the ground (Ground: the wet and the snow take from it).
func surface(id: String) -> Dictionary:
	return Ground.surface(id)
