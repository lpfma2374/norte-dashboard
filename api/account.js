// Norte Dashboard — Ficha de conta (plano estratégico, volume de negócio e satisfação)
//   GET    /api/account?company_id=X                         → { account, plan (ano corrente), plans (histórico), deals, satisfaction }
//   PUT    /api/account?company_id=X  { section:'account', owner, tier }
//   PUT    /api/account?company_id=X  { section:'plan', plan_year, record_date,
//                                       initial_volume_eur, current_volume_eur, target_volume_eur,
//                                       sat_initial, sat_target, sat_current,
//                                       ambition, objectives, priorities, target_offers, whitespace, initiatives, risks,
//                                       next_review, status }      → cria ou atualiza o plano desse ano
//   POST   /api/account?company_id=X  { kind:'deal', ref, amount_eur, close_date, notes }
//   POST   /api/account?company_id=X  { kind:'survey', survey_date, method, respondent, nps_score, csat_score, comment }
//   DELETE /api/account?company_id=X&deal=ID | &survey=ID | &plan=ID

const { d1, json, readBody, query, uid, str, num, isoDate, handler, bad } = require('./_lib');

const PLAN_STATUS = ['rascunho', 'em curso', 'em revisão', 'aprovado'];
const TIERS = ['Estratégica', 'Desenvolvimento', 'Manutenção', 'Prospeção'];
const METHODS = ['Inquérito NPS', 'QBR / reunião de revisão', 'Entrevista', 'Feedback informal', 'Fecho de projeto'];

