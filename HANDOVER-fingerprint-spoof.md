# 交接文档：fingerprint spoof → snapshot-based 架构级重构

> 源会话：`session-6ebb8183-db44-45cb-b72a-5efb478e4aec`（「数据合理性检查」）
> 接手会话：`session-d9a13a4d-c5ee-4412-8b5b-6d27d18f7892`（DeepSeek Pro）
> 重建说明：原会话声称已把完整 markdown 写入此文件，但接手核对时该文件在项目工作目录不存在（glob 0 命中）。本文件由接手会话于 2026-08-21 依据聊天速览版重建，并追加「接手核对结论」一节，以重建版为准。

## 一句话核心问题

mwi-electron-desktop 当前 fingerprint spoof 是「**按字段分散 spoof**」式实现，缺一个统一的「**目标浏览器画像 snapshot**」把所有字段绑在一起。这导致反指纹站（pixelscan / browserleaks / CreepJS）能在 cross-check + 应用身份泄露 + 字段画像不一致三个维度上一票否决。

## 用户两次追问还原

1. 「为什么 appName/appVersion/userAgent 还显示 mwi-electron-desktop？」——挑明老 Navigator 字段未 spoof。
2. 「这是个非常严重的代码设计实现问题，你之前都没考虑到的吗？伪装浏览器不是混乱数据吧？」——升格到「按完整画像整体 spoof」的设计哲学。

## 截图里发现的全部异常（按根因分四类）

| 类别 | 现象 |
|---|---|
| 1. 漏改的老字段 | UA 末尾残留 `mwi-electron-desktop/0.1.0`；`appName` = 应用名（应是 Netscape）；`appVersion` = "1.0.0"（应由 UA 派生） |
| 2. 改了但版本不对齐 | UA = Chrome 130，brands = Chrome 126 + Chromium 150，uaFullVersion = 126——三处任意一对都矛盾 |
| 3. 注入了非本应用字段 | Plugins 列表混入 `Microsoft Edge PDF Viewer` / `WebKit built-in PDF`（renderer 根本不会暴露）；`devicePostureType = continuous`（折叠屏 API，不应出现在桌面机）；MimeTypes 含 `text/pdf`（非标准） |
| 4. 字段间互不知情 | Network.type=undefined，effectiveType=3g；SpeechVoices 只有 3 个中文 voice |

**额外跳过（不是 spoof 模块 bug）**：Web Bluetooth 区块下混进了 AudioContext 字段（sampleRate=48000 / FFT Size=2048）——这是**检测脚本归类错误**，与真实环境无关。

## 设计原则

> **「伪装浏览器不是混乱数据」**——spoof 的目标是模拟一个**完整、真实、自洽的浏览器实例**。所有可读字段必须从**同一份真实目标浏览器快照**派生。任何字段偏离 snapshot、暴露应用身份、与其他字段矛盾、混入与目标设备画像不符的字段，都视为 spoof 失败。

## 整改方案（架构级重构 · 6 步）

1. **preset 重定义**：`preset_01/02/03` 不再指向 UA 池，改为指向**完整浏览器画像 snapshot**（手工采集的真实 Chrome N + Win32/macOS/Linux + locale 全字段集合）。
2. **snapshot 一致性自检**：loader 加载时校验字段间一致性（UA 主版本 == brands；Navigator.platform 与 UA 内 OS 段对齐；plugins 严格匹配目标浏览器实际暴露列表；折叠屏 API 在非折叠屏画像里必须 undefined；无 `mwi-electron-desktop` 字样），不通过直接拒绝该 preset。
3. **image-boundary 注入**：每个 webContentsView 在 attach session partition 之后、loadURL 之前注入完整 spoof bundle。老 Navigator 字段（V8 native accessor）必须在 main process 走 `webContents.setUserAgent()` + Electron init 阶段 patch。
4. **snapshot 文件 lint 硬约束**：CI grep 禁止 snapshot 出现 `mwi-electron-desktop` 字样、禁止 fingerprint 模块出现未走 snapshot 的孤立字段赋值。
5. **e2e 反指纹 headless 自检**：CI 跑 pixelscan / browserleaks / CreepJS，断言全部通过。
6. **openspec 立项**：建议作为 `fingerprint-snapshot-as-source-of-truth` change 立项，**优先级高于现有 clash-verge-integration / i18n-zh-en / account-form-as-static-tab 三个 change**——指纹是其他 change 的依赖项。

## 接手后代码定位路径（已核对）

