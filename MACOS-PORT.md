# macOS native port: plan

Voorbereiding van een native macOS-app van OpenRacer. Opgesteld op 7 november 2026, bij versie 2.5.0. Het skelet staat in `macos/` (zie `macos/README.md`).

## Uitgangspunt

OpenRacer is een web-app: ongeveer 90 JavaScript-bestanden in `web/js` (three.js/WebGL, Web Audio met een AudioWorklet, een physics-worker), plus `tools/serve.py` voor de lijsten van auto's en banen en de schrijf-API van de editors. Een herschrijving naar Swift/Metal zou de hele game opnieuw maken en twee codebases opleveren. Dat doen we niet.

**Keuze: een Swift/AppKit-app met een `WKWebView`** die de map `web/` uit de app-bundle laadt, met native bruggen voor wat WebKit niet heeft. De game blijft één codebase; de browser-versie en de Mac-app lopen gelijk op.

Overwogen en afgevallen:

| Optie | Voor | Tegen |
|---|---|---|
| WKWebView (gekozen) | klein (paar MB), echt native, Metal-backed WebGL, Game Controller-framework | geen WebHID en geen File System Access: bruggen nodig |
| Electron | Chromium: WebHID en `showDirectoryPicker` werken meteen | ~200 MB, geen "native" app, eigen update-traject |
| Tauri | klein | gebruikt op macOS ook WKWebView, dus dezelfde gaten, plus een Rust-laag |
| Volledige herschrijving (Swift/Metal) | maximale controle | jaren werk, twee codebases |

Als de force feedback via de brug te veel latency blijkt te hebben (fase 3), is Electron het terugvalpad.

## Hoe de app de game serveert

De app start een **HTTP-server op 127.0.0.1** (Network.framework, `NWListener`, willekeurige vrije poort) en laadt `http://127.0.0.1:<poort>/`. Waarom geen custom URL-scheme (`openracer://`):

- `localhost`/`127.0.0.1` is een *secure context*; een custom scheme niet zonder meer. De AudioWorklet (`EngineSimWorklet.js`), de clipboard-API en pointer lock hebben een secure context nodig.
- Workers, `audioWorklet.addModule`, `fetch` met `PUT`-body en relatieve URL's gedragen zich dan precies zoals in de browser.
- De server is een vertaling van `tools/serve.py`: dezelfde `api/...`-routes, dus de JS hoeft niet te weten dat hij in een app draait.

De server luistert alleen op loopback (nooit op het netwerk) en controleert de `Host`-header.

## Waar de bestanden staan

De app-bundle is alleen-lezen en wordt bij een update vervangen. Daarom twee lagen:

- **Standaardset**: `OpenRacer.app/Contents/Resources/web/` (een kopie van `web/` bij het bouwen).
- **Van de speler**: `~/Library/Application Support/OpenRacer/{cars,tracks,objects}/`.

`GET /api/cars` en `/api/tracks` voegen beide samen; een map van de speler wint bij hetzelfde id (net als de garage nu). `PUT`/`DELETE` schrijven alleen naar Application Support. Een bestand wordt eerst in de map van de speler gezocht, dan in de bundle.

De opslag van de webview (localStorage, IndexedDB) staat in de container van de app en blijft bewaard: de zeven-dagenregel van Safari geldt voor websites, niet voor de standaard `WKWebsiteDataStore` van een app. **Nog te controleren** op een echte Mac.

## Inventaris: browser-API's en wat er in WKWebView nodig is

Gevonden met grep in `web/` (versie 2.5.0).

