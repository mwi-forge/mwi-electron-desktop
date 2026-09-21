// lib/__tests__/logfile.test.js - 日志文件落盘器单测（per issue #45）
// 目录/时间全注入：tmpdir + 可控 now 模拟跨天滚动与超期清理，不依赖真实时钟。
// 运行：node --test lib/__tests__/logfile.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createLogFileWriter, dayKey } = require('../logfile.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mwi-logfile-test-'));
}

// 固定基准时间：2026-09-21T10:00:00 本地时区（dayKey 按本地日期）
const BASE = new Date(2026, 8, 21, 10, 0, 0).getTime();

function atHour(h) { return new Date(2026, 8, 21, h, 0, 0).getTime(); }

test('append 落盘：格式 `ISO [level] [accountId] message`，写入当天文件', () => {
  const dir = tmpDir();
  const w = createLogFileWriter({ dir, now: () => BASE });
  w.append('acc_1', { timestamp: BASE, level: 'warn', message: 'hello world' });
  const name = 'main-' + dayKey(() => BASE) + '.log';
  const content = fs.readFileSync(path.join(dir, name), 'utf8');
  assert.match(content, /\[warn\] \[acc_1\] hello world\n$/);
  // ISO 时间戳（UTC；本地时区偏移不写死，只校验格式）
  assert.match(content, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
});

test('按天滚动：跨天写入切到新文件，旧文件保留', () => {
  const dir = tmpDir();
  let now = BASE;
  const w = createLogFileWriter({ dir, now: () => now });
  w.append('app', { timestamp: now, level: 'info', message: 'day1' });
  now = BASE + 24 * 3600 * 1000; // 次日
  w.append('app', { timestamp: now, level: 'info', message: 'day2' });
  const files = fs.readdirSync(dir).sort();
  assert.strictEqual(files.length, 2);
  const day2 = fs.readFileSync(path.join(dir, files[1]), 'utf8');
  assert.match(day2, /\[info\] \[app\] day2\n/);
});

test('超期清理：maxDays=2 只保留今天+昨天，前天及更早删除', () => {
  const dir = tmpDir();
  // 预置三个旧文件：3 天前、2 天前（前天，超期）、1 天前（昨天，边界保留）
  const days = [3, 2, 1].map((ago) => dayKey(() => BASE - ago * 86400000));
  for (const d of days) {
    fs.writeFileSync(path.join(dir, 'main-' + d + '.log'), 'old\n');
  }
  createLogFileWriter({ dir, maxDays: 2, now: () => BASE }); // 构造即触发 prune
  const files = fs.readdirSync(dir).sort();
  assert.ok(!files.includes('main-' + days[0] + '.log'), '3 天前文件应被清理');
  assert.ok(!files.includes('main-' + days[1] + '.log'), '前天（超期）文件应被清理');
  assert.ok(files.includes('main-' + days[2] + '.log'), '昨天（边界内）文件应保留');
});

test('crashLine 直写：不依赖 entry 结构，落 [crash] 级别', () => {
  const dir = tmpDir();
  const w = createLogFileWriter({ dir, now: () => BASE });
  w.crashLine('crash', 'uncaughtException: boom');
  const content = fs.readFileSync(path.join(dir, 'main-' + dayKey(() => BASE) + '.log'), 'utf8');
  assert.match(content, /\[crash\] \[app\] uncaughtException: boom\n/);
});

test('readRecentFiles：按天倒序返回有内容的文件，缺文件跳过', () => {
  const dir = tmpDir();
  let now = BASE;
  const w = createLogFileWriter({ dir, now: () => now });
  w.append('app', { timestamp: now, level: 'info', message: 'today' });
  now = BASE - 86400000;
  w.append('app', { timestamp: now, level: 'info', message: 'yesterday' });
  now = BASE; // 复位到"今天"再读（readRecentFiles 以当前 now 为锚往前数天）
  const out = w.readRecentFiles(2);
  assert.strictEqual(out.length, 2);
  assert.match(out[0].content, /today/); // 最新在前
  assert.match(out[1].content, /yesterday/);
});

test('落盘失败静默：不可写目录不抛异常', () => {
  const w = createLogFileWriter({ dir: '/nonexistent/mwi-logs', now: () => BASE });
  assert.doesNotThrow(() => w.append('app', { timestamp: BASE, level: 'info', message: 'x' }));
  assert.doesNotThrow(() => w.crashLine('crash', 'x'));
});

test('logs.js sink 集成：setSink 后 append 双写（内存 + sink）', () => {
  // 直接验证 lib/logs 的 setSink 契约（真模块，非 stub）
  const logs = require('../logs.js');
  const dir = tmpDir();
  const w = createLogFileWriter({ dir, now: () => atHour(12) });
  const restore = (() => {
    const prev = null;
    logs.setSink(w.append);
    return () => logs.setSink(prev);
  })();
  try {
    logs.info(null, 'global event via sink'); // null accountId → 全局流 'app'
    const content = fs.readFileSync(path.join(dir, 'main-' + dayKey(() => atHour(12)) + '.log'), 'utf8');
    assert.match(content, /\[info\] \[app\] global event via sink/);
    // 内存侧：无 accountId 落入全局流
    const all = logs.listAll();
    assert.ok(Array.isArray(all.app));
    assert.ok(all.app.some((e) => e.message === 'global event via sink'));
  } finally {
    restore();
    logs.clear();
  }
});
