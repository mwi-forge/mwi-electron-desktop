// lib/ipc.js - 主进程 IPC handlers 注册
// 渲染进程通过 contextBridge 暴露的 window.api.* 调用

const { ipcMain } = require('electron');
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

function register() {
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
  ipcMain.handle('views:focus',       (_e, accountId) => { views.focusView(accountId); });
  ipcMain.handle('views:reload',      (_e, accountId) => { views.reload(accountId); });
  ipcMain.handle('views:listRunning', ()              => views.listRunning());
  ipcMain.handle('views:getFocusedId',()              => views.getFocusedId());
  ipcMain.handle('views:getState',    (_e, accountId) => views.getState(accountId));

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
}

module.exports = { register };