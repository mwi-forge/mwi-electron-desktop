# Proposal: ui-modal-component

## Why

代理失败等严重安全事件目前通过 Electron 原生 `dialog.showMessageBox` 弹窗（系统默认浅色 UI）。

问题：
- 与应用暗色主题割裂——截图里 Windows 系统白底蓝边按钮跟 `#0E0E11` 主控台完全两种风格
- 不能复用：未来任何需要在主进程触发、在渲染进程展示的告警（订阅刷新失败 / 节点测速全失败 / safeStorage 不可用 / mihomo 启动失败等）都得重写一遍
- 系统对话框被外部进程遮挡时不会置顶（无 `parent` 兜底时），用户可能错过关键告警

新方案：在渲染进程实现一个 **应用内统一弹窗组件**，与现有 token 系统共享变量，单实例 slot，可被未来任意模块复用。

## Capabilities

### New Capabilities
- `ui-modal`: 主进程 ↔ 渲染进程统一弹窗通道（替代 `dialog.showMessageBox` 在应用内的用法）

### Modified Capabilities
- `proxy-binding`（属于 clash-verge-integration）：代理启动失败时不再用系统弹窗，改走 `ui-modal` 通道

## Impact

- **代码层**：新增 3 个文件（`lib/alert.js`、`src/js/modal.js`、`src/css/modal.css`），修改 4 个文件（`lib/views.js`、`lib/ipc.js`、`main.js`、`preload.js`、`src/index.html`）
- **依赖层**：无新增 npm 包（纯 `electron` + 现有 token）
- **数据层**：无持久化变更
- **IPC 层**：新增 1 个主→渲推送通道 `ui:dialog`（webContents.send），新增 1 个渲→主回执通道 `ui:dialog:reply`（ipcMain.on）
- **运行时**：弹窗延迟走 IPC 单程往返（< 5ms，本地）；无可观察性能影响
- **UI 层**：1 个新 CSS 文件（token 化暗色），与现有 `.modal-*`（表单弹窗）共存不冲突

## What Changes

1. **主进程 API（`lib/alert.js`）**
   - `setMainWindow(win)` — 由 main.js 调用注入引用
   - `showAppAlert(payload) -> Promise<buttonIndex>` — 主进程触发弹窗的核心 API
   - `replyDialog(id, idx)` — 渲染进程回报按钮点击
   - `resetPending()` — 主窗口关闭时清理悬挂 Promise

2. **IPC 协议**
   - 主 → 渲：`mainWindow.webContents.send('ui:dialog', { id, type, title, message, detail, buttons, defaultId, cancelId, dismissOnBackdrop })`
   - 渲 → 主：`ipcRenderer.send('ui:dialog:reply', id, buttonIndex)`

3. **渲染进程组件（`src/js/modal.js`）**
   - 单 slot 单例：同时只显示一个对话框；并发 showAppAlert 排队（告警看完才能看下一个，避免告警风暴）
   - 监听 `api.dialog.onShow` 注册 DOM
   - 键盘可达：Enter → defaultId；Esc → cancelId；Tab 焦点陷阱
   - body scroll lock + backdrop 遮罩
   - 卸载函数释放所有副作用

4. **暗色样式（`src/css/modal.css`）**
   - 全部 token 化（`--mwi-bg-panel`、`--mwi-text-primary`、`--mwi-accent` 等）
   - 三种 type：error(红 `--mwi-status-error`) / warn(黄 `--mwi-status-warn`) / info(蓝 `--mwi-accent`)
   - detail 区域：等宽字体 + 保留换行 + max-height 280px 滚动
   - 复用 `mwi-modal-in` keyframes
   - 宽 480px / 窄屏 90vw

5. **首个接入点（`lib/views.js`）**
   - 原 `dialog.showMessageBox(...)` 替换为 `await alert.showAppAlert({...})`
   - 同一安全策略不变：代理失败 = 弹窗 + 终止 view 启动
   - 行为/文案保持 1:1（标题、message、detail、按钮文案不变）

## Alternatives Considered

### A. 直接用 `dialog.showMessageBox` 加自定义 CSS（不可行）
- 系统对话框不走渲染进程 DOM，无法套用 CSS
- 拒绝

### B. 多 modal slot（同时显示多个）
- 安全告警叠加会让人抓狂；UX 上不建议
- 拒绝；改用单实例 + 队列

### C. 用 `<dialog>` 原生 HTML 元素 + `dialog.showModal()`
- 浏览器原生 modal 在 Electron 43 渲染进程行为正常
- 但失去 token 化的视觉一致性（`<dialog>::backdrop` 默认浅色，需要额外覆盖）
- 不值得——直接 div + 自管 backdrop 更可控

### D. 通过 IPC 走 `dialog.showMessageBox`（仅当渲染进程无法显示时降级）
- 增加复杂度；本方案不需要——渲染进程始终可用
- 拒绝

## Out of Scope

- 同步替换其它 native dialog 调用点（订阅刷新失败、节点测速全失败等）—— 后续 PR 接入 `alert.showAppAlert` 即可，本 PR 只解决代理失败这一处
- 表单弹窗（`account-form` / `settings-tab` 用 `.modal-*`）—— 结构差异大（多字段 / 校验 / 提交），保持不变
- 国际化（i18n）文案—— 当前 detail 文案是中文硬编码，跟现状一致；后续接入 i18n
