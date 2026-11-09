# gdlint: disable=max-public-methods
class_name Replay
extends Node
## The replay (web/js/Replay.js): from the start everything is recorded, all the cars (the player and the
## opponents), 30 times a second: where the body is, how it is turned and how fast it goes, the steering, the
## engine, the pedals, the gear, how hard the tyres squeal, and for every wheel how far its spring is out, how it
## is steered and how far it has turned. The last half hour is kept; the times are counted from the start of the
## drive (a sample has its own number, what went at the start is gone).
##
## Esc, Replay: the game stops where it is and the recording is played back through the same code that draws the
## cars of the game; the engine and the squeal of the tyres are heard as they were. The bar (ReplayBar) has the
## slider, the marks of a fragment, play, rewind, the speed, the aspect of the picture, the cameras (the three of the
## game, the free camera ReplayFreeCamera, the cinematic cameras of the track), Save replay, Photo, Video and the
## video editor. Exit (or Esc) goes back to the game, which goes on where it was left.
##
## The files (ReplayFiles): Save replay keeps it in the replays folder; the main menu, Replays, opens one (also the
## browser's .openracer-replay files): a viewer with no game behind it. A replay made in the video editor has a
## camera track (CameraTrack), the cameras of its clips and a zoom; the viewer plays them.

signal frame_shown(t: float)
signal closed

const RATE := 30.0
const MAX_SECONDS := 1800.0
const CAR_FIELDS := 16              # position 3, rotation 4, velocity 3, steering, engine omega, throttle, brake, gear, present
const WHEEL_FIELDS := 3             # spring length, steering, turn
const STRIDE := CAR_FIELDS + 4 * WHEEL_FIELDS
const SPEEDS := [0.1, 0.25, 0.5, 1.0, 2.0, 3.0, 5.0]
const JUMP := 15.0                  # m between two samples: the car was put back (no sliding in between)
const P_VEL := 7
const P_STEER := 10
const P_OMEGA := 11
const P_THROTTLE := 12
const P_BRAKE := 13
const P_GEAR := 14
const P_PRESENT := 15
const _LATE := preload("res://scripts/replay_late.gd")

var world: Node
var cars: Array[Car] = []
var samples := PackedFloat32Array()
var count := 0                      # samples kept
var first_index := 0                # the number of the first sample kept (what went at the start is gone)
var playing := false                # the replay is on the screen
var running := false                # it plays (not paused)
var direction := 1.0                # 1 forwards, -1 backwards (Rewind)
var time := 0.0                     # s, from the start of the drive
var speed := 1.0
var soft: ReplaySoft = null          # the shells, the parts and the wheels (ReplaySoft)
var fx: ReplayFx = null              # the skid marks, the smoke, the marbles, the debris, the pieces, the leaks, the weather (ReplayFx)
var extras: ReplayExtras = null      # the rider as a ragdoll, the drag tree, the bangs, the pit stops (read every sample)
var scrubbing := false
var viewer := false                 # a replay from a file: Exit goes back to the menu
var file_path := ""                 # the file of this replay (saved, or opened)
var saved_count := -1               # (the recording as it was saved: Save replay does not save it twice)
var header := {}                    # the file that was opened: its track, cars, camera track, project …
var is_edit := false                # (the edit of a file is watched: a recording of its own)
var target := 0                     # the car the cameras follow (Tab)
var free: ReplayFreeCamera = null
var cine_on := false
var cine_scale := 1.0               # the zoom of the cinematic camera (0.2 .. 3)
var cine_lead := 0.0                # m ahead of the car that it looks at
var cine_override := -1.0           # (the look ahead of a clip of the video editor)
var mark_in := -1.0                 # the fragment (s; -1: none)
var mark_out := -1.0
var editor_playing := false         # the video editor plays: the sound is heard
var editor: Node = null             # the video editor while it is open (it has the keys)
var filming: Node = null            # a video being made (ReplayFilm)
var camera_override: Callable       # func(t) -> [Transform3D, fov] or []: the camera of a take
var bar: ReplayBar = null
var info := {}                      # the player's car now: speed, gear, rpm, throttle, brake
var _record_in := 0.0
var _saved: Array = []              # the cars as the game left them
var _camera_was: Car
var _cam_mode_was := 0
var _step_held := 0.0
var _cine_cam: Camera3D = null
var _cine_index := -1
var _cine_fov := 40.0
var _cine_quat := Quaternion.IDENTITY
var _track_cam: Camera3D = null     # the camera track of a file, a clip's camera, a take
var _cam_keys: Array = []           # (a file: the camera track)
var _cam_runs: Array = []           # (a file: [first sample, "follow" | "cockpit" | "cinematic" | "track", look ahead])
var _zoom_rows: Array = []          # (a file: the zoom of every sample)
var _run_shown: Variant = null
var _late: Node = null


