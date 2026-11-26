/* Pandich Lab front-end: lightweight-charts v5 + PineTS output renderer + Panda chat */
(() => {
'use strict';
const LWC = window.LightweightCharts;
const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
// Multi-chart: extra cells are this same page in an iframe with ?cell=N&mc=<id>. Cell state lives under ql.cN.* keys.
const QS = new URLSearchParams(location.search);
const CELL = Math.max(0, parseInt(QS.get('cell'), 10) || 0);
const EMBED = CELL > 0 && window.parent !== window;
const MC_ID = EMBED ? (QS.get('mc') || '') : 'mc-' + Math.random().toString(36).slice(2);
if (EMBED) document.body.classList.add('embed');
const K = k => EMBED ? k.replace(/^ql\./, `ql.c${CELL}.`) : k;
const cget = (k, d) => store.get(K(k), EMBED ? store.get(k, d) : d); // a new cell starts as a copy of the main chart

// ───────── state ─────────
const S = {
  cell: CELL, embed: EMBED,
  symbol: cget('ql.symbol', 'BTCUSDT'),
  interval: cget('ql.interval', '15m'),
  limit: cget('ql.limit', 1500),
  bars: [],
  scripts: cget('ql.scripts', []).map(s => ({ ...s, result: null, error: null })),
  selectedId: null,
  sessionId: store.get('ql.session', 'sess-' + Math.random().toString(36).slice(2)),
  busy: false,
  abort: null,
};
store.set('ql.session', S.sessionId);
let uid = Date.now();
const newId = () => 's' + (uid++).toString(36);
const saveScripts = () => store.set(K('ql.scripts'), S.scripts.map(({ id, name, code, inputs, visible }) => ({ id, name, code, inputs, visible })));

// ───────── chart ─────────
const chartEl = $('chart');
const chart = LWC.createChart(chartEl, {
  autoSize: true,
  layout: { background: { color: '#131416' }, textColor: '#9a9da5', attributionLogo: true, panes: { separatorColor: '#2a2c31' } },
  grid: { vertLines: { color: '#1c1d21' }, horzLines: { color: '#1c1d21' } },
  rightPriceScale: { borderColor: '#2a2c31' },
  timeScale: { borderColor: '#2a2c31', timeVisible: true, secondsVisible: false, rightOffset: 8 },
  crosshair: { mode: LWC.CrosshairMode.Normal },
});
const candles = chart.addSeries(LWC.CandlestickSeries, {
  upColor: '#26a69a', downColor: '#ef5350', borderUpColor: '#26a69a', borderDownColor: '#ef5350', wickUpColor: '#26a69a', wickDownColor: '#ef5350',
});
const volume = chart.addSeries(LWC.HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
const watermark = LWC.createTextWatermark(chart.panes()[0], { horzAlign: 'center', vertAlign: 'center', lines: [{ text: '', color: 'rgba(255,255,255,0.06)', fontSize: 40 }] });
const markersApi = LWC.createSeriesMarkers(candles, []);
// shared handle for drawings.js (drawing tools)
window.QL = { chart, candles, getBars: () => S.bars, getSymbol: () => S.symbol };
let indicatorSeries = []; // ISeriesApi[] created for scripts
let priceLines = [];      // { series, line }

// ───────── helpers ─────────
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function md(s) {
  let h = esc(s);
  h = h.replace(/```(?:\w+)?\n([\s\S]*?)```/g, (_, c) => `<pre>${c}</pre>`);
  h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  return h;
}
function fmt(n, d = 2) { return (n === null || n === undefined || !Number.isFinite(+n)) ? '—' : (+n).toFixed(d); }
async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  return r.json();
}
S.logs = [];
function log(text, level = 'info', src = 'app') {
  S.logs.push({ t: Date.now(), text: String(text), level, src }); if (S.logs.length > 500) S.logs.splice(0, S.logs.length - 500);
  window.dispatchEvent(new CustomEvent('ql:log'));
}

// ───────── data ─────────
async function loadBars() {
  $('dataStatus').textContent = 'загрузка…';
  try {
    const r = await fetch(`/api/klines?symbol=${encodeURIComponent(S.symbol)}&interval=${S.interval}&limit=${S.limit}`);
    const j = await r.json();
    if (!r.ok || !j.bars) throw new Error(j.error || 'нет данных');
    S.bars = j.bars;
    if (j.interval) S.interval = j.interval;
    S.srcLabel = j.srcLabel || '';
    setVolumeData();
    applyCandles();
    watermark.applyOptions({ lines: [{ text: `${S.symbol} · ${S.interval}`, color: 'rgba(255,255,255,0.06)', fontSize: 40 }] });
    updateStatus();
    const kv = S.keepView; S.keepView = null;
    if (kv) { // timeframe changed: keep the same moment in view with a similar number of bars
      const c = T2L(kv.centerTime);
      if (c !== null && c < S.bars.length - 1) { S.keptRange = { from: c - kv.span / 2, to: c + kv.span / 2 }; chart.timeScale().setVisibleLogicalRange(S.keptRange); }
      else chart.timeScale().scrollToRealTime();
    } else chart.timeScale().scrollToRealTime();
    window.dispatchEvent(new Event('ql:data'));
    startStream();
  } catch (e) {
    stopStream();
    $('dataStatus').textContent = 'ошибка данных: ' + e.message;
    log('Данные: ' + e.message);
  }
}

const volColor = b => b.close >= b.open ? 'rgba(38,166,154,0.35)' : 'rgba(239,83,80,0.35)';
function setVolumeData() { volume.setData(S.bars.map(b => ({ time: b.time, value: b.volume, color: volColor(b) }))); }

// ───────── live stream ─────────
// One SSE connection per browser tab (owned by the main window) carries every cell's series: browsers allow only 6
// connections per host, so 8 charts with their own EventSource would starve each other.
const QLHub = EMBED ? null : (() => {
  const subs = new Map(); // cellId → { key, onMsg, onErr }
  let es = null, cur = '', timer = null;
  function connect() {
    const keys = [...new Set([...subs.values()].map(x => x.key))].sort();
    const want = keys.join(',');
    if (want === cur && es) return;
    if (es) { es.close(); es = null; }
    cur = want; if (!keys.length) return;
    es = new EventSource('/api/stream?subs=' + encodeURIComponent(want));
    es.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch { return; } for (const x of [...subs.values()]) if (x.key === m.key) { try { x.onMsg(m); } catch { /* cell gone */ } } };
    es.addEventListener('error', ev => { if (!ev || !ev.data) return; let m; try { m = JSON.parse(ev.data); } catch { return; } for (const x of [...subs.values()]) if (x.key === m.key) { try { x.onErr(m.error); } catch { /* cell gone */ } } });
  }
  const sched = () => { clearTimeout(timer); timer = setTimeout(connect, 60); };
  return {
    sub(cell, symbol, interval, onMsg, onErr) { subs.set(cell, { key: `${symbol}|${interval}`, onMsg, onErr }); sched(); },
    unsub(cell) { if (subs.delete(cell)) sched(); },
    get size() { return subs.size; },
  };
})();
const hub = () => { try { return EMBED ? window.parent.QLHub : QLHub; } catch { return null; } };
let streamOn = false, rerunTimer = null, lastTickAt = 0;
function updateStatus(extra) {
  const last = S.bars[S.bars.length - 1];
  const live = streamOn && Date.now() - lastTickAt < 10000;
  $('dataStatus').innerHTML = `<span class="live-dot ${live ? 'on' : ''}"></span>${esc(EMBED ? (S.srcLabel || '').split(' · ')[0] : (S.srcLabel || ''))}${EMBED ? '' : ` · ${S.bars.length} баров`} · ${last ? fmt(last.close, priceDigits()) : '—'}${extra ? ' · ' + esc(extra) : ''}`;
}
function priceDigits() {
  const last = S.bars[S.bars.length - 1]; if (!last) return 2;
  const v = Math.abs(last.close); return v >= 1000 ? 2 : v >= 10 ? 3 : v >= 1 ? 4 : 6;
}
function stopStream() { const h = hub(); if (h) h.unsub(CELL); streamOn = false; }
function startStream() {
  const h = hub(); if (!h) return;
  const sym = S.symbol, tf = S.interval;
  streamOn = true;
  h.sub(CELL, sym, tf, m => {
    if (sym !== S.symbol || tf !== S.interval) return;
    let appended = false;
    for (const b of m.bars) appended = applyLiveBar(b) || appended;
    lastTickAt = Date.now();
    updateStatus();
    if (appended || m.newBar) { clearTimeout(rerunTimer); rerunTimer = setTimeout(() => runAll(), 300); } // indicators recompute on bar close
  }, err => updateStatus('поток: ' + err));
}
window.addEventListener('pagehide', stopStream);
function applyLiveBar(b) {
  const n = S.bars.length; if (!n) return false;
  const last = S.bars[n - 1];
  if (b.time < last.time) { // late update of a just-closed bar
    for (let i = n - 2; i >= Math.max(0, n - 6); i--) if (S.bars[i].time === b.time) { S.bars[i] = b; break; }
    return false;
  }
  const appended = b.time > last.time;
  if (appended) S.bars.push(b); else S.bars[n - 1] = b;
  updateMainBar(appended);
  volume.update({ time: b.time, value: b.volume, color: b.close >= b.open ? 'rgba(38,166,154,0.35)' : 'rgba(239,83,80,0.35)' });
  return appended;
}
setInterval(() => { if (streamOn) updateStatus(); }, 5000);
// "update available" banner when the UI files on disk change (new version deployed)
let uiVer = null;
setInterval(async () => {
  try {
    const v = await api('/api/version');
    if (uiVer === null) { uiVer = v.ui; return; }
    if (v.ui !== uiVer && !document.getElementById('updBanner')) {
      const d = document.createElement('div'); d.id = 'updBanner'; d.className = 'upd-banner';
      d.innerHTML = 'Pandich Lab обновлён <button>Обновить страницу</button><button class="x" title="Позже">✕</button>';
      d.querySelector('button').onclick = () => location.reload(); d.querySelector('.x').onclick = () => d.remove();
      document.body.appendChild(d);
    }
  } catch { /* server restarting */ }
}, 20000);
// ───────── chart types ─────────
// The candlestick series stays the anchor (markers, drawings and overlays use it for coordinates).
// For non-candle types it is made transparent and a "view" series of the chosen type is drawn on top.
const CANDLE_STYLE = { upColor: '#26a69a', downColor: '#ef5350', borderUpColor: '#26a69a', borderDownColor: '#ef5350', wickUpColor: '#26a69a', wickDownColor: '#ef5350', borderVisible: true, wickVisible: true, lastValueVisible: true, priceLineVisible: true };
const CHART_TYPES = ['candles', 'hollow', 'bars', 'line', 'line_markers', 'step', 'area', 'baseline', 'columns', 'ha'];
S.chartType = CHART_TYPES.includes(cget('ql.ctype', 'candles')) ? cget('ql.ctype', 'candles') : 'candles';
let viewSeries = null, viewType = null;
function heikinAshi(bars) {
  const out = new Array(bars.length); let po = null, pc = null;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i], c = (b.open + b.high + b.low + b.close) / 4, o = po === null ? (b.open + b.close) / 2 : (po + pc) / 2;
    out[i] = { time: b.time, open: o, high: Math.max(b.high, o, c), low: Math.min(b.low, o, c), close: c }; po = o; pc = c;
  }
  return out;
}
function candleData() { return S.chartType === 'ha' ? heikinAshi(S.bars) : S.bars.map(b => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close })); }
function viewPoint(b, t) {
  if (t === 'bars') return { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close };
  if (t === 'columns') return { time: b.time, value: b.close, color: b.close >= b.open ? 'rgba(38,166,154,0.75)' : 'rgba(239,83,80,0.75)' };
  return { time: b.time, value: b.close };
}
function ensureViewSeries(t) {
  if (viewSeries && viewType === t) return;
  if (viewSeries) { try { chart.removeSeries(viewSeries); } catch { /* gone */ } viewSeries = null; viewType = null; }
  const common = { priceLineVisible: true, lastValueVisible: true };
  if (t === 'bars') viewSeries = chart.addSeries(LWC.BarSeries, { ...common, upColor: '#26a69a', downColor: '#ef5350', thinBars: false }, 0);
  else if (t === 'line' || t === 'line_markers' || t === 'step') viewSeries = chart.addSeries(LWC.LineSeries, { ...common, color: '#2962ff', lineWidth: 2, pointMarkersVisible: t === 'line_markers', lineType: t === 'step' ? LWC.LineType.WithSteps : LWC.LineType.Simple }, 0);
  else if (t === 'area') viewSeries = chart.addSeries(LWC.AreaSeries, { ...common, lineColor: '#2962ff', topColor: 'rgba(41,98,255,0.35)', bottomColor: 'rgba(41,98,255,0.02)', lineWidth: 2 }, 0);
  else if (t === 'baseline') viewSeries = chart.addSeries(LWC.BaselineSeries, { ...common, lineWidth: 2 }, 0);
  else if (t === 'columns') viewSeries = chart.addSeries(LWC.HistogramSeries, { ...common }, 0);
  viewType = t;
}
function applyCandles() {
  const t = S.chartType, candleLike = t === 'candles' || t === 'hollow' || t === 'ha';
  if (candleLike) {
    if (viewSeries) { try { chart.removeSeries(viewSeries); } catch { /* gone */ } viewSeries = null; viewType = null; }
    candles.applyOptions(t === 'hollow' ? { ...CANDLE_STYLE, upColor: 'rgba(0,0,0,0)' } : CANDLE_STYLE);
    const bc = new Map();
    for (const s of S.scripts) if (s.visible && s.result) for (const b of s.result.barcolors) bc.set(b.t, b.c);
    candles.setData(candleData().map(b => { const c = bc.get(b.time); return c ? { ...b, color: c, borderColor: c, wickColor: c } : b; }));
  } else {
    candles.applyOptions({ upColor: 'rgba(0,0,0,0)', downColor: 'rgba(0,0,0,0)', borderVisible: false, wickVisible: false, lastValueVisible: false, priceLineVisible: false });
    candles.setData(candleData());
    ensureViewSeries(t);
    if (t === 'baseline' && S.bars.length) { const cl = S.bars.map(b => b.close); viewSeries.applyOptions({ baseValue: { type: 'price', price: (Math.max(...cl) + Math.min(...cl)) / 2 } }); }
    if (t === 'columns' && S.bars.length) viewSeries.applyOptions({ base: Math.min(...S.bars.map(b => b.low)) });
    viewSeries.setData(S.bars.map(b => viewPoint(b, t)));
  }
}
function updateMainBar() {
  const n = S.bars.length; if (!n) return;
  const b = S.bars[n - 1];
  if (S.chartType === 'ha') { const ha = heikinAshi(S.bars.slice(Math.max(0, n - 300))); candles.update(ha[ha.length - 1]); }
  else candles.update({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close });
  if (viewSeries) viewSeries.update(viewPoint(b, viewType));
}
function setChartType(t) {
  if (!CHART_TYPES.includes(t)) return;
  S.chartType = t; store.set(K('ql.ctype'), t);
  applyCandles(); requestDraw(); window.dispatchEvent(new CustomEvent('ql:ctype'));
}
// ───────── price scale ─────────
S.scale = Object.assign({ mode: 0, invert: false }, cget('ql.scale', {}));
function applyScale() { chart.priceScale('right').applyOptions({ mode: S.scale.mode, invertScale: !!S.scale.invert }); requestDraw(); }
function setScale(patch) { Object.assign(S.scale, patch); store.set(K('ql.scale'), S.scale); applyScale(); }

