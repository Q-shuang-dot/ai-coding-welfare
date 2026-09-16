@echo off
chcp 65001 >nul
title GCMP Gateway
rem 一键启动网关 + 打开管理页（已在运行则跳过启动）
set "GW_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$running = Test-NetConnection -ComputerName 127.0.0.1 -Port 15800 -InformationLevel Quiet -WarningAction SilentlyContinue;" ^
  "if (-not $running) { Start-Process -WindowStyle Hidden python -ArgumentList ('%GW_DIR%gateway.py'); Start-Sleep 3;" ^
  "  $running = Test-NetConnection -ComputerName 127.0.0.1 -Port 15800 -InformationLevel Quiet -WarningAction SilentlyContinue }" ^
  "else { Write-Host '[OK] 网关已在运行' -ForegroundColor Green };" ^
  "if ($running) { Write-Host '[OK] GCMP 网关运行中 -> http://127.0.0.1:15800' -ForegroundColor Green;" ^
  "  Write-Host '     正在打开管理页面...' -ForegroundColor Gray;" ^
  "  Start-Process 'http://127.0.0.1:15800/admin/' }" ^
  "else { Write-Host '[FAIL] 启动失败，请手动运行: python %GW_DIR%gateway.py' -ForegroundColor Red;" ^
  "  Read-Host '按回车关闭' }"
timeout /t 3 /nobreak >nul
