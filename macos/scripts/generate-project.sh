#!/usr/bin/env bash
# Makes macos/OpenRacer.xcodeproj from macos/project.yml (XcodeGen), with the version of the game, a build number and the team.
# Usage: macos/scripts/generate-project.sh
#   The team (for signing, TestFlight and the App Store) is the ID of your Apple Developer team (developer.apple.com → Membership).
#   Give it once in OPENRACER_TEAM_ID, or put it in macos/team.local (one line, not in git).
# Run it again after a change of the version, after a new commit (the build number), or when a file is added to Sources.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "$HERE/.." && pwd)"

command -v xcodegen >/dev/null 2>&1 || { echo "XcodeGen is needed: brew install xcodegen" >&2; exit 1; }

OPENRACER_VERSION="$(sed -n 's/^OpenRacer\.VERSION *= *"\([^"]*\)".*/\1/p' "$REPO/web/js/Version.js")"
[[ -n "$OPENRACER_VERSION" ]] || { echo "No version found in web/js/Version.js" >&2; exit 1; }

# Every upload to TestFlight needs a higher build number: the number of commits does that
OPENRACER_BUILD="$(git -C "$REPO" rev-list --count HEAD)"

if [[ -z "${OPENRACER_TEAM_ID:-}" && -f "$HERE/team.local" ]]; then
    OPENRACER_TEAM_ID="$(tr -d '[:space:]' < "$HERE/team.local")"
fi
if [[ -z "${OPENRACER_TEAM_ID:-}" ]]; then
    echo "Warning: no team (OPENRACER_TEAM_ID or macos/team.local): choose it in Xcode under Signing & Capabilities." >&2
fi

export OPENRACER_VERSION OPENRACER_BUILD OPENRACER_TEAM_ID="${OPENRACER_TEAM_ID:-}"
xcodegen generate --spec "$HERE/project.yml" --project "$HERE"
echo "OpenRacer $OPENRACER_VERSION (build $OPENRACER_BUILD): open macos/OpenRacer.xcodeproj"
