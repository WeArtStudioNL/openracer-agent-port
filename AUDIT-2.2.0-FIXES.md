# OpenRacer 2.2.0: fixes na de audit

- Datum: 30 oktober 2026, 03:30 tot ±07:00
- Repo: `openracer-softbody`, branch `claude/soft-body`
- Commits: lokaal. Er is niets gepusht, niets gedeployed en niets op Discord gezet.

Bij dit rapport hoort het auditrapport `AUDIT-2.2.0.md`. Alle verwijzingen naar §-nummers en bevindingsnummers (zoals "2.1" of "4.7") gaan over dat bestand.

## Kort

- Ik heb **21 commits** gemaakt, van `cb45df0` tot `cc79555`, op `claude/soft-body`. Ze staan alleen lokaal.
- Na elke stap heb ik in de browser getest. Dat gebeurde met een eigen testserver op poort 8140 en een versnelde simulatie: de game-lus wordt vanuit JavaScript aangestuurd, omdat het browservenster maar op ±4 fps draait als het scherm niet in beeld is.
- Tijdens het testen kwamen **5 nieuwe bugs** boven die niet in de audit stonden:
  1. De racelijn ligt onder een brug op het brugdek.
  2. De AI-racelijn ligt te dicht bij de rand van de weg, waardoor AI-auto's over de kop slaan.
  3. De autopilot na de finish telt elk frame als crash.
  4. AI-motoren worden elke 3 s als gecrasht teruggezet.
  5. Het terugzetten van een AI repareert niets en zet een gevallen motor niet overeind.

  Alle vijf zijn opgelost.
- De meeste release-blokkers zijn opgelost. Wat jij nog moet doen of beslissen, staat onderaan.

## Wat er per stap is gedaan

### 1. Git en assets (`cb45df0`)

- Alle auto's, banen, objecten, velgen, vlammen en het piepgeluid staan nu in git. De index-bestanden kloppen met wat erin staat.
- Ik heb de textures van alle modellen opnieuw gecodeerd: maximaal 2048 px, en JPEG waar geen transparantie is. Geometrie en materialen zijn ongewijzigd. Resultaat:

  | | Voor | Na |
  |---|---|---|
  | `web/` totaal | 363 MB | 218 MB |
  | i30 | 50 MB | 33 MB |
  | Trophy Truck | 53 MB | 36 MB |
  | Go-kart | 27 MB | 12 MB |
  | Driver | 6,5 MB | 1,7 MB |

- Modelnamen zonder spaties: `hyundai-i30.glb`, `trophy-truck.glb`, `openracer-muscle.glb` en `kartbaan-oldenzaal.glb`.
- **De originelen staan veilig** in `/Users/glennhofman/localdev/openracer/openracer-softbody-originals-2026-10-30/`. Daar staan ook de ongebruikte `hyundai i30.glb`, `test-old.tmp` en een lege `differential.glb`.
  - Die lege `differential.glb` (132 bytes, een lege Blender-export) stond nog niet gecommit in je working tree. Ik heb de vorige werkende versie teruggezet. **Controleer of dat de bedoeling was.**
- `serve.py` neemt gesymlinkte mappen (de testbaan) niet meer op in de index-bestanden.
- **Getest:** alle 7 voertuigen laden op alle banen, zonder fouten. De previews in het menu zijn opnieuw gemaakt.

### 2. Races (`5107c43`)

- **Rondetelling.** De AI telt nu vanaf de finish (gate 0). Voor iedereen begint ronde 1 bij de eerste passage van de finish.
  - Getest met dezelfde auto's op Circuit, 2 ronden: speler 311,1 s, AI 311,4 / 311,8 / 325,7 s.
  - Voorheen finishte de AI 80–115 m eerder.
- **Reset in een race** kost geen ronde meer. Die ronde telt niet als record of ghost.
- **Circuit heeft een racelijn.** Ik heb hem berekend: het midden van de weg langs alle 19 gates, 3570 m, vloeiend gemaakt. Race op Circuit heeft nu AI.
- **Nieuw gevonden: de racelijn onder een brug.** Die kreeg de hoogte van het brugdek (`RacingLine.settle`), waardoor de AI-snelheden daar fout waren. Dit geldt voor elke baan met een brug of viaduct. Opgelost.
- **Nieuw gevonden: AI-auto's sloegen over de kop.** De AI-lijn lag 0,8 m van de rand van de weg, en de wielen raakten het gras en de kerbs. De marge is nu 1,5 m.
  - Voor de fix: 3–4 keer over de kop per auto per 2 ronden. Daarna: één keer in 2 ronden, door contact tussen AI-auto's.
