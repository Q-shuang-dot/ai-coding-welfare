@echo off
chcp 65001 >nul
title GCMP Gateway - 停止
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$f = '%~dp0' + 'config.json'; $port = 15800;" ^
  "if (Test-Path -LiteralPath $f) { try { $cfg = Get-Content -LiteralPath $f -Raw -Encoding UTF8 | ConvertFrom-Json;" ^
  "  if ($cfg.listen -and $cfg.listen.port) { $port = [int]$cfg.listen.port } } catch {} }" ^
  "$c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue;" ^
  "if ($c) { $c | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force };" ^
  "  Write-Host ('[OK] GCMP 网关已停止（端口 ' + $port + '）') -ForegroundColor Yellow }" ^
  "else { Write-Host ('[--] 端口 ' + $port + ' 上没有网关在运行') -ForegroundColor Gray }"
timeout /t 2 /nobreak >nul
