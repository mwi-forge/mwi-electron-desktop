// lib/__tests__/tabbar-focus-sync.test.js - 回归：onFocusChanged 改 activeTabId 后必须 render 同步 tab 高亮
// 历史 bug：onFocusChanged 只改 activeTabId 不 render，导致 focusGameTab 内部 render 用旧 activeTabId，
//  tab 高亮停留在前一个账号上，与侧栏选中/画布内容不一致。
// 渲染层 ESM 化后改为：globalThis mock + 动态 import + initTabbar(deps) 注入
// 运行：node --test lib/__tests__/tabbar-focus-sync.test.js
const { test } = require('node:test');
const assert = require('node:assert');

let modPromise = null;
function loadTabbar() {
  if (!modPromise) modPromise = import('../../src/js/tabbar.js');
  return modPromise;
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function initCase() {
  const m = await loadTabbar();
  const calls = { renderCount: 0 };
  const handlers = {};
  const root = { _html: '', get innerHTML() { return this._html; }, set innerHTML(v) { calls.renderCount += 1; this._html = v; }, querySelectorAll: function () { return []; } };
  globalThis.document = { getElementById: function (id) { return id === 'tabbar' ? root : { addEventListener: function () {} }; } };
  globalThis.window = {
    api: {
      views: {
        focus: function () { return Promise.resolve(); },
        listRunning: function () { return Promise.resolve([]); },
        getState: function () { return Promise.resolve('stopped'); },
        onStateChanged: function (cb) { handlers.stateCb = cb; },
        onFocusChanged: function (cb) { handlers.focusCb = cb; },
      },
      canvas: {
        hideFocused: function () { return Promise.resolve(true); },
        resumeFocused: function () { return Promise.resolve(true); },
        isFocusedHidden: function () { return Promise.resolve(false); },
      },
    },
  };
  m.initTabbar({
    store: {
      get: function () { return { accounts: [], groups: [], focusedAccountId: null, runningIds: [], viewStates: {} }; },
      set: function () {},
      subscribe: function () { return function () {}; },
    },
    accountForm: { open: async function () {}, close: function () {} },
    subscriptionsTab: { open: async function () {}, close: function () {} },
    sidebar: { refresh: async function () {} },
    settingsTab: { close: function () {} },
  });
  await sleep(80);
  return { mod: m, calls: calls, handlers: handlers };
}

test('onFocusChanged 改 activeTabId 后必须 render 同步 tab 高亮', async function () {
  const ctx = await initCase();
  var initial = ctx.calls.renderCount;
  ctx.handlers.focusCb({ accountId: 'acc_aelthrab' });
  await sleep(50);
  assert.ok(ctx.calls.renderCount > initial, 'onFocusChanged 改 activeTabId 后必须 render（修复前是 bug）');
  assert.strictEqual(ctx.mod.tabbar.getActiveTabId(), 'acc_aelthrab');
  var prev = ctx.calls.renderCount;
  ctx.handlers.focusCb({ accountId: 'acc_crythrad' });
  await sleep(50);
  assert.ok(ctx.calls.renderCount > prev, '第二次 focus 也必须 render');
  assert.strictEqual(ctx.mod.tabbar.getActiveTabId(), 'acc_crythrad');
});
