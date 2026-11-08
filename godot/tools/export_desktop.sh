#!/bin/sh
# Builds the Windows and Linux versions of O-Racer: godot/build/windows/ (O-Racer.exe) and godot/build/linux/
# (O-Racer.x86_64), each with the cars, tracks, wheels and sounds of web/ in a folder "web" next to the program,
# and a zip of each folder in godot/build/. Needs the export templates of Godot 4.7.2 and the native part built for
# them (on a Mac: brew install mingw-w64 zig, then in godot/native:
#   scons platform=windows use_mingw=yes arch=x86_64 target=template_release
#   PATH=<zig wrappers>:$PATH scons platform=linux arch=x86_64 target=template_release use_static_cpp=no
# see the README).
set -e
cd "$(dirname "$0")/.."
# (Godot must not import what is built: godot/build is inside the project)
mkdir -p build && touch build/.gdignore
GODOT=${GODOT:-/Applications/Godot.app/Contents/MacOS/Godot}
for p in windows linux; do
	rm -rf build/$p
	mkdir -p build/$p
done
"$GODOT" --headless --path . --export-release "Windows" build/windows/O-Racer.exe
"$GODOT" --headless --path . --export-release "Linux" build/linux/O-Racer.x86_64
for p in windows linux; do
	for d in cars tracks wheels sounds; do
		[ -d ../web/$d ] && rsync -a --delete --exclude '.DS_Store' --exclude '*.import' --exclude '*.zip' --exclude '*.py' ../web/$d/ build/$p/web/$d/
	done
	(cd build && rm -f O-Racer-$p.zip && zip -qr O-Racer-$p.zip $p)
done
ls -la build/windows build/linux
du -sh build/O-Racer-*.zip
