// 无头浏览器走网关（和手机同一条链路）复现「点文件无法预览」：
// 打开会话 → 打开右侧「文件」→ 点第一个文件 → 读预览区状态。
// 用法：node scratch/cdp-preview-flow.mjs [url]
import { spawn } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { createHash, createHmac } from "node:crypto";

const BROWSERS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
];
const PORT = 9334;
const cfg = JSON.parse(readFileSync(new URL("../gateway.config.json", import.meta.url), "utf8"));
const url = process.argv[2] || `http://127.0.0.1:${cfg.port}/`;
const at = new URL(url);
const profile = mkdtempSync(join(tmpdir(), "dsh-flow-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cookieFor() {
  if (Number(at.port) === Number(cfg.port)) {
    const res = await fetch(`${at.origin}/__gw_login`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `token=${encodeURIComponent(cfg.token)}`, redirect: "manual"
    });
    const pair = (res.headers.getSetCookie?.()[0] ?? "").split(";")[0];
    const i = pair.indexOf("=");
    return { name: pair.slice(0, i).trim(), value: pair.slice(i + 1).trim(), domain: at.hostname, path: "/" };
  }
  const dshHome = process.env.DSH_HOME || join(homedir(), ".dsh");
  const secretText = /client-connection\/browser-session:[\s\S]*?secret:\s*([A-Za-z0-9_-]{20,})/u.exec(readFileSync(join(dshHome, ".credentials.yaml"), "utf8"))[1];
  const secret = Buffer.from(secretText.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (secretText.length % 4)) % 4), "base64");
  const b64 = (b) => Buffer.from(b).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
  const authority = at.host;
  const now = Date.now();
  const body = b64(Buffer.from(JSON.stringify({ version: 1, authority, issuedAt: now, expiresAt: now + 86400_000 }), "utf8"));
  return { name: "dsh-auth-" + b64(createHash("sha256").update(authority).digest()), value: `v1.${body}.${b64(createHmac("sha256", secret).update(body).digest())}`, domain: at.hostname, path: "/" };
}

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
const errors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id !== undefined && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    return;
  }
  if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type))
    errors.push(`console.${m.params.type}: ` + m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 240));
  if (m.method === "Log.entryAdded" && m.params.entry.level === "error") errors.push(`log: ${m.params.entry.text.slice(0, 240)}`);
};
const raw = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const n = id++; pending.set(n, { resolve, reject });
  ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
});
const { targetId } = await raw("Target.createTarget", { url: "about:blank" });
const { sessionId } = await raw("Target.attachToTarget", { targetId, flatten: true });
const S = (m, p) => raw(m, p, sessionId);
await S("Runtime.enable"); await S("Log.enable"); await S("Network.enable"); await S("Page.enable");
await S("Network.setCookie", await cookieFor());
await S("Emulation.setDeviceMetricsOverride", { width: 430, height: 932, deviceScaleFactor: 2, mobile: true });
const ev = async (expression) => (await S("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value;

await S("Page.navigate", { url });
await sleep(6500);
console.log("首屏:", (await ev("document.body.innerText.replace(/\\s+/g,' ').slice(0,120)")));

// 1) 打开侧边栏抽屉，点第一个会话
await ev(`(() => { const b = document.querySelector('[aria-label="打开侧边栏"]'); b && b.click(); return !!b; })()`);
await sleep(1500);
const sessions = await ev(`JSON.stringify([...document.querySelectorAll('[class*="session"],[role="treeitem"],li,a,button')]
  .filter((el) => el.offsetParent !== null)
  .map((el) => (el.innerText || '').replace(/\\s+/g,' ').trim())
  .filter((t) => t.length > 1 && t.length < 40).slice(0, 25))`);
console.log("抽屉里的候选:", sessions);

const opened = await ev(`(() => {
  const list = document.querySelector('[aria-label="会话"]') || document.body;
  const kw = ${JSON.stringify(process.env.SESSION_KW || "")};
  const rows = [...list.querySelectorAll('*')].filter((el) => el.offsetParent !== null && (el.innerText || '').trim().length > 1
    && (el.innerText || '').trim().length < 60 && ![...el.children].some((c) => (c.innerText || '').trim().length > 1));
  const hit = kw ? rows.find((el) => (el.innerText || '').includes(kw)) : rows[0];
  if (!hit) return 'no-session(rows=' + rows.length + ')';
  hit.click();
  return 'clicked:' + (hit.innerText || '').replace(/\\s+/g,' ').trim().slice(0, 40);
})()`);
console.log("打开会话:", opened);
await sleep(4000);
console.log("会话页首屏:", (await ev("document.body.innerText.replace(/\\s+/g,' ').slice(0,200)")));

// 2) 找右侧面板入口
const rightEntries = await ev(`JSON.stringify({
  cols: [...document.querySelectorAll('[class*="detailsCol"],[class*="centerCol"],[class*="sidebarCol"]')]
    .map((el) => ({ cls: (el.className||'').toString(), display: getComputedStyle(el).display, w: el.getBoundingClientRect().width })),
  fileWords: [...document.querySelectorAll('*')].filter((el) => el.offsetParent !== null && (el.textContent||'').trim() === '文件')
    .map((el) => ({ tag: el.tagName, cls: (el.className||'').toString().slice(0,40), aria: el.getAttribute('aria-label') })),
  labels: [...document.querySelectorAll('[aria-label],[title]')].filter((el) => el.offsetParent !== null)
    .map((el) => el.getAttribute('aria-label') || el.getAttribute('title')).slice(0, 40)
}, null, 1)`);
console.log("右侧入口候选:\n" + rightEntries);

// 3) 打开右侧边栏 → 点「文件」
const openedRight = await ev(`(() => { const b = document.querySelector('[aria-label="打开右侧边栏"]'); if (!b) return 'no-open-button'; b.click(); return 'opened'; })()`);
console.log("打开右侧边栏:", openedRight);
await sleep(2000);
const tabLabels = await ev(`JSON.stringify([...document.querySelectorAll('[aria-label],[title],[role="tab"],button')]
  .filter((el) => el.offsetParent !== null)
  .map((el) => ({ aria: el.getAttribute('aria-label'), title: el.getAttribute('title'), text: (el.innerText||'').replace(/\\s+/g,' ').trim().slice(0, 16), cls: (el.className||'').toString().slice(0, 30) }))
  .filter((e) => e.aria || e.title || e.text).slice(-25), null, 1)`);
console.log("右侧栏元素:\n" + tabLabels);
const filesTab = await ev(`(() => {
  const wanted = ['文件', 'Files'];
  const hit = [...document.querySelectorAll('button,[role="tab"],[role="button"],div,span')]
    .find((el) => el.offsetParent !== null && wanted.includes((el.textContent||'').trim()) && (el.textContent||'').trim().length < 4);
  if (!hit) return 'no-files-tab';
  hit.click();
  return 'clicked:' + (hit.textContent||'').trim();
})()`);
console.log("文件面板:", filesTab);
await sleep(2500);
console.log("面板文本:", (await ev("document.body.innerText.replace(/\\s+/g,' ').slice(0,400)")));

// 4) 在右侧面板里点第一个文件
const panelRows = await ev(`JSON.stringify((() => {
  const pane = [...document.querySelectorAll('[class*="detailsCol"],[class*="pane"],[class*="rightCol"]')].filter((el) => el.offsetParent !== null);
  const box = pane[pane.length - 1] || document.body;
  return {
    boxClass: (box.className || '').toString().slice(0, 60),
    rows: [...box.querySelectorAll('*')].filter((el) => el.offsetParent !== null && (el.innerText || '').trim().length > 1 && (el.innerText || '').trim().length < 60
      && ![...el.children].some((c) => (c.innerText || '').trim().length > 1))
      .map((el) => ({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 40), text: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 40) })).slice(0, 25)
  };
})(), null, 1)`);
console.log("面板行:\n" + panelRows);

const clicked = await ev(`(() => {
  const ext = /\\.(md|txt|json|ts|tsx|js|mjs|cjs|css|html|yml|yaml|log|py|toml|pdf)$/i;
  const pane = [...document.querySelectorAll('[class*="detailsCol"],[class*="pane"],[class*="rightCol"]')].filter((el) => el.offsetParent !== null);
  const box = pane[pane.length - 1] || document.body;
  const rows = [...box.querySelectorAll('*')].filter((el) => el.offsetParent !== null && ext.test((el.innerText || '').trim()) && (el.innerText || '').trim().length < 80
    && ![...el.children].some((c) => ext.test((c.innerText || '').trim())));
  const hit = rows[0];
  if (!hit) return 'no-file-in-panel';
  hit.click();
  return 'clicked:' + (hit.innerText || '').trim().slice(0, 50) + ' | cls=' + (hit.className || '').toString().slice(0, 30);
})()`);
console.log("点文件:", clicked);
await sleep(5000);

const state = await ev(`JSON.stringify({
  stateAttr: document.querySelector('[data-textpreview-state]')?.getAttribute('data-textpreview-state') ?? null,
  previewText: (document.querySelector('[data-textpreview-state]')?.innerText || '').replace(/\\s+/g,' ').trim().slice(0,120) || null,
  lines: document.querySelectorAll('[data-textpreview-line]').length,
  address: document.querySelector('[data-textpreview-url]')?.getAttribute('data-textpreview-url') ?? null
}, null, 1)`);
console.log("预览区:", state);
console.log("整页文本:", (await ev("document.body.innerText.replace(/\\s+/g,' ').slice(0,400)")));
console.log("\n控制台报错:\n" + (errors.length ? errors.slice(0, 12).join("\n") : "(无)"));

ws.close(); child.kill(); await sleep(400);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
