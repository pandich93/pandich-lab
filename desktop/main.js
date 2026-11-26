// Pandich Lab — desktop shell (Electron). Windows + macOS.
// Runs the same Node server as the zip/dev version (Electron's own Node, no separate install), shows it in an app window,
// keeps it alive in the tray / menu bar (Watch mode keeps working with the window closed), first-run setup wizard,
// optional auto-update from GitHub Releases.
'use strict';
const { app, BrowserWindow, Tray, Menu, shell, ipcMain, nativeImage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');

const isWin = process.platform === 'win32', isMac = process.platform === 'darwin';
const APP_ID = 'com.pandich.lab';
const SERVER_DIR = app.isPackaged ? path.join(process.resourcesPath, 'server') : path.resolve(__dirname, '..');
const USER_DIR = app.getPath('userData');            // %APPDATA%\Pandich Lab  |  ~/Library/Application Support/Pandich Lab
const HOME = path.join(USER_DIR, 'workspace');         // scripts, data (Watch, layouts, Telegram), agent workspace
const SHIM_DIR = path.join(USER_DIR, 'bin');           // `node` for Panda's `node ql.mjs` → Electron in Node mode
const LOG_DIR = path.join(USER_DIR, 'logs');
const SETTINGS_FILE = path.join(USER_DIR, 'desktop.json');
const ICON = path.join(__dirname, 'build', 'icon.png');
const PORTS = [3779, 3780, 3781, 3782, 3783, 3784, 3785]; // stable port → the window's localStorage (charts, layouts) survives restarts

const S = { proc: null, port: null, quitting: false, win: null, setupWin: null, tray: null, crashes: [], logStream: null };
const settings = Object.assign({ setupDone: false, claudeBin: '', autostart: false, trayHintShown: false }, readJSON(SETTINGS_FILE, {}));

function readJSON(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } }
function saveSettings() { try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2)); } catch (e) { log(`settings: ${e.message}`); } }
function log(line) { const s = `[${new Date().toISOString()}] ${line}\n`; if (S.logStream) S.logStream.write(s); else process.stdout.write(s); }

// ───────── single instance ─────────
if (!app.requestSingleInstanceLock()) { app.quit(); return; }
app.on('second-instance', () => showMain());
if (isWin) app.setAppUserModelId(APP_ID); // Windows notifications need it

// ───────── PATH: places where Claude Code / Python live (apps started from Finder/Explorer get a minimal PATH) ─────────
function extraPath() {
  const h = os.homedir();
  const dirs = [SHIM_DIR, path.join(h, '.local', 'bin')];
  if (isWin) {
    dirs.push(path.join(process.env.APPDATA || path.join(h, 'AppData', 'Roaming'), 'npm'));
    for (const d of pythonDirs()) dirs.push(d, path.join(d, 'Scripts')); // per-user Python (also one we just installed)
    dirs.push(path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps'));
  }
  else dirs.push('/opt/homebrew/bin', '/usr/local/bin', path.join(h, '.npm-global', 'bin'), '/usr/bin', '/bin');
  return dirs;
}
// %LOCALAPPDATA%\Programs\Python\Python3xx — where the per-user python.org installer puts Python (newest first)
function pythonDirs() {
  if (!isWin) return [];
  const root = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'Python');
  try {
    const pref = n => { const m = Number(n.slice(7)); const i = [313, 314, 312, 311, 310].indexOf(m); return i >= 0 ? i : 100 - m / 1000; };
    return fs.readdirSync(root).filter(n => /^Python3\d+$/.test(n)).sort((a, b) => pref(a) - pref(b))
      .map(n => path.join(root, n)).filter(d => fs.existsSync(path.join(d, 'python.exe')));
  } catch { return []; }
}
function envPath() { const sep = isWin ? ';' : ':'; return [...extraPath(), ...(process.env.PATH || process.env.Path || '').split(sep)].filter(Boolean).join(sep); }

