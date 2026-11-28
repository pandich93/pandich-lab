// Pandich Lab — Panda journal: chats survive reloads; history with search, continue, Markdown export; stored validation / research reports.
(() => {
  const A = window.QLApp; if (!A || A.EMBED) return;
  const { S, esc } = A;
  const T = s => (window.QLI18n ? window.QLI18n.t(s) : s);
  const f = (x, d = 2) => (Number.isFinite(x) ? (+x).toFixed(d) : '—');
  const VERD = { no: 'bad', check: 'warn', forward: 'ok', na: 'na' };
  const dt = ms => new Date(ms).toLocaleString(undefined, { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  const get = p => fetch(p).then(r => r.json()).catch(e => ({ ok: false, error: e.message }));
  const post = (p, b) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json()).catch(e => ({ ok: false, error: e.message }));
  try { if (!localStorage.getItem('ql.session')) localStorage.setItem('ql.session', JSON.stringify(S.sessionId)); } catch { /* storage unavailable */ } // keep the chat id across reloads

  // ───────── cards for stored results ─────────
  function validationCard(e) {
    const el = document.createElement('div'); el.className = 'vd-card ' + (VERD[e.verdict && e.verdict.code] || '');
    const R = e.region;
    el.innerHTML = `<div class="vd-ct">✓ <span>Проверка стратегии</span>: <b>${esc((e.verdict && e.verdict.title) || '')}</b></div>` +
      (R ? `<div class="vd-cl" data-noi18n>${esc(e.title || '')} · Sharpe ${f(R.mean)} ± ${f(R.se)} · ${R.size} · deflated ${f(e.dsr)} · WF OOS ${f(e.wf)}</div>` : '') + '<button class="st-chatbtn">Открыть отчёт</button>';
    el.querySelector('button').onclick = async () => {
      const j = await get('/api/journal/report/' + e.job);
      if (j.ok && window.QLValidate) window.QLValidate.showReport(j.report, S.scripts.find(x => (x.result && x.result.title) === e.title) || null); else alert(j.error || 'нет отчёта');
    };
    return el;
  }
  function researchCard(e) {
    const el = document.createElement('div'); el.className = 'vd-card rs-card';
    el.innerHTML = `<div class="vd-ct">🔬 <span>Исследование</span>: <b data-noi18n>${esc(e.goal || '')}</b></div><button class="st-chatbtn">Подробнее</button>`;
    el.querySelector('button').onclick = () => window.QLValidate && window.QLValidate.showResearch(e.id);
    return el;
  }

  // ───────── restore the current chat after a reload ─────────
  (async () => {
    const j = await get('/api/journal/' + encodeURIComponent(S.sessionId));
    if (j.ok && j.journal.events.length && !document.querySelector('#messages .msg') && window.QLChat) window.QLChat.restore(j.journal.events);
  })();

  // ───────── Markdown export ─────────
  function toMarkdown(j) {
    const L = [`# ${j.title || 'Panda'}`, '', `_${j.symbol || ''} ${j.interval || ''} · ${new Date(j.created).toISOString().slice(0, 16).replace('T', ' ')} UTC · Pandich Lab_`, ''];
    for (const e of j.events) {
      if (e.k === 'user') L.push(`### 🧑 ${new Date(e.t).toISOString().slice(11, 16)}`, '', e.text, '');
      else if (e.k === 'ai') L.push(`**Panda:**`, '', e.text, '');
      else if (e.k === 'run') L.push(`> ▶ ${T('запуск на графике')}: ${e.ok ? 'OK' : T('ошибка')} — ${String(e.summary).split('\n')[0]}`, '');
      else if (e.k === 'validation') L.push(`> ✓ ${T('Проверка стратегии')} «${e.title || ''}»: **${e.verdict ? e.verdict.title : ''}**${e.region ? ` · Sharpe ${f(e.region.mean)} ± ${f(e.region.se)} · deflated ${f(e.dsr)} · WF OOS ${f(e.wf)}` : ''}`, '');
      else if (e.k === 'research') L.push(`> 🔬 ${T('Исследование')}: ${e.goal || e.id}`, '');
      else if (e.k === 'error') L.push(`> ⚠ ${e.text}`, '');
      else if (e.k === 'chart') L.push(`> 📈 ${e.symbol} ${e.interval}`, '');
    }
    return L.join('\n');
  }
  function download(name, text) {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' })), download: name });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ───────── history window ─────────
  async function open() {
    const ov = document.createElement('div'); ov.className = 'ind-ov';
    const dlg = document.createElement('div'); dlg.className = 'ind-dlg jr-dlg'; ov.appendChild(dlg); document.body.appendChild(ov);
    const close = () => { document.removeEventListener('keydown', onKey, true); ov.remove(); };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
    dlg.innerHTML = `<div class="ind-h"><b>История</b><input class="jr-q" id="jrQ" placeholder="Поиск по чатам" spellcheck="false"><button class="ind-x" title="Закрыть (Esc)">✕</button></div>
      <div class="jr-main"><div class="jr-list" id="jrList"><div class="ind-empty">Загрузка…</div></div><div class="jr-view" id="jrView"><div class="ind-empty">Выберите чат слева.</div></div></div>
      <div class="ind-f"><span class="muted jr-note">Чаты, проверки и исследования хранятся у вас на компьютере (папка данных Pandich Lab).</span><span class="sp"></span><button class="ind-btn" id="jrResearch">🔬 Исследования</button></div>`;
    dlg.querySelector('.ind-x').onclick = close;
    dlg.querySelector('#jrResearch').onclick = () => { close(); window.QLValidate && window.QLValidate.listResearch(); };
    const listEl = dlg.querySelector('#jrList'), view = dlg.querySelector('#jrView');
    let items = [], sel = null;
    const renderList = (arr, snip) => {
      listEl.innerHTML = arr.length ? arr.map(it => `<div class="jr-it${it.id === sel ? ' on' : ''}${it.id === S.sessionId ? ' cur' : ''}" data-id="${esc(it.id)}">
        <div class="jr-t" data-noi18n>${esc(it.title || 'Чат')}</div>
        <div class="jr-m"><span data-noi18n>${esc(it.symbol || '')} ${esc(it.interval || '')}</span> · ${dt(it.updated)} · ${it.n} ${esc(T('сообщ.'))}${it.checks ? ` · ✓ ${it.checks}` : ''}${it.id === S.sessionId ? ` · <b>${esc(T('текущий'))}</b>` : ''}</div>
        ${snip && it.snippet ? `<div class="jr-s" data-noi18n>${esc(it.snippet)}</div>` : ''}</div>`).join('') : `<div class="ind-empty">${esc(T(snip ? 'Ничего не найдено.' : 'Чатов пока нет.'))}</div>`;
      listEl.querySelectorAll('.jr-it').forEach(d => { d.onclick = () => show(d.dataset.id); });
    };
    async function show(id) {
      sel = id; listEl.querySelectorAll('.jr-it').forEach(d => d.classList.toggle('on', d.dataset.id === id));
      const r = await get('/api/journal/' + encodeURIComponent(id)); if (!r.ok) { view.innerHTML = `<div class="ind-empty">${esc(r.error)}</div>`; return; }
      const j = r.journal;
      view.innerHTML = `<div class="jr-vh"><b data-noi18n>${esc(j.title || 'Чат')}</b><span class="sp"></span>
        <button class="ind-btn" data-a="cont">${id === S.sessionId ? 'Открыт в чате' : 'Продолжить этот чат'}</button><button class="ind-btn" data-a="md">⤓ Markdown</button><button class="ind-btn" data-a="ren" title="Переименовать">✎</button><button class="ind-btn" data-a="del" title="Удалить">🗑</button></div>
        <div class="jr-msgs" id="jrMsgs"></div>`;
      const box = view.querySelector('#jrMsgs');
      for (const e of j.events) {
        let d;
        if (e.k === 'user') { d = document.createElement('div'); d.className = 'msg user'; d.textContent = e.text; }
        else if (e.k === 'ai') { d = document.createElement('div'); d.className = 'msg ai'; d.innerHTML = A.md(e.text); }
        else if (e.k === 'run') { d = document.createElement('details'); d.className = 'run ' + (e.ok ? 'ok' : 'bad'); d.innerHTML = `<summary>▶ запуск на графике: <b>${e.ok ? 'OK' : 'ошибка'}</b></summary><pre>${esc(e.summary)}</pre>`; }
        else if (e.k === 'validation') d = validationCard(e);
        else if (e.k === 'research') d = researchCard(e);
        else if (e.k === 'error') { d = document.createElement('div'); d.className = 'msg err'; d.textContent = '⚠ ' + e.text; }
        if (d) box.appendChild(d);
      }
      view.querySelector('[data-a="cont"]').onclick = () => { if (id !== S.sessionId && window.QLChat) { window.QLChat.continueChat(id, j.events); } close(); };
      view.querySelector('[data-a="md"]').onclick = () => download(`panda-${(j.title || 'chat').replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40)}-${new Date(j.created).toISOString().slice(0, 10)}.md`, toMarkdown(j));
      view.querySelector('[data-a="ren"]').onclick = async () => { const t = prompt(T('Новое название чата'), j.title || ''); if (t && t.trim()) { await post('/api/journal-rename', { id, title: t.trim() }); await reload(); show(id); } };
      view.querySelector('[data-a="del"]').onclick = async () => {
        if (!confirm(T('Удалить этот чат из истории? Файл переносится в папку _deleted, его можно вернуть вручную.'))) return;
        const r2 = await post('/api/journal-delete', { id }); if (!r2.ok) { alert(r2.error); return; }
        if (id === S.sessionId) document.getElementById('newChatBtn').click();
        sel = null; view.innerHTML = `<div class="ind-empty">${esc(T('Удалено.'))}</div>`; await reload();
      };
    }
    async function reload() { const r = await get('/api/journal'); items = r.ok ? r.list : []; renderList(items); }
    let qt = null;
    dlg.querySelector('#jrQ').oninput = e => { clearTimeout(qt); const q = e.target.value.trim(); qt = setTimeout(async () => { if (q.length < 2) return renderList(items); const r = await get('/api/journal/search?q=' + encodeURIComponent(q)); renderList(r.ok ? r.hits : [], true); }, 250); };
    await reload();
    if (items.length) show(items.find(i => i.id === S.sessionId) ? S.sessionId : items[0].id);
    setTimeout(() => dlg.querySelector('#jrQ').focus(), 30);
  }
  const hb = document.getElementById('historyBtn'); if (hb) hb.onclick = open;
  window.QLJournal = { open, validationCard, researchCard, toMarkdown };
})();
