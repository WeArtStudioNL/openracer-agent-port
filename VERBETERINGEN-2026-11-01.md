# OpenRacer: verbeteringen in de nacht van 1 november 2026

- Tijd: ongeveer 05:50 tot 07:30 (de klok van de Mac), en daarna door tot je terug was.
- Branch: `claude/soft-body`. Alles staat **lokaal gecommit**. Er is niets gepusht, niets gedeployed en niets op Discord gezet.
- Jouw eigen werk in `web/cars` en `web/tracks` (de dune buggy, het nieuwe Stadium Truck-model, de Desert) heb ik niet aangeraakt.

## Kort

- Ik heb in **29 commits** (sinds 05:51) gewerkt aan de soft body, de motorbouw, eigen auto's bouwen in de car-editor, gamepad-bediening, records per setup, AI-motoren, het raceverloop, de Garage (delen van auto's en banen) en een reeks UX-punten.
- Na elke grote wijziging heb ik een onafhankelijke review of audit laten doen (vijf reviews, plus audits van de motorbouw, de car-editor, de races en de Garage). Elke bevinding heb ik zelf nagelopen en zo nodig opgelost.
- Alles is getest in het spel zelf, vanuit JavaScript aangestuurd. Het browservenster stond verborgen; daar loopt de animatielus niet. Hoe het er in beeld uitziet, heb ik maar op enkele screenshots gezien.

## Wat er is gedaan

### Soft body (`6600220`)
- **Deuken waren 2× te diep.** Het anker trok aan `u − q`, maar de node stond op `rest + u + q`. Nu rekt het anker alleen het elastische deel en schuift dat bij vloeien naar de blijvende vervorming. Een muur 10 cm in de neus van de hatchback gaf eerst 10,9 cm deuk, nu 7,9 cm.
- **Kreukelzone:** een node die 35 cm is ingedeukt is platgedrukt en geeft de volle kracht door. Eerst kon een node meters de auto in.
- **Breken:** een balk knapt bij 40 % blijvende rek. Ankers scheuren niet op hun vervorming: dat liet groepen nodes als één stuk wegvliegen.
- Rijden, landen en bochten zijn gelijk gebleven (hatchback en Muscle, de tests van `physics-check.html`).

### Motorbouw (audit van 15 punten; `0a1c7e1`, `e0641bc`, `4c28619`)
- Een motorwissel is meteen de nieuwe motor: de koppeling (eerst 144 Nm voor een V8 met 490 Nm), de motorrem, two-step, launch, CVT, stall, pops en anti-lag volgen. Het geluid krijgt het karakter van het nieuwe blok.
- **Turbo dubbel geteld:** de kromme van een gebouwde motor heeft de boost al. Bij 2000 tpm gaf een V8 met turbo 65 % van zijn kromme, nu 99 % (na de lag).
- **Gewicht:** een motorwissel verandert het gewicht (V8 in de hatchback +177 kg, V12 in de kart +237 kg).
- **E85** verbruikt 35 % meer per liter.
- Lege velden geven geen motor zonder vermogen meer. Er is een knop **Stock block**. Een getypte negatieve waarde wordt niet meer verkeerd afgekapt. Wisselen van setup vraagt eerst. ↺ zet terug naar de gekozen setup.
- De topsnelheid rekent met de band van de aangedreven as zoals die gemonteerd is.

