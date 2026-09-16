@echo off
chcp 65001 >nul
title GCMP Gateway - 停止
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$c = Get-NetTCPConnection -LocalPort 15900 -State Listen -ErrorAction SilentlyContinue;" ^
  "if ($c) { $c | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force };" ^
  "  Write-Host '[OK] GCMP 网关已停止' -ForegroundColor Yellow }" ^
  "else { Write-Host '[--] 网关未在运行' -ForegroundColor Gray }"
timeout /t 2 /nobreak >nul
