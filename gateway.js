// DeepSeek Harness 远程网关：安全的远程访问（控制）层。
// - 真认证：令牌登录 → 签名会话 Cookie（HttpOnly），登录失败限流。
// - 反向代理 HTTP + WebSocket 到本机 harness GUI（127.0.0.1:3080），重写 Host 通过 harness 的信任栅栏。
// - 自动代本机签出 harness（dsh web）自己的会话 Cookie 并注入，见下方「harness 会话 Cookie」小节。
// - 向 harness 的 HTML 注入移动端 CSS/JS，让手机浏览器可用。
// 用法：node gateway.js   （配合 cloudflared / tailscale / frp 等隧道暴露到公网）

import { createServer } from "node:http";
import { readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash, createHmac } from "node:crypto";
import { request as httpRequest } from "node:http";
import WebSocket, { WebSocketServer } from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, "gateway.config.json");
const LOG_PATH = join(__dirname, "gateway.log");

// 请求日志（写到 gateway.log，便于排查手机端卡在哪一步）
function gwLog(msg) {
  try {
    appendFileSync(LOG_PATH, `${new Date().toISOString()} ${msg}\n`);
  } catch {}
}

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------
function loadConfig() {
  let fileCfg = {};
  try { fileCfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8")); } catch {}
  const env = process.env;
  const cfg = {
    port: intOr(fileCfg.port, env.HARNESS_GW_PORT, 8443),
    host: env.HARNESS_GW_HOST || fileCfg.host || "127.0.0.1",
    target: env.HARNESS_GW_TARGET || fileCfg.target || "http://127.0.0.1:3080",
    token: env.HARNESS_GW_TOKEN || fileCfg.token || "",
    // harness（dsh web）自身的会话 Cookie 处理：auto = 用本机密钥自动签发并注入（默认）
    dshAuth: env.HARNESS_GW_DSH_AUTH ? env.HARNESS_GW_DSH_AUTH !== "0" : fileCfg.dshAuth !== false,
    // 本机 harness 凭据文件（内含会话签名密钥）；默认 %DSH_HOME%\.credentials.yaml
    dshCredentialsPath: env.HARNESS_GW_DSH_CREDENTIALS || fileCfg.dshCredentialsPath || "",
    sessionTtlMs: 30 * 24 * 3600 * 1000,
    loginRateLimit: 5,       // 每 IP 每窗口最多失败次数
    loginWindowMs: 15 * 60 * 1000
  };
  // 未配置令牌时自动生成一个持久化令牌（写回 config，保证重启后不变）
  if (!cfg.token) {
    cfg.token = randomBytes(16).toString("base64url");
    try {
      writeFileSync(CONFIG_PATH, JSON.stringify({ port: cfg.port, host: cfg.host, target: cfg.target, token: cfg.token }, null, 2) + "\n");
    } catch { /* 只读环境则忽略，令牌仅本次会话有效 */ }
  }
  return cfg;
}
function intOr(a, b, def) { const v = b ?? a; if (v === undefined || v === null || v === "") return def; const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : def; }

const config = loadConfig();
const TARGET = new URL(config.target);

// 移动端注入内容
const MOBILE_CSS = readFileSync(join(__dirname, "mobile.css"), "utf8");
const MOBILE_JS = readFileSync(join(__dirname, "mobile.js"), "utf8");

// ---------------------------------------------------------------------------
// 会话存储（内存）：登录成功后签发随机 session id
// ---------------------------------------------------------------------------
const sessions = new Map(); // sessionId -> expiresAt
function issueSession() {
  const id = randomBytes(24).toString("base64url");
  sessions.set(id, Date.now() + config.sessionTtlMs);
  return id;
}
function sessionValid(id) {
  const exp = sessions.get(id);
  if (!exp) return false;
  if (Date.now() > exp) { sessions.delete(id); return false; }
  return true;
}
const COOKIE_NAME = "harn_gw";

function cookieOf(req) {
  const h = req.headers.cookie || "";
  for (const part of h.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === COOKIE_NAME) return rest.join("=");
  }
  return null;
}

