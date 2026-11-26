/* Pandich Lab — Watch panel: server-side signals (Pine alert()/alertcondition(), markers, strategy fills) on bar close,
   delivered to Telegram and to this browser. The server keeps watching when the page is closed. */
(() => {
'use strict';
const A = window.QLApp; if (!A || A.EMBED) return;
const S = A.S, api = A.api, esc = A.esc;
const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
const ft = t => t ? new Date(t * 1000).toISOString().slice(5, 16).replace('T', ' ') : '—';
const ago = ms => { if (!ms) return '—'; const s = Math.round((Date.now() - ms) / 1000); return s < 60 ? `${s} с назад` : s < 3600 ? `${Math.round(s / 60)} мин назад` : s < 86400 ? `${Math.round(s / 3600)} ч назад` : new Date(ms).toISOString().slice(0, 16).replace('T', ' '); };

let body = null, data = null, form = null, tgEdit = false, msg = null, savedScripts = [];

function mount(b) { if (!b) return; if (body !== b) { body = b; b.classList.add('wt'); } refresh(); } // (re)shown → fresh data
window.addEventListener('ql:panel', e => { if (e.detail.id === 'watch') mount(e.detail.body); });
mount(document.querySelector('.rpanel[data-panel="watch"] [data-body]'));

async function refresh() {
  try { data = await api('/api/watch'); } catch (e) { data = data || { watches: [], events: [], telegram: {} }; msg = { err: true, text: 'сервер недоступен: ' + e.message }; }
  render();
}
setInterval(() => { if (body && body.isConnected && body.offsetParent !== null && !form) refresh(); }, 5000);

function render() {
  if (!body || !data) return;
  const t = data.telegram || {};
  const tgOk = t.bot && t.chatId && !tgEdit;
  const ws = data.watches || [];
  body.innerHTML = `
    ${msg ? `<div class="wt-msg ${msg.err ? 'err' : ''}">${esc(msg.text)}<button data-a="msgx">✕</button></div>` : ''}
    <div class="wt-sec">
      <div class="wt-h">Telegram</div>
      ${tgOk ? `<div class="wt-row"><span class="wt-dot on"></span><span>@${esc(t.bot)} → <b>${esc(t.chatTitle || t.chatId)}</b></span><div class="spacer"></div><button class="wt-btn" data-a="tgtest">Тест</button><button class="wt-btn ghost" data-a="tgedit">Изменить</button></div>`
      : `<div class="wt-note">${t.bot && !t.chatId ? `Бот <b>@${esc(t.bot)}</b> подключён, но чат не найден. Напиши боту любое сообщение (например <code>/start</code>) и нажми «Найти чат».` : 'Создай бота у <b>@BotFather</b> (<code>/newbot</code>), вставь сюда его токен, потом напиши боту любое сообщение — чат найдётся сам.'}</div>
        <div class="wt-row"><input type="password" id="wtToken" placeholder="${t.token ? esc(t.token) + ' (оставь пустым — без изменений)' : '123456789:AA…'}" autocomplete="off"><button class="wt-btn primary" data-a="tgsave">${t.bot ? 'Найти чат' : 'Подключить'}</button>${tgEdit ? '<button class="wt-btn ghost" data-a="tgcancel">Отмена</button>' : ''}</div>
        ${t.bot ? '<div class="wt-row"><button class="wt-link" data-a="tgclear">Отключить Telegram</button></div>' : ''}`}
    </div>
    <div class="wt-sec">
      <div class="wt-h">Сигналы <span class="muted">${ws.length || ''}</span><div class="spacer"></div>${form ? '' : '<button class="wt-btn primary" data-a="new">＋ Новый</button>'}</div>
      ${form ? formHTML() : ''}
      ${ws.length ? ws.map(cardHTML).join('') : (form ? '' : `<div class="wt-note">Пока пусто. Сигнал = Pine-скрипт + символ + ТФ. Сервер пересчитывает скрипт на каждом закрытом баре и шлёт уведомление, когда срабатывает <code>alert()</code> или <code>alertcondition()</code> — даже если браузер закрыт.</div>`)}
    </div>
    <div class="wt-sec">
      <div class="wt-h">Журнал</div>
      ${(data.events || []).length ? data.events.map(evHTML).join('') : '<div class="wt-note">Срабатываний ещё не было.</div>'}
    </div>`;
  body.querySelectorAll('[data-a]').forEach(el => el.onclick = () => act(el.dataset.a, el.dataset.id));
  if (form) wireForm();
}
function cardHTML(w) {
  const st = !w.enabled ? 'off' : w.error ? 'err' : 'on';
  const trig = [w.onAlerts !== false && 'alert', w.onMarkers && 'маркеры', w.onStrategy && 'стратегия'].filter(Boolean).join(' + ');
  return `<div class="wt-card ${st}">
    <div class="wt-row"><span class="wt-dot ${st}"></span><b class="wt-name">${esc(w.name)}</b><div class="spacer"></div>
      <label class="wt-sw" title="${w.enabled ? 'Выключить' : 'Включить'}"><input type="checkbox" ${w.enabled ? 'checked' : ''} data-tg="${w.id}"><span></span></label></div>
    <div class="wt-meta">${esc(w.symbol)} · ${esc(w.interval)} · ${esc(trig)}${w.telegram !== false ? ' · Telegram' : ''}</div>
    <div class="wt-meta muted">проверен ${ago(w.lastCheck)} · бар ${ft(w.lastBar)} · срабатываний ${w.fired || 0}${w.lastFire ? ` (посл. ${ago(w.lastFire)})` : ''}</div>
    ${w.error ? `<div class="wt-meta err">${esc(w.error)}</div>` : ''}
    <div class="wt-row wt-acts"><button class="wt-btn" data-a="test" data-id="${w.id}" title="Пересчитать на последнем закрытом баре и отправить результат в Telegram (с пометкой «Тест»)">Тест</button><button class="wt-btn" data-a="chart" data-id="${w.id}">На график</button><div class="spacer"></div><button class="wt-btn ghost danger" data-a="del" data-id="${w.id}">Удалить</button></div>
  </div>`;
}
function evHTML(e) {
  return `<div class="wt-ev"><div class="wt-row"><b>${esc(e.name)}</b><span class="muted">${esc(e.symbol)} · ${esc(e.interval)}</span><div class="spacer"></div><span class="muted">${ago(e.t)}</span></div>
    <div class="wt-meta">${e.test ? '<span class="wt-tag">тест</span> ' : ''}бар ${ft(e.barTime)} · ${A.fmt(e.close, e.close >= 1000 ? 2 : e.close >= 10 ? 3 : 5)}</div>
    ${(e.hits || []).map(h => `<div class="wt-hit">• ${esc(h.text)}</div>`).join('') || '<div class="wt-meta muted">сигналов на баре нет</div>'}
    ${e.telegram && e.telegram !== 'ok' ? `<div class="wt-meta err">Telegram: ${esc(e.telegram)}</div>` : ''}</div>`;
}

// ───────── new-watch form ─────────
function formHTML() {
  const chartScripts = S.scripts.map(s => `<option value="c:${s.id}" ${form.src === 'c:' + s.id ? 'selected' : ''}>${esc(s.name)} — на графике</option>`).join('');
  const files = savedScripts.map(f => `<option value="f:${esc(f.file)}" ${form.src === 'f:' + f.file ? 'selected' : ''}>${esc(f.name)} — сохранён</option>`).join('');
  return `<div class="wt-form">
    <label>Скрипт<select id="wtSrc">${chartScripts}${files}</select></label>
    <label>Название<input id="wtName" value="${esc(form.name)}"></label>
    <div class="wt-2"><label>Символ<input id="wtSym" value="${esc(form.symbol)}"></label><label>ТФ<input id="wtTf" value="${esc(form.interval)}"></label></div>
    <div class="wt-checks">
      <label><input type="checkbox" id="wtA" ${form.onAlerts ? 'checked' : ''}> alert() / alertcondition()</label>
      <label><input type="checkbox" id="wtM" ${form.onMarkers ? 'checked' : ''}> маркеры (plotshape / plotarrow) на баре</label>
      <label><input type="checkbox" id="wtS" ${form.onStrategy ? 'checked' : ''}> сделки стратегии</label>
      <label><input type="checkbox" id="wtT" ${form.telegram ? 'checked' : ''}> отправлять в Telegram</label>
      <label><input type="checkbox" id="wtB" ${form.browser ? 'checked' : ''}> уведомление в браузере</label>
    </div>
    <div class="wt-note">Проверка — на закрытии бара, по закрытым барам (без перерисовки). В коде: <code>alertcondition(cond, "Покупка", "RSI вышел из перепроданности")</code> или <code>if cond\n    alert("текст")</code>.</div>
    <div class="wt-row"><button class="wt-btn primary" data-a="save" ${form.saving ? 'disabled' : ''}>${form.saving ? 'Проверяю скрипт…' : 'Создать сигнал'}</button><button class="wt-btn ghost" data-a="cancel">Отмена</button></div>
  </div>`;
}
function wireForm() {
  const g = id => $(id);
  g('wtSrc').onchange = e => { form.src = e.target.value; const n = srcName(form.src); if (n) { form.name = n; g('wtName').value = n; } };
  g('wtName').oninput = e => { form.name = e.target.value; };
  g('wtSym').oninput = e => { form.symbol = e.target.value; };
  g('wtTf').oninput = e => { form.interval = e.target.value; };
  for (const [id, k] of [['wtA', 'onAlerts'], ['wtM', 'onMarkers'], ['wtS', 'onStrategy'], ['wtT', 'telegram'], ['wtB', 'browser']]) g(id).onchange = e => { form[k] = e.target.checked; };
}
function srcName(src) {
  if (src.startsWith('c:')) { const s = S.scripts.find(x => 'c:' + x.id === src); return s ? s.name : ''; }
  const f = savedScripts.find(x => 'f:' + x.file === src); return f ? f.name : '';
}
async function srcCode(src) {
  if (src.startsWith('c:')) { const s = S.scripts.find(x => 'c:' + x.id === src); return s ? { code: s.code, inputs: s.inputs || {} } : null; }
  const r = await api('/api/scripts/file?f=' + encodeURIComponent(src.slice(2))); return r && r.code ? { code: r.code, inputs: {} } : null;
}

async function act(a, id) {
  const t = data && data.telegram || {};
  if (a === 'msgx') { msg = null; render(); }
  else if (a === 'tgedit') { tgEdit = true; render(); }
  else if (a === 'tgcancel') { tgEdit = false; render(); }
  else if (a === 'tgsave') {
    const token = $('wtToken').value.trim();
    msg = { text: 'Проверяю токен…' }; render();
    const r = await api('/api/settings/telegram', token ? { token, findChat: true } : { findChat: true });
    if (!r.ok) msg = { err: true, text: r.error };
    else if (!r.chatId) msg = { text: `Бот @${r.bot} подключён. Напиши ему любое сообщение в Telegram и нажми «Найти чат».` };
    else { msg = { text: `Готово: @${r.bot} → ${r.chatTitle}. Отправил тестовое сообщение.` }; tgEdit = false; api('/api/telegram/test', {}); }
    await refresh();
  } else if (a === 'tgtest') { const r = await api('/api/telegram/test', {}); msg = r.ok ? { text: 'Тестовое сообщение отправлено — проверь Telegram.' } : { err: true, text: r.error }; render(); }
  else if (a === 'tgclear') { if (!confirmInline('Отключить Telegram и забыть токен?')) return; await api('/api/settings/telegram', { clear: true }); tgEdit = false; await refresh(); }
  else if (a === 'new') {
    try { savedScripts = await api('/api/scripts'); } catch { savedScripts = []; }
    const first = S.scripts[S.selectedId ? S.scripts.findIndex(s => s.id === S.selectedId) : 0] || S.scripts[0];
    form = { src: first ? 'c:' + first.id : (savedScripts[0] ? 'f:' + savedScripts[0].file : ''), name: first ? first.name : (savedScripts[0] ? savedScripts[0].name : 'Сигнал'), symbol: S.symbol, interval: S.interval,
      onAlerts: true, onMarkers: false, onStrategy: false, telegram: !!(t.bot && t.chatId), browser: true, saving: false };
    render();
  } else if (a === 'cancel') { form = null; render(); }
  else if (a === 'save') {
    if (!form.src) { msg = { err: true, text: 'Нет скрипта: добавь индикатор на график или сохрани .pine' }; render(); return; }
    const src = await srcCode(form.src); if (!src) { msg = { err: true, text: 'Не удалось прочитать скрипт' }; render(); return; }
    if (form.browser) askNotify();
    form.saving = true; render();
    const r = await api('/api/watch/save', { ...src, name: form.name, symbol: form.symbol, interval: form.interval, onAlerts: form.onAlerts, onMarkers: form.onMarkers, onStrategy: form.onStrategy, telegram: form.telegram });
    if (!r.ok) { form.saving = false; msg = { err: true, text: 'Скрипт не прошёл проверку: ' + r.error }; render(); return; }
    const muted = store.get('ql.watch.mute', []); store.set('ql.watch.mute', form.browser ? muted.filter(x => x !== r.watch.id) : [...new Set(muted.concat(r.watch.id))]);
    const p = r.probe;
    msg = { text: `Сигнал «${r.watch.name}» создан. «${p.title}» работает; на последнем закрытом баре (${ft(p.barTime)}) ${p.hits.length ? 'было бы ' + p.hits.length + ' срабатывание(й)' : 'срабатываний нет'}. Дальше — уведомления на каждом новом закрытом баре.` };
    form = null; await refresh();
  } else if (a === 'del') { if (!confirmInline('Удалить сигнал?')) return; await api('/api/watch/delete', { id }); await refresh(); }
  else if (a === 'test') {
    msg = { text: 'Пересчитываю…' }; render();
    const r = await api('/api/watch/test', { id });
    msg = r.ok ? { text: `Тест: бар ${ft(r.event.barTime)}, срабатываний ${r.event.hits.length}${r.event.telegram === 'ok' ? ', отправлено в Telegram' : r.event.telegram ? ' — Telegram: ' + r.event.telegram : ''}.` } : { err: true, text: r.error };
    await refresh();
  } else if (a === 'chart') { const w = data.watches.find(x => x.id === id); if (w) A.setChart(w.symbol, w.interval); }
}
// toggles live outside act() because they are checkboxes
document.addEventListener('change', async e => {
  const id = e.target && e.target.dataset && e.target.dataset.tg; if (!id || !body || !body.contains(e.target)) return;
  const r = await api('/api/watch/toggle', { id, enabled: e.target.checked }); if (!r.ok) msg = { err: true, text: r.error };
  await refresh();
});
function confirmInline(q) { return window.confirm(q); } // eslint-disable-line no-alert

// ───────── browser notifications for new events (any watch, server-side) ─────────
function askNotify() { try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch { /* unsupported */ } }
let since = Date.now();
function beep() {
  try { const ac = new (window.AudioContext || window.webkitAudioContext)(); const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = 880; g.gain.setValueAtTime(0.0001, ac.currentTime); g.gain.exponentialRampToValueAtTime(0.15, ac.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.35); o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.4); } catch { /* audio blocked */ }
}
function toast(ev) {
  let host = document.querySelector('.wt-toasts'); if (!host) { host = document.createElement('div'); host.className = 'wt-toasts'; document.body.appendChild(host); }
  const d = document.createElement('div'); d.className = 'wt-toast';
  d.innerHTML = `<div class="wt-row"><b>🔔 ${esc(ev.name)}</b><div class="spacer"></div><button>✕</button></div><div class="wt-meta">${esc(ev.symbol)} · ${esc(ev.interval)} · бар ${ft(ev.barTime)}</div>${(ev.hits || []).slice(0, 4).map(h => `<div class="wt-hit">• ${esc(h.text)}</div>`).join('')}`;
  d.querySelector('button').onclick = () => d.remove();
  d.addEventListener('click', e => { if (e.target.tagName !== 'BUTTON') { A.setChart(ev.symbol, ev.interval); d.remove(); } });
  host.prepend(d); setTimeout(() => d.remove(), 30000);
}
setInterval(async () => {
  let r; try { r = await api('/api/watch/events?since=' + since); } catch { return; }
  if (!r || !r.events) return;
  if (r.events.length) since = Math.max(since, ...r.events.map(e => e.t));
  const muted = store.get('ql.watch.mute', []);
  for (const ev of r.events) {
    if (muted.includes(ev.watchId)) continue;
    toast(ev); beep();
    try { if ('Notification' in window && Notification.permission === 'granted') new Notification(`🔔 ${ev.name} · ${ev.symbol} ${ev.interval}`, { body: (ev.hits || []).map(h => h.text).join('\n') || 'сигнал', tag: ev.id }); } catch { /* blocked */ }
  }
  if (r.events.length && body && body.isConnected && !form) refresh();
}, 5000);

window.QLWatch = { refresh, mount };
})();
