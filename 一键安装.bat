@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title DeepSeek Harness 手机远程控制 - 一键安装
cd /d "%~dp0"

set "TS=C:\Program Files\Tailscale\tailscale.exe"
set "GATEWAY_PORT=8443"
set "TASK_NAME=HarnessRemoteGateway"

echo.
echo  ================================================================
echo    DeepSeek Harness 手机远程控制 · 一键安装
echo  ================================================================
echo.

REM ============ 1. 检查 Node.js ============
where node >nul 2>nul
if errorlevel 1 (
  echo  [错误] 未检测到 Node.js。
  echo  请先到 https://nodejs.org 下载安装 Node.js（LTS 版本），装完再运行本脚本。
  echo.
  pause
  exit /b 1
)
echo  [1/6] Node.js 已就绪

REM ============ 2. 检查/安装 Tailscale ============
if not exist "%TS%" (
  echo  [2/6] 未检测到 Tailscale，正在下载安装（约 1 分钟）...
  if not exist "tailscale-setup.exe" (
    curl.exe -L -o tailscale-setup.exe https://pkgs.tailscale.com/stable/tailscale-setup-latest.exe
  )
  if exist "tailscale-setup.exe" (
    tailscale-setup.exe /S
    timeout /t 8 /nobreak >nul
  )
)
if exist "%TS%" (
  echo  [2/6] Tailscale 已就绪
) else (
  echo  [错误] Tailscale 安装失败，请手动到 https://tailscale.com/download 下载安装后重试。
  pause
  exit /b 1
)

REM ============ 3. 登录 Tailscale ============
"%TS%" status >nul 2>nul
if errorlevel 1 (
  echo.
  echo  [3/6] Tailscale 需要登录（一次性）：
  echo        即将弹出登录链接，请在浏览器里登录（或免费注册）你的 Tailscale 账号。
  echo.
  start "" "%TS%" login
  timeout /t 5 /nobreak >nul
  "%TS%" up
  echo.
  echo        ※ 请在浏览器完成登录后，回到这里按任意键继续...
  pause >nul
)
"%TS%" status >nul 2>nul
if errorlevel 1 (
  echo  [错误] 仍未登录 Tailscale，请重新运行本脚本并完成登录。
  pause
  exit /b 1
)
echo  [3/6] Tailscale 已登录

REM ============ 4. 注册网关开机自启 ============
schtasks /create /tn "%TASK_NAME%" /tr "wscript.exe \"%~dp0start-gateway-hidden.vbs\"" /sc onlogon /rl highest /f >nul 2>nul
echo  [4/6] 网关开机自启已注册

REM ============ 5. 启动网关 ============
netstat -ano | findstr "127.0.0.1:%GATEWAY_PORT%" | findstr "LISTENING" >nul 2>nul
if errorlevel 1 (
  start "" /min cmd /c "cd /d \"%~dp0\" && node gateway.js"
  timeout /t 3 /nobreak >nul
)
netstat -ano | findstr "127.0.0.1:%GATEWAY_PORT%" | findstr "LISTENING" >nul 2>nul
if errorlevel 1 (
  echo  [错误] 网关启动失败，请检查 gateway.js 与 gateway.config.json。
  pause
  exit /b 1
)
echo  [5/6] 网关已启动

REM ============ 6. 配置 Tailscale Serve (HTTPS) ============
"%TS%" serve --bg 127.0.0.1:%GATEWAY_PORT% >nul 2>nul
echo  [6/6] HTTPS（Tailscale Serve）已配置

REM ============ 读取并打印结果 ============
set "GWURL="
set "GWTOKEN="
for /f "usebackq delims=" %%a in (`node info.mjs`) do (
  if "!GWURL!"=="" (set "GWURL=%%a") else (set "GWTOKEN=%%a")
)

echo.
echo  ================================================================
echo    安装完成！
echo  ================================================================
echo.
echo    手机访问地址（HTTPS，用手机浏览器打开）：
echo      !GWURL!
echo.
echo    访问令牌：
echo      !GWTOKEN!
echo.
echo  ================================================================
echo    手机端还需做一次（见使用手册）：
echo      1. 手机应用商店安装 Tailscale，登录「同一账号」
echo      2. 打开上面的地址，输入访问令牌
echo  ================================================================
echo.
pause
