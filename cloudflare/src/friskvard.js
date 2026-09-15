/** Friskvårdskvitto: utfärda, lagra PDF, mejla. */

import { canIssueWellnessReceipt, hashPassword, isSuperadminRole, roleOf, validateEmail } from "./auth.js";
import { findUser, getSetting, setSetting, todayStockholm } from "./db.js";
import { roundMoney } from "./time.js";
import { mailWellnessReceipt } from "./mail.js";

export const WELLNESS_ORG_NAME = "Västerviks klätterklubb";
export const WELLNESS_ORG_NR = "802431-5718";
export const WELLNESS_ORG_ADDRESS = "Klätterhallen, Västervik";
export const WELLNESS_ORG_LEGAL =
  "Ideell förening som inte är momsregistrerad";
export const WELLNESS_ORG_VAT =
  "Moms utgår inte. Beloppet avser 0 kr moms.";
export const DEFAULT_RETENTION_DAYS = 90;
export const MIN_RETENTION_DAYS = 14;
export const MAX_RETENTION_DAYS = 730;
export const MAX_PDF_BASE64_CHARS = 9000000;

export const WELLNESS_SETTING_KEYS = {
  name: "wellnessOrgName",
  orgNr: "wellnessOrgNr",
  street: "wellnessOrgStreet",
  postal: "wellnessOrgPostal",
  city: "wellnessOrgCity",
  legal: "wellnessOrgLegal",
  vat: "wellnessOrgVat",
  retentionDays: "wellnessRetentionDays"
};

export function canManageWellnessSettings(session) {
  return isSuperadminRole(roleOf(session));
}

export function normalizeRetentionDays(raw) {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return DEFAULT_RETENTION_DAYS;
  if (n < MIN_RETENTION_DAYS) return MIN_RETENTION_DAYS;
  if (n > MAX_RETENTION_DAYS) return MAX_RETENTION_DAYS;
  return n;
}

function formatOrgAddress(street, postal, city) {
  const line2 = [clipText(postal, 20), clipText(city, 80)].filter(Boolean).join(" ");
  return [clipText(street, 120), line2].filter(Boolean).join(", ");
}

export async function readOrgProfile(env) {
  const orgName = clipText(await getSetting(env, WELLNESS_SETTING_KEYS.name, WELLNESS_ORG_NAME), 120) || WELLNESS_ORG_NAME;
  const orgNr = clipText(await getSetting(env, WELLNESS_SETTING_KEYS.orgNr, WELLNESS_ORG_NR), 20) || WELLNESS_ORG_NR;
  const orgStreet = clipText(await getSetting(env, WELLNESS_SETTING_KEYS.street, ""), 120);
  const orgPostal = clipText(await getSetting(env, WELLNESS_SETTING_KEYS.postal, ""), 20);
  const orgCity = clipText(await getSetting(env, WELLNESS_SETTING_KEYS.city, ""), 80);
  const orgLegal = clipText(await getSetting(env, WELLNESS_SETTING_KEYS.legal, WELLNESS_ORG_LEGAL), 200) || WELLNESS_ORG_LEGAL;
  const orgVat = clipText(await getSetting(env, WELLNESS_SETTING_KEYS.vat, WELLNESS_ORG_VAT), 200) || WELLNESS_ORG_VAT;
  const retentionDays = normalizeRetentionDays(
    await getSetting(env, WELLNESS_SETTING_KEYS.retentionDays, String(DEFAULT_RETENTION_DAYS))
  );
  return {
    orgName,
    orgNr,
    orgStreet,
    orgPostal,
    orgCity,
    orgAddress: formatOrgAddress(orgStreet, orgPostal, orgCity) || WELLNESS_ORG_ADDRESS,
    orgLegal,
    orgVat,
    retentionDays
  };
}

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

function mapRow(row, env, origin, org) {
  if (!row) return null;
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
    hasPdf: false,
    emailedAt: row.emailed_at || "",
    filename: "friskvardskvitto-" + String(row.receipt_no || "").replace(/\s+/g, "") + ".pdf",
    ...(org || {})
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

async function listRecent(env, origin, org) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM wellness_receipts ORDER BY issued_at DESC LIMIT 80"
  ).all();
  return (results || []).map((row) => mapRow(row, env, origin, org));
}

