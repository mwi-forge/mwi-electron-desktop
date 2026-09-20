// lib/ipc.js - 主进程 IPC handlers 注册
// 渲染进程通过 contextBridge 暴露的 window.api.* 调用

const { ipcMain, app } = require('electron');
const accounts = require('./accounts');
const views = require('./views');
const logs = require('./logs');
const metrics = require('./metrics');
const proxyMod = require('./proxy');
const fp = require('./fingerprint');
const tm = require('./tampermonkey');
const subs = require('./subscriptions');
const gateway = require('./socks-gateway');
const i18n = require('./i18n');
const alert = require('./alert');

function register() {
  // === 应用元信息（preload 通过 sendSync 同步取版本号）===
  ipcMain.on('app:get-version', (e) => { e.returnValue = app.getVersion(); });

  // === accounts ===
  ipcMain.handle('accounts:list',   ()                       => accounts.listAccounts());
  ipcMain.handle('accounts:get',    (_e, id)                 => accounts.getAccount(id));
  ipcMain.handle('accounts:create', (_e, input)              => accounts.createAccount(input));
  ipcMain.handle('accounts:update', (_e, id, patch)          => accounts.updateAccount(id, patch));
  ipcMain.handle('accounts:remove', (_e, id)                 => accounts.removeAccount(id));

  // === groups ===
  ipcMain.handle('groups:list',   ()        => accounts.listGroups());
  ipcMain.handle('groups:create', (_e, name) => accounts.createGroup(name));
  ipcMain.handle('groups:update', (_e, id, patch) => accounts.updateGroup(id, patch));
  ipcMain.handle('groups:remove', (_e, id) => accounts.removeGroup(id));

  // === canvas 静态 tab 切换：临时卸下 / 恢复当前 focused view（用于添加/编辑账号表单 tab）===
  ipcMain.handle('canvas:focused:hide',    () => views.hideFocused());
  ipcMain.handle('canvas:focused:resume',  () => views.resumeFocused());
  ipcMain.handle('canvas:focused:isHidden', () => views.isFocusedHidden());

  // === 账号表单（静态 tab 模式，嵌入中部 canvas，不被 WebContentsView 遮挡）===
  ipcMain.handle('account-form:open', (event, payload) => {
    // payload: { isEdit, account }
    // 主进程只负责把数据推给渲染进程；渲染进程负责挂 form tab DOM
    return { ok: true };
  });
  // 表单提交：自己调 accounts.create / update（不需要额外 IPC）
  // 表单关闭：renderer 自己关 tab + 调 canvas:focused:resume
  // === views（Phase 2）===
  ipcMain.handle('views:start',       (_e, accountId) => views.startView(accountId));
  ipcMain.handle('views:stop',        (_e, accountId) => { views.stopView(accountId); });
  ipcMain.handle('views:focus',       (_e, accountId) => views.focusView(accountId));
  ipcMain.handle('views:reload',      (_e, accountId) => { views.reload(accountId); });
  ipcMain.handle('views:listRunning', ()              => views.listRunning());
  ipcMain.handle('views:getFocusedId',()              => views.getFocusedId());
  ipcMain.handle('views:getState',    (_e, accountId) => views.getState(accountId));
  ipcMain.handle('views:getFocusedUrl', ()              => views.getFocusedUrl());

  // === idle auto-stop 配置（per openspec/changes/idle-auto-stop）===
  // 只读 getter + setter：renderer 通过 window.api.views.{getIdleConfig,setIdleConfig} 调用
  // setter 内部（views.setIdleTimeoutMs）会写 electron-store + 重置所有 running view 的 timer
  ipcMain.handle('views:getIdleConfig', () => ({ timeoutMs: views.getIdleTimeoutMs(), enabled: views.getIdleTimeoutMs() > 0 }));
  ipcMain.handle('views:setIdleConfig', (_e, payload) => {
    const ms = payload && payload.timeoutMs;
    if (!Number.isFinite(ms) || ms < 0) throw new Error('invalid timeoutMs');
    views.setIdleTimeoutMs(ms);
    return { ok: true, timeoutMs: views.getIdleTimeoutMs(), enabled: views.getIdleTimeoutMs() > 0 };
  });

  // === layout（沉浸模式：折叠侧栏/右侧面板，游戏视图最大化）===
  ipcMain.handle('layout:set', (_e, opts) => views.setLayout(opts));

  // === logs（Phase 3）===
  ipcMain.handle('logs:list', (_e, accountId, limit) => logs.list(accountId, limit));
  ipcMain.handle('logs:clear',(_e, accountId)        => logs.clear(accountId));
  ipcMain.handle('logs:maxPerAccount', ()            => logs.MAX_PER_ACCOUNT);

  // === metrics（Phase 4）===
  ipcMain.handle('metrics:snapshot', () => metrics.snapshot());

  // === proxy / fingerprint / tampermonkey（Phase 5）===
  ipcMain.handle('proxy:decryptPassword', (_e, encrypted) => proxyMod.decryptProxyPassword(encrypted));
  ipcMain.handle('fingerprint:listPresets', () => fp.listPresets());
  ipcMain.handle('fingerprint:randomUA', () => fp.randomUA());
  ipcMain.handle('tampermonkey:isReady', (_e, extPath) => tm.isExtensionReady(extPath));
  ipcMain.handle('tampermonkey:getDefaultExtPath', () => tm.getDefaultExtPath());
  ipcMain.handle('tampermonkey:openPanel', (_e, accountId) => views.openTampermonkeyPanel(accountId));

  // === assistant overlay（独立助手窗口底座）===
  ipcMain.handle('overlay:reset-position', () => {
    const overlay = globalThis.__assistantOverlay;
    if (overlay) overlay.moveToDefault();
  });
  ipcMain.handle('overlay:move-to', (_e, x, y) => {
    const overlay = globalThis.__assistantOverlay;
    if (overlay) overlay.moveTo(x, y);
  });
  ipcMain.handle('overlay:activate-main', () => {
    const overlay = globalThis.__assistantOverlay;
    if (overlay) overlay.activateMainWindow();
  });
  ipcMain.on('overlay:toggle-expand', () => {
    // 预留：方案一 NL 助手对接
  });

  // === subscriptions（Clash 订阅 + 节点测速）===
  ipcMain.handle('subscriptions:list', () => subs.listSubscriptions().map(s => ({ ...s, nodes: undefined })));
  ipcMain.handle('subscriptions:get', (_e, id) => subs.getSubscription(id));
  ipcMain.handle('subscriptions:add', async (_e, input) => {
    try {
      const sub = subs.createSubscription(input || {});
      // add 后自动首次 refresh（最长 60s）
      try { await Promise.race([subs.refreshSubscription(sub.id), new Promise((_, rej) => setTimeout(() => rej(new Error("refresh_timeout_60s")), 60000))]); }
      catch (e) { /* 保留记录，status 由 refresh 内部置 error */ }
      // 自动测速（非阻塞，不等结果）
      subs.measureAllNodes(sub.id).catch(() => {});
      return { ok: true, id: sub.id, subscription: subs.getSubscription(sub.id) };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });
  ipcMain.handle('subscriptions:update', (_e, id, patch) => {
    try { return { ok: true, subscription: subs.updateSubscription(id, patch || {}) }; }
    catch (e) { return { ok: false, error: e.message || String(e) }; }
  });
  ipcMain.handle('subscriptions:delete', (_e, id) => {
    try {
      subs.deleteSubscription(id);
      // 级联：重置引用该订阅的账号 proxy 为 null
      const accountsList = accounts.listAccounts();
      let changed = false;
      for (const a of accountsList) {
        if (a.proxy && a.proxy.source === 'subscription' && a.proxy.subscriptionId === id) {
          a.proxy = null;
          changed = true;
        }
      }
      if (changed) accounts.saveAll(accountsList);
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message || String(e) }; }
  });
  ipcMain.handle('subscriptions:refresh', async (_e, id) => {
    try { return { ok: true, subscription: await subs.refreshSubscription(id) }; }
    catch (e) { return { ok: false, error: e.message || String(e) }; }
  });
  ipcMain.handle('subscriptions:listNodes', (_e, id) => subs.listNodes(id));
  ipcMain.handle('subscriptions:measureNodes', async (_e, id) => {
    try {
      const m = await subs.measureAllNodes(id);
      return { ok: true, results: Object.fromEntries(m) };
    } catch (e) { return { ok: false, error: e.message || String(e) }; }
  });
  ipcMain.handle('subscriptions:measureNode', async (_e, id, nodeId) => {
    try { return { ok: true, result: await subs.measureSingleNode(id, nodeId) }; }
    catch (e) { return { ok: false, error: e.message || String(e) }; }
  });

  // === gateway（调试用；实际分配由 accounts.start 内部调用）===
  ipcMain.handle('gateway:list', () => gateway.listGateways());
  ipcMain.handle('gateway:releaseAll', async () => { await gateway.releaseAll(); return { ok: true }; });

  // === i18n（locale 控制；与 lib/i18n.js 关联；setLocale 非法 code 抛 Error，由 preload 转 throw）===
  ipcMain.handle('i18n:get',  ()                => i18n.getLocale());
  ipcMain.handle('i18n:set',  (_e, code)        => { i18n.setLocale(code); });
  ipcMain.handle('i18n:list', ()                => i18n.listLocales());

  // === meta ===
  ipcMain.handle('meta:storePath', () => accounts.storePath());

  // === 应用内弹窗回执（renderer → main）===
  // 注意：这是单向通知（ipcRenderer.send），不期待返回值；modal.js 点按钮后触发
  ipcMain.on('ui:dialog:reply', (_e, id, idx) => alert.replyDialog(id, idx));

  // === 自定义标题栏窗口控制（frame:false 模式）===
  // 通过 BrowserWindow.getFocusedWindow 获取当前主窗口（mainWindow 引用在 main.js 闭包内，
  // ipc.js 模块独立 require electron，不持有 mainWindow 引用）
  const { BrowserWindow } = require('electron');
  ipcMain.on('window:minimize', () => { const w = BrowserWindow.getFocusedWindow(); if (w && !w.isDestroyed()) w.minimize(); });
  ipcMain.on('window:maximizeToggle', () => {
    const w = BrowserWindow.getFocusedWindow();
    if (!w || w.isDestroyed()) return;
    if (w.isMaximized()) w.unmaximize(); else w.maximize();
  });
  ipcMain.on('window:close', () => { const w = BrowserWindow.getFocusedWindow(); if (w && !w.isDestroyed()) w.close(); });
}

module.exports = { register };
