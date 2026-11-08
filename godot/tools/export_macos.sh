#!/bin/sh
# Builds the macOS app of O-Racer: godot/build/macos/O-Racer.app, with the cars, the tracks, the wheel library and the sounds of
# web/ copied into the bundle (Contents/Resources/web), so the app runs on its own. Signed ad hoc (not notarised):
# the first start needs a right click, Open.
#   sh godot/tools/export_macos.sh [--debug]
# Needs the export templates of Godot 4.7.2 and the release build of the native part (cd godot/native && scons
# target=template_release arch=universal).
set -e
cd "$(dirname "$0")/.."
# (Godot must not import what is built: godot/build is inside the project)
mkdir -p build && touch build/.gdignore
GODOT=${GODOT:-/Applications/Godot.app/Contents/MacOS/Godot}
MODE=--export-release
[ "$1" = "--debug" ] && MODE=--export-debug
mkdir -p build/macos
rm -rf build/macos/O-Racer.app
"$GODOT" --headless --path . $MODE "macOS" build/macos/O-Racer.app
RES=build/macos/O-Racer.app/Contents/Resources/web
mkdir -p "$RES"
for d in cars tracks wheels sounds; do
	[ -d ../web/$d ] && rsync -a --delete --exclude '.DS_Store' --exclude '*.import' --exclude '*.zip' --exclude '*.py' ../web/$d/ "$RES/$d/"
done
# (the content changed the bundle: sign it again, ad hoc)
codesign --force --deep -s - build/macos/O-Racer.app
du -sh build/macos/O-Racer.app
