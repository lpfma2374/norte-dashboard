// LeadSeeker — funções puras partilhadas entre páginas (index, empresas, wizard, repo).
// Carregado como <script> global no browser e como módulo nos testes (Vitest).

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// Formatação de receita em milhões (index.html)
function fmtM(v) {
  if (v == null) return '—';
  return Number(v).toLocaleString('pt-PT') + ' M€';
}

// Formatação numérica genérica (empresas.html)
function fmtN(v) {
  if (v == null) return '—';
  return Number(v).toLocaleString('pt-PT');
}

// Volume de negócios: mM€ quando >= 1000 M€
function fmtVol(v) {
  if (!v) return '—';
  return v >= 1000
    ? (v / 1000).toLocaleString('pt-PT', { maximumFractionDigits: 1 }) + ' mM€'
    : fmtN(v) + ' M€';
}

// Constrói o URL da API de decisores com filtros e código de acesso opcionais.
function buildApiUrl(base, params, code) {
  var qs = new URLSearchParams(params || {});
  if (code) qs.set('code', code);
  return base + '?' + qs.toString();
}

// ---------- Cruzamento empresa ↔ cliente das stories (empresas.html) ----------

// Normalização de nomes: minúsculas, sem acentos, sem sufixos de grupo.
function norm(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(grupo|group|sa|sgps|lda|holdings?)\b/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Empresas cujo nome oficial começa por uma sigla (ex.: "EDP - Energias de Portugal",
// "CP - Comboios de Portugal") — a sigla sozinha identifica o grupo em qualquer story.
var ACRONYM_RE = /^[A-Z]{2,5}(?=[\s\-–]|$)/;
function acronymToken(rawName) {
  var m = ACRONYM_RE.exec(String(rawName || '').trim());
  return m ? m[0].toLowerCase() : null;
}

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Ligações de grupo confirmadas pelo utilizador (holding ↔ marcas do grupo).
var GROUP_LINKS = {
  'caixa geral de depositos': ['caixa seguros', 'fidelidade']
};

// Devolve o nome da marca do grupo se a story pertencer a uma marca ligada (senão null).
function matchedBrand(companyName, storyClient) {
  var a = norm(companyName), b = norm(storyClient);
  var links = GROUP_LINKS[a];
  if (!links) return null;
  for (var k = 0; k < links.length; k++) {
    if (b.indexOf(links[k]) !== -1) return String(storyClient).trim();
  }
  return null;
}

// True se o nome da empresa e o cliente da story se referem à mesma organização.
function sameClient(companyName, storyClient) {
  var a = norm(companyName), b = norm(storyClient);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 4 && b.indexOf(a) !== -1) return true;
  if (b.length >= 4 && a.indexOf(b) !== -1) return true;
  var tok = acronymToken(companyName);
  if (tok && new RegExp('\\b' + escRe(tok) + '\\b').test(b)) return true;
  var links = GROUP_LINKS[a];
  if (links) {
    for (var k = 0; k < links.length; k++) {
      if (b.indexOf(links[k]) !== -1) return true;
    }
  }
  return false;
}

// Stories que referem uma dada empresa.
function storiesFor(stories, name) {
  return (stories || []).filter(function (s) { return sameClient(name, s.c); });
}

// Export para Vitest (Node) — no browser ficam globais.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    esc, fmtM, fmtN, fmtVol, buildApiUrl,
    norm, acronymToken, escRe, matchedBrand, sameClient, storiesFor
  };
}
