#!/usr/bin/env node
/**
 * Seed lokal D1 från fixtures/sample-snapshot.json + en testanvändare admin/wallflow.
 * Kör från cloudflare/: node scripts/seed-local.mjs
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function hashPassword(password, salt) {
  return createHash("sha256").update(String(salt) + String(password), "utf8").digest("hex");
}

function esc(s) {
  return String(s == null ? "" : s).replace(/'/g, "''");
}

const snap = JSON.parse(readFileSync(join(root, "fixtures/sample-snapshot.json"), "utf8"));
const salt = "seedlocalsalt0123456789abcdef01";
const adminHash = hashPassword("wallflow", salt);

const lines = [];
lines.push("PRAGMA foreign_keys = ON;");
lines.push("DELETE FROM time_entries;");
lines.push("DELETE FROM routes;");
lines.push("DELETE FROM grades;");
lines.push("DELETE FROM users;");
lines.push("DELETE FROM settings;");

(snap.grades || []).forEach((g, i) => {
  lines.push(`INSERT INTO grades (namn, sort_order) VALUES ('${esc(g)}', ${i + 1});`);
});

for (const r of snap.routes || []) {
  const nr = String(r.Nr || "").trim();
  if (!nr) continue;
  if (String(r.DagsAttByggaOm || "") === "Antal") continue;
  const life = Number(r.Livslangd) || 30;
  // R2-nyckel om Drive-ID fanns
  let bild = "";
  if (r.Bild) {
    const img = (snap.images || []).find((x) => x.fileId === r.Bild || x.nr === nr);
    bild = img ? img.suggestedKey : ("led-" + nr + ".jpg");
  }
  lines.push(
    `INSERT INTO routes (nr, gradering, ledbyggare, byggdatum, anteckningar, bild_key, livslangd) VALUES (` +
    `'${esc(nr)}', '${esc(r.Gradering)}', '${esc(r.Ledbyggare)}', '${esc(r.Byggdatum)}', '${esc(r.Anteckningar)}', '${esc(bild)}', ${life});`
  );
}

lines.push(
  `INSERT INTO users (username, password_hash, salt, role, name, first_login) VALUES (` +
  `'admin', '${adminHash}', '${salt}', 'superadmin', 'Admin', 0);`
);

lines.push(`INSERT INTO settings (key, value) VALUES ('routeLifetimeDays', '${esc(snap.routeLifetimeDays || 30)}');`);
lines.push(`INSERT INTO settings (key, value) VALUES ('baseUrlQr', '${esc(snap.baseUrlQr || "")}');`);
lines.push(`INSERT INTO settings (key, value) VALUES ('timeLedbyggHourlyRate', '150');`);
lines.push(`INSERT INTO settings (key, value) VALUES ('timeMinPayout', '500');`);
lines.push(`INSERT INTO settings (key, value) VALUES ('timeHallvardShiftAmount', '200');`);
lines.push(`INSERT INTO settings (key, value) VALUES ('timeMaxYearAmount', '5000');`);
lines.push(`INSERT INTO settings (key, value) VALUES ('timeWarningYearAmount', '4000');`);

const dir = mkdtempSync(join(tmpdir(), "wallflow-seed-"));
const sqlPath = join(dir, "seed.sql");
writeFileSync(sqlPath, lines.join("\n") + "\n");

console.log("Applying schema…");
let r = spawnSync("npx", ["wrangler", "d1", "execute", "wallflow", "--local", "--file=schema.sql"], {
  cwd: root,
  encoding: "utf8",
  shell: false
});
if (r.status !== 0) {
  console.error(r.stdout, r.stderr);
  process.exit(r.status || 1);
}

console.log("Seeding…");
r = spawnSync("npx", ["wrangler", "d1", "execute", "wallflow", "--local", `--file=${sqlPath}`], {
  cwd: root,
  encoding: "utf8",
  shell: false
});
if (r.status !== 0) {
  console.error(r.stdout, r.stderr);
  process.exit(r.status || 1);
}
console.log("Local D1 seeded. Login: admin / wallflow");
void randomUUID;
