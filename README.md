# WallFlow

App för att följa **ledbyggnationen** i klätterhallen.

WallFlow är byggd på samma arkitektur som [Crags](https://github.com/VKC276/Crags):

- Enkel HTML/CSS/JS-SPA (GitHub Pages)
- Bootstrap + mobil-first UI
- Google Apps Script som JSON-API (`google.script.run`-kompatibel brygga)
- Workbench för admin/sättare

## Vad skiljer från Crags?

| Crags | WallFlow |
|-------|----------|
| Utomhusklippor på karta | Statusflöde i hallen |
| Approach / parkering / access | Väggar, sättare, färger, datum |
| Status G/Y/R (access) | Planerad → Sätts → Aktiv → Strippas |

## Kom igång (demoläge)

Öppna `index.html` lokalt eller via GitHub Pages.

- Demoläge är aktivt när `GAS_API_URL` är tom
- Demo-login: `admin` / `wallflow`
- Data sparas i `localStorage`

```bash
# enkel lokal server
python3 -m http.server 8080
# öppna http://localhost:8080
```

## Koppla riktig backend (GAS)

1. Skapa ett Google Sheet
2. Extensions → Apps Script, klistra in `gas/Code.gs`
3. Kör funktionen `setupWallFlowSheets()` en gång
4. Deploy → **Web app** (Execute as: Me, Who has access: Anyone)
5. Klistra in `/exec`-URL:en i `index.html`:

```js
const GAS_API_URL = "https://script.google.com/macros/s/XXXX/exec";
```

## Datamodell

- **Walls** — vägg/sektor (`ID`, `Namn`, `Order`, `Info`)
- **Routes** — led under byggnation (`WallID`, `Namn`, `Grad`, `Farg`, `Setter`, `Status`, datum, anteckning)
- **Users / Sessions** — adminroller: `superadmin`, `admin`, `scout` (sättare)

## Roller

- **Superadmin** — allt + användarhantering
- **Admin** — skapa/redigera/radera innehåll
- **Sättare (scout)** — skapa/redigera, ej radera

## Hosting

Publicera `main` (eller denna branch) via GitHub Pages. Valfri `CNAME` för t.ex. `wallflow.vastervikclimbing.se`.
