class_name ShellView
extends MeshInstance3D
## The shell of a car drawn over it (the debug view of the browser game, DebugView.js): the nodes as small crosses and
## the beams as lines, green where whole, yellow at the yield of their bend, red past it, grey where torn; the beams of
## the suspension in blue. F7 shows it and hides it (or --show-shell from the start).

const KEY := KEY_F7

var car: Car


static func make(c: Car) -> ShellView:
	var v := ShellView.new()
	v.name = "ShellView"
	v.car = c
	v.visible = Content.arg("show-shell") != ""
	v.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	v.mesh = ImmediateMesh.new()
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.vertex_color_use_as_albedo = true
	mat.no_depth_test = true
	mat.render_priority = 10
	v.material_override = mat
	return v


func _unhandled_key_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo and (event as InputEventKey).physical_keycode == KEY:
		visible = not visible


func _process(_delta: float) -> void:
	var im := mesh as ImmediateMesh
	im.clear_surfaces()
	if not visible or car == null or not is_instance_valid(car) or car.shell == null:
		return
	global_transform = car.global_transform
	var sb := car.shell.sb
	im.surface_begin(Mesh.PRIMITIVE_LINES)
	for i in sb.beam_count:
		var a := sb.beam_a[i]
		var b := sb.beam_b[i]
		if sb.gone[a] == 1 or sb.gone[b] == 1:
			continue
		var c := Color(0.25, 0.5, 1.0) if sb.beam_rig[i] == 1 else Color(0.2, 0.9, 0.3)
		if sb.beam_alive[i] == 0:
			c = Color(0.4, 0.4, 0.4)
		elif absf(sb.beam_rest[i] - sb.beam_made[i]) > 0.002:
			c = Color(0.95, 0.85, 0.2)
		im.surface_set_color(c)
		im.surface_add_vertex(sb.position(a))
		im.surface_set_color(c)
		im.surface_add_vertex(sb.position(b))
	for k in sb.count:
		if sb.gone[k] == 1:
			continue
		var bend := sb.bend_of(k)
		var c := Color(0.2, 0.9, 0.3) if bend < 0.005 else (Color(0.95, 0.85, 0.2) if bend < 0.05 else Color(1.0, 0.25, 0.2))
		if sb.anchor_alive[k] == 0:
			c = Color(0.5, 0.5, 0.5)
		var p := sb.position(k)
		var r := minf(0.05, sb.radius[k] * 0.4)
		for d in [Vector3(r, 0, 0), Vector3(0, r, 0), Vector3(0, 0, r)]:
			im.surface_set_color(c)
			im.surface_add_vertex(p - d)
			im.surface_set_color(c)
			im.surface_add_vertex(p + d)
	im.surface_end()
