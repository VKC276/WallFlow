/** Utlägg och verifikationer: inställningar, PDF-lagring, mejl. */

import { getSetting, setSetting, todayStockholm } from "./db.js";
import { isSuperadminRole, roleOf, validateEmail } from "./auth.js";
import { roundMoney } from "./time.js";
import { mailVerification } from "./mail.js";

export const VERIF_ARCHIVE_EMAIL_KEY = "verifArchiveEmail";
export const DEFAULT_VERIF_ARCHIVE_EMAIL = "inbox.ver.1624638@arkivplats.se";
export const VERIF_ORG_NAME = "Västerviks klätterklubb";
export const VERIF_ORG_NR = "802431-5718";
export const MAX_PDF_BASE64_CHARS = 9000000;

export function canUseVerifTool(session) {
  return !!(session && session.username);
}

export function canManageVerifSettings(session) {
  return isSuperadminRole(roleOf(session));
}

export function isVerifPdfKey(key) {
  return /^verif\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/i.test(
    String(key || "").trim()
  );
}

export async function readVerifArchiveEmail(env) {
  const raw = await getSetting(env, VERIF_ARCHIVE_EMAIL_KEY, DEFAULT_VERIF_ARCHIVE_EMAIL);
  const check = validateEmail(raw);
  return check.ok ? check.email : DEFAULT_VERIF_ARCHIVE_EMAIL;
}

export async function saveVerifArchiveEmail(env, raw) {
  const check = validateEmail(raw);
  if (!check.ok) return { ok: false, error: check.error };
  await setSetting(env, VERIF_ARCHIVE_EMAIL_KEY, check.email);
  return { ok: true, archiveEmail: check.email };
}

function clipText(raw, max) {
  return String(raw == null ? "" : raw).replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeLines(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const row of list) {
    const spec = clipText(row && (row.spec || row.description || row.text), 240);
    const amount = roundMoney(row && (row.amount != null ? row.amount : row.summa));
    if (!spec && amount === 0) continue;
    if (!spec) return { ok: false, error: "Varje rad måste ha en specifikation" };
    if (!(amount > 0)) return { ok: false, error: "Varje rad måste ha ett belopp större än 0" };
    out.push({ spec, amount });
    if (out.length > 20) return { ok: false, error: "Högst 20 rader per blankett" };
  }
  if (!out.length) return { ok: false, error: "Lägg till minst ett inköp" };
  return { ok: true, lines: out };
}