func setup(w: Node, list: Array) -> void:
	world = w
	name = "Replay"
	for c in list:
		if c is Car and not c.is_ghost:
			cars.append(c)
	soft = ReplaySoft.new(cars)
	fx = ReplayFx.new(self)
	fx.record()
	process_mode = Node.PROCESS_MODE_ALWAYS
	process_priority = -10            # (the cars are placed before the cameras follow them)


func _ready() -> void:
	_late = Node.new()
	_late.name = "Late"
	_late.process_mode = Node.PROCESS_MODE_ALWAYS
	_late.process_priority = 150
	_late.set_script(_LATE)
	_late.set_meta("replay", self)
	add_child(_late)


func _exit_tree() -> void:
	if fx != null:
		ReplayFx.forget(fx)


func start_time() -> float:
	return first_index / RATE


func end_time() -> float:
	return (first_index + maxi(0, count - 1)) / RATE


func duration() -> float:
	return maxf(0.0, (count - 1) / RATE)


## The number of the sample that is recorded next (a take: from here to there).
func sample_now() -> int:
	return first_index + count


func available() -> bool:
	return count > int(RATE)


# ---- recording

func _physics_process(dt: float) -> void:
	if playing or viewer or get_tree().paused or cars.is_empty():
		return
	_record_in -= dt
	if _record_in > 0.0:
		return
	_record_in += 1.0 / RATE
	var row := PackedFloat32Array()
	row.resize(cars.size() * STRIDE)
	for n in cars.size():
		if is_instance_valid(cars[n]):
			_write(row, n * STRIDE, cars[n])
	samples.append_array(row)
	soft.record(cars, count)
	if extras == null:
		extras = ReplayExtras.new(self)
	extras.record()
	count += 1
	var most := int(MAX_SECONDS * RATE)
	if count > most + int(RATE * 60.0):
		# (the oldest minute goes at once: not a copy every sample)
		var drop := count - most
		samples = samples.slice(drop * cars.size() * STRIDE)
		count -= drop
		soft.trim(drop)
		first_index += drop
		fx.trim(start_time())


static func _write(row: PackedFloat32Array, o: int, c: Car) -> void:
	var xf := c.global_transform
	var q := xf.basis.get_rotation_quaternion()
	var v := c.linear_velocity
	var squeal := 0.0
	for w in c.wheels:
		squeal = maxf(squeal, w.squeal)
	var vals := [xf.origin.x, xf.origin.y, xf.origin.z, q.x, q.y, q.z, q.w, v.x, v.y, v.z, c.steer_angle, c.engine.omega,
		c.engine.throttle_used, c.brake_input, c.gear, 1.01 + clampf(squeal, 0.0, 1.0)]
	for i in vals.size():
		row[o + i] = vals[i]
	for k in 4:
		var w := c.wheels[k]
		var p := o + CAR_FIELDS + k * WHEEL_FIELDS
		row[p] = w.length
		row[p + 1] = w.steer
		row[p + 2] = w.spin


# ---- playback

## Starts the replay (the game is paused). A replay of the game begins at the start, wound back; a file plays at once.
func play() -> void:
	if playing or count < 2:
		return
	playing = true
	running = viewer
	direction = 1.0
	time = start_time()
	_saved.clear()
	for c in cars:
		if not is_instance_valid(c):
			_saved.append(null)
			continue
		var ws: Array = []
		for w in c.wheels:
			ws.append([w.length, w.steer, w.spin, w.omega, w.squeal])
		_saved.append({"xf": c.global_transform, "v": c.linear_velocity, "av": c.angular_velocity, "omega": c.engine.omega,
			"wheels": ws, "mode": c.process_mode, "interp": c.physics_interpolation_mode, "steer": c.steer_angle, "gear": c.gear})
		if c.shell_tyres != null:
			c.shell_tyres.freeze_for_replay()
		c.process_mode = Node.PROCESS_MODE_ALWAYS
		c.set_physics_process(false)
		c.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	var cam := game_camera()
	if cam != null:
		_camera_was = cam.car
		_cam_mode_was = cam.mode
		cam.process_mode = Node.PROCESS_MODE_ALWAYS
		target = maxi(0, cars.find(cam.car))
	# (the free camera of the game has no place in a replay, which has its own)
	var gfree: Variant = world.get("free_cam") if world != null else null
	if gfree != null and gfree.active:
		gfree.leave()
		if cam != null:
			cam.make_current()
			cam.mode = ChaseCamera.Mode.FOLLOW
	_set_hud(false)
	free = ReplayFreeCamera.new()
	free.body_of = car_body
	free.car_count = cars.size()
	free.target = target
	add_child(free)
	bar = ReplayBar.new()
	bar.setup(self)
	add_child(bar)
	soft.begin(cars)
	if fx != null:
		fx.begin()
	_show(time)
	RunLog.event("replay: %.1f s of recording" % duration())


