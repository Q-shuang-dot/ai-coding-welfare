@echo off
chcp 65001 >nul
title SharedChat 桥接启动器
set "BR_DIR=%~dp0"

powershell -NoProfile -Command "if(Get-NetTCPConnection -LocalPort 15731 -State Listen -ErrorAction SilentlyContinue){exit 0}else{exit 1}"
if %errorlevel%==0 (
    echo [OK] 桥接已在运行：http://127.0.0.1:15731/v1
    timeout /t 3 >nul
    exit /b 0
)

echo 正在启动桥接服务，请稍候...
powershell -NoProfile -Command "Start-Process -WindowStyle Hidden python -ArgumentList '%BR_DIR%bridge.py'"
timeout /t 3 /nobreak >nul

powershell -NoProfile -Command "try{Invoke-WebRequest -Uri 'http://127.0.0.1:15731/v1/models' -UseBasicParsing -TimeoutSec 5|Out-Null;exit 0}catch{exit 1}"
if %errorlevel%==0 (
    echo [OK] 启动成功 -^> http://127.0.0.1:15731/v1
) else (
    echo [FAIL] 启动失败。检查 %%USERPROFILE%%\.codex-bin\codex.exe 是否存在，或残留 codex 进程占着会话锁
)
timeout /t 4 >nul
