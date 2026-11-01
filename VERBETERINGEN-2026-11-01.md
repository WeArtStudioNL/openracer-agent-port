# OpenRacer: verbeteringen in de nacht van 1 november 2026

- Tijd: ongeveer 05:50 tot 07:30 (de klok van de Mac), en daarna door tot je terug was.
- Branch: `claude/soft-body`. Alles staat **lokaal gecommit**. Er is niets gepusht, niets gedeployed en niets op Discord gezet.
- Jouw eigen werk in `web/cars` en `web/tracks` (de dune buggy, het nieuwe Stadium Truck-model, de Desert) heb ik niet aangeraakt.

## Kort

- Ik heb in **70 commits** (sinds 05:51) gewerkt aan de soft body, de motorbouw, eigen auto's bouwen in de car-editor, gamepad-bediening, records per setup, AI-motoren, het raceverloop, de Garage (delen van auto's en banen), de track-editor, de eerste keer spelen, replays en video, het racegedrag van de AI, het tuningmenu, onderdelen en shell in de car-editor, de vensters van het hoofdmenu en een reeks UX-punten.
- Na elke grote wijziging heb ik een onafhankelijke review of audit laten doen (negen reviews, plus audits van de motorbouw, de car-editor (twee keer), de races, de Garage, de track-editor, de eerste keer spelen, replays, de AI, het tuningmenu en de vensters van het hoofdmenu). Elke bevinding heb ik zelf nagelopen en zo nodig opgelost.
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

### Track-editor (audit van 12 punten en een review; `49bdbe5`, `357b90a`, `7a43b48`, `2b6178d`, `3d5e83b`, `b65f0e9`)
- **De AI reed een oude ronde.** De beste ronde die op deze computer gereden was, ging vóór de opgeslagen racelijn, ook nadat je de weg of de lijn had veranderd. Daardoor reed de AI de nieuwe muren in. Een baan krijgt nu een datum bij elke wijziging van de lijn of de weg, en alleen rondes van daarna tellen. Een record van de oude weg wordt bij de volgende ronde vervangen.
- **Record AI racing line** gooide niet-opgeslagen gates weg; daarna telde geen ronde meer. Nu slaat hij eerst op.
- **Opslaan zegt wat er nog mist:** geen gates, of geen racelijn op een modelbaan. Die melding blijft staan tot je erop klikt. Een foutmelding verdwijnt ook niet meer na 7 s.
- **Nieuw:** *Test drive* (opslaan en de baan in een nieuw tabblad rijden) en *Export zip* (`track.json`, het model, de objecten, de lucht en de thumbnail). Een baan van de lokale server kon nergens als zip gedeeld worden.
- Vragen vóór *Clear the grid*, *Clear the pit boxes*, *Clear the pit line* en *Forget the line*. Ook vóór de hoogtekaart en de startdialoog werk vervangen.
- Een thumbnail van baan A werd de foto van baan B. Schalen of kantelen van objecten telde niet als wijziging. Een negende gridvak verving vak 8. Delete wiste op een getekende baan ook de gekozen node.
- Een `.gltf` met texturen in een submap had in de game geen texturen: de verwijzingen worden bij het importeren plat gemaakt.
- Het kaartje *Sky and light* zegt nu dat de game alleen de sterkte van het licht gebruikt (lucht, mist en zon komen uit het weer en de tijd van de speler).

### Eerste keer spelen (audit van 12 punten en een review; `2ddbeb2`, `5f14774`, `b65f0e9`)
- **Restart** in het pauzemenu. Een spin in ronde 1 betekende alle ronden uitrijden of het hele menu opnieuw.
- **Bij de eerste race** een paneel met de belangrijkste toetsen (of padknoppen), één keer. De HUD zegt *Esc: pause, restart, settings and controls*, met een pad *Start*.
- **De race pauzeert** als je tunet (eerst reden de AI door terwijl je las) en als het venster de focus verliest. Esc en U sluiten het tuningmenu. De pauze wordt per reden vastgehouden, zodat het menu, het tuningmenu, de HUD-editor en een Take elkaars pauze niet opheffen.
- **Een korte melding** als C, B, N, Y, J of E een rijhulp of het geluid aan- of uitzet. F2 en F3 openen niet meer de zoekbalk van de browser.
- **De vrije camera** komt niet terug bij de volgende start. Hij nam W, A, S, D en Space over, en de auto reed niet.
- **Gamepad:** knoppen heten A, B, LB, RT enzovoort in plaats van "Button 7". Camera op X en repareren op Back, ook voor spelers met opgeslagen bediening.
- Een link naar een auto of baan die er niet is, zegt nu waarom je in het menu staat. De replayvraag komt niet meer bij minder dan een minuut. Een laadtekst bij het eerste bezoek.
- **Telefoon:** een woordje onder elke knop bovenaan (*Reset*, *Repair*, *Record*…), en op een smalle telefoon twee kolommen rechts in plaats van een rij over de rondetijd.

