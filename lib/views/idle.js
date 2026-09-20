// lib/views/idle.js - idle auto-stop 计时与倒计时广播（自 views.js 拆出，#24）
// 职责：per-view idle timer 装卸、单例 countdown ticker、阈值读写持久化。
// 不依赖 electron：pool / getWindow / stopView 经 init 注入（facade lib/views.js 接线），
// electron-store 支持注入（单测用假 store），可被单测直接 require。

// === idle auto-stop 配置（per openspec/changes/idle-auto-stop）===
// 全局唯一阈值；0 表示禁用。默认 5 分钟（per 用户 STORY 2026-08-23）。
const IDLE_AUTOSTOP_DEFAULT_MS = 5 * 60 * 1000;
const VIEWS_STORE_SCHEMA = { idleAutoStopMs: { type: 'number', minimum: 0, default: IDLE_AUTOSTOP_DEFAULT_MS } };

// 运行时依赖：pool 为 lifecycle 的账号池 Map；getWindow() 返回主窗口；
// stopView(accountId, reason) 由 lifecycle 注入（timer fire 时回调）；store 可注入假实现
let deps = {
  getWindow: function () { return null; },
  pool: new Map(),
  stopView: function () {},
  store: null,
};
let initialized = false;
let storeInstance = null;

function getStore() {
  if (deps.store) return deps.store;
  if (!storeInstance) {
    const Store = require('electron-store');
    storeInstance = new Store({ name: 'views', schema: VIEWS_STORE_SCHEMA, clearInvalidConfig: false });
  }
  return storeInstance;
}

// facade require 时调用：注入依赖并从持久化读回阈值（读失败回退默认值）
function init(d) {
  deps = {
    getWindow: d.getWindow || deps.getWindow,
    pool: d.pool || deps.pool,
    stopView: d.stopView || deps.stopView,
    store: d.store !== undefined ? d.store : deps.store,
  };
  if (initialized) return;
  initialized = true;
  try { idleTimeoutMs = getStore().get('idleAutoStopMs'); } catch (_e) { /* fallback default */ }
}

let idleTimeoutMs = IDLE_AUTOSTOP_DEFAULT_MS;
let countdownTicker = null;  // 单例：首个 view 启动时建，最后一个 view 停止时拆

// armIdleTimer: 给某 view 装一个 setTimeout，剩余时间 = idleTimeoutMs - (now - lastActivityAt)
// 若 idleTimeoutMs === 0（功能关闭）则 no-op；已有 timer 时先 clearTimeout 再装新的
// timer fire 时调 stopView(accountId, 'idle_timeout') 让 emitState 输出 'stopped:idle_timeout'
// 同时维护单例 countdownTicker（定期广播各 view remaining ms）让 statusbar 实时显示倒计时
function armIdleTimer(accountId) {
  const entry = deps.pool.get(accountId);
  if (!entry) return;
  if (idleTimeoutMs <= 0) {
    // 功能关闭：清掉已存在的 timer
    if (entry.idleTimer) { clearTimeout(entry.idleTimer); entry.idleTimer = null; }
    return;
  }
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  const remaining = Math.max(0, idleTimeoutMs - (Date.now() - (entry.lastActivityAt || Date.now())));
  entry.idleTimer = setTimeout(function () {
    try { deps.stopView(accountId, 'idle_timeout'); } catch (_e) { /* ignore */ }
  }, remaining);
  // 启动 / 维护 countdown ticker（仅在有 running view 且功能开启时）
  ensureCountdownTicker();
}

// ensureCountdownTicker: 单例 setInterval 维护。首个 armIdleTimer 时启动；所有 view 都停或功能关闭时拆
function ensureCountdownTicker() {
  if (countdownTicker) return;  // 已存在
  if (idleTimeoutMs <= 0) return;  // 功能关闭不需要 ticker
  if (deps.pool.size === 0) return;
  // 5 秒间隔（per perf 优化：每秒 broadcast 对 IPC 是浪费；statusbar 显示精度足够）
  // 活动重置时由 resetActivity 立即 broadcast 一次，无需等 ticker
  countdownTicker = setInterval(broadcastCountdown, 5000);
}

