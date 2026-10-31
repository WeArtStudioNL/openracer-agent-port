# Screenshots en video's voor de site

**Stand van 31 oktober 2026**: Glenn leverde de beelden in `../` (de map boven dit project). Ze staan nu als WebP (1600 breed) in `site/img/` en als loops in `site/video/`, en de site en de docs gebruiken ze. Gedaan: punt 1 tot 8 en 10 (hero), 12, 14 tot 17 en 19, plus de drie loops van punt 22 (schade, motor, pitstop met reparatie; 1,2 tot 1,5 MB per stuk). Nieuwe promovideo (`site/video/openracer-promo.mp4`, 80 s, 1280×720, 30 fps, 11 MB, met de drag strip, met het geluid van de game, gemaakt uit de opnames van Glenn) en `poster.webp` staan erin: punt 9 en 21 zijn klaar. Nog open, 11 (reeks van de crash), 13, 18 (stilstaande pitstop met HUD), 20 (Garage), en de loop "vrije camera in een replay". `touch-portrait.png` is niet gebruikt (de site toont de liggende).

Wat de site (`site/index.html`) en de docs (`site/docs.html`) nodig hebben voor 2.2.0.

**Formaat**
- Screenshots: 1600×900. Lever ze als PNG aan, dan maak ik er WebP van.
- De telefoon-screenshot: 844×390, liggend.
- Video's: 1920×1080 of 1280×720, 60 fps als het kan, zonder HUD-melding "Engine sound: press any key".
- Neem een auto en baan die al definitief zijn: geen modellen die nog vervangen worden, en geen SAMSUNG-borden in beeld.

## Vervangen (nu op de site)

Deze tonen nog de Mustang of het oude menu.

1. **`menu.webp`**: het hoofdmenu met de auto-tegels in de stap Car, met een auto geselecteerd.
2. **`race.webp`**: een race van achter de auto, met 3 of 4 AI-auto's dicht voor je, de HUD zichtbaar (LAP 2/5, plaats), bij voorkeur bij het insturen van een bocht.
3. **`drift.webp`**: een drift met rook en remsporen, de camera schuin van voren.
4. **`skidpad.webp`**: het resultaatvenster van de skidpad (de g en de snelheid).
5. **`touch.webp`**: de game op een telefoon, liggend, met de touch-knoppen in beeld.
6. **`tuning.webp`**: het tuningmenu (U) open tijdens het rijden.
7. **`car-editor.webp`**: de car-editor met een auto, het zijpaneel open, bij voorkeur met het soft-body-venster of de wielophanging zichtbaar.
8. **`track-editor.webp`**: de track-editor met een baan, met gates, gridvakken en het pitvak zichtbaar.
9. **`video/poster.webp`** (1280×720): het eerste beeld van de promovideo.

## Nieuw voor 2.2.0 (de grootste nieuwigheden hebben nog geen beeld)

10. **Schade**: een auto met een flinke deuk en een losgeslagen deur of motorkap, vlak na een crash. Dit is de kern van 2.2.0 en verdient de hero-plek.
11. **Crash in beeld**: een reeks van 3 screenshots, of een korte clip van 5 tot 8 s, van een auto die een muur of een andere auto raakt, met onderdelen die eraf vliegen.
12. **Motor met rijder**: een motor in een bocht, zichtbaar ver gekanteld.
13. **Ragdoll-val**: een rijder die van de motor valt (clip van 3 tot 5 s of één screenshot op het juiste moment).
14. **Bestuurder in de auto**: de cockpit-camera met handen aan het stuur, of van buiten door de zijruit.
15. **Replay en video-editor**: de video-editor met tijdlijn, clips en twee monitoren.
16. **Dragstrip**: de start (de lampenboom) of de time slip na een run.
17. **Weer en tijd**: dezelfde plek op een baan in regen, bij schemering en in sneeuw (3 screenshots, voor een rij naast elkaar).
18. **Pitstop**: een auto stil in het pitvak, met de HUD die aftelt (tyres en fuel).
19. **AI-pack**: van bovenaf of met de vrije camera, het hele veld in de eerste bocht.
20. **Garage**: het venster Garage met de lijst auto's en banen.

## Video's

21. **Nieuwe promovideo** (`openracer-promo.mp4`, 45 tot 75 s): een race-start, een inhaalactie, een crash met schade, een motor in een bocht, een drift, een replay-shot met de vrije camera, en de editors in 2 tot 3 korte shots. Zonder geluid of met motorgeluid; geen muziek nodig.
22. **Korte loops voor de site** (5 tot 10 s, zonder geluid, voor in een rij die automatisch afspeelt):
    - de soft body: een deuk die ontstaat;
    - de motor met ragdoll;
    - de vrije camera in een replay.

    Klein houden: maximaal 3 MB per loop.

## Voorstel voor de site

- **Hero**: nu een video met een poster. Beter: punt 21 als hero, met een korte loop van schade (punt 22) als fallback op mobiel.
- **"What's new in 2.2"**: een nieuwe sectie met drie kaarten (schade, motoren, replay-editor), elk met een loop of screenshot uit punt 10 tot 15.
- **Galerij "In the game"**: van 5 naar 8 beelden, aangevuld met punt 16, 17 en 18.
- **Docs**: punt 12, 15 en 18 ook bij hun sectie in `docs.html` (Motorcycles, Takes and the video editor, Tyres, fuel and pit stops).
