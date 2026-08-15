// DeepSeek Harness 移动端伴侣 App —— 只读后端服务。
// 提供：工作区/会话列表、会话 transcript、文件浏览与内容查看。
// 纯 Node 内置能力，无第三方依赖。安全：只读 + 可选访问令牌 + 文件路径限制在工作区根内。

import { createServer } from "node:http";
import { readFileSync, statSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces, homedir } from "node:os";
import { randomBytes } from "node:crypto";
import {
  decodeSessionBuffer,
  readSessionHeader,
  findSessionLogPath,
  loadWorkspaceIndex,
  sessionMetaFromCache,
  buildTranscript,
  listDirectory,
  resolveAllowedPath
} from "./lib/session.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, "public");
const CONFIG_PATH = join(__dirname, "config.json");

// ---------------------------------------------------------------------------
// 配置加载：config.json 优先，环境变量可覆盖。
// ---------------------------------------------------------------------------
function loadConfig() {
  let fileCfg = {};
  try {
    fileCfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    /* config.json 不存在则使用默认 */
  }
  const env = process.env;
  const cfg = {
    port: intOr(fileCfg.port, env.HARNESSAPP_PORT, 3090),
    host: env.HARNESSAPP_HOST || fileCfg.host || "0.0.0.0",
    accessToken: env.HARNESSAPP_TOKEN !== undefined ? env.HARNESSAPP_TOKEN : (fileCfg.accessToken ?? ""),
    dsHome: env.DSH_HOME || fileCfg.dsHome || join(homedir(), ".dsh"),
    extraRoots: Array.isArray(fileCfg.extraRoots) ? fileCfg.extraRoots : [],
    maxFileBytes: intOr(fileCfg.maxFileBytes, null, 2 * 1024 * 1024)
  };
  if (!cfg.accessToken) {
    cfg.accessToken = randomBytes(16).toString("base64url");
    try {
      writeFileSync(CONFIG_PATH, JSON.stringify({ port: cfg.port, host: cfg.host, accessToken: cfg.accessToken, extraRoots: cfg.extraRoots, maxFileBytes: cfg.maxFileBytes }, null, 2) + "\n");
    } catch { /* 只读环境则忽略 */ }
  }
  return cfg;
}

