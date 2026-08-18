@echo off
chcp 936 >nul
title Harness Pocket 远程访问（国内优化首选：FRP 内网穿透）
cd /d "%~dp0"

echo.
echo  ================================================================
echo   Harness Pocket 远程访问 —— 国内优化首选：FRP 内网穿透
echo  ================================================================
echo.

if not exist frpc.exe (
  echo  [错误] 未找到 frpc.exe。
  echo  请先到 https://github.com/fatedier/frp/releases 下载 frp 客户端，
  echo  解压后把 frpc.exe 复制到本目录，然后再运行本脚本。
  pause
  exit /b 1
)

if not exist frpc.toml (
  echo  [错误] 未找到 frpc.toml。
  echo  请复制 frpc.toml.example 为 frpc.toml，并填写：
  echo    serverAddr    = FRP 服务端公网 IP 或域名
  echo    auth.token    = 与 frps 服务端一致
  echo    customDomains = K8s Ingress 分配的访问域名
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

echo [2/2] 启动 FRP 客户端（国内优化线路）...
echo 手机访问地址请使用 frpc.toml 中 customDomains 配置的域名。
echo.
frpc.exe -c frpc.toml
pause
