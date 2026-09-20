# Design: ui-modal-component

## 数据流

```
主进程:                                          渲染进程:
=========                                         ===========

lib/views.js (startView)
  └─ await alert.showAppAlert(payload)
       │
       ├─ genId() → _pending.set(id, resolve)
       └─ mainWindow.webContents.send('ui:dialog', {id, ...})
                                                      │
                                                      ▼
                                          api.dialog.onShow(payload)
                                                      │
                                                      ▼
                                          modal.js: queue.push(payload)
                                                      │
                                                      ▼
                                          pump() → renderDialog(payload)
                                                      │
                                            ┌─────────┴─────────┐
                                            │ user clicks button│
                                            └─────────┬─────────┘
                                                      │
                                                      ▼
                                          api.dialog.reply(id, buttonIndex)
                                                      │
       ┌──────────────────────────────────────────────┘
       │
       ▼
ipcMain.on('ui:dialog:reply') → alert.replyDialog(id, idx)
                                                      │
                                                      ▼
                                          _pending.get(id)(idx) → resolve
                                                      │
       ┌──────────────────────────────────────────────┘
       │
       ▼
views.js startView 继续往下走（清理 view + return error）
```

## 关键设计决策

### 1. 单 slot 单例 + 队列（不允许多弹窗叠加）

**理由**：代理失败是安全告警，可能多账号同时启动触发。如果允许叠加，用户会被 5 个弹窗砸脸，体验灾难。

**实现**：modal.js 维护 `currentEl`（当前显示的 dialog）+ `queue[]`（待显示）。`pump()` 在 currentEl=null 时从 queue 取下一个渲染。`cleanup()` 在用户点按钮后调用 `pump()` 触发下一帧。

### 2. 5 分钟超时（防渲染进程崩溃悬挂）

**理由**：渲染进程崩溃 / WebContentsView 重建等极端场景下，用户可能永远看不到弹窗，Promise 永远不 resolve，导致 views.js startView 永远 hang 住。

**实现**：`showAppAlert` 内 setTimeout 5min，到时 auto-resolve defaultId（0 = 第一个按钮 = 等价于用户点"我知道了"），清理 pending map。

### 3. 按钮区分 alert / confirm

**alert**（单向通知）：`buttons: ['我知道了']` + `defaultId: 0` + `cancelId: 0`（Esc 等价确定）

**confirm**（二次确认）：`buttons: ['取消', '确定']` + `defaultId: 1`（Enter = 确定） + `cancelId: 0`（Esc = 取消）

调用方按场景选 type + buttons；不强制 type 字段（向后兼容，缺省 'info'）。

### 4. 键盘可达性

- **Enter** → 触发 `defaultId`
- **Escape** → 触发 `cancelId`（如有）；缺省时退化为 `defaultId`
- **Tab / Shift+Tab** → 焦点陷阱（仅在 buttons 间循环，不外溢）
- **首次渲染** → 自动 focus 默认按钮

### 5. body scroll lock + focus trap

弹窗期间：
- `document.body.style.overflow = 'hidden'`（保存 prev 值，cleanup 还原）
- keydown 监听用 capture phase 拦截，避免游戏 view 抢焦点
- backdrop click 默认**不**关闭（`dismissOnBackdrop: false`）—— 安全告警不能误关；仅 `dismissOnBackdrop: true` 时允许（如 confirm 类）

### 6. 与现有 `.modal-*` 命名空间隔离

现有 `.modal-backdrop` / `.modal` / `.modal__btn` 用于**表单弹窗**（账号编辑、设置），结构差异大（多字段、校验、提交按钮组）。

新方案用 `.mwi-alert-*` 前缀，避免 selector 冲突；后续若需要可平滑迁移。

### 7. CSP 兼容

现有 CSP：`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;`

新增内容：
- `src/js/modal.js` 走 `'self'` script-src ✅
- `src/css/modal.css` 走 `'self'` style-src ✅
- 无内联 `<style>` / 内联 `<script>` / 远程资源 ✅
- 无需 CSP 变更

### 8. 样式 token 化（不引入新颜色）

全部用 `tokens.css` 已有变量：
- `--mwi-bg-panel` / `--mwi-bg-elevated` / `--mwi-bg-hover` / `--mwi-bg-active` —— 背景层级
- `--mwi-text-primary` / `--mwi-text-secondary` —— 文字
- `--mwi-border-subtle` / `--mwi-border-strong` —— 边框
- `--mwi-accent` / `--mwi-accent-strong` / `--mwi-accent-soft` —— 主色
- `--mwi-status-error` / `--mwi-status-warn` / `--mwi-accent` —— 状态色（error / warn / info）
- `--mwi-radius-sm/lg` / `--mwi-space-1..6` —— 圆角间距
- `--mwi-font-mono` / `--mwi-font-ui` / `--mwi-shadow-lg` —— 字体阴影
- `mwi-modal-in` keyframes —— 入场动画（复用）

唯一新增：
- `.mwi-alert__icon` 圆形背景色文字色 `#0E0E11`（深色字配浅底色，对应 error 红 / warn 黄 / info 蓝）

## 安全考量

### contextBridge 不变量
- `api.dialog.onShow` 通过 `contextBridge.exposeInMainWorld` 暴露，渲染进程拿到的是包装后的 API（不是原始 ipcRenderer）
- 渲染进程不能伪造 `ui:dialog` 主→渲消息（只能监听）
- 渲染进程 `api.dialog.reply` 只能 send 到固定 channel `ui:dialog:reply`，主进程 handler 仅调 `replyDialog(id, idx)`，idx 经过 typeof 检查

### id 抗碰撞
- id 由 `Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,8)` 生成
- 碰撞概率极低；碰撞时第二个 reply 静默 warn（_pending.delete 后查不到）

### 超时兜底
- 5min 超时强制 resolve defaultId（不会永远 hang）
- 主窗口关闭 resetPending（不会跨实例悬挂）

## 测试策略

**本 PR 不写新测试**：
- UI 交互测试 ROI 低（mock 渲染进程 + DOM 断言覆盖不全面）
- 现有 e2e 测试不依赖 modal API

**手动验证清单**（写在 tasks.md Phase 8）：
1. `npm run dev` 启动开发模式
2. 杀掉/移走 mihomo 二进制（如 `mv resources/mihomo /tmp/`）
3. 启动一个 subscription 代理账号
4. 预期：弹窗暗色（与 chrome UI 同色系），非 Windows 系统白底
5. 点"我知道了" → 弹窗关闭，view 不启动（侧栏 tab 没出现，状态显示 error:proxy_failed）
