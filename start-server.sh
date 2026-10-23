#!/usr/bin/env bash
# Serves the OpenRacer web app locally and opens it in the default browser.
# Usage: ./start-server.sh [port] [--local] [--https]   (default port: 8000)
# --https serves with a certificate that is made here (tools/.certs): the browser warns once; with mkcert installed there is no warning.
# The game is also served on the local network (the address is printed: a phone or another computer can open it);
# --local keeps it to this computer. Only this computer can save cars and tracks to the folders.
set -euo pipefail

PORT=8000
LOCAL=""
SCHEME="http"
SECURE=""
for arg in "$@"; do
    case "$arg" in
        --local) LOCAL="--local" ;;
        --https) SECURE="--https"; SCHEME="https" ;;
        [0-9]*) PORT="$arg" ;;
    esac
done
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/web"
URL="${SCHEME}://localhost:${PORT}"

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
echo "Files are read from disk on every request and never cached: after a git pull, just refresh the page."
echo "Car editor: $URL/tools/car-editor.html"
# A plain static server that tells the browser never to cache, plus the API for the car and track lists and the car editor
exec python3 "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tools/serve.py" "$PORT" $LOCAL $SECURE
