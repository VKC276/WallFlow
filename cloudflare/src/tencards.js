/**
 * 10-kort via kiosk-Workerns admin-API.
 * WallFlow använder bara ADMIN_TOKEN (lägg till, ta bort, redigera, klipp från appen).
 * KIOSK_TOKEN hör hemma på Pi:n och får bara anropa /api/clip — den ska inte in i WallFlow.
 * Webbläsaren ser aldrig token.
 */

import { canManageTencards } from "./auth.js";

export function normalizeCardId(raw) {
  if (raw == null || raw === false) return "";
  let text = String(raw).trim().replace(/\s+/g, "");
  if (!text) return "";
  if (text.endsWith(".0") && /^\d+\.0$/.test(text)) text = text.slice(0, -2);
  const asFloat = Number(text);
  if (Number.isFinite(asFloat) && Number.isInteger(asFloat) && asFloat >= 0) {
    return String(asFloat);
  }
  return text;
}

function kioskBase(env) {
  return String(env.KIOSK_API_URL || "").trim().replace(/\/+$/, "");
}

function adminToken(env) {
  return String(env.ADMIN_TOKEN || env.KIOSK_ADMIN_TOKEN || "").trim();
}

function kioskError(message, http) {
  return { ok: false, error: message, status: http || 0, http: http || 0, data: null, okHttp: false };
}

async function kioskAdminRequest(env, path, options) {
  const token = adminToken(env);
  if (!token) {
    return kioskError("ADMIN_TOKEN saknas på WallFlow-servern. Kör wrangler secret put ADMIN_TOKEN.");
  }
  const method = (options && options.method) || "GET";
  const headers = {
    Authorization: "Bearer " + token,
    "X-Kiosk-Token": token,
    Accept: "application/json"
  };
  let body;
  if (options && options.body != null) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const init = { method, headers };
  if (body != null) init.body = body;
  let res;
  try {
    if (env.KIOSK && typeof env.KIOSK.fetch === "function") {
      res = await env.KIOSK.fetch(new Request("https://kiosk" + path, init));
    } else {
      const base = kioskBase(env);
      if (!base) return kioskError("KIOSK_API_URL saknas på WallFlow-servern");
      res = await fetch(base + path, Object.assign({ redirect: "manual" }, init));
    }
  } catch (err) {
    return kioskError("Kunde inte nå kiosk-API:t: " + String(err && err.message ? err.message : err));
  }
  if (res.status >= 300 && res.status < 400) {
    return kioskError("Kiosk-API:t gjorde redirect (HTTP " + res.status + ")", res.status);
  }
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  if (!data || typeof data !== "object") {
    return kioskError("Kiosk-API:t svarade inte med JSON (HTTP " + res.status + ")", res.status);
  }
  return { http: res.status, data, okHttp: res.ok };
}

function mapCard(card) {
  if (!card) return null;
  return {
    card_id: String(card.card_id || ""),
    kind: String(card.kind || "tencard"),
    name: String(card.name || ""),
    status: String(card.status || ""),
    remaining: card.remaining == null || card.remaining === "" ? null : Number(card.remaining),
    last_clipped_at: card.last_clipped_at || null,
    expires_at: card.expires_at || null
  };
}

function stockholmNow() {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(new Date());
  const get = (t) => (parts.find((p) => p.type === t) || {}).value || "";
  return get("year") + "-" + get("month") + "-" + get("day") + " " + get("hour") + ":" + get("minute") + ":" + get("second");
}

export async function listTencardsAction(env, session) {
  if (!canManageTencards(session)) return { ok: false, error: "Saknar behörighet" };
  const res = await kioskAdminRequest(env, "/api/admin/tencards");
  if (res.error && !res.data) return { ok: false, error: res.error };
  if (!res.okHttp) {
    const err = (res.data && res.data.error) || res.error || "Kunde inte lista 10-kort";
    if (err === "unauthorized") {
      return { ok: false, error: "Fel ADMIN_TOKEN mot kiosk-API:t" };
    }
    return { ok: false, error: err };
  }
  const rows = Array.isArray(res.data.tencards) ? res.data.tencards : null;
  if (!rows) return { ok: false, error: "Kiosk-API:t skickade ingen kortlista" };
  return { ok: true, tencards: rows.map(mapCard) };
}

export async function lookupTencardAction(env, payload, session) {
  if (!canManageTencards(session)) return { ok: false, error: "Saknar behörighet" };
  const cardId = normalizeCardId(payload && (payload.card_id || payload.cardId || payload));
  if (!cardId) return { ok: false, error: "Ange kortnummer" };
  const res = await kioskAdminRequest(env, "/api/admin/lookup/" + encodeURIComponent(cardId));
  if (res.error && !res.data) return { ok: false, error: res.error };
  if (!res.okHttp) {
    const err = (res.data && res.data.error) || "";
    if (err === "unauthorized") return { ok: false, error: "Fel ADMIN_TOKEN mot kiosk-API:t" };
    return { ok: false, error: err || "Kunde inte söka kort" };
  }
  const card = mapCard(res.data.card);
  return {
    ok: true,
    card_id: cardId,
    found: !!card,
    card
  };
}

