// lib/selftest.js - 自检 / 测试钩子注册表
// 从 main.js 抽离（ISSUE-248 批次 3）：所有 MWI_SELFTEST_* / MWI_TEST_* 内联调试块集中于此，
// main.js 只保留一行 registerSelftests(...) 调用。生产路径（无对应环境变量）零行为。
// 注意：各 lib 模块保持块内惰性 require（与原内联版本一致，不改变模块加载副作用）。

const fs = require('fs');

function registerSelftests(ctx) {
  const { app, getMainWindow, views, alert, logs, metrics } = ctx;

  // === 测试 hook：MWI_TEST_DIALOG=1 时，启动后向渲染进程推一次 ui:dialog
  // === 仅供 tests/integration-electron.js 端到端验证使用，不污染生产
  // === 不再自动 app.exit()——puppeteer 主动关，避免 click/esc 后 page 被 detach
  if (process.env.MWI_TEST_DIALOG === '1') {
    const wait = parseInt(process.env.MWI_TEST_DIALOG_WAIT || '2000', 10);
    setTimeout(async () => {
      try {
        const idx = await alert.showAppAlert({
          type: 'error',
          title: '[TEST] 代理启动失败',
          message: '测试弹窗 message',
          detail: '原因: mihomo_binary_not_found\n代理模式: subscription\n\n详情测试',
          buttons: ['我知道了'],
          defaultId: 0,
          cancelId: 0,
        });
        console.log('[MWI_TEST] dialog resolved idx=' + idx);
      } catch (e) {
        console.error('[MWI_TEST] alert failed:', e.message);
      }
    }, wait);
  }

  // === 测试 hook：MWI_TEST_PREVIEW=1 时，模拟侧栏点未启动账号创建 preview tab ===
  if (process.env.MWI_TEST_PREVIEW === '1') {
    const previewWait = parseInt(process.env.MWI_TEST_PREVIEW_WAIT || '2000', 10);
    // 可选：MWI_TEST_FORM_FIRST=1 时先打开订阅管理 tab（验证 setPreviewTab 关 form tab）
    if (process.env.MWI_TEST_FORM_FIRST === '1') {
      setTimeout(function () {
        const win = getMainWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send('ui:test:openForm');
          console.log('[MWI_TEST_FORM] sent openForm');
        }
      }, parseInt(process.env.MWI_TEST_FORM_FIRST_WAIT || '1500', 10));
    }
    setTimeout(function () {
      try {
        const accId = process.env.MWI_TEST_PREVIEW_ACC || 'acc_79ed23b9'; // 002（未启动）
        const win = getMainWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send('ui:test:setPreview', accId);
          console.log('[MWI_TEST_PREVIEW] sent setPreview ipc: ' + accId);
        }
      } catch (e) { console.error('[MWI_TEST_PREVIEW] err:', e.message); }
    }, previewWait);
    // 周期截 BrowserWindow 到 tests/screenshots/preview-N.png
    let pn = 0;
    const prevInt = setInterval(async function () {
      try {
        const win = getMainWindow();
        if (!win || win.isDestroyed()) { clearInterval(prevInt); return; }
        const img = await win.webContents.capturePage();
        fs.writeFileSync('tests/screenshots/preview-' + pn + '.png', img.toPNG());
        pn++;
        if (pn > 6) clearInterval(prevInt);
      } catch (e) { /* ignore */ }
    }, 700);
  }

  // === 测试 hook：MWI_TEST_STARTVIEW=1 时，启动 KaelthaZ 账号触发代理启动流程
  if (process.env.MWI_TEST_STARTVIEW === '1') {
    const startWait = parseInt(process.env.MWI_TEST_STARTVIEW_WAIT || '1500', 10);
    setTimeout(async () => {
      try {
        const accId = process.env.MWI_TEST_STARTVIEW_ACC || 'acc_d9ebe258';
        console.log('[MWI_TEST_STARTVIEW] starting ' + accId);
        const r = await views.startView(accId);
        console.log('[MWI_TEST_STARTVIEW] result:', JSON.stringify(r));
        // dump view 状态
        const view = views.getView(accId);
        if (view) {
          const wb = view.getBounds();
          const wc = view.webContents;
          const dump = {
            bounds: wb,
            webContentsId: wc.id,
            webContentsURL: wc.getURL(),
            webContentsTitle: wc.getTitle(),
            isLoading: wc.isLoading(),
            isCrashed: wc.isCrashed(),
          };
          console.log('[MWI_TEST_STARTVIEW] view-dump:', JSON.stringify(dump));
          try { fs.writeFileSync('tests/view-dump.json', JSON.stringify(dump, null, 2)); } catch (_) {}
          // 周期截 BrowserWindow 到 tests/screenshots/frame-N.png，间隔 500ms
          let n = 0;
          const capInt = setInterval(async () => {
            try {
              const win = getMainWindow();
              if (!win || win.isDestroyed()) { clearInterval(capInt); return; }
              const img = await win.webContents.capturePage();
              fs.writeFileSync('tests/screenshots/frame-' + n + '.png', img.toPNG());
              n++;
              if (n > 12) clearInterval(capInt);
            } catch (e) { /* ignore */ }
          }, 500);
        } else {
          console.log('[MWI_TEST_STARTVIEW] view not found (start failed)');
          try { fs.writeFileSync('tests/view-dump.json', JSON.stringify({ error: 'no view', startResult: r }, null, 2)); } catch (_) {}
        }
      } catch (e) {
        console.error('[MWI_TEST_STARTVIEW] err:', e.message);
        try { fs.writeFileSync('tests/view-dump.json', JSON.stringify({ error: e.message }, null, 2)); } catch (_) {}
      }
    }, startWait);
  }

  // 调试模式：数据层自检（MWI_SELFTEST=1 启用）
  if (process.env.MWI_SELFTEST === '1') {
    const accountsMod = require('./accounts');
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
      const proxyMod = require('./proxy');
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
      const fpMod = require('./fingerprint');
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
      const fpMod = require('./fingerprint');
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
      const tmMod = require('./tampermonkey');
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
      logs.info('test-acc', 'first log');
      logs.warn('test-acc', 'warning example');
      logs.error('test-acc', 'error example');
      console.log('[mwi selftest-logs] list test-acc length:', logs.list('test-acc').length);
      console.log('[mwi selftest-logs] list test-acc[0]:', JSON.stringify(logs.list('test-acc')[0]));
      console.log('[mwi selftest-logs] list nonexistent:', JSON.stringify(logs.list('nonexistent')));
      logs.clear('test-acc');
      console.log('[mwi selftest-logs] after clear length:', logs.list('test-acc').length);
      console.log('[mwi selftest-logs] MAX_PER_ACCOUNT:', logs.MAX_PER_ACCOUNT);
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
          const accountsMod = require('./accounts');
          const viewsMod = require('./views');
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
            ? require('./views') : null;
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

  // 调试模式：完整 views 池链路自检（MWI_SELFTEST_VIEWS=1 启用）
  // whenReady 后 createMainWindow 已由 main.js 的 whenReady 回调完成（本函数先于该回调注册），
  // 1.5s 延迟触发时窗口必已就绪，与原内联版本时序一致。
  if (process.env.MWI_SELFTEST_VIEWS === '1') {
    app.whenReady().then(() => {
      setTimeout(async () => {
        try {
          const accountsMod = require('./accounts');
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
    });
  }
}

module.exports = { registerSelftests };
