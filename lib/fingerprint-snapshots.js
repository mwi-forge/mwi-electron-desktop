'use strict';
// lib/fingerprint-snapshots.js - 目标浏览器完整画像 snapshot（单一事实源）
// 设计原则：「伪装浏览器不是混乱数据」。每个 snapshot 是一份真实桌面 Chrome 的全字段画像，
// 所有可读字段从同一成员派生；字段间一致性由 validateSnapshot 在加载时强制校验。
// 手写初值仅用于开发闭环，正式采集请用 scripts/collect-snapshot.js 导出真实 Chrome 数据替换。

// ---- 通用数据块（与真实桌面 Chrome 对齐）----

function pdfPlugins() {
  return [
    {
      name: 'PDF Viewer',
      filename: 'internal-pdf-viewer',
      mimeTypes: [
        { type: 'application/pdf', suffixes: 'pdf' },
        { type: 'text/pdf', suffixes: 'pdf' },
      ],
    },
    {
      name: 'Chrome PDF Viewer',
      filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai',
      mimeTypes: [
        { type: 'application/pdf', suffixes: 'pdf' },
        { type: 'text/pdf', suffixes: 'pdf' },
      ],
    },
    {
      name: 'Chromium PDF Viewer',
      filename: 'internal-pdf-viewer',
      mimeTypes: [
        { type: 'application/pdf', suffixes: 'pdf' },
        { type: 'text/pdf', suffixes: 'pdf' },
      ],
    },
  ];
}

const PDF_MIME_TYPES = [
  { type: 'application/pdf', suffixes: 'pdf' },
  { type: 'text/pdf', suffixes: 'pdf' },
];

// Windows 10/11 zh-CN 本地 TTS 声库（与中文语言包机器一致）
const ZH_WIN_VOICES = [
  { name: 'Microsoft Huihui - Chinese (Simplified, PRC)', lang: 'zh-CN', local: true },
  { name: 'Microsoft Kangkang - Chinese (Simplified, PRC)', lang: 'zh-CN', local: true },
  { name: 'Microsoft Yaoyao - Chinese (Simplified, PRC)', lang: 'zh-CN', local: true },
  { name: 'Microsoft Xiaoxiao - Chinese (Simplified, PRC)', lang: 'zh-CN', local: true },
  { name: 'Microsoft Zira - English (United States)', lang: 'en-US', local: true },
  { name: 'Microsoft David - English (United States)', lang: 'en-US', local: true },
];

// macOS en-US 本地 TTS 声库
const EN_MAC_VOICES = [
  { name: 'Samantha', lang: 'en-US', local: true },
  { name: 'Alex', lang: 'en-US', local: true },
  { name: 'Daniel', lang: 'en-GB', local: true },
  { name: 'Karen', lang: 'en-AU', local: true },
  { name: 'Fred', lang: 'en-US', local: true },
];

// Chromium 桌面典型网络参数；type 有意缺席（Chromium 已移除 connection.type）
const CONN_DESKTOP = { downlink: 10, effectiveType: '4g', rtt: 50 };

const PERM_DESKTOP = {
  notifications: 'denied',
  geolocation: 'prompt',
  clipboard: 'prompt',
  camera: 'prompt',
  microphone: 'prompt',
};

// ---- snapshot 构建辅助：appVersion 强制由 UA 派生，acceptLanguages 强制由 languages 派生 ----

function snap(o) {
  o.navigator.appVersion = o.ua;
  o.acceptLanguages = o.languages.join(',');
  return o;
}

// ---- SNAPSHOT_FAMILIES：preset -> 完整画像成员数组 ----