## Back to the game, where it was left (a file: back to the main menu).
func stop() -> void:
	if not playing:
		return
	playing = false
	soft.end(cars)
	if fx != null:
		fx.end()
	if filming != null:
		filming.call("stop")
	for n in cars.size():
		var c := cars[n]
		var s: Variant = _saved[n] if n < _saved.size() else null
		if not is_instance_valid(c) or s == null:
			continue
		c.global_transform = s["xf"]
		c.linear_velocity = s["v"]
		c.angular_velocity = s["av"]
		c.engine.omega = s["omega"]
		c.steer_angle = s["steer"]
		c.gear = s["gear"]
		for k in 4:
			var ws: Array = s["wheels"][k]
			c.wheels[k].length = ws[0]
			c.wheels[k].steer = ws[1]
			c.wheels[k].spin = ws[2]
			c.wheels[k].omega = ws[3]
			c.wheels[k].squeal = ws[4]
		c.process_mode = s["mode"]
		c.set_physics_process(true)
		c.physics_interpolation_mode = s["interp"]
		c.reset_physics_interpolation()
	_sound(false)
	if free != null:
		free.leave()
		free.queue_free()
		free = null
	for node in [_cine_cam, _track_cam]:
		if node != null:
			node.queue_free()
	_cine_cam = null
	_track_cam = null
	cine_on = false
	var cam := game_camera()
	if cam != null:
		cam.car = _camera_was
		cam.mode = _cam_mode_was as ChaseCamera.Mode
		cam.process_mode = Node.PROCESS_MODE_INHERIT
		cam.make_current()
		cam.snap()
	_set_hud(true)
	if bar != null:
		bar.queue_free()
		bar = null
	RunLog.event("replay closed")
	closed.emit()


func game_camera() -> ChaseCamera:
	return world.get("camera") as ChaseCamera if world != null else null


func car_body(i: int) -> Node3D:
	return cars[clampi(i, 0, cars.size() - 1)] if not cars.is_empty() else null


func _set_hud(on: bool) -> void:
	var hud: Variant = world.get("hud") if world != null else null
	if hud is CanvasLayer:
		(hud as CanvasLayer).visible = on
	elif hud is CanvasItem:
		(hud as CanvasItem).visible = on


## The sound of the replay: the engine and the tyres of the player's car, while it plays forwards.
func _sound(live: bool) -> void:
	var audio: Variant = world.get("audio") if world != null else null
	if audio is Node:
		(audio as Node).process_mode = Node.PROCESS_MODE_ALWAYS if live else Node.PROCESS_MODE_INHERIT


func _process(delta: float) -> void:
	if not playing:
		return
	if running and not scrubbing and filming == null and editor == null:
		time += direction * speed * delta
		if time >= end_time():
			time = end_time()
			if direction > 0.0:
				running = false
		if time <= start_time():
			time = start_time()
			if direction < 0.0:
				running = false
	# (a held arrow keeps stepping, frame after frame; not while the free camera moves with them: Move camera)
	if editor == null and not free.moving and (Input.is_physical_key_pressed(KEY_LEFT) or Input.is_physical_key_pressed(KEY_RIGHT)):
		_step_held += delta
		if _step_held > 0.35:
			step_frame(1 if Input.is_physical_key_pressed(KEY_RIGHT) else -1)
	else:
		_step_held = 0.0
	_show(time)
	if fx != null:
		fx.show(time)
	# (a video: the cameras move once per picture, with the step of the picture; ReplayFilm)
	if filming == null:
		_cameras(delta)
	elif filming.get("stepped"):
		_cameras(1.0 / ReplayFilm.FPS)
	var live := (running or editor_playing or filming != null) and not scrubbing and direction > 0.0
	_sound(live)
	frame_shown.emit(time)


