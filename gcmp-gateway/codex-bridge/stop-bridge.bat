@echo off
chcp 65001 >nul
title SharedChat 桥接 - 停止
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$c = Get-NetTCPConnection -LocalPort 15731 -State Listen -ErrorAction SilentlyContinue;" ^
  "if ($c) { $c | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force };" ^
  "  Write-Host '[OK] 桥接已停止' -ForegroundColor Yellow }" ^
  "else { Write-Host '[--] 桥接未在运行' -ForegroundColor Gray };" ^
  "$z = Get-Process codex -ErrorAction SilentlyContinue;" ^
  "if ($z) { $z | Stop-Process -Force; Write-Host '[OK] 已清理残留 codex 进程（会话锁）' -ForegroundColor Yellow }"
timeout /t 2 /nobreak >nul
