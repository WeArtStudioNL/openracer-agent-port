// What a browser does on its own and a bare WKWebView does not (phase 2 of MACOS-PORT.md):
//   - downloads (<a download> of a replay, a zip of the garage, a photo, a ghost) go to the Downloads folder;
//   - <input type="file"> opens an Open panel (importing a zip, a ghost, a driver model, files of a track);
//   - alert(), confirm() and prompt() show a native alert (without this confirm() is always false);
//   - links to other sites (openracer.eu, Discord) open in the browser of the Mac, not in the window of the game.
import AppKit
import WebKit

final class WebViewHandlers: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    /// The origin of the game (http://127.0.0.1:<port>), set when the server is ready
    var origin: String = ""

    private func isGame(_ url: URL?) -> Bool {
        guard let url else { return true }
        switch url.scheme {
        case "blob", "data", "about": return true
        case "http", "https":
            guard let host = url.host, let port = url.port else { return false }
            return origin == "http://\(host):\(port)"
        default: return false
        }
    }

    // MARK: - Navigation

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, preferences: WKWebpagePreferences,
                 decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void) {
        if action.shouldPerformDownload { return decisionHandler(.download, preferences) }
        if let url = action.request.url, !isGame(url) {
            if action.navigationType == .linkActivated || action.targetFrame?.isMainFrame != false {
                if ["http", "https", "mailto"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
                return decisionHandler(.cancel, preferences)
            }
        }
        decisionHandler(.allow, preferences)
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
        if !response.canShowMIMEType || disposition.lowercased().hasPrefix("attachment") {
            return decisionHandler(.download)
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

    /// The web content process ended (a crash, or macOS took its memory): load the game again instead of showing a white window
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }

    // MARK: - Downloads

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let folder = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first!
        completionHandler(Self.freeName(in: folder, for: suggestedFilename.isEmpty ? "openracer-download" : suggestedFilename))
    }

    func downloadDidFinish(_ download: WKDownload) {
        // the Downloads stack in the Dock bounces, as it does for Safari
        if let path = download.progress.fileURL?.path {
            DistributedNotificationCenter.default().post(name: .init("com.apple.DownloadFileFinished"), object: path)
        }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        NSLog("OpenRacer: a download failed: \(error.localizedDescription)")
    }

    /// name.ext, or name 2.ext, name 3.ext … when it is there already
    static func freeName(in folder: URL, for name: String) -> URL {
        let safe = name.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-")
        let base = (safe as NSString).deletingPathExtension, ext = (safe as NSString).pathExtension
        var url = folder.appendingPathComponent(safe)
        var n = 2
        while FileManager.default.fileExists(atPath: url.path) {
            url = folder.appendingPathComponent(ext.isEmpty ? "\(base) \(n)" : "\(base) \(n).\(ext)")
            n += 1
        }
        return url
    }

    // MARK: - UI: new windows, file pickers, dialogs

    /// window.open and target="_blank": a page of the game (an editor) opens in this window, anything else in the browser of the Mac
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url {
            if isGame(url), url.scheme == "http" { webView.load(action.request) } else if ["http", "https"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
        }
        return nil
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        if let window = webView.window {
            panel.beginSheetModal(for: window) { completionHandler($0 == .OK ? panel.urls : nil) }
        } else {
            completionHandler(panel.runModal() == .OK ? panel.urls : nil)
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        let alert = Self.alert(message)
        alert.addButton(withTitle: "OK")
        run(alert, in: webView) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (Bool) -> Void) {
        let alert = Self.alert(message)
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        run(alert, in: webView) { completionHandler($0 == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        let alert = Self.alert(prompt)
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 300, height: 24))
        field.stringValue = defaultText ?? ""
        alert.accessoryView = field
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        alert.window.initialFirstResponder = field
        run(alert, in: webView) { completionHandler($0 == .alertFirstButtonReturn ? field.stringValue : nil) }
    }

    private static func alert(_ message: String) -> NSAlert {
        let alert = NSAlert()
        alert.messageText = "OpenRacer"
        alert.informativeText = message
        return alert
    }

    private func run(_ alert: NSAlert, in webView: WKWebView, done: @escaping (NSApplication.ModalResponse) -> Void) {
        if let window = webView.window { alert.beginSheetModal(for: window, completionHandler: done) } else { done(alert.runModal()) }
    }
}
