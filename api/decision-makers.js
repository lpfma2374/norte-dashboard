// Norte Dashboard — GET /api/decision-makers?company_id=X
// Decisores de uma empresa do Norte, lidos da base do LeadSeeker (leadseeker-db).

const { d1, json, query, handler, bad } = require('./_lib');

module.exports = handler(async (req, res) => {
  const cid = query(req).get('company_id');
  if (!cid) throw bad('Indica company_id.');
  const rows = await d1('leadseeker',
    `SELECT id, full_name, current_title, headline, role_category, seniority, email, email_status, linkedin_url, location
     FROM decision_makers WHERE company_id = ?
     ORDER BY CASE lower(seniority) WHEN 'c-level' THEN 0 WHEN 'founder' THEN 1 WHEN 'vp' THEN 2 WHEN 'head' THEN 3
                                    WHEN 'director' THEN 4 ELSE 5 END, full_name`,
    [cid]);
  // Só se expõem URLs públicos do LinkedIn.
  rows.forEach((r) => {
    if (r.linkedin_url && !/^https:\/\/([a-z]{2,3}\.)?(www\.)?linkedin\.com\/in\//i.test(r.linkedin_url)) r.linkedin_url = null;
  });
  json(res, 200, { decision_makers: rows });
});