const SNAPSHOT_FAMILIES = {
  // preset_01 标准随机：win32 平台模板，家族内按账号 seed 稳定选成员
  preset_01: [
    snap({
      id: 'ch126-win10-x64-zhCN',
      label: 'Chrome 126 · Windows 10 x64 · zh-CN',
      platform: 'win32',
      browser: { name: 'Chrome', major: '126', fullVersion: '126.0.6478.127' },
      ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      languages: ['zh-CN', 'zh'],
      navigator: {
        appName: 'Netscape',
        appVersion: '', // snap() 派生
        vendor: 'Google Inc.',
        product: 'Gecko',
        platform: 'Win32',
        language: 'zh-CN',
        plugins: pdfPlugins(),
        mimeTypes: PDF_MIME_TYPES,
        connection: CONN_DESKTOP,
      },
      hardwareConcurrency: 8,
      deviceMemory: null, // 桌面 Chrome 不暴露，保持原生缺席
      maxTouchPoints: 0,
      webdriver: false,
      userAgentData: {
        brands: [
          { brand: 'Chromium', version: '126' },
          { brand: 'Google Chrome', version: '126' },
          { brand: 'Not?A_Brand', version: '24' },
        ],
        mobile: false,
        platform: 'Windows',
      },
      highEntropy: {
        architecture: 'x86',
        bitness: '64',
        model: '',
        platformVersion: '15.0.0',
        uaFullVersion: '126.0.6478.127',
        fullVersionList: [
          { brand: 'Chromium', version: '126.0.6478.127' },
          { brand: 'Google Chrome', version: '126.0.6478.127' },
          { brand: 'Not?A_Brand', version: '24.0.0.0' },
        ],
      },
      screen: { width: 1920, height: 1080, colorDepth: 24, pixelDepth: 24, availWidth: 1920, availHeight: 1040, devicePixelRatio: 1 },
      timezone: 'Asia/Shanghai',
      webgl: {
        vendor: 'Google Inc. (NVIDIA)',
        renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      },
      audio: { sampleRate: 48000, baseLatency: 0.01, outputLatency: 0.02 },
      speechVoices: ZH_WIN_VOICES,
      battery: { charging: true, chargingTime: 0, dischargingTime: 'Infinity', level: 1 },
      permState: { notifications: 'denied', geolocation: 'prompt', clipboard: 'prompt', camera: 'prompt', microphone: 'prompt' },
    }),
    snap({
      id: 'ch130-win10-x64-zhCN',
      label: 'Chrome 130 · Windows 10 x64 · zh-CN',
      platform: 'win32',
      browser: { name: 'Chrome', major: '130', fullVersion: '130.0.6723.92' },
      ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      languages: ['zh-CN', 'zh'],
      navigator: {
        appName: 'Netscape',
        appVersion: '',
        vendor: 'Google Inc.',
        product: 'Gecko',
        platform: 'Win32',
        language: 'zh-CN',
        plugins: pdfPlugins(),
        mimeTypes: PDF_MIME_TYPES,
        connection: CONN_DESKTOP,
      },
      hardwareConcurrency: 12,
      deviceMemory: null,
      maxTouchPoints: 0,
      webdriver: false,
      userAgentData: {
        brands: [
          { brand: 'Chromium', version: '130' },
          { brand: 'Google Chrome', version: '130' },
          { brand: 'Not?A_Brand', version: '24' },
        ],
        mobile: false,
        platform: 'Windows',
      },
      highEntropy: {
        architecture: 'x86',
        bitness: '64',
        model: '',
        platformVersion: '15.0.0',
        uaFullVersion: '130.0.6723.92',
        fullVersionList: [
          { brand: 'Chromium', version: '130.0.6723.92' },
          { brand: 'Google Chrome', version: '130.0.6723.92' },
          { brand: 'Not?A_Brand', version: '24.0.0.0' },
        ],
      },
      screen: { width: 2560, height: 1440, colorDepth: 24, pixelDepth: 24, availWidth: 2560, availHeight: 1400, devicePixelRatio: 1 },
      timezone: 'Asia/Shanghai',
      webgl: {
        vendor: 'Google Inc. (NVIDIA)',
        renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      },
      audio: { sampleRate: 48000, baseLatency: 0.005, outputLatency: 0.01 },
      speechVoices: ZH_WIN_VOICES,
      battery: { charging: true, chargingTime: 0, dischargingTime: 'Infinity', level: 1 },
      permState: { notifications: 'prompt', geolocation: 'denied', clipboard: 'prompt', camera: 'denied', microphone: 'prompt' },
    }),
  ],

  // preset_02 高随机：mac 平台模板
  preset_02: [
    snap({
      id: 'ch128-mac-arm64-enUS',
      label: 'Chrome 128 · macOS 14 arm64 · en-US',
      platform: 'mac',
      browser: { name: 'Chrome', major: '128', fullVersion: '128.0.6613.138' },
      ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      languages: ['en-US', 'en'],
      navigator: {
        appName: 'Netscape',
        appVersion: '',
        vendor: 'Google Inc.',
        product: 'Gecko',
        platform: 'MacIntel',
        language: 'en-US',
        plugins: pdfPlugins(),
        mimeTypes: PDF_MIME_TYPES,
        connection: CONN_DESKTOP,
      },
      hardwareConcurrency: 10,
      deviceMemory: null,
      maxTouchPoints: 0,
      webdriver: false,
      userAgentData: {
        brands: [
          { brand: 'Chromium', version: '128' },
          { brand: 'Google Chrome', version: '128' },
          { brand: 'Not?A_Brand', version: '24' },
        ],
        mobile: false,
        platform: 'macOS',
      },
      highEntropy: {
        architecture: 'arm',
        bitness: '64',
        model: 'MacBookPro18,3',
        platformVersion: '14.5.0',
        uaFullVersion: '128.0.6613.138',
        fullVersionList: [
          { brand: 'Chromium', version: '128.0.6613.138' },
          { brand: 'Google Chrome', version: '128.0.6613.138' },
          { brand: 'Not?A_Brand', version: '24.0.0.0' },
        ],
      },
      screen: { width: 3024, height: 1964, colorDepth: 30, pixelDepth: 30, availWidth: 3024, availHeight: 1889, devicePixelRatio: 2 },
      timezone: 'Asia/Shanghai',
      webgl: {
        vendor: 'Google Inc. (Apple)',
        renderer: 'ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)',
      },
      audio: { sampleRate: 44100, baseLatency: 0.01, outputLatency: 0.02 },
      speechVoices: EN_MAC_VOICES,
      battery: { charging: true, chargingTime: 0, dischargingTime: 'Infinity', level: 0.93 },
      permState: { notifications: 'denied', geolocation: 'denied', clipboard: 'prompt', camera: 'prompt', microphone: 'denied' },
    }),
    snap({
      id: 'ch130-mac-arm64-enUS',
      label: 'Chrome 130 · macOS 15 arm64 · en-US',
      platform: 'mac',
      browser: { name: 'Chrome', major: '130', fullVersion: '130.0.6723.92' },
      ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      languages: ['en-US', 'en'],
      navigator: {
        appName: 'Netscape',
        appVersion: '',
        vendor: 'Google Inc.',
        product: 'Gecko',
        platform: 'MacIntel',
        language: 'en-US',
        plugins: pdfPlugins(),
        mimeTypes: PDF_MIME_TYPES,
        connection: CONN_DESKTOP,
      },
      hardwareConcurrency: 12,
      deviceMemory: null,
      maxTouchPoints: 0,
      webdriver: false,
      userAgentData: {
        brands: [
          { brand: 'Chromium', version: '130' },
          { brand: 'Google Chrome', version: '130' },
          { brand: 'Not?A_Brand', version: '24' },
        ],
        mobile: false,
        platform: 'macOS',
      },
      highEntropy: {
        architecture: 'arm',
        bitness: '64',
        model: 'Mac14,9',
        platformVersion: '15.4.0',
        uaFullVersion: '130.0.6723.92',
        fullVersionList: [
          { brand: 'Chromium', version: '130.0.6723.92' },
          { brand: 'Google Chrome', version: '130.0.6723.92' },
          { brand: 'Not?A_Brand', version: '24.0.0.0' },
        ],
      },
      screen: { width: 2880, height: 1800, colorDepth: 30, pixelDepth: 30, availWidth: 2880, availHeight: 1725, devicePixelRatio: 2 },
      timezone: 'Asia/Shanghai',
      webgl: {
        vendor: 'Google Inc. (Apple)',
        renderer: 'ANGLE (Apple, Apple M2 Pro, OpenGL 4.1)',
      },
      audio: { sampleRate: 48000, baseLatency: 0.005, outputLatency: 0.01 },
      speechVoices: EN_MAC_VOICES,
      battery: { charging: true, chargingTime: 0, dischargingTime: 'Infinity', level: 0.93 },
      permState: { notifications: 'prompt', geolocation: 'prompt', clipboard: 'denied', camera: 'prompt', microphone: 'denied' },
    }),
  ],

  // preset_03 固定：win32 单成员（不随机）
  preset_03: [
    snap({
      id: 'ch120-win10-x64-zhCN',
      label: 'Chrome 120 · Windows 10 x64 · zh-CN',
      platform: 'win32',
      browser: { name: 'Chrome', major: '120', fullVersion: '120.0.6099.130' },
      ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      languages: ['zh-CN', 'zh'],
      navigator: {
        appName: 'Netscape',
        appVersion: '',
        vendor: 'Google Inc.',
        product: 'Gecko',
        platform: 'Win32',
        language: 'zh-CN',
        plugins: pdfPlugins(),
        mimeTypes: PDF_MIME_TYPES,
        connection: CONN_DESKTOP,
      },
      hardwareConcurrency: 8,
      deviceMemory: null,
      maxTouchPoints: 0,
      webdriver: false,
      userAgentData: {
        brands: [
          { brand: 'Chromium', version: '120' },
          { brand: 'Google Chrome', version: '120' },
          { brand: 'Not?A_Brand', version: '24' },
        ],
        mobile: false,
        platform: 'Windows',
      },
      highEntropy: {
        architecture: 'x86',
        bitness: '64',
        model: '',
        platformVersion: '15.0.0',
        uaFullVersion: '120.0.6099.130',
        fullVersionList: [
          { brand: 'Chromium', version: '120.0.6099.130' },
          { brand: 'Google Chrome', version: '120.0.6099.130' },
          { brand: 'Not?A_Brand', version: '24.0.0.0' },
        ],
      },
      screen: { width: 1366, height: 768, colorDepth: 24, pixelDepth: 24, availWidth: 1366, availHeight: 728, devicePixelRatio: 1 },
      timezone: 'Asia/Shanghai',
      webgl: {
        vendor: 'Google Inc. (Intel)',
        renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      },
      audio: { sampleRate: 44100, baseLatency: 0.01, outputLatency: 0.02 },
      speechVoices: ZH_WIN_VOICES,
      battery: { charging: true, chargingTime: 0, dischargingTime: 'Infinity', level: 1 },
      permState: { notifications: 'denied', geolocation: 'prompt', clipboard: 'prompt', camera: 'prompt', microphone: 'prompt' },
    }),
  ],
};

