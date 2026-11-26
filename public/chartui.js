/* Pandich Lab — chart toolbar: symbol search, timeframe picker, chart type, price scale, keyboard shortcuts. */
(() => {
'use strict';
const A = window.QLApp, $ = id => document.getElementById(id);
if (!A) { console.error('[chartui] QLApp missing'); return; }
const { S, api, esc, fmt } = A;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
const closeAll = except => { for (const id of ['tfPop', 'ctypePop', 'scalePop', 'layoutPop']) if (id !== except && $(id)) $(id).classList.add('hidden'); };
document.addEventListener('click', e => { if (e.target.isConnected && !e.target.closest('.tb-dd')) closeAll(); });

// ───────── timeframe ─────────
// same grammar as the server: <n><unit>, unit m|h|d|w|M (bare number = minutes)
function normTf(x) {
  const m = /^\s*(\d*)\s*(m|min|h|H|d|D|w|W|M)?\s*$/.exec(String(x || ''));
  if (!m || (!m[1] && !m[2])) return null;
  let n = m[1] ? parseInt(m[1], 10) : 1, u = m[2] || 'm';
  if (u === 'min') u = 'm'; else if (u === 'H') u = 'h'; else if (u === 'D') u = 'd'; else if (u === 'W') u = 'w';
  if (!(n > 0)) return null;
  if (u === 'm' && n % 60 === 0 && n < 1440) { n /= 60; u = 'h'; }
  if (u === 'm' && n === 1440) { n = 1; u = 'd'; }
  if (u === 'h' && n % 24 === 0) { n /= 24; u = 'd'; }
  if (u === 'd' && n % 7 === 0 && n >= 7) { n /= 7; u = 'w'; }
  const sec = n * { m: 60, h: 3600, d: 86400, w: 604800, M: 2592000 }[u];
  if (sec < 60 || sec > 12 * 2592000) return null;
  return `${n}${u}`;
}
const tfLabel = t => { const n = parseInt(t, 10), u = t.slice(-1); return u === 'd' ? `${n}D` : u === 'w' ? `${n}W` : u === 'M' ? `${n}M` : t; };
const TF_GROUPS = [['Минуты', ['1m', '3m', '5m', '15m', '30m']], ['Часы', ['1h', '2h', '4h']], ['Дни и больше', ['1d', '1w', '1M']]];
function renderTfPop(prefill) {
  const recent = (store.get('ql.tf.recent', []) || []).filter(t => normTf(t));
  const pop = $('tfPop');
  pop.innerHTML = `<div class="tf-in"><svg viewBox="0 0 18 18" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="9" cy="9" r="7"/><path d="M9 5v4l3 2"/></svg><input id="tfInput" placeholder="Введите любой таймфрейм: 22m, 3h, 2D" spellcheck="false" autocomplete="off"></div>` +
    (recent.length ? `<div class="tf-h">Недавние</div><div class="tf-row">${recent.map(t => `<button data-tf="${t}" class="${t === S.interval ? 'on' : ''}">${tfLabel(t)}</button>`).join('')}</div>` : '') +
    TF_GROUPS.map(([h, list]) => `<div class="tf-h">${h}</div><div class="tf-row">${list.map(t => `<button data-tf="${t}" class="${t === S.interval ? 'on' : ''}">${tfLabel(t)}</button>`).join('')}</div>`).join('') +
    `<div class="tf-foot"><span><kbd>↵</kbd> открыть</span><span>число без буквы = минуты, D/W/M = дни/недели/месяцы</span></div>`;
  pop.querySelectorAll('[data-tf]').forEach(b => b.onclick = () => chooseTf(b.dataset.tf));
  const inp = $('tfInput');
  inp.value = prefill || '';
  inp.oninput = () => inp.classList.toggle('bad', !!inp.value && !normTf(inp.value));
  inp.onkeydown = e => {
    if (e.key === 'Enter') { const t = normTf(inp.value); if (t) chooseTf(t, true); else inp.classList.add('bad'); }
    if (e.key === 'Escape') closeAll();
    e.stopPropagation();
  };
  setTimeout(() => { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }, 0);
}
function chooseTf(t, custom) {
  closeAll();
  if (custom && !TF_GROUPS.some(g => g[1].includes(t))) { const r = (store.get('ql.tf.recent', []) || []).filter(x => x !== t); r.unshift(t); store.set('ql.tf.recent', r.slice(0, 4)); }
  if (t !== S.interval) A.setChart(null, t);
}
function openTf(prefill) { closeAll('tfPop'); renderTfPop(prefill); $('tfPop').classList.remove('hidden'); }
$('tfBtn').onclick = e => { e.stopPropagation(); $('tfPop').classList.contains('hidden') ? openTf('') : closeAll(); };

// ───────── chart type ─────────
const CT = {
  candles: ['Свечи', '<rect x="3" y="5" width="4" height="8" rx=".5" fill="currentColor"/><path d="M5 2v3M5 13v3"/><rect x="11" y="4" width="4" height="6" rx=".5"/><path d="M13 1.5V4M13 10v4"/>'],
  hollow: ['Полые свечи', '<rect x="3" y="5" width="4" height="8" rx=".5"/><path d="M5 2v3M5 13v3"/><rect x="11" y="4" width="4" height="6" rx=".5" fill="currentColor"/><path d="M13 1.5V4M13 10v4"/>'],
  bars: ['Бары', '<path d="M5 3v12M3 6h2M5 12h2M13 2v12M11 5h2M13 10h2"/>'],
  line: ['Линия', '<path d="M2 13l4-5 4 3 6-7"/>'],
  line_markers: ['Линия с маркерами', '<path d="M2 13l4-5 4 3 6-7"/><circle cx="6" cy="8" r="1.4" fill="currentColor"/><circle cx="10" cy="11" r="1.4" fill="currentColor"/>'],
  step: ['Ступенчатая линия', '<path d="M2 13h4V8h4v3h3V4h3"/>'],
  area: ['Область', '<path d="M2 13l4-5 4 3 6-7v12H2z" fill="currentColor" fill-opacity=".35"/><path d="M2 13l4-5 4 3 6-7"/>'],
  baseline: ['Базовая линия', '<path d="M2 9h14" stroke-dasharray="2 2"/><path d="M2 12l4-6 4 5 6-8"/>'],
  columns: ['Столбцы', '<path d="M3 16V9M7 16V5M11 16V8M15 16V3" stroke-width="2.4"/>'],
  ha: ['Heikin Ashi', '<rect x="3" y="6" width="4" height="7" rx=".5" fill="currentColor"/><path d="M5 3v3M5 13v2"/><rect x="11" y="3" width="4" height="7" rx=".5" fill="currentColor" fill-opacity=".5"/><path d="M13 1.5V3M13 10v3"/>'],
};
const ico = k => `<svg viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${CT[k][1]}</svg>`;
function renderCtype() {
  $('ctypeIcon').innerHTML = ico(S.chartType);
  $('ctypeBtn').title = 'Тип графика: ' + CT[S.chartType][0];
  $('ctypePop').innerHTML = A.CHART_TYPES.map(k => `<button data-ct="${k}" class="${k === S.chartType ? 'on' : ''}">${ico(k)}<span>${CT[k][0]}</span></button>`).join('') +
    '<div class="pm-sep"></div><div class="pm-empty">Индикаторы считаются по обычным OHLC (для Heikin Ashi тоже).</div>';
  $('ctypePop').querySelectorAll('[data-ct]').forEach(b => b.onclick = () => { closeAll(); A.setChartType(b.dataset.ct); });
}
$('ctypeBtn').onclick = e => { e.stopPropagation(); const p = $('ctypePop'); const was = p.classList.contains('hidden'); closeAll(); if (was) { renderCtype(); p.classList.remove('hidden'); } };
window.addEventListener('ql:ctype', renderCtype);

// ───────── price scale ─────────
const MODES = [[0, 'Обычная'], [2, 'Проценты'], [3, 'Индекс к 100'], [1, 'Логарифмическая']];
function renderScale() {
  $('scalePop').innerHTML = MODES.map(([m, n]) => `<button data-m="${m}" class="${S.scale.mode === m ? 'on' : ''}"><span class="radio ${S.scale.mode === m ? 'on' : ''}"></span>${n}</button>`).join('') +
    `<div class="pm-sep"></div><button data-inv><span class="chk ${S.scale.invert ? 'on' : ''}"></span>Инвертировать шкалу</button>`;
  $('scalePop').querySelectorAll('[data-m]').forEach(b => b.onclick = () => { A.setScale({ mode: +b.dataset.m }); renderScale(); });
  $('scalePop').querySelector('[data-inv]').onclick = () => { A.setScale({ invert: !S.scale.invert }); renderScale(); };
  $('scaleBtn').classList.toggle('active', S.scale.mode !== 0 || S.scale.invert);
}
$('scaleBtn').onclick = e => { e.stopPropagation(); const p = $('scalePop'); const was = p.classList.contains('hidden'); closeAll(); if (was) { renderScale(); p.classList.remove('hidden'); } };

// ───────── symbol search ─────────
const modal = document.createElement('div'); modal.className = 'ss-modal hidden'; modal.id = 'symModal';
modal.innerHTML = `<div class="ss-box">
  <div class="ss-search"><svg viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="8" r="5.5"/><path d="M12.2 12.2L16 16"/></svg><input id="ssInput" placeholder="Поиск инструмента…" spellcheck="false" autocomplete="off"><button class="ss-x" id="ssClear" title="Очистить">✕</button></div>
  <div class="ss-tabs" id="ssTabs"></div>
  <div class="ss-main"><div class="ss-list" id="ssList"></div><div class="ss-detail" id="ssDetail"></div></div>
  <div class="ss-foot"><span><kbd>↑</kbd><kbd>↓</kbd> навигация</span><span><kbd>↵</kbd> открыть график</span><span><kbd>Tab</kbd> сменить рынок</span><span><kbd>Esc</kbd> закрыть</span></div>
</div>`;
document.querySelector('.workspace').appendChild(modal);
let ssTab = 'all', ssSel = 0, ssItems = [];
const quoteCache = new Map();
const norm = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function allSymbols() {
  const j = S.symbols || { mt5: { symbols: [] }, crypto: [] };
  const mt5 = (j.mt5 && j.mt5.symbols || []).map(s => ({ name: s.name, desc: s.desc || '', cat: (s.path || '').split(/[\\/]/)[0] || 'MT5', src: 'MT5' }));
  const crypto = (j.crypto || []).filter(c => !mt5.some(m => norm(m.name) === norm(c))).map(c => ({ name: c, desc: c.replace(/(USDT|USDC|BTC|ETH)$/, ' / $1'), cat: 'Binance', src: 'Binance' }));
  return mt5.concat(crypto);
}
function cats() { const c = []; for (const s of allSymbols()) if (!c.includes(s.cat)) c.push(s.cat); return ['all', ...c]; }
function renderSS() {
  const q = norm($('ssInput').value), tabs = cats();
  if (!tabs.includes(ssTab)) ssTab = 'all';
  $('ssTabs').innerHTML = tabs.map(t => `<button data-t="${esc(t)}" class="${t === ssTab ? 'on' : ''}">${t === 'all' ? 'Все' : esc(t)}</button>`).join('');
  $('ssTabs').querySelectorAll('button').forEach(b => b.onclick = () => { ssTab = b.dataset.t; ssSel = 0; renderSS(); $('ssInput').focus(); });
  ssItems = allSymbols().filter(s => (ssTab === 'all' || s.cat === ssTab) && (!q || norm(s.name).includes(q) || norm(s.desc).includes(q)));
  // exact/prefix matches first
  ssItems.sort((a, b) => (norm(b.name).startsWith(q) ? 1 : 0) - (norm(a.name).startsWith(q) ? 1 : 0));
  if (q && !ssItems.some(s => norm(s.name) === q)) ssItems.push({ name: $('ssInput').value.trim().toUpperCase(), desc: 'Открыть как есть (MT5 или Binance)', cat: '—', src: '?', raw: true });
  ssSel = Math.max(0, Math.min(ssSel, ssItems.length - 1));
  const dot = s => { const h = [...s.name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360; return `<span class="ss-dot" style="background:hsl(${h},55%,42%)">${esc(s.name.replace(/[^A-Za-z]/g, '').slice(0, 2) || '?')}</span>`; };
  $('ssList').innerHTML = ssItems.length ? ssItems.map((s, i) => `<div class="ss-row ${i === ssSel ? 'sel' : ''}" data-i="${i}">${dot(s)}<div class="ss-nm"><b>${esc(s.name)}</b><span>${esc(s.desc)}</span></div><div class="spacer"></div><div class="ss-src"><b>${esc(s.src)}</b><span>${esc(s.cat)}</span></div>${norm(s.name) === norm(S.symbol) ? '<span class="ss-cur">✓</span>' : ''}</div>`).join('')
    : '<div class="pm-empty" style="padding:16px">Ничего не найдено</div>';
  $('ssList').querySelectorAll('.ss-row').forEach(r => { r.onclick = () => { ssSel = +r.dataset.i; openSel(); }; r.onmouseenter = () => { ssSel = +r.dataset.i; markSel(); }; });
  markSel();
}
function markSel() {
  $('ssList').querySelectorAll('.ss-row').forEach(r => r.classList.toggle('sel', +r.dataset.i === ssSel));
  const row = $('ssList').querySelector(`.ss-row[data-i="${ssSel}"]`); if (row) row.scrollIntoView({ block: 'nearest' });
  renderDetail(ssItems[ssSel]);
}
let detTimer = null;
function renderDetail(s) {
  const el = $('ssDetail');
  if (!s) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="ss-dh"><b>${esc(s.name)}</b><span>${esc(s.desc)}</span></div><div class="ss-price muted">…</div><div class="ss-meta">${esc(s.src)} · ${esc(s.cat)}</div>`;
  if (s.raw) { el.querySelector('.ss-price').textContent = 'символ не из списка'; return; }
  clearTimeout(detTimer);
  detTimer = setTimeout(async () => {
    let q = quoteCache.get(s.name);
    if (!q || Date.now() - q.at > 15000) { try { q = await api('/api/quote?symbol=' + encodeURIComponent(s.name)); q.at = Date.now(); quoteCache.set(s.name, q); } catch (e) { q = { ok: false, error: e.message }; } }
    if (ssItems[ssSel] !== s) return;
    const p = el.querySelector('.ss-price');
    if (!q.ok) { p.textContent = q.error || 'нет данных'; return; }
    const d = q.digits ?? 2, up = (q.change || 0) >= 0;
    p.className = 'ss-price';
    p.innerHTML = `<span class="big">${fmt(q.last, d)}</span> <span class="${up ? 'pos' : 'neg'}">${up ? '+' : ''}${fmt(q.change, d)} (${up ? '+' : ''}${fmt(q.changePct, 2)}%)</span>` +
      `<div class="ss-hl">Сегодня: O ${fmt(q.open, d)} · H ${fmt(q.high, d)} · L ${fmt(q.low, d)}</div>`;
  }, 150);
}
function openSel() { const s = ssItems[ssSel]; if (!s) return; closeSS(); if (norm(s.name) !== norm(S.symbol)) A.setChart(s.name, null); }
function openSS(prefill) {
  closeAll(); modal.classList.remove('hidden');
  if (!S.symbols && A.loadSymbols) A.loadSymbols();
  $('ssInput').value = prefill || ''; ssSel = 0; renderSS();
  setTimeout(() => { $('ssInput').focus(); const v = $('ssInput').value; $('ssInput').setSelectionRange(v.length, v.length); }, 0);
}
function closeSS() { modal.classList.add('hidden'); }
$('ssInput').addEventListener('input', () => { ssSel = 0; renderSS(); });
$('ssInput').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { ssSel = Math.min(ssItems.length - 1, ssSel + 1); markSel(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { ssSel = Math.max(0, ssSel - 1); markSel(); e.preventDefault(); }
  else if (e.key === 'Enter') { openSel(); e.preventDefault(); }
  else if (e.key === 'Escape') { closeSS(); e.preventDefault(); }
  else if (e.key === 'Tab') { const t = cats(); ssTab = t[(t.indexOf(ssTab) + (e.shiftKey ? t.length - 1 : 1)) % t.length]; ssSel = 0; renderSS(); e.preventDefault(); }
  e.stopPropagation();
});
$('ssClear').onclick = () => { $('ssInput').value = ''; renderSS(); $('ssInput').focus(); };
modal.addEventListener('mousedown', e => { if (e.target === modal) closeSS(); });
$('symBtn').onclick = () => openSS('');
window.addEventListener('ql:symbols', () => { if (!modal.classList.contains('hidden')) renderSS(); });

// ───────── labels + keyboard shortcuts ─────────
function syncLabels() {
  $('symTxt').textContent = S.symbol; $('tfTxt').textContent = tfLabel(S.interval || '15m');
  $('ctypeIcon').innerHTML = ico(S.chartType); renderScale();
}
window.addEventListener('ql:data', syncLabels);
document.addEventListener('keydown', e => {
  const t = e.target, tag = (t && t.tagName) || '';
  if (/INPUT|TEXTAREA|SELECT/.test(tag) || (t && t.isContentEditable) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (!$('modal').classList.contains('hidden') || !modal.classList.contains('hidden')) return;
  if (/^[0-9]$/.test(e.key)) { e.preventDefault(); openTf(e.key); }
  else if (/^[a-zA-Z]$/.test(e.key)) { e.preventDefault(); openSS(e.key.toUpperCase()); }
});
syncLabels(); renderCtype();
window.QLChartUI = { openSymbolSearch: openSS, openTimeframe: openTf };
})();
