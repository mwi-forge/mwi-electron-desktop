## 1. Bootstrap (locales + i18n.js scaffolding)

- [ ] 1.1 Create `src/locales/zh-CN.json` (initial empty object `{}`, comment-only placeholder for future strings)
- [ ] 1.2 Create `src/locales/en-US.json` (initial empty object `{}`)
- [ ] 1.3 Create `src/js/i18n.js` exposing `window.mwiI18n.{t, setLocale, getLocale, onChange}`:
  - `t(key, vars)` looks up key with fallback chain `current locale -> zh-CN -> key literal`
  - `t(key, vars)` resolves `{name}` placeholders from `vars` map
  - `setLocale(code)` validates `code in ['zh-CN', 'en-US']`, falls back to `zh-CN` on miss, updates in-memory current, sets `document.documentElement.lang`, fires onChange subscribers
  - `getLocale()` returns current locale string
  - `onChange(fn)` registers a subscriber; returns unsubscribe function
  - defensive guard: `if (!window.mwiI18n) return key;` at top of `t` for race safety (per design Risks R2)
  - reads locale tables from `window.__mwiLocales` injected by preload (defensive: empty object on missing)

## 2. Preload + Main IPC

- [ ] 2.1 Modify `preload.js`: at top, `const fs = require('fs'); const path = require('path');`, synchronously read `src/locales/zh-CN.json` and `en-US.json` from `__dirname` or app-bundled path, try-parse with empty-object fallback, expose as `window.__mwiLocales = { 'zh-CN': {...}, 'en-US': {...} }` (per design Decision 1, Risks R1)
- [ ] 2.2 Modify `preload.js`: in `contextBridge.exposeInMainWorld('api', {...})`, add `i18n: { get: () => ipcRenderer.invoke('i18n.get'), set: (code) => ipcRenderer.invoke('i18n.set', code), list: () => ipcRenderer.invoke('i18n.list') }`
- [ ] 2.3 Modify `main.js`: register three `ipcMain.handle` methods:
  - `i18n.get` — read `settings.get('locale')`, return `'zh-CN'` on undefined / read error
  - `i18n.set(event, code)` — validate code in `[zh-CN, en-US]`, on invalid throw Error(`Unsupported locale: ${code}`); on valid: `settings.set('locale', code)` swallow write error, then `mainWindow.webContents.send` (or `event.sender.send` after handle resolves) trigger — actually design chose renderer-side setLocale post-handle, so handle just persists and renderer pulls it; main returns void;** reconcile decision 6.3 below**
  - `i18n.list` — return `['zh-CN', 'en-US']` literal
- [ ] 2.4 Modify `main.js`: ensure electron-store `settings` instance is already accessible from module scope (existing code path; confirm during apply)

## 3. Index.html wiring

- [ ] 3.1 Modify `src/index.html`: in `<script>` tag list, add `<script src="js/i18n.js"></script>` placed **before** `tabbar.js` (and before any script that calls `t()` — verify by `grep -l window.mwiI18n src/js/*.js`)
- [ ] 3.2 Modify `src/index.html`: replace static `<html lang="zh-CN">` with `<html>` (no `lang`); add a small inline `<script>` at top of `<body>` (or DOMContentLoaded handler in i18n.js) that reads persisted locale and calls `window.mwiI18n.setLocale(...)` to set `document.documentElement.lang` before any UI renders

## 4. Settings tab UI

- [ ] 4.1 Create `src/js/settings-tab.js` exposing `window.mwiSettings = { open() }` — replicates the static-tab opening pattern documented by the archived `account-form-as-static-tab` change (build mount node in `.canvas__form-mount`, set fields, persist via `window.api.i18n.set`); uses an inline HTML form with a select for locale (zh-CN / en-US) and a save button
- [ ] 4.2 Create `src/css/settings-tab.css` — clone the form-card / fieldset / select / button styles from `src/css/account-form.css` (do NOT duplicate logic; copy CSS that fits); target class `.account-form-card__form` extended selector pattern per user-memory `2026-08-19 form 表单样式` 经验
- [ ] 4.3 Modify `src/js/tabbar.js`: register settings static tab (use `[data-tab-type="static"][data-form-id="settings"]` to avoid the `2026-08-19 Tab 切换错乱类 BUG` — explicit per-type/id dispatch in click handler)
- [ ] 4.4 Modify `src/index.html`: add `<link rel="stylesheet" href="css/settings-tab.css">` and `<script src="js/settings-tab.js">` in correct load order (settings-tab.js before app.js)

## 5. Tests

