// Pandich Lab — local charting workbench: chart + AI agent that writes Pine v6 and runs it via PineTS.
// Run:  set ANTHROPIC_API_KEY=sk-ant-...   then   node server.mjs   → http://localhost:3777
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import os from 'node:os';
import { PineTS, Indicator, BaseProvider } from 'pinets';

// ── recent server log lines (Settings → «Скопировать диагностику»)
const LOGBUF = [];
for (const lvl of ['log', 'warn', 'error']) {
  const orig = console[lvl].bind(console);
  console[lvl] = (...a) => {
    orig(...a);
    try {
      const s = a.map(x => x instanceof Error ? (x.stack || x.message) : typeof x === 'string' ? x : JSON.stringify(x)).join(' ');
      LOGBUF.push(`${new Date().toISOString().slice(11, 19)} ${lvl === 'log' ? '' : lvl.toUpperCase() + ' '}${s}`.slice(0, 2000));
      if (LOGBUF.length > 400) LOGBUF.splice(0, LOGBUF.length - 400);
    } catch { /* never break logging */ }
  };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Writable home for user data. Dev/zip install: the app folder itself. Desktop app: QL_HOME (the app bundle is read-only).
const HOME = process.env.QL_HOME ? path.resolve(process.env.QL_HOME) : __dirname;
const DESKTOP = process.env.QL_DESKTOP === '1';
if (HOME !== __dirname) { // agent workspace lives in HOME; refresh the shipped agent files + library on every start (app updates)
  fs.mkdirSync(path.join(HOME, 'agent', 'work'), { recursive: true });
  for (const f of ['ql.mjs', 'system.md']) { try { fs.copyFileSync(path.join(__dirname, 'agent', f), path.join(HOME, 'agent', f)); } catch (e) { console.error(`copy agent/${f}: ${e.message}`); } }
  try { fs.cpSync(path.join(__dirname, 'library'), path.join(HOME, 'library'), { recursive: true, force: true }); } catch (e) { console.error(`copy library: ${e.message}`); }
}

// ───────────────────────── CONFIG (single block) ─────────────────────────
const CFG = {
  port: Number(process.env.PORT || 3777),
  // 'claude-code' = your Claude Pro/Max subscription via the local `claude` CLI (default, no API cost)
  // 'api'         = Anthropic API key (pay per token)
  backend: process.env.BACKEND || 'claude-code',
  claudeBin: process.env.CLAUDE_BIN || 'claude',
  apiKey: process.env.ANTHROPIC_API_KEY || '',
  defaultModel: process.env.MODEL || 'sonnet',
  // claude-code backend accepts aliases; api backend needs full ids (mapped below)
  models: ['sonnet', 'opus', 'haiku'],
  apiModelIds: { sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5', haiku: 'claude-haiku-5-5' },
  agentTimeoutMs: 10 * 60 * 1000,
  maxAgentSteps: 8,           // max tool round-trips per user message
  maxTokens: 16000,
  defaultBars: 1500,
  maxBars: 5000,              // Binance spot klines: max 1000 per request → paged
  mock: process.env.MOCK === '1',
  scriptsDir: path.join(HOME, 'scripts'),
  libraryDir: path.join(__dirname, 'library'),
  watchBars: Number(process.env.QL_WATCH_BARS || 1000), // bars per Watch-mode evaluation
  // MT5 bridge (read-only quotes from the running terminal via the official MetaTrader5 Python package)
  mt5Enabled: process.env.MT5 !== '0',
  pythonCmd: process.env.QL_PYTHON || '',          // e.g. "py -3" or full path to python.exe; auto-detect if empty
  mt5Path: process.env.MT5_PATH || '',             // optional terminal64.exe path (only if several terminals)
  mt5UtcOffsetHours: null,                         // force server-time offset (hours); null = auto-detect
  livePollMs: { mt5: 1000, binance: 2000 },
};
// Try to load key/model from config.json (optional, not required)
try {
  const j = JSON.parse(fs.readFileSync(path.join(HOME, 'config.json'), 'utf8'));
  if (j.anthropicApiKey && !CFG.apiKey) CFG.apiKey = j.anthropicApiKey;
  if (j.model) CFG.defaultModel = j.model;
  if (j.backend) CFG.backend = j.backend;
  if (j.claudeBin) CFG.claudeBin = j.claudeBin;
  if (j.python) CFG.pythonCmd = j.python;
  if (j.mt5Path) CFG.mt5Path = j.mt5Path;
  if (j.mt5Enabled === false) CFG.mt5Enabled = false;
  if (typeof j.mt5UtcOffsetHours === 'number') CFG.mt5UtcOffsetHours = j.mt5UtcOffsetHours;
} catch { /* no config.json — fine */ }
fs.mkdirSync(path.join(HOME, 'agent', 'work'), { recursive: true });
fs.mkdirSync(CFG.scriptsDir, { recursive: true });
fs.mkdirSync(CFG.scriptsDir, { recursive: true });

// ── Timeframes: any "<n><unit>" — m (minutes), h (hours), d (days), w (weeks), M (months). Bare number = minutes.
// Canonical form: 15m, 3h, 2d, 1w, 1M. Native ones come straight from the source, the rest are aggregated.
const TF_PRESETS = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'];
const UNIT_SEC = { m: 60, h: 3600, d: 86400, w: 604800, M: 2592000 };
function normTf(x) {
  if (x === undefined || x === null) return null;
  const m = /^\s*(\d*)\s*(m|min|h|H|d|D|w|W|M)?\s*$/.exec(String(x));
  if (!m || (!m[1] && !m[2])) return null;
  let n = m[1] ? parseInt(m[1], 10) : 1, u = m[2] || 'm';
  if (u === 'min') u = 'm'; else if (u === 'H') u = 'h'; else if (u === 'D') u = 'd'; else if (u === 'W') u = 'w';
  if (!(n > 0) || n > 100000) return null;
  if (u === 'm' && n % 60 === 0 && n < 1440) { n /= 60; u = 'h'; }
  if (u === 'm' && n === 1440) { n = 1; u = 'd'; }
  if (u === 'h' && n % 24 === 0) { n /= 24; u = 'd'; }
  if (u === 'd' && n % 7 === 0 && n >= 7) { n /= 7; u = 'w'; }
  const sec = n * UNIT_SEC[u];
  if (sec < 60 || sec > 12 * UNIT_SEC.M) return null;
  return `${n}${u}`;
}
function tfSec(x) { const t = normTf(x); return t ? parseInt(t, 10) * UNIT_SEC[t.slice(-1)] : undefined; }
function intToPine(x) { const t = normTf(x); if (!t) return undefined; const n = parseInt(t, 10), u = t.slice(-1);
  return u === 'm' ? String(n) : u === 'h' ? String(n * 60) : (n === 1 ? '' : String(n)) + ({ d: 'D', w: 'W', M: 'M' }[u]); }
function pineToInt(x) { const s = String(x).trim();
  if (/^\d+$/.test(s)) return normTf(s + 'm');
  const m = /^(\d*)([DWM])$/.exec(s); if (m) return normTf((m[1] || '1') + ({ D: 'd', W: 'w', M: 'M' }[m[2]]));
  return undefined; }
// Back-compat lookups used across the file: INTERVALS[tf] → seconds, PINE_TF[tf] → Pine tf, PINE2INT[pine] → tf
const INTERVALS = new Proxy({}, { get: (_, k) => typeof k === 'string' ? tfSec(k) : undefined });
const PINE_TF = new Proxy({}, { get: (_, k) => typeof k === 'string' ? intToPine(k) : undefined });
const PINE2INT = new Proxy({}, { get: (_, k) => typeof k === 'string' ? pineToInt(k) : undefined });
const NATIVE = {
  mt5: new Set(['1m', '2m', '3m', '4m', '5m', '6m', '10m', '12m', '15m', '20m', '30m', '1h', '2h', '3h', '4h', '6h', '8h', '12h', '1d', '1w', '1M']),
  binance: new Set(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M']),
};
// pick the largest native timeframe that divides the requested one
function planTf(src, tf) {
  if (src === 'mock' || NATIVE[src].has(tf)) return { native: true };
  const sec = tfSec(tf), u = tf.slice(-1);
  if (u === 'w') return { base: '1w', ratio: sec / UNIT_SEC.w };
  if (u === 'M') return { base: '1M', ratio: parseInt(tf, 10) };
  let best = null;
  for (const b of NATIVE[src]) { const bs = tfSec(b); if (b.endsWith('w') || b.endsWith('M')) continue; if (bs <= sec && sec % bs === 0 && (!best || bs > tfSec(best))) best = b; }
  return { base: best || '1m', ratio: sec / tfSec(best || '1m') };
}
function bucketStart(tSec, tf) {
  const n = parseInt(tf, 10), u = tf.slice(-1);
  if (u === 'w') { const W = UNIT_SEC.w * n, MON = 4 * 86400; return Math.floor((tSec - MON) / W) * W + MON; }
  if (u === 'M') { const d = new Date(tSec * 1000); const k = d.getUTCFullYear() * 12 + d.getUTCMonth(); const b = k - (k % n); return Date.UTC(Math.floor(b / 12), b % 12, 1) / 1000; }
  const S = tfSec(tf); return Math.floor(tSec / S) * S;
}
function aggregate(bars, tf) {
  const out = []; let cur = null;
  for (const b of bars) {
    const k = bucketStart(b.openTime / 1000, tf) * 1000;
    if (!cur || cur.openTime !== k) { cur && out.push(cur); cur = { openTime: k, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume, closeTime: k + tfSec(tf) * 1000 - 1, _first: b.openTime }; }
    else { cur.high = Math.max(cur.high, b.high); cur.low = Math.min(cur.low, b.low); cur.close = b.close; cur.volume += b.volume; }
  }
  cur && out.push(cur);
  if (out.length > 1 && out[0]._first !== out[0].openTime) out.shift(); // first bucket is incomplete
  for (const o of out) delete o._first;
  return out;
}

// ───────────────────────── MT5 BRIDGE ─────────────────────────
const MT5 = {
  proc: null, ready: false, starting: null, pending: new Map(), seq: 0, buf: '',
  symbols: new Map(), offset: 0, offsetKnown: false, info: null, error: null, lastStartTry: 0,
};
function pythonCandidates() {
  if (CFG.pythonCmd) { const parts = CFG.pythonCmd.match(/"[^"]+"|\S+/g).map(s => s.replace(/^"|"$/g, '')); return [[parts[0], parts.slice(1)]]; }
  if (process.platform !== 'win32') return [['python3', []], ['python', []]];
  return [...winPythonDirs().map(d => [path.join(d, 'python.exe'), []]), ['py', ['-3']], ['python', []]];
}
// %LOCALAPPDATA%\Programs\Python\Python3xx (per-user python.org installer); versions with MetaTrader5 wheels first
function winPythonDirs() {
  const root = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'Python');
  const pref = n => { const m = Number(n.slice(7)); const i = [313, 314, 312, 311, 310].indexOf(m); return i >= 0 ? i : 100 - m / 1000; };
  try { return fs.readdirSync(root).filter(n => /^Python3\d+$/.test(n)).sort((a, b) => pref(a) - pref(b)).map(n => path.join(root, n)).filter(d => fs.existsSync(path.join(d, 'python.exe'))); }
  catch { return []; }
}
function mt5Call(cmd, args = {}, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    if (!MT5.proc) return reject(new Error('MT5 bridge not running'));
    const id = ++MT5.seq;
    const timer = setTimeout(() => { MT5.pending.delete(id); reject(new Error(`MT5 ${cmd} timeout`)); }, timeoutMs);
    MT5.pending.set(id, { resolve, reject, timer });
    MT5.proc.stdin.write(JSON.stringify({ id, cmd, ...args }) + '\n');
  });
}
function spawnBridge(bin, args) {
  return new Promise((resolve, reject) => {
    let p;
    try { p = spawn(bin, [...args, path.join(__dirname, 'mt5bridge.py')], { cwd: __dirname, windowsHide: true }); }
    catch (e) { return reject(e); }
    let settled = false, errTxt = '';
    p.on('error', e => { if (!settled) { settled = true; reject(e); } });
    p.stderr.on('data', c => { errTxt += c.toString('utf8'); });
    p.stdout.on('data', chunk => {
      MT5.buf += chunk.toString('utf8');
      let i;
      while ((i = MT5.buf.indexOf('\n')) >= 0) {
        const line = MT5.buf.slice(0, i).trim(); MT5.buf = MT5.buf.slice(i + 1);
        if (!line) continue;
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        if (msg.fatal) { MT5.error = msg.fatal; continue; }
        const pend = MT5.pending.get(msg.id);
        if (pend) { clearTimeout(pend.timer); MT5.pending.delete(msg.id); msg.ok ? pend.resolve(msg.data) : pend.reject(new Error(msg.error)); }
      }
    });
    p.on('exit', code => {
      if (MT5.proc === p) { MT5.proc = null; MT5.ready = false; }
      for (const [, pend] of MT5.pending) { clearTimeout(pend.timer); pend.reject(new Error('MT5 bridge exited')); }
      MT5.pending.clear();
      if (!settled) { settled = true; reject(new Error(MT5.error || `exit code ${code}: ${errTxt.slice(0, 300)}`)); }
    });
    MT5.proc = p;
    // first command proves the interpreter + package work
    mt5Call('init', CFG.mt5Path ? { path: CFG.mt5Path } : {}, 30000)
      .then(info => { settled = true; resolve(info); })
      .catch(e => { if (!settled) { settled = true; try { p.kill(); } catch { /* gone */ } reject(e); } });
  });
}
async function startMT5() {
  if (!CFG.mt5Enabled || CFG.mock) return false;
  if (MT5.ready) return true;
  if (MT5.starting) return MT5.starting;
  if (Date.now() - MT5.lastStartTry < 30000) return false; // backoff
  MT5.lastStartTry = Date.now();
  MT5.starting = (async () => {
    let lastErr = null;
    for (const [bin, args] of pythonCandidates()) {
      try {
        MT5.error = null;
        const info = await spawnBridge(bin, args);
        MT5.info = info; MT5.ready = true; MT5.error = null;
        applyOffset(info.offset);
        await refreshMT5Symbols();
        console.log(`MT5 bridge: ${info.company || ''} ${info.server || ''} #${info.login || ''}, ${MT5.symbols.size} symbols, server offset ${MT5.offset / 3600}h${MT5.offsetKnown ? '' : ' (not detected yet — market closed?)'}`);
        return true;
      } catch (e) { lastErr = e; MT5.proc = null; }
    }
    MT5.error = lastErr ? lastErr.message : 'python not found';
    console.log(`MT5 bridge unavailable: ${MT5.error}`);
    return false;
  })().finally(() => { MT5.starting = null; });
  return MT5.starting;
}
function applyOffset(off) {
  if (typeof CFG.mt5UtcOffsetHours === 'number') { MT5.offset = CFG.mt5UtcOffsetHours * 3600; MT5.offsetKnown = true; return; }
  const f = path.join(HOME, 'mt5_offset.json');
  if (typeof off === 'number') {
    MT5.offset = off; MT5.offsetKnown = true;
    try { fs.writeFileSync(f, JSON.stringify({ offset: off, at: new Date().toISOString() })); } catch { /* ignore */ }
  } else if (!MT5.offsetKnown) {
    try { MT5.offset = JSON.parse(fs.readFileSync(f, 'utf8')).offset; MT5.offsetKnown = true; } catch { /* keep 0 */ }
  }
}
async function refreshMT5Symbols() {
  const list = await mt5Call('symbols');
  MT5.symbols = new Map(list.map(s => [s.name.toUpperCase(), s]));
}
setInterval(async () => {
  if (!MT5.ready) return;
  try { await refreshMT5Symbols(); const o = await mt5Call('offset'); applyOffset(o.offset); } catch { /* bridge will restart on next use */ }
}, 60000);

const CRYPTO_RE = /(USDT|USDC|FDUSD|BUSD|TUSD|BTC|ETH|BNB)$/;
function sourceFor(symbol) {
  if (CFG.mock) return 'mock';
  if (MT5.ready && MT5.symbols.has(symbol)) return 'mt5';
  if (CRYPTO_RE.test(symbol)) return 'binance';
  return MT5.ready ? 'mt5' : 'binance';
}

async function fetchMT5(symbol, interval, count) {
  if (!MT5.ready && !(await startMT5())) throw new Error(`MT5 недоступен: ${MT5.error || 'bridge not started'}`);
  const real = MT5.symbols.get(symbol)?.name || symbol;
  const r = await mt5Call('rates', { symbol: real, tf: interval, count });
  const off = MT5.offset, stepMs = INTERVALS[interval] * 1000, out = new Array(r.t.length);
  for (let i = 0; i < r.t.length; i++) {
    const openTime = (r.t[i] - off) * 1000;
    out[i] = { openTime, open: r.o[i], high: r.h[i], low: r.l[i], close: r.c[i], volume: r.rv[i] > 0 ? r.rv[i] : r.tv[i], closeTime: openTime + stepMs - 1 };
  }
  return out;
}

// ───────────────────────── MARKET DATA ─────────────────────────
const barCache = new Map(); // key → {ts, bars}

function mockBars(symbol, interval, limit) {
  const step = INTERVALS[interval] * 1000;
  let seed = [...symbol].reduce((a, c) => a + c.charCodeAt(0), 0);
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const now = Math.floor(Date.now() / step) * step;
  let p = symbol.startsWith('XAU') ? 2650 : 60000;
  const out = [];
  for (let i = limit - 1; i >= 0; i--) {
    const t = now - i * step;
    const o = p;
    p = p * (1 + (rnd() - 0.5) * 0.006 + Math.sin(i / 40) * 0.0008);
    const c = p;
    const h = Math.max(o, c) * (1 + rnd() * 0.002), l = Math.min(o, c) * (1 - rnd() * 0.002);
    out.push({ openTime: t, open: o, high: h, low: l, close: c, volume: 10 + rnd() * 100, closeTime: t + step - 1 });
  }
  return out;
}

async function fetchBinance(symbol, interval, limit) {
  // Spot first, then USDT-M futures (e.g. symbols that exist only as perpetuals)
  // data-api.binance.vision = Binance's public market-data mirror (reachable where api.binance.com is blocked)
  const hosts = [
    { base: 'https://data-api.binance.vision/api/v3/klines', max: 1000 },
    { base: 'https://api.binance.com/api/v3/klines', max: 1000 },
    { base: 'https://fapi.binance.com/fapi/v1/klines', max: 1500 },
  ];
  let lastErr = null;
  for (const h of hosts) {
    try {
      const all = [];
      let endTime = undefined;
      while (all.length < limit) {
        const n = Math.min(h.max, limit - all.length);
        const url = `${h.base}?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${n}` + (endTime ? `&endTime=${endTime}` : '');
        const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!r.ok) throw new Error(`${h.base} → HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
        const rows = await r.json();
        if (!Array.isArray(rows) || rows.length === 0) break;
        all.unshift(...rows);
        endTime = rows[0][0] - 1;
        if (rows.length < n) break;
      }
      if (!all.length) throw new Error('empty response');
      return all.map(k => ({ openTime: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5], closeTime: k[6] }));
    } catch (e) { lastErr = new Error(`${h.base}: ${e.message}`); }
  }
  throw lastErr;
}

async function getBars(symbol, interval, limit, fresh = false) {
  interval = normTf(interval);
  if (!interval) throw new Error('Unsupported interval');
  limit = Math.max(50, Math.min(CFG.maxBars, Number(limit) || CFG.defaultBars));
  const key = `${symbol}|${interval}|${limit}`;
  const hit = barCache.get(key);
  const ttl = Math.min(INTERVALS[interval] * 1000, 30000);
  if (hit && !fresh && Date.now() - hit.ts < ttl) return hit.bars;
  const src = sourceFor(symbol);
  const bars = await fetchAny(src, symbol, interval, limit);
  barCache.set(key, { ts: Date.now(), bars, src });
  return bars;
}
async function fetchNative(src, symbol, tf, limit) {
  return src === 'mock' ? mockBars(symbol, tf, limit) : src === 'mt5' ? fetchMT5(symbol, tf, limit) : fetchBinance(symbol, tf, limit);
}
async function fetchAny(src, symbol, tf, limit) {
  const plan = planTf(src, tf);
  if (plan.native) return fetchNative(src, symbol, tf, limit);
  const cap = src === 'mt5' ? 30000 : 10000;
  const baseCount = Math.min(cap, Math.ceil(limit * plan.ratio + plan.ratio * 2));
  const base = await fetchNative(src, symbol, plan.base, baseCount);
  return aggregate(base, tf).slice(-limit);
}

// Merge freshly polled tail bars into every cached series of this symbol/interval (keeps PineTS runs current)
function mergeTail(symbol, interval, tail) {
  const prefix = `${symbol}|${interval}|`;
  for (const [k, entry] of barCache) {
    if (!k.startsWith(prefix)) continue;
    const arr = entry.bars;
    for (const b of tail) {
      const last = arr[arr.length - 1]; if (!last) continue;
      if (b.openTime === last.openTime) arr[arr.length - 1] = b;
      else if (b.openTime > last.openTime) { arr.push(b); arr.shift(); }
      else for (let i = arr.length - 2; i >= Math.max(0, arr.length - 6); i--) if (arr[i].openTime === b.openTime) { arr[i] = b; break; }
    }
    entry.ts = Date.now();
  }
}

// ───────────────────────── LIVE STREAM (SSE) ─────────────────────────
const streams = new Map(); // "SYM|tf" → { clients:Set<res>, timer, busy, lastOpen }
function toClientBar(b) { return { time: sec(b.openTime), open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }; }
async function pollStream(key) {
  const st = streams.get(key); if (!st || st.busy) return;
  st.busy = true;
  const [symbol, interval] = key.split('|');
  try {
    const src = sourceFor(symbol);
    let tail;
    if (src === 'mock') { const last = (await getBars(symbol, interval, 50)).slice(-1)[0]; const c = last.close * (1 + (Math.random() - 0.5) * 0.0008); tail = [{ ...last, close: c, high: Math.max(last.high, c), low: Math.min(last.low, c) }]; }
    else {
      const plan = planTf(src, interval);
      tail = plan.native ? await fetchNative(src, symbol, interval, 3)
        : aggregate(await fetchNative(src, symbol, plan.base, Math.ceil(plan.ratio * 2) + 2), interval).slice(-2);
    }
    mergeTail(symbol, interval, tail);
    const newBar = st.lastOpen !== null && tail[tail.length - 1].openTime > st.lastOpen;
    st.lastOpen = tail[tail.length - 1].openTime;
    const msg = { key, bars: tail.map(toClientBar), newBar, src };
    for (const sink of st.clients) sink('message', msg);
    st.errors = 0;
  } catch (e) {
    st.errors = (st.errors || 0) + 1;
    if (st.errors === 1 || st.errors % 30 === 0) for (const sink of st.clients) sink('error', { key, error: e.message });
  } finally { st.busy = false; }
}
// sink(event, obj) receives every update for SYM|tf; returns an unsubscribe function
function subscribe(symbol, interval, sink) {
  const key = `${symbol}|${interval}`;
  let st = streams.get(key);
  if (!st) {
    const ms = sourceFor(symbol) === 'mt5' ? CFG.livePollMs.mt5 : CFG.livePollMs.binance;
    st = { clients: new Set(), busy: false, lastOpen: null, errors: 0 };
    st.timer = setInterval(() => pollStream(key), ms);
    streams.set(key, st);
  }
  st.clients.add(sink);
  return () => { st.clients.delete(sink); if (!st.clients.size) { clearInterval(st.timer); streams.delete(key); } };
}
function sseSink(res) { return (event, obj) => res.write(`${event === 'message' ? '' : `event: ${event}\n`}data: ${JSON.stringify(obj)}\n\n`); }

// ───────────────────────── PineTS data provider (main series + request.security MTF) ─────────────────────────
function makeProvider(mainSymbol, mainInterval, mainBars, untilMs = 0) {
  const kl = b => ({ ...b, quoteAssetVolume: 0, numberOfTrades: 0, takerBuyBaseAssetVolume: 0, takerBuyQuoteAssetVolume: 0, ignore: 0 });
  class QLProvider extends BaseProvider {
    constructor() { super({ requiresApiKey: false, providerName: 'PandichLab' }); }
    getSupportedTimeframes() { return new (class extends Set { has(x) { return !!pineToInt(x); } })(); }
    async _getMarketDataNative(tickerId, timeframe, limit, sDate, eDate) {
      const sym = String(tickerId || mainSymbol).split(':').pop().toUpperCase();
      const interval = PINE2INT[String(timeframe)];
      if (!interval) throw new Error(`timeframe "${timeframe}" не поддерживается источником данных`);
      if (sym === mainSymbol && interval === mainInterval && !sDate && !eDate) return mainBars.map(kl);
      const tfMs = INTERVALS[interval] * 1000;
      let count = limit || 500;
      if (sDate) count = Math.ceil(((eDate || Date.now()) - sDate) / tfMs) + 3;
      count = Math.max(10, Math.min(CFG.maxBars, count));
      let bars = await getBars(sym, interval, count);
      if (sDate) bars = bars.filter(b => b.openTime + tfMs > sDate && (!eDate || b.openTime <= eDate));
      if (untilMs) bars = bars.filter(b => b.openTime <= untilMs); // replay: nothing after the replay cursor
      return bars.map(kl);
    }
    async getSymbolInfo(tickerId) {
      const sym = String(tickerId || mainSymbol).split(':').pop().toUpperCase();
      const m = MT5.symbols.get(sym);
      const digits = m ? m.digits : 2, mintick = Math.pow(10, -digits);
      return { ticker: sym, tickerid: sym, root: sym, prefix: m ? 'MT5' : 'BINANCE', description: m ? m.desc : sym, type: m ? 'forex' : 'crypto',
        timezone: 'Etc/UTC', session: '24x7', mintick, pricescale: Math.round(1 / mintick), minmove: 1, pointvalue: 1, currency: 'USD', basecurrency: '' };
    }
  }
  return new QLProvider();
}


// ───────────────────────── WATCH MODE (server-side signals → Telegram / browser) ─────────────────────────
// A watch = Pine script + symbol + TF. On every closed bar the server re-runs the script on closed bars only and fires
// when alert()/alertcondition() (and optionally a plotshape/plotarrow marker) lands on that bar. Runs without a browser.
const DATA_DIR = path.join(HOME, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const WATCH_FILE = path.join(DATA_DIR, 'watches.json'), SETTINGS_FILE = path.join(DATA_DIR, 'settings.json'), EVENTS_FILE = path.join(DATA_DIR, 'watch_events.jsonl');
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJSON = (f, v) => { const tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(v, null, 2), 'utf8'); fs.renameSync(tmp, f); };
const W = {
  list: readJSON(WATCH_FILE, []),
  settings: readJSON(SETTINGS_FILE, {}),
  events: [],
  busy: false,
};
try { W.events = fs.readFileSync(EVENTS_FILE, 'utf8').trim().split('\n').filter(Boolean).slice(-200).map(l => JSON.parse(l)); } catch { /* none yet */ }
const saveWatches = () => writeJSON(WATCH_FILE, W.list);
const saveSettings = () => writeJSON(SETTINGS_FILE, W.settings);
const tg = () => W.settings.telegram || {};
const htmlEsc = x => String(x).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const fmtUtc = t => new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

async function tgCall(method, body, token = tg().token) {
  if (!token) throw new Error('Telegram: токен бота не задан');
  let r;
  try { r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(12000) }); }
  catch (e) { throw new Error(`Telegram недоступен: ${e.cause?.code || e.message}`); }
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`Telegram: ${j.description || r.status}`);
  return j.result;
}
async function tgSend(text) {
  const t = tg(); if (!t.token || !t.chatId) throw new Error('Telegram не настроен (нужны токен и чат)');
  return tgCall('sendMessage', { chat_id: t.chatId, text, parse_mode: 'HTML', disable_web_page_preview: true });
}
async function tgFindChat(token) { // the chat of the last message someone sent to the bot
  const ups = await tgCall('getUpdates', { limit: 50, timeout: 0 }, token);
  for (let i = ups.length - 1; i >= 0; i--) { const m = ups[i].message || ups[i].channel_post || ups[i].my_chat_member; if (m && m.chat) return { id: m.chat.id, title: m.chat.title || [m.chat.first_name, m.chat.last_name].filter(Boolean).join(' ') || m.chat.username || String(m.chat.id) }; }
  return null;
}

function watchPublic(w) { const { code, ...rest } = w; return { ...rest, codeLines: String(code || '').split('\n').length }; }
function closedBarIndex(bars, interval) {
  if (!bars.length) return -1;
  const last = bars[bars.length - 1], tf = INTERVALS[interval] * 1000;
  return last.openTime + tf <= Date.now() ? bars.length - 1 : bars.length - 2; // the last bar is still forming
}
async function evalWatch(w, { force = false } = {}) {
  const bars = await getBars(w.symbol, w.interval, CFG.watchBars, true);
  const ci = closedBarIndex(bars, w.interval);
  if (ci < 1) throw new Error('мало данных');
  const closedT = sec(bars[ci].openTime), tfSec = INTERVALS[w.interval];
  if (!force && w.lastBar && closedT <= w.lastBar) return { skipped: true };
  const r = await runPine({ code: w.code, symbol: w.symbol, interval: w.interval, limit: CFG.watchBars, inputs: w.inputs || {}, until: closedT });
  const hits = [];
  if (w.onAlerts !== false) for (const a of r.alerts || []) if (a.time === closedT) hits.push({ kind: a.type === 'alertcondition' ? 'alertcondition' : 'alert', text: a.title && a.message && a.title !== a.message ? `${a.title}: ${a.message}` : (a.message || a.title || 'alert') });
  if (w.onMarkers) for (const m of r.markers || []) if (m.time === closedT) hits.push({ kind: 'marker', text: `${m.shape === 'arrowUp' || m.position === 'belowBar' ? '▲' : '▼'} ${m.text || m.shape || 'маркер'}`.trim() });
  if (w.onStrategy && r.strategy) { // strategy fills on this bar (orders placed on the previous close fill at this bar's open)
    for (const t of [...(r.strategy.closedtrades || []), ...(r.strategy.opentrades || [])]) {
      if (t.entry_time === closedT) hits.push({ kind: 'strategy', text: `вход ${t.size > 0 ? 'Long' : 'Short'} ${t.entry_id || ''} @ ${t.entry_price}`.replace(/\s+/g, ' ') });
      if (t.exit_time === closedT) hits.push({ kind: 'strategy', text: `выход ${t.exit_id || ''} @ ${t.exit_price} (P&L ${Number(t.profit).toFixed(2)})`.replace(/\s+/g, ' ') });
    }
  }
  const isFirst = !w.lastBar;
  const gap = w.lastBar ? (closedT - w.lastBar) / tfSec : 0;
  return { closedT, close: bars[ci].close, hits, title: r.title, isFirst, gap };
}
function recordEvent(ev) {
  W.events.push(ev); if (W.events.length > 200) W.events.splice(0, W.events.length - 200);
  try { fs.appendFileSync(EVENTS_FILE, JSON.stringify(ev) + '\n'); } catch { /* disk issue: keep in memory */ }
}
async function fireWatch(w, res, test = false) {
  const digits = digitsFor(w.symbol, res.close);
  const lines = res.hits.map(h => h.text);
  const ev = { id: 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), t: Date.now(), watchId: w.id, name: w.name, symbol: w.symbol, interval: w.interval, barTime: res.closedT, close: res.close, hits: res.hits, test, telegram: null };
  if (w.telegram !== false && tg().token && tg().chatId) {
    const text = `${test ? '🧪 <b>Тест</b> · ' : '🔔 '}<b>${htmlEsc(w.name)}</b>\n${htmlEsc(w.symbol)} · ${htmlEsc(w.interval)} · бар ${fmtUtc(res.closedT)}\nЦена закрытия: <b>${Number(res.close).toFixed(digits)}</b>\n` + (lines.length ? lines.map(l => '• ' + htmlEsc(l)).join('\n') : '<i>сигналов на этом баре нет</i>') + '\n<i>Pandich Lab</i>';
    try { await tgSend(text); ev.telegram = 'ok'; } catch (e) { ev.telegram = e.message; }
  }
  recordEvent(ev);
  return ev;
}
async function watchTick() {
  if (W.busy) return; W.busy = true;
  try {
    for (const w of W.list) {
      if (!w.enabled) continue;
      const tfSec = INTERVALS[w.interval]; if (!tfSec) continue;
      // nothing to do until the bar after the last processed one has closed
      if (w.lastBar && Date.now() / 1000 < w.lastBar + 2 * tfSec + 1) continue;
      if (w.nextTry && Date.now() < w.nextTry) continue;
      try {
        const r = await evalWatch(w);
        w.lastCheck = Date.now(); w.error = null; w.fails = 0; w.nextTry = 0;
        if (r.skipped) { w.nextTry = Date.now() + 5000; continue; } // market closed / no new bar yet
        w.lastBar = r.closedT;
        // first run after enabling, or a long outage (server off, weekend): sync silently instead of replaying old bars
        if (r.hits.length && !r.isFirst && r.gap <= 2) { const ev = await fireWatch(w, r); w.lastFire = ev.t; w.fired = (w.fired || 0) + 1; }
        saveWatches();
      } catch (e) {
        w.error = e.message; w.fails = (w.fails || 0) + 1; w.lastCheck = Date.now();
        w.nextTry = Date.now() + Math.min(300000, 5000 * 2 ** Math.min(6, w.fails)); // back off on repeated errors
        saveWatches();
      }
    }
  } finally { W.busy = false; }
}
setInterval(watchTick, 5000);


// ───────────────────────── LIBRARY (built-in scripts) + TEMPLATES + LAYOUTS ─────────────────────────
function listLibrary() {
  let files = [];
  try { files = fs.readdirSync(CFG.libraryDir).filter(f => f.endsWith('.pine')); } catch { /* none */ }
  return files.map(f => {
    const head = fs.readFileSync(path.join(CFG.libraryDir, f), 'utf8').split('\n').slice(0, 10).join('\n');
    const tag = k => { const m = new RegExp(`^//\\s*@${k}\\s+(.+)$`, 'm').exec(head); return m ? m[1].trim() : ''; };
    return { file: f, name: tag('name') || f.replace(/\.pine$/, ''), category: tag('category') || 'Разное', desc: tag('desc'), tags: tag('tags') };
  }).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}
const TEMPLATES_FILE = path.join(DATA_DIR, 'templates.json'), LAYOUTS_FILE = path.join(DATA_DIR, 'layouts.json');
const COLL = { templates: TEMPLATES_FILE, layouts: LAYOUTS_FILE };
function collList(kind) { return readJSON(COLL[kind], []); }
function collSave(kind, item) {
  const list = collList(kind);
  const name = String(item.name || '').trim().slice(0, 80); if (!name) throw new Error('нужно название');
  const payload = item.data; if (!payload || typeof payload !== 'object') throw new Error('нет данных');
  if (JSON.stringify(payload).length > 2_000_000) throw new Error('слишком большой объём');
  let it = item.id ? list.find(x => x.id === item.id) : list.find(x => x.name === name);
  if (it) { it.name = name; it.data = payload; it.updated = Date.now(); }
  else { it = { id: kind[0] + Date.now().toString(36), name, data: payload, created: Date.now(), updated: Date.now() }; list.push(it); }
  writeJSON(COLL[kind], list);
  return it;
}
function collDelete(kind, id) { const list = collList(kind); const n = list.length; const out = list.filter(x => x.id !== id); writeJSON(COLL[kind], out); return out.length < n; }

// ───────────────────────── PINE EXECUTION + NORMALIZATION ─────────────────────────
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const sec = ms => Math.floor(ms / 1000);

function lastDrawState(plot) {
  if (!plot || !Array.isArray(plot.data) || !plot.data.length) return [];
  const v = plot.data[plot.data.length - 1].value;
  return Array.isArray(v) ? v.filter(o => o && !o._deleted) : [];
}

// x (bar_index or bar_time ms) → logical bar index (float, may be beyond data)
function makeXMapper(bars) {
  const n = bars.length;
  const step = n > 1 ? bars[n - 1].openTime - bars[n - 2].openTime : 60000;
  return (x, xloc) => {
    if (!isNum(x)) return null;
    if (xloc === 'bt' || xloc === 'bar_time') {
      if (x >= bars[n - 1].openTime) return n - 1 + (x - bars[n - 1].openTime) / step;
      if (x <= bars[0].openTime) return (x - bars[0].openTime) / step;
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (bars[m].openTime <= x) lo = m; else hi = m; }
      return lo + (x - bars[lo].openTime) / (bars[hi].openTime - bars[lo].openTime);
    }
    return x; // bar_index
  };
}

function shapeFromPine(shape, location, value) {
  const s = String(shape || '');
  let markerShape = 'circle';
  if (s.includes('triangle_up') || s.includes('arrow_up') || s.includes('labelup')) markerShape = 'arrowUp';
  else if (s.includes('triangle_down') || s.includes('arrow_down') || s.includes('labeldown')) markerShape = 'arrowDown';
  else if (s.includes('square') || s.includes('diamond') || s.includes('cross') || s.includes('xcross')) markerShape = 'square';
  const loc = String(location || 'AboveBar').toLowerCase();
  let position = 'aboveBar';
  if (loc.includes('below') || loc === 'bottom') position = 'belowBar';
  if (loc === 'absolute' && isNum(value)) position = 'atPriceMiddle';
  return { markerShape, position };
}

function normalize(ctx, bars) {
  const P = ctx.plots || {};
  // indicator() → ctx.indicator ; strategy() → ctx.strategy.config (ctx.indicator is undefined)
  const isStrategy = !ctx.indicator && !!(ctx.strategy && ctx.strategy.config);
  const ind = ctx.indicator || (ctx.strategy && ctx.strategy.config) || {};
  const overlay = ind.overlay === true;
  const xmap = makeXMapper(bars);
  const out = {
    title: ind.title || 'Script', overlay, declaration: isStrategy ? 'strategy' : 'indicator',
    series: [], fills: [], hlines: [], markers: [], bg: [], barcolors: [],
    labels: [], lines: [], boxes: [], tables: [], strategy: null, warnings: [...(ctx.warnings || [])],
  };
  for (const [key, plot] of Object.entries(P)) {
    const o = plot.options || {};
    const style = String(o.style || '');
    const data = Array.isArray(plot.data) ? plot.data : [];
    if (key === '__labels__') {
      // Pine defaults: label.new() color = blue, textcolor = white (PineTS reports them as "")
      out.labels.push(...lastDrawState(plot).map(l => ({ li: xmap(l.x, l.xloc), y: l.y, yloc: l.yloc, text: l.text || '', color: l.color || '#2962FF', textcolor: l.textcolor || '#FFFFFF', style: l.style, size: l.size, tooltip: l.tooltip }))
        .filter(l => l.li !== null));
      continue;
    }
    if (key === '__lines__') {
      out.lines = lastDrawState(plot).map(l => ({ li1: xmap(l.x1, l.xloc), y1: l.y1, li2: xmap(l.x2, l.xloc), y2: l.y2, extend: l.extend, color: l.color, style: l.style, width: l.width }))
        .filter(l => l.li1 !== null && l.li2 !== null && isNum(l.y1) && isNum(l.y2));
      continue;
    }
    if (key === '__boxes__') {
      out.boxes = lastDrawState(plot).map(b => ({ li1: xmap(b.left, b.xloc), top: b.top, li2: xmap(b.right, b.xloc), bottom: b.bottom, extend: b.extend, border_color: b.border_color, border_width: b.border_width, border_style: b.border_style, bgcolor: b.bgcolor, text: b.text, text_color: b.text_color }))
        .filter(b => b.li1 !== null && b.li2 !== null && isNum(b.top) && isNum(b.bottom));
      continue;
    }
    if (key === '__tables__') {
      out.tables = lastDrawState(plot).map(t => ({ position: t.position, bgcolor: t.bgcolor, border_color: t.border_color, border_width: t.border_width, frame_color: t.frame_color, frame_width: t.frame_width,
        merges: (t.merges || []).map(m => ({ c0: m.startCol, r0: m.startRow, c1: m.endCol, r1: m.endRow })),
        cells: (t.cells || []).map(row => (row || []).map(c => c ? { text: String(c.text ?? ''), text_color: c.text_color, bgcolor: c.bgcolor, text_size: c.text_size, text_halign: c.text_halign, text_valign: c.text_valign, width: c.width, height: c.height, merged: !!c._merged && !!c._merge_parent } : null)) }));
      continue;
    }
    if (key === '__linefills__' || key === '__polylines__') continue; // not rendered in MVP

    if (style === 'hline') {
      const v = data.find(d => isNum(d.value));
      if (v) out.hlines.push({ title: key, price: v.value, color: o.color || '#787B86' });
      continue;
    }
    if (style === 'background') {
      for (const d of data) { const c = d.options && d.options.color; if (d.value && c) out.bg.push({ t: sec(d.time), c }); }
      continue;
    }
    if (style === 'barcolor') {
      for (const d of data) { const c = d.options && d.options.color; if (c) out.barcolors.push({ t: sec(d.time), c }); }
      continue;
    }
    if (style === 'fill') {
      out.fills.push({ plot1: o.plot1, plot2: o.plot2, color: o.color, data: data.map(d => ({ t: sec(d.time), c: (d.options && d.options.color) || o.color })) });
      continue;
    }
    if (style === 'shape' || style === 'char') {
      const isArrow = style === 'shape' && !o.shape;
      for (const d of data) {
        const v = d.value;
        if (v === null || v === false || v === undefined || (typeof v === 'number' && (!Number.isFinite(v) || (isArrow && v === 0)))) continue;
        const dopt = d.options || {};
        const color = dopt.color || o.color || '#2962FF';
        const off = Number(dopt.offset ?? o.offset ?? 0) || 0;
        const idx = bars.findIndex(b => b.openTime === d.time);
        const bi = idx + off;
        if (idx < 0 || bi < 0 || bi >= bars.length) continue;
        const t = sec(bars[bi].openTime);
        if (isArrow) { out.markers.push({ time: t, position: v > 0 ? 'belowBar' : 'aboveBar', shape: v > 0 ? 'arrowUp' : 'arrowDown', color: color || (v > 0 ? '#089981' : '#F23645') }); continue; }
        if (style === 'char') {
          const { position } = shapeFromPine('', dopt.location || o.location, v);
          out.markers.push({ time: t, position, shape: 'circle', size: 0.3, color, text: dopt.char || o.char || '' });
        } else {
          const shp = String(dopt.shape || o.shape || '');
          const { markerShape, position } = shapeFromPine(shp, dopt.location || o.location, v);
          if (/label_?(up|down)/i.test(shp)) { // shape.labelup / labeldown: a filled callout box like TradingView, not a marker
            const absolute = String(dopt.location || o.location || '').toLowerCase().includes('absolute');
            out.labels.push({ li: bi, y: absolute ? v : null, yloc: absolute ? 'price' : (position === 'belowBar' ? 'belowbar' : 'abovebar'), text: dopt.text || o.text || '',
              color, textcolor: dopt.textcolor || o.textcolor || '#FFFFFF', style: /up/i.test(shp.replace(/label_?/i, '')) ? 'label_up' : 'label_down', size: dopt.size || o.size, fromShape: true });
            continue;
          }
          const m = { time: t, position, shape: markerShape, color, text: dopt.text || o.text || '' };
          if (position === 'atPriceMiddle') m.price = v;
          out.markers.push(m);
        }
      }
      continue;
    }
    // Regular plot (line/histogram/area/circles/...)
    const s = {
      title: key, style: style || 'style_line', color: o.color || '#2962FF', linewidth: o.linewidth || 1,
      pane: (o.overlay === true || overlay) ? 0 : 1,
      data: data.map(d => ({ t: sec(d.time), v: isNum(d.value) ? d.value : null, c: (d.options && d.options.color) || null })),
    };
    out.series.push(s);
  }
  // Drawings: logical bar index → time (sec, may be fractional / beyond last bar) so the client can place them
  // on its own bar array even after live bars were appended.
  const n = bars.length, stepMs = n > 1 ? bars[n - 1].openTime - bars[n - 2].openTime : 60000;
  const liToT = li => {
    if (li === null || !isNum(li)) return null;
    if (li <= 0) return (bars[0].openTime + li * stepMs) / 1000;
    if (li >= n - 1) return (bars[n - 1].openTime + (li - (n - 1)) * stepMs) / 1000;
    const i = Math.floor(li), f = li - i; return (bars[i].openTime + f * (bars[i + 1].openTime - bars[i].openTime)) / 1000;
  };
  for (const l of out.labels) { l.t = liToT(l.li); delete l.li; }
  for (const l of out.lines) { l.t1 = liToT(l.li1); l.t2 = liToT(l.li2); delete l.li1; delete l.li2; }
  for (const b of out.boxes) { b.t1 = liToT(b.li1); b.t2 = liToT(b.li2); delete b.li1; delete b.li2; }
  // Strategy
  const S = ctx.strategy;
  if (isStrategy && S && Array.isArray(S.closedtrades)) {
    const tr = t => ({ entry_time: sec(t.entry_time), entry_price: t.entry_price, exit_time: t.exit_time ? sec(t.exit_time) : null, exit_price: t.exit_price ?? null,
      size: t.size, profit: t.profit, entry_id: t.entry_id, exit_id: t.exit_id || null });
    out.declaration = 'strategy';
    out.strategy = {
      netprofit: S.netprofit, grossprofit: S.grossprofit, grossloss: S.grossloss, initial_capital: S.initial_capital, equity: S.equity,
      max_drawdown: S.max_drawdown, max_drawdown_percent: S.max_drawdown_percent_value, wintrades: S.wintrades, losstrades: S.losstrades,
      total: S.closedtrades.length, profit_factor: S.grossloss ? Math.abs(S.grossprofit / S.grossloss) : null,
      sharpe: S.sharpe_ratio, closedtrades: S.closedtrades.map(tr), opentrades: (S.opentrades || []).map(tr),
    };
  }
  return out;
}

let runChain = Promise.resolve();
function withRunLock(fn) { const p = runChain.then(fn, fn); runChain = p.catch(() => {}); return p; }
async function runPine(args) {
  return withRunLock(async () => {
    const logs = [], orig = { log: console.log, info: console.info, warn: console.warn, error: console.error };
    const cap = level => (...a) => { if (logs.length < 500) logs.push({ level, text: a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ').slice(0, 2000) }); };
    console.log = cap('info'); console.info = cap('info'); console.warn = cap('warning'); console.error = cap('error');
    try { const r = await runPineRaw(args); r.logs = logs; return r; }
    catch (e) { e.logs = logs; throw e; }
    finally { Object.assign(console, orig); }
  });
}
async function runPineRaw({ code, symbol, interval, limit, inputs, until, fresh }) {
  let bars = await getBars(symbol, interval, limit, !!fresh);
  const untilMs = Number(until) > 0 ? Number(until) * 1000 : 0; // replay cursor (unix sec of the last revealed bar)
  if (untilMs) { bars = bars.filter(b => b.openTime <= untilMs); if (bars.length < 2) throw new Error('replay: слишком мало баров до курсора'); }
  const t0 = Date.now();
  const indicator = new Indicator(code, inputs && typeof inputs === 'object' ? inputs : undefined);
  let inputsMeta = [];
  try { inputsMeta = indicator.getInputsMeta(); } catch { /* transpile error will surface on run */ }
  const pts = new PineTS(makeProvider(symbol, interval, bars, untilMs), symbol, PINE_TF[interval], bars.length);
  pts.setAlertMode('all'); // alert()/alertcondition() fire on every historical bar → Watch mode + alert history
  const ctx = await pts.run(indicator);
  const res = normalize(ctx, bars);
  res.alerts = (ctx.alerts || []).slice(-300).map(a => ({ type: a.type, id: a.id, title: a.title || '', message: String(a.message ?? ''), time: a.time > 1e12 ? sec(a.time) : a.time }));
  res.lastBarTime = bars.length ? sec(bars[bars.length - 1].openTime) : null;
  res.inputsMeta = inputsMeta;
  res.ms = Date.now() - t0;
  res.bars = bars.length;
  res.symbol = symbol; res.interval = interval; res.limit = bars.length;
  return res;
}

// Compact feedback for the agent (what the model "sees" after running its code)
function summarizeForAgent(res) {
  const lines = [`OK: "${res.title}" ran on ${res.bars} bars in ${res.ms} ms. overlay=${res.overlay}, type=${res.declaration}.`];
  for (const s of res.series) {
    const vals = s.data.map(d => d.v).filter(v => v !== null);
    const last = vals.length ? vals[vals.length - 1] : null;
    lines.push(`plot "${s.title}" pane=${s.pane ? 'separate' : 'price'}: ${vals.length}/${s.data.length} non-na, last=${last === null ? 'na' : +last.toFixed(6)}, min=${vals.length ? +Math.min(...vals).toFixed(6) : 'na'}, max=${vals.length ? +Math.max(...vals).toFixed(6) : 'na'}`);
    if (!vals.length) lines.push(`  WARNING: plot "${s.title}" is entirely na.`);
  }
  if (res.markers.length) lines.push(`shapes/markers: ${res.markers.length}`);
  if (res.hlines.length) lines.push(`hlines: ${res.hlines.map(h => h.price).join(', ')}`);
  if (res.bg.length) lines.push(`bgcolor bars: ${res.bg.length}`);
  if (res.labels.length) lines.push(`labels: ${res.labels.length} (last 3 texts: ${res.labels.slice(-3).map(l => JSON.stringify(l.text)).join(', ')})`);
  if (res.lines.length) lines.push(`lines: ${res.lines.length}`);
  if (res.boxes.length) lines.push(`boxes: ${res.boxes.length}`);
  if (res.tables.length) lines.push(`tables: ${res.tables.length}; first table cells: ${JSON.stringify(res.tables[0].cells.map(r => r.map(c => c && c.text))).slice(0, 300)}`);
  if (res.strategy) {
    const S = res.strategy;
    lines.push(`strategy: trades=${S.total}, net=${S.netprofit?.toFixed?.(2)}, win=${S.wintrades}, loss=${S.losstrades}, PF=${S.profit_factor ? S.profit_factor.toFixed(2) : 'n/a'}, maxDD=${S.max_drawdown?.toFixed?.(2)}`);
  }
  if (res.inputsMeta?.length) lines.push(`inputs: ${res.inputsMeta.map(i => `${i.title || i.name}=${JSON.stringify(i.defval)}`).join(', ')}`);
  if (res.warnings?.length) lines.push(`runtime warnings: ${JSON.stringify(res.warnings).slice(0, 800)}`);
  if (res.logs?.length) lines.push(`log output (${res.logs.length}):\n${res.logs.slice(-15).map(l => `  [${l.level}] ${l.text}`).join('\n')}`);
  if (!res.series.length && !res.markers.length && !res.labels.length && !res.lines.length && !res.boxes.length && !res.bg.length && !res.tables.length && !res.strategy)
    lines.push('WARNING: script produced no visible output.');
  return lines.join('\n');
}

// ───────────────────────── AGENT (Anthropic Messages API, tool use) ─────────────────────────
const SYSTEM_PROMPT = `You are Panda, a senior Pine Script v6 developer embedded in a charting workbench.
The user asks for indicators/strategies; you write Pine Script v6 and MUST test it with the run_pine tool before answering.

Runtime facts (IMPORTANT):
- Code is executed by PineTS (open-source Pine runtime in JS), not TradingView. Native Pine v5/v6 is supported but not 100%.
- Always start with //@version=6 and a single indicator(...) or strategy(...) declaration. Use overlay=true for price-pane tools.
- Call ta.* functions on every bar (global scope), never only inside if/for blocks — compute first, use later.
- Prefer plot/plotshape/plotchar/bgcolor/hline/fill/label/line/box/table. polyline and linefill are NOT rendered by this chart.
- No lookahead: request.security must use lookahead=barmerge.lookahead_off and closed-bar values ([1]) for HTF data. Avoid repainting.
- Expose tunable parameters via input.* with clear titles.
- If run_pine returns an error, read it, fix the code, and call run_pine again. If a plot is entirely na or output is empty, fix it.
- Keep max_labels_count/max_lines_count/max_boxes_count reasonable (<=500).

Chart control: use set_chart to switch symbol (Binance tickers like BTCUSDT, ETHUSDT, XAUUSDT) or timeframe when the user asks.

When done: reply briefly in the user's language (usually Russian): what the script does, its inputs, and any caveat. Do not paste the whole code in the reply — the app shows it and applies the last successful run_pine code to the chart automatically.`;

const TOOLS = [
  {
    name: 'run_pine',
    description: 'Compile and run a complete Pine Script v6 indicator/strategy on the current chart data. Returns a summary of outputs (plots, shapes, drawings, strategy stats) or the compile/runtime error. The last successful run is applied to the user chart.',
    input_schema: { type: 'object', properties: { code: { type: 'string', description: 'Full Pine Script v6 source' } }, required: ['code'] },
  },
  {
    name: 'set_chart',
    description: 'Switch the chart symbol and/or timeframe. Timeframes: 1m,3m,5m,15m,30m,1h,2h,4h,1d,1w.',
    input_schema: { type: 'object', properties: { symbol: { type: 'string' }, interval: { type: 'string', description: 'e.g. 1m, 5m, 15m, 1h, 3h, 4h, 1d, 1w, 1M (any n+unit)' } } },
  },
];

const sessions = new Map(); // sessionId → messages[]

async function callClaude(model, messages) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': CFG.apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: CFG.maxTokens, system: SYSTEM_PROMPT, tools: TOOLS, messages }),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Anthropic API HTTP ${r.status}: ${txt.slice(0, 500)}`);
  return JSON.parse(txt);
}

// ── Backend A: Claude Code CLI (subscription login). Agent tests code via `node ql.mjs run …` → /api/agent/run
const live = new Map(); // sid → { chart, emit, lastGood, ccSession }
let lastActiveSid = null;
// ql.mjs passes QL_SID from env; if the Bash tool did not inherit it, fall back to the session currently running
const liveFor = sid => live.get(String(sid || '')) || (lastActiveSid ? live.get(lastActiveSid) : undefined);

function quoteArg(a) {
  // Windows cmd needs quoting for args with spaces/parens; our args never contain double quotes.
  if (process.platform === 'win32') return /[\s()&|<>^*]/.test(a) ? `"${a}"` : a;
  return a;
}

// Save chat image attachments (data URLs) into agent/work so Claude Code can Read them
function saveImages(images) {
  const out = [];
  if (!Array.isArray(images)) return out;
  const dir = path.join(HOME, 'agent', 'work');
  // keep the folder small: drop images older than 1 day
  try { for (const f of fs.readdirSync(dir)) if (/^img_\d+/.test(f) && Date.now() - fs.statSync(path.join(dir, f)).mtimeMs > 86400000) fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
  images.slice(0, 4).forEach((im, i) => {
    const m = /^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/.exec(String(im && im.dataUrl || ''));
    if (!m) return;
    const name = `img_${Date.now()}_${i}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
    fs.writeFileSync(path.join(dir, name), Buffer.from(m[2], 'base64'));
    out.push(`work/${name}${im.label ? ` (${String(im.label).slice(0, 60)})` : ''}`);
  });
  return out;
}

// ── chart context for the agent ("look at my chart")
function digitsFor(symbol, price) {
  const m = MT5.symbols.get(symbol); if (m) return m.digits;
  const v = Math.abs(price || 0); return v >= 1000 ? 2 : v >= 10 ? 3 : v >= 1 ? 4 : 6;
}
const isoMin = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
function barsCSV(bars, digits) {
  const f = v => (+v).toFixed(digits);
  return 'time_utc,open,high,low,close,volume\n' + bars.map(b => `${isoMin(b.openTime)},${f(b.open)},${f(b.high)},${f(b.low)},${f(b.close)},${Math.round(b.volume)}`).join('\n');
}
function atr(bars, n = 14) {
  if (bars.length < n + 1) return null;
  let a = 0;
  for (let i = bars.length - n; i < bars.length; i++) { const b = bars[i], pc = bars[i - 1].close; a += Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc)); }
  return a / n;
}
function swings(bars, k = 5, count = 8) {
  const hi = [], lo = [];
  for (let i = k; i < bars.length - k; i++) {
    let isH = true, isL = true;
    for (let j = i - k; j <= i + k; j++) { if (bars[j].high > bars[i].high) isH = false; if (bars[j].low < bars[i].low) isL = false; }
    if (isH) hi.push(bars[i]); if (isL) lo.push(bars[i]);
  }
  return { hi: hi.slice(-count), lo: lo.slice(-count) };
}
async function chartContext(st) {
  const { symbol, interval, limit } = st.chart;
  const bars = await getBars(symbol, interval, limit);
  const last = bars[bars.length - 1], d = digitsFor(symbol, last.close), f = v => (v === null || v === undefined) ? 'n/a' : (+v).toFixed(d);
  const L = [];
  L.push(`Symbol: ${symbol}  timeframe: ${interval}  source: ${sourceFor(symbol) === 'mt5' ? 'MT5 ' + (MT5.info?.server || '') : 'Binance'}`);
  L.push(`Now (UTC): ${isoMin(Date.now())}. Loaded ${bars.length} bars from ${isoMin(bars[0].openTime)} to ${isoMin(last.openTime)} (last bar is still forming).`);
  L.push(`Last price: ${f(last.close)}. ATR(14) on ${interval}: ${f(atr(bars))}.`);
  let hiB = bars[0], loB = bars[0]; for (const b of bars) { if (b.high > hiB.high) hiB = b; if (b.low < loB.low) loB = b; }
  L.push(`Range of loaded bars: high ${f(hiB.high)} @ ${isoMin(hiB.openTime)}, low ${f(loB.low)} @ ${isoMin(loB.openTime)}.`);
  try {
    const dB = await getBars(symbol, '1d', 60);
    const t = dB[dB.length - 1], y = dB[dB.length - 2];
    L.push(`Daily: today O ${f(t.open)} H ${f(t.high)} L ${f(t.low)} C ${f(t.close)}; yesterday H ${f(y?.high)} L ${f(y?.low)} C ${f(y?.close)}; daily ATR(14) ${f(atr(dB))}.`);
  } catch (e) { L.push(`Daily stats unavailable: ${e.message}`); }
  const sw = swings(bars);
  L.push(`Recent swing highs (5/5 fractal): ${sw.hi.map(b => `${f(b.high)}@${isoMin(b.openTime).slice(5)}`).join(', ') || 'none'}`);
  L.push(`Recent swing lows  (5/5 fractal): ${sw.lo.map(b => `${f(b.low)}@${isoMin(b.openTime).slice(5)}`).join(', ') || 'none'}`);
  const cs = st.clientState || {};
  if (Array.isArray(cs.scripts) && cs.scripts.length) L.push(`Indicators on chart: ${cs.scripts.map(s => `${s.name}${s.visible ? '' : ' (hidden)'}`).join('; ')}`);
  if (Array.isArray(cs.drawings) && cs.drawings.length) L.push(`User drawings: ${cs.drawings.slice(0, 40).map(dr => `${dr.type}[${dr.pts.map(p => `${isoMin(p.t * 1000).slice(5)}→${f(p.p)}`).join(' | ')}]${dr.style?.text ? ` "${dr.style.text}"` : ''}`).join('; ')}`);
  L.push('', `Last 120 bars of ${interval}:`, barsCSV(bars.slice(-120), d));
  return L.join('\n');
}
function toSec(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return v > 1e12 ? Math.floor(v / 1000) : Math.floor(v);
  const n = Number(v); if (Number.isFinite(n)) return toSec(n);
  const ms = Date.parse(/Z|[+-]\d\d:?\d\d$/.test(v) ? v : String(v).replace(' ', 'T') + 'Z'); return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}
const DRAW_TYPES = new Set(['hline', 'hray', 'vline', 'trend', 'ray', 'extended', 'arrow', 'rect', 'ellipse', 'fib_retr', 'price_range', 'date_range', 'text', 'price_label', 'flag', 'callout', 'long', 'short', 'channel']);
async function buildDrawing(st, spec) {
  if (!spec || !DRAW_TYPES.has(spec.type)) throw new Error(`type must be one of: ${[...DRAW_TYPES].join(', ')}`);
  const bars = await getBars(st.chart.symbol, st.chart.interval, st.chart.limit);
  const n = bars.length, step = (bars[n - 1].openTime - bars[n - 2].openTime) / 1000, lastT = bars[n - 1].openTime / 1000;
  const num = (v, name) => { const x = Number(v); if (!Number.isFinite(x)) throw new Error(`${name} must be a number`); return x; };
  const t = toSec(spec.t ?? spec.time) ?? lastT;
  const t1 = toSec(spec.t1) ?? (bars[Math.max(0, n - 60)].openTime / 1000), t2 = toSec(spec.t2) ?? (lastT + 10 * step);
  let pts;
  switch (spec.type) {
    case 'hline': case 'hray': pts = [{ t: spec.type === 'hray' ? t : lastT, p: num(spec.price ?? spec.p, 'price') }]; break;
    case 'vline': pts = [{ t, p: bars[n - 1].close }]; break;
    case 'text': case 'price_label': case 'flag': pts = [{ t, p: num(spec.price ?? spec.p, 'price') }]; break;
    case 'callout': pts = [{ t, p: num(spec.price ?? spec.p, 'price') }, { t: toSec(spec.t2) ?? t + 8 * step, p: Number(spec.p2 ?? spec.price ?? spec.p) }]; break;
    case 'long': case 'short': pts = [{ t: t1, p: num(spec.entry, 'entry') }, { t: t2, p: num(spec.tp, 'tp') }, { t: t2, p: num(spec.sl, 'sl') }]; break;
    case 'channel': pts = [{ t: t1, p: num(spec.p1, 'p1') }, { t: t2, p: num(spec.p2, 'p2') }, { t: toSec(spec.t3) ?? t1, p: num(spec.p3, 'p3') }]; break;
    default: pts = [{ t: t1, p: num(spec.p1, 'p1') }, { t: t2, p: num(spec.p2, 'p2') }];
  }
  const style = { agent: true };
  for (const k of ['color', 'text', 'dash', 'fill', 'extend']) if (spec[k] !== undefined) style[k] = spec[k];
  if (spec.width !== undefined) style.width = Number(spec.width) || 1;
  return { type: spec.type, pts, style };
}

async function agentTurnClaudeCode(body, emit) {
  const sid = String(body.sessionId || 'default');
  const model = CFG.models.includes(body.model) ? body.model : CFG.defaultModel;
  const st = live.get(sid) || { ccSession: null };
  st.chart = { symbol: String(body.symbol || 'BTCUSDT').toUpperCase(), interval: normTf(body.interval) || '15m', limit: body.limit };
  st.emit = emit; st.lastGood = null;
  live.set(sid, st);

  const ctxLines = [`[Chart: ${st.chart.symbol} ${st.chart.interval}, ${st.chart.limit || CFG.defaultBars} bars]`];
  if (body.activeScript && body.activeScript.code) {
    fs.writeFileSync(path.join(HOME, 'agent', 'work', 'current.pine'), String(body.activeScript.code), 'utf8');
    ctxLines.push(`[Selected script "${body.activeScript.name}" is in work/current.pine — edit it if the request refers to it]`);
  }
  st.clientState = body.chartState && typeof body.chartState === 'object' ? body.chartState : null;
  const MODES = {
    look: 'chart analysis (run `node ql.mjs context` first; look at the attached chart image if any)',
    build: 'build an indicator',
    test: 'build and backtest a strategy() — report the stats and say honestly whether the result looks robust or curve-fitted (sample size, costs, parameter sensitivity)',
    alert: 'build an alert: alert()/alertcondition() on bar close; then tell the user to turn it on in the Watch panel (bell icon) to get Telegram/browser notifications',
    code: 'fix / convert / explain the given Pine code',
    pic: 'rebuild what is shown on the attached image as Pine',
    ideas: 'suggest trading-tool ideas for this market (data-driven, concise list), then build one if asked',
  };
  const LEGACY = { chart: 'look', indicator: 'build', strategy: 'test', fix: 'code', screenshot: 'pic', brainstorm: 'ideas' };
  if (LEGACY[body.mode]) body.mode = LEGACY[body.mode];
  if (MODES[body.mode]) ctxLines.push(`[Mode: ${MODES[body.mode]}]`);
  const imgs = saveImages(body.images);
  if (imgs.length) ctxLines.push(`[Attached images — open each with the Read tool before answering: ${imgs.join(', ')}]`);
  const prompt = `${ctxLines.join('\n')}\n\n${String(body.text || '').slice(0, 40000)}`;

  lastActiveSid = sid;
  // ASCII-only argv (Windows cmd.exe code pages mangle Cyrillic); the real prompt goes via UTF-8 stdin
  const args = ['-p', 'Handle the user request from stdin following the Pandich Lab system instructions.',
    '--output-format', 'stream-json', '--verbose',
    '--model', model,
    '--append-system-prompt-file', 'system.md',
    '--permission-mode', 'dontAsk',
    '--allowedTools', process.platform === 'win32' ? 'Read,Write,Edit,Bash(node ql.mjs *),PowerShell(node ql.mjs *)' : 'Read,Write,Edit,Bash(node ql.mjs *)',
  ];
  if (st.ccSession) args.push('--resume', st.ccSession);

  emit({ type: 'status', text: 'Думаю…' });
  await new Promise((resolve, reject) => {
    const env = withGitBash({ ...process.env, QL_PORT: String(CFG.port), QL_SID: sid });
    delete env.ANTHROPIC_API_KEY; // force subscription (OAuth) login, never bill the API
    // Windows: claude is a .cmd shim → run it through cmd.exe explicitly (no shell:true → no DEP0190 warning)
    const isWin = process.platform === 'win32';
    const cmd = isWin ? (process.env.ComSpec || 'cmd.exe') : CFG.claudeBin;
    const cmdArgs = isWin ? ['/d', '/s', '/c', `"${[quoteArg(CFG.claudeBin), ...args.map(quoteArg)].join(' ')}"`] : args;
    const child = spawn(cmd, cmdArgs, {
      cwd: path.join(HOME, 'agent'),
      env,
      windowsHide: true,
      windowsVerbatimArguments: isWin,
    });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Claude Code: превышен таймаут')); }, CFG.agentTimeoutMs);
    let buf = '', errBuf = '', finalResult = null;
    child.stdout.on('data', chunk => {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.session_id) st.ccSession = ev.session_id;
        if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content) && !ev.parent_tool_use_id) {
          for (const b of ev.message.content) {
            if (b.type === 'text' && b.text && b.text.trim()) emit({ type: 'text', text: b.text });
            if (b.type === 'tool_use') {
              const cmd = b.input && (b.input.command || b.input.file_path) || '';
              emit({ type: 'status', text: b.name === 'Bash' ? (String(cmd).includes(' run ') ? 'Запускаю код на графике…' : `> ${cmd}`) : `${b.name} ${path.basename(String(cmd))}` });
            }
          }
        }
        if (ev.type === 'result') finalResult = ev;
      }
    });
    child.stderr.on('data', c => { errBuf += c.toString('utf8'); });
    child.on('error', e => { clearTimeout(timer); reject(new Error(`Не удалось запустить "${CFG.claudeBin}": ${e.message}. Установи Claude Code и залогинься (см. README).`)); });
    child.on('close', code => {
      clearTimeout(timer);
      if (finalResult && finalResult.is_error) return reject(new Error(`Claude Code: ${finalResult.result || finalResult.subtype || 'error'}`));
      if (code !== 0 && !finalResult) return reject(new Error(`Claude Code завершился с кодом ${code}: ${(errBuf || buf).slice(0, 800)}`));
      resolve();
    });
    child.stdin.end(prompt, 'utf8');
  });

  if (st.lastGood) {
    const name = st.lastGood.res.title || 'Script';
    const file = saveScript(name, st.lastGood.code);
    emit({ type: 'script', name, code: st.lastGood.code, file, result: st.lastGood.res });
  }
  st.emit = null;
}

// ── Backend B: Anthropic API key
async function agentTurn(body, emit) {
  if (CFG.backend !== 'api') return agentTurnClaudeCode(body, emit);
  if (!CFG.apiKey) throw new Error('BACKEND=api, но ANTHROPIC_API_KEY не задан.');
  const sid = String(body.sessionId || 'default');
  const alias = CFG.models.includes(body.model) ? body.model : CFG.defaultModel;
  const model = CFG.apiModelIds[alias] || alias;
  const chart = { symbol: String(body.symbol || 'BTCUSDT').toUpperCase(), interval: normTf(body.interval) || '15m', limit: body.limit };
  const messages = sessions.get(sid) || [];
  let userText = String(body.text || '').slice(0, 20000);
  const ctxLines = [`[Chart: ${chart.symbol} ${chart.interval}, ${chart.limit || CFG.defaultBars} bars]`];
  if (body.activeScript && body.activeScript.code) ctxLines.push(`[Selected script "${body.activeScript.name}" — edit it if the request refers to it]\n${String(body.activeScript.code).slice(0, 30000)}`);
  messages.push({ role: 'user', content: `${ctxLines.join('\n')}\n\n${userText}` });

  let lastGood = null;
  for (let step = 0; step < CFG.maxAgentSteps; step++) {
    emit({ type: 'status', text: step === 0 ? 'Думаю…' : `Шаг ${step + 1}…` });
    const resp = await callClaude(model, messages);
    messages.push({ role: 'assistant', content: resp.content });
    for (const b of resp.content) if (b.type === 'text' && b.text.trim()) emit({ type: 'text', text: b.text });
    const uses = resp.content.filter(b => b.type === 'tool_use');
    if (resp.stop_reason !== 'tool_use' || !uses.length) break;
    const results = [];
    for (const u of uses) {
      if (u.name === 'run_pine') {
        const code = String(u.input?.code || '');
        emit({ type: 'status', text: 'Запускаю код на графике…' });
        try {
          const res = await runPine({ code, ...chart });
          lastGood = { code, res };
          emit({ type: 'run', ok: true, code, summary: summarizeForAgent(res) });
          results.push({ type: 'tool_result', tool_use_id: u.id, content: summarizeForAgent(res) });
        } catch (e) {
          const msg = `ERROR: ${e && e.message ? e.message : String(e)}`;
          emit({ type: 'run', ok: false, code, summary: msg });
          results.push({ type: 'tool_result', tool_use_id: u.id, content: msg, is_error: true });
        }
      } else if (u.name === 'set_chart') {
        if (u.input?.symbol) chart.symbol = String(u.input.symbol).toUpperCase();
        if (u.input?.interval && normTf(u.input.interval)) chart.interval = normTf(u.input.interval);
        try {
          const bars = await getBars(chart.symbol, chart.interval, chart.limit);
          emit({ type: 'chart', symbol: chart.symbol, interval: chart.interval });
          results.push({ type: 'tool_result', tool_use_id: u.id, content: `Chart is now ${chart.symbol} ${chart.interval}, ${bars.length} bars, last close ${bars[bars.length - 1].close}` });
        } catch (e) {
          results.push({ type: 'tool_result', tool_use_id: u.id, content: `ERROR loading ${chart.symbol}: ${e.message}`, is_error: true });
        }
      } else {
        results.push({ type: 'tool_result', tool_use_id: u.id, content: `Unknown tool ${u.name}`, is_error: true });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  // Keep history bounded: drop oldest full exchanges if too long (must start with a plain user text message)
  while (JSON.stringify(messages).length > 400000 && messages.length > 2) {
    messages.shift();
    while (messages.length && !(messages[0].role === 'user' && typeof messages[0].content === 'string')) messages.shift();
  }
  sessions.set(sid, messages);
  if (lastGood) {
    const name = lastGood.res.title || 'Script';
    const file = saveScript(name, lastGood.code);
    emit({ type: 'script', name, code: lastGood.code, file, result: lastGood.res });
  }
}

// ── saved scripts: scripts/<YYYY-MM-DD-HH-MM-SS>_<name>.pine
function listScripts() {
  let files = [];
  try { files = fs.readdirSync(CFG.scriptsDir).filter(f => f.endsWith('.pine')); } catch { /* none */ }
  return files.map(f => {
    const m = /^(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})-(\d{2})_(.+)\.pine$/.exec(f);
    const st = fs.statSync(path.join(CFG.scriptsDir, f));
    return { file: f, name: m ? m[5].replace(/_/g, ' ') : f.replace(/\.pine$/, ''), time: m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}Z` : st.mtime.toISOString(), size: st.size };
  }).sort((a, b) => b.time.localeCompare(a.time));
}
// ── Pine completion metadata generated from the installed PineTS type declarations (what the runtime really implements)
let _pineMeta = null;
function pineMeta() {
  if (_pineMeta) return _pineMeta;
  const nsDir = path.join(__dirname, 'node_modules', 'pinets', 'dist', 'types', 'namespaces');
  const names = new Map();
  const add = (ns, list) => { const set = names.get(ns) || new Set(); for (const n of list) if (n && !/^_|^(param|constructor|any)$/.test(n)) set.add(n); names.set(ns, set); };
  const parseDts = file => {
    try {
      const src = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      const out = [];
      for (const line of src.split('\n')) {
        if (/^\s*(private|protected|static)\b/.test(line)) continue;
        const m = /^\s+(?:get\s+|readonly\s+)?([a-z_][a-z0-9_]*)\??\s*[(:]/.exec(line); if (m) out.push(m[1]);
      }
      return out;
    } catch { return []; }
  };
  try {
    for (const d of fs.readdirSync(nsDir)) {
      const full = path.join(nsDir, d);
      if (fs.statSync(full).isDirectory()) {
        if (fs.existsSync(path.join(full, 'methods'))) add(d, fs.readdirSync(path.join(full, 'methods')).map(f => f.replace(/\.d\.ts$/, '')));
        for (const f of fs.readdirSync(full)) if (/Helper\.d\.ts$|^PineColor\.d\.ts$/.test(f)) add(d, parseDts(path.join(full, f)));
      }
    }
    for (const [ns, f] of [['str', 'Str'], ['barstate', 'Barstate'], ['syminfo', 'Syminfo'], ['timeframe', 'Timeframe'], ['session', 'Session'], ['log', 'Log'], ['runtime', 'Runtime'], ['ticker', 'Ticker']])
      add(ns, parseDts(path.join(nsDir, f + '.d.ts')));
  } catch { /* leave partial */ }
  add('color', ['aqua', 'black', 'blue', 'fuchsia', 'gray', 'green', 'lime', 'maroon', 'navy', 'olive', 'orange', 'purple', 'red', 'silver', 'teal', 'white', 'yellow']);
  _pineMeta = { version: (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'node_modules', 'pinets', 'package.json'), 'utf8')).version; } catch { return '?'; } })(),
    namespaces: Object.fromEntries([...names].map(([k, v]) => [k, [...v].sort()])) };
  return _pineMeta;
}

