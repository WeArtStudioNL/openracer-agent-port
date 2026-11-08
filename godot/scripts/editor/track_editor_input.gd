class_name TrackEditorInput
extends RefCounted
## The pointer and the keys of the track editor (track-editor.js and track-design.js): the camera (left drag turns, right drag
## moves, the wheel zooms to the pointer), the tools that put things on the road (press and drag for the direction), the
## handles of what is chosen (the middle moves it, the ring turns it, the square scales it, the arrow lifts a node of the road),
## the curbs, the racing line, and the nodes, branches, surfaces and prefabs of a road drawn with nodes.

const CLICK := 4.0

var ed: TrackEditor
var _press := {}                    # the button that is down: { pos, moved, kind, ... }
var _orbit := false
var _pan := false
var _last_pos := Vector2.ZERO
var _coords_time := 0


func _init(editor: TrackEditor) -> void:
	ed = editor


func view_event(e: InputEvent) -> void:
	if e is InputEventMouseButton:
		var b := e as InputEventMouseButton
		ed.view_box.grab_focus()
		if b.button_index == MOUSE_BUTTON_WHEEL_UP or b.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			if b.pressed:
				_zoom(b.position, 0.88 if b.button_index == MOUSE_BUTTON_WHEEL_UP else 1.0 / 0.88)
			return
		if b.button_index == MOUSE_BUTTON_RIGHT:
			_pan = b.pressed
			_last_pos = b.position
			return
		if b.button_index == MOUSE_BUTTON_MIDDLE:
			_orbit = b.pressed
			_last_pos = b.position
			return
		if b.button_index == MOUSE_BUTTON_LEFT:
			if b.pressed:
				_down(b.position, b.shift_pressed)
			else:
				_up(b.position, b.shift_pressed)
	elif e is InputEventMagnifyGesture:
		_zoom((e as InputEventMagnifyGesture).position, 1.0 / (e as InputEventMagnifyGesture).factor)
	elif e is InputEventPanGesture:
		_zoom((e as InputEventPanGesture).position, 1.0 + (e as InputEventPanGesture).delta.y * 0.05)
	elif e is InputEventMouseMotion:
		var m := e as InputEventMouseMotion
		var d := m.position - _last_pos
		_last_pos = m.position
		if _pan:
			_do_pan(d)
		elif _orbit:
			ed.yaw -= d.x * 0.006
			ed.pitch = clampf(ed.pitch + d.y * 0.006, 0.05, 1.5607)
		elif not _press.is_empty():
			_move(m.position)
		_coords(m.position)


func _zoom(pos: Vector2, factor: float) -> void:
	# (zoom-to-mouse.js: the point under the pointer stays under it)
	var hit := ed.road_hit(pos)
	var r := ed.ray_of(pos)
	var p: Variant = hit.get("point", Plane(Vector3.UP, ed.target.y).intersects_ray(r[0], r[1]))
	ed.distance = clampf(ed.distance * factor, 2.0, ed.camera.far * 0.5)
	if p != null:
		ed.target += ((p as Vector3) - ed.target) * (1.0 - factor)


func _do_pan(d: Vector2) -> void:
	var k := ed.distance * 2.0 * tan(deg_to_rad(ed.camera.fov) / 2.0) / maxf(1.0, ed.view_box.size.y)
	var right := ed.camera.global_transform.basis.x
	var fwd := -ed.camera.global_transform.basis.z
	fwd.y = 0.0
	if fwd.length() < 0.01:
		fwd = -ed.camera.global_transform.basis.y
		fwd.y = 0.0
	fwd = fwd.normalized()
	ed.target += (-right * d.x + fwd * d.y) * k


func _coords(pos: Vector2) -> void:
	var now := Time.get_ticks_msec()
	if now - _coords_time < 80 or not _press.is_empty():
		return
	_coords_time = now
	var p: Variant = ed.surface_point(pos, ed.ground_y(ed.target.x, ed.target.z), 5)
	ed.ui["coords"].text = "x %.1f   z %.1f   y %.2f" % [p.x, p.z, p.y] if p != null else ""


# ---- the press, the drag and the release

