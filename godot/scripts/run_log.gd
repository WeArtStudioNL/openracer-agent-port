extends Node
## The log of a run: a file per start of the game in godot/logs/ (run-<date>-<time>.log), with what happened when
## (the menu, a drive, the camera, a reset, a shift) and four times a second the state of the car (speed, gear,
## rpm, the pedals, the steering and every tyre). F8 marks a moment: a line "MARK n" and a screenshot next to the
## log, so that something seen while driving can be found back. Godot's own messages (errors, warnings) go to
## godot.log in the same folder.

const TELEMETRY_EVERY := 0.25

var car: Car = null                 # the car whose state is written (World sets it)
var on_mark: Callable               # shows the mark on the screen (the HUD)
var path := ""
var folder := ""
var _file: FileAccess
var _start_ms := 0
var _time := 0.0                    # s of game time (the sum of the frames: with --fixed-fps faster than the clock)
var _marks := 0
var _next_telemetry := 0.0


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_start_ms = Time.get_ticks_msec()
	folder = _folder()
	DirAccess.make_dir_recursive_absolute(folder)
	var stamp := Time.get_datetime_string_from_system().replace(":", "").replace("T", "-")
	path = folder.path_join("run-%s.log" % stamp)
	_file = FileAccess.open(path, FileAccess.WRITE)
	if _file == null:
		push_warning("RunLog: cannot write " + path)
		return
	_header()
	_prune(30)


func _folder() -> String:
	# in the repository: godot/logs (not in git); an exported game: the folder of its user data
	if OS.has_feature("editor") or DirAccess.dir_exists_absolute(ProjectSettings.globalize_path("res://scripts")):
		return ProjectSettings.globalize_path("res://").path_join("logs")
	return OS.get_user_data_dir().path_join("logs")


func _header() -> void:
	var commit := ""
	var out := []
	# (no programs to run in the browser)
	if not OS.has_feature("web") and OS.execute("git",["-C", ProjectSettings.globalize_path("res://"), "log", "-1", "--format=%h %s"], out) == 0 and not out.is_empty():
		commit = str(out[0]).strip_edges()
	line("RUN %s" % Time.get_datetime_string_from_system())
	line("version %s  godot %s  commit %s" % [ProjectSettings.get_setting("application/config/version"), Engine.get_version_info()["string"], commit])
	line("os %s %s  cpu %s  gpu %s (%s)" % [OS.get_name(), OS.get_version(), OS.get_processor_name(), RenderingServer.get_video_adapter_name(),
		RenderingServer.get_current_rendering_method()])
	var screen := DisplayServer.window_get_current_screen()
	line("screen %s  scale %.1f  window %s  native sound %s" % [DisplayServer.screen_get_size(screen), DisplayServer.screen_get_scale(screen),
		DisplayServer.window_get_size(), ClassDB.class_exists("EngineSimSynth")])
	line("args %s" % [OS.get_cmdline_user_args()])
	line("godot.log %s" % ProjectSettings.globalize_path("user://logs/godot.log"))


## Writes a line with the time since the start.
func line(text: String) -> void:
	if OS.has_feature("web") and not text.begins_with("CAR ") and not text.begins_with("BIKE "):
		print("%9.3f  %s" % [_time, text])          # (the web version: the log, without the telemetry, in the console)
	if _file == null:
		return
	_file.store_line("%9.3f  %s" % [_time, text])
	_file.flush()


func event(text: String) -> void:
	line("EVENT " + text)


func _unhandled_input(event_in: InputEvent) -> void:
	if event_in.is_action_pressed("mark"):
		mark()


## A moment that the player wants found back: a line and a screenshot.
func mark() -> void:
	_marks += 1
	var shot := path.get_basename() + "-mark%d.png" % _marks
	var img := get_viewport().get_texture().get_image()
	if img != null:
		img.save_png(shot)
	line("MARK %d  screenshot %s" % [_marks, shot.get_file()])
	if car != null:
		_telemetry()
	if on_mark.is_valid():
		on_mark.call("Marked %d (F8): written to the log" % _marks)


func _process(delta: float) -> void:
	_time += delta


func _physics_process(_delta: float) -> void:
	if car == null or not is_instance_valid(car) or car.freeze:
		return
	var t := _time
	if t >= _next_telemetry:
		_next_telemetry = t + TELEMETRY_EVERY
		_telemetry()


func _telemetry() -> void:
	var p := car.global_position
	var parts := PackedStringArray()
	for w in car.wheels:
		parts.append("%s %s load %d s %.2f slip %+.2f/%+.2f t %d%s" % [w.slot, w.surface, roundi(w.load), w.s, w.slip_ratio, w.slip_tan,
			roundi(w.surf_t), "" if w.contact else " air"])
	line("CAR pos %.1f %.2f %.1f  head %.0f  %5.1f km/h  gear %s  %4d rpm  thr %.2f brk %.2f hb %.2f steer %+.1f  clutch %.2f  fps %d | %s" % [
		p.x, p.y, p.z, rad_to_deg(car.heading()), car.speed * 3.6, car.gear_name(), roundi(car.engine.rpm()), car.throttle, car.brake,
		car.handbrake_input, rad_to_deg(car.steer_angle), car.clutch_engagement, Engine.get_frames_per_second(), " | ".join(parts)])
	if car.bike != null:
		var b := car.bike
		line("BIKE lean %+.1f want %+.1f cmd %+.2f  front brake %.2f rear %.2f  thr x%.2f  hang %+.2f%s" % [rad_to_deg(b.lean), rad_to_deg(b.target_lean),
			b.command, b.front_brake, b.rear_brake, b.throttle_scale, float(b.posture["lat"]), "  DOWN " + b.crash_reason if b.crashed else ""])


## Keeps the newest logs (and their screenshots).
func _prune(keep: int) -> void:
	var logs: Array[String] = []
	for f in DirAccess.get_files_at(folder):
		if f.begins_with("run-") and f.ends_with(".log"):
			logs.append(f)
	logs.sort()
	while logs.size() > keep:
		var old: String = logs.pop_front()
		var base := old.get_basename()
		for f in DirAccess.get_files_at(folder):
			if f.begins_with(base):
				DirAccess.remove_absolute(folder.path_join(f))
