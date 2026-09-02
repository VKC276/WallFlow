/** Tidrapportering: inställningar, rader, kassörsrapport. */

import { todayStockholm } from "./db.js";
import {
  allRolesOf,
  hasRole,
  isSuperadminRole,
  roleOf
} from "./auth.js";

export const TIME_SETTING_KEYS = {
  ledbyggHourlyRate: "timeLedbyggHourlyRate",
  ledbyggPayMode: "timeLedbyggPayMode",
  ledbyggProblemAmount: "timeLedbyggProblemAmount",
  minPayout: "timeMinPayout",
  hallvardShiftAmount: "timeHallvardShiftAmount",
  hallvardExtraAmount: "timeHallvardExtraAmount",
  maxYearAmount: "timeMaxYearAmount",
  warningYearAmount: "timeWarningYearAmount"
};

export const HALLVARD_EXTRA_FLAG = "tillägg";

export function normalizeLedbyggPayMode(raw) {
  const s = String(raw == null ? "" : raw).trim().toLowerCase();
  if (s === "problems" || s === "problem" || s === "leder") return "problems";
  if (s === "both" || s === "bada" || s === "båda") return "both";
  return "time";
}

export function ledbyggPayIncludesTime(mode) {
  const m = normalizeLedbyggPayMode(mode);
  return m === "time" || m === "both";
}

export function ledbyggPayIncludesProblems(mode) {
  const m = normalizeLedbyggPayMode(mode);
  return m === "problems" || m === "both";
}

export function canUseTimeTool(session) {
  return !!(session && session.username);
}

export function canReportLedbygg(session) {
  const r = roleOf(session);
  return r === "superadmin" || r === "admin" || r === "scout";
}

export function canReportHallvard(session) {
  return hasRole(session, "hallvard");
}

export function canTreasurerReport(session) {
  return isSuperadminRole(roleOf(session)) || hasRole(session, "kassor");
}

export function canManageTimeSettings(session) {
  return isSuperadminRole(roleOf(session));
}

export function canDeleteTimeEntry(session) {
  return isSuperadminRole(roleOf(session));
}

export function hasWallflowAccess(session) {
  const r = roleOf(session);
  return r === "superadmin" || r === "admin" || r === "scout";
}

export function roundMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}

export function normalizeMoneyAmount(n, { allowNegative = false } = {}) {
  const v = roundMoney(n);
  if (!allowNegative && v < 0) return 0;
  if (v > 1e9) return 1e9;
  return v;
}

export function normalizeHours(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return null;
  const rounded = Math.round(v * 100) / 100;
  if (Math.abs(rounded) > 24 * 31) return null;
  return rounded;
}

/** HH:MM → minuter från midnatt, eller null. */
export function parseClockMinutes(raw) {
  const m = String(raw == null ? "" : raw).trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function formatClockHm(minutes) {
  const total = ((Number(minutes) % (24 * 60)) + (24 * 60)) % (24 * 60);
  const h = Math.floor(total / 60);
  const min = total % 60;
  return String(h).padStart(2, "0") + ":" + String(min).padStart(2, "0");
}

/**
 * Timmar från start–slut samma kalenderdag.
 * Om slut är före start räknas passet över midnatt.
 */
export function hoursFromClockTimes(startRaw, endRaw) {
  const startMin = parseClockMinutes(startRaw);
  const endMin = parseClockMinutes(endRaw);
  if (startMin == null || endMin == null) {
    return { ok: false, error: "Ange start- och sluttid" };
  }
  let diff = endMin - startMin;
  if (diff === 0) return { ok: false, error: "Start och slut kan inte vara samma tid" };
  const overnight = diff < 0;
  if (overnight) diff += 24 * 60;
  const hours = Math.round((diff / 60) * 100) / 100;
  if (hours > 24) return { ok: false, error: "Passet kan inte vara längre än 24 timmar" };
  return {
    ok: true,
    hours,
    startTime: formatClockHm(startMin),
    endTime: formatClockHm(endMin),
    overnight
  };
}

export function isValidYmd(ymd) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ""));
}

