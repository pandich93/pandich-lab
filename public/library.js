/* Pandich Lab — Indicators library (built-in catalog, my scripts, favourites, indicator templates) and chart layouts
   (save/restore everything: symbols, TFs, chart types, scripts of every cell, multi-chart layout + sync). */
(() => {
'use strict';
const A = window.QLApp; if (!A || A.EMBED) return;
const S = A.S, api = A.api, esc = A.esc;
const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
const IC = {
  star: on => `<svg viewBox="0 0 16 16" width="14" height="14" fill="${on ? '#f7a600' : 'none'}" stroke="${on ? '#f7a600' : 'currentColor'}" stroke-width="1.3" stroke-linejoin="round"><path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"/></svg>`,
  code: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M5.5 4L2 8l3.5 4M10.5 4L14 8l-3.5 4"/></svg>',
  trash: '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.8 9h5.4l.8-9"/></svg>',
  layouts: '<svg viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><rect x="2.5" y="3" width="13" height="12" rx="1.5"/><path d="M2.5 6.5h13M7 6.5V15"/></svg>',
};

// ═════════ Indicators library modal ═════════
const modal = document.createElement('div'); modal.className = 'lib-modal hidden'; modal.id = 'libModal';
modal.innerHTML = `<div class="lib-box">
  <div class="lib-top"><b>Индикаторы и стратегии</b><div class="lib-search"><svg viewBox="0 0 18 18" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="8" r="5.5"/><path d="M12.2 12.2L16 16"/></svg><input id="libQ" placeholder="Поиск" autocomplete="off"></div><button class="lib-x" id="libX">✕</button></div>
  <div class="lib-main"><nav class="lib-nav" id="libNav"></nav><div class="lib-list" id="libList"></div></div>
  <div class="lib-foot"><button class="btn" id="libNew">＋ Новый пустой скрипт</button><span class="muted">Клик — добавить на график · ⟨/⟩ — открыть в редакторе · <b>/</b> — открыть это окно</span></div>
</div>`;
document.body.appendChild(modal);
const L = { tab: 'builtin', cat: null, q: '', builtin: [], mine: [], templates: [], busy: false };
const favs = () => store.get('ql.lib.fav', []);
const isFav = k => favs().includes(k);
function toggleFav(k) { const f = favs(); store.set('ql.lib.fav', f.includes(k) ? f.filter(x => x !== k) : f.concat(k)); render(); }

async function openLib(tab) {
  if (tab) L.tab = tab;
  modal.classList.remove('hidden'); $('libQ').value = L.q; render(); setTimeout(() => $('libQ').focus(), 0);
  try { [L.builtin, L.mine, L.templates] = await Promise.all([api('/api/library'), api('/api/scripts'), api('/api/templates')]); } catch (e) { A.log('Библиотека: ' + e.message, 'error'); }
  render();
}
function closeLib() { modal.classList.add('hidden'); }
function items() {
  const q = L.q.trim().toLowerCase();
  const m = x => !q || (x.name + ' ' + (x.desc || '') + ' ' + (x.category || '') + ' ' + (x.tags || '') + ' ' + (x.file || '')).toLowerCase().includes(q);
  const B = L.builtin.map(x => ({ key: 'b:' + x.file, kind: 'builtin', ...x }));
  const U = L.mine.map(x => ({ key: 'u:' + x.file, kind: 'mine', category: 'Мои скрипты', desc: 'сохранён ' + x.time.slice(0, 16).replace('T', ' '), ...x }));
  if (q) return B.concat(U).filter(m); // search covers everything
  if (L.tab === 'builtin') return B.filter(x => !L.cat || x.category === L.cat);
  if (L.tab === 'mine') return U;
  if (L.tab === 'fav') { const f = favs(); return B.concat(U).filter(x => f.includes(x.key)); }
  return [];
}
function render() {
  const cats = [...new Set(L.builtin.map(x => x.category))];
  $('libNav').innerHTML = [
    ['builtin', 'Встроенные', L.builtin.length], ...cats.map(c => ['cat:' + c, c, L.builtin.filter(x => x.category === c).length]),
    ['mine', 'Мои скрипты', L.mine.length], ['fav', 'Избранное', favs().length], ['tpl', 'Шаблоны индикаторов', L.templates.length],
  ].map(([id, n, c]) => {
    const on = id.startsWith('cat:') ? (L.tab === 'builtin' && L.cat === id.slice(4)) : (L.tab === id && !(id === 'builtin' && L.cat));
    return `<button class="${on ? 'on' : ''} ${id.startsWith('cat:') ? 'sub' : ''}" data-nav="${esc(id)}">${esc(n)}<span>${c || ''}</span></button>`;
  }).join('');
  $('libNav').querySelectorAll('[data-nav]').forEach(b => b.onclick = () => {
    const id = b.dataset.nav; L.q = ''; $('libQ').value = '';
    if (id.startsWith('cat:')) { L.tab = 'builtin'; L.cat = id.slice(4); } else { L.tab = id; L.cat = null; }
    render();
  });
  const list = $('libList');
  if (L.tab === 'tpl' && !L.q) { list.innerHTML = tplHTML(); wireTpl(); return; }
  const its = items();
  const onChart = new Set(S.scripts.map(s => s.name));
  list.innerHTML = its.length ? its.map(x => `<div class="lib-row" data-key="${esc(x.key)}">
      <button class="lib-star" data-star="${esc(x.key)}" title="Избранное">${IC.star(isFav(x.key))}</button>
      <div class="lib-txt"><div><b>${esc(x.name)}</b>${onChart.has(x.name) ? '<span class="lib-tag on">на графике</span>' : ''}${L.q || L.tab === 'fav' ? `<span class="lib-tag">${esc(x.category)}</span>` : ''}</div><div class="muted">${esc(x.desc || '')}</div></div>
      <button class="lib-ib" data-edit="${esc(x.key)}" title="Добавить и открыть в Pine-редакторе">${IC.code}</button>
      ${x.kind === 'mine' ? `<button class="lib-ib danger" data-del="${esc(x.key)}" title="Удалить файл (переносится в scripts/_deleted)">${IC.trash}</button>` : ''}
    </div>`).join('') : `<div class="lib-empty">${L.tab === 'mine' ? 'Сохранённых скриптов нет — сохрани скрипт в Pine-редакторе (Ctrl+S) или попроси Panda.' : L.tab === 'fav' ? 'Отмечай звёздочкой то, чем пользуешься чаще всего.' : 'Ничего не найдено.'}</div>`;
  list.querySelectorAll('.lib-row').forEach(r => r.onclick = e => { if (e.target.closest('button')) return; addByKey(r.dataset.key, false); });
  list.querySelectorAll('[data-star]').forEach(b => b.onclick = () => toggleFav(b.dataset.star));
  list.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => addByKey(b.dataset.edit, true));
  list.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    const f = b.dataset.del.slice(2); if (!window.confirm(`Удалить «${f}»? Файл будет перенесён в scripts/_deleted.`)) return; // eslint-disable-line no-alert
    await api('/api/scripts/delete', { file: f }); L.mine = await api('/api/scripts'); render();
  });
}
async function codeFor(key) {
  const r = await api((key.startsWith('b:') ? '/api/library/file?f=' : '/api/scripts/file?f=') + encodeURIComponent(key.slice(2)));
  if (!r || !r.code) throw new Error('не удалось загрузить скрипт');
  return r.code;
}
async function addScript(name, code, inputs = {}, visible = true) {
  const s = { id: A.newId(), name, code, inputs, visible, result: null, error: null };
  S.scripts.push(s); A.saveScripts();
  if (visible) await A.runScript(s);
  A.renderAll();
  return s;
}
async function addByKey(key, edit) {
  if (L.busy) return; L.busy = true;
  try {
    const all = L.builtin.map(x => ['b:' + x.file, x.name]).concat(L.mine.map(x => ['u:' + x.file, x.name]));
    const name = (all.find(x => x[0] === key) || [0, 'Скрипт'])[1];
    const s = await addScript(name, await codeFor(key));
    closeLib();
    if (s.error) A.log(`${s.name}: ${s.error}`, 'error');
    if (edit || s.error) window.QLPanels && window.QLPanels.openEditor(s.id);
  } catch (e) { A.log('Библиотека: ' + e.message, 'error'); }
  finally { L.busy = false; }
}

