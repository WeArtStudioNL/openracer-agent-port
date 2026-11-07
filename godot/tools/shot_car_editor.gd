extends Node
## (with a window: Godot --path godot res://tools/shot_car_editor.tscn -- --car=hatchback --shot=/tmp/editor.png)
## Opens the car editor on a car, opens cards (--open=Wheels,Chassis), selects a layer (--select=follow, ex1, model), shows
## the test bar (--tests), edits the driver (--driver=edit|handL|model|wheel, --steer=-90), or opens a window
## (--window=Cameras, Materials, Sound), waits and saves a picture of the window.
## Nothing is saved.


func _ready() -> void:
	DisplayServer.window_set_size(Vector2i(1800, 1050))
	var ed := CarEditor.new()
	var open := Content.arg("open")
	if open != "":
		EditorStyle.open_cards = {}
		for c in open.split(","):
			EditorStyle.open_cards[c] = true
	add_child(ed)
	await get_tree().process_frame
	var car := Content.arg("car")
	if car != "":
		ed.load_existing(car)
	if Content.arg("suspension") != "":
		ed.suspension.set_editing(true)
	var sel := Content.arg("select")
	if sel != "":
		ed.layers.select(sel)
	var drv: Object = ed.hooks.get("Driver")
	if Content.arg("driver") != "" and drv != null:
		# (--driver=handL: the Driver card edits, that node has the gizmo; --steer=degrees turns the slider)
		drv.call("set_editing", true)
		if Content.arg("driver") != "edit":
			drv.call("select", Content.arg("driver"))
		if Content.arg("steer") != "":
			(drv.get("ui")["steer"] as HSlider).value = float(Content.arg("steer"))
	if Content.arg("tests") != "":
		ed.engine.toggle_test_bar()
	if Content.arg("drop") != "":
		ed.bench.drop(float(Content.arg("drop")), 8.0)
	if Content.arg("dyno") != "":
		ed.engine.run_dyno()
	match Content.arg("window"):
		"Cameras":
			(ed.form._cam_dialog["window"] as Window).popup_centered()
		"Materials":
			ed.mats.render()
			(ed.mats._dialog["window"] as Window).popup_centered()
		"Sound":
			(ed.engine._sound_dialog["window"] as Window).popup_centered()
	if Content.arg("widths") != "":
		await get_tree().process_frame
		for t in ed.card_of:
			var body: VBoxContainer = ed.card_of[t]["body"]
			print(t, " ", body.get_combined_minimum_size().x)
			for k in body.get_children():
				if k is Control and (k as Control).get_combined_minimum_size().x > 380.0:
					print("    ", k.get_class(), " ", (k as Control).get_combined_minimum_size().x)
					for kk in k.get_children():
						if kk is Control:
							print("        ", kk.get_class(), " ", (kk as Control).get_combined_minimum_size().x, " ", kk.get("text") if kk.get("text") != null else "")
	if Content.arg("problems") != "":
		print("problems: ", ed.problems())
		print("suspension: ", ed.suspension._missing.text)
	var scroll_to := Content.arg("scroll")
	if scroll_to != "" and ed.card_of.has(scroll_to):
		await get_tree().process_frame
		var sc := ed.cards_box.get_parent().get_parent() as ScrollContainer
		sc.scroll_vertical = int((ed.card_of[scroll_to]["panel"] as Control).position.y)
	var wait := float(Content.arg("wait")) if Content.arg("wait") != "" else 3.0
	await get_tree().create_timer(wait).timeout
	ed.engine.stop_sound()
	var shot := Content.arg("shot")
	if shot != "":
		await RenderingServer.frame_post_draw
		get_viewport().get_texture().get_image().save_png(shot)
		print("saved ", shot)
	get_tree().quit()
