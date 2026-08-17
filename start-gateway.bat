@echo off
chcp 936 >nul
title DeepSeek Harness 远程网关
cd /d "%~dp0"
echo 正在启动远程网关（令牌认证 + 反向代理 harness GUI）...
echo.
echo 如果打不开，请确认浏览器地址是 http://127.0.0.1:8443，不要用 http://localhost:8443。
echo.
node gateway.js
pause
