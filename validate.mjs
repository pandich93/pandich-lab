// Pandich Lab — honest strategy validation.
// One parameter set is a noisy estimate: map the surface over a grid → pick a REGION (plateau) → report the region mean,
// correct for the number of trials (deflated Sharpe), check walk-forward, Monte Carlo, costs, years, concentration → verdict.
// Pure functions: the server feeds closed trades of every grid cell (one PineTS run per cell over the same bars).

// ───────── small math ─────────
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const sd = a => { if (a.length < 2) return NaN; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const median = a => { if (!a.length) return NaN; const b = [...a].sort((x, y) => x - y), k = b.length >> 1; return b.length % 2 ? b[k] : (b[k - 1] + b[k]) / 2; };
const pct = (a, p) => { if (!a.length) return NaN; const b = [...a].sort((x, y) => x - y); const i = Math.min(b.length - 1, Math.max(0, (b.length - 1) * p)); const lo = Math.floor(i), hi = Math.ceil(i); return b[lo] + (b[hi] - b[lo]) * (i - lo); };
const fin = x => Number.isFinite(x);
// standard normal CDF (Abramowitz–Stegun 7.1.26 via erf)
export function normCdf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}
// inverse standard normal CDF (Acklam)
export function normInv(p) {
  if (p <= 0) return -Infinity; if (p >= 1) return Infinity;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
function spearman(x, y) {
  const rank = a => { const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = new Array(a.length); for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2; i = j + 1; } return r; };
  if (x.length < 3) return NaN;
  const rx = rank(x), ry = rank(y), mx = mean(rx), my = mean(ry);
  let n = 0, dx = 0, dy = 0; for (let i = 0; i < x.length; i++) { n += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; }
  return dx && dy ? n / Math.sqrt(dx * dy) : NaN;
}
// deterministic PRNG so the same inputs give the same report
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

// ───────── costs ─────────
// trade: { et, xt (unix sec), size (signed: >0 long), ep, xp, profit (strategy P&L incl. Pine's own commission) }
// costs: { spread (price units, used when a bar has no spread), slip (price units per side), commPct (% of notional per side), spreadAt(tSec)→price|undefined }
export function tradeCost(t, costs, k = 1) {
  const q = Math.abs(t.size || 0); if (!q) return 0;
  const long = t.size > 0;
  // MT5 charts are Bid: a long pays the spread on entry (buys at Ask), a short pays it on exit (buys back at Ask)
  const sp = Math.max(0, (costs.spreadAt && costs.spreadAt(long ? t.et : t.xt)) ?? costs.spread ?? 0);
  return q * k * (sp + 2 * (costs.slip || 0)) + (costs.commPct || 0) / 100 * q * k * (Math.abs(t.ep) + Math.abs(t.xp));
}
// P&L units per (price × qty): strategy P&L may be scaled by syminfo.pointvalue; estimate it from the trades themselves
export function pnlScale(trades) {
  const r = trades.filter(t => t.size && t.xp !== t.ep && fin(t.profit)).map(t => t.profit / ((t.xp - t.ep) * t.size)).filter(fin);
  const m = median(r); return fin(m) && m > 0 && Math.abs(m - 1) > 0.2 ? m : 1;
}

