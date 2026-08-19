// lib/__tests__/tabbar-click-subscription.test.js - 回归：订阅 tab click handler 必须调 focusSubscriptionsTab 而不是 focusFormTab
// 修复根因：tab 元素 data-tab-type="form" 把订阅 tab 也走 form handler 调 mwiAccountForm.open
// 运行：node --test lib/__tests__/tabbar-click-subscription.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'js', 'tabbar.js'), 'utf8');

function buildSandbox() {
  const calls = { formOpen: 0, subsOpen: 0, formClose: 0, subsClose: 0, hide: 0, resume: 0 };
  const root = { _html: '', get innerHTML() { return this._html; }, set innerHTML(v) { this._html = v; }, querySelectorAll: function () { return []; } };
  const focusSubscriptionsTabCalls = [];
  const focusFormTabCalls = [];
  const apiViews = {};
  const sandbox = {
    document: { getElementById: function (id) { return id === 'tabbar' ? root : { addEventListener: function () {} }; } },
    window: {
      mwiStore: {
        get: function () { return { accounts: [], groups: [], focusedAccountId: null, runningIds: [], viewStates: {} }; },
        set: function (patch) { Object.assign(this, patch); },
        subscribe: function (cb) { return function () {}; },
      },
      mwiAccountForm: { open: async function () { calls.formOpen += 1; }, close: function () { calls.formClose += 1; } },
      mwiSubscriptionsTab: { open: async function () { calls.subsOpen += 1; }, close: function () { calls.subsClose += 1; } },
      mwiSidebar: { refresh: async function () {} },
      api: {
        views: {
          focus: function () { return Promise.resolve(); },
          listRunning: function () { return Promise.resolve([]); },
          getState: function () { return Promise.resolve('stopped'); },
          onStateChanged: function (cb) { apiViews.stateCb = cb; },
          onFocusChanged: function (cb) { apiViews.focusCb = cb; },
        },
        canvas: {
          hideFocused: function () { calls.hide += 1; return Promise.resolve(true); },
          resumeFocused: function () { calls.resume += 1; return Promise.resolve(true); },
          isFocusedHidden: function () { return Promise.resolve(false); },
        },
      },
    },
    console: { log: function () {}, error: function () {}, warn: function () {} },
  };
  // 暴露 focusSubscriptionsTab / focusFormTab 给 sandbox
  vm.createContext(sandbox);
  // 在 tabbar.js 源码末尾附加: window.mwiTabbar = { ..., _testFocusSubs: focusSubscriptionsTab, _testFocusForm: focusFormTab };
  // 但 mwiTabbar 已暴露, 我们 hook 进 closeAllStaticTabs 不行. 简单做: 让 mwiAccountForm/mwiSubscriptionsTab 的 open/close 调用计数, 然后通过 openSubscriptionsTab/openFormTab 间接调用
  // 实际: openSubscriptionsTab 会调 focusSubscriptionsTab → mwiSubscriptionsTab.open (subsOpen+=1) 且 mwiAccountForm.close (formClose+=1)
  // openFormTab 会调 focusFormTab → mwiAccountForm.open (formOpen+=1) 且 mwiSubscriptionsTab.close (subsClose+=1)
  vm.runInContext(SRC, sandbox);
  return { sandbox: sandbox, calls: calls };
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

test('openSubscriptionsTab 调 mwiSubscriptionsTab.open（不开 form）', async function () {
  const ctx = buildSandbox();
  await sleep(80);
  await ctx.sandbox.window.mwiTabbar.openSubscriptionsTab();
  assert.strictEqual(ctx.calls.subsOpen, 1, '订阅 open 应被调用 1 次');
  assert.strictEqual(ctx.calls.formOpen, 0, '订阅 open 不应触发 form open');
});

test('openFormTab 调 mwiAccountForm.open（不开 subs）', async function () {
  const ctx = buildSandbox();
  await sleep(80);
  await ctx.sandbox.window.mwiTabbar.openFormTab(false, null);
  assert.strictEqual(ctx.calls.formOpen, 1, 'form open 应被调用 1 次');
  assert.strictEqual(ctx.calls.subsOpen, 0, 'form open 不应触发 subs open');
});

test('click handler dispatch（订阅 tab 走 focusSubscriptionsTab）— 源校验', function () {
  // 验证源码: click handler 必须检查 data-form-id === proxy-subscriptions 分支
  const hasBranch = SRC.indexOf('el.dataset.formId === ' + String.fromCharCode(39) + 'proxy-subscriptions' + String.fromCharCode(39)) >= 0;
  assert.ok(hasBranch, 'click handler 必须判断 formId 区分订阅 tab 走 focusSubscriptionsTab');
});
