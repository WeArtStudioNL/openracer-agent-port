extends SceneTree
## Renders the engine sound of a car to a wav file, at a few engine speeds (a test of the native engine sound):
##   Godot --headless --path godot --script res://tools/render_engine.gd -- --car=openracer-muscle --out=/tmp/engine.wav


func _init() -> void:
	await process_frame
	var content: Node = root.get_node("/root/Content")
	var car_id: String = content.arg("car") if content.arg("car") != "" else "openracer-muscle"
	var out: String = content.arg("out") if content.arg("out") != "" else "user://engine.wav"
	var cfg: Dictionary = content.load_json("cars/%s/car.json" % car_id)
	var p := EngineSimParams.params(cfg)
	var synth: Object = ClassDB.instantiate("EngineSimSynth")
	synth.configure(EngineSimParams.options(p), 44100.0)
	var ir: String = EngineSimParams.IMPULSE_RESPONSES.get(str(p["impulse_response"]), "smooth_39.wav")
	print("ir loaded: ", synth.set_impulse_response_wav(FileAccess.get_file_as_bytes(content.path("sounds/ir/" + ir))))
	var data := PackedByteArray()
	# 1 s idle, 2 s at 3000 rpm full throttle, 2 s at 6000 rpm
	for part in [[900.0, 0.0, 1.0], [3000.0, 1.0, 2.0], [6000.0, 1.0, 2.0]]:
		synth.set_rpm(part[0])
		synth.set_throttle(part[1])
		var frames := int(44100 * part[2])
		var done := 0
		var sum := 0.0
		while done < frames:
			var chunk: PackedVector2Array = synth.generate(mini(1024, frames - done))
			for v in chunk:
				var s := clampi(int(v.x * 32767.0), -32768, 32767)
				data.append(s & 0xFF)
				data.append((s >> 8) & 0xFF)
				sum += v.x * v.x
			done += chunk.size()
		print("rpm %d throttle %.1f  rms %.3f" % [part[0], part[1], sqrt(sum / frames)])
	var wav := AudioStreamWAV.new()
	wav.format = AudioStreamWAV.FORMAT_16_BITS
	wav.mix_rate = 44100
	wav.data = data
	wav.save_to_wav(out)
	print("saved ", out)
	quit()