| API | Waar | In WKWebView | Werk |
|---|---|---|---|
| WebGL (three.js) | overal | ja (op Metal) | testen: prestaties, shadows, tone mapping |
| Web Audio + AudioWorklet | `EngineSim.js`, `EngineSimWorklet.js` | ja (secure context) | testen: latency, glitches |
| Web Worker | `PhysicsLink.js`, `PhysicsWorker.js` | ja | testen |
| IndexedDB, localStorage | `Garage.js`, `Settings.js` e.a. | ja | migratie: niets, het is een nieuwe origin (export/import via backup) |
| Gamepad API | `main.js`, `PadNav.js` | ja (via Game Controller) | testen: wielen worden niet altijd als gamepad gezien |
| `vibrationActuator` (rumble) | `ForceFeedback.js` | deels (macOS 13+?) | controleren, anders via de brug |
| **WebHID** (force feedback) | `ForceFeedback.js` | **nee** | **native brug** met IOHIDManager (fase 3) |
| **`showDirectoryPicker`** | `Garage.js` | **nee** | brug met `NSOpenPanel`, of verbergen: de app heeft al een eigen map |
| `navigator.storage.persist` | `main.js`, `Garage.js` | geeft geen garantie | niet nodig in de app; melding in de UI aanpassen |
| Pointer lock | `FreeCam.js` | ja (macOS 13+?) | testen |
| Clipboard | `Settings.js`, `Replay.js` | ja | testen |
| `api/convert/mp4` (ffmpeg) | `Replay.js` | n.v.t. | ffmpeg gebruiken als die er is, anders `{"ffmpeg": false}` (AVFoundation leest geen webm) |
| Fullscreen | | | native: het groene knopje en ⌃⌘F via `NSWindow` |

## Fasen

### Fase 0: voorbereiding (deze branch)
- Dit plan, en het skelet in `macos/`: een Swift Package met een venster, een `WKWebView` en een statische loopback-server.
- Een script dat `web/` in een `.app`-bundle zet.

### Fase 1: de game draait
- Bouwen en starten op een Mac (macOS 13 of nieuwer, Apple Silicon en Intel als universal binary).
- Statische bestanden serveren met de juiste MIME-types, `Cache-Control: no-cache` en `Range` (voor `<audio>`/`<video>` als die er zijn).
- Zonder API valt `Catalog.js` terug op `cars/index.json` en `tracks/index.json`; de garage werkt via IndexedDB. Dus de game is speelbaar met alleen de statische server.
- Menubalk: About (versie uit `web/js/Version.js`), Fullscreen, Quit, Reload (alleen in debug).
- Web Inspector aan in debug-builds (`isInspectable`).

### Fase 2: de API van serve.py
- `GET /api/cars`, `/api/tracks`, `/api/convert`.
- `PUT`/`DELETE /api/cars|tracks|objects/...` naar Application Support, met dezelfde padcontroles als `serve.py` (geen `..`, alleen bekende mappen).
- Menu *Open the folder of my cars and tracks* (Finder).
- Editors (`tools/car-editor.html`, `tools/track-editor.html`) testen.

### Fase 3: racewielen en force feedback
- Een JS-shim die het deel van `navigator.hid` nabootst dat `ForceFeedback.js` gebruikt (`requestDevice`, `getDevices`, `open`, `sendReport`, `sendFeatureReport`, `receiveFeatureReport`, `inputreport`, `connect`/`disconnect`), en via `WKScriptMessageHandler` naar Swift gaat. Dan blijft `ForceFeedback.js` ongewijzigd.
- Swift-kant: `IOHIDManager`, filteren op de PID-usage page (0x0F) en de Logitech-ID's, rapporten doorsturen.
- Meten: een rapport per frame (60–144 Hz) heen en weer door de brug. Als het te traag is: de force-berekening blijft in JS, maar het versturen gaat met een eigen thread in Swift.
- Rechten: Input Monitoring (TCC) kan nodig zijn om een HID-apparaat te openen; testen met een PXN, Logitech G29/G923, Thrustmaster en Moza.

### Fase 4: distributie
- Code signing met een Developer ID en notarization; hardened runtime.
- Sandbox: alleen als de HID-toegang en de loopback-server het toelaten (`com.apple.security.network.server`, `com.apple.security.device.usb`). Zonder App Store is sandboxing optioneel.
- Een `.dmg` en updates (Sparkle), en een build in de release-stappen.
- `CFBundleShortVersionString` gelijk aan `OpenRacer.VERSION`.
- Icoon (`.icns`) en de naam van de app.

## Open vragen voor Glenn
- Alleen buiten de App Store (Developer ID), of ook de Mac App Store? Dat bepaalt de sandbox.
- Minimale macOS-versie: voorstel macOS 13 Ventura.
- Moet de app ook de server voor het lokale netwerk kunnen zijn (telefoon als tweede scherm), zoals `start-server.sh`? Voorstel: nee, alleen loopback.
- Is er een Apple Developer-account voor signing en notarization?