function saveScript(name, code) {
  const safe = name.replace(/[^\w\-а-яА-ЯёЁ ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'script';
  const file = `${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)}_${safe}.pine`;
  fs.writeFileSync(path.join(CFG.scriptsDir, file), code, 'utf8');
  return file;
}

// ───────────────────────── HTTP ─────────────────────────
function sendJSON(res, code, obj) { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = ''; req.on('data', c => { s += c; if (s.length > 5e6) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
  });
}
// ───────────────────────── HEALTH / SETTINGS (connection status for regular users) ─────────────────────────
// Every check returns plain-language text + what to do; the UI (public/settings.js) only renders it.
const AG = { lastOk: 0, lastErr: '', lastErrAt: 0 };      // last real Panda turn
const HC = { ver: null, verAt: 0, net: null, netAt: 0, test: null };
const HOMEDIR = os.homedir();
const OS_USER = (() => { try { return os.userInfo().username; } catch { return ''; } })();
const reEsc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function maskPII(x) {
  let t = String(x);
  if (HOMEDIR) { t = t.split(HOMEDIR).join('~'); t = t.split(HOMEDIR.replace(/\\/g, '/')).join('~'); }
  if (OS_USER && OS_USER.length >= 3) t = t.replace(new RegExp(`([\\\\/])${reEsc(OS_USER)}(?=[\\\\/]|$)`, 'gi'), '$1<user>');
  return t
    .replace(/\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g, '<tg-token>')
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-<key>')
    .replace(/#(\d{2,})(\d{3})\b/g, (_m, _a, b) => `#…${b}`);
}
const ago = t => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? `${s} с назад` : s < 3600 ? `${Math.round(s / 60)} мин назад` : s < 86400 ? `${Math.round(s / 3600)} ч назад` : `${Math.round(s / 86400)} дн назад`; };
const IS_WIN = process.platform === 'win32', IS_MAC = process.platform === 'darwin';
const CLAUDE_INSTALL = IS_WIN
  ? [{ label: 'PowerShell', text: 'irm https://claude.ai/install.ps1 | iex' }]
  : [{ label: 'Терминал', text: 'curl -fsSL https://claude.ai/install.sh | bash' }];

// Windows: Claude Code runs Panda's `node ql.mjs …` through Git Bash. Without it Claude Code falls back to its PowerShell tool,
// whose allow rules are unreliable in headless mode → we find Git Bash (or our own PortableGit) and point Claude Code at it.
const GIT_DIR = path.join(HOME, 'tools', 'git');
function gitBashPath() {
  if (!IS_WIN) return '';
  if (process.env.CLAUDE_CODE_GIT_BASH_PATH && fs.existsSync(process.env.CLAUDE_CODE_GIT_BASH_PATH)) return process.env.CLAUDE_CODE_GIT_BASH_PATH;
  const pf = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramW6432].filter(Boolean);
  const c = [...pf.map(d => path.join(d, 'Git', 'bin', 'bash.exe')), path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe'), path.join(GIT_DIR, 'bin', 'bash.exe')];
  return c.find(f => { try { return fs.statSync(f).isFile(); } catch { return false; } }) || '';
}
function withGitBash(env) { const b = gitBashPath(); if (b && !env.CLAUDE_CODE_GIT_BASH_PATH) env.CLAUDE_CODE_GIT_BASH_PATH = b; return env; }

// Run the Claude Code CLI the same way the chat does (Windows: through cmd.exe because of the .cmd shim)
function runClaudeCli(args, { timeout = 30000, cwd } = {}) {
  return new Promise(resolve => {
    const env = withGitBash({ ...process.env }); delete env.ANTHROPIC_API_KEY;
    const cmd = IS_WIN ? (process.env.ComSpec || 'cmd.exe') : CFG.claudeBin;
    const cmdArgs = IS_WIN ? ['/d', '/s', '/c', `"${[quoteArg(CFG.claudeBin), ...args.map(quoteArg)].join(' ')}"`] : args;
    let out = '', err = '', done = false, child = null, timer = null;
    const fin = r => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    try { child = spawn(cmd, cmdArgs, { cwd: cwd || HOME, env, windowsHide: true, windowsVerbatimArguments: IS_WIN }); }
    catch (e) { return resolve({ code: -1, out: '', err: e.message }); }
    timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } fin({ code: -2, out, err: err + '\ntimeout', timeout: true }); }, timeout);
    child.stdout.on('data', c => { out += c; });
    child.stderr.on('data', c => { err += c; });
    child.on('error', e => fin({ code: -1, out, err: e.message }));
    child.on('close', code => fin({ code, out, err }));
    child.stdin.on('error', () => { /* closed early */ });
    child.stdin.end();
  });
}
const notFoundRe = /ENOENT|not recognized|не является внутренней|command not found|No such file|cannot find|9009/i;
// Turn any Claude Code error text into "what happened + what to do"
function classifyClaudeErr(text) {
  const t = String(text || '');
  if (notFoundRe.test(t) || /Не удалось запустить/.test(t)) return { code: 'missing', summary: 'Claude Code не найден', hint: 'Panda работает через программу Claude Code. Установите её и войдите в свой аккаунт Claude (нужна платная подписка Pro или Max).' };
  if (/log ?in|authenticat|credential|oauth|invalid api key|401|unauthori[sz]ed|not logged|token (has )?expired/i.test(t)) return { code: 'login', summary: 'Не выполнен вход в Claude', hint: 'Нажмите «Войти в Claude»: откроется окно Claude Code. Выберите вход через подписку Claude, подтвердите в браузере, закройте окно и нажмите «Проверить Panda».' };
  if (/rate.?limit|usage limit|limit reached|quota|429|overloaded|529/i.test(t)) return { code: 'limit', summary: 'Лимит подписки исчерпан или сервис перегружен', hint: 'Подождите, пока лимит обновится (обычно несколько часов), или переключите модель на haiku в чате.' };
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|EAI_AGAIN|fetch failed|network|socket|certificate|proxy|getaddrinfo/i.test(t)) return { code: 'network', summary: 'Нет связи с серверами Claude', hint: 'Проверьте интернет. Если сеть рабочая, мешает фаервол, прокси или провайдер: попробуйте другую сеть или VPN.' };
  if (/timeout|таймаут/i.test(t)) return { code: 'timeout', summary: 'Claude Code не ответил вовремя', hint: 'Повторите проверку. Если повторяется — перезапустите приложение и проверьте интернет.' };
  return { code: 'error', summary: 'Ошибка Claude Code', hint: 'Скопируйте диагностику и отправьте разработчику.' };
}
// Installed but not on PATH yet (fresh install, app started from Explorer/Finder) → look in the standard places
function claudeCandidates() {
  const h = HOMEDIR, c = [];
  if (IS_WIN) c.push(path.join(h, '.local', 'bin', 'claude.exe'), path.join(process.env.APPDATA || path.join(h, 'AppData', 'Roaming'), 'npm', 'claude.cmd'));
  else c.push(path.join(h, '.local', 'bin', 'claude'), path.join(h, '.claude', 'local', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude', path.join(h, '.npm-global', 'bin', 'claude'));
  return c.filter(f => { try { return fs.statSync(f).isFile(); } catch { return false; } });
}
async function claudeVersion(force) {
  if (!force && HC.ver && Date.now() - HC.verAt < (HC.ver.ok ? 300000 : 20000)) return HC.ver;
  let r = await runClaudeCli(['--version'], { timeout: 25000 });
  if (r.code !== 0) {
    for (const f of claudeCandidates()) {
      if (f === CFG.claudeBin) continue;
      const prev = CFG.claudeBin; CFG.claudeBin = f;
      const r2 = await runClaudeCli(['--version'], { timeout: 25000 });
      if (r2.code === 0) { console.log(`Claude Code found at ${f}`); r = r2; break; }
      CFG.claudeBin = prev;
    }
  }
  const txt = String(r.out || '').trim();
  HC.ver = r.code === 0 && /\d+\.\d+/.test(txt) ? { ok: true, version: txt.split(/\r?\n/)[0] } : { ok: false, raw: (r.err || txt || `exit ${r.code}`).trim().slice(0, 400) };
  HC.verAt = Date.now();
  return HC.ver;
}
// Deep check: one tiny real request through the subscription (proves install + login + network)
async function claudeTest() {
  const t0 = Date.now();
  const r = await runClaudeCli(['-p', 'Reply with the single word OK', '--output-format', 'json', '--model', 'haiku'], { timeout: 120000, cwd: path.join(HOME, 'agent', 'work') });
  let j = null; try { j = JSON.parse(String(r.out).trim().split(/\r?\n/).pop()); } catch { /* not json */ }
  const ok = !!j && j.is_error === false && r.code === 0;
  const raw = ok ? '' : String((j && (j.result || j.subtype)) || r.err || r.out || `exit ${r.code}`).trim().slice(0, 600);
  HC.test = { t: Date.now(), ok, ms: Date.now() - t0, raw, ...(ok ? {} : classifyClaudeErr(raw)) };
  if (ok) { AG.lastOk = Date.now(); HC.ver = null; } else console.log(`claude test failed: ${raw}`);
  return HC.test;
}
async function probe(url, ms = 7000) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
    try { await r.body?.cancel(); } catch { /* ignore */ }
    return { ok: true, status: r.status, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: e.cause?.code || (e.name === 'TimeoutError' ? 'timeout' : e.message), ms: Date.now() - t0 };
  }
}
async function netProbes(force) {
  if (!force && HC.net && Date.now() - HC.netAt < 30000) return HC.net;
  const [anthropic, bnMirror, bnMain, telegram] = await Promise.all([
    probe('https://api.anthropic.com/'),
    probe('https://data-api.binance.vision/api/v3/ping'),
    probe('https://api.binance.com/api/v3/ping'),
    tg().token ? probe('https://api.telegram.org/') : Promise.resolve(null),
  ]);
  HC.net = { anthropic, bnMirror, bnMain, telegram }; HC.netAt = Date.now();
  return HC.net;
}
function mt5Item() {
  const it = { id: 'mt5', title: 'MetaTrader 5', details: [], actions: [], cmds: [] };
  if (CFG.mock) return Object.assign(it, { state: 'off', summary: 'Отключён (тестовые данные MOCK)' });
  if (!IS_WIN) return Object.assign(it, { state: 'off', summary: 'Только для Windows', hint: `Терминал MT5 подключается только на Windows. На ${IS_MAC ? 'Mac' : 'этой системе'} графики идут с Binance (крипта) — всё остальное работает.` });
  if (!CFG.mt5Enabled) return Object.assign(it, { state: 'off', summary: 'Выключен в config.json (mt5Enabled: false)' });
  if (MT5.ready) {
    const i = MT5.info || {};
    it.details.push(['Брокер / сервер', [i.company, i.server].filter(Boolean).join(' · ') || '—']);
    if (i.login) it.details.push(['Счёт', '…' + String(i.login).slice(-3)]);
    it.details.push(['Символов', String(MT5.symbols.size)]);
    it.details.push(['Время сервера', `UTC${MT5.offset >= 0 ? '+' : ''}${MT5.offset / 3600}${MT5.offsetKnown ? '' : ' (не определено — рынок закрыт?)'}`]);
    it.actions.push('mt5.reconnect');
    return Object.assign(it, { state: 'ok', summary: 'Подключён' });
  }
  it.actions.push('mt5.reconnect');
  const e = String(MT5.error || '');
  if (MT5.starting) return Object.assign(it, { state: 'idle', summary: 'Подключаюсь…' });
  if (!e) return Object.assign(it, { state: 'idle', summary: 'Ещё не подключался', hint: 'Откройте терминал MetaTrader 5, войдите в счёт и нажмите «Переподключить».' });
  it.details.push(['Ошибка', maskPII(e).slice(0, 300)]);
  if (/import MetaTrader5 failed|No module named/i.test(e)) {
    it.actions.unshift('mt5.install');
    it.cmds = [{ label: 'Командная строка', text: 'py -3 -m pip install MetaTrader5' }];
    return Object.assign(it, { state: 'warn', summary: 'Не установлен модуль MetaTrader5 для Python', hint: 'Установите модуль командой ниже (или кнопкой «Установить модуль»), затем нажмите «Переподключить».' });
  }
  if (/python not found|ENOENT|was not found|Microsoft Store|9009|not recognized/i.test(e)) {
    it.actions.unshift('mt5.install');
    it.link = { label: 'Скачать Python вручную', url: 'https://www.python.org/downloads/windows/' };
    return Object.assign(it, { state: 'warn', summary: 'Не найден Python 3', hint: 'Нажмите «Установить модуль» — программа сама скачает Python 3.13 с python.org, установит его (без прав администратора) и подключит MT5. Без MT5 работают графики Binance.' });
  }
  if (/initialize failed|IPC|terminal|Authorization/i.test(e)) return Object.assign(it, { state: 'warn', summary: 'Терминал MT5 не отвечает', hint: 'Запустите MetaTrader 5 и войдите в торговый счёт (внизу справа должен быть пинг, а не «Нет соединения»). Затем нажмите «Переподключить». Если терминалов несколько — укажите путь к нужному в config.json (mt5Path).' });
  return Object.assign(it, { state: 'warn', summary: 'MT5 недоступен', hint: 'Проверьте, что терминал запущен и залогинен, затем нажмите «Переподключить».' });
}
async function health({ force = false } = {}) {
  const [cv, net] = await Promise.all([CFG.backend === 'api' ? null : claudeVersion(force), netProbes(force)]);
  const items = [];

  // Claude / Panda
  const cl = { id: 'claude', title: 'Claude Code (Panda)', details: [], actions: [], cmds: [] };
  if (CFG.backend === 'api') {
    Object.assign(cl, CFG.apiKey ? { state: 'ok', summary: 'Через API-ключ (оплата за токены)' } : { state: 'err', summary: 'API-ключ не задан', hint: 'Укажите anthropicApiKey в config.json или переключите backend на claude-code.' });
  } else if (!cv.ok) {
    const c = classifyClaudeErr(cv.raw);
    Object.assign(cl, { state: 'err', summary: c.code === 'missing' ? c.summary : 'Claude Code не запускается', hint: c.hint });
    cl.details.push(['Путь', maskPII(CFG.claudeBin)], ['Ответ', maskPII(cv.raw).slice(0, 300)]);
    cl.cmds = CLAUDE_INSTALL; cl.link = { label: 'Инструкция Claude Code', url: 'https://docs.claude.com/en/docs/claude-code/overview' };
    cl.actions.push('claude.install');
  } else {
    cl.details.push(['Версия', cv.version], ['Путь', maskPII(CFG.claudeBin)]);
    const test = HC.test, lastErrNewer = AG.lastErr && AG.lastErrAt > AG.lastOk;
    if (test && !test.ok && test.t >= AG.lastOk) Object.assign(cl, { state: 'err', summary: test.summary, hint: test.hint }), cl.details.push(['Ответ', maskPII(test.raw).slice(0, 300)]);
    else if (lastErrNewer) { const c = classifyClaudeErr(AG.lastErr); Object.assign(cl, { state: 'err', summary: c.summary, hint: c.hint }); cl.details.push(['Последняя ошибка', `${maskPII(AG.lastErr).slice(0, 300)} (${ago(AG.lastErrAt)})`]); }
    else if (AG.lastOk) Object.assign(cl, { state: 'ok', summary: `Работает · последний ответ ${ago(AG.lastOk)}` });
    else Object.assign(cl, { state: 'idle', summary: 'Установлен, вход не проверен', hint: 'Нажмите «Проверить Panda» — будет отправлен один короткий запрос через вашу подписку.' });
    if (test) cl.details.push(['Проверка', `${test.ok ? 'успешно' : 'ошибка'} · ${ago(test.t)}${test.ok ? ` · ${(test.ms / 1000).toFixed(1)} с` : ''}`]);
    cl.actions.push('claude.test', 'claude.login');
    if (IS_WIN) {
      const gb = gitBashPath();
      cl.details.push(['Оболочка', gb ? `Git Bash · ${maskPII(gb)}` : 'нет Git Bash (только PowerShell)']);
      if (!gb) {
        cl.actions.push('git.install');
        if (cl.state === 'ok' || cl.state === 'idle') Object.assign(cl, { state: 'warn', summary: cl.summary + ' · нет Git Bash', hint: 'Без Git Bash Panda может не суметь запустить код на графике. Нажмите «Установить Git Bash» — он поставится в папку программы, без прав администратора.' });
      }
    }
  }
  if (CFG.backend !== 'api' && !net.anthropic.ok && cl.state !== 'err') Object.assign(cl, { state: 'warn', summary: cl.summary + ' · нет связи с Anthropic', hint: 'Серверы Claude не отвечают: проверьте интернет, фаервол или VPN.' });
  items.push(cl);

  items.push(mt5Item());

  // Binance
  const bn = { id: 'binance', title: 'Binance (крипта)', details: [], actions: [], cmds: [] };
  const fmtP = p => p.ok ? `${p.status === 200 ? 'доступен' : 'HTTP ' + p.status} · ${p.ms} мс` : `нет связи (${p.error})`;
  bn.details.push(['data-api.binance.vision', fmtP(net.bnMirror)], ['api.binance.com', fmtP(net.bnMain)]);
  const okP = p => p.ok && p.status === 200;
  if (okP(net.bnMirror) || okP(net.bnMain)) Object.assign(bn, { state: 'ok', summary: `Доступен · ${Math.min(...[net.bnMirror, net.bnMain].filter(okP).map(p => p.ms))} мс` });
  else if ([net.bnMirror, net.bnMain].some(p => p.ok && (p.status === 451 || p.status === 403))) Object.assign(bn, { state: 'err', summary: 'Binance блокирует ваш регион', hint: 'Котировки крипты недоступны из вашей страны/сети. Нужен VPN или другая сеть.' });
  else Object.assign(bn, { state: 'err', summary: 'Нет связи с Binance', hint: 'Проверьте интернет. Если интернет есть — сайт может блокировать провайдер или фаервол; попробуйте VPN.' });
  items.push(bn);

  // Internet → Anthropic (shown separately: explains Panda problems)
  const nt = { id: 'net', title: 'Интернет', details: [], actions: [], cmds: [] };
  nt.details.push(['api.anthropic.com (Panda)', net.anthropic.ok ? `доступен · ${net.anthropic.ms} мс` : `нет связи (${net.anthropic.error})`]);
  if (net.telegram) nt.details.push(['api.telegram.org', net.telegram.ok ? `доступен · ${net.telegram.ms} мс` : `нет связи (${net.telegram.error})`]);
  const anyNet = net.anthropic.ok || net.bnMirror.ok || net.bnMain.ok;
  if (!anyNet) Object.assign(nt, { state: 'err', summary: 'Нет интернета', hint: 'Ни один сервис не отвечает. Проверьте подключение к сети.' });
  else if (!net.anthropic.ok) Object.assign(nt, { state: 'warn', summary: 'Серверы Claude недоступны', hint: 'Интернет есть, но api.anthropic.com не отвечает — Panda работать не будет. Возможно, мешает провайдер, фаервол или прокси: попробуйте другую сеть или VPN.' });
  else if (net.anthropic.status === 403) Object.assign(nt, { state: 'warn', summary: 'Anthropic ответил 403', hint: 'Доступ к Claude из вашей сети может быть ограничен. Если Panda не отвечает — попробуйте другую сеть или VPN.' });
  else if (net.telegram && !net.telegram.ok) Object.assign(nt, { state: 'warn', summary: 'Telegram недоступен', hint: 'Сигналы Watch в Telegram не дойдут: api.telegram.org не отвечает (часто блокируется провайдером).' });
  else Object.assign(nt, { state: 'ok', summary: 'В порядке' });
  items.push(nt);

  // Telegram + Watch
  const t = tg();
  const tgi = { id: 'telegram', title: 'Telegram (сигналы Watch)', details: [], actions: ['tg.setup'], cmds: [] };
  if (t.token && t.chatId) { Object.assign(tgi, { state: 'ok', summary: `Бот @${t.bot || '?'} → ${t.chatTitle || 'чат ' + t.chatId}` }); tgi.actions.push('tg.test'); }
  else if (t.token) Object.assign(tgi, { state: 'warn', summary: `Бот @${t.bot || '?'} подключён, чат не выбран`, hint: 'Напишите боту любое сообщение в Telegram и нажмите «Найти чат» в панели Watch.' });
  else Object.assign(tgi, { state: 'off', summary: 'Не настроен (необязательно)', hint: 'Нужен только чтобы получать сигналы Watch на телефон.' });
  const on = W.list.filter(w => w.enabled !== false).length;
  tgi.details.push(['Watch', W.list.length ? `${on} из ${W.list.length} активны` : 'нет наблюдений']);
  items.push(tgi);

  const rank = { err: 3, warn: 2, ok: 1, idle: 0, off: 0 };
  const worst = items.filter(i => i.id !== 'telegram').reduce((a, i) => rank[i.state] > rank[a] ? i.state : a, 'ok');
  return {
    t: Date.now(), overall: worst, items,
    app: { ui: uiVersion(), started: STARTED_AT, port: CFG.port, desktop: DESKTOP, platform: process.platform, arch: process.arch, node: process.versions.node, electron: process.versions.electron || null, backend: CFG.backend, mock: CFG.mock, home: maskPII(HOME) },
  };
}
function diagnosticsText(h, extra = '') {
  const tag = { ok: 'OK  ', warn: 'WARN', err: 'ERR ', idle: '··  ', off: 'off ' };
  const L = [`Pandich Lab — диагностика · ${new Date().toISOString()}`,
    `ui ${h.app.ui} · ${h.app.desktop ? 'desktop' : 'web'} · ${h.app.platform}/${h.app.arch} · node ${h.app.node}${h.app.electron ? ' · electron ' + h.app.electron : ''} · port ${h.app.port} · backend ${h.app.backend}${h.app.mock ? ' · MOCK' : ''}`,
    `started ${h.app.started} · home ${h.app.home}`, '', '── Статус ──'];
  for (const i of h.items) {
    L.push(`[${tag[i.state] || i.state}] ${i.title}: ${i.summary}`);
    for (const [k, v] of i.details || []) L.push(`        ${k}: ${v}`);
  }
  if (extra) L.push('', extra);
  L.push('', `── Лог сервера (последние ${Math.min(LOGBUF.length, 200)} строк) ──`, ...LOGBUF.slice(-200));
  return maskPII(L.join('\n'));
}
// Actions that start programs: only from our own page (blocks other websites poking 127.0.0.1)
function localOrigin(req) {
  const o = req.headers.origin; if (!o) return true;
  try { return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(o).hostname); } catch { return false; }
}
function openClaudeLogin() {
  const env = { ...process.env }; delete env.ANTHROPIC_API_KEY;
  if (IS_WIN) {
    const p = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'start', '"Claude Code login"', 'cmd', '/k', quoteArg(CFG.claudeBin)], { env, detached: true, stdio: 'ignore', windowsHide: false, windowsVerbatimArguments: true });
    p.unref(); return { ok: true };
  }
  if (IS_MAC) {
    const bin = CFG.claudeBin.replace(/'/g, `'\\''`).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const p = spawn('osascript', ['-e', `tell application "Terminal" to do script "unset ANTHROPIC_API_KEY; '${bin}'"`, '-e', 'tell application "Terminal" to activate'], { detached: true, stdio: 'ignore' });
    p.unref(); return { ok: true };
  }
  return { ok: false, error: 'Откройте терминал и выполните команду: claude' };
}
// One-click installers (same commands as the desktop setup wizard); output tail goes back to the UI
function runCmd(cmd, args, timeout = 600000) {
  return new Promise(resolve => {
    let out = '', p, timer;
    try { p = spawn(cmd, args, { windowsHide: true, env: process.env }); } catch (e) { return resolve({ code: -1, out: e.message }); }
    timer = setTimeout(() => { try { p.kill(); } catch { /* gone */ } }, timeout);
    p.stdout.on('data', c => { out += c; }); p.stderr.on('data', c => { out += c; });
    p.on('error', e => { clearTimeout(timer); resolve({ code: -1, out: out + e.message }); });
    p.on('close', code => { clearTimeout(timer); resolve({ code, out }); });
  });
}
async function installClaude() {
  const r = IS_WIN
    ? await runCmd('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://claude.ai/install.ps1 | iex'])
    : await runCmd('/bin/bash', ['-lc', 'curl -fsSL https://claude.ai/install.sh | bash']);
  console.log(`claude install: exit ${r.code}`);
  HC.ver = null; const v = await claudeVersion(true);
  return { ok: v.ok, out: maskPII(r.out).slice(-1500) };
}
async function download(url, file, minBytes) {
  const r = await fetch(url, { headers: { 'user-agent': 'pandich-lab' }, signal: AbortSignal.timeout(900000) });
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
  const out = fs.createWriteStream(file);
  for await (const chunk of r.body) if (!out.write(chunk)) await new Promise(res => out.once('drain', res));
  await new Promise((res, rej) => out.end(e => e ? rej(e) : res()));
  if (fs.statSync(file).size < minBytes) throw new Error('файл скачался не полностью');
}
// Git Bash for Claude Code: official PortableGit (git-for-windows releases), unpacked into our folder — no admin, no installer UI
async function installGit() {
  if (!IS_WIN) return { ok: true, out: 'не нужен на этой системе' };
  if (gitBashPath()) return { ok: true, out: `уже есть: ${maskPII(gitBashPath())}` };
  const tmp = path.join(os.tmpdir(), `PortableGit-${Date.now()}.7z.exe`);
  try {
    const rel = await (await fetch('https://api.github.com/repos/git-for-windows/git/releases/latest', { headers: { 'user-agent': 'pandich-lab', accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20000) })).json();
    const asset = (rel.assets || []).find(a => /^PortableGit-[\d.]+(-\d+)?-64-bit\.7z\.exe$/.test(a.name));
    if (!asset) throw new Error('PortableGit не найден в последнем релизе git-for-windows');
    console.log(`git: downloading ${asset.name}`);
    await download(asset.browser_download_url, tmp, 20e6);
    fs.mkdirSync(GIT_DIR, { recursive: true });
    const r = await runCmd(tmp, ['-y', `-o${GIT_DIR}`], 600000); // 7-Zip self-extractor: silent, into GIT_DIR
    if (!fs.existsSync(path.join(GIT_DIR, 'bin', 'bash.exe'))) throw new Error(`распаковка не удалась (код ${r.code})`);
    console.log('git: PortableGit ready');
    return { ok: true, out: `Git Bash установлен: ${maskPII(path.join(GIT_DIR, 'bin', 'bash.exe'))}` };
  } catch (e) { console.log(`git install failed: ${e.message}`); return { ok: false, out: e.message }; }
  finally { try { fs.unlinkSync(tmp); } catch { /* temp */ } }
}
// Python for MT5: official python.org installer, per-user, silent, adds itself to PATH. MetaTrader5 has cp313/cp314 win_amd64 wheels.
const PY_URL = 'https://www.python.org/ftp/python/3.13.16/python-3.13.16-amd64.exe';
async function installPython() {
  if (!IS_WIN) return { ok: false, out: 'Python для MT5 нужен только на Windows' };
  const tmp = path.join(os.tmpdir(), path.basename(PY_URL));
  try {
    console.log('python: downloading 3.13');
    await download(PY_URL, tmp, 10e6);
    const r = await runCmd(tmp, ['/quiet', 'InstallAllUsers=0', 'PrependPath=1', 'Include_launcher=1', 'InstallLauncherAllUsers=0', 'Include_test=0', 'Include_doc=0'], 600000);
    if (r.code !== 0) throw new Error(`установщик завершился с кодом ${r.code}${r.code === 1602 ? ' (отменено)' : ''}`);
    if (!winPythonDirs().length) throw new Error('Python установлен, но не найден');
    console.log(`python: installed ${winPythonDirs()[0]}`);
    return { ok: true, out: `Python установлен: ${maskPII(winPythonDirs()[0])}` };
  } catch (e) { console.log(`python install failed: ${e.message}`); return { ok: false, out: e.message }; }
  finally { try { fs.unlinkSync(tmp); } catch { /* temp */ } }
}
async function installMT5Module() {
  const tryPip = async () => {
    let last = { code: -1, out: 'Python 3 не найден' };
    for (const [bin, args] of pythonCandidates()) {
      last = await runCmd(bin, [...args, '-m', 'pip', 'install', '--upgrade', 'MetaTrader5'], 300000);
      if (last.code === 0) break;
    }
    return last;
  };
  let last = await tryPip();
  // no Python, or an old / 32-bit one without MetaTrader5 wheels → install Python 3.13 (per-user) and retry
  if (last.code !== 0 && IS_WIN && !CFG.pythonCmd && !winPythonDirs().some(d => /Python31[34]$/.test(d))) {
    const py = await installPython();
    if (!py.ok) return { ok: false, out: `Python: ${py.out}\n${maskPII(last.out).slice(-800)}` };
    last = await tryPip();
  }
  console.log(`MetaTrader5 module install: exit ${last.code}`);
  const ok = last.code === 0;
  if (ok) await mt5Reconnect();
  return { ok, out: maskPII(last.out).slice(-1500) };
}
async function mt5Reconnect() {
  if (MT5.starting) { try { await MT5.starting; } catch { /* ignore */ } }
  try { if (MT5.proc) MT5.proc.kill(); } catch { /* gone */ }
  MT5.proc = null; MT5.ready = false; MT5.error = null; MT5.lastStartTry = 0;
  await new Promise(r => setTimeout(r, 300));
  MT5.lastStartTry = 0;
  return startMT5();
}

const STATIC = {
  '/': ['public/index.html', 'text/html; charset=utf-8'],
  '/app.js': ['public/app.js', 'text/javascript; charset=utf-8'],
  '/drawings.js': ['public/drawings.js', 'text/javascript; charset=utf-8'],
  '/panels.js': ['public/panels.js', 'text/javascript; charset=utf-8'],
  '/chartui.js': ['public/chartui.js', 'text/javascript; charset=utf-8'],
  '/multichart.js': ['public/multichart.js', 'text/javascript; charset=utf-8'],
  '/replay.js': ['public/replay.js', 'text/javascript; charset=utf-8'],
  '/watch.js': ['public/watch.js', 'text/javascript; charset=utf-8'],
  '/library.js': ['public/library.js', 'text/javascript; charset=utf-8'],
  '/settings.js': ['public/settings.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['public/style.css', 'text/css; charset=utf-8'],
  '/vendor/lwc.js': ['node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js', 'text/javascript; charset=utf-8'],
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname.startsWith('/vendor/monaco/')) {
      const root = path.join(__dirname, 'node_modules', 'monaco-editor', 'min');
      const full = path.normalize(path.join(root, decodeURIComponent(url.pathname.slice('/vendor/monaco/'.length))));
      if (!full.startsWith(root) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) return sendJSON(res, 404, { error: 'not found' });
      const ext = path.extname(full).toLowerCase();
      const type = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.ttf': 'font/ttf', '.json': 'application/json', '.svg': 'image/svg+xml' }[ext] || 'application/octet-stream';
      res.writeHead(200, { 'content-type': type, 'cache-control': 'max-age=86400' });
      return fs.createReadStream(full).pipe(res);
    }
    if (req.method === 'GET' && STATIC[url.pathname]) {
      const [f, type] = STATIC[url.pathname];
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
      return fs.createReadStream(path.join(__dirname, f)).pipe(res);
    }
    if (req.method === 'GET' && url.pathname === '/api/config') {
      return sendJSON(res, 200, { backend: CFG.backend, models: CFG.models, defaultModel: CFG.defaultModel, hasKey: !!CFG.apiKey, mock: CFG.mock, intervals: TF_PRESETS, mt5: { ready: MT5.ready, error: MT5.error, server: MT5.info?.server || null } });
    }
    if (req.method === 'GET' && url.pathname === '/api/health') return sendJSON(res, 200, await health({ force: url.searchParams.get('force') === '1' }));
    if (req.method === 'GET' && url.pathname === '/api/diagnostics') {
      const h = await health({ force: true });
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
      return res.end(diagnosticsText(h));
    }
    if (req.method === 'POST' && /^\/api\/(health\/claude-test|claude\/login|claude\/install|mt5\/reconnect|mt5\/install|git\/install|python\/install)$/.test(url.pathname)) {
      if (!localOrigin(req)) return sendJSON(res, 403, { error: 'forbidden origin' });
      await readBody(req).catch(() => ({}));
      if (url.pathname === '/api/health/claude-test') { await claudeVersion(true); return sendJSON(res, 200, { test: await claudeTest(), health: await health() }); }
      if (url.pathname === '/api/claude/login') return sendJSON(res, 200, openClaudeLogin());
      if (url.pathname === '/api/claude/install') return sendJSON(res, 200, { ...(await installClaude()), health: await health({ force: true }) });
      if (url.pathname === '/api/mt5/install') return sendJSON(res, 200, { ...(await installMT5Module()), health: await health() });
      if (url.pathname === '/api/git/install') return sendJSON(res, 200, { ...(await installGit()), health: await health() });
      if (url.pathname === '/api/python/install') return sendJSON(res, 200, { ...(await installPython()), health: await health() });
      await mt5Reconnect(); return sendJSON(res, 200, { health: await health() });
    }
    if (req.method === 'GET' && url.pathname === '/api/klines') {
      const symbol = (url.searchParams.get('symbol') || 'BTCUSDT').toUpperCase();
      const interval = url.searchParams.get('interval') || '15m';
      const bars = await getBars(symbol, interval, url.searchParams.get('limit'));
      const src = sourceFor(symbol);
      return sendJSON(res, 200, { symbol, interval: normTf(interval), src, srcLabel: src === 'mt5' ? `MT5 · ${MT5.info?.server || ''}` : src === 'mock' ? 'MOCK' : 'Binance', bars: bars.map(toClientBar) });
    }
    if (req.method === 'GET' && url.pathname === '/api/stream') {
      const symbol = (url.searchParams.get('symbol') || 'BTCUSDT').toUpperCase();
      const interval = normTf(url.searchParams.get('interval')) || '15m';
      // one SSE connection can carry several series: ?subs=SYM|tf,SYM|tf (multi-chart; browsers allow only 6 connections per host)
      const subs = new Set();
      const raw = url.searchParams.get('subs');
      if (raw) for (const it of raw.split(',').slice(0, 16)) { const [sy, tf] = it.split('|'); const n = normTf(tf); if (sy && n) subs.add(`${sy.trim().toUpperCase()}|${n}`); }
      else subs.add(`${symbol}|${interval}`);
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(': connected\n\n');
      const sink = sseSink(res);
      const offs = [...subs].map(k => { const [sy, tf] = k.split('|'); return subscribe(sy, tf, sink); });
      const ping = setInterval(() => res.write(': ping\n\n'), 15000);
      res.on('close', () => { clearInterval(ping); offs.forEach(f => f()); });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/quote') {
      const symbol = (url.searchParams.get('symbol') || '').toUpperCase();
      try {
        const d = await getBars(symbol, '1d', 50);
        const t = d[d.length - 1], y = d[d.length - 2];
        const m = MT5.symbols.get(symbol);
        return sendJSON(res, 200, { ok: true, symbol: m ? m.name : symbol, desc: m ? m.desc : '', path: m ? m.path : '', src: sourceFor(symbol),
          last: t.close, open: t.open, high: t.high, low: t.low, prevClose: y ? y.close : null,
          change: y ? t.close - y.close : null, changePct: y && y.close ? (t.close - y.close) / y.close * 100 : null, digits: digitsFor(symbol, t.close) });
      } catch (e) { return sendJSON(res, 200, { ok: false, error: e.message }); }
    }
    if (req.method === 'GET' && url.pathname === '/api/symbols') {
      if (!MT5.ready) await startMT5();
      return sendJSON(res, 200, {
        mt5: { ready: MT5.ready, error: MT5.error, server: MT5.info?.server || null, offsetHours: MT5.offset / 3600, offsetKnown: MT5.offsetKnown,
          symbols: [...MT5.symbols.values()].map(s => ({ name: s.name, desc: s.desc, path: s.path || '' })) },
        crypto: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'PAXGUSDT'],
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/run') {
      const b = await readBody(req);
      try {
        const r = await runPine({ code: String(b.code || ''), symbol: String(b.symbol || 'BTCUSDT').toUpperCase(), interval: b.interval || '15m', limit: b.limit, inputs: b.inputs, until: b.until });
        return sendJSON(res, 200, { ok: true, result: r });
      } catch (e) { return sendJSON(res, 200, { ok: false, error: e && e.message ? e.message : String(e), logs: e && e.logs || [] }); }
    }


    // ───── library / templates / layouts ─────
    if (req.method === 'GET' && url.pathname === '/api/library') return sendJSON(res, 200, listLibrary());
    if (req.method === 'GET' && url.pathname === '/api/library/file') {
      const f = path.basename(String(url.searchParams.get('f') || '')); const full = path.join(CFG.libraryDir, f);
      if (!/\.pine$/.test(f) || !fs.existsSync(full)) return sendJSON(res, 404, { error: 'not found' });
      return sendJSON(res, 200, { file: f, code: fs.readFileSync(full, 'utf8').replace(/^(\/\/\s*@(name|category|desc|tags)\b.*\n)+/, '') });
    }
    if (req.method === 'POST' && url.pathname === '/api/scripts/delete') {
      const b = await readBody(req); const f = path.basename(String(b.file || '')); const full = path.join(CFG.scriptsDir, f);
      if (!/\.pine$/.test(f) || !fs.existsSync(full)) return sendJSON(res, 200, { ok: false, error: 'нет такого файла' });
      const bin = path.join(CFG.scriptsDir, '_deleted'); fs.mkdirSync(bin, { recursive: true }); fs.renameSync(full, path.join(bin, f)); // recoverable
      return sendJSON(res, 200, { ok: true });
    }
    {
      const m = /^\/api\/(templates|layouts)(\/save|\/delete)?$/.exec(url.pathname);
      if (m) {
        const kind = m[1];
        if (req.method === 'GET' && !m[2]) return sendJSON(res, 200, collList(kind).map(({ data, ...x }) => ({ ...x, data: kind === 'templates' ? data : { summary: data && data.summary } })));
        if (req.method === 'POST' && m[2] === '/save') { const b = await readBody(req); try { return sendJSON(res, 200, { ok: true, item: collSave(kind, b) }); } catch (e) { return sendJSON(res, 200, { ok: false, error: e.message }); } }
        if (req.method === 'POST' && m[2] === '/delete') { const b = await readBody(req); return sendJSON(res, 200, { ok: collDelete(kind, b.id) }); }
      }
      const g = /^\/api\/layouts\/get$/.exec(url.pathname);
      if (g && req.method === 'GET') { const it = collList('layouts').find(x => x.id === url.searchParams.get('id')); return it ? sendJSON(res, 200, it) : sendJSON(res, 404, { error: 'not found' }); }
    }
    // ───── Watch mode + Telegram ─────
    if (req.method === 'GET' && url.pathname === '/api/watch') {
      const t = tg();
      return sendJSON(res, 200, { watches: W.list.map(watchPublic), events: W.events.slice(-60).reverse(),
        telegram: { token: t.token ? t.token.slice(0, 6) + '…' + t.token.slice(-4) : '', bot: t.bot || '', chatId: t.chatId || null, chatTitle: t.chatTitle || '' } });
    }
    if (req.method === 'GET' && url.pathname === '/api/watch/events') {
      const since = Number(url.searchParams.get('since') || 0);
      return sendJSON(res, 200, { events: W.events.filter(e => e.t > since && !e.test), now: Date.now() });
    }
    if (req.method === 'POST' && url.pathname === '/api/watch/save') {
      const b = await readBody(req);
      const code = String(b.code || ''); if (!code.trim()) return sendJSON(res, 200, { ok: false, error: 'нет кода скрипта' });
      const symbol = String(b.symbol || '').toUpperCase().trim(), interval = normTf(b.interval);
      if (!symbol || !interval) return sendJSON(res, 200, { ok: false, error: 'нужны символ и таймфрейм' });
      const old = b.id ? W.list.find(x => x.id === b.id) : null;
      const w = { id: old ? old.id : 'w' + Date.now().toString(36), name: String(b.name || 'Сигнал').slice(0, 80), symbol, interval, code, inputs: b.inputs && typeof b.inputs === 'object' ? b.inputs : {},
        onAlerts: b.onAlerts !== false, onMarkers: !!b.onMarkers, onStrategy: !!b.onStrategy, telegram: b.telegram !== false, enabled: b.enabled !== false,
        created: old ? old.created : Date.now(), lastBar: 0, fired: old ? old.fired || 0 : 0, lastFire: old ? old.lastFire || null : null, error: null };
      // validate once on current data: the script must run and we report what it would see on the last closed bar
      try {
        const r = await evalWatch(w, { force: true });
        w.lastBar = r.closedT; w.lastCheck = Date.now(); // start from the current bar: no alerts for history
        if (old) Object.assign(old, w); else W.list.push(w);
        saveWatches();
        return sendJSON(res, 200, { ok: true, watch: watchPublic(w), probe: { title: r.title, barTime: r.closedT, hits: r.hits } });
      } catch (e) { return sendJSON(res, 200, { ok: false, error: e.message }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/watch/delete') {
      const b = await readBody(req); const n = W.list.length; W.list = W.list.filter(x => x.id !== b.id); saveWatches();
      return sendJSON(res, 200, { ok: W.list.length < n });
    }
    if (req.method === 'POST' && url.pathname === '/api/watch/toggle') {
      const b = await readBody(req); const w = W.list.find(x => x.id === b.id); if (!w) return sendJSON(res, 200, { ok: false, error: 'нет такого сигнала' });
      w.enabled = !!b.enabled; if (w.enabled) { w.lastBar = 0; w.nextTry = 0; w.error = null; } saveWatches(); // re-enable = silent re-sync on the next bar
      return sendJSON(res, 200, { ok: true, watch: watchPublic(w) });
    }
    if (req.method === 'POST' && url.pathname === '/api/watch/test') {
      const b = await readBody(req); const w = W.list.find(x => x.id === b.id); if (!w) return sendJSON(res, 200, { ok: false, error: 'нет такого сигнала' });
      try { const r = await evalWatch(w, { force: true }); const ev = await fireWatch(w, r, true); return sendJSON(res, 200, { ok: true, event: ev }); }
      catch (e) { return sendJSON(res, 200, { ok: false, error: e.message }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/settings/telegram') {
      const b = await readBody(req);
      if (b.clear) { delete W.settings.telegram; saveSettings(); return sendJSON(res, 200, { ok: true }); }
      const token = String(b.token || tg().token || '').trim();
      if (!/^\d+:[\w-]{20,}$/.test(token)) return sendJSON(res, 200, { ok: false, error: 'токен должен выглядеть как 123456789:AA… (из @BotFather)' });
      try {
        const me = await tgCall('getMe', {}, token);
        const t = { ...tg(), token, bot: me.username };
        if (b.chatId) { t.chatId = b.chatId; t.chatTitle = String(b.chatId); }
        else if (b.findChat || !t.chatId) { const c = await tgFindChat(token); if (c) { t.chatId = c.id; t.chatTitle = c.title; } }
        W.settings.telegram = t; saveSettings();
        return sendJSON(res, 200, { ok: true, bot: me.username, chatId: t.chatId || null, chatTitle: t.chatTitle || '' });
      } catch (e) { return sendJSON(res, 200, { ok: false, error: e.message }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/telegram/test') {
      try { await tgSend('✅ <b>Pandich Lab</b> подключён. Сюда будут приходить сигналы Watch.'); return sendJSON(res, 200, { ok: true }); }
      catch (e) { return sendJSON(res, 200, { ok: false, error: e.message }); }
    }
    if (req.method === 'GET' && url.pathname === '/api/pine/meta') return sendJSON(res, 200, pineMeta());
    if (req.method === 'GET' && url.pathname === '/api/scripts') return sendJSON(res, 200, listScripts());
    if (req.method === 'GET' && url.pathname === '/api/scripts/file') {
      const f = path.basename(String(url.searchParams.get('f') || ''));
      const full = path.join(CFG.scriptsDir, f);
      if (!/\.pine$/.test(f) || !fs.existsSync(full)) return sendJSON(res, 404, { error: 'not found' });
      return sendJSON(res, 200, { file: f, code: fs.readFileSync(full, 'utf8') });
    }
    if (req.method === 'POST' && url.pathname === '/api/scripts/save') {
      const b = await readBody(req);
      const code = String(b.code || ''); if (!code.trim()) return sendJSON(res, 200, { ok: false, error: 'empty code' });
      if (code.length > 200000) return sendJSON(res, 200, { ok: false, error: 'script is larger than 200 000 characters' });
      return sendJSON(res, 200, { ok: true, file: saveScript(String(b.name || 'script'), code) });
    }
    if (req.method === 'POST' && url.pathname === '/api/chat') {
      const b = await readBody(req);
      res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-cache' });
      const emit = ev => res.write(JSON.stringify(ev) + '\n');
      try { await agentTurn(b, emit); AG.lastOk = Date.now(); emit({ type: 'done' }); }
      catch (e) { const m = e && e.message ? e.message : String(e); AG.lastErr = m; AG.lastErrAt = Date.now(); emit({ type: 'error', text: m, diag: true }); }
      return res.end();
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/restart') {
      sendJSON(res, 200, { ok: true }); scheduleRestart('requested via /api/admin/restart'); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/version') return sendJSON(res, 200, { ui: uiVersion(), started: STARTED_AT });
    if (req.method === 'POST' && url.pathname === '/api/admin/shutdown') {
      // used by start.bat to replace a running instance (server listens on 127.0.0.1 only)
      sendJSON(res, 200, { ok: true });
      console.log('Shutdown requested (new instance starting)');
      setTimeout(() => { try { if (MT5.proc) MT5.proc.kill(); } catch { /* gone */ } process.exit(0); }, 150);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/reset') {
      const b = await readBody(req); const sid = String(b.sessionId || 'default');
      sessions.delete(sid); live.delete(sid); return sendJSON(res, 200, { ok: true });
    }
    // Called by agent/ql.mjs from inside the Claude Code session
    if (req.method === 'POST' && url.pathname === '/api/agent/run') {
      const b = await readBody(req);
      const st = liveFor(b.sid);
      if (!st || !st.chart) return sendJSON(res, 200, { ok: false, error: 'no active chat session' });
      const code = String(b.code || '');
      try {
        const r = await runPine({ code, ...st.chart });
        const summary = summarizeForAgent(r);
        st.lastGood = { code, res: r };
        if (st.emit) { st.emit({ type: 'run', ok: true, code, summary }); st.emit({ type: 'preview', name: r.title, code, result: r }); }
        return sendJSON(res, 200, { ok: true, summary });
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        if (st.emit) st.emit({ type: 'run', ok: false, code, summary: `ERROR: ${msg}` });
        return sendJSON(res, 200, { ok: false, error: msg });
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/agent/context') {
      const b = await readBody(req); const st = liveFor(b.sid);
      if (!st || !st.chart) return sendJSON(res, 200, { ok: false, error: 'no active chat session' });
      try { if (st.emit) st.emit({ type: 'status', text: 'Смотрю на график…' }); return sendJSON(res, 200, { ok: true, summary: await chartContext(st) }); }
      catch (e) { return sendJSON(res, 200, { ok: false, error: e.message }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/agent/bars') {
      const b = await readBody(req); const st = liveFor(b.sid);
      if (!st || !st.chart) return sendJSON(res, 200, { ok: false, error: 'no active chat session' });
      const interval = normTf(b.interval) || st.chart.interval;
      const symbol = String(b.symbol || st.chart.symbol).toUpperCase();
      const n = Math.max(10, Math.min(500, Number(b.n) || 150));
      try {
        if (st.emit) st.emit({ type: 'status', text: `Смотрю ${symbol} ${interval}…` });
        const bars = await getBars(symbol, interval, Math.max(n, 50));
        const sl = bars.slice(-n), d = digitsFor(symbol, sl[sl.length - 1].close);
        return sendJSON(res, 200, { ok: true, summary: `${symbol} ${interval}, ATR(14) ${(atr(bars) || 0).toFixed(d)}\n${barsCSV(sl, d)}` });
      } catch (e) { return sendJSON(res, 200, { ok: false, error: e.message }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/agent/draw') {
      const b = await readBody(req); const st = liveFor(b.sid);
      if (!st || !st.chart) return sendJSON(res, 200, { ok: false, error: 'no active chat session' });
      try {
        const specs = Array.isArray(b.items) ? b.items : [b.items];
        const items = []; for (const sp of specs.slice(0, 50)) items.push(await buildDrawing(st, sp));
        if (st.emit) st.emit({ type: 'draw', items });
        return sendJSON(res, 200, { ok: true, summary: `Drew ${items.length} object(s): ${items.map(i => i.type).join(', ')}` });
      } catch (e) { return sendJSON(res, 200, { ok: false, error: e.message }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/agent/draw-clear') {
      const b = await readBody(req); const st = liveFor(b.sid);
      if (st && st.emit) st.emit({ type: 'draw-clear' });
      return sendJSON(res, 200, { ok: true, summary: 'Removed drawings previously made by Panda' });
    }
    if (req.method === 'POST' && url.pathname === '/api/agent/chart') {
      const b = await readBody(req);
      const st = liveFor(b.sid);
      if (!st || !st.chart) return sendJSON(res, 200, { ok: false, error: 'no active chat session' });
      const symbol = String(b.symbol || st.chart.symbol).toUpperCase();
      const interval = normTf(b.interval) || st.chart.interval;
      try {
        const bars = await getBars(symbol, interval, st.chart.limit);
        st.chart.symbol = symbol; st.chart.interval = interval;
        if (st.emit) st.emit({ type: 'chart', symbol, interval });
        return sendJSON(res, 200, { ok: true, summary: `Chart is now ${symbol} ${interval}, ${bars.length} bars, last close ${bars[bars.length - 1].close}` });
      } catch (e) { return sendJSON(res, 200, { ok: false, error: `cannot load ${symbol} ${interval}: ${e.message}` }); }
    }
    sendJSON(res, 404, { error: 'not found' });
  } catch (e) {
    if (!res.headersSent) sendJSON(res, 500, { error: e && e.message ? e.message : String(e) }); else res.end();
  }
});

// ── self-update: run_server.bat restarts node on any non-zero exit code.
// When server.mjs / mt5bridge.py change on disk, check syntax and restart with exit code 99.
const STARTED_AT = new Date().toISOString();
function uiVersion() {
  let v = 0;
  for (const f of ['index.html', 'app.js', 'style.css', 'drawings.js', 'panels.js']) { try { v = Math.max(v, fs.statSync(path.join(__dirname, 'public', f)).mtimeMs); } catch { /* missing */ } }
  return String(Math.round(v));
}
let restarting = false;
function scheduleRestart(reason) {
  if (restarting) return; restarting = true;
  console.log(`Restart: ${reason}`);
  setTimeout(() => { try { if (MT5.proc) MT5.proc.kill(); } catch { /* gone */ } process.exit(99); }, 300);
}
let watchTimer = null;
for (const f of DESKTOP ? [] : ['server.mjs', 'mt5bridge.py']) { // the desktop app updates itself and supervises the server
  try {
    fs.watch(path.join(__dirname, f), () => {
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => {
        if (f === 'server.mjs') {
          const chk = spawn(process.execPath, ['--check', path.join(__dirname, 'server.mjs')], { windowsHide: true });
          let err = ''; chk.stderr.on('data', c => { err += c; });
          chk.on('close', code => code === 0 ? scheduleRestart('server.mjs changed') : console.error(`server.mjs changed but has a syntax error — staying on the running version:\n${err.slice(0, 600)}`));
        } else scheduleRestart(`${f} changed`);
      }, 1500);
    });
  } catch { /* watch unsupported */ }
}

// If the port is taken by an older Pandich Lab instance, ask it to exit and retry (start.bat does the same via curl)
let listenTries = 0;
server.on('error', async e => {
  if (e.code !== 'EADDRINUSE') { console.error(e); process.exit(1); }
  if (++listenTries > 4) {
    console.error(`\n[!] Порт ${CFG.port} занят другим процессом. Закрой старое окно «Quant Lab server»/«Pandich Lab server» (или процесс node в Диспетчере задач) и запусти start.bat снова.`);
    process.exit(1);
  }
  console.log(`Порт ${CFG.port} занят — прошу предыдущий экземпляр завершиться (попытка ${listenTries})…`);
  try { await fetch(`http://127.0.0.1:${CFG.port}/api/admin/shutdown`, { method: 'POST', signal: AbortSignal.timeout(2000) }); } catch { /* old instance may not support it */ }
  setTimeout(() => server.listen(CFG.port, '127.0.0.1'), 1500);
});
server.listen(CFG.port, '127.0.0.1', () => {
  console.log(`Pandich Lab → http://localhost:${CFG.port}  (AI: ${CFG.backend === 'api' ? 'Anthropic API key' : 'Claude Code / подписка'}, model: ${CFG.defaultModel}, data: ${CFG.mock ? 'MOCK' : 'Binance + MT5'})`);
  startMT5();
});
