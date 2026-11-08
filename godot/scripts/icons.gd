class_name Icons
extends RefCounted
## The icons of the buttons of the game (the touch controls, the HUD editor), after web/js/Icons.js: the Lucide icons
## (https://lucide.dev, ISC licence), drawn on a grid of 24 with a stroke, made into textures from their SVG.
##
## Use: Icons.texture("camera") (Icons.texture("camera", 20, Color.WHITE): the size in px and the colour).

const PATHS := {
	"rotate-ccw": '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
	"wrench": ('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3'
		+ 'l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'),
	"camera": '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
	"menu": '<line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/>',
	"chevron-up": '<path d="m18 15-6-6-6 6"/>',
	"chevron-down": '<path d="m6 9 6 6 6-6"/>',
	"sliders": ('<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/>'
		+ '<line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/>'
		+ '<line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>'),
	"move": ('<polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/>'
		+ '<polyline points="19 9 22 12 19 15"/><line x1="2" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="22"/>'),
	"check": '<path d="M20 6 9 17l-5-5"/>',
	"video": '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
	"square": '<rect width="14" height="14" x="5" y="5" rx="2"/>',
	"x": '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
}

static var _cache := {}


## The icon as a texture of size x size pixels, its stroke in the colour (kept: the same icon is made once).
static func texture(icon_name: String, size := 22, colour := Color.WHITE) -> Texture2D:
	var key := "%s|%d|%s" % [icon_name, size, colour.to_html()]
	if _cache.has(key):
		return _cache[key]
	var svg := ('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#%s" '
		+ 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">%s</svg>') % [colour.to_html(false), PATHS.get(icon_name, "")]
	var img := Image.new()
	if img.load_svg_from_string(svg, size / 24.0) != OK:
		return null
	var tex := ImageTexture.create_from_image(img)
	_cache[key] = tex
	return tex
