// tests/i18n.test.mjs - i18n 模块单测（覆盖 spec.md Requirements 全部可单测场景）
// i18n.js ESM 化后 vm 无法加载：改为 globalThis mock + 动态 import。
// i18n.js 无本地依赖，用 query-string cache-bust 给每轮 test 拉全新模块实例
//（RAW_LOCALES 在模块求值时固化 window.__mwiLocales，必须新实例才能换 locale 表）。
// 跑法：node --test tests/i18n.test.mjs

import { test } from 'node:test';
import assert from 'node:assert';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const I18N_URL = pathToFileURL(path.join(__dirname, '..', 'src', 'js', 'i18n.js')).href;

let caseSeq = 0;

async function loadI18n(opts) {
  opts = opts || {};
  var docEl = { _lang: '', get lang() { return this._lang; }, set lang(v) { this._lang = String(v); } };
  globalThis.document = {
    documentElement: docEl,
    readyState: opts.readyState || 'complete',
    addEventListener: function () {},
    querySelectorAll: function () { return []; },
  };
  var persistedLocale = opts.persistedLocale || 'zh-CN';
  var setLocaleCalls = [];
  globalThis.window = {
    __mwiLocales: opts.locales || { 'zh-CN': {}, 'en-US': {} },
    api: {
      i18n: {
        get: function () { return Promise.resolve(persistedLocale); },
        set: function (c) { setLocaleCalls.push(c); return Promise.resolve(); },
        list: function () { return Promise.resolve(['zh-CN', 'en-US']); }
      }
    }
  };
  const mod = await import(I18N_URL + '?case=' + (++caseSeq));
  return {
    mod: mod,
    docEl: docEl,
    getSetCalls: function () { return setLocaleCalls.slice(); },
    setPersisted: function (v) { persistedLocale = v; }
  };
}

// === Locale table loading scenarios ===

test('missing __mwiLocales: i18n module loads with empty fallback tables', async function () {
  // 不抛错即通过；t('any') 返回 key 字面
  var ctx = await loadI18n();
  assert.strictEqual(ctx.mod.i18n.getLocale(), 'zh-CN');
  assert.strictEqual(ctx.mod.i18n.t('any.key'), 'any.key');
});

// === t() translation lookup scenarios ===

test('t() returns translation when key present in current locale', async function () {
  var ctx = await loadI18n({ locales: { 'zh-CN': { hi: '你好' }, 'en-US': { hi: 'Hello' } } });
  ctx.mod.i18n.setLocale('en-US');
  assert.strictEqual(ctx.mod.i18n.t('hi'), 'Hello');
});

test('t() falls back to zh-CN when key missing in current locale', async function () {
  var ctx = await loadI18n({ locales: { 'zh-CN': { hi: '你好' }, 'en-US': {} } });
  ctx.mod.i18n.setLocale('en-US');
  assert.strictEqual(ctx.mod.i18n.t('hi'), '你好');
});

test('t() returns key literal when missing in both tables', async function () {
  var ctx = await loadI18n({ locales: { 'zh-CN': {}, 'en-US': {} } });
  assert.strictEqual(ctx.mod.i18n.t('absent.key'), 'absent.key');
});

test('t() interpolates {name} placeholders from vars map', async function () {
  var ctx = await loadI18n({ locales: { 'zh-CN': { greet: '你好 {name}' } } });
  assert.strictEqual(ctx.mod.i18n.t('greet', { name: 'World' }), '你好 World');
  assert.strictEqual(ctx.mod.i18n.t('greet', { name: 42 }), '你好 42');
});

test('t() leaves unknown placeholders untouched', async function () {
  var ctx = await loadI18n({ locales: { 'zh-CN': { greet: '你好 {name}' } } });
  assert.strictEqual(ctx.mod.i18n.t('greet'), '你好 {name}');
});

// === setLocale / locale switching scenarios ===

test('setLocale(en-US) updates documentElement.lang synchronously', async function () {
  var ctx = await loadI18n({ locales: { 'zh-CN': {}, 'en-US': {} } });
  ctx.mod.i18n.setLocale('en-US');
  assert.strictEqual(ctx.docEl.lang, 'en-US');
});

test('setLocale(zh-CN) updates documentElement.lang synchronously', async function () {
  var ctx = await loadI18n({ locales: { 'zh-CN': {}, 'en-US': {} } });
  ctx.mod.i18n.setLocale('en-US');  // 先切走
  ctx.mod.i18n.setLocale('zh-CN');  // 再切回
  assert.strictEqual(ctx.docEl.lang, 'zh-CN');
});

test('setLocale with unsupported code falls back to zh-CN (no crash)', async function () {
  var ctx = await loadI18n({ locales: { 'zh-CN': {}, 'en-US': {} } });
  ctx.mod.i18n.setLocale('fr-FR');
  assert.strictEqual(ctx.docEl.lang, 'zh-CN');
  assert.strictEqual(ctx.mod.i18n.getLocale(), 'zh-CN');
});

test('onChange subscribers receive new locale; unsubscribe stops notifications', async function () {
  var ctx = await loadI18n({ locales: { 'zh-CN': {}, 'en-US': {} } });
  var calls = [];
  var unsub = ctx.mod.i18n.onChange(function (code) { calls.push(code); });
  ctx.mod.i18n.setLocale('en-US');
  assert.deepStrictEqual(calls, ['en-US']);
  unsub();
  ctx.mod.i18n.setLocale('zh-CN');
  assert.deepStrictEqual(calls, ['en-US']);  // unsub 后不再收到通知
});

test('setLocale passes through to window.api.i18n.set for persistence', async function () {
  var ctx = await loadI18n({ locales: { 'zh-CN': {}, 'en-US': {} } });
  ctx.mod.i18n.setLocale('en-US');
  // window.api.i18n.set 是 async fire-and-forget；用 microtask flush 等承诺落定
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.deepStrictEqual(ctx.getSetCalls(), ['en-US']);
});

