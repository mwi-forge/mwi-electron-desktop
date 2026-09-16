// src/js/panel.js - 右侧详情 + 操作按钮组 + 日志流（Phase 3 完整版）
import { store as defaultStore } from './store.js';
import { i18n as defaultI18n } from './i18n.js';
import { tabbar as defaultTabbar } from './tabbar.js';
import { sidebar as defaultSidebar } from './sidebar.js';
import { mwiAlert as defaultAlert } from './modal.js';

let store = null;
let i18n = null;
let tabbar = null;
let sidebar = null;
let mwiAlert = null;

let bodyRoot = null;
let logsRoot = null;
const MAX_VISIBLE_LOGS = 50;
const CARD_KEY = 'mwi:panel:card-collapsed';

// 默认收起：未启动时不需要展开卡片，让中间游戏视图占更多视觉空间
// 只有用户在历史会话里显式展开过（localStorage === '0'）才保持展开
let cardCollapsed = true;
try {
  var _stored = localStorage.getItem(CARD_KEY);
  if (_stored === '0') cardCollapsed = false;
} catch (e) { /* ignore */ }

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function fmtTime(ts) {
  var d = new Date(ts);
  var h = String(d.getHours()).padStart(2, '0');
  var m = String(d.getMinutes()).padStart(2, '0');
  var s = String(d.getSeconds()).padStart(2, '0');
  return h + ':' + m + ':' + s;
}

// i18n 助手：保证 t() 在 i18n 未就绪时回退到 key 字符串
function t(key, vars) {
  return (i18n && i18n.t) ? i18n.t(key, vars) : key;
}

function renderBody() {
  var s = store.get();
  var id = s.focusedAccountId;
  if (!id) {
    bodyRoot.innerHTML = '<div class="panel__empty">' + t('panel.empty.no_selection') + '</div>';
    return null;
  }
  var acc = s.accounts.find(function (a) { return a.id === id; });
  if (!acc) {
    bodyRoot.innerHTML = '<div class="panel__empty">' + t('panel.empty.not_found') + '</div>';
    return null;
  }
  var isRunning = (s.runningIds || []).indexOf(acc.id) !== -1;
  var group = s.groups.find(function (g) { return g.id === acc.groupId; });
  var groupName = group ? group.name : '-';

  bodyRoot.innerHTML = [
    '<div class="panel__account' + (cardCollapsed ? ' panel__account--collapsed' : '') + '">',
    '<div class="panel__account-head">',
    '<span class="panel__account-name" title="' + escapeHtml(acc.name) + '">' + escapeHtml(acc.name) + '</span>',
    '<span class="panel__value panel__value--' + (isRunning ? 'running' : 'stopped') + '">' + (isRunning ? t('panel.status.running') : t('panel.status.stopped')) + '</span>',
    '<button class="panel__collapse-btn" data-action="collapse-card" title="' + (cardCollapsed ? t('panel.btn.expand.title') : t('panel.btn.collapse.title')) + '" aria-label="' + (cardCollapsed ? t('panel.btn.expand.title') : t('panel.btn.collapse.title')) + '"></button>',
    '</div>',
    '<div class="panel__account-detail">',
    '<div class="panel__row"><span class="panel__label">' + t('panel.field.url') + '</span><span class="panel__value panel__value--url">' + escapeHtml(acc.url) + '</span></div>',
    '<div class="panel__row"><span class="panel__label">' + t('panel.field.group') + '</span><span class="panel__value">' + escapeHtml(groupName) + '</span></div>',
    '<div class="panel__row"><span class="panel__label">' + t('panel.field.fingerprint') + '</span><span class="panel__value">' + escapeHtml(acc.fingerprintPreset) + '</span></div>',
    '<div class="panel__actions">',
    isRunning
      ? '<button class="btn" data-action="stop">' + t('panel.btn.stop') + '</button>'
      : '<button class="btn btn--accent" data-action="start">' + t('panel.btn.start') + '</button>',
    '<button class="btn" data-action="reload"' + (isRunning ? '' : ' disabled') + '>' + t('panel.btn.refresh') + '</button>',
    '<button class="btn" data-action="edit">' + t('panel.btn.edit') + '</button>',
    '<button class="btn" data-action="copy">' + t('panel.btn.copy') + '</button>',
    '<button class="btn" data-action="tampermonkey"' + (isRunning ? '' : ' disabled') + ' title="' + t('panel.btn.tampermonkey.title') + '">' + t('panel.btn.tampermonkey') + '</button>',
    '<button class="btn btn--danger" data-action="remove">' + t('panel.btn.remove') + '</button>',
    '</div>',
    '</div>',
    '</div>',
  ].join('');

  var collapseBtn = bodyRoot.querySelector('[data-action="collapse-card"]');
  if (collapseBtn) collapseBtn.addEventListener('click', function () {
    cardCollapsed = !cardCollapsed;
    try { localStorage.setItem(CARD_KEY, cardCollapsed ? '1' : '0'); } catch (e) { /* ignore */ }
    renderBody();
  });
  var startBtn = bodyRoot.querySelector('[data-action="start"]');
  if (startBtn) startBtn.addEventListener('click', async function () {
    // 启动前清掉 preview tab（如有），避免同一账号同时出现在 preview + game tab
    if (tabbar && tabbar.clearPreviewTab &&
        tabbar.getPreviewTabId && tabbar.getPreviewTabId() === acc.id) {
      tabbar.clearPreviewTab();
    }
    var r = await window.api.views.start(acc.id);
    if (r && r.ok === false && r.error !== 'cancelled') {
      mwiAlert.alert({ type: 'error', message: t('panel.alert.start_failed', { error: r.error || 'unknown' }) });
      return;
    }
    // 启动成功后收起卡片（持久化），让中间 WebContentsView 区域聚焦游戏视图
    if (!cardCollapsed) {
      cardCollapsed = true;
      try { localStorage.setItem(CARD_KEY, '1'); } catch (e) { /* ignore */ }
      renderBody();
    }
  });
  var stopBtn = bodyRoot.querySelector('[data-action="stop"]');
  if (stopBtn) stopBtn.addEventListener('click', async function () {
    await window.api.views.stop(acc.id);
  });
  var reloadBtn = bodyRoot.querySelector('[data-action="reload"]');
  if (reloadBtn && isRunning) reloadBtn.addEventListener('click', async function () {
    await window.api.views.reload(acc.id);
  });
  var editBtn = bodyRoot.querySelector('[data-action="edit"]');
  if (editBtn) editBtn.addEventListener('click', function () {
    if (sidebar && sidebar.openModal) {
      sidebar.openModal(acc);
    }
  });
  var copyBtn = bodyRoot.querySelector('[data-action="copy"]');
  if (copyBtn) copyBtn.addEventListener('click', async function () {
    try {
      await navigator.clipboard.writeText(JSON.stringify(acc, null, 2));
      console.log('[mwi panel] copied config for', acc.id);
    } catch (e) {
      mwiAlert.alert({ type: 'error', message: t('panel.alert.copy_failed', { message: e.message || e }) });
    }
  });
  var tmBtn = bodyRoot.querySelector('[data-action="tampermonkey"]');
  if (tmBtn) tmBtn.addEventListener('click', async function () {
    var r = await window.api.tampermonkey.openPanel(acc.id);
    if (r && r.ok === false) mwiAlert.alert({ type: 'error', message: t('panel.alert.tm_open_failed', { error: r.error || 'unknown' }) });
  });
  var removeBtn = bodyRoot.querySelector('[data-action="remove"]');
  if (removeBtn) removeBtn.addEventListener('click', async function () {
    if (!await mwiAlert.confirm({ message: t('panel.confirm.remove', { name: acc.name }) })) return;
    if (isRunning) await window.api.views.stop(acc.id);
    await window.api.accounts.remove(acc.id);
    store.set({ focusedAccountId: null });
    if (sidebar) await sidebar.refresh();
  });

  return acc;
}

