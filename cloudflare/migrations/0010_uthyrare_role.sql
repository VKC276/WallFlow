-- Primärrollen uthyrare. SQLite kan inte ändra en CHECK, så users byggs om.
-- Kräver att 0008_user_active.sql redan är körd (kolumnen active).
--   npx wrangler d1 execute wallflow --remote --file=migrations/0010_uthyrare_role.sql
--   npx wrangler d1 execute wallflow --local  --file=migrations/0010_uthyrare_role.sql

PRAGMA foreign_keys = OFF;

CREATE TABLE users_uthyrare (
  username TEXT PRIMARY KEY COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('superadmin', 'admin', 'scout', 'kassor', 'hallvard', 'uthyrare')),
  extra_roles TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  first_login INTEGER NOT NULL DEFAULT 1 CHECK (first_login IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

INSERT INTO users_uthyrare (username, password_hash, salt, role, extra_roles, name, email, first_login, active)
SELECT username, password_hash, salt, role, extra_roles, name, email, first_login, active FROM users;

DROP TABLE users;
ALTER TABLE users_uthyrare RENAME TO users;

CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email COLLATE NOCASE) WHERE email != '';

PRAGMA foreign_keys = ON;