/** Inkluderande datumintervall för kassörsrapport. */
export function inclusiveDateRange(fromRaw, toRaw) {
  const fromDate = String(fromRaw || "").trim().slice(0, 10);
  const toDate = String(toRaw || "").trim().slice(0, 10);
  if (!isValidYmd(fromDate) || !isValidYmd(toDate)) {
    return { ok: false, error: "Ange start- och slutdatum" };
  }
  if (fromDate > toDate) {
    return { ok: false, error: "Startdatum kan inte vara efter slutdatum" };
  }
  const fromMs = Date.parse(fromDate + "T00:00:00Z");
  const toMs = Date.parse(toDate + "T00:00:00Z");
  const days = Math.round((toMs - fromMs) / 86400000) + 1;
  if (days > 800) {
    return { ok: false, error: "Perioden kan vara högst 800 dagar" };
  }
  return { ok: true, fromDate, toDate };
}

export function yearMonthBounds(yearMonth) {
  const s = String(yearMonth || "").trim();
  const m = s.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  const start = `${m[1]}-${m[2]}-01`;
  const nextMo = mo === 12 ? 1 : mo + 1;
  const nextY = mo === 12 ? y + 1 : y;
  const end = `${String(nextY).padStart(4, "0")}-${String(nextMo).padStart(2, "0")}-01`;
  return { start, endExclusive: end, year: y, month: mo };
}

export function calendarYearBounds(year) {
  const y = Math.round(Number(year));
  if (!Number.isFinite(y) || y < 2000 || y > 2100) return null;
  const ys = String(y);
  return { start: `${ys}-01-01`, endExclusive: `${y + 1}-01-01`, year: y };
}

export function stockholmYearNow() {
  return Number(todayStockholm().slice(0, 4));
}

export function stockholmYearMonthNow() {
  return todayStockholm().slice(0, 7);
}

export function rowAmount(entry) {
  if (!entry) return 0;
  if (entry.amount != null && entry.amount !== "") {
    const direct = Number(entry.amount);
    if (Number.isFinite(direct)) return roundMoney(direct);
  }
  const unit = entry.unitAmount != null ? entry.unitAmount : entry.unit_amount;
  return roundMoney(Number(entry.hours || 0) * Number(unit || 0));
}

export async function readTimeSettings(env) {
  const keys = Object.values(TIME_SETTING_KEYS);
  const { results } = await env.DB.prepare(
    `SELECT key, value FROM settings WHERE key IN (${keys.map(() => "?").join(",")})`
  ).bind(...keys).all();
  const map = {};
  for (const r of results || []) map[r.key] = r.value;
  return {
    ledbyggHourlyRate: normalizeMoneyAmount(map[TIME_SETTING_KEYS.ledbyggHourlyRate] || 0),
    ledbyggPayMode: normalizeLedbyggPayMode(map[TIME_SETTING_KEYS.ledbyggPayMode] || "time"),
    ledbyggProblemAmount: normalizeMoneyAmount(map[TIME_SETTING_KEYS.ledbyggProblemAmount] || 0),
    minPayout: normalizeMoneyAmount(map[TIME_SETTING_KEYS.minPayout] || 0),
    hallvardShiftAmount: normalizeMoneyAmount(map[TIME_SETTING_KEYS.hallvardShiftAmount] || 0),
    hallvardExtraAmount: normalizeMoneyAmount(map[TIME_SETTING_KEYS.hallvardExtraAmount] || 0),
    maxYearAmount: normalizeMoneyAmount(map[TIME_SETTING_KEYS.maxYearAmount] || 0),
    warningYearAmount: normalizeMoneyAmount(map[TIME_SETTING_KEYS.warningYearAmount] || 0)
  };
}

