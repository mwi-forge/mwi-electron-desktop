// lib/views/lifecycle.js - WebContentsView 池生命周期（自 views.js 拆出，#24）
// 职责：账号池 / 焦点切换 / start/stop / 指纹与代理串接 / 油猴面板窗口。
// 布局边界计算在 ./layout，idle 计时在 ./idle；本模块是 pool 与 mainWindow 的唯一属主。

const { WebContentsView, BrowserWindow } = require('electron');
const path = require('path');
const logs = require('../logs');
const proxy = require('../proxy');
const fp = require('../fingerprint');
const tm = require('../tampermonkey');
const sec = require('../sec-headers');
const alert = require('../alert');
const layout = require('./layout');
const idle = require('./idle');

const MAX_VIEWS = 0; // 0 = 无限（用户显式要求去掉启动视图数量限制，警告：每个 WebContentsView 独立渲染进程，多个同时跑会显著增加内存/CPU 占用）

let mainWindow = null;
const pool = new Map();  // accountId -> { view, account, state, startedAt }
let focusedId = null;
const listeners = new Set();

function getMainWindow() { return mainWindow; }

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

// 状态栏当前页面 URL：广播 focused 视图的 url 变化（{type:'url', accountId, url}）
function emitUrl(accountId, url) {
  for (const cb of listeners) {
    try { cb({ type: 'url', accountId, url }); } catch (e) { console.error('[views] url listener err', e); }
  }
}

// 取某 view 当前 URL 的安全封装（webContents 可能已销毁）
function viewUrlOf(accountId) {
  const e = pool.get(accountId);
  if (!e || !e.view || !e.view.webContents) return '';
  try { return e.view.webContents.getURL() || ''; } catch (err) { return ''; }
}

// 焦点切换到某 view 时同步当前 URL 到状态栏
function emitCurrentUrl(accountId) {
  emitUrl(accountId, viewUrlOf(accountId));
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
      emitUrl(focusedId, '');  // 视图被卸下（显示占位/表单）时清空状态栏 URL
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
    const bounds = layout.computeViewBounds();
    entry.view.setBounds(bounds);
    if (!mainWindow.contentView.children.includes(entry.view)) {
      mainWindow.contentView.addChildView(entry.view);
      emitCurrentUrl(focusedId);  // 视图重新挂上，同步状态栏 URL
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
    layout.applyLayoutToPool();
  });
}

