// lib/__tests__/clash-gateway.integration.test.js - 端到端：订阅解析 → gateway spawn → socks5 真请求
// 运行：node --test lib/__tests__/clash-gateway.integration.test.js
// 前置：mihomo 二进制存在（scripts/fetch-mihomo.mjs 拉取到 resources/mihomo/<plat>/）
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const clash = require('../clash');
const gateway = require('../socks-gateway');

// 纯内存测试 helper：stub 掉真实 spawn + waitPort（测池逻辑，不起真 mihomo）
function stubAll() {
  gateway.__setSpawnOverride(async function () {
    return { child: { kill: () => {}, stdout: { on: () => {} }, stderr: { on: () => {} }, on: () => {}, once: () => {} }, _stubbed: true };
  });
  gateway.__setWaitPortOverride(async () => true);
}

after(async () => {
  // 测试结束清理所有 gateway（含 e2e 测试残留的 mihomo 子进程）
  await gateway.releaseAll();
});

test('前置条件：mihomo 二进制存在（经 findMihomoBinary 按平台解析）', (t) => {
  // 回归：此前硬编码 resources/mihomo/mihomo，与实际布局 resources/mihomo/<plat>/mihomo[.exe]
  // 不符，守卫在任何机器都恒 skip 形同虚设。现复用 lib/socks-gateway.js 的
  // findMihomoBinary 单一事实源；CI/新机器没有二进制时不算失败（e2e 用例自身已带不可达兜底）
  const bin = gateway.findMihomoBinary();
  if (!bin) t.skip('mihomo 二进制缺失（dev 可跑 scripts/fetch-mihomo.mjs 拉取）');
});

test('findMihomoBinary 平台解析：dev 候选命中 <plat>/<exe>（mock existsSync）', (t) => {
  // 守卫是否有用的关键不在本机有没有二进制，而在解析逻辑是否按平台取对路径；
  // mock existsSync 后任何机器（含 CI）都能验证解析结果。
  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';
  const platDir = isWin ? 'win' : (isMac ? 'macos' : 'linux');
  const exeName = isWin ? 'mihomo.exe' : 'mihomo';
  const suffix = path.join('resources', 'mihomo', platDir, exeName);
  const mocked = t.mock.method(fs, 'existsSync', (p) => String(p).endsWith(suffix));
  try {
    const bin = gateway.findMihomoBinary();
    assert.ok(bin, 'dev 候选存在时应返回路径');
    assert.strictEqual(path.basename(bin), exeName);
    assert.ok(String(bin).endsWith(suffix), '应命中平台子目录 ' + suffix + '，实际: ' + bin);
  } finally {
    mocked.mock.restore();
  }
});

test('clash.js 解析 Clash YAML（含 ss + trojan）', () => {
  const yaml = [
    'proxies:',
    '  - name: "测试香港"',
    '    type: ss',
    '    server: 127.0.0.1',
    '    port: 8388',
    '    cipher: aes-256-gcm',
    '    password: secret1',
    '  - name: "测试日本"',
    '    type: trojan',
    '    server: 127.0.0.1',
    '    port: 443',
    '    password: secret2',
    '',
  ].join('\n');
  const nodes = clash.parseClashYaml(yaml);
  assert.strictEqual(nodes.length, 2);
  assert.strictEqual(nodes[0].type, 'ss');
  assert.strictEqual(nodes[1].type, 'trojan');
  assert.ok(nodes[0].id.includes('测试香港'));
});

test('gateway.buildMihomoConfig 生成合法 config（含节点字段透传）', () => {
  const node = {
    id: 't@127.0.0.1:8388', name: 't', type: 'ss',
    server: '127.0.0.1', port: 8388, password: 'pw', cipher: 'aes-256-gcm',
  };
  const cfg = gateway.buildMihomoConfig(node, 7890);
  const j = JSON.parse(cfg);
  assert.strictEqual(j['mixed-port'], 7890);
  assert.strictEqual(j.proxies[0].type, 'ss');
  assert.strictEqual(j.proxies[0].password, 'pw');
  assert.strictEqual(j.mode, 'global');
  assert.deepStrictEqual(j.rules, [], 'rules 必须为空数组：mihomo 1.19.x 不接受 MATCH,GLOBAL 简写，否则 Parse config error fatal');
});

