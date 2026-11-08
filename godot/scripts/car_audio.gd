class_name CarAudio
extends Node
## The sound of a car: the engine (EngineSimSynth, the native port of the engine sound of the browser game, fed to
## an AudioStreamGenerator) and the squeal of the tyres (web/sounds/tyre-squeal.wav, pitched with the speed and as
## loud as the tyres slide, the way web/js/EngineSound.js plays it). The player's car is heard as it is; an AI car
## is heard where it is (3D), with a lighter simulation, and only while it is one of the nearest (audible).
## The player's car also has the road under its tyres (the hiss, crunch or squelch of loose ground) and the thud of a
## landing or of the bump stop hit hard: noise made here, as EngineSound.js makes it (setGround, impact).

const MIX_RATE := 44100.0
# the ground and the thuds (EngineSound.js GROUND_SOUND: the centre of the filter, the loudness, the Q, the filter)
const GROUND_SOUND := {
	"sand": [700.0, 0.5, 0.5, "lowpass"], "gravel": [2600.0, 1.2, 0.8, "bandpass"], "mud": [380.0, 0.7, 0.7, "lowpass"],
	"grass": [1100.0, 0.5, 0.35, "lowpass"], "ground": [1500.0, 0.7, 0.5, "lowpass"],
}
const FX_RATE := 22050
const THUD_STEPS := 4                 # the thuds are made at 4 strengths, the nearest is played

static var _ground_streams := {}      # kind -> the looped noise through its filter
static var _thud_streams: Array = []

var car: Car
var inside := false
var synth: Object = null
var positional := false
var audible := true
var engine_player: Node              # AudioStreamPlayer, or AudioStreamPlayer3D for an AI car
var playback: AudioStreamGeneratorPlayback
var squeal_player: Node
var ground_players := {}              # kind -> AudioStreamPlayer (made the first time the car is on it)
var ground_kind := ""                 # what the tyres are on now ("" the road)
var thud_player: AudioStreamPlayer
var sound_log: Array = []             # what was played: [time, what, strength] (the tests; the last 64)
var _squeal_volume := 0.0
var _squeal_pitch := 1.0
var _ground_volume := {}
var _had_contact := [false, false, false, false]


func setup(c: Car, in_3d := false) -> void:
	car = c
	positional = in_3d
	name = "Audio"
	if ClassDB.class_exists("EngineSimSynth"):
		synth = ClassDB.instantiate("EngineSimSynth")
		var p := EngineSimParams.params(car.config)
		var o := EngineSimParams.options(p)
		if positional:
			# (an AI car: half the rate of the simulation, one step of the gas a step: a seventh of the cost)
			o["simulation_frequency"] = minf(float(o["simulation_frequency"]), 5000.0)
			o["fluid_steps"] = 1
		synth.configure(o, MIX_RATE)
		var ir_file: String = EngineSimParams.IMPULSE_RESPONSES.get(str(p["impulse_response"]), "smooth_39.wav")
		var bytes := FileAccess.get_file_as_bytes(Content.path("sounds/ir/" + ir_file))
		if bytes.size() > 0:
			synth.set_impulse_response_wav(bytes)
		var gen := AudioStreamGenerator.new()
		gen.mix_rate = MIX_RATE
		gen.buffer_length = 0.08
		engine_player = _player()
		engine_player.stream = gen
	else:
		push_warning("CarAudio: the native engine sound (EngineSimSynth) is not loaded: build godot/native (see README)")
	car.bang.connect(func(e: Dictionary):
		if synth != null and audible:
			synth.pop(600.0 * float(e.get("strength", 1.0)) * float(e.get("loud", 1.0))))
	var squeal := AudioStreamWAV.load_from_file(Content.path("sounds/tyre-squeal.wav"))
	if squeal != null:
		squeal.loop_mode = AudioStreamWAV.LOOP_FORWARD
		squeal.loop_begin = 0
		squeal.loop_end = int(squeal.get_length() * squeal.mix_rate)
		squeal_player = _player()
		squeal_player.stream = squeal
		squeal_player.volume_db = -80.0
	if not positional:
		thud_player = AudioStreamPlayer.new()
		thud_player.max_polyphony = 4
		add_child(thud_player)