- **AI die tegen een muur heen en weer schommelt** wordt na 8 s teruggezet. De oude detectie keek alleen of de snelheid laag was en zag dit daardoor niet.
- **Nieuw gevonden: de autopilot na de finish** telde elk frame als crash, en verlaagde daarmee elk frame zijn geleerde snelheden. Opgelost.
- **Race zonder racelijn** start nu zonder AI en legt uit waarom. Een baan zonder gates zegt dat er geen race mogelijk is. Het menu zegt dit vooraf ook.
- **Meldingen** verschenen onder het laadscherm en waren weg voordat je ze kon zien. Ze wachten nu tot het laadscherm weg is, worden gestapeld, en staan lager op smalle schermen. Alleen relevante meldingen worden getoond.
- **Pitstraat.** Kartbaan Oldenzaal (gate 0 en 1) en TT Assen (laatste gate) zijn verbreed over de pitstraat. Ik heb nagerekend dat ze geen ander deel van de baan raken.

### 3. Beveiliging (`dcf374f`)

- **XSS.** Gedicht in "Save and test" van de car-editor, in de drag-strip Top 50 en op de time slip. Ook de telemetrie, de versnelling uit een replay-bestand en de skidpad-ondergrond worden nu als tekst getoond.
- **`serve.py`:**
  - schrijft en verwijdert niet meer via symlinks;
  - accepteert geen `.html`, `.js`, `.svg` en dergelijke;
  - schrijft bestanden pas weg als de upload compleet is;
  - eist een Content-Length;
  - controleert dat de Origin dezelfde poort heeft;
  - de mp4-conversie vereist de header van de game.

  Alles getest met `curl`.
- **Garage** valt alleen terug op de browseropslag als er geen schrijf-API is (403, 404, 405, 501 of geen server). Andere fouten worden als fout getoond.
- **Import.** Kapotte of onvolledige `car.json`/`track.json` wordt geweigerd met een duidelijke melding. Zip- en replay-bommen worden tijdens het uitpakken afgekapt.
  - Getest met een zip die 5 MB uitpakt maar 10 bytes opgeeft: die wordt geweigerd.

### 4. Reset en crashes (`4804a41`)

- **De reset-toets trok onderdelen eraf.** Bevestigd: met de oude code vielen bij 106 km/h alle 10 onderdelen van de muscle car af. Met de fix vallen er 0 af.
- **Motor crashte bij de lichtste aanraking.** `lastImpact` wordt nu gereset bij een reset en vervangen in plaats van gemaximeerd.
- **Skidpad-reset** zet een gevallen motor weer overeind.
- **`Car.rebuild`** (live tunen) ruimt losse onderdelen en de Rapier-wereld op, en repareert de wielen.

### 5. Escape, Enter en menu's (`b6e36fc`)

- **Escape.** Een laag bovenop (een vraag, een venster van het hoofdmenu, de vehicle picker, de vraag of je de replay wilt bewaren, het naamveld in de video-editor) sluit alleen zichzelf. In het hoofdmenu gaat Escape een stap terug.
- **Enter.** Enter activeert de knop die de focus heeft. Een vraag die iets verwijdert start op Cancel. Tab blijft binnen de dialoog, en de focus gaat terug naar waar hij was.
- **Settings vanuit het hoofdmenu** toont "Close", zonder Resume, Replay, Main menu, tuning of HDR.
- **Sliders** behouden focus en scrollpositie.
- **Bevestiging gevraagd** bij Reset controls, Forget records en Delete setup.
- **Naam van een setup** wordt in een dialoog in de game gevraagd (geen `window.prompt` meer). Een bestaande naam wordt alleen overschreven na bevestiging. Een volle opslag geeft een melding.
- **Getest in de browser:** alle bovenstaande punten.

### 6. Geluid en force feedback (`83da191`)

- **Stuur trekt niet meer door.** Force feedback gaat naar nul in het menu, in een replay, bij blur en in een verborgen tab. De knop "Test" werkt ook vanuit het menu.
- **Motor in replays.** Die slaat nu aan (gemeten niveau 0,04–0,08; voorheen stil, met de ontsteking uit).
- **Grind- en grasgeluid** is stil in het menu en in replays.
- **Audio starten.** Werkt nu ook bij een tap (`touchend`/`pointerup`) en na een onderbreking op iOS.
- **macOS:** na een Cmd-sneltoets blijft geen toets meer hangen.

### 7. Mobiel en teksten (`f63fc04`)

- **Hoofdmenu op mobiel:**
  - de stappenbalk toont alleen de huidige stap;
  - de autotegels hebben de tekst boven en onder de foto in plaats van eroverheen;
  - safe-area (notch).
