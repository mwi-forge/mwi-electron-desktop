// lib/__tests__/tabbar-form-dedupe.test.js - 回归：点「添加账号」多次不应重复 tab
// 历史 bug：openFormTab 用 Date.now() 生成 id 导致 findFormTab(id) 永不命中，每次点按钮都 push 新 tab
// 运行：node --test lib/__tests__/tabbar-form-dedupe.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'js', 'tabbar.js'), 'utf8');

function buildSandbox() {
  let formTabs = [];
  const calls = { formOpen: 0, subsOpen: 0, render: 0 };
  const root = { _html: '', get innerHTML() { return this._html; }, set innerHTML(v) { calls.render += 1; this._html = v; }, querySelectorAll: function () { return []; } };
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
  // 劫持 push 来记录 formTabs 增长（IIFE 闭包无法直接读 formTabs，但 render 被劫持可观察 push 次数）
  // 实际验证：观察调用 openFormTab 多次后 mwiAccountForm.open 被调次数——去重前 = N，去重后 = 1
  return { sandbox: sandbox, calls: calls };
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

test('点「添加账号」按钮多次：只触发一次 formOpen（去重）', async function () {
  const ctx = buildSandbox();
  await sleep(80);
  await ctx.sandbox.window.mwiTabbar.openFormTab(false, null);
  await sleep(100);
  assert.strictEqual(ctx.calls.formOpen, 1, '第一次应打开');
  await ctx.sandbox.window.mwiTabbar.openFormTab(false, null);
  await sleep(100);
  assert.strictEqual(ctx.calls.formOpen, 1, '第二次点应去重，不重复 open（修复前会变 2）');
  await ctx.sandbox.window.mwiTabbar.openFormTab(false, null);
  await sleep(100);
  assert.strictEqual(ctx.calls.formOpen, 1, '第三次点也应去重');
});

test('点编辑同一账号多次：只触发一次 formOpen', async function () {
  const ctx = buildSandbox();
  await sleep(80);
  const acc = { id: 'acc_001', name: '主号' };
  await ctx.sandbox.window.mwiTabbar.openFormTab(true, acc);
  await sleep(100);
  assert.strictEqual(ctx.calls.formOpen, 1, '编辑首次应 open');
  await ctx.sandbox.window.mwiTabbar.openFormTab(true, acc);
  await sleep(100);
  assert.strictEqual(ctx.calls.formOpen, 1, '编辑同一账号第二次应去重');
});

test('非编辑新建与编辑同一账号互不冲突（不同 id 路径）', async function () {
  const ctx = buildSandbox();
  await sleep(80);
  await ctx.sandbox.window.mwiTabbar.openFormTab(false, null);
  await sleep(100);
  await ctx.sandbox.window.mwiTabbar.openFormTab(true, { id: 'acc_001', name: 'X' });
  await sleep(100);
  assert.strictEqual(ctx.calls.formOpen, 2, '新建 + 编辑不同 id 路径都应 open');
});
