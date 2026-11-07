class_name EnvironmentExport
extends RefCounted
## Saves the surroundings of the car as a picture of the whole sky and ground around it (web/js/EnvironmentExport.js):
## an equirectangular HDR image (the .hdr format of Radiance, RGBE) that can be used as the world of Blender
## (tools/blender_match_game.py), so that a car there gets the same light and reflections as in the game.
##
## Six pictures of 90 degrees are rendered from the place (without the car, without the tone mapping: the light as it
## is), then every pixel of the panorama looks up its direction in them.

const FOLDER := "user://environments"
const HIDDEN_LAYER := 1 << 19

## (the faces: where the camera looks and which way is up)
const FACES := [
	[Vector3(1, 0, 0), Vector3(0, 1, 0)], [Vector3(-1, 0, 0), Vector3(0, 1, 0)],
	[Vector3(0, 1, 0), Vector3(0, 0, -1)], [Vector3(0, -1, 0), Vector3(0, 0, 1)],
	[Vector3(0, 0, 1), Vector3(0, 1, 0)], [Vector3(0, 0, -1), Vector3(0, 1, 0)],
]


## Renders the surroundings of a place (world: a node in the 3D world; hide: nodes left out, the car) and saves them;
## gives the path of the file ("" when it failed). face: the size of a face, width: of the panorama; path: where (else a
## new file in user://environments).
static func save(world: Node3D, place: Vector3, hide: Array, face := 1024, width := 2048, path := "") -> String:
	var faces := await _render(world, place, hide, face)
	if faces.is_empty():
		return ""
	var data := encode(_panorama(faces, face, width), width, width / 2)
	if path == "":
		DirAccess.make_dir_recursive_absolute(FOLDER)
		path = "%s/openracer-environment-%s.hdr" % [FOLDER, Time.get_datetime_string_from_system().replace(":", "")]
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		return ""
	file.store_buffer(data)
	file.close()
	RunLog.event("environment saved: %s" % ProjectSettings.globalize_path(path))
	return ProjectSettings.globalize_path(path)


## What is left out of the picture: the player's car and its ghost (the cars of the world that are not AI cars).
static func own_cars(world: Node, car: Car) -> Array:
	var out: Array = [car]
	for n in world.get_children():
		if n is Car and (n as Car).is_ghost:
			out.append(n)
	return out


static func _render(world: Node3D, place: Vector3, hide: Array, size: int) -> Array:
	var vp := SubViewport.new()
	vp.size = Vector2i(size, size)
	vp.use_hdr_2d = true
	vp.render_target_update_mode = SubViewport.UPDATE_DISABLED
	var cam := Camera3D.new()
	cam.fov = 90.0
	cam.near = 0.1
	cam.far = 10000.0
	var main_cam := world.get_viewport().get_camera_3d()
	var env: Environment = world.get_world_3d().environment
	if env == null and main_cam != null:
		env = main_cam.environment
	var we := world.get_tree().root.find_children("*", "WorldEnvironment", true, false)
	if env == null and not we.is_empty():
		env = (we[0] as WorldEnvironment).environment
	if env != null:
		# (the light as it is: no tone mapping, no grading, no fog of the screen effects)
		var raw := env.duplicate() as Environment
		raw.tonemap_mode = Environment.TONE_MAPPER_LINEAR
		raw.tonemap_exposure = 1.0
		raw.adjustment_enabled = false
		raw.ssr_enabled = false
		cam.environment = raw
	vp.add_child(cam)
	world.add_child(vp)
	# (what is left out is put on a layer of its own that the camera does not see: its visibility is set by others, the
	# ghost every frame)
	var was := {}
	for n in hide:
		if not n is Node:
			continue
		for v in (n as Node).find_children("*", "VisualInstance3D", true, false):
			was[v] = (v as VisualInstance3D).layers
			(v as VisualInstance3D).layers = HIDDEN_LAYER
	cam.cull_mask = 0xFFFFF & ~HIDDEN_LAYER
	var images: Array = []
	for f in FACES:
		var dir: Vector3 = f[0]
		cam.global_transform = Transform3D(Basis.looking_at(dir, f[1]), place)
		vp.render_target_update_mode = SubViewport.UPDATE_ONCE
		# (two frames: the first draw can still have the place and the hidden cars of before)
		await RenderingServer.frame_post_draw
		vp.render_target_update_mode = SubViewport.UPDATE_ONCE
		await RenderingServer.frame_post_draw
		var img := vp.get_texture().get_image()
		if img == null:
			break
		if img.get_format() == Image.FORMAT_RGBA8 or img.get_format() == Image.FORMAT_RGB8:
			img.srgb_to_linear()          # (a picture of 8 bits is in sRGB)
		img.convert(Image.FORMAT_RGBF)
		images.append(img.get_data().to_float32_array())
	for v in was:
		if is_instance_valid(v):
			(v as VisualInstance3D).layers = was[v]
	vp.queue_free()
	return images if images.size() == 6 else []