func _down(pos: Vector2, shift: bool) -> void:
	_press = {"pos": pos, "moved": false, "shift": shift, "kind": ""}
	var handle := ed.markers.handle_hit(pos)
	if not handle.is_empty():
		_press["kind"] = "handle"
		_press["handle"] = handle
		_start_handle(pos, handle)
		return
	var dot := ed.markers.dot_hit(pos)
	if not dot.is_empty() and _dot_press(pos, dot):
		return
	var m := ed.mode
	if m in ["grid", "pitbox", "gate", "drag", "camera", "object"]:
		var hit := ed.road_hit(pos)
		if not hit.is_empty():
			_press["kind"] = "place"
			_press["hit"] = hit["point"]
			return
	elif m in ["pitline", "curb", "measure", "node", "patch", "branch", "refscale"] or ed.line_edit["editing"]:
		_press["kind"] = "click"
		return
	elif m == "prefab":
		if ed.prefab_style == "points":
			_press["kind"] = "click"
		else:
			var g: Variant = ed.road.ground_point(pos)
			_press["kind"] = "stroke"
			_press["stroke"] = [] if g == null else [Vector2(g.x, g.z)]
		return
	# Look: a press on the chosen prefab, a node of the road or a row moves it; anything else turns the view (a click chooses)
	if m == "view" and ed.sel["kind"] == "prefab":
		var hit := ed.road_hit(pos)
		var pi := ed.markers.prefab_at(pos)
		if pi == ed.sel["i"] and not hit.is_empty():
			_press["kind"] = "prefab"
			_start_prefab(pos, pi)
			return
	_press["kind"] = "look"
	_orbit = true


func _dot_press(pos: Vector2, dot: Dictionary) -> bool:
	var k: String = dot["kind"]
	var q := {}                      # the point that is dragged: its place and its height
	match k:
		"curbnode":
			ed.select("curb", dot["i"], dot["node"])
			_press["dot"] = dot
		"dnode":
			if not (ed.mode in ["view", "node"]):
				return false
			ed.select("dnode", dot["i"])
			q = ed.design.data["nodes"][dot["i"]]
		"rowpoint":
			ed.sel["node"] = dot["node"]
			q = ed.design.data["prefabs"][ed.sel["i"]]["points"][dot["node"]]
		"patchpoint", "branchnode":
			ed.sel["node"] = dot["node"]
			var it: Dictionary = ed.design.data["patches" if k == "patchpoint" else "branches"][ed.sel["i"]]
			q = it["points" if k == "patchpoint" else "nodes"][dot["node"]]
		"linenode":
			if not ed.line_edit["editing"]:
				return false
			ed.line_edit["selected"] = dot["i"]
			q = ed.line_edit["nodes"][dot["i"]]
		"pitline":
			ed.select("pitline", dot["i"])
			k = "boxdot"
		"range":
			_press["which"] = dot["node"]
			_press["y"] = float(dot.get("y", 0))
		_:
			return false
	_press["kind"] = k
	if not q.is_empty():
		var y := ed.ground_y(float(q["x"]), float(q["z"])) if k in ["patchpoint", "branchnode"] else float(q.get("y", 0))
		_press["y"] = y
		_press["offset"] = _grab(pos, float(q["x"]), float(q["z"]), y)
		ed.refresh()
	return true


## The distance from where the pointer grabbed a thing to its middle (with Snap the thing goes to the grid instead).
func _grab(pos: Vector2, x: float, z: float, y: float) -> Vector2:
	var p: Variant = ed.plane_point(pos, y)
	return Vector2(x - p.x, z - p.z) if p != null and ed.snap == 0.0 else Vector2.ZERO


