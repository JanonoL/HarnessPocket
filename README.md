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
- 🔁 **自愈守护（可选）**：`安装自愈守护.bat` 注册每 5 分钟自检，网关掉线自动拉起、FRP 隧道注册丢失自动重启 `frpc.exe`。

## 🏗 架构

```
手机浏览器 ──HTTPS──> FRP/Cloudflare/Tailscale 入口 ──> 远程网关(gateway.js) ──> DeepSeek Harness
                      (国内优化/次选/备用)           (令牌认证)              (127.0.0.1:3080)
```

- Harness 本体只监听 `127.0.0.1`，不直接暴露。
- `gateway.js` 反向代理 HTTP + WebSocket + SSE，并注入移动端样式。
- **两层认证都要过**：网关这层是访问令牌；Harness（`dsh web`）自己还有一层「按 Host 绑定签名 Cookie」的浏览器会话。手机打不开 Harness 启动时打印的 `http://127.0.0.1:3080/?token=...`，所以网关会用本机 `%DSH_HOME%\.credentials.yaml` 里的持久密钥自动签一个该会话 Cookie 并注入，无需人工配对。
- **国内优化首选 FRP**：需要先在 K8s/服务器部署 frps，公司电脑运行 `start-frp.bat`。
- **Cloudflare 次选**：运行 `start-remote.bat`，生成临时公网地址。
- **Tailscale 备用**：运行 `一键安装.bat`，手机安装 Tailscale 后访问。
- **保活**：网关由 `HarnessRemoteGateway` 计划任务在登录时自动启动；`watchdog.mjs`（可选，每 5 分钟）负责运行期掉线自愈——这两类故障都真实发生过：网关随 Harness 进程一起被杀、`frpc` 在服务端的注册悄悄失效（表现为 frp 自己的 404 页）。

## 🚀 快速开始

