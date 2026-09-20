## Context

mwi-electron-desktop 是一个 Electron 多账号浏览器应用，每个账号对应一个 WebContentsView，嵌入主窗口中部，通过 tab 栏切换（不是独立 BrowserWindow）。当前账号生命周期完全靠用户手动 stop：用户点 sidebar / panel 的停止按钮，lib/views.js 的 stopView() 销毁 WebContentsView、释放 gateway、清掉 pool entry。

现有架构：
- 主进程 lib/views.js 管理 pool Map（accountId → { view, account, state, startedAt }）；entry.state 取值 starting / running / stopped / error:*
- 主进程 lib/ipc.js 注册所有 ipcMain.handle；preload.js 暴露 window.api.* 给渲染进程
- electron-store 已用于 lib/i18n.js / lib/accounts.js / lib/subscriptions.js 的持久化（独立 name 命名空间）
- settings tab 已存在（locale 切换）；使用 .account-form-card / .modal__btn 等复用样式

用户场景痛点：
- 忘记停：账号启动后用户切走或离开电脑，整个 view 进程挂着，多账号叠加后明显拖慢整机
- 挂机策略不统一：用户希望按账号统一一个无操作 N 分钟自动停的兜底

## Goals / Non-Goals

**Goals:**
- 提供 per-account idle timer，账号启动后无操作 N 分钟自动调 stopView
- 配置可调节（默认 5 分钟；范围 1~1440 分钟；0 表示关闭）
- 配置变更（setIdleConfig）立即对所有 running view 重置 timer
- settings tab 提供可视化配置 UI（toggle + numeric input）
- tabbar 在 stopped:idle_timeout state 的 tab 上挂 hover title 提示
- app before-quit 时清空所有 timer 防 setTimeout 在退出后触发

**Non-Goals:**
- 不做 idle 检测的智能判断（鼠标移动检测等）—— 仅基于键鼠按键、页面导航、焦点切换三类明确活动
- 不做 per-account 差异化阈值（统一全局配置）
- 不做 idle 计数提醒 / 通知（用户已离开电脑时通知无意义）
- 不改现有 stopView / focusView / startView 的核心逻辑（idle 是叠加层）
- 不改主进程的 metrics / logs / accounts / subscriptions 模块

## Decisions

### 决策 1：活动源选 keyDown + mouseDown + mouseWheel（不含 mouseMove）

- 选择：before-input-event 的 input.type ∈ {keyDown, mouseDown, mouseWheel} 视为活动；mouseMove / touchStart 不算
- 替代方案 A：mouseMove 也算活动 → 用户只是鼠标飘过页面就会持续 reset timer，等于关闭功能
- 替代方案 B：仅 keyDown → 误触滚轮 / 点击输入框会让 timer 持续延后
- 理由：keyDown + mouseDown + mouseWheel 覆盖 99% 的真实用户交互；mouseMove 太敏感会破坏兜底语义

### 决策 2：did-navigate / did-navigate-in-page 也算活动

- 选择：用户主动点击链接 / 提交表单触发 SPA hash 变化等场景属于有效活动
- 替代方案 A：仅 keyDown / mouseDown → SPA 路由切换不会被识别为活动，误判为 idle
- 理由：navigate 是用户意图的强信号，应当 reset

### 决策 3：focusView 切换时 reset 活动

- 选择：用户切换到某 view 视为该 view 的活动（用户在场）
- 理由：tab 切换是用户主动行为，即使没在该 view 上操作也算活动

### 决策 4：pool entry 扩展 lastActivityAt + idleTimer 字段

- 选择：在原有 { view, account, state, startedAt } 基础上加 lastActivityAt (number) + idleTimer (Timeout | null)
- 理由：把 idle 状态挂到现有 entry 上，避免另起 Map；stopView 时一并清理 entry.idleTimer

### 决策 5：armIdleTimer 计算 remaining = idleTimeoutMs - (now - lastActivityAt)

- 选择：每次 reset 后 用 remaining = Math.max(0, idleTimeoutMs - (Date.now() - entry.lastActivityAt)) 计算剩余时长，再 setTimeout
- 替代方案 A：每次 reset 直接 clearTimeout + setTimeout(idleTimeoutMs) → 频繁 reset 会让 timer 永远延后
- 理由：remaining 算法保证用户连续活动时整体 idle 窗口最长不超过 idleTimeoutMs

