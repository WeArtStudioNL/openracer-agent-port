#!/usr/bin/env python3
"""Serves the web version of O-Racer (godot/build/web, made by tools/export_web.sh) on http://localhost:8060, with
the headers that the threads of the game need (cross-origin isolation: SharedArrayBuffer).

    python3 godot/tools/serve_web.py [port] [folder]

The server of openracer.eu must send the same two headers for the files of the game."""
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8060
ROOT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "build", "web")


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".wasm": "application/wasm", ".pck": "application/octet-stream"}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


if __name__ == "__main__":
    print("O-Racer web: http://localhost:%d (%s)" % (PORT, os.path.abspath(ROOT)))
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
