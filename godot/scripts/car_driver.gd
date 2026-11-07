# gdlint: disable=max-public-methods
class_name CarDriver
extends RefCounted
## The driver of a car (web/js/Driver.js): a model (a glb with a skeleton, in the T pose, made in Blender) that sits in
## the car. car.json "driver" places it and the game moves it:
## - the hands hold the steering wheel and turn with it. The two grips are set in the car editor; a grip is on the
##   wheel at the angle that its hand has, and when a hand would go over the middle of the wheel it lets go and takes
##   the wheel again further back (one hand at a time), as a driver does; or the hands follow the keys that the car
##   editor set ("keys": the place, the turn and the grip of each hand, and the turn of the chest and the head, at turns
##   of the wheel);
## - the feet follow the pedals: the right foot the throttle, the left foot the brake, along the way the pedal moves;
## - the arms and the legs are two bones each with an inverse kinematics (BoneIK): the hand or the foot goes to its
##   place and the elbow or the knee bends to the side of a pole (car.json "poles", or elbow_out and knee_out);
## - the chest and the head are turned as the car editor set them, the fingers close by grip_curl;
## - in the cockpit view the head is not drawn and the torso is cut away (or the whole driver, cameras.cockpit.hide_driver).
## car.json "driver": { enabled, file, position [x, y, z], rotation [x, y, z] (degrees), scale, bones: { hips, chest,
## head, armL: [upper, lower, hand], armR, legL: [upper, lower, foot], legR }, wheel: { position, rotation, radius } (the
## ring of the hands, matched to the steering wheel of the model), poles, hands: { left, right, rotation, grip }, feet:
## { left (the brake), right (the throttle), travel (m), direction }, elbow_out, knee_out, keys }, all in the space of
## the body of the car. Not here: the rider of a motorcycle (MotorcycleRider), the ragdoll of a crash.

const CURL_DEGREES := 65.0
const DEG := PI / 180.0
const FIRST := 130.0 * DEG           # the trail hand lets go of the wheel at this turn
const PULL_END := 120.0 * DEG
const BACK := 0.24                   # the chest, where a hand goes on its way over: behind the middle of the wheel and down
const CHEST_DOWN := 0.06
const PATH_TIME := 0.6               # s: how long a hand takes from the wheel to the top of the wheel
const LOCK_MARGIN := 20.0 * DEG
const CULL_MAX := 64
const TORSO_NAME := "(?i)spine|chest|torso|hips|pelvis|neck|breast|belly|stomach|shoulder|clavicle|upper_?arm|bicep"
const LIMB_NAME := "(?i)forearm|lower_?arm|hand|leg|foot|thigh|shin|head|finger|thumb|toe"
const CULL_SHADER := """
shader_type spatial;
uniform vec4 albedo : source_color = vec4(1.0);
uniform sampler2D albedo_texture : source_color, filter_linear_mipmap, repeat_enable;
uniform bool has_texture = false;
uniform sampler2D normal_texture : hint_normal, filter_linear_mipmap, repeat_enable;
uniform bool has_normal = false;
uniform float roughness = 0.8;
uniform float metallic = 0.0;
varying float torso;
void vertex() {
	torso = CUSTOM0.x;
}
void fragment() {
	if (torso > 0.5) { discard; }
	vec4 c = albedo;
	if (has_texture) { c *= texture(albedo_texture, UV); }
	ALBEDO = c.rgb;
	ROUGHNESS = roughness;
	METALLIC = metallic;
	if (has_normal) { NORMAL_MAP = texture(normal_texture, UV).rgb; }
}
"""

var cfg: Dictionary                  # the "driver" of car.json with the defaults (the car editor changes it)
var parent: Node3D                   # the frame of the body of the car: the places of cfg are in it
var root: Node3D                     # the figure: placed, turned and scaled as cfg says
var model: Node3D = null
var skel: Skeleton3D = null
var steering := {}                   # the wheel the hands hold: { axis, centre (the space of the body), degrees, angle }
var bones := {}                      # armL, armR, legL, legR: [upper, lower, end] (-1: not found); hips, head: a bone; chest: [bones]
var spine_mid: Array[int] = []       # the bones of the spine between the hips and the chest: the turn of the back is shared over them
var leg_roots: Array[int] = []       # (a rig whose legs hang on a tree of their own, Rigify: the bone they hang on)
var fingers := {"armL": [], "armR": []}
var facing := 0                      # 1: the model faces the front of the car, -1 the back, 0 not known
var turn := 0.0                      # the turn of the steering wheel (rad, positive to the left)
var throttle := 0.0
var brake := 0.0
var show_head := true
var torso_pose := {"chest": Vector3.ZERO, "head": Vector3.ZERO}
var poles := {}                      # where the elbows and the knees pointed to in the last frame (the space of the body)
var hand_pose := {"left": {"pos": Vector3.ZERO, "quat": Quaternion.IDENTITY, "grip": 0.0, "keyed": false},
	"right": {"pos": Vector3.ZERO, "quat": Quaternion.IDENTITY, "grip": 0.0, "keyed": false}}
var turned_round := false            # (the car editor: a new model that faced the back was turned round)

var _hand := {"left": {"p": 0.0, "delta": 0.0}, "right": {"p": 0.0, "delta": 0.0}}
var _rest_grip := {"left": Vector3.ZERO, "right": Vector3.ZERO}
var _grip_angle := {"left": 0.0, "right": 0.0}
var _plan := {"sign": 1.0, "lead": "left", "trail": "right", "rel": {"left": 0.0, "right": 0.0}, "end": {"left": 0.0, "right": 0.0}, "lock": PI}
var _centre := Vector3.ZERO
var _axis := Vector3.BACK
var _top := Vector3.UP
var _side := Vector3.RIGHT
var _baking := false
var _follow: Array = []              # [{ def, org, from (the rest of def, inverted), org_rest }]
var _cull: Array = []                # [{ mesh, materials (the own), shader material }]
var _cull_on := false


func _init(frame: Node3D, config: Variant, steer := {}) -> void:
	cfg = with_defaults(config)
	parent = frame
	steering = steer
	root = Node3D.new()
	root.name = "DriverFigure"
	parent.add_child(root)


static func defaults() -> Dictionary:
	return {"enabled": false, "file": "", "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": 1, "bones": {},
		"hands": {"left": [0.15, 0.2, 0.3], "right": [-0.15, 0.2, 0.3]},
		"feet": {"left": [0.1, -0.1, 0.5], "right": [-0.1, -0.1, 0.5], "travel": 0.06, "direction": [0, -0.5, 0.85]},
		"elbow_out": 0.5, "knee_out": 0.15, "poles": null, "wheel": null, "pivot": "", "grip_curl": "x",
		"chest": {"rotation": [0, 0, 0]}, "head": {"rotation": [0, 0, 0]}}


