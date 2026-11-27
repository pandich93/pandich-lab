// Pandich Lab — interface languages: Русский (source), O'zbekcha (Latin), English.
// Russian UI text is the key: dictionary entries in i18n-dict.js map it to [English, O'zbekcha].
// A DOM translator (MutationObserver) translates text and title/placeholder/aria-label as they appear,
// so the app code keeps its Russian strings. Chat messages, code editors, inputs and script output are never touched.
// Missing translation → the Russian text stays (nothing breaks).
(() => {
  'use strict';
  const LANGS = { ru: 'Русский', uz: "O'zbekcha", en: 'English' };
  const COL = { en: 0, uz: 1 };
  const CYR = /[А-Яа-яЁё]/;
  const DICT = window.QL_I18N_DICT || {};

  function detect() {
    // the desktop app passes its language in the URL (?lang=uz) — it wins and is remembered for the multi-chart cells
    try { const q = new URL(location.href).searchParams.get('lang'); if (LANGS[q]) { localStorage.setItem('ql.lang', q); return q; } } catch { /* no URL / storage */ }
    try { const s = localStorage.getItem('ql.lang'); if (LANGS[s]) return s; } catch { /* storage unavailable */ }
    const n = String(navigator.language || '').toLowerCase();
    return n.startsWith('uz') ? 'uz' : n.startsWith('ru') || !n ? 'ru' : 'en';
  }
  const lang = detect();
  document.documentElement.lang = lang;

  // ── index: exact keys, {n}-templates as regexes, "Label:" prefixes
  const exact = new Map(), pats = [], prefixes = [];
  const reEsc = x => x.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
  for (const [k, v] of Object.entries(DICT)) {
    if (/\{\d+\}/.test(k)) {
      const names = [];
      const body = reEsc(k).replace(/\{(\d+)\}/g, (_m, n) => { names.push(n); return '([\\s\\S]*?)'; });
      pats.push({ re: new RegExp('^' + body + '$'), names, v, len: k.replace(/\{\d+\}/g, '').length });
    } else {
      exact.set(k, v);
      if (/:$/.test(k)) prefixes.push(k);
    }
  }
  pats.sort((a, b) => b.len - a.len);
  prefixes.sort((a, b) => b.length - a.length);

  const cache = new Map();
  function look(core, col) {
    const e = exact.get(core);
    if (e) return e[col] || null;
    for (const p of pats) {
      const m = core.match(p.re); if (!m) continue;
      let o = p.v[col]; if (!o) return null;
      p.names.forEach((n, j) => {
        const g = m[j + 1] ?? '';
        const gt = CYR.test(g) ? (look(g.trim(), col) ?? g) : g;
        o = o.split(`{${n}}`).join(gt);
      });
      return o;
    }
    for (const k of prefixes) {
      if (!core.startsWith(k)) continue;
      const head = exact.get(k)[col]; if (!head) return null;
      const rest = core.slice(k.length), rt = rest.trim();
      return head + (rt && CYR.test(rt) ? ' ' + (look(rt, col) ?? rt) : rest);
    }
    return null;
  }
  function t(s, vars) {
    if (s == null) return s;
    let out = String(s);
    if (lang !== 'ru' && CYR.test(out)) {
      const lead = out.match(/^\s*/)[0], trail = out.match(/\s*$/)[0], core = out.trim();
      let r = cache.get(core);
      if (r === undefined) { r = look(core, COL[lang]); if (cache.size > 5000) cache.clear(); cache.set(core, r); }
      if (r != null) out = lead + r + trail;
    }
    if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v);
    return out;
  }

  // ── DOM translator
  const SKIP_TEXT = '.msg.user, .msg.ai, .monaco-editor, textarea, [contenteditable="true"], [data-noi18n], .pt, script, style, code, pre';
  const SKIP_ATTR = '.msg.user, .msg.ai, .monaco-editor, [data-noi18n]';
  const ATTRS = ['title', 'placeholder', 'aria-label'];
  function trText(n) {
    const v = n.nodeValue; if (!v || !CYR.test(v)) return;
    const p = n.parentElement; if (!p || p.closest(SKIP_TEXT)) return;
    const o = t(v); if (o !== v) n.nodeValue = o;
  }
  function trAttrs(el) {
    for (const a of ATTRS) {
      const v = el.getAttribute(a); if (!v || !CYR.test(v)) continue;
      if (el.closest(SKIP_ATTR)) return;
      const o = t(v); if (o !== v) el.setAttribute(a, o);
    }
  }
  function walk(root) {
    if (root.nodeType === 3) { trText(root); return; }
    if (root.nodeType !== 1) return;
    trAttrs(root);
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n; while ((n = tw.nextNode())) { if (n.nodeType === 3) trText(n); else trAttrs(n); }
  }
  if (lang !== 'ru') {
    const start = () => {
      walk(document.body);
      new MutationObserver(muts => {
        for (const m of muts) {
          if (m.type === 'characterData') trText(m.target);
          else if (m.type === 'attributes') trAttrs(m.target);
          else m.addedNodes.forEach(walk);
        }
      }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    };
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
    // native dialogs used by the app
    const oc = window.confirm.bind(window), oa = window.alert.bind(window), op = window.prompt.bind(window);
    window.confirm = m => oc(t(m)); window.alert = m => oa(t(m)); window.prompt = (m, d) => op(t(m), d);
  }

  function setLang(l) {
    if (!LANGS[l] || l === lang) return;
    try { localStorage.setItem('ql.lang', l); } catch { /* storage unavailable */ }
    try { window.pandichDesktop && window.pandichDesktop.setLang && window.pandichDesktop.setLang(l); } catch { /* not desktop */ }
    let w = window; try { if (window.top !== window && window.top.location.href) w = window.top; } catch { /* cross-origin */ }
    const u = new URL(w.location.href);
    if (u.searchParams.has('lang')) { u.searchParams.set('lang', l); w.location.replace(u.toString()); } else w.location.reload();
  }
  // follow a language change made in another window/cell
  window.addEventListener('storage', e => { if (e.key === 'ql.lang' && e.newValue && e.newValue !== lang && LANGS[e.newValue]) location.reload(); });

  window.QLI18n = { lang, langs: LANGS, t, setLang };
})();
