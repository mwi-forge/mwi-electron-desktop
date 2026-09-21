// lib/__tests__/settings-tab.dom.test.js - 设置面板 tab 单测（#37 覆盖补齐）
// 渲染层 ESM：globalThis mock + 动态 import + initSettingsTab({ i18n, tabbar }) 注入；
// window.api.views.getIdleConfig / setIdleConfig 桩可控异步回填与写回断言。
// 运行：node --test lib/__tests__/settings-tab.dom.test.js
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
  };
}

function makeElement(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [], attributes: {}, dataset: {}, style: {},
    className: '', textContent: '', id: '', type: '', name: '', value: '',
    hidden: false, checked: false, disabled: false, selected: false,
    min: '', max: '', step: '', inputMode: '', htmlFor: '', autocomplete: '',
    parentNode: null, _listeners: {},
    classList: null,
    get firstChild() { return this.children[0] || null; },
    get lastChild() { return this.children[this.children.length - 1] || null; },
    setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'id') this.id = String(v); },
    getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i >= 0) { this.children.splice(i, 1); child.parentNode = null; }
      return child;
    },
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    dispatch(evt) { for (const fn of (this._listeners[evt && evt.type] || [])) fn(evt); },
    click() { for (const fn of (this._listeners.click || [])) fn({ preventDefault() {} }); },
    focus() {},
  };
  el.classList = makeClassList(el);
  return el;
}

// 测试状态（每例重建）
let mount = null;
let i18nMock = null;
let tabbarMock = null;
let apiMock = null;

function buildWorld(opts) {
  opts = opts || {};
  mount = makeElement('div');
  mount.className = 'canvas__form-mount';
  mount.hidden = true;

  i18nMock = {
    SUPPORTED: ['zh-CN', 'en-US'],
    _locale: opts.locale || 'en-US',
    _changeCbs: [],
    t(key, vars) { return key; },
    getLocale() { return this._locale; },
    setLocale(code) { this._locale = code; this.setLocaleCalls.push(code); },
    setLocaleCalls: [],
    onChange(cb) { this._changeCbs.push(cb); },
  };
  tabbarMock = { closeFormTabCalls: [], closeFormTab(id) { this.closeFormTabCalls.push(id); } };
  apiMock = {
    views: {
      _idleCfg: opts.idleCfg || { timeoutMs: 300000, enabled: true },
      _idleCfgReject: !!opts.idleCfgReject,
      setIdleConfigCalls: [],
      getIdleConfig() {
        return this._idleCfgReject ? Promise.reject(new Error('boom')) : Promise.resolve(this._idleCfg);
      },
      setIdleConfig(cfg) { this.setIdleConfigCalls.push(cfg); return Promise.resolve(); },
    },
    diagnostics: {
      _result: opts.diagResult || { ok: true, path: '/tmp/diag.json' },
      exportCalls: 0,
      export() { this.exportCalls += 1; return Promise.resolve(this._result); },
    },
  };

  globalThis.document = {
    body: makeElement('body'),
    documentElement: { lang: '' },
    createElement(tag) { return makeElement(tag); },
    querySelector(sel) {
      if (sel === '.canvas__form-mount') return mount;
      return null;
    },
  };
  globalThis.window = { api: apiMock };
  globalThis.Event = function Event(type) { this.type = type; };
  return import('../../src/js/settings-tab.js');
}

async function openTab() {
  const m = await buildWorld();
  m.initSettingsTab({ i18n: i18nMock, tabbar: tabbarMock });
  m.settingsTab.open();
  await new Promise(function (r) { setTimeout(r, 0); });  // 等 getIdleConfig 异步回填
  return m;
}

function findForm() {
  function walk(el) { if (el.tagName === 'FORM') return el; for (const c of el.children) { const r = walk(c); if (r) return r; } return null; }
  return walk(mount);
}

function findById(root, id) {
  function walk(el) { if (el.id === id) return el; for (const c of el.children) { const r = walk(c); if (r) return r; } return null; }
  return walk(root);
}

test('open()：卡片挂载进 mount，mount 可见；locale select 按 SUPPORTED 构建且选中当前语言', async () => {
  await openTab();
  assert.strictEqual(mount.hidden, false);
  assert.ok(mount.children.length > 0);
  const sel = findById(mount, 'settings-locale');
  assert.ok(sel);
  assert.strictEqual(sel.children.length, 2);
  assert.strictEqual(sel.children[0].value, 'zh-CN');
  assert.strictEqual(sel.children[1].value, 'en-US');
  assert.strictEqual(sel.children[1].selected, true);
});

