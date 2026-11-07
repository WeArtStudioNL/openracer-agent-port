#!/usr/bin/env bash
# Makes the DMG of OpenRacer for openracer.eu and itch.io: archive, sign with Developer ID, notarize at Apple, staple, disk image.
# Usage: macos/scripts/make-dmg.sh            (the result: macos/build/release/OpenRacer-<version>.dmg)
#
# Signing and notarizing go through the Apple account that is signed in in Xcode (Settings → Accounts), with "cloud signing":
# Xcode signs with the Developer ID certificate of the team that Apple keeps, so no certificate needs to be on this Mac, and no
# password or API key is asked. The account has to be the Account Holder or an Admin of the team (HNQM5R9NGR in macos/team.local).
#
# The app in the DMG is notarized and stapled, so Gatekeeper opens it without a warning, also without internet. The DMG itself
# is not signed (cloud signing only signs apps); a downloaded DMG then shows no warning of its own, only the app is checked.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$HERE/build/release"
VERSION="$(sed -n 's/^OpenRacer\.VERSION *= *"\([^"]*\)".*/\1/p' "$HERE/../web/js/Version.js")"
TEAM="${OPENRACER_TEAM_ID:-$(tr -d '[:space:]' < "$HERE/team.local" 2>/dev/null || true)}"
[[ -n "$TEAM" ]] || { echo "No team: put the team ID in macos/team.local" >&2; exit 1; }

rm -rf "$OUT"
mkdir -p "$OUT"
"$HERE/scripts/generate-project.sh"

echo "== Archive (Release, universal)"
xcodebuild -project "$HERE/OpenRacer.xcodeproj" -scheme OpenRacer -configuration Release \
    -archivePath "$OUT/OpenRacer.xcarchive" -allowProvisioningUpdates archive | grep -E "error:|ARCHIVE" || true
[[ -d "$OUT/OpenRacer.xcarchive" ]] || { echo "The archive failed" >&2; exit 1; }

options() {   # $1: export (sign only) or upload (sign and send to the notary service of Apple)
    cat > "$OUT/ExportOptions-$1.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
	<key>method</key><string>developer-id</string>
	<key>signingStyle</key><string>automatic</string>
	<key>teamID</key><string>$TEAM</string>
	<key>destination</key><string>$1</string>
</dict></plist>
EOF
    echo "$OUT/ExportOptions-$1.plist"
}

echo "== Sign with Developer ID and send to Apple for notarization"
xcodebuild -exportArchive -archivePath "$OUT/OpenRacer.xcarchive" -exportPath "$OUT/upload" \
    -exportOptionsPlist "$(options upload)" -allowProvisioningUpdates | grep -E "error:|EXPORT|Uploaded" || true

echo "== Wait for the notarization (usually a few minutes)"
for i in $(seq 1 60); do
    if xcodebuild -exportNotarizedApp -archivePath "$OUT/OpenRacer.xcarchive" -exportPath "$OUT/notarized" > "$OUT/notarized.log" 2>&1; then
        break
    fi
    [[ $i -eq 60 ]] && { echo "Not notarized after 30 minutes: see $OUT/notarized.log" >&2; exit 1; }
    sleep 30
done
APP="$OUT/notarized/OpenRacer.app"
xcrun stapler validate "$APP"
spctl -a -t exec -vv "$APP"

echo "== Disk image"
STAGE="$OUT/dmg"
mkdir -p "$STAGE"
ditto "$APP" "$STAGE/OpenRacer.app"
ln -s /Applications "$STAGE/Applications"
DMG="$OUT/OpenRacer-$VERSION.dmg"
hdiutil create -volname "OpenRacer $VERSION" -srcfolder "$STAGE" -fs HFS+ -format ULFO -ov "$DMG" > /dev/null
rm -rf "$STAGE"
shasum -a 256 "$DMG" | tee "$DMG.sha256"
echo "OpenRacer $VERSION: $DMG ($(du -h "$DMG" | cut -f1))"
