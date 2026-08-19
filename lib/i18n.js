// lib/i18n.js - locale 持久化（electron-store）+ 主进程 API
// 本模块为 i18n 能力提供 locale 读写，与 accounts / subscriptions 模块并列；
// 持久化文件存于 userData/i18n.json（与 accounts.json / subscriptions.json 同级）；
// 写入失败静默吞异常（per design Risk R4）：in-memory 状态由 renderer 侧维护，回退默认 zh-CN。

const Store = require('electron-store');

const SUPPORTED = ['zh-CN', 'en-US'];
const DEFAULT = 'zh-CN';

// schema 限定 locale 必须在白名单内，避免外部写入脏值；clearInvalidConfig: false 保留其他字段
const SCHEMA = {
  locale: { type: 'string', enum: SUPPORTED, default: DEFAULT },
};
const store = new Store({ name: 'i18n', schema: SCHEMA, clearInvalidConfig: false });

/**
 * 读取持久化的 locale。返回 SUPPORTED 之一；store 缺字段 / 读取失败 / 值不在白名单 均回退 DEFAULT。
 * 调用者：lib/ipc.js `i18n:get` handler + 启动阶段 renderer init。
 */
function getLocale() {
  try {
    const v = store.get('locale');
    return SUPPORTED.indexOf(v) >= 0 ? v : DEFAULT;
  } catch (e) {
    return DEFAULT;
  }
}

/**
 * 写 locale 到 store。非法 code 抛 Error；写盘异常静默吞（per design Risk R4）。
 * 调用者：lib/ipc.js `i18n:set` handler；不返回任何值。
 */
function setLocale(code) {
  if (SUPPORTED.indexOf(code) < 0) {
    throw new Error('Unsupported locale: ' + code);
  }
  try {
    store.set('locale', code);
  } catch (e) { /* swallow - graceful fallback */ }
}

/**
 * 返回支持列表（固定白名单）。
 * 调用者：lib/ipc.js `i18n:list` handler + 任何需要枚举 locale 的 UI
 */
function listLocales() {
  return SUPPORTED.slice();
}

module.exports = { getLocale, setLocale, listLocales, SUPPORTED, DEFAULT };
