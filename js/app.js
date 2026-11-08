// Norte Dashboard — página principal (KPIs, filtros, lista de contas e janelas popup)
/* global esc, sameClient, matchedBrand, buildStoryPdf, storyFileName, buildMinutesPdf, fmtEur, fmtRevenue, fmtPct, fmtDate,
   channelLabel, todayIso, matchesActivity, toneFor, minuteFileName, CHANNEL_LABELS, pctDelta, fmtDelta, fmtSat */
(function () {
  'use strict';

  var DATA = { companies: [], kpis: null }, STORIES = [];
  var $ = function (id) { return document.getElementById(id); };
  var els = {
    market: $('f-market'), hq: $('f-hq'), company: $('f-company'), activity: $('f-activity'),
    count: $('count'), ctx: $('ctx'), tbody: $('tbody'), hint: $('hint')
  };

  var ICON = {
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'
  };

  // ---------------- Utilitários ----------------
  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', headers: {} };
    if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    return fetch(path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error(d.error || ('Erro ' + r.status));
        return d;
      });
    });
  }

  var toastT;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('on'); }, 2600);
  }

  // Modais empilháveis: cada janela abre por cima da anterior.
  var stack = [];
  function openSheet(html, opts) {
    opts = opts || {};
    var ov = document.createElement('div');
    ov.className = 'overlay';
    ov.style.zIndex = 100 + stack.length * 10;
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    ov.innerHTML = '<div class="sheet' + (opts.wide ? ' wide' : '') + '"><button class="close" aria-label="Fechar">×</button>' + html + '</div>';
    document.body.appendChild(ov);
    var sheet = ov.firstChild;
    var entry = { ov: ov, sheet: sheet, onClose: opts.onClose };
    stack.push(entry);
    sheet.querySelector('.close').onclick = function () { closeSheet(entry); };
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) closeSheet(entry); });
    var f = sheet.querySelector('input,select,textarea'); if (f && opts.focus !== false) setTimeout(function () { f.focus(); }, 30);
    return entry;
  }
  function closeSheet(entry) {
    entry = entry || stack[stack.length - 1];
    if (!entry) return;
    var i = stack.indexOf(entry);
    if (i === -1) return;
    stack.splice(i, 1);
    entry.ov.remove();
    if (entry.onClose) entry.onClose();
  }
  function setSheet(entry, html) {
    entry.sheet.innerHTML = '<button class="close" aria-label="Fechar">×</button>' + html;
    entry.sheet.querySelector('.close').onclick = function () { closeSheet(entry); };
  }

  function byId(id) { return DATA.companies.filter(function (c) { return c.id === id; })[0]; }
  function storiesFor(name) { return STORIES.filter(function (s) { return sameClient(name, s.c); }); }
  function txt(v) { return esc(v == null ? '' : v); }
  function fieldVal(root, name) { var el = root.querySelector('[name="' + name + '"]'); return el ? el.value : ''; }

  // ---------------- Carregamento ----------------
  function load() {
    return Promise.all([
      api('/api/dashboard'),
      STORIES.length ? Promise.resolve({ stories: STORIES }) : api('/api/stories').catch(function () { return { stories: [] }; })
    ]).then(function (res) {
      DATA = res[0];
      STORIES = res[1].stories || [];
      fillFilters();
      renderKpis();
      render();
      $('gen').textContent = 'Atualizado ' + new Date(DATA.generated_at).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' });
    });
  }
  function refresh() { return load().catch(function (e) { toast(e.message); }); }

  function fillSelect(sel, values, allLabel) {
    var cur = sel.value;
    sel.innerHTML = '<option value="">' + esc(allLabel) + '</option>' +
      values.map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + '</option>'; }).join('');
    sel.value = values.indexOf(cur) !== -1 ? cur : '';
  }
  function uniq(list) { return Array.from(new Set(list.filter(Boolean))).sort(function (a, b) { return a.localeCompare(b, 'pt'); }); }

  function fillFilters() {
    var C = DATA.companies;
    fillSelect(els.market, uniq(C.map(function (c) { return c.market; })), 'Todos os mercados');
    fillSelect(els.hq, uniq(C.map(function (c) { return c.headquarters; })), 'Todos os concelhos');
    fillCompanies();
    var act = C.filter(function (c) { return c.n_contacts || c.pipeline_total || c.volume_eur; }).length;
    els.hint.textContent = C.length + ' empresas do Norte · ' + act + ' com atividade registada · ' +
      C.filter(function (c) { return storiesFor(c.name).length; }).length + ' com experiência comprovada';
  }
  function fillCompanies() {
    var mk = els.market.value, hq = els.hq.value;
    fillSelect(els.company, uniq(DATA.companies.filter(function (c) {
      return (!mk || c.market === mk) && (!hq || c.headquarters === hq);
    }).map(function (c) { return c.name; })), 'Todas as empresas');
  }

  // ---------------- KPIs ----------------
  function kpi(id, value, sub, tone) {
    var el = $(id);
    var v = el.querySelector('[data-v]');
    v.innerHTML = value; v.className = 'k-value ' + (tone || '');
    el.querySelector('[data-s]').innerHTML = sub;
    return el;
  }
  function renderKpis() {
    var k = DATA.kpis;
    var t = k.target;
    var el = kpi('kpi-target', t.pct == null ? '—' : fmtPct(t.pct, 1),
      t.source === 'planos'
        ? fmtEur(t.achieved_eur) + ' atual de ' + fmtEur(t.target_eur) + ' de target · ' + t.accounts + (t.accounts === 1 ? ' plano' : ' planos') + ' de ' + t.year
        : (t.target_eur ? fmtEur(t.achieved_eur) + ' vendido de ' + fmtEur(t.target_eur) + ' em ' + t.year
          : 'Sem planos de conta com target para ' + t.year),
      toneFor(t.pct, 100, 60));
    el.querySelector('[data-bar]').style.width = Math.min(100, t.pct || 0) + '%';

    var n = k.nrr;
    kpi('kpi-nrr', n.pct == null ? '—' : fmtPct(n.pct, 0),
      n.accounts ? fmtEur(n.current_eur) + ' atual vs ' + fmtEur(n.baseline_eur) + ' no final de ' + (t.year - 1) + ' · ' + n.accounts + (n.accounts === 1 ? ' conta' : ' contas')
        : 'Adiciona planos de conta com situação inicial e atual', toneFor(n.pct, 100, 90));

    kpi('kpi-pipeline', k.pipeline.count + '<small>' + (k.pipeline.count === 1 ? 'proposta' : 'propostas') + '</small>',
      fmtEur(k.pipeline.value_eur) + ' em carteira (em qualificação, negociação ou entregues)');

    var cv = k.conversions;
    kpi('kpi-conv', cv.won + '<small>' + (cv.won === 1 ? 'venda' : 'vendas') + '</small>',
      fmtEur(cv.won_eur) + ' ganhos · win rate ' + (cv.win_rate == null ? '—' : fmtPct(cv.win_rate)) + ' (' + cv.won + ' ganhas / ' + cv.lost + ' perdidas)');

    var s = k.satisfaction, sp = s.plan || {};
    var planLine = sp.accounts ? 'Planos: atual ' + fmtSat(sp.current) + ' · target ' + fmtSat(sp.target) + ' · inicial ' + fmtSat(sp.initial) : '';
    if (s.nps != null) {
      kpi('kpi-sat', (s.nps > 0 ? '+' : '') + s.nps + '<small>NPS</small>',
        'CSAT ' + (s.csat == null ? '—' : s.csat.toLocaleString('pt-PT', { maximumFractionDigits: 1 }) + '/5') + ' · ' + s.responses + (s.responses === 1 ? ' resposta' : ' respostas') + ' em 12 meses' +
        (planLine ? '<br>' + planLine : ''), s.nps >= 30 ? 'good' : s.nps >= 0 ? 'warn' : 'badv');
    } else if (sp.accounts) {
      kpi('kpi-sat', fmtSat(sp.current).replace('/10', '') + '<small>/10</small>',
        'Média atual dos planos de conta · target ' + fmtSat(sp.target) + ' · inicial ' + fmtSat(sp.initial),
        sp.target != null ? (sp.current >= sp.target ? 'good' : 'warn') : '');
    } else {
      kpi('kpi-sat', '—', 'Sem avaliações nem planos de conta com satisfação');
    }
  }

  var HELP = {
    nrr: '<h2>Net Revenue Retention</h2><div class="sub">Análise do portfólio: situação inicial vs situação atual</div>' +
      '<p>Vem dos <b>planos estratégicos de conta</b> do ano corrente (clicar no nome da empresa → Adicionar plano). Cada plano regista a <b>situação inicial</b> (volume de negócio no final do ano anterior) e a <b>situação atual</b> (volume na data do registo).</p>' +
      '<p><b>NRR = Σ situação atual ÷ Σ situação inicial</b>, somando as contas com as duas situações preenchidas. Acima de 100% o portfólio cresceu; abaixo, está a contrair.</p>',
    target: '<h2>Atingimento do target</h2><div class="sub">Vendas face ao objetivo do ano</div>' +
      '<p>Com planos de conta: <b>Σ situação atual ÷ Σ target</b> dos planos do ano corrente. Cada plano mostra também o desvio da conta face ao seu target.</p>' +
      '<p>Sem planos, usa o target global (botão <b>Definir target</b>) e as vendas registadas no ano.</p>',
    pipeline: '<h2>Volume do pipeline</h2><div class="sub">Fonte: PACE (pipeline.luispedroalvim.dev)</div>' +
      '<p>Conta as propostas e serviços de IT Advisory do PACE associados às 100 empresas do Norte que ainda estão <b>em carteira</b>: em qualificação, em negociação ou entregues a aguardar decisão. Os papers de marketing ficam de fora.</p>' +
      '<p>A associação faz-se pelo nome do cliente (as mesmas regras do LeadSeeker). Quando falha, associa ou retira a proposta na janela do pipeline de cada empresa.</p>',
    conv: '<h2>Conversões em venda</h2><div class="sub">Oportunidades que passaram a negócio efetivo</div>' +
      '<p>Número de propostas das contas do Norte com estado <b>Ganha</b> no PACE e o respetivo valor. O <b>win rate</b> é ganhas ÷ (ganhas + perdidas); propostas canceladas ou em que se decidiu não avançar não entram.</p>' +
      '<p>Na janela do pipeline, o botão <b>Registar venda</b> passa uma proposta ganha para o volume de negócio da conta.</p>',
    sat: '<h2>Satisfação do cliente</h2><div class="sub">Como obter e registar esta informação</div>' +
      '<p>Propomos duas perguntas curtas, feitas ao interlocutor principal de cada conta:</p>' +
      '<ul><li><b>NPS</b>: “De 0 a 10, qual a probabilidade de recomendar a Noesis a um colega?” (9 e 10 promotores, 0 a 6 detratores).</li>' +
      '<li><b>CSAT</b>: “De 1 a 5, quão satisfeito está com o serviço prestado nos últimos meses?”</li></ul>' +
      '<p style="margin-top:10px">Momentos de recolha: no fecho de cada projeto, nas reuniões trimestrais de revisão (QBR) e, pelo menos, uma vez por ano em cada conta ativa. As respostas ficam na ficha da conta, separador <b>Satisfação</b>.</p>' +
      '<p>O cartão mostra o NPS (% promotores − % detratores) e a média CSAT dos últimos 12 meses.</p>'
  };
  document.querySelectorAll('[data-help]').forEach(function (b) {
    b.onclick = function () { openSheet(HELP[b.dataset.help], { focus: false }); };
  });
  $('btn-target').onclick = openTarget;

  function openTarget() {
    var t = DATA.kpis ? DATA.kpis.target : { year: new Date().getFullYear() };
    var e = openSheet('<h2>Target de Sales</h2><div class="sub">Objetivo de negócio efetivo para as contas do Norte</div>' +
      '<form class="form" id="tg"><div><label>Ano</label><input name="year" type="number" min="2020" max="2100" value="' + esc(t.year) + '"></div>' +
      '<div><label>Target (€)</label><input name="eur" inputmode="decimal" placeholder="ex.: 2500000" value="' + esc(t.target_eur == null ? '' : t.target_eur) + '"></div>' +
      '<div class="full err" id="tg-err"></div>' +
      '<div class="full form-foot"><button type="button" class="btn ghost" data-x>Cancelar</button><button class="btn">Guardar</button></div></form>');
    var f = e.sheet.querySelector('#tg');
    f.querySelector('[data-x]').onclick = function () { closeSheet(e); };
    f.onsubmit = function (ev) {
      ev.preventDefault();
      api('/api/settings', { method: 'PUT', body: { sales_target_year: f.year.value, sales_target_eur: f.eur.value } })
        .then(function () { closeSheet(e); toast('Target guardado'); refresh(); })
        .catch(function (er) { $('tg-err').textContent = er.message; });
    };
  }

  // ---------------- Lista ----------------
  function render() {
    var mk = els.market.value, hq = els.hq.value, co = els.company.value, ac = els.activity.value;
    var items = DATA.companies.filter(function (c) {
      return (!mk || c.market === mk) && (!hq || c.headquarters === hq) && (!co || c.name === co) && matchesActivity(c, ac);
    });
    els.count.textContent = items.length + (items.length === 1 ? ' empresa' : ' empresas');
    var actLabel = ac ? els.activity.options[els.activity.selectedIndex].text : '';
    els.ctx.textContent = (mk || hq || co || ac) ? [mk, hq, co, actLabel].filter(Boolean).join(' · ') : 'Ranking regional por volume de negócios';

    if (!items.length) {
      els.tbody.innerHTML = '<tr class="status-row"><td colspan="8">Sem resultados para estes filtros.</td></tr>';
      return;
    }
    els.tbody.innerHTML = items.map(function (c) {
      var st = storiesFor(c.name);
      return '<tr data-id="' + esc(c.id) + '">' +
        '<td><span class="rank' + (c.volume_eur > 0 ? ' top' : '') + '">' + c.region_rank + '</span></td>' +
        '<td><button class="name" data-act="account" title="Abrir ficha de conta">' + txt(c.name) + '</button>' +
          '<div class="sub">' + [c.headquarters, c.revenue_eur_m ? fmtRevenue(c.revenue_eur_m) + (c.revenue_year ? ' (' + c.revenue_year + ')' : '') : null].filter(Boolean).map(esc).join(' · ') + '</div>' +
          (c.plan ? '<button class="plan-dot" data-act="account" title="Ver plano estratégico">Plano ' + c.plan.year +
            (c.plan.deviation_pct != null ? ' · ' + fmtDelta(c.plan.deviation_pct) + ' vs target' : '') + '</button>'
            : '<button class="plan-add" data-act="account" title="Adicionar plano estratégico">+ Plano</button>') + '</td>' +
        '<td>' + txt(c.market || '—') + '</td>' +
        '<td><div class="icons">' +
          '<button class="ic" data-act="new-contact" title="Novo registo de contacto" aria-label="Novo registo de contacto">' + ICON.plus + '</button>' +
          '<button class="ic" data-act="contacts" title="Ver contactos" aria-label="Ver contactos"' + '>' + ICON.eye +
            (c.n_contacts ? '<span class="cnt">' + c.n_contacts + '</span>' : '') + '</button></div>' +
          (c.last_contact ? '<div class="ic-last">Último: ' + fmtDate(c.last_contact) + '</div>' : '') + '</td>' +
        '<td><button class="pl-btn' + (c.pipeline_open ? ' has' : '') + '" data-act="pipeline" title="Ver propostas em carteira">' + c.pipeline_open + '</button>' +
          (c.pipeline_open_eur ? '<div class="sub num">' + fmtEur(c.pipeline_open_eur) + '</div>' : (c.pipeline_total > c.pipeline_open ? '<div class="sub">' + (c.pipeline_total - c.pipeline_open) + ' fechadas</div>' : '')) + '</td>' +
        '<td class="num">' + (c.volume_eur ? '<b>' + fmtEur(c.volume_eur) + '</b>' : '—') +
          (c.n_deals ? '<div class="sub">' + c.n_deals + (c.n_deals === 1 ? ' venda' : ' vendas') + '</div>' : '') + '</td>' +
        '<td class="num">' + (c.n_decisors > 0
          ? '<button class="badge-n" data-act="decisors" title="Ver decisores">' + c.n_decisors + (c.n_decisors === 1 ? ' decisor' : ' decisores') + '</button>' : '—') + '</td>' +
        '<td style="text-align:center">' + (st.length
          ? '<button class="ver" data-act="stories">Ver</button><span class="exp-n">' + st.length + (st.length === 1 ? ' story' : ' stories') + '</span>'
          : '<button class="ver" disabled>Sem</button>') + '</td></tr>';
    }).join('');
  }

  els.tbody.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var c = byId(b.closest('tr').dataset.id);
    if (!c) return;
    ({
      account: openAccount, 'new-contact': function (x) { openContactForm(x); }, contacts: openContacts,
      pipeline: openPipeline, decisors: openDecisors, stories: openStories
    })[b.dataset.act](c);
  });

  [els.market, els.hq].forEach(function (s) { s.addEventListener('change', function () { fillCompanies(); render(); }); });
  [els.company, els.activity].forEach(function (s) { s.addEventListener('change', render); });
  $('btn-reset').onclick = function () { els.market.value = ''; els.hq.value = ''; els.activity.value = ''; fillCompanies(); els.company.value = ''; render(); };

  // ---------------- Gestão de contactos ----------------
  function agendaRow(a, i) {
    return '<div class="agenda-row"><span class="n">Ponto ' + (i + 1) + '</span><button type="button" class="rm" title="Remover ponto" aria-label="Remover ponto">×</button>' +
      '<input data-a="point" placeholder="Ponto da agenda" value="' + esc(a.point || '') + '">' +
      '<textarea data-a="notes" placeholder="O que foi dito sobre este ponto">' + esc(a.notes || '') + '</textarea></div>';
  }

  function openContactForm(c, existing, after) {
    var x = existing || { contact_date: todayIso(), channel: 'presencial', agenda: [{}, {}], attachments: [] };
    var agenda = x.agenda && x.agenda.length ? x.agenda : [{}];
    var keep = (x.attachments || []).slice();
    var e = openSheet(
      '<h2>' + (existing ? 'Editar contacto' : 'Novo contacto') + '</h2><div class="sub">' + txt(c.name) + ' · registo no formato de ata de reunião</div>' +
      '<form class="form" id="cf" autocomplete="off">' +
        '<div class="full"><label>Título</label><input name="title" required maxlength="300" placeholder="ex.: Reunião de apresentação da oferta Managed Platforms" value="' + esc(x.title || '') + '"></div>' +
        '<div><label>Data do contacto</label><input name="contact_date" type="date" required value="' + esc(x.contact_date || '') + '"></div>' +
        '<div><label>Canal</label><select name="channel">' + Object.keys(CHANNEL_LABELS).map(function (k) {
          return '<option value="' + k + '"' + (x.channel === k ? ' selected' : '') + '>' + CHANNEL_LABELS[k] + '</option>'; }).join('') + '</select></div>' +
        '<div class="full"><label>Quem esteve na reunião</label><textarea name="attendees" placeholder="Um participante por linha: nome, cargo, empresa">' + esc(x.attendees || '') + '</textarea></div>' +
        '<div class="full"><label>Agenda e o que foi dito em cada ponto</label><div id="ag">' + agenda.map(agendaRow).join('') + '</div>' +
          '<button type="button" class="btn ghost sm" id="ag-add">+ Adicionar ponto</button></div>' +
        '<div class="full"><label>Decisões</label><textarea name="decisions" placeholder="Decisões tomadas">' + esc(x.decisions || '') + '</textarea></div>' +
        '<div class="full"><label>Próximos passos</label><textarea name="next_steps" placeholder="Ação · responsável · data">' + esc(x.next_steps || '') + '</textarea></div>' +
        '<div class="full"><label>Anexos (opcional, até 3 MB cada)</label><input type="file" name="files" multiple>' +
          '<ul class="files" id="keep">' + keep.map(function (a, i) { return '<li>' + esc(a.name) + ' <button type="button" class="btn-reset" data-rm="' + i + '">remover</button></li>'; }).join('') + '</ul></div>' +
        '<div class="full err" id="cf-err"></div>' +
        '<div class="full form-foot"><button type="button" class="btn ghost" data-x>Cancelar</button><button class="btn" id="cf-save">Guardar contacto</button></div>' +
      '</form>', { wide: true });
    var f = e.sheet.querySelector('#cf'), ag = f.querySelector('#ag');
    function renum() { ag.querySelectorAll('.agenda-row .n').forEach(function (n, i) { n.textContent = 'Ponto ' + (i + 1); }); }
    f.querySelector('#ag-add').onclick = function () {
      ag.insertAdjacentHTML('beforeend', agendaRow({}, ag.children.length));
      ag.lastChild.querySelector('input').focus();
    };
    ag.addEventListener('click', function (ev) {
      if (!ev.target.classList.contains('rm')) return;
      ev.target.parentNode.remove(); if (!ag.children.length) ag.insertAdjacentHTML('beforeend', agendaRow({}, 0)); renum();
    });
    f.querySelector('#keep').addEventListener('click', function (ev) {
      var i = ev.target.dataset.rm; if (i == null) return;
      keep[+i] = null; ev.target.parentNode.remove();
    });
    f.querySelector('[data-x]').onclick = function () { closeSheet(e); };
    f.onsubmit = function (ev) {
      ev.preventDefault();
      var err = f.querySelector('#cf-err'), btn = f.querySelector('#cf-save');
      err.textContent = '';
      var files = Array.from(f.files.files || []);
      var big = files.filter(function (fl) { return fl.size > 3 * 1024 * 1024; });
      if (big.length) { err.textContent = 'Anexo acima de 3 MB: ' + big.map(function (b) { return b.name; }).join(', '); return; }
      btn.disabled = true; btn.textContent = files.length ? 'A enviar anexos…' : 'A guardar…';
      Promise.all(files.map(function (fl) { return uploadFile(c.id, fl); })).then(function (uploaded) {
        btn.textContent = 'A guardar…';
        var body = {
          company_id: c.id,
          title: f.title.value, contact_date: f.contact_date.value, channel: f.channel.value,
          attendees: f.attendees.value, decisions: f.decisions.value, next_steps: f.next_steps.value,
          agenda: Array.from(ag.querySelectorAll('.agenda-row')).map(function (r) {
            return { point: r.querySelector('[data-a=point]').value, notes: r.querySelector('[data-a=notes]').value };
          }),
          attachments: keep.filter(Boolean).concat(uploaded)
        };
        return existing ? api('/api/contacts?id=' + encodeURIComponent(existing.id), { method: 'PUT', body: body })
          : api('/api/contacts', { method: 'POST', body: body });
      }).then(function () {
        closeSheet(e);
        toast(existing ? 'Contacto atualizado' : 'Contacto registado');
        refresh();
        if (after) after();
      }).catch(function (er) {
        err.textContent = er.message; btn.disabled = false; btn.textContent = 'Guardar contacto';
      });
    };
  }

  function uploadFile(companyId, file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(',')[1] || ''); };
      r.onerror = function () { reject(new Error('Não foi possível ler ' + file.name)); };
      r.readAsDataURL(file);
    }).then(function (b64) {
      return api('/api/files', { method: 'POST', body: { company_id: companyId, name: file.name, type: file.type, data: b64 } });
    });
  }

  function openContacts(c) {
    var e = openSheet('<h2>' + txt(c.name) + '</h2><div class="sub">A carregar contactos…</div>', { focus: false });
    function draw() {
      api('/api/contacts?company_id=' + encodeURIComponent(c.id)).then(function (d) {
        var list = d.contacts || [];
        setSheet(e, '<h2>' + txt(c.name) + '</h2><div class="sub">Gestão de contactos · ' + list.length + (list.length === 1 ? ' registo' : ' registos') + ', do mais recente para o mais antigo</div>' +
          '<div class="bar"><span></span><button class="btn sm" id="nc">+ Novo contacto</button></div>' +
          (list.length ? list.map(function (x) {
            return '<div class="item"><div class="body"><div class="t">' + txt(x.title) + '</div>' +
              '<div class="m"><span class="tag">' + fmtDate(x.contact_date) + '</span><span class="tag">' + esc(channelLabel(x.channel)) + '</span></div></div>' +
              '<button class="ic" data-id="' + esc(x.id) + '" title="Ver o registo completo" aria-label="Ver o registo completo">' + ICON.eye + '</button></div>';
          }).join('') : '<div class="empty">Ainda não há contactos registados com esta empresa.</div>'));
        e.sheet.querySelector('#nc').onclick = function () { openContactForm(c, null, draw); };
        e.sheet.querySelectorAll('.ic[data-id]').forEach(function (b) {
          b.onclick = function () { openContactDetail(c, b.dataset.id, draw); };
        });
      }).catch(function (er) { setSheet(e, '<h2>' + txt(c.name) + '</h2><div class="empty">' + esc(er.message) + '</div>'); });
    }
    draw();
  }

  function section(label, body) {
    return body ? '<div class="sec"><div class="lbl">' + label + '</div><div class="txt">' + esc(body) + '</div></div>' : '';
  }

  function openContactDetail(c, id, onChange) {
    var e = openSheet('<h2>A carregar…</h2>', { wide: true, focus: false });
    api('/api/contacts?id=' + encodeURIComponent(id)).then(function (d) {
      var x = d.contact;
      var agenda = (x.agenda || []).filter(function (a) { return a.point || a.notes; });
      setSheet(e, '<div class="minute"><h2>' + txt(x.title) + '</h2>' +
        '<div class="sub">' + txt(c.name) + '</div>' +
        '<div class="m" style="display:flex;gap:6px;flex-wrap:wrap"><span class="tag">' + fmtDate(x.contact_date) + '</span><span class="tag">' + esc(channelLabel(x.channel)) + '</span></div>' +
        '<div class="bar" style="margin-top:16px"><div class="left"><button class="btn sm" id="pdf">Ver e descarregar PDF</button><button class="btn ghost sm" id="ed">Editar</button></div>' +
          '<button class="btn danger sm" id="del">Eliminar</button></div>' +
        section('Quem esteve na reunião', x.attendees) +
        (agenda.length ? '<div class="sec"><div class="lbl">Agenda e discussão</div><ol>' + agenda.map(function (a) {
          return '<li><b>' + txt(a.point || '—') + '</b>' + (a.notes ? '<span class="txt">' + esc(a.notes) + '</span>' : '') + '</li>';
        }).join('') + '</ol></div>' : '') +
        section('Decisões', x.decisions) + section('Próximos passos', x.next_steps) +
        ((x.attachments || []).length ? '<div class="sec"><div class="lbl">Anexos</div><ul>' + x.attachments.map(function (a) {
          return '<li><a href="/api/files?key=' + encodeURIComponent(a.key) + '" target="_blank" rel="noopener">' + esc(a.name) + '</a></li>';
        }).join('') + '</ul></div>' : '') + '</div>');
      e.sheet.querySelector('#pdf').onclick = function () { openMinutesPdf(c, x); };
      e.sheet.querySelector('#ed').onclick = function () {
        closeSheet(e); openContactForm(c, x, onChange);
      };
      e.sheet.querySelector('#del').onclick = function () {
        var b = this;
        if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Confirmar eliminação'; return; }
        api('/api/contacts?id=' + encodeURIComponent(x.id), { method: 'DELETE' }).then(function () {
          closeSheet(e); toast('Contacto eliminado'); refresh(); if (onChange) onChange();
        }).catch(function (er) { toast(er.message); });
      };
    }).catch(function (er) { setSheet(e, '<div class="empty">' + esc(er.message) + '</div>'); });
  }

  // ---------------- PDF (pré-visualização + download) ----------------
  var pdf = { modal: $('pdfmodal'), title: $('pdf-title'), body: $('pdf-body'), dl: $('pdf-dl'), url: null, req: 0, lib: null };
  function loadJsPdf() {
    if (window.jspdf) return Promise.resolve(window.jspdf.jsPDF);
    if (!pdf.lib) pdf.lib = new Promise(function (resolve, reject) {
      var sc = document.createElement('script'); sc.src = '/js/vendor/jspdf.umd.min.js';
      sc.onload = function () { window.jspdf ? resolve(window.jspdf.jsPDF) : reject(new Error('jsPDF')); };
      sc.onerror = function () { pdf.lib = null; reject(new Error('jsPDF')); };
      document.head.appendChild(sc);
    });
    return pdf.lib;
  }
  function pdfMsg(html) { pdf.body.innerHTML = '<div class="pdf-msg">' + html + '</div>'; }
  function closePdf() {
    pdf.req++; pdf.modal.classList.remove('on'); pdf.body.innerHTML = '';
    if (pdf.url) { URL.revokeObjectURL(pdf.url); pdf.url = null; }
  }
  function showPdf(title, sub, build, fileName) {
    var my = ++pdf.req;
    if (pdf.url) { URL.revokeObjectURL(pdf.url); pdf.url = null; }
    pdf.title.innerHTML = esc(title) + (sub ? ' <span class="pc">· ' + esc(sub) + '</span>' : '');
    pdf.dl.setAttribute('aria-disabled', 'true'); pdf.dl.href = '#'; pdf.dl.removeAttribute('download');
    pdfMsg('A preparar o PDF…');
    pdf.modal.classList.add('on');
    Promise.resolve(build()).then(function (doc) {
      if (my !== pdf.req) return;
      pdf.url = URL.createObjectURL(doc.output('blob'));
      pdf.dl.href = pdf.url; pdf.dl.setAttribute('download', fileName()); pdf.dl.setAttribute('aria-disabled', 'false');
      if (navigator.pdfViewerEnabled === false) pdfMsg('Este browser não mostra PDFs dentro da página.<br>Usa “Descarregar PDF” para o abrir.');
      else pdf.body.innerHTML = '<iframe title="Pré-visualização do PDF" src="' + pdf.url + '#view=FitH"></iframe>';
    }).catch(function () { if (my === pdf.req) pdfMsg('Não foi possível gerar o PDF. Tenta de novo.'); });
  }
  function openMinutesPdf(c, x) {
    showPdf(x.title, c.name, function () { return loadJsPdf().then(function (J) { return buildMinutesPdf(J, c.name, x); }); },
      function () { return minuteFileName(c.name, x); });
  }
  function openStoryPdf(id) {
    var meta = STORIES.filter(function (s) { return s.id === id; })[0] || {};
    var story;
    showPdf(meta.t || 'Success story', meta.c, function () {
      return Promise.all([loadJsPdf(), api('/api/stories?id=' + encodeURIComponent(id))]).then(function (r) {
        story = r[1].story; return buildStoryPdf(r[0], story);
      });
    }, function () { return storyFileName(story); });
  }
  $('pdf-close').onclick = closePdf;
  pdf.modal.addEventListener('click', function (e) { if (e.target === pdf.modal) closePdf(); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (pdf.modal.classList.contains('on')) closePdf(); else closeSheet();
  });

  // ---------------- Pipeline ----------------
  function statusTag(s) {
    var cls = { 'Ganha': 'green', 'Em negociação': 'solid', 'Em qualificação': '', 'Entregue': '', 'Perdida': 'grey', 'Não avançar': 'grey', 'Cancelado/Revogado': 'grey' }[s];
    return '<span class="tag ' + (cls || '') + '">' + esc(s || '—') + '</span>';
  }
  function openPipeline(c) {
    var e = openSheet('<h2>' + txt(c.name) + '</h2><div class="sub">A carregar propostas do PACE…</div>', { wide: true, focus: false });
    function draw() {
      api('/api/pipeline?company_id=' + encodeURIComponent(c.id)).then(function (d) {
        var list = d.proposals || [], open = list.filter(function (p) { return p.open; });
        setSheet(e, '<h2>' + txt(c.name) + '</h2>' +
          '<div class="sub">Pipeline · ' + open.length + (open.length === 1 ? ' proposta' : ' propostas') + ' em carteira' +
            (list.length > open.length ? ' e ' + (list.length - open.length) + ' fechadas' : '') + ' · fonte <a href="https://pipeline.luispedroalvim.dev/" target="_blank" rel="noopener">PACE</a></div>' +
          (list.length ? list.map(function (p) {
            return '<div class="item"><div class="body"><div class="t">' + txt(p.ref || '(sem referência)') + '</div>' +
              '<div class="m">' + statusTag(p.status) + '<span class="tag plain">' + (p.price ? fmtEur(p.price) : 'sem valor') + '</span>' +
                '<span class="tag plain">' + esc(p.scope || '') + '</span>' +
                (p.start_date ? '<span class="tag plain">' + fmtDate(p.start_date) + (p.end_date ? ' → ' + fmtDate(p.end_date) : '') + '</span>' : '') +
                '<span class="tag grey plain" title="Cliente no PACE">' + esc(p.client) + (p.link === 'manual' ? ' · associada' : '') + '</span>' +
                (p.converted ? '<span class="tag green">Registada como venda</span>' : '') + '</div></div>' +
              '<div class="acts">' +
                (p.status === 'Ganha' && !p.converted && p.price ? '<button class="btn sm" data-conv="' + esc(p.id) + '">Registar venda</button>' : '') +
                '<button class="btn ghost sm" data-unl="' + esc(p.id) + '" title="Esta proposta não é desta empresa">Desassociar</button></div></div>';
          }).join('') : '<div class="empty">Não há propostas do PACE associadas a esta empresa.</div>') +
          '<h3>Associar proposta do PACE</h3>' +
          '<div class="bar"><div class="left" style="flex:1"><select id="cand" style="min-width:260px;flex:1"><option value="">Propostas sem conta no Norte…</option>' +
            (d.candidates || []).map(function (r) { return '<option value="' + esc(r.id) + '">' + esc(r.client + ' · ' + (r.ref || '') + ' (' + r.status + ')') + '</option>'; }).join('') +
          '</select></div><button class="btn ghost sm" id="lnk">Associar</button></div>');
        e.sheet.querySelectorAll('[data-conv]').forEach(function (b) {
          b.onclick = function () {
            b.disabled = true;
            api('/api/pipeline', { method: 'POST', body: { action: 'convert', record_id: b.dataset.conv } })
              .then(function () { toast('Venda registada no volume de negócio'); refresh(); draw(); })
              .catch(function (er) { b.disabled = false; toast(er.message); });
          };
        });
        e.sheet.querySelectorAll('[data-unl]').forEach(function (b) {
          b.onclick = function () {
            api('/api/pipeline', { method: 'POST', body: { action: 'unlink', record_id: b.dataset.unl } })
              .then(function () { toast('Proposta desassociada'); refresh(); draw(); }).catch(function (er) { toast(er.message); });
          };
        });
        e.sheet.querySelector('#lnk').onclick = function () {
          var v = e.sheet.querySelector('#cand').value; if (!v) return;
          api('/api/pipeline', { method: 'POST', body: { action: 'link', record_id: v, company_id: c.id } })
            .then(function () { toast('Proposta associada'); refresh(); draw(); }).catch(function (er) { toast(er.message); });
        };
      }).catch(function (er) { setSheet(e, '<h2>' + txt(c.name) + '</h2><div class="empty">' + esc(er.message) + '</div>'); });
    }
    draw();
  }

  // ---------------- Decisores ----------------
  function openDecisors(c) {
    var e = openSheet('<h2>' + txt(c.name) + '</h2><div class="sub">A carregar decisores…</div>', { focus: false });
    api('/api/decision-makers?company_id=' + encodeURIComponent(c.id)).then(function (d) {
      var list = d.decision_makers || [];
      setSheet(e, '<h2>' + txt(c.name) + '</h2><div class="sub">' + list.length + ' decisores · fonte <a href="https://leadseeker.luispedroalvim.dev/norte.html" target="_blank" rel="noopener">LeadSeeker</a></div>' +
        (list.length ? list.map(function (p) {
          var role = p.current_title || p.headline || p.role_category;
          return '<div class="item"><div class="body"><div class="t">' + txt(p.full_name) + '</div><div class="m">' +
            (role ? '<span class="tag plain">' + esc(role) + '</span>' : '') +
            (p.email ? '<a class="tag plain" href="mailto:' + esc(p.email) + '">' + esc(p.email) + '</a>' : '') + '</div></div>' +
            (p.linkedin_url
              ? '<a class="ic" href="' + esc(p.linkedin_url) + '" target="_blank" rel="noopener noreferrer" title="Abrir perfil público no LinkedIn" aria-label="Abrir perfil público no LinkedIn">' + ICON.eye + '</a>'
              : '<span class="ic" aria-disabled="true" title="Sem perfil LinkedIn">' + ICON.eye + '</span>') + '</div>';
        }).join('') : '<div class="empty">Sem decisores mapeados.</div>'));
    }).catch(function (er) { setSheet(e, '<div class="empty">' + esc(er.message) + '</div>'); });
  }

  // ---------------- Experiência (igual ao LeadSeeker) ----------------
  function openStories(c) {
    var st = storiesFor(c.name);
    var e = openSheet('<h2>' + txt(c.name) + '</h2>' +
      '<div class="sub">Experiência comprovada · ' + st.length + (st.length === 1 ? ' story encontrada' : ' stories encontradas') + ' no Success Stories Hub</div>' +
      st.map(function (s) {
        var brand = matchedBrand(c.name, s.c);
        return '<div class="item"><div class="body"><div class="t">' + txt(s.t) + '</div>' +
          '<div class="m"><span class="tag">' + esc(s.b) + '</span><span class="tag">' + esc(String(s.s || '').replace(/_/g, ' ')) + '</span>' +
          (brand ? '<span class="tag brand">Marca: ' + esc(brand) + '</span>' : '') + '</div></div>' +
          (s.id ? '<button class="ic" data-story="' + esc(s.id) + '" title="Ver a história completa (PDF)" aria-label="Ver a história completa em PDF">' + ICON.eye + '</button>' : '') + '</div>';
      }).join(''), { focus: false });
    e.sheet.querySelectorAll('[data-story]').forEach(function (b) { b.onclick = function () { openStoryPdf(b.dataset.story); }; });
  }

  // ---------------- Ficha de conta ----------------
  function openAccount(c, tab) {
    var e = openSheet('<h2>' + txt(c.name) + '</h2><div class="sub">A carregar a ficha de conta…</div>', { wide: true, focus: false });
    var current = tab || 'plan';
    function draw() {
      api('/api/account?company_id=' + encodeURIComponent(c.id)).then(function (d) {
        var o = d.options;
        var row = byId(c.id) || c;
        var tabs = [['plan', 'Plano estratégico'], ['volume', 'Volume de negócio'], ['sat', 'Satisfação']];
        setSheet(e, '<h2>' + txt(c.name) + '</h2>' +
          '<div class="sub">' + [row.market, row.headquarters, row.revenue_eur_m ? 'Volume de negócios ' + fmtRevenue(row.revenue_eur_m) : null, '#' + row.region_rank + ' no Norte'].filter(Boolean).map(esc).join(' · ') + '</div>' +
          '<div class="tabs" role="tablist">' + tabs.map(function (t) {
            return '<button role="tab" data-tab="' + t[0] + '" class="' + (t[0] === current ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div>' +
          '<div id="tab"></div>');
        e.sheet.querySelectorAll('[data-tab]').forEach(function (b) { b.onclick = function () { current = b.dataset.tab; draw(); }; });
        var box = e.sheet.querySelector('#tab');
        if (current === 'plan') drawPlan(box, d, false);
        if (current === 'volume') drawVolume(box, d.deals || []);
        if (current === 'sat') drawSat(box, d.satisfaction || [], o);
      }).catch(function (er) { setSheet(e, '<h2>' + txt(c.name) + '</h2><div class="empty">' + esc(er.message) + '</div>'); });
    }

    function ta(name, label, val, ph) {
      return '<div class="full"><label>' + label + '</label><textarea name="' + name + '" placeholder="' + esc(ph || '') + '">' + esc(val || '') + '</textarea></div>';
    }
    function numVal(v) { return v == null ? '' : v; }
    function deltaCls(v) { return v == null ? '' : (v >= 0 ? 'good' : 'badv'); }
    function stat(label, value, hint, cls) {
      return '<div class="stat"><div class="l">' + label + '</div><div class="v ' + (cls || '') + '">' + value + '</div>' +
        (hint ? '<div class="h">' + hint + '</div>' : '') + '</div>';
    }
    function textSec(label, v) {
      return v ? '<div class="sec"><div class="lbl">' + label + '</div><div class="txt">' + esc(v) + '</div></div>' : '';
    }

    // Plano estratégico de conta: um registo por ano, com situação inicial, atual, target e satisfação.
    function drawPlan(box, d, editing) {
      var p = d.plan, acc = d.account || {}, o = d.options, year = d.year;
      var history = (d.plans || []).filter(function (x) { return x.plan_year !== year; });
      var histHtml = history.length ? '<h3>Planos anteriores</h3>' + history.map(function (h) {
        return '<div class="item"><div class="body"><div class="t">Plano ' + h.plan_year + '</div><div class="m">' +
          '<span class="tag plain">Inicial ' + fmtEur(h.initial_volume_eur) + '</span><span class="tag plain">Atual ' + fmtEur(h.current_volume_eur) + '</span>' +
          '<span class="tag plain">Target ' + fmtEur(h.target_volume_eur) + '</span>' +
          '<span class="tag plain ' + deltaCls(pctDelta(h.current_volume_eur, h.target_volume_eur)) + '">Desvio ' + fmtDelta(pctDelta(h.current_volume_eur, h.target_volume_eur)) + '</span>' +
          '<span class="tag plain">Satisfação ' + fmtSat(h.sat_current) + '</span></div></div></div>';
      }).join('') : '';

      if (!p && !editing) {
        box.innerHTML = '<div class="empty plan-empty"><p>Esta conta ainda não tem plano estratégico para ' + year + '.</p>' +
          '<button class="tag-btn" id="add-plan">+ Adicionar plano</button></div>' + histHtml;
        box.querySelector('#add-plan').onclick = function () { drawPlan(box, d, true); };
        return;
      }

      if (!editing) {
        var evo = pctDelta(p.current_volume_eur, p.initial_volume_eur), dev = pctDelta(p.current_volume_eur, p.target_volume_eur);
        box.innerHTML = '<div class="bar"><div class="left"><span class="tag solid">Plano ' + p.plan_year + '</span>' +
            '<span class="tag">' + esc(p.status || 'rascunho') + '</span><span class="tag plain">Registo de ' + fmtDate(p.record_date) + '</span>' +
            (acc.owner ? '<span class="tag plain grey">Owner: ' + esc(acc.owner) + '</span>' : '') + (acc.tier ? '<span class="tag plain grey">' + esc(acc.tier) + '</span>' : '') + '</div>' +
            '<button class="tag-btn" id="edit-plan">Editar plano</button></div>' +
          '<h3>Volume de negócio</h3><div class="stats">' +
            stat('Situação inicial', fmtEur(p.initial_volume_eur), 'Final de ' + (p.plan_year - 1)) +
            stat('Situação atual', fmtEur(p.current_volume_eur), 'Em ' + fmtDate(p.record_date)) +
            stat('Evolução', fmtDelta(evo), 'Atual face à inicial', deltaCls(evo)) + '</div>' +
          '<div class="stats two">' +
            stat('Target', fmtEur(p.target_volume_eur), 'Final de ' + p.plan_year) +
            stat('Desvio face ao target', fmtDelta(dev), dev == null ? '' : (dev >= 0 ? 'Target atingido' : 'Faltam ' + fmtEur(p.target_volume_eur - p.current_volume_eur)), deltaCls(dev)) + '</div>' +
          '<h3>Satisfação (0 a 10)</h3><div class="stats">' +
            stat('Final de ' + (p.plan_year - 1), fmtSat(p.sat_initial)) +
            stat('Target ' + p.plan_year, fmtSat(p.sat_target)) +
            stat('Atual', fmtSat(p.sat_current), 'Em ' + fmtDate(p.record_date),
              p.sat_current != null && p.sat_target != null ? (p.sat_current >= p.sat_target ? 'good' : 'warn') : '') + '</div>' +
          '<div class="minute">' +
            textSec('Ambição para a conta', p.ambition) + textSec('Prioridades e desafios do cliente', p.priorities) +
            textSec('Objetivos', p.objectives) + textSec('Ofertas-alvo da Noesis', p.target_offers) +
            textSec('Whitespace e oportunidades', p.whitespace) + textSec('Iniciativas e plano de ação', p.initiatives) +
            textSec('Riscos e concorrência', p.risks) +
            (p.next_review ? textSec('Próxima revisão', fmtDate(p.next_review)) : '') + '</div>' + histHtml;
        box.querySelector('#edit-plan').onclick = function () { drawPlan(box, d, true); };
        return;
      }

      // Formulário (novo plano ou edição)
      var x = p || { plan_year: year, record_date: todayIso(), status: 'rascunho' };
      var prev = history.filter(function (h) { return h.plan_year === year - 1; })[0];
      if (!p && prev) { x.initial_volume_eur = prev.current_volume_eur; x.sat_initial = prev.sat_current; }
      var salesYear = (d.deals || []).filter(function (s) { return String(s.close_date).slice(0, 4) === String(year); })
        .reduce(function (s, v) { return s + Number(v.amount_eur); }, 0);
      box.innerHTML = '<form class="form" id="pf" autocomplete="off">' +
        '<div><label>Ano do plano</label><input type="number" name="plan_year" min="2020" max="2100" value="' + esc(x.plan_year) + '"' + (p ? ' readonly' : '') + '></div>' +
        '<div><label>Data do registo</label><input type="date" name="record_date" value="' + esc(x.record_date || todayIso()) + '" required></div>' +
        '<div class="full sec-h">Volume de negócio (€)</div>' +
        '<div><label>Situação inicial</label><input name="initial_volume_eur" inputmode="decimal" value="' + esc(numVal(x.initial_volume_eur)) + '" placeholder="Volume no final do ano anterior"><div class="hint" data-h="ini"></div></div>' +
        '<div><label>Situação atual</label><input name="current_volume_eur" inputmode="decimal" value="' + esc(numVal(x.current_volume_eur)) + '" placeholder="Volume na data deste registo">' +
          '<div class="hint">' + (salesYear ? 'Vendas registadas em ' + year + ': ' + fmtEur(salesYear) : 'Volume conhecido na data do registo') + '</div></div>' +
        '<div><label>Evolução</label><output class="calc" data-o="evo">—</output></div>' +
        '<div></div>' +
        '<div><label>Target</label><input name="target_volume_eur" inputmode="decimal" value="' + esc(numVal(x.target_volume_eur)) + '" placeholder="Objetivo de vendas no final do ano"><div class="hint" data-h="tgt"></div></div>' +
        '<div><label>Desvio face ao target</label><output class="calc" data-o="dev">—</output></div>' +
        '<div class="full sec-h">Satisfação do cliente (0 a 10)</div>' +
        '<div class="sat3 full">' +
          '<div><label>Satisfação inicial</label><input type="number" name="sat_initial" min="0" max="10" step="0.1" value="' + esc(numVal(x.sat_initial)) + '"><div class="hint" data-h="sini"></div></div>' +
          '<div><label>Satisfação target</label><input type="number" name="sat_target" min="0" max="10" step="0.1" value="' + esc(numVal(x.sat_target)) + '"><div class="hint" data-h="stgt"></div></div>' +
          '<div><label>Satisfação atual</label><input type="number" name="sat_current" min="0" max="10" step="0.1" value="' + esc(numVal(x.sat_current)) + '"><div class="hint">Apurada na data do registo</div></div>' +
        '</div>' +
        '<div class="full sec-h">Estratégia da conta</div>' +
        '<div><label>Estado do plano</label><select name="status">' + o.plan_status.map(function (s) {
          return '<option' + ((x.status || 'rascunho') === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></div>' +
        '<div><label>Próxima revisão</label><input type="date" name="next_review" value="' + esc(x.next_review || '') + '"></div>' +
        '<div><label>Account owner</label><input name="owner" value="' + esc(acc.owner || '') + '" placeholder="Responsável pela conta"></div>' +
        '<div><label>Tier da conta</label><select name="tier"><option value="">—</option>' + o.tiers.map(function (t) {
          return '<option' + (acc.tier === t ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select></div>' +
        ta('ambition', 'Ambição para a conta (12 a 36 meses)', x.ambition, 'Onde queremos estar nesta conta e com que posicionamento') +
        ta('priorities', 'Prioridades e desafios do cliente', x.priorities, 'Agenda estratégica, dores do negócio e de TI') +
        ta('objectives', 'Objetivos (mensuráveis)', x.objectives, 'ex.: abrir 2 novas áreas de oferta') +
        ta('target_offers', 'Ofertas-alvo da Noesis', x.target_offers, 'Ofertas e diagnósticos de entrada a posicionar') +
        ta('whitespace', 'Whitespace e oportunidades', x.whitespace, 'Áreas do cliente onde ainda não estamos') +
        ta('initiatives', 'Iniciativas e plano de ação', x.initiatives, 'Ação · responsável · data') +
        ta('risks', 'Riscos e concorrência', x.risks, 'Concorrentes incumbentes, riscos de relação') +
        '<div class="full err" id="pf-err"></div>' +
        '<div class="full form-foot">' + (p ? '<button type="button" class="btn danger" id="pf-del">Eliminar plano</button><span style="flex:1"></span>' : '') +
          '<button type="button" class="btn ghost" id="pf-cancel">Cancelar</button><button class="btn">Guardar plano</button></div></form>';
      var f = box.querySelector('#pf');
      function recalc() {
        var y = parseInt(f.plan_year.value, 10) || year;
        f.querySelector('[data-h=ini]').textContent = 'Volume conhecido no final de ' + (y - 1);
        f.querySelector('[data-h=tgt]').textContent = 'Objetivo de vendas no final de ' + y;
        f.querySelector('[data-h=sini]').textContent = 'Conhecida no final de ' + (y - 1);
        f.querySelector('[data-h=stgt]').textContent = 'A atingir no final de ' + y;
        var n = function (k) { var v = String(f[k].value).replace(/\s/g, '').replace(',', '.'); return v === '' ? null : Number(v); };
        var evo = pctDelta(n('current_volume_eur'), n('initial_volume_eur')), dev = pctDelta(n('current_volume_eur'), n('target_volume_eur'));
        var oe = f.querySelector('[data-o=evo]'), od = f.querySelector('[data-o=dev]');
        oe.textContent = fmtDelta(evo); oe.className = 'calc ' + deltaCls(evo);
        od.textContent = fmtDelta(dev); od.className = 'calc ' + deltaCls(dev);
      }
      f.addEventListener('input', recalc); recalc();
      f.querySelector('#pf-cancel').onclick = function () { drawPlan(box, d, false); };
      var del = f.querySelector('#pf-del');
      if (del) del.onclick = function () {
        if (del.dataset.confirm !== '1') { del.dataset.confirm = '1'; del.textContent = 'Confirmar eliminação'; return; }
        api('/api/account?company_id=' + encodeURIComponent(c.id) + '&plan=' + encodeURIComponent(p.id), { method: 'DELETE' })
          .then(function () { toast('Plano eliminado'); refresh(); draw(); }).catch(function (er) { toast(er.message); });
      };
      f.onsubmit = function (ev) {
        ev.preventDefault();
        var body = { section: 'plan' };
        ['plan_year', 'record_date', 'initial_volume_eur', 'current_volume_eur', 'target_volume_eur', 'sat_initial', 'sat_target', 'sat_current',
          'status', 'next_review', 'ambition', 'priorities', 'objectives', 'target_offers', 'whitespace', 'initiatives', 'risks']
          .forEach(function (k) { body[k] = fieldVal(f, k); });
        api('/api/account?company_id=' + encodeURIComponent(c.id), { method: 'PUT', body: body })
          .then(function () {
            return api('/api/account?company_id=' + encodeURIComponent(c.id), { method: 'PUT', body: { section: 'account', owner: fieldVal(f, 'owner'), tier: fieldVal(f, 'tier') } });
          })
          .then(function () { toast('Plano guardado'); refresh(); draw(); })
          .catch(function (er) { f.querySelector('#pf-err').textContent = er.message; });
      };
    }

    function drawVolume(box, deals) {
      var total = deals.reduce(function (s, x) { return s + (Number(x.amount_eur) || 0); }, 0);
      var since = new Date(); since.setMonth(since.getMonth() - 12); since = since.toISOString().slice(0, 10);
      var last12 = deals.filter(function (x) { return x.close_date >= since; }).reduce(function (s, x) { return s + Number(x.amount_eur); }, 0);
      var y = String(new Date().getFullYear());
      var thisYear = deals.filter(function (x) { return String(x.close_date).slice(0, 4) === y; }).reduce(function (s, x) { return s + Number(x.amount_eur); }, 0);
      box.innerHTML = '<div class="stats">' +
        stat('Negócio efetivo total', fmtEur(total)) + stat('Vendas em ' + y, fmtEur(thisYear)) + stat('Últimos 12 meses', fmtEur(last12)) + '</div>' +
        '<p class="sub">A situação inicial, a situação atual e o target da conta registam-se no separador <b>Plano estratégico</b>.</p>' +
        '<h3>Negócio efetivo (vendas)</h3>' +
        (deals.length ? deals.map(function (x) {
          return '<div class="item"><div class="body"><div class="t">' + txt(x.ref) + '</div><div class="m"><span class="tag plain">' + fmtEur(x.amount_eur) + '</span>' +
            '<span class="tag">' + fmtDate(x.close_date) + '</span><span class="tag plain ' + (x.source === 'pipeline' ? 'green' : 'grey') + '">' + (x.source === 'pipeline' ? 'PACE' : 'Manual') + '</span>' +
            (x.notes ? '<span class="tag plain grey">' + esc(x.notes) + '</span>' : '') + '</div></div>' +
            '<button class="btn danger sm" data-del="' + esc(x.id) + '">Remover</button></div>';
        }).join('') : '<div class="empty">Ainda não há negócio efetivo registado nesta conta.</div>') +
        '<form class="form" id="df" style="margin-top:14px">' +
          '<div class="full"><label>Nova venda</label><input name="ref" placeholder="Referência do contrato ou projeto" required></div>' +
          '<div><label>Valor (€)</label><input name="amount_eur" inputmode="decimal" required></div>' +
          '<div><label>Data de fecho</label><input name="close_date" type="date" value="' + todayIso() + '" required></div>' +
          '<div class="full"><input name="notes" placeholder="Notas (opcional)"></div>' +
          '<div class="full err" id="df-err"></div>' +
          '<div class="full form-foot"><button class="btn">Registar venda</button></div></form>';
      var df = box.querySelector('#df');
      df.onsubmit = function (ev) {
        ev.preventDefault();
        api('/api/account?company_id=' + encodeURIComponent(c.id), { method: 'POST', body: {
          kind: 'deal', ref: df.ref.value, amount_eur: df.amount_eur.value, close_date: df.close_date.value, notes: df.notes.value } })
          .then(function () { toast('Venda registada'); refresh(); draw(); })
          .catch(function (er) { df.querySelector('#df-err').textContent = er.message; });
      };
      box.querySelectorAll('[data-del]').forEach(function (b) {
        b.onclick = function () {
          if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Confirmar'; return; }
          api('/api/account?company_id=' + encodeURIComponent(c.id) + '&deal=' + encodeURIComponent(b.dataset.del), { method: 'DELETE' })
            .then(function () { toast('Venda removida'); refresh(); draw(); }).catch(function (er) { toast(er.message); });
        };
      });
    }

    function drawSat(box, list, o) {
      var nps = list.map(function (s) { return s.nps_score; }).filter(function (x) { return x != null; });
      var csat = list.map(function (s) { return s.csat_score; }).filter(function (x) { return x != null; });
      var p = nps.filter(function (x) { return x >= 9; }).length, dd = nps.filter(function (x) { return x <= 6; }).length;
      box.innerHTML = '<div class="stats">' +
        '<div class="stat"><div class="l">NPS</div><div class="v">' + (nps.length ? Math.round((p - dd) / nps.length * 100) : '—') + '</div></div>' +
        '<div class="stat"><div class="l">CSAT médio</div><div class="v">' + (csat.length ? (csat.reduce(function (s, x) { return s + x; }, 0) / csat.length).toLocaleString('pt-PT', { maximumFractionDigits: 1 }) + '/5' : '—') + '</div></div>' +
        '<div class="stat"><div class="l">Avaliações</div><div class="v">' + list.length + '</div></div></div>' +
        '<p class="sub">Pergunta NPS: “De 0 a 10, qual a probabilidade de recomendar a Noesis a um colega?” · Pergunta CSAT: “De 1 a 5, quão satisfeito está com o serviço?”</p>' +
        (list.length ? list.map(function (s) {
          return '<div class="item"><div class="body"><div class="t">' + txt(s.respondent || 'Interlocutor não indicado') + '</div><div class="m">' +
            '<span class="tag">' + fmtDate(s.survey_date) + '</span>' + (s.method ? '<span class="tag plain">' + esc(s.method) + '</span>' : '') +
            (s.nps_score != null ? '<span class="tag solid">NPS ' + s.nps_score + '</span>' : '') + (s.csat_score != null ? '<span class="tag solid">CSAT ' + s.csat_score + '/5</span>' : '') + '</div>' +
            (s.comment ? '<p class="sub" style="margin:8px 0 0">' + esc(s.comment) + '</p>' : '') + '</div>' +
            '<button class="btn danger sm" data-del="' + esc(s.id) + '">Remover</button></div>';
        }).join('') : '<div class="empty">Sem avaliações registadas.</div>') +
        '<h3>Registar avaliação</h3><form class="form" id="sf">' +
          '<div><label>Data</label><input type="date" name="survey_date" value="' + todayIso() + '" required></div>' +
          '<div><label>Momento / método</label><select name="method">' + o.survey_methods.map(function (m) { return '<option>' + m + '</option>'; }).join('') + '</select></div>' +
          '<div><label>NPS (0 a 10)</label><input type="number" name="nps_score" min="0" max="10"></div>' +
          '<div><label>CSAT (1 a 5)</label><input type="number" name="csat_score" min="1" max="5"></div>' +
          '<div class="full"><label>Interlocutor</label><input name="respondent" placeholder="Nome e cargo"></div>' +
          '<div class="full"><label>Comentário</label><textarea name="comment" placeholder="O que o cliente valoriza e o que podemos melhorar"></textarea></div>' +
          '<div class="full err" id="sf-err"></div><div class="full form-foot"><button class="btn">Registar avaliação</button></div></form>';
      var sf = box.querySelector('#sf');
      sf.onsubmit = function (ev) {
        ev.preventDefault();
        api('/api/account?company_id=' + encodeURIComponent(c.id), { method: 'POST', body: {
          kind: 'survey', survey_date: sf.survey_date.value, method: sf.method.value, nps_score: sf.nps_score.value,
          csat_score: sf.csat_score.value, respondent: sf.respondent.value, comment: sf.comment.value } })
          .then(function () { toast('Avaliação registada'); refresh(); draw(); })
          .catch(function (er) { sf.querySelector('#sf-err').textContent = er.message; });
      };
      box.querySelectorAll('[data-del]').forEach(function (b) {
        b.onclick = function () {
          if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Confirmar'; return; }
          api('/api/account?company_id=' + encodeURIComponent(c.id) + '&survey=' + encodeURIComponent(b.dataset.del), { method: 'DELETE' })
            .then(function () { toast('Avaliação removida'); refresh(); draw(); }).catch(function (er) { toast(er.message); });
        };
      });
    }
    draw();
  }

  load().catch(function (e) {
    els.tbody.innerHTML = '<tr class="status-row"><td colspan="8">Não foi possível carregar o dashboard. ' + esc(e.message) + '</td></tr>';
    els.hint.textContent = 'Erro a carregar';
  });
})();
