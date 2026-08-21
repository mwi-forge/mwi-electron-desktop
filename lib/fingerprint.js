// lib/fingerprint.js - 浏览器指纹画像与注入（snapshot 单一事实源重构）
// 设计原则：「伪装浏览器不是混乱数据」——所有可读字段从同一份目标浏览器画像 snapshot 派生。
// 数据源：lib/fingerprint-snapshots.js 的 SNAPSHOT_FAMILIES；模块加载时全量一致性自检（fail loud）。
// 兼容导出：PRESETS / listPresets() / getPreset(id) / randomUA() / generateInjectScript() / buildFingerprint() / generateFullInjectScript()（ipc.js / preload.js / views.js / main.js 仍引用）

'use strict';

const crypto = require('node:crypto');
const { SNAPSHOT_FAMILIES, FAMILY_META, validateSnapshot } = require('./fingerprint-snapshots');

// ===== 加载时一致性自检：任一成员不通过直接抛错拒绝（fail loud）=====
(function validateAllSnapshots() {
  const bad = [];
  Object.keys(SNAPSHOT_FAMILIES).forEach(function (pid) {
    const members = SNAPSHOT_FAMILIES[pid];
    if (!Array.isArray(members) || members.length === 0) {
      bad.push(pid + ': empty family');
      return;
    }
    members.forEach(function (m) {
      const errs = validateSnapshot(m);
      if (errs.length) bad.push(m.id + ': ' + errs.join('; '));
    });
  });
  if (bad.length) {
    throw new Error('[fingerprint] snapshot validation failed: ' + bad.join(' | '));
  }
})();

// ===== PRESETS 兼容导出（shape 不变：label/platform/fixed/navigator/screen/timezone，由家族首成员派生）=====
const PRESETS = {};
Object.keys(SNAPSHOT_FAMILIES).forEach(function (pid) {
  const m0 = SNAPSHOT_FAMILIES[pid][0];
  PRESETS[pid] = {
    label: FAMILY_META[pid].label,
    platform: m0.platform,
    fixed: !!FAMILY_META[pid].fixed,
    navigator: {
      hardwareConcurrency: m0.hardwareConcurrency,
      deviceMemory: m0.deviceMemory,
      platform: m0.navigator.platform,
      languages: m0.languages.slice(),
    },
    screen: Object.assign({}, m0.screen),
    timezone: m0.timezone,
  };
});

function listPresets() {
  return Object.keys(PRESETS).map(function (id) {
    return { id: id, label: PRESETS[id].label };
  });
}

function getPreset(id) {
  return PRESETS[id] || PRESETS.preset_01;
}

function randomUA() {
  const all = [];
  Object.keys(SNAPSHOT_FAMILIES).forEach(function (pid) {
    SNAPSHOT_FAMILIES[pid].forEach(function (m) { all.push(m.ua); });
  });
  return all[Math.floor(Math.random() * all.length)];
}

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

// ===== 自定义 UA 派生（brands / uaFullVersion / fullVersionList / appVersion 全量随 UA 派生）=====
function deriveFromUa(ua) {
  const major = (ua.match(/Chrome\/([0-9]+)/) || [])[1];
  if (!major) {
    throw new TypeError('buildFingerprint: custom userAgent must contain "Chrome/<major>"');
  }
  const uaFullVersion = major + '.0.0.0';
  return {
    major: major,
    uaFullVersion: uaFullVersion,
    brands: [
      { brand: 'Chromium', version: major },
      { brand: 'Google Chrome', version: major },
      { brand: 'Not?A_Brand', version: '24' },
    ],
    fullVersionList: [
      { brand: 'Chromium', version: uaFullVersion },
      { brand: 'Google Chrome', version: uaFullVersion },
      { brand: 'Not?A_Brand', version: '24.0.0.0' },
    ],
  };
}