// ───────── metrics over a time window ─────────
// ctx: { days: sorted array of UTC day numbers that have bars, ann: 252|365, capital }
export function metrics(trades, from, to, ctx) {
  const tr = trades.filter(t => t.xt >= from && t.xt < to);
  const n = tr.length, net = tr.reduce((s, t) => s + t.net, 0);
  const gp = tr.filter(t => t.net > 0).reduce((s, t) => s + t.net, 0), gl = -tr.filter(t => t.net < 0).reduce((s, t) => s + t.net, 0);
  let eq = 0, peak = 0, dd = 0; for (const t of tr) { eq += t.net; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  // daily P&L over every market day of the window (days without trades count as 0) → annualised Sharpe
  const d0 = Math.floor(from / 86400), d1 = Math.floor((to - 1) / 86400);
  const days = ctx.days.filter(d => d >= d0 && d <= d1), byDay = new Map();
  for (const t of tr) { const d = Math.floor(t.xt / 86400); byDay.set(d, (byDay.get(d) || 0) + t.net); }
  const series = days.map(d => byDay.get(d) || 0), s = sd(series);
  const sharpe = n >= 2 && s > 0 ? mean(series) / s * Math.sqrt(ctx.ann) : (n ? 0 : NaN);
  const years = Math.max(1 / 365, days.length / ctx.ann);
  const se = fin(sharpe) ? Math.sqrt((1 + sharpe * sharpe / 2) / years) : NaN;
  return { n, net, pf: gl > 0 ? gp / gl : (gp > 0 ? Infinity : NaN), win: n ? tr.filter(t => t.net > 0).length / n : NaN, avg: n ? net / n : NaN,
    dd, ddPct: ctx.capital ? dd / ctx.capital * 100 : NaN, sharpe, se, years, activeDays: byDay.size };
}

// ───────── grid geometry ─────────
// axes: [{ key, label, values, numeric }]; cell i ↔ index vector (row-major, last axis fastest)
export function gridIndex(axes) {
  const dims = axes.map(a => a.values.length), total = dims.reduce((p, x) => p * x, 1), idx = [];
  for (let i = 0; i < total; i++) { let r = i; const v = new Array(dims.length); for (let k = dims.length - 1; k >= 0; k--) { v[k] = r % dims[k]; r = Math.floor(r / dims[k]); } idx.push(v); }
  return { dims, total, idx };
}
function neighbours(G, axes, i, radius = 1) {
  const v = G.idx[i], out = [];
  for (let j = 0; j < G.total; j++) {
    const w = G.idx[j]; let ok = true;
    for (let k = 0; k < v.length && ok; k++) { const r = axes[k].numeric ? radius : 0; if (Math.abs(w[k] - v[k]) > r) ok = false; }
    if (ok) out.push(j);
  }
  return out;
}
// region = connected plateau around the best SMOOTHED cell (mean of the cell and its ±1 neighbours) — never the raw maximum
export function selectRegion(G, axes, vals, ses) {
  const valid = vals.map(fin);
  const nb = G.idx.map((_, i) => neighbours(G, axes, i));
  const smooth = vals.map((v, i) => { if (!valid[i]) return NaN; const ok = nb[i].filter(j => valid[j]); return ok.length * 2 >= nb[i].length ? mean(ok.map(j => vals[j])) : NaN; });
  let peak = -1; smooth.forEach((v, i) => { if (fin(v) && (peak < 0 || v > smooth[peak])) peak = i; });
  if (peak < 0) return null;
  // plateau = cells whose smoothed value is within half a standard error of the peak and, for a positive peak, at least half of it
  const sp = smooth[peak], half = fin(ses[peak]) ? ses[peak] / 2 : Math.abs(sp) * 0.25;
  const thr = sp > 0 ? Math.max(sp - half, sp / 2) : sp - half;
  const cells = [peak], seen = new Set([peak]);
  for (let q = 0; q < cells.length; q++) for (const j of nb[cells[q]]) if (!seen.has(j)) { seen.add(j); if (fin(smooth[j]) && smooth[j] >= thr && valid[j]) cells.push(j); }
  const m = mean(cells.map(i => vals[i]));
  // centre = cell closest to the region centroid (index space), ties → higher smoothed value
  const cen = G.idx[0].map((_, k) => mean(cells.map(i => G.idx[i][k])));
  let center = cells[0], best = Infinity;
  for (const i of cells) { const d = G.idx[i].reduce((s, x, k) => s + (x - cen[k]) ** 2, 0) - smooth[i] * 1e-9; if (d < best) { best = d; center = i; } }
  const edge = cells.some(i => G.idx[i].some((x, k) => axes[k].numeric && G.dims[k] > 2 && (x === 0 || x === G.dims[k] - 1)));
  return { cells, peak, center, mean: m, smoothPeak: smooth[peak], threshold: thr, edge, smooth };
}

// ───────── deflated Sharpe (Bailey & López de Prado): noise ceiling for the best of N trials ─────────
// sr0 = expected maximum Sharpe of N trials with NO edge: spread of the estimate under the null, se0 = √(1/T) (T in years);
// prob = P(true Sharpe > sr0) with the estimate's own standard error se = √((1 + S²/2)/T).
export function deflated(S, se, N, se0 = se) {
  const g = 0.5772156649;
  const sr0 = N > 1 ? se0 * ((1 - g) * normInv(1 - 1 / N) + g * normInv(1 - 1 / (N * Math.E))) : 0;
  return { S, se, se0, N, sr0, deflated: S - sr0, prob: fin(se) && se > 0 ? normCdf((S - sr0) / se) : NaN };
}

// ───────── Monte Carlo on the trade sequence ─────────
export function monteCarlo(nets, capital, runs = 2000, seed = 7) {
  if (nets.length < 2) return null;
  const R = rng(seed), dds = [], finals = [];
  const ddOf = a => { let eq = 0, pk = 0, dd = 0; for (const x of a) { eq += x; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); } return dd; };
  for (let r = 0; r < runs; r++) {
    const a = [...nets]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } // shuffle → drawdown paths
    dds.push(ddOf(a));
    let s = 0; for (let i = 0; i < nets.length; i++) s += nets[Math.floor(R() * nets.length)]; // bootstrap → chance the edge is ≤ 0
    finals.push(s);
  }
  return { runs, dd50: pct(dds, 0.5), dd95: pct(dds, 0.95), dd95Pct: capital ? pct(dds, 0.95) / capital * 100 : NaN, pLoss: finals.filter(x => x <= 0).length / runs, final5: pct(finals, 0.05), final50: pct(finals, 0.5) };
}

