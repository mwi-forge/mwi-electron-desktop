// lib/safe.js - 统一吞错收敛器（per issue #25 / #45）
// 把"有意吞掉"的 try/catch 统一为 safe(fn, tag)：
// 错误带 tag 进全局日志流（自动落盘），现场不再静默。
// 一个函数覆盖两种形态：同步异常直接 catch；
// fn 返回 thenable 则挂 .catch（async 场景无需另调 safe.async）。
//
// 用法：
//   safe(() => view.webContents.destroy(), 'lifecycle:destroyView')
//   safe(async () => { await gateway.release(id); }, 'proxy:release')
//
// 注意：teardown/清理路径的错误本来无法补救，safe 只保证"可观测"，
// 不改变控制流（不 rethrow、不返回错误对象——调用方拿到 fn 的原返回值或 undefined）。

const logs = require('./logs');

function safe(fn, tag) {
  // 编程错误（传非函数）不属于"要收敛的运行时错误"，直接炸给调用方
  if (typeof fn !== 'function') throw new TypeError('safe(fn, tag): fn must be a function');
  try {
    const r = fn();
    if (r && typeof r.catch === 'function') {
      return r.catch((e) => {
        logs.warn('app', '[' + (tag || 'safe') + '] ' + (e && e.message ? e.message : e));
      });
    }
    return r;
  } catch (e) {
    logs.warn('app', '[' + (tag || 'safe') + '] ' + (e && e.message ? e.message : e));
    return undefined;
  }
}

module.exports = { safe };
