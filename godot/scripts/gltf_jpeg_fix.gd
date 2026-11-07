class_name GltfJpegFix
extends GLTFDocumentExtension
## Godot's JPEG decoder does not read some JPEGs with a colour profile (an APP2 ICC block, as Blender writes it for a
## Display P3 picture: the screenshot in the hatchback). The JPEGs of a glTF are read without their APP2 blocks
## (Godot does not use the profile: the colours are taken as sRGB either way).


func _parse_image_data(_state: GLTFState, image_data: PackedByteArray, mime_type: String, ret_image: Image) -> Error:
	# (an extension that answers for one kind must answer for all: an image it skips is not read at all)
	match mime_type:
		"image/jpeg":
			return ret_image.load_jpg_from_buffer(without_app2(image_data))
		"image/png":
			return ret_image.load_png_from_buffer(image_data)
		"image/webp":
			return ret_image.load_webp_from_buffer(image_data)
		"image/ktx2", "image/vnd-ms.dds":
			return ret_image.load_ktx_from_buffer(image_data) if mime_type == "image/ktx2" else ret_image.load_dds_from_buffer(image_data)
	return ERR_SKIP


## The JPEG without its APP2 segments (FF E2), up to the start of the scan.
static func without_app2(d: PackedByteArray) -> PackedByteArray:
	var out := d.slice(0, 2)
	var i := 2
	while i + 3 < d.size() and d[i] == 0xFF:
		var m := d[i + 1]
		if m == 0xDA:
			break
		var length := (d[i + 2] << 8) | d[i + 3]
		if m != 0xE2:
			out.append_array(d.slice(i, i + 2 + length))
		i += 2 + length
	out.append_array(d.slice(i))
	return out
