#!/usr/bin/env bash
# Builds OpenRacer.app (macOS): compiles the Swift package and puts the game (../web) in the bundle.
# Usage: macos/scripts/build-app.sh [debug|release]   (default: release). The app is made in macos/build/OpenRacer.app.
# Needs Xcode or the Command Line Tools (swift). Not signed: see MACOS-PORT.md, phase 4.
set -euo pipefail

CONFIG="${1:-release}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
OUT="$HERE/build/OpenRacer.app"

if [[ "$(uname)" != "Darwin" ]]; then
    echo "This builds a macOS app: run it on a Mac." >&2
    exit 1
fi

VERSION="$(sed -n 's/^OpenRacer\.VERSION *= *"\([^"]*\)".*/\1/p' "$REPO/web/js/Version.js")"
[[ -n "$VERSION" ]] || { echo "No version found in web/js/Version.js" >&2; exit 1; }

echo "Building OpenRacer $VERSION ($CONFIG)"
swift build --package-path "$HERE" -c "$CONFIG" --arch arm64 --arch x86_64
BIN="$(swift build --package-path "$HERE" -c "$CONFIG" --arch arm64 --arch x86_64 --show-bin-path)/OpenRacer"

rm -rf "$OUT"
mkdir -p "$OUT/Contents/MacOS" "$OUT/Contents/Resources"
cp "$BIN" "$OUT/Contents/MacOS/OpenRacer"
sed "s/__VERSION__/$VERSION/g" "$HERE/Resources/Info.plist" > "$OUT/Contents/Info.plist"

# The game: everything of web/ except the tools of development (the editors in web/tools stay: they are part of the game)
rsync -a --delete \
    --exclude '.DS_Store' --exclude '.htaccess' --exclude '__pycache__' \
    "$REPO/web/" "$OUT/Contents/Resources/web/"

# Ad-hoc signature, so that it starts on this Mac (Apple Silicon needs a signature)
codesign --force --sign - "$OUT"

echo "Done: $OUT"
echo "Start it with: open \"$OUT\""