// ───────── scripts: run + render ─────────
async function runScript(s) {
  const until = S.replay && S.bars.length ? S.bars[S.bars.length - 1].time : undefined; // replay: the script sees only revealed bars
  const r = await api('/api/run', { code: s.code, symbol: S.symbol, interval: S.interval, limit: S.limit, inputs: s.inputs || {}, until });
  if (r.ok) { s.result = r.result; s.error = null; s.name = r.result.title || s.name; if (!S.replay) log(`${s.name}: OK, ${r.result.ms} мс`); for (const l of r.result.logs || []) log(l.text, l.level, s.name); }
  else { s.result = null; s.error = r.error; log(`${s.name}: ${r.error}`, 'error'); for (const l of r.logs || []) log(l.text, l.level, s.name); }
}
async function runAll() {
  for (const s of S.scripts) if (s.visible) await runScript(s);
  renderAll();
}

function seriesFor(sp, paneIndex) {
  const st = String(sp.style || '');
  const clear = isClear(sp.color) && sp.data.every(d => !d.c || isClear(d.c)); // e.g. plot(x, color = color.new(black, 100)) used only for fill()
  const base = { title: clear ? '' : sp.title, color: sp.color, priceLineVisible: false, lastValueVisible: !clear, crosshairMarkerVisible: !clear };
  let ser;
  if (st.includes('histogram') || st.includes('columns')) ser = chart.addSeries(LWC.HistogramSeries, { ...base, base: 0 }, paneIndex);
  else if (st.includes('area')) ser = chart.addSeries(LWC.AreaSeries, { ...base, lineColor: sp.color, topColor: sp.color + '55', bottomColor: 'rgba(0,0,0,0)', lineWidth: Math.min(4, sp.linewidth || 1) }, paneIndex);
  else {
    const opts = { ...base, lineWidth: Math.min(4, sp.linewidth || 1) };
    if (st.includes('step')) opts.lineType = LWC.LineType.WithSteps;
    if (st.includes('circles') || st.includes('cross')) { opts.lineVisible = false; opts.pointMarkersVisible = true; }
    ser = chart.addSeries(LWC.LineSeries, opts, paneIndex);
  }
  const isArea = st.includes('area');
  // plot.style_linebr: the line must break on na. Lightweight Charts joins points across whitespace, but a segment is drawn
  // with the style of its START point → make the last point before every gap transparent.
  const br = st.includes('linebr') && !isArea;
  let lastVal = -1; if (br) for (let i = sp.data.length - 1; i >= 0; i--) if (sp.data[i].v !== null) { lastVal = i; break; }
  ser.setData(sp.data.map((d, i, arr) => {
    if (d.v === null) return { time: d.t };
    const gapNext = br && i < lastVal && arr[i + 1].v === null; // the series' final point keeps its colour (price-scale label)
    return gapNext ? { time: d.t, value: d.v, color: 'rgba(0,0,0,0)' } : (d.c && !isArea ? { time: d.t, value: d.v, color: d.c } : { time: d.t, value: d.v });
  }));
  indicatorSeries.push(ser);
  return ser;
}

