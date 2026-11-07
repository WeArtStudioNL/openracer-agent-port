class_name SoftBodyMesh
extends RefCounted
## Bends the model of a car with the nodes of its shell (web/js/SoftBodyMesh.js). Every vertex of the body is tied
## to its four nearest nodes, with weights; the graphics card moves it with them. The browser game does that in a
## vertex shader; here it is the skinning of Godot: a Skeleton3D ("Shell") in the frame of the car with a bone for
## every node, whose pose is the displacement of the node, and the meshes of the body made again once with the
## nodes and the weights as bones (their vertices put in the frame of the car, so that a bone that moves by d moves
## its vertices by d). The weights are worked out in a thread when the car is made (a model has up to a million
## vertices); until they are there the model does not bend.
##
## The vertices of a part (car.json "parts") with nodes of its own are tied to those nodes, the others to the nodes
## of the body.

const CELL := 0.5
const CANDIDATES := 16
const REACH := 0.9                  # m: a node further than this from a vertex hardly moves it

var car: Car
var sb: SoftBody
var skeleton: Skeleton3D = null
var ready := false
var meshes: Array[MeshInstance3D] = []          # the meshes that bend
var source_of := {}                 # a mesh that bends -> {node: the object of the model it came from, group, arrays}
var _jobs: Array = []
var _task := -1
var _seen := -1
var _nodes := PackedVector3Array()


func _init(c: Car, s: SoftBody, part_objects: Dictionary) -> void:
	car = c
	sb = s
	for k in sb.count:
		_nodes.append(sb.rest[k])
	for m in car.model_root.find_children("*", "MeshInstance3D", true, false):
		var mi := m as MeshInstance3D
		if mi.mesh == null or not mi.is_visible_in_tree() or CollisionProxy.hidden_object(mi):
			continue
		var group := ""
		var n: Node = mi
		while n != null and n != car.model_root:
			if part_objects.has(str(n.name)):
				group = str(n.name)
				break
			n = n.get_parent()
		var allowed := PackedInt32Array()
		for k in sb.count:
			if sb.part_of[k] == group:
				allowed.append(k)
		if allowed.is_empty():
			for k in sb.count:
				if sb.part_of[k] == "":
					allowed.append(k)
		var surfaces: Array = []
		var ok := true
		for si in mi.mesh.get_surface_count():
			if mi.mesh is ArrayMesh and (mi.mesh as ArrayMesh).surface_get_primitive_type(si) != Mesh.PRIMITIVE_TRIANGLES:
				ok = false
			surfaces.append(mi.mesh.surface_get_arrays(si))
		if not ok or surfaces.is_empty():
			continue
		_jobs.append({"mi": mi, "xf": CarModel.relative(mi, car), "allowed": allowed, "surfaces": surfaces, "group": group, "out": []})
	if _jobs.is_empty():
		return
	_task = WorkerThreadPool.add_task(_weigh_all, false, "soft body weights")


## (in a thread: only the arrays of the jobs are touched)
func _weigh_all() -> void:
	for job: Dictionary in _jobs:
		var grid := {}
		var xf: Transform3D = job["xf"]
		var nb := xf.basis.inverse().transposed()
		var flip := xf.basis.determinant() < 0.0
		var allowed: PackedInt32Array = job["allowed"]
		for arrays: Array in job["surfaces"]:
			var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
			var nv := verts.size()
			var out_v := PackedVector3Array()
			out_v.resize(nv)
			var bones := PackedInt32Array()
			bones.resize(4 * nv)
			var weights := PackedFloat32Array()
			weights.resize(4 * nv)
			for vi in nv:
				var p: Vector3 = xf * verts[vi]
				out_v[vi] = p
				var key := Vector3i(floori(p.x / CELL), floori(p.y / CELL), floori(p.z / CELL))
				var cand: Variant = grid.get(key)
				if cand == null:
					cand = _candidates(key, allowed)
					grid[key] = cand
				var b0 := 0
				var b1 := 0
				var b2 := 0
				var b3 := 0
				var d0 := 1e9
				var d1 := 1e9
				var d2 := 1e9
				var d3 := 1e9
				for k: int in cand:
					var d := p.distance_squared_to(_nodes[k])
					if d >= d3:
						continue
					# (insert into the sorted four)
					d3 = d
					b3 = k
					if d3 < d2:
						d3 = d2
						b3 = b2
						d2 = d
						b2 = k
						if d2 < d1:
							d2 = d1
							b2 = b1
							d1 = d
							b1 = k
							if d1 < d0:
								d1 = d0
								b1 = b0
								d0 = d
								b0 = k
				var o := 4 * vi
				bones[o] = b0
				bones[o + 1] = b1
				bones[o + 2] = b2
				bones[o + 3] = b3
				var w0 := _weight(d0, true)
				var w1 := _weight(d1, false)
				var w2 := _weight(d2, false)
				var w3 := _weight(d3, false)
				var sum := w0 + w1 + w2 + w3
				weights[o] = w0 / sum
				weights[o + 1] = w1 / sum
				weights[o + 2] = w2 / sum
				weights[o + 3] = w3 / sum
			var res := {"v": out_v, "bones": bones, "weights": weights}
			var normals: Variant = arrays[Mesh.ARRAY_NORMAL]
			if normals is PackedVector3Array and (normals as PackedVector3Array).size() == nv:
				var out_n := PackedVector3Array()
				out_n.resize(nv)
				for vi in nv:
					out_n[vi] = (nb * (normals as PackedVector3Array)[vi]).normalized()
				res["n"] = out_n
			var tangents: Variant = arrays[Mesh.ARRAY_TANGENT]
			if tangents is PackedFloat32Array and (tangents as PackedFloat32Array).size() == 4 * nv:
				var tg := tangents as PackedFloat32Array
				var out_t := PackedFloat32Array()
				out_t.resize(4 * nv)
				for vi in nv:
					var t := (xf.basis * Vector3(tg[4 * vi], tg[4 * vi + 1], tg[4 * vi + 2])).normalized()
					out_t[4 * vi] = t.x
					out_t[4 * vi + 1] = t.y
					out_t[4 * vi + 2] = t.z
					out_t[4 * vi + 3] = -tg[4 * vi + 3] if flip else tg[4 * vi + 3]
				res["t"] = out_t
			(job["out"] as Array).append(res)


