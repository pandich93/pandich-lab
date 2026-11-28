/* Pandich Lab — right panel rail: Pine editor (Monaco), Object tree, Data window.
   Click a rail icon = replace open panels; Shift+click = open alongside; click an open one = close. */
(() => {
'use strict';
const A = window.QLApp, $ = id => document.getElementById(id);
if (!A) { console.error('[panels] QLApp missing'); return; }
const { S, api, esc, fmt, log } = A;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
const SV = (b) => `<svg viewBox="0 0 18 18" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${b}</svg>`;
const IC = {
  bell: SV('<path d="M5 13V8.5a4 4 0 018 0V13l1.5 1.5h-11zM7.5 15.5a1.6 1.6 0 003 0"/>'),
  editor: SV('<path d="M6 5L2 9l4 4M12 5l4 4-4 4"/>'),
  tree: SV('<path d="M9 2l7 4-7 4-7-4z"/><path d="M2 9.5l7 4 7-4M2 13l7 4 7-4"/>'),
  data: SV('<path d="M3 3l5 11 1.6-4.4L14 8z"/><path d="M12 13h4M12 16h4M14 10.5h2"/>'),
  run: '<svg viewBox="0 0 12 12" width="11" height="11"><path d="M3 2l7 4-7 4z" fill="currentColor"/></svg>',
  copy: SV('<rect x="6" y="6" width="9" height="9" rx="1.5"/><path d="M12 6V3.5A1.5 1.5 0 0010.5 2h-7A1.5 1.5 0 002 3.5v7A1.5 1.5 0 003.5 12H6"/>'),
  save: SV('<path d="M3 3h9l3 3v9H3z"/><path d="M6 3v4h5V3M6 15v-5h6v5"/>'),
  hist: SV('<path d="M2.5 9a6.5 6.5 0 102-4.7M2.5 2.5V5H5"/><path d="M9 5.5V9l2.5 1.5"/>'),
  quant: SV('<path d="M9 2l1.6 4.4L15 8l-4.4 1.6L9 14l-1.6-4.4L3 8l4.4-1.6z"/>'),
  max: SV('<path d="M2 6V2h4M12 2h4v4M16 12v4h-4M6 16H2v-4"/>'),
  more: SV('<circle cx="9" cy="4" r=".9" fill="currentColor"/><circle cx="9" cy="9" r=".9" fill="currentColor"/><circle cx="9" cy="14" r=".9" fill="currentColor"/>'),
  close: SV('<path d="M4 4l10 10M14 4L4 14"/>'),
  eye: SV('<path d="M1.5 9S4.5 4 9 4s7.5 5 7.5 5-3 5-7.5 5S1.5 9 1.5 9z"/><circle cx="9" cy="9" r="2"/>'),
  eyeOff: SV('<path d="M2 2l14 14M7.5 4.2A7.6 7.6 0 019 4c4.5 0 7.5 5 7.5 5a12 12 0 01-2.2 2.7M5 5.5A12.6 12.6 0 001.5 9S4.5 14 9 14a7 7 0 003-.7"/>'),
  lock: SV('<rect x="4" y="8" width="10" height="7.5" rx="1"/><path d="M6 8V5.5a3 3 0 016 0V8"/>'),
  unlock: SV('<rect x="4" y="8" width="10" height="7.5" rx="1"/><path d="M6 8V5.5a3 3 0 015.6-1.5"/>'),
  gear: SV('<circle cx="9" cy="9" r="2.3"/><path d="M9 1.8v2M9 14.2v2M1.8 9h2M14.2 9h2M3.9 3.9l1.4 1.4M12.7 12.7l1.4 1.4M3.9 14.1l1.4-1.4M12.7 5.3l1.4-1.4"/>'),
  trash: SV('<path d="M3 5h12M7 5V3h4v2M5 5l1 11h6l1-11"/>'),
  chev: '<svg viewBox="0 0 10 10" width="9" height="9"><path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
};
const PANELS = [
  { id: 'editor', title: 'Pine-редактор', icon: IC.editor, width: 560 },
  { id: 'tree', title: 'Дерево объектов', icon: IC.tree, width: 300 },
  { id: 'data', title: 'Окно данных', icon: IC.data, width: 280 },
  { id: 'watch', title: 'Watch — сигналы', icon: IC.bell, width: 360 },
];
const P = Object.fromEntries(PANELS.map(p => [p.id, p]));
const EMBED = document.body.classList.contains('embed'); // multi-chart cell: no side panels
let open = EMBED ? [] : (store.get('ql.panels.open', []) || []).filter(id => P[id]);
const widths = store.get('ql.panels.w', {}) || {};
const host = $('rpanels'), rail = $('rail'), els = {};

// ───────── rail + layout ─────────
function renderRail() {
  rail.innerHTML = PANELS.map(p => `<button class="rbtn ${open.includes(p.id) ? 'on' : ''}" data-id="${p.id}" title="${p.title}${'\n'}Shift+клик — открыть рядом с остальными">${p.icon}</button>`).join('');
  rail.querySelectorAll('.rbtn').forEach(b => b.onclick = e => toggle(b.dataset.id, e.shiftKey));
}
function toggle(id, stack) {
  if (open.includes(id)) open = open.filter(x => x !== id);
  else open = stack ? open.concat(id) : [id];
  applyLayout();
}
function show(id, stack = false) { if (!open.includes(id)) { open = stack ? open.concat(id) : [id]; applyLayout(); } }
function applyLayout() {
  if (!EMBED) store.set('ql.panels.open', open);
  for (const p of PANELS) {
    const el = ensurePanel(p.id);
    const vis = open.includes(p.id);
    el.style.display = vis ? 'flex' : 'none';
    el.style.width = (widths[p.id] || p.width) + 'px';
    if (vis) host.appendChild(el); // keep DOM order = open order
  }
  host.classList.toggle('empty', !open.length);
  document.querySelector('.chart-row').classList.toggle('editor-max', open.includes('editor') && els.editor.classList.contains('max'));
  renderRail();
  if (open.includes('editor')) initEditor();
  if (open.includes('tree')) renderTree();
  if (open.includes('data')) renderData();
  for (const id of open) if (!['editor', 'tree', 'data'].includes(id)) window.dispatchEvent(new CustomEvent('ql:panel', { detail: { id, el: els[id], body: els[id].querySelector('[data-body]') } }));
}
function ensurePanel(id) {
  if (els[id]) return els[id];
  const el = document.createElement('div'); el.className = 'rpanel'; el.dataset.panel = id;
  el.innerHTML = `<div class="rp-resize" title="Потяните, чтобы изменить ширину. Двойной клик — сброс"></div>` + (id === 'editor' ? editorHTML() : `<div class="rp-head"><b>${P[id].title}</b><div class="spacer"></div><button class="rp-ib" data-close title="Закрыть">${IC.close}</button></div><div class="rp-body" data-body></div>`);
  els[id] = el;
  el.querySelector('[data-close]')?.addEventListener('click', () => toggle(id));
  // resize from the left edge
  const grip = el.querySelector('.rp-resize');
  grip.addEventListener('pointerdown', e => {
    e.preventDefault(); grip.setPointerCapture(e.pointerId);
    const startX = e.clientX, startW = el.offsetWidth;
    const move = ev => { const w = Math.max(220, Math.min(window.innerWidth * 0.75, startW + (startX - ev.clientX))); el.style.width = w + 'px'; };
    const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); widths[id] = el.offsetWidth; store.set('ql.panels.w', widths); };
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up);
  });
  grip.addEventListener('dblclick', () => { delete widths[id]; store.set('ql.panels.w', widths); el.style.width = P[id].width + 'px'; });
  if (id === 'editor') wireEditor(el);
  window.dispatchEvent(new CustomEvent('ql:panel', { detail: { id, el, body: el.querySelector('[data-body]') } }));
  return el;
}