// ───── indicator templates (server: data/templates.json) ─────
function tplHTML() {
  return `<div class="lib-tpl-save"><input id="tplName" placeholder="Название шаблона, напр. «Золото: структура + сессии»"><button class="btn primary" id="tplSave" ${S.scripts.length ? '' : 'disabled'}>Сохранить текущие (${S.scripts.length})</button></div>
    <div class="muted lib-hint">Шаблон — набор индикаторов с настройками. «Применить» заменяет индикаторы на графике, «＋» добавляет к текущим.</div>` +
    (L.templates.length ? L.templates.map(t => `<div class="lib-row tpl" data-id="${t.id}">
      <div class="lib-txt"><div><b>${esc(t.name)}</b></div><div class="muted">${esc((t.data.scripts || []).map(s => s.name).join(' · '))}</div></div>
      <button class="btn" data-apply="${t.id}">Применить</button><button class="lib-ib" data-addt="${t.id}" title="Добавить к текущим">＋</button><button class="lib-ib danger" data-delt="${t.id}" title="Удалить шаблон">${IC.trash}</button>
    </div>`).join('') : '<div class="lib-empty">Шаблонов пока нет.</div>');
}
function wireTpl() {
  $('tplSave').onclick = async () => {
    const name = $('tplName').value.trim() || `Шаблон ${new Date().toISOString().slice(0, 10)}`;
    const data = { scripts: S.scripts.map(({ name, code, inputs, visible }) => ({ name, code, inputs: inputs || {}, visible: visible !== false })) };
    const r = await api('/api/templates/save', { name, data }); if (!r.ok) { A.log('Шаблон: ' + r.error, 'error'); return; }
    L.templates = await api('/api/templates'); render();
  };
  const apply = async (id, replace) => {
    const t = L.templates.find(x => x.id === id); if (!t) return;
    if (replace) { S.scripts.length = 0; }
    for (const s of t.data.scripts || []) await addScript(s.name, s.code, s.inputs || {}, s.visible !== false);
    A.saveScripts(); closeLib(); A.log(`Шаблон «${t.name}» ${replace ? 'применён' : 'добавлен'}`);
  };
  $('libList').querySelectorAll('[data-apply]').forEach(b => b.onclick = () => apply(b.dataset.apply, true));
  $('libList').querySelectorAll('[data-addt]').forEach(b => b.onclick = () => apply(b.dataset.addt, false));
  $('libList').querySelectorAll('[data-delt]').forEach(b => b.onclick = async () => { if (!window.confirm('Удалить шаблон?')) return; await api('/api/templates/delete', { id: b.dataset.delt }); L.templates = await api('/api/templates'); render(); }); // eslint-disable-line no-alert
}