## A player of the sound: for an AI car in 3D, on the car (a plain Node between would cut it off from where the car is).
func _player() -> Node:
	if not positional:
		var p := AudioStreamPlayer.new()
		add_child(p)
		return p
	var p3 := AudioStreamPlayer3D.new()
	p3.unit_size = 10.0
	p3.max_distance = 220.0
	p3.attenuation_model = AudioStreamPlayer3D.ATTENUATION_INVERSE_DISTANCE
	p3.doppler_tracking = AudioStreamPlayer3D.DOPPLER_TRACKING_PHYSICS_STEP
	car.add_child(p3)
	return p3


## An AI car is heard only while it is one of the nearest: the others make no sound (and cost nothing).
func set_audible(on: bool) -> void:
	if on == audible:
		return
	audible = on
	for p in [engine_player, squeal_player]:
		if p == null:
			continue
		if on:
			p.play()
		else:
			p.stop()
	if on and engine_player != null:
		playback = engine_player.get_stream_playback()


func _ready() -> void:
	if engine_player != null:
		engine_player.play()
		playback = engine_player.get_stream_playback()
	if squeal_player != null:
		squeal_player.play()


func _process(delta: float) -> void:
	if car == null:
		return
	if engine_player != null:
		# (the engine sound on or off: Settings "sound", the key E)
		var on := 1.0 if Settings.get_value("sound") else 0.0
		engine_player.volume_db = linear_to_db(maxf(1e-4, on * float(Settings.get_value("volume")) / 0.8))
	if not audible:
		return
	if synth != null and playback != null:
		synth.set_rpm(car.engine.rpm())
		synth.set_throttle(car.engine.throttle_used)
		synth.set_ignition(not car.engine.cut)
		var frames := playback.get_frames_available()
		if frames > 0:
			playback.push_buffer(synth.generate(frames))
	if squeal_player != null:
		# a tyre that only starts to slide is silent; the sound comes in from a good slide, and slowly
		var amount := 0.0
		for w in car.wheels:
			amount = maxf(amount, w.squeal)
		amount = maxf(0.0, (amount - 0.1) / 0.9)
		var loud := float(Settings.get_value("tyre_volume")) * (0.12 if inside else 0.3) * 0.75 * 2.5 * pow(amount, 1.6)
		var rate := 0.12 if loud > _squeal_volume else 0.08
		_squeal_volume = lerpf(_squeal_volume, loud, 1.0 - exp(-delta / rate))
		_squeal_pitch = lerpf(_squeal_pitch, 0.85 + minf(1.0, absf(car.speed) / 40.0) * 0.4 + amount * 0.1, 1.0 - exp(-delta / 0.1))
		squeal_player.volume_db = linear_to_db(maxf(_squeal_volume, 1e-5))
		squeal_player.pitch_scale = _squeal_pitch


## The landings and the bump stop, at the rate of the physics (EngineSound.impact: a landing faster than 3 m/s down,
## the bump stop hit faster than 2.5 m/s; Car.sound_impact is set by the suspension).
func _physics_process(_dt: float) -> void:
	if car == null or positional:
		return
	if ReplayFx.active:
		# (a replay: the gravel and the grass of the moment it began are not heard over it)
		car.sound_impact = 0.0
		# (but a road of dirt or gravel is heard as long as the replay plays: all of it is that ground)
		_ground_under(Ground.road_sound if car.replay_speed > 2.0 else "", car.replay_speed)
		return
	var vy := car.linear_velocity.y
	for i in 4:
		var c: bool = car.wheels[i].contact
		if c and not _had_contact[i] and vy < -3.0:
			car.sound_impact = maxf(car.sound_impact, minf(1.0, -vy / 12.0))
		_had_contact[i] = c
	if car.sound_impact > 0.12:
		impact(car.sound_impact)
	car.sound_impact = 0.0
	_ground(car.speed)


