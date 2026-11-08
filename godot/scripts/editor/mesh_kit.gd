class_name MeshKit
extends RefCounted
## Meshes as the track designer of the browser makes them (web/tools/track-design.js): the tileable textures of web/textures
## and their materials, a mesh from rows of points with the triangles in the order of three.js (counter-clockwise seen from the
## front; Godot's front faces are clockwise, so every triangle is turned here) and the normals as three.js computes them, and
## the boxes, cylinders, cones and spheres of the prefabs with their textures tiled in metres.

## The textures: how many metres one tile covers, and the roughness of the surface.
const TEXTURES := {
	"asphalt": {"label": "Asphalt", "size": 4.0, "roughness": 0.9}, "asphalt-light": {"label": "Light asphalt", "size": 4.0, "roughness": 0.9},
	"concrete": {"label": "Concrete", "size": 3.0, "roughness": 0.85}, "gravel": {"label": "Gravel", "size": 3.0, "roughness": 1.0},
	"grass": {"label": "Grass", "size": 6.0, "roughness": 1.0}, "grass-dry": {"label": "Dry grass", "size": 6.0, "roughness": 1.0},
	"dirt": {"label": "Dirt", "size": 6.0, "roughness": 1.0}, "sand": {"label": "Sand", "size": 6.0, "roughness": 1.0},
	"brick": {"label": "Brick", "size": 2.0, "roughness": 0.85}, "plaster": {"label": "Plaster", "size": 3.0, "roughness": 0.8},
	"roof": {"label": "Roof tiles", "size": 2.5, "roughness": 0.8}, "wood": {"label": "Wood", "size": 2.0, "roughness": 0.75},
	"metal": {"label": "Metal", "size": 1.5, "roughness": 0.45}, "rubber": {"label": "Rubber", "size": 0.5, "roughness": 0.9},
	"leaves": {"label": "Leaves", "size": 2.0, "roughness": 1.0}, "bark": {"label": "Bark", "size": 1.0, "roughness": 1.0},
}

static var _textures := {}
static var _materials := {}


static func texture(name: String) -> Texture2D:
	if not _textures.has(name):
		var img := Image.load_from_file(Content.root.path_join("textures/%s.jpg" % name)) if Content.root != "" else null
		if img != null and not img.is_empty():
			img.generate_mipmaps()
			_textures[name] = ImageTexture.create_from_image(img)
		else:
			_textures[name] = null
	return _textures[name]


## A material with a texture (and a tint), one per texture, tint and side: rows and the glb share them.
static func textured(name: String, tint := Color.WHITE, both_sides := false) -> StandardMaterial3D:
	var key := "%s:%s:%s" % [name, tint.to_html(false), both_sides]
	if not _materials.has(key):
		var def: Dictionary = TEXTURES.get(name, TEXTURES["concrete"])
		var m := StandardMaterial3D.new()
		m.resource_name = name
		m.albedo_texture = texture(name)
		m.albedo_color = tint
		m.roughness = def["roughness"]
		m.metallic = 0.3 if name == "metal" else 0.0
		m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
		if both_sides:
			m.cull_mode = BaseMaterial3D.CULL_DISABLED
		_materials[key] = m
	return _materials[key]


## A material of one colour (a part of a prefab that has no texture), or of a texture when it is a name.
static func material(colour: Variant) -> StandardMaterial3D:
	if colour is String:
		return textured(colour)
	var key := "colour:%s" % (colour as Color).to_html(false)
	if not _materials.has(key):
		var m := StandardMaterial3D.new()
		m.albedo_color = colour
		m.roughness = 0.85
		_materials[key] = m
	return _materials[key]


## A material of a colour for a surface of the design ("colour-8a7a5a").
static func colour_material(hex: String) -> StandardMaterial3D:
	var key := "surface:" + hex
	if not _materials.has(key):
		var m := StandardMaterial3D.new()
		m.resource_name = "colour-" + hex.trim_prefix("#")
		m.albedo_color = Color(hex)
		m.roughness = 0.9
		_materials[key] = m
	return _materials[key]


static func size_of(tex: Variant) -> float:
	return float(TEXTURES[tex]["size"]) if tex is String and TEXTURES.has(tex) else 1.0


