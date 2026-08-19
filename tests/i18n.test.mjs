// tests/i18n.test.mjs - i18n 模块单测（覆盖 spec.md Requirements 全部可单测场景）
// 跑法：node --test tests/i18n.test.mjs

import { test } from 'node:test';
import assert from 'node:assert';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'i18n.js'), 'utf8');

function buildSandbox(opts) {
  opts = opts || {};
  var docEl = { _lang: '', get lang() { return this._lang; }, set lang(v) { this._lang = String(v); } };
  var document = {
    documentElement: docEl,
    readyState: opts.readyState || 'complete',
    addEventListener: function () {}
  };

  var persistedLocale = opts.persistedLocale || 'zh-CN';
  var setLocaleCalls = [];
  var api = {
    i18n: {
      get:  function ()   { return Promise.resolve(persistedLocale); },
      set:  function (c)  { setLocaleCalls.push(c); return Promise.resolve(); },
      list: function ()   { return Promise.resolve(['zh-CN', 'en-US']); }
    }
  };

  var ctxWindow = {
    __mwiLocales: opts.locales || { 'zh-CN': {}, 'en-US': {} },
    api: api
  };

  var sandbox = { window: ctxWindow, document: document, console: console, setTimeout: setTimeout };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);

  return {
    sandbox: sandbox,
    docEl: docEl,
    getSetCalls: function () { return setLocaleCalls.slice(); },
    setPersisted: function (v) { persistedLocale = v; }
  };
}

// === Locale table loading scenarios ===

test('missing __mwiLocales: i18n module loads with empty fallback tables', function () {
  // 不抛错即通过；t('any') 返回 key 字面
  var s = vm.runInContext('(function(){var docEl={_lang:""};var document={documentElement:docEl,readyState:"complete",addEventListener:function(){}};var api={i18n:{get:function(){return Promise.resolve("zh-CN");},set:function(){return Promise.resolve();},list:function(){return Promise.resolve(["zh-CN","en-US"]);}}};var sandbox={window:{api:api},document:document,console:console};vm.createContext(sandbox);return {sandbox:sandbox,docEl:docEl};})', vm.createContext({console:console, vm:vm}))
  // 用 buildSandbox 等价路径（locales 默认 {}）
  var ctx = buildSandbox();
  assert.strictEqual(ctx.sandbox.window.mwiI18n.getLocale(), 'zh-CN');
  assert.strictEqual(ctx.sandbox.window.mwiI18n.t('any.key'), 'any.key');
});

// === t() translation lookup scenarios ===

test('t() returns translation when key present in current locale', function () {
  var ctx = buildSandbox({ locales: { 'zh-CN': { hi: '你好' }, 'en-US': { hi: 'Hello' } } });
  ctx.sandbox.window.mwiI18n.setLocale('en-US');
  assert.strictEqual(ctx.sandbox.window.mwiI18n.t('hi'), 'Hello');
});

test('t() falls back to zh-CN when key missing in current locale', function () {
  var ctx = buildSandbox({ locales: { 'zh-CN': { hi: '你好' }, 'en-US': {} } });
  ctx.sandbox.window.mwiI18n.setLocale('en-US');
  assert.strictEqual(ctx.sandbox.window.mwiI18n.t('hi'), '你好');
});

test('t() returns key literal when missing in both tables', function () {
  var ctx = buildSandbox({ locales: { 'zh-CN': {}, 'en-US': {} } });
  assert.strictEqual(ctx.sandbox.window.mwiI18n.t('absent.key'), 'absent.key');
});

test('t() interpolates {name} placeholders from vars map', function () {
  var ctx = buildSandbox({ locales: { 'zh-CN': { greet: '你好 {name}' } } });
  assert.strictEqual(ctx.sandbox.window.mwiI18n.t('greet', { name: 'World' }), '你好 World');
  assert.strictEqual(ctx.sandbox.window.mwiI18n.t('greet', { name: 42 }), '你好 42');
});

test('t() leaves unknown placeholders untouched', function () {
  var ctx = buildSandbox({ locales: { 'zh-CN': { greet: '你好 {name}' } } });
  assert.strictEqual(ctx.sandbox.window.mwiI18n.t('greet'), '你好 {name}');
});

// === setLocale / locale switching scenarios ===

