// lib/views.js - WebContentsView 池管理 facade（Phase 2：路径 B 单窗口 tab 切换）
// 主窗口中部嵌入多个 view，每个账号一个独立 session partition
//
// 自 #24 起按职责拆为三模块，本文件只做接线与对外 API 保持：
//   ./views/lifecycle.js — 账号池 / 焦点 / start-stop（pool 与 mainWindow 的属主）
//   ./views/layout.js    — 布局边界计算 / 沉浸模式分栏状态（可单测直连）
//   ./views/idle.js      — idle auto-stop 计时 / 倒计时广播（可单测直连）
// 对外导出与拆分前完全一致，消费方（main.js / ipc.js / metrics.js / selftest.js）无需改动。

const lifecycle = require('./views/lifecycle');
const layout = require('./views/layout');
const idle = require('./views/idle');

// 接线：layout / idle 不依赖 electron，运行时依赖由 facade 注入
layout.init({ getWindow: lifecycle.getMainWindow, pool: lifecycle.pool });
idle.init({ getWindow: lifecycle.getMainWindow, pool: lifecycle.pool, stopView: lifecycle.stopView });

module.exports = {
  setMainWindow: lifecycle.setMainWindow,
  hideFocused: lifecycle.hideFocused,
  resumeFocused: lifecycle.resumeFocused,
  isFocusedHidden: lifecycle.isFocusedHidden,
  startView: lifecycle.startView,
  stopView: lifecycle.stopView,
  focusView: lifecycle.focusView,
  reload: lifecycle.reload,
  openTampermonkeyPanel: lifecycle.openTampermonkeyPanel,
  listRunning: lifecycle.listRunning,
  getFocusedId: lifecycle.getFocusedId,
  getState: lifecycle.getState,
  getView: lifecycle.getView,
  getFocusedUrl: lifecycle.getFocusedUrl,
  onChange: lifecycle.onChange,
  setLayout: layout.setLayout,
  // === idle auto-stop 导出（per openspec/changes/idle-auto-stop）===
  getIdleTimeoutMs: idle.getIdleTimeoutMs,
  setIdleTimeoutMs: idle.setIdleTimeoutMs,
  disposeAllIdleTimers: idle.disposeAllIdleTimers,
  armIdleTimer: idle.armIdleTimer,
  // 倒计时 broadcast 由 idle 模块内部维护；renderer 通过 ipcMain.on('idle:countdown') 订阅
};