## Puts the cars where they were at time t (between two samples: in between).
func _show(t: float) -> void:
	if count < 2:
		return
	var f := clampf(t * RATE - first_index, 0.0, count - 1.0)
	var i := mini(int(f), count - 2)
	var u := f - i
	var per := cars.size() * STRIDE
	for n in cars.size():
		var c := cars[n]
		if not is_instance_valid(c):
			continue
		var a := i * per + n * STRIDE
		var b := a + per
		if samples[a + P_PRESENT] < 0.5:
			continue
		var pa := Vector3(samples[a], samples[a + 1], samples[a + 2])
		var pb := Vector3(samples[b], samples[b + 1], samples[b + 2])
		var k := u if pa.distance_to(pb) < JUMP else 0.0
		var qa := Quaternion(samples[a + 3], samples[a + 4], samples[a + 5], samples[a + 6]).normalized()
		var qb := Quaternion(samples[b + 3], samples[b + 4], samples[b + 5], samples[b + 6]).normalized()
		c.global_transform = Transform3D(Basis(qa.slerp(qb, k)), pa.lerp(pb, k))
		c.linear_velocity = Vector3(samples[a + P_VEL], samples[a + P_VEL + 1], samples[a + P_VEL + 2]).lerp(
			Vector3(samples[b + P_VEL], samples[b + P_VEL + 1], samples[b + P_VEL + 2]), k)
		c.speed = c.linear_velocity.dot(c.global_transform.basis.z)
		c.replay_speed = c.linear_velocity.length() if (running or editor_playing or filming != null) and not scrubbing else 0.0
		c.steer_angle = lerpf(samples[a + P_STEER], samples[b + P_STEER], k)
		c.engine.omega = lerpf(samples[a + P_OMEGA], samples[b + P_OMEGA], k)
		c.engine.throttle_used = lerpf(samples[a + P_THROTTLE], samples[b + P_THROTTLE], k)
		c.brake_input = lerpf(samples[a + P_BRAKE], samples[b + P_BRAKE], k)
		c.throttle_input = c.engine.throttle_used
		c.gear = int(samples[a + P_GEAR])
		var squeal := clampf(samples[a + P_PRESENT] - 1.01, 0.0, 1.0)
		for w in 4:
			var p := CAR_FIELDS + w * WHEEL_FIELDS
			var wh := c.wheels[w]
			wh.length = lerpf(samples[a + p], samples[b + p], k)
			wh.steer = lerpf(samples[a + p + 1], samples[b + p + 1], k)
			wh.spin = lerp_angle(samples[a + p + 2], samples[b + p + 2], k)
			wh.squeal = squeal if running or editor_playing or filming != null else 0.0
		if n == 0:
			info = {"speed": c.linear_velocity.length(), "gear": c.gear_name(), "rpm": c.engine.rpm(),
				"throttle": c.engine.throttle_used, "brake": c.brake_input}
	soft.show(cars, f)


## The sample of a car at a time, as numbers (the video editor bakes a new recording from these).
func sample_at(t: float, n: int) -> PackedFloat32Array:
	var out := PackedFloat32Array()
	out.resize(STRIDE)
	var f := clampf(t * RATE - first_index, 0.0, count - 1.0)
	var i := mini(int(f), count - 2)
	var u := f - i
	var a := i * cars.size() * STRIDE + n * STRIDE
	var b := a + cars.size() * STRIDE
	var pa := Vector3(samples[a], samples[a + 1], samples[a + 2])
	var pb := Vector3(samples[b], samples[b + 1], samples[b + 2])
	var k := u if pa.distance_to(pb) < JUMP else 0.0
	for j in STRIDE:
		out[j] = lerpf(samples[a + j], samples[b + j], k)
	var q := Quaternion(samples[a + 3], samples[a + 4], samples[a + 5], samples[a + 6]).normalized().slerp(
		Quaternion(samples[b + 3], samples[b + 4], samples[b + 5], samples[b + 6]).normalized(), k)
	out[3] = q.x
	out[4] = q.y
	out[5] = q.z
	out[6] = q.w
	out[P_GEAR] = samples[a + P_GEAR]
	out[P_PRESENT] = samples[a + P_PRESENT]
	for w in 4:
		var p := CAR_FIELDS + w * WHEEL_FIELDS + 2
		out[p] = lerp_angle(samples[a + p], samples[b + p], k)
	return out


# ---- the controls

func toggle_play() -> void:
	running = not running
	if running and direction > 0.0 and time >= end_time() - 0.01:
		time = start_time()


func play_forward() -> void:
	direction = 1.0
	running = true
	if time >= end_time() - 0.01:
		time = start_time()


