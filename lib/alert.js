// lib/alert.js - 主进程侧统一弹窗 API
// 替代 dialog.showMessageBox：把弹窗交给渲染进程的 modal.js（暗色 UI 统一）。
// 数据流：views.js → showAppAlert(payload) → mainWindow.webContents.send('ui:dialog', {id, ...payload})
//       → 渲染进程 modal.js 渲染 → 用户点按钮 → ipcMain.on('ui:dialog:reply') 回调
//
// 设计要点：
// - 单实例 queue（多个并发 showAppAlert 按顺序排队，渲染进程 modal.js 是单 slot）
// - 主窗口销毁时静默 resolve 0（不阻塞业务；记录 warn 便于排查）
// - 超时 5 分钟（防止渲染进程崩溃导致永远挂起）

let _mainWindow = null;
const _pending = new Map();
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

function setMainWindow(win) { _mainWindow = win; }

function genId() {
  return 'dlg-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/**
 * 在主窗口里弹一个应用内模态框。返回 Promise<number>，resolve 用户点的按钮索引。
 *
 * @param {Object} payload
 * @param {'error'|'warn'|'info'} [payload.type='info']
 * @param {string} payload.title
 * @param {string} payload.message
 * @param {string} [payload.detail]
 * @param {string[]} [payload.buttons=['我知道了']]  alert 默认单按钮；confirm 传 ['取消','确定']
 * @param {number} [payload.defaultId=0]
 * @param {number} [payload.cancelId]  ESC 时 resolve 的索引
 * @param {boolean} [payload.dismissOnBackdrop=false]  警告类不建议允许
 * @param {number} [payload.timeoutMs]
 */
function showAppAlert(payload) {
  return new Promise((resolve) => {
    if (!_mainWindow || _mainWindow.isDestroyed()) {
      console.warn('[alert] mainWindow unavailable, skipping dialog:', payload && payload.title);
      resolve(payload && typeof payload.defaultId === 'number' ? payload.defaultId : 0);
      return;
    }
    const id = genId();
    const timeoutMs = (payload && payload.timeoutMs) || DEFAULT_TIMEOUT_MS;
    const safeResolve = (idx) => {
      clearTimeout(timer);
      _pending.delete(id);
      resolve(idx);
    };
    const timer = setTimeout(() => {
      console.warn('[alert] dialog timeout, auto-resolving defaultId:', payload && payload.title);
      safeResolve(payload && typeof payload.defaultId === 'number' ? payload.defaultId : 0);
    }, timeoutMs);
    _pending.set(id, safeResolve);
    try {
      _mainWindow.webContents.send('ui:dialog', {
        id,
        type: (payload && payload.type) || 'info',
        title: (payload && payload.title) || '',
        message: (payload && payload.message) || '',
        detail: (payload && payload.detail) || '',
        buttons: (payload && payload.buttons) || ['我知道了'],
        defaultId: (payload && typeof payload.defaultId === 'number') ? payload.defaultId : 0,
        cancelId: (payload && typeof payload.cancelId === 'number') ? payload.cancelId : null,
        dismissOnBackdrop: !!(payload && payload.dismissOnBackdrop),
      });
    } catch (e) {
      console.error('[alert] webContents.send failed:', e.message);
      safeResolve(0);
    }
  });
}

/**
 * 渲染进程回报按钮点击。id 必须与 ui:dialog 一致。
 */
function replyDialog(id, idx) {
  const r = _pending.get(id);
  if (r) r(typeof idx === 'number' ? idx : 0);
  else console.warn('[alert] reply for unknown dialog id:', id);
}

/**
 * 主窗口关闭时清理所有 pending，避免悬挂。
 */
function resetPending() {
  for (const r of _pending.values()) {
    try { r(0); } catch (_) { /* ignore */ }
  }
  _pending.clear();
}

module.exports = { setMainWindow, showAppAlert, replyDialog, resetPending };