## The driver of car.json with what it does not say from the defaults (Driver.withDefaults), a copy.
static func with_defaults(c: Variant) -> Dictionary:
	var given: Dictionary = (c as Dictionary).duplicate(true) if c is Dictionary else {}
	var out := defaults()
	out.merge(given, true)
	var hands: Dictionary = defaults()["hands"]
	hands.merge(given.get("hands", {}) if given.get("hands") is Dictionary else {}, true)
	for k in ["rotation", "offset"]:
		var g: Dictionary = hands.get(k, {}) if hands.get(k) is Dictionary else {}
		hands[k] = {"left": g.get("left", [0, 0, 0]) if g.get("left") is Array else [0, 0, 0],
			"right": g.get("right", [0, 0, 0]) if g.get("right") is Array else [0, 0, 0]}
	var hg: Dictionary = hands.get("grip", {}) if hands.get("grip") is Dictionary else {}
	hands["grip"] = {"left": float(hg.get("left", 0)), "right": float(hg.get("right", 0))}
	out["hands"] = hands
	var feet: Dictionary = defaults()["feet"]
	feet.merge(given.get("feet", {}) if given.get("feet") is Dictionary else {}, true)
	var fo: Dictionary = feet.get("offset", {}) if feet.get("offset") is Dictionary else {}
	feet["offset"] = {"left": fo.get("left", [0, 0, 0]) if fo.get("left") is Array else [0, 0, 0],
		"right": fo.get("right", [0, 0, 0]) if fo.get("right") is Array else [0, 0, 0]}
	out["feet"] = feet
	out["bones"] = given.get("bones", {}) if given.get("bones") is Dictionary else {}
	for k in ["keys", "poles", "wheel"]:
		out[k] = given[k] if given.get(k) is Dictionary else null
	for k in ["chest", "head"]:
		var r: Variant = given.get(k, {}).get("rotation") if given.get(k) is Dictionary else null
		out[k] = {"rotation": r if r is Array and (r as Array).size() == 3 else [0, 0, 0]}
	for k in ["position", "rotation"]:
		if not (out[k] is Array and (out[k] as Array).size() == 3):
			out[k] = [0, 0, 0]
	return out


# ---- the model

## Puts the model in the place of cfg.
func place() -> void:
	var s := float(cfg.get("scale", 1))
	root.transform = Transform3D(BoneIK.euler(BoneIK.vec(cfg["rotation"])).scaled(Vector3.ONE * (s if s > 0.0 else 1.0)), BoneIK.vec(cfg["position"]))


## The model: the scene of a glb. The bones are found by the names of cfg, or by a guess for what cfg does not say.
func set_model(scene: Node3D) -> bool:
	if model != null:
		_set_cull(false)
		root.remove_child(model)
		model.queue_free()
		model = null
		skel = null
	var found := scene.find_children("*", "Skeleton3D", true, false)
	if found.is_empty():
		scene.free()
		return false
	model = scene
	skel = found[0] as Skeleton3D
	for m in scene.find_children("*", "MeshInstance3D", true, false):
		(m as MeshInstance3D).extra_cull_margin = 2.0
	root.add_child(scene)
	place()
	resolve_bones()
	# the model turns and scales about its hips: it is moved so that its hips are at the origin of the driver; a driver
	# that was saved with the origin at the feet (without "pivot") is converted, so that it stays where it was
	var hips: int = bones.get("hips", -1)
	if hips >= 0:
		var h := CarModel.relative(skel, root) * skel.get_bone_global_rest(hips).origin
		if str(cfg.get("pivot", "")) != "hips":
			var s := float(cfg.get("scale", 1))
			var move := BoneIK.euler(BoneIK.vec(cfg["rotation"])) * (h * (s if s > 0.0 else 1.0))
			cfg["position"] = BoneIK.arr(BoneIK.vec(cfg["position"]) + move)
			cfg["pivot"] = "hips"
		scene.position -= h
		place()
	facing = measure_facing()
	_make_cull()
	return true


## Which way the model faces, from where its shoulders are: 1 when it faces +z (the front of the car: its left side
## is on +x), -1 when it faces the other way (a Rigify mannequin from Blender comes in so), 0 when they are not found.
func measure_facing() -> int:
	if not complete():
		return 0
	var dx := _body_pos(bones["armL"][0]).x - _body_pos(bones["armR"][0]).x
	return 0 if absf(dx) < 1e-4 else (1 if dx > 0.0 else -1)


func complete() -> bool:
	if skel == null:
		return false
	for k in ["armL", "armR", "legL", "legR"]:
		if not bones.has(k) or (bones[k] as Array).has(-1):
			return false
	return true


## The bones of the roles: the names of cfg "bones", else the guess (guess_bones).
func resolve_bones() -> void:
	if skel == null:
		return
	skel.reset_bone_poses()
	var guess := guess_bones(skel)
	var names: Dictionary = cfg.get("bones", {}) if cfg.get("bones") is Dictionary else {}
	for k in ["armL", "armR", "legL", "legR"]:
		var given: Array = names.get(k, []) if names.get(k) is Array else []
		var list: Array[int] = []
		for i in 3:
			var n: Variant = given[i] if i < given.size() else null
			var b := BoneIK.find(skel, str(n)) if n is String else -1
			list.append(b if b >= 0 else int(guess[k][i]))
		bones[k] = list
	for k in ["hips", "head"]:
		var b := BoneIK.find(skel, str(names[k])) if names.get(k) is String else -1
		bones[k] = b if b >= 0 else int(guess[k])
	# the chest: the bone that the shoulders hang on, and the bone of the mesh that goes with it (a Rigify rig has the
	# deform bone DEF-spine.003, and ORG-spine.003 that the arms hang on)
	var chest := BoneIK.find(skel, str(names["chest"])) if names.get("chest") is String else -1
	if chest < 0:
		chest = int(guess["chest"])
	bones["chest"] = [] as Array[int]
	if chest >= 0:
		bones["chest"].append(chest)
		var nm := skel.get_bone_name(chest)
		var partner := BoneIK.find(skel, "ORG-" + nm.substr(4)) if nm.begins_with("DEF-") else -1
		if partner >= 0 and partner != chest:
			bones["chest"].append(partner)
	_spine_and_roots()
	_find_fingers()