func rewind() -> void:
	direction = -1.0
	running = true


func jump(dt: float) -> void:
	time = clampf(time + dt, start_time(), end_time())


func seek(t: float) -> void:
	time = clampf(t, start_time(), end_time())


## One frame (a sample) back or forward: it pauses and lands on the sample before or after.
func step_frame(dir: int) -> void:
	running = false
	var i := time * RATE
	var k := floori(i + 1e-6) + 1 if dir > 0 else ceili(i - 1e-6) - 1
	time = clampf(k / RATE, start_time(), end_time())


func set_mark(which: String) -> void:
	if which == "in":
		mark_in = time
		if mark_out >= 0.0 and mark_out <= mark_in:
			mark_out = -1.0
	else:
		mark_out = time
		if mark_in >= 0.0 and mark_in >= mark_out:
			mark_in = -1.0


## The fragment, in seconds: [from, to]; [] when it is less than half a second.
func fragment() -> Array:
	var a := maxf(start_time(), mark_in if mark_in >= 0.0 else start_time())
	var b := minf(end_time(), mark_out if mark_out >= 0.0 else end_time())
	return [a, b] if b - a >= 0.5 else []


func next_car() -> void:
	if cars.size() < 2:
		return
	free.next_target()
	target = free.target


func _input(event: InputEvent) -> void:
	if not playing or editor != null or not (event is InputEventKey) or not event.pressed:
		return
	if filming != null:
		if event.physical_keycode == KEY_ESCAPE:
			filming.call("stop")
			get_viewport().set_input_as_handled()
		return
	if get_viewport().gui_get_focus_owner() is LineEdit:
		return
	var handled := true
	var code: Key = event.physical_keycode
	if free.active and code in [KEY_F, KEY_L, KEY_K] and not event.echo:
		if code == KEY_F:
			free.toggle_aim()
		elif code == KEY_L:
			free.toggle_parent()
		else:
			free.toggle_sky()
	elif free.moving and code in [KEY_LEFT, KEY_RIGHT, KEY_UP, KEY_DOWN, KEY_SPACE, KEY_BRACKETLEFT, KEY_BRACKETRIGHT, KEY_SHIFT, KEY_CTRL, KEY_ALT]:
		pass                          # (the free camera moves with them)
	else:
		match code:
			KEY_ESCAPE:
				if free.moving:
					free.stop_moving()
				elif bar != null and bar.dialog_open():
					bar.close_dialog()
				else:
					exit()
			KEY_ENTER, KEY_KP_ENTER, KEY_SPACE:
				toggle_play()
			KEY_LEFT:
				step_frame(-1)
			KEY_RIGHT:
				step_frame(1)
			KEY_UP:
				jump(1.0)
			KEY_DOWN:
				jump(-1.0)
			KEY_HOME:
				jump(-1e9)
			KEY_END:
				jump(1e9)
			KEY_T:
				next_camera()
			KEY_TAB:
				next_car()
			KEY_I:
				if not event.echo:
					set_mark("in")
			KEY_O:
				if not event.echo:
					set_mark("out")
			KEY_H:
				if bar != null and not event.echo:
					bar.toggle_hidden()
			KEY_F2:
				if bar != null:
					bar.photo()
			KEY_BRACKETLEFT, KEY_BRACKETRIGHT:
				handled = cine_on
			_:
				handled = false
	if handled:
		get_viewport().set_input_as_handled()


func exit() -> void:
	stop()
	if viewer:
		get_tree().paused = false
		world.leave.emit()
	elif world != null and world.has_method("resume"):
		world.resume()


# ---- the cameras: the three of the game, the free one, the cinematic one; the camera track of a file

## "follow", "cockpit", "bonnet", "free" or "cinematic"
func camera_name() -> String:
	if free != null and free.active:
		return "free"
	if cine_on:
		return "cinematic"
	var cam := game_camera()
	return ["follow", "cockpit", "bonnet"][cam.mode] if cam != null else "follow"


func set_camera(which: String) -> void:
	var cam := game_camera()
	if which == "free":
		_leave_cine()
		if not free.active:
			var from := get_viewport().get_camera_3d()
			free.target = target
			free.enter(from if from != null else cam)
		return
	if free.active:
		free.leave()
	if which == "cinematic":
		if cinema_cameras().is_empty():
			return
		cine_on = true
		_cine_index = -1
		if _cine_cam == null:
			_cine_cam = _camera("Cinematic")
		_cine_cam.make_current()
		return
	_leave_cine()
	if cam != null:
		cam.make_current()
		var m: int = {"follow": ChaseCamera.Mode.FOLLOW, "cockpit": ChaseCamera.Mode.COCKPIT, "bonnet": ChaseCamera.Mode.BONNET}.get(which, 0)
		if cam.mode != m:
			cam.mode = m as ChaseCamera.Mode
			cam.snap()


