/* Pandich Lab — multi-chart layouts (1/2/3/4/6/8) with symbol / interval / crosshair / time sync.
   Extra cells are this page in an iframe (?cell=N&mc=<tab id>): each cell is a full chart with its own symbol, TF,
   chart type and scripts. Sync messages go over BroadcastChannel('ql.sync') (see app.js); live data for all cells
   goes through the main window's single SSE connection (QLHub). */
(() => {
'use strict';
const A = window.QLApp; if (!A || A.EMBED) return;
const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
const LAYOUTS = {
  '1': { n: 1, areas: '"a"', name: '1 график' },
  '2h': { n: 2, areas: '"a b"', name: '2 — рядом' },
  '2v': { n: 2, areas: '"a" "b"', name: '2 — друг под другом' },
  '3': { n: 3, areas: '"a b" "a c"', name: '3 — один большой' },
  '4': { n: 4, areas: '"a b" "c d"', name: '4 — сетка 2×2' },
  '6': { n: 6, areas: '"a b c" "d e f"', name: '6 — сетка 3×2' },
  '8': { n: 8, areas: '"a b c d" "e f g h"', name: '8 — сетка 4×2' },
};
const SYNC = [['symbol', 'Символ'], ['interval', 'Интервал'], ['cross', 'Перекрестие'], ['time', 'Время (прокрутка)']];
const AREA = 'abcdefgh';
const grid = $('mcGrid'), main = $('chartWrap');

function icon(id) { // tiny schematic of the layout
  const L = LAYOUTS[id]; const rows = L.areas.split('" "').map(r => r.replace(/"/g, '').split(' '));
  const R = rows.length, C = rows[0].length, W = 22, H = 16, cells = {};
  rows.forEach((r, y) => r.forEach((a, x) => { const c = cells[a] || (cells[a] = { x0: x, y0: y, x1: x, y1: y }); c.x1 = Math.max(c.x1, x); c.y1 = Math.max(c.y1, y); }));
  const rects = Object.values(cells).map(c => `<rect x="${1 + c.x0 * W / C}" y="${1 + c.y0 * H / R}" width="${(c.x1 - c.x0 + 1) * W / C - 2}" height="${(c.y1 - c.y0 + 1) * H / R - 2}" rx="1.5"/>`).join('');
  return `<svg viewBox="0 0 24 18" width="24" height="18" fill="none" stroke="currentColor" stroke-width="1.2">${rects}</svg>`;
}

function apply() {
  const cfg = A.mcCfg(); const L = LAYOUTS[cfg.layout] || LAYOUTS['1'];
  grid.dataset.layout = cfg.layout;
  grid.style.gridTemplateAreas = L.areas;
  const cols = L.areas.split('" "')[0].replace(/"/g, '').split(' ').length, rows = L.areas.split('" "').length;
  grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  grid.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
  main.style.gridArea = 'a';
  const have = [...grid.querySelectorAll('.mc-cell')];
  for (const el of have) if (+el.dataset.cell >= L.n) el.remove(); // removing the iframe fires its pagehide → unsubscribes
  for (let k = 1; k < L.n; k++) {
    let el = grid.querySelector(`.mc-cell[data-cell="${k}"]`);
    if (!el) {
      el = document.createElement('div'); el.className = 'mc-cell'; el.dataset.cell = k;
      el.innerHTML = `<iframe src="/?cell=${k}&mc=${encodeURIComponent(A.MC_ID)}" title="График ${k + 1}"></iframe>`;
      grid.appendChild(el);
    }
    el.style.gridArea = AREA[k];
  }
  $('layoutBtn').classList.toggle('on', L.n > 1);
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
}

function render() {
  const cfg = A.mcCfg();
  $('layoutPop').innerHTML = '<div class="pm-h">Раскладка</div><div class="mc-lays">' +
    Object.keys(LAYOUTS).map(id => `<button data-l="${id}" class="${cfg.layout === id ? 'on' : ''}" title="${LAYOUTS[id].name}">${icon(id)}</button>`).join('') +
    '</div><div class="pm-sep"></div><div class="pm-h">Синхронизировать между графиками</div>' +
    SYNC.map(([k, n]) => `<button data-s="${k}"><span class="chk ${cfg.sync[k] ? 'on' : ''}"></span>${n}</button>`).join('') +
    '<div class="pm-sep"></div><div class="pm-empty">Каждый график — свой символ, ТФ, тип и скрипты. Panda и Pine-редактор работают с первым (левым верхним).</div>';
  $('layoutPop').querySelectorAll('[data-l]').forEach(b => b.onclick = () => { store.set('ql.mc', { ...A.mcCfg(), layout: b.dataset.l }); apply(); render(); });
  $('layoutPop').querySelectorAll('[data-s]').forEach(b => b.onclick = () => {
    const c = A.mcCfg(); c.sync[b.dataset.s] = !c.sync[b.dataset.s]; store.set('ql.mc', c); render();
  });
}

$('layoutBtn').onclick = e => {
  e.stopPropagation();
  const p = $('layoutPop'); const was = p.classList.contains('hidden');
  for (const id of ['tfPop', 'ctypePop', 'scalePop']) { const x = $(id); if (x) x.classList.add('hidden'); }
  p.classList.toggle('hidden', !was); if (was) render();
};
document.addEventListener('click', e => { if (e.target.isConnected && !e.target.closest('#layoutPop') && !e.target.closest('#layoutBtn')) $('layoutPop').classList.add('hidden'); });
apply();
window.QLMulti = { apply, layouts: Object.keys(LAYOUTS) };
})();