- **Toetsenbord.** Elke keuze in het menu is bereikbaar met Tab, Enter en Space, met een zichtbare focus. Getest: modus → auto → baan → weer, alleen met het toetsenbord.
- **HUD in de game op mobiel.** De gate-afstand staat rechts in plaats van over de rondetijd, en de meldingen staan lager. "Tap the screen" op touchschermen.
- **Topsnelheid van een CVT** in het menu was fout: de i30 toonde 110 km/h, nu 160.
- **Teksten:**
  - "Tap or click"; de baanstap zegt niet meer "Double-click";
  - de tegenstanders-stap noemt de auto's van de game niet meer "the garage";
  - OpenRacer Kart en OpenRacer Muscle;
  - Desert 3,8 km in plaats van "12 m";
  - de beschrijvingen van Kartbaan Oldenzaal en TT Assen in het Engels;
  - de onderdelen van de i30 wijzen naar de echte objecten (`right-mist`, en de rechter koplamp heet `left-headlight.001` in het model).

### Extra (`8800670`)

- **Nieuw gevonden: AI-motoren kwamen niet vooruit.** Hun ontbrekende wielen 1 en 3 telden als "afgebroken wiel", waardoor ze elke 3 s als gecrasht werden teruggezet. Op TT Assen haalde een AI-motor 1 % van de ronde in 30 s; nu 11 %.
- **Nieuw gevonden: het terugzetten van een AI repareerde niets** en zette een gevallen motor niet overeind. Dat doet het nu wel.
- `index.html` laadt `bootstrap.js?v=2.2.0` (was 2.1.0).

### Extra fixes uit de audit (na stap 7)

- **Track-editor (`83f6048`):** vraagt eerst bij onopgeslagen wijzigingen. Dat geldt bij weggaan van de pagina, bij Record AI racing line, bij het kiezen van een andere baan en bij New track. Getest: na het laden geen waarschuwing, na een wijziging wel.
- **Car-editor:**
  - wijzigingen in de dialogen, het exhaust-venster, de knoppen ↺ en "= front" en het slepen met de pijlen tellen nu als onopgeslagen (`59d8cb3`);
  - geen tune opslaan terwijl er een nieuw model geladen is (`c4251b0`);
  - de rpm-slider voor het geluid gaat zo hoog als de motor (`452ae56`);
  - de hoogtekaart geeft geen NaN meer, en een dialoog sluit alleen bij een klik die op de achtergrond begon (`956eadd`).
- **Bereiken gelijk in tuningmenu en editor (`183939a`).** De stuurhoek is per kant; het menu zei "lock to lock" en ging tot 1440. De veerweg gaat in de editor nu ook tot 120 cm.
- **Laden, HUD en adres (`a2b497f`):**
  - een model dat niet laadt houdt het laadscherm niet meer 90 s vast;
  - een AI-auto zonder model valt uit de race, met een melding;
  - de HUD maakt op telefoons niet meer elk frame nieuwe canvassen (getest: 0 wijzigingen in 2 s);
  - setupnamen met `,` of `%` in de race-link werken;
  - bump-textures worden op telefoons verkleind;
  - de fly-by-hint zegt "Tap" en staat vrij van de meter.
- **Previews in localStorage (`35dfd80`).** Oude previews worden opgeruimd. Getest: per auto blijft er één sleutel over.
- **Touchknoppen (`303ae98`)** hebben een label.
- **Eenheden (`37c7a59`):** "reverse below" toont mph bij Imperial.
- **HUD-editor (`e0989e9`)** gaat terug naar Settings. Getest.
- **Autopilot na de finish (`cc79555`)** wordt teruggezet als hij 6 s tegen iets aan staat.

### Eindtest (stap 9)

- **Syntax:** alle scripts en alle JSON-bestanden zijn gecontroleerd en in orde.
- **Volledige race via de menu-UI:** Race → OpenRacer Kart → Kartbaan Oldenzaal → 2 tegenstanders → Start → uitslag → Replay → Escape → Main menu → vraag om de replay te bewaren → Escape. Alles werkte.
  - De uitslag klopte: de Hyundai won in 1:45, en de OpenRacer Kart (13 pk) werd laatste.

### 8. Docs, changelog en credits (`81097cf`)

- **CHANGELOG 2.2.0:**
  - de kop is bijgewerkt (datum 2026-10-30; aanpassen bij de echte release);
  - nieuwe secties: soft body en schade, nieuwe en verwijderde auto's en banen, en "Fixed before the release";
  - de foute regel over `physics: 2d` is gecorrigeerd.
- **CREDITS:** three.js (MIT) en Rapier (Apache-2.0) toegevoegd.
- **`docs.html`:**
  - de menustappen, alle URL-parameters, de toetsen volgens `Settings.js` en de echte settings-tabs;
  - de HUD-badges, de camera's en de replay-bibliotheek;
  - de rondetelling, het shell-tyre-model, de versnellingsbakken, de tuningkaarten en de editors;
  - de meegeleverde auto's en banen;
  - nieuwe secties: soft body, motoren, weer, drag strip, takes en video-editor, setups;
  - een 2.2.0-blok in de changelog van de docs.

  De pagina rendert zonder fouten (getest).
