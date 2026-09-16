// src/js/bulk-actions.js - 工具栏「全部启动 / 全部停止」（全局批量启停）
// 依赖：window.api（preload）、store.js、modal.js、i18n.js、tabbar.js（操作后兜底同步）
// 策略（关键记忆，不可违反）：
//   * 代理启动失败是严重安全事件：逐账号收集失败并按账号列出，用 alert 报告，
//     绝不静默跳过、绝不吞掉代理失败错误（主进程在 !proxyRes.ok 时已弹阻塞模态并强制终止该 view）。
//   * 无并发视图上限（lib/views.js MAX_VIEWS=0=无限，用户显式去掉启动数量限制）：
//     一键启动全部未运行账号；全部停止则停止 runningIds 里所有账号。
//   * 已 running/starting 的账号不重复 start（start-all 前先过滤 runningIds）。
//   * 顺序 await 循环逐个启动/停止，避免同时大量启动造成竞争。
import { store as defaultStore } from './store.js';
import { i18n as defaultI18n } from './i18n.js';
import { tabbar as defaultTabbar } from './tabbar.js';
import { mwiAlert as defaultAlert } from './modal.js';

let store = null;
let i18n = null;
let tabbar = null;
let mwiAlert = null;

var btnStartAll = null;
var btnStopAll = null;
var busy = false;   // 批量操作进行中：禁止重入（防双击并发生成两个循环）

// i18n 助手：i18n 未就绪时回退 key 字面
function t(key, vars) {
  return (i18n && i18n.t) ? i18n.t(key, vars) : key;
}

function accountName(a) {
  return (a && a.name) || (a && a.id) || 'unknown';
}

// 刷新按钮 disabled 状态：无账号/无待启动 → 禁用 start-all；无运行中 → 禁用 stop-all
// 执行中（busy）强制禁用两按钮，避免被 store 变化重启用
function updateDisabled() {
  if (busy) {
    if (btnStartAll) btnStartAll.disabled = true;
    if (btnStopAll) btnStopAll.disabled = true;
    return;
  }
  var s = store.get();
  var running = s.runningIds || [];
  var pending = (s.accounts || []).filter(function (a) { return running.indexOf(a.id) === -1; });
  if (btnStartAll) btnStartAll.disabled = pending.length === 0;
  if (btnStopAll) btnStopAll.disabled = running.length === 0;
}

// 批量操作执行期间禁用两按钮；结束后（b=false）恢复按 state 计算
function setBusy(b) {
  if (b) {
    if (btnStartAll) btnStartAll.disabled = true;
    if (btnStopAll) btnStopAll.disabled = true;
  } else {
    updateDisabled();
  }
}

async function startAll() {
  if (busy) return; // 防双击并发：已有批量操作在执行
  var s = store.get();
  var accounts = s.accounts || [];
  if (!accounts.length) {
    mwiAlert.alert({ type: 'info', message: t('bulk.alert.no_accounts') });
    return;
  }
  var running = (s.runningIds || []).slice();
  var pending = accounts.filter(function (a) { return running.indexOf(a.id) === -1; });
  if (!pending.length) {
    mwiAlert.alert({ type: 'info', message: t('bulk.alert.no_pending') });
    return;
  }

  busy = true;
  setBusy(true);
  try {
    // 无并发上限（lib/views.js MAX_VIEWS=0=无限，用户显式去掉启动数量限制）：
    // 一键顺序启动全部未运行账号。视图池无节流/互斥，逐个 await 避免大量并发启动竞争。
    var failures = [];
    var started = 0;
    for (var i = 0; i < pending.length; i++) {
      var acc = pending[i];
      try {
        var r = await window.api.views.start(acc.id);
        if (r && r.ok === true) {
          started++; // C: 按实际成功数（r.ok===true）统计
        } else if (r && r.ok === false && r.error !== 'cancelled') {
          failures.push(t('bulk.alert.start_failed_item', { name: accountName(acc), error: r.error || 'unknown' }));
        }
      } catch (e) {
        failures.push(t('bulk.alert.start_failed_item', { name: accountName(acc), error: (e && e.message) || String(e) }));
      }
    }

    // 兜底同步 tab 栏（主进程会广播 state-changed，这里再拉一次确保一致）
    if (tabbar && tabbar.refresh) {
      try { await tabbar.refresh(); } catch (e) {}
    }

    var msgs = [];
    if (started > 0) {
      msgs.push(t('bulk.alert.started_count', { count: started }));
    }
    if (failures.length > 0) {
      msgs.push(t('bulk.alert.start_failed_summary', { count: failures.length, failures: failures.join('\n') }));
    }
    if (!msgs.length) return; // 防御：无成功且无失败时静默

    var type = failures.length > 0 ? 'error' : 'info';
    mwiAlert.alert({ type: type, message: msgs.join('\n') });
  } finally {
    busy = false;
    setBusy(false);
  }
}

async function stopAll() {
  if (busy) return; // 防双击并发：已有批量操作在执行
  var running = (store.get().runningIds || []).slice();
  if (!running.length) {
    mwiAlert.alert({ type: 'info', message: t('bulk.alert.no_running') });
    return;
  }

  busy = true;
  setBusy(true);
  try {
    // 顺序停止 runningIds 里所有账号（含 'starting' 的，用于取消启动）
    for (var i = 0; i < running.length; i++) {
      try { await window.api.views.stop(running[i]); } catch (e) { /* ignore */ }
    }
    if (tabbar && tabbar.refresh) {
      try { await tabbar.refresh(); } catch (e) {}
    }
    mwiAlert.alert({ type: 'info', message: t('bulk.alert.stopped_count', { count: running.length }) });
  } finally {
    busy = false;
    setBusy(false);
  }
}

export const bulkActions = { startAll: startAll, stopAll: stopAll, updateDisabled: updateDisabled };

export function initBulkActions(deps) {
  deps = deps || {};
  store = deps.store || defaultStore;
  i18n = deps.i18n || defaultI18n;
  tabbar = deps.tabbar || defaultTabbar;
  mwiAlert = deps.alert || defaultAlert;

  btnStartAll = document.getElementById('btn-start-all');
  btnStopAll = document.getElementById('btn-stop-all');
  if (btnStartAll) btnStartAll.addEventListener('click', function () { startAll().catch(function (e) { console.error('[bulk] startAll failed', e); }); });
  if (btnStopAll) btnStopAll.addEventListener('click', function () { stopAll().catch(function (e) { console.error('[bulk] stopAll failed', e); }); });

  store.subscribe(updateDisabled);
  if (i18n && i18n.onChange) {
    i18n.onChange(function () { updateDisabled(); });
  }
  updateDisabled();
}
