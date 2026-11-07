extends SceneTree
## Lists the connected joypads and wheels: name, guid, and the axes and buttons that move (a test).


func _init() -> void:
	for i in 30:
		await process_frame
	for d in Input.get_connected_joypads():
		print("pad %d  %s  guid %s  info %s" % [d, Input.get_joy_name(d), Input.get_joy_guid(d), Input.get_joy_info(d)])
		var axes := []
		for a in 10:
			axes.append("%.2f" % Input.get_joy_axis(d, a))
		print("  axes ", axes)
	if Input.get_connected_joypads().is_empty():
		print("no joypads")
	quit()
