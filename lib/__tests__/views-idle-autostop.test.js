// lib/__tests__/views-idle-autostop.test.js - idle auto-stop 单测（per openspec/changes/idle-auto-stop）
// #24 拆分后直连 require lib/views/idle.js（electron-store / stopView / pool / getWindow 注入，
// mock.timers 控制定时器推进），替换原 vm sandbox 假 require 方案并让 c8 可归因覆盖。
// 注意：不 mock Date（各版本 mock.timers 对 Date 推进行为不一致）；lastActivityAt 用真实时钟，
// 同步代码内两行之间漂移 <1ms，断言边界均留 ≥1s 余量。
// 运行：node --test lib/__tests__/views-idle-autostop.test.js
const { test, mock } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const IDLE_PATH = require.resolve(path.join(__dirname, '..', 'views', 'idle.js'));

// 每个 case 重建模块状态（require.cache 清除后重新加载，等价原 vm sandbox 的按例隔离）
function freshIdle(opts) {
  opts = opts || {};
  delete require.cache[IDLE_PATH];
  const idle = require('../views/idle');
  const pool = new Map();
  const sent = [];
  const fakeWin = {
    isDestroyed: function () { return false; },
    webContents: { send: function (ch, payload) { sent.push({ ch: ch, payload: payload }); } },
  };
  const store = {
    data: { idleAutoStopMs: opts.idleTimeoutMs === undefined ? 300000 : opts.idleTimeoutMs },
    get: function (k) { return this.data[k]; },
    set: function (k, v) { this.data[k] = v; },
  };
  const stopped = [];
  idle.init({
    pool: pool,
    getWindow: function () { return fakeWin; },
    stopView: function (id, reason) { stopped.push([id, reason]); },
    store: store,
  });
  return { idle: idle, pool: pool, sent: sent, stopped: stopped, store: store };
}

function addEntry(pool, accountId) {
  const entry = { view: { setBounds: function () {} }, state: 'running', lastActivityAt: Date.now(), idleTimer: null };
  pool.set(accountId, entry);
  return entry;
}

function enableMockTimers() {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
}

test('Req 1: 模块加载默认 idleTimeoutMs = 300000', () => {
  const ctx = freshIdle();
  assert.strictEqual(ctx.idle.getIdleTimeoutMs(), 300000);
});

test('Req 1: 从持久化 store 读回已保存阈值', () => {
  const ctx = freshIdle({ idleTimeoutMs: 120000 });
  assert.strictEqual(ctx.idle.getIdleTimeoutMs(), 120000);
});

test('Req 1: idleTimeoutMs === 0 时 armIdleTimer 是 no-op', () => {
  enableMockTimers();
  try {
    const ctx = freshIdle({ idleTimeoutMs: 0 });
    const entry = addEntry(ctx.pool, 'acc_0');
    ctx.idle.armIdleTimer('acc_0');
    mock.timers.tick(10 * 60 * 1000);
    assert.strictEqual(entry.idleTimer, null);
    assert.strictEqual(ctx.stopped.length, 0);
  } finally { mock.timers.reset(); }
});

test('Req 3: timer 到期 fire → stopView(accountId, "idle_timeout")', () => {
  enableMockTimers();
  try {
    const ctx = freshIdle();
    addEntry(ctx.pool, 'acc_a');
    ctx.idle.armIdleTimer('acc_a');
    mock.timers.tick(100000);
    assert.strictEqual(ctx.stopped.length, 0);
    mock.timers.tick(250000);
    assert.deepStrictEqual(ctx.stopped, [['acc_a', 'idle_timeout']]);
  } finally { mock.timers.reset(); }
});

test('Req 3: resetActivity 重置 lastActivityAt，计时重新起算', () => {
  enableMockTimers();
  try {
    const ctx = freshIdle();
    addEntry(ctx.pool, 'acc_b');
    ctx.idle.armIdleTimer('acc_b');
    mock.timers.tick(100000);
    ctx.idle.resetActivity('acc_b');
    mock.timers.tick(100000);
    assert.strictEqual(ctx.stopped.length, 0);
    mock.timers.tick(250000);
    assert.strictEqual(ctx.stopped.length, 1);
  } finally { mock.timers.reset(); }
});