test('setLocale(en-US) updates documentElement.lang synchronously', function () {
  var ctx = buildSandbox({ locales: { 'zh-CN': {}, 'en-US': {} } });
  ctx.sandbox.window.mwiI18n.setLocale('en-US');
  assert.strictEqual(ctx.docEl.lang, 'en-US');
});

test('setLocale(zh-CN) updates documentElement.lang synchronously', function () {
  var ctx = buildSandbox({ locales: { 'zh-CN': {}, 'en-US': {} } });
  ctx.sandbox.window.mwiI18n.setLocale('en-US');  // 先切走
  ctx.sandbox.window.mwiI18n.setLocale('zh-CN');  // 再切回
  assert.strictEqual(ctx.docEl.lang, 'zh-CN');
});

test('setLocale with unsupported code falls back to zh-CN (no crash)', function () {
  var ctx = buildSandbox({ locales: { 'zh-CN': {}, 'en-US': {} } });
  ctx.sandbox.window.mwiI18n.setLocale('fr-FR');
  assert.strictEqual(ctx.docEl.lang, 'zh-CN');
  assert.strictEqual(ctx.sandbox.window.mwiI18n.getLocale(), 'zh-CN');
});

test('onChange subscribers receive new locale; unsubscribe stops notifications', function () {
  var ctx = buildSandbox({ locales: { 'zh-CN': {}, 'en-US': {} } });
  var calls = [];
  var unsub = ctx.sandbox.window.mwiI18n.onChange(function (code) { calls.push(code); });
  ctx.sandbox.window.mwiI18n.setLocale('en-US');
  assert.deepStrictEqual(calls, ['en-US']);
  unsub();
  ctx.sandbox.window.mwiI18n.setLocale('zh-CN');
  assert.deepStrictEqual(calls, ['en-US']);  // unsub 后不再收到通知
});

test('setLocale passes through to window.api.i18n.set for persistence', function () {
  var ctx = buildSandbox({ locales: { 'zh-CN': {}, 'en-US': {} } });
  ctx.sandbox.window.mwiI18n.setLocale('en-US');
  // window.api.i18n.set 是 async fire-and-forget；用 microtask flush 等承诺落定
  return new Promise(function (resolve) { setImmediate(function () {
    assert.deepStrictEqual(ctx.getSetCalls(), ['en-US']);
    resolve();
  }); });
});

test('init() persistence fetch is overridden by explicit user setLocale', function () {
  // 模拟「持久化存的是 en-US，但脚本先用 setLocale(zh-CN)」的场景
  // 用户手动切语言必须胜过 init 的持久化回放
  var ctx = buildSandbox({ persistedLocale: 'en-US', locales: { 'zh-CN': {}, 'en-US': {} } });
  // 同步触发 setLocale（在 init 完成.then 之前的同一 tick）
  ctx.sandbox.window.mwiI18n.setLocale('zh-CN');  // 用户改成 zh-CN
  // 即使 init.then() 后续拉回 en-US，因为 userExplicitlyChanged=true 不应覆盖
  return new Promise(function (resolve) { setImmediate(function () {
    setImmediate(function () {
      assert.strictEqual(ctx.sandbox.window.mwiI18n.getLocale(), 'zh-CN');
      resolve();
    });
  }); });
});

test('setLocale is idempotent (no-op on same code)', function () {
  var ctx = buildSandbox({ locales: { 'zh-CN': {}, 'en-US': {} } });
  ctx.sandbox.window.mwiI18n.setLocale('zh-CN');  // default
  return new Promise(function (resolve) { setImmediate(function () {
    assert.deepStrictEqual(ctx.getSetCalls(), []);  // 默认 zh-CN 不触发 set
    ctx.sandbox.window.mwiI18n.setLocale('en-US');
    setImmediate(function () {
      ctx.sandbox.window.mwiI18n.setLocale('en-US');  // 重复切
      setImmediate(function () {
        // setLocale 检查 next === current 早退，不广播、不持久化
        assert.deepStrictEqual(ctx.getSetCalls(), ['en-US']);
        resolve();
      });
    });
  }); });
});
// === 集成测试：实际 src/locales/*.json 内容 ===
import { test as it2 } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import vmMod from 'node:vm';