function clearIndicators() {
  for (const p of priceLines) { try { p.series.removePriceLine(p.line); } catch { /* already gone */ } }
  priceLines = [];
  for (const s of indicatorSeries) { try { chart.removeSeries(s); } catch { /* already gone */ } }
  indicatorSeries = [];
  // drop now-empty panes (keep pane 0)
  for (let i = chart.panes().length - 1; i >= 1; i--) if (!chart.panes()[i].getSeries().length) chart.removePane(i);
}

function renderAll() {
  clearIndicators();
  applyCandles();
  const markers = [];
  let nextPane = 1;
  for (const s of S.scripts) {
    s._series = {};
    if (!s.visible || !s.result) continue;
    const R = s.result;
    const subPane = R.series.some(x => x.pane !== 0) || (!R.overlay && R.hlines.length) ? nextPane++ : null;
    for (const sp of R.series) s._series[sp.title] = { api: seriesFor(sp, sp.pane === 0 ? 0 : subPane), pane: sp.pane === 0 ? 0 : subPane };
    for (const h of R.hlines) {
      let host = R.overlay ? candles : (Object.values(s._series).find(x => x.pane === subPane) || {}).api;
      if (!host && subPane !== null) host = seriesFor({ title: '', style: 'style_line', color: 'rgba(0,0,0,0)', data: S.bars.map(b => ({ t: b.time, v: null })) }, subPane);
      if (host) priceLines.push({ series: host, line: host.createPriceLine({ price: h.price, color: h.color, lineWidth: 1, lineStyle: LWC.LineStyle.Dashed, axisLabelVisible: true, title: '' }) });
    }
    for (const m of R.markers) markers.push(m);
    if (R.strategy) {
      for (const t of R.strategy.closedtrades.concat(R.strategy.opentrades)) {
        const long = (t.size || 0) >= 0;
        markers.push({ time: t.entry_time, position: long ? 'belowBar' : 'aboveBar', shape: long ? 'arrowUp' : 'arrowDown', color: long ? '#2962ff' : '#ff6d00', text: t.entry_id || '' });
        if (t.exit_time) markers.push({ time: t.exit_time, position: long ? 'aboveBar' : 'belowBar', shape: 'circle', color: (t.profit || 0) >= 0 ? '#26a69a' : '#ef5350', text: fmt(t.profit, 2) });
      }
    }
  }
  const valid = new Set(S.bars.map(b => b.time));
  markersApi.setMarkers(markers.filter(m => valid.has(m.time)).sort((a, b) => a.time - b.time));
  renderLegend();
  renderTables();
  requestDraw();
  window.dispatchEvent(new CustomEvent('ql:render'));
}

// time (sec, may be fractional/future) → logical index on the chart's own bar array
function T2L(t) {
  const b = S.bars, n = b.length; if (!n || t === null || t === undefined) return null;
  const step = n > 1 ? b[n - 1].time - b[n - 2].time : 60;
  if (t <= b[0].time) return (t - b[0].time) / step;
  if (t >= b[n - 1].time) return n - 1 + (t - b[n - 1].time) / step;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (b[m].time <= t) lo = m; else hi = m; }
  return lo + (t - b[lo].time) / (b[hi].time - b[lo].time);
}

// ───────── overlay canvas: labels / lines / boxes / bgcolor / fills ─────────
const cv = $('overlay');
const g = cv.getContext('2d');
let drawPending = false;
function requestDraw() { if (!drawPending) { drawPending = true; requestAnimationFrame(draw); } }
function dash(style, w) { const s = String(style || ''); return s.includes('dash') ? [6 * w, 4 * w] : s.includes('dot') ? [w, 3 * w] : []; }

function draw() {
  drawPending = false;
  const w = chart.timeScale().width();
  const h = chart.paneSize(0).height;
  const dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px';
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  if (!S.bars.length) return;
  const ts = chart.timeScale();
  const X = li => ts.logicalToCoordinate(li);
  const Y = p => candles.priceToCoordinate(p);
  const idxByTime = new Map(S.bars.map((b, i) => [b.time, i]));
  const range = ts.getVisibleLogicalRange();
  const lo = range ? range.from - 2 : 0, hi = range ? range.to + 2 : S.bars.length;
  const barW = Math.max(1, (X(1) ?? 1) - (X(0) ?? 0));

  for (const s of S.scripts) {
    if (!s.visible || !s.result) continue;
    const R = s.result;
    // bgcolor (overlay scripts only — price pane)
    if (R.overlay) for (const b of R.bg) {
      const i = idxByTime.get(b.t); if (i === undefined || i < lo || i > hi) continue;
      const x = X(i); if (x === null) continue;
      g.fillStyle = b.c; g.fillRect(x - barW / 2, 0, barW, h);
    }
    // fill() between two price-pane plots
    for (const f of R.fills) {
      const p1 = R.series.find(x => x.title === f.plot1), p2 = R.series.find(x => x.title === f.plot2);
      if (!p1 || !p2 || p1.pane !== 0 || p2.pane !== 0) continue;
      const cmap = new Map(f.data.map(d => [d.t, d.c]));
      for (let k = 1; k < p1.data.length; k++) {
        const i = idxByTime.get(p1.data[k].t); if (i === undefined || i < lo || i > hi) continue;
        const a1 = p1.data[k - 1].v, b1 = p1.data[k].v, a2 = p2.data[k - 1] && p2.data[k - 1].v, b2 = p2.data[k] && p2.data[k].v;
        const c = cmap.get(p1.data[k].t) || f.color;
        if ([a1, b1, a2, b2].some(v => v === null || v === undefined) || !c) continue;
        const x0 = X(i - 1), x1 = X(i); if (x0 === null || x1 === null) continue;
        g.fillStyle = c; g.beginPath();
        g.moveTo(x0, Y(a1)); g.lineTo(x1, Y(b1)); g.lineTo(x1, Y(b2)); g.lineTo(x0, Y(a2)); g.closePath(); g.fill();
      }
    }
    if (!R.overlay && !R.labels.length && !R.lines.length && !R.boxes.length) continue;
    // boxes
    for (const b of R.boxes) {
      const bl1 = T2L(b.t1), bl2 = T2L(b.t2); if (bl1 === null || bl2 === null) continue;
      let x1 = X(bl1), x2 = X(bl2); const y1 = Y(b.top), y2 = Y(b.bottom);
      if (x1 === null || x2 === null || y1 === null || y2 === null) continue;
      const ext = String(b.extend || 'none');
      if (ext.includes('right') || ext.includes('both')) x2 = w;
      if (ext.includes('left') || ext.includes('both')) x1 = 0;
      if (b.bgcolor) { g.fillStyle = b.bgcolor; g.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)); }
      if (b.border_color && (b.border_width ?? 1) > 0) {
        g.strokeStyle = b.border_color; g.lineWidth = b.border_width || 1; g.setLineDash(dash(b.border_style, g.lineWidth));
        g.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)); g.setLineDash([]);
      }
      if (b.text) { g.fillStyle = b.text_color || '#ddd'; g.font = '11px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(b.text, (x1 + x2) / 2, (y1 + y2) / 2); }
    }
    // lines
    for (const l of R.lines) {
      const ll1 = T2L(l.t1), ll2 = T2L(l.t2); if (ll1 === null || ll2 === null) continue;
      let x1 = X(ll1), x2 = X(ll2), y1 = Y(l.y1), y2 = Y(l.y2);
      if ([x1, x2, y1, y2].some(v => v === null)) continue;
      const ext = String(l.extend || 'none');
      if (x2 !== x1 && (ext.includes('right') || ext.includes('both'))) { const k = (y2 - y1) / (x2 - x1); const nx = x2 > x1 ? w : 0; y2 = y2 + k * (nx - x2); x2 = nx; }
      if (x2 !== x1 && (ext.includes('left') || ext.includes('both'))) { const k = (y2 - y1) / (x2 - x1); const nx = x1 < x2 ? 0 : w; y1 = y1 + k * (nx - x1); x1 = nx; }
      g.strokeStyle = l.color || '#2962ff'; g.lineWidth = l.width || 1; g.setLineDash(dash(l.style, g.lineWidth));
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); g.setLineDash([]);
    }
    // labels
    g.textBaseline = 'middle'; g.textAlign = 'center';
    for (const lb of R.labels) {
      const fpx = Math.max(9, Math.min(20, pinePx(lb.size) - 1)), lh = fpx + 2;
      g.font = `${lb.fromShape ? '600 ' : ''}${fpx}px sans-serif`;
      const lli = T2L(lb.t); if (lli === null || lli < lo || lli > hi) continue;
      const x = X(lli); if (x === null) continue;
      let price = lb.y;
      const bi = Math.round(lli);
      if (S.bars[bi] && (lb.yloc === 'ab' || lb.yloc === 'abovebar')) price = S.bars[bi].high;
      if (S.bars[bi] && (lb.yloc === 'bl' || lb.yloc === 'belowbar')) price = S.bars[bi].low;
      const y = Y(price); if (y === null) continue;
      const lines = String(lb.text || '').split('\n');
      const tw = Math.max(8, ...lines.map(t => g.measureText(t).width)) + 10, th = lines.length * lh + 6;
      const st = String(lb.style || '');
      let bx = x - tw / 2, by = y - th / 2;
      if (st.includes('label_down') || st.includes('arrowdown') || st.includes('triangledown')) by = y - th - 6;
      else if (st.includes('label_up') || st.includes('arrowup') || st.includes('triangleup')) by = y + 6;
      else if (st.includes('label_left')) bx = x + 6;
      else if (st.includes('label_right')) bx = x - tw - 6;
      const none = st.includes('none') || !lb.color || /#[0-9a-f]{6}00$/i.test(lb.color);
      if (!none) {
        g.fillStyle = lb.color; g.beginPath(); g.roundRect ? g.roundRect(bx, by, tw, th, 3) : g.rect(bx, by, tw, th); g.fill();
        g.beginPath();
        if (by < y - th / 2) { g.moveTo(x - 4, by + th); g.lineTo(x + 4, by + th); g.lineTo(x, y); }
        else if (by > y - th / 2) { g.moveTo(x - 4, by); g.lineTo(x + 4, by); g.lineTo(x, y); }
        g.fill();
      }
      g.fillStyle = lb.textcolor || (none ? lb.color || '#ddd' : '#fff');
      lines.forEach((t, k) => g.fillText(t, bx + tw / 2, by + 3 + lh / 2 + k * lh));
    }
  }
}
chart.timeScale().subscribeVisibleLogicalRangeChange(requestDraw);
new ResizeObserver(requestDraw).observe($('chartWrap'));
for (const ev of ['mousemove', 'wheel', 'mouseup', 'mousedown']) chartEl.addEventListener(ev, requestDraw, { passive: true });

