@echo off
chcp 936 >nul
title DeepSeek Harness 远程访问（网关 + 隧道）
cd /d "%~dp0"

if not exist cloudflared.exe (
  echo 未找到 cloudflared.exe，请先运行 download-cloudflared.bat
  pause
  exit /b 1
)

echo [1/2] 检查远程网关（端口 8443）...
netstat -ano | findstr "127.0.0.1:8443" | findstr "LISTENING" >nul 2>nul
if errorlevel 1 (
  echo 未检测到网关，正在启动...
  start "HarnessGateway" cmd /c "node gateway.js"
  timeout /t 3 /nobreak >nul
) else (
  echo 网关已在运行，跳过启动。
)

echo [2/2] 启动 Cloudflare 临时隧道（把 8443 暴露到公网）...
echo.
echo 临时隧道会生成一个 https://xxxx.trycloudflare.com 地址，
echo 在手机浏览器打开该地址，输入访问令牌即可远程控制。
echo （注意：临时隧道每次重启地址都会变；要固定地址请看 README 的「固定公网地址」章节）
echo.
cloudflared.exe tunnel --url http://127.0.0.1:8443

pause
