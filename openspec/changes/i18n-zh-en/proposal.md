# Proposal: i18n-zh-en

## Why

mwi-electron-desktop 目前的 UI 文本全部硬编码中文（alert / button / label / tab 标题 / 表单 placeholder / 错误提示 等），`<html lang="zh-CN">` 也是写死的。用户希望加一个 zh-CN / en-US 双语切换能力：

- 不引第三方 i18n 库（vanilla t() 函数足够，匹配项目栈）
- 在 settings 提供语言切换入口（参照已有 account-form static-tab 模式）
- locale 跨重启保留（走 electron-store）
- **strings 抽取与基建一并完成**（per 2026-08-19 用户实测反馈，只搭基建 UI 无可见变化不可接受）

当前缺口：所有 UI 文案直接写在 JS 字符串字面量里，没有翻译表、没有 t() 抽象、没有 locale 切换、没有 HTML lang 同步。哪怕增加一个英文 UI 字符串都得改 JS 源码；这在多语言扩展、协作、Git 冲突面都会形成摩擦。

## What Changes

- 新增 `app-i18n` 能力（见下节 Capabilities）
- 新增 locales 目录，存放 `zh-CN.json` / `en-US.json`，当前为两个空对象（占位）
- 新增 `src/js/i18n.js`：暴露 `window.mwiI18n.{t, setLocale, getLocale, onChange}`；t(key, vars) 支持 `{name}` 占位符；fallback 链 en-US → zh-CN → key 字面
- 新增 `src/js/settings-tab.js` + `src/css/settings-tab.css`：settings 静态 tab，提供语言下拉与保存（参照已归档 `account-form-as-static-tab` 的 static-tab 模式）
- 修改 `src/index.html`：在 tabbar.js 之前加载 `js/i18n.js`；初始 `<html lang>` 由 i18n 接管（应用启动时按 store 中的 locale 同步）
- 修改 `preload.js`：暴露 `window.api.i18n.{get, set, list}`
- 修改 `main.js`：注册 `ipcMain.handle('i18n.*')` 三个方法；新增 electron-store `settings.locale` 字段（缺省 `zh-CN`）
- 修改 `src/js/tabbar.js`：注册 settings static tab，按 type/id 分发到 settings 路径
- 新增 `tests/i18n.test.mjs`：node:test 单测覆盖 t() / fallback / setLocale / 持久化往返

## Capabilities

### New Capabilities

- `app-i18n`: 提供 application-level 双语基础设施（locale 表加载与合并、t() 翻译函数 + 占位符、setLocale 切语言、`<html lang>` 同步、locale 持久化、设置 UI 入口）。覆盖 Range = "Renderer 进程的 window.mwiI18n" + "主进程 IPC handler i18n.*" + "electron-store settings.locale"。

### Modified Capabilities

（无 — 现有 `account-form` 与其他未落 spec 的能力，REQUIREMENT 都没变；本次只新增 `app-i18n` 这一个能力）

## Impact

- **代码层**：新增 6 个文件（`src/locales/zh-CN.json`、`src/locales/en-US.json`、`src/js/i18n.js`、`src/js/settings-tab.js`、`src/css/settings-tab.css`、`tests/i18n.test.mjs`）；修改 4 个文件（`src/index.html`、`preload.js`、`main.js`、`src/js/tabbar.js`）。
- **依赖层**：无新增 npm 包（vanilla t() 用 Map / 对象查询，匹配项目栈"不引前端框架"约束）
- **数据层**：electron-store `settings` 实例新增字段 `locale: 'zh-CN' | 'en-US'`，缺省 `'zh-CN'`；首次启动 `settings` 没这个字段时 i18n.setLocale(electronStore.get('settings.locale', 'zh-CN')) 兜底
- **IPC 层**：preload `window.api.i18n.{get, set, list}` 三个新方法；主进程 `ipcMain.handle('i18n.*')` 对应三个；既有 IPC surface 不动
- **运行时**：应用启动多一次 i18n 初始化（locales 加载 + current locale 读取 + `document.documentElement.lang` 同步 + 触发 onChange 监听），量级 < 5ms
- **测试**：node:test 单测 5 类（命中、未命中、fallback、setLocale 改 lang、持久化往返）必须全过；GUI 真测（`npm start` + 点 settings 切语言）由用户截图确认 HTML lang 与 UI 文本变化

## Scope Boundary（已扩 / 仍不做）

> **scope 扩 notes（2026-08-19 用户实测反馈后追加）**：本 change 已扩 scope 包括字符串抽取——把 sidebar / tabbar / panel / statusbar / settings / account-form / subscription-tab 七个 renderer 模块里的 hardcode 中文全量抽出到 `src/locales/{zh-CN,en-US}.json` 并 t()-ify。每个模块注册 `mwiI18n.onChange` 触发 locale 切换后自动 re-render；HTML 静态节点（toolbar / canvas placeholder 等）由 `i18n.applyI18nToStatic` 扫 `[data-i18n-*]` 批量同步。

**仍不做：**
- 不引第三方 i18n 库（vanilla t() 函数匹配项目栈）
- 不加 zh-CN / en-US 之外的 locale（用户明确说"中英文"）
- 不动 OpenSpec 工具/CLI 本身（只动本项目 `openspec/` 内容）
- 不改既有 IPC surface（本次只新增 `i18n.*`）
- 不引入浅色模式（项目本就是深色主题）
- **不迁移 lib/accounts.js schema 里写死的默认组名**（`默认分组` / `农场号`）—— 改数据层超出本 change 范围；改为在渲染时按 name 映射翻译（`sidebar.group.default_name` / `sidebar.group.farm_name`），已持久化的旧数据无需用户手动迁移。
