@echo off
setlocal
cd /d "%~dp0"
title Pandich Lab server
:loop
node server.mjs
set "EC=%errorlevel%"
if "%EC%"=="0" goto stopped
echo [Pandich Lab] server exited with code %EC% - restarting in 3 s...
ping -n 4 127.0.0.1 >nul
goto loop
:stopped
echo [Pandich Lab] server stopped.
exit /b 0
