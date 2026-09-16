// lib/__tests__/layout.dom.test.js - layout.js 拖拽调宽 + 日志布局 DOM 冒烟测试
// 真实验证：把手拖拽改宽、clamp、IPC 通知、持久化恢复
// 渲染层 ESM 化后改为：globalThis mock + 动态 import + initLayout()
// 运行：node --test lib/__tests__/layout.dom.test.js
const { test } = require('node:test');
const assert = require('node:assert');

let modPromise = null;
function loadLayout() {
  if (!modPromise) modPromise = import('../../src/js/layout.js');
  return modPromise;
}

// ---- Mock DOM ----
class RealClassList {
  constructor() { this.set = new Set(); }
  add() { for (const c of arguments) this.set.add(c); }
  remove() { for (const c of arguments) this.set.delete(c); }
  toggle(c, force) {
    const want = force === undefined ? !this.set.has(c) : !!force;
    if (want) { this.set.add(c); } else { this.set.delete(c); }
    return want;
  }
  contains(c) { return this.set.has(c); }
}

class MockEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.id = '';
    this.listeners = {};
    this._classList = new RealClassList();
  }
  get classList() { return this._classList; }
  addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  emit(ev) {
    const args = Array.prototype.slice.call(arguments, 1);
    (this.listeners[ev] || []).forEach(function (fn) { fn.apply(null, args); });
  }
}

// 每轮 test 全新 globalThis mock + initLayout()（模块单例，init 重置 st/dragging）
function initCase(store) {
  const els = {};
  function el(id) {
    if (!els[id]) { els[id] = new MockEl('div'); els[id].id = id; }
    return els[id];
  }
  const docEl = { style: { props: {}, setProperty(k, v) { this.props[k] = v; } } };
  const body = new MockEl('body');
  const winListeners = {};
  const layoutCalls = [];
  globalThis.document = {
    getElementById: function (id) { return el(id); },
    documentElement: docEl,
    body: body,
  };
  globalThis.window = {
    api: {
      layout: {
        set: function (o) { layoutCalls.push(JSON.parse(JSON.stringify(o))); return Promise.resolve({}); },
      },
    },
    addEventListener: function (ev, fn) { (winListeners[ev] = winListeners[ev] || []).push(fn); },
  };
  globalThis.localStorage = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = v; },
  };
  return {
    ready: loadLayout().then(function (m) {
      m.initLayout();
      return {
        mod: m,
        els: els,
        body: body,
        docEl: docEl,
        layoutCalls: layoutCalls,
        winEmit: function (ev, evt) {
          (winListeners[ev] || []).forEach(function (fn) { fn(evt); });
        },
      };
    }),
  };
}

function lastCall(s) { return s.layoutCalls[s.layoutCalls.length - 1]; }
function noop() {}

test('启动时应用默认宽度 240/320 并同步主进程', async function () {
  const s = await initCase({}).ready;
  assert.strictEqual(s.docEl.style.props['--mwi-sidebar-w'], '240px');
  assert.strictEqual(s.docEl.style.props['--mwi-right-w'], '320px');
  const last = lastCall(s);
  assert.strictEqual(last.sidebarW, 240);
  assert.strictEqual(last.panelW, 320);
  assert.strictEqual(last.dragging, null);
});

test('sidebar 把手右拖 60px 宽度变 300 且通知 dragging=sidebar', async function () {
  const s = await initCase({}).ready;
  s.els['split-handle-sidebar'].emit('mousedown', { clientX: 240, preventDefault: noop });
  s.winEmit('mousemove', { clientX: 300 });
  assert.strictEqual(s.docEl.style.props['--mwi-sidebar-w'], '300px');
  const last = lastCall(s);
  assert.strictEqual(last.sidebarW, 300);
  assert.strictEqual(last.dragging, 'sidebar');
});

test('sidebar 拖到 0 被 clamp 到下限 180', async function () {
  const s = await initCase({}).ready;
  s.els['split-handle-sidebar'].emit('mousedown', { clientX: 240, preventDefault: noop });
  s.winEmit('mousemove', { clientX: 0 });
  assert.strictEqual(s.docEl.style.props['--mwi-sidebar-w'], '180px');
});

test('mouseup 结束拖拽：dragging 复位 null 且持久化 localStorage', async function () {
  const store = {};
  const s = await initCase(store).ready;
  s.els['split-handle-sidebar'].emit('mousedown', { clientX: 240, preventDefault: noop });
  s.winEmit('mousemove', { clientX: 360 });
  assert.strictEqual(s.docEl.style.props['--mwi-sidebar-w'], '360px');
  s.winEmit('mouseup', {});
  const last = lastCall(s);
  assert.strictEqual(last.dragging, null);
  assert.strictEqual(last.sidebarW, 360);
  const saved = JSON.parse(store['mwi:layout:collapsed']);
  assert.strictEqual(saved.sidebarW, 360);
  assert.strictEqual(s.body.classList.contains('is-resizing'), false);
});

test('panel 把手左拖 60px 宽度变 380 且通知 dragging=panel', async function () {
  const s = await initCase({}).ready;
  s.els['split-handle-panel'].emit('mousedown', { clientX: 1000, preventDefault: noop });
  s.winEmit('mousemove', { clientX: 940 });
  assert.strictEqual(s.docEl.style.props['--mwi-right-w'], '380px');
  const last = lastCall(s);
  assert.strictEqual(last.panelW, 380);
  assert.strictEqual(last.dragging, 'panel');
});

test('重启后从 localStorage 恢复自定义宽度', async function () {
  const store = { 'mwi:layout:collapsed': JSON.stringify({ sidebar: false, panel: false, sidebarW: 300, panelW: 410 }) };
  const s = await initCase(store).ready;
  assert.strictEqual(s.docEl.style.props['--mwi-sidebar-w'], '300px');
  assert.strictEqual(s.docEl.style.props['--mwi-right-w'], '410px');
});
