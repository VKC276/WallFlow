/** Utlägg och verifikationer: inställningar, PDF-lagring, mejl. */

import { findUser, getSetting, readUsers, setSetting, todayStockholm } from "./db.js";
import { hasRole, isSuperadminRole, isUserActive, roleOf, validateEmail } from "./auth.js";
import { roundMoney } from "./time.js";
import { mailUnderlagNotice, mailUnderlagRejected, mailUnderlagToArchive, underlagReviewUrl } from "./mail.js";

export const VERIF_ARCHIVE_EMAIL_KEY = "verifArchiveEmail";
export const VERIF_RETENTION_DAYS_KEY = "verifRetentionDays";
export const DEFAULT_VERIF_ARCHIVE_EMAIL = "inbox.ver.1624638@arkivplats.se";
export const DEFAULT_VERIF_RETENTION_DAYS = 90;
export const MAX_VERIF_RETENTION_DAYS = 730;
export const VERIF_ORG_NAME = "Västerviks klätterklubb";
export const VERIF_ORG_NR = "802431-5718";
export const MAX_PDF_BASE64_CHARS = 9000000;

export function canUseVerifTool(session) {
  return !!(session && session.username);
}

export function canManageVerifSettings(session) {
  return isSuperadminRole(roleOf(session));
}

export function canReviewVerif(session) {
  return isSuperadminRole(roleOf(session)) || hasRole(session, "kassor");
}

export function isVerifPdfKey(key) {
  return /^verif\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/i.test(
    String(key || "").trim()
  );
}

async function listKassorRecipients(env) {
  const users = await readUsers(env);
  const out = [];
  const seen = new Set();
  for (const u of users) {
    if (!isUserActive(u) || !hasRole(u, "kassor")) continue;
    const check = validateEmail(u.email);
    if (!check.ok || seen.has(check.email)) continue;
    seen.add(check.email);
    out.push({
      email: check.email,
      name: String(u.name || u.username || "Kassör").trim() || "Kassör"
    });
  }
  return out;
}

export async function readVerifArchiveEmail(env) {
  const raw = await getSetting(env, VERIF_ARCHIVE_EMAIL_KEY, DEFAULT_VERIF_ARCHIVE_EMAIL);
  const check = validateEmail(raw);
  return check.ok ? check.email : DEFAULT_VERIF_ARCHIVE_EMAIL;
}

export function normalizeVerifRetentionDays(raw) {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n < 0) return DEFAULT_VERIF_RETENTION_DAYS;
  if (n === 0) return 0;
  if (n > MAX_VERIF_RETENTION_DAYS) return MAX_VERIF_RETENTION_DAYS;
  return n;
}

export async function readVerifRetentionDays(env) {
  const raw = await getSetting(env, VERIF_RETENTION_DAYS_KEY, String(DEFAULT_VERIF_RETENTION_DAYS));
  return normalizeVerifRetentionDays(raw);
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
    retentionDays: await readVerifRetentionDays(env),
    orgName: VERIF_ORG_NAME,
    orgNr: VERIF_ORG_NR,
    today: todayStockholm(),
    canManage: canManageVerifSettings(session)
  };
}

export async function saveVerifSettingsAction(env, payload, session) {
  if (!canManageVerifSettings(session)) {
    return { ok: false, error: "Bara superadmin kan ändra bokföringsinställningarna" };
  }
  const emailRes = await saveVerifArchiveEmail(env, payload && payload.archiveEmail);
  if (!emailRes.ok) return emailRes;
  const retentionDays = normalizeVerifRetentionDays(
    payload && payload.retentionDays != null ? payload.retentionDays : DEFAULT_VERIF_RETENTION_DAYS
  );
  await setSetting(env, VERIF_RETENTION_DAYS_KEY, String(retentionDays));
  return { ok: true, archiveEmail: emailRes.archiveEmail, retentionDays };
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

  const memberName = clubCard
    ? purchaser
    : ([firstName, lastName].filter(Boolean).join(" ") || purchaser);
  const memberAddress = clubCard ? "" : [address, postalCode, city].filter(Boolean).join(", ");
  try {
    await insertVerifUnderlag(env, {
      id,
      kind: clubCard ? "club-card" : "payout",
      pdfKey: key,
      filename,
      createdAt: new Date().toISOString(),
      purchaseDate,
      memberName,
      memberAddress,
      purchaser: clubCard ? purchaser : memberName,
      bank: clubCard ? "" : bank,
      clearing: clubCard ? "" : clearing,
      account: clubCard ? "" : account,
      submitterUsername: String((session && session.username) || ""),
      submitterName: (user && (user.name || user.username)) || "",
      total
    });
  } catch (err) {
    return {
      ok: false,
      error: "PDF sparad men underlaget kunde inte läggas i granskningskön: " + String(err && err.message ? err.message : err),
      downloadUrl,
      filename
    };
  }

  let notifiedKassor = 0;
  try {
    const recipients = await listKassorRecipients(env);
    if (!recipients.length) {
      return {
        ok: false,
        error: "Underlaget är sparat, men ingen aktiv kassör med e-post kunde notifieras.",
        downloadUrl,
        filename
      };
    }
    await mailUnderlagNotice(env, {
      recipients,
      reviewUrl: underlagReviewUrl(env, id),
      submitterName: (user && (user.name || user.username)) || "",
      meta
    });
    notifiedKassor = recipients.length;
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
    filename,
    notifiedKassor
  };
}