func _spine_and_roots() -> void:
	var hips: int = bones["hips"]
	spine_mid = []
	var def_chest := -1
	for b in bones["chest"]:
		if skel.get_bone_name(b).begins_with("DEF-"):
			def_chest = b
			break
	var b := skel.get_bone_parent(def_chest) if def_chest >= 0 else -1
	while b >= 0 and b != hips and spine_mid.size() < 4:
		spine_mid.push_front(b)
		b = skel.get_bone_parent(b)
	if b != hips:
		spine_mid = []
	leg_roots = []
	for k in ["legL", "legR"]:
		var up := skel.get_bone_parent(bones[k][0]) if bones[k][0] >= 0 else -1
		if up >= 0 and up != hips and not leg_roots.has(up):
			leg_roots.append(up)
	# the bones that the arms and the legs hang on in a rig with two trees (ORG- beside DEF-) are put where their DEF bones
	# went: the same move from the rest as the DEF bone made (followOrg of Driver.js)
	_follow = []
	var pairs := []
	for c in bones["chest"]:
		if c != def_chest and def_chest >= 0:
			pairs.append([def_chest, c])
	for r in leg_roots:
		if hips >= 0:
			pairs.append([hips, r])
	for p in pairs:
		_follow.append({"def": p[0], "org": p[1], "from": skel.get_bone_global_rest(p[0]).affine_inverse(), "org_rest": skel.get_bone_global_rest(p[1])})


## The bone names of the roles that resolve_bones found, as car.json keeps them (the names of the browser).
func bone_config() -> Dictionary:
	var out := {}
	for k in ["armL", "armR", "legL", "legR"]:
		if bones.has(k) and not (bones[k] as Array).has(-1):
			var names := []
			for b in bones[k]:
				names.append(BoneIK.browser_name(skel.get_bone_name(b)))
			out[k] = names
	for k in ["hips", "head"]:
		if int(bones.get(k, -1)) >= 0:
			out[k] = BoneIK.browser_name(skel.get_bone_name(bones[k]))
	if not (bones.get("chest", []) as Array).is_empty():
		out["chest"] = BoneIK.browser_name(skel.get_bone_name(bones["chest"][0]))
	return out


## A guess at the bones of a skeleton by their names (Blender, Rigify, Mixamo and the like): the three bones of an arm
## and of a leg on each side, the hips, the chest and the head (-1 where nothing is found). The names are tried as the
## browser has them (without the dots).
static func guess_bones(sk: Skeleton3D) -> Dictionary:
	var names := []
	var sides := []
	for i in sk.get_bone_count():
		names.append(BoneIK.browser_name(sk.get_bone_name(i)))
		sides.append(_side_of(names[i]))
	var out := {}
	for side in ["L", "R"]:
		out["arm" + side] = [_find_bone(names, sides, side, ["(?i)upper.?arm", "(?i)(^|[^a-z])arm(?!.*(fore|lower))", "(?i)shoulder"], "(?i)clav|fore|lower|hand"),
			_find_bone(names, sides, side, ["(?i)fore.?arm", "(?i)lower.?arm"]), _find_bone(names, sides, side, ["(?i)hand", "(?i)wrist"])]
		out["leg" + side] = [_find_bone(names, sides, side, ["(?i)thigh", "(?i)upper.?leg", "(?i)up.?leg"]),
			_find_bone(names, sides, side, ["(?i)shin", "(?i)calf", "(?i)lower.?leg", "(?i)leg"], "(?i)thigh|upper|up.?leg|foot"),
			_find_bone(names, sides, side, ["(?i)foot", "(?i)ankle"])]
	var control := "(?i)(^|[-_.])(ORG|MCH|WGT|VIS)|tweak|_fk|_ik|master|parent|widget|pole|\\.?00\\d$"
	out["chest"] = _first_bone(names, ["(?i)^DEF-spine\\.?003$"], "")
	if out["chest"] < 0:
		out["chest"] = _first_bone(names, ["(?i)(^|[^a-z])(chest|upper.?body|torso)", "(?i)spine\\.?0?(2|1)$"], control)
	out["hips"] = _first_bone(names, ["(?i)^DEF-spine$"], "")
	if out["hips"] < 0:
		out["hips"] = _first_bone(names, ["(?i)hips|pelvis"], control)
	if out["hips"] < 0:
		out["hips"] = _first_bone(names, ["(?i)hips|pelvis"], "")
	out["head"] = _first_bone(names, ["(?i)^DEF-spine\\.?006$|^DEF-head$"], "")
	var head := "(?i)^head|[^a-z]head$|head$"
	if out["head"] < 0:
		out["head"] = _first_bone(names, [head], control + "|end|top")
	if out["head"] < 0:
		out["head"] = _first_bone(names, [head], "(?i)end|top")
	return out


static func _side_of(n: String) -> String:
	var s := RegEx.create_from_string("[^A-Za-z0-9]+").sub(n, "_", true)
	if RegEx.create_from_string("(^|_)(l|left)(_|$)|left|(?:[a-z])L$").search(s) != null or RegEx.create_from_string("_L(_|$)").search(s) != null:
		return "L"
	if RegEx.create_from_string("(^|_)(r|right)(_|$)|right|(?:[a-z])R$").search(s) != null or RegEx.create_from_string("_R(_|$)").search(s) != null:
		return "R"
	return ""


## The bone of a side that the first pattern that finds one finds: a deform bone (DEF-) before the others, a control bone last.
static func _find_bone(names: Array, sides: Array, side: String, patterns: Array, exclude := "") -> int:
	var finger := RegEx.create_from_string("(?i)finger|thumb|index|middle|ring|pinky|little|toe|twist|roll")
	var control := RegEx.create_from_string("(?i)(^|[-_.])(ORG|MCH|WGT|VIS)|tweak|_fk|_ik|master|parent|widget|pole|\\.?00\\d$")
	var ex := RegEx.create_from_string(exclude) if exclude != "" else null
	for pat in patterns:
		var re := RegEx.create_from_string(pat)
		var best := -1
		var best_rank := 9
		for i in names.size():
			var n: String = names[i]
			if sides[i] != side or re.search(n) == null or (ex != null and ex.search(n) != null) or finger.search(n) != null:
				continue
			var rank := 0 if n.begins_with("DEF-") and control.search(n) == null else (2 if control.search(n) != null else 1)
			if rank < best_rank:
				best_rank = rank
				best = i
		if best >= 0:
			return best
	return -1


