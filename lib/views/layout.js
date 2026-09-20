// lib/views/layout.js - view 布局边界计算与沉浸模式分栏状态（自 views.js 拆出，#24）
// 职责：computeViewBounds / setLayout / 拖拽余量；不依赖 electron，
// mainWindow 与 pool 经 init 注入（facade lib/views.js 接线），可被单测直接 require。

// 布局尺寸单一来源 lib/layout-metrics.js（与渲染层 CSS token 共享，批次 3 ISSUE-248）
// SIDEBAR_W / RIGHT_W 为默认宽，渲染进程拖拽可覆盖
const { TOOLBAR_H, TABBAR_H, STATUSBAR_H, SIDEBAR_W, RIGHT_W } = require('../layout-metrics');
const DRAG_GAP = 24;     // 拖拽期间给原生 view 的余量，防 view 抢走鼠标事件

// 运行时依赖：getWindow() 返回主窗口（可为 null）；pool 为 lifecycle 的账号池 Map
let deps = { getWindow: function () { return null; }, pool: new Map() };

function init(d) {
  deps = { getWindow: d.getWindow || deps.getWindow, pool: d.pool || deps.pool };
}

// 沉浸模式：折叠状态 + 自定义分栏宽度（渲染进程通过 IPC 同步）
let sidebarCollapsed = false;
let panelCollapsed = false;
let sidebarW = SIDEBAR_W;
let rightW = RIGHT_W;
let dragSide = null;  // 'sidebar' | 'panel' | null

function computeViewBounds() {
  const mainWindow = deps.getWindow();
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { x: SIDEBAR_W, y: TOOLBAR_H + TABBAR_H, width: 800, height: 600 };
  }
  const b = mainWindow.getContentBounds();
  // 拖拽中：正在拖的一侧多让出 DRAG_GAP，鼠标始终留在 chrome 页面内
  // （原生 WebContentsView 不会抢走 mousemove/mouseup，拖拽不中断）
  const gapL = dragSide === 'sidebar' ? DRAG_GAP : 0;
  const gapR = dragSide === 'panel' ? DRAG_GAP : 0;
  const left = sidebarCollapsed ? 0 : sidebarW + gapL;
  const right = panelCollapsed ? 0 : rightW + gapR;
  return {
    x: left,
    y: TOOLBAR_H + TABBAR_H,
    width: Math.max(b.width - left - right, 320),
    height: Math.max(b.height - TOOLBAR_H - TABBAR_H - STATUSBAR_H, 240),
  };
}

// 设置布局（折叠状态 / 分栏宽度 / 拖拽态），重算所有 view bounds
function clampNum(v, min, max) {
  if (typeof v !== 'number' || !isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

// 把当前布局 bounds 应用到池内所有 view（setLayout / 主窗口 resize 共用）
function applyLayoutToPool() {
  const bounds = computeViewBounds();
  for (const entry of deps.pool.values()) {
    try { entry.view.setBounds(bounds); } catch (e) { /* ignore */ }
  }
}

function setLayout(opts) {
  opts = opts || {};
  if (typeof opts.sidebar === 'boolean') sidebarCollapsed = opts.sidebar;
  if (typeof opts.panel === 'boolean') panelCollapsed = opts.panel;
  if (typeof opts.sidebarW === 'number') sidebarW = clampNum(opts.sidebarW, 160, 640);
  if (typeof opts.panelW === 'number') rightW = clampNum(opts.panelW, 200, 760);
  dragSide = (opts.dragging === 'sidebar' || opts.dragging === 'panel') ? opts.dragging : null;
  applyLayoutToPool();
  return { sidebar: sidebarCollapsed, panel: panelCollapsed, sidebarW: sidebarW, panelW: rightW };
}

module.exports = {
  init,
  DRAG_GAP,
  computeViewBounds,
  clampNum,
  applyLayoutToPool,
  setLayout,
};
