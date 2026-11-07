# OpenRacer for macOS

The beginning of a native macOS app of OpenRacer: an AppKit window with a `WKWebView` that plays the game of `../web`, served by a small HTTP server inside the app on `127.0.0.1` (never on the network). The plan, the choices and what is still to be done are in [`../MACOS-PORT.md`](../MACOS-PORT.md).

**State: phase 0.** The skeleton has not been built on a Mac yet.

## Build

On a Mac with macOS 13 or newer and Xcode (or the Command Line Tools):

    macos/scripts/build-app.sh            # release; or: debug
    open macos/build/OpenRacer.app

The script compiles a universal binary (Apple Silicon and Intel), copies `web/` into `Contents/Resources/web`, takes the version from `web/js/Version.js` and signs the app ad hoc.

While developing, the app can serve the folder of the repository directly, so a change to the JavaScript only needs a reload (⌘R in a debug build):

    cd macos
    OPENRACER_WEB="$PWD/../web" swift run

Or open `Package.swift` in Xcode, and set `OPENRACER_WEB` in the scheme (Edit Scheme → Run → Arguments → Environment Variables). In a debug build the page can be inspected with Safari's Web Inspector (Develop menu → the name of the Mac → OpenRacer).

## Layout

| File | What it is |
|---|---|
| `Package.swift` | the Swift package (macOS 13+) |
| `Sources/OpenRacer/main.swift` | the start of the app |
| `Sources/OpenRacer/AppDelegate.swift` | the window, the web view, the menu, where `web/` is found |
| `Sources/OpenRacer/LocalServer.swift` | the HTTP server on loopback: static files with Range and no caching (the API of `tools/serve.py` follows in phase 2) |
| `Resources/Info.plist` | the bundle; `__VERSION__` is filled in by the build script |
| `scripts/build-app.sh` | makes `build/OpenRacer.app` |
