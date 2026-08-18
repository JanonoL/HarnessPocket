// DeepSeek Harness 远程网关：安全的远程访问（控制）层。
// - 真认证：令牌登录 → 签名会话 Cookie（HttpOnly），登录失败限流。
// - 反向代理 HTTP + WebSocket 到本机 harness GUI（127.0.0.1:3080），重写 Host 通过 harness 的信任栅栏。
// - 向 harness 的 HTML 注入移动端 CSS/JS，让手机浏览器可用。
// 用法：node gateway.js   （配合 cloudflared / tailscale 等隧道暴露到公网）

import { createServer } from "node:http";
import { readFileSync, existsSync, appendFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash } from "node:crypto";
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
    const upWs = new WebSocket(targetUrl, {
      headers: { host: TARGET.host },
      origin: TARGET.protocol + "//" + TARGET.host
    });
    let closed = false;
    let upCount = 0;
    let downCount = 0;
    const startedAt = Date.now();
    const close = () => {
      if (closed) return;
      closed = true;
      gwLog(`WS CLOSE ${wsIp} ${req.url} after ${Date.now() - startedAt}ms down=${downCount} up=${upCount}`);
      try { clientWs.close(); } catch {}
      try { upWs.close(); } catch {}
    };
    upWs.on("open", () => {
      gwLog(`WS OPEN ${wsIp} ${req.url}`);
      clientWs.on("message", (data) => { downCount += 1; if (upWs.readyState === WebSocket.OPEN) upWs.send(data); });
      upWs.on("message", (data) => {
        upCount += 1;
        if (upCount === 1) gwLog(`WS FIRST_UP ${wsIp} ${req.url} type=${typeof data} isBuffer=${Buffer.isBuffer(data)}`);
        // DSH 浏览器客户端只接受 text 帧；ws 库可能收到 Buffer，必须转成 UTF-8 字符串再转发。
        let text;
        if (typeof data === "string") text = data;
        else if (Buffer.isBuffer(data)) text = data.toString("utf8");
        else if (data instanceof ArrayBuffer) text = Buffer.from(data).toString("utf8");
        else if (Array.isArray(data)) text = Buffer.concat(data.map((part) => Buffer.isBuffer(part) ? part : Buffer.from(part))).toString("utf8");
        else text = String(data);
        if (clientWs.readyState === WebSocket.OPEN) clientWs.send(text);
      });
      clientWs.on("close", close);
      upWs.on("close", close);
      clientWs.on("error", close);
      upWs.on("error", close);
    });
    upWs.on("error", close);
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
  lines.push("");
  lines.push("  本机验证: 打开 http://127.0.0.1:" + server.address().port + " 并用令牌登录。");
  lines.push("  国内优化首选: FRP 内网穿透（start-frp.bat）");
  lines.push("  次选: Cloudflare 隧道（start-remote.bat）");
  lines.push("  备用: Tailscale（tailscale-serve.bat）");
  lines.push("");
  console.log(lines.join("\n"));
});
