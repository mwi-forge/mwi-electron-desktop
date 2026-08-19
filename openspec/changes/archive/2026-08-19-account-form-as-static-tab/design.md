# Design: account-form-as-static-tab

## Context

参见 proposal.md - Why / What / Alternatives。当前状态约束：
- mwi-electron-desktop 是单窗口 Electron 应用，主窗口 webContents 加载 src/index.html，中部 canvas 区通过 mainWindow.contentView.addChildView(WebContentsView) 嵌入游戏画面
- 已启动账号用 tab 栏（src/js/tabbar.js）+ WebContentsView 组合，账号 tab 与视图一一对应
- 浏览器（DOM）层级调 z-index 对 WebContentsView 无效（Electron 原生层永远绘制在 DOM 之上）
- 现有 lib/views.js 维护 WebContentsView 池：pool, focusedId, setMainWindow / startView / stopView / focusView / reload / listRunning / getFocusedId / getState / setLayout / computeViewBounds
- 现有 IPC 协议：accounts.*、groups.*、views.*、layout.*、logs.*、metrics.*、proxy.*、fingerprint.*、tampermonkey.*、meta.*

## Goals / Non-Goals

Goals:
- 账号表单以静态 tab 形式嵌入中部 canvas，不被 WebContentsView 遮挡
- 表单 tab 切换时临时让游戏 view 让位（hideFocused/resumeFocused），关闭 tab 恢复
- 复用现有 accounts.* IPC，不变更数据层协议
- 保持 vanilla HTML/CSS/JS，不引入前端框架

Non-Goals:
- 不变更 WebContentsView 池核心机制（仅扩展 hide/resume 接口）
- 不引入多表单 tab 并存隔离（本期不做，留给后续变更）
- 不重写 tabbar.js 整体结构（在既有 game tab 基础上扩展 form tab）
- 不变更 IPC 协议（accounts.create/update 不变）

## Decisions

### 1. 静态 tab 而不是新 BrowserWindow
选择：表单作为静态 HTML 嵌入中部 canvas div#canvas-form-mount，不创建新 BrowserWindow 子窗口
理由：静态 tab 与游戏 tab 同级（都在中部 canvas），架构最一致；游戏 view 让位/恢复靠 removeChildView / addChildView 是 BrowserWindow contentView 的标准操作，比 OS 窗口少一层架构
替代考虑：BrowserWindow 子窗口（modal:true + alwaysOnTop）— 已实施并弃用，因为用户偏好'像新 tab'效果，且子窗口增加架构成本（独立 preload、独立 modal 通信）

### 2. canvas 切换：hideFocused / resumeFocused
选择：在 lib/views.js 新增 hideFocused() / resumeFocused() / isFocusedHidden() 三个函数，分别对应 mainWindow.contentView.removeChildView(focused) 与 addChildView(focused)
理由：view 对象保留在 pool Map 里不被销毁，只是从 contentView 摘下，恢复时直接 addChildView；同一 view 的 WebContents 内部状态（cookies、IndexedDB、session）不丢失
替代考虑：销毁 view 再重建（重载游戏页面）— 用户体验差（黑屏闪烁）

### 3. tab 数据模型扩展 formTabs
选择：src/js/tabbar.js 内部新增 formTabs 数组 + activeTabId 状态；form tab 渲染时与 game tab 合并输出到 tabbar DOM
理由：form tab 与 game tab UI 形态相似（标题 + close 按钮），复用 tabbar 渲染逻辑；formTabs 是 renderer 内部状态，不需走 store（避免污染共享 state）
替代考虑：把 formTabs 写入 mwiStore — 增加 store 字段但收益小（只有 tabbar 用）；副作用是其他订阅者也会触发刷新

### 4. 表单 DOM 用 createElement 拼接，不用 innerHTML 注入
选择：src/js/account-form.js 用 document.createElement 逐节点构建表单，再 append 到 #canvas-form-mount
理由：innerHTML 注入 <script> 不会执行（浏览器安全策略）；createElement 拼接是确定的、跨场景一致
替代考虑：fetch + DOMParser 解析 src/account-form.html + 内联 script 提取执行 — 增加复杂度，且表单只在第一次切到 form tab 时需要，cache 收益有限

### 5. 复用 .modal-* 样式
选择：src/css/account-form.css 只新增 canvas 嵌入专属样式（占满 canvas、去掉 backdrop 视觉）；表单字段样式复用 src/css/sidebar.css 已有的 .modal__title / .modal__form / .modal__fieldset / .modal__hint / .modal__actions
理由：sidebar.css 的 .modal-* 已稳定可用；新写一份等价样式是冗余；现有 token（--mwi-bg-panel、--mwi-radius-lg 等）天然兼容
替代考虑：全部样式重写 — 工作量大且无收益

## Risks / Trade-offs

### Risk: form tab 与 game tab 状态机竞态
问题：用户快速切换 form tab / game tab / close tab 时，hideFocused / resumeFocused 与 focusView 顺序可能错乱，导致 game view 没挂上
缓解：focusGameTab / focusFormTab 内部串行 await；resume 失败时不抛错（用 try/catch 静默）；isFocusedHidden 作为幂等检查

### Risk: 多 form tab 并存（本期未做）
问题：当前实现允许同 account 同时开多个 form tab（如编辑 + 添加同时存在），但 stateData 共享同一表单 DOM，会互相覆盖
缓解：本期显式声明为 non-goal；未来扩展时需为每个 form tab 维护独立 mount 节点（#canvas-form-mount 改为 #canvas-form-mount-tabId）

### Risk: webContents 内存
问题：hideFocused 不销毁 view，仅 removeChildView；多次切换后 view 仍驻留内存
缓解：view 数受 MAX_VIEWS=6 限制（lib/views.js:9），账号 stop 时才会销毁；表单 tab 切换不创建新 view

### Trade-off: canvas 内容替换 vs 叠加
选择：form tab 激活时完全替换中部 canvas（隐藏 placeholder、显示 form）；game tab 激活时反过来
理由：与'打开新 tab 切换内容'的浏览器心智模型一致
权衡：用户不能同时看游戏画面 + 表单（但这是少见的双屏需求）

## Migration Plan

### 部署顺序
1. 主进程新增 hideFocused / resumeFocused / isFocusedHidden + IPC 通道 + preload 暴露 API（已落地）
2. src/index.html 加 #canvas-form-mount 挂载点（已落地）
3. src/css/account-form.css 中部样式（已落地）
4. src/js/account-form.js 表单逻辑（已落地）
5. src/js/tabbar.js 支持 form tab（已落地）
6. src/js/sidebar.js openModal 改为调 window.mwiTabbar.openFormTab()（pending）
7. 静态校验：node --check + OpenSpec validate（pending）
8. openspec archive 归档（pending）

### 回滚策略
- 保留 git 历史 git revert <apply-commit>
- 同时恢复 src/modal-account.* 等被删除的文件（git reflog 可恢复）
- 表单回退到 inline DOM 方案（之前 sidebar.js openModal 的最初版本），但接受 WebContentsView 遮挡

## Open Questions

（暂无 — 实施期再出现的未知项放入本节；不影响当前 spec/approach/tasks 拆分）
