class_name Tuning
extends RefCounted
## What can be set on a car in the tuning menu, after web/js/CarTuning.js: the groups (GROUPS, every item as the
## browser has it: [key, label, unit, min, max, step], in the units of the menu), the cards they are shown in (CARDS),
## the systems and the extras (FEATURES), and the way between car.json and the values of the menu (values_of,
## set_value; fromConfig and toConfig of the browser, written for the paths that the Godot physics read).
## A tune is a whole car.json, kept as the browser game keeps it: { "openracer-tune": 1, "car", "name", "saved",
## "config" } (.openracer-tune.json), in user://tunes/<car>/, or one that comes with the car (web/cars/<car>/,
## car.json "tunes").

const V100 := (100.0 / 3.6) * (100.0 / 3.6)       # (m/s)^2 at 100 km/h: the downforce of the menu is at that speed
const NOT_YET := "Not in the Godot version yet: the value is kept in the tune (the browser game uses it), the Godot physics do not use it."

const GROUPS := [
	["Tyres", [
		["compound", "Tyre compound", "", 0, 0, 0],
		["tyre_damage", "Tyre damage", "", 0, 0, 0],
		["rim_front", "Rim at the front (the wheel library)", "", 0, 0, 0],
		["tyre_front", "Tyre at the front (a tyre of the wheel library: only for the cars that have one)", "", 0, 0, 0],
		["rim_rear", "Rim at the rear", "", 0, 0, 0],
		["tyre_rear", "Tyre at the rear", "", 0, 0, 0],
		["tyre_section_front", "Tyre at the front: width", "mm", 95, 500, 5],
		["tyre_aspect_front", "Tyre at the front: sidewall, as a share of the width", "%", 15, 100, 5],
		["tyre_rim_front", "Tyre at the front: rim", "inch", 10, 27, 1],
		["tyre_rim_offset_front", "Tyre at the front: width of the rim (added on each side)", "mm", -60, 30, 1],
		["rubber_front", "Tyre at the front: rubber", "", 0, 100, 1],
		["tread_front", "Tyre at the front: tread (grip on grass, sand and mud)", "", 0, 100, 1],
		["tyre_section_rear", "Tyre at the rear: width", "mm", 95, 500, 5],
		["tyre_aspect_rear", "Tyre at the rear: sidewall, as a share of the width", "%", 15, 100, 5],
		["tyre_rim_rear", "Tyre at the rear: rim", "inch", 10, 27, 1],
		["tyre_rim_offset_rear", "Tyre at the rear: width of the rim (added on each side)", "mm", -60, 30, 1],
		["rubber_rear", "Tyre at the rear: rubber", "", 0, 100, 1],
		["tread_rear", "Tyre at the rear: tread", "", 0, 100, 1],
		["tyre_width", "Tyre: width of the tread, front (0: from the wheel)", "cm", 0, 60, 1],
		["tyre_width_rear", "Tyre: width of the rear tread (0: as the front)", "cm", 0, 60, 1],
		["tyre_rings", "Tyre: rings of nodes across the tread", "", 1, 5, 1],
		["tyre_segments", "Tyre: nodes round the wheel (4 is a square, 6 a hexagon; fewer is cheaper)", "", 4, 72, 1],
		["tyre_inner_ratio", "Tyre: radius of the inner shell (the rim), as a share of the tyre", "%", 30, 90, 1],
		["tyre_carcass", "Tyre: softness of the carcass (0: from the tyre rate of the car; a few mm is a very stiff tyre)", "mm", 0, 80, 0.5],
		["tyre_stiff_x", "Tyre: stiffness of the tread along the tyre (x load)", "", 4, 60, 0.5],
		["tyre_stiff_y", "Tyre: stiffness of the tread across the tyre (x load)", "", 4, 60, 0.5],
		["grip", "Grip", "%", 20, 300, 1],
		["grip_balance", "Grip of the rear tyres (as a share of the front)", "%", 40, 200, 1],
		["cornering", "Stiffness against the slip angle", "%", 20, 300, 1],
		["pressure_front", "Tyre pressure at the front", "bar", 0, 6, 0.1],
		["pressure_rear", "Tyre pressure at the rear", "bar", 0, 6, 0.1],
		["rolling_resistance", "Rolling resistance", "", 0.002, 0.1, 0.001],
		["tyre_heating", "Heating up (wear and fuel on)", "%", 5, 800, 5],
		["tyre_life", "Life of the tyres", "%", 5, 1000, 5],
	]],
	["Springs and dampers", [
		["spring_front", "Front springs (wheel rate)", "N/mm", 3, 200, 1],
		["spring_rear", "Rear springs (wheel rate)", "N/mm", 3, 200, 1],
		["spring_progression", "Progressive springs (extra stiffness at the end of the travel)", "%", 0, 800, 10],
		["damping_front", "Front dampers", "%", 5, 200, 1],
		["damping_rear", "Rear dampers", "%", 5, 200, 1],
		["damping_rebound", "Rebound damping (against compression damping)", "×", 0.5, 6, 0.1],
		["roll_front", "Roll stiffness at the front", "%", 10, 90, 1],
	]],
	["Ride height and travel", [
		["unsprung", "Suspension (none: a kart, the frame stands on its tyres)", "", 0, 0, 0],
		["ride_front", "Ride height at the front (from the car as made)", "mm", -150, 150, 5],
		["ride_rear", "Ride height at the rear", "mm", -150, 150, 5],
		["suspension_travel", "Suspension travel before the bump stop", "cm", 1, 120, 1],
		["suspension_droop", "Droop: how far a wheel hangs below the ride height (0: as far as its spring lets it)", "cm", 0, 120, 1],
		["suspension_length", "Room for the travel (the spring from the mount to the middle of the wheel)", "cm", 10, 150, 1],
	]],
	["Wheel alignment", [
		["camber_front", "Camber at the front (negative: top in)", "°", -12, 6, 0.1],
		["camber_rear", "Camber at the rear", "°", -12, 6, 0.1],
		["roll_camber", "Camber lost in roll", "%", 0, 150, 5],
		["toe_front", "Toe at the front (positive: toe-in)", "°", -4, 4, 0.05],
		["toe_rear", "Toe at the rear", "°", -4, 4, 0.05],
	]],
	["Suspension geometry", [
		["roll_center_front", "Roll centre at the front", "cm", -20, 60, 1],
		["roll_center_rear", "Roll centre at the rear", "cm", -20, 60, 1],
		["anti_dive", "Anti-dive (the front under the brakes)", "%", 0, 100, 1],
		["anti_lift_rear", "Anti-lift at the rear (under the brakes)", "%", 0, 100, 1],
		["anti_squat", "Anti-squat (the rear under power)", "%", 0, 150, 1],
		["anti_lift_front", "Anti-lift at the front (under power)", "%", 0, 100, 1],
	]],
	["Suspension parts", [
		["susp_front", "Suspension at the front (the parts library; the car is built again)", "", 0, 0, 0],
		["susp_rear", "Suspension at the rear", "", 0, 0, 0],
	]],
	["Steering", [
		["max_steer_deg", "Steering lock", "°", 5, 80, 1],
		["ackermann", "Ackermann (the inner wheel steers more)", "%", -50, 150, 5],
		["steering_degrees", "Steering wheel: turn at full lock (each way; 450 is 900° lock to lock)", "°", 30, 1000, 10],
		["steering_stop", "Steering wheel stops: where the tie rods stop it, or at its degrees", "", 0, 0, 0],
	]],
	["Brakes", [
		["brake_total", "Brakes: front and rear together (per side)", "Nm", 100, 15000, 50],
		["brake_bias", "Brake bias: the share of the front", "%", 20, 95, 1],
	]],
	["Chassis", [
		["mass", "Mass", "kg", 50, 6000, 10],
		["front_weight", "Weight on the front axle", "%", 25, 75, 0.5],
		["cg_height", "Height of the centre of gravity", "m", 0.15, 1.5, 0.01],
		["length", "Length", "m", 1, 8, 0.01],
		["width", "Width", "m", 0.5, 3.5, 0.01],
		["height", "Height", "m", 0.4, 3.5, 0.01],
		["frame_torsion", "Frame stiffness against twisting (a kart: 0 is a rigid frame)", "N·m/°", 0, 2000, 10],
		["inner_lift", "Inner rear wheel lift in a fast bend (a kart)", "mm", 0, 60, 1],
	]],
	["Aerodynamics", [
		["drag_coefficient", "Drag coefficient", "", 0.05, 2, 0.01],
		["downforce_front", "Downforce at the front axle at 100 km/h, 62 mph (negative: lift)", "N", -10000, 20000, 50],
		["downforce_rear", "Downforce at the rear axle at 100 km/h, 62 mph", "N", -10000, 20000, 50],
	]],
	["Paint", [
		["body_color", "Colour of the body (the material carpaint)", "", 0, 0, 0],
		["body_finish", "Finish of the body", "", 0, 0, 0],
		["body_pattern", "Flake pattern of the body", "", 0, 0, 0],
		["body_flake", "Flake size of the body (metal flake)", "%", 2, 400, 1],
		["body_uv", "Flake map of the body (the UV map)", "", 0, 0, 0],
		["rim_color", "Colour of the rims (the material rimpaint)", "", 0, 0, 0],
		["rim_finish", "Finish of the rims", "", 0, 0, 0],
		["rim_pattern", "Flake pattern of the rims", "", 0, 0, 0],
		["rim_flake", "Flake size of the rims (metal flake)", "%", 2, 400, 1],
		["rim_uv", "Flake map of the rims (the UV map)", "", 0, 0, 0],
	]],
	["Fuel", [
		["tank", "Tank", "L", 2, 400, 1],
		["fuel_use", "Fuel use", "%", 5, 1000, 5],
	]],
	["Engine", [
		["idle_rpm", "Idle speed", "rpm", 300, 4000, 50],
		["limiter_rpm", "Rev limit", "rpm", 2000, 20000, 100],
		["limiter_hz", "Rev limiter: cuts per second", "Hz", 1, 60, 1],
		["engine_inertia", "Inertia of the engine", "kg m²", 0.01, 3, 0.01],
		["engine_braking", "Engine braking", "%", 0, 500, 5],
		["turbo_share", "Turbo: share of the torque that is boost (0: no turbo)", "%", 0, 95, 5],
		["turbo_spool", "Turbo: spool time (the lag)", "s", 0.02, 5, 0.05],
		["turbo_threshold", "Turbo: from", "rpm", 500, 10000, 100],
		["turbo_boost", "Turbo: boost pressure at full boost (0: the share of the torque above is used)", "bar", 0, 10, 0.05],
		["turbo_intercooler", "Turbo: intercooler efficiency", "%", 0, 99, 1],
		["turbo_efficiency", "Turbo: compressor efficiency", "%", 40, 90, 1],
	]],
	["Transmission", [
		["drive", "Drive", "", 0, 0, 0],
		["final_drive", "Final drive", "", 1, 10, 0.05],
		["shift_time", "Shift time (without a clutch pedal)", "s", 0.02, 3, 0.01],
		["clutch_start_rpm", "Automatic clutch: starts to grip at", "rpm", 300, 10000, 50],
		["clutch_full_rpm", "Automatic clutch: grips fully at", "rpm", 400, 12000, 50],
		["gearbox", "Gearbox", "", 0, 0, 0],
		["shift_style", "Shift pattern (automatic gearboxes)", "", 0, 0, 0],
		["cvt_rpm", "CVT: engine speed at full throttle", "rpm", 1000, 20000, 100],
		["tc_stall_rpm", "Torque converter: stall speed", "rpm", 500, 8000, 50],
		["tc_ratio", "Torque converter: torque ratio at stall", "", 1, 4, 0.05],
		["gears", "Gears (a CVT runs between the first and the last)", "", 0, 0, 0],
		["reverse_ratio", "Reverse", "", 0.5, 10, 0.05],
		["clutch", "Clutch capacity (x peak torque)", "", 0.5, 6, 0.05],
		["diff", "Differential", "", 0, 0, 0],
		["diff_preload", "Limited slip: preload", "Nm", 0, 2000, 10],
		["diff_power", "Limited slip: lock under power", "%", 0, 100, 1],
		["diff_coast", "Limited slip: lock off the throttle", "%", 0, 100, 1],
		["diff_lock", "Limited slip: build-up", "Nm/(rad/s)", 0, 1000, 5],
		["center_diff", "Centre differential (all wheel drive)", "", 0, 0, 0],
		["center_split", "Torque to the front (all wheel drive)", "%", 0, 100, 1],
		["efficiency", "Efficiency of the driveline", "", 0.5, 1, 0.01],
		["tc_lockup", "Torque converter: lock-up clutch", "", 0, 0, 0],
		["engine_place", "Engine placement (the driveline)", "", 0, 0, 0],
	]],
	["Cameras", [
		["cam_follow_distance", "Follow camera: distance", "m", 1, 20, 0.1],
		["cam_follow_height", "Follow camera: height", "m", 0, 10, 0.05],
		["cam_follow_look_height", "Follow camera: looks at a height of", "m", -1, 5, 0.05],
		["cam_follow_look_z", "Follow camera: looks ahead of the car by", "m", -5, 5, 0.1],
		["cam_follow_smoothing", "Follow camera: smoothing", "", 0.2, 20, 0.1],
		["cam_follow_fov_standing", "Follow camera: field of view standing", "°", 20, 120, 1],
		["cam_follow_fov_fast", "Follow camera: field of view at speed", "°", 20, 140, 1],
		["cam_follow_fov_full_speed", "Follow camera: that field of view from", "km/h", 10, 400, 5],
		["cam_follow_dolly", "Follow camera: dolly with the speed", "", 0, 3, 0.05],
		["cam_follow_distance_fast", "Follow camera: distance at full speed (0: comes closer with the view)", "m", 0, 20, 0.1],
		["cam_follow_height_fast", "Follow camera: height at full speed", "m", 0, 10, 0.05],
		["cam_bonnet_x", "Hood camera: to the left", "m", -1.5, 1.5, 0.01],
		["cam_bonnet_y", "Hood camera: height", "m", -1, 3, 0.01],
		["cam_bonnet_z", "Hood camera: forward", "m", -4, 4, 0.01],
		["cam_bonnet_fov", "Hood camera: field of view", "°", 20, 130, 1],
		["cam_cockpit_x", "Cockpit camera: to the left", "m", -1.5, 1.5, 0.01],
		["cam_cockpit_y", "Cockpit camera: height", "m", -1, 3, 0.01],
		["cam_cockpit_z", "Cockpit camera: forward", "m", -3, 3, 0.01],
		["cam_cockpit_fov", "Cockpit camera: field of view", "°", 30, 130, 1],
		["cam_cockpit_hide_driver", "Cockpit camera: hide the driver", "", 0, 1, 1],
	]],
	["Engine sound", [
		["es_volume", "Volume", "", 0, 5, 0.05],
		["es_convolution", "Through the exhaust (impulse response)", "", 0, 1, 0.05],
		["es_audio_volume", "Exhaust volume", "", 0, 10, 0.1],
		["es_hf_gain", "High frequency gain", "", 0, 0.2, 0.005],
		["es_noise", "Low frequency noise", "", 0, 1, 0.05],
		["es_jitter", "High frequency noise", "", 0, 2, 0.05],
		["es_exhaust_length", "Exhaust length", "m", 0.3, 6, 0.1],
		["es_primary_length", "Primary tube length", "m", 0.1, 2, 0.05],
		["es_idle_pressure", "Manifold pressure at idle", "atm", 0.1, 0.9, 0.05],
	]],
	["Motorcycle", [
		["bike_max_lean", "Lean at most", "°", 20, 75, 1],
		["bike_fast_lean", "Lean the keys can ask for at speed", "°", 5, 60, 1],
		["bike_rake", "Rake of the fork", "°", 15, 40, 0.5],
		["bike_rider_mass", "Rider", "kg", 30, 200, 1],
		["bike_hang_off", "The rider hangs off the seat by", "m", 0, 1, 0.02],
		["bike_max_lateral_g", "Lateral grip of the tyres", "g", 0.3, 2.5, 0.05],
		["bike_balance", "Balance of the rider", "", 0.1, 4, 0.05],
		["bike_fork_dive", "Dive of the fork on the brakes", "", 0, 3, 0.05],
		["bike_lean_speed", "Lean speed: how quick the bike goes from the one side to the other (a factor on the roll rate and the keys)", "", 0.5, 3, 0.05],
		["bike_air_pitch_rate", "In the air: how fast the gas turns the nose up and the brake turns it down (held: it keeps turning, a flip)", "°/s", 0, 400, 5],
		["bike_air_roll_rate", "In the air: how fast the lean keys roll the bike (the weight of the rider to the side)", "°/s", 0, 360, 5],
		["bike_push", "Flat-track style: upright, push the bike under you (deep lean, the inside foot out, countersteers a slide by itself); "
			+ "off: hang off to the inside", "", 0, 1, 1],
		["bike_push_foot_kmh", "Flat-track style: the inside foot comes out in a bend up to this speed", "km/h", 20, 250, 5],
		["bike_push_upright", "Flat-track: how far the back leans out of the bike (a share of the lean of the bike)", "", 0, 1.2, 0.05],
		["bike_push_forward", "Flat-track: how far forward the rider sits in a bend", "m", -0.1, 0.4, 0.01],
		["bike_push_chest_pitch", "Flat-track: how far the chest leans forward in a bend", "°", -10, 45, 1],
		["bike_push_pelvis_tilt", "Flat-track: the most that the pelvis tilts against the bike", "°", 0, 45, 1],
		["bike_push_pelvis_slide", "Flat-track: how far the pelvis slides to the outside", "m", -0.15, 0.25, 0.01],
		["bike_push_foot_out", "Flat-track: how far the inside foot goes out at the most lean", "m", 0, 0.6, 0.01],
		["bike_push_foot_forward", "Flat-track: how far the inside foot goes forward at the most lean", "m", 0, 0.9, 0.02],
		["bike_hang_chest_roll", "Road race: how far the trunk rolls into the bend at the most hang off", "°", 0, 40, 1],
		["bike_hang_knee_out", "Road race: how far the inside knee goes out in a bend", "m", 0, 1.2, 0.02],
		["bike_hang_knee_down", "Road race: how far the inside knee goes down in a bend", "m", 0, 1, 0.02],
		["bike_hang_tuck_pitch", "Road race: how far the trunk goes forward on the gas", "°", 0, 50, 1],
		["bike_hang_sit_pitch", "Road race: how far the trunk goes back on the brake", "°", 0, 30, 1],
		["bike_hang_shift", "Road race: the share of the hang off that the whole body moves", "", 0, 1.5, 0.05],
	]],
	# (the browser shows the soft body read-only, as the car has it; the Godot version sets it here, see README)
	["Soft body", [
		["sb_enabled", "The car dents (the soft body, with Damage on in Settings)", "", 0, 0, 0],
		["sb_max_nodes", "Most nodes made from the model (a car without a list of nodes)", "", 10, 120, 1],
		["sb_anchor_yield", "Anchors: bend for good from (the nodes without a strength of their own)", "kN", 1, 400, 1],
		["sb_anchor_break", "Anchors: tear off at", "kN", 5, 1000, 5],
		["sb_beam_yield", "Beams: bend for good from", "kN", 1, 200, 1],
		["sb_beam_break", "Beams: snap at", "kN", 5, 600, 5],
		["sb_hardening", "Hardening: how much the force goes on rising after the yield", "%", 0, 100, 1],
		["sb_shell_mass", "Mass of the shell", "kg", 20, 400, 5],
	]],
]

