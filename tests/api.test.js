// Testes de integração das Vercel Functions contra o mock D1/R2 em memória.
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';
import { Readable } from 'stream';
const require = createRequire(import.meta.url);
const mock = require('../scripts/mock-d1.js');
let ctx;

function call(name, method, url, body) {
  const handler = require('../api/' + name + '.js');
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = method; req.url = url; req.headers = {};
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      end(b) { resolve({ status: this.statusCode, headers: this.headers, body: b ? JSON.parse(b) : null }); },
    };
    handler(req, res);
  });
}

beforeAll(() => { ctx = mock.install(); });

describe('dashboard', () => {
  it('lista só empresas do Norte, ordenadas por volume, com ranking regional', async () => {
    const r = await call('dashboard', 'GET', '/api/dashboard');
    expect(r.status).toBe(200);
    const names = r.body.companies.map((c) => c.name);
    expect(names).not.toContain('Galp');
    expect(names[0]).toBe('Sonae');
    expect(r.body.companies.map((c) => c.region_rank)).toEqual([1, 2, 3, 4, 5]);
  });
  it('associa propostas do PACE pelo nome e calcula o pipeline (exclui papers)', async () => {
    const r = await call('dashboard', 'GET', '/api/dashboard');
    const efacec = r.body.companies.find((c) => c.name === 'Efacec');
    expect(efacec.pipeline_open).toBe(1);
    expect(efacec.pipeline_open_eur).toBe(900000);
    expect(efacec.pipeline_total).toBe(2);
    const k = r.body.kpis;
    expect(k.pipeline).toEqual({ count: 1, value_eur: 900000 });
    expect(k.conversions.won).toBe(1);          // Efacec ganha; Galp (Lisboa) não conta
    expect(k.conversions.lost).toBe(1);         // Sonae MC perdida
    expect(k.conversions.win_rate).toBe(50);
  });
});

describe('contactos', () => {
  let id;
  it('valida campos obrigatórios e canal', async () => {
    const r = await call('contacts', 'POST', '/api/contacts', { company_id: 'pt-norte-01', title: 'X', contact_date: '2026-11-01', channel: 'fax' });
    expect(r.status).toBe(400);
    const r2 = await call('contacts', 'POST', '/api/contacts', { company_id: 'pt-top50-01', title: 'X', contact_date: '2026-11-01', channel: 'email' });
    expect(r2.status).toBe(400); // Galp não é do Norte
  });
  it('cria, lista (mais recente primeiro), lê, edita e apaga', async () => {
    const a = await call('contacts', 'POST', '/api/contacts', {
      company_id: 'pt-norte-01', title: 'Kick-off', contact_date: '2026-10-01', channel: 'presencial',
      attendees: 'Ana Exemplo (CIO)', agenda: [{ point: 'Contexto', notes: 'Falou-se do roadmap' }, { point: '', notes: '' }],
      decisions: 'Avançar com diagnóstico', next_steps: 'Enviar proposta',
      attachments: [{ key: 'contacts/pt-norte-01/abc/ata.pdf', name: 'ata.pdf', size: 10 }, { key: '../evil', name: 'x' }],
    });
    expect(a.status).toBe(201);
    id = a.body.id;
    await call('contacts', 'POST', '/api/contacts', { company_id: 'pt-norte-01', title: 'Follow-up', contact_date: '2026-11-05', channel: 'email' });
    const l = await call('contacts', 'GET', '/api/contacts?company_id=pt-norte-01');
    expect(l.body.contacts.map((c) => c.title)).toEqual(['Follow-up', 'Kick-off']);
    const d = await call('contacts', 'GET', '/api/contacts?id=' + id);
    expect(d.body.contact.agenda).toEqual([{ point: 'Contexto', notes: 'Falou-se do roadmap' }]);
    expect(d.body.contact.attachments.map((x) => x.key)).toEqual(['contacts/pt-norte-01/abc/ata.pdf']);
    const u = await call('contacts', 'PUT', '/api/contacts?id=' + id, { title: 'Kick-off (rev.)', contact_date: '2026-10-01', channel: 'videochamada' });
    expect(u.status).toBe(200);
    const dash = await call('dashboard', 'GET', '/api/dashboard');
    const ef = dash.body.companies.find((c) => c.id === 'pt-norte-01');
    expect(ef.n_contacts).toBe(2);
    expect(ef.last_contact).toBe('2026-11-05');
    const del = await call('contacts', 'DELETE', '/api/contacts?id=' + id);
    expect(del.status).toBe(200);
  });
});

