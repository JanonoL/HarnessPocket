// Harness 远程通道自愈守护：检查「本机网关」和「FRP 隧道注册」两处，坏了就自动拉起。
// 用法：node watchdog.mjs        （建议挂计划任务每 5 分钟跑一次：双击「安装自愈守护.bat」）
// 设计取舍：
//   - 只做能确定判断的修复：8443 没监听 → 拉起网关；公网域名返回 frp 自己的 404 页 → 重启 frpc。
//   - 公网不通 / 502 这类可能是网络或服务端问题时，只记日志不乱重启，避免把正常状态搞坏。
//   - 1 小时内最多重启 3 次，超过就只记日志，等人工介入。
import { readFileSync, appendFileSync, existsSync, openSync, statSync, renameSync, writeFileSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { connect } from "node:net";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const LOG = join(DIR, "watchdog.log");
const STATE = join(DIR, "watchdog.state.json");
const GATEWAY_CONFIG = join(DIR, "gateway.config.json");
const FRPC_TOML = join(DIR, "frpc.toml");
const FRPC_LOG = join(DIR, "frpc.log");
const MAX_ACTIONS_PER_HOUR = 3;

function log(msg) {
  const line = `${new Date().toISOString()} ${msg}`;
  try { appendFileSync(LOG, line + "\n"); } catch {}
  console.log(line);
}
function rotateLog() {
  try { if (existsSync(LOG) && statSync(LOG).size > 512 * 1024) renameSync(LOG, `${LOG}.1`); } catch {}
}
function readJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return {}; }
}
// frpc.toml 里第一条 customDomains
function domainFromFrpcToml() {
  try {
    const text = readFileSync(FRPC_TOML, "utf8");
    const list = /customDomains\s*=\s*\[([^\]]*)\]/u.exec(text);
    return list === null ? null : (/["']([^"']+)["']/u.exec(list[1])?.[1] ?? null);
  } catch { return null; }
}
function listening(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    const settle = (value) => { try { socket.destroy(); } catch {} resolve(value); };
    socket.setTimeout(2000, () => settle(false));
    socket.once("connect", () => settle(true));
    socket.once("error", () => settle(false));
  });
}
// 限流：同一类动作 1 小时内最多 3 次
function actionAllowed(kind) {
  const now = Date.now();
  const state = readJson(STATE);
  const recent = (Array.isArray(state[kind]) ? state[kind] : []).filter((at) => now - at < 3600_000);
  if (recent.length >= MAX_ACTIONS_PER_HOUR) return false;
  recent.push(now);
  try { writeFileSync(STATE, JSON.stringify({ ...state, [kind]: recent }, null, 2)); } catch {}
  return true;
}
function startGateway(port) {
  spawn(process.execPath, [join(DIR, "gateway.js")], { cwd: DIR, detached: true, stdio: "ignore", windowsHide: true }).unref();
  log(`ACTION 网关未监听 ${port}，已重新拉起 gateway.js`);
}
function restartFrpc() {
  try { execFileSync("taskkill", ["/f", "/im", "frpc.exe"], { stdio: "ignore", windowsHide: true }); } catch {}
  const out = openSync(FRPC_LOG, "a");
  spawn(join(DIR, "frpc.exe"), ["-c", "frpc.toml"], { cwd: DIR, detached: true, stdio: ["ignore", out, out], windowsHide: true }).unref();
  log("ACTION 公网域名没有已注册的 FRP 代理（frp 返回自己的 404 页），已重启 frpc.exe");
}
async function probe(domain) {
  try {
    const res = await fetch(`https://${domain}/`, { redirect: "manual", signal: AbortSignal.timeout(15000) });
    const body = res.status === 404 ? await res.text() : "";
    // frps 自己的 404 页正文里 "frp" 是带链接的，所以认 fatedier/frp 这个特征串
    return { status: res.status, frpNotFound: res.status === 404 && /fatedier\/frp|Faithfully yours/iu.test(body) };
  } catch (error) {
    return { status: 0, error: error.message };
  }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

rotateLog();
const config = readJson(GATEWAY_CONFIG);
const port = Number(config.port) || 8443;
const domain = process.env.WATCHDOG_TEST_DOMAIN || domainFromFrpcToml();
const report = [];

// ---- 1. 本机网关 ----
if (!(await listening(port))) {
  if (actionAllowed("gateway")) {
    startGateway(port);
    await sleep(2500);
  } else {
    log(`SKIP 网关 1 小时内已拉起 ${MAX_ACTIONS_PER_HOUR} 次，不再重试`);
  }
}
report.push(`网关:${await listening(port) ? "在跑" : "未监听"}`);

// ---- 2. FRP 隧道 ----
if (domain === null) {
  log("SKIP frpc.toml 里没解析到 customDomains，跳过隧道检查");
} else {
  const first = await probe(domain);
  report.push(`公网(${domain}):${first.status === 0 ? "不可达" : first.status}`);
  if (first.frpNotFound) {
    if (actionAllowed("frpc")) {
      restartFrpc();
      await sleep(6000);
      const second = await probe(domain);
      report.push(`重启隧道后:${second.status === 0 ? "不可达" : second.status}`);
      if (second.frpNotFound) log("WARN 重启 frpc 后仍是 frp 的 404 页，可能是服务端/域名侧问题，请人工检查 frpc.toml 与注册信息");
    } else {
      log(`SKIP 重启 frpc 1 小时内已达 ${MAX_ACTIONS_PER_HOUR} 次，请人工检查 frpc.toml / 服务端注册`);
    }
  } else if ([502, 503, 504].includes(first.status)) {
    log(`WARN 公网返回 ${first.status}：隧道在，但后端（网关 ${port}）不通`);
  } else if (first.status === 0) {
    log(`WARN 公网不可达（可能是本机断网/DNS）：${first.error}`);
  }
}

log(`CHECK ${report.join(" ")}`);
