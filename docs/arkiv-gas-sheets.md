# Arkiv: GAS + Google Sheets-backend

WallFlow kör sedan 2026-08-13 mot **Cloudflare** (Worker + D1 + R2 + KV). Det här dokumentet beskriver hur ni hittar och återställer det **gamla** arbetsflödet (GitHub Pages → Google Apps Script → Sheet + Drive).

## Var det finns sparat

| Sak | Plats |
|-----|--------|
| Fryst kod (sista main före cutover) | Git-tag **`archive/gas-sheets-2026-08-13`** |
| Samma snapshot som branch | **`archive/gas-sheets`** |
| GAS-källkod (finns kvar på `main`) | `gas/Code.gs`, `gas/appsscript.json` |
| Kalkylark | Spreadsheet-ID `1K71FH4c9FpBuxF6noBlzmF_nA5VXhAtiV84sTbPmWi0` |
| Bilder | Drive-mappen **Bilder** bredvid arket |
| Apps Script-projekt | Standalone **WallFlow API** på [script.google.com](https://script.google.com) |

Taggen/branchen innehåller `index.html` / `display.html` med den gamla `GAS_API_URL` redan ifylld.

**Gammal Web App-URL (vid cutover):**

```
https://script.google.com/macros/s/AKfycbzw_23y8uDOGJneWK7sPDAJdaUbOFvHX2X7Xq4qnZ3NF8IjDbNRIcayxFKGof9mg2yglA/exec
```

Om ni deployat en ny GAS-version efteråt kan URL:en skilja sig — kolla då **Deploy → Manage deployments** i Apps Script.

## Rör inte i onödan

Så länge ni vill kunna rulla tillbaka:

- Radera **inte** Apps Script-projektet *WallFlow API*
- Radera **inte** kalkylarket eller Drive-mappen **Bilder**
- Stäng gärna av (Disable) GAS-deploymenten i drift, men behåll projektet

## Snabb återställning (rollback)

1. Checkout arkivet lokalt:
   ```bash
   git fetch origin
   git checkout archive/gas-sheets
   # eller: git checkout archive/gas-sheets-2026-08-13
   ```
2. Se till att GAS Web App är **aktiv** (Deploy → Manage deployments → Enable / ny version om den var avstängd).
3. Publicera den här HTML:en till GitHub Pages (merge till `main`, eller tillfällig Pages från branchen).
4. Hard-refresh sajten och **logga in igen** (sessioner delas inte mellan GAS och Cloudflare).

Efter rollback skriver appen igen i Sheet/Drive. Cloudflare D1/R2 påverkas inte förrän ni byter tillbaka `GAS_API_URL` till Worker.

## Tillbaka till Cloudflare igen

På aktuell `main` pekar `GAS_API_URL` på Worker (`https://wallflow.muddy-rice-38d4.workers.dev/`). Återställ den URL:en (eller merge `main`) och logga in på nytt.

## Relaterat

- Migreringsguide: [migrera-till-cloudflare.md](./migrera-till-cloudflare.md)
- Live Cloudflare-API: `https://wallflow.muddy-rice-38d4.workers.dev/`