func _move(pos: Vector2) -> void:
	if not _press["moved"] and (pos - (_press["pos"] as Vector2)).length() > CLICK:
		_press["moved"] = true
	if not _press["moved"]:
		return
	match _press["kind"]:
		"handle":
			_drag_handle(pos)
		"place":
			var p0: Vector3 = _press["hit"]
			var p: Variant = ed.plane_point(pos, p0.y)
			if p != null and Vector2(p.x - p0.x, p.z - p0.z).length() > 0.5:
				_press["heading"] = atan2(p.z - p0.z, p.x - p0.x)
				_place(true)
		"curbnode":
			var c: Dictionary = ed.curbs[_press["dot"]["i"]]
			var n: Array = c["nodes"][_press["dot"]["node"]]
			var p: Variant = ed.surface_point(pos, n[1])
			if p != null:
				n[0] = p.x
				n[1] = p.y
				n[2] = p.z
				if c.get("connect", false):
					ed.curbs_kit.snap_curb_node(n)
				ed.curbs_kit.build_curb(_press["dot"]["i"])
				ed.markers.rebuild()
		"dnode":
			var p: Variant = ed.plane_point(pos, _press["y"])
			if p != null:
				var n: Dictionary = ed.design.data["nodes"][ed.sel["i"]]
				n["x"] = TrackDesign.r2(p.x + _press["offset"].x)
				n["z"] = TrackDesign.r2(p.z + _press["offset"].y)
				ed.rebuild_design(false)
				ed.markers.rebuild()
		"rowpoint":
			var p: Variant = ed.plane_point(pos, _press["y"])
			if p != null:
				var row: Dictionary = ed.design.data["prefabs"][ed.sel["i"]]
				var q: Dictionary = row["points"][ed.sel["node"]]
				q["x"] = TrackDesign.r2(p.x + _press["offset"].x)
				q["z"] = TrackDesign.r2(p.z + _press["offset"].y)
				q["y"] = TrackDesign.r2(ed.design.surface_at(q["x"], q["z"])["y"])
				ed.road.refresh_prefabs()
		"patchpoint", "branchnode":
			var p: Variant = ed.plane_point(pos, _press["y"])
			if p != null:
				var k: String = _press["kind"]
				var item: Dictionary = ed.design.data["patches" if k == "patchpoint" else "branches"][ed.sel["i"]]
				var q: Dictionary = item["points" if k == "patchpoint" else "nodes"][ed.sel["node"]]
				q["x"] = TrackDesign.r2(p.x + _press["offset"].x)
				q["z"] = TrackDesign.r2(p.z + _press["offset"].y)
				if k == "branchnode":
					if ed.sel["node"] == 0:
						item["start"] = null
					if ed.sel["node"] == (item["nodes"] as Array).size() - 1:
						item["end"] = null
					ed.rebuild_design(false)
				else:
					ed.design.build_patches()
					ed.parts_kit.design_parts_changed()
				ed.markers.rebuild()
		"linenode":
			var p: Variant = ed.plane_point(pos, _press["y"])
			if p != null:
				var n: Dictionary = ed.line_edit["nodes"][ed.line_edit["selected"]]
				n["x"] = p.x + _press["offset"].x
				n["z"] = p.z + _press["offset"].y
				n["y"] = ed.ground_y(n["x"], n["z"], n["y"])
				ed.markers.rebuild()
		"range":
			var c: Dictionary = ed.cameras[ed.sel["i"]]
			var p: Variant = ed.plane_point(pos, _press["y"])
			if p != null:
				var r: Dictionary = c.get("range", {"x": c["x"], "z": c["z"], "r": 30.0})
				if _press["which"] == 0:
					c["range"] = {"x": p.x, "z": p.z, "r": r["r"]}
				else:
					c["range"] = {"x": r["x"], "z": r["z"], "r": maxf(2.0, Vector2(p.x - r["x"], p.z - r["z"]).length())}
				ed.markers.rebuild()
		"prefab":
			_drag_prefab(pos)
		"stroke":
			var g: Variant = ed.road.ground_point(pos)
			if g != null:
				var st: Array = _press["stroke"]
				if st.is_empty() or (st[-1] as Vector2).distance_to(Vector2(g.x, g.z)) > 1.5:
					st.append(Vector2(g.x, g.z))
					ed.markers.stroke = st
					ed.markers.rebuild()
		"look":
			pass


