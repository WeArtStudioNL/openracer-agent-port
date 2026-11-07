// Where the cars, tracks and objects (the library of the track editor) are, and how the API of tools/serve.py writes them in the app.
//
// Three layers, the first that has a file wins:
//   1. the player's: Application Support/OpenRacer/{cars,tracks,objects} (in the sandbox inside the container of the app); the API writes here only
//   2. a folder on the Mac that the player linked (File → Link a Folder…), read only, laid out like web/ (cars/<id>/car.json, tracks/<id>/track.json)
//   3. the game: Contents/Resources/web of the bundle, read only (it is replaced by an update)
//
// A car of the game that is saved from the car editor or the tuning menu is written to layer 1 and replaces the one of the game from then on;
// deleting it there brings back the one of the game. Only cars/, tracks/ and objects/ have layers: the code of the game (js, html, css) always
// comes from the bundle.
import Foundation

final class Library {
    static let idPattern = try! NSRegularExpression(pattern: "^[a-z0-9][a-z0-9_-]{0,63}$")
    static let filePattern = try! NSRegularExpression(pattern: "^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$")
    /// Files that a browser would run as a page or a script when they are served from here (as in serve.py): never written, never served from layers 1 and 2
    static let blockedExtensions: Set<String> = ["html", "htm", "xhtml", "shtml", "js", "mjs", "svg", "xml", "css", "php", "py", "sh"]
    static let configFile = ["cars": "car.json", "tracks": "track.json"]
    static let maxUpload: Int64 = 8 * 1024 * 1024 * 1024

    let bundle: URL
    let user: URL
    private let lock = NSLock()
    private var linkedFolder: URL?

    init(bundle: URL) {
        self.bundle = bundle.standardizedFileURL
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        user = support.appendingPathComponent("OpenRacer", isDirectory: true).standardizedFileURL
        for kind in ["cars", "tracks", "objects"] {
            try? FileManager.default.createDirectory(at: user.appendingPathComponent(kind), withIntermediateDirectories: true)
        }
    }

    var linked: URL? {
        get { lock.lock(); defer { lock.unlock() }; return linkedFolder }
        set { lock.lock(); linkedFolder = newValue?.standardizedFileURL; lock.unlock() }
    }

    /// The layers, the one that wins first
    private var layers: [URL] { [user] + (linked.map { [$0] } ?? []) + [bundle] }

    static func matches(_ regex: NSRegularExpression, _ s: String) -> Bool {
        regex.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil
    }

    static func isBlocked(_ name: String) -> Bool {
        blockedExtensions.contains((name as NSString).pathExtension.lowercased())
    }

    // MARK: - Reading

    /// The file for a path relative to web/ (already decoded, without a leading slash), or nil
    func resolve(_ relative: String) -> URL? {
        let first = relative.split(separator: "/", maxSplits: 1).first.map(String.init) ?? ""
        let layered = ["cars", "tracks", "objects"].contains(first) && !Self.isBlocked(relative)
        for base in layered ? layers : [bundle] {
            let url = base.appendingPathComponent(relative).standardizedFileURL
            guard url.path.hasPrefix(base.path + "/") else { return nil }
            var isDir: ObjCBool = false
            if FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir), !isDir.boolValue { return url }
        }
        return nil
    }

    /// The ids of the cars or tracks of all layers
    func ids(_ kind: String) -> [String] { configs(kind).map(\.id) }

    /// The JSON of GET /api/cars or /api/tracks: every config with its id, the one of the layer that wins
    func listJSON(_ kind: String) -> Data {
        var out = Data("[".utf8)
        for (i, item) in configs(kind).enumerated() {
            if i > 0 { out.append(Data(",\n".utf8)) }
            out.append(item.json)
        }
        out.append(Data("]".utf8))
        return out
    }

    /// The configs by id; the raw text of the file is kept (numbers stay as they are written), with "id" added at the end so it wins in JSON.parse
    private func configs(_ kind: String) -> [(id: String, json: Data)] {
        guard let file = Self.configFile[kind] else { return [] }
        var found: [String: Data] = [:]
        for base in layers.reversed() {
            let folder = base.appendingPathComponent(kind)
            guard let names = try? FileManager.default.contentsOfDirectory(atPath: folder.path) else { continue }
            for name in names where Self.matches(Self.idPattern, name) {
                let url = folder.appendingPathComponent(name).appendingPathComponent(file)
                guard let data = try? Data(contentsOf: url),
                      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let close = data.lastIndex(of: UInt8(ascii: "}")) else { continue }
                var json = Data(data[data.startIndex..<close])
                json.append(Data(((object.isEmpty ? "" : ",") + "\"id\":\"\(name)\"}").utf8))
                found[name] = json
            }
        }
        return found.keys.sorted().map { ($0, found[$0]!) }
    }

    // MARK: - The API paths (as item_path and object_path of serve.py)

    enum PathError: Error { case bad }

    /// Layer 1's file for ["cars"|"tracks", id, file...] or ["objects", file]; with only [kind, id] the folder of the item
    func userPath(_ parts: [String]) throws -> URL {
        guard let kind = parts.first else { throw PathError.bad }
        if kind == "objects" {
            guard parts.count == 2 else { throw PathError.bad }
            let name = parts[1]
            guard Self.matches(Self.filePattern, name), !name.hasPrefix("."),
                  name == "objects.json" || [".glb", ".webp", ".png"].contains(where: { name.lowercased().hasSuffix($0) }) else { throw PathError.bad }
            return user.appendingPathComponent("objects").appendingPathComponent(name)
        }
        guard kind == "cars" || kind == "tracks", parts.count >= 2, Self.matches(Self.idPattern, parts[1]) else { throw PathError.bad }
        let names = Array(parts.dropFirst(2))
        if names.count > (kind == "tracks" ? 2 : 1) { throw PathError.bad }
        if names.count == 2 && names[0] != "images" { throw PathError.bad }
        if let last = names.last, !Self.matches(Self.filePattern, last) || last.hasPrefix(".") { throw PathError.bad }
        return names.reduce(user.appendingPathComponent(kind).appendingPathComponent(parts[1])) { $0.appendingPathComponent($1) }
    }

    /// Whether the item is in a layer other than the player's (the game or the linked folder)
    func isShipped(_ kind: String, _ id: String) -> Bool {
        guard let file = Self.configFile[kind] else { return false }
        return layers.dropFirst().contains { FileManager.default.fileExists(atPath: $0.appendingPathComponent(kind).appendingPathComponent(id).appendingPathComponent(file).path) }
    }

    func hasUserCopy(_ kind: String, _ id: String) -> Bool {
        guard let file = Self.configFile[kind] else { return false }
        return FileManager.default.fileExists(atPath: user.appendingPathComponent(kind).appendingPathComponent(id).appendingPathComponent(file).path)
    }
}
