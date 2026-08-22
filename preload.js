// preload.js - MWI Electron Desktop 预加载脚本
// 通过 contextBridge 暴露 window.api.* 给渲染进程
// 所有调用都走 ipcRenderer.invoke，与主进程 lib/ipc.js 注册的 handlers 对应

// 注意：preload 上下文不暴露 app 模块（app.getVersion 在此处会抛 TypeError 导致整个 preload 加载失败），
// 版本号改走 ipcRenderer.sendSync('app:get-version')，由主进程 lib/ipc.js 的 ipcMain.on 处理器返回。
const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

// === Locale 表同步加载（per design Decision 1，Risks R1）===
// 缺失/损坏文件回退空对象；同步加载避免渲染进程初始化竞态
(function loadLocales() {
  var locales = { 'zh-CN': {}, 'en-US': {} };
  try {
    var dir = path.join(__dirname, 'src', 'locales');
    var codes = ['zh-CN', 'en-US'];
    for (var i = 0; i < codes.length; i++) {
      var code = codes[i];
      try {
        locales[code] = JSON.parse(fs.readFileSync(path.join(dir, code + '.json'), 'utf8'));
      } catch (_e) {
        locales[code] = {};  // 单个文件缺失不影响整张表
      }
    }
  } catch (_e) {
    // 整个目录不可达也无所谓，__mwiLocales 暴露空表，i18n.js 会全部 fallback
  }
  contextBridge.exposeInMainWorld('__mwiLocales', locales);
})();