static func _first_bone(names: Array, patterns: Array, exclude: String) -> int:
	var ex := RegEx.create_from_string(exclude) if exclude != "" else null
	for pat in patterns:
		var re := RegEx.create_from_string(pat)
		for i in names.size():
			if re.search(names[i]) != null and (ex == null or ex.search(names[i]) == null):
				return i
	return -1


# ---- the fingers: every bone below a hand, except the bones of the palm, turns about its local x axis (a Blender rig
# closes all the joints of a finger by turning them about their local x; the thumb the same). grip_curl "-x" turns
# the other way. A rig with control bones (Rigify) has the fingers that move the mesh named DEF-: those curl.

func _find_fingers() -> void:
	fingers = {"armL": [], "armR": []}
	var axis := Vector3(-1.0 if str(cfg.get("grip_curl", "x")) == "-x" else 1.0, 0, 0)
	var digit := RegEx.create_from_string("(?i)^DEF-.*(f_|finger|thumb)")
	for k in ["armL", "armR"]:
		var hand: int = bones[k][2]
		if hand < 0:
			continue
		var deform := false
		for b in _below(hand):
			deform = deform or digit.search(skel.get_bone_name(b)) != null
		_walk_fingers(k, hand, hand, 0, false, deform, axis)


func _below(b: int) -> Array[int]:
	var out: Array[int] = []
	for c in skel.get_bone_children(b):
		out.append(c)
		out.append_array(_below(c))
	return out


func _walk_fingers(k: String, hand: int, bone: int, depth: int, thumb: bool, deform: bool, axis: Vector3) -> void:
	var nm := skel.get_bone_name(bone)
	var palm := RegEx.create_from_string("(?i)palm|meta").search(nm) != null and depth == 0
	if not palm and bone != hand and not (deform and not nm.begins_with("DEF-")):
		fingers[k].append({"bone": bone, "depth": depth, "thumb": thumb, "axis": axis, "rest": skel.get_bone_rest(bone).basis.get_rotation_quaternion()})
		depth += 1
	elif palm:
		depth = 0
	for c in skel.get_bone_children(bone):
		_walk_fingers(k, hand, c, depth, thumb or skel.get_bone_name(c).to_lower().contains("thumb"), deform, axis)


## (the car editor, after grip_curl changed)
func refresh_fingers() -> void:
	if skel != null:
		_find_fingers()


## Closes the fingers of a hand (0 open, 1 closed).
func _curl(k: String, amount: float) -> void:
	for f in fingers[k]:
		skel.set_bone_pose_rotation(f["bone"], f["rest"] * Quaternion(f["axis"], deg_to_rad(CURL_DEGREES) * amount))


# ---- the space of the body

func _to_body() -> Transform3D:
	return CarModel.relative(skel, parent)


func _body_pos(b: int) -> Vector3:
	return _to_body() * BoneIK.global(skel, b).origin


## Turns a bone by degrees about the axes of the car (on top of its rest), as the car editor sets the chest and the head.
func _turn_bone(b: int, deg: Vector3, to_skel: Basis) -> void:
	if b < 0 or absf(deg.x) + absf(deg.y) + absf(deg.z) < 1e-6:
		return
	var q := to_skel * BoneIK.euler(deg) * to_skel.inverse()
	BoneIK.set_global_basis(skel, b, q * BoneIK.global(skel, b).basis.orthonormalized())


func _torso(to_skel: Basis) -> void:
	for n in ["chest", "head"]:
		var keyed: Variant = _torso_key_rot(n, turn)
		torso_pose[n] = keyed if keyed is Vector3 else BoneIK.vec(cfg[n].get("rotation", [0, 0, 0]))
	var share := 1.0 / (spine_mid.size() + 1)
	var chest: Vector3 = torso_pose["chest"]
	for b in spine_mid:
		_turn_bone(b, chest * share, to_skel)
	var followed := not _follow.is_empty()
	for b in bones["chest"]:
		var org := not skel.get_bone_name(b).begins_with("DEF-")
		if org and followed:
			continue
		_turn_bone(b, chest if org else chest * share, to_skel)
	for f in _follow:
		var m: Transform3D = BoneIK.global(skel, f["def"]) * f["from"] * f["org_rest"]
		var up := skel.get_bone_parent(f["org"])
		var local := (BoneIK.global(skel, up).affine_inverse() * m) if up >= 0 else m
		skel.set_bone_pose_position(f["org"], local.origin)
		skel.set_bone_pose_rotation(f["org"], local.basis.orthonormalized().get_rotation_quaternion())
	_turn_bone(bones["head"], torso_pose["head"], to_skel)


# ---- one frame

## The steering (steering["angle"], or turn set by hand when there is no steering), the pedals (0..1).
func update(dt: float, throttle_now: float, brake_now: float) -> void:
	if not complete():
		return
	skel.reset_bone_poses()
	if not steering.is_empty():
		turn = float(steering.get("angle", 0.0))
	throttle = throttle_now
	brake = brake_now
	var to_body := _to_body()
	var to_skel := to_body.affine_inverse()
	var turn_skel := to_skel.basis.orthonormalized()
	_torso(turn_skel)
	_read_grips()
	if not steering.is_empty():
		if keys_active():
			_plan_for(turn)
		else:
			_hands_step(dt)
	var wheel_ok := _wheel_frame()
	# the bones on the left of the car (+x in the space of the body) take the left hand and the left foot, whatever the
	# model calls them (a model that faces the other way has its L on the right)
	var arm_left := "armL" if _body_pos(bones["armL"][0]).x >= _body_pos(bones["armR"][0]).x else "armR"
	var leg_left := "legL" if _body_pos(bones["legL"][0]).x >= _body_pos(bones["legR"][0]).x else "legR"
	var hands: Dictionary = cfg["hands"]
	for e in [[arm_left, "left", 1.0], ["armR" if arm_left == "armL" else "armL", "right", -1.0]]:
		var chain: Array = bones[e[0]]
		var target := _grip_point(e[1])
		var pole := _pole(e[0], _body_pos(chain[0]) + Vector3(float(e[2]) * float(cfg["elbow_out"]), -0.5, -0.5))
		var hq: Variant = null
		if not steering.is_empty() and wheel_ok:
			# the turn of the hand as the car editor set it, turned about the middle of the wheel as far as the hand went round
			BoneIK.solve(skel, chain, to_skel * _rest_grip[e[1]], to_skel * pole, true)
			hq = BoneIK.global(skel, chain[2]).basis.orthonormalized()
		BoneIK.solve(skel, chain, to_skel * target, to_skel * pole, true)
		if hq is Basis:
			var qw := Basis(hand_pose[e[1]]["quat"]) if hand_pose[e[1]]["keyed"] else \
				Basis(_axis, _hand[e[1]]["delta"]) * BoneIK.euler(BoneIK.vec(hands["rotation"][e[1]]))
			BoneIK.set_global_basis(skel, chain[2], turn_skel * qw * turn_skel.inverse() * hq)
		var g: float = hand_pose[e[1]]["grip"] if hand_pose[e[1]]["keyed"] else float(hands["grip"][e[1]])
		_curl(e[0], clampf(g, 0.0, 1.0))
	var feet: Dictionary = cfg["feet"]
	var travel := BoneIK.vec(feet["direction"]).normalized() * float(feet["travel"])
	for e in [[leg_left, "left", 1.0, brake], ["legR" if leg_left == "legL" else "legL", "right", -1.0, throttle]]:
		var chain: Array = bones[e[0]]
		var target := BoneIK.vec(feet[e[1]]) + travel * float(e[3])
		var pole := _pole(e[0], _body_pos(chain[0]) + Vector3(float(e[2]) * float(cfg["knee_out"]), 0.35, 1.0))
		BoneIK.solve(skel, chain, to_skel * target, to_skel * pole, true)
	# in the cockpit the head is in the way of the camera
	if not show_head and bones["head"] >= 0:
		skel.set_bone_pose_scale(bones["head"], skel.get_bone_rest(bones["head"]).basis.get_scale() * 0.001)