async function renderLogs() {
  var id = store.get().focusedAccountId;
  if (!id) {
    logsRoot.innerHTML = '';
    return;
  }
  var entries = await window.api.logs.list(id, MAX_VISIBLE_LOGS);
  if (entries.length === 0) {
    logsRoot.innerHTML = '<li class="log-empty">' + t('panel.logs.empty') + '</li>';
    return;
  }
  var parts = [];
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    parts.push(
      '<li class="log log--' + escapeHtml(e.level) + '">' +
      '<span class="log__time">' + fmtTime(e.timestamp) + '</span>' +
      '<span class="log__level">' + escapeHtml(e.level.toUpperCase()) + '</span>' +
      '<span class="log__msg">' + escapeHtml(e.message) + '</span>' +
      '</li>'
    );
  }
  logsRoot.innerHTML = parts.join('');
  var logsPanel = document.getElementById('panel-logs');
  if (logsPanel) logsPanel.scrollTop = logsPanel.scrollHeight;
}

function render() {
  renderBody();
  renderLogs();
}

export const panel = { render: render };

export function initPanel(deps) {
  deps = deps || {};
  store = deps.store || defaultStore;
  i18n = deps.i18n || defaultI18n;
  tabbar = deps.tabbar || defaultTabbar;
  sidebar = deps.sidebar || defaultSidebar;
  mwiAlert = deps.alert || defaultAlert;

  bodyRoot = document.getElementById('panel-body');
  logsRoot = document.getElementById('logs-list');

  window.api.logs.onAppend(function (data) {
    if (data.accountId === store.get().focusedAccountId) {
      renderLogs();
    }
  });

  window.api.views.onStateChanged(function (data) {
    if (data.accountId === store.get().focusedAccountId) {
      renderBody();
    }
  });

  store.subscribe(render);

  // 语言切换时重新渲染 panel body + logs
  if (i18n && i18n.onChange) {
    i18n.onChange(function () { render(); });
  }
}
