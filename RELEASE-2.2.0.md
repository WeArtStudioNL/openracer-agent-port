# Release 2.2.0: voorbereid, niets live gezet

Bijgewerkt op 31 oktober 2026. Niets hieronder is uitgevoerd tegen een server of GitHub; het wacht op akkoord van Glenn.

## Wat er nu online staat

- Game op https://openracer.eu/game/: **2.1.0** (`Version.js`). GitHub `master` en `claude/wheel-support`: 6a1a6b5. Tags: v2.0.0, v2.0.1, v2.1.0.
- Lokaal: **2.2.0** op `claude/soft-body`, 628 commits voor op `master`. `Version.js` en `web/index.html` (`bootstrap.js?v=2.2.0`) staan al op 2.2.0, `CHANGELOG.md` en `site/docs.html` hebben de sectie 2.2.0.

## Eerst afronden (van Glenn, staat nog niet in git)

Deze wijzigingen staan alleen in de werkmap; ik heb ze niet gecommit omdat het jouw lopende vervanging van modellen is. Zonder deze commit klopt de release niet: de oude mappen zijn al weg en `index.json` verwijst al naar de nieuwe.

- Verwijderd: `web/cars/hyundai-i30/`, `web/tracks/circuit/`, `web/tracks/tt-assen/`, `web/cars/openracer-muscle/openracer-muscle.glb`.
- Nieuw: `web/cars/hatchback/`, `web/tracks/netherlands1/`, `web/tracks/short-track/`, `web/tracks/desert-drag-strip/`, `web/cars/openracer-muscle/OpenRacer muscle.glb`, `v12-rebuild.openracer-tune.json`, `web/parts/driveline/Inline-3-1-0-L.glb`, `V8-5-7-L-crossplane.glb`.
- Gewijzigd: `web/cars/index.json`, `web/tracks/index.json`, `web/cars/openracer-muscle/car.json` en `preview.webp`.
- `AUDIT-2.2.0.md`, `AUDIT-2.2.0-FIXES.md`: kies of ze mee moeten.
- De namen `hyundai-i30`, `TT Assen` en `Circuit` staan nog in `README.md`, `CHANGELOG.md`, `site/docs.html` en `TODO.md`. Bijwerken zodra de namen vast zijn.

## Open punten uit `TODO.md` "Vóór de release"

1. Modellen, namen en texturen die niet van ons zijn vervangen, daarna `CREDITS.md` opschonen.
2. Hatchback: de motor geeft 96 Nm en 75 pk, de beschrijving zegt 164 Nm en 135 pk.
3. OpenRacer Muscle: 913 pk, 391 km/h, 4 versnellingen: zo bedoeld?
4. `differential.glb`: klopt de vervanger van het lege bestand? (De backup staat in `../openracer-softbody-originals-2026-10-30/`.)
5. Promovideo en poster: `site/video/openracer-promo.mp4` is nog de video van 2.1.0.
6. De servers op poort 8000 en 8132 herstarten voor de nieuwe `serve.py`.

## Site: gedaan

Beelden van Glenn staan als WebP in `site/img/` en als loops in `site/video/` (zie `MEDIA.md`). `site/index.html`: de hero is nu de schade-foto, er is een sectie "What's new in 2.2" met drie loops (schade, motor met ragdoll, pitstop met reparatie), de galerij is van 4 naar 10 beelden en er is een rij met het weer. `site/docs.html`: beelden bij Motorcycles, Weather, Drag strip en Takes and the video editor; de alt-teksten met de Mustang zijn vervangen.

## Stappen na akkoord (de release-workflow)

1. Controleren wat online staat (versie van de game, GitHub, Discord) en lokaal een rooktest doen.
2. Als de rest klaar is: `git add` met expliciete paden voor de punten hierboven, committen.
3. Pushen en taggen (jouw akkoord nodig):
   - `git push git@github.com:WeArtStudioNL/openracer-agent-port.git claude/soft-body:claude/soft-body`
   - `master` fast-forwarden naar `claude/soft-body`, push, en tag `v2.2.0`.
4. Deploy (zie het geheugen `openracer-deploy`): site met `rsync -az --exclude .DS_Store site/ weartstudio2:openracer.eu/`, game met `rsync -az --delete ... web/ weartstudio2:openracer.eu/game/`. Eerst een `--dry-run`: `--delete` haalt de Mustang-mappen en oude `hyundai-i30`/`circuit`/`tt-assen` van de server. De `index.json`-bestanden van de auto's en banen worden live met de hand bijgewerkt (`--exclude cars/index.json --exclude tracks/index.json`).
5. Controleren met een checksum-dry-run en de live pagina's.
6. Discord: een bericht in `announcements` en in `changelog` (Engels, zonder @mentions).