// ───────── Pine editor ─────────
const TEMPLATE = '//@version=6\nindicator("Мой скрипт", overlay = true)\n\nlen = input.int(20, "Период", minval = 1)\nplot(ta.ema(close, len), "EMA", color = color.orange, linewidth = 2)\n';
const E = { monaco: null, editor: null, linked: null, name: 'Мой скрипт', saved: false, versions: [], loading: false, pending: null };
function editorHTML() {
  return `<div class="rp-head ep-head">
      <button class="ep-name" id="epName" title="Открыть скрипт"><span id="epNameTxt">Мой скрипт</span> ${IC.chev}</button>
      <button class="ep-run" id="epRun" title="Ctrl+Enter">${IC.run}<span id="epRunTxt">Добавить на график</span></button>
      <span class="ep-sep"></span>
      <button class="rp-ib" id="epCopy" title="Копировать код">${IC.copy}</button>
      <button class="rp-ib" id="epSave" title="Сохранить (Ctrl+S)">${IC.save}</button>
      <button class="rp-ib" id="epHist" title="История версий">${IC.hist}</button>
      <button class="rp-ib" id="epAsk" title="Спросить Panda про выделенный код">${IC.quant}</button>
      <div class="spacer"></div>
      <button class="rp-ib" id="epMax" title="Развернуть">${IC.max}</button>
      <button class="rp-ib" id="epMore" title="Ещё">${IC.more}</button>
      <button class="rp-ib" data-close title="Закрыть">${IC.close}</button>
      <div class="popmenu hidden" id="epNameMenu"></div>
      <div class="popmenu hidden" id="epMoreMenu">
        <button data-act="new">Новый скрипт</button>
        <button data-act="rename">Переименовать</button>
        <button data-act="unlink">Отвязать от индикатора (следующий запуск — новая копия)</button>
        <button data-act="download">Скачать .pine</button>
      </div>
    </div>
    <div class="ep-editor" id="epEditor"><div class="ep-loading">Загрузка редактора…</div></div>
    <div class="ep-bottom" id="epBottom">
      <div class="ep-tabs">
        <button class="ep-collapse" id="epCollapse" title="Свернуть/развернуть">${IC.chev}</button>
        <button class="ep-tab on" data-tab="logs">Логи <span class="ep-count" id="epLogCount">0</span></button>
        <button class="ep-tab" data-tab="strat">Тестер стратегий</button>
        <div class="spacer"></div>
        <button class="ep-mini" id="epLogClear">очистить</button>
        <span class="ep-badge" id="epBadge">Pine v6 · PineTS</span>
      </div>
      <div class="ep-pane" data-pane="logs" id="epLogs"></div>
      <div class="ep-pane hidden" data-pane="strat" id="epStrat"></div>
    </div>`;
}
function wireEditor(el) {
  const q = sel => el.querySelector(sel);
  q('#epRun').onclick = runOrUpdate;
  q('#epCopy').onclick = () => { navigator.clipboard && navigator.clipboard.writeText(code()); flash(q('#epCopy')); };
  q('#epSave').onclick = () => saveScript();
  q('#epHist').onclick = openHistory;
  q('#epAsk').onclick = askQuant;
  q('#epMax').onclick = () => { el.classList.toggle('max'); applyLayout(); };
  q('#epName').onclick = e => { e.stopPropagation(); fillNameMenu(); q('#epNameMenu').classList.toggle('hidden'); q('#epMoreMenu').classList.add('hidden'); };
  q('#epMore').onclick = e => { e.stopPropagation(); q('#epMoreMenu').classList.toggle('hidden'); q('#epNameMenu').classList.add('hidden'); };
  q('#epMoreMenu').querySelectorAll('button').forEach(b => b.onclick = () => {
    q('#epMoreMenu').classList.add('hidden');
    if (b.dataset.act === 'new') newScript();
    if (b.dataset.act === 'rename') renameScript();
    if (b.dataset.act === 'unlink') { E.linked = null; updateRunButton(); log('Редактор отвязан: следующий запуск добавит новую копию', 'info', 'editor'); }
    if (b.dataset.act === 'download') { const blob = new Blob([code()], { type: 'text/plain' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = E.name.replace(/[^\wа-яА-ЯёЁ\- ]+/g, '').trim().replace(/\s+/g, '_') + '.pine'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
  });
  document.addEventListener('click', e => { if (!q('#epNameMenu').contains(e.target) && e.target !== q('#epName')) q('#epNameMenu').classList.add('hidden'); if (!q('#epMoreMenu').contains(e.target)) q('#epMoreMenu').classList.add('hidden'); });
  el.querySelectorAll('.ep-tab').forEach(t => t.onclick = () => { el.querySelectorAll('.ep-tab').forEach(x => x.classList.toggle('on', x === t)); el.querySelectorAll('.ep-pane').forEach(p => p.classList.toggle('hidden', p.dataset.pane !== t.dataset.tab)); q('#epBottom').classList.remove('collapsed'); });
  q('#epCollapse').onclick = () => q('#epBottom').classList.toggle('collapsed');
  q('#epLogClear').onclick = () => { S.logs.length = 0; renderLogs(); };
}
function flash(btn) { btn.classList.add('ok'); setTimeout(() => btn.classList.remove('ok'), 700); }
const code = () => E.editor ? E.editor.getValue() : (E.pending ?? '');
function setCode(text) { if (E.editor) { E.editor.setValue(text); E.monaco.editor.setModelMarkers(E.editor.getModel(), 'pine', []); } else E.pending = text; updateRunButton(); }
function setName(n) { E.name = n || 'Мой скрипт'; const t = $('epNameTxt'); if (t) t.textContent = E.name; }

function initEditor() {
  if (E.editor || E.loading) return;
  if (typeof window.require !== 'function') { $('epEditor').innerHTML = '<div class="ep-loading">Monaco не загрузился (нет /vendor/monaco). Запусти npm install.</div>'; return; }
  E.loading = true;
  window.require.config({ paths: { vs: '/vendor/monaco/vs' } });
  window.require(['vs/editor/editor.main'], async () => {
    const monaco = window.monaco; E.monaco = monaco;
    let meta = { namespaces: {} }; try { meta = await api('/api/pine/meta'); } catch { /* completions limited */ }
    registerPine(monaco, meta);
    $('epEditor').innerHTML = '';
    E.editor = monaco.editor.create($('epEditor'), {
      value: E.pending ?? TEMPLATE, language: 'pine', theme: 'pandich', automaticLayout: true, fontSize: 13, lineHeight: 20,
      fontFamily: 'Consolas, "JetBrains Mono", Menlo, monospace', minimap: { enabled: true, scale: 1, renderCharacters: false }, tabSize: 4, insertSpaces: true,
      scrollBeyondLastLine: false, renderLineHighlight: 'line', smoothScrolling: true, wordBasedSuggestions: 'off', quickSuggestions: { other: true, comments: false, strings: false },
      padding: { top: 8 }, fixedOverflowWidgets: true,
    });
    E.pending = null;
    E.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, runOrUpdate);
    E.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveScript());
    E.editor.onDidChangeModelContent(updateRunButton);
    $('epBadge').textContent = `Pine v6 · PineTS ${meta.version || ''}`;
    updateRunButton(); renderLogs(); renderStrategy();
  }, err => { $('epEditor').innerHTML = `<div class="ep-loading">Ошибка загрузки Monaco: ${esc(err && err.message || err)}</div>`; E.loading = false; });
}

function linkedScript() { return S.scripts.find(x => x.id === E.linked) || null; }
function updateRunButton() {
  const btn = $('epRun'); if (!btn) return;
  const s = linkedScript(); if (E.linked && !s) E.linked = null;
  $('epRunTxt').textContent = s ? 'Обновить' : 'Добавить на график';
  btn.disabled = !!s && code() === s.code && !s.error;
  btn.title = s ? `Обновить «${s.name}» на графике (Ctrl+Enter)` : 'Запустить как новый индикатор (Ctrl+Enter)';
}

async function runOrUpdate() {
  const src = code(); if (!src.trim()) return;
  const btn = $('epRun'); btn.disabled = true; btn.classList.add('busy');
  const s = linkedScript();
  try {
    const r = await api('/api/run', { code: src, symbol: S.symbol, interval: S.interval, limit: S.limit, inputs: s ? s.inputs || {} : {} });
    if (r.ok) {
      clearMarkers();
      for (const l of r.result.logs || []) log(l.text, l.level, r.result.title);
      if (s) {
        if (s.code !== src) pushVersion(s.code, 'до обновления');
        s.code = src; s.result = r.result; s.error = null; s.name = r.result.title || s.name; s.visible = true;
        log(`«${s.name}» обновлён на графике (${r.result.ms} мс)`, 'info', 'editor');
      } else {
        const ns = { id: A.newId(), name: r.result.title || E.name, code: src, inputs: {}, visible: true, result: r.result, error: null };
        S.scripts.push(ns); E.linked = ns.id;
        log(`«${ns.name}» добавлен на график (${r.result.ms} мс)`, 'info', 'editor');
      }
      pushVersion(src, 'запуск');
      setName(r.result.title || E.name);
      A.saveScripts(); A.renderAll();
    } else {
      for (const l of r.logs || []) log(l.text, l.level, E.name);
      log(`${r.error}${s ? ' — на графике осталась прежняя рабочая версия' : ''}`, 'error', 'editor');
      showError(r.error);
      switchTab('logs');
    }
  } finally { btn.classList.remove('busy'); updateRunButton(); }
}
function switchTab(id) { const el = els.editor; if (!el) return; el.querySelectorAll('.ep-tab').forEach(x => x.classList.toggle('on', x.dataset.tab === id)); el.querySelectorAll('.ep-pane').forEach(p => p.classList.toggle('hidden', p.dataset.pane !== id)); $('epBottom').classList.remove('collapsed'); }
function clearMarkers() { if (E.editor) E.monaco.editor.setModelMarkers(E.editor.getModel(), 'pine', []); }
// Map a PineTS error message to a code position
function showError(msg) {
  if (!E.editor) return;
  const model = E.editor.getModel(); const lines = model.getLineCount();
  let line = null, col = 1, endCol = null;
  let m = /at (\d+):(\d+)/.exec(msg) || /line (\d+)(?:[:, ]+col(?:umn)? (\d+))?/i.exec(msg);
  if (m) { line = +m[1]; col = +(m[2] || 1); }
  else {
    const t = /([A-Za-z_][\w.]*) is not (?:a function|defined)/.exec(msg) || /'([\w.]+)'/.exec(msg);
    if (t) {
      const tok = t[1];
      for (let i = 1; i <= lines; i++) { const c = model.getLineContent(i).indexOf(tok); if (c >= 0 && !/^\s*\/\//.test(model.getLineContent(i))) { line = i; col = c + 1; endCol = c + 1 + tok.length; break; } }
    }
  }
  if (!line) return;
  line = Math.max(1, Math.min(lines, line));
  if (!endCol) endCol = Math.max(col + 1, model.getLineMaxColumn(line));
  E.monaco.editor.setModelMarkers(model, 'pine', [{ startLineNumber: line, startColumn: col, endLineNumber: line, endColumn: endCol, message: msg, severity: E.monaco.MarkerSeverity.Error }]);
  E.editor.revealLineInCenter(line);
}

function pushVersion(src, label) {
  const last = E.versions[E.versions.length - 1];
  if (last && last.code === src) return;
  E.versions.push({ t: Date.now(), code: src, label, name: E.name });
  if (E.versions.length > 50) E.versions.shift();
}
function newScript() { E.linked = null; E.saved = false; setName('Мой скрипт'); setCode(TEMPLATE); show('editor'); }
function openEditor(id) {
  const s = S.scripts.find(x => x.id === id); if (!s) return;
  show('editor', open.length > 0 && !open.includes('editor'));
  E.linked = s.id; E.saved = false; setName(s.name); setCode(s.code); pushVersion(s.code, 'открыт');
  if (s.error) { log(`${s.name}: ${s.error}`, 'error', 'editor'); setTimeout(() => showError(s.error), 400); }
}
// Quant changed a script: refresh the editor if it shows that script
function onScriptChanged(s) {
  if (E.linked === s.id && E.editor && code() !== s.code) { pushVersion(code(), 'до правки Panda'); setCode(s.code); pushVersion(s.code, 'правка Panda'); log(`Panda обновил «${s.name}» — предыдущая версия в истории`, 'info', 'editor'); }
}

async function fillNameMenu() {
  const menu = $('epNameMenu');
  menu.innerHTML = '<div class="pm-h">На графике</div>' + (S.scripts.length ? S.scripts.map(s => `<button data-open="${s.id}">${esc(s.name)}${s.id === E.linked ? ' ·' : ''}</button>`).join('') : '<div class="pm-empty">нет индикаторов</div>') +
    '<div class="pm-h">Сохранённые</div><div id="epSaved"><div class="pm-empty">загрузка…</div></div><div class="pm-sep"></div><button data-new>＋ Новый скрипт</button>';
  menu.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { menu.classList.add('hidden'); openEditor(b.dataset.open); });
  menu.querySelector('[data-new]').onclick = () => { menu.classList.add('hidden'); newScript(); };
  try {
    const list = await api('/api/scripts');
    const latest = new Map(); for (const f of list) if (!latest.has(f.name.toLowerCase())) latest.set(f.name.toLowerCase(), f);
    const box = $('epSaved');
    box.innerHTML = latest.size ? [...latest.values()].slice(0, 30).map(f => `<button data-file="${esc(f.file)}" title="${esc(f.file)}">${esc(f.name)} <span class="muted">${f.time.slice(5, 16).replace('T', ' ')}</span></button>`).join('') : '<div class="pm-empty">пока пусто</div>';
    box.querySelectorAll('[data-file]').forEach(b => b.onclick = async () => {
      menu.classList.add('hidden');
      const r = await fetch('/api/scripts/file?f=' + encodeURIComponent(b.dataset.file)).then(x => x.json());
      if (r.code) { E.linked = null; E.saved = true; setName(b.textContent.replace(/\s+\d\d-\d\d \d\d:\d\d$/, '').trim()); setCode(r.code); pushVersion(r.code, 'открыт с диска'); }
    });
  } catch (e) { $('epSaved').innerHTML = `<div class="pm-empty">${esc(e.message)}</div>`; }
}

function modal(html, onReady) { const m = $('modal'), box = $('modalBox'); box.innerHTML = html; m.classList.remove('hidden'); const close = () => { m.classList.add('hidden'); box.classList.remove('wide'); }; onReady && onReady(box, close); return close; }
function askName(title, value) {
  return new Promise(resolve => modal(`<h3>${esc(title)}</h3><input class="m-input" id="mName" value="${esc(value)}" spellcheck="false"><div class="modal-actions"><button class="btn" id="mCancel">Отмена</button><button class="btn" id="mOk">OK</button></div>`, (box, close) => {
    const inp = box.querySelector('#mName'); inp.focus(); inp.select();
    const ok = () => { const v = inp.value.trim(); close(); resolve(v || null); };
    box.querySelector('#mOk').onclick = ok; box.querySelector('#mCancel').onclick = () => { close(); resolve(null); };
    inp.onkeydown = e => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') { close(); resolve(null); } };
  }));
}
async function saveScript() {
  if (!E.saved) { const n = await askName('Сохранить скрипт', E.name); if (!n) return; setName(n); }
  const r = await api('/api/scripts/save', { name: E.name, code: code() });
  if (r.ok) { E.saved = true; log(`Сохранено: scripts/${r.file}`, 'info', 'editor'); flash($('epSave')); const s = linkedScript(); if (s && s.name !== E.name) { s.name = E.name; A.saveScripts(); A.renderAll(); } }
  else log(`Не сохранено: ${r.error}`, 'error', 'editor');
}
async function renameScript() {
  const n = await askName('Переименовать скрипт', E.name); if (!n) return;
  setName(n); const s = linkedScript(); if (s) { s.name = n; A.saveScripts(); A.renderAll(); }
}
async function openHistory() {
  let disk = [];
  try { const key = E.name.toLowerCase().replace(/[\s_]+/g, ' '); disk = (await api('/api/scripts')).filter(f => f.name.toLowerCase().replace(/[\s_]+/g, ' ') === key); } catch { /* offline */ }
  const rows = E.versions.slice().reverse().map((v, i) => ({ src: 'сессия', label: v.label, time: new Date(v.t).toLocaleTimeString(), get: async () => v.code, key: 's' + i }))
    .concat(disk.map(f => ({ src: 'диск', label: f.file, time: f.time.slice(0, 19).replace('T', ' '), get: async () => (await fetch('/api/scripts/file?f=' + encodeURIComponent(f.file)).then(x => x.json())).code, key: f.file })));
  modal(`<h3>История версий — ${esc(E.name)}</h3>` + (rows.length ? `<div class="hist">${rows.map((r, i) => `<div class="hrow"><span class="hsrc ${r.src === 'диск' ? 'disk' : ''}">${r.src}</span><span class="htime">${esc(r.time)}</span><span class="hlabel">${esc(r.label)}</span><div class="spacer"></div><button class="btn" data-diff="${i}">Сравнить</button><button class="btn" data-load="${i}">Открыть</button></div>`).join('')}</div>` : '<p class="muted">Версий пока нет. Они появляются при запуске, сохранении и правках Panda.</p>') +
    `<div class="modal-actions"><button class="btn" id="hClose">Закрыть</button></div>`, (box, close) => {
    box.querySelector('#hClose').onclick = close;
    box.querySelectorAll('[data-load]').forEach(b => b.onclick = async () => { const c = await rows[+b.dataset.load].get(); close(); pushVersion(code(), 'до отката'); setCode(c); log('Версия загружена в редактор — нажми «Обновить», чтобы применить на графике', 'info', 'editor'); });
    box.querySelectorAll('[data-diff]').forEach(b => b.onclick = async () => { const c = await rows[+b.dataset.diff].get(); openDiff(c, code(), rows[+b.dataset.diff]); });
  });
}
function openDiff(original, modified, row) {
  if (!E.monaco) return;
  const box = $('modalBox'); box.classList.add('wide');
  box.innerHTML = `<h3>Сравнение: ${esc(row.src)} ${esc(row.time)} → текущий код</h3><div class="diffhost" id="diffHost"></div><div class="modal-actions"><button class="btn" id="dBack">Назад</button><button class="btn" id="dLoad">Открыть эту версию</button><button class="btn" id="dClose">Закрыть</button></div>`;
  $('modal').classList.remove('hidden');
  const dEd = E.monaco.editor.createDiffEditor($('diffHost'), { theme: 'pandich', readOnly: true, automaticLayout: true, renderSideBySide: box.clientWidth > 900, minimap: { enabled: false }, fontSize: 12 });
  const mo = E.monaco.editor.createModel(original, 'pine'), mm = E.monaco.editor.createModel(modified, 'pine');
  dEd.setModel({ original: mo, modified: mm });
  const done = () => { dEd.dispose(); mo.dispose(); mm.dispose(); };
  $('dClose').onclick = () => { done(); $('modal').classList.add('hidden'); box.classList.remove('wide'); };
  $('dBack').onclick = () => { done(); box.classList.remove('wide'); openHistory(); };
  $('dLoad').onclick = () => { done(); $('modal').classList.add('hidden'); box.classList.remove('wide'); pushVersion(code(), 'до отката'); setCode(original); };
}
function askQuant() {
  let snippet = code(), what = 'этот Pine Script';
  if (E.editor) { const sel = E.editor.getSelection(); const t = sel && E.editor.getModel().getValueInRange(sel); if (t && t.trim()) { snippet = t; what = `этот фрагмент (строки ${sel.startLineNumber}–${sel.endLineNumber}) скрипта «${E.name}»`; } }
  if (E.linked) A.selectScript(E.linked);
  window.QLChat && window.QLChat.prefill(`Посмотри ${what}: \n\`\`\`pine\n${snippet}\n\`\`\`\n`, 'code');
}

// Logs + strategy tester
function renderLogs() {
  const el = $('epLogs'); if (!el) return;
  $('epLogCount').textContent = S.logs.length;
  const errs = S.logs.filter(l => l.level === 'error').length; $('epLogCount').classList.toggle('err', errs > 0);
  el.innerHTML = S.logs.length ? S.logs.slice(-300).map(l => `<div class="lg ${l.level}"><span class="lt">${new Date(l.t).toLocaleTimeString()}</span><span class="ls">${esc(l.src)}</span><span class="lx">${esc(l.text)}</span></div>`).join('') : '<div class="muted" style="padding:8px">Логи пусты. Здесь появятся ошибки компиляции и вывод log.info / log.warning / log.error.</div>';
  el.scrollTop = el.scrollHeight;
}
function renderStrategy() {
  const el = $('epStrat'); if (!el) return;
  const s = linkedScript() && linkedScript().result?.strategy ? linkedScript() : S.scripts.find(x => x.result && x.result.strategy);
  const st = s && s.result && s.result.strategy;
  if (!st) { el.innerHTML = '<p class="muted" style="padding:8px">Запусти скрипт-стратегию (strategy()), чтобы увидеть результаты бэктеста PineTS.</p>'; return; }
  const winrate = st.total ? (st.wintrades / st.total * 100) : null;
  const cell = (k, v, cls = '') => `<div class="stat"><div class="k">${k}</div><div class="v ${cls}">${v}</div></div>`;
  const tf = t => new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ');
  el.innerHTML = `<div class="ep-valrow"><span class="muted">${esc(s.name)} · ${esc(S.symbol)} ${S.interval} · движок PineTS (OHLC, без bar magnifier)</span>${window.QLValidate ? '<button class="btn ep-val" id="epVal" title="Сетка параметров, регион, поправка на перебор, walk-forward, Монте-Карло">✓ Проверить честно</button>' : ''}</div><div class="ep-valnote muted">Один прогон — шумная оценка. «Проверить честно» покажет, есть ли перевес на самом деле.</div><div class="stats">` +
    cell('Net profit', fmt(st.netprofit), st.netprofit >= 0 ? 'pos' : 'neg') + cell('Сделок', st.total) + cell('Win rate', winrate === null ? '—' : fmt(winrate, 1) + '%') +
    cell('Profit factor', fmt(st.profit_factor)) + cell('Max DD', fmt(st.max_drawdown)) + cell('Max DD %', fmt(st.max_drawdown_percent)) + cell('Gross +', fmt(st.grossprofit)) + cell('Gross −', fmt(st.grossloss)) +
    `</div><table class="trades"><tr><th>#</th><th>Вход</th><th>Цена</th><th>Выход</th><th>Цена</th><th>Объём</th><th>P/L</th></tr>` +
    st.closedtrades.slice(-300).reverse().map((t, k) => `<tr><td>${st.closedtrades.length - k}</td><td>${tf(t.entry_time)}</td><td>${fmt(t.entry_price, 4)}</td><td>${t.exit_time ? tf(t.exit_time) : ''}</td><td>${fmt(t.exit_price, 4)}</td><td>${fmt(t.size, 4)}</td><td class="${t.profit >= 0 ? 'pos' : 'neg'}">${fmt(t.profit)}</td></tr>`).join('') + '</table>';
  const vb = $('epVal'); if (vb) vb.onclick = () => window.QLValidate.openSetup(s);
}

// Pine language for Monaco (highlighting + completions from PineTS metadata)
function registerPine(monaco, meta) {
  if (monaco.languages.getLanguages().some(l => l.id === 'pine')) return;
  const ns = meta.namespaces || {};
  ns.syminfo = ns.syminfo && ns.syminfo.length ? ns.syminfo : ['ticker', 'tickerid', 'description', 'type', 'currency', 'basecurrency', 'mintick', 'pointvalue', 'pricescale', 'minmove', 'timezone', 'session', 'root', 'prefix', 'volumetype'];
  const constNs = { plot: ['style_line', 'style_linebr', 'style_stepline', 'style_stepline_diamond', 'style_histogram', 'style_columns', 'style_circles', 'style_cross', 'style_area', 'style_areabr'],
    shape: ['xcross', 'cross', 'triangleup', 'triangledown', 'flag', 'circle', 'arrowup', 'arrowdown', 'labelup', 'labeldown', 'square', 'diamond'],
    location: ['abovebar', 'belowbar', 'top', 'bottom', 'absolute'], size: ['auto', 'tiny', 'small', 'normal', 'large', 'huge'],
    xloc: ['bar_index', 'bar_time'], yloc: ['price', 'abovebar', 'belowbar'], extend: ['none', 'left', 'right', 'both'],
    position: ['top_left', 'top_center', 'top_right', 'middle_left', 'middle_center', 'middle_right', 'bottom_left', 'bottom_center', 'bottom_right'],
    barmerge: ['gaps_on', 'gaps_off', 'lookahead_on', 'lookahead_off'], display: ['all', 'none', 'data_window', 'pane', 'price_scale', 'status_line'],
    format: ['inherit', 'price', 'percent', 'volume', 'mintick'], dayofweek: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
    alert: ['freq_all', 'freq_once_per_bar', 'freq_once_per_bar_close'], hline: ['style_solid', 'style_dashed', 'style_dotted'],
    order: ['ascending', 'descending'], text: ['align_left', 'align_center', 'align_right', 'wrap_auto', 'wrap_none'], font: ['family_default', 'family_monospace'] };
  for (const [k, v] of Object.entries(constNs)) ns[k] = [...new Set([...(ns[k] || []), ...v])];
  const stylesLL = ['style_solid', 'style_dashed', 'style_dotted', 'style_arrow_left', 'style_arrow_right', 'style_arrow_both', 'style_none', 'style_label_up', 'style_label_down', 'style_label_left', 'style_label_right', 'style_label_center', 'style_xcross', 'style_cross', 'style_triangleup', 'style_triangledown', 'style_flag', 'style_circle', 'style_arrowup', 'style_arrowdown', 'style_square', 'style_diamond'];
  for (const k of ['line', 'label', 'box']) ns[k] = [...new Set([...(ns[k] || []), ...stylesLL.filter(x => k === 'label' || !/label|xcross|cross$|triangle|flag|circle|arrowup|arrowdown|square|diamond/.test(x))])];
  if (ns.strategy) ns.strategy = [...new Set([...ns.strategy, 'long', 'short', 'percent_of_equity', 'fixed', 'cash', 'position_size', 'position_avg_price', 'netprofit', 'equity', 'opentrades', 'closedtrades', 'wintrades', 'losstrades'])];
  const keywords = ['if', 'else', 'for', 'to', 'by', 'in', 'while', 'switch', 'var', 'varip', 'import', 'export', 'method', 'type', 'enum', 'and', 'or', 'not', 'true', 'false', 'na', 'break', 'continue', 'return'];
  const types = ['int', 'float', 'bool', 'string', 'color', 'line', 'label', 'box', 'table', 'linefill', 'polyline', 'array', 'matrix', 'map', 'series', 'simple', 'const', 'void'];
  const builtinVars = ['open', 'high', 'low', 'close', 'volume', 'hl2', 'hlc3', 'ohlc4', 'hlcc4', 'time', 'time_close', 'time_tradingday', 'timenow', 'bar_index', 'last_bar_index', 'last_bar_time', 'year', 'month', 'weekofyear', 'dayofmonth', 'dayofweek', 'hour', 'minute', 'second'];
  const builtinFns = ['indicator', 'strategy', 'library', 'plot', 'plotshape', 'plotchar', 'plotarrow', 'plotcandle', 'plotbar', 'bgcolor', 'barcolor', 'fill', 'hline', 'alert', 'alertcondition', 'nz', 'na', 'fixnan', 'max_bars_back', 'timestamp', 'int', 'float', 'bool', 'string'];
  const namespaces = Object.keys(ns);
  monaco.languages.register({ id: 'pine', extensions: ['.pine'] });
  monaco.languages.setLanguageConfiguration('pine', {
    comments: { lineComment: '//' }, brackets: [['(', ')'], ['[', ']'], ['{', '}']],
    autoClosingPairs: [{ open: '(', close: ')' }, { open: '[', close: ']' }, { open: '"', close: '"' }, { open: "'", close: "'" }],
    indentationRules: { increaseIndentPattern: /^\s*(if|else|for|while|switch)\b.*$|=>\s*$/, decreaseIndentPattern: /^\s*else\b/ },
    onEnterRules: [{ beforeText: /^\s*(if|else|for|while|switch)\b.*$|.*=>\s*$/, action: { indentAction: monaco.languages.IndentAction.Indent } }],
  });
  monaco.languages.setMonarchTokensProvider('pine', {
    keywords, types, builtinVars, builtinFns, namespaces,
    tokenizer: {
      root: [
        [/\/\/[@]version=\d+/, 'annotation'],
        [/\/\/.*$/, 'comment'],
        [/"([^"\\]|\\.)*"/, 'string'], [/'([^'\\]|\\.)*'/, 'string'],
        [/#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?\b/, 'number.hex'],
        [/\d+(\.\d+)?([eE][-+]?\d+)?/, 'number'],
        [/([a-z_]\w*)(\.)([a-z_]\w*)/, { cases: { '$1@namespaces': ['namespace', 'delimiter', 'member'], '@default': ['identifier', 'delimiter', 'identifier'] } }],
        [/[a-zA-Z_]\w*(?=\s*\()/, { cases: { '@keywords': 'keyword', '@builtinFns': 'function.builtin', '@types': 'type', '@default': 'function' } }],
        [/[a-zA-Z_]\w*/, { cases: { '@keywords': 'keyword', '@types': 'type', '@builtinVars': 'variable.predefined', '@namespaces': 'namespace', '@default': 'identifier' } }],
        [/=>|:=|[=><!]=?|[+\-*\/%?:]/, 'operator'],
        [/[()[\]{},.]/, 'delimiter'],
      ],
    },
  });
  monaco.editor.defineTheme('pandich', { base: 'vs-dark', inherit: true, colors: { 'editor.background': '#131416', 'editor.lineHighlightBackground': '#1b1d21', 'editorLineNumber.foreground': '#4a4e57', 'editorGutter.background': '#131416', 'minimap.background': '#16171a' },
    rules: [{ token: 'keyword', foreground: 'C586C0' }, { token: 'type', foreground: '4EC9B0' }, { token: 'function', foreground: 'DCDCAA' }, { token: 'function.builtin', foreground: '4FC1FF' },
      { token: 'namespace', foreground: '569CD6' }, { token: 'member', foreground: 'DCDCAA' }, { token: 'variable.predefined', foreground: '9CDCFE' }, { token: 'string', foreground: 'CE9178' },
      { token: 'number', foreground: 'B5CEA8' }, { token: 'number.hex', foreground: 'D7BA7D' }, { token: 'comment', foreground: '6A9955' }, { token: 'annotation', foreground: '6A9955', fontStyle: 'bold' }, { token: 'operator', foreground: 'D4D4D4' }] });
  const K = monaco.languages.CompletionItemKind;
  monaco.languages.registerCompletionItemProvider('pine', {
    triggerCharacters: ['.'],
    provideCompletionItems(model, pos) {
      const before = model.getLineContent(pos.lineNumber).slice(0, pos.column - 1);
      const word = model.getWordUntilPosition(pos);
      const range = { startLineNumber: pos.lineNumber, endLineNumber: pos.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
      const m = /([a-z_]\w*)\.(\w*)$/.exec(before);
      if (m && ns[m[1]]) {
        return { suggestions: ns[m[1]].map(n => ({ label: n, kind: /^[a-z]+(_[a-z0-9]+)*$/.test(n) && /^(style_|shape|location|size|xloc|yloc|extend|position|barmerge|display|format|dayofweek|alert|order|text|font)/.test(m[1] + '.' + n) ? K.Constant : K.Method, insertText: n, range, detail: `${m[1]}.${n}` })) };
      }
      const S1 = [];
      for (const k of keywords) S1.push({ label: k, kind: K.Keyword, insertText: k, range });
      for (const t of types) S1.push({ label: t, kind: K.TypeParameter, insertText: t, range });
      for (const v of builtinVars) S1.push({ label: v, kind: K.Variable, insertText: v, range });
      for (const f of builtinFns) S1.push({ label: f, kind: K.Function, insertText: f + '($0)', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range });
      for (const n of namespaces) S1.push({ label: n, kind: K.Module, insertText: n, range, detail: `${ns[n].length} членов в PineTS` });
      S1.push({ label: 'indicator-template', kind: K.Snippet, insertText: '//@version=6\nindicator("${1:Мой индикатор}", overlay = ${2:true})\n\n$0', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range, detail: 'шаблон индикатора' });
      S1.push({ label: 'strategy-template', kind: K.Snippet, insertText: '//@version=6\nstrategy("${1:Моя стратегия}", overlay = true, initial_capital = 10000, default_qty_type = strategy.percent_of_equity, default_qty_value = 10)\n\n$0', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range, detail: 'шаблон стратегии' });
      return { suggestions: S1 };
    },
  });
}

// ───────── Object tree ─────────
function renderTree() {
  const el = els.tree && els.tree.querySelector('[data-body]'); if (!el || !open.includes('tree')) return;
  const D = window.QLDraw;
  const tools = D ? Object.fromEntries(D.tools().map(t => [t.id, t.name])) : {};
  const drawings = D ? D.list() : [], selD = D ? D.selectedId() : null;
  const row = (cls, name, sub, btns, attrs) => `<div class="tr ${cls}" ${attrs}><span class="tn" title="${esc(name)}">${esc(name)}</span>${sub ? `<span class="ts">${esc(sub)}</span>` : ''}<div class="spacer"></div>${btns}</div>`;
  el.innerHTML = `<div class="th">Индикаторы <span>${S.scripts.length}</span></div>` +
    (S.scripts.length ? S.scripts.map(s => row(`${s.visible ? '' : 'off'} ${s.id === S.selectedId ? 'sel' : ''}`, s.name, s.error ? 'ошибка' : (s.result ? (s.result.declaration === 'strategy' ? 'стратегия' : (s.result.overlay ? 'на цене' : 'панель')) : ''),
      `<button class="rp-ib" data-a="eye" title="Показать/скрыть">${s.visible ? IC.eye : IC.eyeOff}</button><button class="rp-ib" data-a="cfg" title="Настройки">${IC.gear}</button><button class="rp-ib" data-a="code" title="Код">${IC.editor}</button><button class="rp-ib" data-a="del" title="Удалить">${IC.trash}</button>`, `data-sid="${s.id}"`)).join('') : '<div class="pm-empty">нет индикаторов</div>') +
    `<div class="th">Рисунки <span>${drawings.length}</span>${drawings.length ? '<button class="ep-mini" id="trClear">удалить все</button>' : ''}</div>` +
    (drawings.length ? drawings.slice().reverse().map(d => row(`${d.hidden ? 'off' : ''} ${d.id === selD ? 'sel' : ''}`, (tools[d.type] || d.type) + (d.style && d.style.agent ? ' · Panda' : ''), d.style && d.style.text ? d.style.text : '',
      `<button class="rp-ib" data-a="eye" title="Показать/скрыть">${d.hidden ? IC.eyeOff : IC.eye}</button><button class="rp-ib" data-a="lock" title="Блокировка">${d.locked ? IC.lock : IC.unlock}</button><button class="rp-ib" data-a="del" title="Удалить">${IC.trash}</button>`, `data-did="${d.id}"`)).join('') : '<div class="pm-empty">нет рисунков</div>');
  el.querySelectorAll('[data-sid]').forEach(r => {
    const s = S.scripts.find(x => x.id === r.dataset.sid);
    r.querySelector('.tn').onclick = () => A.selectScript(S.selectedId === s.id ? null : s.id);
    r.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => {
      const a = b.dataset.a;
      if (a === 'eye') { s.visible = !s.visible; A.saveScripts(); if (s.visible && !s.result) await A.runScript(s); A.renderAll(); }
      if (a === 'cfg') A.openInputs(s);
      if (a === 'code') { A.selectScript(s.id); openEditor(s.id); }
      if (a === 'del') { S.scripts = S.scripts.filter(x => x !== s); A.S.scripts = S.scripts; if (S.selectedId === s.id) A.selectScript(null); if (E.linked === s.id) { E.linked = null; updateRunButton(); } A.saveScripts(); A.renderAll(); }
    });
  });
  el.querySelectorAll('[data-did]').forEach(r => {
    const id = r.dataset.did, d = D.byId(id);
    r.querySelector('.tn').onclick = () => D.select(id);
    r.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { const a = b.dataset.a; if (a === 'eye') D.setHidden(id, !d.hidden); if (a === 'lock') D.setLocked(id, !d.locked); if (a === 'del') D.remove(id); });
  });
  const clr = el.querySelector('#trClear'); if (clr) clr.onclick = () => D.clear();
}

// ───────── Data window ─────────
let dwTime = null, dwPending = false, dwMaps = new WeakMap();
function seriesMap(s) {
  let m = dwMaps.get(s.result);
  if (!m) { m = s.result.series.map(sp => ({ title: sp.title, color: sp.color, map: new Map(sp.data.map(d => [d.t, d])) })); dwMaps.set(s.result, m); }
  return m;
}
function renderData() {
  dwPending = false;
  const el = els.data && els.data.querySelector('[data-body]'); if (!el || !open.includes('data')) return;
  const bars = S.bars; if (!bars.length) { el.innerHTML = '<div class="pm-empty">нет данных</div>'; return; }
  let i = bars.length - 1;
  if (dwTime !== null) { let lo = 0, hi = bars.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (bars[mid].time <= dwTime) lo = mid; else hi = mid - 1; } i = lo; }
  const b = bars[i], prev = bars[i - 1];
  const dg = Math.abs(b.close) >= 1000 ? 2 : Math.abs(b.close) >= 10 ? 3 : Math.abs(b.close) >= 1 ? 4 : 6;
  const ch = prev ? b.close - prev.close : 0, chp = prev && prev.close ? ch / prev.close * 100 : 0;
  const rowv = (k, v, cls = '', color = '') => `<div class="dr"><span class="dk">${color ? `<i style="background:${esc(color)}"></i>` : ''}${esc(k)}</span><span class="dv ${cls}">${v}</span></div>`;
  let html = `<div class="dh">${esc(S.symbol)} · ${S.interval}</div><div class="dt">${new Date(b.time * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC${dwTime === null ? ' · последний бар' : ''}</div>` +
    rowv('Открытие', fmt(b.open, dg)) + rowv('Максимум', fmt(b.high, dg)) + rowv('Минимум', fmt(b.low, dg)) + rowv('Закрытие', fmt(b.close, dg)) +
    rowv('Изменение', `${ch >= 0 ? '+' : ''}${fmt(ch, dg)} (${chp >= 0 ? '+' : ''}${fmt(chp, 2)}%)`, ch >= 0 ? 'pos' : 'neg') + rowv('Объём', fmt(b.volume, 0));
  for (const s of S.scripts) {
    if (!s.visible || !s.result || !s.result.series.length) continue;
    html += `<div class="dh sub">${esc(s.name)}</div>`;
    for (const sp of seriesMap(s)) { const d = sp.map.get(b.time); html += rowv(sp.title, d && d.v !== null ? fmt(d.v, Math.abs(d.v) >= 1000 ? 2 : 4) : '—', '', (d && d.c) || sp.color); }
  }
  el.innerHTML = html;
}
A.chart.subscribeCrosshairMove(param => {
  dwTime = param && param.time !== undefined && param.point ? param.time : null;
  if (open.includes('data') && !dwPending) { dwPending = true; requestAnimationFrame(renderData); }
});

// ───────── events + toolbar hooks ─────────
window.addEventListener('ql:render', () => { renderTree(); renderData(); renderStrategy(); updateRunButton(); });
window.addEventListener('ql:drawings', renderTree);
window.addEventListener('ql:drawsel', () => { if (open.includes('tree')) renderTree(); });
window.addEventListener('ql:log', () => { if (open.includes('editor')) renderLogs(); });
const addBtn = $('addScriptBtn'); if (addBtn) addBtn.onclick = () => newScript();
const edBtn = $('editorBtn'); if (edBtn) edBtn.onclick = e => toggle('editor', e.shiftKey);

window.QLPanels = { openEditor, onScriptChanged, show, toggle, newScript };
applyLayout();
})();
