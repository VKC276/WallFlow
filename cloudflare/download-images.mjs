#!/usr/bin/env node
/**
 * Ladda ner led-bilder från Google Drive utifrån images-manifest.json
 * eller wallflow-export.json.
 *
 *   node cloudflare/download-images.mjs cloudflare/snapshots/images-manifest.json
 *   node cloudflare/download-images.mjs cloudflare/snapshots/wallflow-export.json --out cloudflare/snapshots/images
 *
 * Filerna är "Anyone with the link" (samma som appen). Stora filer kan
 * få Googles virus-scan-HTML i stället för bilden — då får ni ladda ner
 * manuellt från Drive-mappen Bilder.
 */

import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = { input: "", out: "", dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out" && argv[i + 1]) args.out = argv[++i];
    else if (a.startsWith("--out=")) args.out = a.slice("--out=".length);
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (!a.startsWith("-") && !args.input) args.input = a;
  }
  return args;
}

function usage() {
  return `Användning:
  node cloudflare/download-images.mjs <images-manifest.json|wallflow-export.json> [--out mapp] [--dry-run]

Default --out: <samma mapp som indata>/images`;
}

function isDriveFileId(id) {
  const s = String(id || "").trim();
  if (!s || /^https?:/i.test(s) || /^data:/i.test(s)) return false;
  return /^[a-zA-Z0-9_-]{20,}$/.test(s);
}

function loadImages(inputPath) {
  const raw = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  if (Array.isArray(raw.images)) return raw.images;
  if (raw.routes) {
    return (raw.routes || [])
      .filter((r) => isDriveFileId(r.Bild))
      .map((r) => ({
        nr: r.Nr,
        fileId: r.Bild,
        suggestedKey: "led-" + String(r.Nr).replace(/[^\w\-]+/g, "_") + ".jpg",
        downloadUrl: "https://drive.google.com/uc?export=download&id=" + r.Bild
      }));
  }
  throw new Error("Förväntade { images: [...] } eller en WallFlow-snapshot");
}

function looksLikeHtml(buf) {
  const head = buf.slice(0, 64).toString("utf8").trim().toLowerCase();
  return head.startsWith("<!doctype") || head.startsWith("<html");
}

async function downloadOne(img, destPath) {
  const url = img.downloadUrl || ("https://drive.google.com/uc?export=download&id=" + img.fileId);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error("tom fil");
  if (looksLikeHtml(buf)) throw new Error("Drive returnerade HTML (behörighet eller virus-scan)");
  fs.writeFileSync(destPath, buf);
  return buf.length;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }
  if (!args.input) throw new Error("Ange images-manifest.json eller snapshot.json");
  const inputPath = path.resolve(args.input);
  const outDir = path.resolve(args.out || path.join(path.dirname(inputPath), "images"));
  const images = loadImages(inputPath).filter((img) => isDriveFileId(img.fileId));
  if (!images.length) {
    console.log("Inga Drive-bilder att hämta.");
    return;
  }
  if (!args.dryRun) fs.mkdirSync(outDir, { recursive: true });

  const failures = [];
  let ok = 0;
  for (const img of images) {
    const key = String(img.suggestedKey || ("led-" + (img.nr || img.fileId) + ".jpg")).replace(/[\\/]/g, "_");
    const dest = path.join(outDir, key);
    process.stderr.write((img.nr || "?") + " → " + key + " … ");
    if (args.dryRun) {
      process.stderr.write("dry-run\n");
      ok++;
      continue;
    }
    try {
      const bytes = await downloadOne(img, dest);
      process.stderr.write(bytes + " byte\n");
      ok++;
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      process.stderr.write("MISS " + msg + "\n");
      failures.push({ nr: img.nr, fileId: img.fileId, key, error: msg });
    }
  }

  const report = {
    ok,
    failed: failures.length,
    outDir,
    failures
  };
  if (!args.dryRun) {
    fs.writeFileSync(path.join(outDir, "download-report.json"), JSON.stringify(report, null, 2) + "\n");
  }
  console.log("Klart: " + ok + " hämtade, " + failures.length + " misslyckade → " + outDir);
  if (failures.length) {
    console.error("Ladda ner misslyckade filer manuellt från Drive-mappen Bilder.");
    process.exitCode = 1;
  } else {
    console.log("Ladda upp till R2 (från cloudflare/ med wrangler.toml):");
    console.log("  for f in " + outDir + "/*.{jpg,png,jpeg,webp}; do");
    console.log("    [ -f \"$f\" ] || continue");
    console.log("    npx wrangler r2 object put wallflow-bilder/$(basename \"$f\") --file \"$f\" --remote");
    console.log("  done");
  }
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  console.error(usage());
  process.exit(1);
});