// ───────── full report ─────────
// input: { axes, cells: [{ inputs, trades }], bars: { from, to, days, ann, capital, count }, costs, trialsBefore, minTrades }
export function buildReport(inp) {
  const { axes, bars } = inp, costs = inp.costs || {};
  const G = gridIndex(axes), ctx = { days: bars.days, ann: bars.ann, capital: bars.capital };
  const minCell = inp.minTrades || 10;
  // net P&L per trade after OUR costs (on top of any commission declared in strategy())
  let costSum = 0, grossSum = 0;
  const cells = inp.cells.map((c, i) => {
    const k = pnlScale(c.trades);
    const trades = c.trades.map(t => { const cost = tradeCost(t, costs, k); return { ...t, cost, net: t.profit - cost }; }).sort((a, b) => a.xt - b.xt);
    return { i, inputs: c.inputs, trades, error: c.error || null };
  });
  const span = { from: bars.from, to: bars.to + 1 };
  const full = cells.map(c => metrics(c.trades, span.from, span.to, ctx));
  const val = full.map(m => (m.n >= minCell ? m.sharpe : NaN)), se = full.map(m => m.se);
  const region = selectRegion(G, axes, val, se);
  const N = G.total + Math.max(0, inp.trialsBefore || 0);

  // walk-forward (anchored): train on [start, b_j), re-select the region there, carry the REGION MEAN into [b_j, b_j+1)
  const cuts = [0.5, 0.625, 0.75, 0.875, 1].map(f => Math.round(span.from + (span.to - span.from) * f));
  const folds = [];
  for (let j = 0; j < cuts.length - 1; j++) {
    const tr = cells.map(c => metrics(c.trades, span.from, cuts[j], ctx)), te = cells.map(c => metrics(c.trades, cuts[j], cuts[j + 1], ctx));
    const reg = selectRegion(G, axes, tr.map(m => (m.n >= minCell ? m.sharpe : NaN)), tr.map(m => m.se));
    if (!reg) { folds.push({ from: cuts[j], to: cuts[j + 1], region: 0 }); continue; }
    const isS = mean(reg.cells.map(i => tr[i].sharpe)), oosS = mean(reg.cells.map(i => te[i].sharpe).filter(fin));
    const oosNet = mean(reg.cells.map(i => te[i].net)), oosN = mean(reg.cells.map(i => te[i].n));
    const rho = reg.cells.length >= 5 ? spearman(reg.cells.map(i => tr[i].sharpe), reg.cells.map(i => te[i].sharpe)) : NaN;
    folds.push({ from: cuts[j], to: cuts[j + 1], region: reg.cells.length, center: cells[reg.center].inputs, isSharpe: isS, oosSharpe: oosS, oosNet, oosTrades: oosN, rho });
  }
  const okF = folds.filter(f => f.region && fin(f.oosSharpe));
  const wf = { folds, oosSharpe: mean(okF.map(f => f.oosSharpe)), isSharpe: mean(okF.map(f => f.isSharpe)), posFolds: okF.filter(f => f.oosNet > 0).length, n: okF.length };
  wf.wfe = wf.isSharpe > 0 ? wf.oosSharpe / wf.isSharpe : NaN;
  wf.rho = mean(okF.map(f => f.rho).filter(fin));

  let rep = { grid: { axes, total: G.total, dims: G.dims }, trials: N, costs: { spread: costs.spread || 0, slip: costs.slip || 0, commPct: costs.commPct || 0, perBar: !!costs.spreadAt, source: costs.source || '' },
    cells: cells.map((c, i) => ({ inputs: c.inputs, idx: G.idx[i], error: c.error, ...full[i], smooth: region ? region.smooth[i] : NaN, inRegion: region ? region.cells.includes(i) : false })),
    region: null, wf, bars: { from: bars.from, to: bars.to, count: bars.count, ann: bars.ann, capital: bars.capital } };
  if (!region) return finish(rep, null, inp);

  const c = cells[region.center], cm = full[region.center];
  const regMean = region.mean, regSE = Math.sqrt((1 + regMean * regMean / 2) / cm.years);
  rep.region = { size: region.cells.length, mean: regMean, se: regSE, edge: region.edge, peakInputs: cells[region.peak].inputs, center: c.inputs, centerIdx: G.idx[region.center],
    meanNet: mean(region.cells.map(i => full[i].net)), meanPF: median(region.cells.map(i => full[i].pf).filter(fin)), profitableShare: region.cells.filter(i => full[i].net > 0).length / region.cells.length,
    gridProfitableShare: full.filter(m => m.n >= minCell).length ? full.filter(m => m.n >= minCell && m.net > 0).length / full.filter(m => m.n >= minCell).length : NaN };
  rep.dsr = deflated(regMean, regSE, N, Math.sqrt(1 / cm.years));
  // centre set: the parameter set to forward-test (middle of the plateau, not the peak)
  const nets = c.trades.map(t => t.net);
  costSum = c.trades.reduce((s, t) => s + t.cost, 0); grossSum = c.trades.reduce((s, t) => s + t.profit, 0);
  rep.center = { ...cm, inputs: c.inputs, equity: (() => { let e = 0; return c.trades.map(t => [t.xt, +(e += t.net).toFixed(6)]); })(), grossBeforeCosts: grossSum, costs: costSum };
  rep.costs.deathMult = grossSum <= 0 ? 0 : costSum > 0 ? grossSum / costSum : Infinity; // edge = 0 when costs are × this (0 = losing even before costs)
  rep.mc = monteCarlo(nets, bars.capital);
  const byYear = new Map(); for (const t of c.trades) { const y = new Date(t.xt * 1000).getUTCFullYear(); const o = byYear.get(y) || { year: y, net: 0, n: 0 }; o.net += t.net; o.n++; byYear.set(y, o); }
  rep.years = [...byYear.values()].sort((a, b) => a.year - b.year);
  const sorted = [...nets].sort((a, b) => b - a);
  rep.concentration = { top5: sorted.slice(0, 5).reduce((s, x) => s + x, 0), netWithoutTop5: nets.reduce((s, x) => s + x, 0) - sorted.slice(0, 5).reduce((s, x) => s + x, 0) };
  return finish(rep, c, inp);
}

