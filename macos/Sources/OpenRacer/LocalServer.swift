// A small HTTP server on 127.0.0.1 that serves the game and the API of tools/serve.py (phase 2 of MACOS-PORT.md).
// It listens on loopback only, on a free port, and never lets the browser cache. The files of cars, tracks and objects come from the layers of
// Library (the player's, a linked folder, the game); PUT and DELETE of the API write only the player's layer, in Application Support.
// Not here: POST /api/convert/mp4 (the sandbox cannot start ffmpeg), so GET /api/convert says {"ffmpeg": false}.
import Foundation
import Network

final class LocalServer {
    let library: Library
    private var listener: NWListener?
    private let queue = DispatchQueue(label: "openracer.server", attributes: .concurrent)
    private var port: UInt16 = 0

    init(library: Library) {
        self.library = library
    }

    /// The port of the last start. The storage of the page (localStorage, IndexedDB: the garage, the settings, the records) belongs to its
    /// origin, and the port is part of that: so the server always takes the same port, and only another one (remembered from then on)
    /// when that one is taken.
    private static let portKey = "LocalServerPort"
    private static let defaultPort: UInt16 = 47_185

    /// Starts listening; `ready` is called on the main queue with the port once the server accepts connections.
    func start(ready: @escaping (UInt16) -> Void) throws {
        let saved = UserDefaults.standard.integer(forKey: Self.portKey)
        let wanted = (1024...65535).contains(saved) ? UInt16(saved) : Self.defaultPort
        try listen(on: NWEndpoint.Port(rawValue: wanted)!, ready: ready)
    }

    private func listen(on port: NWEndpoint.Port, ready: @escaping (UInt16) -> Void) throws {
        let params = NWParameters.tcp
        params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: port)
        let listener = try NWListener(using: params)
        listener.stateUpdateHandler = { [weak self, weak listener] state in
            switch state {
            case .ready:
                guard let port = listener?.port?.rawValue else { return }
                self?.port = port
                UserDefaults.standard.set(Int(port), forKey: Self.portKey)
                DispatchQueue.main.async { ready(port) }
            case .failed(let error), .waiting(let error):
                listener?.cancel()
                if port != .any {
                    NSLog("OpenRacer: port \(port) is taken (\(error)); another one is chosen and kept from now on")
                    try? self?.listen(on: .any, ready: ready)
                } else {
                    NSLog("OpenRacer server failed: \(error)")
                }
            default:
                break
            }
        }
        listener.newConnectionHandler = { [weak self] connection in
            self?.accept(connection)
        }
        listener.start(queue: queue)
        self.listener = listener
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    // MARK: - Connections

    private struct Request {
        let method: String
        let path: String          // decoded, without the query
        let headers: [String: String]
    }

    private func accept(_ connection: NWConnection) {
        connection.start(queue: queue)
        receiveHead(connection, buffer: Data())
    }