test('Req 3: countdown ticker 5s 周期广播 remaining，disarm 后拆 ticker', () => {
  enableMockTimers();
  try {
    const ctx = freshIdle();
    const entry = addEntry(ctx.pool, 'acc_c');
    ctx.idle.armIdleTimer('acc_c');
    mock.timers.tick(5000);
    assert.strictEqual(ctx.sent.length, 1);
    const first = ctx.sent[0];
    assert.strictEqual(first.ch, 'idle:countdown');
    assert.strictEqual(first.payload.items.length, 1);
    assert.strictEqual(first.payload.items[0].accountId, 'acc_c');
    assert.strictEqual(first.payload.items[0].totalMs, 300000);
    // Date 未 mock：tick 推进的是定时器时钟，remaining 仍接近满值
    const remaining = first.payload.items[0].remainingMs;
    assert.ok(remaining <= 300000 && remaining > 295000, 'remaining near full, got ' + remaining);
    // stop 流程与 lifecycle.stopView 时序一致：先 disarm（entry 仍在池内，timer 才会被清；
    // pool 非空所以 ticker 保留，随后 pool.delete，ticker 后续广播因 pool.size===0 空转）
    ctx.idle.disarmIdleTimer('acc_c');
    assert.strictEqual(entry.idleTimer, null);
    ctx.pool.delete('acc_c');
    const sentAfterDisarm = ctx.sent.length;
    mock.timers.tick(5000);
    mock.timers.tick(5000);
    assert.strictEqual(ctx.sent.length, sentAfterDisarm);
  } finally { mock.timers.reset(); }
});

test('Req 3: ticker 未武装时 broadcastCountdownIfArmed 不广播', () => {
  const ctx = freshIdle();
  addEntry(ctx.pool, 'acc_d');
  ctx.idle.broadcastCountdownIfArmed();
  assert.strictEqual(ctx.sent.length, 0);
});

test('Req 3: disposeAllIdleTimers 清空全部 timer 且不抛错', () => {
  enableMockTimers();
  try {
    const ctx = freshIdle();
    addEntry(ctx.pool, 'acc_e1');
    addEntry(ctx.pool, 'acc_e2');
    ctx.idle.armIdleTimer('acc_e1');
    ctx.idle.armIdleTimer('acc_e2');
    ctx.idle.disposeAllIdleTimers();
    mock.timers.tick(10 * 60 * 1000);
    assert.strictEqual(ctx.stopped.length, 0);
  } finally { mock.timers.reset(); }
});

test('Req 2: setIdleTimeoutMs(0) 立即生效', () => {
  const ctx = freshIdle();
  ctx.idle.setIdleTimeoutMs(0);
  assert.strictEqual(ctx.idle.getIdleTimeoutMs(), 0);
});

test('Req 2: getIdleConfig 口径 { timeoutMs, enabled }', () => {
  const ctx = freshIdle({ idleTimeoutMs: 60000 });
  const r1 = { timeoutMs: ctx.idle.getIdleTimeoutMs(), enabled: ctx.idle.getIdleTimeoutMs() > 0 };
  assert.deepStrictEqual(r1, { timeoutMs: 60000, enabled: true });
  ctx.idle.setIdleTimeoutMs(0);
  const r2 = { timeoutMs: ctx.idle.getIdleTimeoutMs(), enabled: ctx.idle.getIdleTimeoutMs() > 0 };
  assert.deepStrictEqual(r2, { timeoutMs: 0, enabled: false });
});

test('Req 4: setIdleTimeoutMs 非法值抛 Error', () => {
  const ctx = freshIdle();
  assert.throws(function () { ctx.idle.setIdleTimeoutMs(-1); });
  assert.throws(function () { ctx.idle.setIdleTimeoutMs(NaN); });
  assert.throws(function () { ctx.idle.setIdleTimeoutMs('abc'); });
});

test('Req 4: setIdleTimeoutMs 有效值生效并持久化到 store', () => {
  const ctx = freshIdle();
  ctx.idle.setIdleTimeoutMs(120000);
  assert.strictEqual(ctx.idle.getIdleTimeoutMs(), 120000);
  assert.strictEqual(ctx.store.data.idleAutoStopMs, 120000);
});

test('Req 4: setIdleTimeoutMs 变更后重刷 running view 的 timer', () => {
  enableMockTimers();
  try {
    const ctx = freshIdle();
    addEntry(ctx.pool, 'acc_f');
    ctx.idle.armIdleTimer('acc_f');
    ctx.idle.setIdleTimeoutMs(60000);
    mock.timers.tick(30000);
    assert.strictEqual(ctx.stopped.length, 0);
    mock.timers.tick(40000);
    assert.strictEqual(ctx.stopped.length, 1);
  } finally { mock.timers.reset(); }
});

test('Req 4: 导出齐全（facade 依赖面）', () => {
  const ctx = freshIdle();
  ['init', 'armIdleTimer', 'disarmIdleTimer', 'resetActivity', 'broadcastCountdownIfArmed',
    'disposeAllIdleTimers', 'getIdleTimeoutMs', 'setIdleTimeoutMs'].forEach(function (k) {
    assert.strictEqual(typeof ctx.idle[k], 'function', k);
  });
});
