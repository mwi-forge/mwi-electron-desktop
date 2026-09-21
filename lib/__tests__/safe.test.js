// lib/__tests__/safe.test.js - 统一吞错收敛器单测（per issue #45 / #25）
// 覆盖：同步异常 / promise 拒绝 / tag 进日志 / 正常返回值透传。
// 运行：node --test lib/__tests__/safe.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { safe } = require('../safe.js');
const logs = require('../logs.js');

function lastAppLog() {
  const all = logs.listAll();
  const buf = all.app || [];
  return buf[buf.length - 1] || null;
}

test('同步异常：吞掉不抛，错误带 tag 进全局日志流', () => {
  logs.clear();
  const r = safe(() => { throw new Error('boom-sync'); }, 't:sync');
  assert.strictEqual(r, undefined);
  const last = lastAppLog();
  assert.ok(last, '应写入一条日志');
  assert.match(last.message, /^\[t:sync\] boom-sync$/);
  assert.strictEqual(last.level, 'warn');
});

test('promise 拒绝：.catch 吞掉，错误带 tag 进日志', async () => {
  logs.clear();
  const p = safe(async () => { throw new Error('boom-async'); }, 't:async');
  await p; // 应已被 catch，不产生 unhandledRejection
  const last = lastAppLog();
  assert.match(last.message, /^\[t:async\] boom-async$/);
});

test('正常路径：返回值透传（同步与异步）', async () => {
  logs.clear();
  assert.strictEqual(safe(() => 42, 't:ok'), 42);
  const v = await safe(() => Promise.resolve('val'), 't:ok2');
  assert.strictEqual(v, 'val');
  // 无错误时不写日志
  assert.strictEqual(lastAppLog(), null);
});

test('无 tag 时回落 [safe] 前缀；非 Error 抛出值原样字符串化', () => {
  logs.clear();
  safe(() => { throw 'plain-string'; });
  const last = lastAppLog();
  assert.strictEqual(last.message, '[safe] plain-string');
});

test('非函数入参：同步抛 TypeError 由调用方感知（safe 不掩盖编程错误以外的场景约定）', () => {
  // safe(fn) 契约要求 fn 是函数；传非函数属于调用方 bug，safe 自身会抛——
  // 该行为写进测试锁定，避免未来悄悄变成静默。
  assert.throws(() => safe(null, 't:x'), TypeError);
});
