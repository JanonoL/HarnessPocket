#!/bin/bash
# Harness Pocket FRP 客户端（WSL 版）
# 当 Windows 上无法执行 frpc.exe 时使用本脚本。
set -e

cd /mnt/f/workspacecraftsmen/craftsmen/harnessapp

if ! command -v frpc >/dev/null 2>&1; then
  echo "未找到 Linux frpc，请先执行："
  echo "  sudo cp <frpc> /usr/local/bin/frpc && sudo chmod +x /usr/local/bin/frpc"
  exit 1
fi

if [ ! -f frpc.toml ]; then
  echo "未找到 frpc.toml，请先完成自助注册并保存配置。"
  exit 1
fi

# 获取 Windows 主机在 WSL 网络中的网关地址（通常是 172.x.x.1）
WINDOWS_HOST_IP=$(ip route show default | awk '{print $3; exit}')
echo "Windows 主机地址: $WINDOWS_HOST_IP"

# 把 frpc.toml 里的 localIP 从 127.0.0.1 改成 Windows 主机地址
sed "s/^localIP = "127.0.0.1"/localIP = "$WINDOWS_HOST_IP"/" frpc.toml > /tmp/frpc-wsl.toml

echo "启动 frpc（WSL 模式）..."
exec frpc -c /tmp/frpc-wsl.toml
