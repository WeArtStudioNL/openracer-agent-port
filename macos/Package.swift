// swift-tools-version:5.9
// The macOS app of OpenRacer: a window with a WKWebView that plays the game of ../web, served from a small HTTP server on 127.0.0.1.
// See ../MACOS-PORT.md for the plan and README.md for how to build it.
import PackageDescription

let package = Package(
    name: "OpenRacer",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "OpenRacer",
            path: "Sources/OpenRacer"
        )
    ]
)
