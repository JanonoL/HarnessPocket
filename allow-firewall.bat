@echo off
chcp 936 >nul
rem 以管理员身份运行：放行 HarnessApp 的 3090 端口（入站 TCP），让局域网内手机可以访问。
rem 若端口改了，请把下面的 3090 改成 config.json 里的 port。
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo 请右键本文件选择「以管理员身份运行」。
  pause
  exit /b 1
)
netsh advfirewall firewall add rule name="HarnessApp-3090" dir=in action=allow protocol=TCP localport=3090
echo 已放行端口 3090（局域网访问）。
netsh advfirewall firewall add rule name="HarnessApp-Tailscale-8443" dir=in action=allow protocol=TCP localport=8443 remoteip=100.64.0.0/10
echo 已放行端口 8443（Tailscale 内网 IP 直连）。
echo 按任意键关闭。
pause >nul
