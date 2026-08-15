// 会话数据解码层：只读地读取 DeepSeek Harness 的会话日志。
// 数据源：C:\Users\<user>\.dsh\sessions\...\session.jsonl.zstd（zstd 多帧压缩的 JSONL）
// 以及 .dsh\storages\workspace.json / session_projcache.json 索引。
// 本模块只用 Node 内置能力（node:fs、node:zlib），无第三方依赖。

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";
import { zstdDecompressSync } from "node:zlib";

const ZSTD_MAGIC = 4247762216;

// ---------------------------------------------------------------------------
// zstd 多帧容器：按帧边界扫描（与 harness 的 scanZstdFrames 一致）
// ---------------------------------------------------------------------------
export function scanZstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return { frames, tornStart: start };
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`invalid Zstandard frame magic at byte ${offset}`);
    offset += 4;
    if (offset === buffer.length) return { frames, tornStart: start };
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 24) !== 0) throw new Error(`reserved frame-header bit at byte ${offset - 1}`);
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : (1 << contentSizeFlag);
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start };
    offset += remainingHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start };
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) throw new Error(`reserved block type at byte ${offset - 3}`);
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start };
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start };
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return { frames };
}

// ---------------------------------------------------------------------------
// 存储行解码：把打包的 chunk 运行行（text-chunks / reasoning-chunks / tool-call-chunks）
// 还原为原始 assistant/chunk 事件（与 harness 的 decodeStorageRecord 一致）
// ---------------------------------------------------------------------------
export function decodeStorageRecord(value) {
  const tag = value?.type;
  if (tag !== "text-chunks" && tag !== "reasoning-chunks" && tag !== "tool-call-chunks") return [value];
  const members = tag === "tool-call-chunks" ? value.data.args : value.data.texts;
  const out = [];
  let time = value.time0;
  for (let k = 0; k < members.length; k++) {
    if (k > 0) time += value.data.dt[k - 1];
    let chunk;
    if (tag === "text-chunks") chunk = { type: "text-delta", index: value.data.index, text: members[k] };
    else if (tag === "reasoning-chunks") chunk = { type: "reasoning-delta", index: value.data.index, text: members[k] };
    else chunk = {
      type: "tool-call-delta",
      index: value.data.index,
      id: value.data.id,
      ...(Object.hasOwn(value.data, "name") ? { name: value.data.name } : {}),
      argumentsDelta: members[k]
    };
    out.push({ type: "assistant/chunk", seq: value.seq0 + k, time, data: { turn: value.data.turn, step: value.data.step, chunk } });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 把整个 zstd 会话文件解码为 { header, events }；events 按 seq 顺序，已还原 chunk 行。
// ---------------------------------------------------------------------------
export function decodeSessionBuffer(buffer) {
  const { frames } = scanZstdFrames(buffer);
  if (frames.length === 0) throw new Error("empty session log");
  const text = Buffer.concat(frames.map((f) => zstdDecompressSync(buffer.subarray(f.start, f.end)))).toString("utf8");
  const events = [];
  for (const line of text.split("\n")) {
    if (line.length === 0) continue;
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      continue; // 忽略损坏/不完整的尾部行
    }
    events.push(...decodeStorageRecord(value));
  }
  // 第一条是 header 行（type: 'session'），其余是事件
  let header = null;
  if (events.length > 0 && events[0].type === "session") header = events.shift();
  return { header, events };
}

// ---------------------------------------------------------------------------
// 只读取会话文件的 header 行（第一帧），用于会话列表，避免解压全部内容。
// ---------------------------------------------------------------------------
export function readSessionHeader(sessionFilePath) {
  const buffer = readFileSync(sessionFilePath);
  const { frames } = scanZstdFrames(buffer);
  if (frames.length === 0) return null;
  const first = zstdDecompressSync(buffer.subarray(frames[0].start, frames[0].end)).toString("utf8");
  const line = first.split("\n", 1)[0];
  try {
    const parsed = JSON.parse(line);
    return parsed?.type === "session" ? parsed : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 定位会话目录。harness 用 projectKey(cwd) 组织目录；session id 用 encodeSegment 编码。
// 我们直接扫描 sessions 根目录下的所有 project 目录 / session 目录，按 header.id 匹配，
// 这样不依赖 cwd 编码细节，也能容忍未来变化。
// ---------------------------------------------------------------------------
function encodeSegment(raw) {
  if (raw.length === 0) return "";
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) out += ch;
    else out += "~" + code.toString(16).toUpperCase().padStart(4, "0");
  }
  return out;
}

// 在 sessions 根目录下查找某个 session id 的日志文件路径。
export function findSessionLogPath(sessionsRoot, sessionId) {
  const projectDirs = readdirSync(sessionsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(sessionsRoot, d.name));
  const encoded = encodeSegment(sessionId);
  for (const projectDir of projectDirs) {
    const candidate = join(projectDir, encoded, "session.jsonl.zstd");
    if (existsSync(candidate)) return candidate;
    // 也尝试未编码的 id 目录（防御）
    const alt = join(projectDir, sessionId, "session.jsonl.zstd");
    if (existsSync(alt)) return alt;
  }
  // 兜底：递归扫描一层 session 目录
  for (const projectDir of projectDirs) {
    try {
      const sessionDirs = readdirSync(projectDir, { withFileTypes: true }).filter((d) => d.isDirectory());
      for (const sd of sessionDirs) {
        const p = join(projectDir, sd.name, "session.jsonl.zstd");
        if (existsSync(p)) {
          const h = readSessionHeader(p);
          if (h && h.id === sessionId) return p;
        }
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 会话列表：合并 workspace.json（工作区→会话映射）、session_projcache.json（标题/统计）
// 与磁盘上的 header（createdAt / cwd）。
// ---------------------------------------------------------------------------
export function loadWorkspaceIndex(storagesDir) {
  const wsPath = join(storagesDir, "workspace.json");
  const projPath = join(storagesDir, "session_projcache.json");
  let workspaceDoc = { tables: { workspaces: {} } };
  let projDoc = { tables: { sessions: {} } };
  try {
    workspaceDoc = JSON.parse(readFileSync(wsPath, "utf8"));
  } catch {
    /* missing index */
  }
  try {
    projDoc = JSON.parse(readFileSync(projPath, "utf8"));
  } catch {
    /* missing cache */
  }
  return { workspaceDoc, projDoc };
}

// 从 projcache 里取某会话的展示元数据（标题、目标、统计、创建时间）。
export function sessionMetaFromCache(projDoc, sessionId) {
  const entry = projDoc?.tables?.sessions?.[sessionId];
  if (!entry) return null;
  const out = {};
  if (entry.identity?.createdAt != null) out.createdAt = entry.identity.createdAt;
  if (entry.identity?.cwd != null) out.cwd = entry.identity.cwd;
  const title = entry.rows?.title?.val;
  if (typeof title === "string") out.title = title;
  const goal = entry.rows?.goal?.val?.goal?.objective;
  if (typeof goal === "string") out.goal = goal;
  if (entry.rows?.sessionStats?.val) out.stats = entry.rows.sessionStats.val;
  return out;
}

// ---------------------------------------------------------------------------
// 会话详情的 transcript 提取：把事件流折叠成便于前端渲染的段落。
// ---------------------------------------------------------------------------
const MAX_TEXT_BLOCK = 200000; // 单条文本块上限（字符），超过截断

function blockText(block) {
  if (!block) return "";
  if (block.type === "text" || block.type === "reasoning") return typeof block.text === "string" ? block.text : "";
  return "";
}

function truncate(str, max) {
  if (str == null) return "";
  str = String(str);
  if (str.length <= max) return str;
  return str.slice(0, max) + "\n…[内容过长已截断]";
}

// 折叠事件流为前端段落数组。
export function buildTranscript(events) {
  const segments = [];
  for (const event of events) {
    switch (event.type) {
      case "user/message": {
        const data = event.data || {};
        const blocks = Array.isArray(data.content) ? data.content : [];
        const texts = [];
        for (const b of blocks) {
          if (b.type === "text") texts.push(b.text);
        }
        const sourceKind = data.source?.kind;
        const text = truncate(texts.join("\n"), MAX_TEXT_BLOCK);
        if (sourceKind === "user") {
          // 真实用户输入
          segments.push({ kind: "user", time: event.time, turn: data.turn, text, blocks });
        } else {
          // 系统注入的上下文（runtime context / system-reminder / skill 目录等）
          segments.push({ kind: "context", time: event.time, turn: data.turn, text, source: sourceKind || "system" });
        }
        break;
      }
      case "assistant/message": {
        const msg = event.data?.message || {};
        const blocks = Array.isArray(msg.content) ? msg.content : [];
        const texts = [];
        const reasonings = [];
        const toolCalls = [];
        for (const b of blocks) {
          if (b.type === "text") texts.push(b.text);
          else if (b.type === "reasoning") reasonings.push(b.text);
          else if (b.type === "tool-call") toolCalls.push(b);
        }
        segments.push({
          kind: "assistant",
          time: event.time,
          turn: event.data?.turn,
          text: truncate(texts.join("\n\n"), MAX_TEXT_BLOCK),
          reasoning: truncate(reasonings.join("\n\n"), MAX_TEXT_BLOCK),
          toolCalls
        });
        break;
      }
      case "tool/call": {
        const data = event.data || {};
        segments.push({
          kind: "tool-call",
          time: event.time,
          turn: data.turn,
          callId: data.callId,
          name: data.name,
          arguments: data.arguments
        });
        break;
      }
      case "tool/result": {
        const msg = event.data?.message || {};
        const callId = msg.source?.callId || msg.content?.[0]?.toolCallId;
        const block = msg.content?.[0];
        let text = "";
        let isError = false;
        if (block?.type === "tool-result") {
          isError = !!block.isError;
          const inner = Array.isArray(block.content) ? block.content : [];
          text = inner.map((b) => (b.type === "text" ? b.text : "")).join("\n");
        }
        segments.push({
          kind: "tool-result",
          time: event.time,
          turn: event.data?.turn,
          callId,
          text: truncate(text, MAX_TEXT_BLOCK),
          isError
        });
        break;
      }
      default:
        break;
    }
  }
  return segments;
}

// ---------------------------------------------------------------------------
// 文件浏览辅助：列出目录（带类型/大小），安全限制在允许的根目录内。
// ---------------------------------------------------------------------------
export function listDirectory(dirPath) {
  const entries = [];
  for (const e of readdirSync(dirPath, { withFileTypes: true })) {
    const full = join(dirPath, e.name);
    const isDir = e.isDirectory();
    let size = null;
    let mtimeMs = null;
    try {
      const st = statSync(full);
      if (!isDir) size = st.size;
      mtimeMs = st.mtimeMs;
    } catch {
      /* ignore stat errors */
    }
    entries.push({ name: e.name, dir: isDir, size, mtimeMs });
  }
  entries.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, "zh-Hans-CN") : a.dir ? -1 : 1));
  return entries;
}

// 规范化路径并校验是否在允许的根目录内；返回绝对路径或 null。
export function resolveAllowedPath(allowedRoots, inputPath) {
  if (!inputPath) return null;
  const abs = resolve(inputPath);
  const normalized = abs.toLowerCase();
  for (const root of allowedRoots) {
    const r = resolve(root);
    if (normalized === r.toLowerCase() || normalized.startsWith(r.toLowerCase().replace(/[\\/]$/, "") + sep.toLowerCase())) {
      return abs;
    }
  }
  return null;
}

export function pathWithin(root, target) {
  const r = resolve(root);
  const t = resolve(target);
  return t === r || t.startsWith(r.endsWith(sep) ? r : r + sep);
}

export function relativeDisplay(base, target) {
  const rel = relative(base, target);
  return rel || ".";
}
