/* Pandich Lab — Bar Replay with paper trading and a results card.
   Replay reveals the loaded history bar by bar (app.js: replayStart / replayStep / replayStop); scripts re-run on the
   revealed bars only (server /api/run `until`), so indicators can't peek into the future.
   Paper trading: one net position per replay session, market orders fill at the close of the last revealed bar,
   optional SL/TP are checked on every new bar's high/low (SL wins when both are hit inside one bar — conservative;
   a gap through the level fills at the bar's open). P&L = price change × quantity (quote units, no commission/spread
   unless set). */
(() => {
'use strict';
const A = window.QLApp; if (!A || A.EMBED) return;
const $ = id => document.getElementById(id);
const S = A.S, chart = A.chart, candles = A.candles, LWC = window.LightweightCharts;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
const wrap = $('chartWrap');
const SPEEDS = [1, 2, 3, 5, 10, 20]; // bars per second
const ICON = {
  replay: '<svg viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4v10M15 4l-8 5 8 5z"/></svg>',
  play: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M4 2.5v11l9-5.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" fill="currentColor"/></svg>',
  step: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M3 2.5v11l7-5.5zM11 2.5h2.2v11H11z" fill="currentColor"/></svg>',
  pick: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M8 1.5v13M4.5 5L2 8l2.5 3M11.5 5L14 8l-2.5 3"/></svg>',
  stats: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2 14h12M4 11V7M8 11V3M12 11V8"/></svg>',
  x: '<svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg>',
};

// ───────── state ─────────
const R = {
  on: false, picking: false, playing: false, timer: null,
  speed: SPEEDS.includes(store.get('ql.rp.speed', 2)) ? store.get('ql.rp.speed', 2) : 2,
  qty: store.get('ql.rp.qty', 1), cost: store.get('ql.rp.cost', 0), // cost = commission + spread per 1 unit per round trip, in price units
  pos: null,        // { symbol, qty (signed), avg, t, sl, tp }
  trades: [],       // closed: { symbol, side, qty, entryT, entryPx, exitT, exitPx, pnl, reason }
  fills: [],        // every execution, for markers: { symbol, t, side:'buy'|'sell', px, qty, kind:'entry'|'exit', reason }
  startT: null, lastPx: null, lastT: null, symbol: null,
  lines: [],
};
const markers = LWC.createSeriesMarkers(candles, []);

// ───────── helpers ─────────
const digits = () => { const v = Math.abs(R.lastPx || 1); return v >= 1000 ? 2 : v >= 10 ? 3 : v >= 1 ? 4 : 6; };
const fp = v => (v === null || v === undefined || !Number.isFinite(v)) ? '—' : v.toFixed(digits());
const fm = v => (v === null || v === undefined || !Number.isFinite(v)) ? '—' : (v >= 0 ? '+' : '−') + Math.abs(v).toLocaleString('ru-RU', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const ft = t => t ? new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ') : '—';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const lastBar = () => S.bars[S.bars.length - 1];
const openPnl = () => R.pos && R.lastPx !== null ? (R.lastPx - R.pos.avg) * R.pos.qty : 0;
const realized = () => R.trades.reduce((a, t) => a + t.pnl, 0);

// ───────── UI: toolbar button, pick overlay, control bar ─────────
const btnHost = document.createElement('div'); btnHost.className = 'tb-dd mc-only';
btnHost.innerHTML = `<button class="tb-btn" id="replayBtn" title="Replay — проиграть историю бар за баром и потренироваться в сделках">${ICON.replay}<span>Replay</span></button>`;
$('layoutBtn').parentElement.after(btnHost);

const pickEl = document.createElement('div'); pickEl.className = 'rp-ui rp-pick hidden';
pickEl.innerHTML = '<div class="rp-pick-line"></div><div class="rp-pick-hint">Кликни по бару, с которого начать Replay · <b>Esc</b> — отмена</div>';
wrap.appendChild(pickEl);

const bar = document.createElement('div'); bar.className = 'rp-ui rp-bar hidden';
wrap.appendChild(bar);

function renderBar() {
  const p = R.pos, side = p ? (p.qty > 0 ? 'long' : 'short') : '';
  bar.innerHTML = `
    <div class="rp-grp">
      <button class="rp-b" data-a="pick" title="Выбрать бар начала">${ICON.pick}</button>
      <button class="rp-b rp-play" data-a="play" title="Старт / пауза (Пробел)">${R.playing ? ICON.pause : ICON.play}</button>
      <button class="rp-b" data-a="step" title="Следующий бар (→, Shift+→ — 10 баров)">${ICON.step}</button>
      <select class="rp-speed" data-a="speed" title="Скорость, баров в секунду">${SPEEDS.map(s => `<option value="${s}" ${s === R.speed ? 'selected' : ''}>${s}×</option>`).join('')}</select>
      <span class="rp-time" id="rpTime">${ft(R.lastT)}</span>
    </div>
    <div class="rp-sep"></div>
    <div class="rp-grp">
      <label class="rp-f" title="Объём (единицы цены × объём = P&L). Для XAUUSD 1 лот = 100 унций.">Объём<input type="number" id="rpQty" value="${R.qty}" min="0" step="any"></label>
      <label class="rp-f" title="Стоп-лосс — цена (пусто = без стопа)">SL<input type="number" id="rpSL" value="${p && p.sl ? p.sl : ''}" step="any" placeholder="—"></label>
      <label class="rp-f" title="Тейк-профит — цена (пусто = без тейка)">TP<input type="number" id="rpTP" value="${p && p.tp ? p.tp : ''}" step="any" placeholder="—"></label>
      <button class="rp-buy" data-a="buy" title="Купить по закрытию текущего бара (Shift+B)">Buy</button>
      <button class="rp-sell" data-a="sell" title="Продать по закрытию текущего бара (Shift+S)">Sell</button>
      <button class="rp-b" data-a="flat" title="Закрыть позицию (Shift+C)" ${p ? '' : 'disabled'}>Закрыть</button>
    </div>
    <div class="rp-sep"></div>
    <div class="rp-grp rp-pnl">
      <span class="rp-pos ${side}">${p ? `${side === 'long' ? 'Long' : 'Short'} ${+Math.abs(p.qty).toFixed(6)} @ ${fp(p.avg)}` : 'Нет позиции'}</span>
      <span title="Нереализованный P&L">${p ? `<b class="${openPnl() >= 0 ? 'up' : 'dn'}" id="rpOpen">${fm(openPnl())}</b>` : ''}</span>
      <span class="muted" title="Реализованный P&L за сессию">Итог <b class="${realized() >= 0 ? 'up' : 'dn'}" id="rpReal">${fm(realized())}</b></span>
      <button class="rp-b" data-a="stats" title="Итоги сессии">${ICON.stats}<span>${R.trades.length}</span></button>
      <button class="rp-b" data-a="exit" title="Выйти из Replay">${ICON.x}</button>
    </div>`;
  bar.querySelectorAll('[data-a]').forEach(el => {
    if (el.tagName === 'SELECT') el.onchange = () => { R.speed = +el.value; store.set('ql.rp.speed', R.speed); if (R.playing) { pause(); play(); } };
    else el.onclick = () => act(el.dataset.a);
  });
  $('rpQty').onchange = e => { const v = +e.target.value; if (v > 0) { R.qty = v; store.set('ql.rp.qty', v); } else e.target.value = R.qty; };
  const lvl = (id, k) => { $(id).onchange = e => { if (!R.pos) return; const v = e.target.value === '' ? null : +e.target.value; R.pos[k] = Number.isFinite(v) && v > 0 ? v : null; drawLines(); }; };
  lvl('rpSL', 'sl'); lvl('rpTP', 'tp');
}
function refreshNumbers() { // cheap per-bar update without rebuilding the bar
  const t = $('rpTime'); if (t) t.textContent = ft(R.lastT);
  const o = $('rpOpen'); if (o) { o.textContent = fm(openPnl()); o.className = openPnl() >= 0 ? 'up' : 'dn'; }
}

function act(a) {
  if (a === 'pick') { pause(); startPick(); }
  else if (a === 'play') R.playing ? pause() : play();
  else if (a === 'step') { pause(); step(1); }
  else if (a === 'buy' || a === 'sell') order(a === 'buy' ? 1 : -1);
  else if (a === 'flat') { if (R.pos) order(-Math.sign(R.pos.qty), Math.abs(R.pos.qty), 'ручное закрытие'); }
  else if (a === 'stats') showResults();
  else if (a === 'exit') exitReplay();
}

// ───────── pick start bar ─────────
function startPick() {
  if (!S.bars.length) return;
  R.picking = true; pickEl.classList.remove('hidden'); wrap.classList.add('rp-picking');
}
function endPick() { R.picking = false; pickEl.classList.add('hidden'); wrap.classList.remove('rp-picking'); }
wrap.addEventListener('pointermove', e => {
  if (!R.picking) return;
  const r = wrap.getBoundingClientRect(); pickEl.querySelector('.rp-pick-line').style.left = (e.clientX - r.left) + 'px';
});
wrap.addEventListener('pointerdown', async e => {
  if (!R.picking || e.button !== 0 || e.target.closest('.rp-bar')) return;
  e.preventDefault(); e.stopPropagation();
  const r = wrap.getBoundingClientRect();
  const lg = chart.timeScale().coordinateToLogical(e.clientX - r.left);
  endPick();
  if (lg === null) return;
  const full = S.replay ? S.replay.full : S.bars;
  const idx = Math.max(1, Math.min(full.length - 2, Math.round(lg)));
  if (R.pos) closeAll('новый старт');
  const first = !R.on;
  R.on = true; R.symbol = S.symbol;
  btnHost.querySelector('button').classList.add('on');
  await A.replayStart(idx);
  syncLast(); if (first || R.startT === null) R.startT = R.lastT;
  bar.classList.remove('hidden'); renderBar(); drawMarkers(); drawLines();
}, true);

// ───────── play loop ─────────
function play() {
  if (!S.replay) return;
  R.playing = true; renderBar();
  R.timer = setInterval(() => { if (!step(1)) { pause(); toast('Конец загруженной истории'); } }, Math.round(1000 / R.speed));
}
function pause() { if (R.timer) clearInterval(R.timer); R.timer = null; if (R.playing) { R.playing = false; renderBar(); } }
function step(n) { return A.replayStep(n); }
function syncLast() { const b = lastBar(); if (b) { R.lastPx = b.close; R.lastT = b.time; } }

// every new bar: check SL/TP on its range, then mark to market
window.addEventListener('ql:replaybar', e => {
  if (!R.on) return;
  const nTrades = R.fills.length;
  for (const b of e.detail.bars) {
    const p = R.pos;
    if (p && p.symbol === S.symbol) {
      const long = p.qty > 0;
      const slHit = p.sl && (long ? b.low <= p.sl : b.high >= p.sl);
      const tpHit = p.tp && (long ? b.high >= p.tp : b.low <= p.tp);
      if (slHit) { const px = long ? Math.min(p.sl, b.open) : Math.max(p.sl, b.open); fill(-Math.sign(p.qty), Math.abs(p.qty), px, b.time, 'SL'); }
      else if (tpHit) { const px = long ? Math.max(p.tp, b.open) : Math.min(p.tp, b.open); fill(-Math.sign(p.qty), Math.abs(p.qty), px, b.time, 'TP'); }
    }
    R.lastPx = b.close; R.lastT = b.time;
  }
  if (R.fills.length !== nTrades) { renderBar(); drawMarkers(); drawLines(); } else refreshNumbers();
});
// TF or symbol switched during replay (app.js keeps the replay cursor)
window.addEventListener('ql:replay', () => {
  if (!R.on) return;
  if (R.pos && R.pos.symbol !== S.symbol) closeAll('смена символа', R.pos.lastPx, R.lastT);
  R.symbol = S.symbol; syncLast(); renderBar(); drawMarkers(); drawLines();
});

// ───────── orders ─────────
function order(dir, qty = R.qty, reason = 'ручное') {
  if (!R.on || !S.replay) return;
  if (!(qty > 0)) { toast('Укажи объём > 0'); return; }
  syncLast();
  const sl = +($('rpSL') && $('rpSL').value) || null, tp = +($('rpTP') && $('rpTP').value) || null;
  const wasFlat = !R.pos;
  fill(dir, qty, R.lastPx, R.lastT, reason);
  if (R.pos && wasFlat) { // new position: validate SL/TP side
    const long = R.pos.qty > 0;
    R.pos.sl = sl && (long ? sl < R.pos.avg : sl > R.pos.avg) ? sl : null;
    R.pos.tp = tp && (long ? tp > R.pos.avg : tp < R.pos.avg) ? tp : null;
    if ((sl && !R.pos.sl) || (tp && !R.pos.tp)) toast('SL/TP с неверной стороны от цены входа — не установлен');
  }
  renderBar(); drawLines();
}
// net-position accounting (average price); closing part or all of the position books a trade
function fill(dir, qty, px, t, reason) {
  const q = dir * qty, p = R.pos;
  R.fills.push({ symbol: S.symbol, t, side: dir > 0 ? 'buy' : 'sell', px, qty, kind: !p || Math.sign(p.qty) === dir ? 'entry' : 'exit', reason });
  if (!p) { R.pos = { symbol: S.symbol, qty: q, avg: px, t, sl: null, tp: null, lastPx: px }; }
  else if (Math.sign(p.qty) === dir) { const nq = p.qty + q; p.avg = (p.avg * Math.abs(p.qty) + px * qty) / Math.abs(nq); p.qty = nq; }
  else {
    const closeQty = Math.min(qty, Math.abs(p.qty));
    const gross = (px - p.avg) * closeQty * Math.sign(p.qty);
    R.trades.push({ symbol: p.symbol, side: p.qty > 0 ? 'Long' : 'Short', qty: closeQty, entryT: p.t, entryPx: p.avg, exitT: t, exitPx: px, pnl: gross - R.cost * closeQty, reason });
    const rest = p.qty + q;
    if (Math.abs(rest) < 1e-12) R.pos = null;
    else if (Math.sign(rest) === Math.sign(p.qty)) p.qty = rest;
    else R.pos = { symbol: S.symbol, qty: rest, avg: px, t, sl: null, tp: null, lastPx: px }; // reversed through zero
  }
  if (R.pos) R.pos.lastPx = px;
  drawMarkers(); drawLines();
}
function closeAll(reason, px = R.lastPx, t = R.lastT) { if (R.pos) fill(-Math.sign(R.pos.qty), Math.abs(R.pos.qty), px, t, reason); }

// ───────── chart: markers + price lines ─────────
function drawMarkers() {
  const ms = R.fills.filter(f => f.symbol === S.symbol && f.t <= (R.lastT || Infinity)).map(f => ({
    time: f.t,
    position: f.side === 'buy' ? 'belowBar' : 'aboveBar',
    shape: f.kind === 'exit' ? 'circle' : (f.side === 'buy' ? 'arrowUp' : 'arrowDown'),
    color: f.side === 'buy' ? '#2962ff' : '#e91e63',
    text: f.kind === 'exit' ? (f.reason === 'SL' || f.reason === 'TP' ? f.reason : 'X') : `${f.side === 'buy' ? 'B' : 'S'} ${+f.qty.toFixed(4)}`,
  })).sort((a, b) => a.time - b.time);
  // bars on a higher TF can contain several fills; snap each to the bar that contains it so markers stay visible
  const bars = S.bars;
  for (const m of ms) { let lo = 0, hi = bars.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (bars[mid].time <= m.time) lo = mid; else hi = mid - 1; } if (bars[lo]) m.time = bars[lo].time; }
  markers.setMarkers(R.on ? ms : []);
}
function drawLines() {
  for (const l of R.lines) { try { candles.removePriceLine(l); } catch { /* gone */ } }
  R.lines = [];
  const p = R.pos; if (!R.on || !p || p.symbol !== S.symbol) return;
  const add = (price, color, title, style) => R.lines.push(candles.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title }));
  add(p.avg, '#2962ff', `${p.qty > 0 ? 'Long' : 'Short'} ${+Math.abs(p.qty).toFixed(4)}`, LWC.LineStyle.Solid);
  if (p.sl) add(p.sl, '#ef5350', 'SL', LWC.LineStyle.Dashed);
  if (p.tp) add(p.tp, '#26a69a', 'TP', LWC.LineStyle.Dashed);
}