## A thud: low noise and a falling tone, as loud as the hit was hard (0..1; under 0.12 nothing).
func impact(strength: float) -> void:
	if thud_player == null or not Settings.get_value("sound") or not is_finite(strength) or strength < 0.12:
		return
	strength = minf(1.0, strength)
	if _thud_streams.is_empty():
		for k in THUD_STEPS:
			_thud_streams.append(_make_thud(float(k + 1) / THUD_STEPS))
	var k := clampi(roundi(strength * THUD_STEPS) - 1, 0, THUD_STEPS - 1)
	var v := float(Settings.get_value("volume")) * (0.7 if inside else 1.0)
	thud_player.stream = _thud_streams[k]
	# (made at half its height, so that the noise and the tone together do not clip)
	thud_player.volume_db = linear_to_db(maxf(1e-5, 2.0 * strength * v))
	thud_player.play()
	_log("thud", strength)


## The noise of the road under the tyres: the surface of a wheel that touches loose ground (not the road), louder and
## higher with the speed.
func _ground(speed: float) -> void:
	var under := ""
	for w in car.wheels:
		var heard := Ground.sound_surface(w.surface)
		if w.contact and heard != "road" and heard != "track01":
			under = heard
	_ground_under(under if GROUND_SOUND.has(under) else "", speed)


func _ground_under(under: String, speed := 0.0) -> void:
	if under != ground_kind:
		if under != "":
			_log("ground " + under, absf(speed))
		ground_kind = under
	if under != "" and not ground_players.has(under):
		var np := AudioStreamPlayer.new()
		np.stream = _ground_stream(under)
		np.volume_db = -80.0
		add_child(np)
		np.play()
		ground_players[under] = np
		_ground_volume[under] = 0.0
	var vol := float(Settings.get_value("volume"))
	var dt := get_physics_process_delta_time()
	for kind: String in ground_players:
		var spec: Array = GROUND_SOUND[kind]
		var loud := 0.0
		if kind == under:
			loud = minf(1.0, maxf(0.0, absf(speed) - 2.0) / 25.0) * float(spec[1]) * vol * (0.35 if inside else 0.5) * 0.25
		_ground_volume[kind] = lerpf(float(_ground_volume[kind]), loud, 1.0 - exp(-dt / 0.15))
		var p: AudioStreamPlayer = ground_players[kind]
		p.volume_db = linear_to_db(maxf(1e-5, float(_ground_volume[kind])))
		# (the filter higher with the speed: the noise is played faster, its filter goes up with it)
		if kind == under:
			p.pitch_scale = lerpf(p.pitch_scale, 0.7 + 0.5 * minf(1.0, absf(speed) / 30.0), 1.0 - exp(-dt / 0.2))


## The level of the noise of the ground now (linear), for the tests.
func ground_level() -> float:
	return float(_ground_volume.get(ground_kind, 0.0)) if ground_kind != "" else 0.0


func _log(what: String, strength: float) -> void:
	sound_log.append([Time.get_ticks_msec() / 1000.0, what, strength])
	if sound_log.size() > 64:
		sound_log.pop_front()
	if Content.arg("log-sound") != "":
		print("sound: %s %.2f" % [what, strength])


