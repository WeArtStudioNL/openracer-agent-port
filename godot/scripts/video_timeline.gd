class_name VideoTimeline
extends Control
## The timeline of the video editor (VideoEditor.js renderTimeline): the ruler, the lane of the clips and the lane
## of the camera keys, and the playhead. A click in the lanes puts the playhead there (dragged: it scrubs); a click
## on a clip selects it; the handles at the edges of a clip trim it (its In or Out earlier or later in the source,
## the clips after it move with it); the keys of a clip are drawn in it (the speed yellow dots, the zoom blue
## diamonds, the look ahead green triangles, each with its curve) and are dragged along (when) and up and down (the
## value); a camera key (a green diamond, round when it goes with the car) is clicked to go there and double
## clicked to edit it with the free camera.

const RULER := 22.0
const CLIP_Y := 36.0
const CLIP_H := 38.0
const CAM_Y := 78.0
const CAM_H := 50.0
const RAMP_TOP := 3.0
const RAMP_H := 30.0
const MIN_CLIP := 0.1
const KINDS := {
	"speed": {"keys": "keys", "field": "speed", "plain": "speed", "lo": 0.05, "hi": 8.0, "colour": Color("ffd04d"), "linear": false},
	"zoom": {"keys": "zoomKeys", "field": "zoom", "plain": "zoom", "lo": 0.5, "hi": 4.0, "colour": Color("5ec8ff"), "linear": false},
	"lead": {"keys": "leadKeys", "field": "lead", "plain": "lead", "lo": 0.0, "hi": 40.0, "colour": Color("7ee787"), "linear": true},
}

var ed: VideoEditor
var _drag := {}                     # what is dragged: {"kind": "head" | "trim" | "key", …}


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	clip_contents = true


static func scale_y(value: float, lo: float, hi: float, linear: bool) -> float:
	if linear:
		return RAMP_TOP + (1.0 - (clampf(value, lo, hi) - lo) / (hi - lo)) * RAMP_H
	return RAMP_TOP + (1.0 - (log(clampf(value, lo, hi)) - log(lo)) / (log(hi) - log(lo))) * RAMP_H


static func scale_value(y: float, lo: float, hi: float, linear: bool) -> float:
	var f := 1.0 - (y - RAMP_TOP) / RAMP_H
	if linear:
		return clampf(lo + f * (hi - lo), lo, hi)
	return clampf(exp(log(lo) + f * (log(hi) - log(lo))), lo, hi)


func _draw() -> void:
	var font := ThemeDB.fallback_font
	var sc: float = ed.scale_px
	draw_rect(Rect2(Vector2.ZERO, size), Color("0e1217"))
	# the ruler
	draw_rect(Rect2(0, 0, size.x, RULER), Color("12171d"))
	var step := 120.0
	for s in [0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0, 120.0]:
		if s * sc >= 60.0:
			step = s
			break
	var t := 0.0
	while t * sc < size.x:
		draw_line(Vector2(t * sc, 0), Vector2(t * sc, RULER), Color("39424e"))
		draw_string(font, Vector2(t * sc + 4, 15), VideoEditor.fmt(t).trim_suffix(".00"), HORIZONTAL_ALIGNMENT_LEFT, -1, 10, Color("8e9cb8"))
		t += step
	draw_line(Vector2(0, RULER), Vector2(size.x, RULER), Color("2b333d"))
	draw_line(Vector2(0, CAM_Y), Vector2(size.x, CAM_Y), Color("162036"))
	draw_line(Vector2(0, CAM_Y + CAM_H), Vector2(size.x, CAM_Y + CAM_H), Color("162036"))
	draw_string(font, Vector2(4, RULER + 11), "CLIPS", HORIZONTAL_ALIGNMENT_LEFT, -1, 10, Color("8e9cb8"))
	draw_string(font, Vector2(4, CAM_Y + 11), "CAMERA", HORIZONTAL_ALIGNMENT_LEFT, -1, 10, Color("8e9cb8"))
	# the clips
	var starts: Array = ed.starts()
	for i in ed.clips.size():
		var clip: Dictionary = ed.clips[i]
		var r := Rect2(starts[i] * sc, CLIP_Y, maxf(6.0, clip["duration"] * sc - 2.0), CLIP_H)
		var sel: bool = i == ed.selected
		draw_rect(r, Color("35618c") if sel else Color("2a4a6b"))
		draw_rect(r, Color("3d7bff") if sel else Color("4a7aa6"), false, 1.0)
		var l1 := "%d · %s – %s" % [i + 1, VideoEditor.fmt(clip["in"]), VideoEditor.fmt(clip["out"])]
		var keys: Array = clip["keys"]
		var l2 := "×%s · %.2f s" % [str(snappedf(clip["speed"], 0.01)), clip["duration"]]
		if not keys.is_empty():
			l2 = "ramp, %d keys · %.2f s" % [keys.size(), clip["duration"]]
		draw_string(font, r.position + Vector2(6, 14), l1, HORIZONTAL_ALIGNMENT_LEFT, r.size.x - 8, 11, Color.WHITE)
		draw_string(font, r.position + Vector2(6, 28), l2, HORIZONTAL_ALIGNMENT_LEFT, r.size.x - 8, 10, Color("b9c8d8"))
		for side in [0.0, 1.0]:
			var x: float = r.position.x + (r.size.x - 3.0) * side
			draw_rect(Rect2(x, r.position.y, 3, r.size.y), Color("3d7bff") if sel else Color(1, 1, 1, 0.35))
		for kind in ["speed", "zoom", "lead"]:
			_draw_keyed(clip, i, r, KINDS[kind], kind)
	# the camera keys
	for i in ed.camera_keys.size():
		var k: Dictionary = ed.camera_keys[i]
		var c := Vector2(float(k["t"]) * sc, CAM_Y + 29)
		var col := Color("3d7bff") if i == ed.selected_cam else Color("37d67a")
		if bool(k["parent"]):
			draw_circle(c, 7.0, col)
		else:
			draw_colored_polygon(PackedVector2Array([c + Vector2(0, -8), c + Vector2(8, 0), c + Vector2(0, 8), c + Vector2(-8, 0)]), col)
	# the playhead
	var hx: float = ed.head_t * sc
	draw_line(Vector2(hx, 0), Vector2(hx, size.y), Color("ff4d4d"), 2.0)
	draw_rect(Rect2(hx - 5, 0, 10, 10), Color("ff4d4d"))


