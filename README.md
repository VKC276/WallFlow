# WallFlow

App för att följa **ledbyggnationen** i klätterhallen. Baserad på samma arkitektur som [Crags](https://github.com/VKC276/Crags) (GAS ↔ GitHub Pages + Workbench).

## Google Sheet

Spreadsheet-ID: `1K71FH4c9FpBuxF6noBlzmF_nA5VXhAtiV84sTbPmWi0`

### Flik `Alla leder`

| Kolumn | Betydelse |
|--------|-----------|
| Nr | Lednummer |
| Gradering | Färg (Blå, Grön, Röd, Vit, Svart, Wildcard…) |
| Dags att bygga om | Formel → `Ja` / `Nej` / `-` (vid Ej uppsatt) |
| Ledbyggare | Vem som satt leden |
| Byggdatum | När den sattes |
| Slutdatum | Planerat slut / ombyggnadsdatum (`=OM(E2=0;"";E2+I2)`) |
| Anteckningar | Fri text |
| Bild | Drive-fil-ID (uppladdad) eller URL |
| **I** | Livslängd i dagar per led (redigeras av superadmin i Redigera led; standard för nya leder under Inställningar → Livslängd) |

**Bilder:** Appen kan ta foto / välja bild, rita ledlinje och ladda upp till Drive-mappen **`Bilder`** (skapas bredvid kalkylarket). **En bild per led** (`led-{nr}.jpg`) — vid ny uppladdning, borttagning eller radering av led rensas gamla filer så mappen hålls ren. Kräver Drive-behörighet för WallFlow-GAS.

**Formel i kolumn F (Slutdatum)**

- `=OM(E2=0;"";E2+I2)` (svenska UI) / engelsk `IF(E2=0,"",E2+I2)` via Apps Script  
- Kolumn **I** på samma rad styr livslängden per led (superadmin i Redigera led). Inställningar → **Livslängd** sätter standard för nya leder.

**Formel i kolumn C**

- **Manuellt i sheetet (svenska):** `OM` + semikolon  
  `=OM(E9=0;"";OM(B9="Ej uppsatt";"-";OM(F9-TODAY()<0;"Ja";"Nej")))`
- **Via Apps Script:** måste vara engelsk `IF` + komma (annars `#NAME?` på `OM`). Samma logik.

Nya rader kopierar helst en fungerande formel från en befintlig rad, annars sätts `IF(...)` för C och `E+I` för F (plus ledtid i I). Kör `refreshRebuildStatusFormulas` efter deploy för att laga rader med `#NAME?`.

### Flik `Grades`

Tillåtna färger / graderingar i ordning, t.ex.:

| | |
|--|--|
| 1 | Grön |
| 2 | Blå |
| 3 | Röd |
| 4 | Svart |
| 5 | Vit |

Appen använder **bara** dessa i filter och admin-val.

### Flik `Users` (samma som Crags)

`Username | passwordHash | salt | role | name | FirstLogin`

## Setup GAS (fristående — rekommenderat)

Sheettet har redan egen bunden kod. **Klistra inte in WallFlow i sheetets Apps Script** (då krockar t.ex. `SPREADSHEET_ID`).

Skapa i stället ett **nytt standalone-projekt**:

1. Gå till [script.google.com](https://script.google.com) → **New project**
2. Namnge projektet t.ex. `WallFlow API`
3. Ersätt innehållet i `Code.gs` med filen `gas/Code.gs` från detta repo
4. **Project Settings** (kugghjul) → kryssa i **Show "appsscript.json" manifest file in editor**  
   Klistra in innehållet från `gas/appsscript.json` (inkluderar Drive-scope `auth/drive`)
5. Kör manuellt en gång (välj funktionen i dropdown → Run):
   ```
   setupFirstSuperadmin("admin", "Ditt namn", "tillfalligtLosen")
   ```
   Godkänn behörighet till Google Sheets när du blir tillfrågad.
6. Kör sedan **`authorizeDriveAccess`** → Run → godkänn **Google Drive**  
   (annars: *Du har inte behörighet att ringa DriveApp.Folder.createFile*)
7. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
8. Kopiera `/exec`-URL:en till `index.html`:

```js
const GAS_API_URL = "https://script.google.com/macros/s/XXXX/exec";
```

WallFlow öppnar sheetet via ID (`SpreadsheetApp.openById`) — ingen bindning behövs. Befintlig sheet-kod lämnas orörd.

## Demoläge

Om `GAS_API_URL` är tom kör appen lokalt med demo-data.

```bash
python3 -m http.server 8080
```

Demo-login: `admin` / `wallflow`

## Inloggning

WallFlow kräver inloggning direkt. Med **Kom ihåg mig** sparas sessionen på enheten så nästa besök hoppar över login. Redigering sker i huvudvyn via knappen **Redigera** (ingen separat workbench för leder).

## Roller

- **Ledbyggare** (`scout`) — redigera befintliga leder (färg, byggare, datum, anteckningar, bild)
- **Admin** — samma som Ledbyggare, plus hantera användarlistan (skapa/ändra roll/radera)
- **Superadmin** — allt ovan, plus lägga till/ta bort leder och styra livslängd

**Failsafe:** sista superadmin kan inte raderas eller nedgraderas — minst en superadmin måste alltid finnas.

Nya eller borttagna leder i det fasta antalet görs av superadmin (eller manuellt i sheetet).
