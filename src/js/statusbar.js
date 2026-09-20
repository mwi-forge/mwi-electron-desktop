// src/js/statusbar.js - 底部状态条（Phase 4：metrics 实时数据）
// 订阅主进程推送的 metrics:update 事件，替换 Phase 0 占位的运行时长计时器
import { store as defaultStore } from './store.js';
import { i18n as defaultI18n } from './i18n.js';
import { tabbar as defaultTabbar } from './tabbar.js';
import { mwiAlert as defaultAlert } from './modal.js';

let store = null;
let i18n = null;
let tabbar = null;
let mwiAlert = null;

var elViews = null;
var elMem = null;
var elCpu = null;
var elUptime = null;
var elUrl = null;
var elUrlText = null;
var elApplyUrl = null;
var elIdleCountdown = null;

// 状态栏当前打开页面 URL：缓存最近一次 url，用于语言切换时重渲占位文案
var _lastUrlAccountId = null;
var _lastUrl = null;

function setUrl(accountId, url) {
  if (!elUrl) return;
  _lastUrlAccountId = accountId;
  _lastUrl = url;
  if (!url) {
    // 无 focused 视图 / 未加载出 URL：显示占位（写入内嵌 span，span 缺失时回退容器）
    (elUrlText || elUrl).textContent = t('statusbar.label.url_placeholder');
    elUrl.title = '';
    elUrl.className = 'statusbar__item statusbar__url statusbar__url--empty';
    updateApplyUrlButton();
    return;
  }
  (elUrlText || elUrl).textContent = url;  // 写入内嵌 span 保持省略生效；span 缺失时回退容器
  elUrl.title = url;
  elUrl.className = 'statusbar__item statusbar__url';
  updateApplyUrlButton();
}

function fmtUptime(sec) {
  var h = String(Math.floor(sec / 3600)).padStart(2, '0');
  var m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
  var s = String(sec % 60).padStart(2, '0');
  return h + ':' + m + ':' + s;
}

// i18n 助手（防御 i18n 未就绪）
function t(key, vars) {
  return (i18n && i18n.t) ? i18n.t(key, vars) : key;
}

// 「应用为URL」按钮：当前页 URL 与当前聚焦账号配置的 URL 不一致时显示；
// 点击把该账号的 URL 更新为当前页 URL（低频操作，仅需在状态栏轻点即可同步设置）。
function updateApplyUrlButton() {
  if (!elApplyUrl) return;
  elApplyUrl.textContent = t('statusbar.btn.apply_url');
  // 用「当前显示视图所属账号」而非 sidebar 选中账号，避免两者不一致时应用/对比错账号
  var accountId = _lastUrlAccountId;
  var st = store.get();
  var acc = accountId ? (st.accounts || []).find(function (a) { return a.id === accountId; }) : null;
  var configured = acc ? String(acc.url || '').trim() : '';
  var cur = String(_lastUrl || '').trim();
  var show = !!(cur && configured && cur !== configured);
  if (!show) { elApplyUrl.hidden = true; return; }
  elApplyUrl.hidden = false;
  if (!elApplyUrl._bound) {
    elApplyUrl.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      applyUrl();
    });
    elApplyUrl._bound = true;
  }
}

async function applyUrl() {
  var id = _lastUrlAccountId;  // 应用目标是当前显示视图所属账号
  var url = String(_lastUrl || '').trim();
  if (!id || !url) return;
  try {
    await window.api.accounts.update(id, { url: url });
    // 刷新账号列表进 store（账号配置已改变，按钮随 store 重估而隐藏）
    var list = await window.api.accounts.list();
    store.set({ accounts: list });
    updateApplyUrlButton();
  } catch (e) {
    if (mwiAlert) mwiAlert.alert({ type: 'error', message: t('statusbar.alert.apply_url_failed', { message: (e && e.message) || e }) });
  }
}

function render(snap) {
  if (!snap) return;
  if (elViews) {
    if (snap.maxViews > 0) {
      elViews.textContent = t('statusbar.label.views', { count: snap.viewsCount, max: snap.maxViews });
      elViews.className = 'statusbar__item' + (snap.viewsCount >= snap.maxViews ? ' statusbar__item--warn' : '');
    } else {
      // maxViews<=0 = 无限视图：只显示 count，不加 warn 高亮
      elViews.textContent = t('statusbar.label.views_unlimited', { count: snap.viewsCount });
      elViews.className = 'statusbar__item';
    }
  }
  if (elMem) {
    elMem.textContent = t('statusbar.label.mem_mb', { n: snap.memMB });
    elMem.className = 'statusbar__item' + (snap.memMB > 1500 ? ' statusbar__item--error' : snap.memMB > 800 ? ' statusbar__item--warn' : '');
  }
  if (elCpu) {
    elCpu.textContent = t('statusbar.label.cpu_pct', { pct: snap.cpuPct });
    elCpu.className = 'statusbar__item' + (snap.cpuPct > 80 ? ' statusbar__item--error' : snap.cpuPct > 50 ? ' statusbar__item--warn' : '');
  }
  if (elUptime) {
    elUptime.textContent = t('statusbar.label.uptime', { time: fmtUptime(snap.uptimeSec) });
    elUptime.className = 'statusbar__item';
  }
}

