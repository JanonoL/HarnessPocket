// 拿真实视频文件走网关，测浏览器媒体栈能不能起播（重点：moov 在尾部的非 faststart mp4 需要 Range）。
// 用法：node scratch/cdp-video-play-check.mjs "F:\\path\\to\\video.mp4"
import { spawn } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BROWSERS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
];
const PORT = 9341;
const cfg = JSON.parse(readFileSync(new URL("../gateway.config.json", import.meta.url), "utf8"));
const base = `http://127.0.0.1:${cfg.port}`;
const file = process.argv[2] || "F:\\workspacecraftsmen\\craftsmen\\agi\\scratch\\outputs\\rounds\\1491\\visuals\\small_seed92000000.mp4";
const size = statSync(file).size;
const profile = mkdtempSync(join(tmpdir(), "dsh-vplay-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const rawUrl = `/__gw_file?absolute=${encodeURIComponent(file)}&raw=1`;
console.log(`文件: ${file}`);
console.log(`大小: ${size} 字节`);
// 头两字节所在的位置决定 moov 在前还是在后：浏览器起播要靠它能拿到 moov
const head = await fetch(`${base}${rawUrl}`, { headers: { cookie: cookieHeader, range: `bytes=${Math.max(0, size - 8)}-` } });
const tail = Buffer.from(await head.arrayBuffer()).toString("latin1");
console.log(`尾部 Range 请求: ${head.status} content-range=${head.headers.get("content-range")} 尾字节含 moov=${tail.includes("moov")}`);

const browser = BROWSERS.find((p) => { try { readFileSync(p); return true; } catch { return false; } });
const child = spawn(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--autoplay-policy=no-user-gesture-required",
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
await S("Emulation.setDeviceMetricsOverride", { width: 430, height: 932, deviceScaleFactor: 2, mobile: true });
await S("Network.setCookie", cookie);
const ev = async (expression) => (await S("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value;
await S("Page.navigate", { url: `${base}/` });
await sleep(5000);

const result = await ev(`(async () => {
  const v = document.createElement('video');
  v.controls = true; v.muted = true; v.playsInline = true;
  v.style.cssText = 'position:fixed;left:0;top:0;width:320px;z-index:2147483647';
  const events = [];
  for (const n of ['loadstart','loadedmetadata','loadeddata','canplay','playing','error','stalled','suspend']) {
    v.addEventListener(n, () => events.push(n + (n === 'error' ? ':' + (v.error && v.error.code) : '')));
  }
  v.src = ${JSON.stringify(rawUrl)};
  document.body.appendChild(v);
  await new Promise((r) => setTimeout(r, 8000));
  let played = 'no';
  try { await v.play(); await new Promise((r) => setTimeout(r, 1500)); played = v.paused ? 'paused' : 'playing@' + v.currentTime.toFixed(2) + 's'; } catch (e) { played = 'play-throw:' + e.name; }
  return JSON.stringify({ readyState: v.readyState, networkState: v.networkState, duration: v.duration,
    w: v.videoWidth, h: v.videoHeight, played, events, seekable: v.seekable.length > 0 ? v.seekable.end(0) : null });
})()`);
console.log("播放结果:", result);

ws.close(); child.kill(); await sleep(400);
try { rmSync(profile, { recursive: true, force: true }); } catch { /* 忽略 */ }
