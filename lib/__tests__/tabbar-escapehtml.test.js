// lib/__tests__/tabbar-escapehtml.test.js - tab 名 HTML 转义回归测试
// 历史 bug：escapeHtml 三元两支都写 "" 导致 tab 名永远渲染为空。
// 原为按行号抽取 escapeHtml 源码的 vm hack，tabbar.js 重构后失效；
// 改为加载整个 tabbar.js 的 DOM 测试：恶意账号名进 store，断言渲染结果被转义。
// 运行：node --test lib/__tests__/tabbar-escapehtml.test.js
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
  const store = makeStore();
  const root = { _html: '', get innerHTML() { return this._html; }, set innerHTML(v) { this._html = v; }, querySelectorAll: function () { return []; } };
  const sandbox = {
    document: { getElementById: function (id) { return id === 'tabbar' ? root : { addEventListener: function () {} }; } },
    window: {
      mwiStore: store,
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
    },
    console: { log: function () {}, error: function () {}, warn: function () {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { store: store, root: root };
}

function renderGameTab(accountName) {
  const ctx = buildSandbox();
  ctx.store.set({ accounts: [{ id: 'a1', name: accountName }], runningIds: ['a1'] });
  return ctx.root._html;
}

test('tab 名正常字符串原样渲染（回归：三元两支都写 "" 导致永远返回空）', function () {
  assert.ok(renderGameTab('hello').indexOf('>hello<') !== -1);
  assert.ok(renderGameTab('订阅管理').indexOf('>订阅管理<') !== -1);
  assert.ok(renderGameTab('添加账号').indexOf('>添加账号<') !== -1);
});

test('tab 名特殊字符被转义', function () {
  const html = renderGameTab('<x>');
  assert.ok(html.indexOf('&lt;x&gt;') !== -1, '尖括号应转义');
  assert.ok(html.indexOf('<x>') === -1, '原始标签不应出现在 HTML 中');
  assert.ok(renderGameTab('a&b').indexOf('a&amp;b') !== -1, '& 应转义');
  assert.ok(renderGameTab('a"b').indexOf('a&quot;b') !== -1, '" 应转义');
  assert.ok(renderGameTab("a'b").indexOf('a&#39;b') !== -1, "' 应转义");
});

test('tab 名为空时回落到账号 id（escapeHtml null 安全）', function () {
  const ctx = buildSandbox();
  ctx.store.set({ accounts: [{ id: 'a1', name: '' }], runningIds: ['a1'] });
  assert.ok(ctx.root._html.indexOf('>a1<') !== -1, '空名应回落渲染账号 id');
});
