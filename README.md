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

**症状：手机点文件无法预览，右侧面板显示「文件资源服务不可用」（图片则是一片空白）**

**根因（已定位并修复）**：不是插件坏了，是**手机内核的 URL 解析**。文件地址形如 `dsh-resource://file/session/<会话>/<路径>`，Harness 客户端靠它的 hostname 找 provider：

```js
// dsh-client-resources/lib/client.js
const parsed = new URL(address);
if (parsed.protocol !== `dsh-resource:`) return void 0;
return parsed.hostname === "" ? void 0 : parsed.hostname.toLowerCase();   // ← 就是这里
```

| 环境 | `new URL("dsh-resource://file/session/s1/a/b.txt")` |
| --- | --- |
| 正统 Chromium（桌面 Chrome/Edge） | `hostname=file`，`pathname=/session/s1/a/b.txt` |
| 华为浏览器 ArkWeb（HarmonyOS） | `hostname=`（空），`pathname=//file/session/s1/a/b.txt` |

ArkWeb 对**自定义 scheme 不解析 authority**，于是 hostname 为空 → `protocolOf()` 返回 `undefined` → 找不到 `file` provider → 文本/图片/PDF 预览全部变成「文件资源服务不可用」（图片更是整块空白，连提示都没有），刷新也不会好。这也是为什么"更新 dsh"没用：插件本身一直是加载并 apply 的（`client.log` 的探针可见 `loaded=58 applied=57`），坏的是地址到 provider 的那一步映射。

网关注入的 `mobile.js` 现在做五层处理：

0. **URL 解析补齐（根因修复）**：检测到内核把 `dsh-resource://` 的 host 解析成空时，接管 `URL.prototype` 的 `host` / `hostname` / `pathname` 三个取值，从 `href` 里把 authority 切回来（内核正常时**完全不介入**）。修复后原生预览恢复：Markdown/代码/图片/PDF/Office 都回到 harness 自己的预览器，还能跟随文件变化自动刷新。验证：

   ```bash
   node scratch/cdp-arkweb-url-shim.mjs   # 用 CDP 模拟 ArkWeb 缺陷 → 对照组必须坏，注入后必须好
   ```
   实测：对照组 `hostname=`+`pathname=//file/...`（与手机上报的原样一致），注入后 `hostname=file`，点开真实 Markdown 文件后预览区 `state=text`、渲染器 `…/documentpreview/markdown`、正文 4135 字符、无「文件资源服务不可用」。
1. **网关兜底预览**（根因修复失效时的保险，也是**视频唯一的看法**）：原生预览给不出内容时，网关直接读文件并画进一个**整屏浮层**（右上角「✕ 关闭」，避免被原界面的零高度容器裁掉）。三类文件三种画法：

   | 类型 | 上限 | 画法 |
   | --- | --- | --- |
   | 文本 / 代码 / Markdown | 2 MB | JSON 文本，`<pre>` 渲染 |
   | 图片 / PDF | 20 MB | `raw=1` 原始字节，`<img>` / `<iframe>` 交给浏览器 |
   | 视频 / 音频 | 512 MB | `raw=1` **流式 + Range（206）**，`<video controls>` 播放、可拖进度条 |

   触发条件（任一命中即兜底）：
   - **harness 自己挂的失败标记**：预览区里出现 `data-textpreview-unsupported`（该类型没有预览器，**视频就是这一类**）、`data-textpreview-failed` / `data-textpreview-meta-failed`（读取或元数据失败）。
   - **状态区文案**：`文件资源服务不可用`、`预览器 X 不可用`、`文件不存在`、`读取失败：`（中英文都认）。**只扫状态区、不扫文件正文**——否则一份正文里正好写着这些词的文件（比如本项目的 README）会把自己误判成故障、白弹一个浮层。
   - **空白渲染器**：预览区已经选中了渲染器（`data-document-preview`）却整块空白、连提示文案都没有。这是 **provider 找不到时图片/PDF 的真实形态**，也是"看不到图片"的原因；为避免误伤加载慢的大图，连续空白 2.5 秒才判定，且兜底后 8 秒内若原生渲染自己画出来了，浮层会自动收起。

   路径线索依次是预览区的 `data-textpreview-url`、**点击文件行时记下的 `data-files-path`**、面板目录 + 标题相对路径。只允许会话工作区内的文件，拒绝 `../` 穿越。成功后 `client.log` 记一条 `网关兜底预览成功`。

   > **视频为什么必须走兜底**：Harness 客户端**根本没有视频预览器**（`dsh-client-ui-sidebar-documentpreview` 只注册了 Office/表格/Markdown/代码/图片/PDF/HTML/纯文本），所以任何浏览器上点 `.mp4` 都只会显示「该格式文件暂时无法预览」。现在这条兜底把视频交给浏览器原生播放器，桌面端走网关访问时同样有效。
   >
   > **播放器怎么用**：手机浏览器一律**禁止「有声自动播放」**，所以兜底播放器**先静音自动播放**把画面放出来（这才是"能不能看"的关键），要声音点浮层里的「🔊 开启声音」，还有「⛶ 全屏」。状态行实时显示 `正在加载… / 已就绪 30s 640x480 / ▶ 正在播放 / 播放失败 code=X`；**只有真的失败**（或不支持该编码）才把直链摆出来，长按可用系统播放器打开。另外补了 `x5-playsinline` / `x5-video-player-type=h5`，避免被部分国产内核劫持到它自己的全屏播放器里（那种情况经常只剩黑屏）。
   >
   > 视频能播的前提是**网关的 Range 支持**：很多 mp4（例如本机 ffmpeg 默认输出）`moov` 在文件尾部，浏览器必须能取到那一段才能起播。已验证公网链路（HTTPS + FRP）同样返回 `206 + Content-Range`。
