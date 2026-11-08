// Norte Dashboard — Gestão de Contactos (registos no formato de ata de reunião)
//   GET    /api/contacts?company_id=X  → lista do mais recente para o mais antigo
//   GET    /api/contacts?id=Y          → registo completo (agenda e anexos já em JSON)
//   POST   /api/contacts               → cria { company_id, title, contact_date, channel, attendees,
//                                               agenda:[{point, notes}], decisions, next_steps, attachments:[...] }
//   PUT    /api/contacts?id=Y          → atualiza os mesmos campos
//   DELETE /api/contacts?id=Y          → apaga o registo e os anexos no R2

const { d1, json, readBody, query, uid, str, isoDate, handler, bad, r2Delete } = require('./_lib');

const CHANNELS = ['presencial', 'videochamada', 'email', 'telefone'];

function parse(raw, fallback) {
  try { const v = JSON.parse(raw || ''); return v == null ? fallback : v; } catch (e) { return fallback; }
}

function toRecord(r) {
  return Object.assign({}, r, {
    agenda: parse(r.agenda_json, []),
    attachments: parse(r.attachments_json, []),
    agenda_json: undefined,
    attachments_json: undefined,
  });
}

function clean(b) {
  const title = str(b.title, 300);
  const contact_date = isoDate(b.contact_date);
  const channel = str(b.channel, 20);
  if (!title) throw bad('O título é obrigatório.');
  if (!contact_date) throw bad('A data do contacto é obrigatória (AAAA-MM-DD).');
  if (CHANNELS.indexOf(channel) === -1) throw bad('Canal inválido.');
  const agenda = (Array.isArray(b.agenda) ? b.agenda : [])
    .map((a) => ({ point: str(a && a.point, 500) || '', notes: str(a && a.notes, 8000) || '' }))
    .filter((a) => a.point || a.notes)
    .slice(0, 40);
  const attachments = (Array.isArray(b.attachments) ? b.attachments : [])
    .filter((a) => a && typeof a.key === 'string' && a.key.indexOf('contacts/') === 0)
    .map((a) => ({ key: a.key, name: str(a.name, 200) || 'anexo', size: Number(a.size) || 0, type: str(a.type, 100) }))
    .slice(0, 20);
  return {
    title, contact_date, channel,
    attendees: str(b.attendees, 4000),
    agenda_json: JSON.stringify(agenda),
    decisions: str(b.decisions, 8000),
    next_steps: str(b.next_steps, 8000),
    attachments_json: JSON.stringify(attachments),
    created_by: str(b.created_by, 120),
  };
}

module.exports = handler(async (req, res) => {
  const q = query(req);
  const id = q.get('id');

  if (req.method === 'GET') {
    if (id) {
      const rows = await d1('norte', 'SELECT * FROM contacts WHERE id = ?', [id]);
      if (!rows.length) return json(res, 404, { error: 'Contacto não encontrado.' });
      return json(res, 200, { contact: toRecord(rows[0]) });
    }
    const cid = q.get('company_id');
    if (!cid) throw bad('Indica company_id.');
    const rows = await d1('norte',
      `SELECT id, company_id, title, contact_date, channel, attendees, created_at, updated_at
       FROM contacts WHERE company_id = ? ORDER BY contact_date DESC, created_at DESC`, [cid]);
    return json(res, 200, { contacts: rows });
  }

  if (req.method === 'POST') {
    const b = await readBody(req);
    const company_id = str(b.company_id, 64);
    if (!company_id) throw bad('Indica company_id.');
    const ok = await d1('leadseeker', "SELECT id FROM companies WHERE id = ? AND region = 'Norte'", [company_id]);
    if (!ok.length) throw bad('Empresa desconhecida.');
    const c = clean(b);
    const newId = uid('ct');
    await d1('norte',
      `INSERT INTO contacts (id, company_id, title, contact_date, channel, attendees, agenda_json, decisions,
                             next_steps, attachments_json, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId, company_id, c.title, c.contact_date, c.channel, c.attendees, c.agenda_json, c.decisions,
        c.next_steps, c.attachments_json, c.created_by]);
    await d1('norte', 'INSERT OR IGNORE INTO accounts (company_id) VALUES (?)', [company_id]);
    return json(res, 201, { id: newId });
  }

  if (req.method === 'PUT') {
    if (!id) throw bad('Indica id.');
    const b = await readBody(req);
    const c = clean(b);
    await d1('norte',
      `UPDATE contacts SET title = ?, contact_date = ?, channel = ?, attendees = ?, agenda_json = ?, decisions = ?,
              next_steps = ?, attachments_json = ?, updated_at = datetime('now') WHERE id = ?`,
      [c.title, c.contact_date, c.channel, c.attendees, c.agenda_json, c.decisions, c.next_steps, c.attachments_json, id]);
    return json(res, 200, { id });
  }

  if (req.method === 'DELETE') {
    if (!id) throw bad('Indica id.');
    const rows = await d1('norte', 'SELECT attachments_json FROM contacts WHERE id = ?', [id]);
    if (rows.length) {
      const att = parse(rows[0].attachments_json, []);
      await Promise.all(att.map((a) => r2Delete(a.key).catch(() => null)));
    }
    await d1('norte', 'DELETE FROM contacts WHERE id = ?', [id]);
    return json(res, 200, { deleted: id });
  }

  res.setHeader('Allow', 'GET, POST, PUT, DELETE');
  return json(res, 405, { error: 'Método não suportado.' });
});