func _up(pos: Vector2, shift: bool) -> void:
	_orbit = false
	var p := _press
	_press = {}
	if p.is_empty():
		return
	var moved: bool = p["moved"]
	match p["kind"]:
		"handle":
			if moved:
				if ed.sel["kind"] == "dnode":
					ed.rebuild_design(true)
				elif ed.sel["kind"] == "prefab":
					ed.road.refresh_prefabs()
			ed.changed()
		"place":
			if not p.has("added"):
				_press = p
				_place(false)
				_press = {}
			ed.changed()
		"curbnode", "linenode", "range", "boxdot":
			ed.changed()
		"dnode":
			if moved:
				ed.rebuild_design(true)
			ed.changed()
		"rowpoint":
			ed.changed()
		"patchpoint", "branchnode":
			if p["kind"] == "patchpoint" and not moved and ed.drawing.get("kind", "") == "patch" and ed.sel["node"] == 0 \
					and (ed.design.data["patches"][ed.drawing["index"]]["points"] as Array).size() >= 3:
				ed.road.finish_drawing()
				return
			if moved and p["kind"] == "branchnode":
				ed.road.snap_branch_end()
			ed.rebuild_design(true)
			ed.changed()
		"prefab":
			if moved:
				ed.road.refresh_prefabs()
				ed.changed()
		"stroke":
			ed.markers.stroke = []
			var st: Array = p["stroke"]
			if not moved or TrackEditorRoad._stroke_length(st) < 2.0:
				var g: Variant = ed.road.ground_point(pos)
				if g != null:
					ed.road.add_prefab(g.x, g.z)
			else:
				ed.road.add_row(TrackEditorRoad._simplify(st, 1.5))
		"click":
			if not moved:
				_click(pos, shift)
		"look":
			if not moved:
				_look_click(pos)


# ---- the tools that put a thing on the road (press on the road, drag for the direction)

func _place(preview: bool) -> void:
	var point: Vector3 = _press["hit"]
	var start := ed.sync_start()
	var h: float = _press.get("heading", start.get("heading", 0.0))
	var added: bool = _press.has("added")
	match ed.mode:
		"grid", "pitbox":
			var list: Array = ed.grid if ed.mode == "grid" else ed.pit_boxes
			if _press.has("full"):
				return
			if preview and added:
				list.pop_back()
			if list.size() >= TrackEditor.GRID_MAX:
				ed.status("The grid has its 8 boxes: remove one first." if ed.mode == "grid" else "There are 8 pit boxes: remove one first.", "error")
				_press["full"] = true
				return
			list.append({"x": point.x, "y": point.y, "z": point.z, "heading": h})
		"gate":
			if preview and added:
				ed.gates.pop_back()
			ed.gates.append({"x": point.x, "y": point.y, "z": point.z, "heading": h, "width": maxf(2.0, ed.gate_width)})
		"drag":
			ed.drag = {"x": point.x, "y": point.y, "z": point.z, "heading": h, "width": TrackEditorUI.drag_width(ed), "length": TrackEditorUI.drag_length(ed)}
		"camera":
			if not added:
				ed.cameras.append({"x": point.x, "y": point.y + TrackEditorUI.camera_height(ed), "z": point.z})
		"object":
			if ed.object_model == "" or not ed.models.has(ed.object_model):
				ed.status("Add a model in the Objects card and choose Place first.", "error")
				_press["added"] = true
				return
			if preview and added:
				ed.objects.pop_back()
			ed.objects.append({"model": ed.object_model, "x": point.x, "y": point.y, "z": point.z, "heading": h, "pitch": 0.0, "roll": 0.0,
				"sx": 1.0, "sy": 1.0, "sz": 1.0})
			ed.parts_kit.show_objects()
	_press["added"] = true
	ed.refresh()


