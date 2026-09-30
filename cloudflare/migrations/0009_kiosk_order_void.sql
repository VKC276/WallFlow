-- Tidigare mjukmakulering (voided/voided_at). Kolumnerna behålls ofarligt om de redan finns.
-- Makulering raderar köpet permanent i API:t; eventuella voided=1 rensas vid listning.
--   npx wrangler d1 execute wallflow --remote --file=migrations/0009_kiosk_order_void.sql

ALTER TABLE kiosk_orders ADD COLUMN voided INTEGER NOT NULL DEFAULT 0;
ALTER TABLE kiosk_orders ADD COLUMN voided_at TEXT;
