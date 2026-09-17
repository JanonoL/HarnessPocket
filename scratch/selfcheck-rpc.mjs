// 用 harness 的 HTTP RPC 直连 3080，看看 session/list 返回什么（用来把文件地址解析成绝对路径）。
// 用法：node scratch/selfcheck-rpc.mjs
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { request } from "node:http";

const dshHome = process.env.DSH_HOME || join(homedir(), ".dsh");
const secretText = /client-connection\/browser-session:[\s\S]*?secret:\s*([A-Za-z0-9_-]{20,})/u.exec(readFileSync(join(dshHome, ".credentials.yaml"), "utf8"))[1];
const secret = Buffer.from(secretText.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (secretText.length % 4)) % 4), "base64");
const b64 = (b) => Buffer.from(b).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
const authority = "127.0.0.1:3080";
const now = Date.now();
const body = b64(Buffer.from(JSON.stringify({ version: 1, authority, issuedAt: now, expiresAt: now + 86400_000 }), "utf8"));
const cookie = `dsh-auth-${b64(createHash("sha256").update(authority).digest())}=v1.${body}.${b64(createHmac("sha256", secret).update(body).digest())}`;

function rpc(endpoint, payload) {
  const rpcId = randomUUID();
  return new Promise((resolve) => {
    const req = request({
      host: "127.0.0.1", port: 3080, path: `/api/${endpoint}`, method: "POST",
      headers: { host: authority, cookie, "content-type": "application/json", "content-length": Buffer.byteLength(JSON.stringify({ type: "client-request", rpcId, method: endpoint, payload })) }
    }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { data += c; });
      res.on("end", () => resolve({ status: res.statusCode, data }));
    });
    req.end(JSON.stringify({ type: "client-request", rpcId, method: endpoint, payload }));
  });
}

let list = null;
for (const payload of [{ args: { _request: {} } }, { args: { _request: null } }, { args: { _request: { workspaceId: null } } }]) {
  const attempt = await rpc("session/list", payload);
  console.log("尝试", JSON.stringify(payload), "->", attempt.data.slice(0, 220));
  if (attempt.data.includes('"ok":true')) { list = attempt; break; }
}
list = list ?? { status: 0, data: "{}" };
console.log("session/list status =", list.status);
const parsed = JSON.parse(list.data);
console.log("原始响应:", list.data.slice(0, 600));
console.log("result.ok =", parsed.result?.ok);
const value = parsed.result?.value;
const list2 = Array.isArray(value) ? value : (value?.sessions ?? []);
console.log("会话条数 =", list2.length);
if (list2[0]) {
  console.log("首条会话字段:", Object.keys(list2[0]).join(", "));
  console.log("首条会话内容(截断):", JSON.stringify(list2[0]).slice(0, 500));
}
