#!/bin/sh
# Builds the macOS app of GripWorks: godot/build/macos/GripWorks.app, with the cars, the tracks, the wheel library, the sounds
# and the flame pictures (images/flames) of web/ copied into the bundle (Contents/Resources/web), so the app runs on its own. Signed ad hoc (not notarised):
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
rm -rf build/macos/GripWorks.app
"$GODOT" --headless --path . $MODE "macOS" build/macos/GripWorks.app
RES=build/macos/GripWorks.app/Contents/Resources/web
mkdir -p "$RES"
for d in cars tracks wheels sounds images/flames; do
	[ -d ../web/$d ] && mkdir -p "$RES/$d" && rsync -a --delete --exclude '.DS_Store' --exclude '*.import' --exclude '*.zip' --exclude '*.py' ../web/$d/ "$RES/$d/"
done
# (the content changed the bundle: sign it again, ad hoc)
codesign --force --deep -s - build/macos/GripWorks.app
du -sh build/macos/GripWorks.app
