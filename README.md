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

### Flik `Users` (samma som Crags)

`Username | passwordHash | salt | role | name | FirstLogin`

## Setup GAS

1. Öppna sheetet → **Extensions → Apps Script**
2. Klistra in `gas/Code.gs`
3. Kör manuellt en gång: `setupFirstSuperadmin("admin", "Ditt namn", "tillfalligtLosen")`
4. **Deploy → New deployment → Web app**
   - Execute as: Me
   - Who has access: Anyone
5. Klistra in `/exec`-URL:en i `index.html`:

```js
const GAS_API_URL = "https://script.google.com/macros/s/XXXX/exec";
```

## Demoläge

Om `GAS_API_URL` är tom kör appen lokalt med demo-data.

```bash
python3 -m http.server 8080
```

Demo-login: `admin` / `wallflow`

## Roller

- **superadmin** — allt + användarhantering  
- **admin** — skapa/redigera/radera leder  
- **scout** (sättare) — skapa/redigera, ej radera  
