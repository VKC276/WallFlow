/** Auth, roller och sessioner (KV) — samma hashalgoritm som GAS. */

export const SESSION_HOURS = 24 * 14;
export const SESSION_PREFIX = "wf_sess_";
export const RESET_PREFIX = "wf_reset_";
export const RESET_HOURS = 2;
export const ALL_PRIMARY_ROLES = ["superadmin", "admin", "scout", "kassor", "hallvard"];

export function normalizeRole(role) {
  let r = String(role == null ? "" : role).trim().toLowerCase();
  r = r.replace(/å/g, "a").replace(/ä/g, "a").replace(/ö/g, "o");
  if (!r) return "admin";
  if (r === "superadmin" || r === "super" || r === "super-admin" || r === "super_admin") return "superadmin";
  if (r === "scout" || r === "developer" || r === "ledbyggare" || r === "sattare" || r === "setter") return "scout";
  if (r === "kassor" || r === "treasurer") return "kassor";
  if (r === "hallvard" || r === "host") return "hallvard";
  if (r === "admin" || r === "administrator" || r === "administratoer") return "admin";
  if (r.indexOf("super") >= 0) return "superadmin";
  if (r.indexOf("kassor") >= 0) return "kassor";
  if (r.indexOf("hallv") >= 0) return "hallvard";
  if (r.indexOf("ledbygg") >= 0 || r.indexOf("satt") >= 0 || r.indexOf("scout") >= 0) return "scout";
  if (r.indexOf("admin") >= 0) return "admin";
  return "admin";
}

export function parseExtraRoles(raw) {
  const parts = Array.isArray(raw)
    ? raw
    : String(raw == null ? "" : raw).split(/[,;]+/);
  const out = [];
  for (const part of parts) {
    const n = normalizeRole(part);
    if ((n === "kassor" || n === "hallvard") && out.indexOf(n) < 0) out.push(n);
  }
  return out;
}

export function serializeExtraRoles(raw) {
  return parseExtraRoles(raw).join(",");
}

export function allRolesOf(userOrSession) {
  const primary = normalizeRole(userOrSession && userOrSession.role);
  const extras = parseExtraRoles(
    (userOrSession && (userOrSession.extraRoles || userOrSession.extra_roles)) || ""
  );
  const out = [primary];
  for (const e of extras) {
    if (out.indexOf(e) < 0) out.push(e);
  }
  return out;
}

export function hasRole(userOrSession, role) {
  return allRolesOf(userOrSession).indexOf(normalizeRole(role)) >= 0;
}

export function roleOf(session) {
  return normalizeRole(session && session.role);
}

export function canEdit(session) {
  const r = roleOf(session);
  return r === "superadmin" || r === "admin" || r === "scout";
}

export function canManageRouteStructure(session) {
  return roleOf(session) === "superadmin";
}

export function canManageUsers(session) {
  const r = roleOf(session);
  return r === "superadmin" || r === "admin";
}

/** Admin + Superadmin: rensa problem (bilder, info) till Ej uppsatt. */
export function canWallReset(session) {
  const r = roleOf(session);
  return r === "superadmin" || r === "admin";
}

export function canManageLifetime(session) {
  return roleOf(session) === "superadmin";
}

export function isSuperadminRole(role) {
  return normalizeRole(role) === "superadmin";
}

export function isLedbyggareRole(role) {
  return normalizeRole(role) === "scout";
}

export function isKassorRole(role) {
  return normalizeRole(role) === "kassor";
}

export function isHallvardRole(role) {
  return normalizeRole(role) === "hallvard";
}

export function isAdminActor(session) {
  return roleOf(session) === "admin";
}

export function isFirstLogin(v) {
  const s = String(v == null ? "" : v).trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "ja";
}

export function validateUsername(username) {
  const next = String(username || "").trim();
  if (!next) return { ok: false, error: "Användarnamn saknas" };
  if (next.length < 2 || next.length > 40) {
    return { ok: false, error: "Användarnamn ska vara 2–40 tecken" };
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(next)) {
    return { ok: false, error: "Användarnamn: endast a–z, 0–9, punkt, _ och -" };
  }
  return { ok: true, username: next };
}

export function validateEmail(email) {
  const next = String(email || "").trim().toLowerCase();
  if (!next) return { ok: false, error: "E-post saknas" };
  if (next.length > 120) return { ok: false, error: "E-postadressen är för lång" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) {
    return { ok: false, error: "Ogiltig e-postadress" };
  }
  return { ok: true, email: next };
}

export async function sha256Hex(value) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value || "")));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function savePasswordReset(env, token, username) {
  const key = RESET_PREFIX + (await sha256Hex(token));
  const payload = JSON.stringify({
    username: String(username || "").trim(),
    exp: Date.now() + RESET_HOURS * 3600 * 1000
  });
  await env.SESSIONS.put(key, payload, { expirationTtl: RESET_HOURS * 3600 });
}

export async function takePasswordReset(env, token) {
  const rawToken = String(token || "").trim();
  if (!rawToken) return null;
  const key = RESET_PREFIX + (await sha256Hex(rawToken));
  const raw = await env.SESSIONS.get(key);
  if (!raw) return null;
  await env.SESSIONS.delete(key);
  try {
    const obj = JSON.parse(raw);
    if (!obj || !obj.username || !obj.exp || obj.exp < Date.now()) return null;
    return { username: String(obj.username) };
  } catch {
    return null;
  }
}

export async function hashPassword(password, salt) {
  const data = new TextEncoder().encode(String(salt || "") + String(password || ""));
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomSalt() {
  return crypto.randomUUID().replace(/-/g, "");
}

export async function saveSession(env, token, username, role, extraRoles) {
  const payload = JSON.stringify({
    username,
    role: normalizeRole(role),
    extraRoles: parseExtraRoles(extraRoles),
    exp: Date.now() + SESSION_HOURS * 3600 * 1000
  });
  await env.SESSIONS.put(SESSION_PREFIX + token, payload, {
    expirationTtl: SESSION_HOURS * 3600
  });
}

export async function getSession(env, token) {
  if (!token) return null;
  const raw = await env.SESSIONS.get(SESSION_PREFIX + token);
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (!obj || !obj.exp || obj.exp < Date.now()) {
      await env.SESSIONS.delete(SESSION_PREFIX + token);
      return null;
    }
    return {
      username: String(obj.username),
      role: normalizeRole(obj.role || "admin"),
      extraRoles: parseExtraRoles(obj.extraRoles)
    };
  } catch {
    return null;
  }
}
