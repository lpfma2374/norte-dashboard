// Norte Dashboard — Anexos dos contactos no Cloudflare R2 (bucket norte-docs)
//   POST /api/files { company_id, name, type, data(base64) } → { key, name, size, type }   (máx. 3 MB)
//   GET  /api/files?key=contacts/...                        → redireciona para um URL assinado (5 min)
//   DELETE /api/files?key=contacts/...                      → apaga o objeto

const { json, readBody, query, uid, str, handler, bad, r2PresignedUrl, r2Put, r2Delete } = require('./_lib');

const MAX = 3 * 1024 * 1024;

function safeName(n) {
  return String(n || 'anexo').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'anexo';
}

function validKey(k) {
  return typeof k === 'string' && /^contacts\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/.test(k);
}

module.exports = handler(async (req, res) => {
  if (req.method === 'POST') {
    const b = await readBody(req);
    const cid = str(b.company_id, 64);
    if (!cid || !/^[A-Za-z0-9_-]+$/.test(cid)) throw bad('Indica company_id.');
    if (typeof b.data !== 'string' || !b.data) throw bad('Ficheiro vazio.');
    const buf = Buffer.from(b.data, 'base64');
    if (buf.length > MAX) throw bad('O anexo excede 3 MB.');
    const name = str(b.name, 200) || 'anexo';
    const key = `contacts/${cid}/${uid()}/${safeName(name)}`;
    await r2Put(key, buf, str(b.type, 100) || 'application/octet-stream');
    return json(res, 201, { key, name, size: buf.length, type: str(b.type, 100) });
  }

  const key = query(req).get('key');
  if (!validKey(key)) throw bad('Chave inválida.');

  if (req.method === 'GET') {
    res.statusCode = 302;
    res.setHeader('Location', r2PresignedUrl('GET', key, 300));
    res.setHeader('Cache-Control', 'no-store');
    return res.end();
  }
  if (req.method === 'DELETE') {
    await r2Delete(key);
    return json(res, 200, { deleted: key });
  }
  res.setHeader('Allow', 'GET, POST, DELETE');
  return json(res, 405, { error: 'Método não suportado.' });
});
