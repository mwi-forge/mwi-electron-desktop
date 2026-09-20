// tests/modal-e2e.test.js — 端到端验证 modal.js 修复（finish 作用域 + 队列 + 键盘）
// 渲染层 ESM 化后改为：globalThis mock + 动态 import + initModal()（替代 vm runInContext）
const test = require('node:test');
const assert = require('node:assert/strict');

// ============ 最小 DOM mock（递归子节点查找）============
function makeElement(tag) {
  const el = {
    tagName: tag.toUpperCase(),
    children: [], attributes: {}, dataset: {}, style: {},
    className: '', textContent: '', type: '', _listeners: {},
    parentNode: null, id: '',
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k]; },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i >= 0) { this.children.splice(i, 1); child.parentNode = null; }
      return child;
    },
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    removeEventListener(ev, fn) {
      const arr = this._listeners[ev] || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    dispatch(ev, evt) { for (const fn of (this._listeners[ev] || [])) fn(evt); },
    focus() { windowMock.document.activeElement = this; },
  };
  return el;
}

const body = makeElement('body');
const documentMock = {
  body, activeElement: null,
  getElementById(id) {
    function walk(el) { if (el.id === id) return el; for (const c of el.children) { const r = walk(c); if (r) return r; } return null; }
    return walk(body);
  },
  createElement(tag) { return makeElement(tag); },
  addEventListener(ev, fn) { body.addEventListener('_doc_' + ev, fn); },
  removeEventListener(ev, fn) { body.removeEventListener('_doc_' + ev, fn); },
  _dispatchKey(key) {
    for (const fn of (body._listeners['_doc_keydown'] || [])) fn({ key, preventDefault() {} });
  },
};
const windowMock = {
  api: {
   dialog: {
     _onShowCb: null,
     onShow(cb) { this._onShowCb = cb; return () => { this._onShowCb = null; }; },
     reply(id, idx) { windowMock._lastReply = { id, idx }; },
   },
   // api.canvas 桩：默认 resolve(false)，可注入挂起的 hideFocused 以复现「渲染中」竞态
   canvas: {
     hideFocused() { return windowMock._canvasHide ? windowMock._canvasHide() : Promise.resolve(false); },
     resumeFocused() { return Promise.resolve(true); },
   },
  },
  _lastReply: null,
  _canvasHide: null,
};

// 挂 globalThis 后动态 import ESM（modal.js 运行时解析 document/window），再显式 init 注册 onShow
let cached = null;
async function setup() {
  if (cached) return cached;
  globalThis.document = documentMock;
  globalThis.window = windowMock;
  const m = await import('../src/js/modal.js');
  m.initModal();
  cached = m;
  return cached;
}

// ============ helpers ============
function getAllButtons() {
  // 递归收集当前 dialog 里所有 BUTTON 元素
  const buttons = [];
  function walk(el) {
    if (el.tagName === 'BUTTON') buttons.push(el);
    for (const c of el.children) walk(c);
  }
  const slot = documentMock.getElementById('mwi-alert-slot');
  if (slot) walk(slot);
  return buttons;
}
function getTitles() {
  const titles = [];
  function walk(el) {
    if (el.className && el.className.includes('mwi-alert__title')) titles.push(el.textContent);
    for (const c of el.children) walk(c);
  }
  const slot = documentMock.getElementById('mwi-alert-slot');
  if (slot) walk(slot);
  return titles;
}

// ============ 测试 ============

test('1. ★ alert 渲染 + 点击按钮 resolve 0（不再 ReferenceError）', async () => {
  const { mwiAlert } = await setup();
  const promise = mwiAlert.alert({ type: 'error', title: '代理启动失败', message: 'mihomo_binary_not_found' });
  await new Promise(r => setImmediate(r));
  const buttons = getAllButtons();
  assert.equal(buttons.length, 1, '应有 1 个按钮');
  assert.equal(buttons[0].textContent, '我知道了');
  // ★ 关键路径：finish 不再 ReferenceError
  buttons[0].dispatch('click', {});
  assert.equal(await promise, 0, '点击 resolve 0');
});

test('2. confirm 双按钮 + 点确定 resolve true', async () => {
  const { mwiAlert } = await setup();
  const p = mwiAlert.confirm({ message: '确认删除?' });
  await new Promise(r => setImmediate(r));
  const buttons = getAllButtons();
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].textContent, '取消');
  assert.equal(buttons[1].textContent, '确定');
  buttons[1].dispatch('click', {});
  assert.equal(await p, true);
});

test('3. confirm 点取消 resolve false', async () => {
  const { mwiAlert } = await setup();
  const p = mwiAlert.confirm({ message: '是否继续?' });
  await new Promise(r => setImmediate(r));
  getAllButtons()[0].dispatch('click', {});
  assert.equal(await p, false);
});

test('4. Enter 键 = defaultId（confirm 时 = 确定）', async () => {
  const { mwiAlert } = await setup();
  const p = mwiAlert.confirm({ message: 'Enter 测试' });
  await new Promise(r => setImmediate(r));
  documentMock._dispatchKey('Enter');
  assert.equal(await p, true);
});

