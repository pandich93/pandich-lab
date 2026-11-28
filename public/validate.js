// Pandich Lab — «Проверка стратегии»: grid setup → progress → honest report (region, deflated Sharpe, walk-forward, Monte Carlo, verdict).
(() => {
  const A = window.QLApp; if (!A || A.EMBED) return;
  const { esc, S } = A;
  const f = (x, d = 2) => (x === Infinity ? '∞' : Number.isFinite(x) ? (+x).toFixed(d) : '—');
  const T = s => (window.QLI18n ? window.QLI18n.t(s) : s);
  const isStrategy = s => !!(s && s.result && (s.result.declaration === 'strategy' || s.result.strategy));
  const keyOf = m => m.varId || m.id || m.title || m.name;
  const nice = v => +(+v).toPrecision(6);
  const VERD = { no: 'bad', check: 'warn', forward: 'ok', na: 'na' };
  const ICON = { pass: '✓', warn: '!', fail: '✕', na: '–' };

  // ───────── shared overlay ─────────
  function overlay(cls) {
    const ov = document.createElement('div'); ov.className = 'ind-ov vd-ov';
    const dlg = document.createElement('div'); dlg.className = 'ind-dlg vd-dlg ' + (cls || ''); ov.appendChild(dlg); document.body.appendChild(ov);
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    const close = () => { document.removeEventListener('keydown', onKey, true); ov.remove(); if (dlg._onClose) dlg._onClose(); };
    document.addEventListener('keydown', onKey, true);
    return { ov, dlg, close };
  }

  // ───────── axis defaults from the script's inputs ─────────
  function axisDefault(m) {
    if (m.type === 'bool') return { kind: 'list', values: [true, false] };
    if (m.options && m.options.length) return { kind: 'list', values: m.options.slice(0, 12) };
    const d = Number(m.defval);
    if (!Number.isFinite(d)) return null;
    const isInt = m.type === 'int';
    let lo = d === 0 ? (isInt ? 0 : -1) : d * 0.5, hi = d === 0 ? (isInt ? 10 : 1) : d * 1.5;
    if (lo > hi) [lo, hi] = [hi, lo];
    if (m.minval !== undefined) lo = Math.max(m.minval, lo); if (m.maxval !== undefined) hi = Math.min(m.maxval, hi);
    let step = m.step || (hi - lo) / 6;
    if (isInt) { lo = Math.round(lo); hi = Math.round(hi); step = Math.max(1, Math.round(step)); }
    else step = nice(step);
    return { kind: 'range', from: nice(lo), to: nice(hi), step };
  }
  function axisValues(ax, m) {
    if (ax.kind === 'list') return ax.values;
    const out = [], st = Number(ax.step), a = Number(ax.from), b = Number(ax.to);
    if (!(st > 0) || !Number.isFinite(a) || !Number.isFinite(b) || b < a) return [];
    for (let v = a; v <= b + st * 1e-9 && out.length < 61; v += st) out.push(m.type === 'int' ? Math.round(v) : nice(v));
    return [...new Set(out)];
  }

  // ───────── setup dialog ─────────
  async function openSetup(s) {
    if (!s) s = S.scripts.find(x => x.id === S.selectedId && isStrategy(x)) || S.scripts.find(isStrategy);
    if (!s) { alert('Нет стратегии на графике. Проверка работает со скриптом strategy(…) — попросите Panda сделать стратегию.'); return; }
    if (!s.result) { await A.runScript(s); A.renderAll(); }
    if (!isStrategy(s)) { alert('Это индикатор, а не strategy(…). Попросите Panda переделать его в стратегию с входами и выходами.'); return; }
    const meta = (s.result.inputsMeta || []).filter(m => ['int', 'float', 'bool', 'string'].includes(m.type) && (m.type !== 'string' || (m.options && m.options.length)));
    const title = s.result.title || s.name;
    const D = await fetch(`/api/validate/defaults?symbol=${encodeURIComponent(S.symbol)}&interval=${encodeURIComponent(S.interval)}&title=${encodeURIComponent(title)}`).then(r => r.json()).catch(e => ({ ok: false, error: e.message }));
    if (!D.ok) { alert('Не удалось получить данные: ' + (D.error || '')); return; }
    const saved = (s.valSetup && s.valSetup.sym === S.symbol + S.interval) ? s.valSetup : null;
    const axes = meta.map((m, k) => { const sv = saved && saved.axes[keyOf(m)]; const d = axisDefault(m); return d ? { m, on: sv ? sv.on : (k < 2 && d.kind === 'range' && meta.filter(x => axisDefault(x)?.kind === 'range').indexOf(m) < 2), ...(sv ? sv.ax : d) } : null; }).filter(Boolean);
    if (!saved) { let n = 0; axes.forEach(a => { a.on = a.kind === 'range' && n++ < 2; }); }
    const costs = saved ? { ...saved.costs } : { spread: D.suggest.spread, slip: D.suggest.slip, commPct: D.suggest.commPct, perBar: D.barSpread };
    let barsN = saved ? saved.bars : Math.min(D.maxBars, 10000);
    const { dlg, close } = overlay('vd-setup');
    const msPer = Math.max(80, (s.result.ms || 300) * (barsN / Math.max(500, S.limit || 1500)));
    const srcName = { mt5: 'MT5', binance: 'Binance', mock: 'MOCK' }[D.src] || D.src;
    dlg.innerHTML = `<div class="ind-h"><b data-noi18n title="${esc(title)}">${esc(title)}</b><button class="ind-x" title="Закрыть (Esc)">✕</button></div>
      <div class="ind-tabs"><span class="on">Проверка стратегии</span></div>
      <div class="ind-b vd-b">
        <p class="vd-lead">Не ищем «лучшие параметры» — это максимум шума. Прогоняем сетку, находим устойчивую область (плато), берём её среднее, делаем поправку на число испытаний, проверяем вне выборки и издержками.</p>
        <div class="ind-grp">Данные</div>
        <div class="ind-row"><span class="ind-lbl">Символ и таймфрейм</span><span class="sp"></span><b data-noi18n>${esc(S.symbol)} · ${esc(S.interval)} · ${esc(srcName)}</b></div>
        <div class="ind-row"><span class="ind-lbl">История, баров</span><span class="sp"></span><select id="vdBars">${[2000, 5000, 10000, 20000].filter(n => n <= D.maxBars).map(n => `<option ${n === barsN ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        <div class="ind-grp">Сетка параметров</div>
        ${axes.length ? '' : '<div class="ind-empty">У стратегии нет числовых input — проверять по сетке нечего. Будет один прогон.</div>'}
        <div class="vd-axes">${axes.map((a, k) => `<div class="vd-ax" data-a="${k}">
          <label class="ind-bool"><input type="checkbox" data-on ${a.on ? 'checked' : ''}><span data-noi18n>${esc(a.m.title || a.m.name)}</span></label><span class="sp"></span>
          ${a.kind === 'range' ? `<span class="vd-rng"><input type="text" class="ind-num" data-f="from" value="${a.from}" title="от"><i>…</i><input type="text" class="ind-num" data-f="to" value="${a.to}" title="до"><i>шаг</i><input type="text" class="ind-num" data-f="step" value="${a.step}" title="шаг"></span>` : `<span class="muted vd-list" data-noi18n>${esc(a.values.join(' / '))}</span>`}
          <span class="vd-cnt" data-cnt></span></div>`).join('')}</div>
        <div class="vd-total" id="vdTotal"></div>
        ${D.prevTrials ? `<div class="vd-hint">Эту стратегию на ${esc(S.symbol)} ${esc(S.interval)} уже проверяли: <b data-noi18n>${D.prevTrials}</b> наборов. Они войдут в поправку на число испытаний — каждая «подкрутка» делает порог строже.</div>` : ''}
        <div class="ind-grp">Издержки на сделку</div>
        ${D.barSpread ? `<label class="ind-bool vd-pb"><input type="checkbox" id="vdPerBar" ${costs.perBar ? 'checked' : ''}><span>Спред брокера по каждому бару</span></label><div class="vd-hint">медиана ${f(D.medianSpread, 5)} — у лонга на входе, у шорта на выходе</div>` : ''}
        <div class="ind-row" id="vdSpRow"><span class="ind-lbl">Спред, в цене</span><span class="sp"></span><input type="text" class="ind-num" id="vdSpread" value="${costs.spread ?? D.medianSpread ?? 0}"></div>
        <div class="ind-row"><span class="ind-lbl">Проскальзывание, в цене (на вход и на выход)</span><span class="sp"></span><input type="text" class="ind-num" id="vdSlip" value="${costs.slip}"></div>
        <div class="ind-row"><span class="ind-lbl">Комиссия, % от объёма (на каждую сторону)</span><span class="sp"></span><input type="text" class="ind-num" id="vdComm" value="${costs.commPct}"></div>
        <div class="vd-hint">Это поверх commission/slippage, заданных в strategy(…). Без издержек результата нет.</div>
      </div>
      <div class="ind-f"><span class="muted vd-est" id="vdEst"></span><span class="sp"></span><button class="ind-btn" data-a="cancel">Отмена</button><button class="ind-btn pri" data-a="run">Запустить проверку</button></div>`;
    const $q = sel => dlg.querySelector(sel);
    const readAxes = () => axes.map((a, k) => { const row = dlg.querySelector(`[data-a="${k}"]`); a.on = row.querySelector('[data-on]').checked; if (a.kind === 'range') for (const fl of ['from', 'to', 'step']) a[fl] = row.querySelector(`[data-f="${fl}"]`).value.replace(',', '.'); return a; });
    const refresh = () => {
      readAxes(); barsN = +$q('#vdBars').value;
      let total = 1, nOn = 0, bad = false;
      axes.forEach((a, k) => { const row = dlg.querySelector(`[data-a="${k}"]`), n = axisValues(a, a.m).length; row.querySelector('[data-cnt]').textContent = a.on ? `× ${n}` : ''; row.classList.toggle('off', !a.on); if (a.on) { nOn++; total *= n; if (!n) bad = true; } });
      const tooMany = total > D.maxCells;
      $q('#vdTotal').innerHTML = `<b>${total}</b> ${T('прогонов')}${nOn > 4 ? ` · <span class="vd-w">${T('больше 4 параметров — риск переоптимизации')}</span>` : ''}${tooMany ? ` · <span class="vd-w">${T('максимум')} ${D.maxCells}</span>` : ''}`;
      const sec = Math.round(total * msPer * (barsN / 10000 + 0.3) / 1000);
      $q('#vdEst').textContent = `≈ ${sec < 60 ? sec + ' ' + T('с') : Math.round(sec / 60) + ' ' + T('мин')}`;
      $q('[data-a="run"]').disabled = tooMany || bad;
      const pb = $q('#vdPerBar'); $q('#vdSpRow').classList.toggle('off', !!(pb && pb.checked));
    };
    dlg.addEventListener('input', refresh); dlg.addEventListener('change', refresh); refresh();
    dlg.querySelector('.ind-x').onclick = close; dlg.querySelector('[data-a="cancel"]').onclick = close;
    dlg.querySelector('[data-a="run"]').onclick = async () => {
      readAxes();
      const pb = $q('#vdPerBar'), num = id => parseFloat(String($q(id).value).replace(',', '.')) || 0;
      const c = { spread: pb && pb.checked ? null : num('#vdSpread'), slip: num('#vdSlip'), commPct: num('#vdComm') };
      s.valSetup = { sym: S.symbol + S.interval, bars: barsN, costs: { ...c, spread: c.spread ?? num('#vdSpread'), perBar: !!(pb && pb.checked) }, axes: Object.fromEntries(axes.map(a => [keyOf(a.m), { on: a.on, ax: a.kind === 'range' ? { kind: 'range', from: a.from, to: a.to, step: a.step } : { kind: 'list', values: a.values } }])) };
      const on = axes.filter(a => a.on);
      const spec = { code: s.code, symbol: S.symbol, interval: S.interval, bars: barsN, costs: c, baseInputs: s.inputs || {},
        axes: on.length ? on.map(a => ({ key: keyOf(a.m), label: a.m.title || a.m.name, values: axisValues(a, a.m) })) : [{ key: '__none', label: '—', values: [0] }] };
      close(); runJob(s, spec);
    };
  }

  // ───────── progress ─────────
  async function runJob(s, spec) {
    const r = await fetch('/api/validate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(spec) }).then(x => x.json()).catch(e => ({ ok: false, error: e.message }));
    if (!r.ok) { alert('Проверка не запустилась: ' + r.error); return; }
    const { dlg, close } = overlay('vd-prog');
    let stop = false; dlg._onClose = () => { stop = true; };
    dlg.innerHTML = `<div class="ind-h"><b>Проверка стратегии</b></div><div class="ind-b vd-b"><div class="vd-progtxt" id="vdPT">Готовлю данные…</div><div class="vd-bar"><i id="vdPB"></i></div><div class="vd-hint">График можно смотреть дальше — прогоны идут на сервере.</div></div>
      <div class="ind-f"><span class="sp"></span><button class="ind-btn" data-a="stop">Остановить</button></div>`;
    dlg.querySelector('[data-a="stop"]').onclick = () => { fetch('/api/validate/cancel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: r.id }) }); close(); };
    while (!stop) {
      await new Promise(res => setTimeout(res, 500));
      const j = await fetch('/api/validate/job/' + r.id).then(x => x.json()).catch(() => null);
      if (!j || stop) continue;
      if (!j.ok) { close(); alert(j.error); return; }
      const pt = dlg.querySelector('#vdPT'); if (pt) pt.textContent = `${j.done} / ${j.total} ${T('прогонов')} · ${Math.round(j.elapsed / 1000)} ${T('с')}`;
      const pb = dlg.querySelector('#vdPB'); if (pb) pb.style.width = (j.total ? j.done / j.total * 100 : 0) + '%';
      if (j.state === 'done') { close(); s.lastValidation = j.report; showReport(j.report, s); return; }
      if (j.state === 'error') { close(); alert('Ошибка проверки: ' + j.error); return; }
      if (j.state === 'cancelled') { close(); return; }
    }
  }

  // ───────── report ─────────
  function heat(rep) {
    const ax = rep.grid.axes; if (!ax.length || ax[0].key === '__none') return '';
    const cells = rep.cells, vals = cells.map(c => c.n >= 10 ? c.sharpe : NaN).filter(Number.isFinite);
    const lim = Math.max(0.5, ...vals.map(Math.abs));
    const col = v => { if (!Number.isFinite(v)) return 'transparent'; const a = Math.min(1, Math.abs(v) / lim); return v >= 0 ? `rgba(38,166,154,${0.15 + a * 0.75})` : `rgba(239,83,80,${0.15 + a * 0.75})`; };
    const tip = c => `${Object.entries(c.inputs).map(([k, v]) => `${(ax.find(a => a.key === k) || {}).label || k}=${v}`).join(', ')}\nSharpe ${f(c.sharpe)} · ${T('сделок')} ${c.n} · net ${f(c.net)} · PF ${f(c.pf)}${c.inRegion ? '\n' + T('в регионе') : ''}${c.error ? '\n' + c.error : ''}`;
    const centre = rep.region ? JSON.stringify(rep.region.centerIdx) : '';
    const cellHtml = c => `<td class="${c.inRegion ? 'rg' : ''}${JSON.stringify(c.idx) === centre ? ' cn' : ''}" style="background:${col(c.n >= 10 ? c.sharpe : NaN)}" title="${esc(tip(c))}">${c.n >= 10 ? f(c.sharpe, 1) : '·'}</td>`;
    if (ax.length === 1) return `<table class="vd-heat" data-noi18n><tr><th data-noi18n>${esc(ax[0].label)}</th>${ax[0].values.map(v => `<th>${esc(v)}</th>`).join('')}</tr><tr><th>Sharpe</th>${cells.map(cellHtml).join('')}</tr></table>`;
    // 2+ axes: rows = axis 0, columns = axis 1, other axes fixed at the region centre
    const fix = rep.region ? rep.region.centerIdx : ax.map(() => 0);
    const sub = cells.filter(c => c.idx.every((x, k) => k < 2 || x === fix[k]));
    const extra = ax.slice(2).map((a, k) => `${a.label} = ${a.values[fix[k + 2]]}`).join(', ');
    return `${extra ? `<div class="vd-hint" data-noi18n>${esc(extra)}</div>` : ''}<table class="vd-heat" data-noi18n><tr><th data-noi18n>${esc(ax[0].label)} ↓ · ${esc(ax[1].label)} →</th>${ax[1].values.map(v => `<th>${esc(v)}</th>`).join('')}</tr>` +
      ax[0].values.map((v, i) => `<tr><th>${esc(v)}</th>${sub.filter(c => c.idx[0] === i).sort((a, b) => a.idx[1] - b.idx[1]).map(cellHtml).join('')}</tr>`).join('') + '</table>';
  }
  function equitySvg(eq) {
    if (!eq || eq.length < 2) return '';
    const W = 640, H = 140, xs = eq.map(p => p[0]), ys = [0, ...eq.map(p => p[1])];
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys) || 1;
    const X = t => (t - x0) / Math.max(1, x1 - x0) * (W - 10) + 5, Y = v => H - 5 - (v - y0) / Math.max(1e-9, y1 - y0) * (H - 10);
    const d = 'M' + X(x0) + ',' + Y(0) + eq.map(p => ` L${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
    return `<svg class="vd-eq" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line x1="0" x2="${W}" y1="${Y(0)}" y2="${Y(0)}" stroke="#434651" stroke-dasharray="3 3"/><path d="${d}" fill="none" stroke="${eq[eq.length - 1][1] >= 0 ? '#26a69a' : '#ef5350'}" stroke-width="1.6"/></svg>`;
  }
  const dt = t => new Date(t * 1000).toISOString().slice(0, 10);
  const inputsTxt = (rep, inp) => Object.entries(inp || {}).filter(([k]) => k !== '__none').map(([k, v]) => `${(rep.grid.axes.find(a => a.key === k) || {}).label || k} = ${v}`).join(', ') || '—';

  function showReport(rep, s) {
    const { dlg, close } = overlay('vd-rep');
    const R = rep.region, C = rep.center, V = rep.verdict, M = rep.meta || {};
    const stat = (k, v, cls = '') => `<div class="stat"><div class="k">${k}</div><div class="v ${cls}" data-noi18n>${v}</div></div>`;
    const bad = rep.gates.filter(g => g.status !== 'pass');
    dlg.innerHTML = `<div class="ind-h"><b data-noi18n>${esc(M.title || 'Strategy')} · ${esc(M.symbol || '')} ${esc(M.interval || '')}</b><button class="ind-x" title="Закрыть (Esc)">✕</button></div>
      <div class="ind-b vd-b">
        <div class="vd-verdict ${VERD[V.code]}"><div class="vd-vt">${esc(V.title)}</div>
          ${bad.length ? `<ul>${bad.map(g => `<li><span>${esc(g.label)}</span>: <b>${esc(g.value)}</b>${g.note ? ` — <span>${esc(g.note)}</span>` : ''}</li>`).join('')}</ul>` : '<div class="vd-vs">Все ворота пройдены. Дальше — форвард на демо с замороженными параметрами; живые деньги только после него.</div>'}</div>
        <div class="vd-meta" data-noi18n>${esc(dt(rep.bars.from))} … ${esc(dt(rep.bars.to))} · ${rep.bars.count} ${esc(T('баров'))} · ${esc(T('испытаний'))} ${rep.trials}${M.prevTrials ? ` (${esc(T('из них раньше'))} ${M.prevTrials})` : ''} · ${esc(T('издержки'))}: ${esc(T(rep.costs.source || ''))}${rep.costs.perBar ? '' : `, spread ${f(rep.costs.spread, 4)}`}, slip ${f(rep.costs.slip, 4)}, ${f(rep.costs.commPct, 3)}%</div>
        ${R ? `<div class="ind-grp">Регион (плато), а не максимум</div>
        <div class="stats">${stat(T('Sharpe региона'), `${f(R.mean)} ± ${f(R.se)}`, R.mean > 0 ? 'pos' : 'neg')}${stat(T('Ячеек в регионе'), `${R.size}${R.edge ? ' ⚠' : ''}`)}${stat(T('В плюсе (регион / сетка)'), `${f(R.profitableShare * 100, 0)}% / ${f(R.gridProfitableShare * 100, 0)}%`)}${stat('Deflated Sharpe', `${f(rep.dsr.deflated)} · p ${f(rep.dsr.prob * 100, 0)}%`, rep.dsr.deflated > 0 ? 'pos' : 'neg')}${stat('Walk-forward OOS', `${f(rep.wf.oosSharpe)} · WFE ${f(rep.wf.wfe)}`, rep.wf.oosSharpe > 0 ? 'pos' : 'neg')}${rep.mc ? stat(T('Монте-Карло: убыток / DD95'), `${f(rep.mc.pLoss * 100, 1)}% / ${f(rep.mc.dd95)}`) : ''}</div>
        <div class="vd-center"><span>Центр региона — набор для форварда:</span> <b data-noi18n>${esc(inputsTxt(rep, R.center))}</b>${JSON.stringify(R.center) !== JSON.stringify(R.peakInputs) ? ` <span class="muted">(${esc(T('максимум сетки'))}: <span data-noi18n>${esc(inputsTxt(rep, R.peakInputs))}</span> — ${esc(T('не берём'))})</span>` : ''}</div>
        <div class="stats">${stat(T('Сделок'), C.n)}${stat('Net', f(C.net), C.net >= 0 ? 'pos' : 'neg')}${stat('PF', f(C.pf))}${stat('Win', f(C.win * 100, 0) + '%')}${stat('Max DD', f(C.dd) + (Number.isFinite(C.ddPct) ? ` (${f(C.ddPct, 1)}%)` : ''))}${stat(T('Издержки съели'), `${f(C.costs)} · ×${f(rep.costs.deathMult)}`)}</div>
        ${equitySvg(C.equity)}` : ''}
        <div class="ind-grp">Карта Sharpe по сетке</div>
        <div class="vd-heatwrap">${heat(rep)}</div>
        <div class="vd-hint">Зелёный — плюс, красный — минус, рамка — регион, жирная рамка — центр. «·» — меньше 10 сделок.</div>
        <div class="ind-grp">Ворота</div>
        <table class="vd-gates">${rep.gates.map(g => `<tr class="${g.status}"><td class="ic">${ICON[g.status] || ''}</td><td>${esc(g.label)}</td><td class="v">${esc(g.value)}</td><td class="nt">${esc(g.note)}</td></tr>`).join('')}</table>
        ${rep.wf.folds.length ? `<div class="ind-grp">Walk-forward (якорный): регион выбирается заново на каждом окне</div>
        <table class="vd-tbl"><tr><th>Тест-окно</th><th>Регион</th><th>IS Sharpe</th><th>OOS Sharpe</th><th>OOS net</th></tr>${rep.wf.folds.map(w => `<tr><td data-noi18n>${dt(w.from)} … ${dt(w.to)}</td><td>${w.region || '—'}</td><td>${f(w.isSharpe)}</td><td class="${w.oosSharpe > 0 ? 'pos' : 'neg'}">${f(w.oosSharpe)}</td><td class="${w.oosNet > 0 ? 'pos' : 'neg'}">${f(w.oosNet)}</td></tr>`).join('')}</table>` : ''}
        ${rep.years && rep.years.length ? `<div class="ind-grp">По годам (центр региона)</div><table class="vd-tbl"><tr><th>Год</th><th>Сделок</th><th>Net</th></tr>${rep.years.map(y => `<tr><td>${y.year}</td><td>${y.n}</td><td class="${y.net > 0 ? 'pos' : 'neg'}">${f(y.net)}</td></tr>`).join('')}</table>` : ''}
        <div class="vd-hint">Бэктест PineTS на загруженных барах (OHLC, без тиков): заполнение по цене бара, SL и TP внутри одного бара — как решит движок. Это проверка идеи, не инвестиционная рекомендация.</div>
      </div>
      <div class="ind-f"><button class="ind-btn" data-a="md">Скопировать отчёт</button><span class="sp"></span>${R && s ? '<button class="ind-btn" data-a="apply">Применить центр региона</button>' : ''}<button class="ind-btn pri" data-a="close">Закрыть</button></div>`;
    dlg.querySelector('.ind-x').onclick = close; dlg.querySelector('[data-a="close"]').onclick = close;
    const ap = dlg.querySelector('[data-a="apply"]');
    if (ap) ap.onclick = async () => { s.inputs = { ...(s.inputs || {}), ...R.center }; delete s.inputs.__none; A.saveScripts(); await A.runScript(s); A.renderAll(); ap.textContent = '✓ ' + T('Применено'); ap.disabled = true; };
    dlg.querySelector('[data-a="md"]').onclick = async e => { try { await navigator.clipboard.writeText(toMarkdown(rep)); e.target.textContent = '✓ ' + T('Скопировано'); } catch { e.target.textContent = T('Не удалось скопировать'); } };
  }

  function toMarkdown(rep) {
    const R = rep.region, C = rep.center, M = rep.meta || {}, L = [];
    L.push(`# ${M.title || 'Strategy'} — ${M.symbol} ${M.interval}`, '', `**${T('Вердикт')}: ${T(rep.verdict.title)}**`, '');
    L.push(`- ${T('Данные')}: ${dt(rep.bars.from)} … ${dt(rep.bars.to)}, ${rep.bars.count} ${T('баров')}`);
    L.push(`- ${T('Сетка')}: ${rep.grid.axes.map(a => `${a.label} [${a.values.join(', ')}]`).join(' × ')} = ${rep.grid.total}; ${T('испытаний')} ${rep.trials}`);
    L.push(`- ${T('Издержки')}: ${T(rep.costs.source || '')}, spread ${f(rep.costs.spread, 4)}, slip ${f(rep.costs.slip, 4)}, ${f(rep.costs.commPct, 3)}%`);
    if (R) {
      L.push(`- ${T('Регион')}: ${R.size} ${T('ячеек')}, Sharpe ${f(R.mean)} ± ${f(R.se)}${R.edge ? ` (${T('у края сетки')})` : ''}`);
      L.push(`- ${T('Центр региона')}: ${inputsTxt(rep, R.center)} → ${T('сделок')} ${C.n}, net ${f(C.net)}, PF ${f(C.pf)}, win ${f(C.win * 100, 0)}%, DD ${f(C.dd)}`);
      L.push(`- Deflated Sharpe: ${f(rep.dsr.S)} − ${f(rep.dsr.sr0)} = ${f(rep.dsr.deflated)} (p ${f(rep.dsr.prob * 100, 0)}%)`);
      L.push(`- Walk-forward: OOS Sharpe ${f(rep.wf.oosSharpe)}, WFE ${f(rep.wf.wfe)}, ${rep.wf.posFolds}/${rep.wf.n}`);
      if (rep.mc) L.push(`- ${T('Монте-Карло')}: P(loss) ${f(rep.mc.pLoss * 100, 1)}%, DD95 ${f(rep.mc.dd95)}`);
    }
    L.push('', `| | ${T('Ворота')} | | |`, '|---|---|---|---|');
    for (const g of rep.gates) L.push(`| ${ICON[g.status]} | ${T(g.label)} | ${g.value} | ${T(g.note)} |`);
    L.push('', `_Pandich Lab · PineTS · ${M.at || ''}_`);
    return L.join('\n');
  }

  // compact card in the Panda chat
  function chatCard(rep, s) {
    const el = document.createElement('div'); el.className = 'vd-card ' + (VERD[rep.verdict.code] || '');
    const R = rep.region;
    el.innerHTML = `<div class="vd-ct">✓ <span>Проверка стратегии</span>: <b>${esc(rep.verdict.title)}</b></div>` +
      (R ? `<div class="vd-cl" data-noi18n>Sharpe ${f(R.mean)} ± ${f(R.se)} · ${R.size} ${esc(T('ячеек'))} · deflated ${f(rep.dsr.deflated)} · WF OOS ${f(rep.wf.oosSharpe)}</div><div class="vd-cl"><span>центр</span>: <span data-noi18n>${esc(inputsTxt(rep, R.center))}</span></div>` : '') +
      `<button class="st-chatbtn">Открыть отчёт</button>`;
    el.querySelector('button').onclick = () => showReport(rep, s || S.scripts.find(x => x.id === S.selectedId) || S.scripts.find(isStrategy));
    return el;
  }

  window.QLValidate = { openSetup, showReport, chatCard, isStrategy };
})();