## The cards of the menu, in the order of the browser (CarTuning.CARDS); a group with the name of its card is
## "<name> settings". (Motorcycle: only for a motorcycle.)
## How the rows of a group are bundled in the menus: [title, keys]; the rows of a group that are not named come first, without a title.
const LAYOUT := {
	"Tyres": [["Front", ["rim_front", "tyre_front", "tyre_section_front", "tyre_aspect_front", "tyre_rim_front", "tyre_rim_offset_front", "tyre_width", "rubber_front", "tread_front", "pressure_front"]],
		["Rear", ["rim_rear", "tyre_rear", "tyre_section_rear", "tyre_aspect_rear", "tyre_rim_rear", "tyre_rim_offset_rear", "tyre_width_rear", "rubber_rear", "tread_rear", "pressure_rear"]],
		["Tyre model", ["tyre_rings", "tyre_segments", "tyre_inner_ratio", "tyre_carcass"]]],
	"Springs and dampers": [["Front", ["spring_front", "damping_front", "roll_front"]], ["Rear", ["spring_rear", "damping_rear"]], ["Both axles", ["spring_progression", "damping_rebound"]]],
	"Ride height and travel": [["Ride height", ["ride_front", "ride_rear"]], ["Travel", ["suspension_travel", "suspension_droop", "suspension_length"]]],
	"Wheel alignment": [["Front", ["camber_front", "toe_front"]], ["Rear", ["camber_rear", "toe_rear"]], ["Both axles", ["roll_camber"]]],
	"Suspension geometry": [["Front", ["roll_center_front", "anti_dive", "anti_lift_front"]], ["Rear", ["roll_center_rear", "anti_squat", "anti_lift_rear"]]],
	"Chassis": [["Weight", ["mass", "front_weight", "cg_height"]], ["Size", ["length", "width", "height"]], ["Frame", ["frame_torsion", "inner_lift"]]],
	"Paint": [["Body", ["body_color", "body_finish", "body_pattern", "body_flake", "body_uv"]], ["Rims", ["rim_color", "rim_finish", "rim_pattern", "rim_flake", "rim_uv"]]],
	"Engine": [["Engine speeds", ["idle_rpm", "limiter_rpm", "limiter_hz", "engine_inertia", "engine_braking"]],
		["Turbo", ["turbo_share", "turbo_spool", "turbo_threshold", "turbo_boost", "turbo_intercooler", "turbo_efficiency"]]],
	"Transmission": [["Gearbox", ["gearbox", "shift_style", "shift_time", "cvt_rpm", "gears", "final_drive", "reverse_ratio"]],
		["Clutch and converter", ["clutch", "clutch_start_rpm", "clutch_full_rpm", "tc_stall_rpm", "tc_ratio", "tc_lockup"]],
		["Differentials", ["drive", "diff", "diff_preload", "diff_power", "diff_coast", "diff_lock", "center_diff", "center_split"]],
		["Driveline", ["efficiency", "engine_place"]]],
	"Cameras": [["Follow camera", ["cam_follow_distance", "cam_follow_height", "cam_follow_look_height", "cam_follow_look_z", "cam_follow_smoothing", "cam_follow_dolly"]],
		["Follow camera: speed", ["cam_follow_fov_standing", "cam_follow_fov_fast", "cam_follow_fov_full_speed", "cam_follow_distance_fast", "cam_follow_height_fast"]],
		["Cockpit camera", ["cam_cockpit_x", "cam_cockpit_y", "cam_cockpit_z", "cam_cockpit_fov", "cam_cockpit_hide_driver"]],
		["Hood camera", ["cam_bonnet_x", "cam_bonnet_y", "cam_bonnet_z", "cam_bonnet_fov"]]],
	"Engine sound": [["Levels", ["es_volume", "es_convolution", "es_audio_volume", "es_hf_gain", "es_noise", "es_jitter"]], ["The engine", ["es_exhaust_length", "es_primary_length", "es_idle_pressure"]]],
	"Motorcycle": [["Riding", ["bike_max_lean", "bike_fast_lean", "bike_rake", "bike_rider_mass", "bike_hang_off", "bike_max_lateral_g", "bike_balance", "bike_fork_dive", "bike_lean_speed"]],
		["In the air", ["bike_air_pitch_rate", "bike_air_roll_rate"]],
		["Flat-track style", ["bike_push", "bike_push_foot_kmh", "bike_push_upright", "bike_push_forward", "bike_push_chest_pitch", "bike_push_pelvis_tilt", "bike_push_pelvis_slide", "bike_push_foot_out", "bike_push_foot_forward"]],
		["Road race style", ["bike_hang_chest_roll", "bike_hang_knee_out", "bike_hang_knee_down", "bike_hang_tuck_pitch", "bike_hang_sit_pitch", "bike_hang_shift"]]],
	"Soft body": [["Anchors", ["sb_anchor_yield", "sb_anchor_break"]], ["Beams", ["sb_beam_yield", "sb_beam_break"]]],
}

