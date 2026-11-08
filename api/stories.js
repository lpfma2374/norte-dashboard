// LeadSeeker — Vercel Serverless Function: Success Stories
// Fonte da verdade: base Cloudflare D1 "stories-db" (tabela stories).
//   GET /api/stories            → lista resumida das stories publicadas
//                                 { stories: [{ id, t, c, i, s, b }] }
//   GET /api/stories?id=<id>    → história completa para o PDF
//                                 { story: { id, t, c, i, s, b, geo, tech, challenge, solution,
//                                            metrics:[{value,label}], results:[...], quote, quote_author } }
// Dados internos (valor do projeto, nº de FTEs) nunca saem desta função.

const STORIES_DB_ID = () => process.env.STORIES_DB_ID || 'a2276436-900a-4e86-9788-ac85df9700fa';
const D1_URL = () =>
  `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/d1/database/${STORIES_DB_ID()}/query`;

async function d1(sql, params = []) {
  const res = await fetch(D1_URL(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql, params }),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error((data.errors && data.errors[0] && data.errors[0].message) || 'Erro D1');
  }
  return data.result[0].results;
}

function json(res, status, body, cache) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', cache || 'no-store');
  res.end(JSON.stringify(body));
}

const INTERNAL = /^\s*(valor do projeto|n[ºo°]\s*ftes?)/i;
const clean = (s) => String(s == null ? '' : s).replace(/​/g, '').trim();

function parseList(raw) {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

function toDetail(r) {
  return {
    id: r.id,
    t: clean(r.title),
    c: clean(r.client),
    i: r.industry || '',
    s: r.serviceType || '',
    b: r.bu || '',
    geo: r.geo || '',
    tech: clean(r.techStack),
    challenge: clean(r.challenge),
    solution: clean(r.solution),
    metrics: parseList(r.metrics)
      .filter((m) => m && typeof m === 'object' && (m.value || m.label))
      .map((m) => ({ value: clean(m.value), label: clean(m.label) })),
    results: parseList(r.qualitativeResults)
      .filter((x) => typeof x === 'string' && clean(x) && !INTERNAL.test(x))
      .map(clean),
    quote: clean(r.clientQuote),
    quote_author: clean(r.clientQuoteAuthor),
  };
}

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const id = url.searchParams.get('id');

    if (id) {
      const rows = await d1(
        `SELECT id, title, client, industry, geo, serviceType, bu, techStack, challenge, solution,
                metrics, qualitativeResults, clientQuote, clientQuoteAuthor
         FROM stories WHERE id = ? AND status = 'published'`, [id]);
      if (!rows.length) return json(res, 404, { error: 'Story não encontrada' });
      return json(res, 200, { story: toDetail(rows[0]) }, 'public, max-age=60, s-maxage=300');
    }

    const rows = await d1(
      `SELECT id, title AS t, client AS c, industry AS i, serviceType AS s, bu AS b
       FROM stories WHERE status = 'published' ORDER BY date DESC`);
    return json(res, 200, { stories: rows.map((r) => ({ ...r, t: clean(r.t), c: clean(r.c) })) },
      'public, max-age=60, s-maxage=300');
  } catch (err) {
    return json(res, 500, { error: err.message });
  }
};

module.exports.toDetail = toDetail;