describe('ficha de conta e KPIs', () => {
  const Y = new Date().getFullYear();
  it('sem planos, o target usa o target global e as vendas do ano', async () => {
    await call('settings', 'PUT', '/api/settings', { sales_target_year: Y, sales_target_eur: 1000000 });
    const d1 = await call('account', 'POST', '/api/account?company_id=pt-norte-01', { kind: 'deal', ref: 'Contrato AMS', amount_eur: '150 000', close_date: Y + '-06-30' });
    expect(d1.status).toBe(201);
    const bad = await call('account', 'POST', '/api/account?company_id=pt-norte-01', { kind: 'deal', ref: 'x', amount_eur: -5, close_date: Y + '-06-30' });
    expect(bad.status).toBe(400);
    const k = (await call('dashboard', 'GET', '/api/dashboard')).body.kpis;
    expect(k.target.source).toBe('vendas');
    expect(k.target.pct).toBeCloseTo(15);
    expect(k.nrr.pct).toBeNull();
  });
  it('valida o plano estratégico (estado, volumes e satisfação 0 a 10)', async () => {
    expect((await call('account', 'PUT', '/api/account?company_id=pt-norte-01', { section: 'plan', status: 'xpto' })).status).toBe(400);
    expect((await call('account', 'PUT', '/api/account?company_id=pt-norte-01', { section: 'plan', target_volume_eur: -1 })).status).toBe(400);
    expect((await call('account', 'PUT', '/api/account?company_id=pt-norte-01', { section: 'plan', sat_target: 11 })).status).toBe(400);
  });
  it('cria e atualiza o plano do ano (um por empresa e ano) e calcula target, NRR e satisfação', async () => {
    const r = await call('account', 'PUT', '/api/account?company_id=pt-norte-01', {
      section: 'plan', plan_year: Y, record_date: Y + '-11-08', status: 'em curso',
      initial_volume_eur: '100000', current_volume_eur: '120000', target_volume_eur: '200000',
      sat_initial: 6.5, sat_target: 8, sat_current: 7, ambition: 'Parceiro de referência',
    });
    expect(r.status).toBe(200);
    await call('account', 'PUT', '/api/account?company_id=pt-top50-04', {
      section: 'plan', plan_year: Y, initial_volume_eur: 300000, current_volume_eur: 240000, target_volume_eur: 400000, sat_current: 9, sat_target: 9,
    });
    // atualização do mesmo ano não duplica
    await call('account', 'PUT', '/api/account?company_id=pt-norte-01', {
      section: 'plan', plan_year: Y, record_date: Y + '-11-08', status: 'em curso',
      initial_volume_eur: 100000, current_volume_eur: 130000, target_volume_eur: 200000, sat_initial: 6.5, sat_target: 8, sat_current: 7,
    });
    await call('account', 'PUT', '/api/account?company_id=pt-norte-01', { section: 'plan', plan_year: Y - 1, current_volume_eur: 100000 });
    const g = await call('account', 'GET', '/api/account?company_id=pt-norte-01');
    expect(g.body.plans.map((p) => p.plan_year)).toEqual([Y, Y - 1]);
    expect(g.body.plan.current_volume_eur).toBe(130000);
    expect(g.body.plan.ambition).toBeNull();

    const d = (await call('dashboard', 'GET', '/api/dashboard')).body;
    const ef = d.companies.find((c) => c.id === 'pt-norte-01');
    expect(ef.plan.evolution_pct).toBeCloseTo(30);
    expect(ef.plan.deviation_pct).toBeCloseTo(-35);
    const k = d.kpis;
    expect(k.target.source).toBe('planos');
    expect(k.target.pct).toBeCloseTo((130000 + 240000) / (200000 + 400000) * 100);
    expect(k.nrr.pct).toBeCloseTo((130000 + 240000) / (100000 + 300000) * 100);
    expect(k.satisfaction.plan.current).toBeCloseTo(8);
    expect(k.satisfaction.plan.accounts).toBe(2);
  });
  it('regista avaliações de satisfação (NPS/CSAT)', async () => {
    await call('account', 'POST', '/api/account?company_id=pt-norte-01', { kind: 'survey', survey_date: new Date().toISOString().slice(0, 10), nps_score: 9, csat_score: 5 });
    await call('account', 'POST', '/api/account?company_id=pt-top50-04', { kind: 'survey', survey_date: new Date().toISOString().slice(0, 10), nps_score: 5 });
    expect((await call('account', 'POST', '/api/account?company_id=pt-top50-04', { kind: 'survey', survey_date: '2026-01-01', nps_score: 11 })).status).toBe(400);
    const k = (await call('dashboard', 'GET', '/api/dashboard')).body.kpis;
    expect(k.satisfaction.nps).toBe(0);
    expect(k.satisfaction.csat).toBe(5);
  });
  it('elimina um plano', async () => {
    const g = await call('account', 'GET', '/api/account?company_id=pt-norte-01');
    const old = g.body.plans.find((p) => p.plan_year === Y - 1);
    await call('account', 'DELETE', '/api/account?company_id=pt-norte-01&plan=' + old.id);
    const g2 = await call('account', 'GET', '/api/account?company_id=pt-norte-01');
    expect(g2.body.plans).toHaveLength(1);
  });
});