- [ ] 5.1 Create `tests/i18n.test.mjs` covering all spec scenarios (parse the spec.md requirement + scenario headings to ensure coverage):
  - node:test, not Jest
  - mock `window` and `document.documentElement` in the test harness (per existing project test convention seen in `lib/__tests__/` or scripts)
  - cases: hit / miss / cross-locale fallback / both miss returns literal / variable interpolation / setLocale updates `document.documentElement.lang` / unsupported code falls back / persistence round-trip via fake electron-store
- [ ] 5.2 Run `node --test tests/i18n.test.mjs` and confirm `0 fail`; record the output summary in commit message

## 6. GUI verification (cannot be skipped)

- [ ] 6.1 `bash cat` verify all written files exist on real disk (per memory `2026-08-19 sandbox writes unreliable`)
- [ ] 6.2 `npm start` and visually confirm settings tab visible in tabbar
- [ ] 6.3 Click settings tab → switch `en-US` → confirm `document.documentElement.lang === 'en-US'` via DevTools
- [ ] 6.4 Restart app → confirm initial locale is `en-US` (persisted)
- [ ] 6.5 Delete `~/Library/Application Support/mwi-electron-desktop/settings.json` (or equivalent path) → restart → confirm fallback to `zh-CN`
- [ ] 6.6 Run any existing test suites once to check no regression (e.g. `node --test tests/**/*.test.mjs`)
- [ ] 6.7 Take a screenshot of the settings tab and confirm with the user before `openspec-archive`

## 7. Strings 抽取（schema 扩展后追加，2026-08-19 用户明确要"切换能看见"）

- [ ] 7.1 写 `src/locales/zh-CN.json` 全量 keys + 对应 zh 文案
- [ ] 7.2 写 `src/locales/en-US.json` 全量 keys + 对应 en 翻译
- [ ] 7.3 i18n.js 加 `applyI18nToStatic()`：扫 `[data-i18n-text/title/html]` 节点 + DOMContentLoaded 时跑一次 + onChange 时再跑
- [ ] 7.4 src/index.html 给 toolbar 按钮 / sidebar empty / tabbar empty / canvas placeholder / panel 标题 加 `data-i18n-*` 属性
- [ ] 7.5 src/js/sidebar.js：所有硬编码中文串 → `window.mwiI18n.t('sidebar.xxx')`
- [ ] 7.6 src/js/tabbar.js：表头 '表单' / '订阅管理' / '设置' / '添加账号' / '编辑: X' / '未命名' / '中部 tab 区...' → t()
- [ ] 7.7 src/js/panel.js：'未选中账号' / '账号不存在' / '运行中' / '已停止' / 'URL/分组/指纹预设' / '停止/启动/刷新/编辑/复制配置/删除' / '暂无日志' / alert 消息 → t()
- [ ] 7.8 src/js/statusbar.js：'views' / '内存' / 'CPU' / '运行时长' → t()
- [ ] 7.9 src/js/settings-tab.js：title / legend / label / hint / save / close / LOCALE_LABELS → t()
- [ ] 7.10 app.js 注册 i18n.onChange → 触发 sidebar.refresh + tabbar.render + panel.render + applyI18nToStatic + 重渲 settings tab（如果在开）

## 8. Archive

- [ ] 7.1 Run `openspec validate i18n-zh-en --strict` — must report 0 errors
- [ ] 7.2 Run `openspec archive i18n-zh-en --yes` only after 6.7 user screenshot approval (per skill `openspec-archive` workflow rules and memory `archive != behavior correct`)
- [ ] 7.3 Verify archive: `openspec list --json` shows `i18n-zh-en` under `archive`, `openspec/specs/app-i18n/spec.md` (main spec) now exists with Purpose + Requirements copied from delta

## Decision to reconcile in 2.3

During design Decision 6 we said `set` performs persistence in main and lets renderer observe via onChange. There are two implementation options for the trigger:

  - (A) Renderer-side: in the IPC handler return-after-persist, renderer awaits the result and then calls `window.mwiI18n.setLocale(code)` itself; this aligns with "single writer" for persistence and is the implementation currently implied by tasks 2.3.
  - (B) Main-side: main calls `mainWindow.webContents.send('i18n:change', code)` after persist, renderer subscribes once at startup; cleaner event-driven.

Choose (A) for first cut — no extra IPC channel needed, M3 tests can drive it directly, and the design's `onChange` (subscribed by future extracted-string modules) is already the broadcast point (renderer calls it inside its own setLocale). Re-evaluate if M3 reveals a race where renderers on different WebContentsViews see stale state.
