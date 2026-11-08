// Norte Dashboard — formatação e regras puras (browser global + módulo para Vitest).

var CHANNEL_LABELS = { presencial: 'Presencial', videochamada: 'Videochamada', email: 'Email', telefone: 'Telefone' };

// Euros compactos: 1,2 M€ · 350 k€ · 900 €
function fmtEur(v) {
  if (v == null || v === '' || isNaN(v)) return '—';
  var n = Number(v), a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toLocaleString('pt-PT', { maximumFractionDigits: 1 }) + ' M€';
  if (a >= 1e3) return Math.round(n / 1e3).toLocaleString('pt-PT') + ' k€';
  return Math.round(n).toLocaleString('pt-PT') + ' €';
}

// Volume de negócios da empresa (em M€) como no LeadSeeker
function fmtRevenue(m) {
  if (!m) return '—';
  return m >= 1000 ? (m / 1000).toLocaleString('pt-PT', { maximumFractionDigits: 1 }) + ' mM€'
    : Number(m).toLocaleString('pt-PT', { maximumFractionDigits: 1 }) + ' M€';
}

function fmtPct(v, digits) {
  if (v == null || isNaN(v)) return '—';
  return Number(v).toLocaleString('pt-PT', { maximumFractionDigits: digits == null ? 0 : digits }) + '%';
}

// 2026-11-08 → 8 nov. 2026
function fmtDate(iso) {
  if (!iso) return '—';
  var p = String(iso).slice(0, 10).split('-');
  if (p.length !== 3) return String(iso);
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  return d.toLocaleDateString('pt-PT', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function channelLabel(c) { return CHANNEL_LABELS[c] || c || '—'; }

function todayIso() {
  var d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// Filtro "Atividade" da lista de contas
function matchesActivity(c, a) {
  switch (a) {
    case 'contacts': return c.n_contacts > 0;
    case 'pipeline': return c.pipeline_open > 0;
    case 'volume': return c.volume_eur > 0;
    case 'plan': return !!c.plan_status;
    case 'decisors': return c.n_decisors > 0;
    case 'none': return !c.n_contacts && !c.pipeline_total && !c.volume_eur && !c.plan_status;
    default: return true;
  }
}

// Classe de cor para um KPI em percentagem face a um limiar "bom"
function toneFor(pct, good, ok) {
  if (pct == null) return '';
  return pct >= good ? 'good' : (pct >= ok ? 'warn' : 'badv');
}

// NPS a partir de respostas 0..10
function npsOf(scores) {
  var s = (scores || []).filter(function (x) { return x != null && !isNaN(x); });
  if (!s.length) return null;
  var p = s.filter(function (x) { return x >= 9; }).length, d = s.filter(function (x) { return x <= 6; }).length;
  return Math.round((p - d) / s.length * 100);
}

// Nome de ficheiro seguro para a ata: ata-<empresa>-<data>-<titulo>.pdf
function minuteFileName(company, c) {
  var slug = function (s, n) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, n).replace(/-+$/, '');
  };
  return ['ata', slug(company, 30), c.contact_date, slug(c.title, 40)].filter(Boolean).join('-') + '.pdf';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fmtEur, fmtRevenue, fmtPct, fmtDate, channelLabel, todayIso, matchesActivity, toneFor, npsOf, minuteFileName, CHANNEL_LABELS };
}
