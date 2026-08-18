@echo off
chcp 936 >nul
title Harness Pocket 远程访问（国内优化首选：FRP 内网穿透）
cd /d "%~dp0"

echo.
echo  ================================================================
echo   Harness Pocket 远程访问 —— 国内优化首选：FRP 内网穿透
echo  ================================================================
echo.

REM ============ 1. 自动下载 frpc.exe（如果不存在） ============
if exist frpc.exe goto frpc_ready

echo [1/4] 未找到 frpc.exe，开始自动下载（国内加速）...

set "URL1=https://ghfast.top/https://github.com/fatedier/frp/releases/download/v0.61.0/frp_0.61.0_windows_amd64.zip"
set "URL2=https://gh-proxy.com/https://github.com/fatedier/frp/releases/download/v0.61.0/frp_0.61.0_windows_amd64.zip"
set "URL3=https://ghproxy.net/https://github.com/fatedier/frp/releases/download/v0.61.0/frp_0.61.0_windows_amd64.zip"

curl.exe -L -C - --retry 3 --connect-timeout 20 -o frpc.zip "%URL1%"
if errorlevel 1 curl.exe -L -C - --retry 3 --connect-timeout 20 -o frpc.zip "%URL2%"
if errorlevel 1 curl.exe -L -C - --retry 3 --connect-timeout 20 -o frpc.zip "%URL3%"
if errorlevel 1 (
  echo [错误] 自动下载失败，请手动到 https://github.com/fatedier/frp/releases 下载
  echo        解压后把 frpc.exe 复制到本目录，再运行本脚本。
  pause
  exit /b 1
)

if not exist frpc.zip (
  echo [错误] 下载文件不存在，请手动下载 frpc.exe。
  pause
  exit /b 1
)

tar -xf frpc.zip -C .
if exist frp_0.61.0_windows_amd64\frpc.exe (
  copy /y frp_0.61.0_windows_amd64\frpc.exe frpc.exe >nul
) else (
  echo [错误] 解压失败，请手动下载 frpc.exe 放到本目录。
  pause
  exit /b 1
)

del frpc.zip >nul 2>nul
rd /s /q frp_0.61.0_windows_amd64 >nul 2>nul
echo [OK] frpc.exe 已就绪。

:frpc_ready

REM ============ 2. 自动生成 frpc.toml（如果不存在） ============
if exist frpc.toml goto frpc_toml_ready

echo [2/4] 生成 frpc.toml 配置模板...
copy /y frpc.toml.example frpc.toml >nul
echo.
echo 请先编辑 frpc.toml，修改以下三项：
echo   serverAddr    = FRP 服务端公网 IP 或域名
echo   auth.token    = 与 K8s 里 frps 的 auth.token 一致
echo   customDomains = 分配给你的访问域名
echo.
notepad frpc.toml
pause
exit /b 0

:frpc_toml_ready

REM ============ 3. 检查网关 ============
echo [3/4] 检查远程网关（端口 8443）...
netstat -ano | findstr "127.0.0.1:8443" | findstr "LISTENING" >nul 2>nul
if errorlevel 1 (
  echo 未检测到网关，正在启动...
  start "HarnessGateway" cmd /c "node gateway.js"
  timeout /t 3 /nobreak >nul
) else (
  echo 网关已在运行，跳过启动。
)

REM ============ 4. 启动 frpc ============
echo [4/4] 启动 FRP 客户端（国内优化线路）...
echo.
echo 手机访问地址：
for /f "tokens=*" %%d in ('findstr /C:"customDomains" frpc.toml') do echo   %%d
echo.
echo 网关访问令牌：
for /f "tokens=*" %%t in ('node -e "console.log(require('./gateway.config.json').token)"') do echo   %%t
echo.

REM 如果 Windows 安全策略阻止 frpc.exe，自动切换到 WSL 模式
frpc.exe --version >nul 2>&1
if errorlevel 1 (
  echo [提示] Windows frpc.exe 被系统阻止，自动切换到 WSL 模式...
  wsl.exe bash /mnt/f/workspacecraftsmen/craftsmen/harnessapp/start-frp-wsl.sh
  pause
  exit /b 0
)

frpc.exe -c frpc.toml
pause
