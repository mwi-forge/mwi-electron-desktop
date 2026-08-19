// lib/__tests__/account-form.dom.test.js - account-form.js DOM 冒烟测试
// 用 vm 沙箱 + mock DOM/API 真实验证 buildForm：proxyType 订阅选项 + 联动 + submit 组装
// 运行：node --test lib/__tests__/account-form.dom.test.js
const { test, after } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const FORM_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'js', 'account-form.js'), 'utf8');

// ---- Mock DOM ----
class MockEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attrs = {};
    this.listeners = {};
    this.className = '';
    this.hidden = false;
    this.value = '';
    this.checked = false;
    this.textContent = '';
    this.type = '';
    this.name = '';
    this.id = '';
    this.required = false;
    this.options = [];
    this.disabled = false;
    this._html = '';
  }
  appendChild(c) { if (!c) return c; c.parentNode = this; this.children.push(c); if (c.tagName === 'OPTION' && this.tagName === 'SELECT') this.options.push(c); return c; }
  addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  emit(ev) { const args = Array.prototype.slice.call(arguments, 1); (this.listeners[ev] || []).forEach(function (fn) { fn.apply(null, args); }); }
  setAttribute(k, v) { this.attrs[k] = v; if (k === 'name') this.name = v; if (k === 'type') this.type = v; if (k === 'id') this.id = v; }
  getAttribute(k) { return this.attrs[k] !== undefined ? this.attrs[k] : null; }
  get classList() { return { add: function(){}, remove: function(){}, toggle: function(){}, contains: function(){ return false; } }; }
  _walk(match) { const out = []; const stack = [this]; while (stack.length) { const n = stack.pop(); if (n !== this && match(n)) out.push(n); const kids = n.children || []; for (let i = 0; i < kids.length; i++) stack.push(kids[i]); } return out; }
  querySelector(sel) { const r = this._walk(n => this._match(n, sel)); return r[0] || null; }
  querySelectorAll(sel) { return this._walk(n => this._match(n, sel)); }
  _match(n, sel) {
    const s = String(sel);
    if (s.indexOf('input[name=') === 0) {
      const m = s.match(/input\[name=([^\]]+)\]/);
      return n.tagName === 'INPUT' && m && n.name === m[1].replace(/^["']|["']$/g, '');
    }
    if (s.indexOf('.') === 0) return (n.className || '').split(' ').indexOf(s.slice(1)) >= 0;
    if (s.indexOf('#') === 0) return n.id === s.slice(1);
    return n.tagName === s.toUpperCase();
  }
}

function makeSelect() {
  const el = new MockEl('select');
  Object.defineProperty(el, 'value', {
    get() { if (this._forcedValue !== undefined) return this._forcedValue; const sel = this.options.find(function (o) { return o.selected; }); return (sel || this.options[0] || { value: '' }).value; },
    set(v) { this._forcedValue = v; },
  });
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._html; },
    set(v) { this._html = v; this.children = []; this.options = []; },
  });
  return el;
}

function buildSandbox(opts) {
  const api = opts.api || {};
  const mount = new MockEl('div');
  mount.id = 'canvas-form-mount';
  const document = {
    createElement(tag) { return tag === 'select' ? makeSelect() : new MockEl(tag); },
    createTextNode(t) { return { textContent: String(t) }; },
    getElementById(id) { return id === 'canvas-form-mount' ? mount : null; },
    querySelector() { return null; },
  };
  const customSelectCalls = [];
  const sandbox = {
    document: document,
    window: {
      api: api,
      mwiCustomSelect: { replace: function (el) {
        customSelectCalls.push(el.name);
        // 模拟 custom-select：给原生 select 创建同名 hidden input（存 value）
        const hidden = new MockEl('input');
        hidden.type = 'hidden';
        hidden.name = el.name;
        const parent = el.parentNode;
        if (parent) parent.appendChild(hidden);
      } },
    },
    console: { log: function(){}, error: function(){}, warn: function(){} },
    alert: function(msg) { sandbox.lastAlert = msg; },
    setTimeout: function(fn) { try { fn(); } catch (e) {} return 1; },
    clearTimeout: function() {},
  };
  sandbox.window.mwiAccountForm = undefined;
  vm.createContext(sandbox);
  vm.runInContext(FORM_SRC, sandbox);
  return { sandbox: sandbox, mount: mount, customSelectCalls: customSelectCalls };
}