// ===== buildFingerprint(account) -> Profile =====
// account 至少含 { id, fingerprintPreset?, userAgent? }
// 规则：seed = sha256(account.id) 前 8 hex；同一账号在家族内稳定选同一成员；不同账号可能不同。
// 除 canvasSeed 外不产生任何 snapshot 之外的字段值——禁止跨成员/跨字段混搭。
function buildFingerprint(account) {
  if (!account || account.id === undefined || account.id === null) {
    throw new TypeError('buildFingerprint: account.id is required');
  }
  const presetId = SNAPSHOT_FAMILIES[account.fingerprintPreset] ? account.fingerprintPreset : 'preset_01';
  const seedInt = seedFromId(account.id);
  const rnd = mulberry32(seedInt);
  const family = SNAPSHOT_FAMILIES[presetId];
  const member = family[Math.floor(rnd() * family.length)];

  // 深拷贝 snapshot 成员（不污染源数据）
  const p = JSON.parse(JSON.stringify(member));

  // 自定义 UA：派生模式——UA 与 brands/uaFullVersion/appVersion 永远同源，禁止两套数据
  if (account.userAgent && typeof account.userAgent === 'string' && account.userAgent.trim()) {
    const ua = account.userAgent.trim();
    const d = deriveFromUa(ua);
    p.ua = ua;
    p.navigator.appVersion = ua;
    p.browser.major = d.major;
    p.browser.fullVersion = d.uaFullVersion;
    p.userAgentData.brands = d.brands;
    p.highEntropy.uaFullVersion = d.uaFullVersion;
    p.highEntropy.fullVersionList = d.fullVersionList;
  }

  // per-account 派生值（snapshot 之外唯一的随机维度：canvas 噪声种子）
  p.canvasSeed = seedInt >>> 0;
  p.acceptLanguages = p.languages.join(',');
  p.language = p.languages[0];
  return p;
}

