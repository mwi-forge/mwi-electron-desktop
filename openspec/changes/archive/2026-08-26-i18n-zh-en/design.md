## Context

mwi-electron-desktop 当前所有 UI 文案是渲染进程 JS 内 hardcode 中文，`index.html` 写死 `<html lang="zh-CN">`；没有任何翻译表、没有 t() 抽象、没有 locale 切换、没有 HTML lang 同步。栈是 Electron 43 + vanilla HTML/CSS/JS（不引前端框架）。electron-store 已存在并被 settings 命名空间使用。

本次要加 zh-CN / en-US 切换；只能新增基础设施，不能抽取现有 hardcode 字符串（避免大改文件硬约束）。详见 `proposal.md - Why` 与 `specs/app-i18n/spec.md`。

## Goals / Non-Goals

**Goals:**
- 渲染进程加载 zh-CN / en-US 两个 JSON locale 表，落内存
- t(key, vars) 函数：current locale 命中 → current locale 未命中走 zh-CN fallback → 都不命中返回 key 字面；支持 `{name}` 占位符
- setLocale(code) 切语言 + 同步 `document.documentElement.lang` + 广播 onChange
- locale 跨重启保留（electron-store `settings.locale`，缺省 zh-CN）
- preload 暴露 `window.api.i18n.{get, set, list}`
- settings static tab 提供语言下拉，与 account-form 同模式

**Non-Goals:**
- 不在本次抽取任何 hardcode UI 字符串（后续 change 渐进式）
- 不引第三方 i18n 库（无 i18next / FormatJS / lingui）
- 不加 zh-CN / en-US 之外的 locale
- 不改既有 IPC surface、不动 OpenSpec 工具本身、不引入浅色模式
- 不做翻译缺失时的 build-time 校验（运行时 fallback 已经覆盖）

## Decisions

### 1. locale 表加载放在 preload，不用 renderer fetch
- 选 A：preload 用 Node `fs.readFileSync` 同步读两个 JSON，挂到 `window.__mwiLocales = { "zh-CN": {...}, "en-US": {...} }`
- 选 B（放弃）：renderer 用 `fetch("./locales/zh-CN.json")` 加载
- 理由：项目用 vanilla HTML 没 bundler，Electron 下 file:// 的 fetch 同源策略在不同版本行为不一；preload 已经有 Node access；同步加载避免初始化竞态
- 取舍：locale 文件必须与 `preload.js` 同包（同进程可达）；UTF-8 BOM 必须清掉；JSON.parse 失败时静默给空表

### 2. vanilla t() + Map，不引第三方
- 选 A：对象 + `{name}` 占位符正则替换，运行时 < 1ms
- 选 B（放弃）：i18next（多 60KB 包大小 + 异步初始化）
- 理由：当前需求只有 2 个 locale + 简单占位符；vanilla t() 完全足够；不引第三方匹配项目栈"vanilla HTML/JS"约定
- 取舍：暂无 ICU plural / RTL / 日期本地化能力——超出本 change 范围，不预留

### 3. `<html lang>` 同步由 setLocale 主动写
- 选 A：`document.documentElement.lang = currentLocale` 在 setLocale 里同步执行
- 选 B（放弃）：监听 MutationObserver 在 lang 属性变化时反向同步 locale（多此一举）
- 理由：HTML lang 是 locale 的派生视图，不是源；前者由 setLocale 单向控制

### 4. locale 持久化用现有 electron-store `settings` 实例
- 选 A：复用已有 `electron-store` `settings`，新增字段 `locale: "zh-CN" | "en-US"`
- 选 B（放弃）：开新 `electron-store` 实例只存 locale（碎片化）
- 选 C（放弃）：用 `app.getPath("userData") + json` 自己写文件（重复造轮子）
- 理由：electron-store 已稳态运行；新增字段 zero-cost；缺点是失败时已有的 catch 已经吞掉错误，不影响本次（graceful fallback 到 zh-CN）

### 5. settings tab 走 static-tab 模式
- 选 A：复刻 archived `account-form-as-static-tab` change 中形成的 static-tab 模式（tab 节点 + `.tab--static` 样式 + `.canvas__form-mount` 容器 + `[hidden]` toggle）
- 选 B（放弃）：settings 走独立 BrowserWindow（破坏单窗口架构，硬约束）
- 理由：项目架构（user memory 2026-08-18）已明确"主窗口 + WebContentsView + tab 切换"单窗口方案；settings 必须是 tab
- 取舍：tab 多一个不增加内存（DOM 节点 ~50 个 vs 一整个 BrowserWindow ~80MB），但 tab 顺序、关闭态、聚焦逻辑需要 tabbar.js 处理——与 account-form 复用同一套 click handler 分发

