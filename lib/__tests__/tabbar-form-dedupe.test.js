// lib/__tests__/tabbar-form-dedupe.test.js - 回归：点「添加账号」多次不应重复 tab
// 历史 bug：openFormTab 用 Date.now() 生成 id 导致 findFormTab(id) 永不命中，每次点按钮都 push 新 tab
// 渲染层 ESM 化后改为：globalThis mock + 动态 import + initTabbar(deps) 注入
// 运行：node --test lib/__tests__/tabbar-form-dedupe.test.js
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

test('点「添加账号」按钮多次：只触发一次 formOpen（去重）', async function () {
  const calls = { formOpen: 0, subsOpen: 0, render: 0 };
  const ctx = await initCase(calls);
  await ctx.mod.tabbar.openFormTab(false, null);
  await sleep(100);
  assert.strictEqual(calls.formOpen, 1, '第一次应打开');
  await ctx.mod.tabbar.openFormTab(false, null);
  await sleep(100);
  assert.strictEqual(calls.formOpen, 1, '第二次点应去重，不重复 open（修复前会变 2）');
  await ctx.mod.tabbar.openFormTab(false, null);
  await sleep(100);
  assert.strictEqual(calls.formOpen, 1, '第三次点也应去重');
});

test('点编辑同一账号多次：只触发一次 formOpen', async function () {
  const calls = { formOpen: 0, subsOpen: 0, render: 0 };
  const ctx = await initCase(calls);
  const acc = { id: 'acc_001', name: '主号' };
  await ctx.mod.tabbar.openFormTab(true, acc);
  await sleep(100);
  assert.strictEqual(calls.formOpen, 1, '编辑首次应 open');
  await ctx.mod.tabbar.openFormTab(true, acc);
  await sleep(100);
  assert.strictEqual(calls.formOpen, 1, '编辑同一账号第二次应去重');
});

test('非编辑新建与编辑同一账号互不冲突（不同 id 路径）', async function () {
  const calls = { formOpen: 0, subsOpen: 0, render: 0 };
  const ctx = await initCase(calls);
  await ctx.mod.tabbar.openFormTab(false, null);
  await sleep(100);
  await ctx.mod.tabbar.openFormTab(true, { id: 'acc_001', name: 'X' });
  await sleep(100);
  assert.strictEqual(calls.formOpen, 2, '新建 + 编辑不同 id 路径都应 open');
});