$('libQ').oninput = e => { L.q = e.target.value; render(); };
$('libQ').onkeydown = e => { if (e.key === 'Escape') closeLib(); if (e.key === 'Enter') { const r = $('libList').querySelector('.lib-row[data-key]'); if (r) addByKey(r.dataset.key, false); } e.stopPropagation(); };
$('libX').onclick = closeLib;
$('libNew').onclick = () => { closeLib(); window.QLPanels && window.QLPanels.newScript(); };
modal.addEventListener('mousedown', e => { if (e.target === modal) closeLib(); });
const addBtn = $('addScriptBtn'); if (addBtn) { addBtn.textContent = 'ƒ Индикаторы'; addBtn.title = 'Библиотека индикаторов, мои скрипты, шаблоны ( / )'; addBtn.onclick = () => openLib(); }
// "/" opens the library (capture phase: before the letter → symbol-search hotkey)
window.addEventListener('keydown', e => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target, tag = (t && t.tagName) || '';
  if (/INPUT|TEXTAREA|SELECT/.test(tag) || (t && t.isContentEditable) || document.querySelector('.modal:not(.hidden),.ss-modal:not(.hidden),.lib-modal:not(.hidden),.rp-modal')) return;
  e.preventDefault(); e.stopImmediatePropagation(); openLib();
}, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeLib(); });

