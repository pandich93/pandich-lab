@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [!] Node.js not found. Install Node 18+ from https://nodejs.org
  pause
  exit /b 1
)
where claude >nul 2>nul
if errorlevel 1 (
  echo [!] Claude Code CLI not found in PATH.
  echo     Install:  npm install -g @anthropic-ai/claude-code
  echo     Then run "claude" once and log in with your Claude subscription.
  echo     The chart will still work; only the AI chat needs Claude Code.
  pause
)
set "NEED_NPM="
if not exist "node_modules\pinets" set "NEED_NPM=1"
if not exist "node_modules\monaco-editor\min\vs\loader.js" set "NEED_NPM=1"
if defined NEED_NPM (
  echo Installing dependencies...
  call npm install --no-fund --no-audit
  if errorlevel 1 (
    echo [!] npm install failed
    pause
    exit /b 1
  )
)
rem ---- MT5 quotes: official MetaTrader5 Python package (read-only) ----
set "QL_PYTHON="
where py >nul 2>nul && set "QL_PYTHON=py -3"
if not defined QL_PYTHON ( where python >nul 2>nul && set "QL_PYTHON=python" )
if defined QL_PYTHON (
  %QL_PYTHON% -c "import MetaTrader5" >nul 2>nul
  if errorlevel 1 (
    echo Installing MetaTrader5 Python package...
    %QL_PYTHON% -m pip install --user --disable-pip-version-check MetaTrader5
    if errorlevel 1 (
      echo [!] pip install MetaTrader5 failed - MT5 quotes disabled, crypto still works.
      pause
    )
  )
) else (
  echo [i] Python not found - MT5 quotes disabled. Install Python 3 64-bit from python.org to enable.
  ping -n 4 127.0.0.1 >nul
)
rem Stop a previously started instance (if any) so the new code is loaded
curl -s -m 3 -X POST http://127.0.0.1:3777/api/admin/shutdown >nul 2>nul
ping -n 2 127.0.0.1 >nul
rem Server runs in its own minimized window; close that window to stop the server.
start "Pandich Lab server" /min cmd /c run_server.bat
ping -n 3 127.0.0.1 >nul
start "" http://localhost:3777
exit /b 0
