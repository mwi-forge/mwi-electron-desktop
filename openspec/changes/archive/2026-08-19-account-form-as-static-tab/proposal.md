# Proposal: account-form-as-static-tab

## Why

mwi-electron-desktop 的「添加/编辑账号」表单一直用 DOM 模态框（`.modal-backdrop` + `.modal` 挂在 `<body>`），但用户多次反馈游戏画面（WebContentsView）遮挡表单上半截。

根因（已确认）：
- 游戏画面在主进程用 `mainWindow.contentView.addChildView(WebContentsView)` 挂载，属于 Electron 原生 GPU 层视图
- CSS `z-index` 对 WebContentsView 完全无效（DOM 层与原生层是兄弟，DOM 永远绘制在 WebContentsView 之下）
- 之前尝试调 z-index / `!important` / backdrop-filter 均无效

## What

把账号表单从 DOM 模态框改为中部 canvas 静态 tab 嵌入：
1. 扩展 tabbar.js 支持非 web view 的静态 tab 类型（type=account-form）
2. 表单作为独立 HTML（src/account-form.html）注入中部 canvas 区
3. 打开表单 tab 时，主进程临时 removeChildView focused game view 让位；关闭 tab 时重新 addChildView 恢复游戏
4. 表单数据走现有 window.api.accounts.create/update（不变更 IPC 协议）
5. tab 切换由用户主动操作（点 tab、关 tab、点其它账号）

## Alternatives Considered

### A. 维持 DOM 模态框
- 拒绝：原 bug 根因（WebContentsView 遮挡）无法绕过

### B. BrowserWindow modal 子窗口（已实施并弃用）
- 优点：作为 OS 层独立窗口天然盖在所有 WebContentsView 之上，体验接近真模态
- 拒绝原因：
  - 新增主进程 lib/accountModal.js + 独立 preload src/modal-preload.js，架构成本大
  - 用户反馈希望像新 Tab 效果，转中部内嵌更自然
  - 子窗口关闭后 game view 仍可见模糊背景（虽然无害但割裂）

### D. 当前方案（静态 tab 嵌入中部）
- 优点：架构最原生，不绕 OS 层窗口；游戏 view 临时摘下，关闭 tab 立刻恢复
- 代价：tabbar.js / canvas 区切换逻辑需要扩展（适度复杂度）

## Non-goals

- 不重构 tabbar.js / canvas 区域的整体架构
- 不引入前端框架（仍 vanilla HTML/CSS/JS）
- 不变更 accounts.* IPC API
- 不变更 WebContentsView 池管理（仅扩展 hide/resume 接口）

## Risk

- 多 tab 并存：未来如同时开添加账号和编辑账号两个表单 tab，状态隔离需要验证
- 表单数据回填：编辑模式下需要把原账号数据预填到表单
- WebContentsView 卸下/恢复时机：避免 game view 状态丢失或重复 attach

## Status

IN PROGRESS — apply 阶段。已动手部分回填到 tasks.md。
