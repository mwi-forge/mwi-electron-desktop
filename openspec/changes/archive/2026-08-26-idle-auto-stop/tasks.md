## 1. main process — electron-store 配置 + 模块级 idleTimeoutMs

- [x] 1.1 在 lib/views.js 顶部 require electron-store：const Store = require('electron-store');
- [x] 1.2 紧跟 require 后声明 schema 与 store 实例：VIEWS_STORE_SCHEMA = { idleAutoStopMs: { type: 'number', minimum: 0, default: 300000 } }；viewsStore = new Store({ name: 'views', schema: VIEWS_STORE_SCHEMA, clearInvalidConfig: false })；let idleTimeoutMs = 300000; try { idleTimeoutMs = viewsStore.get('idleAutoStopMs'); } catch (e) { /* fallback default */ }
- [x] 1.3 验证：模块加载不抛错；userData/views.json 不存在时 viewsStore.get('idleAutoStopMs') 返回 300000

## 2. main process — pool entry 扩展字段 + 内部函数

- [x] 2.1 在 lib/views.js 修改 pool.set 写入点：扩展为 { view, account, state: 'starting', startedAt: Date.now(), lastActivityAt: Date.now(), idleTimer: null }
- [x] 2.2 新增 armIdleTimer(accountId)：clearTimeout 旧 timer；计算 remaining = Math.max(0, idleTimeoutMs - (Date.now() - entry.lastActivityAt))；setTimeout(callback, remaining)；callback 调 stopView(accountId, 'idle_timeout')；idleTimeoutMs <= 0 时 no-op
- [x] 2.3 新增 disarmIdleTimer(accountId)：clearTimeout + entry.idleTimer = null；幂等
- [x] 2.4 新增 resetActivity(accountId)：entry.lastActivityAt = Date.now()；armIdleTimer(accountId)
- [x] 2.5 新增 disposeAllIdleTimers()：遍历 pool.values() 对每个 entry.idleTimer clearTimeout
- [x] 2.6 修改 stopView 签名：function stopView(accountId, reason)；函数顶部 disarmIdleTimer(accountId)；reason === 'idle_timeout' 时 emitState(accountId, 'stopped:idle_timeout')，否则 emitState(accountId, 'stopped')
- [x] 2.7 在 startView 末尾（state='running' 之前）调 armIdleTimer(accountId)
- [x] 2.8 在 focusView 末尾调 resetActivity(accountId)
- [x] 2.9 把 getIdleTimeoutMs / setIdleTimeoutMs / disposeAllIdleTimers / armIdleTimer 加入 module.exports
- [x] 2.10 验证：模块加载不抛错；disarmIdleTimer 在 entry 无 idleTimer 时是 no-op

## 3. main process — 活动源接线

- [x] 3.1 在 lib/views.js startView 内已有的 before-input-event 剪贴板处理器（line 210-221）下方新增 idle reset 钩子：监听 input.type ∈ {keyDown, mouseDown, mouseWheel} 时调 resetActivity(accountId)；其他 type 不处理
- [x] 3.2 在 lib/views.js startView 内已有的 did-navigate / did-navigate-in-page 处理器（line 241-246）下方追加 reset 逻辑：did-navigate 调 resetActivity(accountId)；did-navigate-in-page 仅在 isMainFrame 为 true 时调 resetActivity；保留 URL emit 给 statusbar 的既有逻辑
- [x] 3.3 验证：模块加载不抛错；每个 running view 的 webContents 注册 2 个 before-input-event listener（剪贴板 + idle）

## 4. main process — IPC handlers

- [x] 4.1 在 lib/ipc.js 注册 views:getIdleConfig handler：返回 { timeoutMs: views.getIdleTimeoutMs(), enabled: views.getIdleTimeoutMs() > 0 }
- [x] 4.2 在 lib/ipc.js 注册 views:setIdleConfig handler：const ms = payload && payload.timeoutMs；if (!Number.isFinite(ms) || ms < 0) throw new Error('invalid timeoutMs')；views.setIdleTimeoutMs(ms)；try { viewsStore.set('idleAutoStopMs', ms); } catch (e) { /* swallow */ }；return { ok: true, timeoutMs: ms, enabled: ms > 0 }
- [x] 4.3 验证：handler 注册不抛错；非法值抛 Error；setIdleTimeoutMs(0) 后 armIdleTimer 在每个 running view 是 no-op

## 5. preload — window.api.views 暴露

- [x] 5.1 在 preload.js 的 views 对象末尾追加：getIdleConfig: () => ipcRenderer.invoke('views:getIdleConfig')；setIdleConfig: (payload) => ipcRenderer.invoke('views:setIdleConfig', payload)
- [x] 5.2 验证：preload 不不抛错；通过 DevTools window.api.views.getIdleConfig() 返回 { timeoutMs: 300000, enabled: true }

