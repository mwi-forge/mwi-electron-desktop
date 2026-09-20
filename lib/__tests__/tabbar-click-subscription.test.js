// lib/__tests__/tabbar-click-subscription.test.js - 回归：订阅 tab click handler 必须调 focusSubscriptionsTab 而不是 focusFormTab
// 修复根因：tab 元素 data-tab-type="form" 把订阅 tab 也走 form handler 调 accountForm.open
// 渲染层 ESM 化后改为：globalThis mock + 动态 import + initTabbar(deps) 注入
// 运行：node --test lib/__tests__/tabbar-click-subscription.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC_PATH = path.join(__dirname, '..', '..', 'src', 'js', 'tabbar.js');

let modPromise = null;
function loadTabbar() {
  if (!modPromise) modPromise = import('../../src/js/tabbar.js');
  return modPromise;
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function initCase(calls) {
  const m = await loadTabbar();
  const root = { _html: '', get innerHTML() { return this._html; }, set innerHTML(v) { this._html = v; }, querySelectorAll: function () { return []; } };
  globalThis.document = { getElementById: function (id) { return id === 'tabbar' ? root : { addEventListener: function () {} }; } };
  globalThis.window = {
    api: {
      views: {
        focus: function () { return Promise.resolve(); },
        listRunning: function () { return Promise.resolve([]); },
        getState: function () { return Promise.resolve('stopped'); },
        onStateChanged: function () {},
        onFocusChanged: function () {},
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
    accountForm: { open: async function () { calls.formOpen += 1; }, close: function () { calls.formClose += 1; } },
    subscriptionsTab: { open: async function () { calls.subsOpen += 1; }, close: function () { calls.subsClose += 1; } },
    sidebar: { refresh: async function () {} },
    settingsTab: { close: function () {} },
  });
  await sleep(80);
  return { mod: m };
}

test('openSubscriptionsTab 调 subscriptionsTab.open（不开 form）', async function () {
  const calls = { formOpen: 0, subsOpen: 0, formClose: 0, subsClose: 0 };
  const ctx = await initCase(calls);
  await ctx.mod.tabbar.openSubscriptionsTab();
  assert.strictEqual(calls.subsOpen, 1, '订阅 open 应被调用 1 次');
  assert.strictEqual(calls.formOpen, 0, '订阅 open 不应触发 form open');
});

test('openFormTab 调 accountForm.open（不开 subs）', async function () {
  const calls = { formOpen: 0, subsOpen: 0, formClose: 0, subsClose: 0 };
  const ctx = await initCase(calls);
  await ctx.mod.tabbar.openFormTab(false, null);
  assert.strictEqual(calls.formOpen, 1, 'form open 应被调用 1 次');
  assert.strictEqual(calls.subsOpen, 0, 'form open 不应触发 subs open');
});

test('click handler dispatch（订阅 tab 走 focusSubscriptionsTab）— 源校验', function () {
  // 验证源码: click handler 必须检查 data-form-id === proxy-subscriptions 分支
  const SRC = fs.readFileSync(SRC_PATH, 'utf8');
  const hasBranch = SRC.indexOf('el.dataset.formId === ' + String.fromCharCode(39) + 'proxy-subscriptions' + String.fromCharCode(39)) >= 0;
  assert.ok(hasBranch, 'click handler 必须判断 formId 区分订阅 tab 走 focusSubscriptionsTab');
});
