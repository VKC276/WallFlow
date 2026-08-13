/** R2 bildhantering — nycklar led-{nr}.jpg|png */

import { safeRouteNrForFile } from "./db.js";

export function isR2ImageKey(id) {
  const s = String(id == null ? "" : id).trim();
  if (!s || /^https?:/i.test(s) || /^data:/i.test(s)) return false;
  if (/^led-[\w\-]+\.(jpe?g|png|webp)$/i.test(s)) return true;
  if (/\.(jpe?g|png|webp)$/i.test(s) && !/^[a-zA-Z0-9_-]{20,}$/.test(s)) return true;
  return false;
}

export function isDriveFileId(id) {
  const s = String(id == null ? "" : id).trim();
  if (!s || /^https?:/i.test(s) || /^data:/i.test(s)) return false;
  if (isR2ImageKey(s)) return false;
  return /^[a-zA-Z0-9_-]{20,}$/.test(s);
}

export async function deleteBilderByRouteNr(env, nr) {
  const safeNr = safeRouteNrForFile(nr);
  if (!safeNr || safeNr === "x") return 0;
  const prefix = "led-" + safeNr;
  const listed = await env.BILDER.list({ prefix });
  let n = 0;
  for (const obj of listed.objects || []) {
    const name = String(obj.key || "");
    if (
      name === prefix + ".jpg" ||
      name === prefix + ".png" ||
      name === prefix + ".jpeg" ||
      name === prefix + ".webp" ||
      name.indexOf(prefix + "-") === 0 ||
      name.indexOf(prefix + ".") === 0
    ) {
      await env.BILDER.delete(name);
      n++;
    }
  }
  return n;
}

export async function deleteBilderKey(env, key) {
  const k = String(key || "").trim();
  if (!k || !isR2ImageKey(k)) return false;
  await env.BILDER.delete(k);
  return true;
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * payload: { dataBase64, mimeType, nr, previousFileId }
 * Returnerar fileId = R2-nyckel (samma fält som GAS Drive-ID).
 */
export async function uploadRouteImage(env, payload) {
  payload = payload || {};
  const raw = String(payload.dataBase64 || "").replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
  if (!raw) return { ok: false, error: "Ingen bilddata" };
  if (raw.length > 6000000) return { ok: false, error: "Bilden är för stor — prova lägre upplösning" };

  let mime = String(payload.mimeType || "image/jpeg").trim() || "image/jpeg";
  if (mime.indexOf("image/") !== 0) mime = "image/jpeg";
  const nr = String(payload.nr || "").trim();
  const safeNr = safeRouteNrForFile(nr);
  if (!nr || safeNr === "x") {
    return { ok: false, error: "Lednummer krävs för bilduppladdning" };
  }
  const ext = mime.indexOf("png") >= 0 ? "png" : "jpg";
  const name = "led-" + safeNr + "." + ext;

  const prev = String(payload.previousFileId || "").trim();
  if (isR2ImageKey(prev)) await deleteBilderKey(env, prev);
  await deleteBilderByRouteNr(env, nr);

  const bytes = base64ToBytes(raw);
  await env.BILDER.put(name, bytes, {
    httpMetadata: { contentType: mime }
  });

  return {
    ok: true,
    fileId: name,
    url: "/img/" + encodeURIComponent(name),
    name
  };
}

export async function serveImage(env, key) {
  const k = decodeURIComponent(String(key || "").trim()).replace(/^\/+/, "");
  if (!k || k.includes("..")) return null;
  const obj = await env.BILDER.get(k);
  if (!obj) return null;
  const headers = new Headers();
  const ct = (obj.httpMetadata && obj.httpMetadata.contentType) || guessMime(k);
  headers.set("Content-Type", ct);
  headers.set("Cache-Control", "public, max-age=86400");
  return new Response(obj.body, { headers });
}

function guessMime(key) {
  const lower = String(key).toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}
