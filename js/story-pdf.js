// LeadSeeker — gera o PDF de uma success story (empresas.html).
// Usa jsPDF (js/vendor/jspdf.umd.min.js). Carregado como <script> global no browser
// e como módulo nos testes (Vitest / Node).

// As fontes base do PDF (Helvetica) só cobrem Windows-1252: troca o resto por equivalentes.
var PDF_CHAR_MAP = {
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ',
  '​': '', '‌': '', '‍': '', '﻿': '',
  '‐': '-', '‑': '-', '‒': '-', '−': '-',
  '→': '->', '←': '<-', '↔': '<->', '⇒': '=>',
  '≥': '>=', '≤': '<=', '≈': '~', '≠': '!=',
  '✓': 'v', '✔': 'v', '•': '•'
};
// Caracteres acima de U+00FF que existem em Windows-1252.
var CP1252_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ' +
  '‘’“”•–—˜™š›œžŸ';

function pdfSafe(s) {
  return String(s == null ? '' : s).replace(/[^\x00-\xff]| /g, function (ch) {
    if (Object.prototype.hasOwnProperty.call(PDF_CHAR_MAP, ch)) return PDF_CHAR_MAP[ch];
    if (CP1252_EXTRA.indexOf(ch) !== -1) return ch;
    var base = ch.normalize ? ch.normalize('NFD').replace(/[̀-ͯ]/g, '') : '';
    return /^[\x00-\xff]+$/.test(base) ? base : '';
  });
}

// Códigos do Hub (ex.: "managed_services", "bfsi") em texto legível.
var STORY_LABELS = {
  bfsi: 'BFSI', public_sector: 'Public Sector', consumer_goods: 'Consumer Goods',
  professional_services: 'Professional Services', media_entertainment: 'Media & Entertainment',
  implementation_and_managed_services: 'Implementation & Managed Services',
  capacity_services: 'Capacity Services', managed_services: 'Managed Services',
  europe: 'Europe', other: 'Other'
};
function storyLabel(code) {
  if (!code) return '';
  if (STORY_LABELS[code]) return STORY_LABELS[code];
  return String(code).replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
}

// Nome de ficheiro seguro: story-<cliente>-<titulo>.pdf
function storyFileName(d) {
  var slug = function (s, n) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, n).replace(/-+$/, '');
  };
  return ['story', slug(d.c, 30), slug(d.t, 50)].filter(Boolean).join('-') + '.pdf';
}

// Divide a solução em parágrafos (o Hub usa quebras de linha e itens "1) ...").
function storyParagraphs(text) {
  return String(text || '').split(/\n+/).map(function (p) { return p.trim(); }).filter(Boolean);
}