func _weight(d2: float, first: bool) -> float:
	var dist := sqrt(d2)
	if not first and dist >= REACH:
		return 0.0
	var x := maxf(0.02, 1.0 - dist / REACH)
	return x * x


## The nodes that can be among the four nearest of a vertex in a cell: the nearest to its middle.
func _candidates(key: Vector3i, allowed: PackedInt32Array) -> PackedInt32Array:
	var c := (Vector3(key) + Vector3(0.5, 0.5, 0.5)) * CELL
	var list := []
	for k in allowed:
		list.append([c.distance_squared_to(_nodes[k]), k])
	list.sort_custom(func(x: Array, y: Array) -> bool: return x[0] < y[0])
	var out := PackedInt32Array()
	for j in mini(CANDIDATES, list.size()):
		out.append(int(list[j][1]))
	return out


## Once a frame: when the weights are there the meshes are made; the bones follow the nodes when one moved.
func update() -> void:
	if not ready:
		if _task < 0 or not WorkerThreadPool.is_task_completed(_task):
			return
		WorkerThreadPool.wait_for_task_completion(_task)
		_task = -1
		_build()
		ready = true
	if sb.version == _seen or skeleton == null:
		return
	_seen = sb.version
	for k in sb.count:
		skeleton.set_bone_pose_position(k, sb.displacement[k])


## Waits for the thread (the car is going away).
func dispose() -> void:
	if _task >= 0:
		WorkerThreadPool.wait_for_task_completion(_task)
		_task = -1


func _build() -> void:
	skeleton = Skeleton3D.new()
	skeleton.name = "Shell"
	for k in sb.count:
		skeleton.add_bone("n%d" % k)
	car.add_child(skeleton)
	var skin := Skin.new()
	for k in sb.count:
		skin.add_bind(k, Transform3D.IDENTITY)
	for job: Dictionary in _jobs:
		var mi: MeshInstance3D = job["mi"]
		if not is_instance_valid(mi) or mi.mesh == null:
			continue
		var old := mi.mesh
		var mesh := ArrayMesh.new()
		var outs: Array = job["out"]
		for si in outs.size():
			var arrays: Array = (job["surfaces"][si] as Array).duplicate()
			var res: Dictionary = outs[si]
			arrays[Mesh.ARRAY_VERTEX] = res["v"]
			arrays[Mesh.ARRAY_NORMAL] = res.get("n", null)
			arrays[Mesh.ARRAY_TANGENT] = res.get("t", null)
			arrays[Mesh.ARRAY_BONES] = res["bones"]
			arrays[Mesh.ARRAY_WEIGHTS] = res["weights"]
			# (the formats of the custom arrays, the extra uv sets of a glTF, come with the surface)
			var flags := 0
			if old is ArrayMesh:
				for ci in 4:
					var shift := Mesh.ARRAY_FORMAT_CUSTOM_BASE + ci * Mesh.ARRAY_FORMAT_CUSTOM_BITS
					flags |= (old as ArrayMesh).surface_get_format(si) & (Mesh.ARRAY_FORMAT_CUSTOM_MASK << shift)
			mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays, [], {}, flags)
			mesh.surface_set_material(si, old.surface_get_material(si))
		var bent := MeshInstance3D.new()
		bent.name = str(mi.name)
		bent.mesh = mesh
		bent.skin = skin
		bent.material_override = mi.material_override
		for si in mesh.get_surface_count():
			bent.set_surface_override_material(si, mi.get_surface_override_material(si))
		bent.cast_shadow = mi.cast_shadow
		bent.layers = mi.layers
		bent.transparency = mi.transparency
		skeleton.add_child(bent)
		bent.skeleton = NodePath("..")
		mi.mesh = null
		meshes.append(bent)
		source_of[bent] = {"node": mi, "group": job["group"], "surfaces": job["surfaces"], "out": outs}
	_jobs.clear()
