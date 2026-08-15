/* DeepSeek Harness 移动端伴侣 —— 前端逻辑（零依赖 vanilla JS） */
(function () {
  "use strict";

  const app = document.getElementById("app");
  const state = {
    token: localStorage.getItem("harn_token") || "",
    config: null,
    workspaces: [],
    wsIndex: 0,
    sessionId: null,
    sessionData: null,
    // 文件浏览
    fileRoots: [],
    rootIndex: 0,
    currentPath: null,
    fileEntries: [],
    viewingFile: null,
    // 视图栈
    tab: "conv",
    view: "list" // list | transcript | fileViewer
  };

  // ---------------------------------------------------------------------------
  // 基础工具
  // ---------------------------------------------------------------------------
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function toast(msg) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  function fmtTime(ms) {
    if (!ms) return "";
    const d = new Date(ms);
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function fmtSize(n) {
    if (n == null) return "";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
    return (n / 1024 / 1024 / 1024).toFixed(2) + " GB";
  }

  function relTime(ms) {
    if (!ms) return "";
    const diff = Date.now() - ms;
    const m = Math.floor(diff / 60000);
    if (m < 1) return "刚刚";
    if (m < 60) return m + " 分钟前";
    const h = Math.floor(m / 60);
    if (h < 24) return h + " 小时前";
    const d = Math.floor(h / 24);
    if (d < 30) return d + " 天前";
    return fmtTime(ms);
  }

  // ---------------------------------------------------------------------------
  // API 调用（带鉴权）
  // ---------------------------------------------------------------------------
  async function api(path, params) {
    const q = new URLSearchParams();
    for (const k in params || {}) {
      if (params[k] !== undefined && params[k] !== null) q.set(k, params[k]);
    }
    const qs = q.toString();
    const url = "/api" + path + (qs ? "?" + qs : "");
    const headers = {};
    if (state.token) headers["Authorization"] = "Bearer " + state.token;
    const resp = await fetch(url, { headers });
    if (resp.status === 401) {
      state.token = "";
      localStorage.removeItem("harn_token");
      renderLogin();
      throw new Error("unauthorized");
    }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || "请求失败");
    return data;
  }

  function rawUrl(path) {
    return "/api/raw?path=" + encodeURIComponent(path) + (state.token ? "&token=" + encodeURIComponent(state.token) : "");
  }

  // ---------------------------------------------------------------------------
  // Markdown 渲染（轻量）
  // ---------------------------------------------------------------------------
  function renderMarkdown(src) {
    if (src == null) return "";
    let text = String(src);
    // 提取 fenced code blocks，先占位，避免被行内规则破坏
    const codes = [];
    text = text.replace(/```([\w+-]*)\n?([\s\S]*?)```/g, (m, lang, code) => {
      const idx = codes.length;
      codes.push({ lang, code: code.replace(/\n$/, "") });
      return "\u0000CODE" + idx + "\u0000";
    });
    // 转义
    let html = esc(text);
    // 行内代码
    html = html.replace(/`([^`\n]+)`/g, (m, c) => "<code>" + c + "</code>");
    // 粗体 / 斜体 / 删除线
    html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
    html = html.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
    html = html.replace(/(^|[^*])\b_([^_\n]+)_\b/g, "$1<em>$2</em>");
    html = html.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
    // 链接
    html = html.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (m, t, u) => '<a href="' + u + '" target="_blank" rel="noopener">' + t + "</a>");
    // 行处理
    const lines = html.split("\n");
    const out = [];
    let listType = null;
    let inQuote = false;
    let para = [];

    const flushPara = () => {
      if (para.length) {
        out.push("<p>" + para.join("<br>") + "</p>");
        para = [];
      }
    };
    const closeList = () => { if (listType) { out.push("</" + listType + ">"); listType = null; } };
    const closeQuote = () => { if (inQuote) { out.push("</blockquote>"); inQuote = false; } };

    for (let line of lines) {
      // 代码占位
      const codeM = line.match(/^\u0000CODE(\d+)\u0000$/);
      if (codeM) {
        flushPara(); closeList(); closeQuote();
        const c = codes[Number(codeM[1])];
        const lang = c.lang ? '<span class="code-lang">' + esc(c.lang) + "</span>" : "";
        out.push("<pre><code>" + esc(c.code) + "</code></pre>");
        continue;
      }
      // 标题
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        flushPara(); closeList(); closeQuote();
        const lvl = h[1].length;
        out.push("<h" + lvl + ">" + h[2] + "</h" + lvl + ">");
        continue;
      }
      // 分隔线
      if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
        flushPara(); closeList(); closeQuote();
        out.push("<hr>");
        continue;
      }
      // 引用（注意：> 已被 esc() 转义为 &gt;）
      const q = line.match(/^\s*&gt;\s?(.*)$/);
      if (q) {
        flushPara(); closeList();
        if (!inQuote) { out.push("<blockquote>"); inQuote = true; }
        out.push("<p>" + q[1] + "</p>");
        continue;
      }
      // 无序列表
      const ul = line.match(/^\s*[-*+]\s+(.*)$/);
      if (ul) {
        flushPara(); closeQuote();
        if (listType !== "ul") { closeList(); out.push("<ul>"); listType = "ul"; }
        out.push("<li>" + ul[1] + "</li>");
        continue;
      }
      // 有序列表
      const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (ol) {
        flushPara(); closeQuote();
        if (listType !== "ol") { closeList(); out.push("<ol>"); listType = "ol"; }
        out.push("<li>" + ol[1] + "</li>");
        continue;
      }
      // 空行
      if (line.trim() === "") {
        flushPara(); closeList(); closeQuote();
        continue;
      }
      // 普通段落
      closeList(); closeQuote();
      para.push(line);
    }
    flushPara(); closeList(); closeQuote();
    return out.join("\n");
  }

  // ---------------------------------------------------------------------------
  // 渲染：登录
  // ---------------------------------------------------------------------------
  function renderLogin() {
    app.innerHTML = `
      <div class="login-wrap">
        <img class="login-logo" src="/icon.svg" alt="logo">
        <div class="login-title">Harness 伴侣</div>
        <div class="login-hint">请输入访问令牌（服务器启动时控制台里显示的「访问令牌」）</div>
        <input class="login-input" id="token-input" type="password" placeholder="访问令牌" autocomplete="off">
        <button class="btn" id="login-btn">进入</button>
      </div>`;
    const input = document.getElementById("token-input");
    const btn = document.getElementById("login-btn");
    const doLogin = async () => {
      state.token = input.value.trim();
      if (!state.token) { toast("请输入访问令牌"); return; }
      try {
        await api("/config");
        localStorage.setItem("harn_token", state.token);
        boot();
      } catch (e) {
        if (e.message !== "unauthorized") toast("令牌无效：" + e.message);
      }
    };
    btn.addEventListener("click", doLogin);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
    setTimeout(() => input.focus(), 50);
  }

  // ---------------------------------------------------------------------------
  // 渲染：App 骨架
  // ---------------------------------------------------------------------------
  function renderShell(title, subtitle, showBack, contentHtml) {
    const back = showBack ? '<button class="back-btn" id="back-btn">‹</button>' : "";
    app.innerHTML = `
      <div class="topbar">
        ${back}
        <div style="flex:1;min-width:0">
          <div class="title">${esc(title)}</div>
          ${subtitle ? '<div class="subtitle">' + esc(subtitle) + "</div>" : ""}
        </div>
      </div>
      <div class="main" id="main">${contentHtml}</div>
      <div class="tabbar" id="tabbar"></div>`;
    const backBtn = document.getElementById("back-btn");
    if (backBtn) backBtn.addEventListener("click", () => { if (state.view === "transcript") showConversationList(); else if (state.view === "fileViewer") showFileList(); });
    renderTabbar();
  }

  function renderTabbar() {
    const tb = document.getElementById("tabbar");
    if (!tb) return;
    const tabs = [
      { id: "conv", icon: "💬", label: "对话" },
      { id: "files", icon: "📁", label: "文件" },
      { id: "settings", icon: "⚙️", label: "设置" }
    ];
    tb.innerHTML = tabs.map((t) => `
      <button class="tab ${state.tab === t.id ? "active" : ""}" data-tab="${t.id}">
        <span class="icon">${t.icon}</span><span>${t.label}</span>
      </button>`).join("");
    tb.querySelectorAll(".tab").forEach((el) => {
      el.addEventListener("click", () => {
        state.tab = el.dataset.tab;
        state.view = "list";
        if (state.tab === "conv") showConversationList();
        else if (state.tab === "files") showFileList();
        else showSettings();
      });
    });
  }

  // ---------------------------------------------------------------------------
  // 对话列表
  // ---------------------------------------------------------------------------
  async function showConversationList() {
    state.view = "list";
    renderShell("对话", "DeepSeek Harness 会话", false, '<div class="main-loading"><div class="spinner" style="margin:40px auto"></div></div>');
    try {
      if (!state.workspaces.length) {
        const d = await api("/workspaces");
        state.workspaces = d.workspaces || [];
      }
      if (state.workspaces.length === 0) {
        renderShell("对话", "DeepSeek Harness 会话", false, '<div class="empty">没有找到会话数据</div>');
        return;
      }
      drawConversationList();
    } catch (e) {
      renderShell("对话", "加载失败", false, '<div class="empty">加载失败：' + esc(e.message) + "</div>");
    }
  }

  function drawConversationList() {
    const ws = state.workspaces;
    if (state.wsIndex >= ws.length) state.wsIndex = 0;
    const cur = ws[state.wsIndex];
    const chips = ws.map((w, i) => `<span class="chip ${i === state.wsIndex ? "active" : ""}" data-ws="${i}">${esc(w.title || w.path.split(/[\\/]/).pop())}</span>`).join("");
    const items = (cur.sessions || []).map((s) => `
      <div class="item" data-sid="${esc(s.id)}">
        <div class="row1">
          <span class="item-title">${esc(s.title || "未命名会话")}</span>
        </div>
        <div class="item-sub">${esc(s.goal || s.cwd || "")}</div>
        <div class="item-meta">${esc(relTime(s.createdAt))}</div>
      </div>`).join("");
    const content = `
      <div class="chips" id="ws-chips">${chips}</div>
      <div class="list">${items || '<div class="empty">该工作区暂无会话</div>'}</div>`;
    renderShell("对话", cur.title || cur.path, false, content);
    document.getElementById("ws-chips").querySelectorAll(".chip").forEach((el) => {
      el.addEventListener("click", () => {
        state.wsIndex = Number(el.dataset.ws);
        drawConversationList();
      });
    });
    document.querySelectorAll(".item[data-sid]").forEach((el) => {
      el.addEventListener("click", () => openTranscript(el.dataset.sid));
    });
  }

  async function openTranscript(sid) {
    state.sessionId = sid;
    state.view = "transcript";
    renderShell("加载会话…", sid, true, '<div class="main-loading"><div class="spinner" style="margin:40px auto"></div></div>');
    try {
      const d = await api("/sessions", { id: sid });
      state.sessionData = d;
      drawTranscript(d);
    } catch (e) {
      renderShell("加载失败", "", true, '<div class="empty">加载失败：' + esc(e.message) + "</div>");
    }
  }

  function drawTranscript(d) {
    const title = findSessionTitle(sidMeta(d.id));
    const segs = d.segments || [];
    let html = '<div class="transcript">';
    for (const seg of segs) {
      if (seg.kind === "user") {
        html += `<div class="msg user"><div class="bubble"><div class="md">${renderMarkdown(seg.text)}</div></div><div class="role">我</div></div>`;
      } else if (seg.kind === "context") {
        html += `<div class="reasoning" data-reasoning><div class="reasoning-head"><span class="chev">▶</span><span>系统上下文（${esc(seg.source || "system")}）</span></div><div class="reasoning-body"><div class="md">${renderMarkdown(seg.text)}</div></div></div>`;
      } else if (seg.kind === "assistant") {
        let body = "";
        if (seg.reasoning && seg.reasoning.trim()) {
          body += `<div class="reasoning" data-reasoning><div class="reasoning-head"><span class="chev">▶</span><span>思考过程</span></div><div class="reasoning-body"><div class="md">${renderMarkdown(seg.reasoning)}</div></div></div>`;
        }
        if (seg.text && seg.text.trim()) {
          body += `<div class="bubble"><div class="md">${renderMarkdown(seg.text)}</div></div>`;
        }
        if (!body) body = '<div class="bubble">…</div>';
        html += `<div class="msg assistant">${body}<div class="role">助手</div></div>`;
      } else if (seg.kind === "tool-call") {
        let args = "";
        try { args = JSON.stringify(JSON.parse(seg.arguments), null, 2); } catch { args = seg.arguments || ""; }
        html += `<div class="tool" data-tool><div class="tool-head"><span class="tw">🛠</span><span class="tool-name">${esc(seg.name || "tool")}</span><span class="tool-status">调用</span><span class="chev">▶</span></div><div class="tool-body"><div class="kv-label">参数</div><pre>${esc(args)}</pre></div></div>`;
      } else if (seg.kind === "tool-result") {
        const status = seg.isError ? '<span class="tool-status err">错误</span>' : '<span class="tool-status ok">完成</span>';
        html += `<div class="tool" data-tool><div class="tool-head"><span class="tw">📄</span><span class="tool-name">结果</span>${status}<span class="chev">▶</span></div><div class="tool-body"><div class="kv-label">输出</div><pre>${esc(seg.text || "(空)")}</pre></div></div>`;
      }
    }
    if (segs.length === 0) html += '<div class="empty">该会话没有可展示的消息</div>';
    html += "</div>";

    renderShell(title || "会话", `${segs.length} 条消息 · ${d.eventCount} 个事件`, true, html);
    // 折叠交互
    document.querySelectorAll("[data-reasoning], [data-tool]").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target.closest("a")) return;
        el.classList.toggle("open");
      });
    });
    // 滚动到底部
    const main = document.getElementById("main");
    if (main) main.scrollTop = main.scrollHeight;
  }

  function sidMeta(sid) {
    for (const w of state.workspaces) for (const s of w.sessions || []) if (s.id === sid) return s;
    return null;
  }
  function findSessionTitle(meta) {
    return meta?.title || null;
  }

  // ---------------------------------------------------------------------------
  // 文件浏览
  // ---------------------------------------------------------------------------
  async function showFileList() {
    state.view = "list";
    renderShell("文件", "生成的文件", false, '<div class="main-loading"><div class="spinner" style="margin:40px auto"></div></div>');
    try {
      if (!state.fileRoots.length) {
        const d = await api("/config");
        state.fileRoots = d.workspaceRoots || [];
        state.config = d;
      }
      if (!state.fileRoots.length) {
        renderShell("文件", "", false, '<div class="empty">没有可浏览的工作区目录</div>');
        return;
      }
      if (state.rootIndex >= state.fileRoots.length) state.rootIndex = 0;
      state.currentPath = state.fileRoots[state.rootIndex];
      await loadDir(state.currentPath);
    } catch (e) {
      renderShell("文件", "加载失败", false, '<div class="empty">加载失败：' + esc(e.message) + "</div>");
    }
  }

  async function loadDir(path) {
    state.currentPath = path;
    try {
      const d = await api("/files", { path });
      state.fileEntries = d.entries || [];
      drawFileList(d);
    } catch (e) {
      toast("加载目录失败：" + e.message);
    }
  }

  function drawFileList(d) {
    const roots = state.fileRoots;
    const chips = roots.map((r, i) => `<span class="chip ${normPath(r) === normPath(state.currentPath) || i === state.rootIndex ? "active" : ""}" data-root="${i}">${esc(rootLabel(r))}</span>`).join("");
    // 面包屑
    const crumbs = buildCrumbs(d.path, roots);
    const bread = crumbs.map((c, i) => (i === crumbs.length - 1
      ? `<span class="crumb current">${esc(c.name)}</span>`
      : `<span class="crumb" data-path="${esc(c.path)}">${esc(c.name)}</span><span class="crumb-sep">/</span>`)).join("");
    const entries = state.fileEntries.map((e) => `
      <div class="file-item ${e.dir ? "folder" : ""}" data-path="${esc(joinPath(d.path, e.name))}" data-dir="${e.dir ? 1 : 0}">
        <span class="ficon">${e.dir ? "📁" : fileIcon(e.name)}</span>
        <span class="fname">${esc(e.name)}</span>
        <span class="fsize">${e.dir ? "" : esc(fmtSize(e.size))}</span>
      </div>`).join("");
    const content = `
      <div class="chips" id="root-chips">${chips}</div>
      <div class="breadcrumb" id="breadcrumb">${bread}</div>
      <div class="list">${entries || '<div class="empty">空目录</div>'}</div>`;
    renderShell("文件", d.path, false, content);

    document.getElementById("root-chips").querySelectorAll(".chip").forEach((el) => {
      el.addEventListener("click", () => {
        state.rootIndex = Number(el.dataset.root);
        loadDir(state.fileRoots[state.rootIndex]);
      });
    });
    document.getElementById("breadcrumb").querySelectorAll(".crumb[data-path]").forEach((el) => {
      el.addEventListener("click", () => loadDir(el.dataset.path));
    });
    document.querySelectorAll(".file-item").forEach((el) => {
      el.addEventListener("click", () => {
        const p = el.dataset.path;
        if (el.dataset.dir === "1") loadDir(p);
        else openFile(p);
      });
    });
  }

  function rootLabel(r) {
    const parts = r.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || r;
  }

  function normPath(p) {
    return String(p || "").replace(/\\/g, "/").replace(/\/+$/, "");
  }

  function joinPath(base, name) {
    return base.replace(/[\\/]+$/, "") + "/" + name;
  }

  function buildCrumbs(path, roots) {
    const norm = (p) => String(p).replace(/\\/g, "/");
    const np = norm(path);
    const nroots = roots.map(norm);
    // 找到所属根（分隔符无关比较）
    let root = roots[0];
    let nroot = nroots[0].replace(/\/+$/, "");
    for (let i = 0; i < nroots.length; i++) {
      const r = nroots[i].replace(/\/+$/, "");
      if (np === r || np.startsWith(r + "/")) { root = roots[i]; nroot = r; break; }
    }
    const out = [];
    out.push({ name: rootLabel(root), path: root });
    const rest = np.slice(nroot.length).split("/").filter(Boolean);
    let cur = norm(root).replace(/\/+$/, "");
    for (const part of rest) {
      cur = cur + "/" + part;
      out.push({ name: part, path: cur });
    }
    return out;
  }

  function fileIcon(name) {
    const ext = name.split(".").pop().toLowerCase();
    if (["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp"].includes(ext)) return "🖼";
    if (["md", "txt", "log"].includes(ext)) return "📄";
    if (["json", "yaml", "yml", "toml", "xml"].includes(ext)) return "🧾";
    if (["js", "ts", "jsx", "tsx", "py", "java", "go", "rs", "c", "cpp", "cs", "sh", "ps1", "mjs", "css", "html", "sql"].includes(ext)) return "💻";
    if (["zip", "gz", "tar", "7z", "rar", "zstd"].includes(ext)) return "🗜";
    if (["pdf"].includes(ext)) return "📕";
    return "📄";
  }

  async function openFile(path) {
    state.view = "fileViewer";
    state.viewingFile = { path };
    renderShell("加载中…", path, true, '<div class="main-loading"><div class="spinner" style="margin:40px auto"></div></div>');
    try {
      const d = await api("/file", { path });
      drawFileViewer(d);
    } catch (e) {
      renderShell("打开失败", path, true, '<div class="empty">打开失败：' + esc(e.message) + "</div>");
    }
  }

  function drawFileViewer(d) {
    let body;
    if (d.image) {
      body = `<div class="img-wrap"><img src="${esc(rawUrl(d.path))}" alt="${esc(d.name)}"></div>`;
    } else if (d.binary) {
      body = `<div class="empty">二进制文件（${esc(fmtSize(d.size))}），无法直接预览。</div>`;
    } else if (d.tooLarge) {
      body = `<div class="empty">文件过大（${esc(fmtSize(d.size))}），超过 ${esc(fmtSize(d.maxFileBytes))} 预览上限。</div>`;
    } else {
      const isMd = /\.(md|markdown)$/i.test(d.name);
      body = isMd
        ? `<div class="md-view md">${renderMarkdown(d.content)}</div>`
        : `<pre class="code-view">${esc(d.content || "")}</pre>`;
    }
    const name = d.name || d.path;
    renderShell("文件", name, true, `<div class="file-viewer"><div class="fv-toolbar"><span class="fv-name">${esc(name)}</span><span class="fsize">${esc(fmtSize(d.size))}</span></div><div class="fv-body">${body}</div></div>`);
  }

  // ---------------------------------------------------------------------------
  // 设置
  // ---------------------------------------------------------------------------
  async function showSettings() {
    state.view = "list";
    renderShell("设置", "连接与访问令牌", false, '<div class="settings"><div class="spinner" style="margin:40px auto"></div></div>');
    let cfg = state.config;
    try {
      cfg = await api("/config");
      state.config = cfg;
      state.fileRoots = cfg.workspaceRoots || [];
    } catch (e) {
      /* ignore */
    }
    const url = location.origin;
    const content = `
      <div class="settings">
        <div class="card">
          <div class="card-title">服务器</div>
          <div class="kv"><span class="k">地址</span><span class="v">${esc(url)}</span></div>
          <div class="kv"><span class="k">数据目录</span><span class="v">${esc(cfg?.dsHome || "")}</span></div>
        </div>
        <div class="card">
          <div class="card-title">访问令牌（修改后保存）</div>
          <input class="login-input" id="set-token" type="text" value="${esc(state.token)}" autocomplete="off">
          <div style="height:10px"></div>
          <button class="btn secondary" id="save-token">保存令牌</button>
        </div>
        <div class="card">
          <div class="card-title">工作区目录</div>
          ${(cfg?.workspaceRoots || []).map((r) => `<div class="kv"><span class="k">📁</span><span class="v">${esc(r)}</span></div>`).join("") || '<div class="kv"><span class="k">无</span></div>'}
        </div>
        <button class="btn" id="test-conn">测试连接</button>
      </div>`;
    renderShell("设置", "连接与访问令牌", false, content);
    document.getElementById("save-token").addEventListener("click", () => {
      const v = document.getElementById("set-token").value.trim();
      state.token = v;
      localStorage.setItem("harn_token", v);
      toast("令牌已保存");
    });
    document.getElementById("test-conn").addEventListener("click", async () => {
      try {
        const h = await api("/health");
        toast("连接正常 ✓");
      } catch (e) {
        toast("连接失败：" + e.message);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 启动
  // ---------------------------------------------------------------------------
  async function boot() {
    try {
      const cfg = await api("/config");
      state.config = cfg;
      state.fileRoots = cfg.workspaceRoots || [];
      state.workspaces = [];
      state.wsIndex = 0;
      state.tab = "conv";
      state.view = "list";
      showConversationList();
    } catch (e) {
      if (e.message === "unauthorized") return; // renderLogin 已处理
      renderLogin();
    }
  }

  // 首次进入
  if (state.token) {
    boot();
  } else {
    // 先探测是否需要令牌
    fetch("/api/config").then((r) => r.json()).then((cfg) => {
      if (cfg && cfg.tokenRequired === false) {
        boot();
      } else {
        renderLogin();
      }
    }).catch(() => renderLogin());
  }

  // PWA service worker 注册
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }
})();
