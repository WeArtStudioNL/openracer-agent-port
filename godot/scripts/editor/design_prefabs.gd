class_name DesignPrefabs
extends RefCounted
## The prefabs of the track designer (web/tools/track-design.js PREFABS): walls, barriers, tyre stacks, a tyre wall, cones, trees,
## bushes, a house, a grandstand, lamp posts and sign boards. y = 0 is the ground; the textures that some of them have a choice of;
## and the surface of their parts in the game (scenery is hit, decor only shows). A row is a prefab repeated along a line.

const LIST := ["wall", "barrier", "tyres", "tyrewall", "cone", "tree", "bush", "house", "grandstand", "lamp", "sign"]
const INFO := {
	"wall": {"label": "Wall", "icon": "▬", "role": "scenery"}, "barrier": {"label": "Barrier", "icon": "═", "role": "scenery"},
	"tyres": {"label": "Tyre stack", "icon": "◎", "role": "scenery"}, "tyrewall": {"label": "Tyre wall", "icon": "◎◎◎", "role": "scenery"},
	"cone": {"label": "Cone", "icon": "▲", "role": "decor"}, "tree": {"label": "Tree", "icon": "♣", "role": "scenery"},
	"bush": {"label": "Bush", "icon": "●", "role": "decor"}, "house": {"label": "House", "icon": "⌂", "role": "scenery"},
	"grandstand": {"label": "Grandstand", "icon": "▤", "role": "scenery"}, "lamp": {"label": "Lamp post", "icon": "¡", "role": "scenery"},
	"sign": {"label": "Sign board", "icon": "▭", "role": "decor"},
}
const TEXTURE_CHOICES := {
	"road": ["asphalt", "asphalt-light", "concrete", "gravel", "dirt"], "shoulder": ["grass", "grass-dry", "dirt", "gravel", "sand"],
	"ground": ["grass", "grass-dry", "dirt", "sand", "gravel"], "wall": ["concrete", "brick", "plaster", "wood", "metal"],
	"house": ["plaster", "brick", "wood", "concrete"], "grandstand": ["concrete", "metal", "wood"], "barrier": ["metal", "wood", "concrete"],
}
const SPACING := {"wall": 4.0, "barrier": 4.0, "tyres": 0.8, "tyrewall": 2.3, "cone": 3.0, "tree": 8.0, "bush": 3.0, "house": 12.0,
	"grandstand": 17.0, "lamp": 20.0, "sign": 8.0}


static func role(type: String) -> String:
	return str(INFO.get(type, INFO["wall"])["role"])


## The prefab as a node (its parts are MeshInstance3D children); t: the chosen texture ("" for the default).
static func make(type: String, t := "") -> Node3D:
	var g := Node3D.new()
	var tex: Variant = t if t != "" and MeshKit.TEXTURES.has(t) else null
	match type:
		"barrier":
			g.add_child(MeshKit.box(4, 0.35, 0.08, tex if tex != null else "metal", 0, 0.6, 0))
			g.add_child(MeshKit.box(0.1, 0.75, 0.1, "metal", -1.9, 0.375, 0))
			g.add_child(MeshKit.box(0.1, 0.75, 0.1, "metal", 1.9, 0.375, 0))
		"tyres":
			for i in 4:
				g.add_child(MeshKit.cylinder(0.36, 0.22, Color8(0xc5, 0x3b, 0x32) if i == 3 else "rubber", 0, 0.11 + i * 0.22, 0))
		"tyrewall":
			for s in range(-1, 2):
				for i in 3:
					g.add_child(MeshKit.cylinder(0.36, 0.22, "rubber" if posmod(i + s, 2) == 1 else Color8(0xe8, 0xe8, 0xe0), s * 0.75, 0.11 + i * 0.22, 0))
		"cone":
			var c := MeshKit.cone(0.2, 0.7, 12, Color8(0xf2, 0x6b, 0x1d))
			c.position.y = 0.35
			g.add_child(c)
			g.add_child(MeshKit.box(0.45, 0.03, 0.45, "rubber", 0, 0.015, 0))
		"tree":
			g.add_child(MeshKit.cylinder(0.18, 2.2, "bark", 0, 1.1, 0))
			for i in 3:
				var c := MeshKit.cone(1.8 - i * 0.4, 2.2, 10, "leaves")
				c.position.y = 2.6 + i * 1.3
				g.add_child(c)
		"bush":
			var b := MeshKit.sphere(0.9, "leaves")
			b.scale = Vector3(1.2, 0.8, 1)
			b.position.y = 0.6
			g.add_child(b)
		"house":
			g.add_child(MeshKit.box(8, 3.2, 6, tex if tex != null else "plaster", 0, 1.6, 0))
			var roof := MeshKit.hipped_roof(9, 7, 2.2, "roof")
			roof.position.y = 3.2
			g.add_child(roof)
			g.add_child(MeshKit.box(1, 2.1, 0.1, "wood", 0, 1.05, 3.05))
		"grandstand":
			for i in 5:
				g.add_child(MeshKit.box(16, 0.6, 1.4, tex if tex != null else "concrete", 0, 0.3 + i * 0.6, -i * 1.4))
			g.add_child(MeshKit.box(16, 0.2, 7, "metal", 0, 4.2, -2.8))
			for x in [-7.5, 7.5]:
				for z in [0.2, -5.8]:
					g.add_child(MeshKit.box(0.2, 4.2, 0.2, "metal", x, 2.1, z))
		"lamp":
			g.add_child(MeshKit.cylinder(0.08, 7, "metal", 0, 3.5, 0))
			g.add_child(MeshKit.box(1.2, 0.15, 0.3, "metal", 0.5, 7, 0))
			g.add_child(MeshKit.box(0.5, 0.1, 0.25, Color8(0xff, 0xf2, 0xb0), 0.95, 6.9, 0))
		"sign":
			g.add_child(MeshKit.box(6, 1.2, 0.08, Color8(0x2d, 0x5f, 0xbf), 0, 1.8, 0))
			g.add_child(MeshKit.box(0.1, 1.2, 0.1, "metal", -2.8, 0.6, 0))
			g.add_child(MeshKit.box(0.1, 1.2, 0.1, "metal", 2.8, 0.6, 0))
		_:
			g.add_child(MeshKit.box(4, 1, 0.3, tex if tex != null else "concrete", 0, 0.5, 0))
	return g


