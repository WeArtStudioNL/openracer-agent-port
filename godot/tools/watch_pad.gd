extends SceneTree
## Watches joypad 0 for some seconds and prints the range of every axis and the buttons that were pressed (a test).


func _init() -> void:
	await process_frame
	var lo := []
	var hi := []
	for a in 10:
		lo.append(1e9)
		hi.append(-1e9)
	var buttons := {}
	var seconds := 25.0
	var t := 0.0
	while t < seconds:
		await process_frame
		t += 1.0 / 60.0
		for a in 10:
			var v := Input.get_joy_axis(0, a)
			lo[a] = minf(lo[a], v)
			hi[a] = maxf(hi[a], v)
		for b in 128:
			if Input.is_joy_button_pressed(0, b):
				buttons[b] = true
	for a in 10:
		print("axis %d  %.2f .. %.2f" % [a, lo[a], hi[a]])
	print("buttons ", buttons.keys())
	quit()
