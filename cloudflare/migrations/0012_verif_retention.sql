-- Autorensning av skickade utläggs-/klubbkortsunderlag (dagar). 0 = av.
--   npx wrangler d1 execute wallflow --remote --file=migrations/0012_verif_retention.sql
--   npx wrangler d1 execute wallflow --local  --file=migrations/0012_verif_retention.sql

INSERT INTO settings (key, value)
VALUES ('verifRetentionDays', '90')
ON CONFLICT(key) DO NOTHING;