function authorized(req, url) {
  // 1) Cookie 会话
  const sid = cookieOf(req);
  if (sid && sessionValid(sid)) return true;
  // 2) 令牌（Authorization Bearer 或 ?token=）
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ") && timingSafeEqual(auth.slice(7), config.token)) return true;
  if (url.searchParams.get("token") === config.token) return true;
  return false;
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return ha.equals(hb);
}

// ---------------------------------------------------------------------------
// harness（dsh web）会话 Cookie：为什么必须有这一段
// ---------------------------------------------------------------------------
// dsh web 除了网关这层令牌登录外，自己还有一层「按 Host 绑定」的浏览器会话：
//   Cookie 名 = dsh-auth-<base64url(sha256(权威, 即 Host 头))>
//   Cookie 值 = v1.<base64url(载荷)>.<base64url(HMAC-SHA256(密钥, 载荷))>
// 正常途径是打开 dsh web 启动时打印的 http://127.0.0.1:3080/?token=... 换一次 Cookie，
// 但那个地址是电脑本机回环地址，手机永远打不开。于是手机过得了网关这层，却在
// dsh web 这层被拒，页面只显示一行英文：
//   dsh web authentication required; reopen the URL printed by dsh web.
// 解决：网关用本机 harness 凭据文件里的持久密钥，自己签一个「目标权威」的会话 Cookie，
// 覆盖客户端可能带来的同名旧 Cookie 后注入到上游。密钥持久存在，重启网关/重启 dsh web 都不用重新配对。
const DSH_COOKIE_PREFIX = "dsh-auth-";
const DSH_COOKIE_TTL_MS = 25 * 24 * 3600 * 1000;      // dsh 上限 30 天，这里取 25 天留余量
const DSH_COOKIE_REFRESH_MS = 6 * 3600 * 1000;        // 剩余不足 6 小时就重签
const DSH_HOME = process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || ".", ".dsh");
const DSH_CREDENTIALS_PATH = config.dshCredentialsPath || join(DSH_HOME, ".credentials.yaml");

function base64url(buf) {
  return Buffer.from(buf).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

// 读取 harness 持久会话密钥（client-connection/browser-session 记录）
function readDshSecret() {
  let yaml;
  try { yaml = readFileSync(DSH_CREDENTIALS_PATH, "utf8"); } catch { return null; }
  const m = /client-connection\/browser-session:[\s\S]*?secret:\s*([A-Za-z0-9_-]{20,})/u.exec(yaml);
  if (!m) return null;
  const text = m[1];
  const pad = "=".repeat((4 - (text.length % 4)) % 4);
  const secret = Buffer.from(text.replaceAll("-", "+").replaceAll("_", "/") + pad, "base64");
  return secret.byteLength === 32 ? secret : null;
}

let dshCookieCache = null;
let dshSecretWarned = false;

// 返回注入用的 Cookie 片段（形如 name=value），不可用时返回 null
function dshSessionCookie() {
  if (!config.dshAuth) return null;
  const now = Date.now();
  if (dshCookieCache && dshCookieCache.expiresAt - now > DSH_COOKIE_REFRESH_MS) return dshCookieCache;
  const secret = readDshSecret();
  if (secret === null) {
    if (!dshSecretWarned) {
      dshSecretWarned = true;
      gwLog(`DSH-AUTH 未读到会话密钥（${DSH_CREDENTIALS_PATH}），将只做普通转发；若手机端只看到 "dsh web authentication required" 就是这里没读到`);
    }
    return null;
  }
  const authority = TARGET.host;   // 网关改写后的 Host 头，dsh web 就是按它校验
  const name = DSH_COOKIE_PREFIX + base64url(createHash("sha256").update(authority).digest());
  const expiresAt = now + DSH_COOKIE_TTL_MS;
  const body = base64url(Buffer.from(JSON.stringify({ version: 1, authority, issuedAt: now, expiresAt }), "utf8"));
  const value = `v1.${body}.${base64url(createHmac("sha256", secret).update(body).digest())}`;
  dshCookieCache = { name, expiresAt, header: `${name}=${value}` };
  dshSecretWarned = false;
  gwLog(`DSH-AUTH 已签发 harness 会话 Cookie（authority=${authority}，有效至 ${new Date(expiresAt).toISOString()}）`);
  return dshCookieCache;
}

// 换掉客户端带来的同名/同前缀旧 Cookie：dsh 只认 Cookie 头里第一个匹配的名字
function stripDshCookies(cookieHeader) {
  if (typeof cookieHeader !== "string" || cookieHeader === "") return "";
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part !== "" && !part.startsWith(DSH_COOKIE_PREFIX))
    .join("; ");
}

