# fingerprint-snapshot Specification

## Purpose
指纹伪装从「按字段分散 spoof」重构为「snapshot 单一事实源」：每个 preset 指向完整、自洽、一致的目标浏览器画像，所有可读字段从同一 snapshot 派生，加载时强制一致性自检。

## Requirements

### Requirement: snapshot 单一事实源
The system MUST 让每个 preset 指向一个完整浏览器画像 snapshot 家族，profile 的所有可读字段从同一成员派生（自定义 UA 场景为「成员 + UA 派生」），禁止按字段独立随机。

#### Scenario: 账号构建画像
- WHEN buildFingerprint(account) 被调用
- THEN 返回的 profile 所有字段来自同一 snapshot 成员（或该成员与自定义 UA 的派生组合）
- AND 同一 account.id 两次构建结果完全相等

#### Scenario: 同 preset 不同账号
- WHEN 两个账号使用同一 preset 且 seed 选中不同成员
- THEN 两者画像来自家族内不同的完整成员
- AND 任一账号画像内部保持自洽（不存在跨成员字段混搭）

### Requirement: 一致性自检 fail loud
The system MUST 在模块加载时对每个 snapshot 成员执行 validateSnapshot，任一成员未通过即抛错拒绝加载，错误信息包含成员 id 与原因。

#### Scenario: snapshot 含应用身份字样
- WHEN 某 snapshot 任意字段包含 mwi-electron-desktop（大小写不敏感）
- THEN 模块加载抛出错误并拒绝启动

#### Scenario: 版本不对齐
- WHEN snapshot 的 UA 主版本与 brands / uaFullVersion / browser.fullVersion 任一不一致
- THEN 模块加载抛出错误

#### Scenario: 非折叠屏画像含折叠屏 API
- WHEN snapshot 中出现 devicePostureType
- THEN 模块加载抛出错误

### Requirement: 老 Navigator 字段全覆盖
The system MUST 注入 appName=Netscape、appVersion=UA、vendor=Google Inc.、product=Gecko，并覆盖 maxTouchPoints。

#### Scenario: 注入后读取老字段
- WHEN 注入脚本在页面执行后读取 navigator.appName / appVersion / vendor / product
- THEN 与 snapshot 一致
- AND 不含任何应用身份字样

### Requirement: plugins 与 mimeTypes 快照驱动
The system MUST 用 snapshot 的 plugins / mimeTypes 列表替换原生值，禁止使用无名称假对象。

#### Scenario: 读取 plugins
- WHEN 页面读取 navigator.plugins 与 navigator.mimeTypes
- THEN 返回列表与 snapshot 完全一致（名称 / 文件名 / mimeTypes）
- AND 不含 Microsoft Edge PDF Viewer / WebKit built-in PDF 等非目标浏览器插件

### Requirement: 与目标设备画像不符的字段不注入
The system MUST 对目标浏览器没有的原生 API 主动遮蔽为 undefined：deviceMemory（桌面快照为 null → getter 返回 undefined，因 Electron 原生会暴露真实值 32）、devicePosture（Chrome 126 无此 API，Electron 原生暴露 type=continuous）。getBattery 按 snapshot.battery 注入桌面无电池签名。connection 不含 type 键。

#### Scenario: 桌面画像缺席字段
- WHEN profile 为桌面 snapshot（deviceMemory=null）
- THEN 注入后 navigator.deviceMemory === undefined（遮蔽 Electron 原生的真实值）
- AND navigator.devicePosture === undefined
- AND navigator.getBattery() 返回 snapshot.battery（charging/chargingTime/dischargingTime/level）
- AND navigator.connection 不含 type 键

### Requirement: SpeechVoices 快照驱动
The system MUST 覆盖 speechSynthesis.getVoices，使其返回 snapshot 声库列表。

#### Scenario: 读取声库
- WHEN 页面调用 speechSynthesis.getVoices()
- THEN 返回列表与 snapshot.speechVoices 一致（name / lang / localService）

### Requirement: 注入边界与幂等
The system MUST 通过游戏 WebContentsView 的专用 preload（fp-preload.js，profile 经 additionalArguments 传入）在文档创建时、页面脚本执行之前用 webFrame.executeJavaScript 把完整 spoof bundle 注入主世界；注入脚本幂等（重复执行无副作用）。

#### Scenario: 页面脚本执行前生效
- WHEN 页面加载且其内联脚本在加载第一时间读取指纹字段
- THEN 读到的全部是 snapshot 值而非 Electron 原生值

#### Scenario: 重复注入
- WHEN 同一页面注入脚本执行多次（如 reload）
- THEN 仅首次生效（window.__MWI_FP__.v 守卫），字段值不叠加、不漂移
