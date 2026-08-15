# DSH 工作台（动态插件）

手机端查看 DeepSeek Harness 对话结果的工作台面板：本次对话的文字说明、改动文件、运行/测试结果，以及工作区的产出预览（网站/图片/视频/音频/文档/代码）与 git 改动。

## 文件

- `host.js` —— 动态插件的 `code.host`（函数体，返回 Cordis 插件，含 fs/jobs/sessionQuery/shell/webServer RPC 与 HTTP 预览路由）
- `client.js` —— 动态插件的 `code.client`（函数体，返回 Cordis 插件，含侧边栏入口 + 浮动面板 UI）

## 重新应用

在 DSH 会话里让 agent 执行：

1. `cordis_define`（kind: `new`，idPrefix: `workb`，code.host = `host.js` 内容，code.client = `client.js` 内容）
2. `cordis_run`

## 说明

- 这是**动态插件**，仅进程内有效：DSH 重启或页面刷新后需重新运行一次。
- 入口：侧边栏底部「工作台」图标；运行后面板自动弹出。
- 面板标签：**本次**（文字说明 / 改动文件 / 运行测试结果）、**工作区**（产出 / 改动 / 文件）、**任务**（后台任务）。