export async function saveTimeSettings(env, payload) {
  const next = {
    ledbyggHourlyRate: normalizeMoneyAmount(payload && payload.ledbyggHourlyRate),
    ledbyggPayMode: normalizeLedbyggPayMode(payload && payload.ledbyggPayMode),
    ledbyggProblemAmount: normalizeMoneyAmount(payload && payload.ledbyggProblemAmount),
    minPayout: normalizeMoneyAmount(payload && payload.minPayout),
    hallvardShiftAmount: normalizeMoneyAmount(payload && payload.hallvardShiftAmount),
    hallvardExtraAmount: normalizeMoneyAmount(payload && payload.hallvardExtraAmount),
    maxYearAmount: normalizeMoneyAmount(payload && payload.maxYearAmount),
    warningYearAmount: normalizeMoneyAmount(payload && payload.warningYearAmount)
  };
  if (next.warningYearAmount && next.maxYearAmount && next.warningYearAmount > next.maxYearAmount) {
    return { ok: false, error: "Varningsgränsen kan inte vara högre än maxtaket" };
  }
  const pairs = [
    [TIME_SETTING_KEYS.ledbyggHourlyRate, next.ledbyggHourlyRate],
    [TIME_SETTING_KEYS.ledbyggPayMode, next.ledbyggPayMode],
    [TIME_SETTING_KEYS.ledbyggProblemAmount, next.ledbyggProblemAmount],
    [TIME_SETTING_KEYS.minPayout, next.minPayout],
    [TIME_SETTING_KEYS.hallvardShiftAmount, next.hallvardShiftAmount],
    [TIME_SETTING_KEYS.hallvardExtraAmount, next.hallvardExtraAmount],
    [TIME_SETTING_KEYS.maxYearAmount, next.maxYearAmount],
    [TIME_SETTING_KEYS.warningYearAmount, next.warningYearAmount]
  ];
  for (const [key, value] of pairs) {
    await env.DB.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).bind(key, String(value)).run();
  }
  return { ok: true, settings: next };
}

function mapEntryRow(row) {
  const hours = Number(row.hours) || 0;
  const unit = Number(row.unit_amount) || 0;
  const kind = String(row.kind || "");
  const startRaw = String(row.start_time || "");
  const isProblem = kind === "problem";
  const extra = kind === "hallvard" && startRaw.toLowerCase() === HALLVARD_EXTRA_FLAG;
  return {
    id: Number(row.id),
    username: String(row.username || ""),
    name: String(row.name || row.username || ""),
    kind,
    workDate: String(row.work_date || ""),
    hours,
    startTime: isProblem || extra ? "" : startRaw,
    endTime: isProblem ? "" : String(row.end_time || ""),
    routeNr: isProblem ? startRaw : "",
    extra,
    description: String(row.description || ""),
    unitAmount: unit,
    amount: roundMoney(hours * unit),
    createdAt: String(row.created_at || ""),
    createdBy: String(row.created_by || "")
  };
}

export async function yearCompensationForUser(env, username, year, settings) {
  const bounds = calendarYearBounds(year || stockholmYearNow());
  if (!bounds) return 0;
  const { results } = await env.DB.prepare(
    `SELECT kind, hours, unit_amount
     FROM time_entries
     WHERE username = ? COLLATE NOCASE
       AND work_date >= ? AND work_date < ?`
  ).bind(username, bounds.start, bounds.endExclusive).all();
  let total = 0;
  for (const row of results || []) {
    total += roundMoney(Number(row.hours || 0) * Number(row.unit_amount || 0));
  }
  return roundMoney(total);
}

export function capStatus(yearTotal, settings) {
  const total = roundMoney(yearTotal);
  const max = settings.maxYearAmount;
  const warn = settings.warningYearAmount;
  let level = "ok";
  if (max > 0 && total >= max) level = "max";
  else if (warn > 0 && total >= warn) level = "warn";
  else if (max > 0 && warn > 0 && total >= warn * 0.8) level = "approaching";
  return {
    yearTotal: total,
    maxYearAmount: max,
    warningYearAmount: warn,
    remaining: max > 0 ? roundMoney(Math.max(0, max - total)) : null,
    level
  };
}

export async function listEntriesForUser(env, username, yearMonth) {
  const bounds = yearMonthBounds(yearMonth) || yearMonthBounds(stockholmYearMonthNow());
  const { results } = await env.DB.prepare(
    `SELECT e.*, u.name AS name
     FROM time_entries e
     LEFT JOIN users u ON u.username = e.username COLLATE NOCASE
     WHERE e.username = ? COLLATE NOCASE
       AND e.work_date >= ? AND e.work_date < ?
     ORDER BY e.work_date ASC, e.id ASC`
  ).bind(username, bounds.start, bounds.endExclusive).all();
  return (results || []).map(mapEntryRow);
}

export async function listEntriesForReport(env, fromDate, toDate) {
  const range = inclusiveDateRange(fromDate, toDate);
  if (!range.ok) return { ok: false, error: range.error, entries: [] };
  const { results } = await env.DB.prepare(
    `SELECT e.*, u.name AS name
     FROM time_entries e
     LEFT JOIN users u ON u.username = e.username COLLATE NOCASE
     WHERE e.work_date >= ? AND e.work_date <= ?
     ORDER BY e.work_date ASC, e.username ASC, e.id ASC`
  ).bind(range.fromDate, range.toDate).all();
  return { ok: true, fromDate: range.fromDate, toDate: range.toDate, entries: (results || []).map(mapEntryRow) };
}