## What a row is called under its bundle: what the bundle says already is not said again.
const SHORT := {
	"tyre_section_front": "Width", "tyre_section_rear": "Width", "tyre_aspect_front": "Sidewall, as a share of the width", "tyre_aspect_rear": "Sidewall, as a share of the width",
	"tyre_rim_front": "Rim", "tyre_rim_rear": "Rim", "tyre_rim_offset_front": "Width of the rim (added on each side)", "tyre_rim_offset_rear": "Width of the rim (added on each side)",
	"tyre_width": "Width of the shell (0: from the wheel)", "tyre_width_rear": "Width of the shell (0: as the front)",
	"rim_front": "Rim (the wheel library)", "rim_rear": "Rim (the wheel library)", "tyre_front": "Tyre (of the wheel library)", "tyre_rear": "Tyre (of the wheel library)",
	"rubber_front": "Rubber", "rubber_rear": "Rubber", "tread_front": "Tread (grip on grass, sand and mud)", "tread_rear": "Tread (grip on grass, sand and mud)",
	"pressure_front": "Pressure", "pressure_rear": "Pressure",
	"spring_front": "Springs (wheel rate)", "spring_rear": "Springs (wheel rate)", "damping_front": "Dampers", "damping_rear": "Dampers", "roll_front": "Roll stiffness",
	"ride_front": "Front (from the car as made)", "ride_rear": "Rear", "camber_front": "Camber (negative: top in)", "camber_rear": "Camber (negative: top in)",
	"toe_front": "Toe (positive: toe-in)", "toe_rear": "Toe (positive: toe-in)", "roll_center_front": "Roll centre", "roll_center_rear": "Roll centre",
	"anti_dive": "Anti-dive (under the brakes)", "anti_lift_rear": "Anti-lift (under the brakes)", "anti_squat": "Anti-squat (under power)", "anti_lift_front": "Anti-lift (under power)",
	"body_color": "Colour (the material carpaint)", "rim_color": "Colour (the material rimpaint)", "body_finish": "Finish", "rim_finish": "Finish", "body_pattern": "Flake pattern", "rim_pattern": "Flake pattern",
	"body_flake": "Flake size (metal flake)", "rim_flake": "Flake size (metal flake)", "body_uv": "Flake map (the UV map)", "rim_uv": "Flake map (the UV map)",
	"cam_follow_fov_standing": "Field of view standing", "cam_follow_fov_fast": "Field of view at full speed", "cam_follow_fov_full_speed": "Full speed from",
	"cam_follow_distance_fast": "Distance at full speed (0: comes closer with the view)", "cam_follow_height_fast": "Height at full speed",
}
const PREFIXES := ["Tyre: ", "Follow camera: ", "Cockpit camera: ", "Hood camera: ", "Turbo: ", "Limited slip: ", "Torque converter: ", "Automatic clutch: ", "Flat-track style: ", "Flat-track: ", "Road race: ", "Anchors: ", "Beams: ", "In the air: "]


## The rows of a group, bundled: [[title or "", rows]]; the rows that are in no bundle first. rows: the rows of the group that the menu shows.
static func bundles(group: String, rows: Array) -> Array:
	var by_key := {}
	for r in rows:
		by_key[r[0]] = r
	var out := []
	var named := {}
	var parts: Array = LAYOUT.get(group, [])
	for p in parts:
		for k: String in p[1]:
			named[k] = true
	var loose := rows.filter(func(r: Array) -> bool: return not named.has(r[0]))
	if not loose.is_empty():
		out.append(["", loose])
	for p in parts:
		var these := []
		for k: String in p[1]:
			if by_key.has(k):
				var r: Array = (by_key[k] as Array).duplicate()
				r[1] = short_label(k, str(r[1]))
				these.append(r)
		if not these.is_empty():
			out.append([p[0], these])
	return out


static func short_label(key: String, text: String) -> String:
	if SHORT.has(key):
		return SHORT[key]
	for p: String in PREFIXES:
		if text.begins_with(p):
			var rest := text.substr(p.length())
			return rest[0].to_upper() + rest.substr(1)
	return text


const CARDS := [
	["Wheels", ["Tyres"]],
	["Suspension", ["Springs and dampers", "Ride height and travel", "Wheel alignment", "Suspension geometry", "Suspension parts"]],
	["Steering", ["Steering"]],
	["Brakes", ["Brakes"]],
	["Chassis", ["Chassis"]],
	["Aerodynamics", ["Aerodynamics"]],
	["Paint", ["Paint"]],
	["Drivetrain", ["Transmission"]],
	["Engine", ["Fuel", "Engine"]],
	["Engine sound", ["Engine sound"]],
	["Assists and extras", []],
	["Cameras", ["Cameras"]],
	["Soft body", ["Soft body"]],
	["Motorcycle", ["Motorcycle"]],
]

## The settings of the tyre on top of its kind: folded away in a part of their own.
const TYRE_FINE := ["tyre_stiff_x", "tyre_stiff_y", "grip", "grip_balance", "cornering", "rolling_resistance", "tyre_heating", "tyre_life"]

## The systems and the extras: a tick (key + "_on") and the settings that open under it.
const FEATURES := [
	["tc", "Traction control", [["tc_allowance", "Wheel spin allowed", "%", 5, 800, 5]]],
	["abs", "ABS", []],
	["esc", "Stability control (ESC)", [["esc_gain", "How hard it steps in", "%", 10, 400, 5]]],
	["launch_control", "Launch control", [["launch_rpm", "Engine speed", "rpm", 1000, 20000, 100]]],
	["two_step", "Two-step (the key, or the clutch pedal at a standstill)", [["two_step_rpm", "Engine speed", "rpm", 1000, 20000, 100]]],
	["governor", "Governor (a soft rev limit: the throttle closes gently, the engine holds the speed)", [
		["governor_rpm", "Engine speed", "rpm", 1000, 20000, 100]]],
	["pops", "Pops and bangs (unburnt fuel burns in the exhaust)", [
		["pops_amount", "How often (on the rev limiter and the two-step)", "%", 0, 100, 5],
		["pops_overrun", "After lifting off the throttle: for", "s", 0, 4, 0.1],
		["pops_rpm", "From an engine speed of", "rpm", 1000, 8000, 100],
		["pops_loud", "How loud", "%", 0, 500, 10],
		["pops_flames", "Flames from the exhaust", "%", 0, 400, 10]]],
	["antilag", "Anti-lag (keeps the turbo spinning off the throttle)", [
		["antilag_mode", "When", "", 0, 0, 0],
		["antilag_boost", "Boost that is held", "%", 5, 100, 5],
		["antilag_rpm", "Works from an engine speed of", "rpm", 1000, 8000, 100],
		["antilag_time", "Longest time that it works", "s", 0.5, 60, 0.5],
		["antilag_bangs", "Bangs and flames", "%", 0, 500, 10],
		["antilag_fuel", "Extra fuel use while it works", "%", 0, 500, 10]]],
	["boost_gauge", "Boost gauge (the pressure of the turbo)", [
		["boost_full", "Boost pressure at full boost (when the turbo has no pressure of its own)", "bar", 0.1, 10, 0.05],
		["boost_scale", "The gauge goes up to", "bar", 0.5, 10, 0.5]]],
]
const FEATURE_DEFAULTS := {
	"tc_on": true, "abs_on": true, "esc_on": true, "launch_control_on": true, "two_step_on": true, "governor_on": false, "governor_rpm": 0,
	"pops_on": false, "pops_amount": 60, "pops_overrun": 2, "pops_rpm": 3000, "pops_loud": 100, "pops_flames": 100,
	"antilag_on": false, "antilag_mode": "lift", "antilag_boost": 60, "antilag_rpm": 3000, "antilag_time": 5, "antilag_bangs": 100, "antilag_fuel": 60,
	"boost_gauge_on": false, "boost_full": 1, "boost_scale": 2,
}

