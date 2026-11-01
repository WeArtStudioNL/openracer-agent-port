# TODO

Openstaande punten voor later. Bijgewerkt op 30 oktober 2026. De nummers met § verwijzen naar `AUDIT-2.2.0.md`.

## Vóór de release

- **Modellen, namen en texturen vervangen** die niet van ons zijn. Glenn vervangt ze zelf; daarna zijn licenties niet meer nodig en kan `CREDITS.md` worden opgeschoond. Bezig: `hyundai-i30` heet nu `hatchback`, en TT Assen heet `netherlands1`. Nog bijwerken: `index.json` van de auto's, de docs, de changelog, de README en de URL-voorbeelden met `hyundai-i30`.
  - De modellen: i30, Trophy Truck, muscle car, `Kart.glb`, go-kart, 600cc en `driver.glb`.
  - De banen: Kartbaan Oldenzaal en TT Assen, met de namen van de echte circuits.
  - De textures van Circuit: de SAMSUNG-borden.
  - Verder: de banner, de 17-203 velg en band, de vlammen en `tyre-squeal.wav`.
- **De i30**: de motorbouw geeft 96 Nm en 75 pk, terwijl de beschrijving 164 Nm en 135 pk zegt.
- **De OpenRacer Muscle**: 913 pk, 391 km/h en 4 versnellingen. Is dat zo bedoeld?
- **`differential.glb`**: het lege bestand van 132 bytes is vervangen door de vorige versie. Klopt dat? Het lege bestand staat in de backupmap `openracer-softbody-originals-2026-10-30/`.
- **Screenshots en video's** voor de site en de docs: grotendeels binnen en op de site gezet (31 oktober). Nog te leveren: de nieuwe promovideo en poster, de Garage en een stilstaande pitstop. Zie `MEDIA.md`.
- **Live zetten** pas na akkoord: push, merge naar master, deploy en Discord.
  - De index-bestanden worden live met de hand bijgewerkt.
  - `--delete` verwijdert de Mustang-mappen op de server.
- **De servers op poort 8000 en 8132** herstarten, zodat de nieuwe `serve.py` geldt.

## Rijden en AI

- **Soft body**: de dubbele deuk (§3.1) en het nooit-breken (§3.2) zijn opgelost op 1 november 2026 (commit 6600220, nog niet live). Nog doen: in echte races testen of de deuken en het breken goed voelen, ook tegen de AI. Per auto in te stellen met `softbody.anchor.max_bend` en `softbody.beam.break_strain`.
- **AI-motoren** vallen nog ongeveer elke 20 s.
- **AI-auto's** raken elkaar soms in een pack en slaan om.
- **AI-grip zonder skidpad-meting.** Zonder meting schat de AI de grip uit `tyres.grip` in car.json, en die schatting zit er soms ver naast. De i30 houdt 0,91 g bij `grip: 1`, de Muscle 1,77 g bij `grip: 1.15`. Beter: een automatische meting per auto en setup, op de achtergrond bij het laden.
- **Skidpad na live tunen**: als je tijdens de skidpad het tuningmenu opent, wordt de meting niet bewaard. De setup is dan niet meer wat een race laadt. Oplossing: de meting bewaren onder de getunede config, zodra die als setup is opgeslagen.
- **Downforce**: de skidpad meet bij lage snelheid. Bij een auto met veel downforce rijdt de AI daardoor te voorzichtig in snelle bochten. Daar moet het leren het overnemen.
- **AI blijft lang naast een andere auto rijden** om in te halen (2,6 m naast de lijn). Dat kost in de bochten tijd en banden. Beter: alleen uitwijken als hij echt sneller is, en anders achter de auto blijven.
- **Bandenslijtage per rijstijl**: de AI slijt ongeveer 0,8% per ronde op Circuit, de autopilot op skill 0,85 ongeveer 2,6%. Een echte rijder ligt daarboven. Controleren met een echte race. Moet *Fast* (3×) sneller?
- **Pitstraat van de AI** wordt nu automatisch opgebouwd uit het pitvak en het "track01"-wegdek. Alleen getest op Circuit. Een pitlijn tekenen in de track-editor blijft betrouwbaarder (zoals Kartbaan Oldenzaal en TT Assen hebben).
- **Ghosts en records** per setup of instelling (§3.7).
- **localStorage loopt vol** (§3.8). Overstappen op IndexedDB?

## Editors

- ~~Bij "Make a copy" (opslaan onder een ander id) gaan velden verloren (§3.24).~~ Opgelost in beide editors op 1 november 2026.
- ~~De autosave van het onderdelenvenster schrijft het hele formulier weg (§3.28).~~ Opgelost 1 november 2026.
- ~~Wisselen van tune in de car-editor gooit wijzigingen weg zonder te vragen (§3.22).~~ Opgelost 1 november 2026.
- De editor-pagina's laden hun scripts zonder `?v=`.

## Nieuwe functies

- **Gamepad** voor de menu's en het pauzemenu (§4.13).

## UX: ontwerpkeuzes voor Glenn

- Contrast van wit op oranje (§4.20).
- De toetsen P en I doen hetzelfde (§4.27).
- Instellingen die op meerdere plekken staan (§4.23).
- Woordkeus en volgorde van de knoppen (§4.24).
- Het tuningmenu zit verstopt onder Tools (§4.10).

## Klein

- Twee 404's op Circuit: `buildings2_512.jpg` en `grasst.png`. Daarnaast zoekt de game naar `flame4.png`.
- `tools/physics-bench.js` en `tools/tyre-bench.js` verwijzen nog naar de verwijderde Mustang.
