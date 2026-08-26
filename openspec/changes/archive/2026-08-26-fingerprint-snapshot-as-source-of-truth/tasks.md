# Tasks: fingerprint-snapshot-as-source-of-truth

## Status legend
- [ ] = pending
- [x] = completed

## Phase 1 — snapshot 重定义 + 一致性自检（本 change 的落地起点）

- [x] 新建 `lib/fingerprint-snapshots.js`：SNAPSHOT_FAMILIES（preset_01 win32×2 / preset_02 mac×2 / preset_03 win32×1，全字段画像）+ FAMILY_META + validateSnapshot
- [x] `lib/fingerprint.js` 重构：
  - preset → snapshot 家族指针；加载时全量 validateSnapshot，任一成员失败即抛错拒绝（fail loud）
  - buildFingerprint 由 seed 选成员 + 深拷贝 + canvasSeed 派生；自定义 UA 走派生模式（brands/uaFullVersion/appVersion 全量随 UA 派生）
  - 注入脚本补：appName / appVersion / vendor / product / maxTouchPoints；plugins / mimeTypes 快照驱动（含 item/namedItem）；connection 不含 type；speechSynthesis.getVoices 快照驱动
  - 删除：navigator.storage 固定配额假对象、navigator.plugins {length:5} 假对象
  - deviceMemory 为 null 时不注入（桌面画像保持原生缺席）
- [x] 更新 `lib/__tests__/fingerprint.test.js`：新增 snapshot 校验用例（VS1-VS7）+ vm 断言更新（appName/plugins/voices/storage 不覆盖/connection 无 type）+ 熵断言改为家族成员数语义
- [ ] 真实采集：scripts/collect-snapshot.js 用真实 Chrome 导出全字段 snapshot 替换手写初值，家族成员扩至 4+ 恢复熵（手写初值仅开发闭环用）

## Phase 2 — image-boundary 注入收紧

- [x] 注入通道落地为 `fp-preload.js`（webPreferences.preload + additionalArguments 传 profile + webFrame.executeJavaScript 主世界注入，页面脚本执行前生效）；同时废弃两条实测无效通道：did-start-navigation executeJavaScript（旧文档 realm）与 CDP addScriptToEvaluateOnNewDocument（Electron 43 跨导航不生效）
- [x] 新增 `tests/fp-e2e-min.js` 回归（用生产 fp-preload.js，页面加载第一时间捕获字段全部等于快照，2026-08-21 ALL PASS）
- [x] 主动遮蔽 Electron 原生泄漏：deviceMemory（实测 32）→ undefined、devicePosture（type=continuous）→ undefined、getBattery → snapshot.battery 桌面无电池签名；plugins 原生 5 项（含 Edge PDF Viewer / WebKit built-in PDF）整体替换为快照 3 项
- [ ] 打包态回归：dist 后跑 tests/fp-e2e-min.js 等价验证（asar 内 require 链 + additionalArguments 传参）

## Phase 3 — snapshot 文件 lint 硬约束

- [ ] CI grep：snapshot 文件禁止出现 mwi-electron-desktop；fingerprint 模块禁止出现未走 snapshot 的孤立字段赋值

## Phase 4 — e2e 反指纹 headless 自检

- [ ] CI 跑 pixelscan / browserleaks / CreepJS，断言全部通过（含老字段、plugins、absent 字段三类）

## Phase 5 — openspec 收尾

- [ ] 变更落地后 archive 本 change，specs/fingerprint-snapshot/spec.md 合入 openspec/specs/
