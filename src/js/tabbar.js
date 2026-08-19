// src/js/tabbar.js - 中部 tab 栏（已启动账号 game tab + 账号表单 form tab + 切换 + 关闭）
// 依赖：window.mwiStore、window.api（preload）、window.mwiAccountForm

(function () {
  const root = document.getElementById('tabbar');
  const localStates = new Map();  // accountId -> 'running'|'starting'|'stopped'|'error:...'

  // form tab 列表（renderer 内部状态，不走 store）：
  //   { id: 'account-form:new' | 'account-form:edit:<accountId>', isEdit, accountId, title }
  const formTabs = [];
  let activeTabId = null;  // 当前 active tab：game tab 用 accountId，form tab 用 formTab.id

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>'"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // 找到 active form tab 对象（如果 activeTabId 匹配 form tab）
  function findFormTab(id) {
    for (var i = 0; i < formTabs.length; i++) if (formTabs[i].id === id) return formTabs[i];
    return null;
  }

  // 关闭所有静态 tab 挂载层（账号表单 / 订阅管理）：两者都是 canvas 内全屏覆盖层，
  // 切换 tab 时必须全部关闭，否则旧层盖在新层之上（订阅层 DOM 在 form 层之后）
  function closeAllStaticTabs() {
    if (window.mwiAccountForm) window.mwiAccountForm.close();
    if (window.mwiSubscriptionsTab) window.mwiSubscriptionsTab.close();
    if (window.mwiSettings) window.mwiSettings.close();
  }

  // 一次性关闭所有 form tab（订阅管理 / 账号表单）+ detach 当前 game view + 复位 activeTabId
  // 用于：点击侧栏未启动账号节点时，让画布回到 placeholder 默认界面。
  // 注意：与 closeFormTab 不同，本函数不走「最后一个 form tab 关时聚焦到 running[0]」逻辑，
  // 一律强制 activeTabId=null + resumeFocused 卸下 game view。
  async function closeAllFormTabs() {
    // 直接清空 formTabs + 关闭静态层（不调 closeFormTab，避免末尾默认聚焦）
    formTabs.splice(0);
    closeAllStaticTabs();
    activeTabId = null;
    if (window.api && window.api.canvas && window.api.canvas.resumeFocused) {
      try { await window.api.canvas.resumeFocused(); } catch (e) { /* ignore */ }
    }
    render();
  }

  function render() {
    var s = window.mwiStore.get();
    var gameIds = s.runningIds || [];
    var parts = [];

    // game tabs
    for (var i = 0; i < gameIds.length; i++) {
      var id = gameIds[i];
      var acc = s.accounts.find(function (a) { return a.id === id; });
      if (!acc) continue;
      var state = localStates.get(id) || 'starting';
      var focused = activeTabId === id;
      var isRunning = state === 'running';
      var isError = typeof state === 'string' && state.indexOf('error') === 0;
      var statusClass = isRunning ? 'tab__dot--running' : (isError ? 'tab__dot--error' : 'tab__dot--stopped');
      var statusMark = isRunning ? '*' : (isError ? '!' : 'o');
      parts.push(
        '<div class="tab' + (focused ? ' tab--focused' : '') + '" data-tab-type="game" data-account-id="' + id + '">' +
        '<span class="tab__dot ' + statusClass + '">' + statusMark + '</span>' +
        '<span class="tab__name">' + escapeHtml(acc.name || acc.id || (window.mwiI18n && window.mwiI18n.t ? window.mwiI18n.t('tabbar.name.unnamed') : '未命名')) + '</span>' +
        '<button class="tab__close" data-action="close" data-id="' + id + '" title="关闭 tab">[X]</button>' +
        '</div>'
      );
    }

    // form tabs（紧随 game tabs 之后）
    for (var j = 0; j < formTabs.length; j++) {
      var ft = formTabs[j];
      var focusedF = activeTabId === ft.id;
      parts.push(
        '<div class="tab tab--static' + (focusedF ? ' tab--focused' : '') + '" data-tab-type="form" data-form-id="' + ft.id + '">' +
        '<span class="tab__dot tab__dot--static" title="' + (window.mwiI18n && window.mwiI18n.t ? window.mwiI18n.t('tabbar.title.form_dot') : '表单') + '">+</span>' +
        '<span class=\"tab__name\">' +
        escapeHtml(ft.title || (
          ft.id === 'proxy-subscriptions' ? (window.mwiI18n && window.mwiI18n.t ? window.mwiI18n.t('tabbar.title.subscriptions') : '订阅管理') :
          ft.id === 'settings' ? (window.mwiI18n && window.mwiI18n.t ? window.mwiI18n.t('tabbar.title.settings') : '设置') :
          (ft.isEdit ? ((window.mwiI18n && window.mwiI18n.t ? window.mwiI18n.t('tabbar.title.edit_prefix') : '编辑: ') + (ft.accountData && ft.accountData.name || '')) : (window.mwiI18n && window.mwiI18n.t ? window.mwiI18n.t('tabbar.title.add_account') : '添加账号'))
        )) +
        '</span>' +
        '<button class="tab__close" data-action="close-form" data-form-id="' + ft.id + '" title="关闭 tab">[X]</button>' +
        '</div>'
      );
    }

    if (parts.length === 0) {
      root.innerHTML = '<div class="tabbar__empty">' + (window.mwiI18n && window.mwiI18n.t ? window.mwiI18n.t('tabbar.empty') : '中部 tab 区（启动账号后出现）') + '</div>';
      return;
    }
    root.innerHTML = parts.join('');

    // game tab 点击：focus game tab + resume focused view（如果之前被 form tab 隐藏）
    root.querySelectorAll('[data-tab-type="game"]').forEach(function (el) {
      el.addEventListener('click', function (ev) {
        if (ev.target.closest('.tab__close')) return;
        var accId = el.dataset.accountId;
        focusGameTab(accId);
      });
    });
    root.querySelectorAll('[data-action="close"]').forEach(function (el) {
      el.addEventListener('click', async function (ev) {
        ev.stopPropagation();
        await window.api.views.stop(el.dataset.id);
      });
    });

    // form tab 点击：订阅 tab 调 focusSubscriptionsTab，settings 调 focusSettingsTab，其它 form tab 调 focusFormTab
    // (per memory 2026-08-19 Tab 切换错乱 BUG：formId 二次分流必须显式分支，避免错分类)
    root.querySelectorAll('[data-tab-type="form"]').forEach(function (el) {
      el.addEventListener('click', function (ev) {
        if (ev.target.closest('.tab__close')) return;
        if (el.dataset.formId === 'proxy-subscriptions') {
          focusSubscriptionsTab(el.dataset.formId);
        } else if (el.dataset.formId === 'settings') {
          focusSettingsTab(el.dataset.formId);
        } else {
          focusFormTab(el.dataset.formId);
        }
      });
    });
    root.querySelectorAll('[data-action="close-form"]').forEach(function (el) {
      el.addEventListener('click', function (ev) {
        ev.stopPropagation();
        closeFormTab(el.dataset.formId);
      });
    });
  }

  // 切到 game tab
  async function focusGameTab(accountId) {
    if (!window.api || !window.api.views) return;
    var prevActive = activeTabId;
    activeTabId = accountId;

    // 关闭当前 form tab（如果 active 的是 form）：unmount + resumeFocused
    var prevFormTab = findFormTab(prevActive);
    if (prevFormTab) {
      try { await window.api.canvas.resumeFocused(); } catch (e) {}
      closeAllStaticTabs();
    }

    // 通知主进程聚焦 game view（views.focus）
    try { await window.api.views.focus(accountId); } catch (e) {}
    render();
  }

  // 切到 form tab（hideFocused + mount form）
  async function focusFormTab(formTabId) {
    var ft = findFormTab(formTabId);
    if (!ft) return;
    // 已激活：只重渲（tab 高亮刷新），不重复 open 表单 mount/调用 mwiAccountForm.open，
    // 避免重复点「添加账号」按钮或 form tab 时反复重新挂表单（导致字段闪烁）
    if (activeTabId === formTabId) {
      render();
      return;
    }
    var prevActive = activeTabId;
    activeTabId = formTabId;

    // 先恢复 focused view（如果之前被 hide 了），再切 form tab 时再 hide
    var prevFormTab = findFormTab(prevActive);
    if (!prevFormTab && window.api && window.api.canvas && window.api.canvas.resumeFocused) {
      try { await window.api.canvas.resumeFocused(); } catch (e) {}
    }

    // 关闭当前静态 tab（如果有不同的 form tab 在显示），改挂新 form
    if (prevFormTab && prevFormTab.id !== formTabId) {
      closeAllStaticTabs();
    }

    // hide focused game view + 挂 form
    if (window.api && window.api.canvas && window.api.canvas.hideFocused) {
      try { await window.api.canvas.hideFocused(); } catch (e) {}
    }

    if (window.mwiAccountForm) {
      await window.mwiAccountForm.open(
        { isEdit: ft.isEdit, account: ft.accountData || null },
        { onClose: function (result) {
          // 表单提交/取消回调：关 tab + 触发 sidebar refresh（如果成功）
          closeFormTab(formTabId, result);
          if (result && result.ok && window.mwiSidebar && window.mwiSidebar.refresh) {
            window.mwiSidebar.refresh();
          }
        } }
      );
    }
    render();
  }

  // 关闭 form tab
  async function closeFormTab(formTabId, result) {
    var idx = -1;
    for (var i = 0; i < formTabs.length; i++) {
      if (formTabs[i].id === formTabId) { idx = i; break; }
    }
    if (idx < 0) return;
    formTabs.splice(idx, 1);

    // 如果关闭的是当前 active form，尝试切回上一个 game tab 或没有 tab
    if (activeTabId === formTabId) {
      try { await window.api.canvas.resumeFocused(); } catch (e) {}
      closeAllStaticTabs();  // 统一路径：accountForm + subscriptions + settings 都关闭
      var s = window.mwiStore.get();
      var running = s.runningIds || [];
      if (running.length > 0) {
        activeTabId = running[0];
        try { await window.api.views.focus(activeTabId); } catch (e) {}
      } else {
        activeTabId = null;
      }
    }
    render();
  }

  // 打开新 form tab（外部调用入口：sidebar.js openModal）
  // 注意：不存 title — 由 render fallback 从 t() 计算（per "2026-08-18 翻译不完整" 修复）
  async function openFormTab(isEdit, account) {
    var id;
    var accountData = null;
    if (isEdit && account) {
      id = 'account-form:edit:' + account.id;
      accountData = account;
    } else {
      id = 'account-form:new:' + Date.now();
    }

    // 非编辑模式下，如果已存在任何 account-form:new:* tab（用户多次点「添加账号」按钮），
    // 聚焦已存在的那个，不重复创建。否则 Date.now() 每次不同导致 findFormTab(id) 永不命中，
    // 每点一次都新增一个「添加账号」tab 导致 tab 栏重复堆积。
    if (!isEdit) {
      for (var i = 0; i < formTabs.length; i++) {
        if (formTabs[i].id.indexOf('account-form:new:') === 0) {
          await focusFormTab(formTabs[i].id);
          return formTabs[i].id;
        }
      }
    }

    // 编辑模式：同一对象已打开就不重复开
    if (findFormTab(id)) {
      await focusFormTab(id);
      return id;
    }

    formTabs.push({ id: id, isEdit: !!isEdit, accountId: account ? account.id : null, title: '', accountData: accountData });  // title 在 render 里由 t() 计算
    await focusFormTab(id);
    return id;
  }

  // 打开订阅管理 tab（Clash Verge 整合）
  async function openSubscriptionsTab() {
    var id = "proxy-subscriptions";
    // 已打开则聚焦（订阅 tab 必须调 focusSubscriptionsTab 而不是 focusFormTab，
    // 否则会触发 mwiAccountForm.open 弹出添加账号界面）
    if (findFormTab(id)) {
      await focusSubscriptionsTab(id);
      return id;
    }
    formTabs.push({ id: id, isEdit: false, accountId: null, title: '', accountData: null, isSubscriptions: true });  // title 在 render 里由 t() 计算
    await focusSubscriptionsTab(id);
    return id;
  }

  // 打开 settings tab（单例；已存在则聚焦）
  // 与 openSubscriptionsTab 同模式：避免重复创建（per memory 2026-08-19 Tab 切换错乱 BUG 教训）
  async function openSettingsTab() {
    var id = 'settings';
    if (findFormTab(id)) {
      await focusSettingsTab(id);
      return id;
    }
    formTabs.push({ id: id, isEdit: false, accountId: null, title: '', accountData: null, isSettings: true });  // title 在 render 里由 t() 计算
    await focusSettingsTab(id);
    return id;
  }

  // 聚焦订阅 tab（hideFocused + mount 订阅管理 DOM）
  async function focusSubscriptionsTab(formTabId) {
    var ft = findFormTab(formTabId);
    if (!ft) return;
    var prevActive = activeTabId;
    activeTabId = formTabId;

    // 关闭当前静态 tab（如果是别的表单）
    var prevFormTab = findFormTab(prevActive);
    if (prevFormTab && prevFormTab.id !== formTabId) {
      closeAllStaticTabs();
    }

    // hide focused game view
    if (window.api && window.api.canvas && window.api.canvas.hideFocused) {
      try { await window.api.canvas.hideFocused(); } catch (e) {}
    }

    if (window.mwiSubscriptionsTab) {
      await window.mwiSubscriptionsTab.open();
    }
    render();
  }

  // 聚焦 settings tab（hideFocused + mount 设置面板 DOM）
  async function focusSettingsTab(formTabId) {
    var ft = findFormTab(formTabId);
    if (!ft) return;
    var prevActive = activeTabId;
    activeTabId = formTabId;

    // 关闭当前静态 tab（如果是别的表单）
    var prevFormTab = findFormTab(prevActive);
    if (prevFormTab && prevFormTab.id !== formTabId) {
      closeAllStaticTabs();
    }

    // hide focused game view
    if (window.api && window.api.canvas && window.api.canvas.hideFocused) {
      try { await window.api.canvas.hideFocused(); } catch (e) {}
    }

    if (window.mwiSettings) {
      await window.mwiSettings.open();
    }
    render();
  }

  async function refresh() {
    var ids = await window.api.views.listRunning();
    window.mwiStore.set({ runningIds: ids, viewStates: Object.fromEntries(localStates) });
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      if (!localStates.has(id)) {
        var st = await window.api.views.getState(id);
        localStates.set(id, st);
      }
    }
    for (var id2 of Array.from(localStates.keys())) {
      if (ids.indexOf(id2) === -1) localStates.delete(id2);
    }
    // 如果 active 是 game tab 但账号已停止，重置
    if (activeTabId && ids.indexOf(activeTabId) === -1 && !findFormTab(activeTabId)) {
      activeTabId = ids.length > 0 ? ids[0] : null;
      if (activeTabId) {
        try { await window.api.views.focus(activeTabId); } catch (e) {}
      }
    }
    render();
  }

  window.api.views.onStateChanged(function (data) {
    var id = data.accountId, state = data.state;
    localStates.set(id, state);
    var cur = window.mwiStore.get().runningIds || [];
    var next = cur;
    if (state === 'starting' || state === 'running') {
      if (cur.indexOf(id) === -1) next = cur.concat([id]);
    } else if (state === 'stopped' || (typeof state === 'string' && state.indexOf('error') === 0)) {
      next = cur.filter(function (x) { return x !== id; });
    }
    window.mwiStore.set({ runningIds: next, viewStates: Object.fromEntries(localStates) });
    render();
  });

  window.api.views.onFocusChanged(function (data) {
    // 主进程发来的 focus 事件：如果是 game tab 且不是 form tab，更新 activeTabId 并 render
    // （同步 tab 高亮：onFocusChanged 改 activeTabId 但不 render 会让 focusGameTab
    //  内部 render 用旧值而 tab 高亮停留在前一个账号上）
    var fid = data.accountId;
    if (!findFormTab(fid)) {
      activeTabId = fid;
      render();
    }
  });

  window.mwiStore.subscribe(render);
  // 语言切换时重新渲染（form tab 标题、empty state 等 t() 调用站点全部重新走一遍）
  if (window.mwiI18n && window.mwiI18n.onChange) {
    window.mwiI18n.onChange(function () { render(); });
  }
  refresh().catch(function (e) { console.error('[tabbar] refresh failed', e); });

  // 绑定 toolbar 上的「设置」按钮（src/index.html line ~50 的 #btn-settings）到 settings tab
  var btnSettingsEl = document.getElementById('btn-settings');
  if (btnSettingsEl) {
    btnSettingsEl.addEventListener('click', function () { openSettingsTab(); });
  }

  window.mwiTabbar = {
    refresh: refresh,
    render: render,
    openFormTab: openFormTab,
    openSubscriptionsTab: openSubscriptionsTab,
    openSettingsTab: openSettingsTab,
    closeFormTab: closeFormTab,
    closeAllFormTabs: closeAllFormTabs,
    focusFormTab: focusFormTab,
    getActiveTabId: function () { return activeTabId; },
  };
})();