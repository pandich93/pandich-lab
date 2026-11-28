/* Pandich Lab — drawing tools (TradingView-style) on top of lightweight-charts v5.
   Points are stored in chart space {t: unix seconds (may be in the future), p: price}, so drawings
   survive zoom/scroll/timeframe changes. Saved per symbol in localStorage. */
(() => {
'use strict';
const QL = window.QL;
if (!QL) { console.error('[draw] window.QL missing'); return; }
const { chart, candles } = QL;
const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

// ───────── icons (18×18, stroke = currentColor) ─────────
const I = (body) => `<svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ICON = {
  cursor: I('<path d="M4 2l10 7-4.5 1L12 15l-2 1-2.5-5L4 14z"/>'),
  trend: I('<path d="M3 15L15 3"/><circle cx="3" cy="15" r="1.4"/><circle cx="15" cy="3" r="1.4"/>'),
  ray: I('<path d="M3 15L16 2"/><circle cx="3" cy="15" r="1.4"/><circle cx="9" cy="9" r="1.4"/>'),
  extended: I('<path d="M1 17L17 1"/><circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="6" r="1.4"/>'),
  arrow: I('<path d="M3 15L15 3M15 3H9M15 3v6"/>'),
  hline: I('<path d="M1 9h16"/><circle cx="9" cy="9" r="1.4"/>'),
  hray: I('<path d="M5 9h12"/><circle cx="5" cy="9" r="1.4"/>'),
  vline: I('<path d="M9 1v16"/><circle cx="9" cy="9" r="1.4"/>'),
  cross: I('<path d="M9 1v16M1 9h16"/>'),
  channel: I('<path d="M2 12L12 2M6 16L16 6"/>'),
  fib_retr: I('<path d="M2 3h14M2 7h14M2 10.5h14M2 15h14"/>'),
  fib_ext: I('<path d="M2 15l4-8 4 5M9 4h7M9 8h7M9 12h7"/>'),
  fib_channel: I('<path d="M2 10L10 2M4 13l8-8M6 16l10-10"/>'),
  fib_time: I('<path d="M3 2v14M5 2v14M8 2v14M13 2v14"/>'),
  fib_fan: I('<path d="M2 16L16 2M2 16L16 7M2 16l14-3"/>'),
  fib_circles: I('<circle cx="9" cy="9" r="2.5"/><circle cx="9" cy="9" r="5"/><circle cx="9" cy="9" r="7.5"/>'),
  gann_box: I('<rect x="2" y="2" width="14" height="14"/><path d="M2 9h14M9 2v14M2 5.5h14M5.5 2v14"/>'),
  gann_fan: I('<path d="M2 16L16 2M2 16L9 2M2 16L16 9M2 16l14 4"/>'),
  xabcd: I('<path d="M1 14l4-10 3 6 4-8 5 12"/>'),
  abcd: I('<path d="M2 14l5-10 4 6 5-8"/>'),
  elliott_imp: I('<path d="M1 15l3-6 2 3 4-9 2 4 5-5"/>'),
  elliott_corr: I('<path d="M2 3l5 10 4-5 5 8"/>'),
  hs: I('<path d="M1 14l3-6 3 3 2-8 2 8 3-3 3 6M1 11h16"/>'),
  rect: I('<rect x="2.5" y="4" width="13" height="10" rx="1"/>'),
  ellipse: I('<ellipse cx="9" cy="9" rx="7" ry="5"/>'),
  triangle: I('<path d="M9 2l7 13H2z"/>'),
  brush: I('<path d="M2 15c3 0 3-3 5-3s2 2 4 1 2-6 5-9"/>'),
  text: I('<path d="M4 4h10M9 4v11M7 15h4"/>'),
  callout: I('<path d="M3 3h12v8H8l-3 4v-4H3z"/>'),
  price_label: I('<path d="M2 9l4-4h10v8H6z"/><path d="M8 9h5"/>'),
  flag: I('<path d="M4 16V2M4 3h10l-3 3 3 3H4"/>'),
  long: I('<rect x="3" y="2" width="12" height="7" fill="rgba(8,153,129,.35)"/><rect x="3" y="9" width="12" height="6" fill="rgba(242,54,69,.35)"/>'),
  short: I('<rect x="3" y="2" width="12" height="6" fill="rgba(242,54,69,.35)"/><rect x="3" y="8" width="12" height="7" fill="rgba(8,153,129,.35)"/>'),
  price_range: I('<path d="M9 2v14M6 5l3-3 3 3M6 13l3 3 3-3M3 2h12M3 16h12"/>'),
  date_range: I('<path d="M2 9h14M5 6L2 9l3 3M13 6l3 3-3 3M2 3v12M16 3v12"/>'),
  dp_range: I('<rect x="2" y="3" width="14" height="12"/><path d="M9 5v8M5 9h8"/>'),
  magnet: I('<path d="M4 3v6a5 5 0 0010 0V3h-3v6a2 2 0 01-4 0V3z"/>'),
  lock: I('<rect x="4" y="8" width="10" height="8" rx="1"/><path d="M6 8V5.5a3 3 0 016 0V8"/>'),
  eye: I('<path d="M1 9s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z"/><circle cx="9" cy="9" r="2.2"/>'),
  trash: I('<path d="M3 5h12M7 5V3h4v2M5 5l1 11h6l1-11"/>'),
  undo: I('<path d="M6 4L2 8l4 4M2 8h9a5 5 0 010 10"/>'),
  clone: I('<rect x="6" y="6" width="9" height="9" rx="1"/><path d="M12 6V3H3v9h3"/>'),
  gear: I('<circle cx="9" cy="9" r="2.3"/><path d="M9 1.8v2M9 14.2v2M16.2 9h-2M3.8 9h-2M14.1 3.9l-1.4 1.4M5.3 12.7l-1.4 1.4M14.1 14.1l-1.4-1.4M5.3 5.3L3.9 3.9"/>'),
};

// ───────── tool catalogue ─────────
const GROUPS = [
  { id: 'lines', name: 'Линии', icon: 'trend' },
  { id: 'fib', name: 'Фибоначчи', icon: 'fib_retr' },
  { id: 'gann', name: 'Ганн', icon: 'gann_box' },
  { id: 'patterns', name: 'Паттерны', icon: 'xabcd' },
  { id: 'shapes', name: 'Фигуры', icon: 'rect' },
  { id: 'brush', name: 'Кисть', icon: 'brush' },
  { id: 'text', name: 'Аннотации', icon: 'text' },
  { id: 'measure', name: 'Прогноз и измерения', icon: 'long' },
];
const TOOLS = [
  ['trend', 'Линия тренда', 'lines', 2], ['ray', 'Луч', 'lines', 2], ['extended', 'Продолженная линия', 'lines', 2], ['arrow', 'Стрелка', 'lines', 2],
  ['hline', 'Горизонтальная линия', 'lines', 1], ['hray', 'Горизонтальный луч', 'lines', 1], ['vline', 'Вертикальная линия', 'lines', 1],
  ['cross', 'Перекрестие', 'lines', 1], ['channel', 'Параллельный канал', 'lines', 3],
  ['fib_retr', 'Коррекция Фибоначчи', 'fib', 2], ['fib_ext', 'Расширение Фибоначчи по тренду', 'fib', 3], ['fib_channel', 'Канал Фибоначчи', 'fib', 3],
  ['fib_time', 'Временные зоны Фибоначчи', 'fib', 2], ['fib_fan', 'Веер Фибоначчи', 'fib', 2], ['fib_circles', 'Окружности Фибоначчи', 'fib', 2],
  ['gann_box', 'Коробка Ганна', 'gann', 2], ['gann_fan', 'Веер Ганна', 'gann', 2],
  ['xabcd', 'Паттерн XABCD', 'patterns', 5], ['abcd', 'Паттерн ABCD', 'patterns', 4], ['elliott_imp', 'Импульсная волна Эллиотта', 'patterns', 6],
  ['elliott_corr', 'Коррекционная волна Эллиотта', 'patterns', 4], ['hs', 'Голова и плечи', 'patterns', 7],
  ['rect', 'Прямоугольник', 'shapes', 2], ['ellipse', 'Эллипс', 'shapes', 2], ['triangle', 'Треугольник', 'shapes', 3],
  ['brush', 'Кисть', 'brush', 0],
  ['text', 'Текст', 'text', 1], ['callout', 'Выноска', 'text', 2], ['price_label', 'Ценовая метка', 'text', 1], ['flag', 'Флажок', 'text', 1],
  ['long', 'Длинная позиция', 'measure', 2], ['short', 'Короткая позиция', 'measure', 2],
  ['price_range', 'Диапазон цен', 'measure', 2], ['date_range', 'Диапазон дат', 'measure', 2], ['dp_range', 'Диапазон дат и цен', 'measure', 2],
].map(([id, name, group, n]) => ({ id, name, group, n }));
const TOOL = Object.fromEntries(TOOLS.map(t => [t.id, t]));
const FILLABLE = new Set(['rect', 'ellipse', 'triangle', 'channel', 'fib_retr', 'fib_ext', 'gann_box', 'xabcd']);
const TEXTUAL = new Set(['text', 'callout', 'flag', 'trend', 'hline', 'rect']);
const DEFAULT_COLOR = { long: '#089981', short: '#F23645', price_range: '#2962FF', date_range: '#2962FF', dp_range: '#2962FF', text: '#E0E3EB', flag: '#F23645', callout: '#2962FF', price_label: '#2962FF' };

const FIB_RETR = [[0, '#787B86'], [0.236, '#F23645'], [0.382, '#FF9800'], [0.5, '#4CAF50'], [0.618, '#089981'], [0.786, '#00BCD4'], [1, '#787B86'], [1.618, '#2962FF'], [2.618, '#F23645'], [3.618, '#9C27B0'], [4.236, '#E91E63']];
const FIB_EXT = [[0, '#787B86'], [0.236, '#F23645'], [0.382, '#FF9800'], [0.5, '#4CAF50'], [0.618, '#089981'], [0.786, '#00BCD4'], [1, '#787B86'], [1.618, '#2962FF'], [2.618, '#F23645']];
const FIB_SEQ = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233];
// Fibonacci levels are editable per drawing: style.levels = [{ v, c, on }]; without it the tool defaults below are used
const lv = (arr, on = true) => arr.map(([v, c]) => ({ v, c, on }));
const FIB_DEFAULTS = {
  fib_retr: [...lv(FIB_RETR), ...lv([[1.272, '#FF9800'], [1.414, '#4CAF50'], [2, '#089981'], [3, '#00BCD4']], false)].sort((a, b) => a.v - b.v),
  fib_ext: [...lv(FIB_EXT), ...lv([[1.272, '#FF9800'], [1.414, '#4CAF50'], [2, '#089981'], [3.618, '#9C27B0'], [4.236, '#E91E63']], false)].sort((a, b) => a.v - b.v),
  fib_channel: lv(FIB_RETR.slice(0, 8)),
  fib_fan: lv(FIB_RETR.slice(0, 7)),
  fib_circles: lv([[0.236, '#F23645'], [0.382, '#FF9800'], [0.5, '#4CAF50'], [0.618, '#089981'], [0.786, '#00BCD4'], [1, '#787B86'], [1.618, '#2962FF']]),
  fib_time: FIB_SEQ.map((v, i) => ({ v, c: FIB_RETR[i % FIB_RETR.length][1], on: true })),
};
const LEVELED = new Set(Object.keys(FIB_DEFAULTS));
const defLevels = type => (FIB_DEFAULTS[type] || []).map(l => ({ ...l }));
function levelsOf(d) {
  const L = Array.isArray(d.style.levels) && d.style.levels.length ? d.style.levels : (FIB_DEFAULTS[d.type] || []);
  return L.filter(l => l.on !== false && l.v !== '' && l.v !== null && Number.isFinite(+l.v)).map(l => [+l.v, l.c || d.style.color]).sort((a, b) => a[0] - b[0]);
}
const GANN_LV = [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1];
const GANN_FAN = [[8, '8×1'], [4, '4×1'], [3, '3×1'], [2, '2×1'], [1, '1×1'], [1 / 2, '1×2'], [1 / 3, '1×3'], [1 / 4, '1×4'], [1 / 8, '1×8']];

// ───────── state ─────────
const D = {
  key: null, items: [], selected: null, hover: null,
  tool: null, mode: 'idle', creating: null, drag: null, downXY: null,
  magnet: store.get('ql.draw.magnet', false), lockAll: false, hideAll: false,
  undo: [], redo: [], lastInGroup: store.get('ql.draw.lastInGroup', {}),
};
let uid = Date.now();
const nid = () => 'd' + (uid++).toString(36);

// ───────── coordinates ─────────
const bars = () => QL.getBars();
function step() {
  const b = bars(); const n = b.length; if (n < 2) return 60;
  const diffs = []; for (let i = Math.max(1, n - 30); i < n; i++) diffs.push(b[i].time - b[i - 1].time);
  diffs.sort((a, c) => a - c); return diffs[diffs.length >> 1] || 60;
}
function t2l(t) {
  const b = bars(); const n = b.length; if (!n) return null;
  if (t <= b[0].time) return (t - b[0].time) / step();
  if (t >= b[n - 1].time) return n - 1 + (t - b[n - 1].time) / step();
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (b[m].time <= t) lo = m; else hi = m; }
  return lo + (t - b[lo].time) / (b[hi].time - b[lo].time);
}
function l2t(l) {
  const b = bars(); const n = b.length; if (!n) return 0;
  if (l <= 0) return Math.round(b[0].time + l * step());
  if (l >= n - 1) return Math.round(b[n - 1].time + (l - (n - 1)) * step());
  const i = Math.floor(l); return Math.round(b[i].time + (l - i) * (b[i + 1].time - b[i].time));
}
const ts = () => chart.timeScale();
function X(t) { const l = t2l(t); return l === null ? null : ts().logicalToCoordinate(l); }
function Y(p) { return candles.priceToCoordinate(p); }
function toPx(pt) { const x = X(pt.t), y = Y(pt.p); return (x === null || y === null) ? null : { x, y }; }
function fromPx(x, y, snapTime = true, magnet = D.magnet) {
  let l = ts().coordinateToLogical(x); if (l === null) return null;
  if (snapTime) l = Math.round(l);
  let p = candles.coordinateToPrice(y); if (p === null) return null;
  if (magnet) {
    const b = bars()[Math.round(l)];
    if (b) { let best = p, bd = Infinity; for (const v of [b.open, b.high, b.low, b.close]) { const yy = Y(v); if (yy !== null && Math.abs(yy - y) < bd) { bd = Math.abs(yy - y); best = v; } } p = best; }
  }
  return { t: l2t(l), p };
}
const fmtP = p => { try { return candles.priceFormatter().format(p); } catch { return (+p).toFixed(2); } };
function fmtDur(sec) {
  sec = Math.abs(sec); const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
  return [d ? d + 'д' : '', h ? h + 'ч' : '', (m && !d) ? m + 'м' : ''].filter(Boolean).join(' ') || '0м';
}
function alpha(c, a) {
  if (!c) return `rgba(41,98,255,${a})`;
  if (c[0] === '#' && (c.length === 7 || c.length === 9)) { const r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16); return `rgba(${r},${g},${b},${a})`; }
  return c;
}

// ───────── recorder: draws to canvas and/or records hit geometry ─────────
class G {
  constructor(ctx, w, h) { this.c = ctx; this.w = w; this.h = h; this.segs = []; this.areas = []; }
  stroke(color, width, dash) { if (!this.c) return; this.c.strokeStyle = color; this.c.lineWidth = width; this.c.setLineDash(dash === 'dashed' ? [6, 4] : dash === 'dotted' ? [1.5, 3] : []); }
  line(x1, y1, x2, y2, color, width = 1, dash) {
    this.segs.push([x1, y1, x2, y2]);
    if (!this.c) return; this.stroke(color, width, dash); this.c.beginPath(); this.c.moveTo(x1, y1); this.c.lineTo(x2, y2); this.c.stroke(); this.c.setLineDash([]);
  }
  ext(x1, y1, x2, y2, left, right) { // extend segment to canvas edges
    if (x1 === x2) return [x1, left ? (y2 < y1 ? this.h : 0) : y1, x2, right ? (y2 < y1 ? 0 : this.h) : y2];
    const k = (y2 - y1) / (x2 - x1); let a = [x1, y1], b = [x2, y2];
    const dirR = x2 > x1;
    if (right) { const ex = dirR ? this.w : 0; b = [ex, y1 + k * (ex - x1)]; }
    if (left) { const ex = dirR ? 0 : this.w; a = [ex, y1 + k * (ex - x1)]; }
    return [a[0], a[1], b[0], b[1]];
  }
  poly(pts, fill, color, width = 1, dash, close = true) {
    for (let i = 1; i < pts.length; i++) this.segs.push([pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y]);
    if (close && pts.length > 2) this.segs.push([pts[pts.length - 1].x, pts[pts.length - 1].y, pts[0].x, pts[0].y]);
    if (fill) this.areas.push({ poly: pts });
    if (!this.c) return;
    this.c.beginPath(); pts.forEach((q, i) => i ? this.c.lineTo(q.x, q.y) : this.c.moveTo(q.x, q.y)); if (close) this.c.closePath();
    if (fill) { this.c.fillStyle = fill; this.c.fill(); }
    if (color) { this.stroke(color, width, dash); this.c.stroke(); this.c.setLineDash([]); }
  }
  rect(x1, y1, x2, y2, fill, color, width = 1, dash) {
    this.poly([{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }], fill, color, width, dash);
  }
  ellipse(cx, cy, rx, ry, fill, color, width = 1, dash) {
    rx = Math.abs(rx); ry = Math.abs(ry);
    this.areas.push({ ell: [cx, cy, rx, ry, !!fill] });
    if (!this.c) return; this.c.beginPath(); this.c.ellipse(cx, cy, Math.max(rx, 0.1), Math.max(ry, 0.1), 0, 0, Math.PI * 2);
    if (fill) { this.c.fillStyle = fill; this.c.fill(); }
    if (color) { this.stroke(color, width, dash); this.c.stroke(); this.c.setLineDash([]); }
  }
  label(text, x, y, o = {}) { // o: color(bg), tc, align: 'center'|'left'|'right', base: 'middle'|'top'|'bottom', font, pad
    const font = o.font || '11px sans-serif';
    const lines = String(text).split('\n');
    let w = 0; if (this.c) { this.c.font = font; w = Math.max(...lines.map(s => this.c.measureText(s).width)); } else w = Math.max(...lines.map(s => s.length)) * 6.2;
    const lh = parseInt(font, 10) + 3, pad = o.pad ?? 4, bw = w + pad * 2, bh = lines.length * lh + pad * 2 - 3;
    let bx = o.align === 'left' ? x : o.align === 'right' ? x - bw : x - bw / 2;
    let by = o.base === 'top' ? y : o.base === 'bottom' ? y - bh : y - bh / 2;
    this.areas.push({ box: [bx, by, bx + bw, by + bh] });
    if (!this.c) return { bx, by, bw, bh };
    if (o.color) { this.c.fillStyle = o.color; this.c.beginPath(); this.c.roundRect ? this.c.roundRect(bx, by, bw, bh, 3) : this.c.rect(bx, by, bw, bh); this.c.fill(); }
    this.c.fillStyle = o.tc || '#fff'; this.c.textAlign = 'left'; this.c.textBaseline = 'top';
    lines.forEach((s, i) => this.c.fillText(s, bx + pad, by + pad + i * lh));
    return { bx, by, bw, bh };
  }
}

// ───────── renderers ─────────
function levelText(k, s) { return s.showLevels === false ? '' : s.pct ? `${+(k * 100).toFixed(2)}%` : String(k); }
function levelLabel(k, p, s = {}) { const a = levelText(k, s), b = s.showPrices === false ? '' : fmtP(p); return a && b ? `${a} (${b})` : a || b; }

function render(d, P, g, selected) {
  const s = d.style, col = s.color, lw = s.width, dash = s.dash, W = g.w, H = g.h;
  const fillA = (a) => s.fill === false ? null : alpha(col, a);
  const type = d.type;
  const txt = s.text;
  switch (type) {
    case 'trend': case 'ray': case 'extended': case 'arrow': {
      if (P.length < 2) break;
      const [a, b] = P;
      const seg = type === 'trend' || type === 'arrow' ? [a.x, a.y, b.x, b.y] : g.ext(a.x, a.y, b.x, b.y, type === 'extended', true);
      g.line(...seg, col, lw, dash);
      if (type === 'arrow') { const ang = Math.atan2(b.y - a.y, b.x - a.x), L = 10 + lw * 2; g.poly([{ x: b.x, y: b.y }, { x: b.x - L * Math.cos(ang - 0.4), y: b.y - L * Math.sin(ang - 0.4) }, { x: b.x - L * Math.cos(ang + 0.4), y: b.y - L * Math.sin(ang + 0.4) }], col, col, 1); }
      if (txt) g.label(txt, (a.x + b.x) / 2, (a.y + b.y) / 2 - 8, { tc: col, base: 'bottom' });
      break;
    }
    case 'hline': { const y = P[0].y; g.line(0, y, W, y, col, lw, dash); g.label(fmtP(d.pts[0].p), W - 2, y, { color: col, align: 'right' }); if (txt) g.label(txt, 6, y - 3, { tc: col, align: 'left', base: 'bottom', pad: 2 }); break; }
    case 'hray': { const { x, y } = P[0]; g.line(x, y, W, y, col, lw, dash); g.label(fmtP(d.pts[0].p), W - 2, y, { color: col, align: 'right' }); break; }
    case 'vline': { const x = P[0].x; g.line(x, 0, x, H, col, lw, dash); break; }
    case 'cross': { const { x, y } = P[0]; g.line(x, 0, x, H, col, lw, dash); g.line(0, y, W, y, col, lw, dash); break; }
    case 'channel': {
      if (P.length < 2) break;
      const [a, b] = P; g.line(a.x, a.y, b.x, b.y, col, lw, dash);
      if (P.length < 3) break;
      const c = P[2]; const ly = a.x === b.x ? a.y : a.y + (b.y - a.y) * (c.x - a.x) / (b.x - a.x); const dy = c.y - ly;
      g.line(a.x, a.y + dy, b.x, b.y + dy, col, lw, dash);
      g.line(a.x, a.y + dy / 2, b.x, b.y + dy / 2, col, 1, 'dashed');
      if (fillA(0.12)) g.poly([{ x: a.x, y: a.y }, { x: b.x, y: b.y }, { x: b.x, y: b.y + dy }, { x: a.x, y: a.y + dy }], fillA(0.12), null);
      break;
    }
    case 'fib_retr': {
      if (P.length < 2) break;
      const [a, b] = P; let p1 = d.pts[0].p, p2 = d.pts[1].p; if (s.reverse) [p1, p2] = [p2, p1];
      const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), xl = s.extendLeft ? 0 : x0, xr = s.extend ? W : x1;
      const right = s.labelPos === 'right', fa = s.fillAlpha ?? 0.08;
      const lx = right ? (s.extend ? W - 4 : x1 + 4) : (s.extendLeft ? 4 : x0 - 4), la = right ? (s.extend ? 'right' : 'left') : (s.extendLeft ? 'left' : 'right');
      g.line(a.x, a.y, b.x, b.y, '#787B86', 1, 'dashed');
      let prevY = null;
      for (const [k, c] of levelsOf(d)) {
        const p = p2 + (p1 - p2) * k, y = Y(p); if (y === null) continue;
        if (prevY !== null && s.fill !== false && fa > 0) g.rect(xl, prevY, xr, y, alpha(c, fa), null);
        g.line(xl, y, xr, y, c, lw, dash);
        const t = levelLabel(k, p, s); if (t) g.label(t, lx, y, { tc: c, align: la, pad: 1 });
        prevY = y;
      }
      break;
    }
    case 'fib_ext': {
      if (P.length < 2) break;
      g.line(P[0].x, P[0].y, P[1].x, P[1].y, '#787B86', 1, 'dashed');
      if (P.length < 3) break;
      g.line(P[1].x, P[1].y, P[2].x, P[2].y, '#787B86', 1, 'dashed');
      const A = d.pts[0].p, B = d.pts[1].p, C = d.pts[2].p, dir = s.reverse ? -1 : 1;
      const x0 = P[2].x, x1 = P[2].x + Math.max(40, Math.abs(P[1].x - P[0].x)), xl = s.extendLeft ? 0 : x0, xr = s.extend ? W : x1;
      const right = s.labelPos !== 'left', fa = s.fillAlpha ?? 0.08;
      const lx = right ? (s.extend ? W - 4 : xr + 4) : (s.extendLeft ? 4 : xl - 4), la = right ? (s.extend ? 'right' : 'left') : (s.extendLeft ? 'left' : 'right');
      let prevY = null;
      for (const [k, c] of levelsOf(d)) {
        const p = C + (B - A) * k * dir, y = Y(p); if (y === null) continue;
        if (prevY !== null && s.fill !== false && fa > 0) g.rect(xl, prevY, xr, y, alpha(c, fa), null);
        g.line(xl, y, xr, y, c, lw, dash);
        const t = levelLabel(k, p, s); if (t) g.label(t, lx, y, { tc: c, align: la, pad: 1 });
        prevY = y;
      }
      break;
    }
    case 'fib_channel': {
      if (P.length < 2) break;
      const [a, b] = P; g.line(a.x, a.y, b.x, b.y, '#787B86', lw, dash);
      if (P.length < 3) break;
      const c = P[2]; const ly = a.x === b.x ? a.y : a.y + (b.y - a.y) * (c.x - a.x) / (b.x - a.x); const dy = c.y - ly;
      for (const [k, col2] of levelsOf(d)) { const seg = g.ext(a.x, a.y + dy * k, b.x, b.y + dy * k, false, true); g.line(...seg, col2, lw, dash); const t = levelText(k, s); if (t) g.label(t, a.x - 4, a.y + dy * k, { tc: col2, align: 'right', pad: 1 }); }
      break;
    }
    case 'fib_time': {
      if (P.length < 2) break;
      const [a, b] = P, dx = b.x - a.x;
      g.line(a.x, a.y, b.x, b.y, '#787B86', 1, 'dashed');
      if (Math.abs(dx) < 1) break;
      for (const [f, c] of levelsOf(d)) { const x = a.x + f * dx; if (x < -5 || x > W + 5) continue; g.line(x, 0, x, H, c, lw, dash); if (s.showLevels !== false) g.label(String(f), x + 3, H - 4, { tc: c, align: 'left', base: 'bottom', pad: 1 }); }
      break;
    }
    case 'fib_fan': {
      if (P.length < 2) break;
      const [a, b] = P;
      for (const [k, c] of levelsOf(d)) { const ty = b.y + (a.y - b.y) * k; const seg = g.ext(a.x, a.y, b.x, ty, false, true); g.line(...seg, c, lw, dash); const t = levelText(k, s); if (t) g.label(t, b.x + 4, ty, { tc: c, align: 'left', pad: 1 }); }
      break;
    }
    case 'fib_circles': {
      if (P.length < 2) break;
      const [a, b] = P, R = Math.hypot(b.x - a.x, b.y - a.y); g.line(a.x, a.y, b.x, b.y, '#787B86', 1, 'dashed');
      for (const [k, c] of levelsOf(d)) {
        g.ellipse(a.x, a.y, R * k, R * k, null, c, lw, dash);
        for (let i = 0; i < 48; i++) { const t1 = i / 48 * Math.PI * 2, t2 = (i + 1) / 48 * Math.PI * 2; g.segs.push([a.x + R * k * Math.cos(t1), a.y + R * k * Math.sin(t1), a.x + R * k * Math.cos(t2), a.y + R * k * Math.sin(t2)]); }
        const t = levelText(k, s); if (t && R * k > 6) g.label(t, a.x + R * k + 3, a.y, { tc: c, align: 'left', pad: 1 });
      }
      break;
    }
    case 'gann_box': {
      if (P.length < 2) break;
      const [a, b] = P;
      if (s.fill !== false) g.rect(a.x, a.y, b.x, b.y, alpha(col, 0.06), null);
      for (const k of GANN_LV) {
        const x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k;
        g.line(x, a.y, x, b.y, col, 1, k === 0 || k === 1 ? 'solid' : 'dotted'); g.line(a.x, y, b.x, y, col, 1, k === 0 || k === 1 ? 'solid' : 'dotted');
        g.label(String(k), x, Math.min(a.y, b.y) - 3, { tc: col, base: 'bottom', pad: 1 }); g.label(String(k), Math.min(a.x, b.x) - 3, y, { tc: col, align: 'right', pad: 1 });
      }
      g.line(a.x, a.y, b.x, b.y, col, lw, 'dashed'); g.line(a.x, b.y, b.x, a.y, col, lw, 'dashed');
      break;
    }
    case 'gann_fan': {
      if (P.length < 2) break;
      const [a, b] = P, dx = b.x - a.x, dy = b.y - a.y;
      GANN_FAN.forEach(([m, name], i) => { const seg = g.ext(a.x, a.y, a.x + dx, a.y + dy * m, false, true); const c = FIB_RETR[(i + 1) % FIB_RETR.length][1]; g.line(...seg, m === 1 ? col : c, m === 1 ? lw + 0.5 : lw, dash); g.label(name, a.x + dx, a.y + dy * m, { tc: c, align: 'left', pad: 1 }); });
      break;
    }
    case 'xabcd': case 'abcd': case 'elliott_imp': case 'elliott_corr': case 'hs': {
      const names = { xabcd: ['X', 'A', 'B', 'C', 'D'], abcd: ['A', 'B', 'C', 'D'], elliott_imp: ['0', '1', '2', '3', '4', '5'], elliott_corr: ['0', 'A', 'B', 'C'], hs: ['', 'ЛП', '', 'Г', '', 'ПП', ''] }[type];
      if (type === 'xabcd' && P.length >= 3 && s.fill !== false) { g.poly(P.slice(0, 3), alpha(col, 0.15), null); if (P.length >= 5) g.poly(P.slice(2, 5), alpha(col, 0.15), null); }
      g.poly(P, null, col, lw, dash, false);
      P.forEach((q, i) => {
        if (!names[i]) return;
        const up = (i > 0 && P[i - 1].y > q.y) || (i < P.length - 1 && P[i + 1].y > q.y);
        g.label(type.startsWith('elliott') ? `(${names[i]})` : names[i], q.x, q.y + (up ? -8 : 8), { color: alpha(col, 0.9), base: up ? 'bottom' : 'top' });
      });
      const pr = i => d.pts[i].p;
      const ratio = (num, den) => den ? Math.abs(num / den).toFixed(3) : '—';
      const mid = (i, j, r) => { g.line(P[i].x, P[i].y, P[j].x, P[j].y, alpha(col, 0.7), 1, 'dashed'); g.label(r, (P[i].x + P[j].x) / 2, (P[i].y + P[j].y) / 2, { color: '#1e1f23', tc: col, pad: 2 }); };
      if (type === 'xabcd') {
        if (P.length >= 3) mid(0, 2, ratio(pr(2) - pr(1), pr(1) - pr(0)));
        if (P.length >= 4) mid(1, 3, ratio(pr(3) - pr(2), pr(2) - pr(1)));
        if (P.length >= 5) { mid(2, 4, ratio(pr(4) - pr(3), pr(3) - pr(2))); mid(0, 4, ratio(pr(4) - pr(1), pr(1) - pr(0))); }
      }
      if (type === 'abcd') { if (P.length >= 3) mid(0, 2, ratio(pr(2) - pr(1), pr(1) - pr(0))); if (P.length >= 4) mid(1, 3, ratio(pr(3) - pr(2), pr(2) - pr(1))); }
      if (type === 'hs' && P.length >= 5) { const seg = g.ext(P[2].x, P[2].y, P[4].x, P[4].y, true, true); g.line(...seg, col, 1, 'dashed'); }
      break;
    }
    case 'rect': {
      if (P.length < 2) break; const [a, b] = P;
      g.rect(a.x, a.y, s.extend ? W : b.x, b.y, fillA(0.15), col, lw, dash);
      if (txt) g.label(txt, (a.x + b.x) / 2, Math.min(a.y, b.y) + 4, { tc: col, base: 'top' });
      break;
    }
    case 'ellipse': { if (P.length < 2) break; const [a, b] = P; g.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, (b.x - a.x) / 2, (b.y - a.y) / 2, fillA(0.15), col, lw, dash);
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
      for (let i = 0; i < 48; i++) { const t1 = i / 48 * Math.PI * 2, t2 = (i + 1) / 48 * Math.PI * 2; g.segs.push([cx + rx * Math.cos(t1), cy + ry * Math.sin(t1), cx + rx * Math.cos(t2), cy + ry * Math.sin(t2)]); }
      break; }
    case 'triangle': g.poly(P, P.length > 2 ? fillA(0.15) : null, col, lw, dash, P.length > 2); break;
    case 'brush': g.poly(P, null, col, lw, dash, false); break;
    case 'text': g.label(txt || 'Текст', P[0].x, P[0].y, { tc: col, align: 'left', base: 'middle', font: `${s.fontSize || 14}px sans-serif` }); break;
    case 'callout': {
      if (P.length < 2) break; const [a, b] = P;
      const box = g.label(txt || 'Выноска', b.x, b.y, { color: col, tc: '#fff', font: `${s.fontSize || 13}px sans-serif`, pad: 6 });
      g.line(a.x, a.y, Math.max(box.bx, Math.min(a.x, box.bx + box.bw)), Math.max(box.by, Math.min(a.y, box.by + box.bh)), col, lw);
      break;
    }
    case 'price_label': { const { x, y } = P[0]; const bx = g.label(fmtP(d.pts[0].p), x + 8, y - 10, { color: col, tc: '#fff', align: 'left', base: 'bottom' }); g.line(x, y, bx.bx, bx.by + bx.bh, col, 1); break; }
    case 'flag': { const { x, y } = P[0]; g.poly([{ x, y: y - 22 }, { x: x + 14, y: y - 17 }, { x, y: y - 12 }], col, col, 1); g.line(x, y, x, y - 22, col, 2); if (txt) g.label(txt, x + 16, y - 17, { tc: col, align: 'left' }); break; }
    case 'long': case 'short': {
      if (P.length < 2) break;
      const E = d.pts[0].p, T = d.pts[1].p, S = d.pts[2] ? d.pts[2].p : E - (T - E);
      const x0 = P[0].x, x1 = P[1].x, ye = P[0].y, yt = Y(T), ys = Y(S); if (yt === null || ys === null) break;
      g.rect(x0, ye, x1, yt, 'rgba(8,153,129,0.22)', null); g.rect(x0, ye, x1, ys, 'rgba(242,54,69,0.22)', null);
      g.line(x0, ye, x1, ye, '#9598A1', 1);
      const pct = v => ((v - E) / E * 100).toFixed(2);
      const rr = Math.abs(S - E) > 0 ? (Math.abs(T - E) / Math.abs(S - E)).toFixed(2) : '∞';
      const xm = (x0 + x1) / 2;
      g.label(`Цель: ${fmtP(T)} (${pct(T) > 0 ? '+' : ''}${pct(T)}%)  Δ ${fmtP(Math.abs(T - E))}`, xm, yt, { color: '#089981', base: yt < ye ? 'bottom' : 'top' });
      g.label(`Стоп: ${fmtP(S)} (${pct(S) > 0 ? '+' : ''}${pct(S)}%)  Δ ${fmtP(Math.abs(S - E))}`, xm, ys, { color: '#F23645', base: ys > ye ? 'top' : 'bottom' });
      g.label(`${type === 'long' ? 'Long' : 'Short'} · R:R ${rr}`, xm, ye, { color: '#363A45' });
      break;
    }
    case 'price_range': case 'date_range': case 'dp_range': {
      if (P.length < 2) break; const [a, b] = P;
      const up = d.pts[1].p >= d.pts[0].p;
      const c = type === 'date_range' ? col : (up ? '#2962FF' : '#F23645');
      g.rect(a.x, a.y, b.x, b.y, alpha(c, 0.15), null);
      const xm = (a.x + b.x) / 2, ym = (a.y + b.y) / 2;
      if (type !== 'date_range') g.line(xm, a.y, xm, b.y, c, 1);
      if (type !== 'price_range') g.line(a.x, ym, b.x, ym, c, 1);
      const dp = d.pts[1].p - d.pts[0].p, pc = d.pts[0].p ? dp / d.pts[0].p * 100 : 0;
      const nb = Math.round((t2l(d.pts[1].t) ?? 0) - (t2l(d.pts[0].t) ?? 0)), dt = d.pts[1].t - d.pts[0].t;
      const parts = [];
      if (type !== 'date_range') parts.push(`${dp >= 0 ? '+' : ''}${fmtP(dp)} (${pc >= 0 ? '+' : ''}${pc.toFixed(2)}%)`);
      if (type !== 'price_range') parts.push(`${nb} бар., ${fmtDur(dt)}`);
      g.label(parts.join('\n'), xm, up ? Math.min(a.y, b.y) - 6 : Math.max(a.y, b.y) + 6, { color: c, base: up ? 'bottom' : 'top' });
      break;
    }
  }
  // anchors
  if (selected && g.c) {
    for (const q of P) { g.c.beginPath(); g.c.arc(q.x, q.y, 4.5, 0, Math.PI * 2); g.c.fillStyle = '#131416'; g.c.fill(); g.c.lineWidth = 1.5; g.c.strokeStyle = col; g.c.stroke(); }
  }
}

function anchorPts(d) {
  if (d.type === 'brush') return []; // brush moves as a whole
  return d.pts;
}

// ───────── canvas + draw loop ─────────
const wrap = $('chartWrap'), chartEl = $('chart');
const cv = document.createElement('canvas'); cv.id = 'drawlayer'; wrap.appendChild(cv);
const ctx = cv.getContext('2d');
let pending = false;
const requestDraw = () => { if (!pending) { pending = true; requestAnimationFrame(draw); } };
function paneSize() { return { w: ts().width(), h: chart.paneSize(0).height }; }
function draw() {
  pending = false;
  const { w, h } = paneSize(); const dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px'; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  if (D.hideAll || !bars().length) return;
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
  for (const d of D.items.concat(D.creating ? [D.creating] : [])) {
    if (d.hidden) continue;
    const P = d.pts.map(toPx); if (P.some(q => q === null)) continue;
    const g = new G(ctx, w, h);
    render(d, P, g, d === D.selected || d === D.creating || d === D.hover);
  }
  ctx.restore();
}
chart.timeScale().subscribeVisibleLogicalRangeChange(requestDraw);
new ResizeObserver(requestDraw).observe(wrap);
['wheel', 'mouseup'].forEach(ev => wrap.addEventListener(ev, requestDraw, { passive: true }));

// ───────── hit testing ─────────
function distSeg(px, py, [x1, y1, x2, y2]) {
  const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
  let t = L ? ((px - x1) * dx + (py - y1) * dy) / L : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
function inPoly(px, py, pts) { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { if (((pts[i].y > py) !== (pts[j].y > py)) && (px < (pts[j].x - pts[i].x) * (py - pts[i].y) / (pts[j].y - pts[i].y) + pts[i].x)) c = !c; } return c; }
function hitTest(x, y) {
  const { w, h } = paneSize();
  // anchors of the selected drawing first
  if (D.selected && !D.selected.locked && !D.lockAll) {
    const P = anchorPts(D.selected).map(toPx);
    for (let i = 0; i < P.length; i++) if (P[i] && Math.hypot(P[i].x - x, P[i].y - y) <= 7) return { d: D.selected, anchor: i };
  }
  for (let k = D.items.length - 1; k >= 0; k--) {
    const d = D.items[k]; if (d.hidden) continue;
    const P = d.pts.map(toPx); if (P.some(q => q === null)) continue;
    const g = new G(null, w, h); render(d, P, g, false);
    if (g.segs.some(s => distSeg(x, y, s) <= 5)) return { d, anchor: -1 };
    for (const a of g.areas) {
      if (a.box && x >= a.box[0] && x <= a.box[2] && y >= a.box[1] && y <= a.box[3]) return { d, anchor: -1 };
      if (a.poly && inPoly(x, y, a.poly)) return { d, anchor: -1 };
      if (a.ell && a.ell[4] && ((x - a.ell[0]) ** 2) / (a.ell[2] ** 2 || 1) + ((y - a.ell[1]) ** 2) / (a.ell[3] ** 2 || 1) <= 1) return { d, anchor: -1 };
    }
  }
  return null;
}

// ───────── persistence / history ─────────
const keyOf = () => 'ql.draw.' + (QL.getSymbol() || 'X');
const serialize = () => JSON.stringify(D.items.map(({ id, type, pts, style, locked, hidden }) => ({ id, type, pts, style, locked, hidden })));
function save() { store.set(keyOf(), JSON.parse(serialize())); window.dispatchEvent(new CustomEvent('ql:drawings')); }
function snapshot() { D.undo.push(serialize()); if (D.undo.length > 100) D.undo.shift(); D.redo = []; }
function restore(json) { D.items = JSON.parse(json); D.selected = null; save(); renderProps(); requestDraw(); }
function undo() { if (!D.undo.length) return; D.redo.push(serialize()); restore(D.undo.pop()); }
function redo() { if (!D.redo.length) return; D.undo.push(serialize()); restore(D.redo.pop()); }
// another chart of this tab (multi-chart cell) or another tab edited drawings of the same symbol → pick them up
window.addEventListener('storage', e => {
  if (e.key !== D.key || D.creating || D.drag) return;
  try { D.items = JSON.parse(e.newValue || '[]') || []; } catch { return; }
  if (D.selected) D.selected = D.items.find(x => x.id === D.selected.id) || null;
  renderProps(); requestDraw(); window.dispatchEvent(new CustomEvent('ql:drawings'));
});
function loadForSymbol() {
  const k = keyOf(); if (k === D.key) { requestDraw(); return; }
  D.key = k; D.items = store.get(k, []) || []; D.selected = null; D.undo = []; D.redo = []; D.creating = null; renderProps(); requestDraw();
}
window.addEventListener('ql:data', loadForSymbol);

// ───────── interaction ─────────
function setNavigation(on) { chart.applyOptions({ handleScroll: on, handleScale: on }); }
function localXY(e) { const r = chartEl.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function inPane({ x, y }) { const { w, h } = paneSize(); return x >= 0 && y >= 0 && x <= w && y <= h; }
function newDrawing(type, pt) {
  const t = TOOL[type];
  const style = { color: DEFAULT_COLOR[type] || '#2962FF', width: type === 'brush' ? 2 : 1, dash: 'solid', fill: true, text: '', fontSize: 14, extend: false, ...(styleDefaults(type) || {}) };
  return { id: nid(), type, pts: t.n === 1 ? [pt] : [pt, { ...pt }], style, locked: false, hidden: false };
}
function finishCreate() {
  const d = D.creating; D.creating = null; D.mode = 'idle';
  if ((d.type === 'long' || d.type === 'short') && d.pts.length === 2) d.pts.push({ t: d.pts[1].t, p: d.pts[0].p - (d.pts[1].p - d.pts[0].p) });
  snapshot(); D.items.push(d); D.selected = d; save();
  if (!stayInMode) setTool(null);
  renderProps(TEXT_FIRST.has(d.type));
  requestDraw();
}
const TEXT_FIRST = new Set(['text', 'callout']);
let stayInMode = false;

function onDown(e) {
  if (e.button !== 0) return;
  if ((e.target.closest && e.target.closest('.rp-ui')) || wrap.classList.contains('rp-picking')) return; // replay bar / start picker
  const xy = localXY(e); if (!inPane(xy)) return;
  if (D.tool) {
    e.preventDefault(); e.stopPropagation();
    const t = TOOL[D.tool];
    const pt = fromPx(xy.x, xy.y, t.n !== 0); if (!pt) return;
    if (t.n === 0) { D.creating = newDrawing(D.tool, pt); D.creating.pts = [pt]; D.mode = 'brushing'; requestDraw(); return; }
    if (!D.creating) {
      D.creating = newDrawing(D.tool, pt); D.downXY = xy; D.mode = 'creating';
      if (t.n === 1) { finishCreate(); return; }
    } else {
      D.creating.pts[D.creating.pts.length - 1] = pt;
      if (D.creating.pts.length >= t.n) { finishCreate(); return; }
      D.creating.pts.push({ ...pt });
    }
    requestDraw(); return;
  }
  const hit = hitTest(xy.x, xy.y);
  if (hit) {
    e.preventDefault(); e.stopPropagation();
    D.selected = hit.d; renderProps();
    if (!hit.d.locked && !D.lockAll) {
      D.mode = 'dragging'; setNavigation(false);
      D.drag = { d: hit.d, anchor: hit.anchor, start: fromPx(xy.x, xy.y, false, false), orig: JSON.parse(JSON.stringify(hit.d.pts)), before: serialize(), moved: false };
    }
    requestDraw();
  } else if (D.selected) { D.selected = null; renderProps(); requestDraw(); }
}
function onMove(e) {
  const xy = localXY(e);
  if (D.mode === 'creating' && D.creating) {
    const t = TOOL[D.creating.type]; const pt = fromPx(xy.x, xy.y, true); if (!pt) return;
    D.creating.pts[D.creating.pts.length - 1] = pt; requestDraw(); return;
  }
  if (D.mode === 'brushing' && D.creating) {
    const last = toPx(D.creating.pts[D.creating.pts.length - 1]);
    if (!last || Math.hypot(last.x - xy.x, last.y - xy.y) > 2) { const pt = fromPx(xy.x, xy.y, false, false); if (pt) D.creating.pts.push(pt); requestDraw(); }
    return;
  }
  if (D.mode === 'dragging' && D.drag) {
    const g = D.drag, d = g.d; const cur = fromPx(xy.x, xy.y, g.anchor >= 0, g.anchor >= 0 && D.magnet); if (!cur || !g.start) return;
    g.moved = true;
    if (g.anchor >= 0) {
      d.pts[g.anchor] = { t: cur.t, p: cur.p };
      if ((d.type === 'long' || d.type === 'short') && g.anchor > 0) { d.pts[1].t = cur.t; if (d.pts[2]) d.pts[2].t = cur.t; }
    } else {
      const dl = (t2l(cur.t) ?? 0) - (t2l(g.start.t) ?? 0), dp = cur.p - g.start.p;
      const shiftL = d.type === 'brush' ? dl : Math.round(dl);
      d.pts = g.orig.map(q => ({ t: l2t((t2l(q.t) ?? 0) + shiftL), p: q.p + dp }));
    }
    requestDraw(); return;
  }
  if (!D.tool && inPane(xy)) {
    const hit = hitTest(xy.x, xy.y);
    const nh = hit ? hit.d : null;
    wrap.classList.toggle('dl-move', !!hit && hit.anchor < 0); wrap.classList.toggle('dl-point', !!hit && hit.anchor >= 0);
    if (nh !== D.hover) { D.hover = nh; requestDraw(); }
  }
}
function onUp(e) {
  if (D.mode === 'brushing' && D.creating) {
    if (D.creating.pts.length >= 2) finishCreate(); else { D.creating = null; D.mode = 'idle'; }
    return;
  }
  if (D.mode === 'creating' && D.creating && D.downXY) { // press-drag-release creation for 2-point tools
    const xy = localXY(e);
    if (TOOL[D.creating.type].n === 2 && D.creating.pts.length === 2 && Math.hypot(xy.x - D.downXY.x, xy.y - D.downXY.y) > 6) { const pt = fromPx(xy.x, xy.y, true); if (pt) D.creating.pts[1] = pt; finishCreate(); }
    D.downXY = null; return;
  }
  if (D.mode === 'dragging' && D.drag) {
    if (D.drag.moved) { D.undo.push(D.drag.before); D.redo = []; save(); }
    D.drag = null; D.mode = 'idle'; setNavigation(!D.tool); requestDraw();
  }
}
// capture phase: we see the event before lightweight-charts and can stop it from panning
wrap.addEventListener('pointerdown', onDown, true);
window.addEventListener('pointermove', onMove, true);
window.addEventListener('pointerup', onUp, true);
wrap.addEventListener('dblclick', e => {
  if (!D.selected || D.tool) return;
  e.stopPropagation();
  if (D.selected.type === 'text' || D.selected.type === 'callout') renderProps(true); else openSettings(D.selected);
}, true);

document.addEventListener('keydown', e => {
  const tag = (e.target && e.target.tagName) || '';
  if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
  if (DS) return; // settings dialog handles its own keys
  if (e.altKey && e.code === 'KeyR') { e.preventDefault(); resetView(); return; }
  if (e.key === 'Escape') { if (D.creating) { D.creating = null; D.mode = 'idle'; } else if (D.tool) setTool(null); else { D.selected = null; renderProps(); } requestDraw(); }
  if ((e.key === 'Delete' || e.key === 'Backspace') && D.selected) { e.preventDefault(); removeDrawing(D.selected); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
});

function removeDrawing(d) { snapshot(); D.items = D.items.filter(x => x !== d); if (D.selected === d) D.selected = null; save(); renderProps(); requestDraw(); }

// ───────── left toolbar + flyout ─────────
const bar = $('dtools');
const fly = document.createElement('div'); fly.className = 'dfly hidden'; wrap.parentElement.appendChild(fly);
function setTool(id) {
  D.tool = id; D.creating = null; D.mode = 'idle';
  wrap.classList.toggle('dl-draw', !!id);
  setNavigation(!id);
  if (id) { const t = TOOL[id]; D.lastInGroup[t.group] = id; store.set('ql.draw.lastInGroup', D.lastInGroup); D.selected = null; renderProps(); }
  renderBar(); requestDraw();
}
function btn(html, title, cls, onclick) { const b = document.createElement('button'); b.className = 'dbtn ' + (cls || ''); b.innerHTML = html; b.title = title; b.onclick = onclick; return b; }
function renderBar() {
  bar.innerHTML = '';
  bar.appendChild(btn(ICON.cursor, 'Курсор (Esc)', D.tool ? '' : 'on', () => { setTool(null); hideFly(); }));
  bar.appendChild(Object.assign(document.createElement('div'), { className: 'dsep' }));
  for (const gr of GROUPS) {
    const cur = TOOL[D.lastInGroup[gr.id]] && TOOL[D.lastInGroup[gr.id]].group === gr.id ? D.lastInGroup[gr.id] : TOOLS.find(t => t.group === gr.id).id;
    const active = D.tool && TOOL[D.tool].group === gr.id;
    const holder = document.createElement('div'); holder.className = 'dgrp';
    const main = btn(ICON[active ? D.tool : cur] || ICON[gr.icon], `${TOOL[cur].name}`, active ? 'on' : '', () => { hideFly(); setTool(active ? null : cur); });
    holder.appendChild(main);
    if (TOOLS.filter(t => t.group === gr.id).length > 1) {
      const more = btn('<svg viewBox="0 0 6 6" width="6" height="6"><path d="M6 0v6H0z" fill="currentColor"/></svg>', `${gr.name}: все инструменты`, 'dmore', (ev) => { ev.stopPropagation(); toggleFly(gr.id, holder); });
      holder.appendChild(more);
    }
    bar.appendChild(holder);
  }
  bar.appendChild(Object.assign(document.createElement('div'), { className: 'dsep' }));
  bar.appendChild(btn(ICON.magnet, 'Магнит: привязка к OHLC', D.magnet ? 'on' : '', () => { D.magnet = !D.magnet; store.set('ql.draw.magnet', D.magnet); renderBar(); }));
  bar.appendChild(btn(ICON.clone, 'Оставаться в режиме рисования', stayInMode ? 'on' : '', () => { stayInMode = !stayInMode; renderBar(); }));
  bar.appendChild(btn(ICON.lock, 'Заблокировать все рисунки', D.lockAll ? 'on' : '', () => { D.lockAll = !D.lockAll; renderBar(); }));
  bar.appendChild(btn(ICON.eye, 'Скрыть все рисунки', D.hideAll ? 'on' : '', () => { D.hideAll = !D.hideAll; renderBar(); requestDraw(); }));
  bar.appendChild(btn(ICON.undo, 'Отменить (Ctrl+Z)', '', undo));
  bar.appendChild(btn(ICON.trash, 'Удалить все рисунки (отмена — Ctrl+Z)', '', () => { if (!D.items.length) return; snapshot(); D.items = []; D.selected = null; save(); renderProps(); requestDraw(); }));
}
let flyGroup = null;
function hideFly() { fly.classList.add('hidden'); flyGroup = null; }
function toggleFly(groupId, anchorEl) {
  if (flyGroup === groupId) { hideFly(); return; }
  flyGroup = groupId;
  const top = anchorEl.getBoundingClientRect().top - wrap.parentElement.getBoundingClientRect().top;
  fly.style.top = Math.max(0, Math.min(top, wrap.parentElement.clientHeight - 420)) + 'px';
  fly.innerHTML = `<div class="dfly-search"><span>🔍</span><input placeholder="Поиск инструментов…" spellcheck="false"></div><div class="dfly-list"></div><div class="dfly-foot"></div>`;
  const input = fly.querySelector('input'), list = fly.querySelector('.dfly-list');
  const fill = () => {
    const q = input.value.trim().toLowerCase();
    const groups = q ? GROUPS : GROUPS.filter(g => g.id === groupId).concat(GROUPS.filter(g => g.id !== groupId));
    let html = '', count = 0;
    for (const g of groups) {
      const items = TOOLS.filter(t => t.group === g.id && (!q || t.name.toLowerCase().includes(q)));
      if (!items.length) continue; count += items.length;
      html += `<div class="dfly-h">${g.name.toUpperCase()}<span>${items.length}</span></div>` + items.map(t => `<button class="dfly-i ${D.tool === t.id ? 'on' : ''}" data-id="${t.id}">${ICON[t.id] || ''}<span>${t.name}</span></button>`).join('');
    }
    list.innerHTML = html || '<div class="muted" style="padding:10px">Ничего не найдено</div>';
    fly.querySelector('.dfly-foot').textContent = `${count} инструментов`;
    list.querySelectorAll('.dfly-i').forEach(b => b.onclick = () => { setTool(b.dataset.id); hideFly(); });
  };
  input.oninput = fill; fill(); fly.classList.remove('hidden'); input.focus();
}
document.addEventListener('pointerdown', e => { if (!fly.classList.contains('hidden') && !fly.contains(e.target) && !bar.contains(e.target)) hideFly(); });

// ───────── floating properties toolbar ─────────
const props = document.createElement('div'); props.className = 'dprops hidden'; wrap.appendChild(props);
function renderProps(focusText) {
  const d = D.selected;
  window.dispatchEvent(new CustomEvent('ql:drawsel'));
  if (!d) { props.classList.add('hidden'); return; }
  const s = d.style, t = TOOL[d.type];
  const hasText = TEXTUAL.has(d.type), hasFill = FILLABLE.has(d.type), hasExt = ['fib_retr', 'fib_ext', 'rect'].includes(d.type);
  props.innerHTML =
    `<span class="dp-name">${t ? t.name : d.type}</span>` +
    `<input type="color" class="dp-color" value="${(s.color || '#2962ff').slice(0, 7)}" title="Цвет">` +
    `<select class="dp-width" title="Толщина">${[1, 2, 3, 4].map(v => `<option ${v === s.width ? 'selected' : ''}>${v}</option>`).join('')}</select>` +
    `<select class="dp-dash" title="Стиль линии"><option value="solid" ${s.dash === 'solid' ? 'selected' : ''}>───</option><option value="dashed" ${s.dash === 'dashed' ? 'selected' : ''}>- - -</option><option value="dotted" ${s.dash === 'dotted' ? 'selected' : ''}>·····</option></select>` +
    (hasFill ? `<label class="dp-chk" title="Заливка"><input type="checkbox" class="dp-fill" ${s.fill !== false ? 'checked' : ''}>фон</label>` : '') +
    (hasExt ? `<label class="dp-chk" title="Продлить вправо"><input type="checkbox" class="dp-ext" ${s.extend ? 'checked' : ''}>→</label>` : '') +
    (hasText ? `<input class="dp-text" placeholder="Текст" value="${String(s.text || '').replace(/"/g, '&quot;')}">` : '') +
    (d.type === 'text' || d.type === 'callout' ? `<select class="dp-fs" title="Размер шрифта">${[10, 12, 14, 18, 24, 32].map(v => `<option ${v === (s.fontSize || 14) ? 'selected' : ''}>${v}</option>`).join('')}</select>` : '') +
    `<button class="dp-btn dp-cfg" title="Настройки (двойной клик / правая кнопка)">${ICON.gear}</button>` +
    `<button class="dp-btn dp-lock" title="${d.locked ? 'Разблокировать' : 'Заблокировать'}">${d.locked ? '🔒' : '🔓'}</button>` +
    `<button class="dp-btn dp-clone" title="Клонировать">${ICON.clone}</button>` +
    `<button class="dp-btn dp-del" title="Удалить (Del)">${ICON.trash}</button>`;
  props.classList.remove('hidden');
  const change = (fn) => { snapshot(); fn(); save(); requestDraw(); };
  props.querySelector('.dp-color').oninput = e => { s.color = e.target.value; save(); requestDraw(); };
  props.querySelector('.dp-color').onchange = () => { D.undo.push(serialize()); };
  props.querySelector('.dp-width').onchange = e => change(() => { s.width = +e.target.value; });
  props.querySelector('.dp-dash').onchange = e => change(() => { s.dash = e.target.value; });
  const f = props.querySelector('.dp-fill'); if (f) f.onchange = e => change(() => { s.fill = e.target.checked; });
  const x = props.querySelector('.dp-ext'); if (x) x.onchange = e => change(() => { s.extend = e.target.checked; });
  const fs = props.querySelector('.dp-fs'); if (fs) fs.onchange = e => change(() => { s.fontSize = +e.target.value; });
  const tx = props.querySelector('.dp-text');
  if (tx) { tx.oninput = e => { s.text = e.target.value; save(); requestDraw(); }; tx.onkeydown = e => { if (e.key === 'Enter' || e.key === 'Escape') tx.blur(); }; if (focusText) setTimeout(() => { tx.focus(); tx.select(); }, 0); }
  props.querySelector('.dp-lock').onclick = () => change(() => { d.locked = !d.locked; renderProps(); });
  props.querySelector('.dp-cfg').onclick = () => openSettings(d);
  props.querySelector('.dp-clone').onclick = () => cloneDrawing(d);
  props.querySelector('.dp-del').onclick = () => removeDrawing(d);
}

