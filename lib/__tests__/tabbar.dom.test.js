// lib/__tests__/tabbar.dom.test.js - tabbar 静态 tab 互切测试
// 回归保护：订阅管理 tab 打开时点击「添加账号」，必须先关闭订阅挂载层再打开表单
//（历史 bug：只关 accountForm 不关 subscriptionsTab，订阅层盖在表单层之上）
// 运行：node --test lib/__tests__/tabbar.dom.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'js', 'tabbar.js'), 'utf8');

function makeStore() {
  const state = { accounts: [], groups: [], focusedAccountId: null, runningIds: [], viewStates: {} };
  const subs = new Set();
  return {
    get: function () { return state; },
    set: function (patch) { Object.assign(state, patch); subs.forEach(function (cb) { try { cb(state); } catch (e) {} }); },
    subscribe: function (cb) { subs.add(cb); return function () { subs.delete(cb); }; },
  };
}

function buildSandbox() {
  const calls = { formOpen: 0, formClose: 0, subsOpen: 0, subsClose: 0, hide: 0, resume: 0 };
  const root = { _html: '', get innerHTML() { return this._html; }, set innerHTML(v) { this._html = v; }, querySelectorAll: function () { return []; } };
  const apiViews = {};
  const sandbox = {
    document: { getElementById: function (id) { return id === 'tabbar' ? root : { addEventListener: function () {} }; } },
    window: {
      mwiStore: makeStore(),
      mwiAccountForm: {
        open: async function () { calls.formOpen += 1; },
        close: function () { calls.formClose += 1; },
      },
      mwiSubscriptionsTab: {
        open: async function () { calls.subsOpen += 1; },
        close: function () { calls.subsClose += 1; },
      },
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
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { sandbox: sandbox, calls: calls };
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

test('订阅 tab 打开时点添加账号：先关订阅层再开表单层', async function () {
  const ctx = buildSandbox();
  await sleep(80);
  await ctx.sandbox.window.mwiTabbar.openSubscriptionsTab();
  assert.strictEqual(ctx.calls.subsOpen, 1, '订阅层应打开');
  await ctx.sandbox.window.mwiTabbar.openFormTab(false, null);
  assert.strictEqual(ctx.calls.subsClose, 1, '切到添加账号表单时必须关闭订阅层');
  assert.strictEqual(ctx.calls.formOpen, 1, '添加账号表单应打开');
  var active = ctx.sandbox.window.mwiTabbar.getActiveTabId();
  assert.ok(active.indexOf('account-form:new:') === 0, 'active tab 应切换为新建表单 tab');
});

test('表单打开时切到订阅 tab：先关表单层再开订阅层', async function () {
  const ctx = buildSandbox();
  await sleep(80);
  await ctx.sandbox.window.mwiTabbar.openFormTab(false, null);
  assert.strictEqual(ctx.calls.formOpen, 1, '表单应打开');
  await ctx.sandbox.window.mwiTabbar.openSubscriptionsTab();
  assert.strictEqual(ctx.calls.formClose, 1, '切到订阅时必须关闭表单层');
  assert.strictEqual(ctx.calls.subsOpen, 1, '订阅层应打开');
  assert.strictEqual(ctx.sandbox.window.mwiTabbar.getActiveTabId(), 'proxy-subscriptions', 'active tab 应为订阅管理');
});

test('订阅打开时再点添加账号两次：表单打开且订阅层保持关闭', async function () {
  const ctx = buildSandbox();
  await sleep(80);
  await ctx.sandbox.window.mwiTabbar.openSubscriptionsTab();
  await ctx.sandbox.window.mwiTabbar.openFormTab(false, null);
  await ctx.sandbox.window.mwiTabbar.openFormTab(false, null);
  assert.strictEqual(ctx.calls.subsClose, 1, '订阅层应保持关闭（只关一次）');
  assert.strictEqual(ctx.calls.formOpen, 1, '去重：两次点添加账号只 open 一次（修复 tab 重复 bug）');
});