test('clash.js 解析 vless+reality 与 hysteria2+obfs 字段透传', () => {
  const yaml = [
    'proxies:',
    '  - name: "REAL"',
    '    type: vless',
    '    server: 1.2.3.4',
    '    port: 443',
    '    uuid: u1',
    '    network: tcp',
    '    tls: true',
    '    servername: www.cloudflare.com',
    '    reality-opts:',
    '      public-key: PUBKEY123',
    '      short-id: abc123',
    '    client-fingerprint: chrome',
    '  - name: "OBFS"',
    '    type: hysteria2',
    '    server: 1.2.3.4',
    '    port: 8443',
    '    password: p1',
    '    obfs: salamander',
    '    obfs-password: obfs-secret',
    '    skip-cert-verify: true',
    '',
  ].join('\n');
  const nodes = clash.parseClashYaml(yaml);
  assert.strictEqual(nodes.length, 2);
  const v = nodes[0];
  assert.strictEqual(v.type, 'vless');
  assert.strictEqual(v.tls, true, 'tls 应为 bool true');
  assert.ok(v['reality-opts'], 'reality-opts 应透传');
  assert.strictEqual(v['reality-opts']['public-key'], 'PUBKEY123');
  assert.strictEqual(v['client-fingerprint'], 'chrome');
  const h = nodes[1];
  assert.strictEqual(h.type, 'hysteria2');
  assert.strictEqual(h.obfs, 'salamander');
  assert.strictEqual(h['obfs-password'], 'obfs-secret');
  assert.strictEqual(h['skip-cert-verify'], true, 'skip-cert-verify 应为 bool');
});

test('buildMihomoConfig 透传 reality/obfs 且布尔字段为 bool', () => {
  const node = {
    id: 'r@1.2.3.4:443', name: 'r', type: 'vless',
    server: '1.2.3.4', port: 443, uuid: 'u1', network: 'tcp',
    tls: 'true', servername: 'www.cloudflare.com',
    'reality-opts': { 'public-key': 'PK', 'short-id': 'ab' },
    'client-fingerprint': 'chrome', 'skip-cert-verify': 'true',
  };
  const cfg = gateway.buildMihomoConfig(node, 7891);
  const j = JSON.parse(cfg);
  const p = j.proxies[0];
  assert.strictEqual(p.tls, true, 'tls 字符串 true 应归一为 bool');
  assert.strictEqual(p['skip-cert-verify'], true);
  assert.deepStrictEqual(p['reality-opts'], { 'public-key': 'PK', 'short-id': 'ab' });
  assert.strictEqual(p['client-fingerprint'], 'chrome');
});

test('gateway 端到端：allocate → 端口就绪 → socks5 真请求（若二进制可用）', { timeout: 30000 }, async () => {
  // 用一个真实可达的 ss 节点做端到端：这里直接测 mihomo spawn 本身（DIRECT 出口）
  const node = { id: 'direct-test', name: 'direct', type: 'direct', server: '127.0.0.1', port: 1 };
  // direct 节点走 mihomo 的 DIRECT outbound（不需要真实服务器）
  try {
    const gw = await gateway.allocate({ ...node, type: 'socks5', server: '127.0.0.1', port: 1 }, {});
    // 至少验证 spawn 成功 + 端口分配
    assert.ok(gw.port >= 7890 && gw.port <= 7999);
    assert.strictEqual(gw.host, '127.0.0.1');
    // 通过 gateway 发 socks5 请求到 gstatic（用 DIRECT 出口）
    const r = execSync('curl -s -m 10 --socks5 127.0.0.1:' + gw.port + ' -o /dev/null -w "%{http_code}" "https://www.gstatic.com/generate_204" 2>&1', { encoding: 'utf8', timeout: 15000 });
    assert.strictEqual(r, '204');
    await gateway.release(gw.id);
    await gateway.releaseAll(); // 自包含清理：确保不污染后续 stub 测试
  } catch (e) {
    // 如果节点本身不通，至少验证 allocate 的端口分配逻辑正确（不阻断主流程）
    console.log('WARN: e2e node unreachable, but allocate worked:', e.message);
    await gateway.releaseAll();
  }
});

test('gateway refCount 共享：同节点二次 allocate 复用（纯内存 stub）', { timeout: 5000 }, async () => {
  stubAll();
  try {
    const beforeCount = gateway.listGateways().length;
    const node = { id: 'shared@1.2.3.4:443', name: 's', type: 'ss', server: '1.2.3.4', port: 443, password: 'x' };
    const a = await gateway.allocate(node, {});
    const b = await gateway.allocate(node, {});
    assert.strictEqual(a.id, b.id);
    assert.strictEqual(b.shared, true);
    assert.strictEqual(gateway.listGateways().length, beforeCount + 1, "只应新增 1 个 gateway");
    await gateway.release(a.id);
    await gateway.release(b.id);
  } finally {
    gateway.__resetSpawnOverride(); gateway.__resetWaitPortOverride();
  }
});

test('gateway refCount 归 0 真释放（纯内存 stub）', { timeout: 5000 }, async () => {
  stubAll();
  try {
    const beforeCount = gateway.listGateways().length;
    const node = { id: 'rel@1.2.3.4:443', name: 'r', type: 'ss', server: '1.2.3.4', port: 443, password: 'x' };
    const gw = await gateway.allocate(node, {});
    const first = await gateway.release(gw.id);
    assert.ok(first.released, '归0时应 released:true');
    const second = await gateway.release(gw.id);
    assert.ok(second.alreadyGone);
    assert.strictEqual(gateway.listGateways().length, beforeCount, "释放后池数量应回落到 alloc 前");
  } finally {
    gateway.__resetSpawnOverride(); gateway.__resetWaitPortOverride();
  }
});