## A mesh from vertices, uvs and triangles in the order of three.js (indices: three per triangle, counter-clockwise from the
## front). The normals are the mean of the faces at a vertex (computeVertexNormals of an indexed geometry).
static func build(verts: PackedVector3Array, uvs: PackedVector2Array, indices: PackedInt32Array, mat: Material,
		colours := PackedColorArray()) -> ArrayMesh:
	var normals := PackedVector3Array()
	normals.resize(verts.size())
	for t in indices.size() / 3:
		var a := indices[3 * t]
		var b := indices[3 * t + 1]
		var c := indices[3 * t + 2]
		var n := (verts[b] - verts[a]).cross(verts[c] - verts[a])
		normals[a] += n
		normals[b] += n
		normals[c] += n
	for i in normals.size():
		normals[i] = normals[i].normalized() if normals[i].length_squared() > 0.0 else Vector3.UP
	var godot := PackedInt32Array()
	godot.resize(indices.size())
	for t in indices.size() / 3:
		godot[3 * t] = indices[3 * t]
		godot[3 * t + 1] = indices[3 * t + 2]
		godot[3 * t + 2] = indices[3 * t + 1]
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = normals
	if not uvs.is_empty():
		arrays[Mesh.ARRAY_TEX_UV] = uvs
	if not colours.is_empty():
		arrays[Mesh.ARRAY_COLOR] = colours
	arrays[Mesh.ARRAY_INDEX] = godot
	var mesh := ArrayMesh.new()
	if godot.is_empty():
		return mesh
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	mesh.surface_set_material(0, mat)
	return mesh


## The arrays of a primitive mesh of Godot with the uvs of the track designer: a box tiled in metres on every face by the axis
## it looks along, a cylinder or a cone stretched to its size in tiles.
static func _arrays(pm: PrimitiveMesh, tex: Variant, kind: String, scale_u: float, scale_v: float) -> Array:
	var arrays := pm.get_mesh_arrays()
	var pos: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	var nor: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL]
	var uv: PackedVector2Array = arrays[Mesh.ARRAY_TEX_UV]
	var size := size_of(tex)
	for i in uv.size():
		if kind == "box":
			var n := nor[i].abs()
			var p := pos[i]
			if n.y >= n.x and n.y >= n.z:
				uv[i] = Vector2(p.x, p.z) / size
			elif n.x >= n.z:
				uv[i] = Vector2(p.z, -p.y) / size
			else:
				uv[i] = Vector2(p.x, -p.y) / size
		else:
			uv[i] = Vector2(uv[i].x * scale_u, uv[i].y * scale_v)
	arrays[Mesh.ARRAY_TEX_UV] = uv
	return arrays


static func _instance(arrays: Array, tex: Variant, at: Vector3) -> MeshInstance3D:
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	mesh.surface_set_material(0, material(tex))
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.position = at
	return mi


static func box(w: float, h: float, d: float, tex: Variant, x: float, y: float, z: float) -> MeshInstance3D:
	var bm := BoxMesh.new()
	bm.size = Vector3(w, h, d)
	return _instance(_arrays(bm, tex, "box", 1, 1), tex, Vector3(x, y, z))


static func cylinder(r: float, h: float, tex: Variant, x: float, y: float, z: float) -> MeshInstance3D:
	var cm := CylinderMesh.new()
	cm.top_radius = r
	cm.bottom_radius = r
	cm.height = h
	cm.radial_segments = 16
	cm.rings = 1
	return _instance(_arrays(cm, tex, "cylinder", TAU * r / size_of(tex), h / size_of(tex)), tex, Vector3(x, y, z))


static func cone(r: float, h: float, segments: int, tex: Variant) -> MeshInstance3D:
	var cm := CylinderMesh.new()
	cm.top_radius = 0.0
	cm.bottom_radius = r
	cm.height = h
	cm.radial_segments = segments
	cm.rings = 1
	return _instance(_arrays(cm, tex, "cone", PI * r / size_of(tex), Vector2(r, h).length() / size_of(tex)), tex, Vector3.ZERO)


static func sphere(r: float, tex: Variant) -> MeshInstance3D:
	var sm := SphereMesh.new()
	sm.radius = r
	sm.height = 2.0 * r
	sm.radial_segments = 12
	sm.rings = 9
	return _instance(_arrays(sm, tex, "sphere", TAU * r / 2.0, PI * r / 2.0), tex, Vector3.ZERO)


## A roof with four sloping sides over a w by d base (y = 0 at the eaves, h at the ridge).
static func hipped_roof(w: float, d: float, h: float, tex: String) -> MeshInstance3D:
	var size := size_of(tex)
	var a := Vector3(-w / 2, 0, d / 2)
	var b := Vector3(w / 2, 0, d / 2)
	var c := Vector3(w / 2, 0, -d / 2)
	var e := Vector3(-w / 2, 0, -d / 2)
	var top := Vector3(0, h, 0)
	var verts := PackedVector3Array()
	var uvs := PackedVector2Array()
	var idx := PackedInt32Array()
	for f in [[a, b, w, Vector2(h, d / 2).length()], [c, e, w, Vector2(h, d / 2).length()], [b, c, d, Vector2(h, w / 2).length()],
			[e, a, d, Vector2(h, w / 2).length()]]:
		var base := verts.size()
		verts.append_array([f[0], f[1], top])
		uvs.append_array([Vector2(0, 0), Vector2(f[2] / size, 0), Vector2(f[2] / 2 / size, f[3] / size)])
		idx.append_array([base, base + 1, base + 2])
	var mi := MeshInstance3D.new()
	mi.mesh = build(verts, uvs, idx, material(tex))
	return mi