### Eigen auto's bouwen in de car-editor (audit van 12 punten; `5a045e7`, `f5baeab`, `61c8be6`, `fbe212b`, `0eb616f`)
- **New** in de garage opende de eerste auto van de lijst, en een gekozen model verving dan het model van die auto. Nu: een nieuwe auto, en bij een open auto de vraag "vervangen of nieuwe auto?".
- **Testbank:** elke test van een nieuwe auto werd geweigerd, en het demowiel werd in de verkeerde map gezocht. Nu rijdt de bank het demowiel. Grijze wielen laten zien waar de wielen komen.
- **Export zip** voor elke opgeslagen auto, ook een auto van de lokale server (jouw werkwijze voor #car-mods), met een `.gltf` inclusief `.bin` en texturen.
- **Make a copy** verliest geen velden meer; in de track-editor blijft bij een kopie de racelijn.
- Het onderdelenvenster slaat alleen onderdelen en schaal op, niet het hele formulier.
- Verder: een `.glb` met vreemde tekens wordt bij het importeren hernoemd, en uitlaatpunten zijn terug te draaien. Fouten blijven staan tot je ze wegklikt, en de editor past beter op kleinere schermen.

### Gamepad (`99355c9`, `024818f`)
- **Start** pauzeert en hervat. De **D-pad** of stick beweegt door de menu's, **A** kiest, **B** gaat terug, en links/rechts verandert schuiven en lijsten.
- Alleen voor een controller met de standaardindeling, zodat stuurpedalen de menu's niet verstoren. Een knop toewijzen met de controller werkt.

### Records en ghosts (`825759b`, `3cf6637`)
- Een record en een ghost per setup (`auto~setup`); oude records blijven bij de standaardauto.
- Ghosts zijn 2,4× kleiner opgeslagen. Bij een volle opslag verdwijnen eerst de oudste andere ghosts, maar alleen als dat genoeg ruimte geeft.
- Na tunen op de skidpad wordt de gemeten grip bewaard voor de getunede auto.

### AI-motoren (`32372d8`, `4c28619`)
- In een race van 150 s gingen de 600cc en de supermoto 7–9 keer onderuit, nu 1 keer. Drie oorzaken:
  - de ophangingsnodes van een motor stonden 50 cm opzij;
  - de AI rekende met de grip van een auto;
  - de helling was een deel van de maximale helling in plaats van de helling die de bocht vraagt.

### Races (audit van 12 punten; `41af273`, `c33e319`)
- **Gevonden en opgelost: een auto kon "NaN" worden.** Eén frame zonder tijd (twee frames binnen dezelfde milliseconde) deelde een stap van 0 s door zichzelf. Daarna waren brandstof, slijtage, massa en de hele auto geen getal meer, voor de rest van de race. In een test werd de kart van de speler zo onbruikbaar, en het verklaart de "place that is not a number"-meldingen. Mogelijk speelde dit ook mee bij het zwarte scherm van gisteren. Zo'n frame doet nu niets.
- **De uitslag** werkt met gamepad en toetsenbord ("Race again" heeft de focus). "Race again" vraagt eerst naar een niet-bewaarde replay. De uitslag past op een telefoon, verdwijnt in de replay en toont hoeveel ronden een auto achter ligt.
- **HUD:** afstand tot de auto voor en achter je, brandstof in ronden, en beide redenen voor een pitstop. Het banden-/brandstofpaneel schuift mee onder de rondetijden.
- **Regels:**
  - Een gemiste gate meldt dat de ronde niet telt.
  - *Backspace* in een race repareert, maar geeft geen gratis banden of brandstof meer, en de ronde telt niet als record.
  - De ghost wacht tot GO.
  - Een AI die achteruit over de streep rolt, krijgt geen nep-ronde meer.
  - Een AI die wacht op een pitstop die nooit begint, rijdt na 6 s verder.
- De fly-by is met A over te slaan.

### Garage en delen (audit van 12 punten en een review; `3820dbf`, `f0f0050`, `3ad03c4`)
- **Zips die niet importeerden, doen het nu:**
  - een zip met `car.json` in de hoofdmap (wat Finder of Verkenner maakt van geselecteerde bestanden) liet het importeren crashen;
  - een Windows-zip met backslashes;
  - een model in een submap;
  - een `.gltf` met losse `.bin` en texturen.

  Alle vier getest in het spel, de `.gltf` los in Node.
- **Meerdere zips** worden elk apart geïmporteerd, met een overzicht van wat wel en niet lukte. De melding staat bovenaan.
- **Gekoppelde map** neemt mappen als `Dune Buggy` mee (die werden zonder melding overgeslagen).
- **Een setup van een andere auto** neemt alleen de tuning over. Een motorsetup maakte de hatchback een motor met de wielen van de motor. Getest: de hatchback houdt zijn naam, wielen, spoorbreedte, wielbasis en gewicht.
- **De ghost van een vriend** geldt per baan en auto (hij verving je eigen beste ronde bij elke auto). Een oude vriend-ghost wordt overgenomen. *Download* van een bewerkte replay geeft de bewerking.
- Uit de review: bijbestanden in een submap van een gekoppelde map worden gevonden, twee mappen met dezelfde naam botsen niet meer, en een zip zonder naam krijgt een vaste id (dezelfde zip twee keer importeren overschrijft in plaats van te verdubbelen).

### Menu's en kleine punten
- **Tune the car** staat bovenaan het pauzemenu.
- Het hoofdmenu zegt *Setup*, niet *tune*. Lege kaarten in het tuningmenu zijn weg, en de topregel geeft de echte topsnelheid.
- Onderdelen breken op een trage pc niet meer bij de halve kracht.
- De vlammen laden één keer, zonder 404.
- `<html lang="en">` op de pagina's.

## Wat ik heb geprobeerd en heb laten liggen

- **AI-inhaalgedrag** (alleen inhalen als hij sneller is): oud en nieuw maten gelijk (3 crashes, 1,6 m naast de lijn). Zonder bewijs heb ik het niet ingebouwd.
- **Motor die na een harde landing terugstuitert:** dat was al zo vóór vannacht. Zodra de vork doorslaat (vanaf een val van ongeveer 4 m) kaatst de motor terug: 3,8 m/s bij 4 m, 5,3 m/s bij 6 m, 8 m/s bij 10 m. Ik heb twee dingen geprobeerd: meer demping in de aanslag en een aanslag met hysterese. Geen van beide hielp genoeg, dus de veerkracht zit waarschijnlijk in de band. Dit vraagt een eigen afstemronde; ik heb het teruggedraaid.
- **CPU:** met 7 AI-auto's kost een frame ongeveer 12 ms. De speler kost 3,7 ms terwijl hij stilstaat, vooral door de schaalbanden; daarvoor bestaat de instelling banddetail al. Een snelle grote winst zag ik niet.

## Wat je zelf moet bekijken of beslissen

- **Testen in het echt:** deuken en breken tegen de AI, de motoren in een race, en de car-editor met een eigen model.
- **Stadium truck: 20 pk.** Jouw niet-gecommitte `car.json` heeft een V8-bouw met een boring van 40 mm, nokduur 200 en inlaat 49 (20 pk, 37 Nm). Dat lijkt per ongeluk.
- **Kartbaan Oldenzaal** draagt nog de naam van de echte baan.
- **Live zetten:** pas na jouw akkoord.
