// 本机链路自检：模拟手机经 网关（8443）→ harness（3080）的请求（HTTP + WebSocket 流）。
// 用法：node scratch/selfcheck-gateway.mjs [网关令牌]
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { request } from "node:http";
import WebSocket from "ws";

const token = process.argv[2] || JSON.parse(readFileSync(new URL("../gateway.config.json", import.meta.url), "utf8")).token;
const BASE = "http://127.0.0.1:8443";

function http(label, { method = "GET", path = "/", headers = {}, body } = {}) {
  return new Promise((resolve) => {
    const headers2 = { ...headers, authorization: `Bearer ${token}` };
    if (body !== undefined) headers2["content-type"] = "application/json";
    const req = request(`${BASE}${path}`, { method, headers: headers2 }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        const kind = /text\/html/u.test(res.headers["content-type"] || "") ? "HTML" : (res.headers["content-type"] || "");
        console.log(`[${label}] status=${res.statusCode} ${kind} bytes=${data.length} first=${JSON.stringify(data.slice(0, 60))}`);
        resolve();
      });
    });
    req.on("error", (e) => { console.log(`[${label}] error ${e.message}`); resolve(); });
    if (body !== undefined) req.write(body);
    req.end();
  });
}

// 与浏览器客户端一致：握手后用 text 帧发一条 {type:"open"} 打开 $events 逻辑流
function wsProbe(label, path, openEventStream, waitMs) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:8443${path}`);
    let messages = 0;
    let firstItem = "";
    const done = (note) => { console.log(`[${label}] ${note} 收到消息=${messages} 首条=${firstItem}`); try { ws.close(); } catch {} resolve(); };
    ws.on("open", () => {
      console.log(`[${label}] 握手成功（upgrade 通过）`);
      if (openEventStream) ws.send(JSON.stringify({ type: "open", streamId: randomUUID(), endpoint: "$events", payload: { args: {} } }));
    });
    ws.on("message", (data) => { messages += 1; if (messages === 1) firstItem = String(data).slice(0, 90); });
    ws.on("error", (e) => done(`error ${e.message}`));
    ws.on("close", (code, reason) => done(`closed code=${code} reason=${reason.toString()}`));
    setTimeout(() => done(`${waitMs}ms 观察结束`), waitMs);
  });
}

await http("GET / 无客户端 Cookie", {});
await http("GET / 带同名伪造 Cookie", { headers: { cookie: "dsh-auth-VPhEEcLKeqRDBoBalzN2Nm7CnfxKhLE00pKIDWxt1sw=forged.bad.value" } });
await http("POST /api/session/list", { method: "POST", path: "/api/session/list", body: "{}" });
await wsProbe("WS 仅握手", `/api/remote.mux?token=${encodeURIComponent(token)}`, false, 1500);
await wsProbe("WS 打开 $events 流", `/api/remote.mux?token=${encodeURIComponent(token)}`, true, 4000);
