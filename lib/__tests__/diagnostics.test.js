// lib/__tests__/diagnostics.test.js - 诊断包构建与脱敏单测（per issue #45）
// 脱敏是安全边界，断言全部用"结果中不得出现"的硬校验。
// 运行：node --test lib/__tests__/diagnostics.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  redactText, redactUrl, redactAccounts, redactSubscriptions, buildSnapshot,
} = require('../diagnostics.js');

// ---- redactText ----

test('redactText：公网 IPv4 替换为 <ip>，本地/内网地址保留', () => {
  assert.strictEqual(redactText('proxy exit: 203.0.113.7 | JP | Tokyo'), 'proxy exit: <ip> | JP | Tokyo');
  assert.strictEqual(redactText('socks5://127.0.0.1:7890 ok'), 'socks5://127.0.0.1:7890 ok');
  assert.match(redactText('lan 192.168.1.5 and 10.0.0.2'), /192\.168\.1\.5/);
  assert.match(redactText('lan 192.168.1.5 and 10.0.0.2'), /10\.0\.0\.2/);
});

test('redactText：(via node host:port) 整段替换', () => {
  assert.strictEqual(
    redactText('proxy exit: 1.2.3.4 (via node hk01.example.com:443)'),
    'proxy exit: <ip> (via node <redacted>)',
  );
});

test('redactText：null/undefined 安全返回空串', () => {
  assert.strictEqual(redactText(null), '');
  assert.strictEqual(redactText(undefined), '');
});

// ---- redactUrl ----

test('redactUrl：query（token 所在）剥除，origin+path 保留', () => {
  assert.strictEqual(
    redactUrl('https://sub.example.com/api/v1/client/subscribe?token=SECRET_TOKEN_abc'),
    'https://sub.example.com/api/v1/client/subscribe?<query-redacted>',
  );
  assert.strictEqual(redactUrl('https://game.example.com/play'), 'https://game.example.com/play');
});

// ---- redactAccounts ----

test('redactAccounts：代理密文/密码剥除，url 去 query，tampermonkey 脚本只留数量', () => {
  const out = redactAccounts([{
    id: 'acc_1',
    name: 'farm-01',
    url: 'https://game.example.com/play?token=ENTRY_TOKEN',
    userAgent: 'UA/1.0',
    proxy: { source: 'subscription', subscriptionId: 'sub_x', nodeId: 'n1', passwordEncrypted: 'BASE64CIPHER==' },
    tampermonkey: { scripts: [{ url: 'https://x/1.user.js' }, { url: 'https://x/2.user.js' }] },
  }]);
  assert.strictEqual(out.length, 1);
  const a = out[0];
  assert.strictEqual(a.proxy.passwordEncrypted, undefined);
  assert.strictEqual(a.proxy.subscriptionId, 'sub_x'); // 非敏感引用保留
  assert.strictEqual(a.url, 'https://game.example.com/play?<query-redacted>');
  assert.deepStrictEqual(a.tampermonkey.scripts, { count: 2 });
  // 硬校验：序列化后不得出现任何敏感原文
  const s = JSON.stringify(out);
  assert.ok(s.indexOf('BASE64CIPHER') < 0);
  assert.ok(s.indexOf('ENTRY_TOKEN') < 0);
  assert.ok(s.indexOf('1.user.js') < 0);
});

// ---- redactSubscriptions ----

test('redactSubscriptions：url 去 query、nodes 只留 count、error 截断并脱敏', () => {
  const out = redactSubscriptions([{
    id: 'sub_x',
    name: '机场A',
    url: 'https://sub.example.com/api?token=SECRET_SUB_TOKEN',
    nodes: [{ id: 'n1', server: '1.2.3.4', password: 'enc' }, { id: 'n2', server: '5.6.7.8', uuid: 'enc' }],
    error: 'fetch failed from https://sub.example.com/api?token=SECRET_SUB_TOKEN timeout after 60s ' + 'x'.repeat(300),
  }]);
  const sub = out[0];
  assert.strictEqual(sub.url, 'https://sub.example.com/api?<query-redacted>');
  assert.deepStrictEqual(sub.nodes, { count: 2 });
  assert.ok(sub.error.length <= 200 + '<ip>'.length, 'error 截断到约 200 字符');
  const s = JSON.stringify(out);
  assert.ok(s.indexOf('SECRET_SUB_TOKEN') < 0);
  assert.ok(s.indexOf('1.2.3.4') < 0, '节点 server 不得出现');
});

// ---- buildSnapshot ----

test('buildSnapshot：meta + 双路日志脱敏 + 配置快照组装', () => {
  const snap = buildSnapshot({
    app: { getVersion: () => '0.1.5' },
    uptimeSec: 123,
    logsMod: {
      listAll: () => ({
        app: [{ timestamp: 1, level: 'warn', message: '[t:x] fail at 8.8.8.8' }],
        acc_1: [{ timestamp: 2, level: 'info', message: 'proxy exit: 9.9.9.9 (via node s.example.com:443)' }],
      }),
    },
    logWriter: {
      readRecentFiles: () => [{ file: 'main-20260921.log', content: '2026-09-21 [info] [app] via 4.4.4.4 done\n' }],
    },
    accountsMod: { listAccounts: () => [{ id: 'a1', proxy: { passwordEncrypted: 'X' } }] },
    subsMod: { listSubscriptions: () => [{ id: 's1', url: 'https://s.io/p?token=T', nodes: [{}] }] },
  });
  assert.strictEqual(snap.meta.appVersion, '0.1.5');
  assert.strictEqual(snap.meta.uptimeSec, 123);
  assert.strictEqual(snap.meta.accountCount, 1);
  assert.strictEqual(snap.meta.subscriptionCount, 1);
  assert.match(snap.ringLogs.app[0].message, /<ip>/);
  assert.match(snap.ringLogs.acc_1[0].message, /\(via node <redacted>\)/);
  assert.ok(snap.logFiles[0].content.indexOf('4.4.4.4') < 0);
  // 全快照硬校验：敏感原文零出现
  const s = JSON.stringify(snap);
  assert.ok(s.indexOf('8.8.8.8') < 0);
  assert.ok(s.indexOf('9.9.9.9') < 0);
  assert.ok(s.indexOf('4.4.4.4') < 0);
  assert.ok(s.indexOf('token=T') < 0);
  assert.ok(s.indexOf('"passwordEncrypted":"X"') < 0);
});

test('buildSnapshot：deps 缺失时各段安全降级不抛', () => {
  const snap = buildSnapshot({});
  assert.deepStrictEqual(snap.ringLogs, {});
  assert.deepStrictEqual(snap.logFiles, []);
  assert.deepStrictEqual(snap.config.accounts, []);
  assert.strictEqual(snap.meta.appVersion, 'unknown');
});
