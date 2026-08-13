# Migrera WallFlow från Google Sheets/GAS till Cloudflare

WallFlow kör idag statiska sidor på GitHub Pages mot ett **Google Apps Script**-API som läser och skriver ett **Google Sheet** (leder, användare, inställningar) och **Google Drive** (ledbilder). Målet är att flytta backend till Cloudflare: **Workers** (API), **D1** (data), **R2** (bilder) och **KV** (sessioner). Frontend (`index.html`, `display.html`) kan ligga kvar på GitHub Pages i ett första steg, eller flyttas till Cloudflare Pages.

**Nu är ett bra tillfälle.** Leddatan i arket är redan inaktuell, så vi behöver inte släpa med gamla byggdatum, anteckningar och foton. Det som är värt att ta med är **konton**, **graderingar**, **inställningar** och **lednummer** (samma fysiska vägg / QR). Resten fylls i i appen efter cutover.

Den här guiden handlar om **hur datan kommer över**. Själva Worker-API:t (ersättare till `gas/Code.gs`) är ett separat steg; importen kan göras innan det finns.

## Målarkitektur

| Idag | Cloudflare |
|------|------------|
| GAS Web App (`gas/Code.gs`) | Worker / Pages Function |
| Sheet-flik `Alla leder` | D1-tabell `routes` |
| Sheet-flik `Grades` | D1-tabell `grades` |
| Sheet-flik `Users` | D1-tabell `users` |
| Flik `BaseUrlQr` + script property `routeLifetimeDaysDefault` | D1-tabell `settings` |
| Drive-mappen `Bilder` (`led-{nr}.jpg`) | R2-bucket, nyckel `led-{nr}.jpg` |
| `CacheService` + `PropertiesService` (sessioner 14 dagar) | KV, samma TTL — **importeras inte** |
| GitHub Pages + CNAME `wallflow.vastervikclimbing.se` | Oförändrat tills API-URL byts, eller Pages |

