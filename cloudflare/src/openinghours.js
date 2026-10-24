/** Öppettider: veckostandard, datumundantag och intern hallvärd. */

import { canManageOpeningHours } from "./auth.js";
import { findUser, getSetting, readUsers, setSetting, todayStockholm } from "./db.js";
import { formatClockHm, isValidYmd, parseClockMinutes } from "./time.js";

export { canManageOpeningHours };

export const OPENING_HOURS_WEEK_KEY = "openingHoursWeek";

export const WEEKDAY_LABELS_SV = {
  1: "Måndag",
  2: "Tisdag",
  3: "Onsdag",
  4: "Torsdag",
  5: "Fredag",
  6: "Lördag",
  7: "Söndag"
};

const DEFAULT_WEEK = {
  1: { closed: false, open: "16:00", close: "21:00", hostUsername: "" },
  2: { closed: false, open: "16:00", close: "21:00", hostUsername: "" },
  3: { closed: false, open: "16:00", close: "21:00", hostUsername: "" },
  4: { closed: false, open: "16:00", close: "21:00", hostUsername: "" },
  5: { closed: false, open: "16:00", close: "22:00", hostUsername: "" },
  6: { closed: false, open: "10:00", close: "18:00", hostUsername: "" },
  7: { closed: false, open: "10:00", close: "16:00", hostUsername: "" }
};

function clipText(raw, max) {
  return String(raw == null ? "" : raw).trim().slice(0, max);
}

function normalizeClock(raw) {
  const min = parseClockMinutes(raw);
  if (min == null) return null;
  return formatClockHm(min);
}

function emptyDaySlot() {
  return { closed: true, open: "", close: "", hostUsername: "" };
}

function normalizeDaySlot(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const closed = !!(src.closed === true || src.closed === 1 || src.closed === "1");
  let open = "";
  let close = "";
  if (!closed) {
    open = normalizeClock(src.open || src.openTime || src.start) || "";
    close = normalizeClock(src.close || src.closeTime || src.end) || "";
    if (!open || !close) {
      return { closed: true, open: "", close: "", hostUsername: clipText(src.hostUsername || src.host || "", 80) };
    }
  }
  return {
    closed,
    open,
    close,
    hostUsername: clipText(src.hostUsername || src.host || "", 80)
  };
}

function normalizeWeek(raw) {
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  const src = parsed && typeof parsed === "object" ? parsed : {};
  const out = {};
  for (let d = 1; d <= 7; d++) {
    const key = String(d);
    out[key] = normalizeDaySlot(src[key] || src[d] || DEFAULT_WEEK[d] || emptyDaySlot());
  }
  return out;
}

function publicDaySlot(slot) {
  return {
    closed: !!slot.closed,
    open: slot.closed ? "" : String(slot.open || ""),
    close: slot.closed ? "" : String(slot.close || "")
  };
}

function isoWeekdayFromYmd(ymd) {
  const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const js = dt.getUTCDay(); // 0=Sun … 6=Sat
  return js === 0 ? 7 : js;
}

function addDaysYmd(ymd, days) {
  const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  dt.setUTCDate(dt.getUTCDate() + Number(days || 0));
  return dt.toISOString().slice(0, 10);
}

function monthBounds(yearMonth) {
  const ym = String(yearMonth || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(ym)) return null;
  const from = ym + "-01";
  const [y, mo] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const to = ym + "-" + String(last).padStart(2, "0");
  return { from, to, yearMonth: ym };
}

function resolveRange(opts) {
  const today = todayStockholm();
  let from = clipText(opts && opts.from, 10);
  let to = clipText(opts && opts.to, 10);
  const ym = clipText(opts && (opts.yearMonth || opts.month), 7);
  if (ym && /^\d{4}-\d{2}$/.test(ym)) {
    const b = monthBounds(ym);
    if (b) {
      from = b.from;
      to = b.to;
    }
  }
  if (!isValidYmd(from) || !isValidYmd(to)) {
    const b = monthBounds(today.slice(0, 7));
    from = b.from;
    to = b.to;
  }
  if (from > to) {
    const tmp = from;
    from = to;
    to = tmp;
  }
  // Max ~14 månader för att skydda D1
  const maxSpan = 450;
  let span = 0;
  let cursor = from;
  while (cursor < to && span < maxSpan) {
    cursor = addDaysYmd(cursor, 1);
    span += 1;
  }
  if (span >= maxSpan) to = cursor;
  return { from, to, today };
}

async function readWeek(env) {
  const raw = await getSetting(env, OPENING_HOURS_WEEK_KEY, "");
  return normalizeWeek(raw || DEFAULT_WEEK);
}

function newPeriodId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "oh_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
}

