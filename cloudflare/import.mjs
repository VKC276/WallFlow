#!/usr/bin/env node
/**
 * WallFlow: Sheets/GAS-snapshot → D1 SQL.
 *
 *   node cloudflare/import.mjs snapshot.json > import.sql
 *   node cloudflare/import.mjs snapshot.json --keep-drive-ids > import.sql
 *   node cloudflare/import.mjs --csv-dir ./csv > import.sql
 *
 * Snapshot-JSON kommer från GAS exportMigrationSnapshot().
 * Default --mode=full kopierar all leddata (byggare, datum, anteckningar, bild).
 * bild_key skrivs om till led-{nr}.jpg|png (R2). --keep-drive-ids behåller Drive-ID.
 * --mode=structure nollställer leder till Ej uppsatt.
 */

import fs from "node:fs";
import path from "node:path";

const DEFAULT_LIFETIME = 30;
const DEFAULT_GRADES = ["Grön", "Blå", "Röd", "Svart", "Vit"];

function parseArgs(argv) {
  const args = { mode: "full", rewriteImages: null, csvDir: "", input: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mode" && argv[i + 1]) args.mode = argv[++i];
    else if (a.startsWith("--mode=")) args.mode = a.slice("--mode=".length);
    else if (a === "--rewrite-images") args.rewriteImages = true;
    else if (a === "--keep-drive-ids") args.rewriteImages = false;
    else if (a === "--csv-dir" && argv[i + 1]) args.csvDir = argv[++i];
    else if (a.startsWith("--csv-dir=")) args.csvDir = a.slice("--csv-dir=".length);
    else if (a === "--help" || a === "-h") args.help = true;
    else if (!a.startsWith("-") && !args.input) args.input = a;
  }
  if (args.rewriteImages == null) args.rewriteImages = args.mode === "full";
  return args;
}

function usage() {
  return `Användning:
  node cloudflare/import.mjs <snapshot.json> [--mode=full|structure] [--keep-drive-ids]
  node cloudflare/import.mjs --csv-dir <mapp> [--mode=full|structure]

Default: --mode=full (all leddata) och R2-nycklar i bild_key.
--keep-drive-ids behåller Google Drive-ID i bild_key.
--mode=structure nollställer leder till Ej uppsatt (används inte vid full överföring).

Skriv SQL till stdout. Bildmanifest skrivs bredvid indata som images-manifest.json.`;
}

function sqlStr(v) {
  return "'" + String(v == null ? "" : v).replace(/'/g, "''") + "'";
}

function sqlInt(v, fallback = 0) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? String(n) : String(fallback);
}

function normalizeRole(role) {
  let r = String(role == null ? "" : role).trim().toLowerCase();
  r = r.replace(/å/g, "a").replace(/ä/g, "a").replace(/ö/g, "o");
  if (!r) return "admin";
  if (r === "superadmin" || r === "super" || r === "super-admin" || r === "super_admin") return "superadmin";
  if (r === "scout" || r === "developer" || r === "ledbyggare" || r === "sattare" || r === "setter") return "scout";
  if (r === "admin" || r === "administrator" || r === "administratoer") return "admin";
  if (r.includes("super")) return "superadmin";
  if (r.includes("ledbygg") || r.includes("satt") || r.includes("scout")) return "scout";
  if (r.includes("admin")) return "admin";
  return "admin";
}

function isFirstLogin(v) {
  const s = String(v == null ? "" : v).trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "ja";
}

function isWildcardNr(nr) {
  return /^w\d+$/i.test(String(nr == null ? "" : nr).trim());
}

function isRouteRow(obj) {
  const nr = String(obj.Nr == null ? obj.nr == null ? "" : obj.nr : obj.Nr).trim();
  const grad = String(obj.Gradering == null ? obj.gradering || "" : obj.Gradering).trim();
  const rebuild = String(
    obj["Dags att bygga om"] != null ? obj["Dags att bygga om"] : (obj.DagsAttByggaOm || "")
  ).trim().toLowerCase();
  if (rebuild === "antal") return false;
  if (nr && !Number.isNaN(Number(nr))) return true;
  if (isWildcardNr(nr)) return true;
  if (!nr && grad && (rebuild === "ja" || rebuild === "nej" || rebuild === "-")) return true;
  return false;
}

function formatDate(v) {
  if (v == null || v === "") return "";
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const serial = Number(s);
  if (Number.isFinite(serial) && serial > 20000 && serial < 90000) {
    // Google Sheets serial date → UTC date
    const utc = new Date(Math.round((serial - 25569) * 86400 * 1000));
    if (!Number.isNaN(utc.getTime())) return utc.toISOString().slice(0, 10);
  }
  return "";
}