// ───────── tables (HTML) — Pine table.* : merges, text sizes, alignment, borders/frame, cell width/height in % of the pane ─────────
const PINE_PX = { auto: 11, tiny: 9, small: 11, normal: 13, large: 18, huge: 28 };
function pinePx(sz) { if (typeof sz === 'number' && sz > 0) return sz; const k = String(sz || 'auto').replace(/^size[._]/, '').toLowerCase(); return PINE_PX[k] || 11; }
const isClear = c => !c || c === 'transparent' || /^#[0-9a-f]{6}00$/i.test(c) || /^rgba\(.*,\s*0(\.0+)?\s*\)$/i.test(c);
const alignOf = (a, d) => { const k = String(a || '').toLowerCase(); return k.includes('left') ? 'left' : k.includes('right') ? 'right' : k.includes('top') ? 'top' : k.includes('bottom') ? 'bottom' : k.includes('center') ? (d === 'v' ? 'middle' : 'center') : (d === 'v' ? 'middle' : 'center'); };
function renderTables() {
  const host = $('tables'); host.innerHTML = '';
  const ph = chart.paneSize(0).height, pw = chart.timeScale().width();
  for (const s of S.scripts) {
    if (!s.visible || !s.result) continue;
    for (const t of s.result.tables) {
      const rows = t.cells || [];
      if (!rows.some(r => (r || []).some(c => c && c.text !== ''))) continue; // nothing to show yet
      const span = {}; // "r,c" → {cs, rs} for merge origins
      for (const m of t.merges || []) span[`${m.r0},${m.c0}`] = { cs: m.c1 - m.c0 + 1, rs: m.r1 - m.r0 + 1 };
      const covered = new Set();
      for (const m of t.merges || []) for (let r = m.r0; r <= m.r1; r++) for (let c = m.c0; c <= m.c1; c++) if (r !== m.r0 || c !== m.c0) covered.add(`${r},${c}`);
      const bw = Number(t.border_width) || 0, fw = Number(t.frame_width) || 0;
      const bc = !isClear(t.border_color) && bw ? `${bw}px solid ${t.border_color}` : 'none';
      const el = document.createElement('table'); el.className = 'pt';
      el.style.background = isClear(t.bgcolor) ? 'transparent' : t.bgcolor;
      el.style.border = fw && !isClear(t.frame_color) ? `${fw}px solid ${t.frame_color}` : 'none';
      el.innerHTML = rows.map((r, ri) => '<tr>' + (r || []).map((c, ci) => {
        if (covered.has(`${ri},${ci}`)) return '';
        const sp = span[`${ri},${ci}`]; const attr = sp ? `${sp.cs > 1 ? ` colspan="${sp.cs}"` : ''}${sp.rs > 1 ? ` rowspan="${sp.rs}"` : ''}` : '';
        if (!c) return `<td${attr} style="border:${bc}"></td>`;
        const st = [`color:${isClear(c.text_color) ? '#d1d4dc' : c.text_color}`, `background:${isClear(c.bgcolor) ? 'transparent' : c.bgcolor}`, `font-size:${pinePx(c.text_size)}px`,
          `text-align:${alignOf(c.text_halign, 'h')}`, `vertical-align:${alignOf(c.text_valign, 'v')}`, `border:${bc}`];
        if (Number(c.width) > 0) st.push(`width:${(c.width / 100 * pw).toFixed(0)}px`);
        if (Number(c.height) > 0) st.push(`height:${(c.height / 100 * ph).toFixed(0)}px`);
        return `<td${attr} style="${esc(st.join(';'))}">${esc(c.text).replace(/\n/g, '<br>')}</td>`;
      }).join('') + '</tr>').join('');
      const pos = String(t.position || 'top_right').replace(/^position[._]/, '');
      host.appendChild(el);
      const W = el.offsetWidth, H = el.offsetHeight;
      el.style.left = (pos.endsWith('left') ? 8 : pos.endsWith('center') ? (pw - W) / 2 : pw - W - 8) + 'px';
      el.style.top = (pos.startsWith('top') ? 30 : pos.startsWith('middle') ? (ph - H) / 2 : ph - H - 8) + 'px';
    }
  }
}

// ───────── legend ─────────
function renderLegend() {
  const el = $('legend'); el.innerHTML = '';
  for (const s of S.scripts) {
    const row = document.createElement('div');
    row.className = 'leg' + (s.id === S.selectedId ? ' sel' : '') + (s.visible ? '' : ' off');
    row.innerHTML = `<span class="nm" title="Выбрать для правки через Panda">${esc(s.name || 'Script')}</span>` +
      (s.error ? '<span class="err" title="ошибка">⚠</span>' : '') +
      `<button data-a="eye" title="Показать/скрыть">${s.visible ? '◉' : '○'}</button>` +
      `<button data-a="cfg" title="Настройки">⚙</button>` +
      `<button data-a="code" title="Код">⟨/⟩</button>` +
      `<button data-a="del" title="Удалить">✕</button>`;
    row.querySelector('.nm').onclick = () => selectScript(S.selectedId === s.id ? null : s.id);
    row.querySelectorAll('button').forEach(b => b.onclick = async () => {
      const a = b.dataset.a;
      if (a === 'eye') { s.visible = !s.visible; saveScripts(); if (s.visible && !s.result) await runScript(s); renderAll(); }
      if (a === 'cfg') openInputs(s);
      if (a === 'code') { selectScript(s.id); window.QLPanels && window.QLPanels.openEditor(s.id); }
      if (a === 'del') { S.scripts = S.scripts.filter(x => x !== s); if (S.selectedId === s.id) selectScript(null); saveScripts(); renderAll(); }
    });
    el.appendChild(row);
  }
}