describe('pipeline', () => {
  it('converte proposta ganha em venda uma única vez', async () => {
    const c = await call('pipeline', 'POST', '/api/pipeline', { action: 'convert', record_id: 'r1' });
    expect(c.status).toBe(201);
    await call('pipeline', 'POST', '/api/pipeline', { action: 'convert', record_id: 'r1' });
    const g = await call('account', 'GET', '/api/account?company_id=pt-norte-01');
    expect(g.body.deals.filter((d) => d.pipeline_record_id === 'r1')).toHaveLength(1);
    const no = await call('pipeline', 'POST', '/api/pipeline', { action: 'convert', record_id: 'r2' });
    expect(no.status).toBe(400);
  });
  it('associa e desassocia manualmente', async () => {
    const before = await call('pipeline', 'GET', '/api/pipeline?company_id=pt-top50-04');
    expect(before.body.candidates.map((x) => x.id)).toContain('r4');
    await call('pipeline', 'POST', '/api/pipeline', { action: 'link', record_id: 'r4', company_id: 'pt-top50-04' });
    const after = await call('pipeline', 'GET', '/api/pipeline?company_id=pt-top50-04');
    expect(after.body.proposals.map((p) => p.id)).toEqual(['r4', 'r3']);
    await call('pipeline', 'POST', '/api/pipeline', { action: 'unlink', record_id: 'r3' });
    const un = await call('pipeline', 'GET', '/api/pipeline?company_id=pt-top50-04');
    expect(un.body.proposals.map((p) => p.id)).toEqual(['r4']);
  });
});

describe('decisores e anexos', () => {
  it('só expõe URLs públicos do LinkedIn', async () => {
    const r = await call('decision-makers', 'GET', '/api/decision-makers?company_id=pt-top50-04');
    expect(r.body.decision_makers[0].linkedin_url).toBeNull();
    const e = await call('decision-makers', 'GET', '/api/decision-makers?company_id=pt-norte-01');
    expect(e.body.decision_makers.map((d) => d.full_name)).toEqual(['Ana Exemplo', 'Rui Teste']);
  });
  it('carrega anexo para o R2 e devolve URL assinado', async () => {
    const up = await call('files', 'POST', '/api/files', { company_id: 'pt-norte-01', name: 'Ata reunião.pdf', type: 'application/pdf', data: Buffer.from('%PDF').toString('base64') });
    expect(up.status).toBe(201);
    expect(up.body.key).toMatch(/^contacts\/pt-norte-01\/[\w-]+\/Ata-reuniao\.pdf$/);
    expect(ctx.r2.has(up.body.key)).toBe(true);
    const g = await call('files', 'GET', '/api/files?key=' + encodeURIComponent(up.body.key));
    expect(g.status).toBe(302);
    expect(g.headers.location).toMatch(/X-Amz-Signature=[0-9a-f]{64}/);
    const bad = await call('files', 'GET', '/api/files?key=../../etc');
    expect(bad.status).toBe(400);
  });
});
