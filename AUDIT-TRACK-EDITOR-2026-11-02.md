# Audit van de track editor (2 november 2026)

**Wat bekeken is:**
- `web/tools/track-editor.js`, `track-editor.html` en `track-design.js` (de wegontwerper), met `editor-ui.js` en `editor.css`;
- `web/js/Curbs.js`, `TrackLoader.js` en `Garage.js`.

**Basis:** de code na commit 513fe57, inclusief de curbs en de referentie-afbeelding van vandaag.

**Hoe:** de code is gelezen en de paden zijn nagelopen. De punten met *nagekeken* heb ik zelf in de code bevestigd. De rest is door het lezen van de code gevonden, maar niet in de browser nagespeeld.

Er is nog niets van dit rapport opgelost.

## Gebouwd vandaag

- **Curbs** (5e68a57).
  - Je tekent een curb met Draw curb.
  - Elke node ligt op het oppervlak eronder.
  - Shift+klik voegt een node toe.
  - Delete haalt een node weg en verbindt de buren; zonder nodes verdwijnt de curb.
  - In de game is een curb weg.
- **Referentie-afbeelding** (513fe57).
  - De afbeelding heeft een opacity, ligt boven of onder de baan, en is te verplaatsen met een gizmo.
  - Draaien en de maat instellen gaat met getallen.
  - *Scale by two points*: je klikt twee punten en typt de afstand in meters of feet.
  - De afbeelding wordt met de baan opgeslagen.
  - Getest:
    - 200 m tussen de punten, geschaald naar 50 m, gaf ×0,25, en het eerste punt bleef op zijn plek;
    - opslaan en herladen;
    - de gizmo.

## 1. Wat niet werkt (ernstigste eerst)

1. **Een lijnbewerking lekt naar de volgende baan** (*nagekeken*).
   - Bij het openen van een andere baan of bij New track wordt `stopLineEdit` niet aangeroepen.
   - Zo gaat het mis: je bewerkt de lijn van baan A, opent baan B en drukt op Apply line. Dan schrijft de editor de lijn van A in de `track.json` van B.
2. **Escape gooit lijnbewerkingen weg zonder te vragen** (*nagekeken*, `track-editor.js:373`). Wie op Escape drukt om een node los te laten, raakt alle wijzigingen sinds Edit the line kwijt.
3. **"Niet-opgeslagen wijzigingen" slaat vals alarm** (*nagekeken*).
   - De vingerafdruk leest elk invoerveld, ook velden die alleen iets tonen of een filter zijn: Surfaces-filter, kleuren-vinkje, gate-breedte, curbvelden en de velden van de ontwerper.
   - Een klik op een wegnode is al genoeg voor de vraag "Discard the changes?".
4. **Een opnieuw geïmporteerd model telt niet als wijziging.**
   - Dat gebeurt als de onderdeelnamen hetzelfde blijven.
   - Test drive slaat dan het opslaan over en rijdt het oude model.
5. **Bij de ontwerper doet één Escape twee dingen.** Hij laat de node los en verlaat ook de modus Add node of Place prefab.
6. **Een gizmo pakken in een plaatsmodus maakt een nieuw item** (*nagekeken*).
   - De bewaking bij pointerdown kent alleen drie van de negen gizmo's.
   - Voorbeeld: in Add gate sleep je de pijl van de gekozen gate, en er komt een nieuwe gate bij.
   - Hetzelfde gebeurt bij camera's, en in elke plaatsmodus terwijl een curb-node gekozen is.
7. **Er zijn meerdere selecties en gizmo's tegelijk actief.**
   - Voorbeeld: je kiest een curb-node en daarna een object in Layers, en drukt op Delete. De curb-node gaat weg, het object blijft staan.
   - Bij het bewerken van de lijn haalt één Delete zowel de node als de gekozen gate weg.