function selectScript(id) {
  S.selectedId = id;
  const s = S.scripts.find(x => x.id === id);
  const chip = $('editChip');
  if (s) { chip.innerHTML = `Panda правит: <b>${esc(s.name)}</b> <button title="Снять выбор">✕</button>`; chip.classList.remove('hidden'); chip.querySelector('button').onclick = () => selectScript(null); }
  else chip.classList.add('hidden');
  renderLegend();
  window.dispatchEvent(new CustomEvent('ql:render'));
}

// ───────── inputs dialog ─────────
function openInputs(s) {
  const meta = (s.result && s.result.inputsMeta) || [];
  const box = $('modalBox');
  if (!meta.length) { box.innerHTML = `<h3>${esc(s.name)}</h3><p class="muted">У скрипта нет input.* параметров.</p><div class="modal-actions"><button class="btn" id="mClose">Закрыть</button></div>`; }
  else {
    box.innerHTML = `<h3>${esc(s.name)} — настройки</h3>` + meta.map((m, k) => {
      const key = m.title || m.name; const cur = (s.inputs && key in s.inputs) ? s.inputs[key] : m.defval;
      let ctl;
      if (m.type === 'bool') ctl = `<input type="checkbox" data-k="${k}" ${cur ? 'checked' : ''}>`;
      else if (m.options && m.options.length) ctl = `<select data-k="${k}">${m.options.map(o => `<option ${String(o) === String(cur) ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
      else if (m.type === 'int' || m.type === 'float' || m.type === 'price') ctl = `<input type="number" data-k="${k}" value="${esc(cur)}" step="${m.step || (m.type === 'int' ? 1 : 'any')}" ${m.minval !== undefined ? `min="${m.minval}"` : ''} ${m.maxval !== undefined ? `max="${m.maxval}"` : ''}>`;
      else if (m.type === 'color') ctl = `<input type="color" data-k="${k}" value="${esc(String(cur || '#2962ff').slice(0, 7))}">`;
      else ctl = `<input type="text" data-k="${k}" value="${esc(cur ?? '')}">`;
      return `<div class="field"><label>${esc(key)}</label>${ctl}</div>`;
    }).join('') + `<div class="modal-actions"><button class="btn" id="mReset">По умолчанию</button><button class="btn" id="mClose">Отмена</button><button class="btn" id="mOk">Применить</button></div>`;
  }
  $('modal').classList.remove('hidden');
  const close = () => $('modal').classList.add('hidden');
  $('mClose').onclick = close;
  const ok = $('mOk'), rs = $('mReset');
  if (rs) rs.onclick = async () => { s.inputs = {}; saveScripts(); close(); await runScript(s); renderAll(); };
  if (ok) ok.onclick = async () => {
    const inputs = {};
    box.querySelectorAll('[data-k]').forEach(el => {
      const m = meta[+el.dataset.k]; const key = m.title || m.name;
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (m.type === 'int') v = parseInt(v, 10); else if (m.type === 'float' || m.type === 'price') v = parseFloat(v);
      if (v !== m.defval) inputs[key] = v;
    });
    s.inputs = inputs; saveScripts(); close(); await runScript(s); renderAll();
  };
}

// ───────── toolbar ─────────
async function setChart(symbol, interval, opt = {}) {
  const newSym = symbol ? symbol.toUpperCase() : S.symbol;
  if (interval && !symbol && S.bars.length) { const r = chart.timeScale().getVisibleLogicalRange();
    if (r && r.to < S.bars.length - 2) { const c = Math.round((r.from + r.to) / 2); const bi = S.bars[Math.max(0, Math.min(S.bars.length - 1, c))]; if (bi) S.keepView = { centerTime: bi.time, span: r.to - r.from }; } }
  const symChanged = newSym !== S.symbol, tfChanged = !!interval && interval !== S.interval;
  const rp = S.replay && S.bars.length ? { tEnd: S.bars[S.bars.length - 1].time + barSec(S.bars) } : null; // replay survives a TF/symbol switch
  if (rp) { S.replay = null; S.keepView = null; }
  S.symbol = newSym; if (interval) S.interval = interval;
  store.set(K('ql.symbol'), S.symbol); store.set(K('ql.interval'), S.interval);
  if (!opt.remote) { if (symChanged) syncPost({ t: 'sym', symbol: S.symbol }); if (tfChanged) syncPost({ t: 'tf', interval: S.interval }); }
  S.keptRange = null;
  await loadBars();
  if (rp && S.bars.length) { // resume at the last bar of the new series that was already closed at the replay cursor
    const sec = barSec(S.bars); let i = S.bars.length - 1;
    while (i > 0 && S.bars[i].time + sec > rp.tEnd) i--;
    await replayStart(Math.max(1, i)); window.dispatchEvent(new CustomEvent('ql:replay', { detail: { reason: 'reload' } })); return;
  }
  await runAll();
  if (S.keptRange) { chart.timeScale().setVisibleLogicalRange(S.keptRange); S.keptRange = null; } // indicator re-render can reset the view
}

// ───────── replay: reveal history bar by bar; scripts re-run on the revealed bars only (no look-ahead) ─────────
S.replay = null; // { full: all loaded bars, idx: index of the last revealed bar }
function barSec(bars) { let m = Infinity; for (let i = 1; i < Math.min(bars.length, 60); i++) m = Math.min(m, bars[i].time - bars[i - 1].time); return Number.isFinite(m) && m > 0 ? m : 60; }
let runBusy = false, runPending = false;
async function runAllCoalesced() { // during play: never queue more than one re-run behind the current one
  if (runBusy) { runPending = true; return; }
  runBusy = true;
  try { do { runPending = false; await runAll(); } while (runPending); } finally { runBusy = false; }
}
async function replayStart(idx) {
  const full = S.replay ? S.replay.full : S.bars.slice();
  if (full.length < 3) return false;
  stopStream();
  idx = Math.max(1, Math.min(full.length - 2, idx | 0));
  S.replay = { full, idx };
  S.bars = full.slice(0, idx + 1);
  setVolumeData(); applyCandles();
  chart.timeScale().scrollToRealTime();
  updateStatus('Replay'); window.dispatchEvent(new Event('ql:data'));
  await runAllCoalesced();
  return true;
}
function replayStep(n = 1) {
  const R = S.replay; if (!R) return 0;
  let k = 0;
  while (k < n && R.idx < R.full.length - 1) { R.idx++; const b = R.full[R.idx]; S.bars.push(b); updateMainBar(); volume.update({ time: b.time, value: b.volume, color: volColor(b) }); k++; }
  if (k) { updateStatus('Replay'); runAllCoalesced(); window.dispatchEvent(new CustomEvent('ql:replaybar', { detail: { bars: R.full.slice(R.idx - k + 1, R.idx + 1) } })); }
  return k;
}
async function replayStop() { if (!S.replay) return; S.replay = null; await loadBars(); await runAll(); }

// ───────── multi-chart sync (symbol / interval / crosshair / time) between cells of one tab ─────────
const MC_DEFAULT = { layout: '1', sync: { symbol: false, interval: false, cross: true, time: false } };
const mcCfg = () => { const c = store.get('ql.mc', {}) || {}; return { ...MC_DEFAULT, ...c, sync: { ...MC_DEFAULT.sync, ...(c.sync || {}) } }; };
const bus = ('BroadcastChannel' in window) ? new BroadcastChannel('ql.sync') : null;
function syncPost(m) { if (bus && mcCfg().layout !== '1') bus.postMessage({ ...m, mc: MC_ID, cell: CELL, symbolOf: S.symbol }); }
let remoteUntil = 0; // ignore our own range/crosshair echoes while applying a remote update
S.hot = false; // pointer is over this chart → this cell is the one the user drives
$('chartWrap').addEventListener('pointerenter', () => { S.hot = true; });
$('chartWrap').addEventListener('pointerleave', () => { S.hot = false; if (mcCfg().sync.cross) syncPost({ t: 'cross', time: null }); });
function barAtOrBefore(t) {
  const b = S.bars; if (!b.length || t < b[0].time) return null;
  let lo = 0, hi = b.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (b[mid].time <= t) lo = mid; else hi = mid - 1; }
  return b[lo];
}
let crossRaf = 0, crossMsg = null;
chart.subscribeCrosshairMove(p => {
  if (!S.hot || Date.now() < remoteUntil || !mcCfg().sync.cross) return;
  crossMsg = p && p.time !== undefined && p.point ? { t: 'cross', time: p.time, price: candles.coordinateToPrice(p.point.y) } : { t: 'cross', time: null };
  if (!crossRaf) crossRaf = requestAnimationFrame(() => { crossRaf = 0; if (crossMsg) syncPost(crossMsg); });
});
let rangeRaf = 0;
chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
  if (!S.hot || Date.now() < remoteUntil || !mcCfg().sync.time || rangeRaf) return;
  rangeRaf = requestAnimationFrame(() => { rangeRaf = 0; const r = chart.timeScale().getVisibleRange(); if (r) syncPost({ t: 'time', from: r.from, to: r.to }); });
});
if (bus) bus.onmessage = ev => {
  const m = ev.data; if (!m || m.mc !== MC_ID || m.cell === CELL) return;
  const sc = mcCfg().sync;
  if (m.t === 'sym' && sc.symbol && m.symbol !== S.symbol) setChart(m.symbol, null, { remote: true });
  else if (m.t === 'tf' && sc.interval && m.interval !== S.interval) setChart(null, m.interval, { remote: true });
  else if (m.t === 'cross' && sc.cross && !S.hot) {
    remoteUntil = Date.now() + 80;
    const b = m.time === null ? null : barAtOrBefore(m.time);
    if (!b) chart.clearCrosshairPosition();
    else chart.setCrosshairPosition(m.symbolOf === S.symbol && Number.isFinite(m.price) ? m.price : b.close, b.time, candles);
  } else if (m.t === 'time' && sc.time && !S.hot && S.bars.length) {
    remoteUntil = Date.now() + 150;
    try { chart.timeScale().setVisibleRange({ from: m.from, to: m.to }); } catch { /* range outside loaded data */ }
  }
};
$('barsSel').onchange = e => { S.limit = +e.target.value; store.set(K('ql.limit'), S.limit); setChart(null, null); };