### 决策 6：stopView 接受可选 reason 参数；reason === 'idle_timeout' 时 emitState 输出 stopped:idle_timeout

- 选择：function stopView(accountId, reason)；emitState 时 reason === 'idle_timeout' → 'stopped:idle_timeout'，否则保持 'stopped'（向后兼容既有 stopView 调用）
- 理由：renderer 可识别 idle_timeout 状态并展示历史提示，但既有 'stopped' 路径不变（panel / sidebar 等既有渲染逻辑零改动）

### 决策 7：electron-store 用 name='views'（与 i18n / accounts / subscriptions 并列）

- 选择：lib/views.js 顶部 new Store({ name: 'views', schema: { idleAutoStopMs: { type: 'number', minimum: 0, default: 300000 } } })；写失败静默
- 理由：与现有 lib/i18n.js / lib/accounts.js 风格一致；schema 保证外部写入脏值不会破坏配置

### 决策 8：IPC setter 同步刷新所有 running view 的 timer

- 选择：views:setIdleConfig handler 调 views.setIdleTimeoutMs(ms)；setter 内部遍历 pool 对每个 entry 重新 arm
- 理由：用户改配置后立即生效，无需重启应用；新 timer 用新 idleTimeoutMs - remaining 计算剩余

### 决策 9：app before-quit 调 views.disposeAllIdleTimers()

- 选择：main.js 的 before-quit 钩子里调 views.disposeAllIdleTimers() 清空所有 timer
- 理由：防 setTimeout 在 app 已 quit 后触发回调，避免访问已销毁的 entry / 触发 stopView 二次清理

### 决策 10：settings tab idleAutoStop fieldset 与 locale 共享同一 form submit

- 选择：buildForm 内 locale fieldset + idleAutoStop fieldset 一起渲染；submit handler 先 await setLocale(code)，再 await setIdleConfig({ timeoutMs })，最后关 tab
- 替代方案 A：idleAutoStop 独立 tab → 用户操作路径长
- 理由：idle 配置属于全局偏好，与 locale 同级；共用提交减少 UI 跳转

## Risks / Trade-offs

### Risk 1：before-input-event 包含剪贴板处理 → 双 handler 共存

- 风险：lib/views.js line 210-221 已有剪贴板 handler（Cmd+C/V/X/A）；再加 idle handler 会触发两个独立 on('before-input-event') 监听
- Mitigation：保留剪贴板 handler 不动；新增独立 handler 在其下方，两者互不影响

### Risk 2：mouseMove 触发大量 resetActivity 调用

- 风险：决策 1 排除了 mouseMove，但仍需确保 mouseMove 不被识别为活动
- Mitigation：handler 内显式判断 input.type ∈ {keyDown, mouseDown, mouseWheel}；其他 type 不调用 resetActivity

### Risk 3：tabbar.js render() 既有状态机扩展

- 风险：state 字符串现在多了一个 'stopped:idle_timeout' 变体；既有 statusClass / statusMark 分类可能误判
- Mitigation：tabbar.js 已识别新 state；既有 'stopped' / 'starting' / 'running' 渲染路径不变；新 state 走 hover title 提示，不引入新的 dot 类别

### Risk 4：electron-store 写失败静默可能掩盖 bug

- 风险：lib/i18n.js 同款 Risk R4 模式；持久化失败时用户感知不到
- Mitigation：lib/views.js 写盘用 try/catch 静默吞；如需后续诊断，可在 logs 模块加 warning；当前不阻塞运行

### Risk 5：setIdleConfig 非法值（负数 / NaN）抛 Error 影响 IPC

- 风险：preload 抛 Error 后 renderer 接 promise reject，可能引起 UI 闪退
- Mitigation：handler 显式 Number.isFinite(ms) && ms >= 0 校验，非法 throw Error('invalid timeoutMs')；settings tab submit handler 提前校验避免抛

### Risk 6：disposeAllIdleTimers 在 before-quit 钩子位置不对

- 风险：如果 dispose 早于 gateway release，setTimeout 触发时尝试释放已释放的 gateway
- Mitigation：main.js before-quit 与 socks-gateway.releaseAll 同一 try 块；都成功后才 dispose；dispose 内部 try/catch 兜底