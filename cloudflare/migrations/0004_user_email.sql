-- E-post som inloggningsalias + välkomst-/återställningsmejl.
--   npx wrangler d1 execute wallflow --remote --file=migrations/0004_user_email.sql
--   npx wrangler d1 execute wallflow --local  --file=migrations/0004_user_email.sql

ALTER TABLE users ADD COLUMN email TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email
  ON users (email COLLATE NOCASE)
  WHERE email != '';
