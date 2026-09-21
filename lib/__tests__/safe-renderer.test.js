// lib/__tests__/safe-renderer.test.js - 渲染层 safe() 单测（per issue #45 / #25）
// 与 lib/safe.js 同签名同语义，但落点是 console.warn（经 console-message 桥接落盘）。
// ESM：动态 import；console.warn 捕获用临时替换。
// 运行：node --test lib/__tests__/safe-renderer.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');

const modPromise = import('../../src/js/safe.js');

function captureWarn(fn) {
  const orig = console.warn;
  const calls = [];
  console.warn = (...args) => calls.push(args.join(' '));
  try {
    fn();
  } finally {
    console.warn = orig;
  }
  return calls;
}

test('同步异常：console.warn 带 [safe:tag] 前缀，不向外抛', async () => {
  const { safe } = await modPromise;
  const calls = captureWarn(() => {
    const r = safe(() => { throw new Error('boom-r'); }, 't:r');
    assert.strictEqual(r, undefined);
  });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0], '[safe:t:r] boom-r');
});

test('promise 拒绝：catch 后 console.warn', async () => {
  const { safe } = await modPromise;
  const calls = [];
  const orig = console.warn;
  console.warn = (...a) => calls.push(a.join(' '));
  try {
    // await safe 返回的 .catch 链完成 = catch 回调已执行（warn 已发生）
    await safe(async () => { throw new Error('boom-r-async'); }, 't:ra');
  } finally {
    console.warn = orig;
  }
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0], '[safe:t:ra] boom-r-async');
});

test('正常路径：返回值透传且不产生 warn', async () => {
  const { safe } = await modPromise;
  const calls = captureWarn(() => {
    assert.strictEqual(safe(() => 7, 't:ok'), 7);
  });
  assert.strictEqual(calls.length, 0);
});

test('无 tag 回落 [safe:safe]；非函数入参抛 TypeError（与主进程版契约一致）', async () => {
  const { safe } = await modPromise;
  const calls = captureWarn(() => {
    safe(() => { throw 'str-err'; });
  });
  assert.strictEqual(calls[0], '[safe:safe] str-err');
  assert.throws(() => safe(null), TypeError);
});
