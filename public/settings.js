// Pandich Lab — Settings: connection status (Claude Code, MT5, Binance, internet, Telegram) with plain-language fixes.
// Same panel in the browser and in the desktop app; desktop adds app actions via window.pandichDesktop (app-preload.js).
(() => {
  'use strict';
  const QA = window.QLApp || {};
  if (QA.EMBED) return; // multi-chart cells: settings live in the main window only
  const D = window.pandichDesktop || null;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ST = { health: null, desk: null, busy: {}, notes: {}, timer: null };

  async function req(path, body) {
    const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json() : await r.text();
    if (!r.ok) throw new Error((data && data.error) || `HTTP ${r.status}`);
    return data;
  }

  // ── topbar gear with an overall status dot
  const GEAR = '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="2.6"/><path d="M10 1.8v2.3M10 15.9v2.3M18.2 10h-2.3M4.1 10H1.8M15.8 4.2l-1.6 1.6M5.8 14.2l-1.6 1.6M15.8 15.8l-1.6-1.6M5.8 5.8L4.2 4.2"/><circle cx="10" cy="10" r="5.6"/></svg>';
  const gear = document.createElement('button');
  gear.id = 'settingsBtn'; gear.className = 'st-gear'; gear.title = 'Настройки и подключения';
  gear.innerHTML = `${GEAR}<span>Настройки</span><i class="st-dot" data-s="idle"></i>`;
  const clock = $('clock'); if (clock) clock.before(gear); else document.querySelector('.topbar')?.appendChild(gear);
  gear.onclick = () => open();

  // ── modal
  const modal = document.createElement('div');
  modal.className = 'lib-modal st-modal hidden'; modal.id = 'stModal';
  modal.innerHTML = `<div class="st-box" role="dialog" aria-label="Настройки">
    <div class="st-top"><b>Настройки и подключения</b><div class="spacer"></div>
      <button class="st-btn" id="stRecheck">↻ Проверить всё</button><button class="lib-x" id="stClose" title="Закрыть (Esc)">✕</button></div>
    <div class="st-body" id="stBody"><div class="st-wait">Проверяю подключения…</div></div>
    <div class="st-foot"><span class="muted st-fn" id="stFootNote">Не работает? Сообщите о проблеме — диагностика подставится сама (без путей, логинов и токенов).</span>
      <button class="st-btn pri" id="stIssue" title="Откроется GitHub: проверьте текст и нажмите «Submit new issue»">⚑ Сообщить о проблеме</button><button class="st-btn" id="stCopy">⧉ Скопировать диагностику</button><button class="st-btn" id="stSave">⤓ Сохранить .txt</button></div>
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('mousedown', e => { if (e.target === modal) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.classList.contains('hidden')) close(); });
  $('stClose').onclick = close;
  $('stRecheck').onclick = () => refresh(true);
  $('stCopy').onclick = () => copyDiag();
  $('stSave').onclick = () => saveDiag();
  $('stIssue').onclick = () => reportIssue();

  function open() { modal.classList.remove('hidden'); render(); refresh(true); if (D) D.info().then(i => { ST.desk = i; render(); }).catch(() => {}); }
  function close() { modal.classList.add('hidden'); }

  async function refresh(force) {
    try { ST.health = await req(`/api/health${force ? '?force=1' : ''}`); }
    catch (e) { ST.health = { error: e.message }; }
    paintDot(); if (!modal.classList.contains('hidden')) render();
  }
  function paintDot() {
    const h = ST.health, dot = gear.querySelector('.st-dot');
    const s = !h || h.error ? 'err' : h.overall;
    dot.dataset.s = s;
    gear.title = s === 'ok' ? 'Настройки — всё подключено' : s === 'err' ? 'Есть проблема с подключением — нажмите, чтобы посмотреть' : s === 'warn' ? 'Есть предупреждения — нажмите, чтобы посмотреть' : 'Настройки и подключения';
  }

  const ACT = {
    'claude.test': { label: 'Проверить Panda', busy: 'Проверяю… (до 30 с)', primary: true },
    'claude.login': { label: 'Войти в Claude' },
    'claude.install': { label: 'Установить Claude Code', busy: 'Устанавливаю… (1–3 мин)', primary: true },
    'mt5.reconnect': { label: 'Переподключить', busy: 'Подключаюсь…' },
    'mt5.install': { label: 'Установить модуль', busy: 'Устанавливаю… (до 5 мин)', primary: true },
    'git.install': { label: 'Установить Git Bash', busy: 'Скачиваю и ставлю… (1–3 мин)', primary: true },
    'tg.setup': { label: 'Настроить' },
    'tg.test': { label: 'Тестовое сообщение', busy: 'Отправляю…' },
  };
  const STATE_TXT = { ok: 'работает', warn: 'внимание', err: 'проблема', idle: 'не проверено', off: 'выключено' };

  async function doAction(id, item) {
    if (ST.busy[id]) return;
    ST.busy[id] = true; ST.notes[item] = null; render();
    try {
      if (id === 'claude.test') {
        const r = await req('/api/health/claude-test', {}); ST.health = r.health;
        ST.notes.claude = r.test.ok ? { ok: true, text: `Panda отвечает — вход и связь в порядке (${(r.test.ms / 1000).toFixed(1)} с).` } : null; // failure is shown on the card itself
      } else if (id === 'claude.login') {
        const r = await req('/api/claude/login', {});
        ST.notes.claude = r.ok ? { ok: true, text: 'Открыто окно Claude Code. Войдите через подписку Claude (подтверждение придёт в браузере), закройте окно и нажмите «Проверить Panda».' } : { ok: false, text: r.error };
      } else if (id === 'claude.install') {
        const r = await req('/api/claude/install', {}); ST.health = r.health;
        ST.notes.claude = r.ok ? { ok: true, text: 'Claude Code установлен. Теперь нажмите «Войти в Claude».' } : { ok: false, text: 'Установка не удалась. Подробности ниже — или установите вручную командой из карточки.', out: r.out };
      } else if (id === 'mt5.reconnect') {
        const r = await req('/api/mt5/reconnect', {}); ST.health = r.health;
        const it = r.health.items.find(i => i.id === 'mt5');
        ST.notes.mt5 = it && it.state === 'ok' ? { ok: true, text: 'MT5 подключён. Символы брокера доступны в поиске.' } : { ok: false, text: it ? it.summary : 'Не удалось подключиться' };
        if (it && it.state === 'ok' && QA.loadSymbols) try { QA.loadSymbols(); } catch { /* optional */ }
      } else if (id === 'mt5.install') {
        const r = await req('/api/mt5/install', {}); ST.health = r.health;
        ST.notes.mt5 = r.ok ? { ok: true, text: 'Модуль MetaTrader5 установлен.' } : { ok: false, text: 'Не удалось установить модуль.', out: r.out };
      } else if (id === 'git.install') {
        const r = await req('/api/git/install', {}); ST.health = r.health;
        ST.notes.claude = r.ok ? { ok: true, text: 'Git Bash установлен — Panda сможет запускать код на графике.' } : { ok: false, text: 'Не удалось установить Git Bash.', out: r.out };
      } else if (id === 'tg.setup') {
        close(); window.QLPanels && window.QLPanels.show('watch', true);
      } else if (id === 'tg.test') {
        const r = await req('/api/telegram/test', {});
        ST.notes.telegram = r.ok ? { ok: true, text: 'Сообщение отправлено — проверьте Telegram.' } : { ok: false, text: r.error };
      }
    } catch (e) { ST.notes[item] = { ok: false, text: e.message }; }
    ST.busy[id] = false; paintDot(); render();
  }

  function card(it) {
    const showHint = it.hint && it.state !== 'ok';
    const n = ST.notes[it.id];
    return `<div class="st-card" data-s="${it.state}">
      <div class="st-row"><i class="st-dot" data-s="${it.state}"></i><b>${esc(it.title)}</b><span class="st-badge" data-s="${it.state}">${STATE_TXT[it.state] || it.state}</span></div>
      <div class="st-sum">${esc(it.summary)}</div>
      ${it.auth ? authBlock(it.auth) : ''}
      ${showHint ? `<div class="st-hint">${esc(it.hint)}</div>` : ''}
      ${(it.cmds || []).map(c => `<div class="st-cmd"><span class="muted">${esc(c.label)}:</span><code>${esc(c.text)}</code><button class="st-mini" data-copy="${esc(c.text)}">Копировать</button></div>`).join('')}
      ${it.details && it.details.length ? `<div class="st-kv">${it.details.map(([k, v]) => `<span>${esc(k)}</span><span>${esc(v)}</span>`).join('')}</div>` : ''}
      ${n ? `<div class="st-note ${n.ok ? 'ok' : 'bad'}">${esc(n.text)}${n.out ? `<pre>${esc(n.out)}</pre>` : ''}</div>` : ''}
      ${(it.actions || []).length || it.link ? `<div class="st-acts">${(it.actions || []).map(a => { const A = ACT[a] || { label: a }; return `<button class="st-btn${A.primary ? ' pri' : ''}" data-act="${a}" data-item="${it.id}" ${ST.busy[a] ? 'disabled' : ''}>${esc(ST.busy[a] ? (A.busy || '…') : A.label)}</button>`; }).join('')}${it.link ? `<a class="st-btn" href="${esc(it.link.url)}" target="_blank" rel="noopener">${esc(it.link.label)} ↗</a>` : ''}</div>` : ''}
    </div>`;
  }

  // Claude Code sign-in: the user's own choice — subscription or own API key
  function authBlock(a) {
    const api = a.mode === 'apikey';
    return `<div class="st-auth"><span class="muted">Вход:</span>
      <label><input type="radio" name="stAuth" value="subscription" ${api ? '' : 'checked'}> Подписка Claude</label>
      <label><input type="radio" name="stAuth" value="apikey" ${api ? 'checked' : ''}> Свой API-ключ</label></div>
      ${api ? `<div class="st-keyrow"><input type="password" id="stKey" placeholder="${a.key ? 'Сохранён: ' + esc(a.key) + (a.keySource === 'environment' ? ' (из окружения)' : '') : 'sk-ant-…'}" autocomplete="off" spellcheck="false">
        <button class="st-btn pri" id="stKeySave">Сохранить</button>${a.keySource === 'settings' ? '<button class="st-btn" id="stKeyDel" title="Удалить сохранённый ключ">Удалить</button>' : ''}</div>
        <div class="st-keyhint muted">Ключ берётся в <a href="https://platform.claude.com/" target="_blank" rel="noopener">Claude Console</a> (раздел API keys), оплата — по расходу токенов с вашего счёта Anthropic. Хранится только на этом компьютере.</div>` :
        '<div class="st-keyhint muted">Запросы Panda расходуют лимиты вашей подписки Pro или Max (отдельный месячный кредит для программного использования).</div>'}`;
  }
  async function saveAuth(body, note) {
    try { const r = await req('/api/claude/auth', body); ST.health = r.health; ST.notes.claude = note ? { ok: true, text: note } : null; }
    catch (e) { ST.notes.claude = { ok: false, text: e.message }; }
    paintDot(); render();
  }

  function appCard() {
    const a = (ST.health && ST.health.app) || {}, d = ST.desk;
    const kv = [];
    if (d) kv.push(['Версия', `${d.version} (приложение)`], ['Система', `${d.platform}/${d.arch}`], ['Порт', String(a.port || d.port || '—')], ['Данные', d.dataDir], ['Логи', d.logDir]);
    else kv.push(['Версия', `веб · сборка ${a.ui || '—'}`], ['Система', `${a.platform || '—'}/${a.arch || '—'} · Node ${a.node || '—'}`], ['Адрес', location.host], ['Данные', a.home || '—']);
    const acts = d
      ? `<label class="st-check"><input type="checkbox" id="stAuto" ${d.autostart ? 'checked' : ''}> Запускать при входе в систему</label>
         <div class="st-acts"><button class="st-btn" data-d="checkUpdates">Проверить обновления</button><button class="st-btn" data-d="openSetup">Мастер настройки</button><button class="st-btn" data-d="openLogs">Открыть логи</button><button class="st-btn" data-d="openData">Папка данных</button><button class="st-btn" data-d="restartServer">Перезапустить сервер</button></div>`
      : `<div class="st-acts"><button class="st-btn" data-w="restart">Перезапустить сервер</button></div>`;
    const n = ST.notes.app, u = d && (ST.upd || d.update);
    if (u) kv.push(['Обновления', updText(u)]);
    const updBtn = !u ? '' : u.state === 'ready' ? `<button class="st-btn pri" data-upd="install">⬆ Перезапустить и обновить до ${esc(u.version)}</button>`
      : u.state === 'manual' ? `<a class="st-btn pri" href="https://github.com/pandich93/pandich-lab/releases/latest/download/PandichLab-mac.dmg" target="_blank" rel="noopener">Скачать ${esc(u.version)} ↗</a>` : '';
    const L = window.QLI18n, langSel = L ? `<div class="st-lang"><span class="muted">Язык интерфейса</span><select id="stLang">${Object.entries(L.langs).map(([k, n]) => `<option value="${k}" ${k === L.lang ? 'selected' : ''}>${n}</option>`).join('')}</select></div>` : '';
    return `<div class="st-card st-app"><div class="st-row"><b>Приложение</b></div>${langSel}${updBtn ? `<div class="st-acts">${updBtn}</div>` : ''}
      <div class="st-kv">${kv.map(([k, v]) => `<span>${esc(k)}</span><span>${esc(v)}</span>`).join('')}</div>
      ${n ? `<div class="st-note ${n.ok ? 'ok' : 'bad'}">${esc(n.text)}</div>` : ''}${acts}</div>`;
  }

  function updText(u) {
    return { off: `выключены — ${u.reason}`, idle: 'проверка при открытии приложения и каждый час', checking: 'проверяю…', none: `последняя версия${u.checkedAt ? ' · проверено ' + new Date(u.checkedAt).toLocaleTimeString() : ''}`,
      downloading: `скачиваю ${u.version}… ${u.percent}%`, ready: `версия ${u.version} скачана и готова к установке`, manual: `доступна ${u.version} — обновите вручную`, error: `ошибка проверки: ${u.error}` }[u.state] || u.state;
  }
  // desktop: live update state from the main process → Settings + a pill in the top bar when ready
  const pill = document.createElement('button'); pill.className = 'st-upd hidden'; gear.before(pill);
  pill.onclick = () => { if (ST.upd && ST.upd.state === 'ready') D.installUpdate(); else open(); };
  function onUpd(u) {
    ST.upd = u;
    const show = u && (u.state === 'ready' || u.state === 'manual');
    pill.classList.toggle('hidden', !show);
    if (show) { pill.textContent = u.state === 'ready' ? `⬆ Обновить до ${u.version}` : `Доступна ${u.version}`; pill.title = u.state === 'ready' ? 'Перезапустить приложение и установить обновление' : 'Открыть настройки'; }
    if (!modal.classList.contains('hidden')) render();
  }
  if (D) { window.addEventListener('ql:update', e => onUpd(e.detail)); if (D.updateState) D.updateState().then(onUpd).catch(() => {}); }

  function render() {
    const body = $('stBody'), h = ST.health;
    if (!h) { body.innerHTML = '<div class="st-wait">Проверяю подключения…</div>'; return; }
    if (h.error) { body.innerHTML = `<div class="st-banner" data-s="err">Сервер Pandich Lab не отвечает (${esc(h.error)}). ${D ? 'Нажмите «Перезапустить сервер» ниже или в меню трея.' : 'Перезапустите start.bat / start.sh.'}</div>${appCard()}`; bind(); return; }
    const probs = h.items.filter(i => i.state === 'err' || i.state === 'warn');
    const banner = !probs.length ? '<div class="st-banner" data-s="ok">✓ Всё подключено и работает</div>'
      : `<div class="st-banner" data-s="${h.overall}">${probs.length === 1 ? 'Одна проблема' : `Проблем: ${probs.length}`} — ниже написано, что сделать.</div>`;
    body.innerHTML = banner + `<div class="st-grid">${h.items.map(card).join('')}</div>` + appCard() + `<div class="st-when muted">Проверено ${new Date(h.t).toLocaleTimeString()}</div>`;
    bind();
  }
  function bind() {
    const body = $('stBody');
    body.querySelectorAll('[data-act]').forEach(b => { b.onclick = () => doAction(b.dataset.act, b.dataset.item); });
    body.querySelectorAll('[data-copy]').forEach(b => { b.onclick = async () => { await copyText(b.dataset.copy); b.textContent = 'Скопировано'; setTimeout(() => { b.textContent = 'Копировать'; }, 1500); }; });
    body.querySelectorAll('[data-d]').forEach(b => { b.onclick = () => desk(b.dataset.d, b); });
    body.querySelectorAll('[data-w]').forEach(b => { b.onclick = async () => { b.disabled = true; b.textContent = 'Перезапускаю…'; try { await req('/api/admin/restart', {}); } catch { /* connection drops */ } setTimeout(() => location.reload(), 3500); }; });
    body.querySelectorAll('[data-upd]').forEach(b => { b.onclick = () => { b.disabled = true; b.textContent = 'Перезапускаю…'; D.installUpdate(); }; });
    body.querySelectorAll('input[name="stAuth"]').forEach(r => { r.onchange = () => saveAuth({ mode: r.value }, r.value === 'apikey' ? 'Режим «Свой API-ключ». Вставьте ключ и нажмите «Сохранить», затем «Проверить Panda».' : 'Режим «Подписка Claude». Нажмите «Проверить Panda».'); });
    const ks = $('stKeySave'); if (ks) ks.onclick = () => { const v = $('stKey').value.trim(); if (!v) { $('stKey').focus(); return; } saveAuth({ mode: 'apikey', key: v }, 'Ключ сохранён. Нажмите «Проверить Panda».'); };
    const kd = $('stKeyDel'); if (kd) kd.onclick = () => saveAuth({ mode: 'apikey', clearKey: true }, 'Сохранённый ключ удалён.');
    const ki = $('stKey'); if (ki) ki.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); ks.click(); } };
    const sl = $('stLang'); if (sl) sl.onchange = () => window.QLI18n.setLang(sl.value);
    const au = $('stAuto'); if (au) au.onchange = async () => { ST.desk.autostart = await D.setAutostart(au.checked); };
  }
  async function desk(fn, btn) {
    if (!D || !D[fn]) return;
    if (fn === 'restartServer') { btn.disabled = true; btn.textContent = 'Перезапускаю…'; D.restartServer(); return; } // window reloads by itself
    if (fn === 'checkUpdates') { btn.disabled = true; btn.textContent = 'Проверяю…'; const r = await D.checkUpdates().catch(e => ({ ok: false, text: e.message })); ST.notes.app = { ok: r.ok, text: r.text }; if (D.updateState) ST.upd = await D.updateState().catch(() => ST.upd); render(); return; }
    D[fn]();
  }

  // ── diagnostics report (masked on the server: home path, user name, tokens, account number)
  async function diagText() {
    let t = await req('/api/diagnostics');
    if (D) {
      const i = ST.desk || await D.info().catch(() => null);
      const tail = await D.logTail().catch(() => '');
      t = t.replace('\n\n── Статус ──', `\ndesktop ${i ? `${i.version} · claude: ${i.claude || 'не найден'} · autostart ${i.autostart ? 'on' : 'off'}` : '?'}\n\n── Статус ──`);
      if (tail) t += `\n\n── Лог приложения (server.log, последние строки) ──\n${tail}`;
    }
    return t + `\n\nbrowser: ${navigator.userAgent}`;
  }
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; }
    catch {
      const ta = Object.assign(document.createElement('textarea'), { value: t }); ta.style.cssText = 'position:fixed;left:-9999px';
      document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch { /* no */ } ta.remove(); return ok;
    }
  }
  async function copyDiag() {
    const b = $('stCopy'); b.disabled = true; b.textContent = 'Собираю…';
    try { const ok = await copyText(await diagText()); b.textContent = ok ? '✓ Скопировано — вставьте в сообщение' : 'Не удалось — используйте «Сохранить .txt»'; }
    catch (e) { b.textContent = 'Ошибка: ' + e.message; }
    setTimeout(() => { b.disabled = false; b.textContent = '⧉ Скопировать диагностику'; }, 2500);
  }
  async function saveDiag() {
    try {
      const blob = new Blob([await diagText()], { type: 'text/plain;charset=utf-8' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `pandich-lab-diagnostics-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.txt` });
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) { $('stFootNote').textContent = 'Не удалось сохранить: ' + e.message; }
  }

  // ── "Report a problem": opens a prefilled GitHub issue (the user reviews and submits it; nothing is sent by us).
  // The status part of the diagnostics goes into the issue text; the full report (with log) is copied to the clipboard.
  const ISSUES = 'https://github.com/pandich93/pandich-lab/issues/new';
  async function reportIssue() {
    const b = $('stIssue'), t = s => (window.QLI18n ? window.QLI18n.t(s) : s);
    b.disabled = true;
    try {
      const full = await diagText().catch(e => 'diagnostics error: ' + e.message);
      const copied = await copyText(full);
      const short = full.split('\n\n── ')[0] + (full.includes('── Статус ──') ? '\n\n── ' + full.split('\n\n── ').find(x => x.startsWith('Статус')) : '');
      const head = `### ${t('Что случилось')}\n\n\n### ${t('Что делали перед этим (шаги)')}\n1. \n\n### ${t('Что ожидали увидеть')}\n\n\n### ${t('Диагностика')}\n`;
      const tail = copied ? `\n\n_${t('Полная диагностика с логом скопирована в буфер обмена — при необходимости вставьте её ниже.')}_` : '';
      // a public issue gets no install folders: drop the app path, hide any remaining absolute path
      const pub = short.replace(/ · home [^\n]*/, '').replace(/\b[A-Za-z]:[\\/][^\n·,;)]*?(?=\s·|$|[,;)])/gm, '<path>').replace(/(^|[\s(])\/(?:Users|home|Volumes|opt|mnt)\/[^\s·,;)]*/g, '$1<path>');
      let lines = pub.split('\n'), body;
      do { body = head + '```\n' + lines.join('\n') + '\n```' + tail; lines = lines.slice(0, Math.floor(lines.length * 0.8)); }
      while (encodeURIComponent(body).length > 6500 && lines.length > 3);
      window.open(`${ISSUES}?body=${encodeURIComponent(body)}`, '_blank', 'noopener');
      $('stFootNote').textContent = t('Открылась страница GitHub: опишите проблему и нажмите «Submit new issue». Нужен аккаунт GitHub.');
    } finally { setTimeout(() => { b.disabled = false; }, 1500); }
  }

  // background status for the gear dot: soon after start, then every 3 min
  setTimeout(() => refresh(false), 2500);
  ST.timer = setInterval(() => { if (modal.classList.contains('hidden')) refresh(false); }, 180000);

  window.QLSettings = { open, close, refresh };
})();
