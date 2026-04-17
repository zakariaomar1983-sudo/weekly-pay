@echo off
setlocal

set "ROOT=C:\Users\zakar\OneDrive\WEEKLY PAY"
set "NODE_EXE=C:\Program Files\nodejs\node.exe"

if not exist "%NODE_EXE%" set "NODE_EXE=node"

start "Onpoint Express Server" powershell -NoExit -Command "Set-Location -LiteralPath '%ROOT%'; & '%NODE_EXE%' 'local-server.js'"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:4173/index.html"

endlocal