test('idle 配置 enabled：minutes 回填 timeoutMs/60000，输入可用', async () => {
  await openTab();
  const minutes = findById(mount, 'settings-idle-minutes');
  const slider = findById(mount, 'settings-idle-minutes-slider');
  assert.strictEqual(minutes.value, '5');
  assert.strictEqual(slider.value, '5');
  assert.strictEqual(minutes.disabled, false);
  assert.strictEqual(slider.disabled, false);
});

test('idle 配置 disabled：minutes=5 且输入禁用', async () => {
  const m = await (async function () {
    const mod = await buildWorld({ idleCfg: { timeoutMs: 0, enabled: false } });
    mod.initSettingsTab({ i18n: i18nMock, tabbar: tabbarMock });
    mod.settingsTab.open();
    await new Promise(function (r) { setTimeout(r, 0); });
    return null;
  })();
  const minutes = findById(mount, 'settings-idle-minutes');
  assert.strictEqual(minutes.value, '5');
  assert.strictEqual(minutes.disabled, true);
});

test('idle 配置拉取失败：fallback 5 分钟且可用', async () => {
  const mod = await buildWorld({ idleCfgReject: true });
  mod.initSettingsTab({ i18n: i18nMock, tabbar: tabbarMock });
  mod.settingsTab.open();
  await new Promise(function (r) { setTimeout(r, 0); });
  const minutes = findById(mount, 'settings-idle-minutes');
  assert.strictEqual(minutes.value, '5');
  assert.strictEqual(minutes.disabled, false);
});

test('number ↔ slider 双向联动', async () => {
  await openTab();
  const minutes = findById(mount, 'settings-idle-minutes');
  const slider = findById(mount, 'settings-idle-minutes-slider');
  minutes.value = '30';
  minutes._listeners.input.forEach(function (fn) { fn({}); });
  assert.strictEqual(slider.value, '30');
  slider.value = '60';
  slider._listeners.input.forEach(function (fn) { fn({}); });
  assert.strictEqual(minutes.value, '60');
});

test('toggle change 联动禁用 minutes/slider', async () => {
  await openTab();
  const enabled = findById(mount, 'settings-idle-enabled');
  const minutes = findById(mount, 'settings-idle-minutes');
  const slider = findById(mount, 'settings-idle-minutes-slider');
  enabled.checked = false;
  enabled._listeners.change.forEach(function (fn) { fn({}); });
  assert.strictEqual(minutes.disabled, true);
  assert.strictEqual(slider.disabled, true);
  enabled.checked = true;
  enabled._listeners.change.forEach(function (fn) { fn({}); });
  assert.strictEqual(minutes.disabled, false);
});

test('submit：setLocale + setIdleConfig(checked×minutes×60000) + closeFormTab("settings")', async () => {
  await openTab();
  const form = findForm();
  const sel = findById(mount, 'settings-locale');
  sel.value = 'zh-CN';
  const enabled = findById(mount, 'settings-idle-enabled');
  enabled.checked = true;
  const minutes = findById(mount, 'settings-idle-minutes');
  minutes.value = '30';
  form._listeners.submit.forEach(function (fn) { fn({ preventDefault() {} }); });
  assert.deepStrictEqual(i18nMock.setLocaleCalls, ['zh-CN']);
  assert.deepStrictEqual(apiMock.views.setIdleConfigCalls, [{ timeoutMs: 1800000 }]);
  assert.deepStrictEqual(tabbarMock.closeFormTabCalls, ['settings']);
});

test('submit：toggle 关闭时 timeoutMs = 0', async () => {
  await openTab();
  const form = findForm();
  const enabled = findById(mount, 'settings-idle-enabled');
  enabled.checked = false;
  form._listeners.submit.forEach(function (fn) { fn({ preventDefault() {} }); });
  assert.deepStrictEqual(apiMock.views.setIdleConfigCalls, [{ timeoutMs: 0 }]);
});

test('submit：minutes 越界 clamp 到 [1, 1440]', async () => {
  await openTab();
  const form = findForm();
  const enabled = findById(mount, 'settings-idle-enabled');
  enabled.checked = true;
  const minutes = findById(mount, 'settings-idle-minutes');

  minutes.value = '0';
  form._listeners.submit.forEach(function (fn) { fn({ preventDefault() {} }); });
  minutes.value = '2000';
  form._listeners.submit.forEach(function (fn) { fn({ preventDefault() {} }); });
  assert.deepStrictEqual(apiMock.views.setIdleConfigCalls, [{ timeoutMs: 60000 }, { timeoutMs: 1440 * 60000 }]);
});

