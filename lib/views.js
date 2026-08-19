// lib/views.js - WebContentsView 池管理（Phase 2：路径 B 单窗口 tab 切换）
// 主窗口中部嵌入多个 view，每个账号一个独立 session partition

const { WebContentsView, BrowserWindow } = require('electron');
const path = require('path');
const logs = require('./logs');
const proxy = require('./proxy');
const fp = require('./fingerprint');
const tm = require('./tampermonkey');
const sec = require('./sec-headers');

const MAX_VIEWS = 0; // 0 = 无限（用户显式要求去掉启动视图数量限制，警告：每个 WebContentsView 独立渲染进程，多个同时跑会显著增加内存/CPU 占用）
const SIDEBAR_W = 240;   // 左侧栏默认宽（渲染进程拖拽可覆盖）
const RIGHT_W = 320;     // 右侧面板默认宽（渲染进程拖拽可覆盖）
const DRAG_GAP = 24;     // 拖拽期间给原生 view 的余量，防 view 抢走鼠标事件
const TOOLBAR_H = 48;
const TABBAR_H = 36;
const STATUSBAR_H = 32;

let mainWindow = null;
const pool = new Map();  // accountId -> { view, account, state, startedAt }
let focusedId = null;
const listeners = new Set();

// 沉浸模式：折叠状态 + 自定义分栏宽度（渲染进程通过 IPC 同步）
let sidebarCollapsed = false;
let panelCollapsed = false;
let sidebarW = SIDEBAR_W;
let rightW = RIGHT_W;
let dragSide = null;  // 'sidebar' | 'panel' | null

function computeViewBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { x: SIDEBAR_W, y: TOOLBAR_H + TABBAR_H, width: 800, height: 600 };
  }
  const b = mainWindow.getContentBounds();
  // 拖拽中：正在拖的一侧多让出 DRAG_GAP，鼠标始终留在 chrome 页面内
  // （原生 WebContentsView 不会抢走 mousemove/mouseup，拖拽不中断）
  const gapL = dragSide === 'sidebar' ? DRAG_GAP : 0;
  const gapR = dragSide === 'panel' ? DRAG_GAP : 0;
  const left = sidebarCollapsed ? 0 : sidebarW + gapL;
  const right = panelCollapsed ? 0 : rightW + gapR;
  return {
    x: left,
    y: TOOLBAR_H + TABBAR_H,
    width: Math.max(b.width - left - right, 320),
    height: Math.max(b.height - TOOLBAR_H - TABBAR_H - STATUSBAR_H, 240),
  };
}