async function startView(accountId) {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'main_window_not_ready' };
  if (MAX_VIEWS > 0 && pool.size >= MAX_VIEWS) return { ok: false, error: 'max_views_reached' };
  if (pool.has(accountId)) return { ok: false, error: 'already_running' };

  const accountsMod = require('../accounts');
  const account = accountsMod.getAccount(accountId);
  if (!account) return { ok: false, error: 'account_not_found' };

  // 指纹画像在 view 创建前构建：fp-preload.js 的 additionalArguments 需要它。
  // 同一账号稳定、不同账号互不相同；自定义 UA 无 Chrome 主版本会在此直接抛错（fail loud）。
  const profile = fp.buildFingerprint(account);

  const view = new WebContentsView({
    // 关键：显式设 backgroundColor=应用主背景，避免 webContents 加载前显示 Electron 默认白色闪烁
    // （与 BrowserWindow 创建时 backgroundColor:'#0F0F0F' 保持一致）
    backgroundColor: '#0F0F0F',
    webPreferences: {
      partition: 'persist:account_' + accountId,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // 指纹预注入通道：fp-preload.js 在文档创建时、页面脚本之前把 spoof bundle 注入主世界。
      // profile 经 additionalArguments 传递（渲染进程无法在页面世界读取 Node argv，不泄露）。
      preload: path.join(__dirname, '..', '..', 'fp-preload.js'),
      additionalArguments: ['--mwi-fp-profile=' + Buffer.from(JSON.stringify(profile)).toString('base64')],
    },
  });

  view.setBounds(layout.computeViewBounds());

  // === 抗白屏策略：延迟 attach + 强制 body 黑色 ===
  // 1) did-start-loading 时立即 insertCSS 强制 body/html 黑色，覆盖目标站 body 白底
  // 2) dom-ready 后等 80ms 让 webContents 完成 first paint（dom-ready ≠ first paint）
  // 3) 然后才 attach — attach 那一刻显示的是已 paint 的真实内容，不是白色
  // 配合 WebContentsView 的 backgroundColor: '#0F0F0F'，attach 那一刻也不会显示默认白色
  try {
    view.webContents.on('did-start-loading', function () {
      view.webContents.insertCSS('html, body { background: #0F0F0F !important; background-color: #0F0F0F !important; }').catch(function () {});
    });
  } catch (e) { /* ignore */ }

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

  // idle auto-stop 活动源（per openspec/changes/idle-auto-stop design Decision 1）：
  // 独立 on 监听 keyDown / mouseDown / mouseWheel，与上方剪贴板 handler 共存。
  // 此 handler 不拦截事件（不返回任何取消标记），仅作为"用户正在操作"的强信号重置 timer。
  view.webContents.on('before-input-event', function (_event, input) {
    if (!input) return;
    if (input.type === 'keyDown' || input.type === 'mouseDown' || input.type === 'mouseWheel') {
      try { idle.resetActivity(accountId); } catch (_e) { /* ignore */ }
    }
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

  // 状态栏当前页面 URL + idle auto-stop 活动源：监听该 view 的导航（含 SPA hash/history 变化），
  // 仅当它是 focused 视图时才广播 URL；导航本身视为活动重置 idle timer（per design Decision 1）。
  view.webContents.on('did-navigate', function () {
    try { idle.resetActivity(accountId); } catch (_e) { /* ignore */ }
    if (focusedId === accountId && !isFocusedHidden()) emitCurrentUrl(accountId);
  });
  view.webContents.on('did-navigate-in-page', function (_e, _url, isMainFrame) {
    if (isMainFrame) { try { idle.resetActivity(accountId); } catch (_e) { /* ignore */ } }
    if (isMainFrame && focusedId === accountId && !isFocusedHidden()) emitCurrentUrl(accountId);
  });

  logs.info(accountId, 'starting view: ' + account.url);
  // lastActivityAt + idleTimer 是 idle auto-stop（per openspec/changes/idle-auto-stop）的核心字段
  pool.set(accountId, { view, account, state: 'starting', startedAt: Date.now(), lastActivityAt: Date.now(), idleTimer: null });
  emitState(accountId, 'starting');

  // Phase 5: 串接代理 / 指纹画像 / WebRTC / UA / Tampermonkey / 指纹注入
  const sess = view.webContents.session;

  // 1) 代理（manual / subscription 三态分发；subscription 走本地 socks5 gateway）
  // 安全策略变更（用户 2026 显式要求）：代理失败 = 严重问题，不属于黄色情况。
  // 旧逻辑：仅 WARN 然后以直连模式继续启动 view —— 真实 IP / 关联特征会直接泄露到 milkywayidle.com。
  // 新逻辑：弹模态错误框 + 强制终止该 view 启动（不放过任何"代理失效"）。
  const proxyRes = await proxy.bindSessionProxy(sess, account, {
    // 出口地理对齐（非阻塞）：代理出口经纬度经 ip-api 拿到后注入渲染层 window.__MWI_GEO__，
    // 供 fingerprint 的 geolocation 覆盖在 permState.geolocation === 'granted' 时返回与出口一致的假坐标。
    onExit: function (info) {
      if (!info || typeof info.lat !== 'number' || typeof info.lon !== 'number') return;
      const geo = { lat: info.lat, lon: info.lon, accuracy: 1000, city: info.city || '', region: info.region || '', country: info.country || '' };
      try {
        view.webContents.executeJavaScript('window.__MWI_GEO__ = ' + JSON.stringify(geo) + ';').catch(function () {});
        logs.info(accountId, 'exit geo injected for geolocation spoof: ' + geo.city + ' ' + geo.lat + ',' + geo.lon);
      } catch (e) { /* ignore */ }
    },
  });
  if (!proxyRes.ok) {
    // proxyRes.ok===false 一定意味着用户配置了代理但拿不到（subscription / manual 失败），
    // 唯一例外是 defensive 的 `no_session`，按同一策略处理（更安全）。
    const ap = account && account.proxy;
    const mode = (ap && ap.source) || 'unknown';
    const reason = proxyRes.error || 'unknown';
    const accLabel = account.name || accountId || '(unknown)';
    logs.error(accountId, 'proxy setup FAILED (mode=' + mode + '): ' + reason + ' — aborting view start');
    // 应用内模态弹窗（暗色主题，与现有 UI 统一）；阻塞 UI 等用户点确认
    try {
      await alert.showAppAlert({
        type: 'error',
        title: '代理启动失败 — 已终止该 view 启动',
        message: '账号「' + accLabel + '」配置的代理无法启动。',
        detail:
          '原因: ' + reason + '\n' +
          '代理模式: ' + mode + '\n\n' +
          '为防止真实 IP / 关联特征泄露到目标站点，本 view 已被强制终止启动\n' +
          '（不会以直连模式继续加载页面）。\n\n' +
          '请检查:\n' +
          '  1. mihomo 二进制是否完整（resources/mihomo 或 .cache/mihomo）\n' +
          '  2. 订阅节点是否可达 / 凭据是否过期（订阅页 → 立即刷新）\n' +
          '  3. 手动代理模式下 host / port / password 是否正确\n' +
          '  4. 若确认要在此账号上放弃代理，请将其「代理模式」改为「直连」（需自担风险）',
        buttons: ['我知道了'],
        defaultId: 0,
        cancelId: 0,
      });
    } catch (e) {
      console.error('[views] proxy-failed alert.showAppAlert failed:', e.message);
    }
    // 清理：view 已创建但未 attach，未进 focusedId，无需 removeChildView
    pool.delete(accountId);
    emitState(accountId, 'error:proxy_failed');
    try { view.webContents.destroy(); } catch (_) { /* ignore */ }
    return { ok: false, error: 'proxy_failed: ' + reason };
  }
  logs.info(accountId, 'proxy set: ' + (proxyRes.mode || 'none') + (proxyRes.port ? ' (127.0.0.1:' + proxyRes.port + ')' : ''));

  // 2) 指纹画像（每账号构建一次：同一账号稳定，不同账号互不相同）
  // 注意：profile 已在 startView 入口（view 创建前）构建并传入 fp-preload.js，
  // 此处继续用于 WebRTC / Sec-CH-UA / setUserAgent 等主进程侧配置。

  // 3) WebRTC 策略（默认禁用非代理 UDP，防本地 IP 泄露）
  // 注意：Electron 43 已把 setWebRTCIPHandlingPolicy 从 Session 移到 WebContents
  // （session.setWebRTCIPHandlingPolicy 被官方移除；webPreferences.webrtcIPHandlingPolicy 键不存在；--force-webrtc-ip-handling-policy 仅进程级）。
  // 这里走 view.webContents 的实例方法，保留逐账号差异化策略。
  try {
    await view.webContents.setWebRTCIPHandlingPolicy(account.webRtcPolicy || 'disable_non_proxied_udp');
    logs.info(accountId, 'webrtc policy set: ' + (account.webRtcPolicy || 'disable_non_proxied_udp'));
  } catch (e) {
    logs.warn(accountId, 'webrtc policy setup warning: ' + e.message);
  }

  // 3.6) 权限拦截（真实隐私泄露的硬防线）：
  // navigator.geolocation 走 Windows/macOS 系统定位服务（WiFi AP / GPS / 基站），与代理出口 IP 完全无关，
  // 代理换 IP 挡不住真实坐标泄露（2026-08 实测 browserleaks 暴露广州番禺真实坐标）。
  // 因此 geolocation 只在 profile.permState.geolocation === 'granted' 时放行（渲染层已伪造假坐标，见 fingerprint.js 10.5）；
  // 通知/摄像头/麦克风同样对齐 permState，避免 Permissions.query 伪造值与真实行为割裂。
  try {
    sess.setPermissionRequestHandler(function (webContents, permission, callback, details) {
      const ps = (profile.permState) || {};
      if (permission === 'geolocation') {
        const allowed = ps.geolocation === 'granted';
        logs.info(accountId, 'geolocation ' + (allowed ? 'GRANTED (profile)' : 'DENIED') + ' <- ' + ((details && details.requestingUrl) || '?'));
        return callback(allowed);
      }
      if (permission === 'notifications') return callback(ps.notifications === 'granted');
      if (permission === 'media') {
        const types = (details && details.mediaTypes) || [];
        const needCam = types.indexOf('video') !== -1;
        const needMic = types.indexOf('audio') !== -1;
        if (needCam && ps.camera !== 'granted') return callback(false);
        if (needMic && ps.microphone !== 'granted') return callback(false);
        return callback(needCam || needMic);
      }
      if (permission === 'clipboard-read') return callback(ps.clipboard === 'granted');
      // 非隐私权限（fullscreen / pointerLock / openExternal / clipboard-sanitized-write 等）放行
      callback(true);
    });
    logs.info(accountId, 'permission handler registered (geolocation blocked by default)');
  } catch (e) {
    logs.warn(accountId, 'permission handler register warning: ' + e.message);
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
  // 注意：session.setUserAgent 的文档语义是「不影响已存在的 WebContents」，而本 view 的
  // webContents 早已创建——2026-08-28 实测（browserleaks 显示原生 UA）确认它静默失效。
  // 因此必须补 webContents.setUserAgent（逐 webContents 覆盖，与 WebRTC 的迁移路线一致）；
  // session 调用保留：为 acceptLanguages 及未来新 WebContents 设置会话级默认。
  const ua = account.userAgent || profile.ua;
  try { sess.setUserAgent(ua, profile.acceptLanguages); } catch (e) { logs.warn(accountId, 'session setUserAgent failed: ' + e.message); }
  try { view.webContents.setUserAgent(ua); } catch (e) { logs.warn(accountId, 'webContents setUserAgent failed: ' + e.message); }

  // 5) Tampermonkey（失败降级，不影响游戏）
  const tmRes = await tm.loadTampermonkeyForSession(sess);
  if (tmRes.ok) {
    logs.info(accountId, 'tampermonkey loaded: ' + tmRes.name + ' v' + tmRes.version);
    // 把 ext.id 存到 pool entry，供面板「打开油猴面板」按钮用
    try { pool.get(accountId).tmId = tmRes.id; } catch (_) { /* entry may not exist yet if attach failed earlier */ }
  } else {
    logs.warn(accountId, 'tampermonkey skipped: ' + tmRes.error);
  }

  // 6) 指纹注入：唯一有效通道是 fp-preload.js（webPreferences.preload + additionalArguments
  // 传 profile，preload 内 webFrame.executeJavaScript 把 spoof bundle 注入主世界，在页面
  // 脚本执行之前生效）。此前的 did-start-navigation executeJavaScript（落在旧文档 realm）
  // 与 CDP addScriptToEvaluateOnNewDocument（Electron 43 跨导航不生效）均已废弃，不再兜底。

  // 延迟 attach：先 loadURL，等 dom-ready 后再 attach 到主窗口
  // dom-ready = HTML 解析完成 + SPA 脚本开始执行 = 第一帧已有真实内容
  // attach 那一刻用户看到的就是页面，而不是白屏闪烁
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
        // dom-ready 后等 80ms 让 webContents 完成首帧 paint（dom-ready 仅 DOM 解析完，
        // first paint 要再等 layout + style 计算 + 首次绘制）。80ms 是经验值，对游戏页足够。
        // 配合上面 did-start-loading 时插入的 body 黑底 CSS，attach 那一刻一定是页面内容
        // 而不是 milkywayidle 等站点的 body 白底闪烁。
        setTimeout(function () {
          if (attachAndFocusView(accountId)) {
            finish(resolve);
          } else {
            finish(reject, new Error('attach_failed'));
          }
        }, 80);
      });
      view.webContents.once('did-fail-load', function (_e, code, desc, _url, isMainFrame) {
        // 只有主框架失败才算启动失败（子资源失败不影响页面可用性）
        if (isMainFrame) finish(reject, new Error(code + ' ' + desc));
      });
      // loadURL 的 promise 只兜底同步错误；正常/挂起场景由上面两个事件收尾。
      // 单独挂 catch：页面永久加载中时该 promise 长期悬挂，destroy 后才 reject，
      // 若不挂 catch 会变成 unhandled rejection。
      // 此时 view 还没 attach 到主窗口：webContents offscreen 渲染，不可见。
      view.webContents.loadURL(account.url).catch(function (e) {
        finish(reject, e);
      });
    });
  } catch (e) {
    // 用户主动停止（stopView 已把 view 移出 pool）时静默返回，不弹"启动失败"
    if (!pool.has(accountId)) {
      try { view.webContents.destroy(); } catch (_) {}
      return { ok: false, error: 'cancelled' };
    }
    logs.error(accountId, 'loadURL failed: ' + e.message);
    // attach 之前/之后失败：移除 view（如果已 attach）
    try {
      if (mainWindow && mainWindow.contentView && mainWindow.contentView.children.includes(view)) {
        mainWindow.contentView.removeChildView(view);
      }
    } catch (_) {}
    if (focusedId === accountId) {
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
  // 启动成功路径（per openspec/changes/idle-auto-stop design Decision 5 / tasks.md 3.3）：
  // entry.lastActivityAt 在 pool.set 时已置为 Date.now()，这里 arm 会算完整 idleTimeoutMs 剩余时长。
  idle.armIdleTimer(accountId);
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

function stopView(accountId, reason) {
  const entry = pool.get(accountId);
  if (!entry) return;
  // idle auto-stop（per openspec/changes/idle-auto-stop design Decision 6）：
  // 必须**先 disarm 再做其他 teardown**，否则 timer 在 stopView 进行中 fire 又调 stopView
  // 形成重复销毁（disarmIdleTimer 内部幂等 + entry 已被 pool.delete 后找不到 = no-op）。
  idle.disarmIdleTimer(accountId);
  logs.info(accountId, 'stopping view' + (reason ? ' [' + reason + ']' : ''));
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
  // reason === 'idle_timeout' 时输出 'stopped:idle_timeout' 让 renderer 可识别；其他走 'stopped'
  emitState(accountId, reason === 'idle_timeout' ? 'stopped:idle_timeout' : 'stopped');

  if (focusedId === accountId) {
    const next = pool.keys().next().value || null;
    if (next) {
      focusView(next);
    } else {
      focusedId = null;
      emitFocus(null);
      emitUrl(null, '');  // 无 focused 视图时清空状态栏 URL（显示占位）
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

  const bounds = layout.computeViewBounds();
  entry.view.setBounds(bounds);
  try {
    mainWindow.contentView.addChildView(entry.view);
    console.log('[mwi views] focusView', accountId, 'bounds=' + JSON.stringify(bounds), 'children.length=' + mainWindow.contentView.children.length);
  } catch (e) {
    console.error('[mwi views] addChildView failed:', accountId, e);
  }
  focusedId = accountId;
  emitFocus(accountId);
  emitCurrentUrl(accountId);  // 焦点切换时同步当前 URL
  // idle auto-stop（per design Decision 7）：切到该 tab 视为新活动（用户主动切换 = 操作）
  // 老 focused view 不主动 disarm（离开账号就该停，符合"离开账号就该停"语义）
  try { idle.resetActivity(accountId); } catch (_e) { /* ignore */ }
  // 立即广播一次：用户切 tab 是低频动作，立即推一次倒计时让 UI 立即更新（否则要等 1s ticker）
  idle.broadcastCountdownIfArmed();
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

  const bounds = layout.computeViewBounds();
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
  emitCurrentUrl(accountId);  // 焦点切换时同步当前 URL
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
        preload: path.join(__dirname, '..', '..', 'preload.js'),
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
function getView(accountId) {
  const e = pool.get(accountId);
  return e ? e.view : null;
}

// 状态栏当前页面 URL：返回 { accountId, url }（无 focused/视图被隐藏时 url 为 ''）
function getFocusedUrl() {
  if (!focusedId) return { accountId: null, url: '' };
  if (isFocusedHidden()) return { accountId: focusedId, url: '' };
  return { accountId: focusedId, url: viewUrlOf(focusedId) };
}

module.exports = {
  setMainWindow, hideFocused, resumeFocused, isFocusedHidden,
  startView, stopView, focusView, reload, openTampermonkeyPanel,
  listRunning, getFocusedId, getState, getView, getFocusedUrl,
  onChange,
  // facade 接线用内部句柄：pool 引用与 mainWindow getter（不进 lib/views.js 对外 API）
  pool, getMainWindow,
};
