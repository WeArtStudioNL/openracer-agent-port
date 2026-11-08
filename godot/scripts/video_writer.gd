class_name VideoWriter
extends RefCounted
## A video file from pictures (the Video button of the replay, Save fragment, a take, Save as mp4 of the video
## editor). The browser films its canvas with MediaRecorder and the local server makes a mp4 of it with ffmpeg;
## here the frames go straight into ffmpeg (a pipe: raw RGBA in, H.264 out) when ffmpeg is on the system (found
## on the PATH or in /opt/homebrew/bin, /usr/local/bin, /usr/bin). The sound of the game is recorded at the same
## time (an AudioEffectRecord on the Master bus) and put under the picture at the end; when the frames came slower
## than real time the sound is stretched to the length of the picture (atempo). Without ffmpeg the frames are kept
## as a numbered PNG sequence in a folder, with sound.wav next to them.

static var _ffmpeg := "?"

var path := ""                      # what was made: the .mp4, or the folder of the PNGs
var width := 0
var height := 0
var fps := 30.0
var frames := 0
var error := ""
var _pipe: FileAccess = null
var _pid := -1
var _tmp := ""
var _png_dir := ""
var _record: AudioEffectRecord = null
var _record_bus := -1
var _record_started := 0



## The ffmpeg of the system, "" when there is none.
static func ffmpeg() -> String:
	if _ffmpeg != "?":
		return _ffmpeg
	_ffmpeg = ""
	var out: Array = []
	var finder := "where" if OS.get_name() == "Windows" else "which"
	if OS.execute(finder, ["ffmpeg"], out) == 0 and not out.is_empty():
		var first := str(out[0]).strip_edges().get_slice("\n", 0).strip_edges()
		if first != "" and FileAccess.file_exists(first):
			_ffmpeg = first
	if _ffmpeg == "":
		for p in ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"]:
			if FileAccess.file_exists(p):
				_ffmpeg = p
				break
	return _ffmpeg


## Starts a video: <dir>/<stem>.mp4 (or a folder <stem>/ of PNGs). w and h are made even (H.264 asks it).
func start(dir: String, stem: String, w: int, h: int, rate := 30.0, sound := true) -> bool:
	width = maxi(2, w - w % 2)
	height = maxi(2, h - h % 2)
	fps = rate
	frames = 0
	var name := VideoPrefs.safe_name(stem)
	var ff := ffmpeg()
	if ff != "":
		path = _free_name(dir.path_join(name), ".mp4")
		_tmp = path.get_basename() + ".part.mp4"
		var enc: Array = ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-maxrate", "20M", "-bufsize", "40M"] if _has_x264(ff) else ["-c:v", "mpeg4", "-q:v", "2"]
		var args: Array = ["-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", "%dx%d" % [width, height], "-r", str(fps), "-i", "-"]
		args.append_array(enc)
		args.append_array(["-pix_fmt", "yuv420p", "-movflags", "+faststart", _tmp])
		var p := OS.execute_with_pipe(ff, PackedStringArray(args))
		if p.is_empty() or not p.has("stdio"):
			error = "ffmpeg could not be started"
			return false
		_pipe = p["stdio"]
		_pid = int(p["pid"])
	else:
		path = _free_name(dir.path_join(name), "")
		_png_dir = path
		DirAccess.make_dir_recursive_absolute(_png_dir)
	if sound:
		_start_sound()
	RunLog.event("video: %s, %dx%d at %d fps%s" % [path, width, height, int(fps), "" if ff != "" else " (no ffmpeg: PNG frames)"])
	return true


## One frame (scaled to the size of the video when it is not that size).
func add(img: Image) -> void:
	if img == null or img.is_empty():
		return
	if img.get_format() != Image.FORMAT_RGBA8:
		img.convert(Image.FORMAT_RGBA8)
	if img.get_width() != width or img.get_height() != height:
		img.resize(width, height, Image.INTERPOLATE_BILINEAR)
	frames += 1
	if _pipe != null:
		_pipe.store_buffer(img.get_data())
	elif _png_dir != "":
		img.save_png(_png_dir.path_join("frame_%05d.png" % frames))


