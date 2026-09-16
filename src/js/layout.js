// src/js/layout.js - 沉浸模式：折叠/展开 + 左右分栏拖拽调宽
// 折叠/调宽经 IPC 通知主进程重算 WebContentsView bounds（游戏视图适配）
// 状态（折叠 + 宽度）持久化到 localStorage，重启后恢复
const KEY = 'mwi:layout:collapsed';
const LIMITS = {
  sidebar: { min: 180, max: 460, prop: 'sidebarW', varName: '--mwi-sidebar-w', handleId: 'split-handle-sidebar' },
  panel: { min: 220, max: 620, prop: 'panelW', varName: '--mwi-right-w', handleId: 'split-handle-panel' },
};

function clampNum(v, min, max, dflt) {
  v = Number(v);
  if (!isFinite(v)) return dflt;
  return Math.max(min, Math.min(max, v));
}

let st = { sidebar: false, panel: false, sidebarW: 240, panelW: 320 };
let dragging = null; // 'sidebar' | 'panel' | null（拖拽中通知主进程给原生 view 留余量）

function apply() {
  document.body.classList.toggle('sidebar-collapsed', !!st.sidebar);
  document.body.classList.toggle('panel-collapsed', !!st.panel);
  const root = document.documentElement;
  root.style.setProperty('--mwi-sidebar-w', st.sidebarW + 'px');
  root.style.setProperty('--mwi-right-w', st.panelW + 'px');
  if (window.api && window.api.layout) {
    window.api.layout.set({
      sidebar: !!st.sidebar,
      panel: !!st.panel,
      sidebarW: st.sidebarW,
      panelW: st.panelW,
      dragging: dragging,
    }).catch(function () {});
  }
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* ignore */ }
}

// 拖拽调宽：mousedown 在把手上开始，window 级 mousemove/mouseup 跟进
// 拖拽中主进程会给原生 WebContentsView 留 24px 余量，保证鼠标始终落在
// chrome 页面内，mousemove/mouseup 不会被原生视图抢走
function setupDrag(which) {
  const cfg = LIMITS[which];
  const handle = document.getElementById(cfg.handleId);
  if (!handle) return;
  let drag = null;

  handle.addEventListener('mousedown', function (e) {
    e.preventDefault();
    drag = { startX: e.clientX, startW: st[cfg.prop], latest: st[cfg.prop], lastT: 0 };
    dragging = which;
    document.body.classList.add('is-resizing');
    handle.classList.add('split-handle--dragging');
    apply();
  });

  window.addEventListener('mousemove', function (e) {
    if (!drag) return;
    const dx = which === 'sidebar' ? (e.clientX - drag.startX) : (drag.startX - e.clientX);
    drag.latest = clampNum(drag.startW + dx, cfg.min, cfg.max, cfg.min);
    // 时间戳节流（不用 requestAnimationFrame：窗口被遮挡时 rAF 会暂停导致拖拽卡死）
    const now = Date.now();
    if (now - drag.lastT < 16) return;
    drag.lastT = now;
    st[cfg.prop] = drag.latest;
    apply();
  });

  function endDrag() {
    if (!drag) return;
    st[cfg.prop] = drag.latest; // 最后一次 mousemove 可能被节流跳过，收尾时补上
    drag = null;
    dragging = null;
    document.body.classList.remove('is-resizing');
    handle.classList.remove('split-handle--dragging');
    apply();
    save();
  }
  window.addEventListener('mouseup', endDrag);
  window.addEventListener('mouseleave', endDrag);
}

export const layout = {
  get: function () { return { sidebar: !!st.sidebar, panel: !!st.panel, sidebarW: st.sidebarW, panelW: st.panelW }; },
  toggleSidebar: function () { st.sidebar = !st.sidebar; apply(); save(); },
  togglePanel: function () { st.panel = !st.panel; apply(); save(); },
};

export function initLayout() {
  st = { sidebar: false, panel: false, sidebarW: 240, panelW: 320 };
  dragging = null;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      st = Object.assign(st, parsed);
      st.sidebarW = clampNum(st.sidebarW, LIMITS.sidebar.min, LIMITS.sidebar.max, 240);
      st.panelW = clampNum(st.panelW, LIMITS.panel.min, LIMITS.panel.max, 320);
    }
  } catch (e) { /* ignore */ }

  const btnS = document.getElementById('btn-toggle-sidebar');
  const btnP = document.getElementById('btn-toggle-panel');
  if (btnS) btnS.addEventListener('click', function () { st.sidebar = !st.sidebar; apply(); save(); });
  if (btnP) btnP.addEventListener('click', function () { st.panel = !st.panel; apply(); save(); });

  // 启动时恢复上次布局（含 CSS 变量 + 通知主进程同步 bounds）
  apply();
  save();
  setupDrag('sidebar');
  setupDrag('panel');
}
