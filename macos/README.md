# OpenRacer for macOS

A native macOS app of OpenRacer, given out as a DMG (openracer.eu, itch.io), signed with Developer ID and notarized: an AppKit window with a `WKWebView` that plays the game of `../web`, served by a small HTTP server inside the app on `127.0.0.1`. The plan, the choices and what is still to be done are in [`../MACOS-PORT.md`](../MACOS-PORT.md).

**State: phases 1 and 2.** The game runs in the app, with the API of `tools/serve.py` (the cars and tracks of the player are kept in Application Support). The app has no sandbox (it is not for the App Store) but the hardened runtime. Measurements and the plan for Metal and the DMG: [`../MACOS-METAL.md`](../MACOS-METAL.md).

## Requirements

- macOS 13 or newer, Xcode 15 or newer.
- [XcodeGen](https://github.com/yonaskolb/XcodeGen): `brew install xcodegen`.
- For the DMG: membership of the Apple Developer Program, the ID of the team (developer.apple.com → Membership) and a *Developer ID Application* certificate.

## The Xcode project

The project is made from `project.yml` and is not in git. Once, put the team ID in `macos/team.local` (one line; it is not in git), then:

    macos/scripts/generate-project.sh
    open macos/OpenRacer.xcodeproj

The script takes the version from `web/js/Version.js` and uses the number of commits as the build number, so every upload has a higher one. Run it again after a new commit or when a Swift file is added.

- **Run**: ⌘R.
- **A DMG**: `macos/scripts/make-dmg.sh`. It archives, signs with Developer ID, has Apple notarize the app, staples the ticket and makes `macos/build/release/OpenRacer-<version>.dmg` with its SHA-256. Signing and notarizing go through the Apple account signed in in Xcode (cloud signing): no certificate on this Mac, no password. By hand: Product → Archive → *Distribute App* → *Direct Distribution*.

While developing, the app can serve the folder of the repository directly, so a change to the JavaScript only needs a reload (⌘R in the debug build's View menu): in Xcode, Edit Scheme → Run → Arguments → Environment Variables, `OPENRACER_WEB` = the full path of `web/`. In a debug build the page can be inspected with Safari's Web Inspector (Develop menu → the name of the Mac → OpenRacer).

## Quickly, without Xcode

    macos/scripts/build-app.sh            # release; or: debug
    open macos/build/OpenRacer.app

A universal binary with `web/` in it, signed ad hoc and without the sandbox: only for trying it on this Mac. Or `cd macos && OPENRACER_WEB="$PWD/../web" swift run`.

## Layout

| File | What it is |
|---|---|
| `project.yml` | the Xcode project (XcodeGen): target, signing, hardened runtime, the folder `web/` as a resource |
| `Package.swift` | the same sources as a Swift package, for `swift run` and `build-app.sh` |
| `Sources/OpenRacer/main.swift` | the start of the app |
| `Sources/OpenRacer/AppDelegate.swift` | the window, the web view, the menu, the linked folder, where `web/` is found |
| `Sources/OpenRacer/LocalServer.swift` | the HTTP server on loopback (port 47185): static files with Range and no caching, and the API of `tools/serve.py` |
| `Sources/OpenRacer/Library.swift` | where cars, tracks and objects are: the player's (Application Support), a linked folder, the game; the paths of the API |
| `Sources/OpenRacer/WebKitFeatures.swift` | features of WebKit set by name: the refresh rate of the screen instead of 60 fps |
| `Sources/OpenRacer/Profiler.swift` | debug builds only: measures where the time of a frame goes (`OPENRACER_PROFILE=<seconds>`, see `../MACOS-METAL.md`) |
| `Sources/OpenRacer/WebViewHandlers.swift` | downloads, file pickers, alert/confirm/prompt, links to other sites |
| `Resources/Info.plist` | the bundle: version, category, local network (multiplayer later), export compliance |
| `Resources/OpenRacer.entitlements` | empty on purpose: no sandbox, no exceptions of the hardened runtime |
| `Resources/Assets.xcassets` | the app icon (AppIcon), every size made from `icon_1024.png` |
| `Resources/PrivacyInfo.xcprivacy` | the privacy manifest that the App Store asks for (no tracking, no data collected) |
| `scripts/generate-project.sh` | makes `OpenRacer.xcodeproj` with the version, the build number and the team |
| `scripts/make-dmg.sh` | the DMG for openracer.eu and itch.io: Developer ID, notarized, stapled |
| `scripts/build-app.sh` | makes `build/OpenRacer.app` without Xcode |

## Where the player's files are

Cars, tracks and objects that are saved in the app (the car editor, the tuning menu, the track editor) are in
`~/Library/Application Support/OpenRacer/` (File → Show My Cars and Tracks in Finder).
A car there with the id of a car of the game replaces it; deleting it brings back the one of the game.

