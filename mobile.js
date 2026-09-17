/* 移动端交互增强：由远程网关注入。
   1) 点击侧边栏抽屉外的区域时自动收起抽屉（事件委托 + 类名判断，兼容 React 异步渲染）。
   2) 文件预览自愈：手机端页面挂久了，harness 客户端的「文件资源」provider 偶尔会掉，
      预览区只显示一行「文件资源服务不可用」；刷新页面即可恢复，所以这里做有限次的自动恢复。 */
(function () {
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
  var MAX_AUTO_RELOADS = 2;
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
    box.textContent = "预览服务已断开，点这里重新加载";
    box.style.cssText = "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483647;"
      + "background:#5b8cff;color:#fff;font-size:14px;padding:10px 14px;border-radius:10px;"
      + "box-shadow:0 6px 20px rgba(0,0,0,.35);cursor:pointer";
    box.addEventListener("click", function () { location.reload(); });
    document.body.appendChild(box);
  }
  function heal() {
    if (!showsUnavailable()) return;
    var count = Number(readStore(COUNT_KEY) || 0);
    var since = Date.now() - Number(readStore(AT_KEY) || 0);
    // 给用户留 60 秒缓冲，避免反复刷新；自动刷新最多两次，之后只提示
    if (count < MAX_AUTO_RELOADS && since > 60000 && !typing()) {
      writeStore(COUNT_KEY, count + 1);
      writeStore(AT_KEY, Date.now());
      location.reload();
      return;
    }
    showHint();
  }
  setInterval(heal, 3000);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) setTimeout(heal, 1500);
  });
})();
