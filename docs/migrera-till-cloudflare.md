# Migrera WallFlow från Google Sheets/GAS till Cloudflare

WallFlow kör idag statiska sidor på GitHub Pages mot ett **Google Apps Script**-API som läser och skriver ett **Google Sheet** och **Google Drive**. Målet är Cloudflare: **Workers** (API), **D1** (data), **R2** (bilder) och **KV** (sessioner).

**All data ska med.** Du behöver inte klicka dig igenom D1/R2/SQL för hand — ett kommando gör import + bilder + uppladdning.

## Kör så här

Via **din Windows-dator**, samma sätt som när ni deployade: User-miljövariabeln `CLOUDFLARE_API_TOKEN` + Wrangler mot Cloudflares API. Ingen separat Cursor-ingång till Cloudflare, ingen `.env`-fil, ingen `wrangler login`.

Rätt mapp är **WallFlow-repot** (där `cloudflare\migrate.mjs` ligger), inte det andra Cloudflare-projektet där ni brukar köra `npx wrangler`.

```powershell
cd C:\sökväg\till\WallFlow

$env:CLOUDFLARE_API_TOKEN = [System.Environment]::GetEnvironmentVariable("CLOUDFLARE_API_TOKEN", "User")
node .\cloudflare\migrate.mjs C:\sökväg\till\wallflow-export.json
```

Andra radens JSON-sökväg är filen du redan har (samma som du skickade hit). Första `cd` är WallFlow-klonens rot.

Skriptet skapar D1/KV/R2 om de saknas, importerar leder/användare och laddar upp bilderna. Samma kommando går att köra om (det skriver över D1-tabellerna).

Committa inte `wallflow-export.json` — den innehåller lösenordshashar.

Worker-API:t ligger i `cloudflare/src/` (samma `{ action, token, args }`-kontrakt som GAS). `GAS_API_URL` i `index.html` / `display.html` pekar på Worker: `https://wallflow.muddy-rice-38d4.workers.dev/`.

## Målarkitektur

| Idag | Cloudflare |
|------|------------|
| GAS Web App (`gas/Code.gs`) | Worker / Pages Function |
| Sheet-flik `Alla leder` | D1-tabell `routes` |
| Sheet-flik `Grades` | D1-tabell `grades` |
| Sheet-flik `Users` | D1-tabell `users` |
| Flik `BaseUrlQr` + script property `routeLifetimeDaysDefault` | D1-tabell `settings` |
| Drive-mappen `Bilder` (`led-{nr}.jpg`) | R2-bucket, nyckel `led-{nr}.jpg` — **en bild per led**, gamla varianter raderas vid ny uppladdning (samma 1:1 som Drive) |
| `CacheService` + `PropertiesService` (sessioner 14 dagar) | KV, samma TTL — **importeras inte** |
| GitHub Pages + CNAME `wallflow.vastervikclimbing.se` | Oförändrat tills API-URL byts, eller Pages |

