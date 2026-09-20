// lib/__tests__/views-layout.test.js - view 布局边界计算单测（#24 拆分后直连 lib/views/layout.js）
// layout.js 不依赖 electron，getWindow/pool 注入假实现即可验证 bounds 数学与 clamp 规则。
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { TOOLBAR_H, TABBAR_H, STATUSBAR_H, SIDEBAR_W, RIGHT_W } = require(path.join(__dirname, '..', 'layout-metrics'));

const LAYOUT_PATH = require.resolve(path.join(__dirname, '..', 'views', 'layout.js'));

function makeWin(w, h) {
  return { isDestroyed: function () { return false; }, getContentBounds: function () { return { x: 0, y: 0, width: w, height: h }; } };
}

// 每例重建：layout 的分栏状态是模块级，用 setLayout 全量复位 + 重新 init
function freshLayout(win) {
  delete require.cache[LAYOUT_PATH];
  const layout = require('../views/layout');
  const pool = new Map();
  const boundsCalls = [];
  layout.init({
    getWindow: function () { return win || null; },
    pool: pool,
  });
  // 复位到默认布局
  layout.setLayout({ sidebar: false, panel: false, sidebarW: SIDEBAR_W, panelW: RIGHT_W, dragging: null });
  return {
    layout: layout,
    pool: pool,
    boundsCalls: boundsCalls,
    addEntry: function (id) {
      const entry = { view: { setBounds: function (b) { boundsCalls.push(b); } } };
      pool.set(id, entry);
      return entry;
    },
  };
}

test('无主窗口时返回固定 fallback bounds', () => {
  const ctx = freshLayout(null);
  assert.deepStrictEqual(ctx.layout.computeViewBounds(), { x: SIDEBAR_W, y: TOOLBAR_H + TABBAR_H, width: 800, height: 600 });
});

test('默认布局：1280x800 下 view 占中部区域', () => {
  const ctx = freshLayout(makeWin(1280, 800));
  assert.deepStrictEqual(ctx.layout.computeViewBounds(), {
    x: SIDEBAR_W, y: TOOLBAR_H + TABBAR_H,
    width: 1280 - SIDEBAR_W - RIGHT_W, height: 800 - TOOLBAR_H - TABBAR_H - STATUSBAR_H,
  });
});

test('sidebar 折叠后 x 从 0 起、宽度让出左栏', () => {
  const ctx = freshLayout(makeWin(1280, 800));
  ctx.layout.setLayout({ sidebar: true });
  const b = ctx.layout.computeViewBounds();
  assert.strictEqual(b.x, 0);
  assert.strictEqual(b.width, 1280 - RIGHT_W);
});

test('拖拽中：被拖侧让出 DRAG_GAP 余量', () => {
  const ctx = freshLayout(makeWin(1280, 800));
  ctx.layout.setLayout({ dragging: 'sidebar' });
  assert.strictEqual(ctx.layout.computeViewBounds().x, SIDEBAR_W + ctx.layout.DRAG_GAP);
  ctx.layout.setLayout({ dragging: 'panel' });
  const b = ctx.layout.computeViewBounds();
  assert.strictEqual(b.x, SIDEBAR_W);
  assert.strictEqual(b.width, 1280 - SIDEBAR_W - RIGHT_W - ctx.layout.DRAG_GAP);
});

test('setLayout 宽度 clamp：sidebarW 上限 640 / panelW 下限 200', () => {
  const ctx = freshLayout(makeWin(1280, 800));
  const r1 = ctx.layout.setLayout({ sidebarW: 9999, panelW: -5 });
  assert.strictEqual(r1.sidebarW, 640);
  assert.strictEqual(r1.panelW, 200);
});

test('setLayout 非法数值（NaN/Infinity）回落到下限', () => {
  const ctx = freshLayout(makeWin(1280, 800));
  const r = ctx.layout.setLayout({ sidebarW: NaN, panelW: Infinity });
  assert.strictEqual(r.sidebarW, 160);
  assert.strictEqual(r.panelW, 200);
});

test('setLayout 返回快照形状 { sidebar, panel, sidebarW, panelW }', () => {
  const ctx = freshLayout(makeWin(1280, 800));
  const r = ctx.layout.setLayout({ sidebar: true, panel: true, sidebarW: 300, panelW: 400 });
  assert.deepStrictEqual(Object.keys(r).sort(), ['panel', 'panelW', 'sidebar', 'sidebarW']);
  assert.deepStrictEqual(r, { sidebar: true, panel: true, sidebarW: 300, panelW: 400 });
});

test('布局变更应用到池内全部 view', () => {
  const ctx = freshLayout(makeWin(1280, 800));
  ctx.addEntry('acc_1');
  ctx.addEntry('acc_2');
  ctx.layout.setLayout({ sidebar: true });
  assert.strictEqual(ctx.boundsCalls.length, 2);
  assert.deepStrictEqual(ctx.boundsCalls[0], ctx.boundsCalls[1]);
  assert.strictEqual(ctx.boundsCalls[0].x, 0);
});

test('applyLayoutToPool：单个 view setBounds 抛错不影响其余 view', () => {
  const ctx = freshLayout(makeWin(1280, 800));
  ctx.pool.set('bad', { view: { setBounds: function () { throw new Error('destroyed'); } } });
  ctx.addEntry('good');
  assert.doesNotThrow(function () { ctx.layout.applyLayoutToPool(); });
  assert.strictEqual(ctx.boundsCalls.length, 1);
});

test('clampNum：非有限数值返回下限，区间两端收敛', () => {
  const ctx = freshLayout(makeWin(1280, 800));
  const clampNum = ctx.layout.clampNum;
  assert.strictEqual(clampNum(NaN, 3, 9), 3);
  assert.strictEqual(clampNum('x', 3, 9), 3);
  assert.strictEqual(clampNum(1, 3, 9), 3);
  assert.strictEqual(clampNum(99, 3, 9), 9);
  assert.strictEqual(clampNum(5, 3, 9), 5);
});
