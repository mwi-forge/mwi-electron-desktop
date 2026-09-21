// lib/__tests__/ipc-diagnostics-export.test.js - diagnostics:export handler 路径测试
// 覆盖三条分支：导出成功（真写 tmp 文件）/ 用户取消 / 写失败。
// 复用 ipc-subscriptions-delete.test.js 的 Module._load 拦截模式
// （electron / electron-store 内存 stub，不引新依赖）。
// 运行：node --test lib/__tests__/ipc-diagnostics-export.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

const handlers = {};

// showSaveDialog 结果由用例注入
let saveDialogResult = { canceled: true };
const electronMock = {
  ipcMain: { handle: function (ch, fn) { handlers[ch] = fn; }, on: function () {} },
  app: { getVersion: function () { return '0.0.0-test'; }, getPath: function () { return '/tmp'; } },
  dialog: { showSaveDialog: async function () { return saveDialogResult; } },
  BrowserWindow: { getFocusedWindow: function () { return null; } },
};

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

const logsStub = { listAll: function () { return { app: [{ timestamp: 1, level: 'warn', message: 'x at 1.2.3.4' }] }; } };

// 诊断包日志文件内容（含待脱敏 IP）
const logWriterStub = {
  readRecentFiles: function () { return [{ file: 'main-20260921.log', content: 'via 8.8.8.8' }]; },
};

const noop = function () {};
const noopModule = new Proxy({}, { get: function () { return noop; } });

const origLoad = Module._load;
Module._load = function (request, parent) {
  if (request === 'electron') return electronMock;
  if (request === 'electron-store') return FakeStore;
  const from = ((parent && parent.filename) || '').split('\\').join('/');
  if (/\/lib\/ipc\.js$/.test(from)) {
    if (request === 'fs') return origLoad.apply(this, arguments); // 真文件系统：导出要真写 tmp 文件
    if (request === './logs') return logsStub;
    if (request === './accounts' || request === './subscriptions') return origLoad.apply(this, arguments);
    if (request === './diagnostics') return origLoad.apply(this, arguments);
    return noopModule;
  }
  return origLoad.apply(this, arguments);
};

before(function () {
  globalThis.__logWriter = logWriterStub;
  require('../ipc').register();
});
after(function () {
  Module._load = origLoad;
  delete globalThis.__logWriter;
});

test('成功路径：写文件到对话框路径，JSON 含 meta 与脱敏日志', async function () {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mwi-diag-')), 'diag.json');
  saveDialogResult = { canceled: false, filePath: out };
  const r = await handlers['diagnostics:export']();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.path, out);
  const snap = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.strictEqual(snap.meta.appVersion, '0.0.0-test');
  assert.match(snap.ringLogs.app[0].message, /<ip>/);
  assert.ok(snap.logFiles[0].content.indexOf('8.8.8.8') < 0, '日志文件 IP 脱敏');
  fs.rmSync(path.dirname(out), { recursive: true, force: true });
});

test('取消路径：canceled=true，不写任何文件', async function () {
  saveDialogResult = { canceled: true };
  const r = await handlers['diagnostics:export']();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.canceled, true);
});

test('写失败路径：目录不存在返回 write_failed，不抛异常', async function () {
  saveDialogResult = { canceled: false, filePath: '/nonexistent-dir-xyz/mwi-diag.json' };
  const r = await handlers['diagnostics:export']();
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /^write_failed/);
});