## Where an elbow or a knee points to: the node set in the car editor, or the default.
func _pole(role: String, fallback: Vector3) -> Vector3:
	var given: Variant = cfg["poles"].get(role) if cfg.get("poles") is Dictionary else null
	var p := BoneIK.vec(given) if given is Array else fallback
	poles[role] = p
	return p


# ---- the hands on the steering wheel

## The axis, the middle and the way up of the wheel the hands hold: the ring of cfg "wheel", else the steering wheel.
func _wheel_frame() -> bool:
	var w: Variant = cfg.get("wheel")
	if w is Dictionary and (w as Dictionary).get("position") is Array:
		_centre = BoneIK.vec(w["position"])
		_axis = (BoneIK.euler(BoneIK.vec(w.get("rotation", [0, 0, 0]))) * Vector3.BACK).normalized()
		if (_axis.dot(steering["axis"]) < 0.0) if not steering.is_empty() else (_axis.z > 0.0):
			_axis = -_axis
	elif not steering.is_empty():
		_axis = (steering["axis"] as Vector3).normalized()
		_centre = steering["centre"]
	else:
		return false
	_top = Vector3.UP - _axis * _axis.y
	if _top.length_squared() < 1e-6:
		_top = Vector3.BACK
	_top = _top.normalized()
	_side = _axis.cross(_top)
	return true


## The angle of a point from the top of the wheel, about the axis (the way the wheel turns).
func _angle_of(p: Vector3) -> float:
	var rel := p - _centre
	return atan2(rel.dot(_side), rel.dot(_top))


## A point turned by an angle about the axis of the wheel.
func _turned(p: Vector3, angle: float) -> Vector3:
	return _centre + Basis(_axis, angle) * (p - _centre)


func _read_grips() -> void:
	var h: Dictionary = cfg["hands"]
	_rest_grip["left"] = BoneIK.vec(h["left"])
	_rest_grip["right"] = BoneIK.vec(h["right"])
	if _wheel_frame():
		_grip_angle["left"] = _angle_of(_rest_grip["left"])
		_grip_angle["right"] = _angle_of(_rest_grip["right"])


## How a driver turns a wheel a long way (here to the right; to the left it is the mirror image): the hands at 9 and 3
## turn with the wheel. At 130 degrees the trail hand lets go, goes by the chest to the top and takes the wheel there;
## then the lead hand lets go and goes to the top in one movement, to arrive a little before the end of the lock. All
## of it is a function of the turn, so the way back is the same movement the other way.
func _plan_for(t: float) -> void:
	var sign := 1.0 if t >= 0.0 else -1.0
	var lead := "left" if sign * _grip_angle["left"] < 0.0 else "right"
	var trail := "right" if lead == "left" else "left"
	var grab1 := maxf(FIRST + 10.0 * DEG, PULL_END - sign * float(_grip_angle[lead]))
	var degs := float(steering.get("degrees", 0.0))
	var lock := maxf(150.0 * DEG, degs * DEG if degs > 0.0 else 200.0 * DEG)
	var grab2 := maxf(grab1 + 10.0 * DEG, lock - LOCK_MARGIN)
	_plan["sign"] = sign
	_plan["lead"] = lead
	_plan["trail"] = trail
	_plan["rel"][trail] = FIRST
	_plan["end"][trail] = grab1
	_plan["rel"][lead] = grab1
	_plan["end"][lead] = grab2
	_plan["lock"] = lock


func _target_p(n: String, tau: float) -> float:
	return clampf((tau - float(_plan["rel"][n])) / (float(_plan["end"][n]) - float(_plan["rel"][n])), 0.0, 1.0)


func _hands_step(dt: float) -> void:
	_plan_for(turn)
	var tau := absf(turn)
	for n in ["left", "right"]:
		var step := dt / PATH_TIME
		_hand[n]["p"] = float(_hand[n]["p"]) + clampf(_target_p(n, tau) - float(_hand[n]["p"]), -step, step)


## Where a hand is now (the space of the body).
func _grip_point(n: String) -> Vector3:
	var h: Dictionary = _hand[n]
	if steering.is_empty():
		h["delta"] = 0.0
		return _rest_grip[n]
	if keys_active():
		var g: Variant = _key_pose(n, turn)
		if g != null:
			return hand_pose[n]["pos"]
	hand_pose[n]["keyed"] = false
	var sign: float = _plan["sign"]
	var tau := absf(turn)
	var rel: float = _plan["rel"][n]
	var end: float = _plan["end"][n]
	var p: float = h["p"]
	if p <= 0.0 and tau <= rel:
		h["delta"] = turn
		return _turned(_rest_grip[n], turn)
	# one curve through the place where the hand let go, the chest and the top (it turns with the wheel after the turn
	# at which the hand takes it), slow at both ends
	var s := _turned(_rest_grip[n], sign * minf(tau, rel))
	var e := _turned(_turned(_rest_grip[n], -float(_grip_angle[n])), sign * maxf(0.0, tau - end))
	var chest_at := _centre + _axis * BACK - _top * CHEST_DOWN
	var ctrl := chest_at * 2.0 - s * 0.5 - e * 0.5
	var u := p * p * (3.0 - 2.0 * p)
	var v := 1.0 - u
	var d0 := sign * minf(tau, rel)
	var d1 := -float(_grip_angle[n]) + sign * maxf(0.0, tau - end)
	h["delta"] = d0 + _wrap(d1 - d0) * u
	return s * v * v + ctrl * 2.0 * v * u + e * u * u