contextBridge.exposeInMainWorld('api', {
  // === 账号 CRUD ===
  accounts: {
    list:   ()             => ipcRenderer.invoke('accounts:list'),
    get:    (id)           => ipcRenderer.invoke('accounts:get', id),
    create: (input)        => ipcRenderer.invoke('accounts:create', input),
    update: (id, patch)    => ipcRenderer.invoke('accounts:update', id, patch),
    remove: (id)           => ipcRenderer.invoke('accounts:remove', id),
  },
  // === 分组 CRUD ===
  groups: {
    list:   ()             => ipcRenderer.invoke('groups:list'),
    create: (name)         => ipcRenderer.invoke('groups:create', name),
    update: (id, patch)    => ipcRenderer.invoke('groups:update', id, patch),
    remove: (id)           => ipcRenderer.invoke('groups:remove', id),
  },
  // === WebContentsView 生命周期（Phase 2）===
  views: {
    start:         (id)        => ipcRenderer.invoke('views:start', id),
    stop:          (id)        => ipcRenderer.invoke('views:stop', id),
    focus:         (id)        => ipcRenderer.invoke('views:focus', id),
    reload:        (id)        => ipcRenderer.invoke('views:reload', id),
    listRunning:   ()          => ipcRenderer.invoke('views:listRunning'),
    getFocusedId:  ()          => ipcRenderer.invoke('views:getFocusedId'),
    getState:      (id)        => ipcRenderer.invoke('views:getState', id),
    getFocusedUrl: ()          => ipcRenderer.invoke('views:getFocusedUrl'),
    onUrlChanged: (cb) => {
      const h = (_e, data) => cb(data);
      ipcRenderer.on('view:url-changed', h);
      return () => ipcRenderer.removeListener('view:url-changed', h);
    },
    onStateChanged: (cb) => {
      const h = (_e, data) => cb(data);
      ipcRenderer.on('account:state-changed', h);
      return () => ipcRenderer.removeListener('account:state-changed', h);
    },
    onFocusChanged: (cb) => {
      const h = (_e, data) => cb(data);
      ipcRenderer.on('view:focus-changed', h);
      return () => ipcRenderer.removeListener('view:focus-changed', h);
    },
  },
  // === 应用元信息 + Phase 5 安全代理密码解密 ===
  meta: {
    storePath: ()                    => ipcRenderer.invoke('meta:storePath'),
    decryptProxyPassword: (encrypted) => ipcRenderer.invoke('proxy:decryptPassword', encrypted),
  },
  // === 指纹预设查询（Phase 5）===
  fingerprint: {
    listPresets: ()  => ipcRenderer.invoke('fingerprint:listPresets'),
    randomUA: ()     => ipcRenderer.invoke('fingerprint:randomUA'),
  },
  // === Tampermonkey 状态查询（Phase 5）===
  tampermonkey: {
    isReady: (extPath)       => ipcRenderer.invoke('tampermonkey:isReady', extPath),
    getDefaultExtPath: ()    => ipcRenderer.invoke('tampermonkey:getDefaultExtPath'),
    openPanel: (accountId)   => ipcRenderer.invoke('tampermonkey:openPanel', accountId),
  },
  // === logs（Phase 3）===
  logs: {
    list: (accountId, limit)  => ipcRenderer.invoke('logs:list', accountId, limit),
    clear: (accountId)        => ipcRenderer.invoke('logs:clear', accountId),
    maxPerAccount: ()        => ipcRenderer.invoke('logs:maxPerAccount'),
    onAppend: (cb) => {
      const h = (_e, data) => cb(data);
      ipcRenderer.on('log:append', h);
      return () => ipcRenderer.removeListener('log:append', h);
    },
  },
  // === metrics（Phase 4）===
  metrics: {
    snapshot: () => ipcRenderer.invoke('metrics:snapshot'),
    onUpdate: (cb) => {
      const h = (_e, data) => cb(data);
      ipcRenderer.on('metrics:update', h);
      return () => ipcRenderer.removeListener('metrics:update', h);
    },
  },
  // === canvas 静态 tab 切换：临时卸下 / 恢复 focused WebContentsView（不销毁）===
  canvas: {
    hideFocused:   () => ipcRenderer.invoke('canvas:focused:hide'),
    resumeFocused: () => ipcRenderer.invoke('canvas:focused:resume'),
    isFocusedHidden: () => ipcRenderer.invoke('canvas:focused:isHidden'),
  },
  // === 账号表单（静态 tab 模式：嵌入中部 canvas，不被 WebContentsView 遮挡）===
  accountForm: {
    // 主进程仅 ack；实际挂载由渲染进程 tabbar.js / account-form.js 负责
    open: (payload) => ipcRenderer.invoke('account-form:open', payload),
    // 表单提交仍走 accounts.create / update（不变更 IPC 协议）
  },
  // === 沉浸布局（折叠侧栏/面板）===
  layout: {
    set: (opts) => ipcRenderer.invoke('layout:set', opts),
  },

  // === i18n（locale 控制 IPC；renderer-side setLocale 同时落 document.documentElement.lang）===
  i18n: {
    get:   ()     => ipcRenderer.invoke('i18n:get'),
    set:   (code) => ipcRenderer.invoke('i18n:set', code),
    list:  ()     => ipcRenderer.invoke('i18n:list'),
  },

  // === Clash 订阅（Clash Verge 整合）===
  subscriptions: {
    list:        ()              => ipcRenderer.invoke('subscriptions:list'),
    get:         (id)            => ipcRenderer.invoke('subscriptions:get', id),
    add:         (input)         => ipcRenderer.invoke('subscriptions:add', input),
    update:      (id, patch)     => ipcRenderer.invoke('subscriptions:update', id, patch),
    delete:      (id)            => ipcRenderer.invoke('subscriptions:delete', id),
    refresh:     (id)            => ipcRenderer.invoke('subscriptions:refresh', id),
    listNodes:   (id)            => ipcRenderer.invoke('subscriptions:listNodes', id),
    measureNodes:(id)            => ipcRenderer.invoke('subscriptions:measureNodes', id),
    measureNode: (id, nodeId)    => ipcRenderer.invoke('subscriptions:measureNode', id, nodeId),
  },
  // === gateway（调试用）===
  gateway: {
    list:        () => ipcRenderer.invoke('gateway:list'),
    releaseAll:  () => ipcRenderer.invoke('gateway:releaseAll'),
  },

  // === 应用信息 ===
  app: {
    // 版本号动态读取（勿硬编码）：preload 无 app 模块，走同步 IPC 由主进程 app.getVersion() 返回
    version: ipcRenderer.sendSync('app:get-version'),
    platform: process.platform,
  },

  // === 自定义标题栏窗口控制（仅 frame:false 模式生效）===
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximizeToggle: () => ipcRenderer.send('window:maximizeToggle'),
    close: () => ipcRenderer.send('window:close'),
  },

  // === 测试 hook（仅 MWI_TEST_* 环境变量启用时由主进程发送）===
  test: {
    onSetPreview: (cb) => {
      const h = (_e, accId) => cb(accId);
      ipcRenderer.on('ui:test:setPreview', h);
      return () => ipcRenderer.removeListener('ui:test:setPreview', h);
    },
    onOpenForm: (cb) => {
      const h = () => cb();
      ipcRenderer.on('ui:test:openForm', h);
      return () => ipcRenderer.removeListener('ui:test:openForm', h);
    },
  },

  // === 应用内统一弹窗（替代 dialog.showMessageBox）===
  // 主进程通过 mainWindow.webContents.send('ui:dialog', ...) 触发；
  // 渲染进程 modal.js 监听 onShow 渲染 DOM，点按钮后调 reply 回执。
  dialog: {
    onShow: (cb) => {
      const h = (_e, payload) => cb(payload);
      ipcRenderer.on('ui:dialog', h);
      return () => ipcRenderer.removeListener('ui:dialog', h);
    },
    reply: (id, idx) => ipcRenderer.send('ui:dialog:reply', id, idx),
  },
});