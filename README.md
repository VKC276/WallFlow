# WallFlow

App för att följa **ledbyggnationen** i klätterhallen. Baserad på samma arkitektur som [Crags](https://github.com/VKC276/Crags) (GAS ↔ GitHub Pages + Workbench).

## Google Sheet

Spreadsheet-ID: `1K71FH4c9FpBuxF6noBlzmF_nA5VXhAtiV84sTbPmWi0`

### Flik `Alla leder`

| Kolumn | Betydelse |
|--------|-----------|
| Nr | Lednummer |
| Gradering | Färg (Blå, Grön, Röd, Vit, Svart, Wildcard…) |
| Dags att bygga om | `Ja` / `Nej` |
| Ledbyggare | Vem som satt leden |
| Byggdatum | När den sattes |
| Slutdatum | Planerat slut / ombyggnadsdatum |
| Anteckningar | Fri text |
| Bild | Drive-fil-ID eller URL |

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
4. Kör manuellt en gång (välj funktionen i dropdown → Run):
   ```
   setupFirstSuperadmin("admin", "Ditt namn", "tillfalligtLosen")
   ```
   Godkänn behörighet till Google Sheets när du blir tillfrågad.
5. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Kopiera `/exec`-URL:en till `index.html`:

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

## Roller

- **superadmin** — redigera leder + lägga till/ta bort led-rader + användarhantering  
- **admin** — redigera befintliga leder (ser inte lägg till / ta bort)  
- **scout** (sättare) — redigera befintliga leder (ser inte lägg till / ta bort)  

Nya eller borttagna leder i det fasta antalet görs av superadmin (eller manuellt i sheetet).
