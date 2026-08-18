@echo off
chcp 936 >nul
title Tailscale Funnel 公网开关（备用：国外线路）
cd /d "%~dp0"
set "TS=C:\Program Files\Tailscale\tailscale.exe"

"%TS%" status >nul 2>&1
if errorlevel 1 (
  echo 尚未登录 Tailscale。请先运行 一键安装.bat 或 tailscale-serve.bat。
  pause
  exit /b 1
)

if /i "%~1"=="off" (
  echo 正在关闭公网 Funnel...
  "%TS%" funnel --https=443 off
  echo.
  echo 已关闭公网。恢复为仅 Tailscale 内网可访问。
) else (
  echo 正在开启公网 Funnel（把 127.0.0.1:8443 暴露到公网）...
  "%TS%" funnel --bg --yes http://127.0.0.1:8443
  echo.
  echo 已开启。手机无需 Tailscale，直接用流量或 WiFi 访问下面的地址：
  "%TS%" funnel status
  echo.
  echo 注意：这是公网地址，任何人拿到地址和令牌都能访问。
  echo 关闭命令：tailscale-funnel.bat off
)
pause
