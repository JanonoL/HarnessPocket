# Harness Remote —— DeepSeek Harness 手机远程控制

随时随地用手机远程控制电脑上的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：发消息、看回复、切换对话、浏览文件。基于 **Tailscale 私有加密组网 + HTTPS**，公网零暴露，一键安装。

> ⚠️ Harness 是「远程执行代码」工具，请务必保管好你的 Tailscale 账号和访问令牌，不要分享给不信任的人。

---

## ✨ 特性

- 📱 **手机随时远程控制**：发消息、切换对话、浏览生成的文件。
- 🔒 **安全**：公网零暴露（无公网入口）、局域网零暴露（网关只监听 127.0.0.1）、令牌二次认证、全程 HTTPS + WireGuard 加密。
- ⚡ **一键安装**：`一键安装.bat` 自动装 Tailscale、配置开机自启、配置 HTTPS。
- 🖥 **手机界面适配**：自动注入移动端样式，隐藏桌面端详情面板、侧边栏变抽屉。

## 🏗 架构

```
手机浏览器 ──HTTPS──> Tailscale 加密组网 ──> 远程网关(gateway.js) ──> DeepSeek Harness
(wss 加密)           (私有，仅你的设备)       (令牌认证)              (127.0.0.1:3080)
```

- Harness 本体只监听 `127.0.0.1`，不直接暴露。
- `gateway.js` 反向代理 HTTP + WebSocket + SSE，并注入移动端样式。
- Tailscale Serve 免费提供 HTTPS 证书。

## 🚀 快速开始

### 前置条件
- 电脑已装 [Node.js](https://nodejs.org)（LTS）。
- 电脑上 DeepSeek Harness 能正常运行（`dsh web` 可打开 `http://127.0.0.1:3080`）。

### 电脑端（一键安装）
1. 双击运行 `一键安装.bat`。
2. 首次会弹出 Tailscale 登录链接，在浏览器登录（或免费注册）你的账号。
3. 完成后记下脚本打印的 **手机访问地址** 和 **访问令牌**。

### 手机端（一次性）
1. 应用商店安装 **Tailscale**，登录**同一账号**。
2. 手机浏览器（建议 Chrome / Edge / Safari）打开上面的 HTTPS 地址，输入令牌。

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
tailscale serve --bg 127.0.0.1:8443   # 用 Tailscale Serve 提供 HTTPS
node info.mjs                   # 查看访问地址和令牌
```

## 🛡 安全说明

- **零公网暴露**：没有公网入口，只有你 Tailscale 账号内的设备能访问。
- **零局域网暴露**：网关只监听 `127.0.0.1`。
- **双重认证**：Tailscale 设备身份 + 网关访问令牌。
- **建议**：把 `gateway.config.json` 里的 `token` 改成强随机串；不要分享账号和令牌。

## 📄 License

[MIT](LICENSE)

## 免责声明

本项目仅用于个人合法使用。请勿用于任何未经授权的访问或违反所在地法律的行为。
