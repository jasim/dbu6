# dbu6 1-Click Stopper for Windows PowerShell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ProjectDir = (Resolve-Path "$PSScriptRoot\..").Path
Set-Location -Path $ProjectDir

$stopped = $false
$targetPid = $null

# 1. Query port 2345
$conn = Get-NetTCPConnection -LocalPort 2345 -State Listen -ErrorAction SilentlyContinue
if ($conn) {
    $targetPid = $conn.OwningProcess
    Write-Host "[INFO] Terminating dbu6 server on port 2345 (PID: $targetPid)..." -ForegroundColor Yellow
    taskkill /PID $targetPid /T /F 2>$null | Out-Null
    $stopped = $true
}

# 2. Check lockfile PID
if (Test-Path "$ProjectDir\data\dbu6.lock") {
    $raw = Get-Content "$ProjectDir\data\dbu6.lock" -Raw -ErrorAction SilentlyContinue
    if ($raw) {
        $lockPid = $raw.Trim()
        if ($lockPid -match '^\d+$') {
            taskkill /PID $lockPid /T /F 2>$null | Out-Null
            $stopped = $true
        }
    }
    Remove-Item "$ProjectDir\data\dbu6.lock" -Force -ErrorAction SilentlyContinue
}

# 3. Clean up lockfile if remaining
if (Test-Path "$ProjectDir\data\dbu6.lock") {
    Remove-Item "$ProjectDir\data\dbu6.lock" -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Milliseconds 400
$connAfter = Get-NetTCPConnection -LocalPort 2345 -State Listen -ErrorAction SilentlyContinue
if (-not $connAfter) {
    if ($stopped) {
        Write-Host "[SUCCESS] dbu6 server stopped successfully. Port 2345 is now free." -ForegroundColor Green
        Write-Host "[सफलता] dbu6 सर्वर सफलतापूर्वक बंद कर दिया गया है। पोर्ट 2345 अब खाली है।" -ForegroundColor Cyan
    } else {
        Write-Host "[INFO] dbu6 server was not running. Port 2345 is already free." -ForegroundColor Yellow
        Write-Host "[जानकारी] dbu6 सर्वर पहले से ही बंद है। पोर्ट 2345 पहले से खाली है।" -ForegroundColor Cyan
    }
} else {
    Write-Host "[WARNING] Port 2345 still appears active. Please check Task Manager." -ForegroundColor Red
}

Start-Sleep -Seconds 2
exit 0