// ───────── results card ─────────
function stats() {
  const tr = R.trades, n = tr.length;
  const wins = tr.filter(t => t.pnl > 0), losses = tr.filter(t => t.pnl < 0);
  const gp = wins.reduce((a, t) => a + t.pnl, 0), gl = -losses.reduce((a, t) => a + t.pnl, 0);
  let eq = 0, peak = 0, dd = 0, streak = 0, maxStreak = 0; const curve = [0];
  for (const t of tr) { eq += t.pnl; curve.push(eq); peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); streak = t.pnl < 0 ? streak + 1 : 0; maxStreak = Math.max(maxStreak, streak); }
  const avgW = wins.length ? gp / wins.length : null, avgL = losses.length ? gl / losses.length : null;
  return { n, wins: wins.length, losses: losses.length, net: gp - gl, gp, gl, pf: gl > 0 ? gp / gl : (gp > 0 ? Infinity : null),
    winRate: n ? wins.length / n * 100 : null, avgW, avgL, payoff: avgW !== null && avgL ? avgW / avgL : null, exp: n ? (gp - gl) / n : null,
    best: n ? Math.max(...tr.map(t => t.pnl)) : null, worst: n ? Math.min(...tr.map(t => t.pnl)) : null, dd, maxStreak, curve };
}
function showResults() {
  pause();
  const s = stats();
  const ov = document.createElement('div'); ov.className = 'rp-ui rp-modal';
  const cell = (k, v, cls = '') => `<div class="rp-st"><span>${k}</span><b class="${cls}">${v}</b></div>`;
  const pf = s.pf === null ? '—' : s.pf === Infinity ? '∞' : s.pf.toFixed(2);
  ov.innerHTML = `<div class="rp-card">
    <div class="rp-card-h"><b>Итоги Replay</b><span class="muted">${esc(R.symbol || S.symbol)} · ${esc(S.interval)} · ${ft(R.startT)} → ${ft(R.lastT)}</span><div class="spacer"></div><button class="rp-b" data-x>${ICON.x}</button></div>
    <div class="rp-stats">
      ${cell('Чистый P&L', fm(s.net), s.net >= 0 ? 'up' : 'dn')}
      ${cell('Сделок', s.n)}
      ${cell('Прибыльных', s.winRate === null ? '—' : `${s.winRate.toFixed(1)}% (${s.wins}/${s.n})`)}
      ${cell('Profit factor', pf)}
      ${cell('Макс. просадка', s.dd ? '−' + s.dd.toFixed(2) : '0.00', s.dd ? 'dn' : '')}
      ${cell('Матожидание / сделка', fm(s.exp))}
      ${cell('Валовая прибыль', fm(s.gp), 'up')}
      ${cell('Валовой убыток', s.gl ? '−' + s.gl.toFixed(2) : '0.00', s.gl ? 'dn' : '')}
      ${cell('Средняя прибыль', fm(s.avgW))}
      ${cell('Средний убыток', s.avgL === null ? '—' : '−' + s.avgL.toFixed(2))}
      ${cell('Прибыль/убыток (payoff)', s.payoff === null ? '—' : s.payoff.toFixed(2))}
      ${cell('Убытков подряд (макс.)', s.maxStreak)}
      ${cell('Лучшая сделка', fm(s.best))}
      ${cell('Худшая сделка', fm(s.worst))}
      ${cell('Открытая позиция', R.pos ? `${R.pos.qty > 0 ? 'Long' : 'Short'} ${fm(openPnl())}` : 'нет')}
      ${cell('Издержки / ед. (круг)', `<input type="number" step="any" min="0" value="${R.cost}" class="rp-cost" title="Комиссия + спред на 1 единицу объёма за сделку, в ценах. Применяется к новым сделкам.">`)}
    </div>
    <canvas class="rp-eq" height="110"></canvas>
    <div class="rp-tbl-wrap"><table class="rp-tbl"><thead><tr><th>#</th><th>Сторона</th><th>Объём</th><th>Вход</th><th>Цена</th><th>Выход</th><th>Цена</th><th>P&L</th><th>Причина</th></tr></thead><tbody>
      ${R.trades.map((t, i) => `<tr><td>${i + 1}</td><td class="${t.side === 'Long' ? 'up' : 'dn'}">${t.side}</td><td>${+t.qty.toFixed(6)}</td><td>${ft(t.entryT)}</td><td>${fp(t.entryPx)}</td><td>${ft(t.exitT)}</td><td>${fp(t.exitPx)}</td><td class="${t.pnl >= 0 ? 'up' : 'dn'}">${fm(t.pnl)}</td><td>${esc(t.reason)}</td></tr>`).reverse().join('') || '<tr><td colspan="9" class="muted">Сделок пока нет — жми Buy / Sell на панели Replay</td></tr>'}
    </tbody></table></div>
    <div class="rp-card-f"><span class="muted">P&L = изменение цены × объём${R.cost ? `, минус издержки ${R.cost}/ед.` : ''}. Вход по закрытию бара; SL раньше TP, если оба в одном баре.</span><div class="spacer"></div><button class="btn" data-csv>Скачать CSV</button><button class="btn" data-close>Закрыть</button></div>
  </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.querySelector('[data-x]').onclick = close; ov.querySelector('[data-close]').onclick = close;
  ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
  ov.querySelector('.rp-cost').onchange = e => { const v = +e.target.value; R.cost = v >= 0 ? v : 0; store.set('ql.rp.cost', R.cost); };
  ov.querySelector('[data-csv]').onclick = () => {
    const rows = [['n', 'symbol', 'side', 'qty', 'entry_time_utc', 'entry_price', 'exit_time_utc', 'exit_price', 'pnl', 'reason']]
      .concat(R.trades.map((t, i) => [i + 1, t.symbol, t.side, t.qty, ft(t.entryT), t.entryPx, ft(t.exitT), t.exitPx, +t.pnl.toFixed(6), t.reason]));
    const blob = new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `replay_${(R.symbol || S.symbol)}_${S.interval}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  drawEquity(ov.querySelector('.rp-eq'), s.curve);
}
function drawEquity(cv, curve) {
  const w = cv.clientWidth || 640, h = 110, dpr = window.devicePixelRatio || 1;
  cv.width = w * dpr; cv.height = h * dpr; const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const min = Math.min(0, ...curve), max = Math.max(0, ...curve), pad = 8, span = (max - min) || 1;
  const X = i => pad + (w - 2 * pad) * (curve.length > 1 ? i / (curve.length - 1) : 0), Y = v => h - pad - (h - 2 * pad) * (v - min) / span;
  g.strokeStyle = '#2a2c31'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(pad, Y(0)); g.lineTo(w - pad, Y(0)); g.stroke(); g.setLineDash([]);
  g.fillStyle = '#9a9da5'; g.font = '10px system-ui'; g.fillText('Equity по закрытым сделкам', pad, 12);
  if (curve.length < 2) return;
  g.strokeStyle = curve[curve.length - 1] >= 0 ? '#26a69a' : '#ef5350'; g.lineWidth = 1.6; g.beginPath();
  curve.forEach((v, i) => i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))); g.stroke();
}