// Constrói o PDF. `jsPDFCtor` = window.jspdf.jsPDF. Devolve a instância jsPDF.
function buildStoryPdf(jsPDFCtor, d) {
  var doc = new jsPDFCtor({ unit: 'mm', format: 'a4' });
  var W = 210, H = 297, M = 18, CW = W - 2 * M, BOTTOM = H - 20;
  var INK = [29, 29, 31], MUTED = [110, 110, 115], BLUE = [0, 113, 227], LINE = [222, 222, 227], SOFT = [245, 245, 247];
  var y = 0;

  function color(c) { doc.setTextColor(c[0], c[1], c[2]); }
  function font(style, size) { doc.setFont('helvetica', style); doc.setFontSize(size); }
  function lh(size, f) { return size * 0.3528 * (f || 1.35); }
  function newPage() { doc.addPage(); y = M + 4; }
  function ensure(h) { if (y + h > BOTTOM) newPage(); }

  // Texto com quebra automática e mudança de página linha a linha.
  function para(text, size, style, c, opts) {
    opts = opts || {};
    var x = opts.x || M, w = opts.w || CW, step = lh(size, opts.f);
    font(style || 'normal', size); color(c || INK);
    var lines = doc.splitTextToSize(pdfSafe(text), w);
    lines.forEach(function (ln) { ensure(step); doc.text(ln, x, y + step * 0.75); y += step; });
    return lines.length;
  }

  function heading(txt) {
    ensure(18);
    y += 6;
    font('bold', 8.5); color(BLUE);
    doc.text(pdfSafe(txt).toUpperCase(), M, y + 3, { charSpace: 0.6 });
    y += 5.5;
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.3); doc.line(M, y, W - M, y);
    y += 3.5;
  }

  // Cabeçalho
  doc.setFillColor(INK[0], INK[1], INK[2]); doc.rect(0, 0, W, 9, 'F');
  font('bold', 7.5); doc.setTextColor(255, 255, 255);
  doc.text('NOESIS  ·  SUCCESS STORIES HUB', M, 5.8, { charSpace: 0.5 });
  y = 22;
  font('bold', 9); color(BLUE);
  doc.text(pdfSafe(d.c || '').toUpperCase(), M, y, { charSpace: 0.4 });
  y += 4;
  para(d.t, 19, 'bold', INK, { f: 1.22 });
  y += 2;
  var tags = [storyLabel(d.i), storyLabel(d.s), d.b, storyLabel(d.geo)].filter(Boolean).join('   ·   ');
  if (tags) para(tags, 9, 'normal', MUTED);
  y += 3;

  // Métricas: caixas em grelha (até 4 por linha)
  var metrics = (d.metrics || []).filter(function (m) { return m && (m.value || m.label); });
  if (metrics.length) {
    var per = metrics.length <= 4 ? metrics.length : (metrics.length <= 6 ? 3 : 4), gap = 4, bw = (CW - gap * (per - 1)) / per;
    for (var r = 0; r < metrics.length; r += per) {
      var row = metrics.slice(r, r + per);
      var cells = row.map(function (m) {
        font('bold', 14); var v = doc.splitTextToSize(pdfSafe(m.value), bw - 8);
        font('normal', 8); var l = doc.splitTextToSize(pdfSafe(m.label), bw - 8);
        return { v: v, l: l, h: 6 + v.length * lh(14, 1.15) + 1.5 + l.length * lh(8, 1.3) + 4 };
      });
      var bh = Math.max.apply(null, cells.map(function (c) { return c.h; }));
      ensure(bh + gap);
      cells.forEach(function (c, k) {
        var bx = M + k * (bw + gap), cy = y + 6;
        doc.setFillColor(SOFT[0], SOFT[1], SOFT[2]); doc.roundedRect(bx, y, bw, bh, 2.5, 2.5, 'F');
        font('bold', 14); color(BLUE);
        c.v.forEach(function (ln) { doc.text(ln, bx + 4, cy + 3.5); cy += lh(14, 1.15); });
        cy += 1.5; font('normal', 8); color(MUTED);
        c.l.forEach(function (ln) { doc.text(ln, bx + 4, cy + 2.6); cy += lh(8, 1.3); });
      });
      y += bh + gap;
    }
  }

  var ch = storyParagraphs(d.challenge);
  if (ch.length) {
    heading('Challenge');
    ch.forEach(function (p, i) { if (i) y += 2; para(p, 10.5, 'normal', INK); });
  }

  var sol = storyParagraphs(d.solution);
  if (sol.length) {
    heading('Solution');
    sol.forEach(function (p, i) { if (i) y += 2; para(p, 10.5, 'normal', INK); });
  }

  var results = (d.results || []).filter(Boolean);
  if (results.length) {
    heading('Results');
    results.forEach(function (t) {
      font('normal', 10.5);
      var lines = doc.splitTextToSize(pdfSafe(t), CW - 6), step = lh(10.5);
      lines.forEach(function (ln, k) {
        ensure(step);
        if (!k) { doc.setFillColor(BLUE[0], BLUE[1], BLUE[2]); doc.circle(M + 1.2, y + step * 0.5, 0.8, 'F'); }
        color(INK); doc.text(ln, M + 6, y + step * 0.75); y += step;
      });
      y += 1;
    });
  }

  if (d.tech) { heading('Technology'); para(d.tech, 10, 'normal', MUTED); }

  if (d.quote) {
    heading('Client voice');
    para('“' + d.quote + '”', 11.5, 'italic', INK);
    if (d.quote_author) { y += 1; para('— ' + d.quote_author, 9.5, 'normal', MUTED); }
  }

  // Rodapé com paginação
  var n = doc.getNumberOfPages();
  for (var p = 1; p <= n; p++) {
    doc.setPage(p);
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.3); doc.line(M, H - 13, W - M, H - 13);
    font('normal', 8); color(MUTED);
    doc.text(pdfSafe((d.c || '') + ' · Success Story'), M, H - 8.5);
    doc.text(p + ' / ' + n, W - M, H - 8.5, { align: 'right' });
  }

  doc.setProperties({ title: pdfSafe(d.t), subject: pdfSafe(d.c), author: 'Noesis', creator: 'LeadSeeker' });
  return doc;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { pdfSafe, storyLabel, storyFileName, storyParagraphs, buildStoryPdf };
}
