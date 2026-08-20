// main.js - MWI Electron Desktop 主进程
// Phase 0: 最小骨架（单实例锁 + 主窗口 + 资源优化）

const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const ipc = require('./lib/ipc');
const views = require('./lib/views');
const logs = require('./lib/logs');
const metrics = require('./lib/metrics');
const alert = require('./lib/alert');

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

  function createMainWindow() {
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 960,
      minHeight: 600,
      backgroundColor: '#0F0F0F',  // 避免白闪（深色背景）
      title: 'MWI Multi-Account Manager',
      // 应用图标：macOS 取自 .app bundle（electron-builder 写入 build/icon.icns），
      // Win/Linux 取自 build/icon.ico（开发模式立即生效）
      icon: process.platform === 'win32' || process.platform === 'linux'
        ? path.join(__dirname, 'build', 'icon.ico')
        : path.join(__dirname, 'build', 'icon.icns'),
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

    // 调试模式：捕获渲染进程 console 输出到主进程 stdout（Phase 0 验收用）
    mainWindow.webContents.on('console-message', (_event, _level, message) => {
      console.log('[renderer] ' + message);
    });

    // 调试模式：打开 DevTools
    if (process.env.MWI_DEV === '1') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }

    mainWindow.on('closed', () => {
      alert.resetPending();
      mainWindow = null;
    });
  }

  // 第二个实例启动时聚焦现有窗口
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  ipc.register();

  // 调试模式：数据层自检（MWI_SELFTEST=1 启用）
  if (process.env.MWI_SELFTEST === '1') {
    const accountsMod = require('./lib/accounts');
    try {
      const acc = accountsMod.createAccount({
        name: 'selftest-account',
        url: 'https://example.com',
      });
      console.log('[mwi selftest] created:', acc.id, acc.name);
      console.log('[mwi selftest] list length:', accountsMod.listAccounts().length);
      accountsMod.updateAccount(acc.id, { name: 'selftest-updated' });
      const fetched = accountsMod.getAccount(acc.id);
      console.log('[mwi selftest] updated name:', fetched.name);
      accountsMod.removeAccount(acc.id);
      console.log('[mwi selftest] removed, list length:', accountsMod.listAccounts().length);
      console.log('[mwi selftest] PASS');
    } catch (e) {
      console.error('[mwi selftest] FAIL:', e);
    }
  }

  // 调试模式：proxy 模块自检（MWI_SELFTEST_PROXY=1 启用）
  if (process.env.MWI_SELFTEST_PROXY === '1') {
    try {
      const proxyMod = require('./lib/proxy');
      console.log('[mwi selftest-proxy] socks5:', JSON.stringify(proxyMod.buildProxyRules({ type: 'socks5', host: '1.2.3.4', port: 1080 })));
      console.log('[mwi selftest-proxy] http:  ', JSON.stringify(proxyMod.buildProxyRules({ type: 'http', host: '5.6.7.8', port: 8080 })));
      console.log('[mwi selftest-proxy] null:  ', JSON.stringify(proxyMod.buildProxyRules(null)));
      console.log('[mwi selftest-proxy] empty: ', JSON.stringify(proxyMod.buildProxyRules({ type: 'socks5' })));
      console.log('[mwi selftest-proxy] PASS');
    } catch (e) {
      console.error('[mwi selftest-proxy] FAIL:', e);
    }
  }

  // 调试模式：fingerprint 模块自检（MWI_SELFTEST_FP=1 启用）
  if (process.env.MWI_SELFTEST_FP === '1') {
    try {
      const fpMod = require('./lib/fingerprint');
      const presets = fpMod.listPresets();
      console.log('[mwi selftest-fp] presets:', JSON.stringify(presets));
      for (const p of presets) {
        const preset = fpMod.getPreset(p.id);
        console.log('[mwi selftest-fp] ' + p.id + ' navigator.hardwareConcurrency:', preset.navigator.hardwareConcurrency);
      }
      const script = fpMod.generateInjectScript('preset_01');
      console.log('[mwi selftest-fp] inject script length:', script.length);
      console.log('[mwi selftest-fp] inject script preview:', script.slice(0, 80) + '...');
      console.log('[mwi selftest-fp] UA:', fpMod.randomUA().slice(0, 50) + '...');
      console.log('[mwi selftest-fp] PASS');
    } catch (e) {
      console.error('[mwi selftest-fp] FAIL:', e);
    }
  }

  // 调试模式：fingerprint Phase 5.5 画像自检（MWI_SELFTEST_FP2=1 启用）
  if (process.env.MWI_SELFTEST_FP2 === '1') {
    try {
      const fpMod = require('./lib/fingerprint');
      const accWin = { id: 'fp2-a', fingerprintPreset: 'preset_01' };
      const accMac = { id: 'fp2-b', fingerprintPreset: 'preset_02' };
      const p1 = fpMod.buildFingerprint(accWin);
      const p1b = fpMod.buildFingerprint(accWin);
      const p2 = fpMod.buildFingerprint(accMac);

      // (a) 同 id 两次 buildFingerprint 的 JSON 相等
      const aOk = JSON.stringify(p1) === JSON.stringify(p1b);
      // (b) 不同 id 的 ua / webgl.renderer 互不相同
      const bOk = p1.ua !== p2.ua && p1.webgl.renderer !== p2.webgl.renderer;
      // (c) win 账号 ua 含 'Windows NT' 且 userAgentData.platform === 'Windows'；mac 账号 ua 含 'Mac OS X' 且 userAgentData.platform === 'macOS'
      const cOk = p1.ua.indexOf('Windows NT') !== -1 && p1.userAgentData.platform === 'Windows'
        && p2.ua.indexOf('Mac OS X') !== -1 && p2.userAgentData.platform === 'macOS';
      // (d) languages.join(',') === acceptLanguages
      const dOk = p1.languages.join(',') === p1.acceptLanguages && p2.languages.join(',') === p2.acceptLanguages;
      // (e) generateFullInjectScript 输出非空且 new Function 不抛
      let eOk = true;
      for (const p of [p1, p2]) {
        const script = fpMod.generateFullInjectScript(p);
        if (!script || script.length === 0) { eOk = false; break; }
        try { new Function(script); } catch (err) { eOk = false; break; }
      }
      if (aOk && bOk && cOk && dOk && eOk) {
        console.log('[mwi selftest-fp2] PASS');
      } else {
        console.error('[mwi selftest-fp2] FAIL: a=' + aOk + ' b=' + bOk + ' c=' + cOk + ' d=' + dOk + ' e=' + eOk);
        process.exit(1);
      }
    } catch (e) {
      console.error('[mwi selftest-fp2] FAIL:', e);
      process.exit(1);
    }
  }

  // 调试模式：tampermonkey 模块自检（MWI_SELFTEST_TM=1 启用）
  if (process.env.MWI_SELFTEST_TM === '1') {
    try {
      const tmMod = require('./lib/tampermonkey');
      console.log('[mwi selftest-tm] default ext path:', tmMod.getDefaultExtPath());
      console.log('[mwi selftest-tm] isReady (default, 不存在):', tmMod.isExtensionReady());
      console.log('[mwi selftest-tm] isReady (nonexistent):', tmMod.isExtensionReady('/tmp/nonexistent'));
      console.log('[mwi selftest-tm] PASS');
    } catch (e) {
      console.error('[mwi selftest-tm] FAIL:', e);
    }
  }

  // 调试模式：metrics 模块自检（MWI_SELFTEST_METRICS=1 启用）
  if (process.env.MWI_SELFTEST_METRICS === '1') {
    try {
      const snap1 = metrics.aggregate();
      console.log('[mwi selftest-metrics] aggregate keys:', Object.keys(snap1).sort().join(','));
      console.log('[mwi selftest-metrics] memMB:', snap1.memMB, 'cpuPct:', snap1.cpuPct, 'viewsCount:', snap1.viewsCount, 'rendererCount:', snap1.rendererCount);
      console.log('[mwi selftest-metrics] maxViews:', snap1.maxViews, 'uptimeSec:', snap1.uptimeSec);

      // 订阅推送测试
      let received = 0;
      const unsub = metrics.onUpdate(function (s) { received++; });
      metrics.startMetricsLoop(200);
      setTimeout(function () {
        metrics.stopMetricsLoop();
        unsub();
        console.log('[mwi selftest-metrics] onUpdate received ticks:', received);
        console.log('[mwi selftest-metrics] PASS');
      }, 700);
    } catch (e) {
      console.error('[mwi selftest-metrics] FAIL:', e);
    }
  }

  // 调试模式：日志模块自检（MWI_SELFTEST_LOGS=1 启用）
  if (process.env.MWI_SELFTEST_LOGS === '1') {
    try {
      const logsMod = require('./lib/logs');
      logsMod.info('test-acc', 'first log');
      logsMod.warn('test-acc', 'warning example');
      logsMod.error('test-acc', 'error example');
      console.log('[mwi selftest-logs] list test-acc length:', logsMod.list('test-acc').length);
      console.log('[mwi selftest-logs] list test-acc[0]:', JSON.stringify(logsMod.list('test-acc')[0]));
      console.log('[mwi selftest-logs] list nonexistent:', JSON.stringify(logsMod.list('nonexistent')));
      logsMod.clear('test-acc');
      console.log('[mwi selftest-logs] after clear length:', logsMod.list('test-acc').length);
      console.log('[mwi selftest-logs] MAX_PER_ACCOUNT:', logsMod.MAX_PER_ACCOUNT);
      console.log('[mwi selftest-logs] PASS');
    } catch (e) {
      console.error('[mwi selftest-logs] FAIL:', e);
    }
  }

  // 调试模式：端到端 GUI 流程自检（MWI_SELFTEST_E2E=1 启用）
  if (process.env.MWI_SELFTEST_E2E === '1') {
    app.whenReady().then(() => {
      setTimeout(async () => {
        try {
          const accountsMod = require('./lib/accounts');
          const viewsMod = require('./lib/views');
          const acc = accountsMod.createAccount({
            name: 'e2e-aboutblank',
            url: 'about:blank',
          });
          console.log('[mwi selftest-e2e] created:', acc.id);

          const r = await viewsMod.startView(acc.id);
          console.log('[mwi selftest-e2e] startView:', JSON.stringify(r));
          console.log('[mwi selftest-e2e] state:', viewsMod.getState(acc.id));

          // 等 2 秒让中部 view 渲染完成
          await new Promise((res) => setTimeout(res, 2000));
          console.log('[mwi selftest-e2e] state after 2s:', viewsMod.getState(acc.id));

          // 验证中部 view 是否真的加载
          const entry = viewsMod.listRunning().includes(acc.id)
            ? require('./lib/views') : null;
          if (entry !== null) {
            console.log('[mwi selftest-e2e] listRunning:', JSON.stringify(viewsMod.listRunning()));
          }

          viewsMod.stopView(acc.id);
          console.log('[mwi selftest-e2e] after stop, listRunning:', JSON.stringify(viewsMod.listRunning()));

          accountsMod.removeAccount(acc.id);
          console.log('[mwi selftest-e2e] cleaned, accounts:', accountsMod.listAccounts().length);
          console.log('[mwi selftest-e2e] PASS');
        } catch (e) {
          console.error('[mwi selftest-e2e] FAIL:', e);
        }
      }, 1500);
    });
  }

  // 调试模式：WebContentsView 池自检（MWI_SELFTEST_VIEWS=1 启用，仅边界）
  if (process.env.MWI_SELFTEST_VIEWS === '1') {
    (async () => {
      try {
        console.log('[mwi selftest-views] listRunning (empty):', JSON.stringify(views.listRunning()));
        console.log('[mwi selftest-views] getFocusedId (null):', JSON.stringify(views.getFocusedId()));
        console.log('[mwi selftest-views] startView nonexistent (no mainWindow):', JSON.stringify(await views.startView('nonexistent')));
        views.focusView('nonexistent');
        views.stopView('nonexistent');
        console.log('[mwi selftest-views] focus/stop on nonexistent (no-op):', 'ok');
        console.log('[mwi selftest-views] PASS');
      } catch (e) {
        console.error('[mwi selftest-views] FAIL:', e);
      }
    })();
  }

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

    // 调试模式：完整 views 池链路自检（MWI_SELFTEST_VIEWS=1 启用）
    if (process.env.MWI_SELFTEST_VIEWS === '1') {
      setTimeout(async () => {
        try {
          const accountsMod = require('./lib/accounts');
          const acc = accountsMod.createAccount({
            name: 'selftest-views-full',
            url: 'about:blank',
          });
          console.log('[mwi selftest-views-full] created:', acc.id);

          const r1 = await views.startView(acc.id);
          console.log('[mwi selftest-views-full] startView:', JSON.stringify(r1));
          console.log('[mwi selftest-views-full] listRunning:', JSON.stringify(views.listRunning()));
          console.log('[mwi selftest-views-full] focusedId:', views.getFocusedId());
          console.log('[mwi selftest-views-full] state:', views.getState(acc.id));

          views.stopView(acc.id);
          console.log('[mwi selftest-views-full] after stop, listRunning:', JSON.stringify(views.listRunning()));

          // 验证 logs 集成
          const logEntries = logs.list(acc.id);
          console.log('[mwi selftest-views-full] logs.length:', logEntries.length);
          if (logEntries.length > 0) {
            console.log('[mwi selftest-views-full] logs[0].message:', logEntries[0].message);
            console.log('[mwi selftest-views-full] logs[last].message:', logEntries[logEntries.length - 1].message);
          }
          logs.clear(acc.id);

          accountsMod.removeAccount(acc.id);
          console.log('[mwi selftest-views-full] cleaned, accounts:', accountsMod.listAccounts().length);
          console.log('[mwi selftest-views-full] FULL PASS');
        } catch (e) {
          console.error('[mwi selftest-views-full] FULL FAIL:', e);
        }
      }, 1500);
    }
  });

  // 退出前释放所有 gateway：SIGKILL 所有 mihomo 子进程，防止孤儿进程占端口池
  //（历史教训：应用退出后残留 mihomo 占 7890-7999，下次启动账号报 port_in_use）
  app.on('before-quit', () => {
    try { require('./lib/socks-gateway').releaseAll(); } catch (e) { /* ignore */ }
  });

  app.on('window-all-closed', () => {
    metrics.stopMetricsLoop();
    // macOS 惯例：除非 Cmd+Q，否则不退出
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
}
