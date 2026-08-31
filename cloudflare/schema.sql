-- WallFlow D1 schema (Cloudflare)
-- Idempotent: drop + create. Kör mot en tom eller utbytbar databas.
-- wrangler d1 execute wallflow --remote --file=schema.sql

PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS time_entries;
DROP TABLE IF EXISTS routes;
DROP TABLE IF EXISTS grades;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS settings;

CREATE TABLE routes (
  nr TEXT PRIMARY KEY,
  gradering TEXT NOT NULL DEFAULT 'Ej uppsatt',
  ledbyggare TEXT NOT NULL DEFAULT '',
  byggdatum TEXT NOT NULL DEFAULT '',
  anteckningar TEXT NOT NULL DEFAULT '',
  bild_key TEXT NOT NULL DEFAULT '',
  livslangd INTEGER NOT NULL DEFAULT 30
);

CREATE TABLE grades (
  namn TEXT PRIMARY KEY,
  sort_order INTEGER NOT NULL
);

CREATE TABLE users (
  username TEXT PRIMARY KEY COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('superadmin', 'admin', 'scout', 'kassor', 'hallvard')),
  extra_roles TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  first_login INTEGER NOT NULL DEFAULT 1 CHECK (first_login IN (0, 1))
);

CREATE TABLE time_entries (
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

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX idx_routes_gradering ON routes (gradering);
CREATE INDEX idx_grades_order ON grades (sort_order);
CREATE INDEX idx_users_role ON users (role);
CREATE INDEX idx_time_entries_user_date ON time_entries (username, work_date);
CREATE INDEX idx_time_entries_date ON time_entries (work_date);
CREATE INDEX idx_time_entries_kind ON time_entries (kind);

INSERT INTO settings (key, value) VALUES ('timeLedbyggHourlyRate', '0');
INSERT INTO settings (key, value) VALUES ('timeMinPayout', '0');
INSERT INTO settings (key, value) VALUES ('timeHallvardShiftAmount', '0');
INSERT INTO settings (key, value) VALUES ('timeMaxYearAmount', '0');
INSERT INTO settings (key, value) VALUES ('timeWarningYearAmount', '0');
