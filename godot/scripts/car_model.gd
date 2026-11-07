class_name CarModel
extends RefCounted
## Builds what a car looks like: the body (the glb of car.json, placed with "model.offset", "rotation_y" and
## "scale") and the four wheels, each a chain hub -> steer -> spin (web/js/CarLoader.js does the same).
## A wheel is the wheel parts of the model (wheels.mode "model"), or a rim of the wheel library in a tyre
## that is made here (wheels.mode "default").

const SLOTS := ["FL", "FR", "RL", "RR"]

## The finishes of the paint (OpenRacer.carFinishes of CarColors.js): roughness, metalness, clear coat.
const FINISHES := {
	"gloss": [0.22, 0.1, 1.0, 0.03],
	"satin": [0.5, 0.12, 0.25, 0.35],
	"matte": [0.92, 0.0, 0.0, 0.0],
	"metallic": [0.33, 0.75, 1.0, 0.05],
	"pearl": [0.28, 0.3, 1.0, 0.04],
	"flake": [0.38, 0.9, 1.0, 0.06],
	"candy": [0.15, 0.85, 1.0, 0.02],
	"chrome": [0.04, 1.0, 0.0, 0.0],
	"brushed": [0.42, 1.0, 0.0, 0.0],
}

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
	return holder


## Paints a car (applyCarColors of CarColors.js): every material called carpaint (car paint, Car_Paint.001 ...) gets
## the colour of the body, every material called rimpaint the colour of the rims, each with its finish. The other
## materials stay as the model made them.
static func paint(root: Node, body: Variant, body_finish := "gloss", rim: Variant = null, rim_finish := "metallic") -> int:
	var body_re := RegEx.create_from_string("(?i)car[ _-]?paint")
	# (a model without a carpaint, the karts: its material called body is the paint)
	if not _has_material(root, body_re):
		body_re = RegEx.create_from_string("(?i)^body$")
	var rim_re := RegEx.create_from_string("(?i)rim[ _-]?paint")
	var count := 0
	for m in root.find_children("*", "MeshInstance3D", true, false):
		var mi := m as MeshInstance3D
		if mi.mesh == null:
			continue
		for i in mi.mesh.get_surface_count():
			var mat := mi.get_active_material(i) as BaseMaterial3D
			if mat == null:
				continue
			var colour: Variant = null
			var finish := ""
			if body != null and body_re.search(mat.resource_name) != null:
				colour = body
				finish = body_finish
			elif rim != null and rim_re.search(mat.resource_name) != null:
				colour = rim
				finish = rim_finish
			if colour == null:
				continue
			var own := mat.duplicate() as BaseMaterial3D
			own.albedo_color = colour
			own.albedo_texture = null
			var f: Array = FINISHES.get(finish, FINISHES["gloss"])
			own.roughness = f[0]
			own.metallic = f[1]
			own.clearcoat_enabled = f[2] > 0.0
			own.clearcoat = f[2]
			own.clearcoat_roughness = f[3]
			mi.set_surface_override_material(i, own)
			count += 1
	return count


static func _has_material(root: Node, re: RegEx) -> bool:
	for m in root.find_children("*", "MeshInstance3D", true, false):
		var mi := m as MeshInstance3D
		if mi.mesh == null:
			continue
		for i in mi.mesh.get_surface_count():
			var mat := mi.get_active_material(i)
			if mat != null and re.search(mat.resource_name) != null:
				return true
	return false