Kalkylark: [`1K71FH4c9FpBuxF6noBlzmF_nA5VXhAtiV84sTbPmWi0`](https://docs.google.com/spreadsheets/d/1K71FH4c9FpBuxF6noBlzmF_nA5VXhAtiV84sTbPmWi0)

## Vad som ska med

### Flytta rakt av

- **Leder** — `Nr`, `Gradering`, `Ledbyggare`, `Byggdatum`, `Anteckningar`, `Livslangd`, bild (Drive → R2).
- **Användare** — `username`, `passwordHash`, `salt`, `role`, `name`, `FirstLogin`. Hashen är `SHA-256(UTF-8(salt + lösenord))` som hex. Samma algoritm i Worker ⇒ ingen behöver byta lösenord.
- **Graderingar** — ordningen i fliken `Grades` (Grön, Blå, Röd, Svart, Vit, …). Wildcard och Ej uppsatt är specialvärden i koden, inte rader i `Grades`.
- **Inställningar** — standardlivslängd (dagar) och QR-bas-URL.
- **Bilder** — alla filer i Drive-mappen `Bilder`, plus de som sitter som Drive-ID i kolumn H.

### Räkna om, importera inte som kolumner

Kolumn **C** (`Dags att bygga om`) och **F** (`Slutdatum`) är formler i arket. Värdena följer med indirekt: Worker räknar samma sak från `Byggdatum` + `Livslangd` + gradering vid läsning.

- `Slutdatum` = `Byggdatum + Livslangd` dagar, tomt om `Byggdatum` saknas
- `DagsAttByggaOm` = `""` utan byggdatum, `"-"` om gradering är **Ej uppsatt**, annars `"Ja"` om slutdatum &lt; idag (Europe/Stockholm) annars `"Nej"`

Kontrollera efter import att ett stickprov av leder får samma Ja/Nej/datum som sheetet visade samma dag.

### Lämna kvar

- **GAS-sessioner** — användare loggar in igen mot Worker.
- Sheetets egna formler, summeringsrader och bunden Kod.gs som inte är WallFlow.

`cloudflare/migrate.mjs` kör allt ovan. Avsnitten nedan är bakgrund och felsökning.

## Steg 1 — Exportera från Google

Kör exporten **en gång**, precis innan import. Frys därefter sheetet (dela som visning, eller sluta skriva via appen) så ni inte divergerar.

### A. Snapshot från Apps Script (rekommenderat)

Ger JSON med **alla** leder, graderingar, användare (hashar), inställningar och bildlista (kopplade + ev. föräldralösa filer i `Bilder`).

1. Öppna **WallFlow API**-projektet på [script.google.com](https://script.google.com) (standalone, inte sheetets bundna projekt).
2. Se till att `gas/Code.gs` i projektet innehåller `exportMigrationSnapshot` (den här branchen).
3. Välj funktionen **`exportMigrationSnapshot`** → **Run**. Godkänn Drive om du blir tillfrågad.
4. I **Execution log** / returvärdet finns en Drive-länk. Ladda ner `wallflow-export.json`.
5. Lägg filen i `cloudflare/snapshots/` (mappen är gitignored — den innehåller lösenordshashar).

Funktionen skriver filen i **samma Drive-mapp som kalkylarket**, inte i root.

### B. CSV från sheetet (reserv)

Om GAS-exporten inte går: **Arkiv → Hämta → CSV** per flik (`Alla leder`, `Grades`, `Users`, `BaseUrlQr`). Standardlivslängd sitter som script property `routeLifetimeDaysDefault` (fallback 30, eller kolumn I rad 2) — notera värdet för hand. Bilder måste då hämtas manuellt från Drive-mappen `Bilder`.

CSV räcker till D1 men saknar script property och Drive-filnamn. Användare-CSV:n är känslig; dela den inte.

### C. `getAppData` räcker inte

Publika `getAppData` (det display.html anropar) ger leder + grades + inställningar, **inte** Users och inte filerna i Drive. Konton och bilder måste komma från A (eller B + manuell Drive-export).

## Steg 2 — Skapa Cloudflare-resurser

Kräver [Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/) och inloggning (`npx wrangler login`). Konto-ID fylls i `cloudflare/wrangler.toml` utifrån `wrangler.toml.example`.

```bash
cd cloudflare
npx wrangler d1 create wallflow
npx wrangler kv namespace create SESSIONS
npx wrangler r2 bucket create wallflow-bilder
```

Kopiera `database_id` och KV-`id` till `wrangler.toml`. Kör schemat mot **remote** D1 (det är dit importen ska):

```bash
npx wrangler d1 execute wallflow --remote --file=schema.sql
```

Lokal övning: samma kommando med `--local` i stället för `--remote`.

## Steg 3 — Importera all leddata till D1

Från repo-roten. Default är `--mode=full` och `bild_key` som R2-nyckel (`led-13.jpg`), inte Drive-ID.

```bash
node cloudflare/import.mjs cloudflare/snapshots/wallflow-export.json > cloudflare/snapshots/import.sql

npx wrangler d1 execute wallflow --remote --file=cloudflare/snapshots/import.sql
```

Skriptet:

- tömmer tabellerna och skriver om dem (idempotent om ni kör om)
- skippar summeringsrader och rader utan giltigt lednummer (samma filter som GAS `isRouteRow_`)
- behåller gradering, byggare, datum, anteckningar och livslängd per led
- skriver `cloudflare/snapshots/images-manifest.json` för Drive-filerna

Kontroll:

```bash
npx wrangler d1 execute wallflow --remote --command="SELECT COUNT(*) AS n FROM routes;"
npx wrangler d1 execute wallflow --remote --command="SELECT nr, gradering, ledbyggare, byggdatum, livslangd, bild_key FROM routes ORDER BY nr LIMIT 20;"
npx wrangler d1 execute wallflow --remote --command="SELECT username, role, name FROM users;"
npx wrangler d1 execute wallflow --remote --command="SELECT * FROM grades ORDER BY sort_order;"
npx wrangler d1 execute wallflow --remote --command="SELECT * FROM settings;"
```

Förväntat: lika många `routes` som giltiga lednummer i arket, samma färger/byggare/datum som i snapshoten, `bild_key` ifylld där kolumn H hade Drive-ID.

## Steg 4 — Flytta bilder Drive → R2

Gör det här **innan** cutover, annars saknas foton i appen.

1. Manifestet från steg 3 (eller `images`-listan i snapshoten) listar `nr`, `fileId`, `suggestedKey`.
2. Hämta filerna (de är redan delade med länk, samma som appen):

```bash
node cloudflare/download-images.mjs cloudflare/snapshots/images-manifest.json
```

3. Ladda upp till R2. Kör från `cloudflare/` där `wrangler.toml` ligger:

```bash
cd cloudflare
for f in snapshots/images/*.{jpg,png,jpeg,webp}; do
  [ -f "$f" ] || continue
  npx wrangler r2 object put wallflow-bilder/$(basename "$f") --file "$f" --remote
done
```

Worker serverar sedan t.ex. `GET /img/led-13.jpg` från R2 i stället för `lh3.googleusercontent.com/d/…`.

Om en nedladdning misslyckas (Drive-HTML / saknad behörighet): öppna mappen **Bilder** bredvid kalkylarket och ladda ner filen för hand till samma `suggestedKey`. Rapport: `snapshots/images/download-report.json`.

Vill ni tillfälligt behålla Drive-ID i D1 (appen pekar kvar på `lh3` tills Worker finns):  

`node cloudflare/import.mjs snapshot.json --keep-drive-ids > import.sql`  
Byt till R2-nycklar innan cutover.

## Steg 5 — Verifiera innan cutover

- Antal leder = antal giltiga rader i `Alla leder` (numeriska + `W*`).
- Stickprov: samma `Gradering`, `Ledbyggare`, `Byggdatum`, `Anteckningar`, `Livslangd` som i arket.
- Antal rader med `bild_key` ≈ antal leder med bild i sheetet, och samma nycklar finns i R2.
- Alla konton finns; minst en `superadmin`.
- `grades` i samma ordning som fliken.
- `settings.routeLifetimeDays` och `settings.baseUrlQr` stämmer.
- Ingen `wallflow-export.json` eller `Users.csv` i git (`git status`).

Inloggning kan testas först när Worker finns. Hashverifiering utan Worker:

```js
const salt = "…"; // från exportens users[].salt
const password = "testlösen";
const data = new TextEncoder().encode(salt + password);
const buf = await crypto.subtle.digest("SHA-256", data);
const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
// hex ska matcha users[].passwordHash
```

## Steg 6 — Deploya Worker-API

Från `cloudflare/` (efter att `wrangler.jsonc` har riktiga D1/KV/R2-ID:n — `migrate.mjs` kan skapa resurserna):

```powershell
cd C:\sökväg\till\WallFlow\cloudflare
$env:CLOUDFLARE_API_TOKEN = [System.Environment]::GetEnvironmentVariable("CLOUDFLARE_API_TOKEN", "User")
npx wrangler deploy
```

Worker svarar på:

| Metod | Sökväg | Syfte |
|-------|--------|--------|
| `POST` | `/` eller `/api` | GAS-kompatibelt JSON-API |
| `GET` | `/img/<nyckel>` | Bild från R2 (`led-13.jpg`) |
| `GET` | `/` | Health `{ ok, app: "WallFlow", backend: "cloudflare" }` |

Lokal smoke:

```bash
cd cloudflare
node scripts/seed-local.mjs
npx wrangler dev   # annan terminal
node scripts/smoke-api.mjs
```

Inloggning lokalt efter seed: `admin` / `wallflow`.

## Steg 7 — Cutover

1. Byt `GAS_API_URL` i `index.html` och `display.html` till Worker-URL (t.ex. `https://wallflow.<konto>.workers.dev/` eller custom domain).
2. Frontenden mappar R2-nycklar (`led-13.jpg`) till `{API_ORIGIN}/img/led-13.jpg`. Drive-ID:n via `lh3` fungerar kvar under övergången.
3. Logga in, öppna kända leder (färg, anteckning, bild), kontrollera `display.html`.
4. DNS: CNAME `wallflow.vastervikclimbing.se` kan peka kvar på GitHub Pages så länge API-URL är absolut.
5. I GAS: **Deploy → Manage deployments → Disable**. I sheetet: dela som visning eller arkivera.
6. Drive-mappen `Bilder` kan lämnas som arkiv tills R2 är bekräftad, därefter rensas.

Gör inte cutover med två skrivande backend samtidigt.

## Fältmappning

### `routes` ← flik `Alla leder`

| Sheet | D1 | Kommentar |
|-------|----|-----------|
| A `Nr` | `nr` TEXT PRIMARY KEY | Behåll `W1` som text, inte tal |
| B `Gradering` | `gradering` | Exakt värde från arket |
| C `Dags att bygga om` | — | Beräknas vid läsning |
| D `Ledbyggare` | `ledbyggare` | |
| E `Byggdatum` | `byggdatum` | `YYYY-MM-DD` eller tom |
| F `Slutdatum` | — | Beräknas vid läsning |
| G `Anteckningar` | `anteckningar` | |
| H `Bild` | `bild_key` | Drive-ID i snapshot → R2-nyckel `led-{nr}.jpg` vid import |
| I livslängd | `livslangd` | 1–3650, default från settings |

### `users` ← flik `Users`

| Sheet | D1 |
|-------|----|
| Username | `username` |
| passwordHash | `password_hash` |
| salt | `salt` |
| role | `role` (`superadmin` \| `admin` \| `scout`) |
| name | `name` |
| FirstLogin | `first_login` INTEGER 0/1 |

Roller normaliseras med samma regler som GAS (`ledbyggare` → `scout`, osv.).

### `grades` ← flik `Grades`

En rad per färgnamn, `sort_order` från kolumn A (eller radordning). Header-rader (`Gradering`) hoppas över.

### `settings`

| Nyckel | Källa |
|--------|--------|
| `routeLifetimeDays` | Script property, annars 30 |
| `baseUrlQr` | Flik `BaseUrlQr` cell A2 (ren text) |

## Lösenord

GAS (`hashPassword_`):

```javascript
Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + password, Utilities.Charset.UTF_8)
```

Worker ska göra **exakt samma sak** (Web Crypto, UTF-8, hex). Importera hasharna rakt av. Re-hasha inte med ett annat schema utan att tvinga lösenordsbyte.

Sessionstoken i GAS är UUID i Cache/Properties. De dör vid cutover.

## Checklista

- [ ] `exportMigrationSnapshot` körd, JSON ner i `cloudflare/snapshots/`
- [ ] Sheetet fryst för skrivning
- [ ] På Windows: `$env:CLOUDFLARE_API_TOKEN = [System.Environment]::GetEnvironmentVariable("CLOUDFLARE_API_TOKEN", "User")` sedan `node .\cloudflare\migrate.mjs …` (D1 + R2)
- [ ] Antal leder / users / grades stämmer, stickprov på ledinnehåll OK
- [ ] Exportfilen inte commitad
- [ ] Worker deployad och `GAS_API_URL` bytt (senare PR)
- [ ] Inloggning + kända leder + bilder + display.html OK
- [ ] GAS-deployment avstängd

## Filer i repot

| Fil | Roll |
|-----|------|
| `cloudflare/migrate.mjs` | Ett kommando: JSON → D1 + R2 |
| `cloudflare/schema.sql` | D1-tabeller |
| `cloudflare/import.mjs` | Snapshot/CSV → SQL (default: all data) |
| `cloudflare/download-images.mjs` | Drive → lokala filer inför R2 |
| `cloudflare/wrangler.toml.example` | Wrangler-mall |
| `cloudflare/fixtures/sample-snapshot.json` | Testdata (inga riktiga hashar) |
| `gas/Code.gs` → `exportMigrationSnapshot` | JSON-dump till Drive |