test('initI18n() persistence fetch is overridden by explicit user setLocale', async function () {
  // 模拟「持久化存的是 en-US，但用户先用 setLocale(zh-CN)」的场景
  // 用户手动切语言必须胜过 init 的持久化回放
  var ctx = await loadI18n({ persistedLocale: 'en-US', locales: { 'zh-CN': {}, 'en-US': {} } });
  ctx.mod.initI18n();  // readyState=complete → 同步 init，开始拉持久化
  // 同步触发 setLocale（在 init 完成.then 之前的同一 tick）
  ctx.mod.i18n.setLocale('zh-CN');  // 用户改成 zh-CN
  // 即使 init.then() 后续拉回 en-US，因为 userExplicitlyChanged=true 不应覆盖
  await new Promise(function (resolve) { setImmediate(function () { setImmediate(resolve); }); });
  assert.strictEqual(ctx.mod.i18n.getLocale(), 'zh-CN');
});

test('setLocale is idempotent (no-op on same code)', async function () {
  var ctx = await loadI18n({ locales: { 'zh-CN': {}, 'en-US': {} } });
  ctx.mod.initI18n();  // 原版 IIFE 加载即 init（docEl.lang 置 'zh-CN'），幂等早退条件依赖它
  ctx.mod.i18n.setLocale('zh-CN');  // default
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.deepStrictEqual(ctx.getSetCalls(), []);  // 默认 zh-CN 不触发 set
  ctx.mod.i18n.setLocale('en-US');
  await new Promise(function (resolve) { setImmediate(resolve); });
  ctx.mod.i18n.setLocale('en-US');  // 重复切
  await new Promise(function (resolve) { setImmediate(resolve); });
  // setLocale 检查 next === current 早退，不广播、不持久化
  assert.deepStrictEqual(ctx.getSetCalls(), ['en-US']);
});

// === 集成测试：实际 src/locales/*.json 内容 ===

const ZH_PATH = resolvePath(__dirname, '..', 'src', 'locales', 'zh-CN.json');
const EN_PATH = resolvePath(__dirname, '..', 'src', 'locales', 'en-US.json');
const ZH = JSON.parse(readFileSync(ZH_PATH, 'utf8'));
const EN = JSON.parse(readFileSync(EN_PATH, 'utf8'));

test('zh-CN.json 与 en-US.json key 数一致且无差异', () => {
  const z = Object.keys(ZH).sort();
  const e = Object.keys(EN).sort();
  assert.deepStrictEqual(z, e);
});

test('关键可见 key zh-CN 文案非空', () => {
  // 几条用户能看到的关键键
  assert.strictEqual(ZH['toolbar.btn.subscriptions.text'], '订阅');
  assert.strictEqual(ZH['sidebar.empty'], '暂无账号，点击上方添加');
  assert.strictEqual(ZH['tabbar.empty'], '中部 tab 区（启动账号后出现）');
  assert.strictEqual(ZH['panel.title'], '详情');
  assert.strictEqual(ZH['statusbar.label.mem_mb'], '内存 {n} MB');
});

test('关键可见 key en-US 实际翻译过（非中文残留）', () => {
  // 必须真的是英文，不能是中文直接照搬
  assert.strictEqual(EN['toolbar.btn.subscriptions.text'], 'Subscriptions');
  assert.strictEqual(EN['sidebar.empty'], 'No accounts yet. Click +Add above.');
  assert.strictEqual(EN['tabbar.empty'], 'Center tabs (appear after starting an account)');
  assert.strictEqual(EN['panel.title'], 'Details');
  assert.strictEqual(EN['statusbar.label.mem_mb'], 'Mem {n} MB');
});

test('占位符 key 在 z/en 中 schema 一致', () => {
  // 扫所有 key，正则查 {name} 类占位符，zh-en 占位符必须同名同位
  const re = /{(\w+)}/g;
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

test('占位符提取哨兵：正则必须真实命中 {n}（防退化回空转）', () => {
  // 回归：正则曾误写为 /{(w+)}/g（缺 \w 转义），对真实占位符永不命中，
  // 上一条 schema 一致性测试因此左右集合恒空、空转通过。此哨兵锁定提取非空。
  const re = /{(\w+)}/g;
  const found = [];
  let m;
  while ((m = re.exec(ZH['statusbar.label.mem_mb'])) !== null) found.push(m[1]);
  assert.ok(found.includes('n'), '应从「内存 {n} MB」提取出占位符 n，否则正则已退化');
});

test('集成：i18n.js 在带 locale 表的 mock 里 t() 返回预期值（zh 走 zh，en 走 en）', async () => {
  const ctx = await loadI18n({ locales: { 'zh-CN': ZH, 'en-US': EN } });

  // 当前默认 zh-CN
  assert.strictEqual(ctx.mod.i18n.t('toolbar.btn.subscriptions.text'), '订阅');
  assert.strictEqual(ctx.mod.i18n.t('panel.title'), '详情');
  assert.strictEqual(ctx.mod.i18n.t('statusbar.label.mem_mb', { n: 220 }), '内存 220 MB');

  // 切到 en-US
  ctx.mod.i18n.setLocale('en-US');
  assert.strictEqual(ctx.mod.i18n.t('toolbar.btn.subscriptions.text'), 'Subscriptions');
  assert.strictEqual(ctx.mod.i18n.t('panel.title'), 'Details');
  assert.strictEqual(ctx.mod.i18n.t('statusbar.label.mem_mb', { n: 220 }), 'Mem 220 MB');
  assert.strictEqual(ctx.docEl.lang, 'en-US');
});