// ───────── chat ─────────
const msgs = $('messages');
const PI = { // panel icons (18×18)
  chart: '<svg viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5V2h3M13 2h3v3M16 13v3h-3M5 16H2v-3"/><circle cx="9" cy="9" r="2.5"/><path d="M3.5 9S5.5 5 9 5s5.5 4 5.5 4-2 4-5.5 4-5.5-4-5.5-4z"/></svg>',
  indicator: '<svg viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 2v14h14"/><path d="M5 12l3-4 3 2 4-6"/></svg>',
  strategy: '<svg viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="9" cy="9" r="6.5"/><path d="M9 1v3.5M9 13.5V17M1 9h3.5M13.5 9H17"/></svg>',
  fix: '<svg viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 2.5a3.5 3.5 0 00-3.3 4.6L2.5 12.8a1.4 1.4 0 002 2l5.7-5.7a3.5 3.5 0 004.6-3.3l-2 .9-1.9-1.9z"/></svg>',
  screenshot: '<svg viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="14" height="12" rx="2"/><circle cx="6.5" cy="7" r="1.3"/><path d="M16 12l-4-4-7 7"/></svg>',
  brainstorm: '<svg viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 13.5h5M7 16h4M9 2a5 5 0 00-3 9c.6.5 1 1.2 1 2h4c0-.8.4-1.5 1-2a5 5 0 00-3-9z"/></svg>',
  image: '<svg viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="14" height="12" rx="2"/><circle cx="6.5" cy="7" r="1.3"/><path d="M16 12l-4-4-7 7"/></svg>',
  code: '<svg viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 5L2 9l4 4M12 5l4 4-4 4"/></svg>',
  refresh: '<svg viewBox="0 0 18 18" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 9a6 6 0 11-1.8-4.3M15 2.5v3.5h-3.5"/></svg>',
};
const BRAIN_POOL = [
  'Спроецируй средний дневной диапазон от открытия дня верхней и нижней границей',
  'Отмечай пробои внутреннего бара на объёме выше среднего и считай, как часто они отрабатывают',
  'Сделай бэктест покупки, когда цена возвращается выше вчерашнего минимума после его снятия, со стопом под снятием',
  'Покажи, в какие часы суток (UTC) у этого инструмента самый большой средний диапазон',
  'Отмечай свечи-поглощения у локальных экстремумов и статистику следующих 5 баров',
  'Построй уровни открытия азиатской, лондонской и нью-йоркской сессий',
  'Сделай индикатор режима рынка: тренд / флэт по ADX и наклону EMA 200',
  'Протестируй пробой диапазона первых 30 минут Лондона с целью 1.5R',
  'Подсвечивай бары, где диапазон больше 2 ATR, и что происходит после них',
  'Отмечай снятие ликвидности над максимумом прошлого дня с возвратом в диапазон',
  'Посчитай, как часто цена закрывает гэп выходных в течение недели',
  'Сделай мультитаймфреймовую панель тренда (15м/1ч/4ч/1д) в углу графика',
];
const MODES = {
  chart: { name: 'Мой график', snap: true, items: [
    'Посмотри на мой график и скажи, какой сейчас тренд, где ключевые уровни и где разворачивается моментум',
    'Найди на моём графике уровни, на которые цена постоянно реагирует, и нарисуй их',
    'Разбери этот рынок на 4-часовом, часовом и 15-минутном таймфреймах и сведи общую картину',
    'Переключись на дневной график, посмотри последние шесть месяцев и опиши общую картину'],
    ph: ['Посмотри на мой график и скажи, где ближайшая поддержка', 'Нарисуй зоны спроса и предложения на моём графике', 'Есть ли сейчас сетап для входа?'] },
  indicator: { name: 'Индикатор', items: [
    'Отметь структуру рынка: повышающиеся максимумы, понижающиеся минимумы и каждый слом структуры',
    'Выдели обычные и скрытые дивергенции RSI с меткой на каждом пивоте',
    'Показывай сжатие волатильности, когда полосы Боллинджера уходят внутрь каналов Кельтнера',
    'Нарисуй разрывы справедливой стоимости и убирай каждый, как только цена его заполнит'],
    ph: ['Создай индикатор, который отмечает зоны спроса и предложения', 'Создай индикатор, который строит максимум, минимум и середину предыдущего дня', 'Создай индикатор VWAP с полосами стандартного отклонения'] },
  strategy: { name: 'Стратегия', items: [
    'Сделай бэктест пересечения EMA 20/50 со стопом по ATR и целью 2R',
    'Создай стратегию, которая покупает, когда RSI опускается ниже 30, но только пока цена выше EMA 200',
    'Торгуй пробои последнего свинг-максимума с трейлинг-стопом под предыдущим свинг-минимумом',
    'Преврати пробой из сжатия Боллинджера в стратегию с трейлинг-стопом'],
    ph: ['Сделай бэктест пробоя азиатской сессии с целью 2R', 'Создай стратегию на откат к EMA 50 в тренде'] },
  fix: { name: 'Исправить мой код', prefix: true, items: [
    'Исправь этот Pine Script®, чтобы он компилировался:',
    'Конвертируй этот скрипт в Pine Script® v6:',
    'Проверь этот скрипт на перерисовку и исправь её:',
    'Объясни, что делает этот Pine Script®:'],
    ph: ['Вставь код Pine Script и напиши, что с ним сделать'] },
  screenshot: { name: 'По скриншоту', needImage: true, items: [
    'Повтори индикатор со скриншота как можно точнее',
    'Определи, что за индикатор на скриншоте, и объясни его логику',
    'Сделай стратегию по сетапу, показанному на скриншоте'],
    ph: ['Приложи скриншот (＋ или Ctrl+V) и опиши, что повторить'] },
  brainstorm: { name: 'Мозговой штурм', brain: true, items: [],
    ph: ['Предложи идеи индикаторов для скальпинга золота', 'Какие сетапы чаще всего отрабатывают на этом инструменте?'] },
};
const MODE_ORDER = ['chart', 'indicator', 'strategy', 'fix', 'screenshot', 'brainstorm'];
let curMode = store.get('ql.mode', 'indicator'); if (!MODES[curMode]) curMode = 'indicator';
let brainOffset = 0, phIdx = 0;
S.attach = [];

function setEmpty(empty) { $('chatPanel').classList.toggle('empty', empty); }

// ───────── Panda sidebar: collapse / expand (button, rail click, Ctrl+\) ─────────
function setChatCollapsed(c, { save = true, focus = true } = {}) {
  const p = $('chatPanel'); if (!p || EMBED) return;
  const was = p.classList.contains('collapsed'); if (was === c) return;
  p.classList.toggle('collapsed', c);
  if (save) store.set('ql.chat.collapsed', c);
  setTimeout(() => window.dispatchEvent(new Event('resize')), 260); // after the width transition
  if (!c && focus) setTimeout(() => $('prompt').focus(), 200);
}
if (!EMBED) {
  const p = $('chatPanel');
  p.classList.add('no-anim');
  if (store.get('ql.chat.collapsed', false)) p.classList.add('collapsed');
  requestAnimationFrame(() => requestAnimationFrame(() => p.classList.remove('no-anim')));
  $('chatCollapseBtn').onclick = () => setChatCollapsed(true);
  $('chatRail').onclick = () => setChatCollapsed(false);
  window.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === 'Backslash') { e.preventDefault(); setChatCollapsed(!$('chatPanel').classList.contains('collapsed')); }
  });
}
function addMsg(cls, html) {
  setEmpty(false);
  const d = document.createElement('div'); d.className = 'msg ' + cls; d.innerHTML = html; msgs.appendChild(d);
  $('chatBody').scrollTop = $('chatBody').scrollHeight; return d;
}
function setBusy(b) { S.busy = b; $('sendBtn').disabled = b; $('stopBtn').classList.toggle('hidden', !b); }