## 6. main.js — app 退出级 timer 清理

- [x] 6.1 在 main.js 找到 app.on('before-quit', ...) 钩子，在 require('./lib/socks-gateway').releaseAll() 同一 try 块里加 require('./lib/views').disposeAllIdleTimers()
- [x] 6.2 验证：app 退出时 setTimeout 句柄全部释放

## 7. i18n keys — locale JSON

- [x] 7.1 在 src/locales/zh-CN.json 写 settings.idleAutoStop.{label, hint, value, disabled} 四个 key + views.idleStopReason 一个 key
- [x] 7.2 在 src/locales/en-US.json 写对应英文翻译
- [x] 7.3 验证：JSON.parse 不抛错；window.mwiI18n.t('settings.idleAutoStop.label') 返回正确文案

## 8. settings tab — toggle + numeric input UI

- [x] 8.1 修改 src/js/settings-tab.js 的 buildForm：在 locale fieldset 之后插入新 fieldset，legend 为 t('settings.idleAutoStop.label')；内含 toggle checkbox + numeric input (min=1 max=1440) + hint div + state hint div
- [x] 8.2 在 buildForm 顶部拉取当前 idle config：var idle = await window.api.views.getIdleConfig()；enabledInput.checked = idle.enabled；minutesInput.value = Math.max(1, Math.round(idle.timeoutMs / 60000))；minutesInput.disabled = !idle.enabled
- [x] 8.3 给 enabledInput 加 change 监听：minutesInput.disabled = !enabledInput.checked；updateStateHint()
- [x] 8.4 修改 submit handler：先 await setLocale(code)，再 await setIdleConfig({ timeoutMs: enabledInput.checked ? Math.round(minutesInput.value) * 60000 : 0 })，再关闭 form tab
- [x] 8.5 验证：settings tab 打开看到 idleAutoStop fieldset；toggle off 时 minutes 输入灰掉；save 触发 setIdleConfig IPC；userData/views.json 含 idleAutoStopMs

## 9. tabbar — stopped:idle_timeout state 提示

- [x] 9.1 修改 src/js/tabbar.js 的 render() 函数：当 localStates.get(id) === 'stopped:idle_timeout' 时，在 game tab 节点上挂 title 属性为 t('views.idleStopReason')
- [x] 9.2 验证：触发 idle 自动停止的 tab 在 tabbar 上能看到 hover title 提示已被自动停止（空闲超时）

## 10. Tests

- [x] 10.1 创建 lib/__tests__/views-idle-autostop.test.js：node:test；用 vm sandbox 隔离 views.js 模块，注入 fake electron-store / fake setTimeout / spy on stopView
- [x] 10.2 覆盖 spec.md 的每个 Requirement 段：模块加载默认 300000；armIdleTimer idleTimeoutMs===0 是 no-op；before-input-event keyDown 触发 resetActivity；did-navigate 触发 resetActivity；did-navigate-in-page isMainFrame false 不触发；stopView 入口 disarm timer；focusView 触发 resetActivity；disposeAllIdleTimers 清空所有 timer；IPC handler 校验非法值抛 Error
- [x] 10.3 跑测试：node --test lib/__tests__/views-idle-autostop.test.js，输出 0 fail 才算通过
- [x] 10.4 把测试输出摘要（# pass # # fail）写入 commit message

## 11. GUI verification (cannot be skipped)

- [x] 11.1 bash cat / shasum -a 256 验证所有写入文件真实存在（per memory 2026-08-19 sandbox writes unreliable）
- [x] 11.2 ELECTRON_RUN_AS_NODE=1 node -e "require('./lib/views'); console.log('OK')" 确认模块层可加载
- [x] 11.3 ELECTRON_RUN_AS_NODE=1 node -e "require('./lib/ipc'); console.log('OK')" 确认 IPC 模块加载不抛错
- [x] 11.4 node --test lib/__tests__/views-idle-autostop.test.js 确认 0 fail
- [x] 11.5 node --test lib/__tests__/*.test.js 跑既有测试套件确认无回归
- [x] 11.6 npm start + 真点：启动一个 about:blank 账号；settings tab 改 1 分钟；保存；等 60s 看 tab 自动关、panel 显示 stopped；重启应用验证持久化；关闭 toggle 验证功能关闭
- [x] 11.7 截图 settings tab idleAutoStop fieldset 给用户确认 UI 视觉（per skill openspec-archive 规则）

## 12. Archive

- [x] 12.1 openspec validate idle-auto-stop --strict 必须 0 errors
- [ ] 12.2 openspec archive idle-auto-stop --yes 仅在 11.7 用户截图确认后（per skill openspec-archive 规则 + memory archive != behavior correct）
- [ ] 12.3 openspec list --json 验证 idle-auto-stop 移到 archive；openspec/specs/views-idle-autostop/spec.md 主 spec 已存在并含 Purpose + Requirements
