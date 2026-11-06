@echo off
setlocal enabledelayedexpansion

REM Dynamically determine project directory (parent of scripts/)
for %%I in ("%~dp0..") do set "PROJECT_DIR=%%~fI"
cd /d "%PROJECT_DIR%"

echo ============================================================
echo   dbu6 Accounting Server Launcher
echo   URL: http://localhost:2345
echo ============================================================

REM Check if server is already running on port 2345
set "IS_RUNNING=0"
set "SERVER_PID="
for /f "tokens=5" %%a in ('netstat -ano -p tcp ^| findstr :2345 ^| findstr LISTENING') do (
    set "IS_RUNNING=1"
    set "SERVER_PID=%%a"
)

if "!IS_RUNNING!"=="1" (
    echo [INFO] dbu6 server is ALREADY running [PID: !SERVER_PID!].
    echo [INFO] Opening web browser at http://localhost:2345...
    start http://localhost:2345
    ping 127.0.0.1 -n 3 >nul
    exit /b 0
)

echo [INFO] Starting dbu6 server in background...

REM Launch hidden background process via VBScript
start "" wscript.exe "%~dp0start_hidden.vbs"

echo [SUCCESS] dbu6 server launch command initiated.
echo [INFO] Web browser will open automatically at http://localhost:2345
echo ============================================================

ping 127.0.0.1 -n 3 >nul
exit /b 0
