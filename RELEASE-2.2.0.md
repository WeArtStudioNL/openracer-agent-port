# Release 2.2.0: voorbereid, niets live gezet

Bijgewerkt op 31 oktober 2026. Niets hieronder is uitgevoerd tegen een server of GitHub; het wacht op akkoord van Glenn.

## Wat er nu online staat

- Game op https://openracer.eu/game/: **2.1.0** (`Version.js`). GitHub `master` en `claude/wheel-support`: 6a1a6b5. Tags: v2.0.0, v2.0.1, v2.1.0.
- Lokaal: **2.2.0** op `claude/soft-body`, 628 commits voor op `master`. `Version.js` en `web/index.html` (`bootstrap.js?v=2.2.0`) staan al op 2.2.0, `CHANGELOG.md` en `site/docs.html` hebben de sectie 2.2.0.

## Wat uit de release blijft

- **`web/tracks/netherlands1/`** (Glenn maakt deze baan nog; `assen.glb` is bovendien 107,7 MB, boven de 100 MB-grens van GitHub). Het staat in `.git/info/exclude`, de gecommitte `web/tracks/index.json` noemt de baan niet. In de werkmap staat `netherlands1` nog wel in `index.json`, voor Glenns eigen gebruik. Bij het deployen: `--exclude tracks/netherlands1` toevoegen aan de rsync van de game.
- `.claude/launch.json` (lokaal).

## Al gecommit uit Glenns werkmap

Hatchback in plaats van de i30, nieuwe OpenRacer Muscle, twee driveline-onderdelen, de banen Short track en Desert drag strip, Circuit en TT Assen weg, en de audit-documenten. De namen `hyundai-i30`, `TT Assen` en `Circuit` staan nog in `README.md`, `CHANGELOG.md`, `site/docs.html` en `TODO.md`: bijwerken zodra de namen vast zijn.

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
4. Deploy (zie het geheugen `openracer-deploy`): site met `rsync -az --exclude .DS_Store site/ weartstudio2:openracer.eu/`, game met `rsync -az --delete ... web/ weartstudio2:openracer.eu/game/`. Eerst een `--dry-run`: `--delete` haalt de Mustang-mappen en oude `hyundai-i30`/`circuit`/`tt-assen` van de server; voeg `--exclude tracks/netherlands1` toe. De `index.json`-bestanden van de auto's en banen worden live met de hand bijgewerkt (`--exclude cars/index.json --exclude tracks/index.json`).
5. Controleren met een checksum-dry-run en de live pagina's.
6. Discord: een bericht in `announcements` en in `changelog` (Engels, zonder @mentions).
