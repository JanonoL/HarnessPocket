# Harness Pocket —— DeepSeek Harness 手机远程控制

随时随地用手机远程控制电脑上的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：发消息、看回复、切换对话、浏览文件。

远程接入优先级：

1. **FRP 内网穿透（国内优化首选）**：`start-frp.bat`
2. **Cloudflare 隧道（次选）**：`start-remote.bat`
3. **Tailscale 私有组网（备用）**：`一键安装.bat` / `tailscale-serve.bat`

> ⚠️ Harness 是「远程执行代码」工具，请务必保管好访问令牌，不要分享给不信任的人。

---

## ✨ 特性

- 📱 **手机随时远程控制**：发消息、切换对话、浏览生成的文件。
- 🔒 **安全**：网关只监听 127.0.0.1，令牌二次认证，FRP/Cloudflare/Tailscale 均可配置 HTTPS。
- ⚡ **国内优化首选**：`start-frp.bat` 走 FRP 内网穿透，适合国内手机流量远程访问。
- 🅰 **次选**：`start-remote.bat` 走 Cloudflare 临时隧道，无需手机安装客户端。
- 🅱 **备用**：`一键安装.bat` 自动装 Tailscale、配置开机自启、配置 HTTPS。
- 🖥 **手机界面适配**：自动注入移动端样式，隐藏桌面端详情面板、侧边栏变抽屉。

## 🏗 架构

```
手机浏览器 ──HTTPS──> FRP/Cloudflare/Tailscale 入口 ──> 远程网关(gateway.js) ──> DeepSeek Harness
                      (国内优化/次选/备用)           (令牌认证)              (127.0.0.1:3080)
```

- Harness 本体只监听 `127.0.0.1`，不直接暴露。
- `gateway.js` 反向代理 HTTP + WebSocket + SSE，并注入移动端样式。
- **国内优化首选 FRP**：需要先在 K8s/服务器部署 frps，公司电脑运行 `start-frp.bat`。
- **Cloudflare 次选**：运行 `start-remote.bat`，生成临时公网地址。
- **Tailscale 备用**：运行 `一键安装.bat`，手机安装 Tailscale 后访问。

## 🚀 快速开始

### 前置条件
- 电脑已装 [Node.js](https://nodejs.org)（LTS）。
- 电脑上 DeepSeek Harness 能正常运行（`dsh web` 可打开 `http://127.0.0.1:3080`）。

### 方案一：FRP 内网穿透（国内优化首选）

1. 在 K8s/服务器部署 frps 服务端（见 `craftsmenOps/deploy/frp`）。
2. 复制 `frpc.toml.example` 为 `frpc.toml`，填写服务端地址、token 和访问域名。
3. 下载 `frpc.exe` 放到本目录，双击运行 `start-frp.bat`。
4. 手机浏览器打开 `frpc.toml` 中配置的域名，输入访问令牌。

### 方案二：Cloudflare 临时隧道（次选）

1. 双击 `start-remote.bat`。
2. 等待生成 `https://xxxx.trycloudflare.com` 地址。
3. 手机浏览器打开该地址，输入访问令牌。

### 方案三：Tailscale 私有组网（备用）

1. 双击运行 `一键安装.bat`。
2. 手机安装 Tailscale，登录同一账号。
3. 手机浏览器打开脚本打印的 HTTPS 地址，输入访问令牌。

> 完整说明见 [`使用手册.md`](使用手册.md)。

## 📦 配置

| 文件 | 说明 |
| --- | --- |
| `gateway.config.json` | 网关配置（端口/令牌/转发目标）。首次运行自动生成随机令牌。 |
| `gateway.config.example.json` | 配置模板（不含令牌）。 |

访问令牌可手动修改，或运行 `node info.mjs` 查看当前地址与令牌。

## 🔧 手动启动

```bash
node gateway.js                 # 启动网关（默认 127.0.0.1:8443）
node info.mjs                   # 查看访问地址和令牌
```

### 🌐 公网访问优先级

1. **FRP（国内优化首选）**：双击 `start-frp.bat`，手机访问 `frpc.toml` 中配置的域名。
2. **Cloudflare（次选）**：双击 `start-remote.bat`，手机访问生成的 `https://xxxx.trycloudflare.com`。
3. **Tailscale（备用）**：`tailscale serve --bg 127.0.0.1:8443`，手机安装 Tailscale 后访问。

> 注意：公网地址暴露给所有知道地址的人，安全性依赖访问令牌，请勿长期开启不必要的入口。

## 🛡 安全说明

- **零公网暴露**：没有公网入口，只有你 Tailscale 账号内的设备能访问。
- **零局域网暴露**：网关只监听 `127.0.0.1`。
- **双重认证**：Tailscale 设备身份 + 网关访问令牌。
- **建议**：把 `gateway.config.json` 里的 `token` 改成强随机串；不要分享账号和令牌。

## 📄 License

[MIT](LICENSE)

## 免责声明

本项目仅用于个人合法使用。请勿用于任何未经授权的访问或违反所在地法律的行为。
