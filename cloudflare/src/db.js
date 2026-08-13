/** D1 helpers — routes, grades, users, settings + omräknade fält. */

import { normalizeRole, isFirstLogin } from "./auth.js";

export const DEFAULT_ROUTE_LIFETIME_DAYS = 30;

export function normalizeLifetimeDays(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v) || v < 1) return DEFAULT_ROUTE_LIFETIME_DAYS;
  if (v > 3650) return 3650;
  return v;
}

export function safeRouteNrForFile(nr) {
  const s = String(nr == null ? "" : nr).trim().replace(/[^\w\-]+/g, "_");
  return s || "x";
}

/** YYYY-MM-DD i Europe/Stockholm. */
export function todayStockholm() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function addDaysYmd(ymd, days) {
  const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  dt.setUTCDate(dt.getUTCDate() + Number(days || 0));
  return dt.toISOString().slice(0, 10);
}

export function computeSlutdatum(byggdatum, livslangd) {
  const b = String(byggdatum || "").trim();
  if (!b) return "";
  return addDaysYmd(b, normalizeLifetimeDays(livslangd));
}

export function computeDagsAttByggaOm(gradering, byggdatum, slutdatum) {
  if (!String(byggdatum || "").trim()) return "";
  if (String(gradering || "").trim().toLowerCase() === "ej uppsatt") return "-";
  const slut = String(slutdatum || "").trim();
  if (!slut) return "";
  return slut < todayStockholm() ? "Ja" : "Nej";
}

export function mapRouteRow(row, defaultLife) {
  const nr = String(row.nr == null ? "" : row.nr).trim();
  const life = row.livslangd == null || row.livslangd === ""
    ? normalizeLifetimeDays(defaultLife)
    : normalizeLifetimeDays(row.livslangd);
  const byggdatum = String(row.byggdatum || "").trim();
  const gradering = String(row.gradering || "").trim();
  const slutdatum = computeSlutdatum(byggdatum, life);
  return {
    Nr: nr,
    Gradering: gradering,
    DagsAttByggaOm: computeDagsAttByggaOm(gradering, byggdatum, slutdatum),
    Ledbyggare: String(row.ledbyggare || "").trim(),
    Byggdatum: byggdatum,
    Slutdatum: slutdatum,
    Anteckningar: String(row.anteckningar || "").trim(),
    Bild: String(row.bild_key || "").trim(),
    Livslangd: life
  };
}

export async function getSetting(env, key, fallback = "") {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first();
  return row && row.value != null ? String(row.value) : fallback;
}

export async function setSetting(env, key, value) {
  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).bind(key, String(value)).run();
}

export async function readRouteLifetimeDays(env) {
  const raw = await getSetting(env, "routeLifetimeDays", String(DEFAULT_ROUTE_LIFETIME_DAYS));
  return normalizeLifetimeDays(raw);
}

export async function readBaseUrlQr(env) {
  return await getSetting(env, "baseUrlQr", "");
}

export async function readGrades(env) {
  const { results } = await env.DB.prepare(
    "SELECT namn FROM grades ORDER BY sort_order ASC, namn ASC"
  ).all();
  return (results || []).map((r) => String(r.namn || "").trim()).filter(Boolean);
}

export function isWildcardGrade(name) {
  return String(name || "").trim().toLowerCase() === "wildcard";
}

export function isEjUppsattGrade(name) {
  return String(name || "").trim().toLowerCase() === "ej uppsatt";
}

export async function isAllowedGrade(env, name) {
  const g = String(name || "").trim();
  if (!g) return false;
  if (isWildcardGrade(g) || isEjUppsattGrade(g)) return true;
  const grades = await readGrades(env);
  return grades.some((x) => x.toLowerCase() === g.toLowerCase());
}

export async function readRoutes(env) {
  const defaultLife = await readRouteLifetimeDays(env);
  const { results } = await env.DB.prepare("SELECT * FROM routes").all();
  const out = (results || []).map((r) => mapRouteRow(r, defaultLife));
  out.sort((a, b) => String(a.Nr || "").localeCompare(String(b.Nr || ""), "sv"));
  return out;
}

export async function getRouteByNr(env, nr) {
  const target = String(nr || "").trim();
  if (!target) return null;
  const row = await env.DB.prepare("SELECT * FROM routes WHERE nr = ?").bind(target).first();
  if (!row) return null;
  const defaultLife = await readRouteLifetimeDays(env);
  return mapRouteRow(row, defaultLife);
}

export async function nextRouteNumber(env) {
  const { results } = await env.DB.prepare("SELECT nr FROM routes").all();
  let max = 0;
  for (const r of results || []) {
    const n = Number(r.nr);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return max + 1;
}

export async function readUsers(env) {
  const { results } = await env.DB.prepare("SELECT * FROM users").all();
  return (results || []).map((u) => ({
    username: String(u.username || "").trim(),
    passwordHash: String(u.password_hash || ""),
    salt: String(u.salt || ""),
    role: normalizeRole(u.role || "admin"),
    name: String(u.name || "").trim(),
    FirstLogin: u.first_login ? "TRUE" : "FALSE",
    first_login: !!u.first_login
  })).filter((u) => !!u.username);
}

export async function findUser(env, username) {
  const target = String(username || "").trim().toLowerCase();
  if (!target) return null;
  const users = await readUsers(env);
  return users.find((u) => u.username.toLowerCase() === target) || null;
}

export async function upsertUser(env, user) {
  await env.DB.prepare(
    `INSERT INTO users (username, password_hash, salt, role, name, first_login)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET
       password_hash = excluded.password_hash,
       salt = excluded.salt,
       role = excluded.role,
       name = excluded.name,
       first_login = excluded.first_login`
  ).bind(
    user.username,
    user.passwordHash,
    user.salt,
    normalizeRole(user.role),
    user.name || "",
    isFirstLogin(user.FirstLogin) || user.first_login ? 1 : 0
  ).run();
}

export async function deleteUser(env, username) {
  await env.DB.prepare("DELETE FROM users WHERE username = ? COLLATE NOCASE").bind(username).run();
}

export async function renameUser(env, oldUsername, newUsername) {
  await env.DB.prepare(
    "UPDATE users SET username = ? WHERE username = ? COLLATE NOCASE"
  ).bind(newUsername, oldUsername).run();
}

export async function countSuperadmins(env) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM users WHERE role = 'superadmin'"
  ).first();
  return Number(row && row.n) || 0;
}

export async function refreshSessionRole(env, session) {
  if (!session || !session.username) return session;
  const u = await findUser(env, session.username);
  if (u) session.role = u.role;
  else session.role = normalizeRole(session.role);
  return session;
}
