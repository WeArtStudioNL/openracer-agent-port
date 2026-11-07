# OpenRacer als native Mac-app op Metal: metingen en plan

Opgesteld op 7 november 2026, bij versie 2.5.0, op een MacBook Pro met Apple M5 (10 cores), scherm 3024×1964. Vervolg op [`MACOS-PORT.md`](MACOS-PORT.md).

## Samenvatting

1. **De Mac-app is niet de rem.** WebKit (WKWebView) tekent dezelfde scène sneller dan Chrome op dezelfde Mac. Beide draaien WebGL al via Metal.
2. **De grafische instellingen zijn de rem.** De game tekent standaard op de volle Retina-resolutie (2880×1684 in het venster), met de preset *high*. Dat is 20 fps. Met *low* op 720p is het een vaste 60 fps.
3. **De physics kost een vast deel**: 0,36–0,47 s CPU per seconde spel voor de Muscle (met 3 AI-auto's), alles op de hoofdthread. Op 60 fps is dat 6–8 ms per frame. Op de M5 past dat. Op een tragere Mac, of met meer auto's, wordt het de volgende rem.
4. **WKWebView houdt de game op 60 fps**, ook op een 120 Hz-scherm. Chrome haalt 109 fps met *low*.
5. **Een DMG buiten de App Store lost de GPL-vraag op.** De App Store-voorwaarden botsen met GPLv3; een eigen DMG (Developer ID, genotariseerd) niet. Dan is de toestemming van Chris niet nodig om te verspreiden. Wil je later toch naar de App Store, dan is er ~330 regels code van Chris te vervangen (zie onder).

Advies: **eerst de goedkope winst** (fase M1: standaardinstellingen en resolutie, 120 Hz), **dan de WebGPU-renderer van three.js** (fase M2, echt Metal zonder WebGL-laag), **dan de physics-kern in WebAssembly** (fase M3). Een volledige herbouw in Swift/Metal (fase M5) pas als de metingen na M2 en M3 dat nog nodig maken.

## Metingen

Gemeten met de profiler in de debug-build (`macos/Sources/OpenRacer/Profiler.swift`): de game start direct een race, de AI rijdt de auto van de speler (de autopilot van na de finish, op volle snelheid), na 5 s opwarmen wordt 10–20 s gemeten. Per frame: de tijd tussen twee frames (*interval*), de CPU-tijd van een frame op de hoofdthread, en daarvan de physics van de speler en de AI-auto's.

    OPENRACER_PROFILE=20 OPENRACER_QUERY="car=openracer-muscle&track=desert&ai=3&laps=0" \
      macos/build/dd/Build/Products/Debug/OpenRacer.app/Contents/MacOS/OpenRacer
    # met OPENRACER_PROFILE_JS='OpenRacer.Graphics.applyPreset("low");' voor een andere preset

### Rijden (Muscle op Desert, ~130 km/h, gemiddelden in ms)

| Situatie | Canvas | Interval | fps | CPU-frame | Physics speler | AI-auto's |
|---|---|---|---|---|---|---|
| Race, 3 AI, standaardpreset | 2880×1684 | 69,5 | 14 | 42,9 | 26,3 | 7,0 |
| Alleen, standaardpreset | 2880×1684 | 49,6 | 20 | 24,0 | 19,7 | 0,3 |
| Alleen, *low* | 1231×720 | 16,9 | 59 | 9,0 | 6,7 | 0,1 |
| Race, 3 AI, *low* | 1231×720 | 19,0 | 53 | 14,0 | 7,5 | 2,7 |
| Hatchback, Short track, *low* | 1231×720 | 16,7 | 60 | 5,2 | 2,5 | – |

De physics per frame groeit mee met de lengte van een frame (meer speltijd per frame). De vaste maat is de kosten per seconde spel: 360–470 ms voor de Muscle, 170 ms voor de Hatchback. Bij een trage frame grijpt `simLimit` in (main.js): het spel loopt dan in slow motion.

### Alleen tekenen (spel gepauzeerd, geen physics; interval in ms)

Elke test apart, niets anders op de GPU.

| Preset | Mac-app (WebKit) | Chrome 156 (ANGLE op Metal) |
|---|---|---|
| *low*, 720p | 17,3 (vast op 60 fps) | 9,2 (109 fps) |
| *low*, volle resolutie | 17,9 | 33,5 |
| *high*, volle resolutie | 50,0 | 74,5 |
| *ultra*, volle resolutie | 85,9 | 228,2 |

- De CPU-tijd van het tekenen is klein (2 ms in de app, 7–20 ms in Chrome): de GPU is de grens.
- *High* tegen *low* op dezelfde resolutie kost 3× zoveel GPU-tijd. Uit losse tests: anti-aliasing (`gfxAA` 4 → 0) scheelt een derde, de reflecties elke frame weinig.
- Tijdens het rijden kost *low* op volle resolutie 54 ms, tegen 18 ms stilstaand. Wat beweegt kost dus veel meer: stof en rook op het zand (overdraw op 4,8 miljoen pixels), de schaduwkaart, de bandensporen. Nog uit te zoeken per onderdeel.

Losse cijfers en hoe het gemeten is: dit bestand, en de commit met `Profiler.swift`. Chrome is gemeten met dezelfde code, in de console geplakt, met `tools/serve.py`.

### Wat dat betekent

- **Retina-resolutie is de grootste kostenpost.** Een Mac-scherm heeft 4–5 miljoen pixels in een venster. De game tekent alles op volle dichtheid. Games op de Mac tekenen meestal op een lagere resolutie en schalen op (MetalFX, of zelf).
- **De physics is goed genoeg voor de M5, niet voor een M1 met 8 AI-auto's.** Elke AI-auto kost ongeveer 1 ms per frame op 60 fps, en alles staat op één core.
- **WebKit tegen Chrome:** WebKit is hier sneller op de GPU. Een overstap naar Electron/Chromium levert niets op.

## De code van Chris (inventaris, 7 november 2026)

Uitgezocht met `git blame -w -M -C` over alle bestanden behalve `web/js/three/` en `web/js/rapier/`. Chris (*ChrisB* 2015, *digi-chris* 2020) heeft regels in 38 bestanden, ~4440 in totaal, maar het meeste is dood of boilerplate.

| Soort | Regels | Wat |
|---|---|---|
| Logica die nog draait | ~330 | `Scene.js` ~100 (camera, lichten, renderer, resize, de lus `render()`), `Car.js` ~80 (stuurinvoer, ronden en checkpoints, velden), `Telemetry.js` 55 (de hele klasse), `Helpers.js` ~30 (`debugOut`, `getSign`, `air_density`), `MaterialLibrary.js` ~15 (waarschijnlijk uit het three.js-voorbeeld, MIT), `Wheel.js` ~12, globals in `TrackLoader.js` ~10 |
| Slapend | ~145 | `TrackLoader.js` 77–243: de lader van het oude JSON-baanformaat (HelloRacer). Geen meegeleverde baan gebruikt het; de track editor kan het nog lezen (`track-editor.js:1198`) |
| Triviaal | ~470 | 16 GPL-headers met zijn naam, accolades, lege regels, mesh-boilerplate, `index.html` (head, CSS, globals) |
| Dood | ~2840 + 5 afbeeldingen | `web/scene/test_scene.js`, `web/scene/pressure.json`, `web/models/{mustang,vanq,55buickSpecia2l}.json`, `nbproject/`, `build.xml`, `src/conf/MANIFEST.MF`, vijf ongebruikte afbeeldingen in `web/images` (~2,9 MB) |
| Asset in gebruik | 1 | `web/models/mustang_wheel.json`: `DEFAULT_WHEEL` (`CarLoader.js:47`), het wiel van een auto zonder eigen wielen. Een nieuw model nodig |

Werk, van groot naar klein: `Scene.js` herschrijven (M: de globals `scene`, `camera`, `renderer`, `composer`, `render` worden overal gebruikt, de namen blijven), het oude baanformaat schrappen of een eigen lader schrijven, `Car.js` stuur- en rondelogica (S–M), `Telemetry.js` (S), een eigen standaardwiel. Schatting: 2–4 dagen. Een jurist moet bevestigen dat herschrijven genoeg is (structuur kan ook meetellen). Dit is alleen nodig voor de App Store, niet voor een DMG.

## Plan: de DMG-app op Metal

### Verspreiding: DMG naast (of in plaats van) de App Store

| | DMG (Developer ID) | Mac App Store |
|---|---|---|
| GPLv3 | geen probleem (bron is openbaar) | uitzondering nodig (Chris, of zijn code vervangen) |
| Sandbox | niet verplicht | verplicht |
| Force feedback via HID | eenvoudig (`IOHIDManager`) | onzeker in de sandbox (fase 3 van MACOS-PORT) |
| mp4 van replays | kan (AVFoundation, of ffmpeg meeleveren) | alleen AVFoundation |
| Updates | zelf: Sparkle | via de App Store |
| Nodig | certificaat *Developer ID Application* (nu alleen *Apple Development*), notarisatie (`notarytool`), `stapler` | de app in App Store Connect (bestaat) |

Beide kunnen uit hetzelfde Xcode-project: twee build-configuraties (`AppStore` met sandbox, `Direct` zonder sandbox, met hardened runtime). Het script `macos/scripts/make-dmg.sh` bouwt, ondertekent, notariseert en maakt de DMG.

### Fase M1: de goedkope winst (dagen)

- **Resolutie**: standaard niet de volle Retina-dichtheid. Een render-schaal (bijvoorbeeld 1440p of 0,6× in een venster) met opschalen. Op Apple Silicon later **MetalFX** (fase M2), nu een scherpe bilineaire of FSR1-achtige pass (de *sharpen*-pass bestaat al).
- **Dynamische resolutie**: de schaal omlaag als een frame te lang duurt, omhoog als er ruimte is (de interval-meting zit al in `render()`).
- **Standaardpreset per apparaat**: *medium* met een schaal, niet *high* op volle resolutie.
- **Anti-aliasing**: de duurste losse optie. Goedkopere AA (FXAA/SMAA) op een lagere resolutie in plaats van 4×.
- **Stof en rook**: overdraw meten en beperken (half-resolutie deeltjes, minder lagen).
- **120 Hz**: WKWebView gaf in alle metingen hooguit 60 fps (interval 16,7 ms), ook op het 120 Hz-scherm. Uitzoeken of dat met een openbare instelling omhoog kan. Een privé-instelling van WebKit kan niet in de App Store, wel in de DMG.
- **De meting in CI-vorm**: de profiler met vaste scenario's als regressietest per release.

### Fase M2: Metal direct, met de WebGPU-renderer van three.js (weken)

WebGPU in WKWebView (macOS 26) gaat rechtstreeks naar Metal, zonder de vertaling van WebGL. three.js heeft een `WebGPURenderer` met automatische terugval op WebGL2 (voor macOS 13–15).

- three.js 0.187 staat in `web/js/three/build/` zonder de WebGPU-build: `three.webgpu.js` toevoegen.
- Het werk zit in de eigen shaders: 17 plekken in 15 bestanden met `ShaderMaterial` of `onBeforeCompile` (onder meer `SoftBodyMesh.js` voor de vervorming van de carrosserie, `Graphics.js` met de G-buffer en SSGI, `Atmosphere.js`, `Smoke.js`, `TyreDeform.js`). Die gaan naar TSL (de node-shaders van three.js). De post-processing (`EffectComposer`) gaat naar `PostProcessing` van three.js.
- Per stap te meten met de profiler; de browser-versie krijgt het tegelijk (Chrome en Safari hebben WebGPU).
- Daarna mogelijk: compute shaders voor deeltjes (stof, rook) op de GPU, en MetalFX-opschaling via een native brug (alleen in de app).

### Fase M3: de physics-kern in WebAssembly (weken)

Zoals BeamNG: de node-beam-kern native, de rest van de logica in een scripttaal.

- Alleen de hete kern: de banden van nodes en de schil (`SoftBody.js`, de bandmodellen; 80 % van een physics-stap volgens `PHYSICS-WORKER.md`). In C++ of Rust, naar WebAssembly met SIMD. Aandrijflijn, AI, HUD blijven JavaScript.
- Eerst één functie als proef (de substep van een band), met een vergelijking op 15 cijfers zoals in `PHYSICS-WORKER.md`.
- Daarna in de physics-worker (bestaat al als studie, `PhysicsLink.js`), en meerdere auto's tegelijk op meerdere cores. WebAssembly-threads hebben `SharedArrayBuffer` nodig, en dus de headers COOP/COEP: `LocalServer.swift` en `serve.py` kunnen die sturen.
- Werkt in de browser en in de app: één codebase.

### Fase M4: de DMG uitbrengen (dagen)

**Stand 7 november 2026:** `macos/scripts/make-dmg.sh` werkt. De eerste DMG (2.5.0, 152 MB, universal) is getekend met *Developer ID Application: Glenn Hofman (HNQM5R9NGR)*, genotariseerd en gestapled. Als download getest (met quarantainevlag): Gatekeeper accepteert de app. Er is **geen certificaat op de Mac nodig**: Xcode tekent en notariseert via het ingelogde account (cloud signing). De DMG zelf is niet getekend (cloud signing tekent alleen apps), dat hoeft niet voor Gatekeeper. Nog te doen: Sparkle, en een eerste test op een andere Mac.

Oorspronkelijk plan:

- Certificaat *Developer ID Application* aanmaken (developer.apple.com, Certificates). Niet nodig gebleken: cloud signing.
- Build-configuratie `Direct`: hardened runtime, geen sandbox, `IOHIDManager` voor force feedback (fase 3 van MACOS-PORT wordt dan eenvoudiger).
- `make-dmg.sh`: archive, export met Developer ID, `notarytool submit --wait`, `stapler staple`, `hdiutil create`.
- Sparkle voor updates, met een appcast op openracer.eu.

### Fase M5: volledig native (alleen als M1–M3 niet genoeg zijn)

De echte BeamNG-opbouw in de app: een Metal-renderer in Swift, de physics native (C++), en de spellogica in JavaScript via **JavaScriptCore** zonder webview (zoals LuaJIT bij BeamNG). JavaScriptCore roept native code synchroon aan (anders dan een WKWebView, die alleen asynchrone berichten heeft), dus physics in C++ per substep kan. De menu's en de HUD blijven HTML in een webview erover.

Wat het kost: three.js valt weg, dus de hele scène, de materialen, de glTF-lader en de editors krijgen een eigen versie. De browser-versie en de Mac-versie gaan uit elkaar. Maanden tot een jaar. Alleen doen als metingen na M2 en M3 laten zien dat de webview de grens is.

## Fase M1: wat er gedaan is (7 november 2026)

- **Geen App Store, een DMG**: de sandbox is uit het project (hardened runtime blijft aan, voor de notarisatie).
- **120 Hz**: de app zet de WebKit-instelling `PreferPageRenderingUpdatesNear60FPSEnabled` uit (`WebKitFeatures.swift`). *Low* op 720p rijdend: van 60 naar 105 fps.
- **Resolutie "Auto"** (`Graphics.js`, standaard in *medium*, *high* en *ultra*): de renderresolutie volgt de frames, tussen 720p en de dichtheid van het scherm, zodat de game boven 57 fps blijft. Bij ruimte (boven 83 fps, of drie seconden vast op de verversing van een 60 Hz-scherm) 10 % meer pixels; een stap omhoog die te traag blijkt wordt teruggedraaid. Minder pixels die niet helpen (de CPU is de grens) worden ook teruggedraaid. Ook in de browser.
- **Reflecties in *high* elke 8 frames** in plaats van elke frame (de cube camera tekent de scène zes keer per update). In een race met 3 AI-auto's op 720p was dat de grootste losse kostenpost: 27 → 48 fps. *Ultra* houdt elke frame.

Gemeten, *high*, Muscle op Desert tenzij anders vermeld:

| Situatie | Voor M1 | Na M1 | Resolutie (auto) | CPU-frame | Waarvan physics en AI |
|---|---|---|---|---|---|
| Race, 3 AI | 14 fps | 43 fps | 720p | 17,1 ms | 13,3 ms |
| Alleen | 20 fps | 69 fps | 800p | 8,4 ms | 6,3 ms |
| Hatchback, Short track | – | 76 fps | 968p | 4,6 ms | 2,0 ms |

In een race is nu de CPU de grens: de physics van vier auto's op één thread. Dat is fase M3. Nog open in M1: stof en rook (overdraw) meten, en de cijfers op een tragere Mac.

Let op: de instellingen worden bewaard. Wie *high* al had (met de oude waarden), staat nu op *Custom*; kies *High* opnieuw.

## Volgende stappen

1. De DMG op een andere Mac testen; dan op openracer.eu en itch.io (itch.io kan met `butler` worden geüpload).
2. M3: de physics-kern in WebAssembly (de grens in een race).
3. Sparkle voor updates.
3. Een proef met `WebGPURenderer` op één baan zonder eigen shaders, om de winst te meten voordat de shaders worden omgezet.
