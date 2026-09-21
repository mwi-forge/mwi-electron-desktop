// src/js/tabbar.js - 中部 tab 栏（已启动账号 game tab + 账号表单 form tab + 切换 + 关闭）
// 依赖经 initTabbar(deps) 显式注入（缺省用各模块默认导出），store/api 为隐式协作
import { store as defaultStore } from './store.js';
import { i18n as defaultI18n } from './i18n.js';
import { accountForm as defaultAccountForm } from './account-form.js';
import { subscriptionsTab as defaultSubscriptionsTab } from './subscription-tab.js';
import { settingsTab as defaultSettingsTab } from './settings-tab.js';
import { sidebar as defaultSidebar } from './sidebar.js';
import { safe } from './safe.js';

// 协作者引用（init 运行期绑定——循环依赖下模块顶层读 default 会 TDZ；deps 可覆盖供测试注入）
let store = null;
let i18n = null;
let accountForm = null;
let subscriptionsTab = null;
let settingsTab = null;
let sidebar = null;

let root = null;
const localStates = new Map();  // accountId -> 'running'|'starting'|'stopped'|'error:...'

// form tab 列表（renderer 内部状态，不走 store）：
//   { id: 'account-form:new' | 'account-form:edit:<accountId>', isEdit, accountId, title }
const formTabs = [];
let activeTabId = null;  // 当前 active tab：game tab 用 accountId，form tab 用 formTab.id
// preview tab（点击未启动 sidebar 节点创建的临时 tab；切换到其他 tab 时自动关闭）
let previewTabId = null;  // accountId 或 null

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
  if (accountForm) accountForm.close();
  if (subscriptionsTab) subscriptionsTab.close();
  if (settingsTab) settingsTab.close();
}

// 一次性关闭所有 form tab（订阅管理 / 账号表单）+ detach 当前 game view + 复位 activeTabId
// 用于：点击侧栏未启动账号节点时，让画布回到 placeholder 默认界面。
// 注意：与 closeFormTab 不同，本函数不走「最后一个 form tab 关时聚焦到 running[0]」逻辑，
// 一律强制 activeTabId=null + resumeFocused 卸下 game view。
async function closeAllFormTabs() {
  // 直接清空 formTabs + 关闭静态层（不调 closeFormTab，避免末尾默认聚焦）
  formTabs.splice(0);
  closeAllStaticTabs();
  if (previewTabId) clearPreviewTab();
  activeTabId = null;
  if (window.api && window.api.canvas && window.api.canvas.resumeFocused) {
    safe(() => window.api.canvas.resumeFocused(), 'tabbar:resumeFocused');
  }
  render();
}