### Replays en video (audit van 10 punten; `ef76326`, `898ebf6`)
- **De video-editor vanuit een race** gooide de race weg zonder te vragen. Als je de editor dan sloot zonder op te slaan, was de race weg. Nu vraagt hij eerst en bewaart hij de race in Replays.
- **Save as mp4 was niet te stoppen** zodra je de afspeelkop aanraakte: de opname liep eindeloos door en er kwam nooit een bestand. Nu stopt hij daar en slaat hij de video op tot dat punt.
- **Esc verliet de video-editor** zonder te vragen. Nu niet meer.
- **Een Take als replay opslaan** markeerde de hele race als bewaard. De vraag bij verlaten kwam dan niet, en de race ging verloren.
- *Save replay* in de balk maakte bij elke klik een kopie. Nu één keer, met de reden als het niet lukt.
- **Een replay onthoudt de setup** van elke auto en speelt hem daarmee af. Eerst kwam de auto terug met de setup die nu gekozen is, met andere wielen of zonder deuken.
- Look-ahead-keys schuiven mee bij het trimmen. De knoppen van de replaybalk houden geen focus meer, zodat Enter weer afspelen en pauzeren is.
- **Een bewerkte replay toont nu schade**, losgeslagen onderdelen, de berijder als ragdoll, sliprijen, rook en vonken van wat hij afspeelt (`16587dd`). Eerst was een auto na een crash weer heel en stond hij op vier wielen. Getest: een bewerking met een sprong terug en slow motion neemt precies de sliprijen van de afgespeelde stukken mee.
- **Watch van een bewerking** gebruikt nu de camera die je per clip koos: volgcamera, cockpit of cinematic met zijn look-ahead (`0272ffe`). Getest: een bewerking met cockpit tot 5 s en daarna de volgcamera wisselt op 5 s.

### AI (audit van 9 punten; `e0f262b`)
- **De AI reed van achteren op een langzamere auto.** Hij keek maar 25 m vooruit en remde met een factor op zijn eigen snelheid. Vanaf 15 m/s snelheidsverschil raakte hij de auto voor hem. Nu kijkt hij zo ver vooruit als nodig en rijdt hij niet sneller dan hij nog achter die auto kan stoppen.
- **Twee auto's naast elkaar** zagen elkaar allebei als de auto ervoor en remden allebei hard in de bocht. Nu telt alleen een auto die echt voor ligt.
- **Remmen:** de AI kijkt 0,35 s vooruit (eerst 8 m) en remt harder bij te veel snelheid. Hij kwam 10 tot 20 % te snel de bochten in.
- **Normal werd na een paar ronden even snel als Hard**, omdat hij leerde tot het plafond. Nu leert elke moeilijkheid apart, en onder Hard telt maar een deel van het geleerde.
- **De tegenstanders zijn van jouw soort:** auto's tegen auto's, karts tegen karts, motoren tegen motoren. Eerst raceten de eerste auto's van de lijst, bijvoorbeeld een Muscle tegen een kart.
- **Lege plekken op de tegenstanderspagina** kregen geen auto, terwijl de pagina zei dat ze gevuld zouden worden. Nu wel.
- **Nieuw: *Your start*** in de race-opties: pole (zoals het was), willekeurig of als laatste (`68468aa`). De speler stond altijd vooraan en won de race in de eerste bocht.
- **Gemeten** op de Short Track met 5 AI over 150 s: oud 2 keer teruggezet, nieuw 0. De Muscle is 1 % langzamer (114,7 tegen 113,5 s).
- **Uit de review** (`1588cd0`): een AI achter een stilstaande auto (de speler die spinde, een gecrashte auto, de rij bij een pitstop) wacht nu. Eerst kroop hij, reed achteruit tegen de auto achter hem en werd als crash teruggezet. Na 6 s rijdt hij eromheen, na 15 s zonder voortgang wordt hij zonder strafpunten verder gezet. De auto ervoor wordt gezocht langs de racelijn: in een bocht zag hij een stilstaande auto pas op 9 m. Getest: hij stopt 5 m erachter en rijdt er daarna omheen.
- **Downforce** telt nu mee in de bochtsnelheden en het remmen van de AI. Een auto met vleugels was te langzaam in snelle bochten.
- **Bandenslijtage** telt mee in de bochtsnelheden van de AI (`4ba3789`): hij reed met versleten banden de snelheden van nieuwe.
- **Gevonden bij het testen:** een auto met een oneindige hoek (na een physics-explosie) liet een `while`-lus eeuwig draaien, en de hele game bevroor. Vijf van die lussen zijn vervangen.
- **Laten liggen:** een gecrashte AI wordt gratis gerepareerd (zonder reparatie crasht hij meteen opnieuw, zo staat het in de code). Dat vraagt een eigen ronde.