## A click with a tool that is not a press and a drag.
func _click(pos: Vector2, shift: bool) -> void:
	if ed.line_edit["editing"]:
		ed.line.line_click(pos, shift)
		return
	match ed.mode:
		"pitline":
			var hit := ed.road_hit(pos)
			if not hit.is_empty():
				var p: Vector3 = hit["point"]
				ed.pit_line.append({"x": p.x, "y": p.y, "z": p.z})
				ed.changed()
		"curb":
			ed.curbs_kit.curb_click(pos)
		"measure":
			var hit := ed.road_hit(pos)
			var p: Variant = hit.get("point")
			if p == null:
				var r := ed.ray_of(pos)
				p = Plane(Vector3.UP, ed.target.y).intersects_ray(r[0], r[1])
			if p != null:
				ed.measure_points.append(p)
				ed.refresh()
		"refscale":
			TrackEditorIO.ref_scale_click(ed, pos)
		"node":
			var g: Variant = ed.road.ground_point(pos)
			if g != null:
				ed.road.add_node(g.x, g.z)
		"prefab":
			var g: Variant = ed.road.ground_point(pos)
			if g != null:
				ed.draft.append({"x": TrackDesign.r2(g.x), "z": TrackDesign.r2(g.z)})
				ed.drawing = {"kind": "rowdraft"}
				ed.markers.stroke = ed.draft.map(func(q: Dictionary) -> Vector2: return Vector2(q["x"], q["z"]))
				ed.status("Row: %d points. Enter ends it." % ed.draft.size(), "ok")
				ed.refresh()
		"patch":
			ed.road.patch_click(pos)
		"branch":
			ed.road.branch_click(pos)


## Look: what is clicked is chosen, and nothing else.
func _look_click(pos: Vector2) -> void:
	if ed.sel["kind"] == "curb":
		var strip := ed.markers.curb_strip_hit(pos)
		if not strip.is_empty() and strip["i"] == ed.sel["i"]:
			ed.curbs_kit.insert_curb_node(strip["point"])
			return
	if ed.sel["kind"] == "prefab" and ed.design != null:
		var row: Dictionary = ed.design.data["prefabs"][ed.sel["i"]]
		if row.get("row", false):
			var at := ed.markers.row_line_hit(pos, row)
			if not at.is_empty():
				ed.road.insert_row_point(at)
				return
	var pick := ed.markers.pick(pos)
	if not pick.is_empty():
		if pick["kind"] == "camera" and ed.sel["kind"] == "camera" and ed.sel["i"] == pick["i"]:
			return
		ed.select(pick["kind"], pick["i"], pick.get("node", -1))
		if pick["kind"] in ["patch", "branch"]:
			ed.mode = pick["kind"]
			ed.refresh()
		return
	if ed.design != null:
		ed.select("")
		return
	var part := ed.part_at(pos)
	ed.select("part" if part != "" else "")
	ed.selected_part = part
	ed.parts_kit.apply_colours()
	TrackEditorUI.refresh(ed)


# ---- the handles of what is chosen: the middle moves it, the ring turns it, the square scales it, the arrow lifts it

func item() -> Dictionary:
	var lists := {"grid": ed.grid, "pit": ed.pit_boxes, "pitline": ed.pit_line, "gate": ed.gates, "object": ed.objects, "camera": ed.cameras}
	var k: String = ed.sel["kind"]
	var i: int = ed.sel["i"]
	var out := {}
	if lists.has(k) and i >= 0 and i < (lists[k] as Array).size():
		out = lists[k][i]
	elif k == "drag":
		out = ed.drag
	elif ed.design != null and k == "dnode" and i < (ed.design.data["nodes"] as Array).size():
		out = ed.design.data["nodes"][i]
	elif ed.design != null and k == "prefab" and i < (ed.design.data["prefabs"] as Array).size():
		out = ed.design.data["prefabs"][i]
	return out


## The middle of what is chosen (for its handles), or null.
func chosen_point() -> Variant:
	var it := item()
	if it.is_empty() or (ed.sel["kind"] == "prefab" and it.get("row", false)):
		return null
	return Vector3(float(it["x"]), float(it.get("y", 0)), float(it["z"]))


## The direction of what is chosen in the angles of track.json (from +x towards +z), or null when it has none.
static func heading_of(kind: String, it: Dictionary) -> Variant:
	match kind:
		"grid", "pit", "gate", "object", "drag":
			return float(it.get("heading", 0))
		"prefab":
			return -float(it.get("rotation", 0))
	return null