// === 空闲倒计时（per openspec/changes/idle-auto-stop 增强）===
// 主进程每秒 broadcast { items: [{ accountId, remainingMs, totalMs }] }；
// 显示当前 focused view 的 remaining；无 focused / 0 项 → 隐藏；< 30s 警告、< 10s 紧急
function fmtRemaining(ms) {
  var sec = Math.max(0, Math.ceil(ms / 1000));
  var m = Math.floor(sec / 60);
  var s = sec % 60;
  return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
}
function renderIdleCountdown(items) {
  if (!elIdleCountdown) return;
  if (!items || items.length === 0) {
    elIdleCountdown.classList.add('statusbar__item--hidden');
    elIdleCountdown.classList.remove('statusbar__item--warn', 'statusbar__item--error');
    elIdleCountdown.title = '';
    return;
  }
  // 多 view 时优先显示 focused tab 的 remaining；fallback 走第一个
  var item = items[0];
  if (items.length > 1 && tabbar && tabbar.getActiveTabId) {
    var activeId = tabbar.getActiveTabId();
    for (var i = 0; i < items.length; i++) if (items[i].accountId === activeId) { item = items[i]; break; }
  }
  var sec = Math.ceil(item.remainingMs / 1000);
  elIdleCountdown.textContent = t('statusbar.label.idle_countdown', { time: fmtRemaining(item.remainingMs) });
  elIdleCountdown.classList.remove('statusbar__item--hidden');
  elIdleCountdown.classList.remove('statusbar__item--warn', 'statusbar__item--error');
  if (sec <= 10) elIdleCountdown.classList.add('statusbar__item--error');
  else if (sec <= 30) elIdleCountdown.classList.add('statusbar__item--warn');
  elIdleCountdown.title = t('statusbar.tooltip.idle_countdown', { time: fmtRemaining(item.remainingMs) });
}

export const statusbar = { render: render };

export function initStatusbar(deps) {
  deps = deps || {};
  store = deps.store || defaultStore;
  i18n = deps.i18n || defaultI18n;
  tabbar = deps.tabbar || defaultTabbar;
  mwiAlert = deps.alert || defaultAlert;

  elViews = document.getElementById('stat-views');
  elMem = document.getElementById('stat-mem');
  elCpu = document.getElementById('stat-cpu');
  elUptime = document.getElementById('stat-uptime');
  elUrl = document.getElementById('stat-url');
  elUrlText = elUrl ? elUrl.querySelector('.statusbar__url-text') : null;
  elApplyUrl = document.getElementById('btn-apply-url');
  elIdleCountdown = document.getElementById('stat-idle-countdown');

  // 订阅 focused 视图 URL 实时推送 + 初始拉取
  if (window.api && window.api.views && typeof window.api.views.onUrlChanged === 'function') {
    window.api.views.onUrlChanged(function (data) {
      setUrl(data && data.accountId, data && data.url);
    });
  }
  if (window.api && window.api.views && typeof window.api.views.getFocusedUrl === 'function') {
    window.api.views.getFocusedUrl().then(function (info) { setUrl(info && info.accountId, (info && info.url) || ''); }).catch(function () {});
  }

  if (window.api && window.api.views && typeof window.api.views.onIdleCountdown === 'function') {
    window.api.views.onIdleCountdown(function (data) {
      renderIdleCountdown(data && data.items);
    });
  }

  // 订阅 metrics:update 实时推送
  window.api.metrics.onUpdate(render);

  // 初始拉一次快照（主进程 metrics loop 第一 tick 前的兜底）
  window.api.metrics.snapshot().then(render).catch(function (e) { console.error('[statusbar] snapshot failed', e); });

  // 语言切换时重新渲染（用最新一次 metrics 快照）
  // 但 metrics 没主动缓存最后值；用 onChange 触发一次新的 fetch 即可
  if (i18n && i18n.onChange) {
    i18n.onChange(function () {
      window.api.metrics.snapshot().then(render).catch(function () {});
      // 占位文案随语言切换重新渲染
      setUrl(_lastUrlAccountId, _lastUrl);
    });
  }

  // 账号/聚焦变化时重估「应用为URL」按钮显隐
  if (store && store.subscribe) {
    store.subscribe(updateApplyUrlButton);
  }
  updateApplyUrlButton();
}
