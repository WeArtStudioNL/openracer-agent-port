class_name TrackEditorLine
extends RefCounted
## The AI racing line in the track editor (track-editor.js): shown, edited with nodes, drawn node by node, and saved as
## track.json "racing_line" (a point every 2 m).

var ed: TrackEditor


func _init(editor: TrackEditor) -> void:
	ed = editor


# ---- the racing line: edited with nodes, or drawn

func line_source() -> Array:
	var raw: Array = ed.existing.get("racing_line", [])
	if raw.size() > 10:
		return raw
	if ed.design != null and (ed.design.data["nodes"] as Array).size() >= 3:
		var curve := _line_curve(ed.design.data["nodes"])
		var n := maxi(32, roundi(curve.length() / 2.0))
		return Array(curve.spaced_points(n)).map(func(v: Vector3) -> Dictionary: return {"x": v.x, "y": v.y, "z": v.z})
	return []


static func _line_curve(nodes: Array) -> CatmullRom:
	var pts := PackedVector3Array()
	for n in nodes:
		pts.append(Vector3(float(n["x"]), float(n.get("y", 0)), float(n["z"])))
	return CatmullRom.make(pts, true)


## The points of the line that is shown or edited (the nodes of an edit as a smooth closed curve).
func line_points() -> PackedVector3Array:
	var out := PackedVector3Array()
	var le := ed.line_edit
	if le["editing"] and (le["nodes"] as Array).size() >= 3:
		var curve := _line_curve(le["nodes"])
		return curve.spaced_points(maxi(32, roundi(curve.length() / 2.0)))
	if le["editing"]:
		for n in le["nodes"]:
			out.append(Vector3(n["x"], n["y"], n["z"]))
		return out
	if ed.show_line:
		var raw: Array = ed.existing.get("racing_line", [])
		if raw.size() > 10:
			for p in raw:
				out.append(Vector3(float(p["x"]), float(p.get("y", 0)), float(p["z"])))
			out.append(out[0])
	return out


func start_line_edit() -> void:
	var pts := line_source()
	if pts.is_empty():
		ed.status("There is no line to edit: draw one, or draw the track with nodes.", "error")
		return
	var nodes: Array = []
	var last: Variant = null
	for p in pts:
		if last == null or Vector2(float(p["x"]) - last["x"], float(p["z"]) - last["z"]).length() >= 8.0:
			nodes.append({"x": float(p["x"]), "y": float(p.get("y", 0)), "z": float(p["z"])})
			last = nodes[-1]
	if nodes.size() > 3 and Vector2(nodes[0]["x"] - nodes[-1]["x"], nodes[0]["z"] - nodes[-1]["z"]).length() < 8.0 * 0.6:
		nodes.pop_back()
	if nodes.size() < 4:
		ed.status("The line is too short to edit.", "error")
		return
	ed.line_edit = {"editing": true, "drawing": false, "nodes": nodes, "selected": -1, "start": JSON.stringify(nodes)}
	ed.select("")
	ed.status("Editing the line: drag a node. Shift + click on the road adds a node, Delete takes the chosen one away.", "ok")


func start_line_draw() -> void:
	ed.line_edit = {"editing": true, "drawing": true, "nodes": [], "selected": -1, "start": "[]"}
	ed.select("")
	ed.status("Draw the line: click on the road, node after node, in the direction that the AI drives (four at least). Apply line saves it.", "ok")


func stop_line_edit() -> void:
	ed.line_edit = {"editing": false, "drawing": false, "nodes": [], "selected": -1, "start": ""}
	ed.refresh()


func line_click(pos: Vector2, shift: bool) -> void:
	var road := ed.road_hit(pos)
	if road.is_empty():
		ed.line_edit["selected"] = -1
		ed.refresh()
		return
	var p: Vector3 = road["point"]
	if ed.line_edit["drawing"] and not shift:
		(ed.line_edit["nodes"] as Array).append({"x": p.x, "y": p.y, "z": p.z})
		ed.refresh()
	elif shift:
		add_line_node_at(p.x, p.z)
	else:
		ed.line_edit["selected"] = -1
		ed.refresh()


func add_line_node_at(x: float, z: float) -> void:
	var nodes: Array = ed.line_edit["nodes"]
	if nodes.is_empty():
		return
	var best := 0
	var best_d := INF
	for i in nodes.size():
		var a: Dictionary = nodes[i]
		var b: Dictionary = nodes[(i + 1) % nodes.size()]
		var d := TrackEditorInput.seg_dist(Vector2(x, z), Vector2(a["x"], a["z"]), Vector2(b["x"], b["z"]))
		if d < best_d:
			best_d = d
			best = i
	nodes.insert(best + 1, {"x": x, "y": ed.ground_y(x, z, nodes[best]["y"]), "z": z})
	ed.line_edit["selected"] = best + 1
	ed.refresh()


func delete_line_node() -> void:
	var le := ed.line_edit
	var nodes: Array = le["nodes"]
	if le["selected"] < 0:
		return
	if not le["drawing"] and nodes.size() <= 4:
		ed.status("A line needs at least four nodes.", "error")
		return
	nodes.remove_at(le["selected"])
	le["selected"] = -1
	ed.refresh()


## The line through the nodes: a point every 2 m on the road, as track.json "racing_line".
func line_json() -> Array:
	var curve := _line_curve(ed.line_edit["nodes"])
	var count := maxi(32, roundi(curve.length() / 2.0))
	var pts := curve.spaced_points(count)
	var out: Array = []
	for i in count:
		var v := pts[i]
		out.append({"x": roundf(v.x * 100) / 100, "y": roundf(ed.ground_y(v.x, v.z, v.y) * 100) / 100, "z": roundf(v.z * 100) / 100})
	return out
