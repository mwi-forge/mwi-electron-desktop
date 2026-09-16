// lib/__tests__/tabbar-subscriptions-resume.test.js - 回归：点订阅按钮第二次必须调 focusSubscriptionsTab 而不是 focusFormTab
// 历史 bug：openSubscriptionsTab 第二次调用时调 focusFormTab 错误地弹添加账号界面
// 渲染层 ESM 化后改为：globalThis mock + 动态 import + initTabbar(deps) 注入
// 运行：node --test lib/__tests__/tabbar-subscriptions-resume.test.js
const { test } = require('node:test');
const assert = require('node:assert');

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
    accountForm: { open: async function () { calls.formOpen += 1; }, close: function () {} },
    subscriptionsTab: { open: async function () { calls.subsOpen += 1; }, close: function () {} },
    sidebar: { refresh: async function () {} },
    settingsTab: { close: function () {} },
  });
  await sleep(80);
  return { mod: m };
}

test('点订阅按钮两次：第二次不弹添加账号界面', async function () {
  const calls = { formOpen: 0, subsOpen: 0 };
  const ctx = await initCase(calls);
  await ctx.mod.tabbar.openSubscriptionsTab();
  await sleep(100);
  assert.strictEqual(calls.subsOpen, 1, '第一次应打开订阅');
  assert.strictEqual(calls.formOpen, 0, '第一次不应触发 form open');
  await ctx.mod.tabbar.openSubscriptionsTab();
  await sleep(100);
  assert.strictEqual(calls.subsOpen, 2, '第二次应聚焦订阅（再调一次 open）');
  assert.strictEqual(calls.formOpen, 0, '第二次绝对不能触发 form open（历史 bug）');
});
