@echo off
chcp 65001 >nul
title GCMP Gateway
rem 一键启动网关 + 打开管理页（已在运行则跳过启动）
set "GW_DIR=%~dp0"
if not exist "%GW_DIR%config.json" (
  echo [FAIL] 未找到 config.json
  echo        首次使用：复制模板再填入自己的上游 apiKey
  echo        copy "%GW_DIR%config.example.json" "%GW_DIR%config.json"
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$d = '%GW_DIR%';" ^
  "$cfg = Get-Content -LiteralPath ($d + 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json;" ^
  "$port = 15800; if ($cfg.listen -and $cfg.listen.port) { $port = [int]$cfg.listen.port };" ^
  "$running = Test-NetConnection -ComputerName 127.0.0.1 -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue;" ^
  "if (-not $running) { Start-Process -WindowStyle Hidden python -ArgumentList ($d + 'gateway.py'); Start-Sleep 3;" ^
  "  $running = Test-NetConnection -ComputerName 127.0.0.1 -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue }" ^
  "else { Write-Host '[OK] 网关已在运行' -ForegroundColor Green };" ^
  "if ($running) { Write-Host ('[OK] GCMP 网关运行中 -> http://127.0.0.1:' + $port) -ForegroundColor Green;" ^
  "  Write-Host '     正在打开管理页面...' -ForegroundColor Gray;" ^
  "  Start-Process ('http://127.0.0.1:' + $port + '/admin/') }" ^
  "else { Write-Host ('[FAIL] 启动失败，请手动运行: python ' + $d + 'gateway.py') -ForegroundColor Red;" ^
  "  Read-Host '按回车关闭' }"
timeout /t 3 /nobreak >nul