// ═════════ Chart layouts (server: data/layouts.json) ═════════
const KEY_RE = /^ql\.(?:c\d+\.)?(symbol|interval|limit|ctype|scale|scripts)$|^ql\.mc$/;
function snapshot() {
  A.saveScripts();
  const keys = {};
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (KEY_RE.test(k)) { try { keys[k] = JSON.parse(localStorage.getItem(k)); } catch { /* skip */ } } }
  const mc = A.mcCfg(); const n = { '1': 1, '2h': 2, '2v': 2, '3': 3, '4': 4, '6': 6, '8': 8 }[mc.layout] || 1;
  for (const k of Object.keys(keys)) { const m = /^ql\.c(\d+)\./.exec(k); if (m && +m[1] >= n) delete keys[k]; } // cells not in the layout
  const cells = [`${S.symbol} ${S.interval}`];
  for (let c = 1; c < n; c++) cells.push(`${keys[`ql.c${c}.symbol`] || S.symbol} ${keys[`ql.c${c}.interval`] || S.interval}`);
  return { v: 1, keys, summary: `${n > 1 ? n + ' графика(ов): ' : ''}${cells.join(' · ')} · скриптов: ${S.scripts.length}` };
}
function applySnapshot(data) {
  const drop = [];
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (KEY_RE.test(k)) drop.push(k); }
  for (const k of drop) localStorage.removeItem(k);
  for (const [k, v] of Object.entries(data.keys || {})) if (KEY_RE.test(k)) store.set(k, v);
  location.reload();
}
const host = document.createElement('div'); host.className = 'tb-dd mc-only';
host.innerHTML = `<button class="tb-btn icon" id="layoutsBtn" title="Макеты: сохранить / загрузить весь экран">${IC.layouts}</button><div class="popmenu hidden lay-pop" id="laysPop"></div>`;
($('replayBtn') ? $('replayBtn').parentElement : $('layoutBtn').parentElement).after(host);
let lays = [];
async function renderLays() {
  const p = $('laysPop');
  p.innerHTML = '<div class="pm-h">Макеты</div><div class="pm-empty">загрузка…</div>';
  try { lays = await api('/api/layouts'); } catch { lays = []; }
  const cur = store.get('ql.layout.current', null);
  p.innerHTML = `<div class="pm-h">Сохранить текущий экран</div>
    <div class="lay-save"><input id="layName" placeholder="Название, напр. «Золото M5–H4»" value="${esc(cur && lays.some(l => l.id === cur.id) ? cur.name : '')}"><button class="btn primary" id="laySave">Сохранить</button></div>
    <div class="pm-sep"></div><div class="pm-h">Загрузить</div>` +
    (lays.length ? lays.sort((a, b) => b.updated - a.updated).map(l => `<div class="lay-row ${cur && cur.id === l.id ? 'on' : ''}" data-id="${l.id}"><div class="lib-txt"><b>${esc(l.name)}</b><div class="muted">${esc(l.data.summary || '')}</div></div><button class="lib-ib danger" data-dl="${l.id}" title="Удалить макет">${IC.trash}</button></div>`).join('')
      : '<div class="pm-empty">Сохранённых макетов нет. Макет запоминает символы, ТФ, типы графиков, индикаторы с настройками во всех ячейках и раскладку мульти-графика.</div>');
  $('laySave').onclick = async () => {
    const name = $('layName').value.trim(); if (!name) { $('layName').focus(); return; }
    const r = await api('/api/layouts/save', { name, data: snapshot() });
    if (!r.ok) { A.log('Макет: ' + r.error, 'error'); return; }
    store.set('ql.layout.current', { id: r.item.id, name: r.item.name }); A.log(`Макет «${r.item.name}» сохранён`); renderLays();
  };
  $('layName').onkeydown = e => { if (e.key === 'Enter') $('laySave').click(); e.stopPropagation(); };
  p.querySelectorAll('.lay-row').forEach(r => r.onclick = async e => {
    if (e.target.closest('[data-dl]')) return;
    const it = await api('/api/layouts/get?id=' + encodeURIComponent(r.dataset.id)); if (!it || !it.data) return;
    store.set('ql.layout.current', { id: it.id, name: it.name }); applySnapshot(it.data);
  });
  p.querySelectorAll('[data-dl]').forEach(b => b.onclick = async () => { if (!window.confirm('Удалить макет?')) return; await api('/api/layouts/delete', { id: b.dataset.dl }); renderLays(); }); // eslint-disable-line no-alert
}
$('layoutsBtn').onclick = e => {
  e.stopPropagation();
  const p = $('laysPop'); const was = p.classList.contains('hidden');
  for (const id of ['tfPop', 'ctypePop', 'scalePop', 'layoutPop']) { const x = $(id); if (x) x.classList.add('hidden'); }
  p.classList.toggle('hidden', !was); if (was) renderLays();
};
document.addEventListener('click', e => { if (e.target.isConnected && !e.target.closest('#laysPop') && !e.target.closest('#layoutsBtn')) $('laysPop').classList.add('hidden'); });

window.QLLibrary = { open: openLib, close: closeLib, addScript, snapshot, applySnapshot };
})();