## T: follow, cockpit, bonnet, free, cinematic (when the track has cameras), and follow again.
func next_camera() -> void:
	var order := ["follow", "cockpit", "bonnet", "free"]
	if not cinema_cameras().is_empty():
		order.append("cinematic")
	set_camera(order[(order.find(camera_name()) + 1) % order.size()])


func _leave_cine() -> void:
	if cine_on:
		cine_on = false
		var cam := game_camera()
		if cam != null:
			cam.make_current()


func _camera(n: String) -> Camera3D:
	var c := Camera3D.new()
	c.name = n
	c.far = 4000.0
	c.near = 0.03
	c.process_mode = Node.PROCESS_MODE_ALWAYS
	c.physics_interpolation_mode = Node.PHYSICS_INTERPOLATION_MODE_OFF
	add_child(c)
	return c


## The cameras that the track editor put in the track (track.json "cameras").
func cinema_cameras() -> Array:
	var tr: Variant = world.get("track") if world != null else null
	if tr == null:
		return []
	var out: Array = []
	for c in tr.config.get("cameras", []):
		if c is Dictionary and c.has("x") and c.has("y") and c.has("z"):
			out.append(c)
	return out


func _cameras(delta: float) -> void:
	var cam := game_camera()
	if cam != null and target < cars.size() and is_instance_valid(cars[target]) and cam.car != cars[target]:
		cam.car = cars[target]
		cam.snap()
	if camera_override.is_valid():
		var pose: Array = camera_override.call(time)
		if not pose.is_empty():
			if _track_cam == null:
				_track_cam = _camera("Track")
			_track_cam.global_transform = pose[0]
			_track_cam.fov = pose[1]
			if not _track_cam.current:
				_track_cam.make_current()
			return
	if free != null and free.active:
		free.update(delta)
	elif cine_on:
		update_cine(delta)
	else:
		_file_camera()


## The cinematic camera: the camera of the track whose range (a circle on the floor) the car is in, else the
## nearest (it changes only when another is clearly better); it stays where it is and turns to follow the car,
## its field of view chosen so that the car is about the same size in the picture.
func update_cine(delta: float) -> void:
	var list := cinema_cameras()
	var body := car_body(target)
	if list.is_empty() or body == null or _cine_cam == null:
		return
	delta = minf(delta, 0.1)
	var bp := body.global_position
	var score := func(c: Dictionary) -> float:
		var r: Dictionary = c["range"] if c.get("range") is Dictionary and float(c["range"].get("r", 0)) > 0.0 else {"x": c["x"], "z": c["z"], "r": 0.0}
		var away := Vector2(bp.x - float(r["x"]), bp.z - float(r["z"])).length()
		return away / float(r["r"]) if away < float(r["r"]) else 1.0 + (away - float(r["r"]))
	var nearest := 0
	for i in list.size():
		if score.call(list[i]) < score.call(list[nearest]):
			nearest = i
	var cut := false
	if _cine_index < 0 or _cine_index >= list.size():
		_cine_index = nearest
		cut = true
	elif nearest != _cine_index and score.call(list[nearest]) < score.call(list[_cine_index]) * 0.85:
		_cine_index = nearest
		cut = true
	var c: Dictionary = list[_cine_index]
	var at := Vector3(float(c["x"]), float(c["y"]), float(c["z"]))
	var lead := cine_override if cine_override >= 0.0 else cine_lead
	var look := bp + Vector3.UP * 0.7
	if lead > 0.0:
		var fwd := body.global_transform.basis.z
		fwd.y = 0.0
		if fwd.length() > 1e-3:
			look += fwd.normalized() * lead
	var want := Basis.looking_at(look - at, Vector3.UP).get_rotation_quaternion() if (look - at).length() > 1e-3 else _cine_quat
	_cine_quat = want if cut else _cine_quat.slerp(want, 1.0 - exp(-8.0 * delta))
	var zoom := (1.0 if Input.is_physical_key_pressed(KEY_BRACKETRIGHT) else 0.0) - (1.0 if Input.is_physical_key_pressed(KEY_BRACKETLEFT) else 0.0)
	if zoom != 0.0 and editor == null:
		cine_scale = clampf(cine_scale * exp(zoom * 0.9 * delta), 0.2, 3.0)
	var wanted := clampf(rad_to_deg(2.0 * atan(9.0 / maxf(5.0, at.distance_to(bp)))), 14.0, 60.0) * cine_scale
	wanted = clampf(wanted, 3.0, 110.0)
	_cine_fov = wanted if cut else _cine_fov + (wanted - _cine_fov) * (1.0 - exp(-4.0 * delta))
	_cine_cam.global_transform = Transform3D(Basis(_cine_quat), at)
	_cine_cam.fov = _cine_fov