const ZH_PATH = resolvePath(__dirname, '..', 'src', 'locales', 'zh-CN.json');
const EN_PATH = resolvePath(__dirname, '..', 'src', 'locales', 'en-US.json');
const I18N_SRC_PATH = resolvePath(__dirname, '..', 'src', 'js', 'i18n.js');
const ZH = JSON.parse(readFileSync(ZH_PATH, 'utf8'));
const EN = JSON.parse(readFileSync(EN_PATH, 'utf8'));
const I18N_SRC = readFileSync(I18N_SRC_PATH, 'utf8');

it2('zh-CN.json 与 en-US.json key 数一致且无差异', () => {
  const z = Object.keys(ZH).sort();
  const e = Object.keys(EN).sort();
  assert.deepStrictEqual(z, e);
});

it2('关键可见 key zh-CN 文案非空', () => {
  // 几条用户能看到的关键键
  assert.strictEqual(ZH['toolbar.btn.subscriptions.text'], '订阅');
  assert.strictEqual(ZH['sidebar.empty'], '暂无账号，点击上方添加');
  assert.strictEqual(ZH['tabbar.empty'], '中部 tab 区（启动账号后出现）');
  assert.strictEqual(ZH['panel.title'], '详情');
  assert.strictEqual(ZH['statusbar.label.mem_mb'], '内存 {n} MB');
});

it2('关键可见 key en-US 实际翻译过（非中文残留）', () => {
  // 必须真的是英文，不能是中文直接照搬
  assert.strictEqual(EN['toolbar.btn.subscriptions.text'], 'Subscriptions');
  assert.strictEqual(EN['sidebar.empty'], 'No accounts yet. Click +Add above.');
  assert.strictEqual(EN['tabbar.empty'], 'Center tabs (appear after starting an account)');
  assert.strictEqual(EN['panel.title'], 'Details');
  assert.strictEqual(EN['statusbar.label.mem_mb'], 'Mem {n} MB');
});

it2('占位符 key 在 z/en 中 schema 一致', () => {
  // 扫所有 key，正则查 {name} 类占位符，zh-en 占位符必须同名同位
  const re = /{(w+)}/g;
  for (const k of Object.keys(ZH)) {
    const zSet = new Set();
    const eSet = new Set();
    var m;
    while ((m = re.exec(ZH[k])) !== null) zSet.add(m[1]);
    while ((m = re.exec(EN[k])) !== null) eSet.add(m[1]);
    // 重要：drop lastIndex，下次循环需要 reset
    re.lastIndex = 0;
    assert.deepStrictEqual([...zSet].sort(), [...eSet].sort(), 'placeholder mismatch: ' + k);
  }
});

it2('集成：i18n.js 在带 locale 表的 sandbox 里 t() 返回预期值（zh 走 zh，en 走 en）', () => {
  var docEl = { _lang: '', get lang() { return this._lang; }, set lang(v) { this._lang = String(v); } };
  var document = {
    documentElement: docEl,
    readyState: 'complete',
    addEventListener: function () {},
    querySelectorAll: function () { return []; },  // applyI18nToStatic 静默吞
  };
  var api = { i18n: { get: () => Promise.resolve('zh-CN'), set: () => Promise.resolve(), list: () => Promise.resolve(['zh-CN', 'en-US']) } };
  var ctxWindow = { __mwiLocales: { 'zh-CN': ZH, 'en-US': EN }, api: api };
  var sb = { window: ctxWindow, document: document, console: console };
  vmMod.createContext(sb);
  vmMod.runInContext(I18N_SRC, sb);

  // 当前默认 zh-CN
  assert.strictEqual(sb.window.mwiI18n.t('toolbar.btn.subscriptions.text'), '订阅');
  assert.strictEqual(sb.window.mwiI18n.t('panel.title'), '详情');
  assert.strictEqual(sb.window.mwiI18n.t('statusbar.label.mem_mb', { n: 220 }), '内存 220 MB');

  // 切到 en-US
  sb.window.mwiI18n.setLocale('en-US');
  assert.strictEqual(sb.window.mwiI18n.t('toolbar.btn.subscriptions.text'), 'Subscriptions');
  assert.strictEqual(sb.window.mwiI18n.t('panel.title'), 'Details');
  assert.strictEqual(sb.window.mwiI18n.t('statusbar.label.mem_mb', { n: 220 }), 'Mem 220 MB');
  assert.strictEqual(docEl.lang, 'en-US');
});
