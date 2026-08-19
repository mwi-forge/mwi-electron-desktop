// lib/fingerprint.js - 浏览器指纹画像与注入（Phase 5.5 加固）
// 兼容导出：PRESETS / listPresets() / getPreset(id) / randomUA() / generateInjectScript()（ipc.js / preload.js / views.js 仍引用）
// 新增导出：buildFingerprint(account)（纯函数，仅依赖 node:crypto，可在纯 node 下测试）/ generateFullInjectScript(profile)

const crypto = require('node:crypto');

// ===== 预设（3 个 id 升级为平台模板，保留旧字段以兼容 generateInjectScript 与 main.js 自检）=====
const PRESETS = {
  preset_01: {
    label: '标准随机',
    platform: 'win32', // 平台模板：win32 / mac / linux
    fixed: false,      // 固定值模板（preset_03）不走随机池
    navigator: { hardwareConcurrency: 8, deviceMemory: 8, platform: 'Win32', languages: ['zh-CN', 'zh', 'en-US', 'en'] },
    screen: { width: 1920, height: 1080, colorDepth: 24, pixelDepth: 24 },
    timezone: 'Asia/Shanghai',
  },
  preset_02: {
    label: '高随机',
    platform: 'mac',
    fixed: false,
    navigator: { hardwareConcurrency: 4, deviceMemory: 16, platform: 'MacIntel', languages: ['en-US', 'en', 'zh-CN', 'zh'] },
    screen: { width: 2560, height: 1440, colorDepth: 30, pixelDepth: 30 },
    timezone: 'Asia/Shanghai',
  },
  preset_03: {
    label: '固定',
    platform: 'win32',
    fixed: true,
    navigator: { hardwareConcurrency: 8, deviceMemory: 8, platform: 'Win32', languages: ['zh-CN', 'zh'] },
    screen: { width: 1366, height: 768, colorDepth: 24, pixelDepth: 24 },
    timezone: 'Asia/Shanghai',
  },
};

// ===== UA 池（按平台重组为 Chromium 系：Chrome/Edge，版本错开 120/126/128/130）=====
const UA_POOL = {
  win32: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
    'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  ],
  mac: [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  ],
  linux: [
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  ],
};

// userAgentData.platform 映射
const UAD_PLATFORM = { win32: 'Windows', mac: 'macOS', linux: 'Linux' };

// ===== 屏幕分辨率池（按平台）=====
const SCREEN_POOL = {
  // win32 8 common desktop resolutions
  win32: [
    { width: 1920, height: 1080, colorDepth: 24, pixelDepth: 24 },
    { width: 2560, height: 1440, colorDepth: 24, pixelDepth: 24 },
    { width: 1366, height: 768, colorDepth: 24, pixelDepth: 24 },
    { width: 3840, height: 2160, colorDepth: 24, pixelDepth: 24 },
    { width: 1536, height: 864, colorDepth: 24, pixelDepth: 24 },
    { width: 1440, height: 900, colorDepth: 24, pixelDepth: 24 },
    { width: 1680, height: 1050, colorDepth: 24, pixelDepth: 24 },
    { width: 3440, height: 1440, colorDepth: 24, pixelDepth: 24 },
  ],
  // mac 8 Retina/external combos (30-bit color)
  mac: [
    { width: 2560, height: 1440, colorDepth: 30, pixelDepth: 30 },
    { width: 1920, height: 1080, colorDepth: 30, pixelDepth: 30 },
    { width: 3024, height: 1964, colorDepth: 30, pixelDepth: 30 },
    { width: 2880, height: 1800, colorDepth: 30, pixelDepth: 30 },
    { width: 3456, height: 2234, colorDepth: 30, pixelDepth: 30 },
    { width: 5120, height: 2880, colorDepth: 30, pixelDepth: 30 },
    { width: 1440, height: 900, colorDepth: 30, pixelDepth: 30 },
    { width: 1680, height: 1050, colorDepth: 30, pixelDepth: 30 },
  ],
  // linux 8 common X11/Wayland sizes
  linux: [
    { width: 1920, height: 1080, colorDepth: 24, pixelDepth: 24 },
    { width: 1366, height: 768, colorDepth: 24, pixelDepth: 24 },
    { width: 2560, height: 1440, colorDepth: 24, pixelDepth: 24 },
    { width: 3840, height: 2160, colorDepth: 24, pixelDepth: 24 },
    { width: 1600, height: 900, colorDepth: 24, pixelDepth: 24 },
    { width: 1280, height: 800, colorDepth: 24, pixelDepth: 24 },
    { width: 1680, height: 1050, colorDepth: 24, pixelDepth: 24 },
    { width: 1920, height: 1200, colorDepth: 24, pixelDepth: 24 },
  ],
};

