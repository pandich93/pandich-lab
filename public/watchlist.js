// Pandich Lab — «Список и алерты»: watchlist with live prices + server-side price alerts (Telegram / notification), lines on the chart.
(() => {
  const A = window.QLApp; if (!A) return;
  const { S, esc, api } = A;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };
  const T = s => (window.QLI18n ? window.QLI18n.t(s) : s);
  const COND = { cross: 'пересекает', cross_up: 'пересекает вверх', cross_down: 'пересекает вниз' };
  const LEGACY = { above: 'cross_up', below: 'cross_down' };
  let list = store.get('ql.watchlist', null);
  if (!Array.isArray(list) || !list.length) list = [...new Set([S.symbol, 'XAUUSD', 'BTCUSDT', 'ETHUSDT'].filter(Boolean))];
  const saveList = () => store.set('ql.watchlist', list);
  let quotes = {}, alerts = [], tgOn = false, body = null, form = null;
  const fmtP = (q, v = q && q.price) => (Number.isFinite(v) ? (+v).toFixed(q && Number.isFinite(q.digits) ? q.digits : v >= 1000 ? 2 : v >= 10 ? 3 : 5) : '—');

  // ───────── data ─────────
  async function loadQuotes() {
    const syms = [...new Set([...list, ...alerts.map(a => a.symbol)])];
    if (!syms.length) return;
    try { const r = await fetch('/api/quotes?symbols=' + encodeURIComponent(syms.join(','))).then(x => x.json()); if (r.ok) for (const q of r.quotes) if (q) quotes[q.symbol] = q; } catch { /* offline */ }
  }
  async function loadAlerts() {
    try { const r = await api('/api/alerts'); if (r && r.ok) { alerts = r.alerts; tgOn = r.telegram; } } catch { /* offline */ }
    drawLines();
  }
  async function fetchOne(s) { try { const r = await fetch('/api/quotes?symbols=' + encodeURIComponent(s)).then(x => x.json()); if (r.ok && r.quotes[0]) quotes[s] = r.quotes[0]; } catch { /* offline */ } }
  const post = (p, b) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());

  // ───────── alert lines on the chart (current symbol) ─────────
  let lines = [];
  function drawLines() {
    for (const l of lines) { try { A.candles.removePriceLine(l); } catch { /* gone */ } }
    lines = [];
    for (const a of alerts) {
      if (!a.enabled || a.symbol !== String(S.symbol).toUpperCase()) continue;
      lines.push(A.candles.createPriceLine({ price: a.price, color: '#f0b429', lineWidth: 1, lineStyle: window.LightweightCharts.LineStyle.LargeDashed, axisLabelVisible: true, title: '🔔' + (a.note ? ' ' + a.note.slice(0, 18) : '') }));
    }
  }
  window.addEventListener('ql:render', () => drawLines());
  window.addEventListener('ql:alerts', () => { loadAlerts().then(render); });

  // ───────── panel ─────────
  window.addEventListener('ql:panel', e => { if (e.detail.id === 'wl') mount(e.detail.body); });
  function mount(b) { if (!b) return; body = b; b.classList.add('wl'); render(); loadQuotes().then(render); }
  function visible() { return body && body.isConnected && body.offsetParent !== null; }
  setInterval(async () => { if (visible() && !form) { await loadQuotes(); renderRows(); } }, 3000);
  setInterval(async () => { await loadAlerts(); if (visible() && !form) renderAlerts(); }, 15000);

  function rowHTML(s) {
    const q = quotes[s] || {}, up = (q.chg || 0) >= 0, cur = s === String(S.symbol).toUpperCase();
    return `<div class="wl-row${cur ? ' cur' : ''}" data-s="${esc(s)}" draggable="true"><span class="wl-sym" data-noi18n>${esc(s)}</span>
      <span class="wl-px" data-noi18n>${q.error ? '<span class="wl-err" title="' + esc(q.error) + '">⚠</span>' : fmtP(q)}</span>
      <span class="wl-ch ${q.error || !Number.isFinite(q.chgPct) ? '' : up ? 'pos' : 'neg'}" data-noi18n>${Number.isFinite(q.chgPct) ? (up ? '+' : '') + q.chgPct.toFixed(2) + '%' : ''}</span>
      <button class="wl-x" data-del title="Убрать из списка">✕</button></div>`;
  }
  function alertHTML(a) {
    const q = quotes[a.symbol];
    const c = COND[LEGACY[a.cond] || a.cond] || a.cond;
    return `<div class="wl-al${a.enabled ? '' : ' off'}" data-id="${a.id}">
      <label class="wl-sw" title="${a.enabled ? 'Выключить' : 'Включить'}"><input type="checkbox" data-tg ${a.enabled ? 'checked' : ''}><i></i></label>
      <div class="wl-alt"><div><b data-noi18n>${esc(a.symbol)}</b> <span>${esc(c)}</span> <b data-noi18n>${fmtP(q, a.price)}</b></div>
        <div class="muted wl-alm">${a.note ? `<span data-noi18n>${esc(a.note)}</span> · ` : ''}${a.once ? T('один раз') : T('каждый раз')}${a.fired ? ` · ${T('сработал')} ${a.fired}` : ''}${q && Number.isFinite(q.price) ? ` · ${T('сейчас')} <span data-noi18n>${fmtP(q)}</span>` : ''}</div></div>
      <button class="wl-x" data-edit title="Изменить">✎</button><button class="wl-x" data-adel title="Удалить">✕</button></div>`;
  }
  function render() {
    if (!body) return;
    if (form) return renderForm();
    body.innerHTML = `<div class="wl-sec"><div class="wl-h"><span>Список</span><div class="spacer"></div><span class="muted wl-hint">клик — открыть график</span></div>
        <div class="wl-head"><span>Символ</span><span>Цена</span><span>Изм. за день</span><span></span></div>
        <div class="wl-rows" id="wlRows"></div>
        <form class="wl-add" id="wlAdd"><input id="wlIn" placeholder="Добавить символ, например EURUSD" spellcheck="false" autocomplete="off"><button class="btn">+</button></form></div>
      <div class="wl-sec"><div class="wl-h"><span>Алерты цены</span><div class="spacer"></div><button class="btn wl-new" id="wlNew">+ Алерт</button></div>
        <div id="wlAlerts"></div>
        <div class="wt-note">${tgOn ? 'Срабатывания приходят в Telegram и уведомлением приложения. Проверка — на сервере каждые 3 с, даже когда окно закрыто (приложение в трее).' : 'Срабатывания приходят уведомлением приложения. Чтобы получать их в Telegram, подключите бота в панели Watch. Проверка — на сервере каждые 3 с.'}</div></div>`;
    renderRows(); renderAlerts();
    body.querySelector('#wlAdd').onsubmit = e => { e.preventDefault(); const v = body.querySelector('#wlIn').value.trim().toUpperCase(); if (v && !list.includes(v)) { list.push(v); saveList(); loadQuotes().then(renderRows); renderRows(); } body.querySelector('#wlIn').value = ''; };
    body.querySelector('#wlNew').onclick = () => openForm({ symbol: S.symbol });
  }
  function renderRows() {
    const el = body && body.querySelector('#wlRows'); if (!el) return;
    el.innerHTML = list.map(rowHTML).join('') || `<div class="wt-note">${T('Список пуст.')}</div>`;
    el.querySelectorAll('.wl-row').forEach(r => {
      const s = r.dataset.s;
      r.onclick = e => { if (e.target.closest('[data-del]')) { list = list.filter(x => x !== s); saveList(); renderRows(); return; } A.setChart(s, S.interval).then(() => { renderRows(); drawLines(); }); };
      r.ondragstart = e => { e.dataTransfer.setData('text/wl', s); r.classList.add('drag'); };
      r.ondragend = () => r.classList.remove('drag');
      r.ondragover = e => e.preventDefault();
      r.ondrop = e => { e.preventDefault(); const from = e.dataTransfer.getData('text/wl'); if (!from || from === s) return; list = list.filter(x => x !== from); list.splice(list.indexOf(s), 0, from); saveList(); renderRows(); };
    });
    renderAlerts();
  }
  function renderAlerts() {
    const el = body && body.querySelector('#wlAlerts'); if (!el) return;
    el.innerHTML = alerts.length ? alerts.slice().sort((a, b) => (b.enabled - a.enabled) || (b.created - a.created)).map(alertHTML).join('') : `<div class="wt-note">${T('Алертов нет. Правый клик по графику → «Алерт на этой цене».')}</div>`;
    el.querySelectorAll('.wl-al').forEach(r => {
      const a = alerts.find(x => x.id === r.dataset.id);
      r.querySelector('[data-tg]').onchange = async () => { await post('/api/alerts/toggle', { id: a.id }); await loadAlerts(); renderAlerts(); };
      r.querySelector('[data-adel]').onclick = async () => { await post('/api/alerts/delete', { id: a.id }); await loadAlerts(); renderAlerts(); };
      r.querySelector('[data-edit]').onclick = () => openForm(a);
      r.querySelector('.wl-alt').onclick = () => { if (a.symbol !== S.symbol) A.setChart(a.symbol, S.interval); };
    });
  }

  // ───────── create / edit (panel form or floating dialog from the chart menu) ─────────
  function formHTML(a) {
    const c = LEGACY[a.cond] || a.cond || 'cross';
    return `<div class="wl-form"><div class="wl-h"><span>${a.id ? 'Изменить алерт' : 'Новый алерт'}</span></div>
      <label>Символ<input id="afSym" value="${esc(a.symbol || S.symbol)}" spellcheck="false" data-noi18n></label>
      <label>Условие<select id="afCond">${Object.entries(COND).map(([k, v]) => `<option value="${k}" ${k === c ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Цена<input id="afPrice" value="${a.price ?? ''}" inputmode="decimal"></label>
      <div class="muted wl-alm" id="afNow"></div>
      <label>Заметка<input id="afNote" value="${esc(a.note || '')}" placeholder="необязательно, придёт в сообщении"></label>
      <label class="ind-bool"><input type="checkbox" id="afOnce" ${a.once === false ? '' : 'checked'}><span>Один раз (потом выключится)</span></label>
      ${tgOn ? `<label class="ind-bool"><input type="checkbox" id="afTg" ${a.telegram === false ? '' : 'checked'}><span>Отправить в Telegram</span></label>` : ''}
      <div class="wl-err" id="afErr"></div>
      <div class="wl-fbtns"><span class="spacer"></span><button class="btn" data-a="cancel">Отмена</button><button class="btn pri" data-a="save">${a.id ? 'Сохранить' : 'Создать'}</button></div></div>`;
  }
  function wireForm(root, a, done) {
    const $f = id => root.querySelector(id);
    const showNow = async () => { const s = $f('#afSym').value.trim().toUpperCase(); if (!s) return; if (!quotes[s]) await fetchOne(s); const q = quotes[s]; $f('#afNow').textContent = q && Number.isFinite(q.price) ? `${T('Сейчас')}: ${fmtP(q)}` : ''; };
    showNow(); $f('#afSym').onchange = showNow;
    $f('[data-a="cancel"]').onclick = () => done(false);
    $f('[data-a="save"]').onclick = async () => {
      const price = parseFloat(String($f('#afPrice').value).replace(',', '.'));
      const b = { id: a.id, symbol: $f('#afSym').value.trim().toUpperCase(), cond: $f('#afCond').value, price, note: $f('#afNote').value.trim(), once: $f('#afOnce').checked, telegram: $f('#afTg') ? $f('#afTg').checked : true };
      if (!b.symbol || !Number.isFinite(price)) { $f('#afErr').textContent = T('Укажите символ и цену'); return; }
      const r = await post('/api/alerts/save', b).catch(e => ({ ok: false, error: e.message }));
      if (!r.ok) { $f('#afErr').textContent = r.error; return; }
      if (window.Notification && Notification.permission === 'default') try { Notification.requestPermission(); } catch { /* unsupported */ }
      await loadAlerts(); done(true);
    };
    root.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); $f('[data-a="save"]').click(); } });
    setTimeout(() => $f('#afPrice').focus(), 30);
  }
  function openForm(a) {
    if (visible()) { form = a; render(); return; }
    // floating dialog (chart menu while the panel is closed)
    const ov = document.createElement('div'); ov.className = 'ind-ov';
    const dlg = document.createElement('div'); dlg.className = 'ind-dlg wl-dlg'; dlg.innerHTML = formHTML(a); ov.appendChild(dlg); document.body.appendChild(ov);
    const close = () => { document.removeEventListener('keydown', esc_, true); ov.remove(); };
    const esc_ = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', esc_, true);
    ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
    wireForm(dlg, a, ok => { close(); if (ok) toastOk(); });
  }
  function renderForm() {
    body.innerHTML = formHTML(form);
    wireForm(body, form, () => { form = null; render(); });
  }
  function toastOk() {
    const d = document.createElement('div'); d.className = 'wl-flash'; d.textContent = T('Алерт создан'); document.body.appendChild(d); setTimeout(() => d.remove(), 1800);
  }

  // ───────── public API (chart menu, drawings) ─────────
  window.QLAlerts = {
    create(price, symbol) { const d = (quotes[symbol || S.symbol] || {}).digits; openForm({ symbol: symbol || S.symbol, price: Number.isFinite(d) ? +(+price).toFixed(d) : +(+price).toPrecision(8), cond: 'cross' }); },
    list: () => alerts,
  };
  loadAlerts();
})();
