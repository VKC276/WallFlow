/** Gruppbokningar: perioder i hallen med kontaktinfo och intern klubbvärd. */

import { canManageOpeningHours } from "./auth.js";
import { findUser, readUsers, todayStockholm } from "./db.js";
import { formatClockHm, isValidYmd, parseClockMinutes } from "./time.js";

export { canManageOpeningHours as canManageGroupBookings };

function clipText(raw, max) {
  return String(raw == null ? "" : raw).trim().slice(0, max);
}

function normalizeClock(raw) {
  const min = parseClockMinutes(raw);
  if (min == null) return null;
  return formatClockHm(min);
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
  let span = 0;
  let cursor = from;
  while (cursor < to && span < 450) {
    cursor = addDaysYmd(cursor, 1);
    span += 1;
  }
  if (span >= 450) to = cursor;
  return { from, to, today };
}

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

function newBookingId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "gb_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
}

function mapBookingRow(row) {
  return {
    id: String(row.id || "").trim(),
    from: String(row.from_date || "").trim(),
    to: String(row.to_date || "").trim(),
    startTime: String(row.start_time || "").trim(),
    endTime: String(row.end_time || "").trim(),
    groupName: String(row.group_name || "").trim(),
    contactName: String(row.contact_name || "").trim(),
    contactEmail: String(row.contact_email || "").trim(),
    contactPhone: String(row.contact_phone || "").trim(),
    clubHost: String(row.club_host || "").trim(),
    note: String(row.note || "").trim(),
    updatedAt: String(row.updated_at || "").trim(),
    updatedBy: String(row.updated_by || "").trim()
  };
}

async function listBookings(env, from, to) {
  const { results } = await env.DB.prepare(
    `SELECT id, from_date, to_date, start_time, end_time, group_name, contact_name,
            contact_email, contact_phone, club_host, note, updated_at, updated_by
     FROM group_bookings
     WHERE from_date <= ? AND to_date >= ?
     ORDER BY from_date ASC, start_time ASC, updated_at ASC`
  ).bind(to, from).all();
  return (results || []).map(mapBookingRow);
}

function bookingsForDate(ymd, bookings) {
  return (bookings || []).filter((b) => b.from && b.to && ymd >= b.from && ymd <= b.to);
}

function formatHoursLabel(b) {
  if (!b || !b.startTime || !b.endTime) return "";
  return String(b.startTime) + "–" + String(b.endTime);
}

function buildDays(from, to, bookings, { includePrivate }) {
  const days = [];
  let cursor = from;
  let guard = 0;
  while (cursor <= to && guard < 500) {
    const list = bookingsForDate(cursor, bookings).map((b) => {
      const item = {
        id: b.id,
        startTime: b.startTime,
        endTime: b.endTime,
        hoursLabel: formatHoursLabel(b),
        groupName: b.groupName,
        note: b.note
      };
      if (includePrivate) {
        item.contactName = b.contactName;
        item.contactEmail = b.contactEmail;
        item.contactPhone = b.contactPhone;
        item.clubHost = b.clubHost;
      }
      return item;
    });
    days.push({
      date: cursor,
      bookings: list,
      hasBookings: list.length > 0
    });
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
      name: String(u.name || "").trim() || un
    };
  }
  return map;
}

function enrichClubHost(username, hosts) {
  const un = String(username || "").trim();
  if (!un) return { clubHost: "", clubHostName: "" };
  const hit = hosts[un.toLowerCase()];
  return {
    clubHost: hit ? hit.username : un,
    clubHostName: hit ? hit.name : un
  };
}

/** Publik kalender: tider + gruppnamn, ingen kontakt/värd. */
export async function getGroupBookingsPublic(env, opts) {
  const range = resolveRange(opts || {});
  const bookings = await listBookings(env, range.from, range.to);
  const days = buildDays(range.from, range.to, bookings, { includePrivate: false });
  const publicList = bookings.map((b) => ({
    id: b.id,
    from: b.from,
    to: b.to,
    startTime: b.startTime,
    endTime: b.endTime,
    hoursLabel: formatHoursLabel(b),
    groupName: b.groupName,
    note: b.note
  }));
  return {
    ok: true,
    today: range.today,
    from: range.from,
    to: range.to,
    days,
    bookings: publicList
  };
}