func _start_handle(pos: Vector2, handle: Dictionary) -> void:
	var it := item()
	var c: Vector3 = chosen_point()
	_press["it0"] = it.duplicate(true)
	_press["c"] = c
	var p: Variant = ed.plane_point(pos, c.y)
	_press["p0"] = p if p != null else c
	_press["offset"] = _grab(pos, c.x, c.z, c.y)
	if ed.sel["kind"] == "camera":
		_press["above"] = c.y - ed.ground_y(c.x, c.z, c.y)
	ed.gizmo_mode = handle["kind"]


func _drag_handle(pos: Vector2) -> void:
	var kind: String = _press["handle"]["kind"]
	var it := item()
	var it0: Dictionary = _press["it0"]
	var c: Vector3 = _press["c"]
	var sk: String = ed.sel["kind"]
	if kind == "height":
		var k := ed.distance * 2.0 * tan(deg_to_rad(ed.camera.fov) / 2.0) / maxf(1.0, ed.view_box.size.y)
		it["y"] = TrackDesign.r2(float(it0["y"]) - (pos.y - (_press["pos"] as Vector2).y) * k)
		ed.rebuild_design(false)
		ed.markers.rebuild()
		TrackEditorUI.refresh(ed)
		return
	var p: Variant = ed.plane_point(pos, c.y)
	if p == null:
		return
	if kind == "move":
		var x: float = p.x + _press["offset"].x
		var z: float = p.z + _press["offset"].y
		if sk in ["dnode", "prefab"]:
			it["x"] = TrackDesign.r2(x)
			it["z"] = TrackDesign.r2(z)
		else:
			it["x"] = x
			it["z"] = z
		match sk:
			"camera":
				it["y"] = ed.ground_y(x, z, c.y) + float(_press["above"])
			"dnode":
				ed.rebuild_design(false)
			"prefab":
				ed.road.refresh_prefabs()
			_:
				it["y"] = ed.ground_y(x, z, c.y)
	elif kind == "turn":
		var p0: Vector3 = _press["p0"]
		var a := atan2(p.z - c.z, p.x - c.x) - atan2(p0.z - c.z, p0.x - c.x)
		if sk == "prefab":
			it["rotation"] = TrackDesign.r2(float(it0.get("rotation", 0)) - a)
			ed.road.refresh_prefabs()
		else:
			it["heading"] = float(it0.get("heading", 0)) + a
	elif kind == "scale":
		var p0: Vector3 = _press["p0"]
		var ratio := Vector2(p.x - c.x, p.z - c.z).length() / maxf(0.01, Vector2(p0.x - c.x, p0.z - c.z).length())
		match sk:
			"gate":
				it["width"] = clampf(roundf(float(it0["width"]) * ratio * 10.0) / 10.0, 2.0, 400.0)
			"drag":
				it["width"] = maxf(3.0, roundf(float(it0["width"]) * ratio))
			"object":
				for a in ["sx", "sy", "sz"]:
					it[a] = maxf(0.01, float(it0[a]) * ratio)
			"prefab":
				it["scale"] = maxf(0.1, TrackDesign.r2(float(it0.get("scale", 1)) * ratio))
				ed.road.refresh_prefabs()
	if sk == "object":
		ed.parts_kit.show_objects()
	ed.markers.rebuild()
	TrackEditorUI.refresh(ed)


static func seg_dist(p: Vector2, a: Vector2, b: Vector2) -> float:
	var d := b - a
	var t := clampf((p - a).dot(d) / maxf(d.length_squared(), 1e-9), 0.0, 1.0)
	return p.distance_to(a + d * t)


func _start_prefab(pos: Vector2, i: int) -> void:
	var p: Dictionary = ed.design.data["prefabs"][i]
	var y: float = float(p["points"][0].get("y", 0)) if p.get("row", false) else float(p.get("y", 0))
	var ox: float = float(p["points"][0]["x"]) if p.get("row", false) else float(p["x"])
	var oz: float = float(p["points"][0]["z"]) if p.get("row", false) else float(p["z"])
	_press["y"] = y
	_press["offset"] = _grab(pos, ox, oz, y)
	_press["origin"] = (p["points"] as Array).duplicate(true) if p.get("row", false) else []