    /// Reads until the end of the headers; what came in after them is the start of the body
    private func receiveHead(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            guard let self else { connection.cancel(); return }
            var buffer = buffer
            if let data { buffer.append(data) }
            if let end = buffer.range(of: Data("\r\n\r\n".utf8)) {
                let head = String(decoding: buffer[buffer.startIndex..<end.lowerBound], as: UTF8.self)
                self.handle(head: head, rest: Data(buffer[end.upperBound...]), on: connection)
            } else if error != nil || isComplete || buffer.count > 64 * 1024 {
                connection.cancel()
            } else {
                self.receiveHead(connection, buffer: buffer)
            }
        }
    }

    private func handle(head: String, rest: Data, on connection: NWConnection) {
        let lines = head.components(separatedBy: "\r\n")
        let parts = (lines.first ?? "").split(separator: " ")
        guard parts.count >= 2 else { return respond(connection, status: 400, reason: "Bad Request") }
        let method = String(parts[0])
        let target = String(parts[1])

        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let colon = line.firstIndex(of: ":") else { continue }
            let name = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
            headers[name] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
        }

        // Only pages of this server itself: a web page elsewhere cannot reach it under another host name (DNS rebinding)
        let host = headers["host"] ?? ""
        guard host == "127.0.0.1:\(port)" || host == "localhost:\(port)" else {
            return respond(connection, status: 403, reason: "Forbidden")
        }

        let pathPart = target.split(separator: "?", maxSplits: 1).first.map(String.init) ?? "/"
        guard let path = pathPart.removingPercentEncoding else { return respond(connection, status: 400, reason: "Bad Request") }
        let request = Request(method: method, path: path, headers: headers)

        switch method {
        case "GET", "HEAD": get(request, on: connection)
        case "PUT": put(request, rest: rest, on: connection)
        case "DELETE": delete(request, on: connection)
        case "POST": json(connection, ["error": "converting to mp4 is not possible in the app"], status: 501)
        default: respond(connection, status: 405, reason: "Method Not Allowed")
        }
    }

    /// A write from a page of this server: the Origin, when there is one, is this server (the Host is checked already)
    private func fromThisServer(_ request: Request) -> Bool {
        guard let origin = request.headers["origin"] else { return true }
        return origin == "http://127.0.0.1:\(port)" || origin == "http://localhost:\(port)"
    }

    /// ["cars", "<id>", "<file>"] for /api/cars/<id>/<file>, or nil when the path is not one of the API
    private func apiParts(_ path: String) -> [String]? {
        let parts = path.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        guard parts.first == "api", parts.count >= 2 else { return nil }
        return Array(parts.dropFirst())
    }

    // MARK: - GET

    private func get(_ request: Request, on connection: NWConnection) {
        let head = request.method == "HEAD"
        switch request.path {
        case "/api/cars", "/api/tracks":
            return respond(connection, status: 200, reason: "OK", headers: ["Content-Type": "application/json"],
                           body: library.listJSON(String(request.path.dropFirst(5))), sendBody: !head)
        case "/api/convert":
            return json(connection, ["ffmpeg": false])
        case "/cars/index.json", "/tracks/index.json":
            let kind = String(request.path.dropFirst().split(separator: "/").first!)
            let data = (try? JSONSerialization.data(withJSONObject: library.ids(kind), options: [.prettyPrinted])) ?? Data("[]".utf8)
            return respond(connection, status: 200, reason: "OK", headers: ["Content-Type": "application/json; charset=utf-8"], body: data, sendBody: !head)
        default:
            break
        }
        if request.path.hasPrefix("/api/") { return json(connection, ["error": "no such thing"], status: 404) }

        var relative = request.path.hasPrefix("/") ? String(request.path.dropFirst()) : request.path
        if relative.isEmpty || relative.hasSuffix("/") { relative += "index.html" }
        guard let file = library.resolve(relative) ?? library.resolve(relative + "/index.html") else {
            return respond(connection, status: 404, reason: "Not Found")
        }
        serve(file, method: request.method, range: request.headers["range"], on: connection)
    }

    // MARK: - PUT (as do_PUT of serve.py)

    private func put(_ request: Request, rest: Data, on connection: NWConnection) {
        guard let parts = apiParts(request.path), fromThisServer(request) else {
            return json(connection, ["error": "not allowed"], status: 403)
        }
        guard let target = try? library.userPath(parts), parts[0] == "objects" || parts.count >= 3 else {
            return json(connection, ["error": "bad path"], status: 400)
        }
        if Library.isBlocked(target.lastPathComponent) {
            return json(connection, ["error": "this kind of file is not part of a car or a track"], status: 415)
        }
        guard let lengthText = request.headers["content-length"] else {
            return json(connection, ["error": "the length of the file is missing"], status: 411)
        }
        guard let length = Int64(lengthText), length >= 0 else { return json(connection, ["error": "bad length"], status: 400) }
        if length > Library.maxUpload { return json(connection, ["error": "file too large"], status: 413) }

        // written beside the old file, and put in its place when it is complete (an upload that breaks off leaves nothing half)
        let part = target.appendingPathExtension("part")
        do {
            try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
            FileManager.default.createFile(atPath: part.path, contents: nil)
            let handle = try FileHandle(forWritingTo: part)
            let first = rest.prefix(Int(min(Int64(rest.count), length)))
            try handle.write(contentsOf: first)
            receiveBody(connection, handle: handle, written: Int64(first.count), length: length) { [weak self] written in
                guard let self else { return }
                try? handle.close()
                guard written == length else {
                    try? FileManager.default.removeItem(at: part)
                    return self.json(connection, ["error": "the upload broke off (\(written) of \(length) bytes)"], status: 400)
                }
                // rename(2) puts it in place of the old file in one step, also when there is no old file
                if rename(part.path, target.path) == 0 {
                    self.json(connection, ["ok": true, "bytes": written])
                } else {
                    let reason = String(cString: strerror(errno))
                    try? FileManager.default.removeItem(at: part)
                    self.json(connection, ["error": "could not write the file: \(reason)"], status: 500)
                }
            }
        } catch {
            try? FileManager.default.removeItem(at: part)
            json(connection, ["error": "could not write the file: \(error.localizedDescription)"], status: 500)
        }
    }

    private func receiveBody(_ connection: NWConnection, handle: FileHandle, written: Int64, length: Int64, done: @escaping (Int64) -> Void) {
        if written >= length { return done(written) }
        let want = Int(min(length - written, 1024 * 1024))
        connection.receive(minimumIncompleteLength: 1, maximumLength: want) { [weak self] data, _, isComplete, error in
            var written = written
            if let data, !data.isEmpty {
                do { try handle.write(contentsOf: data) } catch { return done(written) }
                written += Int64(data.count)
            }
            if written >= length || error != nil || (isComplete && (data?.isEmpty ?? true)) { return done(written) }
            self?.receiveBody(connection, handle: handle, written: written, length: length, done: done)
        }
    }

    // MARK: - DELETE (as do_DELETE of serve.py, but only in the player's layer)

    private func delete(_ request: Request, on connection: NWConnection) {
        guard let parts = apiParts(request.path), fromThisServer(request) else {
            return json(connection, ["error": "not allowed"], status: 403)
        }
        guard let target = try? library.userPath(parts) else { return json(connection, ["error": "bad path"], status: 400) }
        let fm = FileManager.default

        if parts[0] == "objects" || parts.count >= 3 {
            // one file; the configuration itself is only removed with the whole car or track
            if parts.count >= 3 && Library.configFile.values.contains(parts.last!) { return json(connection, ["error": "no such file"], status: 404) }
            guard fm.fileExists(atPath: target.path) else { return json(connection, ["error": "no such file"], status: 404) }
            do { try fm.removeItem(at: target) } catch { return json(connection, ["error": error.localizedDescription], status: 500) }
            return json(connection, ["ok": true])
        }

        let kind = parts[0], id = parts[1], noun = String(kind.dropLast())
        guard library.hasUserCopy(kind, id) || fm.fileExists(atPath: target.path) else {
            if library.isShipped(kind, id) {
                return json(connection, ["error": "this \(noun) comes with the game (or the linked folder) and cannot be deleted from here"], status: 409)
            }
            return json(connection, ["error": "no such \(noun)"], status: 404)
        }
        do { try fm.removeItem(at: target) } catch { return json(connection, ["error": error.localizedDescription], status: 500) }
        json(connection, ["ok": true])
    }

    private func json(_ connection: NWConnection, _ object: [String: Any], status: Int = 200) {
        let body = (try? JSONSerialization.data(withJSONObject: object)) ?? Data("{}".utf8)
        let reasons = [200: "OK", 400: "Bad Request", 403: "Forbidden", 404: "Not Found", 409: "Conflict", 411: "Length Required",
                       413: "Payload Too Large", 415: "Unsupported Media Type", 500: "Internal Server Error", 501: "Not Implemented"]
        respond(connection, status: status, reason: reasons[status] ?? "Error", headers: ["Content-Type": "application/json"], body: body)
    }

    private func serve(_ file: URL, method: String, range: String?, on connection: NWConnection) {
        guard let data = try? Data(contentsOf: file, options: .mappedIfSafe) else {
            return respond(connection, status: 500, reason: "Internal Server Error")
        }
        var status = 200, reason = "OK"
        var body = data
        var extra: [String: String] = ["Accept-Ranges": "bytes"]

        if let range, let bytes = Self.parseRange(range, length: data.count) {
            status = 206; reason = "Partial Content"
            body = data.subdata(in: bytes.start..<(bytes.end + 1))
            extra["Content-Range"] = "bytes \(bytes.start)-\(bytes.end)/\(data.count)"
        } else if range != nil {
            extra["Content-Range"] = "bytes */\(data.count)"
            return respond(connection, status: 416, reason: "Range Not Satisfiable", headers: extra)
        }

        extra["Content-Type"] = MimeTypes.type(for: file.pathExtension)
        respond(connection, status: status, reason: reason, headers: extra, body: body, sendBody: method != "HEAD")
    }

    /// The first range of a `bytes=` header, as inclusive offsets.
    static func parseRange(_ header: String, length: Int) -> (start: Int, end: Int)? {
        guard length > 0, header.hasPrefix("bytes=") else { return nil }
        let spec = header.dropFirst(6).split(separator: ",").first.map { $0.trimmingCharacters(in: .whitespaces) } ?? ""
        let bounds = spec.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false).map(String.init)
        guard bounds.count == 2 else { return nil }
        if bounds[0].isEmpty {                          // bytes=-500: the last 500 bytes
            guard let suffix = Int(bounds[1]), suffix > 0 else { return nil }
            return (max(0, length - suffix), length - 1)
        }
        guard let start = Int(bounds[0]), start < length else { return nil }
        let end = bounds[1].isEmpty ? length - 1 : min(Int(bounds[1]) ?? -1, length - 1)
        return end >= start ? (start, end) : nil
    }

    private func respond(_ connection: NWConnection, status: Int, reason: String,
                         headers: [String: String] = [:], body: Data = Data(), sendBody: Bool = true) {
        var head = "HTTP/1.1 \(status) \(reason)\r\n"
        var all = headers
        all["Content-Length"] = String(body.count)
        all["Cache-Control"] = "no-store"
        all["Connection"] = "close"
        all["X-Content-Type-Options"] = "nosniff"
        for (name, value) in all { head += "\(name): \(value)\r\n" }
        head += "\r\n"

        var out = Data(head.utf8)
        if sendBody { out.append(body) }
        connection.send(content: out, completion: .contentProcessed { _ in connection.cancel() })
    }
}

