@echo off
chcp 936 >nul
title DeepSeek Harness 远程网关 - 重启
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0restart-gateway.ps1"
pause