## The cinematic camera of the track live, in the game after the finish (Replay.js liveCine): false when the track has
## no cameras.
func live_cine(delta: float) -> bool:
	if cinema_cameras().is_empty() or cars.is_empty():
		return false
	if _cine_cam == null:
		_cine_cam = _camera("Cinematic")
		_cine_index = -1
	target = 0
	update_cine(delta)
	if not _cine_cam.current:
		_cine_cam.make_current()
	return true


func live_cine_off() -> void:
	if _cine_cam != null and not playing:
		_cine_cam.queue_free()
		_cine_cam = null


## The camera of a clip of the video editor: "follow", "cockpit", "cinematic" or "track" (lead: the look ahead).
func set_clip_camera(mode: String, lead := -1.0) -> void:
	cine_override = lead if mode == "cinematic" and lead >= 0.0 else -1.0
	if free != null and free.active:
		return
	if mode == "cinematic":
		if not cine_on and not cinema_cameras().is_empty():
			set_camera("cinematic")
		return
	if cine_on:
		_leave_cine()
	var cam := game_camera()
	if cam != null:
		if not cam.current and (_track_cam == null or not _track_cam.current):
			cam.make_current()
		var m := ChaseCamera.Mode.COCKPIT if mode == "cockpit" else ChaseCamera.Mode.FOLLOW
		if cam.mode != m:
			cam.mode = m
			cam.snap()


## A file made in the video editor: its camera track, the cameras of its clips (runs of samples) and its zoom.
func _file_camera() -> void:
	if editor != null or (_cam_keys.is_empty() and _cam_runs.is_empty()):
		return
	var mode := "track"
	if not _cam_runs.is_empty():
		var at := roundi(time * RATE - first_index)
		var lo := 0
		var hi := _cam_runs.size() - 1
		while lo < hi:
			var mid := (lo + hi + 1) >> 1
			if int(_cam_runs[mid][0]) <= at:
				lo = mid
			else:
				hi = mid - 1
		var run: Array = _cam_runs[lo]
		mode = str(run[1])
		if _run_shown != run:
			_run_shown = run
			set_clip_camera(mode, float(run[2]) if run.size() > 2 else -1.0)
	if mode == "track" and not _cam_keys.is_empty():
		if _track_cam == null:
			_track_cam = _camera("Track")
		CameraTrack.apply(_cam_keys, time - start_time(), _track_cam, car_body)
		if not _track_cam.current:
			_track_cam.make_current()
	elif _track_cam != null and _track_cam.current:
		var cam := game_camera()
		if cam != null:
			cam.make_current()


## (late in the frame, after every camera has moved: the zoom of a file on whichever camera shows it)
func _late_frame() -> void:
	if not playing or _zoom_rows.is_empty() or editor != null or (free != null and free.active):
		return
	var z := float(_zoom_rows[clampi(roundi(time * RATE - first_index), 0, _zoom_rows.size() - 1)])
	var cam := get_viewport().get_camera_3d()
	if cam != null and z > 0.0 and absf(z - 1.0) > 1e-4:
		cam.fov = clampf(cam.fov / z, 2.0, 150.0)


# ---- the files (ReplayFiles reads and writes them)

## The recording as a file (Dictionary): all of it, or the samples from a to b (numbers of samples, b not in it).
func pack(a := -1, b := -1) -> Dictionary:
	var from := first_index if a < 0 else clampi(a, first_index, first_index + count)
	var to := first_index + count if b < 0 else clampi(b, from, first_index + count)
	var per := cars.size() * STRIDE
	var part := samples.slice((from - first_index) * per, (to - first_index) * per)
	var ids: Array = []
	var names: Array = []
	for c in cars:
		ids.append(c.car_id if is_instance_valid(c) else "")
		names.append(str(c.config.get("name", c.car_id)) if is_instance_valid(c) else "")
	var track_id := str(cars[0].get_meta("track_id", "")) if not cars.is_empty() else ""
	var track_name := str(cars[0].get_meta("track_name", track_id)) if not cars.is_empty() else ""
	return {"version": ReplayFiles.VERSION, "track": track_id, "track_name": track_name, "cars": ids, "names": names, "rate": RATE,
		"count": to - from, "stride": STRIDE, "samples": part, "created": Time.get_datetime_string_from_system(),
		"soft": (soft.save_data() if a < 0 and b < 0 else soft.part(from - first_index, to - first_index)) if soft != null and to > from else [],
		"fx": fx.pack(from / RATE, to / RATE) if fx != null and to > from else {}}


