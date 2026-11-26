#!/usr/bin/env bash
# Pandich Lab — start on macOS / Linux (MT5 quotes are Windows-only; crypto via Binance works everywhere)
set -e
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "[!] Node.js 18+ is required: https://nodejs.org"; exit 1; }
command -v claude >/dev/null || echo "[i] Claude Code CLI not found — the chart works, the AI chat needs it: npm install -g @anthropic-ai/claude-code && claude"
[ -d node_modules/pinets ] && [ -f node_modules/monaco-editor/min/vs/loader.js ] || npm install --no-fund --no-audit
curl -s -m 3 -X POST http://127.0.0.1:3777/api/admin/shutdown >/dev/null 2>&1 || true
sleep 1
( command -v xdg-open >/dev/null && sleep 2 && xdg-open http://localhost:3777 >/dev/null 2>&1 & ) || true
( command -v open >/dev/null && sleep 2 && open http://localhost:3777 & ) 2>/dev/null || true
# restart on crash / self-update (exit 99); exit 0 = stopped
while true; do
  node server.mjs && break
  echo "[Pandich Lab] server exited ($?) — restarting in 3 s…"; sleep 3
done