## The turn of a prefab that stands on the ground: its up is the normal there, and it is turned by yaw about that.
static func orient(normal: Vector3, yaw: float) -> Basis:
	var tilt := Basis.IDENTITY
	var n := normal.normalized()
	if n.dot(Vector3.UP) < 0.9999:
		tilt = Basis(Quaternion(Vector3.UP, n))
	return tilt * Basis(Vector3.UP, yaw)


## The copies of a row merged into one mesh per material (also in the glb): a long row stays light. copies: [{ basis, origin }]
static func merged(type: String, t: String, copies: Array, name: String) -> Array[MeshInstance3D]:
	var proto := make(type, t)
	var by_mat := {}                # material -> [verts, normals, uvs, indices]
	for part in proto.get_children():
		var mi := part as MeshInstance3D
		var local := mi.transform
		for s in mi.mesh.get_surface_count():
			var mat := mi.mesh.surface_get_material(s)
			var arrays := mi.mesh.surface_get_arrays(s)
			if not by_mat.has(mat):
				by_mat[mat] = [PackedVector3Array(), PackedVector3Array(), PackedVector2Array(), PackedInt32Array()]
			var acc: Array = by_mat[mat]
			var pos: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
			var nor: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL]
			var uv: PackedVector2Array = arrays[Mesh.ARRAY_TEX_UV]
			var idx: PackedInt32Array = arrays[Mesh.ARRAY_INDEX]
			for c in copies:
				var xf: Transform3D = c * local
				var base: int = (acc[0] as PackedVector3Array).size()
				var nb := xf.basis.inverse().transposed()
				for i in pos.size():
					acc[0].append(xf * pos[i])
					acc[1].append((nb * nor[i]).normalized())
					acc[2].append(uv[i] if i < uv.size() else Vector2.ZERO)
				for i in idx:
					acc[3].append(base + i)
	proto.free()
	var out: Array[MeshInstance3D] = []
	for mat in by_mat:
		var acc: Array = by_mat[mat]
		var arrays := []
		arrays.resize(Mesh.ARRAY_MAX)
		arrays[Mesh.ARRAY_VERTEX] = acc[0]
		arrays[Mesh.ARRAY_NORMAL] = acc[1]
		arrays[Mesh.ARRAY_TEX_UV] = acc[2]
		arrays[Mesh.ARRAY_INDEX] = acc[3]
		var mesh := ArrayMesh.new()
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
		mesh.surface_set_material(0, mat)
		mesh.resource_name = name
		var mi := MeshInstance3D.new()
		mi.name = name
		mi.mesh = mesh
		out.append(mi)
	return out
