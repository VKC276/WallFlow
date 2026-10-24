-- Gruppbokningar i hallen (period + tider + kontakt + intern klubbvärd).
--   npx wrangler d1 execute wallflow --remote --file=migrations/0015_group_bookings.sql
--   npx wrangler d1 execute wallflow --local  --file=migrations/0015_group_bookings.sql

CREATE TABLE IF NOT EXISTS group_bookings (
  id TEXT PRIMARY KEY,
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  start_time TEXT NOT NULL DEFAULT '',
  end_time TEXT NOT NULL DEFAULT '',
  group_name TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  club_host TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_group_bookings_from ON group_bookings (from_date);
CREATE INDEX IF NOT EXISTS idx_group_bookings_to ON group_bookings (to_date);
