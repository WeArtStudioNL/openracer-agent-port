class_name CarModel
extends RefCounted
## Builds what a car looks like: the body (the glb of car.json, placed with "model.offset", "rotation_y" and
## "scale") and the four wheels, each a chain hub -> steer -> spin (web/js/CarLoader.js does the same).
## A wheel is the wheel parts of the model (wheels.mode "model"), or a rim of the wheel library in a tyre
## that is made here (wheels.mode "default").

const SLOTS := ["FL", "FR", "RL", "RR"]

## The colours of the AI cars of a race (main.js).
const AI_COLOURS := [Color("#d94a3d"), Color("#3d7bd9"), Color("#e3b53a"), Color("#3fae5a"), Color("#f0f0f0"), Color("#8a4fd1"), Color("#f07a2a")]


## The transform of node in the space of an ancestor (works outside the scene tree too).
static func relative(node: Node3D, ancestor: Node3D) -> Transform3D:
	var t := Transform3D.IDENTITY
	var n: Node = node
	while n != null and n != ancestor:
		if n is Node3D:
			t = (n as Node3D).transform * t
		n = n.get_parent()
	return t


## The bounding box of all meshes under node (node included), in the space of relative_to (an ancestor of node,
## or node itself).
static func bounds(node: Node3D, relative_to: Node3D) -> AABB:
	var box := AABB()
	var first := true
	var list: Array[Node] = node.find_children("*", "MeshInstance3D", true, false)
	if node is MeshInstance3D:
		list.append(node)
	for m in list:
		var mi := m as MeshInstance3D
		if mi.mesh == null or not mi.visible:
			continue
		var b: AABB = relative(mi, relative_to) * mi.mesh.get_aabb()
		if first:
			box = b
			first = false
		else:
			box = box.merge(b)
	return box


## Objects that are mirrored in the model (Blender: a linked duplicate with a negative scale) are made real objects with a positive scale,
## the same in place and shape. Godot flips the normals of a double-sided material (the default of Blender) on a mirrored object, so that it is
## lit from the wrong side. Copies of the same mesh share the one mirrored mesh.
static func unmirror(root: Node3D) -> void:
	var flipped := {}
	var r := Basis.from_scale(Vector3(-1.0, -1.0, -1.0))
	var nodes: Array[Node] = root.find_children("*", "Node3D", true, false)
	nodes.push_front(root)
	for n in nodes:                         # (parents first: what a parent gives up, its children take over)
		var node := n as Node3D
		if node.transform.basis.determinant() >= 0.0:
			continue
		var mi := node as MeshInstance3D
		if mi != null and mi.mesh != null:
			if not flipped.has(mi.mesh):
				flipped[mi.mesh] = _flipped_mesh(mi.mesh)
			if flipped[mi.mesh] == null:
				continue
			mi.mesh = flipped[mi.mesh]
		node.transform.basis = node.transform.basis * r
		for c in node.get_children():
			if c is Node3D:
				(c as Node3D).transform = Transform3D(r, Vector3.ZERO) * (c as Node3D).transform


## A mesh turned through its middle (every point to the other side): null when it cannot be (a skinned mesh).
static func _flipped_mesh(mesh: Mesh) -> Variant:
	if not mesh is ArrayMesh:
		return null
	var out := ArrayMesh.new()
	out.resource_name = mesh.resource_name
	for s in mesh.get_surface_count():
		var a: Array = mesh.surface_get_arrays(s)
		if a[Mesh.ARRAY_BONES] != null:
			return null
		var vs: PackedVector3Array = a[Mesh.ARRAY_VERTEX]
		for i in vs.size():
			vs[i] = -vs[i]
		a[Mesh.ARRAY_VERTEX] = vs
		if a[Mesh.ARRAY_NORMAL] != null:
			var ns: PackedVector3Array = a[Mesh.ARRAY_NORMAL]
			for i in ns.size():
				ns[i] = -ns[i]
			a[Mesh.ARRAY_NORMAL] = ns
		if a[Mesh.ARRAY_TANGENT] != null:
			var ts: PackedFloat32Array = a[Mesh.ARRAY_TANGENT]
			for i in ts.size():
				ts[i] = -ts[i]             # (the direction and its sign: the normal has turned as well)
			a[Mesh.ARRAY_TANGENT] = ts
		var prim: Mesh.PrimitiveType = (mesh as ArrayMesh).surface_get_primitive_type(s)
		if prim == Mesh.PRIMITIVE_TRIANGLES:
			var idx: PackedInt32Array = a[Mesh.ARRAY_INDEX] if a[Mesh.ARRAY_INDEX] != null else PackedInt32Array(range(vs.size()))
			for i in range(0, idx.size() - 2, 3):
				var t := idx[i + 1]
				idx[i + 1] = idx[i + 2]
				idx[i + 2] = t
			a[Mesh.ARRAY_INDEX] = idx
		out.add_surface_from_arrays(prim, a)
		out.surface_set_material(s, mesh.surface_get_material(s))
		out.surface_set_name(s, (mesh as ArrayMesh).surface_get_name(s))
	return out