8. **Een gate weghalen in de kaart laat een oude selectie achter.** Hetzelfde geldt voor "Gate 1 at the start". De gizmo springt dan naar een andere gate, of hangt aan een gate die niet meer bestaat.
9. **Op een getekende baan selecteert een klik in Look niets.** Objecten, gates en curbs kies je daar alleen via Layers.
10. **Shift+klik in Add node gaat naar twee handlers.** Het voegt een wegnode én een curb-node toe.
11. **Curbs, gates en objecten volgen de weg niet** (*nagekeken*).
    - Bij het herbouwen van de weg tekent de ontwerper de curbs niet opnieuw.
    - Wie een heuvel ophoogt, ziet curbs zweven of wegzakken. De game neemt die oude hoogte over.
12. **De game toont geen curbs op banen van het oude formaat.** De editor laat ze daar wel tekenen.
13. **Een mislukte laadactie laat een mengsel van twee banen achter.**
    - De editor zet de id, naam en grid van de nieuwe baan al vóór het laden van het model.
    - Mislukt het laden, dan blijven objecten, curbs, oppervlakken en model van de vorige baan staan.
    - Wie dan opslaat, overschrijft de nieuwe baan daarmee.
14. **Ongedaan maken werkt alleen voor de weg.**
    - Op een getekende baan maakt Ctrl+Z na het verplaatsen van een gate de laatste *wegwijziging* ongedaan.
    - Voor gates, grid, pit, objecten, curbs, camera's en de lijn is er geen undo.
15. **Geheugenlek en schokkerig slepen.**
    - Elke beweging van een gizmo bouwt alle markers opnieuw: nieuwe geometrie, materialen en een CanvasTexture per nummer, zonder `dispose`.
    - Daarbij worden ook de objecten opnieuw gekloond en worden er veel raycasts gedaan.
    - Op een grote glb voel je dat, en het GPU-geheugen groeit tijdens een sessie.
16. **Een curb van één node verdwijnt bij opslaan zonder melding.**
17. **Kleinere punten:**
    - Escape in een bevestigingsvenster kan ook een curb-node loslaten of verwijderen.
    - Bij het laden snappen grid en gates naar het hoogste wegdek; bij een brug is dat het bovenste.
    - De maximale curbbreedte wordt in de code niet afgedwongen.

## 2. UX en UI

1. **Er is geen gedeeld selectiemodel.**
   - Negen gizmo's hebben elk hun eigen logica voor kiezen en loslaten.
   - Een klik op iets zou al het andere los moeten laten.
   - Dat lost punt 5 t/m 10 hierboven op.
2. **Elke soort node werkt anders.**
   - De racelijn: Shift+klik, Apply schrijft meteen naar schijf, Escape gooit weg.
   - Curbs: Enter of Escape.
   - De weg: een gewone klik voegt een node toe, je sleept de node zelf, en er is undo.
   - De pitlijn: alleen laatste punt ongedaan maken of alles wissen.
   - Grid- en pitvakken: niet te verplaatsen.
   - Het voorstel is één node-editor voor alles: klik, slepen, Shift+klik invoegen, Delete, Escape loslaten, Ctrl+Z.
3. **De racelijn wordt buiten Save om opgeslagen.** Apply line en Forget the line schrijven direct, terwijl al het andere pas bij Save wordt opgeslagen.
4. **De uitleg staat in lange alinea's.**
   - Dat geldt voor de kaarten en de HUD.
   - `editor-ui.js` heeft al (i)-knoppen met een uitleg-popover, maar de track editor gebruikt ze niet.
5. **Panelen vallen over elkaar.**
   - Layers ligt over de lade van de ontwerper.
   - De modusbalk loopt met 12 tekstknoppen over op twee regels.
   - De HUD overlapt de melding bovenin.
   - Alle kaarten klappen bij de start dicht, ook de kaarten die open zouden moeten staan.
6. **Layers is onvolledig.**
   - Grid, pitvakken, camera's, lijn, wegnodes en prefabs staan er niet in.
   - Er zijn geen oog- of slotknoppen en geen verwijderknoppen per regel.
   - De secties kun je niet inklappen.
7. **Er zijn weinig sneltoetsen.** Er is geen Ctrl+S, geen cijfertoetsen voor de modi, geen F om de selectie in beeld te brengen en geen toets voor bovenaanzicht. Er is ook geen overzicht met `?`.
8. **Er zijn geen getalvelden voor wat gekozen is.**
   - De breedte van een gate verander je alleen met de schaal-gizmo.
   - Objecten hebben geen velden voor x, z, richting en schaal.
