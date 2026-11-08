-- Norte Dashboard — schema da base Cloudflare D1 "norte-dashboard-db"
-- As empresas e os decisores vivem na leadseeker-db (tabelas companies / decision_makers, region = 'Norte');
-- as propostas vivem na presales-db (tabela records, app PACE). Aqui fica só a gestão de conta.

CREATE TABLE IF NOT EXISTS accounts (
  company_id TEXT PRIMARY KEY,           -- companies.id na leadseeker-db
  owner TEXT, tier TEXT,
  baseline_volume_eur REAL,              -- situação inicial (negócio anual à entrada no dashboard) → NRR
  baseline_year INTEGER, baseline_notes TEXT,
  target_eur REAL,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT
);

CREATE TABLE IF NOT EXISTS contacts (     -- registo de contacto no formato de ata de reunião
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL,
  title TEXT NOT NULL, contact_date TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('presencial','videochamada','email','telefone')),
  attendees TEXT,
  agenda_json TEXT,                      -- [{ point, notes }]
  decisions TEXT, next_steps TEXT,
  attachments_json TEXT,                 -- [{ key, name, size, type }] → objetos no R2 (bucket norte-docs)
  created_by TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id, contact_date DESC);

CREATE TABLE IF NOT EXISTS deals (        -- negócio efetivo (vendas)
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL,
  ref TEXT NOT NULL, amount_eur REAL NOT NULL, close_date TEXT NOT NULL,
  source TEXT DEFAULT 'manual',          -- manual | pipeline
  pipeline_record_id TEXT UNIQUE,        -- records.id na presales-db quando convertida do PACE
  notes TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_deals_company ON deals(company_id, close_date);

CREATE TABLE IF NOT EXISTS account_plans (
  company_id TEXT PRIMARY KEY,
  ambition TEXT, objectives TEXT, priorities TEXT, target_offers TEXT, whitespace TEXT,
  initiatives TEXT, risks TEXT, next_review TEXT,
  status TEXT DEFAULT 'rascunho', updated_at TEXT
);

CREATE TABLE IF NOT EXISTS satisfaction (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL, survey_date TEXT NOT NULL,
  method TEXT, respondent TEXT,
  nps_score INTEGER CHECK (nps_score BETWEEN 0 AND 10),
  csat_score INTEGER CHECK (csat_score BETWEEN 1 AND 5),
  comment TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sat_company ON satisfaction(company_id, survey_date);

CREATE TABLE IF NOT EXISTS pipeline_links (  -- associação manual proposta PACE ↔ empresa ('__none__' = desassociada)
  record_id TEXT PRIMARY KEY, company_id TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime('now')));
INSERT OR IGNORE INTO settings (key, value) VALUES ('sales_target_year', '2026'), ('sales_target_eur', NULL);
