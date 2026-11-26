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
    <div class="st-foot"><span class="muted st-fn" id="stFootNote">Не работает? Скопируйте диагностику и отправьте разработчику.</span>
      <button class="st-btn" id="stCopy">⧉ Скопировать диагностику</button><button class="st-btn" id="stSave">⤓ Сохранить .txt</button></div>
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('mousedown', e => { if (e.target === modal) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.classList.contains('hidden')) close(); });
  $('stClose').onclick = close;
  $('stRecheck').onclick = () => refresh(true);
  $('stCopy').onclick = () => copyDiag();
  $('stSave').onclick = () => saveDiag();

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
      ${showHint ? `<div class="st-hint">${esc(it.hint)}</div>` : ''}
      ${(it.cmds || []).map(c => `<div class="st-cmd"><span class="muted">${esc(c.label)}:</span><code>${esc(c.text)}</code><button class="st-mini" data-copy="${esc(c.text)}">Копировать</button></div>`).join('')}
      ${it.details && it.details.length ? `<div class="st-kv">${it.details.map(([k, v]) => `<span>${esc(k)}</span><span>${esc(v)}</span>`).join('')}</div>` : ''}
      ${n ? `<div class="st-note ${n.ok ? 'ok' : 'bad'}">${esc(n.text)}${n.out ? `<pre>${esc(n.out)}</pre>` : ''}</div>` : ''}
      ${(it.actions || []).length || it.link ? `<div class="st-acts">${(it.actions || []).map(a => { const A = ACT[a] || { label: a }; return `<button class="st-btn${A.primary ? ' pri' : ''}" data-act="${a}" data-item="${it.id}" ${ST.busy[a] ? 'disabled' : ''}>${esc(ST.busy[a] ? (A.busy || '…') : A.label)}</button>`; }).join('')}${it.link ? `<a class="st-btn" href="${esc(it.link.url)}" target="_blank" rel="noopener">${esc(it.link.label)} ↗</a>` : ''}</div>` : ''}
    </div>`;
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
    const n = ST.notes.app;
    return `<div class="st-card st-app"><div class="st-row"><b>Приложение</b></div>
      <div class="st-kv">${kv.map(([k, v]) => `<span>${esc(k)}</span><span>${esc(v)}</span>`).join('')}</div>
      ${n ? `<div class="st-note ${n.ok ? 'ok' : 'bad'}">${esc(n.text)}</div>` : ''}${acts}</div>`;
  }

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
    const au = $('stAuto'); if (au) au.onchange = async () => { ST.desk.autostart = await D.setAutostart(au.checked); };
  }
  async function desk(fn, btn) {
    if (!D || !D[fn]) return;
    if (fn === 'restartServer') { btn.disabled = true; btn.textContent = 'Перезапускаю…'; D.restartServer(); return; } // window reloads by itself
    if (fn === 'checkUpdates') { btn.disabled = true; btn.textContent = 'Проверяю…'; const r = await D.checkUpdates().catch(e => ({ ok: false, text: e.message })); ST.notes.app = { ok: r.ok, text: r.text }; render(); return; }
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

  // background status for the gear dot: soon after start, then every 3 min
  setTimeout(() => refresh(false), 2500);
  ST.timer = setInterval(() => { if (modal.classList.contains('hidden')) refresh(false); }, 180000);

  window.QLSettings = { open, close, refresh };
})();