static func _wrap(x: float) -> float:
	return atan2(sin(x), cos(x)) if is_finite(x) else 0.0


# ---- the keys: the movement of each hand as the car editor set it. A key is at a place of the steering slider (t,
# degrees, from -lock to +lock; the turn of the wheel is minus that) and holds the place of the hand (pos), its turn
# (rot: degrees, in the space of the car), the grip (0..1) and whether it rides the wheel (wheel: the place and the turn
# are those at the middle, and go round with the wheel). The hand goes through the places of the keys on a smooth curve.

func keys_active() -> bool:
	if _baking or not (cfg.get("keys") is Dictionary):
		return false
	var k: Dictionary = cfg["keys"]
	return (k.get("left") is Array and not (k["left"] as Array).is_empty()) or (k.get("right") is Array and not (k["right"] as Array).is_empty())


func keys_any() -> bool:
	if not (cfg.get("keys") is Dictionary):
		return false
	for n in ["left", "right", "chest", "head"]:
		if cfg["keys"].get(n) is Array and not (cfg["keys"][n] as Array).is_empty():
			return true
	return false


func _key_list(n: String) -> Array:
	var k: Variant = cfg.get("keys")
	return k[n] if k is Dictionary and (k as Dictionary).get(n) is Array else []


## The place and the turn of a key at a turn of the wheel.
func _key_anchor(k: Dictionary, angle: float) -> Array:
	var pos := BoneIK.vec(k.get("pos", [0, 0, 0]))
	var q := Quaternion.IDENTITY
	if k.get("wheel", false):
		pos = _turned(pos, angle)
		q = Quaternion(_axis, angle)
	return [pos, q * BoneIK.euler(BoneIK.vec(k.get("rot", [0, 0, 0]))).get_rotation_quaternion()]


## The span of the keys that a turn is in: [i, j, u] (u: 0..1 from key i to key j).
static func _span(list: Array, t: float) -> Array:
	var at := -t / DEG
	var n := list.size()
	var i := 0
	while i < n - 1 and at >= float(list[i + 1]["t"]):
		i += 1
	var u := 0.0
	if at > float(list[0]["t"]) and i < n - 1:
		u = (at - float(list[i]["t"])) / (float(list[i + 1]["t"]) - float(list[i]["t"]))
	return [i, mini(i + 1, n - 1), u]


## The pose of a hand from its keys (into hand_pose); its grip, or null when there are no keys.
func _key_pose(n: String, t: float) -> Variant:
	var list := _key_list(n)
	if list.is_empty():
		return null
	var sp := _span(list, t)
	var i: int = sp[0]
	var j: int = sp[1]
	var u: float = sp[2]
	var a0 := _key_anchor(list[maxi(i - 1, 0)], t)
	var a1 := _key_anchor(list[i], t)
	var a2 := _key_anchor(list[j], t)
	var a3 := _key_anchor(list[mini(i + 2, list.size() - 1)], t)
	var u2 := u * u
	var u3 := u2 * u
	var pos: Vector3 = a0[0] * 0.5 * (-u3 + 2.0 * u2 - u) + a1[0] * 0.5 * (3.0 * u3 - 5.0 * u2 + 2.0) + a2[0] * 0.5 * (-3.0 * u3 + 4.0 * u2 + u) + a3[0] * 0.5 * (u3 - u2)
	var su := u2 * (3.0 - 2.0 * u)
	var pose: Dictionary = hand_pose[n]
	pose["pos"] = pos
	pose["quat"] = (a1[1] as Quaternion).slerp(a2[1], su)
	pose["grip"] = float(list[i].get("grip", 0)) + (float(list[j].get("grip", 0)) - float(list[i].get("grip", 0))) * su
	pose["keyed"] = true
	return pose["grip"]


## The turn of the chest or the head from its keys (degrees), or null when there are none.
func _torso_key_rot(n: String, t: float) -> Variant:
	var list := _key_list(n)
	if list.is_empty():
		return null
	var sp := _span(list, t)
	var u: float = sp[2]
	var qa := BoneIK.euler(BoneIK.vec(list[sp[0]].get("rot", [0, 0, 0]))).get_rotation_quaternion()
	var qb := BoneIK.euler(BoneIK.vec(list[sp[1]].get("rot", [0, 0, 0]))).get_rotation_quaternion()
	return BoneIK.euler_deg(Basis(qa.slerp(qb, u * u * (3.0 - 2.0 * u))))


func _keys() -> Dictionary:
	if not (cfg.get("keys") is Dictionary):
		cfg["keys"] = {"left": [], "right": []}
	return cfg["keys"]


static func _index_at(list: Array, t_deg: float) -> int:
	var at := -1
	for i in list.size():
		if absf(float(list[i]["t"]) - t_deg) < 0.75:
			at = i
	return at


static func _put(list: Array, at: int, key: Dictionary) -> void:
	if at >= 0:
		list[at] = key
	else:
		list.append(key)
		list.sort_custom(func(a: Dictionary, b: Dictionary): return float(a["t"]) < float(b["t"]))


## Sets the key of the chest or the head at a place of the steering slider (degrees); rot in degrees, in the space of the car.
func set_torso_key(n: String, t_deg: float, rot: Vector3) -> Dictionary:
	var keys := _keys()
	if not (keys.get(n) is Array):
		keys[n] = []
	var list: Array = keys[n]
	var at := _index_at(list, t_deg)
	var key := {"t": float(list[at]["t"]) if at >= 0 else snappedf(t_deg, 0.1), "rot": BoneIK.arr(rot, 0.1)}
	_put(list, at, key)
	return key


## Is a place on the rim of the wheel (where a hand rides).
func _on_rim(pos: Vector3, n: String) -> bool:
	var rel := pos - _centre
	var along := rel.dot(_axis)
	rel -= _axis * along
	var rim: Vector3 = _rest_grip[n] - _centre
	rim -= _axis * rim.dot(_axis)
	return absf(rel.length() - rim.length()) < 0.04 and absf(along) < 0.05


