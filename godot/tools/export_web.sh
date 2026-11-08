#!/bin/sh
# Builds the web version of O-Racer: godot/build/web/ with index.html, the engine (index.js, index.wasm, the
# worklets), the game (index.pck), the native part (liboracer.web.*.wasm) and the content (content.pck: the cars,
# tracks, wheels and sounds of web/ as res://content, fetched by the page before the game starts).
#   sh godot/tools/export_web.sh [--debug]
# Needs the export templates of Godot 4.7.2 (web_dlink_*) and the native part built for the web with Emscripten
# 4.0.20 (the version of the templates):
#   cd godot/native && scons platform=web target=template_release threads=yes
#   (and threads=no, for a build without threads)
# The page needs the headers Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy:
# require-corp (threads): python3 godot/tools/serve_web.py serves it with them, on http://localhost:8060.
set -e
cd "$(dirname "$0")/.."
GODOT=${GODOT:-/Applications/Godot.app/Contents/MacOS/Godot}
MODE=--export-release
[ "$1" = "--debug" ] && MODE=--export-debug
rm -rf build/web
mkdir -p build/web
HERE=$(pwd)
"$GODOT" --headless --log-file "$HERE/build/web-export.log" --path . $MODE "Web" build/web/index.html
# (the pack is made outside the project, so that its autoloads do not run)
TMP=$(mktemp -d)
(cd "$TMP" && "$GODOT" --headless --log-file "$HERE/build/web-pack.log" --script "$HERE/tools/pack_content.gd" -- \
	"$(cd "$HERE/../web" && pwd)" "$HERE/build/web/content.pck")
rmdir "$TMP"
SIZE=$(wc -c < build/web/content.pck | tr -d ' ')
sed -i '' "s/__CONTENT_PCK_SIZE__/$SIZE/" build/web/index.html
ls -la build/web
du -sh build/web
