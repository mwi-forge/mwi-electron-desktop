# Spec: ui-modal

## Purpose

定义主进程 ↔ 渲染进程统一弹窗通道（替代 `dialog.showMessageBox` 的应用内用法），用于代理失败等安全告警、未来任意需要在主进程触发 / 渲染进程展示的用户通知。

## Requirements

### Requirement: 主进程 API（showAppAlert）

`lib/alert.js` MUST 提供 `showAppAlert(payload) -> Promise<number>`，主进程任意模块可调用触发应用内弹窗。

- WHEN `showAppAlert` 被调用且主窗口存在
  - MUST 立即向渲染进程推送 `ui:dialog` 消息（含唯一 id + payload 字段）
  - MUST 返回 Promise，resolve 用户点击的按钮索引（0-based）
- WHEN `showAppAlert` 被调用且主窗口已销毁或不可用
  - MUST 立即 resolve `payload.defaultId`（缺省 0），不抛异常，不阻塞业务
- WHEN 渲染进程 5 分钟内未回报
  - MUST 自动 resolve `payload.defaultId`（防悬挂），清理 pending map

### Requirement: 渲染进程 API（modal.js）

`src/js/modal.js` MUST 监听主进程 `ui:dialog` 消息并渲染对应 DOM。

- WHEN 收到 `ui:dialog` 消息
  - MUST 立即渲染暗色 alert dialog 在 `document.body` 末尾
  - IF 当前已有 dialog 显示 → MUST 排队（先显示的先点完，再显示下一个）
- WHEN 用户点击按钮
  - MUST 通过 `api.dialog.reply(id, buttonIndex)` 回执主进程
  - MUST 移除 dialog DOM
  - MUST 解锁 body overflow
  - MUST 从队列取下一个渲染（如有）

### Requirement: 键盘交互

弹窗 MUST 支持键盘操作（无障碍 + 习惯）。

- Enter → 触发 `payload.defaultId` 按钮
- Escape → 触发 `payload.cancelId` 按钮（缺省时退化为 `defaultId`）
- Tab / Shift+Tab → 焦点在 buttons 间循环，不外溢
- 首次渲染 → 自动 focus 默认按钮

### Requirement: 视觉一致性

弹窗样式 MUST 与应用暗色主题统一。

- 背景：`var(--mwi-bg-panel)` + `var(--mwi-border-strong)` 1px 描边 + `var(--mwi-shadow-lg)` 阴影
- 主色按钮：`var(--mwi-accent)` 背景 + `#0E0E11` 文字
- 三种 type 图标背景色：error → `var(--mwi-status-error)` / warn → `var(--mwi-status-warn)` / info → `var(--mwi-accent)`
- detail 区域：`var(--mwi-font-mono)` 等宽字体 + `var(--mwi-bg-inset)` 底色 + `pre-wrap` 保留换行
- 入场动画：复用 `mwi-modal-in` keyframes（来自 tokens.css）

### Requirement: 不引入新依赖

实现 MUST 不引入新的 npm 包。

- 仅依赖 `electron`（`webContents.send` / `ipcMain.on`）+ `tokens.css` 已有 CSS 变量

### Requirement: 与现有 `.modal-*` 命名空间隔离

新弹窗 CSS 类 MUST 使用 `.mwi-alert-*` 前缀，不污染既有 `.modal-*`（用于表单弹窗）。

### Requirement: CSP 兼容

实现 MUST 在现有 CSP 下工作，无需 CSP meta 变更。

- `src/js/modal.js` 通过 `script-src 'self'` 加载 ✅
- `src/css/modal.css` 通过 `style-src 'self'` 加载 ✅
- 无内联 `<script>` / `<style>` / 远程资源 ✅

### Requirement: 上下文隔离

弹窗通信 MUST 通过 `contextBridge` 暴露的受限 API，而非原始 `ipcRenderer`。

- `preload.js` 暴露 `api.dialog.onShow(cb)` 和 `api.dialog.reply(id, idx)`
- 渲染进程**只能**监听 `ui:dialog` 主→渲消息 + send `ui:dialog:reply` 渲→主回执
- 渲染进程**不能**伪造主→渲消息

## Modified Specs

- `proxy-binding`（位于 `clash-verge-integration/specs/socks-gateway/spec.md`）：
  - WHERE 描述代理启动失败的处理
  - MUST 改为：通过 `alert.showAppAlert` 触发应用内模态弹窗（暗色主题），不再是 `dialog.showMessageBox`
  - 弹窗内容/按钮/行为保持不变