func _drag_prefab(pos: Vector2) -> void:
	var pp: Variant = ed.plane_point(pos, _press["y"])
	if pp == null:
		return
	var p: Dictionary = ed.design.data["prefabs"][ed.sel["i"]]
	if p.get("row", false):
		var o: Array = _press["origin"]
		var dx: float = pp.x + _press["offset"].x - float(o[0]["x"])
		var dz: float = pp.z + _press["offset"].y - float(o[0]["z"])
		for k in o.size():
			p["points"][k]["x"] = TrackDesign.r2(float(o[k]["x"]) + dx)
			p["points"][k]["z"] = TrackDesign.r2(float(o[k]["z"]) + dz)
		ed.design.snap_row(p)
	else:
		p["x"] = TrackDesign.r2(pp.x + _press["offset"].x)
		p["z"] = TrackDesign.r2(pp.z + _press["offset"].y)
	ed.road.refresh_prefabs()


# ---- the keys (track-editor.js, in this order: Ctrl+S, Ctrl+Z/Y, Ctrl+D, Delete, Escape, Enter, ?, the tools, F, T, End, W E R)

func key(e: InputEventKey) -> bool:
	var focus := ed.get_viewport().gui_get_focus_owner()
	var typing := focus is LineEdit or focus is TextEdit or (focus is SpinBox)
	var ctrl := e.ctrl_pressed or e.meta_pressed
	if ctrl and e.keycode == KEY_S:
		TrackEditorIO.save(ed)
		return true
	if typing or e.alt_pressed:
		return false
	if ctrl:
		return _ctrl_key(e)
	var handled := true
	match e.keycode:
		KEY_DELETE, KEY_BACKSPACE:
			if delete_chosen():
				ed.changed()
		KEY_ESCAPE:
			escape_step()
		KEY_ENTER, KEY_KP_ENTER:
			if not ed.drawing.is_empty():
				ed.road.finish_drawing()
			elif ed.mode == "curb" and ed.sel["kind"] == "curb":
				ed.curbs_kit.end_curb_draw()
				ed.select("")
		KEY_SLASH:
			TrackEditorUI.toggle_help(ed)
		_:
			handled = not ed.line_edit["editing"] and _tool_key(e.keycode)
	return handled


func _ctrl_key(e: InputEventKey) -> bool:
	var handled := true
	if e.keycode == KEY_Z and not e.shift_pressed:
		ed.history.undo()
	elif e.keycode == KEY_Z or e.keycode == KEY_Y:
		ed.history.redo()
	elif e.keycode == KEY_D:
		handled = duplicate_chosen()
	else:
		handled = false
	return handled


## The keys of the tools (1 to 0, N B G P), F, T, End and W E R.
func _tool_key(code: Key) -> bool:
	var modes := {KEY_1: "view", KEY_2: "grid", KEY_3: "pitbox", KEY_4: "pitline", KEY_5: "gate", KEY_6: "drag", KEY_7: "object", KEY_8: "camera",
		KEY_9: "curb", KEY_0: "measure", KEY_N: "node", KEY_B: "branch", KEY_G: "patch", KEY_P: "prefab"}
	var handled := true
	if modes.has(code):
		ed.set_mode(modes[code])
	elif code == KEY_F:
		frame_chosen()
	elif code == KEY_T:
		ed.parts_kit.top_view()
	elif code == KEY_END:
		var it := item()
		if not it.is_empty() and it.has("x") and ed.sel["kind"] in ["object", "gate", "grid", "pit", "pitline", "drag"]:
			it["y"] = ed.ground_y(float(it["x"]), float(it["z"]), float(it.get("y", 0)) + 20.0)
			ed.parts_kit.show_objects()
			ed.changed()
	elif code == KEY_W or code == KEY_E or code == KEY_R:
		ed.set_gizmo_mode({KEY_W: "move", KEY_E: "turn", KEY_R: "scale"}[code])
	else:
		handled = false
	return handled