function intOr(a, b, def) {
  const v = b !== null && b !== undefined ? b : a;
  if (v === undefined || v === null || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

const config = loadConfig();

// ---------------------------------------------------------------------------
// 计算工作区根目录（文件浏览的允许范围）
// ---------------------------------------------------------------------------
function computeWorkspaceRoots() {
  const entries = [];
  try {
    const { workspaceDoc } = loadWorkspaceIndex(join(config.dsHome, "storages"));
    const ws = workspaceDoc?.tables?.workspaces || {};
    for (const key of Object.keys(ws)) {
      const p = ws[key].path;
      if (typeof p === "string" && existsSync(p)) entries.push({ path: resolve(p), updatedAt: ws[key].updatedAt || 0 });
    }
  } catch {
    /* ignore */
  }
  // 最近使用的工作区优先
  const ts = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? t : 0; };
  entries.sort((a, b) => ts(b.updatedAt) - ts(a.updatedAt));
  const roots = [];
  const seen = new Set();
  for (const e of entries) {
    if (!seen.has(e.path.toLowerCase())) { seen.add(e.path.toLowerCase()); roots.push(e.path); }
  }
  for (const r of config.extraRoots) {
    if (typeof r === "string" && existsSync(r)) {
      const abs = resolve(r);
      if (!seen.has(abs.toLowerCase())) { seen.add(abs.toLowerCase()); roots.push(abs); }
    }
  }
  if (roots.length === 0) roots.push(process.cwd());
  return roots;
}

const workspaceRoots = computeWorkspaceRoots();
const sessionsRoot = join(config.dsHome, "sessions");
const storagesDir = join(config.dsHome, "storages");

// ---------------------------------------------------------------------------
// 会话 API
// ---------------------------------------------------------------------------
function apiWorkspaces() {
  const { workspaceDoc, projDoc } = loadWorkspaceIndex(storagesDir);
  const workspaces = workspaceDoc?.tables?.workspaces || {};
  const result = [];
  for (const id of Object.keys(workspaces)) {
    const ws = workspaces[id];
    const sessions = [];
    for (const sid of ws.sessionIds || []) {
      const meta = sessionMetaFromCache(projDoc, sid) || {};
      const info = {
        id: sid,
        title: meta.title || null,
        goal: meta.goal || null,
        createdAt: meta.createdAt || null,
        cwd: meta.cwd || ws.path
      };
      if (info.createdAt == null) {
        try {
          const p = findSessionLogPath(sessionsRoot, sid);
          if (p) {
            const h = readSessionHeader(p);
            if (h?.createdAt != null) info.createdAt = h.createdAt;
          }
        } catch {
          /* ignore */
        }
      }
      sessions.push(info);
    }
    sessions.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    result.push({ id, path: ws.path, title: ws.title, sessionCount: sessions.length, sessions });
  }
  result.sort((a, b) => (b.sessions[0]?.createdAt || 0) - (a.sessions[0]?.createdAt || 0));
  return result;
}

function apiSession(sessionId) {
  const p = findSessionLogPath(sessionsRoot, sessionId);
  if (!p) return null;
  const buffer = readFileSync(p);
  const { header, events } = decodeSessionBuffer(buffer);
  const segments = buildTranscript(events);
  return {
    id: sessionId,
    header: {
      id: header?.id,
      createdAt: header?.createdAt,
      cwd: header?.cwd,
      agentPreset: header?.agentPreset,
      delegationDepth: header?.delegationDepth
    },
    segments,
    eventCount: events.length,
    segmentCount: segments.length,
    logPath: p
  };
}

// ---------------------------------------------------------------------------
// 文件 API
// ---------------------------------------------------------------------------
const BINARY_EXTS = new Set([".pdf", ".zip", ".gz", ".zstd", ".tar", ".7z", ".rar", ".exe", ".dll", ".woff", ".woff2", ".ttf", ".mp3", ".mp4", ".avi", ".mov", ".blend", ".docx", ".xlsx", ".pptx"]);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp"]);

function mimeOf(path) {
  const ext = extname(path).toLowerCase();
  const map = {
    ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8",
    ".yaml": "text/plain; charset=utf-8", ".yml": "text/plain; charset=utf-8",
    ".xml": "application/xml; charset=utf-8", ".svg": "image/svg+xml",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon", ".bmp": "image/bmp",
    ".pdf": "application/pdf", ".zip": "application/zip", ".gz": "application/gzip"
  };
  return map[ext] || "application/octet-stream";
}

function apiListDir(inputPath) {
  const abs = resolveAllowedPath(workspaceRoots, inputPath);
  if (!abs) return { error: "路径不在允许的工作区内", status: 403 };
  try {
    const st = statSync(abs);
    if (!st.isDirectory()) return { error: "不是目录", status: 400 };
  } catch {
    return { error: "目录不存在", status: 404 };
  }
  let parent = null;
  const rootCount = workspaceRoots.length;
  // 父目录：仅当仍在某个允许根内时暴露
  const candidateParent = dirname(abs);
  if (candidateParent !== abs) {
    for (const r of workspaceRoots) {
      const rr = resolve(r);
      if (candidateParent === rr || candidateParent.startsWith(rr.endsWith(sep) ? rr : rr + sep)) {
        parent = candidateParent;
        break;
      }
    }
  }
  return {
    path: abs,
    roots: workspaceRoots,
    parent,
    entries: listDirectory(abs)
  };
}

function apiFile(inputPath) {
  const abs = resolveAllowedPath(workspaceRoots, inputPath);
  if (!abs) return { error: "路径不在允许的工作区内", status: 403 };
  let st;
  try {
    st = statSync(abs);
  } catch {
    return { error: "文件不存在", status: 404 };
  }
  if (st.isDirectory()) return { error: "是目录", status: 400 };
  const ext = extname(abs).toLowerCase();
  const name = abs.split(/[\\/]/).pop();
  const isImage = IMAGE_EXTS.has(ext);
  const isBinary = BINARY_EXTS.has(ext);
  const mime = mimeOf(abs);
  const size = st.size;
  if (isImage) return { path: abs, name, size, image: true, mime, raw: true };
  if (isBinary) return { path: abs, name, size, binary: true, mime };
  if (size > config.maxFileBytes) return { path: abs, name, size, tooLarge: true, maxFileBytes: config.maxFileBytes };
  let content;
  try {
    content = readFileSync(abs, "utf8");
  } catch {
    return { path: abs, name, size, binary: true, mime };
  }
  return { path: abs, name, size, content, mime };
}

function apiRawFile(inputPath) {
  const abs = resolveAllowedPath(workspaceRoots, inputPath);
  if (!abs) return null;
  try {
    const st = statSync(abs);
    if (st.isDirectory()) return null;
    return { abs, st, mime: mimeOf(abs) };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// HTTP 工具
// ---------------------------------------------------------------------------
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}

function parseUrl(req) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    pathname = "/";
  }
  const u = new URL(req.url, "http://localhost");
  return { pathname, params: u.searchParams };
}

function authorized(req, params) {
  if (!config.accessToken) return true;
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ") && header.slice(7) === config.accessToken) return true;
  if (params.get("token") === config.accessToken) return true;
  return false;
}