after(function () { /* no cleanup needed */ });

test('buildForm 渲染 4 个 proxyType 选项（含从订阅选节点）', async function () {
  const ctx = buildSandbox({ api: { groups: { list: async () => [{ id: 'g1', name: '默认分组' }] }, fingerprint: { listPresets: async () => [{ id: 'preset_01', label: '标准随机' }] }, subscriptions: { list: async () => [], listNodes: async () => [] } } });
  await ctx.sandbox.window.mwiAccountForm.open({ isEdit: false, account: null }, {});
  const all = ctx.mount._walk(function (n) { return true; });
  const proxyTypeSel = all.find(function (n) { return n.tagName === 'SELECT' && n.name === 'proxyType'; });
  assert.ok(proxyTypeSel, 'proxyType select 存在');
  const vals = proxyTypeSel.options.map(function (o) { return o.value; });
  assert.deepStrictEqual(vals, ['', 'socks5', 'http', 'subscription']);
  const subsWrap = all.find(function (n) { return n.tagName === 'DIV' && n.className.indexOf('account-form-card__subs') >= 0; });
  assert.ok(subsWrap, 'subs 区块存在');
  assert.strictEqual(subsWrap.hidden, true, '初始隐藏（proxyType=不使用）');
  const manualEls = all.filter(function (n) { return (n.className || '').indexOf('account-form-card__manual-proxy') >= 0; });
  assert.strictEqual(manualEls.length, 4, '4 个 manual 字段');
  assert.strictEqual(manualEls[0].hidden, false);
});

test('选 subscription 显示订阅/节点下拉并加载数据', async function () {
  let listCalls = 0; let nodeCalls = 0;
  const ctx = buildSandbox({ api: {
    groups: { list: async () => [] },
    fingerprint: { listPresets: async () => [] },
    subscriptions: {
      list: async function () { listCalls++; return [{ id: 'sub-1', name: 'CokeCloud' }]; },
      listNodes: async function () { nodeCalls++; return [{ id: 'n1', name: 'DG-HK-13(vless)' }, { id: 'n2', name: 'TG-HK-13(hysteria)' }]; },
    },
  } });
  await ctx.sandbox.window.mwiAccountForm.open({ isEdit: false, account: null }, {});
  const all = ctx.mount._walk(function (n) { return true; });
  const proxyTypeSel = all.find(function (n) { return n.tagName === 'SELECT' && n.name === 'proxyType'; });
  const subsWrap = all.find(function (n) { return n.tagName === 'DIV' && n.className.indexOf('account-form-card__subs') >= 0; });
  proxyTypeSel.value = 'subscription';
  proxyTypeSel.emit('change');
  await new Promise(function (r) { setTimeout(r, 30); });
  assert.strictEqual(subsWrap.hidden, false, '选 subscription 后 subs 区块显示');
  const manualEls = all.filter(function (n) { return (n.className || '').indexOf('account-form-card__manual-proxy') >= 0; });
  assert.strictEqual(manualEls[0].hidden, true, 'manual 字段隐藏');
  assert.strictEqual(listCalls, 1, 'subscriptions.list 被调用');
  const subsSelect = all.find(function (n) { return n.tagName === 'SELECT' && n.name === 'proxySubId'; });
  const nodeSelect = all.find(function (n) { return n.tagName === 'SELECT' && n.name === 'proxyNodeId'; });
  assert.ok(subsSelect && nodeSelect, '订阅/节点 select 存在');
  assert.strictEqual(nodeCalls, 1, 'listNodes 被调用');
  await new Promise(function (r) { setTimeout(r, 30); });
  assert.strictEqual(nodeSelect.options.length, 2, '节点列表加载 2 个');
});

