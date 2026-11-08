extends Node
## (a scene, for the autoloads) Import from a link of the garage (GarageDialog.import_url, Garage.js importUrl): a zip
## that is not a car or a track, served by a local server, is downloaded and refused (so nothing goes into the
## garage), a missing file says its HTTP code, and a link that is not http is refused at once.
##   python3 -m http.server 8765 --directory <a folder with notacar.zip> &
##   Godot --headless --path godot res://tools/test_garage_link.tscn -- --user-dir=/tmp/x/u --port=8765

var _fails := 0


func _check(ok: bool, what: String) -> void:
	print(("ok    " if ok else "FAIL  ") + what)
	if not ok:
		_fails += 1


func _ready() -> void:
	var port := Content.arg("port") if Content.arg("port") != "" else "8765"
	var d := GarageDialog.new()
	add_child(d)
	await get_tree().process_frame
	d.import_url("ftp://example")
	_check(d.status.text.contains("https://"), "a link that is not http: " + d.status.text)
	d.import_url("http://127.0.0.1:%s/notacar.zip" % port)
	_check(d.status.text == "Downloading…", "it downloads")
	for i in 100:
		await get_tree().create_timer(0.1).timeout
		if d.status.text != "Downloading…":
			break
	_check(d.status.text.contains("no car.json"), "the zip is downloaded and read: " + d.status.text)
	d.import_url("http://127.0.0.1:%s/missing.zip" % port)
	for i in 100:
		await get_tree().create_timer(0.1).timeout
		if d.status.text != "Downloading…":
			break
	_check(d.status.text.contains("404"), "a missing file: " + d.status.text)
	print("garage link test: %s" % ("all fine" if _fails == 0 else "%d failed" % _fails))
	get_tree().quit(1 if _fails else 0)
