// SSE 存活探测：走公网域名连 /plugins/events，记录每个数据分片的到达时间与断开时刻。
// 用法：node scratch/selfcheck-sse.mjs [秒数] [url 前缀]
import { readFileSync } from "node:fs";

const seconds = Number(process.argv[2] || 80);
const host = process.argv[3] || "harness-liuyi.zhkjdream.com";
const cfg = JSON.parse(readFileSync(new URL("../gateway.config.json", import.meta.url), "utf8"));
const base = host.includes("://") ? host : `https://${host}`;

const jar = new Map();
const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
const login = await fetch(`${base}/__gw_login`, {
  method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
  body: `token=${encodeURIComponent(cfg.token)}`, redirect: "manual"
});
for (const raw of login.headers.getSetCookie?.() ?? []) {
  const [pair] = raw.split(";");
  const i = pair.indexOf("=");
  jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
}
console.log(`登录=${login.status} 会话Cookie=${jar.size}`);

const started = Date.now();
const at = () => `+${((Date.now() - started) / 1000).toFixed(1)}s`;
try {
  const res = await fetch(`${base}/plugins/events`, { headers: { cookie: cookie(), accept: "text/event-stream" }, signal: AbortSignal.timeout(seconds * 1000) });
  console.log(`${at()} status=${res.status} content-type=${res.headers.get("content-type")}`);
  let chunks = 0;
  let bytes = 0;
  for await (const chunk of res.body) {
    chunks += 1;
    bytes += chunk.length;
    if (chunks <= 5 || chunks % 5 === 0) console.log(`${at()} 分片#${chunks} ${chunk.length}B: ${JSON.stringify(Buffer.from(chunk).toString("utf8").slice(0, 60))}`);
  }
  console.log(`${at()} 流正常结束 分片=${chunks} 字节=${bytes}`);
} catch (error) {
  console.log(`${at()} 断开/超时: ${error.name}: ${error.message}  （累计观察 ${((Date.now() - started) / 1000).toFixed(1)}s）`);
}