## The lists (Tuning.js SELECTS): [label, [[value, text], ...]]. The wheel library and the parts library are filled
## by the menu (selects).
const SELECTS := {
	"drive": [["rwd", "Rear wheels"], ["fwd", "Front wheels"], ["awd", "All wheels"]],
	"shift_style": [["normal", "Normal"], ["sport", "Sport (holds the gears)"], ["drag", "Drag (up at the rev limiter, no kick down)"],
		["manual", "Manual (you shift, it does not)"]],
	"gearbox": [["gears", "Manual (a clutch pedal)"], ["imt", "Manual with an automatic clutch (IMT)"], ["amt", "Automated manual (AMT)"],
		["dct", "Dual clutch (DCT)"], ["torque-converter", "Automatic with a torque converter"], ["cvt", "CVT (continuously variable)"]],
	"diff": [["open", "Open"], ["lsd", "Limited slip"], ["welded", "Welded (locked)"]],
	"compound": [["eco", "Eco (hard, lasts)"], ["road", "Road"], ["sport", "Sport"], ["semislick", "Semi-slick"], ["slick", "Slick (race)"],
		["winter", "Winter (soft, cold)"], ["offroad", "Off-road (knobbly)"], ["drag", "Drag slick (straight line)"]],
	"center_diff": [["open", "Open"], ["lsd", "Limited slip"], ["locked", "Locked"]],
	"tyre_damage": [["off", "Off"], ["on", "On (a hard hit can puncture a tyre: it loses its pressure)"]],
	"unsprung": [["sprung", "Springs and dampers"], ["none", "None (a kart: the frame stands on its tyres)"]],
	"antilag_mode": [["lift", "After lifting off the throttle"], ["launch", "Only with the two-step, the transbrake or the launch control"]],
	"susp_front": [["model", "From the model (parts named susp_…)"], ["none", "None"], ["double-wishbone", "Double wishbone"],
		["macpherson", "MacPherson strut"], ["live-trailing", "Live axle, trailing arms"], ["live-leaf", "Live axle, leaf springs"]],
	"susp_rear": [["model", "From the model (parts named susp_…)"], ["none", "None"], ["double-wishbone", "Double wishbone"],
		["macpherson", "MacPherson strut"], ["live-trailing", "Live axle, trailing arms"], ["live-leaf", "Live axle, leaf springs"]],
	"engine_place": [["front", "Front"], ["mid", "Mid"], ["rear", "Rear"]],
	"tc_lockup": [["on", "On"], ["off", "Off"]],
	"steering_stop": [["rods", "Where the tie rods stop it (a fixed tie rod)"], ["degrees", "At its degrees and the wheel angle, whatever the rods are"]],
	"sb_enabled": [["on", "On"], ["off", "Off (a rigid body)"]],
	"body_finish": [["", "As the model"], ["gloss", "Gloss"], ["satin", "Satin"], ["matte", "Matte"], ["metallic", "Metallic"],
		["pearl", "Pearl (the colour shifts)"], ["flake", "Metal flake (sparkle)"], ["candy", "Candy (deep and glassy)"], ["chrome", "Chrome"],
		["brushed", "Brushed metal"]],
	"body_pattern": [["noise", "Noise (fine sparkle)"], ["voronoi", "Voronoi (crystals)"], ["hexagons", "Hexagons (honeycomb)"], ["marble", "Marble (veins)"]],
	"body_uv": [["model", "From the model"], ["generated", "Generated (box projection)"]],
}
## The selects that have the list of another (the rims have the finishes of the body, ...).
const SAME_LIST := {"rim_finish": "body_finish", "rim_pattern": "body_pattern", "rim_uv": "body_uv"}

## The kinds of transmission (Tuning.js TRANSMISSIONS): choosing one sets the gearbox, the gears and the shifting.
const TRANSMISSIONS := [
	["5-speed manual (a clutch pedal)", {"gearbox": "gears", "gears": [3.55, 2.05, 1.38, 1.03, 0.82], "reverse": 3.4, "shift_time": 0.25}],
	["6-speed manual (a clutch pedal)", {"gearbox": "gears", "gears": [3.62, 2.19, 1.52, 1.14, 0.92, 0.76], "reverse": 3.5, "shift_time": 0.25}],
	["6-speed sequential (no clutch pedal, quick shifts)", {"gearbox": "imt", "gears": [2.9, 2.0, 1.5, 1.2, 1.0, 0.84], "reverse": 3.2, "shift_time": 0.06}],
	["7-speed dual clutch (DCT)", {"gearbox": "dct", "gears": [3.8, 2.4, 1.7, 1.3, 1.0, 0.8, 0.65], "reverse": 3.6, "shift_time": 0.12, "shift_style": "normal"}],
	["6-speed automated manual (AMT)", {"gearbox": "amt", "gears": [3.62, 2.19, 1.52, 1.14, 0.92, 0.76], "reverse": 3.5, "shift_time": 0.6,
		"shift_style": "normal"}],
	["3-speed automatic (TH400)", {"gearbox": "torque-converter", "gears": [2.48, 1.48, 1.0], "reverse": 2.08, "shift_time": 0.45, "tc_stall_rpm": 2400,
		"tc_ratio": 2.1, "tc_lockup": "on", "shift_style": "normal"}],
	["4-speed automatic", {"gearbox": "torque-converter", "gears": [2.84, 1.55, 1.0, 0.7], "reverse": 2.3, "shift_time": 0.4, "tc_stall_rpm": 2300,
		"tc_ratio": 2.0, "tc_lockup": "on", "shift_style": "normal"}],
	["6-speed automatic", {"gearbox": "torque-converter", "gears": [4.17, 2.34, 1.52, 1.14, 0.87, 0.69], "reverse": 3.4, "shift_time": 0.3,
		"tc_stall_rpm": 2200, "tc_ratio": 1.9, "tc_lockup": "on", "shift_style": "normal"}],
	["8-speed automatic (sport)", {"gearbox": "torque-converter", "gears": [4.7, 3.13, 2.1, 1.67, 1.29, 1.0, 0.84, 0.67], "reverse": 3.5,
		"shift_time": 0.2, "tc_stall_rpm": 2000, "tc_ratio": 1.7, "tc_lockup": "on", "shift_style": "sport"}],
	["Drag automatic, 2-speed (Powerglide)", {"gearbox": "torque-converter", "gears": [1.76, 1.0], "reverse": 1.8, "shift_time": 0.3,
		"tc_stall_rpm": 3800, "tc_ratio": 2.3, "tc_lockup": "off", "shift_style": "drag"}],
	["Drag automatic, 3-speed (race TH400)", {"gearbox": "torque-converter", "gears": [2.48, 1.48, 1.0], "reverse": 2.08, "shift_time": 0.3,
		"tc_stall_rpm": 4200, "tc_ratio": 2.4, "tc_lockup": "off", "shift_style": "drag"}],
	["Drag automatic, 3-speed, you shift (paddles, keys)", {"gearbox": "torque-converter", "gears": [2.48, 1.48, 1.0], "reverse": 2.08,
		"shift_time": 0.25, "tc_stall_rpm": 4200, "tc_ratio": 2.4, "tc_lockup": "off", "shift_style": "manual"}],
]

