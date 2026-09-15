-- Föreningsuppgifter och gallringstid för friskvårdskvitto.
--   npx wrangler d1 execute wallflow --remote --file=migrations/0007_wellness_org.sql
--   npx wrangler d1 execute wallflow --local  --file=migrations/0007_wellness_org.sql

INSERT INTO settings (key, value) VALUES ('wellnessOrgName', 'Västerviks klätterklubb')
ON CONFLICT(key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('wellnessOrgNr', '802431-5718')
ON CONFLICT(key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('wellnessOrgStreet', '')
ON CONFLICT(key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('wellnessOrgPostal', '')
ON CONFLICT(key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('wellnessOrgCity', 'Västervik')
ON CONFLICT(key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('wellnessOrgLegal', 'Ideell förening som inte är momsregistrerad')
ON CONFLICT(key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('wellnessOrgVat', 'Moms utgår inte. Beloppet avser 0 kr moms.')
ON CONFLICT(key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('wellnessRetentionDays', '90')
ON CONFLICT(key) DO NOTHING;