- 指纹模块是**单文件 `lib/fingerprint.js`（489 行）**，无 `lib/fingerprint/` 目录；测试在 `lib/__tests__/fingerprint.test.js`
- `lib/views.js` startView：`buildFingerprint(account)` → `sess.setUserAgent(ua, acceptLanguages)` → `did-start-navigation(isMainFrame)` 时 `executeJavaScript(generateFullInjectScript(profile))`
- `lib/sec-headers.js`：Sec-CH-UA / Sec-Fetch-* 由 profile 派生（与 UA 绑定，改 snapshot 时需同步）
- `main.js` 自检 `MWI_SELFTEST_FP` / `MWI_SELFTEST_FP2`：**纯 console 输出，仓库不存在自检 HTML 页**
- `docs/superpowers/specs/2026-08-19-anti-detection-fingerprint-hardening.md`：Phase 5.5 历史 spec（现实现即其产物）

## 接手核对结论（2026-08-21 · DeepSeek Pro）

1. 交接文件原会话**未实际落盘**，本文件为重建版。
2. **Electron 43.4.0 已实装**（package.json `^43.4.0` 与 node_modules/electron 版本一致）→ 截图的 Electron 34.4.0 是旧构建/旧测试环境产物，不是当前运行时。
3. **仓库无自检 HTML 页**（grep `Bluetooth` 0 命中，main.js 自检均为 console）→「Web Bluetooth 区块混入 AudioContext」是外部检测页的归类问题，与本仓库代码无关。
4. `appName/appVersion/vendor/product` 全仓库 **0 处 spoof**（grep 实锤）——四类异常第 1 类的缺口当前仍然存在。
5. `navigator.plugins` 注入为 `{length:5}` 假对象（无名称列表）；`navigator.connection` 注入缺 `type` 字段（当前代码 effectiveType=4g，截图 3g 属旧构建）；SpeechVoices 无任何覆盖——第 4 类缺口实锤。
6. 当前 `buildFingerprint` 中 brands/uaFullVersion 已由 UA 主版本（chromeMajor）派生，两者对齐；截图的 126/150 错配来自旧构建或未注入页面。
7. key 记忆「伪装浏览器不是混乱数据」**已确认生效**（key 轨第 4 条，注入上下文）——交接文档「待确认队列」状态已过时。
8. openspec 当前活跃 changes：`clash-verge-integration` / `i18n-zh-en` / `ui-modal-component`（`account-form-as-static-tab` 已归档）→ `fingerprint-snapshot-as-source-of-truth` **尚未立项**。
9. 注入时序现状：did-start-navigation 监听器注册于 loadURL 之前、脚本幂等——与「attach 之后 loadURL 之前」原则基本一致，但依赖事件触发；重构时按第 3 步收紧为 image-boundary 注入。

## 遗留 Open Question（当前状态）

1. **Electron 版本不一致** → ✅ 已解：实装 43.4.0，截图为旧构建产物。
2. **Web Bluetooth 区块错配** → ✅ 已解：仓库无自检页，为外部检测页归类问题。
3. **key 待确认** → ✅ 已解：架构原则已确认并注入。
4. **openspec 排序** → ✅ 已解（2026-08-21 用户决策「立项 + 开始重构」，change 已创建并完成 Phase 1）。

## 进展更新（2026-08-21 · 接手会话）

- 用户决策：立项 + 开始重构（推荐项）
- openspec change `fingerprint-snapshot-as-source-of-truth` 已创建（proposal / design / tasks / spec 五件套），优先级置顶已写明
- **Phase 1 已落地**：
  - 新增 `lib/fingerprint-snapshots.js`：5 个完整 Chrome snapshot（preset_01 win32×2 / preset_02 mac×2 / preset_03 win32×1，全字段画像）+ validateSnapshot 一致性自检（模块加载时 fail loud）
  - 重构 `lib/fingerprint.js`：preset → snapshot 家族指针；自定义 UA 走派生模式；注入脚本新增 appName/appVersion/vendor/product/maxTouchPoints、plugins/mimeTypes 快照驱动（含 item/namedItem）、connection 无 type、speechSynthesis.getVoices；删除 storage 假配额与 {length:5} 假 plugins；桌面画像 deviceMemory=null 不注入
  - 测试 67/67 全绿（新增 VS1-VS7 校验用例 + V5a-V7 vm 断言 + ENT 语义改为家族成员数）
- 待办（tasks.md Phase 2-4）：真实 Chrome 采集替换手写初值、image-boundary 注入收紧、CI lint 硬约束、e2e 反指纹自检