export async function saveTencardAction(env, payload, session) {
  if (!canManageTencards(session)) return { ok: false, error: "Saknar behörighet" };
  const cardId = normalizeCardId(payload && (payload.card_id || payload.cardId));
  if (!cardId) return { ok: false, error: "Ange kortnummer" };
  const remainingRaw = payload && payload.remaining;
  if (remainingRaw == null || remainingRaw === "") return { ok: false, error: "Ange antal klipp" };
  const remaining = Math.trunc(Number(remainingRaw));
  if (!Number.isFinite(remaining) || remaining < 0 || remaining > 99) {
    return { ok: false, error: "Antal klipp ska vara 0–99" };
  }
  let name = payload.name != null ? String(payload.name) : "";
  if (payload.name == null) {
    const looked = await lookupTencardAction(env, { card_id: cardId }, session);
    if (looked && looked.ok && looked.card && looked.card.kind === "tencard") {
      name = looked.card.name || "";
    }
  }
  const body = {
    card_id: cardId,
    remaining,
    name,
    status: payload.status != null ? String(payload.status) : undefined
  };
  if (payload.last_clipped_at != null) body.last_clipped_at = String(payload.last_clipped_at);
  const res = await kioskAdminRequest(env, "/api/admin/tencards", { method: "POST", body });
  if (res.error && !res.data) return { ok: false, error: res.error };
  if (!res.okHttp) {
    const err = (res.data && res.data.error) || "";
    if (err === "unauthorized") return { ok: false, error: "Fel ADMIN_TOKEN mot kiosk-API:t" };
    if (err === "card_id is not a 10-kort") {
      return { ok: false, error: "Kortnumret tillhör ett medlemskort och kan inte bli 10-kort" };
    }
    return { ok: false, error: err || "Kunde inte spara 10-kort (HTTP " + (res.http || "?") + ")" };
  }
  return { ok: true, card_id: cardId, card: mapCard(res.data.card) };
}

async function clipViaSave(env, cardId, session) {
  const looked = await lookupTencardAction(env, { card_id: cardId }, session);
  if (!looked.ok) return looked;
  const card = looked.card;
  if (!card) return { ok: false, error: "Kortet finns inte" };
  if (card.kind && card.kind !== "tencard") {
    return { ok: false, error: "Detta är inte ett 10-kort" };
  }
  const remaining = Number(card.remaining);
  if (!(remaining > 0)) return { ok: false, error: "Inga klipp kvar", card };
  const saved = await saveTencardAction(env, {
    card_id: cardId,
    remaining: remaining - 1,
    name: card.name || "",
    last_clipped_at: stockholmNow()
  }, session);
  if (!saved.ok) return saved;
  const next = saved.card || { ...card, remaining: remaining - 1 };
  return { ok: true, card_id: cardId, remaining: next.remaining, card: next };
}

export async function clipTencardAction(env, payload, session) {
  if (!canManageTencards(session)) return { ok: false, error: "Saknar behörighet" };
  const cardId = normalizeCardId(payload && (payload.card_id || payload.cardId || payload));
  if (!cardId) return { ok: false, error: "Ange kortnummer" };
  const clipPath = "/api/admin/tencards/" + encodeURIComponent(cardId) + "/clip";
  const res = await kioskAdminRequest(env, clipPath, { method: "POST" });
  if (res.okHttp && res.data && res.data.ok) {
    return { ok: true, card_id: cardId, remaining: res.data.remaining, card: mapCard(res.data.card) };
  }
  if (res.http === 409 || (res.data && res.data.error === "exhausted")) {
    return { ok: false, error: "Inga klipp kvar", card: mapCard(res.data && res.data.card) };
  }
  const err = (res.data && res.data.error) || res.error || "";
  if (err === "unauthorized") return { ok: false, error: "Fel ADMIN_TOKEN mot kiosk-API:t" };
  // Live kiosk har inte /clip ännu (404 HTML). Klipp via admin-save (remaining - 1).
  return clipViaSave(env, cardId, session);
}

export async function deleteTencardAction(env, payload, session) {
  if (!canManageTencards(session)) return { ok: false, error: "Saknar behörighet" };
  const cardId = normalizeCardId(payload && (payload.card_id || payload.cardId || payload));
  if (!cardId) return { ok: false, error: "Ange kortnummer" };
  const res = await kioskAdminRequest(env, "/api/admin/tencards/" + encodeURIComponent(cardId), { method: "DELETE" });
  if (res.error && !res.data) return { ok: false, error: res.error };
  if (res.okHttp) return { ok: true, card_id: cardId };
  const err = (res.data && res.data.error) || "";
  if (err === "not_tencard") return { ok: false, error: "Kortnumret tillhör inte ett 10-kort" };
  if (res.http === 404) return { ok: false, error: "Kortet finns inte" };
  if (res.http === 405) return { ok: false, error: "Kiosk-API:t saknar radering — deploya kiosk-Workern" };
  return { ok: false, error: err || "Kunde inte ta bort kortet" };
}

export function tencardsConfigured(env) {
  return !!(kioskBase(env) && adminToken(env));
}