function mapPeriodRow(row) {
  return {
    id: String(row.id || "").trim(),
    from: String(row.from_date || "").trim(),
    to: String(row.to_date || "").trim(),
    closed: !!(row.closed === 1 || row.closed === true),
    open: String(row.open_time || "").trim(),
    close: String(row.close_time || "").trim(),
    note: String(row.note || "").trim(),
    hostUsername: String(row.host_username || "").trim(),
    updatedAt: String(row.updated_at || "").trim(),
    updatedBy: String(row.updated_by || "").trim()
  };
}

/** Migrera gamla dagsrader → perioder (en gång). */
async function ensurePeriodsMigrated(env) {
  try {
    const counted = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM opening_hours_exception_periods"
    ).first();
    if (counted && Number(counted.c) > 0) return;
  } catch {
    return;
  }
  let legacy = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT date, closed, open_time, close_time, note, host_username, updated_at, updated_by
       FROM opening_hours_exceptions ORDER BY date ASC`
    ).all();
    legacy = results || [];
  } catch {
    return;
  }
  if (!legacy.length) return;

  const groups = [];
  for (const row of legacy) {
    const date = String(row.date || "").trim();
    if (!isValidYmd(date)) continue;
    const sig = [
      row.closed ? "1" : "0",
      String(row.open_time || ""),
      String(row.close_time || ""),
      String(row.note || ""),
      String(row.host_username || "").toLowerCase()
    ].join("|");
    const prev = groups[groups.length - 1];
    if (prev && prev.sig === sig && addDaysYmd(prev.to, 1) === date) {
      prev.to = date;
      if (String(row.updated_at || "") > prev.updatedAt) {
        prev.updatedAt = String(row.updated_at || "");
        prev.updatedBy = String(row.updated_by || "");
      }
    } else {
      groups.push({
        sig,
        from: date,
        to: date,
        closed: !!(row.closed === 1 || row.closed === true),
        open: String(row.open_time || ""),
        close: String(row.close_time || ""),
        note: String(row.note || ""),
        hostUsername: String(row.host_username || ""),
        updatedAt: String(row.updated_at || "") || new Date().toISOString(),
        updatedBy: String(row.updated_by || "")
      });
    }
  }

  const stmt = env.DB.prepare(
    `INSERT INTO opening_hours_exception_periods
      (id, from_date, to_date, closed, open_time, close_time, note, host_username, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  await env.DB.batch(
    groups.map((g) =>
      stmt.bind(
        newPeriodId(),
        g.from,
        g.to,
        g.closed ? 1 : 0,
        g.open,
        g.close,
        g.note,
        g.hostUsername,
        g.updatedAt,
        g.updatedBy
      )
    )
  );
}

/** Perioder som överlappar [from, to]. */
async function listPeriods(env, from, to) {
  await ensurePeriodsMigrated(env);
  const { results } = await env.DB.prepare(
    `SELECT id, from_date, to_date, closed, open_time, close_time, note, host_username, updated_at, updated_by
     FROM opening_hours_exception_periods
     WHERE from_date <= ? AND to_date >= ?
     ORDER BY from_date ASC, updated_at ASC`
  ).bind(to, from).all();
  return (results || []).map(mapPeriodRow);
}

/** Senast uppdaterade period som täcker dagen vinner. */
function periodForDate(ymd, periods) {
  let best = null;
  for (const p of periods || []) {
    if (!p.from || !p.to) continue;
    if (ymd < p.from || ymd > p.to) continue;
    if (!best || String(p.updatedAt || "") >= String(best.updatedAt || "")) best = p;
  }
  return best;
}

function resolveDay(ymd, week, periods) {
  const weekday = isoWeekdayFromYmd(ymd);
  const base = normalizeDaySlot(week[String(weekday)] || emptyDaySlot());
  const ex = periodForDate(ymd, periods);
  if (!ex) {
    return {
      date: ymd,
      weekday,
      closed: base.closed,
      open: base.open,
      close: base.close,
      note: "",
      isException: false,
      hostUsername: base.hostUsername,
      exceptionId: ""
    };
  }
  const slot = normalizeDaySlot(ex);
  return {
    date: ymd,
    weekday,
    closed: slot.closed,
    open: slot.open,
    close: slot.close,
    note: clipText(ex.note, 200),
    isException: true,
    hostUsername: slot.hostUsername || base.hostUsername,
    exceptionId: ex.id || ""
  };
}

function buildDays(from, to, week, periods) {
  const days = [];
  let cursor = from;
  let guard = 0;
  while (cursor <= to && guard < 500) {
    days.push(resolveDay(cursor, week, periods));
    cursor = addDaysYmd(cursor, 1);
    guard += 1;
  }
  return days;
}

function hostLookup(users) {
  const map = {};
  for (const u of users || []) {
    const un = String(u.username || "").trim();
    if (!un) continue;
    map[un.toLowerCase()] = {
      username: un,
      name: String(u.name || "").trim() || un,
      active: u.active !== false
    };
  }
  return map;
}

