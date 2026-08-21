// mwi-shim.js - MWI Electron Desktop 扩展兼容层（必须在 VM/TM bundle 之前同页执行）
//
// 背景：Electron 43 的扩展实现只提供部分 chrome API（tabs/webRequest/i18n/storage/runtime/
//       extension/management），以下 API 均为 undefined（loadExtension 时伴随
//       "Permission 'xxx' is unknown or URL pattern is malformed" 警告）：
//         notifications / contextMenus / cookies / downloads / commands /
//         windows / browserAction / permissions
//       Violentmonkey 2.48 的 MV2 background 初始化会在多个顶层调用上崩溃：
//         1) browser.notifications.onClicked.addListener      → TypeError
//         2) browser.windows.getAll()（UA 探测）              → TypeError
//         3) browser.permissions 顶层解构 onAdded/onRemoved   → TypeError
//         4) browser.browserAction 徽标更新                   → TypeError
//       任一崩溃都会让 bundle 末尾的 chrome.runtime.onMessage.addListener(handler)
//       永不执行 → options 页 sendMessage 报 "Receiving end does not exist"，
//       重试 10s 后红字 "Violentmonkey cannot connect to the background page."。
//
//       另一坑：VM 的 browser 包装层把 chrome API 方法包装成 Promise 时，会把回调作为
//       【最后一个参数】追加到方法调用上，期望真实 API 调用该回调（返回值被忽略）。
//       若桩函数不调用该回调，包装层 Promise 永不 resolve → 初始化任务（如 UA 探测里的
//       browser.windows.getAll()）挂起 → ut Promise 永不 resolve → 所有命令处理挂起。
//       因此桩必须遵循「末位函数参数即回调」协议（见下方 stub()）。
//
// 本文件只对缺失的 API 打最小桩，防止初始化崩溃；Electron 已实现的 API 不覆盖。
// 打桩 API 在 Electron 中本就不存在，功能静默降级（系统通知 / 右键菜单 / GM_cookie /
// downloads / 窗口管理 / 徽标 / 权限），不影响用户脚本核心链路（chrome.storage、
// 注入与执行、options 页管理、消息往返）。
//
// 注入方式：manifest.json 的 background.scripts 第一项（MV2 同页按序执行）。
// 扩展被手动更新后需重跑：node scripts/patch-tampermonkey-shim.js
"use strict";

(function () {
  var g = typeof window !== 'undefined' ? window : globalThis;
  var chrome = g.chrome;
  if (!chrome || typeof chrome !== 'object') return;

  // 标记 shim 已执行（诊断 / e2e 断言用）
  try { g.__mwiShim = true; } catch (e) { /* ignore */ }

  function slice(a) { return Array.prototype.slice.call(a); }

  // 生成兼容 VM browser 包装层回调协议的桩方法：
  //   - 调用时若【末位参数是函数】，视为 chrome 回调，立即以 value 回调之（包装层据此 resolve）；
  //   - 否则返回 Promise.resolve(value)（MV2 Promise 语义 / 直接调用）。
  // valueFn 可返回动态值（如自增通知 id）。
  function stub(valueFn) {
    return function () {
      var args = slice(arguments);
      var cb = (args.length && typeof args[args.length - 1] === 'function') ? args[args.length - 1] : null;
      var value = typeof valueFn === 'function' ? valueFn.apply(this, args) : valueFn;
      if (cb) { try { cb(value); } catch (e) { /* ignore */ } return undefined; }
      return Promise.resolve(value);
    };
  }

  // 无返回值方法（徽标/菜单更新等）：回调协议同样适用，回调时不带值。
  function voidOp() {
    var args = slice(arguments);
    var cb = (args.length && typeof args[args.length - 1] === 'function') ? args[args.length - 1] : null;
    if (cb) { try { cb(); } catch (e) { /* ignore */ } }
  }

  // 事件对象：只登记、绝不调用监听器（VM 监听器回调签名依赖真实事件参数，空参调用会崩；
  // Electron 里这些事件永远不会触发）。
  function noopListener() {}
  function eventStub() {
    return {
      addListener: noopListener,
      removeListener: noopListener,
      hasListener: function () { return false; },
      hasListeners: function () { return false; },
    };
  }

  // chrome.extension 在 Electron 中部分实现（getURL/getBackgroundPage），补缺少数方法。
  if (chrome.extension && typeof chrome.extension.isAllowedFileSchemeAccess !== 'function') {
    chrome.extension.isAllowedFileSchemeAccess = stub(true);
    if (typeof chrome.extension.isAllowedIncognitoAccess !== 'function') {
      chrome.extension.isAllowedIncognitoAccess = stub(false);
    }
    if (typeof chrome.extension.getViews !== 'function') {
      chrome.extension.getViews = function () { return []; };
    }
  }

  // ---- chrome.notifications ----
  if (!chrome.notifications) {
    var notifId = 0;
    chrome.notifications = {
      create: stub(function () { return String(++notifId); }),
      clear: stub(true),
      getAll: stub([]),
      update: stub(false),
      onClicked: eventStub(),
      onClosed: eventStub(),
      onButtonClicked: eventStub(),
    };
  }

  // ---- chrome.contextMenus ----
  if (!chrome.contextMenus) {
    chrome.contextMenus = {
      create: function () { return 0; },
      update: voidOp,
      remove: voidOp,
      removeAll: voidOp,
      ACTION_MENU: 'action',
      onClicked: eventStub(),
      onShown: eventStub(),
    };
  }

  // ---- chrome.cookies ----
  if (!chrome.cookies) {
    chrome.cookies = {
      get: stub(null),
      getAll: stub([]),
      getAllCookieStores: stub([{ id: '0', tabIds: [] }]),
      set: stub(null),
      remove: stub(null),
      onChanged: eventStub(),
    };
  }

  // ---- chrome.downloads ----
  if (!chrome.downloads) {
    chrome.downloads = {
      download: stub(0),
      search: stub([]),
      cancel: stub(undefined),
      erase: stub([]),
      open: voidOp,
      show: voidOp,
      onChanged: eventStub(),
      onCreated: eventStub(),
    };
  }

  // ---- chrome.commands ----
  if (!chrome.commands) {
    chrome.commands = {
      getAll: stub([]),
      onCommand: eventStub(),
    };
  }

  // ---- chrome.windows（VM UA 探测初始化 browser.windows.getAll 会挂起/崩溃）----
  if (!chrome.windows) {
    chrome.windows = {
      get: stub(null),
      getCurrent: stub(null),
      getLastFocused: stub(null),
      getAll: stub([]),
      create: stub(null),
      update: stub(null),
      remove: stub(undefined),
      WINDOW_ID_NONE: -1,
      WINDOW_ID_CURRENT: -2,
      onCreated: eventStub(),
      onRemoved: eventStub(),
      onFocusChanged: eventStub(),
      onBoundsChanged: eventStub(),
    };
  }

  // ---- chrome.browserAction（徽标更新）----
  if (!chrome.browserAction) {
    chrome.browserAction = {
      setBadgeText: voidOp,
      setBadgeBackgroundColor: voidOp,
      setTitle: voidOp,
      setIcon: voidOp,
      setPopup: voidOp,
      onClicked: eventStub(),
    };
  }

  // ---- chrome.permissions（VM 顶层解构 onAdded/onRemoved 会崩溃）----
  if (!chrome.permissions) {
    chrome.permissions = {
      contains: stub(false),
      request: stub(false),
      remove: stub(false),
      getAll: stub({ permissions: [], origins: [] }),
      onAdded: eventStub(),
      onRemoved: eventStub(),
    };
  }
})();
