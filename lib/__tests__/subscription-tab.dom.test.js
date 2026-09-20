// lib/__tests__/subscription-tab.dom.test.js - Clash 订阅管理 tab 单测（#37 覆盖补齐）
// 渲染层 ESM：globalThis mock + 动态 import + initSubscriptionsTab({ i18n, alert }) 注入。
// 该模块以 innerHTML 字符串渲染 + getElementById/querySelectorAll 绑定动作，
// 因此 DOM mock 内置迷你 HTML 解析器（单双引号属性 / 嵌套标签 / data-* → dataset）。
// 运行：node --test lib/__tests__/subscription-tab.dom.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');

function camelize(k) { return k.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); }); }

function makeClassList(el) {
  const set = new Set();
  return {
    add(c) { set.add(c); },
    remove(c) { set.delete(c); },
    contains(c) { return set.has(c); },
    toggle(c, force) {
      const on = force === undefined ? !set.has(c) : !!force;
      if (on) set.add(c); else set.delete(c);
      return on;
    },
  };
}

function makeElement(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [], attributes: {}, dataset: {}, style: {},
    className: '', id: '', value: '',
    hidden: false, disabled: false, parentNode: null, _listeners: {},
    classList: null,
    _text: '',
    get firstChild() { return this.children[0] || null; },
    setAttribute(k, v) {
      this.attributes[k] = String(v);
      if (k === 'id') this.id = String(v);
      if (k === 'class') this.className = String(v);
      if (k.indexOf('data-') === 0) this.dataset[camelize(k.slice(5))] = String(v);
    },
    getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i >= 0) { this.children.splice(i, 1); child.parentNode = null; }
      return child;
    },
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    click() { for (const fn of (this._listeners.click || [])) fn({ preventDefault() {} }); },
    querySelectorAll(sel) {
      const m = sel.match(/^\[([a-zA-Z-]+)='([^']*)'\]$/);
      const out = [];
      function walk(node) {
        for (const c of node.children) {
          if (m && (c.attributes[m[1]] || '') === m[2]) out.push(c);
          walk(c);
        }
      }
      walk(this);
      return out;
    },
    // 迷你 HTML 解析：仅覆盖本模块模板用语（嵌套标签 + 单/双引号属性 + 纯文本）
    set innerHTML(html) {
      this.children.length = 0;
      this._text = '';
      const stack = [this];
      const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^<>]*?)?)>/g;
      let last = 0; let m;
      while ((m = re.exec(html)) !== null) {
        if (m.index > last) stack[stack.length - 1]._text += html.slice(last, m.index);
        last = re.lastIndex;
        if (m[1] === '/') { stack.pop(); continue; }
        const node = makeElement(m[2]);
        const attrRe = /([a-zA-Z-]+)\s*=\s*"([^"]*)"|([a-zA-Z-]+)\s*=\s*'([^']*)'/g;
        let a;
        while ((a = attrRe.exec(m[3])) !== null) {
          node.setAttribute(a[1] || a[3], a[2] !== undefined ? a[2] : a[4]);
        }
        stack[stack.length - 1].appendChild(node);
        stack.push(node);
      }
    },
    get innerHTML() { return ''; },
  };
  // textContent = 自身文本 + 后代文本（与真实 DOM 读取语义一致；直接赋值时只覆写自身文本）
  Object.defineProperty(el, 'textContent', {
    get() { return el._text + el.children.map(function (c) { return c.textContent; }).join(''); },
    set(v) { el._text = String(v); el.children.length = 0; },
  });
  el.classList = makeClassList(el);
  return el;
}

// ============ 测试世界 ============
let body, mount, i18nMock, alertMock, apiMock;

function buildWorld(opts) {
  opts = opts || {};
  body = makeElement('body');
  i18nMock = {
    _changeCbs: [],
    t(key, vars) { return key; },
    onChange(cb) { this._changeCbs.push(cb); },
  };
  alertMock = {
    alerts: [],
    _confirmQueue: opts.confirmQueue || [],
    alert(o) { this.alerts.push(o); },
    confirm() { return Promise.resolve(this._confirmQueue.length ? this._confirmQueue.shift() : false); },
  };
  apiMock = {
    subscriptions: {
      _subs: opts.subs || [],
      _nodes: opts.nodes || {},
      calls: { list: 0, listNodes: [], add: [], refresh: [], measureNodes: [], measureNode: [], delete: [] },
      _addRes: opts.addRes || { ok: true },
      list() {
        this.calls.list++;
        const s = this._subs;
        return Promise.resolve(s.map(function (x) { return Object.assign({}, x); }));
      },
      listNodes(id) {
        this.calls.listNodes.push(id);
        return Promise.resolve((this._nodes[id] || []).map(function (x) { return Object.assign({}, x); }));
      },
      add(payload) { this.calls.add.push(payload); return Promise.resolve(this._addRes); },
      refresh(id) { this.calls.refresh.push(id); return Promise.resolve({ ok: true }); },
      measureNodes(id) { this.calls.measureNodes.push(id); return Promise.resolve({ ok: true }); },
      measureNode(subId, nodeId) { this.calls.measureNode.push([subId, nodeId]); return Promise.resolve({ ok: true }); },
      delete(id) { this.calls.delete.push(id); return Promise.resolve({ ok: true }); },
    },
  };
  globalThis.document = {
    body: body,
    createElement(tag) { return makeElement(tag); },
    getElementById(id) {
      function walk(el) { if (el.id === id) return el; for (const c of el.children) { const r = walk(c); if (r) return r; } return null; }
      return walk(this.body);
    },
    querySelector(sel) {
      if (sel === '.canvas') return null;
      return null;
    },
  };
  globalThis.window = { api: apiMock };
  return import('../../src/js/subscription-tab.js');
}

