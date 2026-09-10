-- Verifikationer / utlägg: e-post dit användaren uppmanas skicka PDF:en.
--   npx wrangler d1 execute wallflow --remote --file=migrations/0005_verif.sql
--   npx wrangler d1 execute wallflow --local  --file=migrations/0005_verif.sql

INSERT INTO settings (key, value)
VALUES ('verifArchiveEmail', 'inbox.ver.1624638@arkivplats.se')
ON CONFLICT(key) DO NOTHING;