// 设置布局（折叠状态 / 分栏宽度 / 拖拽态），重算所有 view bounds
function clampNum(v, min, max) {
  if (typeof v !== 'number' || !isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function setLayout(opts) {
  opts = opts || {};
  if (typeof opts.sidebar === 'boolean') sidebarCollapsed = opts.sidebar;
  if (typeof opts.panel === 'boolean') panelCollapsed = opts.panel;
  if (typeof opts.sidebarW === 'number') sidebarW = clampNum(opts.sidebarW, 160, 640);
  if (typeof opts.panelW === 'number') rightW = clampNum(opts.panelW, 200, 760);
  dragSide = (opts.dragging === 'sidebar' || opts.dragging === 'panel') ? opts.dragging : null;
  const bounds = computeViewBounds();
  for (const entry of pool.values()) {
    try { entry.view.setBounds(bounds); } catch (e) { /* ignore */ }
  }
  return { sidebar: sidebarCollapsed, panel: panelCollapsed, sidebarW: sidebarW, panelW: rightW };
}

function emitState(accountId, state) {
  for (const cb of listeners) {
    try { cb({ type: 'state', accountId, state }); } catch (e) { console.error('[views] listener err', e); }
  }
}

function emitFocus(accountId) {
  for (const cb of listeners) {
    try { cb({ type: 'focus', accountId }); } catch (e) { console.error('[views] listener err', e); }
  }
}

function onChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

  // 临时卸下当前 focused view（不销毁，保留在内存池）；用于静态表单 tab 切到中部时让位
  function hideFocused() {
    if (!focusedId || !pool.has(focusedId)) return false;
    const entry = pool.get(focusedId);
    try {
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.contentView && mainWindow.contentView.children.includes(entry.view)) {
        mainWindow.contentView.removeChildView(entry.view);
        return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  // 恢复当前 focused view（之前被 hideFocused 卸下的重新挂上）
  function resumeFocused() {
    if (!focusedId || !pool.has(focusedId)) return false;
    const entry = pool.get(focusedId);
    try {
      if (!mainWindow || mainWindow.isDestroyed()) return false;
      const bounds = computeViewBounds();
      entry.view.setBounds(bounds);
      if (!mainWindow.contentView.children.includes(entry.view)) {
        mainWindow.contentView.addChildView(entry.view);
        return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  // 当前 focused view 是否处于隐藏状态（已卸下）
  function isFocusedHidden() {
    if (!focusedId || !pool.has(focusedId)) return false;
    const entry = pool.get(focusedId);
    try {
      return mainWindow && !mainWindow.isDestroyed() && mainWindow.contentView && !mainWindow.contentView.children.includes(entry.view);
    } catch (e) { return false; }
  }

function setMainWindow(win) {
  mainWindow = win;
  // 主窗口 resize 时同步更新所有 view bounds
  win.on('resize', () => {
    const bounds = computeViewBounds();
    for (const entry of pool.values()) {
      try { entry.view.setBounds(bounds); } catch (e) { /* ignore */ }
    }
  });
}

async function startView(accountId) {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'main_window_not_ready' };
  if (MAX_VIEWS > 0 && pool.size >= MAX_VIEWS) return { ok: false, error: 'max_views_reached' };
  if (pool.has(accountId)) return { ok: false, error: 'already_running' };

  const accountsMod = require('./accounts');
  const account = accountsMod.getAccount(accountId);
  if (!account) return { ok: false, error: 'account_not_found' };

  const view = new WebContentsView({
    webPreferences: {
      partition: 'persist:account_' + accountId,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  view.setBounds(computeViewBounds());

  // 隐藏网页滚动条：仅视觉隐藏（display:none + scrollbar-width:none 双保险），
  // 滚轮/触控板滚动功能保留。insertCSS 对同一 webContents 后续加载的所有页面持续生效。
  view.webContents.insertCSS('::-webkit-scrollbar { display: none !important; } * { scrollbar-width: none; }')
    .then(function () { logs.info(accountId, 'scrollbar hidden css injected'); })
    .catch(function (e) { logs.warn(accountId, 'scrollbar css inject failed: ' + e.message); });

  // 剪贴板快捷键兜底：Edit 菜单 role 在某些版本不会路由到 WebContentsView 的 webContents，
  // 直接绑定 before-input-event 处理 Cmd/Ctrl + C/V/X/A（与菜单双保险，不会双重触发：
  // 菜单先拦截时输入事件不会到达这里）
  view.webContents.on('before-input-event', (event, input) => {
    if (!input || input.type !== 'keyDown') return;
    const mod = process.platform === 'darwin' ? input.meta : input.control;
    if (!mod) return;
    const k = String(input.key || '').toLowerCase();
    try {
      if (k === 'c') view.webContents.copy();
      else if (k === 'v') view.webContents.paste();
      else if (k === 'x') view.webContents.cut();
      else if (k === 'a') view.webContents.selectAll();
    } catch (e) { /* ignore */ }
  });

  view.webContents.on('render-process-gone', (_e, details) => {
    console.error('[views] render-process-gone', accountId, details);
    logs.error(accountId, 'render-process-gone: ' + JSON.stringify(details));
    markError(accountId, 'render_gone');
  });
  view.webContents.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
    if (!isMainFrame) {
      // 子资源失败（如 facebook.com/tr 像素脚本被墙超时）不影响页面可用性
      logs.warn(accountId, 'subresource failed: ' + code + ' ' + desc);
      return;
    }
    console.error('[views] did-fail-load', accountId, code, desc);
    logs.error(accountId, 'did-fail-load: ' + code + ' ' + desc);
    markError(accountId, 'load_failed:' + code);
  });

  logs.info(accountId, 'starting view: ' + account.url);
  pool.set(accountId, { view, account, state: 'starting', startedAt: Date.now() });
  emitState(accountId, 'starting');

  // Phase 5: 串接代理 / 指纹画像 / WebRTC / UA / Tampermonkey / 指纹注入
  const sess = view.webContents.session;

  // 1) 代理（manual / subscription 三态分发；subscription 走本地 socks5 gateway）
  const proxyRes = await proxy.bindSessionProxy(sess, account);
  if (!proxyRes.ok) {
    if (proxyRes.mode === 'direct_fallback') {
      logs.warn(accountId, 'proxy fallback to direct: ' + proxyRes.error);
    } else {
      logs.warn(accountId, 'proxy setup warning: ' + proxyRes.error);
    }
  } else {
    logs.info(accountId, 'proxy set: ' + (proxyRes.mode || 'none') + (proxyRes.port ? ' (127.0.0.1:' + proxyRes.port + ')' : ''));
  }

  // 2) 指纹画像（每账号构建一次：同一账号稳定，不同账号互不相同）
  const profile = fp.buildFingerprint(account);

  // 3) WebRTC 策略（默认禁用非代理 UDP，防本地 IP 泄露）
  try {
    await sess.setWebRTCIPHandlingPolicy(account.webRtcPolicy || 'disable_non_proxied_udp');
    logs.info(accountId, 'webrtc policy set: ' + (account.webRtcPolicy || 'disable_non_proxied_udp'));
  } catch (e) {
    logs.warn(accountId, 'webrtc policy setup warning: ' + e.message);
  }

  // 3.5) Sec-CH-UA / Sec-Fetch-* 头注入（防 HTTP/2 + Client Hints 指纹关联）
  // 每账号 profile → 不同 Sec-CH-UA brands + Sec-CH-UA-Platform；Sec-Fetch-* 按 resourceType 派生
  try {
    sess.webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, (details, cb) => {
      const requestHeaders = details.requestHeaders || {};
      let pageOrigin = null;
      try { pageOrigin = new URL(account.url); } catch (_) { /* 无 pageOrigin 走 cross-site fallback */ }
      const secHeaders = sec.computeSecHeaders({
        url: details.url,
        resourceType: details.resourceType,
        isTopLevel: details.type === 'mainFrame' && details.frameType === 'outermost',
        pageOrigin: pageOrigin,
        profile: profile,
      });
      for (const k in secHeaders) {
        if (Object.prototype.hasOwnProperty.call(secHeaders, k)) {
          requestHeaders[k] = secHeaders[k];
        }
      }
      cb({ requestHeaders: requestHeaders, cancel: false });
    });
    logs.info(accountId, 'sec headers registered (Sec-CH-UA + Sec-Fetch-*)');
  } catch (e) {
    logs.warn(accountId, 'sec headers register warning: ' + e.message);
  }

  // 4) UA（account.userAgent 优先，否则取指纹画像 UA；acceptLanguages 联动）
  const ua = account.userAgent || profile.ua;
  try { sess.setUserAgent(ua, profile.acceptLanguages); } catch (e) { logs.warn(accountId, 'setUserAgent failed: ' + e.message); }

  // 5) Tampermonkey（失败降级，不影响游戏）
  const tmRes = await tm.loadTampermonkeyForSession(sess);
  if (tmRes.ok) {
    logs.info(accountId, 'tampermonkey loaded: ' + tmRes.name + ' v' + tmRes.version);
    // 把 ext.id 存到 pool entry，供面板「打开油猴面板」按钮用
    try { pool.get(accountId).tmId = tmRes.id; } catch (_) { /* entry may not exist yet if attach failed earlier */ }
  } else {
    logs.warn(accountId, 'tampermonkey skipped: ' + tmRes.error);
  }

  // 6) 指纹注入（did-start-navigation + isMainFrame；脚本幂等，reload 后重复注入无害）
  const fullScript = fp.generateFullInjectScript(profile);
  view.webContents.on('did-start-navigation', (_e, _url, _inPage, isMainFrame) => {
    if (!isMainFrame) return;
    view.webContents.executeJavaScript(fullScript).catch((e) => {
      logs.warn(accountId, 'fp inject failed: ' + e.message);
    });
  });

  // 先 attach 到主窗口（必须在 loadURL 之前，否则 ERR_ABORTED）
  if (!attachAndFocusView(accountId)) {
    pool.delete(accountId);
    try { view.webContents.destroy(); } catch (_) {}
    return { ok: false, error: 'attach_failed' };
  }

  try {
    // 启动成功判据：dom-ready（HTML 解析完成、SPA 脚本开始执行）。
    // 不能用 loadURL() promise 判成功——它依赖 did-finish-load，而 milkywayidle.com
    // 这类 Unity WebGL 游戏页的 load 事件可能数分钟不触发（实测 45s+ 仍 isLoading），
    // 会导致页面实际已加载却被超时误杀。
    await new Promise(function (resolve, reject) {
      var settled = false;
      var timer = null;
      function finish(fn, v) {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        fn(v);
      }
      // 兜底：60s 内连 dom-ready 都没有才算启动失败（网络黑洞等极端情况）
      timer = setTimeout(function () {
        finish(reject, new Error('start timeout: no dom-ready after 60s'));
      }, 60000);

      view.webContents.once('dom-ready', function () {
        finish(resolve);
      });
      view.webContents.once('did-fail-load', function (_e, code, desc, _url, isMainFrame) {
        // 只有主框架失败才算启动失败（子资源失败不影响页面可用性）
        if (isMainFrame) finish(reject, new Error(code + ' ' + desc));
      });
      // loadURL 的 promise 只兜底同步错误；正常/挂起场景由上面两个事件收尾。
      // 单独挂 catch：页面永久加载中时该 promise 长期悬挂，destroy 后才 reject，
      // 若不挂 catch 会变成 unhandled rejection。
      view.webContents.loadURL(account.url).catch(function (e) {
        finish(reject, e);
      });
    });
  } catch (e) {
    // 用户主动停止（stopView 已把 view 移出 pool）时静默返回，不弹"启动失败"
    if (!pool.has(accountId)) {
      return { ok: false, error: 'cancelled' };
    }
    logs.error(accountId, 'loadURL failed: ' + e.message);
    if (focusedId === accountId) {
      try { mainWindow.contentView.removeChildView(view); } catch (_) {}
      focusedId = null;
      emitFocus(null);
    }
    pool.delete(accountId);
    emitState(accountId, 'stopped');
    try { view.webContents.destroy(); } catch (_) {}
    return { ok: false, error: 'load_url_failed: ' + e.message };
  }

  const entry = pool.get(accountId);
  entry.state = 'running';
  logs.info(accountId, 'view started');
  emitState(accountId, 'running');
  return { ok: true };
}

function markError(accountId, reason) {
  const entry = pool.get(accountId);
  if (!entry) return;
  entry.state = 'error';
  logs.error(accountId, 'state -> error: ' + reason);
  emitState(accountId, 'error:' + reason);
}

function stopView(accountId) {
  const entry = pool.get(accountId);
  if (!entry) return;
  logs.info(accountId, 'stopping view');
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      if (mainWindow.contentView && mainWindow.contentView.children.includes(entry.view)) {
        mainWindow.contentView.removeChildView(entry.view);
      }
    } catch (e) { /* ignore */ }
  }
  try { entry.view.webContents.destroy(); } catch (e) { /* ignore */ }
  pool.delete(accountId);
  // 释放绑定到该账号的 gateway（refCount -1；共享节点只减引用，最后一个才真停 mihomo）
  if (entry.account && entry.account.__gatewayId) {
    proxy.releaseSessionGateway(entry.account).catch(function (e) { logs.warn(accountId, 'gateway release warn: ' + e.message); });
  }
  emitState(accountId, 'stopped');

  if (focusedId === accountId) {
    const next = pool.keys().next().value || null;
    if (next) {
      focusView(next);
    } else {
      focusedId = null;
      emitFocus(null);
    }
  }
}

function focusView(accountId) {
  const entry = pool.get(accountId);
  if (!entry || !mainWindow || mainWindow.isDestroyed()) return;

  if (focusedId && pool.has(focusedId)) {
    const cur = pool.get(focusedId);
    try {
      if (mainWindow.contentView && mainWindow.contentView.children.includes(cur.view)) {
        mainWindow.contentView.removeChildView(cur.view);
      }
    } catch (e) { /* ignore */ }
  }

  const bounds = computeViewBounds();
  entry.view.setBounds(bounds);
  try {
    mainWindow.contentView.addChildView(entry.view);
    console.log('[mwi views] focusView', accountId, 'bounds=' + JSON.stringify(bounds), 'children.length=' + mainWindow.contentView.children.length);
  } catch (e) {
    console.error('[mwi views] addChildView failed:', accountId, e);
  }
  focusedId = accountId;
  emitFocus(accountId);
}

// attachAndFocusView: startView 专用，把 view 挂到主窗口并设为 focused
// 必须先于 loadURL 调用（否则 ERR_ABORTED）
function attachAndFocusView(accountId) {
  const entry = pool.get(accountId);
  if (!entry || !mainWindow || mainWindow.isDestroyed()) return false;

  if (focusedId && pool.has(focusedId)) {
    const cur = pool.get(focusedId);
    try {
      if (mainWindow.contentView && mainWindow.contentView.children.includes(cur.view)) {
        mainWindow.contentView.removeChildView(cur.view);
      }
    } catch (e) { /* ignore */ }
  }

  const bounds = computeViewBounds();
  entry.view.setBounds(bounds);
  try {
    mainWindow.contentView.addChildView(entry.view);
    console.log('[mwi views] attachAndFocus', accountId, 'bounds=' + JSON.stringify(bounds), 'children.length=' + mainWindow.contentView.children.length);
  } catch (e) {
    console.error('[mwi views] attachAndFocus failed:', accountId, e);
    return false;
  }
  focusedId = accountId;
  emitFocus(accountId);
  return true;
}

function reload(accountId) {
  const entry = pool.get(accountId);
  if (!entry) return;
  try { entry.view.webContents.reload(); } catch (e) { /* ignore */ }
}

// 油猴后台 options 页独立窗口缓存（避免重复打开 + 关闭时回收）
const tmWindows = new Map();  // accountId -> BrowserWindow

// 打开油猴后台 options 页（chrome-extension://<id>/options.html）
// 走独立 BrowserWindow：直接 webContents.loadURL 会让游戏页 webContents 加载 chrome-extension:// URL
// 触发 Electron sandbox bundle 的 binding.startupData 解构 bug，renderer 进程整体崩。
// 新 BrowserWindow 走正常初始化路径，油猴后台 UI 在自己的窗口里跑，不影响游戏页。
function openTampermonkeyPanel(accountId) {
  const entry = pool.get(accountId);
  if (!entry) return { ok: false, error: 'account_not_running' };
  if (!entry.tmId) return { ok: false, error: 'tampermonkey_not_loaded' };

  // 已开过的窗口直接 focus 复用
  const existing = tmWindows.get(accountId);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    return { ok: true, reused: true };
  }

  try {
    var accountName = (entry.account && entry.account.name) ? entry.account.name : accountId;
    var win = new BrowserWindow({
      width: 900,
      height: 700,
      title: 'Tampermonkey — ' + accountName,
      backgroundColor: '#0F0F0F',
      // 关键：同 partition 才能让油猴后台拿到跟游戏页同一个 extension context
      // （scripts / GM_* / storage 共享）
      webPreferences: {
        partition: 'persist:account_' + accountId,
        preload: path.join(__dirname, '..', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    // 隐藏默认菜单栏（macOS 上避免重复 Edit/View 等菜单干扰油猴 UI）
    try { win.setMenuBarVisibility(false); } catch (_) { /* ignore */ }
    win.loadURL('chrome-extension://' + entry.tmId + '/options/index.html');
    win.on('closed', function () { tmWindows.delete(accountId); });
    tmWindows.set(accountId, win);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'open_failed: ' + (e.message || e) };
  }
}

function listRunning() {
  return Array.from(pool.keys());
}

function getFocusedId() { return focusedId; }
function getState(accountId) {
  const e = pool.get(accountId);
  return e ? e.state : 'stopped';
}

module.exports = {
  setMainWindow, hideFocused, resumeFocused, isFocusedHidden,
  startView, stopView, focusView, reload, openTampermonkeyPanel,
  listRunning, getFocusedId, getState,
  onChange,
  setLayout,
};