function base64ToBytes(b64) {
  const raw = String(b64 || "").replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
  const bin = atob(raw);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function looksLikePdf(bytes) {
  if (!bytes || bytes.length < 5) return false;
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

export async function getVerifApp(env, session) {
  return {
    ok: true,
    archiveEmail: await readVerifArchiveEmail(env),
    orgName: VERIF_ORG_NAME,
    orgNr: VERIF_ORG_NR,
    today: todayStockholm(),
    canManage: canManageVerifSettings(session)
  };
}

export async function saveVerifSettingsAction(env, payload, session) {
  if (!canManageVerifSettings(session)) {
    return { ok: false, error: "Bara superadmin kan ändra bokföringsmejlet" };
  }
  return saveVerifArchiveEmail(env, payload && payload.archiveEmail);
}

export async function submitVerification(env, payload, session, user, origin) {
  if (!canUseVerifTool(session)) return { ok: false, error: "Ej inloggad" };
  const toEmail = String((user && user.email) || "").trim().toLowerCase();
  const mailCheck = validateEmail(toEmail);
  if (!mailCheck.ok) {
    return { ok: false, error: "Ditt konto saknar e-post. Be en admin lägga till den innan du skickar verifikation." };
  }

  const clubCard = !!(payload && (payload.clubCard || payload.klubbkort));
  const linesRes = normalizeLines(payload && payload.lines);
  if (!linesRes.ok) return linesRes;
  const lines = linesRes.lines;
  const total = roundMoney(lines.reduce((s, r) => s + r.amount, 0));

  const firstName = clipText(payload && payload.firstName, 80);
  const lastName = clipText(payload && payload.lastName, 80);
  const purchaser = clipText(payload && (payload.purchaser || payload.buyer), 120)
    || [firstName, lastName].filter(Boolean).join(" ")
    || String((user && (user.name || user.username)) || "").trim();
  const purchaseDate = String((payload && (payload.purchaseDate || payload.date)) || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)) {
    return { ok: false, error: "Ange inköpsdatum" };
  }

  let bank = "";
  let clearing = "";
  let account = "";
  let address = clipText(payload && payload.address, 120);
  let postalCode = clipText(payload && (payload.postalCode || payload.postnummer), 20);
  let city = clipText(payload && (payload.city || payload.postadress), 80);

  if (clubCard) {
    if (!purchaser) return { ok: false, error: "Ange vem som gjort inköpet med klubbens kort" };
  } else {
    if (!firstName || !lastName) return { ok: false, error: "Ange förnamn och efternamn för utbetalning" };
    bank = clipText(payload && payload.bank, 80);
    clearing = clipText(payload && payload.clearing, 20);
    account = clipText(payload && (payload.account || payload.kontonummer), 40);
    if (!bank || !clearing || !account) {
      return { ok: false, error: "Bank, clearingnummer och kontonummer krävs för utbetalning" };
    }
  }

  const pdfRaw = String((payload && payload.pdfBase64) || "");
  if (!pdfRaw) return { ok: false, error: "PDF saknas" };
  if (pdfRaw.length > MAX_PDF_BASE64_CHARS) {
    return { ok: false, error: "PDF:en är för stor — prova färre eller mindre kvitton" };
  }
  let bytes;
  try {
    bytes = base64ToBytes(pdfRaw);
  } catch {
    return { ok: false, error: "Kunde inte läsa PDF:en" };
  }
  if (!looksLikePdf(bytes) || bytes.length < 100) {
    return { ok: false, error: "Ogiltig PDF" };
  }
  if (bytes.length > 6.5e6) {
    return { ok: false, error: "PDF:en är för stor — prova färre eller mindre kvitton" };
  }

  const id = crypto.randomUUID();
  const key = "verif/" + id + ".pdf";
  const filename = clubCard
    ? "verifikation-klubbkort-" + purchaseDate + ".pdf"
    : "utlagg-" + purchaseDate + ".pdf";

  await env.BILDER.put(key, bytes, {
    httpMetadata: { contentType: "application/pdf" },
    customMetadata: {
      username: String(session.username || ""),
      kind: clubCard ? "club-card" : "payout",
      date: purchaseDate
    }
  });

  const downloadUrl = appVerifUrl(env, key, origin);
  const archiveEmail = await readVerifArchiveEmail(env);
  const meta = {
    clubCard,
    purchaser,
    purchaseDate,
    firstName,
    lastName,
    address,
    postalCode,
    city,
    bank,
    clearing,
    account,
    lines,
    total,
    orgName: VERIF_ORG_NAME,
    orgNr: VERIF_ORG_NR
  };

  try {
    await mailVerification(env, {
      to: mailCheck.email,
      name: user.name || user.username,
      archiveEmail,
      downloadUrl,
      filename,
      pdfBytes: bytes,
      meta
    });
  } catch (err) {
    return {
      ok: false,
      error: "PDF sparad men mejlet kunde inte skickas: " + String(err && err.message ? err.message : err),
      downloadUrl,
      filename
    };
  }

  return {
    ok: true,
    id,
    kind: clubCard ? "club-card" : "payout",
    total,
    archiveEmail,
    downloadUrl,
    filename
  };
}

export function appVerifUrl(env, key, origin) {
  const fromEnv = String((env && env.API_PUBLIC_URL) || "").trim().replace(/\/+$/, "");
  const fromReq = String(origin || "").trim().replace(/\/+$/, "");
  const base = fromReq || fromEnv || "https://wallflow.muddy-rice-38d4.workers.dev";
  const leaf = String(key || "").replace(/^verif\//, "");
  return base + "/verif/" + encodeURIComponent(leaf);
}

export async function serveVerifPdf(env, idOrKey) {
  let key = decodeURIComponent(String(idOrKey || "").trim()).replace(/^\/+/, "");
  if (!key.startsWith("verif/")) key = "verif/" + key;
  if (!key.toLowerCase().endsWith(".pdf")) key += ".pdf";
  if (!isVerifPdfKey(key)) return null;
  const obj = await env.BILDER.get(key);
  if (!obj) return null;
  const headers = new Headers();
  headers.set("Content-Type", "application/pdf");
  headers.set("Content-Disposition", 'inline; filename="verifikation.pdf"');
  headers.set("Cache-Control", "private, max-age=86400");
  return new Response(obj.body, { headers });
}
