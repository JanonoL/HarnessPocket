// 验收：在「模拟华为 ArkWeb 解析缺陷」的手机环境下，远程浏览器里能不能看 文本 / 图片 / 视频。
// 复用网关链路（http://127.0.0.1:8443/），真点真实文件树里的文件，逐个断言渲染结果。
// 用法：node scratch/cdp-phone-acceptance.mjs
import { spawn } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync, existsSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BROWSERS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
];
const PORT = 9339;
const DIR = fileURLToPath(new URL("..", import.meta.url));
const cfg = JSON.parse(readFileSync(join(DIR, "gateway.config.json"), "utf8"));
// 默认打本机网关；也可以传公网域名，走和手机完全一样的那条链路（FRP + HTTPS）
const base = (process.argv[2] ?? `http://127.0.0.1:${cfg.port}`).replace(/\/+$/u, "");
const target = new URL(base);
console.log(`目标: ${base}`);
const profile = mkdtempSync(join(tmpdir(), "dsh-accept-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 素材：图片固定用 gw-test.png；视频可以用 GW_VIDEO_SRC 指定真文件（例如手机上看不了的那个）
const SOURCE_DIR = join(DIR, "scratch");
const VIDEO_SRC = process.env.GW_VIDEO_SRC ?? join(SOURCE_DIR, "gw-test.mp4");
console.log(`视频素材: ${VIDEO_SRC}`);
const TEXT_FILE = "README.md";
const IMAGE_FILE = "gw-test.png";
const VIDEO_FILE = "gw-test.mp4";
const SUBDIR = "scratch";

// 模拟 ArkWeb：自定义 scheme 不解析 authority（与手机真实上报一致）
const ARKWEB_EMULATION = `(() => {
  const dHost = Object.getOwnPropertyDescriptor(URL.prototype, 'host');
  const dHostname = Object.getOwnPropertyDescriptor(URL.prototype, 'hostname');
  const dPathname = Object.getOwnPropertyDescriptor(URL.prototype, 'pathname');
  const special = (p) => /^(https?|wss?|ftp|file):$/.test(p);
  Object.defineProperty(URL.prototype, 'hostname', { configurable: true, get() {
    const v = dHostname.get.call(this); return (v !== '' && !special(this.protocol)) ? '' : v; } });
  Object.defineProperty(URL.prototype, 'host', { configurable: true, get() {
    const v = dHost.get.call(this); return (v !== '' && !special(this.protocol)) ? '' : v; } });
  Object.defineProperty(URL.prototype, 'pathname', { configurable: true, get() {
    const p = dPathname.get.call(this); const h = dHostname.get.call(this);
    return (h !== '' && !special(this.protocol)) ? '//' + h + p : p; } });
})()`;

const login = await fetch(`${base}/__gw_login`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: `token=${encodeURIComponent(cfg.token)}`,
  redirect: "manual"
});
const pair = (login.headers.getSetCookie?.()[0] ?? "").split(";")[0];
const eq = pair.indexOf("=");
const cookie = { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim(), domain: target.hostname, path: "/" };
const cookieHeader = pair;

// 素材要落在「界面真会打开的那个工作区」里，而工作区取决于点中哪个会话 —— 事先给所有会话工作区里的
// 现有 scratch 目录各放一份（只在 scratch 已存在时放，不新建目录），跑完删掉。
async function rpc(method, args) {
  const res = await fetch(`${base}/api/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookieHeader },
    body: JSON.stringify({ type: "client-request", rpcId: Math.random().toString(16).slice(2), method, payload: { args } })
  });
  const json = await res.json();
  if (json?.result?.ok !== true) throw new Error(`RPC ${method} 失败: ${JSON.stringify(json).slice(0, 200)}`);
  return json.result.value;
}
const planted = [];
const list = await rpc("session/list", { _request: {} });
const roots = [];
for (const item of list?.items ?? []) if (typeof item?.cwd === "string" && !roots.includes(item.cwd)) roots.push(item.cwd);
for (const root of roots.slice(0, 6)) {
  const dir = join(root, SUBDIR);
  if (!existsSync(dir)) continue;
  if (join(dir).toLowerCase() === SOURCE_DIR.toLowerCase()) continue;   // 就是仓库自己的 scratch，跳过
  try { copyFileSync(join(SOURCE_DIR, IMAGE_FILE), join(dir, IMAGE_FILE)); planted.push(join(dir, IMAGE_FILE)); } catch { /* 跳过 */ }
  try { copyFileSync(VIDEO_SRC, join(dir, VIDEO_FILE)); planted.push(join(dir, VIDEO_FILE)); } catch { /* 跳过 */ }
}
console.log(`已布点 ${planted.length} 个测试文件到 ${new Set(planted.map((p) => p.replace(/[\\/][^\\/]+$/u, ""))).size} 个工作区（跑完删除）`);

const browser = BROWSERS.find((p) => { try { readFileSync(p); return true; } catch { return false; } });
// 故意不加 --autoplay-policy 豁免：要让「静音才能自动播放」这个真实限制生效，否则测不出播放器方案的真假
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
const { sessionId: cdp } = await raw("Target.attachToTarget", { targetId, flatten: true });
const S = (m, p) => raw(m, p, cdp);
await S("Page.enable"); await S("Runtime.enable");
await S("Emulation.setDeviceMetricsOverride", { width: 430, height: 932, deviceScaleFactor: 2, mobile: true });
await S("Network.setCookie", cookie);
await S("Page.addScriptToEvaluateOnNewDocument", { source: ARKWEB_EMULATION });
const ev = async (expression) => (await S("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value;
const step = async (label, expression, wait = 1500) => {
  const out = await ev(expression);
  console.log(`  ${label}: ${typeof out === "string" ? out : JSON.stringify(out)}`);
  await sleep(wait);
  return out;
};

await S("Page.navigate", { url: `${base}/` });
await sleep(7000);

// 清掉兜底浮层与旧状态，保证每次断言只看这一次点击的结果
const reset = `(() => { const b = document.querySelector('[data-harn-gw-preview]'); if (b) b.remove();
  const h = document.querySelector('[data-harn-gw-hint]'); if (h) h.remove(); return true; })()`;
const clickFile = (name) => `(() => {
  const rows = [...document.querySelectorAll('[data-files-entry="file"]')].filter((el) => (el.offsetParent !== null || el.getClientRects().length));
  const hit = rows.find((el) => (el.getAttribute('data-files-path') || '').endsWith(${JSON.stringify(name)}));
  if (!hit) return "文件树里没有 " + ${JSON.stringify(name)} + "（现有：" + rows.map((e) => (e.getAttribute('data-files-path') || '').split(/[\\\\/]/).pop()).slice(0, 12).join(',') + "）";
  (hit.querySelector('button') || hit).click();
  return "已点 " + ${JSON.stringify(name)};
})()`;
const snapshot = `JSON.stringify((() => {
  const pane = document.querySelector('[data-textpreview-state]');
  const box = document.querySelector('[data-harn-gw-preview]');
  const img = box ? box.querySelector('img') : null;
  const video = box ? box.querySelector('video') : null;
  const body = pane ? pane.querySelector('[data-textpreview-body]') : null;
  const text = (pane && pane.innerText || '').replace(/\\s+/g, ' ').trim();
  // 面板里可能既有文件类型小图标也有真图，按面积取最大的那个
  const imgs = pane ? [...pane.querySelectorAll('img')].map((i) => ({
    w: i.naturalWidth, h: i.naturalHeight, src: (i.currentSrc || i.src || '').slice(0, 28) })) : [];
  const biggest = imgs.slice().sort((a, b) => b.w * b.h - a.w * a.h)[0] || null;
  return {
    paneState: pane ? pane.getAttribute('data-textpreview-state') : null,
    renderer: pane ? pane.getAttribute('data-document-preview') : null,
    nativeTextChars: body ? (body.innerText || '').trim().length : -1,
    nativeImgs: imgs,
    nativeImg: biggest,
    resourceUnavailable: text.indexOf('文件资源服务不可用') >= 0,
    unsupported: text.indexOf('无法预览') >= 0,
    fallbackBox: !!box,
    fallbackImg: img ? { w: img.naturalWidth, h: img.naturalHeight } : null,
    fallbackVideo: video ? { readyState: video.readyState, w: video.videoWidth, h: video.videoHeight,
      duration: Math.round((video.duration || 0) * 10) / 10, paused: video.paused, muted: video.muted,
      currentTime: Math.round((video.currentTime || 0) * 100) / 100,
      status: (box ? (box.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 120) : '') } : null
  };
})())`;

console.log("── 打开会话与文件面板 ──");
await step("侧边栏", `(() => { const b = document.querySelector('[aria-label="打开侧边栏"]'); if (b) { b.click(); return "ok"; } return "没找到"; })()`);
await step("选会话", `(() => {
  const list = document.querySelector('[aria-label="会话"]') || document.body;
  const rows = [...list.querySelectorAll('*')].filter((el) => el.offsetParent !== null && (el.innerText || '').trim().length > 1
    && (el.innerText || '').trim().length < 60 && ![...el.children].some((c) => (c.innerText || '').trim().length > 1));
  const hit = rows.find((el) => /harnessapp|网关|Harness Pocket/i.test(el.innerText || '')) || rows[0];
  if (!hit) return "没有会话";
  hit.click(); return "点了 " + (hit.innerText || '').trim().slice(0, 24);
})()`, 4000);
await step("右侧栏", `(() => { const b = document.querySelector('[aria-label="打开右侧边栏"]'); if (b) { b.click(); return "ok"; } return "没找到"; })()`, 2000);
await step("工作区文件入口", `(() => {
  const g = document.querySelector('[data-sidebar-right-guide]');
  if (!g) return "已是文件树";
  const hit = [...g.querySelectorAll('button,[role="button"],a')].find((el) => (el.innerText || '').includes('工作区文件'));
  if (!hit) return "没有入口";
  hit.click(); return "ok";
})()`, 3000);
const root = await ev(`(() => { const el = document.querySelector('[data-files-root]'); return el ? el.getAttribute('data-files-root') : null; })()`);
console.log(`  文件树根目录: ${root}`);

// 文件树在点开文件后会被文档页签顶掉，所以每次点击前都要把它切回来
const ensureTree = `(() => {
  const visible = [...document.querySelectorAll('[data-files-entry="file"]')].some((el) => el.offsetParent !== null && el.getClientRects().length);
  if (visible) return "树已可见";
  const tabs = [...document.querySelectorAll('[data-sidebar-right-tab]')];
  const tab = tabs.find((el) => (el.innerText || '').trim() === '文件');
  if (tab) { tab.click(); return "切回文件页签"; }
  const g = document.querySelector('[data-sidebar-right-guide]');
  if (g) {
    const hit = [...g.querySelectorAll('button,[role="button"],a')].find((el) => (el.innerText || '').includes('工作区文件'));
    if (hit) { hit.click(); return "点开工作区文件入口"; }
  }
  return "无法打开文件树";
})()`;
const expandSubdir = `(() => {
  const dir = [...document.querySelectorAll('[data-files-entry="directory"]')].find((el) => (el.getAttribute('data-files-path') || '').endsWith(${JSON.stringify(SUBDIR)}));
  if (!dir) return "没有 " + ${JSON.stringify(SUBDIR)} + " 目录";
  const b = dir.querySelector('button[aria-expanded="false"]');
  if (b) { b.click(); return "展开 " + ${JSON.stringify(SUBDIR)}; }
  return SUBDIR + " 已展开";
})()`;

const results = {};
const clickAndSnapshot = async (label, name, wait) => {
  console.log(`── ${label} ──`);
  await ev(reset);
  await step("文件树", ensureTree, 1200);
  await step("子目录", expandSubdir, 1500);
  console.log("  " + await ev(clickFile(name)));
  await sleep(wait);
  const shot = JSON.parse(await ev(snapshot));
  console.log("  " + JSON.stringify(shot));
  return shot;
};

results.text = await clickAndSnapshot("1) 文本文件", TEXT_FILE, 7000);
results.image = await clickAndSnapshot("2) 图片文件", IMAGE_FILE, 8000);
results.video = await clickAndSnapshot("3) 视频文件", VIDEO_FILE, 9000);

const verdict = (name, ok, detail) => console.log(`  ${ok ? "✓" : "✗"} ${name}${detail}`);
console.log("── 验收结论（模拟华为内核缺陷的手机环境）──");
verdict("文本可看", results.text.nativeTextChars > 0 || results.text.fallbackBox,
  results.text.nativeTextChars > 0 ? `原生预览 ${results.text.nativeTextChars} 字符（渲染器 ${results.text.renderer}）` : (results.text.fallbackBox ? "网关兜底浮层" : "都没有"));
const nativeBig = results.image.nativeImg && results.image.nativeImg.w >= 100;
const fallbackBig = results.image.fallbackImg && results.image.fallbackImg.w >= 100;
verdict("图片可看", nativeBig || fallbackBig, nativeBig
  ? `原生预览 ${results.image.nativeImg.w}x${results.image.nativeImg.h}（渲染器 ${results.image.renderer}）`
  : (fallbackBig ? `网关兜底 ${results.image.fallbackImg.w}x${results.image.fallbackImg.h}` : `没有画出真图：${JSON.stringify(results.image.nativeImgs)}`));
const videoOk = results.video.fallbackVideo && results.video.fallbackVideo.readyState >= 1
  && results.video.fallbackVideo.paused === false && results.video.fallbackVideo.currentTime > 0;   // 真的在播，不是只加载了元数据
verdict("视频可看", videoOk, results.video.fallbackVideo
  ? `播放器 readyState=${results.video.fallbackVideo.readyState} ${results.video.fallbackVideo.w}x${results.video.fallbackVideo.h}`
    + ` 时长${results.video.fallbackVideo.duration}s 已播${results.video.fallbackVideo.currentTime}s`
    + ` paused=${results.video.fallbackVideo.paused} muted=${results.video.fallbackVideo.muted}`
  : "没有播放器");

for (const p of planted) { try { rmSync(p, { force: true }); } catch { /* 忽略 */ } }
console.log(`已清理 ${planted.length} 个测试文件`);
ws.close(); child.kill(); await sleep(400);
try { rmSync(profile, { recursive: true, force: true }); } catch { /* 忽略 */ }
process.exitCode = (results.text.nativeTextChars > 0 || results.text.fallbackBox) && (nativeBig || fallbackBig) && videoOk ? 0 : 1;
