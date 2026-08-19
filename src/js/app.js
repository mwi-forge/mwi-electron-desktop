// app.js - 渲染进程入口
// Phase 4：状态条 metrics 由 statusbar.js 接管，本文件只做 sanity check

console.log('[mwi] app.js loaded');
console.log('[mwi] electron version:', window.api && window.api.app && window.api.app.version || 'unknown');
console.log('[mwi] platform:', window.api && window.api.app && window.api.app.platform || 'unknown');

if (!window.api || !window.api.accounts || !window.api.groups || !window.api.metrics) {
  console.error('[mwi] window.api 部分缺失，preload bridge 配置有误');
}

// sidebar/tabbar/panel/statusbar 都在加载时自动初始化（订阅 store + IPC events）
// Phase 5+ 接入代理/指纹/Tampermonkey

console.log('[mwi] app.js init done');