// ---------------------------------------------------------------------------
// 静态文件服务（前端 SPA）
// ---------------------------------------------------------------------------
function serveStatic(pathname, res) {
  const rel = pathname === "/" ? "/index.html" : pathname;
  const safe = resolve(PUBLIC_DIR, "." + rel);
  if (safe !== PUBLIC_DIR && !safe.startsWith(PUBLIC_DIR + sep)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  let target = safe;
  try {
    if (statSync(target).isDirectory()) target = join(target, "index.html");
  } catch {
    target = join(PUBLIC_DIR, "index.html");
  }
  try {
    const data = readFileSync(target);
    const ext = extname(target).toLowerCase();
    const mime = ext === ".html" ? "text/html; charset=utf-8"
      : ext === ".js" || ext === ".mjs" ? "text/javascript; charset=utf-8"
      : ext === ".css" ? "text/css; charset=utf-8"
      : ext === ".svg" ? "image/svg+xml"
      : ext === ".webmanifest" ? "application/manifest+json"
      : ext === ".json" ? "application/json; charset=utf-8"
      : "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}

// ---------------------------------------------------------------------------
// 服务器
// ---------------------------------------------------------------------------
const server = createServer((req, res) => {
  const { pathname, params } = parseUrl(req);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // 非 API：静态前端
  if (!pathname.startsWith("/api/")) {
    if (req.method !== "GET") {
      res.writeHead(405);
      res.end("method not allowed");
      return;
    }
    serveStatic(pathname, res);
    return;
  }

  // API
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "method not allowed" });
    return;
  }
  if (!authorized(req, params)) {
    sendJson(res, 401, { error: "unauthorized", tokenRequired: true });
    return;
  }

  try {
    if (pathname === "/api/health") {
      sendJson(res, 200, { ok: true, app: "harnessapp", readOnly: true });
    } else if (pathname === "/api/config") {
      sendJson(res, 200, {
        tokenRequired: !!config.accessToken,
        host: config.host,
        port: server.address()?.port || config.port,
        dsHome: config.dsHome,
        workspaceRoots
      });
    } else if (pathname === "/api/workspaces") {
      sendJson(res, 200, { workspaces: apiWorkspaces() });
    } else if (pathname === "/api/sessions" || pathname.startsWith("/api/session/")) {
      const sid = pathname === "/api/sessions" ? params.get("id") : pathname.slice("/api/session/".length);
      if (!sid) {
        sendJson(res, 400, { error: "missing id" });
        return;
      }
      const data = apiSession(sid);
      if (!data) sendJson(res, 404, { error: "session not found" });
      else sendJson(res, 200, data);
    } else if (pathname === "/api/files") {
      const p = params.get("path") || workspaceRoots[0];
      const r = apiListDir(p);
      if (r.error) sendJson(res, r.status, { error: r.error });
      else sendJson(res, 200, r);
    } else if (pathname === "/api/file") {
      const p = params.get("path");
      if (!p) {
        sendJson(res, 400, { error: "missing path" });
        return;
      }
      const r = apiFile(p);
      if (r.error) sendJson(res, r.status, { error: r.error });
      else sendJson(res, 200, r);
    } else if (pathname === "/api/raw") {
      const p = params.get("path");
      if (!p) {
        sendJson(res, 400, { error: "missing path" });
        return;
      }
      const f = apiRawFile(p);
      if (!f) {
        sendJson(res, 404, { error: "not found" });
        return;
      }
      const data = readFileSync(f.abs);
      res.writeHead(200, { "Content-Type": f.mime, "Content-Length": f.st.size });
      res.end(data);
    } else {
      sendJson(res, 404, { error: "not found" });
    }
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(config.port, config.host, () => {
  const port = server.address().port;
  const lans = Object.values(networkInterfaces()).flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address);
  const lines = [];
  lines.push("");
  lines.push("  ┌──────────────────────────────────────────────────────────────┐");
  lines.push("  │  DeepSeek Harness 移动端伴侣 App（只读）                      │");
  lines.push("  └──────────────────────────────────────────────────────────────┘");
  lines.push(`  本机访问:   http://127.0.0.1:${port}`);
  for (const ip of lans) lines.push(`  手机访问:   http://${ip}:${port}`);
  lines.push(`  访问令牌:   ${config.accessToken}`);
  lines.push(`  数据目录:   ${config.dsHome}`);
  lines.push(`  文件根目录: ${workspaceRoots.join(" ; ")}`);
  lines.push("");
  lines.push("  手机与电脑需在同一局域网；用手机浏览器打开上面的「手机访问」地址，");
  lines.push("  输入访问令牌后即可使用。可在浏览器菜单选择「添加到主屏幕」安装为 App。");
  lines.push("");
  console.log(lines.join("\n"));
});

server.on("error", (err) => {
  console.error("服务器启动失败：", err.message);
  process.exitCode = 1;
});
