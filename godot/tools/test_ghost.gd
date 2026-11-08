extends Node3D
## (a scene, for the autoloads: Godot --headless --path godot res://tools/test_ghost.tscn -- --out=/tmp/folder
## [--car=openracer-muscle --track=kartbaan-oldenzaal])
## The ghost as a file (GhostFiles, Ghost.js) and the lap as the racing line (RacingLine.from_lap, save_lap): a lap made
## along the racing line is saved as an .openracer-ghost, read back (the places within a millimetre), read as a file of
## the browser (its body origin 0.3 m higher: the fit to the wheel centres takes it out), raced as the ghost of a file,
## turned into a line, and saved as the line of the track into a garage folder in --out (never the player's).

var _fails := 0


func _check(ok: bool, what: String) -> void:
	print(("ok    " if ok else "FAIL  ") + what)
	if not ok:
		_fails += 1


func _ready() -> void:
	var out := Content.arg("out")
	if out == "":
		print("test_ghost: --out=<folder> is required")
		get_tree().quit(1)
		return
	DirAccess.make_dir_recursive_absolute(out)
	Settings.set("_overrides", {"garage_folder": out.path_join("garage")})
	DirAccess.make_dir_recursive_absolute(out.path_join("garage"))
	var car_id := Content.arg("car") if Content.arg("car") != "" else "openracer-muscle"
	var track_id := Content.arg("track") if Content.arg("track") != "" else "kartbaan-oldenzaal"
	var track := Track.new()
	var tcfg: Variant = Content.load_json("tracks/%s/track.json" % track_id)
	add_child(track)
	track.setup(track_id, tcfg if tcfg is Dictionary else {})
	var car := Car.new()
	var ccfg: Variant = Content.load_json("cars/%s/car.json" % car_id)
	car.setup(car_id, ccfg if ccfg is Dictionary else {})
	car.freeze = true
	add_child(car)
	var laps := LapTimer.new()
	laps.ghosts_dir = out.path_join("ghosts")
	laps.records_file = out.path_join("records.cfg")
	laps.setup(car, track, {"records": false, "ghost": false})
	laps.ghosts_dir = out.path_join("ghosts")
	add_child(laps)
	# a lap along the line of the track at 25 m/s
	var line := RacingLine.from_track(track.config)
	var samples := PackedFloat32Array()
	var n := int(line.length / 25.0 * LapTimer.RATE)
	for i in n:
		var d := i * 25.0 / LapTimer.RATE
		var k := int(d / RacingLine.STEP) % line.count()
		var p := line.point(k)
		var ahead := line.point((k + 1) % line.count())
		var h := atan2(-(ahead.x - p.x), -(ahead.z - p.z))
		var q := Quaternion(Vector3.UP, h)
		samples.append_array([p.x, p.y + 0.5, p.z, q.x, q.y, q.z, q.w, 0.1 * sin(i * 0.05)])
		for w in 4:
			samples.append(car.susp_length - 0.02 * w)
	laps.set("_best_samples", samples)
	laps.best_lap = n / LapTimer.RATE
	print("a lap of %d samples, %.1f s" % [n, laps.best_lap])
	# Save lap
	var path := GhostFiles.save_best(laps, out)
	_check(path != "" and FileAccess.file_exists(path), "Save lap wrote %s" % path.get_file())
	var text := FileAccess.get_file_as_string(path)
	var data: Dictionary = JSON.parse_string(text)
	_check(data.get("format") == "openracer-ghost" and int(data.get("version", 0)) == 1 and data.get("track") == track_id
		and (data["samples"] as Array).size() == n, "the file has the fields of Ghost.js and every sample")
	var s0: Dictionary = data["samples"][0]
	_check(s0.has_all(["t", "x", "y", "z", "qx", "qy", "qz", "qw", "w", "s", "r"]) and (s0["w"] as Array).size() == 4, "a sample has t, x y z, the quaternion, w, s, r")
	# read back
	var g := GhostFiles.read(laps, text)
	_check(not g.has("error"), "read back: " + str(g.get("error", "fine")))
	var back: PackedFloat32Array = g["samples"]
	var worst := 0.0
	var worst_len := 0.0
	for i in mini(back.size(), samples.size()) / LapTimer.FIELDS:
		var a := i * LapTimer.FIELDS
		worst = maxf(worst, Vector3(back[a], back[a + 1], back[a + 2]).distance_to(Vector3(samples[a], samples[a + 1], samples[a + 2])))
		for w in 4:
			worst_len = maxf(worst_len, absf(back[a + 8 + w] - samples[a + 8 + w]))
	_check(back.size() == samples.size() and worst < 0.03 and worst_len < 0.003,
		"the places back within 3 cm (the times of a file are in ms) (%.4f m), the springs within 3 mm (%.4f m)" % [worst, worst_len])
	# as a file of the browser: no engine, the body origin 0.3 m higher
	data.erase("engine")
	for s: Dictionary in data["samples"]:
		s["y"] = float(s["y"]) + 0.3
	var g2 := GhostFiles.read(laps, JSON.stringify(data))
	var b2: PackedFloat32Array = g2["samples"]
	var worst2 := 0.0
	for i in mini(b2.size(), samples.size()) / LapTimer.FIELDS:
		var a := i * LapTimer.FIELDS
		worst2 = maxf(worst2, Vector3(b2[a], b2[a + 1], b2[a + 2]).distance_to(Vector3(samples[a], samples[a + 1], samples[a + 2])))
	_check(worst2 < 0.05, "a browser file is fitted to its wheel centres (%.3f m off)" % worst2)
	# the wrong track, a damaged file
	data["track"] = "another"
	_check(str(GhostFiles.read(laps, JSON.stringify(data)).get("error", "")).contains("another track"), "a ghost of another track is refused")
	data["track"] = track_id
	data["samples"][5]["t"] = -1
	_check(str(GhostFiles.read(laps, JSON.stringify(data)).get("error", "")).contains("damaged"), "a damaged file is refused")
	_check(GhostFiles.read(laps, "{}").get("error", "") == "This is not a ghost file.", "something else is refused")
	# Race a ghost: it is kept and the ghost car drives it
	var err := GhostFiles.open(laps, path)
	_check(err == "" and not laps.friend.is_empty() and laps.ghost != null, "Race a ghost: %s" % (err if err != "" else "the ghost of the file drives"))
	_check(is_equal_approx(laps.shown_best(), laps.best_lap), "the HUD shows the time of the ghost")
	_check(not GhostFiles.load_friend(laps).is_empty(), "the ghost of the file is kept for the next drive")
	laps.clear_friend()
	_check(laps.friend.is_empty() and GhostFiles.load_friend(laps).is_empty(), "Own lap forgets it")
	# the lap as the racing line
	var from_lap := RacingLine.from_lap(samples)
	_check(from_lap != null and absf(from_lap.length - line.length) / line.length < 0.05,
		"the lap as a line: %.0f m (the line %.0f m)" % [from_lap.length if from_lap else 0.0, line.length])
	var count := RacingLine.save_lap(track_id, samples)
	var saved: Variant = Content.load_json("tracks/%s/track.json" % track_id)
	_check(count == (n + 2) / 3 and saved is Dictionary and (saved["racing_line"] as Array).size() == count and str(saved.get("line_date", "")) != ""
		and Content.path("tracks/%s/track.json" % track_id).begins_with(out), "Save my best lap as the line: %d points in the garage of the test" % count)
	print("ghost test: %s" % ("all fine" if _fails == 0 else "%d failed" % _fails))
	get_tree().quit(1 if _fails else 0)