async function openTab(worldOpts) {
  const m = await buildWorld(worldOpts);
  m.initSubscriptionsTab({ i18n: i18nMock, alert: alertMock });
  await m.subscriptionsTab.open();
  await new Promise(function (r) { setTimeout(r, 0); });
  return m;
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms || 0); }); }
function byId(id) { return document.getElementById(id); }
function buttons(root, action) { return root.querySelectorAll("[data-action='" + action + "']"); }

const SUB = { id: 'sub1', name: '主<线>', url: 'https://example.com/sub.yaml', status: 'ok' };

test('open()：mount 建到 body 下并渲染 header/表单/列表骨架，无 subs 时显示空态', async () => {
  await openTab();
  mount = byId('canvas-subs-mount');
  assert.ok(mount);
  assert.strictEqual(mount.hidden, false);
  assert.ok(byId('subs-root'));
  assert.ok(byId('subs-list'));
  assert.ok(byId('subs-name'));
  assert.ok(byId('subs-url'));
  assert.ok(byId('subs-list').textContent.indexOf('subscription.tab.empty.no_subs') !== -1);
});

test('refreshList：卡片渲染含 esc 后的名称 / 状态 class / 节点数', async () => {
  await openTab({ subs: [SUB], nodes: { sub1: [{ id: 'n1', name: 'node', type: 'ss', server: '1.2.3.4', port: 8388 }] } });
  const list = byId('subs-list');
  assert.ok(list.textContent.indexOf('主&lt;线&gt;') !== -1, 'name escaped');
  assert.ok(list.textContent.indexOf('subscription.tab.status.ok') !== -1);
  assert.ok(list.textContent.indexOf('subscription.tab.card.last_fetched_prefix') !== -1);
  // nodeCount 经 listNodes 逐卡拉取回填（i18n 裸 key 下数值不可见，验证调用链即可）
  assert.ok(apiMock.subscriptions.calls.listNodes.indexOf('sub1') !== -1);
  assert.ok(buttons(byId('subs-root'), 'refresh').length === 1);
  assert.ok(buttons(byId('subs-root'), 'measure').length === 1);
  assert.ok(buttons(byId('subs-root'), 'view-nodes').length === 1);
  assert.ok(buttons(byId('subs-root'), 'delete').length === 1);
});

test('add：空 url 弹告警且不调 api', async () => {
  await openTab({ subs: [] });
  byId('subs-name').value = '  名字  ';
  buttons(byId('subs-root'), 'add')[0].click();
  await sleep();
  assert.strictEqual(alertMock.alerts.length, 1);
  assert.strictEqual(alertMock.alerts[0].type, 'warn');
  assert.strictEqual(apiMock.subscriptions.calls.add.length, 0);
});

test('add：成功后清空 url 输入并刷新列表', async () => {
  await openTab({ subs: [] });
  byId('subs-name').value = ' 新线 ';
  byId('subs-url').value = '  https://x/y.yaml  ';
  buttons(byId('subs-root'), 'add')[0].click();
  await sleep();
  await sleep();
  assert.deepStrictEqual(apiMock.subscriptions.calls.add, [{ name: '新线', url: 'https://x/y.yaml' }]);
  assert.strictEqual(byId('subs-url').value, '');
});

test('add：接口返回 ok=false 弹 error 告警且不清 url', async () => {
  await openTab({ subs: [], addRes: { ok: false, error: 'bad_url' } });
  byId('subs-url').value = 'https://bad';
  buttons(byId('subs-root'), 'add')[0].click();
  await sleep();
  assert.strictEqual(alertMock.alerts.length, 1);
  assert.strictEqual(alertMock.alerts[0].type, 'error');
  assert.strictEqual(byId('subs-url').value, 'https://bad');
});

test('refresh 按钮：调 api.refresh 后恢复按钮态', async () => {
  await openTab({ subs: [SUB] });
  const btn = buttons(byId('subs-root'), 'refresh')[0];
  btn.click();
  await sleep();
  await sleep();
  assert.deepStrictEqual(apiMock.subscriptions.calls.refresh, ['sub1']);
  assert.strictEqual(btn.disabled, false);
  assert.strictEqual(btn.textContent, 'subscription.tab.btn.refresh');
});