Kalkylark: [`1K71FH4c9FpBuxF6noBlzmF_nA5VXhAtiV84sTbPmWi0`](https://docs.google.com/spreadsheets/d/1K71FH4c9FpBuxF6noBlzmF_nA5VXhAtiV84sTbPmWi0)

## Vad som ska med

### Ta med

- **Användare** — `username`, `passwordHash`, `salt`, `role`, `name`, `FirstLogin`. Hashen är `SHA-256(UTF-8(salt + lösenord))` som hex. Samma algoritm i Worker ⇒ ingen behöver byta lösenord.
- **Graderingar** — ordningen i fliken `Grades` (Grön, Blå, Röd, Svart, Vit, …). Wildcard och Ej uppsatt är specialvärden i koden, inte rader i `Grades`.
- **Inställningar** — standardlivslängd (dagar) och QR-bas-URL.
- **Lednummer** — numeriska (`1`, `13`) och wildcards (`W1`, `W2`). De sitter på väggen och i QR.

### Räkna om, importera inte

Kolumn **C** (`Dags att bygga om`) och **F** (`Slutdatum`) är formler i arket. Worker räknar samma sak vid läsning:

- `Slutdatum` = `Byggdatum + Livslangd` dagar, tomt om `Byggdatum` saknas
- `DagsAttByggaOm` = `""` utan byggdatum, `"-"` om gradering är **Ej uppsatt**, annars `"Ja"` om slutdatum &lt; idag (Europe/Stockholm) annars `"Nej"`

### Lämna kvar / släng

- **GAS-sessioner** — användare loggar in igen mot Worker.
- **Ledinnehåll** (rekommenderat nu) — byggare, datum, anteckningar, Drive-bilder. Importläget `structure` nollställer det till **Ej uppsatt**.
- Sheetets egna formler, summeringsrader och bunden Kod.gs som inte är WallFlow.

Två importlägen i `cloudflare/import.mjs`:

| Läge | Flagga | När |
|------|--------|-----|
| **Struktur** (rekommenderat) | `--mode=structure` | Datan är inaktuell. Behåller nr + default-livslängd, sätter Ej uppsatt, tömmer resten. |
| **Full snapshot** | `--mode=full` | Ni vill ha exakt det som står i arket just nu, inkl. bild-ID:n. |

## Steg 1 — Exportera från Google

Kör exporten **en gång**, precis innan import. Frys därefter sheetet (dela som visning, eller sluta skriva via appen) så ni inte divergerar.

### A. Snapshot från Apps Script (rekommenderat)

Ger JSON med leder, graderingar, användare (hashar), inställningar och en bildlista.

1. Öppna **WallFlow API**-projektet på [script.google.com](https://script.google.com) (standalone, inte sheetets bundna projekt).
2. Se till att `gas/Code.gs` i projektet innehåller `exportMigrationSnapshot` (den här branchen).
3. Välj funktionen **`exportMigrationSnapshot`** → **Run**. Godkänn Drive om du blir tillfrågad.
4. I **Execution log** / returvärdet finns en Drive-länk. Ladda ner `wallflow-export.json`.
5. Lägg filen i `cloudflare/snapshots/` (mappen är gitignored — den innehåller lösenordshashar).

Funktionen skriver filen i **samma Drive-mapp som kalkylarket**, inte i root.

### B. CSV från sheetet (reserv)

Om GAS-exporten inte går: **Arkiv → Hämta → CSV** per flik (`Alla leder`, `Grades`, `Users`, `BaseUrlQr`). Standardlivslängd sitter som script property `routeLifetimeDaysDefault` (fallback 30, eller kolumn I rad 2) — notera värdet för hand.

CSV räcker till D1 men saknar script property och Drive-filnamn. Användare-CSV:n är känslig; dela den inte.

### C. `getAppData` räcker inte

Publika `getAppData` (det display.html anropar) ger leder + grades + inställningar, **inte** Users. Konton måste komma från A eller B.

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

## Steg 3 — Importera till D1

Från repo-roten:

```bash
# Rekommenderat nu: behåll nr + konton, nollställ inaktuella leder
node cloudflare/import.mjs cloudflare/snapshots/wallflow-export.json --mode=structure > cloudflare/snapshots/import.sql

# Alternativ: exakt kopia av arket
# node cloudflare/import.mjs cloudflare/snapshots/wallflow-export.json --mode=full > cloudflare/snapshots/import.sql

npx wrangler d1 execute wallflow --remote --file=cloudflare/snapshots/import.sql
```

Skriptet:

- tömmer tabellerna och skriver om dem (idempotent om ni kör om)
- skippar summeringsrader och rader utan giltigt lednummer (samma filter som GAS `isRouteRow_`)
- skriver `cloudflare/snapshots/images-manifest.json` i `--mode=full` om leder har Drive-fil-ID

Kontroll:

```bash
npx wrangler d1 execute wallflow --remote --command="SELECT COUNT(*) AS n FROM routes;"
npx wrangler d1 execute wallflow --remote --command="SELECT username, role, name FROM users;"
npx wrangler d1 execute wallflow --remote --command="SELECT * FROM grades ORDER BY sort_order;"
npx wrangler d1 execute wallflow --remote --command="SELECT * FROM settings;"
```

Förväntat efter `structure`: lika många `routes` som giltiga lednummer i arket, alla med `gradering = 'Ej uppsatt'` och tomma `ledbyggare` / `byggdatum` / `anteckningar` / `bild_key`.

## Steg 4 — Bilder (valfritt)

Hoppa över det här steget med `--mode=structure`. Gamla foton hör till leder som ändå nollställs; nya bilder laddas upp till R2 via Worker senare.

Om ni ändå kör `--mode=full`:

1. Öppna Drive-mappen **Bilder** bredvid kalkylarket (filer `led-{nr}.jpg` / `.png`).
2. Använd `images-manifest.json` (`nr`, `fileId`, `suggestedKey`).
3. Ladda ner varje fil som är delad med länk (samma som appen använder):

```bash
# exempel — byt FILE_ID och nr
curl -L "https://drive.google.com/uc?export=download&id=FILE_ID" -o led-13.jpg
npx wrangler r2 object put wallflow-bilder/led-13.jpg --file led-13.jpg --content-type image/jpeg
```

I D1 ska `routes.bild_key` vara R2-nyckeln (`led-13.jpg`), inte Drive-ID. `import.mjs --mode=full --rewrite-images` sätter `bild_key` till `led-{nr}.jpg` / `.png` utifrån fil-ID i snapshoten. Worker serverar sedan t.ex. `GET /img/led-13.jpg` från R2 i stället för `lh3.googleusercontent.com/d/…`.

Misslyckade Drive-nedladdningar: lämna `bild_key` tomt och ta nya foton i appen.

## Steg 5 — Verifiera innan cutover

- Antal leder = antal giltiga rader i `Alla leder` (numeriska + `W*`).
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

## Steg 6 — Cutover (när Worker är deployad)

1. Deploya Worker med **samma action-API** som GAS (`getAppData`, `verifyAdminPassword`, `saveRoute`, …) mot D1/R2/KV.
2. Byt `GAS_API_URL` i `index.html` och `display.html` till Worker-URL (eller samma origin via Pages).
3. Logga in, skapa en testled, ladda upp en bild, kontrollera `display.html`.
4. DNS: CNAME `wallflow.vastervikclimbing.se` kan peka kvar på GitHub Pages så länge API-URL är absolut. När Pages flyttas till Cloudflare, peka zonen dit.
5. I GAS: **Deploy → Manage deployments → Disable**. I sheetet: dela som visning eller arkivera.
6. Drive-mappen `Bilder` kan tömmas när R2 är bekräftad (eller lämnas som arkiv).

Gör inte cutover med två skrivande backend samtidigt.

## Fältmappning

### `routes` ← flik `Alla leder`

| Sheet | D1 | Kommentar |
|-------|----|-----------|
| A `Nr` | `nr` TEXT PRIMARY KEY | Behåll `W1` som text, inte tal |
| B `Gradering` | `gradering` | I `structure`: alltid `Ej uppsatt` |
| C `Dags att bygga om` | — | Beräknas vid läsning |
| D `Ledbyggare` | `ledbyggare` | Tom i `structure` |
| E `Byggdatum` | `byggdatum` | `YYYY-MM-DD` eller tom |
| F `Slutdatum` | — | Beräknas vid läsning |
| G `Anteckningar` | `anteckningar` | Tom i `structure` |
| H `Bild` | `bild_key` | Drive-ID idag; R2-nyckel efter import. Tom i `structure` |
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
- [ ] D1 + KV + R2 skapade, `schema.sql` kört remote
- [ ] `import.mjs --mode=structure` (eller `full`) kört mot remote D1
- [ ] Antal leder / users / grades stämmer
- [ ] Exportfilen inte commitad
- [ ] Worker deployad och `GAS_API_URL` bytt (senare PR)
- [ ] Inloggning + spara led + display.html OK
- [ ] GAS-deployment avstängd

## Filer i repot

| Fil | Roll |
|-----|------|
| `cloudflare/schema.sql` | D1-tabeller |
| `cloudflare/import.mjs` | Snapshot/CSV → SQL |
| `cloudflare/wrangler.toml.example` | Wrangler-mall |
| `cloudflare/fixtures/sample-snapshot.json` | Testdata (inga riktiga hashar) |
| `gas/Code.gs` → `exportMigrationSnapshot` | JSON-dump till Drive |
