// Norte Dashboard — gera o PDF de um registo de contacto (ata de reunião) com jsPDF.
// Reutiliza pdfSafe() de js/story-pdf.js (fontes base do PDF só cobrem Windows-1252).

/* global pdfSafe, fmtDate, channelLabel */

function buildMinutesPdf(jsPDFCtor, company, c) {
  var safe = typeof pdfSafe === 'function' ? pdfSafe : function (s) { return String(s == null ? '' : s); };
  var doc = new jsPDFCtor({ unit: 'mm', format: 'a4' });
  var W = 210, H = 297, M = 18, CW = W - 2 * M, BOTTOM = H - 20;
  var INK = [29, 29, 31], MUTED = [110, 110, 115], BLUE = [0, 113, 227], LINE = [222, 222, 227], SOFT = [245, 245, 247];
  var y = 0;

  function color(k) { doc.setTextColor(k[0], k[1], k[2]); }
  function font(style, size) { doc.setFont('helvetica', style); doc.setFontSize(size); }
  function lh(size, f) { return size * 0.3528 * (f || 1.4); }
  function ensure(h) { if (y + h > BOTTOM) { doc.addPage(); y = M + 4; } }
  function para(text, size, style, k, opts) {
    opts = opts || {};
    var x = opts.x || M, w = opts.w || CW, step = lh(size, opts.f);
    font(style || 'normal', size); color(k || INK);
    String(text == null ? '' : text).split(/\n/).forEach(function (raw) {
      var lines = doc.splitTextToSize(safe(raw), w);
      if (!lines.length) lines = [''];
      lines.forEach(function (ln) { ensure(step); doc.text(ln, x, y + step * 0.75); y += step; });
    });
  }
  function heading(txt) {
    ensure(18);
    y += 6;
    font('bold', 8.5); color(BLUE);
    doc.text(safe(txt).toUpperCase(), M, y + 3, { charSpace: 0.6 });
    y += 5.5;
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.3); doc.line(M, y, W - M, y);
    y += 3.5;
  }

  // Cabeçalho
  doc.setFillColor(INK[0], INK[1], INK[2]); doc.rect(0, 0, W, 9, 'F');
  font('bold', 7.5); doc.setTextColor(255, 255, 255);
  doc.text('NOESIS  ·  NORTE DASHBOARD  ·  ATA DE CONTACTO', M, 5.8, { charSpace: 0.5 });
  y = 22;
  font('bold', 9); color(BLUE);
  doc.text(safe(company || '').toUpperCase(), M, y, { charSpace: 0.4 });
  y += 4;
  para(c.title, 19, 'bold', INK, { f: 1.22 });
  y += 3;

  // Caixa com data e canal
  var meta = [['Data', fmtDate(c.contact_date)], ['Canal', channelLabel(c.channel)]];
  var bw = (CW - 4) / 2;
  meta.forEach(function (m, k) {
    var bx = M + k * (bw + 4);
    doc.setFillColor(SOFT[0], SOFT[1], SOFT[2]); doc.roundedRect(bx, y, bw, 15, 2.5, 2.5, 'F');
    font('normal', 7.5); color(MUTED); doc.text(safe(m[0]).toUpperCase(), bx + 4, y + 5.5, { charSpace: 0.4 });
    font('bold', 11.5); color(BLUE); doc.text(safe(m[1]), bx + 4, y + 11.5);
  });
  y += 19;

  if (c.attendees) { heading('Participantes'); para(c.attendees, 10.5, 'normal', INK); }

  var agenda = (c.agenda || []).filter(function (a) { return a && (a.point || a.notes); });
  if (agenda.length) {
    heading('Agenda e discussão');
    agenda.forEach(function (a, i) {
      ensure(12);
      para((i + 1) + '. ' + (a.point || 'Ponto ' + (i + 1)), 11, 'bold', INK);
      if (a.notes) { y += 0.5; para(a.notes, 10.5, 'normal', INK, { x: M + 5, w: CW - 5 }); }
      y += 2.5;
    });
  }

  if (c.decisions) { heading('Decisões'); para(c.decisions, 10.5, 'normal', INK); }
  if (c.next_steps) { heading('Próximos passos'); para(c.next_steps, 10.5, 'normal', INK); }

  var att = (c.attachments || []);
  if (att.length) {
    heading('Anexos');
    att.forEach(function (a) { para('• ' + a.name, 10, 'normal', MUTED); });
  }

  var n = doc.getNumberOfPages();
  for (var p = 1; p <= n; p++) {
    doc.setPage(p);
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]); doc.setLineWidth(0.3); doc.line(M, H - 13, W - M, H - 13);
    font('normal', 8); color(MUTED);
    doc.text(safe((company || '') + ' · Ata de contacto · ' + fmtDate(c.contact_date)), M, H - 8.5);
    doc.text(p + ' / ' + n, W - M, H - 8.5, { align: 'right' });
  }
  doc.setProperties({ title: safe(c.title), subject: safe(company), author: 'Noesis', creator: 'Norte Dashboard' });
  return doc;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildMinutesPdf };
}
