# macOS native port: plan

Voorbereiding van een native macOS-app van OpenRacer. Opgesteld op 7 november 2026, bij versie 2.5.0. Het skelet staat in `macos/` (zie `macos/README.md`).

## Besluiten (7 november 2026)

| Vraag | Besluit | Gevolg |
|---|---|---|
| Distributie | **Mac App Store**, testen met **TestFlight** | sandbox verplicht; een Xcode-project (archiveren en uploaden); entitlements en een privacy manifest; ffmpeg valt af |
| Minimale macOS | **macOS 13 Ventura** | `GCRacingWheel` (Game Controller) is beschikbaar als alternatief voor HID |
| Lokaal netwerk | **ja**, voor peer-to-peer multiplayer later | `NSLocalNetworkUsageDescription`, Bonjour (`_openracer._tcp`), de server moet later ook op het netwerk kunnen luisteren |
| Developer-account | **ja**, op de Mac van Glenn | signing via Xcode (automatic), team-ID in `macos/team.local` |

## ⚠️ Eerst uitzoeken: GPLv3 en de App Store

OpenRacer staat onder **GPLv3**, en de code is niet alleen van Glenn: de fork is gebaseerd op [digi-chris/OpenRacer](https://github.com/digi-chris/OpenRacer) van Chris Barnard. De voorwaarden van de App Store (en TestFlight) leggen gebruiksbeperkingen op die volgens de FSF botsen met de GPL (§10: geen verdere beperkingen opleggen). Daarom is bijvoorbeeld VLC in 2011 uit de App Store gehaald na een klacht van een van de auteurs.

Wat er kan:

1. **Toestemming van Chris Barnard** (en van iedere andere auteur van code die erin zit) voor een App Store-uitzondering, bij voorkeur als een *additional permission* onder GPLv3 §7 in de LICENSE. Dat is de gebruikelijke oplossing.
2. Alle code van Chris vervangen, zodat Glenn de enige auteur is en zelf een uitzondering kan geven. Veel werk en moeilijk te bewijzen.
3. Juridisch advies vragen.

Ook de modellen onder Creative Commons (`CREDITS.md`) moeten in een betaalde of gratis App Store-app mogen; een **NC-licentie** (niet-commercieel) of **ND** kan een probleem zijn. Dit sluit aan bij de TODO om die modellen te vervangen.

Dit blokkeert het bouwen en testen op de eigen Mac niet, wel het uploaden naar TestFlight. Ook een interne TestFlight-build gaat via Apple, dus de vraag moet beantwoord zijn vóór de eerste upload.

## Uitgangspunt

OpenRacer is een web-app: ongeveer 90 JavaScript-bestanden in `web/js` (three.js/WebGL, Web Audio met een AudioWorklet, een physics-worker), plus `tools/serve.py` voor de lijsten van auto's en banen en de schrijf-API van de editors. Een herschrijving naar Swift/Metal zou de hele game opnieuw maken en twee codebases opleveren. Dat doen we niet.

**Keuze: een Swift/AppKit-app met een `WKWebView`** die de map `web/` uit de app-bundle laadt, met native bruggen voor wat WebKit niet heeft. De game blijft één codebase; de browser-versie en de Mac-app lopen gelijk op.

| Optie | Voor | Tegen |
|---|---|---|
| WKWebView (gekozen) | klein (paar MB), echt native, Metal-backed WebGL, Game Controller-framework, past in de App Store | geen WebHID en geen File System Access: bruggen nodig |
| Electron | Chromium: WebHID en `showDirectoryPicker` werken meteen | ~200 MB, lastig door de App Store-review (private API's, sandbox), eigen update-traject |
| Tauri | klein | gebruikt op macOS ook WKWebView, dus dezelfde gaten, plus een Rust-laag |
| Volledige herschrijving (Swift/Metal) | maximale controle | jaren werk, twee codebases |

## Hoe de app de game serveert

De app start een **HTTP-server** (Network.framework, `NWListener`, een vrije poort) en laadt `http://127.0.0.1:<poort>/`. Waarom geen custom URL-scheme (`openracer://`):

- `127.0.0.1` is een *secure context*; een custom scheme niet zonder meer. De AudioWorklet (`EngineSimWorklet.js`), de clipboard-API en pointer lock hebben een secure context nodig.
- Workers, `audioWorklet.addModule`, `fetch` met `PUT`-body en relatieve URL's gedragen zich dan precies zoals in de browser.
- De server is een vertaling van `tools/serve.py`: dezelfde `api/...`-routes, dus de JS hoeft niet te weten dat hij in een app draait.
- Voor multiplayer is er later toch een netwerkserver nodig; dezelfde code kan dat.

Nu luistert de server alleen op loopback en controleert de `Host`-header. Voor multiplayer (fase 5) komt er een **tweede listener** op het lokale netwerk die alleen de multiplayer-routes heeft; de schrijf-API blijft alleen voor de eigen Mac.

In de sandbox heeft dit `com.apple.security.network.server` nodig (luisteren), en `network.client` (de webview zelf maakt de verbinding, ook naar 127.0.0.1).

## Waar de bestanden staan

De app-bundle is alleen-lezen en wordt bij een update vervangen. Daarom twee lagen:

- **Standaardset**: `OpenRacer.app/Contents/Resources/web/`.
- **Van de speler**: `Application Support/OpenRacer/{cars,tracks,objects}/`. In de sandbox is dat `~/Library/Containers/eu.openracer.OpenRacer/Data/Library/Application Support/OpenRacer/`; `FileManager` geeft het juiste pad.

`GET /api/cars` en `/api/tracks` voegen beide samen; een map van de speler wint bij hetzelfde id (net als de garage nu). `PUT`/`DELETE` schrijven alleen naar Application Support.

**Een map op de Mac koppelen** (nu `showDirectoryPicker` in Chrome): in de app een `NSOpenPanel`, met een *security-scoped bookmark* zodat de map na een herstart nog leesbaar is (`files.user-selected.read-write`, `files.bookmarks.app-scope`). De server leest die map als derde bron.

De opslag van de webview (localStorage, IndexedDB) staat in de container van de app en blijft bewaard. **Nog te controleren** op een echte Mac.

## Inventaris: browser-API's en wat er in WKWebView nodig is

Gevonden met grep in `web/` (versie 2.5.0).

| API | Waar | In WKWebView | Werk |
|---|---|---|---|
| WebGL (three.js) | overal | ja (op Metal) | testen: prestaties, shadows, tone mapping |
| Web Audio + AudioWorklet | `EngineSim.js`, `EngineSimWorklet.js` | ja (secure context) | testen: latency, glitches |
| Web Worker | `PhysicsLink.js`, `PhysicsWorker.js` | ja | testen |
| IndexedDB, localStorage | `Garage.js`, `Settings.js` e.a. | ja | nieuwe origin: overzetten met *Back up* / *Restore* |
| Gamepad API | `main.js`, `PadNav.js` | ja (via Game Controller) | testen: wielen worden niet altijd als gamepad gezien |
| `vibrationActuator` (rumble) | `ForceFeedback.js` | controleren | anders via de brug |
| **WebHID** (force feedback) | `ForceFeedback.js` | **nee** | **native brug** (fase 3) |
| **`showDirectoryPicker`** | `Garage.js` | **nee** | `NSOpenPanel` + bookmark (fase 2) |
| `navigator.storage.persist` | `main.js`, `Garage.js` | geen garantie | niet nodig in de app; melding in de UI aanpassen |
| Pointer lock | `FreeCam.js` | controleren | testen |
| Clipboard | `Settings.js`, `Replay.js` | ja | testen |
| `api/convert/mp4` (ffmpeg) | `Replay.js` | **nee** (de sandbox start geen ffmpeg) | `{"ffmpeg": false}`; later eventueel via AVFoundation als de opname al mp4 is (Safari's `MediaRecorder` kan mp4 maken) |
| Downloads (replay, zip) | `Replay.js`, `Garage.js` | ja (`WKDownloadDelegate`) | de download-delegate implementeren (fase 2) |
| Fullscreen | | | native: ⌃⌘F via `NSWindow` |

## Fasen

### Fase 0: voorbereiding (deze branch)
- Dit plan, en het skelet in `macos/`: een venster, een `WKWebView` en een statische loopback-server.
- Een Xcode-project via XcodeGen (`project.yml`), met sandbox, entitlements, privacy manifest, versie uit `Version.js` en een oplopend buildnummer.
- `scripts/build-app.sh` voor een snelle build zonder Xcode.

### Fase 1: de game draait
- Bouwen en starten op een Mac (universal binary), ook in de sandbox.
- Statische bestanden met MIME-types, `no-store` en `Range` (in het skelet).
- Zonder API valt `Catalog.js` terug op `cars/index.json` en `tracks/index.json`; de garage werkt via IndexedDB.
- Menubalk: About, Fullscreen, Quit, Reload (debug). Web Inspector in debug-builds.
- **App-icoon** (`Assets.xcassets`, 1024×1024): nodig voor TestFlight.
- **Eerste TestFlight-build** (intern), zodra de licentievraag beantwoord is.

### Fase 2: de API van serve.py
- `GET /api/cars`, `/api/tracks`; `/api/convert` geeft `{"ffmpeg": false}`.
- `PUT`/`DELETE /api/cars|tracks|objects/...` naar Application Support, met dezelfde padcontroles als `serve.py`. Request bodies lezen (nu nog 405).
- Een map koppelen (`NSOpenPanel`, bookmark); menu *Show my cars and tracks in Finder*.
- Downloads via `WKDownloadDelegate` naar Downloads.
- De editors testen.

### Fase 3: racewielen en force feedback
- Een JS-shim die het deel van `navigator.hid` nabootst dat `ForceFeedback.js` gebruikt (`requestDevice`, `getDevices`, `open`, `sendReport`, `sendFeatureReport`, `receiveFeatureReport`, `inputreport`, `connect`/`disconnect`), via `WKScriptMessageHandler` naar Swift. `ForceFeedback.js` blijft dan ongewijzigd.
- Swift-kant: `IOHIDManager`, filteren op de PID-usage page (0x0F) en de Logitech-ID's.
- **Sandbox-risico**: of `IOHIDDeviceOpen` en output reports in de sandbox werken met `device.usb`, of dat Input Monitoring nodig is, moet op een Mac worden getest. Alternatief: `GCRacingWheel` (Game Controller, macOS 13), dat Logitech-wielen ondersteunt maar mogelijk geen force feedback geeft. Dit is het grootste technische risico van de App Store-route: test het vroeg.
- Meten: een rapport per frame (60–144 Hz) door de brug.
- Testen met een PXN, Logitech G29/G923, Thrustmaster en Moza.

### Fase 4: App Store
- App Store Connect: de app aanmaken (bundle-ID `eu.openracer.OpenRacer`), TestFlight-groepen (intern, daarna extern met een beta-review).
- Screenshots, beschrijving, privacybeleid (een pagina op openracer.eu: er wordt niets verzameld), leeftijdsclassificatie, categorie *Games → Racing*.
- Release-stap: `generate-project.sh`, Archive, upload; buildnummer = aantal commits.

### Fase 5: multiplayer op het lokale netwerk
- Spelers vinden: Bonjour (`_openracer._tcp`) met `NWBrowser`/`NWListener`; macOS vraagt de speler één keer om toegang tot het lokale netwerk.
- Verbinding: WebSocket via `NWProtocolWebSocket` op de netwerk-listener, of WebRTC in de webview (de signalering via de server). Uit te werken in een eigen plan; de JS-kant (een andere auto van een andere speler, zoals een ghost of opponent) is het meeste werk.
- Ook de browser-versie kan zo meespelen, via `serve.py` met dezelfde routes.

## Nog open
- De licentievraag hierboven.
- Wie maakt het app-icoon?
- De naam in de App Store: "OpenRacer" kan al bezet zijn; controleren in App Store Connect.