## Where a value is in car.json: [path, factor (menu value x factor = car.json value), the default in car.json units:
## what the Godot physics use when car.json has nothing]. A text has the factor 0.
const MAP := {
	"body_color": ["colors.body", 0, ""], "rim_color": ["colors.rim", 0, ""], "body_finish": ["colors.bodyFinish", 0, ""],
	"rim_finish": ["colors.rimFinish", 0, ""], "body_pattern": ["colors.bodyPattern", 0, "noise"], "rim_pattern": ["colors.rimPattern", 0, "noise"],
	"body_uv": ["colors.bodyUv", 0, "model"], "rim_uv": ["colors.rimUv", 0, "model"], "body_flake": ["colors.bodyFlake", 1.0, 100.0],
	"rim_flake": ["colors.rimFlake", 1.0, 100.0],
	"mass": ["chassis.mass", 1.0, 1200.0], "front_weight": ["chassis.weight_distribution", 0.01, 0.5], "cg_height": ["chassis.cg_height", 1.0, 0.5],
	"roll_front": ["chassis.roll_front", 0.01, 0.5], "spring_front": ["chassis.spring_front", 1000.0, 30000.0],
	"spring_rear": ["chassis.spring_rear", 1000.0, 30000.0], "damping_front": ["chassis.damping_front", 0.01, 0.35],
	"damping_rear": ["chassis.damping_rear", 0.01, 0.35], "frame_torsion": ["chassis.frame_torsion", 1.0, 0.0],
	"inner_lift": ["chassis.inner_lift", 0.001, 0.0], "suspension_travel": ["chassis.suspension_travel", 0.01, 0.1],
	"suspension_droop": ["chassis.suspension_droop", 0.01, 0.0],
	"suspension_length": ["chassis.suspension_length", 0.01, 0.28], "spring_progression": ["chassis.spring_progression", 0.01, 0.0],
	"damping_rebound": ["chassis.damping_rebound", 1.0, 1.5], "ride_front": ["chassis.ride_front", 0.001, 0.0], "ride_rear": ["chassis.ride_rear", 0.001, 0.0],
	"roll_center_front": ["chassis.roll_center_front", 0.01, 0.1], "roll_center_rear": ["chassis.roll_center_rear", 0.01, 0.1],
	"anti_dive": ["chassis.anti_dive", 0.01, 0.0], "anti_lift_rear": ["chassis.anti_lift_rear", 0.01, 0.0], "anti_squat": ["chassis.anti_squat", 0.01, 0.0],
	"anti_lift_front": ["chassis.anti_lift_front", 0.01, 0.0], "toe_front": ["chassis.toe_front", 1.0, 0.0], "toe_rear": ["chassis.toe_rear", 1.0, 0.0],
	"camber_front": ["chassis.camber_front", 1.0, 0.0], "camber_rear": ["chassis.camber_rear", 1.0, 0.0], "roll_camber": ["chassis.roll_camber", 0.01, 0.6],
	"compound": ["tyres.compound", 0, "road"],
	"rim_front": ["wheels.library.front.rim", 0, ""], "tyre_front": ["wheels.library.front.tyre", 0, ""],
	"rim_rear": ["wheels.library.rear.rim", 0, ""], "tyre_rear": ["wheels.library.rear.tyre", 0, ""],
	"tyre_diameter_front": ["wheels.library.front.custom.diameter", 0.001, null], "tyre_diameter_rear": ["wheels.library.rear.custom.diameter", 0.001, null],
	"rubber_front": ["wheels.library.front.custom.rubber", 1.0, null], "rubber_rear": ["wheels.library.rear.custom.rubber", 1.0, null],
	"tyre_rim_offset_front": ["wheels.library.front.custom.rim_offset", 1.0, 0.0], "tyre_rim_offset_rear": ["wheels.library.rear.custom.rim_offset", 1.0, 0.0],
	"tread_front": ["wheels.library.front.custom.tread", 1.0, null], "tread_rear": ["wheels.library.rear.custom.tread", 1.0, null],
	"tyre_width": ["tyres.shell.width", 0.01, 0.0], "tyre_width_rear": ["tyres.shell.width_rear", 0.01, 0.0], "tyre_rings": ["tyres.shell.rings", 1.0, 3.0],
	"tyre_segments": ["tyres.shell.segments", 1.0, 36.0], "tyre_inner_ratio": ["tyres.shell.inner_ratio", 0.01, 0.62],
	"tyre_carcass": ["tyres.shell.carcass", 1.0, 0.0], "tyre_stiff_x": ["tyres.stiff_x", 1.0, 20.0], "tyre_stiff_y": ["tyres.stiff_y", 1.0, 18.0],
	"grip": ["tyres.grip", 0.01, 1.0], "grip_balance": ["tyres.grip_balance", 0.01, 1.0], "cornering": ["tyres.cornering", 0.01, 1.0],
	"pressure_front": ["tyres.pressure_front", 1.0, 2.2], "pressure_rear": ["tyres.pressure_rear", 1.0, 2.2],
	"rolling_resistance": ["tyres.rolling_resistance", 1.0, 0.015], "tyre_heating": ["tyres.heating", 0.01, 1.0], "tyre_life": ["tyres.life", 0.01, 1.0],
	"tank": ["fuel.tank", 1.0, 60.0], "fuel_use": ["fuel.use", 0.01, 1.0],
	"idle_rpm": ["engine.idle_rpm", 1.0, 900.0], "limiter_rpm": ["engine.limiter_rpm", 1.0, 6500.0], "limiter_hz": ["engine.limiter_hz", 1.0, 12.0],
	"engine_inertia": ["engine.inertia", 1.0, 0.2], "engine_braking": ["engine.braking_scale", 0.01, 1.0],
	"turbo_share": ["engine.turbo.share", 0.01, 0.0], "turbo_spool": ["engine.turbo.spool", 1.0, 0.4],
	"turbo_threshold": ["engine.turbo.threshold_rpm", 1.0, 2500.0], "turbo_boost": ["engine.turbo.boost_bar", 1.0, 0.0],
	"turbo_intercooler": ["engine.turbo.intercooler", 0.01, 0.75], "turbo_efficiency": ["engine.turbo.efficiency", 0.01, 0.7],
	"drive": ["drivetrain.drive", 0, "rwd"], "final_drive": ["drivetrain.final_drive", 1.0, 3.7], "shift_time": ["drivetrain.shift_time", 1.0, 0.3],
	"clutch_start_rpm": ["drivetrain.clutch_start_rpm", 1.0, null], "clutch_full_rpm": ["drivetrain.clutch_full_rpm", 1.0, 2000.0],
	"gearbox": ["drivetrain.gearbox", 0, "gears"], "shift_style": ["drivetrain.shift_style", 0, "normal"], "cvt_rpm": ["drivetrain.cvt_rpm", 1.0, 4000.0],
	"tc_stall_rpm": ["drivetrain.tc_stall_rpm", 1.0, 2000.0], "tc_ratio": ["drivetrain.tc_ratio", 1.0, 2.0],
	"reverse_ratio": ["drivetrain.reverse_ratio", 1.0, 3.0], "clutch": ["drivetrain.clutch", 1.0, 1.5], "diff": ["drivetrain.diff", 0, "open"],
	"diff_preload": ["drivetrain.diff_preload", 1.0, 100.0], "diff_power": ["drivetrain.diff_power", 0.01, 0.3],
	"diff_coast": ["drivetrain.diff_coast", 0.01, 0.1], "diff_lock": ["drivetrain.diff_lock", 1.0, 60.0], "center_diff": ["drivetrain.center_diff", 0, "lsd"],
	"center_split": ["drivetrain.center_split", 0.01, 0.4],
	"drag_coefficient": ["chassis.drag_coefficient", 1.0, 0.35], "max_steer_deg": ["chassis.max_steer_deg", 1.0, 30.0],
	"ackermann": ["chassis.ackermann", 0.01, 0.6],
	"susp_front": ["suspension.front.type", 0, "model"], "susp_rear": ["suspension.rear.type", 0, "model"], "engine_place": ["driveline.engine", 0, "front"],
	"efficiency": ["drivetrain.efficiency", 1.0, 0.92],
	"length": ["dimensions.length", 1.0, 4.2], "width": ["dimensions.width", 1.0, 1.8], "height": ["dimensions.height", 1.0, 1.4],
	"steering_degrees": ["steering_wheel.degrees", 1.0, 450.0], "steering_stop": ["steering_wheel.stop", 0, "rods"],
	"cam_follow_distance": ["cameras.follow.distance", 1.0, null], "cam_follow_height": ["cameras.follow.height", 1.0, null],
	"cam_follow_look_height": ["cameras.follow.look_height", 1.0, null], "cam_follow_look_z": ["cameras.follow.look_z", 1.0, 0.0],
	"cam_follow_smoothing": ["cameras.follow.smoothing", 1.0, null], "cam_follow_fov_standing": ["cameras.follow.fov_standing", 1.0, null],
	"cam_follow_fov_fast": ["cameras.follow.fov_fast", 1.0, null], "cam_follow_fov_full_speed": ["cameras.follow.fov_full_speed", 1.0, 70.0],
	"cam_follow_dolly": ["cameras.follow.dolly", 1.0, 1.0], "cam_follow_distance_fast": ["cameras.follow.distance_fast", 1.0, 0.0], "cam_follow_height_fast": ["cameras.follow.height_fast", 1.0, 0.0],
	"cam_bonnet_fov": ["cameras.bonnet.fov", 1.0, 72.0], "cam_cockpit_fov": ["cameras.cockpit.fov", 1.0, null],
	"cam_cockpit_hide_driver": ["cameras.cockpit.hide_driver", 0, false],
	"sb_max_nodes": ["softbody.max_nodes", 1.0, 90.0], "sb_anchor_yield": ["softbody.anchor.yield_force", 1000.0, 80000.0],
	"sb_anchor_break": ["softbody.anchor.break_force", 1000.0, 250000.0], "sb_beam_yield": ["softbody.beam.yield_force", 1000.0, 40000.0],
	"sb_beam_break": ["softbody.beam.break_force", 1000.0, 120000.0], "sb_hardening": ["softbody.hardening", 0.01, 0.2],
	"sb_shell_mass": ["softbody.shell_mass", 1.0, 300.0],
	"tc_allowance": ["assists.tc_allowance", 0.01, 1.0], "esc_gain": ["assists.esc_gain", 0.01, 1.0],
	"launch_rpm": ["engine.launch_rpm", 1.0, null], "two_step_rpm": ["engine.two_step_rpm", 1.0, null],
	# a motorcycle (car.json "motorcycle"; the defaults of CarTuning.js)
	"bike_max_lean": ["motorcycle.max_lean_deg", 1.0, 52.0], "bike_fast_lean": ["motorcycle.fast_lean_deg", 1.0, 30.0],
	"bike_rake": ["motorcycle.rake_deg", 1.0, 24.5], "bike_rider_mass": ["motorcycle.rider_mass", 1.0, 80.0],
	"bike_hang_off": ["motorcycle.hang_off", 1.0, 0.3], "bike_max_lateral_g": ["motorcycle.max_lateral_g", 1.0, 0.9],
	"bike_balance": ["motorcycle.balance", 1.0, 1.0], "bike_fork_dive": ["motorcycle.fork_dive", 1.0, 1.0],
	"bike_lean_speed": ["motorcycle.lean_speed", 1.0, 1.0], "bike_air_pitch_rate": ["motorcycle.air_pitch_rate_deg", 1.0, 180.0],
	"bike_air_roll_rate": ["motorcycle.air_roll_rate_deg", 1.0, 120.0], "bike_push": ["motorcycle.push", 0, false],
	"bike_push_foot_kmh": ["motorcycle.push_foot_kmh", 1.0, 110.0], "bike_push_upright": ["motorcycle.push_upright", 1.0, 0.55],
	"bike_push_forward": ["motorcycle.push_forward", 1.0, 0.0], "bike_push_chest_pitch": ["motorcycle.push_chest_pitch", 1.0, 0.0],
	"bike_push_pelvis_tilt": ["motorcycle.push_pelvis_tilt", 1.0, 35.0], "bike_push_pelvis_slide": ["motorcycle.push_pelvis_slide", 1.0, 0.09],
	"bike_push_foot_out": ["motorcycle.push_foot_out", 1.0, 0.14], "bike_push_foot_forward": ["motorcycle.push_foot_forward", 1.0, 0.5],
	"bike_hang_chest_roll": ["motorcycle.hang_chest_roll", 1.0, 14.0], "bike_hang_knee_out": ["motorcycle.hang_knee_out", 1.0, 0.6],
	"bike_hang_knee_down": ["motorcycle.hang_knee_down", 1.0, 0.5], "bike_hang_tuck_pitch": ["motorcycle.hang_tuck_pitch", 1.0, 28.0],
	"bike_hang_sit_pitch": ["motorcycle.hang_sit_pitch", 1.0, 10.0], "bike_hang_shift": ["motorcycle.hang_shift", 1.0, 0.7],
}

