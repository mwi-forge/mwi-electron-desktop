// lib/__tests__/sidebar.dom.test.js - sidebar.js 状态点三态 + 点击切换视图 DOM 测试
// vm 沙箱 + mock DOM 验证：灰/绿/红三态渲染、点击运行中账号触发 views.focus、
// 点击停止账号不触发 focus。运行：node --test lib/__tests__/sidebar.dom.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'js', 'sidebar.js'), 'utf8');

function makeStore(initial) {
  const state = Object.assign({ accounts: [], groups: [], focusedAccountId: null, runningIds: [], viewStates: {} }, initial || {});
  const subs = new Set();
  return {
    get: function () { return state; },
    set: function (patch) { Object.assign(state, patch); subs.forEach(function (cb) { try { cb(state); } catch (e) {} }); },
    subscribe: function (cb) { subs.add(cb); return function () { subs.delete(cb); }; },
  };
}

function buildSandbox(accounts, viewStates) {
  const store = makeStore({ accounts: accounts, groups: [{ id: 'grp_default', name: '默认分组', order: 0, collapsed: false }], runningIds: accounts.filter(function (a) { return viewStates[a.id] === 'running'; }).map(function (a) { return a.id; }), viewStates: viewStates });
  const focusCalls = [];
  const accountHandlers = {};

  const root = {
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; },
    querySelectorAll: function (sel) {
      if (sel === '.account') {
        const out = [];
        accounts.forEach(function (a) {
          const el = {
            dataset: { accountId: a.id },
            addEventListener: function (ev, fn) { accountHandlers[a.id] = fn; },
          };
          out.push(el);
        });
        return out;
      }
      return [];
    },
  };
  const stub = { addEventListener: function () {}, querySelector: function () { return null; } };
  const document = { getElementById: function (id) { return id === 'sidebar-groups' ? root : stub; } };
  // i18n 重构后状态点 title 走 window.mwiI18n.t()，sandbox 里补最小映射
  const I18N = {
    'sidebar.status.running': '运行中',
    'sidebar.status.stopped': '已停止',
    'sidebar.status.error': '错误',
  };
  const sandbox = {
    document: document,
    window: {
      mwiI18n: { t: function (k) { return I18N[k] || k; }, onChange: function () {} },
      mwiStore: store,
      api: {
        accounts: { list: function () { return Promise.resolve(accounts); }, remove: function () { return Promise.resolve(); } },
        groups: { list: function () { return Promise.resolve([{ id: 'grp_default', name: '默认分组', order: 0, collapsed: false }]); }, update: function () { return Promise.resolve(); } },
        views: { focus: function (id) { focusCalls.push(id); return Promise.resolve(); } },
        fingerprint: { listPresets: function () { return Promise.resolve([]); } },
      },
    },
    console: { log: function () {}, error: function () {}, warn: function () {} },
    alert: function () {},
    confirm: function () { return false; },
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { store: store, root: root, focusCalls: focusCalls, accountHandlers: accountHandlers };
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

test('状态点三态渲染：灰停止 / 绿运行 / 红错误', async function () {
  const accs = [
    { id: 'a1', name: '账号一', groupId: 'grp_default' },
    { id: 'a2', name: '账号二', groupId: 'grp_default' },
    { id: 'a3', name: '账号三', groupId: 'grp_default' },
  ];
  const ctx = buildSandbox(accs, { a1: 'running', a2: 'stopped', a3: 'error:load_failed:-100' });
  await sleep(80); // 等初始 refresh 完成触发 render
  const html = ctx.root._html;
  assert.ok(html.indexOf('account__dot account__dot--running') !== -1, '运行中账号应渲染绿色状态点');
  assert.ok(html.indexOf('account__dot account__dot--stopped') !== -1, '停止账号应渲染灰色状态点');
  assert.ok(html.indexOf('account__dot account__dot--error') !== -1, '错误账号应渲染红色状态点');
  assert.ok(html.indexOf('title="运行中"') !== -1, '运行中点 title 应为运行中');
  assert.ok(html.indexOf('title="已停止"') !== -1, '停止点 title 应为已停止');
  assert.ok(html.indexOf('title="错误"') !== -1, '错误点 title 应为错误');
});

test('点击运行中账号：更新选中并调用 views.focus 切换中间视图', async function () {
  const accs = [{ id: 'a1', name: '账号一', groupId: 'grp_default' }];
  const ctx = buildSandbox(accs, { a1: 'running' });
  await sleep(80);
  ctx.accountHandlers['a1']({ target: { closest: function () { return null; } } });
  assert.strictEqual(ctx.store.get().focusedAccountId, 'a1');
  assert.deepStrictEqual(ctx.focusCalls, ['a1'], '运行中账号点击应触发 views.focus');
});

test('点击停止账号：更新选中但不调用 views.focus', async function () {
  const accs = [{ id: 'a2', name: '账号二', groupId: 'grp_default' }];
  const ctx = buildSandbox(accs, { a2: 'stopped' });
  await sleep(80);
  ctx.accountHandlers['a2']({ target: { closest: function () { return null; } } });
  assert.strictEqual(ctx.store.get().focusedAccountId, 'a2');
  assert.deepStrictEqual(ctx.focusCalls, [], '停止账号点击不应触发 views.focus');
});