## Ends the video: the file (with its sound). Gives the path, or "" when nothing was made.
func finish() -> String:
	var wav := _stop_sound()
	if _pipe != null:
		_pipe.close()
		_pipe = null
		var waited := 0
		while _pid > 0 and OS.is_process_running(_pid) and waited < 120000:
			OS.delay_msec(20)
			waited += 20
		if frames == 0 or not FileAccess.file_exists(_tmp):
			DirAccess.remove_absolute(_tmp)
			error = "the video is empty"
			return ""
		var seconds := frames / fps
		if wav != "" and _has_sound(wav):
			var tempo := clampf(_wav_seconds(wav) / maxf(0.1, seconds), 0.5, 4.0)
			var args := ["-y", "-loglevel", "error", "-i", _tmp, "-i", wav]
			if absf(tempo - 1.0) > 0.01:
				args.append_array(["-filter:a", "atempo=%.4f" % tempo])
			args.append_array(["-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", path])
			var out: Array = []
			if OS.execute(ffmpeg(), PackedStringArray(args), out, true) == 0 and FileAccess.file_exists(path):
				DirAccess.remove_absolute(_tmp)
			else:
				DirAccess.rename_absolute(_tmp, path)
		else:
			DirAccess.rename_absolute(_tmp, path)
		if wav != "":
			DirAccess.remove_absolute(wav)
	elif _png_dir != "":
		if wav != "":
			DirAccess.rename_absolute(wav, _png_dir.path_join("sound.wav"))
		if frames == 0:
			error = "the video is empty"
			return ""
	RunLog.event("video saved: %s (%d frames, %.1f s)" % [path, frames, frames / fps])
	return path


## Stops without a file.
func cancel() -> void:
	var wav := _stop_sound()
	if wav != "":
		DirAccess.remove_absolute(wav)
	if _pipe != null:
		_pipe.close()
		_pipe = null
		if _pid > 0 and OS.is_process_running(_pid):
			OS.kill(_pid)
		DirAccess.remove_absolute(_tmp)


func _free_name(base: String, ext: String) -> String:
	var p := base + ext
	var n := 2
	while FileAccess.file_exists(p) or DirAccess.dir_exists_absolute(p):
		p = "%s (%d)%s" % [base, n, ext]
		n += 1
	return p


func _has_x264(ff: String) -> bool:
	var out: Array = []
	OS.execute(ff, ["-hide_banner", "-encoders"], out, true)
	return not out.is_empty() and str(out[0]).contains("libx264")


func _start_sound() -> void:
	_record = AudioEffectRecord.new()
	_record_bus = AudioServer.get_bus_index("Master")
	AudioServer.add_bus_effect(_record_bus, _record)
	_record.set_recording_active(true)
	_record_started = Time.get_ticks_msec()


## The sound that was recorded, as a .wav next to the video; "" for none.
func _stop_sound() -> String:
	if _record == null:
		return ""
	var wav := _record.get_recording()
	_record.set_recording_active(false)
	for i in AudioServer.get_bus_effect_count(_record_bus):
		if AudioServer.get_bus_effect(_record_bus, i) == _record:
			AudioServer.remove_bus_effect(_record_bus, i)
			break
	_record = null
	if wav == null:
		return ""
	var file := path.get_basename() + ".sound.wav" if _png_dir == "" else _png_dir + ".sound.wav"
	return file if wav.save_to_wav(file) == OK else ""


func _wav_seconds(wav: String) -> float:
	var s := AudioStreamWAV.load_from_file(wav)
	return s.get_length() if s != null else 0.0


func _has_sound(wav: String) -> bool:
	return _wav_seconds(wav) > 0.2
