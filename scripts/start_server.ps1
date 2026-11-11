# dbu6 1-Click Hidden Background Launcher for Windows PowerShell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ProjectDir = (Resolve-Path "$PSScriptRoot\..").Path
Set-Location -Path $ProjectDir

# Check if port 2345 is already listening
$conn = Get-NetTCPConnection -LocalPort 2345 -State Listen -ErrorAction SilentlyContinue
if ($conn) {
    Write-Host "[INFO] dbu6 server is already running and listening on port 2345 (PID: $($conn.OwningProcess))." -ForegroundColor Green
    Write-Host "[जानकारी] dbu6 सर्वर पहले से चल रहा है।" -ForegroundColor Cyan
    Write-Host "[INFO] Opening browser at http://localhost:2345..." -ForegroundColor Cyan
    Start-Process "http://localhost:2345"
    Exit 0
}

# Launch via start_hidden.vbs
Start-Process "wscript.exe" -ArgumentList "`"$PSScriptRoot\start_hidden.vbs`""
Write-Host "[INFO] dbu6 server launched in hidden background mode." -ForegroundColor Green
Write-Host "[INFO] Web browser is opening at http://localhost:2345..." -ForegroundColor Cyan
Write-Host "[जानकारी] dbu6 सर्वर शुरू किया गया है और ब्राउज़र खुल रहा है।" -ForegroundColor Cyan
Start-Sleep -Seconds 2