func _draw_keyed(clip: Dictionary, index: int, r: Rect2, k: Dictionary, kind: String) -> void:
	var keys: Array = clip.get(k["keys"], [])
	if keys.is_empty():
		return
	var pts := PackedVector2Array()
	var x := 0.0
	while x <= r.size.x:
		var off := ed.offset_at(clip, clampf(x / ed.scale_px, 0.0, clip["duration"]))
		pts.append(r.position + Vector2(x, scale_y(ed.keyed_value(clip, kind, off), k["lo"], k["hi"], k["linear"])))
		x += 3.0
	if pts.size() > 1:
		draw_polyline(pts, k["colour"], 1.5)
	for ki in keys.size():
		var key: Dictionary = keys[ki]
		var c := r.position + Vector2(ed.time_at_offset(clip, key["at"]) * ed.scale_px, scale_y(key[k["field"]], k["lo"], k["hi"], k["linear"]))
		var sel: bool = index == ed.selected and ki == ed.selected_key(kind)
		var col: Color = Color("3d7bff") if sel else k["colour"]
		var s := 6.0 if sel else 5.0
		match kind:
			"speed":
				draw_circle(c, s, col)
			"zoom":
				draw_colored_polygon(PackedVector2Array([c + Vector2(0, -s), c + Vector2(s, 0), c + Vector2(0, s), c + Vector2(-s, 0)]), col)
			_:
				draw_colored_polygon(PackedVector2Array([c + Vector2(0, -s), c + Vector2(s, s), c + Vector2(-s, s)]), col)


## What is under a point: {"kind": "key", clip, kind, index} / {"kind": "trim", clip, side} / {"kind": "clip", clip} /
## {"kind": "cam", index} / {}.
func _hit(p: Vector2) -> Dictionary:
	var sc: float = ed.scale_px
	var starts: Array = ed.starts()
	for i in ed.clips.size():
		var clip: Dictionary = ed.clips[i]
		var r := Rect2(starts[i] * sc, CLIP_Y, maxf(6.0, clip["duration"] * sc - 2.0), CLIP_H)
		for kind in ["lead", "zoom", "speed"]:
			var k: Dictionary = KINDS[kind]
			var keys: Array = clip.get(k["keys"], [])
			for ki in keys.size():
				var c := r.position + Vector2(ed.time_at_offset(clip, keys[ki]["at"]) * sc, scale_y(keys[ki][k["field"]], k["lo"], k["hi"], k["linear"]))
				if c.distance_to(p) <= 7.0:
					return {"kind": "key", "clip": i, "of": kind, "index": ki}
		if r.grow(2.0).has_point(p):
			if p.x <= r.position.x + 9.0:
				return {"kind": "trim", "clip": i, "side": "l"}
			if p.x >= r.end.x - 9.0:
				return {"kind": "trim", "clip": i, "side": "r"}
			return {"kind": "clip", "clip": i}
	for i in ed.camera_keys.size():
		var c := Vector2(float(ed.camera_keys[i]["t"]) * sc, CAM_Y + 29)
		if c.distance_to(p) <= 9.0:
			return {"kind": "cam", "index": i}
	return {}


