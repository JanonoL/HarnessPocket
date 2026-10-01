// 验证网关兜底的两条新路径（走真实网关链路，和手机同一条）：
//   1) 视频：harness 客户端没有视频预览器，面板只会说「该格式文件暂时无法预览」→ 兜底应给出可播放的 <video>；
//   2) 图片：provider 缺失时面板整块空白（没有任何提示文案）→ 兜底应靠「空白渲染器」判定并画出 <img>。
// 另外顺带验证 /__gw_file 的 Range（206）——视频拖进度条靠它。
// 用法：node scratch/cdp-media-fallback.mjs [sessionId]
import { spawn } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BROWSERS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
];
const PORT = 9337;
const DIR = fileURLToPath(new URL("..", import.meta.url));
const cfg = JSON.parse(readFileSync(join(DIR, "gateway.config.json"), "utf8"));
const base = `http://127.0.0.1:${cfg.port}`;
const profile = mkdtempSync(join(tmpdir(), "dsh-media-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 1. 登录网关，拿到会话 Cookie ----
const login = await fetch(`${base}/__gw_login`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: `token=${encodeURIComponent(cfg.token)}`,
  redirect: "manual"
});
const pair = (login.headers.getSetCookie?.()[0] ?? "").split(";")[0];
const eq = pair.indexOf("=");
const cookie = { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim(), domain: "127.0.0.1", path: "/" };
const cookieHeader = pair;
console.log(`登录网关: status=${login.status}`);

// ---- 2. 找一个工作区就是本目录的会话（兜底只允许读会话工作区内的文件）----
async function rpc(method, args) {
  const res = await fetch(`${base}/api/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookieHeader },
    body: JSON.stringify({ type: "client-request", rpcId: Math.random().toString(16).slice(2), method, payload: { args } })
  });
  const json = await res.json();
  if (json?.result?.ok !== true) throw new Error(`RPC ${method} 失败: ${JSON.stringify(json).slice(0, 300)}`);
  return json.result.value;
}
let sessionId = process.argv[2] ?? "";
if (sessionId === "") {
  const list = await rpc("session/list", { _request: {} });
  const items = list?.items ?? [];
  const mine = items.find((it) => String(it.cwd ?? "").toLowerCase().endsWith("harnessapp")) ?? items[0];
  if (!mine) throw new Error("没有可用会话，无法测试兜底");
  sessionId = mine.sessionId;
  console.log(`使用会话 ${sessionId} (cwd=${mine.cwd})`);
}

const VIDEO_REL = "scratch/gw-test.mp4";
const IMAGE_REL = "scratch/gw-test.png";
const videoAddress = `dsh-resource://file/session/${sessionId}/${VIDEO_REL}`;
const imageAddress = `dsh-resource://file/session/${sessionId}/${IMAGE_REL}`;

// ---- 3. 直连验证 /__gw_file 的 raw 通道：整文件 200 + Range 206 ----
async function rawHead(pathQuery, headers = {}) {
  const res = await fetch(`${base}/__gw_file?${pathQuery}&raw=1`, { headers: { cookie: cookieHeader, ...headers } });
  const len = res.headers.get("content-length");
  const body = headers["range"] ? Buffer.from(await res.arrayBuffer()).length : 0;
  return `${res.status} type=${res.headers.get("content-type")} len=${len} accept-ranges=${res.headers.get("accept-ranges")}`
    + ` content-range=${res.headers.get("content-range")}${headers["range"] ? ` got=${body}` : ""}`;
}
console.log("视频整文件 :", await rawHead(`session=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(VIDEO_REL)}`));
console.log("视频 Range :", await rawHead(`session=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(VIDEO_REL)}`, { range: "bytes=100-199" }));
console.log("图片整文件 :", await rawHead(`session=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(IMAGE_REL)}`));
const json = await (await fetch(`${base}/__gw_file?session=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(VIDEO_REL)}`, { headers: { cookie: cookieHeader } })).json();
console.log("视频元数据 :", JSON.stringify(json));

// ---- 4. 起无头浏览器，打开注入脚本所在的页面，造出手机上的两种故障形态 ----
const browser = BROWSERS.find((p) => { try { readFileSync(p); return true; } catch { return false; } });
const child = spawn(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--autoplay-policy=no-user-gesture-required",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
let wsUrl;
for (let i = 0; i < 40 && !wsUrl; i += 1) {
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl; } catch { /* 还没起来 */ }
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
await S("Network.setCookie", cookie);
await S("Emulation.setDeviceMetricsOverride", { width: 430, height: 932, deviceScaleFactor: 2, mobile: true });
const ev = async (expression) => (await S("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value;

await S("Page.navigate", { url: `${base}/` });
await sleep(7000);
console.log("页面标题:", await ev(`document.title`));

// 摘掉真实界面的预览标记，只留我们造的假预览区（模拟手机上的 provider 缺失）
const makeFake = (address, opts) => `(() => {
  document.querySelectorAll('[data-document-preview]').forEach((el) => el.removeAttribute('data-document-preview'));
  document.querySelectorAll('[data-textpreview-state]').forEach((el) => el.removeAttribute('data-textpreview-state'));
  const oldFake = document.querySelector('[data-harn-test-fake]');
  if (oldFake) oldFake.remove();
  const oldBox = document.querySelector('[data-harn-gw-preview]');
  if (oldBox) oldBox.remove();
  const fake = document.createElement('div');
  fake.setAttribute('data-harn-test-fake', '');
  fake.setAttribute('data-textpreview-state', 'text');
  fake.setAttribute('data-textpreview-url', ${JSON.stringify(address)});
  ${opts.withRenderer ? `fake.setAttribute('data-document-preview', 'image');` : ""}
  const body = document.createElement('div');
  body.setAttribute('data-textpreview-body', '');
  // 真实 DOM 里这句提示是挂在 data-textpreview-unsupported 元素上的（手机上报的 paneAttrs 可见该属性），
  // 注入脚本只认 harness 的状态元素/属性，不再扫正文，所以模拟必须带上这个属性。
  ${opts.bodyText ? `const mark = document.createElement('div');
  mark.setAttribute('data-textpreview-unsupported', '');
  mark.textContent = ${JSON.stringify(opts.bodyText)};
  body.appendChild(mark);` : ""}
  fake.appendChild(body);
  document.body.appendChild(fake);
  return true;
})()`;

// ---- 5. 视频：面板说「该格式文件暂时无法预览」 ----
await ev(makeFake(videoAddress, { withRenderer: false, bodyText: "gw-test.mp4\n该格式文件暂时无法预览" }));
console.log("已造出视频故障形态，等待注入脚本兜底…");
let video = null;
for (let i = 0; i < 12 && !video; i += 1) {
  await sleep(1500);
  const probe = JSON.parse(await ev(`JSON.stringify((() => {
    const v = document.querySelector('[data-harn-gw-preview] video');
    if (!v) return { box: !!document.querySelector('[data-harn-gw-preview]'), video: false };
    return { box: true, video: true, readyState: v.readyState, w: v.videoWidth, h: v.videoHeight,
      duration: Math.round((v.duration || 0) * 10) / 10, src: (v.currentSrc || v.src || '').slice(-60),
      err: v.error ? v.error.code : null };
  })())`));
  if (probe.video) video = probe;
}
console.log("视频兜底:", JSON.stringify(video));
// 拖动进度条：Range 支持的直接体现
const seek = await ev(`(async () => {
  const v = document.querySelector('[data-harn-gw-preview] video');
  if (!v || !isFinite(v.duration) || v.duration <= 0) return 'no-video';
  v.currentTime = Math.max(0.5, v.duration - 0.5);
  await new Promise((r) => setTimeout(r, 1500));
  return 'seek->' + Math.round(v.currentTime * 10) / 10 + 's/' + Math.round(v.duration * 10) / 10 + 's';
})()`);
console.log("视频跳转 :", seek);

// ---- 6. 图片：面板整块空白（没有提示文案），只能靠「已选渲染器 + body 空白」判定 ----
await ev(makeFake(imageAddress, { withRenderer: true }));
console.log("已造出图片故障形态（空白面板），等待注入脚本兜底…");
let image = null;
for (let i = 0; i < 12 && !image; i += 1) {
  await sleep(1500);
  const probe = JSON.parse(await ev(`JSON.stringify((() => {
    const img = document.querySelector('[data-harn-gw-preview] img');
    if (!img) return { box: !!document.querySelector('[data-harn-gw-preview]'), img: false };
    return { box: true, img: true, w: img.naturalWidth, h: img.naturalHeight, src: (img.currentSrc || img.src || '').slice(-50) };
  })())`));
  if (probe.img) image = probe;
}
console.log("图片兜底:", JSON.stringify(image));
console.log("诊断日志尾:", await ev(`JSON.stringify((document.querySelector('[data-harn-gw-preview]')?.innerText || '').slice(0, 120))`));

ws.close(); child.kill(); await sleep(400);
try { rmSync(profile, { recursive: true, force: true }); } catch { /* 忽略 */ }
