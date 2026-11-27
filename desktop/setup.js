'use strict';
// First-run wizard: one button installs everything the platform needs, then waits for the Claude sign-in.
// Windows: Claude Code → Git Bash → (optional) Python 3.13 + MetaTrader5 module → sign-in. macOS: Claude Code → sign-in.
const $ = id => document.getElementById(id);
const api = window.setup;
const WIN = api.platform === 'win32', MAC = api.platform === 'darwin';
const logBox = $('logBox');
// texts: Русский key → current language (i18n-desktop.js); step messages are stored as keys and translated at render time
const L10N = window.PLI18N;
let LANG = 'ru', tr = L10N.make(LANG);
const M = (k, ...a) => ({ k, a });
const txt = m => !m ? '' : typeof m === 'object' ? tr(m.k, ...m.a.map(x => (x && typeof x === 'object') ? txt(x) : x)) : tr(m);
function logLine(l) { logBox.textContent += l + '\n'; logBox.scrollTop = logBox.scrollHeight; }
api.onLog(logLine);
$('logT').onclick = () => { const v = logBox.style.display === 'block'; logBox.style.display = v ? 'none' : 'block'; $('logT').textContent = (v ? '▸' : '▾') + ' ' + tr('Подробный журнал'); };

const S = { st: null, state: {}, msg: {}, bad: {}, running: false, loginTimer: null, loginUntil: 0 };
const mt5On = () => WIN && $('mt5').checked;

const STEPS = [
  { id: 'claude', title: 'Claude Code', desc: 'Программа, через которую работает Panda (официальный установщик Anthropic).',
    done: st => !!st.claude.path, info: st => st.claude.path ? tr('Установлен') + (st.claude.version ? ' · ' + st.claude.version : '') : '',
    run: async () => { logLine('▶ Claude Code'); const r = await api.installClaude(); S.st = r.status; return r.ok && !!r.status.claude.path ? '' : M('Установщик завершился с ошибкой — откройте журнал ниже.'); } },
  { id: 'git', win: true, title: 'Git Bash', desc: 'Нужен Panda, чтобы запускать код на графике (PortableGit, ~60 МБ).',
    done: st => !!st.git, info: st => st.git ? tr('Найден') : '',
    run: async () => { logLine('▶ Git Bash (PortableGit)'); const r = await api.installGit(); S.st = r.status; if (r.out) logLine(r.out); return r.ok ? '' : M('Не удалось: {0}', r.error || M('ошибка')); } },
  { id: 'python', win: true, mt5: true, title: 'Python 3', desc: 'Нужен для связи с MetaTrader 5 (python.org, ~30 МБ).',
    done: st => !!(st.python && st.python.cmd), info: st => st.python && st.python.cmd ? `Python ${st.python.version}` : (st.python && st.python.found ? tr('Найден неподходящий ({0}) — поставим 3.13', st.python.found.unsuitable) : ''),
    run: async () => { logLine('▶ Python 3.13'); const r = await api.installPython(); S.st = r.status; return r.ok ? '' : (r.error || M('Ошибка установки')); } },
  { id: 'mt5mod', win: true, mt5: true, title: 'Модуль MetaTrader5', desc: 'Официальный пакет MetaQuotes для Python.',
    done: st => !!(st.python && st.python.mt5), info: st => st.python && st.python.mt5 ? tr('Установлен. Запустите терминал MT5 и войдите в счёт.') : '',
    run: async () => { logLine('▶ pip install MetaTrader5'); const r = await api.installMT5(); S.st = r.status; return r.ok ? '' : (r.error || M('pip завершился с ошибкой — откройте журнал.')); } },
  { id: 'login', title: 'Вход в аккаунт Claude', desc: 'Panda работает от вашей подписки Claude (Pro или Max). Ключ API не нужен.',
    done: () => S.state.login === 'ok', info: () => '', run: () => startLogin() },
];
const visible = () => STEPS.filter(s => (!s.win || WIN));

function icon(st) { return { ok: '✓', err: '!', wait: '…', skip: '–' }[st] || ''; }
function render() {
  const st = S.st;
  $('steps').innerHTML = visible().map((s, i) => {
    const off = s.mt5 && !mt5On();
    const state = off ? 'skip' : (S.state[s.id] || 'todo');
    const det = off ? tr('Пропущено — MetaTrader 5 не подключаем.') : (txt(S.msg[s.id]) || (st && s.info(st)) || tr(s.desc));
    let btn = '';
    if (!S.running && !off) {
      if (state === 'err') btn = `<button data-run="${s.id}">${tr('Повторить')}</button>`;
      else if (state === 'todo') btn = `<button data-run="${s.id}">${tr(s.id === 'login' ? 'Войти' : 'Установить')}</button>`;
    }
    if (s.id === 'login' && state === 'wait') btn = `<button data-check="1">${tr('Проверить сейчас')}</button><button data-reopen="1">${tr('Окно входа')}</button>`;
    return `<div class="step"><span class="ic ${state}">${icon(state) || (i + 1)}</span><div class="body"><div class="ttl">${tr(s.title)}</div><div class="det${S.bad[s.id] ? ' bad' : ''}">${det}</div></div><div class="act">${btn}</div></div>`;
  }).join('');
  $('steps').querySelectorAll('[data-run]').forEach(b => { b.onclick = () => runOne(b.dataset.run); });
  $('steps').querySelectorAll('[data-check]').forEach(b => { b.onclick = () => checkLogin(true); });
  $('steps').querySelectorAll('[data-reopen]').forEach(b => { b.onclick = () => api.loginClaude(); });
  const need = visible().filter(s => !(s.mt5 && !mt5On()) && S.state[s.id] !== 'ok');
  $('all').disabled = S.running || !need.length;
  $('all').textContent = tr(S.running ? 'Устанавливаю…' : need.length ? 'Установить всё' : '✓ Всё готово');
  $('finish').className = need.length ? '' : 'primary';
  $('mt5Opt').style.display = WIN ? '' : 'none';
}
function applyStatus(st) {
  S.st = st;
  for (const s of visible()) if (s.id !== 'login' && S.state[s.id] !== 'run') S.state[s.id] = s.done(st) ? 'ok' : (S.state[s.id] === 'err' ? 'err' : 'todo');
  if (S.state.login !== 'ok' && S.state.login !== 'wait' && S.state.login !== 'run') S.state.login = 'todo';
}

