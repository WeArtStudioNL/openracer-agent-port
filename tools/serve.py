#!/usr/bin/env python3
"""Local web server for OpenRacer: serves the game and gives it (and the car editor) a small API.

  GET    /api/cars                      the cars: every web/cars/<id>/car.json, with its id
  GET    /api/tracks                    the tracks: every web/tracks/<id>/track.json, with its id
  PUT    /api/cars/<id>/<file>          writes a file of a car (car.json, the model, textures); local connections only
  DELETE /api/cars/<id>                 removes a car; local connections only
  DELETE /api/cars/<id>/<file>          removes one file of a car (the old model when it is replaced); local connections only
  PUT    /api/tracks/<id>/<file>        the same for a track (track.json, the model, textures; <file> may be images/<name>)
  DELETE /api/tracks/<id>[/<file>]      removes a track, or one file of it

New cars and tracks are found by looking at the folders, so a folder with a car.json or track.json that is put in
web/cars or web/tracks shows up in the game at once. The lists are also written to cars/index.json and
tracks/index.json, for when the game is served by a plain web server without this API.

Usage: tools/serve.py [port]   (default port 8000). Nothing is cached, so a refresh shows the latest files.
"""
import json
import os
import re
import shutil
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web")
ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
FILE_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$")
MAX_UPLOAD = 300 * 1024 * 1024


def scan(kind, config_name):
    """The folders in web/<kind> with a config file, as a list of the configs, each with its id."""
    base = os.path.join(ROOT, kind)
    found = []
    if not os.path.isdir(base):
        return found
    for name in sorted(os.listdir(base)):
        path = os.path.join(base, name, config_name)
        if not ID_PATTERN.match(name) or not os.path.isfile(path):
            continue
        try:
            with open(path, encoding="utf-8") as f:
                config = json.load(f)
        except (OSError, ValueError) as error:
            print("Skipping %s: %s" % (path, error))
            continue
        config["id"] = name
        found.append(config)
    return found


def write_indexes():
    for kind, config_name in (("cars", "car.json"), ("tracks", "track.json")):
        base = os.path.join(ROOT, kind)
        if os.path.isdir(base):
            ids = [config["id"] for config in scan(kind, config_name)]
            with open(os.path.join(base, "index.json"), "w", encoding="utf-8") as f:
                json.dump(ids, f, indent=1)
                f.write("\n")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        if "/api/" in (args[0] if args else ""):
            super().log_message(fmt, *args)

    def send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def is_local(self):
        return self.client_address[0] in ("127.0.0.1", "::1", "::ffff:127.0.0.1")

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/cars":
            return self.send_json(scan("cars", "car.json"))
        if path == "/api/tracks":
            return self.send_json(scan("tracks", "track.json"))
        return super().do_GET()

    def item_path(self, parts):
        """web/<cars|tracks>/<id>[/<file>] for the parts of an API path, or None if they are not valid.
        A file of a track may be in the folder images/ of the track."""
        if len(parts) < 3 or parts[1] not in ("cars", "tracks") or not ID_PATTERN.match(parts[2]):
            return None
        base = os.path.join(ROOT, parts[1], parts[2])
        names = parts[3:]
        if not names:
            return base
        if len(names) > (2 if parts[1] == "tracks" else 1):
            return None
        if len(names) == 2 and names[0] != "images":
            return None
        for name in names[-1:]:
            if not FILE_PATTERN.match(name) or name.startswith("."):
                return None
        return os.path.join(base, *names)

    def do_PUT(self):
        parts = unquote(urlparse(self.path).path).strip("/").split("/")
        if parts[:1] != ["api"] or not self.is_local():
            return self.send_json({"error": "not allowed"}, 403)
        target = self.item_path(parts)
        if target is None or len(parts) < 4:
            return self.send_json({"error": "bad path"}, 400)
        length = int(self.headers.get("Content-Length", "0"))
        if length > MAX_UPLOAD:
            return self.send_json({"error": "file too large"}, 413)
        data = self.rfile.read(length)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "wb") as f:
            f.write(data)
        if parts[-1] in ("car.json", "track.json") and len(parts) == 4:
            write_indexes()
        self.send_json({"ok": True, "bytes": len(data)})

    def do_DELETE(self):
        parts = unquote(urlparse(self.path).path).strip("/").split("/")
        if parts[:1] != ["api"] or not self.is_local():
            return self.send_json({"error": "not allowed"}, 403)
        target = self.item_path(parts)
        if target is not None and len(parts) >= 4:
            # one file; the configuration itself is only removed with the whole car or track
            if parts[-1] in ("car.json", "track.json") or not os.path.isfile(target):
                return self.send_json({"error": "no such file"}, 404)
            os.remove(target)
            return self.send_json({"ok": True})
        if target is None or len(parts) != 3 or not os.path.isdir(target):
            return self.send_json({"error": "no such " + parts[1][:-1]}, 404)
        shutil.rmtree(target)
        write_indexes()
        self.send_json({"ok": True})


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    write_indexes()
    print("Serving %s at http://localhost:%d (Ctrl+C to stop)" % (ROOT, port))
    ThreadingHTTPServer(("", port), Handler).serve_forever()