## Noise through a filter of the cookbook (RBJ): lowpass or bandpass at f, run twice so that the loop starts warm.
static func _filtered_noise(seconds: float, f: float, q: float, kind: String, rng: RandomNumberGenerator) -> PackedFloat32Array:
	var n := int(FX_RATE * seconds)
	var w0 := TAU * f / FX_RATE
	var alpha := sin(w0) / (2.0 * q)
	var c := cos(w0)
	var a0 := 1.0 + alpha
	var b0 := alpha / a0 if kind == "bandpass" else (1.0 - c) / 2.0 / a0
	var b1 := 0.0 if kind == "bandpass" else (1.0 - c) / a0
	var b2 := -b0 if kind == "bandpass" else b0
	var a1 := -2.0 * c / a0
	var a2 := (1.0 - alpha) / a0
	var src := PackedFloat32Array()
	src.resize(n)
	for i in n:
		src[i] = rng.randf() * 2.0 - 1.0
	var out := PackedFloat32Array()
	out.resize(n)
	var x1 := 0.0
	var x2 := 0.0
	var y1 := 0.0
	var y2 := 0.0
	for _pass in 2:
		for i in n:
			var x := src[i]
			var y := b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
			x2 = x1
			x1 = x
			y2 = y1
			y1 = y
			out[i] = y
	return out


static func _wav(samples: PackedFloat32Array, loop: bool) -> AudioStreamWAV:
	var bytes := PackedByteArray()
	bytes.resize(samples.size() * 2)
	for i in samples.size():
		bytes.encode_s16(i * 2, clampi(int(samples[i] * 32767.0), -32768, 32767))
	var wav := AudioStreamWAV.new()
	wav.format = AudioStreamWAV.FORMAT_16_BITS
	wav.mix_rate = FX_RATE
	wav.data = bytes
	if loop:
		wav.loop_mode = AudioStreamWAV.LOOP_FORWARD
		wav.loop_end = samples.size()
	return wav


static func _ground_stream(kind: String) -> AudioStreamWAV:
	if not _ground_streams.has(kind):
		var spec: Array = GROUND_SOUND[kind]
		var rng := RandomNumberGenerator.new()
		rng.seed = hash(kind)
		# (the Q of the lowpass of the Web Audio is in dB: 0.5 there is no peak, 0.707 here)
		var q := 0.8 if spec[3] == "bandpass" else 0.707
		_ground_streams[kind] = _wav(_filtered_noise(2.0, float(spec[0]), q, str(spec[3]), rng), true)
	return _ground_streams[kind]


## A thud of a strength, at half its height: noise through a lowpass at 260 + 500 strength Hz that dies in
## 0.18 + 0.3 strength s, and a tone that falls from 95 to 38 Hz in 0.22 s and dies in 0.25 s.
static func _make_thud(strength: float) -> AudioStreamWAV:
	var rng := RandomNumberGenerator.new()
	rng.seed = 7 + int(strength * 100.0)
	var n := int(FX_RATE * 0.6)
	var noise := _filtered_noise(0.6, 260.0 + 500.0 * strength, 0.707, "lowpass", rng)
	var out := PackedFloat32Array()
	out.resize(n)
	var t_noise := 0.18 + 0.3 * strength
	var phase := 0.0
	for i in n:
		var t := float(i) / FX_RATE
		var a := 0.9 * pow(0.001 / 0.9, t / t_noise) if t < t_noise else 0.0
		var f := 95.0 * pow(38.0 / 95.0, minf(1.0, t / 0.22))
		phase += TAU * f / FX_RATE
		var b := 0.7 * pow(0.001 / 0.7, t / 0.25) if t < 0.25 else 0.0
		out[i] = 0.5 * (noise[i] * a + sin(phase) * b)
	return _wav(out, false)


func set_inside(value: bool) -> void:
	inside = value
	if synth != null:
		synth.set_inside(value)


## The sound of the engine made again from car.json (the tuning menu changed it).
func reconfigure() -> void:
	if synth == null:
		return
	var p := EngineSimParams.params(car.config)
	var o := EngineSimParams.options(p)
	if positional:
		o["simulation_frequency"] = minf(float(o["simulation_frequency"]), 5000.0)
		o["fluid_steps"] = 1
	synth.configure(o, MIX_RATE)
	synth.set_inside(inside)


## The loudness of the engine sound now (the rms of the last frames), for the tests.
func engine_level() -> float:
	return synth.get_level() if synth != null else 0.0
