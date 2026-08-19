// lib/__tests__/tabbar-focus-sync.test.js - 回归：onFocusChanged 改 activeTabId 后必须 render 同步 tab 高亮
// 历史 bug：onFocusChanged 只改 activeTabId 不 render，导致 focusGameTab 内部 render 用旧 activeTabId，
//  tab 高亮停留在前一个账号上，与侧栏选中/画布内容不一致。
// 运行：node --test lib/__tests__/tabbar-focus-sync.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'js', 'tabbar.js'), 'utf8');

function buildSandbox() {
  const calls = { renderCount: 0 };
  const root = { _html: '', get innerHTML() { return this._html; }, set innerHTML(v) { calls.renderCount += 1; this._html = v; }, querySelectorAll: function () { return []; } };
  const handlers = {};
  const sandbox = {
    document: { getElementById: function (id) { return id === 'tabbar' ? root : { addEventListener: function () {} }; } },
    window: {
      mwiStore: {
        get: function () { return { accounts: [], groups: [], focusedAccountId: null, runningIds: [], viewStates: {} }; },
        set: function (patch) { Object.assign(this, patch); },
        subscribe: function (cb) { return function () {}; },
      },
      mwiAccountForm: { open: async function () {}, close: function () {} },
      mwiSubscriptionsTab: { open: async function () {}, close: function () {} },
      mwiSidebar: { refresh: async function () {} },
      api: {
        views: { focus: function () { return Promise.resolve(); }, listRunning: function () { return Promise.resolve([]); }, getState: function () { return Promise.resolve('stopped'); },
          onStateChanged: function (cb) { handlers.stateCb = cb; },
          onFocusChanged: function (cb) { handlers.focusCb = cb; } },
        canvas: { hideFocused: function () { return Promise.resolve(true); }, resumeFocused: function () { return Promise.resolve(true); }, isFocusedHidden: function () { return Promise.resolve(false); } },
      },
    },
    console: { log: function () {}, error: function () {}, warn: function () {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { sandbox: sandbox, calls: calls, handlers: handlers };
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

test('onFocusChanged 改 activeTabId 后必须 render 同步 tab 高亮', async function () {
  const ctx = buildSandbox();
  await sleep(80);
  var initial = ctx.calls.renderCount;
  ctx.handlers.focusCb({ accountId: 'acc_aelthrab' });
  await sleep(50);
  assert.ok(ctx.calls.renderCount > initial, 'onFocusChanged 改 activeTabId 后必须 render（修复前是 bug）');
  assert.strictEqual(ctx.sandbox.window.mwiTabbar.getActiveTabId(), 'acc_aelthrab');
  var prev = ctx.calls.renderCount;
  ctx.handlers.focusCb({ accountId: 'acc_crythrad' });
  await sleep(50);
  assert.ok(ctx.calls.renderCount > prev, '第二次 focus 也必须 render');
  assert.strictEqual(ctx.sandbox.window.mwiTabbar.getActiveTabId(), 'acc_crythrad');
});
