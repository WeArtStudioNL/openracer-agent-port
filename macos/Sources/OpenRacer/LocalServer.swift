// A small HTTP server on 127.0.0.1 that serves the files of the game, like tools/serve.py without its API (phase 1 of MACOS-PORT.md).
// It listens on loopback only, on a free port, answers GET and HEAD (with Range, for audio and video), and never lets the browser cache.
// Without api/cars and api/tracks, Catalog.js falls back on cars/index.json and tracks/index.json, and the garage keeps what the player
// makes in IndexedDB. Phase 2 adds the API of serve.py here.
import Foundation
import Network

final class LocalServer {
    private let root: URL
    private var listener: NWListener?
    private let queue = DispatchQueue(label: "openracer.server", attributes: .concurrent)
    private var port: UInt16 = 0

    init(root: URL) {
        self.root = root.standardizedFileURL
    }

    /// Starts listening; `ready` is called on the main queue with the port once the server accepts connections.
    func start(ready: @escaping (UInt16) -> Void) throws {
        let params = NWParameters.tcp
        params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        params.allowLocalEndpointReuse = true
        let listener = try NWListener(using: params)
        listener.stateUpdateHandler = { [weak self, weak listener] state in
            switch state {
            case .ready:
                guard let port = listener?.port?.rawValue else { return }
                self?.port = port
                DispatchQueue.main.async { ready(port) }
            case .failed(let error):
                NSLog("OpenRacer server failed: \(error)")
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

    private func accept(_ connection: NWConnection) {
        connection.start(queue: queue)
        receiveHead(connection, buffer: Data())
    }

    /// Reads until the end of the headers; a request body (PUT, POST) is not read yet: those are answered with 405 in phase 1.
    private func receiveHead(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            guard let self else { connection.cancel(); return }
            var buffer = buffer
            if let data { buffer.append(data) }
            if let end = buffer.range(of: Data("\r\n\r\n".utf8)) {
                let head = String(decoding: buffer[buffer.startIndex..<end.lowerBound], as: UTF8.self)
                self.handle(head: head, on: connection)
            } else if error != nil || isComplete || buffer.count > 64 * 1024 {
                connection.cancel()
            } else {
                self.receiveHead(connection, buffer: buffer)
            }
        }
    }

    private func handle(head: String, on connection: NWConnection) {
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

        guard method == "GET" || method == "HEAD" else {
            return respond(connection, status: 405, reason: "Method Not Allowed")
        }
        guard let file = resolve(target) else {
            return respond(connection, status: 404, reason: "Not Found")
        }
        serve(file, method: method, range: headers["range"], on: connection)
    }

    /// The file under the root for a request target, or nil when it is not there or lies outside the root.
    private func resolve(_ target: String) -> URL? {
        let pathPart = target.split(separator: "?", maxSplits: 1).first.map(String.init) ?? "/"
        guard let decoded = pathPart.removingPercentEncoding else { return nil }
        var relative = decoded.hasPrefix("/") ? String(decoded.dropFirst()) : decoded
        if relative.isEmpty || relative.hasSuffix("/") { relative += "index.html" }

        let url = root.appendingPathComponent(relative).standardizedFileURL
        guard url.path.hasPrefix(root.path + "/") else { return nil }

        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir) else { return nil }
        if isDir.boolValue {
            let index = url.appendingPathComponent("index.html")
            return FileManager.default.fileExists(atPath: index.path) ? index : nil
        }
        return url
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
