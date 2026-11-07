// The window of the game: a WKWebView that loads the game from the LocalServer.
import AppKit
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var server: LocalServer!

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let root = WebRoot.locate() else {
            fatal("The folder of the game (web/) is not found. Build the app with scripts/build-app.sh, or set OPENRACER_WEB to the web folder.")
            return
        }

        server = LocalServer(root: root)
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

        webView = WKWebView(frame: .zero, configuration: config)
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
        guard let url = URL(string: "http://127.0.0.1:\(port)/index.html") else { return }
        webView.load(URLRequest(url: url))
    }

    @objc private func reload(_ sender: Any?) { webView.reloadFromOrigin() }

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

        // Copy and paste in the text fields of the editors need the Edit menu
        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
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
