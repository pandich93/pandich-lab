// Pandich Lab agent CLI — called by Claude Code (via Bash) to work with the user's live chart.
// Usage:
//   node ql.mjs run <file.pine>               compile+run on the current chart, print summary (applied to chart if OK)
//   node ql.mjs chart <SYMBOL> [interval]     switch chart symbol/timeframe
//   node ql.mjs context                       what is on the chart: symbol, TF, stats, swings, indicators, drawings, last 120 bars
//   node ql.mjs bars <interval> [n] [SYMBOL]  OHLCV CSV of another timeframe/symbol (n ≤ 500)
//   node ql.mjs draw '<json>' | --file f.json draw object(s) on the chart (JSON object or array)
//   node ql.mjs draw-clear                    remove drawings previously made by Panda
// Env (set by server when it spawns claude): QL_PORT, QL_SID
import fs from 'node:fs';
import path from 'node:path';

const PORT = process.env.QL_PORT || '3777';
const SID = process.env.QL_SID || '';
const base = `http://127.0.0.1:${PORT}`;

async function post(p, body) {
  const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sid: SID, ...body }) });
  return r.json();
}
const out = r => { console.log(r.ok ? r.summary : `ERROR: ${r.error}`); process.exit(r.ok ? 0 : 1); };

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === 'run' && rest[0]) {
    out(await post('/api/agent/run', { code: fs.readFileSync(path.resolve(rest[0]), 'utf8') }));
  } else if (cmd === 'chart' && rest[0]) {
    out(await post('/api/agent/chart', { symbol: rest[0], interval: rest[1] }));
  } else if (cmd === 'context') {
    out(await post('/api/agent/context', {}));
  } else if (cmd === 'bars' && rest[0]) {
    out(await post('/api/agent/bars', { interval: rest[0], n: rest[1], symbol: rest[2] }));
  } else if (cmd === 'draw' && rest[0]) {
    const raw = rest[0] === '--file' ? fs.readFileSync(path.resolve(rest[1]), 'utf8') : rest.join(' ');
    let items; try { items = JSON.parse(raw); } catch (e) { console.log(`ERROR: invalid JSON: ${e.message}`); process.exit(1); }
    out(await post('/api/agent/draw', { items }));
  } else if (cmd === 'draw-clear') {
    out(await post('/api/agent/draw-clear', {}));
  } else {
    console.log('Usage: node ql.mjs run <file.pine> | chart <SYMBOL> [tf] | context | bars <tf> [n] [SYMBOL] | draw \'<json>\' | draw --file f.json | draw-clear');
    process.exit(2);
  }
} catch (e) {
  console.log(`ERROR: Pandich Lab server not reachable on ${base} (${e.message})`);
  process.exit(1);
}
