// lib/logs.js - 日志环形缓冲 + IPC 推送 + 文件落盘 sink
// 每个账号独立的 ring buffer（最多 200 条），超出丢弃最旧
// 无 accountId 的日志落入全局流 GLOBAL_ID（app 级事件：崩溃捕获、teardown 等）

const MAX_PER_ACCOUNT = 200;
const GLOBAL_ID = 'app';

// Map<accountId, Array<{ timestamp, level, message }>>
const buffers = new Map();
const subscribers = new Set();
let sink = null;

// 文件落盘 sink：由 main.js 在 app ready 后注入（lib/logfile.js）。
// sink 故障绝不影响内存日志与 IPC 推送——日志设施不能成为新故障源。
function setSink(fn) {
  sink = typeof fn === 'function' ? fn : null;
}

function append(accountId, level, message) {
  const key = accountId || GLOBAL_ID;
  let buf = buffers.get(key);
  if (!buf) {
    buf = [];
    buffers.set(key, buf);
  }
  const entry = { timestamp: Date.now(), level, message: String(message == null ? '' : message) };
  buf.push(entry);
  if (buf.length > MAX_PER_ACCOUNT) buf.shift();

  for (const cb of subscribers) {
    try { cb({ accountId: key, entry }); } catch (e) { console.error('[logs] subscriber err', e); }
  }
  if (sink) {
    try { sink(key, entry); } catch (e) { /* 落盘失败静默：见 setSink 注释 */ }
  }
}

function list(accountId, limit) {
  const buf = buffers.get(accountId) || [];
  if (typeof limit === 'number' && limit > 0) return buf.slice(-limit);
  return buf.slice();
}

function clear(accountId) {
  if (accountId) buffers.delete(accountId);
  else buffers.clear();
}

function onAppend(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

// 全量导出（诊断包用）：返回所有流（全局 + 各账号）的快照
function listAll() {
  const out = {};
  for (const [key, buf] of buffers) out[key] = buf.slice();
  return out;
}

function info(accountId, msg)  { append(accountId, 'info', msg); }
function warn(accountId, msg)  { append(accountId, 'warn', msg); }
function error(accountId, msg) { append(accountId, 'error', msg); }

module.exports = { append, list, listAll, clear, onAppend, setSink,
                   info, warn, error, MAX_PER_ACCOUNT, GLOBAL_ID };
