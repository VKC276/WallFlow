-- WallFlow D1 schema (Cloudflare)
-- Idempotent: drop + create. Kör mot en tom eller utbytbar databas.
-- wrangler d1 execute wallflow --remote --file=schema.sql

PRAGMA foreign_keys = ON;

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
  role TEXT NOT NULL CHECK (role IN ('superadmin', 'admin', 'scout')),
  name TEXT NOT NULL DEFAULT '',
  first_login INTEGER NOT NULL DEFAULT 1 CHECK (first_login IN (0, 1))
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX idx_routes_gradering ON routes (gradering);
CREATE INDEX idx_grades_order ON grades (sort_order);
CREATE INDEX idx_users_role ON users (role);