test('submit：非法 minutes（abc）回落 1 分钟', async () => {
  await openTab();
  const form = findForm();
  const enabled = findById(mount, 'settings-idle-enabled');
  enabled.checked = true;
  const minutes = findById(mount, 'settings-idle-minutes');
  minutes.value = 'abc';
  form._listeners.submit.forEach(function (fn) { fn({ preventDefault() {} }); });
  assert.deepStrictEqual(apiMock.views.setIdleConfigCalls, [{ timeoutMs: 60000 }]);
});

test('cancel 按钮：只关 tab，不写 idle 配置', async () => {
  await openTab();
  const form = findForm();
  const actions = form.children[form.children.length - 1];
  const cancel = actions.children[1];
  cancel.click();
  assert.deepStrictEqual(tabbarMock.closeFormTabCalls, ['settings']);
  assert.deepStrictEqual(apiMock.views.setIdleConfigCalls, []);
  assert.deepStrictEqual(i18nMock.setLocaleCalls, []);
});

test('close()：清空 mount 并隐藏', async () => {
  const m = await openTab();
  m.settingsTab.close();
  assert.strictEqual(mount.hidden, true);
  assert.strictEqual(mount.children.length, 0);
});

test('mount 不存在时 open() 不抛错（渲染层无挂载点场景）', async () => {
  const m = await buildWorld();
  m.initSettingsTab({ i18n: i18nMock, tabbar: tabbarMock });
  globalThis.document.querySelector = function () { return null; };
  assert.doesNotThrow(function () { m.settingsTab.open(); });
});

test('i18n onChange：tab 开着时重挂载，关着不动', async () => {
  await openTab();
  i18nMock._changeCbs.forEach(function (cb) { cb(); });
  assert.strictEqual(mount.children.length, 1);
  // 关闭后再广播：不重新挂载
  const m = { settingsTab: { close: function () {} } };
  const mod = await import('../../src/js/settings-tab.js');
  mod.settingsTab.close();
  i18nMock._changeCbs.forEach(function (cb) { cb(); });
  assert.strictEqual(mount.children.length, 0);
});

// ---- 诊断包导出（per issue #45）----

function findDiagBtn() {
  function walk(el) {
    if (el.tagName === 'BUTTON' && el.textContent === 'settings.diagnostics.btn') return el;
    for (const c of el.children) { const r = walk(c); if (r) return r; }
    return null;
  }
  return walk(mount);
}

test('诊断 fieldset：导出按钮渲染存在', async () => {
  await openTab();
  const btn = findDiagBtn();
  assert.ok(btn, '诊断导出按钮应存在于设置面板');
});

test('点击导出：调用 api.diagnostics.export，成功回显 done hint，按钮恢复可用', async () => {
  await openTab();
  const btn = findDiagBtn();
  btn.click();
  await new Promise(function (r) { setTimeout(r, 0); });
  assert.strictEqual(apiMock.diagnostics.exportCalls, 1);
  assert.strictEqual(btn.disabled, false);
  // i18n mock t() 返回 key：成功后 hint 应为 done key
  const form = findForm();
  function findHint(el) {
    if (el.className === 'settings-tab__hint' && el.textContent === 'settings.diagnostics.done') return el;
    for (const c of el.children) { const r = findHint(c); if (r) return r; }
    return null;
  }
  assert.ok(findHint(form), '成功后应有 done hint');
});

test('导出失败：回显 failed hint', async () => {
  await buildWorld({ diagResult: { ok: false, error: 'write_failed' } });
  const mod = await import('../../src/js/settings-tab.js');
  mod.initSettingsTab({ i18n: i18nMock, tabbar: tabbarMock });
  mod.settingsTab.open();
  await new Promise(function (r) { setTimeout(r, 0); });
  const btn = findDiagBtn();
  btn.click();
  await new Promise(function (r) { setTimeout(r, 0); });
  const form = findForm();
  function findFailed(el) {
    if (el.className === 'settings-tab__hint' && String(el.textContent).indexOf('settings.diagnostics.failed') === 0) return el;
    for (const c of el.children) { const r = findFailed(c); if (r) return r; }
    return null;
  }
  assert.ok(findFailed(form), '失败后应有 failed hint');
});
