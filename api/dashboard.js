// Norte Dashboard — GET /api/dashboard
// Devolve as 100 maiores empresas do Norte (leadseeker-db) com os agregados de gestão
// de conta (norte-dashboard-db) e de pipeline (presales-db), mais os KPIs do header.

const { d1, json, handler } = require('./_lib');
const { WON, LOST, loadRecords, matchRecords } = require('./_pipeline');

const pct = (a, b) => (a != null && b > 0 ? (a - b) / b * 100 : null);

// Resumo do plano do ano para a lista: evolução face à situação inicial e desvio face ao target
function planSummary(p) {
  if (!p) return null;
  return {
    id: p.id, year: p.plan_year, status: p.status, record_date: p.record_date,
    initial: p.initial_volume_eur, current: p.current_volume_eur, target: p.target_volume_eur,
    evolution_pct: pct(p.current_volume_eur, p.initial_volume_eur),
    deviation_pct: pct(p.current_volume_eur, p.target_volume_eur),
    sat_initial: p.sat_initial, sat_target: p.sat_target, sat_current: p.sat_current,
  };
}

function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

module.exports = handler(async (req, res) => {
  const since12 = monthsAgo(12);

  const [companies, accounts, contacts, deals, plans, sat, links, settingsRows, records] = await Promise.all([
    d1('leadseeker',
      `SELECT c.id, c.name, c.market, c.headquarters, c.revenue_eur_m, c.revenue_year, c.website, c.source,
              (SELECT COUNT(*) FROM decision_makers dm WHERE dm.company_id = c.id) AS n_decisors
       FROM companies c WHERE c.region = 'Norte'
       ORDER BY c.revenue_eur_m IS NULL, c.revenue_eur_m DESC, c.name`),
    d1('norte', 'SELECT company_id, owner, tier, baseline_volume_eur, baseline_year, target_eur FROM accounts'),
    d1('norte', 'SELECT company_id, COUNT(*) AS n, MAX(contact_date) AS last_date FROM contacts GROUP BY company_id'),
    d1('norte', 'SELECT company_id, amount_eur, close_date, source FROM deals'),
    d1('norte', `SELECT id, company_id, plan_year, record_date, status, next_review, initial_volume_eur, current_volume_eur,
                        target_volume_eur, sat_initial, sat_target, sat_current FROM account_plans WHERE plan_year = ?`, [new Date().getFullYear()]),
    d1('norte', 'SELECT company_id, nps_score, csat_score, survey_date FROM satisfaction WHERE survey_date >= ?', [since12]),
    d1('norte', 'SELECT record_id, company_id FROM pipeline_links'),
    d1('norte', 'SELECT key, value FROM settings'),
    loadRecords(),
  ]);

  const settings = {};
  settingsRows.forEach((s) => { settings[s.key] = s.value; });
  const targetYear = parseInt(settings.sales_target_year, 10) || new Date().getFullYear();
  const targetEur = settings.sales_target_eur != null && settings.sales_target_eur !== '' ? Number(settings.sales_target_eur) : null;

  const idx = (rows) => { const m = {}; rows.forEach((r) => { m[r.company_id] = r; }); return m; };
  const accM = idx(accounts), conM = idx(contacts), planM = idx(plans);
  const { byCompany } = matchRecords(records, companies, links);

  const dealAgg = {};
  deals.forEach((d) => {
    const a = dealAgg[d.company_id] = dealAgg[d.company_id] || { total: 0, last12: 0, year: 0, n: 0 };
    const v = Number(d.amount_eur) || 0;
    a.total += v; a.n += 1;
    if (d.close_date >= since12) a.last12 += v;
    if (String(d.close_date).slice(0, 4) === String(targetYear)) a.year += v;
  });
  const satAgg = {};
  sat.forEach((s) => {
    const a = satAgg[s.company_id] = satAgg[s.company_id] || { nps: [], csat: [] };
    if (s.nps_score != null) a.nps.push(s.nps_score);
    if (s.csat_score != null) a.csat.push(s.csat_score);
  });

  // KPIs agregados
  let achieved = 0, openN = 0, openEur = 0, won = 0, wonEur = 0, lost = 0;
  const npsAll = [], csatAll = [];

  const rows = companies.map((c, i) => {
    const acc = accM[c.id] || {};
    const dg = dealAgg[c.id] || { total: 0, last12: 0, year: 0, n: 0 };
    const recs = byCompany[c.id] || [];
    const open = recs.filter((r) => r.open);
    const sa = satAgg[c.id];
    achieved += dg.year;
    openN += open.length;
    openEur += open.reduce((s, r) => s + (Number(r.price) || 0), 0);
    recs.forEach((r) => {
      if (r.status === WON) { won++; wonEur += Number(r.price) || 0; }
      if (r.status === LOST) lost++;
    });
    if (sa) { npsAll.push.apply(npsAll, sa.nps); csatAll.push.apply(csatAll, sa.csat); }
    return {
      id: c.id,
      region_rank: i + 1,
      name: c.name,
      market: c.market,
      headquarters: c.headquarters,
      revenue_eur_m: c.revenue_eur_m,
      revenue_year: c.revenue_year,
      website: c.website,
      n_decisors: c.n_decisors,
      n_contacts: conM[c.id] ? conM[c.id].n : 0,
      last_contact: conM[c.id] ? conM[c.id].last_date : null,
      pipeline_open: open.length,
      pipeline_open_eur: open.reduce((s, r) => s + (Number(r.price) || 0), 0),
      pipeline_total: recs.length,
      volume_eur: dg.total,
      volume_last12_eur: dg.last12,
      n_deals: dg.n,
      owner: acc.owner || null,
      tier: acc.tier || null,
      plan: planSummary(planM[c.id]),
      plan_status: planM[c.id] ? planM[c.id].status : null,
      n_surveys: sa ? Math.max(sa.nps.length, sa.csat.length) : 0,
    };
  });

  const promoters = npsAll.filter((x) => x >= 9).length;
  const detractors = npsAll.filter((x) => x <= 6).length;

  // Planos de conta do ano corrente: situação inicial (fim do ano anterior), atual e target
  const withTarget = plans.filter((p) => p.target_volume_eur > 0 && p.current_volume_eur != null);
  const withInitial = plans.filter((p) => p.initial_volume_eur > 0 && p.current_volume_eur != null);
  const sum = (list, k) => list.reduce((s, p) => s + (Number(p[k]) || 0), 0);
  const avg = (k) => { const v = plans.map((p) => p[k]).filter((x) => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  const planTarget = sum(withTarget, 'target_volume_eur'), planCurrentT = sum(withTarget, 'current_volume_eur');
  const planInitial = sum(withInitial, 'initial_volume_eur'), planCurrentI = sum(withInitial, 'current_volume_eur');

  const kpis = {
    target: withTarget.length ? {
      source: 'planos', year: targetYear, accounts: withTarget.length,
      target_eur: planTarget, achieved_eur: planCurrentT,
      pct: planCurrentT / planTarget * 100,
    } : {
      source: 'vendas', year: targetYear, accounts: 0,
      target_eur: targetEur, achieved_eur: achieved,
      pct: targetEur ? achieved / targetEur * 100 : null,
    },
    nrr: {
      pct: planInitial > 0 ? planCurrentI / planInitial * 100 : null,
      baseline_eur: planInitial,
      current_eur: planCurrentI,
      accounts: withInitial.length,
    },
    pipeline: { count: openN, value_eur: openEur },
    conversions: {
      won, won_eur: wonEur, lost,
      win_rate: won + lost > 0 ? won / (won + lost) * 100 : null,
    },
    satisfaction: {
      responses: Math.max(npsAll.length, csatAll.length),
      nps: npsAll.length ? Math.round((promoters - detractors) / npsAll.length * 100) : null,
      csat: csatAll.length ? csatAll.reduce((s, x) => s + x, 0) / csatAll.length : null,
      window: 'últimos 12 meses',
      plan: { initial: avg('sat_initial'), target: avg('sat_target'), current: avg('sat_current'),
        accounts: plans.filter((p) => p.sat_current != null).length },
    },
  };

  json(res, 200, { companies: rows, kpis, generated_at: new Date().toISOString() });
});
