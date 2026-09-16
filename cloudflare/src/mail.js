/**
 * Mejl via samma GAS-relay som RentR (ClimbLink).
 * POST { action: 'relayMail', secret, messages: [{ to, subject, body, html, attachments? }] }
 */

const APP_NAME = "WallFlow";
const DEFAULT_APP_BASE = "https://wallflow.vastervikclimbing.se";

export function appBaseUrl(env) {
  const raw = String((env && env.APP_BASE_URL) || DEFAULT_APP_BASE).trim();
  return raw.replace(/\/+$/, "") || DEFAULT_APP_BASE;
}

export function loginUrl(env) {
  return appBaseUrl(env) + "/";
}

export function resetPasswordUrl(env, token) {
  return appBaseUrl(env) + "/#reset=" + encodeURIComponent(token);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function compose(opts) {
  const greeting = "Hej " + String(opts.name || "") + ",";
  const signoff = "Vänliga hälsningar\nVästerviks klätterklubb";
  const rows = opts.rows || [];
  const textLines = [greeting, "", opts.intro || ""];
  if (rows.length) {
    textLines.push("");
    for (const row of rows) textLines.push(row.label + ": " + row.value);
  }
  const personal = String(opts.message || "").trim();
  if (personal) {
    textLines.push("", personal);
  }
  if (opts.notes && opts.notes.length) {
    textLines.push("");
    for (const n of opts.notes) textLines.push(n);
  }
  if (opts.ctaUrl) {
    textLines.push("", (opts.ctaLabel || "Länk") + ":", opts.ctaUrl);
  }
  textLines.push("", signoff);

  const rowHtml = rows
    .map(
      (row) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#5a6f7a;vertical-align:top;white-space:nowrap;">${escapeHtml(row.label)}</td>` +
        `<td style="padding:6px 0;color:#1a2b33;"><strong>${escapeHtml(row.value)}</strong></td></tr>`
    )
    .join("");

  const notesHtml = (opts.notes || [])
    .map((n) => `<p style="margin:8px 0 0;color:#5a6f7a;font-size:14px;">${escapeHtml(n)}</p>`)
    .join("");

  const ctaHtml = opts.ctaUrl
    ? `<p style="margin:24px 0 0;"><a href="${escapeHtml(opts.ctaUrl)}" style="display:inline-block;background:#0d6e6e;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:600;">${escapeHtml(opts.ctaLabel || "Öppna")}</a></p>
       <p style="margin:10px 0 0;color:#5a6f7a;font-size:12px;word-break:break-all;">${escapeHtml(opts.ctaUrl)}</p>`
    : "";

  const html =
    `<div style="font-family:Segoe UI,Helvetica Neue,Arial,sans-serif;font-size:16px;line-height:1.45;color:#1a2b33;max-width:560px;margin:0 auto;padding:8px;">` +
    `<p style="margin:0 0 4px;font-size:13px;letter-spacing:0.04em;text-transform:uppercase;color:#0d6e6e;font-weight:700;">${escapeHtml(APP_NAME)}</p>` +
    `<p style="margin:0 0 8px;">${escapeHtml(greeting)}</p>` +
    `<p style="margin:0 0 16px;">${escapeHtml(opts.intro || "")}</p>` +
    (personal
      ? `<p style="margin:0 0 16px;padding:12px 14px;background:#f4f8f8;border-radius:12px;white-space:pre-line;">${escapeHtml(personal)}</p>`
      : "") +
    (rows.length
      ? `<table style="border-collapse:collapse;width:100%;margin:0 0 8px;background:#f4f8f8;border-radius:12px;overflow:hidden;"><tbody>${rowHtml}</tbody></table>`
      : "") +
    notesHtml +
    ctaHtml +
    `<p style="margin:28px 0 0;color:#5a6f7a;font-size:14px;white-space:pre-line;">${escapeHtml(signoff)}</p>` +
    `</div>`;

  return {
    subject: APP_NAME + " – " + opts.subject,
    body: textLines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n"),
    html
  };
}

/**
 * Apps Script web apps run doPost on the first /exec hit, then 302 to
 * script.googleusercontent.com which only serves the result via GET.
 */
async function postMailWebhook(url, payload) {
  const body = JSON.stringify(payload);
  const postHeaders = {
    "Content-Type": "text/plain;charset=utf-8",
    "Content-Length": String(new TextEncoder().encode(body).byteLength)
  };

  let res = await fetch(url, {
    method: "POST",
    headers: postHeaders,
    body,
    redirect: "manual"
  });

  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("Location");
    if (!loc) {
      throw new Error("Mail-webhook redirect utan Location (" + res.status + ")");
    }
    res = await fetch(loc, { method: "GET", redirect: "follow" });
  }

  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    const snippet = text
      ? text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180)
      : "";
    throw new Error("Mail-webhook HTTP " + res.status + (snippet ? ": " + snippet : ""));
  }
  if (parsed && parsed.error) {
    throw new Error("Mail-webhook: " + parsed.error);
  }
  if (parsed && parsed.sent === 0) {
    throw new Error("Mail-webhook: inget mejl skickades");
  }
  if (parsed && Array.isArray(parsed.errors) && parsed.errors.length) {
    throw new Error("Mail-webhook send errors: " + parsed.errors.join("; "));
  }
  return parsed;
}

export async function sendMessages(env, messages) {
  const url = env.MAIL_WEBHOOK_URL;
  if (!url) {
    throw new Error("MAIL_WEBHOOK_URL saknas — samma secret/URL som RentR");
  }
  const out = (messages || []).filter((m) => m && String(m.to || "").trim());
  if (!out.length) return { ok: true, sent: 0 };

  await postMailWebhook(url, {
    action: "relayMail",
    secret: env.MAIL_WEBHOOK_SECRET || "",
    messages: out
  });
  return { ok: true, sent: out.length };
}