## The sound of the engine (car.json sound.engine_sim): es_<key>.
const SOUND_KEYS := ["volume", "convolution", "audio_volume", "hf_gain", "noise", "jitter", "exhaust_length", "primary_length", "idle_pressure"]

## The values that the Godot physics do not use yet (the menu shows them grey, with NOT_YET as the tooltip). (The
## build-up of the limited slip and the centre differential work now: CarDrivetrain; the look-ahead, the field of view
## with speed and the dolly of the follow camera: ChaseCamera.)
const NOT_IN_GODOT: Array[String] = []

## The values that build the car again (the wheel library, the parts library): the car is built again at once, as in the
## browser (Car.rebuild); a motorcycle at the next start.
const AT_NEXT_START := ["rim_front", "tyre_front", "rim_rear", "tyre_rear", "susp_front", "susp_rear"]
const NEXT_START := "The car is built again with this at once (a motorcycle: at the next start, save the setup first)."
static var tunes_root := "user://tunes"     # (the tests put the tunes of the player in a folder of their own)


## The value at a path of car.json ("chassis.mass", "drivetrain.gear_ratios.2"), or null when it is not there.
static func read(cfg: Dictionary, path: String) -> Variant:
	var at: Variant = cfg
	for part in path.split("."):
		if at is Dictionary and (at as Dictionary).has(part):
			at = at[part]
		elif at is Array and part.is_valid_int() and int(part) < (at as Array).size():
			at = at[int(part)]
		else:
			return null
	return at


## Sets the value at a path, making the dictionaries on the way (an index of a list must be there already).
static func write(cfg: Dictionary, path: String, value: Variant) -> void:
	var parts := path.split(".")
	var at: Variant = cfg
	for i in parts.size() - 1:
		var part := parts[i]
		var nxt: Variant = null
		if at is Dictionary:
			if not (at as Dictionary).has(part) or not (at[part] is Dictionary or at[part] is Array):
				at[part] = {}
			nxt = at[part]
		elif at is Array and part.is_valid_int():
			nxt = at[int(part)]
		if nxt == null:
			return
		at = nxt
	var last := parts[parts.size() - 1]
	if at is Dictionary:
		at[last] = value
	elif at is Array and last.is_valid_int() and int(last) < (at as Array).size():
		at[int(last)] = value


## Takes a value away (a path that is not there: nothing happens).
static func erase(cfg: Dictionary, path: String) -> void:
	var i := path.rfind(".")
	var owner: Variant = cfg if i < 0 else read(cfg, path.substr(0, i))
	if owner is Dictionary:
		(owner as Dictionary).erase(path.substr(i + 1))


static func _num(cfg: Dictionary, path: String, fallback: float) -> float:
	var v: Variant = read(cfg, path)
	return float(v) if v is float or v is int else fallback


static func _round_to(x: float, step: float) -> float:
	return roundf(x / step) * step


## The values of a car in the units of the menu (fromConfig of CarTuning.js). cam: what the camera uses where car.json
## has no camera ({ distance, height, look_height, smoothing, fov_standing, fov_fast, cockpit: Vector3, cockpit_fov }).
static func values_of(cfg: Dictionary, cam := {}) -> Dictionary:
	var v := {}
	for key in MAP:
		var m: Array = MAP[key]
		var raw: Variant = read(cfg, m[0])
		if raw == null:
			raw = m[2]
		if raw == null:
			continue
		var factor := float(m[1])
		v[key] = float(raw) / factor if factor != 0.0 and (raw is float or raw is int) else raw
	var limiter := _num(cfg, "engine.limiter_rpm", 6500.0)
	var idle := _num(cfg, "engine.idle_rpm", 900.0)
	v["vehicle_type"] = "motorcycle" if str(cfg.get("type", "car")) == "motorcycle" else "car"
	v["engine_build"] = read(cfg, "engine.build")
	v["unsprung"] = "none" if read(cfg, "chassis.unsprung") == true else "sprung"
	v["tyre_damage"] = "on" if read(cfg, "tyres.damage") == true else "off"
	v["tc_lockup"] = "off" if read(cfg, "drivetrain.tc_lockup") == false else "on"
	v["sb_enabled"] = "off" if read(cfg, "softbody.enabled") == false else "on"
	if not v.has("launch_rpm"):
		v["launch_rpm"] = _round_to(limiter * 0.6, 100.0)
	if not v.has("two_step_rpm"):
		v["two_step_rpm"] = _round_to(limiter * 0.7, 100.0)
	if not v.has("clutch_start_rpm"):
		v["clutch_start_rpm"] = idle + 150.0
	# the brakes: the two together and the share of the front
	var bf := _num(cfg, "brakes.front", 1500.0)
	var br := _num(cfg, "brakes.rear", 1500.0)
	v["brake_total"] = bf + br
	v["brake_bias"] = roundf(bf / maxf(1.0, bf + br) * 1000.0) / 10.0
	# the downforce at 100 km/h (a car.json with one "downforce" shares it by the weight on the axles)
	var wd := _num(cfg, "chassis.weight_distribution", 0.5)
	var both := _num(cfg, "chassis.downforce", 0.0)
	v["downforce_front"] = roundf(_num(cfg, "chassis.downforce_front", both * wd) * V100)
	v["downforce_rear"] = roundf(_num(cfg, "chassis.downforce_rear", both * (1.0 - wd)) * V100)
	# the gears
	var gears: Array = read(cfg, "drivetrain.gear_ratios") if read(cfg, "drivetrain.gear_ratios") is Array else []
	v["gear_count"] = gears.size()
	for i in gears.size():
		v["gear%d" % i] = float(gears[i])
	# the tyres of the wheel library and a custom tyre
	var lib: Dictionary = read(cfg, "wheels.library") if read(cfg, "wheels.library") is Dictionary else {}
	v["model_wheels"] = "on" if str(read(cfg, "wheels.mode")) == "model" else "off"
	v["model_tyres"] = "on" if lib.get("front", {}).get("model", false) or lib.get("rear", {}).get("model", false) else "off"
	var compound := str(v.get("compound", "road"))
	for axle in ["front", "rear"]:
		var dia: float = v.get("tyre_diameter_" + axle, _round_to(_num(cfg, "chassis.tire_diameter", 0.65) * 1000.0, 5.0))
		v["tyre_diameter_" + axle] = dia
		var ratio := _num(cfg, "wheels.library.%s.custom.inner_ratio" % axle, _num(cfg, "tyres.shell.inner_ratio", 0.62))
		v["tyre_height_" + axle] = clampf(_round_to(dia / 2.0 * (1.0 - ratio), 5.0), 20.0, 300.0)
		var section := _num(cfg, "wheels.library.%s.custom.width" % axle, 0.0) * 1000.0
		if section <= 0.0:
			section = _num(cfg, "tyres.shell.width_rear" if axle == "rear" else "tyres.shell.width", 0.0) * 1000.0
		section = _round_to(section if section > 0.0 else 245.0, 5.0)
		v["tyre_section_" + axle] = section
		v["tyre_aspect_" + axle] = clampf(_round_to(dia / 2.0 * (1.0 - ratio) / section * 100.0, 5.0), 15.0, 100.0)
		v["tyre_rim_" + axle] = clampf(roundf(dia * ratio / 25.4), 10.0, 27.0)
		if not v.has("rubber_" + axle):
			v["rubber_" + axle] = 22.0
			for s in TyreCompounds.RUBBER_STOPS:
				if s[0] == compound:
					v["rubber_" + axle] = float(s[1])
		if not v.has("tread_" + axle):
			v["tread_" + axle] = 100.0 if compound == "offroad" else 0.0
	# the cameras: what car.json has, else what the camera uses
	for k in ["distance", "height", "look_height", "smoothing", "fov_standing", "fov_fast"]:
		if not v.has("cam_follow_" + k):
			v["cam_follow_" + k] = float(cam.get(k, 0.0))
	if not v.has("cam_cockpit_fov"):
		v["cam_cockpit_fov"] = float(cam.get("cockpit_fov", 75.0))
	var pos: Variant = read(cfg, "cameras.cockpit.position")
	var cp: Vector3 = cam.get("cockpit", Vector3.ZERO)
	if pos is Array and (pos as Array).size() >= 3:
		cp = Vector3(float(pos[0]), float(pos[1]), float(pos[2]))
	v["cam_cockpit_x"] = snappedf(cp.x, 0.001)
	v["cam_cockpit_y"] = snappedf(cp.y, 0.001)
	v["cam_cockpit_z"] = snappedf(cp.z, 0.001)
	var bon: Variant = read(cfg, "cameras.bonnet.position")
	var dm: Dictionary = cfg.get("dimensions", {})
	var offs: Variant = read(cfg, "model.offset")
	var bo := Vector3(float(bon[0]), float(bon[1]), float(bon[2])) if bon is Array and (bon as Array).size() >= 3 else \
		Vector3(0.0, float(dm.get("height", 1.3)) * 0.62 + (float(offs[1]) if offs is Array and (offs as Array).size() == 3 else 0.0), float(dm.get("length", 4.2)) * 0.12)
	v["cam_bonnet_x"] = snappedf(bo.x, 0.001)
	v["cam_bonnet_y"] = snappedf(bo.y, 0.001)
	v["cam_bonnet_z"] = snappedf(bo.z, 0.001)
	# the sound of the engine
	var sound := EngineSimParams.params(cfg)
	for k in SOUND_KEYS:
		v["es_" + k] = float(sound.get(k, 0.0))
	# the extras: what car.json has, or the default (the full boost of a turbo car follows its share of boost)
	var ex: Dictionary = cfg.get("extras", {}) if cfg.get("extras", {}) is Dictionary else {}
	for k in FEATURE_DEFAULTS:
		var d: Variant = ex.get(k, FEATURE_DEFAULTS[k])
		v[k] = float(d) if d is int else d
	if float(v["governor_rpm"]) <= 0.0:
		v["governor_rpm"] = _round_to(limiter * 0.85, 100.0)
	if not ex.has("boost_full") and float(v.get("turbo_share", 0.0)) > 0.0:
		v["boost_full"] = roundf(float(v["turbo_share"]) / 100.0 * 20.0) / 10.0
	return v


