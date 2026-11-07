class_name CarAudio
extends Node
## The sound of a car: the engine (EngineSimSynth, the native port of the engine sound of the browser game, fed to
## an AudioStreamGenerator) and the squeal of the tyres (web/sounds/tyre-squeal.wav, pitched with the speed and as
## loud as the tyres slide, the way web/js/EngineSound.js plays it). The player's car is heard as it is; an AI car
## is heard where it is (3D), with a lighter simulation, and only while it is one of the nearest (audible).

const MIX_RATE := 44100.0

var car: Car
var inside := false
var synth: Object = null
var positional := false
var audible := true
var engine_player: Node              # AudioStreamPlayer, or AudioStreamPlayer3D for an AI car
var playback: AudioStreamGeneratorPlayback
var squeal_player: Node
var _squeal_volume := 0.0
var _squeal_pitch := 1.0


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
		engine_player.volume_db = linear_to_db(maxf(1e-4, float(Settings.get_value("volume")) / 0.8))
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
