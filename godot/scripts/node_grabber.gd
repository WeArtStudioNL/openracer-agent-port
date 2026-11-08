extends RefCounted
## The node grabber of the game (the debug view) and of the car editor: the nodes of the soft body near the mouse are shown
## (the body, the wheels and the suspension: every node of the shell) and fade out with the distance on the screen; the left
## mouse button takes the nearest and pulls it on an elastic. These nodes have nothing to do with the debug lines.

const GRAB_PX := 30.0               # the nearest node within this many pixels of the mouse can be taken
const BRIGHT_PX := 45.0             # up to here the nodes are fully lit
const FADE_PX := 150.0              # here they have faded to nothing
const COLOUR_BODY := Color("#ffd04d")
const COLOUR_RIG := Color("#5ec8ff")
const COLOUR_PART := Color("#ff9a4d")

var on := true
var strength := 5000.0              # N/m of the elastic
var car_of: Callable                # func() -> the car (or null)
var camera_of: Callable             # func() -> the camera
var holder_of: Callable             # func() -> the node that holds what is drawn
var set_pusher: Callable            # func(held: bool): (optional) the debug view has more forces on the shell of its own
var layer := 1                      # the render layer of the nodes
var _mouse := Vector2.INF
var _grab := {}                     # node, depth (along the ray of the mouse), car, world, target (the frame of the car)
var _hot := -1
var _small: ImmediateMesh = null
var _big: ImmediateMesh = null


func _init() -> void:
	strength = clampf(float(VideoPrefs.get_value("debug", "grab_strength", 5000.0)), 100.0, 200000.0)


func _car() -> Car:
	return car_of.call() as Car


func _sb() -> SoftBody:
	var c := _car()
	return c.shell.sb if c != null and c.shell != null else null


func holding() -> bool:
	return not _grab.is_empty()


## The mouse is not over the view any more (nothing is shown; a node that is held stays held).
func leave() -> void:
	if _grab.is_empty():
		_mouse = Vector2.INF


## A mouse event: true when the grabber took it.
func input(event: InputEvent) -> bool:
	if not on:
		return false
	if event is InputEventMouseMotion:
		_mouse = (event as InputEventMouseMotion).position
		return not _grab.is_empty()
	var mb := event as InputEventMouseButton
	return mb != null and mb.button_index == MOUSE_BUTTON_LEFT and _button(mb)


func _button(mb: InputEventMouseButton) -> bool:
	_mouse = mb.position
	if mb.pressed:
		var k := _nearest(mb.position)
		if k >= 0:
			_take(k)
		return k >= 0
	var held := not _grab.is_empty()
	release()
	return held


func _nearest(mouse: Vector2) -> int:
	var sb := _sb()
	var cam: Camera3D = camera_of.call()
	if sb == null or cam == null:
		return -1
	var xf := _car().get_global_transform_interpolated()
	var best := -1
	var best_d := GRAB_PX
	for k in sb.count:
		if sb.gone[k] == 1:
			continue
		var p := xf * sb.position(k)
		if cam.is_position_behind(p):
			continue
		var d := cam.unproject_position(p).distance_to(mouse)
		if d < best_d:
			best_d = d
			best = k
	return best


func _take(k: int) -> void:
	var car := _car()
	var cam: Camera3D = camera_of.call()
	var p := car.global_transform * _sb().position(k)
	_grab = {"node": k, "car": car, "depth": (p - cam.project_ray_origin(_mouse)).dot(cam.project_ray_normal(_mouse))}
	_aim()
	car.sleeping = false
	_pusher(true)


func _pusher(held: bool) -> void:
	if set_pusher.is_valid():
		set_pusher.call(held)
		return
	var car: Variant = _grab.get("car")
	if car != null and is_instance_valid(car) and car.shell != null:
		car.shell.pusher = push if held else Callable()


func release() -> void:
	if not _grab.is_empty():
		_pusher(false)
	_grab = {}


func _aim() -> void:
	var cam: Camera3D = camera_of.call()
	var at := cam.project_ray_origin(_mouse) + cam.project_ray_normal(_mouse) * float(_grab["depth"])
	_grab["world"] = at
	_grab["target"] = (_grab["car"] as Car).global_transform.affine_inverse() * at


## In every small step of the shell: the elastic pulls its node.
func push(_h: float) -> void:
	var sb := _sb()
	if sb == null or _grab.is_empty() or not _grab.has("target"):
		return
	var k: int = _grab["node"]
	sb.force[k] += (Vector3(_grab["target"]) - sb.position(k)) * strength - sb.w[k] * 2.0 * sqrt(strength * sb.mass[k])
	sb.quiet = false


## Once a frame.
func frame() -> void:
	var car := _car()
	if car == null:
		_grab = {}
		clear()
		return
	if not _grab.is_empty():
		if _grab["car"] != car:
			_grab = {}
		else:
			_aim()
			car.sleeping = false
	_draw(car)


func _draw(car: Car) -> void:
	_make()
	clear()
	var sb := _sb()
	var cam: Camera3D = camera_of.call()
	if sb == null or cam == null or _mouse == Vector2.INF:
		return
	var xf := car.get_global_transform_interpolated()
	_hot = int(_grab["node"]) if not _grab.is_empty() else _nearest(_mouse)
	var any := false
	for k in sb.count:
		if sb.gone[k] == 1 or k == _hot:
			continue
		var p := xf * sb.position(k)
		if cam.is_position_behind(p):
			continue
		var d := cam.unproject_position(p).distance_to(_mouse)
		if d >= FADE_PX:
			continue
		if not any:
			any = true
			_small.surface_begin(Mesh.PRIMITIVE_POINTS)
		var c := COLOUR_RIG if sb.is_rig[k] == 1 else (COLOUR_PART if sb.part_of[k] != "" else COLOUR_BODY)
		c.a = 1.0 - smoothstep(BRIGHT_PX, FADE_PX, d)
		_small.surface_set_color(c)
		_small.surface_add_vertex(p)
	if any:
		_small.surface_end()
	if _hot < 0:
		return
	var at := xf * sb.position(_hot)
	_big.surface_begin(Mesh.PRIMITIVE_POINTS)
	_big.surface_set_color(Color.WHITE)
	_big.surface_add_vertex(at)
	_big.surface_end()
	if _grab.has("world"):
		_big.surface_begin(Mesh.PRIMITIVE_LINES)
		_big.surface_set_color(Color.WHITE)
		_big.surface_add_vertex(at)
		_big.surface_add_vertex(_grab["world"])
		_big.surface_end()


func _make() -> void:
	if _small != null:
		return
	_small = _mesh(8.0)
	_big = _mesh(16.0)


func _mesh(size: float) -> ImmediateMesh:
	var mi := MeshInstance3D.new()
	var im := ImmediateMesh.new()
	mi.mesh = im
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.vertex_color_use_as_albedo = true
	m.no_depth_test = true
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.use_point_size = true
	m.point_size = size
	m.render_priority = 9
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.layers = layer
	mi.extra_cull_margin = 16384.0
	(holder_of.call() as Node).add_child(mi)
	return im


func clear() -> void:
	if _small != null:
		_small.clear_surfaces()
		_big.clear_surfaces()
