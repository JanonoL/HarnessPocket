/* 移动端交互增强：由远程网关注入。点击侧边栏抽屉外的区域时自动收起抽屉。
   用事件委托 + 类名判断，兼容 React 异步渲染。 */
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
})();
