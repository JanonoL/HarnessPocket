/* 移动端增强脚本：由远程网关注入。
   1) 老内核兜底：补几个近两年才普及的 API（国产内核/旧 WebView 常常没有），
      缺了它们 harness 客户端的插件会静默不生效，典型症状就是「文件资源服务不可用」。
   2) 客户端插件探针：harness 的客户端插件是内联的 __ModuleLoader__.load({id,factory})，
      工厂抛错 / apply 没被调用时页面不会报错，只表现为某个 provider 静默缺失，这里记录下来上报。
   3) 客户端报错上报：手机上看不到 console，出错信息回传到网关 client.log。
   4) 抽屉交互 + 文件预览自愈（含图片、视频兜底：harness 客户端没有视频预览器）。 */
(function () {
  // ---- 1. 老内核兜底 ----
  try {
    if (typeof Promise.withResolvers !== "function") {
      Promise.withResolvers = function () {
        var deferred = {};
        deferred.promise = new Promise(function (resolve, reject) { deferred.resolve = resolve; deferred.reject = reject; });
        return deferred;
      };
    }
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout !== "function") {
      AbortSignal.timeout = function (ms) {
        var controller = new AbortController();
        setTimeout(function () {
          try { controller.abort(new DOMException("TimeoutError", "TimeoutError")); } catch (e) { controller.abort(); }
        }, ms);
        return controller.signal;
      };
    }
    if (typeof AbortSignal !== "undefined" && AbortSignal.prototype && typeof AbortSignal.prototype.throwIfAborted !== "function") {
      AbortSignal.prototype.throwIfAborted = function () { if (this.aborted) throw this.reason; };
    }
    if (typeof Object.hasOwn !== "function") {
      Object.hasOwn = function (object, key) { return Object.prototype.hasOwnProperty.call(object, key); };
    }
    if (typeof Array.prototype.at !== "function") {
      Array.prototype.at = function (index) {
        var i = Math.trunc(index) || 0;
        if (i < 0) i += this.length;
        return (i < 0 || i >= this.length) ? undefined : this[i];
      };
    }
    if (typeof String.prototype.at !== "function") {
      String.prototype.at = function (index) { return Array.prototype.at.call(this, index); };
    }
  } catch (e) { /* 兜底失败也不能影响页面 */ }

  // ---- 1.1 URL 解析补齐（真正的根因）----
  // 文件地址形如 dsh-resource://file/session/<会话id>/<路径>，harness 客户端靠
  // 「new URL(address).hostname」找 provider（见 dsh-client-resources 的 protocolOf：
  // parsed.hostname === "" ? undefined : ...）。正统 Chromium 给出 hostname="file"；
  // 华为浏览器（ArkWeb）等内核对自定义 scheme 不解析 authority，给出
  // hostname="" 且 pathname="//file/session/..."，于是 provider 永远找不到，
  // 文本/图片/PDF 预览全部变成「文件资源服务不可用」，刷新也不会好。
  // 这里只在「浏览器自己解析出空 host」时接管 host/hostname/pathname 三个取值。
  (function () {
    try {
      var proto = window.URL && URL.prototype;
      if (!proto) return;
      var probe;
      try { probe = new URL("dsh-resource://file/session/x/y.txt"); } catch (e) { return; }
      var broken = probe.hostname === "" && probe.pathname.indexOf("//") === 0;
      if (!broken) return;   // 内核正常，什么都不做
      function authorityOf(href) {
        var m = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]*)/.exec(String(href));
        if (m === null || m[1] === "") return null;
        var host = m[1].split("@").pop().toLowerCase();
        var hostname = host.replace(/:\d*$/u, "");
        if (hostname === "") return null;
        return { host: host, hostname: hostname };
      }
      ["host", "hostname", "pathname"].forEach(function (name) {
        var desc = Object.getOwnPropertyDescriptor(proto, name);
        if (!desc || typeof desc.get !== "function") return;
        Object.defineProperty(proto, name, {
          configurable: true,
          enumerable: desc.enumerable,
          get: function () {
            var value = desc.get.call(this);
            var looksBroken = value === "" || (name === "pathname" && value.indexOf("//") === 0);
            if (!looksBroken) return value;
            var fixed = authorityOf(this.href);
            if (fixed === null) return value;
            if (name !== "pathname") return fixed[name];
            // "//file/session/x" → "/session/x"
            var rest = value.replace(/^\/\//u, "").replace(/[?#][\s\S]*$/u, "");
            if (rest.indexOf(fixed.host) === 0) rest = rest.slice(fixed.host.length);
            return rest.charAt(0) === "/" ? rest : "/" + rest;
          }
        });
      });
    } catch (e) { /* 补齐失败不影响页面 */ }
  })();

  // ---- 1.5 客户端插件探针 ----
  // harness 的客户端插件以内联模块形式加载：window.__ModuleLoader__.load({ id, factory }).
  // 工厂抛错、或 apply 根本没被调用（依赖服务没就绪）时，页面不会有任何报错，
  // 只会表现成「某个 provider 静默缺失」。这里把加载/apply 结果记下来随诊断上报。
  var PLUGIN_LOG = { loaded: 0, applied: 0, issues: [], ids: [] };
  // 与预览链路直接相关的插件：手机上这几个的加载/apply 结果，就是「provider 为什么不在」的答案
  var PLUGIN_KEY = /workspace-files|client-resources|sidebar-documentpreview|client-modules/u;
  function pluginNote(text) {
    try { if (PLUGIN_LOG.issues.length < 20) PLUGIN_LOG.issues.push(String(text).slice(0, 150)); } catch (e) { /* 忽略 */ }
  }
  function pluginId(id) {
    try { if (PLUGIN_LOG.ids.length < 80) PLUGIN_LOG.ids.push(String(id)); } catch (e) { /* 忽略 */ }
  }
  function keyPlugins() {
    var out = [];
    for (var i = 0; i < PLUGIN_LOG.ids.length && out.length < 8; i++) {
      if (PLUGIN_KEY.test(PLUGIN_LOG.ids[i])) out.push(PLUGIN_LOG.ids[i].replace("@deepseek-ai/dsh-", ""));
    }
    return out.join(",");
  }
  try {
    function wrapLoader(loader) {
      if (!loader || typeof loader.load !== "function" || loader.load.__gwWrapped === true) return loader;
      var origLoad = loader.load;
      loader.load = function (entry) {
        var id = entry && entry.id ? String(entry.id) : "?";
        PLUGIN_LOG.loaded += 1;
        pluginId(id);
        if (entry && typeof entry.factory === "function") {
          var origFactory = entry.factory;
          entry.factory = function () {
            var mod;
            try {
              mod = origFactory.apply(this, arguments);
            } catch (e) {
              pluginNote("factory-throw " + id + ": " + ((e && e.message) || e));
              throw e;
            }
            try {
              if (mod && typeof mod.apply === "function" && mod.apply.__gwWrapped !== true) {
                var origApply = mod.apply;
                var wrapped = function () {
                  var out;
                  try {
                    out = origApply.apply(this, arguments);
                  } catch (e) {
                    pluginNote("apply-throw " + id + ": " + ((e && e.message) || e));
                    throw e;
                  }
                  if (out && typeof out.then === "function") {
                    out.then(function () { PLUGIN_LOG.applied += 1; }, function (e) { pluginNote("apply-reject " + id + ": " + ((e && e.message) || e)); });
                  } else {
                    PLUGIN_LOG.applied += 1;
                  }
                  return out;
                };
                wrapped.__gwWrapped = true;
                mod.apply = wrapped;
              }
            } catch (e) { /* 包裹失败不影响加载 */ }
            return mod;
          };
        }
        try {
          return origLoad.apply(this, arguments);
        } catch (e) {
          pluginNote("load-throw " + id + ": " + ((e && e.message) || e));
          throw e;
        }
      };
      loader.load.__gwWrapped = true;   // 标记包装函数本身：应用启动后若换掉 load，下一轮轮询会重新包上
      return loader;
    }
    // __ModuleLoader__ 通常由 harness 的引导脚本挂上（在我们之后）：拦赋值，再轮询兜底。
    // 关键：如果它已经存在（注入点被改动、页面结构变化等），只能就地包一层，
    // 绝不能用访问器去顶替它 —— 那会让 window.__ModuleLoader__ 变成 undefined，
    // 触发 "web boot: window.__ModuleLoader__ bootstrap facade is missing"，整个插件系统起不来。
    var loaderValue = window.__ModuleLoader__;
    if (loaderValue) {
      wrapLoader(loaderValue);
    } else {
      try {
        Object.defineProperty(window, "__ModuleLoader__", {
          configurable: true,
          get: function () { return loaderValue; },
          set: function (value) { loaderValue = value === undefined ? undefined : wrapLoader(value); }
        });
      } catch (e) { /* 定义失败就走下面的轮询 */ }
    }
    var loaderTries = 0;
    var loaderTimer = setInterval(function () {
      loaderTries += 1;
      try { if (window.__ModuleLoader__) wrapLoader(window.__ModuleLoader__); } catch (e) { /* 忽略 */ }
      // 插件模块是分批加载的（引导批 + 应用批），load 还可能在启动后被换掉，所以持续观察 60 秒
      if (loaderTries > 600) clearInterval(loaderTimer);
    }, 100);
  } catch (e) { /* 探针失败不影响页面 */ }

  // ---- 2. 客户端报错上报 ----
  var DIAG_ERRORS = [];
  var DIAG_MAX = 25;
  var diagSent = {};
  function diagPush(kind, text) {
    try {
      if (DIAG_ERRORS.length >= DIAG_MAX) DIAG_ERRORS.shift();
      DIAG_ERRORS.push(new Date().toISOString().slice(11, 19) + " " + kind + ": " + String(text).slice(0, 400));
    } catch (e) { /* 忽略 */ }
  }
  try {
    window.addEventListener("error", function (e) {
      var target = e.target;
      if (target && target !== window && (target.tagName === "SCRIPT" || target.tagName === "LINK" || target.tagName === "IMG")) {
        diagPush("resource", target.tagName + " " + (target.src || target.href || ""));
        return;
      }
      diagPush("error", (e.message || "?") + " @" + (e.filename || "") + ":" + (e.lineno || 0));
    }, true);
    window.addEventListener("unhandledrejection", function (e) {
      var reason = e.reason;
      diagPush("rejection", (reason && (reason.stack || reason.message)) || String(reason));
    });
    var consoleError = console.error;
    console.error = function () {
      try {
        diagPush("console.error", Array.prototype.map.call(arguments, function (a) { return (a && a.stack) || String(a); }).join(" "));
      } catch (e) { /* 忽略 */ }
      return consoleError.apply(console, arguments);
    };
  } catch (e) { /* 忽略 */ }

  function diagReport(tag) {
    try {
      var probes = {};
      try {
        probes.promiseWithResolvers = typeof Promise.withResolvers;
        probes.abortSignalTimeout = typeof (window.AbortSignal && AbortSignal.timeout);
        probes.throwIfAborted = typeof (window.AbortSignal && AbortSignal.prototype && AbortSignal.prototype.throwIfAborted);
        probes.objectHasOwn = typeof Object.hasOwn;
        probes.readableStream = typeof ReadableStream;
        probes.structuredClone = typeof structuredClone;
        probes.resizeObserver = typeof ResizeObserver;
        probes.eventSource = typeof EventSource;
        probes.storage = (function () {
          try { sessionStorage.setItem("__harnProbe", "1"); sessionStorage.removeItem("__harnProbe"); return "ok"; } catch (e) { return "blocked"; }
        })();
        probes.previewPanes = document.querySelectorAll("[data-textpreview-state]").length;
        probes.paneAttrs = (function () {
          var names = [];
          var all = document.querySelectorAll("*");
          for (var i = 0; i < all.length && names.length < 12; i++) {
            var attrs = all[i].attributes;
            for (var j = 0; j < attrs.length; j++) {
              if (attrs[j].name.indexOf("data-textpreview") === 0 && names.indexOf(attrs[j].name) === -1) names.push(attrs[j].name);
            }
          }
          return names.join(",");
        })();
        probes.addressAttr = (function () {
          var el = document.querySelector("[data-textpreview-url]");
          return el === null ? null : (el.getAttribute("data-textpreview-url") || "").slice(0, 160);
        })();
        probes.paneFirstLine = (function () {
          var pane = document.querySelector("[data-textpreview-state]");
          return pane === null ? null : (pane.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160);
        })();
        probes.dirHint = (function () {
          var d = document.querySelector('[class*="pathDirectory"]');
          var n = document.querySelector('[class*="pathName"]');
          return (((d && d.textContent) || "") + ((n && n.textContent) || "")).trim().slice(0, 120);
        })();
        probes.tapPath = (typeof lastFileTap !== "undefined" && lastFileTap !== null) ? String(lastFileTap.path).slice(0, 160) : null;
        // provider 是靠 dsh-resource:// 地址的 hostname 找到的：内核把自定义 scheme 解析歪了，
        // 就会表现为「文件资源服务不可用」。这两个探针用来和桌面 Chrome 对比。
        probes.urlProbe = (function () {
          try {
            var u = new URL("dsh-resource://file/session/s1/a/b.txt");
            return u.protocol + "|host=" + u.host + "|hostname=" + u.hostname + "|path=" + u.pathname + "|href=" + String(u.href).slice(0, 60);
          } catch (e) { return "throw:" + ((e && e.message) || e); }
        })();
        probes.plugins = "loaded=" + PLUGIN_LOG.loaded + " applied=" + PLUGIN_LOG.applied
          + " key=[" + keyPlugins() + "]"
          + (PLUGIN_LOG.issues.length > 0 ? " issues=" + PLUGIN_LOG.issues.join(" ; ") : "");
        probes.docPreview = (function () {
          var el = document.querySelector("[data-document-preview]");
          if (el === null) return null;
          var body = el.querySelector("[data-textpreview-body]");
          return el.getAttribute("data-document-preview")
            + "|state=" + (el.getAttribute("data-textpreview-state") || "")
            + "|kids=" + (body === null ? -1 : body.children.length)
            + "|bodyText=" + (((body && body.textContent) || "").replace(/\s+/g, " ").trim().slice(0, 50));
        })();
        probes.gwMedia = (function () {
          var el = document.querySelector("[data-harn-gw-preview] img, [data-harn-gw-preview] video, [data-harn-gw-preview] iframe");
          if (el === null) return null;
          if (el.tagName === "IMG") return "IMG " + el.naturalWidth + "x" + el.naturalHeight;
          if (el.tagName === "VIDEO") return "VIDEO ready=" + el.readyState + " " + (el.videoWidth || 0) + "x" + (el.videoHeight || 0) + " " + Math.round(el.duration || 0) + "s";
          return "IFRAME";
        })();
      } catch (e) { /* 忽略 */ }
      var payload = JSON.stringify({
        tag: tag,
        ua: navigator.userAgent,
        url: location.href,
        probes: probes,
        errors: DIAG_ERRORS.slice(-15)
      });
      if (navigator.sendBeacon) navigator.sendBeacon("/__gw_clientlog", payload);
      else fetch("/__gw_clientlog", { method: "POST", body: payload, keepalive: true });
    } catch (e) { /* 上报失败不影响页面 */ }
  }
  diagReport("boot");
  setTimeout(function () { diagReport("boot+8s"); }, 8000);

  function collapseSidebar() {
    var root = document.querySelector(".hHd-Xa_root");
    if (root && !root.classList.contains("hHd-Xa_collapsed")) {
      var toggle = document.querySelector(".hHd-Xa_toggle");
      if (toggle) toggle.click();
    }
  }
  document.addEventListener("click", function (e) {
    var sidebar = document.querySelector(".pI_x6G_sidebarCol");
    if (!sidebar) return;
    // 只有抽屉展开时（root 非 collapsed）才处理
    var root = document.querySelector(".hHd-Xa_root");
    if (!root || root.classList.contains("hHd-Xa_collapsed")) return;
    if (sidebar.contains(e.target)) return; // 点击侧边栏内部不收起
    collapseSidebar();
  }, true);

  // ---- 文件预览自愈 ----
  // 明确的失败文案：出现这些说明原生预览没戏，直接交给网关兜底。
  var MARKS = [
    "文件资源服务不可用", "The file resource service is unavailable",     // provider 缺失
    "该格式文件暂时无法预览", "Preview is not available for this file type yet",  // dsh 没有这类文件的预览器（mp4 等）
    "文件不存在，可能已被移动或删除", "File not found",                    // 元数据帧失败
    "读取失败：", "Read failed:"
  ];
  var MARK_PATTERNS = [/预览器[^。]{0,24}不可用/, /preview is unavailable/i];  // rendererUnavailable
  // 图片/PDF 这类「渲染器」预览：provider 缺失时面板整块空白，连提示文案都没有，
  // 所以要靠「已选中渲染器 + body 连续空白」判定；给原生渲染留一点时间再兜底。
  var BLANK_GRACE_MS = 2500;
  var blankWatch = { key: "", at: 0 };
  var COUNT_KEY = "harnGwPreviewHealCount";
  var AT_KEY = "harnGwPreviewHealAt";
  var MAX_AUTO_RELOADS = 1;
  var memoryStore = {};
  // 部分环境（iOS 无痕模式、受限 WebView）访问 sessionStorage 会抛错，这里兜底到内存
  function readStore(key) {
    try {
      var value = sessionStorage.getItem(key);
      if (value !== null && value !== undefined) return value;
    } catch (e) { /* 落回内存 */ }
    return memoryStore[key] === undefined ? null : memoryStore[key];
  }
  function writeStore(key, value) {
    memoryStore[key] = String(value);
    try { sessionStorage.setItem(key, String(value)); } catch (e) { /* 只用内存 */ }
  }

  // harness 自己挂的失败标记：这些属性的「存在」就是故障，不用去猜文案（也就不会误伤文件内容）
  var MARK_ATTRS = ["data-textpreview-unsupported", "data-textpreview-failed", "data-textpreview-meta-failed"];
  /** 预览区「状态区」的文案：跳过正文容器 data-textpreview-body，避免把文件内容当故障提示。 */
  function statusTextOf(node) {
    var out = "";
    var kids = node.children;
    if (kids === undefined || kids.length === 0) return node.textContent || "";
    for (var i = 0; i < kids.length; i++) {
      var kid = kids[i];
      if (kid.getAttribute !== undefined && kid.getAttribute("data-textpreview-body") !== null) continue;
      out += statusTextOf(kid);
    }
    return out;
  }
  function matchesMarks(text) {
    for (var j = 0; j < MARKS.length; j++) if (text.indexOf(MARKS[j]) !== -1) return true;
    for (var k = 0; k < MARK_PATTERNS.length; k++) if (MARK_PATTERNS[k].test(text)) return true;
    return false;
  }
  function showsUnavailable() {
    var panes = document.querySelectorAll("[data-textpreview-state]");
    for (var i = 0; i < panes.length; i++) {
      var pane = panes[i];
      for (var a = 0; a < MARK_ATTRS.length; a++) {
        if (pane.querySelector("[" + MARK_ATTRS[a] + "]") !== null) return true;
      }
      if (matchesMarks(statusTextOf(pane))) return true;
    }
    return false;
  }
  // body 里有没有真正画出来的东西（文字、图片、画布、媒体…）；只有转圈提示时算「空」。
  function bodyHasContent(body) {
    if ((body.textContent || "").replace(/\s+/g, "") !== "") return true;
    var nodes = body.querySelectorAll("img,canvas,video,iframe,svg,object,embed");
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var tag = node.tagName;
      if (tag === "IMG") { if (node.naturalWidth > 0) return true; continue; }
      if (tag === "VIDEO") { if (node.readyState > 0) return true; continue; }
      return true;   // canvas/iframe/svg/object/embed：只要挂上了就算有内容
    }
    return false;
  }
  // 预览区已经选中了渲染器（data-document-preview）却什么都没画出来 → 大概率是 provider 缺失。
  function blankRendererKey() {
    var pane = document.querySelector("[data-document-preview]");
    if (pane === null) return "";
    var body = pane.querySelector("[data-textpreview-body]");
    if (body === null || bodyHasContent(body)) return "";
    var url = pane.getAttribute("data-textpreview-url");
    if (url) return url;
    var tapped = recentTapPath();
    return tapped === "" ? "" : "abs:" + tapped;
  }
  function typing() {
    var input = document.querySelector('[contenteditable="true"], textarea');
    if (!input) return false;
    return ((input.textContent || input.value || "").trim().length > 0);
  }
  function showHint() {
    if (document.querySelector("[data-harn-gw-hint]")) return;
    var box = document.createElement("div");
    box.setAttribute("data-harn-gw-hint", "");
    box.textContent = "预览服务异常（诊断已上传），点此重试";
    box.style.cssText = "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483647;"
      + "background:#5b8cff;color:#fff;font-size:14px;padding:10px 14px;border-radius:10px;"
      + "box-shadow:0 6px 20px rgba(0,0,0,.35);cursor:pointer";
    box.addEventListener("click", function () { location.reload(); });
    document.body.appendChild(box);
  }
  function hideHint() {
    var hint = document.querySelector("[data-harn-gw-hint]");
    if (hint) hint.remove();
  }

  // ---- 兜底预览：把文件地址交给网关读，网关读回文本后画进预览区 ----
  var lastRendered = "";
  var lastFallbackReason = "";
  var dismissedKey = "";   // 用户手动关掉兜底浮层后，不要在同一条提示上反复弹出

  // 点文件时把文件行上的绝对路径记下来：provider 缺失时预览区只剩一句提示，
  // 拿不到 data-textpreview-url，只能靠点击那一刻从文件树行上取（LI[data-files-path]）。
  var lastFileTap = null;
  try {
    document.addEventListener("click", function (e) {
      var el = e.target;
      for (var i = 0; i < 6 && el && el.getAttribute; i++) {
        var p = el.getAttribute("data-files-path");
        if (p) { lastFileTap = { path: p, at: Date.now() }; return; }
        el = el.parentElement;
      }
    }, true);
  } catch (e) { /* 忽略 */ }
  function addressOnScreen() {
    var el = document.querySelector("[data-textpreview-url]");
    return el === null ? "" : (el.getAttribute("data-textpreview-url") || "");
  }
  // 点过的文件（10 分钟内有效）：provider 正常时用不着，缺失时是唯一的线索
  function recentTapPath() {
    if (lastFileTap === null) return "";
    if (Date.now() - lastFileTap.at > 600000) return "";
    return lastFileTap.path;
  }
  // 预览区可能不给 data-textpreview-url（provider 缺失时属性也可能没挂上），
  // 这时用「文件面板当前目录 + 预览区标题里的相对路径」拼一个绝对路径。
  function guessAbsolutePath() {
    var pane = document.querySelector("[data-textpreview-state]");
    if (pane === null) return "";
    var first = ((pane.textContent || "").split(/\r?\n/)[0] || "").trim();
    var m = /^([^\s（(]+?\.[A-Za-z0-9]{1,8})(?:\s|$|（|\()/.exec(first);
    if (m === null) return "";
    var rel = m[1];
    if (/^[A-Za-z]:[\\/]/.test(rel) || rel.charAt(0) === "/") return rel;
    var d = document.querySelector('[class*="pathDirectory"]');
    var n = document.querySelector('[class*="pathName"]');
    var dir = (((d && d.textContent) || "") + ((n && n.textContent) || "")).trim();
    if (dir === "") return "";
    var sep = dir.indexOf("\\") >= 0 ? "\\" : "/";
    return dir.replace(/[\\/]+$/, "") + sep + rel.replace(/^[\\/]+/, "");
  }
  function clearFallback(restorePane) {
    var box = document.querySelector("[data-harn-gw-preview]");
    if (box) box.remove();
    if (restorePane) {
      var panes = document.querySelectorAll("[data-harn-gw-hidden-pane]");
      for (var i = 0; i < panes.length; i++) {
        panes[i].style.display = "";
        panes[i].removeAttribute("data-harn-gw-hidden-pane");
      }
    }
    lastRendered = "";
  }
  // 组装兜底视图：用整屏浮层，避免被原界面里高度为 0 / 溢出不显示 的容器裁掉
  function fallbackShell(pane, filePath, note) {
    var oldBox = document.querySelector("[data-harn-gw-preview]");
    if (oldBox) oldBox.remove();
    var box = document.createElement("div");
    box.setAttribute("data-harn-gw-preview", "");
    box.style.cssText = "position:fixed;inset:0;z-index:2147483600;background:#0d0f17;color:#e6e8f0;"
      + "overflow:auto;-webkit-overflow-scrolling:touch;padding:10px 12px 28px;box-sizing:border-box;"
      + "font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
    var bar = document.createElement("div");
    bar.style.cssText = "display:flex;align-items:flex-start;gap:8px;margin-bottom:8px;position:sticky;top:0;"
      + "background:#0d0f17;padding:4px 0 8px";
    var title = document.createElement("div");
    title.textContent = filePath + "（网关兜底预览" + (note || "") + "）";
    title.style.cssText = "flex:1 1 auto;opacity:.65;word-break:break-all;font-size:12px";
    var close = document.createElement("button");
    close.textContent = "✕ 关闭";
    close.style.cssText = "flex:none;background:#262b3d;color:#e6e8f0;border:0;border-radius:8px;padding:6px 10px;font-size:12px";
    close.addEventListener("click", function () {
      dismissedKey = lastRendered;
      clearFallback(true);
    });
    bar.appendChild(title);
    bar.appendChild(close);
    box.appendChild(bar);
    document.body.appendChild(box);
    return box;
  }
  function renderFallback(pane, filePath, text, truncated) {
    var box = fallbackShell(pane, filePath, truncated ? "，已截断" : "");
    var pre = document.createElement("pre");
    pre.style.cssText = "margin:0;font:inherit;white-space:pre-wrap;word-break:break-word";
    pre.textContent = text;
    box.appendChild(pre);
  }
  // ---- 视频/音频兜底播放器 ----
  // harness 客户端没有视频预览器，只能交给浏览器原生播放器；网关 raw 通道支持 Range，能拖进度条。
  // 手机浏览器一律禁止「有声自动播放」——所以先静音自动播放把画面放出来，声音由按钮开。
  function durationText(node) {
    var d = node.duration;
    if (!isFinite(d) || d <= 0) return "时长未知";
    return Math.round(d * 10) / 10 + "s";
  }
  function linkEl(raw, label) {
    var wrap = document.createElement("div");
    wrap.style.cssText = "font-size:12px;opacity:.62;word-break:break-all;margin:6px 0 2px";
    if (label) wrap.textContent = label;
    var link = document.createElement("a");
    link.href = raw;
    link.textContent = raw;
    link.style.cssText = "color:#8ab4ff;word-break:break-all;font-size:12px";
    wrap.appendChild(link);
    return wrap;
  }
  function renderMediaFallback(box, mime, raw) {
    var isVideo = mime.indexOf("video/") === 0;
    var node = document.createElement(isVideo ? "video" : "audio");
    node.setAttribute("controls", "");
    if (isVideo) {
      // 国产内核常见的几个属性：避免被浏览器劫持进它自己的全屏播放器（那种情况经常只剩黑屏）
      node.setAttribute("playsinline", "");
      node.setAttribute("webkit-playsinline", "");
      node.setAttribute("x5-playsinline", "");
      node.setAttribute("x5-video-player-type", "h5");
      node.style.cssText = "width:100%;max-height:70vh;background:#000;display:block;margin:0 auto";
    } else {
      node.style.cssText = "width:100%;display:block;margin:14px 0";
    }
    node.preload = "auto";
    node.muted = true;      // 先静音：这样手机才允许自动播放
    node.autoplay = true;

    var status = document.createElement("div");
    status.style.cssText = "margin:10px 0 2px;font-size:12px;opacity:.85;word-break:break-all";
    status.textContent = "正在加载…（已静音，点「开启声音」出声）";
    var actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0 4px";
    var buttonStyle = "background:#262b3d;color:#e6e8f0;border:0;border-radius:8px;padding:7px 11px;font-size:12px";

    var sound = document.createElement("button");
    sound.textContent = "🔊 开启声音";
    sound.style.cssText = buttonStyle;
    sound.addEventListener("click", function () {
      node.muted = false;
      node.volume = 1;
      var played = node.play();
      if (played && played.catch) played.catch(function () { /* 手机可能要求再点一次画面，下面的状态文案会提示 */ });
    });
    actions.appendChild(sound);
    if (isVideo) {
      var full = document.createElement("button");
      full.textContent = "⛶ 全屏";
      full.style.cssText = buttonStyle;
      full.addEventListener("click", function () {
        try {
          if (node.requestFullscreen) node.requestFullscreen();
          else if (node.webkitEnterFullscreen) node.webkitEnterFullscreen();
          else if (node.webkitRequestFullscreen) node.webkitRequestFullscreen();
        } catch (e) { /* 不支持就算了 */ }
      });
      actions.appendChild(full);
    }

    var reported = false;
    node.addEventListener("loadedmetadata", function () {
      status.textContent = "已就绪 " + durationText(node) + " " + (node.videoWidth || 0) + "x" + (node.videoHeight || 0)
        + "（已静音自动播放，点「开启声音」出声）";
      diagPush("fallback", "媒体已就绪: " + node.tagName + " " + (node.videoWidth || 0) + "x" + (node.videoHeight || 0) + " " + durationText(node));
    });
    node.addEventListener("playing", function () {
      status.textContent = "▶ 正在播放（已静音，点「开启声音」出声）";
      if (!reported) {
        reported = true;
        diagPush("fallback", "媒体已开始播放: " + node.tagName);
        if (typeof diagReport === "function") diagReport("fallback-media-playing");
      }
    });
    node.addEventListener("error", function () {
      var code = node.error ? node.error.code : "?";
      status.textContent = "播放失败 code=" + code + "：这个内核可能不支持该编码/封装，可长按下面直链用系统播放器打开";
      actions.appendChild(linkEl(raw));
      diagPush("fallback", "媒体加载失败 code=" + code + " mime=" + mime + " " + raw);
      if (typeof diagReport === "function") diagReport("fallback-media-failed");
    });
    // 有的内核连静音自动播放也拦：给一次明确的「点画面开始播放」
    setTimeout(function () {
      if (node.paused && !node.error) status.textContent = "点一下画面开始播放（已静音，点「开启声音」出声）";
    }, 1600);
    node.addEventListener("click", function () {
      if (node.paused) {
        var played = node.play();
        if (played && played.catch) played.catch(function () { /* 忽略 */ });
      }
    });
    node.src = raw;

    box.appendChild(node);
    box.appendChild(status);
    box.appendChild(actions);
    box.appendChild(linkEl(raw, "直链（长按可用系统播放器打开）："));
  }
  // 图片/PDF/视频/音频：让浏览器自己渲染网关回传的原始字节
  function renderBinaryFallback(pane, filePath, mime, raw) {
    var isVideo = mime.indexOf("video/") === 0;
    var isAudio = mime.indexOf("audio/") === 0;
    var box = fallbackShell(pane, filePath, isVideo ? "，视频" : (isAudio ? "，音频" : ""));
    var node;
    if (isVideo || isAudio) {
      renderMediaFallback(box, mime, raw);
      return;
    }
    if (mime.indexOf("image/") === 0) {
      node = document.createElement("img");
      node.src = raw;
      node.alt = filePath;
      node.style.cssText = "max-width:100%;height:auto;display:block;margin:0 auto";
      node.addEventListener("error", function () {
        diagPush("fallback", "图片加载失败（raw 请求没成功，可能是网关会话失效）: " + raw);
        if (typeof diagReport === "function") diagReport("fallback-failed");
      });
      node.addEventListener("load", function () {
        diagPush("fallback", "图片已渲染: " + node.naturalWidth + "x" + node.naturalHeight);
      });
    } else {
      node = document.createElement("iframe");
      node.src = raw;
      node.style.cssText = "width:100%;height:75vh;border:0;background:#fff";
    }
    box.appendChild(node);
  }
  function loadFallback(address) {
    var m = /^dsh-resource:\/\/file\/session\/([^/]+)\/(.*)$/.exec(address);
    var url;
    if (m !== null) {
      url = "/__gw_file?session=" + encodeURIComponent(decodeURIComponent(m[1])) + "&path=" + encodeURIComponent(m[2].split("/").map(decodeURIComponent).join("/"));
    } else {
      var abs = /^dsh-resource:\/\/file\/absolute\/(.*)$/.exec(address);
      if (abs !== null) {
        url = "/__gw_file?absolute=" + encodeURIComponent(abs[1].split("/").map(decodeURIComponent).join("/"));
      } else {
        // 拿不到地址属性时的两条线索：① 点击文件行时记下的绝对路径 ② 面板目录 + 预览区标题里的相对路径
        var tapped = recentTapPath();
        var guess = tapped !== "" ? tapped : guessAbsolutePath();
        if (guess === "") {
          diagPush("fallback", "既没有 data-textpreview-url，也没有点击记录/可猜路径");
          if (typeof diagReport === "function") diagReport("fallback-failed");
          return Promise.resolve(false);
        }
        url = "/__gw_file?absolute=" + encodeURIComponent(guess);
      }
    }
    return fetch(url, { credentials: "same-origin" })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data !== null && data.ok === true) {
          var pane = document.querySelector("[data-textpreview-state]");
          var target = pane === null ? null : (pane.closest("div") || pane);
          if (data.mode === "binary") {
            renderBinaryFallback(target, data.path || address, String(data.mime || ""), data.raw);
            diagPush("fallback", "网关兜底预览（" + data.mime + "）成功: " + (data.path || address) + " (" + (data.size || 0) + " 字节)");
          } else {
            renderFallback(target, data.path || address, data.text || "", data.truncated === true);
            diagPush("fallback", "网关兜底预览成功: " + (data.path || address) + " (" + (data.size || 0) + " 字节)");
          }
          hideHint();
          if (typeof diagReport === "function") diagReport("fallback-ok");
          return true;
        }
        diagPush("fallback", "网关兜底失败: " + ((data && data.reason) || "未知原因"));
        lastFallbackReason = String((data && data.reason) || "未知原因");
        if (typeof diagReport === "function") diagReport("fallback-failed");
        return false;
      })
      .catch(function (error) {
        diagPush("fallback", "网关兜底请求异常: " + error);
        lastFallbackReason = String(error);
        if (typeof diagReport === "function") diagReport("fallback-failed");
        return false;
      });
  }

  function heal() {
    var pane = document.querySelector("[data-textpreview-state]");
    if (pane === null) {
      blankWatch = { key: "", at: 0 };
      if (lastRendered !== "") clearFallback(true);
      return;
    }
    var marked = showsUnavailable();
    var blank = marked ? "" : blankRendererKey();
    if (!marked && blank === "") {
      // 正常状态：清掉兜底视图，让原生预览接管
      blankWatch = { key: "", at: 0 };
      if (lastRendered !== "") clearFallback(true);
      return;
    }
    if (!marked) {
      // 空白渲染器：大图/大 PDF 也可能只是慢，连续空白超过 BLANK_GRACE_MS 才判定为 provider 缺失
      if (blankWatch.key !== blank) { blankWatch = { key: blank, at: Date.now() }; return; }
      if (Date.now() - blankWatch.at < BLANK_GRACE_MS) return;
    } else {
      blankWatch = { key: "", at: 0 };
    }
    if (typeof diagReport === "function" && diagSent.preview !== true) {
      diagSent.preview = true;
      diagReport(marked ? "preview-unavailable" : "preview-blank-empty");
    }
    // 线索优先级：预览区的文件地址 → 点击文件行时记下的绝对路径 → 面板目录 + 标题里的相对路径
    var address = addressOnScreen();
    var tapped = recentTapPath();
    var key = address !== "" ? address : (tapped !== "" ? "abs:" + tapped : "");
    if (key === "") {
      var guess = guessAbsolutePath();
      if (guess === "") { showHint(); return; }
      key = "abs:" + guess;
    }
    if (key === dismissedKey) return;
    if (key === lastRendered) return;
    lastRendered = key;
    lastFallbackReason = "";
    var wasBlank = !marked;
    loadFallback(address).then(function (ok) {
      if (ok) {
        // 空白面板有可能只是原生渲染慢：过一会儿它自己画出来了，就把兜底浮层收掉，别抢原生预览
        if (wasBlank) {
          setTimeout(function () {
            if (blankRendererKey() === "") clearFallback(true);
          }, 8000);
        }
        return;
      }
      clearFallback(true);
      lastRendered = key;
      // 「文件太大 / 类型不支持」这类失败原生预览本来也看不了，不必再弹重试提示打断用户
      if (!/太大|上限|不支持直接回传/u.test(lastFallbackReason)) showHint();
      // 原生 provider 缺失时刷新也修不好，所以只自动刷一次，剩下交给兜底预览
      var count = Number(readStore(COUNT_KEY) || 0);
      var since = Date.now() - Number(readStore(AT_KEY) || 0);
      if (count < MAX_AUTO_RELOADS && since > 60000 && !typing()) {
        writeStore(COUNT_KEY, count + 1);
        writeStore(AT_KEY, Date.now());
        location.reload();
      }
    });
  }
  setInterval(heal, 3000);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) setTimeout(heal, 1500);
  });
})();