test('5. Esc 键 = cancelId（confirm 时 = 取消）', async () => {
  const { mwiAlert } = await setup();
  const p = mwiAlert.confirm({ message: 'Esc 测试' });
  await new Promise(r => setImmediate(r));
  documentMock._dispatchKey('Escape');
  assert.equal(await p, false);
});

test('6. Esc 在 alert 单按钮时 = defaultId', async () => {
  const { mwiAlert } = await setup();
  const p = mwiAlert.alert({ title: 'Esc 单按钮', message: 'X' });
  await new Promise(r => setImmediate(r));
  documentMock._dispatchKey('Escape');
  assert.equal(await p, 0);
});

test('7. 主进程 IPC 推送 → 渲染 → api.dialog.reply 回执', async () => {
  const { mwiAlert } = await setup();
  windowMock._lastReply = null;
  const cb = windowMock.api.dialog._onShowCb;
  assert.ok(cb, 'modal.js 应该注册 api.dialog.onShow');
  cb({ id: 'dlg-test-123', type: 'error', title: 'IPC', message: 'X', buttons: ['我知道了'], defaultId: 0, cancelId: 0 });
  await new Promise(r => setImmediate(r));
  const buttons = getAllButtons();
  assert.equal(buttons[0].textContent, '我知道了');
  buttons[0].dispatch('click', {});
  await new Promise(r => setImmediate(r));
  assert.deepEqual(windowMock._lastReply, { id: 'dlg-test-123', idx: 0 });
});

test('8. 队列串行（两个 alert 不叠加）', async () => {
  const { mwiAlert } = await setup();
  const p1 = mwiAlert.alert({ title: '第一个', message: 'A' });
  const p2 = mwiAlert.alert({ title: '第二个', message: 'B' });
  await new Promise(r => setImmediate(r));
  let titles = getTitles();
  assert.ok(titles.includes('第一个'));
  assert.ok(!titles.includes('第二个'), '不应该叠加显示');
  getAllButtons()[0].dispatch('click', {});
  await p1;
  await new Promise(r => setImmediate(r));
  titles = getTitles();
  assert.ok(titles.includes('第二个'));
  getAllButtons()[0].dispatch('click', {});
  await p2;
});

test('9. detail 多行 + 自定义 title 完整渲染', async () => {
  const { mwiAlert } = await setup();
  const p = mwiAlert.alert({
    type: 'warn',
    title: '多行详情测试',
    message: '账号 X 配置失败',
    detail: '原因: foo\n模式: bar\n\n排查:\n  1. A\n  2. B',
  });
  await new Promise(r => setImmediate(r));
  const slot = documentMock.getElementById('mwi-alert-slot');
  function findByClass(el, cls) {
    if (el.className === cls) return el;
    for (const c of el.children) { const r = findByClass(c, cls); if (r) return r; }
    return null;
  }
  const detail = findByClass(slot, 'mwi-alert__detail');
  assert.ok(detail, 'detail 元素应渲染');
  assert.ok(detail.textContent.includes('foo'));
  assert.ok(detail.textContent.includes('1. A'));
  getAllButtons()[0].dispatch('click', {});
  await p;
});

test('10. body scroll lock + cleanup（弹窗关闭后 body overflow 还原）', async () => {
  const { mwiAlert } = await setup();
  documentMock.body.style.overflow = 'auto'; // 初始
  const p = mwiAlert.alert({ title: 'Lock 测试', message: 'X' });
  await new Promise(r => setImmediate(r));
  assert.equal(documentMock.body.style.overflow, 'hidden', '弹窗期间应锁住滚动');
  getAllButtons()[0].dispatch('click', {});
  await p;
  assert.equal(documentMock.body.style.overflow, 'auto', '关闭后应还原');
});

test('11. 渲染中二次 alert 不叠加（hideFocused pending 时）', async () => {
  const { mwiAlert } = await setup();
  // 复现真实竞态：renderDialog 停在 await hideFocused（rendering=true、currentEl 未置位），
  // 此时再次 alert 不应并发渲染（否则两个轮回叠在一起）。
  let resolveHide;
  windowMock._canvasHide = () => new Promise(res => { resolveHide = res; });
  const p1 = mwiAlert.alert({ title: '渲染中一', message: 'A' });
  const p2 = mwiAlert.alert({ title: '渲染中二', message: 'B' });
  // hideFocused 未 resolve 前，不应渲染任何弹窗
  assert.equal(getTitles().length, 0, 'hideFocused 未完成前不应渲染弹窗');
  // 释放 hideFocused → p1 渲染；随后恢复默认桩（hideFocused resolve(false)），让 p2 能正常渲染
  resolveHide(false);
  windowMock._canvasHide = null;
  await new Promise(r => setImmediate(r));
  let titles = getTitles();
  assert.ok(titles.includes('渲染中一'), 'p1 应渲染');
  assert.ok(!titles.includes('渲染中二'), 'p2 不应叠加渲染');
  // 关闭 p1 → p2 串行渲染
  getAllButtons()[0].dispatch('click', {});
  await p1;
  await new Promise(r => setImmediate(r));
  titles = getTitles();
  assert.ok(titles.includes('渲染中二'), '关闭 p1 后 p2 应渲染');
  getAllButtons()[0].dispatch('click', {});
  await p2;
  windowMock._canvasHide = null;
});
