#!/usr/bin/env bash
# Pandich Lab — build the macOS .dmg locally (universal: Apple Silicon + Intel). Run on a Mac with Node.js 18+.
set -e
cd "$(dirname "$0")"
for f in server.mjs package.json public/index.html library agent/ql.mjs; do
  [ -e "../$f" ] || { echo "[!] Not found: ../$f — the desktop folder must be inside the Pandich Lab folder, next to server.mjs"; exit 1; }
done
(cd .. && npm install --omit=dev --no-fund --no-audit)
[ -f ../node_modules/pinets/package.json ] || { echo '[!] server dependencies missing (pinets)'; exit 1; }
npm install --no-fund --no-audit
npx electron-builder --mac --publish never
open dist
