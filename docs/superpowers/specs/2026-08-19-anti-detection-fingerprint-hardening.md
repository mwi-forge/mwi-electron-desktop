# 应对服务器端一人多号检测：指纹加固实施计划（Phase 5.5，2026-08-19）

## 目标
把当前"同机多号 100% 被识别为同一设备"降到"与正常玩家指纹分布一致、单点不实锤"。不做行为层随机化、不做代理池集成。

## 改动文件清单
- lib/fingerprint.js（核心重构：指纹画像 + 幂等注入脚本）
- lib/views.js（注入时机修正 + WebRTC 策略生效 + UA/acceptLanguages 联动）
- main.js（GPU 默认启用 + MWI_HW_ACCEL=0 逃生口 + SELFTEST_FP2）
- src/js/sidebar.js（指纹预设下拉 + UA 输入框）
- README.md 与 docs/项目背景及方案（交接）#20260818.md（反关联章节同步为真实能力）

## lib/fingerprint.js 新 API 契约（subagent A 必须导出）

保留兼容导出：PRESETS / listPresets() / getPreset(id) / randomUA()（ipc.js 与 preload 仍引用）。

新增：
1. `buildFingerprint(account)` -> Profile 纯函数（不依赖 electron，纯 node 可测）。account 至少含 { id, fingerprintPreset, userAgent, webRtcPolicy }。
2. `generateFullInjectScript(profile)` -> 注入脚本字符串，必须幂等（可重复执行无副作用）。

Profile 结构：
{
  platform: 'win32'|'mac'|'linux',
  ua: string,
  acceptLanguages: string,
  userAgentData: { brands: [{brand,version}], mobile: false, platform: 'Windows'|'macOS'|'Linux' },
  highEntropy: { architecture, bitness:'64', model, platformVersion, uaFullVersion },
  languages: string[],
  hardwareConcurrency: number, deviceMemory: number,
  screen: { width, height, colorDepth, pixelDepth, availWidth, availHeight, devicePixelRatio },
  timezone: 'Asia/Shanghai',
  webgl: { vendor: string, renderer: string },
  canvasSeed: number,
}

规则：seed = sha256(account.id) 前 8 hex -> seedInt；同一账号画像稳定，不同账号互不相同。preset 保留 3 个 id 升级为平台模板（preset_01=win 标准、preset_02=mac 高随机、preset_03=win 固定），非法 id 回退 preset_01。UA 池按平台重组为 Chromium 系（Chrome/Edge，win/mac/linux 各 2-3 条，Chrome 版本错开如 120/126/128/130），一期不用 Safari/Firefox。userAgentData.brands 的 Chrome 版本与 ua 版本一致。highEntropy 平台映射：win32 -> architecture 'x86'/platformVersion '15.0.0'/model ''；mac -> 'arm'/'14.5.0'/MacBookPro 型号；linux -> 'x86'/'6.8.0'/''。WebGL 伪 GPU 池按平台（win -> ANGLE (NVIDIA, RTX 3060/4060... D3D11) / (AMD, RX 6700 XT) / (Intel, UHD 630)，vendor 'Google Inc. (NVIDIA|AMD|Intel)'；mac -> ANGLE (Apple, Apple M1/M2 Pro, OpenGL 4.1)，vendor 'Google Inc. (Apple)'；linux -> ANGLE (NVIDIA, RTX 3070, OpenGL 4.5)）。

## generateFullInjectScript(profile) 注入项
1. navigator.userAgentData：defineProperty(Navigator.prototype,'userAgentData',{configurable:true,get:()=>fake})；fake 含 brands/mobile/platform + getHighEntropyValues 异步返回 highEntropy 伪值。
2. navigator.languages / navigator.language：原型 getter 覆盖。
3. navigator.platform / hardwareConcurrency / deviceMemory：原型 getter 覆盖（platform 与画像一致）。
4. screen：逐属性 Object.defineProperty(window.screen, key, {configurable:true,get}) 覆盖 width/height/colorDepth/pixelDepth/availWidth/availHeight/devicePixelRatio；define 失败回退 Screen.prototype；禁止整体替换 window.screen。
5. Intl.DateTimeFormat：保留现有 timeZone 覆盖（locale 与 languages 同序）。
6. WebGL：hook HTMLCanvasElement.prototype.getContext。拿到真实 ctx 后仅 patch 实例的 getParameter（不用 Proxy 包整体对象）：pname 0x9245（UNMASKED_VENDOR_WEBGL）/0x9246（UNMASKED_RENDERER_WEBGL）/WebGL1 0x1F00（VENDOR）/0x1F01（RENDERER）返回伪值，其余原样转发。WeakSet 记录已 patch 的 ctx（幂等）。getExtension('WEBGL_debug_renderer_info') 不拦截。
7. Canvas 2D noise：hook toDataURL/toBlob。调用前 getImageData 备份、按 canvasSeed 画 3-5 个 1px 噪声点、生成后 putImageData 还原；tainted canvas 直接走原方法。
8. 整体 try/catch 包裹，失败仅 console.warn。

## lib/views.js 改动（subagent B）
1. 注入时机：did-start-navigation 且 isMainFrame===true 时 executeJavaScript(generateFullInjectScript(profile))；profile 在 startView 内每账号构建一次。
2. WebRTC：代理设置后 await sess.setWebRTCIPHandlingPolicy(account.webRtcPolicy || 'disable_non_proxied_udp')。
3. UA：account.userAgent 优先，否则 buildFingerprint(account).ua；sess.setUserAgent(ua, profile.acceptLanguages)。

## main.js 改动（subagent B）
1. 删除无条件 app.disableHardwareAcceleration()，改为 if (process.env.MWI_HW_ACCEL === '0') app.disableHardwareAcceleration()。
2. 新增 MWI_SELFTEST_FP2=1 自检：buildFingerprint 自洽断言——(a) UA 的 OS 段与 platform、userAgentData.platform 一致；(b) languages 与 acceptLanguages 同序；(c) 不同 account.id 画像的 ua/webgl.renderer/screen.width 互不相同；(d) 同 id 两次调用画像相等。

## src/js/sidebar.js 改动（subagent C）
1. 指纹预设文本框改下拉：window.api.fingerprint.listPresets() 异步填充，保留手输值回显。
2. 新增可选 User-Agent 输入框 name="userAgent"，保存时 data.userAgent 非空写入、空串不传。

## 文档更新（subagent C）
- README.md：反关联能力/指纹伪装/已知限制更新为真实能力，资源优化行改 GPU 默认启用。
- docs/项目背景及方案（交接）#20260818.md：4.3 指纹伪装表格与已知限制同步。
- 全文不出现 emoji。

## 验证
- node --check 全部改动文件；MWI_SELFTEST_FP2=1 跑通；MWI_SELFTEST_FP=1 不回归。
