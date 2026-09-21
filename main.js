// main.js - MWI Electron Desktop 主进程
// Phase 0: 最小骨架（单实例锁 + 主窗口 + 资源优化）

const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const ipc = require('./lib/ipc');
const views = require('./lib/views');
const logs = require('./lib/logs');
const metrics = require('./lib/metrics');
const alert = require('./lib/alert');
const AssistantOverlay = require('./lib/assistant-overlay');
const { createLogFileWriter } = require('./lib/logfile');

// 资源优化：默认启用 GPU（反检测优先，避免 GPU 指纹缺失暴露无头特征）；
// MWI_HW_ACCEL=0 时回退省电模式
if (process.env.MWI_HW_ACCEL === '0') {
  app.disableHardwareAcceleration();
}
app.commandLine.appendSwitch('renderer-process-limit', '6');

// 单实例锁
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  let mainWindow = null;

  // === 生产可观测性（per issue #45）===
  // 日志落盘：userData/logs/ 按天滚动、保留 7 天；环形缓冲照旧（内存）。
  // app.getPath('userData') 在 ready 前即可用，越早挂 sink 丢的日志越少。
  const logWriter = createLogFileWriter({
    dir: path.join(app.getPath('userData'), 'logs'),
    maxDays: 7,
  });
  logs.setSink(logWriter.append);
  // 诊断包收集需要读日志文件；ipc.js 模块独立不持闭包，走 globalThis（同 __assistantOverlay 先例）
  globalThis.__logWriter = logWriter;

  // 崩溃捕获：记录后不退出（桌面应用惯例）——日志设施本身不能成为新崩溃源。
  // handler 内只做 crashLine 直写 + console，绝不再抛。
  process.on('uncaughtException', (err) => {
    logWriter.crashLine('crash', 'uncaughtException: ' + (err && err.stack ? err.stack : err));
    logs.error(null, 'uncaughtException: ' + (err && err.message ? err.message : err));
    console.error('[mwi crash] uncaughtException', err);
  });
  process.on('unhandledRejection', (reason) => {
    logWriter.crashLine('crash', 'unhandledRejection: ' + (reason && reason.stack ? reason.stack : reason));
    logs.error(null, 'unhandledRejection: ' + reason);
    console.error('[mwi crash] unhandledRejection', reason);
  });


  function createMainWindow() {
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 960,
      minHeight: 600,
      backgroundColor: '#0F0F0F',  // 避免白闪（深色背景）
      title: 'MWI Multi-Account Manager',
      // === 深色标题栏策略 ===
      // Win11: titleBarOverlay 让 OS 标题栏背景=深色、控件=浅色（与 chrome UI 自然融合）
      // Win10: 没有 native API 改 OS 标题栏颜色，titleBarOverlay 被忽略但不影响 frame
      // macOS: titleBarStyle='default' 用 OS 原生标题栏（带拖动 + 红绿灯 + 系统菜单栏）。
      // 2026-08-22 临时改回 default —— hidden 模式 + .toolbar 没加 -webkit-app-region drag
      // 导致整个窗口顶部 0px 可拖区，traffic light 也跟 .toolbar__brand 重叠看不见。
      // 不使用 frame:false（去掉整个 OS 标题栏会破坏窗口拖拽/最小化/全屏手势）
      titleBarStyle: 'default',
      ...(process.platform === 'win32' ? {
        titleBarOverlay: {
          color: '#1A1A1F',        // OS 标题栏背景（与 chrome UI .panel bg 接近）
          symbolColor: '#F1F2F6',  // 窗口控制按钮颜色
          height: 36,
        },
      } : {}),
      // 应用图标：dev 模式直接用 resources/logo.png（PNG Electron 全平台支持，
      // 1024x1024 在标题栏/任务栏缩放清晰），无需先跑 build-brand-assets.py 生成 ICO/ICNS；
      // 打包后由 electron-builder 自动读 build/icon.ico 嵌入到 .exe（由
      // scripts/build-icon-assets.mjs 在 prebuild 阶段生成）。
      // 三级 fallback：darwin 优先 icns → 任何平台都接受 ico → 最后用 PNG 兜底。
      icon: (() => {
        const icnsPath = path.join(__dirname, 'build', 'icon.icns');
        const icoPath  = path.join(__dirname, 'build', 'icon.ico');
        const pngPath  = path.join(__dirname, 'resources', 'logo.png');
        if (process.platform === 'darwin' && fs.existsSync(icnsPath)) return icnsPath;
        if (fs.existsSync(icoPath)) return icoPath;
        return fs.existsSync(pngPath) ? pngPath : undefined;
      })(),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,  // 允许 preload require Node API（safeStorage 等）
      },
    });

    // Phase 2: WebContentsView 池初始化 + 事件桥接到渲染进程
    views.setMainWindow(mainWindow);
    alert.setMainWindow(mainWindow);
    views.onChange((evt) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (evt.type === 'state') {
        mainWindow.webContents.send('account:state-changed', { accountId: evt.accountId, state: evt.state });
      } else if (evt.type === 'focus') {
        mainWindow.webContents.send('view:focus-changed', { accountId: evt.accountId });
      } else if (evt.type === 'url') {
        mainWindow.webContents.send('view:url-changed', { accountId: evt.accountId, url: evt.url });
      }
    });

    // Phase 3: 日志推送桥接
    logs.onAppend((evt) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send('log:append', evt);
    });

    // Phase 4: metrics 推流
    metrics.onUpdate((snap) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send('metrics:update', snap);
    });
    metrics.startMetricsLoop(2000);

    mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

    // console 桥接：全部转发主进程 stdout（Phase 0 验收用）；
    // warn/error 级额外进全局日志流（自动落盘，渲染层 console.warn 无需新 IPC）。
    // level 兼容新旧 Electron：新版字符串 'warning'/'error'，旧版数字 2/3
    mainWindow.webContents.on('console-message', (_event, level, message) => {
      console.log('[renderer] ' + message);
      const lv = String(level);
      if (lv === 'warning' || lv === 'error' || lv === '2' || lv === '3') {
        logs[lv === 'warning' || lv === '2' ? 'warn' : 'error']('app', '[renderer] ' + message);
      }
    });

    // 调试模式：打开 DevTools
    if (process.env.MWI_DEV === '1') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }

    mainWindow.on('closed', () => {
      alert.resetPending();
      mainWindow = null;
    });

    // 独立助手窗口（透明置顶悬浮窗，承载 mascot IP 形象）
    // 单例：首次创建，或重建主窗口时只更新引用
    if (!globalThis.__assistantOverlay) {
      globalThis.__assistantOverlay = new AssistantOverlay(mainWindow, function recreate() { createMainWindow(); });



    } else {
      globalThis.__assistantOverlay.setMainWindow(mainWindow);
    }

    // macOS Dock 修复已内聚到 lib/assistant-overlay.js：
    // setVisibleOnAllWorkspaces 会让 app 从 Dock 消失，模块内用 setActivationPolicy('regular') 恢复。
  }

  // 第二个实例启动时聚焦现有窗口
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  ipc.register();

  // 自检/测试钩子集中注册于 lib/selftest.js：生产路径零行为，
  // 全部经 MWI_SELFTEST_* / MWI_TEST_* 环境变量开关（批次 3 自 main.js 抽离）
  require('./lib/selftest').registerSelftests({
    app,
    getMainWindow: () => mainWindow,
    views,
    alert,
    logs,
    metrics,
  });

  app.whenReady().then(() => {
    createMainWindow();

    // 应用菜单：macOS 必须保留 Edit role（Cmd+C/V/X/A 全靠它，缺了 chrome UI 和 WebContentsView 都无法复制粘贴）；Win/Linux 默认不显示菜单栏（保持窗口顶部干净）。
    const isMac = process.platform === 'darwin';
    if (isMac) {
      const macTemplate = [
        { label: app.name, submenu: [
          { role: 'about' }, { type: 'separator' },
          { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
          { type: 'separator' }, { role: 'quit' },
        ] },
        // Edit 菜单：macOS 上 Cmd+C/Cmd+V/Cmd+X/Cmd+A/Cmd+Z 全部依赖菜单 role，
        // 缺失会导致界面和 WebContentsView 网页都无法复制粘贴。WebContentsView 场景下 before-input-event 是双保险。
        { label: 'Edit', submenu: [
          { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
          { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
        ] },
        { role: 'windowMenu' },
      ];
      Menu.setApplicationMenu(Menu.buildFromTemplate(macTemplate));
    } else {
      // Win / Linux：不显示 application menu（顶部菜单栏隐藏），窗口更干净。
      Menu.setApplicationMenu(null);
    }
    if (process.env.MWI_DEV === '1') {
      try { console.log('[mwi menu]', Menu.getApplicationMenu().items.map(function (i) { return i.label; }).join(' | ')); } catch (e) { /* ignore */ }
    }
  });

  // 退出前释放所有 gateway：SIGKILL 所有 mihomo 子进程，防止孤儿进程占端口池
  //（历史教训：应用退出后残留 mihomo 占 7890-7999，下次启动账号报 port_in_use）
  // 同时清空 views idle timer 句柄（per openspec/changes/idle-auto-stop design Decision 8）
  // 防止 setTimeout 在 quit 之后回调造成 unref 警告或回调里访问已销毁 view
  app.on('before-quit', () => {
    const { safe } = require('./lib/safe');
    safe(() => require('./lib/socks-gateway').releaseAll(), 'quit:releaseAll');
    safe(() => require('./lib/views').disposeAllIdleTimers(), 'quit:disposeIdleTimers');
    safe(() => { if (globalThis.__assistantOverlay) globalThis.__assistantOverlay.destroy(); }, 'quit:destroyOverlay');
  });

  app.on('window-all-closed', () => {
    metrics.stopMetricsLoop();
    // macOS 惯例：除非 Cmd+Q，否则不退出
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    // 不使用 getAllWindows.length（助手窗口也算一个窗口，会误判）
    if (!mainWindow) {
      createMainWindow();
    }
  });
}