// ───────── gates + verdict (thresholds from the project's validation method) ─────────
function finish(rep, c, inp) {
  const G = []; const add = (id, label, status, value, note) => G.push({ id, label, status, value, note: note || '' });
  const costsSet = (rep.costs.spread || 0) + (rep.costs.slip || 0) + (rep.costs.commPct || 0) > 0 || rep.costs.perBar;
  add('costs', 'Издержки учтены', costsSet ? 'pass' : 'fail', costsSet ? (rep.costs.perBar ? 'спред по барам' : 'заданы') : 'нет', costsSet ? '' : 'без издержек результата нет');
  const nAxes = rep.grid.axes.length;
  add('params', 'Настраиваемых параметров ≤ 4', nAxes <= 4 ? 'pass' : 'warn', String(nAxes), nAxes > 4 ? 'много осей — риск переоптимизации' : '');
  if (!rep.region) {
    add('region', 'Есть устойчивый регион', 'fail', '—', 'ни в одной ячейке нет достаточно сделок');
    rep.gates = G; rep.verdict = { code: 'na', title: 'НЕ ОЦЕНИВАЕТСЯ', reasons: ['Мало сделок во всех ячейках сетки — расширьте историю или ослабьте условия входа.'] }; return rep;
  }
  const C = rep.center, R = rep.region, D = rep.dsr, W = rep.wf, M = rep.mc;
  add('sample', 'Сделок у центра региона ≥ 30 (для решения ≥ 100)', C.n >= 100 ? 'pass' : C.n >= 30 ? 'warn' : 'fail', String(C.n), C.n < 30 ? 'выборка мала — не оценивается' : C.n < 100 ? 'для решения нужно ≥ 100' : '');
  add('net', 'Прибыль после издержек', C.net > 0 ? 'pass' : 'fail', C.net.toFixed(2));
  const tooGood = C.sharpe > 3 || (C.win > 0.9 && C.ddPct < 5);
  add('toogood', '«Слишком хорошо» (Sharpe > 3 или win > 90% при DD < 5%)', tooGood ? 'warn' : 'pass', `Sharpe ${C.sharpe.toFixed(2)}, win ${(C.win * 100).toFixed(0)}%`, tooGood ? 'ищите ошибку: заглядывание, исполнение, издержки' : '');
  add('region', 'Регион: размер и край сетки', R.size >= 3 && !R.edge ? 'pass' : 'warn', `${R.size} яч.${R.edge ? ', у края' : ''}`, R.edge ? 'регион касается края — расширьте сетку' : R.size < 3 ? 'узкий пик, а не плато' : '');
  add('dsr', `Deflated Sharpe (N = ${D.N})`, D.deflated > 0 && D.prob >= 0.95 ? 'pass' : D.deflated > 0 ? 'warn' : 'fail', `${D.S.toFixed(2)} − ${D.sr0.toFixed(2)} = ${D.deflated.toFixed(2)} (p ${(D.prob * 100).toFixed(0)}%)`, D.deflated <= 0 ? 'ниже порога шума перебора — перевеса нет' : D.prob < 0.95 ? 'выше порога шума, но не значим на 95%' : '');
  if (W.n) add('wf', 'Walk-forward: вне выборки', W.oosSharpe > 0 && W.wfe >= 0.5 ? 'pass' : W.oosSharpe > 0 && W.wfe >= 0.3 ? 'warn' : 'fail',
    `OOS Sharpe ${fin(W.oosSharpe) ? W.oosSharpe.toFixed(2) : '—'}, WFE ${fin(W.wfe) ? W.wfe.toFixed(2) : '—'}, плюс ${W.posFolds}/${W.n}`, W.wfe < 0.3 || !(W.oosSharpe > 0) ? 'вне выборки перевес не держится — подгонка' : W.wfe < 0.5 ? 'WFE < 0,5' : '');
  else add('wf', 'Walk-forward: вне выборки', 'fail', '—', 'мало сделок в окнах');
  const dm = rep.costs.deathMult;
  if (costsSet) add('costmult', 'Запас по издержкам (перевес жив при ×2)', dm >= 2 ? 'pass' : dm >= 1.25 ? 'warn' : 'fail', dm === Infinity ? '∞' : dm === 0 ? 'нет' : `×${dm.toFixed(2)}`, dm === 0 ? 'в минусе даже без издержек' : dm < 1.25 ? 'перевес умирает около реальных издержек' : dm < 2 ? 'чувствителен к издержкам' : '');
  if (M) add('mc', 'Монте-Карло: доля убыточных путей < 10%', M.pLoss < 0.1 ? 'pass' : M.pLoss < 0.25 ? 'warn' : 'fail', `${(M.pLoss * 100).toFixed(1)}%, DD95 ${M.dd95.toFixed(2)}${fin(M.dd95Pct) ? ` (${M.dd95Pct.toFixed(1)}%)` : ''}`);
  const ys = rep.years.filter(y => y.n >= 5), posY = ys.filter(y => y.net > 0).length;
  if (ys.length >= 2) add('years', 'Плюс в большинстве лет', posY / ys.length >= 0.6 ? 'pass' : 'warn', `${posY}/${ys.length}`, posY / ys.length < 0.6 ? 'перевес в одном режиме рынка' : '');
  add('top5', 'Без 5 лучших сделок прибыль остаётся', rep.concentration.netWithoutTop5 > 0 ? 'pass' : 'warn', rep.concentration.netWithoutTop5.toFixed(2), rep.concentration.netWithoutTop5 > 0 ? '' : 'результат держится на нескольких сделках');
  if (R.size >= 3) add('neigh', 'Соседи ±1 шаг тоже в плюсе', R.profitableShare >= 0.7 ? 'pass' : 'warn', `${(R.profitableShare * 100).toFixed(0)}% региона`);
  rep.gates = G;
  const st = id => (G.find(g => g.id === id) || {}).status;
  const reasons = G.filter(g => g.status !== 'pass').map(g => `${g.label}: ${g.value}${g.note ? ' — ' + g.note : ''}`);
  let code, title;
  if (st('sample') === 'fail') { code = 'na'; title = 'НЕ ОЦЕНИВАЕТСЯ'; }
  else if (['costs', 'net', 'dsr', 'wf', 'costmult'].some(id => st(id) === 'fail')) { code = 'no'; title = 'НЕТ ЗНАЧИМОГО ПЕРЕВЕСА'; }
  else if (G.every(g => g.status === 'pass')) { code = 'forward'; title = 'ФОРВАРД-ТЕСТ НА ДЕМО'; }
  else { code = 'check'; title = 'НУЖНА ПРОВЕРКА'; }
  rep.verdict = { code, title, reasons };
  return rep;
}