export async function purgeExpiredWellnessReceipts(env) {
  const org = await readOrgProfile(env);
  const cutoff = new Date(Date.now() - org.retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const del = await env.DB.prepare("DELETE FROM wellness_receipts WHERE issued_at < ?").bind(cutoff).run();
  const deleted = Number((del && del.meta && del.meta.changes) || 0);
  return { ok: true, deleted, cutoff, retentionDays: org.retentionDays };
}

export async function getWellnessApp(env, session, origin) {
  if (!canIssueWellnessReceipt(session)) return deny();
  try {
    await purgeExpiredWellnessReceipts(env);
  } catch (_) { /* rensning får inte blockera utfärdandet */ }
  const org = await readOrgProfile(env);
  return {
    ok: true,
    today: todayStockholm(),
    receipts: await listRecent(env, origin, org),
    canManage: canManageWellnessSettings(session),
    ...org
  };
}

export async function getWellnessReceipt(env, payload, session, origin) {
  if (!canIssueWellnessReceipt(session)) return deny();
  const org = await readOrgProfile(env);
  const row = await getRow(env, payload && (payload.id || payload.receiptId));
  if (!row) return { ok: false, error: "Kvittot hittades inte" };
  return { ok: true, receipt: mapRow(row, env, origin, org) };
}

export async function getWellnessSettings(env, session) {
  if (!canManageWellnessSettings(session)) {
    return { ok: false, error: "Bara superadmin kan ändra föreningsuppgifter" };
  }
  const org = await readOrgProfile(env);
  return { ok: true, ...org };
}

export async function saveWellnessSettings(env, payload, session) {
  if (!canManageWellnessSettings(session)) {
    return { ok: false, error: "Bara superadmin kan ändra föreningsuppgifter" };
  }
  payload = payload && typeof payload === "object" ? payload : {};
  const orgName = clipText(payload.orgName || payload.name, 120);
  const orgNr = clipText(payload.orgNr, 20);
  if (!orgName) return { ok: false, error: "Ange föreningens namn" };
  if (!orgNr) return { ok: false, error: "Ange organisationsnummer" };
  const orgStreet = clipText(payload.orgStreet || payload.street, 120);
  const orgPostal = clipText(payload.orgPostal || payload.postalCode, 20);
  const orgCity = clipText(payload.orgCity || payload.city, 80);
  const orgLegal = clipText(payload.orgLegal || payload.legal, 200) || WELLNESS_ORG_LEGAL;
  const orgVat = clipText(payload.orgVat || payload.vat, 200) || WELLNESS_ORG_VAT;
  const retentionDays = normalizeRetentionDays(payload.retentionDays);
  await setSetting(env, WELLNESS_SETTING_KEYS.name, orgName);
  await setSetting(env, WELLNESS_SETTING_KEYS.orgNr, orgNr);
  await setSetting(env, WELLNESS_SETTING_KEYS.street, orgStreet);
  await setSetting(env, WELLNESS_SETTING_KEYS.postal, orgPostal);
  await setSetting(env, WELLNESS_SETTING_KEYS.city, orgCity);
  await setSetting(env, WELLNESS_SETTING_KEYS.legal, orgLegal);
  await setSetting(env, WELLNESS_SETTING_KEYS.vat, orgVat);
  await setSetting(env, WELLNESS_SETTING_KEYS.retentionDays, String(retentionDays));
  return { ok: true, ...(await readOrgProfile(env)) };
}

export async function issueWellnessReceipt(env, payload, session, origin) {
  if (!canIssueWellnessReceipt(session)) return deny();
  payload = payload && typeof payload === "object" ? payload : {};
  const pw = await verifySessionPassword(env, session, payload.password);
  if (!pw.ok) return pw;
  const org = await readOrgProfile(env);

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
  return { ok: true, receipt: mapRow(row, env, origin, org) };
}

export async function emailWellnessReceipt(env, payload, session, origin) {
  if (!canIssueWellnessReceipt(session)) return deny();
  payload = payload && typeof payload === "object" ? payload : {};
  const row = await getRow(env, payload.id);
  if (!row) return { ok: false, error: "Kvittot hittades inte" };

  let to = String(payload.email || row.recipient_email || "").trim().toLowerCase();
  const check = validateEmail(to);
  if (!check.ok) return { ok: false, error: "Ange en giltig e-postadress" };
  to = check.email;

  const pdfRaw = String(payload.pdfBase64 || "");
  if (!pdfRaw) return { ok: false, error: "PDF saknas — öppna kvittot igen och skicka" };
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

  const org = await readOrgProfile(env);
  const mapped = mapRow(row, env, origin, org);
  mapped.recipientEmail = to;

  try {
    await mailWellnessReceipt(env, {
      to,
      name: row.recipient_name,
      filename: mapped.filename,
      pdfBase64: pdfRaw,
      pdfBytes: bytes,
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
  return { ok: true, receipt: mapRow(next, env, origin, org) };
}
