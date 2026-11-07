class_name VideoPrefs
extends RefCounted
## What the replay, the video editor, a take and the free cameras remember (the browser keeps it in localStorage):
## the aspect of the picture, the speed and the look of the free camera of the replay, the free camera of the game
## per car, the choices of a take. Kept in user://video.cfg (a test gives --video-cfg=<file> to keep it elsewhere).
##
## Where the files go: the replays in user://replays (--replay-dir=<folder>), the videos and the photos in the
## Movies and Pictures folders of the system, in OpenRacer (--video-dir=<folder> for both).

const ASPECTS := {
	"16:9": {"ratio": 16.0 / 9.0, "width": 1280, "height": 720},
	"9:16": {"ratio": 9.0 / 16.0, "width": 720, "height": 1280},
	"1:1": {"ratio": 1.0, "width": 960, "height": 960},
}
const ASPECT_NAMES := ["16:9", "9:16", "1:1"]

static var _cfg: ConfigFile = null


static func _path() -> String:
	var p := Content.arg("video-cfg")
	return p if p != "" else "user://video.cfg"


static func _file() -> ConfigFile:
	if _cfg == null:
		_cfg = ConfigFile.new()
		_cfg.load(_path())
	return _cfg


static func get_value(section: String, key: String, fallback: Variant) -> Variant:
	return _file().get_value(section, key, fallback)


static func set_value(section: String, key: String, value: Variant) -> void:
	_file().set_value(section, key, value)
	_file().save(_path())


## The aspect of the picture: "16:9", "9:16" or "1:1".
static func aspect() -> String:
	var a := str(get_value("replay", "aspect", "16:9"))
	return a if ASPECTS.has(a) else "16:9"


static func set_aspect(a: String) -> void:
	if ASPECTS.has(a):
		set_value("replay", "aspect", a)


static func ratio() -> float:
	return float(ASPECTS[aspect()]["ratio"])


## The largest rectangle of the aspect in a size (the orange outline in the window, what a video takes of it).
static func frame_rect(size: Vector2, ratio_now := -1.0) -> Rect2:
	var r := ratio() if ratio_now <= 0.0 else ratio_now
	var w := size.x
	var h := size.x / r
	if h > size.y:
		h = size.y
		w = size.y * r
	return Rect2((size.x - w) / 2.0, (size.y - h) / 2.0, w, h)


static func replays_dir() -> String:
	var d := Content.arg("replay-dir")
	return d if d != "" else "user://replays"


static func videos_dir() -> String:
	return _out_dir(OS.SYSTEM_DIR_MOVIES)


static func photos_dir() -> String:
	return _out_dir(OS.SYSTEM_DIR_PICTURES)


static func _out_dir(kind: OS.SystemDir) -> String:
	var d := Content.arg("video-dir")
	if d == "":
		var sys := OS.get_system_dir(kind)
		d = sys.path_join("OpenRacer") if sys != "" else ProjectSettings.globalize_path("user://videos")
	DirAccess.make_dir_recursive_absolute(d)
	return d


## A name that is safe as a file name (the browser's rule: no \ / : * ? " < > |, at most 80).
static func safe_name(text: String, fallback := "openracer") -> String:
	var out := ""
	for ch in text:
		out += "_" if "\\/:*?\"<>|".contains(ch) or ch.unicode_at(0) < 32 else ch
	out = " ".join(out.split(" ", false)).strip_edges().left(80)
	return out if out != "" else fallback


## A stamp for the names of files: 20261107-1432.
static func stamp() -> String:
	var d := Time.get_datetime_dict_from_system()
	return "%04d%02d%02d-%02d%02d" % [d["year"], d["month"], d["day"], d["hour"], d["minute"]]