// ───────── templates (style defaults per tool) ─────────
const DEF_KEY = type => 'ql.draw.def.' + type;
const STYLE_KEYS = ['color', 'width', 'dash', 'fill', 'fillAlpha', 'extend', 'extendLeft', 'reverse', 'showPrices', 'showLevels', 'pct', 'labelPos', 'levels', 'fontSize'];
function styleDefaults(type) { return store.get(DEF_KEY(type), null); }
function saveStyleDefault(d) { const o = {}; for (const k of STYLE_KEYS) if (d.style[k] !== undefined) o[k] = JSON.parse(JSON.stringify(d.style[k])); store.set(DEF_KEY(d.type), o); }
function resetStyleDefault(type) { try { localStorage.removeItem(DEF_KEY(type)); } catch { /* storage unavailable */ } }
function cloneDrawing(d) {
  snapshot();
  const c = JSON.parse(JSON.stringify(d)); c.id = nid(); c.locked = false; c.hidden = false;
  c.pts = c.pts.map(q => ({ t: l2t((t2l(q.t) ?? 0) + 5), p: q.p })); D.items.push(c); D.selected = c; save(); renderProps(); requestDraw();
}
function resetView() {
  try { chart.timeScale().resetTimeScale(); chart.priceScale('right').applyOptions({ autoScale: true }); } catch { /* chart not ready */ }
  requestDraw();
}
const escH = x => String(x ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const toastEl = document.createElement('div'); toastEl.className = 'dtoast hidden'; document.body.appendChild(toastEl);
let toastT = null;
function toast(msg) { toastEl.textContent = msg; toastEl.classList.remove('hidden'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.add('hidden'), 2600); }
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); }
  catch { const ta = Object.assign(document.createElement('textarea'), { value: t }); ta.style.cssText = 'position:fixed;left:-9999px'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch { /* no clipboard */ } ta.remove(); }
  toast(`Скопировано: ${t}`);
}

