-- Start- och sluttid för ledbyggarrapportering.
-- Kör efter 0001:
--   npx wrangler d1 execute wallflow --remote --file=migrations/0002_time_clock.sql
--   npx wrangler d1 execute wallflow --local  --file=migrations/0002_time_clock.sql

ALTER TABLE time_entries ADD COLUMN start_time TEXT NOT NULL DEFAULT '';
ALTER TABLE time_entries ADD COLUMN end_time TEXT NOT NULL DEFAULT '';