// `node` shim: Panda (Claude Code) runs `node ql.mjs …`; users may have no Node.js — Electron can act as Node.
function writeNodeShim() {
  fs.mkdirSync(SHIM_DIR, { recursive: true });
  const exe = process.execPath;
  if (isWin) {
    fs.writeFileSync(path.join(SHIM_DIR, 'node.cmd'), `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${exe}" %*\r\n`);
    // Git Bash (if the user has it) does not run .cmd files by bare name
    fs.writeFileSync(path.join(SHIM_DIR, 'node'), `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${exe.replace(/\\/g, '/')}" "$@"\n`);
  } else {
    const f = path.join(SHIM_DIR, 'node');
    fs.writeFileSync(f, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${exe}" "$@"\n`);
    fs.chmodSync(f, 0o755);
  }
}

function which(name) {
  const exts = isWin ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const d of envPath().split(isWin ? ';' : ':')) {
    if (d === SHIM_DIR) continue;
    for (const e of exts) { const f = path.join(d, name + e); try { if (fs.statSync(f).isFile()) return f; } catch { /* next */ } }
  }
  return '';
}
function findClaude() {
  if (settings.claudeBin && fs.existsSync(settings.claudeBin)) return settings.claudeBin;
  return which('claude');
}

function run(cmd, args, { timeout = 600000, onLine, shell: useShell = false } = {}) {
  return new Promise(resolve => {
    let out = '', done = false;
    let p;
    try { p = spawn(cmd, args, { env: { ...process.env, PATH: envPath() }, windowsHide: true, shell: useShell }); }
    catch (e) { resolve({ code: -1, out: e.message }); return; }
    const t = setTimeout(() => { try { p.kill(); } catch { /* gone */ } }, timeout);
    const take = c => { const s = c.toString('utf8'); out += s; if (onLine) s.split(/\r?\n/).filter(Boolean).forEach(onLine); };
    p.stdout.on('data', take); p.stderr.on('data', take);
    p.on('error', e => { if (!done) { done = true; clearTimeout(t); resolve({ code: -1, out: out + e.message }); } });
    p.on('close', code => { if (!done) { done = true; clearTimeout(t); resolve({ code, out }); } });
  });
}

// ───────── server process (Electron as Node) ─────────
function portFree(port) {
  return new Promise(res => { const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))).listen(port, '127.0.0.1'); });
}
async function pickPort() {
  for (const p of PORTS) if (await portFree(p)) return p;
  return new Promise(res => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
}
function ping(port) {
  return new Promise(res => {
    const r = http.get({ host: '127.0.0.1', port, path: '/api/config', timeout: 1500 }, x => { x.resume(); res(x.statusCode === 200); });
    r.on('error', () => res(false)); r.on('timeout', () => { r.destroy(); res(false); });
  });
}
async function startServer() {
  if (!S.port) S.port = await pickPort();
  const env = {
    ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: String(S.port), QL_HOME: HOME, QL_DESKTOP: '1', PATH: envPath(),
  };
  const claude = findClaude(); if (claude) env.CLAUDE_BIN = claude;
  log(`server: start on ${S.port}, claude=${claude || 'not found'}`);
  S.proc = spawn(process.execPath, [path.join(SERVER_DIR, 'server.mjs')], { cwd: SERVER_DIR, env, windowsHide: true });
  S.proc.stdout.on('data', c => S.logStream && S.logStream.write(c));
  S.proc.stderr.on('data', c => { if (S.logStream) S.logStream.write(c); if (/ERR_MODULE_NOT_FOUND|Cannot find (package|module)/.test(String(c))) S.broken = 'Сборка неполная: внутри приложения нет зависимостей сервера (node_modules). Пересобери установщик через desktop\\build-win.bat из папки Pandich Lab.'; });
  S.proc.on('exit', code => {
    log(`server: exit ${code}`);
    S.proc = null;
    if (S.quitting) return;
    const now = Date.now(); S.crashes = S.crashes.filter(t => now - t < 60000); S.crashes.push(now);
    if (S.broken || S.crashes.length > 5) { showError(S.broken || 'Сервер Pandich Lab падает при запуске. Подробности — в логе (меню в трее → «Логи»).'); return; }
    setTimeout(() => startServer().then(() => S.win && S.win.webContents.reload()), code === 99 ? 300 : 1500); // 99 = planned restart
  });
  for (let i = 0; i < 150; i++) { if (await ping(S.port)) return true; await new Promise(r => setTimeout(r, 200)); if (!S.proc) return false; }
  return false;
}
function stopServer() {
  if (!S.proc) return Promise.resolve();
  return new Promise(res => {
    const p = S.proc; const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* gone */ } res(); }, 4000);
    p.once('exit', () => { clearTimeout(t); res(); });
    const r = http.request({ host: '127.0.0.1', port: S.port, path: '/api/admin/shutdown', method: 'POST', timeout: 1500 }, x => x.resume());
    r.on('error', () => { try { p.kill(); } catch { /* gone */ } }); r.end();
  });
}

