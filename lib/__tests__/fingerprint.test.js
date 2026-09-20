// lib/__tests__/fingerprint.test.js - 反制机制全量单测
// 入口：node lib/__tests__/fingerprint.test.js
// 退出码：0 = 全 PASS；非 0 = 有 FAIL

'use strict';

const path = require('path');
const vm = require('vm');
const crypto = require('node:crypto');
const fp = require(path.join(__dirname, '..', 'fingerprint.js'));

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('PASS  ' + name); }
  catch (e) { fail++; console.error('FAIL  ' + name + ' -> ' + e.message); }
}
function eq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || 'eq') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a));
}
function truthy(v, msg) { if (!v) throw new Error(msg || 'falsy'); }
function okEqual(actual, expected, msg) {
  if (actual !== expected) throw new Error((msg || 'eq') + ': expected ' + expected + ', got ' + actual);
}

console.log('=== 阶段 1: API + buildFingerprint ===');
t('1.1 listPresets 3 个', () => { const l = fp.listPresets(); eq(l.length, 3); });
t('1.2 getPreset fallback preset_01', () => { eq(fp.getPreset('xx').label, '标准随机'); });
t('1.3 randomUA 返回 Chromium UA', () => { okEqual((/Chrome/).test(fp.randomUA()), true); });
t('2.1 buildFingerprint 同 id 稳定', () => { const a = fp.buildFingerprint({id:'s1'}); const b = fp.buildFingerprint({id:'s1'}); eq(a, b); });
t('2.2 buildFingerprint 非法 id 抛错', () => { let threw = false; try { fp.buildFingerprint({}); } catch (e) { threw = (/required/).test(e.message); } truthy(threw); });
t('2.3 preset_02 mac 平台', () => { const p = fp.buildFingerprint({id:'m1', fingerprintPreset:'preset_02'}); eq(p.platform, 'mac'); eq(p.userAgentData.platform, 'macOS'); });
t('2.4 preset_03 fixed screen', () => { const p = fp.buildFingerprint({id:'f1', fingerprintPreset:'preset_03'}); eq(p.screen.width, 1366); });
t('2.5 chrome major 与 UA 一致', () => { const p = fp.buildFingerprint({id:'ua-match'}); const m = (p.ua.match(/Chrome[\\/]([0-9]+)/)||[])[1]; const bv = p.userAgentData.brands.find(b => (/Chrom|Chrome|Edge/).test(b.brand)); if (!m || !bv || bv.version !== m) throw new Error('mismatch'); });
t('2.6 custom userAgent 覆盖', () => { const c = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'; const p = fp.buildFingerprint({id:'ua-c', userAgent: c}); eq(p.ua, c); });
t('2.7 illegal preset fallback', () => { const a = fp.buildFingerprint({id:'fb', fingerprintPreset:'preset_01'}); const b = fp.buildFingerprint({id:'fb', fingerprintPreset:'garbage'}); eq(a, b); });
t('2.8 audio 字段有效', () => { const p = fp.buildFingerprint({id:'a1'}); truthy(p.audio && p.audio.sampleRate); });
t('2.9 permState 字段有效', () => { const p = fp.buildFingerprint({id:'p1'}); truthy(p.permState && p.permState.notifications); });

console.log('');
console.log('=== 阶段 2: 注入脚本结构 ===');
const profile0 = fp.buildFingerprint({id:'inj'});
const script0 = fp.generateFullInjectScript(profile0);
t('3.1 script size > 5000 bytes', () => { truthy(script0.length > 5000); });
t('3.2 idempotency guard present', () => { truthy((/__MWI_FP__/).test(script0)); });
t('3.3 webdriver override present', () => { truthy(script0.indexOf('Navigator.prototype, "webdriver"') !== -1); });
t('3.4 Permissions.query override present', () => { truthy(script0.indexOf('Permissions.prototype.query = function') !== -1); });
t('3.5 AudioContext sampleRate present', () => { truthy(script0.indexOf('sampleRate') !== -1 && script0.indexOf('_AudioCtx') !== -1); });
t('3.6 navigator.userAgentData present', () => { truthy((/userAgentData/).test(script0)); });
t('3.7 audio baseLatency present', () => { truthy(script0.indexOf('baseLatency') !== -1); });
t('3.8 audio outputLatency present', () => { truthy(script0.indexOf('outputLatency') !== -1); });
t('3.9 IIFE wrapper', () => { truthy(script0.trim().startsWith('(function () {')); });
t('3.10 contains audio sampleRate value', () => { truthy(script0.indexOf(String(profile0.audio.sampleRate)) !== -1); });
t('3.11 contains permState JSON', () => { truthy(script0.indexOf(JSON.stringify(profile0.permState)) !== -1); });

console.log('');
console.log('=== 阶段 3: vm 沙箱行为验证 ===');
function buildCtx() {
  const Navigator = function () {}; Navigator.prototype = {};
  const Screen = function () {}; Screen.prototype = {};
  const HTMLCanvasElement = function () {};
  HTMLCanvasElement.prototype = { getContext: () => ({ getParameter: (p) => 'real-' + p, getExtension: (n) => n === 'WEBGL_debug_renderer_info' ? { UNMASKED_VENDOR_WEBGL: 'mock-vendor', UNMASKED_RENDERER_WEBGL: 'mock-renderer' } : null }), toDataURL: () => 'real-url', toBlob: (cb) => cb(null) };
  const window = { screen: { width: 1024, height: 768, colorDepth: 24, pixelDepth: 24, availWidth: 1024, availHeight: 768, devicePixelRatio: 1 }, devicePixelRatio: 1 };
  const Intl = { DateTimeFormat: function (l, o) { return { opts: Object.assign({ timeZone: 'UTC' }, o) }; } };
  const Permissions = function () {}; Permissions.prototype = {};
  Permissions.prototype.query = function (desc) { return Promise.resolve({ state: 'real-state', onchange: null }); };
  const AudioContext = function () {}; AudioContext.prototype = {};
  window.AudioContext = AudioContext;
  const OscillatorNode = function () {}; OscillatorNode.prototype = {};
  const AnalyserNode = function () {}; AnalyserNode.prototype = {};
  window.Permissions = Permissions;
  ['hardwareConcurrency','deviceMemory','platform','languages','language','webdriver','userAgentData'].forEach(k => Object.defineProperty(Navigator.prototype, k, { configurable: true, get: function () { return 'real-' + k; } }));
  Object.defineProperty(Navigator.prototype, 'connection', { configurable: true, get: function () { return { effectiveType: '3g', downlink: 1, rtt: 200 }; } });
  Object.defineProperty(Navigator.prototype, 'storage', { configurable: true, get: function () { return { estimate: () => Promise.resolve({ usage: 100, quota: 1000 }) }; } });
  Object.defineProperty(Navigator.prototype, 'plugins', { configurable: true, get: function () { return { length: 0 }; } });
  ['sampleRate','baseLatency','outputLatency'].forEach(k => Object.defineProperty(AudioContext.prototype, k, { configurable: true, get: function () { return 'real-' + k; } }));
  const ctx = { console: console, Promise: Promise, WeakSet: WeakSet, Object: Object, window: window, Navigator: Navigator, Screen: Screen, HTMLCanvasElement: HTMLCanvasElement, Intl: Intl, Permissions: Permissions, AudioContext: AudioContext, OscillatorNode: OscillatorNode, AnalyserNode: AnalyserNode };
  vm.createContext(ctx);
  return ctx;
}

const profile1 = fp.buildFingerprint({id:'vm'});
const script1 = fp.generateFullInjectScript(profile1);

t('V1 navigator.webdriver = false', () => {
  const ctx = buildCtx();
  vm.runInContext(script1, ctx);
  const fake = Object.create(ctx.Navigator.prototype);
  okEqual(fake.webdriver, false);
});

t('V1b Notification.permission = profile.permState.notifications', () => {
  const ctx = buildCtx();
  // Notification constructor
  function Notification() {}
  ctx.window.Notification = ctx.Notification = Notification;
  vm.runInContext(script1, ctx);
  okEqual(Notification.permission, profile1.permState.notifications);
});

t('V1c WEBGL_debug_renderer_info returns profile.webgl', () => {
  const ctx = buildCtx();
  vm.runInContext(script1, ctx);
  const gl = ctx.HTMLCanvasElement.prototype.getContext('webgl');
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  okEqual(info.UNMASKED_VENDOR_WEBGL, profile1.webgl.vendor);
  okEqual(info.UNMASKED_RENDERER_WEBGL, profile1.webgl.renderer);
});

t('V1d WEBGL.getExtension unknown name returns original', () => {
  const ctx = buildCtx();
  vm.runInContext(script1, ctx);
  const gl = ctx.HTMLCanvasElement.prototype.getContext('webgl');
  // Unknown extension returns whatever original returns (null in our mock)
  okEqual(gl.getExtension('NONEXISTENT_extension_xyz'), null);
});


t('V2 Permissions.query notifications', async () => {
  const ctx = buildCtx();
  vm.runInContext(script1, ctx);
  const r = await ctx.Permissions.prototype.query({ name: 'notifications' });
  eq(r.state, profile1.permState.notifications);
});

t('V3 AudioContext sampleRate', () => {
  const ctx = buildCtx();
  vm.runInContext(script1, ctx);
  const fake = Object.create(ctx.AudioContext.prototype);
  okEqual(fake.sampleRate, profile1.audio.sampleRate);
});

t('V3b AudioContext baseLatency', () => {
  const ctx = buildCtx();
  vm.runInContext(script1, ctx);
  const fake = Object.create(ctx.AudioContext.prototype);
  okEqual(fake.baseLatency, profile1.audio.baseLatency);
});

t('V3c AudioContext outputLatency', () => {
  const ctx = buildCtx();
  vm.runInContext(script1, ctx);
  const fake = Object.create(ctx.AudioContext.prototype);
  okEqual(fake.outputLatency, profile1.audio.outputLatency);
});

t('V3d OscillatorNode.frequency = profile.audio.sampleRate', () => {
  const ctx = buildCtx();
  vm.runInContext(script1, ctx);
  const fake = Object.create(ctx.OscillatorNode.prototype);
  okEqual(fake.frequency.value, profile1.audio.sampleRate);
});

t('V3e AnalyserNode.frequencyBinCount = 1024 / fftSize 2048', () => {
  const ctx = buildCtx();
  vm.runInContext(script1, ctx);
  const fake = Object.create(ctx.AnalyserNode.prototype);
  okEqual(fake.frequencyBinCount, 1024);
  okEqual(fake.fftSize, 2048);
});

t('V4a navigator.connection consistent', () => {
  const ctx = buildCtx();
  vm.runInContext(script1, ctx);
  const fake = Object.create(ctx.Navigator.prototype);
  okEqual(fake.connection.effectiveType, '4g');
  okEqual(fake.connection.downlink, 10);
  okEqual(fake.connection.rtt, 50);
});

t('V4b navigator.storage 不再被伪造（保持原生）', async () => {
  const ctx = buildCtx();
  vm.runInContext(script1, ctx);
  const fake = Object.create(ctx.Navigator.prototype);
  const r = await fake.storage.estimate();
  okEqual(r.quota, 1000);   // mock 原生值，未被覆盖
  okEqual(r.usage, 100);
});

t('V4c navigator.plugins = snapshot 列表（含名称与 mimeTypes）', () => {
  const ctx = buildCtx();
  vm.runInContext(script1, ctx);
  const fake = Object.create(ctx.Navigator.prototype);
  okEqual(fake.plugins.length, profile1.navigator.plugins.length);
  okEqual(fake.plugins[0].name, profile1.navigator.plugins[0].name);
  okEqual(fake.plugins[0].mimeTypes[0].type, 'application/pdf');
  okEqual(fake.plugins.namedItem('Chrome PDF Viewer').filename, 'mhjfbmdgcfjbbpaeojofohoefgiehjai');
  okEqual(fake.mimeTypes.namedItem('application/pdf').type, 'application/pdf');
});

t('V5a navigator.appName = Netscape', () => {
  const ctx = buildCtx();
  vm.runInContext(script1, ctx);
  const fake = Object.create(ctx.Navigator.prototype);
  okEqual(fake.appName, 'Netscape');
});

t('V5b navigator.appVersion = ua（无应用身份字样）', () => {
  const ctx = buildCtx();
  vm.runInContext(script1, ctx);
  const fake = Object.create(ctx.Navigator.prototype);
  okEqual(fake.appVersion, profile1.ua);
  okEqual((/mwi-electron-desktop/).test(fake.appVersion), false);
});

t('V5c navigator.vendor / product', () => {
  const ctx = buildCtx();
  vm.runInContext(script1, ctx);
  const fake = Object.create(ctx.Navigator.prototype);
  okEqual(fake.vendor, 'Google Inc.');
  okEqual(fake.product, 'Gecko');
});

t('V5d navigator.maxTouchPoints', () => {
  const ctx = buildCtx();
  vm.runInContext(script1, ctx);
  const fake = Object.create(ctx.Navigator.prototype);
  okEqual(fake.maxTouchPoints, profile1.maxTouchPoints);
});

t('V5e navigator.userAgent 快照驱动', () => {
  const ctx = buildCtx();
  vm.runInContext(script1, ctx);
  const fake = Object.create(ctx.Navigator.prototype);
  okEqual(fake.userAgent, profile1.ua);
});

t('V6a 桌面画像 deviceMemory 遮蔽为 undefined', () => {
  const ctx = buildCtx();
  vm.runInContext(script1, ctx);
  const fake = Object.create(ctx.Navigator.prototype);
  okEqual(fake.deviceMemory, undefined);
});

t('V6b navigator.connection 无 type 键', () => {
  const ctx = buildCtx();
  vm.runInContext(script1, ctx);
  const fake = Object.create(ctx.Navigator.prototype);
  okEqual('type' in fake.connection, false);
  okEqual(fake.connection.effectiveType, profile1.navigator.connection.effectiveType);
});

t('V6c navigator.devicePosture 遮蔽为 undefined', () => {
  const ctx = buildCtx();
  vm.runInContext(script1, ctx);
  const fake = Object.create(ctx.Navigator.prototype);
  okEqual(fake.devicePosture, undefined);
});

t('V6d getBattery 快照驱动（桌面无电池签名）', async () => {
  const ctx = buildCtx();
  vm.runInContext(script1, ctx);
  const fake = Object.create(ctx.Navigator.prototype);
  const b = await fake.getBattery();
  okEqual(b.charging, profile1.battery.charging);
  okEqual(b.level, profile1.battery.level);
  okEqual(b.dischargingTime, Infinity);
});

t('V7 speechSynthesis.getVoices 快照驱动', () => {
  const ctx = buildCtx();
  ctx.window.speechSynthesis = { getVoices: function () { return []; } };
  vm.runInContext(script1, ctx);
  const voices = ctx.window.speechSynthesis.getVoices();
  okEqual(voices.length, profile1.speechVoices.length);
  okEqual(voices[0].name, profile1.speechVoices[0].name);
  okEqual(voices[0].lang, profile1.speechVoices[0].lang);
});

t('R1 navigator.languages', () => {
  const ctx = buildCtx();
  vm.runInContext(script1, ctx);
  const fake = Object.create(ctx.Navigator.prototype);
  eq(fake.languages, profile1.languages);
});

t('R2 window.screen.width', () => {
  const ctx = buildCtx();
  vm.runInContext(script1, ctx);
  okEqual(ctx.window.screen.width, profile1.screen.width);
});

t('R3 navigator.hardwareConcurrency', () => {
  const ctx = buildCtx();
  vm.runInContext(script1, ctx);
  const fake = Object.create(ctx.Navigator.prototype);
  okEqual(fake.hardwareConcurrency, profile1.hardwareConcurrency);
});

t('R4 Intl timezone', () => {
  const ctx = buildCtx();
  vm.runInContext(script1, ctx);
  const d = new ctx.Intl.DateTimeFormat('zh-CN', { hour: 'numeric' });
  eq(d.opts.timeZone, 'Asia/Shanghai');
});

t('R5 WebGL UNMASKED_VENDOR_WEBGL', () => {
  const ctx = buildCtx();
  vm.runInContext(script1, ctx);
  const canvas = Object.create(ctx.HTMLCanvasElement.prototype);
  const gl = canvas.getContext('webgl');
  okEqual(gl.getParameter(0x9245), profile1.webgl.vendor);
  okEqual(gl.getParameter(0x9246), profile1.webgl.renderer);
});

t('I1 Idempotency 3x', () => {
  const ctx = buildCtx();
  vm.runInContext(script1, ctx);
  vm.runInContext(script1, ctx);
  vm.runInContext(script1, ctx);
  okEqual(ctx.window.__MWI_FP__.v, 1);
});

console.log('');
console.log('=== 阶段 4: 1000 id 熵验证 ===');
t('ENT1 全画像 hash 0 碰撞', () => {
  const N = 1000;
  const profiles = [];
  for (let i = 0; i < N; i++) profiles.push(fp.buildFingerprint({id: 'ent_' + crypto.randomBytes(3).toString('hex')}));
  const set = new Set(profiles.map(p => crypto.createHash('sha256').update(JSON.stringify({
    ua: p.ua, hc: p.hardwareConcurrency, dm: p.deviceMemory,
    screen: p.screen, webgl: p.webgl, languages: p.languages,
    timezone: p.timezone, canvasSeed: p.canvasSeed,
    audio: p.audio, permState: p.permState
  })).digest('hex')));
  eq(set.size, N);
});

t('ENT2 canvasSeed 1000 唯一', () => {
  const set = new Set();
  for (let i = 0; i < 1000; i++) set.add(fp.buildFingerprint({id: 'cs_' + i}).canvasSeed);
  eq(set.size, 1000);
});

t('ENT3 audio 覆盖 = 家族成员数（快照驱动）', () => {
  const set = new Set();
  for (let i = 0; i < 1000; i++) set.add(JSON.stringify(fp.buildFingerprint({id: 'a_' + i}).audio));
  okEqual(set.size, 2);
});

t('ENT4 permState 覆盖 = 家族成员数（快照驱动）', () => {
  const set = new Set();
  for (let i = 0; i < 1000; i++) set.add(JSON.stringify(fp.buildFingerprint({id: 'pm_' + i}).permState));
  okEqual(set.size, 2);
});

t('ENT5 100 id 全稳定', () => {
  let stable = 0;
  for (let i = 0; i < 100; i++) {
    const a = fp.buildFingerprint({id: 'stab_' + i});
    const b = fp.buildFingerprint({id: 'stab_' + i});
    if (JSON.stringify(a) === JSON.stringify(b)) stable++;
  }
  okEqual(stable, 100);
});

console.log('');
console.log('=== 阶段 4.5: snapshot 一致性自检 ===');
const snaps = require(path.join(__dirname, '..', 'fingerprint-snapshots.js'));

t('VS1 全部成员通过 validateSnapshot', () => {
  let n = 0;
  for (const pid of Object.keys(snaps.SNAPSHOT_FAMILIES)) {
    for (const m of snaps.SNAPSHOT_FAMILIES[pid]) {
      const errs = snaps.validateSnapshot(m);
      if (errs.length) throw new Error(m.id + ': ' + errs.join('; '));
      n++;
    }
  }
  truthy(n >= 5);
});

t('VS2 appName 非 Netscape 被拒', () => {
  const m = JSON.parse(JSON.stringify(snaps.SNAPSHOT_FAMILIES.preset_01[0]));
  m.navigator.appName = 'MyApp';
  truthy(snaps.validateSnapshot(m).length > 0);
});

t('VS3 brands 与 UA 主版本不对齐被拒', () => {
  const m = JSON.parse(JSON.stringify(snaps.SNAPSHOT_FAMILIES.preset_01[0]));
  m.userAgentData.brands[0].version = '99';
  truthy(snaps.validateSnapshot(m).length > 0);
});

t('VS4 含应用身份字样被拒', () => {
  const m = JSON.parse(JSON.stringify(snaps.SNAPSHOT_FAMILIES.preset_01[0]));
  m.webgl.renderer = m.webgl.renderer + ' mwi-electron-desktop';
  truthy(snaps.validateSnapshot(m).length > 0);
});

t('VS5 connection.type 出现被拒', () => {
  const m = JSON.parse(JSON.stringify(snaps.SNAPSHOT_FAMILIES.preset_01[0]));
  m.navigator.connection.type = 'wifi';
  truthy(snaps.validateSnapshot(m).length > 0);
});

t('VS6 devicePostureType 出现被拒', () => {
  const m = JSON.parse(JSON.stringify(snaps.SNAPSHOT_FAMILIES.preset_01[0]));
  m.navigator.devicePostureType = 'continuous';
  truthy(snaps.validateSnapshot(m).length > 0);
});

t('VS7 plugins 为空被拒', () => {
  const m = JSON.parse(JSON.stringify(snaps.SNAPSHOT_FAMILIES.preset_01[0]));
  m.navigator.plugins = [];
  truthy(snaps.validateSnapshot(m).length > 0);
});

t('VS8 battery 缺失被拒', () => {
  const m = JSON.parse(JSON.stringify(snaps.SNAPSHOT_FAMILIES.preset_01[0]));
  delete m.battery;
  truthy(snaps.validateSnapshot(m).length > 0);
});

console.log('');
console.log('=========================');
console.log('TOTAL: ' + (pass + fail) + '  PASS: ' + pass + '  FAIL: ' + fail);
console.log('=========================');


console.log('=== 阶段 5: Sec-CH-UA / Sec-Fetch-* 头计算 (Round 7) ===');
const sec = require(path.join(__dirname, '..', 'sec-headers.js'));

t('S1 顶层 mainFrame → document/navigate/none/?1 + Sec-CH-UA', () => {
  const profile = fp.buildFingerprint({ id: 'sec-1' });
  const pageOrigin = new URL('https://www.milkywayidle.com/');
  const h = sec.computeSecHeaders({
    url: 'https://www.milkywayidle.com/',
    resourceType: 'mainFrame',
    isTopLevel: true,
    pageOrigin: pageOrigin,
    profile: profile,
  });
  eq(h['Sec-Fetch-Dest'], 'document');
  eq(h['Sec-Fetch-Mode'], 'navigate');
  eq(h['Sec-Fetch-Site'], 'none');
  eq(h['Sec-Fetch-User'], '?1');
  truthy(h['Sec-CH-UA']);
  truthy(h['Sec-CH-UA-Platform']);
  eq(h['Sec-CH-UA-Mobile'], '?0');
  truthy(h['Sec-CH-UA'].indexOf('"Chromium"') >= 0);
});

t('S2 同源 script → script/no-cors/same-origin + 无 Sec-Fetch-User', () => {
  const profile = fp.buildFingerprint({ id: 'sec-2' });
  const pageOrigin = new URL('https://www.milkywayidle.com/');
  const h = sec.computeSecHeaders({
    url: 'https://www.milkywayidle.com/static/js/main.bdda2571.chunk.js',
    resourceType: 'script',
    isTopLevel: false,
    pageOrigin: pageOrigin,
    profile: profile,
  });
  eq(h['Sec-Fetch-Dest'], 'script');
  eq(h['Sec-Fetch-Mode'], 'no-cors');
  eq(h['Sec-Fetch-Site'], 'same-origin');
  truthy(!h['Sec-Fetch-User']);  // 子资源不应有 User
});

t('S3 跨域 script (geevisit) → script/no-cors/cross-site', () => {
  const profile = fp.buildFingerprint({ id: 'sec-3' });
  const pageOrigin = new URL('https://www.milkywayidle.com/');
  const h = sec.computeSecHeaders({
    url: 'https://static.geevisit.com/v4/gt4.js',
    resourceType: 'script',
    isTopLevel: false,
    pageOrigin: pageOrigin,
    profile: profile,
  });
  eq(h['Sec-Fetch-Dest'], 'script');
  eq(h['Sec-Fetch-Mode'], 'no-cors');
  eq(h['Sec-Fetch-Site'], 'cross-site');
});

t('S4 websocket → empty/websocket (MWI 实时通信)', () => {
  const profile = fp.buildFingerprint({ id: 'sec-4' });
  const pageOrigin = new URL('https://www.milkywayidle.com/');
  const h = sec.computeSecHeaders({
    url: 'wss://ws.milkywayidle.com/socket',
    resourceType: 'websocket',
    isTopLevel: false,
    pageOrigin: pageOrigin,
    profile: profile,
  });
  eq(h['Sec-Fetch-Dest'], 'empty');
  eq(h['Sec-Fetch-Mode'], 'websocket');
  truthy(!h['Sec-Fetch-User']);
});

t('S5 不同 profile → Sec-CH-UA / Sec-CH-UA-Platform 不同(熵)', () => {
  const a = fp.buildFingerprint({ id: 'sec-5a' });
  const b = fp.buildFingerprint({ id: 'sec-5b' });
  const pageOrigin = new URL('https://www.milkywayidle.com/');
  const ha = sec.computeSecHeaders({ url: 'https://www.milkywayidle.com/', resourceType: 'mainFrame', isTopLevel: true, pageOrigin, profile: a });
  const hb = sec.computeSecHeaders({ url: 'https://www.milkywayidle.com/', resourceType: 'mainFrame', isTopLevel: true, pageOrigin, profile: b });
  // 平台格式合法
  truthy((/^"[^"]+"$/).test(ha['Sec-CH-UA-Platform']));
  truthy((/^"[^"]+"$/).test(hb['Sec-CH-UA-Platform']));
  // 两账号 CH-UA 必有 brand 序列(可能相同也可能不同,但结构合法)
  truthy((/"[^"]+";v="[0-9]+"/).test(ha['Sec-CH-UA']));
  truthy((/"[^"]+";v="[0-9]+"/).test(hb['Sec-CH-UA']));
});

t('S6 空 profile / null profile → 返回空对象,不崩', () => {
  const pageOrigin = new URL('https://www.milkywayidle.com/');
  const h1 = sec.computeSecHeaders({ url: 'https://www.milkywayidle.com/', resourceType: 'mainFrame', isTopLevel: true, pageOrigin, profile: null });
  eq(h1, {});
  const h2 = sec.computeSecHeaders({ url: 'https://www.milkywayidle.com/', resourceType: 'mainFrame', isTopLevel: true, pageOrigin, profile: {} });
  eq(h2, {});
  const h3 = sec.computeSecHeaders({});
  eq(h3, {});
});


console.log('');
console.log('=== 阶段 3.5: Geolocation 覆盖（真实坐标绝不落回 OS 定位服务） ===');
function buildGeoCtx(geoState, geo) {
  const profile = fp.buildFingerprint({ id: 'geo-' + geoState + '-' + (geo ? 'y' : 'n') });
  profile.permState.geolocation = geoState;   // 'granted' | 'prompt' | 'denied'
  if (geo) profile.geo = geo;
  const script = fp.generateFullInjectScript(profile);
  const ctx = buildCtx();
  ctx.Date = Date;
  ctx.navigator = {
    geolocation: {
      getCurrentPosition: function () { ctx.__nativeGeoHit = true; },
      watchPosition: function () { ctx.__nativeGeoHit = true; return 1; },
      clearWatch: function () {},
    },
  };
  vm.runInContext(script, ctx);
  return ctx;
}

t('G1 prompt/denied → getCurrentPosition 回调 code 1 且不碰原生', () => {
  ['prompt', 'denied'].forEach(function (st) {
    const ctx = buildGeoCtx(st, null);
    let err = null;
    ctx.navigator.geolocation.getCurrentPosition(function () {}, function (e) { err = e; });
    okEqual(err && err.code, 1);
    okEqual(ctx.__nativeGeoHit, undefined);
  });
});

t('G2 granted + profile.geo → 返回假坐标（coords 结构正确）', () => {
  const ctx = buildGeoCtx('granted', { lat: 40.4168, lon: -3.7038, accuracy: 100 });
  let pos = null;
  ctx.navigator.geolocation.getCurrentPosition(function (p) { pos = p; }, function () {});
  okEqual(pos.coords.latitude, 40.4168);
  okEqual(pos.coords.longitude, -3.7038);
  okEqual(pos.coords.accuracy, 100);
  truthy(typeof pos.timestamp === 'number');
});

t('G3 granted + window.__MWI_GEO__ → 用主进程注入的动态出口坐标', () => {
  const ctx = buildGeoCtx('granted', null);
  ctx.window.__MWI_GEO__ = { lat: 22.99, lon: 113.34, accuracy: 500 };
  let pos = null;
  ctx.navigator.geolocation.getCurrentPosition(function (p) { pos = p; }, function () {});
  okEqual(pos.coords.latitude, 22.99);
  okEqual(pos.coords.longitude, 113.34);
  okEqual(pos.coords.accuracy, 500);
});

t('G4 granted 但无任何坐标 → 拒绝（绝不落回 OS 真实定位）', () => {
  const ctx = buildGeoCtx('granted', null);
  let err = null;
  ctx.navigator.geolocation.getCurrentPosition(function () {}, function (e) { err = e; });
  okEqual(err && err.code, 1);
  okEqual(ctx.__nativeGeoHit, undefined);
});

t('G5 watchPosition granted → 立即回调假坐标并返回句柄 0', () => {
  const ctx = buildGeoCtx('granted', { lat: 1.23, lon: 4.56 });
  let pos = null, handle = -1;
  handle = ctx.navigator.geolocation.watchPosition(function (p) { pos = p; }, function () {});
  okEqual(handle, 0);
  okEqual(pos.coords.latitude, 1.23);
  okEqual(pos.coords.longitude, 4.56);
});


console.log('');
console.log('=========================');
console.log('TOTAL: ' + (pass + fail) + '  PASS: ' + pass + '  FAIL: ' + fail);
console.log('=========================');
process.exit(fail === 0 ? 0 : 1);
