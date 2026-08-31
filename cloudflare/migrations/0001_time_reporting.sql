-- Tidrapportering + extra roller (kassör, hallvärd).
-- Kör mot befintlig D1 (behåller leder/användare):
--   npx wrangler d1 execute wallflow --remote --file=migrations/0001_time_reporting.sql
--   npx wrangler d1 execute wallflow --local  --file=migrations/0001_time_reporting.sql
-- Idempotent nog för en omkörning av time_entries/settings; users-rebuild körs alltid.

PRAGMA foreign_keys = OFF;

CREATE TABLE users_new (
  username TEXT PRIMARY KEY COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('superadmin', 'admin', 'scout', 'kassor', 'hallvard')),
  extra_roles TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  first_login INTEGER NOT NULL DEFAULT 1 CHECK (first_login IN (0, 1))
);

INSERT INTO users_new (username, password_hash, salt, role, extra_roles, name, first_login)
SELECT username, password_hash, salt, role, '', name, first_login
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

CREATE TABLE IF NOT EXISTS time_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL COLLATE NOCASE,
  kind TEXT NOT NULL CHECK (kind IN ('ledbygg', 'hallvard')),
  work_date TEXT NOT NULL,
  hours REAL NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  unit_amount REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_time_entries_user_date ON time_entries (username, work_date);
CREATE INDEX IF NOT EXISTS idx_time_entries_date ON time_entries (work_date);
CREATE INDEX IF NOT EXISTS idx_time_entries_kind ON time_entries (kind);

INSERT OR IGNORE INTO settings (key, value) VALUES ('timeLedbyggHourlyRate', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('timeMinPayout', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('timeHallvardShiftAmount', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('timeMaxYearAmount', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('timeWarningYearAmount', '0');

PRAGMA foreign_keys = ON;