9. **Escape en Enter werken overal anders.**
10. **Het startvenster kun je niet sluiten.**
    - De lijst met banen heeft geen zoekveld en geen voorbeeldplaatjes.
    - Er is geen "laatste baan openen".
11. **Werk raakt stil kwijt.**
    - Bij het verlaten van de pagina tijdens een lijnbewerking komt geen waarschuwing.
    - Delete van een object of gate vraagt niets en is niet ongedaan te maken.
12. **De gevaarlijke Delete-knop staat in de voettekst** direct naast Thumbnail, Export, Test drive en Save.

## 3. Nieuwe functies (waarde tegen moeite, beste eerst)

1. **Sneltoetsen:**
   - Ctrl+S om op te slaan;
   - 1–9 voor de modi;
   - F om de selectie in beeld te brengen;
   - T voor bovenaanzicht;
   - `?` voor een overzicht.

   Weinig werk.
2. **Eén selectie voor de hele editor,** met een vaste volgorde voor Delete en Escape. Dit lost de meeste bugs op.
3. **Undo en redo voor de hele editor.** De editor maakt al een momentopname van alles voor de detectie van wijzigingen; dezelfde momentopname kan voor undo dienen.
4. **Auto grid:**
   - acht vakken, twee breed en verspringend, achter vak 1;
   - en een rij pitvakken vanaf een punt in een richting.
5. **Auto gates:** gates op gelijke afstand langs de racelijn of het midden van de weg, met gate 1 op de start.
6. **Een live "klaar om te racen"-lijst.**
   - Die controleert de start, de volgorde en richting van de gates, of de lijn door de gates gaat, de pit en curbs van één node.
   - Nu krijg je dat pas na het opslaan te zien.
7. **Grid- en pitvakken verplaatsen met een gizmo, en pitlijnpunten bewerken** met de gedeelde node-editor.
8. **Een eigenschappenpaneel** met x, z, richting, breedte en schaal van wat gekozen is.
9. **Drop to surface,** en curbs, gates en objecten automatisch opnieuw op het oppervlak leggen na een wegwijziging.
10. **Layers uitbreiden:** alle soorten items, oog en slot, verwijderen per regel, en Ctrl+D om te dupliceren.
11. **Banenkiezer met plaatjes, een zoekveld en "laatste baan".**
12. **Een concept automatisch bewaren in de browser,** zodat werk een crash overleeft.
13. **Echt bovenaanzicht (orthografisch),** met een meetlint en de coördinaten van de cursor. Dat sluit goed aan op de referentie-afbeelding.
14. **Curbs die op de rand van de weg snappen,** of automatische curbs in de bochten van een getekende baan.
15. **Rijrichting omdraaien:** gates, grid en lijn in één keer.
16. **Meerdere objecten tegelijk kiezen,** met een selectiekader.
17. **Minder rekenwerk:** alleen tekenen als er iets verandert, markers opruimen, en markers per stuk bijwerken tijdens het slepen.

## Voorgestelde volgorde

1. **Ronde 1 (bugs, één samenhangende wijziging):**
   - één selectiemodel met een vaste Delete- en Escape-volgorde;
   - de lijnbewerking stoppen bij het laden of een nieuwe baan;
   - Escape vraagt eerst iets bij de lijn;
   - de vingerafdruk alleen over echte baangegevens;
   - het geïmporteerde model telt mee als wijziging;
   - curbs opnieuw opbouwen na een wegwijziging;
   - curbs in het oude formaat;
   - waarschuwen bij een curb van één node;
   - markers opruimen.
2. **Ronde 2 (UX):**
   - sneltoetsen;
   - undo en redo voor de hele editor;
   - het eigenschappenpaneel;
   - de uitleg in (i)-knoppen;
   - de indeling van de panelen.
3. **Ronde 3 (functies):**
   - Auto grid en auto gates;
   - de klaar-om-te-racen-lijst;
   - het orthografische bovenaanzicht met een meetlint;
   - de banenkiezer met plaatjes.
