@echo off
chcp 936 >nul
title 重启 FRP 隧道（手机打不开时双击我）
cd /d "%~dp0"

echo.
echo  [1/3] 结束旧的 frpc 进程...
taskkill /f /im frpc.exe >nul 2>nul
timeout /t 2 /nobreak >nul

echo  [2/3] 检查远程网关（端口 8443）...
netstat -ano | findstr "127.0.0.1:8443" | findstr "LISTENING" >nul 2>nul
if errorlevel 1 (
  echo        未检测到网关，正在启动...
  start "HarnessGateway" cmd /c "node gateway.js"
  timeout /t 3 /nobreak >nul
) else (
  echo        网关已在运行，跳过启动。
)

echo  [3/3] 启动 FRP 隧道...
echo.
for /f "tokens=*" %%d in ('findstr /C:"customDomains" frpc.toml') do echo   访问域名: %%d
for /f "tokens=*" %%t in ('node -e "console.log(require('./gateway.config.json').token)"') do echo   网关令牌: %%t
echo.
echo   下面这个窗口请勿关闭；关掉窗口就等于断开远程访问。
echo.
frpc.exe -c frpc.toml
pause