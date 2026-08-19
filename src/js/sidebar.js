// src/js/sidebar.js - 左侧分组树 + 账号 CRUD UI
// 依赖：window.mwiStore（store.js）、window.api（preload.js）

(function () {
  const root = document.getElementById('sidebar-groups');
  const addBtn = document.getElementById('btn-add-account');
  const quickAddBtn = document.getElementById('btn-quick-add');

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // i18n helper
  function t(key, vars) {
    return (window.mwiI18n && window.mwiI18n.t) ? window.mwiI18n.t(key, vars) : key;
  }

  // onChange 订阅防御：脚本加载顺序可能让此 IIFE 跑在 i18n.js 之前，
  // 顶层 if 不通过；用 lazy subscribe 兜底（任何一次 render 触发后尝试订阅，
  // 已订阅的不重复）。配合 index.html i18n.js 提前加载保证初始路径就 OK。
  let _i18nSubscribed = false;
  function ensureI18nSubscribed() {
    if (_i18nSubscribed) return;
    if (window.mwiI18n && window.mwiI18n.onChange) {
      window.mwiI18n.onChange(function () { render(); });
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
    ensureI18nSubscribed();  // lazy 触发 onChange 订阅（脚本晚到 i18n.js 时兜底）
    var s = window.mwiStore.get();
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
          var dotClass = isRunning ? 'account__dot--running' : (isError ? 'account__dot--error' : 'account__dot--stopped');
          var dotTitle = isRunning ? t('sidebar.status.running') : (isError ? t('sidebar.status.error') : t('sidebar.status.stopped'));
          parts.push(
            '<li class="account' + (focused ? ' account--focused' : '') + '" data-account-id="' + a.id + '">' +
            '<span class="account__dot ' + dotClass + '" title="' + dotTitle + '">o</span>' +
            '<span class="account__name">' + escapeHtml(a.name) + '</span>' +
            '<span class="account__actions">' +
            '<button class="btn-icon" data-action="edit" data-id="' + a.id + '" title="' + t('sidebar.btn.edit.title') + '">[E]</button>' +
            '<button class="btn-icon" data-action="remove" data-id="' + a.id + '" title="' + t('sidebar.btn.remove.title') + '">[X]</button>' +
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
        var s2 = window.mwiStore.get();
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
        window.mwiStore.set({ focusedAccountId: id });
        var cur = window.mwiStore.get();
        if ((cur.runningIds || []).indexOf(id) !== -1) {
          window.api.views.focus(id).catch(function () {});
        } else {
          if (window.mwiTabbar && window.mwiTabbar.closeAllFormTabs) {
            window.mwiTabbar.closeAllFormTabs();
          }
        }
      });
    });

    root.querySelectorAll('[data-action]').forEach(function (el) {
      el.addEventListener('click', async function (ev) {
        ev.stopPropagation();
        var action = el.dataset.action;
        var id = el.dataset.id;
        if (action === 'edit') {
          var acc = window.mwiStore.get().accounts.find(function (x) { return x.id === id; });
          openModal(acc);
        } else if (action === 'remove') {
          if (confirm(t('sidebar.confirm.remove', { id: id }))) {
            await window.api.accounts.remove(id);
            var cur = window.mwiStore.get().focusedAccountId;
            if (cur === id) window.mwiStore.set({ focusedAccountId: null });
            await refresh();
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
    window.mwiStore.set({ accounts: res[0], groups: res[1] });
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
    if (window.mwiTabbar && typeof window.mwiTabbar.openFormTab === 'function') {
      window.mwiTabbar.openFormTab(!!account, account || null);
      return;
    }
    console.warn('[sidebar] mwiTabbar.openFormTab not available');
  }

  if (addBtn) addBtn.addEventListener('click', function () { openModal(null); });
  const subsBtn = document.getElementById('btn-subscriptions');
  if (subsBtn) subsBtn.addEventListener('click', function () {
    if (window.mwiTabbar && window.mwiTabbar.openSubscriptionsTab) {
      window.mwiTabbar.openSubscriptionsTab();
    } else {
      alert(t('sidebar.alert.subs_missing'));
    }
  });
  if (quickAddBtn) quickAddBtn.addEventListener('click', function () { openModal(null); });

  window.mwiStore.subscribe(render);

  // onChange 订阅走 lazy 模式（ensureI18nSubscribed 在 render 顶部调用），
  // 不顶层订阅以避免在 i18n.js 加载顺序之前时失败（per 2026-08-19 sidebar group bug 修复）

  refresh().catch(function (e) { console.error('[sidebar] refresh failed', e); });

  window.mwiSidebar = { refresh: refresh, openModal: openModal };
})();
