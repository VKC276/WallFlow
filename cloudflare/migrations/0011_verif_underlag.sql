-- Underlag för utlägg och klubbkort, så kassör kan granska och skicka till bokföringen.
--   npx wrangler d1 execute wallflow --remote --file=migrations/0011_verif_underlag.sql
--   npx wrangler d1 execute wallflow --local  --file=migrations/0011_verif_underlag.sql

CREATE TABLE IF NOT EXISTS verif_underlag (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('payout', 'club-card')),
  pdf_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  created_at TEXT NOT NULL,
  purchase_date TEXT NOT NULL,
  member_name TEXT NOT NULL,
  member_address TEXT NOT NULL DEFAULT '',
  purchaser TEXT NOT NULL DEFAULT '',
  bank TEXT NOT NULL DEFAULT '',
  clearing TEXT NOT NULL DEFAULT '',
  account TEXT NOT NULL DEFAULT '',
  submitter_username TEXT NOT NULL DEFAULT '',
  submitter_name TEXT NOT NULL DEFAULT '',
  total REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent')),
  reviewed_at TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_verif_underlag_status ON verif_underlag (status, created_at);
