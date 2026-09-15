-- Friskvårdskvitto: utfärdade kvitton med digital underskrift och PDF-nyckel.
--   npx wrangler d1 execute wallflow --remote --file=migrations/0006_friskvard.sql
--   npx wrangler d1 execute wallflow --local  --file=migrations/0006_friskvard.sql

CREATE TABLE IF NOT EXISTS wellness_receipts (
  id TEXT PRIMARY KEY,
  receipt_no TEXT NOT NULL UNIQUE,
  issued_at TEXT NOT NULL,
  purchase_date TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  recipient_email TEXT NOT NULL DEFAULT '',
  recipient_idnr TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  period TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL,
  issuer_username TEXT NOT NULL,
  issuer_name TEXT NOT NULL,
  signed_at TEXT NOT NULL,
  pdf_key TEXT NOT NULL DEFAULT '',
  emailed_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_wellness_issued ON wellness_receipts (issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_wellness_receipt_no ON wellness_receipts (receipt_no);
