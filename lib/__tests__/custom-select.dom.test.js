// lib/__tests__/custom-select.dom.test.js - custom-select 自定义 listbox 组件单测（#37 覆盖补齐）
// 渲染层 ESM：globalThis mock（document/window/Event）+ 动态 import；DOM mock 在 modal-e2e
// 最小 mock 基础上补 classList / insertBefore / contains / dispatchEvent，满足 listbox 交互面。
// 运行：node --test lib/__tests__/custom-select.dom.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');

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
    _set: set,
  };
}

function makeElement(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [], attributes: {}, dataset: {}, style: {},
    className: '', textContent: '', id: '', type: '', name: '', value: '',
    hidden: false, parentNode: null, _listeners: {},
    classList: null,
    setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'id') this.id = String(v); },
    getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; },
    removeAttribute(k) { delete this.attributes[k]; },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    insertBefore(node, ref) {
      node.parentNode = this;
      const i = ref ? this.children.indexOf(ref) : -1;
      if (i < 0) this.children.push(node); else this.children.splice(i, 0, node);
      return node;
    },
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i >= 0) { this.children.splice(i, 1); child.parentNode = null; }
      return child;
    },
    contains(target) {
      function walk(node) { if (node === target) return true; for (const c of node.children) if (walk(c)) return true; return false; }
      return walk(this);
    },
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    removeEventListener(ev, fn) {
      const arr = this._listeners[ev] || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    dispatchEvent(evt) { for (const fn of (this._listeners[evt.type] || [])) fn(evt); return true; },
    click() { for (const fn of (this._listeners.click || [])) fn({ preventDefault() {} }); },
    focus() { if (typeof document !== 'undefined' && documentMock.activeElement !== undefined) documentMock.activeElement = this; },
    scrollIntoView() {},
  };
  el.classList = makeClassList(el);
  return el;
}

const documentMock = {
  body: makeElement('body'),
  activeElement: null,
  _docListeners: {},
  createElement(tag) { return makeElement(tag); },
  createTextNode(text) { const n = makeElement('#text'); n.textContent = text; return n; },
  getElementById(id) {
    function walk(el) { if (el.id === id) return el; for (const c of el.children) { const r = walk(c); if (r) return r; } return null; }
    return walk(this.body);
  },
  querySelector(sel) { return null; },
  querySelectorAll() { return []; },
  addEventListener(ev, fn) { (this._docListeners[ev] = this._docListeners[ev] || []).push(fn); },
  removeEventListener(ev, fn) {
    const arr = this._docListeners[ev] || [];
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  },
  docMousedown(target) {
    const evt = { target: target, preventDefault() {} };
    for (const fn of (this._docListeners.mousedown || [])) fn(evt);
  },
};
const windowMock = {
  _winListeners: {},
  addEventListener(ev, fn) { (this._winListeners[ev] = this._winListeners[ev] || []).push(fn); },
  removeEventListener(ev, fn) {
    const arr = this._winListeners[ev] || [];
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  },
  winEvent(ev) { for (const fn of (this._winListeners[ev] || [])) fn({}); },
};

let modPromise = null;
async function setup() {
  globalThis.document = documentMock;
  globalThis.window = windowMock;
  globalThis.Event = function Event(type) { this.type = type; };
  if (!modPromise) modPromise = import('../../src/js/custom-select.js');
  return modPromise;
}

function makeNativeSelect(options, selectedValue, name) {
  const parent = makeElement('div');
  const native = makeElement('select');
  native.options = options.map(function (o) {
    return { value: o.value, textContent: o.label || o.value, disabled: !!o.disabled };
  });
  native.value = selectedValue !== undefined ? selectedValue : (options[0] ? options[0].value : '');
  if (name) native.setAttribute('name', name);
  parent.appendChild(native);
  return { parent: parent, native: native };
}

function findOptionLis(apiRootViaTrigger) {
  // 从 trigger 反查 root -> popover -> li 列表
  const root = apiRootViaTrigger;
  return root;
}

