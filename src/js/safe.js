// src/js/safe.js - 渲染层统一吞错收敛器（per issue #25 / #45）
// 与 lib/safe.js 同签名同语义；渲染层无日志 IPC 写通道，
// 落 console.warn 即可——main.js 的 console-message 桥接会把
// warning/error 级转发进主进程全局日志流并落盘，无需新增 IPC。
//
// 用法：
//   safe(() => window.api.views.focus(id), 'tabbar:focus')

export function safe(fn, tag) {
  // 编程错误（传非函数）不属于"要收敛的运行时错误"，直接炸给调用方
  if (typeof fn !== 'function') throw new TypeError('safe(fn, tag): fn must be a function');
  try {
    const r = fn();
    if (r && typeof r.catch === 'function') {
      return r.catch((e) => {
        console.warn('[safe:' + (tag || 'safe') + ']', e && e.message ? e.message : e);
      });
    }
    return r;
  } catch (e) {
    console.warn('[safe:' + (tag || 'safe') + ']', e && e.message ? e.message : e);
    return undefined;
  }
}
