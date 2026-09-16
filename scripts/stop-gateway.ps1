# 交互式停止 GCMP 网关（福利站项目统一入口）。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts/stop-gateway.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/stop-gateway.ps1 -Port 15800
#   npm run gateway:stop
#
# 默认读取 gcmp-gateway/config.json 的 listen.port；未配置时回退到 15800。
param(
  [int]$Port
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$gwDir = Join-Path $root 'gcmp-gateway'
$configPath = Join-Path $gwDir 'config.json'

if (-not (Test-Path $configPath)) {
  throw "找不到网关配置: $configPath"
}

$cfg = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
$port = [int]($cfg.listen.port)
if ($PSBoundParameters.ContainsKey('Port')) {
  $port = [int]$Port
}
$adminUrl = "http://127.0.0.1:$port/admin/"

$c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($c) {
  $c | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
  Write-Host "[OK] GCMP 网关已停止 (port $port)" -ForegroundColor Yellow
}
else {
  Write-Host '[--] 网关未在运行（端口 $port）' -ForegroundColor Gray
}
Start-Sleep -Seconds 2