const FAMILY_META = {
  preset_01: { label: '标准随机', fixed: false },
  preset_02: { label: '高随机', fixed: false },
  preset_03: { label: '固定', fixed: true },
};

// ---- validateSnapshot(snap) -> string[]（空数组 = 通过）----

function validateSnapshot(snap) {
  const errs = [];
  const push = (s) => errs.push(s);
  if (!snap || typeof snap !== 'object') return ['not an object'];

  const raw = JSON.stringify(snap);
  if (/mwi-electron-desktop/i.test(raw)) push('forbidden identity string');

  // 版本对齐：UA Chrome 主版本是唯一版本事实源
  if (typeof snap.ua !== 'string' || !snap.ua) {
    push('missing ua');
  } else {
    const m = (snap.ua.match(/Chrome\/([0-9]+)/) || [])[1];
    if (!m) push('ua has no Chrome major');
    else {
      if (!snap.browser || String(snap.browser.major) !== m) push('browser.major != ua major');
      if (snap.browser && snap.browser.fullVersion && !String(snap.browser.fullVersion).startsWith(m + '.')) push('browser.fullVersion misaligned');
      const brands = (snap.userAgentData && snap.userAgentData.brands) || [];
      const b = brands.find((x) => /Chrom|Chrome|Edge/.test(x.brand));
      if (!b || String(b.version) !== m) push('brands major != ua major');
      const fvl = ((snap.highEntropy && snap.highEntropy.fullVersionList) || []).find((x) => /Chrom|Chrome|Edge/.test(x.brand));
      if (!fvl || !String(fvl.version).startsWith(m + '.')) push('fullVersionList misaligned');
      const uafv = snap.highEntropy && snap.highEntropy.uaFullVersion;
      if (typeof uafv !== 'string' || !uafv.startsWith(m + '.')) push('uaFullVersion misaligned');
    }
  }

  const nav = snap.navigator || {};
  if (nav.appName !== 'Netscape') push('appName must be Netscape');
  if (nav.appVersion !== snap.ua) push('appVersion must equal ua');
  if (nav.vendor !== 'Google Inc.') push('vendor must be Google Inc.');
  if (nav.product !== 'Gecko') push('product must be Gecko');

  // OS 对齐：UA OS 段 <-> navigator.platform <-> userAgentData.platform <-> model/bitness
  const osMap = {
    win32: { uaRe: /Windows NT/, platform: 'Win32', uad: 'Windows', model: '', modelRe: null },
    mac: { uaRe: /Mac OS X/, platform: 'MacIntel', uad: 'macOS', model: null, modelRe: /^.+$/ },
    linux: { uaRe: /X11; Linux/, platform: 'Linux x86_64', uad: 'Linux', model: '', modelRe: null },
  };
  const os = osMap[snap.platform];
  if (!os) push('unknown platform');
  else {
    if (!os.uaRe.test(snap.ua || '')) push('ua OS segment != platform');
    if (nav.platform !== os.platform) push('navigator.platform mismatch');
    if (!snap.userAgentData || snap.userAgentData.platform !== os.uad) push('userAgentData.platform mismatch');
    const model = snap.highEntropy && snap.highEntropy.model;
    const modelOk = os.modelRe ? os.modelRe.test(String(model)) : (model === os.model);
    if (!modelOk) push('highEntropy.model mismatch');
    if (!snap.highEntropy || snap.highEntropy.bitness !== '64') push('highEntropy.bitness != 64');
    if (!snap.highEntropy || !snap.highEntropy.architecture) push('highEntropy.architecture missing');
  }

  // 语言链
  if (!Array.isArray(snap.languages) || snap.languages.length === 0) push('languages empty');
  else {
    if (snap.acceptLanguages !== snap.languages.join(',')) push('acceptLanguages != languages.join');
    if (nav.language !== snap.languages[0]) push('navigator.language != languages[0]');
  }

  // 硬件
  if (!Number.isInteger(snap.hardwareConcurrency) || snap.hardwareConcurrency < 1) push('hardwareConcurrency invalid');
  if (snap.deviceMemory !== null && (!Number.isFinite(snap.deviceMemory) || snap.deviceMemory <= 0)) push('deviceMemory invalid');

  // plugins / mimeTypes：plugins 全量 mimeTypes 必须与 navigator.mimeTypes 集合严格相等
  const plugs = nav.plugins;
  if (!Array.isArray(plugs) || plugs.length === 0) push('plugins empty');
  else {
    const flat = [];
    for (const p of plugs) {
      if (!p || typeof p.name !== 'string' || !p.name) push('plugin name missing');
      if (!p || typeof p.filename !== 'string' || !p.filename) push('plugin filename missing');
      if (!p || !Array.isArray(p.mimeTypes) || p.mimeTypes.length === 0) push('plugin ' + (p && p.name) + ' has no mimeTypes');
      else for (const mt of p.mimeTypes) {
        if (!mt || typeof mt.type !== 'string' || !mt.type) push('mimeType.type missing');
        else flat.push(mt.type);
      }
    }
    const mimes = nav.mimeTypes;
    if (!Array.isArray(mimes) || mimes.length === 0) push('mimeTypes empty');
    else {
      const a = [...new Set(flat)].sort().join('|');
      const b = [...new Set(mimes.map((x) => x.type))].sort().join('|');
      if (a !== b) push('plugins.mimeTypes != navigator.mimeTypes');
    }
  }

  // connection：存在且无 type（Chromium 已移除）
  if (!nav.connection || typeof nav.connection !== 'object') push('connection missing');
  else {
    if ('type' in nav.connection) push('connection.type must be absent');
    if (typeof nav.connection.effectiveType !== 'string' || typeof nav.connection.downlink !== 'number' || typeof nav.connection.rtt !== 'number') push('connection fields missing');
  }

  // 折叠屏 API 必须缺席
  if (/devicePostureType/.test(raw)) push('devicePostureType must be absent');

  // 声库
  if (!Array.isArray(snap.speechVoices) || snap.speechVoices.length === 0) push('speechVoices empty');
  else for (const v of snap.speechVoices) {
    if (!v || !v.name || !v.lang) push('voice name/lang missing');
  }

  // 其余必备字段
  const sc = snap.screen;
  if (!sc || !sc.width || !sc.height) push('screen invalid');
  if (!snap.webgl || !snap.webgl.vendor || !snap.webgl.renderer) push('webgl missing');
  if (!snap.audio || ![44100, 48000, 96000, 24000].includes(snap.audio.sampleRate)) push('audio sampleRate invalid');
  if (snap.webdriver !== false) push('webdriver must be false');
  if (!snap.userAgentData || snap.userAgentData.mobile !== false) push('mobile must be false');
  if (!snap.timezone) push('timezone missing');
  if (!snap.permState || typeof snap.permState !== 'object' || !Object.keys(snap.permState).length) push('permState missing');

  const bat = snap.battery;
  if (!bat || typeof bat.charging !== 'boolean' || typeof bat.chargingTime !== 'number'
    || (bat.dischargingTime !== 'Infinity' && typeof bat.dischargingTime !== 'number')
    || typeof bat.level !== 'number' || bat.level <= 0 || bat.level > 1) push('battery invalid');

  return errs;
}

module.exports = { SNAPSHOT_FAMILIES, FAMILY_META, validateSnapshot };
