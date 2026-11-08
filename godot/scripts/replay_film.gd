class_name ReplayFilm
extends Node
## A video of a part of the replay (the Video button, Save fragment as mp4, a take, Save as mp4 of the video editor):
## the part is played at the chosen speed and filmed with the camera as it is set. The picture is rendered a second
## time in a SubViewport of the size of the video (the same world, a camera that copies the one on the screen, its
## field of view narrowed to the orange outline of the aspect), so the bar and the windows are not in it. Every
## frame of the video is a step of exactly 1/30 s of the replay times the speed; the steps are paced to real time,
## so the sound of the replay is recorded with it (VideoWriter). Escape (or the button again) stops it: the video is
## kept as far as it went.

signal finished(path: String)

const FPS := 30.0
const MAX_LONG := 1920

var replay: Replay
var from := 0.0
var to := 0.0
var speed := 1.0
var writer := VideoWriter.new()
var frames_total := 0
var frame := 0
var program: Callable               # (the video editor) func(i) -> sets the program to frame i; else the replay is moved
var source_viewport: SubViewport = null   # (the video editor: its program monitor is filmed as it is)
var stepped := false                # this frame the replay moved a step of the video: the cameras move once, a step of 1/30 s
var _sub: SubViewport
var _cam: Camera3D
var _pending := false
var _started := 0
var _done := false


## Starts filming: the replay from one time to another at a speed, into <videos>/<stem>.mp4. False when it cannot.
func begin(r: Replay, t0: float, t1: float, spd: float, stem: String, sound := true) -> bool:
	replay = r
	from = t0
	to = t1
	speed = maxf(0.01, spd)
	frames_total = maxi(1, int(ceil((to - from) / speed * FPS)))
	name = "Film"
	process_mode = Node.PROCESS_MODE_ALWAYS
	process_priority = -20
	var size := _size()
	if source_viewport == null:
		_sub = SubViewport.new()
		_sub.size = size
		_sub.world_3d = r.get_viewport().find_world_3d()
		var root := r.get_viewport()
		_sub.msaa_3d = root.msaa_3d
		_sub.screen_space_aa = root.screen_space_aa
		_sub.use_taa = root.use_taa
		_sub.use_debanding = root.use_debanding
		_sub.render_target_update_mode = SubViewport.UPDATE_DISABLED
		add_child(_sub)
		_cam = Camera3D.new()
		_cam.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF     # (else it is drawn a physics step behind the place it gets)
		_cam.current = true
		_sub.add_child(_cam)
		var late := _Late.new()
		late.film = self
		add_child(late)
	else:
		size = source_viewport.size
	if not writer.start(VideoPrefs.videos_dir(), stem, size.x, size.y, FPS, sound):
		return false
	_started = Time.get_ticks_msec()
	_chase(0.0)
	return true


## The camera of the game follows the video and not the frames of the screen: between two pictures it rests, and it
## takes one step per picture. (It moved with the time of the screen while the car jumped 1/30 s: the picture was taken
## with the camera still behind the car, by more or less each time.)
func _chase(step: float) -> void:
	var cam := replay.game_camera()
	if cam != null:
		cam.film_step = step


## The size of the video: the outline of the aspect in the window, at most 1920 on its long side.
func _size() -> Vector2i:
	var win := Vector2(replay.get_viewport().size)
	var rect := VideoPrefs.frame_rect(win)
	var k := minf(1.0, MAX_LONG / maxf(rect.size.x, rect.size.y))
	return Vector2i(maxi(2, roundi(rect.size.x * k / 2.0) * 2), maxi(2, roundi(rect.size.y * k / 2.0) * 2))


func progress() -> float:
	return float(frame) / maxf(1.0, frames_total)


func _process(_delta: float) -> void:
	if _done:
		return
	stepped = false
	if _pending:
		var vp := source_viewport if source_viewport != null else _sub
		writer.add(vp.get_texture().get_image())
		frame += 1
		_pending = false
		if frame >= frames_total:
			stop()
			return
	# (paced to real time: the sound goes with the picture)
	if (Time.get_ticks_msec() - _started) / 1000.0 < frame / FPS:
		return
	if program.is_valid():
		program.call(frame)
	else:
		replay.time = minf(to, from + frame * speed / FPS)
	if source_viewport != null:
		source_viewport.render_target_update_mode = SubViewport.UPDATE_ONCE
	else:
		_sub.render_target_update_mode = SubViewport.UPDATE_ONCE
	_pending = true
	stepped = true
	_chase(1.0 / FPS)


## (late in the frame: the camera of the video is where the camera of the screen is now)
func copy_camera() -> void:
	var cam := replay.get_viewport().get_camera_3d()
	if cam == null or _cam == null:
		return
	_cam.global_transform = cam.global_transform
	_cam.near = cam.near
	_cam.far = cam.far
	_cam.environment = cam.environment
	_cam.attributes = cam.attributes
	var win := Vector2(replay.get_viewport().size)
	var rect := VideoPrefs.frame_rect(win)
	_cam.fov = rad_to_deg(2.0 * atan(tan(deg_to_rad(cam.fov) / 2.0) * rect.size.y / maxf(1.0, win.y)))


## Ends the video (also before its end: what was filmed is kept).
func stop() -> void:
	if _done:
		return
	_done = true
	_chase(-1.0)
	var path := writer.finish()
	finished.emit(path)
	queue_free()


class _Late:
	extends Node
	var film: ReplayFilm

	func _ready() -> void:
		process_mode = Node.PROCESS_MODE_ALWAYS
		process_priority = 200

	func _process(_delta: float) -> void:
		film.copy_camera()