## Escape: one step back at a time (the help, the measure, the line, what is drawn, what is chosen, then the tool).
func escape_step() -> void:
	if ed.ui.has("help") and (ed.ui["help"] as Control).visible:
		TrackEditorUI.toggle_help(ed)
	elif ed.mode == "measure":
		ed.measure_points.clear()
		ed.set_mode("view")
	elif ed.line_edit["editing"]:
		if ed.line_edit["selected"] >= 0:
			ed.line_edit["selected"] = -1
			ed.refresh()
		else:
			TrackEditorUI.cancel_line(ed)
	elif not ed.drawing.is_empty():
		ed.road.finish_drawing()
	elif ed.chosen():
		if ed.mode == "curb":
			ed.curbs_kit.end_curb_draw()
		ed.select("")
	elif ed.mode != "view":
		ed.set_mode("view")


## Delete: the chosen thing goes (Ctrl+Z brings it back).
func delete_chosen() -> bool:
	var k: String = ed.sel["kind"]
	var i: int = ed.sel["i"]
	var lists := {"object": ed.objects, "gate": ed.gates, "grid": ed.grid, "pit": ed.pit_boxes, "pitline": ed.pit_line, "camera": ed.cameras}
	var done := true
	if ed.line_edit["editing"]:
		ed.line.delete_line_node()
	elif k == "curb" and ed.sel["node"] >= 0:
		done = ed.curbs_kit.delete_curb_node()
	elif k == "curb":
		ed.curbs_kit.remove_curb(i)
	elif lists.has(k):
		(lists[k] as Array).remove_at(i)
		ed.parts_kit.show_objects()
		ed.select("")
	elif k == "drag":
		ed.drag = {}
		ed.select("")
	elif k == "dnode":
		ed.road.delete_node()
	elif k == "prefab":
		ed.road.delete_prefab()
	elif k == "patch" or k == "branch":
		ed.road.delete_extra_point()
	elif not ed.drawing.is_empty():
		ed.road.finish_drawing()
	else:
		done = false
	return done


## Ctrl+D: a copy of the chosen object (3 m aside), gate (20 m further), curb (2 m aside) or prefab.
func duplicate_chosen() -> bool:
	var k: String = ed.sel["kind"]
	var i: int = ed.sel["i"]
	match k:
		"object":
			var o: Dictionary = (ed.objects[i] as Dictionary).duplicate()
			o["x"] = float(o["x"]) + 3.0
			o["y"] = ed.ground_y(o["x"], o["z"], o["y"])
			ed.objects.append(o)
			ed.parts_kit.show_objects()
			ed.select("object", ed.objects.size() - 1)
		"gate":
			var g: Dictionary = (ed.gates[i] as Dictionary).duplicate()
			g["x"] = float(g["x"]) + cos(g["heading"]) * 20.0
			g["z"] = float(g["z"]) + sin(g["heading"]) * 20.0
			g["y"] = ed.ground_y(g["x"], g["z"], g["y"])
			ed.gates.insert(i + 1, g)
			ed.select("gate", i + 1)
		"curb":
			var c: Dictionary = ed.curbs[i]
			var nodes: Array = (c["nodes"] as Array).map(func(n: Array) -> Array: return [n[0] + 2.0, ed.ground_y(n[0] + 2.0, n[2], n[1]), n[2]])
			ed.curbs.append({"nodes": nodes, "width": c["width"], "height": c["height"], "colour": c["colour"], "points": [], "segments": [], "mesh": null})
			ed.curbs_kit.build_curb(ed.curbs.size() - 1)
			ed.select("curb", ed.curbs.size() - 1)
		"prefab":
			ed.road.duplicate_prefab()
		_:
			return false
	ed.changed()
	return true


## F: the view turns to the chosen thing (nothing chosen: the whole track).
func frame_chosen() -> void:
	var p: Variant = chosen_point()
	if p == null and ed.sel["kind"] == "curb":
		var n: Array = ed.curbs[ed.sel["i"]]["nodes"][maxi(0, ed.sel["node"])]
		p = Vector3(n[0], n[1], n[2])
	if p == null:
		ed.parts_kit.frame_track()
		return
	ed.target = p
	ed.distance = clampf(ed.distance, 15.0, 120.0)
