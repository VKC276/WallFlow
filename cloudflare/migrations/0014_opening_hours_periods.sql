-- Öppettidsundantag som perioder (kan överlappa; senaste vinner per dag i kalendern).
--   npx wrangler d1 execute wallflow --remote --file=migrations/0014_opening_hours_periods.sql
--   npx wrangler d1 execute wallflow --local  --file=migrations/0014_opening_hours_periods.sql

CREATE TABLE IF NOT EXISTS opening_hours_exception_periods (
  id TEXT PRIMARY KEY,
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  closed INTEGER NOT NULL DEFAULT 0 CHECK (closed IN (0, 1)),
  open_time TEXT NOT NULL DEFAULT '',
  close_time TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  host_username TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_oh_ex_periods_from ON opening_hours_exception_periods (from_date);
CREATE INDEX IF NOT EXISTS idx_oh_ex_periods_to ON opening_hours_exception_periods (to_date);
