@echo off
setlocal enabledelayedexpansion

REM Dynamically determine project directory (parent of scripts/)
for %%I in ("%~dp0..") do set "PROJECT_DIR=%%~fI"
cd /d "%PROJECT_DIR%"

echo ============================================================
echo   dbu6 Server - 1-Click Toggle
echo ============================================================

REM Check if server is currently running on port 2345
set "IS_RUNNING=0"
set "SERVER_PID="
for /f "tokens=5" %%a in ('netstat -ano -p tcp ^| findstr :2345 ^| findstr LISTENING') do (
    set "IS_RUNNING=1"
    set "SERVER_PID=%%a"
)

if "!IS_RUNNING!"=="1" (
    echo [STATUS] dbu6 server is currently RUNNING [PID: !SERVER_PID!].
    echo [ACTION] Stopping the server now...
    echo.
    call "%~dp0stop_server.bat"
) else (
    echo [STATUS] dbu6 server is currently STOPPED.
    echo [ACTION] Starting the server now...
    echo.
    call "%~dp0start_server.bat"
)

exit /b 0
