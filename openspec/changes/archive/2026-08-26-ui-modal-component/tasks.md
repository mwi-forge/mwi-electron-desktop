# Tasks: ui-modal-component

## Status legend
- [ ] = pending
- [x] = completed

## Phase 1 — 主进程 API

- [x] 新建 `lib/alert.js`
  - `setMainWindow(win)` / `showAppAlert(payload)` / `replyDialog(id, idx)` / `resetPending()`
  - 内部 `_pending: Map<id, resolve>` 串行队列
  - 默认超时 5min（防渲染进程崩溃悬挂）
  - 主窗口销毁时静默 resolve defaultId（不阻塞业务）

## Phase 2 — IPC 协议 + main.js 接入

- [x] 修改 `lib/ipc.js`
  - `ipcMain.on('ui:dialog:reply', (_e, id, idx) => alert.replyDialog(id, idx))`
- [x] 修改 `main.js`
  - `require('./lib/alert')` + `alert.setMainWindow(mainWindow)`
  - `mainWindow.on('closed', () => alert.resetPending())`

## Phase 3 — preload 暴露

- [x] 修改 `preload.js`
  - `api.dialog.onShow(cb)` — 订阅主进程推送，返回 unsubscribe
  - `api.dialog.reply(id, idx)` — 单向 send 回执

## Phase 4 — 渲染进程 modal 管理器

- [x] 新建 `src/js/modal.js`
  - 单 slot 单例（队列 + 同时只显示一个）
  - 监听 `api.dialog.onShow` 注册 DOM
  - 三种 type 图标：error / warn / info（颜色 token 化）
  - 键盘：Enter → defaultId；Esc → cancelId；Tab 焦点陷阱
  - body scroll lock + backdrop 遮罩
  - 完整 cleanup 函数（移除 listener + 解锁 body overflow + pump 队列）
  - `window.__mwiModal.queueLength/busy` 暴露调试用

## Phase 5 — 暗色样式

- [x] 新建 `src/css/modal.css`
  - `#mwi-alert-slot` (fixed 全屏 + z-index 9999 + 默认 pointer-events:none)
  - `.mwi-alert-backdrop` (rgba 0,0,0,0.55 + flex 居中 + 复用 mwi-modal-in 动画)
  - `.mwi-alert` (480px / 90vw max + token 化 bg/border/shadow/radius)
  - `.mwi-alert__icon--error/warn/info` (圆形 + 状态色)
  - `.mwi-alert__detail` (等宽字体 + pre-wrap + max-height 滚动)
  - `.mwi-alert__btn` + `.mwi-alert__btn--primary` (token 化按钮，含 hover/active/focus)

## Phase 6 — 接入首个用例（代理失败）

- [x] 修改 `lib/views.js`
  - 顶部 require `dialog` → 替换为 `const alert = require('./alert')`
  - 移除 `dialog` 引入
  - `startView` 代理失败分支：`dialog.showMessageBox(...)` → `alert.showAppAlert({...})`
  - 行为/文案 1:1 保持；buttons: ['我知道了'] / defaultId: 0 / cancelId: 0

## Phase 7 — index.html 引入

- [x] 修改 `src/index.html`
  - 在所有 tab.js 之前引入 `<script src="js/modal.js">`（基础设施必须先加载）
  - 引入 `<link rel="stylesheet" href="css/modal.css">`（放最后）

## Phase 8 — 验证

- [x] `node --check` 所有改动文件通过（lib/alert.js、lib/views.js、lib/ipc.js、main.js、preload.js、src/js/modal.js）
- [x] 无破坏现有测试（测试套件不依赖 modal API）
- [ ] 手动验证：杀掉 mihomo 二进制 → 启动订阅账号 → 看到暗色弹窗而非 Windows 系统对话框（需用户在本地跑 `npm run dev` 触发 mihomo_binary_not_found 路径）

## Phase 9 — 后续接入（独立 PR）

- [ ] 接入订阅刷新失败（`subscriptions:refresh` 抛错）
- [ ] 接入节点测速全失败（`subscriptions:measureNodes` 全超时）
- [ ] 接入 safeStorage 不可用（首次启动 safeStorage 抛错）
- [ ] 接入油猴扩展缺失（`tampermonkey:isReady` 返回 false）
- [ ] i18n 化 detail 文案（per i18n-zh-en change）
