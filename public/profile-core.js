// Pandich Lab — Market Profile core (TPO / volume by price), shared by the chart (window.QLProfileCore) and the server (Panda's chart context).
// bars: [{ time (unix sec, UTC), open, high, low, close, volume }] in time order.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.QLProfileCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const SESS = [{ name: 'Asia', from: 0, to: 7 }, { name: 'London', from: 7, to: 13 }, { name: 'New York', from: 13, to: 24 }];
  const DAY = 86400;
  function niceStep(x) {
    if (!(x > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(x))), m = x / p;
    return (m < 1.5 ? 1 : m < 2.25 ? 2 : m < 3.5 ? 2.5 : m < 7.5 ? 5 : 10) * p;
  }
  // which profile a bar belongs to: { key, from, to } (from/to in unix sec, to exclusive)
  function bucketOf(t, mode) {
    const d0 = Math.floor(t / DAY) * DAY;
    if (mode === 'week') { const wd = (new Date(t * 1000).getUTCDay() + 6) % 7; const w0 = d0 - wd * DAY; return { key: 'W' + w0, from: w0, to: w0 + 7 * DAY, name: 'week' }; }
    if (mode === 'session') { const h = (t - d0) / 3600; const s = SESS.find(x => h >= x.from && h < x.to) || SESS[2]; return { key: d0 + s.name, from: d0 + s.from * 3600, to: d0 + s.to * 3600, name: s.name }; }
    return { key: 'D' + d0, from: d0, to: d0 + DAY, name: 'day' };
  }
  function autoStep(bars, mode) {
    const by = new Map();
    for (const b of bars) { const k = bucketOf(b.time, mode === 'visible' ? 'day' : mode).key, o = by.get(k); if (o) { o.h = Math.max(o.h, b.high); o.l = Math.min(o.l, b.low); } else by.set(k, { h: b.high, l: b.low }); }
    const r = [...by.values()].map(o => o.h - o.l).filter(x => x > 0).sort((a, b) => a - b);
    const med = r.length ? r[r.length >> 1] : (bars.length ? bars[bars.length - 1].close * 0.01 : 1);
    return niceStep(med / (mode === 'week' ? 60 : mode === 'session' ? 25 : 40));
  }
  function build(group, o) {
    const step = o.step, period = o.period || 1800;
    const n = new Map(), last = new Map();
    let hi = -Infinity, lo = Infinity, ibH = -Infinity, ibL = Infinity, total = 0;
    const ibEnd = group.from + (o.ibMin || 60) * 60;
    for (const b of group.bars) {
      hi = Math.max(hi, b.high); lo = Math.min(lo, b.low);
      if (b.time < ibEnd) { ibH = Math.max(ibH, b.high); ibL = Math.min(ibL, b.low); }
      const r0 = Math.floor(b.low / step + 1e-9), r1 = Math.floor(b.high / step + 1e-9), span = r1 - r0 + 1;
      const br = Math.floor(b.time / period);
      for (let r = r0; r <= r1; r++) {
        if (o.basis === 'volume') { const v = (b.volume || 0) / span; n.set(r, (n.get(r) || 0) + v); total += v; }
        else if (last.get(r) !== br) { last.set(r, br); n.set(r, (n.get(r) || 0) + 1); total++; } // one TPO per row per 30-min bracket
      }
    }
    if (!n.size) return null;
    const keys = [...n.keys()].sort((a, b) => a - b), mid = (Math.floor(hi / step) + Math.floor(lo / step)) / 2;
    let poc = keys[0];
    for (const k of keys) { const c = n.get(k), pc = n.get(poc); if (c > pc || (c === pc && Math.abs(k - mid) < Math.abs(poc - mid))) poc = k; }
    // value area: grow from the POC towards the heavier neighbour until va% of all TPOs / volume
    let up = poc, dn = poc, acc = n.get(poc);
    const target = total * (o.va || 70) / 100, kMin = keys[0], kMax = keys[keys.length - 1];
    while (acc < target && (up < kMax || dn > kMin)) {
      const a = up < kMax ? (n.get(up + 1) || 0) : -1, b = dn > kMin ? (n.get(dn - 1) || 0) : -1;
      if (a >= b) { up++; acc += Math.max(0, a); } else { dn--; acc += Math.max(0, b); }
    }
    const rows = keys.map(k => ({ p: k * step, n: n.get(k), va: k >= dn && k <= up, poc: k === poc }));
    return { key: group.key, name: group.name, from: group.from, to: group.to, first: group.bars[0].time, lastBar: group.bars[group.bars.length - 1].time,
      step, rows, max: Math.max(...rows.map(r => r.n)), total, poc: (poc + 0.5) * step, vah: (up + 1) * step, val: dn * step, hi, lo,
      ibH: ibH > -Infinity ? ibH : null, ibL: ibL < Infinity ? ibL : null };
  }
  // opts: { mode: 'day'|'session'|'week'|'visible', basis: 'tpo'|'volume', step (0 = auto), va: 70, ibMin: 60, period: 1800, range: {from,to} for 'visible', last: N }
  function compute(bars, opts = {}) {
    const o = { mode: 'day', basis: 'tpo', va: 70, ibMin: 60, period: 1800, last: 10, ...opts };
    if (!bars || !bars.length) return [];
    const src = o.mode === 'visible' && o.range ? bars.filter(b => b.time >= o.range.from && b.time <= o.range.to) : bars;
    if (!src.length) return [];
    if (!(o.step > 0)) o.step = o.mode === 'visible' ? niceStep((Math.max(...src.map(b => b.high)) - Math.min(...src.map(b => b.low))) / 70) : autoStep(bars.slice(-3000), o.mode);
    // bars wider than a bracket (H1 and above): every bar is its own TPO period
    const tf = bars.length > 1 ? bars[bars.length - 1].time - bars[bars.length - 2].time : 60;
    o.period = Math.max(o.period, tf);
    let groups;
    if (o.mode === 'visible') groups = [{ key: 'visible', name: 'visible', from: src[0].time, to: src[src.length - 1].time + tf, bars: src }];
    else {
      const m = new Map();
      for (const b of src) { const k = bucketOf(b.time, o.mode); let g = m.get(k.key); if (!g) { g = { ...k, bars: [] }; m.set(k.key, g); } g.bars.push(b); }
      groups = [...m.values()].slice(-(o.last || 10));
    }
    const out = groups.map(g => build(g, o)).filter(Boolean);
    // naked POC: not traded through by any later bar
    for (const p of out) {
      p.touched = null;
      for (const b of bars) { if (b.time < p.to) continue; if (b.low <= p.poc && b.high >= p.poc) { p.touched = b.time; break; } }
    }
    return out;
  }
  return { compute, niceStep, SESS };
});