## Sets (or replaces) the key of a hand at a place of the steering slider (degrees): from the place (the space of the
## car), the turn and the grip. wheel: whether it rides the wheel (null: as the key that is there, or on the rim).
func set_key(side: String, t_deg: float, pos: Vector3, quat: Quaternion, grip: float, wheel: Variant = null) -> Variant:
	_read_grips()
	if not _wheel_frame():
		return null
	var keys := _keys()
	if not (keys.get(side) is Array):
		keys[side] = []
	var list: Array = keys[side]
	var at := _index_at(list, t_deg)
	var rides: bool = wheel if wheel is bool else (bool(list[at].get("wheel", false)) if at >= 0 else _on_rim(pos, side))
	var angle := -t_deg * DEG
	var p := pos
	var q := quat
	if rides:
		p = _turned(p, -angle)
		q = Quaternion(_axis, -angle) * q
	var key := {"t": float(list[at]["t"]) if at >= 0 else snappedf(t_deg, 0.1), "pos": BoneIK.arr(p), "rot": BoneIK.arr(BoneIK.euler_deg(Basis(q)), 0.1),
		"grip": snappedf(clampf(grip, 0.0, 1.0), 0.001), "wheel": rides}
	_put(list, at, key)
	return key


func remove_key(side: String, t_deg: float) -> void:
	var list := _key_list(side)
	for i in range(list.size() - 1, -1, -1):
		if absf(float(list[i]["t"]) - t_deg) < 0.75:
			list.remove_at(i)
	if not keys_any():
		cfg["keys"] = null


func key_at(side: String, t_deg: float) -> Variant:
	for k in _key_list(side):
		if absf(float(k["t"]) - t_deg) < 0.75:
			return k
	return null


## The keys of the positive side of the steering slider (t above 0) are put on the other side as a mirror image: the keys
## at a negative t are replaced by those of the other hand, mirrored about the plane through the middle of the wheel, and
## the turns of the chest and the head mirrored. Gives the number of keys made.
func mirror_keys() -> int:
	if not (cfg.get("keys") is Dictionary):
		return 0
	var keys: Dictionary = cfg["keys"]
	_read_grips()
	var plane := 2.0 * _centre.x
	var source := {}
	for n in ["left", "right", "chest", "head"]:
		source[n] = _key_list(n).filter(func(k: Dictionary): return float(k["t"]) > 0.0)
		keys[n] = _key_list(n).filter(func(k: Dictionary): return float(k["t"]) >= 0.0)
	var made := 0
	for pair in [["left", "right"], ["right", "left"], ["chest", "chest"], ["head", "head"]]:
		for k in source[pair[0]]:
			var q := BoneIK.euler(BoneIK.vec(k.get("rot", [0, 0, 0]))).get_rotation_quaternion()
			q.y = -q.y
			q.z = -q.z
			var copy := {"t": -float(k["t"]), "rot": BoneIK.arr(BoneIK.euler_deg(Basis(q)), 0.1)}
			if k.has("pos"):
				copy["pos"] = [snappedf(plane - float(k["pos"][0]), 0.001), k["pos"][1], k["pos"][2]]
				copy["grip"] = k.get("grip", 0)
				copy["wheel"] = k.get("wheel", false)
			keys[pair[1]].append(copy)
			made += 1
	for n in ["left", "right", "chest", "head"]:
		(keys[n] as Array).sort_custom(func(a: Dictionary, b: Dictionary): return float(a["t"]) < float(b["t"]))
	return made


## Keys from the automatic movement (the hand over): a start for the keys that are then set by hand.
func bake_keys() -> bool:
	_read_grips()
	if not _wheel_frame() or steering.is_empty():
		return false
	var saved_turn := turn
	var saved_p := [_hand["left"]["p"], _hand["right"]["p"]]
	cfg["keys"] = {"left": [], "right": []}
	_baking = true
	_plan_for(-1e-3)
	var lock := float(_plan["lock"]) / DEG
	var times := []
	for t in [0, 100, 130, 150, 170, 190, 210, 240, 290, 340, 390, roundi(lock - LOCK_MARGIN / DEG)]:
		if t <= lock and not times.has(float(t)):
			times.append(float(t))
	for t in times.duplicate():
		if t > 0.0:
			times.append(-t)
	times.sort()
	var hands: Dictionary = cfg["hands"]
	for t: float in times:
		turn = -t * DEG
		_plan_for(turn)
		for n in ["left", "right"]:
			var tau := absf(t) * DEG
			_hand[n]["p"] = _target_p(n, tau)
			var out := _grip_point(n)
			var p: float = _hand[n]["p"]
			var rides := (p <= 0.0 and tau <= float(_plan["rel"][n])) or (p >= 1.0 and tau > float(_plan["end"][n]))
			var q := Quaternion(_axis, _hand[n]["delta"]) * BoneIK.euler(BoneIK.vec(hands["rotation"][n])).get_rotation_quaternion()
			set_key(n, t, out, q, float(hands["grip"][n]), rides)
	_baking = false
	for n in ["chest", "head"]:
		set_torso_key(n, 0.0, BoneIK.vec(cfg[n]["rotation"]))
	turn = saved_turn
	_hand["left"]["p"] = saved_p[0]
	_hand["right"]["p"] = saved_p[1]
	return true


# ---- the cockpit view: the head is not drawn, and the vertices of the skinned mesh that belong mostly to the bones of
# the torso (the hips, the spine, the chest, the neck, the shoulders and the upper arms: by their names) are dropped
# while the view is inside, so the arms, the hands and the legs stay. (The browser does it in the vertex shader from the
# bone weights; Godot skins on the graphics card before the shader, so the weight of the torso of every vertex is put
# in a copy of the mesh, CUSTOM0, made the first time the view is inside, with a material that drops those vertices.)

func set_cockpit(inside: bool, hide_all := false) -> void:
	show_head = not inside
	root.visible = not (inside and hide_all)
	_set_cull(inside)


