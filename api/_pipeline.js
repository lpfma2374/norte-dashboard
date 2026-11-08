// Norte Dashboard — ligação entre as propostas do PACE (presales-db) e as empresas do Norte.
// Regra: uma associação manual (tabela pipeline_links) prevalece sempre; sem ela,
// usa-se o mesmo matching de nomes do LeadSeeker (js/shared.js → sameClient).

const { d1 } = require('./_lib');
const { sameClient } = require('../js/shared.js');

// Propostas "em carteira": ainda sem decisão do cliente.
const OPEN = ['Em qualificação', 'Em negociação', 'Entregue'];
const WON = 'Ganha';
const LOST = 'Perdida';
const UNLINKED = '__none__';

async function loadRecords() {
  return d1('presales',
    `SELECT id, client, scope, ref, status, price, start_date, end_date, created_time, description
     FROM records WHERE scope IS NULL OR scope <> 'Paper'`);
}

// Devolve { byCompany: { [company_id]: [record...] }, unmatched: [record...] }
function matchRecords(records, companies, links) {
  const linkMap = {};
  (links || []).forEach((l) => { linkMap[l.record_id] = l.company_id; });
  const byCompany = {};
  const unmatched = [];
  records.forEach((r) => {
    let cid = linkMap[r.id];
    let how = 'manual';
    if (!cid) {
      const c = companies.find((co) => sameClient(co.name, r.client));
      cid = c ? c.id : null;
      how = 'auto';
    }
    const rec = Object.assign({}, r, { link: how, open: OPEN.indexOf(r.status) !== -1 });
    if (cid && cid !== UNLINKED && companies.some((co) => co.id === cid)) {
      (byCompany[cid] = byCompany[cid] || []).push(rec);
    } else {
      unmatched.push(rec);
    }
  });
  return { byCompany, unmatched };
}

module.exports = { OPEN, WON, LOST, UNLINKED, loadRecords, matchRecords };