async function runStep(s) {
  if (s.mt5 && !mt5On()) return true;
  if (s.id !== 'login' && S.st && s.done(S.st)) { S.state[s.id] = 'ok'; return true; }
  S.state[s.id] = 'run'; S.msg[s.id] = 'Выполняется…'; S.bad[s.id] = false; render();
  let err = '';
  try { err = await s.run(); } catch (e) { err = e.message; }
  if (s.id === 'login') return true; // continues in the background (waiting for the browser sign-in)
  S.msg[s.id] = err || ''; S.bad[s.id] = !!err;
  S.state[s.id] = err ? 'err' : 'ok';
  if (S.st) applyStatus(S.st);
  if (err) S.state[s.id] = 'err';
  render();
  return !err;
}
async function runOne(id) { if (S.running) return; S.running = true; render(); await runStep(STEPS.find(s => s.id === id)); S.running = false; render(); }
$('all').onclick = async () => {
  if (S.running) return;
  S.running = true; render();
  const res = {};
  for (const s of visible()) {
    if (s.id === 'login') { if (res.claude === false) { S.msg.login = 'Сначала нужно установить Claude Code.'; break; } if (S.state.login === 'ok') break; }
    if (s.id === 'mt5mod' && res.python === false) continue;
    res[s.id] = await runStep(s);
  }
  S.running = false; render();
};

// ── Claude sign-in: open the Claude Code window, then poll a tiny real request until it succeeds
async function startLogin() {
  const r = await api.loginClaude();
  if (!r.ok) { S.state.login = 'err'; S.msg.login = r.error || 'Не удалось открыть окно входа'; S.bad.login = true; return; }
  S.state.login = 'wait'; S.bad.login = false;
  S.msg.login = M('{0}{1}', M(MAC ? 'Открыт «Терминал» с Claude Code (если macOS спросит разрешение — нажмите «OK»). ' : 'Открыто окно Claude Code. '),
    M('Выберите вход через подписку Claude и подтвердите в браузере. Если спросит тему оформления или доверие к папке — просто нажмите Enter. Мы сами заметим, когда вход выполнен.'));
  S.loginUntil = Date.now() + 15 * 60000;
  clearInterval(S.loginTimer); S.loginTimer = setInterval(() => checkLogin(false), 12000);
  render();
}
let checking = false;
async function checkLogin(manual) {
  if (checking) return; checking = true;
  if (manual) { S.msg.login = 'Проверяю вход…'; render(); }
  const t = await api.testClaude().catch(e => ({ ok: false, summary: e.message }));
  checking = false;
  if (t.ok) {
    clearInterval(S.loginTimer); S.state.login = 'ok'; S.bad.login = false;
    S.msg.login = 'Вход выполнен — Panda отвечает. Окно Claude Code можно закрыть.'; logLine('✓ Claude: вход выполнен'); render(); return;
  }
  if (S.state.login === 'wait' && Date.now() > S.loginUntil) { clearInterval(S.loginTimer); S.state.login = 'err'; S.bad.login = true; S.msg.login = M('Вход не обнаружен: {0}. Нажмите «Повторить».', t.summary || M('ошибка')); }
  else if (manual) S.msg.login = M('Пока не вошли ({0}). Завершите вход в окне Claude Code — проверка повторяется автоматически.', t.summary || M('нет ответа'));
  render();
}

$('mt5').onchange = render;
$('finish').onclick = () => { clearInterval(S.loginTimer); api.finish({ autostart: $('auto').checked }); };
// ── language: picker in the corner; static texts carry data-t="<Russian key>"
function applyLang() {
  document.documentElement.lang = LANG;
  document.querySelectorAll('[data-t]').forEach(el => { el.textContent = tr(el.dataset.t); });
  $('heroTxt').textContent = tr(MAC ? 'Скачаем и поставим Claude Code с официального сайта Anthropic. Вам останется только войти в аккаунт Claude в браузере.' : 'Скачаем и поставим всё нужное с официальных сайтов, без прав администратора. Вам останется только войти в аккаунт Claude в браузере.');
  $('logT').textContent = (logBox.style.display === 'block' ? '▾' : '▸') + ' ' + tr('Подробный журнал');
  document.title = tr('Pandich Lab — настройка');
  $('langs').innerHTML = Object.entries(L10N.LANGS).map(([k, n]) => `<button data-lang="${k}" class="${k === LANG ? 'on' : ''}">${n}</button>`).join('');
  $('langs').querySelectorAll('[data-lang]').forEach(b => { b.onclick = async () => { LANG = await api.setLang(b.dataset.lang) || b.dataset.lang; tr = L10N.make(LANG); applyLang(); render(); }; });
}

(async () => {
  render();
  const st0 = await api.status(); LANG = st0.lang || 'ru'; tr = L10N.make(LANG); applyLang();
  applyStatus(st0); render();
  // already signed in? (fast fail when not — costs nothing)
  if (S.st.claude.path) { const t = await api.testClaude().catch(() => ({ ok: false })); if (t.ok) { S.state.login = 'ok'; S.msg.login = 'Вход уже выполнен.'; render(); } }
})();