function toMessage(to, composed, attachments) {
  const msg = { to, subject: composed.subject, body: composed.body, html: composed.html };
  if (attachments && attachments.length) msg.attachments = attachments;
  return msg;
}

function bytesToBase64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let binary = "";
  const chunk = 0x2000;
  for (let i = 0; i < u8.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

function formatSekSv(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "0 kr";
  return new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) + " kr";
}

export async function mailVerification(env, opts) {
  const meta = opts.meta || {};
  const clubCard = !!meta.clubCard;
  const archiveEmail = String(opts.archiveEmail || "").trim();
  const kindLabel = clubCard
    ? "Klubbkort — ingen utbetalning"
    : "Utlägg — utbetalning till medlem";
  const composed = compose({
    name: opts.name,
    subject: clubCard ? "verifikation (klubbkort)" : "utlägg att betala ut",
    intro: clubCard
      ? "Här är din sammanslagna PDF med försättsblad och kvitton. Det är en verifikation på ett köp som redan betalats med klubbens kort — inga pengar ska gå ut till medlemmen."
      : "Här är din sammanslagna PDF med utläggsblankett och kvitton. Pengar ska betalas ut till medlemmen enligt uppgifterna på försättsbladet.",
    rows: [
      { label: "Typ", value: kindLabel },
      { label: "Datum", value: String(meta.purchaseDate || "") },
      { label: "Belopp", value: formatSekSv(meta.total) },
      { label: "Bokföringsinkorg", value: archiveEmail }
    ],
    notes: [
      "PDF:en ligger bifogad i det här mejlet.",
      "Skicka samma PDF vidare till " + archiveEmail + " för hantering i bokföringen."
    ],
    ctaLabel: "Öppna PDF",
    ctaUrl: opts.downloadUrl
  });
  const attachments = [];
  if (opts.pdfBytes && opts.filename) {
    attachments.push({
      filename: String(opts.filename),
      name: String(opts.filename),
      mimeType: "application/pdf",
      type: "application/pdf",
      content: bytesToBase64(opts.pdfBytes)
    });
  }
  await sendMessages(env, [toMessage(opts.to, composed, attachments)]);
}

export async function mailWellnessReceipt(env, opts) {
  const meta = opts.meta || {};
  const composed = compose({
    name: opts.name,
    subject: "friskvårdskvitto " + String(meta.receiptNo || ""),
    intro:
      "Här är ditt kvitto för friskvård från Västerviks klätterklubb. Kvittot kan lämnas till arbetsgivaren som underlag för friskvårdsbidrag. Ersättning för medlemskap omfattas inte enligt Skatteverkets regler.",
    rows: [
      { label: "Kvitto nr", value: String(meta.receiptNo || "") },
      { label: "Vad", value: String(meta.description || "") },
      { label: "Belopp", value: formatSekSv(meta.amount) },
      { label: "Moms", value: "0,00 kr (ideell förening, inte momsregistrerad)" },
      { label: "Köpdatum", value: String(meta.purchaseDate || "") }
    ],
    notes: [
      "PDF:en ligger bifogad i det här mejlet.",
      "Föreningen är en ideell förening som inte betalar moms.",
      "Ersättning för medlemskap omfattas inte enligt Skatteverkets regler."
    ]
  });
  const attachments = [];
  const b64 = String(opts.pdfBase64 || "").replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "")
    || (opts.pdfBytes ? bytesToBase64(opts.pdfBytes) : "");
  if (b64 && opts.filename) {
    attachments.push({
      filename: String(opts.filename),
      name: String(opts.filename),
      mimeType: "application/pdf",
      type: "application/pdf",
      content: b64
    });
  }
  await sendMessages(env, [toMessage(opts.to, composed, attachments)]);
}

export function clipInviteMessage(raw) {
  const next = String(raw == null ? "" : raw).replace(/\r\n/g, "\n").trim();
  if (!next) return "";
  if (next.length > 500) return next.slice(0, 500).trim();
  return next;
}

export async function mailWelcome(env, user, password, message) {
  const url = loginUrl(env);
  const composed = compose({
    name: user.name || user.username,
    subject: "ditt konto är skapat",
    intro: "Ett WallFlow-konto har skapats åt dig. Logga in med användarnamn eller e-post och det tillfälliga lösenordet, byt sedan lösenord vid första inloggningen.",
    message: clipInviteMessage(message),
    rows: [
      { label: "Användarnamn", value: user.username },
      { label: "E-post", value: user.email },
      { label: "Tillfälligt lösenord", value: String(password || "") }
    ],
    notes: ["Länken tar dig till inloggningen."],
    ctaLabel: "Öppna WallFlow",
    ctaUrl: url
  });
  await sendMessages(env, [toMessage(user.email, composed)]);
}

export async function mailPasswordReset(env, user, token) {
  const url = resetPasswordUrl(env, token);
  const composed = compose({
    name: user.name || user.username,
    subject: "återställ lösenord",
    intro: "Vi har tagit emot en begäran om att återställa ditt lösenord. Länken gäller i två timmar. Om du inte begärt detta kan du ignorera mejlet.",
    rows: [
      { label: "Användarnamn", value: user.username }
    ],
    ctaLabel: "Välj nytt lösenord",
    ctaUrl: url
  });
  await sendMessages(env, [toMessage(user.email, composed)]);
}
