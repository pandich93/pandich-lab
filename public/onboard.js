// Pandich Lab — welcome tour for the first launch: what the app is, is it ready (charts + Panda), a guided tour
// over the real interface, and a first result in one click (an example strategy → honest validation, or a prompt for Panda).
// Shown once on a fresh install (ql.onboard = 'pending' → 'done'); reopened from Settings ("Тур по программе").
(() => {
  'use strict';
  const QA = window.QLApp || {};
  if (QA.EMBED) return; // multi-chart cells
  const D = window.pandichDesktop || null;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const T = s => (window.QLI18n ? window.QLI18n.t(s) : s);
  const KEY = 'ql.onboard';
  const get = () => { try { return localStorage.getItem(KEY); } catch { return 'done'; } };
  const set = v => { try { localStorage.setItem(KEY, v); } catch { /* storage unavailable */ } };
  // fresh install → remember it, so the tour survives the reload after the desktop setup wizard
  if (QA.FRESH && !get()) set('pending');

  const EXAMPLE = { file: 'strat_ema_atr.pine', name: 'Стратегия: пересечение EMA + ATR-стоп' };
  const PROMPT = 'Сделай стратегию: покупка, когда RSI(14) выходит из зоны перепроданности (выше 30) и цена выше EMA 200; продажа — зеркально. Стоп 1.5 ATR, тейк 3 ATR. Потом проверь её честно.';
  const STEPS = ['Что это', 'Готовность', 'Тур', 'Первый результат'];

  let ov = null, step = 0, health = null, busy = '', note = null;

  function open(at = 0) {
    if (ov) return;
    step = at; note = null;
    ov = document.createElement('div'); ov.className = 'ob-ov'; ov.id = 'obOv';
    ov.innerHTML = '<div class="ob-box" role="dialog" aria-label="Добро пожаловать"></div>';
    document.body.appendChild(ov);
    document.addEventListener('keydown', onKey, true);
    render();
    loadHealth(false);
  }
  function close(done = true) {
    if (!ov) return;
    document.removeEventListener('keydown', onKey, true);
    ov.remove(); ov = null;
    if (done) set('done');
  }
  function onKey(e) { if (e.key === 'Escape' && ov && !tl) { e.stopPropagation(); close(true); } }

  async function loadHealth(force) {
    try { health = await fetch(`/api/health${force ? '?force=1' : ''}`).then(r => r.json()); } catch (e) { health = { error: e.message }; }
    if (ov && step === 1) render();
  }
  const item = id => health && health.items ? health.items.find(i => i.id === id) : null;

  // ───────── steps ─────────
  function render() {
    const box = ov.querySelector('.ob-box');
    const dots = STEPS.map((t, k) => `<span class="ob-dot${k === step ? ' on' : k < step ? ' done' : ''}">${k < step ? '✓' : k + 1}</span><span class="ob-dt${k === step ? ' on' : ''}">${esc(T(t))}</span>`).join('<i class="ob-sep"></i>');
    box.innerHTML = `<div class="ob-head"><div class="ob-steps">${dots}</div><button class="ob-x" data-a="skip" title="Закрыть (Esc)">✕</button></div>
      <div class="ob-body">${[pageAbout, pageReady, pageTour, pageFirst][step]()}</div>
      <div class="ob-foot">${step > 0 ? '<button class="ob-btn" data-a="back">← Назад</button>' : '<button class="ob-btn ghost" data-a="skip">Пропустить</button>'}<span class="sp"></span>${footNext()}</div>`;
    box.querySelectorAll('[data-a]').forEach(b => { b.onclick = () => act(b.dataset.a, b); });
  }
  function footNext() {
    if (step === 0) return '<button class="ob-btn pri" data-a="next">Начать →</button>';
    if (step === 1) return '<button class="ob-btn pri" data-a="next">Дальше →</button>';
    if (step === 2) return '<button class="ob-btn" data-a="next">Пропустить тур</button><button class="ob-btn pri" data-a="tour">Показать интерфейс →</button>';
    return '<button class="ob-btn pri" data-a="done">Готово</button>';
  }

  function pageAbout() {
    return `<div class="ob-hero"><div class="ob-logo">P</div><div><h2>ИИ-лаборатория трейдера</h2>
      <p class="ob-sub">График, ИИ-ассистент и честный бэктест — бесплатно, открытый код, на твоём ПК.</p></div></div>
      <div class="ob-cards">
        <div class="ob-card"><b>Опиши идею словами</b><span>Panda напишет Pine-скрипт и сразу покажет его на графике.</span></div>
        <div class="ob-card"><b>Проверь стратегию честно</b><span>Сетка параметров, поправка на число попыток, проверка вне выборки и с издержками. Вердикт без приукрашивания.</span></div>
        <div class="ob-card"><b>Смотри рынок глубже</b><span>Market Profile, профиль объёма, VWAP от точки, алерты и сигналы в Telegram.</span></div>
      </div>
      <div class="ob-need"><b>Что нужно</b>
        <span>Графики, библиотека индикаторов и проверка стратегий работают сразу и бесплатно.</span>
        <span>Panda работает через твою подписку Claude (Pro или Max) или свой API-ключ Anthropic.</span>
        <span>MetaTrader 5 — по желанию (только Windows): котировки твоего брокера. Без него — графики Binance.</span></div>
      <p class="ob-warn">Pandich Lab — инструмент для исследований, а не торговый советник. Результаты на истории не гарантируют прибыль.</p>`;
  }

  function pageReady() {
    if (!health) return '<div class="ob-wait">Проверяю подключения…</div>';
    if (health.error) return `<div class="ob-row" data-s="err"><i></i><div><b>Сервер не ответил</b><span data-noi18n>${esc(health.error)}</span></div></div>`;
    const mt5 = item('mt5'), bn = item('binance'), cl = item('claude');
    const mt5ok = mt5 && mt5.state === 'ok', bnok = bn && bn.state === 'ok', mock = health.app && health.app.mock;
    const charts = mt5ok ? { s: 'ok', t: 'Графики: MetaTrader 5 подключён', d: mt5.summary }
      : bnok ? { s: 'ok', t: 'Графики: Binance (крипта)', d: 'Работают сразу. MetaTrader 5 можно подключить позже в настройках.' }
      : mock ? { s: 'ok', t: 'Графики: тестовые данные', d: 'Режим MOCK' }
      : { s: 'err', t: 'Графики: нет источника данных', d: (bn && bn.hint) || 'Проверьте интернет.' };
    let pandaHtml;
    if (!cl) pandaHtml = '';
    else if (cl.ready) pandaHtml = row('ok', 'Panda готова', 'Claude отвечает — можно просить индикаторы и стратегии.');
    else if (cl.missing) pandaHtml = row('err', 'Panda: Claude Code не установлен', 'Panda работает через программу Claude Code и твою подписку Claude (Pro или Max).',
      D ? '<button class="ob-btn pri" data-a="setup">Открыть мастер установки</button>' : '<button class="ob-btn pri" data-a="settings">Открыть настройки</button>');
    else if (cl.state === 'err') pandaHtml = row('err', 'Panda: ' + cl.summary, cl.hint || '',
      `${D ? '<button class="ob-btn pri" data-a="setup">Открыть мастер установки</button>' : ''}<button class="ob-btn${D ? '' : ' pri'}" data-a="test">${busy === 'test' ? T('Проверяю… (до 30 с)') : T('Проверить Panda')}</button>`);
    else pandaHtml = row('idle', 'Panda: Claude Code установлен, вход не проверен', 'Проверка отправит один короткий запрос через твою подписку.',
      `<button class="ob-btn pri" data-a="test" ${busy ? 'disabled' : ''}>${busy === 'test' ? T('Проверяю… (до 30 с)') : T('Проверить Panda')}</button>${D ? '<button class="ob-btn" data-a="setup">Мастер установки</button>' : ''}`);
    return `<h3>Всё ли готово</h3>
      ${row(charts.s, charts.t, charts.d)}
      ${pandaHtml}
      ${note ? `<div class="ob-note ${note.ok ? 'ok' : 'bad'}">${esc(note.text)}</div>` : ''}
      ${cl && !cl.ready ? '<p class="ob-hint">Можно продолжить и без Panda: графики, библиотека и честная проверка стратегий работают. Настроить Claude можно позже — в «Настройках».</p>' : ''}
      <div class="ob-rech"><button class="ob-btn ghost" data-a="recheck">↻ Проверить снова</button></div>`;
  }
  const row = (s, title, desc, acts = '') => `<div class="ob-row" data-s="${s}"><i></i><div><b>${esc(T(title))}</b><span>${esc(T(desc))}</span>${acts ? `<div class="ob-acts">${acts}</div>` : ''}</div></div>`;

  function pageTour() {
    return `<h3>Короткий тур</h3><p class="ob-p">Покажу на настоящем интерфейсе, где что находится: Panda, библиотека, график, панели, история и настройки. Шесть подсказок, меньше минуты.</p>
      <p class="ob-hint">Листать — кнопками или стрелками ← →, выйти — Esc.</p>`;
  }

  function pageFirst() {
    const cl = item('claude'), ready = !!(cl && cl.ready);
    return `<h3>Первый результат за минуту</h3>
      <div class="ob-cards two">
        <div class="ob-card"><b>Проверить пример стратегии</b><span>Добавлю на график простую стратегию (пересечение EMA + стоп по ATR) и открою честную проверку. Большинство «стратегий из соцсетей» её не проходят — и это полезно знать до того, как рискнуть деньгами.</span>
          <button class="ob-btn pri" data-a="example" ${busy ? 'disabled' : ''}>${busy === 'example' ? T('Загружаю…') : T('Добавить и проверить')}</button></div>
        <div class="ob-card"><b>Попросить Panda</b><span>Подставлю в чат пример запроса — отправь как есть или поменяй под свою идею.</span>
          <span class="ob-quote">${esc(T(PROMPT))}</span>
          <button class="ob-btn${ready ? ' pri' : ''}" data-a="prompt" ${ready ? '' : 'disabled'}>Подставить в чат</button>${ready ? '' : '<span class="ob-hint">Сначала нужно настроить Panda (шаг «Готовность»).</span>'}</div>
      </div>
      ${note ? `<div class="ob-note ${note.ok ? 'ok' : 'bad'}">${esc(note.text)}</div>` : ''}
      <p class="ob-hint">Тур можно пройти снова: «Настройки» → «Тур по программе».</p>`;
  }

  async function act(a) {
    if (a === 'skip') return close(true);
    if (a === 'back') { step = Math.max(0, step - 1); note = null; return render(); }
    if (a === 'next') { step = Math.min(STEPS.length - 1, step + 1); note = null; if (step === 1) loadHealth(false); return render(); }
    if (a === 'done') return close(true);
    if (a === 'recheck') { health = null; render(); return loadHealth(true); }
    if (a === 'settings') { close(false); window.QLSettings && window.QLSettings.open(); return; }
    if (a === 'setup') { try { await D.openSetup(); note = { ok: true, text: T('Открыто окно мастера установки. Когда закончишь — нажми «Проверить снова».') }; } catch (e) { note = { ok: false, text: e.message }; } return render(); }
    if (a === 'test') {
      if (busy) return; busy = 'test'; note = null; render();
      try {
        const r = await fetch('/api/health/claude-test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(x => x.json());
        health = r.health || health;
        note = r.test && r.test.ok ? { ok: true, text: T('Panda отвечает — вход и связь в порядке.') } : null;
      } catch (e) { note = { ok: false, text: e.message }; }
      busy = ''; return render();
    }
    if (a === 'tour') { hide(); tour(0); return; }
    if (a === 'example') return example();
    if (a === 'prompt') {
      close(true);
      if (window.QLChat && window.QLChat.prefill) window.QLChat.prefill(T(PROMPT), 'strategy');
    }
  }
  function hide() { if (ov) ov.style.display = 'none'; }
  function unhide() { if (ov) { ov.style.display = ''; render(); } }

  async function example() {
    if (busy) return; busy = 'example'; note = null; render();
    try {
      const L = window.QLLibrary, V = window.QLValidate, S = QA.S;
      if (!L || !V || !S) throw new Error(T('Интерфейс ещё загружается — попробуй через пару секунд.'));
      const r = await fetch('/api/library/file?f=' + encodeURIComponent(EXAMPLE.file)).then(x => x.json());
      if (!r || !r.code) throw new Error(T('Не удалось загрузить пример из библиотеки.'));
      let s = S.scripts.find(x => x.code === r.code); // already on the chart (tour opened again) → reuse it
      if (!s) s = await L.addScript(EXAMPLE.name, r.code);
      if (s.error) throw new Error(s.error);
      busy = ''; close(true);
      await V.openSetup(s);
    } catch (e) { busy = ''; note = { ok: false, text: e.message }; if (ov) render(); }
  }

  // ───────── coach marks over the real interface ─────────
  const TOUR = [
    { sel: '#composer', before: () => QA.setChatCollapsed && QA.setChatCollapsed(false, { focus: false }), title: 'Panda — ИИ-ассистент',
      text: 'Опиши идею обычными словами: «стратегия на пробой азиатской сессии». Panda напишет Pine-скрипт, запустит его на этом графике и по просьбе проверит честно.' },
    { sel: '#addScriptBtn', title: 'Индикаторы и стратегии', text: 'Библиотека готовых скриптов и твои сохранённые. Любую стратегию отсюда можно сразу проверить.' },
    { sel: '#dtools, #chartWrap', title: 'График', text: 'Символ и таймфрейм — в панели сверху (или просто начни печатать на графике). Слева — инструменты рисования, включая профиль объёма и VWAP. Правый клик — меню: алерт, Market Profile, проверка стратегии.' },
    { sel: '#rail', title: 'Правые панели', text: 'Список и алерты, Pine-редактор, дерево объектов, окно данных, сигналы Watch. Внизу Pine-редактора — тестер стратегии с кнопкой «✓ Проверить честно».' },
    { sel: '#historyBtn', before: () => QA.setChatCollapsed && QA.setChatCollapsed(false, { focus: false }), title: 'История', text: 'Все чаты с Panda и отчёты проверок сохраняются: можно найти, продолжить или выгрузить в Markdown.' },
    { sel: '#settingsBtn', title: 'Настройки', text: 'Статус подключений (Claude, MT5, Binance, Telegram) и подсказки, что делать, если что-то не работает. Отсюда же — этот тур.' },
  ];
  let tl = null, ti = 0;
  function tour(k) {
    ti = k;
    if (!tl) {
      tl = document.createElement('div'); tl.className = 'ob-tour';
      tl.innerHTML = '<div class="ob-hole"></div><div class="ob-tip" role="dialog"></div>';
      document.body.appendChild(tl);
      window.addEventListener('resize', place);
      document.addEventListener('keydown', tourKey, true);
    }
    const st = TOUR[ti];
    try { st.before && st.before(); } catch { /* optional */ }
    const tip = tl.querySelector('.ob-tip');
    tip.innerHTML = `<div class="ob-tn">${ti + 1} / ${TOUR.length}</div><b>${esc(T(st.title))}</b><p>${esc(T(st.text))}</p>
      <div class="ob-tf"><button class="ob-btn ghost" data-t="end">Закончить</button><span class="sp"></span>${ti > 0 ? '<button class="ob-btn" data-t="prev">←</button>' : ''}<button class="ob-btn pri" data-t="next">${ti < TOUR.length - 1 ? T('Дальше →') : T('Готово')}</button></div>`;
    tip.querySelectorAll('[data-t]').forEach(b => { b.onclick = () => tourGo(b.dataset.t); });
    place(); setTimeout(place, 300); // after the chat panel width transition
  }
  function tourGo(t) {
    if (t === 'prev') return tour(Math.max(0, ti - 1));
    if (t === 'next' && ti < TOUR.length - 1) return tour(ti + 1);
    endTour(t === 'next');
  }
  function tourKey(e) {
    if (!tl) return;
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); endTour(false); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); tourGo('next'); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); tourGo('prev'); }
  }
  function endTour(finished) {
    if (!tl) return;
    window.removeEventListener('resize', place); document.removeEventListener('keydown', tourKey, true);
    tl.remove(); tl = null;
    if (ov) { step = 3; note = null; unhide(); } // finished or not — on to the first result
  }
  function place() {
    if (!tl) return;
    const hole = tl.querySelector('.ob-hole'), tip = tl.querySelector('.ob-tip');
    // union of the matched elements (e.g. drawing toolbar + chart)
    const rs = [...document.querySelectorAll(TOUR[ti].sel)].map(e => e.getBoundingClientRect()).filter(b => b.width || b.height);
    const r = rs.length ? { left: Math.min(...rs.map(b => b.left)), top: Math.min(...rs.map(b => b.top)), right: Math.max(...rs.map(b => b.right)), bottom: Math.max(...rs.map(b => b.bottom)) } : null;
    const vw = innerWidth, vh = innerHeight, pad = 6, gap = 14;
    if (!r) { // element not on screen → tip in the centre, no hole
      hole.style.display = 'none'; tip.style.left = Math.max(12, (vw - tip.offsetWidth) / 2) + 'px'; tip.style.top = Math.max(12, (vh - tip.offsetHeight) / 2) + 'px'; return;
    }
    hole.style.display = '';
    const x = Math.max(4, r.left - pad), y = Math.max(4, r.top - pad), w = Math.min(vw - 8, r.right + pad) - x, h = Math.min(vh - 8, r.bottom + pad) - y;
    Object.assign(hole.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    const clampY = v => Math.min(Math.max(12, v), vh - th - 12), clampX = v => Math.min(Math.max(12, v), vw - tw - 12);
    let L, Tp;
    if (x + w + gap + tw <= vw - 12) { L = x + w + gap; Tp = clampY(y); }            // right of the target
    else if (x - gap - tw >= 12) { L = x - gap - tw; Tp = clampY(y); }               // left
    else if (y + h + gap + th <= vh - 12) { L = clampX(x); Tp = y + h + gap; }        // below
    else if (y - gap - th >= 12) { L = clampX(x); Tp = y - gap - th; }                // above
    else { L = clampX(x + w / 2 - tw / 2); Tp = clampY(y + h / 2 - th / 2); }         // big target: inside it
    tip.style.left = L + 'px'; tip.style.top = Tp + 'px';
  }

  // ───────── auto-start on a fresh install, once the window is actually visible ─────────
  function autoStart() {
    if (get() !== 'pending') return;
    const go = () => setTimeout(() => { if (get() === 'pending' && !ov && !tl) open(0); }, 900);
    if (document.visibilityState === 'visible') go();
    else document.addEventListener('visibilitychange', function f() { if (document.visibilityState === 'visible') { document.removeEventListener('visibilitychange', f); go(); } });
  }
  if (document.readyState === 'complete') autoStart(); else window.addEventListener('load', autoStart);

  window.QLOnboard = { open, close, tour: () => tour(0) };
})();
