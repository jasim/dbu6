@echo off
setlocal enabledelayedexpansion

REM Dynamically determine project directory (parent of scripts/)
for %%I in ("%~dp0..") do set "PROJECT_DIR=%%~fI"
cd /d "%PROJECT_DIR%"

echo ============================================================
echo   dbu6 Accounting Server Stopper
echo ============================================================

set "WAS_RUNNING=0"

REM 1. Read PID from data\dbu6.lock if it exists and kill process tree immediately
if exist "%PROJECT_DIR%\data\dbu6.lock" (
    set /p LOCK_PID=<"%PROJECT_DIR%\data\dbu6.lock"
    if defined LOCK_PID (
        echo [INFO] Stopping process tree from lockfile [PID: !LOCK_PID!]...
        taskkill /F /T /PID !LOCK_PID! >nul 2>&1
        set "WAS_RUNNING=1"
    )
    del /f /q "%PROJECT_DIR%\data\dbu6.lock" >nul 2>&1
)

REM 2. Find any process listening on port 2345 and kill immediately
for /f "tokens=5" %%p in ('netstat -ano -p tcp ^| findstr :2345 ^| findstr LISTENING') do (
    echo [INFO] Terminating listener process on port 2345 [PID: %%p]...
    taskkill /F /T /PID %%p >nul 2>&1
    set "WAS_RUNNING=1"
)

REM 3. Clean up lockfile if remaining
if exist "%PROJECT_DIR%\data\dbu6.lock" (
    del /f /q "%PROJECT_DIR%\data\dbu6.lock" >nul 2>&1
)

REM 4. Verify port is now free
netstat -ano -p tcp | findstr :2345 | findstr LISTENING >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [WARNING] Port 2345 is still occupied. Check Task Manager.
) else (
    if "!WAS_RUNNING!"=="1" (
        echo [SUCCESS] dbu6 server stopped successfully. Port 2345 is now free.
    ) else (
        echo [INFO] dbu6 server was not running. Port 2345 is already free.
    )
)
echo ============================================================

ping 127.0.0.1 -n 3 >nul
exit /b 0