// ===== generateInjectScript（旧版，保留兼容：main.js 自检仍引用）=====
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
// 全部字段值来自 profile（snapshot 成员 + 自定义 UA 派生 + canvasSeed）；
// 幂等机制：window.__MWI_FP__.v === 1 守卫 + configurable defineProperty + WeakSet 记录已 patch ctx。
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
'    // 2) navigator.languages / language\n',
'    Object.defineProperty(Navigator.prototype, "languages", { configurable: true, get: function () { return P.languages.slice(); } });\n',
'    Object.defineProperty(Navigator.prototype, "language", { configurable: true, get: function () { return P.languages[0]; } });\n',
'\n',
'    // 3) navigator.platform / hardwareConcurrency / deviceMemory（桌面 Chrome 不暴露 deviceMemory；Electron 原生会暴露真实值，须主动遮蔽为 undefined）\n',
'    Object.defineProperty(Navigator.prototype, "platform", { configurable: true, get: function () { return NAV_PLATFORM; } });\n',
'    Object.defineProperty(Navigator.prototype, "hardwareConcurrency", { configurable: true, get: function () { return P.hardwareConcurrency; } });\n',
'    var HIDE = function (name, val) {\n',
'      try { Object.defineProperty(Navigator.prototype, name, { configurable: true, get: function () { return val; } }); } catch (e) {}\n',
'      try { Object.defineProperty(navigator, name, { configurable: true, get: function () { return val; } }); } catch (e) {}\n',
'    };\n',
'    HIDE("deviceMemory", (P.deviceMemory != null) ? P.deviceMemory : undefined);\n',
'\n',
'    // 3.4) navigator.userAgent（快照驱动；与主进程 webContents.setUserAgent 同源，双保险）\n',
'    Object.defineProperty(Navigator.prototype, "userAgent", { configurable: true, get: function () { return P.ua; } });\n',
'\n',
'    // 3.5) 老 Navigator 字段：appName / appVersion / vendor / product / maxTouchPoints（快照驱动）\n',
'    Object.defineProperty(Navigator.prototype, "appName", { configurable: true, get: function () { return P.navigator.appName; } });\n',
'    Object.defineProperty(Navigator.prototype, "appVersion", { configurable: true, get: function () { return P.navigator.appVersion; } });\n',
'    Object.defineProperty(Navigator.prototype, "vendor", { configurable: true, get: function () { return P.navigator.vendor; } });\n',
'    Object.defineProperty(Navigator.prototype, "product", { configurable: true, get: function () { return P.navigator.product; } });\n',
'    if (P.maxTouchPoints != null) {\n',
'      Object.defineProperty(Navigator.prototype, "maxTouchPoints", { configurable: true, get: function () { return P.maxTouchPoints; } });\n',
'    }\n',
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
'        var n = 4 + (P.canvasSeed % 5);  // 4-8 noise points\n',
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
'          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;\n',
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
'    // 11) AudioContext 音频指纹覆盖（AUDIO_NUM 提前声明，避免无 AudioContext 环境连坐 12-15 段）\n',
'    var AUDIO_NUM = P.audio || { sampleRate: 48000, baseLatency: 0.01, outputLatency: 0.02 };\n',
'    if (typeof window.AudioContext !== "undefined" || typeof window.OfflineAudioContext !== "undefined") {\n',
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
'    // 13) navigator.connection（快照驱动；不含 type —— 与 Chromium 移除行为一致）\n',
'    Object.defineProperty(Navigator.prototype, "connection", { configurable: true, get: function () { return P.navigator.connection; } });\n',
'\n',
'    // 13.5) 目标浏览器没有的原生 API 主动遮蔽：devicePosture（Chrome 126 无此 API；Electron 150 暴露 type=continuous）\n',
'    HIDE("devicePosture", undefined);\n',
'\n',
'    // 13.6) getBattery（快照驱动：桌面无电池签名 / 笔记本满电签名）\n',
'    if (P.battery) {\n',
'      Object.defineProperty(Navigator.prototype, "getBattery", { configurable: true, value: function () { return Promise.resolve({ charging: P.battery.charging, chargingTime: P.battery.chargingTime, dischargingTime: P.battery.dischargingTime === "Infinity" ? Infinity : P.battery.dischargingTime, level: P.battery.level }); } });\n',
'    }\n',
'\n',
'    // 14) navigator.plugins / mimeTypes（快照驱动：真实名称 + mimeTypes + item/namedItem）\n',
'    (function () {\n',
'      function mkMime(o) { return { type: o.type, suffixes: o.suffixes || "", description: "" }; }\n',
'      function mkPlugin(p) {\n',
'        var ms = (p.mimeTypes || []).map(mkMime);\n',
'        return { name: p.name, filename: p.filename, length: ms.length, description: "", mimeTypes: ms, item: function (i) { return ms[i] || null; }, namedItem: function (n) { for (var i = 0; i < ms.length; i++) { if (ms[i].type === n) return ms[i]; } return null; } };\n',
'      }\n',
'      var plugs = (P.navigator.plugins || []).map(mkPlugin);\n',
'      var plugArr = { length: plugs.length, item: function (i) { return plugs[i] || null; }, namedItem: function (n) { for (var i = 0; i < plugs.length; i++) { if (plugs[i].name === n) return plugs[i]; } return null; } };\n',
'      for (var pi = 0; pi < plugs.length; pi++) { plugArr[pi] = plugs[pi]; }\n',
'      Object.defineProperty(Navigator.prototype, "plugins", { configurable: true, get: function () { return plugArr; } });\n',
'      var mimes = (P.navigator.mimeTypes || []).map(mkMime);\n',
'      var mimeArr = { length: mimes.length, item: function (i) { return mimes[i] || null; }, namedItem: function (n) { for (var i = 0; i < mimes.length; i++) { if (mimes[i].type === n) return mimes[i]; } return null; } };\n',
'      for (var mi = 0; mi < mimes.length; mi++) { mimeArr[mi] = mimes[mi]; }\n',
'      Object.defineProperty(Navigator.prototype, "mimeTypes", { configurable: true, get: function () { return mimeArr; } });\n',
'    })();\n',
'\n',
'    // 15) speechSynthesis.getVoices（快照驱动声库）\n',
'    if (typeof window.speechSynthesis !== "undefined" && window.speechSynthesis) {\n',
'      try {\n',
'        var _speech = window.speechSynthesis;\n',
'        var _voices = (P.speechVoices || []).map(function (v) { return { name: v.name, lang: v.lang, default: false, localService: !!v.local, voiceURI: v.name }; });\n',
'        _speech.getVoices = function () { return _voices.slice(); };\n',
'      } catch (e) {}\n',
'    }\n',
'\n',
'    // 16) 缺席字段策略：devicePostureType / getBattery / navigator.storage 不注入（与桌面 Chrome 一致）\n',
'  } catch (e) { console.warn("[mwi fp] inject failed", e); }\n',
'})();\n',
  ].join(String.fromCharCode(10));
}

module.exports = {
  PRESETS,
  SNAPSHOT_FAMILIES,
  validateSnapshot,
  listPresets,
  getPreset,
  randomUA,
  generateInjectScript,
  buildFingerprint,
  generateFullInjectScript,
};