### 6. IPC 三方法签名
- `i18n.get()` → `Promise<string>`：返回 electron-store 当前 locale；store 缺字段或读取失败返回 `"zh-CN"`
- `i18n.set(localeId: "zh-CN" | "en-US")` → `Promise<void>`：写 electron-store + 调 renderer-side `window.mwiI18n.setLocale(localeId)`；非法 localeId 抛 Error（preload 转 throw）
- `i18n.list()` → `Promise<string[]>`：固定返回 `["zh-CN", "en-US"]`，不在主进程 / 落盘的可变列表
- 理由：`set` 在主进程做持久化是为了单写者；renderer-side `mwiI18n.setLocale` 在 set 之后才执行，保证 DOM 同步在写盘后
- 取舍：set 不广播（renderer 自己监听 onChange 就够；不引 webContents.send）

### 7. i18n.js 加载顺序：tabbar.js 之前
- 选 A：i18n.js 在 `index.html` 里 `<script src="js/i18n.js">` 在 `tabbar.js` 之前
- 选 B（放弃）：i18n.js 在所有脚本之后（DOM 文本已渲染完，再切 lang 不会有反应）
- 理由：tabbar 渲染期间就会调 t()；i18n.js 必须就位；初始化在 DOMContentLoaded 完成，setLocale(initial) 把 `<html lang>` 同步成 store 中的值

## Risks / Trade-offs

**[R1] preload 启动失败 → locales 永远加载不到 → 渲染进程 t() 永远 fallback zh-CN**
→ Mitigation：preload 用 try/catch 包裹 fs，失败时把 `window.__mwiLocales` 设为 `{ "zh-CN": {}, "en-US": {} }`；UI 仍能开

**[R2] renderer 在 `window.mwiI18n` 还没就绪时调 t()**
→ Mitigation：t() 实现层面防御：`if (!window.mwiI18n) return key;`；外加 index.html 加载顺序保证 i18n.js 早于 tabbar.js

**[R3] locale 切换后 DOM 已渲染文本不会自动改（只切了 lang 属性，没翻字面）**
→ Mitigation：本 change 范围明确说明本次**不抽字符串**——切语言不会让现有硬编码文本变；onChange 回调给后续 change 用，由它们负责重渲染自己的模块

**[R4] electron-store 写 locale 失败**
→ Mitigation：catch 全部异常，set 仍返回成功（in-memory 已切换），下次启动 fallback；不弹 modal（不打扰用户）

**[R5] 后续字符串抽取 change 与本次基建兼容性**
→ Mitigation：t() 已经按 fallback 链 + 占位符语义设计；后续 change 在抽取时只需 `key -> t('key')` + 把原文填进 zh-CN.json；en-US 缺 key 时 runtime fallback 自动 zh-CN，不会破坏显示

**[R6] settings tab 与其他 static tab（account-form）的 tabbar focus 路由冲突**
→ Mitigation：tabbar.js click handler 按 `[data-tab-type]` + `[data-form-id]`（或 `[data-settings-id]`）二次分发（参照 `2026-08-19 mwi Tab 切换错乱类 BUG 教训`）；settings tab 给 type=static, form-id=settings

## Migration Plan

本 change 是基础设施增量，**无破坏性变更**：

- 不删任何现有文件
- 不改任何现有 IPC surface
- 不改任何现有 UI 文案（字符串抽取留给后续 change）
- 新增的 `i18n.*` 与已存在的 IPC 不重名（无冲突）

部署步骤：
1. M2 完成后 `npm start` + 真点 settings → 切语言 → HTML lang 变（用户截图确认）
2. 重启应用 → locale 保留（手动验证）
3. electron-store 清空（删 settings.json） → 回退 zh-CN（手动验证）
4. 用户批准后 archive

回滚策略：若 archive 后发现严重问题，`mv openspec/changes/i18n-zh-en openspec/changes/archive/2026-08-19-i18n-zh-en-disabled/` + 删 `src/locales/`、`src/js/i18n.js`、`src/js/settings-tab.{js,css}`、`preload.js` 中 i18n 段、`main.js` 中 `i18n.*` handler、`src/js/tabbar.js` 中 settings 注册、`src/index.html` 中 i18n / settings 标签、`tests/i18n.test.mjs`。

## Open Questions

（无——所有可能影响 spec / approach / tasks 的决策本 design 已解决；其余"是否做语言无关图标 / 是否做 Number 格式化 / 是否做日期格式化"均在 Non-Goals 明确，后续如需另开 change）
