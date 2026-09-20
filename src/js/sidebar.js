// src/js/sidebar.js - 左侧分组树 + 账号 CRUD UI
// 依赖经 initSidebar(deps) 显式注入（缺省用各模块默认导出）
import { store as defaultStore } from './store.js';
import { i18n as defaultI18n } from './i18n.js';
import { tabbar as defaultTabbar } from './tabbar.js';
import { mwiAlert as defaultAlert } from './modal.js';

// 协作者引用（init 运行期绑定——与 tabbar.js 循环依赖，顶层读 default 会 TDZ）
let store = null;
let i18n = null;
let tabbar = null;
let mwiAlert = null;

let root = null;
let addBtn = null;
let quickAddBtn = null;

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// i18n helper
function t(key, vars) {
  return (i18n && i18n.t) ? i18n.t(key, vars) : key;
}

// onChange 订阅防御：历史 IIFE 版本存在脚本加载顺序耦合（可能早于 i18n.js 执行），
// ESM 化后 import 已保证 i18n 可用；lazy subscribe 兜底保留（任何一次 render 触发后尝试订阅，
// 已订阅的不重复）。
let _i18nSubscribed = false;
function ensureI18nSubscribed() {
  if (_i18nSubscribed) return;
  if (i18n && i18n.onChange) {
    i18n.onChange(function () { render(); });
    _i18nSubscribed = true;
  }
}

// 默认组名翻译：lib/accounts.js schema 里写死中文已落盘到 accounts.json；
// 渲染时按 name 映射到 t() key，让旧数据也能翻译无需迁移
var DEFAULT_GROUP_NAMES = {
  '默认分组': 'sidebar.group.default_name',  // grp_farm 已删除（per 2026-08-19 user）
};
function displayGroupName(name) {
  var key = DEFAULT_GROUP_NAMES[name];
  return key ? t(key) : (name || '');
}

function render() {
  ensureI18nSubscribed();  // lazy 触发 onChange 订阅兜底
  var s = store.get();
  if (!s.accounts.length) {
    root.innerHTML = '<div class="sidebar__empty">' + t('sidebar.empty') + '</div>';
    return;
  }

  var parts = [];
  var groups = s.groups.slice().sort(function (a, b) { return a.order - b.order; });
  for (var i = 0; i < groups.length; i++) {
    var g = groups[i];
    var inGroup = s.accounts.filter(function (a) { return a.groupId === g.id; });
    var collapsed = !!g.collapsed;
    parts.push('<div class="group" data-group-id="' + g.id + '">');
    parts.push(
      '<div class="group__header" data-toggle="' + g.id + '">' +
      '<span class="group__caret">' + (collapsed ? '&gt;' : 'v') + '</span>' +
      '<span class="group__name">' + escapeHtml(displayGroupName(g.name)) + '</span>' +
      '<span class="group__count">(' + inGroup.length + ')</span>' +
      '</div>'
    );
    if (!collapsed) {
      parts.push('<ul class="account-list">');
      for (var j = 0; j < inGroup.length; j++) {
        var a = inGroup[j];
        var focused = s.focusedAccountId === a.id;
        var st = (s.viewStates || {})[a.id] || 'stopped';
        var isRunning = st === 'running';
        var isError = typeof st === 'string' && st.indexOf('error') === 0;
        // 快捷启动/停止：runningIds 涵盖 'starting' + 'running'（tabbar 同步），
        // 启动中也能点停止来取消；判断标准与右侧详情面板一致。
        var isActive = (s.runningIds || []).indexOf(a.id) !== -1;
        var dotClass = isRunning ? 'account__dot--running' : (isError ? 'account__dot--error' : 'account__dot--stopped');
        var dotTitle = isRunning ? t('sidebar.status.running') : (isError ? t('sidebar.status.error') : t('sidebar.status.stopped'));
        parts.push(
          '<li class="account' + (focused ? ' account--focused' : '') + '" data-account-id="' + a.id + '">' +
          '<span class="account__dot ' + dotClass + '" title="' + dotTitle + '">o</span>' +
          '<span class="account__name">' + escapeHtml(a.name) + '</span>' +
          '<span class="account__actions">' +
          '<button class="btn-icon btn-icon--toggle' + (isActive ? ' btn-icon--stop' : '') + '" data-action="toggle" data-id="' + a.id + '" data-running="' + (isActive ? '1' : '0') + '" title="' + t(isActive ? 'sidebar.btn.stop.title' : 'sidebar.btn.start.title') + '">' + (isActive ? '[S]' : '[P]') + '</button>' +
          '</span>' +
          '</li>'
        );
      }
      parts.push('</ul>');
    }
    parts.push('</div>');
  }
  root.innerHTML = parts.join('');

  root.querySelectorAll('[data-toggle]').forEach(function (el) {
    el.addEventListener('click', async function () {
      var s2 = store.get();
      var g = s2.groups.find(function (x) { return x.id === el.dataset.toggle; });
      if (!g) return;
      await window.api.groups.update(g.id, { collapsed: !g.collapsed });
      await refresh();
    });
  });

  root.querySelectorAll('.account').forEach(function (el) {
    el.addEventListener('click', function (ev) {
      if (ev.target.closest('.account__actions')) return;
      var id = el.dataset.accountId;
      store.set({ focusedAccountId: id });
      var cur = store.get();
      if ((cur.runningIds || []).indexOf(id) !== -1) {
        // 已启动：focus game tab + resume focused view
        window.api.views.focus(id).catch(function () {});
        if (tabbar && tabbar.clearPreviewTab) {
          tabbar.clearPreviewTab();
          tabbar.render();
        }
      } else {
        // 未启动：创建 preview tab + 显示 placeholder 默认界面
        // 切到其他 tab 时自动关闭（focusGameTab / focusFormTab / closeAllFormTabs 内清）
        if (tabbar && tabbar.setPreviewTab) {
          tabbar.setPreviewTab(id);
        }
      }
    });
  });

  root.querySelectorAll('[data-action]').forEach(function (el) {
    el.addEventListener('click', async function (ev) {
      ev.stopPropagation();
      var action = el.dataset.action;
      var id = el.dataset.id;
      if (action === 'toggle') {
        var running = (store.get().runningIds || []).indexOf(id) !== -1;
        if (running) {
          await window.api.views.stop(id);
        } else {
          // 启动前清掉同一账号的 preview tab（与 panel.js 启动逻辑一致）
          if (tabbar && tabbar.clearPreviewTab &&
              tabbar.getPreviewTabId && tabbar.getPreviewTabId() === id) {
            tabbar.clearPreviewTab();
          }
          var r = await window.api.views.start(id);
          if (r && r.ok === false && r.error !== 'cancelled') {
            mwiAlert.alert({ type: 'error', message: t('panel.alert.start_failed', { error: r.error || 'unknown' }) });
            return;
          }
          // 启动成功后聚焦该账号 game view，让中部立即显示游戏画面
          if (window.api && window.api.views && window.api.views.focus) {
            try { await window.api.views.focus(id); } catch (e) { /* ignore */ }
          }
        }
      }
    });
  });
}

