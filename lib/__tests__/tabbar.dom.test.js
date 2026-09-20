// lib/__tests__/tabbar.dom.test.js - tabbar 静态 tab 互切测试
// 回归保护：订阅管理 tab 打开时点击「添加账号」，必须先关闭订阅挂载层再打开表单
//（历史 bug：只关 accountForm 不关 subscriptionsTab，订阅层盖在表单层之上）
// 渲染层 ESM 化后改为：globalThis mock + 动态 import + initTabbar(deps) 注入
// 运行：node --test lib/__tests__/tabbar.dom.test.js
const { test } = require('node:test');
const assert = require('node:assert');

let modPromise = null;
function loadTabbar() {
  if (!modPromise) modPromise = import('../../src/js/tabbar.js');
  return modPromise;
}

function makeStore() {
  const state = { accounts: [], groups: [], focusedAccountId: null, runningIds: [], viewStates: {} };
  const subs = new Set();
  return {
    get: function () { return state; },
    set: function (patch) { Object.assign(state, patch); subs.forEach(function (cb) { try { cb(state); } catch (e) {} }); },
    subscribe: function (cb) { subs.add(cb); return function () { subs.delete(cb); }; },
  };
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// 每轮 test 全新 globalThis mock + initTabbar(deps)：模块单例，init 重置 formTabs/activeTabId 等状态
async function initCase(calls) {
  const m = await loadTabbar();
  const store = makeStore();
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
        hideFocused: function () { calls.hide += 1; return Promise.resolve(true); },
        resumeFocused: function () { calls.resume += 1; return Promise.resolve(true); },
        isFocusedHidden: function () { return Promise.resolve(false); },
      },
    },
  };
  m.initTabbar({
    store: store,
    accountForm: { open: async function () { calls.formOpen += 1; }, close: function () { calls.formClose += 1; } },
    subscriptionsTab: { open: async function () { calls.subsOpen += 1; }, close: function () { calls.subsClose += 1; } },
    sidebar: { refresh: async function () {} },
    settingsTab: { close: function () {} },
  });
  await sleep(80);
  return { mod: m, store: store, root: root };
}

test('订阅 tab 打开时点添加账号：先关订阅层再开表单层', async function () {
  const calls = { formOpen: 0, formClose: 0, subsOpen: 0, subsClose: 0, hide: 0, resume: 0 };
  const ctx = await initCase(calls);
  await ctx.mod.tabbar.openSubscriptionsTab();
  assert.strictEqual(calls.subsOpen, 1, '订阅层应打开');
  await ctx.mod.tabbar.openFormTab(false, null);
  assert.strictEqual(calls.subsClose, 1, '切到添加账号表单时必须关闭订阅层');
  assert.strictEqual(calls.formOpen, 1, '添加账号表单应打开');
  var active = ctx.mod.tabbar.getActiveTabId();
  assert.ok(active.indexOf('account-form:new:') === 0, 'active tab 应切换为新建表单 tab');
});

test('表单打开时切到订阅 tab：先关表单层再开订阅层', async function () {
  const calls = { formOpen: 0, formClose: 0, subsOpen: 0, subsClose: 0, hide: 0, resume: 0 };
  const ctx = await initCase(calls);
  await ctx.mod.tabbar.openFormTab(false, null);
  assert.strictEqual(calls.formOpen, 1, '表单应打开');
  await ctx.mod.tabbar.openSubscriptionsTab();
  assert.strictEqual(calls.formClose, 1, '切到订阅时必须关闭表单层');
  assert.strictEqual(calls.subsOpen, 1, '订阅层应打开');
  assert.strictEqual(ctx.mod.tabbar.getActiveTabId(), 'proxy-subscriptions', 'active tab 应为订阅管理');
});

test('订阅打开时再点添加账号两次：表单打开且订阅层保持关闭', async function () {
  const calls = { formOpen: 0, formClose: 0, subsOpen: 0, subsClose: 0, hide: 0, resume: 0 };
  const ctx = await initCase(calls);
  await ctx.mod.tabbar.openSubscriptionsTab();
  await ctx.mod.tabbar.openFormTab(false, null);
  await ctx.mod.tabbar.openFormTab(false, null);
  assert.strictEqual(calls.subsClose, 1, '订阅层应保持关闭（只关一次）');
  assert.strictEqual(calls.formOpen, 1, '去重：两次点添加账号只 open 一次（修复 tab 重复 bug）');
});
