class_name TrackEditorHistory
extends RefCounted
## Undo and redo of the whole track editor (snapshots of what would be saved), and whether there are changes that are
## not saved. The draft (track-editor.js saveDraft, offerDraft): what has not been saved is kept every few seconds and when
## the editor closes (user://track-editor-draft.json; the tests: in their folder); the next time that track is opened the
## editor offers to restore it. Saving the track throws the draft away.

var ed: TrackEditor
var draft_resolved := false          # (no draft is written before the one that was there has been offered)
var _history: Array[String] = []
var _future: Array[String] = []
var _last_snapshot := ""
var _saved_print := ""
var _restoring := false
var _draft_in := 8.0


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
	if draft_resolved:
		clear_draft()


# ---- the draft

func draft_path() -> String:
	var out: String = ed.get_meta("out", Content.arg("editor-out"))
	return out.path_join("track-editor-draft.json") if out != "" else "user://track-editor-draft.json"


func _draft_id() -> String:
	return str(ed.ui["id"].text).strip_edges() if ed.ui.has("id") else ""


func read_draft() -> Dictionary:
	var d: Variant = JSON.parse_string(FileAccess.get_file_as_string(draft_path())) if FileAccess.file_exists(draft_path()) else null
	return d if d is Dictionary else {}


func clear_draft() -> void:
	if FileAccess.file_exists(draft_path()):
		DirAccess.remove_absolute(draft_path())


## Keeps what has not been saved (every 8 s, and when the editor closes).
func save_draft() -> void:
	if not draft_resolved or not unsaved() or _draft_id() == "":
		return
	var f := FileAccess.open(draft_path(), FileAccess.WRITE)
	if f != null:
		f.store_string(JSON.stringify({"id": _draft_id(), "at": Time.get_unix_time_from_system(), "editor": snapshot()}))
		f.close()


func frame(dt: float) -> void:
	_draft_in -= dt
	if _draft_in <= 0.0:
		_draft_in = 8.0
		save_draft()


## The track that was opened has a draft of changes that were never saved: restore them?
func offer_draft() -> void:
	var d := read_draft()
	draft_resolved = true
	if d.is_empty() or str(d.get("id", "")) == "" or str(d["id"]) != _draft_id() or not (d.get("editor") is String):
		return
	if str(d["editor"]) == snapshot():
		clear_draft()
		return
	var when := Time.get_datetime_string_from_unix_time(int(d.get("at", 0)), true)
	TrackEditorUI.ask(ed, "Restore the unsaved changes?", "The editor kept changes to “%s” from %s that were never saved." % [d["id"], when], "Restore",
		func(): restore_draft(d), clear_draft)


func restore_draft(d: Dictionary) -> void:
	note()
	_restore(str(d["editor"]))
	ed.changed()
	ed.status("The changes that were not saved are back. Save to keep them.", "ok")


func unsaved() -> bool:
	return _saved_print != "" and fingerprint() != _saved_print
