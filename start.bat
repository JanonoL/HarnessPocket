@echo off
chcp 936 >nul
title DeepSeek Harness 移动端伴侣 App
cd /d "%~dp0"
echo 正在启动 DeepSeek Harness 移动端伴侣 App ...
node server.js
pause
