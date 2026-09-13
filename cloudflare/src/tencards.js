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

async function kioskAdminRequest(env, path, options) {
  const base = kioskBase(env);
  const token = adminToken(env);
  if (!base || !token) return { ok: false, error: "10-kort är inte konfigurerat på servern", status: 0 };
  const method = (options && options.method) || "GET";
  const headers = {
    Authorization: "Bearer " + token,
    Accept: "application/json"
  };
  const init = { method, headers };
  if (options && options.body != null) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  let res;
  try {
    res = await fetch(base + path, init);
  } catch (err) {
    return { ok: false, error: "Kunde inte nå kiosk-API:t", status: 0, detail: String(err && err.message ? err.message : err) };
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { http: res.status, data: data && typeof data === "object" ? data : {}, okHttp: res.ok };
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
    return { ok: false, error: (res.data && res.data.error) || "Kunde inte lista 10-kort" };
  }
  const rows = Array.isArray(res.data.tencards) ? res.data.tencards : [];
  return { ok: true, tencards: rows.map(mapCard) };
}

export async function lookupTencardAction(env, payload, session) {
  if (!canManageTencards(session)) return { ok: false, error: "Saknar behörighet" };
  const cardId = normalizeCardId(payload && (payload.card_id || payload.cardId || payload));
  if (!cardId) return { ok: false, error: "Ange kortnummer" };
  const res = await kioskAdminRequest(env, "/api/admin/lookup/" + encodeURIComponent(cardId));
  if (res.error && !res.data) return { ok: false, error: res.error };
  if (!res.okHttp) {
    return { ok: false, error: (res.data && res.data.error) || "Kunde inte söka kort" };
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
    if (err === "card_id is not a 10-kort") {
      return { ok: false, error: "Kortnumret tillhör ett medlemskort och kan inte bli 10-kort" };
    }
    return { ok: false, error: err || "Kunde inte spara 10-kort" };
  }
  return { ok: true, card_id: cardId, card: mapCard(res.data.card) };
}

export async function clipTencardAction(env, payload, session) {
  if (!canManageTencards(session)) return { ok: false, error: "Saknar behörighet" };
  const cardId = normalizeCardId(payload && (payload.card_id || payload.cardId || payload));
  if (!cardId) return { ok: false, error: "Ange kortnummer" };
  const clipPath = "/api/admin/tencards/" + encodeURIComponent(cardId) + "/clip";
  const res = await kioskAdminRequest(env, clipPath, { method: "POST" });
  if (res.error && !res.data) return { ok: false, error: res.error };
  if (res.http === 404 && (!res.data || res.data.error === "not_found")) {
    return { ok: false, error: "Kortet finns inte" };
  }
  if (res.http === 409 || (res.data && res.data.error === "exhausted")) {
    return { ok: false, error: "Inga klipp kvar", card: mapCard(res.data && res.data.card) };
  }
  if (res.okHttp && res.data && res.data.ok) {
    return { ok: true, card_id: cardId, remaining: res.data.remaining, card: mapCard(res.data.card) };
  }
  // Äldre kiosk-Worker utan /clip: hämta + spara remaining-1
  if (res.http === 404 || res.http === 405) {
    const looked = await lookupTencardAction(env, { card_id: cardId }, session);
    if (!looked.ok) return looked;
    const card = looked.card;
    if (!card) return { ok: false, error: "Kortet finns inte" };
    if (card.kind && card.kind !== "tencard") {
      return { ok: false, error: "Detta är inte ett 10-kort" };
    }
    const remaining = Number(card.remaining);
    if (!(remaining > 0)) return { ok: false, error: "Inga klipp kvar", card };
    return saveTencardAction(env, {
      card_id: cardId,
      remaining: remaining - 1,
      name: card.name || "",
      last_clipped_at: stockholmNow()
    }, session);
  }
  return { ok: false, error: (res.data && res.data.error) || "Kunde inte klippa kortet" };
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