// ── modes + suggestion card
function renderMode() {
  const m = MODES[curMode];
  $('modeIcon').innerHTML = PI[curMode]; $('modeName').textContent = m.name;
  $('modeMenu').innerHTML = MODE_ORDER.map(k => `<button data-mode="${k}" class="${k === curMode ? 'on' : ''}"><span class="pi">${PI[k]}</span>${MODES[k].name}</button>`).join('');
  $('modeMenu').querySelectorAll('button').forEach(b => b.onclick = () => { curMode = b.dataset.mode; store.set('ql.mode', curMode); $('modeMenu').classList.add('hidden'); $('suggest').classList.remove('closed'); phIdx = 0; renderMode(); });
  const sg = $('suggest');
  let items = m.items.map(t => ({ text: t }));
  if (m.brain) {
    items = [{ text: 'Посмотри на мой график и предложи индикатор, который поможет мне торговать на нём', snap: true, special: true }]
      .concat([0, 1, 2].map(i => ({ text: BRAIN_POOL[(brainOffset + i) % BRAIN_POOL.length] })));
  }
  sg.innerHTML = `<div class="suggest-head"><span class="pi">${PI[curMode]}</span>${m.name}<div class="spacer"></div><button class="icon-btn" id="sgClose" title="Скрыть">✕</button></div>` +
    items.map((it, i) => `<button class="sugg ${it.special ? 'special' : ''}" data-i="${i}">${it.special ? `<span class="pi">${PI.chart}</span>` : ''}<span>${esc(it.text)}</span></button>`).join('') +
    (m.brain ? `<button class="sugg more" id="sgMore">${PI.refresh} Показать другие идеи</button>` : '');
  sg.querySelectorAll('.sugg[data-i]').forEach(b => b.onclick = () => useSuggestion(items[+b.dataset.i]));
  $('sgClose').onclick = () => sg.classList.add('closed');
  const more = $('sgMore'); if (more) more.onclick = () => { brainOffset = (brainOffset + 3) % BRAIN_POOL.length; renderMode(); };
  updatePlaceholder();
}
function updatePlaceholder() { const ph = MODES[curMode].ph; $('prompt').placeholder = ph[phIdx % ph.length]; }
setInterval(() => { if (!$('prompt').value && document.activeElement !== $('prompt')) { phIdx++; updatePlaceholder(); } }, 6000);

async function useSuggestion(it) {
  const m = MODES[curMode];
  if (m.prefix) { const p = $('prompt'); p.value = it.text + '\n'; p.focus(); p.setSelectionRange(p.value.length, p.value.length); autoGrow(); return; }
  if (m.needImage && !S.attach.some(a => a.kind === 'image')) { S.pendingText = it.text; $('fileImg').click(); return; }
  send(it.text, { snap: !!(it.snap || m.snap) });
}
$('modeMain').onclick = () => $('suggest').classList.toggle('closed');
$('modeCaret').onclick = e => { e.stopPropagation(); $('modeMenu').classList.toggle('hidden'); $('plusMenu').classList.add('hidden'); };
document.addEventListener('click', e => {
  if (!$('modeRow').contains(e.target)) $('modeMenu').classList.add('hidden');
  if (!$('composer').contains(e.target)) $('plusMenu').classList.add('hidden');
});

