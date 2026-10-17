#!/usr/bin/env bash
# Serves the OpenRacer web app locally and opens it in the default browser.
# Usage: ./start-server.sh [port]   (default port: 8000)
set -euo pipefail

PORT="${1:-8000}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/web"
URL="http://localhost:${PORT}"

if ! command -v python3 >/dev/null 2>&1; then
    echo "python3 is required (macOS: brew install python)." >&2
    exit 1
fi

# Open the browser shortly after the server starts (macOS: open, Linux: xdg-open)
(
    sleep 1
    if command -v open >/dev/null 2>&1; then open "$URL"
    elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1
    fi
) &

echo "Serving $ROOT at $URL (Ctrl+C to stop)"
cd "$ROOT"
exec python3 -m http.server "$PORT"
