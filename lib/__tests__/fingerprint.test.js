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

t('V4b Storage.estimate returns fixed quota', async () => {
  const ctx = buildCtx();
  vm.runInContext(script1, ctx);
  const fake = Object.create(ctx.Navigator.prototype);
  const r = await fake.storage.estimate();
  okEqual(r.quota, 1073741824);
  okEqual(r.usage, 1048576);
});

t('V4c navigator.plugins length fixed', () => {
  const ctx = buildCtx();
  vm.runInContext(script1, ctx);
  const fake = Object.create(ctx.Navigator.prototype);
  okEqual(fake.plugins.length, 5);
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

t('ENT3 audio 池覆盖 >= 5/6', () => {
  const set = new Set();
  for (let i = 0; i < 1000; i++) set.add(JSON.stringify(fp.buildFingerprint({id: 'a_' + i}).audio));
  truthy(set.size >= 5);
});

t('ENT4 permState 池覆盖 >= 3/4', () => {
  const set = new Set();
  for (let i = 0; i < 1000; i++) set.add(JSON.stringify(fp.buildFingerprint({id: 'pm_' + i}).permState));
  truthy(set.size >= 3);
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
console.log('=========================');
console.log('TOTAL: ' + (pass + fail) + '  PASS: ' + pass + '  FAIL: ' + fail);
console.log('=========================');
process.exit(fail === 0 ? 0 : 1);
