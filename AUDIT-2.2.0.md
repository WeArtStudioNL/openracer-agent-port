# Audit OpenRacer 2.2.0 (branch claude/soft-body)

- Datum: 30 oktober 2026
- Repo: `openracer-softbody`, branch `claude/soft-body`, 528 commits voor op `master`, plus een vuile working tree.
- Hoe:
  - zes reviewers, elk op een eigen gebied (physics, race en HUD, menu's en UI, input/audio/replay, editors en server, docs en release);
  - daarna heb ik zelf in de browser gespeeld (desktop en 375 px mobiel) en de zwaarste punten in de code nagelezen.
- Status: er is niets aangepast of gecommit. Dit bestand is het enige nieuwe bestand.

In de lijsten staat **✔** voor een bevinding die ik zelf in de browser of in de code heb bevestigd. Een punt zonder ✔ komt uit een review die de code naleest. Bij de physics zijn de belangrijkste punten met node-scripts nagerekend. **(?)** betekent: waarschijnlijk, maar eerst in het spel testen.

---

## 0. Samenvatting

Wat goed werkt:
- De game laadt zonder JS-fouten.
- De nieuwe menu-flow is duidelijk.
- Het soft body blijft stabiel tot 100 m/s, zonder NaN en zonder door muren te schieten.
- Het parsen van replay-bestanden is robuust.
- Het loskoppelen van een pad of stuur midden in een race wordt goed afgehandeld.
- `serve.py` is dicht tegen path traversal.

**Zo kan 2.2.0 niet live.** De blokkers zitten vooral in de git-staat en de assets, niet in de code:

1. De gecommitte staat is kapot. Drie auto's, twee banen en diverse modellen staan niet in git (§1).
2. De cache-buster staat nog op `?v=2.1.0`. Terugkerende spelers kunnen dan een mix van oude en nieuwe scripts krijgen (§1).
3. Race-modus op Circuit, de standaardbaan, wordt stilletjes free drive: geen tegenstanders en geen aftelling (§2).
4. De rondetelling klopt niet in races. De speler rijdt een stuk verder dan de AI, en een reset kost een hele ronde (§2).
5. Er zijn twee XSS-lekken via namen van geïmporteerde banen. Eén ervan zit in de car-editor, die lokaal schrijfrechten op de server heeft (§2).
6. `CREDITS.md` vermeldt alleen de Supermoto. Van de meeste nieuwe modellen ontbreekt de licentie, en TT Assen en Kartbaan Oldenzaal zijn echte locaties (§5).
7. `docs.html` is grotendeels verouderd: Mustang, oude menu's, oude toetsen en geen 2.2.0-changelog (§5).

---

## 1. Release-blokkers: git, assets en deploy

| # | Probleem | Waar | Oplossing |
|---|---|---|---|
| 1.1 ✔ | De gecommitte `cars/index.json` is `["mustang"]` en `tracks/index.json` is `["circuit"]`. Lokaal staan er 7 auto's en 6 banen in. | `web/cars/index.json`, `web/tracks/index.json` | Committen. Kijk ook naar de deploy: daar zijn de index-bestanden uitgesloten, dus live moeten ze met de hand worden bijgewerkt. |
| 1.2 ✔ | Deze staan niet in git: `openracer-kart`, `openracer-muscle`, `sports-motorcycle-600cc`, `kartbaan-oldenzaal`, `tt-assen`, `web/objects/`, `images/flames/flame1-3.png`, `wheels/rims/17-203-rim.glb`, `wheels/tyres/17-203-tyre.glb` en de `preview.webp`-bestanden van de banen. | working tree | Expliciet toevoegen, of uit de index halen wat niet mee moet. |
| 1.3 ✔ | Gecommitte auto's verwijzen naar bestanden die niet in git staan: `stadium-truck/car.json` naar `Trophy Truck.glb`, `go-kart-250cc` naar `cars/openracer-kart/driver.glb`, en de i30 lokaal naar `hyundai i30 new.glb`. | car.json | Samen committen met 1.2. |
| 1.4 ✔ | `index.html` laadt `bootstrap.js?v=2.1.0` terwijl `VERSION = "2.2.0"`. Alle scripts erven die `?v=`. | `web/index.html:49` | Op `?v=2.2.0` zetten. Dat hoort al bij de vaste release-stap. |
| 1.5 ✔ | `web/sounds/tyre-squeal.wav` en `web/tracks/openracer-test-track` zijn symlinks naar `openracer-agent-port`. `rsync -az` zonder `-L` zet live een dode link neer. | `web/sounds`, `web/tracks` | Het echte .wav-bestand kopiëren en committen. De testbaan uit de lokale index houden. |
| 1.6 ✔ | Nog niet gecommitte verwijderingen: `mustang`, `drift-mustang` en `honda-cbr600`. `--delete` haalt ze live ook weg, en oude replays en links met `?car=mustang` werken dan niet meer. | working tree | Bewust beslissen, en dit in de changelog zetten onder "Removed". |
| 1.7 ✔ | Dode ballast in de deploy: `hyundai i30.glb` (54,8 MB, ongebruikt), `hyundai-i30-placeholder.glb`, `stadium-truck/stadium-truck.glb` en `web/test-old.tmp`. | | Weghalen. Daarmee scheelt het ongeveer 55 MB. |
| 1.8 ✔ | Vijf byte-identieke `driver.glb`-bestanden van 6,5 MB elk, samen ongeveer 26 MB dubbel. | `cars/*/driver.glb` | Eén gedeelde driver, bijvoorbeeld in `models/`. |
| 1.9 | Modelbestanden met spaties in de naam: `hyundai i30 new.glb`, `Trophy Truck.glb`, `muscle Openracer.glb` en `kartbaan oldenzaal.glb`. | | Hernoemen naar kebab-case. |
| 1.10 | De totale deploy is ongeveer 363 MB. De zwaarste modellen zijn 50, 53, 42 en 29 MB, en die laden op een telefoon via 4G erg lang. | | Draco- of meshopt-compressie en kleinere textures (gltf-transform). Dat is snel 70–90 % kleiner. |
| 1.11 ✔ | Nog niet gecommitte codewijziging: `Marbles.js:84` (2 → 1.1). | | Committen of terugzetten. |
| 1.12 ✔ | Het hoofdmenu doet bij het bladeren een `PUT /api/cars/<id>/preview.webp`. Daardoor wijzigen gecommitte previews steeds en blijft de tree vuil. | `MainMenu.js:338` | Bewust zo gebouwd, maar commit de previews vlak voor de release opnieuw. |

---

## 2. Bugs: hoog

| # | Bug | Waar | Scenario | Oplossing |
|---|---|---|---|---|
| 2.1 ✔ | **Race zonder racelijn wordt stil free drive.** De vroege `return` slaat `startRace()` over, dus ook de aftelling en het aantal ronden vallen weg. In de browser zag ik de banner met uitleg niet. | `main.js:171-175` | Nieuwe speler, Race, Circuit, 3 tegenstanders: rijdt alleen, zonder doel. | Op stap 5 heeft het menu al een tekst. Maak er een blokkade van (Race uitschakelen op die baan) of start de race zonder AI. Lever liever een `racing_line` mee voor Circuit. |
| 2.2 ✔ | **Rondetelling.** De eerste keer over de finish telt niet. De AI telt vanaf de grid-positie van de speler, niet vanaf de finish. | `Car.js:941-958`, `main.js:180`, `Opponent.js:420` | 3 ronden op Circuit: de speler rijdt 3 ronden + 71 m, de AI 3 ronden − 6 tot 44 m. Dat scheelt 80–115 m. | In een race telt de eerste passage als einde van ronde 1. `line.origin` wordt het punt van gate 0. |
| 2.3 | **Een reset in een race kost een hele ronde**, want `lapStarted = false`. | `Car.js:383, 301` | Eén reset in een race van 3 ronden betekent 4 ronden rijden. | Checkpoints laten staan en alleen de ronde ongeldig markeren voor records en ghost. |
| 2.4 (?) | De pitstraat van Kartbaan Oldenzaal loopt naast gate 0 (6 m breed). Een pitstop kost dan een ronde. | `kartbaan-oldenzaal/track.json`, `Car.js:915` | | Gate 0 breder maken, zodat hij de pitstraat ook dekt. |
| 2.5 ✔ | **XSS in de car-editor via de baannaam** in het venster "Save and test". Lokaal kan dat script via de write-API bestanden schrijven of verwijderen. | `tools/car-editor.js:2043` | Een gedeelde `.track.zip` of `?import=`-link met `name: "<img onerror=…>"`. | `textContent` gebruiken of `esc()`. In `serve.py` ook de extensies beperken (geen .html of .js). |
| 2.6 ✔ | **XSS in de drag-strip Top 50** via de baannaam, en via de auto- en baannaam op de time slip. | `DragStrip.js:331, 186-199` | Hetzelfde scenario. | `textContent`. |
| 2.7 | **De reset-toets trekt onderdelen van de auto af.** `parts.update(0)` klemt dt op 1e-4 en rekent dan met de oude snelheid, wat 20 kN geeft. | `Car.js:387` → `Parts.js:447, 461` | i30 of muscle car: resetten bij meer dan 0,15 m/s. Kentekenplaten, lampen en zelfs het motorblok vallen eraf. | Bij kleine dt geen traagheidsterm, en `hasVel` wissen in `relocate`. |
| 2.8 | **De motor crasht na een reset bij de lichtste aanraking.** `lastImpact` wordt nooit gewist en elders met `Math.max` opgehoogd. | `RigidObjects.js:274`, `Opponent.js:541`, `Vehicle.js:739-802`, `Motorcycle.js:313` | Eén keer tegen een muur, reset, daarna een pion aantikken: de rijder vliegt eraf, en het stuur geeft een volle klap. | `lastImpact = 0` in reset en relocate, en de waarde vervangen in plaats van het maximum nemen. |
| 2.9 | **Force feedback blijft trekken** in het pauzemenu, in een replay en in een verborgen tab. De nul-opdracht wordt door de rate limit van 8 ms weggegooid. | `ForceFeedback.js:600-616`, `main.js:604` | Esc midden in een bocht: het stuur blijft naar één kant trekken. | `ForceFeedback.neutral()` zonder rate limit, aanroepen bij pauze, replay, blur en visibilitychange. |
| 2.10 ✔ | **Escape in het hoofdmenu opent het in-game "Settings – The game is paused"** met Resume en Replay, in plaats van één stap terug te gaan. | `Settings.js:288-296` | In browser bevestigd. | Eén Escape-afhandeling met een stapel van open lagen. `DragStrip.js:142` doet dit al. |
| 2.11 | Dezelfde Escape-volgorde breekt dialogen. Esc op een bevestigingsvraag sluit die en hervat tegelijk de game. In de video-editor sluit Esc bij het hernoemen de hele editor. | `dialog.js:95`, `Settings.js:603`, `Replay.js:1777`, `VideoEditor.js:289` | | Opgelost met dezelfde oplossing als 2.10. |
| 2.12 | **Enter in een dialoog betekent altijd OK**, ook als de focus op Annuleren staat. Bij gevaarlijke acties staat de focus bovendien eerst op OK. | `dialog.js:93, 115` | "Delete car?", Tab naar Cancel, Enter: de auto wordt toch verwijderd. | Enter laten werken op de knop met focus. Bij `danger` eerst Cancel focussen. |
| 2.13 | **Een geïmporteerde car.json zonder `chassis`** maakt de autokeuze kapot tot je het item verwijdert. | `MainMenu.js:155-159, 206, 233`, `Garage.js:310` | | Valideren bij de import en `carTile` defensief maken. |

## 3. Bugs: middel

**Physics**
- **3.1** Een blijvende deuk is 2× zo groot als de energieboekhouding zegt. Het anker gebruikt `u−q`, maar de positie gebruikt `rest+u+q` (nagerekend: 0,038 m tegen 0,019 m). Plekken: `SoftBody.js:370-381, 190, 332`. Na de fix moeten de deuken opnieuw worden afgesteld.
- **3.2** Ankers en balken breken nooit, omdat yield bij elke substep 80 % van de overmaat wegneemt. Bij 100 m/s tegen een muur breekt niets. Ook de ophangingsarmen en part-mounts houden, en een wiel raakt alleen los via `hubLimit`. Plek: `SoftBody.js:374-413`. Laat het breken afhangen van opgebouwde plastische rek of energie.
- **3.3** `Car.rebuild` (live tunen) ruimt niets op:
  - losse onderdelen blijven liggen;
  - de Rapier-world wordt niet vrijgegeven;
  - `wheelLost` blijft staan, dus de auto rijdt op 3 wielen terwijl er 4 getekend zijn;
  - de banden vervormen daarna niet meer.

  Plek: `Car.js:242-253`.
- **3.4** Onderdelen breken op trage pc's bij de helft van de kracht: `Parts.js:447` klemt dt op 1/20, maar een frame mag 0,1 s duren. RigidObjects en de ragdoll klemmen op dezelfde manier. Oplossing: substeps.
- **3.5** De skidpad-reset laat een gecrashte motor gecrasht: geen besturing, de ragdoll blijft liggen. Plek: `main.js:543` → `Car.place`. Roep `recoverCrash()` aan in `place()`.
- **3.6** De onzichtbare wielen 1 en 3 van een motor krijgen een volledige ophanging met botsbollen, 0,45 m opzij. Die raken muren. Plek: `CollisionProxy.js:217-237` (?).

**Race, HUD en opslag**
- **3.7** Records en ghosts gebruiken alleen `track+car` als sleutel. Een getunede setup, damage uit of ander weer belandt in het record van de standaardauto, en dat record wordt ook de racelijn van de AI. Plekken: `Ghost.js:9`, `Records.js:33`.
- **3.8** localStorage loopt vol. Ghosts kosten ongeveer 1 M tekens per ronde, en previews worden als data-URL bewaard, met een nieuwe sleutel bij elke wijziging van de auto. Daarna mislukken records, settings en AI-learn zonder melding, en spreken record en ghost elkaar tegen. Plekken: `Ghost.js:157`, `MainMenu.js:307-333`, `Settings.js:165`. Oplossing: ghosts afronden en oude sleutels opruimen, of overstappen op IndexedDB.
- **3.9** Een model dat niet laadt geeft 90 s laadscherm, en de foutbanner zit onder de overlay. Een tegenstander die niet laadt blijft "running", en de replay start daarna niet. Plekken: `main.js:35-41`, `Opponent.js:174`.
- **3.10** Op telefoons wordt het HUD-canvas elk frame opnieuw aangemaakt: `resize()` en `update()` rekenen met andere formules. Plek: `Hud.js:451` tegenover `185`.
- **3.11** `opp` in de URL wordt twee keer gedecodeerd. Een setup-naam met `%` crasht het opzetten van de race, en een naam met `,` wordt gesplitst. Plek: `main.js:104`.

**Input en audio**
- **3.12** Grind- en grasgeluid blijft doorspelen in het pauzemenu en in replays. Plek: `EngineSound.js:276`, dat aan `bus` hangt in plaats van aan `output`.
- **3.13 ✔** De motor slaat in replays (en in geëxporteerde video's) nooit aan, omdat de ontsteking op `false` staat. Plek: `Replay.js:1337`.
- **3.14** Na een replay is de ragdoll van de motorrijder bevroren, weg of verkeerd geplaatst. Plek: `Replay.js:1159-1218`.
- **3.15** Een padtrigger boven 50 % wordt een digitale toets en loopt dan op naar 100 % gas of rem. Plekken: `Settings.js:51-53`, `Car.js:983` (?). Testen met een echte pad.
- **3.16** De knop "Test" voor force feedback doet niets zolang het menu open is. Plek: `Settings.js:998`.
- **3.17** macOS: na een Cmd-sneltoets blijft een ingedrukte toets hangen. Plek: `Settings.js:302-314`.
- **3.18** Een WebHID-stuur dat voor het eerst is gekoppeld en daarna wordt losgetrokken, logt ongeveer 120 keer per seconde. Opnieuw insteken herstelt het niet. Plek: `ForceFeedback.js:520-535`.
- **3.19** Een replay-gzip wordt eerst helemaal uitgepakt en pas daarna gecontroleerd, dus een zip-bom laat de tab crashen. Plek: `Replay.js:1450`. Hetzelfde geldt voor `Zip.read`.

**Editors en server**
- **3.20** In de car-editor markeren de meeste wijzigingen de auto niet als onopgeslagen, en undo ziet ze ook niet. Het gaat om de dialogen Cameras, Soft body, Materials en Sound, het exhaust-venster, gizmo-sleepacties en de resetknoppen van het tuning-paneel. Plek: `car-editor.js:3477, 3562`.
- **3.21** De track-editor heeft geen `beforeunload`. "Record AI racing line" navigeert direct weg, en alles wat niet is opgeslagen is weg.
- **3.22** Wisselen van auto, baan of tune gooit wijzigingen weg zonder te vragen, in beide editors.
- **3.23** "Save the car" en Ctrl+S slaan de tune op als er een tune gekozen is. Een nieuw geladen model gaat dan verloren. Plek: `car-editor.js:2439`.
- **3.24** Opslaan onder een ander id (ook "Make a copy") verliest velden die niet in het formulier staan, zoals `racing_line`, `skidpad`, `frame_torsion` en `tyre_rate`. Plekken: `track-editor.js:1891`, `car-editor.js:1977`.
- **3.25** Bij elke serverfout valt de editor terug op de garage, met een misleidende melding: "Deleted from your garage" terwijl het item op de server blijft. Plek: `Garage.js:267-284`.
- **3.26** `serve.py` volgt symlinks bij schrijven en verwijderen. Een PUT op `openracer-test-track` schrijft in de andere repo, en een DELETE crasht. Schrijfacties zijn ook niet atomair, en een afgebroken upload geeft toch `ok`. Plek: `serve.py:196-228`.
- **3.27** De bereiken in de editor zijn smaller dan in het tuningmenu van de game: veerweg 80 tegen 120 cm, stuur 1000° tegen 1440°. Bij opnieuw opslaan wordt de waarde stil afgekapt.
- **3.28** De autosave van het onderdelenvenster schrijft het hele formulier naar car.json, ook half afgemaakte wijzigingen. Plek: `softbody-editor.js:1065`.

## 4. UI/UX

**Bevestigd in de browser**
- **4.1 ✔ Mobiel, stappenbalk.** De balk met stappen loopt rechts van het scherm af ("4 We…"). Zet `.steps` op `flex-wrap` of laat "Stap 3 van 6" zien.
- **4.2 ✔ Mobiel, autotegels.** De naam en de specificaties overlappen de foto van de auto.
- **4.3 ✔ Mobiel, in-game.** De rondetijd, de "ghost"-toast, brandstof en banden en de gate-afstand liggen over elkaar heen. Er staat "press any key or click", maar op een telefoon is dat "tap".
- **4.4 ✔ Sliders in Settings.** Elke `input` bouwt het hele menu opnieuw op (`Settings.js:716`, `renderMenu`). Met het toetsenbord kun je maar één stap doen, daarna staat de focus op `BODY`. De scrollpositie springt ook.
- **4.5 ✔ Settings vanuit het hoofdmenu.** Je ziet "The game is paused", Resume, een uitgeschakelde Replay, "Tuning menu: Open" (doet niets) en "Save as HDR". Verberg wat alleen in de game hoort en noem de knop "Close".
- **4.6 ✔ Kiezen is niet consistent.** Bij de auto staat "Click a car to go on" en één klik gaat verder. Bij de baan staat "Double-click a track to go on". Dubbelklikken werkt slecht op touch.
- **4.7 ✔ Namen en tekst:**
  - "Openracer Kart", "Openracer muscle" en "Openracer Test Track" moeten "OpenRacer …" zijn;
  - de beschrijving van Kartbaan Oldenzaal is Nederlands, de rest Engels;
  - "TT assen circuit in The Netherlands";
  - Desert: "A winding road of **12 m**", vermoedelijk 12 km.
- **4.8 ✔ Specificaties.** De Hyundai i30 heeft volgens de kaart 75 pk en een topsnelheid van **110 km/h** met 6 versnellingen. Dat lijkt fout (een overbrenging of begrenzer in car.json).
- **4.9 ✔ Tegenstanders-stap.** "Without a choice the cars of the garage take the places" is verwarrend, want garage betekent elders "My garage". De samenvattingsbalk laat op deze stap de baan weg.
- **4.10 ✔ Tuningmenu.** Het tuningmenu zit verstopt onder Settings › Tools. "Surroundings for Blender: Save as HDR" is een ontwikkelaarsfunctie in het spelersmenu.
- **4.11 ✔ Car-editor.** De uitlegtekst linksboven in de 3D-weergave valt onder de werkbalk.
- **4.12 ✔ Console.** 404's op `circuit/images/buildings2_512.jpg`, `grasst.png` en `flames/flame4.png` (de laatste door het aftasten in de lus). Een tikfout in de i30: part `"right-,ist"` (`hyundai-i30/car.json:2626`). Er staan ook debug-`console.log`'s van hele objecten in.

**Uit de code-review**
- **4.13 Gamepad.** De menu's en het pauzemenu zijn niet met een gamepad te bedienen. Er is geen pauze-actie op Start. Een speler met alleen een pad kan niet pauzeren of stoppen.
- **4.14 Toetsenbord.** Alle keuzes in de flow (modus, auto, baan, tegenstander) zijn `<div onclick>` zonder `tabindex` of `role`. Maak er `<button>` van, met `:focus-visible`.
- **4.15 Enter.** De globale Enter in het hoofdmenu gaat ook af als een knop de focus heeft. Plek: `MainMenu.js:1550`.
- **4.16 Pagina springt.** Elke klik op een kaart of chip roept `render()` aan, waardoor de pagina naar boven springt (vervelend op een telefoon).
- **4.17 Modals.** Er is geen focus trap, geen focus-terugkeer, en `role="dialog"` en `aria-modal` ontbreken.
- **4.18 Bevestiging.** Deze destructieve acties vragen niets: "Reset the controls", "Records: Forget them" en "Delete" van een tune. Voor "Save as new…" wordt `window.prompt` gebruikt, en die overschrijft stil.
- **4.19 Melding bij opslaan.** "Setup saved" verschijnt ook als localStorage vol is.
- **4.20 Contrast.** Witte tekst op het oranje (#ff5a1f) heeft een contrast van ongeveer 3,1:1, onder WCAG AA. Maak de knop donkerder (ongeveer #d9480f).
- **4.21 Safe-area.** In het menu, Settings, de dialogen en de replaybalk ontbreekt safe-area padding (notch in landscape).
- **4.22 Touchknoppen.** De knoppen hebben alleen een icoon, zonder label of `aria-label`.
- **4.23 Volgorde van instellingen.** Damage staat op drie plekken, in verschillende volgorde (On/Off tegenover Off/On). Weer, tijd en ondergrond staan zowel in het menu als in Settings.
- **4.24 Woordkeus.** "Export zip", "Download" en "Export…" door elkaar, "kB" naast "KB", en Cancel en Close op wisselende plekken. Garage heet "Garage", "My garage" en "my garage". De editor zegt "tune" waar de game "setup" zegt.
- **4.25 Eenheden.** Bij "Reverse below … km/h" staat altijd km/h, ook als de eenheden op Imperial staan.
- **4.26 HUD editor.** "Edit HUD…" stuurt je na Save of Cancel terug in de lopende game, niet terug naar Settings.
- **4.27 Rijtoetsen.** P en I hebben elk twee functies: parkeerrem en free-cam aim, starten en free-cam lock. Opnieuw toewijzen haalt de gedeelde toets stil weg bij de andere actie.
- **4.28 Zoom en taal.** `user-scalable=no` blokkeert zoomen in de menu's, en `<html lang>` ontbreekt.

## 5. Docs, changelog en credits

**CHANGELOG.md**
- De kop zegt "2.2.0 (2026-10-24), 267 commits". Het zijn er 528, waarvan 242 na 24 oktober. De datum moet de releasedatum worden.
- Soft body krijgt geen eigen sectie, terwijl de intro het als hoofdpunt noemt. De ontbrekende onderdelen:
  - deuken;
  - losse onderdelen en scharnieren;
  - wielen die verbuigen of afbreken;
  - auto's die elkaar deuken;
  - de soft-body-editor.
- Nieuwe content ontbreekt: openracer-kart, openracer-muscle, sports-motorcycle-600cc en TT Assen. Ook "Removed: mustang, drift-mustang, honda-cbr600" ontbreekt.
- `CHANGELOG.md:631` zegt dat `"physics": "2d"` en `?physics=2d` werken. 2D is weg (`TrackLoader.js:311`).

**site/docs.html**
- De changelog stopt bij 2.1.0. Het blok voor 2.2.0 en de sidebar-ingangen ontbreken.
- Verouderd, onder andere:
  - `?car=mustang` (:132) en de lijst van auto's (:411);
  - "Race column" en "Skidpad button" (:96-129), terwijl het menu nu stappen heeft;
  - R gaat nu naar de racelijn, niet naar de start (:151);
  - de toets G voor de versnellingsbak bestaat niet meer (:154, 341);
  - de "fixed camera" (:221, 245);
  - "Open a replay" en "Gone when reloaded" (:260);
  - "Steering speed" (:146);
  - de settings-tabs (:209);
  - Pacejka en "the tyre is a stiff spring" (:299-323);
  - "the car deforming … is not made yet" (:364);
  - "the car is a rectangle" (:372);
  - de kaarten van het tuningmenu (:386);
  - Shake test en torque generator in de editor (:421-436).
- De toetsentabel mist P, Q, F, Y/J, E, K, M, 4, Backspace, F2, 5, 9, `,` `.`, O en 0.
- Er zijn geen secties over:
  - soft body en schade;
  - motoren en ragdoll;
  - de bestuurder;
  - weer;
  - de drag strip;
  - takes en de video-editor;
  - setups;
  - de bibliotheken voor wielen en onderdelen;
  - pitboxen.
- De screenshots tonen de Mustang en het oude menu.

**site/index.html**
- De Mustang-shots staan er nog (:41 en :83-85).
- :64 en :109 spreken nog van "rigid body … combined-slip tyre".
- Er staat niets over soft body, motoren, replays en video, of het weer.

**README.md**
- Mustang (:57) en het model `stadium-truck.glb` (:110).
- De roadmap zegt nog "A car that deforms (not made)" (:154).
- De Mustang Mach 1-bench (:159).
- "Race column" (:189), "gearbox is automatic" (:188) en de volgorde van de racelijn (:190).

**SOFTBODY.md**
- "Nothing here is released" (:3) moet worden: uitgebracht in 2.2.0.
- "What the game has now" (:6-10) beschrijft de oude staat alsof die nu geldt. Herschrijf het als geschiedenis.

**CREDITS.md**
- Alleen de Supermoto staat erin. Herkomst en licentie ontbreken van:
  - de auto's: i30, Trophy Truck, muscle car, Kart.glb, go-kart, 600cc en `driver.glb`;
  - de banen: Kartbaan Oldenzaal en TT Assen, plus de rechten op naam en uiterlijk;
  - de rest: `objects/openracer-banner-1`, de 17-203 velg en band, de vlammen, `tyre-squeal.wav` en de circuit-textures;
  - three.js en Rapier.
- Dit moet op orde zijn voordat het live gaat, zeker voor CC BY-NC-modellen.

**tools/**
- `physics-bench.js:45` en `physics-check.html:30, 45` verwijzen nog naar de mustang.
- `make-cbr600.py` is wees.

## 6. Kleinere punten (low)

- `TrackLoader.js:166`: een haakje staat verkeerd, waardoor bump-textures niet worden verkleind op telefoons.
- De legacy JSON-baan (Circuit) heeft geen foutpad. Een ontbrekend bestand geeft 90 s laden en dan een lege scène.
- `Telemetry.js:64` en `Replay.js:687` gebruiken `innerHTML` met data uit car.json of het replay-bestand.
- `wheel.spin` groeit onbegrensd (float32 in de replay en op de GPU). Wrap de waarde modulo 2π.
- Een gedeukte auto uploadt elk frame zijn uniforms (`SoftBody.js:437`).
- `TyreShell.reset()` wordt nooit aangeroepen. Na een reset op dezelfde plek kan er een schok komen.
- Engine braking volgt een live gewijzigde koppelkromme niet (`Engine.js:165`).
- Dode 2D-code (`resolveCollisions`, `undersideOfCar`, `bodyCorners`, `wheelHit`): opruimen.
- iOS: een AudioContext in de toestand "interrupted" wordt nooit hervat. Het ontgrendelen van audio op touch luistert naar `touchstart`; voeg `pointerup` toe.
- Een mislukte video-opname laat een rAF-lus draaien. De video-editor heeft geen audiocodec in zijn mime-lijst.
- `serve.py` controleert de poort in Origin niet, en `POST /api/convert/mp4` kan zonder preflight ffmpeg starten vanaf een andere localhost-poort.
- Editor: de rpm-slider voor het motorgeluid stopt op 7000 (de 600cc gaat tot 15500). Een leeg veld in de height-map geeft NaN. Een klik op de achtergrond van een dialoog na een tekstselectie sluit de dialoog.
- Het motor-HUD toont 4 banden, waarvan twee neppe en koude.

## 7. Wat ik eerst zou doen

1. **Git en assets op orde (§1).** Toevoegen en opruimen, de symlinks vervangen, `?v=2.2.0`, de index-bestanden goedzetten en de modellen comprimeren.
2. **Blokkerende bugs.** 2.1 (een racelijn voor Circuit, of Race blokkeren), 2.2 en 2.3 (rondetelling), 2.5 en 2.6 (XSS), 2.7 en 2.8 (reset), 2.9 (force feedback), 2.10 tot en met 2.12 (Escape en Enter).
3. **Mobiel en UX-snelle winst.** 4.1–4.9, 4.4 (sliders), 4.5 (Settings vanuit het menu) en 3.12/3.13 (geluid in pauze en replay).
4. **Credits, docs en changelog** (§5), en dan de release-workflow.
5. **Later, met een eigen tuningronde.** 3.1 en 3.2: soft body met deuken op ware grootte en breuk. Die veranderen hoe crashes aanvoelen, dus niet vlak voor de release.

## 8. Discord-concept (#changelog, Engels)

Pas de lijst met auto's en banen aan op wat echt gecommit en gedeployed wordt.

```
**OpenRacer 2.2.0 is out**
The biggest update yet: 528 commits since 2.1.0. Play at <https://openracer.eu/game/>

**Soft body and damage**
• Every car is a shell of nodes and beams: it dents, bends its suspension, loses wheels, doors and bumpers, and cars dent each other. Damage can be switched off; Backspace repairs.
• The tyres are bodies of nodes too: grip, flex and punctures come from the physics.

**Motorcycles**
• Supermoto 700 and a 600cc sports bike, with a rider who leans, puts a foot down and goes ragdoll in a crash.

**Weather and racing**
• Weather and time of day: sun, moon and stars, rain with puddles, snow the cars clear.
• A new step-by-step menu: pick your setup and fill the grid of opponents.
• The AI learns every track and uses pit boxes. Drag strip with a tree and a Top 50.

**Replays and video**
• A replay library, takes (5) and a video editor that exports mp4 with sound. A free camera in game and replay.

**Car editor and tuning**
• Build the engine and run it on the dyno, paint with metal flake, wheel and parts libraries, a driver in the car, Save and test.
• New gearboxes: dual clutch, torque converter, CVT.

**New cars and tracks**
Hyundai i30, Stadium Truck, Go-kart 250cc, OpenRacer Kart, OpenRacer Muscle, Supermoto 700, Sports Motorcycle 600cc. Tracks: Desert, Kartbaan Oldenzaal, TT Assen.

Full changelog: <https://openracer.eu/docs.html#changelog>
```
