// lib/__tests__/ipc-subscriptions-delete.test.js - subscriptions:delete 级联路径测试
// 线上 bug 回归：lib/ipc.js 删除订阅后级联调 accounts.saveAll()，而 accounts.js 此前
// 未导出该方法，TypeError 被 catch 导致 subscriptions:delete 返回失败、账号 proxy 未重置。
// 这里用真实 lib/accounts.js + lib/ipc.js 跑通整条级联，electron / electron-store 以内存
// stub 替代（不引新依赖，仅拦截 Module._load）。
// 运行：node --test lib/__tests__/ipc-subscriptions-delete.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const Module = require('module');

const handlers = {};
let deletedSubId = null;

const electronMock = {
  ipcMain: { handle: function (ch, fn) { handlers[ch] = fn; }, on: function () {} },
  app: { getVersion: function () { return '0.0.0-test'; }, getPath: function () { return '/tmp'; } },
  BrowserWindow: { getFocusedWindow: function () { return null; } },
};

// 内存版 electron-store：应用 schema default，get/set 走内存
class FakeStore {
  constructor(opts) {
    this.name = (opts && opts.name) || 'store';
    this._data = {};
    const schema = (opts && opts.schema) || {};
    for (const k of Object.keys(schema)) {
      if (schema[k] && Object.prototype.hasOwnProperty.call(schema[k], 'default')) {
        this._data[k] = JSON.parse(JSON.stringify(schema[k].default));
      }
    }
  }
  get path() { return '/tmp/fake-' + this.name + '.json'; }
  get(key) { return this._data[key]; }
  set(key, value) { this._data[key] = value; }
}

const safeStorageMock = {
  isAvailable: function () { return false; },
  encrypt: function () { throw new Error('safeStorage unavailable in test'); },
  decrypt: function () { throw new Error('safeStorage unavailable in test'); },
};

const subsMock = {
  deleteSubscription: function (id) { deletedSubId = id; },
};

const noop = function () {};
const noopModule = new Proxy({}, { get: function () { return noop; } });

const origLoad = Module._load;
Module._load = function (request, parent) {
  if (request === 'electron') return electronMock;
  if (request === 'electron-store') return FakeStore;
  const from = (parent && parent.filename) || '';
  if (request === './safe-storage' && /\/lib\/accounts\.js$/.test(from)) return safeStorageMock;
  if (/\/lib\/ipc\.js$/.test(from)) {
    if (request === './subscriptions') return subsMock;
    if (request === './accounts') return origLoad.apply(this, arguments);
    // views / logs / metrics / proxy / fingerprint / tampermonkey / socks-gateway / i18n / alert
    return noopModule;
  }
  return origLoad.apply(this, arguments);
};

let accounts;
let ipc;
before(function () {
  accounts = require('../accounts');
  ipc = require('../ipc');
  ipc.register();
});
after(function () {
  Module._load = origLoad;
});

test('accounts.js 导出 saveAll（回归：ipc.js 调用 accounts.saveAll 抛 TypeError）', function () {
  assert.strictEqual(typeof accounts.saveAll, 'function');
});

test('saveAll 整表覆写并持久化', function () {
  const a = accounts.createAccount({ name: 'tmp', url: 'https://example.com' });
  assert.ok(accounts.getAccount(a.id));
  const remaining = accounts.listAccounts().filter(function (x) { return x.id !== a.id; });
  accounts.saveAll(remaining);
  assert.strictEqual(accounts.getAccount(a.id), null, 'saveAll 后该账号应不存在');
});

test('subscriptions:delete 级联重置引用账号 proxy 为 null', async function () {
  const a1 = accounts.createAccount({
    name: '引用sub1', url: 'https://a1.example.com',
    proxy: { source: 'subscription', subscriptionId: 'sub1', nodeId: 'n1' },
  });
  const a2 = accounts.createAccount({
    name: '引用sub2', url: 'https://a2.example.com',
    proxy: { source: 'subscription', subscriptionId: 'sub2', nodeId: 'n2' },
  });

  const res = await handlers['subscriptions:delete']({}, 'sub1');

  assert.deepStrictEqual(res, { ok: true }, '删除应返回成功（修复前因 saveAll 缺失返回失败）');
  assert.strictEqual(deletedSubId, 'sub1');
  assert.strictEqual(accounts.getAccount(a1.id).proxy, null, '引用被删订阅的账号 proxy 应重置为 null');
  assert.strictEqual(accounts.getAccount(a2.id).proxy.subscriptionId, 'sub2', '引用其它订阅的账号不受影响');

  accounts.removeAccount(a1.id);
  accounts.removeAccount(a2.id);
});
