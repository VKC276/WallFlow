#!/usr/bin/env node
/**
 * Ett kommando: wallflow-export.json → D1 + R2. Körs på din maskin.
 *
 *   PowerShell (samma token som övriga Cloudflare-deploys):
 *     cd C:\sökväg\till\WallFlow
 *     $env:CLOUDFLARE_API_TOKEN = [System.Environment]::GetEnvironmentVariable("CLOUDFLARE_API_TOKEN", "User")
 *     node .\cloudflare\migrate.mjs C:\sökväg\till\wallflow-export.json
 *
 * Ingen wrangler login, ingen .env. --sql-only = bara SQL + bilder, ingen Cloudflare.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SNAP_DIR = path.join(HERE, "snapshots");
const WRANGLER_TOML = path.join(HERE, "wrangler.toml");
const DB_NAME = "wallflow";
const KV_TITLE = "SESSIONS";
const R2_BUCKET = "wallflow-bilder";
const IS_WIN = process.platform === "win32";

function parseArgs(argv) {
  const args = {
    input: "",
    sqlOnly: false,
    skipDownload: false,
    skipUpload: false,
    keepDriveIds: false,
    help: false
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--sql-only") args.sqlOnly = true;
    else if (a === "--skip-download") args.skipDownload = true;
    else if (a === "--skip-upload") args.skipUpload = true;
    else if (a === "--keep-drive-ids") args.keepDriveIds = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (!a.startsWith("-") && !args.input) args.input = a;
  }
  return args;
}

function usage() {
  return `Ett kommando som tar JSON-exporten till Cloudflare D1 + R2.
Körs på din maskin, med samma User-token som övriga deploys.

  cd C:\\sökväg\\till\\WallFlow
  $env:CLOUDFLARE_API_TOKEN = [System.Environment]::GetEnvironmentVariable("CLOUDFLARE_API_TOKEN", "User")
  node .\\cloudflare\\migrate.mjs C:\\sökväg\\till\\wallflow-export.json

Kör inte wrangler login — det krockar med tokenen.

Flaggor:
  --sql-only         bara SQL + bilder lokalt (ingen Wrangler)
  --skip-download    hoppa över Drive-nedladdning
  --skip-upload      hoppa över R2-uppladdning
  --keep-drive-ids   spara Drive-ID i D1 i stället för R2-nycklar`;
}

function log(msg) {
  process.stderr.write("\n==> " + msg + "\n");
}

function die(msg) {
  console.error("Fel: " + msg);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd || HERE,
    encoding: "utf8",
    shell: IS_WIN,
    stdio: opts.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: process.env,
    input: opts.input
  });
  if (opts.allowFail) return r;
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || "").trim();
    die((opts.label || cmd) + " misslyckades" + (err ? ":\n" + err : " (exit " + r.status + ")"));
  }
  return r;
}

function runNode(scriptArgs, opts = {}) {
  const outFd = opts.stdoutFile ? fs.openSync(opts.stdoutFile, "w") : "inherit";
  const r = spawnSync(process.execPath, scriptArgs, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: opts.stdoutFile ? ["ignore", outFd, "inherit"] : "inherit",
    env: process.env
  });
  if (opts.stdoutFile) fs.closeSync(outFd);
  if (r.status !== 0) die("node " + scriptArgs[0] + " misslyckades");
  return r;
}

function wrangler(args, opts = {}) {
  return run("npx", ["--yes", "wrangler", ...args], {
    cwd: HERE,
    capture: opts.capture,
    allowFail: opts.allowFail,
    label: "wrangler " + args.join(" ")
  });
}

function findSnapshot(input) {
  const candidates = [];
  if (input) candidates.push(path.resolve(process.cwd(), input));
  candidates.push(path.join(SNAP_DIR, "wallflow-export.json"));
  candidates.push(path.join(process.cwd(), "wallflow-export.json"));
  for (const p of candidates) {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  die(
    "Hittade ingen wallflow-export.json.\n" +
      "Lägg filen som cloudflare/snapshots/wallflow-export.json eller ange sökvägen:\n" +
      "  node cloudflare/migrate.mjs /sökväg/till/wallflow-export.json"
  );
}

function copySnapshot(src) {
  fs.mkdirSync(SNAP_DIR, { recursive: true });
  const dest = path.join(SNAP_DIR, "wallflow-export.json");
  if (path.resolve(src) !== path.resolve(dest)) {
    fs.copyFileSync(src, dest);
    log("Kopierade snapshot → " + dest);
  }
  const raw = JSON.parse(fs.readFileSync(dest, "utf8"));
  if (!raw || typeof raw !== "object") die("Ogiltig JSON i snapshoten");
  const nRoutes = Array.isArray(raw.routes)
    ? raw.routes.filter((r) => String(r && r.Nr != null ? r.Nr : "").trim()).length
    : 0;
  const nUsers = Array.isArray(raw.users) ? raw.users.length : 0;
  const nImages = Array.isArray(raw.images) ? raw.images.length : 0;
  log("Snapshot: " + nRoutes + " leder, " + nUsers + " användare, " + nImages + " bilder i listan");
  if (!nUsers) {
    console.error("Varning: inga användare — inloggning kommer inte fungera.");
  }
  return dest;
}

function tomlHasPlaceholder(text) {
  return /PASTE_|YOUR_|changeme/i.test(text);
}

function readTomlIds(text) {
  const d1 = text.match(/database_id\s*=\s*"([^"]+)"/);
  const kv = text.match(/\[\[kv_namespaces\]\][\s\S]*?id\s*=\s*"([^"]+)"/);
  return {
    d1: d1 && !tomlHasPlaceholder(d1[1]) ? d1[1] : "",
    kv: kv && !tomlHasPlaceholder(kv[1]) ? kv[1] : ""
  };
}

function writeToml(d1Id, kvId) {
  const body =
    `name = "wallflow"\n` +
    `main = "src/worker.js"\n` +
    `compatibility_date = "2026-08-13"\n\n` +
    `[[d1_databases]]\n` +
    `binding = "DB"\n` +
    `database_name = "${DB_NAME}"\n` +
    `database_id = "${d1Id}"\n\n` +
    `[[kv_namespaces]]\n` +
    `binding = "SESSIONS"\n` +
    `id = "${kvId}"\n\n` +
    `[[r2_buckets]]\n` +
    `binding = "BILDER"\n` +
    `bucket_name = "${R2_BUCKET}"\n`;
  fs.writeFileSync(WRANGLER_TOML, body);
  log("Skrev cloudflare/wrangler.toml (gitignoreras)");
}

function parseJsonOutput(text) {
  const s = String(text || "").trim();
  const start = s.search(/[\[{]/);
  if (start < 0) return null;
  try {
    return JSON.parse(s.slice(start));
  } catch {
    return null;
  }
}

function hasApiToken() {
  return !!(process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_KEY);
}

function ensureAccountId() {
  if (process.env.CLOUDFLARE_ACCOUNT_ID) return;
  const r = wrangler(["whoami"], { capture: true, allowFail: true });
  const out = (r.stdout || "") + (r.stderr || "");
  const ids = [...out.matchAll(/\b([a-f0-9]{32})\b/gi)].map((m) => m[1]);
  const unique = [...new Set(ids)];
  if (unique.length === 1) {
    process.env.CLOUDFLARE_ACCOUNT_ID = unique[0];
    log("Satte CLOUDFLARE_ACCOUNT_ID från whoami");
  }
}

function wranglerLooksLoggedIn(stdout, stderr, status) {
  const out = ((stdout || "") + (stderr || "")).toLowerCase();
  if (/you are not authenticated|not authenticated|please run [`']wrangler login/.test(out)) {
    return false;
  }
  return status === 0;
}

function ensureLoggedIn() {
  if (hasApiToken()) {
    log("Använder CLOUDFLARE_API_TOKEN — hoppar över wrangler login.");
    ensureAccountId();
    return;
  }
  log("Kollar Wrangler-inloggning…");
  const r = wrangler(["whoami"], { capture: true, allowFail: true });
  const out = ((r.stdout || "") + (r.stderr || "")).trim();
  if (wranglerLooksLoggedIn(r.stdout, r.stderr, r.status)) return;
  if (out) console.error(out);
  die(
    "Den här miljön är inte inloggad i Cloudflare (ingen CLOUDFLARE_API_TOKEN).\n" +
      "Tokenen från det andra projektet måste vara satt i samma terminal som migrate.mjs.\n" +
      "Kör inte wrangler login om tokenen redan finns där."
  );
}

function ensureD1() {
  const listed = wrangler(["d1", "list", "--json"], { capture: true, allowFail: true });
  const rows = parseJsonOutput((listed.stdout || "") + (listed.stderr || "")) || [];
  const list = Array.isArray(rows) ? rows : rows.result || rows.databases || [];
  const existing = list.find((d) => d && (d.name === DB_NAME || d.database_name === DB_NAME));
  if (existing && (existing.uuid || existing.id)) {
    log("D1 " + DB_NAME + " finns redan");
    return existing.uuid || existing.id;
  }
  log("Skapar D1 " + DB_NAME + "…");
  wrangler(["d1", "create", DB_NAME]);
  const listed2 = wrangler(["d1", "list", "--json"], { capture: true });
  const rows2 = parseJsonOutput((listed2.stdout || "") + (listed2.stderr || "")) || [];
  const list2 = Array.isArray(rows2) ? rows2 : rows2.result || rows2.databases || [];
  const created = list2.find((d) => d && (d.name === DB_NAME || d.database_name === DB_NAME));
  if (!created || !(created.uuid || created.id)) die("Kunde inte läsa database_id efter d1 create");
  return created.uuid || created.id;
}

function ensureKv() {
  const listed = wrangler(["kv", "namespace", "list"], { capture: true, allowFail: true });
  const rows = parseJsonOutput((listed.stdout || "") + (listed.stderr || "")) || [];
  const list = Array.isArray(rows) ? rows : [];
  const existing = list.find((n) => n && (n.title === KV_TITLE || n.title === "wallflow-" + KV_TITLE));
  if (existing && (existing.id || existing.namespace_id)) {
    log("KV " + KV_TITLE + " finns redan");
    return existing.id || existing.namespace_id;
  }
  log("Skapar KV " + KV_TITLE + "…");
  const created = wrangler(["kv", "namespace", "create", KV_TITLE], { capture: true });
  const out = (created.stdout || "") + (created.stderr || "");
  const m = out.match(/id\s*=\s*"([^"]+)"/) || out.match(/"id"\s*:\s*"([^"]+)"/);
  if (m) return m[1];
  const listed2 = wrangler(["kv", "namespace", "list"], { capture: true, allowFail: true });
  const rows2 = parseJsonOutput((listed2.stdout || "") + (listed2.stderr || "")) || [];
  const hit = (Array.isArray(rows2) ? rows2 : []).find((n) => n && n.title === KV_TITLE);
  if (hit && hit.id) return hit.id;
  die("Kunde inte läsa KV-id. Klistra in id från wrangler-utskriften i wrangler.toml och kör igen.");
}

function ensureR2() {
  log("Säkerställer R2-bucket " + R2_BUCKET + "…");
  const listed = wrangler(["r2", "bucket", "list"], { capture: true, allowFail: true });
  const out = (listed.stdout || "") + (listed.stderr || "");
  if (out.includes(R2_BUCKET)) {
    log("R2 " + R2_BUCKET + " finns redan");
    return;
  }
  const created = wrangler(["r2", "bucket", "create", R2_BUCKET], { allowFail: true });
  if (created.status !== 0) {
    const err = (created.stderr || created.stdout || "").trim();
    if (!/already exists|already owned/i.test(err)) {
      die("Kunde inte skapa R2-bucket:\n" + err);
    }
  }
}

function ensureCloudflare() {
  ensureLoggedIn();
  let d1Id = "";
  let kvId = "";
  if (fs.existsSync(WRANGLER_TOML)) {
    const ids = readTomlIds(fs.readFileSync(WRANGLER_TOML, "utf8"));
    d1Id = ids.d1;
    kvId = ids.kv;
  }
  if (!d1Id) d1Id = ensureD1();
  if (!kvId) kvId = ensureKv();
  ensureR2();
  writeToml(d1Id, kvId);
}

function applySchemaAndSql(sqlPath) {
  log("Kör schema mot remote D1…");
  wrangler(["d1", "execute", DB_NAME, "--remote", "--file", path.join(HERE, "schema.sql")]);
  log("Importerar snapshot mot remote D1…");
  wrangler(["d1", "execute", DB_NAME, "--remote", "--file", sqlPath]);
}

function imageFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => /\.(jpg|jpeg|png|webp)$/i.test(n));
}

function uploadImages(imgDir) {
  const files = imageFiles(imgDir);
  if (!files.length) {
    log("Inga lokala bilder att ladda upp (inga jpg/png i " + imgDir + ")");
    return;
  }
  log("Laddar upp " + files.length + " bilder till R2…");
  for (const name of files) {
    const file = path.join(imgDir, name);
    process.stderr.write("    " + name + "\n");
    wrangler([
      "r2",
      "object",
      "put",
      R2_BUCKET + "/" + name,
      "--file",
      file,
      "--remote"
    ]);
  }
}

function verify() {
  log("Kontrollfrågor mot D1:");
  wrangler(["d1", "execute", DB_NAME, "--remote", "--command", "SELECT COUNT(*) AS routes FROM routes;"]);
  wrangler(["d1", "execute", DB_NAME, "--remote", "--command", "SELECT COUNT(*) AS users FROM users;"]);
  wrangler(["d1", "execute", DB_NAME, "--remote", "--command", "SELECT COUNT(*) AS with_image FROM routes WHERE bild_key != '';"]);
  wrangler(["d1", "execute", DB_NAME, "--remote", "--command", "SELECT key, value FROM settings;"]);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const src = findSnapshot(args.input);
  const snapshot = copySnapshot(src);
  const sqlPath = path.join(SNAP_DIR, "import.sql");
  const manifestPath = path.join(SNAP_DIR, "images-manifest.json");
  const imgDir = path.join(SNAP_DIR, "images");

  log("Genererar SQL…");
  const importArgs = [path.join(HERE, "import.mjs"), snapshot];
  if (args.keepDriveIds) importArgs.push("--keep-drive-ids");
  runNode(importArgs, { stdoutFile: sqlPath });
  if (!fs.existsSync(sqlPath) || !fs.statSync(sqlPath).size) die("import.sql blev tom");

  if (!args.skipDownload) {
    const manifest = fs.existsSync(manifestPath) ? manifestPath : snapshot;
    log("Hämtar bilder från Drive…");
    const dl = spawnSync(process.execPath, [path.join(HERE, "download-images.mjs"), manifest, "--out", imgDir], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: "inherit",
      env: process.env
    });
    if (dl.status !== 0) {
      console.error("Vissa bilder gick inte att hämta. Fortsätter med de som lyckades — kolla snapshots/images/download-report.json");
    }
  }

  if (args.sqlOnly) {
    log("Klart lokalt (--sql-only). SQL: " + sqlPath);
    log("Bilder: " + imgDir);
    log("Kör samma kommando utan --sql-only för att skicka till Cloudflare.");
    return;
  }

  ensureCloudflare();
  applySchemaAndSql(sqlPath);
  if (!args.skipUpload) uploadImages(imgDir);
  verify();

  log("Klart. Data ligger i D1 + R2.");
  console.log("\nNästa steg (när Worker finns): peka GAS_API_URL mot Worker och stäng GAS-deploymenten.");
  console.log("Committa inte wallflow-export.json (lösenordshashar).");
}

try {
  main();
} catch (err) {
  die(err && err.message ? err.message : String(err));
}
