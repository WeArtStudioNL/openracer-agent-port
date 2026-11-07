class_name TrackEditorHistory
extends RefCounted
## Undo and redo of the whole track editor (snapshots of what would be saved), and whether there are changes that are
## not saved.

var ed: TrackEditor
var _history: Array[String] = []
var _future: Array[String] = []
var _last_snapshot := ""
var _saved_print := ""
var _restoring := false


func _init(editor: TrackEditor) -> void:
	ed = editor


## A step for undo when the track is not what it was (after a click, a key or a field).
func note() -> void:
	if _restoring:
		return
	var now := snapshot()
	if now == _last_snapshot:
		return
	if _last_snapshot != "":
		_history.append(_last_snapshot)
		if _history.size() > 200:
			_history.pop_front()
	_future.clear()
	_last_snapshot = now


func reset_history() -> void:
	_history.clear()
	_future.clear()
	_last_snapshot = snapshot()


func snapshot() -> String:
	var c: Array = []
	for k in ed.curbs:
		c.append({"nodes": k["nodes"], "width": k["width"], "height": k["height"], "colour": k["colour"], "connect": k.get("connect", false)})
	return JSON.stringify({"grid": ed.grid, "pitBoxes": ed.pit_boxes, "pitLine": ed.pit_line, "gates": ed.gates, "cameras": ed.cameras, "drag": ed.drag,
		"objects": ed.objects, "curbs": c, "roles": ed.roles, "design": ed.design.data if ed.design != null else null, "ref": ed.reference, "showGates": ed.show_gates})


func _restore(s: String) -> void:
	var d: Dictionary = JSON.parse_string(s)
	_restoring = true
	ed.sel = {"kind": "", "i": -1, "node": -1}
	ed.grid = d["grid"]
	ed.pit_boxes = d["pitBoxes"]
	ed.pit_line = d["pitLine"]
	ed.gates = d["gates"]
	ed.cameras = d["cameras"]
	ed.drag = d["drag"]
	ed.objects = d["objects"]
	ed.reference = d["ref"]
	ed.show_gates = d["showGates"]
	for o in ed.objects:
		for k in ["x", "y", "z", "heading", "pitch", "roll", "sx", "sy", "sz"]:
			o[k] = float(o.get(k, 1.0 if k.begins_with("s") else 0.0))
	if ed.design != null and d["design"] is Dictionary and JSON.stringify(d["design"]) != JSON.stringify(ed.design.data):
		ed.design.set_data(d["design"])
		ed.rebuild_design(true)
	if JSON.stringify(ed.roles) != JSON.stringify(d["roles"]):
		ed.roles = d["roles"]
		ed.invalidate_ground()
		ed.parts_kit.apply_colours()
	ed.curbs_kit.reset_curbs(d["curbs"])
	TrackEditorIO.place_reference(ed)
	ed.parts_kit.show_objects()
	_restoring = false
	_last_snapshot = snapshot()
	ed.refresh()


func undo() -> void:
	note()
	if _history.is_empty():
		ed.status("There is nothing to undo.")
		return
	_future.append(_last_snapshot)
	_restore(_history.pop_back())


func redo() -> void:
	if _future.is_empty():
		ed.status("There is nothing to redo.")
		return
	_history.append(_last_snapshot)
	_restore(_future.pop_back())


func can_undo() -> bool:
	return not _history.is_empty()


func can_redo() -> bool:
	return not _future.is_empty()


## What would be saved, to see whether there are changes that are not saved.
func fingerprint() -> String:
	return snapshot() + JSON.stringify([str(ed.ui["name"].text) if ed.ui.has("name") else "", str(ed.ui["id"].text) if ed.ui.has("id") else "",
		str(ed.ui["description"].text) if ed.ui.has("description") else "", ed.env, ed.env_on, ed.sky_source, ed.sky_name, ed.model_source, ed.thumbnail != null,
		ed.models.keys(), ed.line_edit["editing"] and JSON.stringify(ed.line_edit["nodes"]) != ed.line_edit["start"]])


func mark_saved() -> void:
	_saved_print = fingerprint()


func unsaved() -> bool:
	return _saved_print != "" and fingerprint() != _saved_print
