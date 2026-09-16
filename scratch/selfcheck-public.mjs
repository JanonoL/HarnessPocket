// 公网端到端自检：完全模拟手机走 frp 域名访问（登录 → 取页面 → 开 WebSocket 流）。
// 用法：node scratch/selfcheck-public.mjs [域名] [网关令牌]
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

const host = process.argv[2] || "harness-liuyi.zhkjdream.com";
const token = process.argv[3] || JSON.parse(readFileSync(new URL("../gateway.config.json", import.meta.url), "utf8")).token;
const base = `https://${host}`;

const jar = new Map();
const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
const remember = (res) => {
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(";");
    const at = pair.indexOf("=");
    jar.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
  }
};

// 1) 未登录：应看到网关登录页
const anon = await fetch(`${base}/`, { redirect: "manual" });
const anonHtml = await anon.text();
console.log(`[1] 未登录 GET / → status=${anon.status} 登录页=${anonHtml.includes("Harness 远程访问")} frp404页=${anonHtml.includes("powered by frp")}`);

// 2) 提交网关令牌
const login = await fetch(`${base}/__gw_login`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: `token=${encodeURIComponent(token)}`,
  redirect: "manual"
});
remember(login);
console.log(`[2] 登录 → status=${login.status} 会话Cookie=${jar.has("harn_gw")}`);

// 3) 带会话取页面：应是 harness GUI（含手机端注入），而不是那行英文 401
const page = await fetch(`${base}/`, { headers: { cookie: cookieHeader() } });
const html = await page.text();
console.log(`[3] 已登录 GET / → status=${page.status} bytes=${html.length} GUI=${html.includes("__ModuleLoader__")} 手机注入=${html.includes("data-harn-gw")} 被拒=${html.includes("authentication required")}`);

// 4) WebSocket 流：应能打开 $events 并收到 ready
await new Promise((resolve) => {
  const ws = new WebSocket(`wss://${host}/api/remote.mux?token=${encodeURIComponent(token)}`);
  let messages = 0;
  let ready = false;
  const finish = (note) => { console.log(`[4] WS ${note} 消息数=${messages} 收到ready=${ready}`); try { ws.close(); } catch {} resolve(); };
  ws.on("open", () => { console.log("[4] WS 握手成功"); ws.send(JSON.stringify({ type: "open", streamId: randomUUID(), endpoint: "$events", payload: { args: {} } })); });
  ws.on("message", (data) => { messages += 1; if (String(data).includes('"ready"')) ready = true; });
  ws.on("error", (e) => finish(`error ${e.message}`));
  ws.on("close", (code) => finish(`closed code=${code}`));
  setTimeout(() => finish("5 秒观察结束"), 5000);
});
