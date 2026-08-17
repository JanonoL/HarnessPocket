@echo off
chcp 936 >nul
title 下载 cloudflared
cd /d "%~dp0"
if exist cloudflared.exe (
  echo cloudflared.exe 已存在，跳过下载。
  pause
  exit /b 0
)
echo 正在下载 cloudflared（Cloudflare Tunnel 客户端）...
curl.exe -L -C - --retry 20 --retry-delay 3 --retry-all-errors --connect-timeout 20 -o cloudflared.exe https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
if exist cloudflared.exe (
  echo.
  echo 下载完成。运行 cloudflared.exe --version 验证：
  cloudflared.exe --version
) else (
  echo 下载失败，请检查网络后重试，或手动从 https://github.com/cloudflare/cloudflared/releases 下载。
)
pause
