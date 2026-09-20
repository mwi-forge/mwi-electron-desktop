# Design: fingerprint-snapshot-as-source-of-truth

## 核心原则

「伪装浏览器不是混乱数据」：所有可读字段必须从同一份完整、真实、自洽的「目标浏览器画像 snapshot」派生。任何字段偏离 snapshot、暴露应用身份、与其他字段矛盾、混入与目标设备画像不符的字段，都视为 spoof 失败。

## Snapshot schema

每个 snapshot 成员是一份真实桌面 Chrome 的全字段画像（见 `lib/fingerprint-snapshots.js`）：

```
{
  id, label, platform: 'win32'|'mac'|'linux',
  browser: { name: 'Chrome', major, fullVersion },
  ua: string,                                  // 完整 UA（无任何应用身份后缀）
  acceptLanguages,                             // = languages.join(',')
  languages: string[], navigator.language,     // 语言链
  navigator: {
    appName: 'Netscape', appVersion: <==ua>,   // 老字段，由 UA 派生
    vendor: 'Google Inc.', product: 'Gecko',
    platform: 'Win32'|'MacIntel'|'Linux x86_64',
    plugins: Plugin[], mimeTypes: MimeType[],  // 目标浏览器实际暴露列表
    connection: { downlink, effectiveType, rtt }, // 无 type（Chromium 已移除）
  },
  hardwareConcurrency: number,
  deviceMemory: null,                          // 桌面 Chrome 不暴露 → 不注入
  maxTouchPoints: 0, webdriver: false,
  userAgentData: { brands, mobile: false, platform },
  highEntropy: { architecture, bitness, model, platformVersion, uaFullVersion, fullVersionList },
  screen: { width, height, colorDepth, pixelDepth, availWidth, availHeight, devicePixelRatio },
  timezone, webgl: { vendor, renderer }, audio: { sampleRate, baseLatency, outputLatency },
  speechVoices: Voice[], permState: {...},
  // devicePostureType 缺席（非折叠屏画像禁止出现）；getBattery 缺席（Chrome 已移除）
}
```

## 家族与 per-account 选择

- 每个 preset = 平台模板 + snapshot 家族（1..N 个完整成员）。初版：preset_01 win32×2（Chrome 126 / 130）、preset_02 mac×2（Chrome 128 / 130）、preset_03 win32×1（Chrome 120，固定）
- 账号 seed（sha256(account.id) 前 8 hex → mulberry32）在家族内稳定选成员：同一账号永远同一成员，不同账号可能不同
- 自定义 UA（account.userAgent）走**派生模式**：brands / uaFullVersion / fullVersionList / appVersion / browser 全量由该 UA 的 Chrome 主版本派生，其余字段取自 seed 成员；派生结果仍须通过一致性自检，禁止「UA 一套 + 其余字段另一套」

## 一致性自检规则（validateSnapshot）

加载时对全部成员执行，任一失败抛错拒绝加载（fail loud，附成员 id 与原因）：

| 规则 | 校验 |
|---|---|
| 身份字样 | JSON 全文不得出现 mwi-electron-desktop（大小写不敏感） |
| 版本对齐 | browser.major == UA Chrome 主版本 == brands 主版本；fullVersion / uaFullVersion / fullVersionList 均以该主版本开头 |
| 老字段 | appName === Netscape；appVersion === ua；vendor === Google Inc.；product === Gecko |
| OS 对齐 | UA OS 段 ↔ navigator.platform ↔ userAgentData.platform ↔ highEntropy.model（win/linux 空、mac 非空）↔ bitness 64 |
| 语言链 | acceptLanguages === languages.join(',')；navigator.language === languages[0] |
| plugins | 非空；每个有 name/filename/≥1 mimeType；plugins 全量 mimeTypes 与 navigator.mimeTypes 集合严格相等 |
| 缺席字段 | connection 无 type；JSON 全文无 devicePostureType |
| 其余 | speechVoices 非空且每项有 name/lang；screen/webgl/audio/permState 齐全；webdriver===false；userAgentData.mobile===false |

## 字段缺席策略（与目标浏览器一致的「不注入」）

反指纹站同样会检测「目标浏览器不该有的字段被注入了值」。因此 snapshot 必须显式记录缺席：

| 字段 | 目标桌面 Chrome 行为 | snapshot 策略 |
|---|---|---|
| deviceMemory | 桌面不暴露（undefined）；**Electron 原生却暴露真实值（实测 32）** | null → 注入 getter 返回 undefined **主动遮蔽** |
| devicePosture | Chrome 126 无此 API；**Electron 150 原生暴露 type=continuous** | 注入 getter 返回 undefined **主动遮蔽**（snapshot 内不得出现） |
| getBattery | Chrome 126 存在，桌面返回无电池签名（charging=true / level=1 / dischargingTime=Infinity） | snapshot.battery 驱动注入（Infinity 用 "Infinity" 哨兵规避 JSON 序列化） |
| connection.type | Chromium 已移除（undefined） | connection 对象不含 type |
| navigator.storage | 机器相关真实值，无法用画像表达 | 删除旧的固定配额假对象，不注入 |
| plugins/mimeTypes | 3 个 PDF 插件 + application/pdf、text/pdf | 由 snapshot 提供真实列表（含 text/pdf，真实 Chrome 存在该类型）；Electron 原生 5 项（含 Edge PDF Viewer / WebKit built-in PDF）被整体替换 |

## 注入边界与时序

**有效通道（2026-08-21 落地）：preload + webFrame.executeJavaScript**。views.js 在创建 WebContentsView 时把每账号 profile 经 `webPreferences.additionalArguments`（`--mwi-fp-profile=<base64 json>`）传给游戏 view 的专用 preload（`fp-preload.js`）；preload 在文档创建时、页面脚本执行之前运行，用 `webFrame.executeJavaScript` 把完整 spoof bundle 注入**主世界**。保持 contextIsolation=true（页面脚本无法触碰 preload 的 Node 能力）。

**已实测废弃的两条通道（browserleaks 2026-08-21 实测原生值暴露后排查）**：
- `did-start-navigation` + `executeJavaScript`：落在旧文档 realm（首次导航为 about:blank），新页面主世界读不到任何补丁——此前指纹注入在线上完全无效（仅 session 级 setUserAgent / Sec-CH-UA 生效）。
- CDP `Page.addScriptToEvaluateOnNewDocument`（webContents.debugger）：Electron 43 实测命令成功返回但跨导航不生效（连 1 字节标记脚本都不执行；且首次 attach 后立即发命令会永久挂起）。

回归证明：`tests/fp-e2e-min.js`（独立 electron 脚本，用生产 `fp-preload.js` 注入后页面内联脚本「加载第一时间」捕获字段，全部等于快照值）。

## 兼容性

- `PRESETS`（label/platform/fixed/navigator/screen/timezone）由家族首个成员派生，main.js 自检与旧 `generateInjectScript` 不破
- `randomUA()` 从 snapshot 家族派生（仍返回 Chromium 系 UA）
- profile 输出保持 flat 字段（ua/acceptLanguages/languages/hardwareConcurrency/deviceMemory/screen/timezone/webgl/canvasSeed/audio/permState），views.js 与 sec-headers.js 零改动

## Phase 映射

Phase 1 snapshot 重定义+自检 → Phase 2 image-boundary 注入 → Phase 3 CI lint 硬约束 → Phase 4 e2e 反指纹自检 → Phase 5 落地归档（详见 tasks.md）。
