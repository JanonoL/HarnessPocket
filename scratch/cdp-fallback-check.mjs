// 验证「网关兜底预览」：打开文件后，把预览区改成客户端报的那句提示（模拟 provider 缺失），
// 看注入脚本能否通过网关把文件内容画回来。
// 用法：node scratch/cdp-fallback-check.mjs
import { spawn } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BROWSERS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
];
const PORT = 9336;
const cfg = JSON.parse(readFileSync(new URL("../gateway.config.json", import.meta.url), "utf8"));
const base = `http://127.0.0.1:${cfg.port}`;
const profile = mkdtempSync(join(tmpdir(), "dsh-fb-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = await fetch(`${base}/__gw_login`, {
  method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
  body: `token=${encodeURIComponent(cfg.token)}`, redirect: "manual"
});
const pair = (login.headers.getSetCookie?.()[0] ?? "").split(";")[0];
const at = pair.indexOf("=");
const cookie = { name: pair.slice(0, at).trim(), value: pair.slice(at + 1).trim(), domain: "127.0.0.1", path: "/" };

const browser = BROWSERS.find((p) => { try { readFileSync(p); return true; } catch { return false; } });
const child = spawn(browser, ["--headless=new", "--disable-gpu", "--no-first-run", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
let wsUrl;
for (let i = 0; i < 40 && !wsUrl; i += 1) {
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl; } catch {}
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
await S("Emulation.setDeviceMetricsOverride", { width: 430, height: 932, deviceScaleFactor: 2, mobile: true });
const ev = async (expression) => (await S("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value;

await S("Page.navigate", { url: `${base}/` });
await sleep(6500);

// 打开会话 → 右侧栏 → 文件 → 点第一个文件
await ev(`(() => { const b = document.querySelector('[aria-label="打开侧边栏"]'); b && b.click(); })()`);
await sleep(1500);
await ev(`(() => {
  const list = document.querySelector('[aria-label="会话"]') || document.body;
  const rows = [...list.querySelectorAll('*')].filter((el) => el.offsetParent !== null && (el.innerText || '').trim().length > 1
    && (el.innerText || '').trim().length < 60 && ![...el.children].some((c) => (c.innerText || '').trim().length > 1));
  const hit = rows.find((el) => (el.innerText || '').includes('AGI 学习机制')) || rows[0];
  if (hit) hit.click();
})()`);
await sleep(4000);
await ev(`(() => { const b = document.querySelector('[aria-label="打开右侧边栏"]'); b && b.click(); })()`);
await sleep(2000);
await ev(`(() => {
  const hit = [...document.querySelectorAll('button,[role="tab"],[role="button"],div,span')]
    .find((el) => el.offsetParent !== null && (el.textContent || '').trim() === '文件');
  if (hit) hit.click();
})()`);
await sleep(2500);
const clicked = await ev(`(() => {
  const ext = /\\.(md|txt|json|ts|js|mjs|css|html|yml|yaml|log|py|toml)$/i;
  const pane = [...document.querySelectorAll('[class*="pane"],[class*="detailsCol"]')].filter((el) => el.offsetParent !== null).pop() || document.body;
  const rows = [...pane.querySelectorAll('*')].filter((el) => el.offsetParent !== null && ext.test((el.innerText || '').trim()) && (el.innerText || '').trim().length < 80
    && ![...el.children].some((c) => ext.test((c.innerText || '').trim())));
  if (!rows[0]) return 'no-file';
  window.__rowHtml = rows[0].outerHTML.slice(0, 500);
  window.__rowChain = (() => {
    let el = rows[0], out = [];
    for (let i = 0; i < 5 && el; i++) { out.push(el.tagName + '.' + (el.className || '').toString().slice(0, 40) + ' attrs=' + [...el.attributes].map((a) => a.name).join(',')); el = el.parentElement; }
    return out.join(' >> ');
  })();
  rows[0].click();
  return 'clicked:' + (rows[0].innerText || '').trim().slice(0, 40);
})()`);
console.log("点文件:", clicked);
await sleep(2500);
console.log("行 DOM:", await ev(`window.__rowHtml`));
console.log("行祖先:", await ev(`window.__rowChain`));
console.log("data-files-path =", await ev(`document.querySelector("[data-files-entry]")?.getAttribute("data-files-path") ?? "(无)"`));
console.log("面板绝对路径片段:", await ev(`JSON.stringify((document.querySelector('[class*="paneBody"]')?.innerText || '').split('\\n').slice(0, 4))`));
await sleep(4000);
console.log("原生预览:", await ev(`JSON.stringify({ state: document.querySelector('[data-textpreview-state]')?.getAttribute('data-textpreview-state') ?? null,
  url: document.querySelector('[data-textpreview-url]')?.getAttribute('data-textpreview-url') ?? null })`));

// 模拟 provider 缺失：手机上的真实形态是「预览区只剩一句提示，且没有 data-textpreview-url」。
// React 会把我改过的 DOM 重新渲染回去，所以在 body 下另插一个「假预览区」（只带 data-textpreview-state），
// 并把真实预览区的标记摘掉，让注入脚本只认这个假节点。文件路径用真实点击记录（data-files-path）模拟。
const textPath = process.argv[2] || "F:\\workspacecraftsmen\\craftsmen\\agi\\agent.md";
await ev(`(() => {
  const withUrl = document.querySelector('[data-textpreview-url]');
  if (withUrl) withUrl.removeAttribute('data-textpreview-url');
  const realPane = document.querySelector('[data-textpreview-state]');
  if (realPane) realPane.removeAttribute('data-textpreview-state');
  const fake = document.createElement('div');
  fake.setAttribute('data-harn-test-fake', '');
  fake.setAttribute('data-textpreview-state', 'loading');
  fake.innerHTML = '<p>文件资源服务不可用。</p>';
  document.body.appendChild(fake);
  // 模拟用户点了一行文件（行上带 data-files-path）
  const row = document.createElement('div');
  row.setAttribute('data-files-path', ${JSON.stringify(textPath)});
  row.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.appendChild(row);
  row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  row.remove();
  return true;
})()`);
console.log("已模拟手机真实故障形态（无地址属性 + 只剩提示 + 点击记录），等待注入脚本兜底…");
await sleep(7000);

const result = await ev(`JSON.stringify({
  fallbackBox: !!document.querySelector('[data-harn-gw-preview]'),
  fallbackText: (document.querySelector('[data-harn-gw-preview]')?.innerText || '').slice(0, 220),
  hint: !!document.querySelector('[data-harn-gw-hint]')
}, null, 1)`);
console.log("文本兜底:", result);

// 图片兜底：造一个带 data-files-path 的元素并真的点一下，模拟用户点了图片文件
const imagePath = process.argv[2] || "F:\\workspacecraftsmen\\craftsmen\\agi\\scratch\\assets\\mujoco_menagerie\\aloha\\assets\\interbotix_black.png";
await ev(`(() => {
  const el = document.createElement('div');
  el.setAttribute('data-files-path', ${JSON.stringify(imagePath)});
  el.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.appendChild(el);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  el.remove();
  return true;
})()`);
console.log("已模拟点击图片文件:", imagePath);
await sleep(7000);
const imgResult = await ev(`JSON.stringify({
  box: !!document.querySelector('[data-harn-gw-preview]'),
  imgSrc: (document.querySelector('[data-harn-gw-preview] img')?.getAttribute('src') || '').slice(0, 90),
  imgLoaded: (document.querySelector('[data-harn-gw-preview] img')?.naturalWidth || 0) > 0,
  imgWidth: document.querySelector('[data-harn-gw-preview] img')?.naturalWidth || 0
}, null, 1)`);
console.log("图片兜底:", imgResult);

ws.close(); child.kill(); await sleep(400);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