test('submit 时 proxy = {source:subscription, subscriptionId, nodeId, exclusive}', async function () {
  let createdData = null;
  const ctx = buildSandbox({ api: {
    groups: { list: async () => [] },
    fingerprint: { listPresets: async () => [] },
    subscriptions: {
      list: async function () { return [{ id: 'sub-1', name: 'CokeCloud' }]; },
      listNodes: async function () { return [{ id: 'n1', name: 'DG-HK-13(vless)' }]; },
    },
    accounts: { create: async function (data) { createdData = data; return { ok: true }; } },
  } });
  let onCloseArg = null;
  await ctx.sandbox.window.mwiAccountForm.open({ isEdit: false, account: null }, { onClose: function (a) { onCloseArg = a; } });
  const all = ctx.mount._walk(function (n) { return true; });
  const proxyTypeSel = all.find(function (n) { return n.tagName === 'SELECT' && n.name === 'proxyType'; });
  const form = all.find(function (n) { return n.tagName === 'FORM'; });
  const nameInput = form.querySelector('input[name=name]');
  const urlInput = form.querySelector('input[name=url]');
  nameInput.value = '测试号'; urlInput.value = 'https://www.milkywayidle.com/game';
  proxyTypeSel.value = 'subscription';
  proxyTypeSel.emit('change');
  // 真实 custom-select selectValue 会同步同名 hidden input（mock 里手动补）
  const ptHidden = form.querySelector('input[name=proxyType]');
  if (ptHidden) ptHidden.value = 'subscription';
  await new Promise(function (r) { setTimeout(r, 40); });
  const excl = all.find(function (n) { return n.tagName === 'INPUT' && n.name === 'proxyExclusive'; });
  excl.checked = true;
  // 模拟 HTMLFormElement named access：f.name / f.url / f.userAgent / f.proxyHost...
  form.name = nameInput;
  form.url = urlInput;
  const uaInput = form.querySelector('input[name=userAgent]');
  if (uaInput) { uaInput.value = ''; form.userAgent = uaInput; }
  const ph = form.querySelector('input[name=proxyHost]');
  if (ph) { ph.value = ''; form.proxyHost = ph; }
  const pp = form.querySelector('input[name=proxyPort]');
  if (pp) { pp.value = ''; form.proxyPort = pp; }
  const pu = form.querySelector('input[name=proxyUsername]');
  if (pu) { pu.value = ''; form.proxyUsername = pu; }
  const ppw = form.querySelector('input[name=proxyPassword]');
  if (ppw) { ppw.value = ''; form.proxyPassword = ppw; }
  const ev = { preventDefault: function(){}, target: form };
  form.emit('submit', ev);
  await new Promise(function (r) { setTimeout(r, 40); });
  assert.ok(createdData, 'accounts.create 被调用');
  assert.strictEqual(createdData.proxy.source, 'subscription');
  assert.strictEqual(createdData.proxy.subscriptionId, 'sub-1');
  assert.strictEqual(createdData.proxy.nodeId, 'n1');
  assert.strictEqual(createdData.proxy.exclusive, true);
  assert.strictEqual(createdData.name, '测试号');
  assert.ok(onCloseArg && onCloseArg.ok, 'onClose ok 回调');
});

test('编辑模式预填 subscription 形态', async function () {
  const ctx = buildSandbox({ api: {
    groups: { list: async () => [] },
    fingerprint: { listPresets: async () => [] },
    subscriptions: {
      list: async function () { return [{ id: 'sub-9', name: '旧订阅' }]; },
      listNodes: async function () { return [{ id: 'n9', name: '节点9' }, { id: 'n1', name: '节点1' }]; },
    },
  } });
  const account = { name: 'A', url: 'https://x', proxy: { source: 'subscription', subscriptionId: 'sub-9', nodeId: 'n9', exclusive: false } };
  await ctx.sandbox.window.mwiAccountForm.open({ isEdit: true, account: account }, {});
  await new Promise(function (r) { setTimeout(r, 60); });
  const all = ctx.mount._walk(function (n) { return true; });
  const proxyTypeSel = all.find(function (n) { return n.tagName === 'SELECT' && n.name === 'proxyType'; });
  assert.strictEqual(proxyTypeSel.value, 'subscription', 'proxyType 预选 subscription');
  const subsWrap = all.find(function (n) { return n.tagName === 'DIV' && n.className.indexOf('account-form-card__subs') >= 0; });
  assert.strictEqual(subsWrap.hidden, false, '编辑 subscription 账号 subs 区块显示');
  const subsSelect = all.find(function (n) { return n.tagName === 'SELECT' && n.name === 'proxySubId'; });
  const nodeSelect = all.find(function (n) { return n.tagName === 'SELECT' && n.name === 'proxyNodeId'; });
  await new Promise(function (r) { setTimeout(r, 30); });
  assert.strictEqual(subsSelect.value, 'sub-9', '订阅预选 sub-9');
  assert.strictEqual(nodeSelect.value, 'n9', '节点预选 n9');
});