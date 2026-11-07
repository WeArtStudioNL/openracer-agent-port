extends SceneTree
## Opens the force feedback of the first wheel (no force: the effects are made and set to 0) and prints what the
## setup found and sent (a test). With --pulse it pulls the wheel gently left and right for two seconds.


func _init() -> void:
	await process_frame
	var pads := Input.get_connected_joypads()
	if pads.is_empty():
		print("no joypads")
		quit()
		return
	var info := Input.get_joy_info(pads[0])
	print("wheel ", Input.get_joy_name(pads[0]), " ", info)
	var ffb: Object = ClassDB.instantiate("WheelForce")
	var why: String = ffb.open(int(info.get("vendor_id", 0)), int(info.get("product_id", 0)))
	print("open: ", "ok " + ffb.device_name() if why == "" else why)
	for line in ffb.take_log():
		print("  ", line)
	if why == "" and OS.get_cmdline_user_args().has("--pulse"):
		# a push one way, then the other: the steering axis shows whether the wheel moved, and which way
		for dir in [1.0, -1.0]:
			var start := Input.get_joy_axis(pads[0], 0)
			var end := Time.get_ticks_msec() + 700
			while Time.get_ticks_msec() < end:
				await process_frame
				ffb.set_force(0.3 * dir)
			ffb.set_force(0.0)
			print("force %+.1f: axis 0 from %.3f to %.3f" % [0.3 * dir, start, Input.get_joy_axis(pads[0], 0)])
			var settle := Time.get_ticks_msec() + 500
			while Time.get_ticks_msec() < settle:
				await process_frame
	ffb.close()
	quit()