## The meshes of the model and the bones of the skin of each that are torso.
func _make_cull() -> void:
	_cull = []
	if skel == null:
		return
	var torso := RegEx.create_from_string(TORSO_NAME)
	var limb := RegEx.create_from_string(LIMB_NAME)
	for m in model.find_children("*", "MeshInstance3D", true, false):
		var mi := m as MeshInstance3D
		if mi.skin == null or not (mi.mesh is ArrayMesh):
			continue
		var list: Array[int] = []
		var def: Array[int] = []
		for i in mi.skin.get_bind_count():
			var b := mi.skin.get_bind_bone(i)
			if b < 0:
				b = skel.find_bone(mi.skin.get_bind_name(i))
			var n := skel.get_bone_name(b) if b >= 0 else ""
			if torso.search(n) != null and limb.search(n) == null:
				list.append(i)
				if n.begins_with("DEF-"):
					def.append(i)
		if not def.is_empty():
			list = def
		if not list.is_empty():
			_cull.append({"mesh": mi, "own": mi.mesh, "hide": list.slice(0, CULL_MAX), "cut": null})


## The copy of a mesh with the weight of the torso of every vertex in CUSTOM0, and the material that drops them.
func _cut_mesh(c: Dictionary) -> ArrayMesh:
	var mi: MeshInstance3D = c["mesh"]
	var own: ArrayMesh = c["own"]
	var hide := {}
	for i in c["hide"]:
		hide[i] = true
	var shader := Shader.new()
	shader.code = CULL_SHADER
	var out := ArrayMesh.new()
	for s in own.get_surface_count():
		var arrays := own.surface_get_arrays(s)
		var bones: PackedInt32Array = arrays[Mesh.ARRAY_BONES] if arrays[Mesh.ARRAY_BONES] != null else PackedInt32Array()
		var weights: PackedFloat32Array = arrays[Mesh.ARRAY_WEIGHTS] if arrays[Mesh.ARRAY_WEIGHTS] != null else PackedFloat32Array()
		var count := (arrays[Mesh.ARRAY_VERTEX] as PackedVector3Array).size()
		var per := bones.size() / count if count > 0 else 4
		var custom := PackedFloat32Array()
		custom.resize(count * 4)
		for v in count:
			var w := 0.0
			for k in per:
				if hide.has(bones[v * per + k]):
					w += weights[v * per + k]
			custom[v * 4] = w
		arrays[Mesh.ARRAY_CUSTOM0] = custom
		var flags := Mesh.ARRAY_CUSTOM_RGBA_FLOAT << Mesh.ARRAY_FORMAT_CUSTOM0_SHIFT
		if per == 8:
			flags |= Mesh.ARRAY_FLAG_USE_8_BONE_WEIGHTS
		out.add_surface_from_arrays(own.surface_get_primitive_type(s), arrays, [], {}, flags)
		var src := mi.get_active_material(s) as BaseMaterial3D
		var sm := ShaderMaterial.new()
		sm.shader = shader
		if src != null:
			sm.set_shader_parameter("albedo", src.albedo_color)
			sm.set_shader_parameter("has_texture", src.albedo_texture != null)
			sm.set_shader_parameter("albedo_texture", src.albedo_texture)
			sm.set_shader_parameter("has_normal", src.normal_enabled and src.normal_texture != null)
			sm.set_shader_parameter("normal_texture", src.normal_texture)
			sm.set_shader_parameter("roughness", src.roughness)
			sm.set_shader_parameter("metallic", src.metallic)
		out.surface_set_material(s, sm)
	return out


func _set_cull(on: bool) -> void:
	if on == _cull_on:
		return
	_cull_on = on
	for c in _cull:
		var mi: MeshInstance3D = c["mesh"]
		if not is_instance_valid(mi):
			continue
		if on and c["cut"] == null:
			c["cut"] = _cut_mesh(c)
		mi.mesh = c["cut"] if on else c["own"]


func dispose() -> void:
	if is_instance_valid(root):
		if root.get_parent() != null:
			root.get_parent().remove_child(root)
		root.queue_free()


# ---- in the game

## The driver and the steering wheel of a car (Car.gd, when its model is built): the steering wheel of the model turns
## with the steering, and the driver of car.json "driver" (enabled, with a file) sits in the car and moves.
static func attach(car: Car, body: Node3D) -> void:
	var sw := SteeringWheel.find(body, car, car.config.get("steering_wheel", {}) if car.config.get("steering_wheel") is Dictionary else {})
	var dcfg: Variant = car.config.get("driver")
	var wanted: bool = dcfg is Dictionary and bool(dcfg.get("enabled", false)) and str(dcfg.get("file", "")) != ""
	if sw == null and not wanted:
		return
	var frame := Frame.new()
	frame.name = "Driver"
	frame.car = car
	frame.wheel = sw
	car.add_child(frame)
	if not wanted:
		return
	var scene := Content.load_model(str(dcfg["file"]))
	if scene == null:
		push_warning("The driver model could not be loaded: " + str(dcfg["file"]))
		return
	var steer := {"axis": sw.axis, "centre": sw.centre, "degrees": sw.degrees, "angle": 0.0} if sw != null else {}
	var d := CarDriver.new(frame, dcfg, steer)
	if d.set_model(scene):
		frame.driver = d
	else:
		d.dispose()


## The camera of the player's car is in the cockpit or not (ChaseCamera): the head and the torso of its driver are not
## drawn there, or the whole driver (cameras.cockpit.hide_driver).
static func camera_inside(car: Car, inside: bool) -> void:
	var frame := car.get_node_or_null("Driver") as Frame
	if frame == null or frame.driver == null or frame.inside == inside:
		return
	frame.inside = inside
	var cams: Dictionary = car.config.get("cameras", {}) if car.config.get("cameras") is Dictionary else {}
	var cp: Dictionary = cams.get("cockpit", {}) if cams.get("cockpit") is Dictionary else {}
	frame.driver.set_cockpit(inside, bool(cp.get("hide_driver", false)))


## The frame of the body of a car (the space of car.json "driver"): it turns the steering wheel and moves the driver.
class Frame:
	extends Node3D

	const FAR := 80.0

	var car: Car
	var wheel: SteeringWheel = null
	var driver: CarDriver = null
	var inside := false

	func _process(dt: float) -> void:
		var angle := 0.0
		if wheel != null:
			# the wheel turns as far as car.json steering_wheel.degrees at the full lock of the front wheels (Car.js)
			angle = car.steer_angle * deg_to_rad(wheel.degrees) / maxf(0.01, car.max_steer)
			var column: Variant = car.get("column_angle")
			if column is float and wheel.stop != "degrees":
				angle = column
			wheel.turn(angle)
		if driver != null:
			# (a driver far from the camera is not moved: he is a few pixels)
			var cam := get_viewport().get_camera_3d()
			if cam != null and cam.global_position.distance_squared_to(global_position) > FAR * FAR:
				return
			if not driver.steering.is_empty():
				driver.steering["angle"] = angle
			driver.update(dt, car.throttle, car.brake)
