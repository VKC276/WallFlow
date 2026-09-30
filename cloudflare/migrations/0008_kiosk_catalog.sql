-- Kiosk-katalog: produkter, en revisionsrad och kassaköp.
--   npx wrangler d1 execute wallflow --remote --file=migrations/0008_kiosk_catalog.sql
--   npx wrangler d1 execute wallflow --local  --file=migrations/0008_kiosk_catalog.sql

CREATE TABLE IF NOT EXISTS catalog_revision (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT ''
);

INSERT INTO catalog_revision (id, revision, updated_at)
VALUES (1, 1, datetime('now'))
ON CONFLICT(id) DO NOTHING;

CREATE TABLE IF NOT EXISTS kiosk_products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price REAL NOT NULL,
  category TEXT NOT NULL DEFAULT 'Övrigt',
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  featured INTEGER NOT NULL DEFAULT 0,
  image_key TEXT NOT NULL DEFAULT '',
  image_hash TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS kiosk_orders (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  amount REAL NOT NULL,
  message TEXT NOT NULL,
  items_json TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES ('kioskShopName', 'Klätterhallen')
ON CONFLICT(key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('kioskSwishNumber', '')
ON CONFLICT(key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('kioskTheme', 'light')
ON CONFLICT(key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('kioskLogoKey', '')
ON CONFLICT(key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('kioskLogoHash', '')
ON CONFLICT(key) DO NOTHING;
INSERT INTO settings (key, value) VALUES (
  'kioskCategories',
  '["Entre","Hyra","Dryck","Snacks","Utrustning","Övrigt"]'
)
ON CONFLICT(key) DO NOTHING;