// ───────── right-click menu ─────────
const cm = document.createElement('div'); cm.className = 'dcm hidden'; document.body.appendChild(cm);
function hideCM() { cm.classList.add('hidden'); }
function showCM(e, items) {
  cm.innerHTML = items.map((it, i) => it === '-' ? '<div class="dcm-sep"></div>'
    : `<button data-i="${i}" class="${it.danger ? 'danger' : ''}" ${it.disabled ? 'disabled' : ''}><span class="dcm-ic">${it.icon || ''}</span><span class="dcm-l">${escH(it.label)}</span>${it.hint ? `<span class="dcm-hint">${escH(it.hint)}</span>` : ''}</button>`).join('');
  cm.querySelectorAll('button').forEach(b => { b.onclick = () => { hideCM(); items[+b.dataset.i].run(); }; });
  cm.classList.remove('hidden');
  const w = cm.offsetWidth, h = cm.offsetHeight;
  cm.style.left = Math.max(4, Math.min(e.clientX, innerWidth - w - 4)) + 'px';
  cm.style.top = Math.max(4, Math.min(e.clientY, innerHeight - h - 4)) + 'px';
}
document.addEventListener('pointerdown', e => { if (!cm.classList.contains('hidden') && !cm.contains(e.target)) hideCM(); }, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideCM(); }, true);
window.addEventListener('blur', hideCM);
wrap.addEventListener('wheel', hideCM, { passive: true });