module.exports = handler(async (req, res) => {
  const q = query(req);
  const cid = q.get('company_id');
  if (!cid) throw bad('Indica company_id.');
  const company = (await d1('leadseeker',
    "SELECT id, name, market, headquarters, revenue_eur_m, revenue_year, website FROM companies WHERE id = ? AND region = 'Norte'", [cid]))[0];
  if (!company) return json(res, 404, { error: 'Empresa desconhecida.' });

  if (req.method === 'GET') {
    const year = new Date().getFullYear();
    const [acc, plans, deals, sat] = await Promise.all([
      d1('norte', 'SELECT * FROM accounts WHERE company_id = ?', [cid]),
      d1('norte', 'SELECT * FROM account_plans WHERE company_id = ? ORDER BY plan_year DESC', [cid]),
      d1('norte', 'SELECT * FROM deals WHERE company_id = ? ORDER BY close_date DESC', [cid]),
      d1('norte', 'SELECT * FROM satisfaction WHERE company_id = ? ORDER BY survey_date DESC', [cid]),
    ]);
    return json(res, 200, {
      company, account: acc[0] || null, plan: plans.find((p) => p.plan_year === year) || null, plans, year, deals, satisfaction: sat,
      options: { plan_status: PLAN_STATUS, tiers: TIERS, survey_methods: METHODS },
    });
  }

  await d1('norte', 'INSERT OR IGNORE INTO accounts (company_id) VALUES (?)', [cid]);

  if (req.method === 'PUT') {
    const b = await readBody(req);
    if (b.section === 'account') {
      const tier = str(b.tier, 40);
      if (tier && TIERS.indexOf(tier) === -1) throw bad('Tier inválido.');
      await d1('norte', "UPDATE accounts SET owner = ?, tier = ?, updated_at = datetime('now') WHERE company_id = ?",
        [str(b.owner, 120), tier, cid]);
      return json(res, 200, { saved: 'account' });
    }
    if (b.section === 'plan') {
      const status = str(b.status, 20) || 'rascunho';
      if (PLAN_STATUS.indexOf(status) === -1) throw bad('Estado do plano inválido.');
      const year = Math.round(num(b.plan_year) || new Date().getFullYear());
      if (year < 2020 || year > 2100) throw bad('Ano do plano inválido.');
      const recordDate = isoDate(b.record_date) || new Date().toISOString().slice(0, 10);
      const vol = ['initial_volume_eur', 'current_volume_eur', 'target_volume_eur'].map((k) => num(b[k]));
      if (vol.some((v) => v != null && v < 0)) throw bad('Os volumes de negócio não podem ser negativos.');
      const sat = ['sat_initial', 'sat_target', 'sat_current'].map((k) => num(b[k]));
      if (sat.some((v) => v != null && (v < 0 || v > 10))) throw bad('A satisfação usa uma escala de 0 a 10.');
      const txt = ['ambition', 'objectives', 'priorities', 'target_offers', 'whitespace', 'initiatives', 'risks'].map((k) => str(b[k], 8000));
      const id = uid('pl');
      await d1('norte',
        `INSERT INTO account_plans (id, company_id, plan_year, record_date, initial_volume_eur, current_volume_eur, target_volume_eur,
                                    sat_initial, sat_target, sat_current, ambition, objectives, priorities, target_offers, whitespace,
                                    initiatives, risks, next_review, status, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(company_id, plan_year) DO UPDATE SET record_date = excluded.record_date,
           initial_volume_eur = excluded.initial_volume_eur, current_volume_eur = excluded.current_volume_eur,
           target_volume_eur = excluded.target_volume_eur, sat_initial = excluded.sat_initial, sat_target = excluded.sat_target,
           sat_current = excluded.sat_current, ambition = excluded.ambition, objectives = excluded.objectives,
           priorities = excluded.priorities, target_offers = excluded.target_offers, whitespace = excluded.whitespace,
           initiatives = excluded.initiatives, risks = excluded.risks, next_review = excluded.next_review,
           status = excluded.status, updated_at = excluded.updated_at`,
        [id, cid, year, recordDate].concat(vol, sat, txt, [isoDate(b.next_review), status]));
      return json(res, 200, { saved: 'plan', plan_year: year });
    }
    throw bad('Secção desconhecida.');
  }

  if (req.method === 'POST') {
    const b = await readBody(req);
    if (b.kind === 'deal') {
      const ref = str(b.ref, 300), amount = num(b.amount_eur), date = isoDate(b.close_date);
      if (!ref) throw bad('Indica a referência do negócio.');
      if (!(amount > 0)) throw bad('O valor tem de ser positivo.');
      if (!date) throw bad('Indica a data de fecho.');
      const id = uid('dl');
      await d1('norte', "INSERT INTO deals (id, company_id, ref, amount_eur, close_date, source, notes) VALUES (?, ?, ?, ?, ?, 'manual', ?)",
        [id, cid, ref, amount, date, str(b.notes, 2000)]);
      return json(res, 201, { id });
    }
    if (b.kind === 'survey') {
      const date = isoDate(b.survey_date);
      if (!date) throw bad('Indica a data da avaliação.');
      const nps = b.nps_score === '' || b.nps_score == null ? null : Math.round(Number(b.nps_score));
      const csat = b.csat_score === '' || b.csat_score == null ? null : Math.round(Number(b.csat_score));
      if (nps == null && csat == null) throw bad('Indica pelo menos o NPS (0 a 10) ou o CSAT (1 a 5).');
      if (nps != null && !(nps >= 0 && nps <= 10)) throw bad('O NPS vai de 0 a 10.');
      if (csat != null && !(csat >= 1 && csat <= 5)) throw bad('O CSAT vai de 1 a 5.');
      const method = str(b.method, 60);
      const id = uid('sv');
      await d1('norte',
        'INSERT INTO satisfaction (id, company_id, survey_date, method, respondent, nps_score, csat_score, comment) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, cid, date, method, str(b.respondent, 200), nps, csat, str(b.comment, 4000)]);
      return json(res, 201, { id });
    }
    throw bad('Tipo desconhecido.');
  }

  if (req.method === 'DELETE') {
    if (q.get('deal')) {
      await d1('norte', 'DELETE FROM deals WHERE id = ? AND company_id = ?', [q.get('deal'), cid]);
      return json(res, 200, { deleted: q.get('deal') });
    }
    if (q.get('survey')) {
      await d1('norte', 'DELETE FROM satisfaction WHERE id = ? AND company_id = ?', [q.get('survey'), cid]);
      return json(res, 200, { deleted: q.get('survey') });
    }
    if (q.get('plan')) {
      await d1('norte', 'DELETE FROM account_plans WHERE id = ? AND company_id = ?', [q.get('plan'), cid]);
      return json(res, 200, { deleted: q.get('plan') });
    }
    throw bad('Indica deal, survey ou plan.');
  }

  res.setHeader('Allow', 'GET, PUT, POST, DELETE');
  return json(res, 405, { error: 'Método não suportado.' });
});