/** Admin: full info inkl. kontakt och klubbvärd. */
export async function getGroupBookingsAdmin(env, opts, session) {
  if (!canManageOpeningHours(session)) {
    return { ok: false, error: "Saknar behörighet" };
  }
  const range = resolveRange(opts || {});
  const bookings = await listBookings(env, range.from, range.to);
  const users = await readUsers(env);
  const hosts = hostLookup(users);
  const hostOptions = users
    .filter((u) => u.active !== false)
    .map((u) => ({
      username: u.username,
      name: String(u.name || "").trim() || u.username
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "sv"));

  const days = buildDays(range.from, range.to, bookings, { includePrivate: true }).map((d) => ({
    ...d,
    bookings: d.bookings.map((b) => {
      const host = enrichClubHost(b.clubHost, hosts);
      return { ...b, clubHost: host.clubHost, clubHostName: host.clubHostName };
    })
  }));

  const adminList = bookings.map((b) => {
    const host = enrichClubHost(b.clubHost, hosts);
    return {
      ...b,
      hoursLabel: formatHoursLabel(b),
      clubHost: host.clubHost,
      clubHostName: host.clubHostName
    };
  });

  return {
    ok: true,
    today: range.today,
    from: range.from,
    to: range.to,
    days,
    bookings: adminList,
    hostOptions,
    canEdit: true
  };
}

export async function saveGroupBooking(env, payload, session) {
  if (!canManageOpeningHours(session)) {
    return { ok: false, error: "Saknar behörighet" };
  }
  let from = clipText(payload && (payload.from || payload.dateFrom || payload.date), 10);
  let to = clipText(payload && (payload.to || payload.dateTo), 10) || from;
  if (!isValidYmd(from)) return { ok: false, error: "Ogiltigt från-datum" };
  if (!isValidYmd(to)) return { ok: false, error: "Ogiltigt till-datum" };
  const range = enumerateYmdRange(from, to);
  if (!range.ok) return range;
  from = range.from;
  to = range.to;

  const startTime = normalizeClock(payload && (payload.startTime || payload.open || payload.start));
  const endTime = normalizeClock(payload && (payload.endTime || payload.close || payload.end));
  if (!startTime || !endTime) return { ok: false, error: "Ange start- och sluttid" };
  if (startTime === endTime) return { ok: false, error: "Start och slut kan inte vara samma" };

  const groupName = clipText(payload && (payload.groupName || payload.group), 120);
  if (!groupName) return { ok: false, error: "Ange gruppnamn" };

  const contactName = clipText(payload && (payload.contactName || payload.contact), 120);
  const contactEmail = clipText(payload && (payload.contactEmail || payload.email), 120).toLowerCase();
  const contactPhone = clipText(payload && (payload.contactPhone || payload.phone), 40);
  let clubHost = clipText(payload && (payload.clubHost || payload.host), 80);
  if (clubHost) {
    const user = await findUser(env, clubHost);
    if (user) clubHost = user.username;
  }
  const note = clipText(payload && payload.note, 200);
  const now = new Date().toISOString();
  const by = clipText(session && session.username, 80);
  const idIn = clipText(payload && payload.id, 80);
  let id = idIn;

  if (id) {
    const existing = await env.DB.prepare("SELECT id FROM group_bookings WHERE id = ?").bind(id).first();
    if (!existing) return { ok: false, error: "Bokningen hittades inte" };
    await env.DB.prepare(
      `UPDATE group_bookings SET
        from_date = ?, to_date = ?, start_time = ?, end_time = ?,
        group_name = ?, contact_name = ?, contact_email = ?, contact_phone = ?,
        club_host = ?, note = ?, updated_at = ?, updated_by = ?
       WHERE id = ?`
    ).bind(
      from, to, startTime, endTime,
      groupName, contactName, contactEmail, contactPhone,
      clubHost, note, now, by, id
    ).run();
  } else {
    id = newBookingId();
    await env.DB.prepare(
      `INSERT INTO group_bookings
        (id, from_date, to_date, start_time, end_time, group_name, contact_name,
         contact_email, contact_phone, club_host, note, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, from, to, startTime, endTime, groupName, contactName,
      contactEmail, contactPhone, clubHost, note, now, by
    ).run();
  }

  return {
    ok: true,
    booking: {
      id,
      from,
      to,
      startTime,
      endTime,
      groupName,
      contactName,
      contactEmail,
      contactPhone,
      clubHost,
      note,
      updatedAt: now,
      updatedBy: by
    }
  };
}

export async function deleteGroupBooking(env, payload, session) {
  if (!canManageOpeningHours(session)) {
    return { ok: false, error: "Saknar behörighet" };
  }
  const id = clipText(
    typeof payload === "string" ? payload : (payload && payload.id),
    80
  );
  if (!id) return { ok: false, error: "Saknar boknings-id" };
  await env.DB.prepare("DELETE FROM group_bookings WHERE id = ?").bind(id).run();
  return { ok: true, id };
}
