// lib/__tests__/tabbar-subscriptions-resume.test.js - 回归：点订阅按钮第二次必须调 focusSubscriptionsTab 而不是 focusFormTab
// 历史 bug：openSubscriptionsTab 第二次调用时调 focusFormTab 错误地弹添加账号界面
// 运行：node --test lib/__tests__/tabbar-subscriptions-resume.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'js', 'tabbar.js'), 'utf8');

function buildSandbox() {
  const calls = { formOpen: 0, subsOpen: 0 };
  const root = { _html: '', get innerHTML() { return this._html; }, set innerHTML(v) { this._html = v; }, querySelectorAll: function () { return []; } };
  const sandbox = {
    document: { getElementById: function (id) { return id === 'tabbar' ? root : { addEventListener: function () {} }; } },
    window: {
      mwiStore: {
        get: function () { return { accounts: [], groups: [], focusedAccountId: null, runningIds: [], viewStates: {} }; },
        set: function (patch) { Object.assign(this, patch); },
        subscribe: function (cb) { return function () {}; },
      },
      mwiAccountForm: { open: async function () { calls.formOpen += 1; }, close: function () {} },
      mwiSubscriptionsTab: { open: async function () { calls.subsOpen += 1; }, close: function () {} },
      mwiSidebar: { refresh: async function () {} },
      api: {
        views: { focus: function () { return Promise.resolve(); }, listRunning: function () { return Promise.resolve([]); }, getState: function () { return Promise.resolve('stopped'); }, onStateChanged: function () {}, onFocusChanged: function () {} },
        canvas: { hideFocused: function () { return Promise.resolve(true); }, resumeFocused: function () { return Promise.resolve(true); }, isFocusedHidden: function () { return Promise.resolve(false); } },
      },
    },
    console: { log: function () {}, error: function () {}, warn: function () {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { sandbox: sandbox, calls: calls };
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

test('点订阅按钮两次：第二次不弹添加账号界面', async function () {
  const ctx = buildSandbox();
  await sleep(80);
  await ctx.sandbox.window.mwiTabbar.openSubscriptionsTab();
  await sleep(100);
  assert.strictEqual(ctx.calls.subsOpen, 1, '第一次应打开订阅');
  assert.strictEqual(ctx.calls.formOpen, 0, '第一次不应触发 form open');
  await ctx.sandbox.window.mwiTabbar.openSubscriptionsTab();
  await sleep(100);
  assert.strictEqual(ctx.calls.subsOpen, 2, '第二次应聚焦订阅（再调一次 open）');
  assert.strictEqual(ctx.calls.formOpen, 0, '第二次绝对不能触发 form open（历史 bug）');
});
