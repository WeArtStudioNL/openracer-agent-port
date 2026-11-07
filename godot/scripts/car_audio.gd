class_name CarAudio
extends Node
## The sound of a car: the engine (EngineSimSynth, the native port of the engine sound of the browser game, fed to
## an AudioStreamGenerator) and the squeal of the tyres (web/sounds/tyre-squeal.wav, pitched with the speed and as
## loud as the tyres slide, the way web/js/EngineSound.js plays it).

const MIX_RATE := 44100.0

var car: Car
var inside := false
var synth: Object = null
var engine_player: AudioStreamPlayer
var playback: AudioStreamGeneratorPlayback
var squeal_player: AudioStreamPlayer
var _squeal_volume := 0.0
var _squeal_pitch := 1.0


func setup(c: Car) -> void:
	car = c
	name = "Audio"
	if ClassDB.class_exists("EngineSimSynth"):
		synth = ClassDB.instantiate("EngineSimSynth")
		var p := EngineSimParams.params(car.config)
		synth.configure(EngineSimParams.options(p), MIX_RATE)
		var ir_file: String = EngineSimParams.IMPULSE_RESPONSES.get(str(p["impulse_response"]), "smooth_39.wav")
		var bytes := FileAccess.get_file_as_bytes(Content.path("sounds/ir/" + ir_file))
		if bytes.size() > 0:
			synth.set_impulse_response_wav(bytes)
		var gen := AudioStreamGenerator.new()
		gen.mix_rate = MIX_RATE
		gen.buffer_length = 0.08
		engine_player = AudioStreamPlayer.new()
		engine_player.stream = gen
		add_child(engine_player)
	else:
		push_warning("CarAudio: the native engine sound (EngineSimSynth) is not loaded: build godot/native (see README)")
	var squeal := AudioStreamWAV.load_from_file(Content.path("sounds/tyre-squeal.wav"))
	if squeal != null:
		squeal.loop_mode = AudioStreamWAV.LOOP_FORWARD
		squeal.loop_begin = 0
		squeal.loop_end = int(squeal.get_length() * squeal.mix_rate)
		squeal_player = AudioStreamPlayer.new()
		squeal_player.stream = squeal
		squeal_player.volume_db = -80.0
		add_child(squeal_player)


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


## The loudness of the engine sound now (the rms of the last frames), for the tests.
func engine_level() -> float:
	return synth.get_level() if synth != null else 0.0
