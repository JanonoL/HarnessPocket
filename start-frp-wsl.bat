@echo off
chcp 936 >nul
title Harness Pocket FRP 客户端（WSL 备用模式）
cd /d "%~dp0"
echo.
echo 国内优化首选：FRP 内网穿透（WSL 模式）
echo 适用于 Windows 无法执行 frpc.exe 的情况。
echo.
wsl.exe bash /mnt/f/workspacecraftsmen/craftsmen/harnessapp/start-frp-wsl.sh
pause