// ───────── exit ─────────
async function exitReplay() {
  pause(); endPick();
  const had = R.trades.length || R.pos;
  if (R.pos) closeAll('конец Replay');
  if (had) showResults();
  R.on = false; bar.classList.add('hidden'); btnHost.querySelector('button').classList.remove('on');
  drawMarkers(); drawLines();
  await A.replayStop();
  R.trades = []; R.fills = []; R.pos = null; R.startT = null; // results card keeps its own snapshot (already rendered)
}

function toast(text) {
  const t = document.createElement('div'); t.className = 'rp-toast'; t.textContent = text; wrap.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

// ───────── wiring ─────────
$('replayBtn').onclick = () => { if (R.on) { pause(); startPick(); } else startPick(); };
window.addEventListener('keydown', e => {
  const tag = (e.target && e.target.tagName) || '';
  if (R.picking && e.key === 'Escape') { endPick(); e.preventDefault(); e.stopImmediatePropagation(); return; }
  if (!R.on || /INPUT|TEXTAREA|SELECT/.test(tag) || e.ctrlKey || e.metaKey || e.altKey) return;
  let ok = true;
  if (e.key === ' ') R.playing ? pause() : play();
  else if (e.key === 'ArrowRight') { pause(); step(e.shiftKey ? 10 : 1); }
  else if (e.shiftKey && e.code === 'KeyB') order(1);
  else if (e.shiftKey && e.code === 'KeyS') order(-1);
  else if (e.shiftKey && e.code === 'KeyC') { if (R.pos) order(-Math.sign(R.pos.qty), Math.abs(R.pos.qty), 'ручное закрытие'); }
  else ok = false;
  if (ok) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);

window.QLReplay = { get state() { return R; }, startAt: async idx => { R.on = true; R.symbol = S.symbol; btnHost.querySelector('button').classList.add('on'); await A.replayStart(idx); syncLast(); R.startT = R.lastT; bar.classList.remove('hidden'); renderBar(); drawMarkers(); drawLines(); },
  order, step, play, pause, exit: exitReplay, stats, showResults };
})();
