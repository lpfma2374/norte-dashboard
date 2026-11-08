// Mock local da API HTTP do Cloudflare D1 e do R2 (testes e dev-server, sem credenciais).
// Usa o SQLite nativo do Node (node:sqlite). Cada base é um SQLite em memória com o schema real e dados de exemplo.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const Database = DatabaseSync;
const { DB } = require('../api/_lib');

function seed() {
  const norte = new Database(':memory:');
  norte.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));

  const ls = new Database(':memory:');
  ls.exec(`CREATE TABLE companies (id TEXT PRIMARY KEY, name TEXT, market TEXT, country TEXT, region TEXT, headquarters TEXT,
            revenue_eur_m REAL, revenue_year INTEGER, employee_count INTEGER, website TEXT, linkedin_url TEXT, rank_by_revenue INTEGER, source TEXT);
           CREATE TABLE decision_makers (id TEXT PRIMARY KEY, company_id TEXT, full_name TEXT, linkedin_url TEXT, headline TEXT,
            current_title TEXT, role_category TEXT, seniority TEXT, location TEXT, email TEXT, email_status TEXT);`);
  const ins = ls.prepare('INSERT INTO companies (id,name,market,country,region,headquarters,revenue_eur_m,revenue_year) VALUES (?,?,?,?,?,?,?,?)');
  [['pt-top50-04', 'Sonae', 'Retail', 'Maia', 9947, 2024], ['pt-top50-05', 'Mota-Engil', 'Construction & Real Estate', 'Porto', 5951, 2024],
    ['pt-norte-01', 'Efacec', 'Manufacturing', 'Matosinhos', 300, 2024], ['pt-norte-27', 'ULS Braga', 'Pharma & Healthcare', 'Braga', 390.5, 2024],
    ['pt-top50-20', 'Lactogal', 'Manufacturing', 'Porto', 1131, 2023]]
    .forEach((r) => ins.run(r[0], r[1], r[2], 'Portugal', 'Norte', r[3], r[4], r[5]));
  ins.run('pt-top50-01', 'Galp', 'Utilities & Energy', 'Portugal', 'Área Metropolitana de Lisboa', 'Lisboa', 20000, 2024);
  const dm = ls.prepare('INSERT INTO decision_makers (id,company_id,full_name,linkedin_url,current_title,seniority,email) VALUES (?,?,?,?,?,?,?)');
  dm.run('dm1', 'pt-norte-01', 'Ana Exemplo', 'https://pt.linkedin.com/in/ana-exemplo', 'CIO', 'C-Level', 'ana@exemplo.pt');
  dm.run('dm2', 'pt-norte-01', 'Rui Teste', 'https://www.linkedin.com/in/rui-teste', 'Head of IT', 'Head', null);
  dm.run('dm3', 'pt-top50-04', 'Marta Demo', 'javascript:alert(1)', 'CDO', 'C-Level', null);

  const ps = new Database(':memory:');
  ps.exec(`CREATE TABLE records (id TEXT PRIMARY KEY, scope TEXT, client TEXT NOT NULL, ref TEXT, status TEXT, price REAL, effort REAL,
            total_cost REAL, start_date TEXT, end_date TEXT, description TEXT, created_time TEXT)`);
  const rec = ps.prepare('INSERT INTO records (id,scope,client,ref,status,price,start_date,end_date) VALUES (?,?,?,?,?,?,?,?)');
  rec.run('r1', 'IT Advisory', 'EFACEC', 'Framework DevOps', 'Ganha', 60000, '2025-11-08', '2026-04-04');
  rec.run('r2', 'Proposta', 'EFACEC', 'AMS 3 anos', 'Em negociação', 900000, '2026-09-01', '2026-10-01');
  rec.run('r3', 'Proposta', 'SONAE MC', 'Testing Managed Services', 'Perdida', 400000, '2025-03-01', '2025-04-01');
  rec.run('r4', 'Proposta', 'Worten', 'RFI Sourcing', 'Em qualificação', null, '2026-05-15', null);
  rec.run('r5', 'Paper', 'QMDA', 'Testing Managed Services (Sonae)', 'Entregue', null, '2025-03-04', '2025-03-28');
  rec.run('r6', 'Proposta', 'GALP', 'Integration Platforms', 'Ganha', 515000, '2026-08-07', '2026-08-14');

  const st = new Database(':memory:');
  st.exec(`CREATE TABLE stories (id TEXT PRIMARY KEY, title TEXT, client TEXT, industry TEXT, geo TEXT, serviceType TEXT, bu TEXT, status TEXT,
            date TEXT, techStack TEXT, challenge TEXT, solution TEXT, metrics TEXT, qualitativeResults TEXT, clientQuote TEXT, clientQuoteAuthor TEXT)`);
  st.prepare("INSERT INTO stories VALUES ('s1','Quality Engineering na Sonae','Sonae MC','consumer_goods','europe','managed_services','QMDA','published','2025-01-01','Selenium','Desafio','Solução','[]','[]','','')").run();

  return { [DB.norte()]: norte, [DB.leadseeker()]: ls, [DB.presales()]: ps, [DB.stories()]: st };
}

function install() {
  process.env.CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || 'test-account';
  process.env.CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || 'test-token';
  process.env.R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || 'test-key';
  process.env.R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || 'test-secret';
  const dbs = seed();
  const r2 = new Map();
  const realFetch = global.fetch;
  global.fetch = async (url, init = {}) => {
    const u = String(url);
    const m = u.match(/\/d1\/database\/([^/]+)\/query$/);
    if (m) {
      const db = dbs[m[1]];
      if (!db) return new Response(JSON.stringify({ success: false, errors: [{ message: 'DB desconhecida' }] }));
      const { sql, params } = JSON.parse(init.body);
      try {
        const stmts = sql.split(/;\s*(?=(?:[^']*'[^']*')*[^']*$)/).map((s) => s.trim()).filter(Boolean);
        const result = stmts.map((s) => {
          const st = db.prepare(s);
          const p = (params || []).map((v) => (typeof v === 'boolean' ? Number(v) : v === undefined ? null : v));
          return { results: st.columns().length ? st.all(...p) : (st.run(...p), []), success: true };
        });
        return new Response(JSON.stringify({ success: true, result }));
      } catch (e) {
        return new Response(JSON.stringify({ success: false, errors: [{ message: e.message }] }));
      }
    }
    if (/r2\.cloudflarestorage\.com/.test(u)) {
      const key = decodeURIComponent(new URL(u).pathname.split('/').slice(2).join('/'));
      if (init.method === 'PUT') { r2.set(key, init.body); return new Response('', { status: 200 }); }
      if (init.method === 'DELETE') { r2.delete(key); return new Response('', { status: 204 }); }
    }
    return realFetch(url, init);
  };
  return { dbs, r2 };
}

module.exports = { install };