## What a slider stands for, in words, or "".
static func row_note(key: String, v: Dictionary) -> String:
	if key.begins_with("tread_"):
		return CarEditorTuning.tread_label(float(v.get(key, 0.0)), float(v.get("rubber_" + key.substr(6), 50.0)))
	if key.begins_with("rubber_"):
		return CarEditorTuning._rubber_label(float(v.get(key, 50.0)))
	if key == "tyre_rim_front" or key == "tyre_rim_rear":
		var axle := key.substr(9)
		var dia := float(v["tyre_rim_" + axle]) * 25.4 + 2.0 * float(v["tyre_section_" + axle]) * float(v["tyre_aspect_" + axle]) / 100.0
		return "%d/%d R%d · %.0f cm" % [v["tyre_section_" + axle], v["tyre_aspect_" + axle], v["tyre_rim_" + axle], dia / 10.0]
	return ""


## Sets one value of the menu in a car configuration (toConfig of CarTuning.js, for that value).
static func set_value(cfg: Dictionary, key: String, value: Variant, cam := {}) -> void:
	var v := values_of(cfg, cam)
	v[key] = value
	match key:
		"unsprung":
			write(cfg, "chassis.unsprung", value == "none")
		"tyre_damage":
			write(cfg, "tyres.damage", value == "on")
		"tc_lockup":
			write(cfg, "drivetrain.tc_lockup", value != "off")
		"sb_enabled":
			if value == "off":
				write(cfg, "softbody.enabled", false)
			else:
				erase(cfg, "softbody.enabled")
		"brake_total", "brake_bias":
			var total := float(v["brake_total"])
			var bias := float(v["brake_bias"]) / 100.0
			cfg["brakes"] = {"front": roundf(total * bias), "rear": roundf(total * (1.0 - bias))}
		"downforce_front", "downforce_rear":
			write(cfg, "chassis.downforce_front", float(v["downforce_front"]) / V100)
			write(cfg, "chassis.downforce_rear", float(v["downforce_rear"]) / V100)
			erase(cfg, "chassis.downforce")
		"cam_cockpit_x", "cam_cockpit_y", "cam_cockpit_z":
			write(cfg, "cameras.cockpit.position", [float(v["cam_cockpit_x"]), float(v["cam_cockpit_y"]), float(v["cam_cockpit_z"])])
		"cam_bonnet_x", "cam_bonnet_y", "cam_bonnet_z":
			write(cfg, "cameras.bonnet.position", [float(v["cam_bonnet_x"]), float(v["cam_bonnet_y"]), float(v["cam_bonnet_z"])])
		"tyre_section_front", "tyre_aspect_front", "tyre_rim_front", "tyre_section_rear", "tyre_aspect_rear", "tyre_rim_rear":
			var axle := "front" if key.ends_with("front") else "rear"
			var section := float(value) if key.begins_with("tyre_section") else float(v["tyre_section_" + axle])
			var aspect := float(value) if key.begins_with("tyre_aspect") else float(v["tyre_aspect_" + axle])
			var rim := float(value) if key.begins_with("tyre_rim") else float(v["tyre_rim_" + axle])
			var dia := rim * 25.4 + 2.0 * section * aspect / 100.0
			write(cfg, "wheels.library.%s.custom.diameter" % axle, dia / 1000.0)
			write(cfg, "wheels.library.%s.custom.inner_ratio" % axle, rim * 25.4 / dia)
			write(cfg, "wheels.library.%s.custom.width" % axle, section / 1000.0)
			if str(read(cfg, "wheels.library.%s.tyre" % axle)) in ["", "<null>"]:
				write(cfg, "wheels.library.%s.tyre" % axle, "custom")
		"tyre_height_front", "tyre_height_rear":
			var axle := key.substr(12)
			var dia := float(v["tyre_diameter_" + axle])
			write(cfg, "wheels.library.%s.custom.inner_ratio" % axle, clampf(1.0 - 2.0 * float(value) / maxf(1.0, dia), 0.3, 0.9))
		"gear_count":
			set_gears(cfg, gears_of(v, int(value)))
		_:
			if key.begins_with("gear") and key.substr(4).is_valid_int():
				var gears := gears_of(v)
				var i := int(key.substr(4))
				if i < gears.size():
					gears[i] = float(value)
				set_gears(cfg, gears)
			elif key.begins_with("es_"):
				write(cfg, "sound.engine_sim." + key.substr(3), value)
			elif FEATURE_DEFAULTS.has(key) and not MAP.has(key):
				write(cfg, "extras." + key, value)
			elif MAP.has(key):
				var m: Array = MAP[key]
				var factor := float(m[1])
				write(cfg, m[0], float(value) * factor if factor != 0.0 and (value is float or value is int) else value)
				if (key.begins_with("tread_") or key.begins_with("rubber_")) and v.get("model_wheels") == "on":
					# (a tyre of the model that gets a rubber or a tread: the grip follows them, as a custom tyre)
					var ax := key.substr(key.find("_") + 1)
					write(cfg, "wheels.library.%s.custom.rubber" % ax, float(value) if key.begins_with("rubber_") else float(v["rubber_" + ax]))
					write(cfg, "wheels.library.%s.custom.tread" % ax, float(value) if key.begins_with("tread_") else float(v["tread_" + ax]))
					if str(read(cfg, "wheels.library.%s.tyre" % ax)) in ["", "<null>"]:
						write(cfg, "wheels.library.%s.tyre" % ax, "custom")
	# (no turbo: the share and the boost pressure both 0; the clutch grips fully above where it starts to grip)
	if key.begins_with("turbo_") and _num(cfg, "engine.turbo.share", 0.0) <= 0.0 and _num(cfg, "engine.turbo.boost_bar", 0.0) <= 0.0:
		erase(cfg, "engine.turbo")
	if key == "clutch_start_rpm" or key == "clutch_full_rpm":
		write(cfg, "drivetrain.clutch_full_rpm", maxf(float(v["clutch_full_rpm"]), float(v["clutch_start_rpm"]) + 50.0))


## The gear ratios of the values; count: one more is a little lower than the last, one fewer drops the last.
static func gears_of(v: Dictionary, count := -1) -> Array:
	var n := int(v.get("gear_count", 0)) if count < 0 else clampi(count, 1, 10)
	var out := []
	for i in n:
		var r: Variant = v.get("gear%d" % i)
		out.append(float(r) if r != null else (maxf(0.3, float(out[out.size() - 1]) * 0.82) if not out.is_empty() else 3.0))
	return out


static func set_gears(cfg: Dictionary, gears: Array) -> void:
	write(cfg, "drivetrain.gear_ratios", gears.duplicate())


## A kind of transmission (TRANSMISSIONS): its gearbox, gears, reverse, shift time and converter.
static func use_transmission(cfg: Dictionary, p: Dictionary) -> void:
	write(cfg, "drivetrain.gearbox", p["gearbox"])
	set_gears(cfg, p["gears"])
	write(cfg, "drivetrain.reverse_ratio", p["reverse"])
	write(cfg, "drivetrain.shift_time", p["shift_time"])
	for k in ["tc_stall_rpm", "tc_ratio"]:
		if p.has(k):
			write(cfg, "drivetrain." + k, p[k])
	if p.has("tc_lockup"):
		write(cfg, "drivetrain.tc_lockup", p["tc_lockup"] != "off")
	if p.get("shift_style", "normal") != "normal":
		write(cfg, "drivetrain.shift_style", p["shift_style"])
	else:
		erase(cfg, "drivetrain.shift_style")


## A tyre of the axle is a custom one (made from the numbers), or one of the wheel library (CarTuning.js).
static func custom_tyre(v: Dictionary, axle: String) -> bool:
	var t := str(v.get("tyre_" + axle, ""))
	var bike: bool = v.get("vehicle_type") == "motorcycle"
	return t == "custom" or (t == "" and not bike and (str(v.get("rim_" + axle, "")) != "" or v.get("model_tyres") == "on" or v.get("model_wheels") == "on")) \
		or (t == "" and bike and v.get("model_tyres") == "on")


static func library_tyre(v: Dictionary, axle: String) -> bool:
	var t := str(v.get("tyre_" + axle, ""))
	if t == "custom":
		return false
	if t != "":
		return true
	return v.get("vehicle_type") == "motorcycle" and str(v.get("rim_" + axle, "")) != "" and v.get("model_tyres") != "on"