### Tuningmenu en setups (audit van 10 punten; `40b6b2e`)
- **Een setup met meer versnellingen** dan de auto waarmee je startte, kreeg verzonnen verhoudingen voor de extra versnellingen, en het rooster bleef bij 4 vakjes. Op *Save* gingen die verzonnen waarden de setup in. Getest: een 8-traps setup op de Muscle (4 versnellingen) komt nu heen en terug met zijn eigen 8 verhoudingen.
- **Default vergeleek met de setup** waarmee de race begon. Alles stond oranje, ↺ ging naar die setup, en terugwisselen vroeg naar "niet-opgeslagen" wijzigingen. Getest: Default toont nu 0 gewijzigde waarden.
- **De tuning werd bewaard** als verschil met de setup van de start. Na een wissel of na *Delete* was de auto bij de volgende start een andere auto. Nu wordt hij bewaard als verschil met de gekozen setup.
- **Op een telefoon** viel de linkerkant van het paneel buiten beeld. Een paneel dat op een groot scherm versleept was, hing op een kleiner scherm 350 px onder het venster.
- **Gamepad en pijltjestoetsen** werken in het paneel. Een schuif liet de focus los na één stap, en een controller deed niets in het paneel.
- Getypte percentages die een aandeel zijn (remverdeling, gewicht vóór, sperdifferentieel) blijven tussen 0 en 100. Een typfout van 655 % gaf de achterremmen negatief koppel.
- **Uit de review** (`8ed7bd6`): in free drive bediende de controller tegelijk de auto en het menu. A (handrem) op een gefocuste *Save* overschreef de setup. Nu werkt de controller alleen in het menu als dat de race stilzet. Een setup met minder versnellingen gaf meteen "(changed)", en een wijziging aan versnelling 6 van een 8-traps setup werd niet gezien. Downforce werd dubbel geteld bij een gemeten skidpad-grip.
- Het gewicht van de berijder op een motor gaf na *Save* een zwaardere motor. Nogmaals op dezelfde setup klikken in het hoofdmenu wiste de tuning. De downforce-labels noemen ook mph.