function stopCountdownTickerIfIdle() {
  if (!countdownTicker) return;
  if (deps.pool.size === 0 || idleTimeoutMs <= 0) {
    clearInterval(countdownTicker);
    countdownTicker = null;
  }
}

// broadcastCountdown: 给每个 running view 算 remaining ms 推送到 renderer
// 通过 mainWindow.webContents.send('idle:countdown', items) 广播（main.js 在 setMainWindow 时注册）
function broadcastCountdown() {
  if (idleTimeoutMs <= 0 || deps.pool.size === 0) return;
  const now = Date.now();
  const items = [];
  for (const [accId, entry] of deps.pool) {
    if (!entry) continue;
    const remaining = Math.max(0, idleTimeoutMs - (now - (entry.lastActivityAt || now)));
    items.push({ accountId: accId, remainingMs: remaining, totalMs: idleTimeoutMs });
  }
  if (items.length === 0) return;
  try {
    const mainWindow = deps.getWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('idle:countdown', { items: items, ts: now });
    }
  } catch (_e) { /* ignore */ }
}

// lifecycle.focusView 的双保险广播：仅当 ticker 已武装时立即推一次倒计时（原 views.js 逐字语义）
function broadcastCountdownIfArmed() {
  if (countdownTicker) broadcastCountdown();
}

// disarmIdleTimer: 清掉某 view 已装的 timer；幂等
function disarmIdleTimer(accountId) {
  const entry = deps.pool.get(accountId);
  if (!entry) return;
  if (entry.idleTimer) { clearTimeout(entry.idleTimer); entry.idleTimer = null; }
  // view 停止后检查 ticker 是否需要拆
  stopCountdownTickerIfIdle();
  // 触发一次广播，把这条 view 从 items 移除（remaining=0 即可让 UI 隐藏）
  if (countdownTicker) broadcastCountdown();
}

// resetActivity: 把 lastActivityAt 推到当前并重新 arm；活动源 / focusView / startView 都走这条
function resetActivity(accountId) {
  const entry = deps.pool.get(accountId);
  if (!entry) return;
  entry.lastActivityAt = Date.now();
  armIdleTimer(accountId);
  // 立即广播一次：活动重置后 UI 应立即反映新 remaining（不等 5s ticker）
  if (countdownTicker) broadcastCountdown();
}

// disposeAllIdleTimers: app before-quit 时调，清空所有未 fire 的 timer（防 setTimeout 在 quit 后触发）
function disposeAllIdleTimers() {
  for (const e of deps.pool.values()) {
    if (e && e.idleTimer) { try { clearTimeout(e.idleTimer); } catch (_) {} e.idleTimer = null; }
  }
  if (countdownTicker) { clearInterval(countdownTicker); countdownTicker = null; }
}

// getIdleTimeoutMs / setIdleTimeoutMs: 供 lib/ipc.js 调用；setter 同步刷所有 running view 的 timer
function getIdleTimeoutMs() { return idleTimeoutMs; }
function setIdleTimeoutMs(ms) {
  const v = Number(ms);
  if (!Number.isFinite(v) || v < 0) throw new Error('invalid timeoutMs');
  idleTimeoutMs = v;
  try { getStore().set('idleAutoStopMs', v); } catch (_e) { /* swallow per design R4 */ }
  // 配置变更后重置 ticker：可能从有到无（timeoutMs=0），或从无到有（>0 且有 running view）
  if (v <= 0 || deps.pool.size === 0) {
    stopCountdownTickerIfIdle();
  } else {
    ensureCountdownTicker();
  }
  for (const id of deps.pool.keys()) armIdleTimer(id);
}

module.exports = {
  IDLE_AUTOSTOP_DEFAULT_MS,
  init,
  armIdleTimer,
  disarmIdleTimer,
  resetActivity,
  broadcastCountdownIfArmed,
  disposeAllIdleTimers,
  getIdleTimeoutMs,
  setIdleTimeoutMs,
  // 倒计时 broadcast 由模块内部维护；renderer 通过 ipcMain.on('idle:countdown') 订阅
};