### 前置条件
- 电脑已装 [Node.js](https://nodejs.org)（LTS）。
- 电脑上 DeepSeek Harness 能正常运行（`dsh web` 可打开 `http://127.0.0.1:3080`）。

### 方案一：FRP 内网穿透（国内优化首选，用户自助注册）

1. 用手机或电脑浏览器打开注册页面：

```text
https://register.zhkjdream.com
```

2. 输入你的用户名（例如 `zhangsan`）和邀请码，点击注册。

3. 注册成功后页面会返回：
   - 专属访问域名，例如 `https://harness-zhangsan.zhkjdream.com`
   - 完整的 `frpc.toml` 配置
   - 这台电脑的网关访问令牌

4. 把返回的 `frpc.toml` 内容保存到本目录：

```text
F:\workspacecraftsmen\craftsmen\harnessapp\frpc.toml
```

5. 双击运行 `start-frp.bat`。  
   脚本会自动下载 `frpc.exe`（首次运行）、启动网关、连接 FRP 服务端。

6. 手机浏览器打开注册时分配的专属域名，输入返回的网关令牌，即可远程控制 Harness。

7. 建议双击一次 `安装自愈守护.bat`：注册一个每 5 分钟自检的计划任务，网关掉线自动拉起、FRP 隧道注册丢失（frp 的 404 页）自动重启 `frpc.exe`，日志见 `watchdog.log`。

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

可选字段（一般不用改）：

| 字段 | 说明 | 默认 |
| --- | --- | --- |
| `dshAuth` | 是否自动签发并注入 Harness 自己的会话 Cookie | `true` |
| `dshCredentialsPath` | Harness 凭据文件路径（内含会话签名密钥） | `%DSH_HOME%\.credentials.yaml` |

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

## 🩺 排查

**症状：手机点文件无法预览，右侧面板显示「文件资源服务不可用」**

这句提示来自 Harness 客户端：文件地址是 `dsh-resource://file/session/<会话>/<路径>`，而当前页面里**没有注册处理 `file` 协议的「文件资源」provider** —— 是**客户端插件状态掉了**，与隧道、令牌、权限都无关。对照验证：同一台机器上用一个全新浏览器走同一条 FRP 链路、点同一个文件是正常的（`node scratch/cdp-preview-flow.mjs` 可复现这条流程，视口按手机宽度 430px）。

- **立即恢复**：手机上刷新页面（下拉刷新，或把主屏图标关掉再打开）。
- **自动恢复**：网关注入的 `mobile.js` 会盯着预览区，一旦出现这句提示就自动刷新一次页面 —— 60 秒内不重复刷、最多自动刷 2 次，之后改成一个「点这里重新加载」的浮层按钮，不会陷入刷新循环；输入框里有未发送内容时不刷。
- **自愈脚本自测**：`node scratch/selfcheck-mobile-heal.mjs`（正常页面不刷、中英文提示各刷一次、刷够后只提示）。
- **看长连接**：`node scratch/selfcheck-sse.mjs 100` 观察 `/plugins/events` 这条 SSE 在每个链路段上的存活情况。

**症状：手机打开域名只看到一页英文**
`The page you requested was not found ... The server is powered by frp. Faithfully yours, frp.`

这不是网关/令牌的问题，而是 **frps 上这个域名当前没有已注册的代理**：请求到了 frp 服务端，但没找到对应隧道。典型原因是电脑上的 `frpc.exe` 还在运行（任务管理器看得到），但它在服务端的会话已经掉了（挂很久的"僵尸"连接、服务端重启过等），域名映射随之消失——TCP 显示 `Established` 并不代表隧道还有效。

- 一键修复：双击 **`restart-frpc.bat`**（结束旧 frpc → 检查网关 → 重建隧道）。
- 确认隧道：`frpc.log` 里应有 `login to server success` 与 `start proxy success`。
- 全链路自检（走公网）：`node scratch/selfcheck-public.mjs`。
- 两种"打不开"要分清：**frp 的 404 页** = 隧道没注册（重启 frpc）；**502/连不上** = 隧道在，但本机网关 8443 没跑（`start-frp.bat` / `start-gateway.bat`）。
- 不想每次都手动：`安装自愈守护.bat` 注册每 5 分钟自检，自动修这两类问题。

**症状：手机输入网关令牌后登录成功，页面却只显示一行英文**
`dsh web authentication required; reopen the URL printed by dsh web.`

这是 Harness（`dsh web`）自己那层认证没过：它只认「用启动时打印的 `?token=...` 换来的、按 Host 绑定的签名 Cookie」，而那个地址是电脑本机回环地址，手机打不开。正常情况网关会自动用本机 `%DSH_HOME%\.credentials.yaml` 里的持久密钥签一个并注入，出现这个提示说明密钥没读到。

排查步骤：
1. 看 `gateway.log` 里有没有 `DSH-AUTH 已签发 harness 会话 Cookie`；若是 `DSH-AUTH 未读到会话密钥`，检查 `%DSH_HOME%\.credentials.yaml` 里是否有 `client-connection/browser-session` 记录（`DSH_HOME` 默认 `C:\Users\<你>\.dsh`）。
2. 跑一次自检（分别验证页面、接口和 WebSocket 流）：

```bash
node scratch/selfcheck-gateway.mjs        # 期望：GET / 为 200 HTML；WS 打开 $events 流能收到 ready
```

3. 改完 `gateway.js` 必须重启网关（`start-gateway.bat` 或开机自启脚本），改动不会热加载。

**手机页面能开但一直转圈/反复重连**：看 `gateway.log` 的 `WS CLOSE(...)` 行。桥接层已处理两种常见原因：客户端握手后马上发出的第一帧会先缓存再补发（否则丢失后收不到 `ready`，表现为反复重连），以及二进制帧统一转成 text 帧转发（Harness 的流式通道只接受 text 帧）。

## 🛡 安全说明

- **零公网暴露**：没有公网入口，只有你 Tailscale 账号内的设备能访问。
- **零局域网暴露**：网关只监听 `127.0.0.1`。
- **双重认证**：Tailscale 设备身份 + 网关访问令牌。
- **建议**：把 `gateway.config.json` 里的 `token` 改成强随机串；不要分享账号和令牌。

## 📄 License

[MIT](LICENSE)

## 免责声明

本项目仅用于个人合法使用。请勿用于任何未经授权的访问或违反所在地法律的行为。