function getPopover(root) { return root.children[1]; }
function getTrigger(root) { return root.children[0]; }
function getHidden(root) { return root.parentNode.children[2]; }

test('replace 非 SELECT 元素返回 null', async () => {
  await setup();
  const { customSelect } = await setup();
  const div = makeElement('div');
  assert.strictEqual(customSelect.replace(div), null);
});

test('replace 构建结构：hidden input 同步 name/value，重复 replace 返回缓存实例', async () => {
  const { customSelect } = await setup();
  const s = makeNativeSelect([{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], 'b', 'groupId');
  const api = customSelect.replace(s.native);
  assert.ok(api);
  // root 插在 native 之后，hidden 插在 root 之后
  assert.strictEqual(s.parent.children[1].className, 'custom-select');
  const hidden = s.parent.children[2];
  assert.strictEqual(hidden.tagName, 'INPUT');
  assert.strictEqual(hidden.name, 'groupId');
  assert.strictEqual(hidden.value, 'b');
  // 重复 replace 幂等：返回同一实例，不新增节点
  const api2 = customSelect.replace(s.native);
  assert.strictEqual(api, api2);
  assert.strictEqual(s.parent.children.length, 3);
});

test('初始 value 不在 options 中时回退首个 option', async () => {
  const { customSelect } = await setup();
  const s = makeNativeSelect([{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], 'zzz');
  const api = customSelect.replace(s.native);
  assert.strictEqual(api.getValue(), 'a');
});

test('label 渲染：有 placeholder 且无匹配时显示 placeholder', async () => {
  const { customSelect } = await setup();
  const s = makeNativeSelect([], undefined);
  s.native.setAttribute('data-placeholder', '选择分组');
  const api = customSelect.replace(s.native);
  const root = s.parent.children[1];
  const label = getTrigger(root).children[0];
  assert.strictEqual(label.textContent, '选择分组');
  assert.ok(label.classList.contains('custom-select__label--placeholder'));
});

test('点击 option：hidden/native value 更新、change 事件冒泡、弹层关闭', async () => {
  const { customSelect } = await setup();
  const s = makeNativeSelect([{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], 'a');
  const api = customSelect.replace(s.native);
  const root = s.parent.children[1];
  let changeFired = 0;
  s.native.addEventListener('change', function () { changeFired++; });
  api.open();
  const popover = getPopover(root);
  assert.strictEqual(popover.hidden, false);
  popover.children[1].click();
  assert.strictEqual(api.getValue(), 'b');
  assert.strictEqual(getHidden(root).value, 'b');
  assert.strictEqual(s.native.value, 'b');
  assert.strictEqual(changeFired, 1);
  assert.strictEqual(popover.hidden, true);
});

test('disabled option 点击无效', async () => {
  const { customSelect } = await setup();
  const s = makeNativeSelect([{ value: 'a', label: 'A' }, { value: 'b', label: 'B', disabled: true }], 'a');
  const api = customSelect.replace(s.native);
  const root = s.parent.children[1];
  api.open();
  getPopover(root).children[1].click();
  assert.strictEqual(api.getValue(), 'a');
});

test('trigger click 开合：aria-expanded / hidden / open class 同步', async () => {
  const { customSelect } = await setup();
  const s = makeNativeSelect([{ value: 'a', label: 'A' }], undefined);
  const api = customSelect.replace(s.native);
  const root = s.parent.children[1];
  const trigger = getTrigger(root);
  assert.strictEqual(trigger.getAttribute('aria-expanded'), 'false');
  trigger.click();
  assert.strictEqual(trigger.getAttribute('aria-expanded'), 'true');
  assert.strictEqual(getPopover(root).hidden, false);
  assert.ok(root.classList.contains('custom-select--open'));
  trigger.click();
  assert.strictEqual(trigger.getAttribute('aria-expanded'), 'false');
  assert.strictEqual(getPopover(root).hidden, true);
});

test('键盘：ArrowDown 移动高亮、Enter 选中、Escape/Tab 关闭', async () => {
  const { customSelect } = await setup();
  const s = makeNativeSelect([{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }], 'a');
  const api = customSelect.replace(s.native);
  const root = s.parent.children[1];
  const trigger = getTrigger(root);
  const popover = getPopover(root);
  function key(k, extra) { trigger._listeners.keydown.forEach(function (fn) { fn(Object.assign({ key: k, preventDefault() {} }, extra || {})); }); }

  key('ArrowDown');  // 关闭状态下先开
  assert.strictEqual(popover.hidden, false);
  key('ArrowDown');  // 高亮 b
  assert.ok(popover.children[1].classList.contains('custom-select__option--highlight'));
  key('Enter');
  assert.strictEqual(api.getValue(), 'b');
  assert.strictEqual(popover.hidden, true);

  api.open();
  key('Escape');
  assert.strictEqual(popover.hidden, true);
  api.open();
  key('Tab');
  assert.strictEqual(popover.hidden, true);
});

test('键盘：Home/End 跳首尾', async () => {
  const { customSelect } = await setup();
  const s = makeNativeSelect([{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }], 'b');
  const api = customSelect.replace(s.native);
  const root = s.parent.children[1];
  const trigger = getTrigger(root);
  const popover = getPopover(root);
  function key(k) { trigger._listeners.keydown.forEach(function (fn) { fn({ key: k, preventDefault() {} }); }); }
  api.open();
  key('End');
  assert.ok(popover.children[2].classList.contains('custom-select__option--highlight'));
  key('Home');
  assert.ok(popover.children[0].classList.contains('custom-select__option--highlight'));
});

test('文档 mousedown：外部点击关闭、内部点击不关', async () => {
  const { customSelect } = await setup();
  const s = makeNativeSelect([{ value: 'a', label: 'A' }], undefined);
  const api = customSelect.replace(s.native);
  const root = s.parent.children[1];
  api.open();
  documentMock.docMousedown(documentMock.body);
  assert.strictEqual(getPopover(root).hidden, true);
  api.open();
  documentMock.docMousedown(getTrigger(root));
  assert.strictEqual(getPopover(root).hidden, false);
});

test('window scroll/resize 时关闭弹层', async () => {
  const { customSelect } = await setup();
  const s = makeNativeSelect([{ value: 'a', label: 'A' }], undefined);
  const api = customSelect.replace(s.native);
  const root = s.parent.children[1];
  api.open();
  windowMock.winEvent('scroll');
  assert.strictEqual(getPopover(root).hidden, true);
  api.open();
  windowMock.winEvent('resize');
  assert.strictEqual(getPopover(root).hidden, true);
});

test('setValue/getValue API 与选中态 aria 同步', async () => {
  const { customSelect } = await setup();
  const s = makeNativeSelect([{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], 'a');
  const api = customSelect.replace(s.native);
  const root = s.parent.children[1];
  api.setValue('b');
  assert.strictEqual(api.getValue(), 'b');
  assert.strictEqual(getHidden(root).value, 'b');
  const popover = getPopover(root);
  assert.strictEqual(popover.children[1].getAttribute('aria-selected'), 'true');
  assert.strictEqual(popover.children[0].getAttribute('aria-selected'), 'false');
});

test('destroy：移除挂载节点、恢复 native、全局监听清理，可重新 replace', async () => {
  const { customSelect } = await setup();
  const s = makeNativeSelect([{ value: 'a', label: 'A' }], undefined);
  const api = customSelect.replace(s.native);
  const root = s.parent.children[1];
  const hidden = s.parent.children[2];
  assert.strictEqual(s.native.style.display, 'none');
  api.destroy();
  assert.strictEqual(s.parent.children.indexOf(root), -1);
  assert.strictEqual(s.parent.children.indexOf(hidden), -1);
  assert.strictEqual(s.native.style.display, '');
  assert.strictEqual(s.native.dataset.customSelectReady, undefined);
  // 全局监听已移除：scroll 不再影响（不抛错即通过）
  windowMock.winEvent('scroll');
  // 可重新 replace 重建
  const api2 = customSelect.replace(s.native);
  assert.ok(api2);
});