## A tyre: a tube with its tread and two side walls, around the x axis (the axle), the middle at the origin.
static func tyre_mesh(outer_r: float, inner_r: float, width: float, segments := 40) -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var hw := width / 2.0
	var shoulder := minf(0.025, (outer_r - inner_r) * 0.3)
	# the profile from the inner edge of one side wall, round the shoulder, over the tread, back down the other
	var profile: Array[Vector2] = [
		Vector2(-hw, inner_r), Vector2(-hw, outer_r - shoulder), Vector2(-hw + shoulder * 0.4, outer_r - shoulder * 0.25),
		Vector2(-hw + shoulder, outer_r), Vector2(hw - shoulder, outer_r),
		Vector2(hw - shoulder * 0.4, outer_r - shoulder * 0.25), Vector2(hw, outer_r - shoulder), Vector2(hw, inner_r),
	]
	for s in segments:
		var a0 := TAU * s / segments
		var a1 := TAU * (s + 1) / segments
		for p in profile.size() - 1:
			var p0 := profile[p]
			var p1 := profile[p + 1]
			var v00 := Vector3(p0.x, p0.y * cos(a0), p0.y * sin(a0))
			var v01 := Vector3(p1.x, p1.y * cos(a0), p1.y * sin(a0))
			var v10 := Vector3(p0.x, p0.y * cos(a1), p0.y * sin(a1))
			var v11 := Vector3(p1.x, p1.y * cos(a1), p1.y * sin(a1))
			for v in [v00, v10, v11, v00, v11, v01]:
				st.add_vertex(v)
	st.generate_normals()
	var mesh := st.commit()
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.06, 0.06, 0.065)
	mat.roughness = 0.85
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	mesh.surface_set_material(0, mat)
	return mesh


## The objects of a model that are the wheel of a corner by their names (wheel_FL, wheel_FL_rim, wheel_rim_FL, rim_FL, tyre_FL, and
## anything after the corner: wheel_rim_FL.001; capitals and separators do not matter): these are used in place of the wheel
## library. [] when it has none.
static func named_wheel_parts(body: Node3D, slot: String) -> Array[Node3D]:
	var out: Array[Node3D] = []
	if body == null:
		return out
	var corner := RegEx.create_from_string("^(wheel)?(rim|disc|tyre|tire)?" + slot.to_lower() + "$")
	for n in body.find_children("*", "Node3D", true, false):
		var s := SuspensionRig.stem(str(n.name))
		if s != slot.to_lower() and corner.search(s) != null:
			out.append(n as Node3D)
	return out


## Whether those objects are a whole wheel or a tyre (wheel_FL): else only a rim or a disc, and the tyre is still made.
static func has_named_tyre(parts: Array[Node3D], slot: String) -> bool:
	var base := "wheel" + slot.to_lower()
	for p in parts:
		var s := SuspensionRig.stem(str(p.name))
		var after := SuspensionRig.clean(str(p.name)).trim_prefix(s)
		if s.contains("tyre") or s.contains("tire") or (s == base and (after.is_valid_int() or after == "" or after.contains("tyre") or after.contains("tire"))):
			return true
	return false


## A rim of the wheel library (wheels/wheels.json), turned so that its axle is the x axis and sized to the
## inner diameter of the tyre; a plain disc when the library does not have it.
static func library_rim(rim_id: String, diameter: float, width: float) -> Node3D:
	var holder := Node3D.new()
	var lib: Variant = Content.load_json("wheels/wheels.json")
	var file := ""
	if lib is Dictionary:
		for r in lib.get("rims", []):
			if r.get("id", "") == rim_id:
				file = "wheels/" + str(r.get("file", ""))
	var rim: Node3D = Content.load_model(file) if file != "" else null
	if rim == null:
		var disc := MeshInstance3D.new()
		var cyl := CylinderMesh.new()
		cyl.top_radius = diameter / 2.0
		cyl.bottom_radius = diameter / 2.0
		cyl.height = width * 0.8
		var mat := StandardMaterial3D.new()
		mat.albedo_color = Color(0.6, 0.62, 0.65)
		mat.metallic = 0.8
		mat.roughness = 0.35
		cyl.material = mat
		disc.mesh = cyl
		disc.rotation.z = PI / 2
		holder.add_child(disc)
		return holder
	var turn := Node3D.new()
	holder.add_child(turn)
	turn.add_child(rim)
	# the axle of the rim is the direction in which it is thinnest
	var box := bounds(rim, rim)
	var size := box.size
	if size.z < size.x and size.z < size.y:
		turn.rotation.y = PI / 2
	elif size.y < size.x and size.y < size.z:
		turn.rotation.z = PI / 2
	rim.position = -box.get_center()
	var across := maxf(size.x, maxf(size.y, size.z))
	if across > 0.0:
		turn.scale = Vector3.ONE * (diameter / across)
		# (as wide as asked, along its axle: the round of the rim keeps its size)
		var axle := 0 if size.x <= size.y and size.x <= size.z else (1 if size.y <= size.z else 2)
		if size[axle] > 1e-5:
			turn.scale[axle] = width / size[axle]
	return holder


## Paints a car with one colour for the body and one for the rims, each with its finish (the AI cars of a race, the
## car editor): CarPaint.paint (CarColors.js). A model without a carpaint has its material called body painted (the karts).
static func paint(root: Node, body: Variant, body_finish := "gloss", rim: Variant = null, rim_finish := "metallic") -> int:
	var colors := {"body": body, "bodyFinish": body_finish if body != null else "", "rim": rim, "rimFinish": rim_finish if rim != null else ""}
	return CarPaint.paint(root, colors, true)