## Saves the whole recording (Save replay); the path, or "" when it failed. A second save of the same is not made.
func save() -> String:
	if count < 2:
		return ""
	if saved_count == count and file_path != "":
		return file_path
	var data := pack()
	var keep := header.duplicate() if viewer else {}
	for k in ["camera", "cams", "zoom", "project", "edit", "name"]:
		if keep.has(k):
			data[k] = keep[k]
	var p := ReplayFiles.write(data, "")
	if p != "":
		file_path = p
		saved_count = count
	return p


## Puts a file in place of the recording (a viewer): the cars (the first the world's own, the others made here).
func open_file(path: String, w: Node, first: Car, watch_edit := true) -> bool:
	var data := ReplayFiles.read(path)
	if data.is_empty():
		return false
	is_edit = watch_edit and data.get("edit") is Dictionary
	if is_edit:
		var edit: Dictionary = data["edit"]
		for k in ["track", "track_name", "cars", "names"]:
			edit[k] = data[k]
		header = edit
		data = edit
	else:
		header = data
	world = w
	name = "Replay"
	process_mode = Node.PROCESS_MODE_ALWAYS
	process_priority = -10
	viewer = true
	file_path = path
	cars = [first]
	var ids: Array = data["cars"]
	for k in range(1, ids.size()):
		var c := Car.new()
		var cfg: Variant = Content.load_json("cars/%s/car.json" % ids[k])
		c.setup(str(ids[k]), cfg if cfg is Dictionary else {})
		c.make_ghost()
		for m in c.find_children("*", "MeshInstance3D", true, false):
			(m as MeshInstance3D).transparency = 0.0
			(m as MeshInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
		w.add_child(c)
		cars.append(c)
	if data.get("browser", false):
		ReplayFiles.fit_browser(data, cars)
	samples = data["samples"]
	count = int(data["count"])
	first_index = 0
	saved_count = count
	_cam_keys = CameraTrack.clean(data.get("camera", []))
	_cam_runs = []
	for r in data.get("cams", []):
		if r is Array and r.size() >= 2 and str(r[1]) in ["follow", "cockpit", "cinematic", "track"]:
			_cam_runs.append(r)
	_zoom_rows = data.get("zoom", []) if data.get("zoom") is Array else []
	soft = ReplaySoft.new(cars)
	soft.load_data(data.get("soft"), cars)
	fx = ReplayFx.new(self)
	fx.record()
	fx.unpack(data.get("fx"))
	extras = ReplayExtras.new(self)
	extras.attach_all()
	if fx.rows.has("pieces") or fx.rows.has("shards"):
		Shatter.of(w)                 # (the pieces and the shards of what broke: nothing breaks in a viewer to make it)
	return true


## A new recording from this one: the time (s) of every sample of it (the video editor). extra: more for the file
## (the camera track, the cameras of the clips, the zoom, the name).
func bake(times: Array, extra := {}) -> Dictionary:
	var out := pack(first_index, first_index)
	var data := PackedFloat32Array()
	for t in times:
		for n in cars.size():
			data.append_array(sample_at(t, n))
	out["samples"] = data
	out["count"] = times.size()
	for k in extra:
		out[k] = extra[k]
	return out


## Before the game goes back to the main menu: a recording of a minute or more that was not saved asks whether it
## should be (then calls leave); otherwise leave is called at once.
func confirm_leave(leave: Callable, layer: CanvasLayer) -> void:
	if viewer or playing or not available() or saved_count == count or count / RATE < 60.0:
		leave.call()
		return
	var minutes := roundi(count / RATE / 60.0)
	ReplayBar.ask(layer, "Save the replay?", "The drive on %s (%d:%02d) can be kept in Replays in the main menu. If you do not save it, it is gone." % [
		cars[0].get_meta("track_name", ""), minutes / 60, minutes % 60], [["Cancel", Callable()], ["Don't save", leave],
		["Save replay", func():
			save()
			leave.call()]])