function render() {
  var s = store.get();
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
    // idle auto-stop 提示（per openspec/changes/idle-auto-stop design Decision 9.1）：
    // state 为 'stopped:idle_timeout' 时把 i18n 文案挂到 title，hover 时给用户反馈
    // tab 自身仍渲染为 stopped dot（与普通 stopped 视觉一致；title 仅作辅助信息）
    var idleTitle = (state === 'stopped:idle_timeout' && i18n && i18n.t)
      ? i18n.t('views.idleStopReason')
      : '关闭 tab';
    parts.push(
      '<div class="tab' + (focused ? ' tab--focused' : '') + '" data-tab-type="game" data-account-id="' + id + '">' +
      '<span class="tab__dot ' + statusClass + '">' + statusMark + '</span>' +
      '<span class="tab__name">' + escapeHtml(acc.name || acc.id || (i18n && i18n.t ? i18n.t('tabbar.name.unnamed') : '未命名')) + '</span>' +
      '<button class="tab__close" data-action="close" data-id="' + id + '" title="关闭 tab" aria-label="关闭 tab"></button>' +
      '</div>'
    );
  }

  // preview tab（点击未启动 sidebar 节点创建；切到其他 tab 自动关闭）
  // 仅当 previewTabId 不在 gameIds 里（避免与运行中的 tab 重复）
  if (previewTabId && gameIds.indexOf(previewTabId) === -1) {
    var previewAcc = s.accounts.find(function (a) { return a.id === previewTabId; });
    if (previewAcc) {
      var previewFocused = activeTabId === previewTabId;
      parts.push(
        '<div class="tab tab--preview' + (previewFocused ? ' tab--focused' : '') + '" data-tab-type="preview" data-account-id="' + previewTabId + '">' +
        '<span class="tab__dot tab__dot--stopped" title="未启动（临时预览 tab）"></span>' +
        '<span class="tab__name">' + escapeHtml(previewAcc.name || previewTabId || (i18n && i18n.t ? i18n.t('tabbar.name.unnamed') : '未命名')) + '</span>' +
        '<button class="tab__close" data-action="close-preview" data-id="' + previewTabId + '" title="关闭 tab" aria-label="关闭 tab"></button>' +
        '</div>'
      );
    }
  }

  // form tabs（紧随 game tabs 之后）
  for (var j = 0; j < formTabs.length; j++) {
    var ft = formTabs[j];
    var focusedF = activeTabId === ft.id;
    parts.push(
      '<div class="tab tab--static' + (focusedF ? ' tab--focused' : '') + '" data-tab-type="form" data-form-id="' + ft.id + '">' +
      '<span class="tab__dot tab__dot--static" title="' + (i18n && i18n.t ? i18n.t('tabbar.title.form_dot') : '表单') + '">+</span>' +
      '<span class=\"tab__name\">' +
      escapeHtml(ft.title || (
        ft.id === 'proxy-subscriptions' ? (i18n && i18n.t ? i18n.t('tabbar.title.subscriptions') : '订阅管理') :
        ft.id === 'settings' ? (i18n && i18n.t ? i18n.t('tabbar.title.settings') : '设置') :
        (ft.isEdit ? ((i18n && i18n.t ? i18n.t('tabbar.title.edit_prefix') : '编辑: ') + (ft.accountData && ft.accountData.name || '')) : (i18n && i18n.t ? i18n.t('tabbar.title.add_account') : '添加账号'))
      )) +
      '</span>' +
      '<button class="tab__close" data-action="close-form" data-form-id="' + ft.id + '" title="关闭 tab" aria-label="关闭 tab"></button>' +
      '</div>'
    );
  }

  if (parts.length === 0) {
    root.innerHTML = '<div class="tabbar__empty">' + (i18n && i18n.t ? i18n.t('tabbar.empty') : '中部 tab 区（启动账号后出现）') + '</div>';
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

  // preview tab 点击：focus preview tab（hide focused view，canvas 显示 placeholder）
  root.querySelectorAll('[data-tab-type="preview"]').forEach(function (el) {
    el.addEventListener('click', function (ev) {
      if (ev.target.closest('.tab__close')) return;
      focusPreviewTab(el.dataset.accountId);
    });
  });
  root.querySelectorAll('[data-action="close-preview"]').forEach(function (el) {
    el.addEventListener('click', function (ev) {
      ev.stopPropagation();
      clearPreviewTab();
      render();
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
    safe(() => window.api.canvas.resumeFocused(), 'tabbar:resumeFocused');
    closeAllStaticTabs();
  }

  // 切到 game tab：preview tab 自动关闭（除非就是这个 game tab 自己）
  if (previewTabId && previewTabId !== accountId) clearPreviewTab();

  // 通知主进程聚焦 game view（views.focus）
  safe(() => window.api.views.focus(accountId), 'tabbar:focus');
  render();
}

// 切到 preview tab（hide focused view 让 canvas 显示 placeholder）
async function focusPreviewTab(accountId) {
  var prevActive = activeTabId;
  activeTabId = accountId;

  // 切换前如果是 form tab：resume focused + 关闭静态层
  var prevFormTab = findFormTab(prevActive);
  if (prevFormTab) {
    safe(() => window.api.canvas.resumeFocused(), 'tabbar:resumeFocused');
    closeAllStaticTabs();
  }

  // hide 当前 focused view（如果有），让 canvas placeholder 露出来
  if (window.api && window.api.canvas && window.api.canvas.hideFocused) {
    safe(() => window.api.canvas.hideFocused(), 'tabbar:hideFocused');
  }
  render();
}

// 设置 preview tab（外部：sidebar 点击未启动账号）
function setPreviewTab(accountId) {
  if (previewTabId === accountId) return;
  previewTabId = accountId;
  activeTabId = accountId;
  // 隐藏 canvas 里当前挂载的 form DOM（订阅管理 / 账号表单 / 设置）——
  // 它们会盖在 placeholder 上面；但 formTabs[] 不清，用户可点订阅 tab 切回去（DOM 会重新挂载）。
  closeAllStaticTabs();
  // hide focused view
  if (window.api && window.api.canvas && window.api.canvas.hideFocused) {
    safe(() => window.api.canvas.hideFocused(), 'tabbar:hideFocused');
  }
  render();
}

// 清除 preview tab（外部：sidebar 关闭 / 切到 game / 启动账号完成等）
function clearPreviewTab() {
  if (!previewTabId) return;
  previewTabId = null;
  // 不动 activeTabId（让上层决定下一个 active）
}

// 切到 form tab（hideFocused + mount form）
async function focusFormTab(formTabId) {
  var ft = findFormTab(formTabId);
  if (!ft) return;
  // 已激活：只重渲（tab 高亮刷新），不重复 open 表单 mount/调用 accountForm.open，
  // 避免重复点「添加账号」按钮或 form tab 时反复重新挂表单（导致字段闪烁）
  if (activeTabId === formTabId) {
    render();
    return;
  }
  // 切到 form tab：preview tab 自动关闭
  if (previewTabId) clearPreviewTab();
  var prevActive = activeTabId;
  activeTabId = formTabId;

  // 先恢复 focused view（如果之前被 hide 了），再切 form tab 时再 hide
  var prevFormTab = findFormTab(prevActive);
  if (!prevFormTab && window.api && window.api.canvas && window.api.canvas.resumeFocused) {
    safe(() => window.api.canvas.resumeFocused(), 'tabbar:resumeFocused');
  }

  // 关闭当前静态 tab（如果有不同的 form tab 在显示），改挂新 form
  if (prevFormTab && prevFormTab.id !== formTabId) {
    closeAllStaticTabs();
  }

  // hide focused game view + 挂 form
  if (window.api && window.api.canvas && window.api.canvas.hideFocused) {
    safe(() => window.api.canvas.hideFocused(), 'tabbar:hideFocused');
  }

  if (accountForm) {
    await accountForm.open(
      { isEdit: ft.isEdit, account: ft.accountData || null },
      { onClose: function (result) {
        // 表单提交/取消回调：关 tab + 触发 sidebar refresh（如果成功）
        closeFormTab(formTabId, result);
        if (result && result.ok && sidebar && sidebar.refresh) {
          sidebar.refresh();
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
    safe(() => window.api.canvas.resumeFocused(), 'tabbar:resumeFocused');
    closeAllStaticTabs();  // 统一路径：accountForm + subscriptions + settings 都关闭
    var s = store.get();
    var running = s.runningIds || [];
    if (running.length > 0) {
      activeTabId = running[0];
      safe(() => window.api.views.focus(activeTabId), 'tabbar:focus');
    } else {
      activeTabId = null;
    }
  }
  render();
}

// 打开新 form tab（外部调用入口：sidebar.openModal）
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
  // 否则会触发 accountForm.open 弹出添加账号界面）
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
    safe(() => window.api.canvas.hideFocused(), 'tabbar:hideFocused');
  }

  if (subscriptionsTab) {
    await subscriptionsTab.open();
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
    safe(() => window.api.canvas.hideFocused(), 'tabbar:hideFocused');
  }

  if (settingsTab) {
    await settingsTab.open();
  }
  render();
}

async function refresh() {
  var ids = await window.api.views.listRunning();
  store.set({ runningIds: ids, viewStates: Object.fromEntries(localStates) });
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
      safe(() => window.api.views.focus(activeTabId), 'tabbar:focus');
    }
  }
  render();
}

export const tabbar = {
  refresh: refresh,
  render: render,
  openFormTab: openFormTab,
  openSubscriptionsTab: openSubscriptionsTab,
  openSettingsTab: openSettingsTab,
  closeFormTab: closeFormTab,
  closeAllFormTabs: closeAllFormTabs,
  focusFormTab: focusFormTab,
  setPreviewTab: setPreviewTab,      // 侧栏点未启动账号 → 创建临时 tab
  clearPreviewTab: clearPreviewTab,  // 关闭临时 tab
  focusPreviewTab: focusPreviewTab,  // 切到 preview tab 时 hide focused view
  getActiveTabId: function () { return activeTabId; },
  getPreviewTabId: function () { return previewTabId; },
};

export function initTabbar(deps) {
  deps = deps || {};
  // 重置 UI 状态：init 等价于一次应用启动（IIFE 时代模块加载即全新），
  // 也让测试在共享模块单例下每轮 init 得到干净状态
  formTabs.splice(0);
  localStates.clear();
  activeTabId = null;
  previewTabId = null;

  store = deps.store || defaultStore;
  i18n = deps.i18n || defaultI18n;
  accountForm = deps.accountForm || defaultAccountForm;
  subscriptionsTab = deps.subscriptionsTab || defaultSubscriptionsTab;
  settingsTab = deps.settingsTab || defaultSettingsTab;
  sidebar = deps.sidebar || defaultSidebar;

  root = document.getElementById('tabbar');

  window.api.views.onStateChanged(function (data) {
    var id = data.accountId, state = data.state;
    localStates.set(id, state);
    var cur = store.get().runningIds || [];
    var next = cur;
    if (state === 'starting' || state === 'running') {
      if (cur.indexOf(id) === -1) next = cur.concat([id]);
    } else if (typeof state === 'string' && (state === 'stopped' || state.indexOf('stopped:') === 0 || state.indexOf('error') === 0)) {
      // 识别 stopped / stopped:* (idle_timeout) / error:* 三类终止态，从 runningIds 移除
      next = cur.filter(function (x) { return x !== id; });
    }
    store.set({ runningIds: next, viewStates: Object.fromEntries(localStates) });
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

  store.subscribe(render);
  // 语言切换时重新渲染（form tab 标题、empty state 等 t() 调用站点全部重新走一遍）
  if (i18n && i18n.onChange) {
    i18n.onChange(function () { render(); });
  }
  refresh().catch(function (e) { console.error('[tabbar] refresh failed', e); });

  // 绑定 toolbar 上的「设置」按钮（src/index.html line ~50 的 #btn-settings）到 settings tab
  var btnSettingsEl = document.getElementById('btn-settings');
  if (btnSettingsEl) {
    btnSettingsEl.addEventListener('click', function () { openSettingsTab(); });
  }

  // 测试 hook：主进程推送 ui:test:setPreview 时调 setPreviewTab（模拟侧栏点击未启动账号）
  if (window.api && window.api.test && window.api.test.onSetPreview) {
    window.api.test.onSetPreview(function (accId) {
      if (accId) setPreviewTab(accId);
    });
  }
  // 测试 hook：主进程推送 ui:test:openForm 时调 openSubscriptionsTab（模拟点「订阅」按钮）
  if (window.api && window.api.test && window.api.test.onOpenForm) {
    window.api.test.onOpenForm(function () {
      if (tabbar && tabbar.openSubscriptionsTab) {
        tabbar.openSubscriptionsTab();
      }
    });
  }
}
