# AGENTS.md

## Cursor Cloud specific instructions

WallFlow is a **static frontend** (`index.html` main app, `display.html` read-only stats screen) plus a **legacy Google Apps Script backend** (`gas/Code.gs`, not runnable locally) and **Cloudflare migration tooling** (`cloudflare/*.mjs`). See `README.md` and `docs/migrera-till-cloudflare.md` for the canonical run/deploy/migration commands; only the non-obvious notes below are worth repeating.

### No dependencies to install
There is no `package.json`, lockfile, test runner, or linter. The Node scripts use only `node:*` built-ins and the app is served by Python's stdlib HTTP server. `node`, `python3`, and `sqlite3` are already available, so the startup update script is effectively a no-op. There are **no lint/test/build commands** in this repo.

### Running the frontend (main app)
Serve from the repo root and open `http://localhost:8080/index.html`:

```bash
python3 -m http.server 8080
```

Non-obvious gotcha: `index.html` hardcodes a **live** `GAS_API_URL` (near line 1171), so by default the app talks to the real Google Apps Script backend and requires real credentials. To run fully offline against built-in demo data, temporarily set `const GAS_API_URL = "";` (demo mode activates when the URL is empty or contains `PASTE_`). Demo login is `admin` / `wallflow`, and demo data lives in `localStorage` (key `wallflow_demo_db_v3`). **Revert the blanked URL before committing** — never commit the demo edit. `display.html` uses the same `GAS_API_URL` mechanism.

### Cloudflare migration tooling (`cloudflare/`)
Fully offline paths (no Cloudflare account needed), using the sample fixture:

```bash
node cloudflare/import.mjs cloudflare/fixtures/sample-snapshot.json > /tmp/import.sql
node cloudflare/migrate.mjs cloudflare/fixtures/sample-snapshot.json --sql-only --skip-download
```

`--skip-download` avoids a doomed Drive fetch for the fixture's fake file IDs. D1 is SQLite-backed, so you can validate the generated SQL locally without Cloudflare:

```bash
sqlite3 /tmp/wallflow.db < cloudflare/schema.sql
sqlite3 /tmp/wallflow.db < /tmp/import.sql
```

A full `node cloudflare/migrate.mjs <snapshot.json>` (no `--sql-only`) needs `CLOUDFLARE_API_TOKEN` and `npx wrangler` (creates/writes D1 + KV + R2). `cloudflare/snapshots/` and `cloudflare/wrangler.toml` are gitignored; real export snapshots contain password hashes — never commit them.
