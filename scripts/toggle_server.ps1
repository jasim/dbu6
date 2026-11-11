# dbu6 1-Click Toggle for Windows PowerShell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ProjectDir = (Resolve-Path "$PSScriptRoot\..").Path
Set-Location -Path $ProjectDir

$conn = Get-NetTCPConnection -LocalPort 2345 -State Listen -ErrorAction SilentlyContinue
if ($conn) {
    Write-Host "[STATUS] dbu6 server is currently RUNNING (PID: $($conn.OwningProcess))." -ForegroundColor Yellow
    Write-Host "[ACTION] Stopping server..." -ForegroundColor Yellow
    Write-Host "[स्थिति] dbu6 सर्वर चल रहा है। इसे अब बंद किया जा रहा है..." -ForegroundColor Cyan
    & "$PSScriptRoot\stop_server.ps1"
} else {
    Write-Host "[STATUS] dbu6 server is currently STOPPED." -ForegroundColor Green
    Write-Host "[ACTION] Starting server..." -ForegroundColor Green
    Write-Host "[स्थिति] dbu6 सर्वर बंद है। इसे अब शुरू किया जा रहा है..." -ForegroundColor Cyan
    & "$PSScriptRoot\start_server.ps1"
}
