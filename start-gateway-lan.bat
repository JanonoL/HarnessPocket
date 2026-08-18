@echo off
chcp 936 >nul
title DeepSeek Harness 远程网关（局域网可访问）
cd /d "%~dp0"
set HARNESS_GW_HOST=0.0.0.0
echo 正在启动远程网关（局域网可访问 + 令牌认证）...
echo 局域网手机访问地址： http://本机IP:8443 （本机 IP 可用 ipconfig 查看）
node gateway.js
pause
