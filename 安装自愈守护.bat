@echo off
chcp 936 >nul
title 安装自愈守护（网关 + FRP 隧道健康检查）
cd /d "%~dp0"

echo.
echo  ================================================================
echo   安装自愈守护：每 5 分钟自动检查一次
echo     1) 本机网关 8443 是否在跑，不在就自动拉起
echo     2) 公网域名是否被 frp 回了 404 页（隧道注册掉了），是就自动重启 frpc
echo  ================================================================
echo.

schtasks /create /tn "HarnessRemoteWatchdog" /tr "wscript.exe \"%~dp0start-watchdog-hidden.vbs\"" /sc minute /mo 5 /f
if errorlevel 1 (
  echo [错误] 计划任务创建失败。请右键本文件，选择“以管理员身份运行”。
  pause
  exit /b 1
)

echo [OK] 计划任务 HarnessRemoteWatchdog 已注册（每 5 分钟检查一次）。
echo.
echo 立即执行一次检查...
schtasks /run /tn "HarnessRemoteWatchdog" >nul 2>nul
timeout /t 10 /nobreak >nul

echo.
echo 最近检查记录（watchdog.log）：
if exist watchdog.log (
  powershell -NoProfile -Command "Get-Content -Tail 10 -Encoding UTF8 watchdog.log"
) else (
  echo   暂无日志，稍后再看 watchdog.log
)
echo.
echo 以后不想用了，执行： schtasks /delete /tn "HarnessRemoteWatchdog" /f
pause