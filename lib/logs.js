// lib/logs.js - 日志环形缓冲 + IPC 推送
// 每个账号独立的 ring buffer（最多 200 条），超出丢弃最旧

const MAX_PER_ACCOUNT = 200;

// Map<accountId, Array<{ timestamp, level, message }>>
const buffers = new Map();
const subscribers = new Set();

function append(accountId, level, message) {
  if (!accountId) return;
  let buf = buffers.get(accountId);
  if (!buf) {
    buf = [];
    buffers.set(accountId, buf);
  }
  const entry = { timestamp: Date.now(), level, message: String(message == null ? '' : message) };
  buf.push(entry);
  if (buf.length > MAX_PER_ACCOUNT) buf.shift();

  for (const cb of subscribers) {
    try { cb({ accountId, entry }); } catch (e) { console.error('[logs] subscriber err', e); }
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

function info(accountId, msg)  { append(accountId, 'info', msg); }
function warn(accountId, msg)  { append(accountId, 'warn', msg); }
function error(accountId, msg) { append(accountId, 'error', msg); }

module.exports = { append, list, clear, onAppend, info, warn, error, MAX_PER_ACCOUNT };
