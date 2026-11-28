// Pandich Lab — Market Profile on the chart: TPO or volume by price per day / session / week / visible range; POC, value area, IB, naked POCs.
(() => {
  const A = window.QLApp, C = window.QLProfileCore; if (!A || !C) return;
  const { S, chart, candles, esc } = A;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };
  const T = s => (window.QLI18n ? window.QLI18n.t(s) : s);
  const DEF = { on: false, mode: 'day', basis: 'tpo', step: 0, va: 70, last: 10, hist: true, poc: true, va_lines: true, ib: true, naked: true, width: 60 };
  const O = { ...DEF, ...store.get('ql.profile', {}) };
  const save = () => store.set('ql.profile', O);

  // ───────── layer ─────────
  const wrap = document.getElementById('chartWrap');
  const cv = document.createElement('canvas'); cv.id = 'profilelayer'; wrap.appendChild(cv);
  const g = cv.getContext('2d');
  let pending = false, cache = null;
  const requestDraw = () => { if (!pending) { pending = true; requestAnimationFrame(draw); } };
  chart.timeScale().subscribeVisibleLogicalRangeChange(requestDraw);
  new ResizeObserver(requestDraw).observe(wrap);
  ['wheel', 'mouseup'].forEach(ev => wrap.addEventListener(ev, requestDraw, { passive: true }));
  window.addEventListener('ql:render', () => { cache = null; requestDraw(); });
  // live bars: recompute when the last bar changes (cheap check, every 2 s)
  let sig = '';
  setInterval(() => { if (!O.on) return; const b = S.bars[S.bars.length - 1]; const s2 = b ? `${S.symbol}|${S.interval}|${S.bars.length}|${b.time}|${b.close}` : ''; if (s2 !== sig) { sig = s2; cache = null; requestDraw(); } }, 2000);

  const ts = () => chart.timeScale();
  // x of a bar that exists on the chart (exact series time) — immune to other series adding their own timestamps
  const X = t => (t === null || t === undefined ? null : ts().timeToCoordinate(t));
  const barSpacing = () => (ts().options().barSpacing || 6);
  function profiles() {
    if (O.mode === 'visible') {
      const r = ts().getVisibleLogicalRange(); if (!r) return [];
      const n = S.bars.length, a = S.bars[Math.max(0, Math.floor(r.from))], b = S.bars[Math.min(n - 1, Math.ceil(r.to))];
      if (!a || !b) return [];
      return C.compute(S.bars, { mode: 'visible', basis: O.basis, step: +O.step || 0, va: +O.va || 70, range: { from: a.time, to: b.time } });
    }
    const key = `${S.symbol}|${S.interval}|${S.bars.length}|${S.bars.length && S.bars[S.bars.length - 1].time}|${O.mode}|${O.basis}|${O.step}|${O.va}|${O.last}`;
    if (!cache || cache.key !== key) cache = { key, list: C.compute(S.bars, { mode: O.mode, basis: O.basis, step: +O.step || 0, va: +O.va || 70, last: Math.max(1, +O.last || 10) }) };
    return cache.list;
  }
  function fmtP(p, step) { const d = Math.max(0, Math.min(6, -Math.floor(Math.log10(step)) + 1)); return (+p).toFixed(d); }
  function draw() {
    pending = false;
    const w = ts().width(), h = chart.paneSize(0).height, dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px'; }
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    btn && btn.classList.toggle('on', O.on);
    if (!O.on || !S.bars.length) return;
    const Y = p => candles.priceToCoordinate(p);
    g.save(); g.beginPath(); g.rect(0, 0, w, h); g.clip();
    g.font = '10px Inter, system-ui, sans-serif'; g.textBaseline = 'middle';
    const list = profiles();
    for (const p of list) {
      const bs = barSpacing();
      // the profile spans its own bars: from the first bar of the period to the end of its last bar
      let x0 = O.mode === 'visible' ? null : X(p.first), x1 = O.mode === 'visible' ? null : (X(p.lastBar) === null ? null : X(p.lastBar) + bs / 2);
      if (x0 !== null) x0 -= bs / 2;
      if (O.mode === 'visible') { x1 = w - 4; x0 = w - Math.max(80, w * 0.22); }
      if (x0 === null || x1 === null || x1 < x0) continue;
      if ((x1 < 0 || x0 > w) && !(O.naked && !p.touched && !p.forming)) continue;
      const span = Math.max(4, (x1 ?? 0) - (x0 ?? 0)), maxW = span * Math.min(0.95, (+O.width || 60) / 100);
      const yTop = Y(p.rows[p.rows.length - 1].p + p.step), yBot = Y(p.rows[0].p);
      const rowH = yTop !== null && yBot !== null ? Math.max(1, Math.abs(yBot - yTop) / p.rows.length) : 1;
      // histogram: rows from the session start (visible range: from the right edge)
      if (O.hist && x0 !== null && x0 < w && x1 > 0) {
        for (const r of p.rows) {
          const y = Y(r.p + p.step); if (y === null) continue;
          const len = maxW * r.n / p.max;
          g.fillStyle = r.poc ? 'rgba(255,152,0,.75)' : r.va ? 'rgba(41,98,255,.38)' : 'rgba(120,123,134,.28)';
          if (O.mode === 'visible') g.fillRect(x1 - len, y, len, Math.max(1, rowH - (rowH > 3 ? 1 : 0)));
          else g.fillRect(x0, y, len, Math.max(1, rowH - (rowH > 3 ? 1 : 0)));
        }
      }
      const line = (price, color, dash, from, to, label) => {
        const y = Y(price); if (y === null || from === null) return;
        const a = Math.max(0, from), b = Math.min(w, to ?? w); if (b <= a) return;
        g.strokeStyle = color; g.lineWidth = 1; g.setLineDash(dash); g.beginPath(); g.moveTo(a, y + 0.5); g.lineTo(b, y + 0.5); g.stroke(); g.setLineDash([]);
        if (label && b - a > 64) { g.fillStyle = color; g.textAlign = 'right'; g.fillText(label, b - 2, y - 6); }
      };
      const lx0 = O.mode === 'visible' ? x0 : x0, lx1 = O.mode === 'visible' ? x1 : x1;
      if (O.poc) line(p.poc, '#ff9800', [], lx0, lx1, `POC ${fmtP(p.poc, p.step)}`);
      if (O.va_lines) { line(p.vah, 'rgba(41,98,255,.9)', [4, 3], lx0, lx1, `VAH ${fmtP(p.vah, p.step)}`); line(p.val, 'rgba(41,98,255,.9)', [4, 3], lx0, lx1, `VAL ${fmtP(p.val, p.step)}`); }
      if (O.ib && O.mode !== 'visible' && p.ibH !== null) { const ibX1 = Math.min(x1, x0 + Math.max(1, Math.round(3600 / (p.tf || 3600))) * bs); line(p.ibH, 'rgba(178,181,190,.8)', [1, 3], x0, ibX1, ''); line(p.ibL, 'rgba(178,181,190,.8)', [1, 3], x0, ibX1, ''); }
      // naked POC: extended to the right until price trades through it
      if (O.naked && O.mode !== 'visible' && !p.forming) {
        const end = p.touched ? X(p.touched) : w;
        if (end === null) continue;
        if (end > x1) line(p.poc, 'rgba(255,152,0,.55)', [6, 4], x1, end, p.touched ? '' : `nPOC ${fmtP(p.poc, p.step)}`);
      }
    }
    g.restore();
  }

  // ───────── toolbar toggle + settings ─────────
  let btn = null;
  const scale = document.getElementById('scaleBtn');
  if (scale && !A.EMBED) {
    const dd = scale.closest('.tb-dd');
    btn = document.createElement('button'); btn.className = 'tb-btn icon' + (O.on ? ' on' : ''); btn.id = 'profileBtn';
    btn.title = 'Market Profile (TPO): POC, Value Area, IB по дням и сессиям\nПравый клик — настройки';
    btn.innerHTML = '<svg viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 3v12M3 5h5M3 7.5h9M3 10h12M3 12.5h7M3 15h3"/></svg>';
    btn.onclick = () => { O.on = !O.on; save(); cache = null; requestDraw(); };
    btn.oncontextmenu = e => { e.preventDefault(); openSettings(); };
    (dd || scale).after(btn);
  }
  function openSettings() {
    const ov = document.createElement('div'); ov.className = 'ind-ov';
    const dlg = document.createElement('div'); dlg.className = 'ind-dlg pf-dlg'; ov.appendChild(dlg); document.body.appendChild(ov);
    const before = { ...O };
    const opt = (k, v, cur) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${k}</option>`;
    const chk = (id, label) => `<label class="ind-bool"><input type="checkbox" data-k="${id}" ${O[id] ? 'checked' : ''}><span>${label}</span></label>`;
    dlg.innerHTML = `<div class="ind-h"><b>Market Profile</b><button class="ind-x" title="Закрыть (Esc)">✕</button></div>
      <div class="ind-b">
        <div class="ind-row"><label class="ind-bool"><input type="checkbox" data-k="on" ${O.on ? 'checked' : ''}><span>Показывать на графике</span></label></div>
        <div class="ind-grp">Расчёт</div>
        <div class="ind-row"><span class="ind-lbl">Профиль за</span><span class="sp"></span><select data-k="mode">${opt(T('день (UTC)'), 'day', O.mode)}${opt(T('сессию: Азия / Лондон / Нью-Йорк'), 'session', O.mode)}${opt(T('неделю'), 'week', O.mode)}${opt(T('видимый диапазон'), 'visible', O.mode)}</select></div>
        <div class="ind-row"><span class="ind-lbl">Считать</span><span class="sp"></span><select data-k="basis">${opt(T('время (TPO, по 30 мин)'), 'tpo', O.basis)}${opt(T('объём'), 'volume', O.basis)}</select></div>
        <div class="ind-row"><span class="ind-lbl">Шаг цены (0 — авто)</span><span class="sp"></span><input type="text" class="ind-num" data-k="step" value="${O.step}"></div>
        <div class="ind-row"><span class="ind-lbl">Value Area, %</span><span class="sp"></span><input type="text" class="ind-num" data-k="va" value="${O.va}"></div>
        <div class="ind-row"><span class="ind-lbl">Сколько последних профилей</span><span class="sp"></span><input type="text" class="ind-num" data-k="last" value="${O.last}"></div>
        <div class="ind-row"><span class="ind-lbl">Ширина гистограммы, % сессии</span><span class="sp"></span><input type="text" class="ind-num" data-k="width" value="${O.width}"></div>
        <div class="ind-grp">Показывать</div>
        <div class="ind-row">${chk('hist', 'Гистограмму')}</div>
        <div class="ind-row">${chk('poc', 'POC — цена с наибольшим временем / объёмом')}</div>
        <div class="ind-row">${chk('va_lines', 'VAH / VAL — границы Value Area')}</div>
        <div class="ind-row">${chk('ib', 'IB — диапазон первого часа')}</div>
        <div class="ind-row">${chk('naked', '«Голые» POC — до первого касания ценой')}</div>
        <div class="vd-hint">TPO: каждые 30 минут цена «отмечается» на всех уровнях, где побывала; на H1 и выше — каждый бар. Value Area — область вокруг POC, где прошла заданная доля времени (обычно 70%). Для MT5 (форекс, металлы) объём тиковый.</div>
      </div>
      <div class="ind-f"><button class="ind-btn" data-a="reset">По умолчанию</button><span class="sp"></span><button class="ind-btn" data-a="cancel">Отмена</button><button class="ind-btn pri" data-a="ok">ОК</button></div>`;
    const apply = () => {
      dlg.querySelectorAll('[data-k]').forEach(el => { const k = el.dataset.k; O[k] = el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' ? el.value : (parseFloat(String(el.value).replace(',', '.')) || 0); });
      cache = null; requestDraw();
    };
    dlg.addEventListener('input', apply); dlg.addEventListener('change', apply);
    const close = keep => { document.removeEventListener('keydown', onKey, true); ov.remove(); if (keep) save(); else { Object.assign(O, before); cache = null; requestDraw(); } };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(false); } else if (e.key === 'Enter') { e.preventDefault(); close(true); } };
    document.addEventListener('keydown', onKey, true);
    dlg.querySelector('.ind-x').onclick = () => close(false);
    dlg.querySelector('[data-a="cancel"]').onclick = () => close(false);
    dlg.querySelector('[data-a="ok"]').onclick = () => close(true);
    dlg.querySelector('[data-a="reset"]').onclick = () => { Object.assign(O, DEF, { on: true }); close(true); openSettings(); };
    ov.addEventListener('mousedown', e => { if (e.target === ov) close(true); });
  }
  window.QLProfile = { openSettings, toggle() { O.on = !O.on; save(); cache = null; requestDraw(); }, get on() { return O.on; }, current: () => profiles() };
  requestDraw();
})();