// ── attachments
function renderAttach() {
  const el = $('attachments');
  el.innerHTML = S.attach.map((a, i) => a.kind === 'image'
    ? `<div class="att"><img src="${a.dataUrl}" alt=""><span>${esc(a.label)}</span><button data-i="${i}" title="Убрать">✕</button></div>`
    : `<div class="att file"><span class="pi">${PI.code}</span><span>${esc(a.name)}</span><button data-i="${i}" title="Убрать">✕</button></div>`).join('');
  el.querySelectorAll('button').forEach(b => b.onclick = () => { S.attach.splice(+b.dataset.i, 1); renderAttach(); });
}
function chartSnapshot() {
  const base = chart.takeScreenshot(true, false);
  const c = document.createElement('canvas'); c.width = base.width; c.height = base.height;
  const g = c.getContext('2d'); g.drawImage(base, 0, 0);
  for (const id of ['overlay', 'drawlayer']) { const el = document.getElementById(id); if (el && el.width) g.drawImage(el, 0, 0); }
  const k = base.width / Math.max(1, $('chart').clientWidth);
  g.fillStyle = 'rgba(19,20,22,.8)'; g.fillRect(0, 0, 460 * k, 26 * k);
  g.fillStyle = '#e6e7ea'; g.font = `${13 * k}px sans-serif`; g.textBaseline = 'middle';
  g.fillText(`${S.symbol} · ${S.interval} · ${S.srcLabel || ''} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`, 8 * k, 13 * k);
  return downscale(c, 1600);
}
function downscale(canvas, maxW) {
  if (canvas.width <= maxW) return canvas.toDataURL('image/jpeg', 0.88);
  const r = maxW / canvas.width, c = document.createElement('canvas'); c.width = maxW; c.height = Math.round(canvas.height * r);
  c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.88);
}
function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => { const img = new Image(); img.onload = () => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0); resolve(downscale(c, 1800)); }; img.onerror = reject; img.src = fr.result; };
    fr.onerror = reject; fr.readAsDataURL(file);
  });
}
async function addImages(files) {
  for (const f of files) { if (!/^image\//.test(f.type)) continue; try { S.attach.push({ kind: 'image', label: f.name || 'скриншот', dataUrl: await readImageFile(f) }); } catch (e) { log('image: ' + e.message); } }
  renderAttach();
  if (S.pendingText && S.attach.some(a => a.kind === 'image')) { const p = $('prompt'); p.value = S.pendingText; S.pendingText = null; p.focus(); autoGrow(); }
}
$('plusBtn').onclick = e => { e.stopPropagation(); $('plusMenu').classList.toggle('hidden'); $('modeMenu').classList.add('hidden'); };
$('plusMenu').querySelectorAll('.pi[data-icon]').forEach(sp => sp.innerHTML = PI[sp.dataset.icon]);
$('plusMenu').querySelectorAll('button').forEach(b => b.onclick = () => {
  $('plusMenu').classList.add('hidden');
  if (b.dataset.act === 'snap') { S.attach.push({ kind: 'image', label: `${S.symbol} ${S.interval}`, dataUrl: chartSnapshot(), chart: true }); renderAttach(); }
  if (b.dataset.act === 'img') $('fileImg').click();
  if (b.dataset.act === 'pine') $('filePine').click();
});
$('fileImg').onchange = e => { addImages([...e.target.files]); e.target.value = ''; };
$('filePine').onchange = e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const fr = new FileReader(); fr.onload = () => { S.attach.push({ kind: 'pine', name: f.name, text: String(fr.result).slice(0, 60000) }); renderAttach(); }; fr.readAsText(f);
};
$('prompt').addEventListener('paste', e => { const files = [...(e.clipboardData?.files || [])].filter(f => /^image\//.test(f.type)); if (files.length) { e.preventDefault(); addImages(files); } });
$('chatPanel').addEventListener('dragover', e => { e.preventDefault(); });
$('chatPanel').addEventListener('drop', e => { e.preventDefault(); const files = [...(e.dataTransfer?.files || [])]; addImages(files.filter(f => /^image\//.test(f.type)));
  const pine = files.find(f => /\.(pine|txt)$/i.test(f.name)); if (pine) { const fr = new FileReader(); fr.onload = () => { S.attach.push({ kind: 'pine', name: pine.name, text: String(fr.result).slice(0, 60000) }); renderAttach(); }; fr.readAsText(pine); } });

// ── composer: autogrow, Tab to accept placeholder, voice input
function autoGrow() { const p = $('prompt'); p.style.height = 'auto'; p.style.height = Math.min(180, p.scrollHeight) + 'px'; $('tabHint').classList.toggle('hidden', !!p.value); }
$('prompt').addEventListener('input', autoGrow);
$('prompt').addEventListener('keydown', e => {
  if (e.key === 'Tab' && !e.target.value) { e.preventDefault(); e.target.value = e.target.placeholder; autoGrow(); return; }
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send($('prompt').value); }
});
(() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = $('micBtn');
  // Desktop app (Electron): Chromium's speech service needs Google keys that Electron doesn't have → use OS dictation instead
  if (/Electron\//.test(navigator.userAgent)) {
    const hint = /Mac/.test(navigator.platform) ? 'дважды нажми Fn (диктовка macOS)' : 'нажми Win+H (голосовой ввод Windows)';
    btn.title = `Голосовой ввод: ${hint}`;
    btn.onclick = () => { const p = $('prompt'); p.focus(); p.placeholder = `Голосовой ввод: ${hint} — текст появится здесь`; log(`Голосовой ввод в приложении: ${hint}`); };
    return;
  }
  if (!SR) { btn.classList.add('hidden'); return; }
  let rec = null, baseText = '';
  btn.onclick = () => {
    if (rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = 'ru-RU'; rec.interimResults = true; rec.continuous = true;
    baseText = $('prompt').value ? $('prompt').value + ' ' : '';
    rec.onresult = ev => { let t = ''; for (let i = 0; i < ev.results.length; i++) t += ev.results[i][0].transcript; $('prompt').value = baseText + t; autoGrow(); };
    rec.onend = () => { rec = null; btn.classList.remove('rec'); };
    rec.onerror = ev => { log('Голосовой ввод: ' + ev.error); };
    rec.start(); btn.classList.add('rec');
  };
})();

async function applyAgentScript(targetRef, name, code, result) {
  let s = S.scripts.find(x => x.id === targetRef.id);
  if (!s) { s = { id: newId(), name, code, inputs: {}, visible: true }; S.scripts.push(s); targetRef.id = s.id; }
  s.name = name || s.name; s.code = code; s.visible = true; s.result = result; s.error = null;
  saveScripts();
  // result computed on another chart (agent switched symbol/TF mid-turn) → recompute on the current one
  if (!result || result.symbol !== S.symbol || result.interval !== S.interval || result.limit !== S.bars.length) await runScript(s);
  renderAll();
  window.QLPanels && window.QLPanels.onScriptChanged(s);
}

async function send(text, opts = {}) {
  text = (text || '').trim();
  if ((!text && !S.attach.length) || S.busy) return;
  if (!text) text = curMode === 'screenshot' ? 'Повтори индикатор со скриншота' : 'Посмотри на вложение';
  const atts = S.attach.slice(); S.attach = []; renderAttach();
  if ((opts.snap || MODES[curMode].snap) && !atts.some(a => a.chart)) { try { atts.unshift({ kind: 'image', label: `${S.symbol} ${S.interval}`, dataUrl: chartSnapshot(), chart: true }); } catch (e) { log('snapshot: ' + e.message); } }
  $('prompt').value = ''; autoGrow();
  const thumbs = atts.map(a => a.kind === 'image' ? `<img class="mthumb" src="${a.dataUrl}" title="${esc(a.label)}">` : `<span class="mfile">${PI.code} ${esc(a.name)}</span>`).join('');
  addMsg('user', (thumbs ? `<div class="matt">${thumbs}</div>` : '') + esc(text));
  let fullText = text;
  for (const a of atts) if (a.kind === 'pine') fullText += `\n\n[Attached file ${a.name}]\n\`\`\`pine\n${a.text}\n\`\`\``;
  const active = S.scripts.find(x => x.id === S.selectedId);
  const target = { id: active ? active.id : null };
  const statusEl = addMsg('status', 'Думаю');
  setBusy(true);
  const ctrl = new AbortController(); S.abort = ctrl;
  let drawings = []; try { drawings = window.QLDraw ? window.QLDraw.list() : []; } catch { /* no drawings module */ }
  try {
    const r = await fetch('/api/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctrl.signal,
      body: JSON.stringify({ sessionId: S.sessionId, text: fullText, mode: curMode, model: $('modelSel').value, symbol: S.symbol, interval: S.interval, limit: S.limit,
        activeScript: active ? { name: active.name, code: active.code } : null,
        images: atts.filter(a => a.kind === 'image').map(a => ({ label: a.chart ? `snapshot of the user's chart ${S.symbol} ${S.interval}` : a.label, dataUrl: a.dataUrl })),
        chartState: { scripts: S.scripts.map(s => ({ name: s.name, visible: s.visible })), drawings: drawings.slice(0, 60) } }),
    });
    const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'status') statusEl.textContent = ev.text.replace(/…$/, '');
        else if (ev.type === 'text') { msgs.insertBefore(Object.assign(document.createElement('div'), { className: 'msg ai', innerHTML: md(ev.text) }), statusEl); }
        else if (ev.type === 'run') {
          const d = document.createElement('details'); d.className = 'run ' + (ev.ok ? 'ok' : 'bad');
          d.innerHTML = `<summary>▶ запуск на графике: <b>${ev.ok ? 'OK' : 'ошибка'}</b></summary><pre>${esc(ev.summary)}</pre>`;
          msgs.insertBefore(d, statusEl); log(ev.summary.split('\n')[0]);
        }
        else if (ev.type === 'preview' || ev.type === 'script') await applyAgentScript(target, ev.name, ev.code, ev.result);
        else if (ev.type === 'chart') await setChart(ev.symbol, ev.interval);
        else if (ev.type === 'draw' && window.QLDraw) { for (const it of ev.items) window.QLDraw.add(it.type, it.pts, it.style); }
        else if (ev.type === 'draw-clear' && window.QLDraw) window.QLDraw.removeAgent();
        else if (ev.type === 'error') msgs.insertBefore(Object.assign(document.createElement('div'), { className: 'msg err', textContent: '⚠ ' + ev.text }), statusEl);
        $('chatBody').scrollTop = $('chatBody').scrollHeight;
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') addMsg('err', '⚠ ' + esc(e.message));
  } finally {
    statusEl.remove(); setBusy(false); S.abort = null;
    if (target.id) selectScript(target.id);
  }
}
$('sendBtn').onclick = () => send($('prompt').value);
$('stopBtn').onclick = () => S.abort && S.abort.abort();
$('newChatBtn').onclick = async () => {
  await api('/api/reset', { sessionId: S.sessionId });
  S.sessionId = 'sess-' + Math.random().toString(36).slice(2); store.set('ql.session', S.sessionId);
  msgs.innerHTML = ''; setEmpty(true); $('suggest').classList.remove('closed');
};
renderMode(); autoGrow();
window.QLChat = {
  prefill(text, mode) { setChatCollapsed(false, { focus: false }); if (mode && MODES[mode]) { curMode = mode; store.set('ql.mode', curMode); renderMode(); } const p = $('prompt'); p.value = text; autoGrow(); p.focus(); p.setSelectionRange(p.value.length, p.value.length); },
};

async function loadSymbols() {
  try {
    const j = await api('/api/symbols');
    S.symbols = j; window.dispatchEvent(new CustomEvent('ql:symbols'));
    if (!j.mt5.ready) log('MT5: ' + (j.mt5.error || 'недоступен') + ' — доступны только крипто-символы Binance');
    else log(`MT5 подключён: ${j.mt5.server}, ${j.mt5.symbols.length} символов, смещение сервера ${j.mt5.offsetHours}ч${j.mt5.offsetKnown ? '' : ' (не определено — рынок закрыт?)'}`);
  } catch (e) { log('symbols: ' + e.message); }
}

// ───────── boot ─────────
setInterval(() => { $('clock').textContent = new Date().toISOString().slice(11, 19) + ' UTC'; }, 1000);
(async () => {
  const cfg = await api('/api/config');
  const names = { sonnet: 'Авто (Sonnet)', opus: 'Opus', haiku: 'Haiku' };
  $('modelSel').innerHTML = cfg.models.map(m => `<option value="${m}" ${m === cfg.defaultModel ? 'selected' : ''}>${names[m] || m}</option>`).join('');
  $('backendBadge').textContent = (cfg.backend === 'api' ? 'AI: API-ключ' : 'AI: подписка Claude (Claude Code)') + (cfg.mock ? ' · MOCK-данные' : '');
  $('barsSel').value = String(S.limit);
  applyScale();
  loadSymbols();
  await loadBars();
  if (!S.scripts.length) {
    S.scripts.push({ id: newId(), name: 'EMA 50', code: '//@version=6\nindicator("EMA 50", overlay=true)\nlen = input.int(50, "Период", minval=1)\nplot(ta.ema(close, len), "EMA", color=color.orange, linewidth=2)\n', inputs: {}, visible: true });
    saveScripts();
  }
  await runAll();
})();
if (!EMBED) window.QLHub = QLHub;
window.QLApp = { setChatCollapsed, replayStart, replayStep, replayStop, barSec, S, CELL, EMBED, MC_ID, mcCfg, QLHub, api, esc, fmt, md, log, chart, candles, newId, saveScripts, runScript, renderAll, selectScript, openInputs, setChart, setChartType, setScale, CHART_TYPES, loadSymbols };
})();
