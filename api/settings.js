// Norte Dashboard — Target de Sales da região
//   GET /api/settings                                   → { sales_target_year, sales_target_eur }
//   PUT /api/settings { sales_target_year, sales_target_eur }

const { d1, json, readBody, num, handler, bad } = require('./_lib');

module.exports = handler(async (req, res) => {
  if (req.method === 'GET') {
    const rows = await d1('norte', 'SELECT key, value FROM settings');
    const s = {};
    rows.forEach((r) => { s[r.key] = r.value; });
    return json(res, 200, s);
  }
  if (req.method === 'PUT') {
    const b = await readBody(req);
    const year = Math.round(num(b.sales_target_year) || 0);
    const target = num(b.sales_target_eur);
    if (year < 2020 || year > 2100) throw bad('Ano inválido.');
    if (target != null && target < 0) throw bad('O target não pode ser negativo.');
    await d1('norte',
      `INSERT INTO settings (key, value, updated_at) VALUES ('sales_target_year', ?, datetime('now')), ('sales_target_eur', ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [String(year), target == null ? null : String(target)]);
    return json(res, 200, { sales_target_year: year, sales_target_eur: target });
  }
  res.setHeader('Allow', 'GET, PUT');
  return json(res, 405, { error: 'Método não suportado.' });
});