async function insertVerifUnderlag(env, row) {
  await env.DB.prepare(
    `INSERT INTO verif_underlag (
      id, kind, pdf_key, filename, created_at, purchase_date, member_name, member_address,
      purchaser, bank, clearing, account, submitter_username, submitter_name, total, status, reviewed_at, reviewed_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', '', '')`
  ).bind(
    row.id,
    row.kind,
    row.pdfKey,
    row.filename,
    row.createdAt,
    row.purchaseDate,
    row.memberName,
    row.memberAddress || "",
    row.purchaser || "",
    row.bank || "",
    row.clearing || "",
    row.account || "",
    row.submitterUsername || "",
    row.submitterName || "",
    row.total
  ).run();
}

function mapVerifUnderlag(env, row, origin) {
  return {
    id: row.id,
    kind: row.kind === "club-card" ? "club-card" : "payout",
    filename: row.filename,
    createdAt: row.created_at || "",
    purchaseDate: row.purchase_date || "",
    memberName: row.member_name || "",
    memberAddress: row.member_address || "",
    purchaser: row.purchaser || "",
    bank: row.bank || "",
    clearing: row.clearing || "",
    account: row.account || "",
    submitterName: row.submitter_name || "",
    total: Number(row.total) || 0,
    status: row.status === "sent" ? "sent" : "pending",
    reviewedAt: row.reviewed_at || "",
    reviewedBy: row.reviewed_by || "",
    downloadUrl: appVerifUrl(env, row.pdf_key, origin)
  };
}

async function deleteVerifPdfKey(env, key) {
  const k = String(key || "").trim();
  if (!isVerifPdfKey(k)) return;
  try {
    await env.BILDER.delete(k);
  } catch (_) { /* rensning av PDF får inte blockera */ }
}

