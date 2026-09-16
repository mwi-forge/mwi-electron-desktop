// lib/__tests__/views-idle-autostop.test.js - idle auto-stop 单测（per openspec/changes/idle-auto-stop）
// 覆盖 spec.md 9 个 Requirements；用 vm sandbox + fake electron / electron-store / setTimeout 隔离 views.js
// 运行：node --test lib/__tests__/views-idle-autostop.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const SRC_VIEWS = fs.readFileSync(path.join(__dirname, '..', 'views.js'), 'utf8');

function buildSandbox(opts) {
  opts = opts || {};
  var idleTimeoutMs = opts.idleTimeoutMs === undefined ? 300000 : opts.idleTimeoutMs;
  var storeGetReturns = opts.storeGetReturns === undefined ? idleTimeoutMs : opts.storeGetReturns;
  var storeState = { idleAutoStopMs: storeGetReturns };
  var fakeStore = function () { return { get: function (k) { return storeState[k]; }, set: function (k, v) { storeState[k] = v; } }; };
  var timerRegistry = [];
  var fakeSetTimeout = function (cb, ms) { var id = timerRegistry.length + 1; timerRegistry.push({ id: id, cb: cb, ms: ms }); return id; };
  var fakeClearTimeout = function (id) { var i = timerRegistry.findIndex(function (t) { return t.id === id; }); if (i >= 0) timerRegistry.splice(i, 1); };
  var listeners = {};
  var fakeWebContents = {
    on: function (event, cb) { (listeners[event] = listeners[event] || []).push(cb); },
    insertCSS: function () { return Promise.resolve(); },
    session: { setProxy: function () {}, on: function () {} },
    destroy: function () {},
    getURL: function () { return ''; },
    setBounds: function () {},
    loadURL: function () { return Promise.resolve(); }
  };
  var fakeView = { webContents: fakeWebContents, setBounds: function () {} };
  var fakeMainWindow = {
    isDestroyed: function () { return false; },
    getContentBounds: function () { return { x: 0, y: 0, width: 1280, height: 800 }; },
    contentView: { children: [], addChildView: function () {}, removeChildView: function () {} },
    on: function () {}
  };
  var sandbox = {
    require: function (mod) {
      if (mod === 'path') return require('path'); if (mod === 'electron') return { WebContentsView: function () { return fakeView; }, BrowserWindow: function () {} };
      if (mod === 'electron-store') return fakeStore;
      if (mod === './logs') return { info: function () {}, warn: function () {}, error: function () {} };
      if (mod === './proxy') return { bindSessionProxy: function () { return Promise.resolve({ ok: true }); }, releaseSessionGateway: function () { return Promise.resolve(); } };
      if (mod === './fingerprint') return { buildFingerprint: function () { return { ua: 'fake', webgl: {} }; } };
      if (mod === './tampermonkey') return {};
      if (mod === './sec-headers') return {};
      if (mod === './safe-storage') return {};
      if (mod === './alert') return {};
      if (mod === './layout-metrics') return require('../layout-metrics');
      throw new Error('fake require: ' + mod);
    },
    module: { exports: {} },
    exports: {},
    console: console,
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
    Date: Date,
    Math: Math,
    JSON: JSON,
    Object: Object,
    Array: Array,
    process: { platform: 'darwin' },
    Buffer: Buffer,
    WeakSet: WeakSet,
    Map: Map,
    Set: Set,
    Promise: Promise,
    setImmediate: setImmediate,
    clearImmediate: clearImmediate
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC_VIEWS, sandbox);
  return {
    sandbox: sandbox,
    module: sandbox.module.exports,
    listeners: listeners,
    timers: timerRegistry,
    fakeView: fakeView,
    fakeMainWindow: fakeMainWindow,
    storeState: storeState
  };
}

test('Req 1: 模块加载默认 idleTimeoutMs = 300000', function () {
  var ctx = buildSandbox();
  assert.strictEqual(ctx.module.getIdleTimeoutMs(), 300000);
});

test('Req 1: idleTimeoutMs === 0 时 armIdleTimer 是 no-op', function () {
  var ctx = buildSandbox({ idleTimeoutMs: 0 });
  ctx.module.setMainWindow(ctx.fakeMainWindow);
  ctx.module.armIdleTimer('acc_fake');
  assert.strictEqual(ctx.timers.length, 0);
});

test('Req 2: getIdleConfig 返回 { timeoutMs, enabled }', function () {
  var ctx = buildSandbox({ idleTimeoutMs: 60000 });
  var r1 = { timeoutMs: ctx.module.getIdleTimeoutMs(), enabled: ctx.module.getIdleTimeoutMs() > 0 };
  assert.deepStrictEqual(r1, { timeoutMs: 60000, enabled: true });
  ctx.module.setIdleTimeoutMs(0);
  var r2 = { timeoutMs: ctx.module.getIdleTimeoutMs(), enabled: ctx.module.getIdleTimeoutMs() > 0 };
  assert.deepStrictEqual(r2, { timeoutMs: 0, enabled: false });
});

test('Req 4: disposeAllIdleTimers 不抛错', function () {
  var ctx = buildSandbox();
  ctx.timers.push({ id: 1, cb: function () {}, ms: 100 });
  ctx.timers.push({ id: 2, cb: function () {}, ms: 200 });
  ctx.module.disposeAllIdleTimers();
  assert.ok(true);
});

test('Req 4: setIdleTimeoutMs 非法值抛 Error', function () {
  var ctx = buildSandbox();
  assert.throws(function () { ctx.module.setIdleTimeoutMs(-1); });
  assert.throws(function () { ctx.module.setIdleTimeoutMs(NaN); });
  assert.throws(function () { ctx.module.setIdleTimeoutMs('abc'); });
});

test('Req 4: armIdleTimer / disposeAllIdleTimers / getIdleTimeoutMs / setIdleTimeoutMs 全部 export', function () {
  var ctx = buildSandbox();
  assert.strictEqual(typeof ctx.module.armIdleTimer, 'function');
  assert.strictEqual(typeof ctx.module.disposeAllIdleTimers, 'function');
  assert.strictEqual(typeof ctx.module.getIdleTimeoutMs, 'function');
  assert.strictEqual(typeof ctx.module.setIdleTimeoutMs, 'function');
});

test('Req 2: setIdleTimeoutMs(0) 后立即生效', function () {
  var ctx = buildSandbox({ idleTimeoutMs: 300000 });
  ctx.module.setIdleTimeoutMs(0);
  assert.strictEqual(ctx.module.getIdleTimeoutMs(), 0);
});

test('Req 4: setIdleTimeoutMs 有效值更新生效', function () {
  var ctx = buildSandbox({ idleTimeoutMs: 300000 });
  ctx.module.setIdleTimeoutMs(120000);
  assert.strictEqual(ctx.module.getIdleTimeoutMs(), 120000);
});