func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		if event.pressed:
			_press(event.position, event.double_click)
		else:
			if _drag.get("moved", false) and _drag.get("kind", "") in ["trim", "key"]:
				ed.touch()
			_drag = {}
		accept_event()
	elif event is InputEventMouseMotion and not _drag.is_empty():
		_move(event.position)
		accept_event()


func _press(p: Vector2, double: bool) -> void:
	if ed.recording():
		return
	var h := _hit(p)
	match h.get("kind", ""):
		"key":
			ed.select_key(h["clip"], h["of"], h["index"])
			var clip: Dictionary = ed.clips[h["clip"]]
			_drag = {"kind": "key", "clip": h["clip"], "of": h["of"], "key": clip[KINDS[h["of"]]["keys"]][h["index"]], "from": p, "moved": false}
		"trim":
			var clip: Dictionary = ed.clips[h["clip"]]
			_drag = {"kind": "trim", "clip": h["clip"], "side": h["side"], "from": p, "in": clip["in"], "out": clip["out"], "moved": false,
				"keys": clip["keys"].duplicate(true), "zoomKeys": clip["zoomKeys"].duplicate(true), "leadKeys": clip["leadKeys"].duplicate(true)}
		"clip":
			ed.select_clip(h["clip"])
		"cam":
			if double:
				ed.edit_key(h["index"])
			else:
				ed.go_to_cam_key(h["index"])
		_:
			_drag = {"kind": "head"}
			ed.scrub_to(p.x / ed.scale_px)
	queue_redraw()


func _move(p: Vector2) -> void:
	match _drag.get("kind", ""):
		"head":
			ed.scrub_to(p.x / ed.scale_px)
		"key":
			if not _drag["moved"] and (p - _drag["from"]).length() < 3.0:
				return
			_drag["moved"] = true
			var clip: Dictionary = ed.clips[_drag["clip"]]
			var start: float = ed.starts()[_drag["clip"]]
			var k: Dictionary = KINDS[_drag["of"]]
			var key: Dictionary = _drag["key"]
			key["at"] = clampf(ed.offset_at(clip, clampf(p.x / ed.scale_px - start, 0.0, clip["duration"])), 0.0, clip["out"] - clip["in"])
			key[k["field"]] = snappedf(scale_value(p.y - CLIP_Y, k["lo"], k["hi"], k["linear"]), 0.01)
			ed.prepare(clip)
			ed.select_key(_drag["clip"], _drag["of"], (clip[k["keys"]] as Array).find(key))
		"trim":
			_trim(p)
	queue_redraw()


## A handle at the start or the end of a clip: its In or Out earlier or later in the source (the pixels of the
## timeline are time of the program: in the source they count by the speed at that end of the clip).
func _trim(p: Vector2) -> void:
	var dx: float = p.x - _drag["from"].x
	if not _drag["moved"] and absf(dx) < 2.0:
		return
	_drag["moved"] = true
	var i: int = _drag["clip"]
	var clip: Dictionary = ed.clips[i]
	var a: float = ed.replay.start_time()
	var b: float = ed.replay.end_time()
	var in0: float = _drag["in"]
	var out0: float = _drag["out"]
	for name in ["keys", "zoomKeys", "leadKeys"]:
		clip[name] = (_drag[name] as Array).duplicate(true)
	if _drag["side"] == "l":
		var new_in := clampf(in0 + dx / ed.scale_px * ed.keyed_value(clip, "speed", 0.0), a, out0 - MIN_CLIP)
		var shift := new_in - in0
		clip["in"] = new_in
		for name in ["keys", "zoomKeys", "leadKeys"]:
			var kept: Array = []
			for k in clip[name]:
				k["at"] -= shift
				if k["at"] >= -1e-6 and k["at"] <= clip["out"] - clip["in"] + 1e-6:
					kept.append(k)
			clip[name] = kept
	else:
		clip["out"] = clampf(out0 + dx / ed.scale_px * ed.keyed_value(clip, "speed", out0 - in0), in0 + MIN_CLIP, b)
		for name in ["keys", "zoomKeys", "leadKeys"]:
			clip[name] = (clip[name] as Array).filter(func(k): return k["at"] <= clip["out"] - clip["in"] + 1e-6)
	# (one key left of a kind is no ramp: its value is the clip's)
	for kind in KINDS:
		var kk: Dictionary = KINDS[kind]
		if (clip[kk["keys"]] as Array).size() == 1:
			clip[kk["plain"]] = clip[kk["keys"]][0][kk["field"]]
			clip[kk["keys"]] = []
	ed.prepare(clip)
	ed.select_clip(i, false)
	ed.say("Clip %d: %s – %s · %.2f s" % [i + 1, VideoEditor.fmt(clip["in"]), VideoEditor.fmt(clip["out"]), clip["duration"]])
