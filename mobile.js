/* 移动端增强脚本：由远程网关注入。
   1) 老内核兜底：补几个近两年才普及的 API（国产内核/旧 WebView 常常没有），
      缺了它们 harness 客户端的插件会静默不生效，典型症状就是「文件资源服务不可用」。
   2) 客户端报错上报：手机上看不到 console，出错信息回传到网关 client.log。
   3) 抽屉交互 + 文件预览自愈。 */
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
  var MARKS = ["文件资源服务不可用", "The file resource service is unavailable"];
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

  function showsUnavailable() {
    var panes = document.querySelectorAll("[data-textpreview-state]");
    for (var i = 0; i < panes.length; i++) {
      var text = panes[i].textContent || "";
      for (var j = 0; j < MARKS.length; j++) if (text.indexOf(MARKS[j]) !== -1) return true;
    }
    return false;
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
  function addressOnScreen() {
    var el = document.querySelector("[data-textpreview-url]");
    return el === null ? "" : (el.getAttribute("data-textpreview-url") || "");
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
  function renderFallback(pane, filePath, text, truncated) {
    var oldBox = document.querySelector("[data-harn-gw-preview]");
    if (oldBox) oldBox.remove();
    var hidden = document.querySelectorAll("[data-harn-gw-hidden-pane]");
    for (var i = 0; i < hidden.length; i++) {
      hidden[i].style.display = "";
      hidden[i].removeAttribute("data-harn-gw-hidden-pane");
    }
    var box = document.createElement("div");
    box.setAttribute("data-harn-gw-preview", "");
    box.style.cssText = "flex:1 1 auto;min-height:0;overflow:auto;padding:10px 14px;"
      + "font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:inherit;background:inherit";
    var head = document.createElement("div");
    head.textContent = filePath + "（网关兜底预览" + (truncated ? "，已截断" : "") + "）";
    head.style.cssText = "opacity:.55;margin-bottom:8px;white-space:pre-wrap;word-break:break-all";
    var pre = document.createElement("pre");
    pre.style.cssText = "margin:0;font:inherit;white-space:pre-wrap;word-break:break-word";
    pre.textContent = text;
    box.appendChild(head);
    box.appendChild(pre);
    if (pane !== null) {
      pane.setAttribute("data-harn-gw-hidden-pane", "");
      pane.style.display = "none";
      (pane.parentElement || document.body).appendChild(box);
    } else {
      document.body.appendChild(box);
    }
  }
  function loadFallback(address) {
    var m = /^dsh-resource:\/\/file\/session\/([^/]+)\/(.*)$/.exec(address);
    var url;
    if (m !== null) {
      url = "/__gw_file?session=" + encodeURIComponent(decodeURIComponent(m[1])) + "&path=" + encodeURIComponent(m[2].split("/").map(decodeURIComponent).join("/"));
    } else {
      var abs = /^dsh-resource:\/\/file\/absolute\/(.*)$/.exec(address);
      if (abs === null) return Promise.resolve(false);
      url = "/__gw_file?absolute=" + encodeURIComponent(abs[1].split("/").map(decodeURIComponent).join("/"));
    }
    return fetch(url, { credentials: "same-origin" })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data !== null && data.ok === true) {
          var pane = document.querySelector("[data-textpreview-state]");
          renderFallback(pane === null ? null : (pane.closest("div") || pane), data.path || address, data.text || "", data.truncated === true);
          hideHint();
          diagPush("fallback", "网关兜底预览成功: " + (data.path || address) + " (" + (data.size || 0) + " 字节)");
          if (typeof diagReport === "function") diagReport("fallback-ok");
          return true;
        }
        diagPush("fallback", "网关兜底失败: " + ((data && data.reason) || "未知原因"));
        return false;
      })
      .catch(function (error) { diagPush("fallback", "网关兜底请求异常: " + error); return false; });
  }

  function heal() {
    var pane = document.querySelector("[data-textpreview-state]");
    if (pane === null || pane.textContent === undefined || !showsUnavailable()) {
      // 正常状态：清掉兜底视图，让原生预览接管
      if (lastRendered !== "") clearFallback(true);
      return;
    }
    if (typeof diagReport === "function" && diagSent.preview !== true) {
      diagSent.preview = true;
      diagReport("preview-unavailable");
    }
    var address = addressOnScreen();
    if (address !== "" && address !== lastRendered) {
      lastRendered = address;
      loadFallback(address).then(function (ok) {
        if (ok) return;
        clearFallback(true);
        lastRendered = address;
        showHint();
        // 原生 provider 缺失时刷新也修不好，所以只自动刷一次，剩下交给兜底预览
        var count = Number(readStore(COUNT_KEY) || 0);
        var since = Date.now() - Number(readStore(AT_KEY) || 0);
        if (count < MAX_AUTO_RELOADS && since > 60000 && !typing()) {
          writeStore(COUNT_KEY, count + 1);
          writeStore(AT_KEY, Date.now());
          location.reload();
        }
      });
      return;
    }
    if (lastRendered === "") showHint();
  }
  setInterval(heal, 3000);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) setTimeout(heal, 1500);
  });
})();
