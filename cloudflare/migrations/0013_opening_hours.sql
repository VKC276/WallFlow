-- Öppettider: undantag per datum (+ veckostandard i settings).
--   npx wrangler d1 execute wallflow --remote --file=migrations/0013_opening_hours.sql
--   npx wrangler d1 execute wallflow --local  --file=migrations/0013_opening_hours.sql

CREATE TABLE IF NOT EXISTS opening_hours_exceptions (
  date TEXT PRIMARY KEY,
  closed INTEGER NOT NULL DEFAULT 0 CHECK (closed IN (0, 1)),
  open_time TEXT NOT NULL DEFAULT '',
  close_time TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  host_username TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_opening_hours_exceptions_date
  ON opening_hours_exceptions (date);

INSERT INTO settings (key, value)
VALUES (
  'openingHoursWeek',
  '{"1":{"closed":false,"open":"16:00","close":"21:00","hostUsername":""},"2":{"closed":false,"open":"16:00","close":"21:00","hostUsername":""},"3":{"closed":false,"open":"16:00","close":"21:00","hostUsername":""},"4":{"closed":false,"open":"16:00","close":"21:00","hostUsername":""},"5":{"closed":false,"open":"16:00","close":"22:00","hostUsername":""},"6":{"closed":false,"open":"10:00","close":"18:00","hostUsername":""},"7":{"closed":false,"open":"10:00","close":"16:00","hostUsername":""}}'
)
ON CONFLICT(key) DO NOTHING;