function enrichHost(day, hosts) {
  const un = String(day.hostUsername || "").trim();
  if (!un) {
    return { hostUsername: "", hostName: "" };
  }
  const hit = hosts[un.toLowerCase()];
  return {
    hostUsername: hit ? hit.username : un,
    hostName: hit ? hit.name : un
  };
}

function stripHostsFromWeek(week) {
  const out = {};
  for (let d = 1; d <= 7; d++) {
    out[String(d)] = publicDaySlot(week[String(d)] || emptyDaySlot());
  }
  return out;
}

/** Publik: öppettider utan hallvärd. */
export async function getOpeningHoursPublic(env, opts) {
  const range = resolveRange(opts || {});
  const week = await readWeek(env);
  const periods = await listPeriods(env, range.from, range.to);
  const days = buildDays(range.from, range.to, week, periods).map((d) => ({
    date: d.date,
    weekday: d.weekday,
    weekdayLabel: WEEKDAY_LABELS_SV[d.weekday] || "",
    closed: d.closed,
    open: d.open,
    close: d.close,
    note: d.note,
    isException: d.isException
  }));
  return {
    ok: true,
    today: range.today,
    from: range.from,
    to: range.to,
    week: stripHostsFromWeek(week),
    weekLabels: WEEKDAY_LABELS_SV,
    days
  };
}