function normalizeLifetime(n, fallback = DEFAULT_LIFETIME) {
  const days = Math.round(Number(n));
  if (!Number.isFinite(days) || days < 1) return fallback;
  if (days > 3650) return 3650;
  return days;
}

function isDriveFileId(id) {
  const s = String(id || "").trim();
  if (!s || /^https?:/i.test(s) || /^data:/i.test(s)) return false;
  return /^[a-zA-Z0-9_-]{20,}$/.test(s);
}

function safeRouteNr(nr) {
  const s = String(nr == null ? "" : nr).trim().replace(/[^\w\-]+/g, "_");
  return s || "x";
}

function suggestedImageKey(nr, bild) {
  const safe = safeRouteNr(nr);
  if (!safe || safe === "x") return "";
  const b = String(bild || "").trim().toLowerCase();
  const ext = b.includes("png") || b.endsWith(".png") ? "png" : "jpg";
  return `led-${safe}.${ext}`;
}

/** Minimal CSV-parser (hanterar citerade fält). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let i = 0;
  let inQuotes = false;
  const s = String(text || "").replace(/^\uFEFF/, "");
  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      i++;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => String(c).trim() !== "")) rows.push(row);
      row = [];
      cell = "";
      i++;
      continue;
    }
    cell += ch;
    i++;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    if (row.some((c) => String(c).trim() !== "")) rows.push(row);
  }
  return rows;
}

function objectsFromCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const headers = rows[0].map((h) => String(h || "").trim());
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      if (!headers[c]) continue;
      obj[headers[c]] = rows[r][c] == null ? "" : rows[r][c];
    }
    out.push(obj);
  }
  return out;
}

function findCsv(dir, names) {
  const files = fs.readdirSync(dir);
  const lower = files.map((f) => ({ f, l: f.toLowerCase() }));
  for (const name of names) {
    const hit = lower.find((x) => x.l === name.toLowerCase() || x.l.replace(/\s+/g, "") === name.toLowerCase().replace(/\s+/g, ""));
    if (hit) return path.join(dir, hit.f);
  }
  return "";
}

function loadFromCsvDir(dir) {
  const routesPath = findCsv(dir, ["Alla leder.csv", "alla-leder.csv", "routes.csv"]);
  const gradesPath = findCsv(dir, ["Grades.csv", "grades.csv"]);
  const usersPath = findCsv(dir, ["Users.csv", "users.csv"]);
  const qrPath = findCsv(dir, ["BaseUrlQr.csv", "baseurlqr.csv"]);
  if (!routesPath && !usersPath) {
    throw new Error("Hittade varken Alla leder.csv eller Users.csv i " + dir);
  }
  const snapshot = {
    exportedAt: null,
    source: "csv",
    grades: [],
    routes: [],
    users: [],
    routeLifetimeDays: DEFAULT_LIFETIME,
    baseUrlQr: ""
  };
  if (routesPath) {
    snapshot.routes = objectsFromCsv(fs.readFileSync(routesPath, "utf8")).map((row) => ({
      Nr: row.Nr,
      Gradering: row.Gradering,
      DagsAttByggaOm: row["Dags att bygga om"] || row.DagsAttByggaOm,
      Ledbyggare: row.Ledbyggare,
      Byggdatum: row.Byggdatum,
      Slutdatum: row.Slutdatum,
      Anteckningar: row.Anteckningar,
      Bild: row.Bild,
      Livslangd: row.Livslangd || row["Livslängd"] || row.I
    }));
  }
  if (gradesPath) {
    const rows = parseCsv(fs.readFileSync(gradesPath, "utf8"));
    snapshot.grades = readGradesFromRows(rows);
  }
  if (usersPath) {
    snapshot.users = objectsFromCsv(fs.readFileSync(usersPath, "utf8")).map((u) => ({
      username: u.Username || u.username,
      passwordHash: u.passwordHash || u.password_hash,
      salt: u.salt,
      role: u.role || u.Role,
      name: u.name || u.Name || u.Namn,
      FirstLogin: u.FirstLogin
    }));
  }
  if (qrPath) {
    const rows = parseCsv(fs.readFileSync(qrPath, "utf8"));
    snapshot.baseUrlQr = readBaseUrlFromCsvRows(rows);
  }
  return snapshot;
}

function readGradesFromRows(rows) {
  const out = [];
  const seen = {};
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    const a = String(row[0] == null ? "" : row[0]).trim();
    const b = String(row[1] == null ? "" : row[1]).trim();
    if (!a && !b) continue;
    let name = "";
    let order = i + 1;
    if (b && Number.isNaN(Number(b)) && b.toLowerCase() !== "gradering" && b.toLowerCase() !== "grade") {
      name = b;
      if (!Number.isNaN(Number(a))) order = Number(a);
    } else if (a && Number.isNaN(Number(a)) && a.toLowerCase() !== "gradering" && a.toLowerCase() !== "grade") {
      name = a;
    }
    if (!name || seen[name.toLowerCase()]) continue;
    seen[name.toLowerCase()] = true;
    out.push({ Order: order, Namn: name });
  }
  out.sort((x, y) => (x.Order || 0) - (y.Order || 0));
  return out.map((g) => g.Namn);
}

function readBaseUrlFromCsvRows(rows) {
  function isHeader(s) {
    const low = String(s || "").toLowerCase().replace(/\s+/g, "");
    return low === "baseurlqr" || low === "url" || low === "basurl" || low === "baseurl";
  }
  const cells = [];
  for (const row of rows) {
    for (const c of row) {
      const t = String(c || "").trim();
      if (t) cells.push(t);
    }
  }
  for (const t of cells) {
    if (!isHeader(t)) return t;
  }
  return "";
}

function loadSnapshot(args) {
  if (args.csvDir) {
    return loadFromCsvDir(args.csvDir);
  }
  if (!args.input) throw new Error("Ange snapshot.json eller --csv-dir");
  const raw = JSON.parse(fs.readFileSync(args.input, "utf8"));
  if (!raw || typeof raw !== "object") throw new Error("Ogiltig snapshot");
  return raw;
}

function normalizeSnapshot(raw) {
  const lifetime = normalizeLifetime(raw.routeLifetimeDays, DEFAULT_LIFETIME);
  let grades = Array.isArray(raw.grades) ? raw.grades.map((g) => String(g || "").trim()).filter(Boolean) : [];
  if (!grades.length) grades = DEFAULT_GRADES.slice();

  const routesIn = Array.isArray(raw.routes) ? raw.routes : [];
  const routes = [];
  const seenNr = new Set();
  for (const r of routesIn) {
    if (!isRouteRow(r)) continue;
    let nr = String(r.Nr == null ? "" : r.Nr).trim();
    if (!nr) continue;
    const key = nr.toLowerCase();
    if (seenNr.has(key)) continue;
    seenNr.add(key);
    const lifeRaw = r.Livslangd != null ? r.Livslangd : r["Livslängd"];
    routes.push({
      Nr: nr,
      Gradering: String(r.Gradering || "").trim(),
      Ledbyggare: String(r.Ledbyggare || "").trim(),
      Byggdatum: formatDate(r.Byggdatum),
      Anteckningar: String(r.Anteckningar || "").trim(),
      Bild: String(r.Bild || "").trim(),
      Livslangd: lifeRaw == null || String(lifeRaw).trim() === "" ? lifetime : normalizeLifetime(lifeRaw, lifetime)
    });
  }

  const usersIn = Array.isArray(raw.users) ? raw.users : [];
  const users = [];
  const seenUser = new Set();
  for (const u of usersIn) {
    const username = String(u.username || u.Username || "").trim();
    if (!username) continue;
    const ukey = username.toLowerCase();
    if (seenUser.has(ukey)) continue;
    seenUser.add(ukey);
    users.push({
      username,
      passwordHash: String(u.passwordHash || u.password_hash || ""),
      salt: String(u.salt || ""),
      role: normalizeRole(u.role || u.Role),
      name: String(u.name || u.Name || u.Namn || "").trim(),
      firstLogin: isFirstLogin(u.FirstLogin)
    });
  }

  return {
    grades,
    routes,
    users,
    routeLifetimeDays: lifetime,
    baseUrlQr: String(raw.baseUrlQr || "").trim(),
    images: Array.isArray(raw.images) ? raw.images : []
  };
}

function imageKeyByNr(images) {
  const map = new Map();
  for (const img of images || []) {
    const nr = String(img.nr || "").trim();
    const key = String(img.suggestedKey || "").trim();
    if (nr && key) map.set(nr.toLowerCase(), key);
  }
  return map;
}

function applyMode(data, mode, rewriteImages) {
  const structure = mode === "structure";
  const keys = imageKeyByNr(data.images);
  const routes = data.routes.map((r) => {
    if (structure) {
      return {
        Nr: r.Nr,
        Gradering: "Ej uppsatt",
        Ledbyggare: "",
        Byggdatum: "",
        Anteckningar: "",
        Bild: "",
        Livslangd: data.routeLifetimeDays
      };
    }
    let bild = r.Bild;
    if (rewriteImages) {
      if (isDriveFileId(r.Bild)) {
        bild = keys.get(String(r.Nr).toLowerCase()) || suggestedImageKey(r.Nr, r.Bild);
      } else if (/^https?:/i.test(r.Bild)) {
        bild = r.Bild;
      } else {
        bild = "";
      }
    }
    return { ...r, Bild: bild };
  });
  return { ...data, routes };
}

function emitSql(data) {
  const lines = [];
  lines.push("-- Genererad av cloudflare/import.mjs — kör inte in i git.");
  lines.push("PRAGMA foreign_keys = OFF;");
  lines.push("BEGIN TRANSACTION;");
  lines.push("DELETE FROM routes;");
  lines.push("DELETE FROM grades;");
  lines.push("DELETE FROM users;");
  lines.push("DELETE FROM settings;");

  data.grades.forEach((namn, i) => {
    lines.push(`INSERT INTO grades (namn, sort_order) VALUES (${sqlStr(namn)}, ${i + 1});`);
  });

  for (const r of data.routes) {
    lines.push(
      "INSERT INTO routes (nr, gradering, ledbyggare, byggdatum, anteckningar, bild_key, livslangd) VALUES (" +
        [sqlStr(r.Nr), sqlStr(r.Gradering), sqlStr(r.Ledbyggare), sqlStr(r.Byggdatum), sqlStr(r.Anteckningar), sqlStr(r.Bild), sqlInt(r.Livslangd, DEFAULT_LIFETIME)].join(", ") +
        ");"
    );
  }

  for (const u of data.users) {
    if (!u.passwordHash || !u.salt) {
      lines.push(`-- hoppar över användare utan hash/salt: ${u.username}`);
      continue;
    }
    lines.push(
      "INSERT INTO users (username, password_hash, salt, role, name, first_login) VALUES (" +
        [sqlStr(u.username), sqlStr(u.passwordHash), sqlStr(u.salt), sqlStr(u.role), sqlStr(u.name), u.firstLogin ? "1" : "0"].join(", ") +
        ");"
    );
  }

  lines.push(`INSERT INTO settings (key, value) VALUES ('routeLifetimeDays', ${sqlStr(String(data.routeLifetimeDays))});`);
  lines.push(`INSERT INTO settings (key, value) VALUES ('baseUrlQr', ${sqlStr(data.baseUrlQr)});`);
  lines.push("COMMIT;");
  lines.push("PRAGMA foreign_keys = ON;");
  return lines.join("\n") + "\n";
}

function writeManifest(data, outPath) {
  const byId = new Map();
  for (const img of data.images || []) {
    const fileId = String(img.fileId || "").trim();
    if (!isDriveFileId(fileId)) continue;
    byId.set(fileId, {
      nr: img.nr || "",
      fileId,
      name: img.name || "",
      mimeType: img.mimeType || "",
      suggestedKey: img.suggestedKey || suggestedImageKey(img.nr, img.name || img.fileId),
      downloadUrl: img.downloadUrl || ("https://drive.google.com/uc?export=download&id=" + fileId),
      orphan: !!img.orphan
    });
  }
  for (const r of data.routes) {
    if (!isDriveFileId(r.Bild)) continue;
    if (byId.has(r.Bild)) continue;
    byId.set(r.Bild, {
      nr: r.Nr,
      fileId: r.Bild,
      name: "",
      mimeType: "",
      suggestedKey: suggestedImageKey(r.Nr, r.Bild),
      downloadUrl: "https://drive.google.com/uc?export=download&id=" + r.Bild,
      orphan: false
    });
  }
  const items = [...byId.values()];
  fs.writeFileSync(outPath, JSON.stringify({ count: items.length, images: items }, null, 2) + "\n");
  return items.length;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }
  if (args.mode !== "structure" && args.mode !== "full") {
    throw new Error("--mode måste vara structure eller full");
  }

  const raw = loadSnapshot(args);
  const original = normalizeSnapshot(raw);
  const data = applyMode(original, args.mode, args.rewriteImages);

  if (!data.users.length) {
    console.error("Varning: inga användare i snapshoten. Inloggning kommer inte fungera förrän Users importeras.");
  } else if (!data.users.some((u) => u.role === "superadmin")) {
    console.error("Varning: ingen superadmin i snapshoten.");
  }

  process.stderr.write(
    `Import ${args.mode}: ${data.routes.length} leder, ${data.users.length} användare, ${data.grades.length} graderingar, livslängd=${data.routeLifetimeDays}\n`
  );

  if (args.mode === "full") {
    const dir = args.csvDir
      ? args.csvDir
      : path.dirname(path.resolve(args.input));
    const manifestPath = path.join(dir, "images-manifest.json");
    const n = writeManifest(original, manifestPath);
    process.stderr.write(`Bildmanifest: ${n} filer → ${manifestPath}\n`);
  }

  process.stdout.write(emitSql(data));
}

try {
  main();
} catch (err) {
  console.error(err && err.message ? err.message : err);
  console.error(usage());
  process.exit(1);
}