export function summarizeEntries(entries, settings) {
  const rows = entries || [];
  const mode = normalizeLedbyggPayMode(settings && settings.ledbyggPayMode);
  let ledbyggHours = 0;
  let ledbyggTimeAmount = 0;
  let ledbyggProblemCount = 0;
  let ledbyggProblemAmount = 0;
  let hallvardShifts = 0;
  let hallvardAmount = 0;
  const byUser = new Map();

  const ensureUser = (username, name) => {
    const key = String(username || "").toLowerCase();
    if (!byUser.has(key)) {
      byUser.set(key, {
        username,
        name: name || username,
        ledbyggHours: 0,
        ledbyggTimeAmount: 0,
        ledbyggAmount: 0,
        hallvardShifts: 0,
        hallvardAmount: 0,
        problemCount: 0,
        problemAmount: 0,
        amount: 0
      });
    }
    return byUser.get(key);
  };

  for (const e of rows) {
    const amt = rowAmount(e);
    const u = ensureUser(e.username, e.name);
    if (e.kind === "hallvard") {
      hallvardShifts += Number(e.hours) || 0;
      hallvardAmount += amt;
      u.hallvardShifts += Number(e.hours) || 0;
      u.hallvardAmount += amt;
      u.amount += amt;
    } else if (e.kind === "problem") {
      const count = Number(e.hours) || 0;
      ledbyggProblemCount += count;
      u.problemCount += count;
      ledbyggProblemAmount += amt;
      u.problemAmount += amt;
      u.ledbyggAmount += amt;
      u.amount += amt;
    } else {
      ledbyggHours += Number(e.hours) || 0;
      u.ledbyggHours += Number(e.hours) || 0;
      ledbyggTimeAmount += amt;
      u.ledbyggTimeAmount += amt;
      u.ledbyggAmount += amt;
      u.amount += amt;
    }
  }

  const people = [...byUser.values()].map((u) => {
    const amount = roundMoney(u.amount);
    return {
      ...u,
      ledbyggHours: roundMoney(u.ledbyggHours),
      ledbyggTimeAmount: roundMoney(u.ledbyggTimeAmount),
      ledbyggAmount: roundMoney(u.ledbyggAmount),
      hallvardShifts: roundMoney(u.hallvardShifts),
      hallvardAmount: roundMoney(u.hallvardAmount),
      problemCount: Number(u.problemCount) || 0,
      problemAmount: roundMoney(u.problemAmount),
      amount,
      belowMinPayout: settings && settings.minPayout > 0 && amount > 0 && amount < settings.minPayout
    };
  }).sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "sv"));

  const ledbyggAmount = roundMoney(ledbyggTimeAmount + ledbyggProblemAmount);
  return {
    ledbyggPayMode: mode,
    ledbyggHours: roundMoney(ledbyggHours),
    ledbyggTimeAmount: roundMoney(ledbyggTimeAmount),
    ledbyggProblemCount,
    ledbyggProblemAmount,
    ledbyggAmount,
    hallvardShifts: roundMoney(hallvardShifts),
    hallvardAmount: roundMoney(hallvardAmount),
    totalAmount: roundMoney(ledbyggAmount + hallvardAmount),
    minPayout: settings && settings.minPayout,
    people
  };
}