// 就地改写转发用的请求头：注入 harness 会话 Cookie
function injectDshCookie(headers) {
  const cookie = dshSessionCookie();
  if (cookie === null) return;
  const rest = stripDshCookies(headers.cookie);
  headers.cookie = rest === "" ? cookie.header : `${rest}; ${cookie.header}`;
}

// 上游明确 401 说明签名/密钥对不上了，丢弃缓存下次请求重签
function onDshUnauthorized(statusCode) {
  if (statusCode === 401 && dshCookieCache !== null) {
    gwLog("DSH-AUTH 上游返回 401，丢弃缓存，下次请求重新签发");
    dshCookieCache = null;
  }
}

// ---------------------------------------------------------------------------
// 登录限流（按 IP）
// ---------------------------------------------------------------------------
const loginAttempts = new Map(); // ip -> { count, windowStart }
function rateLimited(ip) {
  const now = Date.now();
  let rec = loginAttempts.get(ip);
  if (!rec || now - rec.windowStart > config.loginWindowMs) {
    rec = { count: 0, windowStart: now };
    loginAttempts.set(ip, rec);
  }
  rec.count += 1;
  return rec.count > config.loginRateLimit;
}

// ---------------------------------------------------------------------------
// 登录页
// ---------------------------------------------------------------------------
function loginPageHtml(error) {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>Harness 远程登录</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; background: #0d0f17; color: #e6e8f0; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .card { background: #141724; border: 1px solid #262b3d; border-radius: 16px; padding: 28px 24px; width: min(92vw, 360px); }
  h1 { font-size: 20px; margin: 0 0 6px; }
  p { color: #9aa0b4; font-size: 13.5px; margin: 0 0 18px; }
  input { width: 100%; padding: 12px 14px; font-size: 16px; background: #1b1f30; border: 1px solid #262b3d; border-radius: 10px; color: #e6e8f0; outline: none; }
  input:focus { border-color: #5b8cff; }
  button { width: 100%; margin-top: 14px; padding: 12px; font-size: 16px; font-weight: 600; border: none; border-radius: 10px; background: #5b8cff; color: #fff; cursor: pointer; }
  button:active { opacity: .85; }
  .err { color: #ff6b6b; font-size: 13px; margin-bottom: 10px; }
</style></head>
<body>
  <div class="card">
    <h1>Harness 远程访问</h1>
    <p>请输入访问令牌（电脑端网关启动时打印的令牌）。</p>
    ${error ? `<div class="err">${error}</div>` : ""}
    <form method="post" action="/__gw_login">
      <input type="password" name="token" placeholder="访问令牌" autocomplete="off" autofocus>
      <button type="submit">进入</button>
    </form>
  </div>
</body></html>`;
}

// ---------------------------------------------------------------------------
// HTML 注入：在 </head> 前插入移动端 CSS/JS
// ---------------------------------------------------------------------------
function injectMobile(html) {
  if (process.env.HARNESS_GW_NO_INJECT === "1") return html;
  const tag = `<style data-harn-gw>${MOBILE_CSS}</style><script data-harn-gw>${MOBILE_JS}</script>`;
  if (html.includes("</head>")) return html.replace("</head>", tag + "</head>");
  if (html.includes("</HEAD>")) return html.replace("</HEAD>", tag + "</HEAD>");
  return tag + html;
}

// ---------------------------------------------------------------------------
// HTTP 反向代理
// ---------------------------------------------------------------------------
function proxyHttp(req, res, bodyBuffer) {
  const headers = { ...req.headers };
  headers.host = TARGET.host; // 重写 Host 以通过 harness 信任栅栏
  // 重写 Origin / Referer，使其与重写后的 Host 同源，否则 harness 信任栅栏会 403
  const targetOrigin = TARGET.protocol + "//" + TARGET.host;
  if (headers.origin !== undefined) headers.origin = targetOrigin;
  if (headers.referer !== undefined && /^https?:\/\//i.test(headers.referer)) headers.referer = targetOrigin + "/";
  delete headers["content-length"]; // 由 Node 重新计算
  // 注入 harness（dsh web）自己的会话 Cookie，否则上游只回一行 "dsh web authentication required"
  injectDshCookie(headers);
  // 仅对 HTML 请求禁用压缩（便于注入移动端 CSS/JS）；JS/CSS/图片/API 保留压缩，远端加载更快。
  const pathname = req.url.split("?")[0].split("#")[0];
  const isHtmlPath = pathname === "/" || pathname.endsWith("/") || /\.html?$/i.test(pathname);
  if (isHtmlPath) {
    headers["accept-encoding"] = "identity";
  }

  const proxyReq = httpRequest({
    host: TARGET.hostname,
    port: TARGET.port || 80,
    path: req.url,
    method: req.method,
    headers
  }, (proxyRes) => {
    onDshUnauthorized(proxyRes.statusCode);
    const contentType = proxyRes.headers["content-type"] || "";
    const isHtml = /text\/html/.test(contentType);
    const isEventStream = /text\/event-stream/.test(contentType);

    // SSE（text/event-stream）：必须流式转发，不能缓冲（长连接）。
    if (isEventStream) {
      const outHeaders = { ...proxyRes.headers };
      delete outHeaders["content-length"];
      res.writeHead(proxyRes.statusCode || 200, outHeaders);
      proxyRes.pipe(res);
      res.on("close", () => { if (!res.writableEnded) proxyReq.destroy(); });
      return;
    }

    // 其余（HTML/JS/CSS/JSON/图片等）：缓冲后一次性返回（带 content-length，兼容性最好）。
    const chunks = [];
    proxyRes.on("data", (c) => chunks.push(c));
    proxyRes.on("end", () => {
      let body = Buffer.concat(chunks);
      if (isHtml && body.length > 0) body = Buffer.from(injectMobile(body.toString("utf8")));
      const outHeaders = { ...proxyRes.headers };
      delete outHeaders["content-length"];
      delete outHeaders["transfer-encoding"];
      outHeaders["content-length"] = body.length;
      res.writeHead(proxyRes.statusCode || 200, outHeaders);
      res.end(body);
    });
    proxyRes.on("error", () => { try { res.destroy(); } catch {} });
  });
  proxyReq.on("error", (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("网关转发失败: " + err.message);
    } else {
      try { res.destroy(); } catch {}
    }
  });
  if (bodyBuffer) proxyReq.end(bodyBuffer);
  else proxyReq.end();
}

// ---------------------------------------------------------------------------
// 服务器
// ---------------------------------------------------------------------------
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0].trim();
  const authed = authorized(req, url);

  // 登录
  if (url.pathname === "/__gw_login" && req.method === "POST") {
    if (rateLimited(ip)) {
      gwLog(`LOGIN ${ip} -> 429 限流`);
      res.writeHead(429, { "Content-Type": "text/html; charset=utf-8" });
      res.end(loginPageHtml("尝试次数过多，请稍后再试。"));
      return;
    }
    let body = "";
    req.on("data", (c) => { if (body.length < 4096) body += c; });
    req.on("end", () => {
      const params = new URLSearchParams(body);
      const token = params.get("token") || "";
      if (timingSafeEqual(token, config.token)) {
        loginAttempts.delete(ip);
        const sid = issueSession();
        gwLog(`LOGIN ${ip} -> 成功, token正确, 发会话`);
        res.writeHead(302, {
          "Location": "/",
          "Set-Cookie": `${COOKIE_NAME}=${sid}; HttpOnly; Path=/; Max-Age=${Math.floor(config.sessionTtlMs / 1000)}; SameSite=Lax`
        });
        res.end();
      } else {
        gwLog(`LOGIN ${ip} -> 401 令牌错误 (收到 "${token.slice(0, 4)}...")`);
        res.writeHead(401, { "Content-Type": "text/html; charset=utf-8" });
        res.end(loginPageHtml("令牌错误，请重试。"));
      }
    });
    return;
  }

  // 登出
  if (url.pathname === "/__gw_logout" && req.method === "POST") {
    const sid = cookieOf(req);
    if (sid) sessions.delete(sid);
    res.writeHead(302, { "Location": "/", "Set-Cookie": `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0` });
    res.end();
    return;
  }

  // 无需登录即可访问的静态元数据（浏览器/PWA 会自动请求，401 会产生无害报错）
  const PUBLIC_GET_PATHS = new Set([
    "/manifest.webmanifest",
    "/favicon.svg",
    "/favicon.ico",
    "/robots.txt"
  ]);
  if (!authed && req.method === "GET" && PUBLIC_GET_PATHS.has(url.pathname)) {
    gwLog(`PUBLIC ${ip} ${req.method} ${url.pathname}`);
    proxyHttp(req, res, null);
    return;
  }

  // 未认证：仅展示登录页（或对 API 返回 401）
  if (!authed) {
    gwLog(`UNAUTH ${ip} ${req.method} ${url.pathname} -> ${req.method === "GET" && (url.pathname === "/" || url.pathname === "") ? "登录页" : "401"}`);
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(loginPageHtml(""));
    } else {
      res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "unauthorized" }));
    }
    return;
  }

  // 已认证：缓冲请求体后代理
  gwLog(`AUTH ${ip} ${req.method} ${url.pathname}`);
  const chunks = [];
  let bodySize = 0;
  req.on("data", (c) => { bodySize += c.length; if (bodySize <= 160 * 1024 * 1024) chunks.push(c); });
  req.on("end", () => proxyHttp(req, res, chunks.length ? Buffer.concat(chunks) : null));
  req.on("error", () => { try { res.destroy(); } catch {} });
});

// ---------------------------------------------------------------------------
// WebSocket 反向代理（/api/events.mux 与 /api/events.host 等）
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://localhost");
  if (!authorized(req, url)) {
    gwLog(`WS UNAUTH ${req.url}`);
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  const wsIp = (req.headers["x-forwarded-for"] || socket.remoteAddress || "").toString().split(",")[0].trim();
  gwLog(`WS UPGRADE ${wsIp} ${req.url}`);
  wss.handleUpgrade(req, socket, head, (clientWs) => {
    const targetUrl = `${TARGET.protocol === "https:" ? "wss" : "ws"}://${TARGET.host}${req.url}`;
    // WebSocket 同样要带 harness 会话 Cookie（客户端带来的 Cookie 一并转发，便于未来上游扩展）
    const upHeaders = { host: TARGET.host, cookie: req.headers.cookie || "" };
    injectDshCookie(upHeaders);
    const upWs = new WebSocket(targetUrl, {
      headers: upHeaders,
      origin: TARGET.protocol + "//" + TARGET.host
    });
    let closed = false;
    let upCount = 0;
    let downCount = 0;
    const pending = [];   // 上游握手完成前收到的客户端帧
    const startedAt = Date.now();
    // DSH 的流式通道只接受 text 帧（上游收到二进制帧会以 1003 关闭），两个方向都要转成 UTF-8 字符串。
    const asText = (data) => {
      if (typeof data === "string") return data;
      if (Buffer.isBuffer(data)) return data.toString("utf8");
      if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
      if (Array.isArray(data)) return Buffer.concat(data.map((part) => Buffer.isBuffer(part) ? part : Buffer.from(part))).toString("utf8");
      return String(data);
    };
    const close = (side, code, reason) => {
      if (closed) return;
      closed = true;
      const text = reason === undefined || reason === null || reason.length === 0 ? "" : ` reason=${reason.toString()}`;
      gwLog(`WS CLOSE(${side}) ${wsIp} ${req.url} code=${code}${text} after ${Date.now() - startedAt}ms down=${downCount} up=${upCount}`);
      try { clientWs.close(); } catch {}
      try { upWs.close(); } catch {}
    };
    const fail = (side, err) => {
      gwLog(`WS ERROR(${side}) ${wsIp} ${req.url} ${err.message}`);
      close(`${side}-error`, 1006, err.message);
    };
    upWs.on("open", () => {
      gwLog(`WS OPEN ${wsIp} ${req.url}`);
      const queued = pending.length;
      for (const frame of pending) if (upWs.readyState === WebSocket.OPEN) upWs.send(frame);
      pending.length = 0;
      if (queued > 0) gwLog(`WS FLUSH ${wsIp} ${req.url} 补发握手期间缓存的 ${queued} 帧`);
      upWs.on("message", (data, isBinary) => {
        upCount += 1;
        if (upCount === 1) gwLog(`WS FIRST_UP ${wsIp} ${req.url} isBinary=${isBinary} isBuffer=${Buffer.isBuffer(data)}`);
        if (clientWs.readyState === WebSocket.OPEN) clientWs.send(asText(data));
      });
      upWs.on("close", (code, reason) => close("upstream", code, reason));
      upWs.on("error", (err) => fail("upstream", err));
    });
    // 客户端消息监听必须立刻挂上：上游握手是异步的，早到的帧先缓存，否则会被静默丢掉
    // （DSH 客户端握手后马上发第一条 open 帧，丢了就一直等不到 ready，表现为反复重连）。
    clientWs.on("message", (data, isBinary) => {
      downCount += 1;
      if (downCount === 1) gwLog(`WS FIRST_DOWN ${wsIp} ${req.url} isBinary=${isBinary}`);
      const frame = asText(data);
      if (upWs.readyState === WebSocket.OPEN) upWs.send(frame);
      else if (upWs.readyState === WebSocket.CONNECTING) pending.push(frame);
    });
    clientWs.on("close", (code, reason) => close("client", code, reason));
    clientWs.on("error", (err) => fail("client", err));
    upWs.on("close", (code, reason) => close("upstream", code, reason));
    upWs.on("error", (err) => fail("upstream", err));
  });
});

server.on("error", (err) => {
  console.error("网关启动失败：", err.message);
  process.exitCode = 1;
});

server.listen(config.port, config.host, () => {
  const lines = [];
  lines.push("");
  lines.push("  ┌──────────────────────────────────────────────────────────────┐");
  lines.push("  │  DeepSeek Harness 远程网关（远程控制 + 令牌认证）            │");
  lines.push("  └──────────────────────────────────────────────────────────────┘");
  lines.push(`  监听地址:   http://${config.host}:${server.address().port}`);
  lines.push(`  转发目标:   ${config.target}`);
  lines.push(`  访问令牌:   ${config.token}`);
  lines.push(`  harness 会话: ${config.dshAuth ? (dshSessionCookie() === null ? "未读到密钥（将只做普通转发）" : "已自动签发并注入") : "已关闭自动注入"}`);
  lines.push("");
  lines.push("  本机验证: 打开 http://127.0.0.1:" + server.address().port + " 并用令牌登录。");
  lines.push("  国内优化首选: FRP 内网穿透（start-frp.bat）");
  lines.push("  次选: Cloudflare 隧道（start-remote.bat）");
  lines.push("  备用: Tailscale（tailscale-serve.bat）");
  lines.push("");
  console.log(lines.join("\n"));
});
