/** Friskvårdskvitto: utfärda, lagra PDF, mejla. */

import { canIssueWellnessReceipt, hashPassword, validateEmail } from "./auth.js";
import { findUser, todayStockholm } from "./db.js";
import { roundMoney } from "./time.js";
import { mailWellnessReceipt } from "./mail.js";

export const WELLNESS_ORG_NAME = "Västerviks klätterklubb";
export const WELLNESS_ORG_NR = "802431-5718";
export const WELLNESS_ORG_ADDRESS = "Klätterhallen, Västervik";
export const WELLNESS_ORG_LEGAL =
  "Ideell förening som inte är momsregistrerad";
export const WELLNESS_ORG_VAT =
  "Moms utgår inte. Beloppet avser 0 kr moms.";
export const MAX_PDF_BASE64_CHARS = 9000000;

function clipText(raw, max) {
  return String(raw == null ? "" : raw).replace(/\s+/g, " ").trim().slice(0, max);
}

function nowIso() {
  return new Date().toISOString();
}

function ymd(raw, fallback) {
  const s = String(raw || "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fallback;
}

function normalizeIdnr(raw) {
  const compact = String(raw == null ? "" : raw).replace(/\s+/g, "").trim();
  if (!compact) return { ok: true, value: "" };
  if (!/^\d{6,8}[-+]?\d{4}$/.test(compact) && !/^\d{10}$/.test(compact) && !/^\d{12}$/.test(compact)) {
    return { ok: false, error: "Personnummer ska anges med 10 eller 12 siffror" };
  }
  return { ok: true, value: compact.slice(0, 13) };
}

async function verifySessionPassword(env, session, password) {
  if (!String(password || "")) {
    return { ok: false, error: "Ange ditt lösenord för att signera kvittot" };
  }
  const u = await findUser(env, session && session.username);
  if (!u || !u.salt || !u.passwordHash) {
    return { ok: false, error: "Användaren hittades inte" };
  }
  const hash = await hashPassword(String(password), u.salt);
  if (hash !== u.passwordHash) return { ok: false, error: "Fel lösenord" };
  return { ok: true, user: u };
}

function deny() {
  return { ok: false, error: "Saknar behörighet" };
}

function base64ToBytes(b64) {
  const raw = String(b64 || "").replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
  const bin = atob(raw);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function looksLikePdf(bytes) {
  if (!bytes || bytes.length < 5) return false;
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

export function isWellnessPdfKey(key) {
  return /^friskvard\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/i.test(
    String(key || "").trim()
  );
}

export function appWellnessUrl(env, key, origin) {
  const fromEnv = String((env && env.API_PUBLIC_URL) || "").trim().replace(/\/+$/, "");
  const fromReq = String(origin || "").trim().replace(/\/+$/, "");
  const base = fromReq || fromEnv || "https://wallflow.muddy-rice-38d4.workers.dev";
  const leaf = String(key || "").replace(/^friskvard\//, "");
  return base + "/friskvard/" + encodeURIComponent(leaf);
}

function orgMeta() {
  return {
    orgName: WELLNESS_ORG_NAME,
    orgNr: WELLNESS_ORG_NR,
    orgAddress: WELLNESS_ORG_ADDRESS,
    orgLegal: WELLNESS_ORG_LEGAL,
    orgVat: WELLNESS_ORG_VAT
  };
}

function mapRow(row, env, origin) {
  if (!row) return null;
  const hasPdf = !!String(row.pdf_key || "").trim();
  return {
    id: row.id,
    receiptNo: row.receipt_no,
    issuedAt: row.issued_at,
    purchaseDate: row.purchase_date,
    recipientName: row.recipient_name,
    recipientEmail: row.recipient_email || "",
    recipientIdnr: row.recipient_idnr || "",
    description: row.description,
    period: row.period || "",
    amount: roundMoney(row.amount),
    issuerUsername: row.issuer_username,
    issuerName: row.issuer_name,
    signedAt: row.signed_at,
    hasPdf,
    emailedAt: row.emailed_at || "",
    downloadUrl: hasPdf ? appWellnessUrl(env, row.pdf_key, origin) : "",
    filename: "friskvardskvitto-" + String(row.receipt_no || "").replace(/\s+/g, "") + ".pdf",
    ...orgMeta()
  };
}

async function getRow(env, id) {
  const key = String(id || "").trim();
  if (!key) return null;
  return env.DB.prepare("SELECT * FROM wellness_receipts WHERE id = ?").bind(key).first();
}

async function nextReceiptNo(env, year) {
  const prefix = "FV-" + year + "-";
  const row = await env.DB.prepare(
    "SELECT receipt_no FROM wellness_receipts WHERE receipt_no LIKE ? ORDER BY receipt_no DESC LIMIT 1"
  ).bind(prefix + "%").first();
  let n = 1;
  if (row && row.receipt_no) {
    const m = String(row.receipt_no).match(/-(\d+)$/);
    if (m) n = Number(m[1]) + 1;
  }
  if (!Number.isFinite(n) || n < 1) n = 1;
  return prefix + String(n).padStart(4, "0");
}

async function listRecent(env, origin) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM wellness_receipts ORDER BY issued_at DESC LIMIT 40"
  ).all();
  return (results || []).map((row) => mapRow(row, env, origin));
}

export async function getWellnessApp(env, session, origin) {
  if (!canIssueWellnessReceipt(session)) return deny();
  return {
    ok: true,
    today: todayStockholm(),
    receipts: await listRecent(env, origin),
    ...orgMeta()
  };
}

export async function issueWellnessReceipt(env, payload, session, origin) {
  if (!canIssueWellnessReceipt(session)) return deny();
  payload = payload && typeof payload === "object" ? payload : {};
  const pw = await verifySessionPassword(env, session, payload.password);
  if (!pw.ok) return pw;

  const recipientName = clipText(payload.recipientName || payload.name, 120);
  if (!recipientName) return { ok: false, error: "Ange vem kvittot gäller" };

  const emailRaw = String(payload.recipientEmail || payload.email || "").trim().toLowerCase();
  let recipientEmail = "";
  if (emailRaw) {
    const check = validateEmail(emailRaw);
    if (!check.ok) return { ok: false, error: check.error };
    recipientEmail = check.email;
  }

  const idnr = normalizeIdnr(payload.recipientIdnr || payload.personnummer);
  if (!idnr.ok) return idnr;

  const description = clipText(payload.description || payload.spec, 240);
  if (!description) return { ok: false, error: "Ange vad som har köpts" };

  const period = clipText(payload.period, 80);
  const amount = roundMoney(payload.amount);
  if (!(amount > 0)) return { ok: false, error: "Ange ett belopp större än 0 kr" };
  if (amount > 100000) return { ok: false, error: "Beloppet är orimligt högt" };

  const purchaseDate = ymd(payload.purchaseDate || payload.date, todayStockholm());
  const issuedAt = nowIso();
  const year = purchaseDate.slice(0, 4);
  const id = crypto.randomUUID();
  const receiptNo = await nextReceiptNo(env, year);
  const issuerName = clipText((pw.user && pw.user.name) || session.username, 120) || session.username;

  await env.DB.prepare(
    `INSERT INTO wellness_receipts (
      id, receipt_no, issued_at, purchase_date, recipient_name, recipient_email, recipient_idnr,
      description, period, amount, issuer_username, issuer_name, signed_at, pdf_key, emailed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '')`
  ).bind(
    id,
    receiptNo,
    issuedAt,
    purchaseDate,
    recipientName,
    recipientEmail,
    idnr.value,
    description,
    period,
    amount,
    session.username,
    issuerName,
    issuedAt
  ).run();

  const row = await getRow(env, id);
  return { ok: true, receipt: mapRow(row, env, origin) };
}

export async function saveWellnessReceiptPdf(env, payload, session, origin) {
  if (!canIssueWellnessReceipt(session)) return deny();
  payload = payload && typeof payload === "object" ? payload : {};
  const row = await getRow(env, payload.id);
  if (!row) return { ok: false, error: "Kvittot hittades inte" };

  const pdfRaw = String(payload.pdfBase64 || "");
  if (!pdfRaw) return { ok: false, error: "PDF saknas" };
  if (pdfRaw.length > MAX_PDF_BASE64_CHARS) {
    return { ok: false, error: "PDF:en är för stor" };
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
  if (bytes.length > 2e6) {
    return { ok: false, error: "PDF:en är för stor" };
  }

  const key = "friskvard/" + row.id + ".pdf";
  await env.BILDER.put(key, bytes, {
    httpMetadata: { contentType: "application/pdf" },
    customMetadata: {
      username: String(session.username || ""),
      receipt: String(row.receipt_no || "")
    }
  });
  await env.DB.prepare("UPDATE wellness_receipts SET pdf_key = ? WHERE id = ?").bind(key, row.id).run();
  const next = await getRow(env, row.id);
  return { ok: true, receipt: mapRow(next, env, origin) };
}

export async function emailWellnessReceipt(env, payload, session, origin) {
  if (!canIssueWellnessReceipt(session)) return deny();
  payload = payload && typeof payload === "object" ? payload : {};
  const row = await getRow(env, payload.id);
  if (!row) return { ok: false, error: "Kvittot hittades inte" };
  if (!row.pdf_key) return { ok: false, error: "PDF saknas — signera kvittot igen" };

  let to = String(payload.email || row.recipient_email || "").trim().toLowerCase();
  const check = validateEmail(to);
  if (!check.ok) return { ok: false, error: "Ange en giltig e-postadress" };
  to = check.email;

  const obj = await env.BILDER.get(row.pdf_key);
  if (!obj) return { ok: false, error: "PDF:en saknas i lagringen" };
  const bytes = new Uint8Array(await obj.arrayBuffer());
  const mapped = mapRow(row, env, origin);
  mapped.recipientEmail = to;
  mapped.downloadUrl = appWellnessUrl(env, row.pdf_key, origin);

  try {
    await mailWellnessReceipt(env, {
      to,
      name: row.recipient_name,
      filename: mapped.filename,
      pdfBytes: bytes,
      downloadUrl: mapped.downloadUrl,
      meta: mapped
    });
  } catch (err) {
    return {
      ok: false,
      error: "Kunde inte skicka mejlet: " + String(err && err.message ? err.message : err),
      receipt: mapped
    };
  }

  const emailedAt = nowIso();
  await env.DB.prepare(
    "UPDATE wellness_receipts SET recipient_email = ?, emailed_at = ? WHERE id = ?"
  ).bind(to, emailedAt, row.id).run();
  const next = await getRow(env, row.id);
  return { ok: true, receipt: mapRow(next, env, origin) };
}

export async function serveWellnessPdf(env, idOrKey) {
  let key = decodeURIComponent(String(idOrKey || "").trim()).replace(/^\/+/, "");
  if (!key.startsWith("friskvard/")) key = "friskvard/" + key;
  if (!key.toLowerCase().endsWith(".pdf")) key += ".pdf";
  if (!isWellnessPdfKey(key)) return null;
  const obj = await env.BILDER.get(key);
  if (!obj) return null;
  const headers = new Headers();
  headers.set("Content-Type", "application/pdf");
  headers.set("Content-Disposition", 'inline; filename="friskvardskvitto.pdf"');
  headers.set("Cache-Control", "private, max-age=86400");
  return new Response(obj.body, { headers });
}