- **`site/index.html`:** soft body, weer, replays en motoren. Bij de oude screenshots staat nu "older version".
- **README en `SOFTBODY.md`:** bijgewerkt (de soft body heet nu uitgebracht in 2.2.0).
- **Nog op te lossen in de tools zelf:**
  - `tools/physics-bench.js` heeft alleen referentiewaarden voor de verwijderde `mustang`;
  - `tools/tyre-bench.js` gebruikt standaard het niet-bestaande `openracer-mustang` (de README zegt nu dat je een id moet meegeven);
  - geen enkele meegeleverde baan heeft een drag strip (alleen de lokale testbaan).
- **Opnieuw te maken screenshots:**
  - `menu.webp` toont het oude menu;
  - `race.webp`, `drift.webp`, `car-editor.webp` en `tuning.webp` tonen de Mustang;
  - `skidpad.webp`, `touch.webp`, de video-poster en de promovideo zijn waarschijnlijk verouderd;
  - de hero-afbeelding van de site toont **"SAMSUNG"-reclameborden** uit de oude Circuit-textures (een merknaam).

## Wat jij moet doen of beslissen

1. **Licenties in `CREDITS.md`.** Alleen jij weet waar deze modellen vandaan komen:
   - i30, Trophy Truck, muscle car, `Kart.glb`, go-kart, 600cc en `driver.glb`;
   - Kartbaan Oldenzaal en TT Assen (let ook op de rechten op naam en uiterlijk van echte circuits);
   - de banner, de 17-203 velg en band, de vlammen en `tyre-squeal.wav`;
   - de circuit-textures uit het oorspronkelijke project.

   Dit moet geregeld zijn vóór de release, zeker bij CC BY-NC-modellen.
2. **Inhoud van de auto's.**
   - De i30 heeft volgens zijn motorbouw 96 Nm en 75 pk, terwijl de beschrijving 164 Nm en 135 pk zegt.
   - De OpenRacer Muscle heeft 913 pk, 391 km/h en 4 versnellingen.

   Is dat zo bedoeld?
3. **`differential.glb`.** Was de lege export bewust? Het origineel staat in de backup-map.
4. **Screenshots** van de site en de docs tonen nog de Mustang en het oude menu. Die moeten opnieuw worden gemaakt.
5. **Live zetten.** Ik heb bewust **niet gepusht**. De branch bevat nu modellen waarvan de licentie nog onbekend is (punt 1), en op GitHub zou dat ze verspreiden. Na jouw akkoord: push, merge naar master, deploy en Discord. Het Discord-concept staat in `AUDIT-2.2.0.md` §8. Let bij de deploy op:
   - de index-bestanden worden live met de hand bijgewerkt (ze zijn uitgesloten van de deploy);
   - `--delete` verwijdert de Mustang-mappen op de server;
   - de editor-pagina's laden hun scripts zonder `?v=` (zie vervolgstappen).
6. **Je lopende servers** op poort 8000 en 8132 draaien nog met de oude `serve.py`. Herstart ze, dan geldt de beveiliging.

## Vervolgstappen (niet gedaan; groter werk of een eigen afstemronde)

- **Soft body:**
  - deuken zijn 2× te groot (§3.1);
  - balken en ankers breken nooit (§3.2).

  Dit verandert hoe crashes aanvoelen en vraagt een eigen afstemronde.
- **AI:**
  - AI-motoren vallen nog zo'n keer per 20 s (de rijkwaliteit van de motor-AI);
  - AI-auto's raken elkaar soms in een pack en slaan om.
- **Ghosts en records** per setup of instelling (§3.7), en het vollopen van localStorage (§3.8). Overstap naar IndexedDB?
- **Editors, wat nog openstaat:**
  - bij opslaan onder een ander id ("Make a copy") gaan velden verloren (§3.24);
  - de autosave van het onderdelenvenster schrijft het hele formulier (§3.28);
  - wisselen van tune binnen de car-editor gooit wijzigingen weg zonder te vragen (§3.22).
- **Gamepad** voor menu's en pauze (§4.13): een nieuwe functie.
- **Kleinere UX-punten (ontwerpkeuzes, dus aan jou):**
  - contrast van wit op oranje (§4.20; het merkkleur);
  - dubbele toetsen P en I (§4.27);
  - instellingen die op meerdere plekken staan (§4.23);
  - woordkeus en knopvolgorde (§4.24);
  - het tuningmenu zit verstopt onder Tools (§4.10).
- **Pagina's van de editors:** scripts laden met `?v=`.
- **Bekende 404's** op Circuit (`buildings2_512.jpg`, `grasst.png`) en het aftasten naar `flame4.png`.
