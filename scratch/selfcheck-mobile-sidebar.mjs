// 自检：手机上侧边栏抽屉的行为（专项回归——这次的 bug 是"点输入框侧边栏就弹出"）。
// 用法：node scratch/selfcheck-mobile-sidebar.mjs [baseUrl]
import { spawn } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BROWSERS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
];
const PORT = 9347;
const cfg = JSON.parse(readFileSync(new URL("../gateway.config.json", import.meta.url), "utf8"));
const base = (process.argv[2] ?? `http://127.0.0.1:${cfg.port}`).replace(/\/+$/u, "");
const target = new URL(base);
const profile = mkdtempSync(join(tmpdir(), "dsh-sbck-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = await fetch(`${base}/__gw_login`, {
  method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
  body: `token=${encodeURIComponent(cfg.token)}`, redirect: "manual"
});
const pair = (login.headers.getSetCookie?.()[0] ?? "").split(";")[0];
const eq = pair.indexOf("=");
const cookie = { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim(), domain: target.hostname, path: "/" };

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
const ev = async (expression) => (await S("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value;
const setViewport = async (width, height) => {
  await S("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: width < 800 });
  await sleep(900);
};
const geom = `JSON.stringify((() => {
  const col = document.querySelector('.pI_x6G_sidebarCol');
  if (!col) return { none: true, vw: innerWidth };
  const b = col.getBoundingClientRect(); const c = getComputedStyle(col);
  return { vw: innerWidth, pos: c.position, x: Math.round(b.x), w: Math.round(b.width), right: Math.round(b.right),
    open: b.width > 0 && b.right > 8, label: (document.querySelector('.hHd-Xa_toggle') || {}).getAttribute
      ? document.querySelector('.hHd-Xa_toggle').getAttribute('aria-label') : null };
})())`;
const g = async () => JSON.parse(await ev(geom));
const tap = async (x, y) => ev(`(() => { const el = document.elementFromPoint(${x}, ${y}); if (!el) return 'none'; el.click(); return (el.className || el.tagName).toString().slice(0, 30); })()`);
const tapSel = async (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'missing'; el.click(); return 'ok'; })()`);

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); };

await setViewport(430, 932);
await S("Page.navigate", { url: `${base}/` });
await sleep(7000);

console.log("手机视口 430x932：");
let s = await g();
check("T1 初始为关闭态（不挡视线）", s.open === false, `x=${s.x} w=${s.w} label=${s.label}`);

await tapSel('[contenteditable="true"], textarea');
await sleep(900);
s = await g();
check("T2 点输入框后仍关闭（本次 bug 回归）", s.open === false, `x=${s.x} label=${s.label}`);

await tapSel('button[aria-label="打开侧边栏"]');
await sleep(900);
s = await g();
check("T3 点汉堡才打开", s.open === true, `x=${s.x} w=${s.w} label=${s.label}`);

await tap(410, 500);
await sleep(900);
s = await g();
check("T4 点抽屉外（遮罩）自动收起", s.open === false, `x=${s.x} label=${s.label}`);

await tapSel('button[aria-label="打开侧边栏"]');
await sleep(900);
await tapSel('.hHd-Xa_newSession');   // 抽屉里的导航动作：harness 原生会「新建会话并收起抽屉」
await sleep(1500);
s = await g();
check("T5 抽屉内导航（新建会话）→ 自动收起，不残留挡视线", s.open === false, `x=${s.x} label=${s.label}`);

// 抽屉里点「视图选项」这类非导航按钮 → 应保持打开（不能被误判成"点外部"）
await tapSel('button[aria-label="打开侧边栏"]');
await sleep(900);
const viewBtn = `JSON.stringify((() => { const b = document.querySelector('button[aria-label="视图选项"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y) }; })())`;
const vb = JSON.parse(await ev(viewBtn) ?? "null");
if (vb !== null) {
  await tap(vb.x + 8, vb.y + 8);
  await sleep(900);
  s = await g();
  check("T5b 抽屉内点非导航按钮不会误收起", s.open === true, `x=${s.x} label=${s.label}`);
} else {
  console.log("  - T5b 跳过（找不到「视图选项」按钮）");
}

// 桌面宽度：侧边栏展开时点聊天区不该收起（别把桌面端也修坏）
await setViewport(1200, 900);
await sleep(800);
s = await g();
const deskBefore = s;
await tap(700, 500);
await sleep(900);
s = await g();
check("T6 桌面 1200px 点聊天区不收起侧栏", s.w === deskBefore.w && s.open === deskBefore.open, `前 w=${deskBefore.w} 后 w=${s.w}`);

// 平板 860px：图标栏模式（56px），不该被注入样式/脚本改变
await setViewport(860, 900);
await sleep(800);
s = await g();
const railBefore = s;
await tap(600, 500);
await sleep(900);
s = await g();
check("T7 平板 860px 为图标栏且点击不受影响", railBefore.w <= 80 && s.w === railBefore.w, `前 w=${railBefore.w} 后 w=${s.w}`);

ws.close(); child.kill(); await sleep(400);
try { rmSync(profile, { recursive: true, force: true }); } catch { /* 忽略 */ }

const failed = results.filter((r) => !r.ok);
console.log(`\n结论：${results.length - failed.length}/${results.length} 通过` + (failed.length ? `，失败：${failed.map((f) => f.name).join("、")}` : ""));
process.exitCode = failed.length === 0 ? 0 : 1;