const MI = { gear: ICON.gear, clone: ICON.clone, lock: ICON.lock, trash: ICON.trash, eye: ICON.eye };
function drawingMenu(d) {
  const i = D.items.indexOf(d), name = TOOL[d.type] ? TOOL[d.type].name : d.type;
  return [
    { icon: MI.gear, label: 'Настройки…', hint: '2× клик', run: () => openSettings(d) },
    ...(LEVELED.has(d.type) ? [{ icon: '≡', label: 'Уровни Фибоначчи…', run: () => openSettings(d, 'levels') }] : []),
    { icon: '⌖', label: 'Координаты…', run: () => openSettings(d, 'coords') },
    ...((d.type === 'hline' || d.type === 'hray') && window.QLAlerts && d.pts && d.pts[0] ? [{ icon: '🔔', label: 'Алерт на этой линии', run: () => window.QLAlerts.create(d.pts[0].p) }] : []),
    '-',
    { icon: MI.clone, label: 'Клонировать', run: () => cloneDrawing(d) },
    { icon: MI.lock, label: d.locked ? 'Разблокировать' : 'Заблокировать', run: () => { snapshot(); d.locked = !d.locked; save(); renderProps(); requestDraw(); } },
    { icon: MI.eye, label: 'Скрыть', run: () => window.QLDraw.setHidden(d.id, true) },
    { icon: '⤒', label: 'На передний план', disabled: i === D.items.length - 1, run: () => { snapshot(); D.items.splice(D.items.indexOf(d), 1); D.items.push(d); save(); requestDraw(); } },
    { icon: '⤓', label: 'На задний план', disabled: i === 0, run: () => { snapshot(); D.items.splice(D.items.indexOf(d), 1); D.items.unshift(d); save(); requestDraw(); } },
    '-',
    { icon: '★', label: 'Сделать стилем по умолчанию', run: () => { saveStyleDefault(d); toast(`Новые «${name}» будут рисоваться с этим стилем`); } },
    { icon: MI.trash, label: 'Удалить', hint: 'Del', danger: true, run: () => removeDrawing(d) },
  ];
}
function chartMenu(pt) {
  const A = window.QLApp || {}, items = [{ icon: '⟲', label: 'Сбросить вид графика', hint: 'Alt+R', run: resetView }];
  if (pt) {
    const pr = fmtP(pt.p);
    items.push({ icon: MI.clone, label: `Копировать цену ${pr}`, run: () => copyText(pr) });
    if (window.QLAlerts) items.push({ icon: '🔔', label: `Алерт на цене ${pr}`, run: () => window.QLAlerts.create(pt.p) });
    items.push({ icon: '—', label: `Горизонтальная линия на ${pr}`, run: () => { snapshot(); const d = newDrawing('hline', { t: pt.t, p: pt.p }); D.items.push(d); D.selected = d; save(); renderProps(); requestDraw(); } });
    if (window.QLReplay && !A.EMBED) items.push({ icon: '▶', label: 'Replay с этого бара', run: () => {
      const l = Math.round(t2l(pt.t) ?? -1), n = bars().length;
      if (l >= 10 && l < n - 1) window.QLReplay.startAt(l); else toast('Выберите бар внутри истории графика');
    } });
  }
  items.push('-');
  if (window.QLLibrary) items.push({ icon: 'ƒ', label: 'Индикаторы…', hint: '/', run: () => window.QLLibrary.open() });
  for (const sc of ((A.S && A.S.scripts) || []).slice(0, 8)) items.push({ icon: MI.gear, label: `Настройки: ${sc.name || 'Script'}`, run: () => A.openInputs(sc) });
  if (window.QLValidate) for (const sc of ((A.S && A.S.scripts) || []).filter(window.QLValidate.isStrategy).slice(0, 4)) items.push({ icon: '✓', label: `Проверить стратегию: ${sc.name || 'Script'}`, run: () => window.QLValidate.openSetup(sc) });
  items.push('-');
  const n = D.items.length;
  items.push({ icon: MI.eye, label: D.hideAll ? 'Показать все рисунки' : 'Скрыть все рисунки', disabled: !n, run: () => { D.hideAll = !D.hideAll; renderBar(); requestDraw(); } });
  items.push({ icon: MI.lock, label: D.lockAll ? 'Разблокировать все рисунки' : 'Заблокировать все рисунки', disabled: !n, run: () => { D.lockAll = !D.lockAll; renderBar(); } });
  items.push({ icon: MI.trash, label: `Удалить все рисунки${n ? ` (${n})` : ''}`, disabled: !n, danger: true, run: () => { snapshot(); D.items = []; D.selected = null; save(); renderProps(); requestDraw(); toast('Рисунки удалены. Вернуть: Ctrl+Z'); } });
  if (window.QLSettings) items.push('-', { icon: MI.gear, label: 'Настройки и подключения', run: () => window.QLSettings.open() });
  return items;
}
wrap.addEventListener('contextmenu', e => {
  if (e.target.closest && e.target.closest('.rp-ui, .dprops')) return;
  e.preventDefault(); e.stopPropagation();
  if (D.creating) { D.creating = null; D.mode = 'idle'; requestDraw(); return; } // right-click cancels a drawing in progress
  const xy = localXY(e), pane = inPane(xy);
  const hit = pane && !D.tool ? hitTest(xy.x, xy.y) : null;
  if (hit) { D.selected = hit.d; renderProps(); requestDraw(); showCM(e, drawingMenu(hit.d)); }
  else showCM(e, chartMenu(pane ? fromPx(xy.x, xy.y, false, false) : null));
}, true);