enum MimeTypes {
    private static let types: [String: String] = [
        "html": "text/html; charset=utf-8",
        "js": "text/javascript; charset=utf-8",
        "mjs": "text/javascript; charset=utf-8",
        "css": "text/css; charset=utf-8",
        "json": "application/json; charset=utf-8",
        "txt": "text/plain; charset=utf-8",
        "md": "text/markdown; charset=utf-8",
        "svg": "image/svg+xml",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "gif": "image/gif",
        "webp": "image/webp",
        "ico": "image/x-icon",
        "hdr": "application/octet-stream",
        "glb": "model/gltf-binary",
        "gltf": "model/gltf+json",
        "bin": "application/octet-stream",
        "obj": "text/plain; charset=utf-8",
        "mtl": "text/plain; charset=utf-8",
        "wav": "audio/wav",
        "mp3": "audio/mpeg",
        "ogg": "audio/ogg",
        "m4a": "audio/mp4",
        "mp4": "video/mp4",
        "webm": "video/webm",
        "woff": "font/woff",
        "woff2": "font/woff2",
        "ttf": "font/ttf",
        "wasm": "application/wasm",
        "zip": "application/zip",
    ]

    static func type(for ext: String) -> String {
        types[ext.lowercased()] ?? "application/octet-stream"
    }
}
