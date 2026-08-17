@echo off
chcp 936 >nul
title DeepSeek Harness 远程网关
cd /d "%~dp0"
echo 正在启动远程网关（令牌认证 + 反向代理 harness GUI）...
node gateway.js
pause
