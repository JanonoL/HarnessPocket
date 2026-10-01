// 验证「URL 解析补齐」这条根因链路：
// 1) 用 CDP 在页面脚本之前注入一段「模拟华为 ArkWeb 解析缺陷」的补丁
//    （自定义 scheme 不解析 authority：hostname="" 且 pathname="//file/..."）；
// 2) 打开走网关的 harness 页面，看注入的 mobile.js 是否把 URL 解析补齐回来，
//    以及预览区能不能恢复成原生预览（不再是「文件资源服务不可用」）。
// 用法：node scratch/cdp-arkweb-url-shim.mjs [--no-emulate]
import { spawn } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BROWSERS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
];
const PORT = 9338;
const cfg = JSON.parse(readFileSync(new URL("../gateway.config.json", import.meta.url), "utf8"));
const base = `http://127.0.0.1:${cfg.port}`;
const profile = mkdtempSync(join(tmpdir(), "dsh-arkweb-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const emulate = !process.argv.includes("--no-emulate");

// 模拟 ArkWeb：非 special scheme 时 host/hostname 为空、pathname 自带 "//host" 前缀
const ARKWEB_EMULATION = `(() => {
  const dHost = Object.getOwnPropertyDescriptor(URL.prototype, 'host');
  const dHostname = Object.getOwnPropertyDescriptor(URL.prototype, 'hostname');
  const dPathname = Object.getOwnPropertyDescriptor(URL.prototype, 'pathname');
  const special = (p) => /^(https?|wss?|ftp|file):$/.test(p);
  Object.defineProperty(URL.prototype, 'hostname', { configurable: true, get() {
    const v = dHostname.get.call(this);
    return (v !== '' && !special(this.protocol)) ? '' : v;
  } });
  Object.defineProperty(URL.prototype, 'host', { configurable: true, get() {
    const v = dHost.get.call(this);
    return (v !== '' && !special(this.protocol)) ? '' : v;
  } });
  Object.defineProperty(URL.prototype, 'pathname', { configurable: true, get() {
    const p = dPathname.get.call(this);
    const h = dHostname.get.call(this);
    return (h !== '' && !special(this.protocol)) ? '//' + h + p : p;
  } });
  window.__gwArkwebEmulated = true;
})()`;

const login = await fetch(`${base}/__gw_login`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: `token=${encodeURIComponent(cfg.token)}`,
  redirect: "manual"
});
const pair = (login.headers.getSetCookie?.()[0] ?? "").split(";")[0];
const eq = pair.indexOf("=");
const cookie = { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim(), domain: "127.0.0.1", path: "/" };

const browser = BROWSERS.find((p) => { try { readFileSync(p); return true; } catch { return false; } });
const child = spawn(browser, ["--headless=new", "--disable-gpu", "--no-first-run",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
let wsUrl;
for (let i = 0; i < 40 && !wsUrl; i += 1) {
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl; } catch { /* 等 */ }
  if (!wsUrl) await sleep(250);
}
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 1;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id !== undefined && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
  }
};
const raw = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const n = id++; pending.set(n, { resolve, reject });
  ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
});
const { targetId } = await raw("Target.createTarget", { url: "about:blank" });
const { sessionId } = await raw("Target.attachToTarget", { targetId, flatten: true });
const S = (m, p) => raw(m, p, sessionId);
await S("Page.enable"); await S("Runtime.enable");
await S("Network.setCookie", cookie);
if (emulate) await S("Page.addScriptToEvaluateOnNewDocument", { source: ARKWEB_EMULATION });
const ev = async (expression) => (await S("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value;

await S("Page.navigate", { url: `${base}/` });
await sleep(7000);
console.log(`模拟 ArkWeb 解析缺陷: ${emulate}`);
console.log("模拟已生效       :", await ev(`String(window.__gwArkwebEmulated === true)`));
// 对照组：同一个浏览器、同一段模拟，但页面里没有注入脚本（gateway 自己的登录页）——
// 这里必须仍然是坏的，否则说明模拟没生效、上面的「修好了」是假象。
await S("Page.navigate", { url: `${base}/__gw_control_no_inject` });
await sleep(1200);
console.log("对照组(无注入)   :", await ev(`(() => { const u = new URL("dsh-resource://file/session/s1/a/b.txt");
  return u.protocol + "|host=" + u.host + "|hostname=" + u.hostname + "|path=" + u.pathname; })()`));
await S("Page.navigate", { url: `${base}/` });
await sleep(6000);
console.log("页面里的 URL 探针:", await ev(`(() => { const u = new URL("dsh-resource://file/session/s1/a/b.txt");
  return u.protocol + "|host=" + u.host + "|hostname=" + u.hostname + "|path=" + u.pathname; })()`));
console.log("protocolOf 取值  :", await ev(`(() => { const p = new URL("dsh-resource://file/session/s1/a/b.txt");
  return p.protocol !== "dsh-resource:" ? "非资源地址" : (p.hostname === "" ? "undefined（provider 找不到 → 文件资源服务不可用）" : p.hostname.toLowerCase()); })()`));
console.log("注入脚本位置     :", await ev(`(() => { const s = document.querySelector('script[data-harn-gw]');
  const first = document.querySelector('head script');
  return (s === first ? "head 里第一个脚本" : "不是第一个脚本") + " / 之前还有 " + [...document.querySelectorAll('head script')].indexOf(s) + " 个脚本"; })()`));
console.log("引导脚本先后     :", await ev(`(() => { const html = document.head.innerHTML;
  const a = html.indexOf('data-harn-gw'), b = html.indexOf('__ModuleLoader__');
  return "注入=" + a + " 引导=" + b + " → " + (a < b ? "注入更早 ✓" : "注入太晚 ✗"); })()`));

// ---- 端到端：在「模拟缺陷」的环境里点开一个真实文件，看原生预览是否恢复 ----
const step = async (label, expression, wait = 1500) => {
  const out = await ev(expression);
  console.log(`  ${label}: ${typeof out === "string" ? out : JSON.stringify(out)}`);
  await sleep(wait);
  return out;
};
console.log("打开会话与文件面板…");
await step("侧边栏", `(() => { const b = document.querySelector('[aria-label="打开侧边栏"]'); if (b) { b.click(); return "已点开"; } return "没找到按钮"; })()`);
await step("选会话", `(() => {
  const list = document.querySelector('[aria-label="会话"]') || document.body;
  const rows = [...list.querySelectorAll('*')].filter((el) => el.offsetParent !== null && (el.innerText || '').trim().length > 1
    && (el.innerText || '').trim().length < 60 && ![...el.children].some((c) => (c.innerText || '').trim().length > 1));
  const hit = rows.find((el) => /harnessapp|网关|Harness Pocket/i.test(el.innerText || '')) || rows[0];
  if (!hit) return "没有会话行";
  hit.click();
  return "点了: " + (hit.innerText || "").trim().slice(0, 30);
})()`, 4000);
await step("右侧栏", `(() => { const b = document.querySelector('[aria-label="打开右侧边栏"]'); if (b) { b.click(); return "已点开"; } return "没找到按钮"; })()`, 2000);
// 右侧栏初始是 guide 页：必须点其中的「工作区文件」入口才会出现文件树
await step("工作区文件入口", `(() => {
  const guide = document.querySelector('[data-sidebar-right-guide]');
  if (!guide) return "没有 guide 页（可能已经是文件树）";
  const hit = [...guide.querySelectorAll('button,[role="button"],a')].find((el) => (el.innerText || '').includes('工作区文件'));
  if (!hit) return "guide 里没有「工作区文件」入口";
  hit.click();
  return "已点开入口";
})()`, 3000);
console.log("  文件树状态:", await ev(`JSON.stringify((() => {
  const tree = document.querySelector('[data-files-state]');
  return { state: tree ? tree.getAttribute('data-files-state') : null,
    root: document.querySelector('[data-files-root]') ? document.querySelector('[data-files-root]').getAttribute('data-files-root') : null,
    entries: [...document.querySelectorAll('[data-files-entry="file"]')].length,
    tabs: [...document.querySelectorAll('[data-sidebar-right-tab]')].map((n) => n.getAttribute('data-sidebar-right-tab')) };
})())`));
const clicked = await step("点文件", `(() => {
  const rows = [...document.querySelectorAll('[data-files-entry="file"]')].filter((el) => el.offsetParent !== null || el.getClientRects().length);
  if (rows.length === 0) return "文件树里没有文件行";
  const wanted = ['README.md', '使用手册.md', 'package.json'];
  let hit = null;
  for (const w of wanted) { hit = rows.find((el) => (el.getAttribute('data-files-path') || '').endsWith(w)); if (hit) break; }
  if (!hit) hit = rows.find((el) => /\\.(md|txt|json|mjs|js|css|py)$/i.test(el.getAttribute('data-files-path') || '')) || rows[0];
  const path = hit.getAttribute('data-files-path');
  const btn = hit.querySelector('button') || hit;
  btn.click();
  return "点了: " + path;
})()`, 7000);

const pane = await ev(`JSON.stringify((() => {
  const el = document.querySelector('[data-textpreview-state]');
  if (el === null) return { pane: false };
  const body = el.querySelector('[data-textpreview-body]');
  const text = (el.innerText || '').replace(/\\s+/g, ' ').trim();
  return {
    pane: true,
    state: el.getAttribute('data-textpreview-state'),
    renderer: el.getAttribute('data-document-preview'),
    url: (el.getAttribute('data-textpreview-url') || '').slice(0, 80),
    bodyChars: body ? (body.innerText || '').trim().length : -1,
    resourceUnavailable: text.indexOf('文件资源服务不可用') >= 0,
    head: text.slice(0, 120)
  };
})())`);
console.log("预览区状态      :", pane);
const parsed = JSON.parse(pane ?? "{}");
console.log(parsed.resourceUnavailable === true
  ? "结论：仍然是「文件资源服务不可用」——补齐没起作用（或插件没 apply）"
  : (parsed.pane === true && parsed.bodyChars > 0
    ? "结论：原生预览已恢复（面板里有文件内容）✓"
    : "结论：预览区状态不明确，见上面的原始状态"));

ws.close(); child.kill(); await sleep(400);
try { rmSync(profile, { recursive: true, force: true }); } catch { /* 忽略 */ }
