-- Inaktiva konton tills superadmin klickar Aktivera användare.
--   npx wrangler d1 execute wallflow --remote --file=migrations/0008_user_active.sql
--   npx wrangler d1 execute wallflow --local  --file=migrations/0008_user_active.sql

ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
