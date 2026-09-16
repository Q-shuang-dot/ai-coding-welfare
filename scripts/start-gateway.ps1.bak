# Interactive startup script for GCMP Gateway (welfare project entrypoint).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/start-gateway.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/start-gateway.ps1 -Port 15800
#   npm run gateway:start
#
# Reads listen.port from gcmp-gateway/config.json by default; falls back to 15800.
param(
  [int]$Port
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$gwDir = Join-Path $root 'gcmp-gateway'
$configPath = Join-Path $gwDir 'config.json'

if (-not (Test-Path $configPath)) {
  throw "Gateway config not found: $configPath"
}

$cfg = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
$port = [int]($cfg.listen.port)
if ($PSBoundParameters.ContainsKey('Port')) {
  $port = [int]$Port
}
$adminUrl = "http://127.0.0.1:$port/admin/"
$rootUrl = "http://127.0.0.1:$port/"

$running = Test-NetConnection -ComputerName 127.0.0.1 -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue
if (-not $running) {
  Write-Host "[starting] GCMP Gateway -> $adminUrl" -ForegroundColor Cyan
  Start-Process -WindowStyle Hidden python -ArgumentList (Join-Path $gwDir 'gateway.py')
  Start-Sleep 3
  $running = Test-NetConnection -ComputerName 127.0.0.1 -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue
}
else {
  Write-Host "[OK] 网关已在运行 -> $rootUrl" -ForegroundColor Green
}

if ($running) {
  Write-Host "[OK] GCMP Gateway running -> $adminUrl" -ForegroundColor Green
  Start-Process $adminUrl
}
else {
  Write-Host '[FAIL] Start failed, run: python ' + (Join-Path $gwDir 'gateway.py') -ForegroundColor Red
  Read-Host 'Press Enter to close'
}
Start-Sleep -Seconds 3