// ───────── settings dialog (TradingView-style): Стиль / Уровни / Текст / Координаты ─────────
const dlg = document.createElement('div'); dlg.className = 'dset-ov hidden'; document.body.appendChild(dlg);
let DS = null; // { d, before, tab }
const FIBLIKE = new Set(['fib_retr', 'fib_ext']);
function openSettings(d, tab) {
  if (!d) return;
  hideCM(); D.selected = d; renderProps(); requestDraw();
  DS = { d, before: serialize(), tab: tab || 'style' };
  renderSettings(); dlg.classList.remove('hidden');
}
function closeSettings(apply) {
  if (!DS) return;
  const { d, before } = DS; DS = null; dlg.classList.add('hidden');
  if (apply) { if (serialize() !== before) { D.undo.push(before); if (D.undo.length > 100) D.undo.shift(); D.redo = []; save(); } }
  else { D.items = JSON.parse(before); D.selected = D.items.find(x => x.id === d.id) || null; save(); }
  renderProps(); requestDraw();
}
const isoUTC = t => { try { return new Date(t * 1000).toISOString().slice(0, 16); } catch { return ''; } };
function chk(k, label, def = false) { const v = DS.d.style[k]; return `<label class="dset-chk"><input type="checkbox" data-k="${k}" data-t="bool" data-def="${def ? 1 : 0}" ${(v ?? def) ? 'checked' : ''}> ${label}</label>`; }
function renderSettings() {
  const { d, tab } = DS, s = d.style, t = TOOL[d.type];
  const tabs = [['style', 'Стиль'], ...(LEVELED.has(d.type) ? [['levels', 'Уровни']] : []), ...(TEXTUAL.has(d.type) ? [['text', 'Текст']] : []), ['coords', 'Координаты']];
  let body = '';
  if (tab === 'style') {
    body += `<div class="dset-row"><span>Линия</span><input type="color" data-k="color" data-t="color" value="${(s.color || '#2962ff').slice(0, 7)}">
      <select data-k="width" data-t="num">${[1, 2, 3, 4].map(v => `<option ${v === s.width ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <select data-k="dash" data-t="str"><option value="solid" ${s.dash === 'solid' ? 'selected' : ''}>Сплошная</option><option value="dashed" ${s.dash === 'dashed' ? 'selected' : ''}>Пунктир</option><option value="dotted" ${s.dash === 'dotted' ? 'selected' : ''}>Точки</option></select></div>`;
    if (FILLABLE.has(d.type)) {
      body += `<div class="dset-row"><span>Фон</span>${chk('fill', 'заливка', true)}`;
      if (FIBLIKE.has(d.type)) body += `<input type="range" min="0" max="40" step="1" data-k="fillAlpha" data-t="pct" value="${Math.round((s.fillAlpha ?? 0.08) * 100)}" title="Прозрачность фона"><span class="dset-val" data-show="fillAlpha">${Math.round((s.fillAlpha ?? 0.08) * 100)}%</span>`;
      body += '</div>';
    }
    if (FIBLIKE.has(d.type)) {
      body += `<div class="dset-row"><span>Продлить</span>${chk('extendLeft', 'влево')}${chk('extend', 'вправо')}</div>`;
      body += `<div class="dset-row"><span>Метки</span>${chk('showLevels', 'уровни', true)}${chk('showPrices', 'цены', true)}${chk('pct', 'в процентах')}</div>
        <div class="dset-row"><span>Сторона меток</span><select data-k="labelPos" data-t="str"><option value="left" ${(s.labelPos || (d.type === 'fib_ext' ? 'right' : 'left')) === 'left' ? 'selected' : ''}>слева</option><option value="right" ${(s.labelPos || (d.type === 'fib_ext' ? 'right' : 'left')) === 'right' ? 'selected' : ''}>справа</option></select></div>`;
      body += `<div class="dset-row"><span>Направление</span>${chk('reverse', 'обратить (уровни от другой точки)')}</div>`;
    } else if (LEVELED.has(d.type)) {
      body += `<div class="dset-row"><span>Метки</span>${chk('showLevels', 'показывать уровни', true)}${d.type !== 'fib_time' ? chk('pct', 'в процентах') : ''}</div>`;
    }
    if (d.type === 'rect') body += `<div class="dset-row"><span>Продлить</span>${chk('extend', 'вправо')}</div>`;
  } else if (tab === 'levels') {
    const L = Array.isArray(s.levels) && s.levels.length ? s.levels : defLevels(d.type);
    body += `<div class="dset-lv">${L.map((l, i) => `<div class="dset-li"><input type="checkbox" data-li="${i}" data-lf="on" ${l.on !== false ? 'checked' : ''}>
      <input type="number" step="any" data-li="${i}" data-lf="v" value="${escH(l.v)}"><input type="color" data-li="${i}" data-lf="c" value="${(l.c || '#787b86').slice(0, 7)}"><button class="dset-x" data-ldel="${i}" title="Убрать уровень">✕</button></div>`).join('')}</div>
      <div class="dset-row dset-lvact"><button class="dset-btn" data-lact="add">+ Уровень</button><button class="dset-btn" data-lact="reset">Сбросить уровни</button>
      <span class="dset-sp"></span><span class="muted">Все одним цветом</span><input type="color" data-lact="all" value="${(s.color || '#2962ff').slice(0, 7)}"></div>`;
  } else if (tab === 'text') {
    body += `<div class="dset-row dset-col"><span>Текст</span><textarea data-k="text" data-t="str" rows="3">${escH(s.text || '')}</textarea></div>
      <div class="dset-row"><span>Размер</span><select data-k="fontSize" data-t="num">${[10, 12, 14, 18, 24, 32].map(v => `<option ${v === (s.fontSize || 14) ? 'selected' : ''}>${v}</option>`).join('')}</select></div>`;
  } else if (tab === 'coords') {
    body += d.pts.map((q, i) => `<div class="dset-row"><span>Точка ${i + 1}</span><input type="number" step="any" data-pi="${i}" data-pf="p" value="${+q.p}" title="Цена"><input type="datetime-local" data-pi="${i}" data-pf="t" value="${isoUTC(q.t)}" title="Время (UTC)"></div>`).join('')
      + `<div class="muted dset-note">Время в UTC. Цена и время меняются сразу на графике.</div>`;
  }
  dlg.innerHTML = `<div class="dset" role="dialog"><div class="dset-h"><b>${escH(t ? t.name : d.type)}</b><button class="dset-x" data-close="1" title="Закрыть (Esc)">✕</button></div>
    <div class="dset-tabs">${tabs.map(([id, n]) => `<button data-tab="${id}" class="${id === tab ? 'on' : ''}">${n}</button>`).join('')}</div>
    <div class="dset-b">${body}</div>
    <div class="dset-f"><div class="dset-tpl"><button class="dset-btn" data-tpl="save" title="Новые рисунки этого типа будут с этим стилем">★ Сделать по умолчанию</button>${styleDefaults(d.type) ? '<button class="dset-btn" data-tpl="reset" title="Вернуть заводской стиль для новых рисунков">Сбросить шаблон</button>' : ''}</div>
      <span class="dset-sp"></span><button class="dset-btn" data-cancel="1">Отмена</button><button class="dset-btn pri" data-ok="1">ОК</button></div></div>`;
  bindSettings();
}
function bindSettings() {
  const { d } = DS, s = d.style, q = sel => dlg.querySelectorAll(sel);
  const live = () => requestDraw();
  q('[data-tab]').forEach(b => { b.onclick = () => { DS.tab = b.dataset.tab; renderSettings(); }; });
  q('[data-close],[data-cancel]').forEach(b => { b.onclick = () => closeSettings(false); });
  q('[data-ok]').forEach(b => { b.onclick = () => closeSettings(true); });
  q('[data-k]').forEach(el => {
    const k = el.dataset.k, tp = el.dataset.t;
    const apply = () => {
      if (tp === 'bool') s[k] = el.checked;
      else if (tp === 'num') s[k] = +el.value;
      else if (tp === 'pct') { s[k] = +el.value / 100; const v = dlg.querySelector(`[data-show="${k}"]`); if (v) v.textContent = el.value + '%'; }
      else s[k] = el.value;
      live();
    };
    el.addEventListener(tp === 'bool' || el.tagName === 'SELECT' ? 'change' : 'input', apply);
  });
  const ensureLevels = () => { if (!Array.isArray(s.levels) || !s.levels.length) s.levels = defLevels(d.type); return s.levels; };
  q('[data-li]').forEach(el => {
    const i = +el.dataset.li, f = el.dataset.lf;
    el.addEventListener(f === 'on' ? 'change' : 'input', () => { const L = ensureLevels(); L[i][f] = f === 'on' ? el.checked : f === 'v' ? (el.value === '' ? '' : +el.value) : el.value; live(); });
  });
  q('[data-ldel]').forEach(b => { b.onclick = () => { ensureLevels().splice(+b.dataset.ldel, 1); live(); renderSettings(); }; });
  q('[data-lact]').forEach(el => {
    const a = el.dataset.lact;
    if (a === 'add') el.onclick = () => { const L = ensureLevels(); const mx = L.reduce((m, l) => Math.max(m, +l.v || 0), 0); L.push({ v: +(mx + 0.5).toFixed(3), c: s.color || '#2962FF', on: true }); live(); renderSettings(); const inp = dlg.querySelectorAll('.dset-li input[type=number]'); if (inp.length) { inp[inp.length - 1].focus(); inp[inp.length - 1].select(); } };
    if (a === 'reset') el.onclick = () => { delete s.levels; live(); renderSettings(); };
    if (a === 'all') el.addEventListener('input', () => { ensureLevels().forEach(l => { l.c = el.value; }); q('[data-lf="c"]').forEach(c => { c.value = el.value; }); live(); });
  });
  q('[data-pi]').forEach(el => {
    const i = +el.dataset.pi, f = el.dataset.pf;
    el.addEventListener('change', () => {
      if (f === 'p') { const v = parseFloat(el.value); if (Number.isFinite(v)) d.pts[i].p = v; }
      else { const ms = Date.parse(el.value + ':00Z'); if (Number.isFinite(ms)) d.pts[i].t = Math.round(ms / 1000); }
      live();
    });
  });
  q('[data-tpl]').forEach(b => { b.onclick = () => {
    if (b.dataset.tpl === 'save') { saveStyleDefault(d); toast(`Стиль сохранён: новые «${TOOL[d.type].name}» будут такими`); }
    else { resetStyleDefault(d.type); toast('Шаблон сброшен: новые рисунки — со стандартным стилем'); }
    renderSettings();
  }; });
}
dlg.addEventListener('mousedown', e => { if (e.target === dlg) closeSettings(true); });
document.addEventListener('keydown', e => {
  if (!DS) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSettings(false); }
  else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); e.stopPropagation(); closeSettings(true); }
}, true);

// ───────── public API (for Quant / future features) ─────────
window.QLDraw = {
  list: () => JSON.parse(serialize()),
  add: (type, pts, style) => { if (!TOOL[type]) throw new Error('unknown tool ' + type); snapshot(); const d = newDrawing(type, pts[0]); d.pts = pts; Object.assign(d.style, style || {}); D.items.push(d); save(); requestDraw(); return d.id; },
  clear: () => { snapshot(); D.items = []; D.selected = null; save(); renderProps(); requestDraw(); },
  byId: id => D.items.find(d => d.id === id),
  setHidden: (id, v) => { const d = D.items.find(x => x.id === id); if (!d) return; snapshot(); d.hidden = !!v; if (v && D.selected === d) { D.selected = null; renderProps(); } save(); requestDraw(); },
  setLocked: (id, v) => { const d = D.items.find(x => x.id === id); if (!d) return; snapshot(); d.locked = !!v; save(); renderProps(); requestDraw(); },
  remove: id => { const d = D.items.find(x => x.id === id); if (d) removeDrawing(d); },
  select: id => { const d = D.items.find(x => x.id === id); D.selected = d && !d.hidden ? d : null; renderProps(); requestDraw(); window.dispatchEvent(new CustomEvent('ql:drawings')); },
  selectedId: () => D.selected ? D.selected.id : null,
  removeAgent: () => { if (!D.items.some(d => d.style && d.style.agent)) return; snapshot(); D.items = D.items.filter(d => !(d.style && d.style.agent)); if (D.selected && !D.items.includes(D.selected)) D.selected = null; save(); renderProps(); requestDraw(); },
  tools: () => TOOLS.map(({ id, name, group, n }) => ({ id, name, group, points: n })),
  redraw: requestDraw,
  openSettings: id => openSettings(D.items.find(x => x.id === id)),
  resetView,
};

renderBar();
loadForSymbol();
})();
