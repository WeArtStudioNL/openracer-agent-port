#!/usr/bin/env bash
# Builds OpenRacer.app (macOS) quickly without Xcode, to try it on this Mac: compiles the Swift package and puts the game (../web)
# in the bundle. It is signed ad hoc and without the sandbox. For TestFlight and the App Store use the Xcode project
# (scripts/generate-project.sh, then Product → Archive): see README.md.
# Usage: macos/scripts/build-app.sh [debug|release]   (default: release). The app is made in macos/build/OpenRacer.app.
# Needs Xcode or the Command Line Tools (swift).
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
sed -e "s/\$(MARKETING_VERSION)/$VERSION/g" \
    -e "s/\$(CURRENT_PROJECT_VERSION)/$(git -C "$REPO" rev-list --count HEAD)/g" \
    -e "s/\$(PRODUCT_BUNDLE_IDENTIFIER)/eu.openracer.OpenRacer/g" \
    "$HERE/Resources/Info.plist" > "$OUT/Contents/Info.plist"
cp "$HERE/Resources/PrivacyInfo.xcprivacy" "$OUT/Contents/Resources/"

# The game: everything of web/ except the tools of development (the editors in web/tools stay: they are part of the game)
rsync -a --delete \
    --exclude '.DS_Store' --exclude '.htaccess' --exclude '__pycache__' \
    "$REPO/web/" "$OUT/Contents/Resources/web/"

# Ad-hoc signature, so that it starts on this Mac (Apple Silicon needs a signature)
codesign --force --sign - "$OUT"

echo "Done: $OUT"
echo "Start it with: open \"$OUT\""
