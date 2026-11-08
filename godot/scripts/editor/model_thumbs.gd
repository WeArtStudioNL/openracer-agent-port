class_name ModelThumbs
extends Node
## Small pictures of models for the library of the track editor (track-editor.js thumbOf): 192 pixels, see-through,
## from a corner above, a hemisphere of light and a sun. One model at a time in a SubViewport of its own world; the
## picture is cached by its key and handed to the callback (an empty image when nothing could be drawn: no screen).

const SIZE := 192

var _view: SubViewport
var _queue: Array = []               # [key, scene maker, callback]
var _busy := false
var _cache := {}                     # key -> ImageTexture


func _ready() -> void:
	_view = SubViewport.new()
	_view.size = Vector2i(SIZE, SIZE)
	_view.transparent_bg = true
	_view.own_world_3d = true
	_view.msaa_3d = Viewport.MSAA_4X
	_view.render_target_update_mode = SubViewport.UPDATE_DISABLED
	add_child(_view)
	var env := Environment.new()
	env.background_mode = Environment.BG_CLEAR_COLOR
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.85, 0.88, 0.95)
	env.ambient_light_energy = 0.9
	var we := WorldEnvironment.new()
	we.environment = env
	_view.add_child(we)
	var sun := DirectionalLight3D.new()
	sun.light_energy = 1.6
	sun.position = Vector3(3, 5, 4)
	_view.add_child(sun)
	sun.look_at(Vector3.ZERO)
	var cam := Camera3D.new()
	cam.name = "Camera"
	cam.fov = 30.0
	_view.add_child(cam)


func cached(key: String) -> Texture2D:
	return _cache.get(key)


## A picture of the scene that make() gives (a Node3D, freed after): done.call(texture or null) when it is drawn.
func request(key: String, make: Callable, done: Callable) -> void:
	if _cache.has(key):
		done.call(_cache[key])
		return
	_queue.append([key, make, done])
	if not _busy:
		_next()


func _next() -> void:
	if _queue.is_empty():
		_busy = false
		return
	_busy = true
	var job: Array = _queue.pop_front()
	var model: Node3D = job[1].call()
	var tex: Texture2D = null
	if model != null and DisplayServer.get_name() != "headless":
		_view.add_child(model)
		var box := _box(model)
		var radius := maxf(box.size.length() / 2.0, 0.01)
		var cam := _view.get_node("Camera") as Camera3D
		cam.near = radius * 0.05
		cam.far = radius * 20.0
		cam.position = box.get_center() + Vector3(1, 0.75, 1.2).normalized() * (radius / sin(deg_to_rad(15.0)) * 1.02)
		cam.look_at(box.get_center())
		_view.render_target_update_mode = SubViewport.UPDATE_ONCE
		await RenderingServer.frame_post_draw
		var img := _view.get_texture().get_image()
		if img != null and not img.is_empty():
			tex = ImageTexture.create_from_image(img)
		model.queue_free()
	elif model != null:
		model.queue_free()
	if tex != null:
		_cache[job[0]] = tex
	(job[2] as Callable).call(tex)
	_next.call_deferred()


static func _box(o: Node3D) -> AABB:
	var box := AABB()
	var first := true
	for m in o.find_children("*", "MeshInstance3D", true, false):
		var mi := m as MeshInstance3D
		if mi.mesh == null:
			continue
		var b := mi.global_transform * mi.mesh.get_aabb()
		box = b if first else box.merge(b)
		first = false
	return box


## A glb as a scene (null when it cannot be read).
static func load_glb(path: String) -> Node3D:
	var doc := GLTFDocument.new()
	var st := GLTFState.new()
	if doc.append_from_file(path, st) != OK:
		return null
	return doc.generate_scene(st) as Node3D
