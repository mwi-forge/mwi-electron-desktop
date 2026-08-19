// src/js/i18n.js - 渲染进程 i18n 模块
// 暴露 window.mwiI18n.{t, setLocale, getLocale, onChange}。
// t() 查 fallback 链(current -> zh-CN -> key 字面) + {name} 占位符；
// setLocale(code) 切 in-memory + 同步 document.documentElement.lang + 调主进程持久化 + 广播 onChange。
// 与 IPC API（window.api.i18n.*）正交：renderer 同步切，IPC 异步落盘。

(function () {
  'use strict';

  // === 防御：window.__mwiLocales 由 preload 注入；若未就绪回退空表（per design Risks R2）===
  var RAW_LOCALES = (window.__mwiLocales && typeof window.__mwiLocales === 'object')
    ? window.__mwiLocales
    : { 'zh-CN': {}, 'en-US': {} };

  var SUPPORTED = ['zh-CN', 'en-US'];
  var DEFAULT_LOCALE = 'zh-CN';
  var current = DEFAULT_LOCALE;
  var subscribers = [];
  var userExplicitlyChanged = false;  // 用户手动切了语言，跳过持久化值覆盖（per design risk: init 竞态）

  function hasLocale(code) {
    return SUPPORTED.indexOf(code) >= 0;
  }

  function pickFrom(code, key) {
    if (!code) return undefined;
    var table = RAW_LOCALES[code];
    if (!table || typeof table !== 'object') return undefined;
    return table[key];
  }

  // {name} 占位符替换：占位符在 resolved 字符串中按字面出现，遇相同 key 多次替换
  function interpolate(template, vars) {
    if (!vars || typeof template !== 'string') return template;
    return template.replace(/\{(\w+)\}/g, function (_m, name) {
      return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : '{' + name + '}';
    });
  }

  // t(key, vars?) 主入口
  function t(key, vars) {
    if (typeof key !== 'string') return String(key);
    var v = pickFrom(current, key);
    if (typeof v !== 'string') v = pickFrom(DEFAULT_LOCALE, key);
    if (typeof v !== 'string') return key;
    return interpolate(v, vars);
  }

  // setLocale(code) — 切换：先 in-memory，再 DOM lang，最后异步持久化
  // 注意：userExplicitlyChanged 在进入函数时就置 true（即使最终早退也算用户主动调用）；
  // 这是为了赢 init() 的持久化回放竞态（per memory 2026-08-18 init 竞态教训）
  function setLocale(code) {
    userExplicitlyChanged = true;
    var next = hasLocale(code) ? code : DEFAULT_LOCALE;
    if (next === current && document.documentElement.lang === current) {
      // 无变化：不广播，不持久化（但 user 标记已设）
      return;
    }
    current = next;
    document.documentElement.lang = current;
    // 广播（同步，订阅者必须 fast）；后续 change 渐进式抽取时各模块在此处 re-render
    for (var i = 0; i < subscribers.length; i++) {
      try { subscribers[i](current); } catch (e) { /* 单个订阅者失败不影响其余 */ }
    }
    // 静态 DOM 节点也应用一次
    applyI18nToStatic();
    // 持久化（异步 fire-and-forget；UI 已切，等下次启动读回）
    try {
      if (window.api && window.api.i18n && typeof window.api.i18n.set === 'function') {
        window.api.i18n.set(current).catch(function () { /* swallow */ });
      }
    } catch (e) { /* swallow */ }
  }

  function getLocale() { return current; }

  // onChange(fn) -> unsubscribe；fn(locale) 同步触发
  function onChange(fn) {
    if (typeof fn !== 'function') return function () {};
    subscribers.push(fn);
    return function () {
      var idx = subscribers.indexOf(fn);
      if (idx >= 0) subscribers.splice(idx, 1);
    };
  }

  // === 静态 DOM 应用：扫 [data-i18n-text|title|placeholder] 属性 ===
  // 用 dataset key 找 t() 文本，批量套；account-form / settings-tab 这类动态构建
  // 的 DOM 直接用 t() 拼即可，不用这套标记；本套仅给硬编码到 index.html 的静态元素用。
  function applyI18nToStatic() {
    try {
      var ds = document.documentElement.querySelectorAll('[data-i18n-text], [data-i18n-title], [data-i18n-placeholder], [data-i18n-html]');
      for (var i = 0; i < ds.length; i++) {
        var el = ds[i];
        var htmlKey = el.dataset.i18nHtml;
        var txtKey = el.dataset.i18nText;
        var titleKey = el.dataset.i18nTitle;
        var placeholderKey = el.dataset.i18nPlaceholder;
        if (txtKey) el.textContent = t(txtKey);
        if (titleKey) el.title = t(titleKey);
        if (placeholderKey) el.setAttribute('placeholder', t(placeholderKey));
        if (htmlKey) {
          // data-i18n-html 走 innerHTML 路径；只在工具栏按钮图标旁的 <span> 这种静态文本用，
          // 没引入任何用户输入，XSS 安全
          el.innerHTML = t(htmlKey);
        }
      }
    } catch (e) {
      // 静默吞 — 静态应用失败不应阻塞 i18n 模块
    }
  }

  // 暴露
  window.mwiI18n = {
    t: t,
    setLocale: setLocale,
    getLocale: getLocale,
    onChange: onChange,
    applyI18nToStatic: applyI18nToStatic,
    SUPPORTED: SUPPORTED,
    DEFAULT_LOCALE: DEFAULT_LOCALE,
  };

  // 初始化：拉取持久化值（异步），与用户切语言互不覆盖
  function init() {
    document.documentElement.lang = current;
    applyI18nToStatic();  // DOM 静态节点应用当前 locale 的文案
    if (!(window.api && window.api.i18n && typeof window.api.i18n.get === 'function')) return;
    window.api.i18n.get().then(function (persisted) {
      if (userExplicitlyChanged) return;  // 用户已先于持久化读回手动改过，保留用户选择
      if (!hasLocale(persisted)) return;
      if (persisted === current) return;
      current = persisted;
      document.documentElement.lang = current;
      applyI18nToStatic();  // 持久化值应用后再 sweep 一遍
    }).catch(function () { /* swallow - 失败回退当前 current */ });
  }

  // DOMContentLoaded 时初始化（保证 body 已存在，document.documentElement 可写）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