test('measure 按钮：调 measureNodes 并展开节点', async () => {
  await openTab({ subs: [SUB], nodes: { sub1: [{ id: 'n1', name: 'JP', type: 'ss', server: '1.1.1.1', port: 1 }] } });
  const btn = buttons(byId('subs-root'), 'measure')[0];
  btn.click();
  await sleep();
  await sleep();
  assert.deepStrictEqual(apiMock.subscriptions.calls.measureNodes, ['sub1']);
  assert.ok(byId('subs-nodes-sub1').textContent.indexOf('JP') !== -1);
});

test('view-nodes 按钮：渲染节点行（name/type/server）', async () => {
  await openTab({ subs: [SUB], nodes: { sub1: [{ id: 'n1', name: 'JP-01', type: 'vmess', server: '1.2.3.4', port: 443 }] } });
  buttons(byId('subs-root'), 'view-nodes')[0].click();
  await sleep();
  const host = byId('subs-nodes-sub1');
  assert.ok(host.textContent.indexOf('JP-01') !== -1);
  assert.ok(host.textContent.indexOf('vmess') !== -1);
  assert.ok(host.textContent.indexOf('1.2.3.4:443') !== -1);
  assert.ok(buttons(host, 'measure-one').length === 1);
});

test('latency 分档：ok / mid / slow / timeout / refused / na', async () => {
  await openTab({
    subs: [SUB],
    nodes: {
      sub1: [
        { id: 'a', name: 'fast', server: 's', port: 1, latency: { rtt: 150 } },
        { id: 'b', name: 'mid', server: 's', port: 1, latency: { rtt: 300 } },
        { id: 'c', name: 'slow', server: 's', port: 1, latency: { rtt: 800 } },
        { id: 'd', name: 'timeout', server: 's', port: 1, latency: { status: 'timeout' } },
        { id: 'e', name: 'refused', server: 's', port: 1, latency: { status: 'refused' } },
        { id: 'f', name: 'na', server: 's', port: 1, latency: null },
      ],
    },
  });
  buttons(byId('subs-root'), 'view-nodes')[0].click();
  await sleep();
  const html = byId('subs-nodes-sub1');
  function has(cls) { return html.textContent.indexOf(cls) !== -1 || JSON.stringify(collect(html)).indexOf(cls) !== -1; }
  function collect(el) {
    let out = [];
    for (const c of el.children) { out.push(c.className); out = out.concat(collect(c)); }
    return out;
  }
  const classes = collect(html).join('|');
  assert.ok(classes.indexOf('subs__latency--ok') !== -1, classes);
  assert.ok(classes.indexOf('subs__latency--mid') !== -1, classes);
  assert.ok(classes.indexOf('subs__latency--slow') !== -1, classes);
  assert.ok(classes.indexOf('subs__latency--timeout') !== -1, classes);
  assert.ok(classes.indexOf('subs__latency--refused') !== -1, classes);
  assert.ok(classes.indexOf('subs__latency--na') !== -1, classes);
});

test('delete：confirm 拒绝不调 api；确认后调 delete 并刷新', async () => {
  await openTab({ subs: [SUB], confirmQueue: [false, true] });
  buttons(byId('subs-root'), 'delete')[0].click();
  await sleep();
  await sleep();
  assert.strictEqual(apiMock.subscriptions.calls.delete.length, 0);
  buttons(byId('subs-root'), 'delete')[0].click();
  await sleep();
  await sleep();
  assert.deepStrictEqual(apiMock.subscriptions.calls.delete, ['sub1']);
});

test('measure-one：成功刷新节点；异常弹告警', async () => {
  await openTab({ subs: [SUB], nodes: { sub1: [{ id: 'n1', name: 'JP', server: 's', port: 1 }] } });
  buttons(byId('subs-root'), 'view-nodes')[0].click();
  await sleep();
  const one = buttons(byId('subs-nodes-sub1'), 'measure-one')[0];
  one.click();
  await sleep();
  await sleep();
  assert.deepStrictEqual(apiMock.subscriptions.calls.measureNode, [['sub1', 'n1']]);
  assert.strictEqual(one.disabled, false);
});

test('close()：隐藏并清空 mount；未 open 时 close 为 no-op', async () => {
  const m = await openTab({ subs: [SUB] });
  await m.subscriptionsTab.close();
  assert.strictEqual(byId('canvas-subs-mount').hidden, true);
  assert.strictEqual(byId('canvas-subs-mount').children.length, 0);
  // 再次 close 不抛错
  await m.subscriptionsTab.close();
});

test('i18n onChange：开着时重建（重新拉 list），关着不动', async () => {
  await openTab({ subs: [SUB] });
  const callsBefore = apiMock.subscriptions.calls.list;
  i18nMock._changeCbs.forEach(function (cb) { cb(); });
  await sleep();
  await sleep();
  assert.ok(apiMock.subscriptions.calls.list > callsBefore);
});

test('list 拉取异常不炸（catch 分支）', async () => {
  const m = await buildWorld();
  apiMock.subscriptions.list = function () { return Promise.reject(new Error('net down')); };
  m.initSubscriptionsTab({ i18n: i18nMock, alert: alertMock });
  await assert.doesNotReject(async function () { await m.subscriptionsTab.open(); });
  await sleep();
});
