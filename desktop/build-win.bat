@echo off
rem Pandich Lab — build the Windows installer locally (test build, no auto-update). Needs Node.js 18+.
cd /d "%~dp0"
where node >nul 2>nul || (echo [!] Node.js 18+ is required: https://nodejs.org & pause & exit /b 1)
rem the desktop folder must sit inside the Pandich Lab folder (next to server.mjs, public, library)
for %%F in (server.mjs package.json public\index.html library agent\ql.mjs) do if not exist "..\%%F" (
  echo [!] Not found: ..\%%F
  echo     The "desktop" folder must be inside the Pandich Lab folder, next to server.mjs.
  pause & exit /b 1
)
echo [1/3] Server dependencies...
pushd ..
call npm install --omit=dev --no-fund --no-audit || (popd & pause & exit /b 1)
popd
if not exist "..\node_modules\pinets\package.json" (echo [!] Server dependencies were not installed ^(pinets missing^). & pause & exit /b 1)
echo [2/3] Desktop dependencies (Electron, electron-builder)...
call npm install --no-fund --no-audit || (pause & exit /b 1)
echo [3/3] Building installer...
set CSC_IDENTITY_AUTO_DISCOVERY=false
call npx electron-builder --win --x64 --publish never || (pause & exit /b 1)
echo.
echo Done: desktop\dist\PandichLab-*-win-x64.exe
explorer dist
pause
