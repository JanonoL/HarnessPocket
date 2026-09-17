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
  // 真实场景里预览区都带 data-textpreview-url（文件地址），兜底流程依赖它
  "/broken": '<div data-textpreview-url="dsh-resource://file/session/x/y.md"><div data-textpreview-state="loading"><p>文件资源服务不可用。</p></div></div>',
  "/broken-en": '<div data-textpreview-url="dsh-resource://file/session/x/y.md"><div data-textpreview-state="loading"><p>The file resource service is unavailable.</p></div></div>',
  // 没有地址时（异常形态）只提示、不刷新
  "/broken-noaddr": '<div data-textpreview-state="loading"><p>文件资源服务不可用。</p></div>',
  // 模拟老内核：先删掉这些新 API，再看注入脚本能否补回来
  "/polyfill": '<script>try{delete Promise.withResolvers;delete Object.hasOwn;delete AbortSignal.timeout;delete AbortSignal.prototype.throwIfAborted;delete Array.prototype.at;delete String.prototype.at;}catch(e){}</script><i id="probe" style="display:none">' + "</i>"
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
const zh = await scenario("中文提示（有地址）", "/broken", 7000);
const en = await scenario("英文提示（有地址）", "/broken-en", 7000);
const noAddr = await scenario("没有地址（异常形态）", "/broken-noaddr", 6000);

// 场景三：已经自动刷过两次 → 只提示，不再刷新
navigations.length = 0;
await S("Page.navigate", { url: `http://127.0.0.1:${PAGE_PORT}/broken` });
await sleep(600);
await ev(`sessionStorage.setItem('harnGwPreviewHealCount','2'); sessionStorage.setItem('harnGwPreviewHealAt', String(Date.now() - 120000));`);
await sleep(5000);
const capped = await ev(`!!document.querySelector('[data-harn-gw-hint]')`);
const cappedNavigations = navigations.filter((u) => u.includes("/broken")).length - 1;
console.log(`[刷够两次后] 自动刷新=${cappedNavigations} 提示按钮=${capped}`);

// 场景四：老内核兜底（先删掉这些 API，注入脚本应补齐）
await S("Page.navigate", { url: `http://127.0.0.1:${PAGE_PORT}/polyfill` });
await sleep(1500);
const polyfilled = await ev(`JSON.stringify({
  promiseWithResolvers: typeof Promise.withResolvers,
  objectHasOwn: typeof Object.hasOwn,
  abortSignalTimeout: typeof AbortSignal.timeout,
  throwIfAborted: typeof AbortSignal.prototype.throwIfAborted,
  arrayAt: typeof Array.prototype.at,
  stringAt: typeof String.prototype.at
})`);
console.log(`[老内核兜底] ${polyfilled}`);

console.log(`\n结论：正常页面不刷新=${ok.reloads === 0 && !ok.hint}；提示（有地址，兜底失败后）自动刷新一次=${zh.reloads === 1 && en.reloads === 1}；没有地址时只提示不刷新=${noAddr.reloads === 0 && noAddr.hint === true}；刷够后只提示=${cappedNavigations === 0 && capped === true}；兜底补齐=${!/"undefined"/.test(polyfilled)}`);
ws.close(); child.kill(); server.close(); await sleep(400);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
