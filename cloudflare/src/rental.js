/**
 * Uthyrningens admin går via RentR-workern.
 * Webbläsaren pratar bara med WallFlow. Hemligheten lämnar aldrig servern.
 */

import { canManageRental, hasRole, isUserActive } from "./auth.js";
import { readUsers } from "./db.js";

const RENTAL_ACTIONS = [
  "adminOverview",
  "listBookings",
  "adminUpdateBooking",
  "deleteBooking",
  "getRentalStats",
  "getAdminConfig",
  "saveAdminConfig",
  "availablePadsForBooking",
  "listPads",
  "updatePad",
  "createPad",
  "setPadActive",
  "listPricingRules",
  "savePricingRule",
  "deletePricingRule",
  "listDoorPasses",
  "createDoorPass",
  "revokeDoorPass",
  "deleteDoorPass"
];

function bridgeSecret(env) {
  return String((env && env.RENTAL_BRIDGE_SECRET) || "").trim();
}

function rentrBase(env) {
  return String((env && env.RENTR_API_URL) || "").trim().replace(/\/+$/, "");
}

export function secretsMatch(a, b) {
  const enc = new TextEncoder();
  const left = enc.encode(String(a || ""));
  const right = enc.encode(String(b || ""));
  if (!left.length || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

export function bridgeAuthorized(env, request) {
  const secret = bridgeSecret(env);
  if (!secret) return false;
  const got = request.headers.get("X-Rental-Bridge-Secret") || "";
  return secretsMatch(got, secret);
}

export async function listUthyrareEmails(env) {
  const users = await readUsers(env);
  const out = [];
  for (const u of users) {
    if (!isUserActive(u) || !hasRole(u, "uthyrare") || !u.email) continue;
    if (out.indexOf(u.email) < 0) out.push(u.email);
  }
  return out;
}

export async function rentalAdmin(env, payload, session) {
  if (!canManageRental(session)) return { ok: false, error: "Saknar behörighet" };
  const obj = payload && typeof payload === "object" ? payload : {};
  const action = String(obj.action || "").trim();
  if (RENTAL_ACTIONS.indexOf(action) < 0) return { ok: false, error: "Otillåten åtgärd" };

  const secret = bridgeSecret(env);
  if (!secret) {
    return { ok: false, error: "RENTAL_BRIDGE_SECRET saknas på WallFlow-servern" };
  }

  const body = Object.assign({}, obj, { action });
  delete body.token;
  delete body.sessionToken;
  const init = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Rental-Bridge-Secret": secret,
      Accept: "application/json"
    },
    body: JSON.stringify(body)
  };

  let res;
  try {
    if (env.RENTR && typeof env.RENTR.fetch === "function") {
      res = await env.RENTR.fetch(new Request("https://rentr/api", init));
    } else {
      const base = rentrBase(env);
      if (!base) return { ok: false, error: "RENTR_API_URL saknas på WallFlow-servern" };
      res = await fetch(base, init);
    }
  } catch (err) {
    return { ok: false, error: "Kunde inte nå uthyrningen: " + String(err && err.message ? err.message : err) };
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!data || typeof data !== "object") {
    return { ok: false, error: "Uthyrningen svarade inte med JSON (HTTP " + res.status + ")" };
  }
  if (!res.ok || data.error) {
    return {
      ok: false,
      error: data.error || "Uthyrningen svarade HTTP " + res.status,
      code: data.code,
      details: data.details
    };
  }
  delete data.users;
  return Object.assign({ ok: true }, data);
}
