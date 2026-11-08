extends Node
## (a node of the replay that runs late in the frame, after every camera has moved: the zoom of a file)


func _process(_delta: float) -> void:
	var r: Variant = get_meta("replay", null)
	if r != null:
		r.call("_late_frame")
