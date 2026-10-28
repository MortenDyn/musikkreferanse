# Lyttestasjon

Komponister og artister fra middelalder til elektronika, med 30-sekunders lydklipp, sentrale verk, filter på verktype og videoklipp. Fungerer som nettside og som installerbar app på mobil (PWA).

## Slik henger det sammen

```
scripts/lister.mjs      komponistlistene (én fane per epoke/sjanger, hver person står ett sted)
scripts/bygg-data.mjs   «agenten»: henter fra Open Opus, iTunes og YouTube, skriver JSON
cache/                  rådata fra forrige kjøring, så bare nye/gamle oppføringer hentes på nytt
docs/                   nettsiden (GitHub Pages serverer denne mappen)
docs/data/*.json        ferdige data som nettsiden og mobilen leser
.github/workflows/      kjører bygg-data hver mandag og publiserer resultatet
```

Datainnhentingen er et vanlig Node-script uten KI, så daglig drift bruker ingen tokens. Claude trengs bare når du vil endre noe.

## Kilder

| Kilde | Gir | Nøkkel |
| --- | --- | --- |
| [Open Opus](https://openopus.org) | Sentrale verk og verktype (klaver, orkester, kammer, opera/scene, vokal) for klassiske komponister | Nei |
| iTunes Search API | 30-sekunders lydklipp, cover, lenke til Apple Music | Nei |
| YouTube Data API v3 | Inntil tre videoer per komponist (opera, konsertopptak, filmscener) | Ja, gratis |

Verktypen kommer fra Open Opus når sporet hører til et kjent verk, ellers gjettes den fra titler (Sonata, Concerto, Quartet …). Filmfanen er alltid «Filmmusikk», musikalfanen alltid «Opera og scene».

## Lokalt

```powershell
node scripts/bygg-data.mjs                 # alle faner (første gang ca. 1–1,5 time pga. iTunes-grensen)
node scripts/bygg-data.mjs --fane barokk   # bare én fane
node scripts/bygg-data.mjs --frisk         # ignorer cache og hent alt på nytt
node scripts/serve.mjs                     # åpne http://localhost:8080
```

Med video: `$env:YOUTUBE_API_KEY = "din-nøkkel"; node scripts/bygg-data.mjs`

## YouTube-nøkkel

1. Gå til <https://console.cloud.google.com/>, lag et prosjekt og slå på **YouTube Data API v3**.
2. Lag en API-nøkkel under *Credentials*.
3. Legg den inn på GitHub: repoet > *Settings* > *Secrets and variables* > *Actions* > `YOUTUBE_API_KEY`.

Gratiskvoten gir ca. 100 søk per døgn. Scriptet gjør maks 90 per kjøring og husker treffene, så alle komponistene får video i løpet av noen ukentlige kjøringer (eller kjør workflowen manuelt et par dager på rad).

## Endre listene

Rediger `scripts/lister.mjs` og kjør scriptet, eller kjør workflowen *Oppdater data* manuelt på GitHub.

## På mobil

Åpne nettadressen i Safari (iPhone) eller Chrome (Android) og velg **Legg til på Hjem-skjerm**.

Du trenger ingen kommando for å bruke appen. Den ligger på nett, så du åpner bare https://mortendyn.github.io/musikkreferanse/ i nettleseren. Det gjelder både på PC og iPhone.

Kommandoen trengs bare hvis du vil kjøre appen lokalt fra filene på PC-en, for eksempel for å teste endringer før de publiseres. Kjør den fra prosjektmappen:

```powershell
node scripts/serve.mjs
```

Åpne deretter http://localhost:8080 i nettleseren. Trykk **Ctrl + C** i terminalen for å stoppe serveren.

Andre kommandoer i prosjektet:

| Kommando | Hva den gjør |
| --- | --- |
| `node scripts/bygg-data.mjs` | Henter nye data (verk, lydklipp, videoer) for alle faner |
| `node scripts/bygg-data.mjs --fane barokk` | Henter data for bare én fane |

Datahentingen kjøres uansett automatisk på GitHub hver mandag, så du trenger sjelden å gjøre den selv.