export async function addTimeEntry(env, session, payload) {
  const kind = String(payload && payload.kind || "").trim();
  if (kind !== "ledbygg" && kind !== "hallvard" && kind !== "problem") {
    return { ok: false, error: "Ogiltig typ" };
  }
  if ((kind === "ledbygg" || kind === "problem") && !canReportLedbygg(session)) {
    return { ok: false, error: "Saknar behörighet att rapportera ledbygg" };
  }
  if (kind === "hallvard" && !canReportHallvard(session)) {
    return { ok: false, error: "Saknar behörighet att rapportera hallvärdspass" };
  }

  const workDate = String(payload && payload.workDate || "").trim().slice(0, 10);
  if (!isValidYmd(workDate)) return { ok: false, error: "Ogiltigt datum" };

  const settings = await readTimeSettings(env);
  let hours;
  let description;
  let unitAmount;
  let startTime = "";
  let endTime = "";

  if (kind === "hallvard") {
    const correction = !!(payload && payload.correction);
    const extra = !!(payload && (payload.extra || payload.tillägg || payload.tillagg));
    hours = correction ? -1 : 1;
    description = String(payload && payload.description || "").trim() || (correction ? "Korrigering hallvärdspass" : "Hallvärdspass");
    if (description.length > 500) return { ok: false, error: "Beskrivningen är för lång (max 500 tecken)" };
    unitAmount = settings.hallvardShiftAmount + (extra ? settings.hallvardExtraAmount : 0);
    startTime = extra ? HALLVARD_EXTRA_FLAG : "";
  } else if (kind === "problem") {
    const routeNr = String(payload && (payload.routeNr != null ? payload.routeNr : payload.nr) || "").trim();
    if (!routeNr || routeNr.length > 20) return { ok: false, error: "Ange vilket problem (lednummer) som byggts om" };
    hours = payload && payload.correction ? -1 : 1;
    startTime = routeNr;
    description = String(payload && payload.description || "").trim();
    if (description.length > 500) return { ok: false, error: "Beskrivningen är för lång (max 500 tecken)" };
    unitAmount = settings.ledbyggProblemAmount;
  } else {
    const clock = hoursFromClockTimes(payload && payload.startTime, payload && payload.endTime);
    if (!clock.ok) return { ok: false, error: clock.error };
    hours = clock.hours;
    startTime = clock.startTime;
    endTime = clock.endTime;
    if (payload && payload.correction) hours = -Math.abs(hours);
    description = String(payload && payload.description || "").trim();
    if (!description) return { ok: false, error: "Beskriv vad som gjorts" };
    if (description.length > 500) return { ok: false, error: "Beskrivningen är för lång (max 500 tecken)" };
    unitAmount = settings.ledbyggHourlyRate;
  }

  const createdAt = new Date().toISOString();
  const result = await env.DB.prepare(
    `INSERT INTO time_entries (username, kind, work_date, hours, start_time, end_time, description, unit_amount, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    session.username,
    kind,
    workDate,
    hours,
    startTime,
    endTime,
    description,
    unitAmount,
    createdAt,
    session.username
  ).run();

  const id = Number(result && result.meta && result.meta.last_row_id) || 0;
  return {
    ok: true,
    entry: {
      id,
      username: session.username,
      kind,
      workDate,
      hours,
      startTime: kind === "problem" || kind === "hallvard" ? "" : startTime,
      endTime,
      routeNr: kind === "problem" ? startTime : "",
      extra: kind === "hallvard" && startTime === HALLVARD_EXTRA_FLAG,
      description,
      unitAmount,
      amount: roundMoney(hours * unitAmount),
      createdAt,
      createdBy: session.username
    }
  };
}

export async function deleteTimeEntryById(env, id) {
  const entryId = Math.round(Number(id));
  if (!Number.isFinite(entryId) || entryId < 1) {
    return { ok: false, error: "Ogiltigt id" };
  }
  const existing = await env.DB.prepare("SELECT id FROM time_entries WHERE id = ?").bind(entryId).first();
  if (!existing) return { ok: false, error: "Posten hittades inte" };
  await env.DB.prepare("DELETE FROM time_entries WHERE id = ?").bind(entryId).run();
  return { ok: true };
}

export async function retargetTimeEntriesUsername(env, oldUsername, newUsername) {
  await env.DB.prepare(
    "UPDATE time_entries SET username = ? WHERE username = ? COLLATE NOCASE"
  ).bind(newUsername, oldUsername).run();
  await env.DB.prepare(
    "UPDATE time_entries SET created_by = ? WHERE created_by = ? COLLATE NOCASE"
  ).bind(newUsername, oldUsername).run();
}

export function publicSessionFlags(session) {
  return {
    roles: allRolesOf(session),
    extraRoles: (session && session.extraRoles) || [],
    wallflow: hasWallflowAccess(session),
    reportLedbygg: canReportLedbygg(session),
    reportHallvard: canReportHallvard(session),
    treasurer: canTreasurerReport(session),
    timeAdmin: canManageTimeSettings(session)
  };
}