## Whether a setting can do anything with the others as they are (CarTuning.visible): the menu hides the rest.
static func visible(key: String, v: Dictionary) -> bool:
	var g := str(v.get("gearbox", "gears"))
	var turbo: bool = float(v.get("turbo_share", 0.0)) > 0.0 or float(v.get("turbo_boost", 0.0)) > 0.0
	var built: bool = v.get("engine_build") != null
	var kart: bool = v.get("unsprung") == "none"
	var bike: bool = v.get("vehicle_type") == "motorcycle"
	match key:
		"shift_time":
			return g != "cvt"
		"clutch", "clutch_start_rpm", "clutch_full_rpm":
			return g != "torque-converter"
		"cvt_rpm":
			return g == "cvt"
		"tc_stall_rpm", "tc_ratio", "tc_lockup":
			return g == "torque-converter"
		"diff_preload", "diff_power", "diff_coast", "diff_lock":
			return v.get("diff") == "lsd"
		"center_diff":
			return v.get("drive") == "awd"
		"center_split":
			return v.get("drive") == "awd" and v.get("center_diff") != "locked"
		"turbo_spool":
			return turbo
		"turbo_share":
			return not built
		"turbo_threshold", "turbo_boost":
			return turbo and not built
		"turbo_intercooler", "turbo_efficiency":
			return float(v.get("turbo_boost", 0.0)) > 0.0
		"tyre_inner_ratio":
			return not ((custom_tyre(v, "front") or library_tyre(v, "front")) and (custom_tyre(v, "rear") or library_tyre(v, "rear")))
		"tyre_width":
			return not library_tyre(v, "front")
		"tyre_width_rear":
			return not library_tyre(v, "rear")
		"tyre_rings", "tyre_segments", "tyre_carcass":
			return not (library_tyre(v, "front") and library_tyre(v, "rear"))
		"rim_front", "rim_rear":
			return v.get("model_tyres") != "on" and v.get("model_wheels") != "on"
		"tyre_front", "tyre_rear":
			var axle := key.substr(5)
			var t := str(v.get(key, ""))
			return (str(v.get("rim_" + axle, "")) != "" and v.get("model_tyres") != "on") if bike else (t != "" and t != "custom" and v.get("model_wheels") != "on")
		"tyre_section_front", "tyre_aspect_front", "tyre_rim_front", "tyre_rim_offset_front", "rubber_front", "tread_front":
			return custom_tyre(v, "front")
		"tyre_section_rear", "tyre_aspect_rear", "tyre_rim_rear", "tyre_rim_offset_rear", "rubber_rear", "tread_rear":
			return custom_tyre(v, "rear")
		"shift_style":
			return g in ["torque-converter", "dct", "amt"]
		"sb_max_nodes", "sb_anchor_yield", "sb_anchor_break", "sb_beam_yield", "sb_beam_break", "sb_hardening", "sb_shell_mass":
			return v.get("sb_enabled") != "off"
		"body_flake", "body_pattern", "body_uv":
			return v.get("body_finish") == "flake"
		"rim_flake", "rim_pattern", "rim_uv":
			return v.get("rim_finish") == "flake"
		"es_exhaust_length", "es_primary_length":
			return not built
		"frame_torsion", "inner_lift":
			return kart
		"anti_dive", "anti_lift_rear":
			return not kart and not bike
		"anti_squat":
			return not kart and not bike and v.get("drive") != "fwd"
		"anti_lift_front":
			return not kart and not bike and v.get("drive") in ["fwd", "awd"]
		"spring_front", "spring_rear", "damping_front", "damping_rear", "suspension_travel", "suspension_droop", "suspension_length", "spring_progression", \
				"damping_rebound", "ride_front", "ride_rear":
			return not kart
		"bike_hang_chest_roll", "bike_hang_knee_out", "bike_hang_knee_down", "bike_hang_tuck_pitch", "bike_hang_sit_pitch", "bike_hang_shift":
			return bike and not v.get("bike_push", false)
		"bike_push_foot_kmh", "bike_push_upright", "bike_push_forward", "bike_push_chest_pitch", "bike_push_pelvis_tilt", "bike_push_pelvis_slide", \
				"bike_push_foot_out", "bike_push_foot_forward":
			return bike and bool(v.get("bike_push", false))
	if key.begins_with("bike_"):
		return bike
	return true


## A system or an extra is offered (CarTuning.visibleFeature): the anti-lag and the boost gauge only with a turbo.
static func visible_feature(key: String, v: Dictionary) -> bool:
	if key == "antilag" or key == "boost_gauge":
		return float(v.get("turbo_share", 0.0)) > 0.0 or float(v.get("turbo_boost", 0.0)) > 0.0
	return true


## The peak power of a car (hp, at rpm) and its peak torque (Nm), from the torque curve up to the rev limit.
static func peak_of(cfg: Dictionary) -> Dictionary:
	var curve: Variant = read(cfg, "engine.torque_curve")
	var scale := _num(cfg, "engine.power_scale", 1.0)
	var limiter := _num(cfg, "engine.limiter_rpm", 6500.0)
	var hp := 0.0
	var at := 0.0
	var nm_peak := 0.0
	if curve is Array:
		for p in curve:
			var rpm := float(p[0]) if p is Array else float(p.get("rpm", 0)) if p is Dictionary else 0.0
			var nm := (float(p[1]) if p is Array else float(p.get("nm", 0)) if p is Dictionary else 0.0) * scale
			if rpm > limiter:
				continue
			var h := nm * rpm * PI / 30.0 / 745.7
			if h > hp:
				hp = h
				at = rpm
			nm_peak = maxf(nm_peak, nm)
	return {"hp": hp, "rpm": at, "nm": nm_peak}


## The torque (Nm) of the curve at an engine speed.
static func torque_at(cfg: Dictionary, rpm: float) -> float:
	var curve: Variant = read(cfg, "engine.torque_curve")
	if not curve is Array or (curve as Array).size() < 2:
		return 0.0
	var prev_r := 0.0
	var prev_t := 0.0
	for p in curve:
		var r := float(p[0]) if p is Array else float(p.get("rpm", 0))
		var t := float(p[1]) if p is Array else float(p.get("nm", 0))
		if r >= rpm:
			return lerpf(prev_t, t, (rpm - prev_r) / maxf(1.0, r - prev_r)) * _num(cfg, "engine.power_scale", 1.0)
		prev_r = r
		prev_t = t
	return prev_t * _num(cfg, "engine.power_scale", 1.0)


## About the top speed (m/s): the fastest where the power at the wheels in some gear (to the rev limit) still beats the
## drag and the rolling resistance (as Car.gd counts them).
static func top_speed(cfg: Dictionary) -> float:
	var gears: Variant = read(cfg, "drivetrain.gear_ratios")
	if not gears is Array or (gears as Array).is_empty():
		return 0.0
	var final := _num(cfg, "drivetrain.final_drive", 3.7)
	var eff := _num(cfg, "drivetrain.efficiency", 0.92)
	var r := _num(cfg, "chassis.tire_diameter", 0.65) / 2.0
	var limiter := _num(cfg, "engine.limiter_rpm", 6500.0)
	var mass := _num(cfg, "chassis.mass", 1200.0)
	var drag := 0.5 * 1.225 * _num(cfg, "chassis.drag_coefficient", 0.35) * _num(cfg, "dimensions.width", 1.8) * _num(cfg, "dimensions.height", 1.4) * 0.82
	var roll := _num(cfg, "tyres.rolling_resistance", 0.015) * mass * 9.81
	var best := 0.0
	var speed := 1.0
	while speed < 200.0:
		var ok := false
		for g in gears:
			var rpm := speed / r * float(g) * final * 30.0 / PI
			if rpm > limiter:
				continue
			var force := torque_at(cfg, maxf(rpm, 1000.0)) * float(g) * final * eff / r
			if force > drag * speed * speed + roll:
				ok = true
				break
		if ok:
			best = speed
		speed += 0.5
	return best


static func tunes_dir(car_id: String) -> String:
	return tunes_root.path_join(car_id)


## The tunes of a car: { name: path } (its own from web/cars/<car>/, and the player's: a tune of the player with the
## name of one of the car goes before it).
static func list(car_id: String, cfg: Dictionary) -> Dictionary:
	var out := {}
	var detail := list_detail(car_id, cfg)
	for n in detail:
		out[n] = detail[n]["own"] if detail[n]["own"] != "" else detail[n]["car"]
	return out


## The tunes of a car with where they are: { name: { "own": path or "", "car": path or "" } }, sorted by name.
static func list_detail(car_id: String, cfg: Dictionary) -> Dictionary:
	var found := {}
	for f in cfg.get("tunes", []):
		var p := Content.path("cars/%s/%s" % [car_id, f])
		var t: Variant = JSON.parse_string(FileAccess.get_file_as_string(p)) if FileAccess.file_exists(p) else null
		if t is Dictionary:
			found[str(t.get("name", f))] = {"own": "", "car": p}
	var dir := tunes_dir(car_id)
	if DirAccess.dir_exists_absolute(dir):
		for f in DirAccess.get_files_at(dir):
			if f.ends_with(".openracer-tune.json"):
				var t: Variant = JSON.parse_string(FileAccess.get_file_as_string(dir.path_join(f)))
				if t is Dictionary:
					var n := str(t.get("name", f))
					if not found.has(n):
						found[n] = {"own": "", "car": ""}
					found[n]["own"] = dir.path_join(f)
	var names := found.keys()
	names.sort_custom(func(a, b): return str(a).naturalnocasecmp_to(str(b)) < 0)
	var out := {}
	for n in names:
		out[n] = found[n]
	return out


static func load_tune(path: String) -> Dictionary:
	var t: Variant = JSON.parse_string(FileAccess.get_file_as_string(path)) if FileAccess.file_exists(path) else null
	return t.get("config", {}) if t is Dictionary else {}


## The car with a tune: what the tune has over the car as made. (A tune may have no model, which is the car's.)
static func tuned_config(path: String, base: Dictionary) -> Dictionary:
	var t := load_tune(path)
	if t.is_empty():
		return {}
	var cfg := base.duplicate(true)
	cfg.merge(t, true)
	keep_driver(cfg, base)
	return cfg


## The driver (the model and every position) belongs to the car: the same for all its tunes and the default.
static func keep_driver(cfg: Dictionary, base: Dictionary) -> void:
	if base.get("driver") is Dictionary:
		cfg["driver"] = (base["driver"] as Dictionary).duplicate(true)
	else:
		cfg.erase("driver")


static func save_tune(car_id: String, tune_name: String, cfg: Dictionary) -> String:
	DirAccess.make_dir_recursive_absolute(tunes_dir(car_id))
	var safe := tune_name.validate_filename().replace(" ", "-").to_lower()
	var path := tunes_dir(car_id).path_join(safe + ".openracer-tune.json")
	var data := {"openracer-tune": 1, "car": car_id, "name": tune_name, "saved": Time.get_datetime_string_from_system(true) + "Z", "config": cfg}
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify(data, "  "))
	return path


## Values written in the file of a tune as it is (paths with their values): its name and its place stay.
static func patch_tune_file(path: String, values: Dictionary) -> bool:
	var data: Variant = JSON.parse_string(FileAccess.get_file_as_string(path)) if FileAccess.file_exists(path) else null
	if not data is Dictionary or not data.get("config") is Dictionary:
		return false
	for p: String in values:
		write(data["config"], p, values[p])
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f == null:
		return false
	f.store_string(JSON.stringify(data, "  "))
	return true


## Deletes a tune of the player (never one that comes with a car).
static func delete_tune(path: String) -> bool:
	if not path.begins_with(tunes_root):
		return false
	return DirAccess.remove_absolute(path) == OK
