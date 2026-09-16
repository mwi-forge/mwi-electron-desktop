## Why

账号启动后用户切到其它 tab 或离开电脑，整个 WebContentsView 进程挂着、代理 / fingerprint / session partition 持续占内存；多账号叠加后明显拖慢整机（每个 view 独立渲染进程）。用户需要一个无操作 N 分钟自动停的硬性兜底，既不需要逐账号勾选，也不需要第三方 cron / 脚本注入。

## What Changes

- 新增 per-account idle timer：账号启动后无任何用户活动超过设定时长，自动调用现有的 stopView 销毁 WebContentsView、释放 gateway、清掉 pool entry
- 配置项：通过 settings tab 控制（默认 5 分钟；范围 1 ~ 1440 分钟；0 表示关闭）
- 活动源：键鼠输入（before-input-event）+ 页面导航（did-navigate / did-navigate-in-page）+ 焦点切换（focusView）三类视为活动，自动重置 timer
- 配置存储：electron-store 新文件 views.json，字段 idleAutoStopMs；缺字段 fallback 300000；写失败静默
- IPC 暴露：views:getIdleConfig / views:setIdleConfig，setter 校验后写盘 + 重置所有 running view 的 timer
- settings tab 新增 idleAutoStop fieldset（toggle 启用/关闭 + numeric input 1~1440 分钟 + 异步回填）
- tabbar 在 stopped:idle_timeout state 的 tab 上挂 hover title 提示已被自动停止（空闲超时）
- app before-quit 时调 disposeAllIdleTimers 防止 setTimeout 在退出后触发

## Capabilities

### New Capabilities

- views-idle-autostop: 提供 views.js pool entry 维度的 per-account 空闲计时器，自动活动源（before-input-event / did-navigate / did-navigate-in-page / focusView），electron-store 配置（views.idleAutoStopMs），IPC surface（views.getIdleConfig / views.setIdleConfig），settings tab UI（toggle + numeric input + i18n keys），app 退出级 timer 清理。具体见 specs/views-idle-autostop/spec.md。

### Modified Capabilities

无。

## Impact

- 主进程：lib/views.js（pool entry 扩展字段 + 6 个新内部函数 + stopView 接受 reason 参数 + emitState 支持 stopped:idle_timeout）、lib/ipc.js（views:getIdleConfig / views:setIdleConfig handler）、preload.js（window.api.views.getIdleConfig / setIdleConfig）、main.js（before-quit 调 views.disposeAllIdleTimers）
- Renderer：src/js/settings-tab.js（idleAutoStop fieldset + 异步回填 + submit 落盘）、src/css/settings-tab.css（fieldset / toggle row / minutes row 样式）、src/js/tabbar.js（stopped:idle_timeout state 的 hover title 提示）、src/locales/zh-CN.json + en-US.json（settings.idleAutoStop.* 5 个 key + views.idleStopReason 1 个 key）
- 数据层：electron-store 新文件 userData/views.json，结构 { idleAutoStopMs: number }；缺字段 fallback 300000
- IPC surface：preload window.api.views 新增 getIdleConfig / setIdleConfig；主进程 ipcMain.handle views:getIdleConfig + views:setIdleConfig；既有 IPC 不动
- 运行时：每个 running view 持有一个 Node setTimeout 句柄；timer fire 时调 stopView（O(1) 销毁逻辑）；额外 CPU / 内存开销 < 1KB / view
- 依赖：无新增 npm 包（electron-store 已用）
- 测试：lib/__tests__/views-idle-autostop.test.js 用 vm sandbox + fake electron-store + fake setTimeout 覆盖 8 类场景（timer arm/disarm/fire / 活动源 reset / timeoutMs===0 不 arm / stopView 一定 disarm / before-quit 清理 / IPC handler 校验）