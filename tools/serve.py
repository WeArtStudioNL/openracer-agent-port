#!/usr/bin/env python3
"""Local web server for OpenRacer: serves the game and gives it (and the car editor) a small API.

  GET    /api/cars                      the cars: every web/cars/<id>/car.json, with its id
  GET    /api/tracks                    the tracks: every web/tracks/<id>/track.json, with its id
  PUT    /api/cars/<id>/<file>          writes a file of a car (car.json, the model, textures); local connections only
  DELETE /api/cars/<id>                 removes a car; local connections only
  DELETE /api/cars/<id>/<file>          removes one file of a car (the old model when it is replaced); local connections only
  PUT    /api/tracks/<id>/<file>        the same for a track (track.json, the model, textures; <file> may be images/<name>)
  DELETE /api/tracks/<id>[/<file>]      removes a track, or one file of it
  PUT    /api/objects/<file>            writes a file of the library of models of the track editor (web/objects/: a glb, its picture, objects.json); local connections only
  DELETE /api/objects/<file>            removes one of them
  GET    /api/convert                   {"ffmpeg": true} when ffmpeg is installed here
  POST   /api/convert/mp4               a video (webm) in the body, the same video as mp4 (H.264) back, made by ffmpeg; local connections only

New cars and tracks are found by looking at the folders, so a folder with a car.json or track.json that is put in
web/cars or web/tracks shows up in the game at once. The lists are also written to cars/index.json and
tracks/index.json, for when the game is served by a plain web server without this API.

Usage: tools/serve.py [port] [--local] [--https]   (default port 8000; the server is reachable on the local network, --local keeps it to this computer). Nothing is cached, so a refresh shows the latest files.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web")
ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
FILE_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$")
MAX_UPLOAD = 8 * 1024 * 1024 * 1024  # 8 GB: a file is streamed to disk in pieces, so its size costs no memory


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
        if "/api/" in str(args[0] if args else ""):
            super().log_message(fmt, *args)

    def send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def is_local(self):
        """A request from this machine, to this machine's own name, from a page of this server: the API writes and deletes files, so a
        web page of someone else (DNS rebinding makes a name of theirs point at 127.0.0.1) must not be able to use it."""
        if self.client_address[0] not in ("127.0.0.1", "::1", "::ffff:127.0.0.1"):
            return False
        raw = self.headers.get("Host") or ""
        host = raw[:raw.find("]") + 1] if raw.startswith("[") else raw.rsplit(":", 1)[0]
        if host not in ("localhost", "127.0.0.1", "[::1]"):
            return False
        origin = self.headers.get("Origin")
        if origin and (urlparse(origin).hostname or "") not in ("localhost", "127.0.0.1", "::1"):
            return False
        return True

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/cars":
            return self.send_json(scan("cars", "car.json"))
        if path == "/api/tracks":
            return self.send_json(scan("tracks", "track.json"))
        if path == "/api/convert":
            return self.send_json({"ffmpeg": shutil.which("ffmpeg") is not None})
        return super().do_GET()

    def do_POST(self):
        if urlparse(self.path).path != "/api/convert/mp4" or not self.is_local():
            return self.send_json({"error": "not allowed"}, 403)
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            return self.send_json({"error": "ffmpeg is not installed"}, 501)
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self.send_json({"error": "bad length"}, 400)
        if length <= 0 or length > MAX_UPLOAD:
            return self.send_json({"error": "bad length"}, 400)
        with tempfile.TemporaryDirectory() as folder:
            source, target = os.path.join(folder, "in.webm"), os.path.join(folder, "out.mp4")
            with open(source, "wb") as f:
                left = length
                while left > 0:
                    chunk = self.rfile.read(min(1024 * 1024, left))
                    if not chunk:
                        break
                    f.write(chunk)
                    left -= len(chunk)
            # H.264 in a mp4 that plays everywhere: even sizes, yuv420p, the index at the front
            command = [ffmpeg, "-y", "-loglevel", "error", "-i", source, "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx264", "-preset", "veryfast",
                       "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-c:a", "aac", "-b:a", "160k", target]
            try:
                done = subprocess.run(command, capture_output=True, timeout=1800)
            except subprocess.TimeoutExpired:
                return self.send_json({"error": "ffmpeg took too long"}, 504)
            if done.returncode != 0 or not os.path.isfile(target):
                return self.send_json({"error": "ffmpeg failed: " + done.stderr.decode("utf-8", "replace")[-300:]}, 500)
            size = os.path.getsize(target)
            self.send_response(200)
            self.send_header("Content-Type", "video/mp4")
            self.send_header("Content-Length", str(size))
            self.end_headers()
            with open(target, "rb") as f:
                shutil.copyfileobj(f, self.wfile)

    def object_path(self, parts):
        """web/objects/<file> for ["api", "objects", "<file>"], or None: only models (glb), pictures (webp, png) and the list (objects.json), no folders."""
        if len(parts) != 3 or parts[1] != "objects":
            return None
        name = parts[2]
        if not FILE_PATTERN.match(name) or name.startswith("."):
            return None
        if not (name == "objects.json" or name.lower().endswith((".glb", ".webp", ".png"))):
            return None
        return os.path.join(ROOT, "objects", name)

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
        target = self.object_path(parts) or self.item_path(parts)
        if target is None or (len(parts) < 4 and parts[1] != "objects"):
            return self.send_json({"error": "bad path"}, 400)
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self.send_json({"error": "bad length"}, 400)
        if length < 0:
            return self.send_json({"error": "bad length"}, 400)
        if length > MAX_UPLOAD:
            return self.send_json({"error": "file too large"}, 413)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        written = 0
        with open(target, "wb") as f:
            while written < length:
                chunk = self.rfile.read(min(1024 * 1024, length - written))
                if not chunk:
                    break
                f.write(chunk)
                written += len(chunk)
        if parts[-1] in ("car.json", "track.json") and len(parts) == 4:
            write_indexes()
        self.send_json({"ok": True, "bytes": written})

    def do_DELETE(self):
        parts = unquote(urlparse(self.path).path).strip("/").split("/")
        if parts[:1] != ["api"] or not self.is_local():
            return self.send_json({"error": "not allowed"}, 403)
        library = self.object_path(parts)
        if library is not None:
            if not os.path.isfile(library):
                return self.send_json({"error": "no such file"}, 404)
            os.remove(library)
            return self.send_json({"ok": True})
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


CERT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".certs")


def make_certificate(ip):
    """A certificate for https on this computer (localhost, 127.0.0.1 and its address on the network), kept in tools/.certs. mkcert makes one that the browser trusts, when it is
    installed (mkcert -install once); otherwise it is a self-signed one made with openssl, which the browser warns about once. Gives (certificate, key)."""
    import shutil
    import subprocess
    os.makedirs(CERT_DIR, exist_ok=True)
    cert, key, stamp = [os.path.join(CERT_DIR, n) for n in ("cert.pem", "key.pem", "for.txt")]
    names = ["localhost", "127.0.0.1", "::1"] + ([ip] if ip else [])
    wanted = ",".join(names)
    if os.path.exists(cert) and os.path.exists(key) and os.path.exists(stamp) and open(stamp).read() == wanted:
        return cert, key
    if shutil.which("mkcert"):
        subprocess.run(["mkcert", "-cert-file", cert, "-key-file", key] + names, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        kind = "mkcert"
    else:
        if not shutil.which("openssl"):
            raise SystemExit("https needs openssl (or mkcert) to make a certificate.")
        config = os.path.join(CERT_DIR, "openssl.cnf")
        alt = ",".join(("IP:" + n) if n.replace(".", "").isdigit() or ":" in n else ("DNS:" + n) for n in names)
        with open(config, "w") as f:
            f.write("[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=OpenRacer (local)\n[ext]\nsubjectAltName=" + alt + "\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n")
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "825", "-config", config], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        kind = "self-signed"
    with open(stamp, "w") as f:
        f.write(wanted)
    print("Made a certificate (%s) for %s" % (kind, wanted))
    return cert, key


class SecureServer(ThreadingHTTPServer):
    """https where the handshake is made in the thread of the connection, not in the loop that accepts them: a browser opens connections in advance that say nothing for a long
    time (and a computer that cannot finish a handshake), and a handshake in the accepting loop made the whole server wait for them: the page kept loading."""
    context = None

    def get_request(self):
        return self.socket.accept()

    def process_request_thread(self, request, client_address):
        import ssl
        try:
            request.settimeout(15)
            request = self.context.wrap_socket(request, server_side=True)
            request.settimeout(None)
        except (ssl.SSLError, OSError):
            self.shutdown_request(request)
            return
        super().process_request_thread(request, client_address)


def network_address():
    """The address of this machine on the local network (the one that other devices use), or None"""
    import socket
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))          # (nothing is sent: it only tells which network card would be used)
            ip = s.getsockname()[0]
        return None if ip.startswith("127.") else ip
    except OSError:
        return None


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    local_only = "--local" in sys.argv[1:]
    secure = "--https" in sys.argv[1:]
    scheme = "https" if secure else "http"
    port = int(args[0]) if args else 8000
    write_indexes()
    print("Serving %s at %s://localhost:%d (Ctrl+C to stop)" % (ROOT, scheme, port))
    if local_only:
        print("Only this computer can reach it (--local).")
    else:
        ip = network_address()
        if ip:
            print("On your network (a phone, a tablet, another computer): %s://%s:%d" % (scheme, ip, port))
        print("The others can play and read; only this computer can save cars and tracks to the folders (the others keep them in their own browser).")
    address = ("127.0.0.1" if local_only else "", port)
    if secure:
        import ssl
        cert, key = make_certificate(None if local_only else network_address())
        server = SecureServer(address, Handler)
        server.context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        server.context.load_cert_chain(cert, key)
        print("https: the browser warns once about the certificate (it is made here, not by an authority): choose to go on. With mkcert installed (mkcert -install) there is no warning.")
    else:
        server = ThreadingHTTPServer(address, Handler)
    server.serve_forever()