export async function purgeExpiredVerifUnderlag(env) {
  const retentionDays = await readVerifRetentionDays(env);
  if (!retentionDays) return { ok: true, deleted: 0, retentionDays: 0 };
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT id, pdf_key FROM verif_underlag
     WHERE status = 'sent'
       AND COALESCE(NULLIF(reviewed_at, ''), created_at) < ?`
  ).bind(cutoff).all();
  const rows = results || [];
  for (const row of rows) {
    await deleteVerifPdfKey(env, row.pdf_key);
    await env.DB.prepare("DELETE FROM verif_underlag WHERE id = ?").bind(row.id).run();
  }
  return { ok: true, deleted: rows.length, cutoff, retentionDays };
}

export async function listVerifUnderlag(env, session, origin) {
  if (!canReviewVerif(session)) return { ok: false, error: "Bara kassör kan granska underlag" };
  try {
    await purgeExpiredVerifUnderlag(env);
  } catch (_) { /* autorensning får inte blockera listan */ }
  const archiveEmail = await readVerifArchiveEmail(env);
  const retentionDays = await readVerifRetentionDays(env);
  try {
    const res = await env.DB.prepare(
      "SELECT * FROM verif_underlag ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC LIMIT 200"
    ).all();
    return {
      ok: true,
      archiveEmail,
      retentionDays,
      items: (res.results || []).map((row) => mapVerifUnderlag(env, row, origin))
    };
  } catch (err) {
    return { ok: false, error: "Kunde inte hämta underlag: " + String(err && err.message ? err.message : err) };
  }
}

export async function deleteVerifUnderlag(env, idOrPayload, session) {
  if (!canReviewVerif(session)) return { ok: false, error: "Bara kassör kan rensa underlag" };
  const id = String(typeof idOrPayload === "string" ? idOrPayload : (idOrPayload && idOrPayload.id) || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "Underlaget hittades inte" };
  const row = await env.DB.prepare("SELECT * FROM verif_underlag WHERE id = ?").bind(id).first();
  if (!row) return { ok: false, error: "Underlaget hittades inte" };
  if (row.status !== "sent") {
    return { ok: false, error: "Bara skickade underlag kan rensas. Väntande underlag ska granskas först." };
  }
  await deleteVerifPdfKey(env, row.pdf_key);
  await env.DB.prepare("DELETE FROM verif_underlag WHERE id = ?").bind(id).run();
  return { ok: true, id };
}

export async function clearSentVerifUnderlag(env, session) {
  if (!canReviewVerif(session)) return { ok: false, error: "Bara kassör kan rensa underlag" };
  const { results } = await env.DB.prepare(
    "SELECT id, pdf_key FROM verif_underlag WHERE status = 'sent'"
  ).all();
  const rows = results || [];
  for (const row of rows) {
    await deleteVerifPdfKey(env, row.pdf_key);
    await env.DB.prepare("DELETE FROM verif_underlag WHERE id = ?").bind(row.id).run();
  }
  return { ok: true, deleted: rows.length };
}

export async function rejectVerifUnderlag(env, idOrPayload, session, user) {
  if (!canReviewVerif(session)) return { ok: false, error: "Bara kassör kan avslå underlag" };
  const payload = typeof idOrPayload === "string" ? { id: idOrPayload } : (idOrPayload || {});
  const id = String(payload.id || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "Underlaget hittades inte" };
  const reason = String(payload.reason || "").replace(/\s+/g, " ").trim().slice(0, 500);
  const row = await env.DB.prepare("SELECT * FROM verif_underlag WHERE id = ?").bind(id).first();
  if (!row) return { ok: false, error: "Underlaget hittades inte" };
  if (row.status !== "pending") {
    return { ok: false, error: "Bara underlag som väntar på granskning kan avslås" };
  }
  const submitter = await findUser(env, row.submitter_username);
  const to = String((submitter && submitter.email) || "").trim().toLowerCase();
  const mailCheck = validateEmail(to);
  const reviewerName = (user && (user.name || user.username)) || (session && session.username) || "Kassör";
  if (mailCheck.ok) {
    try {
      await mailUnderlagRejected(env, {
        to: mailCheck.email,
        name: (submitter && (submitter.name || submitter.username)) || row.submitter_name || "",
        reason,
        reviewerName,
        meta: {
          clubCard: row.kind === "club-card",
          memberName: row.member_name,
          purchaseDate: row.purchase_date,
          total: row.total
        }
      });
    } catch (err) {
      return {
        ok: false,
        error: "Kunde inte meddela den som skickade in: " + String(err && err.message ? err.message : err)
      };
    }
  }
  await deleteVerifPdfKey(env, row.pdf_key);
  await env.DB.prepare("DELETE FROM verif_underlag WHERE id = ? AND status = 'pending'").bind(id).run();
  return { ok: true, id, rejected: true, notified: mailCheck.ok };
}

export async function sendVerifUnderlag(env, idOrPayload, session, user) {
  if (!canReviewVerif(session)) return { ok: false, error: "Bara kassör kan granska underlag" };
  const id = String(typeof idOrPayload === "string" ? idOrPayload : (idOrPayload && idOrPayload.id) || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "Underlaget hittades inte" };
  const row = await env.DB.prepare("SELECT * FROM verif_underlag WHERE id = ?").bind(id).first();
  if (!row) return { ok: false, error: "Underlaget hittades inte" };
  if (row.status === "sent") return { ok: false, error: "Underlaget är redan skickat till bokföringen" };
  if (row.status !== "pending") return { ok: false, error: "Underlaget kan inte skickas" };
  const obj = await env.BILDER.get(row.pdf_key);
  if (!obj) return { ok: false, error: "PDF:en saknas" };
  const bytes = new Uint8Array(await obj.arrayBuffer());
  const archiveEmail = await readVerifArchiveEmail(env);
  const reviewerName = (user && (user.name || user.username)) || (session && session.username) || "Kassör";
  try {
    await mailUnderlagToArchive(env, {
      to: archiveEmail,
      filename: row.filename,
      pdfBytes: bytes,
      reviewerName,
      meta: {
        clubCard: row.kind === "club-card",
        memberName: row.member_name,
        purchaseDate: row.purchase_date,
        total: row.total
      }
    });
  } catch (err) {
    return {
      ok: false,
      error: "Kunde inte skicka till bokföringsinkorgen: " + String(err && err.message ? err.message : err)
    };
  }
  const reviewedAt = new Date().toISOString();
  await env.DB.prepare(
    "UPDATE verif_underlag SET status = 'sent', reviewed_at = ?, reviewed_by = ? WHERE id = ? AND status = 'pending'"
  ).bind(reviewedAt, String((session && session.username) || ""), id).run();
  return { ok: true, id, status: "sent", reviewedAt };
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