/** Inloggad adminvy: inkluderar hallvärd. */
export async function getOpeningHoursAdmin(env, opts, session) {
  if (!canManageOpeningHours(session)) {
    return { ok: false, error: "Saknar behörighet" };
  }
  const range = resolveRange(opts || {});
  const week = await readWeek(env);
  const periods = await listPeriods(env, range.from, range.to);
  const users = await readUsers(env);
  const hosts = hostLookup(users);
  const hostOptions = users
    .filter((u) => u.active !== false)
    .map((u) => ({
      username: u.username,
      name: String(u.name || "").trim() || u.username
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "sv"));

  const days = buildDays(range.from, range.to, week, periods).map((d) => {
    const host = enrichHost(d, hosts);
    return {
      date: d.date,
      weekday: d.weekday,
      weekdayLabel: WEEKDAY_LABELS_SV[d.weekday] || "",
      closed: d.closed,
      open: d.open,
      close: d.close,
      note: d.note,
      isException: d.isException,
      exceptionId: d.exceptionId || "",
      hostUsername: host.hostUsername,
      hostName: host.hostName
    };
  });

  const weekAdmin = {};
  for (let d = 1; d <= 7; d++) {
    const slot = week[String(d)] || emptyDaySlot();
    const host = enrichHost(slot, hosts);
    weekAdmin[String(d)] = {
      closed: slot.closed,
      open: slot.open,
      close: slot.close,
      hostUsername: host.hostUsername,
      hostName: host.hostName
    };
  }

  const exceptionsAdmin = periods
    .slice()
    .sort((a, b) => String(a.from).localeCompare(String(b.from)) || String(a.to).localeCompare(String(b.to)))
    .map((ex) => {
      const host = enrichHost(ex, hosts);
      return {
        id: ex.id,
        from: ex.from,
        to: ex.to,
        date: ex.from,
        closed: ex.closed,
        open: ex.open,
        close: ex.close,
        note: ex.note,
        hostUsername: host.hostUsername,
        hostName: host.hostName,
        updatedAt: ex.updatedAt,
        updatedBy: ex.updatedBy
      };
    });

  return {
    ok: true,
    today: range.today,
    from: range.from,
    to: range.to,
    week: weekAdmin,
    weekLabels: WEEKDAY_LABELS_SV,
    days,
    exceptions: exceptionsAdmin,
    hostOptions,
    canEdit: true
  };
}

export async function saveOpeningHoursWeek(env, payload, session) {
  if (!canManageOpeningHours(session)) {
    return { ok: false, error: "Saknar behörighet" };
  }
  const week = normalizeWeek(payload && (payload.week || payload));
  for (let d = 1; d <= 7; d++) {
    const slot = week[String(d)];
    if (!slot.closed) {
      const start = parseClockMinutes(slot.open);
      const end = parseClockMinutes(slot.close);
      if (start == null || end == null) {
        return { ok: false, error: `${WEEKDAY_LABELS_SV[d]}: ogiltig tid` };
      }
      if (start === end) {
        return { ok: false, error: `${WEEKDAY_LABELS_SV[d]}: start och slut kan inte vara samma` };
      }
    }
    if (slot.hostUsername) {
      const user = await findUser(env, slot.hostUsername);
      if (!user) {
        return { ok: false, error: `${WEEKDAY_LABELS_SV[d]}: okänd hallvärd` };
      }
      slot.hostUsername = user.username;
    }
  }
  await setSetting(env, OPENING_HOURS_WEEK_KEY, JSON.stringify(week));
  return { ok: true, week };
}

/** Lista YYYY-MM-DD från from…to (inklusive), max 366 dagar. */
function enumerateYmdRange(from, to) {
  let a = String(from || "");
  let b = String(to || "");
  if (a > b) {
    const tmp = a;
    a = b;
    b = tmp;
  }
  const out = [];
  let cursor = a;
  let guard = 0;
  while (cursor <= b && guard < 366) {
    out.push(cursor);
    cursor = addDaysYmd(cursor, 1);
    guard += 1;
  }
  if (cursor <= b) return { ok: false, error: "Perioden får vara högst 366 dagar" };
  return { ok: true, dates: out, from: a, to: b };
}

function resolveExceptionDateRange(payload) {
  const single = clipText(payload && payload.date, 10);
  const fromRaw = clipText(payload && (payload.from || payload.dateFrom || payload.startDate), 10) || single;
  const toRaw = clipText(payload && (payload.to || payload.dateTo || payload.endDate), 10) || fromRaw;
  if (!isValidYmd(fromRaw)) return { ok: false, error: "Ogiltigt från-datum" };
  if (!isValidYmd(toRaw)) return { ok: false, error: "Ogiltigt till-datum" };
  return enumerateYmdRange(fromRaw, toRaw);
}

export async function saveOpeningHoursException(env, payload, session) {
  if (!canManageOpeningHours(session)) {
    return { ok: false, error: "Saknar behörighet" };
  }
  await ensurePeriodsMigrated(env);
  const range = resolveExceptionDateRange(payload);
  if (!range.ok) return range;

  const closed = !!(payload && (payload.closed === true || payload.closed === 1 || payload.closed === "1"));
  let open = "";
  let close = "";
  if (!closed) {
    open = normalizeClock(payload && (payload.open || payload.openTime)) || "";
    close = normalizeClock(payload && (payload.close || payload.closeTime)) || "";
    if (!open || !close) return { ok: false, error: "Ange öppettider eller markera stängt" };
    if (open === close) return { ok: false, error: "Start och slut kan inte vara samma" };
  }

  let hostUsername = clipText(payload && (payload.hostUsername || payload.host), 80);
  if (hostUsername) {
    const user = await findUser(env, hostUsername);
    if (!user) return { ok: false, error: "Okänd hallvärd" };
    hostUsername = user.username;
  }

  const note = clipText(payload && payload.note, 200);
  const now = new Date().toISOString();
  const by = clipText(session && session.username, 80);
  const idIn = clipText(payload && payload.id, 80);
  let id = idIn;

  if (id) {
    const existing = await env.DB.prepare(
      "SELECT id FROM opening_hours_exception_periods WHERE id = ?"
    ).bind(id).first();
    if (!existing) return { ok: false, error: "Undantaget hittades inte" };
    await env.DB.prepare(
      `UPDATE opening_hours_exception_periods SET
        from_date = ?, to_date = ?, closed = ?, open_time = ?, close_time = ?,
        note = ?, host_username = ?, updated_at = ?, updated_by = ?
       WHERE id = ?`
    ).bind(
      range.from, range.to, closed ? 1 : 0, open, close, note, hostUsername, now, by, id
    ).run();
  } else {
    id = newPeriodId();
    await env.DB.prepare(
      `INSERT INTO opening_hours_exception_periods
        (id, from_date, to_date, closed, open_time, close_time, note, host_username, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, range.from, range.to, closed ? 1 : 0, open, close, note, hostUsername, now, by
    ).run();
  }

  return {
    ok: true,
    from: range.from,
    to: range.to,
    count: range.dates.length,
    exception: {
      id,
      date: range.from,
      from: range.from,
      to: range.to,
      closed,
      open,
      close,
      note,
      hostUsername,
      updatedAt: now,
      updatedBy: by
    }
  };
}

export async function deleteOpeningHoursException(env, payload, session) {
  if (!canManageOpeningHours(session)) {
    return { ok: false, error: "Saknar behörighet" };
  }
  await ensurePeriodsMigrated(env);
  const raw = typeof payload === "string" ? { id: payload } : (payload || {});
  const id = clipText(raw.id, 80);
  if (id) {
    await env.DB.prepare("DELETE FROM opening_hours_exception_periods WHERE id = ?").bind(id).run();
    return { ok: true, id };
  }
  // Bakåtkompat: radera period med exakt from/to
  const range = resolveExceptionDateRange(raw);
  if (!range.ok) return range;
  await env.DB.prepare(
    "DELETE FROM opening_hours_exception_periods WHERE from_date = ? AND to_date = ?"
  ).bind(range.from, range.to).run();
  return { ok: true, from: range.from, to: range.to };
}
