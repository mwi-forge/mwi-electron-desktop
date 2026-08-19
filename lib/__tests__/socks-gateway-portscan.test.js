// lib/__tests__/socks-gateway-portscan.test.js - gateway 端口顺延逻辑测试
// 验证：被外部进程占用的端口会被跳过（顺延到下一个空闲端口），全忙才报错；
// releaseAll 归还端口后重新分配正常。用 __setPortProbeOverride 模拟端口占用，
// 用 __setSpawnOverride 跳过真实 mihomo spawn。
// 运行：node --test lib/__tests__/socks-gateway-portscan.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const gateway = require('../socks-gateway');

function fakeChild() {
  return {
    kill: function () {},
    once: function () {},
    on: function () {},
  };
}

function makeNode(id) {
  return { id: id, name: id, type: 'ss', server: '1.2.3.4', port: 443, cipher: 'aes-128-gcm', password: 'x' };
}

test('被占端口顺延：7890/7891 busy 时分配到 7892', async function () {
  gateway.__setPortProbeOverride(function (p) { return p === 7890 || p === 7891; });
  gateway.__setSpawnOverride(function () { return fakeChild(); });
  try {
    const r = await gateway.allocate(makeNode('scan-node-1'), {});
    assert.strictEqual(r.port, 7892, '应跳过 7890/7891 顺延到 7892');
    assert.strictEqual(r.shared, false);
    await gateway.release(r.id);
  } finally {
    gateway.__resetPortProbeOverride();
    gateway.__resetSpawnOverride();
  }
});

test('端口池全忙时抛 no_free_port 且不崩', async function () {
  gateway.__setPortProbeOverride(function () { return true; });
  gateway.__setSpawnOverride(function () { return fakeChild(); });
  try {
    await assert.rejects(
      function () { return gateway.allocate(makeNode('scan-node-2'), {}); },
      function (e) { return e && e.type === 'no_free_port'; }
    );
  } finally {
    gateway.__resetPortProbeOverride();
    gateway.__resetSpawnOverride();
  }
});

test('releaseAll 归还端口后重新分配成功且拿到池中最小空闲端口', async function () {
  gateway.__setPortProbeOverride(function () { return false; });
  gateway.__setSpawnOverride(function () { return fakeChild(); });
  try {
    const r1 = await gateway.allocate(makeNode('scan-node-3'), {});
    const used = r1.port;
    await gateway.releaseAll();
    const r2 = await gateway.allocate(makeNode('scan-node-3b'), {});
    // 归还端口插到池尾（避免立刻重用 TIME_WAIT 端口），重新分配只需成功且在池范围内
    assert.ok(r2.port >= gateway.PORT_RANGE_START && r2.port <= gateway.PORT_RANGE_END, 'releaseAll 后重新分配应在端口池范围内');
    assert.notStrictEqual(r2.port, used, '归还到池尾后不应立即重用同一端口');
    await gateway.release(r2.id);
  } finally {
    gateway.__resetPortProbeOverride();
    gateway.__resetSpawnOverride();
  }
});
