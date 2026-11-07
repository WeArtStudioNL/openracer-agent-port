// The window of the game: a WKWebView that loads the game from the LocalServer.
import AppKit
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var server: LocalServer!
    private var library: Library!
    private let handlers = WebViewHandlers()
    private let linkedFolder = LinkedFolder()
    #if DEBUG
    private let profiler = Profiler(environment: ProcessInfo.processInfo.environment)
    #endif

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let root = WebRoot.locate() else {
            fatal("The folder of the game (web/) is not found. Build the app with scripts/build-app.sh, or set OPENRACER_WEB to the web folder.")
            return
        }

        library = Library(bundle: root)
        library.linked = linkedFolder.restore()
        server = LocalServer(library: library)
        do {
            try server.start { [weak self] port in
                self?.load(port: port)
            }
        } catch {
            fatal("The local server could not start: \(error)")
            return
        }

        buildMenu()

        let config = WKWebViewConfiguration()
        config.mediaTypesRequiringUserActionForPlayback = []   // the engine sound starts without a click on the page
        config.websiteDataStore = .default()                   // localStorage and IndexedDB are kept (the garage, settings, records)
        WebKitFeatures.set("PreferPageRenderingUpdatesNear60FPSEnabled", false, in: config.preferences)   // the refresh rate of the screen, not 60

        #if DEBUG
        profiler?.install(in: config)
        #endif

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = handlers
        webView.uiDelegate = handlers
        #if DEBUG
        if #available(macOS 13.3, *) { webView.isInspectable = true }
        #endif

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "OpenRacer"
        window.collectionBehavior = [.fullScreenPrimary]
        window.contentView = webView
        window.center()
        window.setFrameAutosaveName("OpenRacerMain")
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ notification: Notification) { server?.stop() }

    private func load(port: UInt16) {
        handlers.origin = "http://127.0.0.1:\(port)"
        var page = "index.html"
        #if DEBUG
        if let profiler { page += "?" + profiler.query }
        #endif
        guard let url = URL(string: "http://127.0.0.1:\(port)/\(page)") else { return }
        webView.load(URLRequest(url: url))
    }

    @objc private func reload(_ sender: Any?) { webView.reloadFromOrigin() }

    // MARK: - Cars and tracks on the Mac

    @objc private func showLibrary(_ sender: Any?) {
        NSWorkspace.shared.activateFileViewerSelecting([library.user.appendingPathComponent("cars")])
    }

    @objc private func linkFolder(_ sender: Any?) {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Link"
        panel.message = "Choose a folder with cars/ and tracks/ in it (laid out like web/ of OpenRacer). The game reads it; it does not write to it."
        panel.beginSheetModal(for: window) { [weak self] response in
            guard let self, response == .OK, let url = panel.url else { return }
            self.library.linked = self.linkedFolder.link(url)
            self.webView.reload()
        }
    }

    @objc private func unlinkFolder(_ sender: Any?) {
        linkedFolder.unlink()
        library.linked = nil
        webView.reload()
    }

    private func buildMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About OpenRacer", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide OpenRacer", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit OpenRacer", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        main.addItem(appItem)

        let fileItem = NSMenuItem()
        let fileMenu = NSMenu(title: "File")
        fileMenu.addItem(withTitle: "Show My Cars and Tracks in Finder", action: #selector(showLibrary(_:)), keyEquivalent: "")
        fileMenu.addItem(.separator())
        fileMenu.addItem(withTitle: "Link a Folder with Cars and Tracks…", action: #selector(linkFolder(_:)), keyEquivalent: "")
        fileMenu.addItem(withTitle: "Unlink the Folder", action: #selector(unlinkFolder(_:)), keyEquivalent: "")
        fileMenu.addItem(.separator())
        fileMenu.addItem(withTitle: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        fileItem.submenu = fileMenu
        main.addItem(fileItem)

        // Copy and paste in the text fields of the editors need the Edit menu
        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu
        main.addItem(editItem)

        let viewItem = NSMenuItem()
        let viewMenu = NSMenu(title: "View")
        let fullscreen = NSMenuItem(title: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fullscreen.keyEquivalentModifierMask = [.control, .command]
        viewMenu.addItem(fullscreen)
        #if DEBUG
        viewMenu.addItem(withTitle: "Reload", action: #selector(reload(_:)), keyEquivalent: "r")
        #endif
        viewItem.submenu = viewMenu
        main.addItem(viewItem)

        let windowItem = NSMenuItem()
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowItem.submenu = windowMenu
        main.addItem(windowItem)
        NSApp.windowsMenu = windowMenu

        NSApp.mainMenu = main
    }

    private func fatal(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "OpenRacer cannot start"
        alert.informativeText = message
        alert.runModal()
        NSApp.terminate(nil)
    }
}

extension AppDelegate: NSMenuItemValidation {
    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        if item.action == #selector(unlinkFolder(_:)) {
            if let linked = library?.linked {
                item.title = "Unlink “\(linked.lastPathComponent)”"
                return true
            }
            item.title = "Unlink the Folder"
            return false
        }
        return true
    }
}

/// The folder that the player linked, kept as a security-scoped bookmark so the sandbox lets the app read it again after a restart
final class LinkedFolder {
    private let key = "LinkedFolderBookmark"
    private var current: URL?

    func restore() -> URL? {
        guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
        var stale = false
        guard let url = try? URL(resolvingBookmarkData: data, options: [.withSecurityScope], relativeTo: nil, bookmarkDataIsStale: &stale),
              url.startAccessingSecurityScopedResource() else {
            UserDefaults.standard.removeObject(forKey: key)
            return nil
        }
        if stale, let fresh = try? url.bookmarkData(options: [.withSecurityScope, .securityScopeAllowOnlyReadAccess]) {
            UserDefaults.standard.set(fresh, forKey: key)
        }
        current = url
        return url
    }

    func link(_ url: URL) -> URL? {
        unlink()
        guard let data = try? url.bookmarkData(options: [.withSecurityScope, .securityScopeAllowOnlyReadAccess]) else { return nil }
        UserDefaults.standard.set(data, forKey: key)
        return restore()
    }

    func unlink() {
        current?.stopAccessingSecurityScopedResource()
        current = nil
        UserDefaults.standard.removeObject(forKey: key)
    }
}

/// Where the files of the game are: in the bundle (Contents/Resources/web), or, while developing, the folder in OPENRACER_WEB.
enum WebRoot {
    static func locate() -> URL? {
        let fm = FileManager.default
        if let env = ProcessInfo.processInfo.environment["OPENRACER_WEB"] {
            let url = URL(fileURLWithPath: env, isDirectory: true)
            if fm.fileExists(atPath: url.appendingPathComponent("index.html").path) { return url }
        }
        if let res = Bundle.main.resourceURL?.appendingPathComponent("web", isDirectory: true),
           fm.fileExists(atPath: res.appendingPathComponent("index.html").path) {
            return res
        }
        return nil
    }
}