async function refresh() {
  var res = await Promise.all([
    window.api.accounts.list(),
    window.api.groups.list(),
  ]);
  store.set({ accounts: res[0], groups: res[1] });
}

async function loadFingerprintPresets(wrap, currentValue) {
  var input = wrap.querySelector('[name="fingerprintPreset"]');
  if (!input || typeof window.api.fingerprint === 'undefined') return;
  var current = (currentValue != null && currentValue !== '') ? String(currentValue) : 'preset_01';
  try {
    var presets = await window.api.fingerprint.listPresets();
    if (!Array.isArray(presets) || !presets.length) return;
    var sel = document.createElement('select');
    sel.name = 'fingerprintPreset';
    var matched = false;
    presets.forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = String(p.id);
      opt.textContent = String(p.label || p.id);
      if (opt.value === current) { opt.selected = true; matched = true; }
      sel.appendChild(opt);
    });
    if (!matched) {
      var custom = document.createElement('option');
      custom.value = current;
      custom.textContent = current + t('account.form.fingerprint.custom_suffix');
      custom.selected = true;
      sel.appendChild(custom);
    }
    input.parentNode.replaceChild(sel, input);
  } catch (e) {}
}

function openModal(account) {
  if (tabbar && typeof tabbar.openFormTab === 'function') {
    tabbar.openFormTab(!!account, account || null);
    return;
  }
  console.warn('[sidebar] tabbar.openFormTab not available');
}

export const sidebar = { refresh: refresh, openModal: openModal };

export function initSidebar(deps) {
  deps = deps || {};
  store = deps.store || defaultStore;
  i18n = deps.i18n || defaultI18n;
  tabbar = deps.tabbar || defaultTabbar;
  mwiAlert = deps.alert || defaultAlert;
  // 重置 lazy 订阅标记：新一轮 init 绑定的是新 i18n 引用（测试注入场景）
  _i18nSubscribed = false;

  root = document.getElementById('sidebar-groups');
  addBtn = document.getElementById('btn-add-account');
  quickAddBtn = document.getElementById('btn-quick-add');

  if (addBtn) addBtn.addEventListener('click', function () { openModal(null); });
  const subsBtn = document.getElementById('btn-subscriptions');
  if (subsBtn) subsBtn.addEventListener('click', function () {
    if (tabbar && tabbar.openSubscriptionsTab) {
      tabbar.openSubscriptionsTab();
    } else {
      mwiAlert.alert({ type: 'warn', message: t('sidebar.alert.subs_missing') });
    }
  });
  if (quickAddBtn) quickAddBtn.addEventListener('click', function () { openModal(null); });

  store.subscribe(render);

  refresh().catch(function (e) { console.error('[sidebar] refresh failed', e); });
}