2. **老内核兜底**：补齐 `Promise.withResolvers`、`AbortSignal.timeout`、`throwIfAborted`、`Object.hasOwn`、`Array/String.prototype.at`。
3. **客户端插件探针**：Harness 的客户端插件以内联模块注册（`window.__ModuleLoader__.load({ id, factory })`），工厂抛错、或插件的 `apply` 因为依赖服务没就绪而压根没被调用时，**页面不会有任何报错**，只表现为某个 provider 静默缺失。注入脚本会包裹这个加载器，把 `loaded` / `applied` / `issues` 以及**关键插件名单**随诊断上报，例如：

   ```text
   plugins = loaded=58 applied=57 key=[client-modules,api-workspace-files,client-resources,client-ui-sidebar-documentpreview]
   ```
4. **诊断上报**：客户端报错、UA、API 探测结果回传网关 `client.log`（`POST /__gw_clientlog`，限频 30 条/分钟）。除原有探针外还上报：`urlProbe`（内核怎么解析 `dsh-resource://` 地址 —— provider 就是按它的 hostname 找的）、`docPreview`（预览区渲染器与 body 状态）、`gwMedia`（兜底浮层里媒体加载结果）、`plugins`（插件探针）。手机上看不到 console，靠这个定位。

> ⚠️ **注入顺序很重要**：`gateway.js` 把 `mobile.js` 注入在 `<head>` 的**最前面**（harness 的引导脚本 `window.__ModuleLoader__` 就在 `<head>` 开头，偏移约 200 字节）。以前注入在 `</head>` 前（约 34 KB 处），等于在应用代码之后才执行 —— 老内核 API 补齐赶不上、插件探针一个 `load()` 都抓不到、URL 解析补齐也会来不及。

自测：

```bash
node scratch/cdp-phone-acceptance.mjs   # 手机验收：模拟 ArkWeb 缺陷下真点 文本/图片/视频，三项都必须能看
node scratch/cdp-arkweb-url-shim.mjs    # 根因链路：模拟 ArkWeb 解析缺陷 → 原生预览恢复
node scratch/cdp-media-fallback.mjs     # 视频兜底（<video> 播放 + 拖动）+ 图片空白面板兜底 + Range(206)
node scratch/cdp-video-play-check.mjs "F:\\path\\video.mp4"   # 指定视频走网关能不能真起播（含 moov 在尾部的 mp4）
node scratch/cdp-fallback-check.mjs     # 模拟 provider 缺失 → 兜底预览把文本和图片画回来
node scratch/selfcheck-mobile-heal.mjs  # 自愈/兜底/老内核补齐 五个场景
node scratch/selfcheck-sse.mjs 100      # /plugins/events 长连接存活
```

> `cdp-phone-acceptance.mjs` / `cdp-media-fallback.mjs` 需要 `scratch/gw-test.png`（200x120）和 `scratch/gw-test.mp4`（3 秒）两个素材；
> 验收脚本会自己把它们临时布点到「界面可能打开的那些会话工作区」里，跑完自动删除，不会留残留。

> ⚠️ `mobile.js` / `mobile.css` 和 `gateway.js` 一样，**只在网关启动时读一次**，改完必须重启网关（`start-gateway.bat` 或 `start-gateway-hidden.vbs`）。

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