## The panorama (rows from the top, RGB floats): the direction of every pixel in the axes of Blender (z up, y away
## from the viewer) to those of the game (y up), then the face that it falls on.
static func _panorama(faces: Array, size: int, width: int) -> PackedFloat32Array:
	var height := width / 2
	var out := PackedFloat32Array()
	out.resize(width * height * 3)
	var bases: Array[Basis] = []
	for f in FACES:
		bases.append(Basis.looking_at(f[0], f[1]))
	var k := 0
	for y in height:
		var lat := ((height - 1 - y + 0.5) / height - 0.5) * PI
		for x in width:
			var lon := ((x + 0.5) / width - 0.5) * TAU
			var b := Vector3(-cos(lon) * cos(lat), sin(lon) * cos(lat), sin(lat))
			var d := Vector3(b.x, b.z, -b.y)
			var ax := absf(d.x)
			var ay := absf(d.y)
			var az := absf(d.z)
			var fi := 0
			if ax >= ay and ax >= az:
				fi = 0 if d.x > 0.0 else 1
			elif ay >= az:
				fi = 2 if d.y > 0.0 else 3
			else:
				fi = 4 if d.z > 0.0 else 5
			var basis := bases[fi]
			var depth := -d.dot(basis.z)
			var u := d.dot(basis.x) / depth
			var v := d.dot(basis.y) / depth
			var px := clampi(int((u + 1.0) * 0.5 * size), 0, size - 1)
			var py := clampi(int((1.0 - v) * 0.5 * size), 0, size - 1)
			var src: PackedFloat32Array = faces[fi]
			var i := (py * size + px) * 3
			out[k] = src[i]
			out[k + 1] = src[i + 1]
			out[k + 2] = src[i + 2]
			k += 3
	return out


## Radiance RGBE: one byte per colour, with a shared exponent; the rows from the top.
static func encode(pixels: PackedFloat32Array, width: int, height: int) -> PackedByteArray:
	var header := "#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y %d +X %d\n" % [height, width]
	var data := header.to_ascii_buffer()
	var offset := data.size()
	data.resize(offset + width * height * 4)
	for p in width * height:
		var r := pixels[p * 3]
		var g := pixels[p * 3 + 1]
		var b := pixels[p * 3 + 2]
		var mx := maxf(r, maxf(g, b))
		if not (mx > 1e-32):
			offset += 4
			continue
		var e := ceili(log(mx) / log(2.0))
		var scale := 256.0 / pow(2.0, e)
		if mx * scale >= 256.0:
			e += 1
			scale /= 2.0
		data[offset] = mini(255, int(r * scale))
		data[offset + 1] = mini(255, int(g * scale))
		data[offset + 2] = mini(255, int(b * scale))
		data[offset + 3] = e + 128
		offset += 4
	return data
