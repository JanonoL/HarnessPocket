// 读取当前远程访问信息（HTTPS 地址 + 访问令牌），供一键安装脚本展示。
// 用法：node info.mjs
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TS = "C:\\Program Files\\Tailscale\\tailscale.exe";

// 1. 访问令牌（从 gateway.config.json 读，保证与网关实际一致）
let token = "";
try {
  token = JSON.parse(readFileSync(join(__dirname, "gateway.config.json"), "utf8")).token || "";
} catch {}

// 2. HTTPS 地址（从 tailscale status --json 读 DNSName）
let url = "";
try {
  const out = execSync(`"${TS}" status --json`, { timeout: 10000 }).toString();
  const j = JSON.parse(out);
  const dns = j?.Self?.DNSName;
  if (typeof dns === "string" && dns.length > 0) {
    url = "https://" + dns.replace(/\.$/, "") + "/";
  }
} catch {}

console.log(url);
console.log(token);
