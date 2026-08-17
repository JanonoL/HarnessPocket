@echo off
chcp 936 >nul
title Tailscale Serve 设置（登录 Tailscale 后运行）
set "TS=C:\Program Files\Tailscale\tailscale.exe"

echo [1/3] 检查 Tailscale 登录状态...
"%TS%" status >nul 2>&1
if errorlevel 1 (
  echo.
  echo 尚未登录 Tailscale。请先运行：
  echo   "%TS%" up
  echo 然后打开打印的登录链接，用你的 Tailscale 账号授权。
  pause
  exit /b 1
)

echo [2/3] 把网关(127.0.0.1:8443)通过 Tailscale Serve 暴露到 tailnet（HTTPS，443 端口）...
"%TS%" serve --bg 443 http://127.0.0.1:8443

echo [3/3] 显示访问地址...
echo.
echo 本机 Tailscale 地址：
"%TS%" ip -4
echo.
echo 手机访问地址（https，用你手机 Tailscale App 里看到的电脑名字）：
echo   https://电脑名.你的tailnet名.ts.net
echo.
echo 在手机浏览器打开后，输入网关访问令牌即可远程控制 Harness。
pause
