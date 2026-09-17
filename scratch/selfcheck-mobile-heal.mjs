// 自愈脚本自测：用无头浏览器在真实 http 源上加载 mobile.js，验证
//   ① 正常页面不刷新 ② 出现「文件资源服务不可用」时自动刷新一次 ③ 刷够两次后改为提示按钮
// 用法：node scratch/selfcheck-mobile-heal.mjs
import { spawn } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BROWSERS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
];
const CDP_PORT = 9335;
const PAGE_PORT = 8791;
const mobileJs = readFileSync(new URL("../mobile.js", import.meta.url), "utf8");
const profile = mkdtempSync(join(tmpdir(), "dsh-heal-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 用真实 http 源承载测试页（data: URL 的 sessionStorage 是不可用的，会掩盖问题）
const pages = {
  "/ok": '<div data-textpreview-state="text">文件内容正常</div>',
  "/broken": '<div data-textpreview-state="loading"><p>文件资源服务不可用。</p></div>',
  "/broken-en": '<div data-textpreview-state="loading"><p>The file resource service is unavailable.</p></div>'
};
const server = createServer((req, res) => {
  const body = pages[req.url.split("?")[0]] ?? "<div>?</div>";
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html><head><meta charset="utf-8"></head><body>${body}<script>${mobileJs}</script></body></html>`);
});
await new Promise((r) => server.listen(PAGE_PORT, "127.0.0.1", r));

const browser = BROWSERS.find((p) => { try { readFileSync(p); return true; } catch { return false; } });
const child = spawn(browser, ["--headless=new", "--disable-gpu", "--no-first-run", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
let wsUrl;
for (let i = 0; i < 40 && !wsUrl; i += 1) {
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json()).webSocketDebuggerUrl; } catch {}
  if (!wsUrl) await sleep(250);
}
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 1;
const pending = new Map();
const navigations = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id !== undefined && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    return;
  }
  if (m.method === "Page.frameNavigated" && !m.params.frame.parentId) navigations.push(m.params.frame.url);
};
const raw = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const n = id++; pending.set(n, { resolve, reject });
  ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
});
const { targetId } = await raw("Target.createTarget", { url: "about:blank" });
const { sessionId } = await raw("Target.attachToTarget", { targetId, flatten: true });
const S = (m, p) => raw(m, p, sessionId);
await S("Page.enable"); await S("Runtime.enable");
const ev = async (expression) => (await S("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value;

async function scenario(label, path, waitMs) {
  navigations.length = 0;
  await S("Page.navigate", { url: `http://127.0.0.1:${PAGE_PORT}${path}` });
  await sleep(500);
  // 每个场景都从干净计数开始（否则上一个场景的 60 秒节流会影响判断）
  await ev(`sessionStorage.removeItem('harnGwPreviewHealCount'); sessionStorage.removeItem('harnGwPreviewHealAt'); document.querySelector('[data-harn-gw-hint]')?.remove();`);
  await sleep(waitMs);
  const hint = await ev(`!!document.querySelector('[data-harn-gw-hint]')`);
  const reloads = navigations.filter((u) => u.includes(path)).length - 1;
  console.log(`[${label}] 页面加载次数=${navigations.length}（自动刷新=${reloads}） 提示按钮=${hint}`);
  return { reloads, hint };
}

const ok = await scenario("正常页面", "/ok", 5000);
const zh = await scenario("中文不可用提示", "/broken", 6000);
const en = await scenario("英文不可用提示", "/broken-en", 6000);

// 场景三：已经自动刷过两次 → 只提示，不再刷新
navigations.length = 0;
await S("Page.navigate", { url: `http://127.0.0.1:${PAGE_PORT}/broken` });
await sleep(600);
await ev(`sessionStorage.setItem('harnGwPreviewHealCount','2'); sessionStorage.setItem('harnGwPreviewHealAt', String(Date.now() - 120000));`);
await sleep(5000);
const capped = await ev(`!!document.querySelector('[data-harn-gw-hint]')`);
const cappedNavigations = navigations.filter((u) => u.includes("/broken")).length - 1;
console.log(`[刷够两次后] 自动刷新=${cappedNavigations} 提示按钮=${capped}`);

console.log(`\n结论：正常页面不刷新=${ok.reloads === 0 && !ok.hint}；中/英文提示各自动刷新一次=${zh.reloads === 1 && en.reloads === 1}；刷够后只提示=${cappedNavigations === 0 && capped === true}`);
ws.close(); child.kill(); server.close(); await sleep(400);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