// ===== 硬件池（核数/内存）=====
const HW_POOL = {
  // 8 items per platform, each hc value unique
  win32: [
    { hc: 4, dm: 8 }, { hc: 6, dm: 12 }, { hc: 8, dm: 16 },
    { hc: 12, dm: 16 }, { hc: 16, dm: 32 }, { hc: 20, dm: 32 },
    { hc: 24, dm: 32 }, { hc: 32, dm: 64 },
  ],
  mac: [
    { hc: 8, dm: 16 }, { hc: 10, dm: 16 }, { hc: 12, dm: 16 },
    { hc: 12, dm: 24 }, { hc: 14, dm: 32 }, { hc: 16, dm: 32 },
    { hc: 16, dm: 64 }, { hc: 24, dm: 64 },
  ],
  linux: [
    { hc: 2, dm: 4 }, { hc: 4, dm: 8 }, { hc: 8, dm: 8 },
    { hc: 8, dm: 16 }, { hc: 12, dm: 16 }, { hc: 16, dm: 32 },
    { hc: 24, dm: 32 }, { hc: 32, dm: 32 },
  ],
};

// ===== WebGL 伪 GPU 池（按平台）=====
const WEBGL_POOL = {
  win32: [
    { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
  ],
  mac: [
    { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, Apple M1, OpenGL 4.1)' },
    { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, Apple M2 Pro, OpenGL 4.1)' },
  ],
  linux: [
    { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070, OpenGL 4.5)' },
  ],
};

// ===== 确定性伪随机（seed 驱动，同 id 两次调用画像相等）=====
function mulberry32(seed) {
  var a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromId(id) {
  var hex = crypto.createHash('sha256').update(String(id)).digest('hex');
  return parseInt(hex.slice(0, 8), 16) >>> 0;
}

// ===== 兼容导出 =====
function listPresets() {
  return Object.keys(PRESETS).map(function (id) {
    return { id: id, label: PRESETS[id].label };
  });
}

function getPreset(id) {
  return PRESETS[id] || PRESETS.preset_01;
}

function randomUA() {
  var flat = [];
  Object.keys(UA_POOL).forEach(function (k) { flat = flat.concat(UA_POOL[k]); });
  return flat[Math.floor(Math.random() * flat.length)];
}

// ===== buildFingerprint(account) -> Profile 纯函数（不依赖 electron，纯 node 可测）=====
// account 至少含 { id, fingerprintPreset?, userAgent?, webRtcPolicy? }
// 规则：seed = sha256(account.id) 前 8 hex -> seedInt；同一账号画像稳定，不同账号互不相同
function buildFingerprint(account) {
  if (!account || account.id === undefined || account.id === null) {
    throw new TypeError('buildFingerprint: account.id is required');
  }
  var preset = getPreset(account.fingerprintPreset); // 非法 id 回退 preset_01
  var platform = preset.platform;
  var seedInt = seedFromId(account.id);
  var rnd = mulberry32(seedInt);

  // UA：account.userAgent 优先，否则按平台池选
  var ua = (account.userAgent && typeof account.userAgent === 'string' && account.userAgent.trim())
    ? account.userAgent.trim()
    : UA_POOL[platform][Math.floor(rnd() * UA_POOL[platform].length)];
  var chromeMajor = (ua.match(/Chrome[/]([0-9]+)/) || [])[1] || '120';
  var uaFullVersion = (ua.match(/Chrome[/]([0-9.]+)/) || [])[1] || chromeMajor + '.0.0.0';
  var isEdge = /Edg[/]/.test(ua);

  // brands 的 Chrome/Edge 版本与 ua 字符串版本一致
  var brands = isEdge
    ? [
        { brand: 'Microsoft Edge', version: chromeMajor },
        { brand: 'Chromium', version: chromeMajor },
        { brand: 'Not?A_Brand', version: '24' },
      ]
    : [
        { brand: 'Chromium', version: chromeMajor },
        { brand: 'Google Chrome', version: chromeMajor },
        { brand: 'Not?A_Brand', version: '24' },
      ];

  // highEntropy 平台映射：win32 -> x86/15.0.0/''；mac -> arm/14.5.0/MacBookPro；linux -> x86/6.8.0/''
  var highEntropy;
  if (platform === 'mac') {
    highEntropy = { architecture: 'arm', bitness: '64', model: 'MacBookPro18,3', platformVersion: '14.5.0', uaFullVersion: uaFullVersion };
  } else if (platform === 'linux') {
    highEntropy = { architecture: 'x86', bitness: '64', model: '', platformVersion: '6.8.0', uaFullVersion: uaFullVersion };
  } else {
    highEntropy = { architecture: 'x86', bitness: '64', model: '', platformVersion: '15.0.0', uaFullVersion: uaFullVersion };
  }

  // 屏幕：fixed 模板用预设固定值，其余按 seed 从平台池选
  var screen = preset.fixed
    ? { width: preset.screen.width, height: preset.screen.height, colorDepth: preset.screen.colorDepth, pixelDepth: preset.screen.pixelDepth }
    : SCREEN_POOL[platform][Math.floor(rnd() * SCREEN_POOL[platform].length)];
  var dpr = platform === 'mac' ? 2 : 1;
  var barH = platform === 'mac' ? 75 : (platform === 'win32' ? 40 : 30); // 菜单栏+Dock / 任务栏 / 顶栏
  screen.availWidth = screen.width;
  screen.availHeight = Math.max(0, screen.height - barH);
  screen.devicePixelRatio = dpr;

  // 硬件
  var hw = preset.fixed
    ? { hc: preset.navigator.hardwareConcurrency, dm: preset.navigator.deviceMemory }
    : HW_POOL[platform][Math.floor(rnd() * HW_POOL[platform].length)];

  // WebGL 伪 GPU
  var gl = WEBGL_POOL[platform][Math.floor(rnd() * WEBGL_POOL[platform].length)];

  var languages = preset.navigator.languages.slice();

  // AudioContext 指纹覆盖：6 项常见 sampleRate/baseLatency 组合，按 seed 选一组
  var AUDIO_POOL = [
    { sampleRate: 44100, baseLatency: 0.01, outputLatency: 0.02 },
    { sampleRate: 48000, baseLatency: 0.005, outputLatency: 0.01 },
    { sampleRate: 48000, baseLatency: 0.01, outputLatency: 0.02 },
    { sampleRate: 48000, baseLatency: 0.02, outputLatency: 0.04 },
    { sampleRate: 96000, baseLatency: 0.005, outputLatency: 0.005 },
    { sampleRate: 24000, baseLatency: 0.04, outputLatency: 0.04 },
  ];
  var audio = AUDIO_POOL[Math.floor(rnd() * AUDIO_POOL.length)];

  // Permissions 状态映射：4 种隐私偏好组合，按 seed 选一组
  var PERM_STATE_POOL = [
    { notifications: 'denied', geolocation: 'prompt', clipboard: 'prompt', camera: 'denied', microphone: 'denied' },
    { notifications: 'denied', geolocation: 'denied', clipboard: 'denied', camera: 'denied', microphone: 'denied' },
    { notifications: 'denied', geolocation: 'prompt', clipboard: 'denied', camera: 'prompt', microphone: 'denied' },
    { notifications: 'denied', geolocation: 'denied', clipboard: 'prompt', camera: 'denied', microphone: 'prompt' },
  ];
  var permState = PERM_STATE_POOL[Math.floor(rnd() * PERM_STATE_POOL.length)];

  return {
    platform: platform,
    ua: ua,
    acceptLanguages: languages.join(','),
    userAgentData: { brands: brands, mobile: false, platform: UAD_PLATFORM[platform] },
    highEntropy: highEntropy,
    languages: languages,
    hardwareConcurrency: hw.hc,
    deviceMemory: hw.dm,
    screen: screen,
    timezone: preset.timezone,
    webgl: gl,
    canvasSeed: seedInt >>> 0,
    audio: audio,
    permState: permState,
  };
}

// ===== generateInjectScript（旧版，保留兼容：views.js / main.js 自检仍引用）=====
function generateInjectScript(presetId) {
  var p = getPreset(presetId);
  var presetJson = JSON.stringify(p);
  return [
    '(function () {',
    '  var P = ' + presetJson + ';',
    '  try {',
    '    if (P.navigator && P.navigator.hardwareConcurrency != null) {',
    '      Object.defineProperty(Navigator.prototype, "hardwareConcurrency", { get: function () { return P.navigator.hardwareConcurrency; }, configurable: true });',
    '    }',
    '    if (P.navigator && P.navigator.deviceMemory != null) {',
    '      Object.defineProperty(Navigator.prototype, "deviceMemory", { get: function () { return P.navigator.deviceMemory; }, configurable: true });',
    '    }',
    '    if (P.navigator && P.navigator.platform) {',
    '      Object.defineProperty(Navigator.prototype, "platform", { get: function () { return P.navigator.platform; }, configurable: true });',
    '    }',
    '    if (P.screen) {',
    '      try { Object.defineProperty(window, "screen", { value: Object.assign({}, window.screen, P.screen), configurable: true }); } catch (e) {}',
    '    }',
    '    if (P.timezone && Intl && Intl.DateTimeFormat) {',
    '      var _OrigDTF = Intl.DateTimeFormat;',
    '      Intl.DateTimeFormat = function (locale, opts) { return new _OrigDTF(locale, Object.assign({}, opts, { timeZone: P.timezone })); };',
    '    }',
    '  } catch (e) { console.warn("[mwi fp] inject failed", e); }',
    '})();'
  ].join(String.fromCharCode(10));
}

// ===== generateFullInjectScript(profile) -> 幂等注入脚本 =====
// 幂等机制：window.__MWI_FP__ 已注入标记 + Navigator 原型 configurable defineProperty（重复覆盖无害）+
// WebGL ctx 用 WeakSet 记录已 patch 实例 + toDataURL/toBlob canvasHooked 标记防噪声叠加
function generateFullInjectScript(profile) {
  var P = JSON.stringify(profile);
  return [
'(function () {\n',
'  var P = ' + P + ';',
'  try {\n',
'    if (window.__MWI_FP__ && window.__MWI_FP__.v === 1) { return; }  // 已注入，幂等退出\n',
'    var state = window.__MWI_FP__ = window.__MWI_FP__ || { v: 1, patchedCtxs: (typeof WeakSet !== "undefined") ? new WeakSet() : null, webglHooked: false, canvasHooked: false };\n',
'    var NAV_PLATFORM = P.platform === "mac" ? "MacIntel" : (P.platform === "linux" ? "Linux x86_64" : "Win32");\n',
'\n',
'    // 1) navigator.userAgentData\n',
'    var uaData = {\n',
'      brands: P.userAgentData.brands,\n',
'      mobile: P.userAgentData.mobile,\n',
'      platform: P.userAgentData.platform,\n',
'      getHighEntropyValues: function () { return Promise.resolve(P.highEntropy); }\n',
'    };\n',
'    Object.defineProperty(Navigator.prototype, "userAgentData", { configurable: true, get: function () { return uaData; } });\n',
'\n',
'    // 2) navigator.languages\n',
'    Object.defineProperty(Navigator.prototype, "languages", { configurable: true, get: function () { return P.languages.slice(); } });\n',
'    Object.defineProperty(Navigator.prototype, "language", { configurable: true, get: function () { return P.languages[0]; } });\n',
'\n',
'    // 3) navigator.platform / hardwareConcurrency / deviceMemory\n',
'    Object.defineProperty(Navigator.prototype, "platform", { configurable: true, get: function () { return NAV_PLATFORM; } });\n',
'    Object.defineProperty(Navigator.prototype, "hardwareConcurrency", { configurable: true, get: function () { return P.hardwareConcurrency; } });\n',
'    Object.defineProperty(Navigator.prototype, "deviceMemory", { configurable: true, get: function () { return P.deviceMemory; } });\n',
'\n',
'    // 4) screen 逐属性覆盖\n',
'    var S = P.screen;\n',
'    var screenKeys = ["width", "height", "colorDepth", "pixelDepth", "availWidth", "availHeight", "devicePixelRatio"];\n',
'    for (var si = 0; si < screenKeys.length; si++) {\n',
'      (function (key) {\n',
'        var value = S[key];\n',
'        try { Object.defineProperty(window.screen, key, { configurable: true, get: function () { return value; } }); }\n',
'        catch (e) {\n',
'          try { Object.defineProperty(Screen.prototype, key, { configurable: true, get: function () { return value; } }); } catch (e2) {}\n',
'        }\n',
'      })(screenKeys[si]);\n',
'    }\n',
'    try { Object.defineProperty(window, "devicePixelRatio", { configurable: true, get: function () { return S.devicePixelRatio; } }); } catch (e) {}\n',
'\n',
'    // 5) Intl.DateTimeFormat 时区覆盖\n',
'    if (Intl && Intl.DateTimeFormat) {\n',
'      var _OrigDTF = Intl.DateTimeFormat;\n',
'      Intl.DateTimeFormat = function (locale, opts) {\n',
'        var locales = (locale === undefined || locale === null || (typeof locale.length === "number" && locale.length === 0)) ? [P.languages[0]] : locale;\n',
'        return new _OrigDTF(locales, Object.assign({}, opts, { timeZone: P.timezone }));\n',
'      };\n',
'    }\n',
'\n',
'    // 6) WebGL getParameter + getExtension\n',
'    if (!state.webglHooked && typeof HTMLCanvasElement !== "undefined") {\n',
'      state.webglHooked = true;\n',
'      var _origGetContext = HTMLCanvasElement.prototype.getContext;\n',
'      HTMLCanvasElement.prototype.getContext = function (type, attrs) {\n',
'        var ctx = _origGetContext.apply(this, arguments);\n',
'        if (ctx && typeof ctx.getParameter === "function" && (type === "webgl" || type === "experimental-webgl" || type === "webgl2")) {\n',
'          if (state.patchedCtxs && !state.patchedCtxs.has(ctx)) {\n',
'            state.patchedCtxs.add(ctx);\n',
'            var origGetParam = ctx.getParameter.bind(ctx);\n',
'            var origGetExt = ctx.getExtension.bind(ctx);\n',
'            ctx.getParameter = function (pname) {\n',
'              if (pname === 0x9245 || pname === 0x1F00) { return P.webgl.vendor; }   // UNMASKED_VENDOR_WEBGL / VENDOR\n',
'              if (pname === 0x9246 || pname === 0x1F01) { return P.webgl.renderer; } // UNMASKED_RENDERER_WEBGL / RENDERER\n',
'              return origGetParam(pname);\n',
'            };\n',
'            ctx.getExtension = function (name) {\n',
'              if (name === "WEBGL_debug_renderer_info") {\n',
'                return { UNMASKED_VENDOR_WEBGL: P.webgl.vendor, UNMASKED_RENDERER_WEBGL: P.webgl.renderer };\n',
'              }\n',
'              return origGetExt(name);\n',
'            };\n',
'          }\n',
'        }\n',
'        return ctx;\n',
'      };\n',
'    }\n',
'\n',
'    // 7) Canvas 2D noise\n',
'    if (!state.canvasHooked && typeof HTMLCanvasElement !== "undefined") {\n',
'      state.canvasHooked = true;\n',
'      var _origToDataURL = HTMLCanvasElement.prototype.toDataURL;\n',
'      var _origToBlob = HTMLCanvasElement.prototype.toBlob;\n',
'      function addNoise(canvas) {\n',
'        var ctx = null;\n',
'        try { ctx = canvas.getContext && canvas.getContext("2d"); } catch (e) { ctx = null; }\n',
'        if (!ctx || typeof ctx.getImageData !== "function" || typeof ctx.putImageData !== "function") { return null; }\n',
'        var w = canvas.width, h = canvas.height;\n',
'        if (!w || !h) { return null; }\n',
'        var backup = null;\n',
'        try { backup = ctx.getImageData(0, 0, w, h); } catch (e) { return null; }  // tainted -> 直接走原方法\n',
'        var n = 4 + (P.canvasSeed % 5);  // 4-8 noise points, harder to detect\n',
'        var seed = (P.canvasSeed + 1) >>> 0;\n',
'        for (var ni = 0; ni < n; ni++) {\n',
'          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;\n',
'          var x = seed % w;\n',
'          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;\n',
'          var y = seed % h;\n',
'          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;\n',
'          var r = seed % 256;\n',
'          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;\n',
'          var g = seed % 256;\n',
'          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;\n',
'          var b = seed % 256;\n',
'          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;\n',
'          var alpha = 0.05 + (seed % 16) / 100;\n',
'          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;\n',
'          var rw = (seed % 2) + 1;\n',
'          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;\n',
'          var rh = (seed % 2) + 1;\n',
'          ctx.fillStyle = "rgba(" + r + "," + g + "," + b + "," + alpha + ")";\n',
'          ctx.fillRect(x, y, rw, rh);\n',
'        }\n',
'        return { ctx: ctx, backup: backup };\n',
'      }\n',
'      function restoreNoise(st) { if (st) { try { st.ctx.putImageData(st.backup, 0, 0); } catch (e) {} } }\n',
'      HTMLCanvasElement.prototype.toDataURL = function () {\n',
'        var st = addNoise(this);\n',
'        try { return _origToDataURL.apply(this, arguments); } finally { restoreNoise(st); }\n',
'      };\n',
'      HTMLCanvasElement.prototype.toBlob = function () {\n',
'        var st = addNoise(this);\n',
'        try { return _origToBlob.apply(this, arguments); } finally { restoreNoise(st); }\n',
'      };\n',
'    }\n',
'\n',
'    // 8) Notification.permission 覆盖\n',
'    if (typeof Notification !== "undefined" && Notification) {\n',
'      try {\n',
'        Object.defineProperty(Notification, "permission", { configurable: true, get: function () { return (P.permState && P.permState.notifications) || "denied"; } });\n',
'      } catch (e) {}\n',
'    }\n',
'\n',
'    // 9) navigator.webdriver 显式置 false\n',
'    Object.defineProperty(Navigator.prototype, "webdriver", { configurable: true, get: function () { return false; } });\n',
'\n',
'    // 10) Permissions.query 统一返回 profile 决定的状态\n',
'    if (typeof window.Permissions !== "undefined" && Permissions && Permissions.prototype && Permissions.prototype.query) {\n',
'      var _origPermQuery = Permissions.prototype.query.bind(Permissions.prototype);\n',
'      var PERM_STATE = P.permState || { notifications: "denied", geolocation: "prompt", clipboard: "prompt", camera: "denied", microphone: "denied" };\n',
'      Permissions.prototype.query = function (desc) {\n',
'        var n = desc && desc.name ? String(desc.name) : "";\n',
'        var st = Object.prototype.hasOwnProperty.call(PERM_STATE, n) ? PERM_STATE[n] : "prompt";\n',
'        return Promise.resolve({ state: st, onchange: null });\n',
'      };\n',
'    }\n',
'\n',
'    // 11) AudioContext 音频指纹覆盖\n',
'    if (typeof window.AudioContext !== "undefined" || typeof window.OfflineAudioContext !== "undefined") {\n',
'      var AUDIO_NUM = P.audio || { sampleRate: 48000, baseLatency: 0.01, outputLatency: 0.02 };\n',
'      var _AudioCtx = window.AudioContext || window.webkitAudioContext;\n',
'      if (_AudioCtx) {\n',
'        try { Object.defineProperty(_AudioCtx.prototype, "sampleRate", { configurable: true, get: function () { return AUDIO_NUM.sampleRate; } }); } catch (e) {}\n',
'        try { Object.defineProperty(_AudioCtx.prototype, "baseLatency", { configurable: true, get: function () { return AUDIO_NUM.baseLatency; } }); } catch (e) {}\n',
'        try { Object.defineProperty(_AudioCtx.prototype, "outputLatency", { configurable: true, get: function () { return AUDIO_NUM.outputLatency; } }); } catch (e) {}\n',
'      }\n',
'    }\n',
'\n',
'    // 12) OscillatorNode / AnalyserNode 覆盖（防音频指纹差异）\n',
'    if (typeof OscillatorNode !== "undefined") {\n',
'      try { Object.defineProperty(OscillatorNode.prototype, "frequency", { configurable: true, get: function () { return { value: AUDIO_NUM.sampleRate, setValueAtTime: function () {}, linearRampToValueAtTime: function () {}, exponentialRampToValueAtTime: function () {} }; } }); } catch (e) {}\n',
'    }\n',
'    if (typeof AnalyserNode !== "undefined") {\n',
'      try { Object.defineProperty(AnalyserNode.prototype, "frequencyBinCount", { configurable: true, get: function () { return 1024; } }); } catch (e) {}\n',
'      try { Object.defineProperty(AnalyserNode.prototype, "fftSize", { configurable: true, get: function () { return 2048; } }); } catch (e) {}\n',
'    }\n',
'\n',
'    // 13) navigator.connection（网络连接 API 一致化）\n',
'    var _connObj = { effectiveType: "4g", downlink: 10, rtt: 50 };\n',
'    Object.defineProperty(Navigator.prototype, "connection", { configurable: true, get: function () { return _connObj; } });\n',
'    // 14) Storage.estimate（存储配额指纹一致化）\n',
'    var _storageObj = { estimate: function () { return Promise.resolve({ usage: 1048576, quota: 1073741824 }); } };\n',
'    Object.defineProperty(Navigator.prototype, "storage", { configurable: true, get: function () { return _storageObj; } });\n',
'    // 15) navigator.plugins 长度固定（防 plugins 指纹）\n',
'    var _pluginsObj = { length: 5 };\n',
'    Object.defineProperty(Navigator.prototype, "plugins", { configurable: true, get: function () { return _pluginsObj; } });\n',
'  } catch (e) { console.warn("[mwi fp] inject failed", e); }\n',
'})();\n',
  ].join(String.fromCharCode(10));
}
module.exports = { PRESETS, listPresets, getPreset, randomUA, generateInjectScript, buildFingerprint, generateFullInjectScript };