### Eigen auto's: onderdelen, shell en bestuurder (audit van 9 punten; `2906c7a`)
- **De autosave van het shell-venster sloeg soms de hele auto op**, zonder klik, met half ingevulde velden. Dat gebeurde na *Replace the model* of *Make a copy*, en het oude model verdween dan uit de map. Nu slaat hij alleen de shell en de onderdelen op, en anders vraagt hij om *Save*.
- **De knooppunten van de shell schoven** zodra je het zwaartepunt of de band veranderde nadat je ze getekend had (10 cm onder de carrosserie). De shell onthoudt nu bij welk zwaartepunt en welke band hij getekend is.
- **De bestuurder uitzetten** en opslaan wiste zijn hele instelling: positie, handen, toetsen en botten. Nu blijft hij in `car.json`, uitgeschakeld.
- **Slepen** met de bestuurder, handen, voeten of de ophangingspunten telde niet als wijziging. Weggaan verloor het werk zonder te vragen. Elke sleep is nu ook een eigen stap voor Ctrl+Z.
- **Ctrl+Z bij het bewerken van knooppunten** zet de knooppunten terug; een losse Delete was na een seconde definitief opgeslagen. *Remove part* en *Back to the defaults* vragen eerst.
- **Sterktes op losse knooppunten** hoorden bij een nummer dat kon verschuiven: bij een ander *Max nodes* landden ze op andere knooppunten. Nu wordt de layout vastgezet.
- **Waarschuwing** als het model, de schaal of de draaiing verandert terwijl er al punten op het model staan.
- **Uit de review** (`4be7dd1`): bij een motor zonder `layout_cg` (de 600cc en de supermoto) schreef de nieuwe code `layout_cg: null` in `car.json`, want `isFinite(null)` is in JavaScript `true`. De game zou de shell dan 25 cm verschuiven. Dat is gerepareerd voordat het ooit is opgeslagen; geen enkele `car.json` heeft het. Verder: de berijder in een bewerking zat in zijn crashhouding vanaf de eerste frame, de undo van knooppunten nam de knooppunten van de vorige auto mee, en Watch van een bewerking liet de cockpitcamera staan voor de volgende race.
- **Met het demowiel** (Dynamic wheels zonder velg uit de bibliotheek) bouwt de game nu ook de draagarmen, de as en de aandrijflijn uit de onderdelenbibliotheek (`a8a078c`). Eerst toonde de editor ze, maar ontbraken ze in de game. Getest: de hatchback met het demowiel en double wishbone bouwt de onderdelen; de wielbasis en spoorbreedte van de auto blijven ongewijzigd.

### Garage en Replays in het hoofdmenu (audit van 10 punten; `8282316`)
- **Escape of B sloot de Garage** zonder dat het menu de nieuwe lijst kreeg. Een geïmporteerde auto stond er niet, een verwijderde nog wel, en Start stuurde je dan terug met "not here".
- **De Garage leest de lijsten opnieuw** na een import, zodat een nieuwe auto meteen een plaatje heeft en in *Load* staat.
- **De tegels in *Load*** werken met Tab, Enter en een gamepad; eerst was alleen *Cancel* bereikbaar.
- **Op een telefoon** lopen de rijen van Garage en Replays niet meer buiten beeld.
- **Meldingen** komen in beeld, ook als je naar beneden gescrold was. Bij een volle opslag staat er wat je kunt doen. Een mislukte delete van een replay wordt getoond.
- **Een item met alleen instellingen** zegt nu dat de auto van de game blijft (als de game er een heeft). Een gekoppelde map zegt hoeveel auto's en banen hij vond.
- **Uit de review** (`a0e5e35`): de melding na het koppelen van een map werd meteen gewist, en de lijst kon dubbel verschijnen als je meteen importeerde. Met het demowiel stonden de draagarmen 24 cm naast de wielen bij een auto met een asverschuiving (`front_axle_offset`). Die staan nu op de wielen; de editor tekent ze daar nog met de verschuiving.
- **Na een herstart van de browser** vraagt een gekoppelde map opnieuw om toestemming. De auto- en baanstap zeggen dat nu, met een knop *Allow*. Eerst ontbraken de auto's uit de map zonder melding.

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
- **Stadium truck: banden blijven koud.** In een test hadden zijn banden een conditie van 0,6 (de andere auto's 0,95), ook zonder slijtage. Dat komt waarschijnlijk uit jouw niet-gecommitte `car.json`. De AI rijdt hem daardoor nu langzamer, passend bij de grip die hij echt heeft.
- **Motorbanden blijven koud.** In een race van 150 s bleven de banden van zowel jouw motor als die van de AI rond 45–53 °C, met een grip van 0,6 tot 0,75. Dat is de afstelling van de motorbanden (opwarmen tegenover koelen). Ik heb het niet veranderd. De AI houdt er nu wel rekening mee (`33cccdd`), en de supermoto rijdt even snel als vóór vannacht (gemeten: 59 % van een ronde na 99 s, zowel oud als nieuw, 0 crashes).
- **Kartbaan Oldenzaal** draagt nog de naam van de echte baan.
- **Live zetten:** pas na jouw akkoord.
