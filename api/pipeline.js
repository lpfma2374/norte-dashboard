// Norte Dashboard — Pipeline de propostas (fonte: PACE / presales-db, só leitura)
//   GET  /api/pipeline?company_id=X          → propostas da empresa (abertas primeiro) + candidatas sem conta
//   POST /api/pipeline  { action:'link',    record_id, company_id }  → associa manualmente uma proposta à empresa
//   POST /api/pipeline  { action:'unlink',  record_id }              → retira a proposta desta empresa
//   POST /api/pipeline  { action:'convert', record_id }              → regista a proposta ganha como negócio efetivo

const { d1, json, readBody, query, uid, str, handler, bad } = require('./_lib');
const { WON, UNLINKED, loadRecords, matchRecords } = require('./_pipeline');

async function context() {
  const [companies, links, records, converted] = await Promise.all([
    d1('leadseeker', "SELECT id, name FROM companies WHERE region = 'Norte'"),
    d1('norte', 'SELECT record_id, company_id FROM pipeline_links'),
    loadRecords(),
    d1('norte', 'SELECT pipeline_record_id FROM deals WHERE pipeline_record_id IS NOT NULL'),
  ]);
  return { companies, links, records, converted: new Set(converted.map((c) => c.pipeline_record_id)) };
}

const ORDER = { 'Em negociação': 0, 'Em qualificação': 1, 'Entregue': 2, 'Ganha': 3, 'Perdida': 4, 'Não avançar': 5, 'Cancelado/Revogado': 6 };

module.exports = handler(async (req, res) => {
  if (req.method === 'GET') {
    const cid = query(req).get('company_id');
    if (!cid) throw bad('Indica company_id.');
    const ctx = await context();
    const { byCompany, unmatched } = matchRecords(ctx.records, ctx.companies, ctx.links);
    const mark = (r) => Object.assign(r, { converted: ctx.converted.has(r.id) });
    const list = (byCompany[cid] || []).map(mark).sort((a, b) =>
      (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9) || String(b.start_date || '').localeCompare(String(a.start_date || '')));
    const candidates = unmatched.map((r) => ({ id: r.id, client: r.client, ref: r.ref, status: r.status }))
      .sort((a, b) => String(a.client).localeCompare(String(b.client), 'pt'));
    return json(res, 200, { proposals: list, candidates });
  }

  if (req.method === 'POST') {
    const b = await readBody(req);
    const rid = str(b.record_id, 64);
    if (!rid) throw bad('Indica record_id.');
    const rec = (await d1('presales', 'SELECT id, client, ref, status, price, end_date, start_date FROM records WHERE id = ?', [rid]))[0];
    if (!rec) throw bad('Proposta não encontrada no PACE.');

    if (b.action === 'link') {
      const cid = str(b.company_id, 64);
      const ok = await d1('leadseeker', "SELECT id FROM companies WHERE id = ? AND region = 'Norte'", [cid]);
      if (!ok.length) throw bad('Empresa desconhecida.');
      await d1('norte', 'INSERT INTO pipeline_links (record_id, company_id) VALUES (?, ?) ON CONFLICT(record_id) DO UPDATE SET company_id = excluded.company_id', [rid, cid]);
      return json(res, 200, { linked: rid, company_id: cid });
    }

    if (b.action === 'unlink') {
      await d1('norte', 'INSERT INTO pipeline_links (record_id, company_id) VALUES (?, ?) ON CONFLICT(record_id) DO UPDATE SET company_id = excluded.company_id', [rid, UNLINKED]);
      return json(res, 200, { unlinked: rid });
    }

    if (b.action === 'convert') {
      if (rec.status !== WON) throw bad('Só propostas com estado "Ganha" podem ser registadas como venda.');
      if (!(Number(rec.price) > 0)) throw bad('A proposta não tem valor no PACE; regista o negócio manualmente na ficha da conta.');
      const ctx = await context();
      const { byCompany } = matchRecords(ctx.records, ctx.companies, ctx.links);
      const cid = Object.keys(byCompany).find((k) => byCompany[k].some((r) => r.id === rid));
      if (!cid) throw bad('A proposta não está associada a nenhuma empresa do Norte.');
      const id = uid('dl');
      await d1('norte',
        `INSERT INTO deals (id, company_id, ref, amount_eur, close_date, source, pipeline_record_id, notes)
         VALUES (?, ?, ?, ?, ?, 'pipeline', ?, ?)
         ON CONFLICT(pipeline_record_id) DO NOTHING`,
        [id, cid, rec.ref || 'Proposta PACE', Number(rec.price), rec.end_date || rec.start_date || new Date().toISOString().slice(0, 10), rid, 'Convertida a partir do PACE']);
      await d1('norte', 'INSERT OR IGNORE INTO accounts (company_id) VALUES (?)', [cid]);
      return json(res, 201, { deal: id, company_id: cid });
    }

    throw bad('Ação desconhecida.');
  }

  res.setHeader('Allow', 'GET, POST');
  return json(res, 405, { error: 'Método não suportado.' });
});