// ───────── windows ─────────
function createMain() {
  S.win = new BrowserWindow({
    width: 1500, height: 920, minWidth: 980, minHeight: 600, show: false, backgroundColor: '#131416', title: 'Pandich Lab', icon: ICON,
    autoHideMenuBar: true, webPreferences: { contextIsolation: true, sandbox: true, spellcheck: false, preload: path.join(__dirname, 'app-preload.js') },
  });
  S.win.loadURL(`http://127.0.0.1:${S.port}/`);
  S.win.once('ready-to-show', () => { if (!process.argv.includes('--hidden')) S.win.show(); });
  S.win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url) && !url.startsWith(`http://127.0.0.1:${S.port}`)) shell.openExternal(url); return { action: 'deny' }; });
  S.win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`http://127.0.0.1:${S.port}`)) { e.preventDefault(); shell.openExternal(url); } });
  // microphone is not used (voice input = OS dictation); allow notifications only
  S.win.webContents.session.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'notifications'));
  S.win.on('close', e => {
    if (S.quitting) return;
    e.preventDefault(); S.win.hide(); // keep running for Watch mode
    if (!settings.trayHintShown && Notification.isSupported()) {
      new Notification({ title: 'Pandich Lab работает в фоне', body: `Сигналы Watch продолжают приходить. Открыть или выйти — значок в ${isMac ? 'строке меню' : 'трее'}.` }).show();
      settings.trayHintShown = true; saveSettings();
    }
  });
}
function showMain() {
  if (!settings.setupDone) { openSetup(); return; }
  if (!S.win) return;
  if (S.win.isMinimized()) S.win.restore();
  S.win.show(); S.win.focus();
}
function openSetup() {
  if (S.setupWin) { S.setupWin.show(); S.setupWin.focus(); return; }
  S.setupWin = new BrowserWindow({
    width: 760, height: 720, resizable: true, backgroundColor: '#131416', title: 'Pandich Lab — настройка', icon: ICON, autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: false, preload: path.join(__dirname, 'preload.js') },
  });
  S.setupWin.loadFile(path.join(__dirname, 'setup.html'));
  S.setupWin.on('closed', () => { S.setupWin = null; if (!settings.setupDone && !S.quitting) { /* closed without finishing: still usable */ settings.setupDone = true; saveSettings(); showMain(); } });
}
function openSettings() {
  if (!S.win || !settings.setupDone) { showMain(); return; }
  showMain();
  S.win.webContents.executeJavaScript('window.QLSettings && window.QLSettings.open()').catch(() => { /* page still loading */ });
}
function showError(text) {
  const w = S.win || new BrowserWindow({ width: 640, height: 300, backgroundColor: '#131416', icon: ICON, autoHideMenuBar: true });
  w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<body style="font:14px system-ui;background:#131416;color:#d1d4dc;padding:24px"><h3>Pandich Lab</h3><p>${text.replace(/</g, '&lt;')}</p><p style="color:#888">Лог: ${LOG_DIR.replace(/</g, '&lt;')}</p></body>`));
  w.show();
}

// ───────── tray / menu bar ─────────
function trayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Открыть Pandich Lab', click: showMain },
    { label: 'Настройки и диагностика', click: openSettings },
    { type: 'separator' },
    { label: 'Запускать при входе в систему', type: 'checkbox', checked: settings.autostart, click: m => setAutostart(m.checked) },
    { label: 'Мастер настройки (Claude Code, MT5)', click: openSetup },
    { label: 'Папка данных', click: () => shell.openPath(HOME) },
    { label: 'Логи', click: () => shell.openPath(LOG_DIR) },
    { label: 'Проверить обновления', click: () => checkUpdates(true) },
    { type: 'separator' },
    { label: 'Перезапустить сервер', click: async () => { await stopServer(); } }, // exit → auto-restart
    { label: 'Выход', click: () => { S.quitting = true; app.quit(); } },
  ]);
}
function createTray() {
  let img = nativeImage.createFromPath(ICON).resize({ width: isMac ? 18 : 16, height: isMac ? 18 : 16 });
  S.tray = new Tray(img);
  S.tray.setToolTip('Pandich Lab');
  S.tray.setContextMenu(trayMenu());
  if (!isMac) S.tray.on('click', showMain);
}
function setAutostart(on) {
  settings.autostart = !!on; saveSettings();
  app.setLoginItemSettings({ openAtLogin: settings.autostart, args: ['--hidden'] });
  if (S.tray) S.tray.setContextMenu(trayMenu());
}

// ───────── auto-update (GitHub Releases; active once "build.publish" points at a real repo) ─────────
async function checkUpdates(manual, silent) {
  const say = t => { if (manual && !silent) note('Обновления', t); return t; };
  if (!app.isPackaged) return { ok: false, text: say('Проверка работает только в установленной версии.') };
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} };
    const r = await autoUpdater.checkForUpdatesAndNotify();
    const v = r && r.updateInfo && r.updateInfo.version;
    if (v && v !== app.getVersion()) return { ok: true, update: v, text: say(`Найдена версия ${v} — скачивается, установится при перезапуске приложения.`) };
    return { ok: true, text: say('Установлена последняя версия.') };
  } catch (e) { log(`update: ${e.message}`); return { ok: false, text: say('Не удалось проверить: ' + e.message.slice(0, 120)) }; }
}
function note(title, body) { if (Notification.isSupported()) new Notification({ title, body }).show(); }

// ───────── setup wizard IPC ─────────
function gitBash() {
  if (!isWin) return '';
  const pf = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramW6432].filter(Boolean);
  const c = [...pf.map(d => path.join(d, 'Git', 'bin', 'bash.exe')), path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe'), path.join(HOME, 'tools', 'git', 'bin', 'bash.exe')];
  return c.find(f => fs.existsSync(f)) || '';
}
async function status() {
  const claude = findClaude();
  let version = '';
  if (claude) { const r = await run(claude, ['--version'], { timeout: 20000, shell: isWin && /\.(cmd|bat)$/i.test(claude) }); if (r.code === 0) version = r.out.trim().split('\n')[0]; }
  const py = isWin ? await findPython() : null;
  return { platform: process.platform, claude: { path: claude, version }, python: py, git: gitBash(), home: HOME };
}
async function findPython() {
  // first 64-bit Python 3.8–3.14 (MetaTrader5 ships win_amd64 wheels only); report an unsuitable one too
  const cands = [...pythonDirs().map(d => [path.join(d, 'python.exe'), []]), ['py', ['-3']], ['python', []], ['python3', []]];
  let unsuitable = null;
  for (const [bin, args] of cands) {
    const r = await run(bin, [...args, '-c', 'import sys,struct,importlib.util as u;print(sys.version.split()[0]);print(bool(u.find_spec("MetaTrader5")));print(struct.calcsize("P")*8)'], { timeout: 20000 });
    if (r.code !== 0) continue;
    const [v, mt5, bits] = r.out.trim().split(/\r?\n/).map(x => x.trim());
    const minor = Number((v || '').split('.')[1]);
    const py = { cmd: [bin.includes(' ') ? `"${bin}"` : bin, ...args].join(' '), bin, args, version: v, mt5: mt5 === 'True', bits: Number(bits) };
    if (py.bits === 64 && minor >= 8 && minor <= 14) return py;
    unsuitable = unsuitable || { ...py, unsuitable: py.bits !== 64 ? '32-битный' : `версия ${v} не поддерживается модулем MetaTrader5` };
  }
  return unsuitable ? { cmd: '', version: '', mt5: false, found: unsuitable } : { cmd: '', version: '', mt5: false };
}
ipcMain.handle('setup:status', () => status());

// ───────── main-window bridge (Settings panel) ─────────
const fromMain = e => !!S.win && e.sender === S.win.webContents;
const maskHome = x => String(x).split(os.homedir()).join('~');
function guard(fn) { return (e, ...a) => { if (!fromMain(e)) throw new Error('forbidden'); return fn(...a); }; }
ipcMain.handle('app:info', guard(() => ({
  version: app.getVersion(), platform: process.platform, arch: process.arch, electron: process.versions.electron, packaged: app.isPackaged,
  autostart: settings.autostart, claude: maskHome(findClaude() || ''), logDir: maskHome(LOG_DIR), dataDir: maskHome(HOME), port: S.port,
})));
ipcMain.handle('app:openLogs', guard(() => shell.openPath(LOG_DIR)));
ipcMain.handle('app:openData', guard(() => shell.openPath(HOME)));
ipcMain.handle('app:openSetup', guard(() => { openSetup(); return true; }));
ipcMain.handle('app:setAutostart', guard(on => { setAutostart(on); return settings.autostart; }));
ipcMain.handle('app:checkUpdates', guard(() => checkUpdates(true, true)));
ipcMain.handle('app:restartServer', guard(async () => { await stopServer(); return true; })); // exit → auto-restart + reload
ipcMain.handle('app:logTail', guard(() => {
  try {
    const f = path.join(LOG_DIR, 'server.log'); const st = fs.statSync(f); const n = Math.min(st.size, 64000);
    const fd = fs.openSync(f, 'r'); const b = Buffer.alloc(n); fs.readSync(fd, b, 0, n, st.size - n); fs.closeSync(fd);
    return maskHome(b.toString('utf8').split(/\r?\n/).slice(-150).join('\n'));
  } catch (e) { return `(лог недоступен: ${e.message})`; }
}));
ipcMain.handle('setup:installClaude', async e => {
  const send = l => { try { e.sender.send('setup:log', l); } catch { /* window closed */ } };
  const r = isWin
    ? await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://claude.ai/install.ps1 | iex'], { onLine: send })
    : await run('/bin/bash', ['-lc', 'curl -fsSL https://claude.ai/install.sh | bash'], { onLine: send });
  return { ok: r.code === 0, status: await status() };
});
ipcMain.handle('setup:loginClaude', async () => {
  const claude = findClaude(); if (!claude) return { ok: false, error: 'Claude Code не найден' };
  if (isWin) spawn('cmd.exe', ['/c', 'start', '"Claude Code — вход"', 'cmd', '/k', claude], { env: { ...process.env, PATH: envPath() }, detached: true, windowsHide: false, shell: false }).unref();
  else spawn('osascript', ['-e', `tell application "Terminal" to do script "${claude.replace(/"/g, '\\"')}"`, '-e', 'tell application "Terminal" to activate']).unref();
  return { ok: true };
});
ipcMain.handle('setup:installMT5', async e => {
  const send = l => { try { e.sender.send('setup:log', l); } catch { /* closed */ } };
  const py = await findPython(); if (!py.cmd) return { ok: false, error: 'Подходящий Python 3 не найден', status: await status() };
  const r = await run(py.bin, [...py.args, '-m', 'pip', 'install', '--upgrade', 'MetaTrader5'], { onLine: send });
  return { ok: r.code === 0, status: await status() };
});
// Python for MT5 (Windows): official python.org installer, per-user, silent, adds itself to PATH. No admin rights.
const PY_URL = 'https://www.python.org/ftp/python/3.13.16/python-3.13.16-amd64.exe'; // MetaTrader5 wheels: cp313/cp314 win_amd64
async function installPython(send) {
  if (!isWin) return { ok: false, error: 'Python для MT5 нужен только на Windows' };
  const f = path.join(os.tmpdir(), path.basename(PY_URL));
  try {
    send(`Скачиваю Python 3.13 с python.org…`);
    const r = await fetch(PY_URL, { signal: AbortSignal.timeout(600000) });
    if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
    const total = Number(r.headers.get('content-length')) || 0;
    const out = fs.createWriteStream(f); let got = 0, step = 0;
    for await (const chunk of r.body) {
      got += chunk.length; out.write(chunk);
      const pct = total ? Math.floor(got / total * 100) : 0;
      if (pct >= step) { send(`  ${pct}% (${(got / 1048576).toFixed(1)} МБ)`); step = pct + 20; }
    }
    await new Promise((res, rej) => out.end(e => e ? rej(e) : res()));
    if (fs.statSync(f).size < 10e6) throw new Error('файл скачался не полностью');
  } catch (e) { return { ok: false, error: `Не удалось скачать Python: ${e.message}` }; }
  send('Устанавливаю Python (1–2 мин, без окон)…');
  const r = await run(f, ['/quiet', 'InstallAllUsers=0', 'PrependPath=1', 'Include_launcher=1', 'InstallLauncherAllUsers=0', 'Include_test=0', 'Include_doc=0'], { timeout: 600000 });
  try { fs.unlinkSync(f); } catch { /* temp */ }
  if (r.code !== 0) return { ok: false, error: `Установщик Python завершился с кодом ${r.code}${r.code === 1602 ? ' (отменено)' : ''}` };
  const py = await findPython();
  return py.cmd ? { ok: true, python: py } : { ok: false, error: 'Python установлен, но не найден — перезапустите Pandich Lab' };
}
ipcMain.handle('setup:installPython', async e => {
  const send = l => { try { e.sender.send('setup:log', l); } catch { /* closed */ } };
  const r = await installPython(send);
  return { ...r, status: await status() };
});
// Steps that live in the server (shared with the Settings panel): Claude test, Git Bash install
function serverPost(p, timeout) {
  return new Promise(res => {
    const q = http.request({ host: '127.0.0.1', port: S.port, path: p, method: 'POST', timeout, headers: { 'content-type': 'application/json' } }, x => {
      let b = ''; x.on('data', c => { b += c; }); x.on('end', () => { try { res(JSON.parse(b)); } catch { res({ ok: false, error: 'Сервер не ответил' }); } });
    });
    q.on('error', e => res({ ok: false, error: e.message })); q.on('timeout', () => { q.destroy(); res({ ok: false, error: 'таймаут' }); });
    q.end('{}');
  });
}
ipcMain.handle('setup:testClaude', async () => { const r = await serverPost('/api/health/claude-test', 130000); return r.test || { ok: false, summary: r.error || 'Сервер не ответил' }; });
ipcMain.handle('setup:installGit', async () => { const r = await serverPost('/api/git/install', 900000); return { ok: !!r.ok, error: r.ok ? '' : (r.out || r.error), out: r.out, status: await status() }; });
ipcMain.handle('setup:setClaudePath', async (_e, p) => { settings.claudeBin = p || ''; saveSettings(); return status(); });
ipcMain.handle('setup:openUrl', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
ipcMain.handle('setup:finish', async (_e, opts = {}) => {
  settings.setupDone = true; saveSettings();
  if (opts.autostart !== undefined) setAutostart(opts.autostart);
  await stopServer(); // restart with the freshly found claude path
  if (S.setupWin) { const w = S.setupWin; S.setupWin = null; w.destroy(); }
  if (S.win) { S.win.webContents.reload(); showMain(); }
  return true;
});

// ───────── lifecycle ─────────
app.whenReady().then(async () => {
  for (const d of [HOME, LOG_DIR]) fs.mkdirSync(d, { recursive: true });
  try { const f = path.join(LOG_DIR, 'server.log'); if (fs.existsSync(f) && fs.statSync(f).size > 5e6) fs.renameSync(f, f + '.old'); S.logStream = fs.createWriteStream(f, { flags: 'a' }); } catch { /* no log */ }
  log(`Pandich Lab ${app.getVersion()} on ${process.platform}/${process.arch}; server dir ${SERVER_DIR}`);
  writeNodeShim();
  if (isMac) app.dock && app.dock.setIcon(nativeImage.createFromPath(ICON));
  createTray();
  const ok = await startServer();
  if (!ok) { showError('Не удалось запустить сервер Pandich Lab.'); return; }
  createMain();
  if (!settings.setupDone) openSetup();
  setTimeout(() => checkUpdates(false), 15000);
});
app.on('activate', showMain); // macOS: click on the Dock icon
app.on('before-quit', () => { S.quitting = true; });
app.on('window-all-closed', () => { /* stay in tray / menu bar */ });
app.on('will-quit', async e => {
  if (S.proc) { e.preventDefault(); await stopServer(); app.exit(0); }
});
