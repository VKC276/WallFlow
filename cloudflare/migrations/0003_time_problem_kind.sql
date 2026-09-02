-- Tillåt kind = problem (självrapporterade ombyggda problem).
PRAGMA foreign_keys = OFF;

CREATE TABLE time_entries_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL COLLATE NOCASE,
  kind TEXT NOT NULL CHECK (kind IN ('ledbygg', 'hallvard', 'problem')),
  work_date TEXT NOT NULL,
  hours REAL NOT NULL DEFAULT 0,
  start_time TEXT NOT NULL DEFAULT '',
  end_time TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  unit_amount REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

INSERT INTO time_entries_new (
  id, username, kind, work_date, hours, start_time, end_time, description, unit_amount, created_at, created_by
)
SELECT
  id, username, kind, work_date, hours,
  COALESCE(start_time, ''), COALESCE(end_time, ''),
  description, unit_amount, created_at, created_by
FROM time_entries;

DROP TABLE time_entries;
ALTER TABLE time_entries_new RENAME TO time_entries;

CREATE INDEX idx_time_entries_user_date ON time_entries (username, work_date);
CREATE INDEX idx_time_entries_date ON time_entries (work_date);
CREATE INDEX idx_time_entries_kind ON time_entries (kind);

PRAGMA foreign_keys = ON;
