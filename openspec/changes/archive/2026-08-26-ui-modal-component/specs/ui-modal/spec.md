# ui-modal Specification

## Purpose

定义主进程 ↔ 渲染进程统一弹窗通道（替代 `dialog.showMessageBox` 的应用内用法），用于代理失败等安全告警、未来任意需要在主进程触发 / 渲染进程展示的用户通知。

## ADDED Requirements

### Requirement: 主进程 API（showAppAlert）

`lib/alert.js` MUST 提供 `showAppAlert(payload) -> Promise<number>`，主进程任意模块可调用触发应用内弹窗。

#### Scenario: 主窗口存在时调用

- **WHEN** `showAppAlert` 被调用且主窗口存在
- **THEN** 立即向渲染进程推送 `ui:dialog` 消息（含唯一 id + payload 字段）
- **AND** 返回 Promise，resolve 用户点击的按钮索引（0-based）

#### Scenario: 主窗口已销毁或不可用

- **WHEN** `showAppAlert` 被调用且主窗口已销毁或不可用
- **THEN** 立即 resolve `payload.defaultId`（缺省 0），不抛异常，不阻塞业务

#### Scenario: 渲染进程 5 分钟内未回报

- **WHEN** 渲染进程 5 分钟内未回报
- **THEN** 自动 resolve `payload.defaultId`（防悬挂），清理 pending map

### Requirement: 渲染进程 API（modal.js）

`src/js/modal.js` MUST 监听主进程 `ui:dialog` 消息并渲染对应 DOM。

#### Scenario: 收到 dialog 消息

- **WHEN** 收到 `ui:dialog` 消息
- **THEN** 立即渲染暗色 alert dialog 在 `document.body` 末尾

#### Scenario: 当前已有 dialog 显示

- **WHEN** 当前已有 dialog 显示
- **THEN** 排队（先显示的先点完，再显示下一个）

#### Scenario: 用户点击按钮

- **WHEN** 用户点击按钮
- **THEN** 通过 `api.dialog.reply(id, buttonIndex)` 回执主进程
- **AND** 移除 dialog DOM
- **AND** 解锁 body overflow
- **AND** 从队列取下一个渲染（如有）

### Requirement: 键盘交互

弹窗 MUST 支持键盘操作（无障碍 + 习惯）。

#### Scenario: Enter 触发默认按钮

- **WHEN** 用户按 Enter
- **THEN** 触发 `payload.defaultId` 按钮

#### Scenario: Escape 触发取消按钮

- **WHEN** 用户按 Escape
- **THEN** 触发 `payload.cancelId` 按钮（缺省时退化为 `defaultId`）

#### Scenario: Tab 焦点循环

- **WHEN** 用户按 Tab / Shift+Tab
- **THEN** 焦点在 buttons 间循环，不外溢

#### Scenario: 首次渲染自动聚焦

- **WHEN** 首次渲染
- **THEN** 自动 focus 默认按钮

### Requirement: 视觉一致性

弹窗样式 MUST 与应用暗色主题统一。

#### Scenario: 背景与描边

- **WHEN** 弹窗渲染
- **THEN** 背景 `var(--mwi-bg-panel)` + `var(--mwi-border-strong)` 1px 描边 + `var(--mwi-shadow-lg)` 阴影
- **AND** 主色按钮：`var(--mwi-accent)` 背景 + `#0E0E11` 文字
- **AND** 三种 type 图标背景色：error → `var(--mwi-status-error)` / warn → `var(--mwi-status-warn)` / info → `var(--mwi-accent)`
- **AND** detail 区域：`var(--mwi-font-mono)` 等宽字体 + `var(--mwi-bg-inset)` 底色 + `pre-wrap` 保留换行
- **AND** 入场动画复用 `mwi-modal-in` keyframes（来自 tokens.css）

### Requirement: 不引入新依赖

实现 MUST 不引入新的 npm 包。

#### Scenario: 依赖检查

- **WHEN** 检查 package.json
- **THEN** 仅依赖 `electron`（`webContents.send` / `ipcMain.on`）+ `tokens.css` 已有 CSS 变量，无新增 npm 包

### Requirement: 与现有 `.modal-*` 命名空间隔离

新弹窗 CSS 类 MUST 使用 `.mwi-alert-*` 前缀，不污染既有 `.modal-*`（用于表单弹窗）。

#### Scenario: CSS 类名前缀

- **WHEN** 检查 modal.js / modal.css 引入的类名
- **THEN** 全部以 `mwi-alert` / `mwi-alert-backdrop` / `mwi-alert-slot` 形式命名，与 `.modal-*` 不冲突

### Requirement: CSP 兼容

实现 MUST 在现有 CSP 下工作，无需 CSP meta 变更。

#### Scenario: 在现有 CSP 下加载

- **WHEN** `src/js/modal.js` 加载
- **THEN** 通过 `script-src 'self'` 加载无报错
- **AND** `src/css/modal.css` 通过 `style-src 'self'` 加载无报错
- **AND** 无内联 `<script>` / `<style>` / 远程资源

### Requirement: 上下文隔离

弹窗通信 MUST 通过 `contextBridge` 暴露的受限 API，而非原始 `ipcRenderer`。

#### Scenario: preload 暴露受限 API

- **WHEN** 检查 preload.js
- **THEN** 仅暴露 `api.dialog.onShow(cb)` 和 `api.dialog.reply(id, idx)`

#### Scenario: 渲染进程权限边界

- **WHEN** 渲染进程代码尝试发 `ui:dialog` 或伪造主→渲消息
- **THEN** 无 `ipcRenderer` 直接通道可用，被 contextBridge 阻断

## MODIFIED Requirements

### Requirement: 代理启动失败处理（proxy-binding 模块）

代理启动失败处理 MUST 改为通过 `alert.showAppAlert` 触发应用内模态弹窗（暗色主题），不再是 `dialog.showMessageBox`。

#### Scenario: 代理启动失败

- **WHEN** proxy.bindSessionProxy 返回 `{ ok: false, error }`
- **THEN** 主进程调 `await alert.showAppAlert({...})` 弹暗色模态（标题、message、detail、按钮文案保持 1:1）
- **AND** 行为不变：销毁 view + emitState('error:proxy_failed') + 返回 `{ ok: false, error: 'proxy_failed: ...' }`
- **AND** 不再用 `dialog.showMessageBox` 系统弹窗
