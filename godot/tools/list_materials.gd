extends SceneTree
## Lists the materials of the model of every car (a test: which ones are carpaint and rimpaint).


func _init() -> void:
	await process_frame
	var content: Node = root.get_node("/root/Content")
	for c in content.list_cars():
		var cfg: Dictionary = content.load_json("cars/%s/car.json" % c["id"])
		var model: Node3D = content.load_model(str(cfg.get("model", {}).get("file", "")))
		var names := {}
		if model:
			for m in model.find_children("*", "MeshInstance3D", true, false):
				for i in (m as MeshInstance3D).mesh.get_surface_count():
					var mat: Material = (m as MeshInstance3D).mesh.surface_get_material(i)
					if mat:
						names[mat.resource_name] = true
		print(c["id"], ": ", names.keys())
	quit()
