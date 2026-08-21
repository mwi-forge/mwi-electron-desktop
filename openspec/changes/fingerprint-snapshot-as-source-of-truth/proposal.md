# Proposal: fingerprint-snapshot-as-source-of-truth

## Why

用户 2026-08-21 两次追问（「为什么 appName/appVersion/userAgent 还显示 mwi-electron-desktop」→「伪装浏览器不是混乱数据吧」）定性：当前 `lib/fingerprint.js` 是「按字段分散 spoof」，各字段池（UA / 硬件 / 屏幕 / WebGL / 音频 / 权限）各自独立随机，没有单一事实源。反指纹站（pixelscan / browserleaks / CreepJS）用 cross-check 即可一票否决：

- 老 Navigator 字段完全未覆盖：appName / appVersion / vendor / product 全仓库 0 处 spoof（2026-08-21 grep 实锤）
- navigator.plugins 是 `{length:5}` 假对象（无名称列表），mimeTypes 未覆盖
- navigator.connection 注入对象缺 `type`，SpeechVoices 无覆盖
- 注入与真实桌面 Chrome 不一致的字段（桌面 UA 却带 deviceMemory 数字、固定存储配额假对象）反而成为破绽

核心问题是缺一个统一的「目标浏览器画像 snapshot」把所有字段绑在一起。

## Capabilities

### New Capabilities

- `fingerprint-snapshot`: 完整浏览器画像 snapshot 家族（单一事实源）+ 加载时一致性自检（validateSnapshot）

### Modified Capabilities

- `fingerprint`（现有 lib/fingerprint.js）：preset 从「字段池」重定义为「snapshot 家族指针」；注入脚本所有可读字段由 snapshot 派生

## Impact

- **代码层**：新增 `lib/fingerprint-snapshots.js`（数据 + 校验器）；重构 `lib/fingerprint.js`；更新 `lib/__tests__/fingerprint.test.js`
- **运行时**：每 preset 画像熵从「多池笛卡尔积」降为「家族成员数」（初版 2/2/1 个成员，真实采集后恢复）；每账号构建多一次 JSON 深度拷贝（微秒级）
- **数据层**：snapshot 数据文件禁止出现 `mwi-electron-desktop` 字样（CI grep 硬约束，Phase 3）
- **协议层**：PRESETS / listPresets / getPreset / randomUA / generateInjectScript / buildFingerprint / generateFullInjectScript 导出 shape 全部保持兼容，ipc.js / preload.js / views.js / sec-headers.js 零改动

## What Changes

1. **preset 重定义**：preset_01/02/03 不再指向 UA 池，改为指向完整浏览器画像 snapshot 家族（平台模板 + 全字段集合）
2. **snapshot 一致性自检**：validateSnapshot 在模块加载时校验所有成员（UA 主版本 == brands；platform 与 UA OS 段对齐；plugins 严格匹配；折叠屏 API 必须缺席；无应用身份字样），任一成员不过直接抛错拒绝加载
3. **image-boundary 注入**：webContentsView 在 attach session partition 之后、loadURL 之前注入完整 spoof bundle（现有 did-start-navigation 时序保留，Phase 2 收紧）
4. **lint 硬约束 + e2e 反指纹 headless 自检**（Phase 3/4）

## Alternatives Considered

### A. 继续按字段补丁（现状）
- 拒绝：用户明确定性为「非常严重的代码设计实现问题」，cross-check 持续漏

### B. 只补 appName / appVersion 两个字段
- 拒绝：仍是散点补字段，brands / plugins / voices 等交叉验证继续穿帮

### C. snapshot 单一事实源（最终选定）
- 完整、自洽、可校验；每个 preset 一份真实浏览器画像，逐字段派生
- 代价：熵由家族成员数决定，需要真实采集扩大家族

## Non-goals

- 不做行为层随机化 / 不集成代理池（既有边界不变）
- 不做 Safari / Firefox 画像（一期仍 Chromium 系）
- 不追求每账号画像熵最大化——熵由 snapshot 家族成员数决定，随真实采集逐步扩大
- 不修改现有 IPC / preload 协议

## Risk

- **家族成员少**：同 preset 账号间画像碰撞概率升高（canvasSeed 仍保证逐账号噪声唯一）；缓解：scripts/collect-snapshot.js 真实采集扩大家族至 4+
- **手写初值可能与真实 Chrome 细节不符**（如 plugins 列表随版本变化）：缓解：Phase 4 e2e（pixelscan / browserleaks / CreepJS）把关 + 真实采集替换
- **加载时抛错 = fail loud**：snapshot 被改坏会阻断启动；缓解：这是特性，CI lint（Phase 3）前置拦截

## Status

APPLY IN PROGRESS —— Phase 1（snapshot 重定义 + 一致性自检 + 注入脚本全字段覆盖）2026-08-21 已落地；Phase 2-6 待推进。本 change 优先级高于 clash-verge-integration / i18n-zh-en / ui-modal-component：指纹一致性是其他 change 上线前的反指纹前置校验项。
